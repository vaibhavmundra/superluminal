// ---------------------------------------------------------------------------
// tools/test-room-booleans.mjs — no two rooms may overlap.
//
// The detector does not know that rooms are disjoint, so this is the pass that
// makes them so. What is worth asserting is not that subtraction "works" — it is
// the four cases that behave differently:
//
//   a corner ensuite      shares two walls -> the bedroom becomes an L
//   an ensuite along one wall              -> the bedroom becomes a U... which
//                                             is a hole, and must be REPORTED
//                                             rather than quietly mangled
//   an ensuite three pixels short of the wall -> snapped, then subtracted, because
//                                             that is a bad outline and not an
//                                             interior room
//   a partial overlap     two masks merged through a doorway -> the larger gives way
//
// and the invariant underneath all of them: whatever happens, the polygons that
// come out do not overlap, and the small room is never the one that loses.
// ---------------------------------------------------------------------------
import { subtractPolygons, disjoin, overlapFraction, mergeCoords, snapToward,
         BOOLEAN_DEFAULTS } from '../src/lib/roomBooleans.js';
import { polygonArea, bbox, pointInPolygon } from '../src/lib/geometry.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const section = (s) => console.log('\n' + s);

const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const area = (p) => Math.abs(polygonArea(p));
const isRectilinear = (p) => p.every((q, i) => {
  const r = p[(i + 1) % p.length];
  return Math.abs(q.x - r.x) < 1e-6 || Math.abs(q.y - r.y) < 1e-6;
});
/** The only invariant that matters: no point of one room is inside another. */
function anyOverlap(polys) {
  for (let i = 0; i < polys.length; i++) {
    for (let j = 0; j < polys.length; j++) {
      if (i === j) continue;
      if (overlapFraction(polys[i], polys[j]) > 0.02) return `${j} sits inside ${i}`;
    }
  }
  return null;
}

section('coordinates');
{
  // Compared against the last coordinate KEPT, not the last seen, so a run of
  // small steps cannot drift a grid line across the plan.
  ok('near-identical coordinates merge into one grid line',
     JSON.stringify(mergeCoords([10, 10.3, 10.6, 40, 40.2], 0.75)) === '[10,40]',
     JSON.stringify(mergeCoords([10, 10.3, 10.6, 40, 40.2], 0.75)));
  ok('...and a long run of small steps cannot drift a line across the plan',
     JSON.stringify(mergeCoords([10, 10.7, 11.4, 12.1], 0.75)) === '[10,11.4]',
     JSON.stringify(mergeCoords([10, 10.7, 11.4, 12.1], 0.75)));
  ok('distinct ones do not', mergeCoords([0, 5, 10], 0.75).length === 3);
  // The step that decides whether the common case works at all.
  const pulled = snapToward(rect(10, 10, 97, 60), rect(0, 0, 100, 100), 5);
  ok('a wall three units short of another is pulled onto it',
     pulled.some((p) => p.x === 100), JSON.stringify(pulled.map((p) => p.x)));
  ok('...and a wall genuinely far from it is left alone',
     pulled.every((p) => p.x !== 0), JSON.stringify(pulled.map((p) => p.x)));
}

section('a corner ensuite — shares two walls, so the bedroom becomes an L');
{
  const bedroom = rect(0, 0, 100, 100);
  const ensuite = rect(60, 60, 100, 100);
  const r = subtractPolygons(bedroom, [ensuite]);
  ok('it subtracts', r.ok, r.reason);
  ok('no hole', r.holes === 0);
  ok('one piece', r.pieces === 1, `${r.pieces}`);
  ok('the area is the bedroom less the ensuite',
     near(area(r.pointsPx), 100 * 100 - 40 * 40, 1), `${area(r.pointsPx)}`);
  ok('the result is an L of six corners', r.pointsPx.length === 6, `${r.pointsPx.length}`);
  ok('...and still rectilinear', isRectilinear(r.pointsPx));
  ok('the ensuite is no longer inside the bedroom',
     !pointInPolygon({ x: 80, y: 80 }, r.pointsPx));
  ok('the rest of the bedroom still is',
     pointInPolygon({ x: 20, y: 20 }, r.pointsPx));
}

