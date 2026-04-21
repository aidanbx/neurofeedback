import { app, BrowserWindow, shell } from 'electron';
import * as http from 'http';
import * as path from 'path';
import { startPython, stopPython } from './pythonProcess';

const PROJECT_ROOT = path.join(__dirname, '..');
const DEV_MODE = process.env.ELECTRON_DEV === '1';
const DIST_INDEX = path.join(PROJECT_ROOT, 'dist', 'index.html');
const DEV_SERVER_URL = 'http://127.0.0.1:3000';

let win: BrowserWindow | null = null;

function canReach(url: string): Promise<boolean> {
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
    if (await canReach(DEV_SERVER_URL)) {
      await win?.loadURL(DEV_SERVER_URL);
      return;
    }
    if (attempt === 1) {
      console.log(`[electron] waiting for Vite dev server at ${DEV_SERVER_URL}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.error(`[electron] Vite dev server was not reachable at ${DEV_SERVER_URL}. Run "cd frontend && npm run dev" first.`);
}

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
    loadDevServer().catch(console.error);
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
