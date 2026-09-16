// ---------------------------------------------------------------------------
// boardPlot.js — A PLATE AS MILLIMETRES, ONCE, FOR BOTH EXPORTS.
//
// WHY THIS IS NOT SwitchboardCard.jsx. That file draws the frame the panel and
// the sheet read on screen, and it draws a DIAGRAM: one module is 22 wide by 44
// tall because 2:1 is legible at the size a column allows, and the whole thing
// scales to whatever box it lands in. It is the right drawing to read a plate
// off and the wrong one to build from — no module is 2:1 in any country, and a
// DXF exported at those proportions would measure wrong in CAD, which is worse
// than not exporting it at all. So the export plots from the country's own
// millimetres (see `plate` in switchboards.js) and the screen keeps its diagram.
//
// ONE DESCRIPTION, TWO BACKENDS. The shapes below are deliberately the small
// set that a DXF entity and a pdf-lib call can both express without either one
// needing a special case: a rectangle, a straight line, a ring, a filled dot, an
// open polyline and a string. Anything a glyph wants that is not in that list —
// a bezier, a dash pattern, a gradient — is a thing one of the two backends
// would have to fake, so the glyphs are drawn without them.
//
// Y IS UP, AND THE ORIGIN IS THE PLATE'S BOTTOM-LEFT. Both consumers want it
// that way — DXF is a right-handed world and pdf-lib's page origin is bottom
// left — so the flip happens HERE, once, rather than in each of them. The SVG
// the glyphs were ported from is y-down, which is why every vertical term below
// reads inverted against SwitchboardCard's `Face`: same mark, same place on the
// part, opposite sign.
//
// NOTHING HERE KNOWS ABOUT SHEETS, PAGES OR SCALE. A plate is emitted at life
// size in millimetres and the caller decides where it lands and how far it
// shrinks — see boardExport.js, which lays them out and is the only file that
// has an opinion about A2 or 1:5.
// ---------------------------------------------------------------------------
import { plateMm } from './switchboards.js';

/** The four layers a plate's marks are split across. See boardExport's DXF table. */
export const PLATE_LAYER = {
  plate: 'plate',     // the plate outline — the thing screwed to the wall
  device: 'device',   // one module's own rectangle
  glyph: 'glyph',     // what is printed on that module's face
  text: 'text',       // the rating, and anything the caller adds beside it
};

const rect = (layer, x, y, w, h) => ({ t: 'rect', layer, x, y, w, h });
const line = (layer, x1, y1, x2, y2) => ({ t: 'line', layer, x1, y1, x2, y2 });
const circle = (layer, cx, cy, r) => ({ t: 'circle', layer, cx, cy, r });
const disc = (layer, cx, cy, r) => ({ t: 'disc', layer, cx, cy, r });
const poly = (layer, pts) => ({ t: 'poly', layer, pts });
const text = (layer, x, y, h, s, align = 'c') => ({ t: 'text', layer, x, y, h, s, align });

/**
 * WHAT IS PRINTED ON ONE MODULE'S FACE, in a box whose origin is its BOTTOM-left.
 *
 * A PORT OF `Face` IN SwitchboardCard.jsx AND IT HAS TO STAY ONE. These are the
 * marks that make a rocker read as a rocker and a regulator as a knob; two
 * drawings of them that drift apart would mean the plate on screen and the plate
 * in the DXF are different parts. Every proportion below is the same fraction of
 * the box that file uses — only the sign of the vertical terms changes, because
 * this space is y-up and an SVG is y-down.
 */
