import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { createBackupSnapshot } from './backup.service.js';

const dayMs = 24 * 60 * 60 * 1000;

function msUntilNextTwoAm() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(2, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

async function runAutoBackup(app: FastifyInstance) {
  const shops = await prisma.shop.findMany({ select: { id: true } });
  for (const shop of shops) {
    try {
      await createBackupSnapshot(shop.id, 'system-cron');
    } catch (error) {
      app.log.error({ error, shopId: shop.id }, 'Auto backup failed');
    }
  }
}

export function scheduleAutoBackup(app: FastifyInstance) {
  if (env.isProd) return;
  if (!env.autoBackupEnabled) return;

  let interval: NodeJS.Timeout | null = null;
  const timeout = setTimeout(() => {
    void runAutoBackup(app);
    interval = setInterval(() => void runAutoBackup(app), dayMs);
  }, msUntilNextTwoAm());

  app.addHook('onClose', async () => {
    clearTimeout(timeout);
    if (interval) clearInterval(interval);
  });
}
