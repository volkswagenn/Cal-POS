package com.calpos.local

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbManager
import android.os.Build
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.net.Socket

@CapacitorPlugin(name = "CalPosPrinterBridge")
class CalPosPrinterBridgePlugin : Plugin() {

    companion object {
        private const val ACTION_USB_PERMISSION = "com.calpos.local.USB_PERMISSION"
        private val ESC_INIT = byteArrayOf(0x1B, 0x40)
        private val ESC_CUT  = byteArrayOf(0x1D, 0x56, 0x42, 0x00)
    }

    // ─── scanPrinters ─────────────────────────────────────────────────
    @PluginMethod
    fun scanPrinters(call: PluginCall) {
        val type = call.getString("type") ?: "usb"
        if (type != "usb") {
            call.resolve(JSObject().apply { put("devices", JSArray()) })
            return
        }
        val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager
        val devices = JSArray()
        for ((_, device) in usbManager.deviceList) {
            val vendorHex  = device.vendorId.toString(16).padStart(4, '0')
            val productHex = device.productId.toString(16).padStart(4, '0')
            devices.put(JSObject().apply {
                put("id",          "$vendorHex:$productHex")
                put("name",        device.productName ?: device.manufacturerName ?: "USB $vendorHex:$productHex")
                put("meta",        "Vendor $vendorHex / Product $productHex")
                put("type",        "usb")
                put("vendorId",    vendorHex)
                put("productId",   productHex)
                put("deviceName",  device.deviceName)
                put("deviceClass", device.deviceClass)
                put("hasPermission", usbManager.hasPermission(device))
                put("likelyPrinter", isLikelyPrinter(device))
            })
        }
        call.resolve(JSObject().apply { put("devices", devices) })
    }

