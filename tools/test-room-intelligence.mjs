/**
 * THE PURE HALF OF features/room-intelligence/.
 *
 * What each room pass does with an answer once it has one, and the fold that
 * turns a batch of bed-fit records into the document's verdicts. None of it
 * needs React, a canvas or a network, which is why it is out of the controllers
 * and why it can be checked here.
 */
import assert from 'node:assert/strict';
import {
  accentResultFrom, surfaceResultFrom,
  wallElementsFrom, wallResultFrom, wallResultNoneSeen,
} from '../src/features/room-intelligence/passResults.js';
import { absorbContest } from '../src/features/room-intelligence/bedContest.js';

// A 40ft x 20ft room at 10 px/ft, and a crop that sits 100px into the sheet.
const PX_PER_FT = 10;
const polygonPx = [{ x: 100, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 300 }, { x: 100, y: 300 }];
const room = {
  id: 'r1',
  outline: { name: 'Bedroom 1' },
  stats: { widthFt: 40, heightFt: 20, areaSqft: 800 },
  plan: { polygonPx },
};
// The model answers in the SENT image's pixels; the crop maps them back.
const shot = { crop: { x0: 100, y0: 100, x1: 500, y1: 300 } };
const image = { width: 200, height: 100 };            // sent at half scale

// --- accents ---------------------------------------------------------------
//
// The crop-to-plan conversion, the bed substitution and the rules, in one call.
const accentRes = {
  image,
  furniture: [
    // A wardrobe at the far wall, in sent pixels -> doubled and offset by 100.
    { type: 'wardrobe', rect: { x0: 10, y0: 5, x1: 60, y1: 15 }, confidence: 0.8 },
    // The accent pass's own idea of the bed. Always dropped.
    { type: 'bed', rect: { x0: 80, y0: 40, x1: 140, y1: 90 }, confidence: 0.7 },
    // Its rule is the one that deliberately emits nothing — never a sconce
    // beside a sofa — so it is handled and produces no fitting.
    { type: 'sofa', rect: { x0: 0, y0: 0, x1: 10, y1: 10 }, confidence: 0.4 },
  ],
};
const measuredBed = {
  id: 'det-1', conf: 0.95, refound: true,
  rect: { x0: 260, y0: 180, x1: 340, y1: 280 },       // centre inside polygonPx
};

const withBed = accentResultFrom({
  res: accentRes, room, shot, beds: [measuredBed], pxPerFt: PX_PER_FT,
});
assert.deepEqual(withBed.furniture[0].rect,
  { x0: 260, y0: 180, x1: 340, y1: 280 },
  'the authoritative bed comes first and keeps its own plan-pixel rect');
assert.equal(withBed.furniture[0].id, 'furn-r1-bed-0');
assert.equal(withBed.furniture[0].from, 'gpt-bedroom-crop');
assert.equal(withBed.furniture[0].confidence, 0.95);
assert.deepEqual(withBed.furniture.map((f) => f.type), ['bed', 'wardrobe', 'sofa'],
  'the pass\'s own bed box is out and the measured one is in, ahead of the rest');
assert.deepEqual(withBed.furniture[1].rect,
  { x0: 120, y0: 110, x1: 220, y1: 130 },
  'a sent-pixel rect is scaled by the crop and offset onto the sheet');
assert.equal(withBed.furniture[1].label, 'Wardrobe');
assert.equal(withBed.furniture[1].id, 'furn-r1-0',
  'ids are positional in the ORIGINAL answer, not in the substituted list');
assert.equal(withBed.bedsFromAccentPass.length, 1, 'the discarded bed box is kept for the audit');
assert.equal(withBed.bedsFromAccentPass[0].type, 'bed');
assert.ok(withBed.zones.length, 'the rules ran');
assert.ok(withBed.zones.every((z) => z.roomId === 'r1'), 'every zone knows its room');
assert.ok(withBed.zones.every((z, i) => z.id === `acc-r1-${i}`), 'zone ids are positional');
assert.ok(withBed.zones.every((z) => z.colour && z.label && z.short),
  'the type table is applied to every zone');
