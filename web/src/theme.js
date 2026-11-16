// 外觀主題:跟隨系統 / 強制淺色 / 強制深色。
// 這是「外觀」而不是計算輸入,所以存全域(網站版 localStorage、桌面版 userData 的 config.json),
// 不寫進投組的 portfolio-config.json —— 否則換資料夾會連顏色一起換。
// CSS 端只認 <html data-theme="light|dark">,不再自己寫 @media (prefers-color-scheme):
// 「跟隨系統」由這裡讀 matchMedia 解析成實際主題,深淺兩套色表才不會各改各的而漂移。
// 純函式,DOM 由呼叫端傳進來,方便 Node 直測。

export const THEMES = ['auto', 'light', 'dark'];
export const THEME_KEY = 'portfolio_tool.theme.v1';
export const DEFAULT_THEME = 'auto';

export function normalizeTheme(v) {
  return THEMES.includes(v) ? v : DEFAULT_THEME;
}

/** 解析成實際生效的主題;auto 依系統的 prefersDark 決定。 */
export function resolveTheme(mode, prefersDark = false) {
  const m = normalizeTheme(mode);
  if (m !== 'auto') return m;
  return prefersDark ? 'dark' : 'light';
}

/** 套到文件根元素,回傳生效的主題。root 傳 documentElement(或任何有 dataset 的物件)。 */
export function applyTheme(root, mode, prefersDark = false) {
  const eff = resolveTheme(mode, prefersDark);
  root.dataset.theme = eff;
  return eff;
}

/**
 * 截圖要維持白紙(方便貼進 Excel/報表),所以截取前暫時蓋成 light,截完再還原。
 * 回傳還原動作;呼叫端一定要執行它,否則畫面會卡在淺色。
 */
export function forceLightForCapture(root, mode, prefersDark = false) {
  root.dataset.theme = 'light';
  return () => applyTheme(root, mode, prefersDark);
}