section('an ensuite in the middle of one wall — a U, which is fine');
{
  const bedroom = rect(0, 0, 100, 100);
  const ensuite = rect(30, 70, 70, 100);       // touches the bottom wall only
  const r = subtractPolygons(bedroom, [ensuite]);
  ok('it subtracts', r.ok, r.reason);
  ok('no hole', r.holes === 0);
  ok('the area is right', near(area(r.pointsPx), 100 * 100 - 40 * 30, 1), `${area(r.pointsPx)}`);
  ok('the result is a U of eight corners', r.pointsPx.length === 8, `${r.pointsPx.length}`);
}

section('an ensuite wholly inside — an annulus, which must be REPORTED');
{
  const bedroom = rect(0, 0, 100, 100);
  const ensuite = rect(40, 40, 60, 60);
  const r = subtractPolygons(bedroom, [ensuite]);
  ok('it refuses rather than returning a mangled polygon', r.ok === false, JSON.stringify(r).slice(0, 120));
  ok('and says why', r.reason === 'hole', String(r.reason));
  ok('and says how many', r.holes === 1, `${r.holes}`);
  // The caller needs the body ring to be able to show what it found.
  ok('the body ring is still handed back', Array.isArray(r.pointsPx) && r.pointsPx.length >= 4);
}

section('an ensuite three pixels short of the wall — a bad outline, not a room');
{
  const bedroom = rect(0, 0, 100, 100);
  // Short of the right wall by 3 and of the bottom by 2: no wall shared, so
  // without snapping this is an annulus and the whole feature fails on the
  // commonest input there is.
  const ensuite = rect(60, 60, 97, 98);
  const raw = subtractPolygons(bedroom, [ensuite]);
  ok('without snapping it is a hole', raw.ok === false && raw.reason === 'hole', JSON.stringify(raw).slice(0, 90));
  const snapped = subtractPolygons(bedroom, [ensuite], { snapPx: 5 });
  ok('with snapping it subtracts cleanly', snapped.ok === true, snapped.reason);
  ok('...to the bedroom less the ensuite, grown to the walls',
     near(area(snapped.pointsPx), 100 * 100 - 40 * 40, 1), `${area(snapped.pointsPx)}`);
  ok('...as an L', snapped.pointsPx.length === 6, `${snapped.pointsPx.length}`);
}

section('two masks merged through a doorway — the larger gives way');
{
  const big = rect(0, 0, 100, 100);
  const small = rect(80, 30, 140, 70);         // hangs outside, overlaps by a strip
  const out = disjoin([
    { id: 'small', pointsPx: small },
    { id: 'big', pointsPx: big },
  ]);
  const byId = Object.fromEntries(out.map((r) => [r.id, r]));
  ok('both rooms survive', out.length === 2);
  ok('the SMALL room is untouched — it is the one that was right',
     area(byId.small.pointsPx) === area(small),
     `${area(byId.small.pointsPx)} vs ${area(small)}`);
  ok('the large room lost the shared strip',
     near(area(byId.big.pointsPx), 100 * 100 - 20 * 40, 1), `${area(byId.big.pointsPx)}`);
  ok('nothing overlaps any more', anyOverlap(out.map((r) => r.pointsPx)) === null,
     String(anyOverlap(out.map((r) => r.pointsPx))));
  ok('the carve is recorded', byId.big.carved === 1 && /subtracted/.test(byId.big.note), byId.big.note);
}

section('a whole flat, out of order, with one nested room');
{
  const rooms = [
    { id: 'ensuite', pointsPx: rect(300, 300, 400, 400) },      // wholly inside bedroom
    { id: 'bedroom', pointsPx: rect(200, 200, 500, 500) },
    { id: 'kitchen', pointsPx: rect(0, 0, 190, 190) },
    { id: 'hall',    pointsPx: rect(0, 200, 210, 500) },
    { id: 'living',  pointsPx: rect(200, 0, 500, 190) },
  ];
  const out = disjoin(rooms, { snapPx: 6 });
  const byId = Object.fromEntries(out.map((r) => [r.id, r]));
  ok('every room comes back', out.length === 5);
  ok('the rooms that never overlapped are untouched',
     area(byId.kitchen.pointsPx) === 190 * 190 && area(byId.living.pointsPx) === 300 * 190
     && area(byId.hall.pointsPx) === 210 * 300);
  ok('the ensuite is untouched', area(byId.ensuite.pointsPx) === 100 * 100);
  // It could not be subtracted, so it has to be REPORTED — this is the field
  // App.jsx turns into a no-light zone.
  // The hall overlaps the bedroom by a strip and the ensuite sits inside it.
  // The strip must be subtracted and only the ensuite reported — reporting both
  // would put a no-light zone over the hall, which is not inside this room.
  ok('the bedroom reports ONLY the room genuinely inside it',
     byId.bedroom.enclosing?.length === 1, JSON.stringify(byId.bedroom.note));
  ok('...and the overlapping hall was subtracted, not reported',
     byId.bedroom.carved === 1, JSON.stringify(byId.bedroom.note));
  ok('...in words', /wholly inside/.test(byId.bedroom.note || ''), byId.bedroom.note);
  ok('and its polygon lost the hall strip but kept the ensuite',
     near(area(byId.bedroom.pointsPx), 300 * 300 - 10 * 300, 1),
     `${area(byId.bedroom.pointsPx)}`);
}

