#!/usr/bin/env node
// CSV 資料夾模式的驗收工具:只用 CSV(執行期輸入)重算總表,逐格對照參考 .xlsm 的快取值。
// 目的:換了資料、或改了設定檔之後,自己跑一次就能確認數字還是对不著原表。
//
//   node tools/check-csv.mjs <CSV 資料夾> [參考 .xlsm 路徑]
//
// 設定(起始日、商品、比例、口數、自訂資金、計算年份、權重)讀 <資料夾>/portfolio-config.json;
// 沒有這個檔就明確失敗,不會用預設值偷偷算出一份不一樣的報表。
// 參考檔預設用專案根目錄那份 .xlsm;期望值全部從檔裡讀,不寫死在程式裡。
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFile, parseXlsx } from '../web/src/parse.js';
import { computeReport, DEFAULT_SETTINGS, fmtDate } from '../web/src/core.js';
import { CONFIG_NAME, parseConfig, toConfigText } from '../web/src/config.js';

const DAY = 86400000;
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

const dir = process.argv[2];
if (!dir) die('用法:node tools/check-csv.mjs <CSV 資料夾> [參考 .xlsm]');
if (!existsSync(dir) || !statSync(dir).isDirectory()) die(`資料夾不存在或不是資料夾:${dir}`);
const csvs = readdirSync(dir).filter((f) => /\.(csv|tsv|txt)$/i.test(f) && !f.startsWith('~$')).sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true }));
if (!csvs.length) die(`${dir} 內沒有 CSV/TSV/TXT 檔`);

const cfgPath = path.join(dir, CONFIG_NAME);
if (!existsSync(cfgPath)) die(`找不到 ${CONFIG_NAME}。請先用桌面版開啟這個資料夾並把設定存一次(或在資料夾內手動建一個,格式見 README)。`);
const parsed = parseConfig(readFileSync(cfgPath, 'utf8'));
if (parsed.error) die(`${CONFIG_NAME} 讀不到:${parsed.error}`);
if (parsed.settings.startDate == null) die(`${CONFIG_NAME} 沒有 startDate(原表 文字檔 B1 的開始日期)。留空白會把開始日期之前的資料一起算,數字必然對不上原表。`);

const xlsmArg = process.argv[3];
const xlsmName = xlsmArg || readdirSync(root).find((f) => f.endsWith('.xlsm'));
if (!xlsmName) die('找不到參考 .xlsm(放在專案根目錄,或當第二個參數傳路徑)');
const xlsmPath = path.isAbsolute(xlsmName) ? xlsmName : path.join(root, xlsmName);
const buf = readFileSync(xlsmPath);
const sheets = await parseXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

// ---------- 讀 CSV ----------
const strategies = [];
for (const f of csvs) {
  const b = readFileSync(path.join(dir, f));
  const got = await loadFile({ name: f, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });
  if (!got.length) die(`「${f}」找不到「日期 + 損益」的資料欄`);
  const base = f.replace(/\.[^.]+$/, '');
  for (const s of got) strategies.push({ ...s, name: s.name || base, allocation: parsed.weights[s.name || base] ?? parsed.weights[base] ?? 1 });
}

// ---------- 讀參考檔的總表與日軸 ----------
const sum = sheets.find((s) => s.name === '總表') || die('參考檔沒有「總表」工作表');
const ref = (col, row) => {
  let n = 0;
  for (const ch of col) n = n * 26 + ch.charCodeAt(0) - 64;
  const v = (sum.rows[row - 1] || [])[n - 1];
  return v && typeof v === 'object' && 'date' in v ? v.date : v;
};
const g8 = sheets.find((s) => s.name === '日週期')?.rows[7]?.[6];
if (typeof g8 !== 'number' || g8 <= 2) die('讀不到 日週期!G8(原表的日軸長度),無法對齊窗口');
const settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
const opts = { startDate: settings.startDate, lastDate: settings.startDate + (g8 - 3) * DAY };
const r = computeReport(strategies, settings, opts);
if (!r) die('起始日晚於日軸範圍,算不出報表(檢查 startDate 與 日週期!G8)');

console.log(`資料夾:${dir}`);
console.log(`參考檔:${xlsmPath}`);
console.log(`策略 ${strategies.length} 條,起始日 ${fmtDate(settings.startDate)},日軸 ${r.dates.length} 天到 ${fmtDate(r.dates.at(-1))}`);
console.log(`設定:${toConfigText(settings, parsed.weights).replace(/\s+/g, ' ')}`);

