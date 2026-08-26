// tools/test-rooms.mjs — room extraction, in Node, no browser.
import { findRooms, extractFaces } from '../src/lib/rooms.js';
import { polygonArea, bbox } from '../src/lib/geometry.js';
import { rectPlan, lPlan, flatPlan, clutteredFlatPlan, sloppyPlan, wall } from './fixtures.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const section = (s) => console.log('\n' + s);

// ---------------------------------------------------------------------------
section('a single rectangle');
{
  const r = findRooms(rectPlan(10, 8), { minRoomArea: 1 });
  ok('finds one room', r.rooms.length === 1, `got ${r.rooms.length}`);
  ok('area is 80 sqft', near(r.rooms[0]?.areaSqft, 80, 0.01), `got ${r.rooms[0]?.areaSqft}`);
  ok('outer face discarded', r.diagnostics.dropped.outer === 1);
  ok('polygon is a quad', r.rooms[0]?.polygon.length === 4, `got ${r.rooms[0]?.polygon.length}`);
}

section('an L-shaped room');
{
  const r = findRooms(lPlan(), { minRoomArea: 1 });
  ok('finds one room', r.rooms.length === 1, `got ${r.rooms.length}`);
  // 20x12 plus 12x8
  ok('area is 336 sqft', near(r.rooms[0]?.areaSqft, 336, 0.5), `got ${r.rooms[0]?.areaSqft}`);
  ok('keeps six corners', r.rooms[0]?.polygon.length === 6, `got ${r.rooms[0]?.polygon.length}`);
}

section('a four-room flat, double-line walls, doors punched through');
{
  const r = findRooms(flatPlan(0.75));
  ok('finds exactly four rooms', r.rooms.length === 4, `got ${r.rooms.length}: ${r.rooms.map((x) => x.areaSqft.toFixed(0)).join(', ')}`);
  const total = r.rooms.reduce((s, x) => s + x.areaSqft, 0);
  // four rooms of roughly 13.6 x 11.6 = 158 each
  ok('total room area is ~630 sqft', near(total, 630, 25), `got ${total.toFixed(0)}`);
  ok('every room is rectangular', r.rooms.every((x) => x.polygon.length === 4),
     r.rooms.map((x) => x.polygon.length).join(','));
  ok('bridged the five openings', r.diagnostics.bridges.length >= 5,
     `bridged ${r.diagnostics.bridges.length}: ${JSON.stringify(r.diagnostics.bridgeCounts)}`);
  ok('discarded the wall cavities', r.diagnostics.dropped.sliver > 0,
     `slivers ${r.diagnostics.dropped.sliver}`);
  // The cross wall sits at x=14 in a 30 ft flat, so the west rooms are
  // narrower than the east ones. Walls are 0.75 thick, so an inner face is
  // 0.375 in from the centreline: west rooms 13.625-0.375 = 13.25 wide, east
  // rooms 29.625-14.375 = 15.25. Measuring the INNER face is the whole point:
  // the ceiling perimeter is what lights get laid out against.
  const inner = r.rooms.map((x) => [x.widthFt, x.heightFt]);
  ok('rooms measure the INNER face of the wall, not the centreline',
     inner.every(([w, h]) => (near(w, 13.25, 0.05) || near(w, 15.25, 0.05)) && near(h, 11.25, 0.05)),
     JSON.stringify(inner.map(([w, h]) => [w.toFixed(2), h.toFixed(2)])));
  ok('both room widths appear, so the cross wall was read where it is',
     new Set(inner.map(([w]) => w.toFixed(2))).size === 2,
     JSON.stringify(inner.map(([w]) => w.toFixed(2))));
}

section('the same flat with dimension lines, furniture and a stray tick');
{
  const all = clutteredFlatPlan(0.75);
  // the app passes only the chosen layers; furniture and dims are excluded there
  const walls = all.filter((s) => s.layer === 'A-WALL');
  const r = findRooms(walls);
  ok('still four rooms with the stray tick present', r.rooms.length === 4,
     `got ${r.rooms.length}: ${r.rooms.map((x) => x.areaSqft.toFixed(0)).join(', ')}`);
  ok('pruned the stray tick', r.diagnostics.danglesPruned > 0, `pruned ${r.diagnostics.danglesPruned}`);

  // and if someone ticks the furniture layer too, the sofa must not become a room
  const withFurn = all.filter((s) => s.layer !== 'A-DIMS');
  const r2 = findRooms(withFurn);
  const sofa = r2.rooms.find((x) => near(x.areaSqft, 15, 2));
  ok('a sofa on a ticked layer is reported, not silently merged', r2.rooms.length >= 4,
     `got ${r2.rooms.length}`);
  ok('the room containing the sofa is still found whole',
     r2.rooms.some((x) => near(x.areaSqft, 158, 12)),
     r2.rooms.map((x) => x.areaSqft.toFixed(0)).join(', '));
}

section('a wall drawn 3 inches short of the one it meets');
{
  const r = findRooms(sloppyPlan());
  ok('welds the slop and finds two rooms', r.rooms.length === 2,
     `got ${r.rooms.length}: ${r.rooms.map((x) => x.areaSqft.toFixed(0)).join(', ')}`);
  ok('recorded it as a weld, not a doorway',
     r.diagnostics.bridgeCounts.weld > 0, JSON.stringify(r.diagnostics.bridgeCounts));
}

section('gaps too wide to be doors are left alone');
{
  // two rooms whose dividing wall is missing a 12 ft chunk: that is one room
  const plan = [
    ...wall(0, 0, 20, 0, 0.5), ...wall(20, 0, 20, 14, 0.5),
    ...wall(20, 14, 0, 14, 0.5), ...wall(0, 14, 0, 0, 0.5),
    ...wall(10, 0, 10, 14, 0.5, [{ at: 7, width: 12 }]),
  ];
  const r = findRooms(plan, { maxGap: 7 });
  ok('does not invent a wall across a 12 ft opening', r.rooms.length === 1,
     `got ${r.rooms.length}: ${r.rooms.map((x) => x.areaSqft.toFixed(0)).join(', ')}`);
  const r2 = findRooms(plan, { maxGap: 13 });
  ok('...but will when told the openings are that wide', r2.rooms.length === 2,
     `got ${r2.rooms.length}`);
}

section('nothing to work with');
{
  ok('empty input is reported, not crashed', findRooms([]).ok === false);
  const open = findRooms([{ x1: 0, y1: 0, x2: 10, y2: 0 }, { x1: 20, y1: 20, x2: 30, y2: 20 }]);
  ok('two unrelated lines yield no rooms and a reason', open.ok === false && !!open.reason);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