function face(kind, x, y, w, h, { twoWay = false } = {}) {
  const G = PLATE_LAYER.glyph;
  const cx = x + w / 2, cy = y + h / 2;
  const r = Math.min(w, h) * 0.26;

  switch (kind) {
    case 'switch':
      // TWO CHEVRONS WHERE IT IS A TWO-WAY, and the rocker line where it is not
      // — the mark that is on the real part, for the reason SwitchboardCard's
      // own note gives: either half of a two-way makes the circuit.
      if (twoWay) {
        const dx = w * 0.19, dy = h * 0.075, gap = h * 0.13;
        return [
          poly(G, [[cx - dx, cy + gap], [cx, cy + gap + dy], [cx + dx, cy + gap]]),
          poly(G, [[cx - dx, cy - gap], [cx, cy - gap - dy], [cx + dx, cy - gap]]),
        ];
      }
      return [line(G, cx - w * 0.3, cy, cx + w * 0.3, cy)];

    case 'fan':   // a knob with an index mark: a thing you turn
      return [circle(G, cx, cy, r), line(G, cx, cy, cx, cy + r)];

    case 'socket':   // three pins in a ring
      return [
        circle(G, cx, cy, r * 1.45),
        disc(G, cx, cy + r * 0.62, r * 0.2),
        disc(G, cx - r * 0.55, cy - r * 0.42, r * 0.2),
        disc(G, cx + r * 0.55, cy - r * 0.42, r * 0.2),
      ];

    case 'usb': {   // the port itself: a flat oval, drawn as its rectangle
      // 4 AGAINST AN SVG H OF 44 is where 0.09 comes from. The screen's number
      // is absolute and this box is a different size, so the fraction travels
      // and the pixel count does not.
      const hh = h * 0.09;
      return [rect(G, cx - w * 0.26, cy - hh / 2, w * 0.52, hh)];
    }

    case 'data': {   // a keystone jack: the body, and the latch slot above it
      const bh = h * 0.18;
      const bottom = cy + h * 0.1 - bh;
      const latch = cy + h * 0.19;
      return [
        rect(G, cx - w * 0.24, bottom, w * 0.48, bh),
        line(G, cx - w * 0.08, cy + h * 0.1, cx - w * 0.08, latch),
        line(G, cx + w * 0.08, cy + h * 0.1, cx + w * 0.08, latch),
        line(G, cx - w * 0.08, latch, cx + w * 0.08, latch),
      ];
    }

    // A BLANK HAS NO FACE, and that is the point of it — see the note on the
    // module rectangle below for how it says so instead.
    default:
      return [];
  }
}

/** How wide one frame comes out, in millimetres. Exported for the layout pass. */
export function plateWidthMm(board, country) {
  const mm = plateMm(country);
  const n = board?.points?.length ?? 0;
  const modules = (board?.points ?? []).reduce((t, p) => t + (p.modules || 1), 0);
  return mm.sideMm * 2 + modules * mm.moduleMm + Math.max(0, n - 1) * mm.gapMm;
}

/** And how tall. One number for every plate on the job — see `heightMm`. */
export function plateHeightMm(country) {
  return plateMm(country).heightMm;
}

/**
 * ONE FRAME, AS MARKS ON PAPER.
 *
 * Returns `{ widthMm, heightMm, shapes }` with every coordinate in millimetres
 * from the plate's bottom-left corner. `shapes` is flat and in draw order:
 * plate, then each module's rectangle, then its face, then its rating.
 *
 * THE BLANKS ARE DRAWN AND NOT SKIPPED. A blank module is a real part, it is on
 * the schedule, and a plate exported with holes where its blanks were would be a
 * plate nobody could order — the screen draws them at a third of the ink for
 * exactly that reason, and a monochrome drawing says the same thing by having no
 * face inside the rectangle.
 */
export function plateShapes(board, country, { ratings = true } = {}) {
  const mm = plateMm(country);
  const widthMm = plateWidthMm(board, country);
  const heightMm = mm.heightMm;
  // DERIVED, NOT STORED. The border above and below is whatever is left over
  // once the device opening is taken out of the plate — so the three numbers in
  // the country table cannot come to disagree about where the top edge is.
  const foot = (heightMm - mm.moduleHMm) / 2;
  const shapes = [rect(PLATE_LAYER.plate, 0, 0, widthMm, heightMm)];

  let x = mm.sideMm;
  for (const p of board?.points ?? []) {
    const w = (p.modules || 1) * mm.moduleMm;
    shapes.push(rect(PLATE_LAYER.device, x, foot, w, mm.moduleHMm));
    shapes.push(...face(p.kind, x, foot, w, mm.moduleHMm, { twoWay: !!p.twoWay }));
    // THE RATING, ON THE PARTS THAT HAVE ONE. It is the one thing about a module
    // that cannot be drawn — a 6A rocker and a 20A rocker are the same mark —
    // and on a plate carrying both it is the only way to tell them apart.
    if (ratings && p.amps != null) {
      shapes.push(text(PLATE_LAYER.text, x + w / 2, foot + mm.moduleHMm * 0.10,
        mm.moduleHMm * 0.18, `${p.amps}A`));
    }
    x += w + mm.gapMm;
  }
  return { widthMm, heightMm, shapes };
}

