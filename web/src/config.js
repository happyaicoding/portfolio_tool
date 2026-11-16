// 資料夾設定檔(portfolio-config.json)與投資組合版本檔(portfolios.json)共用的欄位驗證。
// CSV 沒有原表自帶的「開始日期」等輸入,所以桌面版把這些存成資料夾內的 JSON 檔:
// 跟著資料夾走、可用記事本改、換台電腦拷過去就帶著設定。日期一律 'YYYY-MM-DD' 字串。
// 這裡是純函式(無 DOM),Node 可直接測試。
import { DEFAULT_SETTINGS, PRODUCTS, parseDate, fmtDate } from './core.js';

export const CONFIG_NAME = 'portfolio-config.json';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const nonNeg = (v) => (isNum(v) && v >= 0 ? v : null);

// 日期欄位:接受 'YYYY-MM-DD' 字串或毫秒數字;空/null = 未設定
const asDay = (v) => {
  if (isNum(v)) return v;
  if (typeof v === 'string' && v.trim()) return parseDate(v.trim());
  return null;
};

/** 把設定檔裡的 settings 物件驗證成可套用的部分設定;無法理解的欄位一律丟掉。 */
export function settingsFromPlain(s) {
  const out = {};
  if (!s || typeof s !== 'object') return out;
  if (typeof s.product === 'string' && PRODUCTS[s.product]) out.product = s.product;
  const ratio = nonNeg(s.ratio);
  if (ratio != null) out.ratio = ratio;
  const startDate = asDay(s.startDate);
  if (startDate != null) out.startDate = startDate;
  const endDate = asDay(s.endDate);
  if (endDate != null) out.endDate = endDate;
  const calcYear = nonNeg(s.calcYear);
  if (calcYear != null) out.calcYear = Math.round(calcYear);
  const txMargin = nonNeg(s.txMargin);
  if (txMargin != null) out.txMargin = txMargin;
  const capital = nonNeg(s.capital);
  if (capital != null) out.capital = capital;
  const threshold = nonNeg(s.streakThreshold);
  if (threshold != null) out.streakThreshold = Math.round(threshold);
  const lots = s.lots && typeof s.lots === 'object' ? s.lots : {};
  const merged = { ...DEFAULT_SETTINGS.lots };
  let hasLot = false;
  for (const k of Object.keys(merged)) {
    const v = nonNeg(lots[k]);
    if (v != null) { merged[k] = v; hasLot = true; }
  }
  if (hasLot) out.lots = merged;
  return out;
}

/** 設定 → 寫檔用的純資料(日期轉字串,只留必要的欄位)。 */
export function settingsToPlain(s) {
  // endDate 就是原表 B30「資料結束日期」,創高天數以它為截止日,所以要一起記住,
  // 否則 CSV 模式少一個原表自帶的輸入,最新創高日/距離上次創高/DD Avg 會算到資料最後一天。
  return {
    product: s.product,
    ratio: s.ratio,
    startDate: s.startDate ? fmtDate(s.startDate) : null,
    endDate: s.endDate ? fmtDate(s.endDate) : null,
    calcYear: s.calcYear ?? null,
    txMargin: s.txMargin,
    capital: s.capital ?? null,
    streakThreshold: s.streakThreshold,
    lots: { ...s.lots },
  };
}

/** 權重表:只留「名稱 → 非負數字」。 */
export function weightsFromPlain(w) {
  const out = {};
  if (!w || typeof w !== 'object') return out;
  for (const [k, v] of Object.entries(w)) {
    const n = nonNeg(v);
    if (n != null) out[k] = n;
  }
  return out;
}

/** 解析設定檔內容(字串或已解析的物件)。回傳 { settings, weights, error }。 */
export function parseConfig(text) {
  const out = { settings: {}, weights: {}, error: null };
  let raw = text;
  if (text == null || String(text).trim() === '') return out;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw.replace(/^\uFEFF/, ''));
    } catch (e) {
      out.error = `不是有效的 JSON(${e.message})`;
      return out;
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { out.error = '內容不是物件'; return out; }
  out.settings = settingsFromPlain(raw.settings);
  out.weights = weightsFromPlain(raw.weights);
  return out;
}

/** 寫檔用的結構。 */
export function toConfigText(s, weights) {
  return JSON.stringify({ version: 1, settings: settingsToPlain(s), weights }, null, 2) + '\n';
}
