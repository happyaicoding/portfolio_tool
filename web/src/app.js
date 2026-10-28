import { computeReport, parseDate, fmtDate, DEFAULT_SETTINGS, PRODUCTS } from './core.js';
import { loadFile } from './parse.js';
import { lineChart } from './charts.js';

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const pct = (v) => (v * 100).toFixed(1) + '%';
const cls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');

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
    strategies = loaded.map((s) => {
      const c = (seen.get(s.name) || 0) + 1;
      seen.set(s.name, c);
      const name = c > 1 ? `${s.name}(${c})` : s.name;
      return { ...s, name, allocation: oldAlloc.get(name) ?? 1 }; // 重新載入時保留已調整的權重
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

function buildAllocInputs() {
  $('alloc').innerHTML = strategies
    .map((s, i) => `<label>${s.name}<input type="number" step="0.1" min="0" data-i="${i}" value="${s.allocation}"></label>`)
    .join('');
}

// ---------- 設定 ----------

const num = (id) => {
  const v = $(id).value;
  return v === '' ? null : Number(v);
};

function readSettings() {
  return {
    product: $('product').value,
    ratio: num('ratio') ?? 1,
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
  $('ratio').value = s.ratio;
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

const card = (k, v, sub = '', c = '') =>
  `<div class="card"><div class="k">${k}</div><div class="v ${c}">${v}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
const trio = (o) => `TX ${nf.format(o.TX)} · MTX ${nf.format(o.MTX)} · TMF ${nf.format(o.TMF)}`;

function render() {
  if (!strategies.length) return;
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

  $('kpi').innerHTML = [
    card('全部月份平均獲利', nf.format(k.avgAll[p]), trio(k.avgAll)),
    card('近三年月平均獲利', nf.format(k.avgRecent[p]), trio(k.avgRecent)),
    card('最大月虧損', nf.format(k.worstMonth[p]), trio(k.worstMonth), 'neg'),
    card('月勝率', pct(k.winRate)),
    card('ROA', k.roa.toFixed(2), '總獲利 ÷ 最大平倉虧損'),
    card('最大平倉虧損', nf.format(k.maxPositionLoss[p]), trio(k.maxPositionLoss), 'neg'),
    card('最大單日虧損', nf.format(k.worstDay[p]), trio(k.worstDay), 'neg'),
    card('總獲利', nf.format(k.totalProfit), p, cls(k.totalProfit)),
    card('每日浮動區間(全區間)', `${nf.format(r.band.all[0])} ~ ${nf.format(r.band.all[1])}`, '平均 ± 1 個標準差'),
    card(`每日浮動區間(近三年)`, `${nf.format(r.band.recent[0])} ~ ${nf.format(r.band.recent[1])}`, `${r.calcYear} 年底往前 1096 天`),
    card('95% 單日風險值', nf.format(r.var95), '浮動區間均值 × 1.97', 'neg'),
    card('最大連虧月份', `${r.maxLossMonthStreak} 個月`, `單一年度最多虧損 ${r.maxLossMonthsInYear} 個月`),
  ].join('');

  // 圖表
  const cum = new Float64Array(r.daily.length);
  const dd = new Float64Array(r.daily.length);
  const scale = r.settings.ratio * PRODUCTS[p].factor;
  let c = 0, peak = 0;
  r.daily.forEach((v, i) => { c += v; if (c > peak) peak = c; cum[i] = c * scale; dd[i] = (c - peak) * scale; });
  lineChart($('chartEquity'), r.dates, cum, { height: 280 });
  lineChart($('chartDD'), r.dates, dd, { height: 160, color: '#c0392b', area: true });

  // 矩陣
  const flat = r.matrix.flat().filter((v) => v !== 0);
  const big = Math.max(...flat.map(Math.abs)) || 1;
  const heat = (v) => (v === 0 ? '' : `style="background:rgba(var(${v > 0 ? '--pos-bg' : '--neg-bg'}),${(0.08 + 0.4 * Math.min(1, Math.abs(v) / big)).toFixed(2)})"`);
  const cell = (v) => `<td ${heat(v)}>${v === 0 ? '' : nf.format(v)}</td>`;
  $('matrix').innerHTML =
    `<tr><th></th>${r.years.map((y) => `<th>${y}</th>`).join('')}</tr>` +
    r.matrix.map((row, m) => `<tr><th>${m + 1} 月</th>${row.map(cell).join('')}</tr>`).join('') +
    `<tr class="sum"><th>年報酬</th>${r.annualRet.map((v) => `<td class="${cls(v)}">${nf.format(v)}</td>`).join('')}</tr>` +
    `<tr><th>年 DD</th>${r.annualDD.map((v) => `<td class="${cls(v)}">${nf.format(v)}</td>`).join('')}</tr>` +
    `<tr><th>虧損月數</th>${r.lossMonthsByYear.map((v) => `<td>${v}</td>`).join('')}</tr>`;

  // 創高
  const h = r.highs;
  $('highSummary').textContent = h.latestHigh == null
    ? '資料期間內沒有未創高的區間。'
    : `最新創高日:${fmtDate(h.latestHigh)}(至 ${fmtDate(h.endDate)} 已 ${Math.round((h.endDate - h.latestHigh) / 86400000)} 天未創高)。以下列出未創高超過 ${r.settings.streakThreshold} 天的區間。`;
  const rows = h.longByRecency;
  $('streaks').innerHTML = rows.length
    ? `<tr><th>#</th><th>起始日</th><th>創高日(結束)</th><th>未創高天數</th></tr>` +
      rows.map((g, i) => `<tr><td>${i + 1}</td><td>${fmtDate(g.start)}</td><td>${fmtDate(g.end)}</td><td>${g.days}</td></tr>`).join('')
    : '<tr><td>沒有符合門檻的區間</td></tr>';

  // 資金規劃
  const pl = r.plan;
  $('plan').innerHTML = [
    card('每口保證金', nf.format(pl.marginPerLot), p),
    card('比例後口數', `${pl.lots.total} 口`, `當沖 ${pl.lots.dayTrade} · 留倉 ${pl.lots.hold} · 超額 ${pl.lots.excess}`),
    card('動用保證金', nf.format(pl.margin)),
    card('期貨保證金(×1.3)', nf.format(pl.futuresMargin)),
    card('最少資金準備', nf.format(pl.minCapital), `最大策略虧(概) ${nf.format(r.strategyLoss)}`),
    card('兩套資金準備', nf.format(pl.twoSetCapital)),
    card('預期年報酬', nf.format(pl.expectedAnnual), '月平均(全部/近三年取小)× 12', cls(pl.expectedAnnual)),
    card('預期報酬率', pct(pl.expectedReturn), '', cls(pl.expectedReturn)),
    card('預期風險', pct(pl.expectedRisk), '最大策略虧 ÷ 資金', 'neg'),
    card('保證金檢核', pl.marginCheck === 'YES' ? 'YES' : '不足', pl.marginCheck === 'YES' ? '' : pl.marginCheck, pl.marginCheck === 'YES' ? 'pos' : 'neg'),
  ].join('');
}

// ---------- 事件 ----------

writeSettings({ ...DEFAULT_SETTINGS, ...loadSettings(), lots: { ...DEFAULT_SETTINGS.lots, ...(loadSettings().lots || {}) } });

$('settings').addEventListener('input', (e) => {
  if (e.target.dataset.i != null) strategies[+e.target.dataset.i].allocation = Number(e.target.value) || 0;
  render();
});
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
