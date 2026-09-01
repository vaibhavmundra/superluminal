import { planTaskSpots, carriedByTrack, SPOT_DEFAULTS } from '../../src/lib/taskSpots.js';
import { absorbPoints } from '../../src/lib/track.js';

// --- BEFORE / AFTER on the bedroom, by flipping the rule off.
const polygon = [{x:0,y:0},{x:12,y:0},{x:12,y:14},{x:0,y:14}];
const bed = { id:'det-bed-0', cls:'bed', x0:3, y0:0, x1:9, y1:6.5 };
const chunk = { x0:0, y0:6.5, x1:12, y1:14, xLines:[0,6,12], yLines:[6.5,10.25,14] };
const lights = [{id:'l1',x:3,y:8.4},{id:'l2',x:9,y:8.4},{id:'l3',x:3,y:12.1},{id:'l4',x:9,y:12.1}];
const surface = { x0:3, y0:0, x1:9, y1:0.6, type:'bed-back-wall' };
const runs = [{ a:{x:0,y:2}, b:{x:12,y:2}, absorb:3 }];

for (const overBed of [false, true]) {
  const r = planTaskSpots([surface], {
    chunks:[chunk], lights, polygon, fixtures:[], chandeliers:[],
    zones:[bed], coves:[], tracks:runs, opt:{ overBed },
  })[0];
  const line = r.spot
    ? `at (${r.spot.x.toFixed(1)}, ${r.spot.y.toFixed(1)})  aim ${r.spot.aimFt.toFixed(1)} ft`
      + `  via ${r.spot.via}${r.spot.far ? '  [FAR — flagged]' : ''}`
    : `REFUSED: ${r.rejected}`;
  console.log(`overBed=${String(overBed).padEnd(5)} ${line}`);
  if (r.spot) {
    // and what the track does with it, with the beds out of keepOff
    const got = absorbPoints(runs, [{ x:r.spot.x, y:r.spot.y }],
      { absorb:3, len:0.5, keepOff:[], occupied:[] });
    console.log('        track: ', got[0]
      ? `carried onto run ${got[0].run} at (${got[0].x.toFixed(1)}, ${got[0].y.toFixed(1)})`
      : 'left recessed');
    const kept = absorbPoints(runs, [{ x:r.spot.x, y:r.spot.y }],
      { absorb:3, len:0.5, keepOff:[bed], occupied:[] });
    console.log('        track with the bed still in keepOff: ', kept[0] ? 'carried' : 'left recessed');
  }
}

// --- Does the rail preference actually break a near tie?
console.log('\n=== rail vs a marginally nearer off-rail line ===');
const p2 = [{x:0,y:0},{x:16,y:0},{x:16,y:16},{x:0,y:16}];
// Two light rows: y=7 (off rail) and y=10.5 (on the rail). Surface at y=13.
const ch = { x0:0, y0:0, x1:16, y1:16, xLines:[0,8,16], yLines:[0,7,10.5,16] };
const li = [{id:'a',x:4,y:7},{id:'b',x:12,y:7},{id:'c',x:4,y:10.5},{id:'d',x:12,y:10.5}];
const sf = { x0:7, y0:12.8, x1:9, y1:14.8, type:'side-table' };
const rail = [{ a:{x:0,y:10.5}, b:{x:16,y:10.5}, absorb:3 }];
for (const [label, tracks] of [['track-blind', []], ['track-aware', rail]]) {
  const r = planTaskSpots([sf], { chunks:[ch], lights:li, polygon:p2, fixtures:[],
    chandeliers:[], zones:[], coves:[], tracks, opt:{} })[0];
  console.log(`${label.padEnd(12)} at (${r.spot.x.toFixed(1)}, ${r.spot.y.toFixed(1)})`
    + `  aim ${r.spot.aimFt.toFixed(1)} ft  on the rail: ${carriedByTrack(r.spot, rail, SPOT_DEFAULTS)}`);
}
