// ---------------------------------------------------------------------------
// test-reverse-cove.mjs — the ceiling detail over a panelled wall.
//
// THE RULE HAS TWO NUMBERS IN IT AND BOTH ARE EASY TO GET SUBTLY WRONG.
//
//   8 INCHES is a real dimension across the ceiling, not a fraction of the
//   room and not a line. A band that scales with the room, or a cove drawn as a
//   polyline, both look plausible on screen and are neither buildable nor
//   billable.
//
//   70% IS A THRESHOLD, INCLUSIVE. At exactly seven tenths the cove takes the
//   whole wall — the case a `>` instead of a `>=` gets wrong, silently, on the
//   one plan in ten where it lands on the boundary.
//
// And the third thing, which is not a number: the band sits AT THE WALL. It is
// anchored on the room's edge rather than on the cells the model returned,
// because a run the model put a foot off the wall would otherwise float the
// slot into the middle of the ceiling.
//
//   node tools/test-reverse-cove.mjs
// ---------------------------------------------------------------------------

import { reverseCovesFor, wallSegments, mergeReverseCoves, wantsReverseCove,
         trimWallRun, RUN_TRIM, REVERSE_COVE } from '../src/lib/reverseCove.js';
import { gridFor } from '../src/lib/wallGrid.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

const PX = 20;                                   // px per foot
// A 12 ft x 10 ft room at the origin: 12 columns, 10 rows.
const G = gridFor([{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 200 }, { x: 0, y: 200 }], PX);
const DEPTH = (REVERSE_COVE.widthIn / 12) * PX;  // 8 in, in plan pixels

/** The one cove a wall with no door in it produces. The door cases below call
 *  reverseCovesFor directly and read the whole list. */
const one = (el, ctx = {}) => reverseCovesFor(el, G, { pxPerFt: PX, ...ctx })[0] ?? null;

/** A run of cells along a row (horizontal) or a column (vertical). */
const runH = (x0, x1, y) => ({ type: 'panelling', cells: Array.from({ length: x1 - x0 + 1 },
  (_, i) => ({ x: x0 + i, y })), start: { x: x0, y }, end: { x: x1, y } });
const runV = (y0, y1, x) => ({ type: 'panelling', cells: Array.from({ length: y1 - y0 + 1 },
  (_, i) => ({ x, y: y0 + i })), start: { x, y: y0 }, end: { x, y: y1 } });

console.log('-- what gets one --');
ok(G.cols === 12 && G.rows === 10, `the test room is 12 x 10 cells, got ${G.cols} x ${G.rows}`);
ok(wantsReverseCove('panelling') && wantsReverseCove('wallpaper'), 'panelling and wallpaper do');
ok(!wantsReverseCove('painting') && !wantsReverseCove('wall_art'),
  'art does NOT — that is a spot, and the two rules divide the vocabulary between them');
ok(!wantsReverseCove('shelves'), 'nor shelves');
ok(one({ ...runH(2, 9, 10), type: 'painting' }) === null,
  'and asking for one anyway returns null rather than a band');
ok(one({ type: 'panelling', cells: [] }) === null,
  'an unplaced element gets nothing — no cells, no wall, no cove');
ok(one(runH(2, 9, 10), { pxPerFt: null }) === null,
  'and with no scale there is no such thing as eight inches');

console.log('\n-- eight inches, at the wall --');
{
  // 8 cells of panelling along the top wall. 8 / 12 = 67%, under the threshold.
  const c = one(runH(2, 9, 10));
  ok(c.wall === 'top', `on the top wall (row ${G.rows} is the top — y counts up): ${c.wall}`);
  ok(near(c.rect.y1 - c.rect.y0, DEPTH),
    `${REVERSE_COVE.widthIn} in across: ${((c.rect.y1 - c.rect.y0) / PX * 12).toFixed(1)} in`);
  ok(near(c.widthFt, REVERSE_COVE.widthIn / 12), 'and says so in feet for the panel');
  ok(near(c.rect.y0, G.y0), 'anchored ON the wall, not on the cells');
  ok(near(c.spanFt, 8), `the run is 8 ft: ${c.spanFt}`);
  ok(near(c.wallFt, 12), `the wall is 12 ft: ${c.wallFt}`);
  ok(!c.full && near(c.lengthFt, 8), `under 70%, so the cove is the run: ${c.lengthFt} ft`);
  ok(near(c.rect.x0, 20) && near(c.rect.x1, 180), 'and stops exactly where the panelling does');
}
{
  // A run the model placed a row IN from the wall still coves the wall. Rule A
  // says these hug a wall; the bounding box is not always where the model
  // thought the wall was, and a slot floating in the ceiling is not a detail.
  const c = one(runH(2, 9, 9));
  ok(c.wall === 'top' && near(c.rect.y0, G.y0),
    'a run one row off the wall still puts the slot at the wall');
}

