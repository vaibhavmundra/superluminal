// ---------------------------------------------------------------------------
// test-openai-detect.mjs — the OpenAI route, with the network taken out.
//
// The claim this file has to defend is not "the model is good". It is:
//
//   whatever the model says, it arrives as a payload furniture.js already
//   understands, in the pixel space it says it is in, with the centre
//   convention Roboflow uses — so NOTHING DOWNSTREAM HAS TO CHANGE.
//
// That is the entire reason for adding a second provider this way rather than a
// second pipeline. If it holds, every guard that already exists (the confidence
// floor, the area rejects, the in-room filter, the de-dup, the padding, the
// rejection list in the sidebar) applies to this route for free. If it breaks,
// it breaks silently and in feet, so it is worth pinning down.
//
// Two things get their own tests because they are the two ways this feature
// dies quietly:
//   - the CENTRE convention. x,y is the middle of the box. Read as a corner it
//     puts the zone half a bed off, which looks like a bad model.
//   - the CELL RANGE being inclusive. "columns C to F" includes F. Off by one
//     is a whole cell, which at a 4ft grid is four feet of ceiling.
// ---------------------------------------------------------------------------

import * as oai from '../src/lib/openaiDetect.js';
import { detectionsToZones, zonesFromDetections, rectCentre, iou } from '../src/lib/furniture.js';
import { planLights, DEFAULTS } from '../src/lib/planner.js';
import { pointInPolygon } from '../src/lib/geometry.js';

let fails = 0, checks = 0;
const ok = (cond, what) => { checks++; if (!cond) { fails++; console.log(`   FAIL  ${what}`); } };
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

// --- column labels ----------------------------------------------------------

console.log('grid — column labels round-trip');
{
  for (const [i, s] of [[0, 'A'], [1, 'B'], [25, 'Z'], [26, 'AA'], [27, 'AB'], [51, 'AZ'], [52, 'BA'], [701, 'ZZ'], [702, 'AAA']]) {
    ok(oai.colLabel(i) === s, `colLabel(${i}) is ${s}, got ${oai.colLabel(i)}`);
    ok(oai.colIndex(s) === i, `colIndex(${s}) is ${i}, got ${oai.colIndex(s)}`);
  }
  ok(oai.colIndex('4') === null, 'a digit is not a column');
  ok(oai.colIndex('') === null, 'an empty string is not a column');
}

console.log('grid — the spec covers the image and stops at its edge');
{
  const spec = oai.gridSpec({ w: 1000, h: 620, pitch: 100 });
  ok(spec.cols.length === 10, `10 columns, got ${spec.cols.length}`);
  ok(spec.rows.length === 7, `7 rows (the last one short), got ${spec.rows.length}`);
  ok(spec.cols.at(-1).x1 === 1000, 'the last column stops at the right edge');
  ok(spec.rows.at(-1).y0 === 600 && spec.rows.at(-1).y1 === 620,
    'the short last row is kept, not merged — a bed can touch the bottom edge');
  ok(oai.gridSpec({ w: 100, h: 100, pitch: 1 }).pitch >= 8, 'an absurd pitch is floored');
}

console.log('grid — a cell range is INCLUSIVE at both ends');
{
  const spec = oai.gridSpec({ w: 1000, h: 1000, pitch: 100 });
  const r = oai.cellRangeToRect({ colFrom: 'C', colTo: 'F', rowFrom: 4, rowTo: 6 }, spec);
  ok(r.x0 === 200, `C starts at 200, got ${r.x0}`);
  ok(r.x1 === 600, `F ENDS at 600 — inclusive. got ${r.x1}`);
  ok(r.y0 === 300 && r.y1 === 600, `rows 4..6 are 300..600, got ${r.y0}..${r.y1}`);

  const one = oai.cellRangeToRect({ colFrom: 'A', colTo: 'A', rowFrom: 1, rowTo: 1 }, spec);
  ok(one.x0 === 0 && one.x1 === 100, 'a single cell is one cell wide, not zero');

  const flipped = oai.cellRangeToRect({ colFrom: 'F', colTo: 'C', rowFrom: 6, rowTo: 4 }, spec);
  ok(flipped.x0 === 200 && flipped.x1 === 600, 'a reversed range is normalised rather than inverted');

  const over = oai.cellRangeToRect({ colFrom: 'A', colTo: 'ZZ', rowFrom: 1, rowTo: 999 }, spec);
  ok(over.x1 === 1000 && over.y1 === 1000, 'a range past the edge clamps to the image');

  const numeric = oai.cellRangeToRect({ colFrom: 2, colTo: 5, rowFrom: 4, rowTo: 6 }, spec);
  ok(numeric.x0 === 200 && numeric.x1 === 600, 'a model that answers with column NUMBERS still works');
}

