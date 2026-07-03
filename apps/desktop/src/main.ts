import { app, BrowserWindow, dialog, shell } from 'electron';
// Bundled directly into the Electron main process by esbuild (build-desktop.mjs),
// so the whole server — Express, Socket.IO, UDP discovery, and the embedded web
// UI — runs in-process. No child process, no separate exe.
import { startServer, type RunningServer } from '../../server/src/server';

let running: RunningServer | null = null;
let mainWindow: BrowserWindow | null = null;

/** Minimal inline splash shown while the server boots (< 1s, but avoids a flash). */
const LOADING_PAGE =
  'data:text/html,' +
  encodeURIComponent(`
    <!doctype html><meta charset="utf-8">
    <style>
      html,body{height:100%;margin:0}
      body{display:flex;align-items:center;justify-content:center;flex-direction:column;
        gap:20px;background:#0b1120;color:#e2e8f0;
        font:500 15px/1.4 system-ui,Segoe UI,Roboto,sans-serif}
      .ring{width:44px;height:44px;border:4px solid #1e293b;border-top-color:#38bdf8;
        border-radius:50%;animation:s .8s linear infinite}
      @keyframes s{to{transform:rotate(360deg)}}
    </style>
    <div class="ring"></div><div>Starting LocalDrop…</div>
  `);

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'LocalDrop',
    autoHideMenuBar: true,
    backgroundColor: '#0b1120',
    webPreferences: {
      // We render a trusted local http origin (our own server). Keep the
      // renderer sandboxed — it never needs Node APIs.
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  void win.loadURL(LOADING_PAGE);

  // Open any off-origin links (docs, etc.) in the system browser, not in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

async function bootstrap(): Promise<void> {
  await app.whenReady();
  mainWindow = createWindow();

  try {
    running = await startServer({ openBrowser: false });
  } catch (err) {
    dialog.showErrorBox(
      'LocalDrop failed to start',
      err instanceof Error ? err.message : String(err),
    );
    app.quit();
    return;
  }

  await mainWindow.loadURL(running.url);
}

// Single-instance lock: a second launch just focuses the existing window
// instead of trying to bind the discovery/HTTP ports again.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      if (running) void mainWindow.loadURL(running.url);
    }
  });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', () => {
    void running?.close();
  });

  void bootstrap();
}
