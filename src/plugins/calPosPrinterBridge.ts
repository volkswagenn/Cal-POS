import { registerPlugin } from '@capacitor/core';
import type { PrinterDeviceType } from '../services/printerDeviceService';

export interface NativePrinterDevice {
  id: string;
  name: string;
  meta: string;
  type: PrinterDeviceType;
  vendorId?: string;
  productId?: string;
  deviceName?: string;
  deviceClass?: number;
  interfaceSummary?: string;
  hasPermission?: boolean;
  likelyPrinter?: boolean;
}

export interface UsbPermissionResult {
  granted: boolean;
}

export interface UsbPrintOptions {
  vendorId: string;
  productId: string;
  deviceName?: string;
  text: string;
  charset?: string;
  codePage?: number;
  cut?: boolean;
  feedLines?: number;
}

export interface UsbRasterPrintOptions {
  vendorId: string;
  productId: string;
  deviceName?: string;
  text: string;
  paperWidthDots?: number;
  textSizePx?: number;
  cut?: boolean;
  feedLines?: number;
}

export interface UsbDrawerOptions {
  vendorId: string;
  productId: string;
  deviceName?: string;
  pin?: 2 | 5;
  pulseOnMs?: number;
  pulseOffMs?: number;
}

export interface LanPrintOptions {
  host: string;
  port: number;
  text: string;
  charset?: string;
  codePage?: number;
  cut?: boolean;
  feedLines?: number;
}

export interface LanRasterPrintOptions {
  host: string;
  port: number;
  text: string;
  paperWidthDots?: number;
  textSizePx?: number;
  cut?: boolean;
  feedLines?: number;
}

export interface LanDrawerOptions {
  host: string;
  port: number;
  pin?: 2 | 5;
  pulseOnMs?: number;
  pulseOffMs?: number;
}

export interface CalPosPrinterBridgePlugin {
  scanPrinters(options: { type: PrinterDeviceType }): Promise<{ devices: NativePrinterDevice[] }>;
  requestUsbPermission(options: { vendorId: string; productId: string; deviceName?: string }): Promise<UsbPermissionResult>;
  printUsbText(options: UsbPrintOptions): Promise<{ printed: boolean; bytesWritten: number }>;
  printUsbRasterText(options: UsbRasterPrintOptions): Promise<{ printed: boolean; bytesWritten: number }>;
  openUsbDrawer(options: UsbDrawerOptions): Promise<{ opened: boolean; bytesWritten: number }>;
  printLanText(options: LanPrintOptions): Promise<{ printed: boolean; bytesWritten: number }>;
  printLanRasterText(options: LanRasterPrintOptions): Promise<{ printed: boolean; bytesWritten: number }>;
  openLanDrawer(options: LanDrawerOptions): Promise<{ opened: boolean; bytesWritten: number }>;
}

export const CalPosPrinterBridge = registerPlugin<CalPosPrinterBridgePlugin>('CalPosPrinterBridge');
