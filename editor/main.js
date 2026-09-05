const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const ANGULAR_DEV_SERVER_URL = 'http://localhost:4200';
const ANGULAR_BUILD_INDEX = path.join(__dirname, 'dist/editor/browser/index.html');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged && process.env.ELECTRON_START_URL) {
    win.loadURL(process.env.ELECTRON_START_URL);
  } else if (!app.isPackaged) {
    win.loadURL(ANGULAR_DEV_SERVER_URL);
  } else {
    win.loadFile(ANGULAR_BUILD_INDEX);
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('project:save', async (_event, { defaultPath, contents }) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: defaultPath || 'level.json',
    filters: [{ name: 'HoneyComb Level', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  await fs.writeFile(filePath, contents, 'utf-8');
  return { canceled: false, filePath };
});

ipcMain.handle('project:open', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    filters: [{ name: 'HoneyComb Level', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return { canceled: true };
  const contents = await fs.readFile(filePaths[0], 'utf-8');
  return { canceled: false, filePath: filePaths[0], contents };
});
