import { useEffect, useState } from 'react';
import { Eye, Printer, RotateCcw, Search, XCircle } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/common/Card';
import { LoadingOverlay } from '../components/common/LoadingOverlay';
import { Modal } from '../components/common/Modal';
import { EmptyState } from '../components/common/EmptyState';
import { SaleRepository } from '../db/repositories/SaleRepository';
import { PrinterRepository } from '../db/repositories/PrinterRepository';
import { PrinterOutputService } from '../services/printerOutputService';
import { formatReceiptText } from '../services/receiptTextFormatter';
import {
  getReceiptContentSettings,
  getReceiptRenderConfig,
  RECEIPT_SETTINGS_UPDATED_EVENT,
  type ReceiptRenderConfig,
} from '../services/receiptLayoutService';
import { ReceiptCanvasPreview } from '../components/pos/ReceiptCanvasPreview';
import { useAsync } from '../hooks/useAsync';
import { formatDateInput, formatDateTime } from '../utils/date';
import { money } from '../utils/money';
import type { SaleDetail } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useToast } from '../components/common/Toast';
import { usePermissions } from '../hooks/usePermissions';

const METHOD_LABEL: Record<string, string> = {
  cash: 'เงินสด',
  transfer: 'โอนเงิน',
  qr: 'QR Code',
  credit: 'บัตรเครดิต',
  mixed: 'หลายช่องทาง',
};

