// ---------------------------------------------------------------------------
// tools/test-rooms-detect.mjs — the room detector's answer, from wire to layout.
//
// The network is not here and does not need to be: everything between "the
// workflow replied" and "the plan is lit" is pure. What this proves is the two
// things that break silently.
//
//   THE ARITHMETIC. The model answers in the pixel space of the image it was
//   sent, which is smaller than the file the user uploaded. Get the rescale
//   wrong and the rooms land in the top-left quarter of the plan — a failure
//   that looks like a bad model and is bad division.
//
//   THE HANDOFF. A proposed polygon has to be the same kind of thing as a
//   traced one, all the way through makeOutline, resolveOutline,
//   regionFromOutline and into planLights. The last section runs exactly that
//   chain and asserts a layout comes out, because "the detector works" and "the
//   detector's rooms can be lit" are different claims.
//
// The fixture is FLOOR_PLAN_03-rooms-payload.json: the four rooms of the sample
// plan as a segmenter would return them — jittery mask boundaries at a reduced
// size — plus the four things that have to be thrown away.
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs';
import {
  pointsToPolygon, polygonFromPrediction, rectFromRle, isNormalisedPolygon,
  rescalePolygon, roomsFromPayload, cleanName, nameFromHints, ROOM_DEFAULTS,
} from '../src/lib/roomsDetect.js';
import { makeOutline, resolveOutline, regionFromOutline, outlineStats } from '../src/lib/outline.js';
import { planLights, DEFAULTS, resolveOptions } from '../src/lib/planner.js';
import { enumerateChunkings } from '../src/lib/chunking.js';
import { bbox, polygonArea, pointInPolygon } from '../src/lib/geometry.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const section = (s) => console.log('\n' + s);

// The uploaded file, and the space the fixture answered in.
const IMAGE = { w: 1042, h: 1642 };
const SENT = { w: 640, h: 1009 };
const payload = JSON.parse(readFileSync(
  new URL('./eval-fixtures/FLOOR_PLAN_03-rooms-payload.json', import.meta.url)));

// ---------------------------------------------------------------------------
section('points — the three encodings a workflow can use');
{
  const want = [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }];
  ok('a list of {x,y}', JSON.stringify(pointsToPolygon(want)) === JSON.stringify(want));
  ok('a list of [x,y]', JSON.stringify(pointsToPolygon([[1, 2], [3, 4], [5, 6]])) === JSON.stringify(want));
  ok('one flat run of numbers',
     JSON.stringify(pointsToPolygon([1, 2, 3, 4, 5, 6])) === JSON.stringify(want));
  ok('two points is not a polygon', pointsToPolygon([[1, 2], [3, 4]]) === null);
  ok('an odd-length flat run is refused rather than half-read',
     pointsToPolygon([1, 2, 3, 4, 5]) === null);
  ok('junk is refused', pointsToPolygon(['a', 'b', 'c']) === null && pointsToPolygon(null) === null);
}

section('rle — a run-length mask, reduced to its bounds');
{
  // 4 wide, 5 high, column-major, starting with zeros. Set the block
  // x in [1,2], y in [1,3]: columns 1 and 2, rows 1..3.
  //   col0: 5 off
  //   col1: 1 off, 3 on, 1 off
  //   col2: 1 off, 3 on, 1 off
  //   col3: 5 off
  const counts = [6, 3, 2, 3, 6];
  const r = rectFromRle({ counts, size: [5, 4] });
  ok('the mask decodes column-major', !!r, JSON.stringify(r));
  ok('x bounds are right', r.x0 === 1 && r.x1 === 3, `${r.x0}..${r.x1}`);
  ok('y bounds are right', r.y0 === 1 && r.y1 === 4, `${r.y0}..${r.y1}`);
  ok('it carries the mask\'s own size', r.w === 4 && r.h === 5, `${r.w}x${r.h}`);
  ok('a base64 counts string is refused, not misread',
     rectFromRle({ counts: 'PQNRNQ==', size: [5, 4] }) === null);
  ok('a missing size is refused', rectFromRle({ counts }) === null);
}

