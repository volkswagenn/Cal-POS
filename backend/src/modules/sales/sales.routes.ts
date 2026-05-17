import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/permission.js';
import { toSaleDetailDto, toSaleDto } from './sales.dto.js';
import { upsertSaleDetail } from './sales.service.js';

const saleSchema = z.object({
  id: z.string().min(1),
  billNo: z.string().min(1),
  cashierId: z.string().min(1),
  cashierName: z.string().min(1),
  subtotal: z.number().nonnegative(),
  discountAmount: z.number().nonnegative(),
  discountPercent: z.number().nonnegative(),
  total: z.number().nonnegative(),
  status: z.string().min(1),
  voidReason: z.string().optional(),
  voidedByUserId: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const saleDetailSchema = z.object({
  sale: saleSchema,
  items: z.array(z.object({
    id: z.string().min(1),
    saleId: z.string().min(1),
    productId: z.string().min(1),
    productName: z.string().min(1),
    price: z.number().nonnegative(),
    quantity: z.number().int().positive(),
    subtotal: z.number().nonnegative(),
    discountAmount: z.number().nonnegative(),
    discountPercent: z.number().nonnegative(),
    total: z.number().nonnegative(),
    note: z.string().optional(),
    isOpenPrice: z.boolean(),
    createdAt: z.string().datetime(),
  })),
  payments: z.array(z.object({
    id: z.string().min(1),
    saleId: z.string().min(1),
    method: z.string().min(1),
    amount: z.number().nonnegative(),
    receivedAmount: z.number().nonnegative(),
    changeAmount: z.number().nonnegative(),
    createdAt: z.string().datetime(),
  })),
  discounts: z.array(z.object({
    id: z.string().min(1),
    saleId: z.string().min(1),
    saleItemId: z.string().optional(),
    discountType: z.string().min(1),
    value: z.number().nonnegative(),
    approvedByUserId: z.string().optional(),
    createdAt: z.string().datetime(),
  })),
});

export { saleDetailSchema };

export async function saleRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.post('/', async (request, reply) => {
    const input = saleDetailSchema.parse(request.body);
    await upsertSaleDetail(request.user.shopId, input);
    await prisma.syncLog.create({
      data: { shopId: request.user.shopId, deviceId: 'api', table: 'sales', recordId: input.sale.id, action: 'upsert' },
    });

    return reply.code(201).send({ ok: true });
  });

  app.get('/', async (request) => {
    const query = z.object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      status: z.string().optional(),
    }).parse(request.query);

    const sales = await prisma.sale.findMany({
      where: {
        shopId: request.user.shopId,
        ...(query.status ? { status: query.status } : {}),
        ...((query.from || query.to) ? {
          createdAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    return { sales: sales.map(toSaleDto) };
  });

  app.get('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const sale = await prisma.sale.findFirst({
      where: { id, shopId: request.user.shopId },
      include: { items: true, payments: true, discounts: true },
    });

    if (!sale) return reply.code(404).send({ message: 'Sale not found' });
    return toSaleDetailDto(sale);
  });

  app.patch('/:id/void', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = z.object({ reason: z.string().min(1).optional() }).parse(request.body ?? {});
    const sale = await prisma.sale.findFirst({ where: { id, shopId: request.user.shopId } });
    if (!sale) return reply.code(404).send({ message: 'Sale not found' });

    const updated = await prisma.sale.update({
      where: { id },
      data: {
        status: 'voided',
        voidReason: input.reason,
        voidedByUserId: request.user.sub,
      },
    });
    await prisma.syncLog.create({
      data: { shopId: request.user.shopId, deviceId: 'api', table: 'sales', recordId: id, action: 'upsert' },
    });

    return { sale: toSaleDto(updated) };
  });

  app.delete('/history', { preHandler: requireRole(['admin']) }, async (request, reply) => {
    const { adminPin } = z.object({ adminPin: z.string().length(6).regex(/^\d{6}$/) }).parse(request.body);

    const admin = await prisma.user.findFirst({
      where: { shopId: request.user.shopId, id: request.user.sub, role: { in: ['admin', 'Admin'] }, isActive: true },
    });
    if (!admin || admin.pin !== adminPin) {
      return reply.code(403).send({ message: 'ต้องใช้บัญชี Admin ที่กำลังเข้าสู่ระบบและ PIN ของบัญชีนั้นเท่านั้น' });
    }

    const { count } = await prisma.$transaction(async (tx) => {
      const sales = await tx.sale.findMany({ where: { shopId: request.user.shopId }, select: { id: true } });
      const saleIds = sales.map((s) => s.id);

      await tx.discountLog.deleteMany({ where: { saleId: { in: saleIds } } });
      await tx.payment.deleteMany({ where: { saleId: { in: saleIds } } });
      await tx.saleItem.deleteMany({ where: { saleId: { in: saleIds } } });
      const { count } = await tx.sale.deleteMany({ where: { shopId: request.user.shopId } });

      await tx.activityLog.create({
        data: {
          id: crypto.randomUUID(),
          shopId: request.user.shopId,
          userId: request.user.sub,
          action: 'CLEAR_SALES_HISTORY',
          entityType: 'sale',
          entityId: 'all',
          detail: `ล้างประวัติการขายทั้งหมด ${count} รายการ`,
        },
      });

      return { count };
    });

    return { ok: true, deletedCount: count };
  });

  app.patch('/:id/refund', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = z.object({ reason: z.string().min(1).optional() }).parse(request.body ?? {});
    const sale = await prisma.sale.findFirst({ where: { id, shopId: request.user.shopId } });
    if (!sale) return reply.code(404).send({ message: 'Sale not found' });

    const updated = await prisma.sale.update({
      where: { id },
      data: {
        status: 'refunded',
        voidReason: input.reason,
        voidedByUserId: request.user.sub,
      },
    });
    await prisma.syncLog.create({
      data: { shopId: request.user.shopId, deviceId: 'api', table: 'sales', recordId: id, action: 'upsert' },
    });

    return { sale: toSaleDto(updated) };
  });
}
