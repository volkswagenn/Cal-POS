import { db } from './database';
import type { SyncQueueItem } from '../types';
import { nowIso } from '../utils/date';
import { uid } from '../utils/id';
import { emitLocalChange } from '../services/api/syncSignal';

// After this many failed attempts an item is moved to the 'dead' state instead
// of being silently skipped. Dead items are surfaced to the user (banner) and
// can be retried manually — they are NEVER discarded, so no sale is ever lost.
const MAX_ATTEMPTS = 10;

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
    // Wake the sync scheduler so this change is pushed to the cloud now
    // (debounced + single-flighted on the scheduler side).
    emitLocalChange();
    return item;
  },

  async listPending(limit = 50) {
    return db.sync_queue
      .where('status')
      .anyOf(['pending', 'failed'])
      .limit(limit)
      .toArray();
  },

  async markSyncing(id: string) {
    await db.sync_queue.update(id, { status: 'syncing', updatedAt: nowIso() });
  },

  async markSynced(id: string) {
    await db.sync_queue.update(id, { status: 'synced', updatedAt: nowIso() });
  },

  async markFailed(id: string, error: string, attempts: number) {
    await db.sync_queue.update(id, {
      // Promote to dead-letter once attempts are exhausted so listPending
      // stops retrying it forever, but the row (and its payload) is kept.
      status: attempts >= MAX_ATTEMPTS ? 'dead' : 'failed',
      lastError: error,
      attempts,
      updatedAt: nowIso(),
    });
  },

  async countDead() {
    return db.sync_queue.where('status').equals('dead').count();
  },

  async listDead() {
    return db.sync_queue.where('status').equals('dead').toArray();
  },

  // Revive failed + dead items for another attempt (manual retry from UI).
  async resetFailed() {
    const stuck = await db.sync_queue.where('status').anyOf(['failed', 'dead']).toArray();
    await Promise.all(
      stuck.map((item) =>
        db.sync_queue.update(item.id, {
          status: 'pending',
          attempts: 0,
          lastError: undefined,
          updatedAt: nowIso(),
        }),
      ),
    );
    return stuck.length;
  },

  // Reset items stuck in 'syncing' state (e.g. after app crash mid-push).
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

  // Drop confirmed-synced rows so IndexedDB doesn't grow without bound.
  async pruneSynced() {
    return db.sync_queue.where('status').equals('synced').delete();
  },
};
