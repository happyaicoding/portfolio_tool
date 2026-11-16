const { contextBridge, ipcRenderer } = require('electron');

// 只暴露明確列出的功能給網頁,不開放 Node 或任意檔案存取。
// entry = 投資組合的資料夾指標:{ } = 工作區根目錄(預設投組)、{ sub } = 根目錄下的子資料夾、
// { path } = 用對話框選過並授權過的絕對路徑。路徑檢查在 main.cjs,這裡只做通道對應。
contextBridge.exposeInMainWorld('desktop', {
  // 工作區
  getWorkspace: () => ipcRenderer.invoke('ws:get'),
  chooseWorkspace: () => ipcRenderer.invoke('ws:choose'),
  readRegistry: () => ipcRenderer.invoke('ws:registry:read'),
  writeRegistry: (text) => ipcRenderer.invoke('ws:registry:write', text),
  makeSubFolder: (name) => ipcRenderer.invoke('ws:mkdir', name),
  copyLooseTo: (sub) => ipcRenderer.invoke('ws:copyLooseTo', sub),
  deleteLoose: (sub, expected) => ipcRenderer.invoke('ws:deleteLoose', [sub, expected]),
  pickFolder: () => ipcRenderer.invoke('ws:pickFolder'),
  // 外觀主題(全域,不跟著資料夾走)
  getTheme: () => ipcRenderer.invoke('theme:get'),
  setTheme: (mode) => ipcRenderer.invoke('theme:set', mode),
  // 投資組合
  activate: (entry) => ipcRenderer.invoke('pf:activate', entry),
  exists: (entry) => ipcRenderer.invoke('pf:exists', entry),
  stat: (entry) => ipcRenderer.invoke('pf:stat', entry),
  readFiles: (entry) => ipcRenderer.invoke('pf:read', entry),
  readConfig: (entry) => ipcRenderer.invoke('pf:config:read', entry),
  writeConfig: (entry, text) => ipcRenderer.invoke('pf:config:write', [entry, text]),
  appendLog: (entry, line) => ipcRenderer.invoke('pf:log:append', [entry, line]),
  readLog: (entry) => ipcRenderer.invoke('pf:log:read', entry),
  showLog: (entry) => ipcRenderer.invoke('pf:log:show', entry),
  saveSnapshot: (entry, rect) => ipcRenderer.invoke('pf:snapshot', [entry, rect]),
  onFolderChanged: (cb) => ipcRenderer.on('folder:changed', () => cb()),
});
