import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { PrinterRepository } from '../db/repositories/PrinterRepository';
import { CalPosPrinterBridge } from '../plugins/calPosPrinterBridge';
import type { PrinterSettings, PrinterStatus } from '../types';

const POLL_MS = 15_000;
const LAN_TIMEOUT_MS = 3_000;

async function probeLan(settings: PrinterSettings): Promise<PrinterStatus> {
  const ip = settings.ipAddress.trim();
  if (!ip) return 'disconnected';
  const port = settings.port?.trim() || '9100';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LAN_TIMEOUT_MS);
  try {
    await fetch(`http://${ip}:${port}/`, { mode: 'no-cors', signal: controller.signal });
    clearTimeout(timer);
    return 'connected';
  } catch (error) {
    clearTimeout(timer);
    // AbortError = our timeout fired = TCP connection was open (printer up, no HTTP response)
    if (error instanceof DOMException && error.name === 'AbortError') return 'connected';
    return 'disconnected';
  }
}

async function probeUsb(settings: PrinterSettings): Promise<PrinterStatus> {
  if (!settings.usbVendorId.trim() && !settings.usbProductId.trim()) return 'disconnected';

  if (Capacitor.getPlatform() === 'android') {
    try {
      const result = await CalPosPrinterBridge.scanPrinters({ type: 'usb' });
      const vid = settings.usbVendorId.toLowerCase();
      const pid = settings.usbProductId.toLowerCase();
      return result.devices.some(
        (d) => (vid && d.vendorId?.toLowerCase() === vid) || (pid && d.productId?.toLowerCase() === pid),
      ) ? 'connected' : 'disconnected';
    } catch {
      return 'disconnected';
    }
  }

  const usbNav = (navigator as Navigator & {
    usb?: { getDevices(): Promise<Array<{ vendorId: number; productId: number }>> };
  }).usb;
  if (usbNav?.getDevices) {
    try {
      const devices = await usbNav.getDevices();
      const vid = settings.usbVendorId ? parseInt(settings.usbVendorId, 16) : NaN;
      const pid = settings.usbProductId ? parseInt(settings.usbProductId, 16) : NaN;
      return devices.some(
        (d) => (Number.isFinite(vid) && d.vendorId === vid) || (Number.isFinite(pid) && d.productId === pid),
      ) ? 'connected' : 'disconnected';
    } catch {
      return 'disconnected';
    }
  }

  return settings.usbVendorId.trim() || settings.usbProductId.trim() ? 'connected' : 'disconnected';
}

async function checkLiveStatus(settings: PrinterSettings): Promise<PrinterStatus> {
  if (!settings.enabled) return 'not_configured';
  if (settings.connectionType === 'lan') return probeLan(settings);
  if (settings.connectionType === 'usb') return probeUsb(settings);
  if (settings.connectionType === 'bluetooth') {
    return settings.bluetoothAddress.trim() ? 'connected' : 'disconnected';
  }
  return 'disconnected';
}

export function usePrinterLiveStatus(): PrinterStatus {
  const [status, setStatus] = useState<PrinterStatus>('not_configured');

  useEffect(() => {
    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const check = async () => {
      if (cancelled) return;
      try {
        const settings = await PrinterRepository.getSettings();
        if (cancelled) return;
        const live = await checkLiveStatus(settings);
        if (cancelled) return;
        setStatus(live);
        window.dispatchEvent(new CustomEvent('calpos:printer-status-changed', { detail: { status: live } }));
      } catch {
        // ignore probe errors — keep last known status
      } finally {
        if (!cancelled) timerId = setTimeout(check, POLL_MS);
      }
    };

    const onSettingsUpdated = () => {
      if (timerId) clearTimeout(timerId);
      timerId = null;
      void check();
    };

    void check();
    window.addEventListener('calpos:printer-settings-updated', onSettingsUpdated);

    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
      window.removeEventListener('calpos:printer-settings-updated', onSettingsUpdated);
    };
  }, []);

  return status;
}
