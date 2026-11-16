// 投資組合版本功能(次分頁、比較表、新增/搬檔/指紋/移除)的 Electron 冒煙測試。
// 用法:node tests/portfolios-smoke.mjs [exe 路徑]
// 全部在暫存工作區裡跑,不會碰任何真實資料夾。
import { _electron as electron } from 'playwright';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ws = mkdtempSync(path.join(os.tmpdir(), 'portfolio-ws-'));
const csv = (seed, n = 60) => {
  let s = 'date,pnl\n';
  for (let i = 0; i < n; i++) s += `${new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10)},${((i * seed) % 7 - 3) * 100}\n`;
  return s;
};
writeFileSync(path.join(ws, '1.csv'), csv(3));
writeFileSync(path.join(ws, '2.csv'), csv(5));
mkdirSync(path.join(ws, 'B組'));
writeFileSync(path.join(ws, 'B組', '1.csv'), csv(7));

const regPath = path.join(ws, 'portfolios.json');
const registry = () => (existsSync(regPath) ? JSON.parse(readFileSync(regPath, 'utf8')) : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (label, ok, detail = '') => { if (!ok) fail++; console.log(ok ? '✓' : '✗', label, detail); };

const app = await electron.launch(process.argv[2]
  ? { executablePath: path.resolve(process.argv[2]), env: { ...process.env, PORTFOLIO_DATA_DIR: ws } }
  : { args: [root], env: { ...process.env, PORTFOLIO_DATA_DIR: ws } });

try {
  const win = await app.firstWindow();
  await win.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  const text = async (sel) => (await win.textContent(sel)) || '';
  const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(150); } return false; };

  check('啟動讀到根目錄 2 個 CSV', (await text('#status')).includes('已載入 2 個策略'), await text('#status'));
  check('次分頁出現預設投組', (await text('#pfTabs')).includes('預設投組'));
  check('比較分頁在桌面版可見', await win.isVisible('#cmpTab'));

  // ---- 新增投組(新建子資料夾)----
  await win.click('.tabs button[data-tab="compare"]');
  await win.fill('#pfName', '甲組');
  await win.fill('#pfNoteIn', '測試用一組');
  await win.click('#pfAdd');
  check('寫出 portfolios.json(1 筆)', await until(() => registry()?.portfolios.length === 1));
  check('建立子資料夾 甲組', await until(() => existsSync(path.join(ws, '甲組'))));
  check('空資料夾會提示要搬檔', (await text('#migrateHint')).includes('是空的'), await text('#migrateHint'));

  // 名稱重複要擋掉
  await win.fill('#pfName', '甲組');
  await win.fill('#pfNoteIn', '重複名稱');
  await win.click('#pfAdd');
  check('重複名稱被擋', (await text('#pfErr')).includes('已經有一個投資組合'), await text('#pfErr'));

  // ---- 搬檔:複製 → 比對 → 才讓刪 ----
  await win.fill('#pfName', '');
  await win.click('#migrateBtn');
  check('複製 2 個檔到 甲組', await until(() => readdirSync(path.join(ws, '甲組')).length === 2));
  check('根目錄原始檔還在(尚未刪)', readdirSync(ws).includes('1.csv'));
  check('搬完自動建好指紋基準', await until(() => Object.keys(registry().portfolios[0].fingerprints || {}).length === 2));
  await win.click('#migrateDelete');
  check('刪除根目錄 CSV', await until(() => !readdirSync(ws).includes('1.csv')));
  check('子資料夾副本不受影響', readdirSync(path.join(ws, '甲組')).length === 2);
  check('搬完切到甲組並重算', await until(async () => (await text('#status')).includes('已載入 2 個策略')));

  // ---- 比較表 ----
  await win.click('.tabs button[data-tab="compare"]');
  const cmp = await text('#cmpTable');
  check('比較表有甲組欄', cmp.includes('甲組'));
  check('比較表列了總獲利與原表儲存格', cmp.includes('總獲利') && cmp.includes('I17'));
  check('根目錄清空後不再出現預設投組', !cmp.includes('預設投組'));
  check('每列都帶原表儲存格代號', cmp.includes('B2') && cmp.includes('D24') && cmp.includes('B31'));

  // ---- 指紋差異:換掉 甲組/1.csv 的內容 ----
  writeFileSync(path.join(ws, '甲組', '1.csv'), csv(11));
  check('換內容後標出「內容已換過」', await until(async () => (await text('#pfNote')).includes('內容已換過')), await text('#pfNote'));
  const id = registry().portfolios[0].id;
  await win.click('.tabs button[data-tab="compare"]');
  await win.click(`#cmpTable button[data-act="refresh"][data-id="${id}"]`);
  check('按「更新指紋」後差異消失', await until(async () => !(await text('#pfNote')).includes('內容已換過')), await text('#pfNote'));

  // ---- 移除:只拿清單記錄,資料夾要還在 ----
  await win.click(`#cmpTable button[data-act="remove"][data-id="${id}"]`);
  check('清單變空', await until(() => registry().portfolios.length === 0));
  check('資料夾與 CSV 都沒被刪', existsSync(path.join(ws, '甲組', '1.csv')) && existsSync(path.join(ws, '甲組', '2.csv')));
  check('移除寫進該投組的記錄檔', readFileSync(path.join(ws, '甲組', 'portfolio-tool.log'), 'utf8').includes('移除投組'));

  // ---- 選既有資料夾但還沒挑過 → 明確錯誤(不能默默建一個指向根目錄的投組)----
  await win.fill('#pfName', '乙組');
  await win.fill('#pfNoteIn', '指向不存在的資料夾');
  await win.selectOption('#pfDir', 'pick');
  await win.click('#pfAdd');
  check('選既有資料夾但沒選過 → 明確錯誤', (await text('#pfErr')).includes('還沒選資料夾'), await text('#pfErr'));
} finally {
  await app.close();
  try { rmSync(ws, { recursive: true, force: true }); } catch { /* Windows 偶爾會晚一點釋放 */ }
}
console.log(fail ? `\n${fail} 項失敗` : '\n投資組合版本功能測試通過');
process.exit(fail ? 1 : 0);
