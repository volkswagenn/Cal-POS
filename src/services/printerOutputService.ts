import { Capacitor } from '@capacitor/core';
import type { PrinterSettings, SaleDetail } from '../types';
import { PrinterRepository } from '../db/repositories/PrinterRepository';
import { CalPosPrinterBridge } from '../plugins/calPosPrinterBridge';
import { formatReceiptText } from './receiptTextFormatter';
import { getReceiptContentSettings, getReceiptRenderConfig } from './receiptLayoutService';
import { isMirrorModeActive } from '../stores/mirrorStore';

function assertUsbReady(settings: PrinterSettings) {
  if (!settings.enabled) throw new Error('ยังไม่ได้เปิดใช้งานเครื่องพิมพ์');
  if (settings.connectionType !== 'usb') throw new Error('การพิมพ์ตรงบน Android ตอนนี้รองรับ USB ก่อน');
  if (!settings.usbVendorId || !settings.usbProductId) throw new Error('ยังไม่ได้เลือกเครื่องพิมพ์ USB');
}

function assertLanReady(settings: PrinterSettings) {
  if (!settings.enabled) throw new Error('ยังไม่ได้เปิดใช้งานเครื่องพิมพ์');
  if (settings.connectionType !== 'lan') throw new Error('ไม่ได้ตั้งค่าเป็น LAN');
  if (!settings.ipAddress.trim()) throw new Error('ยังไม่ได้ระบุ IP Address ของเครื่องพิมพ์');
}

function lanPort(settings: PrinterSettings): number {
  const n = parseInt(settings.port?.trim() || '9100', 10);
  return Number.isFinite(n) && n > 0 ? n : 9100;
}

async function printUsbRasterText(settings: PrinterSettings, text: string, cut = settings.autoCut) {
  assertUsbReady(settings);
  const renderConfig = getReceiptRenderConfig(settings);
  return CalPosPrinterBridge.printUsbRasterText({
    vendorId: settings.usbVendorId,
    productId: settings.usbProductId,
    deviceName: settings.usbDeviceName,
    text,
    paperWidthDots: renderConfig.paperWidthDots,
    textSizePx: renderConfig.fontSizePx,
    cut,
    feedLines: 4,
  });
}

async function printLanRasterText(settings: PrinterSettings, text: string, cut = settings.autoCut) {
  assertLanReady(settings);
  const renderConfig = getReceiptRenderConfig(settings);
  return CalPosPrinterBridge.printLanRasterText({
    host: settings.ipAddress.trim(),
    port: lanPort(settings),
    text,
    paperWidthDots: renderConfig.paperWidthDots,
    textSizePx: renderConfig.fontSizePx,
    cut,
    feedLines: 4,
  });
}

async function printNative(settings: PrinterSettings, text: string, cut = settings.autoCut) {
  if (settings.connectionType === 'usb') return printUsbRasterText(settings, text, cut);
  if (settings.connectionType === 'lan') return printLanRasterText(settings, text, cut);
  throw new Error(`ยังไม่รองรับการพิมพ์ผ่าน ${settings.connectionType} บน Android`);
}

export const PrinterOutputService = {
  async printTest(inputSettings?: PrinterSettings) {
    const settings = inputSettings ?? await PrinterRepository.getSettings();
    if (Capacitor.getPlatform() === 'android') {
      await printNative(settings, '\n\n          Cal POS\n\n      PRINT TEST\n      ทดสอบพิมพ์ภาษาไทย\n\n', settings.autoCut);
      return 'native';
    }
    return 'browser';
  },

  async printReceipt(detail: SaleDetail) {
    const settings = await PrinterRepository.getSettings();
    if (Capacitor.getPlatform() === 'android') {
      const [renderConfig, contentSettings] = [getReceiptRenderConfig(settings), await getReceiptContentSettings()] as const;
      const text = formatReceiptText(detail, renderConfig.charsPerLine, contentSettings, { hideSensitiveInfo: isMirrorModeActive() });
      await printNative(settings, text, settings.autoCut);
      return 'native';
    }
    return 'browser';
  },

  async printText(text: string, inputSettings?: PrinterSettings) {
    const settings = inputSettings ?? await PrinterRepository.getSettings();
    if (Capacitor.getPlatform() === 'android') {
      await printNative(settings, text, settings.autoCut);
      return 'native';
    }
    return 'browser';
  },

  async printReceiptCalibration(inputSettings?: PrinterSettings) {
    const settings = inputSettings ?? await PrinterRepository.getSettings();
    const renderConfig = getReceiptRenderConfig(settings);
    const width = Math.min(46, Math.max(30, Number(renderConfig.charsPerLine) || 42));
    const ruler = Array.from({ length: width }, (_, index) => String((index + 1) % 10)).join('');
    const text = [
      'RECEIPT CALIBRATION',
      `${renderConfig.paperSize} / ${renderConfig.paperWidthDots} dots / ${width} chars`,
      '-'.repeat(width),
      ruler,
      '-'.repeat(width),
      'If right edge is cut:',
      '1) reduce printable dots',
      '2) reduce chars per line',
      '',
    ].join('\n');
    if (Capacitor.getPlatform() === 'android') {
      await printNative(settings, text, settings.autoCut);
      return 'native';
    }
    return 'browser';
  },
};