export function BillHistoryPage() {
  const [query, setQuery] = useState('');
  const [date, setDate] = useState(formatDateInput());
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<SaleDetail | null>(null);
  const [billDetailTab, setBillDetailTab] = useState<'items' | 'receipt'>('items');
  const [billReceiptText, setBillReceiptText] = useState('');
  const [billRenderConfig, setBillRenderConfig] = useState<ReceiptRenderConfig | null>(null);
  const [billPrinting, setBillPrinting] = useState(false);
  const user = useAuthStore((state) => state.user)!;
  const toast = useToast();
  const { can } = usePermissions();
  const { data, reload, loading } = useAsync(() => SaleRepository.searchSales({ query, date, status }), [query, date, status]);

  useEffect(() => {
    if (!selected) return;
    setBillDetailTab('items');
    setBillReceiptText('');
    setBillRenderConfig(null);
    let cancelled = false;
    const load = async () => {
      const [printerSettings, contentSettings] = await Promise.all([
        PrinterRepository.getSettings(),
        getReceiptContentSettings(),
      ]);
      if (cancelled) return;
      const config = getReceiptRenderConfig(printerSettings);
      setBillRenderConfig(config);
      setBillReceiptText(formatReceiptText(selected, config.charsPerLine, contentSettings));
    };
    const onReceiptSettingsUpdated = () => {
      void load();
    };
    void load();
    window.addEventListener(RECEIPT_SETTINGS_UPDATED_EVENT, onReceiptSettingsUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(RECEIPT_SETTINGS_UPDATED_EVENT, onReceiptSettingsUpdated);
    };
  }, [selected]);

  const mark = async (kind: 'void' | 'refund') => {
    if (!selected) return;
    if (kind === 'void' && !can('void_bill')) return toast('ตำแหน่งนี้ไม่มีสิทธิ์ Void bill', 'error');
    if (kind === 'refund' && !can('refund_bill')) return toast('ตำแหน่งนี้ไม่มีสิทธิ์ Refund bill', 'error');
    const reason = window.prompt(kind === 'void' ? 'กรุณาระบุเหตุผลการ void' : 'กรุณาระบุเหตุผลการคืนเงิน');
    if (!reason) return;
    if (kind === 'void') await SaleRepository.voidSale(selected.sale.id, reason, user.id);
    else await SaleRepository.refundSale(selected.sale.id, reason, user.id);
    toast('บันทึกสถานะบิลแล้ว', 'success');
    setSelected(null);
    reload();
  };

  const printBill = async () => {
    if (!selected || billPrinting) return;
    setBillPrinting(true);
    try {
      try {
        const result = await PrinterOutputService.printReceipt(selected);
        if (result === 'native') {
          toast('ส่งพิมพ์ใบเสร็จแล้ว', 'success');
          return;
        }
      } catch (error) {
        toast(error instanceof Error ? error.message : 'พิมพ์ใบเสร็จไม่สำเร็จ', 'error');
        return;
      }
      document.body.dataset.printMode = 'receipt';
      const cleanup = () => {
        delete document.body.dataset.printMode;
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);
      window.setTimeout(() => {
        window.print();
        window.setTimeout(cleanup, 800);
      }, 50);
    } finally {
      window.setTimeout(() => setBillPrinting(false), 1200);
    }
  };

  return (
    <div className="relative p-4 md:p-6">
      <LoadingOverlay show={loading && !data} />
      <PageHeader title="ประวัติบิล" subtitle="ค้นหา ตรวจสอบ พิมพ์ซ้ำ void และ refund บิลที่บันทึกไว้" />
      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_180px_180px]">
          <label className="flex items-center gap-2 rounded-md border border-slate-300 px-3"><Search size={18} className="text-slate-400" /><input className="w-full border-0 focus:ring-0" placeholder="ค้นหาเลขบิล" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <input type="date" className="rounded-md border-slate-300" value={date} onChange={(event) => setDate(event.target.value)} />
          <select className="rounded-md border-slate-300" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">ทุกสถานะ</option>
            <option value="completed">สำเร็จ</option>
            <option value="voided">Void</option>
            <option value="refunded">Refund</option>
          </select>
        </div>
      </Card>
      <Card className="overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="p-3">เลขบิล</th><th>เวลา</th><th>แคชเชียร์</th><th>ยอดสุทธิ</th><th>สถานะ</th><th className="text-right p-3">จัดการ</th></tr></thead>
            <tbody>
              {(data ?? []).map((detail) => (
                <tr key={detail.sale.id} className="border-t border-slate-100">
                  <td className="p-3 font-bold">{detail.sale.billNo}</td>
                  <td>{formatDateTime(detail.sale.createdAt)}</td>
                  <td>{detail.sale.cashierName}</td>
                  <td className="font-black">{money(detail.sale.total)}</td>
                  <td><span className={`rounded-full px-2 py-1 text-xs font-bold ${detail.sale.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{detail.sale.status}</span></td>
                  <td className="p-3 text-right"><button className="rounded-md bg-slate-100 p-2" onClick={() => setSelected(detail)} aria-label="ดู"><Eye size={18} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data?.length === 0 && <EmptyState title="ไม่พบบิลตามเงื่อนไข" />}
        </div>
      </Card>

      {selected && (
        <Modal title={`รายละเอียดบิล ${selected.sale.billNo}`} onClose={() => setSelected(null)} wide>
          {(() => {
            const payments = selected.payments;
            const isMultiPayment = payments.length > 1;
            const totalReceived = payments.reduce((sum, p) => sum + p.receivedAmount, 0);
            const totalChange = payments.reduce((sum, p) => sum + p.changeAmount, 0);
            return (
              <div className="grid gap-6 md:grid-cols-2">
                {/* LEFT: tabs */}
                <div>
                  <div className="mb-3 flex border-b border-slate-100">
                    <button
                      className={`px-4 py-2 text-sm font-bold ${billDetailTab === 'items' ? 'border-b-2 border-primary-600 text-primary-700' : 'text-slate-500 hover:text-slate-700'}`}
                      onClick={() => setBillDetailTab('items')}
                    >
                      รายการสินค้า
                    </button>
                    <button
                      className={`px-4 py-2 text-sm font-bold ${billDetailTab === 'receipt' ? 'border-b-2 border-primary-600 text-primary-700' : 'text-slate-500 hover:text-slate-700'}`}
                      onClick={() => setBillDetailTab('receipt')}
                    >
                      รูปแบบใบเสร็จ
                    </button>
                  </div>
                  {billDetailTab === 'items' && (
                    <div>
                      {selected.items.map((item) => (
                        <div key={item.id} className="flex justify-between border-b border-slate-100 py-2 text-sm">
                          <span>{item.productName} x {item.quantity}</span>
                          <b>{money(item.total)}</b>
                        </div>
                      ))}
                    </div>
                  )}
                  {billDetailTab === 'receipt' && (
                    <div className="overflow-auto">
                      {billRenderConfig ? (
                        <div className="print-receipt mx-auto bg-white shadow-sm">
                          <ReceiptCanvasPreview text={billReceiptText} config={billRenderConfig} scale={0.5} />
                        </div>
                      ) : (
                        <div className="py-8 text-center text-sm text-slate-400">กำลังโหลด...</div>
                      )}
                    </div>
                  )}
                </div>

                {/* RIGHT: payment info + summary + actions */}
                <div className="space-y-2">
                  {/* Payment section */}
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
                    <div className="mb-2 flex justify-between text-xs font-bold text-slate-400">
                      <span>ประเภทชำระเงิน</span>
                      <span>จำนวนรับ</span>
                    </div>
                    {isMultiPayment ? (
                      payments.map((p) => (
                        <div key={p.id} className="flex justify-between py-0.5">
                          <span className="font-semibold text-slate-700">{METHOD_LABEL[p.method] ?? p.method}</span>
                          <b>{money(p.receivedAmount)}</b>
                        </div>
                      ))
                    ) : (
                      <div className="flex justify-between py-0.5">
                        <span className="font-semibold text-slate-700">{METHOD_LABEL[payments[0]?.method] ?? '-'}</span>
                        <b>{money(payments[0]?.receivedAmount ?? 0)}</b>
                      </div>
                    )}
                    <div className="mt-2 space-y-1 border-t border-slate-200 pt-2">
                      <div className="flex justify-between">
                        <span className="text-slate-600">รับเงินรวม</span>
                        <b>{money(totalReceived)}</b>
                      </div>
                      <div className="flex justify-between font-bold text-emerald-700">
                        <span>เงินทอน</span>
                        <span>{money(totalChange)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-xs text-slate-400">{formatDateTime(selected.sale.createdAt)}</div>
                  <div className="flex justify-between text-sm"><span className="text-slate-500">พนักงาน</span><b>{selected.sale.cashierName}</b></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-500">ยอดก่อนลด</span><b>{money(selected.sale.subtotal)}</b></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-500">ส่วนลด</span><b>{money(selected.sale.discountAmount)}</b></div>
                  <div className="flex justify-between text-xl font-black">
                    <span>ยอดสุทธิ</span>
                    <span>{money(selected.sale.total)}</span>
                  </div>

                  <div className="pt-2">
                    <button
                      onClick={() => void printBill()}
                      disabled={billPrinting}
                      className="mb-2 flex w-full items-center justify-center gap-2 rounded-md bg-primary-600 py-3 font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      <Printer size={18} /> {billPrinting ? 'กำลังพิมพ์...' : 'พิมพ์ซ้ำ'}
                    </button>
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => void mark('void')} disabled={!can('void_bill')} className="flex items-center justify-center gap-2 rounded-md bg-red-50 py-3 font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-40">
                        <XCircle size={18} /> Void
                      </button>
                      <button onClick={() => void mark('refund')} disabled={!can('refund_bill')} className="flex items-center justify-center gap-2 rounded-md bg-amber-50 py-3 font-bold text-amber-700 disabled:cursor-not-allowed disabled:opacity-40">
                        <RotateCcw size={18} /> Refund
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </Modal>
      )}
    </div>
  );
}
