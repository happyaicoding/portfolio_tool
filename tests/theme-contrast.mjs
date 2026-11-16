// 深淺兩套主題下的對比度檢查:掃總表與比較表每個有字的元素,算「文字色 vs 實際疊出來的底色」
// 的 WCAG 對比,低於門檻就失敗。原因很實際:深色模式剛做完時,有字被底色吃掉(River 2026-11-16 回報)。
// 這支需要 Electron,所以排在 npm run smoke,不在 npm test。
// 用法:node tests/theme-contrast.mjs [exe 路徑]
import { _electron as electron } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ws = path.join(root, 'mock-data');
const exe = process.argv[2];
const app = await electron.launch(exe
  ? { executablePath: path.resolve(exe), env: { ...process.env, PORTFOLIO_DATA_DIR: ws } }
  : { args: [root], env: { ...process.env, PORTFOLIO_DATA_DIR: ws } });

const MIN = 4.5; // WCAG AA 一般文字
let fail = 0;
const check = (label, ok, detail = '') => { if (!ok) fail++; console.log(ok ? '✓' : '✗', label, detail); };

try {
  const win = await app.firstWindow();
  await win.waitForSelector('#app:not([hidden])', { timeout: 30000 });

  const scan = () => win.evaluate((min) => {
    const parse = (s) => {
      const m = /rgba?\(([^)]+)\)/.exec(s);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1].split(',').map((x) => parseFloat(x));
      return { r, g, b, a };
    };
    const over = (c, bg) => ({ r: Math.round(c.r * c.a + bg.r * (1 - c.a)), g: Math.round(c.g * c.a + bg.g * (1 - c.a)), b: Math.round(c.b * c.a + bg.b * (1 - c.a)) });
    const bodyBg = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    // 沿父節點把每層底色由外而內疊起來,才是這個元素真的背在什麼顏色上
    const eff = (el) => {
      const chain = [];
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0) chain.push(c);
      }
      let acc = bodyBg;
      for (const l of chain.reverse()) acc = over(l, acc);
      return acc;
    };
    const lum = ({ r, g, b }) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (fg, bg) => { const a = lum(fg), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
    const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    const desc = (el) => {
      const tr = el.closest('tr');
      const tbl = el.closest('table');
      return `${tbl ? `#${tbl.id || tbl.className.split(/\s+/)[0]}` : '?'}${tr ? ` 第${[...tr.parentElement.children].indexOf(tr) + 1}列` : ''} ${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(/\s+/).join('.')}` : ''} 「${(el.value || el.textContent || '').trim().slice(0, 12)}」`;
    };
    const bad = [];
    let n = 0;
    for (const el of document.querySelectorAll('#sheet th, #sheet td, #sheet input, #sheet select, #sheet span, #cmpTable th, #cmpTable td')) {
      const txt = (el.value ?? el.textContent ?? '').trim();
      if (!txt) continue;
      n++;
      const cs = getComputedStyle(el);
      const fg = parse(cs.color);
      if (!fg) continue;
      const bg = eff(el);
      const r = +ratio({ ...fg, a: 1 }, bg).toFixed(2);
      if (r < min) bad.push(`${r}  字 ${hex(fg)} on ${hex(bg)}  ${desc(el)}`);
    }
    return { n, bad, theme: document.documentElement.dataset.theme };
  }, MIN);

  for (const theme of ['light', 'dark']) {
    await win.selectOption('#theme', theme);
    await win.waitForFunction((t) => document.documentElement.dataset.theme === t, theme);
    await win.click('.tabs button[data-tab="summary"]');
    await win.waitForTimeout(300);
    const sum = await scan();
    check(`${theme}:總表 ${sum.n} 個元素都有足夠對比(≥${MIN})`, sum.bad.length === 0, sum.bad.slice(0, 12).join('\n'));

    await win.click('.tabs button[data-tab="compare"]');
    await win.waitForTimeout(300);
    const cmp = await scan();
    check(`${theme}:比較表也過得去(${cmp.n} 個元素)`, cmp.bad.length === 0, cmp.bad.slice(0, 12).join('\n'));
    await win.click('.tabs button[data-tab="settings"]');
  }
  await win.selectOption('#theme', 'auto'); // 不要把測試用的主題留在這台電腦
} finally {
  await app.close();
}
console.log(fail ? `\n${fail} 項失敗` : '\n主題對比度測試通過');
process.exit(fail ? 1 : 0);