section('one prediction — which encoding wins');
{
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  ok('points beat a box',
     polygonFromPrediction({ points: pts, x: 99, y: 99, width: 4, height: 4 }).from === 'points');
  ok('an rle mask beats a box',
     polygonFromPrediction({ rle_mask: { counts: [6, 3, 2, 3, 6], size: [5, 4] },
                             x: 99, y: 99, width: 4, height: 4 }).from === 'rle');
  const box = polygonFromPrediction({ x: 50, y: 30, width: 20, height: 10 });
  ok('a box is a rectangle of four corners', box.from === 'box' && box.pts.length === 4);
  ok('...and x,y was read as the CENTRE, which is Roboflow\'s convention',
     box.pts[0].x === 40 && box.pts[0].y === 25, JSON.stringify(box.pts[0]));
  ok('nothing usable gives nothing', polygonFromPrediction({ class: 'room' }) === null);
}

section('normalised coordinates — the trap that reads as "found nothing"');
{
  ok('a unit-square polygon is spotted',
     isNormalisedPolygon([{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.8 }]));
  ok('a pixel polygon is not',
     !isNormalisedPolygon([{ x: 10, y: 10 }, { x: 300, y: 10 }, { x: 300, y: 200 }]));
  // The case worth guarding: a genuine pixel polygon that happens to live
  // inside the unit square would be blown up to fill the plan.
  ok('a sub-pixel sliver is not treated as fractions',
     !isNormalisedPolygon([{ x: 0, y: 0 }, { x: 0.004, y: 0 }, { x: 0.004, y: 0.004 }]));
  const up = rescalePolygon([{ x: 320, y: 500 }], SENT, IMAGE);
  ok('rescaling is a straight ratio per axis',
     near(up[0].x, 320 * IMAGE.w / SENT.w, 1e-6) && near(up[0].y, 500 * IMAGE.h / SENT.h, 1e-6));
  ok('rescaling to the same size is a no-op',
     rescalePolygon([{ x: 7, y: 9 }], SENT, SENT)[0].x === 7);
}

// ---------------------------------------------------------------------------
section('the sample plan — what survives and what does not');
const { rooms, rejected } = roomsFromPayload(payload, { image: IMAGE });
{
  ok('four rooms come out of eight masks', rooms.length === 4,
     `${rooms.length}: ${rooms.map((r) => Math.round(r.areaSqft ?? 0)).join(',')}`);
  const why = rejected.map((r) => r.reason).join(' | ');
  // Not on area — on the fact that four rooms are inside it. The sheet in this
  // fixture covers 88% of the image, which no area threshold can separate from
  // a tightly-cropped single-room plan.
  ok('the whole sheet was thrown away because it encloses the rooms',
     rejected.some((r) => /encloses \d+ other rooms/.test(r.reason)), why);
  ok('the duplicate bedroom was de-duplicated',
     rejected.some((r) => /overlaps a room already found/.test(r.reason)), why);
  ok('the light fitting was too small', rejected.some((r) => /too small/.test(r.reason)), why);
  ok('the unconfident mask was dropped', rejected.some((r) => /confidence/.test(r.reason)), why);
  // Which of the two bedrooms survived. The larger, not the more confident:
  // the confident one stopped at the door and is the smaller room.
  const bed = rooms.find((r) => bbox(r.pointsPx).minY > IMAGE.h * 0.55
                             && bbox(r.pointsPx).maxX < IMAGE.w * 0.75);
  ok('the surviving bedroom is the one that took in the whole room',
     !!bed && bbox(bed.pointsPx).w > 590, bed ? `${bbox(bed.pointsPx).w.toFixed(0)}px wide` : 'not found');
}

