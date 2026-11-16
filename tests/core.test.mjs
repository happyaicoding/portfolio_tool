// core.js 的回歸測試:合成資料,不需要 .xlsm(對照原表逐格比對交給 tests/excel-oracle.test.mjs)。
// 涵蓋本輪修掉的缺陷:MAXDD/MovingDayDD 語義、算不出來時回傳 null、起始日超過資料末日、
// floatBand 的先四捨五入再加減、DD 40 Day Avg 的小數平均、extent 的引數上限。
import {
  maxDD, movingDayDD, buildDailySeries, computeHighs, computeReport, fmtDate, extent,
} from '../web/src/core.js';

let fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(ok ? '✓' : '✗', label, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};
const isOk = (label, cond, detail = '') => {
  if (!cond) fail++;
  console.log(cond ? '✓' : '✗', label, cond ? '' : detail);
};

const DAY = 86400000;
const days = (n, from = Date.UTC(2024, 0, 1)) => Array.from({ length: n }, (_, i) => from + i * DAY);
const strat = (vals, from = Date.UTC(2024, 0, 1)) => [{ name: 'S', rows: vals.map((v, i) => [from + i * DAY, v]) }];

// 遞迴掃一遍結果,任何 NaN/Infinity 都算失敗(0/0 造成的 NaN 原本會一路流進介面)
const findBad = (v, p = '', out = []) => {
  if (typeof v === 'number') { if (!Number.isFinite(v)) out.push(`${p}=${v}`); return out; }
  if (v && typeof v === 'object') {
    if (Array.isArray(v)) v.forEach((x, i) => findBad(x, `${p}[${i}]`, out));
    else for (const [k, x] of Object.entries(v)) findBad(x, `${p}.${k}`, out);
  }
  return out;
};
const noNaN = (label, r) => isOk(label, findBad(r).length === 0, findBad(r).join(' '));

// ---------- VBA MAXDD / MovingDayDD 的語義 ----------

// 累計創新低才記錄、累計回到 >=0 就歸零重算;不是標準「自高點回落」的回撤
eq('MAXDD 創新低累計、回正歸零', maxDD([100, -50, -80, 200, -30]), -130);
eq('MAXDD 全程獲利 = 0', maxDD([10, 20, 30]), 0);
eq('MovingDayDD 累計對歷史高點的回落', movingDayDD([100, -50, -80, 200, -30]), -30);

// ---------- 指標算不出來時回傳 null,而不是 NaN ----------

const allZero = computeReport(strat([0, 0, 0]), { product: 'TX' }, {});
eq('資料全 0:月平均 null', allZero.kpi.avgAll.TX, null);
eq('資料全 0:勝率 null', allZero.kpi.winRate, null);
eq('資料全 0:ROA 無分母 null', allZero.kpi.roa, null);
eq('資料全 0:三商品欄位一併 null', allZero.kpi.avgAll, { TX: null, MTX: null, TMF: null });
noNaN('資料全 0:整份結果沒有 NaN/Infinity', allZero);

const ratioZero = computeReport(strat([100, -50, 80]), { product: 'TX', ratio: 0 }, {});
eq('比例 0:月平均 null', ratioZero.kpi.avgAll.TX, null);
eq('比例 0:勝率 null', ratioZero.kpi.winRate, null);
noNaN('比例 0:整份結果沒有 NaN/Infinity', ratioZero);

// 計算年份早於資料 → 該年底的累計日數為 0,窗口是空的
const oldYear = computeReport(strat([100, -50, 80]), { product: 'TX', calcYear: 1999 }, {});
eq('計算年份早於資料:每日浮動區間 null', oldYear.band.all, null);
eq('計算年份早於資料:近三年區間 null', oldYear.band.recent, null);
eq('計算年份早於資料:風險值 null', oldYear.var95, null);
noNaN('計算年份早於資料:整份結果沒有 NaN/Infinity', oldYear);

// 從不虧損 → 回撤 0,ROA 沒有分母
eq('從不虧損:ROA null', computeReport(strat([5, 6, 7]), { product: 'TX' }, {}).kpi.roa, null);

