// ---------------------------------------------------------------------------
// test-doors.mjs — the scale, taken off a door.
//
// THIS IS THE MOST LOAD-BEARING NUMBER IN THE APP. Everything downstream is
// stated in feet: the 50 sqft cell, the 5 ft wall rule, the fan clearance, every
// fitting position, every export. A px/ft that is 30% out does not produce a
// visibly broken drawing — it produces a plausible one for the wrong building.
// So the arithmetic here gets tested against the real response shape rather
// than a tidied one, and the failure modes get names.
//
//   node tools/test-doors.mjs
// ---------------------------------------------------------------------------

import { DOOR_WIDTHS, DOOR_DEFAULTS, MM_PER_FT, openingPx, scaleFromDoor,
         doorWidthAt, doorsFromPayload, median, planSizeFt } from '../src/lib/doors.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// THE REAL RESPONSE, from the workflow, shape and all: a top-level ARRAY holding
// an annotated output_image we do not want and a predictions.predictions we do,
// with the model's own image size alongside. The first box is verbatim from the
// sample; the rest are the other doors on that plan.
const IMAGE = { width: 1042, height: 1642 };
const pred = (x, y, w, h, conf = 0.99, cls = 'door') => ({
  width: w, height: h, x, y, confidence: conf, class_id: 0, class: cls,
  detection_id: `${x}-${y}`,
});
const RESPONSE = [{
  count_objects: 5,
  output_image: 'data:image/jpeg;base64,' + 'A'.repeat(4000),
  predictions: {
    image: IMAGE,
    predictions: [
      pred(753, 181.5, 150, 193, 0.9999998807907104),
      pred(413, 762, 120, 115, 0.97),
      pred(551, 1006, 120, 145, 0.96),
      pred(757, 1152, 105, 95, 0.93),
      pred(884, 44, 112, 96, 0.71),
    ],
  },
}];

console.log('-- the response, three levels of nesting deep --');
{
  const { doors, rejected } = doorsFromPayload(RESPONSE, { image: { w: 1042, h: 1642 } });
  ok(doors.length === 5, `all five come out of predictions.predictions: ${doors.length}`);
  ok(rejected.length === 0, `and nothing was rejected: ${rejected.map((r) => r.reason).join('; ')}`);
  ok(doors.every((d) => d.rect.x1 > d.rect.x0 && d.rect.y1 > d.rect.y0), 'every box has area');

  // Roboflow's x,y is the CENTRE. Getting this backwards puts every door half a
  // door up and left, which is invisible on a thumbnail and wrong everywhere.
  const first = doors.find((d) => Math.abs(d.rect.x0 - (753 - 75)) < 1);
  ok(!!first, 'x,y is read as the centre of the box, not its corner');
  ok(first && near(first.rect.x1 - first.rect.x0, 150) && near(first.rect.y1 - first.rect.y0, 193),
    'and the size survives intact');

  // The annotated picture in the payload is a 4KB string that looks like
  // nothing; it must not become a door.
  ok(!doors.some((d) => d.openingPx > 500), 'the output_image blob does not parse as a detection');
}

console.log('\n-- the shorter side is the opening --');
{
  // The swing arc's radius IS the leaf length, so both sides of a clean box
  // equal the door width; the longer one is the one that picked up the wall.
  ok(openingPx({ x0: 0, y0: 0, x1: 150, y1: 193 }) === 150, '150 x 193 reads as a 150px opening');
  ok(openingPx({ x0: 0, y0: 0, x1: 193, y1: 150 }) === 150, '...whichever way round the door faces');
}

console.log('\n-- the arithmetic --');
{
  const rect = { x0: 0, y0: 0, x1: 150, y1: 193 };
  // 900mm = 2.953 ft. 150px over that is 50.8 px/ft.
  const s = scaleFromDoor(rect, 900);
  ok(near(s, 150 / (900 / MM_PER_FT), 1e-9), `900mm on a 150px opening: ${s.toFixed(2)} px/ft`);

  // NAMING A WIDER DOOR MAKES THE DRAWING SMALLER, and this is the sanity
  // check a user can actually perform. The same box called 1200 instead of 900
  // scales the whole plan by 0.75.
  ok(near(scaleFromDoor(rect, 1200) / s, 0.75, 1e-9),
    'the same box called 1200 rather than 900 shrinks the scale by exactly 3/4');
  ok(scaleFromDoor(rect, 750) > s, 'and calling it 750 makes it larger');

  // Round trip.
  ok(near(doorWidthAt(rect, s), 900, 1e-6), 'and it inverts: the door measures 900mm at its own scale');

  ok(scaleFromDoor(rect, 0) === null, 'a zero width is refused rather than dividing by it');
  ok(scaleFromDoor({ x0: 5, y0: 5, x1: 5, y1: 5 }, 900) === null, 'and so is a box with no size');
}

console.log('\n-- and it lands on a plausible building --');
{
  // The whole point of the number. This plan is 1042 x 1642 at whatever scale
  // one 900mm door implies; the answer has to look like a flat.
  const { doors } = doorsFromPayload(RESPONSE, { image: { w: 1042, h: 1642 } });
  const s = scaleFromDoor(doors[0].rect, 900);
  const size = planSizeFt({ w: 1042, h: 1642 }, s);
  ok(size.widthFt > 15 && size.widthFt < 60,
    `the sheet comes out ${size.widthFt.toFixed(1)} x ${size.heightFt.toFixed(1)} ft — a flat, not a stadium`);
}