console.log('grid — cell refs are read in the forms models actually write');
{
  for (const s of ['C4', 'c4', 'C 4', 'c-4']) {
    const p = oai.parseCellRef(s);
    ok(p && p.col === 2 && p.row === 3, `"${s}" is column 2 row 3, got ${JSON.stringify(p)}`);
  }
  ok(oai.parseCellRef('bed') === null, 'a word is not a cell reference');
  ok(oai.parseCellRef('4C') === null, 'a transposed reference is refused rather than guessed');
}

// --- getting the JSON out ---------------------------------------------------

console.log('reply — the JSON survives whatever it is wrapped in');
{
  const want = (o) => o && Array.isArray(o.beds) && o.beds.length === 1;
  ok(want(oai.extractJson('{"beds":[{"x0":1}]}')), 'bare JSON');
  ok(want(oai.extractJson('```json\n{"beds":[{"x0":1}]}\n```')), 'a fenced block');
  ok(want(oai.extractJson('Here you go:\n{"beds":[{"x0":1}]}\nHope that helps.')), 'prose either side');
  ok(oai.extractJson('[{"x0":1}]').beds.length === 1, 'a bare array becomes a bed list');
  ok(oai.extractJson('I could not find any beds.') === null, 'prose with no JSON is null, not a throw');
  ok(oai.extractJson('') === null, 'an empty reply is null');
  // The greedy brace hunt must not truncate a nested object.
  const nested = oai.extractJson('noise {"beds":[{"x0":1,"meta":{"a":{"b":2}}}]} more noise');
  ok(nested && nested.beds[0].meta.a.b === 2, 'a nested object is not cut short');
}

console.log('reply — the list is found whatever the key is called');
{
  ok(oai.bedList({ beds: [1] }).length === 1, 'beds');
  ok(oai.bedList({ predictions: [1, 2] }).length === 2, 'predictions');
  ok(oai.bedList({ objects: [1] }).length === 1, 'objects');
  ok(oai.bedList([1, 2, 3]).length === 3, 'a bare array');
  ok(oai.bedList({ x0: 1, y0: 2, x1: 3, y1: 4 }).length === 1, 'a single bed returned unwrapped');
  ok(oai.bedList({ note: 'no beds here' }).length === 0, 'an answer with no boxes is empty, not garbage');
  ok(oai.bedList(null).length === 0, 'null is empty');
}

