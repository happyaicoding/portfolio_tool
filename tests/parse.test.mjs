// CSV 解析:編碼(UTF-8 / Big5)、分隔符號、兩欄與寬表。
import { decodeText, parseCsvText, tableToStrategies } from '../web/src/parse.js';

let fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(ok ? '✓' : '✗', label, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

const big5Bytes = new Uint8Array([0xb5, 0xa6, 0xb2, 0xa4]); // 「策略」的 Big5 編碼
eq('Big5 解碼', decodeText(big5Bytes.buffer), '策略');
eq('UTF-8 解碼', decodeText(new TextEncoder().encode('策略A').buffer), '策略A');

const utf8 = (s) => new TextEncoder().encode(s).buffer;
const two = tableToStrategies(parseCsvText(decodeText(utf8('date,pnl\n2024-01-02,100\n2024/1/3,"1,200"\n'))), '檔名');
eq('兩欄:策略名稱用檔名', two.map((s) => s.name), ['檔名']);
eq('兩欄:列數與千分位', two[0].rows.map((r) => r[1]), [100, 1200]);

const semi = tableToStrategies(parseCsvText('date;A;B\n2024-01-02;1;2\n2024-01-03;3;4\n'), 'x');
eq('分號分隔寬表', semi.map((s) => s.name), ['A', 'B']);

const noHeader = tableToStrategies(parseCsvText('2024-01-02,5\n2024-01-03,6\n'), '我的策略');
eq('無標題列用檔名', noHeader.map((s) => s.name), ['我的策略']);

// 分隔符號不能只看第一行:MTC 匯出的文字檔常以空白行或含逗號的說明行開頭
const leadBlank = tableToStrategies(parseCsvText('\n\n2024-01-02\t5\n2024-01-03\t6\n'), '空白行開頭');
eq('開頭空白行的 TSV 仍用 TAB 分欄', leadBlank[0]?.rows.map((r) => r[1]), [5, 6]);
const prose = tableToStrategies(
  parseCsvText('日期,損益(單位:元,未稅,含手續費)\n2024-01-02\t5\n2024-01-03\t6\n2024-01-04\t7\n'),
  '說明行開頭',
);
eq('說明行含逗號的 TSV 仍用 TAB 分欄', prose[0]?.rows.map((r) => r[1]), [5, 6, 7]);
const csvTail = tableToStrategies(
  parseCsvText('date,pnl\n2024-01-02,5\n2024-01-03,6\n2024-01-04,7\n2024-01-05,8\n'),
  '純 CSV',
);
eq('每行都有逗號時仍判為逗號', csvTail[0]?.rows.map((r) => r[1]), [5, 6, 7, 8]);

console.log(fail ? `\n${fail} 項失敗` : '\nparse 測試通過');
process.exit(fail ? 1 : 0);
