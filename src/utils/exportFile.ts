import * as XLSX from 'xlsx';
import { toCsv } from './csv';

export function downloadBlob(blob: Blob, fileName: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function downloadCsv(headers: string[], rows: Array<Array<string | number>>, fileName: string) {
  downloadBlob(new Blob([toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' }), fileName);
}

export function downloadXlsx(headers: string[], rows: Array<Array<string | number>>, sheetName: string, fileName: string) {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  worksheet['!cols'] = headers.map((header, index) => ({ wch: Math.max(String(header).length + 4, ...rows.map((row) => String(row[index] ?? '').length + 2)) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, fileName);
}

export async function updateReportFile(content: string, fileName: string) {
  const picker = (window as unknown as { showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  if (!picker) {
    downloadBlob(new Blob([content], { type: 'text/csv;charset=utf-8' }), fileName);
    return 'downloaded';
  }
  const handle = await picker({
    suggestedName: fileName,
    types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }],
  });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
  return 'updated';
}
