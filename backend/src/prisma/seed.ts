import { randomBytes } from 'node:crypto';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { hashPassword } from '../utils/password.js';

async function main() {
  await prisma.shop.upsert({
    where: { id: env.defaultShopId },
    update: {},
    create: {
      id: env.defaultShopId,
      name: 'Default Shop',
    },
  });

  const existing = await prisma.user.findFirst({
    where: { shopId: env.defaultShopId, username: 'admin' },
  });

  if (!existing) {
    const tempPassword = randomBytes(8).toString('hex');
    const tempPin = String(Math.floor(100000 + Math.random() * 900000));

    await prisma.user.create({
      data: {
        id: 'admin-user',
        shopId: env.defaultShopId,
        username: 'admin',
        displayName: 'ผู้ดูแลระบบ',
        passwordHash: await hashPassword(tempPassword),
        pin: tempPin,
        role: 'Admin',
        isActive: true,
      },
    });

    console.log('========================================');
    console.log('[SEED] Admin account created (one-time):');
    console.log(`  username : admin`);
    console.log(`  password : ${tempPassword}`);
    console.log(`  PIN      : ${tempPin}`);
    console.log('  Change these credentials immediately!');
    console.log('========================================');
  } else {
    console.log('[SEED] Admin already exists — skipped.');
  }
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
