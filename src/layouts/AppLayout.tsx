import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { AlertTriangle, Boxes, ClipboardList, DatabaseBackup, History, LayoutDashboard, LogOut, Menu, Printer, Send, Settings, Store, Users, Warehouse } from 'lucide-react';
import { useRef, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { usePermissions } from '../hooks/usePermissions';
import type { PermissionKey } from '../utils/permissions';
import { usePrinterLiveStatus } from '../hooks/usePrinterLiveStatus';
import { useAsync } from '../hooks/useAsync';
import { SettingsRepository } from '../db/repositories/SettingsRepository';
import { SyncQueueRepository } from '../db/syncQueue';
import { hasApiBaseUrl } from '../services/api/client';
import { formatDateTime } from '../utils/date';
import { useTapCounter } from '../hooks/useTapCounter';
import { enableMirrorMode } from '../stores/mirrorStore';
import { NotificationBell } from '../components/common/NotificationBell';

const BACKUP_WARN_MS = 7 * 24 * 60 * 60 * 1000;

const links: Array<{ to: string; label: string; icon: typeof LayoutDashboard; permission: PermissionKey; disabled?: boolean }> = [
  { to: '/dashboard', label: 'แดชบอร์ด', icon: LayoutDashboard, permission: 'dashboard' },
  { to: '/pos', label: 'ขายสินค้า', icon: ClipboardList, permission: 'pos' },
  { to: '/bills', label: 'ประวัติบิล', icon: History, permission: 'bill_history' },
  { to: '/send-report', label: 'ส่งรายงาน', icon: Send, permission: 'send_report' },
  { to: '/products', label: 'สินค้า/หมวดหมู่', icon: Boxes, permission: 'products' },
  { to: '/users', label: 'ผู้ใช้', icon: Users, permission: 'users' },
  { to: '/settings', label: 'ตั้งค่า', icon: Settings, permission: 'settings' },
  { to: '/backup', label: 'สำรองข้อมูล', icon: DatabaseBackup, permission: 'backup' },
];

function DisabledNavItem({ label, icon: Icon, compact = false }: { label: string; icon: typeof LayoutDashboard; compact?: boolean }) {
  if (compact) {
    return (
      <button type="button" disabled title="ไม่มีสิทธิ์ใช้งาน" className="flex min-h-14 cursor-not-allowed flex-col items-center justify-center gap-1 py-1 text-[11px] font-semibold text-slate-300">
        <Icon size={21} /> {label}
      </button>
    );
  }
  return (
    <button type="button" disabled title="ไม่มีสิทธิ์ใช้งาน" className="flex w-full cursor-not-allowed items-center gap-3 rounded-md px-4 py-3 font-semibold text-slate-300">
      <Icon size={20} /> {label}
    </button>
  );
}

export function AppLayout() {
  const [open, setOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pinned, setPinned] = useState(false);
  const lastBurgerClick = useRef(0);
  const user = useAuthStore((state) => state.user)!;
  const logout = useAuthStore((state) => state.logout);
  const { can, loading: permissionsLoading, isRoleOrphan } = usePermissions();
  const navigate = useNavigate();
  const printerStatus = usePrinterLiveStatus();
  const { data: lastBackupAt } = useAsync(() => SettingsRepository.getSetting('lastBackupAt'), []);
  const { data: deadCount } = useAsync(() => SyncQueueRepository.countDead(), []);
  const isBackupStale = lastBackupAt !== null && (!lastBackupAt || Date.now() - new Date(lastBackupAt).getTime() > BACKUP_WARN_MS);

  // Whether the data is actually safe on the cloud (so a reinstall won't lose
  // it). True only when the cloud is configured, at least one sync has
  // succeeded, and nothing is stuck in the dead-letter queue. Used to soften
  // the backup banner instead of always scaring the user.
  const lastCloudSyncAt = typeof localStorage !== 'undefined' ? localStorage.getItem('calpos_last_sync_at') : null;
  const cloudSafe = hasApiBaseUrl && !!lastCloudSyncAt && (deadCount ?? 0) === 0;

  const backupBannerMessage = lastBackupAt
    ? `สำรองข้อมูลล่าสุด: ${formatDateTime(lastBackupAt)} — แนะนำให้สำรองข้อมูลก่อนอัพเดตแอป`
    : cloudSafe
      ? 'ข้อมูลถูก sync ขึ้น cloud แล้ว ✓ — แนะนำสำรองไฟล์เพิ่มเพื่อความมั่นใจ'
      : !hasApiBaseUrl
        ? 'แอปนี้ไม่ได้เชื่อม cloud — หากติดตั้งแอปใหม่ ข้อมูลจะหาย กรุณาสำรองข้อมูล'
        : (deadCount ?? 0) > 0
          ? `มีข้อมูล ${deadCount} รายการ sync ขึ้น cloud ไม่สำเร็จ — กรุณาสำรองข้อมูล`
          : 'ยังไม่เคย sync ขึ้น cloud สำเร็จ — หากติดตั้งแอปใหม่ ข้อมูลจะหาย';
  // Soft (informational) when data is already safe on cloud; strong warning otherwise.
  const backupBannerSoft = cloudSafe || !!lastBackupAt;

  const { tap: tapLogo, count: tapLogoCount } = useTapCounter(4, () => {
    enableMirrorMode();
    navigate('/mirror-pos');
  }, 2000);

  const handleBurgerClick = () => {
    if (pinned) {
      setPinned(false);
      setSidebarCollapsed(true);
      setOpen(false);
      return;
    }
    const now = Date.now();
    const isDouble = now - lastBurgerClick.current < 350;
    lastBurgerClick.current = isDouble ? 0 : now;
    if (isDouble) {
      setPinned(true);
      setSidebarCollapsed(false);
      setOpen(true);
    } else {
      if (window.innerWidth >= 1024) setSidebarCollapsed((c) => !c);
      else setOpen(true);
    }
  };

  const onLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-[100dvh] bg-slate-100 pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
      <aside className={`fixed bottom-0 left-0 top-14 z-30 flex w-72 flex-col bg-white shadow-panel transition-transform lg:top-16 ${open ? 'translate-x-0' : '-translate-x-full'} ${sidebarCollapsed ? 'lg:-translate-x-full' : 'lg:translate-x-0'}`}>
        <nav className="flex-1 space-y-1 overflow-auto p-3">
          {links.map(({ to, label, icon: Icon, permission, disabled }) => {
            const isAllowed = can(permission) && !disabled;
            if (!isAllowed) {
              // ขณะโหลด permissions อยู่ → แสดง skeleton แทน disabled
              if (permissionsLoading) {
                return (
                  <button key={`${to}-${permission}`} type="button" disabled className="flex w-full animate-pulse cursor-default items-center gap-3 rounded-md px-4 py-3 font-semibold text-slate-200">
                    <Icon size={20} /> {label}
                  </button>
                );
              }
              return <DisabledNavItem key={`${to}-${permission}`} label={label} icon={Icon} />;
            }
            return (
              <NavLink key={`${to}-${permission}`} to={to} onClick={() => { if (!pinned) setOpen(false); }} className={({ isActive }) => `flex items-center gap-3 rounded-md px-4 py-3 font-semibold ${isActive ? 'bg-primary-50 text-primary-700' : 'text-slate-600 hover:bg-slate-100'}`}>
                <Icon size={20} /> {label}
              </NavLink>
            );
          })}
          <button onClick={onLogout} className="flex w-full items-center gap-3 rounded-md px-4 py-3 font-semibold text-red-600 hover:bg-red-50">
            <LogOut size={20} /> ออกจากระบบ
          </button>
        </nav>
        <div className="border-t border-slate-100 p-3">
          <button
            type="button"
            onClick={() => {
              navigate('/settings?tab=printer');
              setOpen(false);
            }}
            className="flex w-full items-center gap-3 rounded-lg bg-slate-50 px-4 py-3 text-left hover:bg-primary-50"
          >
            <div className="relative">
              <Printer className={printerStatus === 'connected' ? 'text-emerald-600' : 'text-red-600'} size={22} />
              <span className={`absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white ${printerStatus === 'connected' ? 'bg-emerald-500' : 'bg-red-500'}`} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-black text-slate-800">เครื่องพิมพ์</div>
              <div className={`text-xs font-bold ${printerStatus === 'connected' ? 'text-emerald-700' : 'text-red-600'}`}>
                {printerStatus === 'connected' ? 'เชื่อมต่อ' : 'ไม่ได้เชื่อมต่อ'}
              </div>
            </div>
          </button>
        </div>
      </aside>

      {open && !pinned && <button className="fixed bottom-0 left-0 right-0 top-14 z-20 bg-slate-900/30 lg:hidden" onClick={() => setOpen(false)} aria-label="ปิดเมนู" />}
      {!sidebarCollapsed && !pinned && <button className="fixed bottom-0 left-72 right-0 top-16 z-20 hidden cursor-default lg:block" onClick={() => setSidebarCollapsed(true)} aria-label="ย่อเมนู" />}

      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-slate-200 bg-white/95 px-3 backdrop-blur lg:h-16 lg:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            className={`rounded-md p-2 transition-colors ${pinned ? 'bg-primary-100 text-primary-700' : 'text-slate-700 hover:bg-slate-100'}`}
            onClick={handleBurgerClick}
            aria-label={pinned ? 'ปักหมุดเมนูอยู่ (คลิกเพื่อปิด)' : 'เมนู'}
            title={pinned ? 'Sidebar ถูกปักหมุดไว้ — คลิกเพื่อปิด' : 'คลิกเพื่อเปิด/ปิด | ดับเบิลคลิกเพื่อปักหมุด'}
          >
            <Menu />
          </button>
          <button
            type="button"
            onClick={tapLogo}
            className="select-none rounded px-1 text-2xl font-black text-primary-700"
            aria-label="Cal POS"
          >
            Cal POS
          </button>
          <div className="hidden min-w-0 truncate text-sm font-semibold text-slate-500 sm:block">ระบบขายหน้าร้านแบบออฟไลน์</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <NotificationBell tone="light" />
          <button
            type="button"
            onClick={() => navigate('/front-pos')}
            className="flex items-center gap-1 rounded-md px-3 py-2 text-xs font-black text-slate-600 hover:bg-primary-50 hover:text-primary-700"
          >
            <Store size={17} /> หน้าขาย
          </button>
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-1 rounded-md bg-primary-600 px-3 py-2 text-xs font-black text-white hover:bg-primary-700"
          >
            <Warehouse size={17} /> หลังบ้าน
          </button>
          <div className="hidden text-right md:block">
            <div className="font-bold">{user.displayName}</div>
            <div className="text-xs text-slate-500">{user.role}</div>
          </div>
        </div>
      </header>

      <main className={`pt-14 transition-[margin] lg:pt-16 ${sidebarCollapsed ? 'lg:ml-0' : 'lg:ml-72'}`}>
        {isBackupStale && (
          <div className={`flex items-center justify-between gap-3 px-4 py-2 text-sm font-bold text-white ${backupBannerSoft ? 'bg-sky-500' : 'bg-amber-500'}`}>
            <span>{backupBannerMessage}</span>
            <button
              onClick={() => navigate('/backup')}
              className="shrink-0 rounded bg-white/20 px-3 py-1 hover:bg-white/30"
            >
              สำรองข้อมูล
            </button>
          </div>
        )}
        {isRoleOrphan && (
          <div className="flex items-center gap-3 bg-red-600 px-4 py-2 text-sm font-bold text-white">
            <AlertTriangle size={16} className="shrink-0" />
            <span>
              ตำแหน่ง <strong>&ldquo;{user.role}&rdquo;</strong> ไม่มีในระบบนี้ —
              กำลังดึงข้อมูลสิทธิ์จาก Cloud กรุณารอสักครู่ หรือ{' '}
              <button
                className="underline hover:no-underline"
                onClick={() => window.location.reload()}
              >
                รีเฟรชหน้า
              </button>
            </span>
          </div>
        )}
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden no-print">
        {links.slice(1, 4).map(({ to, label, icon: Icon, permission }) => (
          can(permission) ? (
            <NavLink key={`${to}-${permission}`} to={to} className={({ isActive }) => `flex min-h-14 flex-col items-center justify-center gap-1 py-1 text-[11px] font-semibold ${isActive ? 'text-primary-700' : 'text-slate-500'}`}>
              <Icon size={21} /> {label}
            </NavLink>
          ) : permissionsLoading ? (
            <button key={`${to}-${permission}`} type="button" disabled className="flex min-h-14 flex-col items-center justify-center gap-1 py-1 text-[11px] font-semibold text-slate-300 animate-pulse">
              <Icon size={21} /> {label}
            </button>
          ) : (
            <DisabledNavItem key={`${to}-${permission}`} label={label} icon={Icon} compact />
          )
        ))}
        {can('dashboard') ? (
          <NavLink to="/dashboard" className={({ isActive }) => `flex min-h-14 flex-col items-center justify-center gap-1 py-1 text-[11px] font-semibold ${isActive ? 'text-primary-700' : 'text-slate-500'}`}>
            <Menu size={21} /> เมนู
          </NavLink>
        ) : permissionsLoading ? (
          <button type="button" disabled className="flex min-h-14 flex-col items-center justify-center gap-1 py-1 text-[11px] font-semibold text-slate-300 animate-pulse">
            <Menu size={21} /> เมนู
          </button>
        ) : (
          <DisabledNavItem label="เมนู" icon={Menu} compact />
        )}
      </nav>
    </div>
  );
}
