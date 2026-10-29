// 桌面版外殼:載入與網站相同的 web/,並提供「自動讀取資料夾內所有 CSV」。
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
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

const LOG_NAME = 'portfolio-tool.log';
const SNAP_DIR = 'snapshots';

let folder;
let win;
let watcher;
let timer;

function watchFolder() {
  watcher?.close();
  try {
    watcher = fs.watch(folder, (_event, filename) => {
      // 記錄檔與截圖資料夾是本程式自己寫的,不能再觸發重新載入(否則會無限循環)
      if (filename === LOG_NAME || filename === SNAP_DIR) return;
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
      .map((d) => {
        const p = path.join(folder, d.name);
        const st = fs.statSync(p);
        return { name: d.name, data: new Uint8Array(fs.readFileSync(p)), size: st.size, mtime: st.mtimeMs };
      });
  } catch {
    return [];
  }
});

// ---------- 記錄檔與截圖 ----------

ipcMain.handle('log:append', (_e, line) => {
  try {
    const p = path.join(folder, LOG_NAME);
    const isNew = !fs.existsSync(p);
    fs.appendFileSync(p, (isNew ? '\uFEFF' : '') + String(line) + '\r\n', 'utf8'); // 新檔加 BOM,記事本才不會亂碼
    return true;
  } catch {
    return false;
  }
});
ipcMain.handle('log:read', () => {
  try {
    const text = fs.readFileSync(path.join(folder, LOG_NAME), 'utf8').replace(/^\uFEFF/, '');
    return text.split(/\r?\n/).filter(Boolean).slice(-500);
  } catch {
    return [];
  }
});
ipcMain.handle('log:show', () => {
  const p = path.join(folder, LOG_NAME);
  if (fs.existsSync(p)) shell.showItemInFolder(p);
  else shell.openPath(folder);
});
ipcMain.handle('snapshot:save', async (_e, r) => {
  const dbg = win.webContents.debugger;
  let attached = false;
  try {
    try { dbg.attach('1.3'); attached = true; } catch { /* 已經附加(例如測試工具) */ }
    // 用 captureBeyondViewport 擷取整個總表,視窗太小也不會被截掉
    const { data } = await dbg.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 },
    });
    const dir = path.join(folder, SNAP_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const name = `summary_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.png`;
    fs.writeFileSync(path.join(dir, name), Buffer.from(data, 'base64'));
    return { name: path.join(SNAP_DIR, name) };
  } catch (e) {
    return { error: e.message || String(e) };
  } finally {
    if (attached) { try { dbg.detach(); } catch { /* 略過 */ } }
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
