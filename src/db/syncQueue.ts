import { db } from './database';
import type { SyncQueueItem } from '../types';
import { nowIso } from '../utils/date';
import { uid } from '../utils/id';

export const SyncQueueRepository = {
  async enqueue(input: {
    tableName: string;
    recordId: string;
    action: SyncQueueItem['action'];
    payload: unknown;
  }) {
    const timestamp = nowIso();
    const item: SyncQueueItem = {
      id: uid('sync'),
      tableName: input.tableName,
      recordId: input.recordId,
      action: input.action,
      payloadJson: JSON.stringify(input.payload),
      status: 'pending',
      attempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await db.sync_queue.add(item);
    return item;
  },

  async listPending(limit = 50) {
    const pending = await db.sync_queue
      .where('status')
      .anyOf(['pending', 'failed'])
      .limit(limit)
      .toArray();
    return pending.filter((item) => item.attempts < 10);
  },

  async resetFailed() {
    const failed = await db.sync_queue.where('status').equals('failed').toArray();
    await Promise.all(
      failed.map((item) =>
        db.sync_queue.update(item.id, {
          status: 'pending',
          attempts: 0,
          lastError: undefined,
          updatedAt: nowIso(),
        }),
      ),
    );
    return failed.length;
  },

  async markSyncing(id: string) {
    await db.sync_queue.update(id, { status: 'syncing', updatedAt: nowIso() });
  },

  async markSynced(id: string) {
    await db.sync_queue.update(id, { status: 'synced', updatedAt: nowIso() });
  },

  async markFailed(id: string, error: string, attempts: number) {
    await db.sync_queue.update(id, {
      status: 'failed',
      lastError: error,
      attempts,
      updatedAt: nowIso(),
    });
  },

  // Reset items stuck in 'syncing' state (e.g. after app crash mid-push)
  async resetStuckSyncing() {
    const stuck = await db.sync_queue.where('status').equals('syncing').toArray();
    if (!stuck.length) return 0;
    await Promise.all(
      stuck.map((item) =>
        db.sync_queue.update(item.id, { status: 'pending', updatedAt: nowIso() }),
      ),
    );
    return stuck.length;
  },
};
