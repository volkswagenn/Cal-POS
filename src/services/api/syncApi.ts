import { db } from '../../db/database';
import { SyncQueueRepository } from '../../db/syncQueue';
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

async function applyPullChanges(response: SyncPullResponse) {
  await db.transaction(
    'rw',
    [db.categories, db.products, db.sales, db.sale_items, db.payments, db.discount_logs],
    async () => {
      if (response.changes.categories.length) {
        await db.categories.bulkPut(response.changes.categories);
      }

      if (response.changes.products.length) {
        await db.products.bulkPut(response.changes.products);
      }

      for (const detail of response.changes.sales) {
        await db.sales.put(detail.sale);
        if (detail.items.length) await db.sale_items.bulkPut(detail.items);
        if (detail.payments.length) await db.payments.bulkPut(detail.payments);
        if (detail.discounts.length) await db.discount_logs.bulkPut(detail.discounts);
      }

      for (const item of response.changes.deletes) {
        if (item.tableName === 'categories') await db.categories.delete(item.recordId);
        if (item.tableName === 'products') await db.products.delete(item.recordId);
        if (item.tableName === 'sales') {
          await db.sales.delete(item.recordId);
          await db.sale_items.where('saleId').equals(item.recordId).delete();
          await db.payments.where('saleId').equals(item.recordId).delete();
          await db.discount_logs.where('saleId').equals(item.recordId).delete();
        }
      }
    },
  );
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

  async pullLatest() {
    if (!hasApiBaseUrl || !navigator.onLine) return null;

    const since = localStorage.getItem(LAST_SYNC_KEY);
    const query = since ? `?since=${encodeURIComponent(since)}` : '';
    const response = await apiRequest<SyncPullResponse>(`/api/sync/pull${query}`);
    await applyPullChanges(response);
    localStorage.setItem(LAST_SYNC_KEY, response.syncedAt);
    return response;
  },

  async syncNow() {
    await this.pushPending();
    return this.pullLatest();
  },
};
