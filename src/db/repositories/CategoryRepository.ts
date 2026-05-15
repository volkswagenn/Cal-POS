import { db } from '../database';
import type { Category } from '../../types';
import { nowIso } from '../../utils/date';
import { uid } from '../../utils/id';
import { SyncQueueRepository } from '../syncQueue';

const DELETED_DEFAULT_CATEGORY_IDS = 'deletedDefaultCategoryIds';
const CATEGORY_SYNC_BACKFILL_KEY = 'categoriesSyncBackfillV1';

async function rememberDeletedDefaultCategory(id: string) {
  if (!id.startsWith('cat_')) return;
  const current = await db.settings.get(DELETED_DEFAULT_CATEGORY_IDS);
  let ids: string[] = [];
  try {
    ids = current?.value ? JSON.parse(current.value) : [];
  } catch {
    ids = [];
  }
  if (ids.includes(id)) return;
  await db.settings.put({ key: DELETED_DEFAULT_CATEGORY_IDS, value: JSON.stringify([...ids, id]), updatedAt: nowIso() });
}

export const CategoryRepository = {
  async getCategories(includeHidden = false) {
    const list = await db.categories.orderBy('sortOrder').toArray();
    return includeHidden ? list : list.filter((item) => item.isActive);
  },
  async createCategory(input: Pick<Category, 'name' | 'color'> & Partial<Category>) {
    const timestamp = nowIso();
    const category: Category = {
      id: uid('cat'),
      name: input.name,
      color: input.color,
      icon: input.icon,
      sortOrder: input.sortOrder ?? Date.now(),
      isActive: input.isActive ?? true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await db.categories.add(category);
    await SyncQueueRepository.enqueue({ tableName: 'categories', recordId: category.id, action: 'upsert', payload: category });
    return category;
  },
  async updateCategory(id: string, patch: Partial<Category>) {
    await db.categories.update(id, { ...patch, updatedAt: nowIso() });
    const category = await db.categories.get(id);
    if (category) {
      await SyncQueueRepository.enqueue({ tableName: 'categories', recordId: id, action: 'upsert', payload: category });
    }
  },
  async deleteCategory(id: string) {
    await rememberDeletedDefaultCategory(id);
    await db.categories.delete(id);
    await SyncQueueRepository.enqueue({ tableName: 'categories', recordId: id, action: 'delete', payload: { id } });
  },
  // One-time migration: push all existing categories to the cloud so products
  // can satisfy the FK constraint (Product.categoryId → Category.id) on first sync.
  async backfillCategoriesForSync() {
    if (await db.settings.get(CATEGORY_SYNC_BACKFILL_KEY)) return 0;
    const categories = await db.categories.toArray();
    for (const category of categories) {
      await SyncQueueRepository.enqueue({ tableName: 'categories', recordId: category.id, action: 'upsert', payload: category });
    }
    await db.settings.put({ key: CATEGORY_SYNC_BACKFILL_KEY, value: 'true', updatedAt: nowIso() });
    return categories.length;
  },
  async reorderCategories(ids: string[]) {
    await db.transaction('rw', db.categories, async () => {
      await Promise.all(ids.map((id, sortOrder) => db.categories.update(id, { sortOrder, updatedAt: nowIso() })));
    });
    const categories = await db.categories.bulkGet(ids);
    await Promise.all(categories
      .filter((category): category is Category => Boolean(category))
      .map((category) => SyncQueueRepository.enqueue({ tableName: 'categories', recordId: category.id, action: 'upsert', payload: category })));
  },
};