/**
 * EVERY FRAME OF ONE POSITION, STACKED, plus the room for a caption above them.
 *
 * A POSITION CAN BE TWO PLATES ON ONE WALL — past a country's largest frame
 * `packBoards` splits it — and a drawing showing the first and not the second
 * would under-count the job in exactly the way the sheet's own note warns about.
 * They are stacked downwards with a gap, so the pair reads as one item.
 */
export function positionShapes(composition, country, { gapMm = 14 } = {}) {
  const boards = composition?.boards ?? [];
  const h = plateHeightMm(country);
  const shapes = [];
  let widthMm = 0;
  boards.forEach((b, i) => {
    const one = plateShapes(b, country);
    widthMm = Math.max(widthMm, one.widthMm);
    // TOP FRAME FIRST, so a split plate reads down the page in the order the
    // packer produced it. The offset is from the bottom, hence the reversal.
    const dy = (boards.length - 1 - i) * (h + gapMm);
    shapes.push(...one.shapes.map((sh) => shift(sh, 0, dy)));
  });
  return { widthMm, heightMm: boards.length * h + Math.max(0, boards.length - 1) * gapMm, shapes };
}

/**
 * HOW WIDE A POSITION IS, WITHOUT DRAWING IT.
 *
 * `positionShapes` was doing this job for the pagination pass, and it was the
 * wrong tool by an order of magnitude: laying out a hundred and fifty plates
 * meant building every rectangle, ring, dot and string of all of them — tens of
 * thousands of objects — and reading one number off each. The widest frame wins,
 * and a frame's width is arithmetic over its modules.
 */
export function positionWidthMm(composition, country) {
  return (composition?.boards ?? [])
    .reduce((w, b) => Math.max(w, plateWidthMm(b, country)), 0);
}

/** One shape, moved. Pure, and it never mutates what it is handed. */
export function shift(sh, dx, dy) {
  switch (sh.t) {
    case 'rect': return { ...sh, x: sh.x + dx, y: sh.y + dy };
    case 'line': return { ...sh, x1: sh.x1 + dx, y1: sh.y1 + dy, x2: sh.x2 + dx, y2: sh.y2 + dy };
    case 'circle':
    case 'disc': return { ...sh, cx: sh.cx + dx, cy: sh.cy + dy };
    case 'poly': return { ...sh, pts: sh.pts.map(([x, y]) => [x + dx, y + dy]) };
    case 'text': return { ...sh, x: sh.x + dx, y: sh.y + dy };
    default: return sh;
  }
}

/** The same, scaled about the origin — the one step from millimetres to paper. */
export function scale(sh, k) {
  switch (sh.t) {
    case 'rect': return { ...sh, x: sh.x * k, y: sh.y * k, w: sh.w * k, h: sh.h * k };
    case 'line': return { ...sh, x1: sh.x1 * k, y1: sh.y1 * k, x2: sh.x2 * k, y2: sh.y2 * k };
    case 'circle':
    case 'disc': return { ...sh, cx: sh.cx * k, cy: sh.cy * k, r: sh.r * k };
    case 'poly': return { ...sh, pts: sh.pts.map(([x, y]) => [x * k, y * k]) };
    case 'text': return { ...sh, x: sh.x * k, y: sh.y * k, h: sh.h * k };
    default: return sh;
  }
}
