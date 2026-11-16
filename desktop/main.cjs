// 桌面版外殼:載入與網站相同的 web/,並提供「工作區根目錄 + 每個投資組合一個子資料夾」的檔案存取。
// 渲染端只能透過這裡列出的通道讀寫,而且路徑一律限制在工作區根目錄內,
// 或由使用者用對話框選過(記在 external 授權清單)的資料夾 —— 不開放任意路徑。
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

// 優先順序:環境變數(測試用)> 使用者選過的資料夾 > exe 所在資料夾(portable)> 專案的 mock-data/
// 開發時沒給任何一項就落在 mock-data(內有兩個投組與可驗的參考 .xlsm),打開程式就有東西可看。
function defaultFolder() {
  if (process.env.PORTFOLIO_DATA_DIR) return process.env.PORTFOLIO_DATA_DIR;
  const saved = readConfig().folder;
  if (saved && fs.existsSync(saved)) return saved;
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  return app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..', 'mock-data');
}

const LOG_NAME = 'portfolio-tool.log';
const SNAP_DIR = 'snapshots';
const CONFIG_NAME = 'portfolio-config.json';
const REGISTRY_NAME = 'portfolios.json';
// 這幾個是本程式自己寫的,不能再觸發重新載入(否則會無限循環)
const OWN_FILES = new Set([LOG_NAME, SNAP_DIR, CONFIG_NAME, REGISTRY_NAME]);

let root; // 工作區根目錄
let active = {}; // 目前投資組合的 entry;{} = 根目錄本身(預設投組)
let win;
let watcher;
let timer;

/** entry → 絕對資料夾。不在根目錄內、也没被授權過就拒絕。 */
function dirOf(entry) {
  const e = entry || {};
  const r = path.resolve(root);
  if (e.sub) {
    const p = path.resolve(r, String(e.sub));
    if (p !== r && !p.startsWith(r + path.sep)) throw new Error(`資料夾「${e.sub}」不在工作區內`);
    return p;
  }
  if (e.path) {
    const p = path.resolve(String(e.path));
    if (p === r || p.startsWith(r + path.sep)) return p;
    if ((readConfig().external || []).some((x) => path.resolve(x) === p)) return p;
    throw new Error(`「${p}」不在工作區內,需要重新選資料夾授權`);
  }
  return r;
}

const activeDir = () => dirOf(active);

function watchFolder() {
  watcher?.close();
  try {
    watcher = fs.watch(activeDir(), (_event, filename) => {
      if (OWN_FILES.has(filename)) return;
      clearTimeout(timer);
      timer = setTimeout(() => win && !win.isDestroyed() && win.webContents.send('folder:changed'), 600);
    });
    watcher.on('error', () => {});
  } catch { /* 資料夾不存在時略過(介面會顯示「資料夾不存在」) */ }
}

const isData = (n) => /\.(csv|tsv|txt)$/i.test(n) && !n.startsWith('.') && !n.startsWith('~$');

function readData(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && isData(d.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant', { numeric: true }))
    .map((d) => {
      const p = path.join(dir, d.name);
      const st = fs.statSync(p);
      return { name: d.name, data: new Uint8Array(fs.readFileSync(p)), size: st.size, mtime: st.mtimeMs };
    });
}

// ---------- 工作區 ----------

ipcMain.handle('ws:get', () => ({ root, active }));
ipcMain.handle('ws:choose', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: root });
  if (r.canceled || !r.filePaths[0]) return false;
  root = r.filePaths[0];
  active = {};
  writeConfig({ ...readConfig(), folder: root });
  watchFolder();
  return true;
});
ipcMain.handle('ws:registry:read', () => {
  try {
    return fs.readFileSync(path.join(root, REGISTRY_NAME), 'utf8');
  } catch {
    return null; // 還沒有投組清單,不是錯誤
  }
});
ipcMain.handle('ws:registry:write', (_e, text) => {
  try {
    fs.writeFileSync(path.join(root, REGISTRY_NAME), String(text), 'utf8');
    return true;
  } catch {
    return false;
  }
});
// 新增投組:在根目錄下建同名子資料夾
ipcMain.handle('ws:mkdir', (_e, name) => {
  try {
    const p = path.join(path.resolve(root), String(name));
    fs.mkdirSync(p, { recursive: false });
    return { sub: String(name) };
  } catch (e) {
    if (e.code === 'EEXIST') return { error: `工作區裡已經有叫「${name}」的資料夾了,換個名稱或選既有資料夾。` };
    return { error: `建不了子資料夾「${name}」:${e.message}` };
  }
});
// 搬檔第一步:把根目錄散落的 CSV 複製進子資料夾(只複製,不刪,讓渲染端先比對數字)
ipcMain.handle('ws:copyLooseTo', (_e, sub) => {
  try {
    const to = path.join(path.resolve(root), String(sub));
    fs.mkdirSync(to, { recursive: true });
    const moved = [];
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      if (!d.isFile() || !isData(d.name)) continue;
      fs.copyFileSync(path.join(root, d.name), path.join(to, d.name));
      const st = fs.statSync(path.join(to, d.name));
      moved.push({ name: d.name, size: st.size });
    }
    return { moved };
  } catch (e) {
    return { error: e.message };
  }
});
// 搬檔第二步:刪除根目錄那些「子資料夾已有同名且大小相同」的 CSV。比對不符一筆都不刪。
ipcMain.handle('ws:deleteLoose', (_e, [sub, expected]) => {
  try {
    const to = path.join(path.resolve(root), String(sub));
    const list = Array.isArray(expected) ? expected : [];
    const byName = new Map(list.map((x) => [String(x.name), Number(x.size)]));
    const deleted = [];
    const skipped = [];
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      if (!d.isFile() || !isData(d.name)) continue;
      const src = path.join(root, d.name);
      const dst = path.join(to, d.name);
      const want = byName.get(d.name);
      const same = want != null && fs.existsSync(dst) && fs.statSync(dst).size === want && fs.statSync(src).size === want;
      if (!same) { skipped.push(d.name); continue; }
      fs.unlinkSync(src);
      deleted.push(d.name);
    }
    return { deleted, skipped };
  } catch (e) {
    return { error: e.message, deleted: [], skipped: [] };
  }
});
// 使用者用對話框選資料夾 = 同時授權這個路徑(換電腦後要重選,這是故意的)
function dirAuthorized(dir) {
  const p = path.resolve(dir);
  const external = new Set(readConfig().external || []);
  external.add(p);
  writeConfig({ ...readConfig(), external: [...external] });
  return { path: p };
}
ipcMain.handle('ws:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: root });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  return dirAuthorized(r.filePaths[0]);
});

