import { computeReport, strategyMonthly, parseDate, fmtDate, DEFAULT_SETTINGS, PRODUCTS, extent } from './core.js';
import { loadFile } from './parse.js';
import { CONFIG_NAME, parseConfig, toConfigText, settingsFromPlain, settingsToPlain, weightsFromPlain } from './config.js';
import {
  REGISTRY_NAME, fingerprints, diffFingerprints, describeDiff, parseRegistry, serializeRegistry,
  checkName, checkNote, metricsOf, rankMetrics, diffValue, METRICS,
} from './portfolios.js';
import { lineChart, barChart, createHeatmap } from './charts.js';

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const heatmap = createHeatmap($('heatmap'), {
  y0: $('hmY0'), y1: $('hmY1'), yall: $('hmAll'), expandAll: $('hmExpand'),
  collapseAll: $('hmCollapse'), scaleSel: $('hmScale'), showNum: $('hmNum'),
});

let strategies = []; // [{ name, rows, allocation }]
let lastReport = null; // 最近一次 computeReport 的結果(截圖記錄用)
const KEY = 'portfolio_tool.settings.v1';
const WKEY = 'portfolio_tool.weights.v1';

// 桌面版把設定與權重存成資料夾內的 portfolio-config.json(換資料夾就是另一組設定,
// 拷到別台電腦也跟著走);網站版沒有檔案權限,仍用 localStorage。
const useConfigFile = typeof window.desktop?.readConfig === 'function';
let config = { settings: {}, weights: {}, error: null }; // 目前資料夾的設定檔內容
let lastConfigText = null; // 上次寫出的內容,一樣就不重複寫檔
let configTimer = null;
let pfEntry = {}; // 目前投資組合的資料夾指標;{} = 工作區根目錄(預設投組)

const mergedSettings = () => ({
  ...DEFAULT_SETTINGS, ...config.settings,
  lots: { ...DEFAULT_SETTINGS.lots, ...(config.settings.lots || {}) },
});

