const DEVICE_CODE_KEY = 'calpos_device_code';
const DEVICE_ID_KEY = 'calpos_device_id';
const DEVICE_PIN_KEY = 'calpos_device_pin';

export const DEVICE_CODE_MAX_LEN = 6;

/**
 * Permanent 4-digit numeric code for this device. Generated once, never changes.
 * Used as the SubPOS identifier — what other devices type to connect.
 */
export function getDevicePermanentCode(): string {
  const existing = localStorage.getItem(DEVICE_PIN_KEY);
  if (existing) return existing;
  const pin = String(Math.floor(1000 + Math.random() * 9000));
  localStorage.setItem(DEVICE_PIN_KEY, pin);
  return pin;
}

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
 * Display code for this device on bills and the notification feed.
 * User-set value wins; falls back to the permanent 4-digit code.
 */
export function getDeviceCode() {
  return localStorage.getItem(DEVICE_CODE_KEY) || getDevicePermanentCode();
}

/**
 * Persist a user-chosen device code. Falls back to the permanent code if the
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
