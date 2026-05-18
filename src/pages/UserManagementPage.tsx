import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { AlertTriangle, ArrowDown, ArrowUp, Edit3, Eye, EyeOff, KeyRound, Layers, Lock, Plus, Save, ShieldCheck, Trash2, Unlock, Users } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/common/Card';
import { LoadingOverlay } from '../components/common/LoadingOverlay';
import { Modal } from '../components/common/Modal';
import { UserRepository } from '../db/repositories/UserRepository';
import { SettingsRepository } from '../db/repositories/SettingsRepository';
import { useAsync } from '../hooks/useAsync';
import { useAuthStore } from '../stores/authStore';
import type { Role, User } from '../types';
import { useToast } from '../components/common/Toast';
import { defaultPositions, hasPermission, parsePositions, PERMISSION_TREE, positionSettingKey, type PermissionKey, type PositionConfig } from '../utils/permissions';
import { requestSync } from '../services/api/syncScheduler';
import { nowIso } from '../utils/date';
import { formatDateTime } from '../utils/date';
import { LOGIN_SECURITY_STATE_KEY, getBlockedAt, getBlockReason, getBlockReasonLabel, isUserLoginBlocked, parseLoginSecurityState, type LoginSecurityState } from '../utils/loginSecurity';
import { ROLE_HIERARCHY_KEY, canManageRole, detectHierarchyConflicts, parseHierarchy, syncHierarchyWithPositions } from '../utils/roleHierarchy';

const ADMIN_ROLE = 'Admin';
const adminPermissions = PERMISSION_TREE.flatMap((node) => [node.key, ...(node.children?.map((child) => child.key) ?? [])]);
const adminManagedPermissionKeys: PermissionKey[] = ['reset_data', 'apply_discount', 'unblock_user'];

