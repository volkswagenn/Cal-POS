import type { AuthTokens, User } from '../../types';
import { apiRequest } from './client';

interface AuthResponse {
  user: User;
  tokens: AuthTokens;
}

export const authApi = {
  login(username: string, password: string) {
    return apiRequest<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  loginWithPin(pin: string) {
    return apiRequest<AuthResponse>('/api/auth/pin', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
  },

  refresh(refreshToken: string) {
    return apiRequest<{ tokens: AuthTokens }>('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
  },

  logout(refreshToken?: string | null) {
    return apiRequest<{ ok: true }>('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: refreshToken ?? undefined }),
    });
  },

  me() {
    return apiRequest<{ user: User }>('/api/auth/me');
  },
};
