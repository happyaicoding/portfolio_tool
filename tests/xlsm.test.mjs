// 直接讀原始 .xlsm 的「文字檔」工作表,走完整流程(解析 → 計算),與 Excel 快取值比對。
import { readFileSync, readdirSync } from 'node:fs';
import { loadFile } from '../web/src/parse.js';
import { computeReport, parseDate, fmtDate } from '../web/src/core.js';

const name = readdirSync(new URL('..', import.meta.url).pathname).find((f) => f.endsWith('.xlsm'));
const buf = readFileSync(new URL('../' + name, import.meta.url));
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
console.log('totalProfit', r.kpi.totalProfit, '(Excel 1777558.277)');
console.log('latestHigh', fmtDate(r.highs.latestHigh), '(Excel 2026-06-24)');
process.exit(fail ? 1 : 0);
