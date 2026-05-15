import { apiBlobRequest, apiRequest } from './client';

export interface CloudBackup {
  id: string;
  fileName: string;
  storageUrl: string;
  sizeBytes: number;
  createdBy: string;
  createdAt: string;
}

export const backupApi = {
  download() {
    return apiBlobRequest('/api/backup/download');
  },

  create() {
    return apiRequest<{ backup: CloudBackup }>('/api/backup/export', { method: 'POST' });
  },

  list() {
    return apiRequest<{ backups: CloudBackup[] }>('/api/backup/list');
  },

  restore(id: string) {
    return apiRequest<{ ok: true; backup: CloudBackup }>(`/api/backup/restore/${id}`, { method: 'POST' });
  },

  delete(id: string) {
    return apiRequest<{ ok: true }>(`/api/backup/${id}`, { method: 'DELETE' });
  },

  clearSalesHistory(adminPin: string) {
    return apiRequest<{ ok: true; deletedCount: number }>('/api/sales/history', {
      method: 'DELETE',
      body: JSON.stringify({ adminPin }),
    });
  },

  clearAllData(adminPin: string) {
    return apiRequest<{ ok: true; salesDeleted: number }>('/api/backup/data', {
      method: 'DELETE',
      body: JSON.stringify({ adminPin }),
    });
  },
};
