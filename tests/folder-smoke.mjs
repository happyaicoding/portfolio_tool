// 桌面版「自動讀取資料夾內所有 CSV」冒煙測試:開啟時讀入、新增檔案後自動更新。
// 用法:node tests/folder-smoke.mjs [exe 路徑]
import { _electron as electron } from 'playwright';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
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

  writeFileSync(path.join(dir, 'strategyC.csv'), csv(2));
  await win.waitForFunction(() => document.getElementById('status').textContent.includes('已載入 3 個策略'), null, { timeout: 15000 })
    .then(() => check('新增檔案後自動更新為 3 個策略', true), () => check('新增檔案後自動更新為 3 個策略', false));
  mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  await win.screenshot({ path: path.join(root, 'artifacts', 'folder.png'), fullPage: true });
} finally {
  await app.close();
}
console.log(fail ? `\n${fail} 項失敗` : '\n資料夾自動讀取測試通過');
process.exit(fail ? 1 : 0);
