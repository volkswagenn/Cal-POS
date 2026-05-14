import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import { toCategoryDto, toProductDto } from '../catalog/catalog.dto.js';
import { saleDetailSchema } from '../sales/sales.routes.js';
import { toSaleDetailDto } from '../sales/sales.dto.js';
import { upsertSaleDetail } from '../sales/sales.service.js';

const categoryPayloadSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.string().min(1),
  icon: z.string().optional(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const productPayloadSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  displayName: z.string().min(1),
  price: z.number().nonnegative(),
  categoryId: z.string().min(1),
  color: z.string().min(1),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  isOpenPrice: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const pushSchema = z.object({
  deviceId: z.string().min(1).default('unknown-device'),
  changes: z.array(z.object({
    id: z.string().min(1).optional(),
    tableName: z.string().min(1),
    recordId: z.string().min(1),
    action: z.enum(['upsert', 'delete']),
    payload: z.unknown().optional(),
  })),
});

async function pushCategory(shopId: string, change: z.infer<typeof pushSchema>['changes'][number]) {
  if (change.action === 'delete') {
    await prisma.category.deleteMany({ where: { id: change.recordId, shopId } });
    return;
  }

  const payload = categoryPayloadSchema.parse(change.payload);
  const existing = await prisma.category.findFirst({ where: { id: payload.id, shopId } });
  if (existing && existing.updatedAt > new Date(payload.updatedAt)) return;

  await prisma.category.upsert({
    where: { id: payload.id },
    update: {
      name: payload.name,
      color: payload.color,
      icon: payload.icon,
      sortOrder: payload.sortOrder,
      isActive: payload.isActive,
      updatedAt: new Date(payload.updatedAt),
    },
    create: {
      id: payload.id,
      shopId,
      name: payload.name,
      color: payload.color,
      icon: payload.icon,
      sortOrder: payload.sortOrder,
      isActive: payload.isActive,
      createdAt: new Date(payload.createdAt),
      updatedAt: new Date(payload.updatedAt),
    },
  });
}

async function pushProduct(shopId: string, change: z.infer<typeof pushSchema>['changes'][number]) {
  if (change.action === 'delete') {
    await prisma.product.deleteMany({ where: { id: change.recordId, shopId } });
    return;
  }

  const payload = productPayloadSchema.parse(change.payload);
  const existing = await prisma.product.findFirst({ where: { id: payload.id, shopId } });
  if (existing && existing.updatedAt > new Date(payload.updatedAt)) return;

  await prisma.product.upsert({
    where: { id: payload.id },
    update: {
      categoryId: payload.categoryId,
      name: payload.name,
      displayName: payload.displayName,
      price: payload.price,
      color: payload.color,
      sortOrder: payload.sortOrder,
      isActive: payload.isActive,
      isOpenPrice: payload.isOpenPrice,
      updatedAt: new Date(payload.updatedAt),
    },
    create: {
      id: payload.id,
      shopId,
      categoryId: payload.categoryId,
      name: payload.name,
      displayName: payload.displayName,
      price: payload.price,
      color: payload.color,
      sortOrder: payload.sortOrder,
      isActive: payload.isActive,
      isOpenPrice: payload.isOpenPrice,
      createdAt: new Date(payload.createdAt),
      updatedAt: new Date(payload.updatedAt),
    },
  });
}

export async function syncRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.post('/push', async (request) => {
    const input = pushSchema.parse(request.body);
    const applied: string[] = [];
    const failed: Array<{ id?: string; recordId: string; tableName: string; message: string }> = [];

    for (const change of input.changes) {
      try {
        if (change.tableName === 'categories') {
          await pushCategory(request.user.shopId, change);
        } else if (change.tableName === 'products') {
          await pushProduct(request.user.shopId, change);
        } else if (change.tableName === 'sales') {
          if (change.action === 'delete') {
            await prisma.sale.deleteMany({ where: { id: change.recordId, shopId: request.user.shopId } });
          } else {
            await upsertSaleDetail(request.user.shopId, saleDetailSchema.parse(change.payload));
          }
        } else {
          throw new Error(`Unsupported sync table: ${change.tableName}`);
        }

        await prisma.syncLog.create({
          data: {
            shopId: request.user.shopId,
            deviceId: input.deviceId,
            table: change.tableName,
            recordId: change.recordId,
            action: change.action,
          },
        });
        applied.push(change.id ?? change.recordId);
      } catch (error) {
        failed.push({
          id: change.id,
          recordId: change.recordId,
          tableName: change.tableName,
          message: error instanceof Error ? error.message : 'Sync failed',
        });
      }
    }

    return {
      ok: failed.length === 0,
      applied,
      failed,
      syncedAt: new Date().toISOString(),
    };
  });

  app.get('/pull', async (request) => {
    const query = z.object({
      since: z.string().datetime().optional(),
    }).parse(request.query);
    const since = query.since ? new Date(query.since) : new Date(0);

    const [categories, products, sales, syncLogs] = await Promise.all([
      prisma.category.findMany({
        where: { shopId: request.user.shopId, updatedAt: { gt: since } },
        orderBy: { updatedAt: 'asc' },
      }),
      prisma.product.findMany({
        where: { shopId: request.user.shopId, updatedAt: { gt: since } },
        orderBy: { updatedAt: 'asc' },
      }),
      prisma.sale.findMany({
        where: { shopId: request.user.shopId, updatedAt: { gt: since } },
        include: { items: true, payments: true, discounts: true },
        orderBy: { updatedAt: 'asc' },
      }),
      prisma.syncLog.findMany({
        where: { shopId: request.user.shopId, syncedAt: { gt: since }, action: 'delete' },
        orderBy: { syncedAt: 'asc' },
      }),
    ]);

    return {
      syncedAt: new Date().toISOString(),
      changes: {
        categories: categories.map(toCategoryDto),
        products: products.map(toProductDto),
        sales: sales.map(toSaleDetailDto),
        deletes: syncLogs.map((log) => ({
          tableName: log.table,
          recordId: log.recordId,
          syncedAt: log.syncedAt.toISOString(),
        })),
      },
    };
  });

  app.get('/status', async (request) => {
    const latest = await prisma.syncLog.findFirst({
      where: { shopId: request.user.shopId },
      orderBy: { syncedAt: 'desc' },
    });

    return {
      shopId: request.user.shopId,
      lastSyncedAt: latest?.syncedAt.toISOString() ?? null,
      lastDeviceId: latest?.deviceId ?? null,
    };
  });
}
