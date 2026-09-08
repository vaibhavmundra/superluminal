/**
 * THE PURE HALF OF features/fixtures/.
 *
 * Which lamps a row lines itself up against, what the two warnings under the
 * pointer say, what a chunk has already been decided at, what the autoplace
 * toggle puts down and what it refuses to, how a lamp nobody overruled follows
 * its chunk afterwards, the two rollbacks that refuse a drop off the plan, what
 * the array bar asks about a run and about a draft, what a fresh pick opens on,
 * and where a module lands on its profile. None of it needs React, a canvas or a
 * pointer — the hooks around it hold nothing but dependency arrays — which is
 * why it is out of the controllers and can be checked here.
 *
 * The numbers follow the other geometry scripts: a 600x360 px room at 30 px/ft,
 * so the room is 20 ft by 12 ft and one foot is thirty pixels.
 *
 *   node tools/test-fixtures.mjs
 */
import assert from 'node:assert/strict';
import {
  lightKey, clampContext, cobAlignTargets, cobWallGuide, chunkSpecInForce,
  absorbAutoplaceSpots,
  autoplaceCobs, reconcileCobSpecs, rollbackCobs, arrayLanded,
  arrayBarFor, arrayDraftBar, nextArrayDraft, draftCount, moduleU,
  gridSpotsOnTrack, gridSpotsOwnedByTrack, roomForTrackPath,
} from '../src/features/fixtures/fixtureRules.js';
import { chunkSpec, WALL_CLEARANCE_FT } from '../src/lib/cob.js';

const PPF = 30;
const polyPx = (x0, y0, x1, y1) => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

/** A cell of the chunker's grid, in plan pixels, with its own feet beside it. */
const cell = (chunk, x0, y0, wFt, hFt) => ({
  id: `${chunk}:${x0}:${y0}`, chunk, x0, y0,
  x1: x0 + wFt * PPF, y1: y0 + hFt * PPF, w: wFt, h: hFt,
  cx: wFt / 2, cy: hFt / 2,
});

/** A lit space in the shape the rules are handed. 20 ft x 12 ft at 30 px/ft. */
const room = ({ cells = [], zonesPx = [], chunks = [] } = {}) => ({
  id: 'r1',
  outline: { name: 'Living' },
  geo: {
    polygonPx: polyPx(0, 0, 600, 360),
    polygonFt: polyPx(0, 0, 20, 12),
    zonesFt: [], fixturesFt: [],
  },
  coves: [],
  plan: { ok: true, polygonPx: polyPx(0, 0, 600, 360),
          gridCellsPx: cells, gridChunksPx: chunks, zonesPx },
});

let n = 0;
const ok = (what) => { n += 1; console.log(`  ok  ${what}`); };

