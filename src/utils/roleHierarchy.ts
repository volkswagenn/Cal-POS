import type { PositionConfig, PermissionKey } from './permissions';

export const ROLE_HIERARCHY_KEY = 'roleHierarchy';

// hierarchy = string[] เรียงจากระดับต่ำสุด (index 0) → สูงสุด (index สุดท้าย)
// Admin ไม่อยู่ใน array — rank = Infinity เสมอ
export function parseHierarchy(value?: string | null): string[] {
  try {
    const parsed = value ? JSON.parse(value) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item !== 'Admin');
  } catch {
    return [];
  }
}

// Admin = Infinity, ไม่อยู่ใน hierarchy = 0, อยู่ใน hierarchy = index + 1
export function getRoleRank(role: string | undefined, hierarchy: string[]): number {
  if (!role) return 0;
  if (role === 'Admin') return Infinity;
  const index = hierarchy.indexOf(role);
  return index === -1 ? 0 : index + 1;
}

// Inclusive: actor.rank >= target.rank → จัดการได้
// ถ้า hierarchy ยังไม่ตั้งค่า (empty) → เฉพาะ Admin เท่านั้น
export function canManageRole(
  actorRole: string | undefined,
  targetRole: string | undefined,
  hierarchy: string[],
): boolean {
  if (!actorRole || !targetRole) return false;
  if (actorRole === 'Admin') return true;
  if (targetRole === 'Admin') return false;
  if (hierarchy.length === 0) return false;
  const actorRank = getRoleRank(actorRole, hierarchy);
  const targetRank = getRoleRank(targetRole, hierarchy);
  if (actorRank === 0) return false;
  return actorRank >= targetRank;
}

export type HierarchyConflict = {
  lowerRole: string;
  higherRole: string;
  extraPermissions: PermissionKey[];
};

// ตรวจหา role ที่ rank ต่ำกว่า แต่มี permission มากกว่า role rank สูงกว่า
export function detectHierarchyConflicts(
  hierarchy: string[],
  positions: PositionConfig[],
): HierarchyConflict[] {
  const conflicts: HierarchyConflict[] = [];
  for (let i = 0; i < hierarchy.length; i++) {
    for (let j = i + 1; j < hierarchy.length; j++) {
      const lowerRole = hierarchy[i];
      const higherRole = hierarchy[j];
      const lowerPos = positions.find((p) => p.name === lowerRole);
      const higherPos = positions.find((p) => p.name === higherRole);
      if (!lowerPos || !higherPos) continue;
      const extra = lowerPos.permissions.filter(
        (p) => !higherPos.permissions.includes(p),
      ) as PermissionKey[];
      if (extra.length > 0) {
        conflicts.push({ lowerRole, higherRole, extraPermissions: extra });
      }
    }
  }
  return conflicts;
}

// sync hierarchy กับ positions ที่มีอยู่:
// - ลบ role ที่ถูก delete ออก
// - เพิ่ม role ใหม่ที่ index 0 (rank ต่ำสุด)
// - ครั้งแรก (ยังไม่มี hierarchy) → reverse เพื่อให้ position ที่นิยาม
//   ก่อน (senior กว่า) ได้ rank สูงกว่า ตามธรรมเนียม [Admin, Manager, Cashier]
export function syncHierarchyWithPositions(
  hierarchy: string[],
  positionNames: string[],
): string[] {
  const nonAdmin = positionNames.filter((p) => p !== 'Admin');
  const kept = hierarchy.filter((r) => nonAdmin.includes(r));
  const added = nonAdmin.filter((p) => !kept.includes(p));
  if (kept.length === 0) {
    return [...added].reverse();
  }
  return [...added, ...kept];
}
