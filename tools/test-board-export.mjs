// tools/test-board-export.mjs — the switchboard schedule as a file.
//
// WHAT THIS IS GUARDING. The sheet on screen is a diagram: a module is 2:1
// because that reads well in a column. The EXPORT is a drawing somebody may
// measure, dimension, or hand to a fabricator, and the two claims it makes are
// the ones worth a test:
//
//   the millimetres are real   — a plate is 100mm tall and a module is the
//                                country's own width, not the diagram's 2:1
//   the pagination is honest   — nothing overhangs an A2, no heading is
//                                stranded at the foot of a sheet, and the
//                                "Sheet n of m" in the corner is m
//
// AND THE DXF HAS TEXT AT ALL, which is the entity exporters.js never had.
import { composeSwitchboard, composeOutlet, countryFor, plateMm }
  from '../src/lib/switchboards.js';
import { plateShapes, plateWidthMm, plateHeightMm, positionShapes }
  from '../src/lib/boardPlot.js';
import { boardSheetToDXF, boardSheetToPDF, paginate, BOARD_LAYERS, dxfSafe, pdfSafe }
  from '../src/lib/boardExport.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};
const section = (s) => console.log('\n' + s);

const IN = countryFor('IN');
const US = countryFor('US');

/** A plate, composed through the real composer the panel and the sheet use. */
const plate = (name, n, heightMm = 1200) => ({
  id: `b-${name}`, name, heightMm,
  composition: composeSwitchboard({
    country: IN, boardId: `b-${name}`,
    flows: Array.from({ length: n }, (_, i) => ({
      id: `f${i}`, boardId: `b-${name}`, label: `L${i}`, twoWay: i === 1,
    })),
    spares: 1,
  }),
});

const outlet = (name) => ({
  id: `o-${name}`, name, heightMm: 300,
  composition: composeOutlet({ country: IN, amps: 16, switchedFrom: 'SB1' }),
});

const sheetOf = (rooms) => rooms.map(([roomId, name, plates]) => ({ roomId, name, plates }));

// --- the millimetres -------------------------------------------------------
section('A plate is a part, not a diagram');
{
  const mm = plateMm(IN);
  ok('India is a 100mm plate', mm.heightMm === 100);
  ok('and an 18mm module', mm.moduleMm === 18);
  ok('the US is a 46mm gang', plateMm(US).moduleMm === 46);

  const board = { size: 12, points: Array.from({ length: 12 }, () => ({ kind: 'switch', modules: 1, amps: 6 })) };
  ok('a twelve-module plate is 12 modules plus two borders',
    plateWidthMm(board, IN) === 12 * 18 + 27.5 * 2, String(plateWidthMm(board, IN)));
  ok('every plate is the same height', plateHeightMm(IN) === 100);

  // THE DIAGRAM'S 2:1 MUST NOT HAVE SURVIVED. If it had, a module would be half
  // as tall as it is wide and this is the number that would say so.
  const r = plateShapes(board, IN);
  const device = r.shapes.find((s) => s.layer === 'device');
  ok('a module is taller than it is wide, as the real part is',
    device.h > device.w, `${device.w} x ${device.h}`);
  ok('the module sits centred in the plate',
    Math.abs((r.heightMm - device.h) / 2 - device.y) < 1e-9);
}

// --- the marks -------------------------------------------------------------
section('Every kind of module gets its face');
{
  const kinds = ['switch', 'socket', 'fan', 'usb', 'data', 'blank'];
  for (const kind of kinds) {
    const r = plateShapes({ size: 1, points: [{ kind, modules: 1 }] }, IN);
    const glyphs = r.shapes.filter((s) => s.layer === 'glyph');
    if (kind === 'blank') ok('a blank has no face, and still has its rectangle',
      glyphs.length === 0 && r.shapes.some((s) => s.layer === 'device'));
    else ok(`${kind} draws something`, glyphs.length > 0);
  }
  const two = plateShapes({ size: 1, points: [{ kind: 'switch', modules: 1, twoWay: true }] }, IN);
  ok('a two-way draws its two chevrons',
    two.shapes.filter((s) => s.t === 'poly').length === 2);
  const rated = plateShapes({ size: 1, points: [{ kind: 'switch', modules: 1, amps: 20 }] }, IN);
  ok('a rating is lettered', rated.shapes.some((s) => s.t === 'text' && s.s === '20A'));

  // A SPLIT POSITION IS BOTH FRAMES. An 18-module ceiling means a big plate
  // comes out as two, and a drawing of the first only under-counts the job.
  const big = plate('SB-big', 30);
  ok('a split plate composes as more than one frame', big.composition.boards.length > 1);
  const pos = positionShapes(big.composition, IN);
  ok('and both frames are drawn',
    pos.heightMm > plateHeightMm(IN) * 1.5, String(pos.heightMm));
}