console.log('\n-- the image the model answered about is not the one we hold --');
{
  // The client downscales to 1600px before sending, and the workflow may resize
  // again. Get this wrong and every door is out by the ratio — which is not a
  // wonky box, it is the whole drawing at the wrong scale, silently.
  const bigger = doorsFromPayload(RESPONSE, { image: { w: 2084, h: 3284 } });
  const same = doorsFromPayload(RESPONSE, { image: { w: 1042, h: 1642 } });
  ok(near(bigger.doors[0].openingPx, same.doors[0].openingPx * 2, 1e-6),
    'a response about a half-size image is doubled back onto the original');

  // Fractions instead of pixels, which some models emit.
  const frac = [{ predictions: { image: IMAGE, predictions: [
    { x: 0.5, y: 0.5, width: 0.1, height: 0.12, confidence: 0.9, class: 'door' }] } }];
  const f = doorsFromPayload(frac, { image: { w: 1000, h: 1000 } });
  ok(f.doors.length === 1 && near(f.doors[0].openingPx, 100, 1e-6),
    `0..1 fractions resolve against the real image: ${f.doors[0]?.openingPx}`);
}

console.log('\n-- what is thrown away, and why --');
{
  const img = { w: 1042, h: 1642 };
  const one = (p) => doorsFromPayload([{ predictions: { image: IMAGE, predictions: [p] } }], { image: img });

  ok(one(pred(500, 500, 120, 120, 0.2)).doors.length === 0, 'a low-confidence guess is not a ruler');
  ok(one(pred(500, 500, 900, 1400)).doors.length === 0, 'a whole room boxed as a door is a misfire');
  ok(one(pred(500, 500, 3, 3)).doors.length === 0, 'and a speck is noise');

  // 2.2:1 is the cut. A leaf plus a swing is square give or take the frame;
  // long and thin is two doors boxed together, or a corridor.
  ok(one(pred(500, 500, 120, 400)).doors.length === 0, 'a 3:1 box is not a leaf and a swing');
  ok(one(pred(500, 500, 120, 240)).doors.length === 1, '...but 2:1 still is');

  ok(one(pred(500, 500, 120, 120, 0.9, 'window')).doors.length === 0, 'a window is not a door');
  // A workflow whose author named the class `0`, or nothing, is not returning
  // something else — it answers one question.
  ok(one(pred(500, 500, 120, 120, 0.9, '')).doors.length === 1, 'an unnamed class is taken at its word');
  ok(one(pred(500, 500, 120, 120, 0.9, '0')).doors.length === 1, "...and so is `0`");

  // Two boxes over one door is one door.
  const dup = doorsFromPayload([{ predictions: { image: IMAGE, predictions: [
    pred(753, 181.5, 150, 193, 0.99), pred(757, 185, 148, 190, 0.85)] } }], { image: img });
  ok(dup.doors.length === 1, `overlapping boxes collapse: ${dup.doors.length}`);
  ok(near(dup.doors[0].conf, 0.99), 'and the better one survives');

  ok(doorsFromPayload(null, { image: img }).doors.length === 0, 'a null payload is no doors, not a throw');
  ok(doorsFromPayload([], { image: img }).doors.length === 0, 'and so is an empty one');
}

console.log('\n-- the order is the offer --');
{
  // The user is picking a ruler for the whole drawing, so the door put in front
  // of them should be the most TYPICAL, not the most confident: a confident
  // detection of the one odd door on the sheet is a worse ruler than an
  // ordinary one.
  const { doors, medianPx } = doorsFromPayload(RESPONSE, { image: { w: 1042, h: 1642 } });
  ok(medianPx !== null, `there is a median opening: ${medianPx}px`);
  ok(doors[0].typical === true, 'the first offered door is marked as the suggestion');
  ok(doors.filter((d) => d.typical).length === 1, 'and exactly one is');
  const first = Math.abs(doors[0].openingPx - medianPx);
  ok(doors.every((d) => Math.abs(d.openingPx - medianPx) >= first - 1e-9),
    'nothing offered is closer to the median than the one offered first');

  // A wildly confident outlier does not jump the queue.
  const odd = doorsFromPayload([{ predictions: { image: IMAGE, predictions: [
    pred(100, 100, 300, 300, 0.999), pred(400, 400, 120, 120, 0.7),
    pred(600, 600, 118, 122, 0.7), pred(800, 800, 122, 118, 0.7)] } }],
    { image: { w: 1042, h: 1642 } });
  ok(odd.doors[0].openingPx < 200,
    `a confident 300px outlier does not become the suggestion: ${odd.doors[0].openingPx}px`);

  ok(doors.every((d) => d.id), 'every door has a stable id to select by');
  ok(new Set(doors.map((d) => d.id)).size === doors.length, 'and the ids are unique');
}

console.log('\n-- the vocabulary --');
{
  ok(DOOR_WIDTHS.map((w) => w.mm).join(',') === '750,900,1200', 'three widths, in order');
  ok(DOOR_WIDTHS.every((w) => w.label && w.note), 'each with a label and what it is for');
  ok(near(MM_PER_FT, 304.8), 'and a foot is 304.8mm');
  ok(median([]) === null && median([5]) === 5 && median([1, 3]) === 2, 'median handles the small cases');
  ok(planSizeFt(null, 20) === null && planSizeFt({ w: 100, h: 100 }, 0) === null,
    'planSizeFt refuses rather than dividing by zero');
  ok(DOOR_DEFAULTS.maxAspect > 1, 'the aspect cut is a real number');
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
