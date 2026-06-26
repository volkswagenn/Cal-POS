import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import { wsManager } from '../sync/ws.manager.js';

export async function subposRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  const rl = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  const rlCmd = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };

  // POST /link-request — SubPOS requests to link with MainPOS
  app.post('/link-request', rl, async (request, reply) => {
    const { shopId } = request.user;

    const body = z.object({
      subDeviceId: z.string(),
      mainDeviceCode: z.string().min(1).max(6),
    }).parse(request.body);

    const mainCode = body.mainDeviceCode.toUpperCase();

    const mainDevice = await prisma.device.findFirst({
      where: { shopId, code: mainCode },
    });
    if (!mainDevice) {
      return reply.code(404).send({ message: `ไม่พบเครื่อง "${mainCode}" ในร้านนี้` });
    }
    if (mainDevice.deviceId === body.subDeviceId) {
      return reply.code(400).send({ message: 'ไม่สามารถเชื่อมต่อกับตัวเอง' });
    }

    const subDevice = await prisma.device.findUnique({
      where: { deviceId: body.subDeviceId },
    });
    const subDeviceCode = subDevice?.code ?? body.subDeviceId.slice(0, 6).toUpperCase();

    // Replace any existing pending/rejected link from this subDevice to this mainCode
    await prisma.subPosLink.deleteMany({
      where: { shopId, mainDeviceCode: mainCode, subDeviceId: body.subDeviceId },
    });

    const link = await prisma.subPosLink.create({
      data: {
        shopId,
        mainDeviceCode: mainCode,
        subDeviceCode,
        mainDeviceId: mainDevice.deviceId,
        subDeviceId: body.subDeviceId,
        status: 'pending',
      },
    });

    wsManager.pushToDevice(shopId, mainDevice.deviceId, JSON.stringify({
      type: 'subpos_link_request',
      linkId: link.id,
      subDeviceCode,
      subDeviceId: body.subDeviceId,
    }));

    return reply.send({ linkId: link.id });
  });

  // POST /link-approve — MainPOS approves a pending link
  app.post('/link-approve', rl, async (request, reply) => {
    const { shopId } = request.user;

    const body = z.object({
      linkId: z.string(),
      mainDeviceId: z.string(),
    }).parse(request.body);

    const link = await prisma.subPosLink.findFirst({
      where: { id: body.linkId, shopId },
    });
    if (!link) return reply.code(404).send({ message: 'ไม่พบการเชื่อมต่อนี้' });
    if (link.mainDeviceId !== body.mainDeviceId) return reply.code(403).send({ message: 'ไม่มีสิทธิ์อนุมัติ' });

    await prisma.subPosLink.update({
      where: { id: link.id },
      data: { status: 'active' },
    });

    wsManager.pushToDevice(shopId, link.subDeviceId, JSON.stringify({
      type: 'subpos_link_approved',
      linkId: link.id,
      mainDeviceCode: link.mainDeviceCode,
    }));

    return reply.send({ ok: true });
  });

  // POST /link-reject — MainPOS rejects a pending link
  app.post('/link-reject', rl, async (request, reply) => {
    const { shopId } = request.user;

    const body = z.object({
      linkId: z.string(),
      mainDeviceId: z.string(),
    }).parse(request.body);

    const link = await prisma.subPosLink.findFirst({
      where: { id: body.linkId, shopId },
    });
    if (!link) return reply.code(404).send({ message: 'ไม่พบการเชื่อมต่อนี้' });
    if (link.mainDeviceId !== body.mainDeviceId) return reply.code(403).send({ message: 'ไม่มีสิทธิ์' });

    await prisma.subPosLink.delete({ where: { id: link.id } });

    wsManager.pushToDevice(shopId, link.subDeviceId, JSON.stringify({
      type: 'subpos_link_rejected',
    }));

    return reply.send({ ok: true });
  });

  // DELETE /link/:id — MainPOS revokes an active link
  app.delete('/link/:id', rl, async (request, reply) => {
    const { shopId } = request.user;
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ mainDeviceId: z.string() }).parse(request.body);

    const link = await prisma.subPosLink.findFirst({
      where: { id: params.id, shopId },
    });
    if (!link) return reply.code(404).send({ message: 'ไม่พบการเชื่อมต่อนี้' });
    if (link.mainDeviceId !== body.mainDeviceId) return reply.code(403).send({ message: 'ไม่มีสิทธิ์' });

    await prisma.subPosLink.delete({ where: { id: link.id } });

    wsManager.pushToDevice(shopId, link.subDeviceId, JSON.stringify({
      type: 'subpos_link_revoked',
    }));

    return reply.send({ ok: true });
  });

  // GET /links — All links where this device is MainPOS
  app.get('/links', rl, async (request, reply) => {
    const { shopId } = request.user;
    const query = z.object({ mainDeviceId: z.string() }).parse(request.query);

    const links = await prisma.subPosLink.findMany({
      where: { shopId, mainDeviceId: query.mainDeviceId },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({ links });
  });

  // POST /command — SubPOS sends a command to MainPOS via WS relay
  app.post('/command', rlCmd, async (request, reply) => {
    const { shopId } = request.user;

    const body = z.object({
      subDeviceId: z.string(),
      commandId: z.string(),
      action: z.enum(['print_receipt', 'open_drawer']),
      payload: z.unknown(),
    }).parse(request.body);

    const link = await prisma.subPosLink.findFirst({
      where: { shopId, subDeviceId: body.subDeviceId, status: 'active' },
    });
    if (!link) return reply.code(404).send({ message: 'ยังไม่ได้เชื่อมต่อกับ MainPOS' });
    if (body.action === 'print_receipt' && !link.allowPrint) {
      return reply.code(403).send({ message: 'MainPOS ไม่อนุญาตให้สั่งพิมพ์' });
    }
    if (body.action === 'open_drawer' && !link.allowDrawer) {
      return reply.code(403).send({ message: 'MainPOS ไม่อนุญาตให้เปิดลิ้นชัก' });
    }

    wsManager.pushToDevice(shopId, link.mainDeviceId, JSON.stringify({
      type: 'subpos_command',
      commandId: body.commandId,
      linkId: link.id,
      action: body.action,
      payload: body.payload,
    }));

    return reply.send({ ok: true });
  });

  // POST /command-result — MainPOS sends the result back to SubPOS
  app.post('/command-result', rlCmd, async (request, reply) => {
    const { shopId } = request.user;

    const body = z.object({
      mainDeviceId: z.string(),
      commandId: z.string(),
      linkId: z.string(),
      success: z.boolean(),
      error: z.string().optional(),
    }).parse(request.body);

    const link = await prisma.subPosLink.findFirst({
      where: { id: body.linkId, shopId },
    });
    if (!link) return reply.code(404).send({ message: 'ไม่พบการเชื่อมต่อนี้' });
    if (link.mainDeviceId !== body.mainDeviceId) return reply.code(403).send({ message: 'ไม่มีสิทธิ์' });

    wsManager.pushToDevice(shopId, link.subDeviceId, JSON.stringify({
      type: 'subpos_command_result',
      commandId: body.commandId,
      success: body.success,
      error: body.error,
    }));

    return reply.send({ ok: true });
  });
}
