import type { SaleDetail } from '../../types';
import { apiRequest } from './client';

export const salesApi = {
  pushSale(detail: SaleDetail) {
    return apiRequest<{ ok: true }>('/api/sales', {
      method: 'POST',
      body: JSON.stringify(detail),
    });
  },

  listSales(filters: { from?: string; to?: string; status?: string } = {}) {
    const params = new URLSearchParams();
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.status) params.set('status', filters.status);
    const query = params.toString();
    return apiRequest<{ sales: SaleDetail['sale'][] }>(`/api/sales${query ? `?${query}` : ''}`);
  },

  getSale(id: string) {
    return apiRequest<SaleDetail>(`/api/sales/${id}`);
  },
};
