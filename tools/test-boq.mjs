// ---------------------------------------------------------------------------
// test-boq.mjs — the schedule, and the three files it becomes.
//
// A BOQ is the one output of this app that somebody spends money against, so
// the assertions here are about arithmetic and about honesty: the counts add up,
// and the connected load says what it excludes rather than quietly omitting it.
//
// AND THE FILES ARE READ BACK. An xlsx is a zip nobody can eyeball and a
// corrupt one opens as "unreadable content" with no clue which cell did it, so
// this unzips its own output and compares the cells. A test that only checks
// the writer did not throw is a test that passes on a file Excel refuses.
//
//   node tools/test-boq.mjs
// ---------------------------------------------------------------------------

import zlib from 'zlib';
import { buildBOQ, boqTable, FIXTURES, FIXTURE_BY_ID, runMetres } from '../src/lib/boq.js';
import { setRunEnd, moveRun } from '../src/lib/accentPlace.js';
import { boqToCSV, boqToXLSX, boqToPDF, crc32, cellRef, isNumeric,
         xmlEscape, pdfText, textWidth, zipStore } from '../src/lib/boqExport.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

const PX = 20;   // px/ft
const room2 = (id, name, small, large, areaSqft) => ({
  id, outline: { name },
  plan: { ok: true, stats: { areaSqft, small, large },
          lights: [...Array(small).fill({ kind: 'small' }), ...Array(large).fill({ kind: 'large' })] },
});
const room = (id, name, small, large, areaSqft) => ({
  id, outline: { name },
  plan: { ok: true, stats: { areaSqft, small, large },
          lights: [...Array(small).fill({ kind: 'small' }), ...Array(large).fill({ kind: 'large' })] },
});

const PLAN = {
  rooms: [room('r1', 'Living', 6, 2, 320), room('r2', 'Bed 1', 4, 0, 150),
          room('r3', 'Toilet', 1, 0, 40)],
  // 10 ft of strip in the living room, 5 ft in the bedroom.
  accents: [
    { id: 'a1', roomId: 'r1', type: 'strip', runLength: 10 * PX },
    { id: 'a2', roomId: 'r2', type: 'strip', runLength: 5 * PX },
    { id: 'a3', roomId: 'r2', type: 'sconce' },
    { id: 'a4', roomId: 'r2', type: 'sconce' },
    { id: 'a5', roomId: 'r3', type: 'sconce' },
    { id: 'a6', roomId: 'r1', type: 'sconce', rejected: 'too far from a wall' },
  ],
  spots: [{ roomId: 'r1' }, { roomId: 'r1' }],
  objects: [{ kind: 'fan' }, { kind: 'chandelier' }, { kind: 'ac' }],
  pxPerFt: PX,
  plan: 'FLOOR_PLAN_03.png',
};

console.log('-- the counts --');
const boq = buildBOQ(PLAN);
{
  const q = (id) => boq.lines.find((l) => l.id === id);
  ok(q('small').qty === 11, `small downlights: ${q('small').qty}`);
  ok(q('large').qty === 2, `large downlights: ${q('large').qty}`);
  ok(q('spot').qty === 2, `directional spots: ${q('spot').qty}`);
  ok(q('sconce').qty === 3, `sconces, with the rejected one excluded: ${q('sconce').qty}`);
  ok(!boq.lines.some((l) => l.qty === 0 && l.pieces === 0), 'a fitting with none of it is not a line');
}

console.log('\n-- the wattages and beams are the stated ones --');
{
  const q = (id) => boq.lines.find((l) => l.id === id);
  ok(q('small').watts === 7 && q('small').beam === 36, '7W / 36 degrees');
  ok(q('large').watts === 12 && q('large').beam === 60, '12W / 60 degrees');
  ok(q('spot').watts === 5 && q('spot').beam === 30, '5W / 30 degrees');
  ok(FIXTURE_BY_ID.strip.wattsPerM === 9.6, 'strip is 9.6 W/m');

  // A SCONCE HAS NO WATTAGE AND THAT IS NOT ZERO. Zero would sum into the load
  // as a fitting that draws nothing, which is a claim about a fitting nobody
  // has chosen yet.
  ok(q('sconce').watts === null, 'a sconce states no wattage');
  ok(q('sconce').load === null, 'so it contributes no load, rather than contributing zero');
}

