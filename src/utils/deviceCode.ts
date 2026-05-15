const DEVICE_CODE_KEY = 'calpos_device_code';
const DEVICE_ID_KEY = 'calpos_device_id';

export const DEVICE_CODE_MAX_LEN = 6;

/**
 * Normalize a user-entered device code: uppercase A–Z 0–9 only (no '-', since
 * billNo is '-' delimited), capped length. Returns '' if nothing usable.
 */
export function sanitizeDeviceCode(input: string) {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, DEVICE_CODE_MAX_LEN);
}

/**
 * Stable short code identifying this device on bills (e.g. "POS1").
 * User-set value wins; otherwise derived once from the device id.
 */
export function getDeviceCode() {
  const existing = localStorage.getItem(DEVICE_CODE_KEY);
  if (existing) return existing;

  const deviceId =
    localStorage.getItem(DEVICE_ID_KEY) ||
    (crypto.randomUUID ? crypto.randomUUID() : `device-${Date.now()}`);
  const hex = deviceId.replace(/[^a-f0-9]/gi, '').slice(0, 4).toUpperCase().padEnd(4, '0');
  localStorage.setItem(DEVICE_CODE_KEY, hex);
  return hex;
}

/**
 * Persist a user-chosen device code. Falls back to the auto code if the
 * sanitized input is empty. Returns the value actually stored.
 */
export function setDeviceCode(input: string) {
  const clean = sanitizeDeviceCode(input);
  if (!clean) {
    localStorage.removeItem(DEVICE_CODE_KEY);
    return getDeviceCode();
  }
  localStorage.setItem(DEVICE_CODE_KEY, clean);
  return clean;
}
