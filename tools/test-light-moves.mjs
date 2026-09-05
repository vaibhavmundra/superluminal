// ---------------------------------------------------------------------------
// test-light-moves.mjs — moving one light by hand, inside the freedom the grid
// already allows.
//
// Four claims, and every assertion below belongs to one of them:
//
//   1. THE BAND IS THE CELL'S, NOT A DISTANCE. A small light may sit within
//      `centreBand` of its own cell centre — a FRACTION, so the box is bigger
//      in a bigger cell — and nothing may put it outside that box.
//   2. THE CLAMP OBEYS EVERY OTHER RULE TOO. Inside its band a light is still
//      subject to the room outline, the fans, the no-light zones, the cove dead
//      band and the spacing off a large light. It clamps and walks back rather
//      than refusing, so a drag never simply stops responding.
//   3. A HAND POSITION IS HONOURED, AND IT ANCHORS ITS ROW. The alignment pass
//      forms up ON a hand-moved light instead of dragging it back into line —
//      which is what makes moving one light tidy its neighbours.
//   4. IT IS NAMED BY ITS CELL. An offset survives a re-layout of the same
//      room and is DROPPED when the grid is re-cut, because a hand position
//      inherited by a different piece of ceiling is a light nobody moved.
//
//   node tools/test-light-moves.mjs
// ---------------------------------------------------------------------------

import { planLights, cellKey, centreBandBox, clampLightMove, resolveOptions }
  from '../src/lib/planner.js';
import { PLAN_OPTIONS } from '../src/lib/settings.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const say = (t) => console.log('\n' + t);
const opt = PLAN_OPTIONS;
const box = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

/** The small light nearest a point, and the cell it serves. */
const smallNear = (res, p) => res.lights
  .filter((l) => l.kind === 'small' && l.cell)
  .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];

const inBand = (l, o = opt) => {
  const b = centreBandBox(l.cell, o);
  return l.x >= b.x0 - 1e-9 && l.x <= b.x1 + 1e-9
      && l.y >= b.y0 - 1e-9 && l.y <= b.y1 + 1e-9;
};

// --- 1. the band ------------------------------------------------------------
say('1. the band is a fraction of the cell, not a distance in feet');
{
  const o = resolveOptions({ ...opt });
  const wide = { cx: 10, cy: 10, w: 9, h: 6, x0: 5.5, y0: 7, x1: 14.5, y1: 13 };
  const b = centreBandBox(wide, o);
  ok(near(b.x1 - b.x0, 9 * 2 * o.centreBand) && near(b.y1 - b.y0, 6 * 2 * o.centreBand),
    `a ${wide.w}x${wide.h} cell allows ±${(o.centreBand * 100).toFixed(0)}% on each axis`);
  ok(near((b.x0 + b.x1) / 2, wide.cx) && near((b.y0 + b.y1) / 2, wide.cy),
    '...measured from the cell centre, which is what an offset is stored against');

  const small = { cx: 0, cy: 0, w: 5, h: 5, x0: -2.5, y0: -2.5, x1: 2.5, y1: 2.5 };
  ok((centreBandBox(small, o).x1 - centreBandBox(small, o).x0)
     < (b.x1 - b.x0),
    'a smaller cell allows less — the freedom scales with the grid');

  const far = clampLightMove(wide, { x: 99, y: 99 }, { options: opt });
  ok(near(far.x, b.x1) && near(far.y, b.y1),
    'a drag past the edge lands ON the edge rather than being refused');
  const inside = clampLightMove(wide, { x: 10.4, y: 9.6 }, { options: opt });
  ok(near(inside.x, 10.4) && near(inside.y, 9.6),
    '...and one inside the band lands exactly where it was asked for');
}