section('the arithmetic — the rooms are on the plan, not in its corner');
{
  const all = bbox(rooms.flatMap((r) => r.pointsPx));
  ok('the rooms span the width of the uploaded file, not of the image sent',
     all.w > IMAGE.w * 0.75, `${all.w.toFixed(0)} of ${IMAGE.w}`);
  ok('...and its height', all.h > IMAGE.h * 0.75, `${all.h.toFixed(0)} of ${IMAGE.h}`);
  ok('nothing escapes the image', all.minX >= -0.001 && all.minY >= -0.001
     && all.maxX <= IMAGE.w + 0.001 && all.maxY <= IMAGE.h + 0.001,
     `${all.minX.toFixed(1)},${all.minY.toFixed(1)} .. ${all.maxX.toFixed(1)},${all.maxY.toFixed(1)}`);
  // The check that catches a rescale applied once too often or not at all.
  const living = rooms.reduce((a, b) =>
    Math.abs(polygonArea(b.pointsPx)) > Math.abs(polygonArea(a.pointsPx)) ? b : a);
  ok('the living room reaches the right-hand wall',
     bbox(living.pointsPx).maxX > IMAGE.w * 0.85,
     `${bbox(living.pointsPx).maxX.toFixed(0)} of ${IMAGE.w}`);
}

section('simplification — a mask boundary is not a room outline');
{
  const raw = payload.outputs[0].model_predictions.predictions
    .find((p) => p.detection_id === 'living-1').points.length;
  const living = rooms.reduce((a, b) =>
    Math.abs(polygonArea(b.pointsPx)) > Math.abs(polygonArea(a.pointsPx)) ? b : a);
  ok('the mask came in with dozens of vertices', raw > 40, `${raw}`);
  ok('the outline comes out with a handful', living.pointsPx.length <= 14,
     `${living.pointsPx.length}`);
  // The L is the whole reason not to simplify to a bounding box.
  ok('...and the L-shaped room is still L-shaped', living.pointsPx.length >= 6,
     `${living.pointsPx.length} corners`);
  ok('every room is wound the same way as a traced one (CCW)',
     rooms.every((r) => polygonArea(r.pointsPx) >= 0),
     rooms.map((r) => polygonArea(r.pointsPx).toFixed(0)).join(','));
}

section('reading order and names');
{
  ok('the first room is the top one',
     bbox(rooms[0].pointsPx).minY <= Math.min(...rooms.map((r) => bbox(r.pointsPx).minY)) + 1);
  ok('the last room is the bottom one',
     bbox(rooms[3].pointsPx).maxY >= Math.max(...rooms.map((r) => bbox(r.pointsPx).maxY)) - 1);
  ok('a generic class is not used as a name', rooms.every((r) => r.label === null),
     JSON.stringify(rooms.map((r) => r.label)));
  ok('"room" and "object" are generic', cleanName('room') === null && cleanName('OBJECT') === null);
  ok('a real class becomes a name', cleanName('master_bedroom') === 'Master Bedroom');
  // The draughtsman's own word, where the drawing carries one.
  const kitchen = rooms.find((r) => bbox(r.pointsPx).maxX < IMAGE.w * 0.55
                                 && bbox(r.pointsPx).minY > IMAGE.h * 0.3
                                 && bbox(r.pointsPx).maxY < IMAGE.h * 0.62);
  ok('a label inside the polygon names the room',
     nameFromHints(kitchen.pointsPx, [{ x: 250, y: 800, text: 'KITCHEN' },
                                      { x: 900, y: 200, text: 'LIVING' }]) === 'Kitchen',
     String(nameFromHints(kitchen.pointsPx, [{ x: 250, y: 800, text: 'KITCHEN' }])));
  ok('a label outside every polygon names nothing',
     nameFromHints(kitchen.pointsPx, [{ x: 5, y: 5, text: 'GROUND FLOOR' }]) === null);
  ok('an area note loses to the shorter name',
     nameFromHints(kitchen.pointsPx, [{ x: 250, y: 820, text: 'AREA 96 SQ FT' },
                                      { x: 250, y: 800, text: 'KITCHEN' }]) === 'Kitchen');
}

