import type { SocketStream } from '@fastify/websocket';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { wsManager } from './ws.manager.js';

export async function syncWsRoute(app: FastifyInstance) {
  app.get<{ Querystring: { token?: string; deviceId?: string } }>(
    '/ws',
    { websocket: true },
    (connection: SocketStream, request: FastifyRequest<{ Querystring: { token?: string; deviceId?: string } }>) => {
      const { token, deviceId = 'unknown' } = request.query;
      const socket = connection.socket;

      if (!token) {
        socket.close(4001, 'Missing token');
        return;
      }

      let shopId: string;
      try {
        const payload = app.jwt.verify<{ shopId: string }>(token);
        shopId = payload.shopId;
      } catch {
        socket.close(4001, 'Invalid token');
        return;
      }

      const conn = { ws: socket, deviceId };
      wsManager.add(shopId, conn);

      const pingInterval = setInterval(() => {
        if (socket.readyState === 1) socket.ping();
      }, 30_000);

      socket.on('close', () => {
        clearInterval(pingInterval);
        wsManager.remove(shopId, conn);
      });

      socket.on('error', () => {
        clearInterval(pingInterval);
        wsManager.remove(shopId, conn);
      });
    },
  );
}