// --- 2. the other rules -----------------------------------------------------
say('2. inside its band a light still obeys everything else');
{
  const cell = { cx: 10, cy: 10, w: 8, h: 8, x0: 6, y0: 6, x1: 14, y1: 14 };
  const b = centreBandBox(cell, resolveOptions({ ...opt }));

  // A FAN just outside the band's right edge. The clamp has to walk back until
  // it is `fanClearance` clear of the blade circle.
  const fan = { type: 'fan', x: b.x1 + 0.5, y: 10, r: 0.5, shape: 'circle' };
  const p = clampLightMove(cell, { x: 99, y: 10 },
    { fans: [fan], options: opt });
  const d = Math.hypot(p.x - fan.x, p.y - fan.y) - fan.r;
  ok(d >= opt.fanClearance - 1e-6,
    'it stops a fan clearance short of the blades instead of landing on them');
  ok(p.x < b.x1 && p.x > cell.cx,
    '...and it does not simply give up and sit back at the cell centre');

  // A NO-LIGHT ZONE over the right half of the band.
  const zoned = clampLightMove(cell, { x: 99, y: 10 },
    { zones: [{ x0: cell.cx + 0.4, y0: 0, x1: 99, y1: 99 }], options: opt });
  ok(zoned.x <= cell.cx + 0.4 + 1e-6,
    'a no-light zone stops it at the zone edge, not inside it');

  // THE COVE'S DEAD BAND. `coveInside` feet of clear ceiling either side of the
  // line is a rule about where a fitting may sit, so a drag has to respect it.
  const line = { x0: -99, y0: -99, x1: cell.cx + 0.5 + opt.coveInside, y1: 99 };
  const coved = clampLightMove(cell, { x: 99, y: 10 },
    { options: { ...opt, coves: [line] } });
  ok(coved.x <= cell.cx + 0.5 + 1e-6,
    'and so is the dead band inside a cove line — no lamp in the pocket');

  // SPACING, and only off a LARGE light: two small ones are spaced by the grid
  // that made their cells, which is the distinction `spacingOK` draws.
  // Far enough out that the cell CENTRE is legal — the clamp walks back along
  // the segment from the centre, so a centre that is itself crowded means the
  // light has nowhere to go and the drag correctly does nothing.
  const big = { kind: 'large', x: cell.cx + opt.minLightSpacing + 0.6, y: 10 };
  const spaced = clampLightMove(cell, { x: 99, y: 10 },
    { others: [big], options: opt });
  ok(Math.hypot(spaced.x - big.x, spaced.y - big.y) >= opt.minLightSpacing - 1e-6,
    'it keeps minLightSpacing off a large light');
  const crowd = clampLightMove(cell, { x: 99, y: 10 },
    { others: [{ kind: 'small', x: b.x1, y: 10 }], options: opt });
  ok(near(crowd.x, b.x1),
    '...and does not police the distance to another small light, which the grid owns');

  const outside = clampLightMove(cell, { x: 99, y: 10 },
    { polygon: box(cell.cx + 0.3, 99), options: opt });
  ok(outside.x <= cell.cx + 0.3 + 1e-6, 'and it cannot leave the room');
}

// --- 3 and 4. through the layout -------------------------------------------
const room = box(30, 22);
const lay = (handMoves) => planLights(room, [], { ...opt, handMoves }, []);

say('3. a hand position is honoured, and the row forms up on it');
{
  const base = lay(null);
  ok(base.ok, 'the room lays out');
  const l = smallNear(base, { x: 15, y: 11 });
  ok(!!l, 'and there is a small light near the middle to move');

  const b = centreBandBox(l.cell, resolveOptions({ ...opt }));
  // Ask for a corner of its own band, which is a legal but distinctly
  // off-centre place — the sort of thing somebody drags to.
  const want = { dx: b.x1 - l.cell.cx, dy: b.y1 - l.cell.cy };
  const moved = lay({ [cellKey(l.cell)]: want });
  const m = moved.lights.find((q) => q.cell && cellKey(q.cell) === cellKey(l.cell));

  ok(!!m && m.hand === true, 'the light comes back marked as hand-placed');
  ok(near(m.x, l.cell.cx + want.dx, 1e-6) && near(m.y, l.cell.cy + want.dy, 1e-6),
    '...sitting exactly where it was put, not where the alignment pass prefers');
  ok(inBand(m), '...and inside its own band, which is the whole guarantee');

  // THE ANCHOR CLAIM. isForced() makes a hand-moved light the line its row
  // takes, so nothing may drag it back and its neighbours may come to it.
  ok(moved.lights.every((q) => !q.hand || inBand(q)),
    'every hand-placed light in the layout is inside its own band');
  const others = moved.lights.filter((q) => q.kind === 'small' && q !== m);
  ok(others.every((q) => inBand(q)),
    '...and so is every light the pass moved to line up with it');

  // AN OFFSET THE BAND CANNOT TAKE IS CLAMPED, not obeyed. The store can hold a
  // stale figure — the grid may have been re-cut under it — so the layout, not
  // the drag, has the last word.
  const silly = lay({ [cellKey(l.cell)]: { dx: 40, dy: 40 } });
  const sm = silly.lights.find((q) => q.cell && cellKey(q.cell) === cellKey(l.cell));
  ok(sm && inBand(sm),
    'an offset bigger than the band is clamped by the layout, not taken on trust');

  ok(base.stats.unserved === 0 && moved.stats.unserved === 0,
    'moving a light lights the same ceiling — no cell goes unserved');
  ok(base.lights.length === moved.lights.length,
    '...and the same number of fittings comes out');
}

say('4. an offset is named by its cell, so a re-cut grid drops it');
{
  const base = lay(null);
  const l = smallNear(base, { x: 15, y: 11 });
  const key = cellKey(l.cell);
  const moves = { [key]: { dx: 0.9, dy: 0 } };

  const again = lay(moves);
  const m = again.lights.find((q) => q.cell && cellKey(q.cell) === key);
  ok(m && near(m.x, l.cell.cx + 0.9, 1e-6),
    'the same room laid out again puts the light back where it was left');

  // A DIFFERENT GRID. Denser cells means different rectangles, so no cell
  // answers to the old name and the offset simply lapses.
  const denser = planLights(room, [], { ...opt, targetArea: 25, handMoves: moves }, []);
  ok(denser.ok, 'a denser grid still lays out');
  ok(!denser.lights.some((q) => q.cell && cellKey(q.cell) === key),
    '...and no cell of the old name survives it');
  ok(denser.lights.every((q) => !q.hand),
    'so nothing is hand-placed: the offset lapsed rather than moving another lamp');
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
