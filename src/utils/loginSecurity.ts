export const LOGIN_SECURITY_CONFIG_KEY = 'loginSecurityConfig';
export const LOGIN_SECURITY_STATE_KEY = 'loginSecurityState';

export type LoginSecurityConfig = {
  passwordMaxAttempts: number;
  pinMaxAttempts: number;
};

export type LoginSecurityState = {
  passwordFailuresByUserId: Record<string, number>;
  blockedUserIds: string[];
  blockedAtByUserId: Record<string, string>; // ISO timestamp ของเวลาที่ถูกบล็อก (per user)
  pinFailures: number;
  pinBlocked: boolean;
  pinBlockedAt: string | null; // ISO timestamp ของเวลาที่ PIN ถูกบล็อก
};

export const defaultLoginSecurityConfig: LoginSecurityConfig = {
  passwordMaxAttempts: 5,
  pinMaxAttempts: 5,
};

export const defaultLoginSecurityState: LoginSecurityState = {
  passwordFailuresByUserId: {},
  blockedUserIds: [],
  blockedAtByUserId: {},
  pinFailures: 0,
  pinBlocked: false,
  pinBlockedAt: null,
};

function positiveInt(value: unknown, fallback: number) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : fallback;
}

export function parseLoginSecurityConfig(value?: string | null): LoginSecurityConfig {
  try {
    const parsed = value ? JSON.parse(value) : null;
    return {
      passwordMaxAttempts: positiveInt(parsed?.passwordMaxAttempts, defaultLoginSecurityConfig.passwordMaxAttempts),
      pinMaxAttempts: positiveInt(parsed?.pinMaxAttempts, defaultLoginSecurityConfig.pinMaxAttempts),
    };
  } catch {
    return defaultLoginSecurityConfig;
  }
}

export function parseLoginSecurityState(value?: string | null): LoginSecurityState {
  try {
    const parsed = value ? JSON.parse(value) : null;
    return {
      passwordFailuresByUserId: parsed?.passwordFailuresByUserId && typeof parsed.passwordFailuresByUserId === 'object'
        ? parsed.passwordFailuresByUserId
        : {},
      blockedUserIds: Array.isArray(parsed?.blockedUserIds) ? parsed.blockedUserIds.filter((id: unknown) => typeof id === 'string') : [],
      blockedAtByUserId: parsed?.blockedAtByUserId && typeof parsed.blockedAtByUserId === 'object'
        ? parsed.blockedAtByUserId
        : {},
      pinFailures: Math.max(0, Number(parsed?.pinFailures ?? 0) || 0),
      pinBlocked: Boolean(parsed?.pinBlocked),
      pinBlockedAt: typeof parsed?.pinBlockedAt === 'string' ? parsed.pinBlockedAt : null,
    };
  } catch {
    return defaultLoginSecurityState;
  }
}

export function isUserLoginBlocked(userId: string | undefined, state: LoginSecurityState) {
  return Boolean(userId && state.blockedUserIds.includes(userId));
}

export function getBlockedAt(userId: string | undefined, state: LoginSecurityState): string | null {
  if (!userId) return null;
  return state.blockedAtByUserId[userId] ?? null;
}