console.log('reply — every box shape a model has produced');
{
  const spec = oai.gridSpec({ w: 1000, h: 1000, pitch: 100 });
  const eq = (r, a, b, c, d, what) =>
    ok(r && near(r.x0, a) && near(r.y0, b) && near(r.x1, c) && near(r.y1, d),
      `${what}: expected ${a},${b},${c},${d} got ${r ? `${r.x0},${r.y0},${r.x1},${r.y1}` : 'null'}`);

  eq(oai.rectFromReply({ x0: 10, y0: 20, x1: 30, y1: 50 }, spec), 10, 20, 30, 50, 'corners');
  eq(oai.rectFromReply({ x0: 30, y0: 50, x1: 10, y1: 20 }, spec), 10, 20, 30, 50, 'corners, swapped');
  eq(oai.rectFromReply({ x: 20, y: 35, width: 20, height: 30 }, spec), 10, 20, 30, 50, 'centre plus size');
  // By NAME, not by inspection, and matching furniture.js so the same array
  // cannot mean two things in two files.
  eq(oai.rectFromReply({ bbox: [10, 20, 30, 50] }, spec), 10, 20, 40, 70, 'bbox read as x,y,w,h');
  eq(oai.rectFromReply({ box: [10, 20, 30, 50] }, spec), 10, 20, 40, 70, 'box likewise');
  eq(oai.rectFromReply({ xyxy: [10, 20, 30, 50] }, spec), 10, 20, 30, 50, 'xyxy read as corners');
  eq(oai.rectFromReply({ colFrom: 'C', colTo: 'F', rowFrom: 4, rowTo: 6 }, spec), 200, 300, 600, 600, 'a cell range');
  eq(oai.rectFromReply({ colFrom: 'C', rowFrom: 4 }, spec), 200, 300, 300, 400, 'a single cell with no end given');
  eq(oai.rectFromReply({ cells: ['C4', 'F6', 'D5'] }, spec), 200, 300, 600, 600, 'a list of cells');
  eq(oai.rectFromReply({ x0: '10', y0: '20', x1: '30', y1: '50' }, spec), 10, 20, 30, 50, 'numbers sent as strings');
  ok(oai.rectFromReply({ confidence: 0.9, note: 'a bed' }, spec) === null, 'an entry with no box is null');
  ok(oai.rectFromReply(null, spec) === null, 'null is null');
}

// --- the payload ------------------------------------------------------------

console.log('payload — the centre convention, which is the one that hurts');
{
  const p = oai.replyToPayload('{"beds":[{"x0":100,"y0":200,"x1":220,"y1":330,"confidence":0.9}]}',
    { w: 1000, h: 800, arm: 'gridPixels' });
  const b = p.predictions[0];
  ok(near(b.x, 160) && near(b.y, 265), `x,y is the CENTRE (160,265), got ${b.x},${b.y}`);
  ok(near(b.width, 120) && near(b.height, 130), `size is 120x130, got ${b.width}x${b.height}`);
  ok(p.image.width === 1000 && p.image.height === 800,
    'the payload declares the space its boxes are in, so rescaleRect can map them back');
}

console.log('payload — fractions are resolved against the image');
{
  const p = oai.replyToPayload('{"beds":[{"x0":0.1,"y0":0.25,"x1":0.22,"y1":0.4125}]}',
    { w: 1000, h: 800, arm: 'bounds' });
  const b = p.predictions[0];
  ok(near(b.width, 120) && near(b.height, 130), `0.12x0.1625 of 1000x800 is 120x130, got ${b.width}x${b.height}`);
  ok(near(b.x, 160) && near(b.y, 265), 'and lands in the right place');

  // The trap: a pixel box that happens to be inside 0..1 is not a fraction, and
  // an arm that was NOT asked for fractions must not have them applied.
  const px = oai.replyToPayload('{"beds":[{"x0":0.1,"y0":0.25,"x1":0.22,"y1":0.41}]}',
    { w: 1000, h: 800, arm: 'gridPixels' });
  ok(near(px.predictions[0].width, 0.12), 'the gridPixels arm is taken at its word, not rescaled');
}

