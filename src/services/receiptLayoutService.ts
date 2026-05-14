import type { CSSProperties } from 'react';
import type { PrinterSettings } from '../types';
import { SettingsRepository } from '../db/repositories/SettingsRepository';
import type { ReceiptContentSettings } from './receiptTextFormatter';
import { defaultReceiptContentSettings } from './receiptTextFormatter';

export interface ReceiptRenderConfig {
  paperSize: '58mm' | '80mm';
  paperWidthDots: number;
  charsPerLine: string;
  fontSizePx: number;
  lineHeightPx: number;
  horizontalPaddingPx: number;
  verticalPaddingPx: number;
}

export const RECEIPT_SETTINGS_UPDATED_EVENT = 'calpos:receipt-settings-updated';

export function notifyReceiptSettingsUpdated() {
  window.dispatchEvent(new CustomEvent(RECEIPT_SETTINGS_UPDATED_EVENT));
}

function readNumber(value: string | undefined, fallback: number, min: number, max: number) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, numberValue));
}

export function getReceiptRenderConfig(settings: PrinterSettings): ReceiptRenderConfig {
  const paperSize = settings.paperSize === '58mm' ? '58mm' : '80mm';
  const paperWidthDots = paperSize === '58mm'
    ? readNumber(settings.receiptWidthDots58, 384, 320, 420)
    : readNumber(settings.receiptWidthDots80, 560, 480, 576);
  const fontSizePx = paperSize === '58mm'
    ? readNumber(settings.receiptFontSizePx58, 24, 18, 42)
    : readNumber(settings.receiptFontSizePx80, 28, 18, 42);
  return {
    paperSize,
    paperWidthDots,
    charsPerLine: paperSize === '58mm' ? settings.receiptCharsPerLine58 : settings.receiptCharsPerLine80,
    fontSizePx,
    lineHeightPx: Math.ceil(fontSizePx * 1.35),
    horizontalPaddingPx: Math.max(8, Math.floor(paperWidthDots / 48)),
    verticalPaddingPx: 12,
  };
}

export async function getReceiptContentSettings(): Promise<ReceiptContentSettings> {
  const [storeName, branchName, taxId, receiptFooter, currencySymbol] = await Promise.all([
    SettingsRepository.getSetting('storeName', defaultReceiptContentSettings.storeName),
    SettingsRepository.getSetting('branchName', defaultReceiptContentSettings.branchName),
    SettingsRepository.getSetting('taxId', defaultReceiptContentSettings.taxId),
    SettingsRepository.getSetting('receiptFooter', defaultReceiptContentSettings.receiptFooter),
    SettingsRepository.getSetting('currencySymbol', defaultReceiptContentSettings.currencySymbol),
  ]);
  return { storeName, branchName, taxId, receiptFooter, currencySymbol };
}

export function getReceiptPreviewStyle(config: ReceiptRenderConfig, scale = 0.5): CSSProperties {
  return {
    width: `${config.paperWidthDots}px`,
    padding: `${config.verticalPaddingPx}px ${config.horizontalPaddingPx}px`,
    fontFamily: '"Noto Sans Thai", "Courier New", monospace',
    fontSize: `${config.fontSizePx}px`,
    lineHeight: `${config.lineHeightPx}px`,
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
  };
}

export function getReceiptPreviewShellStyle(config: ReceiptRenderConfig, scale = 0.5): CSSProperties {
  return {
    width: `${config.paperWidthDots * scale}px`,
  };
}
