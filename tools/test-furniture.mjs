// ---------------------------------------------------------------------------
// test-furniture.mjs — the detector is the one part of this app that takes
// instructions from something we did not write. So the tests here are less
// about "does it parse" and more about the ways a plausible-looking response
// puts a zone in the wrong place:
//
//   * x,y read as a corner when Roboflow means the CENTRE — half a bed off
//   * coordinates left in the downscaled space — the bed lands top-left
//   * a whole-plan box accepted as "one very large bed" — room gets no lights
//   * a bed in the OTHER bedroom treated as an obstacle in this one
//
// Each of those looks fine on screen until you check it against the drawing.
// ---------------------------------------------------------------------------

import {
  collectPredictions, rectFromPrediction, rescaleRect, className, iou, dedupe,
  detectionsToZones, zonesFromDetections, looksLikePrediction, FURNITURE_DEFAULTS,
} from '../src/lib/furniture.js';

let fails = 0, checks = 0;
const ok = (cond, what) => { checks++; if (!cond) { fails++; console.log(`   FAIL  ${what}`); } };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const IMG = { w: 2000, h: 1500 };
const ROOM = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }, { x: 0, y: 800 }];

// A response in the shape the hosted workflow actually returns: a list, one
// entry per input, each carrying an image size and a predictions array.
const wrap = (preds, size = IMG) => ([{
  predictions: { image: { width: size.w, height: size.h }, predictions: preds },
}]);

const bed = (x, y, w, h, conf = 0.9, cls = 'bed') =>
  ({ x, y, width: w, height: h, confidence: conf, class: cls, class_id: 0 });

console.log('furniture — reading a prediction');
{
  ok(looksLikePrediction(bed(10, 10, 4, 4)), 'centre-form is a prediction');
  ok(looksLikePrediction({ x1: 1, y1: 2, x2: 3, y2: 4 }), 'corner-form is a prediction');
  ok(looksLikePrediction({ points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 2 }] }), 'polygon is a prediction');
  ok(!looksLikePrediction({ class: 'bed', confidence: 0.9 }), 'a label with no geometry is not');
  ok(!looksLikePrediction(null), 'null is not');

  // THE one that silently ruins everything: x,y is the centre.
  const r = rectFromPrediction(bed(100, 200, 40, 60));
  ok(near(r.x0, 80) && near(r.x1, 120) && near(r.y0, 170) && near(r.y1, 230),
    'x,y treated as the CENTRE of the box');

  const c = rectFromPrediction({ x1: 30, y1: 40, x2: 10, y2: 20 });
  ok(near(c.x0, 10) && near(c.y0, 20) && near(c.x1, 30) && near(c.y1, 40),
    'corner-form is normalised whichever way round it came');

  const p = rectFromPrediction({ points: [{ x: 5, y: 9 }, { x: 25, y: 4 }, { x: 15, y: 30 }] });
  ok(near(p.x0, 5) && near(p.x1, 25) && near(p.y0, 4) && near(p.y1, 30),
    'a mask becomes its bounding box');

  ok(className({ class: ' Bed ' }) === 'bed', 'class name is trimmed and lowercased');
  ok(className({ class_name: 'BED' }) === 'bed', 'class_name is accepted too');
}

console.log('furniture — the response can be nested any way it likes');
{
  ok(collectPredictions(wrap([bed(1, 1, 2, 2)])).length === 1, 'the documented shape');
  ok(collectPredictions({ outputs: [{ anything: { predictions: [bed(1, 1, 2, 2)] } }] }).length === 1,
    'an output field we did not name');
  ok(collectPredictions([[{ predictions: [bed(1, 1, 2, 2), bed(5, 5, 2, 2)] }]]).length === 2,
    'a list per crop');
  ok(collectPredictions({}).length === 0, 'an empty response yields nothing, not a throw');
  ok(collectPredictions({ predictions: [] }).length === 0, 'no detections is not an error');

  // The image size must come down from the enclosing object, not the prediction.
  const got = collectPredictions(wrap([bed(1, 1, 2, 2)], { w: 800, h: 600 }));
  ok(got[0].imgSize.w === 800 && got[0].imgSize.h === 600, 'image size is carried down to the prediction');
}

