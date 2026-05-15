import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle, Cloud, CloudOff, Download, History, RefreshCw, ShieldAlert, Trash2, Upload, Wifi, WifiOff } from 'lucide-react';
import { useSyncStatus, requestSync } from '../services/api/syncScheduler';
import { SyncQueueRepository } from '../db/syncQueue';
import { UserRepository } from '../db/repositories/UserRepository';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/common/Card';
import { Modal } from '../components/common/Modal';
import { SettingsRepository } from '../db/repositories/SettingsRepository';
import { useAsync } from '../hooks/useAsync';
import { useToast } from '../components/common/Toast';
import { formatDateTime } from '../utils/date';
import { seedDatabase } from '../db/seed';
import { useAuthStore } from '../stores/authStore';
import { hasApiBaseUrl } from '../services/api/client';
import { backupApi, type CloudBackup } from '../services/api/backupApi';
import { downloadBlob } from '../utils/exportFile';

type ClearStep = 'confirm1' | 'confirm2' | 'pin';
type ClearSalesStep = 'confirm' | 'pin';

export function BackupPage() {
  const { data: lastBackupAt, reload: reloadBackupTime } = useAsync(() => SettingsRepository.getSetting('lastBackupAt'), []);
  const { data: cloudBackups, reload: reloadCloudBackups } = useAsync(
    () => hasApiBaseUrl && navigator.onLine ? backupApi.list().then((response) => response.backups) : Promise.resolve([] as CloudBackup[]),
    [],
  );
  const [clearStep, setClearStep] = useState<ClearStep | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const [clearAllPin, setClearAllPin] = useState('');
  const [clearAllPinError, setClearAllPinError] = useState('');
  const clearAllPinRef = useRef<HTMLInputElement>(null);
  const [clearSalesStep, setClearSalesStep] = useState<ClearSalesStep | null>(null);
  const [isClearingSales, setIsClearingSales] = useState(false);
  const [salesPin, setSalesPin] = useState('');
  const [salesPinError, setSalesPinError] = useState('');
  const salesPinRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isCloudBusy, setIsCloudBusy] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();
  const logout = useAuthStore((state) => state.logout);

  const exportData = async () => {
    try {
      const data = await SettingsRepository.exportAllData();
      await SettingsRepository.setSetting('lastBackupAt', new Date().toISOString());
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `calpos-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
      toast('ส่งออกข้อมูลสำเร็จ', 'success');
      reloadBackupTime();
    } catch {
      toast('ส่งออกข้อมูลไม่สำเร็จ', 'error');
    }
  };

  const importData = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    setIsImporting(true);
    try {
      const parsed = JSON.parse(await file.text());
      await SettingsRepository.importAllData(parsed);
      toast('นำเข้าข้อมูลสำเร็จ กรุณาเข้าสู่ระบบใหม่', 'success');
      logout();
      navigate('/login');
    } catch {
      toast('นำเข้าข้อมูลไม่สำเร็จ ไฟล์อาจเสียหายหรือไม่ใช่ไฟล์ที่ถูกต้อง', 'error');
    } finally {
      setIsImporting(false);
    }
  };

  const clearAllData = async () => {
    if (clearAllPin.length !== 6) {
      setClearAllPinError('PIN ต้องเป็นตัวเลข 6 หลักเท่านั้น');
      return;
    }
    setClearAllPinError('');
    setIsClearing(true);
    try {
      const admin = await UserRepository.loginByPin(clearAllPin);
      if (!admin || admin.role !== 'Admin') {
        setClearAllPinError('PIN ไม่ถูกต้อง');
        setIsClearing(false);
        return;
      }

      // 1. Clear cloud first (so other devices won't re-push old data back)
      if (hasApiBaseUrl && navigator.onLine) {
        try {
          await backupApi.clearAllData(clearAllPin);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'ล้างข้อมูล cloud ไม่สำเร็จ';
          toast(`เตือน: ${message} (จะล้างเฉพาะเครื่องนี้)`, 'error');
        }
      }

      // 2. Clear local Dexie
      await SettingsRepository.clearAllData();
      await seedDatabase();
      toast('ล้างข้อมูลสำเร็จ ระบบถูกรีเซ็ตเป็นค่าเริ่มต้นแล้ว', 'success');
      setClearStep(null);
      logout();
      navigate('/login');
    } catch {
      toast('ล้างข้อมูลไม่สำเร็จ', 'error');
    } finally {
      setIsClearing(false);
    }
  };

  const clearSalesHistory = async () => {
    if (salesPin.length !== 6) {
      setSalesPinError('PIN ต้องเป็นตัวเลข 6 หลักเท่านั้น');
      return;
    }
    setIsClearingSales(true);
    setSalesPinError('');
    try {
      if (hasApiBaseUrl && navigator.onLine) {
        await backupApi.clearSalesHistory(salesPin);
      }
      await SettingsRepository.clearSalesHistory();
      toast('ล้างประวัติการขายทั้งหมดสำเร็จ', 'success');
      setClearSalesStep(null);
      setSalesPin('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      setSalesPinError(msg.includes('PIN') ? 'PIN ไม่ถูกต้อง' : 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setIsClearingSales(false);
    }
  };

  const createCloudBackup = async () => {
    if (!hasApiBaseUrl || !navigator.onLine) {
      toast('ยังไม่ได้ตั้งค่า API หรืออุปกรณ์ออฟไลน์อยู่', 'error');
      return;
    }

    setIsCloudBusy(true);
    try {
      const { blob, fileName } = await backupApi.download();
      downloadBlob(blob, fileName ?? `calpos-cloud-backup-${new Date().toISOString().slice(0, 10)}.json`);
      await SettingsRepository.setSetting('lastBackupAt', new Date().toISOString());
      toast('สร้าง Cloud Backup สำเร็จ', 'success');
      reloadBackupTime();
      reloadCloudBackups();
    } catch {
      toast('สร้าง Cloud Backup ไม่สำเร็จ', 'error');
    } finally {
      setIsCloudBusy(false);
    }
  };

  const restoreCloudBackup = async (backup: CloudBackup) => {
    if (!window.confirm(`Restore backup ${backup.fileName}? ข้อมูลบน cloud ปัจจุบันจะถูกแทนที่`)) return;

    setIsCloudBusy(true);
    try {
      await backupApi.restore(backup.id);
      toast('กู้คืน Cloud Backup สำเร็จ กรุณาเข้าสู่ระบบใหม่', 'success');
      logout();
      navigate('/login');
    } catch {
      toast('กู้คืน Cloud Backup ไม่สำเร็จ', 'error');
    } finally {
      setIsCloudBusy(false);
    }
  };

  const deleteCloudBackup = async (backup: CloudBackup) => {
    if (!window.confirm(`Delete backup ${backup.fileName}?`)) return;

    setIsCloudBusy(true);
    try {
      await backupApi.delete(backup.id);
      toast('ลบ Cloud Backup สำเร็จ', 'success');
      reloadCloudBackups();
    } catch {
      toast('ลบ Cloud Backup ไม่สำเร็จ', 'error');
    } finally {
      setIsCloudBusy(false);
    }
  };

  const { isOnline, isSyncing, lastSyncError, lastSyncedAt } = useSyncStatus();
  const canSync = isOnline && hasApiBaseUrl;
  const [deadLetterCount, setDeadLetterCount] = useState(0);
  const [isResetting, setIsResetting] = useState(false);

  // Keep dead-letter count fresh on this page
  useEffect(() => {
    if (!hasApiBaseUrl) return;
    void SyncQueueRepository.countDead().then(setDeadLetterCount);
  }, [isSyncing, lastSyncedAt]);

  const handleSyncNow = () => requestSync({ immediate: true });

  const handleResetAndForceSync = async () => {
    setIsResetting(true);
    try {
      await SyncQueueRepository.resetFailed();
      localStorage.removeItem('calpos_last_sync_at');
      requestSync({ immediate: true });
    } finally {
      setIsResetting(false);
    }
  };

  const backupAge = lastBackupAt ? Math.floor((Date.now() - new Date(lastBackupAt).getTime()) / (1000 * 60 * 60 * 24)) : null;
  const isBackupStale = backupAge === null || backupAge > 7;

  return (
    <div className="p-4 md:p-6">
      <PageHeader title="สำรองข้อมูล" subtitle="จัดการการสำรองและกู้คืนข้อมูลทั้งหมดของระบบ" />

      <div className="max-w-2xl space-y-4">

        {/* ── JSON Backup ── */}
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-100">
                <Download size={20} className="text-primary-600" />
              </div>
              <div>
                <h2 className="font-black text-slate-900">สำรอง/กู้คืนผ่านไฟล์ JSON</h2>
                <p className="text-xs font-medium text-slate-500">ส่งออกข้อมูลทั้งหมดเป็นไฟล์ และนำเข้ากลับได้ทุกเมื่อ</p>
              </div>
            </div>
          </div>

          <div className="p-5 space-y-4">
            {/* Last backup status */}
            <div className={`flex items-center gap-3 rounded-lg border p-3 ${isBackupStale ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
              {isBackupStale
                ? <AlertTriangle size={18} className="shrink-0 text-amber-600" />
                : <CheckCircle size={18} className="shrink-0 text-emerald-600" />
              }
              <div className="text-sm">
                {lastBackupAt
                  ? (
                    <span className={`font-bold ${isBackupStale ? 'text-amber-800' : 'text-emerald-800'}`}>
                      สำรองข้อมูลล่าสุด: {formatDateTime(lastBackupAt)}
                      {backupAge !== null && backupAge > 0 && ` (${backupAge} วันที่แล้ว)`}
                    </span>
                  )
                  : <span className="font-bold text-amber-800">ยังไม่เคยสำรองข้อมูล</span>
                }
              </div>
            </div>

            {/* Export */}
            <div className="rounded-lg border border-slate-200 p-4">
              <h3 className="mb-1 text-sm font-black text-slate-800">ส่งออกข้อมูล (Export)</h3>
              <p className="mb-3 text-xs font-medium text-slate-500">
                บันทึกข้อมูลทั้งหมด ได้แก่ สินค้า หมวดหมู่ ประวัติการขาย ผู้ใช้ และการตั้งค่า ลงในไฟล์ JSON
              </p>
              <button
                onClick={exportData}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-primary-600 py-2.5 font-bold text-white hover:bg-primary-700"
              >
                <Download size={17} /> Export JSON
              </button>
            </div>

            {/* Import */}
            <div className="rounded-lg border border-slate-200 p-4">
              <h3 className="mb-1 text-sm font-black text-slate-800">นำเข้าข้อมูล (Import)</h3>
              <p className="mb-3 text-xs font-medium text-slate-500">
                โหลดข้อมูลจากไฟล์ JSON ที่เคย Export ไว้ <span className="font-bold text-red-600">ข้อมูลปัจจุบันจะถูกแทนที่ทั้งหมด</span>
              </p>
              <label className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border-2 border-dashed border-slate-300 py-2.5 font-bold text-slate-700 transition hover:border-primary-400 hover:bg-primary-50 hover:text-primary-700 ${isImporting ? 'pointer-events-none opacity-60' : ''}`}>
                {isImporting ? <RefreshCw size={17} className="animate-spin" /> : <Upload size={17} />}
                {isImporting ? 'กำลังนำเข้า...' : 'เลือกไฟล์ JSON เพื่อนำเข้า'}
                <input type="file" accept="application/json" className="hidden" onChange={importData} disabled={isImporting} />
              </label>
            </div>
          </div>
        </Card>

        {/* ── Cloud Backup ── */}
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-100">
                <Cloud size={20} className="text-sky-600" />
              </div>
              <div>
                <h2 className="font-black text-slate-900">Cloud Backup</h2>
                <p className="text-xs font-medium text-slate-500">สำรอง snapshot ไปยัง backend storage และกู้คืนจากรายการ backup</p>
              </div>
            </div>
          </div>

          <div className="space-y-4 p-5">
            <div className={`flex items-center gap-3 rounded-lg border p-3 ${hasApiBaseUrl ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
              {hasApiBaseUrl
                ? <CheckCircle size={18} className="shrink-0 text-emerald-600" />
                : <CloudOff size={18} className="shrink-0 text-amber-600" />
              }
              <span className={`text-sm font-bold ${hasApiBaseUrl ? 'text-emerald-800' : 'text-amber-800'}`}>
                {hasApiBaseUrl ? 'พร้อมเชื่อมต่อ Cloud Backup' : 'ยังไม่ได้ตั้งค่า VITE_API_BASE_URL'}
              </span>
            </div>

            <button
              onClick={createCloudBackup}
              disabled={isCloudBusy || !hasApiBaseUrl}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-sky-600 py-2.5 font-bold text-white hover:bg-sky-700 disabled:opacity-60"
            >
              {isCloudBusy ? <RefreshCw size={17} className="animate-spin" /> : <Cloud size={17} />}
              สร้าง Cloud Backup
            </button>

            <div className="rounded-lg border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <h3 className="text-sm font-black text-slate-800">รายการ Cloud Backup</h3>
                <button
                  onClick={reloadCloudBackups}
                  disabled={isCloudBusy || !hasApiBaseUrl}
                  className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-60"
                >
                  Refresh
                </button>
              </div>
              <div className="divide-y divide-slate-100">
                {(cloudBackups ?? []).length === 0 && (
                  <div className="px-4 py-5 text-sm font-bold text-slate-500">ยังไม่มี Cloud Backup</div>
                )}
                {(cloudBackups ?? []).map((backup) => (
                  <div key={backup.id} className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
                    <div>
                      <div className="break-all text-sm font-black text-slate-800">{backup.fileName}</div>
                      <div className="mt-1 text-xs font-medium text-slate-500">
                        {formatDateTime(backup.createdAt)} • {(backup.sizeBytes / 1024).toFixed(1)} KB
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => restoreCloudBackup(backup)}
                        disabled={isCloudBusy}
                        className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => deleteCloudBackup(backup)}
                        disabled={isCloudBusy}
                        className="rounded-md bg-red-600 px-3 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-60"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* ── Google Account Backup ── */}
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
                <Cloud size={20} className="text-blue-600" />
              </div>
              <div>
                <h2 className="font-black text-slate-900">สำรอง/กู้คืนผ่าน Google Account</h2>
                <p className="text-xs font-medium text-slate-500">Android Auto Backup จัดการให้อัตโนมัติ</p>
              </div>
            </div>
          </div>

          <div className="p-5 space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
              <CheckCircle size={16} className="shrink-0 text-emerald-600" />
              <span className="text-sm font-bold text-emerald-800">เปิดใช้งานแล้ว — ระบบ backup ให้อัตโนมัติ</span>
            </div>

            <div className="space-y-2 text-sm">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="mb-2 font-black text-slate-800">การสำรองข้อมูลอัตโนมัติ</p>
                <ul className="space-y-1 text-xs font-medium text-slate-600">
                  <li>• Android จะ backup ข้อมูลแอปไปยัง Google Account โดยอัตโนมัติ</li>
                  <li>• Backup เกิดขึ้นเมื่อ: ชาร์จอยู่ + Wi-Fi + ไม่ได้ใช้งาน (ประมาณวันละครั้ง)</li>
                  <li>• ข้อมูลที่ backup ได้แก่ สินค้า หมวดหมู่ ประวัติการขาย และการตั้งค่าทั้งหมด</li>
                </ul>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="mb-2 font-black text-slate-800">การกู้คืนข้อมูลอัตโนมัติ</p>
                <ul className="space-y-1 text-xs font-medium text-slate-600">
                  <li>• ติดตั้งแอป APK นี้บนเครื่องที่ login Google Account เดิม</li>
                  <li>• Android จะ restore ข้อมูลให้อัตโนมัติหลังติดตั้ง</li>
                  <li>• ใช้ได้ทั้งกู้คืนบนเครื่องเดิม และย้ายไปเครื่องใหม่</li>
                </ul>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="mb-1 font-black text-amber-800">ข้อควรรู้</p>
                <ul className="space-y-1 text-xs font-medium text-amber-700">
                  <li>• ต้องใช้ keystore ไฟล์เดิมในการ build APK ทุกครั้ง</li>
                  <li>• Google backup ไม่ใช่ real-time — ข้อมูลอาจล้าหลังได้สูงสุด 1 วัน</li>
                  <li>• แนะนำ Export JSON ทุก 7 วันเพื่อความปลอดภัยเพิ่มเติม</li>
                </ul>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 text-xs font-black text-slate-700">จัดการ Google Backup บนเครื่อง Android</p>
              <p className="text-xs font-medium text-slate-500">
                Settings → Google → Backup → App data → Cal POS
              </p>
            </div>
          </div>
        </Card>

        {/* ── Cloud Sync Status ── */}
        {hasApiBaseUrl && (
          <Card className="overflow-hidden">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100">
                  <RefreshCw size={20} className="text-violet-600" />
                </div>
                <div>
                  <h2 className="font-black text-slate-900">สถานะ Cloud Sync</h2>
                  <p className="text-xs font-medium text-slate-500">ตรวจสอบและบังคับ sync ข้อมูลระหว่างเครื่องทันที</p>
                </div>
              </div>
            </div>

            <div className="p-5 space-y-3">
              {/* Connection status */}
              <div className={`flex items-center gap-3 rounded-lg border p-3 ${isOnline ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
                {isOnline
                  ? <Wifi size={18} className="shrink-0 text-emerald-600" />
                  : <WifiOff size={18} className="shrink-0 text-slate-400" />
                }
                <span className={`text-sm font-bold ${isOnline ? 'text-emerald-800' : 'text-slate-500'}`}>
                  {isOnline ? (isSyncing ? 'กำลัง sync...' : 'ออนไลน์ — พร้อม sync') : 'ออฟไลน์'}
                </span>
                {isSyncing && <RefreshCw size={15} className="ml-auto animate-spin text-violet-500" />}
              </div>

              {/* Last synced at */}
              {lastSyncedAt && (
                <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600">
                  <CheckCircle size={13} className="shrink-0 text-emerald-500" />
                  sync ล่าสุด: {new Date(lastSyncedAt).toLocaleString('th-TH')}
                </div>
              )}

              {/* Dead letter warning */}
              {deadLetterCount > 0 && (
                <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
                  <div className="flex-1">
                    <p className="text-sm font-black text-amber-800">มี {deadLetterCount} รายการ sync ไม่สำเร็จ</p>
                    <p className="mt-0.5 text-xs font-medium text-amber-700">
                      ข้อมูลยังอยู่ในเครื่องนี้ แต่ยังไม่ได้ส่งขึ้น cloud กดปุ่ม "รีเซ็ต &amp; Force Sync" เพื่อลองใหม่
                    </p>
                  </div>
                </div>
              )}

              {/* Sync error */}
              {lastSyncError && (
                <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3">
                  <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600" />
                  <p className="text-xs font-medium text-red-700 break-all">{lastSyncError}</p>
                </div>
              )}

              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleSyncNow}
                  disabled={!canSync || isSyncing}
                  className="flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  <RefreshCw size={15} className={isSyncing ? 'animate-spin' : ''} />
                  Sync Now
                </button>
                <button
                  onClick={handleResetAndForceSync}
                  disabled={!canSync || isSyncing || isResetting}
                  className="flex items-center justify-center gap-2 rounded-md bg-violet-600 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60"
                >
                  {isResetting || isSyncing
                    ? <RefreshCw size={15} className="animate-spin" />
                    : <RefreshCw size={15} />
                  }
                  รีเซ็ต &amp; Force Sync
                </button>
              </div>
              <p className="text-xs font-medium text-slate-500 text-center">
                "รีเซ็ต &amp; Force Sync" จะล้าง cursor และดึงข้อมูลทั้งหมดจาก cloud ใหม่ ใช้เมื่อ sync ค้างหรือข้อมูลไม่ตรงกัน
              </p>
            </div>
          </Card>
        )}

        {/* ── Danger Zone ── */}
        <Card className="overflow-hidden border border-red-200">
          <div className="border-b border-red-200 bg-red-50 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                <ShieldAlert size={20} className="text-red-600" />
              </div>
              <div>
                <h2 className="font-black text-red-900">ล้างข้อมูลทั้งหมด</h2>
                <p className="text-xs font-medium text-red-600">ดำเนินการนี้ไม่สามารถย้อนกลับได้</p>
              </div>
            </div>
          </div>

          <div className="p-5 space-y-4">

            {/* ── ล้างประวัติการขาย ── */}
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
              <h3 className="mb-1 text-sm font-black text-orange-900">ล้างประวัติการขายทั้งหมด</h3>
              <p className="mb-3 text-xs font-medium text-orange-700">
                ลบเฉพาะรายการขาย รายการสินค้า การชำระเงิน และส่วนลดทั้งหมด
                <br />สินค้า หมวดหมู่ ผู้ใช้ และการตั้งค่า<span className="font-black">จะไม่ถูกลบ</span>
                <br />ต้องยืนยัน PIN ของ Admin เพื่อดำเนินการ
              </p>
              <button
                onClick={() => { setSalesPin(''); setSalesPinError(''); setClearSalesStep('confirm'); }}
                className="flex w-full items-center justify-center gap-2 rounded-md border-2 border-orange-300 bg-white py-2.5 font-bold text-orange-700 hover:bg-orange-600 hover:text-white transition"
              >
                <History size={17} /> ล้างประวัติการขาย
              </button>
            </div>

            {/* ── ล้างข้อมูลทั้งหมด ── */}
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <h3 className="mb-1 text-sm font-black text-red-900">ล้างข้อมูลทั้งหมดและรีเซ็ตระบบ</h3>
              <ul className="mb-3 space-y-1 text-xs font-medium text-red-700">
                <li>• ข้อมูลสินค้า หมวดหมู่ ผู้ใช้ และการตั้งค่าทั้งหมดจะถูกลบ</li>
                <li>• ประวัติการขายและรายงานทั้งหมดจะหายถาวร</li>
                <li>• ระบบจะรีเซ็ตกลับเป็นค่าเริ่มต้น (admin/cashier)</li>
                <li>• <span className="font-black">แนะนำให้ Export JSON ก่อนดำเนินการ</span></li>
              </ul>
              <button
                onClick={() => setClearStep('confirm1')}
                className="flex w-full items-center justify-center gap-2 rounded-md border-2 border-red-300 bg-white py-2.5 font-bold text-red-700 hover:bg-red-600 hover:text-white transition"
              >
                <Trash2 size={17} /> ล้างข้อมูลทั้งหมด
              </button>
            </div>
          </div>
        </Card>
      </div>

      {/* ── Confirm Step 1 ── */}
      {clearStep === 'confirm1' && (
        <Modal title="ยืนยันการล้างข้อมูล" onClose={() => setClearStep(null)}>
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
              <AlertTriangle size={22} className="mt-0.5 shrink-0 text-red-600" />
              <div>
                <p className="font-black text-red-900">คุณกำลังจะล้างข้อมูลทั้งหมดในระบบ</p>
                <p className="mt-1 text-sm font-medium text-red-700">
                  ข้อมูลสินค้า ประวัติการขาย ผู้ใช้ และการตั้งค่าทั้งหมดจะถูกลบอย่างถาวร<br />
                  การกระทำนี้ไม่สามารถย้อนกลับได้
                </p>
              </div>
            </div>
            <p className="text-sm font-bold text-slate-700">คุณได้สำรองข้อมูลก่อนดำเนินการแล้วหรือยัง?</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                className="rounded-md bg-slate-100 py-2.5 font-bold text-slate-700 hover:bg-slate-200"
                onClick={() => setClearStep(null)}
              >
                ยกเลิก
              </button>
              <button
                className="rounded-md bg-red-600 py-2.5 font-black text-white hover:bg-red-700"
                onClick={() => setClearStep('confirm2')}
              >
                ดำเนินการต่อ
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Confirm Step 2 ── */}
      {clearStep === 'confirm2' && (
        <Modal title="ยืนยันครั้งสุดท้าย" onClose={() => setClearStep(null)}>
          <div className="space-y-4">
            <div className="rounded-lg border-2 border-red-400 bg-red-50 p-4 text-center">
              <Trash2 size={32} className="mx-auto mb-2 text-red-600" />
              <p className="font-black text-red-900">ล้างข้อมูลทั้งหมดและรีเซ็ตระบบ</p>
              <p className="mt-1 text-sm font-medium text-red-700">ข้อมูลทั้งหมดจะหายถาวร ไม่สามารถกู้คืนได้</p>
            </div>
            <div className="flex items-center gap-2 rounded-md bg-slate-100 p-3 text-xs font-medium text-slate-600">
              <CloudOff size={15} className="shrink-0 text-slate-400" />
              หากต้องการล้าง Google Backup ด้วย ให้ไปที่ Settings → Google → Backup บนเครื่อง Android ด้วย
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                className="rounded-md bg-slate-100 py-2.5 font-bold text-slate-700 hover:bg-slate-200"
                onClick={() => setClearStep(null)}
              >
                ยกเลิก
              </button>
              <button
                className="flex items-center justify-center gap-2 rounded-md bg-red-600 py-2.5 font-black text-white hover:bg-red-700"
                onClick={() => { setClearAllPin(''); setClearAllPinError(''); setClearStep('pin'); setTimeout(() => clearAllPinRef.current?.focus(), 100); }}
              >
                <Trash2 size={16} /> ดำเนินการต่อ
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Confirm Step PIN ── */}
      {clearStep === 'pin' && (
        <Modal title="ใส่ PIN Admin เพื่อยืนยัน" onClose={() => setClearStep(null)}>
          <div className="space-y-4">
            <div className="rounded-lg border-2 border-red-400 bg-red-50 p-4 text-center">
              <Trash2 size={32} className="mx-auto mb-2 text-red-600" />
              <p className="font-black text-red-900">ล้างข้อมูลทั้งหมดและรีเซ็ตระบบ</p>
              <p className="mt-1 text-sm font-medium text-red-700">การกระทำนี้ไม่สามารถย้อนกลับได้</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-black text-slate-700">PIN Admin (6 หลัก)</label>
              <input
                ref={clearAllPinRef}
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={clearAllPin}
                onChange={(e) => { setClearAllPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setClearAllPinError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !isClearing) clearAllData(); }}
                placeholder="••••••"
                className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-center text-lg font-black tracking-widest focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200"
              />
              {clearAllPinError && (
                <p className="mt-1.5 flex items-center gap-1.5 text-sm font-bold text-red-600">
                  <AlertTriangle size={14} /> {clearAllPinError}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                className="rounded-md bg-slate-100 py-2.5 font-bold text-slate-700 hover:bg-slate-200"
                onClick={() => setClearStep(null)}
                disabled={isClearing}
              >
                ยกเลิก
              </button>
              <button
                className="flex items-center justify-center gap-2 rounded-md bg-red-600 py-2.5 font-black text-white hover:bg-red-700 disabled:opacity-60"
                onClick={clearAllData}
                disabled={isClearing || clearAllPin.length !== 6}
              >
                {isClearing ? <RefreshCw size={16} className="animate-spin" /> : <Trash2 size={16} />}
                {isClearing ? 'กำลังล้างข้อมูล...' : 'ยืนยันล้างข้อมูล'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Clear Sales Confirm ── */}
      {clearSalesStep === 'confirm' && (
        <Modal title="ล้างประวัติการขายทั้งหมด" onClose={() => setClearSalesStep(null)}>
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 p-4">
              <AlertTriangle size={22} className="mt-0.5 shrink-0 text-orange-600" />
              <div>
                <p className="font-black text-orange-900">ข้อมูลต่อไปนี้จะถูกลบอย่างถาวร</p>
                <ul className="mt-2 space-y-1 text-sm font-medium text-orange-700">
                  <li>• รายการขายทั้งหมด</li>
                  <li>• รายการสินค้าในแต่ละบิล</li>
                  <li>• ประวัติการชำระเงิน</li>
                  <li>• รายการส่วนลดทั้งหมด</li>
                </ul>
              </div>
            </div>
            <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3 text-sm font-medium text-emerald-800">
              สินค้า หมวดหมู่ ผู้ใช้ และการตั้งค่า <span className="font-black">จะไม่ถูกลบ</span>
            </div>
            <p className="text-sm font-bold text-slate-700">คุณได้สำรองข้อมูลก่อนดำเนินการแล้วหรือยัง?</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                className="rounded-md bg-slate-100 py-2.5 font-bold text-slate-700 hover:bg-slate-200"
                onClick={() => setClearSalesStep(null)}
              >
                ยกเลิก
              </button>
              <button
                className="rounded-md bg-orange-600 py-2.5 font-black text-white hover:bg-orange-700"
                onClick={() => { setClearSalesStep('pin'); setTimeout(() => salesPinRef.current?.focus(), 100); }}
              >
                ดำเนินการต่อ
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Clear Sales PIN ── */}
      {clearSalesStep === 'pin' && (
        <Modal title="ใส่ PIN Admin เพื่อยืนยัน" onClose={() => setClearSalesStep(null)}>
          <div className="space-y-4">
            <div className="rounded-lg border-2 border-orange-300 bg-orange-50 p-4 text-center">
              <History size={32} className="mx-auto mb-2 text-orange-600" />
              <p className="font-black text-orange-900">ล้างประวัติการขายทั้งหมด</p>
              <p className="mt-1 text-sm font-medium text-orange-700">การกระทำนี้ไม่สามารถย้อนกลับได้</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-black text-slate-700">PIN Admin (6 หลัก)</label>
              <input
                ref={salesPinRef}
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={salesPin}
                onChange={(e) => { setSalesPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setSalesPinError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !isClearingSales) clearSalesHistory(); }}
                placeholder="••••••"
                className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-center text-lg font-black tracking-widest focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
              />
              {salesPinError && (
                <p className="mt-1.5 flex items-center gap-1.5 text-sm font-bold text-red-600">
                  <AlertTriangle size={14} /> {salesPinError}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                className="rounded-md bg-slate-100 py-2.5 font-bold text-slate-700 hover:bg-slate-200"
                onClick={() => setClearSalesStep(null)}
                disabled={isClearingSales}
              >
                ยกเลิก
              </button>
              <button
                className="flex items-center justify-center gap-2 rounded-md bg-orange-600 py-2.5 font-black text-white hover:bg-orange-700 disabled:opacity-60"
                onClick={clearSalesHistory}
                disabled={isClearingSales || salesPin.length !== 6}
              >
                {isClearingSales ? <RefreshCw size={16} className="animate-spin" /> : <History size={16} />}
                {isClearingSales ? 'กำลังล้างข้อมูล...' : 'ยืนยันล้างประวัติ'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