console.log('\n-- and the whole wall past 70% --');
{
  const c = one(runH(2, 10, 10));     // 9 of 12 = 75%
  ok(c.full, `9 of 12 ft is ${Math.round(c.fraction * 100)}% — takes the whole wall`);
  ok(near(c.lengthFt, 12) && near(c.rect.x0, G.x0) && near(c.rect.x1, G.x1),
    'so it runs wall to wall, not to the end of the panelling');
}
{
  // EXACTLY 70%: 7 of 10 down a side wall. Inclusive, so it is the whole wall.
  const c = one(runV(2, 8, 1));
  ok(near(c.fraction, 0.7), `exactly ${Math.round(c.fraction * 100)}% — the boundary case`);
  ok(c.full && near(c.lengthFt, 10),
    'and 70% counts as "greater than or equal", so it takes the whole wall');
}
{
  const c = one(runV(2, 7, 1));        // 6 of 10 = 60%
  ok(!c.full && near(c.lengthFt, 6), 'a hair under, and it is the run again');
}

console.log('\n-- all four walls, and the tape down the middle --');
for (const [label, el, wall, axis] of [
  ['top', runH(2, 9, 10), 'top', 'y'],
  ['bottom', runH(2, 9, 1), 'bottom', 'y'],
  ['left', runV(3, 7, 1), 'left', 'x'],
  ['right', runV(3, 7, 12), 'right', 'x'],
]) {
  const c = one(el);
  ok(c.wall === wall, `${label} wall reads as "${c.wall}"`);
  const across = axis === 'y' ? c.rect.y1 - c.rect.y0 : c.rect.x1 - c.rect.x0;
  ok(near(across, DEPTH), `  ...${REVERSE_COVE.widthIn} in across it`);
  // Touching the wall it names, on the correct side.
  const touches = wall === 'top' ? near(c.rect.y0, G.y0) : wall === 'bottom' ? near(c.rect.y1, G.y1)
    : wall === 'left' ? near(c.rect.x0, G.x0) : near(c.rect.x1, G.x1);
  ok(touches, '  ...and hugging that wall and no other');
  ok(c.run.length === 2, '  ...with a two-point run, not a closed loop — a reverse cove turns no corners');
  const mid = axis === 'y' ? (c.rect.y0 + c.rect.y1) / 2 : (c.rect.x0 + c.rect.x1) / 2;
  ok(c.run.every((p) => near(p[axis], mid)), '  ...and the tape runs down the middle of the slot');
  ok(near(c.runLength, axis === 'y' ? c.rect.x1 - c.rect.x0 : c.rect.y1 - c.rect.y0),
    '  ...billed by the length of the slot, not by its area');
}

console.log('\n-- one wall is one cove --');
{
  // Panelling to the dado and paper above it: one wall, two honest answers from
  // the render pass, and eight inches of ceiling that must not be built twice.
  const a = { ...one(runH(2, 9, 10)), elementId: 'w-a' };
  const b = { ...one({ ...runH(4, 11, 10), type: 'wallpaper' }), elementId: 'w-b' };
  const merged = mergeReverseCoves([a, b], { pxPerFt: PX });
  ok(merged.length === 1, `two overlapping bands merge into one: got ${merged.length}`);
  ok(near(merged[0].rect.x0, Math.min(a.rect.x0, b.rect.x0))
     && near(merged[0].rect.x1, Math.max(a.rect.x1, b.rect.x1)),
    'and the survivor is their union, so neither run is lost');
  ok(near(merged[0].runLength, merged[0].rect.x1 - merged[0].rect.x0),
    'with its billed length recomputed — otherwise the schedule bills the old one');
  ok(merged[0].from.join() === 'w-a,w-b', 'and it remembers both elements it came from');

  // Different walls are different coves, however close the corner.
  const far = mergeReverseCoves(
    [a, { ...one(runV(3, 7, 1)), elementId: 'w-c' }],
    { pxPerFt: PX });
  ok(far.length === 2, 'two walls stay two coves');
}

