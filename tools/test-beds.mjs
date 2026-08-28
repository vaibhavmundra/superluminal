// tools/test-beds.mjs — is that rectangle a bed? In Node, no browser.
//
// THE GATE THIS TESTS IS THE ONE THAT WAS MISSING. Every other size check in
// furniture.js measures a detection as a fraction of the image, which is not a
// measurement of anything: the same bed is 0.2% of an A0 resort sheet and 4% of a
// one-room plan. It failed in both directions on the same project — real beds
// silently dropped on a large sheet, and room-sized boxes accepted as beds. A
// light gets placed AROUND these rectangles, so a wrong one moves every fitting
// in the room.
import { readFileSync } from 'node:fs';
import { plausibleBed, BED_FT, detectionsToZones } from '../src/lib/furniture.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};
const section = (s) => console.log('\n' + s);

// 20 px to the foot: a comfortable drawing scale.
const S = 20;
/** A rect of w × h FEET at the origin, in pixels. */
const ft = (w, h) => ({ x0: 100, y0: 100, x1: 100 + w * S, y1: 100 + h * S });

section('the beds a drawing actually contains');
{
  ok('a double, 5 × 6.5', plausibleBed(ft(5, 6.5), S).ok);
  ok('a king, 6.5 × 7', plausibleBed(ft(6.5, 7), S).ok);
  ok('a single, 3 × 6.5', plausibleBed(ft(3, 6.5), S).ok);
  ok("a child's single, 2.5 × 5.5", plausibleBed(ft(2.5, 5.5), S).ok);
  ok('rotated is the same bed', plausibleBed(ft(6.5, 5), S).ok);
  // Detections trace the drawn mattress plus a headboard and overhanging
  // pillows, so the bounds have to allow more than a catalogue size.
  ok('a padded king with a headboard, 7.5 × 8', plausibleBed(ft(7.5, 8), S).ok);
}

section('the things that are not beds');
{
  const room = plausibleBed(ft(13, 13), S);
  ok('a 13 × 13 room is refused', !room.ok, room.why);
  ok('...and says it is a room', /room/.test(room.why), room.why);

  const big = plausibleBed(ft(13.3, 18), S);
  ok('a 13 × 18 bedroom is refused', !big.ok, big.why);

  const strip = plausibleBed(ft(1.2, 7), S);
  ok('a 1.2ft strip is refused', !strip.ok, strip.why);

  const corridor = plausibleBed(ft(3, 22), S);
  ok('a 3 × 22 corridor is refused', !corridor.ok, corridor.why);

  // The aspect gate has to be exercised on a shape that clears every other
  // bound, or it is the side limit being tested twice. 2.5 × 8 is within both
  // side limits and within the area limits, and is still not a bed.
  const plank = plausibleBed(ft(2.5, 8), S);
  ok('a 2.5 × 8 plank is refused', !plank.ok, plank.why);
  ok('...on its aspect ratio', /:1/.test(plank.why), plank.why);

  const dot = plausibleBed(ft(1, 1), S);
  ok('a 1ft square is refused', !dot.ok, dot.why);

  // A BOX CAN BE WIDE AND STILL BE A BED, and this is where the gate was
  // originally wrong. 9 × 7 used to fail a single 8.5ft side limit; it is two
  // singles side by side, and on a hotel sheet that is what the plan-wide pass
  // returns. What must still fail is a box that is DEEP as well as wide.
  const pair = plausibleBed(ft(9, 7), S);
  ok('9 × 7 — two singles side by side — is a bed', pair.ok, pair.why);

  const square = plausibleBed(ft(9, 9), S);
  ok('9 × 9 is refused', !square.ok, square.why);
  ok('...for its depth, which is what says "room"', /deep/.test(square.why), square.why);
}

section('the reason is always usable');
{
  const bad = plausibleBed(ft(13, 13), S);
  ok('a refusal explains itself', typeof bad.why === 'string' && bad.why.length > 8, bad.why);
  const good = plausibleBed(ft(5, 6.5), S);
  ok('an acceptance states the size', /ft/.test(good.why), good.why);
}

section('no scale means no judgement');
{
  // On a raster the scale is not known until a door has been measured. Refusing
  // everything until then would drop every bed on upload; the gate is re-applied
  // in detectedZones the moment px-per-foot exists.
  ok('null scale passes through', plausibleBed(ft(13, 13), null).ok);
  ok('...and says why it was not judged', /not judged/.test(plausibleBed(ft(1, 1), 0).why));
  ok('a missing rect does not throw', plausibleBed(null, S).ok);
}