section('the scale changes the floor, not the answer');
{
  // 1042px across a 34ft flat. A WC is above the floor; the light fitting that
  // was dropped on a pixel fraction is dropped on square feet too.
  const pxPerFt = 1042 / 34;
  const withScale = roomsFromPayload(payload, { image: IMAGE, pxPerFt });
  ok('the same four rooms', withScale.rooms.length === 4, `${withScale.rooms.length}`);
  ok('every room now has an area in feet',
     withScale.rooms.every((r) => r.areaSqft > ROOM_DEFAULTS.minAreaSqft),
     withScale.rooms.map((r) => Math.round(r.areaSqft)).join(','));
  ok('the areas are plausible for a small flat',
     withScale.rooms.every((r) => r.areaSqft > 20 && r.areaSqft < 700),
     withScale.rooms.map((r) => Math.round(r.areaSqft)).join(','));
  // A silly scale makes every room a cupboard, and that must remove them rather
  // than produce a plan of cupboards.
  const silly = roomsFromPayload(payload, { image: IMAGE, pxPerFt: 400 });
  ok('an absurd scale rejects everything instead of lighting it',
     silly.rooms.length === 0, `${silly.rooms.length} rooms survived`);
}

// ---------------------------------------------------------------------------
section('the handoff — a proposed room is lit exactly like a traced one');
{
  const pxPerFt = 1042 / 34;
  const options = resolveOptions({ ...DEFAULTS });
  const lit = rooms.map((r) => {
    // Exactly what App.jsx does with a proposal: makeOutline, then the same
    // resolve/region/geo/plan chain a traced outline goes through.
    const o = { ...makeOutline(r.pointsPx, { name: r.label }), rectify: true };
    const region = regionFromOutline(o, pxPerFt);
    const polygonPx = region.polygon;
    const b = bbox(polygonPx);
    const origin = { x: b.minX, y: b.minY };
    const toFt = (p) => ({ x: (p.x - origin.x) / pxPerFt, y: (p.y - origin.y) / pxPerFt });
    const polygonFt = polygonPx.map(toFt);
    const chunking = enumerateChunkings(polygonFt, [], options, []);
    const plan = planLights(polygonFt, [], { ...options, chunkStrategy: chunking.recommendedId }, []);
    return { o, region, polygonFt, plan, st: outlineStats(o, pxPerFt) };
  });

  ok('every proposed room resolves to a usable region', lit.every((r) => r.region.ok));
  ok('squaring makes every outline rectilinear',
     lit.every((r) => r.polygonFt.every((p, i) => {
       const q = r.polygonFt[(i + 1) % r.polygonFt.length];
       return Math.abs(p.x - q.x) < 1e-6 || Math.abs(p.y - q.y) < 1e-6;
     })), 'a diagonal edge survived');
  ok('every proposed room produces a layout', lit.every((r) => r.plan.ok),
     lit.map((r) => r.plan.ok ? 'ok' : r.plan.reason).join(' | '));
  ok('every layout puts lights in', lit.every((r) => r.plan.lights.length > 0),
     lit.map((r) => r.plan.lights.length).join(','));
  ok('no light falls outside its own room',
     lit.every((r) => r.plan.lights.every((l) => pointInPolygon(l, r.polygonFt))),
     'a light escaped its polygon');
  // Squaring a mask boundary MOVES corners, and how far is the number that says
  // whether it was a tidy-up or a rewrite. A jittery mask should be a tidy-up.
  const worst = Math.max(...lit.map((r) => r.st.movedFt));
  ok('squaring moved no corner more than a foot', worst < 1.0, `${(worst * 12).toFixed(0)} inches`);
  ok('the four rooms together cover a plausible flat',
     near(lit.reduce((s, r) => s + r.st.areaSqft, 0), 900, 400),
     `${Math.round(lit.reduce((s, r) => s + r.st.areaSqft, 0))} sq ft`);
}

