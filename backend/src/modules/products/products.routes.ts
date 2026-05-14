import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/permission.js';
import { toProductDto } from '../catalog/catalog.dto.js';

const productSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  displayName: z.string().min(1),
  price: z.number().nonnegative(),
  categoryId: z.string().min(1),
  color: z.string().min(1),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  isOpenPrice: z.boolean().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

const patchProductSchema = productSchema.partial();

export async function productRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (request) => {
    const products = await prisma.product.findMany({
      where: { shopId: request.user.shopId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return { products: products.map(toProductDto) };
  });

  app.post('/', { preHandler: requireRole(['admin', 'manager']) }, async (request, reply) => {
    const input = productSchema.parse(request.body);
    const category = await prisma.category.findFirst({
      where: { id: input.categoryId, shopId: request.user.shopId },
    });
    if (!category) return reply.code(400).send({ message: 'Category not found' });

    const product = await prisma.product.create({
      data: {
        id: input.id ?? randomUUID(),
        shopId: request.user.shopId,
        categoryId: input.categoryId,
        name: input.name.trim(),
        displayName: input.displayName.trim(),
        price: input.price,
        color: input.color,
        sortOrder: input.sortOrder ?? Date.now(),
        isActive: input.isActive ?? true,
        isOpenPrice: input.isOpenPrice ?? false,
        ...(input.createdAt ? { createdAt: new Date(input.createdAt) } : {}),
        ...(input.updatedAt ? { updatedAt: new Date(input.updatedAt) } : {}),
      },
    });

    await prisma.syncLog.create({
      data: { shopId: request.user.shopId, deviceId: 'api', table: 'products', recordId: product.id, action: 'upsert' },
    });

    return reply.code(201).send({ product: toProductDto(product) });
  });

  app.patch('/:id', { preHandler: requireRole(['admin', 'manager']) }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = patchProductSchema.parse(request.body);
    const existing = await prisma.product.findFirst({ where: { id, shopId: request.user.shopId } });
    if (!existing) return reply.code(404).send({ message: 'Product not found' });

    if (input.categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: input.categoryId, shopId: request.user.shopId },
      });
      if (!category) return reply.code(400).send({ message: 'Category not found' });
    }

    const product = await prisma.product.update({
      where: { id },
      data: {
        ...(input.categoryId ? { categoryId: input.categoryId } : {}),
        ...(input.name ? { name: input.name.trim() } : {}),
        ...(input.displayName ? { displayName: input.displayName.trim() } : {}),
        ...(typeof input.price === 'number' ? { price: input.price } : {}),
        ...(input.color ? { color: input.color } : {}),
        ...(typeof input.sortOrder === 'number' ? { sortOrder: input.sortOrder } : {}),
        ...(typeof input.isActive === 'boolean' ? { isActive: input.isActive } : {}),
        ...(typeof input.isOpenPrice === 'boolean' ? { isOpenPrice: input.isOpenPrice } : {}),
        ...(input.updatedAt ? { updatedAt: new Date(input.updatedAt) } : {}),
      },
    });

    await prisma.syncLog.create({
      data: { shopId: request.user.shopId, deviceId: 'api', table: 'products', recordId: id, action: 'upsert' },
    });

    return { product: toProductDto(product) };
  });

  app.delete('/:id', { preHandler: requireRole(['admin', 'manager']) }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const existing = await prisma.product.findFirst({ where: { id, shopId: request.user.shopId } });
    if (!existing) return reply.code(404).send({ message: 'Product not found' });

    await prisma.product.delete({ where: { id } });
    await prisma.syncLog.create({
      data: { shopId: request.user.shopId, deviceId: 'api', table: 'products', recordId: id, action: 'delete' },
    });

    return { ok: true };
  });
}
