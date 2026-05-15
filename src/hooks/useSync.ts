import { useCallback, useEffect, useState } from 'react';
import { hasApiBaseUrl } from '../services/api/client';
import { SyncWebSocket } from '../services/api/syncWebSocket';
import { SyncQueueRepository } from '../db/syncQueue';
import { UserRepository } from '../db/repositories/UserRepository';
import { SettingsRepository } from '../db/repositories/SettingsRepository';
import { positionSettingKey } from '../utils/permissions';
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

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
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
