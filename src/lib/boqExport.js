// ---------------------------------------------------------------------------
// boqExport.js — the schedule as three files.
//
// ONE GRID, THREE ENCODINGS. boqTable() in boq.js produces a rectangular table
// of strings; everything here only knows how to write a grid. That is the whole
// architecture, and it is the reason the CSV, the spreadsheet and the PDF cannot
// disagree with each other about a total — there is nowhere for them to disagree.
//
// NO DEPENDENCIES, which is a deliberate choice and not a stunt. This repo
// already hand-writes DXF, and the reasons that was right apply here twice over:
//
//   * SheetJS is ~500KB into a bundle that is already 700KB, to write one sheet
//     with no formulas, no merges and no styling worth the name.
//   * jsPDF is ~350KB to draw eight columns of Helvetica.
//   * both would be in the dependency tree of a tool that runs in an architect's
//     browser and reads their drawings.
//
// An XLSX is a ZIP of four small XML files, and a PDF is a handful of objects
// and a byte-offset table. Both are written below, in about 200 lines, and both
// are tested by being READ BACK — the xlsx is unzipped and its cells compared,
// which is the only test worth having for a format nobody can eyeball.
//
// BROWSER-SAFE. Uses Uint8Array and TextEncoder, no Node built-ins, so the same
// code runs in the app and in the test harness.
// ---------------------------------------------------------------------------

import { boqTable, boqSheets } from './boq.js';

const enc = (s) => new TextEncoder().encode(s);

/** XML text escaping. Ampersand first, or the escapes escape each other. */
export function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    // Control characters are illegal in XML 1.0 and a spreadsheet that contains
    // one will not open at all — it fails as "unreadable content", with no clue
    // which cell did it.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

// --- CSV --------------------------------------------------------------------

export function boqToCSV(boq) {
  return boqTable(boq).map((row) => row.map(csvCell).join(',')).join('\n');
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  // Quoted if it contains a comma, a quote, a newline, or leading/trailing
  // space. The degree sign and the multiplication sign are fine as UTF-8; the
  // BOM below is what makes Excel believe that.
  return /[",\n\r]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Excel reads a bare UTF-8 CSV as the local 8-bit codepage, so `36°` arrives as
 * `36Â°`. A BOM is the only thing that tells it otherwise, and it is invisible
 * everywhere else.
 */
export const CSV_BOM = '﻿';

// --- XLSX -------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/**
 * A ZIP with STORED (uncompressed) entries.
 *
 * Store rather than deflate because the alternative is shipping an inflate
 * implementation or pulling in pako, and a BOQ's XML is a few kilobytes — the
 * saving is invisible and the cost is a compression library. Every ZIP reader,
 * Excel included, reads stored entries; the format has supported them since
 * 1989.
 *
 * The date is fixed rather than `new Date()`. A file that differs byte for byte
 * between two runs of the same input cannot be diffed or checksummed, and a
 * timestamp is the only thing in here that would vary.
 */
export function zipStore(files) {
  const chunks = [], central = [];
  let offset = 0;

  const u16 = (n) => [n & 0xFF, (n >>> 8) & 0xFF];
  const u32 = (n) => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];
  // 1 Jan 2020, 00:00:00 in MS-DOS packed form.
  const DOS_TIME = 0, DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

  for (const { name, data } of files) {
    const nameBytes = enc(name);
    const crc = crc32(data);
    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0),
      ...u16(DOS_TIME), ...u16(DOS_DATE),
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0),
    ];
    chunks.push(new Uint8Array(local), nameBytes, data);
    central.push({ name: nameBytes, crc, size: data.length, offset });
    offset += local.length + nameBytes.length + data.length;
  }

  const dirStart = offset;
  const dir = [];
  for (const e of central) {
    dir.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0),
      ...u16(DOS_TIME), ...u16(DOS_DATE),
      ...u32(e.crc), ...u32(e.size), ...u32(e.size),
      ...u16(e.name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(e.offset));
    dir.push(...e.name);
  }
  const dirBytes = new Uint8Array(dir);
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(central.length), ...u16(central.length),
    ...u32(dirBytes.length), ...u32(dirStart), ...u16(0),
  ]);

  const total = chunks.reduce((n, c) => n + c.length, 0) + dirBytes.length + end.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  out.set(dirBytes, at); at += dirBytes.length;
  out.set(end, at);
  return out;
}

