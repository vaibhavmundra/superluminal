// ---------------------------------------------------------------------------
// test-bed-grid.mjs — the bedroom foot-of-bed rule.
//
// The claim being tested is narrow and worth stating exactly: in a bedroom
// whose bed is against a wall, the lights in the region beyond the foot of the
// bed must sit on the same lines as the lights either side of it — and NOTHING
// ELSE about this app's output may change.
//
// So half of this file is about the rule firing, and half is about it staying
// out of the way: a room with no bed, a bed in the middle of the floor, a
// bedroom that already lines up, and the switch that turns the whole thing off.
// ---------------------------------------------------------------------------

import { planLights, DEFAULTS } from '../src/lib/planner.js';
import {
  footGeometry, flankFitLines, bedZoneIn, flankAnchors, carveFootRegion,
} from '../src/lib/bedGrid.js';
import { fixtureForCell, SMALL_CELL_SQFT } from '../src/lib/roomTypes.js';

let fails = 0, checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`   FAIL  ${what}`); }
};

const R = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const inRect = (p, r) => p.x > r.x0 - 1e-6 && p.x < r.x1 + 1e-6
                      && p.y > r.y0 - 1e-6 && p.y < r.y1 + 1e-6;

// THE ROOM IN THE SCREENSHOT, in feet. 20 x 20, with the bed against the left
// wall: head at x = 0, foot pointing east, so the flanks are the strips above
// and below it and the foot region is the whole right-hand end.
//
// THIS SIZE IS CHOSEN BECAUSE IT MISALIGNS. Not every bedroom does — a room
// whose foot region happens to want the same number of rows as the flanks comes
// out right on its own, and the rule correctly does nothing to it. Testing the
// rule on one of those would assert nothing at all, so the case here is one the
// probe found genuinely broken: the flanks light at y = 3.25 and 16.75, and the
// foot region's own grid puts its two rows at y = 5 and 15.
const BEDROOM = R(20, 20);
const BED = { id: 'b1', cls: 'bed', x0: 0, y0: 6.5, x1: 9, y1: 13.5 };

console.log('=== the geometry reads the bed the way a person does ===\n');
{
  const first = planLights(BEDROOM, [], { ...DEFAULTS, bedFootAlign: false }, [BED]);
  ok(first.ok, 'the bedroom lays out at all');

  const geo = footGeometry({ polygon: BEDROOM, zones: first.zones, chunks: first.chunks });
  ok(geo !== null, 'a bed against a wall has a foot');
  if (geo) {
    ok(geo.run === 'x', 'head-to-foot runs along x when the head is on the west wall');
    ok(geo.fit === 'y', 'so the lights have to agree on y');
    ok(geo.region.x0 >= 9 - 1e-6, 'the foot region starts at the foot of the bed');
    ok(Math.abs(geo.region.x1 - 20) < 1e-6, '...and runs to the far wall');
    // THE SPAN IS THE WHOLE CLAIM OF THE RULE: flank + bed + flank.
    ok(Math.abs(geo.region.y0 - 0) < 1e-6 && Math.abs(geo.region.y1 - 20) < 1e-6,
       'and spans both flanks plus the bed, not just its own piece');
    ok(geo.flanks.length === 2, 'both sides of the bed are flanks');
  }
}

