// Minimal preload — no node integration needed since we communicate via HTTP/WS
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
});