function IndeterminateCheckbox({
  indeterminate,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { indeterminate: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input type="checkbox" ref={ref} className={className} {...props} />;
}

type UserTab = 'users' | 'positions' | 'hierarchy';
type UserForm = {
  username: string;
  displayName: string;
  password: string;
  confirmPassword: string;
  pin: string;
  role: Role;
  isActive: boolean;
};

const emptyUserForm = (role: Role): UserForm => ({
  username: '',
  displayName: '',
  password: '',
  confirmPassword: '',
  pin: '',
  role,
  isActive: true,
});

export function UserManagementPage() {
  const { data: users, reload, loading } = useAsync(() => UserRepository.getUsers(), []);
  const { data: positionSetting, reload: reloadPositionSetting } = useAsync(() => SettingsRepository.getSetting(positionSettingKey, JSON.stringify(defaultPositions)), []);
  const { data: loginSecurityStateSetting, reload: reloadLoginSecurityState } = useAsync(() => SettingsRepository.getSetting(LOGIN_SECURITY_STATE_KEY), []);
  const { data: hierarchySetting, reload: reloadHierarchy } = useAsync(() => SettingsRepository.getSetting(ROLE_HIERARCHY_KEY), []);
  const [activeTab, setActiveTab] = useState<UserTab>('users');
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userForm, setUserForm] = useState<UserForm>(emptyUserForm('Cashier'));
  const [positionDrafts, setPositionDrafts] = useState<PositionConfig[]>(defaultPositions);
  const [hierarchyDrafts, setHierarchyDrafts] = useState<string[]>([]);
  const [newPositionName, setNewPositionName] = useState('');
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<User | null>(null);
  const [showPasswordInModal, setShowPasswordInModal] = useState(false);
  const [showPasswordInForm, setShowPasswordInForm] = useState(false);
  const [showConfirmPasswordInForm, setShowConfirmPasswordInForm] = useState(false);
  const toast = useToast();
  const currentUser = useAuthStore((state) => state.user);
  const isCurrentUserAdmin = currentUser?.role === ADMIN_ROLE;

  const savedPositions = useMemo(() => parsePositions(positionSetting), [positionSetting]);
  const loginSecurityState = useMemo(() => parseLoginSecurityState(loginSecurityStateSetting), [loginSecurityStateSetting]);
  const positionNames = useMemo(() => savedPositions.map((item) => item.name), [savedPositions]);
  const defaultCreateRole = useMemo(
    () => positionNames.find((name) => name !== ADMIN_ROLE) ?? positionNames[0] ?? 'Cashier',
    [positionNames],
  );
  const hasPositionChange = JSON.stringify(positionDrafts) !== JSON.stringify(savedPositions);
  const canBlockUsers = isCurrentUserAdmin || hasPermission(currentUser?.role, savedPositions, 'unblock_user');

  const savedHierarchy = useMemo(() => parseHierarchy(hierarchySetting), [hierarchySetting]);
  const hierarchy = useMemo(
    () => syncHierarchyWithPositions(savedHierarchy, positionNames),
    [savedHierarchy, positionNames],
  );
  const hasHierarchyChange = JSON.stringify(hierarchyDrafts) !== JSON.stringify(hierarchy);
  const hierarchyConflicts = useMemo(
    () => detectHierarchyConflicts(hierarchy, savedPositions),
    [hierarchy, savedPositions],
  );
  const permissionLabel = useMemo(() => {
    const map: Record<string, string> = {};
    for (const node of PERMISSION_TREE) {
      map[node.key] = node.label;
      for (const child of node.children ?? []) map[child.key] = child.label;
    }
    return map;
  }, []);

  const canManageUser = (user: User) =>
    isCurrentUserAdmin || canManageRole(currentUser?.role, user.role, hierarchy);
  const canAssignRole = (role: string) =>
    isCurrentUserAdmin || canManageRole(currentUser?.role, role, hierarchy);

  // Track which tab the user wants to switch to when there are unsaved changes
  const [pendingTab, setPendingTab] = useState<UserTab | null>(null);

  // Block router-level navigation (sidebar links) when there are unsaved changes
  const blocker = useBlocker(hasPositionChange || hasHierarchyChange);

  // Prevent accidental browser close/refresh when there are unsaved changes
  useEffect(() => {
    if (!hasPositionChange && !hasHierarchyChange) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasPositionChange, hasHierarchyChange]);

  // Handle tab switch — intercept when there are unsaved changes
  const handleTabChange = (tab: UserTab) => {
    if (tab === activeTab) return;
    if (hasPositionChange || hasHierarchyChange) {
      setPendingTab(tab);
    } else {
      setActiveTab(tab);
    }
  };

  // Discard changes and proceed (tab switch)
  const discardAndSwitchTab = () => {
    setPositionDrafts(savedPositions);
    setHierarchyDrafts(hierarchy);
    setActiveTab(pendingTab!);
    setPendingTab(null);
  };

  const activeAdminCount = useMemo(
    () => (users ?? []).filter((u) => u.role === ADMIN_ROLE && u.isActive).length,
    [users],
  );

  const isLastActiveAdmin = (user: User) => user.role === ADMIN_ROLE && user.isActive && activeAdminCount <= 1;

  const canSeePasswordOf = (user: User) => isCurrentUserAdmin && user.role !== ADMIN_ROLE;

  useEffect(() => {
    setPositionDrafts(savedPositions);
  }, [savedPositions]);

  useEffect(() => {
    setHierarchyDrafts(hierarchy);
  }, [hierarchy]);

  // เมื่อ device อื่น sync ตำแหน่งใหม่มา → reload UI ทันที
  useEffect(() => {
    const onPositionsUpdated = () => {
      reloadPositionSetting();
      reload();
    };
    window.addEventListener('calpos:permissions-updated', onPositionsUpdated);
    return () => window.removeEventListener('calpos:permissions-updated', onPositionsUpdated);
  }, [reloadPositionSetting, reload]);

  const openCreateUser = () => {
    setEditingUser(null);
    setShowPasswordInModal(false);
    setShowPasswordInForm(false);
    setShowConfirmPasswordInForm(false);
    setUserForm(emptyUserForm(defaultCreateRole));
    setShowUserModal(true);
  };

  useEffect(() => {
    if (!showUserModal || editingUser) return;

    const clearCreateForm = () => setUserForm(emptyUserForm(defaultCreateRole));
    const frame = window.requestAnimationFrame(clearCreateForm);
    const timeout = window.setTimeout(clearCreateForm, 150);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [defaultCreateRole, editingUser, showUserModal]);

  const openEditUser = (user: User) => {
    setEditingUser(user);
    setShowPasswordInModal(false);
    setShowPasswordInForm(false);
    setShowConfirmPasswordInForm(false);
    setUserForm({
      username: user.username,
      displayName: user.displayName,
      password: '',
      confirmPassword: '',
      pin: user.pin,
      role: user.role,
      isActive: user.isActive,
    });
    setShowUserModal(true);
  };

  const saveUser = async (event: FormEvent) => {
    event.preventDefault();

    // Hierarchy: ห้ามเปลี่ยน role ตัวเอง
    if (editingUser && editingUser.id === currentUser?.id && userForm.role !== editingUser.role) {
      return toast('ไม่สามารถเปลี่ยนตำแหน่งของตัวเองได้', 'error');
    }
    // Hierarchy: ต้องมีสิทธิ์จัดการ role ที่จะ assign
    if (!canAssignRole(userForm.role)) {
      return toast('ไม่มีสิทธิ์กำหนดตำแหน่งนี้ให้ผู้ใช้', 'error');
    }
    // Hierarchy: ต้องมีสิทธิ์จัดการ user ที่กำลังแก้ไข
    if (editingUser && !canManageUser(editingUser)) {
      return toast('ไม่มีสิทธิ์แก้ไขผู้ใช้ระดับนี้', 'error');
    }

    if (editingUser) {
      const isChangingFromLastAdmin =
        editingUser.role === ADMIN_ROLE && userForm.role !== ADMIN_ROLE && activeAdminCount <= 1;
      if (isChangingFromLastAdmin) return toast('ไม่สามารถเปลี่ยนตำแหน่ง Admin คนสุดท้ายได้', 'error');

      const isDeactivatingLastAdmin =
        editingUser.role === ADMIN_ROLE && editingUser.isActive && !userForm.isActive && activeAdminCount <= 1;
      if (isDeactivatingLastAdmin) return toast('ไม่สามารถปิดการใช้งาน Admin คนสุดท้ายได้', 'error');
    }

    if (userForm.pin.length !== 6 || !/^\d{6}$/.test(userForm.pin)) {
      return toast('PIN ต้องเป็นตัวเลข 6 หลักเท่านั้น', 'error');
    }

    if (userForm.password && userForm.password !== userForm.confirmPassword) {
      return toast('รหัสผ่านไม่ตรงกัน กรุณาตรวจสอบอีกครั้ง', 'error');
    }

    if (!editingUser && !userForm.password) {
      return toast('กรุณาใส่รหัสผ่าน', 'error');
    }

    const payload = {
      username: userForm.username.trim(),
      displayName: userForm.displayName.trim(),
      pin: userForm.pin,
      role: userForm.role,
      isActive: userForm.isActive,
      ...(userForm.password ? { password: userForm.password } : {}),
    };

    try {
      await UserRepository.assertUniqueUserFields(payload, editingUser?.id);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'บันทึกผู้ใช้ไม่สำเร็จ', 'error');
      return;
    }

    if (editingUser) {
      await UserRepository.updateUser(editingUser.id, payload);
      toast('บันทึกข้อมูลผู้ใช้แล้ว', 'success');
    } else {
      await UserRepository.createUser({ ...payload, password: userForm.password });
      toast('เพิ่มผู้ใช้แล้ว', 'success');
    }
    setShowUserModal(false);
    reload();
    requestSync({ immediate: true });
  };

  const handleToggleActive = async (user: User) => {
    if (!canManageUser(user)) {
      toast('ไม่มีสิทธิ์เปลี่ยนสถานะผู้ใช้ระดับนี้', 'error');
      return;
    }
    if (isLastActiveAdmin(user) && user.isActive) {
      toast('ไม่สามารถปิดการใช้งาน Admin คนสุดท้ายได้', 'error');
      return;
    }
    await UserRepository.setActive(user.id, !user.isActive);
    reload();
    requestSync({ immediate: true });
  };

  const updateLoginSecurityState = async (state: LoginSecurityState) => {
    await SettingsRepository.setSetting(LOGIN_SECURITY_STATE_KEY, JSON.stringify(state), { sync: true });
    reloadLoginSecurityState();
    requestSync({ immediate: true });
  };

  const handleToggleLoginBlocked = async (user: User) => {
    if (!canManageUser(user)) {
      toast('ไม่มีสิทธิ์จัดการผู้ใช้ระดับนี้', 'error');
      return;
    }
    const blocked = isUserLoginBlocked(user.id, loginSecurityState);
    if (!blocked && isLastActiveAdmin(user)) {
      toast('ไม่สามารถบล็อกการลงชื่อเข้าใช้ของ Admin คนสุดท้ายได้', 'error');
      return;
    }
    const passwordFailuresByUserId = { ...loginSecurityState.passwordFailuresByUserId };
    const blockedAtByUserId = { ...loginSecurityState.blockedAtByUserId };
    const blockReasonByUserId = { ...loginSecurityState.blockReasonByUserId };
    if (blocked) {
      delete passwordFailuresByUserId[user.id];
      delete blockedAtByUserId[user.id];
      delete blockReasonByUserId[user.id];
    } else {
      blockedAtByUserId[user.id] = nowIso();
      blockReasonByUserId[user.id] = 'manual';
    }
    await updateLoginSecurityState({
      ...loginSecurityState,
      passwordFailuresByUserId,
      blockedAtByUserId,
      blockReasonByUserId,
      blockedUserIds: blocked
        ? loginSecurityState.blockedUserIds.filter((id) => id !== user.id)
        : [...new Set([...loginSecurityState.blockedUserIds, user.id])],
    });
    toast(blocked ? 'ปลดล็อกการลงชื่อเข้าใช้แล้ว' : 'บล็อกการลงชื่อเข้าใช้แล้ว', 'success');
  };

  const handleDeleteUser = async (user: User) => {
    if (!canManageUser(user)) {
      toast('ไม่มีสิทธิ์ลบผู้ใช้ระดับนี้', 'error');
      setConfirmDeleteUser(null);
      return;
    }
    if (isLastActiveAdmin(user)) {
      toast('ไม่สามารถลบ Admin คนสุดท้ายได้', 'error');
      setConfirmDeleteUser(null);
      return;
    }
    await UserRepository.deleteUser(user.id);
    reload();
    requestSync({ immediate: true });
    setConfirmDeleteUser(null);
    toast('ลบผู้ใช้แล้ว', 'success');
  };

  const togglePermission = (positionName: string, permission: PermissionKey) => {
    setPositionDrafts((positions) => positions.map((position) => {
      if (position.name !== positionName) return position;
      const hasPermission = position.permissions.includes(permission);
      return {
        ...position,
        permissions: hasPermission ? position.permissions.filter((item) => item !== permission) : [...position.permissions, permission],
      };
    }));
  };

  // Toggle parent:
  // - checking: adds parent + addChildKeys (admin-only children excluded for non-Admin positions)
  // - unchecking: removes parent + ALL children (cleanupChildKeys) to clear any orphaned permissions
  const toggleParentPermission = (
    positionName: string,
    parentKey: PermissionKey,
    addChildKeys: PermissionKey[],
    cleanupChildKeys: PermissionKey[],
  ) => {
    setPositionDrafts((positions) => positions.map((position) => {
      if (position.name !== positionName) return position;
      const hasParent = position.permissions.includes(parentKey);
      if (hasParent) {
        return {
          ...position,
          permissions: position.permissions.filter((p) => p !== parentKey && !cleanupChildKeys.includes(p)),
        };
      }
      return {
        ...position,
        permissions: [...new Set([...position.permissions, parentKey, ...addChildKeys])],
      };
    }));
  };

  const addPosition = () => {
    const name = newPositionName.trim();
    if (!name) return;
    if (positionDrafts.some((position) => position.name.toLowerCase() === name.toLowerCase())) {
      toast('มีตำแหน่งนี้อยู่แล้ว', 'error');
      return;
    }
    setPositionDrafts((positions) => [...positions, { name, permissions: ['pos'] }]);
    setNewPositionName('');
  };

  const removePosition = (name: string) => {
    if (name === ADMIN_ROLE) return toast('ไม่สามารถลบตำแหน่ง Admin ได้', 'error');
    if (positionDrafts.length <= 1) return toast('ต้องมีตำแหน่งอย่างน้อย 1 ตำแหน่ง', 'error');
    if ((users ?? []).some((user) => user.role === name)) return toast('ยังมีผู้ใช้อยู่ในตำแหน่งนี้ ไม่สามารถลบได้', 'error');
    setPositionDrafts((positions) => positions.filter((position) => position.name !== name));
  };

  const savePositions = async () => {
    const normalizedPositions = positionDrafts.map((position) => (
      position.name === ADMIN_ROLE ? { ...position, permissions: adminPermissions } : position
    ));
    await SettingsRepository.setSetting(positionSettingKey, JSON.stringify(normalizedPositions), { sync: true });
    window.dispatchEvent(new Event('calpos:permissions-updated'));
    toast('บันทึกตำแหน่งและสิทธิ์แล้ว', 'success');
    reloadPositionSetting();
    requestSync({ immediate: true });
  };

  const saveHierarchy = async () => {
    await SettingsRepository.setSetting(ROLE_HIERARCHY_KEY, JSON.stringify(hierarchyDrafts), { sync: true });
    toast('บันทึกลำดับสิทธิ์แล้ว', 'success');
    reloadHierarchy();
    requestSync({ immediate: true });
  };

  const moveHierarchyItem = (index: number, direction: 'up' | 'down') => {
    setHierarchyDrafts((prev) => {
      const next = [...prev];
      const swapIndex = direction === 'up' ? index - 1 : index + 1;
      if (swapIndex < 0 || swapIndex >= next.length) return prev;
      [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
      return next;
    });
  };

  const isRoleChangeLocked = editingUser?.role === ADMIN_ROLE && activeAdminCount <= 1;

  return (
    <div className="relative p-4 md:p-6">
      <LoadingOverlay show={loading && !users} />
      <PageHeader title="จัดการผู้ใช้" subtitle="เพิ่มพนักงาน กำหนดตำแหน่ง และเลือกฟังก์ชันที่อนุญาตให้ใช้งาน" />

      <div className={`mb-4 inline-grid rounded-lg bg-white p-1 shadow-sm ${isCurrentUserAdmin ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <button className={`flex items-center gap-2 rounded-md px-4 py-2 font-black ${activeTab === 'users' ? 'bg-primary-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`} onClick={() => handleTabChange('users')}>
          <Users size={18} /> ผู้ใช้
        </button>
        <button className={`relative flex items-center gap-2 rounded-md px-4 py-2 font-black ${activeTab === 'positions' ? 'bg-primary-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`} onClick={() => handleTabChange('positions')}>
          <ShieldCheck size={18} /> ตำแหน่ง/สิทธิ์
          {hasPositionChange && (
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-400" title="มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก" />
          )}
        </button>
        {isCurrentUserAdmin && (
          <button className={`relative flex items-center gap-2 rounded-md px-4 py-2 font-black ${activeTab === 'hierarchy' ? 'bg-primary-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`} onClick={() => handleTabChange('hierarchy')}>
            <Layers size={18} /> ลำดับสิทธิ์
            {hasHierarchyChange && (
              <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-400" title="มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก" />
            )}
          </button>
        )}
      </div>

      {activeTab === 'users' && (
        <>
          <Card className="mb-4 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="font-black text-slate-950">ผู้ใช้ระบบ</h2>
                <p className="mt-1 text-sm text-slate-500">เพิ่มและแก้ไขข้อมูลพนักงาน</p>
              </div>
              <button className="inline-flex items-center justify-center gap-2 rounded-md bg-primary-600 px-4 py-3 font-black text-white" onClick={openCreateUser}>
                <Plus size={18} /> เพิ่มผู้ใช้
              </button>
            </div>
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-bold text-amber-800">
              หมายเหตุ: ระบบต้องมีผู้ใช้ตำแหน่ง Admin ที่ใช้งานอยู่อย่างน้อย 1 คนเสมอ — ไม่สามารถลบ เปลี่ยนตำแหน่ง หรือปิดใช้งาน Admin คนสุดท้ายได้
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="p-3">ชื่อแสดง</th>
                    <th>ชื่อผู้ใช้</th>
                    <th>ตำแหน่ง</th>
                    <th>PIN</th>
                    <th>สถานะ</th>
                    <th>สาเหตุ / เวลาที่ถูกบล็อก</th>
                    <th className="p-3 text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {(users ?? []).map((user) => (
                    <tr key={user.id} className="border-t border-slate-100">
                      <td className="p-3 font-bold">{user.displayName}</td>
                      <td>{user.username}</td>
                      <td>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${user.role === ADMIN_ROLE ? 'bg-primary-100 text-primary-700' : 'bg-slate-100 text-slate-600'}`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="font-mono">
                        {isCurrentUserAdmin ? user.pin : <span className="text-slate-400">••••••</span>}
                      </td>
                      <td>
                        {!user.isActive ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-500">
                            ปิดใช้งาน
                          </span>
                        ) : isUserLoginBlocked(user.id, loginSecurityState) ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-xs font-black text-red-600">
                            <Lock size={11} /> ถูกบล็อก
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-black text-emerald-700">
                            <Unlock size={11} /> ใช้งาน
                          </span>
                        )}
                      </td>
                      <td>
                        {getBlockedAt(user.id, loginSecurityState) ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs font-bold text-slate-600">
                              {getBlockReasonLabel(getBlockReason(user.id, loginSecurityState))}
                            </span>
                            <span className="text-xs text-slate-400">
                              {formatDateTime(getBlockedAt(user.id, loginSecurityState)!)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end gap-1.5">
                          <button
                            className={`rounded-md p-2 ${!canManageUser(user) ? 'cursor-not-allowed bg-slate-50 text-slate-300' : 'bg-primary-50 text-primary-700 hover:bg-primary-100'}`}
                            onClick={() => { if (canManageUser(user)) openEditUser(user); }}
                            aria-label="แก้ไข"
                            title={!canManageUser(user) ? 'ไม่มีสิทธิ์แก้ไขผู้ใช้ระดับนี้' : 'แก้ไข'}
                          >
                            <Edit3 size={16} />
                          </button>
                          <button
                            className={`rounded-md p-2 ${isLastActiveAdmin(user) || !canManageUser(user) ? 'cursor-not-allowed bg-slate-50 text-slate-300' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                            onClick={() => handleToggleActive(user)}
                            aria-label="เปิดปิด"
                            title={!canManageUser(user) ? 'ไม่มีสิทธิ์' : isLastActiveAdmin(user) ? 'Admin คนสุดท้าย' : user.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                          >
                            {user.isActive ? <Eye size={16} /> : <EyeOff size={16} />}
                          </button>
                          {canBlockUsers && (
                            <button
                              className={`rounded-md p-2 ${!canManageUser(user) ? 'cursor-not-allowed bg-slate-50 text-slate-300' : isUserLoginBlocked(user.id, loginSecurityState) ? 'bg-red-100 text-red-700 ring-1 ring-red-200 hover:bg-red-200' : 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100 hover:bg-emerald-100'}`}
                              onClick={() => handleToggleLoginBlocked(user)}
                              aria-label={isUserLoginBlocked(user.id, loginSecurityState) ? 'ปลดล็อก login' : 'บล็อก login'}
                              title={!canManageUser(user) ? 'ไม่มีสิทธิ์' : isUserLoginBlocked(user.id, loginSecurityState) ? 'คลิกเพื่อปลดล็อกการลงชื่อเข้าใช้' : 'คลิกเพื่อบล็อกการลงชื่อเข้าใช้'}
                            >
                              {isUserLoginBlocked(user.id, loginSecurityState) ? <Lock size={16} /> : <Unlock size={16} />}
                            </button>
                          )}
                          <button
                            className={`rounded-md p-2 ${isLastActiveAdmin(user) || !canManageUser(user) ? 'cursor-not-allowed bg-slate-50 text-slate-300' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}
                            onClick={() => { if (!isLastActiveAdmin(user) && canManageUser(user)) setConfirmDeleteUser(user); }}
                            aria-label="ลบ"
                            title={!canManageUser(user) ? 'ไม่มีสิทธิ์' : isLastActiveAdmin(user) ? 'Admin คนสุดท้าย ลบไม่ได้' : 'ลบผู้ใช้'}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {activeTab === 'positions' && (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
              <input className="rounded-md border-slate-300" placeholder="ชื่อตำแหน่งใหม่" value={newPositionName} onChange={(event) => setNewPositionName(event.target.value)} />
              <button className="rounded-md bg-primary-600 px-4 py-3 font-black text-white" onClick={addPosition}><Plus className="mr-2 inline" size={18} /> เพิ่มตำแหน่ง</button>
              <button className={`rounded-md px-4 py-3 font-black text-white ${hasPositionChange ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-300'}`} disabled={!hasPositionChange} onClick={savePositions}>
                <Save className="mr-2 inline" size={18} /> บันทึกการแก้ไข
              </button>
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            {positionDrafts.map((position) => {
              const isAdminPosition = position.name === ADMIN_ROLE;
              return (
                <Card key={position.name} className="p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-black text-slate-950">{position.name}</h2>
                        {isAdminPosition && (
                          <span className="rounded-full bg-primary-100 px-2 py-0.5 text-xs font-bold text-primary-700">ลบไม่ได้</span>
                        )}
                      </div>
                      <p className="text-xs font-bold text-slate-500">เลือกฟังก์ชันที่ตำแหน่งนี้สามารถใช้งานได้</p>
                    </div>
                    <button
                      className={`rounded-md p-2 ${isAdminPosition ? 'cursor-not-allowed bg-slate-50 text-slate-300' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}
                      onClick={() => removePosition(position.name)}
                      disabled={isAdminPosition}
                      aria-label="ลบตำแหน่ง"
                      title={isAdminPosition ? 'ตำแหน่ง Admin ไม่สามารถลบได้' : 'ลบตำแหน่ง'}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                  {isAdminPosition ? (
                    <div className="rounded-md border border-primary-100 bg-primary-50 px-4 py-3 text-sm font-bold text-primary-800">
                      Admin ใช้งานได้ทุกฟังก์ชันของระบบเสมอ จึงไม่ต้องเลือกสิทธิ์
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {PERMISSION_TREE.map((node) => {
                      const parentChecked = position.permissions.includes(node.key);
                      // All children (used for cleanup when unchecking parent)
                      const allChildKeys = node.children?.map((c) => c.key) ?? [];
                      // Children allowed to be auto-checked for this position.
                      // Admin-managed permissions can be granted by the logged-in Admin account.
                      const addChildKeys = isCurrentUserAdmin
                        ? allChildKeys
                        : allChildKeys.filter((k) => !adminManagedPermissionKeys.includes(k));
                      const checkedChildCount = addChildKeys.filter((k) => position.permissions.includes(k)).length;
                      const isIndeterminate = parentChecked && addChildKeys.length > 0 && checkedChildCount > 0 && checkedChildCount < addChildKeys.length;

                      return (
                        <div key={node.key} className="overflow-hidden rounded-md border border-slate-200">
                          {/* Parent row — menu-level permission */}
                          <label className="flex cursor-pointer items-center gap-2 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-100">
                            <IndeterminateCheckbox
                              className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                              indeterminate={isIndeterminate}
                              checked={parentChecked}
                              onChange={() => toggleParentPermission(position.name, node.key, addChildKeys, allChildKeys)}
                            />
                            <span className="flex-1">{node.label}</span>
                            {addChildKeys.length > 0 && (
                              <span className="text-xs font-normal text-slate-400">
                                {checkedChildCount > 0 ? `${checkedChildCount}/${addChildKeys.length}` : ''}
                              </span>
                            )}
                          </label>

                          {/* Child rows — tab/action-level permissions */}
                          {node.children && node.children.length > 0 && (
                            <div className={`border-t border-slate-100 transition-opacity ${!parentChecked ? 'pointer-events-none opacity-40' : ''}`}>
                              {node.children.map((child, idx) => {
                                const adminManaged = adminManagedPermissionKeys.includes(child.key);
                                const lockedForNonAdmin = adminManaged && !isCurrentUserAdmin;
                                return (
                                  <label
                                    key={child.key}
                                    className={`flex items-center gap-2 py-2 pl-8 pr-3 text-sm font-medium text-slate-700 ${idx < node.children!.length - 1 ? 'border-b border-slate-100' : ''} ${lockedForNonAdmin ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-slate-50'}`}
                                  >
                                    <span className="select-none text-slate-300">└</span>
                                    <input
                                      type="checkbox"
                                      className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                                      checked={position.permissions.includes(child.key)}
                                      disabled={!parentChecked || lockedForNonAdmin}
                                      onChange={() => togglePermission(position.name, child.key)}
                                    />
                                    <span className={lockedForNonAdmin ? 'opacity-40' : ''}>{child.label}</span>
                                    {adminManaged && (
                                      <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-400">เฉพาะบัญชี Admin</span>
                                    )}
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                      })}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'hierarchy' && isCurrentUserAdmin && (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="font-black text-slate-950">ลำดับสิทธิ์ตำแหน่ง</h2>
                <p className="mt-1 text-sm text-slate-500">จัดเรียงตำแหน่งจากระดับ <span className="font-bold">ต่ำสุด (บน)</span> ไป <span className="font-bold">สูงสุด (ล่าง)</span> — ตำแหน่งที่ rank สูงกว่าสามารถจัดการตำแหน่งที่ rank เท่ากันหรือต่ำกว่าได้</p>
              </div>
              <button
                className={`rounded-md px-4 py-3 font-black text-white ${hasHierarchyChange ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-300'}`}
                disabled={!hasHierarchyChange}
                onClick={saveHierarchy}
              >
                <Save className="mr-2 inline" size={18} /> บันทึก
              </button>
            </div>
          </Card>

          {hierarchyConflicts.length > 0 && (
            <Card className="border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-600" />
                <div>
                  <p className="font-black text-amber-900">พบความขัดแย้งของสิทธิ์</p>
                  <p className="mt-1 text-sm text-amber-700">ตำแหน่ง rank ต่ำกว่ามีสิทธิ์บางอย่างที่ตำแหน่ง rank สูงกว่าไม่มี ระบบยังทำงานได้ปกติ แต่ควรตรวจสอบการตั้งค่าสิทธิ์</p>
                  <ul className="mt-2 space-y-1.5">
                    {hierarchyConflicts.map((conflict, i) => (
                      <li key={i} className="text-sm text-amber-800">
                        <span className="font-bold">{conflict.lowerRole}</span> (rank ต่ำกว่า) มีสิทธิ์ที่ <span className="font-bold">{conflict.higherRole}</span> ไม่มี:{' '}
                        <span className="font-medium">{conflict.extraPermissions.map((p) => permissionLabel[p] ?? p).join(', ')}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
          )}

          <Card className="overflow-hidden">
            <div className="divide-y divide-slate-100">
              {hierarchyDrafts.map((role, index) => (
                <div key={role} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex flex-col">
                    <button
                      className={`rounded p-1 ${index === 0 ? 'cursor-not-allowed text-slate-200' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`}
                      disabled={index === 0}
                      onClick={() => moveHierarchyItem(index, 'up')}
                      aria-label="เลื่อนขึ้น"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      className={`rounded p-1 ${index === hierarchyDrafts.length - 1 ? 'cursor-not-allowed text-slate-200' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`}
                      disabled={index === hierarchyDrafts.length - 1}
                      onClick={() => moveHierarchyItem(index, 'down')}
                      aria-label="เลื่อนลง"
                    >
                      <ArrowDown size={14} />
                    </button>
                  </div>
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-black text-slate-600">
                    {index + 1}
                  </div>
                  <span className="flex-1 font-bold text-slate-800">{role}</span>
                  <span className="text-xs text-slate-400">rank {index + 1}</span>
                </div>
              ))}
              <div className="flex items-center gap-3 bg-primary-50 px-4 py-3">
                <div className="flex flex-col">
                  <button className="cursor-not-allowed rounded p-1 text-slate-200" disabled><ArrowUp size={14} /></button>
                  <button className="cursor-not-allowed rounded p-1 text-slate-200" disabled><ArrowDown size={14} /></button>
                </div>
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-black text-primary-700">∞</div>
                <span className="flex-1 font-bold text-primary-700">Admin</span>
                <span className="text-xs text-primary-400">สิทธิ์สูงสุด (ตายตัว)</span>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Edit / Create User Modal */}
      {showUserModal && (
        <Modal title={editingUser ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้'} onClose={() => setShowUserModal(false)}>
          <form className="space-y-3" onSubmit={saveUser} autoComplete="off">
            <label className="block text-sm font-bold text-slate-700">ชื่อแสดง<input className="mt-1 w-full rounded-md border-slate-300" placeholder="" value={userForm.displayName} onChange={(event) => setUserForm({ ...userForm, displayName: event.target.value })} required autoComplete="off" name="calpos-new-display-name" /></label>
            <label className="block text-sm font-bold text-slate-700">ชื่อผู้ใช้<input className="mt-1 w-full rounded-md border-slate-300" placeholder="" value={userForm.username} onChange={(event) => setUserForm({ ...userForm, username: event.target.value })} required autoComplete="new-username" name="calpos-new-username" /></label>
            <div className="block text-sm font-bold text-slate-700">
              รหัสผ่านใหม่{editingUser && <span className="ml-1 text-xs text-slate-400">(เว้นว่างถ้าไม่เปลี่ยน)</span>}
              <div className="relative mt-1">
                <input
                  type={showPasswordInForm ? 'text' : 'password'}
                  className="w-full rounded-md border-slate-300 pr-10"
                  placeholder=""
                  value={userForm.password}
                  onChange={(event) => setUserForm({ ...userForm, password: event.target.value })}
                  autoComplete="new-password"
                  name="calpos-new-password"
                  required={!editingUser}
                />
                <button
                  type="button"
                  onClick={() => setShowPasswordInForm((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  tabIndex={-1}
                >
                  {showPasswordInForm ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            {(userForm.password || !editingUser) && (
              <div className="block text-sm font-bold text-slate-700">
                ยืนยันรหัสผ่าน
                <div className="relative mt-1">
                  <input
                    type={showConfirmPasswordInForm ? 'text' : 'password'}
                    className={`w-full rounded-md pr-10 ${userForm.confirmPassword && userForm.password !== userForm.confirmPassword ? 'border-red-400 focus:ring-red-200' : 'border-slate-300'}`}
                    placeholder=""
                    value={userForm.confirmPassword}
                    onChange={(event) => setUserForm({ ...userForm, confirmPassword: event.target.value })}
                    autoComplete="new-password"
                    name="calpos-confirm-new-password"
                    required={!editingUser || Boolean(userForm.password)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPasswordInForm((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    tabIndex={-1}
                  >
                    {showConfirmPasswordInForm ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
                {userForm.confirmPassword && userForm.password !== userForm.confirmPassword && (
                  <p className="mt-1 text-xs font-bold text-red-600">รหัสผ่านไม่ตรงกัน</p>
                )}
              </div>
            )}

            {/* Password reveal — admin viewing non-admin only */}
            {editingUser && canSeePasswordOf(editingUser) && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
                    <KeyRound size={13} /> รหัสผ่านปัจจุบัน
                  </span>
                  <button type="button" onClick={() => setShowPasswordInModal((v) => !v)} className="text-xs font-bold text-primary-600 hover:underline">
                    {showPasswordInModal ? 'ซ่อน' : 'แสดง'}
                  </button>
                </div>
                <div className="font-mono text-sm font-black text-slate-800">
                  {showPasswordInModal
                    ? (editingUser.passwordPlain ?? <span className="font-normal text-slate-400">ไม่มีข้อมูลในเครื่องนี้ - ตั้งรหัสผ่านใหม่ได้จากช่องด้านบน</span>)
                    : '••••••••'}
                </div>
              </div>
            )}

            <label className="block text-sm font-bold text-slate-700">
              PIN <span className="font-normal text-xs text-slate-400">(ตัวเลข 6 หลัก)</span>
              <input
                type={isCurrentUserAdmin ? 'text' : 'password'}
                inputMode="numeric"
                className="mt-1 w-full rounded-md border-slate-300 text-center text-xl font-black tracking-widest"
                placeholder="000000"
                value={userForm.pin}
                onChange={(e) => setUserForm({ ...userForm, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                autoComplete="off"
                name="calpos-new-pin"
                minLength={6}
                maxLength={6}
                pattern="\d{6}"
                title="PIN ต้องเป็นตัวเลข 6 หลัก"
                required
              />
            </label>

            <div className="block text-sm font-bold text-slate-700">
              ตำแหน่ง
              {isRoleChangeLocked && (
                <span className="ml-2 text-xs font-bold text-amber-600">Admin คนสุดท้าย — เปลี่ยนตำแหน่งไม่ได้</span>
              )}
              <select
                className={`mt-1 w-full rounded-md border-slate-300 ${isRoleChangeLocked ? 'cursor-not-allowed bg-slate-100 opacity-60' : ''}`}
                value={userForm.role}
                onChange={(event) => setUserForm({ ...userForm, role: event.target.value })}
                disabled={isRoleChangeLocked}
              >
                {positionNames.filter((p) => canAssignRole(p) || p === userForm.role).map((position) => <option key={position} value={position}>{position}</option>)}
              </select>
            </div>

            <label className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
              <input
                type="checkbox"
                className="rounded border-slate-300 text-primary-600"
                checked={userForm.isActive}
                onChange={(event) => setUserForm({ ...userForm, isActive: event.target.checked })}
                disabled={isRoleChangeLocked && editingUser?.isActive}
              />
              ใช้งาน
              {isRoleChangeLocked && editingUser?.isActive && (
                <span className="ml-1 text-xs font-bold text-amber-600">(Admin คนสุดท้าย ปิดไม่ได้)</span>
              )}
            </label>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button type="button" className="rounded-md bg-slate-100 py-3 font-bold text-slate-700" onClick={() => setShowUserModal(false)}>ยกเลิก</button>
              <button className="rounded-md bg-emerald-600 py-3 font-black text-white hover:bg-emerald-700">บันทึก</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Confirm Delete Modal */}
      {confirmDeleteUser && (
        <Modal title="ลบผู้ใช้" onClose={() => setConfirmDeleteUser(null)}>
          <div className="space-y-4">
            <p className="text-sm font-medium leading-6 text-slate-700">
              ต้องการลบผู้ใช้ <span className="font-black text-slate-900">{confirmDeleteUser.displayName}</span> ({confirmDeleteUser.username}) ออกจากระบบหรือไม่?<br />
              <span className="font-bold text-red-600">การลบไม่สามารถย้อนกลับได้</span>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button className="rounded-md bg-slate-100 py-3 font-bold text-slate-700 hover:bg-slate-200" onClick={() => setConfirmDeleteUser(null)}>ยกเลิก</button>
              <button className="rounded-md bg-red-600 py-3 font-black text-white hover:bg-red-700" onClick={() => handleDeleteUser(confirmDeleteUser)}>ลบผู้ใช้</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Unsaved changes warning — tab switch */}
      {pendingTab !== null && (
        <Modal title="ยังไม่ได้บันทึก" onClose={() => setPendingTab(null)}>
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-600" />
              <div>
                <p className="font-black text-amber-900">มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก</p>
                <p className="mt-1 text-sm font-medium text-amber-700">
                  หากออกจากแท็บนี้ การแก้ไขที่ยังไม่ได้บันทึกทั้งหมดจะหายไป
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                className="rounded-md bg-emerald-600 py-3 font-black text-white hover:bg-emerald-700"
                onClick={() => setPendingTab(null)}
              >
                กลับไปบันทึก
              </button>
              <button
                className="rounded-md bg-slate-100 py-3 font-bold text-slate-700 hover:bg-slate-200"
                onClick={discardAndSwitchTab}
              >
                ออกโดยไม่บันทึก
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Unsaved changes warning — router navigation (sidebar links) */}
      {blocker.state === 'blocked' && (
        <Modal title="ยังไม่ได้บันทึก" onClose={() => blocker.reset()}>
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-600" />
              <div>
                <p className="font-black text-amber-900">มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก</p>
                <p className="mt-1 text-sm font-medium text-amber-700">
                  หากออกจากหน้านี้ การแก้ไขที่ยังไม่ได้บันทึกทั้งหมดจะหายไป
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                className="rounded-md bg-emerald-600 py-3 font-black text-white hover:bg-emerald-700"
                onClick={() => blocker.reset()}
              >
                กลับไปบันทึก
              </button>
              <button
                className="rounded-md bg-slate-100 py-3 font-bold text-slate-700 hover:bg-slate-200"
                onClick={() => blocker.proceed()}
              >
                ออกโดยไม่บันทึก
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
