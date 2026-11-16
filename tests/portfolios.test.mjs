// portfolios.js 的資料層測試:指紋、清單解析/寫出、名稱規則、比較表指標與最佳最差。
import {
  REGISTRY_NAME, fingerprints, diffFingerprints, describeDiff, parseRegistry, serializeRegistry,
  checkName, checkNote, metricsOf, rankMetrics, diffValue, METRICS,
} from '../web/src/portfolios.js';
import { computeReport, parseDate } from '../web/src/core.js';

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

const DAY = 86400000;
const D0 = parseDate('2024-01-01');
const mk = (name, vals) => ({ name, rows: vals.map((v, i) => [D0 + i * DAY, v]), allocation: 1 });

// ---------- 指紋 ----------
const s1 = [mk('1', [100, -50, 25]), mk('2', [0, 0, 0])];
eq('指紋含筆數/加總/起訖日', fingerprints(s1), {
  1: { rows: 3, sum: 75, from: '2024-01-01', to: '2024-01-03' },
  2: { rows: 3, sum: 0, from: '2024-01-01', to: '2024-01-03' },
});
eq('加總四捨五入到分', fingerprints([mk('1', [0.1, 0.2])])['1'].sum, 0.3);

const saved = fingerprints(s1);
const now = fingerprints([mk('1', [100, -50, 30]), mk('3', [5, 5, 5])]);
const diff = diffFingerprints(saved, now);
eq('變/新增/移除各抓到', diff.map((d) => `${d.kind}:${d.name}`).sort(), ['added:3', 'changed:1', 'removed:2']);
isOk('描述寫出兩組數字', describeDiff(diff.find((d) => d.kind === 'changed')).includes('內容已換過'), describeDiff(diff[0]));
isOk('移除的描述提到不在資料夾', describeDiff(diff.find((d) => d.kind === 'removed')).includes('已不在資料夾'));
eq('指紋相同時沒有差異', diffFingerprints(saved, fingerprints(s1)), []);

// ---------- 清單 ----------
const list = [
  { id: 'p1', name: '龜烏A', note: '2026-11 加入避險', sub: '龜烏A', path: null, createdAt: '2026-11-16T10:00:00.000Z', savedAt: '2026-11-16T10:00:00.000Z', fingerprints: saved },
  { id: 'p2', name: '外接B', note: '放別台的碟', sub: null, path: 'D:\\PFO\\B', createdAt: null, savedAt: null, fingerprints: {} },
];
const text = serializeRegistry(list);
eq('寫出再讀回相同', parseRegistry(text).portfolios, list);
eq('檔名對', REGISTRY_NAME, 'portfolios.json');
eq('壞 JSON 有 error', typeof parseRegistry('{ oops').error, 'string');
eq('缺少 portfolios 陣列', parseRegistry('{"x":1}').error, '內容缺少 portfolios 陣列');
eq('空內容 = 尚無投組', parseRegistry(''), { portfolios: [], error: null });
eq('沒名稱/沒資料夾的筆被丟掉', parseRegistry(JSON.stringify({ portfolios: [{ name: '' , sub: 'a'}, { name: '沒資料夾' }, { name: 'OK', sub: 'ok' }] })).portfolios.map((p) => p.name), ['OK']);
eq('髒指紋列被丟掉', parseRegistry(JSON.stringify({ portfolios: [{ name: 'A', sub: 'a', fingerprints: { 1: { rows: 'x' }, 2: { rows: 3, sum: 1, from: '2024-01-01', to: null } } }] })).portfolios[0].fingerprints, { 2: { rows: 3, sum: 1, from: '2024-01-01', to: null } });
eq('沒有指紋欄位 = 尚未建基準(null,不是空物件)', parseRegistry(JSON.stringify({ portfolios: [{ name: 'A', sub: 'a' }] })).portfolios[0].fingerprints, null);

// ---------- 名稱 / 說明 ----------
eq('空名稱擋掉', checkName(list, ''), '名稱不能空白。');
eq('重複名稱擋掉', checkName(list, '龜烏A'), '已經有一個投資組合叫「龜烏A」。');
eq('大小寫不同也算重複', typeof checkName([{ id: 'x', name: 'AB', note: '', sub: 'ab', path: null, createdAt: null, savedAt: null, fingerprints: {} }], 'ab'), 'string');
eq('改自己不算重複', checkName(list, '龜烏A', 'p1'), null);
eq('路徑字元擋掉', /字元/.test(checkName(list, 'a/b') || ''), true);
eq('名稱太長擋掉', /40 字/.test(checkName(list, '長'.repeat(41)) || ''), true);
eq('空說明擋掉', typeof checkNote(''), 'string');
eq('正常說明通過', checkNote('2026-11 加入避險那組'), null);

// ---------- 比較表 ----------
const strategies = [mk('1', [100, -50, 25, 60]), mk('2', [-20, 30, 10, 5])];
const r = computeReport(strategies, { product: 'TMF', calcYear: 2024, endDate: D0 + 3 * DAY }, { startDate: D0, lastDate: D0 + 3 * DAY });
const m = metricsOf(r, strategies);
eq('總獲利取自報表', m.totalProfit, r.kpi.totalProfit);
eq('月平均用該投組自己的商品', m.avgAll, r.kpi.avgAll.TMF);
eq('納入策略數只算權重 > 0', m.strategyCount, 2);
eq('權重總和', m.weightSum, 2);
eq('指標共 15 列', METRICS.length, 15);
isOk('每列都有 label 與 kind', METRICS.every((x) => x.label && x.kind), '');

const rows = [
  { entry: { name: 'A' }, metrics: { totalProfit: 100, winRate: 0.5, recent5Avg: 10, strategyCount: 3, weightSum: 3 }, error: null },
  { entry: { name: 'B' }, metrics: { totalProfit: 200, winRate: 0.7, recent5Avg: 4, strategyCount: 4, weightSum: 4 }, error: null },
  { entry: { name: 'C' }, error: '資料夾不存在' },
];
const rank = rankMetrics(rows);
eq('越高越好:最佳是 B', rank.totalProfit.best, 1);
eq('越高越好:最差是 A(缺值那欄不参与)', rank.totalProfit.worst, 0);
eq('越低越好:最佳是 B', rank.recent5Avg.best, 1);
eq('納入策略數不標最佳最差', rank.strategyCount, { best: -1, worst: -1 });
eq('差值', diffValue(200, 100), 100);
eq('缺值時差值為 null', diffValue(null, 100), null);
const one = rankMetrics([{ entry: {}, metrics: { totalProfit: 5 }, error: null }]);
eq('只有一欄時不標最佳最差', one.totalProfit, { best: -1, worst: -1 });

console.log(fail ? `\n${fail} 項失敗` : '\nportfolios 測試通過');
process.exit(fail ? 1 : 0);
