import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export async function hashPassword(value: string) {
  return bcrypt.hash(value, 12);
}

export async function verifyPassword(value: string, storedHash: string) {
  if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') || storedHash.startsWith('$2y$')) {
    return bcrypt.compare(value, storedHash);
  }

  return sha256(value) === storedHash;
}
