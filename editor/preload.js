// Puente entre el proceso principal (main.js, con acceso a disco) y la UI de
// Angular, que corre aislada. Es el UNICO lugar donde se decide que puede
// hacer el renderer: cada funcion de aca es un permiso concedido a mano.
//
// Se exponen funciones, nunca "ipcRenderer" entero ni "require": si la UI
// pudiera invocar cualquier canal, el aislamiento no serviria de nada.
//
// El contrato tipado de esta API vive en src/app/electron-api.d.ts, y quien la
// consume es ProjectService. Los tres archivos tienen que cambiar juntos.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('honeycombProject', {
  save: (defaultPath, contents) => ipcRenderer.invoke('project:save', { defaultPath, contents }),
  open: () => ipcRenderer.invoke('project:open'),

  openFolder: () => ipcRenderer.invoke('project:openFolder'),
  readFile: (relativePath) => ipcRenderer.invoke('project:readFile', relativePath),
  writeFile: (relativePath, contents) =>
    ipcRenderer.invoke('project:writeFile', { filePath: relativePath, contents }),
  listDir: (relativeDir) => ipcRenderer.invoke('project:listDir', relativeDir),
});
