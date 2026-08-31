// ---------------------------------------------------------------------------
// test-cad-export.mjs — the DXF that has to land ON the drawing it came from.
//
// The only property that matters here is the round trip. Every other export in
// this app produces a standalone drawing, where being a few units out is a
// cosmetic problem; this one is imported back over the original, where being a
// few units out means the whole lighting layer is in the next flat along.
//
// So the tests convert BACK — export, re-read the file, run the coordinates
// through fromDu, and check they land on the pixels they started from. A
// self-consistent export that is uniformly wrong passes any check that only
// looks at the file.
//
// The DXF is scanned here rather than fed to parseDXF, on purpose: this is
// asserting what the FILE says, and borrowing our own reader would let a
// shared misunderstanding agree with itself.
//
//   node tools/test-cad-export.mjs
// ---------------------------------------------------------------------------

import { parseDXF, UNITS } from '../src/lib/dxf.js';
import { vectorSource } from '../src/lib/planSource.js';
import { toSuperluminalDXF, SUPERLUMINAL_LAYERS } from '../src/lib/exporters.js';
import { dxf, line } from './dxfwrite.mjs';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e;

/** A minimal, independent DXF reader: group-code pairs into entities. */
function scan(text) {
  const t = text.split('\n');
  const pairs = [];
  for (let i = 0; i + 1 < t.length; i += 2) pairs.push([t[i].trim(), t[i + 1]]);
  const header = {}, layers = [], entities = [];
  let cur = null, vertex = null, section = null, inLayerTable = false;
  let pendingVar = null;
  for (const [code, value] of pairs) {
    if (code === '2' && section === null) { section = value; continue; }
    if (code === '0' && value === 'ENDSEC') { section = null; inLayerTable = false; continue; }
    if (code === '9') { pendingVar = value; continue; }
    if (pendingVar && (code === '70' || code === '1')) { header[pendingVar] = value; pendingVar = null; continue; }
    if (code === '2' && value === 'LAYER') { inLayerTable = true; continue; }
    if (code === '0') {
      if (value === 'LAYER') { cur = { type: 'LAYER' }; layers.push(cur); continue; }
      if (value === 'VERTEX') { vertex = {}; cur?.verts?.push(vertex); continue; }
      if (value === 'SEQEND') { vertex = null; continue; }
      vertex = null;
      cur = { type: value, verts: value === 'POLYLINE' ? [] : undefined };
      if (['LINE', 'CIRCLE', 'POLYLINE', 'TEXT'].includes(value)) entities.push(cur);
      continue;
    }
    const target = vertex || cur;
    if (!target) continue;
    if (code === '8') target.layer = value;
    else if (code === '2' && target.type === 'LAYER') target.name = value;
    else if (code === '62') target.colour = Number(value);
    else if (code === '70' && target.type === 'POLYLINE') target.closed = value.trim() === '1';
    else if (['10','20','11','21','40'].includes(code)) target[code] = Number(value);
  }
  return { header, layers, entities };
}

// --- a real drawing, in MILLIMETRES, with a non-zero origin -----------------
// Both of those matter: a millimetre drawing catches a missing unit conversion
// (300x out), and an offset origin catches an export that quietly assumes 0,0.
const MM = 304.8;
const OX = 51234.5, OY = -8765.25;   // deliberately awkward
// 15 x 12 ft, and the size is load-bearing: parseDXF second-guesses $INSUNITS
// against how big the drawing would then be, and a 5 x 4 ft "building" in
// millimetres is below its plausibility floor — it comes back as centimetres and
// every length assertion below fails by a factor of ten. See "Units" in the
// README. A realistic room is read as the millimetres the header claims.
const w = 15 * MM, h = 12 * MM;
const walls = [
  line('A-WALL', OX, OY, OX + w, OY),
  line('A-WALL', OX + w, OY, OX + w, OY + h),
  line('A-WALL', OX + w, OY + h, OX, OY + h),
  line('A-WALL', OX, OY + h, OX, OY),
];
const drawing = parseDXF(dxf({ insunits: 4, entities: walls }));
ok(drawing.ok, `the fixture parses: ${drawing.reason ?? 'ok'}`);
const source = vectorSource(drawing, { name: 'fixture.dxf' });
ok(source.drawing.units.id === 'mm', `and reads as millimetres: ${source.drawing.units.id}`);

