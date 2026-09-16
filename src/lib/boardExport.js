// ---------------------------------------------------------------------------
// boardExport.js — THE SWITCHBOARD SCHEDULE AS A FILE. DXF and PDF.
//
// A DIFFERENT DRAWING FROM THE PLAN, AND THAT IS WHY IT IS NOT IN exporters.js
// OR pdfPlot.js. Those two plot the floor plan: everything in them is in plan
// pixels, scaled by `pxPerFt`, laid on one sheet under a scale bar. A plate
// elevation shares none of that. It has no position on the floor, it is measured
// in millimetres rather than feet, and there are fifty of them to place on paper
// rather than one drawing to fit. Bending either file into taking both would
// have meant a second coordinate space inside a function whose whole job is the
// first one.
//
// THE TWO FORMATS GET DELIBERATELY DIFFERENT TREATMENT, because CAD and paper
// are not the same medium:
//
//   DXF  LIFE SIZE, IN MILLIMETRES, ON ONE UNBOUNDED SHEET. A CAD file has no
//        page, so paginating it would be inventing a constraint the format does
//        not have — and a plate that arrives 217mm wide is a plate somebody can
//        measure, dimension and drop into their own title block.
//
//   PDF  A2, AT 1:5, ACROSS AS MANY SHEETS AS IT TAKES. Paper does have an edge.
//        At 1:5 a 100mm plate is 20mm on the page and a twelve-module board is
//        43mm, so a 420mm-wide A2 holds three columns comfortably — and the
//        scale is a round number somebody can check with a rule, which 1:4.7
//        would not be.
//
// EVERY MARK COMES FROM boardPlot.js AND NOT FROM HERE. That file turns one
// composed plate into millimetres; this one decides where the plates go. The
// split is what stops the two formats drifting into drawing different parts.
// ---------------------------------------------------------------------------
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { plateHeightMm, positionShapes, positionWidthMm, shift, scale } from './boardPlot.js';
import { countryFor } from './switchboards.js';

const PT_PER_MM = 72 / 25.4;

// --- the sheet ------------------------------------------------------------
const A2_MM = [420, 594];          // portrait, long edge second — as pdfPlot has it
const PDF_SCALE = 5;               // 1:5
const MARGIN_MM = 18;
const HEAD_MM = 22;                // the title block at the top of every sheet
const CAPTION_MM = 9;              // the name and height above each plate
const COL_GAP_MM = 10;
const ROW_GAP_MM = 9;

// --- the CAD sheet --------------------------------------------------------
const DXF_ROW_MM = 1800;           // how wide a row of plates runs before it wraps
const DXF_GAP_MM = 90;             // between two plates, across
const DXF_ROW_GAP_MM = 150;        // and down — room for the caption above each
const DXF_CAPTION_MM = 26;
const DXF_HEADING_MM = 46;

/**
 * THE LAYERS, AND THEY ARE THIS DRAWING'S OWN.
 *
 * NOT `SUPERLUMINAL_LAYERS` FROM exporters.js, which names the layers of the
 * PLAN — `superluminal_switchboards` there is where the plates sit ON THE FLOOR
 * PLAN, in feet, seen from above. These are elevations of the parts themselves
 * in millimetres. Two different drawings that both contain switchboards, and
 * merging the two names would put a plan symbol and a part elevation on one
 * layer, which is the one thing a layer is for keeping apart.
 *
 * FOUR, BY THE SAME TRADE RULE THE PLAN'S TABLE IS BUILT ON. The plate outline
 * is what gets cut into the wall and is the only line a mason wants; the device
 * rectangles are the grid the electrician fills; the glyphs say what goes in
 * each slot; the text is the schedule. Somebody setting out a wall wants the
 * first two without the last two.
 */
export const BOARD_LAYERS = {
  plate: 'superluminal_board_plate',
  device: 'superluminal_board_device',
  glyph: 'superluminal_board_glyph',
  text: 'superluminal_board_text',
};

const BOARD_COLOUR = { plate: 7, device: 5, glyph: 3, text: 2 };

// --- DXF entities ---------------------------------------------------------

const f = (n) => (Number.isFinite(n) ? n : 0).toFixed(4);

const dLine = (layer, x1, y1, x2, y2) =>
  ['0', 'LINE', '8', layer, '10', f(x1), '20', f(y1), '30', '0.0',
   '11', f(x2), '21', f(y2), '31', '0.0'];

const dCircle = (layer, cx, cy, r) =>
  ['0', 'CIRCLE', '8', layer, '10', f(cx), '20', f(cy), '30', '0.0', '40', f(r)];

