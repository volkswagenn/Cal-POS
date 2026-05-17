import { Navigate, useLocation } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import type { PermissionKey } from '../../utils/permissions';

export function RequirePermission({ permission, children }: { permission: PermissionKey; children: JSX.Element }) {
  const { can, loading } = usePermissions();
  const location = useLocation();

  if (loading) return children;
  if (!can(permission)) return <Navigate to="/select" replace state={{ from: location }} />;

  return children;
}
