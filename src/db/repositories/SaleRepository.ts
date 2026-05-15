import { db } from '../database';
import type { CartItem, DiscountLog, Payment, PaymentMethod, Sale, SaleDetail, SaleItem, User } from '../../types';
import { endOfDayIso, nowIso, startOfDayIso } from '../../utils/date';
import { clampDiscount } from '../../utils/money';
import { uid } from '../../utils/id';
import { SettingsRepository } from './SettingsRepository';
import { SyncQueueRepository } from '../syncQueue';

const DEVICE_CODE_KEY = 'calpos_device_code';
const DEVICE_ID_KEY = 'calpos_device_id';

// Short, stable, human-readable code (e.g. "A3F2") per device.
// Stored in localStorage so bills generated on this device always carry the same tag.
function getDeviceCode() {
  const existing = localStorage.getItem(DEVICE_CODE_KEY);
  if (existing) return existing;

  // Derive from existing deviceId if available, otherwise generate fresh
  const deviceId =
    localStorage.getItem(DEVICE_ID_KEY) ||
    (crypto.randomUUID ? crypto.randomUUID() : `device-${Date.now()}`);
  const hex = deviceId.replace(/[^a-f0-9]/gi, '').slice(0, 4).toUpperCase().padEnd(4, '0');
  localStorage.setItem(DEVICE_CODE_KEY, hex);
  return hex;
}

// O(1) per sale: the running sequence is kept in the settings table keyed by
// device + scope, instead of scanning the entire sales table on every checkout
// (which degraded linearly as history grew). The full scan now runs at most
// once — to seed the counter on upgrade — then never again.
function seqFromBillNo(billNo: string) {
  const n = Number(billNo.split('-').pop());
  return Number.isFinite(n) ? n : 0;
}

async function nextBillNo() {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const deviceCode = getDeviceCode();
  const resetRule = await SettingsRepository.getSetting('billNumberResetRule', 'daily');
  const scopeKey = resetRule === 'daily' ? datePart : 'all';
  const counterKey = `billNoCounter:${deviceCode}:${scopeKey}`;

  const value = await db.transaction('rw', db.settings, db.sales, async () => {
    const raw = (await db.settings.get(counterKey))?.value;
    let current = raw != null ? Number(raw) : NaN;

    if (!Number.isFinite(current)) {
      // One-time seed: derive the starting point from any existing local bills
      // for this device/scope so we never reuse a number after an upgrade.
      const all = await db.sales.toArray();
      current = all
        .filter((s) => s.billNo.startsWith(`${deviceCode}-`))
        .filter((s) => (resetRule === 'daily' ? s.billNo.includes(datePart) : true))
        .reduce((max, s) => Math.max(max, seqFromBillNo(s.billNo)), 0);
    }

    const next = current + 1;
    await db.settings.put({ key: counterKey, value: String(next), updatedAt: nowIso() });
    return next;
  });

  return `${deviceCode}-${datePart}-${String(value).padStart(6, '0')}`;
}

