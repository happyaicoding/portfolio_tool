// 以原 Excel 的快取值驗證 core.js。fixture 由 .xlsm 匯出(見 tests/README.md)。
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeReport, parseDate, fmtDate } from '../web/src/core.js';

const path = process.argv[2] || fileURLToPath(new URL('./fixture.json', import.meta.url));
if (!existsSync(path)) { console.log('找不到 fixture,略過'); process.exit(0); }
const fx = JSON.parse(readFileSync(path, 'utf8'));
const strategies = fx.alloc.map((w, k) => ({
  name: String(k + 1),
  allocation: w,
  rows: fx.dates.map((d, i) => [parseDate(d), fx.strategies[i][k]]),
}));
const e = fx.expected;
const r = computeReport(strategies, {
  product: 'TMF', ratio: 1, calcYear: 2026, endDate: parseDate(e.endDate),
  txMargin: 636000, capital: 1000000,
});
let fail = 0;
const near = (name, got, want, tol = 1e-6) => {
  const ok = Math.abs(got - want) <= tol * Math.max(1, Math.abs(want));
  if (!ok) { fail++; console.log('✗', name, 'got', got, 'want', want); } else console.log('✓', name, got);
};
near('avgAll', r.kpi.avgAll.TX, e.B2);
near('avgRecent', r.kpi.avgRecent.TX, e.B3);
near('worstMonth', r.kpi.worstMonth.TX, e.B4);
near('winRate', r.kpi.winRate, e.B5);
near('roa', r.kpi.roa, e.B6);
near('maxPositionLoss', r.kpi.maxPositionLoss.TX, e.B7);
near('worstDay', r.kpi.worstDay.TX, e.B8);
near('band.all[0]', r.band.all[0], e.A11);
near('band.all[1]', r.band.all[1], e.B11);
near('band.recent[0]', r.band.recent[0], e.A13);
near('band.recent[1]', r.band.recent[1], e.B13);
near('var95', r.var95, e.C11);
near('worstDayProd', r.worstDayProd, e.D11);
near('maxLossMonthStreak', r.maxLossMonthStreak, e.D12);
near('maxLossMonthsInYear', r.maxLossMonthsInYear, e.D13);
near('ddProd', r.ddProd, e.E11);
near('ddApprox', r.ddApprox, e.E13);
near('strategyLoss', r.strategyLoss, e.E15);
near('totalProfit', r.kpi.totalProfit, e.I17);
near('expectedAnnual', r.plan.expectedAnnual, e.D24);
near('expectedReturn', r.plan.expectedReturn, e.D25);
near('expectedRisk', r.plan.expectedRisk, e.D26);
near('margin', r.plan.margin, e.B24);
near('futuresMargin', r.plan.futuresMargin, e.B25);
near('minCapital', r.plan.minCapital, e.B26);
near('twoSet', r.plan.twoSetCapital, e.B27);
e.annualRet.slice(0, r.years.length).forEach((v, i) => near('annualRet ' + r.years[i], r.annualRet[i], v));
e.annualDD.slice(0, r.years.length).forEach((v, i) => near('annualDD ' + r.years[i], r.annualDD[i], v));
e.matrix.forEach((row, m) => row.slice(0, r.years.length).forEach((v, c) => near(`matrix ${r.years[c]}-${m + 1}`, r.matrix[m][c], v)));
if (fmtDate(r.highs.latestHigh) !== e.latestHigh) { fail++; console.log('✗ latestHigh', fmtDate(r.highs.latestHigh), e.latestHigh); } else console.log('✓ latestHigh', e.latestHigh);
e.streaks.forEach(([end, start, days], i) => {
  const g = r.highs.longByRecency[i];
  const ok = g && fmtDate(g.end) === end && fmtDate(g.start) === start && g.days === days;
  if (!ok) { fail++; console.log('✗ streak', i, g && [fmtDate(g.end), fmtDate(g.start), g.days], [end, start, days]); } else console.log('✓ streak', i, end, days);
});
console.log(fail ? `\n${fail} 項不符` : '\n全部符合');
process.exit(fail ? 1 : 0);
