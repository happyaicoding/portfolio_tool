// 投資組合版本(portfolios.json)的資料層:清單解析/寫出、策略檔指紋、比較表的指標定義。
// 純函式、無 DOM,Node 可直測。
//
// 一個投資組合 = 根目錄下的一個子資料夾(資料夾內仍有自己的 portfolio-config.json 當即時設定)。
// 清單只記「名稱、說明、資料夾、建立時間、存檔當下的策略指紋」;設定不複製一份進來,
// 免得兩邊漂移 —— 即時設定的唯一來源是該資料夾的 portfolio-config.json。
import { fmtDate } from './core.js';
import { settingsFromPlain, weightsFromPlain } from './config.js';

export const REGISTRY_NAME = 'portfolios.json';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---------- 策略檔指紋 ----------

/** 每支策略的內容指紋:筆數、未加權累計損益、起訖日。檔名是固定槽位,內容才是身分。 */
export function fingerprints(strategies) {
  const out = {};
  for (const s of strategies) {
    let sum = 0;
    let from = Infinity;
    let to = -Infinity;
    for (const [d, v] of s.rows) {
      sum += v;
      if (d < from) from = d;
      if (d > to) to = d;
    }
    out[s.name] = {
      rows: s.rows.length,
      sum: Math.round(sum * 100) / 100,
      from: Number.isFinite(from) ? fmtDate(from) : null,
      to: Number.isFinite(to) ? fmtDate(to) : null,
    };
  }
  return out;
}

const sameFp = (a, b) => !!a && !!b && a.rows === b.rows && a.sum === b.sum && a.from === b.from && a.to === b.to;

/** 存檔時 vs 現在的指紋差異。回傳 [{ name, saved, current, kind }]。 */
export function diffFingerprints(saved, current) {
  const out = [];
  const s = saved || {};
  const c = current || {};
  for (const name of Object.keys(s)) {
    if (!(name in c)) out.push({ name, kind: 'removed', saved: s[name], current: null });
    else if (!sameFp(s[name], c[name])) out.push({ name, kind: 'changed', saved: s[name], current: c[name] });
  }
  for (const name of Object.keys(c)) if (!(name in s)) out.push({ name, kind: 'added', saved: null, current: c[name] });
  return out;
}

/** 一句話描述指紋差異,給介面上那行紅字用。 */
export function describeDiff(d) {
  const f = (x) => `${x.rows} 筆/${x.sum.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}`;
  if (d.kind === 'removed') return `${d.name} 已不在資料夾(存檔時 ${f(d.saved)})`;
  if (d.kind === 'added') return `${d.name} 是存檔之後新增的(${f(d.current)})`;
  return `${d.name} 內容已換過(存下來時 ${f(d.saved)},現在 ${f(d.current)})`;
}

// ---------- 清單解析 / 寫出 ----------

function parseEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;
  const sub = typeof raw.sub === 'string' && raw.sub.trim() ? raw.sub.trim() : null;
  const path = typeof raw.path === 'string' && raw.path.trim() ? raw.path.trim() : null;
  if (!sub && !path) return null;
  const fp = raw.fingerprints && typeof raw.fingerprints === 'object' ? raw.fingerprints : null;
  const fingerprintsOut = {};
  for (const [k, v] of Object.entries(fp || {})) {
    if (!v || typeof v !== 'object') continue;
    if (!isNum(v.rows) || !isNum(v.sum)) continue;
    fingerprintsOut[k] = { rows: v.rows, sum: v.sum, from: typeof v.from === 'string' ? v.from : null, to: typeof v.to === 'string' ? v.to : null };
  }
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `p${Math.random().toString(36).slice(2, 8)}`,
    name,
    note: typeof raw.note === 'string' ? raw.note.trim() : '',
    sub,
    path,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : null,
    // null = 還沒建基準(不該拿空物件去比,否則每個檔都會被標成「存檔之後新增的」)
    fingerprints: fp ? fingerprintsOut : null,
  };
}

/** 解析 portfolios.json 內容。回傳 { portfolios, error }。 */
export function parseRegistry(text) {
  const out = { portfolios: [], error: null };
  if (text == null || String(text).trim() === '') return out;
  let raw = text;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw.replace(/^\uFEFF/, ''));
    } catch (e) {
      out.error = `不是有效的 JSON(${e.message})`;
      return out;
    }
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.portfolios)) { out.error = '內容缺少 portfolios 陣列'; return out; }
  for (const e of raw.portfolios) {
    const p = parseEntry(e);
    if (p) out.portfolios.push(p);
  }
  return out;
}

export function serializeRegistry(portfolios) {
  return JSON.stringify({
    version: 1,
    portfolios: portfolios.map((p) => ({
      id: p.id, name: p.name, note: p.note, sub: p.sub ?? null, path: p.path ?? null,
      createdAt: p.createdAt, savedAt: p.savedAt, fingerprints: p.fingerprints,
    })),
  }, null, 2) + '\n';
}

