import { app, BrowserWindow, ipcMain, screen, systemPreferences, dialog, shell, desktopCapturer } from 'electron';
import path from 'path';
import fs from 'fs';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 660,
    resizable: false,
    titleBarStyle: 'hiddenInset',
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

ipcMain.handle('save-recording', async (_event, { buffer, filename }) => {
  const documentsPath = app.getPath('documents');
  const outputPath = path.join(documentsPath, filename);
  fs.writeFileSync(outputPath, Buffer.from(buffer));
  return { success: true, path: outputPath };
});

ipcMain.handle('pick-save-location', async () => {
  const result = await dialog.showSaveDialog({
    defaultPath: path.join(app.getPath('documents'), `recording-${Date.now()}.webm`),
    filters: [{ name: 'Video', extensions: ['webm'] }],
  });
  return result.canceled ? null : result.filePath;
});
