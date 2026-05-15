import { useAuthStore } from '../../stores/authStore';
import { API_BASE_URL, hasApiBaseUrl } from './client';

type ServerMessage = { type: 'changes'; syncedAt: string } | { type: 'ping' };

interface SyncWebSocketOptions {
  onChanges: () => void;
}

const MAX_RECONNECT_DELAY = 30_000;

export class SyncWebSocket {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1_000;
  private destroyed = false;
  private readonly onChanges: () => void;

  constructor(options: SyncWebSocketOptions) {
    this.onChanges = options.onChanges;
  }

  connect(): void {
    if (this.destroyed || !hasApiBaseUrl || !navigator.onLine) return;

    const token = useAuthStore.getState().accessToken;
    if (!token) return;

    const deviceId = localStorage.getItem('calpos_device_id') ?? 'unknown';
    const wsBase = API_BASE_URL.replace(/^https?/, (s: string) => (s === 'https' ? 'wss' : 'ws'));
    const url = `${wsBase}/api/sync/ws?token=${encodeURIComponent(token)}&deviceId=${encodeURIComponent(deviceId)}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectDelay = 1_000;
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage;
        if (msg.type === 'changes') this.onChanges();
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      if (!this.destroyed) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY);
      this.connect();
    }, this.reconnectDelay);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}
