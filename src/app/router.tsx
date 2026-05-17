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
import { RequirePermission } from '../features/auth/RequirePermission';
import type { PermissionKey } from '../utils/permissions';

function withPermission(permission: PermissionKey, element: JSX.Element) {
  return <RequirePermission permission={permission}>{element}</RequirePermission>;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/mirror-pos',
    element: (
      <RequireAuth>
        <RequirePermission permission="pos">
          <MirrorPosLayout />
        </RequirePermission>
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
        <RequirePermission permission="pos">
          <FrontPosLayout />
        </RequirePermission>
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
      { path: 'dashboard', element: withPermission('dashboard', <DashboardPage />) },
      { path: 'pos', element: withPermission('pos', <PosPage />) },
      { path: 'bills', element: withPermission('bill_history', <BillHistoryPage />) },
      { path: 'send-report', element: withPermission('send_report', <SendReportPage />) },
      { path: 'import-data', element: withPermission('import_data', <ImportDataPage />) },
      { path: 'products', element: withPermission('products', <ProductManagementPage />) },
      { path: 'categories', element: <Navigate to="/products" replace /> },
      { path: 'users', element: withPermission('users', <UserManagementPage />) },
      { path: 'settings', element: withPermission('settings', <SettingsPage />) },
      { path: 'general-settings', element: <Navigate to="/settings?tab=general" replace /> },
      { path: 'payment-settings', element: <Navigate to="/settings?tab=payment" replace /> },
      { path: 'backup', element: withPermission('backup', <BackupPage />) },
    ],
  },
]);
