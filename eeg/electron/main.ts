import { app, BrowserWindow, shell } from 'electron';
import * as path from 'path';
import { startPython, stopPython } from './pythonProcess';

const PROJECT_ROOT = path.join(__dirname, '..');
const BACKEND_PORT = 8765;
const DEV_MODE = process.env.ELECTRON_DEV === '1';
// Dev: load Vite dev server (port 3000); prod: backend serves built frontend
const RENDERER_URL = DEV_MODE ? 'http://127.0.0.1:3000' : `http://127.0.0.1:${BACKEND_PORT}`;

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width:  1280,
    height: 900,
    webPreferences: {
      preload:        path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Open links in system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
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

app.whenReady().then(() => {
  startPython(PROJECT_ROOT);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopPython();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopPython();
});
