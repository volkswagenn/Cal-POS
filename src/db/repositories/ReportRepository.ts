import { db } from '../database';
import { endOfDayIso, startOfDayIso } from '../../utils/date';

function inRange(createdAt: string, start: string, end: string) {
  return createdAt >= start && createdAt <= end;
}

export const ReportRepository = {
  async getDailySummary(date = new Date().toISOString().slice(0, 10)) {
    const start = startOfDayIso(date);
    const end = endOfDayIso(date);
    const sales = (await db.sales.toArray()).filter((sale) => inRange(sale.createdAt, start, end));
    const completed = sales.filter((sale) => sale.status === 'completed');
    const totalSales = completed.reduce((sum, sale) => sum + sale.total, 0);
    return {
      totalSales,
      billCount: completed.length,
      averageBill: completed.length ? totalSales / completed.length : 0,
      totalDiscount: completed.reduce((sum, sale) => sum + sale.discountAmount, 0),
      totalVoid: sales.filter((sale) => sale.status === 'voided').reduce((sum, sale) => sum + sale.total, 0),
      totalRefund: sales.filter((sale) => sale.status === 'refunded').reduce((sum, sale) => sum + sale.total, 0),
    };
  },
  async getHourlySales(startDate: string, endDate = startDate) {
    const start = startOfDayIso(startDate);
    const end = endOfDayIso(endDate);
    const rows = Array.from({ length: 24 }, (_, hour) => ({ hour: `${String(hour).padStart(2, '0')}:00`, total: 0, bills: 0 }));
    const sales = (await db.sales.toArray()).filter((sale) => sale.status === 'completed' && inRange(sale.createdAt, start, end));
    sales.forEach((sale) => {
      const hour = new Date(sale.createdAt).getHours();
      rows[hour].total += sale.total;
      rows[hour].bills += 1;
    });
    return rows;
  },
  async getProductSales(startDate: string, endDate = startDate) {
    const sales = (await db.sales.toArray()).filter((sale) => sale.status === 'completed' && inRange(sale.createdAt, startOfDayIso(startDate), endOfDayIso(endDate)));
    const saleIds = new Set(sales.map((sale) => sale.id));
    const map = new Map<string, { productName: string; quantity: number; revenue: number }>();
    (await db.sale_items.toArray()).filter((item) => saleIds.has(item.saleId)).forEach((item) => {
      const row = map.get(item.productId) ?? { productName: item.productName, quantity: 0, revenue: 0 };
      row.quantity += item.quantity;
      row.revenue += item.total;
      map.set(item.productId, row);
    });
    return [...map.values()].sort((a, b) => b.revenue - a.revenue);
  },
  async getPaymentSummary(startDate: string, endDate = startDate) {
    const sales = (await db.sales.toArray()).filter((sale) => sale.status === 'completed' && inRange(sale.createdAt, startOfDayIso(startDate), endOfDayIso(endDate)));
    const saleIds = new Set(sales.map((sale) => sale.id));
    const rows = { cash: 0, transfer: 0, qr: 0, credit: 0 };
    (await db.payments.toArray()).filter((payment) => saleIds.has(payment.saleId)).forEach((payment) => {
      if (payment.method !== 'mixed') rows[payment.method] += payment.amount;
    });
    return rows;
  },
  async getEmployeeSales(startDate: string, endDate = startDate) {
    const sales = (await db.sales.toArray()).filter((sale) => sale.status === 'completed' && inRange(sale.createdAt, startOfDayIso(startDate), endOfDayIso(endDate)));
    const map = new Map<string, { cashierName: string; total: number; bills: number; average: number }>();
    sales.forEach((sale) => {
      const row = map.get(sale.cashierId) ?? { cashierName: sale.cashierName, total: 0, bills: 0, average: 0 };
      row.total += sale.total;
      row.bills += 1;
      row.average = row.total / row.bills;
      map.set(sale.cashierId, row);
    });
    return [...map.values()];
  },
};
