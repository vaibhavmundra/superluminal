// Throwaway harness: the two reported cases, in the room's own feet.
import { planTaskSpots, secondaryGrid, spotSpan, carriedByTrack,
         SPOT_DEFAULTS } from '../../src/lib/taskSpots.js';

// --- CASE 1: bedroom. 12 x 14 room, bed 6 x 6.5 against the head wall (y=0),
// the back wall behind it the thing to light. Zones carve the chunk, so the
// chunk starts at the foot of the bed.
const bedroom = () => {
  const polygon = [{x:0,y:0},{x:12,y:0},{x:12,y:14},{x:0,y:14}];
  const bed = { id:'det-bed-0', cls:'bed', x0:3, y0:0, x1:9, y1:6.5 };
  // What the chunker leaves: the ceiling below the bed, plus two side strips.
  const chunk = { x0:0, y0:6.5, x1:12, y1:14, xLines:[0,6,12], yLines:[6.5,10.25,14] };
  const lights = [ {id:'l1',x:3,y:8.4},{id:'l2',x:9,y:8.4},
                   {id:'l3',x:3,y:12.1},{id:'l4',x:9,y:12.1} ];
  // The bed back wall as a task surface: a shallow rect on the wall at y=0.
  const surface = { x0:3, y0:0, x1:9, y1:0.6, type:'bed-back-wall' };
  const track = [ // a rail across the room 2 ft off the head wall
    { a:{x:0,y:2}, b:{x:12,y:2}, absorb:3 },
  ];
  const span = spotSpan(chunk, [bed], SPOT_DEFAULTS);
  const grid = secondaryGrid(chunk, lights, { ...SPOT_DEFAULTS, spanZones:[bed] });
  const near = grid.segments
    .filter((s) => s.axis === 'v')
    .map((s) => `${s.kind} ${s.a.x.toFixed(1)},${s.a.y.toFixed(1)} -> ${s.b.x.toFixed(1)},${s.b.y.toFixed(1)}`);
  const out = planTaskSpots([surface], {
    chunks:[chunk], lights, polygon, fixtures:[], chandeliers:[],
    zones:[bed], coves:[], tracks:track, opt:{},
  });
  return { span, vSegments: near, result: out[0] };
};

// --- CASE 2: living room. End table in the corner, a track loop nearby.
const living = () => {
  const polygon = [{x:0,y:0},{x:16,y:0},{x:16,y:18},{x:0,y:18}];
  const chunk = { x0:0, y0:0, x1:16, y1:18, xLines:[0,5.33,10.67,16], yLines:[0,6,12,18] };
  const lights = [];
  for (const x of [2.67,8,13.33]) for (const y of [3,9,15]) lights.push({id:`l${x}-${y}`,x,y});
  const surface = { x0:12.5, y0:13.0, x1:14.5, y1:15.0, type:'end-table' };
  const track = [
    { a:{x:2.67,y:3}, b:{x:2.67,y:15}, absorb:3 },
    { a:{x:13.33,y:3}, b:{x:13.33,y:15}, absorb:3 },
  ];
  const withTrack = planTaskSpots([surface], {
    chunks:[chunk], lights, polygon, fixtures:[], chandeliers:[],
    zones:[], coves:[], tracks:track, opt:{},
  })[0];
  const blind = planTaskSpots([surface], {
    chunks:[chunk], lights, polygon, fixtures:[], chandeliers:[],
    zones:[], coves:[], tracks:[], opt:{},
  })[0];
  const say = (r) => r.spot
    ? { at:[+r.spot.x.toFixed(2), +r.spot.y.toFixed(2)], aimFt:+r.spot.aimFt.toFixed(2),
        via:r.spot.via, far:!!r.spot.far,
        onRail: carriedByTrack(r.spot, track, SPOT_DEFAULTS) }
    : { rejected:r.rejected };
  return { withTrack: say(withTrack), trackBlind: say(blind) };
};

const b = bedroom();
console.log('=== CASE 1: bed back wall ===');
console.log('grid span (chunk was y0=6.5):', b.span);
console.log('vertical segments now available:'); b.vSegments.forEach((x)=>console.log('  ', x));
console.log('spot:', b.result.spot
  ? { at:[+b.result.spot.x.toFixed(2), +b.result.spot.y.toFixed(2)],
      aimFt:+b.result.spot.aimFt.toFixed(2), via:b.result.spot.via,
      far:!!b.result.spot.far }
  : b.result.rejected);

console.log('\n=== CASE 2: living-room end table ===');
console.log(JSON.stringify(living(), null, 2));
