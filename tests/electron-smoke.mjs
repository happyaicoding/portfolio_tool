// 啟動桌面版(開發模式或打包後的 exe),上傳原 .xlsm,檢查畫面數字並截圖。
// 用法:node tests/electron-smoke.mjs [exe 路徑]   (不給路徑 = 用 node_modules 的 electron 開 .)
import { _electron as electron } from 'playwright';
import { readdirSync, copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const xlsm = readdirSync(root).find((f) => f.endsWith('.xlsm'));
// 複製成純英文檔名,避免把「檔名編碼」問題混進桌面版本身的測試
const input = path.join(os.tmpdir(), 'portfolio-smoke.xlsm');
copyFileSync(path.join(root, xlsm), input);

const exe = process.argv[2];
const app = await electron.launch(exe ? { executablePath: path.resolve(exe) } : { args: [root] });
let fail = 0;
try {
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(String(e)));
  win.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await win.waitForLoadState('domcontentloaded');
  await win.setInputFiles('#file', input);
  await win.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  await win.waitForTimeout(500);

  const status = await win.textContent('#status');
  const kpi = await win.textContent('#sheet');
  const checks = [
    ['載入 14 個策略', status.includes('已載入 14 個策略'), status],
    ['全部月份平均獲利 21,161', kpi.includes('21,161'), ''],
    ['月勝率 73.81%', kpi.includes('73.81%'), ''],
    ['ROA 7.72', kpi.includes('7.72'), ''],
    ['沒有 console 錯誤', errors.length === 0, errors.join(' | ')],
    ['設定分頁:14 個策略權重欄位', (await (async () => { await win.click('.tabs button[data-tab=settings]'); return win.locator('#alloc input').count(); })()) === 14, ''],
  ];
  for (const [label, ok, detail] of checks) {
    if (!ok) fail++;
    console.log(ok ? '✓' : '✗', label, detail);
  }
  mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  await win.screenshot({ path: path.join(root, 'artifacts', 'desktop.png'), fullPage: true });
} finally {
  await app.close();
}
console.log(fail ? `\n${fail} 項失敗` : '\n桌面版冒煙測試通過');
process.exit(fail ? 1 : 0);
