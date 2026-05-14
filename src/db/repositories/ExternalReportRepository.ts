import { db } from '../database';
import type { ExportMode, ExternalReportImport, ExternalReportRow, ExternalReportType, PaymentMethod, User } from '../../types';
import { endOfDayIso, nowIso, startOfDayIso } from '../../utils/date';
import { uid } from '../../utils/id';

export interface PreviewRow {
  date: string;
  cash: number;
  transfer: number;
  other: number;
  total: number;
  note: string;
  type?: string;
  item?: string;
  amount?: number;
}

function thDate(isoDate: string) {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function methodGroup(method: PaymentMethod) {
  if (method === 'cash') return 'cash';
  if (method === 'transfer' || method === 'qr') return 'transfer';
  return 'other';
}

export const reportLabels: Record<ExternalReportType, string> = {
  daily_income: 'รายรับรวมตามรายวัน',
  payment_income: 'รายรับแยกประเภท',
  expense: 'รายจ่าย',
  expense_by_type: 'รายจ่ายแยกประเภท',
  income_expense: 'รายรับ-รายจ่ายรวม',
};

export const ExternalReportRepository = {
  async buildPreview(reportType: ExternalReportType, dateFrom: string, dateTo: string, exportMode: ExportMode): Promise<PreviewRow[]> {
    if (reportType === 'expense' || reportType === 'expense_by_type') return [];
    const start = startOfDayIso(dateFrom);
    const end = endOfDayIso(dateTo);
    const completed = (await db.sales.toArray()).filter((sale) => sale.status === 'completed' && sale.createdAt >= start && sale.createdAt <= end);
    const refunded = (await db.sales.toArray()).filter((sale) => sale.status === 'refunded' && sale.createdAt >= start && sale.createdAt <= end);
    const saleStatus = new Map([...completed, ...refunded].map((sale) => [sale.id, sale.status]));
    const saleDates = new Map([...completed, ...refunded].map((sale) => [sale.id, sale.createdAt.slice(0, 10)]));
    const map = new Map<string, PreviewRow>();
    const add = (date: string, group: 'cash' | 'transfer' | 'other', amount: number) => {
      const row = map.get(date) ?? { date: thDate(date), cash: 0, transfer: 0, other: 0, total: 0, note: '' };
      row[group] += amount;
      row.total = row.cash + row.transfer + row.other;
      map.set(date, row);
    };
    (await db.payments.toArray()).forEach((payment) => {
      const date = saleDates.get(payment.saleId);
      if (!date) return;
      const sign = saleStatus.get(payment.saleId) === 'refunded' ? -1 : 1;
      add(date, methodGroup(payment.method), payment.amount * sign);
    });
    const rows = [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (reportType === 'income_expense') {
      return rows.flatMap((row) => [
        { ...row, type: 'รายรับ', item: 'รายรับเงินสด', amount: row.cash },
        { ...row, type: 'รายรับ', item: 'รายรับเงินโอน', amount: row.transfer },
        { ...row, type: 'รายรับ', item: 'รายรับอื่นๆ', amount: row.other },
      ]).filter((row) => (row.amount ?? 0) !== 0);
    }
    if (exportMode === 'split_payment' && reportType === 'daily_income') {
      return rows.flatMap((row) => [
        { ...row, cash: row.cash, transfer: 0, other: 0, total: row.cash },
        { ...row, cash: 0, transfer: row.transfer, other: 0, total: row.transfer },
        { ...row, cash: 0, transfer: 0, other: row.other, total: row.other },
      ]).filter((row) => row.total !== 0);
    }
    return rows;
  },
  headers(reportType: ExternalReportType) {
    if (reportType === 'payment_income') return ['วันที่', 'ยอดรวม', 'เงินสด', 'เงินโอน', 'อื่นๆ', 'หมายเหตุ'];
    if (reportType === 'income_expense') return ['วันที่', 'ประเภท', 'รายการ', 'จำนวน'];
    return ['วันที่', 'เงินสด', 'เงินโอน', 'รายรับอื่นๆ', 'รวม', 'หมายเหตุ'];
  },
  rowsForExport(reportType: ExternalReportType, rows: PreviewRow[]) {
    if (reportType === 'payment_income') return rows.map((row) => [row.date, row.total, row.cash, row.transfer, row.other, row.note]);
    if (reportType === 'income_expense') return rows.map((row) => [row.date, row.type ?? 'รายรับ', row.item ?? 'รายรับ', row.amount ?? row.total]);
    return rows.map((row) => [row.date, row.cash, row.transfer, row.other, row.total, row.note]);
  },
  fileName(reportType: ExternalReportType, dateFrom: string, dateTo: string, format: 'csv' | 'xlsx') {
    const prefix = reportType === 'payment_income' ? 'รายรับแยกประเภท' : reportType === 'income_expense' ? 'รายรับรายจ่ายรวม' : 'รายรับรายวัน';
    return `${prefix}_${dateFrom}_${dateTo}.${format}`;
  },
  async logExport(input: { reportType: ExternalReportType; dateFrom: string; dateTo: string; format: 'csv' | 'xlsx'; fileName: string; exportMode: ExportMode; user: User }) {
    await db.external_report_exports.add({ id: uid('ext_export'), reportType: input.reportType, dateFrom: input.dateFrom, dateTo: input.dateTo, format: input.format, fileName: input.fileName, exportMode: input.exportMode, createdByUserId: input.user.id, createdAt: nowIso() });
  },
  async saveImport(input: { importType: ExternalReportType; dateFrom: string; dateTo: string; fileName: string; user: User; rows: PreviewRow[] }) {
    const timestamp = nowIso();
    const importId = uid('ext_import');
    const record: ExternalReportImport = { id: importId, importType: input.importType, dateFrom: input.dateFrom, dateTo: input.dateTo, fileName: input.fileName, status: 'saved', createdByUserId: input.user.id, createdAt: timestamp };
    const rows: ExternalReportRow[] = input.rows.map((row) => ({
      id: uid('ext_row'),
      importId,
      reportDate: row.date,
      cashAmount: row.cash,
      transferAmount: row.transfer,
      otherAmount: row.other,
      totalAmount: row.total,
      note: row.note,
      source: 'import',
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    await db.transaction('rw', db.external_report_imports, db.external_report_rows, async () => {
      await db.external_report_imports.add(record);
      await db.external_report_rows.bulkAdd(rows);
    });
  },
};
