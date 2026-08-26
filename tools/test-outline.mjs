// tools/test-outline.mjs — the traced-outline model.
import { makeOutline, resolveOutline, outlineStats, validateOutline,
         regionFromOutline, nextOutlineName } from '../src/lib/outline.js';
import { polygonArea } from '../src/lib/geometry.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`); } };
const near = (a, b, t) => Math.abs(a - b) <= t;
const sec = (s) => console.log('\n' + s);
const PPF = 20;   // px per foot

const box = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

sec('a clean trace');
{
  const o = makeOutline(box(20 * PPF, 15 * PPF), { name: 'LIVING' });
  const st = outlineStats(o, PPF);
  ok('area comes out in square feet', near(st.areaSqft, 300, 0.01), `${st.areaSqft}`);
  ok('dimensions in feet', near(st.widthFt, 20, 0.01) && near(st.heightFt, 15, 0.01),
     `${st.widthFt} x ${st.heightFt}`);
  ok('four corners stay four', st.corners === 4, `${st.corners}`);
  ok('squaring an already-square trace moves nothing', st.movedFt < 0.01, `${st.movedFt}`);
}

sec('right-angle snapping, and being able to see it');
{
  // A shaky trace: corners a couple of inches out, walls a degree off level.
  const shaky = [
    { x: 0, y: 0 }, { x: 20 * PPF, y: 3 }, { x: 20 * PPF - 4, y: 15 * PPF }, { x: 2, y: 15 * PPF - 3 },
  ];
  const o = makeOutline(shaky);
  const on = outlineStats({ ...o, rectify: true }, PPF);
  const off = outlineStats({ ...o, rectify: false }, PPF);

  ok('rectified corners are axis-aligned', on.polygonPx.every((p, i, a) => {
    const q = a[(i + 1) % a.length];
    return Math.abs(p.x - q.x) < 1e-6 || Math.abs(p.y - q.y) < 1e-6;
  }), JSON.stringify(on.polygonPx.map((p) => [p.x.toFixed(1), p.y.toFixed(1)])));
  ok('leaving it off keeps exactly what was clicked',
     off.polygonPx.length === 4 && !off.rectified
     && off.polygonPx.some((p) => Math.abs(p.y - 3) < 1e-6),
     JSON.stringify(off.polygonPx));
  ok('the correction is reported, in feet', on.movedFt > 0 && on.movedFt < 0.5, `${on.movedFt}`);
  ok('the raw trace is kept alongside, so it can be drawn',
     on.rawPx.length === 4 && on.rawPx.some((p) => Math.abs(p.y - 3) < 1e-6));
  // Squaring a shaky trace necessarily changes the area a little. What matters
  // is that it is a correction and not a reinterpretation.
  ok('squaring changes the area by well under a percent',
     Math.abs(on.areaSqft - off.areaSqft) / off.areaSqft < 0.01,
     `${on.areaSqft.toFixed(2)} vs ${off.areaSqft.toFixed(2)}`);
}

sec('an L-shaped trace keeps its notch');
{
  const L = [
    { x: 0, y: 0 }, { x: 24 * PPF, y: 0 }, { x: 24 * PPF, y: 12 * PPF },
    { x: 12 * PPF, y: 12 * PPF }, { x: 12 * PPF, y: 20 * PPF }, { x: 0, y: 20 * PPF },
  ];
  const st = outlineStats(makeOutline(L), PPF);
  ok('six corners survive rectification', st.corners === 6, `${st.corners}`);
  ok('area is 24x12 plus 12x8', near(st.areaSqft, 384, 1), `${st.areaSqft}`);
}

sec('outlines that cannot mean anything are refused');
{
  ok('two points is not an outline', validateOutline(box(100, 100).slice(0, 2), PPF).ok === false);
  ok('a two-inch square is not a room', validateOutline(box(3, 3), PPF).ok === false);
  ok('...and says why', /too small/i.test(validateOutline(box(3, 3), PPF).reason),
     validateOutline(box(3, 3), PPF).reason);

  // A bowtie: edge 1 crosses edge 3.
  const bowtie = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 0, y: 200 }, { x: 200, y: 200 }];
  const v = validateOutline(bowtie, PPF);
  ok('a self-crossing outline is caught', v.ok === false, JSON.stringify(v));
  ok('...and says what to do about it', /crosses itself/i.test(v.reason), v.reason);

  ok('a good outline passes', validateOutline(box(20 * PPF, 15 * PPF), PPF).ok === true);
  const L = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }, { x: 200, y: 200 },
             { x: 200, y: 400 }, { x: 0, y: 400 }];
  ok('a concave outline is not mistaken for a crossing', validateOutline(L, PPF).ok === true,
     validateOutline(L, PPF).reason);
}

sec('handing the outline to the rest of the app');
{
  const o = makeOutline(box(20 * PPF, 15 * PPF), { name: 'KITCHEN' });
  const r = regionFromOutline(o, PPF);
  ok('it arrives in the shape the detector used to produce',
     r.ok === true && Array.isArray(r.polygon) && Array.isArray(r.boundingRect));
  ok('the name carries', r.label === 'KITCHEN');
  ok('the area carries', near(r.areaSqft, 300, 0.01));
  ok('it says where it came from', r.source === 'traced');
  ok('a tidy-up raises no warning', !r.warning, r.warning);
  ok('the polygon is wound like the raster detector winds them',
     polygonArea(r.polygon) > 0, `${polygonArea(r.polygon)}`);

  // A trace bad enough that squaring it is a rewrite, not a tidy-up.
  const wonky = makeOutline([
    { x: 0, y: 0 }, { x: 400, y: 0 }, { x: 380, y: 300 }, { x: 20, y: 316 },
  ]);
  const w = regionFromOutline(wonky, PPF);
  ok('a large correction warns', !!w.warning, JSON.stringify(w.warning));
  ok('...in inches, which is how it will be judged', /inches/.test(w.warning), w.warning);
}

sec('naming');
{
  ok('first is Room 1', nextOutlineName([]) === 'Room 1');
  ok('skips names in use',
     nextOutlineName([{ name: 'Room 1' }, { name: 'Room 2' }]) === 'Room 3');
  ok('ignores unnamed ones', nextOutlineName([{ name: null }]) === 'Room 1');
  ok('works around a custom name',
     nextOutlineName([{ name: 'KITCHEN' }, { name: 'Room 1' }]) === 'Room 2');
  const a = makeOutline(box(10, 10)), b = makeOutline(box(10, 10));
  ok('ids are distinct', a.id !== b.id, `${a.id} ${b.id}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