console.log('furniture — the {meta,result} envelope the proxy now returns');
{
  // api/detect.js wraps the upstream body so it can report timing and a
  // summary. The parser must not care, because it walks for geometry rather
  // than for a known path.
  const enveloped = {
    meta: { id: 'a3f1', ms: 940, endpoint: 'https://x/y', classes: 'bed', bytes: 188000, predictions: 1, summary: ['bed 0.87 @512x318 340x410'] },
    result: wrap([bed(500, 400, 200, 250)]),
  };
  const { kept } = detectionsToZones(enveloped, { image: IMG });
  ok(kept.length === 1, 'a prediction inside {meta,result} is still found');
  ok(kept[0].cls === 'bed', 'and reads correctly');
  ok(collectPredictions({ meta: { predictions: 3, summary: ['bed 0.9'] }, result: [] }).length === 0,
    'the meta block is not mistaken for a detection');
}

console.log('furniture — coordinates come back in the space we sent');
{
  const r = rescaleRect({ x0: 100, y0: 50, x1: 200, y1: 150 }, { w: 1000, h: 750 }, { w: 2000, h: 1500 });
  ok(near(r.x0, 200) && near(r.y0, 100) && near(r.x1, 400) && near(r.y1, 300),
    'a box from a half-size image is doubled back');

  const same = rescaleRect({ x0: 1, y0: 2, x1: 3, y1: 4 }, { w: 100, h: 100 }, { w: 100, h: 100 });
  ok(same.x0 === 1 && same.x1 === 3, 'no rescale when the sizes match');

  // End to end: sent at 1000x750, bed centred in the top-left room.
  const { kept } = detectionsToZones(wrap([bed(250, 200, 150, 200)], { w: 1000, h: 750 }),
    { image: IMG, polygon: ROOM });
  ok(kept.length === 1, 'the bed survives');
  ok(near(kept[0].rect.x0, 350) && near(kept[0].rect.y0, 200),
    'and lands where it belongs in full-size pixels');
}

console.log('furniture — what must be thrown away');
{
  const why = (payload, opts) => detectionsToZones(payload, { image: IMG, ...opts }).rejected.map((r) => r.reason);

  ok(detectionsToZones(wrap([bed(500, 400, 200, 250, 0.1)]), { image: IMG }).kept.length === 0,
    'a low-confidence box is dropped');
  ok(why(wrap([bed(500, 400, 200, 250, 0.1)]))[0].includes('confidence'), 'and says so');

  // The failure that matters most: a box over the whole plan means the room
  // gets subtracted to nothing and comes back with zero lights.
  const whole = detectionsToZones(wrap([bed(1000, 750, 1900, 1400)]), { image: IMG });
  ok(whole.kept.length === 0, 'a box covering the whole plan is refused');
  ok(whole.rejected[0].reason.includes('%'), 'and reports how much it covered');

  ok(detectionsToZones(wrap([bed(500, 400, 4, 4)]), { image: IMG }).kept.length === 0,
    'a speck is refused');

  ok(detectionsToZones(wrap([bed(500, 400, 200, 250, 0.9, 'sofa')]), { image: IMG }).kept.length === 0,
    'a sofa is not zoned — it is not a bed');

  // Three bedrooms on a floor plan; only one is being lit.
  const twoBeds = wrap([bed(400, 300, 200, 250), bed(1700, 1200, 200, 250)]);
  const mine = detectionsToZones(twoBeds, { image: IMG, polygon: ROOM });
  ok(mine.kept.length === 1, 'only the bed in THIS room counts');
  ok(mine.rejected.some((r) => r.reason.includes('outside')), 'the other is rejected as outside');
  ok(detectionsToZones(twoBeds, { image: IMG }).kept.length === 2,
    'both are kept when no room is specified');

  // Clamping: a box the model ran off the edge of the image.
  const edge = detectionsToZones(wrap([bed(50, 50, 400, 400)]), { image: IMG }).kept[0];
  ok(edge.rect.x0 === 0 && edge.rect.y0 === 0, 'a box overhanging the edge is clamped, not dropped');
}

