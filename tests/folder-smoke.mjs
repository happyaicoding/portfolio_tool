// 桌面版「自動讀取資料夾內所有 CSV」+ 記錄檔 + 截圖 的冒煙測試。
// 用法:node tests/folder-smoke.mjs [exe 路徑]
import { _electron as electron } from 'playwright';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(os.tmpdir(), 'portfolio-data-'));
const csv = (seed) => {
  let s = 'date,pnl\n';
  for (let i = 0; i < 90; i++) {
    const d = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
    s += `${d},${((i * seed) % 7 - 3) * 100}\n`;
  }
  return s;
};
writeFileSync(path.join(dir, 'strategyA.csv'), csv(3));
writeFileSync(path.join(dir, 'strategyB.csv'), csv(5));
writeFileSync(path.join(dir, 'notes.xlsx'), 'not a csv, must be ignored');
const logFile = path.join(dir, 'portfolio-tool.log');
const readLog = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean) : []);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(200); } return false; };

const exe = process.argv[2];
const env = { ...process.env, PORTFOLIO_DATA_DIR: dir };
const app = await electron.launch(exe ? { executablePath: path.resolve(exe), env } : { args: [root], env });
let fail = 0;
const check = (label, ok, detail = '') => { if (!ok) fail++; console.log(ok ? '✓' : '✗', label, detail); };
try {
  const win = await app.firstWindow();
  await win.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  check('開啟時自動讀入 2 個 CSV', (await win.textContent('#status')).includes('已載入 2 個策略'), await win.textContent('#status'));
  check('顯示資料夾路徑', (await win.textContent('#folderPath')).includes('portfolio-data-'));

  // 記錄檔:開啟時兩個檔案各一筆「載入」,xlsx 不算
  await until(() => readLog().filter((l) => l.includes('| 載入 |')).length >= 2);
  let lines = readLog();
  check('記錄檔:載入 2 筆', lines.filter((l) => l.includes('| 載入 |')).length === 2, lines.join(' // '));
  check('記錄檔:不含 notes.xlsx', !lines.some((l) => l.includes('notes.xlsx')));
  check('記錄檔:有 UTF-8 BOM(記事本可直接開)', readFileSync(logFile)[0] === 0xef);

  // 新增檔案
  writeFileSync(path.join(dir, 'strategyC.csv'), csv(2));
  check('新增檔案後自動更新為 3 個策略', await win.waitForFunction(() => document.getElementById('status').textContent.includes('已載入 3 個策略'), null, { timeout: 15000 }).then(() => true, () => false));
  check('記錄檔:新增 strategyC', await until(() => readLog().some((l) => l.includes('| 新增 |') && l.includes('strategyC.csv'))));

  // 修改檔案(多一筆)
  await sleep(1100); // 確保 mtime 不同
  appendFileSync(path.join(dir, 'strategyA.csv'), '2024-04-01,500\n');
  check('記錄檔:修改 strategyA(+1 筆)', await until(() => readLog().some((l) => l.includes('| 修改 |') && l.includes('strategyA.csv') && l.includes('+1'))), readLog().filter((l) => l.includes('修改')).join(' // '));

  // 刪除檔案
  rmSync(path.join(dir, 'strategyB.csv'));
  check('記錄檔:刪除 strategyB', await until(() => readLog().some((l) => l.includes('| 刪除 |') && l.includes('strategyB.csv'))));

  // 截圖並記錄
  await win.click('#snapBtn');
  check('記錄檔:截圖', await until(() => readLog().some((l) => l.includes('| 截圖 |'))), readLog().slice(-2).join(' // '));
  const snaps = existsSync(path.join(dir, 'snapshots')) ? readdirSync(path.join(dir, 'snapshots')) : [];
  check('snapshots 內有 PNG', snaps.length === 1 && /^summary_\d{8}_\d{6}\.png$/.test(snaps[0]), snaps.join(','));
  if (snaps[0]) {
    const png = readFileSync(path.join(dir, 'snapshots', snaps[0]));
    check('PNG 檔頭正確且有內容', png.subarray(1, 4).toString() === 'PNG' && png.length > 5000, `${png.length} bytes`);
  }
  check('截圖記錄含總獲利與預期年報酬', readLog().some((l) => l.includes('| 截圖 |') && l.includes('總獲利') && l.includes('預期年報酬')));

  // 不能無限循環:寫記錄檔/截圖不該再觸發重新載入
  const n = readLog().length;
  await sleep(3000);
  check('記錄檔不會自己越寫越多(無循環)', readLog().length === n, `${n} → ${readLog().length}`);

  // 記錄分頁
  await win.click('.tabs button[data-tab=log]');
  const logText = await win.textContent('#logTable');
  check('記錄分頁顯示截圖與檔案變動', logText.includes('截圖') && logText.includes('新增') && logText.includes('刪除'));

  mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  await win.screenshot({ path: path.join(root, 'artifacts', 'folder.png'), fullPage: true });
} finally {
  await app.close();
}
console.log(fail ? `\n${fail} 項失敗` : '\n資料夾自動讀取、記錄檔與截圖測試通過');
process.exit(fail ? 1 : 0);
