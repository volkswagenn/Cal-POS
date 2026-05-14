import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/permission.js';
import { hashPassword } from '../../utils/password.js';

const userSchema = z.object({
  username: z.string().min(1),
  displayName: z.string().min(1),
  password: z.string().min(1, 'กรุณาใส่รหัสผ่าน'),
  pin: z.string().min(6).max(8).regex(/^\d+$/, 'PIN ต้องเป็นตัวเลขเท่านั้น'),
  role: z.string().min(1),
  isActive: z.boolean().optional(),
});

const patchUserSchema = userSchema.partial();

function toUserDto(user: {
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

export async function userRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/', { preHandler: requireRole(['admin']) }, async (request) => {
    const users = await prisma.user.findMany({
      where: { shopId: request.user.shopId },
      orderBy: { username: 'asc' },
    });

    return { users: users.map(toUserDto) };
  });

  app.post('/', { preHandler: requireRole(['admin']) }, async (request, reply) => {
    const input = userSchema.parse(request.body);
    const created = await prisma.user.create({
      data: {
        id: randomUUID(),
        shopId: request.user.shopId,
        username: input.username.trim(),
        displayName: input.displayName.trim(),
        passwordHash: await hashPassword(input.password),
        pin: input.pin.trim(),
        role: input.role,
        isActive: input.isActive ?? true,
      },
    });

    return reply.code(201).send({ user: toUserDto(created) });
  });

  app.patch('/:id', { preHandler: requireRole(['admin']) }, async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = patchUserSchema.parse(request.body);
    const existing = await prisma.user.findFirst({
      where: {
        id: params.id,
        shopId: request.user.shopId,
      },
    });

    if (!existing) return reply.code(404).send({ message: 'User not found' });

    const updated = await prisma.user.update({
      where: { id: params.id },
      data: {
        ...(input.username ? { username: input.username.trim() } : {}),
        ...(input.displayName ? { displayName: input.displayName.trim() } : {}),
        ...(input.pin ? { pin: input.pin.trim() } : {}),
        ...(input.role ? { role: input.role } : {}),
        ...(typeof input.isActive === 'boolean' ? { isActive: input.isActive } : {}),
        ...(input.password ? { passwordHash: await hashPassword(input.password) } : {}),
      },
    });

    return { user: toUserDto(updated) };
  });

  app.delete('/:id', { preHandler: requireRole(['admin']) }, async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const existing = await prisma.user.findFirst({
      where: {
        id: params.id,
        shopId: request.user.shopId,
      },
    });

    if (!existing) return reply.code(404).send({ message: 'User not found' });

    await prisma.user.update({
      where: { id: params.id },
      data: { isActive: false },
    });

    return { ok: true };
  });
}
