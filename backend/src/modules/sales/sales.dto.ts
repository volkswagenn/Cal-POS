export function toSaleDto(sale: {
  id: string;
  billNo: string;
  cashierId: string;
  cashierName: string;
  subtotal: unknown;
  discountAmount: unknown;
  discountPercent: unknown;
  total: unknown;
  status: string;
  voidReason: string | null;
  voidedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: sale.id,
    billNo: sale.billNo,
    cashierId: sale.cashierId,
    cashierName: sale.cashierName,
    subtotal: Number(sale.subtotal),
    discountAmount: Number(sale.discountAmount),
    discountPercent: Number(sale.discountPercent),
    total: Number(sale.total),
    status: sale.status,
    voidReason: sale.voidReason ?? undefined,
    voidedByUserId: sale.voidedByUserId ?? undefined,
    createdAt: sale.createdAt.toISOString(),
    updatedAt: sale.updatedAt.toISOString(),
  };
}

export function toSaleItemDto(item: {
  id: string;
  saleId: string;
  productId: string;
  productName: string;
  price: unknown;
  quantity: number;
  subtotal: unknown;
  discountAmount: unknown;
  discountPercent: unknown;
  total: unknown;
  note: string | null;
  isOpenPrice: boolean;
  createdAt: Date;
}) {
  return {
    id: item.id,
    saleId: item.saleId,
    productId: item.productId,
    productName: item.productName,
    price: Number(item.price),
    quantity: item.quantity,
    subtotal: Number(item.subtotal),
    discountAmount: Number(item.discountAmount),
    discountPercent: Number(item.discountPercent),
    total: Number(item.total),
    note: item.note ?? undefined,
    isOpenPrice: item.isOpenPrice,
    createdAt: item.createdAt.toISOString(),
  };
}

export function toPaymentDto(payment: {
  id: string;
  saleId: string;
  method: string;
  amount: unknown;
  receivedAmount: unknown;
  changeAmount: unknown;
  createdAt: Date;
}) {
  return {
    id: payment.id,
    saleId: payment.saleId,
    method: payment.method,
    amount: Number(payment.amount),
    receivedAmount: Number(payment.receivedAmount),
    changeAmount: Number(payment.changeAmount),
    createdAt: payment.createdAt.toISOString(),
  };
}

export function toDiscountDto(discount: {
  id: string;
  saleId: string;
  saleItemId: string | null;
  discountType: string;
  value: unknown;
  approvedByUserId: string | null;
  createdAt: Date;
}) {
  return {
    id: discount.id,
    saleId: discount.saleId,
    saleItemId: discount.saleItemId ?? undefined,
    discountType: discount.discountType,
    value: Number(discount.value),
    approvedByUserId: discount.approvedByUserId ?? undefined,
    createdAt: discount.createdAt.toISOString(),
  };
}

export function toSaleDetailDto(detail: {
  items: Parameters<typeof toSaleItemDto>[0][];
  payments: Parameters<typeof toPaymentDto>[0][];
  discounts: Parameters<typeof toDiscountDto>[0][];
} & { [key: string]: unknown; id: string; billNo: string; cashierId: string; cashierName: string; subtotal: unknown; discountAmount: unknown; discountPercent: unknown; total: unknown; status: string; voidReason: string | null; voidedByUserId: string | null; createdAt: Date; updatedAt: Date }) {
  return {
    sale: toSaleDto(detail),
    items: detail.items.map(toSaleItemDto),
    payments: detail.payments.map(toPaymentDto),
    discounts: detail.discounts.map(toDiscountDto),
  };
}
