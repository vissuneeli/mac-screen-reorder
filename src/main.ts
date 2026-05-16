import { app, BrowserWindow, ipcMain, screen, systemPreferences, dialog, shell, desktopCapturer, Tray, Menu, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';

let mainWindow: BrowserWindow | null = null;

// Active recording sessions for incremental chunk streaming
const activeSessions = new Map<string, { tmpPath: string }>();

// ── Tray state ────────────────────────────────────────────────────────────

let tray: Tray | null = null;
let trayInterval: ReturnType<typeof setInterval> | null = null;
let trayRecState = { isRecording: false, isPaused: false };
let recStartedAt: number | null = null;
let pausedAt: number | null = null;
let pauseAccum = 0;

function buildTrayMenu(): void {
  if (!tray) return;
  if (!trayRecState.isRecording) {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Screen Recorder', enabled: false },
      { type: 'separator' },
      { label: 'Open', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]));
  } else {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: trayRecState.isPaused ? 'Paused' : 'Recording…', enabled: false },
      { type: 'separator' },
      {
        label: trayRecState.isPaused ? 'Resume' : 'Pause',
        click: () => mainWindow?.webContents.send('tray-command', 'toggle-pause'),
      },
      { label: 'Stop Recording', click: () => mainWindow?.webContents.send('tray-command', 'stop') },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]));
  }
}

function refreshTrayTitle(): void {
  if (!tray || !recStartedAt) { tray?.setTitle(''); return; }
  const now = Date.now();
  const frozen = trayRecState.isPaused && pausedAt ? now - pausedAt : 0;
  const ms = Math.max(0, now - recStartedAt - pauseAccum - frozen);
  const s  = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  tray.setTitle(trayRecState.isPaused ? ` ⏸ ${hh}:${mm}:${ss}` : ` ● ${hh}:${mm}:${ss}`);
}

function createTray(): void {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets/tray-icon.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Screen Recorder');
  buildTrayMenu();
  tray.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

function registerTrayHandlers(): void {
  ipcMain.handle('tray-update', (_event, state: { isRecording: boolean; isPaused: boolean }) => {
    const prev = trayRecState;
    trayRecState = state;

    if (!state.isRecording) {
      if (trayInterval) { clearInterval(trayInterval); trayInterval = null; }
      recStartedAt = null; pausedAt = null; pauseAccum = 0;
    } else {
      if (!prev.isRecording) {
        recStartedAt = Date.now(); pauseAccum = 0; pausedAt = null;
      }
      if (state.isPaused && !prev.isPaused) {
        pausedAt = Date.now();
      } else if (!state.isPaused && prev.isPaused && pausedAt) {
        pauseAccum += Date.now() - pausedAt; pausedAt = null;
      }
      if (!trayInterval) trayInterval = setInterval(refreshTrayTitle, 1000);
    }

    refreshTrayTitle();
    buildTrayMenu();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 820,
    resizable: true,
    minWidth: 400,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  try {
    await systemPreferences.askForMediaAccess('microphone');
  } catch { /* ignore */ }

  registerDisplayHandlers();
  registerRecordingHandlers();
  registerFileHandlers();
  registerPermissionHandlers();
  registerTrayHandlers();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => { app.quit(); });

// ── Display handlers ──────────────────────────────────────────────────────

function registerDisplayHandlers() {
  ipcMain.handle('get-displays', () => {
    const displays = screen.getAllDisplays();
    return displays.map((d, i) => ({
      id: `screen:${d.id}`,
      name: displays.length === 1 ? 'Main Display' : `Display ${i + 1}`,
      displayId: String(d.id),
      bounds: d.bounds,
      isPrimary: d.id === screen.getPrimaryDisplay().id,
    }));
  });

  ipcMain.handle('get-desktop-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 280, height: 180 },
      fetchWindowIcons: false,
    });
    return sources.map(s => ({
      id: s.id,
      name: s.name,
      display_id: s.display_id,
      thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
    }));
  });
}

// ── Recording handlers ────────────────────────────────────────────────────

function registerRecordingHandlers() {
  ipcMain.handle('save-recording', (_event, { buffer, filename, folder }: { buffer: ArrayBuffer; filename: string; folder?: string }) => {
    const outputDir = folder || app.getPath('documents');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, filename);
    fs.writeFileSync(outputPath, Buffer.from(buffer));
    return { success: true, path: outputPath };
  });

  ipcMain.handle('stream-chunk', (_event, { sessionId, chunk, folder }: { sessionId: string; chunk: ArrayBuffer; folder?: string }) => {
    const outputDir = folder || app.getPath('documents');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const session = activeSessions.get(sessionId);
    if (!session) {
      const tmpPath = path.join(outputDir, `${sessionId}.tmp`);
      fs.writeFileSync(tmpPath, Buffer.from(chunk));
      activeSessions.set(sessionId, { tmpPath });
    } else {
      fs.appendFileSync(session.tmpPath, Buffer.from(chunk));
    }
    return { success: true };
  });

  ipcMain.handle('finalize-recording', (_event, { sessionId, filename, folder }: { sessionId: string; filename: string; folder?: string }) => {
    const session = activeSessions.get(sessionId);
    if (!session) return { success: false, error: 'Session not found' };
    const outputDir = folder || app.getPath('documents');
    const finalPath = path.join(outputDir, filename);
    try {
      fs.renameSync(session.tmpPath, finalPath);
      activeSessions.delete(sessionId);
      const stats = fs.statSync(finalPath);
      return { success: true, path: finalPath, size: stats.size };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('cleanup-session', (_event, sessionId: string) => {
    const session = activeSessions.get(sessionId);
    if (session) {
      try { if (fs.existsSync(session.tmpPath)) fs.unlinkSync(session.tmpPath); } catch { /* ignore */ }
      activeSessions.delete(sessionId);
    }
  });
}

// ── File handlers ─────────────────────────────────────────────────────────

function registerFileHandlers() {
  ipcMain.handle('check-file', (_event, filePath: string) => {
    return { exists: fs.existsSync(filePath) };
  });

  ipcMain.handle('reveal-file', (_event, filePath: string) => {
    const exists = fs.existsSync(filePath);
    if (exists) shell.showItemInFolder(filePath);
    return { exists };
  });

  ipcMain.handle('delete-file', async (_event, filePath: string) => {
    try {
      if (fs.existsSync(filePath)) {
        await shell.trashItem(filePath);
        return { success: true };
      }
    } catch { /* ignore */ }
    return { success: false };
  });
}

// ── Permission handlers ───────────────────────────────────────────────────

function registerPermissionHandlers() {
  ipcMain.handle('open-screen-privacy-settings', () => {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  });

  ipcMain.handle('pick-output-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: app.getPath('documents'),
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('get-default-output', () => app.getPath('documents'));
}