function saveSettings(s) {
  if (useConfigFile) { config.settings = s; queueConfigWrite(); return; }
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 隱私模式等情況略過 */ }
}
function loadSettings() {
  if (useConfigFile) return config.settings;
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

function queueConfigWrite() {
  if (!useConfigFile) return;
  clearTimeout(configTimer);
  configTimer = setTimeout(flushConfig, 400);
}
async function flushConfig() {
  const text = toConfigText(mergedSettings(), config.weights);
  if (text === lastConfigText) return;
  lastConfigText = text;
  if (await window.desktop.writeConfig(pfEntry, text)) { setConfigWarn(''); return; }
  lastConfigText = null; // 寫失敗,下次變更再試一次
  setConfigWarn(`寫不進「${pfLabel()}」資料夾內的 ${CONFIG_NAME}(資料夾唯讀、網路碟離線或已被編輯器鎖住),設定這次變更不會留下。`);
}
function setConfigWarn(msg) {
  const el = $('configWarn');
  el.textContent = msg;
  el.hidden = !msg;
}
// 讀指定投組資料夾的設定檔並套用到介面(啟動、換投組、按重新載入時)
async function applyConfigFile(entry = pfEntry) {
  config = parseConfig(await window.desktop.readConfig(entry));
  lastConfigText = toConfigText(mergedSettings(), config.weights);
  setConfigWarn(config.error ? `設定檔讀不到:${config.error},這次以預設值計算。` : '');
  writeSettings(mergedSettings());
}

// ---------- 讀檔 ----------

async function ingest(files, { reload = false } = {}) {
  const status = $('status');
  status.className = 'status';
  status.textContent = '讀取中…';
  try {
    const loaded = [];
    const info = new Map(); // 檔名 → { strategies, rows, min, max }(給記錄用)
    let fileStart = null;
    for (const f of files) {
      const got = await loadFile(f);
      if (got.startDate != null) fileStart = got.startDate;
      if (!got.length) throw new Error(`「${f.name}」找不到「日期 + 損益」的資料欄`);
      loaded.push(...got);
      const ds = got.flatMap((s) => s.rows.map((r) => r[0]));
      const [fmin, fmax] = extent(ds);
      info.set(f.name, {
        strategies: got.length,
        rows: Math.max(...got.map((s) => s.rows.length)),
        min: fmin,
        max: fmax,
      });
    }
    const seen = new Map();
    const oldAlloc = new Map(strategies.map((s) => [s.name, s.allocation]));
    const saved = loadWeights();
    strategies = loaded.map((s) => {
      const c = (seen.get(s.name) || 0) + 1;
      seen.set(s.name, c);
      const name = c > 1 ? `${s.name}(${c})` : s.name;
      return { ...s, name, allocation: oldAlloc.get(name) ?? saved[name] ?? 1 }; // 保留已調整的權重(含上次關閉前存下的)
    });
    const all = strategies.flatMap((s) => s.rows.map((r) => r[0]));
    const [min, max] = extent(all);
    status.textContent = `已載入 ${strategies.length} 個策略,${fmtDate(min)} ~ ${fmtDate(max)}`;
    if (!reload) {
      // 只有檔案自帶開始日期(.xlsm 的「文字檔 B1」)才覆寫;CSV 沒帶時保留設定裡記住的起始日,
      // 清空會把開始日期之前的資料算進來,總獲利/月平均/ROA 就跟原表對不上了。
      if (fileStart != null) $('startDate').value = fmtDate(fileStart);
    }
    $('startDate').placeholder = fmtDate(min);
    buildAllocInputs();
    $('app').hidden = false;
    render();
    return info;
  } catch (e) {
    status.className = 'status err';
    status.textContent = e.message || String(e);
    return null;
  }
}

const weightMap = () => Object.fromEntries(strategies.map((s) => [s.name, s.allocation]));
function loadWeights() {
  if (useConfigFile) return config.weights;
  try { return JSON.parse(localStorage.getItem(WKEY)) || {}; } catch { return {}; }
}
function saveWeights() {
  if (useConfigFile) { config.weights = weightMap(); queueConfigWrite(); return; }
  try { localStorage.setItem(WKEY, JSON.stringify(weightMap())); } catch { /* 略過 */ }
}

function buildAllocInputs() {
  const rows = strategies.map((s, i) => {
    const dates = s.rows.map((r) => r[0]);
    const [from, to] = extent(dates);
    const total = s.rows.reduce((a, r) => a + r[1], 0);
    return `<tr><th>${s.name}</th>
      <td><input type="number" step="0.1" min="0" data-i="${i}" value="${s.allocation}" aria-label="${s.name} 權重"></td>
      <td>${fmtDate(from)} ~ ${fmtDate(to)}</td>
      <td>${s.rows.length}</td>
      <td class="${total < 0 ? 'neg' : ''}">${nf.format(total)}</td></tr>`;
  });
  $('alloc').innerHTML = `<tr><th>策略</th><th>權重</th><th>資料期間</th><th>筆數</th><th>累計損益(未加權)</th></tr>${rows.join('')}`;
}

function setAllWeights(v) {
  strategies.forEach((s) => { s.allocation = v; });
  buildAllocInputs();
  saveWeights();
  render();
}


// ---------- 記錄(檔案變動、截圖) ----------
// 每行:  時間 | 類型 | 內容   桌面版寫進資料夾的 portfolio-tool.log;網站版只存在這個瀏覽器。

const LOGKEY = 'portfolio_tool.log.v1';
let logLines = [];

const p2 = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;

function renderLog() {
  const rows = [...logLines].reverse().slice(0, 500).map((line) => {
    const [t, type, ...rest] = line.split(' | ');
    return `<tr><td>${t}</td><td class="t-${type}">${type ?? ''}</td><td>${rest.join(' | ')}</td></tr>`;
  });
  $('logTable').innerHTML = rows.length
    ? `<tr><th>時間</th><th>類型</th><th>內容</th></tr>${rows.join('')}`
    : '<tr><td>目前沒有記錄</td></tr>';
}

function logEvent(type, content) {
  const line = `${stamp()} | ${type} | ${content}`;
  logLines.push(line);
  if (logLines.length > 1000) logLines = logLines.slice(-1000);
  renderLog();
  if (window.desktop) window.desktop.appendLog(pfEntry, line);
  else {
    try { localStorage.setItem(LOGKEY, JSON.stringify(logLines.slice(-500))); } catch { /* 略過 */ }
  }
}

const fileText = (name, i) =>
  `${name} | ${i.strategies} 個策略 · ${nf.format(i.rows)} 筆 · ${fmtDate(i.min)} ~ ${fmtDate(i.max)}`;

// 比對前後兩次的檔案清單,只記錄真正的變動
function logFileChanges(prev, cur) {
  if (!prev) {
    for (const [name, i] of cur) logEvent('載入', fileText(name, i));
    return;
  }
  for (const [name, i] of cur) {
    const p = prev.get(name);
    if (!p) logEvent('新增', fileText(name, i));
    else if (p.size !== i.size || p.mtime !== i.mtime) {
      const d = i.rows - p.rows;
      const delta = d === 0 ? '筆數不變' : `${nf.format(p.rows)} → ${nf.format(i.rows)} 筆(${d > 0 ? '+' : ''}${nf.format(d)})`;
      logEvent('修改', `${name} | ${delta} · ${fmtDate(i.min)} ~ ${fmtDate(i.max)}`);
    }
  }
  for (const name of prev.keys()) if (!cur.has(name)) logEvent('刪除', name);
}

function switchTab(tab) {
  for (const b of document.querySelectorAll('.tabs button[data-tab]')) b.classList.toggle('on', b.dataset.tab === tab);
  for (const t of ['summary', 'settings', 'log', 'compare']) $(`tab-${t}`).hidden = t !== tab;
  if (tab === 'summary') render();
  if (tab === 'compare') renderCompare();
}

// 截圖並記錄當下績效(僅桌面版)
async function takeSnapshot() {
  if (!window.desktop) return;
  if (!lastReport) { logEvent('錯誤', '截圖失敗:目前沒有可截圖的績效(尚未載入資料,或權重全為 0)'); return; }
  switchTab('summary');
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const b = $('sheet').getBoundingClientRect();
  const res = await window.desktop.saveSnapshot(pfEntry, {
    x: b.left + window.scrollX, y: b.top + window.scrollY, width: Math.ceil(b.width), height: Math.ceil(b.height),
  });
  if (res.error) { logEvent('錯誤', `截圖失敗:${res.error}`); return; }
  const r = lastReport;
  const m = (v) => (v < 0 ? `(${nf.format(-v)})` : nf.format(v));
  const h = r.highs;
  logEvent('截圖', [
    res.name,
    `商品 ${r.settings.product} × ${Math.round(r.settings.ratio * 100)}%`,
    `總獲利 ${m(r.kpi.totalProfit)}`,
    `最大策略虧 ${m(r.strategyLoss)}`,
    `預期年報酬 ${m(r.plan.expectedAnnual)}(${Math.round(r.plan.expectedReturn * 100)}%)`,
    `最新創高日 ${h.latestHigh == null ? '-' : fmtDate(h.latestHigh)}(${h.latestHighDays} 天)`,
  ].join(' | '));
}

// ---------- 版面:仿原 Excel「總表」 ----------

const o = (key) => `<td data-o="${key}"></td>`;
const inp = (id, attrs = '') => `<input id="${id}" ${attrs}>`;

function buildSheet() {
  $('sheetLeft').innerHTML = `
  <table class="xl t1">
    <tr><th class="blank"></th><th>TX(大台)</th><th>MTX(小台)</th><th>TMF(微台)</th></tr>
    <tr><th class="lbl">全部月份平均獲利:</th>${o('avgAll.TX')}${o('avgAll.MTX')}${o('avgAll.TMF')}</tr>
    <tr><th class="lbl">近三年月平均獲利:</th>${o('avgRecent.TX')}${o('avgRecent.MTX')}${o('avgRecent.TMF')}</tr>
    <tr><th class="lbl">最大月虧損:</th>${o('worstMonth.TX')}${o('worstMonth.MTX')}${o('worstMonth.TMF')}</tr>
    <tr><th class="lbl">月勝率:</th>${o('winRate')}${o('winRate')}${o('winRate')}</tr>
    <tr><th class="lbl">ROA:</th>${o('roa')}${o('roa')}${o('roa')}</tr>
    <tr class="hl"><th class="lbl">最大平倉虧損:</th>${o('maxPositionLoss.TX')}${o('maxPositionLoss.MTX')}${o('maxPositionLoss.TMF')}</tr>
    <tr class="hl"><th class="lbl">最大單日虧損</th>${o('worstDay.TX')}${o('worstDay.MTX')}${o('worstDay.TMF')}</tr>
  </table>

  <table class="xl t2">
    <tr><th colspan="2">每日浮動區間</th><th>95%單日風險值</th><th>最大單日虧損</th><th>日累計MAXDD:</th></tr>
    <tr>${o('bandAll0')}${o('bandAll1')}${o('var95')}${o('worstDayProd')}${o('ddProd')}</tr>
    <tr><th colspan="2">近三年每日浮動區間</th><th class="l">最大連虧月份</th>${o('maxLossMonthStreak')}<th>最大平倉虧(概)</th></tr>
    <tr>${o('bandRecent0')}${o('bandRecent1')}<th class="l">年度最多虧損月份</th>${o('maxLossMonthsInYear')}${o('ddApprox')}</tr>
    <tr><th class="lbl">計算年份</th><td class="in">${inp('calcYear', 'type="number" step="1"')}</td><td></td><td></td><th>最大策略虧(概)</th></tr>
    <tr><td></td><td></td><td></td><td></td>${o('strategyLoss')}</tr>
  </table>

  <table class="xl t3">
    <tr><th class="lbl">下單商品</th><td></td><td></td><td></td></tr>
    <tr><td class="in prod"><select id="product"><option value="TX">TX</option><option value="MTX">MTX</option><option value="TMF">TMF</option></select></td><th>大台保證金</th><td class="in">${inp('txMargin', 'type="text" inputmode="numeric" autocomplete="off"')}</td><td></td></tr>
    <tr><th class="lbl">比例</th><td class="in2">${inp('ratio', 'type="number" step="10" min="0"')}<span class="u">%</span></td><th>保證金</th>${o('marginPerLot')}</tr>
    <tr><td></td><th>總口數</th><th>當沖</th><th>留倉</th><th>超額保證金</th></tr>
    <tr><th class="lbl">原始口數</th><td class="in">${inp('lotTotal', 'type="number" min="0"')}</td><td class="in">${inp('lotDay', 'type="number" min="0"')}</td><td class="in">${inp('lotHold', 'type="number" min="0"')}</td><td class="in">${inp('lotExcess', 'type="number" min="0"')}</td></tr>
    <tr class="peach"><th class="lbl">比例後口數</th>${o('lots.total')}${o('lots.dayTrade')}${o('lots.hold')}${o('lots.excess')}</tr>
  </table>

  <table class="xl t4">
    <tr><th class="lbl">動用保證金：</th>${o('margin')}<th>預期年報酬</th>${o('expectedAnnual')}</tr>
    <tr><th class="lbl">期貨保證金：</th>${o('futuresMargin')}<th>預期報酬率</th>${o('expectedReturn')}</tr>
    <tr><th class="lbl">最少資金準備：</th>${o('minCapital')}<th>預期風險</th>${o('expectedRisk')}</tr>
    <tr><th class="lbl">兩套資金準備：</th>${o('twoSetCapital')}<th>保證金檢核:</th>${o('marginCheck')}</tr>
    <tr><th class="lbl gold">自訂資金：</th><td class="in">${inp('capital', 'type="text" inputmode="numeric" autocomplete="off"')}</td><td></td><td></td></tr>
  </table>

  <table class="xl t5">
    <tr><th class="gold">資料結束日期</th><td class="in">${inp('endDate', 'type="date"')}</td><th class="gold">最新創高日</th>${o('latestHigh')}</tr>
    <tr><th class="gold">DD 40 Day Avg</th>${o('avgStreak')}<th class="gold">距離上次創高</th>${o('sinceHigh')}</tr>
  </table>

  <table class="xl t6">
    <tr><td></td><th class="gold">DD日</th><th class="gold">起始日</th><th class="gold">創高日</th></tr>
    <tr><th class="lbl">最久DD日</th>${o('top0.days')}${o('top0.start')}${o('top0.end')}</tr>
    <tr><th class="lbl">第二久DD日</th>${o('top1.days')}${o('top1.start')}${o('top1.end')}</tr>
    <tr><th class="lbl">第三久DD日</th>${o('top2.days')}${o('top2.start')}${o('top2.end')}</tr>
  </table>`;
}

const num = (id) => {
  const v = $(id).value.replace(/[,\s]/g, '');
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// 金額欄位顯示千分位(同 Excel);輸入中維持原樣,離開欄位時才格式化
const fmtMoneyInput = (id) => {
  const n = num(id);
  $(id).value = n == null ? '' : nf.format(n);
};

function readSettings() {
  const ratioPct = num('ratio');
  return {
    product: $('product').value,
    ratio: ratioPct == null ? 1 : ratioPct / 100,
    startDate: $('startDate').value ? parseDate($('startDate').value) : null,
    calcYear: num('calcYear'),
    endDate: $('endDate').value ? parseDate($('endDate').value) : null,
    txMargin: num('txMargin') ?? DEFAULT_SETTINGS.txMargin,
    capital: num('capital'),
    streakThreshold: num('threshold') ?? 40,
    lots: { total: num('lotTotal') ?? 0, dayTrade: num('lotDay') ?? 0, hold: num('lotHold') ?? 0, excess: num('lotExcess') ?? 0 },
  };
}

function writeSettings(s) {
  $('product').value = s.product;
  $('ratio').value = Math.round(s.ratio * 10000) / 100;
  $('startDate').value = s.startDate ? fmtDate(s.startDate) : '';
  $('endDate').value = s.endDate ? fmtDate(s.endDate) : '';
  $('calcYear').value = s.calcYear ?? '';
  $('txMargin').value = nf.format(s.txMargin);
  $('capital').value = s.capital == null ? '' : nf.format(s.capital);
  $('threshold').value = s.streakThreshold;
  $('lotTotal').value = s.lots.total;
  $('lotDay').value = s.lots.dayTrade;
  $('lotHold').value = s.lots.hold;
  $('lotExcess').value = s.lots.excess;
}

// ---------- 繪製 ----------

// 核心算不出來的指標回傳 null(比例 0、資料全 0、從不虧損…),顯示「—」而不是 NaN
const fmt = (v) => (!Number.isFinite(v) ? '—' : v < 0 ? `(${nf.format(-v)})` : nf.format(v));
const pct2 = (v) => (Number.isFinite(v) ? (v * 100).toFixed(2) + '%' : '—');
const pct0 = (v) => (Number.isFinite(v) ? Math.round(v * 100) + '%' : '—');

function setO(key, text, cls = '') {
  for (const el of document.querySelectorAll(`[data-o="${key}"]`)) {
    el.textContent = text;
    el.className = cls;
  }
}
const money = (key, v) => setO(key, fmt(v), v < 0 ? 'neg' : '');

// 原表的日軸是「開始日期 → 今天」(日週期!G8 反推尾日就是 TODAY()),尾端沒資料的日子以 0 計入。
// 每日浮動區間與 95%單日風險值取的是軸尾往回的窗口,所以軸尾不延伸到今天這 5 格就跟原表差一點。
const axisEnd = () => axisEndFor(strategies);

function render() {
  if (!strategies.length) return;
  const empty = strategies.every((s) => !s.allocation);
  $('weightWarn').hidden = !empty;
  $('sheet').hidden = empty;
  if (empty) { lastReport = null; return; }
  const s = readSettings();
  saveSettings(s);
  const seriesOpts = { lastDate: axisEnd() };
  if (s.startDate != null) seriesOpts.startDate = s.startDate;
  const r = computeReport(strategies, s, seriesOpts);
  // 起始日晚於資料最後一天時核心回傳 null:給明確提示,不要繼續顯示上一份報表
  const panels = document.querySelectorAll('#tab-summary .panel');
  if (!r) {
    $('rangeWarn').hidden = false;
    $('sheet').hidden = true;
    for (const el of panels) el.hidden = true;
    lastReport = null;
    return;
  }
  $('rangeWarn').hidden = true;
  $('sheet').hidden = false;
  for (const el of panels) el.hidden = false;
  lastReport = r;
  if ($('calcYear').value === '') $('calcYear').placeholder = r.calcYear;
  if (!$('endDate').value) $('endDate').placeholder = fmtDate(r.highs.endDate);
  const p = r.settings.product;
  const k = r.kpi;

  for (const key of ['avgAll', 'avgRecent', 'worstMonth', 'maxPositionLoss', 'worstDay']) {
    for (const t of ['TX', 'MTX', 'TMF']) money(`${key}.${t}`, k[key][t]);
  }
  setO('winRate', pct2(k.winRate));
  setO('roa', Number.isFinite(k.roa) ? k.roa.toFixed(2) : '—');
  money('bandAll0', r.band.all?.[0]); money('bandAll1', r.band.all?.[1]);
  money('bandRecent0', r.band.recent?.[0]); money('bandRecent1', r.band.recent?.[1]);
  money('var95', r.var95); money('worstDayProd', r.worstDayProd); money('ddProd', r.ddProd);
  money('ddApprox', r.ddApprox); money('strategyLoss', r.strategyLoss);
  setO('maxLossMonthStreak', String(r.maxLossMonthStreak), 'neg');
  setO('maxLossMonthsInYear', String(r.maxLossMonthsInYear), 'neg');

  const pl = r.plan;
  setO('marginPerLot', nf.format(pl.marginPerLot));
  for (const [key, v] of Object.entries(pl.lots)) setO(`lots.${key}`, String(v));
  money('margin', pl.margin); money('futuresMargin', pl.futuresMargin);
  money('minCapital', pl.minCapital); money('twoSetCapital', pl.twoSetCapital);
  money('expectedAnnual', pl.expectedAnnual);
  setO('expectedReturn', pct0(pl.expectedReturn));
  setO('expectedRisk', pct0(pl.expectedRisk), pl.expectedRisk < 0 ? 'neg' : '');
  setO('marginCheck', pl.marginCheck, pl.marginCheck === 'YES' ? '' : 'neg');

  const h = r.highs;
  setO('latestHigh', h.latestHigh == null ? '' : fmtDate(h.latestHigh));
  // DD 40 Day Avg:原表是小數(例 95.2),不要在介面上四捨五入成整天數
  setO('avgStreak', h.recent5Avg == null ? '' : h.recent5Avg.toFixed(1));
  setO('sinceHigh', String(h.latestHighDays));
  for (let i = 0; i < 3; i++) {
    const g = h.longByLength[i];
    setO(`top${i}.days`, g ? String(g.days) : '');
    setO(`top${i}.start`, g ? fmtDate(g.start) : '');
    setO(`top${i}.end`, g ? fmtDate(g.end) : '');
  }

  // 月/年矩陣(右側)
  const cell = (v) => `<td class="${v < 0 ? 'neg' : ''}">${fmt(v)}</td>`;
  $('matrix').innerHTML =
    `<tr><th class="blank"></th>${r.years.map((y, i) => `<th class="yr${i === 0 ? ' yel' : ''}">${y}</th>`).join('')}</tr>` +
    r.matrix.map((row, m) => `<tr><th class="lbl">${m + 1}月</th>${row.map(cell).join('')}</tr>`).join('') +
    `<tr class="sum"><th class="lbl">年報酬</th>${r.annualRet.map(cell).join('')}</tr>` +
    `<tr><th class="lbl">年DD</th>${r.annualDD.map(cell).join('')}</tr>`;
  $('totals').innerHTML =
    `<tr><th>總獲利:</th><td class="big">${fmt(k.totalProfit)}</td><th class="gold">最大策略虧損:</th><td class="big neg">${fmt(r.strategyLoss)}</td></tr>`;
  barChart($('chartAnnual'), r.years, r.annualRet, r.annualDD);

  // 逐月盈虧熱力圖(各策略)
  heatmap.update(strategyMonthly(strategies, seriesOpts));

  // 資金曲線
  const cum = new Float64Array(r.daily.length);
  const dd = new Float64Array(r.daily.length);
  const scale = r.settings.ratio * PRODUCTS[p].factor;
  let c = 0, peak = 0;
  r.daily.forEach((v, i) => { c += v; if (c > peak) peak = c; cum[i] = c * scale; dd[i] = (c - peak) * scale; });
  lineChart($('chartEquity'), r.dates, cum, { height: 280 });
  lineChart($('chartDD'), r.dates, dd, { height: 160, color: '#c0392b', area: true });

  // 創高明細
  $('highSummary').textContent = h.latestHigh == null
    ? '資料期間內沒有未創高的區間。'
    : `最新創高日:${fmtDate(h.latestHigh)}(至 ${fmtDate(h.endDate)} 已 ${h.latestHighDays} 天未創高)。以下列出未創高超過 ${r.settings.streakThreshold} 天的區間,由近到遠。`;
  const rows = h.longByRecency;
  $('streaks').innerHTML = rows.length
    ? `<tr><th>#</th><th>起始日</th><th>創高日(結束)</th><th>未創高天數</th></tr>` +
      rows.map((g, i) => `<tr><td>${i + 1}</td><td>${fmtDate(g.start)}</td><td>${fmtDate(g.end)}</td><td>${g.days}</td></tr>`).join('')
    : '<tr><td>沒有符合門檻的區間</td></tr>';
}

// ---------- 投資組合版本(僅桌面版) ----------
// 一個投資組合 = 工作區根目錄下的一個子資料夾(或對話框授權過的絕對路徑),
// 資料夾內的 portfolio-config.json 仍是該投組即時設定的唯一來源;
// portfolios.json 只記名稱、說明、資料夾、時間與「存檔當下的策略指紋」。

const DEFAULT_PF = { id: 'default', name: '預設投組', note: '工作區根目錄裡的 CSV(還沒分投組)', sub: null, path: null, createdAt: null, savedAt: null, fingerprints: null };

let pfList = []; // portfolios.json 的投組
let pfCurrent = 'default';
let pfPicked = null; // 新增投組時用對話框選過的資料夾
let pfFolders = new Map(); // id → { exists, files }
let pfStale = []; // 目前投組的指紋差異
let migrateTarget = null; // 搬檔要搬進的子資料夾名

let first = true;
let prevFiles = null;

const pfById = (id) => (id === 'default' ? DEFAULT_PF : pfList.find((p) => p.id === id));
const entryOf = (p) => (!p || p.id === 'default' ? {} : { sub: p.sub, path: p.path });
const pfLabel = () => (pfById(pfCurrent) || DEFAULT_PF).name;
const setStatus = (msg, cls = 'status') => { $('status').className = cls; $('status').textContent = msg; };
const pfErr = (msg) => { $('pfErr').textContent = msg; $('pfErr').hidden = !msg; };

async function loadRegistry() {
  const res = parseRegistry(await window.desktop.readRegistry());
  if (res.error) setConfigWarn(`投組清單 ${REGISTRY_NAME} 讀不到:${res.error},這次只顯示預設投組。`);
  pfList = res.portfolios;
  if (!pfList.some((p) => p.id === pfCurrent)) pfCurrent = 'default';
}
async function saveRegistry() {
  if (!await window.desktop.writeRegistry(serializeRegistry(pfList))) {
    setStatus(`寫不進工作區的 ${REGISTRY_NAME},投組清單的變更不會留下。`, 'status err');
  }
}

// 各投組資料夾的存在與檔案數(給次分頁與搬檔提示用,不讀內容)
async function scanFolders() {
  pfFolders = new Map();
  for (const p of [DEFAULT_PF, ...pfList]) {
    const st = await window.desktop.stat(entryOf(p));
    pfFolders.set(p.id, st);
  }
  const loose = pfFolders.get('default')?.files || 0;
  $('migratePanel').hidden = !(loose > 0 && pfList.length > 0);
  if (loose > 0 && pfList.length > 0) {
    $('migrateHint').textContent =
      `工作區根目錄還有 ${loose} 個 CSV 沒歸到任何投組。建議把它們收進一個子資料夾,之後根目錄只放 ${REGISTRY_NAME} 與各投組的資料夾。`;
  }
}

function renderPfTabs() {
  const bar = $('pfTabs');
  if (!window.desktop) { bar.hidden = true; return; }
  bar.hidden = false;
  const cols = [DEFAULT_PF, ...pfList].filter((p) => p.id === 'default' ? (pfFolders.get('default')?.files || 0) > 0 : true);
  bar.innerHTML = cols.map((p) => {
    const st = pfFolders.get(p.id) || { exists: false, files: 0 };
    const cls = [p.id === pfCurrent ? 'on' : '', st.exists ? '' : 'stale'].filter(Boolean).join(' ');
    const title = st.exists ? `${p.note || p.name}(${st.files} 個 CSV)` : '資料夾不存在,按「重新指定」選它現在的位置';
    return `<button type="button" class="${cls}" data-pf="${p.id}" title="${esc(title)}">${esc(p.name)}${st.exists ? '' : ' ⚠'}</button>`;
  }).join('') + '<button type="button" class="pf-add" id="pfAddBtn">＋ 新增投組</button>';
  renderPfNote();
}

function renderPfNote() {
  const el = $('pfNote');
  if (!window.desktop) { el.hidden = true; return; }
  const p = pfById(pfCurrent) || DEFAULT_PF;
  const st = pfFolders.get(p.id) || { exists: true, files: 0 };
  let msg = `${p.name}${p.note ? ' —— ' + p.note : ''}`;
  if (!st.exists) msg += ' —— 資料夾不存在,數字是上一份載入的殘留,請按「重新指定」';
  else if (pfStale.length) msg += ` —— ⚠ ${pfStale.map((d) => describeDiff(d)).join(';')}`;
  el.textContent = msg;
  el.hidden = false;
  el.classList.toggle('err', !st.exists || pfStale.length > 0);
}

const axisEndFor = (list) => {
  const now = new Date();
  let last = -Infinity;
  for (const s of list) for (const [d] of s.rows) if (d > last) last = d;
  return Math.max(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()), last);
};

// 把一個資料夾讀成策略清單(用該資料夾自己的設定檔),不動到目前投組以外的狀態
async function readPortfolio(p) {
  const entry = entryOf(p);
  const res = await window.desktop.readFiles(entry);
  if (res.error) return { id: p.id, name: p.name, note: p.note, error: `資料夾讀不到:${res.error}` };
  const files = res.files || [];
  if (!files.length) return { id: p.id, name: p.name, note: p.note, error: '這個資料夾沒有 CSV/TSV/TXT 檔' };
  const list = [];
  try {
    for (const f of files) {
      const got = await loadFile(new File([f.data], f.name));
      if (!got.length) return { id: p.id, name: p.name, note: p.note, error: `「${f.name}」找不到「日期 + 損益」的資料欄` };
      for (const s of got) list.push(s);
    }
  } catch (e) {
    return { id: p.id, name: p.name, note: p.note, error: e.message || String(e) };
  }
  const cfg = parseConfig(await window.desktop.readConfig(entry));
  const settings = { ...DEFAULT_SETTINGS, ...cfg.settings, lots: { ...DEFAULT_SETTINGS.lots, ...(cfg.settings.lots || {}) } };
  const named = list.map((s) => ({ ...s, allocation: cfg.weights[s.name] ?? 1 }));
  const r = computeReport(named, settings, { startDate: settings.startDate ?? undefined, lastDate: axisEndFor(named) });
  if (!r) return { id: p.id, name: p.name, note: p.note, error: '起始日晚於該資料夾的資料範圍,算不出報表' };
  return {
    id: p.id, name: p.name, note: p.note, metrics: metricsOf(r, named), settings,
    hasBaseline: !!p.fingerprints,
    diffs: p.fingerprints ? diffFingerprints(p.fingerprints, fingerprints(named)) : [],
  };
}

function cmpCell(kind, v, signed = false) {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  let s;
  if (kind === 'money') s = nf.format(Math.round(abs));
  else if (kind === 'pct2') s = (abs * 100).toFixed(2) + '%';
  else if (kind === 'pct1') s = (abs * 100).toFixed(1) + '%';
  else if (kind === 'num1') s = abs.toFixed(1);
  else if (kind === 'num2') s = abs.toFixed(2);
  else s = String(Math.round(abs));
  const sign = v < 0 ? '-' : signed ? '+' : '';
  return sign + s;
}

async function renderCompare() {
  if (!window.desktop) return;
  const busy = $('cmpBusy');
  busy.hidden = false;
  const cols = [DEFAULT_PF, ...pfList].filter((p) => p.id === 'default' ? (pfFolders.get('default')?.files || 0) > 0 : true);
  const rows = [];
  for (const p of cols) rows.push(await readPortfolio(p));
  busy.hidden = true;

  const sel = $('cmpBase');
  const keep = sel.value;
  sel.innerHTML = rows.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
  if (rows.some((r) => r.id === keep)) sel.value = keep;
  const baseIdx = Math.max(0, rows.findIndex((r) => r.id === sel.value));
  const showDiff = $('cmpDiff').checked && rows.length > 1;
  const rank = rankMetrics(rows);

  const head = `<tr><th>指標</th>${rows.map((r) => {
    const st = pfFolders.get(r.id) || {};
    const sub = r.error ? '資料夾有問題'
      : (r.diffs && r.diffs.length ? `⚠ ${r.diffs.length} 個檔內容已換過` : `${(st.files || 0)} 個 CSV${r.hasBaseline ? '' : ' · 尚未建指紋基準'}`);
    return `<th class="pf-name">${esc(r.name)}<small>${esc(r.note || '')}</small><small>${esc(sub)}</small></th>`;
  }).join('')}</tr>`;
  const ops = `<tr><th>操作</th>${rows.map((r) => {
    const acts = [`<button type="button" data-act="open" data-id="${r.id}">開</button>`];
    if (r.error) acts.push(`<button type="button" data-act="repoint" data-id="${r.id}">重新指定</button>`);
    else {
      // 還沒建基準時也要有按鈕,否則使用者永遠沒辦法開始比對內容指紋
      acts.push(`<button type="button" data-act="refresh" data-id="${r.id}">${r.hasBaseline ? '更新指紋' : '建立基準'}</button>`);
      if (r.id !== 'default') acts.push(`<button type="button" data-act="remove" data-id="${r.id}">移除</button>`);
    }
    return `<td class="pf-name">${acts.join(' ')}</td>`;
  }).join('')}</tr>`;
  const body = METRICS.map((m) => {
    const cells = rows.map((r, i) => {
      if (r.error) return `<td class="err">${esc(r.error)}</td>`;
      const v = r.metrics[m.key];
      const base = rows[baseIdx].error ? null : rows[baseIdx].metrics[m.key];
      const d = showDiff && i !== baseIdx ? diffValue(v, base) : null;
      const cls = [];
      if (rank[m.key].best === i) cls.push('best');
      if (rank[m.key].worst === i) cls.push('worst');
      if (Number.isFinite(v) && v < 0 && !showDiff) cls.push('neg');
      const txt = d == null ? cmpCell(m.kind, v) : (d === 0 ? '=' : cmpCell(m.kind, d, true));
      return `<td class="${cls.join(' ')}">${txt}</td>`;
    }).join('');
    return `<tr><th>${esc(m.label)}${m.cell ? `<small>原表 ${m.cell}</small>` : ''}</th>${cells}</tr>`;
  }).join('');
  $('cmpTable').innerHTML = `<thead>${head}${ops}</thead><tbody>${body}</tbody>`;
}

// ---------- 投組操作 ----------

async function openPortfolio(id) {
  const p = pfById(id);
  if (!p) return;
  const entry = entryOf(p);
  const act = await window.desktop.activate(entry);
  if (act.error) { setStatus(`切換到「${p.name}」失敗:${act.error}`, 'status err'); return; }
  pfEntry = entry;
  pfCurrent = id;
  strategies = []; // 不沿用上一個投組的權重與資料
  prevFiles = null;
  first = true;
  pfStale = [];
  await applyConfigFile(entry);
  logLines = await window.desktop.readLog(entry);
  renderLog();
  await loadFolderFiles();
  renderPfTabs();
}

async function checkStale() {
  const p = pfById(pfCurrent);
  if (!p || !p.fingerprints) { pfStale = []; return; }
  pfStale = diffFingerprints(p.fingerprints, fingerprints(strategies));
}

async function addPortfolio() {
  const name = $('pfName').value.trim();
  const note = $('pfNoteIn').value.trim();
  const err = checkName(pfList, name) || checkNote(note);
  if (err) return pfErr(err);
  let sub = null;
  let path = null;
  if ($('pfDir').value === 'new') {
    const r = await window.desktop.makeSubFolder(name);
    if (r.error) return pfErr(r.error);
    sub = r.sub;
  } else {
    if (!pfPicked) return pfErr('還沒選資料夾:按「選資料夾…」挑這個投組要用的那個。');
    path = pfPicked;
  }
  const entry = { id: `p${Date.now().toString(36)}`, name, note, sub, path, createdAt: new Date().toISOString(), savedAt: null, fingerprints: null };
  pfList.push(entry);
  await saveRegistry();
  pfPicked = null;
  $('pfName').value = '';
  $('pfNoteIn').value = '';
  $('pfPickPath').hidden = true;
  $('pfClearPick').hidden = true;
  pfErr('');
  await scanFolders();
  migrateTarget = sub;
  if ((pfFolders.get(entry.id)?.files || 0) > 0) {
    // 資料夾已經有 CSV(選既有資料夾,或根目錄那批剛複製進去)→ 立刻建指紋基準
    entry.fingerprints = fingerprints(await listFor(entry));
    entry.savedAt = new Date().toISOString();
    await saveRegistry();
  } else {
    $('migratePanel').hidden = false;
    $('migrateHint').textContent = `「${name}」的資料夾是空的。要把它目前用的 CSV 放進去,可以按下面的按鈕把根目錄的 CSV 複製過去(只複製,不刪)。`;
  }
  renderPfTabs();
}

async function removePortfolio(id) {
  const p = pfById(id);
  if (!p || p.id === 'default') return;
  pfList = pfList.filter((x) => x.id !== id);
  await saveRegistry();
  const line = `${stamp()} | 移除投組 | ${p.name} | 資料夾仍保留:${p.path || p.sub || '(根目錄)'},沒有刪除任何 CSV`;
  await window.desktop.appendLog(entryOf(p), line); // 寫進該投組自己的記錄檔
  if (pfCurrent === id) await openPortfolio('default');
  else { await scanFolders(); renderPfTabs(); }
}

async function repointPortfolio(id) {
  const p = pfById(id);
  if (!p || p.id === 'default') return;
  const r = await window.desktop.pickFolder();
  if (r.canceled) return;
  p.path = r.path;
  p.sub = null;
  await saveRegistry();
  await scanFolders();
  if (pfCurrent === id) await openPortfolio(id);
  else renderPfTabs();
}

async function refreshFingerprints(id) {
  const p = pfById(id);
  if (!p) return;
  const res = await readPortfolio(p);
  if (res.error) return pfErr(res.error);
  p.fingerprints = fingerprints(await listFor(p));
  p.savedAt = new Date().toISOString();
  await saveRegistry();
  if (pfCurrent === id) await checkStale();
  renderPfTabs();
  await renderCompare();
}

// 只取該投組的策略清單(名稱與筆數),給指紋用
async function listFor(p) {
  const res = await window.desktop.readFiles(entryOf(p));
  const out = [];
  for (const f of res.files || []) for (const s of await loadFile(new File([f.data], f.name))) out.push(s);
  return out;
}

async function runMigrate() {
  if (!migrateTarget) return pfErr('先新增一個投組(或指定要搬進的子資料夾)。');
  const state = $('migrateState');
  state.className = 'status';
  state.textContent = '複製中…';
  const r = await window.desktop.copyLooseTo(migrateTarget);
  if (r.error) { state.className = 'status err'; state.textContent = `複製失敗:${r.error}`; return; }
  const src = await window.desktop.readFiles({});
  const dst = await window.desktop.readFiles({ sub: migrateTarget });
  const same = (src.files || []).filter((a) => (dst.files || []).some((b) => b.name === a.name && b.size === a.size));
  state.textContent = `已複製 ${r.moved.length} 個檔到「${migrateTarget}」;其中 ${same.length} 個兩邊大小一致。原始檔還在根目錄,沒有刪除。`;
  migrateExpected = same.map((f) => ({ name: f.name, size: f.size }));
  $('migrateDelete').hidden = same.length === 0;
  // 搬完就替這個投組建好指紋基準,之後換策略才比得出來
  const target = pfList.find((p) => p.sub === migrateTarget);
  if (target && same.length) {
    target.fingerprints = fingerprints(await listFor(target));
    target.savedAt = new Date().toISOString();
    await saveRegistry();
  }
}
let migrateExpected = [];

async function deleteLooseFiles() {
  if (!migrateTarget || !migrateExpected.length) return;
  const r = await window.desktop.deleteLoose(migrateTarget, migrateExpected);
  const state = $('migrateState');
  if (r.error) { state.className = 'status err'; state.textContent = `刪除失敗:${r.error}`; return; }
  state.className = 'status';
  state.textContent = `已刪除根目錄 ${r.deleted.length} 個檔${r.skipped.length ? `;${r.skipped.length} 個因大小不符被保留:${r.skipped.join(', ')}` : ''}。「${migrateTarget}」裡的副本不受影響。`;
  $('migrateDelete').hidden = true;
  await scanFolders();
  const def = pfFolders.get('default');
  if (!def?.files) await openPortfolio(pfList.find((p) => p.sub === migrateTarget)?.id || pfCurrent);
  renderPfTabs();
  if (!(def?.files > 0)) $('migratePanel').hidden = true;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- 事件 ----------

buildSheet();
if (!window.desktop) {
  try { logLines = JSON.parse(localStorage.getItem(LOGKEY)) || []; } catch { logLines = []; }
  $('logHint').textContent = '網站版的記錄只保存在這個瀏覽器裡,不會寫成檔案;截圖功能僅桌面版提供。';
  renderLog();
}
writeSettings({ ...DEFAULT_SETTINGS, ...loadSettings(), lots: { ...DEFAULT_SETTINGS.lots, ...(loadSettings().lots || {}) } });

for (const id of ['txMargin', 'capital']) $(id).addEventListener('blur', () => fmtMoneyInput(id));

$('app').addEventListener('input', (e) => {
  if (e.target.dataset.i != null) {
    strategies[+e.target.dataset.i].allocation = Math.max(0, Number(e.target.value) || 0);
    saveWeights();
  }
  render();
});
$('weightsOne').addEventListener('click', () => setAllWeights(1));
$('weightsZero').addEventListener('click', () => setAllWeights(0));
for (const btn of document.querySelectorAll('.tabs button[data-tab]')) btn.addEventListener('click', () => switchTab(btn.dataset.tab));
$('snapBtn').addEventListener('click', takeSnapshot);
$('pick').addEventListener('click', () => $('file').click());
const ingestAndLog = async (files) => {
  const info = await ingest(files);
  if (info) logFileChanges(null, info);
};
$('file').addEventListener('change', (e) => e.target.files.length && ingestAndLog([...e.target.files]));
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  if (e.dataTransfer.files.length) ingestAndLog([...e.dataTransfer.files]);
});