    // ─── requestUsbPermission ─────────────────────────────────────────
    @PluginMethod
    fun requestUsbPermission(call: PluginCall) {
        val vendorId  = call.getString("vendorId")  ?: return call.reject("vendorId required")
        val productId = call.getString("productId") ?: return call.reject("productId required")
        val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager
        val device = findDevice(usbManager, vendorId, productId)
            ?: return call.reject("USB device not found")

        if (usbManager.hasPermission(device)) {
            call.resolve(JSObject().apply { put("granted", true) })
            return
        }

        val permIntent = Intent(ACTION_USB_PERMISSION)
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        val pi = PendingIntent.getBroadcast(context, 0, permIntent, flags)

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                ctx.unregisterReceiver(this)
                val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                call.resolve(JSObject().apply { put("granted", granted) })
            }
        }
        val filter = IntentFilter(ACTION_USB_PERMISSION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            context.registerReceiver(receiver, filter)
        }
        usbManager.requestPermission(device, pi)
    }

    // ─── printUsbText ─────────────────────────────────────────────────
    @PluginMethod
    fun printUsbText(call: PluginCall) {
        val vendorId  = call.getString("vendorId")  ?: return call.reject("vendorId required")
        val productId = call.getString("productId") ?: return call.reject("productId required")
        val text      = call.getString("text")      ?: return call.reject("text required")
        val cut       = call.getBoolean("cut", true)      ?: true
        val feed      = call.getInt("feedLines", 3)       ?: 3
        val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager
        val device = findDevice(usbManager, vendorId, productId)
            ?: return call.reject("USB device not found")
        try {
            val bytes   = buildEscPos(text, cut, feed)
            val written = writeUsb(usbManager, device, bytes)
            call.resolve(JSObject().apply { put("printed", written > 0); put("bytesWritten", written) })
        } catch (e: Exception) {
            call.reject(e.message ?: "USB print failed")
        }
    }

    // ─── printUsbRasterText ───────────────────────────────────────────
    @PluginMethod
    fun printUsbRasterText(call: PluginCall) = printUsbText(call)

    // ─── openUsbDrawer ────────────────────────────────────────────────
    @PluginMethod
    fun openUsbDrawer(call: PluginCall) {
        val vendorId  = call.getString("vendorId")  ?: return call.reject("vendorId required")
        val productId = call.getString("productId") ?: return call.reject("productId required")
        val pin       = call.getInt("pin", 2)            ?: 2
        val onMs      = (call.getInt("pulseOnMs",  25)   ?: 25).coerceIn(1, 255)
        val offMs     = (call.getInt("pulseOffMs", 25)   ?: 25).coerceIn(1, 255)
        val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager
        val device = findDevice(usbManager, vendorId, productId)
            ?: return call.reject("USB device not found")
        try {
            val pinByte: Byte = if (pin == 5) 0x01 else 0x00
            val cmd = byteArrayOf(0x1B, 0x70, pinByte, onMs.toByte(), offMs.toByte())
            val written = writeUsb(usbManager, device, cmd)
            call.resolve(JSObject().apply { put("opened", written > 0); put("bytesWritten", written) })
        } catch (e: Exception) {
            call.reject(e.message ?: "Drawer open failed")
        }
    }

    // ─── printLanText ─────────────────────────────────────────────────
    @PluginMethod
    fun printLanText(call: PluginCall) {
        val host = call.getString("host") ?: return call.reject("host required")
        val port = call.getInt("port", 9100) ?: 9100
        val text = call.getString("text") ?: return call.reject("text required")
        val cut  = call.getBoolean("cut", true)    ?: true
        val feed = call.getInt("feedLines", 3)     ?: 3
        try {
            val bytes   = buildEscPos(text, cut, feed)
            val written = writeLan(host, port, bytes)
            call.resolve(JSObject().apply { put("printed", written > 0); put("bytesWritten", written) })
        } catch (e: Exception) {
            call.reject(e.message ?: "LAN print failed")
        }
    }

    // ─── printLanRasterText ───────────────────────────────────────────
    @PluginMethod
    fun printLanRasterText(call: PluginCall) = printLanText(call)

    // ─── openLanDrawer ────────────────────────────────────────────────
    @PluginMethod
    fun openLanDrawer(call: PluginCall) {
        val host  = call.getString("host") ?: return call.reject("host required")
        val port  = call.getInt("port", 9100) ?: 9100
        val pin   = call.getInt("pin", 2)            ?: 2
        val onMs  = (call.getInt("pulseOnMs",  25)   ?: 25).coerceIn(1, 255)
        val offMs = (call.getInt("pulseOffMs", 25)   ?: 25).coerceIn(1, 255)
        try {
            val pinByte: Byte = if (pin == 5) 0x01 else 0x00
            val cmd = byteArrayOf(0x1B, 0x70, pinByte, onMs.toByte(), offMs.toByte())
            val written = writeLan(host, port, cmd)
            call.resolve(JSObject().apply { put("opened", written > 0); put("bytesWritten", written) })
        } catch (e: Exception) {
            call.reject(e.message ?: "LAN drawer open failed")
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────

    private fun findDevice(usbManager: UsbManager, vendorId: String, productId: String): UsbDevice? {
        val v = vendorId.toIntOrNull(16)  ?: return null
        val p = productId.toIntOrNull(16) ?: return null
        return usbManager.deviceList.values.find { it.vendorId == v && it.productId == p }
    }

    private fun isLikelyPrinter(device: UsbDevice): Boolean {
        if (device.deviceClass == 7) return true
        for (i in 0 until device.interfaceCount) {
            if (device.getInterface(i).interfaceClass == 7) return true
        }
        return false
    }

    private fun buildEscPos(text: String, cut: Boolean, feedLines: Int): ByteArray {
        val buf = mutableListOf<Byte>()
        buf.addAll(ESC_INIT.toList())
        buf.addAll(text.toByteArray(Charsets.UTF_8).toList())
        repeat(feedLines) { buf.add('\n'.code.toByte()) }
        if (cut) buf.addAll(ESC_CUT.toList())
        return buf.toByteArray()
    }

    private fun writeUsb(usbManager: UsbManager, device: UsbDevice, bytes: ByteArray): Int {
        val conn: UsbDeviceConnection = usbManager.openDevice(device)
            ?: throw Exception("ไม่สามารถเปิด USB ได้ กรุณาอนุญาต permission ก่อน")
        try {
            for (i in 0 until device.interfaceCount) {
                val iface = device.getInterface(i)
                if (!conn.claimInterface(iface, true)) continue
                for (j in 0 until iface.endpointCount) {
                    val ep = iface.getEndpoint(j)
                    if (ep.direction == UsbConstants.USB_DIR_OUT && ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK) {
                        val written = conn.bulkTransfer(ep, bytes, bytes.size, 5000)
                        conn.releaseInterface(iface)
                        return written
                    }
                }
                conn.releaseInterface(iface)
            }
            throw Exception("ไม่พบ USB bulk OUT endpoint")
        } finally {
            conn.close()
        }
    }

    private fun writeLan(host: String, port: Int, bytes: ByteArray): Int {
        Socket(host, port).use { sock ->
            sock.soTimeout = 5000
            sock.getOutputStream().apply { write(bytes); flush() }
            return bytes.size
        }
    }
}