console.log('payload — units, and the one-value-out-of-range trap');
{
  const px = (r) => `${Math.round(r.width)}x${Math.round(r.height)}`;
  // The defect this exists for: a bed flush against a wall comes back with one
  // value marginally outside 0..1, the old all-or-nothing gate read the whole
  // box as PIXELS, and a 0.35px box was dropped downstream as "too small to be
  // furniture". The bed vanished and the detector got the blame.
  const flush = oai.replyToPayload('{"beds":[{"x0":-0.004,"y0":0.3,"x1":0.35,"y1":0.62}]}',
    { w: 1600, h: 1000, arm: 'bounds' });
  ok(flush.predictions.length === 1, 'a box slightly off the edge is not thrown away');
  ok(near(flush.predictions[0].width, 560, 1),
    `and is clamped to the edge, not reinterpreted as pixels — got ${px(flush.predictions[0])}`);

  const over = oai.replyToPayload('{"beds":[{"x0":0.1,"y0":0.3,"x1":1.02,"y1":0.62}]}',
    { w: 1600, h: 1000, arm: 'bounds' });
  ok(near(over.predictions[0].width, 1440, 1),
    `and the same at the far edge — got ${px(over.predictions[0])}`);

  // Percent. Read as pixels this is a bed 22px wide on a 1600px plan, which the
  // area floor discards — reported as "found nothing" rather than "wrong units".
  const pct = oai.replyToPayload('{"beds":[{"x0":17,"y0":30,"x1":39,"y1":62}]}',
    { w: 1600, h: 1000, arm: 'bounds' });
  ok(near(pct.predictions[0].width, 352, 1), `percent is recognised, got ${px(pct.predictions[0])}`);
  ok(pct.predictions[0].unit === 'percent', 'and says so, so a run can be diagnosed');

  // A grid arm is in pixels and must not be touched by any of the above.
  const pixels = oai.replyToPayload('{"beds":[{"x0":17,"y0":30,"x1":39,"y1":62}]}',
    { w: 1600, h: 1000, arm: 'gridPixels' });
  ok(near(pixels.predictions[0].width, 22), 'a grid arm is taken at its word');
}

console.log('payload — the class is ours, the model\'s word is a label');
{
  // "double bed" as a CLASS is rejected downstream as "not a class we zone",
  // which is a detection thrown away over a synonym.
  const p = oai.replyToPayload('{"beds":[{"x0":0.1,"y0":0.1,"x1":0.3,"y1":0.4,"class":"double bed"}]}',
    { w: 1000, h: 1000, arm: 'bounds' });
  ok(p.predictions[0].class === 'bed', `class is always 'bed', got "${p.predictions[0].class}"`);
  ok(p.predictions[0].label === 'double bed', 'and its own word survives where nothing filters on it');
  const { kept } = detectionsToZones(p, { image: { w: 1000, h: 1000 }, polygon: null });
  ok(kept.length === 1, 'so it is not rejected as a class we do not zone');
}

console.log('payload — a rejected entry cannot come back as a prediction');
{
  // furniture.js walks for GEOMETRY, not for a key. A skipped entry left in the
  // payload as an object gets re-examined downstream and can be collected —
  // which makes `skipped` a lie about what did not become a zone.
  const p = oai.replyToPayload(
    '{"beds":[{"class":"bed","points":[{"x":10,"y":10},{"x":90,"y":10},{"x":90,"y":90}]},'
    + '{"x0":0.1,"y0":0.1,"x1":0.4,"y1":0.5}]}', { w: 1000, h: 1000, arm: 'bounds' });
  ok(p.skipped.length === 1, 'the unreadable entry is recorded');
  ok(typeof p.skipped[0].raw === 'string', 'as a string, which the walker cannot mistake for a box');
  const { kept } = detectionsToZones(p, { image: { w: 1000, h: 1000 }, polygon: null });
  ok(kept.length === 1, `only the readable box becomes a detection, got ${kept.length}`);
}

console.log('payload — the junk that has to be dropped, and the junk that must not be');
{
  const p = oai.replyToPayload(
    '{"beds":[{"x0":10,"y0":10,"x1":10,"y1":50},{"confidence":0.8},{"x0":1,"y0":1,"x1":9,"y1":9}]}',
    { w: 100, h: 100, arm: 'gridPixels' });
  ok(p.predictions.length === 1, `only the real box survives, got ${p.predictions.length}`);
  ok(p.skipped.length === 2, 'and the two that did not are reported rather than vanishing');
  ok(p.skipped.some((s) => /zero-area/.test(s.reason)), 'a zero-width box is named as such');

  const noConf = oai.replyToPayload('{"beds":[{"x0":1,"y0":1,"x1":9,"y1":9}]}', { w: 100, h: 100 });
  ok(noConf.predictions[0].confidence >= 0.35,
    'a bed with no confidence gets one above the floor, or it would be silently dropped later');

  const empty = oai.replyToPayload('{"beds":[]}', { w: 100, h: 100 });
  ok(empty.predictions.length === 0, 'an honest empty answer produces an empty payload, not a throw');
}

