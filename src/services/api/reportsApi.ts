import type { ExportMode, ExternalReportType } from '../../types';
import type { PreviewRow } from '../../db/repositories/ExternalReportRepository';
import { apiBlobRequest, apiRequest } from './client';

export interface DailyReportResponse {
  summary: {
    totalSales: number;
    billCount: number;
    averageBill: number;
    totalDiscount: number;
    totalVoid: number;
    totalRefund: number;
  };
  hourly: Array<{ hour: string; total: number; bills: number }>;
  products: Array<{ productName: string; quantity: number; revenue: number }>;
  payments: { cash: number; transfer: number; qr: number; credit: number };
  employees: Array<{ cashierName: string; total: number; bills: number; average: number }>;
}

function rangeQuery(from: string, to: string) {
  return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

export const reportsApi = {
  daily(date: string) {
    return apiRequest<DailyReportResponse>(`/api/reports/daily?date=${encodeURIComponent(date)}`);
  },

  summary(from: string, to: string) {
    return apiRequest<DailyReportResponse['summary']>(`/api/reports/summary?${rangeQuery(from, to)}`);
  },

  products(from: string, to: string, limit?: number) {
    return apiRequest<{ products: Array<{ productName: string; quantity: number; revenue: number }> }>(
      `/api/reports/products?${rangeQuery(from, to)}${limit ? `&limit=${limit}` : ''}`,
    );
  },

  payments(from: string, to: string) {
    return apiRequest<{ payments: DailyReportResponse['payments'] }>(`/api/reports/payments?${rangeQuery(from, to)}`);
  },

  employees(from: string, to: string) {
    return apiRequest<{ employees: DailyReportResponse['employees'] }>(`/api/reports/employees?${rangeQuery(from, to)}`);
  },

  preview(reportType: ExternalReportType, from: string, to: string, exportMode: ExportMode) {
    return apiRequest<{ rows: PreviewRow[] }>(
      `/api/reports/preview?reportType=${encodeURIComponent(reportType)}&${rangeQuery(from, to)}&exportMode=${encodeURIComponent(exportMode)}`,
    );
  },

  export(reportType: ExternalReportType, from: string, to: string, exportMode: ExportMode, format: 'csv' | 'xlsx') {
    return apiBlobRequest(
      `/api/reports/export?reportType=${encodeURIComponent(reportType)}&${rangeQuery(from, to)}&exportMode=${encodeURIComponent(exportMode)}&format=${format}`,
    );
  },
};