section('the invariant: disjoin never makes things worse');
{
  // Every arrangement of three boxes on a 3x3 lattice, subtracted, checked.
  let cases = 0, overlaps = 0, lost = 0;
  for (let a = 0; a < 3; a++) {
    for (let b = 0; b < 3; b++) {
      for (let c = 0; c < 3; c++) {
        const rooms = [
          { id: 'a', pointsPx: rect(a * 30, a * 30, a * 30 + 120, a * 30 + 90) },
          { id: 'b', pointsPx: rect(b * 40 + 20, b * 25, b * 40 + 110, b * 25 + 140) },
          { id: 'c', pointsPx: rect(c * 20 + 50, c * 45 + 10, c * 20 + 100, c * 45 + 60) },
        ];
        // As the caller sees them: a dropped room is not on the plan.
        const out = disjoin(rooms, { snapPx: 4 }).filter((r) => !r.dropped);
        cases++;
        // Anything still overlapping must be a reported enclosure, never silent.
        const bad = anyOverlap(out.map((r) => r.pointsPx));
        if (bad && !out.some((r) => r.enclosing)) overlaps++;
        // The smallest surviving room must never shrink: it is the one that was
        // right, and a subtraction that eats it has the sign backwards.
        if (out.length) {
          const smallest = out.reduce((m, r) => (area(r.pointsPx) < area(m.pointsPx) ? r : m));
          const orig = rooms.find((r) => r.id === smallest.id);
          if (area(smallest.pointsPx) < area(orig.pointsPx) - 1) lost++;
        }
      }
    }
  }
  ok(`no silent overlap in any of ${cases} arrangements`, overlaps === 0, `${overlaps} silent`);
  ok('the smallest surviving room never shrinks', lost === 0, `${lost} shrank`);
}

section('a room other rooms almost entirely cover is DROPPED, not kept overlapping');
{
  const out = disjoin([
    { id: 'big', pointsPx: rect(0, 0, 100, 100) },
    { id: 'left', pointsPx: rect(0, 0, 55, 100) },
    { id: 'right', pointsPx: rect(50, 0, 100, 100) },
  ], { snapPx: 4 });
  const big = out.find((r) => r.id === 'big');
  ok('the room that was really two rooms is dropped', big.dropped === true, JSON.stringify(big.note));
  ok('and says why', /covered/.test(big.note), big.note);
  ok('the two real rooms survive', out.filter((r) => !r.dropped).length === 2);
  ok('and they do not overlap each other',
     anyOverlap(out.filter((r) => !r.dropped).map((r) => r.pointsPx)) === null);
}

section('refusals');
{
  ok('nothing to subtract returns the outer unchanged',
     subtractPolygons(rect(0, 0, 10, 10), []).pointsPx.length === 4);
  ok('an outer that is not a polygon is refused',
     subtractPolygons([{ x: 0, y: 0 }], [rect(0, 0, 1, 1)]).ok === false);
  ok('subtracting the whole room leaves nothing, and says so',
     subtractPolygons(rect(0, 0, 10, 10), [rect(-1, -1, 11, 11)]).ok === false);
  ok('disjoin on one room is a no-op', disjoin([{ id: 'x', pointsPx: rect(0, 0, 5, 5) }]).length === 1);
  ok('disjoin on none is empty', disjoin([]).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
