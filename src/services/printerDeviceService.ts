import { Capacitor } from '@capacitor/core';
import { CalPosPrinterBridge } from '../plugins/calPosPrinterBridge';
import type { PrinterConnectionType, PrinterSettings } from '../types';

export type PrinterDeviceType = Extract<PrinterConnectionType, 'usb' | 'bluetooth'>;

export interface PrinterDeviceCandidate {
  id: string;
  name: string;
  meta: string;
  type: PrinterDeviceType;
  vendorId?: string;
  productId?: string;
  bluetoothAddress?: string;
  deviceName?: string;
  deviceClass?: number;
  interfaceSummary?: string;
  hasPermission?: boolean;
  likelyPrinter?: boolean;
}

function isSecureBrowserContext() {
  return window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

async function scanBrowserUsb(): Promise<PrinterDeviceCandidate[]> {
  const usb = (navigator as Navigator & {
    usb?: {
      requestDevice: (options: { filters: Array<Record<string, unknown>> }) => Promise<{
        productName?: string;
        manufacturerName?: string;
        vendorId: number;
        productId: number;
      }>;
    };
  }).usb;
  if (!usb || !isSecureBrowserContext()) {
    throw new Error('Browser นี้ยังไม่รองรับ WebUSB ให้ใช้ Chrome/Edge บน HTTPS หรือ localhost');
  }

  const device = await usb.requestDevice({ filters: [] });
  const vendorId = device.vendorId.toString(16).padStart(4, '0');
  const productId = device.productId.toString(16).padStart(4, '0');
  const name = device.productName || device.manufacturerName || `USB ${vendorId}:${productId}`;
  return [{
    id: `${vendorId}:${productId}`,
    name,
    meta: `Vendor ${vendorId} / Product ${productId}`,
    type: 'usb',
    vendorId,
    productId,
  }];
}

async function scanBrowserBluetooth(): Promise<PrinterDeviceCandidate[]> {
  const bluetooth = (navigator as Navigator & {
    bluetooth?: {
      requestDevice: (options: { acceptAllDevices: boolean; optionalServices?: string[] }) => Promise<{ id: string; name?: string }>;
    };
  }).bluetooth;
  if (!bluetooth || !isSecureBrowserContext()) {
    throw new Error('Browser นี้ยังไม่รองรับ Web Bluetooth หรือเครื่องพิมพ์เป็น Bluetooth Classic');
  }

  const device = await bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: ['battery_service'] });
  const name = device.name || 'Bluetooth printer';
  return [{
    id: device.id,
    name,
    meta: device.id,
    type: 'bluetooth',
    bluetoothAddress: device.id,
  }];
}

async function scanAndroidDevice(type: PrinterDeviceType): Promise<PrinterDeviceCandidate[]> {
  const result = await CalPosPrinterBridge.scanPrinters({ type });
  return result.devices;
}

async function authorizeAndroidUsbDevice(device: PrinterDeviceCandidate): Promise<PrinterDeviceCandidate> {
  if (Capacitor.getPlatform() !== 'android' || device.type !== 'usb') return device;
  if (device.hasPermission) return device;
  if (!device.vendorId || !device.productId) throw new Error('ข้อมูล Vendor/Product ของ USB ไม่ครบ');
  const result = await CalPosPrinterBridge.requestUsbPermission({
    vendorId: device.vendorId,
    productId: device.productId,
    deviceName: device.deviceName,
  });
  return { ...device, hasPermission: result.granted };
}

/**
 * Re-acquire Android USB permission for the already-saved printer.
 *
 * Android does NOT keep the permission granted by UsbManager.requestPermission()
 * across a reboot or a printer unplug/replug. After the device is power-cycled the
 * app has the printer in its settings but no live permission, so printing fails with
 * "ไม่สามารถเปิด USB ได้". Call this on app launch / resume: if the saved printer is
 * plugged in but lacks permission, ask for it again. When the user previously checked
 * "เปิด Cal POS ทุกครั้งเมื่อเชื่อมต่อ" (use by default for this device) Android re-grants
 * silently, giving real auto-reconnect; otherwise the user confirms once.
 *
 * Returns:
 *   'granted'      – permission is now available (device usable)
 *   'no-device'    – the saved printer is not currently attached
 *   'denied'       – device present but user/Android refused permission
 *   'not-usb'      – not an Android USB printer, nothing to do
 */
export type UsbPermissionOutcome = 'granted' | 'no-device' | 'denied' | 'not-usb';

// Dedupe concurrent permission requests. The live-status hook is mounted in more than
// one place (AppLayout + SettingsPage), so without this guard a single resume could fire
// two requestPermission() calls and stack two Android permission dialogs.
let usbPermissionInFlight: Promise<UsbPermissionOutcome> | null = null;

function ensureAndroidUsbPermission(settings: PrinterSettings): Promise<UsbPermissionOutcome> {
  if (usbPermissionInFlight) return usbPermissionInFlight;
  usbPermissionInFlight = ensureAndroidUsbPermissionInner(settings).finally(() => {
    usbPermissionInFlight = null;
  });
  return usbPermissionInFlight;
}

async function ensureAndroidUsbPermissionInner(settings: PrinterSettings): Promise<UsbPermissionOutcome> {
  if (Capacitor.getPlatform() !== 'android') return 'not-usb';
  if (!settings.enabled || settings.connectionType !== 'usb') return 'not-usb';

  const vid = settings.usbVendorId?.trim().toLowerCase() ?? '';
  const pid = settings.usbProductId?.trim().toLowerCase() ?? '';
  if (!vid && !pid) return 'not-usb';

  const { devices } = await CalPosPrinterBridge.scanPrinters({ type: 'usb' });
  const device = devices.find(
    (d) => (vid && d.vendorId?.toLowerCase() === vid) || (pid && d.productId?.toLowerCase() === pid),
  );
  if (!device) return 'no-device';
  if (device.hasPermission) return 'granted';

  const result = await CalPosPrinterBridge.requestUsbPermission({
    vendorId: device.vendorId ?? settings.usbVendorId,
    productId: device.productId ?? settings.usbProductId,
    deviceName: device.deviceName ?? settings.usbDeviceName,
  });
  return result.granted ? 'granted' : 'denied';
}

export const PrinterDeviceService = {
  platform() {
    return Capacitor.getPlatform();
  },

  ensureUsbPermission(settings: PrinterSettings) {
    return ensureAndroidUsbPermission(settings);
  },

  async scan(type: PrinterConnectionType) {
    if (type === 'lan') {
      return {
        devices: [] as PrinterDeviceCandidate[],
        message: 'เครื่องพิมพ์ LAN ต้องกรอก IP และ Port เอง เพราะ Browser และ Android ไม่สามารถสแกน network printer แบบ RAW 9100 ได้เสถียร',
      };
    }

    if (Capacitor.getPlatform() === 'android') {
      return { devices: await scanAndroidDevice(type), message: '' };
    }

    if (type === 'usb') return { devices: await scanBrowserUsb(), message: '' };
    return { devices: await scanBrowserBluetooth(), message: '' };
  },

  async authorize(device: PrinterDeviceCandidate) {
    return authorizeAndroidUsbDevice(device);
  },
};
