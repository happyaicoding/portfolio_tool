// 以 repo 内附的原始 .xlsm 当「期望值来源」:直接读 總表 的 Excel 快取值,
// 逐格对比 computeReport 的结果。数字不写死在工作表之外,改 .xlsm 测试就跟着改。
// 用法:node tests/excel-oracle.test.mjs [xlsm 路径]
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseXlsx, loadFile } from '../web/src/parse.js';
import { computeReport, parseDate, fmtDate } from '../web/src/core.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const xlsmName = process.argv[2] || readdirSync(root).find((f) => f.endsWith('.xlsm'));
if (!xlsmName) {
  console.error('✗ 找不到 .xlsm(应放在专案根目录;测试的期望值直接读它,不能略过)');
  process.exit(1);
}
const xlsmPath = path.isAbsolute(xlsmName) ? xlsmName : path.join(root, xlsmName);
const buf = readFileSync(xlsmPath);
const asFile = (n, b) => ({ name: n, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });

// ---------- 读 總表 快取值 ----------
const sheets = await parseXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const sheet = sheets.find((s) => s.name === '總表');
if (!sheet) { console.error('✗ .xlsm 内没有「總表」工作表'); process.exit(1); }
const ref = (col, row) => {
  let n = 0;
  for (const ch of col) n = n * 26 + ch.charCodeAt(0) - 64;
  const v = (sheet.rows[row - 1] || [])[n - 1];
  return v && typeof v === 'object' && 'date' in v ? v.date : v;
};
// 依「A 栏标签」找列号,避免原表插列时整份对应错位
const rowOfLabel = (label) => {
  for (let r = 1; r <= sheet.rows.length; r++) {
    const v = sheet.rows[r - 1]?.[0];
    if (typeof v === 'string' && v.trim() === label) return r;
  }
  return null;
};

const strategies = await loadFile(asFile(xlsmName, buf));
// 与原表相同的参数:商品 TMF、比例 100%、计算年份 2026、资料结束日期 2026-06-30(原表 B30)
const settings = {
  product: 'TMF',
  ratio: ref('B', 19),
  calcYear: ref('B', 14),
  endDate: ref('B', 30),
  txMargin: ref('C', 18),
  capital: ref('B', 28),
  streakThreshold: 40,
  lots: { total: ref('B', 21), dayTrade: ref('C', 21), hold: ref('D', 21), excess: ref('E', 21) },
};
// 原表的日軸(日週期 A 欄)拖到「更新當天」,多出來的未來日損益為 0,會影響平均數與母體
// 標準差,也會決定「近三年」取到哪三個年度。原表把這些窗口寫死在 日週期!G8
// (= HLOOKUP(計算年份, M2:AH4, 3) = 該年底的累計日數 + 2 列表頭),所以測試直接讀 G8
// 的快存值來對齊窗口,差值才不會混進計算式本身。
const cyc = sheets.find((s) => s.name === '日週期');
const g8 = cyc?.rows[7]?.[6]; // G8
const axisDays = typeof g8 === 'number' && g8 > 2 ? g8 - 2 : undefined;
const DAY = 86400000;
const lastDate = axisDays == null ? undefined : strategies.startDate + (axisDays - 1) * DAY;
const report = computeReport(strategies, settings, { startDate: strategies.startDate, lastDate });

let fail = 0;
const near = (label, got, want, tol = 1e-6) => {
  const ok = typeof got === 'number' && typeof want === 'number' && Math.abs(got - want) <= tol * Math.max(1, Math.abs(want));
  if (!ok) { fail++; console.log('✗', label, 'got', got, 'want', want); } else console.log('✓', label, got);
};
const eq = (label, got, want) => {
  if (got !== want) { fail++; console.log('✗', label, 'got', got, 'want', want); } else console.log('✓', label, got);
};

const k = report.kpi;
const p = report.plan;
near('B2 全部月份平均獲利 TX', k.avgAll.TX, ref('B', 2));
near('C2 TX→MTX', k.avgAll.MTX, ref('C', 2));
near('D2 TX→TMF', k.avgAll.TMF, ref('D', 2));
near('B3 近三年月平均獲利', k.avgRecent.TX, ref('B', 3));
near('D3 近三年月平均(TMF)', k.avgRecent.TMF, ref('D', 3));
near('B4 最大月虧損', k.worstMonth.TX, ref('B', 4));
near('B5 月勝率', k.winRate, ref('B', 5));
near('B6 ROA', k.roa, ref('B', 6));
near('B7 最大平倉虧損', k.maxPositionLoss.TX, ref('B', 7));
near('B8 最大單日虧損', k.worstDay.TX, ref('B', 8));
near('I17 總獲利', k.totalProfit, ref('I', 17));

