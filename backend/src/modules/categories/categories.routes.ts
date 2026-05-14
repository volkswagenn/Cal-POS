import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/permission.js';
import { toCategoryDto } from '../catalog/catalog.dto.js';

const categorySchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  color: z.string().min(1),
  icon: z.string().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

const patchCategorySchema = categorySchema.partial();

export async function categoryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (request) => {
    const categories = await prisma.category.findMany({
      where: { shopId: request.user.shopId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return { categories: categories.map(toCategoryDto) };
  });

  app.post('/', { preHandler: requireRole(['admin', 'manager']) }, async (request, reply) => {
    const input = categorySchema.parse(request.body);
    const category = await prisma.category.create({
      data: {
        id: input.id ?? randomUUID(),
        shopId: request.user.shopId,
        name: input.name.trim(),
        color: input.color,
        icon: input.icon,
        sortOrder: input.sortOrder ?? Date.now(),
        isActive: input.isActive ?? true,
        ...(input.createdAt ? { createdAt: new Date(input.createdAt) } : {}),
        ...(input.updatedAt ? { updatedAt: new Date(input.updatedAt) } : {}),
      },
    });

    await prisma.syncLog.create({
      data: { shopId: request.user.shopId, deviceId: 'api', table: 'categories', recordId: category.id, action: 'upsert' },
    });

    return reply.code(201).send({ category: toCategoryDto(category) });
  });

  app.patch('/:id', { preHandler: requireRole(['admin', 'manager']) }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = patchCategorySchema.parse(request.body);
    const existing = await prisma.category.findFirst({ where: { id, shopId: request.user.shopId } });
    if (!existing) return reply.code(404).send({ message: 'Category not found' });

    const category = await prisma.category.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name.trim() } : {}),
        ...(input.color ? { color: input.color } : {}),
        ...(typeof input.icon !== 'undefined' ? { icon: input.icon } : {}),
        ...(typeof input.sortOrder === 'number' ? { sortOrder: input.sortOrder } : {}),
        ...(typeof input.isActive === 'boolean' ? { isActive: input.isActive } : {}),
        ...(input.updatedAt ? { updatedAt: new Date(input.updatedAt) } : {}),
      },
    });

    await prisma.syncLog.create({
      data: { shopId: request.user.shopId, deviceId: 'api', table: 'categories', recordId: id, action: 'upsert' },
    });

    return { category: toCategoryDto(category) };
  });

  app.delete('/:id', { preHandler: requireRole(['admin', 'manager']) }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const existing = await prisma.category.findFirst({ where: { id, shopId: request.user.shopId } });
    if (!existing) return reply.code(404).send({ message: 'Category not found' });

    await prisma.category.delete({ where: { id } });
    await prisma.syncLog.create({
      data: { shopId: request.user.shopId, deviceId: 'api', table: 'categories', recordId: id, action: 'delete' },
    });

    return { ok: true };
  });
}
