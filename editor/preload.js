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
