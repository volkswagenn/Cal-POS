import type { ExternalReportType } from '../../types';
import type { PreviewRow } from '../../db/repositories/ExternalReportRepository';

export function ExternalReportPreview({ reportType, rows }: { reportType: ExternalReportType; rows: PreviewRow[] }) {
  const total = rows.reduce((sum, row) => sum + (reportType === 'income_expense' ? row.amount ?? 0 : row.total), 0);
  if (reportType === 'income_expense') {
    return (
      <div className="overflow-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="p-3">วันที่</th><th>ประเภท</th><th>รายการ</th><th className="text-right p-3">จำนวน</th></tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={`${row.date}-${index}`} className="border-t border-slate-100"><td className="p-3">{row.date}</td><td>{row.type}</td><td>{row.item}</td><td className="p-3 text-right font-bold">{row.amount}</td></tr>)}
            <tr className="bg-emerald-50 font-black text-emerald-800"><td className="p-3" colSpan={3}>รวมทั้งหมด</td><td className="p-3 text-right">{total}</td></tr>
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="p-3">วันที่</th><th>เงินสด</th><th>เงินโอน</th><th>รายรับอื่นๆ</th><th>รวม</th><th className="p-3">หมายเหตุ</th></tr></thead>
        <tbody>
          {rows.map((row, index) => <tr key={`${row.date}-${index}`} className="border-t border-slate-100"><td className="p-3">{row.date}</td><td>{row.cash}</td><td>{row.transfer}</td><td>{row.other}</td><td className="font-bold">{row.total}</td><td className="p-3">{row.note}</td></tr>)}
          <tr className="bg-emerald-50 font-black text-emerald-800"><td className="p-3">รวมทั้งหมด</td><td>{rows.reduce((s, r) => s + r.cash, 0)}</td><td>{rows.reduce((s, r) => s + r.transfer, 0)}</td><td>{rows.reduce((s, r) => s + r.other, 0)}</td><td>{total}</td><td /></tr>
        </tbody>
      </table>
    </div>
  );
}