// A point in DRAWING units -> pixels, the way the app holds everything.
const du = { x: OX + 2 * MM, y: OY + 1.5 * MM };
const px = source.fromDu(du);

console.log('\n-- the round trip --');
{
  const out = toSuperluminalDXF({
    source,
    rooms: [{ name: 'R', plan: { polygonPx: [source.fromDu({x:OX,y:OY}), source.fromDu({x:OX+w,y:OY}),
      source.fromDu({x:OX+w,y:OY+h}), source.fromDu({x:OX,y:OY+h})],
      lightsPx: [{ id: 'S0', kind: 'small', ...px }] } }],
  });
  const { header, layers, entities } = scan(out);

  ok(header.$ACADVER === 'AC1009', `R12, the dialect everything reads: ${header.$ACADVER}`);
  ok(header.$INSUNITS === '4', `INSUNITS carries the ORIGINAL units, not ours: ${header.$INSUNITS}`);

  const names = layers.map((l) => l.name).sort();
  ok(names.join(',') === 'superluminal_ceiling_objects,superluminal_decorative,'
     + 'superluminal_led_strips,superluminal_reverse_coves,superluminal_rooms,'
     + 'superluminal_spots',
    `six layers, declared in a real LAYER table: ${names.join(', ')}`);
  ok(layers.every((l) => l.colour > 0), 'each with a colour');
  ok(new Set(layers.map((l) => l.colour)).size === layers.length,
    'and a distinct one, so they are told apart on import');

  // THE ASSERTION THIS FILE EXISTS FOR.
  const circle = entities.find((e) => e.type === 'CIRCLE' && e.layer === SUPERLUMINAL_LAYERS.spots);
  ok(!!circle, 'an ambient downlight is on the spots layer');
  ok(near(circle['10'], du.x, 0.01) && near(circle['20'], du.y, 0.01),
    `and at the drawing's own coordinate: ${circle['10'].toFixed(1)},${circle['20'].toFixed(1)}`
    + ` vs ${du.x.toFixed(1)},${du.y.toFixed(1)}`);
  // ...and it is not accidentally right because everything is near the origin.
  ok(Math.abs(du.x) > 1000, 'with an origin far enough out that 0,0 would fail this');

  // Radius in the drawing's units: 0.29 ft of millimetres, not 0.29.
  ok(near(circle['40'], 0.29 * MM, 0.01), `the symbol is real-size in mm: ${circle['40'].toFixed(1)}`);

  // The room outline: one closed polyline, back on its own walls.
  const poly = entities.find((e) => e.type === 'POLYLINE' && e.layer === SUPERLUMINAL_LAYERS.rooms);
  ok(!!poly && poly.closed, 'the room is one CLOSED polyline, not loose lines');
  ok(poly.verts.length === 4, `with four vertices: ${poly.verts.length}`);
  const xs = poly.verts.map((v) => v['10']), ys = poly.verts.map((v) => v['20']);
  ok(near(Math.min(...xs), OX, 0.01) && near(Math.max(...xs), OX + w, 0.01)
     && near(Math.min(...ys), OY, 0.01) && near(Math.max(...ys), OY + h, 0.01),
    'sitting exactly on the original walls');
}

