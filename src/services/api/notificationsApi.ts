import { apiRequest, hasApiBaseUrl } from './client';
import { getDeviceCode } from '../../utils/deviceCode';

const DEVICE_ID_KEY = 'calpos_device_id';

function getDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const next = crypto.randomUUID ? crypto.randomUUID() : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(DEVICE_ID_KEY, next);
  return next;
}

export type ActivityItem = {
  deviceId: string;
  deviceCode: string;
  table: string;
  action: string;
  count: number;
  lastAt: string;
};

export const notificationsApi = {
  /** Tell the server this device's human-readable code ("POS1"). */
  async registerDevice(): Promise<void> {
    if (!hasApiBaseUrl || !navigator.onLine) return;
    try {
      await apiRequest('/api/notifications/device', {
        method: 'POST',
        body: JSON.stringify({ deviceId: getDeviceId(), code: getDeviceCode() }),
      });
    } catch {
      // Non-critical: notification labels just fall back to a short id.
    }
  },

  /** Cross-device activity (this device's own actions excluded server-side). */
  async fetchActivity(since?: string): Promise<ActivityItem[]> {
    if (!hasApiBaseUrl || !navigator.onLine) return [];
    const params = new URLSearchParams({ deviceId: getDeviceId() });
    if (since) params.set('since', since);
    try {
      const res = await apiRequest<{ items: ActivityItem[] }>(
        `/api/notifications/activity?${params.toString()}`,
      );
      return res.items;
    } catch {
      return [];
    }
  },
};