console.log('\n-- strip is metres, and also runs --');
{
  const q = boq.lines.find((l) => l.id === 'strip');
  ok(q.unit === 'm', 'billed by length');
  // 15 ft = 4.572 m
  ok(near(q.qty, 4.57, 0.005), `10 ft + 5 ft of run comes to ${q.qty} m`);
  ok(q.pieces === 2, `and it is 2 separate runs: ${q.pieces}`);
  ok(near(q.load, 4.57 * 9.6, 0.2), `with a load of ${q.load} W at 9.6 W/m`);

  // Without a scale a strip is still a strip.
  const noScale = buildBOQ({ ...PLAN, pxPerFt: null });
  const s2 = noScale.lines.find((l) => l.id === 'strip');
  ok(s2 && s2.pieces === 2 && s2.qty === 0,
    'with no scale set the runs are counted and the metres are not invented');
  ok(noScale.scaled === false, 'and the BOQ says it is unscaled');

  ok(near(runMetres({ runLength: 10 * PX }, PX), 3.048, 1e-6), 'runMetres converts pixels to metres');
  ok(runMetres({}, PX) === null, 'and refuses when there is nothing to convert');

  // A LENGTH ALREADY IN FEET IS NOT TRUSTED. App.jsx used to stamp `runFt` onto
  // a zone when the accent pass placed it, and runMetres preferred it — so a
  // strip whose end had since been dragged went on reporting its original
  // length. The geometry is the only source that cannot be stale.
  ok(near(runMetres({ runLength: 30 * PX, runFt: 3 }, PX), 30 * 0.3048, 1e-6),
    'a stale runFt on the zone is ignored in favour of the geometry');
}

console.log('\n-- A DRAGGED STRIP CHANGES THE SCHEDULE --');
{
  // THE BUG, end to end. A strip is placed, its length is stamped on the zone in
  // feet, and then the user drags an end. Everything downstream read the stamp,
  // so the drawing said 12 ft and the BOQ said 3 ft — for the rest of the
  // session, with nothing to hint that the two disagreed.
  //
  // Built here exactly as the app builds it, `runFt` and all, so removing the
  // field is not what makes this pass.
  const room = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
  const strip = {
    id: 's1', roomId: 'r1', type: 'strip',
    wall: { a: { x: 0, y: 300 }, b: { x: 0, y: 0 } },
    run: [{ x: 0, y: 100 }, { x: 0, y: 160 }],   // 60 px = 3 ft at 20 px/ft
    runLength: 60,
    runFt: 3,
  };
  const one = (z) => buildBOQ({
    rooms: [room2('r1', 'Living', 4, 0, 200)], accents: [z], pxPerFt: PX });

  const before = one(strip).lines.find((l) => l.id === 'strip');
  ok(near(before.qty, 3 * 0.3048, 0.005), `3 ft of strip reads as ${before.qty} m`);

  // Drag the far end out to 240 px — 12 ft — along the same wall.
  const longer = setRunEnd(strip, 1, { x: 0, y: 340 }, { polygon: room, snap: 9 });
  ok(near(longer.runLength, 240, 1) || longer.runLength > 200,
    `the drag lengthens the run to ${longer.runLength.toFixed(0)} px`);
  const after = one(longer).lines.find((l) => l.id === 'strip');
  ok(after.qty > before.qty + 1,
    `and the SCHEDULE follows: ${before.qty} m becomes ${after.qty} m`);
  ok(near(after.qty, (longer.runLength / PX) * 0.3048, 0.005),
    'to exactly the length the geometry now says');

  // Shortening it, likewise — a strip trimmed back must not keep billing the
  // metres it used to have.
  const shorter = setRunEnd(longer, 1, { x: 0, y: 120 }, { polygon: room, snap: 9 });
  const trimmed = one(shorter).lines.find((l) => l.id === 'strip');
  ok(trimmed.qty < after.qty, `trimming it back reduces the metres: ${trimmed.qty} m`);

  // Moving the whole run keeps the length, so the metres must NOT change.
  const moved = moveRun(longer, { x: 200, y: 150 }, { x: 0, y: 150 }, { polygon: room, snap: 9 });
  const same = one(moved).lines.find((l) => l.id === 'strip');
  ok(near(same.qty, after.qty, 0.01),
    'and moving the whole strip changes where it is, not how much of it there is');

  // The load follows the metres, since it is metres x W/m.
  ok(one(longer).totals.watts > one(strip).totals.watts,
    'the connected load follows too');
}

