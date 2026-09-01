import { planTaskSpots, carriedByTrack, isBedZone, SPOT_DEFAULTS } from '../../src/lib/taskSpots.js';
import { absorbPoints } from '../../src/lib/track.js';

// A side table almost equally near two candidates: the light-to-light node on
// the column x=12 (1.41 ft) and the one on the row y=12 (1.50 ft). The row is
// the track rail.
const polygon = [{x:0,y:0},{x:16,y:0},{x:16,y:16},{x:0,y:16}];
const chunk = { x0:0, y0:0, x1:16, y1:16, xLines:[0,8,16], yLines:[0,6,12,16] };
const lights = [{id:'a',x:4,y:6},{id:'b',x:12,y:6},{id:'c',x:4,y:12},{id:'d',x:12,y:12}];
const sf = { x0:9.5, y0:10, x1:11, y1:11.5, type:'side-table' };
const rail = [{ a:{x:0,y:12}, b:{x:16,y:12}, absorb:3 }];

for (const [label, tracks] of [['track-blind', []], ['track-aware', rail]]) {
  const r = planTaskSpots([sf], { chunks:[chunk], lights, polygon, fixtures:[],
    chandeliers:[], zones:[], coves:[], tracks, opt:{} })[0];
  console.log(`${label.padEnd(12)} at (${r.spot.x.toFixed(1)}, ${r.spot.y.toFixed(1)})`
    + `  aim ${r.spot.aimFt.toFixed(2)} ft  via ${r.spot.via}`
    + `  on the rail: ${carriedByTrack(r.spot, rail, SPOT_DEFAULTS)}`);
}

// And the keepOff filter, on a point properly inside the mattress.
const bed = { id:'det-bed-0', cls:'bed', x0:3, y0:0, x1:9, y1:6.5 };
const runs = [{ a:{x:0,y:2}, b:{x:12,y:2}, absorb:3 }];
const p = [{ x:6, y:4.2 }];
console.log('\nspot at (6, 4.2), rail along y=2 over the bed:');
console.log('  beds filtered out of keepOff:',
  absorbPoints(runs, p, { absorb:3, len:0.5, keepOff:[bed] .filter((z)=>!isBedZone(z)), occupied:[] })[0]
    ? 'carried onto the rail' : 'left recessed');
console.log('  beds left in keepOff      :',
  absorbPoints(runs, p, { absorb:3, len:0.5, keepOff:[bed], occupied:[] })[0]
    ? 'carried onto the rail' : 'left recessed');

// Nothing else gives way: a hand-drawn zone and an enclosed room still refuse.
const hand = { id:'z1', x0:3, y0:0, x1:9, y1:6.5 };              // no cls
const room = { id:'encl-1', source:'enclosed', cls:'room', x0:3, y0:0, x1:9, y1:6.5 };
const bedroomChunk = { x0:0, y0:6.5, x1:12, y1:14, xLines:[0,6,12], yLines:[6.5,10.25,14] };
const bl = [{id:'l1',x:3,y:8.4},{id:'l2',x:9,y:8.4},{id:'l3',x:3,y:12.1},{id:'l4',x:9,y:12.1}];
const wall = { x0:3, y0:0, x1:9, y1:0.6, type:'bed-back-wall' };
const bp = [{x:0,y:0},{x:12,y:0},{x:12,y:14},{x:0,y:14}];
for (const [label, z] of [['a bed', bed], ['a hand-drawn box', hand], ['an enclosed room', room]]) {
  const r = planTaskSpots([wall], { chunks:[bedroomChunk], lights:bl, polygon:bp,
    fixtures:[], chandeliers:[], zones:[z], coves:[], tracks:[], opt:{} })[0];
  console.log(`\nzone is ${label}: ` + (r.spot
    ? `spot at (${r.spot.x.toFixed(1)}, ${r.spot.y.toFixed(1)}), aim ${r.spot.aimFt.toFixed(1)} ft`
      + (r.spot.far ? ' [FAR]' : '')
    : `no spot — ${r.rejected}`));
}
