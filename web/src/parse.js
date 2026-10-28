// 檔案解析:CSV / TSV / XLSX / XLSM → 策略日損益。無外部相依(用瀏覽器與 Node 內建的 DecompressionStream)。
import { parseDate } from './core.js';

const DAY_MS = 86400000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

// ---------- CSV ----------

export function parseCsvText(text) {
  text = text.replace(/^﻿/, '');
  const delim = (text.split('\n', 1)[0].match(/\t/g) || []).length ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map(coerce));
}

function coerce(v) {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (t === '') return null;
  const d = parseDate(t);
  if (d != null && /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(t)) return { date: d };
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) ? n : t;
}

// ---------- XLSX / XLSM ----------

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 xlsx/zip 檔案');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files = new Map();
  for (let k = 0; k < count; k++) {
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const elen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    if (!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(name)) continue;
    const lnlen = dv.getUint16(off + 26, true);
    const lelen = dv.getUint16(off + 28, true);
    const start = off + 30 + lnlen + lelen;
    const data = u8.subarray(start, start + csize);
    files.set(name, async () => dec.decode(method === 0 ? data : await inflateRaw(data)));
  }
  return files;
}

const unesc = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');

function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref)[1];
  let n = 0;
  for (const ch of m) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

const BUILTIN_DATE_FMT = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

export async function parseXlsx(buf) {
  const files = await unzip(buf);
  const read = async (n) => (files.has(n) ? files.get(n)() : null);

  const sstXml = await read('xl/sharedStrings.xml');
  const sst = [];
  if (sstXml) {
    for (const si of sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      sst.push(unesc([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join('')));
    }
  }

  const stylesXml = (await read('xl/styles.xml')) || '';
  const customDate = new Set();
  for (const m of stylesXml.matchAll(/<numFmt\s+numFmtId="(\d+)"\s+formatCode="([^"]*)"/g)) {
    const code = m[2].replace(/\[[^\]]*\]|"[^"]*"|\\./g, '');
    if (/[ymdhs]/i.test(code)) customDate.add(+m[1]);
  }
  const xfIsDate = [];
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
  if (xfs) {
    for (const m of xfs[1].matchAll(/<xf\b[^>]*?numFmtId="(\d+)"/g)) {
      const id = +m[1];
      xfIsDate.push(BUILTIN_DATE_FMT.has(id) || customDate.has(id));
    }
  }

  const wbXml = await read('xl/workbook.xml');
  const relXml = await read('xl/_rels/workbook.xml.rels');
  const rels = new Map();
  for (const m of relXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])[1];
    const target = /Target="([^"]+)"/.exec(m[0])[1];
    rels.set(id, target.startsWith('/') ? target.slice(1) : 'xl/' + target);
  }

  const sheets = [];
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unesc(/name="([^"]*)"/.exec(m[0])[1]);
    const rid = /r:id="([^"]+)"/.exec(m[0])[1];
    const xml = await read(rels.get(rid));
    if (!xml) continue;
    const rows = [];
    for (const rm of xml.matchAll(/<row\b[^>]*?r="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const r = +rm[1] - 1;
      if (!rm[2]) continue;
      const arr = (rows[r] = []);
      for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1];
        const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
        if (!ref || cm[2] == null) continue;
        const t = /\bt="(\w+)"/.exec(attrs)?.[1];
        const s = /\bs="(\d+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(cm[2])?.[1];
        if (v == null) {
          const is = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(cm[2]);
          if (is) arr[colIndex(ref)] = unesc(is[1]);
          continue;
        }
        let val;
        if (t === 's') val = sst[+v];
        else if (t === 'str' || t === 'inlineStr') val = unesc(v);
        else if (t === 'b') val = v === '1';
        else if (t === 'e') val = null;
        else {
          const n = Number(v);
          val = s != null && xfIsDate[+s] ? { date: EXCEL_EPOCH + Math.floor(n) * DAY_MS } : n;
        }
        arr[colIndex(ref)] = val;
      }
    }
    sheets.push({ name, rows });
  }
  return sheets;
}

// ---------- 表格 → 策略 ----------

const isDate = (v) => v && typeof v === 'object' && 'date' in v;
const isNum = (v) => typeof v === 'number';

function numericRows(col, rows, from) {
  const out = [];
  for (let r = from; r < rows.length; r++) {
    const d = rows[r]?.[col];
    const v = rows[r]?.[col + 1];
    if (isDate(d) && isNum(v)) out.push([d.date, v]);
  }
  return out;
}

/**
 * 支援三種版面:
 *  1. 寬表:第一欄日期,其餘每欄一個策略(第一列為策略名稱)。
 *  2. 兩欄:日期、損益 → 單一策略(名稱用檔名)。
 *  3. 原報表「文字檔」:每個策略一組「日期、損益」,橫向排列。
 */
export function tableToStrategies(rows, fallbackName = '策略') {
  rows = Array.from(rows, (r) => r || []);
  const width = Math.max(0, ...rows.map((r) => r.length));
  const firstData = rows.findIndex((r) => r.some((v, c) => isDate(v) && isNum(r[c + 1])));
  if (firstData < 0) return [];
  const probe = rows[firstData];

  // 版面 3:同一列在 0、2、4… 欄都有日期
  const dateCols = [];
  for (let c = 0; c < width; c += 2) if (isDate(probe[c]) && isNum(probe[c + 1])) dateCols.push(c);
  const pairs = dateCols.length >= 2 && dateCols.every((c, i) => c === i * 2);

  const header = (c) => {
    for (let r = firstData - 1; r >= 0; r--) {
      const v = rows[r]?.[c];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (isNum(v)) return String(v);
    }
    return null;
  };

  const out = [];
  if (pairs) {
    dateCols.forEach((c, i) => {
      const r = numericRows(c, rows, firstData);
      if (r.length) out.push({ name: header(c + 1) || header(c) || `${fallbackName}${i + 1}`, rows: r });
    });
    return out;
  }
  // 版面 1 / 2
  const dateCol = probe.findIndex(isDate);
  for (let c = 0; c < width; c++) {
    if (c === dateCol) continue;
    const r = [];
    for (let i = firstData; i < rows.length; i++) {
      const d = rows[i][dateCol];
      const v = rows[i][c];
      if (isDate(d) && isNum(v)) r.push([d.date, v]);
    }
    if (r.length) out.push({ name: header(c) || (width <= 2 ? fallbackName : `${fallbackName}${c}`), rows: r });
  }
  return out;
}

/** 讀取使用者選擇的檔案,回傳 [{ name, rows }]。 */
export async function loadFile(file) {
  const base = file.name.replace(/\.[^.]+$/, '');
  if (/\.(xlsx|xlsm)$/i.test(file.name)) {
    const sheets = await parseXlsx(await file.arrayBuffer());
    const preferred = sheets.find((s) => s.name === '文字檔') || sheets[0];
    const out = tableToStrategies(preferred.rows, base);
    // 原報表「文字檔」B1 為開始日期,早於它的資料不納入(同 Excel 行為)
    const start = preferred.name === '文字檔' && isDate(preferred.rows[0]?.[1]) ? preferred.rows[0][1].date : null;
    if (start != null) out.startDate = start;
    return out;
  }
  return tableToStrategies(parseCsvText(await file.text()), base);
}