near('A11 每日浮動區間下限', report.band.all[0], ref('A', 11), 1e-4);
near('B11 每日浮動區間上限', report.band.all[1], ref('B', 11), 1e-4);
near('C11 95%單日風險值', report.var95, ref('C', 11), 1e-4);
near('D11 最大單日虧損(商品)', report.worstDayProd, ref('D', 11), 1e-4);
near('E11 日累計MAXDD', report.ddProd, ref('E', 11), 1e-4);
near('A13 近三年每日浮動區間下限', report.band.recent[0], ref('A', 13), 1e-4);
near('B13 近三年每日浮動區間上限', report.band.recent[1], ref('B', 13), 1e-4);
near('D12 最大連虧月份', report.maxLossMonthStreak, ref('D', 12));
near('D13 年度最多虧損月份', report.maxLossMonthsInYear, ref('D', 13));
near('E13 最大平倉虧(概)', report.ddApprox, ref('E', 13), 1e-4);
near('E15 最大策略虧(概)', report.strategyLoss, ref('E', 15), 1e-4);

near('D19 每口保證金', p.marginPerLot, ref('D', 19));
near('B22 比例後總口數', p.lots.total, ref('B', 22));
near('C22 比例後當沖口數', p.lots.dayTrade, ref('C', 22));
near('D22 比例後留倉口數', p.lots.hold, ref('D', 22));
near('E22 比例後超額保證金口數', p.lots.excess, ref('E', 22));
near('B24 動用保證金', p.margin, ref('B', 24));
near('B25 期貨保證金', p.futuresMargin, ref('B', 25));
near('B26 最少資金準備', p.minCapital, ref('B', 26), 1e-4);
near('B27 兩套資金準備', p.twoSetCapital, ref('B', 27), 1e-4);
near('D24 預期年報酬', p.expectedAnnual, ref('D', 24), 1e-4);
near('D25 預期報酬率', p.expectedReturn, ref('D', 25), 1e-4);
near('D26 預期風險', p.expectedRisk, ref('D', 26), 1e-4);
eq('D27 保證金檢核', p.marginCheck, ref('D', 27));

// 月矩陣(H3:P14)、年報酬(H15:P15)、年DD(H16:P16)
const yearCols = [];
for (let ci = 7; ci <= 15; ci++) { // H..P
  const y = sheet.rows[1]?.[ci];
  if (typeof y === 'number' && y > 1990) yearCols.push([ci, y]);
}
for (const [ci, y] of yearCols) {
  const idx = report.years.indexOf(y);
  if (idx < 0) continue; // 原表固定到 2027,資料没那么长時跳過
  for (let mth = 0; mth < 12; mth++) near(`${y}-${mth + 1} 月`, report.matrix[mth][idx], ref(colName(ci), mth + 3), 1e-4);
  near(`${y} 年報酬`, report.annualRet[idx], ref(colName(ci), 15), 1e-4);
  near(`${y} 年DD`, report.annualDD[idx], ref(colName(ci), 16), 1e-4);
}

// 創高
eq('D30 最新創高日', fmtDate(report.highs.latestHigh), fmtDate(ref('D', 30)));
near('D31 距離上次創高', report.highs.latestHighDays, ref('D', 31));
const r31 = rowOfLabel('DD 40 Day Avg');
if (r31) near(`${r31} 列 DD 40 Day Avg`, report.highs.recent5Avg, ref('B', r31), 1e-4);
for (let i = 0; i < 3; i++) {
  const r = 34 + i;
  near(`B${r} 第${i + 1}久 DD 日數`, report.highs.longByLength[i]?.days, ref('B', r));
  eq(`C${r} 起始日`, fmtDate(report.highs.longByLength[i]?.start), fmtDate(ref('C', r)));
  eq(`D${r} 創高日`, fmtDate(report.highs.longByLength[i]?.end), fmtDate(ref('D', r)));
}

console.log(fail ? `\n${fail} 项与原表不符` : '\n全部与原 Excel 總表一致');
process.exit(fail ? 1 : 0);

function colName(ci) { // 0-based index -> letter
  let n = ci + 1, s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}