console.log('\n-- the connected load, and what it leaves out --');
{
  // 11x7 + 2x12 + 2x5 + strip
  const expect = 11 * 7 + 2 * 12 + 2 * 5 + 4.572 * 9.6;
  ok(near(boq.totals.watts, expect, 0.5), `${boq.totals.watts} W`);
  ok(boq.totals.unstated.length === 1 && boq.totals.unstated[0].id === 'sconce',
    'and it names the sconces as excluded rather than dropping them silently');
  ok(boq.totals.unstated[0].qty === 3, `with their quantity: ${boq.totals.unstated[0].qty}`);
  ok(boq.totals.fittings === 11 + 2 + 2 + 3,
    `total countable fittings, strip excluded: ${boq.totals.fittings}`);
  ok(near(boq.totals.areaSqft, 510), `area: ${boq.totals.areaSqft} sqft`);
  ok(boq.totals.wattsPerSqft > 0.1 && boq.totals.wattsPerSqft < 2,
    `W/sqft is a plausible figure: ${boq.totals.wattsPerSqft}`);
}

console.log('\n-- ceiling items are counted and NOT billed --');
{
  const c = (id) => boq.coordination.find((x) => x.id === id);
  ok(c('fan').qty === 1, `the placed fan is counted: ${c('fan').qty}`);
  ok(c('chandelier').qty === 1, 'chandeliers are counted');
  ok(c('ac').qty === 1, 'and AC units');
  ok(!boq.coordination.find((x) => x.id === 'trapdoor'), 'and none of what is not there');
  ok(!boq.lines.some((l) => ['fan', 'chandelier', 'ac'].includes(l.id)),
    'none of them appear as a billed line — a lighting BOQ that quotes an AC unit is not trusted');
  // ...and none of them touch the load.
  const noObjects = buildBOQ({ ...PLAN, objects: [] });
  ok(near(noObjects.totals.watts, boq.totals.watts, 1e-9),
    'removing every ceiling object changes the connected load not at all');
}

console.log('\n-- per room --');
{
  ok(boq.rooms.length === 3, 'one row per lit room');
  const living = boq.rooms.find((r) => r.name === 'Living');
  ok(living.qty.small === 6 && living.qty.large === 2 && living.qty.spot === 2,
    'the living room carries its own counts');
  ok(living.qty.sconce === 0, 'and its rejected sconce is not among them');
  const sum = boq.rooms.reduce((n, r) => n + r.qty.small, 0);
  ok(sum === boq.lines.find((l) => l.id === 'small').qty,
    'the room rows add up to the total — a BOQ whose breakdown disagrees with its total is worthless');

  // A room that failed to lay out is not a room with nothing in it.
  const withFail = buildBOQ({ ...PLAN,
    rooms: [...PLAN.rooms, { id: 'r4', outline: { name: 'Odd' }, plan: { ok: false } }] });
  ok(withFail.rooms.length === 3, 'a room that would not lay out is left out entirely');
}

console.log('\n-- the table is built once, for all three files --');
const rows = boqTable(boq);
{
  ok(rows.some((r) => r[0] === 'Item'), 'there is a header row');
  ok(rows.some((r) => r[1] === 'Total fittings'), 'and a totals row');
  ok(rows.some((r) => r[0] === 'SPACE BREAKDOWN'), 'and the space breakdown');
  ok(rows.some((r) => String(r[0]).startsWith('CEILING ITEMS')), 'and the coordination block');
  ok(rows.some((r) => String(r[2]).includes('excludes') || String(r[1]) === 'Load excludes'),
    'and the exclusion is on the face of it');
  ok(rows.every((r) => Array.isArray(r)), 'every row is an array');
  ok(rows.every((r) => r.every((c) => c == null || typeof c === 'string')),
    'and every cell is a string — the exporters are not asked to format anything');
}

