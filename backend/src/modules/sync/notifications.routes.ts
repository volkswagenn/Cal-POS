import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireAuth } from '../../middleware/auth.js';

/**
 * Cross-device activity / notification feed.
 *
 * IMPORTANT: This module is intentionally SEPARATE from sync.routes.ts and only
 * READS the SyncLog table (written by the existing /push handler). It never
 * touches /push, /pull, the sync cursor, clampUpdatedAt, or applyPullChanges,
 * so sales / bill-history / dashboard sync is completely unaffected.
 */

const registerSchema = z.object({
  deviceId: z.string().min(1),
  code: z.string().min(1).max(12),
});

const activityQuerySchema = z.object({
  since: z.string().datetime().optional(),
  deviceId: z.string().optional(), // caller's own id — excluded from the feed
  limit: z.coerce.number().int().min(1).max(200).default(80),
});

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // Register / refresh this device's human-readable code ("POS1").
  app.post('/device', async (request) => {
    const { deviceId, code } = registerSchema.parse(request.body);
    const shopId = request.user.shopId;
    await prisma.device.upsert({
      where: { deviceId },
      update: { code, shopId },
      create: { deviceId, code, shopId },
    });
    return { ok: true };
  });

  // Recent cross-device activity, aggregated so a bulk operation (e.g. a
  // 120-product reorder) shows as ONE line, not 120 notifications.
  app.get('/activity', async (request) => {
    const query = activityQuerySchema.parse(request.query);
    const shopId = request.user.shopId;
    const since = query.since ? new Date(query.since) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const logs = await prisma.syncLog.findMany({
      where: {
        shopId,
        syncedAt: { gt: since },
        ...(query.deviceId ? { deviceId: { not: query.deviceId } } : {}),
      },
      orderBy: { syncedAt: 'desc' },
      take: 1000, // cap raw scan; aggregated below
    });

    const devices = await prisma.device.findMany({ where: { shopId } });
    const codeByDevice = new Map(devices.map((d) => [d.deviceId, d.code]));

    // Group by device + table + action, bucketed to the minute so a burst of
    // writes collapses into a single notification line.
    const groups = new Map<string, {
      deviceId: string;
      deviceCode: string;
      table: string;
      action: string;
      count: number;
      lastAt: string;
    }>();

    for (const log of logs) {
      const bucket = log.syncedAt.toISOString().slice(0, 16); // yyyy-MM-ddTHH:mm
      const key = `${log.deviceId}|${log.table}|${log.action}|${bucket}`;
      const existing = groups.get(key);
      if (existing) {
        existing.count += 1;
        if (log.syncedAt.toISOString() > existing.lastAt) existing.lastAt = log.syncedAt.toISOString();
      } else {
        groups.set(key, {
          deviceId: log.deviceId,
          deviceCode: codeByDevice.get(log.deviceId) ?? `เครื่อง #${log.deviceId.slice(-4)}`,
          table: log.table,
          action: log.action,
          count: 1,
          lastAt: log.syncedAt.toISOString(),
        });
      }
    }

    const items = [...groups.values()]
      .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1))
      .slice(0, query.limit);

    return { items, serverTime: new Date().toISOString() };
  });
}