// --------------------------------------------------------------------------
console.log('a new track resolves its room and the grid fallback');
{
  const rooms = [room()];
  rooms[0].geo.polygonPlanFt = polyPx(0, 0, 20, 12);
  assert.equal(roomForTrackPath(rooms,
    [{ x: 4, y: 6 }, { x: 16, y: 6 }], { pxPerFt: PPF })?.id, 'r1');
  ok('the middle of a converted line resolves to its room');
  assert.equal(roomForTrackPath(rooms,
    [{ x: 20, y: 2 }, { x: 20, y: 10 }], { pxPerFt: PPF })?.id, 'r1');
  ok('a converted line on the polygon edge still resolves to that room');

  const placed = gridSpotsOnTrack(
    [{ x: 0, y: 6 }, { x: 20, y: 6 }],
    [{ xFt: 4, yFt: 3, watts: 5 }, { xFt: 10, yFt: 9, watts: 7 },
     { xFt: 16, yFt: 3, watts: 10 }], { watts: [3, 5, 7, 9, 12] });
  assert.equal(placed.length, 3);
  assert.deepEqual(placed.map((p) => p.kind), ['spot', 'spot', 'spot']);
  assert.deepEqual(placed.map((p) => p.watts), [5, 7, 9]);
  assert.ok(placed[0].u < placed[1].u && placed[1].u < placed[2].u);
  ok('a room with no ambient shortfall gets its grid spots projected onto the rail');

  const candidates = [
    { xFt: 3, yFt: 3, gridCells: ['r1|in'],
      cellsFt: [{ x0: 2, y0: 2, x1: 4, y1: 4 }] },
    { xFt: 12, yFt: 3, gridCells: ['r1|near'],
      cellsFt: [{ x0: 11, y0: 2, x1: 13, y1: 4 }] },
  ];
  const loop = polyPx(0, 0, 10, 10);
  assert.deepEqual(gridSpotsOwnedByTrack(loop, candidates, { closed: true }),
    [candidates[0]]);
  ok('a closed manual track owns enclosed grid cells, not nearby cells');
  assert.deepEqual(gridSpotsOwnedByTrack(
    [{ x: 0, y: 3 }, { x: 5, y: 3 }], candidates), [candidates[0]]);
  ok('an open manual track owns only grid cells its centreline crosses');

  const absorbed = absorbAutoplaceSpots({
    spots: [
      { xFt: 5, yFt: 2, watts: 5, beam: 30, gridCell: 'r1|c1' },
      { xFt: 5, yFt: 6, watts: 5, beam: 30, gridCell: 'r1|c2' },
    ],
    tracks: [{ id: 'track-1', roomId: 'r1', closed: false,
      pts: [{ x: 0, y: 0 }, { x: 300, y: 0 }] }],
    fixtures: [{ id: 'd1', trackId: 'track-1', kind: 'diffuser', u: 0.2, watts: 10 }],
    pxPerFt: PPF, roomId: 'r1', absorbFt: 3,
  });
  assert.equal(absorbed.modules.length, 1);
  assert.equal(absorbed.modules[0].gridCells[0], 'r1|c1');
  assert.deepEqual(absorbed.spots.map((s) => s.gridCell), ['r1|c2']);
  ok('later autoplace seats only nearby unowned grid spots on a diffuser track');

  const bare = absorbAutoplaceSpots({
    spots: [{ xFt: 5, yFt: 2, gridCell: 'r1|c1' }],
    tracks: [{ id: 'track-1', roomId: 'r1', closed: false,
      pts: [{ x: 0, y: 0 }, { x: 300, y: 0 }] }],
    fixtures: [], pxPerFt: PPF, roomId: 'r1', absorbFt: 3,
  });
  assert.equal(bare.modules.length, 0);
  ok('a bare magnetic rail does not absorb an Analysis-panel grid spot');
}

// --------------------------------------------------------------------------
console.log('a light is keyed by its room and its cell');
assert.equal(lightKey('r1', 'S7'), 'r1|S7');
ok('the two halves are joined by a bar, which is what the store is keyed on');

// --------------------------------------------------------------------------
console.log('the clamp context carries the cove lines');
{
  const r = { ...room(), coves: [{ line: { a: 1 } }, { line: { a: 2 } }] };
  const ctx = clampContext(r, { centreBand: 0.2 });
  assert.equal(ctx.centreBand, undefined);              // it is under `options`
  assert.equal(ctx.options.centreBand, 0.2);
  assert.deepEqual(ctx.options.coves, [{ a: 1 }, { a: 2 }]);
  assert.equal(ctx.polygon, r.geo.polygonFt);
  assert.equal(ctx.fans, r.geo.fixturesFt);
  assert.equal(ctx.zones, r.geo.zonesFt);
  ok('the settings are spread and the room\'s own cove lines added to them');
}

// --------------------------------------------------------------------------
console.log('a row of lamps lines up against itself');
{
  const cobs = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 200, y: 300 }];
  const t = cobAlignTargets(cobs, { x: 150, y: 260 });
  assert.equal(t.length, 4);                 // one x and one y per lamp
  const xs = t.filter((q) => q.axis === 'x').map((q) => q.value);
  assert.deepEqual(xs, [100, 200]);
  ok('every placed lamp offers a centre on both axes');

  const spanA = t.find((q) => q.axis === 'x' && q.value === 100).span;
  assert.deepEqual(spanA, [100, 260]);
  ok('the span runs from the lamp to the pointer, not round the lamp');

  assert.equal(t.every((q) => q.kind === 'object-centre' && q.label === 'aligned'), true);
  ok('every target is an object centre labelled "aligned"');

  assert.equal(cobAlignTargets(cobs, { x: 0, y: 0 }, 'a').length, 2);
  assert.equal(cobAlignTargets(cobs, { x: 0, y: 0 }, ['a', 'b']).length, 0);
  assert.equal(cobAlignTargets(cobs, { x: 0, y: 0 }, new Set(['b'])).length, 2);
  ok('a lamp cannot be asked to line up with itself — id, array or Set');
}

