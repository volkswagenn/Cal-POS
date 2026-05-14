import { useAuthStore } from '../../stores/authStore';

const rawBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() ?? '';
export const API_BASE_URL = rawBaseUrl.replace(/\/$/, '');
export const hasApiBaseUrl = API_BASE_URL.length > 0;

if (import.meta.env.PROD && hasApiBaseUrl && !API_BASE_URL.startsWith('https://')) {
  throw new Error('VITE_API_BASE_URL must use HTTPS in production');
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload?: unknown,
  ) {
    super(message);
  }
}

let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;

async function tryRefreshToken(): Promise<string | null> {
  if (isRefreshing && refreshPromise) return refreshPromise;

  const { refreshToken, setSession, logout, user } = useAuthStore.getState();
  if (!refreshToken || !user) return null;

  isRefreshing = true;
  refreshPromise = fetch(`${API_BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })
    .then(async (res) => {
      if (!res.ok) { logout(); return null; }
      const data = await res.json() as { accessToken: string; refreshToken: string };
      setSession(user, data);
      return data.accessToken;
    })
    .catch(() => { logout(); return null; })
    .finally(() => { isRefreshing = false; refreshPromise = null; });

  return refreshPromise;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}, _retry = true): Promise<T> {
  if (!hasApiBaseUrl) throw new ApiError('API base URL is not configured', 0);

  const token = useAuthStore.getState().accessToken;
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');

  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (response.status === 401 && _retry) {
    const newToken = await tryRefreshToken();
    if (newToken) return apiRequest<T>(path, init, false);
    throw new ApiError('Unauthorized', 401);
  }

  const payload = response.headers.get('content-type')?.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'message' in payload
      ? String((payload as Record<string, unknown>).message)
      : `API request failed with status ${response.status}`;
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

export async function apiBlobRequest(path: string, init: RequestInit = {}) {
  if (!hasApiBaseUrl) throw new ApiError('API base URL is not configured', 0);

  const token = useAuthStore.getState().accessToken;
  const headers = new Headers(init.headers);

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const payload = response.headers.get('content-type')?.includes('application/json')
      ? await response.json()
      : await response.text();
    const message = typeof payload === 'object' && payload && 'message' in payload
      ? String((payload as Record<string, unknown>).message)
      : `API request failed with status ${response.status}`;
    throw new ApiError(message, response.status, payload);
  }

  return {
    blob: await response.blob(),
    fileName: response.headers.get('content-disposition')?.match(/filename="?([^"]+)"?/)?.[1],
  };
}