console.log('furniture — one bed, one zone');
{
  const a = { x0: 0, y0: 0, x1: 100, y1: 100 };
  ok(near(iou(a, a), 1), 'a box fully overlaps itself');
  ok(iou(a, { x0: 200, y0: 200, x1: 300, y1: 300 }) === 0, 'disjoint boxes do not overlap');
  ok(near(iou(a, { x0: 50, y0: 0, x1: 150, y1: 100 }), 1 / 3), 'half-overlap is a third by IoU');

  const twice = dedupe([
    { cls: 'bed', conf: 0.9, rect: { x0: 0, y0: 0, x1: 100, y1: 100 } },
    { cls: 'bed', conf: 0.7, rect: { x0: 5, y0: 5, x1: 105, y1: 105 } },
  ]);
  ok(twice.length === 1 && twice[0].conf === 0.9, 'two boxes on one bed keep the confident one');

  const sorted = detectionsToZones(wrap([bed(400, 300, 200, 250, 0.5), bed(405, 305, 200, 250, 0.95)]),
    { image: IMG }).kept;
  ok(sorted.length === 1 && near(sorted[0].conf, 0.95), 'de-dup runs after sorting by confidence');
}

console.log('furniture — becoming a zone App.jsx can hold');
{
  const { kept } = detectionsToZones(wrap([bed(500, 400, 200, 300)]), { image: IMG });
  const [z] = zonesFromDetections(kept, { image: IMG, pxPerFt: 20 });
  ok(['id', 'x0', 'y0', 'x1', 'y1'].every((k) => k in z), 'the zone has the shape the app already uses');
  ok(z.source === 'detected' && z.cls === 'bed', 'and is marked as detected, not drawn');

  // padFt = 0.25 at 20px/ft is 5px on every side.
  ok(near(z.x0, 400 - 5) && near(z.x1, 600 + 5) && near(z.y0, 250 - 5) && near(z.y1, 550 + 5),
    'padding is applied in feet, converted through the scale');

  const [unscaled] = zonesFromDetections(kept, { image: IMG, pxPerFt: null });
  ok(near(unscaled.x0, 400), 'with no scale yet, no padding is invented');

  const [nopad] = zonesFromDetections(kept, { image: IMG, pxPerFt: 20, padFt: 0 });
  ok(near(nopad.x0, 400) && near(nopad.x1, 600), 'padding is overridable');

  const pair = detectionsToZones(wrap([bed(300, 300, 200, 250), bed(900, 600, 200, 250)]),
    { image: IMG }).kept;
  ok(pair.length === 2, 'two well-separated beds both survive');
  const ids = new Set(zonesFromDetections(pair, { image: IMG, pxPerFt: 20 }).map((q) => q.id));
  ok(ids.size === 2, 'two detections get two distinct ids');

  // The area floor is real: a 100x100 box on a 2000x1500 plan is under 0.4% and
  // is refused. On a whole-site drawing a genuine bed can be that small, which
  // is what minAreaFrac is for.
  ok(detectionsToZones(wrap([bed(300, 300, 100, 100)]), { image: IMG }).kept.length === 0,
    'a 100px box on a 2000px plan is below the area floor');
  ok(detectionsToZones(wrap([bed(300, 300, 100, 100)]), { image: IMG, minAreaFrac: 0.001 }).kept.length === 1,
    'and the floor can be lowered for a site-scale drawing');

  ok(FURNITURE_DEFAULTS.padFt > 0 && FURNITURE_DEFAULTS.padFt < 1,
    'the default pad is inches, not feet — every inch is ceiling you cannot light');
}


