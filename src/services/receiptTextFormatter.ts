import type { SaleDetail } from '../types';
import { formatDateTime } from '../utils/date';
import { clampDiscount } from '../utils/money';

export interface ReceiptContentSettings {
  storeName: string;
  branchName: string;
  taxId: string;
  receiptFooter: string;
  currencySymbol: string;
}

export const defaultReceiptContentSettings: ReceiptContentSettings = {
  storeName: 'Cal POS Store',
  branchName: 'สาขาหลัก',
  taxId: '',
  receiptFooter: 'ขอบคุณที่ใช้บริการ',
  currencySymbol: '฿',
};

// Thai combining marks (tone marks, short vowels above/below) are zero-width —
// Intl.Segmenter counts them as part of the preceding grapheme cluster (1 cell).
type GraphemeSegment = { segment: string };
type IntlWithSegmenter = typeof Intl & {
  Segmenter?: new () => { segment(value: string): Iterable<GraphemeSegment> };
};

const intlWithSegmenter = Intl as IntlWithSegmenter;
const _seg = (typeof Intl !== 'undefined' && intlWithSegmenter.Segmenter)
  ? new intlWithSegmenter.Segmenter()
  : null;

function graphemes(value: string): string[] {
  if (_seg) return [..._seg.segment(value)].map(s => s.segment);
  return Array.from(value);
}

function charLength(value: string) {
  return graphemes(value).length;
}

function cut(value: string, width: number) {
  return graphemes(value).slice(0, Math.max(0, width)).join('');
}

function line(width: number, char = '-') {
  return char.repeat(width);
}

function center(text: string, width: number) {
  const value = cut(text, width);
  const left = Math.max(0, Math.floor((width - charLength(value)) / 2));
  return `${' '.repeat(left)}${value}`;
}

function columns(left: string, right: string, width: number) {
  const rightValue = cut(right, Math.max(8, Math.floor(width / 2)));
  const rightLength = charLength(rightValue);
  const leftWidth = Math.max(0, width - rightLength - 1);
  const leftValue = cut(left, leftWidth);
  const gap = Math.max(1, width - charLength(leftValue) - rightLength);
  return `${leftValue}${' '.repeat(gap)}${rightValue}`;
}