console.log('\n-- a door cuts the wall in two --');
//
// The 12 ft top wall with a 3 ft door box from x = 7 to x = 10 ft. Two segments:
// 0..7 ft and 10..12 ft.
const DOOR = { rect: { x0: 7 * PX, y0: -10, x1: 10 * PX, y1: 0.8 * PX } };
{
  const segs = wallSegments(G, 'top', [DOOR], { pxPerFt: PX });
  ok(segs.length === 2, `two segments, got ${segs.length}`);
  ok(near(segs[0].lo, 0) && near(segs[0].hi, 7 * PX), 'the first runs from the corner to the door');
  ok(near(segs[1].lo, 10 * PX) && near(segs[1].hi, 12 * PX), 'the second from the door to the far corner');
  ok(wallSegments(G, 'top', [], { pxPerFt: PX }).length === 1,
    'and with no door it is one segment — the whole wall, exactly as before');
  ok(wallSegments(G, 'bottom', [DOOR], { pxPerFt: PX }).length === 1,
    'a door in the top wall does not cut the bottom one');
  // A door detected for the room next door, on a wall this room does not have.
  const elsewhere = { rect: { x0: 400, y0: 400, x1: 440, y1: 440 } };
  ok(wallSegments(G, 'top', [elsewhere], { pxPerFt: PX }).length === 1,
    'nor does a door somewhere else on the sheet');
  // Two leaves detected as two overlapping boxes are one opening.
  const twin = { rect: { x0: 8 * PX, y0: -10, x1: 11 * PX, y1: 0.8 * PX } };
  ok(wallSegments(G, 'top', [DOOR, twin], { pxPerFt: PX }).length === 2,
    'two overlapping door boxes are one gap, not three segments');
}
{
  // THE CASE THE WHOLE CHANGE IS FOR. Panelling fills the 7 ft between the
  // corner and the door. Against the 12 ft WALL that is 58% — under the
  // threshold, so the old code stopped the cove short of the door for no
  // visible reason. Against the 7 ft SEGMENT it is 100%.
  const covesLong = reverseCovesFor(runH(1, 7, 10), G, { pxPerFt: PX, doors: [DOOR] });
  ok(covesLong.length === 1, `one cove, on the segment the panelling is on: ${covesLong.length}`);
  const c = covesLong[0];
  ok(near(c.wallFt, 7), `judged against the 7 ft SEGMENT, not the 12 ft wall: ${c.wallFt} ft`);
  ok(c.full && near(c.lengthFt, 7), 'so it fills the segment and stops at the door');
  ok(near(c.rect.x1, 7 * PX), 'the band ends at the door jamb, not past it');
  ok(c.split && c.segment === 1 && c.ofSegments === 2, 'and it says which segment it is');
  // Without the door it is the old answer, and the old answer is worse.
  const undivided = reverseCovesFor(runH(1, 7, 10), G, { pxPerFt: PX })[0];
  ok(!undivided.full && near(undivided.fraction, 7 / 12),
    `the same run with no door is ${Math.round(undivided.fraction * 100)}% and stops short`);
  ok(!undivided.split, 'and does not claim to be a segment of anything');
}
{
  // Panelling that crosses the door contributes to BOTH segments, and each is
  // judged on what it actually holds.
  const both = reverseCovesFor(runH(1, 12, 10), G, { pxPerFt: PX, doors: [DOOR] });
  ok(both.length === 2, `a run across the door coves both sides: ${both.length}`);
  ok(both[0].full && both[1].full, 'each side is full of panelling, so each takes its whole segment');
  ok(near(both[0].rect.x1, 7 * PX) && near(both[1].rect.x0, 10 * PX),
    'and neither band crosses the opening');
  ok(near(both[0].wallFt, 7) && near(both[1].wallFt, 2),
    'the two segments are measured separately: 7 ft and 2 ft');
  ok(both.every((q) => near(q.rect.y1 - q.rect.y0, DEPTH)),
    'both still eight inches across');
}
{
  // A segment with no panelling on it gets no cove.
  const only = reverseCovesFor(runH(11, 12, 10), G, { pxPerFt: PX, doors: [DOOR] });
  ok(only.length === 1 && only[0].segment === 2,
    'panelling on one side of the door coves that side only');
  // A sliver of wall between two doors is not worth a cove.
  const tight = { rect: { x0: 7.5 * PX, y0: -10, x1: 11 * PX, y1: 0.8 * PX } };
  const slivers = wallSegments(G, 'top', [DOOR, tight], { pxPerFt: PX });
  ok(!slivers.some((sg) => (sg.hi - sg.lo) / PX < REVERSE_COVE.minRunFt),
    `no segment under ${REVERSE_COVE.minRunFt} ft survives — a six-inch slot is not a detail`);
}

