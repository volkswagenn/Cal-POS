import { db } from '../database';
import type { ActivityLog } from '../../types';
import { nowIso } from '../../utils/date';
import { uid } from '../../utils/id';
import { SyncQueueRepository } from '../syncQueue';

export const ActivityLogRepository = {
  async add(input: Omit<ActivityLog, 'id' | 'createdAt'>) {
    const log: ActivityLog = {
      id: uid('log'),
      ...input,
      createdAt: nowIso(),
    };
    await db.activity_logs.add(log);
    await SyncQueueRepository.enqueue({ tableName: 'activity_logs', recordId: log.id, action: 'upsert', payload: log });
    return log;
  },
};
