import { useState } from 'react';
import { Check, Link2Off, MonitorSmartphone, Printer, Unlock, X } from 'lucide-react';
import { Card } from '../common/Card';
import { hasApiBaseUrl } from '../../services/api/client';
import { useSubPos, type PendingApproval } from '../../hooks/useSubPos';

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-8 w-14 shrink-0 rounded-full transition ${checked ? 'bg-primary-600' : 'bg-slate-300'} disabled:opacity-60`}
    >
      <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? 'left-7' : 'left-1'}`} />
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'active') return <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-black text-emerald-700">เชื่อมต่อแล้ว</span>;
  if (status === 'pending') return <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-black text-amber-700">รอการอนุมัติ</span>;
  return <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-black text-slate-600">ยังไม่เชื่อมต่อ</span>;
}

function PendingApprovalRow({
  approval,
  onApprove,
  onReject,
}: {
  approval: PendingApproval;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const handle = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <MonitorSmartphone size={15} className="shrink-0 text-amber-700" />
          <span className="font-black text-amber-900">{approval.subDeviceCode}</span>
        </div>
        <p className="mt-0.5 text-xs text-amber-700">ขอเชื่อมต่อเพื่อสั่งงานเครื่องพิมพ์และลิ้นชัก</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void handle(onApprove)}
          className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          <Check size={14} /> อนุมัติ
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handle(onReject)}
          className="flex items-center gap-1 rounded-md bg-slate-200 px-3 py-1.5 text-sm font-black text-slate-700 hover:bg-slate-300 disabled:opacity-60"
        >
          <X size={14} /> ปฏิเสธ
        </button>
      </div>
    </div>
  );
}

