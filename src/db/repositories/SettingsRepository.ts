import { db } from '../database';
import { nowIso } from '../../utils/date';
import type { ActivityLog, AppSetting, CashDrawerLog, Category, DiscountLog, ParkedBill, Payment, Product, Sale, SaleItem, User, ExternalReportExport, ExternalReportImport, ExternalReportRow } from '../../types';
import { SyncQueueRepository } from '../syncQueue';

interface BackupData {
  users: User[];
  categories: Category[];
  products: Product[];
  sales: Sale[];
  sale_items: SaleItem[];
  payments: Payment[];
  discount_logs: DiscountLog[];
  activity_logs: ActivityLog[];
  settings: AppSetting[];
  parked_bills: ParkedBill[];
  external_report_exports?: ExternalReportExport[];
  external_report_imports?: ExternalReportImport[];
  external_report_rows?: ExternalReportRow[];
  cash_drawer_logs?: CashDrawerLog[];
}

export const SettingsRepository = {
  async getSetting(key: string, fallback = '') {
    return (await db.settings.get(key))?.value ?? fallback;
  },
  async getAll() {
    return db.settings.toArray();
  },
  async setSetting(key: string, value: string, options: { sync?: boolean } = {}) {
    const setting = { key, value, updatedAt: nowIso() };
    await db.settings.put(setting);
    if (options.sync) {
      await SyncQueueRepository.enqueue({ tableName: 'settings', recordId: key, action: 'upsert', payload: setting });
    }
  },
  /**
   * Ensure a setting that already exists in IndexedDB has been pushed to the
   * cloud at least once. Idempotent — guarded by settingsSyncBackfill flag.
   *
   * Only pushes when the key IS present locally (never overwrites cloud with
   * stale defaults). Call this from pages that require elevated permission
   * (e.g. UserManagementPage) so only authorised users trigger the push.
   */
  async ensureSettingSynced(key: string) {
    const existing = await db.settings.get(key);
    if (!existing) return; // nothing local to push — let sync pull decide
    await this.backfillSettingsForSync([key]);
  },
  async backfillSettingsForSync(keys: string[]) {
    let count = 0;
    for (const key of keys) {
      const backfillKey = `settingsSyncBackfill:${key}`;
      if (await db.settings.get(backfillKey)) continue;
      const setting = await db.settings.get(key);
      if (setting) {
        await SyncQueueRepository.enqueue({ tableName: 'settings', recordId: key, action: 'upsert', payload: setting });
        count += 1;
      }
      await db.settings.put({ key: backfillKey, value: 'true', updatedAt: nowIso() });
    }
    return count;
  },
  async exportAllData(): Promise<BackupData> {
    const [users, categories, products, sales, saleItems, payments, discounts, logs, settings, parkedBills, externalExports, externalImports, externalRows, drawerLogs] = await Promise.all([
      db.users.toArray(),
      db.categories.toArray(),
      db.products.toArray(),
      db.sales.toArray(),
      db.sale_items.toArray(),
      db.payments.toArray(),
      db.discount_logs.toArray(),
      db.activity_logs.toArray(),
      db.settings.toArray(),
      db.parked_bills.toArray(),
      db.external_report_exports.toArray(),
      db.external_report_imports.toArray(),
      db.external_report_rows.toArray(),
      db.cash_drawer_logs.toArray(),
    ]);
    return { users, categories, products, sales, sale_items: saleItems, payments, discount_logs: discounts, activity_logs: logs, settings, parked_bills: parkedBills, external_report_exports: externalExports, external_report_imports: externalImports, external_report_rows: externalRows, cash_drawer_logs: drawerLogs };
  },
  async importAllData(data: BackupData) {
    await db.transaction('rw', db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
      await db.users.bulkPut(data.users ?? []);
      await db.categories.bulkPut(data.categories ?? []);
      await db.products.bulkPut(data.products ?? []);
      await db.sales.bulkPut(data.sales ?? []);
      await db.sale_items.bulkPut(data.sale_items ?? []);
      await db.payments.bulkPut(data.payments ?? []);
      await db.discount_logs.bulkPut(data.discount_logs ?? []);
      await db.activity_logs.bulkPut(data.activity_logs ?? []);
      await db.settings.bulkPut(data.settings ?? []);
      await db.parked_bills.bulkPut(data.parked_bills ?? []);
      await db.external_report_exports.bulkPut(data.external_report_exports ?? []);
      await db.external_report_imports.bulkPut(data.external_report_imports ?? []);
      await db.external_report_rows.bulkPut(data.external_report_rows ?? []);
      await db.cash_drawer_logs.bulkPut(data.cash_drawer_logs ?? []);
    });
  },
  async clearAllData() {
    await db.transaction('rw', db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  },

  async clearSalesHistory() {
    await db.transaction('rw', [db.sales, db.sale_items, db.payments, db.discount_logs], async () => {
      await db.discount_logs.clear();
      await db.payments.clear();
      await db.sale_items.clear();
      await db.sales.clear();
    });
  },
};