console.log('\n-- changing the length by hand --');
//
// THE EDIT IS STORED, NOT THE RESULT. Two numbers in feet per run — how far each
// end moved from where the rule put it — so a trimmed cove still follows its
// wall when the outline moves and still redraws at the right size when the scale
// changes. What is asserted here is that it clamps, that it cannot cross the
// door, and that it stamps the base a drag needs to stay under the pointer.
const DOOR2 = { rect: { x0: 7 * PX, y0: -10, x1: 10 * PX, y1: 0.8 * PX } };
{
  const c = one(runH(2, 9, 10));                       // 8 ft, x from 20 to 180 px
  const same = trimWallRun(c, null, { pxPerFt: PX });
  ok(!same.trimmed && near(same.lengthFt, 8), 'no trim leaves the run exactly as the rule made it');
  ok(near(same.base.lo, 20) && near(same.base.hi, 180),
    'but it still stamps where the RULE put the ends — a drag measures from there');

  const shorter = trimWallRun(c, { a: 1, b: 2 }, { pxPerFt: PX });
  ok(shorter.trimmed && near(shorter.lengthFt, 5), `1 ft off one end and 2 off the other: ${shorter.lengthFt} ft`);
  ok(near(shorter.rect.x0, 40) && near(shorter.rect.x1, 140), 'taken off the right ends');
  ok(near(shorter.rect.y0, c.rect.y0) && near(shorter.rect.y1, c.rect.y1),
    'and it is still eight inches across — only the length is editable');
  ok(near(shorter.run[0].x, 40) && near(shorter.run[1].x, 140), 'the tape follows the slot');
  ok(near(shorter.runLength, 100), 'and the billed length with it');
  ok(near(shorter.base.lo, 20) && near(shorter.base.hi, 180),
    'the base is still the RULE\'s ends, not the trimmed ones — otherwise a drag creeps');

  const longer = trimWallRun(c, { a: -1, b: -1 }, { pxPerFt: PX });
  ok(near(longer.lengthFt, 10), `negative trims lengthen it: ${longer.lengthFt} ft`);
}
{
  // THE CLAMP IS THE WALL, NOT THE SEGMENT.
  //
  // A door head is about 7 ft and a ceiling is 9 or more, so the slab over an
  // opening is ordinary continuous ceiling. There is nothing there to stop a
  // slot, and a drag that refused to cross one was a constraint this app
  // invented. The MEASUREMENT is still per segment — that is what `seg` is —
  // and only the reach is the whole wall.
  const c = reverseCovesFor(runH(1, 7, 10), G, { pxPerFt: PX, doors: [DOOR2] })[0];
  ok(near(c.lengthFt, 7) && near(c.seg.hi, 7 * PX),
    'measured against the 7 ft segment before the door');
  ok(near(c.bounds.lo, 0) && near(c.bounds.hi, 12 * PX),
    '...but its reach is the whole 12 ft wall');
  const past = trimWallRun(c, { a: 0, b: -3 }, { pxPerFt: PX });
  ok(near(past.rect.x1, 10 * PX),
    'so it can be dragged straight across the door — the ceiling runs over the head');
  const far = trimWallRun(c, { a: 0, b: -99 }, { pxPerFt: PX });
  ok(near(far.rect.x1, 12 * PX), 'and only stops at the far corner');
  const back = trimWallRun(c, { a: -10, b: 0 }, { pxPerFt: PX });
  ok(near(back.rect.x0, 0), 'the other way it stops at the near corner');
  const crushed = trimWallRun(c, { a: 99, b: 99 }, { pxPerFt: PX });
  ok(near(crushed.lengthFt, RUN_TRIM.minLenFt),
    `crushed from both ends it holds at ${RUN_TRIM.minLenFt} ft rather than inverting`);
  ok(crushed.rect.x1 > crushed.rect.x0, 'and never turns inside out');
}
{
  // A vertical run trims down its own axis, not across it.
  const c = one(runV(3, 7, 1));
  const t = trimWallRun(c, { a: 1, b: 1 }, { pxPerFt: PX });
  ok(near(t.lengthFt, c.lengthFt - 2), 'a vertical run shortens by 2 ft off 2 ft of trim');
  ok(near(t.rect.x0, c.rect.x0) && near(t.rect.x1, c.rect.x1),
    'and its eight inches across the wall are untouched');
  ok(t.run.every((q) => near(q.x, c.run[0].x)), 'the tape stays on its own line');
}
{
  // With no scale there is no such thing as a foot of trim.
  const c = one(runH(2, 9, 10));
  const t = trimWallRun(c, { a: 2, b: 0 }, { pxPerFt: null });
  ok(!t.trimmed && near(t.lengthFt, c.lengthFt), 'no scale, no trim — and no crash');
}

