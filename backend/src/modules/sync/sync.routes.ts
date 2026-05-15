import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import { toCategoryDto, toProductDto } from '../catalog/catalog.dto.js';
import { saleDetailSchema } from '../sales/sales.routes.js';
import { toSaleDetailDto } from '../sales/sales.dto.js';
import { upsertSaleDetail } from '../sales/sales.service.js';
import { wsManager } from './ws.manager.js';
import { hashPassword } from '../../utils/password.js';

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

const userPayloadSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  displayName: z.string().min(1),
  pin: z.string().length(6).regex(/^\d{6}$/),
  passwordHash: z.string().min(1).optional(),
  passwordPlain: z.string().min(1).optional(),
  role: z.string().min(1),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).refine((value) => Boolean(value.passwordHash || value.passwordPlain), {
  message: 'passwordHash or passwordPlain is required',
});

const settingPayloadSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
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

async function pushUser(shopId: string, change: z.infer<typeof pushSchema>['changes'][number]) {
  if (change.action === 'delete') {
    await prisma.user.deleteMany({ where: { id: change.recordId, shopId } });
    return;
  }

  const payload = userPayloadSchema.parse(change.payload);
  const existing = await prisma.user.findFirst({ where: { id: payload.id, shopId } });
  if (!existing && await wasDeleted(shopId, 'users', payload.id)) return;

  const effectiveUpdatedAt = clampUpdatedAt(payload.updatedAt);
  if (existing && existing.updatedAt > effectiveUpdatedAt) return;

  const passwordHash = payload.passwordHash ?? await hashPassword(payload.passwordPlain ?? '');

  await prisma.user.upsert({
    where: { id: payload.id },
    update: {
      username: payload.username.trim(),
      displayName: payload.displayName.trim(),
      pin: payload.pin.trim(),
      passwordHash,
      role: payload.role,
      isActive: payload.isActive,
      updatedAt: effectiveUpdatedAt,
    },
    create: {
      id: payload.id,
      shopId,
      username: payload.username.trim(),
      displayName: payload.displayName.trim(),
      pin: payload.pin.trim(),
      passwordHash,
      role: payload.role,
      isActive: payload.isActive,
      createdAt: new Date(payload.createdAt),
      updatedAt: effectiveUpdatedAt,
    },
  });
}

async function pushSetting(shopId: string, change: z.infer<typeof pushSchema>['changes'][number]) {
  if (change.action === 'delete') {
    await prisma.appSetting.deleteMany({ where: { shopId, key: change.recordId } });
    return;
  }

  const payload = settingPayloadSchema.parse(change.payload);
  const existing = await prisma.appSetting.findUnique({
    where: { shopId_key: { shopId, key: payload.key } },
  });
  const effectiveUpdatedAt = clampUpdatedAt(payload.updatedAt);
  if (existing && existing.updatedAt > effectiveUpdatedAt) return;

  await prisma.appSetting.upsert({
    where: { shopId_key: { shopId, key: payload.key } },
    update: { value: payload.value, updatedAt: effectiveUpdatedAt },
    create: { shopId, key: payload.key, value: payload.value, updatedAt: effectiveUpdatedAt },
  });
}

function toUserSyncDto(user: {
  id: string;
  shopId: string;
  username: string;
  displayName: string;
  pin: string;
  passwordHash: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: user.id,
    shopId: user.shopId,
    username: user.username,
    displayName: user.displayName,
    pin: user.pin,
    passwordHash: user.passwordHash,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function toSettingSyncDto(setting: {
  key: string;
  value: string;
  updatedAt: Date;
}) {
  return {
    key: setting.key,
    value: setting.value,
    updatedAt: setting.updatedAt.toISOString(),
  };
}

export async function syncRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.post('/push', async (request) => {
    const input = pushSchema.parse(request.body);
    const applied: string[] = [];
    const failed: Array<{ id?: string; recordId: string; tableName: string; message: string }> = [];

    // Process in dependency order: categories must exist before products (FK constraint)
    const TABLE_ORDER: Record<string, number> = {
      users: 0, settings: 0, categories: 1, products: 2, sales: 3,
    };
    const ordered = [...input.changes].sort(
      (a, b) => (TABLE_ORDER[a.tableName] ?? 9) - (TABLE_ORDER[b.tableName] ?? 9),
    );

    for (const change of ordered) {
      try {
        if (change.tableName === 'users') {
          await pushUser(request.user.shopId, change);
        } else if (change.tableName === 'settings') {
          await pushSetting(request.user.shopId, change);
        } else if (change.tableName === 'categories') {
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

    const [users, settings, categories, products, sales, syncLogs] = await Promise.all([
      prisma.user.findMany({
        where: { shopId: request.user.shopId, updatedAt: { gt: since } },
        orderBy: { updatedAt: 'asc' },
      }),
      prisma.appSetting.findMany({
        where: {
          shopId: request.user.shopId,
          key: { in: ['userPositions'] },
          updatedAt: { gt: since },
        },
        orderBy: { updatedAt: 'asc' },
      }),
      // Strict `gt`: rows already delivered (updatedAt == cursor) are not
      // replayed every poll. The cursor below tracks real data, not wall clock,
      // so nothing is skipped either.
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

    // Cursor = newest timestamp we actually returned (not server "now").
    // If nothing changed, echo the request cursor so the client never advances
    // past data it hasn't seen.
    const timestamps: number[] = [
      ...categories.map((c) => c.updatedAt.getTime()),
      ...users.map((u) => u.updatedAt.getTime()),
      ...settings.map((s) => s.updatedAt.getTime()),
      ...products.map((p) => p.updatedAt.getTime()),
      ...sales.map((s) => s.updatedAt.getTime()),
      ...syncLogs.map((l) => l.syncedAt.getTime()),
    ];
    const nextCursor = timestamps.length
      ? new Date(Math.max(...timestamps)).toISOString()
      : (query.since ?? new Date(0).toISOString());

    return {
      syncedAt: nextCursor,
      changes: {
        users: users.map(toUserSyncDto),
        settings: settings.map(toSettingSyncDto),
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
