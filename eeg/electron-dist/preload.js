"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Minimal preload — no node integration needed since we communicate via HTTP/WS
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    platform: process.platform,
});