console.log('furniture — the LIVE response shape from general-segmentation-api-4');
{
  // Copied from a real run. Three things here have bitten or nearly bitten:
  //   * predictions nested THREE deep under a key also called "predictions"
  //   * an rle_mask sibling, which is a big nested object full of numbers and
  //     must not be walked into or mistaken for geometry
  //   * image size declared one level ABOVE the prediction it applies to
  const live = {
    predictions: {
      predictions: {
        image: { width: 1042, height: 1642 },
        predictions: [{
          width: 234, height: 258, x: 291, y: 1116,
          confidence: 0.6953125, class_id: 0, class: 'bed',
          detection_id: 'dc1355f0-cad3-4f48-8a7b-d43828d1f7aa',
          parent_id: 'image',
          rle_mask: { size: [1642, 1042], counts: 'q'.repeat(2000) },
        }],
      },
    },
  };

  const got = collectPredictions(live);
  ok(got.length === 1, 'the prediction is found three levels deep');
  ok(got[0].imgSize.w === 1042 && got[0].imgSize.h === 1642,
    'the image size is taken from the level above the prediction');

  // Same payload as the server now wraps it.
  const wrapped = { meta: { id: 'x', predictions: 1 }, result: live };
  const sent = { w: 1042, h: 1642 };
  const kept = detectionsToZones(wrapped, { image: sent }).kept;
  ok(kept.length === 1 && kept[0].cls === 'bed', 'and survives the {meta,result} envelope');
  ok(Math.abs(kept[0].conf - 0.6953125) < 1e-9, 'confidence is carried through');
  const r = kept[0].rect;
  ok(Math.abs(r.x0 - 174) < 1 && Math.abs(r.y0 - 987) < 1 && Math.abs(r.x1 - 408) < 1 && Math.abs(r.y1 - 1245) < 1,
    `x,y read as the centre: got (${r.x0},${r.y0})-(${r.x1},${r.y1})`);

  // The mask is a better outline than the box for a rotated bed, but zones are
  // axis-aligned, so it is deliberately unused. What matters is that its
  // presence changes nothing.
  const noMask = JSON.parse(JSON.stringify(live));
  delete noMask.predictions.predictions.predictions[0].rle_mask;
  const bare = detectionsToZones({ result: noMask }, { image: sent }).kept[0].rect;
  ok(bare.x0 === r.x0 && bare.y1 === r.y1, 'the rle_mask does not affect the box either way');

  // An rle_mask with no box alongside it must not become a phantom detection.
  ok(collectPredictions({ predictions: [{ rle_mask: { size: [10, 10], counts: 'zz' }, class: 'bed', confidence: 0.9 }] }).length === 0,
    'a mask with no box is not a prediction');

  // 0.695 must clear the confidence floor, or a real bed is silently binned.
  ok(0.6953125 > FURNITURE_DEFAULTS.minConfidence,
    `the live confidence clears the floor (${FURNITURE_DEFAULTS.minConfidence})`);
}

console.log('furniture — the encodings a workflow might actually use');
{
  const { isNormalised } = await import('../src/lib/furniture.js');
  const one = (pred) => detectionsToZones(wrap([pred]), { image: IMG }).kept;
  const box = (pred) => one(pred)[0]?.rect;
  const at = (r) => r && [r.x0, r.y0, r.x1, r.y1].map(Math.round).join(',');

  // The named centre form is Roboflow's own. The rest are what other blocks and
  // model families emit, and a workflow author does not get to choose. Missing
  // any of these looks exactly like "the model found nothing".
  ok(at(box({ x: 1000, y: 750, width: 400, height: 500, confidence: 0.9, class: 'bed' })) === '800,500,1200,1000',
    'named centre x,y,width,height');
  ok(at(box({ bbox: [800, 500, 400, 500], confidence: 0.9, class: 'bed' })) === '800,500,1200,1000',
    'bbox array is top-left plus size, NOT centre');
  ok(at(box({ box: [800, 500, 400, 500], confidence: 0.9, class: 'bed' })) === '800,500,1200,1000', 'box array');
  ok(at(box({ xywh: [800, 500, 400, 500], confidence: 0.9, class: 'bed' })) === '800,500,1200,1000', 'xywh array');
  ok(at(box({ xyxy: [800, 500, 1200, 1000], confidence: 0.9, class: 'bed' })) === '800,500,1200,1000',
    'xyxy array is corners, not size');

  // Fractions. Left as-is these are a 1x1 speck and die on the area floor,
  // which reads as "found nothing" instead of "wrong units".
  ok(isNormalised({ x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.6 }), '0..1 values are recognised as fractions');
  ok(!isNormalised({ x0: 10, y0: 20, x1: 400, y1: 600 }), 'pixel values are not');
  ok(!isNormalised({ x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5 }), 'a zero-area box is not treated as fractions');
  ok(at(box({ x: 0.5, y: 0.5, width: 0.2, height: 0.3, confidence: 0.9, class: 'bed' })) === '800,525,1200,975',
    'fractional coordinates are resolved against the image');
  ok(one({ x: 0.5, y: 0.5, width: 0.2, height: 0.3, confidence: 0.9, class: 'bed' }).length === 1,
    'and survive the area floor rather than being binned as a speck');

  ok(!looksLikePrediction({ bbox: [1, 2, 3], class: 'bed' }), 'a 3-element array is not a box');
  ok(!looksLikePrediction({ bbox: ['a', 'b', 'c', 'd'] }), 'a string array is not a box');
}