// ---------- 桌面版:工作區根目錄 + 每個投資組合一個資料夾 ----------

async function showFolder() {
  const ws = await window.desktop.getWorkspace();
  const a = ws.active || {};
  const dir = a.sub ? `${ws.root}\\${a.sub}` : (a.path || ws.root);
  $('folderPath').textContent = dir;
  $('logHint').textContent = `記錄檔:${dir} 內的 portfolio-tool.log(可用記事本開啟);截圖存在 ${dir} 內的 snapshots 資料夾。`;
}

// 讀目前投組資料夾的 CSV 並重算。設定檔只在啟動/換投組/按重新載入時重讀,
// 檔案自動重載不重讀,免得蓋掉還沒寫進檔案的變更。
async function loadFolderFiles() {
  const res = await window.desktop.readFiles(pfEntry);
  if (res.error) {
    setStatus(`資料夾讀不到:${res.error}`, 'status err');
    if (prevFiles?.size) { logFileChanges(prevFiles, new Map()); prevFiles = new Map(); }
    return;
  }
  const files = res.files || [];
  if (!files.length) {
    setStatus('資料夾內沒有 CSV 檔(把各策略的日損益 CSV 放進去即可)', 'status err');
    if (prevFiles?.size) { logFileChanges(prevFiles, new Map()); prevFiles = new Map(); }
    return;
  }
  const info = await ingest(files.map((f) => new File([f.data], f.name)), { reload: !first });
  if (!info) return;
  const cur = new Map(files.map((f) => [f.name, { ...info.get(f.name), size: f.size, mtime: f.mtime }]));
  logFileChanges(prevFiles, cur);
  prevFiles = cur;
  first = false;
  await checkStale();
  renderPfNote();
}

