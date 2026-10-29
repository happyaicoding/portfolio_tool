// 黃金龜投資組合績效報表 — 核心計算(無 DOM、無外部相依,瀏覽器與 Node 皆可用)
// 公式對應原 Excel(.xlsm):總表 / 資料貼入 / 日週期 / 創高計算 與 VBA MAXDD、MovingDayDD。

const DAY_MS = 86400000;

// 商品規格:相對大台(TX)的倍率
export const PRODUCTS = {
  TX: { label: 'TX(大台)', factor: 1 },
  MTX: { label: 'MTX(小台)', factor: 0.25 },
  TMF: { label: 'TMF(微台)', factor: 0.05 },
};

export const DEFAULT_SETTINGS = {
  product: 'TMF',
  ratio: 1, // 總表 B19 比例
  calcYear: null, // 總表 B14 計算年份(只影響「近三年每日浮動區間」與每日浮動區間的截止年底)
  endDate: null, // 總表 B30 資料結束日期(創高天數計算用),null = 資料最後一天
  txMargin: 636000, // 總表 C18 大台保證金
  lots: { total: 10, dayTrade: 4, hold: 6, excess: 4 }, // 總表 B21:E21
  capital: 1000000, // 總表 B28 自訂資金,null/0 = 用最少資金準備
  streakThreshold: 40, // 創高計算 V1
};

// ---------- 日期工具(一律以 UTC 日序處理,避免時區與夏令時間誤差) ----------

export function parseDate(s) {
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(String(s).trim());
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

export function fmtDate(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

// ---------- Excel 自訂函數的忠實移植 ----------

// VBA MAXDD:累計損益創新低即記錄,累計回到 >=0 即歸零重算(注意:不是標準的「自高點回落」)。
export function maxDD(arr, from = 0, to = arr.length) {
  let thisSum = 0;
  let maxSum = 0;
  for (let i = from; i < to; i++) {
    thisSum += arr[i];
    if (thisSum <= maxSum) maxSum = thisSum;
    else if (thisSum >= 0) thisSum = 0;
  }
  return maxSum;
}

// VBA MovingDayDD:目前累計損益相對歷史高點(起點 0)的回落,<=0。
export function movingDayDD(arr, from = 0, to = arr.length) {
  let thisSum = 0;
  let maxSum = 0;
  for (let i = from; i < to; i++) {
    thisSum += arr[i];
    if (thisSum >= maxSum) maxSum = thisSum;
  }
  return thisSum - maxSum;
}

const avg = (a, from, to) => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i];
  return s / (to - from);
};
// STDEVP:母體標準差
const stdevp = (a, from, to) => {
  const m = avg(a, from, to);
  let s = 0;
  for (let i = from; i < to; i++) s += (a[i] - m) ** 2;
  return Math.sqrt(s / (to - from));
};
const round1 = (x) => Math.round(x * 10) / 10;

// ---------- 資料整併 ----------

/**
 * strategies: [{ name, rows: [[dateMs, pnl], ...], allocation? }]
 * 回傳逐日(日曆日,含假日補 0)的組合損益,對應「策略報表」Total 欄。
 * 同一策略同日重複會加總;Excel 的 VLOOKUP 只取第一筆,實務上日期應唯一。
 */
export function buildDailySeries(strategies, { startDate = null, lastDate = null } = {}) {
  let min = Infinity;
  let max = -Infinity;
  for (const s of strategies) {
    for (const [d] of s.rows) {
      if (d < min) min = d;
      if (d > max) max = d;
    }
  }
  if (!isFinite(min)) return { dates: [], total: [], perStrategy: [] };
  if (startDate != null) min = startDate;
  if (lastDate != null) max = lastDate;
  const n = Math.round((max - min) / DAY_MS) + 1;
  const dates = new Array(n);
  for (let i = 0; i < n; i++) dates[i] = min + i * DAY_MS;
  const total = new Array(n).fill(0);
  const perStrategy = strategies.map((s) => {
    const col = new Array(n).fill(0);
    for (const [d, v] of s.rows) {
      const i = Math.round((d - min) / DAY_MS);
      if (i >= 0 && i < n) col[i] += v;
    }
    const w = s.allocation ?? 1;
    for (let i = 0; i < n; i++) total[i] += col[i] * w;
    return col;
  });
  return { dates, total, perStrategy };
}

// ---------- 創高天數(創高計算工作表) ----------

/**
 * 以日曆日計算「連續未創高天數」。
 * - streak[i]:第 i 天仍在回落中的連續天數(創高/持平 = 0,超過 endDate = 0)
 * - 回傳每段 streak 的結束日、起始日、天數,以及目前距最新創高日。
 */