console.log('\n-- Y is not flipped twice, and a rotation is not mirrored --');
{
  // toDu inverts the import, so a LARGER screen y is a SMALLER drawing y. That
  // is the flip an angle carried across as a number would come out mirrored by.
  const lo = source.toDu({ x: 0, y: 10 }), hi = source.toDu({ x: 0, y: 200 });
  ok(hi.y < lo.y, 'screen Y down is drawing Y up — the flip is real');

  // A 4x1 cassette turned 30 degrees. Exported corner by corner, so the
  // rectangle in the file must be the same rectangle, not its mirror image.
  const rot = Math.PI / 6;
  const o = { kind: 'ac', ...px, w: 4 * source.pxPerFt, h: 1 * source.pxPerFt, rot,
              r: 1, source: 'placed' };
  const { entities } = scan(toSuperluminalDXF({ source, objects: [o] }));
  const poly = entities.find((e) => e.type === 'POLYLINE' && e.layer === SUPERLUMINAL_LAYERS.objects);
  ok(!!poly && poly.verts.length === 4, 'the cassette is a closed 4-point polyline');

  // Rebuild the expected corners in PIXELS and convert — the same route the
  // exporter takes, but written out longhand here.
  const c = Math.cos(rot), sn = Math.sin(rot);
  const want = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([sx, sy]) => {
    const lx = (sx * o.w) / 2, ly = (sy * o.h) / 2;
    return source.toDu({ x: o.x + lx * c - ly * sn, y: o.y + lx * sn + ly * c });
  });
  ok(want.every((p, i) => near(poly.verts[i]['10'], p.x, 0.01) && near(poly.verts[i]['20'], p.y, 0.01)),
    'and its corners are where transforming the pixels puts them');

  // The long edge must still be 4 ft long in the file, and the short one 1 ft.
  const edge = (i, j) => Math.hypot(poly.verts[j]['10'] - poly.verts[i]['10'],
                                    poly.verts[j]['20'] - poly.verts[i]['20']);
  ok(near(edge(0, 1), 4 * MM, 1) && near(edge(1, 2), 1 * MM, 1),
    `4 ft x 1 ft survives the trip: ${(edge(0,1)/MM).toFixed(2)} x ${(edge(1,2)/MM).toFixed(2)} ft`);
}

console.log('\n-- the layers follow the TRADE, not the pass that made the thing --');
{
  const out = toSuperluminalDXF({
    source,
    rooms: [{ name: 'R', plan: { polygonPx: [], lightsPx: [{ id:'S0', kind:'small', ...px }] } }],
    accents: [
      { type: 'strip', run: [source.fromDu({x:OX+MM,y:OY+MM}), source.fromDu({x:OX+3*MM,y:OY+MM})] },
      { type: 'sconce', point: source.fromDu({x:OX,y:OY+2*MM}) },
      { type: 'sconce', point: source.fromDu({x:OX,y:OY+3*MM}), rejected: 'off the wall' },
    ],
    spots: [{ x: px.x, y: px.y, target: { x: px.x + 50, y: px.y } }],
  });
  const { entities } = scan(out);
  const on = (layer, type) => entities.filter((e) => e.layer === layer && (!type || e.type === type));
  const S = SUPERLUMINAL_LAYERS;

  // An ambient downlight and a DIRECTIONAL spot share a layer: they are one
  // recessed schedule, whether they light a ceiling evenly or aim at a table.
  ok(on(S.spots, 'CIRCLE').length === 2,
    `ambient and directional spots share a layer: ${on(S.spots, 'CIRCLE').length}`);
  ok(on(S.spots, 'LINE').some(() => true), 'and the aiming tail goes with them');

  // A strip is a linear product on its own driver, so its own layer.
  const strip = entities.find((e) => e.type === 'POLYLINE' && e.layer === S.strips);
  ok(!!strip && strip.closed === false, 'a strip is an OPEN polyline on its own layer');
  ok(near(Math.hypot(strip.verts[1]['10'] - strip.verts[0]['10'],
                     strip.verts[1]['20'] - strip.verts[0]['20']), 2 * MM, 1),
    'and its length is the run length');
  ok(on(S.spots, 'POLYLINE').length === 0, 'and no strip leaks onto the spots layer');

  // A sconce is specified by model number, so it is decorative.
  ok(on(S.decorative, 'CIRCLE').length === 1,
    `the accepted sconce is decorative: ${on(S.decorative, 'CIRCLE').length}`);
  ok(on(S.decorative, 'CIRCLE').length === 1,
    'and the refused one is not exported at all');
}


