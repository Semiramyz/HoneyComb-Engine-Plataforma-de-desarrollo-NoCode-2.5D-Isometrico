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

const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { spawn } = require('node:child_process');

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
  // Sin el menu nativo ("File Edit View Window"): el editor dibuja su propia
  // barra de menus, y con las dos habria dos filas de menus que no se hablan.
  // Lo util que traia el nativo (recargar, herramientas de desarrollo) esta en
  // el menu Ver del editor.
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// La ventana que pidio el cambio, y no "la primera": si algun dia hay dos, las
// herramientas se abren en la que se esta usando.
ipcMain.handle('window:toggleDevTools', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.webContents.toggleDevTools();
});

app.on('window-all-closed', () => {
  // En macOS lo normal es que la app siga viva sin ventanas (queda en el Dock);
  // en Windows y Linux, cerrar la ultima ventana cierra la aplicacion.
  if (process.platform !== 'darwin') app.quit();
});

// --- Guardar/abrir sueltos, con dialogo del sistema ------------------------
// Estos dos no dependen de que haya un proyecto abierto: el usuario elige el
// archivo a mano en el dialogo, y esa eleccion es la autorizacion.

/**
 * Ultimo nivel abierto o guardado por dialogo. Sirve para deducir la carpeta
 * del proyecto cuando nadie la abrio a mano (ver inferProjectRoot).
 */
let lastLevelPath = null;

