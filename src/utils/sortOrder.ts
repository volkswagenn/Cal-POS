// PostgreSQL INT4 (32-bit signed) max. The server stores Product.sortOrder
// and Category.sortOrder as `Int`, so a value larger than this fails the
// sync push with: "Unable to fit integer value ... into an INT4".
export const INT4_MAX = 2_147_483_647;

/**
 * Default sortOrder for newly created records. Date.now() in milliseconds
 * (~1.7e12) overflows INT4; seconds precision (~1.7e9) stays valid until
 * ~2038 and is still monotonically increasing for ordering.
 */
export function defaultSortOrder(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Bring any oversized value back into INT4 range while preserving relative
 * order. Legacy records created with a millisecond Date.now() sortOrder are
 * divided by 1000 (→ seconds), so their ordering relative to each other and
 * to new seconds-based values is unchanged.
 */
export function clampSortOrder(value: number): number {
  if (!Number.isFinite(value)) return defaultSortOrder();
  return value > INT4_MAX ? Math.floor(value / 1000) : value;
}
