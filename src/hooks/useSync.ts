import { useEffect, useState } from 'react';
import { hasApiBaseUrl } from '../services/api/client';
import { syncApi } from '../services/api/syncApi';

export function useSync() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [canSync, setCanSync] = useState(() => navigator.onLine && hasApiBaseUrl);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);

  const syncNow = async () => {
    if (!navigator.onLine || !hasApiBaseUrl || isSyncing) return;

    setIsSyncing(true);
    setLastSyncError(null);
    try {
      await syncApi.syncNow();
    } catch (error) {
      setLastSyncError(error instanceof Error ? error.message : 'Sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    const update = () => {
      setIsOnline(navigator.onLine);
      setCanSync(navigator.onLine && hasApiBaseUrl);
      if (navigator.onLine && hasApiBaseUrl) {
        void syncNow();
      }
    };

    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    if (navigator.onLine && hasApiBaseUrl) {
      void syncNow();
    }

    const timer = window.setInterval(() => {
      if (navigator.onLine && hasApiBaseUrl) void syncNow();
    }, 30_000);

    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      window.clearInterval(timer);
    };
  }, [isSyncing]);

  return {
    isOnline,
    canSync,
    isSyncing,
    lastSyncError,
    syncNow,
  };
}
