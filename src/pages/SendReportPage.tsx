import { useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, RefreshCcw } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/common/Card';
import { ExternalReportPreview } from '../components/reports/ExternalReportPreview';
import { ExternalReportRepository, type PreviewRow } from '../db/repositories/ExternalReportRepository';
import type { ExportMode } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useToast } from '../components/common/Toast';
import { downloadBlob, downloadCsv, downloadXlsx } from '../utils/exportFile';
import { money } from '../utils/money';
import { hasApiBaseUrl } from '../services/api/client';
import { reportsApi } from '../services/api/reportsApi';

const REPORT_TYPE = 'payment_income' as const;
const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function dateRange(year: number, month: number, mode: string, from: string, to: string) {
  const today = new Date();
  if (mode === 'today') return [today.toISOString().slice(0, 10), today.toISOString().slice(0, 10)];
  if (mode === 'yesterday') {
    const y = new Date(today);
    y.setDate(today.getDate() - 1);
    return [y.toISOString().slice(0, 10), y.toISOString().slice(0, 10)];
  }
  if (mode === 'custom') return [from, to];
  if (mode === 'year') return [`${year}-01-01`, `${year}-12-31`];
  const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const end = new Date(year, month + 1, 0).toISOString().slice(0, 10);
  return [start, end];
}

function ReportChart({ rows }: { rows: PreviewRow[] }) {
  if (rows.length === 0) return null;
  const totalIncome = rows.reduce((sum, r) => sum + r.total, 0);
  const totalCash = rows.reduce((sum, r) => sum + r.cash, 0);
  const totalTransfer = rows.reduce((sum, r) => sum + r.transfer, 0);
  const totalOther = rows.reduce((sum, r) => sum + r.other, 0);

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-primary-50 px-4 py-3">
          <div className="text-xs font-bold text-primary-600">รวมทั้งหมด</div>
          <div className="mt-1 text-lg font-black text-primary-700">{money(totalIncome)}</div>
        </div>
        <div className="rounded-lg bg-emerald-50 px-4 py-3">
          <div className="text-xs font-bold text-emerald-600">เงินสด</div>
          <div className="mt-1 text-lg font-black text-emerald-700">{money(totalCash)}</div>
        </div>
        <div className="rounded-lg bg-blue-50 px-4 py-3">
          <div className="text-xs font-bold text-blue-600">โอน/QR</div>
          <div className="mt-1 text-lg font-black text-blue-700">{money(totalTransfer)}</div>
        </div>
        <div className="rounded-lg bg-slate-100 px-4 py-3">
          <div className="text-xs font-bold text-slate-500">อื่นๆ</div>
          <div className="mt-1 text-lg font-black text-slate-700">{money(totalOther)}</div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={rows} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fontWeight: 600 }} tickLine={false} />
          <YAxis tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip formatter={(value: number) => money(value)} contentStyle={{ fontSize: 12, fontWeight: 700 }} />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, fontWeight: 700 }} />
          <Bar dataKey="cash" name="เงินสด" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
          <Bar dataKey="transfer" name="โอน/QR" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} />
          <Bar dataKey="other" name="อื่นๆ" stackId="a" fill="#94a3b8" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SendReportPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [rangeMode, setRangeMode] = useState('month');
  const [exportMode] = useState<ExportMode>('single_row');
  const [from, setFrom] = useState(now.toISOString().slice(0, 10));
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const user = useAuthStore((state) => state.user)!;
  const toast = useToast();
  const [dateFrom, dateTo] = useMemo(() => dateRange(year, month, rangeMode, from, to), [year, month, rangeMode, from, to]);

  const preview = async () => {
    if (hasApiBaseUrl && navigator.onLine) {
      const response = await reportsApi.preview(REPORT_TYPE, dateFrom, dateTo, exportMode);
      setRows(response.rows);
      return;
    }

    setRows(await ExternalReportRepository.buildPreview(REPORT_TYPE, dateFrom, dateTo, exportMode));
  };

  useEffect(() => {
    preview();
  }, [dateFrom, dateTo]);

  const exportRows = () => ExternalReportRepository.rowsForExport(REPORT_TYPE, rows);
  const headers = () => ExternalReportRepository.headers(REPORT_TYPE);

  const download = async (format: 'csv' | 'xlsx') => {
    const fileName = ExternalReportRepository.fileName(REPORT_TYPE, dateFrom, dateTo, format);
    if (hasApiBaseUrl && navigator.onLine) {
      const response = await reportsApi.export(REPORT_TYPE, dateFrom, dateTo, exportMode, format);
      downloadBlob(response.blob, response.fileName ? decodeURIComponent(response.fileName) : fileName);
    } else if (format === 'csv') {
      downloadCsv(headers(), exportRows(), fileName);
    } else {
      downloadXlsx(headers(), exportRows(), 'รายรับแยกประเภท', fileName);
    }
    await ExternalReportRepository.logExport({ reportType: REPORT_TYPE, dateFrom, dateTo, format, fileName, exportMode, user });
    toast(`ส่งออก ${fileName} แล้ว`, 'success');
  };

  return (
    <div className="p-4 md:p-6">
      <PageHeader title="ส่งรายงาน" subtitle="รายรับแยกประเภทการชำระเงิน" />
      <div>
        <Card className="p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm font-bold">ปี<input type="number" className="mt-1 w-full rounded-md border-slate-300" value={year} onChange={(event) => setYear(Number(event.target.value))} /></label>
            <label className="text-sm font-bold">รูปแบบช่วง<select className="mt-1 w-full rounded-md border-slate-300" value={rangeMode} onChange={(event) => setRangeMode(event.target.value)}><option value="month">รายเดือน</option><option value="year">ทั้งปี</option><option value="today">วันนี้</option><option value="yesterday">เมื่อวาน</option><option value="custom">กำหนดเอง</option></select></label>
            <div className="flex items-end gap-2">
              <button onClick={preview} className="flex-1 rounded-md bg-slate-800 px-4 py-2.5 font-bold text-white"><RefreshCcw className="mr-2 inline" size={16} /> Refresh</button>
            </div>
          </div>
          <div className="my-3 flex flex-wrap gap-2">{months.map((label, index) => <button key={label} onClick={() => { setMonth(index); setRangeMode('month'); }} className={`rounded-md px-3 py-2 font-bold ${month === index && rangeMode === 'month' ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{label}</button>)}</div>
          {rangeMode === 'custom' && <div className="mb-3 grid gap-2 md:grid-cols-2"><input type="date" className="rounded-md border-slate-300" value={from} onChange={(event) => setFrom(event.target.value)} /><input type="date" className="rounded-md border-slate-300" value={to} onChange={(event) => setTo(event.target.value)} /></div>}
          <div className="mb-4 flex flex-wrap gap-2">
            <button onClick={() => download('csv')} className="rounded-md bg-primary-600 px-4 py-2.5 font-bold text-white"><Download className="mr-2 inline" size={16} /> Download CSV</button>
            <button onClick={() => download('xlsx')} className="rounded-md bg-emerald-600 px-4 py-2.5 font-bold text-white"><FileSpreadsheet className="mr-2 inline" size={16} /> Download Excel</button>
          </div>
          <ReportChart rows={rows} />
          <ExternalReportPreview reportType={REPORT_TYPE} rows={rows} />
        </Card>
      </div>
    </div>
  );
}