/** A1, B1 … Z1, AA1. Needed because a sheet cell is addressed, not positional. */
export function cellRef(col, row) {
  let s = '', n = col + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return `${s}${row + 1}`;
}

/**
 * Is this cell a number as far as a spreadsheet is concerned?
 *
 * Only a bare integer or decimal. NOT "36°", not "9.6 W/m", not "1,200" — a
 * string that merely starts with a digit written as a number is the classic way
 * a schedule opens in Excel with half its cells showing #VALUE. And not a
 * leading-zero string either: a room called "01 Bedroom" is a label, and
 * Excel turning it into 1 is data loss.
 */
export function isNumeric(s) {
  return typeof s === 'string' && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(s) && s !== '';
}

/**
 * THE STYLESHEET, as a small spec table rather than as XML by hand.
 *
 * Each named style is a combination of a font, a fill, a border, a number
 * format and an alignment; the XML wants those as four indexed lists plus a
 * fifth list of combinations. Writing that out by hand is where a stylesheet
 * gets an index wrong and every cell in the file comes out italic — so the
 * lists are generated from this table, and a style is referred to by name
 * everywhere else.
 *
 * THE NUMBER FORMATS ARE WHERE THE UNITS LIVE. `0" W"` shows 7 as `7 W` while
 * the cell still holds 7, which is the whole reason the formulas work.
 */
