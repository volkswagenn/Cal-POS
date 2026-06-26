import { apiRequest } from './client';
import type { SaleDetail } from '../../types';

const DEVICE_ID_KEY = 'calpos_device_id';

function getDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const next = crypto.randomUUID ? crypto.randomUUID() : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(DEVICE_ID_KEY, next);
  return next;
}

export type SubPosLinkRecord = {
  id: string;
  subDeviceCode: string;
  subDeviceId: string;
  mainDeviceCode: string;
  mainDeviceId: string;
  status: string;
  allowPrint: boolean;
  allowDrawer: boolean;
  createdAt: string;
};

export const subposApi = {
  async requestLink(mainDeviceCode: string): Promise<{ linkId: string }> {
    return apiRequest<{ linkId: string }>('/api/subpos/link-request', {
      method: 'POST',
      body: JSON.stringify({ subDeviceId: getDeviceId(), mainDeviceCode }),
    });
  },

  async approveLink(linkId: string): Promise<void> {
    await apiRequest('/api/subpos/link-approve', {
      method: 'POST',
      body: JSON.stringify({ linkId, mainDeviceId: getDeviceId() }),
    });
  },

  async rejectLink(linkId: string): Promise<void> {
    await apiRequest('/api/subpos/link-reject', {
      method: 'POST',
      body: JSON.stringify({ linkId, mainDeviceId: getDeviceId() }),
    });
  },

  async revokeLink(id: string): Promise<void> {
    await apiRequest(`/api/subpos/link/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ mainDeviceId: getDeviceId() }),
    });
  },

  async getLinks(): Promise<SubPosLinkRecord[]> {
    const res = await apiRequest<{ links: SubPosLinkRecord[] }>(
      `/api/subpos/links?mainDeviceId=${encodeURIComponent(getDeviceId())}`,
    );
    return res.links;
  },

  async sendCommand(action: 'print_receipt' | 'open_drawer', payload: { detail: SaleDetail }): Promise<void> {
    const commandId = crypto.randomUUID ? crypto.randomUUID() : `cmd-${Date.now()}`;
    await apiRequest('/api/subpos/command', {
      method: 'POST',
      body: JSON.stringify({ subDeviceId: getDeviceId(), commandId, action, payload }),
    });
  },

  async sendCommandResult(commandId: string, linkId: string, success: boolean, error?: string): Promise<void> {
    await apiRequest('/api/subpos/command-result', {
      method: 'POST',
      body: JSON.stringify({ mainDeviceId: getDeviceId(), commandId, linkId, success, error }),
    });
  },
};