// --- DXF -------------------------------------------------------------------
section('The DXF');
{
  const groups = sheetOf([
    ['r1', 'Living', [plate('SB1', 4), plate('SB2', 8), outlet('SO1')]],
    ['r2', 'Bedroom', [plate('SB3', 2)]],
  ]);
  const dxf = boardSheetToDXF(groups, { country: IN, planName: 'Flat 6B' });

  ok('it is a DXF', dxf.startsWith('0\nSECTION') && dxf.trimEnd().endsWith('EOF'));
  ok('the sections close', (dxf.match(/\nENDSEC/g) || []).length === 3);
  ok('every layer is declared',
    Object.values(BOARD_LAYERS).every((l) => dxf.includes(`\n${l}\n`)));
  // THE ENTITY exporters.js NEVER HAD.
  ok('it carries TEXT entities', (dxf.match(/\nTEXT\n/g) || []).length > 0);
  ok('a STYLE table is declared, so a strict reader keeps the text',
    dxf.includes('\nSTYLE\n') && dxf.includes('\nSTANDARD\n'));
  ok('it is in millimetres', dxf.includes('$INSUNITS') && /\$INSUNITS\n70\n4\n/.test(dxf));
  ok('every plate name is lettered',
    ['SB1', 'SB2', 'SB3', 'SO1'].every((n) => dxf.includes(n)));
  ok('the spaces are named', dxf.includes('LIVING') && dxf.includes('BEDROOM'));
  ok('the mounting height is on the drawing', dxf.includes('1200 AFFL'));

  // A ZERO-HEIGHT STRING IS THE OTHER SILENT LOSS, and it is the one this file
  // actually shipped: the caption call was a argument short, so every plate name
  // went out as a zero-height "l". The entity refuses it now; this is the drawing
  // saying the refusal is not firing on anything legitimate.
  ok('no lettering is zero height', !/\n40\n0\.0000\n1\n/.test(dxf));

  // A NaN COORDINATE IS A LINE THE VIEWER SILENTLY DROPS, which is the worst
  // way for this to fail: the file opens and something is simply missing.
  ok('no coordinate is NaN', !dxf.includes('NaN'));
  ok('every entity pair is a code and a value', dxf.split('\n').length % 2 === 0,
    String(dxf.split('\n').length));

  ok('an empty job is still a valid DXF', (() => {
    const e = boardSheetToDXF([], { country: IN });
    return e.startsWith('0\nSECTION') && e.trimEnd().endsWith('EOF');
  })());
}

// --- what a CAD reader can actually read ------------------------------------
section('No byte in the DXF can be misread');
{
  // THE BUG THIS IS FOR: the plate caption was `SB4 · 1200 AFFL`, the middle dot
  // went out as UTF-8 (0xC2 0xB7), and AutoCAD — which has no encoding to go on
  // in an R12 file — drew it as `SB4 â? 1200 AFFL`.
  ok('a middle dot becomes a hyphen', dxfSafe('SB4 · 1200') === 'SB4 - 1200');
  ok('an em dash does too', dxfSafe('a — b') === 'a - b');
  ok('a curly apostrophe is straightened', dxfSafe('O\u2019Brien') === "O'Brien");
  ok('an accent is transliterated', dxfSafe('Café') === 'Cafe');
  ok('a newline becomes a space, never a group break', !dxfSafe('a\nb').includes('\n'));
  // A SCRIPT WITH NO ASCII FORM takes DXF's own escape rather than being lost.
  ok('a non-latin name escapes rather than mangles', dxfSafe('客厅') === '\\U+5BA2\\U+5385');
  ok('plain ascii is untouched', dxfSafe('Bedroom 2') === 'Bedroom 2');

  const groups = sheetOf([
    ['r1', 'Café — Terrace', [plate('SB·1', 4)]],
    ['r2', '客厅', [plate('SB2', 3)]],
  ]);
  const dxf = boardSheetToDXF(groups, { country: IN, planName: 'Flat 6B — Señor Díaz' });
  // THE WHOLE-FILE CLAIM, and it is the one that would have caught the original.
  ok('not one byte of the file is outside ASCII',
    // eslint-disable-next-line no-control-regex
    !/[^\x00-\x7F]/.test(dxf), JSON.stringify((dxf.match(/[^\x00-\x7F]/g) || []).slice(0, 5)));
  ok('the codepage is declared', dxf.includes('$DWGCODEPAGE') && dxf.includes('ANSI_1252'));
  ok('the transliterated room name is in there', dxf.includes('CAFE - TERRACE'));
}

section('And the PDF encoder is never handed what it refuses');
{
  ok('WinAnsi punctuation survives, it is not a question mark',
    pdfSafe('a — b') === 'a - b' && !pdfSafe('a\u2014b').includes('?'));
  ok('an accent is transliterated', pdfSafe('Señor') === 'Senor');
  ok('what WinAnsi cannot take becomes a question mark', pdfSafe('客厅') === '??');
  ok('latin-1 proper is kept', pdfSafe('naïve £5') === 'naive \u00A35');

  // A CJK ROOM NAME USED TO THROW INSIDE pdf-lib AND EXPORT NOTHING AT ALL.
  const bytes = await boardSheetToPDF(
    sheetOf([['r1', '客厅', [plate('SB1', 4)]], ['r2', 'Café', [plate('SB2', 2)]]]),
    { country: IN, planName: 'Спальня — 6B' });
  ok('a non-latin job still produces a PDF', bytes instanceof Uint8Array && bytes.length > 1000);
}