section('scale independence — the whole point');
{
  // The identical bed on three drawing scales. A fraction-of-the-image gate gives
  // three different answers here; this must give one.
  for (const s of [6, 20, 80]) {
    const r = { x0: 0, y0: 0, x1: 5 * s, y1: 6.5 * s };
    ok(`a 5 × 6.5 bed passes at ${s} px/ft`, plausibleBed(r, s).ok);
    const room = { x0: 0, y0: 0, x1: 13 * s, y1: 13 * s };
    ok(`a 13 × 13 room fails at ${s} px/ft`, !plausibleBed(room, s).ok);
  }
}

section('the dials are sane');
{
  ok('min side is under a single bed', BED_FT.minSide < 3);
  // THE DEPTH IS THE ROOM TEST. It has to clear a king with a headboard and
  // still sit below the short side of the smallest bedroom anyone draws.
  ok('max depth is over a king', BED_FT.maxShortSide > 7);
  ok('max depth is under a small bedroom', BED_FT.maxShortSide < 10);
  // The width has to reach a pair and stop well short of a wall.
  ok('max width reaches two beds', BED_FT.maxLongSide > 11);
  ok('max width is under a room span', BED_FT.maxLongSide < 20);
  ok('max area is over a pair', BED_FT.maxAreaSqft > 2 * 6.5 * 7);
  ok('max area is under a small room', BED_FT.maxAreaSqft < 170);
}

// --- THE PLAN THIS WAS CALIBRATED WRONG ON --------------------------------
//
// A hotel sheet: eleven beds returned by the plan-wide pass, all eleven dropped
// by a single 8.5ft side limit, each one reported as "a room, not a bed". They
// were bed PAIRS — ten of those rooms have twin beds, and asked about the whole
// drawing at once the detector boxes both and the gap between as one object.
// The per-room pass separates them, which is why the accent pass reported
// "bed, bed" about the very rooms this reported nothing about: a gate
// calibrated on the second pass's output, applied to the first's.
section('the eleven beds that were thrown away');
{
  const PXFT = 17.3;                       // ~900mm doors on that sheet
  const at = (w, h) => ({ x0: 0, y0: 0, x1: w * PXFT, y1: h * PXFT });
  // The shapes that plan produced, in its own feet.
  const seen = [[4.9, 8.0], [5.2, 10.6], [5.0, 10.5], [4.9, 7.9], [5.3, 7.1]];
  for (const [w, h] of seen) {
    const g = plausibleBed(at(w, h), PXFT);
    ok(`${w} × ${h} ft survives the gate`, g.ok, g.why);
  }
  // At the same scale the room around them still must not.
  ok('the 12 × 16 room they sit in does not',
     !plausibleBed(at(12, 16), PXFT).ok);
}


section('the bed-filter workflow: whatever it calls its class, it is a bed');
{
  // THE FAILURE THIS GUARDS AGAINST. detectionsToZones drops any prediction
  // whose class is not in the wanted set. On a general workflow that filter is
  // what stops a sofa becoming a no-light zone. On a workflow that answers ONE
  // question it is a way to throw the whole answer away and report zero
  // detections — and "the model found nothing" and "we discarded everything the
  // model found" look identical from outside. detectBeds passes `classes: []`
  // to disable the filter; these are the shapes that has to survive.
  //
  // The nesting is Roboflow's, not ours: a workflow response puts predictions
  // under outputs[].predictions.predictions, and collectPredictions walks for
  // GEOMETRY rather than for a key so it does not have to be told.
  const image = { w: 1050, h: 1650 };
  const bedBox = { x: 290, y: 1115, width: 240, height: 260 };   // centre form

  const wrap = (cls) => ([{
    predictions: { predictions: [{ ...bedBox, confidence: 0.91, class: cls }],
                   image: { width: 1050, height: 1650 } },
  }]);

  for (const cls of ['bed', 'Bed', 'BED', 'mattress', 'bed-filter', 'furniture-0']) {
    const { kept } = detectionsToZones(wrap(cls), { image, classes: [] });
    ok(`class "${cls}" survives with the filter off`, kept.length === 1,
      `kept ${kept.length}`);
  }
  // ...and the proof that this was a real risk, not a hypothetical one:
  const filtered = detectionsToZones(wrap('mattress'), { image, classes: ['bed'] });
  ok('...whereas the OLD class filter would have eaten it silently',
    filtered.kept.length === 0 && /not a class we zone/.test(filtered.rejected[0]?.reason || ''),
    JSON.stringify(filtered.rejected[0]));

  // The box lands where the model put it. Roboflow's x,y is the CENTRE.
  const { kept } = detectionsToZones(wrap('bed'), { image, classes: [] });
  const r = kept[0].rect;
  ok('centre-form x,y is expanded about the centre, not treated as a corner',
    r.x0 === 170 && r.y0 === 985 && r.x1 === 410 && r.y1 === 1245, JSON.stringify(r));

  // A segmentation model may answer with a polygon instead of a box. Its
  // bounding box is what a rectangular no-light zone can use.
  const poly = [{
    predictions: { predictions: [{
      confidence: 0.88, class: 'bed',
      points: [{ x: 170, y: 985 }, { x: 410, y: 985 }, { x: 410, y: 1245 }, { x: 170, y: 1245 }],
    }], image: { width: 1050, height: 1650 } },
  }];
  const fromPoly = detectionsToZones(poly, { image, classes: [] });
  ok('a mask/polygon answer reduces to the same rectangle',
    fromPoly.kept.length === 1 && fromPoly.kept[0].rect.x0 === 170
      && fromPoly.kept[0].rect.x1 === 410, JSON.stringify(fromPoly.kept[0]?.rect));

  // AND THE SIZE GATE STILL RUNS. A better detector is not a reason to stop
  // measuring: this is the check that caught the twin-PAIR boxes.
  const S2 = 240 / 12;   // the box above is 12ft wide at this scale
  const withScale = detectionsToZones(wrap('bed'), { image, classes: [], pxPerFt: S2 });
  ok('a 12 x 13 ft box is refused as a bed even with the class filter off',
    withScale.kept.length === 0, JSON.stringify(withScale.rejected[0]));
  const sane = detectionsToZones(
    [{ predictions: { predictions: [{ x: 290, y: 1115, width: 5 * 20, height: 6.5 * 20,
                                      confidence: 0.9, class: 'whatever' }],
                      image: { width: 1050, height: 1650 } } }],
    { image, classes: [], pxPerFt: 20 });
  ok('...and a 5 x 6.5 ft one is accepted', sane.kept.length === 1);
}


