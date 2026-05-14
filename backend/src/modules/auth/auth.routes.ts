import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import {
  cleanupExpiredTokens,
  getCurrentUser,
  loginWithPassword,
  loginWithPin,
  revokeRefreshToken,
  validateAndRotateRefreshToken,
} from './auth.service.js';

const passwordLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  shopId: z.string().optional(),
});

const pinLoginSchema = z.object({
  pin: z.string().min(6).max(8).regex(/^\d+$/, 'PIN ต้องเป็นตัวเลขเท่านั้น'),
  shopId: z.string().optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const logoutSchema = z.object({
  refreshToken: z.string().optional(),
});

export async function authRoutes(app: FastifyInstance) {
  // ล้าง expired tokens ทุก 24 ชั่วโมง
  setInterval(() => { void cleanupExpiredTokens(); }, 24 * 60 * 60 * 1000);

  app.post('/login', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const input = passwordLoginSchema.parse(request.body);
    const result = await loginWithPassword(app, input);

    if (!result) return reply.code(401).send({ message: 'Invalid username or password' });
    return result;
  });

  app.post('/pin', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const input = pinLoginSchema.parse(request.body);
    const result = await loginWithPin(app, input);

    if (!result) return reply.code(401).send({ message: 'Invalid PIN' });
    return result;
  });

  app.post('/refresh', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const { refreshToken } = refreshSchema.parse(request.body);
    const tokens = await validateAndRotateRefreshToken(app, refreshToken);

    if (!tokens) return reply.code(401).send({ message: 'Invalid or expired refresh token' });
    return { tokens };
  });

  app.post('/logout', { preHandler: requireAuth }, async (request) => {
    const body = logoutSchema.safeParse(request.body);
    if (body.success && body.data.refreshToken) {
      await revokeRefreshToken(body.data.refreshToken);
    }
    return { ok: true };
  });

  app.get('/me', { preHandler: requireAuth }, async (request, reply) => {
    const user = await getCurrentUser(request.user.sub, request.user.shopId);
    if (!user) return reply.code(404).send({ message: 'User not found' });
    return { user };
  });
}
