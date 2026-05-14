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

export async function upsertSaleDetail(shopId: string, input: SaleDetailInput) {
  await prisma.sale.upsert({
    where: { id: input.sale.id },
    update: {
      billNo: input.sale.billNo,
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
      billNo: input.sale.billNo,
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
