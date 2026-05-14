export type PermissionKey =
  | 'dashboard'
  | 'pos'
  | 'bill_history'
  | 'send_report'
  | 'import_data'
  | 'products'
  | 'users'
  | 'settings'
  | 'backup'
  | 'void_bill'
  | 'refund_bill'
  | 'edit_sale_price'
  | 'unlock_mirror';

export type PositionConfig = {
  name: string;
  permissions: PermissionKey[];
};

export const positionSettingKey = 'userPositions';

export const permissionOptions: Array<{ key: PermissionKey; label: string }> = [
  { key: 'dashboard', label: 'แดชบอร์ด' },
  { key: 'pos', label: 'ขายสินค้า' },
  { key: 'bill_history', label: 'ประวัติบิล' },
  { key: 'send_report', label: 'ส่งรายงาน' },
  { key: 'import_data', label: 'นำเข้าข้อมูล' },
  { key: 'products', label: 'สินค้า/หมวดหมู่' },
  { key: 'users', label: 'ผู้ใช้' },
  { key: 'settings', label: 'ตั้งค่า' },
  { key: 'backup', label: 'สำรองข้อมูล' },
  { key: 'void_bill', label: 'Void bill' },
  { key: 'refund_bill', label: 'Refund bill' },
  { key: 'edit_sale_price', label: 'แก้ไขราคาหน้าขาย' },
  { key: 'unlock_mirror', label: 'ปลด Mirror POS' },
];

export const defaultPositions: PositionConfig[] = [
  { name: 'Admin', permissions: permissionOptions.map((p) => p.key) },
  { name: 'Manager', permissions: ['dashboard', 'pos', 'bill_history', 'products', 'void_bill', 'edit_sale_price'] },
  { name: 'Cashier', permissions: ['pos', 'bill_history'] },
];

export function parsePositions(value?: string | null): PositionConfig[] {
  try {
    const parsed = value ? JSON.parse(value) : null;
    if (!Array.isArray(parsed)) return defaultPositions;
    const valid = parsed
      .filter((item) => item && typeof item.name === 'string')
      .map((item) => ({
        name: item.name,
        permissions: Array.isArray(item.permissions)
          ? item.permissions.filter((permission: unknown): permission is PermissionKey => permissionOptions.some((option) => option.key === permission))
          : [],
      }));
    return valid.length ? valid : defaultPositions;
  } catch {
    return defaultPositions;
  }
}

export function permissionsForRole(role: string | undefined, positions: PositionConfig[]) {
  if (!role) return [];
  return positions.find((position) => position.name === role)?.permissions ?? [];
}

export function hasPermission(role: string | undefined, positions: PositionConfig[], permission: PermissionKey) {
  return permissionsForRole(role, positions).includes(permission);
}
