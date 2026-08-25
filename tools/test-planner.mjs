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
  const served = r.stats.served + r.stats.ceded === r.stats.cells;
  console.log(`${name}`);
  console.log(`  ${r.stats.chunks} chunks (+${r.stats.omittedChunks} omitted), ${r.stats.cells} cells, ${r.stats.large}L/${r.stats.small}S, ${r.stats.clashes} clashes`);
  console.log(`  chunks overlapping a zone: ${chunksIn.length} | cells overlapping: ${cellsIn.length} | lights inside: ${lightsIn.length} (all must be 0)`);
  console.log(`  served ${r.stats.served}+${r.stats.ceded}/${r.stats.cells}`);
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
  console.log(`23.9x12.9 + fan near a cell centre: ${r.stats.served}+${r.stats.ceded}/${r.stats.cells} cells served (must be all)`);
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
    const ok = r.stats.served + r.stats.ceded === r.stats.cells && allFlagged && r.stats.fans === fans.length;
    if (ok) pass++;
    console.log(`  ${name.padEnd(24)} ${r.stats.fans} fans, ${r.stats.served}+${r.stats.ceded}/${r.stats.cells} lit, ` +
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
    const ok = diag.length === 0 && inside.length === 0 && r.stats.served + r.stats.ceded === r.stats.cells;
    if (ok) pass++;
    console.log(`  ${name.padEnd(30)} ${r.stats.served}+${r.stats.ceded}/${r.stats.cells} lit, ${r.stats.nudged} nudged, ` +
                `${diag.length} diagonal, ${inside.length} outside its cell  ${ok ? 'PASS' : '*** FAIL ***'}`);
    diag.forEach((l) => console.log(`      ${l.id} off by (${(l.x-l.cell.cx).toFixed(2)}, ${(l.y-l.cell.cy).toFixed(2)})`));
  }
  console.log(`\nCELL-AXIS OVERALL: ${pass === cases.length ? 'PASS' : `${cases.length - pass} FAILED`}`);
}

