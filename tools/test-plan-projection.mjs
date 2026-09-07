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
