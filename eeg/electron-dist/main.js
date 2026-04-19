"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const pythonProcess_1 = require("./pythonProcess");
const PROJECT_ROOT = path.join(__dirname, '..');
const BACKEND_PORT = 8765;
const DEV_MODE = process.env.ELECTRON_DEV === '1';
// Dev: load Vite dev server (port 3000); prod: backend serves built frontend
const RENDERER_URL = DEV_MODE ? 'http://127.0.0.1:3000' : `http://127.0.0.1:${BACKEND_PORT}`;
let win = null;
function createWindow() {
    win = new electron_1.BrowserWindow({
        width: 1280,
        height: 900,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    // Open links in system browser
    win.webContents.setWindowOpenHandler(({ url }) => {
        electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
    // Wait a moment for uvicorn to start, then load
    setTimeout(() => {
        win?.loadURL(RENDERER_URL).catch((e) => {
            console.error('Failed to load renderer:', e);
            setTimeout(() => win?.loadURL(RENDERER_URL).catch(console.error), 2000);
        });
    }, 2500);
}
electron_1.app.whenReady().then(() => {
    (0, pythonProcess_1.startPython)(PROJECT_ROOT);
    createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.app.on('window-all-closed', () => {
    (0, pythonProcess_1.stopPython)();
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
electron_1.app.on('before-quit', () => {
    (0, pythonProcess_1.stopPython)();
});
