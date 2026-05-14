import { Capacitor } from '@capacitor/core';
import { db } from '../database';
import type { CashDrawerAction, CashDrawerLog, PrinterSettings, PrinterStatus, User } from '../../types';
import { nowIso } from '../../utils/date';
import { uid } from '../../utils/id';
import { CalPosPrinterBridge } from '../../plugins/calPosPrinterBridge';

export const defaultPrinterSettings: PrinterSettings = {
  enabled: false,
  connectionType: 'usb',
  printerName: '',
  ipAddress: '',
  port: '9100',
  usbVendorId: '',
  usbProductId: '',
  usbDeviceName: '',
  bluetoothAddress: '',
  androidDriver: 'escpos',
  paperSize: '80mm',
  charsPerLine: '48',
  receiptCharsPerLine58: '32',
  receiptCharsPerLine80: '42',
  receiptWidthDots58: '384',
  receiptWidthDots80: '560',
  receiptFontSizePx58: '24',
  receiptFontSizePx80: '28',
  autoPrintReceipt: false,
  autoCut: true,
  cutMode: 'partial',
  drawerEnabled: false,
  drawerKickPin: '2',
  drawerPulseOnMs: '100',
  drawerPulseOffMs: '100',
  openDrawerAfterCashPayment: false,
};

const printerSettingsKey = 'printerSettings';

function readSettings(value?: string): PrinterSettings {
  try {
    return { ...defaultPrinterSettings, ...(value ? JSON.parse(value) : {}) };
  } catch {
    return defaultPrinterSettings;
  }
}

function readPulseMs(value: string, fallback: number) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(2, Math.min(510, Math.round(numberValue)));
}

export const PrinterRepository = {
  async getSettings() {
    return readSettings((await db.settings.get(printerSettingsKey))?.value);
  },

  async setSettings(settings: PrinterSettings) {
    await db.settings.put({ key: printerSettingsKey, value: JSON.stringify(settings), updatedAt: nowIso() });
  },

  getStatus(settings: PrinterSettings): PrinterStatus {
    if (!settings.enabled) return 'not_configured';
    if (settings.connectionType === 'lan') return settings.ipAddress.trim() ? 'connected' : 'disconnected';
    if (settings.connectionType === 'usb') return settings.usbVendorId.trim() || settings.usbProductId.trim() ? 'connected' : 'disconnected';
    if (settings.connectionType === 'bluetooth') return settings.bluetoothAddress.trim() ? 'connected' : 'disconnected';
    return 'disconnected';
  },

  async getDrawerLogs(limit = 30) {
    return db.cash_drawer_logs.orderBy('createdAt').reverse().limit(limit).toArray();
  },

  async openDrawer(input: { user: User; action: CashDrawerAction; amount: number; note: string; settings?: PrinterSettings }) {
    const settings = input.settings ?? await this.getSettings();
    const status = this.getStatus(settings);
    let error: string | undefined;

    const isAndroid = Capacitor.getPlatform() === 'android';
    const isSupported = isAndroid && (settings.connectionType === 'usb' || settings.connectionType === 'lan');

    if (!settings.enabled || !settings.drawerEnabled || status !== 'connected') {
      error = 'ยังไม่ได้ตั้งค่าเครื่องพิมพ์หรือลิ้นชักเก็บเงิน';
    } else if (!isSupported) {
      error = 'ตอนนี้การเปิดลิ้นชักรองรับ USB และ LAN printer บน Android';
    }

    if (!error) {
      const pin = settings.drawerKickPin === '5' ? 5 : 2;
      const pulseOnMs = readPulseMs(settings.drawerPulseOnMs, 100);
      const pulseOffMs = readPulseMs(settings.drawerPulseOffMs, 100);
      try {
        if (settings.connectionType === 'usb') {
          await CalPosPrinterBridge.openUsbDrawer({
            vendorId: settings.usbVendorId,
            productId: settings.usbProductId,
            deviceName: settings.usbDeviceName,
            pin,
            pulseOnMs,
            pulseOffMs,
          });
        } else {
          const port = parseInt(settings.port?.trim() || '9100', 10);
          await CalPosPrinterBridge.openLanDrawer({
            host: settings.ipAddress.trim(),
            port: Number.isFinite(port) && port > 0 ? port : 9100,
            pin,
            pulseOnMs,
            pulseOffMs,
          });
        }
      } catch (nativeError) {
        error = nativeError instanceof Error ? nativeError.message : 'เปิดลิ้นชักไม่สำเร็จ';
      }
    }

    const log: CashDrawerLog = {
      id: uid('drawer'),
      userId: input.user.id,
      userName: input.user.displayName,
      action: input.action,
      amount: input.amount,
      note: input.note,
      printerName: settings.printerName || settings.connectionType,
      status: error ? 'failed' : 'success',
      error,
      createdAt: nowIso(),
    };
    await db.cash_drawer_logs.add(log);
    return log;
  },
};