// 資金基礎為 0(自訂資金 0 且口數 0 → 最少資金準備 0)時不該出現 Infinity
const noCapital = computeReport(strat([5, 6, 7]), {
  product: 'TX', capital: 0, lots: { total: 0, dayTrade: 0, hold: 0, excess: 0 },
}, {});
eq('資金基礎 0:預期報酬率 null', noCapital.plan.expectedReturn, null);
eq('資金基礎 0:預期風險 null', noCapital.plan.expectedRisk, null);
noNaN('資金基礎 0:整份結果沒有 NaN/Infinity', noCapital);

// ---------- 起始日填超過資料範圍 ----------

const data = strat([1, 2, 3]);
const beyond = Date.UTC(2024, 3, 1);
let threw = null;
let res = null;
try { res = computeReport(data, {}, { startDate: beyond }); } catch (e) { threw = e; }
isOk('起始日晚於資料末日不再拋 RangeError', threw === null, threw && `${threw.name}: ${threw.message}`);
eq('該情況回傳 null,讓介面顯示明確提示', res, null);
eq('buildDailySeries 同情況回傳空日序列', buildDailySeries(data, { startDate: beyond }).dates, []);

// ---------- 每日浮動區間:平均數與標準差各自先 ROUND(...,1) 再加減 ----------

// avg = 100.02、STDEVP = 0.06 → 原表是 ROUND(100.02,1) ∓ ROUND(0.06,1) = 100.0 ∓ 0.1
// 若先相減再四捨五入會得到 100.0 / 100.1,所以這個案例能辨出兩種寫法
const bandCase = computeReport(strat([100.08, 99.96], Date.UTC(2024, 0, 2)), { product: 'TX' }, {});
eq('每日浮動區間 = ROUND(平均,1) ∓ ROUND(STDEVP,1)', bandCase.band.all, [99.9, 100.1]);

// ---------- DD 40 Day Avg:最近 5 段的平均天數,保留小數 ----------

const dd = [].concat(Array(45).fill(-1), [100], Array(50).fill(-1), [100]);
const ddDates = days(dd.length);
const highs = computeHighs(ddDates, dd, { endDate: ddDates.at(-1), threshold: 40 });
eq('未創高超過門檻的段(由近到遠)', highs.longByRecency.map((g) => g.days), [50, 45]);
eq('DD 40 Day Avg = (50+45)/2 = 47.5(不取整)', highs.recent5Avg, 47.5);
eq('門檻提高到 45 天:只剩 50 天那段',
  computeHighs(ddDates, dd, { endDate: ddDates.at(-1), threshold: 45 }).recent5Avg, 50);
eq('尾端已重新創高:最新創高日 = 最後回落段的起點(Y3=X3−Z3)',
  fmtDate(highs.latestHigh), fmtDate(ddDates[45]));
eq('距離上次創高 = 該段天數', highs.latestHighDays, 50);

// ---------- 日軸尾日:原表的軸尾是「今天」,尾端沒資料的日子補 0 ----------
{
  const from = Date.UTC(2024, 0, 1);
  const s = strat([100, -100, 100], from);
  const padded = buildDailySeries(s, { lastDate: from + 9 * DAY });
  eq('lastDate 把日軸補到指定日', padded.dates.length, 10);
  eq('補進來的是 0(不影響總獲利)', padded.total.slice(3).every((v) => v === 0), true);
  const short = computeReport(s, { calcYear: 2024 }, {});
  const long = computeReport(s, { calcYear: 2024 }, { lastDate: from + 9 * DAY });
  isOk('軸尾長度會改變每日浮動區間(所以必須跟今天才對得上原表)',
    short.band.all[0] !== long.band.all[0] || short.band.all[1] !== long.band.all[1],
    `只到資料末日 ${short.band.all} vs 軸尾拉長 ${long.band.all}`);
  eq('兩種軸尾的總獲利相同', long.kpi.totalProfit, short.kpi.totalProfit);
}

// ---------- extent 不受 V8 引數上限影響(Math.min(...arr) 約 12.5 萬筆就會爆)----------

const big = new Array(300000).fill(0).map((_, i) => (i === 123456 ? -9 : i));
eq('extent 30 萬筆不爆 stack', extent(big), [-9, 299999]);

console.log(fail ? `\n${fail} 項失敗` : '\ncore 回歸測試通過');
process.exit(fail ? 1 : 0);
