import { prisma } from '../../db/prisma.js';

type PaymentGroup = 'cash' | 'transfer' | 'other';

export type PreviewRow = {
  date: string;
  cash: number;
  transfer: number;
  other: number;
  total: number;
  note: string;
  type?: string;
  item?: string;
  amount?: number;
};

export function startOfDay(date: string) {
  return new Date(`${date}T00:00:00`);
}

export function endOfDay(date: string) {
  return new Date(`${date}T23:59:59.999`);
}

function thDate(isoDate: string) {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function methodGroup(method: string): PaymentGroup {
  if (method === 'cash') return 'cash';
  if (method === 'transfer' || method === 'qr') return 'transfer';
  return 'other';
}

export async function getDailyReport(shopId: string, date: string) {
  const start = startOfDay(date);
  const end = endOfDay(date);
  const sales = await prisma.sale.findMany({
    where: { shopId, createdAt: { gte: start, lte: end } },
    include: { payments: true, items: true },
  });
  const completed = sales.filter((sale) => sale.status === 'completed');
  const totalSales = completed.reduce((sum, sale) => sum + Number(sale.total), 0);
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour: `${String(hour).padStart(2, '0')}:00`,
    total: 0,
    bills: 0,
  }));
  const payments = { cash: 0, transfer: 0, qr: 0, credit: 0 };
  const employees = new Map<string, { cashierName: string; total: number; bills: number; average: number }>();
  const products = new Map<string, { productName: string; quantity: number; revenue: number }>();

  completed.forEach((sale) => {
    const hour = sale.createdAt.getHours();
    hourly[hour].total += Number(sale.total);
    hourly[hour].bills += 1;

    const employee = employees.get(sale.cashierId) ?? {
      cashierName: sale.cashierName,
      total: 0,
      bills: 0,
      average: 0,
    };
    employee.total += Number(sale.total);
    employee.bills += 1;
    employee.average = employee.total / employee.bills;
    employees.set(sale.cashierId, employee);

    sale.payments.forEach((payment) => {
      if (payment.method === 'cash') payments.cash += Number(payment.amount);
      if (payment.method === 'transfer') payments.transfer += Number(payment.amount);
      if (payment.method === 'qr') payments.qr += Number(payment.amount);
      if (payment.method === 'credit') payments.credit += Number(payment.amount);
    });

    sale.items.forEach((item) => {
      const product = products.get(item.productId) ?? { productName: item.productName, quantity: 0, revenue: 0 };
      product.quantity += item.quantity;
      product.revenue += Number(item.total);
      products.set(item.productId, product);
    });
  });

  return {
    summary: {
      totalSales,
      billCount: completed.length,
      averageBill: completed.length ? totalSales / completed.length : 0,
      totalDiscount: completed.reduce((sum, sale) => sum + Number(sale.discountAmount), 0),
      totalVoid: sales.filter((sale) => sale.status === 'voided').reduce((sum, sale) => sum + Number(sale.total), 0),
      totalRefund: sales.filter((sale) => sale.status === 'refunded').reduce((sum, sale) => sum + Number(sale.total), 0),
    },
    hourly,
    products: [...products.values()].sort((a, b) => b.revenue - a.revenue),
    payments,
    employees: [...employees.values()],
  };
}

export async function getSummaryReport(shopId: string, from: string, to: string) {
  const start = startOfDay(from);
  const end = endOfDay(to);
  const sales = await prisma.sale.findMany({
    where: { shopId, createdAt: { gte: start, lte: end } },
  });
  const completed = sales.filter((sale) => sale.status === 'completed');
  const totalSales = completed.reduce((sum, sale) => sum + Number(sale.total), 0);

  return {
    totalSales,
    billCount: completed.length,
    averageBill: completed.length ? totalSales / completed.length : 0,
    totalDiscount: completed.reduce((sum, sale) => sum + Number(sale.discountAmount), 0),
    totalVoid: sales.filter((sale) => sale.status === 'voided').reduce((sum, sale) => sum + Number(sale.total), 0),
    totalRefund: sales.filter((sale) => sale.status === 'refunded').reduce((sum, sale) => sum + Number(sale.total), 0),
  };
}

export async function getProductReport(shopId: string, from: string, to: string, limit?: number) {
  const start = startOfDay(from);
  const end = endOfDay(to);
  const sales = await prisma.sale.findMany({
    where: { shopId, status: 'completed', createdAt: { gte: start, lte: end } },
    include: { items: true },
  });
  const rows = new Map<string, { productName: string; quantity: number; revenue: number }>();

  sales.forEach((sale) => {
    sale.items.forEach((item) => {
      const row = rows.get(item.productId) ?? { productName: item.productName, quantity: 0, revenue: 0 };
      row.quantity += item.quantity;
      row.revenue += Number(item.total);
      rows.set(item.productId, row);
    });
  });

  const sorted = [...rows.values()].sort((a, b) => b.revenue - a.revenue);
  return typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
}