section('a room inside a room — the payload the detector actually produces');
{
  // The bedroom spans the width of the flat and the ensuite sits inside it. This
  // is the case that used to hand the planner two overlapping polygons, light
  // the ensuite twice and count its floor twice in the lumens per square foot.
  const nested = JSON.parse(JSON.stringify(payload));
  const list = nested.outputs[0].model_predictions.predictions;
  const keep = list.filter((p) => ['living-1', 'kitchen-1'].includes(p.detection_id));
  const box = (x0, y0, x1, y1, id, conf) => {
    const pts = [];
    const ring = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % 4];
      for (let t = 0; t < 12; t++) {
        pts.push({ x: (ax + (bx - ax) * t / 12) * 640 / 1042 + (t % 3 - 1) * 0.6,
                   y: (ay + (by - ay) * t / 12) * 1009 / 1642 + (t % 3 - 1) * 0.6 });
      }
    }
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2,
             width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
             confidence: conf, class: 'room', class_id: 0, detection_id: id, points: pts };
  };
  // a corner ensuite: shares the bedroom's right and bottom walls
  nested.outputs[0].model_predictions.predictions = [
    ...keep,
    box(88, 962, 920, 1440, 'bedroom', 0.90),
    box(700, 1150, 920, 1440, 'ensuite-corner', 0.85),
  ];
  const a = roomsFromPayload(nested, { image: IMAGE });
  ok('both rooms survive', a.rooms.length === 4, `${a.rooms.length}`);
  const bed = a.rooms.find((r) => bbox(r.pointsPx).w > 700 && bbox(r.pointsPx).minY > IMAGE.h * 0.5);
  ok('the bedroom was carved into an L', bed && bed.pointsPx.length >= 6,
     bed ? `${bed.pointsPx.length} corners` : 'not found');
  ok('...and says so', bed && /subtracted/.test(bed.note), bed?.note);
  // The invariant, on the real pipeline: no point of one room is inside another.
  const overlaps = [];
  for (const p of a.rooms) for (const q of a.rooms) {
    if (p === q) continue;
    const c = { x: (bbox(q.pointsPx).minX + bbox(q.pointsPx).maxX) / 2,
                y: (bbox(q.pointsPx).minY + bbox(q.pointsPx).maxY) / 2 };
    if (pointInPolygon(c, p.pointsPx)) overlaps.push(`${q.label ?? '?'} in ${p.label ?? '?'}`);
  }
  ok('no room contains the middle of another', overlaps.length === 0, overlaps.join(', '));

  // ...and the same flat with the ensuite floating in the middle of the bedroom,
  // which cannot be subtracted and must be REPORTED for the caller to zone.
  nested.outputs[0].model_predictions.predictions = [
    ...keep,
    box(88, 962, 920, 1440, 'bedroom', 0.90),
    box(400, 1080, 640, 1300, 'ensuite-floating', 0.85),
  ];
  const b = roomsFromPayload(nested, { image: IMAGE });
  const bed2 = b.rooms.find((r) => bbox(r.pointsPx).w > 700 && bbox(r.pointsPx).minY > IMAGE.h * 0.5);
  ok('the enclosing room is kept, not dropped', !!bed2);
  ok('and hands back the room inside it for the caller to hold out of the ceiling',
     bed2?.enclosingPx?.length === 1, JSON.stringify(bed2?.note));
  ok('...saying so in words', /wholly inside/.test(bed2?.note || ''), bed2?.note);
  ok('the room inside it is still its own room', b.rooms.length === 4, `${b.rooms.length}`);
}

section('nothing found is not a failure');
{
  const empty = roomsFromPayload({ outputs: [{ model_predictions: { image: IMAGE, predictions: [] } }] },
                                 { image: IMAGE });
  ok('an empty response gives no rooms and no error',
     empty.rooms.length === 0 && empty.rejected.length === 0);
  const junk = roomsFromPayload({ message: 'workflow ran, output was named something else' },
                                { image: IMAGE });
  ok('an unrecognised response gives no rooms and does not throw', junk.rooms.length === 0);
  ok('a null payload does not throw', roomsFromPayload(null, { image: IMAGE }).rooms.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
