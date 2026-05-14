import { useEffect, useMemo } from 'react';
import { SettingsRepository } from '../db/repositories/SettingsRepository';
import { useAuthStore } from '../stores/authStore';
import { defaultPositions, hasPermission, parsePositions, positionSettingKey, permissionsForRole, type PermissionKey } from '../utils/permissions';
import { useAsync } from './useAsync';

export function usePermissions() {
  const user = useAuthStore((state) => state.user);
  const { data: positionSetting, reload } = useAsync(() => SettingsRepository.getSetting(positionSettingKey, JSON.stringify(defaultPositions)), []);
  const positions = useMemo(() => parsePositions(positionSetting), [positionSetting]);
  const permissions = useMemo(() => permissionsForRole(user?.role, positions), [user?.role, positions]);

  useEffect(() => {
    const onUpdated = () => reload();
    window.addEventListener('calpos:permissions-updated', onUpdated);
    return () => window.removeEventListener('calpos:permissions-updated', onUpdated);
  }, [reload]);

  return {
    user,
    positions,
    permissions,
    can: (permission: PermissionKey) => hasPermission(user?.role, positions, permission),
  };
}
