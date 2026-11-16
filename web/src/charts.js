// 輕量 SVG 折線/面積圖(無外部相依)
import { fmtDate } from './core.js';

const W = 1000;
const nf = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });

function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) ticks.push(t);
  return ticks;
}

/** series: Float64/Array,與 dates 等長。area=true 時由 0 軸填色。 */
export function lineChart(el, dates, series, { height = 300, color = '#b7791f', area = false } = {}) {
  const padL = 70, padR = 12, padT = 10, padB = 24;
  const n = series.length;
  const step = Math.max(1, Math.floor(n / 800)); // 降採樣,保留最後一點
  const idx = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  let min = Infinity, max = -Infinity;
  for (const v of series) { if (v < min) min = v; if (v > max) max = v; }
  if (area) { min = Math.min(min, 0); max = Math.max(max, 0); }
  const pad = (max - min) * 0.05 || 1;
  min -= pad; max += pad;
  const x = (i) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - min) / (max - min)) * (height - padT - padB);
  const pts = idx.map((i) => `${x(i).toFixed(1)},${y(series[i]).toFixed(1)}`);
  const ticks = niceTicks(min, max);
  const y0 = y(Math.max(min, Math.min(max, 0)));
  const years = [];
  let lastY = -1;
  for (let i = 0; i < n; i++) {
    const yr = new Date(dates[i]).getUTCFullYear();
    if (yr !== lastY) { years.push([i, yr]); lastY = yr; }
  }
  const skip = Math.ceil(years.length / 10);
  el.innerHTML = `<svg viewBox="0 0 ${W} ${height}" role="img">
    ${ticks.map((t) => `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}" stroke="currentColor" opacity=".1"/><text class="axis" x="${padL - 6}" y="${y(t) + 4}" text-anchor="end">${nf.format(t)}</text>`).join('')}
    ${years.filter((_, k) => k % skip === 0).map(([i, yr]) => `<text class="axis" x="${x(i)}" y="${height - 6}" text-anchor="middle">${yr}</text>`).join('')}
    ${area ? `<polygon points="${padL},${y0} ${pts.join(' ')} ${x(n - 1)},${y0}" fill="${color}" opacity=".18"/>` : ''}
    <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>
    <rect class="hit" x="${padL}" y="${padT}" width="${W - padL - padR}" height="${height - padT - padB}" fill="transparent"/>
    <g class="tip" hidden><line y1="${padT}" y2="${height - padB}" stroke="currentColor" opacity=".3"/><text class="axis" y="${padT + 12}"></text></g>
  </svg>`;
  const svg = el.querySelector('svg');
  const tip = svg.querySelector('.tip');
  const label = tip.querySelector('text');
  const line = tip.querySelector('line');
  svg.querySelector('.hit').addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - padL) / (W - padL - padR)) * (n - 1))));
    tip.hidden = false;
    line.setAttribute('x1', x(i)); line.setAttribute('x2', x(i));
    label.textContent = `${fmtDate(dates[i])}  ${nf.format(series[i])}`;
    const right = x(i) > W / 2;
    label.setAttribute('x', x(i) + (right ? -6 : 6));
    label.setAttribute('text-anchor', right ? 'end' : 'start');
  });
  svg.querySelector('.hit').addEventListener('pointerleave', () => { tip.hidden = true; });
}

/** 年績效比較:每年一組,綠柱 = 年報酬,紅柱 = 年 DD(同 Excel 圖表) */
export function barChart(el, years, ret, dd, { height = 260 } = {}) {
  const padL = 56, padR = 8, padT = 14, padB = 22;
  const all = [...ret, ...dd, 0];
  let min = Math.min(...all);
  let max = Math.max(...all);
  const pad = (max - min) * 0.08 || 1;
  min -= pad; max += pad;
  const n = years.length;
  const slot = (W - padL - padR) / n;
  const bw = Math.min(26, slot * 0.32);
  const y = (v) => padT + (1 - (v - min) / (max - min)) * (height - padT - padB);
  const ticks = niceTicks(min, max, 6);
  const label = (v) => nf.format(Math.abs(v)) ;
  const bars = years.map((yr, i) => {
    const cx = padL + slot * (i + 0.5);
    const mk = (v, x, color) => {
      if (!v) return `<text class="axis" x="${x + bw / 2}" y="${y(0) - 3}" text-anchor="middle" font-size="9">0</text>`;
      const top = Math.min(y(v), y(0));
      const h = Math.abs(y(v) - y(0));
      const ty = v > 0 ? top - 3 : top + h + 10;
      return `<rect x="${x}" y="${top}" width="${bw}" height="${h}" fill="${color}"/><text class="axis" x="${x + bw / 2}" y="${ty}" text-anchor="middle" font-size="9">${v < 0 ? `(${label(v)})` : label(v)}</text>`;
    };
    return mk(ret[i], cx - bw - 1, '#00b050') + mk(dd[i], cx + 1, '#ff0000') +
      `<text class="axis" x="${cx}" y="${height - 6}" text-anchor="middle">${yr}</text>`;
  }).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${height}" role="img">
    ${ticks.map((t) => `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}" stroke="currentColor" opacity=".18"/><text class="axis" x="${padL - 6}" y="${y(t) + 4}" text-anchor="end">${t < 0 ? `(${nf.format(-t)})` : nf.format(t)}</text>`).join('')}
    ${bars}
  </svg>`;
}

/**
 * 逐月盈虧熱力圖:欄 = 各策略(最右為合計),列 = 年份,點年份列展開/收合到月。
 * data = strategyMonthly() 的結果。回傳 { update(data) },狀態(展開、年份範圍、色階)跨重繪保留。
 */
export function createHeatmap(el, ctl) {
  const { y0, y1, yall, expandAll, collapseAll, scaleSel, showNum } = ctl;
  const open = new Set();
  let data = { years: [], cols: [] };
  let lo = null, hi = null;

  const absMax = (arr) => Math.max(0, ...arr.filter((v) => v != null).map(Math.abs));
  const yearVal = (k, c) => {
    const v = k.matrix.map((r) => r[c]).filter((x) => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) : null;
  };
  const color = (v, max) => {
    if (v == null) return 'transparent';
    if (v === 0 || max === 0) return 'rgba(128,128,128,.12)';
    const a = 0.12 + 0.88 * Math.sqrt(Math.min(1, Math.abs(v) / max));
    return `rgba(var(${v > 0 ? '--pos-bg' : '--neg-bg'}), ${a.toFixed(3)})`;
  };

  function draw() {
    const { years, cols } = data;
    if (!years.length) { el.innerHTML = ''; return; }
    const shown = years.map((y, c) => [y, c]).filter(([y]) => y >= lo && y <= hi);
    const strat = cols.filter((k) => !k.total);
    const yMax = cols.map((k) => absMax(shown.map(([, c]) => yearVal(k, c))));
    const mMax = cols.map((k) => absMax(shown.flatMap(([, c]) => k.matrix.map((r) => r[c]))));
    const gY = Math.max(0, ...strat.map((k) => yMax[cols.indexOf(k)]));
    const gM = Math.max(0, ...strat.map((k) => mMax[cols.indexOf(k)]));
    const shared = scaleSel.value === 'shared';
    const num = showNum.checked;
    const cell = (k, ci, v, isYear, label) => {
      const max = k.total || !shared ? (isYear ? yMax[ci] : mMax[ci]) : (isYear ? gY : gM);
      return `<td class="${k.total ? 'tot' : ''}" style="background:${color(v, max)}" title="${label}  ${k.name}  ${v == null ? '無資料' : nf.format(v)}">${num && v != null ? nf.format(v) : ''}</td>`;
    };
    let h = `<thead><tr><th>年份</th>${cols.map((k) => `<th class="${k.total ? 'tot' : ''}" title="${k.name}">${k.name}</th>`).join('')}</tr></thead><tbody>`;
    for (const [y, c] of shown) {
      const isOpen = open.has(y);
      h += `<tr class="y" data-y="${y}"><th>${isOpen ? '▼' : '▶'} ${y}</th>${cols.map((k, ci) => cell(k, ci, yearVal(k, c), true, String(y))).join('')}</tr>`;
      if (!isOpen) continue;
      for (let m = 0; m < 12; m++) {
        if (cols.every((k) => k.matrix[m][c] == null)) continue;
        h += `<tr class="m"><th>${m + 1} 月</th>${cols.map((k, ci) => cell(k, ci, k.matrix[m][c], false, `${y}-${String(m + 1).padStart(2, '0')}`)).join('')}</tr>`;
      }
    }
    el.innerHTML = h + '</tbody>';
  }

  function fillSelects() {
    const ys = data.years;
    for (const sel of [y0, y1]) {
      sel.innerHTML = ys.map((y) => `<option value="${y}">${y}</option>`).join('');
    }
    if (lo == null || lo < ys[0] || lo > ys[ys.length - 1]) lo = ys[0];
    if (hi == null || hi > ys[ys.length - 1] || hi < ys[0]) hi = ys[ys.length - 1];
    y0.value = lo; y1.value = hi;
  }

  el.addEventListener('click', (e) => {
    const tr = e.target.closest('tr.y');
    if (!tr) return;
    const y = +tr.dataset.y;
    if (open.has(y)) open.delete(y); else open.add(y);
    draw();
  });
  y0.addEventListener('change', () => { lo = +y0.value; if (lo > hi) { hi = lo; y1.value = hi; } draw(); });
  y1.addEventListener('change', () => { hi = +y1.value; if (hi < lo) { lo = hi; y0.value = lo; } draw(); });
  yall.addEventListener('click', () => { lo = data.years[0]; hi = data.years[data.years.length - 1]; y0.value = lo; y1.value = hi; draw(); });
  expandAll.addEventListener('click', () => { data.years.forEach((y) => open.add(y)); draw(); });
  collapseAll.addEventListener('click', () => { open.clear(); draw(); });
  scaleSel.addEventListener('change', draw);
  showNum.addEventListener('change', draw);

  return { update(d) { data = d; fillSelects(); draw(); } };
}
