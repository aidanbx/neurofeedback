import type { StreamMessage } from '../contracts';

type Listener = (msg: StreamMessage) => void;

class EEGWebSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    // From file:// (Electron prod), connect directly to backend
    const url = window.location.protocol === 'file:'
      ? 'ws://127.0.0.1:8765/ws/stream'
      : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/stream`;
    this.ws = new WebSocket(url);
    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as StreamMessage;
        this.listeners.forEach((fn) => fn(msg));
      } catch {}
    };
    this.ws.onclose = () => {
      this.reconnectTimer = setTimeout(() => this.connect(), 2000);
    };
    this.ws.onerror = () => this.ws?.close();
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const eegWS = new EEGWebSocket();