console.log('\n-- a chandelier is a LIGHT on a drawing, not a ceiling object --');
{
  // In the planner a chandelier is an obstacle, identical to a fan. On a drawing
  // it is bought from a lighting supplier and switched with the sconces, so it
  // changes layer on the way out. That divergence is deliberate and is the one
  // thing about this exporter most likely to look like a bug.
  const S = SUPERLUMINAL_LAYERS;
  const { entities } = scan(toSuperluminalDXF({
    source,
    objects: [
      { kind: 'chandelier', ...px, r: 0.5 * source.pxPerFt, source: 'placed' },
      { kind: 'fan', x: px.x + 40, y: px.y, r: 2 * source.pxPerFt, source: 'placed' },
      { kind: 'trapdoor', x: px.x, y: px.y + 40, w: source.pxPerFt, h: source.pxPerFt,
        rot: 0, r: 1, source: 'placed' },
    ],
  }));
  const on = (l, t) => entities.filter((e) => e.layer === l && (!t || e.type === t));
  ok(on(S.decorative, 'CIRCLE').length === 1, 'the chandelier is on decorative');
  ok(on(S.objects, 'CIRCLE').length === 1, 'the fan stays on ceiling objects');
  ok(on(S.objects, 'POLYLINE').length === 1, 'and so does the trap door');
  ok(on(S.objects, 'CIRCLE').every((c) => !near(c['10'], px.x, 1)),
    'the chandelier does not appear on BOTH layers');
  ok(on(S.spots).length === 0, 'and nothing lands on spots — there are no spots here');
}

console.log('\n-- it refuses what it cannot line up with --');
{
  let threw = null;
  try { toSuperluminalDXF({ source: { kind: 'raster' }, rooms: [] }); }
  catch (e) { threw = e.message; }
  ok(/original DXF/.test(threw ?? ''), `a raster plan is refused with a reason: "${threw}"`);
}

console.log('\n-- a reverse cove is the SLOT, not the tape in it --');
{
  // A cove hugging a wall: an 8in band with a run down its middle. It goes out
  // as a closed rectangle on its own layer — a ceiling contractor's line, weeks
  // before the electrician's — and NOT as the two-point run on the strips
  // layer, which is the tape's geometry and says nothing about the ceiling that
  // has to be built to hold it.
  const rect = { x0: px.x, y0: px.y, x1: px.x + 9 * source.pxPerFt,
                 y1: px.y + (8 / 12) * source.pxPerFt };
  const mid = (rect.y0 + rect.y1) / 2;
  const run = [{ x: rect.x0, y: mid }, { x: rect.x1, y: mid }];
  const cove = { id: 'rc', type: 'strip', kind: 'reverse-cove',
                 fixture: 'reverse-cove', roomId: 'r1', run, rect };
  const { entities } = scan(toSuperluminalDXF({ source, accents: [cove] }));
  const onCove = entities.filter((e) => e.layer === 'superluminal_reverse_coves');
  const onStrip = entities.filter((e) => e.layer === 'superluminal_led_strips');
  ok(onCove.length === 1, `one entity on the reverse-cove layer: ${onCove.length}`);
  ok(onStrip.length === 0, 'and nothing on the strips layer — the tape is not drawn twice');
  ok(onCove[0].type === 'POLYLINE', `drawn as a polyline: ${onCove[0].type}`);
  ok(onCove[0].closed, 'and CLOSED — a rectangle, not four lines somebody has to join');
  ok(onCove[0].verts.length === 4, `with four corners: ${onCove[0].verts.length}`);
  const xs = new Set(onCove[0].verts.map((v) => v['10'].toFixed(3)));
  const ys = new Set(onCove[0].verts.map((v) => v['20'].toFixed(3)));
  ok(xs.size === 2 && ys.size === 2,
    'axis-aligned: two distinct x and two distinct y, which is a clean rectangle');
  // ...and it is the real 8in x 9ft slot, in the drawing's own units.
  const w = Math.abs([...xs].map(Number)[0] - [...xs].map(Number)[1]);
  const h = Math.abs([...ys].map(Number)[0] - [...ys].map(Number)[1]);
  ok(near(w / MM, 9, 0.02) && near(h / MM, 8 / 12, 0.02),
    `and measures 9 ft by 8 in on the drawing: ${(w / MM).toFixed(2)} x ${(h / MM * 12).toFixed(1)} in`);

  // An ordinary strip is untouched: still an open run on the strips layer.
  const plain = scan(toSuperluminalDXF({ source,
    accents: [{ id: 's', type: 'strip', roomId: 'r1', run, rect }] }));
  const pe = plain.entities.filter((e) => e.layer === 'superluminal_led_strips');
  ok(pe.length === 1 && !pe[0].closed && pe[0].verts.length === 2,
    'while a plain strip is still an open two-point run on the strips layer');
  ok(plain.entities.every((e) => e.layer !== 'superluminal_reverse_coves'),
    'and puts nothing on the cove layer');
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
