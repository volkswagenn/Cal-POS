import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, RefreshCw } from 'lucide-react';
import { notificationsApi, type ActivityItem } from '../../services/api/notificationsApi';
import { requestSync, subscribeSync } from '../../services/api/syncScheduler';
import { hasApiBaseUrl } from '../../services/api/client';

const LAST_READ_KEY = 'calpos_notif_last_read_at';

function actionLabel(table: string, action: string): string {
  if (action === 'delete') {
    switch (table) {
      case 'sales': return 'ลบบิลขาย';
      case 'products': return 'ลบสินค้า';
      case 'categories': return 'ลบหมวดหมู่';
      case 'users': return 'ลบผู้ใช้';
      default: return 'ลบข้อมูล';
    }
  }
  switch (table) {
    case 'sales': return 'มีการขายสินค้า';
    case 'products': return 'เพิ่ม/แก้ไขสินค้า';
    case 'categories': return 'เพิ่ม/แก้ไขหมวดหมู่';
    case 'users': return 'เพิ่ม/แก้ไขผู้ใช้';
    case 'settings': return 'แก้ไขตำแหน่ง/สิทธิ์';
    default: return 'อัปเดตข้อมูล';
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'เมื่อสักครู่';
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ชม.ที่แล้ว`;
  return `${Math.floor(hr / 24)} วันที่แล้ว`;
}

export function NotificationBell({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastReadAt, setLastReadAt] = useState<string>(
    () => localStorage.getItem(LAST_READ_KEY) ?? new Date(0).toISOString(),
  );
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const data = await notificationsApi.fetchActivity();
    setItems(data);
  }, []);

  // Initial load + refetch whenever a sync pull completes (driven by the
  // real-time WebSocket signal — no extra polling added).
  useEffect(() => {
    if (!hasApiBaseUrl) return;
    void notificationsApi.registerDevice();
    void load();
    let lastSig: string | null = null;
    const unsub = subscribeSync((s) => {
      const sig = s.lastSyncedAt;
      if (sig && sig !== lastSig) {
        lastSig = sig;
        void load();
      }
    });
    return unsub;
  }, [load]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const unreadCount = items.filter((i) => i.lastAt > lastReadAt).length;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      // Opening = mark everything read
      const now = new Date().toISOString();
      localStorage.setItem(LAST_READ_KEY, now);
      setLastReadAt(now);
      void load();
    }
  };

  const handleUpdate = async () => {
    setRefreshing(true);
    try {
      requestSync({ immediate: true }); // uses existing sync path, no logic change
      await new Promise((r) => setTimeout(r, 1200));
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  if (!hasApiBaseUrl) return null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label="การแจ้งเตือน"
        className={`relative flex h-9 w-9 items-center justify-center rounded-full ${
          tone === 'dark' ? 'text-white/90 hover:bg-white/15' : 'text-slate-600 hover:bg-slate-100'
        }`}
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-black text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="font-black text-slate-800">แจ้งเตือน</span>
            <button
              type="button"
              onClick={handleUpdate}
              disabled={refreshing}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold text-primary-600 hover:bg-primary-50 disabled:opacity-60"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
              อัปเดตข้อมูลร้าน
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-slate-400">
                <Bell size={32} className="opacity-40" />
                <span className="text-sm font-bold">ว่าง</span>
              </div>
            ) : (
              items.map((it, idx) => {
                const unread = it.lastAt > lastReadAt;
                return (
                  <div
                    key={`${it.deviceId}-${it.table}-${it.action}-${it.lastAt}-${idx}`}
                    className={`flex items-start gap-3 border-b border-slate-50 px-4 py-3 ${unread ? 'bg-primary-50/50' : ''}`}
                  >
                    <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${unread ? 'bg-primary-500' : 'bg-transparent'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-800">
                        <span className="text-primary-600">{it.deviceCode}</span>{' '}
                        {actionLabel(it.table, it.action)}
                        {it.count > 1 && <span className="text-slate-500"> {it.count} รายการ</span>}
                      </p>
                      <p className="mt-0.5 text-xs font-medium text-slate-400">{relativeTime(it.lastAt)}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