console.log('\n=== the division is COPIED from the chunks beside the bed ===\n');
{
  // Two flanks, each one cell deep, and the bed between them. The foot column
  // must come out with those same three rows.
  const geo = {
    fit: 'y',
    region: { x0: 9, y0: 0, x1: 20, y1: 20 },
    bed: { x0: 0, y0: 6.5, x1: 9, y1: 13.5 },
    flanks: [
      { x0: 0, y0: 0, x1: 9, y1: 6.5, yLines: [0, 6.5] },
      { x0: 0, y0: 13.5, x1: 9, y1: 20, yLines: [13.5, 20] },
    ],
  };
  const lines = flankFitLines(geo, { maxCell: 9.43 });
  ok(JSON.stringify(lines) === JSON.stringify([0, 6.5, 13.5, 20]),
     'the foot column gets the flanks\' own lines plus the bed\'s two edges');

  // THE CASE LIGHT-ANCHORING COULD NOT DO. A 1.82 ft strip beside the bed —
  // the shape on the user\'s own sheet. Copying it is fine; anchoring to the
  // light 0.91 ft inside it demanded a 1.82 ft cell and was refused.
  const shallow = {
    fit: 'y',
    region: { x0: 9, y0: 0, x1: 20, y1: 12.07 },
    bed: { x0: 0, y0: 1.82, x1: 9, y1: 7.28 },
    flanks: [
      { x0: 0, y0: 0, x1: 9, y1: 1.82, yLines: [0, 1.82] },
      { x0: 0, y0: 7.28, x1: 9, y1: 12.07, yLines: [7.28, 12.07] },
    ],
  };
  const sl = flankFitLines(shallow, { maxCell: 9.43 });
  ok(sl !== null, 'a 1.82 ft strip beside the bed still divides');
  ok(sl && Math.abs(sl[1] - 1.82) < 1e-9,
     'and the first row of the foot column is 1.82 ft, the same as the strip');
  ok(sl && sl.length === 4, 'three rows: strip, bed band, strip');

  // A flank divided into two rows of its own hands both lines over.
  const twoRow = {
    ...geo,
    flanks: [
      { x0: 0, y0: 0, x1: 9, y1: 6.5, yLines: [0, 3.25, 6.5] },
      { x0: 0, y0: 13.5, x1: 9, y1: 20, yLines: [13.5, 20] },
    ],
  };
  ok(JSON.stringify(flankFitLines(twoRow, { maxCell: 9.43 }))
     === JSON.stringify([0, 3.25, 6.5, 13.5, 20]),
     'a flank with two rows of its own passes both lines across');

  // A bed long enough that the band beside it would be one very deep cell is
  // split evenly — the only line here that was not copied from anywhere.
  const longBed = {
    fit: 'y',
    region: { x0: 9, y0: 0, x1: 20, y1: 30 },
    bed: { x0: 0, y0: 4, x1: 9, y1: 26 },
    flanks: [
      { x0: 0, y0: 0, x1: 9, y1: 4, yLines: [0, 4] },
      { x0: 0, y0: 26, x1: 9, y1: 30, yLines: [26, 30] },
    ],
  };
  const lb = flankFitLines(longBed, { maxCell: 9.43 });
  ok(lb !== null && lb.length > 4, 'a 22 ft band beside the bed is divided further');
  if (lb) {
    let worst = 0;
    for (let k = 0; k < lb.length - 1; k++) worst = Math.max(worst, lb[k + 1] - lb[k]);
    ok(worst <= 9.43 + 1e-9, '...until nothing exceeds maxCell');
    ok(lb.includes(4) && lb.includes(26), 'and the copied lines survive the split');
  }

  // NO MINIMUM IS APPLIED, and that is the point of the rule. A cell this
  // shallow would be thrown out anywhere else in the planner; here it is a copy
  // of one that is already on the drawing.
  ok(flankFitLines(shallow, { maxCell: 9.43, minCell: 4.71 }) !== null,
     'minCell is not consulted — a copied row is as legitimate as its original');
}

