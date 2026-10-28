// 桌面版外殼:用 Electron 載入與網站完全相同的 web/ 內容。
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

function createWindow() {
  const win = new BrowserWindow({ width: 1200, height: 900, title: '黃金龜績效報表', autoHideMenuBar: true });
  win.loadFile(path.join(__dirname, '..', 'web', 'index.html'));
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
