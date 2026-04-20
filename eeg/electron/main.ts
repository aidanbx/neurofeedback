import { app, BrowserWindow, shell } from 'electron';
import * as path from 'path';
import { startPython, stopPython } from './pythonProcess';

const PROJECT_ROOT = path.join(__dirname, '..');
const DEV_MODE = process.env.ELECTRON_DEV === '1';
const DIST_INDEX = path.join(PROJECT_ROOT, 'dist', 'index.html');

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

  if (DEV_MODE) {
    // Hot-reload via Vite dev server (run `npm run dev` in frontend/ separately)
    setTimeout(() => win?.loadURL('http://127.0.0.1:3000').catch(console.error), 1000);
  } else {
    // Load built static files directly — no web server needed for the UI
    win?.loadFile(DIST_INDEX).catch(console.error);
  }
}

app.whenReady().then(() => {
  if (!DEV_MODE) startPython(PROJECT_ROOT);
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
