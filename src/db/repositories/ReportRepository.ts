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
  // Sales grouped by the product's category. sale_items don't store categoryId,
  // so we resolve it through the product → category lookup. Items whose product
  // was deleted fall into an "อื่นๆ" bucket so no revenue is lost.
  async getCategorySales(startDate: string, endDate = startDate) {
    const sales = (await db.sales.toArray()).filter((sale) => sale.status === 'completed' && inRange(sale.createdAt, startOfDayIso(startDate), endOfDayIso(endDate)));
    const saleIds = new Set(sales.map((sale) => sale.id));
    const [products, categories, items] = await Promise.all([
      db.products.toArray(),
      db.categories.toArray(),
      db.sale_items.toArray(),
    ]);
    const productCategory = new Map(products.map((product) => [product.id, product.categoryId]));
    const categoryInfo = new Map(categories.map((category) => [category.id, { name: category.name, color: category.color }]));
    const map = new Map<string, { categoryId: string; categoryName: string; color: string; quantity: number; revenue: number }>();
    items.filter((item) => saleIds.has(item.saleId)).forEach((item) => {
      const categoryId = productCategory.get(item.productId) ?? '__none__';
      const info = categoryInfo.get(categoryId);
      const row = map.get(categoryId) ?? {
        categoryId,
        categoryName: info?.name ?? 'อื่นๆ',
        color: info?.color ?? '#94a3b8',
        quantity: 0,
        revenue: 0,
      };
      row.quantity += item.quantity;
      row.revenue += item.total;
      map.set(categoryId, row);
    });
    return [...map.values()].sort((a, b) => b.revenue - a.revenue);
  },
  // Cash-drawer activity for the day: how many times the drawer was opened from
  // the POS, broken down by reason (cash in / cash out / open only) with amounts.
  async getDrawerSummary(startDate: string, endDate = startDate) {
    const start = startOfDayIso(startDate);
    const end = endOfDayIso(endDate);
    const logs = (await db.cash_drawer_logs.toArray())
      .filter((log) => inRange(log.createdAt, start, end))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    let cashIn = 0;
    let cashOut = 0;
    let exchangeTotal = 0;
    let cashInCount = 0;
    let cashOutCount = 0;
    let openOnlyCount = 0;
    let failedCount = 0;
    logs.forEach((log) => {
      if (log.status === 'failed') failedCount += 1;
      if (log.action === 'cash_in') { cashIn += log.amount; cashInCount += 1; }
      else if (log.action === 'cash_out') { cashOut += log.amount; cashOutCount += 1; }
      else { exchangeTotal += log.amount; openOnlyCount += 1; } // open_only is now "แลกเงิน"
    });
    return {
      totalOpens: logs.length,
      cashIn,
      cashOut,
      exchangeTotal,
      net: cashIn - cashOut,
      cashInCount,
      cashOutCount,
      openOnlyCount,
      failedCount,
      entries: logs,
    };
  },
};
