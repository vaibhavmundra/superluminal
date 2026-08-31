// ---------------------------------------------------------------------------
// wallGrid.js — the 1ft grid the render pass places things on.
//
// THE PROMPT DEFINES A COORDINATE SYSTEM AND THIS FILE IS THE ONLY THING THAT
// KNOWS WHERE IT LANDS ON THE DRAWING. PROMPT 02 says: cells are [x, y], the
// bottom-left cell inside the room is [1, 1], x increases right, y increases
// UPWARD. Plan pixels increase DOWNWARD. That one flip is the whole reason this
// is a module rather than four lines inlined at the call site — inlined, it
// would be inlined twice (once to draw the grid, once to read the answer back)
// and the two copies would disagree about which way up the room is, silently,
// with every element mirrored top-to-bottom.
//
// So: gridFor() defines it, cellRect() is the ONE way out of it, and the
// drawing code and the parser both go through cellRect().
//
// WHY THE CELLS ARE NOT EXACTLY 1FT. The room is `cols` cells wide where
// `cols = round(widthFt)`, and the cell width is then widthPx / cols. On a
// 12.4ft room that is twelve cells of 1.03ft rather than twelve of 1.00ft and a
// sliver. The sliver is the problem: a partial cell at the far wall is a cell
// the model can see and count, so it answers x = 13 on a room the code thinks
// has twelve columns, and the last element on that wall lands outside the room
// or gets clamped onto its neighbour. A grid that divides the room exactly
// cannot produce that disagreement. The error it costs instead is bounded by
// half a cell over the whole run, which is nothing next to a mis-set wall.
//
// PURE. No DOM, no canvas — the picture is drawn by roomSnapshot() in
// accentMask.js, which takes a grid from here and knows nothing else about it.
// ---------------------------------------------------------------------------

import { bbox } from './geometry.js';
import { CELL_FT } from './wallPrompt.js';

/** Below this there is no room to speak of and no grid worth drawing. */
export const MIN_CELLS = 2;
/** And above it the labels stop being legible in a 1400px JPEG. */
export const MAX_CELLS = 60;

/**
 * The grid for one room, in PLAN PIXELS.
 *
 * Returns null rather than throwing when there is no scale: a plan with no
 * px/ft cannot have a 1ft grid, and the panel says so in words rather than the
 * pass failing somewhere deeper with a division by zero.
 */
export function gridFor(polygonPx, pxPerFt, { cellFt = CELL_FT } = {}) {
  if (!polygonPx?.length || !(pxPerFt > 0) || !(cellFt > 0)) return null;
  const b = bbox(polygonPx);
  const clamp = (n) => Math.max(MIN_CELLS, Math.min(MAX_CELLS, n));
  const cols = clamp(Math.round(b.w / (pxPerFt * cellFt)));
  const rows = clamp(Math.round(b.h / (pxPerFt * cellFt)));
  return {
    x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY,
    w: b.w, h: b.h, cols, rows,
    cellW: b.w / cols, cellH: b.h / rows,
    // What a cell IS in feet, after the divide-exactly compromise above. Shown
    // in the panel, and handed to the prompt so "1 cell = 1 ft" is a statement
    // about this drawing rather than a hope.
    cellWFt: b.w / cols / pxPerFt,
    cellHFt: b.h / rows / pxPerFt,
    cellFt,
  };
}

/**
 * A cell reference -> its rectangle in plan pixels. THE ONLY WAY OUT.
 *
 * `y` counts UP from the bottom of the grid, `x` counts right from the left,
 * both 1-based, exactly as PROMPT 02 defines them. Out-of-range references are
 * returned rather than refused — the parser has already clamped them, and a
 * caller that wants to know should ask `inGrid`.
 */
export function cellRect(grid, x, y) {
  if (!grid) return null;
  const px0 = grid.x0 + (x - 1) * grid.cellW;
  // THE FLIP. y = 1 is the BOTTOM row, which is the largest plan-pixel y.
  const py1 = grid.y1 - (y - 1) * grid.cellH;
  return { x0: px0, y0: py1 - grid.cellH, x1: px0 + grid.cellW, y1: py1 };
}

export const inGrid = (grid, x, y) =>
  !!grid && x >= 1 && x <= grid.cols && y >= 1 && y <= grid.rows;

/** A run of cells -> plan-pixel rectangles, for the canvas. */
export function cellsToPlanPx(cells, grid) {
  if (!grid || !cells?.length) return [];
  return cells.map((c) => cellRect(grid, c.x, c.y)).filter(Boolean);
}

