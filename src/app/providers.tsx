import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { seedDatabase } from '../db/seed';
import { CatalogDefaultRepository } from '../db/repositories/CatalogDefaultRepository';
import { ToastProvider } from '../components/common/Toast';
import { syncMirrorModeToBody } from '../stores/mirrorStore';
import { useSync } from '../hooks/useSync';

export function AppProviders() {
  const [ready, setReady] = useState(false);
  useSync();

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
      <RouterProvider router={router} />
    </ToastProvider>
  );
}
