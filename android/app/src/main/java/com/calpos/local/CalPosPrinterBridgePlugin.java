package com.calpos.local;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@CapacitorPlugin(name = "CalPosPrinterBridge")
public class CalPosPrinterBridgePlugin extends Plugin {

    private static final String ACTION_USB_PERMISSION = "com.calpos.local.USB_PERMISSION";
    private static final byte[] ESC_INIT = {0x1B, 0x40};
    private static final byte[] ESC_CUT  = {0x1D, 0x56, 0x42, 0x00};

    // ─── scanPrinters ─────────────────────────────────────────────────
    @PluginMethod
    public void scanPrinters(PluginCall call) {
        String type = call.getString("type", "usb");
        if (!"usb".equals(type)) {
            JSObject result = new JSObject();
            result.put("devices", new JSArray());
            call.resolve(result);
            return;
        }
        UsbManager usbManager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        JSArray devices = new JSArray();
        if (usbManager != null) {
            for (Map.Entry<String, UsbDevice> entry : usbManager.getDeviceList().entrySet()) {
                UsbDevice device = entry.getValue();
                String vendorHex  = String.format("%04x", device.getVendorId());
                String productHex = String.format("%04x", device.getProductId());
                JSObject obj = new JSObject();
                obj.put("id",           vendorHex + ":" + productHex);
                obj.put("name",         device.getProductName() != null ? device.getProductName()
                                      : device.getManufacturerName() != null ? device.getManufacturerName()
                                      : "USB " + vendorHex + ":" + productHex);
                obj.put("meta",         "Vendor " + vendorHex + " / Product " + productHex);
                obj.put("type",         "usb");
                obj.put("vendorId",     vendorHex);
                obj.put("productId",    productHex);
                obj.put("deviceName",   device.getDeviceName());
                obj.put("deviceClass",  device.getDeviceClass());
                obj.put("hasPermission", usbManager.hasPermission(device));
                obj.put("likelyPrinter", isLikelyPrinter(device));
                devices.put(obj);
            }
        }
        JSObject result = new JSObject();
        result.put("devices", devices);
        call.resolve(result);
    }

    // ─── requestUsbPermission ─────────────────────────────────────────
    @PluginMethod
    public void requestUsbPermission(PluginCall call) {
        String vendorId  = call.getString("vendorId");
        String productId = call.getString("productId");
        if (vendorId == null)  { call.reject("vendorId required");  return; }
        if (productId == null) { call.reject("productId required"); return; }

        UsbManager usbManager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        UsbDevice device = findDevice(usbManager, vendorId, productId);
        if (device == null) { call.reject("USB device not found"); return; }

        if (usbManager.hasPermission(device)) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }

        Intent intent = new Intent(ACTION_USB_PERMISSION);
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0;
        PendingIntent pi = PendingIntent.getBroadcast(getContext(), 0, intent, flags);

        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent broadcastIntent) {
                ctx.unregisterReceiver(this);
                boolean granted = broadcastIntent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
                JSObject result = new JSObject();
                result.put("granted", granted);
                call.resolve(result);
            }
        };
        IntentFilter filter = new IntentFilter(ACTION_USB_PERMISSION);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(receiver, filter);
        }
        usbManager.requestPermission(device, pi);
    }

    // ─── printUsbText ─────────────────────────────────────────────────
    @PluginMethod
    public void printUsbText(PluginCall call) {
        String vendorId  = call.getString("vendorId");
        String productId = call.getString("productId");
        String text      = call.getString("text");
        if (vendorId == null)  { call.reject("vendorId required");  return; }
        if (productId == null) { call.reject("productId required"); return; }
        if (text == null)      { call.reject("text required");      return; }
        boolean cut  = Boolean.TRUE.equals(call.getBoolean("cut", true));
        int feed     = call.getInt("feedLines", 3);

        UsbManager usbManager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        UsbDevice device = findDevice(usbManager, vendorId, productId);
        if (device == null) { call.reject("USB device not found"); return; }
        try {
            byte[] bytes   = buildEscPos(text, cut, feed);
            int    written = writeUsb(usbManager, device, bytes);
            JSObject result = new JSObject();
            result.put("printed", written > 0);
            result.put("bytesWritten", written);
            call.resolve(result);
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "USB print failed");
        }
    }

    // ─── printUsbRasterText ───────────────────────────────────────────
    @PluginMethod
    public void printUsbRasterText(PluginCall call) { printUsbText(call); }

    // ─── openUsbDrawer ────────────────────────────────────────────────
    @PluginMethod
    public void openUsbDrawer(PluginCall call) {
        String vendorId  = call.getString("vendorId");
        String productId = call.getString("productId");
        if (vendorId == null)  { call.reject("vendorId required");  return; }
        if (productId == null) { call.reject("productId required"); return; }
        int pin   = call.getInt("pin", 2);
        int onMs  = Math.max(1, Math.min(255, call.getInt("pulseOnMs",  25)));
        int offMs = Math.max(1, Math.min(255, call.getInt("pulseOffMs", 25)));

        UsbManager usbManager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        UsbDevice device = findDevice(usbManager, vendorId, productId);
        if (device == null) { call.reject("USB device not found"); return; }
        try {
            byte pinByte = pin == 5 ? (byte) 0x01 : (byte) 0x00;
            byte[] cmd = {0x1B, 0x70, pinByte, (byte) onMs, (byte) offMs};
            int written = writeUsb(usbManager, device, cmd);
            JSObject result = new JSObject();
            result.put("opened", written > 0);
            result.put("bytesWritten", written);
            call.resolve(result);
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "Drawer open failed");
        }
    }

    // ─── printLanText ─────────────────────────────────────────────────
    @PluginMethod
    public void printLanText(PluginCall call) {
        String host = call.getString("host");
        if (host == null) { call.reject("host required"); return; }
        int port     = call.getInt("port", 9100);
        String text  = call.getString("text");
        if (text == null) { call.reject("text required"); return; }
        boolean cut  = Boolean.TRUE.equals(call.getBoolean("cut", true));
        int feed     = call.getInt("feedLines", 3);
        try {
            byte[] bytes   = buildEscPos(text, cut, feed);
            int    written = writeLan(host, port, bytes);
            JSObject result = new JSObject();
            result.put("printed", written > 0);
            result.put("bytesWritten", written);
            call.resolve(result);
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "LAN print failed");
        }
    }

    // ─── printLanRasterText ───────────────────────────────────────────
    @PluginMethod
    public void printLanRasterText(PluginCall call) { printLanText(call); }

    // ─── openLanDrawer ────────────────────────────────────────────────
    @PluginMethod
    public void openLanDrawer(PluginCall call) {
        String host = call.getString("host");
        if (host == null) { call.reject("host required"); return; }
        int port  = call.getInt("port", 9100);
        int pin   = call.getInt("pin", 2);
        int onMs  = Math.max(1, Math.min(255, call.getInt("pulseOnMs",  25)));
        int offMs = Math.max(1, Math.min(255, call.getInt("pulseOffMs", 25)));
        try {
            byte pinByte = pin == 5 ? (byte) 0x01 : (byte) 0x00;
            byte[] cmd = {0x1B, 0x70, pinByte, (byte) onMs, (byte) offMs};
            int written = writeLan(host, port, cmd);
            JSObject result = new JSObject();
            result.put("opened", written > 0);
            result.put("bytesWritten", written);
            call.resolve(result);
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "LAN drawer open failed");
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────

    private UsbDevice findDevice(UsbManager usbManager, String vendorId, String productId) {
        if (usbManager == null) return null;
        try {
            int v = Integer.parseInt(vendorId,  16);
            int p = Integer.parseInt(productId, 16);
            for (UsbDevice device : usbManager.getDeviceList().values()) {
                if (device.getVendorId() == v && device.getProductId() == p) return device;
            }
        } catch (NumberFormatException ignored) {}
        return null;
    }

    private boolean isLikelyPrinter(UsbDevice device) {
        if (device.getDeviceClass() == 7) return true;
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            if (device.getInterface(i).getInterfaceClass() == 7) return true;
        }
        return false;
    }

    private byte[] buildEscPos(String text, boolean cut, int feedLines) {
        byte[] textBytes = text.getBytes(StandardCharsets.UTF_8);
        List<Byte> buf = new ArrayList<>();
        for (byte b : ESC_INIT) buf.add(b);
        for (byte b : textBytes) buf.add(b);
        for (int i = 0; i < feedLines; i++) buf.add((byte) '\n');
        if (cut) for (byte b : ESC_CUT) buf.add(b);
        byte[] result = new byte[buf.size()];
        for (int i = 0; i < buf.size(); i++) result[i] = buf.get(i);
        return result;
    }

    private int writeUsb(UsbManager usbManager, UsbDevice device, byte[] bytes) throws Exception {
        UsbDeviceConnection conn = usbManager.openDevice(device);
        if (conn == null) throw new Exception("ไม่สามารถเปิด USB ได้ กรุณาอนุญาต permission ก่อน");
        try {
            for (int i = 0; i < device.getInterfaceCount(); i++) {
                UsbInterface iface = device.getInterface(i);
                if (!conn.claimInterface(iface, true)) continue;
                for (int j = 0; j < iface.getEndpointCount(); j++) {
                    UsbEndpoint ep = iface.getEndpoint(j);
                    if (ep.getDirection() == UsbConstants.USB_DIR_OUT
                            && ep.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK) {
                        int written = conn.bulkTransfer(ep, bytes, bytes.length, 5000);
                        conn.releaseInterface(iface);
                        return written;
                    }
                }
                conn.releaseInterface(iface);
            }
            throw new Exception("ไม่พบ USB bulk OUT endpoint");
        } finally {
            conn.close();
        }
    }

    private int writeLan(String host, int port, byte[] bytes) throws IOException {
        try (Socket sock = new Socket(host, port)) {
            sock.setSoTimeout(5000);
            OutputStream out = sock.getOutputStream();
            out.write(bytes);
            out.flush();
            return bytes.length;
        }
    }
}
