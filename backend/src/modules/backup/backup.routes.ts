import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/permission.js';
import {
  buildBackupData,
  createBackupSnapshot,
  deleteBackupSnapshot,
  listBackupSnapshots,
  restoreBackupSnapshot,
  toBackupDto,
} from './backup.service.js';

export async function backupRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/download', { preHandler: requireRole(['admin']) }, async (request, reply) => {
    const data = await buildBackupData(request.user.shopId);
    const fileName = `calpos-backup-${request.user.shopId}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    return reply
      .header('Content-Disposition', `attachment; filename="${fileName}"`)
      .header('Content-Type', 'application/json; charset=utf-8')
      .send(JSON.stringify(data, null, 2));
  });

  app.post('/export', { preHandler: requireRole(['admin']) }, async (request, reply) => {
    const snapshot = await createBackupSnapshot(request.user.shopId, request.user.sub);
    return reply.code(201).send({ backup: toBackupDto(snapshot) });
  });

  app.get('/list', { preHandler: requireRole(['admin']) }, async (request) => {
    const backups = await listBackupSnapshots(request.user.shopId);
    return { backups: backups.map(toBackupDto) };
  });

  app.post('/restore/:id', { preHandler: requireRole(['admin']) }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const snapshot = await restoreBackupSnapshot(request.user.shopId, id);
    if (!snapshot) return reply.code(404).send({ message: 'Backup not found' });
    return { ok: true, backup: toBackupDto(snapshot) };
  });

  app.delete('/:id', { preHandler: requireRole(['admin']) }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const snapshot = await deleteBackupSnapshot(request.user.shopId, id);
    if (!snapshot) return reply.code(404).send({ message: 'Backup not found' });
    return { ok: true };
  });
}