// --------------------------------------------------------------------------
console.log('the two things worth saying before the click');
{
  const bed = { cls: 'bed', x0: 200, y0: 100, x1: 400, y1: 250 };
  const r = room({ zonesPx: [bed] });
  assert.equal(cobWallGuide({ room: null, at: { x: 300, y: 180 }, pxPerFt: PPF }), null);
  assert.equal(cobWallGuide({ room: r, at: null, pxPerFt: PPF }), null);
  assert.equal(cobWallGuide({ room: r, at: { x: 300, y: 180 }, pxPerFt: 0 }), null);
  ok('nothing to say with no room, no point or no scale');

  // the middle of the room, clear of every wall and clear of the bed
  assert.equal(cobWallGuide({ room: room(), at: { x: 300, y: 180 }, pxPerFt: PPF }), null);
  ok('null in the ordinary case, so the canvas draws no extra marks');

  const near = cobWallGuide({ room: room(), at: { x: 20, y: 180 }, pxPerFt: PPF });
  assert.equal(near.bandPx, WALL_CLEARANCE_FT * PPF);
  assert.equal(near.bed, null);
  ok('inside the wall band it reports the band in pixels');

  const over = cobWallGuide({ room: r, at: { x: 300, y: 180 }, pxPerFt: PPF });
  assert.equal(over.bandPx, 0);
  assert.deepEqual(over.bed, bed);
  ok('over a bed it reports the bed and no band');
}

// --------------------------------------------------------------------------
console.log('what a chunk has already been decided at');
{
  const cells = [cell(0, 0, 0, 5, 5), cell(1, 150, 0, 5, 5)];
  const r = room({ cells });
  // one lamp in chunk 0, at 2ft/2ft, somebody set to 24 W
  const cobs = [{ id: 'a', roomId: 'r1', xFt: 2, yFt: 2, watts: 24, beam: 36, spec: true }];
  const inForce = chunkSpecInForce({ cobs, room: r, pxPerFt: PPF });
  assert.deepEqual(inForce(cells[0]), { watts: 24, beam: 36 });
  ok('a lamp somebody overruled answers for its whole chunk');
  assert.equal(inForce(cells[1]), null);
  ok('and for no other chunk');

  const onRule = [{ ...cobs[0], spec: false }];
  assert.equal(chunkSpecInForce({ cobs: onRule, room: r, pxPerFt: PPF })(cells[0]), null);
  ok('a lamp still on the rule is not a decision — `spec` and not "exists"');

  const other = [{ ...cobs[0], roomId: 'r2' }];
  assert.equal(chunkSpecInForce({ cobs: other, room: r, pxPerFt: PPF })(cells[0]), null);
  ok('a lamp in another space answers for nothing here');

  assert.equal(chunkSpecInForce({ cobs, room: r, pxPerFt: 0 })(cells[0]), null);
  assert.equal(chunkSpecInForce({ cobs, room: null, pxPerFt: PPF })(cells[0]), null);
  assert.equal(chunkSpecInForce({ cobs, room: r, pxPerFt: PPF })({ chunk: null }), null);
  ok('no scale, no room and no chunk all answer null');
}

