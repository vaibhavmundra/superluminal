// ---------------------------------------------------------------------------
// test-shelf-strip.mjs — the tape inside the shelving.
//
// The third and last of the render pass's fittings, and the one with the least
// arithmetic in it: a shelf strip is as long as the shelving is. What is worth
// asserting is therefore mostly what it is NOT.
//
//   NOT ON THE WALL LINE. A reverse cove is a slot in the ceiling AT the wall;
//   this is tape inside joinery standing a foot into the room. Draw both on the
//   wall line and a wall with shelves and panelling gets two fittings on top of
//   each other, reading as one.
//
//   NO 70% RULE. That rule exists because a ceiling is continuous and a slot
//   that stops short of the end of a wall reads as a mistake in it. A shelf
//   strip is inside a piece of furniture and is exactly as long as the furniture;
//   extending it to the wall's end would put tape on plaster.
//
//   AND IT STILL STOPS AT A DOOR, because shelving does.
//
//   node tools/test-shelf-strip.mjs
// ---------------------------------------------------------------------------

import { shelfStripsFor, wantsShelfStrip, SHELF_STRIP } from '../src/lib/shelfStrip.js';
import { reverseCovesFor } from '../src/lib/reverseCove.js';
import { gridFor, cellRect } from '../src/lib/wallGrid.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

const PX = 20;
const G = gridFor([{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 200 }, { x: 0, y: 200 }], PX);
const runH = (x0, x1, y, type = 'shelves') => ({ type,
  cells: Array.from({ length: x1 - x0 + 1 }, (_, i) => ({ x: x0 + i, y })),
  start: { x: x0, y }, end: { x: x1, y } });
const runV = (y0, y1, x, type = 'shelves') => ({ type,
  cells: Array.from({ length: y1 - y0 + 1 }, (_, i) => ({ x, y: y0 + i })),
  start: { x, y: y0 }, end: { x, y: y1 } });
const one = (el, ctx = {}) => shelfStripsFor(el, G, { pxPerFt: PX, ...ctx })[0] ?? null;

console.log('-- what gets one --');
ok(wantsShelfStrip('shelves'), 'shelves do');
ok(!wantsShelfStrip('panelling') && !wantsShelfStrip('wallpaper'),
  'panelling and wallpaper do NOT — those are a reverse cove');
ok(!wantsShelfStrip('painting') && !wantsShelfStrip('wall_art'),
  'nor art, which is a spot. The three rules divide the vocabulary between them');
ok(one(runH(2, 9, 10, 'panelling')) === null, 'and asking anyway returns nothing');
ok(one({ type: 'shelves', cells: [] }) === null, 'an unplaced element gets nothing');
ok(one(runH(2, 9, 10), { pxPerFt: null }) === null, 'and with no scale there is no length');

console.log('\n-- as long as the shelving, and no longer --');
{
  const st = one(runH(2, 9, 10));                         // 8 cells = 8 ft
  ok(near(st.lengthFt, 8), `8 ft of shelving -> an 8 ft run: ${st.lengthFt}`);
  ok(near(st.runLength, 8 * PX), 'billed by that length in plan pixels');
  ok(st.run.length === 2, 'a two-point run, like every other strip that is not a cove');
  ok(st.wall === 'top', 'on the wall the shelving is against');
  // 11 of 12 ft is 92% — past the cove's threshold, and irrelevant here.
  const long = one(runH(1, 11, 10));
  ok(near(long.lengthFt, 11), `11 of 12 ft stays 11 ft: ${long.lengthFt}`);
  const cove = reverseCovesFor(runH(1, 11, 10, 'panelling'), G, { pxPerFt: PX })[0];
  ok(cove.full && near(cove.lengthFt, 12),
    'while the same run as PANELLING takes the whole 12 ft wall — the two rules really do differ');
}

console.log('\n-- inside the joinery, not on the wall --');
for (const [label, el, axis, wall] of [
  ['top', runH(2, 9, 10), 'y', 'top'],
  ['bottom', runH(2, 9, 1), 'y', 'bottom'],
  ['left', runV(3, 7, 1), 'x', 'left'],
  ['right', runV(3, 7, 12), 'x', 'right'],
]) {
  const st = one(el);
  ok(st.wall === wall, `${label} wall reads as "${st.wall}"`);
  const band = cellRect(G, el.start.x, el.start.y);
  const mid = axis === 'y' ? (band.y0 + band.y1) / 2 : (band.x0 + band.x1) / 2;
  ok(st.run.every((p) => near(p[axis], mid)),
    '  ...and the tape runs down the middle of the shelving band');
  const wallLine = wall === 'top' ? G.y0 : wall === 'bottom' ? G.y1 : wall === 'left' ? G.x0 : G.x1;
  ok(!near(st.run[0][axis], wallLine),
    '  ...which is NOT the wall line — a cove goes there and these must not collide');
}

console.log('\n-- and it stops at a door --');
{
  const DOOR = { rect: { x0: 7 * PX, y0: -10, x1: 10 * PX, y1: 0.8 * PX } };
  const cut = shelfStripsFor(runH(1, 12, 10), G, { pxPerFt: PX, doors: [DOOR] });
  ok(cut.length === 2, `shelving across a door is two runs: ${cut.length}`);
  ok(near(cut[0].lengthFt, 7) && near(cut[1].lengthFt, 2),
    'measured on each side of the opening');
  ok(near(cut[0].rect.x1, 7 * PX) && near(cut[1].rect.x0, 10 * PX),
    'and neither crosses it');
  ok(cut.every((q) => q.split && q.ofSegments === 2), 'both say they were cut');
  ok(shelfStripsFor(runH(1, 12, 10), G, { pxPerFt: PX }).length === 1,
    'with no door it is one run, exactly as before');
  // A sliver left between two doors is not worth a driver.
  const tight = { rect: { x0: 7.5 * PX, y0: -10, x1: 11 * PX, y1: 0.8 * PX } };
  const slivers = shelfStripsFor(runH(1, 12, 10), G, { pxPerFt: PX, doors: [DOOR, tight] });
  ok(slivers.every((q) => q.lengthFt >= SHELF_STRIP.minRunFt),
    `nothing under ${SHELF_STRIP.minRunFt} ft is emitted`);
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
