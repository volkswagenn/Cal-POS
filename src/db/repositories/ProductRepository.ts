import { db } from '../database';
import type { Product } from '../../types';
import { nowIso } from '../../utils/date';
import { uid } from '../../utils/id';
import { normalizeProductNameFields } from '../../utils/productName';
import { SyncQueueRepository } from '../syncQueue';

// V2: refresh updatedAt to now so delayed items aren't missed by pull cursors
const PRODUCT_SYNC_BACKFILL_KEY = 'productsSyncBackfillV2';

function productSortValue(product: Product) {
  if (product.isOpenPrice) return Number.MAX_SAFE_INTEGER;
  return Number.isFinite(product.price) ? product.price : Number.MAX_SAFE_INTEGER - 1;
}

function compareProductsAsc(a: Product, b: Product) {
  if (a.isOpenPrice !== b.isOpenPrice) return a.isOpenPrice ? 1 : -1;
  const priceCompare = productSortValue(a) - productSortValue(b);
  if (priceCompare !== 0) return priceCompare;
  const nameCompare = a.name.localeCompare(b.name, ['th', 'en'], { numeric: true, sensitivity: 'base' });
  if (nameCompare !== 0) return nameCompare;
  return a.id.localeCompare(b.id);
}

function compareProductsBySavedOrder(a: Product, b: Product) {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, ['th', 'en'], { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id);
}

export const ProductRepository = {
  async getProducts(includeHidden = false) {
    const list = await db.products.orderBy('sortOrder').toArray();
    return (includeHidden ? list : list.filter((item) => item.isActive)).sort(compareProductsBySavedOrder);
  },
  async getProductsByCategory(categoryId: string) {
    return (await db.products.where('categoryId').equals(categoryId).sortBy('sortOrder')).filter((item) => item.isActive).sort(compareProductsBySavedOrder);
  },
  async createProduct(input: Pick<Product, 'name' | 'displayName' | 'price' | 'categoryId' | 'color'> & Partial<Product>) {
    const timestamp = nowIso();
    const product: Product = normalizeProductNameFields({
      id: uid('prod'),
      name: input.name,
      displayName: input.displayName,
      price: Number(input.price),
      categoryId: input.categoryId,
      color: input.color,
      sortOrder: input.sortOrder ?? Date.now(),
      isActive: input.isActive ?? true,
      isOpenPrice: input.isOpenPrice ?? false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await db.products.add(product);
    await SyncQueueRepository.enqueue({ tableName: 'products', recordId: product.id, action: 'upsert', payload: product });
    return product;
  },
  async updateProduct(id: string, patch: Partial<Product>) {
    const current = await db.products.get(id);
    const nextPatch = current ? normalizeProductNameFields({ ...current, ...patch }) : patch;
    await db.products.update(id, { ...nextPatch, updatedAt: nowIso() });
    const product = await db.products.get(id);
    if (product) {
      await SyncQueueRepository.enqueue({ tableName: 'products', recordId: id, action: 'upsert', payload: product });
    }
  },
  async deleteProduct(id: string) {
    await db.products.delete(id);
    await SyncQueueRepository.enqueue({ tableName: 'products', recordId: id, action: 'delete', payload: { id } });
  },
  async reorderProducts(ids: string[]) {
    await db.transaction('rw', db.products, async () => {
      await Promise.all(ids.map((id, sortOrder) => db.products.update(id, { sortOrder, updatedAt: nowIso() })));
    });
    const products = await db.products.bulkGet(ids);
    await Promise.all(products
      .filter((product): product is Product => Boolean(product))
      .map((product) => SyncQueueRepository.enqueue({ tableName: 'products', recordId: product.id, action: 'upsert', payload: product })));
  },
  // Reorder products within a single category without affecting other categories' sort positions.
  // Uses the same category-offset scheme as reorderProductsByNameAscWithinCategories so sortOrder
  // values from different categories never collide.
  async reorderProductsInCategory(categoryId: string, ids: string[]) {
    const category = await db.categories.get(categoryId);
    const categoryOffset = category ? (category.sortOrder + 1) * 100_000 : 0;
    const timestamp = nowIso();
    await db.transaction('rw', db.products, async () => {
      await Promise.all(ids.map((id, index) => db.products.update(id, { sortOrder: categoryOffset + index + 1, updatedAt: timestamp })));
    });
    const products = await db.products.bulkGet(ids);
    await Promise.all(products
      .filter((product): product is Product => Boolean(product))
      .map((product) => SyncQueueRepository.enqueue({ tableName: 'products', recordId: product.id, action: 'upsert', payload: product })));
  },
  // One-time migration: push all existing products to the cloud after categories
  // are already synced (call backfillCategoriesForSync first to avoid FK errors).
  // V2: refreshes updatedAt to now so items with old timestamps aren't missed
  // by other devices whose pull cursor has already advanced past the original date.
  async backfillProductsForSync() {
    if (await db.settings.get(PRODUCT_SYNC_BACKFILL_KEY)) return 0;
    const now = nowIso();
    const products = await db.products.toArray();
    for (const product of products) {
      const payload = { ...product, updatedAt: now };
      await db.products.update(product.id, { updatedAt: now });
      await SyncQueueRepository.enqueue({ tableName: 'products', recordId: product.id, action: 'upsert', payload });
    }
    await db.settings.put({ key: PRODUCT_SYNC_BACKFILL_KEY, value: 'true', updatedAt: nowIso() });
    return products.length;
  },
  async reorderProductsByNameAscWithinCategories() {
    const timestamp = nowIso();
    const products = await db.products.toArray();
    const categories = await db.categories.orderBy('sortOrder').toArray();
    await db.transaction('rw', db.products, async () => {
      for (const category of categories) {
        const categoryProducts = products
          .filter((product) => product.categoryId === category.id)
          .sort(compareProductsAsc);
        const categoryOffset = (category.sortOrder + 1) * 100000;
        await Promise.all(categoryProducts.map((product, index) => db.products.update(product.id, { sortOrder: categoryOffset + index + 1, updatedAt: timestamp })));
      }
    });
    const nextProducts = await db.products.toArray();
    await Promise.all(nextProducts.map((product) => SyncQueueRepository.enqueue({ tableName: 'products', recordId: product.id, action: 'upsert', payload: product })));
  },
};
