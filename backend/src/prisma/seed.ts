import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { hashPassword } from '../utils/password.js';

const DEFAULT_PASSWORD = 'admin';
const DEFAULT_PIN = '000000';

async function main() {
  await prisma.shop.upsert({
    where: { id: env.defaultShopId },
    update: {},
    create: {
      id: env.defaultShopId,
      name: 'Default Shop',
    },
  });

  const passwordHash = await hashPassword(DEFAULT_PASSWORD);

  await prisma.user.upsert({
    where: { id: 'admin-user' },
    update: {
      username: 'admin',
      displayName: 'ผู้ดูแลระบบ',
      passwordHash,
      pin: DEFAULT_PIN,
      role: 'Admin',
      isActive: true,
      shopId: env.defaultShopId,
    },
    create: {
      id: 'admin-user',
      shopId: env.defaultShopId,
      username: 'admin',
      displayName: 'ผู้ดูแลระบบ',
      passwordHash,
      pin: DEFAULT_PIN,
      role: 'Admin',
      isActive: true,
    },
  });

  console.log('========================================');
  console.log('[SEED] Admin account ready:');
  console.log(`  username : admin`);
  console.log(`  password : ${DEFAULT_PASSWORD}`);
  console.log(`  PIN      : ${DEFAULT_PIN}`);
  console.log('  Change these credentials after login!');
  console.log('========================================');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