function amount(value: number, currencySymbol: string) {
  return `${currencySymbol}${Number(value || 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function paymentMethodLabel(method: string) {
  const labels: Record<string, string> = {
    cash: 'เงินสด',
    transfer: 'โอนเงิน',
    qr: 'QR',
    credit: 'บัตรเครดิต',
    mixed: 'หลายช่องทาง',
  };
  return labels[method] ?? method;
}

function itemDiscountLabel(discountAmount: number, discountPercent: number, discountValue: number, currencySymbol: string) {
  if (discountValue <= 0) return '';
  if (discountPercent > 0) return `ส่วนลด ${discountPercent}%`;
  if (discountAmount > 0) return `ส่วนลด ${amount(discountAmount, currencySymbol)}`;
  return 'ส่วนลด';
}

export function formatReceiptText(
  detail: SaleDetail,
  charsPerLineValue: string,
  contentSettings: ReceiptContentSettings = defaultReceiptContentSettings,
  options: { hideSensitiveInfo?: boolean } = {},
) {
  const width = Math.min(46, Math.max(30, Number(charsPerLineValue) || 42));
  const received = detail.payments.reduce((sum, payment) => sum + payment.receivedAmount, 0);
  const change = detail.payments.reduce((sum, payment) => sum + payment.changeAmount, 0);
  const currencySymbol = contentSettings.currencySymbol || defaultReceiptContentSettings.currencySymbol;
  const rows: string[] = [];

  rows.push(center(contentSettings.storeName.trim() || defaultReceiptContentSettings.storeName, width));
  if (!options.hideSensitiveInfo) {
    if (contentSettings.branchName.trim()) rows.push(center(contentSettings.branchName, width));
    if (contentSettings.taxId.trim()) rows.push(center(`Tax ID: ${contentSettings.taxId}`, width));
    rows.push(center(detail.sale.billNo, width));
  }
  rows.push(center(formatDateTime(detail.sale.createdAt), width));
  if (!options.hideSensitiveInfo) {
    rows.push(center(`พนักงาน: ${detail.sale.cashierName}`, width));
  }
  rows.push(line(width));
  rows.push(columns('รายการ', 'ราคารวม', width));
  rows.push(line(width));

  detail.items.forEach((item) => {
    const discountValue = clampDiscount(item.subtotal, item.discountAmount, item.discountPercent);
    rows.push(columns(`${item.productName} x ${item.quantity}`, amount(item.total, currencySymbol), width));
    rows.push(cut(amount(item.price, currencySymbol), width));
    if (item.note?.trim()) rows.push(cut(`- ${item.note.trim()}`, width));
    if (discountValue > 0) {
      rows.push(columns(`- ${itemDiscountLabel(item.discountAmount, item.discountPercent, discountValue, currencySymbol)}`, `-${amount(discountValue, currencySymbol)}`, width));
    }
  });

  rows.push(line(width));
  rows.push(columns('รวมก่อนลด', amount(detail.sale.subtotal, currencySymbol), width));
  if (detail.sale.discountAmount > 0) rows.push(columns('ส่วนลดรวม', `-${amount(detail.sale.discountAmount, currencySymbol)}`, width));
  rows.push(columns('ยอดสุทธิ', amount(detail.sale.total, currencySymbol), width));
  rows.push(line(width));
  detail.payments.forEach((payment) => {
    rows.push(columns(`ชำระ: ${paymentMethodLabel(payment.method)}`, amount(payment.amount, currencySymbol), width));
    if (payment.receivedAmount !== payment.amount) rows.push(columns('รับจริง', amount(payment.receivedAmount, currencySymbol), width));
  });
  rows.push(columns('รับเงิน', amount(received, currencySymbol), width));
  rows.push(columns('เงินทอน', amount(change, currencySymbol), width));
  rows.push('');
  if (contentSettings.receiptFooter.trim()) rows.push(center(contentSettings.receiptFooter, width));
  rows.push('');

  return rows.join('\n');
}

export function formatSalesSummaryText(input: {
  date: string;
  payments: { cash: number; transfer: number; qr: number; credit: number };
  summary: {
    totalSales: number;
    billCount: number;
    totalDiscount: number;
    totalVoid?: number;
    totalRefund?: number;
  };
  charsPerLineValue: string;
  contentSettings?: ReceiptContentSettings;
}) {
  const width = Math.min(46, Math.max(30, Number(input.charsPerLineValue) || 42));
  const settings = input.contentSettings ?? defaultReceiptContentSettings;
  const currencySymbol = settings.currencySymbol || defaultReceiptContentSettings.currencySymbol;
  const totalPayment = input.payments.cash + input.payments.transfer + input.payments.qr + input.payments.credit;
  const rows: string[] = [];

  rows.push(center(`สรุปยอดขาย ${input.date}`, width));
  rows.push(center(settings.storeName.trim() || defaultReceiptContentSettings.storeName, width));
  if (settings.branchName.trim()) rows.push(center(settings.branchName, width));
  rows.push(line(width));
  rows.push(columns('เงินสด', amount(input.payments.cash, currencySymbol), width));
  rows.push(columns('เงินโอน', amount(input.payments.transfer, currencySymbol), width));
  rows.push(columns('QR', amount(input.payments.qr, currencySymbol), width));
  rows.push(columns('บัตรเครดิต', amount(input.payments.credit, currencySymbol), width));
  rows.push(line(width));
  rows.push(columns('ยอดรวมชำระ', amount(totalPayment, currencySymbol), width));
  rows.push(columns('จำนวนบิล', input.summary.billCount.toLocaleString('th-TH'), width));
  rows.push(columns('ส่วนลดรวม', amount(input.summary.totalDiscount, currencySymbol), width));
  if ((input.summary.totalVoid ?? 0) > 0) rows.push(columns('Void', amount(input.summary.totalVoid ?? 0, currencySymbol), width));
  if ((input.summary.totalRefund ?? 0) > 0) rows.push(columns('Refund', amount(input.summary.totalRefund ?? 0, currencySymbol), width));
  rows.push(line(width));
  rows.push(columns('ยอดขายสุทธิ', amount(input.summary.totalSales, currencySymbol), width));
  rows.push('');
  rows.push(center(`พิมพ์เมื่อ ${new Date().toLocaleString('th-TH')}`, width));
  rows.push('');

  return rows.join('\n');
}
