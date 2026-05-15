import { useEffect, useRef, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { seedDatabase } from '../db/seed';
import { CatalogDefaultRepository } from '../db/repositories/CatalogDefaultRepository';
import { ToastProvider, useToast } from '../components/common/Toast';
import { syncMirrorModeToBody } from '../stores/mirrorStore';
import { useSync } from '../hooks/useSync';

// Runs inside ToastProvider so it can call useToast()
function SyncManager() {
  const toast = useToast();
  const { conflictWarning } = useSync();
  const lastWarning = useRef<string | null>(null);

  useEffect(() => {
    if (conflictWarning && conflictWarning !== lastWarning.current) {
      lastWarning.current = conflictWarning;
      toast(conflictWarning, 'info');
    }
  }, [conflictWarning, toast]);

  return null;
}

export function AppProviders() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    syncMirrorModeToBody();
    seedDatabase()
      .then(() => CatalogDefaultRepository.ensureProductNameBahtDefault())
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-700">กำลังเตรียมฐานข้อมูล...</div>;
  }

  return (
    <ToastProvider>
      <SyncManager />
      <RouterProvider router={router} />
    </ToastProvider>
  );
}
