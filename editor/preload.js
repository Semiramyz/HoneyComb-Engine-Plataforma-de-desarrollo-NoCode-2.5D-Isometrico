const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('honeycombProject', {
  save: (defaultPath, contents) => ipcRenderer.invoke('project:save', { defaultPath, contents }),
  open: () => ipcRenderer.invoke('project:open'),
});
