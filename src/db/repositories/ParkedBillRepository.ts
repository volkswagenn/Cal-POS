import { db } from '../database';
import type { CartItem, ParkedBill } from '../../types';
import { nowIso } from '../../utils/date';
import { uid } from '../../utils/id';

export type ParkedCartPayload = {
  items: CartItem[];
  billDiscountAmount: number;
  billDiscountPercent: number;
};

export const ParkedBillRepository = {
  async getParkedBills(cashierId?: string) {
    let rows = await db.parked_bills.orderBy('createdAt').reverse().toArray();
    if (cashierId) rows = rows.filter((bill) => bill.cashierId === cashierId);
    return rows;
  },
  async createParkedBill(input: { name: string; cashierId: string; cart: ParkedCartPayload }) {
    const timestamp = nowIso();
    const bill: ParkedBill = {
      id: uid('park'),
      name: input.name,
      cartJson: JSON.stringify(input.cart),
      cashierId: input.cashierId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await db.parked_bills.add(bill);
    return bill;
  },
  async updateName(id: string, name: string) {
    await db.parked_bills.update(id, { name, updatedAt: nowIso() });
  },
  parseCart(bill: ParkedBill): ParkedCartPayload {
    const parsed = JSON.parse(bill.cartJson) as Partial<ParkedCartPayload>;
    return {
      items: parsed.items ?? [],
      billDiscountAmount: Number(parsed.billDiscountAmount || 0),
      billDiscountPercent: Number(parsed.billDiscountPercent || 0),
    };
  },
  async deleteParkedBill(id: string) {
    await db.parked_bills.delete(id);
  },
};
