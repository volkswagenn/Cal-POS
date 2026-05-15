import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { env } from './config/env.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { categoryRoutes } from './modules/categories/categories.routes.js';
import { productRoutes } from './modules/products/products.routes.js';
import { reportRoutes } from './modules/reports/reports.routes.js';
import { saleRoutes } from './modules/sales/sales.routes.js';
import { syncRoutes } from './modules/sync/sync.routes.js';
import { syncWsRoute } from './modules/sync/sync.ws.js';
import { notificationRoutes } from './modules/sync/notifications.routes.js';
import { userRoutes } from './modules/users/users.routes.js';
import { backupRoutes } from './modules/backup/backup.routes.js';
import { scheduleAutoBackup } from './modules/backup/backup.scheduler.js';
import { scheduleSyncMaintenance } from './modules/sync/sync.maintenance.js';

export async function buildApp() {
  const app = Fastify({ logger: true });

  if (env.isProd && env.frontendOrigin === '*') {
    throw new Error('CORS wildcard origin is not allowed in production');
  }

  await app.register(websocket);
  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(rateLimit, {
    global: false,
    max: 20,
    timeWindow: '1 minute',
  });

  const allowedOrigins = env.frontendOrigin === '*'
    ? null
    : new Set(env.frontendOrigin.split(',').map((s) => s.trim()).filter(Boolean));

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins === null) return cb(null, true);
      if (allowedOrigins.has(origin)) return cb(null, true);
      if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)) return cb(null, true);
      cb(null, false);
    },
    credentials: true,
  });

  await app.register(jwt, {
    secret: env.jwtSecret,
  });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'cal-pos-backend',
    timestamp: new Date().toISOString(),
  }));

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(userRoutes, { prefix: '/api/users' });
  await app.register(categoryRoutes, { prefix: '/api/categories' });
  await app.register(productRoutes, { prefix: '/api/products' });
  await app.register(saleRoutes, { prefix: '/api/sales' });
  await app.register(syncRoutes, { prefix: '/api/sync' });
  await app.register(syncWsRoute, { prefix: '/api/sync' });
  await app.register(notificationRoutes, { prefix: '/api/notifications' });
  await app.register(reportRoutes, { prefix: '/api/reports' });
  await app.register(backupRoutes, { prefix: '/api/backup' });

  scheduleAutoBackup(app);
  scheduleSyncMaintenance(app);

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);

    if ('issues' in error) {
      return reply.code(400).send({ message: 'Invalid request', issues: error.issues });
    }

    return reply.code(error.statusCode ?? 500).send({
      message: error.message || 'Internal server error',
    });
  });

  return app;
}
