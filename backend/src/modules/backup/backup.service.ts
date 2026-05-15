import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';

type BackupData = Awaited<ReturnType<typeof buildBackupData>>;

// ---- Storage helpers ----

function hasSupabase() {
  return Boolean(env.supabaseUrl && env.supabaseServiceKey);
}

function supabase() {
  return createClient(env.supabaseUrl, env.supabaseServiceKey);
}

function backupRoot() {
  return path.resolve(process.cwd(), env.backupStorageDir);
}

function isSupabasePath(storageUrl: string) {
  return !storageUrl.startsWith('/') && !storageUrl.match(/^[A-Za-z]:\\/);
}

async function writeBackup(storagePath: string, content: string) {
  if (hasSupabase()) {
    const { error } = await supabase().storage
      .from('backups')
      .upload(storagePath, Buffer.from(content, 'utf8'), { contentType: 'application/json', upsert: false });
    if (error) throw new Error(`Supabase upload failed: ${error.message}`);
    return;
  }
  const dir = path.dirname(storagePath);
  await mkdir(dir, { recursive: true });
  await writeFile(storagePath, content, 'utf8');
}

async function readBackup(storageUrl: string): Promise<string> {
  if (isSupabasePath(storageUrl)) {
    const { data, error } = await supabase().storage.from('backups').download(storageUrl);
    if (error || !data) throw new Error(`Supabase download failed: ${error?.message}`);
    return data.text();
  }
  const resolvedPath = await realpath(storageUrl);
  const allowedDir = await realpath(backupRoot());
  if (!resolvedPath.startsWith(allowedDir + path.sep)) throw new Error('Invalid backup path');
  return readFile(resolvedPath, 'utf8');
}

async function deleteBackupFile(storageUrl: string) {
  if (isSupabasePath(storageUrl)) {
    await supabase().storage.from('backups').remove([storageUrl]);
    return;
  }
  await rm(storageUrl, { force: true });
}

// ---- Data builder ----

function toJsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    if (typeof item === 'bigint') return item.toString();
    return item;
  })) as T;
}

export async function buildBackupData(shopId: string) {
  const [shop, users, categories, products, sales, saleItems, payments, discounts, activityLogs, settings, parkedBills] = await Promise.all([
    prisma.shop.findUnique({ where: { id: shopId } }),
    prisma.user.findMany({
      where: { shopId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, shopId: true, username: true, displayName: true,
        role: true, isActive: true, createdAt: true, updatedAt: true,
      },
    }),
    prisma.category.findMany({ where: { shopId }, orderBy: { sortOrder: 'asc' } }),
    prisma.product.findMany({ where: { shopId }, orderBy: { sortOrder: 'asc' } }),
    prisma.sale.findMany({ where: { shopId }, orderBy: { createdAt: 'asc' } }),
    prisma.saleItem.findMany({ where: { sale: { shopId } }, orderBy: { createdAt: 'asc' } }),
    prisma.payment.findMany({ where: { sale: { shopId } }, orderBy: { createdAt: 'asc' } }),
    prisma.discountLog.findMany({ where: { sale: { shopId } }, orderBy: { createdAt: 'asc' } }),
    prisma.activityLog.findMany({ where: { shopId }, orderBy: { createdAt: 'asc' } }),
    prisma.appSetting.findMany({ where: { shopId } }),
    prisma.parkedBill.findMany({ where: { shopId }, orderBy: { createdAt: 'asc' } }),
  ]);

  return toJsonSafe({
    version: 1,
    exportedAt: new Date().toISOString(),
    shop,
    users,
    categories,
    products,
    sales,
    sale_items: saleItems,
    payments,
    discount_logs: discounts,
    activity_logs: activityLogs,
    settings,
    parked_bills: parkedBills,
  });
}

// ---- CRUD ----

