// theme.js 的測試:主題解析與套用到 <html data-theme> 的行為(純物件,不需要真的 DOM)。
import {
  THEMES, THEME_KEY, DEFAULT_THEME, normalizeTheme, resolveTheme, applyTheme, forceLightForCapture,
} from '../web/src/theme.js';

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

const root = () => ({ dataset: {} });

eq('三種模式', THEMES, ['auto', 'light', 'dark']);
eq('預設是跟隨系統', DEFAULT_THEME, 'auto');
isOk('localStorage 鍵名固定', THEME_KEY === 'portfolio_tool.theme.v1', THEME_KEY);

eq('未知值退回 auto', normalizeTheme('neon'), 'auto');
eq('null 退回 auto', normalizeTheme(null), 'auto');
eq('auto + 系統淺 → light', resolveTheme('auto', false), 'light');
eq('auto + 系統深 → dark', resolveTheme('auto', true), 'dark');
eq('強制 light 不跟系統', resolveTheme('light', true), 'light');
eq('強制 dark 不跟系統', resolveTheme('dark', false), 'dark');

// CSS 只認 data-theme,所以 auto 也一定要落到具體值,否則深色模式不會生效
const r1 = root();
eq('applyTheme 回傳生效值', applyTheme(r1, 'auto', true), 'dark');
eq('auto 也會寫出 data-theme', r1.dataset.theme, 'dark');
const r2 = root();
applyTheme(r2, 'auto', false);
eq('系統淺時 auto 寫 light', r2.dataset.theme, 'light');
const r3 = root();
r3.dataset.theme = 'dark';
applyTheme(r3, 'light', true);
eq('切換會覆寫既有屬性', r3.dataset.theme, 'light');

// 截圖白底:暫時蓋 light,還原後回到原本選的主題
const r4 = root();
applyTheme(r4, 'dark', false);
const restore = forceLightForCapture(r4, 'dark', false);
eq('截取期間是白底', r4.dataset.theme, 'light');
restore();
eq('截完還原成深色', r4.dataset.theme, 'dark');

// 截取期間使用者改了選擇 → 還原要以新選擇為準,不能卡回舊值
const r5 = root();
applyTheme(r5, 'auto', true); // 生效 dark
const restore5 = forceLightForCapture(r5, 'auto', true);
eq('auto 且系統深時截取前是 light', r5.dataset.theme, 'light');
restore5();
eq('還原後回到 auto 解析出的 dark', r5.dataset.theme, 'dark');
const restore6 = forceLightForCapture(r5, 'light', true);
restore6();
eq('選 light 時還原不會被系統拉回深色', r5.dataset.theme, 'light');

console.log(fail ? `\n${fail} 項失敗` : '\ntheme 測試通過');
process.exit(fail ? 1 : 0);
