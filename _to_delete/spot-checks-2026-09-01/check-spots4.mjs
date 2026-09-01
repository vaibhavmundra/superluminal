import { planTaskSpots } from '../../src/lib/taskSpots.js';
// A desk at the foot of the bed: the surface whose best answer was the OLD
// midpoint of the stub. It must not be dragged towards the head wall.
const polygon = [{x:0,y:0},{x:12,y:0},{x:12,y:14},{x:0,y:14}];
const bed = { id:'det-bed-0', cls:'bed', x0:3, y0:0, x1:9, y1:6.5 };
const chunk = { x0:0, y0:6.5, x1:12, y1:14, xLines:[0,6,12], yLines:[6.5,10.25,14] };
const lights = [{id:'l1',x:3,y:8.4},{id:'l2',x:9,y:8.4},{id:'l3',x:3,y:12.1},{id:'l4',x:9,y:12.1}];
const desk  = { x0:2.2, y0:6.7, x1:4.2, y1:8.2, type:'desk' };
const wall  = { x0:3, y0:0, x1:9, y1:0.6, type:'bed-back-wall' };
const say = (label, r) => console.log(`${label.padEnd(16)}`, r.spot
  ? `at (${r.spot.x.toFixed(1)}, ${r.spot.y.toFixed(1)})  aim ${r.spot.aimFt.toFixed(2)} ft`
    + (r.spot.far ? ' [FAR]' : '')
  : `no spot — ${r.rejected}`);
const ctx = { chunks:[chunk], lights, polygon, fixtures:[], chandeliers:[],
              zones:[bed], coves:[], tracks:[], opt:{} };
say('desk alone', planTaskSpots([desk], ctx)[0]);
const both = planTaskSpots([desk, wall], ctx);
say('desk, together', both[0]);
say('wall, together', both[1]);
