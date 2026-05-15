import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Edit3, Eye, EyeOff, KeyRound, Plus, Save, ShieldCheck, Trash2, Users } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/common/Card';
import { Modal } from '../components/common/Modal';
import { UserRepository } from '../db/repositories/UserRepository';
import { SettingsRepository } from '../db/repositories/SettingsRepository';
import { useAsync } from '../hooks/useAsync';
import { useAuthStore } from '../stores/authStore';
import type { Role, User } from '../types';
import { useToast } from '../components/common/Toast';
import { defaultPositions, parsePositions, permissionOptions, positionSettingKey, type PermissionKey, type PositionConfig } from '../utils/permissions';
import { requestSync } from '../services/api/syncScheduler';

const ADMIN_ROLE = 'Admin';

type UserTab = 'users' | 'positions';
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
  const { data: users, reload } = useAsync(() => UserRepository.getUsers(), []);
  const { data: positionSetting, reload: reloadPositionSetting } = useAsync(() => SettingsRepository.getSetting(positionSettingKey, JSON.stringify(defaultPositions)), []);
  const [activeTab, setActiveTab] = useState<UserTab>('users');
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userForm, setUserForm] = useState<UserForm>(emptyUserForm('Cashier'));
  const [positionDrafts, setPositionDrafts] = useState<PositionConfig[]>(defaultPositions);
  const [newPositionName, setNewPositionName] = useState('');
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<User | null>(null);
  const [showPasswordInModal, setShowPasswordInModal] = useState(false);
  const [showPasswordInForm, setShowPasswordInForm] = useState(false);
  const [showConfirmPasswordInForm, setShowConfirmPasswordInForm] = useState(false);
  const toast = useToast();
  const currentUser = useAuthStore((state) => state.user);
  const isCurrentUserAdmin = currentUser?.role === ADMIN_ROLE;

  const savedPositions = useMemo(() => parsePositions(positionSetting), [positionSetting]);
  const positionNames = useMemo(() => savedPositions.map((item) => item.name), [savedPositions]);
  const hasPositionChange = JSON.stringify(positionDrafts) !== JSON.stringify(savedPositions);

  const activeAdminCount = useMemo(
    () => (users ?? []).filter((u) => u.role === ADMIN_ROLE && u.isActive).length,
    [users],
  );

  const isLastActiveAdmin = (user: User) => user.role === ADMIN_ROLE && user.isActive && activeAdminCount <= 1;

  const canSeePasswordOf = (user: User) => isCurrentUserAdmin && user.role !== ADMIN_ROLE;

  useEffect(() => {
    setPositionDrafts(savedPositions);
  }, [savedPositions]);

  // เมื่อหน้านี้โหลด (คนที่มีสิทธิ์จัดการผู้ใช้) → ตรวจว่า userPositions
  // เคยถูก push ขึ้น cloud แล้วหรือยัง ถ้ายัง → push ทันที (backfill once)
  useEffect(() => {
    SettingsRepository.ensureSettingSynced(positionSettingKey);
  }, []);

  const openCreateUser = () => {
    setEditingUser(null);
    setShowPasswordInModal(false);
    setShowPasswordInForm(false);
    setShowConfirmPasswordInForm(false);
    setUserForm(emptyUserForm(positionNames[0] ?? 'Cashier'));
    setShowUserModal(true);
  };

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

    if (editingUser) {
      const isChangingFromLastAdmin =
        editingUser.role === ADMIN_ROLE && userForm.role !== ADMIN_ROLE && activeAdminCount <= 1;
      if (isChangingFromLastAdmin) return toast('ไม่สามารถเปลี่ยนตำแหน่ง Admin คนสุดท้ายได้', 'error');

      const isDeactivatingLastAdmin =
        editingUser.role === ADMIN_ROLE && editingUser.isActive && !userForm.isActive && activeAdminCount <= 1;
      if (isDeactivatingLastAdmin) return toast('ไม่สามารถปิดการใช้งาน Admin คนสุดท้ายได้', 'error');
    }

    if (userForm.pin.length < 6 || userForm.pin.length > 8 || !/^\d+$/.test(userForm.pin)) {
      return toast('PIN ต้องเป็นตัวเลข 6–8 หลัก', 'error');
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
    if (isLastActiveAdmin(user) && user.isActive) {
      toast('ไม่สามารถปิดการใช้งาน Admin คนสุดท้ายได้', 'error');
      return;
    }
    await UserRepository.setActive(user.id, !user.isActive);
    reload();
    requestSync({ immediate: true });
  };

  const handleDeleteUser = async (user: User) => {
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
    await SettingsRepository.setSetting(positionSettingKey, JSON.stringify(positionDrafts), { sync: true });
    window.dispatchEvent(new Event('calpos:permissions-updated'));
    toast('บันทึกตำแหน่งและสิทธิ์แล้ว', 'success');
    reloadPositionSetting();
    requestSync({ immediate: true });
  };

  const isRoleChangeLocked = editingUser?.role === ADMIN_ROLE && activeAdminCount <= 1;

  return (
    <div className="p-4 md:p-6">
      <PageHeader title="จัดการผู้ใช้" subtitle="เพิ่มพนักงาน กำหนดตำแหน่ง และเลือกฟังก์ชันที่อนุญาตให้ใช้งาน" />

      <div className="mb-4 inline-grid grid-cols-2 rounded-lg bg-white p-1 shadow-sm">
        <button className={`flex items-center gap-2 rounded-md px-4 py-2 font-black ${activeTab === 'users' ? 'bg-primary-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`} onClick={() => setActiveTab('users')}>
          <Users size={18} /> ผู้ใช้
        </button>
        <button className={`flex items-center gap-2 rounded-md px-4 py-2 font-black ${activeTab === 'positions' ? 'bg-primary-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`} onClick={() => setActiveTab('positions')}>
          <ShieldCheck size={18} /> ตำแหน่ง/สิทธิ์
        </button>
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
                      <td className="font-mono">{user.pin}</td>
                      <td>
                        <span className={`text-xs font-bold ${user.isActive ? 'text-emerald-600' : 'text-slate-400'}`}>
                          {user.isActive ? 'ใช้งาน' : 'ปิด'}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end gap-1.5">
                          <button className="rounded-md bg-primary-50 p-2 text-primary-700 hover:bg-primary-100" onClick={() => openEditUser(user)} aria-label="แก้ไข">
                            <Edit3 size={16} />
                          </button>
                          <button
                            className={`rounded-md p-2 ${isLastActiveAdmin(user) ? 'cursor-not-allowed bg-slate-50 text-slate-300' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                            onClick={() => handleToggleActive(user)}
                            aria-label="เปิดปิด"
                            title={isLastActiveAdmin(user) ? 'Admin คนสุดท้าย' : user.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                          >
                            {user.isActive ? <Eye size={16} /> : <EyeOff size={16} />}
                          </button>
                          <button
                            className={`rounded-md p-2 ${isLastActiveAdmin(user) ? 'cursor-not-allowed bg-slate-50 text-slate-300' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}
                            onClick={() => { if (!isLastActiveAdmin(user)) setConfirmDeleteUser(user); }}
                            aria-label="ลบ"
                            title={isLastActiveAdmin(user) ? 'Admin คนสุดท้าย ลบไม่ได้' : 'ลบผู้ใช้'}
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
              <button className={`rounded-md px-4 py-3 font-black text-white ${hasPositionChange ? 'bg-primary-600' : 'bg-slate-300'}`} disabled={!hasPositionChange} onClick={savePositions}>
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
                  <div className="grid gap-2 sm:grid-cols-2">
                    {permissionOptions.map((permission) => (
                      <label key={permission.key} className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
                        <input
                          type="checkbox"
                          className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                          checked={position.permissions.includes(permission.key)}
                          onChange={() => togglePermission(position.name, permission.key)}
                        />
                        {permission.label}
                      </label>
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Edit / Create User Modal */}
      {showUserModal && (
        <Modal title={editingUser ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้'} onClose={() => setShowUserModal(false)}>
          <form className="space-y-3" onSubmit={saveUser}>
            <label className="block text-sm font-bold text-slate-700">ชื่อแสดง<input className="mt-1 w-full rounded-md border-slate-300" value={userForm.displayName} onChange={(event) => setUserForm({ ...userForm, displayName: event.target.value })} required /></label>
            <label className="block text-sm font-bold text-slate-700">ชื่อผู้ใช้<input className="mt-1 w-full rounded-md border-slate-300" value={userForm.username} onChange={(event) => setUserForm({ ...userForm, username: event.target.value })} required /></label>
            <div className="block text-sm font-bold text-slate-700">
              รหัสผ่านใหม่{editingUser && <span className="ml-1 text-xs text-slate-400">(เว้นว่างถ้าไม่เปลี่ยน)</span>}
              <div className="relative mt-1">
                <input
                  type={showPasswordInForm ? 'text' : 'password'}
                  className="w-full rounded-md border-slate-300 pr-10"
                  value={userForm.password}
                  onChange={(event) => setUserForm({ ...userForm, password: event.target.value })}
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
                    value={userForm.confirmPassword}
                    onChange={(event) => setUserForm({ ...userForm, confirmPassword: event.target.value })}
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
                    ? (editingUser.passwordPlain ?? <span className="font-normal text-slate-400">ไม่มีข้อมูล</span>)
                    : '••••••••'}
                </div>
              </div>
            )}

            <label className="block text-sm font-bold text-slate-700">
              PIN <span className="font-normal text-slate-400 text-xs">(ตัวเลข 6–8 หลัก)</span>
              <input
                inputMode="numeric"
                className="mt-1 w-full rounded-md border-slate-300"
                value={userForm.pin}
                onChange={(event) => setUserForm({ ...userForm, pin: event.target.value.replace(/\D/g, '').slice(0, 8) })}
                minLength={6}
                maxLength={8}
                pattern="\d{6,8}"
                title="PIN ต้องเป็นตัวเลข 6–8 หลัก"
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
                {positionNames.map((position) => <option key={position} value={position}>{position}</option>)}
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
              <button className="rounded-md bg-primary-600 py-3 font-black text-white">บันทึก</button>
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
    </div>
  );
}
