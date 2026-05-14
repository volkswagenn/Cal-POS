import * as XLSX from 'xlsx';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/permission.js';
import {
  buildPreview,
  exportHeaders,
  getDailyReport,
  getEmployeeReport,
  getPaymentReport,
  getProductReport,
  getSummaryReport,
  reportFileName,
  rowsForExport,
} from './reports.service.js';

function csvEscape(value: string | number) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers: string[], rows: Array<Array<string | number>>) {
  const body = [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
  return `\uFEFF${body}`;
}

const dateRangeSchema = z.object({
  from: z.string().min(10),
  to: z.string().min(10),
});

export async function reportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/daily', async (request) => {
    const query = z.object({ date: z.string().min(10) }).parse(request.query);
    return getDailyReport(request.user.shopId, query.date);
  });

  app.get('/summary', async (request) => {
    const query = dateRangeSchema.parse(request.query);
    return getSummaryReport(request.user.shopId, query.from, query.to);
  });

  app.get('/products', async (request) => {
    const query = dateRangeSchema.extend({
      limit: z.coerce.number().int().positive().optional(),
    }).parse(request.query);
    return { products: await getProductReport(request.user.shopId, query.from, query.to, query.limit) };
  });

  app.get('/payments', async (request) => {
    const query = dateRangeSchema.parse(request.query);
    return { payments: await getPaymentReport(request.user.shopId, query.from, query.to) };
  });

  app.get('/employees', async (request) => {
    const query = dateRangeSchema.parse(request.query);
    return { employees: await getEmployeeReport(request.user.shopId, query.from, query.to) };
  });

  app.get('/preview', async (request) => {
    const query = dateRangeSchema.extend({
      reportType: z.string().default('payment_income'),
      exportMode: z.string().default('single_row'),
    }).parse(request.query);

    return {
      rows: await buildPreview(request.user.shopId, query.reportType, query.from, query.to, query.exportMode),
    };
  });

  app.get('/export', { preHandler: requireRole(['admin']) }, async (request, reply) => {
    const query = dateRangeSchema.extend({
      reportType: z.string().default('payment_income'),
      exportMode: z.string().default('single_row'),
      format: z.enum(['csv', 'xlsx']).default('csv'),
    }).parse(request.query);
    const rows = await buildPreview(request.user.shopId, query.reportType, query.from, query.to, query.exportMode);
    const headers = exportHeaders(query.reportType);
    const exportRows = rowsForExport(query.reportType, rows);
    const fileName = reportFileName(query.reportType, query.from, query.to, query.format);

    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);

    if (query.format === 'xlsx') {
      const worksheet = XLSX.utils.aoa_to_sheet([headers, ...exportRows]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .send(buffer);
    }

    return reply
      .header('Content-Type', 'text/csv;charset=utf-8')
      .send(toCsv(headers, exportRows));
  });
}