const FONTS = [
  { k: 'base',   sz: 10,   name: 'Calibri' },
  { k: 'bold',   sz: 10,   name: 'Calibri', b: 1 },
  { k: 'title',  sz: 15,   name: 'Calibri', b: 1 },
  { k: 'section',sz: 11,   name: 'Calibri', b: 1 },
  { k: 'sub',    sz: 9,    name: 'Calibri', color: 'FF6B7280' },
  { k: 'note',   sz: 9,    name: 'Calibri', color: 'FF6B7280' },
  { k: 'head',   sz: 9.5,  name: 'Calibri', b: 1, color: 'FF3F3F76' },
  { k: 'check',  sz: 10,   name: 'Calibri', b: 1, color: 'FF15803D' },
];
const FILLS = [
  // 0 and 1 are fixed by the spec: Excel rejects a stylesheet whose first two
  // fills are not `none` and `gray125`.
  { k: 'none' }, { k: 'gray125' },
  { k: 'head', fg: 'FFF1F2F7' },
];
const BORDERS = [
  { k: 'none' },
  { k: 'headRule', bottom: 'medium', bottomColor: 'FF3F3F76' },
  { k: 'row',      bottom: 'thin',   bottomColor: 'FFE5E7EB' },
  { k: 'totRule',  top: 'thin',      topColor: 'FF111111' },
];
// Custom formats start at 164; anything below that is Excel's own.
const NUMFMTS = [
  { k: 'int',    code: '#,##0' },
  { k: 'watt',   code: '0" W"' },
  { k: 'wattM',  code: '0.0" W/m"' },
  { k: 'beam',   code: '0"\u00B0"' },
  { k: 'metres', code: '0.00" m"' },
  { k: 'load',   code: '#,##0.0" W"' },
  { k: 'area',   code: '#,##0" sqft"' },
  { k: 'scale',  code: '0.00" px/ft"' },
  { k: 'wpsf',   code: '0.00" W/sqft"' },
];
/** name -> [font, fill, border, numFmt, {h, wrap}] */
const STYLES = {
  label:   ['base', 'none', 'row',      null,     {}],
  bold:    ['bold', 'none', 'row',      null,     {}],
  title:   ['title','none', 'none',     null,     {}],
  section: ['section','none','none',    null,     {}],
  sub:     ['sub',  'none', 'none',     null,     {}],
  subNum:  ['sub',  'none', 'none',     'int',    { h: 'left' }],
  note:    ['note', 'none', 'row',      null,     { wrap: 1 }],
  caveat:  ['note', 'none', 'none',     null,     { wrap: 1 }],
  h:       ['head', 'head', 'headRule', null,     {}],
  hr:      ['head', 'head', 'headRule', null,     { h: 'right' }],
  hc:      ['head', 'head', 'headRule', null,     { h: 'center' }],
  // INDENTED, because a right-aligned number in the column to the left ends
  // exactly where a left-aligned header begins — the render read "Load Notes"
  // and "Qty Unit" as single words. One character of indent is the whole fix.
  hi:      ['head', 'head', 'headRule', null,     { h: 'left', indent: 1 }],
  noteI:   ['note', 'none', 'row',      null,     { wrap: 1, h: 'left', indent: 1 }],
  caveatI: ['note', 'none', 'none',     null,     { wrap: 1, h: 'left', indent: 1 }],
  idx:     ['sub',  'none', 'row',      'int',    { h: 'right' }],
  num:     ['base', 'none', 'row',      'int',    { h: 'right' }],
  unit:    ['sub',  'none', 'row',      null,     { h: 'center' }],
  unitC:   ['sub',  'none', 'row',      null,     { h: 'right' }],
  watt:    ['base', 'none', 'row',      'watt',   { h: 'right' }],
  wattM:   ['base', 'none', 'row',      'wattM',  { h: 'right' }],
  beam:    ['base', 'none', 'row',      'beam',   { h: 'right' }],
  metres:  ['base', 'none', 'row',      'metres', { h: 'right' }],
  load:    ['base', 'none', 'row',      'load',   { h: 'right' }],
  area:    ['base', 'none', 'none',     'area',   { h: 'right' }],
  scale:   ['base', 'none', 'none',     'scale',  { h: 'right' }],
  wpsf:    ['bold', 'none', 'none',     'wpsf',   { h: 'right' }],
  tot:     ['base', 'none', 'totRule',  null,     {}],
  totBold: ['bold', 'none', 'totRule',  null,     {}],
  totUnit: ['sub',  'none', 'totRule',  null,     { h: 'center' }],
  totNum:  ['bold', 'none', 'totRule',  'int',    { h: 'right' }],
  totLoad: ['bold', 'none', 'totRule',  'load',   { h: 'right' }],
  totArea: ['bold', 'none', 'totRule',  'area',   { h: 'right' }],
  totMetres:['bold','none', 'totRule',  'metres', { h: 'right' }],
  check:   ['check','none', 'none',     null,     {}],
};
const STYLE_NAMES = Object.keys(STYLES);
const XF = Object.fromEntries(STYLE_NAMES.map((k, i) => [k, i + 1]));   // 0 is the default