// --------------------------------------------------------------------------
console.log('the autoplace toggle');
const BASIS = { lumensPerWatt: 75, dropFt: 9, inForce: () => null };
{
  const cells = [cell(0, 0, 0, 5, 5), cell(0, 150, 0, 5, 5)];
  const r = room({ cells });
  const out = autoplaceCobs({ room: r, list: [], pxPerFt: PPF, basis: BASIS });
  assert.equal(out.length, 2);
  ok('one lamp per cell');

  const withTrack = autoplaceCobs({ room: r, list: [], pxPerFt: PPF, basis: BASIS,
    ownedCells: [lightKey('r1', cells[0].id)] });
  assert.equal(withTrack.length, 1);
  assert.equal(withTrack[0].xFt, 7.5);
  ok('a grid cell already owned by a magnetic-track spot is not auto-filled');

  // AT THE CENTRE OF THE CELL, taken from the bounds and not from cx/cy.
  assert.equal(out[0].xFt, 2.5);
  assert.equal(out[0].yFt, 2.5);
  assert.equal(out[1].xFt, 7.5);
  ok('at the middle of the box, in plan feet');

  assert.equal(out.every((c) => c.auto === true && c.spec === false), true);
  ok('marked as the toggle\'s and NOT as a decision somebody made');

  assert.equal(out.every((c) => c.roomId === 'r1'), true);
  ok('attributed to the space whose toggle was switched');

  // the rule's own answer for a 5x5 cell at 9 ft
  const want = chunkSpec(cells, 0, BASIS);
  assert.equal(out[0].watts, want.watts);
  assert.equal(out[0].beam, want.beam);
  ok('at the chunk\'s own specification, worked out once for the chunk');

  const held = { ...BASIS, inForce: () => ({ watts: 24, beam: 15 }) };
  const over = autoplaceCobs({ room: r, list: [], pxPerFt: PPF, basis: held });
  assert.equal(over[0].watts, 24);
  assert.equal(over[0].beam, 15);
  assert.equal(over[0].spec, false);
  ok('a chunk already decided overrides the rule, and still stores no decision');
}
{
  const cells = [cell(0, 0, 0, 5, 5), cell(0, 150, 0, 5, 5)];
  const r = room({ cells });
  const there = [{ id: 'x', roomId: 'r1', xFt: 2.5, yFt: 2.5, watts: 7, beam: 36 }];
  const out = autoplaceCobs({ room: r, list: there, pxPerFt: PPF, basis: BASIS });
  assert.equal(out.length, 2);            // the one already there plus one new
  ok('a cell that already has a lamp in it is skipped rather than doubled');

  const elsewhere = [{ id: 'x', roomId: 'r2', xFt: 2.5, yFt: 2.5 }];
  assert.equal(autoplaceCobs({ room: r, list: elsewhere, pxPerFt: PPF, basis: BASIS }).length, 3);
  ok('and a lamp filed under another space does not occupy a cell here');
}
{
  // A NO-LIGHT ZONE over the first cell's centre, and a DARK chunk on the second
  const cells = [cell(0, 0, 0, 5, 5), cell(1, 150, 0, 5, 5), cell(2, 300, 0, 5, 5)];
  const r = room({
    cells,
    zonesPx: [{ x0: 50, y0: 50, x1: 100, y1: 100 }],
    chunks: [{}, { dark: true }, {}],
  });
  const out = autoplaceCobs({ room: r, list: [], pxPerFt: PPF, basis: BASIS });
  assert.equal(out.length, 1);
  assert.equal(out[0].xFt, 12.5);
  ok('a no-light zone under the centre and a dark chunk both get no lamp');

  // a cell merely CLIPPED by a zone still has somewhere for its fitting to be
  const clipped = room({ cells: [cells[0]], zonesPx: [{ x0: 0, y0: 0, x1: 10, y1: 10 }] });
  assert.equal(autoplaceCobs({ room: clipped, list: [], pxPerFt: PPF, basis: BASIS }).length, 1);
  ok('a cell clipped at its corner keeps its lamp — the test is at the centre');
}
{
  const list = [{ id: 'k' }];
  assert.equal(autoplaceCobs({ room: null, list, pxPerFt: PPF, basis: BASIS }), list);
  assert.equal(autoplaceCobs({ room: room(), list, pxPerFt: 0, basis: BASIS }), list);
  assert.equal(autoplaceCobs({ room: room(), list, pxPerFt: PPF, basis: BASIS }), list);
  ok('no room, no scale and no cells all return the list BY REFERENCE');
}

