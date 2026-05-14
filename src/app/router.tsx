import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from '../layouts/AppLayout';
import { FrontPosLayout } from '../layouts/FrontPosLayout';
import { LoginPage } from '../pages/LoginPage';
import { ModeSelectPage } from '../pages/ModeSelectPage';
import { PosPage } from '../pages/PosPage';
import { BillHistoryPage } from '../pages/BillHistoryPage';
import { ProductManagementPage } from '../pages/ProductManagementPage';
import { UserManagementPage } from '../pages/UserManagementPage';
import { SettingsPage } from '../pages/SettingsPage';
import { DashboardPage } from '../pages/DashboardPage';
import { SendReportPage } from '../pages/SendReportPage';
import { ImportDataPage } from '../pages/ImportDataPage';
import { BackupPage } from '../pages/BackupPage';
import { GeneralSettingsPage } from '../pages/GeneralSettingsPage';
import { PaymentSettingsPage } from '../pages/PaymentSettingsPage';
import { MirrorPosLayout } from '../layouts/MirrorPosLayout';
import { RequireAuth } from '../features/auth/RequireAuth';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/mirror-pos',
    element: (
      <RequireAuth>
        <MirrorPosLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <PosPage /> },
    ],
  },
  {
    path: '/select',
    element: (
      <RequireAuth>
        <ModeSelectPage />
      </RequireAuth>
    ),
  },
  {
    path: '/front-pos',
    element: (
      <RequireAuth>
        <FrontPosLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <PosPage /> },
    ],
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/select" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'pos', element: <PosPage /> },
      { path: 'bills', element: <BillHistoryPage /> },
      { path: 'send-report', element: <SendReportPage /> },
      { path: 'import-data', element: <Navigate to="/" replace /> },
      { path: 'products', element: <ProductManagementPage /> },
      { path: 'categories', element: <Navigate to="/products" replace /> },
      { path: 'users', element: <UserManagementPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'general-settings', element: <Navigate to="/settings?tab=general" replace /> },
      { path: 'payment-settings', element: <Navigate to="/settings?tab=payment" replace /> },
      { path: 'backup', element: <BackupPage /> },
    ],
  },
]);