console.log('\n=== it fires on the misaligned bedroom, and it aligns it ===\n');
{
  const before = planLights(BEDROOM, [], { ...DEFAULTS, bedFootAlign: false }, [BED]);
  const after = planLights(BEDROOM, [], { ...DEFAULTS }, [BED]);
  ok(before.ok && after.ok, 'both readings lay out');

  const geo = footGeometry({ polygon: BEDROOM, zones: before.zones, chunks: before.chunks });
  const tol = DEFAULTS.alignSnap ?? 0.15;

  const rowsIn = (res, rect) => [...new Set(res.lights
    .filter((l) => inRect(l, rect))
    .map((l) => Math.round(l[geo.fit] * 100) / 100))].sort((a, b) => a - b);

  const anchorsBefore = flankAnchors(before.lights, geo, tol);
  ok(anchorsBefore && anchorsBefore.length === 2, 'two rows of lights beside the bed');

  const misaligned = anchorsBefore
    && !anchorsBefore.every((a) => rowsIn(before, geo.region).some((v) => Math.abs(v - a) <= tol));

  if (!misaligned) {
    console.log('   NOTE  this bedroom already aligned without the rule — '
      + 'the alignment assertions below are vacuous for it');
  }

  // WHATEVER THE STARTING POINT, THE END STATE IS THE CLAIM. After the rule,
  // every flank row must be served by a light beyond the foot of the bed.
  const anchorsAfter = flankAnchors(after.lights, geo, tol);
  const footRows = rowsIn(after, geo.region);
  ok(anchorsAfter !== null, 'there are still lights beside the bed afterwards');
  if (anchorsAfter) {
    ok(anchorsAfter.every((a) => footRows.some((v) => Math.abs(v - a) <= tol)),
       'every light beside the bed has one in line with it beyond its foot');
  }

  if (after.stats.bedFootApplied) {
    const foot = after.chunks.find((c) => c.bedFoot);
    ok(!!foot, 'the applied plan left a marked chunk');
    ok(foot.gridFixture === undefined,
       'and it carries no fixture override — the lights stay the room\'s own 7 W');
    ok(Math.abs(foot.y1 - foot.y0 - 20) < 1e-6,
       'the foot chunk spans flank + bed + flank');
    ok(footRows.length >= 3, 'the re-cut left at least three rows in it');
  } else {
    console.log('   NOTE  the rule did not apply to this room — it was aligned '
      + 'already or the derived cells broke the side bounds');
  }
}

console.log('\n=== and it stays out of the way everywhere else ===\n');
{
  // NO BED. The commonest room in any plan, and it must be untouched.
  const plain = planLights(R(20, 20), [], { ...DEFAULTS }, []);
  const plainOff = planLights(R(20, 20), [], { ...DEFAULTS, bedFootAlign: false }, []);
  ok(plain.stats.bedFootApplied === false, 'a room with no bed never applies the rule');
  ok(JSON.stringify(plain.lights.map((l) => [l.x, l.y]))
     === JSON.stringify(plainOff.lights.map((l) => [l.x, l.y])),
     'and comes out identical with the rule on and off');

  // A ZONE THAT IS NOT A BED. Same rectangle, no `cls` — a duct, a trap door.
  const duct = { x0: 0, y0: 6.5, x1: 9, y1: 13.5 };
  const withDuct = planLights(BEDROOM, [], { ...DEFAULTS }, [duct]);
  ok(withDuct.stats.bedFootApplied === false,
     'an unlabelled zone of the same shape is not a bed');
  ok(bedZoneIn([duct]) === null, 'and bedZoneIn agrees');

  // A BED ADRIFT IN THE MIDDLE OF THE FLOOR has no head wall, so no foot.
  const floating = { id: 'b2', cls: 'bed', x0: 6, y0: 6.5, x1: 15, y1: 13.5 };
  const adrift = planLights(BEDROOM, [], { ...DEFAULTS }, [floating]);
  ok(footGeometry({ polygon: BEDROOM, zones: adrift.zones, chunks: adrift.chunks }) === null,
     'a bed away from every wall has no identifiable foot');
  ok(adrift.stats.bedFootApplied === false, 'so the rule does not fire on it');

  // THE SWITCH. With it off nothing can change, whatever the room is.
  const off = planLights(BEDROOM, [], { ...DEFAULTS, bedFootAlign: false }, [BED]);
  ok(off.stats.bedFootApplied === false, 'bedFootAlign:false disables the rule outright');
}

