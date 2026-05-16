import { app, BrowserWindow, ipcMain, screen, systemPreferences, dialog, shell, desktopCapturer } from 'electron';
import path from 'path';
import fs from 'fs';

let mainWindow: BrowserWindow | null = null;

// Active recording sessions for incremental chunk streaming
const activeSessions = new Map<string, { tmpPath: string }>();

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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    await systemPreferences.askForMediaAccess('microphone');
  } catch {
    // Ignore
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

ipcMain.handle('open-screen-privacy-settings', () => {
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
});

// Use screen module — no screen recording permission required
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
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false,
  });
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    display_id: source.display_id,
  }));
});

ipcMain.handle('save-recording', async (_event, { buffer, filename, folder }) => {
  const outputDir = folder || app.getPath('documents');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const outputPath = path.join(outputDir, filename);
  fs.writeFileSync(outputPath, Buffer.from(buffer));
  return { success: true, path: outputPath };
});

ipcMain.handle('stream-chunk', (_event, { sessionId, chunk, folder }: { sessionId: string; chunk: ArrayBuffer; folder?: string }) => {
  const outputDir = folder || app.getPath('documents');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
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
    try {
      if (fs.existsSync(session.tmpPath)) fs.unlinkSync(session.tmpPath);
    } catch { /* ignore */ }
    activeSessions.delete(sessionId);
  }
});

ipcMain.handle('pick-output-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: app.getPath('documents'),
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('get-default-output', () => {
  return app.getPath('documents');
});

ipcMain.handle('reveal-file', (_event, filePath: string) => {
  const exists = fs.existsSync(filePath);
  if (exists) shell.showItemInFolder(filePath);
  return { exists };
});

ipcMain.handle('delete-file', async (_event, filePath: string) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return { success: true };
    }
  } catch { /* ignore */ }
  return { success: false };
});
