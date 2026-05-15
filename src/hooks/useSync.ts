import { useCallback, useEffect, useState } from 'react';
import { hasApiBaseUrl } from '../services/api/client';
import { SyncWebSocket } from '../services/api/syncWebSocket';
import { SyncQueueRepository } from '../db/syncQueue';
import { UserRepository } from '../db/repositories/UserRepository';
import { SettingsRepository } from '../db/repositories/SettingsRepository';
import { positionSettingKey } from '../utils/permissions';
import { CategoryRepository } from '../db/repositories/CategoryRepository';
import { ProductRepository } from '../db/repositories/ProductRepository';
import {
  cancelScheduledSync,
  requestSync,
  subscribeSync,
  type SchedulerState,
} from '../services/api/syncScheduler';

export type SyncState = {
  isOnline: boolean;
  canSync: boolean;
  isSyncing: boolean;
  lastSyncError: string | null;
  conflictWarning: string | null;
  deadLetterCount: number;
  lastSyncedAt: string | null;
  syncNow: () => void;
  forceSync: () => void;
  /** Reset all dead/failed items back to pending, then do a full re-pull from server. */
  resetAndForceSync: () => Promise<void>;
};

export function useSync(): SyncState {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [canSync, setCanSync] = useState(() => navigator.onLine && hasApiBaseUrl);
  const [scheduler, setScheduler] = useState<SchedulerState>({
    isSyncing: false,
    lastSyncError: null,
    lastConflicts: [],
    lastSyncedAt: null,
  });
  const [deadLetterCount, setDeadLetterCount] = useState(0);

  const syncNow = useCallback(() => requestSync(), []);
  const forceSync = useCallback(() => requestSync({ full: true, immediate: true }), []);
  const resetAndForceSync = useCallback(async () => {
    await SyncQueueRepository.resetFailed();
    requestSync({ full: true, immediate: true });
  }, []);

  // Subscribe to the module-level scheduler (single source of truth).
  useEffect(() => subscribeSync(setScheduler), []);

  // Poll dead-letter count (cheap indexed count) so the UI can warn the user
  // that some records permanently failed to sync instead of silently losing them.
  useEffect(() => {
    if (!hasApiBaseUrl) return;
    let active = true;
    const refresh = () => {
      void SyncQueueRepository.countDead().then((n) => {
        if (active) setDeadLetterCount(n);
      });
    };
    refresh();
    const id = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [scheduler.lastSyncedAt, scheduler.lastSyncError]);

  useEffect(() => {
    if (!hasApiBaseUrl) return;

    // Recover items stuck in 'syncing' from a previous crash/refresh.
    void SyncQueueRepository.resetStuckSyncing();
    void UserRepository.backfillUsersForSync();
    void SettingsRepository.backfillSettingsForSync([positionSettingKey]);
    // Push categories first (FK parent), then products (FK child).
    // Ensures existing seed/pre-sync data reaches the cloud so product FK never fails.
    void CategoryRepository.backfillCategoriesForSync()
      .then(() => ProductRepository.backfillProductsForSync());

    const wsClient = new SyncWebSocket({ onChanges: () => requestSync() });

    const handleOnline = () => {
      setIsOnline(true);
      setCanSync(true);
      wsClient.connect();
      requestSync({ immediate: true });
    };

    const handleOffline = () => {
      setIsOnline(false);
      setCanSync(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if (navigator.onLine) {
      wsClient.connect();
      requestSync({ immediate: true });
    }

    // Periodic fallback: sync every 60s in case WebSocket drops.
    // Keeps positions, products, and users current even without WS notifications.
    const periodicId = window.setInterval(() => {
      if (navigator.onLine) requestSync();
    }, 60_000);

    // Tab becomes visible again (user switches back) → sync immediately
    const handleVisibilityChange = () => {
      if (!document.hidden && navigator.onLine) requestSync({ immediate: true });
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(periodicId);
      wsClient.destroy();
      cancelScheduledSync();
    };
  }, []);

  const conflictWarning = scheduler.lastConflicts.length
    ? (() => {
        const names = scheduler.lastConflicts.slice(0, 3).join(', ');
        const extra = scheduler.lastConflicts.length > 3
          ? ` และอีก ${scheduler.lastConflicts.length - 3} รายการ`
          : '';
        return `ข้อมูลถูกอัปเดตจากเครื่องอื่น: ${names}${extra}`;
      })()
    : null;

  return {
    isOnline,
    canSync,
    isSyncing: scheduler.isSyncing,
    lastSyncError: scheduler.lastSyncError,
    conflictWarning,
    deadLetterCount,
    lastSyncedAt: scheduler.lastSyncedAt,
    syncNow,
    forceSync,
    resetAndForceSync,
  };
}
