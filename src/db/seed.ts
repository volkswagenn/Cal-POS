import { db } from './database';
import type { AppSetting, Category, Product, User } from '../types';
import { nowIso } from '../utils/date';
import { sha256, uid } from '../utils/id';
import { normalizeProductNameFields } from '../utils/productName';
import { INT4_MAX, clampSortOrder } from '../utils/sortOrder';
import { defaultPrinterSettings } from './repositories/PrinterRepository';
import { SyncQueueRepository } from './syncQueue';

const categorySeeds = [
  ['cat_end5', 'Ending with 5', '#16a34a'],
  ['cat_1_29', 'Number 1-29', '#22c55e'],
  ['cat_30_59', 'Number 30-59', '#0ea5e9'],
  ['cat_60_99', 'Number 60-99', '#8b5cf6'],
  ['cat_100_149', 'Number 100-149', '#1d4ed8'],
  ['cat_150_200', 'Number 150-200', '#166534'],
  ['cat_open', 'Open Price', '#f97316'],
] as const;

const deletedDefaultCategorySettingKey = 'deletedDefaultCategoryIds';
const productNumericAscSortSettingKey = 'productNumericAscSortV1';
// One-time repair: products/categories created with a millisecond Date.now()
// sortOrder overflow PostgreSQL INT4 and fail the sync push. Clamp them back
// into range (preserving order) and re-push.
const sortOrderInt4FixSettingKey = 'sortOrderInt4FixV1';