/**
 * A run of cells -> ONE plan-pixel rectangle covering all of them.
 *
 * A wall element is a line of cells by rule A, so its union is a rectangle and
 * drawing it as one is both fewer nodes on the SVG and a truer picture: eleven
 * abutting squares with their own edges read as eleven things.
 */
export function cellsToRect(cells, grid) {
  const rs = cellsToPlanPx(cells, grid);
  if (!rs.length) return null;
  return {
    x0: Math.min(...rs.map((r) => r.x0)), y0: Math.min(...rs.map((r) => r.y0)),
    x1: Math.max(...rs.map((r) => r.x1)), y1: Math.max(...rs.map((r) => r.y1)),
  };
}

// --- the anchors ------------------------------------------------------------
//
// PROMPT 02's ANCHORS block is what ties "the wall behind the bed" — which is
// all a photograph can tell you — to a wall of a rectangle on a drawing. The
// prompt as written carries four example anchors with the answers filled in by
// hand. Filling them in by hand for every room in every plan is not a feature,
// so they are DERIVED from what this app has already detected: the accent
// pass's furniture, and the doors found for the scale.
//
// A DERIVED ANCHOR CAN BE WRONG AND THAT IS SURVIVABLE. It is a hint in a
// prompt, not a coordinate — the model still has the drawing in front of it and
// still has to reconcile the two. What is NOT survivable is a confident anchor
// stated for something that was never detected, so anything without a detection
// behind it is simply not listed, and the block says as much.

const SIDE_LABEL = { top: 'top wall', bottom: 'bottom wall', left: 'left wall', right: 'right wall' };

/** Walls whose direction runs along x, and walls whose direction runs along y. */
const ALONG_X = ['top', 'bottom'];
const ALONG_Y = ['left', 'right'];

/**
 * Which wall of the grid a rectangle is against.
 *
 * NEAREST WALL IS THE WRONG ANSWER, AND IT IS WRONG EXACTLY WHERE FURNITURE
 * ACTUALLY LIVES: IN A CORNER. This function used to score the four gaps and
 * take the smallest. A TV unit running the full width of the bottom wall of a
 * room touches the bottom wall AND the left wall at distance zero — the gaps
 * tie, the tie broke toward whichever key was checked first, and the anchor came
 * out `TV unit = the left wall`. PROMPT 02 then believed it, put the TV/console
 * zone on the left wall, and placed everything that referred to it from there.
 * A confident, self-consistent, entirely wrong answer, from one tie-break.
 *
 * accentPlace.js's `wallForRun` had already met this and its header names the
 * same failure. THE FIX IS THE SAME IDEA: don't ask which wall is nearest, ask
 * which walls are ELIGIBLE, then take the nearest of those. A piece of furniture
 * pushed against a wall is long along it and shallow across it, so only the two
 * walls parallel to its long axis are candidates. The bottom-left TV unit is
 * then judged against top and bottom only, and bottom wins by a mile.
 *
 * `across` INVERTS THAT, AND THE BED IS WHY. A bed's long axis is head-to-foot,
 * and the headboard is on a SHORT edge — so the headboard wall is the one
 * running ACROSS the bed's long axis, which is precisely the pair the rule above
 * excludes. Getting this backwards puts a 5x6.5ft double bed's "headboard wall"
 * on whichever side wall it happens to be nearer, which is how a room comes back
 * with its panelling on the wrong side.
 *
 * A NEAR-SQUARE BOX HAS NO LONG AXIS and all four walls stay in play, which is
 * the honest answer for a king bed at 6 x 6.5 ft. Same 12% tolerance as
 * wallForRun, for the same reason and so the two do not disagree about what
 * counts as square.
 */
export function sideOf(rect, grid, { across = false } = {}) {
  if (!rect || !grid) return null;
  const w = rect.x1 - rect.x0, h = rect.y1 - rect.y0;
  const gap = {
    left: Math.max(0, rect.x0 - grid.x0), right: Math.max(0, grid.x1 - rect.x1),
    top: Math.max(0, rect.y0 - grid.y0), bottom: Math.max(0, grid.y1 - rect.y1),
  };

  const square = Math.abs(w - h) < Math.max(w, h) * 0.12;
  // `longIsX` -> the piece runs left-to-right, so the wall it hugs is one whose
  // own direction is x: the top or the bottom. `across` flips it.
  const longIsX = w > h;
  const candidates = square ? [...ALONG_X, ...ALONG_Y]
    : ((across ? !longIsX : longIsX) ? ALONG_X : ALONG_Y);

  let best = candidates[0];
  for (const k of candidates) if (gap[k] < gap[best]) best = k;
  // OUT IN THE ROOM IS NOT AGAINST A WALL. A box this far off every candidate is
  // a detection to say nothing about rather than to file somewhere plausible —
  // see anchorLines: an anchor nobody can stand behind is worse than a gap.
  if (gap[best] > Math.min(grid.w, grid.h) * 0.35) return null;
  return best;
}

