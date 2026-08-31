// One-off diagnostic: render the REAL PlanCanvas for a coved room and dump the
// markup plus the real stylesheet, so it can be hit-tested in a real browser.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { designChunking, planCeilingDesign } from '../src/lib/ceilingDesign.js';
import { PLAN_OPTIONS as opt } from '../src/lib/settings.js';

const vite = await createServer({
  server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent',
  cacheDir: path.join(os.tmpdir(), 'superluminal-render-test'),
  optimizeDeps: { noDiscovery: true, include: [] },
});
const PlanCanvas = (await vite.ssrLoadModule('/src/components/PlanCanvas.jsx')).default;

const S = 40;
const toPx = (p) => ({ x: p.x * S, y: p.y * S });
const rectPx = (r) => ({ ...r, x0: r.x0*S, y0: r.y0*S, x1: r.x1*S, y1: r.y1*S });
const corners = (R) => [{x:R.x0,y:R.y0},{x:R.x1,y:R.y0},{x:R.x1,y:R.y1},{x:R.x0,y:R.y1}].map(toPx);
// AN L, so the room has TWO design chunks and only one of them is coved —
// which is the shape the plan that reported this actually has.
const polygonFt = [{x:0,y:0},{x:30,y:0},{x:30,y:20},{x:11,y:20},{x:11,y:9},{x:0,y:9}];

const d = designChunking(polygonFt, [], opt, []);
console.log('design chunks:', d.chunks.length);
// Cove the BIGGEST chunk, the way the legacy path and a person both would.
const big = [...d.chunks].sort((a,b)=>b.area-a.area)[0];
const key = big.key;
const built = planCeilingDesign({ polygonFt, designChunks: d.chunks,
  picks: { [key]: 'cove' }, opt, criteria: 20 });
const res = built.plan;
const coves = built.coves.filter((c) => c.ok);
console.log('cove reports:', coves.length, '| lights in the room:', res.lights.length);

const room = {
  id: 'r1', name: 'Space 1',
  plan: { ...res,
    polygonPx: polygonFt.map(toPx),
    chunksPx: res.chunks.map((ch) => ({ ...rectPx(ch),
      xLines: ch.xLines.map(x=>x*S), yLines: ch.yLines.map(y=>y*S) })),
    cellsPx: res.cells.map(rectPx),
    lightsPx: res.lights.map((l) => ({ ...l, ...toPx(l), fixture: l.kind,
      design: res.chunks[l.kind==='small'?l.cell?.chunk:l.chunk]?.design ?? null,
      centrePx: l.cell ? toPx({x:l.cell.cx,y:l.cell.cy}) : null, coverPx: [] })),
    covesPx: coves.map((c) => ({ key: c.key, line: corners(c.line), offset: c.offset })),
    tracksPx: [],
  },
  design: built.parts.map((p) => ({ key: p.key, pick: p.pick,
    options: p.options.map((x)=>({id:x.id,label:x.label})),
    rect: rectPx(p.chunk), wFt: p.chunk.w, hFt: p.chunk.h })),
};
const accents = [
  // A MODEL-PLACED STRIP AND A SCONCE, the kind a reopened plan restores from
  // accentResults — drawn in the same block and after the room group.
  { id: 'm1', type: 'strip', roomId: 'r1', fixture: 'strip', label: 'Under-cabinet',
    run: [toPx({x:14,y:3}), toPx({x:26,y:3})], runLength: 12*S,
    rect: rectPx({x0:14,y0:2.8,x1:26,y1:3.2}) },
  { id: 'm2', type: 'sconce', roomId: 'r1', fixture: 'sconce',
    point: toPx({x:0.2,y:5}), inward: {x:1,y:0}, rect: rectPx({x0:0,y0:4.8,x1:0.4,y1:5.2}) },
  ...coves.map((c) => ({
  id: `cove-r1-${c.key}`, type: 'strip', kind: 'cove', roomId: 'r1', source: 'cove',
  fixture: 'strip', label: 'Cove LED strip', loop: corners(c.strip),
  runLength: c.perimeterFt * S, rect: rectPx(c.strip),
  })),
];

const svg = renderToStaticMarkup(React.createElement(PlanCanvas, {
  width: 1200, height: 900, pxPerFt: S, zoom: 1, toPx,
  layers: { lights:true, labels:false, cells:true, region:true, zones:true,
            spots:true, accents:true, grid:true },
  plans: [room], accents, focusId: 'r1', selectedId: 'r1',
  onPickChunk: () => {}, onCycleOption: () => {},
}));
const css = fs.readFileSync('src/styles.css', 'utf8');
fs.mkdirSync('.detect-debug', { recursive: true });
fs.writeFileSync('.detect-debug/hittest.html',
  `<!doctype html><meta charset="utf-8"><style>body{margin:0}\n${css}</style>\n`
  + `<div class="canvas-wrap">${svg}</div>\n`);
console.log('cove line px rect:', JSON.stringify(room.plan.covesPx[0].line));
console.log('wrote .detect-debug/hittest.html', fs.statSync('.detect-debug/hittest.html').size, 'bytes');
await vite.close();