export async function createBackupSnapshot(shopId: string, createdBy: string) {
  if (env.isProd && !hasSupabase()) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set to use server-side backups in production.');
  }

  const data = await buildBackupData(shopId);
  const fileName = `calpos-backup-${shopId}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const storagePath = hasSupabase()
    ? `${shopId}/${fileName}`
    : path.join(backupRoot(), shopId, fileName);
  const content = JSON.stringify(data, null, 2);

  await writeBackup(storagePath, content);

  return prisma.backupSnapshot.create({
    data: {
      shopId,
      fileName,
      storageUrl: storagePath,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      createdBy,
    },
  });
}

export async function listBackupSnapshots(shopId: string) {
  return prisma.backupSnapshot.findMany({
    where: { shopId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function deleteBackupSnapshot(shopId: string, id: string) {
  const snapshot = await prisma.backupSnapshot.findFirst({ where: { id, shopId } });
  if (!snapshot) return null;

  await deleteBackupFile(snapshot.storageUrl);
  await prisma.backupSnapshot.delete({ where: { id } });
  return snapshot;
}

function dateValue(value: unknown) {
  return value ? new Date(String(value)) : undefined;
}

export async function restoreBackupSnapshot(shopId: string, id: string) {
  const snapshot = await prisma.backupSnapshot.findFirst({ where: { id, shopId } });
  if (!snapshot) return null;

  const raw = await readBackup(snapshot.storageUrl);
  const data = JSON.parse(raw) as BackupData;

  await prisma.$transaction(async (tx) => {
    await tx.discountLog.deleteMany({ where: { sale: { shopId } } });
    await tx.payment.deleteMany({ where: { sale: { shopId } } });
    await tx.saleItem.deleteMany({ where: { sale: { shopId } } });
    await tx.sale.deleteMany({ where: { shopId } });
    await tx.product.deleteMany({ where: { shopId } });
    await tx.category.deleteMany({ where: { shopId } });
    await tx.activityLog.deleteMany({ where: { shopId } });
    await tx.appSetting.deleteMany({ where: { shopId } });
    await tx.parkedBill.deleteMany({ where: { shopId } });
    await tx.user.deleteMany({ where: { shopId } });

    await tx.shop.upsert({
      where: { id: shopId },
      update: { name: data.shop?.name ?? 'Restored Shop' },
      create: { id: shopId, name: data.shop?.name ?? 'Restored Shop' },
    });

    for (const user of data.users ?? []) {
      await tx.user.create({
        data: {
          id: user.id,
          shopId,
          username: user.username,
          displayName: user.displayName,
          pin: '000000',
          passwordHash: '',
          role: user.role,
          isActive: user.isActive,
          createdAt: dateValue(user.createdAt),
          updatedAt: dateValue(user.updatedAt),
        },
      });
    }

    for (const category of data.categories ?? []) {
      await tx.category.create({
        data: {
          id: category.id,
          shopId,
          name: category.name,
          color: category.color,
          icon: category.icon,
          sortOrder: category.sortOrder,
          isActive: category.isActive,
          createdAt: dateValue(category.createdAt),
          updatedAt: dateValue(category.updatedAt),
        },
      });
    }

    for (const product of data.products ?? []) {
      await tx.product.create({
        data: {
          id: product.id,
          shopId,
          categoryId: product.categoryId,
          name: product.name,
          displayName: product.displayName,
          price: product.price,
          color: product.color,
          sortOrder: product.sortOrder,
          isActive: product.isActive,
          isOpenPrice: product.isOpenPrice,
          createdAt: dateValue(product.createdAt),
          updatedAt: dateValue(product.updatedAt),
        },
      });
    }

    for (const sale of data.sales ?? []) {
      await tx.sale.create({
        data: {
          id: sale.id,
          shopId,
          billNo: sale.billNo,
          cashierId: sale.cashierId,
          cashierName: sale.cashierName,
          subtotal: sale.subtotal,
          discountAmount: sale.discountAmount,
          discountPercent: sale.discountPercent,
          total: sale.total,
          status: sale.status,
          voidReason: sale.voidReason,
          voidedByUserId: sale.voidedByUserId,
          createdAt: dateValue(sale.createdAt),
          updatedAt: dateValue(sale.updatedAt),
        },
      });
    }

    for (const item of data.sale_items ?? []) await tx.saleItem.create({ data: { ...item, createdAt: dateValue(item.createdAt) } });
    for (const payment of data.payments ?? []) await tx.payment.create({ data: { ...payment, createdAt: dateValue(payment.createdAt) } });
    for (const discount of data.discount_logs ?? []) await tx.discountLog.create({ data: { ...discount, createdAt: dateValue(discount.createdAt) } });

    for (const log of data.activity_logs ?? []) {
      await tx.activityLog.create({ data: { ...log, shopId, createdAt: dateValue(log.createdAt) } });
    }
    for (const setting of data.settings ?? []) {
      await tx.appSetting.create({ data: { ...setting, shopId, updatedAt: dateValue(setting.updatedAt) } });
    }
    for (const bill of data.parked_bills ?? []) {
      await tx.parkedBill.create({ data: { ...bill, shopId, createdAt: dateValue(bill.createdAt), updatedAt: dateValue(bill.updatedAt) } });
    }
  });

  return snapshot;
}

export async function clearAllShopData(shopId: string, actingUserId: string) {
  return prisma.$transaction(async (tx) => {
    const sales = await tx.sale.findMany({ where: { shopId }, select: { id: true } });
    const saleIds = sales.map((s) => s.id);

    await tx.discountLog.deleteMany({ where: { saleId: { in: saleIds } } });
    await tx.payment.deleteMany({ where: { saleId: { in: saleIds } } });
    await tx.saleItem.deleteMany({ where: { saleId: { in: saleIds } } });
    const salesDeleted = await tx.sale.deleteMany({ where: { shopId } });

    await tx.parkedBill.deleteMany({ where: { shopId } });
    await tx.syncLog.deleteMany({ where: { shopId } });
    await tx.product.deleteMany({ where: { shopId } });
    await tx.category.deleteMany({ where: { shopId } });

    await tx.activityLog.create({
      data: {
        id: crypto.randomUUID(),
        shopId,
        userId: actingUserId,
        action: 'CLEAR_ALL_DATA',
        entityType: 'shop',
        entityId: shopId,
        detail: `ล้างข้อมูลทั้งหมด: ${salesDeleted.count} บิล + สินค้า/หมวดหมู่/parked bills/sync logs`,
      },
    });

    return { salesDeleted: salesDeleted.count };
  });
}

export function toBackupDto(snapshot: {
  id: string;
  fileName: string;
  storageUrl: string;
  sizeBytes: number;
  createdBy: string;
  createdAt: Date;
}) {
  return {
    id: snapshot.id,
    fileName: snapshot.fileName,
    storageUrl: snapshot.storageUrl,
    sizeBytes: snapshot.sizeBytes,
    createdBy: snapshot.createdBy,
    createdAt: snapshot.createdAt.toISOString(),
  };
}