assert.ok(withBed.zones.every((z) => !('runFt' in z)),
  'no cached length is stamped on a zone — feet are derived where they are shown');
assert.ok(withBed.zones.some((z) => z.type === 'sconce'),
  'a measured bed becomes bedside sconces');
assert.ok(withBed.handled.some((h) => h.type === 'sofa' && h.emitted === 0),
  'every item is reported as handled, including the ones whose rule emits nothing');
assert.deepEqual(withBed.handled.map((h) => h.type), ['bed', 'wardrobe', 'sofa'],
  'the handled list is the list the rules actually saw');

// NO AUTHORITATIVE BED MEANS NO SCONCES, and the room keeps everything else.
const noBed = accentResultFrom({ res: accentRes, room, shot, beds: [], pxPerFt: PX_PER_FT });
assert.deepEqual(noBed.furniture.map((f) => f.type), ['wardrobe', 'sofa']);
assert.equal(noBed.zones.filter((z) => z.from === 'bed').length, 0,
  'the accent pass\'s belief in a bed is never promoted to a position');
assert.ok(noBed.zones.length, 'the wardrobe strip is still placed');
assert.equal(noBed.bedsFromAccentPass.length, 1);

// A bed OUTSIDE the room is somebody else's, even when it is passed in.
const elsewhere = accentResultFrom({
  res: accentRes, room, shot, pxPerFt: PX_PER_FT,
  beds: [{ id: 'det-2', rect: { x0: 900, y0: 900, x1: 980, y1: 1000 } }],
});
assert.equal(elsewhere.furniture.filter((f) => f.type === 'bed').length, 0);

// `beds` not passed at all is the same as none found — not "trust the pass".
const noArg = accentResultFrom({ res: accentRes, room, shot, pxPerFt: PX_PER_FT });
assert.deepEqual(noArg.furniture.map((f) => f.type), ['wardrobe', 'sofa']);

// The answer is not mutated on the way through.
const before = structuredClone(accentRes);
accentResultFrom({ res: accentRes, room, shot, beds: [measuredBed], pxPerFt: PX_PER_FT });
assert.deepEqual(accentRes, before, 'the payload is left alone');

// --- task surfaces ---------------------------------------------------------
const surfaces = surfaceResultFrom({
  res: { image, surfaces: [{ type: 'dining_table', rect: { x0: 10, y0: 10, x1: 60, y1: 35 } }] },
  room, shot, pxPerFt: PX_PER_FT,
});
assert.deepEqual(surfaces.surfaces[0].rect, { x0: 120, y0: 120, x1: 220, y1: 170 });
assert.equal(surfaces.surfaces[0].id, 'surf-r1-0');
assert.equal(surfaces.surfaces[0].roomId, 'r1');
assert.equal(surfaces.surfaces[0].label, 'Dining table');
assert.equal(surfaces.surfaces[0].widthFt, 10);
assert.equal(surfaces.surfaces[0].heightFt, 5);
const noScale = surfaceResultFrom({
  res: { image, surfaces: [{ type: 'dining_table', rect: { x0: 0, y0: 0, x1: 10, y1: 10 } }] },
  room, shot, pxPerFt: null,
});
assert.equal(noScale.surfaces[0].widthFt, null, 'no scale is null and not zero');
assert.equal(noScale.surfaces[0].heightFt, null);

// --- the render pass -------------------------------------------------------
const elements = wallElementsFrom({
  res: { elements: [{ type: 'panelling', wall: 'North' }, { type: 'painting', wall: 'East' }] },
  roomId: 'r1',
});
assert.deepEqual(elements.map((e) => e.id), ['wall-r1-0', 'wall-r1-1']);
assert.equal(elements[0].label, 'Panelling');
assert.ok(elements[0].colour);
assert.deepEqual(wallElementsFrom({ res: null, roomId: 'r1' }), [],
  'a first call that came back with nothing is an empty list, not a throw');