ipcMain.handle('project:save', async (_event, { defaultPath, contents }) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: defaultPath || 'level.json',
    filters: [{ name: 'HoneyComb Level', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  await fs.writeFile(filePath, contents, 'utf-8');
  lastLevelPath = filePath;
  return { canceled: false, filePath };
});

ipcMain.handle('project:open', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    filters: [{ name: 'HoneyComb Level', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return { canceled: true };
  const contents = await fs.readFile(filePaths[0], 'utf-8');
  lastLevelPath = filePaths[0];
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

// --- Explorador de archivos -------------------------------------------------
//
// El explorador de la izquierda muestra la carpeta del proyecto entera, como el
// de VS Code. Se lee UNA CARPETA POR VEZ, cuando se la despliega, y no el arbol
// completo de una: recorrer en profundidad al abrir el proyecto significaria
// entrar en node_modules (decenas de miles de archivos) y dejar la ventana
// congelada varios segundos antes de mostrar nada. Con carga perezosa cada
// despliegue cuesta un readdir y no se esconde ninguna carpeta.
//
// project:listDir sigue existiendo aparte, para los listados planos que piden
// el desplegable de niveles y el panel de Recursos.

ipcMain.handle('project:listEntries', async (_event, relativeDir) => {
  if (!currentProjectRoot) {
    return [];
  }
  const targetDir = resolveInProject(relativeDir || '.');
  let entries;
  try {
    entries = await fs.readdir(targetDir, { withFileTypes: true });
  } catch (err) {
    // Una carpeta que ya no esta (la borraron por fuera) no es motivo para
    // romper el explorador entero: esa rama queda vacia y el resto sigue.
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return [];
    throw err;
  }

  const nodes = [];
  for (const entry of entries) {
    // Barras normales siempre: estas rutas viajan a la UI, que las compara
    // contra prefijos como "levels/", y eso no puede depender del separador
    // de Windows.
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      nodes.push({ name: entry.name, path: relativePath, kind: 'dir' });
    } else if (entry.isFile()) {
      nodes.push({ name: entry.name, path: relativePath, kind: 'file' });
    }
  }

  // Carpetas primero y alfabetico dentro de cada grupo, como cualquier
  // explorador: el orden en que readdir devuelve las entradas depende del
  // sistema de archivos y no es el que una persona espera leer.
  nodes.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
  return nodes;
});

// --- Leer un archivo cualquiera para mirarlo --------------------------------
//
// project:readFile devuelve texto crudo y sirve para los .json que el editor
// entiende. Este handler es para MIRAR cualquier archivo del proyecto: decide
// por extension si se puede mostrar como texto, como imagen o si no se puede
// mostrar, y corta lo que sea demasiado grande para meter en una ventana.

const TEXT_FILE_NAMES = new Set([
  '.gitignore', '.gitattributes', '.editorconfig', '.prettierrc', 'license', 'makefile',
]);
const TEXT_EXTENSIONS = new Set([
  '.json', '.md', '.txt', '.ts', '.js', '.mjs', '.cjs', '.html', '.css', '.scss', '.cpp',
  '.hpp', '.h', '.c', '.cc', '.cmake', '.yml', '.yaml', '.xml', '.svg', '.puml', '.cmd',
  '.sh', '.bat', '.ps1', '.log', '.csv', '.ini', '.toml', '.gitignore',
]);
const IMAGE_MIME_TYPES = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'], ['.bmp', 'image/bmp'], ['.webp', 'image/webp'],
]);

/** Tope del texto que se manda a la UI. De sobra para leer un archivo, y evita mandar un log de 50 MB. */
const TEXT_PREVIEW_LIMIT = 400 * 1024;
/**
 * Tope de imagen para el visor. En base64 ocupa un tercio mas y viaja entera
 * dentro de un data: URL; 25 MB cubre de sobra una captura 4K en PNG.
 */
const IMAGE_PREVIEW_LIMIT = 25 * 1024 * 1024;

// --- Importar una carpeta de imagenes como texturas -------------------------
//
// Las imagenes se COPIAN dentro de assets/textures/ del proyecto en vez de
// referenciarse donde estan: el nivel guarda rutas relativas a assets/ y el
// motor las resuelve contra esa carpeta (ver AssetResolver), asi que una
// textura que viva fuera del proyecto se veria en el editor y saldria en negro
// al ejecutar.
//
// Y se copian AJUSTADAS: el motor dibuja cada sprite al tamano de su recorte,
// uno a uno, asi que una captura de 2377x1837 px ocuparia decenas de celdas
// (los requisitos estan en src/app/core/texture-fit.ts).
//
// Va en tres pasos porque el ajuste lo hace la UI y no este proceso: hay que
// decodificar la imagen, y el navegador decodifica PNG, JPG, GIF, WebP y BMP,
// mientras que el nativeImage de Electron solo garantiza PNG y JPG.
//
//   1. project:beginImport           elige las carpetas y arma el plan
//   2. project:readImportImage       la UI pide cada original, de a uno
//   3. project:writeImportedTexture  y devuelve el PNG ajustado para escribir
//
// El plan queda guardado ACA, y los pasos 2 y 3 reciben solo un indice: la UI
// nunca elige una ruta, asi que no puede leer ni pisar nada fuera de lo que la
// persona eligio en los dialogos.

let importSession = null;
/** Tope del original que se acepta importar. */
const IMAGE_IMPORT_LIMIT = 40 * 1024 * 1024;

/**
 * La raiz del proyecto cuando nadie abrio una a mano. Antes Importar se negaba
 * de entrada sin carpeta de proyecto, y habia que ir a buscarla primero.
 *
 * Se prueba en orden: la carpeta del ultimo nivel abierto o guardado (un nivel
 * vive en <raiz>/levels/), y despues el repositorio del propio editor, que
 * corriendo desde el codigo esta en <raiz>/editor. Solo cuenta una carpeta con
 * pinta de proyecto HoneyComb, o sea con assets/ o levels/ adentro.
 */
function inferProjectRoot() {
  const candidates = [];
  if (lastLevelPath && path.basename(path.dirname(lastLevelPath)).toLowerCase() === 'levels') {
    candidates.push(path.dirname(path.dirname(lastLevelPath)));
  }
  if (!app.isPackaged) {
    candidates.push(path.dirname(__dirname));
  }
  return (
    candidates.find(
      (dir) =>
        fsSync.existsSync(path.join(dir, 'assets')) || fsSync.existsSync(path.join(dir, 'levels')),
    ) ?? null
  );
}

/** true si los dos archivos tienen exactamente los mismos bytes. */
async function sameContents(a, b) {
  const [statA, statB] = await Promise.all([fs.stat(a), fs.stat(b)]);
  if (statA.size !== statB.size) return false;
  const [bytesA, bytesB] = await Promise.all([fs.readFile(a), fs.readFile(b)]);
  return bytesA.equals(bytesB);
}

/**
 * La raiz del proyecto para algo que necesita escribir en el: la ya abierta,
 * la deducida (ver inferProjectRoot), o -- solo si no hay forma de deducirla --
 * la que se elija en un dialogo. Null si se cancela ese dialogo.
 */
async function ensureProjectRoot(title) {
  if (!currentProjectRoot) {
    currentProjectRoot = inferProjectRoot();
  }
  if (!currentProjectRoot) {
    const project = await dialog.showOpenDialog({ title, properties: ['openDirectory'] });
    if (project.canceled || project.filePaths.length === 0) return null;
    currentProjectRoot = project.filePaths[0];
  }
  return currentProjectRoot;
}

ipcMain.handle('project:ensureRoot', () =>
  ensureProjectRoot('Elegi la carpeta del proyecto (donde estan levels/ y assets/)'),
);

ipcMain.handle('project:beginImport', async () => {
  // Solo si no se pudo deducir se pregunta, y en el mismo gesto: el dialogo de
  // la carpeta de imagenes viene justo despues, sin volver a tocar Importar.
  if (!(await ensureProjectRoot('Elegi la carpeta del proyecto (las imagenes van a su assets/textures)'))) {
    return null;
  }

  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Elegi la carpeta con las imagenes',
    properties: ['openDirectory'],
  });
  // La raiz se devuelve igual: pudo haberse deducido recien, y la UI tiene que
  // enterarse aunque la persona cancele el segundo dialogo.
  if (canceled || filePaths.length === 0) {
    return { projectRoot: currentProjectRoot, canceled: true };
  }

  const folder = filePaths[0];
  const targetFolder = path.join(currentProjectRoot, 'assets', 'textures');
  await fs.mkdir(targetFolder, { recursive: true });

  const entries = await fs.readdir(folder, { withFileTypes: true });
  const items = [];
  for (const entry of entries) {
    const extension = path.extname(entry.name).toLowerCase();
    if (!entry.isFile() || !IMAGE_MIME_TYPES.has(extension)) continue;

    // Todo sale como PNG: es el formato que el motor carga seguro.
    const target = path.basename(entry.name, extension) + '.png';
    const sourcePath = path.join(folder, entry.name);
    const targetPath = path.join(targetFolder, target);

    //   new     no hay nada con ese nombre
    //   stale   hay una copia CRUDA de esta misma imagen, byte a byte, que dejo
    //           una importacion vieja que no ajustaba el tamano: se puede
    //           reemplazar por la version ajustada sin perder nada
    //   exists  hay OTRA imagen con ese nombre, y esa no se pisa
    let status = 'new';
    if (fsSync.existsSync(targetPath)) {
      status = (await sameContents(sourcePath, targetPath)) ? 'stale' : 'exists';
    }
    items.push({ source: entry.name, target, status });
  }

  importSession = { folder, targetFolder, items };
  return { projectRoot: currentProjectRoot, canceled: false, folder, items };
});

