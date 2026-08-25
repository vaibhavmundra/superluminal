import { planLights, DEFAULTS } from '../src/lib/planner.js';
import { rectifyPolygon } from '../src/lib/geometry.js';

const R = (w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
function show(name, poly, fixtures=[], opts={}, zones=[]) {
  const r = planLights(poly, fixtures, opts, zones);
  if(!r.ok){ console.log(`${name}: FAILED - ${r.reason}`); return r; }
  const cellSizes = r.cells.map(c=>`${c.w.toFixed(1)}x${c.h.toFixed(1)}`);
  console.log(`${name}`);
  console.log(`  ${r.stats.chunks} chunk(s) (+${r.stats.omittedChunks} omitted) -> ${r.stats.cells} cells, avg side ${r.stats.avgCell.toFixed(2)}ft`);
  console.log(`  lights: ${r.stats.large} large, ${r.stats.small} small  (area ${r.stats.areaSqft.toFixed(0)} sqft)`);
  const uniq=[...new Set(cellSizes)]; console.log(`  cell sizes: ${uniq.slice(0,6).join(', ')}${uniq.length>6?' …':''}`);
  // invariants
  const cellsCovered=new Set(); r.lights.forEach(l=>l.cells.forEach(c=>cellsCovered.add(c)));
  console.log(`  coverage: ${cellsCovered.size}/${r.stats.cells} cells served`);
  const dup = r.lights.some((a,i)=>r.lights.some((b,j)=>j>i && Math.hypot(a.x-b.x,a.y-b.y)<0.4));
  console.log(`  overlapping lights: ${dup?'YES (bad)':'none'}`);
  return r;
}

console.log('=== default: nearest wall >= 5 ft ===\n');
show('12x12 square', R(12,12));
show('18x18 square', R(18,18));
show('24x36 hall', R(36,24));
show('4ft x 30ft corridor', R(30,4));
show('L-shape 30x30 with 18x18 bite', [{x:0,y:0},{x:30,y:0},{x:30,y:12},{x:12,y:12},{x:12,y:30},{x:0,y:30}]);
show('odd 13x21 (rounding)', R(13,21));

console.log('\n=== the rule at other thresholds ===\n');
show('36x24 @ 6ft all round', R(36,24), [], {minWallDistance:6});
show('36x24 @ 4ft all round', R(36,24), [], {minWallDistance:4});
show('18x18 @ 5ft', R(18,18), [], {minWallDistance:5});

console.log('\n=== with a ceiling fan ===\n');
const f=[{type:'fan',x:18,y:12,r:2.5}];
const withFan = show('36x24 hall + fan at (18,12)', R(36,24), f);
const near = withFan.lights.filter(l=>Math.hypot(l.x-18,l.y-12)<5);
console.log('  lights within 5ft of fan:', near.map(l=>`${l.kind}@(${l.x.toFixed(1)},${l.y.toFixed(1)})`).join(' ')||'none');
console.log('  lights sharing fan x=18:', withFan.lights.filter(l=>Math.abs(l.x-18)<0.3).length);
console.log('  lights sharing fan y=12:', withFan.lights.filter(l=>Math.abs(l.y-12)<0.3).length);

console.log('\n=== alignment quality on 36x24 ===');
const r = withFan;
const cols=[...new Set(r.lights.map(l=>Math.round(l.x*4)/4))].sort((a,b)=>a-b);
const rows=[...new Set(r.lights.map(l=>Math.round(l.y*4)/4))].sort((a,b)=>a-b);
console.log('  distinct x positions:', cols.length, cols.map(v=>v.toFixed(1)).join(' '));
console.log('  distinct y positions:', rows.length, rows.map(v=>v.toFixed(1)).join(' '));

console.log('\n=== no-light zones: carve, chunk, grid, light ===\n');
const zoneVerdicts = [];
const inRect = (p, z) => p.x > z.x0 && p.x < z.x1 && p.y > z.y0 && p.y < z.y1;
const overlaps = (a, z) =>
  Math.min(a.x1, z.x1) - Math.max(a.x0, z.x0) > 1e-6 &&
  Math.min(a.y1, z.y1) - Math.max(a.y0, z.y0) > 1e-6;

function zoneCase(name, poly, zones, fixtures = [], opts = {}) {
  const r = planLights(poly, fixtures, opts, zones);
  if (!r.ok) { console.log(`${name}: FAILED - ${r.reason}`); zoneVerdicts.push(false); return r; }
  const lightsIn = r.lights.filter((l) => zones.some((z) => inRect(l, z)));
  const cellsIn  = r.cells.filter((c) => zones.some((z) => overlaps(c, z)));
  const chunksIn = r.chunks.filter((ch) => zones.some((z) => overlaps(ch, z)));
  const served = r.stats.served === r.stats.cells;
  console.log(`${name}`);
  console.log(`  ${r.stats.chunks} chunks (+${r.stats.omittedChunks} omitted), ${r.stats.cells} cells, ${r.stats.large}L/${r.stats.small}S, ${r.stats.clashes} clashes`);
  console.log(`  chunks overlapping a zone: ${chunksIn.length} | cells overlapping: ${cellsIn.length} | lights inside: ${lightsIn.length} (all must be 0)`);
  console.log(`  served ${r.stats.served}/${r.stats.cells}`);
  const pass = !lightsIn.length && !cellsIn.length && !chunksIn.length && served;
  console.log(`  VERDICT: ${pass ? 'PASS' : 'FAIL'}`);
  zoneVerdicts.push(pass);
  return r;
}

zoneCase('36x24 hall + 8x8 interior zone', R(36, 24), [{ x0: 14, y0: 8, x1: 22, y1: 16 }]);
zoneCase('36x24 + zone hugging the left wall', R(36, 24), [{ x0: 0, y0: 0, x1: 5, y1: 24 }]);
zoneCase('36x24 + two zones + fan', R(36, 24),
  [{ x0: 4, y0: 4, x1: 10, y1: 9 }, { x0: 26, y0: 14, x1: 33, y1: 21 }],
  [{ type: 'fan', x: 18, y: 12, r: 2.5 }]);
zoneCase('L-shape + zone across the notch corner',
  [{x:0,y:0},{x:30,y:0},{x:30,y:12},{x:12,y:12},{x:12,y:30},{x:0,y:30}],
  [{ x0: 8, y0: 8, x1: 16, y1: 14 }]);
zoneCase('bedroom-style: bed zone at top wall + wardrobe strip at right', R(30, 22),
  [{ x0: 6, y0: 0, x1: 15, y1: 10 }, { x0: 26, y0: 8, x1: 30, y1: 18 }]);

{
  // a zone leaving a 0.8 ft sliver: the sliver chunk must be omitted, no lights in it
  const zone = { x0: 0.8, y0: 0, x1: 9, y1: 10 };
  const r = planLights(R(36, 24), [], {}, [zone]);
  const sliverLights = r.lights.filter((l) => l.x < 0.8 && l.y < 10);
  const ok = r.ok && r.stats.omittedChunks >= 1 && sliverLights.length === 0;
  console.log(`0.8ft sliver beside a zone: omitted chunks ${r.stats.omittedChunks} (>=1), lights in sliver ${sliverLights.length} (0)`);
  console.log(`  VERDICT: ${ok ? 'PASS' : 'FAIL'}`);
  zoneVerdicts.push(ok);
}
{
  // a zone covering everything must fail loudly, not return an empty layout
  const r = planLights(R(12, 12), [], {}, [{ x0: -1, y0: -1, x1: 13, y1: 13 }]);
  console.log(`zone covering the whole room: ok=${r.ok} (must be false) — "${r.reason}"`);
  zoneVerdicts.push(r.ok === false);
}
console.log(`\nZONES OVERALL: ${zoneVerdicts.every(Boolean) ? 'PASS' : 'FAIL'}`);

console.log('\n=== regression: a fan must never leave a cell dark ===\n');
{
  const room=[{x:0,y:0},{x:23.9,y:0},{x:23.9,y:12.9},{x:0,y:12.9}];
  const F={x:6.48,y:6.80,r:2.02};
  const r=planLights(room,[{type:'fan',...F}]);
  const need=F.r+2.0;
  const inZone=r.lights.filter(l=>Math.hypot(l.x-F.x,l.y-F.y)<need-1e-6);
  console.log(`23.9x12.9 + fan near a cell centre: ${r.stats.served}/${r.stats.cells} cells served (must be all)`);
  console.log(`  ${r.stats.large}L/${r.stats.small}S, ${r.stats.nudged} nudged, ${r.stats.clashes} unavoidable clashes`);
  console.log(`  lights inside the fan zone: ${inZone.length} (must be 0)`);
  console.log(`  VERDICT: ${r.stats.served===r.stats.cells && inZone.length===0 ? 'PASS' : 'FAIL'}`);
}

console.log('\n=== multiple ceiling fans ===\n');
{
  const R = (w, h) => [{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
  const F = (x, y, r = 2.0) => ({ type: 'fan', x, y, r });
  const L = [{x:0,y:0},{x:30,y:0},{x:30,y:12},{x:12,y:12},{x:12,y:30},{x:0,y:30}];
  const cases = [
    ['36x24, two fans',        R(36,24),      [F(12,12), F(24,12)],                     []],
    ['36x24, three in a row',  R(36,24),      [F(9,12), F(18,12), F(27,12)],            []],
    ['36x24, four in a grid',  R(36,24),      [F(12,8), F(24,8), F(12,16), F(24,16)],   []],
    ['36x24, two + a zone',    R(36,24),      [F(12,12), F(24,12)],  [{x0:0,y0:0,x1:8,y1:24}]],
    ['24x13, two close fans',  R(23.9,12.9),  [F(6.5,6.8,2.02), F(16,6.8,2.02)],        []],
    ['L-shape, two fans',      L,             [F(20,6), F(6,20)],                       []],
    ['14x14, four huge fans',  R(14,14),      [F(4,4,3),F(10,4,3),F(4,10,3),F(10,10,3)],[]],
  ];
  let pass = 0;
  for (const [name, poly, fans, zones] of cases) {
    const r = planLights(poly, fans, {}, zones);
    if (!r.ok) { console.log(`  ${name}: not ok — ${r.reason}`); continue; }
    // Contract: every cell lit, and the ONLY lights inside a fan's exclusion
    // circle are the ones explicitly flagged as unavoidable clashes.
    const fouling = r.lights.filter((l) =>
      fans.some((f) => Math.hypot(l.x - f.x, l.y - f.y) < f.r + r.opt.fanClearance - 1e-6));
    const allFlagged = fouling.every((l) => l.clash);
    const ok = r.stats.served === r.stats.cells && allFlagged && r.stats.fans === fans.length;
    if (ok) pass++;
    console.log(`  ${name.padEnd(24)} ${r.stats.fans} fans, ${r.stats.served}/${r.stats.cells} lit, ` +
                `${r.stats.large}L/${r.stats.small}S, ${fouling.length} fouling (${r.stats.clashes} flagged)  ${ok ? 'PASS' : '*** FAIL ***'}`);
  }
  console.log(`\nMULTI-FAN OVERALL: ${pass === cases.length ? 'PASS' : `${cases.length - pass} FAILED`}`);
}


console.log('\n=== small lights stay on a cell centre line ===\n');
{
  const R = (w, h) => [{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
  const F = (x, y, r = 2.0) => ({ type: 'fan', x, y, r });
  const L = [{x:0,y:0},{x:30,y:0},{x:30,y:12},{x:12,y:12},{x:12,y:30},{x:0,y:30}];
  const cases = [
    ['living area from screenshot', R(25.1,19.5), [F(9.30,9.84,1.97), F(18.13,9.84,1.97)], [{x0:1.05,y0:2.86,x1:4.60,y1:16.6}]],
    ['36x24, three fans',           R(36,24),     [F(9,12), F(18,12), F(27,12)],            []],
    ['36x24, four fans + zone',     R(36,24),     [F(12,8), F(24,8), F(12,16), F(24,16)],   [{x0:0,y0:0,x1:7,y1:10}]],
    ['24x13, two close fans',       R(23.9,12.9), [F(6.5,6.8,2.02), F(16,6.8,2.02)],        []],
    ['L-shape, two fans + zone',    L,            [F(20,6), F(6,20)],  [{x0:14,y0:2,x1:22,y1:9}]],
    ['14x14, four huge fans',       R(14,14),     [F(4,4,3),F(10,4,3),F(4,10,3),F(10,10,3)],[]],
    ['30x30, fan on a cell centre', R(30,30),     [F(15,15,2.2)],                           []],
  ];
  let pass = 0;
  for (const [name, poly, fans, zones] of cases) {
    const r = planLights(poly, fans, {}, zones);
    if (!r.ok) { console.log(`  ${name}: not ok — ${r.reason}`); continue; }
    const diag = r.lights.filter((l) => l.kind === 'small' && l.cell &&
      Math.abs(l.x - l.cell.cx) > 0.05 && Math.abs(l.y - l.cell.cy) > 0.05);
    const inside = r.lights.filter((l) => l.kind === 'small' && l.cell &&
      (l.x < l.cell.x0 - 1e-6 || l.x > l.cell.x1 + 1e-6 || l.y < l.cell.y0 - 1e-6 || l.y > l.cell.y1 + 1e-6));
    const ok = diag.length === 0 && inside.length === 0 && r.stats.served === r.stats.cells;
    if (ok) pass++;
    console.log(`  ${name.padEnd(30)} ${r.stats.served}/${r.stats.cells} lit, ${r.stats.nudged} nudged, ` +
                `${diag.length} diagonal, ${inside.length} outside its cell  ${ok ? 'PASS' : '*** FAIL ***'}`);
    diag.forEach((l) => console.log(`      ${l.id} off by (${(l.x-l.cell.cx).toFixed(2)}, ${(l.y-l.cell.cy).toFixed(2)})`));
  }
  console.log(`\nCELL-AXIS OVERALL: ${pass === cases.length ? 'PASS' : `${cases.length - pass} FAILED`}`);
}
