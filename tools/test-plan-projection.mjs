// ---------------------------------------------------------------------------
// test-plan-projection.mjs — React-free plan state to canvas geometry.
//
// These cases exercise the projections that used to live inside App.jsx.
// ---------------------------------------------------------------------------

import {
  projectTaskSpotsPx,
  projectAccentZonesPx,
} from '../src/lib/planProjection.js';
import { projectFlowsPx } from '../src/lib/electricalProjection.js';
import { SPOT_DEFAULTS } from '../src/lib/taskSpots.js';

let fail = 0;
const ok = (condition, message) => {
  console.log((condition ? '  ok  ' : '  FAIL') + '  ' + message);
  if (!condition) fail++;
};
const near = (a, b, epsilon = 1e-6) => Math.abs(a - b) <= epsilon;

console.log('-- task spots cross into room feet and back to plan pixels --');
{
  const lights = [];
  [4, 12, 20].forEach((x) => [4, 12].forEach((y) => lights.push({ x, y, kind: 'small' })));
  const polygonFt = [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 16 }, { x: 0, y: 16 }];
  const room = {
    id: 'room-1',
    plan: {
      ok: true,
      chunks: [{ x0: 0, y0: 0, x1: 24, y1: 16 }],
      lights,
      polygonFt,
      zones: [],
    },
    tracks: [],
    geo: {
      toFt: (p) => ({ x: p.x / 10, y: p.y / 10 }),
      toPx: (p) => ({ x: p.x * 10, y: p.y * 10 }),
      fixturesFt: [],
      polygonPx: polygonFt.map((p) => ({ x: p.x * 10, y: p.y * 10 })),
    },
  };
  const surfaces = [{
    id: 'table', roomId: 'room-1', type: 'dining', colour: '#abc',
    rect: { x0: 130, y0: 60, x1: 180, y1: 100 },
  }];
  const spots = projectTaskSpotsPx([room], surfaces, [], {});
  ok(spots.length === 1, 'one surface produces one projected spot');
  ok(near(spots[0]?.x, 120) && near(spots[0]?.y, 80),
    `the feet-space result returns at 120,80 px: ${spots[0]?.x},${spots[0]?.y}`);
  ok(near(spots[0]?.target.x, 155) && near(spots[0]?.target.y, 80),
    'the target is projected back to the surface centre');
  ok(spots[0]?.segment.a.x === 120 && spots[0]?.segment.b.x === 120,
    'the secondary-grid segment is projected too');

  /* --- AND THE ONES SOMEBODY PLACED AND AIMED THEMSELVES ------------------
     THEY COME OUT OF THIS SAME PROJECTION, which is the whole design: the
     canvas, the analysis, the schedule and the electrical pass all read
     `taskSpotsPx`, and putting hand-placed spots anywhere else would mean
     teaching four readers about a fourth kind of fitting. So what this checks
     is that the entry is the SAME SHAPE a placed one has. */
  const HAND = [{ id: 'mspot-1', roomId: 'room-1', xFt: 4, yFt: 5, aim: 0 }];
  const both = projectTaskSpotsPx([room], surfaces, [], {}, HAND, 10);
  ok(both.length === 2, 'a hand-placed spot joins the placer\'s own list');
  const h = both.find((q) => q.id === 'mspot-1');
  ok(near(h.x, 40) && near(h.y, 50),
    `plan feet straight to plan pixels, no room origin: ${h?.x},${h?.y}`);
  ok(h.roomId === 'room-1' && h.fixture === 'spot' && h.hand === true,
    'it carries the room, the catalogue line and the flag Delete reads');
  /* THE THREE FIELDS THE DOWNSTREAM READERS KEY ON. `roomId` is how the
     analysis and the schedule attribute it, `rejected` being absent is how
     both know to count it, and `x` being finite is the analysis's own guard. */
  ok(!h.rejected && Number.isFinite(h.x) && Number.isFinite(h.angle),
    '...and nothing that would make a counter skip it');
  /* A RECORD WITH NO REACH FALLS BACK TO SIX FEET — see HAND_AIM_FT, which is
     now only what a plan saved before the distance was stored keeps. Aimed
     along +x from (4,5) ft at 10 px/ft, that is (100, 50) px. */
  ok(near(h.target.x, 100) && near(h.target.y, 50),
    `an angle with no reach keeps the old six feet: ${h?.target?.x},${h?.target?.y}`);

  /* --- BUT WHERE THE SECOND CLICK LANDED IS WHERE THE BEAM LANDS ----------
     THE FAULT THIS FIXES: aiming at a table four feet off and having the throw
     pool, the arrow and the heatmap's cone all land six feet off, past it. The
     pool is drawn on `target` and the heatmap tilts at `target`, so this one
     number is the whole of "aimed at THAT". */
  const aimed = projectTaskSpotsPx([room], [], [], {},
    [{ id: 'mspot-1', roomId: 'room-1', xFt: 4, yFt: 5, aim: 0, aimFt: 4 }], 10);
  ok(near(aimed[0]?.target.x, 80) && near(aimed[0]?.target.y, 50),
    `a four-foot aim throws four feet out: ${aimed[0]?.target?.x},${aimed[0]?.target?.y}`);
  ok(near(aimed[0]?.aimFt, 4),
    'and the distance the panel and the schedule quote is the one that was aimed');

  /* FLOORED AT THE PLACER'S OWN STANDOFF. A second click on top of the body
     asks for a fitting with no direction to point in, which is the case
     `minStandoff` was written for — the same rule and the same number rather
     than a second one invented for the hand. */
  const onTop = projectTaskSpotsPx([room], [], [], {},
    [{ id: 'mspot-1', roomId: 'room-1', xFt: 4, yFt: 5, aim: 0, aimFt: 0 }], 10);
  ok(near(onTop[0]?.aimFt, SPOT_DEFAULTS.minStandoff),
    `a click on the body is held off by the standoff: ${onTop[0]?.aimFt}`);

  /* A ROOM WITH NO TASK SURFACE `continue`s out of the pass above, which is
     why the hand-placed loop is over the SPOTS and not over the rooms. */
  const alone = projectTaskSpotsPx([room], [], [], {}, HAND, 10);
  ok(alone.length === 1 && alone[0].id === 'mspot-1',
    'and it survives a room the surface pass skipped entirely');

  ok(projectTaskSpotsPx([room], [], [], {},
        [{ id: 'bad', roomId: 'room-1', xFt: 1, yFt: 2 }], 10).length === 0,
    'a record with no angle is not a spot and is not drawn');
  ok(projectTaskSpotsPx([room], [], [], {}, HAND, 0).length === 0,
    'and nothing is projected before there is a scale');

  /* --- WHICH SPACE IT BELONGS TO IS WHERE IT IS ---------------------------
     A HAND-PLACED SPOT CAN BE DRAGGED NOW, so the id the second click stamped
     is no longer the answer: carried into the next room it would go on being
     billed, analysed and heat-mapped in the one it was placed in. Resolved at
     the READ, which is what `projectAccentZonesPx` already does for a run and
     `projectMagTracksPx` for a track — and which heals a plan saved before the
     drag existed.
     The neighbour is 30..54 ft across, i.e. 300..540 px at this scale. */
  const NEXT = {
    id: 'room-2',
    plan: { ok: true, chunks: [], lights: [], polygonFt: [], zones: [] },
    tracks: [],
    geo: {
      toFt: (q) => ({ x: q.x / 10, y: q.y / 10 }),
      toPx: (q) => ({ x: q.x * 10, y: q.y * 10 }),
      fixturesFt: [],
      polygonPx: [{ x: 300, y: 0 }, { x: 540, y: 0 },
                  { x: 540, y: 160 }, { x: 300, y: 160 }],
    },
  };
  const moved = projectTaskSpotsPx([room, NEXT], [], [], {},
    [{ id: 'mspot-1', roomId: 'room-1', xFt: 40, yFt: 5, aim: 0 }], 10);
  ok(moved[0]?.roomId === 'room-2',
    `a spot dragged next door is attributed next door: ${moved[0]?.roomId}`);

  /* THE STORED ID IS THE FALLBACK. A spot dropped across a threshold, or left
     outside a re-traced outline, keeps the home it had rather than falling out
     of every schedule at once. */
  const off = projectTaskSpotsPx([room, NEXT], [], [], {},
    [{ id: 'mspot-1', roomId: 'room-1', xFt: 100, yFt: 100, aim: 0 }], 10);
  ok(off[0]?.roomId === 'room-1',
    'and one over no space at all keeps the room it was placed in');
}

