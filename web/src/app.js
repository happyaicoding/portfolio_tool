import { computeReport, parseDate, fmtDate, DEFAULT_SETTINGS, PRODUCTS } from './core.js';
import { loadFile } from './parse.js';
import { lineChart, barChart } from './charts.js';

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });

let strategies = []; // [{ name, rows, allocation }]
const KEY = 'portfolio_tool.settings.v1';

function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 隱私模式等情況略過 */ }
}
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

// ---------- 讀檔 ----------

async function ingest(files, { reload = false } = {}) {
  const status = $('status');
  status.className = 'status';
  status.textContent = '讀取中…';
  try {
    const loaded = [];
    let fileStart = null;
    for (const f of files) {
      const got = await loadFile(f);
      if (got.startDate != null) fileStart = got.startDate;
      if (!got.length) throw new Error(`「${f.name}」找不到「日期 + 損益」的資料欄`);
      loaded.push(...got);
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
    const min = Math.min(...all), max = Math.max(...all);
    status.textContent = `已載入 ${strategies.length} 個策略,${fmtDate(min)} ~ ${fmtDate(max)}`;
    if (!reload) {
      $('startDate').value = fileStart != null ? fmtDate(fileStart) : '';
      $('endDate').value = '';
    }
    $('startDate').placeholder = fmtDate(min);
    buildAllocInputs();
    $('app').hidden = false;
    render();
  } catch (e) {
    status.className = 'status err';
    status.textContent = e.message || String(e);
  }
}

const WKEY = 'portfolio_tool.weights.v1';
function loadWeights() {
  try { return JSON.parse(localStorage.getItem(WKEY)) || {}; } catch { return {}; }
}
function saveWeights() {
  try { localStorage.setItem(WKEY, JSON.stringify(Object.fromEntries(strategies.map((s) => [s.name, s.allocation])))); } catch { /* 略過 */ }
}

function buildAllocInputs() {
  const rows = strategies.map((s, i) => {
    const dates = s.rows.map((r) => r[0]);
    const total = s.rows.reduce((a, r) => a + r[1], 0);
    return `<tr><th>${s.name}</th>
      <td><input type="number" step="0.1" min="0" data-i="${i}" value="${s.allocation}" aria-label="${s.name} 權重"></td>
      <td>${fmtDate(Math.min(...dates))} ~ ${fmtDate(Math.max(...dates))}</td>
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
    <tr><td class="in prod"><select id="product"><option value="TX">TX</option><option value="MTX">MTX</option><option value="TMF">TMF</option></select></td><th>大台保證金</th><td class="in">${inp('txMargin', 'type="number" step="1000"')}</td><td></td></tr>
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
    <tr><th class="lbl gold">自訂資金：</th><td class="in">${inp('capital', 'type="number" step="10000"')}</td><td></td><td></td></tr>
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
  const v = $(id).value;
  return v === '' ? null : Number(v);
};

function readSettings() {
  const ratioPct = num('ratio');
  return {
    product: $('product').value,
    ratio: ratioPct == null ? 1 : ratioPct / 100,
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
  $('calcYear').value = s.calcYear ?? '';
  $('txMargin').value = s.txMargin;
  $('capital').value = s.capital ?? '';
  $('threshold').value = s.streakThreshold;
  $('lotTotal').value = s.lots.total;
  $('lotDay').value = s.lots.dayTrade;
  $('lotHold').value = s.lots.hold;
  $('lotExcess').value = s.lots.excess;
}

// ---------- 繪製 ----------

const fmt = (v) => (v < 0 ? `(${nf.format(-v)})` : nf.format(v));
const pct2 = (v) => (v * 100).toFixed(2) + '%';
const pct0 = (v) => Math.round(v * 100) + '%';

function setO(key, text, cls = '') {
  for (const el of document.querySelectorAll(`[data-o="${key}"]`)) {
    el.textContent = text;
    el.className = cls;
  }
}
const money = (key, v) => setO(key, fmt(v), v < 0 ? 'neg' : '');

function render() {
  if (!strategies.length) return;
  const empty = strategies.every((s) => !s.allocation);
  $('weightWarn').hidden = !empty;
  $('sheet').hidden = empty;
  if (empty) return;
  const s = readSettings();
  saveSettings({ ...s, endDate: null });
  const seriesOpts = {};
  if ($('startDate').value) seriesOpts.startDate = parseDate($('startDate').value);
  const r = computeReport(strategies, s, seriesOpts);
  if (!r) return;
  if ($('calcYear').value === '') $('calcYear').placeholder = r.calcYear;
  if (!$('endDate').value) $('endDate').placeholder = fmtDate(r.highs.endDate);
  const p = r.settings.product;
  const k = r.kpi;

  for (const key of ['avgAll', 'avgRecent', 'worstMonth', 'maxPositionLoss', 'worstDay']) {
    for (const t of ['TX', 'MTX', 'TMF']) money(`${key}.${t}`, k[key][t]);
  }
  setO('winRate', pct2(k.winRate));
  setO('roa', k.roa.toFixed(2));
  money('bandAll0', r.band.all[0]); money('bandAll1', r.band.all[1]);
  money('bandRecent0', r.band.recent[0]); money('bandRecent1', r.band.recent[1]);
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
  const recent5 = h.longByRecency.slice(0, 5).map((g) => g.days);
  setO('latestHigh', h.latestHigh == null ? '' : fmtDate(h.latestHigh));
  setO('avgStreak', recent5.length ? (recent5.reduce((a, b) => a + b, 0) / recent5.length).toFixed(0) : '0');
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

// ---------- 事件 ----------

buildSheet();
writeSettings({ ...DEFAULT_SETTINGS, ...loadSettings(), lots: { ...DEFAULT_SETTINGS.lots, ...(loadSettings().lots || {}) } });

$('app').addEventListener('input', (e) => {
  if (e.target.dataset.i != null) {
    strategies[+e.target.dataset.i].allocation = Math.max(0, Number(e.target.value) || 0);
    saveWeights();
  }
  render();
});
$('weightsOne').addEventListener('click', () => setAllWeights(1));
$('weightsZero').addEventListener('click', () => setAllWeights(0));
for (const btn of document.querySelectorAll('.tabs button')) {
  btn.addEventListener('click', () => {
    for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b === btn);
    $('tab-summary').hidden = btn.dataset.tab !== 'summary';
    $('tab-settings').hidden = btn.dataset.tab !== 'settings';
    if (btn.dataset.tab === 'summary') render();
  });
}
$('pick').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (e) => e.target.files.length && ingest([...e.target.files]));
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  if (e.dataTransfer.files.length) ingest([...e.dataTransfer.files]);
});

// ---------- 桌面版:自動讀取資料夾內所有 CSV ----------

if (window.desktop) {
  const bar = $('folderBar');
  bar.hidden = false;
  let first = true;
  const showFolder = async () => { $('folderPath').textContent = await window.desktop.getFolder(); };
  const loadFolder = async () => {
    const files = await window.desktop.readFolder();
    if (!files.length) {
      $('status').className = 'status err';
      $('status').textContent = '資料夾內沒有 CSV 檔(把各策略的日損益 CSV 放進去即可)';
      return;
    }
    await ingest(files.map((f) => new File([f.data], f.name)), { reload: !first });
    first = false;
  };
  $('chooseFolder').addEventListener('click', async () => {
    if (await window.desktop.chooseFolder()) { first = true; await showFolder(); await loadFolder(); }
  });
  $('reloadFolder').addEventListener('click', loadFolder);
  window.desktop.onFolderChanged(loadFolder); // 資料夾內檔案有增減或修改,自動重讀
  showFolder().then(loadFolder);
}
