import { create } from 'zustand';
import type { CartItem, Product } from '../types';
import { clampDiscount } from '../utils/money';
import { uid } from '../utils/id';

interface CartState {
  items: CartItem[];
  billDiscountAmount: number;
  billDiscountPercent: number;
  addProduct: (product: Product, custom?: { price: number; note?: string }) => void;
  increase: (cartItemId: string) => void;
  decrease: (cartItemId: string) => void;
  remove: (cartItemId: string) => void;
  updateItem: (cartItemId: string, patch: Partial<CartItem>) => void;
  setBillDiscount: (amount: number, percent: number) => void;
  restoreCart: (input: { items: CartItem[]; billDiscountAmount: number; billDiscountPercent: number }) => void;
  clear: () => void;
  summary: () => { itemCount: number; subtotal: number; discountTotal: number; grandTotal: number };
}

function recalc(item: CartItem): CartItem {
  return { ...item, subtotal: item.price * item.quantity };
}

function hasNote(item: CartItem) {
  return Boolean(item.note?.trim());
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  billDiscountAmount: 0,
  billDiscountPercent: 0,
  addProduct: (product, custom) => set((state) => {
    if (!product.isOpenPrice && !custom) {
      const existing = state.items.find((item) => (
        item.productId === product.id
        && !item.isOpenPrice
        && !hasNote(item)
        && item.discountAmount === 0
        && item.discountPercent === 0
        && item.price === product.price
      ));
      if (existing) {
        return { items: state.items.map((item) => item.cartItemId === existing.cartItemId ? recalc({ ...item, quantity: item.quantity + 1 }) : item) };
      }
    }
    const price = custom?.price ?? product.price;
    const item: CartItem = {
      cartItemId: uid('cart'),
      productId: product.id,
      name: product.isOpenPrice ? 'OPEN PRICE' : product.name,
      price,
      quantity: 1,
      subtotal: price,
      discountAmount: 0,
      discountPercent: 0,
      note: custom?.note,
      isOpenPrice: product.isOpenPrice,
      createdAt: new Date().toISOString(),
    };
    return { items: [...state.items, item] };
  }),
  increase: (cartItemId) => set((state) => ({ items: state.items.map((item) => item.cartItemId === cartItemId ? recalc({ ...item, quantity: item.quantity + 1 }) : item) })),
  decrease: (cartItemId) => set((state) => ({ items: state.items.flatMap((item) => item.cartItemId === cartItemId ? (item.quantity <= 1 ? [] : [recalc({ ...item, quantity: item.quantity - 1 })]) : [item]) })),
  remove: (cartItemId) => set((state) => ({ items: state.items.filter((item) => item.cartItemId !== cartItemId) })),
  updateItem: (cartItemId, patch) => set((state) => {
    const target = state.items.find((item) => item.cartItemId === cartItemId);
    const nextNote = typeof patch.note === 'string' ? patch.note.trim() : undefined;
    if (target && nextNote && !hasNote(target) && target.quantity > 1 && target.discountAmount === 0 && target.discountPercent === 0) {
      const notedItem = recalc({
        ...target,
        ...patch,
        cartItemId: uid('cart'),
        quantity: 1,
        note: nextNote,
        createdAt: new Date().toISOString(),
      });
      return {
        items: state.items.flatMap((item) => (
          item.cartItemId === cartItemId
            ? [recalc({ ...item, quantity: item.quantity - 1 }), notedItem]
            : [item]
        )),
      };
    }
    return {
      items: state.items.map((item) => item.cartItemId === cartItemId ? recalc({ ...item, ...patch, note: nextNote ?? patch.note ?? item.note }) : item),
    };
  }),
  setBillDiscount: (amount, percent) => set({ billDiscountAmount: amount, billDiscountPercent: percent }),
  restoreCart: (input) => set({ items: input.items.map(recalc), billDiscountAmount: input.billDiscountAmount, billDiscountPercent: input.billDiscountPercent }),
  clear: () => set({ items: [], billDiscountAmount: 0, billDiscountPercent: 0 }),
  summary: () => {
    const { items, billDiscountAmount, billDiscountPercent } = get();
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const itemDiscount = items.reduce((sum, item) => sum + clampDiscount(item.price * item.quantity, item.discountAmount, item.discountPercent), 0);
    const afterItemDiscount = Math.max(0, subtotal - itemDiscount);
    const billDiscount = clampDiscount(afterItemDiscount, billDiscountAmount, billDiscountPercent);
    return { itemCount, subtotal, discountTotal: itemDiscount + billDiscount, grandTotal: Math.max(0, afterItemDiscount - billDiscount) };
  },
}));
