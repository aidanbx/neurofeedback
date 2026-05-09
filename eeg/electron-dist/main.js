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
const http = __importStar(require("http"));
const path = __importStar(require("path"));
const appConfig_1 = require("./appConfig");
const pythonProcess_1 = require("./pythonProcess");
const PROJECT_ROOT = path.join(__dirname, '..');
const DEV_MODE = process.env.ELECTRON_DEV === '1';
const DIST_INDEX = path.join(PROJECT_ROOT, 'dist', 'index.html');
let win = null;
function canReach(url) {
    return new Promise((resolve) => {
        const req = http.get(url, (res) => {
            res.resume();
            resolve(true);
        });
        req.setTimeout(500, () => {
            req.destroy();
            resolve(false);
        });
        req.on('error', () => resolve(false));
    });
}
async function loadDevServer() {
    for (let attempt = 1; attempt <= 60; attempt += 1) {
        if (await canReach(appConfig_1.DEV_SERVER_URL)) {
            await win?.loadURL(appConfig_1.DEV_SERVER_URL);
            return;
        }
        if (attempt === 1) {
            console.log(`[electron] waiting for Vite dev server at ${appConfig_1.DEV_SERVER_URL}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    console.error(`[electron] Vite dev server was not reachable at ${appConfig_1.DEV_SERVER_URL}. Run "cd frontend && npm run dev" first.`);
}
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
    if (DEV_MODE) {
        // Hot-reload via Vite dev server (run `npm run dev` in frontend/ separately)
        loadDevServer().catch(console.error);
    }
    else {
        // Load built static files directly — no web server needed for the UI
        win?.loadFile(DIST_INDEX).catch(console.error);
    }
}
electron_1.app.whenReady().then(() => {
    if (!DEV_MODE)
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
