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

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
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

  const payload = response.headers.get('content-type')?.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'message' in payload
      ? String(payload.message)
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
      ? String(payload.message)
      : `API request failed with status ${response.status}`;
    throw new ApiError(message, response.status, payload);
  }

  return {
    blob: await response.blob(),
    fileName: response.headers.get('content-disposition')?.match(/filename="?([^"]+)"?/)?.[1],
  };
}