export const SaleRepository = {
  async createSale(input: {
    cashier: User;
    cart: CartItem[];
    billDiscountAmount: number;
    billDiscountPercent: number;
    payments: Array<{ method: PaymentMethod; amount: number; receivedAmount: number; changeAmount: number }>;
  }): Promise<SaleDetail> {
    if (!input.cart.length) throw new Error('ไม่มีสินค้าในตะกร้า');
    const timestamp = nowIso();
    const saleId = uid('sale');
    const subtotal = input.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const itemDiscount = input.cart.reduce((sum, item) => sum + clampDiscount(item.price * item.quantity, item.discountAmount, item.discountPercent), 0);
    const afterItemDiscount = Math.max(0, subtotal - itemDiscount);
    const billDiscount = clampDiscount(afterItemDiscount, input.billDiscountAmount, input.billDiscountPercent);
    const total = Math.max(0, afterItemDiscount - billDiscount);
    const sale: Sale = {
      id: saleId,
      billNo: await nextBillNo(),
      cashierId: input.cashier.id,
      cashierName: input.cashier.displayName,
      subtotal,
      discountAmount: itemDiscount + billDiscount,
      discountPercent: input.billDiscountPercent,
      total,
      status: 'completed',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const saleItems: SaleItem[] = input.cart.map((item) => {
      const lineSubtotal = item.price * item.quantity;
      const discount = clampDiscount(lineSubtotal, item.discountAmount, item.discountPercent);
      return {
        id: uid('item'),
        saleId,
        productId: item.productId,
        productName: item.name,
        price: item.price,
        quantity: item.quantity,
        subtotal: lineSubtotal,
        discountAmount: item.discountAmount,
        discountPercent: item.discountPercent,
        total: Math.max(0, lineSubtotal - discount),
        note: item.note,
        isOpenPrice: item.isOpenPrice,
        createdAt: timestamp,
      };
    });
    const payments: Payment[] = input.payments.map((payment) => ({
      id: uid('pay'),
      saleId,
      method: payment.method,
      amount: payment.amount,
      receivedAmount: payment.receivedAmount,
      changeAmount: payment.changeAmount,
      createdAt: timestamp,
    }));
    const discounts: DiscountLog[] = [
      ...saleItems.flatMap((item) => [
        ...(item.discountAmount > 0 ? [{ id: uid('disc'), saleId, saleItemId: item.id, discountType: 'amount' as const, value: item.discountAmount, approvedByUserId: input.cashier.id, createdAt: timestamp }] : []),
        ...(item.discountPercent > 0 ? [{ id: uid('disc'), saleId, saleItemId: item.id, discountType: 'percent' as const, value: item.discountPercent, approvedByUserId: input.cashier.id, createdAt: timestamp }] : []),
      ]),
      ...(input.billDiscountAmount > 0 ? [{ id: uid('disc'), saleId, discountType: 'amount' as const, value: input.billDiscountAmount, approvedByUserId: input.cashier.id, createdAt: timestamp }] : []),
      ...(input.billDiscountPercent > 0 ? [{ id: uid('disc'), saleId, discountType: 'percent' as const, value: input.billDiscountPercent, approvedByUserId: input.cashier.id, createdAt: timestamp }] : []),
    ];

    await db.transaction('rw', db.sales, db.sale_items, db.payments, db.discount_logs, async () => {
      await db.sales.add(sale);
      await db.sale_items.bulkAdd(saleItems);
      await db.payments.bulkAdd(payments);
      if (discounts.length) await db.discount_logs.bulkAdd(discounts);
    });
    const detail = { sale, items: saleItems, payments, discounts };
    await SyncQueueRepository.enqueue({ tableName: 'sales', recordId: sale.id, action: 'upsert', payload: detail });
    return detail;
  },
  async getSaleById(id: string) {
    const sale = await db.sales.get(id);
    if (!sale) return null;
    return this.getSaleDetail(sale);
  },
  async getSaleByBillNo(billNo: string) {
    const sale = await db.sales.where('billNo').equals(billNo).first();
    if (!sale) return null;
    return this.getSaleDetail(sale);
  },
  async getSaleDetail(sale: Sale): Promise<SaleDetail> {
    const [items, payments, discounts] = await Promise.all([
      db.sale_items.where('saleId').equals(sale.id).toArray(),
      db.payments.where('saleId').equals(sale.id).toArray(),
      db.discount_logs.where('saleId').equals(sale.id).toArray(),
    ]);
    return { sale, items, payments, discounts };
  },
  async searchSales(filters: { query?: string; date?: string; cashierId?: string; method?: string; status?: string }) {
    let sales = await db.sales.orderBy('createdAt').reverse().toArray();
    if (filters.query) sales = sales.filter((sale) => sale.billNo.toLowerCase().includes(filters.query!.toLowerCase()));
    if (filters.date) sales = sales.filter((sale) => sale.createdAt >= startOfDayIso(filters.date!) && sale.createdAt <= endOfDayIso(filters.date!));
    if (filters.cashierId) sales = sales.filter((sale) => sale.cashierId === filters.cashierId);
    if (filters.status) sales = sales.filter((sale) => sale.status === filters.status);
    if (filters.method) {
      const payments = await db.payments.where('method').equals(filters.method).toArray();
      const ids = new Set(payments.map((payment) => payment.saleId));
      sales = sales.filter((sale) => ids.has(sale.id));
    }
    return Promise.all(sales.map((sale) => this.getSaleDetail(sale)));
  },
  async voidSale(id: string, reason: string, userId: string) {
    await db.sales.update(id, { status: 'voided', voidReason: reason, voidedByUserId: userId, updatedAt: nowIso() });
    const detail = await this.getSaleById(id);
    if (detail) await SyncQueueRepository.enqueue({ tableName: 'sales', recordId: id, action: 'upsert', payload: detail });
  },
  async refundSale(id: string, reason: string, userId: string) {
    await db.sales.update(id, { status: 'refunded', voidReason: reason, voidedByUserId: userId, updatedAt: nowIso() });
    const detail = await this.getSaleById(id);
    if (detail) await SyncQueueRepository.enqueue({ tableName: 'sales', recordId: id, action: 'upsert', payload: detail });
  },
};