console.log('furniture — finding the visualisation without mistaking a mask for one');
{
  const { collectImages, visualisationFrom, imageMimeOf } = await import('../src/lib/furniture.js');
  const PNG = 'iVBORw0KGgo' + 'A'.repeat(400);
  const JPG = '/9j/' + 'B'.repeat(900);

  ok(imageMimeOf(PNG) === 'image/png', 'a PNG is recognised by its magic prefix');
  ok(imageMimeOf(JPG) === 'image/jpeg', 'so is a JPEG');
  ok(imageMimeOf(`data:image/png;base64,${PNG}`) === 'image/png', 'a data: URL is unwrapped first');
  ok(imageMimeOf('q'.repeat(4000)) === null, 'a long base64-ish string with no magic is NOT an image');
  ok(imageMimeOf('short') === null, 'a short string is not an image');
  ok(imageMimeOf(null) === null && imageMimeOf(42) === null, 'non-strings are not images');

  // THE trap: rle_mask.counts is base64-shaped and would render as a broken
  // thumbnail if the walk trusted "looks like base64".
  const live = {
    predictions: { predictions: { predictions: [{
      x: 291, y: 1116, width: 234, height: 258, class: 'bed', confidence: 0.7,
      rle_mask: { size: [1642, 1042], counts: 'iVBORw0KGgo' + 'z'.repeat(5000) },
    }] } },
    visualization: JPG,
  };
  const imgs = collectImages(live);
  ok(imgs.length === 1, 'exactly one image is found');
  ok(imgs[0].key === 'visualization', 'and it is the visualisation, not the mask');
  ok(!imgs.some((i) => i.base64.includes('zzzz')),
    'an rle_mask whose counts BEGIN with a PNG magic prefix is still skipped');

  // Whatever the workflow author named the field.
  for (const key of ['visualization', 'output_image', 'annotated', 'render', 'anything_at_all']) {
    ok(collectImages({ [key]: PNG }).length === 1, `an image under "${key}" is found`);
  }
  ok(collectImages({ out: { type: 'base64', value: PNG } }).length === 1,
    'the {type,value} wrapper form is found');

  // Biggest first: a workflow returning both a thumbnail and a full render
  // should surface the full one.
  const both = collectImages({ small: PNG, big: JPG });
  ok(both[0].mime === 'image/jpeg', 'the largest image is preferred');
  ok(visualisationFrom(both === null ? {} : { small: PNG, big: JPG }).bytes === both[0].bytes,
    'visualisationFrom returns that one');

  ok(visualisationFrom({}) === null, 'no visualisation is null, not a throw');
  ok(visualisationFrom({ predictions: [] }) === null, 'a predictions-only response yields no image');
  ok(collectImages({ a: PNG, b: PNG }).length === 1, 'the same image twice is reported once');
}

console.log('furniture — weighting the wall layers heavy');
{
  const { detectionSvg } = await import('../src/lib/furniture.js');
  const src = (render, w = 917, h = 1405) => ({ kind: 'vector', w, h, render });
  const WALL = { layer: 'KMBD Walls', path: 'M0 0L100 0', circles: [] };
  const ZERO = { layer: '0', path: 'M10 10L60 10', circles: [] };

  const r = detectionSvg(src([WALL, ZERO]), { stroke: 1.6, wallStroke: 22, wallLayers: ['KMBD Walls'] });
  ok(r.wallLayerNames.join() === 'KMBD Walls', 'the wall layer is the one drawn heavy');
  const widths = [...r.svg.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => parseFloat(m[1]));
  ok(widths.length === 2, 'two stroke groups');
  ok(widths[0] === 22 && widths[1] === 1.6, 'walls heavy, everything else light');

  // Order matters: a bed against a wall loses its headboard if a 22px band is
  // painted OVER it.
  ok(r.svg.indexOf('stroke-width="22.00"') < r.svg.indexOf('stroke-width="1.60"'),
    'walls are painted UNDER the furniture, not over it');

  // A Set and an array must behave the same, and neither may crash.
  ok(detectionSvg(src([WALL, ZERO]), { wallLayers: new Set(['KMBD Walls']) }).wallLayerNames.length === 1,
    'a Set of wall layers works');
  ok(detectionSvg(src([WALL, ZERO]), { wallLayers: null }).wallLayerNames.length === 0,
    'no wall layers means one uniform weight');
  ok(detectionSvg(src([WALL, ZERO]), { wallLayers: [] }).wallLayerNames.length === 0,
    'an empty wall list is not an error');
  ok(detectionSvg(src([WALL, ZERO]), { wallLayers: ['Nonexistent'] }).wallLayerNames.length === 0,
    'a wall layer that is not in the drawing is simply not found');

  // Nothing may be dropped by the split: every layer must still be drawn.
  const split = detectionSvg(src([WALL, ZERO]), { wallLayers: ['KMBD Walls'] });
  ok(split.svg.includes('M0 0L100 0') && split.svg.includes('M10 10L60 10'),
    'both the wall path and the furniture path survive the split');

  // The downscale compensation must apply to BOTH weights.
  const big = detectionSvg(src([WALL, ZERO], 3200, 4000), { stroke: 2, wallStroke: 20, wallLayers: ['KMBD Walls'] });
  const bw = [...big.svg.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => parseFloat(m[1]));
  ok(Math.abs(bw[0] - 20 / big.scale) < 0.01 && Math.abs(bw[1] - 2 / big.scale) < 0.01,
    'both weights are divided by the render scale, not just the light one');
}