console.log('\n-- two full segments either side of a door are one slot --');
{
  // Panelling on both sides of the opening, filling each side. Two segments,
  // both full, and a break in the slot over the door head is a detail nobody
  // would build — so they bridge.
  const both = reverseCovesFor(runH(1, 12, 10), G, { pxPerFt: PX, doors: [DOOR2] })
    .map((c, i) => ({ ...c, elementId: `w-${i}` }));
  ok(both.length === 2 && both.every((c) => c.full), 'two full segments to start with');
  const merged = mergeReverseCoves(both, { pxPerFt: PX });
  ok(merged.length === 1, `bridged into one run: got ${merged.length}`);
  ok(near(merged[0].lengthFt, 12), `spanning the whole wall: ${merged[0].lengthFt} ft`);
  ok(near(merged[0].rect.x0, 0) && near(merged[0].rect.x1, 12 * PX), 'corner to corner');
  ok(merged[0].run[0].x === merged[0].rect.x0 && merged[0].run[1].x === merged[0].rect.x1,
    'and the tape was re-measured with it, not left at the old length');
  ok(merged[0].bridged === 1, 'and it says it was bridged');
}
{
  // ONLY WHEN BOTH ARE FULL. A cove stopping part-way along its own segment is
  // stopping where the panelling stops — a real edge with a reason — and running
  // it on across a door would invent a length neither side asked for.
  const a = reverseCovesFor(runH(1, 7, 10), G, { pxPerFt: PX, doors: [DOOR2] })[0];
  const partial = reverseCovesFor(runH(11, 11, 10), G, { pxPerFt: PX, doors: [DOOR2] })[0];
  ok(a.full && !partial.full, 'one side full, the other a short run in a 2 ft segment');
  const kept = mergeReverseCoves([{ ...a, elementId: 'x' }, { ...partial, elementId: 'y' }],
                                 { pxPerFt: PX });
  ok(kept.length === 2, 'they stay two coves with the opening between them');
}
{
  // A shelf strip is the opposite case and keeps the hard stop: shelving cannot
  // stand in a doorway. It carries no `bounds`, so the clamp falls back to its
  // segment.
  const st = { horizontal: true, rect: { x0: 20, y0: 0, x1: 140, y1: 20 },
               seg: { lo: 0, hi: 140 } };
  const pushed = trimWallRun(st, { a: 0, b: -99 }, { pxPerFt: PX });
  ok(near(pushed.rect.x1, 140), 'a run with no bounds is still held to its segment');
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
