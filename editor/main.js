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

// --- API de proyecto: abrir una carpeta de proyecto HoneyComb y leer/
// escribir/listar archivos dentro de ella. Todas las rutas que llegan del
// renderer se resuelven relativas a la raiz del proyecto abierto y se
// validan para que no puedan escapar de esa carpeta (el renderer no es
// confiable por definicion, aunque contextIsolation ya limita mucho el
// riesgo -- esto es una segunda barrera barata).
let currentProjectRoot = null;

function resolveInProject(relativeOrAbsolutePath) {
  if (!currentProjectRoot) {
    throw new Error('No hay un proyecto abierto.');
  }
  const target = path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.join(currentProjectRoot, relativeOrAbsolutePath);

  const relative = path.relative(currentProjectRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Ruta fuera del proyecto abierto: ${relativeOrAbsolutePath}`);
  }
  return target;
}

ipcMain.handle('project:openFolder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  if (canceled || filePaths.length === 0) return null;
  currentProjectRoot = filePaths[0];
  return currentProjectRoot;
});

ipcMain.handle('project:readFile', async (_event, relativePath) => {
  const targetPath = resolveInProject(relativePath);
  return fs.readFile(targetPath, 'utf-8');
});

ipcMain.handle('project:writeFile', async (_event, { filePath, contents }) => {
  const targetPath = resolveInProject(filePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, contents, 'utf-8');
});

ipcMain.handle('project:listDir', async (_event, relativeDir) => {
  const targetDir = resolveInProject(relativeDir);
  try {
    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
});