export function computeHighs(dates, daily, { endDate, threshold = 40 }) {
  const n = daily.length;
  const streak = new Array(n).fill(0);
  let cum = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    cum += daily[i];
    if (cum >= peak) peak = cum;
    const inDD = cum - peak !== 0;
    if (dates[i] > endDate || !inDD) streak[i] = 0;
    else streak[i] = 1 + (i > 0 ? streak[i - 1] : 0);
  }
  const segments = [];
  for (let i = 0; i < n; i++) {
    const next = i + 1 < n ? streak[i + 1] : 0;
    if (streak[i] > 0 && next === 0) {
      segments.push({
        end: dates[i],
        start: dates[i] - streak[i] * DAY_MS,
        days: streak[i],
      });
    }
  }
  const long = segments.filter((s) => s.days > threshold);
  // 最新創高日 = 最後一個回落日 - 該段天數(對應 Y3 = X3 - Z3)
  let latestHigh = null;
  let latestHighDays = 0;
  for (let i = n - 1; i >= 0; i--) {
    if (streak[i] > 0) {
      const z = (i + 1 < n ? streak[i + 1] : 0) === 0 ? streak[i] : 0;
      latestHigh = dates[i] - z * DAY_MS;
      latestHighDays = z;
      break;
    }
  }
  return {
    streak,
    segments,
    longByRecency: [...long].sort((a, b) => b.end - a.end),
    longByLength: [...long].sort((a, b) => b.days - a.days || a.end - b.end),
    latestHigh,
    latestHighDays,
  };
}

// ---------- 月/年損益矩陣(資料貼入 G5:P16、總表 H3:P16) ----------

export function monthlyMatrix(dates, daily) {
  const byYm = new Map();
  for (let i = 0; i < dates.length; i++) {
    const d = new Date(dates[i]);
    const key = d.getUTCFullYear() * 100 + d.getUTCMonth() + 1;
    byYm.set(key, (byYm.get(key) || 0) + daily[i]);
  }
  const firstYear = new Date(dates[0]).getUTCFullYear();
  const lastYear = new Date(dates[dates.length - 1]).getUTCFullYear();
  const years = [];
  for (let y = firstYear; y <= lastYear; y++) years.push(y);
  const matrix = Array.from({ length: 12 }, (_, m) =>
    years.map((y) => byYm.get(y * 100 + m + 1) || 0),
  );
  return { years, matrix };
}

// 最大連續虧損月份數(資料貼入 T 欄):按時間順序逐月,<0 才累加
function maxConsecutiveLossMonths(years, matrix) {
  let run = 0;
  let best = 0;
  for (let c = 0; c < years.length; c++) {
    for (let m = 0; m < 12; m++) {
      if (matrix[m][c] < 0) {
        run += 1;
        if (run > best) best = run;
      } else run = 0;
    }
  }
  return best;
}

// ---------- 總表 ----------

