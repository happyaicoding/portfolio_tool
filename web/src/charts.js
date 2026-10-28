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