console.log('payload — the room name rides along');
{
  const p = oai.replyToPayload('{"beds":[{"x0":1,"y0":1,"x1":9,"y1":9,"room":"MASTER BEDROOM"}]}',
    { w: 100, h: 100 });
  ok(p.predictions[0].room === 'MASTER BEDROOM',
    'the one thing a general model gives us that a box detector cannot');
}

// --- the prompts ------------------------------------------------------------

console.log('prompt — each arm asks for what it can parse');
{
  const spec = oai.gridSpec({ w: 1600, h: 1200, pitch: 100 });
  const f = oai.buildPrompt('bounds', { w: 1600, h: 1200 });
  ok(/1600/.test(f) && /1200/.test(f), 'the bounds arm states the pixel size');
  ok(/"x0"/.test(f), 'and shows the shape it wants');

  const gp = oai.buildPrompt('gridPixels', { w: 1600, h: 1200, spec });
  ok(/every\s*\n?100 pixels|every 100/.test(gp.replace(/\n/g, ' ')), 'the pixel arm states the pitch');
  ok(/READ the printed numbers/.test(gp), 'and tells it to read rather than estimate');

  const gc = oai.buildPrompt('gridCells', { w: 1600, h: 1200, spec });
  ok(/A to P/.test(gc.replace(/\n/g, ' ')), `the cell arm names the last column, got: ${gc.match(/Columns[^.]*/)}`);
  ok(/Do NOT give pixel coordinates/.test(gc), 'and forbids pixels outright');

  for (const arm of oai.ARMS) {
    const t = oai.buildPrompt(arm, { w: 100, h: 100, spec });
    ok(/empty list/.test(t), `${arm} permits an empty answer — a confident wrong box is worse`);
    ok(/EVERY bed/.test(t), `${arm} asks for every bed, because the room filter comes later`);
    ok(/room name printed on the plan/.test(t), `${arm} asks for the room label`);
  }
  let threw = false;
  try { oai.buildPrompt('nonsense', { w: 1, h: 1 }); } catch { threw = true; }
  ok(threw, 'an unknown arm throws at build time rather than sending a broken prompt');
}

console.log('request — the parameters that get a 400 are the ones left out');
{
  const body = oai.buildRequest({ arm: 'bounds', base64: 'AAAA', w: 100, h: 100, model: 'x' });
  ok(!('temperature' in body), 'no temperature — the reasoning models reject it');
  ok(!('max_tokens' in body) && 'max_completion_tokens' in body, 'max_completion_tokens, not max_tokens');
  ok(body.response_format?.type === 'json_object', 'JSON mode by default');
  ok(!('response_format' in oai.buildRequest({ arm: 'bounds', base64: 'A', w: 1, h: 1, jsonMode: false })),
    'and droppable for a model that refuses it');
  const img = body.messages[0].content.find((c) => c.type === 'image_url');
  ok(img.image_url.url.startsWith('data:image/jpeg;base64,AAAA'), 'the image goes as a data URL');
  ok(img.image_url.detail === 'high', 'at high detail — a floor plan is fine line work');
  let threw = false;
  try { oai.buildRequest({ arm: 'bounds', w: 1, h: 1 }); } catch { threw = true; }
  ok(threw, 'no image is an error, not an empty call that costs money');
}

// --- the claim that matters -------------------------------------------------