function parseDeletedDefaultCategoryIds(value?: string) {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function categoryForPrice(price: number) {
  if (price <= 29) return 'cat_1_29';
  if (price <= 59) return 'cat_30_59';
  if (price <= 99) return 'cat_60_99';
  if (price <= 149) return 'cat_100_149';
  return 'cat_150_200';
}

function shouldKeepProductInEndingCategory(product: Product) {
  return product.categoryId === 'cat_end5' && product.price >= 5 && product.price <= 500 && product.price % 5 === 0;
}

function compareProductsAsc(a: Product, b: Product) {
  if (a.isOpenPrice !== b.isOpenPrice) return a.isOpenPrice ? 1 : -1;
  const priceCompare = a.price - b.price;
  if (priceCompare !== 0) return priceCompare;
  const nameCompare = a.name.localeCompare(b.name, ['th', 'en'], { numeric: true, sensitivity: 'base' });
  if (nameCompare !== 0) return nameCompare;
  return a.id.localeCompare(b.id);
}

function createNumberProduct(price: number, category: Category, timestamp: string, idPrefix: string, sortOffset = 0): Product {
  return {
    id: `${idPrefix}_${price}`,
    name: `${price} บาท`,
    displayName: `${price}`,
    price,
    categoryId: category.id,
    color: category.color,
    sortOrder: sortOffset + price,
    isActive: true,
    isOpenPrice: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function seedDatabase() {
  const timestamp = nowIso();
  const users: User[] = [
    {
      id: 'user_admin',
      username: 'admin',
      displayName: 'ผู้ดูแลระบบ',
      passwordHash: await sha256('admin'),
      passwordPlain: 'admin',
      pin: '000000',
      role: 'Admin',
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];

  const categories: Category[] = categorySeeds.map(([id, name, color], index) => ({
    id,
    name,
    color,
    sortOrder: index,
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));

  const products: Product[] = [
    {
      id: 'prod_open',
      name: 'OPEN PRICE',
      displayName: 'Open Price',
      price: 0,
      categoryId: 'cat_open',
      color: '#f97316',
      sortOrder: 0,
      isActive: true,
      isOpenPrice: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];

  const endingWith5 = categories.find((item) => item.id === 'cat_end5')!;
  for (let price = 5; price <= 500; price += 10) {
    products.push(createNumberProduct(price, endingWith5, timestamp, 'prod_end5'));
  }
  for (let price = 10; price <= 500; price += 10) {
    products.push(createNumberProduct(price, endingWith5, timestamp, 'prod_end0', 500));
  }

  const ranges = [
    ['cat_1_29', 1, 29, 1000],
    ['cat_30_59', 30, 59, 2000],
    ['cat_60_99', 60, 99, 3000],
    ['cat_100_149', 100, 149, 4000],
    ['cat_150_200', 150, 200, 5000],
  ] as const;

  for (const [categoryId, start, end, sortOffset] of ranges) {
    const category = categories.find((item) => item.id === categoryId)!;
    for (let price = start; price <= end; price += 1) {
      products.push(createNumberProduct(price, category, timestamp, `prod_${categoryId.replace('cat_', '')}`, sortOffset));
    }
  }

  const settings: AppSetting[] = [
    ['storeName', 'Cal POS Store'],
    ['branchName', 'สาขาหลัก'],
    ['taxId', ''],
    ['receiptFooter', 'ขอบคุณที่ใช้บริการ'],
    ['currencySymbol', '฿'],
    ['billNumberResetRule', 'daily'],
    ['productButtonSize', 'medium'],
    ['productButtonDisplayFontSize', 'medium'],
    ['productButtonNameFontSize', 'medium'],
    ['productButtonPriceFontSize', 'medium'],
    ['productButtonDisplayFontPx', '30'],
    ['productButtonNameFontPx', '14'],
    ['productButtonPriceFontPx', '14'],
    ['autoCloseReceiptEnabled', 'false'],
    ['autoCloseReceiptSeconds', '5'],
    ['allowSalePriceEdit', 'false'],
    ['printerSettings', JSON.stringify(defaultPrinterSettings)],
  ].map(([key, value]) => ({ key, value, updatedAt: timestamp }));

  // Track products whose names were fixed so we can enqueue them to SyncQueue after
  // the transaction (SyncQueueRepository writes to db.sync_queue which is not in this transaction).
  const nameFixedProductIds: string[] = [];
  // Records whose oversized (ms-timestamp) sortOrder was clamped — re-pushed
  // after the transaction so the corrected value reaches the cloud.
  const sortFixedProductIds: string[] = [];
  const sortFixedCategoryIds: string[] = [];

  await db.transaction('rw', [db.users, db.categories, db.products, db.settings, db.activity_logs], async () => {
    const deletedDefaultCategoryIds = parseDeletedDefaultCategoryIds((await db.settings.get(deletedDefaultCategorySettingKey))?.value);
    await db.categories.delete('cat_custom');
    await db.products.where('categoryId').equals('cat_custom').delete();
    if (!deletedDefaultCategoryIds.includes('cat_custom')) {
      await db.settings.put({ key: deletedDefaultCategorySettingKey, value: JSON.stringify([...deletedDefaultCategoryIds, 'cat_custom']), updatedAt: timestamp });
    }
    const existingAdmin = await db.users.where('username').equals('admin').first();
    if (!existingAdmin) await db.users.add(users[0]);

    for (const category of categories) {
      if (!deletedDefaultCategoryIds.includes(category.id) && !(await db.categories.get(category.id))) await db.categories.add(category);
    }
    for (const product of products) {
      const sameProduct = product.isOpenPrice
        ? await db.products.where('isOpenPrice').equals(1).first()
        : (await db.products.where('categoryId').equals(product.categoryId).toArray()).find((item) => item.price === product.price && !item.isOpenPrice);
      if (!sameProduct && !(await db.products.get(product.id))) await db.products.add(product);
    }
    const existingProducts = await db.products.toArray();
    for (const product of existingProducts) {
      const fixedName = product.name.replace(/\bbaht\b/gi, 'บาท').replace(/\bbath\b/gi, 'บาท');
      const fixedDisplayName = (product.displayName || '').trim() || fixedName;
      const normalizedProduct = normalizeProductNameFields({ ...product, name: fixedName, displayName: fixedDisplayName });
      if (normalizedProduct.name !== product.name || normalizedProduct.displayName !== product.displayName) {
        await db.products.update(product.id, { name: normalizedProduct.name, displayName: normalizedProduct.displayName, updatedAt: timestamp });
        nameFixedProductIds.push(product.id);
      }
    }
    if (!(await db.settings.get(productNumericAscSortSettingKey))) {
      const productsToSort = await db.products.toArray();
      const categoriesToSort = await db.categories.orderBy('sortOrder').toArray();
      const categoryById = new Map(categoriesToSort.map((category) => [category.id, category]));
      for (const product of productsToSort) {
        if (product.isOpenPrice || shouldKeepProductInEndingCategory(product)) continue;
        const expectedCategoryId = categoryForPrice(product.price);
        if (product.categoryId !== expectedCategoryId) {
          const expectedCategory = categoryById.get(expectedCategoryId);
          await db.products.update(product.id, {
            categoryId: expectedCategoryId,
            color: expectedCategory?.color ?? product.color,
            updatedAt: timestamp,
          });
          product.categoryId = expectedCategoryId;
          product.color = expectedCategory?.color ?? product.color;
        }
      }
      for (const category of categoriesToSort) {
        const categoryProducts = productsToSort
          .filter((product) => product.categoryId === category.id)
          .sort(compareProductsAsc);
        const categoryOffset = (category.sortOrder + 1) * 100000;
        await Promise.all(categoryProducts.map((product, index) => db.products.update(product.id, { sortOrder: categoryOffset + index + 1, updatedAt: timestamp })));
      }
      await db.settings.put({ key: productNumericAscSortSettingKey, value: 'true', updatedAt: timestamp });
    }
    // One-time INT4 sortOrder repair. Products/categories created with a
    // millisecond Date.now() sortOrder (~1.7e12) overflow the server's INT4
    // column and fail every sync push. Divide by 1000 to fit INT4 while
    // keeping their relative order, then re-push (enqueue below).
    if (!(await db.settings.get(sortOrderInt4FixSettingKey))) {
      for (const product of await db.products.toArray()) {
        if (product.sortOrder > INT4_MAX) {
          await db.products.update(product.id, { sortOrder: clampSortOrder(product.sortOrder), updatedAt: timestamp });
          sortFixedProductIds.push(product.id);
        }
      }
      for (const category of await db.categories.toArray()) {
        if (category.sortOrder > INT4_MAX) {
          await db.categories.update(category.id, { sortOrder: clampSortOrder(category.sortOrder), updatedAt: timestamp });
          sortFixedCategoryIds.push(category.id);
        }
      }
      await db.settings.put({ key: sortOrderInt4FixSettingKey, value: 'true', updatedAt: timestamp });
    }
    for (const setting of settings) {
      if (!(await db.settings.get(setting.key))) await db.settings.add(setting);
    }
    if ((await db.activity_logs.where('entityId').equals('initial').count()) === 0) {
      await db.activity_logs.add({
        id: uid('log'),
        userId: 'system',
        action: 'seed',
        entityType: 'database',
        entityId: 'initial',
        detail: 'สร้างข้อมูลเริ่มต้น',
        createdAt: timestamp,
      });
    }
  });

  // Enqueue name-fixed products to SyncQueue so the corrected names propagate to cloud.
  // This runs outside the transaction because SyncQueueRepository writes to db.sync_queue
  // which was not included in the transaction above.
  if (nameFixedProductIds.length > 0) {
    const fixedProducts = await db.products.bulkGet(nameFixedProductIds);
    for (const product of fixedProducts) {
      if (product) {
        await SyncQueueRepository.enqueue({ tableName: 'products', recordId: product.id, action: 'upsert', payload: product });
      }
    }
  }

  // Re-push records whose oversized sortOrder was clamped, so the previously
  // failing INT4 push now succeeds with the corrected value.
  if (sortFixedCategoryIds.length > 0) {
    const fixedCategories = await db.categories.bulkGet(sortFixedCategoryIds);
    for (const category of fixedCategories) {
      if (category) {
        await SyncQueueRepository.enqueue({ tableName: 'categories', recordId: category.id, action: 'upsert', payload: category });
      }
    }
  }
  if (sortFixedProductIds.length > 0) {
    const fixedProducts = await db.products.bulkGet(sortFixedProductIds);
    for (const product of fixedProducts) {
      if (product) {
        await SyncQueueRepository.enqueue({ tableName: 'products', recordId: product.id, action: 'upsert', payload: product });
      }
    }
  }
}
