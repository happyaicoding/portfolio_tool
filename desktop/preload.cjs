const { contextBridge, ipcRenderer } = require('electron');

// 只暴露三個明確的功能給網頁,不開放 Node 或任意檔案存取
contextBridge.exposeInMainWorld('desktop', {
  getFolder: () => ipcRenderer.invoke('folder:get'),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  readFolder: () => ipcRenderer.invoke('folder:read'),
  onFolderChanged: (cb) => ipcRenderer.on('folder:changed', () => cb()),
});