// ---------- 逐格比對 ----------
let ok = 0;
const bad = [];
const near = (cell, label, got, want, tol = 1e-6) => {
  if (typeof want === 'string') { want === got ? ok++ : bad.push(`${cell} ${label}: 得 ${JSON.stringify(got)} 原表 ${JSON.stringify(want)}`); return; }
  if (typeof want !== 'number' || typeof got !== 'number' || Math.abs(got - want) > Math.max(0.005, Math.abs(want) * tol)) {
    bad.push(`${cell} ${label}: 得 ${Number.isFinite(got) ? got : JSON.stringify(got)} 原表 ${want}`);
  } else ok++;
};
const k = r.kpi, p = r.plan, h = r.highs;
near('B2', '全部月份平均(TX)', k.avgAll.TX, ref('B', 2));
near('C2', '全部月份平均(MTX)', k.avgAll.MTX, ref('C', 2));
near('D2', '全部月份平均(TMF)', k.avgAll.TMF, ref('D', 2));
near('B3', '近三年月平均(TX)', k.avgRecent.TX, ref('B', 3));
near('D3', '近三年月平均(TMF)', k.avgRecent.TMF, ref('D', 3));
near('B4', '最大月虧損(TX)', k.worstMonth.TX, ref('B', 4));
near('D4', '最大月虧損(TMF)', k.worstMonth.TMF, ref('D', 4));
near('B5', '月勝率', k.winRate, ref('B', 5));
near('B6', 'ROA', k.roa, ref('B', 6));
near('B7', '最大平倉虧損(TX)', k.maxPositionLoss.TX, ref('B', 7));
near('B8', '最大單日虧損(TX)', k.worstDay.TX, ref('B', 8));
near('D8', '最大單日虧損(TMF)', k.worstDay.TMF, ref('D', 8));
near('A11', '每日浮動區間下限', r.band.all?.[0], ref('A', 11), 1e-4);
near('B11', '每日浮動區間上限', r.band.all?.[1], ref('B', 11), 1e-4);
near('C11', '95%單日風險值', r.var95, ref('C', 11), 1e-4);
near('D11', '最大單日虧損(商品)', r.worstDayProd, ref('D', 11), 1e-4);
near('E11', '日累計MAXDD', r.ddProd, ref('E', 11), 1e-4);
near('A13', '近三年浮動下限', r.band.recent?.[0], ref('A', 13), 1e-4);
near('B13', '近三年浮動上限', r.band.recent?.[1], ref('B', 13), 1e-4);
near('D12', '最大連虧月份', r.maxLossMonthStreak, ref('D', 12));
near('D13', '年度最多虧損月份', r.maxLossMonthsInYear, ref('D', 13));
near('E13', '最大平倉虧(概)', r.ddApprox, ref('E', 13), 1e-4);
near('E15', '最大策略虧(概)', r.strategyLoss, ref('E', 15), 1e-4);
near('I17', '總獲利', k.totalProfit, ref('I', 17), 1e-4);
near('D19', '每口保證金', p.marginPerLot, ref('D', 19));
near('B24', '動用保證金', p.margin, ref('B', 24));
near('B25', '期貨保證金', p.futuresMargin, ref('B', 25));
near('B26', '最少資金準備', p.minCapital, ref('B', 26), 1e-4);
near('B27', '兩套資金準備', p.twoSetCapital, ref('B', 27), 1e-4);
near('D24', '預期年報酬', p.expectedAnnual, ref('D', 24), 1e-4);
near('D25', '預期報酬率', p.expectedReturn, ref('D', 25), 1e-4);
near('D26', '預期風險', p.expectedRisk, ref('D', 26), 1e-4);
near('D27', '保證金檢核', p.marginCheck, ref('D', 27));
near('D30', '最新創高日', fmtDate(h.latestHigh), fmtDate(ref('D', 30)));
near('B31', 'DD 40 Day Avg', h.recent5Avg, ref('B', 31), 1e-4);
near('D31', '距離上次創高', h.latestHighDays, ref('D', 31));
for (let i = 0; i < 3; i++) {
  const row = 34 + i;
  near(`B${row}`, `第${i + 1}久 DD 日數`, h.longByLength[i]?.days, ref('B', row));
  near(`C${row}`, '起始日', fmtDate(h.longByLength[i]?.start), fmtDate(ref('C', row)));
  near(`D${row}`, '創高日', fmtDate(h.longByLength[i]?.end), fmtDate(ref('D', row)));
}
// 年報酬 / 年DD(原表 H15:P15、H16:P16,欄位對應年度)
for (let ci = 7; ci <= 15; ci++) {
  const y = sum.rows[1]?.[ci];
  if (typeof y !== 'number' || y < 1990) continue;
  const idx = r.years.indexOf(y);
  if (idx < 0) continue;
  const col = colName(ci);
  near(`${col}15`, `${y} 年報酬`, r.annualRet[idx], ref(col, 15), 1e-4);
  near(`${col}16`, `${y} 年DD`, r.annualDD[idx], ref(col, 16), 1e-4);
}

for (const b of bad) console.log(`✗ ${b}`);
console.log(`\n相符 ${ok} 格,不符 ${bad.length} 格${bad.length ? ' —— 上面逐條列出差異' : ''}`);
process.exit(bad.length ? 1 : 0);

function colName(ci) {
  let n = ci + 1, s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}