// --------------------------------------------------------------------------
console.log('every lamp nobody overruled follows its chunk');
{
  const cells = [cell(0, 0, 0, 5, 5)];
  const rooms = [room({ cells })];
  const basisFor = () => BASIS;
  const want = chunkSpec(cells, 0, BASIS);

  const stale = [{ id: 'a', roomId: 'r1', xFt: 2, yFt: 2, watts: 99, beam: 6, spec: false }];
  const next = reconcileCobSpecs({ list: stale, rooms, pxPerFt: PPF, basisFor });
  assert.notEqual(next, stale);
  assert.equal(next[0].watts, want.watts);
  assert.equal(next[0].beam, want.beam);
  ok('a stale derivation is brought back to the rule');

  const decided = [{ ...stale[0], spec: true }];
  assert.equal(reconcileCobSpecs({ list: decided, rooms, pxPerFt: PPF, basisFor }), decided);
  ok('a lamp somebody set by hand is never touched, and the list is by reference');

  const settled = [{ ...stale[0], watts: want.watts, beam: want.beam }];
  assert.equal(reconcileCobSpecs({ list: settled, rooms, pxPerFt: PPF, basisFor }), settled);
  ok('it converges in one pass — an unchanged list comes back by reference');

  const nowhere = [{ id: 'a', roomId: 'r1', xFt: 19, yFt: 11, watts: 99, beam: 6, spec: false }];
  assert.equal(reconcileCobSpecs({ list: nowhere, rooms, pxPerFt: PPF, basisFor }), nowhere);
  ok('a lamp in no cell is left alone — there is nothing to derive from');

  const orphan = [{ id: 'a', roomId: 'r9', xFt: 2, yFt: 2, watts: 99, spec: false }];
  assert.equal(reconcileCobSpecs({ list: orphan, rooms, pxPerFt: PPF, basisFor }), orphan);
  ok('...and so is one whose space is not on the plan');

  const held = () => ({ ...BASIS, inForce: () => ({ watts: 12, beam: 24 }) });
  const pulled = reconcileCobSpecs({ list: stale, rooms, pxPerFt: PPF, basisFor: held });
  assert.equal(pulled[0].watts, 12);
  assert.equal(pulled[0].beam, 24);
  ok('a chunk somebody decided pulls its unspecified lamps to that figure');
}

// --------------------------------------------------------------------------
console.log('a lamp dropped off every ceiling goes back where it came from');
{
  const inside = (p) => (p.x >= 0 && p.x <= 600 && p.y >= 0 && p.y <= 360 ? room() : null);
  const startAll = { a: { xFt: 2, yFt: 2, roomId: 'r1' } };

  const off = [{ id: 'a', roomId: 'r1', xFt: 40, yFt: 40 }];
  const back = rollbackCobs({ list: off, ids: ['a'], startAll, pxPerFt: PPF, roomAt: inside });
  assert.deepEqual(back[0], { id: 'a', xFt: 2, yFt: 2, roomId: 'r1' });
  ok('a drop outside every room is refused and the press position restored');

  const on = [{ id: 'a', roomId: 'r1', xFt: 5, yFt: 5 }];
  assert.equal(rollbackCobs({ list: on, ids: ['a'], startAll, pxPerFt: PPF, roomAt: inside }), on);
  ok('a drop on a ceiling is kept, and the list comes back by reference');

  const fresh = [{ id: 'b', roomId: null, xFt: 40, yFt: 40 }];
  assert.equal(rollbackCobs({ list: fresh, ids: ['b'], startAll, pxPerFt: PPF, roomAt: inside }),
               fresh);
  ok('a lamp that never had a room is not rolled back — there is nowhere to go');

  const other = [{ id: 'a', roomId: 'r1', xFt: 40, yFt: 40 }];
  assert.equal(rollbackCobs({ list: other, ids: ['z'], startAll, pxPerFt: PPF, roomAt: inside }),
               other);
  ok('only the ids the gesture was carrying are considered');

  const noBase = [{ id: 'c', roomId: 'r1', xFt: 40, yFt: 40 }];
  assert.equal(rollbackCobs({ list: noBase, ids: ['c'], startAll, pxPerFt: PPF, roomAt: inside }),
               noBase);
  ok('...and one with no snapshot at the press is left where it is');
}

