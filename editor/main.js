// =============================================================================
// HoneyComb Engine - Editor (proceso principal de Electron)
// =============================================================================
//
// Este es el unico proceso con acceso real al disco. La UI (Angular) corre en
// el proceso "renderer", aislado en un sandbox de navegador, y no puede tocar
// archivos: le pide todo a este por IPC.
//
//   Angular (app.ts)  ->  ProjectService  ->  window.honeycombProject
//                                                    |  (contextBridge)
//                                              preload.js
//                                                    |  (ipcRenderer.invoke)
//                                              este archivo  ->  disco
//
// Ese ida y vuelta parece rebuscado, pero es lo que permite tener
// contextIsolation activado: la UI nunca ve "require" ni el modulo fs, asi que
// un bug (o un nivel malicioso) no puede escribir donde se le antoje.
// =============================================================================

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');

const ANGULAR_DEV_SERVER_URL = 'http://localhost:4200';
const ANGULAR_BUILD_INDEX = path.join(__dirname, 'dist/editor/browser/index.html');

// Pantalla de diagnostico: sin esto, un dev server caido deja la ventana en
// blanco sin ninguna pista de que fue lo que fallo.
function diagnosticPage(reason) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>HoneyComb Engine</title></head>
<body style="margin:0;padding:40px;background:#14171d;color:#c7cdd8;
             font:14px/1.6 'Segoe UI',system-ui,sans-serif">
  <h1 style="margin:0 0 6px;color:#f5a623;font-size:20px">⬢ HoneyComb Engine — Editor</h1>
  <p style="color:#79818f;margin:0 0 24px">No se pudo cargar la interfaz.</p>
  <p style="background:#1e222a;border-left:3px solid #e05a5a;padding:10px 14px;
            font-family:ui-monospace,monospace;font-size:12px">${reason}</p>
  <p>Hay dos formas de abrir el editor:</p>
  <ol>
    <li><b>Con recarga en vivo</b> — deja <code>npm start</code> corriendo en otra
        terminal y volve a abrir <code>npm run electron</code>.</li>
    <li><b>Sin dev server</b> — compila una vez con <code>npm run build</code>;
        esta ventana usara <code>dist/</code> automaticamente.</li>
  </ol>
  <p style="color:#79818f;font-size:12px">Si <code>npm</code> falla en PowerShell con
     "la ejecucion de scripts esta deshabilitada", corre una sola vez:
     <code style="color:#f5a623">Set-ExecutionPolicy -Scope CurrentUser RemoteSigned</code></p>
</body></html>`;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#14171d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Las dos banderas de seguridad estandar de Electron. Con esto, el codigo
      // de Angular solo ve lo que preload.js decide exponer: nada de require(),
      // nada de fs, nada de acceso directo a Node.
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Los errores del renderer (Angular) no llegan solos a esta consola: sin
  // esto, un fallo al arrancar la UI se ve como una ventana vacia.
  win.webContents.on('console-message', (...args) => {
    const details = typeof args[0] === 'object' && args[0] !== null && 'message' in args[0]
      ? args[0]
      : { level: args[1], message: args[2], lineNumber: args[3], sourceId: args[4] };
    const level = String(details.level);
    if (level === 'error' || level === '3' || level === '2') {
      console.error(`[renderer] ${details.message} (${details.sourceId}:${details.lineNumber})`);
    }
  });

  if (process.env.HONEYCOMB_DEVTOOLS) {
    win.webContents.openDevTools({ mode: 'right' });
  }

  // Si el dev server no responde, caemos al build de dist/ y, si tampoco
  // existe, mostramos que hacer en vez de una ventana vacia.
  win.webContents.on('did-fail-load', (_event, _code, description, url, isMainFrame) => {
    if (!isMainFrame || url.startsWith('file://') || url.startsWith('data:')) {
      return;
    }
    if (fsSync.existsSync(ANGULAR_BUILD_INDEX)) {
      console.warn(`[honeycomb] ${url} no respondio; usando dist/.`);
      win.loadFile(ANGULAR_BUILD_INDEX);
      return;
    }
    console.error(`[honeycomb] ${url} no respondio y no hay build en dist/.`);
    win.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(diagnosticPage(`${description} — ${url}`)),
    );
  });

  // De donde sale la UI, en orden de preferencia:
  //   1. ELECTRON_START_URL  - lo pone scripts/dev.js al arrancar con "npm run dev"
  //   2. localhost:4200      - un "ng serve" levantado a mano en otra terminal
  //   3. dist/               - la app ya empaquetada, sin dev server
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
  // En macOS lo normal es que la app siga viva sin ventanas (queda en el Dock);
  // en Windows y Linux, cerrar la ultima ventana cierra la aplicacion.
  if (process.platform !== 'darwin') app.quit();
});

// --- Guardar/abrir sueltos, con dialogo del sistema ------------------------
// Estos dos no dependen de que haya un proyecto abierto: el usuario elige el
// archivo a mano en el dialogo, y esa eleccion es la autorizacion.

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

// Convierte una ruta que llego del renderer en una ruta absoluta dentro del
// proyecto, o tira error si se sale de el. La comprobacion es sobre el
// resultado de path.relative(): si empieza con ".." o quedo absoluta, el
// destino esta afuera. Asi se frenan tanto "../../etc/passwd" como una ruta
// absoluta a otro disco.
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
  // mkdir recursivo: guardar el primer nivel de un proyecto recien creado no
  // deberia fallar solo porque todavia no existe la carpeta levels/.
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, contents, 'utf-8');
});

ipcMain.handle('project:listDir', async (_event, relativeDir) => {
  const targetDir = resolveInProject(relativeDir);
  try {
    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    // Solo archivos: el editor lista niveles y texturas, no navega carpetas.
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch (err) {
    // Una carpeta que no existe es un caso normal (un proyecto sin texturas
    // todavia), no un error: se devuelve vacio y la UI muestra el panel vacio.
    if (err.code === 'ENOENT') return [];
    throw err;
  }
});
