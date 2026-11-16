// 設定檔(web/src/config.js)的解析/寫出測試。純函式,不需要 DOM 或 .xlsm。
import { CONFIG_NAME, parseConfig, toConfigText } from '../web/src/config.js';
import { DEFAULT_SETTINGS, parseDate } from '../web/src/core.js';

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

// 沒有設定檔 = 用預設值,不是錯誤
eq('空內容回傳空設定', parseConfig(''), { settings: {}, weights: {}, error: null });
eq('null 回傳空設定', parseConfig(null), { settings: {}, weights: {}, error: null });

// 正常內容
const good = JSON.stringify({
  version: 1,
  settings: { product: 'TMF', ratio: 1, startDate: '2019-10-01', calcYear: 2026, txMargin: 636000, capital: 1000000, streakThreshold: 40, lots: { total: 20, dayTrade: 7, hold: 13, excess: 4 } },
  weights: { 1: 1, 2: 0.5, 3: 0 },
});
const p = parseConfig(good);
eq('日期字串轉成 UTC 日序', p.settings.startDate, parseDate('2019-10-01'));
eq('口數完整讀入', p.settings.lots, { total: 20, dayTrade: 7, hold: 13, excess: 4 });
eq('權重讀入', p.weights, { 1: 1, 2: 0.5, 3: 0 });
eq('解析不帶 error', p.error, null);

// BOM(記事本存檔常加)不影響
eq('BOM 開頭仍能解析', parseConfig('\uFEFF' + good).settings.startDate, parseDate('2019-10-01'));

// 髒值一律忽略,保留預設
const dirty = parseConfig(JSON.stringify({
  settings: { product: 'XXX', ratio: -2, startDate: '不是日期', endDate: '不是日期', calcYear: 'y', txMargin: null, capital: 'abc', streakThreshold: -5, lots: { total: 'x' } },
  weights: { A: -1, B: 'z', C: null, D: 2 },
}));
eq('非法值全部丟掉', dirty.settings, {});
eq('權重只留非負數字', dirty.weights, { D: 2 });
isOk('lots 缺欄時由 DEFAULT_SETTINGS 補', DEFAULT_SETTINGS.lots.total === 10, JSON.stringify(DEFAULT_SETTINGS.lots));

// 資料結束日期 = 原表 B30,創高天數以它為截止日,必須一起記住
const withEnd = parseConfig(JSON.stringify({ settings: { startDate: '2019-10-01', endDate: '2026-06-30' } }));
eq('endDate 一起讀入', withEnd.settings, { startDate: parseDate('2019-10-01'), endDate: parseDate('2026-06-30') });
const text2 = toConfigText({ ...DEFAULT_SETTINGS, ...withEnd.settings }, {});
isOk('endDate 寫回檔案', /"endDate": "2026-06-30"/.test(text2), text2);
eq('endDate round-trip 相同', parseConfig(text2).settings.endDate, parseDate('2026-06-30'));

// 壞 JSON 要明講,不能靜默當空
const broken = parseConfig('{ "settings": ');
isOk('壞 JSON 回傳 error', typeof broken.error === 'string' && broken.error.includes('JSON'), broken.error);
eq('壞 JSON 時設定為空', broken.settings, {});
eq('陣列不是合法內容', parseConfig('[1,2]').error, '內容不是物件');

// 寫出 → 再讀入 必須等值(round-trip)
const text = toConfigText({ ...DEFAULT_SETTINGS, ...p.settings }, p.weights);
eq('寫出後再解析相同', parseConfig(text).settings, p.settings);
eq('權重 round-trip 相同', parseConfig(text).weights, p.weights);
isOk('日期寫成 YYYY-MM-DD 字串', /"startDate": "2019-10-01"/.test(text), text);
isOk('未設定 endDate 時寫成 null(不是省略,編輯器才看得到這個欄位)', /"endDate": null/.test(text), text);
isOk('附檔名對', CONFIG_NAME === 'portfolio-config.json', CONFIG_NAME);

console.log(fail ? `\n${fail} 項失敗` : '\nconfig 測試通過');
process.exit(fail ? 1 : 0);
