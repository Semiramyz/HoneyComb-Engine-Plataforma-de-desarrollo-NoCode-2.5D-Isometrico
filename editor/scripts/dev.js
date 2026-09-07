// Arranca el dev server de Angular y, cuando responde, abre Electron apuntando
// a el. Existe para no depender de dos terminales sincronizadas a mano: lanzar
// Electron antes de que "ng serve" este listo daba ERR_CONNECTION_REFUSED.
//
// Uso: npm run dev    (Ctrl+C cierra las dos cosas)

const { spawn } = require('node:child_process');
const http = require('node:http');

const PORT = Number(process.env.HONEYCOMB_PORT || 4200);
const DEV_URL = `http://localhost:${PORT}`;
const READY_TIMEOUT_MS = 120000;

const children = [];
let shuttingDown = false;

function run(command, args, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  // Una clave en undefined llegaria al hijo como el string "undefined", que
  // para ELECTRON_RUN_AS_NODE cuenta como activado. Hay que borrarla.
  for (const key of Object.keys(env)) {
    if (env[key] === undefined) {
      delete env[key];
    }
  }

  const child = spawn(command, args, {
    stdio: 'inherit',
    // En Windows "ng" y "electron" son .cmd: sin shell, spawn no los encuentra.
    shell: process.platform === 'win32',
    env,
  });
  children.push(child);
  return child;
}

function killTree(child) {
  if (!child.pid || child.killed) {
    return;
  }
  if (process.platform === 'win32') {
    // child.kill() deja vivos a los nietos (ng serve levanta su propio node).
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function shutdown(code) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    killTree(child);
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function ping(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(true);
    });
    request.on('error', () => resolve(false));
    request.setTimeout(2000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForServer() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (shuttingDown) {
      return false;
    }
    if (await ping(DEV_URL)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function main() {
  // Un "ng serve" de una corrida anterior puede haber quedado vivo (si se
  // cerro la terminal en vez de Ctrl+C). Reusarlo evita el choque de puerto.
  if (await ping(DEV_URL)) {
    console.log(`[honeycomb] ya hay un dev server en ${DEV_URL}, lo reuso.`);
  } else {
    console.log(`[honeycomb] levantando el dev server en ${DEV_URL} ...`);
    const server = run('npx', ['ng', 'serve', '--port', String(PORT)]);
    server.on('exit', (code) => {
      if (!shuttingDown) {
        console.error(`[honeycomb] el dev server termino (codigo ${code}).`);
        shutdown(code ?? 1);
      }
    });

    if (!(await waitForServer())) {
      console.error('[honeycomb] el dev server no respondio a tiempo.');
      shutdown(1);
      return;
    }
  }

  console.log('[honeycomb] dev server listo, abriendo Electron ...');
  // VS Code exporta ELECTRON_RUN_AS_NODE=1 en su terminal integrada, y eso
  // hace que Electron arranque como Node puro ("app is undefined").
  const electron = run('npx', ['electron', '.'], {
    ELECTRON_START_URL: DEV_URL,
    ELECTRON_RUN_AS_NODE: undefined,
  });
  electron.on('exit', (code) => shutdown(code ?? 0));
}

main();
