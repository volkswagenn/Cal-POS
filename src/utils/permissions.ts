export type PermissionKey =
  | 'dashboard'
  | 'pos'
  | 'bill_history'
  | 'send_report'
  | 'import_data'
  | 'products'
  | 'users'
  | 'unblock_user'
  | 'settings'
  | 'backup'
  | 'reset_data'
  | 'void_bill'
  | 'refund_bill'
  | 'edit_sale_price'
  | 'apply_discount'
  | 'unlock_mirror';

export type PositionConfig = {
  name: string;
  permissions: PermissionKey[];
};

export type PermissionLeaf = { key: PermissionKey; label: string };

export type PermissionNode = PermissionLeaf & {
  children?: PermissionLeaf[];
};

// Hierarchical permission tree — menu = parent, tab-actions = children
// Checking a parent auto-checks all children; unchecking parent removes all children too.
// Children are only effective when their parent menu is also granted.
export const PERMISSION_TREE: PermissionNode[] = [
  { key: 'dashboard', label: 'แดชบอร์ด' },
  {
    key: 'pos',
    label: 'ขายสินค้า',
    children: [
      { key: 'edit_sale_price', label: 'แก้ไขราคาหน้าขาย' },
      { key: 'apply_discount', label: 'อนุญาติให้ใช้ส่วนลดรายการ/ส่วนลดท้ายบิล' },
    ],
  },
  {
    key: 'bill_history',
    label: 'ประวัติบิล',
    children: [
      { key: 'void_bill', label: 'Void bill' },
      { key: 'refund_bill', label: 'Refund bill' },
    ],
  },
  { key: 'send_report', label: 'ส่งรายงาน' },
  { key: 'import_data', label: 'นำเข้าข้อมูล' },
  { key: 'products', label: 'สินค้า/หมวดหมู่' },
  {
    key: 'users',
    label: 'ผู้ใช้',
    children: [
      { key: 'unblock_user', label: 'บล็อก/ปลดล็อก Login ผู้ใช้' },
    ],
  },
  { key: 'settings', label: 'ตั้งค่า' },
  {
    key: 'backup',
    label: 'จัดการข้อมูล',
    children: [
      { key: 'reset_data', label: 'รีเซ็ตข้อมูล' },
    ],
  },
  { key: 'unlock_mirror', label: 'ปลด Mirror POS' },
];

// Flat list derived from tree — used for validation in parsePositions
export const permissionOptions: PermissionLeaf[] = PERMISSION_TREE.flatMap((node) => [
  { key: node.key, label: node.label },
  ...(node.children ?? []),
]);

const allPermissionKeys = permissionOptions.map((p) => p.key);

export const positionSettingKey = 'userPositions';

export const defaultPositions: PositionConfig[] = [
  { name: 'Admin', permissions: allPermissionKeys },
  {
    name: 'Manager',
    permissions: ['dashboard', 'pos', 'edit_sale_price', 'apply_discount', 'bill_history', 'void_bill', 'products'],
  },
  { name: 'Cashier', permissions: ['pos', 'bill_history'] },
];

export function parsePositions(value?: string | null): PositionConfig[] {
  try {
    const parsed = value ? JSON.parse(value) : null;
    if (!Array.isArray(parsed)) return defaultPositions;
    const valid = parsed
      .filter((item) => item && typeof item.name === 'string')
      .map((item) => {
        const name = item.name;
        const permissions = Array.isArray(item.permissions)
          ? item.permissions.filter((permission: unknown): permission is PermissionKey =>
              permissionOptions.some((option) => option.key === permission),
            )
          : [];
        if (Array.isArray(item.permissions)
          && (item.permissions.includes('apply_item_discount') || item.permissions.includes('apply_bill_discount'))
          && !permissions.includes('apply_discount')) {
          permissions.push('apply_discount');
        }

        return {
          name,
          permissions: name === 'Admin' ? allPermissionKeys : permissions,
        };
      });
    return valid.length ? valid : defaultPositions;
  } catch {
    return defaultPositions;
  }
}

export function permissionsForRole(role: string | undefined, positions: PositionConfig[]) {
  if (!role) return [];
  if (role === 'Admin') return allPermissionKeys;
  return positions.find((position) => position.name === role)?.permissions ?? [];
}

export function hasPermission(role: string | undefined, positions: PositionConfig[], permission: PermissionKey) {
  return permissionsForRole(role, positions).includes(permission);
}