export function SubPosTab() {
  const {
    deviceCode,
    linksAsMain,
    pendingApprovals,
    approveLink,
    rejectLink,
    revokeLink,
    reloadLinks,
    mainCode,
    linkStatus,
    usePrinter,
    useDrawer,
    setUsePrinter,
    setUseDrawer,
    requestLink,
    clearSubLink,
  } = useSubPos();

  const [inputCode, setInputCode] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [reqError, setReqError] = useState('');

  const handleRequestLink = async () => {
    if (!inputCode.trim()) return;
    setReqError('');
    setRequesting(true);
    try {
      await requestLink(inputCode);
      setInputCode('');
    } catch (err) {
      setReqError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setRequesting(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setRevoking(id);
    try { await revokeLink(id); } finally { setRevoking(null); }
  };

  const noCloud = !hasApiBaseUrl;

  return (
    <div className="max-w-2xl space-y-4">

      {/* Device code */}
      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
          <h2 className="font-black text-slate-900">รหัส POS ประจำเครื่องนี้</h2>
          <p className="mt-0.5 text-xs font-medium text-slate-500">รหัสถาวรประจำเครื่อง (ไม่เปลี่ยนแปลง) — ใช้ให้เครื่องอื่นระบุเครื่องนี้เมื่อต้องการเชื่อมต่อ</p>
        </div>
        <div className="p-5">
          <div className="inline-flex items-center gap-3 rounded-xl border-2 border-primary-200 bg-primary-50 px-6 py-3">
            <MonitorSmartphone size={22} className="text-primary-700" />
            <span className="font-mono text-2xl font-black tracking-widest text-primary-900">{deviceCode}</span>
          </div>
        </div>
      </Card>

      {/* MainPOS section — this device receives SubPOS commands */}
      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-black text-slate-900">ใช้เครื่องนี้เป็น MainPOS</h2>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                เครื่องนี้ต่ออุปกรณ์ (เครื่องพิมพ์ / ลิ้นชัก) — อนุญาตให้ SubPOS เชื่อมต่อเข้ามาสั่งงานอุปกรณ์ได้
              </p>
            </div>
            <button type="button" onClick={reloadLinks} className="shrink-0 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
              รีเฟรช
            </button>
          </div>
        </div>
        <div className="space-y-3 p-5">
          {noCloud && (
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
              ฟีเจอร์นี้ต้องตั้งค่า API URL ก่อน
            </p>
          )}

          {!noCloud && pendingApprovals.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-black text-slate-500">คำขอที่รอการอนุมัติ</p>
              {pendingApprovals.map((a) => (
                <PendingApprovalRow
                  key={a.linkId}
                  approval={a}
                  onApprove={() => approveLink(a)}
                  onReject={() => rejectLink(a)}
                />
              ))}
            </div>
          )}

          {!noCloud && linksAsMain.filter((l) => l.status === 'active').length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-black text-slate-500">SubPOS ที่เชื่อมต่ออยู่</p>
              {linksAsMain.filter((l) => l.status === 'active').map((link) => (
                <div key={link.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex items-center gap-2.5">
                    <MonitorSmartphone size={16} className="text-emerald-600" />
                    <div>
                      <span className="font-black text-slate-800">{link.subDeviceCode}</span>
                      <div className="mt-0.5 flex gap-2 text-xs text-slate-500">
                        {link.allowPrint && <span className="flex items-center gap-1"><Printer size={11} /> พิมพ์</span>}
                        {link.allowDrawer && <span className="flex items-center gap-1"><Unlock size={11} /> ลิ้นชัก</span>}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={revoking === link.id}
                    onClick={() => void handleRevoke(link.id)}
                    className="flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-black text-red-700 hover:bg-red-100 disabled:opacity-60"
                  >
                    <Link2Off size={13} /> ยกเลิก
                  </button>
                </div>
              ))}
            </div>
          )}

          {!noCloud && pendingApprovals.length === 0 && linksAsMain.filter((l) => l.status === 'active').length === 0 && (
            <p className="text-sm text-slate-400">ยังไม่มี SubPOS เชื่อมต่อ — SubPOS สามารถส่งคำขอโดยใช้รหัส POS ของเครื่องนี้</p>
          )}
        </div>
      </Card>

      {/* SubPOS section — this device connects to a MainPOS */}
      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
          <h2 className="font-black text-slate-900">ใช้เครื่องนี้เป็น SubPOS</h2>
          <p className="mt-0.5 text-xs font-medium text-slate-500">
            เครื่องนี้ไม่ต่ออุปกรณ์ — เชื่อมต่อกับ MainPOS เพื่อสั่งพิมพ์ใบเสร็จ / เปิดลิ้นชักหลังบันทึกการขาย
          </p>
        </div>
        <div className="space-y-4 p-5">
          {noCloud && (
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
              ฟีเจอร์นี้ต้องตั้งค่า API URL ก่อน
            </p>
          )}

          {!noCloud && (
            <>
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-slate-600">สถานะ:</span>
                <StatusBadge status={linkStatus} />
                {linkStatus !== 'none' && (
                  <span className="text-sm text-slate-500">→ {mainCode}</span>
                )}
              </div>

              {linkStatus === 'none' && (
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-slate-700">
                    รหัส POS ของ MainPOS
                    <div className="mt-1 flex gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="เช่น 7751"
                        value={inputCode}
                        onChange={(e) => setInputCode(e.target.value.replace(/\D/g, ''))}
                        onKeyDown={(e) => e.key === 'Enter' && void handleRequestLink()}
                        className="flex-1 rounded-md border border-slate-300 px-3 py-2 font-mono text-lg font-bold tracking-widest focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                      />
                      <button
                        type="button"
                        disabled={requesting || !inputCode.trim()}
                        onClick={() => void handleRequestLink()}
                        className="rounded-md bg-primary-600 px-4 py-2 text-sm font-black text-white hover:bg-primary-700 disabled:opacity-60"
                      >
                        {requesting ? 'กำลังส่ง...' : 'ส่งคำขอ'}
                      </button>
                    </div>
                  </label>
                  {reqError && <p className="text-sm font-bold text-red-600">{reqError}</p>}
                  <p className="text-xs text-slate-500">ใส่รหัส POS 4 หลักของ MainPOS — MainPOS ต้องอนุมัติก่อนจึงจะเชื่อมต่อได้</p>
                </div>
              )}

              {linkStatus === 'pending' && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-bold text-amber-800">รอ MainPOS "{mainCode}" อนุมัติ...</p>
                  <p className="mt-1 text-xs text-amber-700">MainPOS ต้องเปิดหน้าตั้งค่า SubPOS และกดอนุมัติ</p>
                  <button
                    type="button"
                    onClick={clearSubLink}
                    className="mt-3 text-xs font-bold text-amber-800 underline"
                  >
                    ยกเลิกคำขอ
                  </button>
                </div>
              )}

              {linkStatus === 'active' && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                    <p className="text-sm font-black text-emerald-800">เชื่อมต่อกับ MainPOS "{mainCode}" สำเร็จ</p>
                    <p className="mt-0.5 text-xs text-emerald-700">คำสั่งจะถูกส่งอัตโนมัติหลังบันทึกการขาย</p>
                  </div>

                  <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-black text-slate-800">สั่งพิมพ์ใบเสร็จอัตโนมัติ</p>
                        <p className="mt-0.5 text-xs text-slate-500">MainPOS จะพิมพ์ใบเสร็จทันทีที่บันทึกการขาย</p>
                      </div>
                      <Toggle checked={usePrinter} onChange={setUsePrinter} />
                    </div>
                    <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-3">
                      <div>
                        <p className="text-sm font-black text-slate-800">เปิดลิ้นชักอัตโนมัติ</p>
                        <p className="mt-0.5 text-xs text-slate-500">MainPOS จะเปิดลิ้นชักเมื่อมีการชำระเงินสด</p>
                      </div>
                      <Toggle checked={useDrawer} onChange={setUseDrawer} />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={clearSubLink}
                    className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm font-black text-red-700 hover:bg-red-100"
                  >
                    <Link2Off size={15} /> ยกเลิกการเชื่อมต่อ
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