console.log('flow — an OpenAI reply becomes a no-light zone, with nothing changed downstream');
{
  const PX_PER_FT = 20;
  const IMG = { w: 1200, h: 900 };
  // The image was sent at half size, as the app's downscale would.
  const SENT = { w: 600, h: 450 };
  const ROOM_PX = [
    { x: 100, y: 100 }, { x: 580, y: 100 }, { x: 580, y: 400 }, { x: 100, y: 400 },
  ];

  // A 6 x 6.5ft bed with its top-left corner 3ft into the room, described the
  // way the model would describe it: in the SENT image's pixels.
  const x0 = (100 + 3 * PX_PER_FT) / 2, y0 = (100 + 3 * PX_PER_FT) / 2;
  const reply = JSON.stringify({ beds: [{
    x0, y0, x1: x0 + (6 * PX_PER_FT) / 2, y1: y0 + (6.5 * PX_PER_FT) / 2,
    confidence: 0.88, room: 'MASTER BEDROOM',
  }] });

  const payload = oai.replyToPayload(reply, { w: SENT.w, h: SENT.h, arm: 'gridPixels' });
  const { kept } = detectionsToZones(payload, { image: IMG, polygon: null });
  ok(kept.length === 1, `the bed survives the guards, got ${kept.length}`);

  // The rescale from sent-space to original pixels is furniture.js's job and it
  // has to have happened, or the bed is in the wrong half of the room.
  ok(near(kept[0].rect.x0, 160, 1), `mapped back to full size (160), got ${kept[0].rect.x0}`);

  const live = kept.filter((k) => pointInPolygon(rectCentre(k.rect), ROOM_PX));
  ok(live.length === 1, 'and its centre is inside the room being lit');

  const zones = zonesFromDetections(live, { image: IMG, pxPerFt: PX_PER_FT });
  const origin = { x: 100, y: 100 };
  const toFt = (p) => ({ x: (p.x - origin.x) / PX_PER_FT, y: (p.y - origin.y) / PX_PER_FT });
  const zonesFt = zones.map((z) => {
    const a = toFt({ x: z.x0, y: z.y0 }), c = toFt({ x: z.x1, y: z.y1 });
    return { x0: a.x, y0: a.y, x1: c.x, y1: c.y };
  });
  ok(near(zonesFt[0].x1 - zonesFt[0].x0, 6.5, 0.05),
    `6ft bed plus 0.25ft padding each side is 6.5ft, got ${(zonesFt[0].x1 - zonesFt[0].x0).toFixed(2)}`);

  const plan = planLights(ROOM_PX.map(toFt), [], { ...DEFAULTS }, zonesFt);
  ok(plan.lights.length > 0, 'the room still gets lights');
  const z = zonesFt[0];
  const over = plan.lights.filter((l) => l.x > z.x0 && l.x < z.x1 && l.y > z.y0 && l.y < z.y1);
  ok(over.length === 0, `NO LIGHT OVER THE BED — found ${over.length}`);
}

console.log('flow — the quantised arm over-covers, and never under-covers');
{
  // gridCells rounds outward to whole cells. That is a bounded error in the
  // SAFE direction for a no-light zone, and this is the assertion that says so
  // — if a future change makes it round to nearest, a zone can miss the pillow.
  const spec = oai.gridSpec({ w: 1000, h: 1000, pitch: 100 });
  const truth = { x0: 215, y0: 315, x1: 580, y1: 595 };
  const quantised = oai.cellRangeToRect({ colFrom: 'C', colTo: 'F', rowFrom: 4, rowTo: 6 }, spec);
  ok(quantised.x0 <= truth.x0 && quantised.y0 <= truth.y0
    && quantised.x1 >= truth.x1 && quantised.y1 >= truth.y1,
    'the quantised box CONTAINS the bed');
  const area = (r) => (r.x1 - r.x0) * (r.y1 - r.y0);
  ok(area(quantised) > area(truth), 'by taking in more ceiling than the bed needs');
  // The cost grows with the cell, which is the whole reason the eval reports a
  // per-arm ceiling instead of just a score.
  const coarse = oai.cellRangeToRect({ colFrom: 'A', colTo: 'C', rowFrom: 2, rowTo: 3 },
    oai.gridSpec({ w: 1000, h: 1000, pitch: 200 }));
  ok(iou(coarse, truth) < iou(quantised, truth),
    'and grows with the cell size — which is why the eval prints the arm ceiling next to the score');
}

console.log(`\n${checks - fails}/${checks} checks passed`);
if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