section('the REAL bed-filter response, verbatim');
{
  // THE CLASS IS "bed2". Not 'bed' — the training project's second class, and
  // nothing about the workflow's name or purpose predicts it. This is no longer
  // a hypothesis about what a dedicated workflow might label its output: it is
  // the actual answer for FLOOR_PLAN_03, and under a `classes: ['bed']` filter
  // it would have been dropped as "not a class we zone" and reported as a plan
  // with no beds in it. THE FIXTURE IS KEPT SO THAT CANNOT SILENTLY COME BACK.
  const real = JSON.parse(
    readFileSync(new URL('./eval-fixtures/FLOOR_PLAN_03-bedfilter-payload.json', import.meta.url)));
  const image = { w: 1042, h: 1642 };

  const { kept } = detectionsToZones(real, { image, classes: [] });
  ok('one bed, from the real payload', kept.length === 1, `kept ${kept.length}`);
  ok('and the class it actually returned is "bed2"',
    /bed2/.test(JSON.stringify(real)));

  const r = kept[0]?.rect || {};
  ok('the box is the mattress, not the room',
    r.x0 === 172 && r.y0 === 985 && r.x1 === 410 && r.y1 === 1250, JSON.stringify(r));

  // AGAINST THE HAND MEASUREMENT, at the plan's real scale. The truth file was
  // read off the drawing at 2x with a 20px ruler: the mattress only, excluding
  // the two nightstands either side of the headboard. This is the strongest
  // statement available about the new detector, so it is worth being exact:
  const truth = JSON.parse(
    readFileSync(new URL('../public/samples/FLOOR_PLAN_03.truth.json', import.meta.url)));
  const t = truth.beds[0];
  const off = Math.max(Math.abs(r.x0 - t.x0), Math.abs(r.y0 - t.y0),
                       Math.abs(r.x1 - t.x1), Math.abs(r.y1 - t.y1));
  ok(`every edge is within 5px of the hand-measured mattress (worst ${off}px)`, off <= 5);

  // ...and therefore it passes the size gate, which is the thing that actually
  // decides whether a detection becomes a no-light zone. 40 px/ft.
  const fit = plausibleBed(r, truth.pxPerFt);
  const wFt = ((r.x1 - r.x0) / truth.pxPerFt).toFixed(1);
  const hFt = ((r.y1 - r.y0) / truth.pxPerFt).toFixed(1);
  ok(`and at ${truth.pxPerFt} px/ft it measures ${wFt} x ${hFt} ft, which BED_FT accepts`,
    fit.ok, fit.why);

  // The whole point of the change, stated as a test: this is ONE box around ONE
  // mattress. The arrangement it replaces returned a box around twin PAIRS.
  ok('one box, not one around a pair', kept.length === 1);

  const filtered = detectionsToZones(real, { image, classes: ['bed'] });
  ok('the old class filter would have returned NOTHING on this payload',
    filtered.kept.length === 0
      && /not a class we zone/.test(filtered.rejected[0]?.reason || ''),
    JSON.stringify(filtered.rejected[0]));
}

console.log(`\n${fail ? `${fail} FAILED, ` : ''}${pass} passed`);
if (fail) process.exit(1);
console.log('all good');