function importItem(index) {
  const item = importSession?.items[index];
  if (!item) {
    throw new Error('La importacion ya no esta activa. Volve a empezarla.');
  }
  return item;
}

ipcMain.handle('project:readImportImage', async (_event, index) => {
  const item = importItem(index);
  const sourcePath = path.join(importSession.folder, item.source);
  const stats = await fs.stat(sourcePath);
  if (stats.size > IMAGE_IMPORT_LIMIT) {
    throw new Error(`${item.source} pesa demasiado para importarla.`);
  }
  const bytes = await fs.readFile(sourcePath);
  const mimeType = IMAGE_MIME_TYPES.get(path.extname(item.source).toLowerCase());
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
});

// pngBase64 en null significa "copiar el original tal cual", y solo se acepta
// para un PNG: cualquier otro formato tiene que llegar convertido, o quedaria
// un JPG con extension .png que el motor no sabria abrir.
ipcMain.handle('project:writeImportedTexture', async (_event, { index, pngBase64 }) => {
  const item = importItem(index);
  if (item.status === 'exists') {
    return { written: false };
  }

  const sourcePath = path.join(importSession.folder, item.source);
  if (pngBase64 === null && path.extname(item.source).toLowerCase() !== '.png') {
    throw new Error(`${item.source} no es PNG: tiene que convertirse antes de copiarse.`);
  }
  const bytes =
    pngBase64 === null ? await fs.readFile(sourcePath) : Buffer.from(pngBase64, 'base64');

  try {
    // "wx" falla si el archivo ya existe: dos imagenes de la carpeta que salen
    // con el mismo nombre (sprite.jpg y sprite.png) no se pisan entre si. Solo
    // una copia cruda vieja ("stale") se sobrescribe.
    await fs.writeFile(path.join(importSession.targetFolder, item.target), bytes, {
      flag: item.status === 'stale' ? 'w' : 'wx',
    });
    return { written: true };
  } catch (err) {
    if (err.code === 'EEXIST') return { written: false };
    throw err;
  }
});

