// 直接讀原始 .xlsm 的「文字檔」工作表,走完整流程(解析 → 計算),與原表基準值比對。
// 逐格對原表是 tests/excel-oracle.test.mjs 的責任;這裡只鎖「管線沒斷 + 結構沒跑掉」。
// 用法:node tests/xlsm.test.mjs [xlsm 路徑]
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadFile, parseXlsx } from '../web/src/parse.js';
import { computeReport, parseDate, fmtDate } from '../web/src/core.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2] || readdirSync(root).find((f) => f.endsWith('.xlsm'));
if (!name) {
  console.error('✗ 找不到 .xlsm:請把原始報表檔放在專案根目錄(或當作參數傳入)');
  process.exit(1);
}
const filePath = path.isAbsolute(name) ? name : path.join(root, name);
const buf = readFileSync(filePath);
const bytes = () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const file = { name, arrayBuffer: bytes };

const strategies = await loadFile(file);
let fail = 0;
const check = (label, ok, detail) => { if (!ok) fail++; console.log(ok ? '✓' : '✗', label, detail ?? ''); };
const near = (label, got, want) => check(label, Number.isFinite(got) && Math.abs(got - want) <= Math.max(1e-6, Math.abs(want) * 1e-9), `${got} (基準 ${want})`);

// 結構:基準檔是 20 條策略,開始日期寫在 文字檔 B1
check('策略數 20', strategies.length === 20, `得 ${strategies.length}`);
check('開始日期取自 文字檔 B1 = 2019-10-01', fmtDate(strategies.startDate) === '2019-10-01', fmtDate(strategies.startDate));

// 日軸尾日:原表是「開始日期 → 更新當天」,窗口由 日週期!G8 決定(同 excel-oracle.test.mjs)
const sheets = await parseXlsx(await bytes());
const g8 = sheets.find((s) => s.name === '日週期')?.rows[7]?.[6];
const axisDays = typeof g8 === 'number' && g8 > 2 ? g8 - 2 : undefined;
check('讀到 日週期!G8', axisDays != null, `G8=${g8}`);
const opts = { startDate: strategies.startDate, lastDate: axisDays == null ? undefined : strategies.startDate + (axisDays - 1) * 86400000 };
const settings = { product: 'TMF', calcYear: 2026, endDate: parseDate('2026-06-30'), capital: 1000000 };

const r = computeReport(strategies, settings, opts);
console.log('日數', r.dates.length, fmtDate(r.dates[0]), fmtDate(r.dates.at(-1)));
near('avgAll TX (總表 B2)', r.kpi.avgAll.TX, 662501.064167);
near('worstMonth TX (B4)', r.kpi.worstMonth.TX, -2791493.99);
near('maxPositionLoss TX (B7)', r.kpi.maxPositionLoss.TX, -5675024.823);
near('worstDay TX (B8)', r.kpi.worstDay.TX, -1172201.16);
near('totalProfit TMF (I17)', r.kpi.totalProfit, 2782504.4695);
check('latestHigh (D30)', fmtDate(r.highs.latestHigh) === '2026-06-28', fmtDate(r.highs.latestHigh));
near('DD 40 Day Avg (B31)', r.highs.recent5Avg, 69);

// 回歸:近三年月平均與「計算年份」無關(原表固定取最後三年);預期年報酬 = min(全部, 近三年) × 商品倍率 × 12
const r25 = computeReport(strategies, { ...settings, calcYear: 2025 }, opts);
check('計算年份 2025 時近三年月平均不變', Math.abs(r25.kpi.avgRecent.TX - r.kpi.avgRecent.TX) < 1e-9, `${r25.kpi.avgRecent.TX} vs ${r.kpi.avgRecent.TX}`);
const expectAnnual = Math.min(r.kpi.avgAll.TX, r.kpi.avgRecent.TX) * 0.05 * 12;
near('預期年報酬 = min(全部, 近三年) × 0.05 × 12', r25.plan.expectedAnnual, expectAnnual);

console.log(fail ? `\n${fail} 項失敗` : '\nxlsm 完整流程測試通過');
process.exit(fail ? 1 : 0);
