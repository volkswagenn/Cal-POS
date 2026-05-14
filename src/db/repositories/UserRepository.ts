import { db } from '../database';
import type { Role, User } from '../../types';
import { nowIso } from '../../utils/date';
import { sha256, uid } from '../../utils/id';

export const ADMIN_RESET_PIN = '000000';

function normalizeUniqueValue(value: string) {
  return value.trim().toLowerCase();
}

export const UserRepository = {
  async loginByUsername(username: string, password: string) {
    const user = await db.users.where('username').equals(username.trim()).first();
    if (!user || !user.isActive) return null;
    const passwordHash = await sha256(password);
    if (user.passwordHash === passwordHash) return user;
    return null;
  },
  async loginByPin(pin: string) {
    const user = await db.users.where('pin').equals(pin.trim()).first();
    return user?.isActive ? user : null;
  },
  async getUsers() {
    return db.users.orderBy('username').toArray();
  },
  async assertUniqueUserFields(input: { username: string; displayName: string; pin: string }, excludeUserId?: string) {
    const users = await db.users.toArray();
    const username = normalizeUniqueValue(input.username);
    const displayName = normalizeUniqueValue(input.displayName);
    const pin = input.pin.trim();
    const duplicate = users.find((user) => user.id !== excludeUserId && (
      normalizeUniqueValue(user.username) === username
      || normalizeUniqueValue(user.displayName) === displayName
      || user.pin.trim() === pin
    ));
    if (!duplicate) return;
    if (normalizeUniqueValue(duplicate.username) === username) throw new Error('ชื่อผู้ใช้นี้มีอยู่แล้ว');
    if (normalizeUniqueValue(duplicate.displayName) === displayName) throw new Error('ชื่อแสดงนี้มีอยู่แล้ว');
    throw new Error('PIN นี้มีอยู่แล้ว');
  },
  async createUser(input: { username: string; displayName: string; password: string; pin: string; role: Role; isActive?: boolean }) {
    const timestamp = nowIso();
    await this.assertUniqueUserFields(input);
    const user: User = {
      id: uid('user'),
      username: input.username,
      displayName: input.displayName,
      passwordHash: await sha256(input.password),
      passwordPlain: input.password,
      pin: input.pin,
      role: input.role,
      isActive: input.isActive ?? true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await db.users.add(user);
    return user;
  },
  async updateUser(id: string, patch: Partial<Omit<User, 'id' | 'createdAt' | 'passwordHash'>> & { password?: string }) {
    const { password, ...rest } = patch;
    const current = await db.users.get(id);
    if (current) {
      await this.assertUniqueUserFields({
        username: rest.username ?? current.username,
        displayName: rest.displayName ?? current.displayName,
        pin: rest.pin ?? current.pin,
      }, id);
    }
    await db.users.update(id, {
      ...rest,
      ...(password ? { passwordHash: await sha256(password), passwordPlain: password } : {}),
      updatedAt: nowIso(),
    });
  },
  async deleteUser(id: string) {
    await db.users.delete(id);
  },
  async setActive(id: string, isActive: boolean) {
    await db.users.update(id, { isActive, updatedAt: nowIso() });
  },
  async deactivateUser(id: string) {
    await db.users.update(id, { isActive: false, updatedAt: nowIso() });
  },
  async resetAdminToDefault() {
    const timestamp = nowIso();
    const passwordHash = await sha256('admin');
    const existing = await db.users.where('username').equals('admin').first();
    if (existing) {
      await db.users.update(existing.id, { passwordHash, passwordPlain: 'admin', pin: '000000', isActive: true, updatedAt: timestamp });
    } else {
      await db.users.add({ id: uid('user'), username: 'admin', displayName: 'ผู้ดูแลระบบ', passwordHash, passwordPlain: 'admin', pin: '000000', role: 'Admin', isActive: true, createdAt: timestamp, updatedAt: timestamp });
    }
  },
};
