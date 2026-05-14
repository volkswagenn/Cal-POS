import { db } from '../database';
import type { Category, Product } from '../../types';
import { nowIso } from '../../utils/date';
import { normalizeProductNameFields, shouldKeepProductName } from '../../utils/productName';

const CATALOG_DEFAULT_SNAPSHOT_KEY = 'catalogDefaultSnapshotV2';
const CATALOG_BAHT_MIGRATION_KEY = 'catalogProductNameBahtV1';

interface CatalogDefaultSnapshot {
  categories: Category[];
  products: Product[];
}

function normalizeCatalogProduct(product: Product, timestamp = nowIso()): Product {
  if (shouldKeepProductName(product)) return { ...product, updatedAt: timestamp };
  return normalizeProductNameFields({ ...product, updatedAt: timestamp });
}

function parseSnapshot(value?: string): CatalogDefaultSnapshot | null {
  try {
    const parsed = value ? JSON.parse(value) : null;
    if (!parsed || !Array.isArray(parsed.categories) || !Array.isArray(parsed.products)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeSnapshot(categories: Category[], products: Product[], timestamp: string) {
  await db.settings.put({
    key: CATALOG_DEFAULT_SNAPSHOT_KEY,
    value: JSON.stringify({ categories, products } satisfies CatalogDefaultSnapshot),
    updatedAt: timestamp,
  });
}

export const CatalogDefaultRepository = {
  async ensureProductNameBahtDefault() {
    if (await db.settings.get(CATALOG_BAHT_MIGRATION_KEY)) return;
    const timestamp = nowIso();
    await db.transaction('rw', db.categories, db.products, db.settings, async () => {
      const categories = await db.categories.toArray();
      const products = (await db.products.toArray()).map((product) => normalizeCatalogProduct(product, timestamp));
      await db.products.bulkPut(products);
      await writeSnapshot(categories, products, timestamp);
      await db.settings.put({ key: CATALOG_BAHT_MIGRATION_KEY, value: 'true', updatedAt: timestamp });
    });
  },

  async resetToDefaultCatalog() {
    const snapshot = parseSnapshot((await db.settings.get(CATALOG_DEFAULT_SNAPSHOT_KEY))?.value);
    if (!snapshot) throw new Error('ยังไม่มีค่าเริ่มต้นสินค้าและหมวดหมู่ที่บันทึกไว้');
    const timestamp = nowIso();
    const categories = snapshot.categories.map((category) => ({ ...category, updatedAt: timestamp }));
    const products = snapshot.products.map((product) => normalizeCatalogProduct(product, timestamp));
    await db.transaction('rw', db.categories, db.products, db.settings, async () => {
      await db.categories.clear();
      await db.products.clear();
      await db.categories.bulkPut(categories);
      await db.products.bulkPut(products);
      await db.settings.delete('deletedDefaultCategoryIds');
      await writeSnapshot(categories, products, timestamp);
    });
  },
};