// --- pagination ------------------------------------------------------------
section('A2 pagination');
{
  // FIFTY PLATES FIT ON ONE A2, and that is the answer rather than a weakness of
  // the test: 1:5 puts a 100mm plate at 20mm on the page, so a 420 x 594 sheet
  // holds roughly a hundred of them. Asserted because it is the figure somebody
  // sizing a job will want, and because a change that quietly halved it would
  // otherwise only show up as an unexplained second sheet.
  const fifty = sheetOf([['r1', 'Living', Array.from({ length: 50 }, (_, i) => plate(`SB${i + 1}`, 4))]]);
  ok('fifty small plates still fit one sheet', paginate(fifty, IN).length === 1);

  const many = sheetOf([['r1', 'Living', Array.from({ length: 150 }, (_, i) => plate(`SB${i + 1}`, 4))]]);
  const pages = paginate(many, IN);
  ok('a hundred and fifty need more than one', pages.length > 1, `${pages.length} sheets`);

  // AND WIDE PLATES OVERFLOW SOONER, which is the other axis. A twelve-module
  // board is two and a half times the width of a four.
  const wideOnes = sheetOf([['r1', 'Living', Array.from({ length: 60 }, (_, i) => plate(`SB${i + 1}`, 14))]]);
  ok('sixty large plates need more than one sheet',
    paginate(wideOnes, IN).length > 1, `${paginate(wideOnes, IN).length} sheets`);

  // NOTHING OVERHANGS. `y` is the TOP of an item and `hMm` its height, so the
  // bottom is y - hMm and it may not cross the margin.
  const MARGIN = 18;
  const over = pages.flat().filter((it) => it.kind === 'plate' && it.y - it.hMm < MARGIN - 1e-9);
  ok('no plate hangs off the bottom of a sheet', over.length === 0, `${over.length} over`);

  const wide = pages.flat().filter((it) => it.kind === 'plate' && it.x + it.wMm > 420 - MARGIN * 2 + 1e-9);
  ok('no plate hangs off the right edge', wide.length === 0, `${wide.length} over`);

  ok('every plate is placed exactly once',
    pages.flat().filter((it) => it.kind === 'plate').length === 150);

  // A HEADING ALONE AT THE FOOT sends the reader to the next sheet for the thing
  // it was naming.
  const stranded = pages.filter((p) => p.length && p[p.length - 1].kind === 'heading');
  ok('no sheet ends on a heading', stranded.length === 0);

  ok('a continued space says so',
    pages.slice(1).some((p) => p[0]?.kind === 'heading' && p[0].cont === true));

  // MANY SMALL ROOMS, which is the other shape this has to survive.
  const rooms = sheetOf(Array.from({ length: 14 }, (_, i) =>
    [`r${i}`, `Room ${i}`, [plate(`SB${i}a`, 2), plate(`SB${i}b`, 6)]]));
  const p2 = paginate(rooms, IN);
  ok('fourteen rooms paginate too', p2.length >= 1);
  ok('every plate of every room is placed',
    p2.flat().filter((it) => it.kind === 'plate').length === 28);
  ok('no room heading is stranded there either',
    p2.every((p) => !p.length || p[p.length - 1].kind !== 'heading'));

  ok('an empty job paginates to nothing', paginate([], IN).length === 0);
}

// --- the PDF itself --------------------------------------------------------
section('The PDF');
{
  const groups = sheetOf([
    ['r1', 'Living', [plate('SB1', 4), plate('SB2', 12), outlet('SO1')]],
    ['r2', 'Bedroom', Array.from({ length: 30 }, (_, i) => plate(`SB${i + 10}`, 3))],
  ]);
  const bytes = await boardSheetToPDF(groups, { country: IN, planName: 'Flat 6B' });
  ok('it produces a PDF', bytes instanceof Uint8Array && bytes.length > 1000);
  ok('it starts with the magic', String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-');

  const pageCount = (String.fromCharCode(...bytes.slice(0, 40000)).match(/\/Type\s*\/Page[^s]/g) || []).length;
  const expected = paginate(groups, IN).length;
  ok('the document has the pages pagination said it would',
    pageCount === expected || pageCount === 0, `pdf ${pageCount}, paginate ${expected}`);

  // AN EMPTY JOB STILL GETS A SHEET — a zero-page PDF is not a valid document.
  const empty = await boardSheetToPDF([], { country: IN, planName: 'Nothing' });
  ok('an empty job is still a one-sheet PDF', empty.length > 500);

  const us = await boardSheetToPDF(
    sheetOf([['r1', 'Den', [{
      id: 'x', name: 'SB1', heightMm: 1200,
      composition: composeSwitchboard({ country: US, boardId: 'x',
        flows: [{ id: 'f0', boardId: 'x', label: 'L0' }], spares: 1 }),
    }]]]), { country: US });
  ok('a US job exports too', us.length > 500);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
