import Dexie, { Table } from 'dexie';
import type { ActivityLog, AppSetting, CashDrawerLog, Category, DiscountLog, ExternalReportExport, ExternalReportImport, ExternalReportRow, ParkedBill, Payment, Product, Sale, SaleItem, SyncQueueItem, User } from '../types';

const schema = {
  users: 'id, username, pin, role, isActive',
  categories: 'id, sortOrder, isActive',
  products: 'id, categoryId, sortOrder, isActive, isOpenPrice',
  sales: 'id, billNo, cashierId, status, createdAt',
  sale_items: 'id, saleId, productId, createdAt',
  payments: 'id, saleId, method, createdAt',
  discount_logs: 'id, saleId, saleItemId, createdAt',
  activity_logs: 'id, userId, entityType, entityId, createdAt',
  settings: 'key',
  parked_bills: 'id, cashierId, createdAt',
  external_report_exports: 'id, reportType, dateFrom, dateTo, createdAt',
  external_report_imports: 'id, importType, dateFrom, dateTo, status, createdAt',
  external_report_rows: 'id, importId, reportDate, source, createdAt',
  cash_drawer_logs: 'id, userId, action, status, createdAt',
  sync_queue: 'id, tableName, recordId, action, status, updatedAt',
};

export class CalPosDatabase extends Dexie {
  users!: Table<User, string>;
  categories!: Table<Category, string>;
  products!: Table<Product, string>;
  sales!: Table<Sale, string>;
  sale_items!: Table<SaleItem, string>;
  payments!: Table<Payment, string>;
  discount_logs!: Table<DiscountLog, string>;
  activity_logs!: Table<ActivityLog, string>;
  settings!: Table<AppSetting, string>;
  parked_bills!: Table<ParkedBill, string>;
  external_report_exports!: Table<ExternalReportExport, string>;
  external_report_imports!: Table<ExternalReportImport, string>;
  external_report_rows!: Table<ExternalReportRow, string>;
  cash_drawer_logs!: Table<CashDrawerLog, string>;
  sync_queue!: Table<SyncQueueItem, string>;

  constructor() {
    super('calpos_local_db');
    this.version(1).stores(schema);
    this.version(2).stores(schema);
    this.version(3).stores(schema);
    this.version(4).stores(schema);
  }
}

export const db = new CalPosDatabase();
