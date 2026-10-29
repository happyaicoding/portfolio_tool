// 直接讀原始 .xlsm 的「文字檔」工作表,走完整流程(解析 → 計算),與 Excel 快取值比對。
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadFile } from '../web/src/parse.js';
import { computeReport, parseDate, fmtDate } from '../web/src/core.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = readdirSync(root).find((f) => f.endsWith('.xlsm'));
const buf = readFileSync(path.join(root, name));
const file = { name, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
const strategies = await loadFile(file);
console.log('策略數', strategies.length, strategies.map((s) => `${s.name}:${s.rows.length}`).join(' '));
const r = computeReport(strategies, { product: 'TMF', calcYear: 2026, endDate: parseDate('2026-06-30'), capital: 1000000 },
  { startDate: parseDate('2019-10-01'), lastDate: parseDate('2026-10-11') });
console.log('日數', r.dates.length, fmtDate(r.dates[0]), fmtDate(r.dates.at(-1)));
const want = { avgAll: 423228.1611904764, worstMonth: -1386662.5700000003, maxPositionLoss: -4603357.876000001, worstDay: -900236.66 };
let fail = 0;
for (const [k, v] of Object.entries(want)) {
  const got = r.kpi[k].TX; const ok = Math.abs(got - v) < 1e-6 * Math.abs(v);
  if (!ok) fail++; console.log(ok ? '✓' : '✗', k, got, v);
}
const check = (label, ok, detail) => { if (!ok) fail++; console.log(ok ? '✓' : '✗', label, detail); };
check('totalProfit', Math.abs(r.kpi.totalProfit - 1777558.277) < 0.01, r.kpi.totalProfit);
check('latestHigh', fmtDate(r.highs.latestHigh) === '2026-06-24', fmtDate(r.highs.latestHigh));
// 回歸:近三年月平均與「計算年份」無關(原表固定取最後三年),預期年報酬 = min(全部, 近三年) × 12
const r25 = computeReport(strategies, { product: 'TMF', calcYear: 2025, endDate: parseDate('2026-06-30'), capital: 1000000 },
  { startDate: parseDate('2019-10-01'), lastDate: parseDate('2026-10-11') });
check('計算年份 2025 時近三年月平均不變', Math.abs(r25.kpi.avgRecent.TX - 690906.97) < 0.01, r25.kpi.avgRecent.TX);
check('預期年報酬 = 全部月平均 × 12', Math.abs(r25.plan.expectedAnnual - 253936.8967) < 0.01, r25.plan.expectedAnnual);
process.exit(fail ? 1 : 0);
