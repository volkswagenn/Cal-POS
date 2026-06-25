import { useEffect, useMemo, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/common/Card';
import { LoadingOverlay } from '../components/common/LoadingOverlay';
import { ReportRepository } from '../db/repositories/ReportRepository';
import { useAsync } from '../hooks/useAsync';
import { hasApiBaseUrl } from '../services/api/client';
import { subscribeSync } from '../services/api/syncScheduler';
import { reportsApi } from '../services/api/reportsApi';
import { formatDateInput, formatDateTime } from '../utils/date';
import { money } from '../utils/money';

const DRAWER_ACTION_LABEL: Record<string, string> = {
  cash_in: 'นำเงินเข้า',
  cash_out: 'นำเงินออก',
  open_only: 'แลกเงิน',
};

async function loadLocalReport(date: string) {
  const [summary, hourly, products, payments, employees] = await Promise.all([
    ReportRepository.getDailySummary(date),
    ReportRepository.getHourlySales(date),
    ReportRepository.getProductSales(date),
    ReportRepository.getPaymentSummary(date),
    ReportRepository.getEmployeeSales(date),
  ]);
  return { summary, hourly, products, payments, employees };
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function DashboardPage() {
  const [date, setDate] = useState(formatDateInput());
  const [usingLocalFallback, setUsingLocalFallback] = useState(false);
  const { data: daily, loading, reload } = useAsync(async () => {
    if (hasApiBaseUrl && navigator.onLine) {
      try {
        const result = await reportsApi.daily(date);
        setUsingLocalFallback(false);
        return result;
      } catch {
        // API unavailable (backend starting up / offline) → show local data
        setUsingLocalFallback(true);
        return loadLocalReport(date);
      }
    }
    setUsingLocalFallback(false);
    return loadLocalReport(date);
  }, [date]);

  // Category breakdown and cash-drawer activity are computed locally from this
  // device's database (drawer logs are not synced to the cloud), so they're loaded
  // separately from the main daily report regardless of online/offline mode.
  const { data: categorySales, reload: reloadCategorySales } = useAsync(() => ReportRepository.getCategorySales(date), [date]);
  const { data: drawer, reload: reloadDrawer } = useAsync(() => ReportRepository.getDrawerSummary(date), [date]);

  // Reload the dashboard whenever a sync completes so new sales appear without
  // a manual refresh. Two triggers:
  //   1. lastSyncedAt changes → new data pulled from cloud (normal case)
  //   2. isSyncing flips true→false with no error → sync just finished;
  //      catches the cold-start recovery case where nothing new was pulled
  //      but the API is now reachable and we should switch from local fallback
  //      back to the cloud report.
  const lastSyncSig = useRef<string | null>(null);
  const wasSyncing = useRef(false);
  useEffect(() => subscribeSync((s) => {
    const sigChanged = s.lastSyncedAt != null && s.lastSyncedAt !== lastSyncSig.current;
    if (sigChanged) lastSyncSig.current = s.lastSyncedAt;

    const justFinished = wasSyncing.current && !s.isSyncing && !s.lastSyncError;
    wasSyncing.current = s.isSyncing;

    if (sigChanged || justFinished) {
      void reload();
      void reloadCategorySales();
      void reloadDrawer();
    }
  }), [reload, reloadCategorySales, reloadDrawer]);

  const summary = daily?.summary;
  const categoryTotal = useMemo(() => (categorySales ?? []).reduce((sum, row) => sum + row.revenue, 0), [categorySales]);
  const hourly = daily?.hourly;
  const products = daily?.products;
  const payments = daily?.payments;
  const employees = daily?.employees;
  const bestHour = useMemo(() => [...(hourly ?? [])].sort((a, b) => b.total - a.total)[0], [hourly]);
  const paymentRows = [
    ['เงินสด', payments?.cash ?? 0],
    ['เงินโอน', payments?.transfer ?? 0],
    ['QR', payments?.qr ?? 0],
    ['บัตรเครดิต', payments?.credit ?? 0],
  ] as const;

  return (
    <div className="relative p-4 md:p-6">
      <LoadingOverlay show={loading && !daily} />
      <PageHeader
        title="แดชบอร์ด"
        subtitle="สรุปรายวัน รายชั่วโมง สินค้าขายดี ช่องทางชำระเงิน และยอดขายพนักงาน"
        action={
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setDate((d) => shiftDate(d, -1))} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm hover:bg-slate-100">◀</button>
            <input type="date" className="rounded-md border-slate-300" value={date} onChange={(event) => setDate(event.target.value)} />
            <button type="button" onClick={() => setDate((d) => shiftDate(d, 1))} disabled={date >= formatDateInput()} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40">▶</button>
          </div>
        }
      />
      {usingLocalFallback && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm">
          <span className="font-bold text-amber-800">⚠️ แสดงข้อมูลจากเครื่องนี้ (cloud ไม่พร้อมใช้งาน — ข้อมูลจากเครื่องอื่นอาจไม่ครบ)</span>
          <button
            type="button"
            className="shrink-0 rounded-md bg-amber-600 px-3 py-1 text-xs font-black text-white hover:bg-amber-700"
            onClick={() => { void reload(); void reloadCategorySales(); void reloadDrawer(); }}
          >
            ลองใหม่
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          ['ยอดขายสุทธิ', money(summary?.totalSales ?? 0)],
          ['จำนวนบิล', summary?.billCount ?? 0],
          ['บิลเฉลี่ย', money(summary?.averageBill ?? 0)],
          ['ส่วนลด', money(summary?.totalDiscount ?? 0)],
          ['Void', money(summary?.totalVoid ?? 0)],
          ['Refund', money(summary?.totalRefund ?? 0)],
        ].map(([label, value]) => (
          <Card key={label} className="p-4">
            <div className="text-sm text-slate-500">{label}</div>
            <div className="mt-1 text-2xl font-black">{value}</div>
          </Card>
        ))}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card className="p-4">
          <div className="mb-3 flex justify-between">
            <h2 className="font-black">ยอดขายรายชั่วโมง</h2>
            <span className="text-sm text-slate-500">ช่วงขายดีที่สุด: {bestHour?.hour ?? '-'}</span>
          </div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourly ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" />
                <YAxis />
                <Tooltip formatter={(value) => money(Number(value))} />
                <Bar dataKey="total" fill="#1687e8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 font-black">ช่องทางชำระเงิน</h2>
          {paymentRows.map(([label, value]) => (
            <div key={label} className="flex justify-between border-b border-slate-100 py-2">
              <span>{label}</span>
              <b>{money(value)}</b>
            </div>
          ))}
        </Card>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 font-black">สินค้าขายดี</h2>
          {(products ?? []).slice(0, 10).map((item) => (
            <div key={item.productName} className="flex justify-between border-b border-slate-100 py-2">
              <span>{item.productName} ({item.quantity})</span>
              <b>{money(item.revenue)}</b>
            </div>
          ))}
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 font-black">ยอดขายพนักงาน</h2>
          {(employees ?? []).map((item) => (
            <div key={item.cashierName} className="flex justify-between border-b border-slate-100 py-2">
              <span>{item.cashierName} ({item.bills} บิล)</span>
              <b>{money(item.total)}</b>
            </div>
          ))}
        </Card>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-black">ยอดขายตามหมวดหมู่</h2>
            <span className="text-sm text-slate-500">รวม {money(categoryTotal)}</span>
          </div>
          {(categorySales ?? []).length === 0 && <div className="py-2 text-sm text-slate-400">ยังไม่มียอดขายในวันนี้</div>}
          {(categorySales ?? []).map((item) => {
            const percent = categoryTotal > 0 ? Math.round((item.revenue / categoryTotal) * 100) : 0;
            return (
              <div key={item.categoryId} className="border-b border-slate-100 py-2 last:border-b-0">
                <div className="flex justify-between">
                  <span className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ background: item.color }} />
                    {item.categoryName} <span className="text-slate-400">({item.quantity} ชิ้น)</span>
                  </span>
                  <b>{money(item.revenue)}</b>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full" style={{ width: `${percent}%`, background: item.color }} />
                  </div>
                  <span className="w-9 text-right text-xs text-slate-400">{percent}%</span>
                </div>
              </div>
            );
          })}
        </Card>
        <Card className="p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-black">การเปิดลิ้นชัก</h2>
            <span className="text-sm text-slate-500">เปิดทั้งหมด {(drawer?.totalOpens ?? 0).toLocaleString('th-TH')} ครั้ง</span>
          </div>
          <div className="mb-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md bg-emerald-50 p-2">
              <div className="text-xs font-bold text-emerald-700">เงินเข้า ({drawer?.cashInCount ?? 0})</div>
              <div className="text-lg font-black text-emerald-800">{money(drawer?.cashIn ?? 0)}</div>
            </div>
            <div className="rounded-md bg-red-50 p-2">
              <div className="text-xs font-bold text-red-700">เงินออก ({drawer?.cashOutCount ?? 0})</div>
              <div className="text-lg font-black text-red-800">{money(drawer?.cashOut ?? 0)}</div>
            </div>
            <div className="rounded-md bg-slate-50 p-2">
              <div className="text-xs font-bold text-slate-500">แลกเงิน ({drawer?.openOnlyCount ?? 0})</div>
              <div className="text-lg font-black text-slate-950">{money(drawer?.exchangeTotal ?? 0)}</div>
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {(drawer?.entries ?? []).length === 0 && <div className="py-2 text-sm text-slate-400">ยังไม่มีการเปิดลิ้นชักในวันนี้</div>}
            {(drawer?.entries ?? []).map((entry) => (
              <div key={entry.id} className="flex items-start justify-between gap-2 border-b border-slate-100 py-2 last:border-b-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${entry.action === 'cash_in' ? 'bg-emerald-100 text-emerald-700' : entry.action === 'cash_out' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                      {DRAWER_ACTION_LABEL[entry.action] ?? entry.action}
                    </span>
                    {entry.status === 'failed' && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-700">ไม่สำเร็จ</span>}
                    <span className="truncate text-sm text-slate-500">{formatDateTime(entry.createdAt)}</span>
                  </div>
                  {entry.note?.trim() && <div className="mt-0.5 truncate text-sm text-slate-600">เหตุผล: {entry.note}</div>}
                  <div className="text-xs text-slate-400">{entry.userName}</div>
                </div>
                {entry.action === 'open_only'
                  ? <b className="text-slate-600">{money(entry.amount)}</b>
                  : (
                    <b className={entry.action === 'cash_in' ? 'text-emerald-700' : 'text-red-700'}>
                      {entry.action === 'cash_in' ? '+' : '-'}{money(entry.amount)}
                    </b>
                  )}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
