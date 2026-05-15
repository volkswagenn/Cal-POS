import type { WebSocket } from 'ws';

interface ShopConn {
  ws: WebSocket;
  deviceId: string;
}

const rooms = new Map<string, Set<ShopConn>>();

export const wsManager = {
  add(shopId: string, conn: ShopConn): void {
    let room = rooms.get(shopId);
    if (!room) {
      room = new Set();
      rooms.set(shopId, room);
    }
    room.add(conn);
  },

  remove(shopId: string, conn: ShopConn): void {
    rooms.get(shopId)?.delete(conn);
  },

  notify(shopId: string, fromDeviceId: string, syncedAt: string): void {
    const room = rooms.get(shopId);
    if (!room) return;
    const message = JSON.stringify({ type: 'changes', syncedAt });
    for (const conn of room) {
      if (conn.deviceId !== fromDeviceId && conn.ws.readyState === 1 /* OPEN */) {
        conn.ws.send(message);
      }
    }
  },
};