console.log('furniture — rendering a DXF for the detector');
{
  const { detectionSvg } = await import('../src/lib/furniture.js');
  const src = (render, w = 1400, h = 900) => ({ kind: 'vector', w, h, render });

  const WALLS = { layer: 'A-WALL', path: 'M0 0L100 0', circles: [] };
  const FURN  = { layer: 'A-FURN', path: 'M10 10L60 10', circles: [] };
  const DIMS  = { layer: 'A-DIMS', path: 'M0 800L1400 800', circles: [] };
  const HATCH = { layer: 'FLR-HATCH-PATTERN', path: 'M5 5L9 9', circles: [] };

  const r = detectionSvg(src([WALLS, FURN, DIMS, HATCH]));

  // THE one that would silently break the whole feature: rendering walls only,
  // the way room extraction does, deletes the thing being looked for.
  ok(r.layerNames.includes('A-FURN'), 'the FURNITURE layer is rendered — without it there is no bed to find');
  ok(r.layerNames.includes('A-WALL'), 'walls are rendered too, for context');
  ok(!r.layerNames.includes('A-DIMS'), 'dimension layers are dropped as noise');
  ok(!r.layerNames.includes('FLR-HATCH-PATTERN'), 'hatch and paving are dropped as noise');

  ok(r.svg.includes('fill="#ffffff"'), 'the ground is white — a line drawing on black is a negative');
  ok(r.svg.includes('stroke="#000000"'), 'and the lines are black');
  ok(r.svg.includes('viewBox="0 0 1400 900"'),
    'the viewBox is the SOURCE pixel space, which is the space zones live in');

  // A drawing whose only layer looks like annotation must not render blank.
  const onlyDims = detectionSvg(src([DIMS]));
  ok(onlyDims.layers === 1 && onlyDims.layerNames.includes('A-DIMS'),
    'a drawing with nothing but a "DIMS" layer still renders, rather than going blank');

  ok(detectionSvg(src([])).layers === 0, 'an empty drawing does not throw');
  ok(detectionSvg({ kind: 'vector', w: 100, h: 100 }).layers === 0, 'a missing render array does not throw');

  // Downscaling a big drawing must thicken the stroke in user units, or a
  // 6000px drawing renders as invisible hairlines.
  const big = detectionSvg(src([WALLS], 6400, 4000));
  ok(big.w === 1600, 'a large drawing is capped at maxDim');
  ok(big.scale === 0.25, 'and reports the scale it used');
  const sw = parseFloat(big.svg.match(/stroke-width="([\d.]+)"/)[1]);
  ok(sw > 6, `the stroke is thickened to survive the downscale, got ${sw}`);

  const small = detectionSvg(src([WALLS], 800, 600));
  ok(small.w === 800 && small.scale === 1, 'a small drawing is not upscaled');

  // Circles carry fans, WC pans and round tables; they must survive.
  const withCircles = detectionSvg(src([{ layer: 'A-FURN', path: '', circles: [{ cx: 50, cy: 60, r: 12 }] }]));
  ok(withCircles.svg.includes('<circle'), 'circles are rendered');
  ok(!withCircles.svg.includes('<path d=""'), 'a layer with no line work emits no empty path');
}

console.log(`\n${checks - fails}/${checks} checks passed (incl. vector render)`);
if (fails) process.exit(1);
