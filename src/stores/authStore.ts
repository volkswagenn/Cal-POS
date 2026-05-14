import { create } from 'zustand';
import type { AuthTokens, User } from '../types';

// localStorage: session คงอยู่จนกว่าจะกด logout — เหมาะสำหรับ POS ที่เปิดค้างไว้ทั้งวัน
const SESSION_KEY = 'calpos_active_session';

interface AuthState {
  user: User | null;
  loginTime: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: string | null;
  setSession: (user: User, tokens?: AuthTokens) => void;
  logout: () => void;
  isTokenExpired: () => boolean;
}

function getTokenExpiresAt(accessToken?: string) {
  if (!accessToken) return null;

  try {
    const payload = JSON.parse(atob(accessToken.split('.')[1] ?? ''));
    return typeof payload.exp === 'number' ? new Date(payload.exp * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

function emptySession() {
  return { user: null, loginTime: null, accessToken: null, refreshToken: null, tokenExpiresAt: null };
}

function loadSession(): Pick<AuthState, 'user' | 'loginTime' | 'accessToken' | 'refreshToken' | 'tokenExpiresAt'> {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? { ...emptySession(), ...JSON.parse(raw) } : emptySession();
  } catch {
    return emptySession();
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  ...loadSession(),
  setSession: (user, tokens) => {
    const loginTime = new Date().toISOString();
    const session = {
      user,
      loginTime,
      accessToken: tokens?.accessToken ?? null,
      refreshToken: tokens?.refreshToken ?? null,
      tokenExpiresAt: getTokenExpiresAt(tokens?.accessToken),
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    set(session);
  },
  logout: () => {
    localStorage.removeItem(SESSION_KEY);
    set(emptySession());
  },
  isTokenExpired: () => {
    const expiresAt = get().tokenExpiresAt;
    return Boolean(expiresAt && Date.now() >= new Date(expiresAt).getTime());
  },
}));