console.log('\n-- accent sources are merged and filtered in screen space --');
{
  const rooms = [
    { id: 'live', coveStrips: [{ id: 'cove', roomId: 'live' }], geo: { polygonPx: [] } },
  ];
  const projected = projectAccentZonesPx(
    rooms,
    { live: { zones: [{ id: 'kept', roomId: 'live' }, { id: 'dismissed', roomId: 'live' }] } },
    ['dismissed', 'old-manual'],
    [{ id: 'manual', roomId: 'live' }, { id: 'old-manual', roomId: 'live' },
      { id: 'orphan', roomId: 'gone' }],
    [{ id: 'reverse', roomId: 'live', run: [], rect: {}, runLength: 8 },
      { id: 'stale-reverse', roomId: 'gone', run: [], rect: {}, runLength: 3 }],
    [{ id: 'shelf', roomId: 'live', run: [], rect: {}, runLength: 4 },
      { id: 'stale-shelf', roomId: 'gone', run: [], rect: {}, runLength: 2 }],
    [],
    10,
  );
  const ids = projected.map((item) => item.id);
  ok(ids.join(',') === 'kept,cove,rcove-strip-reverse,shelf-strip-shelf,manual',
    `live, undismissed sources survive in order: ${ids.join(',')}`);
  ok(projected.find((item) => item.id === 'rcove-strip-reverse')?.fixture === 'reverse-cove',
    'reverse coves keep their schedule fixture identity');
}

console.log('\n-- flows receive projected room geometry and eligible fittings --');
{
  const room = {
    id: 'room-1',
    plan: {
      ok: true,
      polygonPx: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 120 }, { x: 0, y: 120 }],
      chunksPx: [], cellsPx: [], lightsPx: [], tracksPx: [], zonesPx: [],
    },
  };
  const board = {
    id: 'board', roomId: 'room-1', role: 'door', servesShort: 'Door',
    point: { x: 0, y: 60 }, wall: { index: 3 },
  };
  const boardsFor = () => [board];
  const noneFor = () => [];
  const baysOf = () => [{ key: 'room', rect: { x0: 0, y0: 0, x1: 200, y1: 120 } }];
  const flows = projectFlowsPx(
    [room], boardsFor, noneFor, {},
    [{ id: 'fan', kind: 'fan', x: 100, y: 60, r: 10 }],
    [], [], {}, 10, baysOf, [board], noneFor, {}, {},
  );
  ok(flows.length === 1 && flows[0].kind === 'object',
    'the room fan becomes one object circuit');
  ok(flows[0]?.boardId === 'board' && flows[0]?.nodes[0]?.id === 'fan',
    'the projected circuit joins the fitting to the room board');
}

console.log(fail ? `\n${fail} failing` : '\nall good');
process.exit(fail ? 1 : 0);