/** A filled dot. R12 has no HATCH, so a small disc is a zero-length wide trace. */
const dDisc = (layer, cx, cy, r) =>
  ['0', 'SOLID', '8', layer,
   '10', f(cx - r), '20', f(cy - r), '30', '0.0',
   '11', f(cx + r), '21', f(cy - r), '31', '0.0',
   '12', f(cx - r), '22', f(cy + r), '32', '0.0',
   '13', f(cx + r), '23', f(cy + r), '33', '0.0'];

const dPoly = (layer, pts, closed = false) => [
  '0', 'POLYLINE', '8', layer, '66', '1', '70', closed ? '1' : '0',
  '10', '0.0', '20', '0.0', '30', '0.0',
  ...pts.flatMap(([x, y]) => ['0', 'VERTEX', '8', layer, '10', f(x), '20', f(y), '30', '0.0']),
  '0', 'SEQEND',
];

/**
 * TEXT, AND IT IS THE ENTITY THIS FILE HAD TO ADD.
 *
 * exporters.js writes LINE, CIRCLE, SOLID and POLYLINE and nothing else — the
 * plan drawing carries no lettering at all — so a schedule, which is half
 * lettering, had nowhere to put a string. dxf.js has always READ TEXT and MTEXT;
 * that is the importer.
 *
 * GROUP 72 IS THE HORIZONTAL JUSTIFICATION AND IT DOES NOT WORK ALONE. A TEXT
 * whose 72 is 1 (centred) or 2 (right) is positioned by its SECOND alignment
 * point, group 11 — and a file that sets 72 while leaving 11 at the origin puts
 * every centred string in the drawing on top of each other at 0,0. So 11 is
 * always written, and it is written equal to 10 for the left-aligned case where
 * it is ignored anyway. That is cheaper than a branch that can be got wrong.
 */
const dText = (layer, x, y, h, s, align = 'c') => {
  // A HEIGHT OF ZERO IS NOT A SMALL STRING, IT IS AN INVISIBLE ONE — and it is
  // the shape an argument slipped out of order takes, which is how this file
  // shipped every plate caption as a zero-height "l" for one revision. A drawing
  // is allowed to be missing lettering; it is not allowed to be missing it
  // silently, and the caller has no other way to mean this.
  if (!(h > 0)) throw new Error(`dText: a text height of ${h} draws nothing`);
  const just = align === 'l' ? 0 : align === 'r' ? 2 : 1;
  return ['0', 'TEXT', '8', layer,
          '10', f(x), '20', f(y), '30', '0.0',
          '40', f(h),
          // SANITISED HERE AND NOT AT THE CALL SITES. Every string in the file
          // goes through this entity, so one guard covers the captions, the
          // headings, the ratings and whatever a room gets named next. See
          // `dxfSafe` for what a raw middle dot did before it existed.
          '1', dxfSafe(s),
          '72', String(just),
          '11', f(x), '21', f(y), '31', '0.0'];
};

/* TYPOGRAPHY THAT HAS AN ASCII TWIN, and it is worth a map rather than an
   escape. A room called `Living — Main` is not carrying information in the width
   of its dash, so `Living - Main` is the same name and reads everywhere; the
   escape hatches below are for scripts that genuinely have no ASCII form. These
   are the characters a name picks up from a word processor or a phone keyboard
   without anybody choosing them. */
const PUNCT = {
  '\u2013': '-', '\u2014': '-', '\u2012': '-', '\u2212': '-',      // dashes
  '\u2018': "'", '\u2019': "'", '\u201A': "'", '\u201B': "'",      // single quotes
  '\u201C': '"', '\u201D': '"', '\u201E': '"',                     // double quotes
  '\u2022': '*', '\u00B7': '-', '\u2026': '...', '\u00D7': 'x',
  '\u00A0': ' ', '\u2039': '<', '\u203A': '>', '\u00AB': '<<', '\u00BB': '>>',
};

/**
 * EVERYTHING BOTH FORMATS WANT DONE, AND NEITHER CAN SKIP.
 *
 * Decomposing and dropping the combining marks turns `Café` into `Cafe` and
 * `Señor` into `Senor` — the right answer for a name somebody typed with an
 * accent, in a file format that cannot carry one. Control characters become
 * spaces because a newline inside a DXF TEXT entity would end the group and
 * corrupt the file outright, which is a worse outcome than a lost line break by
 * some distance.
 */
