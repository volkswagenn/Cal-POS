function requireEnv(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

const isProd = process.env.NODE_ENV === 'production';

export const env = {
  port: Number(process.env.PORT ?? 3000),
  isProd,
  frontendOrigin: requireEnv('FRONTEND_ORIGIN', isProd ? undefined : 'http://localhost:5173'),
  jwtSecret: requireEnv('JWT_SECRET', isProd ? undefined : 'dev-only-change-me'),
  jwtRefreshSecret: requireEnv('JWT_REFRESH_SECRET', isProd ? undefined : 'dev-only-refresh-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  defaultShopId: process.env.DEFAULT_SHOP_ID ?? 'default-shop',
  backupStorageDir: process.env.BACKUP_STORAGE_DIR ?? 'storage/backups',
  autoBackupEnabled: process.env.AUTO_BACKUP_ENABLED === 'true' || (!isProd && process.env.AUTO_BACKUP_ENABLED !== 'false'),
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY ?? '',
};
