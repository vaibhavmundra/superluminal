import { chunkKey, designChunking } from '../src/lib/ceilingDesign.js';
import { PLAN_OPTIONS as opt } from '../src/lib/settings.js';

// A room traced in PLAN PIXELS, the way an outline is stored, and converted to
// feet through pxPerFt — exactly what App.jsx does via geo.toFt.
const polyPx = [{x:120,y:80},{x:1160,y:80},{x:1160,y:820},{x:120,y:820}];
const key1 = (pxPerFt) => {
  const o = { x: 120, y: 80 };
  const ft = polyPx.map(p => ({ x: (p.x - o.x)/pxPerFt, y: (p.y - o.y)/pxPerFt }));
  const d = designChunking(ft, [], opt, []);
  return d.chunks.map(c => c.key).join(' | ');
};
const base = 48.7654321;
console.log('pxPerFt exactly as saved      ', key1(base));
for (const eps of [Number.EPSILON*base, 1e-12, 1e-9, 1e-6, 1e-4]) {
  const k = key1(base + eps);
  console.log(`+${String(eps).padEnd(24)}`, k === key1(base) ? 'SAME key' : 'KEY CHANGED  ' + k);
}
console.log();
console.log('how much drift the key tolerates, in feet:');
for (const d of [0.0004, 0.0005, 0.001, 0.002]) {
  const shifted = polyPx.map(p => ({ x: p.x, y: p.y }));
  const o = { x: 120, y: 80 };
  const ft = shifted.map(p => ({ x: (p.x-o.x)/base + d, y: (p.y-o.y)/base }));
  const k = designChunking(ft, [], opt, []).chunks.map(c=>c.key).join(' | ');
  console.log(`  shift ${d} ft ->`, k === key1(base) ? 'SAME' : 'CHANGED');
}