function stylesXml() {
  const fmtId = Object.fromEntries(NUMFMTS.map((f, i) => [f.k, 164 + i]));
  const fontIx = Object.fromEntries(FONTS.map((f, i) => [f.k, i]));
  const fillIx = Object.fromEntries(FILLS.map((f, i) => [f.k, i]));
  const bordIx = Object.fromEntries(BORDERS.map((b, i) => [b.k, i]));

  const numFmts = `<numFmts count="${NUMFMTS.length}">`
    + NUMFMTS.map((f) => `<numFmt numFmtId="${fmtId[f.k]}" formatCode="${xmlEscape(f.code)}"/>`).join('')
    + `</numFmts>`;

  const fonts = `<fonts count="${FONTS.length}">`
    + FONTS.map((f) => `<font><sz val="${f.sz}"/><name val="${f.name}"/>`
        + (f.b ? '<b/>' : '') + (f.color ? `<color rgb="${f.color}"/>` : '') + `</font>`).join('')
    + `</fonts>`;

  const fills = `<fills count="${FILLS.length}">`
    + FILLS.map((f) => f.k === 'gray125'
        ? `<fill><patternFill patternType="gray125"/></fill>`
        : f.fg
          ? `<fill><patternFill patternType="solid"><fgColor rgb="${f.fg}"/><bgColor indexed="64"/></patternFill></fill>`
          : `<fill><patternFill patternType="none"/></fill>`).join('')
    + `</fills>`;

  const side = (name, style, color) => (style
    ? `<${name} style="${style}"><color rgb="${color}"/></${name}>` : `<${name}/>`);
  const borders = `<borders count="${BORDERS.length}">`
    + BORDERS.map((b) => `<border>${side('left')}${side('right')}`
        + side('top', b.top, b.topColor) + side('bottom', b.bottom, b.bottomColor)
        + `<diagonal/></border>`).join('')
    + `</borders>`;

  const xfs = STYLE_NAMES.map((k) => {
    const [fo, fi, bo, nf, al] = STYLES[k];
    const align = `<alignment${al.h ? ` horizontal="${al.h}"` : ''} vertical="top"`
      + `${al.wrap ? ' wrapText="1"' : ''}${al.indent ? ` indent="${al.indent}"` : ''}/>`;
    return `<xf numFmtId="${nf ? fmtId[nf] : 0}" fontId="${fontIx[fo]}" fillId="${fillIx[fi]}"`
      + ` borderId="${bordIx[bo]}" xfId="0"${nf ? ' applyNumberFormat="1"' : ''}`
      + ` applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${align}</xf>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + numFmts + fonts + fills + borders
    + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
    + `<cellXfs count="${STYLE_NAMES.length + 1}">`
    + `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`
    + xfs
    + `</cellXfs>`
    + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`
    + `<dxfs count="0"/><tableStyles count="0"/></styleSheet>`;
}

/**
 * One worksheet.
 *
 * THE ELEMENT ORDER IS THE SCHEMA'S, NOT MINE. CT_Worksheet is a sequence, so
 * sheetPr, dimension, sheetViews, sheetFormatPr, cols, sheetData, mergeCells,
 * pageMargins, pageSetup — in that order. Excel refuses a worksheet whose
 * children are out of sequence and says only that the file is unreadable.
 */
function sheetXml(sheet) {
  const width = Math.max(1, ...sheet.rows.map((r) => r.length));
  const body = sheet.rows.map((row, y) => {
    const cells = row.map((c, x) => {
      if (!c) return '';
      const ref = cellRef(x, y);
      const st = c.s && XF[c.s] != null ? ` s="${XF[c.s]}"` : '';
      // A FORMULA CARRIES ITS LAST KNOWN VALUE. A reader that does not calculate
      // still shows a number, and `fullCalcOnLoad` below makes Excel recompute
      // the moment it opens — so the cached value can never be the thing anyone
      // is looking at, but its absence would leave a blank in Numbers and in
      // Google Sheets' first paint.
      if (c.f) {
        return `<c r="${ref}"${st}${c.t === 's' ? ' t="str"' : ''}>`
          + `<f>${xmlEscape(c.f)}</f>`
          + (c.v === '' || c.v == null ? '' : `<v>${xmlEscape(String(c.v))}</v>`)
          + `</c>`;
      }
      if (c.t === 'n' && Number.isFinite(c.v)) return `<c r="${ref}"${st}><v>${c.v}</v></c>`;
      if (c.v === '' || c.v == null) return st ? `<c r="${ref}"${st}/>` : '';
      return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(c.v))}</t></is></c>`;
    }).filter(Boolean).join('');
    return cells ? `<row r="${y + 1}">${cells}</row>` : '';
  }).filter(Boolean).join('');

  const cols = (sheet.cols || []).map((w, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');

  const freeze = sheet.freeze
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sheet.freeze}"`
      + ` topLeftCell="A${sheet.freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;

  const merges = (sheet.merges || []).length
    ? `<mergeCells count="${sheet.merges.length}">`
      + sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join('') + `</mergeCells>`
    : '';

  const last = cellRef(Math.max(0, width - 1), Math.max(0, sheet.rows.length - 1));

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`
    + `<dimension ref="A1:${last}"/>`
    + freeze
    + `<sheetFormatPr defaultRowHeight="14.5"/>`
    + (cols ? `<cols>${cols}</cols>` : '')
    + `<sheetData>${body}</sheetData>`
    + merges
    // A4 portrait, fitted to the page width — the same page the PDF uses, so
    // printing from either produces the same shape of thing.
    + `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>`
    + `<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>`
    + `</worksheet>`;
}

export function boqToXLSX(boq) {
  const sheets = boqSheets(boq);

  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"`
    + ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<sheets>`
    + sheets.map((s, i) =>
        `<sheet name="${xmlEscape(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
    + `</sheets>`
    // RECALCULATE ON OPEN. Without it Excel trusts our cached values, and a
    // cached value we got wrong would sit there looking authoritative.
    + `<calcPr calcId="0" fullCalcOnLoad="1"/>`
    + `</workbook>`;

  const styleRid = sheets.length + 1;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + sheets.map((s, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"`
        + ` Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${styleRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"`
    + ` Target="styles.xml"/>`
    + `</Relationships>`;

  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
    + sheets.map((_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
    + `</Types>`;

  const root = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
    + `</Relationships>`;

  return zipStore([
    // [Content_Types].xml FIRST. The spec does not require it and every reader
    // in practice looks for it at the start of the archive; putting it last
    // produces a file that some versions of Excel refuse without saying why.
    { name: '[Content_Types].xml', data: enc(ct) },
    { name: '_rels/.rels', data: enc(root) },
    { name: 'xl/workbook.xml', data: enc(wb) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc(rels) },
    { name: 'xl/styles.xml', data: enc(stylesXml()) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc(sheetXml(s)) })),
  ]);
}

// --- PDF --------------------------------------------------------------------

const PDF = {
  // A4 portrait in points.
  w: 595.28, h: 841.89,
  margin: 40,
  // The space kept clear on the right of every column. See fitText.
  gutter: 7,
  size: 8.5,
  lead: 13.5,
  headSize: 13,
};

/** WinAnsi, which is what the core fonts encode. */
const WINANSI = { '°': '\\260', '×': '\\327', '·': '\\267', '—': '-', '–': '-',
                  '’': "'", '‘': "'", '“': '"', '”': '"', '′': "'", '″': '"' };

export function pdfText(s) {
  let out = '';
  for (const ch of String(s)) {
    if (WINANSI[ch]) { out += WINANSI[ch]; continue; }
    const c = ch.codePointAt(0);
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if (c < 32) out += ' ';
    else if (c > 255) out += '?';       // outside WinAnsi: a core font has no glyph
    else if (c > 126) out += '\\' + c.toString(8).padStart(3, '0');
    else out += ch;
  }
  return out;
}

/**
 * The grid as a plain PDF: one A4 page per ~55 rows, Helvetica, ruled header.
 *
 * "Plain" is the brief and it is also the right answer — a BOQ is read, priced
 * and marked up, and a designed one gets in the way of that. What it does have
 * is column alignment (numbers right, text left), a rule under each header row,
 * and page numbers, because those are the things whose absence makes a table
 * unreadable rather than merely plain.
 */
export function boqToPDF(boq, { title = 'Lighting schedule' } = {}) {
  // The table's own first row is the words "LIGHTING SCHEDULE", which is what a
  // CSV or a spreadsheet needs because neither has a title anywhere else. A PDF
  // has one at the top of the page, so printing both is printing it twice.
  const all = boqTable(boq);
  const rows = all[0]?.length === 1 && /^LIGHTING SCHEDULE$/.test(all[0][0]) ? all.slice(1) : all;

  const perPage = Math.floor((PDF.h - PDF.margin * 2 - 40) / PDF.lead);
  const pages = [];
  for (let i = 0; i < rows.length; i += perPage) pages.push(rows.slice(i, i + perPage));
  if (!pages.length) pages.push([]);

  // WHICH SECTION EACH ROW BELONGS TO, tracked as the page is walked. The
  // schedule is not one table: the fitting lines have eight columns of one
  // shape, the room breakdown has eight of a completely different shape, and the
  // header lines are two or three loose facts. Laying all of them on the fitting
  // grid is what put "Living / dining" on top of "410" and "Rooms: 5" on top of
  // "Area: 844 sqft".
  let section = 'meta';
  const sectionFor = (row) => {
    if (row[0] === 'Item') { section = 'fittings'; return section; }
    if (row[0] === 'Space') { section = 'rooms'; return section; }
    if (row.length === 1) return 'title';
    return section;
  };

  const streams = pages.map((page, pi) => {
    const out = [];
    let y = PDF.h - PDF.margin;

    out.push('BT', `/F2 ${PDF.headSize} Tf`, `1 0 0 1 ${PDF.margin} ${y.toFixed(1)} Tm`,
             `(${pdfText(title)}) Tj`, 'ET');
    y -= PDF.headSize + 10;

    for (const row of page) {
      const kind = sectionFor(row);
      const isHead = row[0] === 'Item' || row[0] === 'Space';
      const isTitle = kind === 'title' && row[0];
      const font = isHead || isTitle ? '/F2' : '/F1';
      const cols = columnLayout(kind);

      if (row.length) {
        out.push('BT', `${font} ${PDF.size} Tf`);
        row.forEach((v, x) => {
          const s = v == null ? '' : String(v);
          if (!s) return;
          const col = cols[x] ?? cols[cols.length - 1];
          // EVERY COLUMN KEEPS A GUTTER. Without it a right-aligned number ends
          // exactly where the next column starts, and the page reads "22nos",
          // "154ambient grid", "Load (W)Notes" — which is what it did.
          const room = Math.max(8, col.w - PDF.gutter);
          const text = fitText(s, PDF.size, room);
          const tx = col.right ? col.x + room - textWidth(text, PDF.size) : col.x;
          out.push(`1 0 0 1 ${tx.toFixed(1)} ${y.toFixed(1)} Tm`, `(${pdfText(text)}) Tj`);
        });
        out.push('ET');
      }
      if (isHead) {
        const rule = y - 3.5;
        out.push('0.6 w', `${PDF.margin} ${rule.toFixed(1)} m`,
                 `${(PDF.w - PDF.margin).toFixed(1)} ${rule.toFixed(1)} l`, 'S');
      }
      y -= isTitle ? PDF.lead * 1.35 : PDF.lead;
    }

    const foot = `Page ${pi + 1} of ${pages.length}`;
    out.push('BT', `/F1 7.5 Tf`,
             `1 0 0 1 ${(PDF.w - PDF.margin - textWidth(foot, 7.5)).toFixed(1)} ${PDF.margin - 12} Tm`,
             `(${pdfText(foot)}) Tj`, 'ET');
    return out.join('\n');
  });

  return assemblePDF(streams);
}

/**
 * Column proportions per section, and which of them are right-aligned.
 *
 * Numbers right, words left — the one typographic rule a schedule cannot do
 * without, because a column of right-aligned integers can be read down and a
 * ragged one cannot.
 */
const LAYOUTS = {
  //         Item  Description Qty   Unit  Wattage Beam  Load  Notes
  fittings: { share: [0.05, 0.25, 0.07, 0.07, 0.09, 0.06, 0.08, 0.33], right: [2, 6] },
  //         Space Area  Small Large Spots Sconce Strip Art
  // The eighth column was always reserved and always blank; the render pass's
  // art spots go in it when there are any. RIGHT-ALIGNED like every other count
  // on this row — it was the one index missing from the list, which nobody could
  // see while the column had nothing in it.
  rooms:    { share: [0.24, 0.12, 0.10, 0.10, 0.10, 0.11, 0.12, 0.11], right: [1, 2, 3, 4, 5, 6, 7] },
  // Loose facts across the top, and the "Total …" rows, which sit under the
  // fitting grid and are laid out with it.
  meta:     { share: [0.30, 0.30, 0.40], right: [] },
  title:    { share: [1], right: [] },
};

function columnLayout(kind) {
  const L = LAYOUTS[kind] ?? LAYOUTS.fittings;
  const avail = PDF.w - PDF.margin * 2;
  const right = new Set(L.right);
  const out = [];
  let x = PDF.margin;
  for (let i = 0; i < L.share.length; i++) {
    const w = avail * L.share[i];
    out.push({ x, w, right: right.has(i) });
    x += w;
  }
  return out;
}

/**
 * Cut a string to fit a column.
 *
 * A note that runs off the right edge of the page is not a small cosmetic
 * problem: it is text the reader cannot see and does not know is missing. The
 * two dots say something was cut.
 */
export function fitText(s, size, maxW) {
  if (textWidth(s, size) <= maxW) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (textWidth(s.slice(0, mid) + '..', size) <= maxW) lo = mid; else hi = mid - 1;
  }
  return lo <= 0 ? '' : s.slice(0, lo).trimEnd() + '..';
}

// Helvetica advance widths, /1000 em, for the ASCII range. Enough to right-align
// a number column; a full AFM would be 200 lines for no visible gain.
const HELV = (() => {
  const w = new Array(256).fill(556);
  const set = (s, v) => { for (const c of s) w[c.charCodeAt(0)] = v; };
  set(' !', 278); set('"', 355); set('#$', 556); set('%', 889); set('&', 667);
  set("'", 191); set('()', 333); set('*', 389); set('+', 584); set(',', 278);
  set('-', 333); set('.', 278); set('/', 278); set('0123456789', 556);
  set(':;', 278); set('<=>', 584); set('?', 556); set('@', 1015);
  set('ABDEHKNPRSUVXY', 667); set('C', 722); set('FI', 278); set('G', 778);
  set('J', 500); set('L', 556); set('MQ', 833); set('OW', 778); set('TZ', 611);
  set('[]', 278); set('\\', 278); set('^', 469); set('_', 556); set('`', 333);
  set('acdeghknopqsu', 556); set('b', 556); set('f', 278); set('i', 222);
  set('jl', 222); set('m', 833); set('r', 333); set('t', 278); set('vxyz', 500);
  set('w', 722); set('{}', 334); set('|', 260); set('~', 584);
  w[0xB0] = 400; w[0xD7] = 584; w[0xB7] = 278;
  return w;
})();

export function textWidth(s, size) {
  let n = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    n += (c < 256 ? HELV[c] : 556);
  }
  return (n / 1000) * size;
}

/**
 * Objects, then the xref table whose byte offsets must be exact.
 *
 * This is the part that has to be right to the byte: a reader seeks to the
 * offset in the xref and expects to land on `N 0 obj`. One character out and the
 * file is corrupt with no useful message. So offsets are measured on the
 * ENCODED bytes as they are appended, never computed from string lengths — a
 * degree sign is one character and two bytes.
 */
function assemblePDF(streams) {
  const parts = [];
  const offsets = [];
  let len = 0;
  const push = (s) => { const b = enc(s); parts.push(b); len += b.length; };
  const obj = (n, body) => { offsets[n] = len; push(`${n} 0 obj\n${body}\nendobj\n`); };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  const nPages = streams.length;
  const firstContent = 5;
  const firstPage = firstContent + nPages;

  obj(1, `<< /Type /Catalog /Pages 2 0 R >>`);
  obj(2, `<< /Type /Pages /Kids [${streams.map((_, i) => `${firstPage + i} 0 R`).join(' ')}]`
       + ` /Count ${nPages} >>`);
  obj(3, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
  obj(4, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);

  streams.forEach((s, i) => {
    const bytes = enc(s);
    obj(firstContent + i, `<< /Length ${bytes.length} >>\nstream\n${s}\nendstream`);
  });

  streams.forEach((_, i) => {
    obj(firstPage + i, `<< /Type /Page /Parent 2 0 R`
      + ` /MediaBox [0 0 ${PDF.w} ${PDF.h}]`
      + ` /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >>`
      + ` /Contents ${firstContent + i} 0 R >>`);
  });

  const count = firstPage + nPages;
  const xrefAt = len;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) {
    xref += `${String(offsets[n] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(len);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
