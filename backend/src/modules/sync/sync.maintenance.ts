import type { FastifyInstance } from 'fastify';
import { prisma } from '../../db/prisma.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Retention windows. syncLog is only needed to propagate deletes/cursors to
// other devices for a short period; activityLog is an audit trail.
const SYNC_LOG_RETENTION_DAYS = 30;
const ACTIVITY_LOG_RETENTION_DAYS = 180;

async function runPrune(app: FastifyInstance) {
  const now = Date.now();
  const syncLogCutoff = new Date(now - SYNC_LOG_RETENTION_DAYS * DAY_MS);
  const activityCutoff = new Date(now - ACTIVITY_LOG_RETENTION_DAYS * DAY_MS);

  try {
    const syncLogs = await prisma.syncLog.deleteMany({
      where: { syncedAt: { lt: syncLogCutoff } },
    });
    const activityLogs = await prisma.activityLog.deleteMany({
      where: { createdAt: { lt: activityCutoff } },
    });
    app.log.info(
      { syncLogs: syncLogs.count, activityLogs: activityLogs.count },
      'Sync maintenance prune complete',
    );
  } catch (error) {
    app.log.error({ error }, 'Sync maintenance prune failed');
  }
}

/**
 * Daily TTL prune so syncLog / activityLog don't grow unbounded (which would
 * turn every push/pull `findMany` into an ever-slower full scan).
 * Runs in all environments including production.
 */
export function scheduleSyncMaintenance(app: FastifyInstance) {
  let interval: NodeJS.Timeout | null = null;

  // First run shortly after boot, then once a day.
  const timeout = setTimeout(() => {
    void runPrune(app);
    interval = setInterval(() => void runPrune(app), DAY_MS);
  }, 60_000);

  app.addHook('onClose', async () => {
    clearTimeout(timeout);
    if (interval) clearInterval(interval);
  });
}
