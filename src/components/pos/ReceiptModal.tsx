import { useEffect, useState } from 'react';
import type { SaleDetail } from '../../types';
import { SettingsRepository } from '../../db/repositories/SettingsRepository';
import { PrinterRepository } from '../../db/repositories/PrinterRepository';
import { PrinterOutputService } from '../../services/printerOutputService';
import { formatReceiptText } from '../../services/receiptTextFormatter';
import {
  getReceiptContentSettings,
  getReceiptPreviewShellStyle,
  getReceiptPreviewStyle,
  getReceiptRenderConfig,
  RECEIPT_SETTINGS_UPDATED_EVENT,
  type ReceiptRenderConfig,
} from '../../services/receiptLayoutService';
import { money } from '../../utils/money';
import { Modal } from '../common/Modal';
import { useToast } from '../common/Toast';
import { isMirrorModeActive } from '../../stores/mirrorStore';

export function ReceiptModal({ detail, onClose }: { detail: SaleDetail; onClose: () => void }) {
  const change = detail.payments.reduce((sum, payment) => sum + payment.changeAmount, 0);
  const [autoCloseSettingEnabled, setAutoCloseSettingEnabled] = useState(false);
  const [autoCloseThisBill, setAutoCloseThisBill] = useState(false);
  const [configuredSeconds, setConfiguredSeconds] = useState(5);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [receiptText, setReceiptText] = useState('');
  const [renderConfig, setRenderConfig] = useState<ReceiptRenderConfig | null>(null);
  const [printingMode, setPrintingMode] = useState<'receipt' | 'a4' | 'pdf' | null>(null);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    const loadAutoClose = async () => {
      const enabled = (await SettingsRepository.getSetting('autoCloseReceiptEnabled', 'false')) === 'true';
      const seconds = Math.max(1, Number(await SettingsRepository.getSetting('autoCloseReceiptSeconds', '5')) || 5);
      if (!cancelled && enabled) {
        setAutoCloseSettingEnabled(true);
        setAutoCloseThisBill(true);
        setConfiguredSeconds(seconds);
        setSecondsLeft(seconds);
      }
    };
    loadAutoClose();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadReceiptPreview = async () => {
      const [printerSettings, contentSettings] = await Promise.all([
        PrinterRepository.getSettings(),
        getReceiptContentSettings(),
      ]);
      const nextConfig = getReceiptRenderConfig(printerSettings);
      if (cancelled) return;
      setRenderConfig(nextConfig);
      setReceiptText(formatReceiptText(detail, nextConfig.charsPerLine, contentSettings, { hideSensitiveInfo: isMirrorModeActive() }));
    };
    const onReceiptSettingsUpdated = () => {
      void loadReceiptPreview();
    };
    loadReceiptPreview();
    window.addEventListener(RECEIPT_SETTINGS_UPDATED_EVENT, onReceiptSettingsUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(RECEIPT_SETTINGS_UPDATED_EVENT, onReceiptSettingsUpdated);
    };
  }, [detail]);

  useEffect(() => {
    if (!autoCloseSettingEnabled || !autoCloseThisBill || secondsLeft === null) return;
    if (secondsLeft <= 0) {
      onClose();
      return;
    }
    const timer = window.setTimeout(() => setSecondsLeft((value) => (value === null ? null : value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [autoCloseSettingEnabled, autoCloseThisBill, onClose, secondsLeft]);

  const toggleAutoCloseThisBill = (enabled: boolean) => {
    setAutoCloseThisBill(enabled);
    setSecondsLeft(enabled ? configuredSeconds : null);
  };

  const browserPrintDocument = (mode: 'receipt' | 'a4' | 'pdf') => {
    document.body.dataset.printMode = mode;
    const cleanup = () => {
      delete document.body.dataset.printMode;
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.setTimeout(() => {
      window.print();
      window.setTimeout(cleanup, 800);
    }, 50);
  };

  const printDocument = async (mode: 'receipt' | 'a4' | 'pdf') => {
    if (printingMode) return;
    setPrintingMode(mode);
    try {
      if (mode === 'receipt') {
        try {
          const result = await PrinterOutputService.printReceipt(detail);
          if (result === 'native') {
            toast('ส่งพิมพ์ใบเสร็จแล้ว', 'success');
            return;
          }
        } catch (error) {
          toast(error instanceof Error ? error.message : 'พิมพ์ใบเสร็จไม่สำเร็จ', 'error');
          return;
        }
      }
      browserPrintDocument(mode);
    } finally {
      window.setTimeout(() => setPrintingMode(null), 1200);
    }
  };

  return (
    <Modal
      title="บันทึกการขายสำเร็จ"
      onClose={onClose}
      wide
      panelClassName="flex max-h-[92vh] flex-col overflow-hidden"
      bodyClassName="flex min-h-0 flex-1 flex-col p-0"
    >
      <div className="border-b border-emerald-100 bg-emerald-50 px-5 py-4 text-center no-print">
        <div className="text-sm font-black text-emerald-700">เงินทอน</div>
        <div className="text-5xl font-black leading-tight text-emerald-800">{money(change)}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="print-receipt mx-auto bg-white print:max-w-none" style={renderConfig ? getReceiptPreviewShellStyle(renderConfig, 0.5) : undefined}>
          {renderConfig && (
            <pre className="whitespace-pre-wrap bg-white text-black shadow-sm" style={getReceiptPreviewStyle(renderConfig, 0.5)}>
              {receiptText}
            </pre>
          )}
        </div>
      </div>
      <div className="border-t border-slate-200 bg-white p-4 no-print">
        {autoCloseSettingEnabled && (
          <label className="mb-3 flex items-center justify-center gap-2 rounded-md bg-primary-50 px-3 py-2 text-xs font-bold text-primary-700">
            <input
              type="checkbox"
              className="rounded border-primary-300 text-primary-600 focus:ring-primary-500"
              checked={autoCloseThisBill}
              onChange={(event) => toggleAutoCloseThisBill(event.target.checked)}
            />
            <span>{autoCloseThisBill && secondsLeft !== null ? `ปิดบิลอัตโนมัติใน ${secondsLeft} วินาที` : 'ยกเลิกการปิดอัตโนมัติสำหรับบิลนี้'}</span>
          </label>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button disabled={Boolean(printingMode)} onClick={() => void printDocument('receipt')} className="rounded-md bg-primary-600 py-3 font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300">
            {printingMode === 'receipt' ? 'กำลังพิมพ์...' : 'พิมพ์ใบเสร็จ'}
          </button>
          <button disabled={Boolean(printingMode)} onClick={() => void printDocument('a4')} className="rounded-md bg-slate-100 py-3 font-bold disabled:cursor-not-allowed disabled:opacity-50">พิมพ์ A4</button>
          <button disabled={Boolean(printingMode)} onClick={() => void printDocument('pdf')} className="rounded-md bg-slate-100 py-3 font-bold disabled:cursor-not-allowed disabled:opacity-50">บันทึก PDF</button>
          <button onClick={onClose} className="rounded-md bg-slate-800 py-3 font-bold text-white">ปิด</button>
        </div>
      </div>
    </Modal>
  );
}
