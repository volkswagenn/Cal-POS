import { db } from '../../db/database';
import { SyncQueueRepository } from '../../db/syncQueue';
import { nowIso } from '../../utils/date';
import type { Category, Product, SaleDetail, SyncQueueItem } from '../../types';
import { apiRequest, hasApiBaseUrl } from './client';

const LAST_SYNC_KEY = 'calpos_last_sync_at';
const DEVICE_ID_KEY = 'calpos_device_id';

type SyncPullResponse = {
  syncedAt: string;
  changes: {
    categories: Category[];
    products: Product[];
    sales: SaleDetail[];
    deletes: Array<{ tableName: string; recordId: string; syncedAt: string }>;
  };
};

export type PullResult = {
  syncedAt: string;
  // Names of local records overridden by a newer cloud version (last-write-wins lost)
  conflicts: string[];
};

function getDeviceId() {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const next = crypto.randomUUID ? crypto.randomUUID() : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(DEVICE_ID_KEY, next);
  return next;
}

function parsePayload(item: SyncQueueItem) {
  if (!item.payloadJson) return undefined;
  return JSON.parse(item.payloadJson);
}

async function detectConflictsAndCleanQueue(
  response: SyncPullResponse,
): Promise<string[]> {
  const pending = await db.sync_queue
    .where('status')
    .anyOf(['pending', 'failed', 'syncing'])
    .toArray();

  if (!pending.length) return [];

  const pendingByRecord = new Map(pending.map((item) => [item.recordId, item]));
  const conflicts: string[] = [];
  const staleIds: string[] = [];

  const checkRecord = (recordId: string, displayName: string, pulledUpdatedAt: string) => {
    const queued = pendingByRecord.get(recordId);
    if (!queued) return;

    try {
      const payload = JSON.parse(queued.payloadJson ?? '{}') as { updatedAt?: string };
      const queuedAt = payload.updatedAt ? new Date(payload.updatedAt) : null;
      // Cloud version is same age or newer → our pending edit lost
      if (!queuedAt || new Date(pulledUpdatedAt) >= queuedAt) {
        conflicts.push(displayName);
        staleIds.push(queued.id);
      }
    } catch {
      // unparseable payload — treat as stale to be safe
      staleIds.push(queued.id);
    }
  };

  for (const cat of response.changes.categories) {
    checkRecord(cat.id, `หมวดหมู่ "${cat.name}"`, cat.updatedAt);
  }
  for (const prod of response.changes.products) {
    checkRecord(prod.id, `สินค้า "${prod.name}"`, prod.updatedAt);
  }

  if (staleIds.length > 0) {
    await Promise.all(staleIds.map((id) => SyncQueueRepository.markSynced(id)));
  }

  return conflicts;
}

/**
 * Returns true if `incoming` should overwrite `local` (local missing, or the
 * incoming row is strictly newer). Makes pull application idempotent so a
 * replayed boundary row is a no-op — no Dexie write, no re-render feedback loop.
 */
function isNewer(incomingUpdatedAt: string | undefined, localUpdatedAt: string | undefined) {
  if (!localUpdatedAt) return true;
  if (!incomingUpdatedAt) return false;
  return new Date(incomingUpdatedAt).getTime() > new Date(localUpdatedAt).getTime();
}

