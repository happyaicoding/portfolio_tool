#!/usr/bin/env node
// 從一份 .xlsm 產生 mock 資料夾:把「文字檔」的每組(日期欄, 損益欄)匯成 1.csv…N.csv,
// 並用那份檔自己的輸入生 portfolio-config.json,讓 mock 一開就是可比對的投資組合。
//
//   node tools/export-mock.mjs <xlsm 路徑> <輸出資料夾> [portfolios.json 路徑]
// 給第三個參數時會把這個投組寫進清單(name 取輸出資料夾名,指紋用剛匯出的 CSV 現況),
// 這樣重跑工具就能重建 mock 工作區,不需要在介面上按「更新指紋」。
//
// 注意:mock 的數字是**原表快取值反推**的,小數位、缺日、全 0 策略都會原樣帶過來,
// 跟 MTC 直接匯出的檔案不會完全相同。要驗匯出流程請用真實 CSV,不要拿 mock 當證明。
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseXlsx, tableToStrategies } from '../web/src/parse.js';
import { DEFAULT_SETTINGS, PRODUCTS, fmtDate } from '../web/src/core.js';
import { toConfigText } from '../web/src/config.js';
import { parseRegistry, serializeRegistry, fingerprints } from '../web/src/portfolios.js';

const [xlsmPath, outDir, registryPath] = process.argv.slice(2);
if (!xlsmPath || !outDir) {
  console.error('用法:node tools/export-mock.mjs <xlsm 路徑> <輸出資料夾>');
  process.exit(1);
}
const buf = readFileSync(xlsmPath);
const bytes = () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const sheets = await parseXlsx(await bytes());
const txt = sheets.find((s) => s.name === '文字檔');
if (!txt) { console.error('✗ 這份 .xlsm 沒有「文字檔」工作表'); process.exit(1); }
const sum = sheets.find((s) => s.name === '總表');
if (!sum) { console.error('✗ 這份 .xlsm 沒有「總表」工作表'); process.exit(1); }

const ref = (col, row) => {
  let n = 0;
  for (const ch of col) n = n * 26 + ch.charCodeAt(0) - 64;
  const v = (sum.rows[row - 1] || [])[n - 1];
  return v && typeof v === 'object' && 'date' in v ? v.date : v;
};
const strategies = tableToStrategies(txt.rows, '策略');
if (!strategies.length) { console.error('✗ 文字檔找不到「日期 + 損益」的欄位組合'); process.exit(1); }

// 輸出資料夾先清掉旧的 CSV/config,避免上一次匯出留下來多一排策略
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) {
  if (/^(portfolio-config\.json|\d+\.csv)$/i.test(f)) rmSync(path.join(outDir, f));
}

const num = (v) => {
  const s = String(v);
  return s.includes('e') || s.includes('E') ? v.toFixed(12) : s;
};
let min = Infinity;
let max = -Infinity;
for (const [i, s] of strategies.entries()) {
  const rows = s.rows.slice().sort((a, b) => a[0] - b[0]);
  // 開頭一個空白行:真實 MTC 匯出常這樣,解析端要吃得下(mock 就照實重現)
  const body = [''].concat(rows.map(([d, v]) => `${fmtDate(d)},${num(v)}`)).join('\r\n') + '\r\n';
  writeFileSync(path.join(outDir, `${i + 1}.csv`), body, 'utf8');
  for (const [d] of rows) { if (d < min) min = d; if (d > max) max = d; }
  console.log(`  ${i + 1}.csv ${String(rows.length).padStart(5)} 筆 加總 ${rows.reduce((a, r) => a + r[1], 0).toFixed(2)}`);
}