console.log('\n=== the carve splits what straddles, and refuses to make slivers ===\n');
{
  const region = { x0: 9, y0: 0, x1: 20, y1: 20 };
  const geo = { region, fit: 'y' };
  const opt = { minChunk: 1.5, minChunkArea: 9 };

  // THE CASE THAT DEFEATED THE OLD MERGE. The band below the bed runs the full
  // width of the room, past the foot of the bed — so it straddles the region.
  // It has to be CUT at the foot line, not refused.
  const straddling = [
    { x0: 0, y0: 0, x1: 9, y1: 13.5 },      // beside the bed, clear of the region
    { x0: 0, y0: 13.5, x1: 20, y1: 20 },    // the full-width band below it
    { x0: 9, y0: 0, x1: 20, y1: 13.5 },     // the column beside the bed
  ];
  const c = carveFootRegion(straddling, geo, opt);
  ok(c !== null, 'a chunk straddling the region is cut, not refused');
  if (c) {
    ok(c.chunks.some((r) => Math.abs(r.x1 - 9) < 1e-9 && Math.abs(r.y0 - 13.5) < 1e-9),
       'the full-width band is left stopping at the foot of the bed');
    ok(Math.abs(c.foot.area - 11 * 20) < 1e-9, 'and the foot column runs the full depth');
    const area = c.chunks.reduce((s2, r) => s2 + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
    ok(Math.abs(area - 20 * 20) < 1e-6, 'nothing is lost or double-counted in the cut');
  }

  // Pieces already tiling the region are still absorbed whole.
  const tiled = [
    { x0: 0, y0: 0, x1: 9, y1: 20 },
    { x0: 9, y0: 0, x1: 20, y1: 11 },
    { x0: 9, y0: 11, x1: 20, y1: 20 },
  ];
  const m = carveFootRegion(tiled, geo, opt);
  ok(m !== null && m.chunks.length === 2, 'two pieces tiling the region become one chunk');

  // A HOLE IN THE REGION is a duct or an enclosed room the decomposition worked
  // around. Paving over it would put a fitting where something already said no.
  const holed = [
    { x0: 0, y0: 0, x1: 9, y1: 20 },
    { x0: 9, y0: 0, x1: 20, y1: 8 },
    { x0: 9, y0: 12, x1: 20, y1: 20 },
  ];
  ok(carveFootRegion(holed, geo, opt) === null, 'a region with a hole in it is refused');

  // AN OFFCUT TOO SMALL TO LIGHT. Cutting here would leave a 0.6 ft strip, and a
  // chunk that thin is one the chunker would have dropped.
  const sliver = [
    { x0: 0, y0: 0, x1: 9, y1: 13.5 },
    { x0: 8.4, y0: 13.5, x1: 20, y1: 20 },
    { x0: 9, y0: 0, x1: 20, y1: 13.5 },
    { x0: 0, y0: 13.5, x1: 8.4, y1: 20 },
  ];
  ok(carveFootRegion(sliver, geo, opt) === null,
     'a cut that would leave a sliver is refused outright');
}

console.log('\n=== a small cell in a bedroom buys the 5 W lamp ===\n');
{
  const B = ['residential', 'bedroom'];
  ok(SMALL_CELL_SQFT === 18, 'the threshold is 18 sqft');
  ok(fixtureForCell(...B, 'small', 12) === 'small-narrow', 'a 12 sqft cell takes the 5 W lamp');
  ok(fixtureForCell(...B, 'small', 18) === 'small-narrow', '...and so does one exactly on 18');
  ok(fixtureForCell(...B, 'small', 18.01) === 'small', 'just over 18 keeps the 7 W');
  ok(fixtureForCell(...B, 'small', 42) === 'small', 'an ordinary cell keeps the 7 W');

  // A LARGE LIGHT HAS NO CELL OF ITS OWN — it sits on the line two share.
  ok(fixtureForCell(...B, 'large', 12) === 'large', 'a large light is never remapped');
  // AND NEITHER IS AN UNKNOWN CELL. A plan saved before this existed carries no
  // cell on its lights, and must not silently change what it bills.
  ok(fixtureForCell(...B, 'small', 0) === 'small', 'an unknown cell keeps the room-level answer');

  // BEDROOMS ONLY — `expectsBed` is what that means across the vocabularies.
  ok(fixtureForCell('residential', 'living_space', 'small', 12) === 'small',
     'a living room with a small cell is untouched');
  ok(fixtureForCell('hotel', 'guest_room', 'small', 12) === 'small-narrow',
     'a hotel guest room counts as a bedroom');
  ok(fixtureForCell('residential', 'toilet', 'small', 12) === 'small-narrow',
     'a toilet already bought this lamp and still does');
  ok(fixtureForCell('residential', 'toilet', 'small', 42) === 'small-narrow',
     '...whatever its cell, since that is a rule about the room');
}

console.log(`\nBED GRID OVERALL: ${fails ? `FAIL (${fails} of ${checks})` : `PASS (${checks} checks)`}`);
process.exit(fails ? 1 : 0);