/** 名稱規則:非空、不重複(比對時不分大小寫與前後空白)。回傳錯誤訊息或 null。 */
export function checkName(portfolios, name, selfId = null) {
  const n = String(name ?? '').trim();
  if (!n) return '名稱不能空白。';
  if (n.length > 40) return '名稱請控制在 40 字以內。';
  if (/[\\/:*?"<>|]/.test(n)) return '名稱不要用 \\ / : * ? " < > | 這些字元(會當資料夾名)。';
  if (portfolios.some((p) => p.id !== selfId && p.name.toLowerCase() === n.toLowerCase())) return `已經有一個投資組合叫「${n}」。`;
  return null;
}

/** 說明必填一句(名稱會記混,比較表第一欄靠它辨認)。 */
export function checkNote(note) {
  const n = String(note ?? '').trim();
  if (!n) return '說明要填一句(例:2026-11 加入避險那組,拿掉 7 號)。';
  if (n.length > 200) return '說明請控制在 200 字以內。';
  return null;
}

// ---------- 比較表 ----------

export const METRICS = [
  { key: 'totalProfit', label: '總獲利', cell: 'I17', kind: 'money', better: 'high' },
  { key: 'avgAll', label: '全部月份平均獲利', cell: 'B2', kind: 'money', better: 'high' },
  { key: 'worstMonth', label: '最大月虧損', cell: 'B4', kind: 'money', better: 'high' },
  { key: 'winRate', label: '月勝率', cell: 'B5', kind: 'pct2', better: 'high' },
  { key: 'roa', label: 'ROA', cell: 'B6', kind: 'num2', better: 'high' },
  { key: 'ddProd', label: '日累計MAXDD', cell: 'E11', kind: 'money', better: 'high' },
  { key: 'recent5Avg', label: 'DD 40 Day Avg', cell: 'B31', kind: 'num1', better: 'low' },
  { key: 'top1Days', label: '第1久DD日數', cell: 'B34', kind: 'int', better: 'low' },
  { key: 'expectedAnnual', label: '預期年報酬', cell: 'D24', kind: 'money', better: 'high' },
  { key: 'expectedReturn', label: '預期報酬率', cell: 'D25', kind: 'pct1', better: 'high' },
  { key: 'expectedRisk', label: '預期風險', cell: 'D26', kind: 'pct1', better: 'high' },
  { key: 'minCapital', label: '最少資金準備', cell: 'B26', kind: 'money', better: 'low' },
  { key: 'margin', label: '動用保證金', cell: 'B24', kind: 'money', better: 'low' },
  { key: 'strategyCount', label: '納入策略數', cell: '', kind: 'int', better: null },
  { key: 'weightSum', label: '權重總和', cell: '', kind: 'num1', better: null },
];

/** 一次報表結果 → 比較表的 15 個數字。product 用該投资组合自己的設定。 */
export function metricsOf(r, strategies) {
  const p = r.settings.product;
  const h = r.highs;
  const active = strategies.filter((s) => s.allocation > 0);
  return {
    totalProfit: r.kpi.totalProfit,
    avgAll: r.kpi.avgAll[p],
    worstMonth: r.kpi.worstMonth[p],
    winRate: r.kpi.winRate,
    roa: r.kpi.roa,
    ddProd: r.ddProd,
    recent5Avg: h.recent5Avg,
    top1Days: h.longByLength[0]?.days ?? null,
    expectedAnnual: r.plan.expectedAnnual,
    expectedReturn: r.plan.expectedReturn,
    expectedRisk: r.plan.expectedRisk,
    minCapital: r.plan.minCapital,
    margin: r.plan.margin,
    strategyCount: active.length,
    weightSum: strategies.reduce((a, s) => a + (s.allocation || 0), 0),
  };
}

/** 每列的最佳/最差索引(null = 該列不比)。回傳 { key: {best, worst} }。 */
export function rankMetrics(rows) {
  const out = {};
  for (const m of METRICS) {
    const vals = rows.map((r) => {
      const v = r.error ? null : r.metrics?.[m.key];
      return Number.isFinite(v) ? v : null;
    });
    if (!m.better) { out[m.key] = { best: -1, worst: -1 }; continue; }
    let best = -1;
    let worst = -1;
    vals.forEach((v, i) => {
      if (v == null) return;
      if (best < 0 || (m.better === 'high' ? v > vals[best] : v < vals[best])) best = i;
      if (worst < 0 || (m.better === 'high' ? v < vals[worst] : v > vals[worst])) worst = i;
    });
    // 只有一欄有值時不標最佳/最差,那沒有意義
    const n = vals.filter((v) => v != null).length;
    out[m.key] = n >= 2 ? { best, worst } : { best: -1, worst: -1 };
  }
  return out;
}

/** 該列的差值(本版 - 基準版);任一邊缺值就回 null。 */
export function diffValue(got, base) {
  if (!Number.isFinite(got) || !Number.isFinite(base)) return null;
  return got - base;
}

/** 從清單與即時設定組出比較表要用的一列資料(成功時帶 metrics,失敗時帶 error)。 */
export function compareRow(entry, error, r, strategies) {
  if (error) return { entry, error };
  return { entry, metrics: metricsOf(r, strategies), settings: r.settings };
}

/** 比較表取數值:metrics 裡的值。 */
export function valueOf(row, key) {
  if (row.error) return null;
  return row.metrics ? row.metrics[key] : null;
}

export { settingsFromPlain, weightsFromPlain };
