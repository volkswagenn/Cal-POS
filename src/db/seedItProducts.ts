import { db } from './database';
import type { Category, Product } from '../types';
import { nowIso } from '../utils/date';
import { defaultSortOrder } from '../utils/sortOrder';
import { SyncQueueRepository } from './syncQueue';

// One-time seed for the "สินค้า IT" category requested for this store. It is NOT
// added to the default catalog (CatalogDefaultRepository), so a "reset to default"
// will not recreate it — it is inserted once into the live database and guarded by
// the settings flag below so it never duplicates on subsequent launches.
const IT_SEED_FLAG = 'itProductsSeedV1';
const IT_CATEGORY_ID = 'cat_it';
const IT_CATEGORY_NAME = 'สินค้า IT';
const IT_CATEGORY_COLOR = '#0891b2';

// Price/name pattern: per decade → x5, x9, (x+1)0  →  5,9,10, 15,19,20, … 95,99,100.
function buildItPrices(): number[] {
  const prices: number[] = [];
  for (let decade = 0; decade < 10; decade += 1) {
    prices.push(decade * 10 + 5, decade * 10 + 9, decade * 10 + 10);
  }
  return prices;
}

export async function ensureItProductsSeed() {
  if (await db.settings.get(IT_SEED_FLAG)) return;

  const timestamp = nowIso();
  const category: Category = {
    id: IT_CATEGORY_ID,
    name: IT_CATEGORY_NAME,
    color: IT_CATEGORY_COLOR,
    sortOrder: defaultSortOrder(),
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  // Names are kept literally as the number ("5"/"9"/…) per the request (ชื่อ/ราคา 5/5),
  // not normalized to "5 บาท".
  const products: Product[] = buildItPrices().map((price) => ({
    id: `prod_it_${price}`,
    name: `${price}`,
    displayName: `${price}`,
    price,
    categoryId: IT_CATEGORY_ID,
    color: IT_CATEGORY_COLOR,
    sortOrder: price,
    isActive: true,
    isOpenPrice: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));

  const created: { categories: Category[]; products: Product[] } = { categories: [], products: [] };

  await db.transaction('rw', [db.categories, db.products, db.settings], async () => {
    // Skip if the user already deleted these defaults before (don't resurrect them).
    if (await db.settings.get(IT_SEED_FLAG)) return;

    if (!(await db.categories.get(IT_CATEGORY_ID))) {
      await db.categories.add(category);
      created.categories.push(category);
    }
    for (const product of products) {
      if (!(await db.products.get(product.id))) {
        await db.products.add(product);
        created.products.push(product);
      }
    }
    await db.settings.put({ key: IT_SEED_FLAG, value: 'true', updatedAt: timestamp });
  });

  // Push the new category first (so products satisfy the FK on the cloud), then products.
  for (const cat of created.categories) {
    await SyncQueueRepository.enqueue({ tableName: 'categories', recordId: cat.id, action: 'upsert', payload: cat });
  }
  for (const product of created.products) {
    await SyncQueueRepository.enqueue({ tableName: 'products', recordId: product.id, action: 'upsert', payload: product });
  }
}