// --------------------------------------------------------------------------
console.log('an array is let go if any one of its lamps is on a ceiling');
{
  const inside = (p) => (p.x >= 0 && p.x <= 600 ? room() : null);
  assert.equal(arrayLanded({ lamps: [], roomAt: inside }), true);
  ok('an array with no lamps drawn yet is not refused');
  assert.equal(arrayLanded({ lamps: [{ x: -50, y: 10 }, { x: 300, y: 10 }], roomAt: inside }), true);
  ok('one lamp inside is enough — a ring on a room\'s outline has lamps ON the walls');
  assert.equal(arrayLanded({ lamps: [{ x: -50, y: 10 }, { x: -10, y: 10 }], roomAt: inside }), false);
  ok('a run carried right off the plan is refused');
}

// --------------------------------------------------------------------------
console.log('what the bar asks about a run');
const RECT = {
  pts: [{ x: 60, y: 60 }, { x: 300, y: 60 }, { x: 300, y: 240 }, { x: 60, y: 240 }],
  corners: [{ x: 60, y: 60 }, { x: 300, y: 60 }, { x: 300, y: 240 }, { x: 60, y: 240 }],
  closed: true, isRoom: false, roomId: 'r1', label: 'Rectangle',
};
{
  assert.equal(arrayBarFor({ array: null, geo: RECT, pxPerFt: PPF }), null);
  assert.equal(arrayBarFor({ array: { id: 'a' }, geo: null, pxPerFt: PPF }), null);
  ok('null with no array, and null where the geometry has been deleted');

  const bar = arrayBarFor({
    array: { id: 'a', count: 7, side: 'in', offsetFt: 1, watts: 12, beam: 36 },
    geo: RECT, pxPerFt: PPF });
  assert.equal(bar.array.editing, true);
  assert.equal(bar.array.picked, true);
  assert.equal(bar.array.label, 'Rectangle');
  ok('a placed array\'s bar is `editing` and `picked`, and carries the label');

  // A RECTANGLE COUNTS 4, 8, 12 — so a stored 7 prints as 8.
  assert.equal(bar.array.count, 8);
  ok('the count is quantised against the geometry rather than printed as stored');
  assert.equal(bar.array.countMin, 4);
  assert.equal(bar.array.countStep, 4);
  ok('the number box steps one per corner and up in whole passes');
  assert.equal(bar.array.sideId, 'in');
  assert.equal(bar.array.offsetFt, 1);
  ok('the side and the distance come off the array');
  assert.equal(bar.watts, 12);
  assert.equal(bar.beam, 36);
  ok('the specification is clamped and the optic snapped to the catalogue');

  // FEET AT THE CONTROL, PIXELS IN THE OUTLINE
  const raw = arrayBarFor({ array: { id: 'a', count: 4, watts: 7, beam: 36 },
                            geo: RECT, pxPerFt: 1 });
  assert.equal(raw.array.maxOffsetFt, bar.array.maxOffsetFt * PPF);
  ok('the offset limit is converted from pixels to feet by the scale');

  const noOffset = arrayBarFor({ array: { id: 'a', count: 4, watts: 7, beam: 36 },
                                 geo: RECT, pxPerFt: PPF });
  assert.equal(noOffset.array.offsetFt, 0);
  ok('an array stored before the offset existed reads as zero, not undefined');
}

// --------------------------------------------------------------------------
console.log('what the bar asks about a draft');
{
  assert.deepEqual(arrayDraftBar({ draft: null, geo: RECT, pxPerFt: PPF }), { picked: false });
  assert.deepEqual(arrayDraftBar({ draft: { count: 4 }, geo: null, pxPerFt: PPF }),
                   { picked: false });
  ok('`picked: false` until a geometry has been taken');

  const d = { geomId: 's1', count: 8, side: 'in', offsetFt: 1 };
  const bar = arrayDraftBar({ draft: d, geo: RECT, pxPerFt: PPF });
  assert.equal(bar.picked, true);
  assert.equal(bar.editing, undefined);
  ok('a draft\'s bar is picked but NOT editing — that is the one field that differs');
  // THE DRAFT'S OWN FIGURE, PRINTED AS IT IS. The count is quantised by the
  // control (see `draftCount`) rather than on the way out.
  assert.equal(bar.count, 8);
  assert.equal(bar.countStep, 4);
  assert.equal(bar.sideId, 'in');
  assert.equal(bar.offsetFt, 1);
  ok('the three figures come straight off the draft, with the geometry\'s steps');
}