ipcMain.handle('project:readFileData', async (_event, relativePath) => {
  const targetPath = resolveInProject(relativePath);
  const stats = await fs.stat(targetPath);
  const extension = path.extname(targetPath).toLowerCase();
  const name = path.basename(targetPath).toLowerCase();

  const mimeType = IMAGE_MIME_TYPES.get(extension);
  if (mimeType) {
    if (stats.size > IMAGE_PREVIEW_LIMIT) {
      return { kind: 'binary', size: stats.size, reason: 'too-large' };
    }
    const bytes = await fs.readFile(targetPath);
    return {
      kind: 'image',
      size: stats.size,
      dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
    };
  }

  if (!TEXT_EXTENSIONS.has(extension) && !TEXT_FILE_NAMES.has(name)) {
    return { kind: 'binary', size: stats.size, reason: 'unsupported' };
  }

  // Se lee solo el principio y no el archivo entero: un .log grande no tiene
  // por que entrar en memoria para ver sus primeras lineas.
  const handle = await fs.open(targetPath, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(stats.size, TEXT_PREVIEW_LIMIT));
    await handle.read(buffer, 0, buffer.length, 0);
    return {
      kind: 'text',
      size: stats.size,
      text: buffer.toString('utf-8'),
      truncated: stats.size > buffer.length,
    };
  } finally {
    await handle.close();
  }
});

// --- Ejecutar el nivel en el runtime ----------------------------------------
//
// Lanza engine.exe con el nivel abierto, que es el equivalente a hacer a mano:
//
//     engine\build\engine.exe  C:\...\levels\mi_nivel.json
//
// Se le pasa la ruta ABSOLUTA del nivel a proposito. El motor deduce de ella
// donde estan los assets (assetsRoot = <nivel>/../../assets, ver main.cpp), asi
// que con la ruta completa encuentra las texturas sin importar desde donde se
// lo haya lanzado.

/**
 * Busca el ejecutable del motor a partir de la ruta del nivel.
 *
 * Se usa la MISMA convencion de carpetas que ya usa el motor para los assets:
 * un nivel vive en <raiz>/levels/, asi que la raiz es su abuelo. Deducirlo de
 * ahi hace que Ejecutar funcione aunque no se haya abierto una carpeta de
 * proyecto en el editor; si aun asi no aparece, se prueba con esa carpeta.
 */
function findEngineExecutable(levelPath) {
  const exeName = process.platform === 'win32' ? 'engine.exe' : 'engine';
  const roots = [path.dirname(path.dirname(levelPath)), currentProjectRoot].filter(Boolean);

  for (const root of roots) {
    const candidate = path.join(root, 'engine', 'build', exeName);
    if (fsSync.existsSync(candidate)) return candidate;
  }
  return null;
}

ipcMain.handle('project:run', async (_event, levelPath) => {
  if (!levelPath) {
    return { ok: false, error: 'No hay un nivel guardado para ejecutar.' };
  }
  if (!fsSync.existsSync(levelPath)) {
    return { ok: false, error: `No se encontro el nivel: ${levelPath}` };
  }

  const executable = findEngineExecutable(levelPath);
  if (!executable) {
    return {
      ok: false,
      error: 'No se encontro engine/build/engine.exe. Compila el motor antes de ejecutar.',
    };
  }

  // cwd en la carpeta del ejecutable: ahi viven las DLL (SDL2, libstdc++) que
  // Windows busca al lado del .exe.
  //
  // detached + unref: el juego es un proceso aparte con su propia ventana, y
  // no debe morir si se cierra el editor ni bloquear este handler.
  const child = spawn(executable, [levelPath], {
    cwd: path.dirname(executable),
    detached: true,
    stdio: 'ignore',
  });

  // Si el binario no arranca (permisos, DLL faltante) el fallo llega por este
  // evento y no como excepcion de spawn(); sin el, el error se perderia.
  let spawnError = null;
  child.on('error', (err) => {
    spawnError = err;
    console.error('[honeycomb] no se pudo ejecutar el motor:', err.message);
  });

  child.unref();

  // Un respiro corto para poder informar el fallo inmediato (ENOENT, EACCES)
  // en vez de decir "lanzado" cuando en realidad no arranco.
  await new Promise((resolve) => setTimeout(resolve, 120));
  if (spawnError) {
    return { ok: false, error: `No se pudo ejecutar el motor: ${spawnError.message}` };
  }

  return { ok: true, executable };
});