function plain(str) {
  return String(str ?? '')
    .replace(/[\u2012-\u2014\u2018-\u201E\u2022\u2026\u2039\u203A\u00A0\u00B7\u00D7\u00AB\u00BB\u2212]/g,
      (ch) => PUNCT[ch] ?? ch)
    .normalize('NFD').replace(/\p{M}+/gu, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ');
}

/**
 * A STRING A CAD READER CANNOT TURN INTO RUBBISH.
 *
 * R12 DXF HAS NO ENCODING. There is no byte in the file that says what the bytes
 * mean, so a reader assumes the system codepage — and a middle dot written as
 * UTF-8 (0xC2 0xB7) is read as two Latin-1 characters: `Â`, and one with no
 * glyph at all. `SB4 · 1200 AFFL` arrived in AutoCAD as `SB4 â? 1200 AFFL`,
 * which is what this function exists to stop. The header declares ANSI_1252 as
 * well, and that is belt to this braces: a reader that honours the codepage
 * still cannot be handed a character the codepage has no room for.
 *
 * WHAT SURVIVES `plain` IS A SCRIPT WITH NO ASCII FORM — `客厅`, `Спальня` — and
 * it becomes the `\U+XXXX` escape, which is DXF's OWN way of carrying a
 * character outside the codepage. A reader that understands it draws the glyph;
 * one that does not shows the escape, which is ugly, legible and reversible.
 * Every alternative is worse: raw bytes are the mojibake above, dropping them is
 * a plate labelled with nothing, and `?` is the same loss with the evidence
 * thrown away.
 */
export function dxfSafe(str) {
  return plain(str).replace(/[^\x20-\x7E]/gu, (ch) =>
    `\\U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
}

/**
 * THE SAME PROBLEM ON THE OTHER SHEET, WITH A HARDER FAILURE.
 *
 * pdf-lib's standard Helvetica is WinAnsi-encoded and `drawText` THROWS on a
 * character it cannot encode — so a project with a room called `客厅` did not
 * export a PDF with odd lettering in it, it exported NO PDF AT ALL and logged a
 * caught error. `plain` fixes the common case for free; what survives it becomes
 * `?`, because a PDF has no escape convention to fall back on and the only real
 * fix — embedding a Unicode font — is half a megabyte in the bundle for a case
 * this app has not met yet.
 *
 * WINANSI IS WIDER THAN LATIN-1 AND THE FIRST VERSION OF THIS FORGOT IT. The
 * range 0x80-0x9F carries the dashes, curly quotes, bullet, ellipsis, euro and
 * trademark that Latin-1 leaves empty — so testing for printable Latin-1 alone
 * turned an em dash Helvetica can draw perfectly into a question mark. `plain`
 * maps most of them to ASCII before this runs; the rest are named here so the
 * guard cannot refuse what the font would have accepted.
 */
const WINANSI_EXTRA = '\u20AC\u0192\u2020\u2021\u02C6\u2030\u0160\u0152\u017D'
  + '\u02DC\u2122\u0161\u0153\u017E\u0178';

export function pdfSafe(str) {
  const ok = new RegExp(`[^\\x20-\\x7E\\xA1-\\xFF${WINANSI_EXTRA}]`, 'gu');
  return plain(str).replace(ok, '?');
}

/** One boardPlot shape as DXF entities. The only place the vocabulary is mapped. */
function shapeToDXF(sh) {
  const layer = BOARD_LAYERS[sh.layer] ?? BOARD_LAYERS.plate;
  switch (sh.t) {
    case 'rect':
      return dPoly(layer, [[sh.x, sh.y], [sh.x + sh.w, sh.y],
                           [sh.x + sh.w, sh.y + sh.h], [sh.x, sh.y + sh.h]], true);
    case 'line': return dLine(layer, sh.x1, sh.y1, sh.x2, sh.y2);
    case 'circle': return dCircle(layer, sh.cx, sh.cy, sh.r);
    case 'disc': return dDisc(layer, sh.cx, sh.cy, sh.r);
    case 'poly': return dPoly(layer, sh.pts, false);
    case 'text': return dText(layer, sh.x, sh.y, sh.h, sh.s, sh.align);
    default: return [];
  }
}

/**
 * A HEADER OF THIS FILE'S OWN, AND IT CARRIES A STYLE TABLE.
 *
 * slHeader in exporters.js does not, because that drawing has no text in it. A
 * TEXT entity names a style — implicitly STANDARD — and a reader that will not
 * invent one drops every string in the file. Most CAD is lenient; "most" is not
 * a promise, and the cost of the promise is eleven group codes.
 *
 * $INSUNITS IS 4, WHICH IS MILLIMETRES. The plan exporter writes the ORIGINAL
 * drawing's units because its geometry is in them; this drawing is in millimetres
 * by construction, so it says so and imports at the right size everywhere.
 */
function boardHeader() {
  const keys = Object.keys(BOARD_LAYERS);
  return [
    '0', 'SECTION', '2', 'HEADER',
    '9', '$ACADVER', '1', 'AC1009',
    '9', '$INSUNITS', '70', '4',
    // WHAT THE BYTES MEAN, SAID OUT LOUD. R12 has no encoding of its own and a
    // reader falls back to its system codepage; naming one is the difference
    // between a file that reads the same everywhere and a file that reads
    // differently in Delhi and Detroit. `dxfSafe` keeps the content inside it.
    '9', '$DWGCODEPAGE', '3', 'ANSI_1252',
    '9', '$LTSCALE', '40', '1.0',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'TABLES',
    '0', 'TABLE', '2', 'LTYPE', '70', '1',
    '0', 'LTYPE', '2', 'CONTINUOUS', '70', '0', '3', 'Solid line', '72', '65', '73', '0', '40', '0.0',
    '0', 'ENDTAB',
    '0', 'TABLE', '2', 'STYLE', '70', '1',
    '0', 'STYLE', '2', 'STANDARD', '70', '0', '40', '0.0', '41', '1.0', '50', '0.0',
    '71', '0', '42', '2.5', '3', 'txt', '4', '',
    '0', 'ENDTAB',
    '0', 'TABLE', '2', 'LAYER', '70', String(keys.length),
    ...keys.flatMap((k) => ['0', 'LAYER', '2', BOARD_LAYERS[k], '70', '0',
                            '62', String(BOARD_COLOUR[k]), '6', 'CONTINUOUS']),
    '0', 'ENDTAB', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
  ];
}

/**
 * EVERY PLATE ON THE JOB, LIFE SIZE, AS ONE DXF.
 *
 * `groups` is the sheet's own list — `[{ roomId, name, plates }]` out of
 * buildBoardSheet — so the CAD file is grouped and ordered exactly as the screen
 * is. An electrician reading one and then the other should not have to re-find
 * anything.
 *
 * ROOMS RUN DOWN THE PAGE AND PLATES WRAP ACROSS. There is no sheet edge to
 * respect, so the only reason to wrap at all is that a row of thirty plates is
 * unreadable; DXF_ROW_MM is that limit and nothing more.
 */
export function boardSheetToDXF(groups = [], { country = null, planName = null } = {}) {
  const c = countryFor(country?.code ?? country);
  const out = [...boardHeader()];
  let y = 0;   // the top of the next row, descending

  if (planName) {
    out.push(...dText(BOARD_LAYERS.text, 0, y, DXF_HEADING_MM * 0.8,
      `SWITCHBOARDS - ${planName}`, 'l'));
    y -= DXF_HEADING_MM * 2;
  }

  for (const g of groups) {
    out.push(...dText(BOARD_LAYERS.text, 0, y, DXF_HEADING_MM * 0.55,
      String(g.name ?? 'Space').toUpperCase(), 'l'));
    y -= DXF_HEADING_MM;

    let x = 0;
    let tallest = 0;
    for (const entry of g.plates) {
      const pos = positionShapes(entry.composition, c);
      // WRAP BEFORE DRAWING, NOT AFTER — a plate that would cross the limit
      // starts the next row rather than ending the last one over the edge.
      if (x > 0 && x + pos.widthMm > DXF_ROW_MM) {
        y -= tallest + DXF_ROW_GAP_MM;
        x = 0; tallest = 0;
      }
      // THE CAPTION SITS ABOVE THE PLATE, so `y` is the caption's baseline and
      // the plate hangs below it.
      out.push(...dText(BOARD_LAYERS.text, x, y - DXF_CAPTION_MM * 0.7,
        DXF_CAPTION_MM * 0.55, `${entry.name}   ${entry.heightMm} AFFL`, 'l'));
      const top = y - DXF_CAPTION_MM;
      for (const sh of pos.shapes) {
        out.push(...shapeToDXF(shift(sh, x, top - pos.heightMm)));
      }
      tallest = Math.max(tallest, pos.heightMm + DXF_CAPTION_MM);
      x += pos.widthMm + DXF_GAP_MM;
    }
    y -= tallest + DXF_ROW_GAP_MM * 1.5;
  }

  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n');
}

// --- PDF ------------------------------------------------------------------

/**
 * WHERE EVERY PLATE LANDS, ON WHICH SHEET — worked out before a byte is written.
 *
 * A PURE PASS, AND THAT IS THE POINT OF IT BEING SEPARATE. Pagination is the one
 * part of this file with arithmetic worth being wrong about — a plate that
 * overhangs the bottom edge, a room heading stranded as the last thing on a
 * sheet, an off-by-one in the page count printed in the corner — and none of
 * that is testable through pdf-lib without rendering a document and reading it
 * back. Handed a list and a page size it returns `[[item, …], …]`, one array per
 * sheet, which a test can assert on directly.
 *
 * A HEADING IS NOT LEFT AT THE FOOT OF A SHEET. It is emitted with the first
 * plate under it or not at all — a room name alone above the bottom margin sends
 * the reader to the next page for the thing it was naming.
 */
export function paginate(groups = [], country = null, {
  pageMm = A2_MM, scaleDiv = PDF_SCALE, marginMm = MARGIN_MM, headMm = HEAD_MM,
} = {}) {
  const c = countryFor(country?.code ?? country);
  const plateH = plateHeightMm(c) / scaleDiv;
  const usableW = pageMm[0] - marginMm * 2;
  const top = pageMm[1] - marginMm - headMm;
  const bottom = marginMm;

  const pages = [];
  let page = [];
  let y = top;          // the top edge of the next thing placed
  let x = 0;
  let rowH = 0;

  const newPage = () => { if (page.length) pages.push(page); page = []; y = top; x = 0; rowH = 0; };
  const newRow = () => { y -= rowH; x = 0; rowH = 0; };

  for (const g of groups) {
    const headingH = 7;
    // The heading plus the shortest thing that could sit under it. One frame is
    // the floor; a split plate simply starts the next sheet.
    if (y - headingH - (plateH + CAPTION_MM) < bottom) newPage();
    if (x > 0) newRow();
    page.push({ kind: 'heading', name: g.name, x: 0, y, count: g.plates.length });
    y -= headingH;

    for (const entry of g.plates) {
      const frames = entry.composition?.boards?.length || 1;
      const wMm = positionWidthMm(entry.composition, c) / scaleDiv;
      const hMm = (frames * plateHeightMm(c) + (frames - 1) * 14) / scaleDiv + CAPTION_MM;

      if (x > 0 && x + wMm > usableW) newRow();
      if (y - hMm < bottom) {
        newPage();
        page.push({ kind: 'heading', name: g.name, x: 0, y, count: g.plates.length, cont: true });
        y -= headingH;
      }
      page.push({ kind: 'plate', entry, x, y, wMm, hMm, frames });
      x += wMm + COL_GAP_MM;
      rowH = Math.max(rowH, hMm + ROW_GAP_MM);
    }
    newRow();
  }
  if (page.length) pages.push(page);
  return pages;
}

/**
 * THE SCHEDULE AS A PDF. A2 portrait, 1:5, as many sheets as it takes.
 *
 * DRAWN FROM THE GEOMETRY AND NOT PRINTED FROM THE SCREEN, for the reason
 * pdfPlot's own note gives about the plan: a print dialog produces a photograph
 * of a user interface, haloes and hover states included.
 */
export async function boardSheetToPDF(groups = [], { country = null, planName = null } = {}) {
  const c = countryFor(country?.code ?? country);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.04, 0.04, 0.04);
  const grey = rgb(0.45, 0.45, 0.45);

  const pages = paginate(groups, c);
  const total = groups.reduce((n, g) => n + g.plates.length, 0);
  const [pw, ph] = A2_MM;
  const P = (mm) => mm * PT_PER_MM;

  // AN EMPTY JOB STILL GETS A SHEET. A zero-page PDF is not a valid document and
  // pdf-lib will not save one — and the honest answer to "export a schedule with
  // nothing on it" is a title block saying so, not an error.
  const sheets = pages.length ? pages : [[]];

  sheets.forEach((items, i) => {
    const page = doc.addPage([P(pw), P(ph)]);

    // --- the title block, on every sheet -------------------------------
    page.drawText('SWITCHBOARDS', {
      x: P(MARGIN_MM), y: P(ph - MARGIN_MM - 6), size: 13, font: bold, color: ink });
    // THE MIDDLE DOT STAYS HERE AND WENT FROM THE DXF, which is not an
    // inconsistency: U+00B7 is 0xB7 in WinAnsi and Helvetica draws it, while a
    // DXF has no encoding to agree on. Same character, two formats, one of
    // which can promise it.
    const note = [pdfSafe(planName), c.name, `${total} plate${total === 1 ? '' : 's'}`,
                  `1:${PDF_SCALE}`, `Sheet ${i + 1} of ${sheets.length}`]
      .filter(Boolean).join('   ·   ');
    page.drawText(note, {
      x: P(MARGIN_MM), y: P(ph - MARGIN_MM - 14), size: 7.5, font, color: grey });
    page.drawLine({
      start: { x: P(MARGIN_MM), y: P(ph - MARGIN_MM - HEAD_MM + 4) },
      end: { x: P(pw - MARGIN_MM), y: P(ph - MARGIN_MM - HEAD_MM + 4) },
      thickness: 0.6, color: ink });

    if (!items.length) {
      page.drawText('No switchboards on this plan.', {
        x: P(MARGIN_MM), y: P(ph / 2), size: 9, font, color: grey });
      return;
    }

    for (const it of items) {
      if (it.kind === 'heading') {
        page.drawText(pdfSafe(String(it.name ?? 'Space').toUpperCase())
          + (it.cont ? ' (cont.)' : ''), {
          x: P(MARGIN_MM + it.x), y: P(it.y - 4), size: 7, font: bold, color: ink });
        page.drawText(String(it.count), {
          x: P(pw - MARGIN_MM - 6), y: P(it.y - 4), size: 7, font, color: grey });
        page.drawLine({
          start: { x: P(MARGIN_MM), y: P(it.y - 6) },
          end: { x: P(pw - MARGIN_MM), y: P(it.y - 6) },
          thickness: 0.3, color: grey });
        continue;
      }

      const ox = MARGIN_MM + it.x;
      // THE CAPTION IS ABOVE THE PLATE and the plate hangs below it, which is
      // what `paginate` measured: `it.y` is the top of the whole item.
      page.drawText(pdfSafe(it.entry.name), {
        x: P(ox), y: P(it.y - 4.5), size: 6.5, font: bold, color: ink });
      page.drawText(`${it.entry.heightMm} AFFL`, {
        x: P(ox), y: P(it.y - 8.6), size: 5.5, font, color: grey });

      const pos = positionShapes(it.entry.composition, c);
      const baseY = it.y - it.hMm;
      for (const raw of pos.shapes) {
        drawShape(page, shift(scale(raw, 1 / PDF_SCALE), ox, baseY), { P, font, ink });
      }
    }
  });

  return doc.save();
}

/** One boardPlot shape onto a pdf-lib page. The mirror of `shapeToDXF`. */
function drawShape(page, sh, { P, font, ink }) {
  const thin = sh.layer === 'plate' ? 0.55 : sh.layer === 'device' ? 0.4 : 0.35;
  switch (sh.t) {
    case 'rect':
      page.drawRectangle({ x: P(sh.x), y: P(sh.y), width: P(sh.w), height: P(sh.h),
        borderWidth: thin, borderColor: ink });
      break;
    case 'line':
      page.drawLine({ start: { x: P(sh.x1), y: P(sh.y1) }, end: { x: P(sh.x2), y: P(sh.y2) },
        thickness: thin, color: ink });
      break;
    case 'circle':
      page.drawCircle({ x: P(sh.cx), y: P(sh.cy), size: P(sh.r), borderWidth: thin,
        borderColor: ink });
      break;
    case 'disc':
      page.drawCircle({ x: P(sh.cx), y: P(sh.cy), size: P(sh.r), color: ink });
      break;
    case 'poly':
      for (let i = 1; i < sh.pts.length; i++) {
        page.drawLine({
          start: { x: P(sh.pts[i - 1][0]), y: P(sh.pts[i - 1][1]) },
          end: { x: P(sh.pts[i][0]), y: P(sh.pts[i][1]) },
          thickness: thin, color: ink });
      }
      break;
    case 'text': {
      // CENTRED BY MEASURING, because a PDF string has no alignment of its own —
      // the draw call takes the left edge of the baseline and nothing else.
      const size = P(sh.h);
      const str = pdfSafe(sh.s);
      const w = font.widthOfTextAtSize(str, size);
      const x = sh.align === 'c' ? P(sh.x) - w / 2 : sh.align === 'r' ? P(sh.x) - w : P(sh.x);
      page.drawText(str, { x, y: P(sh.y), size, font, color: ink });
      break;
    }
    default: break;
  }
}
