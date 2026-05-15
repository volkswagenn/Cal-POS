import { useCallback, useEffect, useRef, useState } from 'react';
import { hasApiBaseUrl } from '../services/api/client';
import { syncApi } from '../services/api/syncApi';
import { SyncWebSocket } from '../services/api/syncWebSocket';
import { SyncQueueRepository } from '../db/syncQueue';

export type SyncState = {
  isOnline: boolean;
  canSync: boolean;
  isSyncing: boolean;
  lastSyncError: string | null;
  conflictWarning: string | null;
  syncNow: () => Promise<void>;
  forceSync: () => Promise<void>;
};

export function useSync(): SyncState {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [canSync, setCanSync] = useState(() => navigator.onLine && hasApiBaseUrl);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const isSyncingRef = useRef(false);

  const runSync = useCallback(async (fullSync: boolean) => {
    if (!navigator.onLine || !hasApiBaseUrl || isSyncingRef.current) return;

    isSyncingRef.current = true;
    setIsSyncing(true);
    setLastSyncError(null);
    try {
      const result = fullSync
        ? await syncApi.forceFullSync()
        : await syncApi.syncNow();

      if (result?.conflicts.length) {
        const names = result.conflicts.slice(0, 3).join(', ');
        const extra = result.conflicts.length > 3 ? ` และอีก ${result.conflicts.length - 3} รายการ` : '';
        setConflictWarning(`ข้อมูลถูกอัปเดตจากเครื่องอื่น: ${names}${extra}`);
      }
    } catch (error) {
      setLastSyncError(error instanceof Error ? error.message : 'Sync failed');
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, []);

  const syncNow = useCallback(() => runSync(false), [runSync]);
  const forceSync = useCallback(() => runSync(true), [runSync]);

  useEffect(() => {
    if (!hasApiBaseUrl) return;

    // Fix: reset items stuck in 'syncing' state from a previous crash
    void SyncQueueRepository.resetStuckSyncing();

    const wsClient = new SyncWebSocket({ onChanges: () => void syncNow() });

    const handleOnline = () => {
      setIsOnline(true);
      setCanSync(true);
      wsClient.connect();
      void syncNow();
    };

    const handleOffline = () => {
      setIsOnline(false);
      setCanSync(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if (navigator.onLine) {
      wsClient.connect();
      void syncNow();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      wsClient.destroy();
    };
  }, [syncNow]);

  return { isOnline, canSync, isSyncing, lastSyncError, conflictWarning, syncNow, forceSync };
}