export async function getPaymentReport(shopId: string, from: string, to: string) {
  const start = startOfDay(from);
  const end = endOfDay(to);
  const sales = await prisma.sale.findMany({
    where: { shopId, status: 'completed', createdAt: { gte: start, lte: end } },
    include: { payments: true },
  });
  const rows = { cash: 0, transfer: 0, qr: 0, credit: 0 };

  sales.forEach((sale) => {
    sale.payments.forEach((payment) => {
      if (payment.method === 'cash') rows.cash += Number(payment.amount);
      if (payment.method === 'transfer') rows.transfer += Number(payment.amount);
      if (payment.method === 'qr') rows.qr += Number(payment.amount);
      if (payment.method === 'credit') rows.credit += Number(payment.amount);
    });
  });

  return rows;
}

export async function getEmployeeReport(shopId: string, from: string, to: string) {
  const start = startOfDay(from);
  const end = endOfDay(to);
  const sales = await prisma.sale.findMany({
    where: { shopId, status: 'completed', createdAt: { gte: start, lte: end } },
  });
  const rows = new Map<string, { cashierName: string; total: number; bills: number; average: number }>();

  sales.forEach((sale) => {
    const row = rows.get(sale.cashierId) ?? { cashierName: sale.cashierName, total: 0, bills: 0, average: 0 };
    row.total += Number(sale.total);
    row.bills += 1;
    row.average = row.total / row.bills;
    rows.set(sale.cashierId, row);
  });

  return [...rows.values()];
}

export async function buildPreview(shopId: string, reportType: string, dateFrom: string, dateTo: string, exportMode: string): Promise<PreviewRow[]> {
  if (reportType === 'expense' || reportType === 'expense_by_type') return [];
  const start = startOfDay(dateFrom);
  const end = endOfDay(dateTo);
  const sales = await prisma.sale.findMany({
    where: {
      shopId,
      status: { in: ['completed', 'refunded'] },
      createdAt: { gte: start, lte: end },
    },
    include: { payments: true },
  });
  const rows = new Map<string, PreviewRow>();

  const add = (date: string, group: PaymentGroup, amount: number) => {
    const row = rows.get(date) ?? { date: thDate(date), cash: 0, transfer: 0, other: 0, total: 0, note: '' };
    row[group] += amount;
    row.total = row.cash + row.transfer + row.other;
    rows.set(date, row);
  };

  sales.forEach((sale) => {
    const date = sale.createdAt.toISOString().slice(0, 10);
    const sign = sale.status === 'refunded' ? -1 : 1;
    sale.payments.forEach((payment) => add(date, methodGroup(payment.method), Number(payment.amount) * sign));
  });

  const result = [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));

  if (reportType === 'income_expense') {
    return result.flatMap((row) => [
      { ...row, type: 'income', item: 'cash income', amount: row.cash },
      { ...row, type: 'income', item: 'transfer income', amount: row.transfer },
      { ...row, type: 'income', item: 'other income', amount: row.other },
    ]).filter((row) => (row.amount ?? 0) !== 0);
  }

  if (exportMode === 'split_payment' && reportType === 'daily_income') {
    return result.flatMap((row) => [
      { ...row, cash: row.cash, transfer: 0, other: 0, total: row.cash },
      { ...row, cash: 0, transfer: row.transfer, other: 0, total: row.transfer },
      { ...row, cash: 0, transfer: 0, other: row.other, total: row.other },
    ]).filter((row) => row.total !== 0);
  }

  return result;
}

export function exportHeaders(reportType: string) {
  if (reportType === 'payment_income') return ['date', 'total', 'cash', 'transfer', 'other', 'note'];
  if (reportType === 'income_expense') return ['date', 'type', 'item', 'amount'];
  return ['date', 'cash', 'transfer', 'other', 'total', 'note'];
}

export function rowsForExport(reportType: string, rows: PreviewRow[]) {
  if (reportType === 'payment_income') return rows.map((row) => [row.date, row.total, row.cash, row.transfer, row.other, row.note]);
  if (reportType === 'income_expense') return rows.map((row) => [row.date, row.type ?? 'income', row.item ?? 'income', row.amount ?? row.total]);
  return rows.map((row) => [row.date, row.cash, row.transfer, row.other, row.total, row.note]);
}

export function reportFileName(reportType: string, dateFrom: string, dateTo: string, format: string) {
  const prefix = reportType === 'payment_income' ? 'payment-income' : reportType === 'income_expense' ? 'income-expense' : 'daily-income';
  return `${prefix}_${dateFrom}_${dateTo}.${format}`;
}