console.log('\n-- CSV --');
{
  const csv = boqToCSV(boq);
  const lines = csv.split('\n');
  ok(lines.length === rows.length, `one line per row: ${lines.length}`);
  ok(csv.includes('36°'), 'the degree sign survives');
  // A note containing a comma must be quoted or every column after it shifts.
  const noted = boq.lines.find((l) => l.note.includes(','));
  if (noted) ok(csv.includes(`"${noted.note}"`), 'a note with a comma in it is quoted');
  ok(!/^"?\d+"?,"?Recessed downlight — small"?,.*\n.*\n.*Recessed downlight — small/m.test(csv),
    'and no row is written twice');
  const headAt = lines.findIndex((l) => l.startsWith('Item,'));
  ok(headAt > 0 && lines[headAt].split(',').length === 8, 'eight columns on the header row');
}

console.log('\n-- XLSX, unzipped and read back --');
{
  const bytes = boqToXLSX(boq);
  ok(bytes[0] === 0x50 && bytes[1] === 0x4B, 'it starts with PK, so it is a zip');
  const files = unzip(bytes);
  const names = files.map((f) => f.name);
  for (const want of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
                      'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
                      'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
    ok(names.includes(want), `contains ${want}`);
  }
  ok(names[0] === '[Content_Types].xml', 'with the content types FIRST, which some readers require');
  // EVERY ENTRY'S CRC IS CHECKED. A wrong CRC is the single most likely bug in a
  // hand-written zip and the one Excel reports as "unreadable content".
  ok(files.every((f) => f.crcOk), 'every entry\'s CRC32 matches its data');

  const part = (n) => files.find((f) => f.name === n).text;
  const wb = part('xl/workbook.xml');
  const styles = part('xl/styles.xml');
  const s1 = part('xl/worksheets/sheet1.xml');
  const s2 = part('xl/worksheets/sheet2.xml');

  ok(/name="Schedule"/.test(wb) && /name="By space"/.test(wb), 'two named sheets');
  ok(/<relationships?[\s\S]*styles\.xml/i.test(part('xl/_rels/workbook.xml.rels')),
    'and the stylesheet is related to the workbook, or Excel ignores every format');
  ok(/fullCalcOnLoad="1"/.test(wb),
    'the workbook asks to be recalculated on open, so a cached value we got wrong cannot stand');

  console.log('\n   the units are in the FORMATS, not in the text —');
  // THIS IS THE CHANGE THAT MAKES FORMULAS POSSIBLE. "7 W" in a cell cannot be
  // multiplied by anything. 7 with a format of `0" W"` looks identical and can.
  ok(/formatCode="0&quot; W&quot;"/.test(styles), 'a rating format of 0" W"');
  ok(/formatCode="0&quot;°&quot;"/.test(styles) || /formatCode="0&quot;\u00B0&quot;"/.test(styles),
    'a beam format that appends the degree sign');
  ok(/formatCode="0.00&quot; m&quot;"/.test(styles), 'metres');
  ok(/formatCode="[^"]*W\/sqft/.test(styles), 'and W/sqft');

  // SELF-CLOSING CELLS BREAK A NAIVE PARSER. A styled-but-empty cell is
  // `<c r="A13" s="27"/>` with no `</c>`, so a non-greedy match to the next
  // `</c>` swallows it and every key after it is one cell out — which is how
  // this test first "proved" the header was in the wrong row.
  const cells = {};
  for (const m of s1.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    cells[m[1]] = m[2] ?? '';
  }
  const raw = (ref) => cells[ref] ?? '';
  const numAt = (ref) => {
    const m = raw(ref).match(/<v>([^<]*)<\/v>/);
    return m ? Number(m[1]) : null;
  };
  const headRow = 7, first = 8;   // three meta rows, a gap, then the header

  ok(/Description/.test(raw(`B${headRow}`)),
    `the header is on row ${headRow}: B${headRow} = ${raw(`B${headRow}`).slice(0, 60)}`);
  ok(numAt(`C${first}`) === 11, `the quantity is a number: ${numAt(`C${first}`)}`);
  ok(numAt(`E${first}`) === 7, `and so is the RATING — 7, not "7 W": ${numAt(`E${first}`)}`);
  ok(numAt(`F${first}`) === 36, `and the beam — 36, not "36°": ${numAt(`F${first}`)}`);
  ok(!/inlineStr/.test(raw(`E${first}`)), 'the rating cell is not a string at all');

  console.log('\n   the totals are formulas —');
  // The quotes inside a formula are XML-escaped, so the assertion matches the
  // escaped form rather than what a person would type.
  ok(/<f>IF\(ISNUMBER\(E8\),C8\*E8,&quot;&quot;\)<\/f>/.test(raw(`G${first}`)),
    `the load per line is qty x rating, computed by the spreadsheet: ${raw(`G${first}`).match(/<f>[^<]*/)?.[0]}`);
  ok(numAt(`G${first}`) === 11 * 7,
    `with our own answer cached alongside for a reader that does not calculate: ${numAt(`G${first}`)}`);
  // ISNUMBER AND NOT `=""`. The sconce's rating cell shows an em dash, so an
  // equality test against "" is false and the formula went on to multiply a
  // count by a dash — the cell showed #VALUE!.
  const sconceRow = first + 3;
  ok(/ISNUMBER/.test(raw(`G${sconceRow}`)),
    'a fitting with no rating is tested with ISNUMBER, so an em dash cannot become #VALUE!');
  ok(!/<v>/.test(raw(`G${sconceRow}`)), '...and its cached load is empty, not zero');

  const totalRow = first + 5;
  ok(/<f>SUM\(C8:C11\)<\/f>/.test(raw(`C${totalRow}`)),
    `the fitting total is a SUM over a RANGE, so a row inserted in it is counted: ${raw(`C${totalRow}`).match(/<f>[^<]*/)?.[0]}`);
  ok(/<f>SUM\(G8:G12\)<\/f>/.test(raw(`G${totalRow}`)),
    `and so is the load: ${raw(`G${totalRow}`).match(/<f>[^<]*/)?.[0]}`);
  ok(!/SUM\(C8,C9/.test(s1), 'not a list of individual cells');
  // The strip is metres, so it must not be inside the count of fittings.
  ok(!/SUM\(C8:C12\)/.test(s1), 'and the strip row is outside the fittings count');

  console.log('\n   and the second sheet checks the first —');
  ok(/Schedule!/.test(s2), 'the room sheet references the schedule by name');
  ok(/<f>IF\(AND\([^<]*Schedule!C8[^<]*\)/.test(s2),
    'with a formula that compares its own column totals to the schedule\'s lines');
  ok(/MISMATCH/.test(s2), 'and says MISMATCH out loud when they disagree');

  console.log('\n   and it opens as a spreadsheet, not as a grid —');
  ok(/<pane ySplit="7"[^>]*state="frozen"/.test(s1), 'the header row is frozen');
  ok(/<mergeCell ref="A1:H1"\/>/.test(s1), 'the title spans the table');
  ok(/paperSize="9" orientation="portrait"/.test(s1), 'A4 portrait, like the PDF');
  ok(/fitToPage="1"/.test(s1) && /fitToWidth="1"/.test(s1), 'fitted to the page width');
  ok(/<col min="2"[^>]*width="32"/.test(s1), 'and the columns have widths');

  // FILL 0 AND 1 ARE FIXED BY THE SPEC. Excel rejects a stylesheet whose first
  // two fills are not `none` and `gray125`, and says only that the file is
  // unreadable.
  ok(/<fills count="\d+"><fill><patternFill patternType="none"\/><\/fill><fill><patternFill patternType="gray125"\/>/.test(styles),
    'the first two fills are the ones the spec reserves');
  ok(/<cellXfs count="(\d+)"/.test(styles), 'there is a cellXfs count');
  const declared = Number(styles.match(/<cellXfs count="(\d+)"/)[1]);
  const actual = (styles.match(/<xf [^>]*xfId="0"/g) || []).length;
  ok(declared === actual, `and it matches the number of xf records: ${declared} vs ${actual}`);
  const maxS = Math.max(...[...s1.matchAll(/ s="(\d+)"/g)].map((m) => Number(m[1])), 0);
  ok(maxS < declared, `no cell points past the end of the style table: max s=${maxS}, count=${declared}`);

  ok(styles.includes('°') || /\u00B0/.test(styles), 'the degree sign survives the zip as UTF-8');
  ok(xmlEscape('a & b < c') === 'a &amp; b &lt; c', 'and XML escaping does the ampersand first');
  ok(xmlEscape('xy') === 'xy', 'control characters are stripped, since one makes the file unopenable');

  ok(isNumeric('7') && isNumeric('4.57') && isNumeric('-3'), 'isNumeric takes plain numbers');
  ok(!isNumeric('36°') && !isNumeric('9.6 W/m') && !isNumeric('') && !isNumeric('01'),
    'and refuses anything with a unit on it, or a leading zero that is really a label');

  // Deterministic: the same BOQ twice is the same bytes.
  ok(Buffer.compare(Buffer.from(bytes), Buffer.from(boqToXLSX(boq))) === 0,
    'the same input produces byte-identical output');
}

console.log('\n-- PDF --');
{
  const bytes = boqToPDF(boq, { title: 'Lighting schedule — FLOOR_PLAN_03' });
  const text = Buffer.from(bytes).toString('latin1');
  ok(text.startsWith('%PDF-1.4'), 'it announces itself as a PDF');
  ok(text.trimEnd().endsWith('%%EOF'), 'and ends properly');
  ok(/\/Type \/Catalog/.test(text) && /\/Type \/Pages/.test(text) && /\/Type \/Page\b/.test(text),
    'catalog, pages and a page');
  ok(/\/BaseFont \/Helvetica\b/.test(text) && /\/BaseFont \/Helvetica-Bold/.test(text),
    'both core fonts, so a header can be bold without embedding anything');
  ok(/\/Encoding \/WinAnsiEncoding/.test(text), 'in WinAnsi, which is what the escapes below assume');

  // THE XREF OFFSETS MUST BE EXACT. One byte out and the file is corrupt with no
  // useful message, so every offset is followed and checked to land on its object.
  const xrefAt = Number(text.match(/startxref\s+(\d+)/)[1]);
  ok(text.slice(xrefAt, xrefAt + 4) === 'xref', `startxref lands on the xref table at ${xrefAt}`);
  const table = text.slice(xrefAt).match(/xref\n0 (\d+)\n([\s\S]*?)trailer/);
  const count = Number(table[1]);
  const entries = table[2].trim().split('\n');
  ok(entries.length === count, `${count} xref entries for ${count} objects`);
  let bad = 0;
  for (let n = 1; n < count; n++) {
    const off = Number(entries[n].slice(0, 10));
    if (!new RegExp(`^${n} 0 obj`).test(text.slice(off, off + 20))) bad++;
  }
  ok(bad === 0, `every xref offset lands on its own object header (${bad} wrong)`);

  // /Length must match the actual stream, in BYTES not characters.
  const streams = [...text.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)];
  ok(streams.length >= 1, `${streams.length} content stream(s)`);
  ok(streams.every((m) => Buffer.byteLength(m[2], 'utf8') === Number(m[1])
                       || Buffer.byteLength(m[2], 'latin1') === Number(m[1])),
    'every stream /Length matches its byte count');

  ok(/\(Lighting schedule/.test(text), 'the title is drawn');
  ok(text.includes('Recessed downlight'), 'and so are the fittings');
  // A degree sign is not ASCII and Helvetica has it at 0260 in WinAnsi.
  ok(pdfText('36°') === '36\\260', 'the degree sign becomes its WinAnsi octal escape');
  ok(pdfText('a(b)c\\d') === 'a\\(b\\)c\\\\d', 'and the three characters PDF cares about are escaped');
  ok(pdfText('—') === '-', 'an em dash, which WinAnsi has no glyph for, becomes a hyphen');
  ok(textWidth('1111', 10) > 0 && textWidth('1111', 10) < textWidth('11111', 10),
    'text width grows with the string, so a right-aligned column lines up');

  ok(Buffer.compare(Buffer.from(bytes), Buffer.from(boqToPDF(boq, { title: 'Lighting schedule — FLOOR_PLAN_03' }))) === 0,
    'and the PDF is deterministic too');
}

console.log('\n-- an empty plan is a file, not a crash --');
{
  const empty = buildBOQ({});
  ok(empty.lines.length === 0 && empty.rooms.length === 0, 'nothing in, nothing out');
  ok(empty.totals.watts === 0 && empty.totals.fittings === 0, 'with zero totals');
  ok(typeof boqToCSV(empty) === 'string', 'the CSV still writes');
  const x = boqToXLSX(empty);
  ok(unzip(x).every((f) => f.crcOk), 'the spreadsheet is still a valid zip');
  ok(boqToPDF(empty).length > 400, 'and the PDF is still a PDF');
}

console.log('\n-- the zip writer --');
{
  ok(crc32(new Uint8Array([]))===0, 'CRC32 of nothing is zero');
  // The canonical check value for "123456789".
  ok(crc32(new TextEncoder().encode('123456789')) === 0xCBF43926,
    `CRC32("123456789") is CBF43926: ${crc32(new TextEncoder().encode('123456789')).toString(16).toUpperCase()}`);
  ok(cellRef(0, 0) === 'A1' && cellRef(25, 0) === 'Z1' && cellRef(26, 9) === 'AA10',
    'cell refs carry past Z');
  const z = unzip(zipStore([{ name: 'a.txt', data: new TextEncoder().encode('hello') }]));
  ok(z.length === 1 && z[0].text === 'hello' && z[0].crcOk, 'a one-file zip round-trips');
}

/** Read a stored-entry zip back, checking each CRC. Enough for our own output. */
function unzip(bytes) {
  const buf = Buffer.from(bytes);
  const out = [];
  let i = 0;
  while (i < buf.length - 3) {
    if (buf.readUInt32LE(i) !== 0x04034b50) break;
    const method = buf.readUInt16LE(i + 8);
    const crc = buf.readUInt32LE(i + 14);
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.toString('utf8', i + 30, i + 30 + nameLen);
    const start = i + 30 + nameLen + extraLen;
    let data = buf.subarray(start, start + size);
    if (method === 8) data = zlib.inflateRawSync(data);
    out.push({ name, data, text: data.toString('utf8'), crcOk: crc32(data) === crc });
    i = start + size;
  }
  return out;
}

console.log('\n-- a wet room is a different product in the same grid --');
{
  // The planner emits `kind: 'small'` for a toilet exactly as for a bedroom —
  // one light per cell — and the ROOM TYPE decides what that light is bought as.
  // See FIXTURE_BY_TYPE in roomTypes.js. Here the stamp is already applied,
  // because buildBOQ is downstream of it.
  const wet = {
    id: 'wc', outline: { name: 'Toilet' },
    plan: { ok: true, stats: { areaSqft: 36 },
            lights: [{ kind: 'small', fixture: 'small-narrow' },
                     { kind: 'small', fixture: 'small-narrow' }] },
  };
  const dry = {
    id: 'bd', outline: { name: 'Bed 1' },
    plan: { ok: true, stats: { areaSqft: 150 },
            lights: [{ kind: 'small', fixture: 'small' },
                     { kind: 'large', fixture: 'large' }] },
  };
  const b = buildBOQ({ rooms: [wet, dry], pxPerFt: PX });

  const wcRow = b.rooms.find((r) => r.id === 'wc');
  ok(wcRow.qty['small-narrow'] === 2 && wcRow.qty.small === 0,
    'a toilet\'s grid lights are counted on the narrow-beam line, not the 7 W one');
  const bdRow = b.rooms.find((r) => r.id === 'bd');
  ok(bdRow.qty.small === 1 && bdRow.qty.large === 1 && !bdRow.qty['small-narrow'],
    'and every other room is unchanged');

  const line = b.lines.find((l) => l.id === 'small-narrow');
  ok(line && line.qty === 2, 'the schedule carries its own line');
  ok(line.watts === 5 && line.beam === 30, `5 W at 30 degrees: ${line.watts}W / ${line.beam}deg`);
  ok(near(line.load, 10, 1e-9), `and the load is counted at 5 W each: ${line.load} W`);
  const small = b.lines.find((l) => l.id === 'small');
  ok(small.watts === 7 && small.beam === 36,
    'while the standard downlight is still 7 W at 36 degrees');
  ok(line.id !== 'spot' && FIXTURE_BY_ID.spot.watts === 5,
    'and it is NOT the directional spot line, though the lamp matches — a spot is aimed, this is ambient');

  // THE FALLBACK. A plan saved before `fixture` existed has lights with only a
  // kind, and must still schedule rather than counting nothing.
  const legacy = buildBOQ({ rooms: [room('old', 'Hall', 3, 1, 120)], pxPerFt: PX });
  ok(legacy.rooms[0].qty.small === 3 && legacy.rooms[0].qty.large === 1,
    'a light with no `fixture` falls back to its kind');
}


console.log('\n-- a reverse cove is its own product, on the same tape --');
{
  const rm = (id, name) => ({ id, outline: { name },
    plan: { ok: true, stats: { areaSqft: 200 }, lights: [] } });
  const b = buildBOQ({
    rooms: [rm('r1', 'Living'), rm('r2', 'Bed 1')],
    accents: [
      { id: 'a', roomId: 'r1', type: 'strip', runLength: 10 * PX },
      { id: 'b', roomId: 'r1', type: 'strip', fixture: 'reverse-cove', runLength: 9 * PX },
      { id: 'c', roomId: 'r2', type: 'strip', fixture: 'reverse-cove', runLength: 6 * PX },
      { id: 'd', roomId: 'r1', type: 'strip', fixture: 'reverse-cove', rejected: 'x', runLength: 99 * PX },
    ],
    pxPerFt: PX,
  });
  const line = (id) => b.lines.find((l) => l.id === id);
  ok(!!line('reverse-cove'), 'there is a catalogue line for it');
  ok(line('reverse-cove').label === '8" reverse cove',
    `named as the item, not the component: "${line('reverse-cove').label}"`);
  ok(near(line('strip').qty, 10 * 0.3048, 0.01), `the plain strip keeps its own metres: ${line('strip').qty}`);
  ok(near(line('reverse-cove').qty, 15 * 0.3048, 0.01),
    `and the coves are billed apart: ${line('reverse-cove').qty} m`);
  ok(line('reverse-cove').pieces === 2, `two runs — two drivers: ${line('reverse-cove').pieces}`);
  ok(line('strip').pieces === 1, 'and the strip line counts only its own');
  ok(near(b.totals.stripMetres, 25 * 0.3048, 0.01),
    `the summary totals ALL the tape, not just the strip line: ${b.totals.stripMetres} m`);
  ok(b.totals.stripRuns === 3, `and all the runs: ${b.totals.stripRuns}`);
  ok(near(line('reverse-cove').load, 15 * 0.3048 * 9.6, 0.1),
    'it carries load at the strip rating, because it is the same tape');

  // The per-room breakdown asks a different question — how much linear product
  // goes in this room — so it adds them.
  ok(near(b.rooms[0].qty.strip + b.rooms[0].qty['reverse-cove'], 19 * 0.3048, 0.01),
    'and the room holds both');
  const head = boqTable(b).find((r) => r[0] === 'Space');
  ok(head[6] === 'Strip (m)', 'the breakdown keeps one Strip column');
  const living = boqTable(b).find((r) => r[0] === 'Living');
  ok(near(Number(living[6]), 19 * 0.3048, 0.01),
    `which sums the room's tape: ${living[6]} m`);
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
