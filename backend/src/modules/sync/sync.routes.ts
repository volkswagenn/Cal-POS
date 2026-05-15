import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import { toCategoryDto, toProductDto } from '../catalog/catalog.dto.js';
import { saleDetailSchema } from '../sales/sales.routes.js';
import { toSaleDetailDto } from '../sales/sales.dto.js';
import { upsertSaleDetail } from '../sales/sales.service.js';
import { wsManager } from './ws.manager.js';

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000; // 5 minutes tolerance

function clampUpdatedAt(isoString: string): Date {
  const clientTime = new Date(isoString);
  const serverNow = new Date();
  // If client clock is more than 5 minutes ahead, use server time to prevent "always wins" skew
  return clientTime.getTime() > serverNow.getTime() + MAX_CLOCK_SKEW_MS ? serverNow : clientTime;
}

async function wasDeleted(shopId: string, table: string, recordId: string): Promise<boolean> {
  const log = await prisma.syncLog.findFirst({
    where: { shopId, table, recordId, action: 'delete' },
  });
  return log !== null;
}

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

  // Fix: delete-edit conflict — don't resurrect a deleted category
  const existing = await prisma.category.findFirst({ where: { id: payload.id, shopId } });
  if (!existing && await wasDeleted(shopId, 'categories', payload.id)) return;

  // Fix: clock skew — use server time if client clock is far ahead
  const effectiveUpdatedAt = clampUpdatedAt(payload.updatedAt);

  if (existing && existing.updatedAt > effectiveUpdatedAt) return;

  await prisma.category.upsert({
    where: { id: payload.id },
    update: {
      name: payload.name,
      color: payload.color,
      icon: payload.icon,
      sortOrder: payload.sortOrder,
      isActive: payload.isActive,
      updatedAt: effectiveUpdatedAt,
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
      updatedAt: effectiveUpdatedAt,
    },
  });
}

async function pushProduct(shopId: string, change: z.infer<typeof pushSchema>['changes'][number]) {
  if (change.action === 'delete') {
    await prisma.product.deleteMany({ where: { id: change.recordId, shopId } });
    return;
  }

  const payload = productPayloadSchema.parse(change.payload);

  // Fix: delete-edit conflict — don't resurrect a deleted product
  const existing = await prisma.product.findFirst({ where: { id: payload.id, shopId } });
  if (!existing && await wasDeleted(shopId, 'products', payload.id)) return;

  // Fix: clock skew — use server time if client clock is far ahead
  const effectiveUpdatedAt = clampUpdatedAt(payload.updatedAt);

  if (existing && existing.updatedAt > effectiveUpdatedAt) return;

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
      updatedAt: effectiveUpdatedAt,
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
      updatedAt: effectiveUpdatedAt,
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

    const syncedAt = new Date().toISOString();

    if (applied.length > 0) {
      wsManager.notify(request.user.shopId, input.deviceId, syncedAt);
    }

    return {
      ok: failed.length === 0,
      applied,
      failed,
      syncedAt,
    };
  });

  app.get('/pull', async (request) => {
    const query = z.object({
      since: z.string().datetime().optional(),
    }).parse(request.query);
    const since = query.since ? new Date(query.since) : new Date(0);

    const [categories, products, sales, syncLogs] = await Promise.all([
      // Fix: gte instead of gt to avoid missing records on timestamp boundary
      prisma.category.findMany({
        where: { shopId: request.user.shopId, updatedAt: { gte: since } },
        orderBy: { updatedAt: 'asc' },
      }),
      prisma.product.findMany({
        where: { shopId: request.user.shopId, updatedAt: { gte: since } },
        orderBy: { updatedAt: 'asc' },
      }),
      prisma.sale.findMany({
        where: { shopId: request.user.shopId, updatedAt: { gte: since } },
        include: { items: true, payments: true, discounts: true },
        orderBy: { updatedAt: 'asc' },
      }),
      prisma.syncLog.findMany({
        where: { shopId: request.user.shopId, syncedAt: { gte: since }, action: 'delete' },
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