// 權重讀「策略報表」的 allocation 列(原表 C1.. 是策略名,C2.. 是權重),讀不到就全 1
const weights = {};
const rep = sheets.find((s) => s.name === '策略報表');
if (rep) {
  const head = rep.rows[0] || [];
  const alloc = rep.rows[1] || [];
  for (let c = 2; c < head.length; c++) {
    const label = head[c] == null ? null : String(head[c]).trim();
    if (!label) continue;
    const a = typeof alloc[c] === 'number' ? alloc[c] : 1;
    weights[label] = a;
  }
}
for (const [i, s] of strategies.entries()) if (weights[String(i + 1)] == null) weights[String(i + 1)] = 1;

// 門檻從「DD 40 Day Avg」那列的標籤讀,不要寫死 40
let streakThreshold = DEFAULT_SETTINGS.streakThreshold;
for (const row of sum.rows) {
  const label = typeof row?.[0] === 'string' ? row[0] : typeof row?.[1] === 'string' ? row[1] : '';
  const m = /DD\s*(\d+)\s*Day\s*Avg/i.exec(String(label).trim());
  if (m) { streakThreshold = +m[1]; break; }
}

const settings = {
  ...DEFAULT_SETTINGS,
  product: PRODUCTS[ref('A', 18)] ? ref('A', 18) : DEFAULT_SETTINGS.product,
  ratio: typeof ref('B', 19) === 'number' ? ref('B', 19) : DEFAULT_SETTINGS.ratio,
  startDate: txt.rows[0]?.[1] && typeof txt.rows[0][1] === 'object' && 'date' in txt.rows[0][1] ? txt.rows[0][1].date : null,
  endDate: typeof ref('B', 30) === 'number' ? ref('B', 30) : null,
  calcYear: typeof ref('B', 14) === 'number' ? ref('B', 14) : null,
  txMargin: typeof ref('C', 18) === 'number' ? ref('C', 18) : DEFAULT_SETTINGS.txMargin,
  capital: typeof ref('B', 28) === 'number' ? ref('B', 28) : DEFAULT_SETTINGS.capital,
  streakThreshold,
  lots: {
    total: ref('B', 21), dayTrade: ref('C', 21), hold: ref('D', 21), excess: ref('E', 21),
  },
};
for (const k of Object.keys(settings.lots)) if (typeof settings.lots[k] !== 'number') delete settings.lots[k];
writeFileSync(path.join(outDir, 'portfolio-config.json'), toConfigText(settings, weights), 'utf8');

console.log(`\n${strategies.length} 個 CSV 寫到 ${outDir}`);
console.log(`資料期間 ${fmtDate(min)} ~ ${fmtDate(max)},起始日 ${settings.startDate ? fmtDate(settings.startDate) : '(未設定)'},門檻 ${streakThreshold}`);
console.log(`設定:商品 ${settings.product} 比例 ${settings.ratio} 口數 ${JSON.stringify(settings.lots)} 自訂資金 ${settings.capital} 計算年份 ${settings.calcYear} 資料結束 ${settings.endDate ? fmtDate(settings.endDate) : '(未設定)'}`);

// 寫進投組清單:指紋基準就用剛匯出的 CSV,所以開程式不會一進來就標 ⚠
if (registryPath) {
  const name = path.basename(outDir);
  const reg = parseRegistry(existsSync(registryPath) ? readFileSync(registryPath, 'utf8') : '');
  if (reg.error) { console.error(`✗ 既有清單讀不到:${reg.error}`); process.exit(1); }
  const now = new Date().toISOString();
  const fp = fingerprints(strategies);
  const note = `${strategies.length} 條策略,${fmtDate(min)} ~ ${fmtDate(max)},商品 ${settings.product}`;
  const existing = reg.portfolios.find((p) => p.sub === name);
  if (existing) Object.assign(existing, { note, fingerprints: fp, savedAt: now });
  else reg.portfolios.push({ id: `mock${reg.portfolios.length + 1}`, name, note, sub: name, path: null, createdAt: now, savedAt: now, fingerprints: fp });
  writeFileSync(registryPath, serializeRegistry(reg.portfolios), 'utf8');
  console.log(`已寫入 ${registryPath}:${reg.portfolios.map((p) => p.name).join('、')}`);
}