async function applyPullChanges(response: SyncPullResponse): Promise<boolean> {
  const { categories, products, sales, deletes } = response.changes;
  if (!categories.length && !products.length && !sales.length && !deletes.length) {
    return false;
  }

  let mutated = false;

  await db.transaction(
    'rw',
    [db.categories, db.products, db.sales, db.sale_items, db.payments, db.discount_logs],
    async () => {
      if (categories.length) {
        const existing = new Map(
          (await db.categories.bulkGet(categories.map((c) => c.id)))
            .filter(Boolean)
            .map((c) => [c!.id, c!.updatedAt]),
        );
        const fresh = categories.filter((c) => isNewer(c.updatedAt, existing.get(c.id)));
        if (fresh.length) {
          await db.categories.bulkPut(fresh);
          mutated = true;
        }
      }

      if (products.length) {
        const existing = new Map(
          (await db.products.bulkGet(products.map((p) => p.id)))
            .filter(Boolean)
            .map((p) => [p!.id, p!.updatedAt]),
        );
        const fresh = products.filter((p) => isNewer(p.updatedAt, existing.get(p.id)));
        if (fresh.length) {
          await db.products.bulkPut(fresh);
          mutated = true;
        }
      }

      for (const detail of sales) {
        const local = await db.sales.get(detail.sale.id);
        if (!isNewer(detail.sale.updatedAt, local?.updatedAt)) continue;
        await db.sales.put(detail.sale);
        if (detail.items.length) await db.sale_items.bulkPut(detail.items);
        if (detail.payments.length) await db.payments.bulkPut(detail.payments);
        if (detail.discounts.length) await db.discount_logs.bulkPut(detail.discounts);
        mutated = true;
      }

      for (const item of deletes) {
        if (item.tableName === 'categories') await db.categories.delete(item.recordId);
        if (item.tableName === 'products') await db.products.delete(item.recordId);
        if (item.tableName === 'sales') {
          await db.sales.delete(item.recordId);
          await db.sale_items.where('saleId').equals(item.recordId).delete();
          await db.payments.where('saleId').equals(item.recordId).delete();
          await db.discount_logs.where('saleId').equals(item.recordId).delete();
        }
        mutated = true;
      }
    },
  );

  return mutated;
}

export const syncApi = {
  async pushPending() {
    if (!hasApiBaseUrl || !navigator.onLine) return { ok: false, skipped: true };

    const pending = await SyncQueueRepository.listPending(50);
    if (!pending.length) return { ok: true, skipped: false };

    await Promise.all(pending.map((item) => SyncQueueRepository.markSyncing(item.id)));

    try {
      const response = await apiRequest<{
        ok: boolean;
        applied: string[];
        failed: Array<{ id?: string; recordId: string; message: string }>;
        syncedAt: string;
      }>('/api/sync/push', {
        method: 'POST',
        body: JSON.stringify({
          deviceId: getDeviceId(),
          changes: pending.map((item) => ({
            id: item.id,
            tableName: item.tableName,
            recordId: item.recordId,
            action: item.action,
            payload: parsePayload(item),
          })),
        }),
      });

      const failedById = new Map(response.failed.map((item) => [item.id ?? item.recordId, item.message]));

      await Promise.all(pending.map((item) => {
        const error = failedById.get(item.id) ?? failedById.get(item.recordId);
        return error
          ? SyncQueueRepository.markFailed(item.id, error, item.attempts + 1)
          : SyncQueueRepository.markSynced(item.id);
      }));

      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed';
      await Promise.all(pending.map((item) => SyncQueueRepository.markFailed(item.id, message, item.attempts + 1)));
      throw error;
    }
  },

  async pullLatest(): Promise<PullResult | null> {
    if (!hasApiBaseUrl || !navigator.onLine) return null;

    const since = localStorage.getItem(LAST_SYNC_KEY);
    const query = since ? `?since=${encodeURIComponent(since)}` : '';
    const response = await apiRequest<SyncPullResponse>(`/api/sync/pull${query}`);

    // Detect conflicts before applying (pull overwrites local pending edits)
    const conflicts = await detectConflictsAndCleanQueue(response);
    await applyPullChanges(response);
    localStorage.setItem(LAST_SYNC_KEY, response.syncedAt);

    // Keep the local queue from growing forever once items are confirmed.
    await SyncQueueRepository.pruneSynced();

    return { syncedAt: response.syncedAt, conflicts };
  },

  async syncNow(): Promise<PullResult | null> {
    await this.pushPending();
    return this.pullLatest();
  },

  // Full re-sync from cloud (clears since-timestamp, re-fetches everything)
  async forceFullSync(): Promise<PullResult | null> {
    localStorage.removeItem(LAST_SYNC_KEY);
    return this.syncNow();
  },
};
