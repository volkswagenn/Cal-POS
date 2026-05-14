export type Role = string;
export type SaleStatus = 'completed' | 'voided' | 'refunded' | 'partially_refunded';
export type PaymentMethod = 'cash' | 'transfer' | 'qr' | 'credit' | 'mixed';
export type DiscountType = 'amount' | 'percent';

export interface User {
  id: string;
  shopId?: string;
  username: string;
  displayName: string;
  pin: string;
  passwordHash: string;
  passwordPlain?: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  icon?: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  name: string;
  displayName: string;
  price: number;
  categoryId: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
  isOpenPrice: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CartItem {
  cartItemId: string;
  productId: string;
  name: string;
  price: number;
  quantity: number;
  subtotal: number;
  discountAmount: number;
  discountPercent: number;
  note?: string;
  isOpenPrice: boolean;
  createdAt?: string;
}

export interface Sale {
  id: string;
  billNo: string;
  cashierId: string;
  cashierName: string;
  subtotal: number;
  discountAmount: number;
  discountPercent: number;
  total: number;
  status: SaleStatus;
  voidReason?: string;
  voidedByUserId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaleItem {
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
}

export interface Payment {
  id: string;
  saleId: string;
  method: PaymentMethod;
  amount: number;
  receivedAmount: number;
  changeAmount: number;
  createdAt: string;
}

export interface DiscountLog {
  id: string;
  saleId: string;
  saleItemId?: string;
  discountType: DiscountType;
  value: number;
  approvedByUserId?: string;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  detail: string;
  createdAt: string;
}

export type PrinterConnectionType = 'lan' | 'usb' | 'bluetooth';
export type PrinterStatus = 'not_configured' | 'disconnected' | 'connected';
export type CashDrawerAction = 'cash_in' | 'cash_out' | 'open_only';

export interface PrinterSettings {
  enabled: boolean;
  connectionType: PrinterConnectionType;
  printerName: string;
  ipAddress: string;
  port: string;
  usbVendorId: string;
  usbProductId: string;
  usbDeviceName?: string;
  bluetoothAddress: string;
  androidDriver: string;
  paperSize: '58mm' | '80mm' | 'A4';
  charsPerLine: string;
  receiptCharsPerLine58: string;
  receiptCharsPerLine80: string;
  receiptWidthDots58: string;
  receiptWidthDots80: string;
  receiptFontSizePx58: string;
  receiptFontSizePx80: string;
  autoPrintReceipt: boolean;
  autoCut: boolean;
  cutMode: 'full' | 'partial';
  drawerEnabled: boolean;
  drawerKickPin: '2' | '5';
  drawerPulseOnMs: string;
  drawerPulseOffMs: string;
  openDrawerAfterCashPayment: boolean;
}

export interface CashDrawerLog {
  id: string;
  userId: string;
  userName: string;
  action: CashDrawerAction;
  amount: number;
  note: string;
  printerName: string;
  status: 'success' | 'failed';
  error?: string;
  createdAt: string;
}

export interface AppSetting {
  key: string;
  value: string;
  updatedAt: string;
}

export interface ParkedBill {
  id: string;
  name: string;
  cartJson: string;
  cashierId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaleDetail {
  sale: Sale;
  items: SaleItem[];
  payments: Payment[];
  discounts: DiscountLog[];
}

export type ExternalReportType = 'daily_income' | 'payment_income' | 'expense' | 'expense_by_type' | 'income_expense';
export type ExportMode = 'single_row' | 'split_payment';

export interface ExternalReportExport {
  id: string;
  reportType: ExternalReportType;
  dateFrom: string;
  dateTo: string;
  format: 'csv' | 'xlsx';
  fileName: string;
  exportMode: ExportMode;
  createdByUserId: string;
  createdAt: string;
}

export interface ExternalReportImport {
  id: string;
  importType: ExternalReportType;
  dateFrom: string;
  dateTo: string;
  fileName: string;
  status: 'draft' | 'saved' | 'failed';
  createdByUserId: string;
  createdAt: string;
}

export interface ExternalReportRow {
  id: string;
  importId: string;
  reportDate: string;
  cashAmount: number;
  transferAmount: number;
  otherAmount: number;
  totalAmount: number;
  note: string;
  source: 'pos' | 'import';
  createdAt: string;
  updatedAt: string;
}

export interface SyncQueueItem {
  id: string;
  tableName: string;
  recordId: string;
  action: 'upsert' | 'delete';
  payloadJson: string;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}
