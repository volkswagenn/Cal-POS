import type { FastifyInstance } from 'fastify';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { verifyPassword } from '../../utils/password.js';

function sanitizeUser(user: {
  id: string;
  shopId: string;
  username: string;
  displayName: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: user.id,
    shopId: user.shopId,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export async function issueTokens(app: FastifyInstance, user: { id: string; shopId: string; role: string; username: string }) {
  const payload = {
    sub: user.id,
    shopId: user.shopId,
    role: user.role,
    username: user.username,
  };

  const accessToken = app.jwt.sign(payload, { expiresIn: env.jwtExpiresIn });
  const refreshToken = app.jwt.sign(payload, { key: env.jwtRefreshSecret, expiresIn: env.jwtRefreshExpiresIn });

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await prisma.refreshToken.create({
    data: { userId: user.id, shopId: user.shopId, token: refreshToken, expiresAt },
  });

  return { accessToken, refreshToken };
}

export async function revokeRefreshToken(token: string) {
  await prisma.refreshToken.updateMany({
    where: { token, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function validateAndRotateRefreshToken(app: FastifyInstance, refreshToken: string) {
  let payload: { sub: string; shopId: string; role: string; username: string };
  try {
    payload = app.jwt.verify<{ sub: string; shopId: string; role: string; username: string }>(
      refreshToken,
      { key: env.jwtRefreshSecret },
    );
  } catch {
    return null;
  }

  const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) return null;

  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });

  return issueTokens(app, { id: payload.sub, shopId: payload.shopId, role: payload.role, username: payload.username });
}

export async function loginWithPassword(app: FastifyInstance, input: { username: string; password: string; shopId?: string }) {
  const user = await prisma.user.findFirst({
    where: {
      shopId: input.shopId ?? env.defaultShopId,
      username: input.username.trim(),
      isActive: true,
    },
  });

  if (!user || !(await verifyPassword(input.password, user.passwordHash))) return null;

  return {
    user: sanitizeUser(user),
    tokens: await issueTokens(app, user),
  };
}

export async function loginWithPin(app: FastifyInstance, input: { pin: string; shopId?: string }) {
  const user = await prisma.user.findFirst({
    where: {
      shopId: input.shopId ?? env.defaultShopId,
      pin: input.pin.trim(),
      isActive: true,
    },
  });

  if (!user) return null;

  return {
    user: sanitizeUser(user),
    tokens: await issueTokens(app, user),
  };
}

export async function getCurrentUser(userId: string, shopId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, shopId, isActive: true },
  });

  return user ? sanitizeUser(user) : null;
}

export async function cleanupExpiredTokens() {
  await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
}