async function initDesktop() {
  await loadRegistry();
  await scanFolders();
  await showFolder();
  // 根目錄沒有散落 CSV 的工作區(例如只有子資料夾的 mock 工作區),直接開第一個投組,
  // 不要停在「預設投組」然後報「資料夾內沒有 CSV 檔」。
  if (pfCurrent === 'default' && !(pfFolders.get('default')?.files > 0) && pfList.length) pfCurrent = pfList[0].id;
  await openPortfolio(pfCurrent); // 套設定 → 讀記錄 → 讀 CSV → 畫次分頁
}

if (window.desktop) {
  $('folderBar').hidden = false;
  $('snapBtn').hidden = false;
  $('openLog').hidden = false;
  $('cmpTab').hidden = false;
  $('openLog').addEventListener('click', () => window.desktop.showLog(pfEntry));

  // 換工作區根目錄 = 投組清單與所有投組都跟著換
  $('chooseFolder').addEventListener('click', async () => {
    if (!await window.desktop.chooseWorkspace()) return;
    pfCurrent = 'default';
    pfList = [];
    strategies = [];
    await initDesktop();
  });
  $('reloadFolder').addEventListener('click', async () => {
    await applyConfigFile(pfEntry);
    await showFolder();
    await loadFolderFiles();
  });
  window.desktop.onFolderChanged(loadFolderFiles);

  $('pfTabs').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'pfAddBtn') { switchTab('compare'); $('pfName').focus(); return; }
    if (b.dataset.pf) await openPortfolio(b.dataset.pf);
  });
  $('cmpTable').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    if (b.dataset.act === 'open') await openPortfolio(id);
    else if (b.dataset.act === 'remove') await removePortfolio(id);
    else if (b.dataset.act === 'repoint') await repointPortfolio(id);
    else if (b.dataset.act === 'refresh') await refreshFingerprints(id);
    await renderCompare();
  });
  $('pfDir').addEventListener('change', () => {
    $('pfPick').hidden = $('pfDir').value !== 'pick';
  });
  $('pfPick').addEventListener('click', async () => {
    const r = await window.desktop.pickFolder();
    if (r.canceled) return;
    pfPicked = r.path;
    $('pfPickPath').textContent = `已選:${r.path}`;
    $('pfPickPath').hidden = false;
    $('pfClearPick').hidden = false;
  });
  $('pfClearPick').addEventListener('click', () => {
    pfPicked = null;
    $('pfPickPath').hidden = true;
    $('pfClearPick').hidden = true;
  });
  $('pfAdd').addEventListener('click', addPortfolio);
  $('migrateBtn').addEventListener('click', runMigrate);
  $('migrateDelete').addEventListener('click', deleteLooseFiles);
  $('cmpBase').addEventListener('change', renderCompare);
  $('cmpDiff').addEventListener('change', renderCompare);

  initDesktop();
}
