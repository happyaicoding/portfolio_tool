const { contextBridge, ipcRenderer } = require('electron');

// 只暴露明確列出的功能給網頁,不開放 Node 或任意檔案存取
contextBridge.exposeInMainWorld('desktop', {
  getFolder: () => ipcRenderer.invoke('folder:get'),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  readFolder: () => ipcRenderer.invoke('folder:read'),
  onFolderChanged: (cb) => ipcRenderer.on('folder:changed', () => cb()),
  // 記錄檔與截圖(寫在資料夾內的 portfolio-tool.log、snapshots/)
  appendLog: (line) => ipcRenderer.invoke('log:append', line),
  readLog: () => ipcRenderer.invoke('log:read'),
  showLog: () => ipcRenderer.invoke('log:show'),
  saveSnapshot: (rect) => ipcRenderer.invoke('snapshot:save', rect),
});
