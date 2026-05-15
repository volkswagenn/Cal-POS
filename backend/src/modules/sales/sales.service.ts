import { prisma } from '../../db/prisma.js';

type SaleDetailInput = {
  sale: {
    id: string;
    billNo: string;
    cashierId: string;
    cashierName: string;
    subtotal: number;
    discountAmount: number;
    discountPercent: number;
    total: number;
    status: string;
    voidReason?: string;
    voidedByUserId?: string;
    createdAt: string;
    updatedAt: string;
  };
  items: Array<{
    id: string;
    saleId: string;
    productId: string;
    productName: string;
    price: number;
    quantity: number;
    subtotal: number;
    discountAmount: number;
    discountPercent: number;
    total: number;
    note?: string;
    isOpenPrice: boolean;
    createdAt: string;
  }>;
  payments: Array<{
    id: string;
    saleId: string;
    method: string;
    amount: number;
    receivedAmount: number;
    changeAmount: number;
    createdAt: string;
  }>;
  discounts: Array<{
    id: string;
    saleId: string;
    saleItemId?: string;
    discountType: string;
    value: number;
    approvedByUserId?: string;
    createdAt: string;
  }>;
};

async function resolveBillNo(shopId: string, saleId: string, requestedBillNo: string): Promise<string> {
  const conflict = await prisma.sale.findFirst({
    where: { shopId, billNo: requestedBillNo, NOT: { id: saleId } },
    select: { id: true },
  });
  if (!conflict) return requestedBillNo;

  // Collision: renumber to next available numeric billNo for this shop
  const existing = await prisma.sale.findMany({
    where: { shopId },
    select: { billNo: true },
  });
  const maxNum = existing
    .map((s) => parseInt(s.billNo, 10))
    .filter((n) => Number.isFinite(n))
    .reduce((max, n) => (n > max ? n : max), 0);

  let candidate = maxNum + 1;
  // Safety loop in case of races
  while (
    await prisma.sale.findFirst({
      where: { shopId, billNo: String(candidate) },
      select: { id: true },
    })
  ) {
    candidate++;
  }
  return String(candidate);
}

export async function upsertSaleDetail(shopId: string, input: SaleDetailInput) {
  const billNo = await resolveBillNo(shopId, input.sale.id, input.sale.billNo);

  await prisma.sale.upsert({
    where: { id: input.sale.id },
    update: {
      billNo,
      cashierId: input.sale.cashierId,
      cashierName: input.sale.cashierName,
      subtotal: input.sale.subtotal,
      discountAmount: input.sale.discountAmount,
      discountPercent: input.sale.discountPercent,
      total: input.sale.total,
      status: input.sale.status,
      voidReason: input.sale.voidReason,
      voidedByUserId: input.sale.voidedByUserId,
      updatedAt: new Date(input.sale.updatedAt),
    },
    create: {
      id: input.sale.id,
      shopId,
      billNo,
      cashierId: input.sale.cashierId,
      cashierName: input.sale.cashierName,
      subtotal: input.sale.subtotal,
      discountAmount: input.sale.discountAmount,
      discountPercent: input.sale.discountPercent,
      total: input.sale.total,
      status: input.sale.status,
      voidReason: input.sale.voidReason,
      voidedByUserId: input.sale.voidedByUserId,
      createdAt: new Date(input.sale.createdAt),
      updatedAt: new Date(input.sale.updatedAt),
    },
  });

  await Promise.all([
    ...input.items.map((item) =>
      prisma.saleItem.upsert({
        where: { id: item.id },
        update: {
          productId: item.productId,
          productName: item.productName,
          price: item.price,
          quantity: item.quantity,
          subtotal: item.subtotal,
          discountAmount: item.discountAmount,
          discountPercent: item.discountPercent,
          total: item.total,
          note: item.note,
          isOpenPrice: item.isOpenPrice,
        },
        create: {
          id: item.id,
          saleId: input.sale.id,
          productId: item.productId,
          productName: item.productName,
          price: item.price,
          quantity: item.quantity,
          subtotal: item.subtotal,
          discountAmount: item.discountAmount,
          discountPercent: item.discountPercent,
          total: item.total,
          note: item.note,
          isOpenPrice: item.isOpenPrice,
          createdAt: new Date(item.createdAt),
        },
      }),
    ),
    ...input.payments.map((payment) =>
      prisma.payment.upsert({
        where: { id: payment.id },
        update: {
          method: payment.method,
          amount: payment.amount,
          receivedAmount: payment.receivedAmount,
          changeAmount: payment.changeAmount,
        },
        create: {
          id: payment.id,
          saleId: input.sale.id,
          method: payment.method,
          amount: payment.amount,
          receivedAmount: payment.receivedAmount,
          changeAmount: payment.changeAmount,
          createdAt: new Date(payment.createdAt),
        },
      }),
    ),
    ...input.discounts.map((discount) =>
      prisma.discountLog.upsert({
        where: { id: discount.id },
        update: {
          saleItemId: discount.saleItemId,
          discountType: discount.discountType,
          value: discount.value,
          approvedByUserId: discount.approvedByUserId,
        },
        create: {
          id: discount.id,
          saleId: input.sale.id,
          saleItemId: discount.saleItemId,
          discountType: discount.discountType,
          value: discount.value,
          approvedByUserId: discount.approvedByUserId,
          createdAt: new Date(discount.createdAt),
        },
      }),
    ),
  ]);
}
