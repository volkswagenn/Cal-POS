import { useEffect, useMemo } from 'react';
import { SettingsRepository } from '../db/repositories/SettingsRepository';
import { useAuthStore } from '../stores/authStore';
import { defaultPositions, hasPermission, parsePositions, positionSettingKey, permissionsForRole, type PermissionKey } from '../utils/permissions';
import { useAsync } from './useAsync';
import { requestSync } from '../services/api/syncScheduler';

export function usePermissions() {
  const user = useAuthStore((state) => state.user);
  const { data: positionSetting, loading, reload } = useAsync(
    () => SettingsRepository.getSetting(positionSettingKey, JSON.stringify(defaultPositions)),
    [],
  );
  const positions = useMemo(() => parsePositions(positionSetting), [positionSetting]);
  const permissions = useMemo(() => permissionsForRole(user?.role, positions), [user?.role, positions]);

  // Role ไม่ตรงกับ position ใดเลย (sync ยังไม่มา หรือ role ถูกลบ)
  const isRoleOrphan =
    !loading &&
    !!user?.role &&
    positions.length > 0 &&
    !positions.some((p) => p.name === user.role);

  useEffect(() => {
    // sync ดึง userPositions ใหม่มา → reload ทันที
    const onUpdated = () => reload();
    window.addEventListener('calpos:permissions-updated', onUpdated);
    return () => window.removeEventListener('calpos:permissions-updated', onUpdated);
  }, [reload]);

  useEffect(() => {
    // กลับมา online → sync อาจยังไม่ได้ดึง positions → reload
    const onOnline = () => reload();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [reload]);

  useEffect(() => {
    // Role ไม่ match position ใดเลย → ดึงข้อมูลจาก cloud ทันที
    // (เครื่องใหม่ยังไม่ได้ sync หรือ positions ถูกเปลี่ยนบนเครื่องอื่น)
    if (isRoleOrphan) {
      requestSync({ immediate: true });
    }
  }, [isRoleOrphan]);

  return {
    user,
    positions,
    permissions,
    loading,
    isRoleOrphan,
    can: (permission: PermissionKey) => {
      // ขณะโหลดอยู่ → อย่าบล็อก (แสดงชั่วคราว แล้วค่อย update หลัง async เสร็จ)
      if (loading) return true;
      return hasPermission(user?.role, positions, permission);
    },
  };
}
