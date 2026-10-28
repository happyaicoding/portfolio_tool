// 桌面版外殼:載入與網站相同的 web/,並提供「自動讀取資料夾內所有 CSV」。
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const configFile = () => path.join(app.getPath('userData'), 'config.json');
const readConfig = () => {
  try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { return {}; }
};
const writeConfig = (c) => {
  try {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(c));
  } catch { /* 無法寫入設定時,下次啟動回到預設資料夾 */ }
};

// 優先順序:環境變數(測試用)> 使用者選過的資料夾 > exe 所在資料夾(portable)> 專案 data/
function defaultFolder() {
  if (process.env.PORTFOLIO_DATA_DIR) return process.env.PORTFOLIO_DATA_DIR;
  const saved = readConfig().folder;
  if (saved && fs.existsSync(saved)) return saved;
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  return app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..', 'data');
}

let folder;
let win;
let watcher;
let timer;

function watchFolder() {
  watcher?.close();
  try {
    watcher = fs.watch(folder, () => {
      clearTimeout(timer);
      timer = setTimeout(() => win && !win.isDestroyed() && win.webContents.send('folder:changed'), 600);
    });
    watcher.on('error', () => {});
  } catch { /* 資料夾不存在時略過 */ }
}

const isData = (n) => /\.(csv|tsv|txt)$/i.test(n) && !n.startsWith('.') && !n.startsWith('~$');

ipcMain.handle('folder:get', () => folder);
ipcMain.handle('folder:choose', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: folder });
  if (r.canceled || !r.filePaths[0]) return false;
  folder = r.filePaths[0];
  writeConfig({ ...readConfig(), folder });
  watchFolder();
  return true;
});
ipcMain.handle('folder:read', () => {
  try {
    return fs.readdirSync(folder, { withFileTypes: true })
      .filter((d) => d.isFile() && isData(d.name))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
      .map((d) => ({ name: d.name, data: new Uint8Array(fs.readFileSync(path.join(folder, d.name))) }));
  } catch {
    return [];
  }
});

app.whenReady().then(() => {
  folder = defaultFolder();
  win = new BrowserWindow({
    width: 1200,
    height: 900,
    title: '黃金龜績效報表',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, '..', 'web', 'index.html'));
  watchFolder();
});
app.on('window-all-closed', () => app.quit());
