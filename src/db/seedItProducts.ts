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
// Bump when the "IT " name prefix is applied to already-seeded devices.
const IT_PREFIX_FLAG = 'itProductsPrefixV1';
const IT_CATEGORY_ID = 'cat_it';
const IT_CATEGORY_NAME = 'สินค้า IT';
const IT_CATEGORY_COLOR = '#0891b2';
const IT_NAME_PREFIX = 'IT ';

function itProductName(price: number) {
  return `${IT_NAME_PREFIX}${price}`;
}

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

  // Names are kept literally with an "IT " prefix per the request (e.g. "IT 5"),
  // not normalized to "5 บาท".
  const products: Product[] = buildItPrices().map((price) => ({
    id: `prod_it_${price}`,
    name: itProductName(price),
    displayName: itProductName(price),
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

/**
 * One-time migration: prepend "IT " to every product in the สินค้า IT category that
 * doesn't already have it. Covers devices that seeded the IT products before the
 * prefix was requested. Matches by category so manually-added IT items are renamed too.
 */
export async function ensureItProductPrefix() {
  if (await db.settings.get(IT_PREFIX_FLAG)) return;

  const timestamp = nowIso();
  const updated: Product[] = [];

  await db.transaction('rw', [db.products, db.settings], async () => {
    if (await db.settings.get(IT_PREFIX_FLAG)) return;
    const itProducts = await db.products.where('categoryId').equals(IT_CATEGORY_ID).toArray();
    for (const product of itProducts) {
      const name = product.name.startsWith(IT_NAME_PREFIX) ? product.name : `${IT_NAME_PREFIX}${product.name}`;
      const displayName = (product.displayName || '').startsWith(IT_NAME_PREFIX)
        ? product.displayName
        : `${IT_NAME_PREFIX}${product.displayName || product.name}`;
      if (name !== product.name || displayName !== product.displayName) {
        const next = { ...product, name, displayName, updatedAt: timestamp };
        await db.products.put(next);
        updated.push(next);
      }
    }
    await db.settings.put({ key: IT_PREFIX_FLAG, value: 'true', updatedAt: timestamp });
  });

  for (const product of updated) {
    await SyncQueueRepository.enqueue({ tableName: 'products', recordId: product.id, action: 'upsert', payload: product });
  }
}