console.log('\n=== awkward cells prefer a large light (large-first mode) ===\n');
{
  const R = (w, h) => [{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
  const F = (x, y, r = 1.97) => ({ type: 'fan', x, y, r });
  const L = [{x:0,y:0},{x:30,y:0},{x:30,y:12},{x:12,y:12},{x:12,y:30},{x:0,y:30}];

  // 1. the rule demonstrably changes the outcome, and never for the worse
  const rooms = [['30x30',R(30,30)],['36x24',R(36,24)],['30x18',R(30,18)],['24x24',R(24,24)],['L30',L]];
  let changed = 0, free = 0, paid = 0, neutral = 0, worse = 0, unlit = 0, offAxis = 0;
  for (const [, poly] of rooms) {
    for (const cl of [0.5, 1.5, 2.0]) {
      for (let fx = 3; fx <= 33; fx += 2.5) for (let fy = 3; fy <= 30; fy += 2.5) {
        const fans = [F(fx, fy)];
        const on = planLights(poly, fans, { fanClearance: cl, smallFirst: false });
        const off = planLights(poly, fans, { fanClearance: cl, smallFirst: false, awkwardPriority: 0 });
        if (!on.ok || !off.ok) continue;
        if (on.stats.served + on.stats.ceded !== on.stats.cells) unlit++;
        offAxis += on.stats.offAxis;
        if (on.stats.rescued === off.stats.rescued && on.stats.large === off.stats.large) continue;
        changed++;
        const dL = on.stats.large - off.stats.large;
        const gained = (off.stats.outsideBand + off.stats.ceded) - (on.stats.outsideBand + on.stats.ceded);
        if (gained > 0 && dL >= 0) free++;
        else if (gained > 0) paid++;
        else if (gained === 0) neutral++;   // rearranged, equally good
        else worse++;
      }
    }
  }
  console.log(`  swept ${rooms.length} rooms x 5 clearances x fan positions`);
  console.log(`    outcome changed by the rule : ${changed}`);
  console.log(`    rescued with no large lights lost : ${free}`);
  console.log(`    rescued by trading a large light  : ${paid}`);
  console.log(`    made worse                        : ${worse}   (must be 0)`);
  console.log(`    cells left unlit                  : ${unlit}   (must be 0)`);
  console.log(`    lights diagonal to their cell     : ${offAxis}   (must be 0)`);
  const sweepOK = worse === 0 && unlit === 0 && offAxis === 0 && changed > 0 && free > 0;
  console.log(`  SWEEP: ${sweepOK ? 'PASS' : '*** FAIL ***'}`);

  // 2. a light that stays a small light is always inside the centre band
  let bandOK = true;
  for (const [name, poly] of rooms) {
    for (const fans of [[F(15,15)], [F(9,9), F(21,21)], []]) {
      const r = planLights(poly, fans, {});
      if (!r.ok) continue;
      for (const l of r.lights) {
        if (l.kind !== 'small' || !l.cell || l.outsideBand) continue;
        const fx = Math.abs(l.x - l.cell.cx) / l.cell.w, fy = Math.abs(l.y - l.cell.cy) / l.cell.h;
        if (fx > r.opt.centreBand + 1e-6 || fy > r.opt.centreBand + 1e-6) {
          bandOK = false;
          console.log(`    ${name} ${l.id}: ${(Math.max(fx,fy)*100).toFixed(0)}% off centre, band is ${r.opt.centreBand*100}%`);
        }
      }
    }
  }
  console.log(`  CENTRE BAND respected by every un-flagged small light: ${bandOK ? 'PASS' : '*** FAIL ***'}`);
  console.log(`\nAWKWARD-CELL OVERALL: ${sweepOK && bandOK ? 'PASS' : 'FAILED'}`);
}

console.log('\n=== hard guarantee: no small light outside the centre band ===\n');
{
  const R = (w, h) => [{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
  const F = (x, y, r) => ({ type: 'fan', x, y, r });
  const L = [{x:0,y:0},{x:30,y:0},{x:30,y:12},{x:12,y:12},{x:12,y:30},{x:0,y:30}];
  const shapes = [['24.2x19',R(24.2,19)],['36x24',R(36,24)],['30x30',R(30,30)],['20x14',R(20,14)],
                  ['13x21',R(13,21)],['L30',L],['30x8',R(30,8)]];
  let worst = 0, worstAt = '', checked = 0, bad = 0, holes = 0, cededTotal = 0;
  for (const [name, poly] of shapes) {
    for (const r0 of [1.5, 2.5]) {
      for (const cl of [1.0, 3.0]) {
        for (let fx = 2; fx <= 30; fx += 3.7) {
          for (let fy = 2; fy <= 28; fy += 4.6) {
            const fans = [F(fx, fy, r0), F(fx + 8.4, fy, r0)];
            const r = planLights(poly, fans, { fanClearance: cl });
            if (!r.ok) continue;
            checked++;
            if (r.stats.served + r.stats.ceded !== r.stats.cells) holes++;
            cededTotal += r.stats.ceded;
            for (const l of r.lights) {
              if (l.kind !== 'small' || !l.cell) continue;
              const off = Math.max(Math.abs(l.x - l.cell.cx) / l.cell.w,
                                   Math.abs(l.y - l.cell.cy) / l.cell.h);
              if (off > worst) { worst = off; worstAt = `${name} r${r0} cl${cl} fan(${fx.toFixed(1)},${fy.toFixed(1)})`; }
              if (off > r.opt.centreBand + 1e-6) bad++;
            }
          }
        }
      }
    }
  }
  console.log(`  ${checked} layouts checked across ${shapes.length} shapes x 2 fan sizes x 2 clearances`);
  console.log(`  worst small light offset: ${(worst * 100).toFixed(1)}% of its cell (band is 20%)`);
  console.log(`    at ${worstAt}`);
  console.log(`  lights outside the band : ${bad}   (must be 0)`);
  console.log(`  unexplained dark cells  : ${holes}   (must be 0)`);
  console.log(`  cells ceded to a fan    : ${cededTotal}`);
  console.log(`\nBAND GUARANTEE: ${bad === 0 && holes === 0 ? 'PASS' : '*** FAIL ***'}`);
}

console.log('\n=== large lights: allowed spots and spacing ===\n');
{
  const R = (w, h) => [{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
  const F = (x, y, r) => ({ type: 'fan', x, y, r });
  const L = [{x:0,y:0},{x:30,y:0},{x:30,y:12},{x:12,y:12},{x:12,y:30},{x:0,y:30}];
  const shapes = [['24.2x19',R(24.2,19)],['36x24',R(36,24)],['30x30',R(30,30)],['20x14',R(20,14)],['L30',L],['42x28',R(42,28)]];
  let checked = 0, offLine = 0, offSpot = 0, tooClose = 0, minGap = Infinity, minGapAt = '';
  let gained = 0, lost = 0;
  for (const [name, poly] of shapes) {
    for (const fans of [[], [F(12,10,1.97)], [F(9,9,1.97), F(19,9,1.97)], [F(15,15,2.5)]]) {
      for (const cl of [0.5, 1.0, 2.0]) {
      for (const smallFirst of [true, false]) {
        const on  = planLights(poly, fans, { fanClearance: cl, smallFirst });
        const off = planLights(poly, fans, { fanClearance: cl, smallFirst,
          allowEdgeSliding: false, allowChunkAxis: false, allowGridEdgePositions: false, allowRoaming: false });
        if (!on.ok || !off.ok) continue;
        // the exception should never reduce how much is lit
        const litOn = on.stats.served, litOff = off.stats.served;
        if (litOn > litOff || on.stats.large > off.stats.large) gained++;
        if (litOn < litOff) lost++;
        const bigs = on.lights.filter((l) => l.kind === 'large' && !l.roaming);
        for (const l of bigs) {
          checked++;
          const cell = on.cells.find((c) => c.id === l.cells[0]);
          const ch = on.chunks.find((c) => c.id === cell.chunk);
          // sits exactly on a grid line of its own chunk
          const line = l.axis === 'v'
            ? ch.xLines.some((v) => Math.abs(v - l.x) < 1e-6)
            : ch.yLines.some((v) => Math.abs(v - l.y) < 1e-6);
          if (!line) offLine++;
          // and at one of the allowed positions along that line
          const along = l.axis === 'v' ? l.y : l.x;
          if (!(l.allowed || []).some((v) => Math.abs(v - along) < 1e-6)) offSpot++;
        }
        // no two lights crowded together
        for (let i = 0; i < on.lights.length; i++) {
          for (let j = i + 1; j < on.lights.length; j++) {
            const d = Math.hypot(on.lights[i].x - on.lights[j].x, on.lights[i].y - on.lights[j].y);
            if (d < minGap) { minGap = d; minGapAt = `${name} cl${cl} ${on.lights[i].id}/${on.lights[j].id}`; }
            if (d < on.opt.minLightSpacing - 1e-6) tooClose++;
          }
        }
      }
      }
    }
  }
  console.log(`  ${checked} large lights across ${shapes.length} shapes x 4 fan sets x 3 clearances x 2 strategies`);
  console.log(`    not on a grid line of their chunk : ${offLine}   (must be 0)`);
  console.log(`    not at an allowed spot            : ${offSpot}   (must be 0)`);
  console.log(`    pairs closer than min spacing     : ${tooClose}   (must be 0)`);
  console.log(`    closest pair anywhere             : ${minGap.toFixed(2)} ft  (${minGapAt})`);
  console.log(`    layouts that gained a large light : ${gained}`);
  console.log(`    layouts that lost one             : ${lost}   (must be 0)`);
  const ok = offLine === 0 && offSpot === 0 && tooClose === 0 && lost === 0 && gained > 0;
  console.log(`\nLARGE-SPOT OVERALL: ${ok ? 'PASS' : '*** FAIL ***'}`);
}


console.log('\n=== small lights first: large lights only where forced ===\n');
{
  const R = (w, h) => [{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
  const F = (x, y, r) => ({ type: 'fan', x, y, r });
  const L = [{x:0,y:0},{x:30,y:0},{x:30,y:12},{x:12,y:12},{x:12,y:30},{x:0,y:30}];
  const shapes = [['24.2x19',R(24.2,19)],['36x24',R(36,24)],['30x30',R(30,30)],['20x14',R(20,14)],
                  ['L30',L],['42x28',R(42,28)],['13x21',R(13,21)]];

  // 1. no fan anywhere => no large light anywhere
  let strayLarge = 0, fanFree = 0;
  for (const [, poly] of shapes) {
    const r = planLights(poly, [], {});
    if (!r.ok) continue;
    fanFree++;
    strayLarge += r.stats.large;
    for (const l of r.lights) if (l.kind === 'small' && l.cell) {
      const off = Math.max(Math.abs(l.x - l.cell.cx) / l.cell.w, Math.abs(l.y - l.cell.cy) / l.cell.h);
      if (off > 1e-9) strayLarge += 100; // a fan-free plan should need no nudging either
    }
  }
  console.log(`  ${fanFree} fan-free rooms: ${strayLarge} large lights / off-centre lights  (must be 0)`);

  // 2. with fans: every large light must rescue at least one awkward cell,
  //    and no awkward cell may be ceded while a rescue was available
  let checked = 0, pointless = 0, ceded = 0, rescued = 0, worseThanLargeFirst = 0;
  for (const [, poly] of shapes) {
    for (const fans of [[F(12,10,1.97)], [F(9,9,1.97), F(19,9,1.97)], [F(15,15,2.5)], [F(6,6,2.2), F(18,18,2.2)]]) {
      for (const cl of [0.5, 1.0, 2.0, 3.0]) {
        const r = planLights(poly, fans, { fanClearance: cl });
        if (!r.ok) continue;
        checked++;
        const awk = new Set(r.awkwardCells);
        for (const l of r.lights.filter((x) => x.kind === 'large')) {
          const helps = l.cells.some((c) => awk.has(c));
          if (!helps) pointless++;
          else rescued += l.cells.filter((c) => awk.has(c)).length;
        }
        ceded += r.stats.ceded;
        // small-first must never light fewer cells than large-first would
        const lf = planLights(poly, fans, { fanClearance: cl, smallFirst: false });
        if (lf.ok && (r.stats.ceded + r.stats.outsideBand) > (lf.stats.ceded + lf.stats.outsideBand)) worseThanLargeFirst++;
      }
    }
  }
  console.log(`  ${checked} layouts with fans`);
  console.log(`    large lights that rescue nobody   : ${pointless}   (must be 0)`);
  console.log(`    awkward cells rescued by a large  : ${rescued}`);
  console.log(`    cells ceded                       : ${ceded}`);
  console.log(`    worse coverage than large-first   : ${worseThanLargeFirst}   (must be 0)`);
  const ok = strayLarge === 0 && pointless === 0 && worseThanLargeFirst === 0 && rescued > 0;
  console.log(`\nSMALL-FIRST OVERALL: ${ok ? 'PASS' : '*** FAIL ***'}`);
}

console.log('\n=== coverage: one light per box, vertex lights cover four ===\n');
{
  const R = (w, h) => [{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
  const F = (x, y, r) => ({ type: 'fan', x, y, r });
  const L = [{x:0,y:0},{x:30,y:0},{x:30,y:12},{x:12,y:12},{x:12,y:30},{x:0,y:30}];
  const shapes = [['24.2x19',R(24.2,19)],['36x24',R(36,24)],['30x30',R(30,30)],['20x14',R(20,14)],
                  ['L30',L],['42x28',R(42,28)],['13x21',R(13,21)],['30x8',R(30,8)]];
  const TOUCH = 1e-6;
  let layouts = 0, doubleLit = 0, wrongCover = 0, vertex = 0, edge = 0, roam = 0, mismatch = 0, uncovered = 0;
  const modes = [{ smallFirst: true }, { smallFirst: false }];
  for (const [name, poly] of shapes) {
    for (const fans of [[], [F(12,10,1.97)], [F(9,9,1.97), F(19,9,1.97)], [F(15,15,2.5)], [F(6,6,2.2), F(18,18,2.2)]]) {
      for (const cl of [0.5, 1.5, 3.0]) {
        for (const mode of modes) {
          const r = planLights(poly, fans, { ...mode, fanClearance: cl });
          if (!r.ok) continue;
          layouts++;
          // rule 1 — no box lit twice
          const count = new Map();
          for (const l of r.lights) for (const id of l.cells) count.set(id, (count.get(id) || 0) + 1);
          for (const [, n] of count) if (n > 1) doubleLit++;
          // every box lit once or explicitly ceded
          const ced = new Set(r.cededCells.map((c) => c.id));
          for (const c of r.cells) if (!count.has(c.id) && !ced.has(c.id)) uncovered++;
          // rule 2 — a large light on a grid line lights exactly the boxes it
          // touches. A roaming one serves its assigned pair and must at least
          // sit inside one of them.
          for (const l of r.lights.filter((x) => x.kind === 'large')) {
            const touch = r.cells.filter((c) =>
              l.x >= c.x0 - TOUCH && l.x <= c.x1 + TOUCH &&
              l.y >= c.y0 - TOUCH && l.y <= c.y1 + TOUCH).map((c) => c.id);
            if (l.roaming) {
              roam++;
              if (l.cells.length !== 2) wrongCover++;
              if (!touch.some((id) => l.cells.includes(id))) mismatch++;
              continue;
            }
            if (touch.length === 4) vertex++; else if (touch.length === 2) edge++; else wrongCover++;
            const same = touch.length === l.cells.length && touch.every((id) => l.cells.includes(id));
            if (!same) mismatch++;
          }
          // small lights light exactly their own box
          for (const l of r.lights.filter((x) => x.kind === 'small')) if (l.cells.length !== 1) wrongCover++;
        }
      }
    }
  }
  console.log(`  ${layouts} layouts, both strategies`);
  console.log(`    boxes lit by more than one light : ${doubleLit}   (must be 0)`);
  console.log(`    boxes neither lit nor ceded      : ${uncovered}   (must be 0)`);
  console.log(`    large lights on a vertex (4 boxes): ${vertex}`);
  console.log(`    large lights on an edge (2 boxes) : ${edge}`);
  console.log(`    roaming lights (2 boxes, off-line): ${roam}`);
  console.log(`    coverage not 1 / 2 / 4 boxes     : ${wrongCover}   (must be 0)`);
  console.log(`    recorded coverage != geometry    : ${mismatch}   (must be 0)`);
  const ok = doubleLit === 0 && uncovered === 0 && wrongCover === 0 && mismatch === 0 && edge > 0;
  console.log(`\nCOVERAGE OVERALL: ${ok ? 'PASS' : '*** FAIL ***'}`);
}


console.log('\n=== roaming is a last resort, and stays inside its own pair ===\n');
{
  const R = (w, h) => [{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
  const F = (x, y, r) => ({ type: 'fan', x, y, r });
  const L = [{x:0,y:0},{x:30,y:0},{x:30,y:12},{x:12,y:12},{x:12,y:30},{x:0,y:30}];
  const shapes = [['22.7x17.7',R(22.7,17.7)],['24.2x19',R(24.2,19)],['36x24',R(36,24)],
                  ['30x30',R(30,30)],['20x14',R(20,14)],['L30',L]];
  let layouts = 0, roamers = 0, outside = 0, betterWithout = 0, roamWhenAnchorFree = 0, fanFreeRoam = 0;
  for (const [, poly] of shapes) {
    // no fan at all: nothing should be roaming, because nothing should be large
    const clean = planLights(poly, [], {});
    if (clean.ok) fanFreeRoam += clean.lights.filter((l) => l.roaming).length;
    for (const fans of [[F(8.29,8.52,1.97), F(16.96,8.52,1.97)], [F(12,10,1.97)],
                        [F(15,15,2.5)], [F(6,6,2.2), F(18,18,2.2)]]) {
      for (const cl of [0.5, 1.0, 2.0, 3.0]) {
        const on = planLights(poly, fans, { fanClearance: cl });
        const off = planLights(poly, fans, { fanClearance: cl, allowRoaming: false });
        if (!on.ok || !off.ok) continue;
        layouts++;
        // roaming must never make the result worse
        if ((on.stats.ceded + on.stats.outsideBand) > (off.stats.ceded + off.stats.outsideBand)) betterWithout++;
        for (const l of on.lights.filter((x) => x.roaming)) {
          roamers++;
          // it must sit within the two boxes it serves
          const boxes = l.cells.map((id) => on.cells.find((c) => c.id === id));
          const inside = boxes.some((c) => l.x >= c.x0 - 1e-6 && l.x <= c.x1 + 1e-6
                                        && l.y >= c.y0 - 1e-6 && l.y <= c.y1 + 1e-6);
          if (!inside) outside++;
          // and only when the on-line options for that pair were worse
          if (l.spot !== 'roam') roamWhenAnchorFree++;
        }
      }
    }
  }
  console.log(`  ${layouts} layouts`);
  console.log(`    roaming lights placed            : ${roamers}`);
  console.log(`    roaming light outside its boxes  : ${outside}   (must be 0)`);
  console.log(`    mislabelled roamers              : ${roamWhenAnchorFree}   (must be 0)`);
  console.log(`    layouts better with roaming OFF  : ${betterWithout}   (must be 0)`);
  console.log(`    roaming in a fan-free plan       : ${fanFreeRoam}   (must be 0)`);
  const ok = outside === 0 && betterWithout === 0 && fanFreeRoam === 0 && roamWhenAnchorFree === 0 && roamers > 0;
  console.log(`\nROAMING OVERALL: ${ok ? 'PASS' : '*** FAIL ***'}`);
}