/** Where along that wall — for a door, which is the one anchor that is a point
 *  rather than a side. "the right end of the top wall". */
export function endOf(rect, side, grid) {
  if (!rect || !side || !grid) return '';
  const horizontal = side === 'top' || side === 'bottom';
  const c = horizontal ? (rect.x0 + rect.x1) / 2 : (rect.y0 + rect.y1) / 2;
  const lo = horizontal ? grid.x0 : grid.y0;
  const span = horizontal ? grid.w : grid.h;
  const f = span > 0 ? (c - lo) / span : 0.5;
  if (f < 0.33) return horizontal ? 'the left end of ' : 'the top end of ';
  if (f > 0.67) return horizontal ? 'the right end of ' : 'the bottom end of ';
  return 'the middle of ';
}

/** Does this rectangle overlap the room at all? Doors are found on the whole
 *  sheet, so most of them belong to somebody else's room. */
const overlaps = (r, g) => !!r && !!g && r.x1 > g.x0 && r.x0 < g.x1 && r.y1 > g.y0 && r.y0 < g.y1;

/**
 * The ANCHORS bullets, as the text that goes into the prompt.
 *
 * `furniture` is the accent pass's list for this room, in plan pixels, already
 * carrying `type` — the same five ids accentPrompt.js defines. `doors` is the
 * whole sheet's doors; the ones outside this room are dropped.
 */
export function anchorLines({ furniture = [], doors = [], grid = null } = {}) {
  if (!grid) return '   - (no grid)';

  // Gathered as {label, side, prefix} first and rendered afterwards, because two
  // things about the rendering can only be decided once the whole set is known:
  // whether an entry is a duplicate, and whether a label needs a number on it.
  const found = [];
  const add = (label, side, prefix = '') => { if (side) found.push({ label, side, prefix }); };

  // A BED IS THE ANCHOR THAT MATTERS MOST and it gets the phrasing the prompt
  // was written with, because "bed headboard wall" is the phrase PROMPT 01
  // produces when it describes a bedroom.
  //
  // `across: true` — the headboard is on a SHORT edge of the mattress, so its
  // wall runs across the bed's long axis. See sideOf.
  for (const b of furniture.filter((f) => f.type === 'bed').slice(0, 2)) {
    add('Bed headboard wall', sideOf(b.rect, grid, { across: true }));
  }
  for (const [type, label] of [['tv_unit', 'TV unit'], ['wardrobe', 'Wardrobe'],
                               ['sofa', 'Sofa'], ['basin', 'Basin / vanity']]) {
    for (const f of furniture.filter((q) => q.type === type).slice(0, 2)) {
      add(label, sideOf(f.rect, grid));
    }
  }
  for (const d of doors.filter((q) => overlaps(q.rect, grid)).slice(0, 2)) {
    const s = sideOf(d.rect, grid);
    add('Door', s, endOf(d.rect, s, grid));
  }

  // TWO WARDROBES ON THE SAME WALL ARE ONE ANCHOR. The block is a lookup table
  // for the model — "which wall does 'behind the bed' mean" — so a line repeated
  // verbatim adds nothing and reads as a mistake in the prompt, which is not the
  // impression to give something being asked to reason carefully.
  const seen = new Set();
  const unique = found.filter((f) => {
    const k = `${f.label}|${f.side}|${f.prefix}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  // ...but two wardrobes on DIFFERENT walls are two anchors, and they have to be
  // told apart. Unnumbered, the block would say "Wardrobe = the right wall" and
  // "Wardrobe = the left wall" one under the other, which reads as a
  // contradiction rather than as a room with two wardrobes in it.
  const count = {};
  for (const f of unique) count[f.label] = (count[f.label] ?? 0) + 1;
  const nth = {};
  const lines = unique.map((f) => {
    const label = count[f.label] > 1
      ? f.label.replace(/^(\w+)/, (m) => `${m} ${(nth[f.label] = (nth[f.label] ?? 0) + 1)}`)
      : f.label;
    return `   - ${label} = ${f.prefix}the ${SIDE_LABEL[f.side]}`;
  });

  if (!lines.length) {
    return '   - none were detected on this plan. Read the walls off the drawing\n'
         + '     itself: the furniture, the door swings and the window openings are\n'
         + '     all drawn on it, and the ELEMENTS below describe the room in those\n'
         + '     same terms.';
  }
  lines.push('   - Anything not listed here is not detected on the plan — read it off'
           + '\n     the drawing.');
  return lines.join('\n');
}
