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
  syncNow: () => void;
  forceSync: () => void;
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

    // Fallback poll — runs ONLY while the WebSocket is down. When WS is
    // connected, real-time push handles everything and we never poll, so the
    // app doesn't hammer the API during long sessions (the freeze cause).
    let fallbackPollId: ReturnType<typeof setInterval> | null = null;
    const FALLBACK_POLL_MS = 30_000;

    const startFallbackPoll = () => {
      if (fallbackPollId !== null) return;
      fallbackPollId = setInterval(() => {
        if (navigator.onLine && !wsClient.isConnected()) requestSync();
      }, FALLBACK_POLL_MS);
    };
    const stopFallbackPoll = () => {
      if (fallbackPollId !== null) {
        clearInterval(fallbackPollId);
        fallbackPollId = null;
      }
    };

    // Auto-recover dead/failed sync items. Cheap: only counts the indexed
    // 'dead' rows; an API call happens only when there's actually something
    // stuck. Replaces the manual "Reset & Force Sync" button.
    const retryDeadLetters = async () => {
      const dead = await SyncQueueRepository.countDead();
      if (dead > 0) {
        await SyncQueueRepository.resetFailed();
        requestSync({ immediate: true });
      }
    };

    const wsClient = new SyncWebSocket({
      onChanges: () => requestSync(),
      // Fresh connect OR reconnect → pull anything missed while down and
      // revive stuck items, then stop the fallback poll.
      onConnected: () => {
        stopFallbackPoll();
        requestSync({ immediate: true });
        void retryDeadLetters();
      },
      // Socket dropped → start the low-frequency safety poll until it's back.
      onDisconnected: () => startFallbackPoll(),
    });

    const handleOnline = () => {
      setIsOnline(true);
      setCanSync(true);
      wsClient.connect();
      requestSync({ immediate: true });
    };

    const handleOffline = () => {
      setIsOnline(false);
      setCanSync(false);
      stopFallbackPoll();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if (navigator.onLine) {
      wsClient.connect();
      requestSync({ immediate: true });
      // Until the socket's onopen fires, poll as a safety net.
      startFallbackPoll();
    }

    // Low-frequency dead-letter safety net (every 5 min). The check is a
    // cheap indexed count — no API traffic unless items are actually stuck.
    const deadLetterId = window.setInterval(() => {
      if (navigator.onLine) void retryDeadLetters();
    }, 5 * 60_000);

    // Tab becomes visible again → only sync if WS is down (otherwise the
    // socket already kept us current; no need to spend an API call).
    const handleVisibilityChange = () => {
      if (!document.hidden && navigator.onLine && !wsClient.isConnected()) {
        requestSync({ immediate: true });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopFallbackPoll();
      window.clearInterval(deadLetterId);
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
    syncNow,
    forceSync,
  };
}