// --------------------------------------------------------------------------
console.log('what a fresh pick opens on');
{
  const first = nextArrayDraft(null, { geomId: 's1', geo: RECT, roomId: 'r9',
                                       watts: 9, beam: 24 });
  assert.equal(first.count, 4);          // one per corner
  assert.equal(first.side, 'on');
  assert.equal(first.offsetFt, 1);
  ok('one lamp per corner, on the line itself, carried a foot off');
  assert.equal(first.roomId, 'r1');
  ok('the geometry\'s own room wins over the room the press landed in');
  assert.equal(first.watts, 9);
  assert.equal(first.beam, 24);
  ok('the specification opens on whatever the bar is showing');

  const held = { geomId: 's1', count: 8, side: 'in', offsetFt: 2, watts: 24, beam: 15 };
  const same = nextArrayDraft(held, { geomId: 's1', geo: RECT, roomId: 'r1',
                                      watts: 9, beam: 24 });
  assert.equal(same.count, 8);
  assert.equal(same.side, 'in');
  assert.equal(same.offsetFt, 2);
  assert.equal(same.watts, 24);
  ok('re-picking the same geometry keeps the count, the side and the distance');

  const tri = { pts: RECT.pts, corners: RECT.corners.slice(0, 3), closed: true,
                isRoom: false, roomId: 'r1', label: 'Triangle' };
  const moved = nextArrayDraft(held, { geomId: 's2', geo: tri, roomId: 'r1',
                                       watts: 9, beam: 24 });
  assert.equal(moved.count, 3);
  assert.equal(moved.side, 'in');
  assert.equal(moved.offsetFt, 2);
  ok('a NEW geometry re-asks the count and keeps the side and the distance');
}

// --------------------------------------------------------------------------
console.log('the draft\'s number box');
{
  assert.equal(draftCount({}, RECT, 7), 8);
  assert.equal(draftCount({}, RECT, 2), 4);
  ok('quantised against the geometry, and never below one per corner');
  assert.equal(draftCount({}, RECT, 9999), 200);
  ok('capped at two hundred, whatever is typed');
  assert.equal(draftCount({}, null, 7), 7);
  ok('with no geometry it counts freely rather than refusing');
}

// --------------------------------------------------------------------------
console.log('where a module lands on its profile');
{
  // a 20 ft straight run, in plan feet
  const run = { pts: [{ x: 0, y: 0 }, { x: 20, y: 0 }], closed: false };
  assert.equal(moduleU({ run: null, p: { x: 5, y: 0 }, taken: [], kind: 'spot' }), null);
  ok('no run, no answer');

  const mid = moduleU({ run, p: { x: 10, y: 0 }, taken: [], kind: 'spot', watts: 10 });
  assert.ok(Math.abs(mid - 0.5) < 1e-6);
  ok('a press halfway along answers half way along');

  const off = moduleU({ run, p: { x: 10, y: 40 }, taken: [], kind: 'spot', watts: 10 });
  assert.ok(Math.abs(off - 0.5) < 1e-6);
  ok('a press out in the middle of the room projects onto the rail');

  // A BODY ALREADY THERE. `placeableU` moves the new one to the nearest gap.
  const beside = moduleU({ run, p: { x: 10, y: 0 },
                           taken: [{ u: 0.5, kind: 'spot', watts: 10 }],
                           kind: 'spot', watts: 10 });
  assert.notEqual(beside, null);
  assert.ok(Math.abs(beside - 0.5) > 1e-6);
  ok('two bodies cannot share an inch of extrusion — it lands at the nearest gap');
}

console.log(`\n${n} checks passed.`);