export function computeReport(strategies, userSettings = {}, seriesOpts = {}) {
  const s = { ...DEFAULT_SETTINGS, ...userSettings, lots: { ...DEFAULT_SETTINGS.lots, ...(userSettings.lots || {}) } };
  const { dates, total: daily, perStrategy } = buildDailySeries(strategies, seriesOpts);
  if (!dates.length) return null;

  const pf = PRODUCTS[s.product].factor; // 顯示商品倍率
  const ratio = s.ratio;
  const n = daily.length;
  const dataLast = (() => {
    for (let i = n - 1; i >= 0; i--) if (daily[i] !== 0) return dates[i];
    return dates[n - 1];
  })();
  const endDate = s.endDate ?? dataLast;
  const calcYear = s.calcYear ?? new Date(dataLast).getUTCFullYear();

  // 年度區間(日週期 M2:AH4 的累計日數)
  const { years, matrix } = monthlyMatrix(dates, daily);
  const yearEnd = new Map(); // 年 -> 累計日數(含該年)
  {
    let c = 0;
    let y0 = new Date(dates[0]).getUTCFullYear();
    for (let i = 0; i < n; i++) {
      const y = new Date(dates[i]).getUTCFullYear();
      if (y !== y0) {
        yearEnd.set(y0, c);
        y0 = y;
      }
      c = i + 1;
    }
    yearEnd.set(y0, c);
  }
  const yEndIdx = (y) => {
    // HLOOKUP 近似比對:取 <= y 的最近一年之累計日數
    let best = 0;
    for (const [yy, cnt] of yearEnd) if (yy <= y && cnt > best) best = cnt;
    return best;
  };
  const G8 = yEndIdx(calcYear); // 計算年份最後一天(筆數)

  // 逐月矩陣(產品基準 = 比例 * 商品倍率)
  const scale = ratio * pf;
  const m = matrix.map((row) => row.map((v) => v * scale));
  const flat = m.flat();
  const nonZero = flat.filter((v) => v !== 0);
  const recent = (() => {
    // 近三年 = 資料最後三個年度(原表固定取 M:O 三欄,與「計算年份」無關)
    const cols = years.map((_, c) => c).slice(-3);
    return m.flatMap((row) => cols.map((c) => row[c])).filter((v) => v !== 0);
  })();
  const sum = (a) => a.reduce((x, y) => x + y, 0);

  // 以大台基準計算(TX),再乘 0.25 / 0.05 得小台/微台
  const toTX = 1 / pf;
  const avgAll = (sum(nonZero) / nonZero.length) * toTX;
  const avgRecent = (sum(recent) / recent.length) * toTX;
  const worstMonth = Math.min(...flat) * toTX;
  const pos = flat.filter((v) => v > 0).length;
  const winRate = pos / nonZero.length;
  const totalProfitProd = sum(flat);
  const mddAll = maxDD(daily) * ratio; // TX 基準
  const maxPositionLoss = mddAll * 1.3;
  const roa = (totalProfitProd / pf) / -maxPositionLoss; // 原式 (I17/-B7)*商品係數,換算成大台基準,結果與商品無關
  const worstDay = Math.min(...daily) * ratio;

  // 每日浮動區間(日週期 G2:H3)
  const allStd = [round1(avg(daily, 0, G8) - stdevp(daily, 0, G8)), round1(avg(daily, 0, G8)) + round1(stdevp(daily, 0, G8))];
  // 原式 INDEX(B:B, G8-1095):INDEX(B:B, G8) → 最後 1096 筆
  const rLo = Math.max(0, G8 - 1096);
  const a3 = round1(avg(daily, rLo, G8)) - round1(stdevp(daily, rLo, G8));
  const b3 = round1(avg(daily, rLo, G8)) + round1(stdevp(daily, rLo, G8));
  const band = {
    all: [allStd[0] * ratio * pf, allStd[1] * ratio * pf],
    recent: [a3 * ratio * pf, b3 * ratio * pf],
  };
  const var95 = -((Math.abs(band.all[0]) + Math.abs(band.all[1])) / 2) * 1.97;

  // 年報酬 / 年 DD
  const annualRet = years.map((_, c) => sum(m.map((row) => row[c])));
  const annualDD = years.map((y) => {
    const from = yEndIdx(y - 1);
    const to = yEndIdx(y);
    return maxDD(daily, from, to) * scale;
  });
  const lossMonthsByYear = years.map((_, c) => m.filter((row) => row[c] < 0).length);

  // 商品基準的最大平倉虧損
  const ddProd = maxDD(daily) * scale; // 日累計 MAXDD(E11)
  const ddApprox = ddProd * 1.3; // 最大平倉虧(概)(E13)
  const strategyLoss = ddProd * 2; // 最大策略虧(概)(E15)

  // 保證金與資金規劃
  const marginPerLot = s.txMargin * pf; // D19:大台 / 4 / 20,與 factor 一致
  const lots = {
    total: Math.round(s.lots.total * ratio),
    dayTrade: Math.round(s.lots.dayTrade * ratio),
    hold: Math.round(s.lots.hold * ratio),
    excess: Math.round(s.lots.excess * ratio),
  };
  const margin = lots.total * marginPerLot;
  const futuresMargin = margin * 1.3;
  const minCapital = futuresMargin - strategyLoss;
  const twoSetCapital = futuresMargin - strategyLoss * 2;
  const expectedAnnual = Math.min(avgAll * pf, avgRecent * pf) * 12;
  const capitalBase = s.capital ? s.capital : minCapital;
  const needMargin = (lots.dayTrade + lots.hold + lots.excess) * marginPerLot;
  const marginCheck = needMargin < minCapital ? 'YES' : `不足最少資金${minCapital - needMargin}`;

  const highs = computeHighs(dates, daily, { endDate, threshold: s.streakThreshold });

  return {
    settings: s,
    dates,
    daily,
    perStrategy,
    years,
    matrix: m,
    kpi: {
      avgAll: { TX: avgAll, MTX: avgAll * 0.25, TMF: avgAll * 0.05 },
      avgRecent: { TX: avgRecent, MTX: avgRecent * 0.25, TMF: avgRecent * 0.05 },
      worstMonth: { TX: worstMonth, MTX: worstMonth * 0.25, TMF: worstMonth * 0.05 },
      winRate,
      roa,
      maxPositionLoss: { TX: maxPositionLoss, MTX: maxPositionLoss * 0.25, TMF: maxPositionLoss * 0.05 },
      worstDay: { TX: worstDay, MTX: worstDay * 0.25, TMF: worstDay * 0.05 },
      totalProfit: totalProfitProd,
    },
    band,
    var95,
    worstDayProd: worstDay * pf,
    ddProd,
    ddApprox,
    strategyLoss,
    maxLossMonthStreak: maxConsecutiveLossMonths(years, matrix),
    maxLossMonthsInYear: Math.max(...lossMonthsByYear),
    annualRet,
    annualDD,
    lossMonthsByYear,
    plan: {
      marginPerLot,
      lots,
      margin,
      futuresMargin,
      minCapital,
      twoSetCapital,
      expectedAnnual,
      expectedReturn: expectedAnnual / capitalBase,
      expectedRisk: strategyLoss / capitalBase,
      marginCheck,
    },
    highs: { ...highs, endDate },
    calcYear,
  };
}