// ---------- 投資組合層級(每個投組一個資料夾) ----------

ipcMain.handle('pf:activate', (_e, entry) => {
  try {
    active = entry || {};
    const dir = activeDir();
    watchFolder();
    return { dir };
  } catch (e) {
    return { error: e.message };
  }
});
ipcMain.handle('pf:exists', (_e, entry) => {
  try {
    return fs.statSync(dirOf(entry)).isDirectory();
  } catch {
    return false;
  }
});
// 次分頁只要知道「資料夾在不在、裡面幾個 CSV」,不用讀內容
ipcMain.handle('pf:stat', (_e, entry) => {
  try {
    const dir = dirOf(entry);
    const files = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && isData(d.name)).length;
    return { exists: true, files };
  } catch {
    return { exists: false, files: 0 };
  }
});
ipcMain.handle('pf:read', (_e, entry) => {
  try {
    return { files: readData(dirOf(entry)) };
  } catch (e) {
    return { error: e.message };
  }
});
ipcMain.handle('pf:config:read', (_e, entry) => {
  try {
    return fs.readFileSync(path.join(dirOf(entry), CONFIG_NAME), 'utf8');
  } catch {
    return null; // 還沒存過 = 用預設值
  }
});
ipcMain.handle('pf:config:write', (_e, [entry, text]) => {
  try {
    fs.writeFileSync(path.join(dirOf(entry), CONFIG_NAME), String(text), 'utf8');
    return true;
  } catch {
    return false; // 資料夾唯讀或離線
  }
});
ipcMain.handle('pf:log:append', (_e, [entry, line]) => {
  try {
    const p = path.join(dirOf(entry), LOG_NAME);
    const isNew = !fs.existsSync(p);
    fs.appendFileSync(p, (isNew ? '\uFEFF' : '') + String(line) + '\r\n', 'utf8'); // 新檔加 BOM,記事本才不會亂碼
    return true;
  } catch {
    return false;
  }
});
ipcMain.handle('pf:log:read', (_e, entry) => {
  try {
    const text = fs.readFileSync(path.join(dirOf(entry), LOG_NAME), 'utf8').replace(/^\uFEFF/, '');
    return text.split(/\r?\n/).filter(Boolean).slice(-500);
  } catch {
    return [];
  }
});
ipcMain.handle('pf:log:show', (_e, entry) => {
  const dir = dirOf(entry);
  const p = path.join(dir, LOG_NAME);
  if (fs.existsSync(p)) shell.showItemInFolder(p);
  else shell.openPath(dir);
});
ipcMain.handle('pf:snapshot', async (_e, [entry, r]) => {
  const dbg = win.webContents.debugger;
  let attached = false;
  try {
    const dir = dirOf(entry);
    try { dbg.attach('1.3'); attached = true; } catch { /* 已經附加(例如測試工具) */ }
    // 用 captureBeyondViewport 擷取整個總表,視窗太小也不會被截掉
    const { data } = await dbg.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 },
    });
    const out = path.join(dir, SNAP_DIR);
    fs.mkdirSync(out, { recursive: true });
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const name = `summary_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.png`;
    fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'));
    return { name: path.join(SNAP_DIR, name) };
  } catch (e) {
    return { error: e.message || String(e) };
  } finally {
    if (attached) { try { dbg.detach(); } catch { /* 略過 */ } }
  }
});

app.whenReady().then(() => {
  root = defaultFolder();
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
