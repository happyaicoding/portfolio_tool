// 用 repo 內的 mock 工作區(mock-data/)跑桌面版:兩個投組、次分頁切換、比較表、指紋一致。
// 這份測的是「真資料規模」的投組流程,跟 portfolios-smoke(合成小 CSV)互補。
// 用法:node tests/mock-smoke.mjs [exe 路徑]
import { _electron as electron } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ws = path.join(root, 'mock-data');
const exe = process.argv[2];
// 一定用 PORTFOLIO_DATA_DIR 鎖死 mock-data,否則機器上存過的「選擇資料夾」會把測試指向別處
const app = await electron.launch(exe
  ? { executablePath: path.resolve(exe), env: { ...process.env, PORTFOLIO_DATA_DIR: ws } }
  : { args: [root], env: { ...process.env, PORTFOLIO_DATA_DIR: ws } });

let fail = 0;
const check = (label, ok, detail = '') => { if (!ok) fail++; console.log(ok ? '✓' : '✗', label, detail); };
const errors = [];

try {
  const win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push(String(e)));
  win.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const text = async (sel) => (await win.textContent(sel)) || '';
  await win.waitForSelector('#app:not([hidden])', { timeout: 30000 });

  check('根目錄沒散落 CSV 時直接開第一個投組', (await text('#status')).includes('已載入 14 個策略'), await text('#status'));
  const tabs = await text('#pfTabs');
  check('次分頁有龜烏14', tabs.includes('龜烏14'));
  check('次分頁有龜烏20', tabs.includes('龜烏20'));
  check('次分頁不該出現預設投組', !tabs.includes('預設投組'), tabs);
  check('指紋基準一致,沒有 ⚠ 差異', !(await text('#pfNote')).includes('⚠'), await text('#pfNote'));
  // 只比不隨日軸尾日漂移的數字(總獲利是資料加總;全部月份平均會跟著「今天」變,不能寫死)
  check('龜烏14 的總獲利對得上舊基準 I17', (await text('#sheet')).includes('1,777,558'));

  // 切投組
  await win.click('#pfTabs button[data-pf="mock2"]');
  check('切到龜烏20 讀到 20 條策略', await win.waitForFunction(
    () => document.getElementById('status').textContent.includes('已載入 20 個策略'), null, { timeout: 20000 },
  ).then(() => true, () => false));
  check('切投組後設定也跟著換(原始口數 20)', (await win.inputValue('#lotTotal')) === '20', await win.inputValue('#lotTotal'));

  // 比較表
  await win.click('.tabs button[data-tab="compare"]');
  await win.waitForFunction(() => document.querySelectorAll('#cmpTable tbody tr').length > 0, null, { timeout: 30000 });
  const cmp = await text('#cmpTable');
  check('比較表兩欄都有投組名', cmp.includes('龜烏14') && cmp.includes('龜烏20'));
  check('總獲利列有最佳/最差標記', (await win.$$('#cmpTable tbody tr:first-child td.best')).length === 1
    && (await win.$$('#cmpTable tbody tr:first-child td.worst')).length === 1);
  const rows = await win.$$('#cmpTable tbody tr');
  check('比較表 15 列指標', rows.length === 15, `得 ${rows.length}`);
  check('納入策略數列顯示 14 與 20', (await rows[13].textContent()).includes('14') && (await rows[13].textContent()).includes('20'), await rows[13].textContent());
  check('最後一列是權重總和', (await rows[14].textContent()).includes('權重總和'), await rows[14].textContent());

  // 差值模式:基準欄維持自己的數字,其他欄改成帶正負號的差值
  const cellsBefore = await Promise.all((await rows[0].$$('td')).map((t) => t.textContent()));
  const baseId = await win.inputValue('#cmpBase');
  const baseIdx = baseId === 'mock1' ? 0 : 1;
  await win.check('#cmpDiff');
  await win.waitForTimeout(300);
  const row0b = (await win.$$('#cmpTable tbody tr'))[0];
  const cellsAfter = await Promise.all((await row0b.$$('td')).map((t) => t.textContent()));
  check('差值模式基準欄維持自己的數字', cellsAfter[baseIdx] === cellsBefore[baseIdx], `${cellsBefore[baseIdx]} → ${cellsAfter[baseIdx]}`);
  check('差值模式其他欄帶正負號', /^[+-][0-9,]/.test((cellsAfter[1 - baseIdx] || '').trim()), cellsAfter[1 - baseIdx]);

  // ---- 主題切換(下拉在標題列右側,任何分頁都點得到;總表底色要跟著變)----
  const themeAttr = () => win.evaluate(() => document.documentElement.dataset.theme);
  const paperBg = () => win.evaluate(() => getComputedStyle(document.querySelector('.sheet')).backgroundColor);
  await win.selectOption('#theme', 'dark');
  check('切深色後 html data-theme=dark', (await themeAttr()) === 'dark', await themeAttr());
  const darkPaper = await paperBg();
  check('深色下總表不再是白紙', darkPaper !== 'rgb(255, 255, 255)', darkPaper);
  await win.selectOption('#theme', 'light');
  check('切回淺色總表變白紙', (await paperBg()) === 'rgb(255, 255, 255)', await paperBg());

  // 截圖要維持白底:深色模式下按截圖,期間要真的出現 light,而且最後要回到 dark
  await win.selectOption('#theme', 'dark');
  await win.click('.tabs button[data-tab="summary"]');
  // 用 MutationObserver 記錄 data-theme 的整個序列,否則「還原後是 dark」會被
  // 還沒切換就通過的輪詢假綠掉
  await win.evaluate(() => {
    window.__seen = [document.documentElement.dataset.theme];
    new MutationObserver(() => window.__seen.push(document.documentElement.dataset.theme))
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  });
  await win.click('#snapBtn');
  let cycled = true;
  try {
    await win.waitForFunction(() => window.__seen.includes('light') && window.__seen.at(-1) === 'dark', null, { timeout: 20000 });
  } catch { cycled = false; }
  check('截圖期間轉成白底、截完回到深色', cycled, await win.evaluate(() => window.__seen.join('→')));
  const snapDir = path.join(ws, '龜烏20', 'snapshots');
  const snaps = existsSync(snapDir) ? readdirSync(snapDir) : [];
  check('截圖寫進該投組自己的 snapshots 資料夾', snaps.length >= 1, snaps.join(','));

  // 還原成跟隨系統,不要把測試用的主題留在這台電腦的設定裡
  await win.selectOption('#theme', 'auto');
  check('切回跟隨系統', (await win.inputValue('#theme')) === 'auto');

  check('沒有 console 錯誤', errors.length === 0, errors.join(' | '));
} finally {
  await app.close();
}
console.log(fail ? `\n${fail} 項失敗` : '\nmock 工作區投組流程測試通過');
process.exit(fail ? 1 : 0);