assert.deepEqual(wallResultNoneSeen({ first: { skipped: ['a mirror'] } }),
  { elements: [], skipped: ['a mirror'], placedNone: false },
  'nothing seen is an answer and never reports itself as unplaced');
assert.deepEqual(wallResultNoneSeen({ first: {} }).skipped, []);

// The join is by index first, then by type-and-wall, and it invents nothing.
const joined = wallResultFrom({
  elements,
  first: { skipped: ['a rug'] },
  second: {
    matched: true, skipped: ['a lamp'],
    // Out of order, so the index try fails and the type/wall key has to work.
    placed: [{ type: 'painting', wall: 'east', cells: ['E3'] },
             { type: 'panelling', wall: 'north', cells: ['N1', 'N2'] }],
  },
});
assert.deepEqual(joined.elements.map((e) => e.cells), [['N1', 'N2'], ['E3']]);
assert.deepEqual(joined.skipped, ['a rug', 'a lamp'], 'both calls\' skips survive, first call first');
assert.equal(joined.placedNone, false);
const unmatched = wallResultFrom({ elements, first: {}, second: { matched: false, placed: [] } });
assert.deepEqual(unmatched.elements.map((e) => e.cells), [[], []],
  'an element that came back without cells is not given any');
assert.equal(unmatched.placedNone, true, '"no array at all" is a state the panel can name');
assert.equal(wallResultFrom({ elements, first: {}, second: null }).placedNone, true);

// --- bed-fit adjudication --------------------------------------------------
const bedBox = (id, x) => ({ id, cls: 'bed', rect: { x0: x, y0: 0, x1: x + 60, y1: 80 } });
const rfA = bedBox('det-rf-0', 0);       // room A, Roboflow
const gpA = bedBox('det-gp-0', 2);       // room A, GPT — the same mattress
const rfLoose = bedBox('det-rf-9', 900); // in no traced room
const gpLoose = bedBox('det-gp-9', 902); // ...and the same one again

const { verdicts, won } = absorbContest([
  { id: 'a', name: 'Bedroom 1', a: [rfA], b: [gpA],
    rec: { kind: 'judged', pick: 'a', asked: true, confidence: 0.8, why: 'clearer',
           fellBack: false, winner: [rfA] } },
  { id: 'b', name: 'Study', a: [], b: [],
    rec: { kind: 'none', pick: null, asked: false, winner: [] } },
], { a: [rfA, rfLoose], b: [gpA, gpLoose] });

assert.deepEqual(verdicts.a, {
  kind: 'judged', pick: 'a', asked: true, confidence: 0.8, why: 'clearer',
  fellBack: false, failed: false, counts: { roboflow: 1, openai: 1 },
}, 'one verdict per space, with both detectors\' counts on it');
assert.deepEqual(verdicts.b, {
  kind: 'none', pick: null, asked: false, confidence: 0, why: '',
  fellBack: false, failed: false, counts: { roboflow: 0, openai: 0 },
}, 'a space nobody had to judge still gets a record, with the documented defaults');

const inRooms = won.filter((d) => d.roomId);
assert.deepEqual(inRooms.map((d) => [d.id, d.roomId, d.contest]), [['det-rf-0', 'a', 'judged']],
  'the winning detector\'s box is the one kept, attributed to its room');
const loose = won.filter((d) => !d.roomId);
assert.equal(loose.length, 1, 'the two readings of an untraced bed are merged to one');
assert.equal(loose[0].contest, 'unjudged');
assert.equal(loose[0].roomId, null);
assert.deepEqual(absorbContest([], { a: [], b: [] }), { verdicts: {}, won: [] });
assert.deepEqual(absorbContest([]), { verdicts: {}, won: [] },
  'no sheet-wide lists at all is empty rather than a throw');

console.log('room-intelligence: ok');
