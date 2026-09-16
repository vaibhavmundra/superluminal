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
import { SYMBOL_FT, COB_DIA_IN, AIM_FT, SCONCE_FT, FAN_FT } from '../src/lib/settings.js';
import { placeZone } from '../src/lib/accentPlace.js';
/* THE ELECTRICAL DRAWING, THROUGH ITS OWN PASSES. A plate seated by hand, two
   points resolved against the walls and a set of loops planned over a row of
   lights — built the way the app builds them, because a fixture shaped to look
   like what those produce is a fixture that agrees with a misunderstanding. */
import { placedBoards, asOutlet, SB_MM } from '../src/lib/electrical.js';
import { wallPoint, ceilingPoint, projectElecPointsPx, pointHostFor, POINT_FT }
  from '../src/lib/elecPoints.js';
import { planFlows } from '../src/lib/flows.js';
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
      /* SOLID IS IN THE LIST NOW, and it had to be: R12 has no HATCH, so every
         filled mark in the file — a lamp's centre dot, a cove's band, an aim
         arrow's head — is a SOLID, and a scanner blind to them cannot tell an
         arrow from a bare line. That is precisely the bug this file missed. */
      if (['LINE', 'CIRCLE', 'POLYLINE', 'TEXT', 'SOLID'].includes(value)) entities.push(cur);
      continue;
    }
    const target = vertex || cur;
    if (!target) continue;
    if (code === '8') target.layer = value;
    else if (code === '2' && target.type === 'LAYER') target.name = value;
    else if (code === '62') target.colour = Number(value);
    else if (code === '70' && target.type === 'POLYLINE') target.closed = value.trim() === '1';
    else if (['10','20','11','21','12','22','13','23','40'].includes(code)) {
      // A SOLID's third and fourth corners, which no other entity here has.
      target[code] = Number(value);
    }
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
     + 'superluminal_led_strips,superluminal_points,superluminal_reverse_coves,'
     + 'superluminal_rooms,superluminal_spots,superluminal_switchboards,'
     + 'superluminal_track_fixtures,superluminal_tracks,superluminal_wire_chain,'
     + 'superluminal_wire_feed,superluminal_wire_two_way',
    `thirteen layers, declared in a real LAYER table: ${names.join(', ')}`);
  ok(layers.every((l) => l.colour > 0), 'each with a colour');
  /* DISTINCT, WITH ONE DELIBERATE PAIR. The plate and the wire that leaves it
     share a colour on purpose — see SL_COLOUR, which quotes the canvas: "the
     wire and the plate are one object ... it says so by being drawn in the
     board's colour". Asserted as a named exception rather than by loosening the
     rule, so a SECOND collision still fails this. */
  const shared = [SUPERLUMINAL_LAYERS.switchboards, SUPERLUMINAL_LAYERS.wireFeed];
  const spread = layers.filter((l) => l.name !== shared[1]);
  ok(new Set(spread.map((l) => l.colour)).size === spread.length,
    'and a distinct one, so they are told apart on import');
  const pair = layers.filter((l) => shared.includes(l.name));
  ok(pair.length === 2 && pair[0].colour === pair[1].colour,
    `...except the plate and its feed, which are one object: ${pair[0]?.colour}`);
  /* THE LINETYPE TABLE HAS TO HOLD EVERY PATTERN A LAYER NAMES, and it has to
     come FIRST — a CAD that reads a layer before its pattern exists throws the
     reference away silently, and the only symptom is a wire that arrives solid.
     See slHeader, which says this and is what this checks. */
  const lts = [...out.matchAll(/\n0\nLTYPE\n2\n([^\n]+)/g)].map((m) => m[1]);
  ok(['CONTINUOUS', 'DOTTED', 'WIRE', 'WIRECHAIN'].every((n) => lts.includes(n)),
    `every pattern a layer names is defined: ${lts.join(', ')}`);
  ok(out.indexOf('\nLTYPE\n') < out.indexOf('\nLAYER\n'),
    'and the LTYPE table is written before the LAYER table that references it');
  /* --- AND THE WIRES CARRY THEIR OWN COLOUR AND PATTERN ------------------
     WHICH IS WHAT A CAD FILE HAS INSTEAD OF A WEIGHT. R12 has no lineweight at
     all, so the feed/chain hierarchy the canvas draws with colour AND thickness
     has to be carried by the colour and the PATTERN — and both live on the
     LAYER, so a file copied into somebody else's drawing keeps them where a
     per-entity override would be purged. */
  const byName = new Map(layers.map((l) => [l.name, l]));
  const lt = (k) => (out.match(
    new RegExp(`\n0\nLAYER\n2\n${SUPERLUMINAL_LAYERS[k]}\n70\n0\n62\n\\d+\n6\n([^\n]+)`)) || [])[1];
  ok(lt('wireFeed') === 'WIRE' && lt('wireTwoWay') === 'WIRE'
     && lt('wireChain') === 'WIRECHAIN',
    `each wire layer names its pattern: ${lt('wireFeed')}, ${lt('wireChain')}, ${lt('wireTwoWay')}`);
  ok(lt('switchboards') === 'CONTINUOUS' && lt('points') === 'CONTINUOUS',
    'while a plate and a point are solid — they are objects, not runs');
  const wireCols = ['wireFeed', 'wireChain', 'wireTwoWay']
    .map((k) => byName.get(SUPERLUMINAL_LAYERS[k])?.colour);
  ok(new Set(wireCols).size === 3,
    `and the three kinds of wire are three colours: ${wireCols.join(', ')}`);

  // THE ASSERTION THIS FILE EXISTS FOR.
  const circle = entities.find((e) => e.type === 'CIRCLE' && e.layer === SUPERLUMINAL_LAYERS.spots);
  ok(!!circle, 'an ambient downlight is on the spots layer');
  ok(near(circle['10'], du.x, 0.01) && near(circle['20'], du.y, 0.01),
    `and at the drawing's own coordinate: ${circle['10'].toFixed(1)},${circle['20'].toFixed(1)}`
    + ` vs ${du.x.toFixed(1)},${du.y.toFixed(1)}`);
  // ...and it is not accidentally right because everything is near the origin.
  ok(Math.abs(du.x) > 1000, 'with an origin far enough out that 0,0 would fail this');

  /* Radius in the DRAWING's units: feet of millimetres, not feet. Read off the
     shared table rather than written out, because that table is the PDF's too —
     a literal here is how the two exporters came to disagree about a fitting's
     size in the first place. See SYMBOL_FT in settings.js. */
  ok(near(circle['40'], SYMBOL_FT.small * MM, 0.01),
    `the symbol is real-size in mm: ${circle['40'].toFixed(1)}`);
  // ...AND IT IS THE FOUR INCH FITTING IT STANDS FOR. Diameter, in inches, off
  // the file itself — the one number somebody scales off the drawing.
  ok(near((circle['40'] / MM) * 24, COB_DIA_IN, 0.01),
    `and the trim measures ${((circle['40'] / MM) * 24).toFixed(1)} in across`);

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
  /* --- A RASTER PLAN IS NO LONGER REFUSED, AND THIS TEST HAD NOT HEARD -----
     IT ASSERTED AN ERROR THE EXPORTER DELIBERATELY STOPPED THROWING. The check
     wanted /original DXF/ — the old refusal on an imported image — and
     `toSuperluminalDXF` says outright why that went: "This used to throw on an
     image, which is why there was a second exporter and why the second exporter
     was the one most people actually got." An image now gets a sheet of its own
     in feet instead. So the case was red on a behaviour change nobody had
     reverted, and because `npm test` is one `&&` chain it took every script
     AFTER this one with it — about twenty of them, including the PDF export's,
     never ran at all.
     WHAT IS ACTUALLY REFUSED IS A DRAWING WITH NO SCALE, whatever kind of file
     it came from: without px/ft there is no way to turn plan pixels into feet,
     and a DXF at the wrong scale is a lighting layer in the next flat along.
     That is the property worth holding, so it is the one asserted. */
  let noScale = null;
  try { toSuperluminalDXF({ source: { kind: 'raster' }, rooms: [] }); }
  catch (e) { noScale = e.message; }
  ok(/plan scale/.test(noScale ?? ''),
    `a plan with no scale is refused with a reason: "${noScale}"`);
  // ...AND AN IMAGE WITH A SCALE IS SERVED, on a sheet of its own in feet.
  let sheet = null, itThrew = null;
  try { sheet = toSuperluminalDXF({ source: { kind: 'raster', w: 600, h: 400 },
                                    pxPerFt: 30, heightPx: 400, rooms: [] }); }
  catch (e) { itThrew = e.message; }
  ok(!itThrew && typeof sheet === 'string' && sheet.length > 0,
    `and a raster plan WITH a scale gets a sheet of its own${itThrew ? `: ${itThrew}` : ''}`);
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
  /* TWO ENTITIES, AND IT ALWAYS WAS TWO. This asserted one, and passed, because
     the scanner above could not see a SOLID — so the fill that makes the band
     read as an area rather than as four thin lines was invisible to the test
     that is supposed to be asserting what the FILE says. Teaching the reader
     about SOLIDs is what surfaced it. The exporter states the pair outright: the
     fill to be seen, the closed polyline to be measured, because a SOLID has
     vertices but no edges and the lip of the slot is what gets set out. */
  ok(onCove.length === 2, `the slot is a fill and an outline: ${onCove.length}`);
  ok(onStrip.length === 0, 'and nothing on the strips layer — the tape is not drawn twice');
  ok(onCove.some((e) => e.type === 'SOLID'),
    'filled, because eight inches of ceiling is an area and not a line');
  const lip = onCove.find((e) => e.type === 'POLYLINE');
  ok(!!lip, `with an outline on top of it: ${onCove.map((e) => e.type).join(' + ')}`);
  ok(lip.closed, 'and CLOSED — a rectangle, not four lines somebody has to join');
  ok(lip.verts.length === 4, `with four corners: ${lip.verts.length}`);
  const xs = new Set(lip.verts.map((v) => v['10'].toFixed(3)));
  const ys = new Set(lip.verts.map((v) => v['20'].toFixed(3)));
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

console.log('\n-- a track is two layers: the carrier, and what clips into it --');
{
  // A three-foot run of profile with one ambient head on it and one aimed head
  // turned 90 degrees, plus a recessed downlight elsewhere in the same room.
  const a = source.fromDu({ x: OX + MM, y: OY + 2 * MM });
  const b = source.fromDu({ x: OX + 4 * MM, y: OY + 2 * MM });
  const headAt = source.fromDu({ x: OX + 2 * MM, y: OY + 2 * MM });
  const spotAt = source.fromDu({ x: OX + 3 * MM, y: OY + 2 * MM });
  const out = toSuperluminalDXF({
    source,
    rooms: [{ name: 'R', plan: {
      polygonPx: [],
      tracksPx: [{ key: 'k', closed: false, runs: [{ a, b, side: 'top', axis: 'h' }] }],
      lightsPx: [{ id: 'T1', kind: 'small', ...headAt, track: 'k', trackAxis: 'h' },
                 { id: 'S1', kind: 'small', ...px }],
    } }],
    spots: [{ id: 'sp1', ...spotAt, track: 'k', angle: Math.PI / 2,
              target: source.fromDu({ x: OX + 3 * MM, y: OY }) }],
  });
  const { entities } = scan(out);
  const on = (layer) => entities.filter((e) => e.layer === layer);
  const LY = SUPERLUMINAL_LAYERS;

  const carrier = on(LY.tracks);
  ok(carrier.length === 1 && carrier[0].type === 'POLYLINE' && !carrier[0].closed,
    'the profile is one open polyline on the track layer');

  // THE ASSERTION THIS BLOCK EXISTS FOR: the heads are NOT on the recessed
  // schedule. A module clipped into a profile is not cut into the ceiling.
  const recessed = on(LY.spots);
  ok(recessed.some((e) => e.type === 'CIRCLE'),
    'the plain downlight is still a ring on the spots layer');
  ok(recessed.filter((e) => e.type === 'CIRCLE').length === 1,
    '...and it is the ONLY ring there — neither track head joined it');
  ok(recessed.every((e) => e.type !== 'POLYLINE'),
    'and nothing rectangular landed on the recessed layer either');

  const heads = on(LY.trackFixtures).filter((e) => e.type === 'POLYLINE');
  ok(heads.length === 2, `both heads are on the track-fixtures layer: ${heads.length}`);
  ok(heads.every((e) => e.closed && e.verts.length === 4),
    '...each as a closed four-point body, not a ring');

  /** A polyline's two edge lengths, in feet. */
  const sides = (e) => {
    const d = (i, j) => Math.hypot(e.verts[j]['10'] - e.verts[i]['10'],
                                   e.verts[j]['20'] - e.verts[i]['20']) / MM;
    return [d(0, 1), d(1, 2)];
  };
  // The ambient head: 12 in along its run, 1.5 in across it. Horizontal run, so
  // the long edge lies in x.
  const amb = heads.find((e) => near(sides(e)[0], 1, 0.02));
  ok(!!amb, 'the ambient head measures 12 in along the run');
  ok(amb && near(sides(amb)[1], 1.5 / 12, 0.02),
    `and 1.5 in across it: ${amb ? (sides(amb)[1] * 12).toFixed(2) : '?'} in`);
  const ax = amb.verts.map((v) => v['10']), ay = amb.verts.map((v) => v['20']);
  ok(near(Math.max(...ax) - Math.min(...ax), 1 * MM, 1)
     && near(Math.max(...ay) - Math.min(...ay), (1.5 / 12) * MM, 1),
    'lying ALONG the horizontal run, not across it — the axis survived the export');

  // The aimed head: 6 in long, and TURNED. Aimed at drawing-Y-down, so its long
  // edge lies in y — which is the rotation a ring would have thrown away.
  const dir = heads.find((e) => near(sides(e)[0], 0.5, 0.02));
  ok(!!dir, 'the directional head measures 6 in long');
  const dx = dir.verts.map((v) => v['10']), dy = dir.verts.map((v) => v['20']);
  ok(near(Math.max(...dy) - Math.min(...dy), 0.5 * MM, 1)
     && near(Math.max(...dx) - Math.min(...dx), (1.5 / 12) * MM, 1),
    'and is turned to its aim — the one fitting whose rotation is a specification');

  // The aim arrow follows the fitting onto its own layer, so switching the
  // recessed schedule off does not strip the track heads of what they point at.
  ok(on(LY.trackFixtures).some((e) => e.type === 'LINE'),
    'the aim arrow is on the track layer with the head it belongs to');
}

console.log('\n-- the fittings a hand put down reach the file too --');
{
  /* THREE POPULATIONS HAD NO PARAMETER AT ALL, which is the same gap the PDF
     had: this function took the engine's layout and nothing for the magnetic
     track somebody DRAWS or the modules they clip onto it. `plan.tracksPx` is
     the absorbing track — what the ceiling design made of a chunk — and a
     profile a person drew is a different object with a different lifetime.
     ...AND A COVE'S POCKET, which is the ceiling contractor's line: only the
     tape was exported, so a coved ceiling imported as a dotted rectangle with
     nothing to say what builds it. */
  const a = source.fromDu({ x: OX + MM, y: OY + 5 * MM });
  const b = source.fromDu({ x: OX + 5 * MM, y: OY + 5 * MM });
  const difAt = source.fromDu({ x: OX + 2 * MM, y: OY + 5 * MM });
  const sptAt = source.fromDu({ x: OX + 4 * MM, y: OY + 5 * MM });
  const cove = [{ x: OX + 6 * MM, y: OY + 6 * MM }, { x: OX + 10 * MM, y: OY + 6 * MM },
                { x: OX + 10 * MM, y: OY + 9 * MM }, { x: OX + 6 * MM, y: OY + 9 * MM }]
    .map(source.fromDu);
  const out = toSuperluminalDXF({
    source,
    rooms: [{ name: 'R', plan: { polygonPx: [], covesPx: [{ key: 'cv', line: cove }] } }],
    tracks: [{ id: 'mt1', closed: false, pts: [a, b] }],
    trackModules: [
      { id: 'm1', ...difAt, kind: 'diffuser', lenIn: 24, wideIn: 1.5, ux: 1, uy: 0 },
      { id: 'm2', ...sptAt, kind: 'spot', lenIn: 6, wideIn: 1.5, ux: 1, uy: 0 },
    ],
  });
  const { entities } = scan(out);
  const LY = SUPERLUMINAL_LAYERS;
  const on = (layer, type) => entities.filter(
    (e) => e.layer === layer && (!type || e.type === type));

  // THE CARRIER, on the layer an electrician marks on the slab first.
  const rail = on(LY.tracks, 'POLYLINE');
  ok(rail.length === 1 && !rail[0].closed,
    `the drawn profile is one open polyline on the track layer: ${rail.length}`);
  ok(rail[0].verts.length === 2, `with its two clicked ends: ${rail[0]?.verts.length}`);
  ok(near(rail[0].verts[0]['10'], OX + MM, 0.01),
    'landing on the drawing’s own coordinates');

  // A DIFFUSER IS A BODY AND AN AIMED HEAD IS A RING — two fittings, two marks.
  const bodies = on(LY.trackFixtures, 'POLYLINE');
  ok(bodies.length === 1 && bodies[0].closed,
    `the diffuser is a closed four-point body: ${bodies.length}`);
  ok(bodies[0].verts.length === 4, `with four corners: ${bodies[0]?.verts.length}`);
  // 24 in along the run, which is 2 ft of millimetres.
  const xs = bodies[0].verts.map((v) => v['10']);
  ok(near(Math.max(...xs) - Math.min(...xs), 2 * MM, 0.01),
    `measuring 24 in along the rail: ${((Math.max(...xs) - Math.min(...xs)) / MM * 12).toFixed(1)} in`);
  const rings = on(LY.trackFixtures, 'CIRCLE');
  ok(rings.length >= 1, `and the track spot is a ring: ${rings.length}`);
  ok(near(rings[0]['40'], SYMBOL_FT.cob * MM, 0.01),
    'at the same trim as a recessed COB — it is the same fitting without the ceiling');

  // THE COVE'S POCKET, on the ceiling contractor's layer and closed.
  const pocket = on(LY.reverseCoves, 'POLYLINE');
  ok(pocket.length === 1 && pocket[0].closed,
    `a cove's setting-out line is a closed polyline on the cove layer: ${pocket.length}`);
  ok(pocket[0].verts.length === 4, `with its four corners: ${pocket[0]?.verts.length}`);
}

console.log('\n-- the lamps a hand placed are IN the file --');
{
  /* THEY WERE NOT, AND THE CASE IS THE ONE THIS APP RECOMMENDS. `plan.lightsPx`
     is the ENGINE'S layout; a hand-placed COB is deliberately not in it (see
     lib/cob.js), and this exporter had no parameter for the list that is. So a
     ceiling laid out by hand exported as a room outline with nothing inside it,
     while the PDF of the same plan was full of fittings. */
  const S = SUPERLUMINAL_LAYERS;
  const at = (dx, dy) => source.fromDu({ x: OX + dx * MM, y: OY + dy * MM });
  const { entities } = scan(toSuperluminalDXF({
    source,
    rooms: [{ name: 'R', plan: { polygonPx: [], lightsPx: [] } }],
    cobs: [{ id: 'c1', ...at(2, 2), watts: 7, beam: 36 },
           { id: 'c2', ...at(4, 2), watts: 7, beam: 36 },
           // A DRAFT IS NOT A FITTING: the array bar's preview rides in the same
           // list, and a file that carried it would bill a run nobody kept.
           { id: 'c3', ...at(6, 2), draft: true },
           // ...and neither is a record with no position, which is what a store
           // handed in instead of a projection looks like from here.
           { id: 'c4', xFt: 3, yFt: 3 }],
  }));
  const rings = entities.filter((e) => e.type === 'CIRCLE' && e.layer === S.spots);
  ok(rings.length === 2, `two placed lamps reach the spots layer: ${rings.length}`);
  ok(rings.every((r) => near(r['40'], SYMBOL_FT.cob * MM, 0.01)),
    'each at a recessed COB\'s own trim — it is the same fitting the engine places');
  const want = at(2, 2);
  const du = source.toDu(want);
  ok(rings.some((r) => near(r['10'], du.x, 0.01) && near(r['20'], du.y, 0.01)),
    'landing on the drawing\'s own coordinates');
  // The filled centre dot goes with them: the ring is the trim, the dot is the lamp.
  ok(entities.some((e) => e.type === 'SOLID' && e.layer === S.spots),
    'and each carries the filled dot every fitting on this sheet has');
  ok(entities.filter((e) => e.type === 'CIRCLE' && e.layer === S.spots).length === 2,
    'the draft and the position-less record are both left out');
}

console.log('\n-- an aim tail is an ARROW, not a line --');
{
  /* IT WENT OUT AS A BARE SHAFT. A line with nothing on the end of it is a
     leader, a wire or a setting-out line — so the one fitting whose ROTATION is
     part of its specification said nothing about which way it points, and a spot
     aimed at a wall and one aimed away from it were the same mark. The plotted
     sheet has drawn a filled head from the beginning; this is that head. */
  const S = SUPERLUMINAL_LAYERS;
  const at = source.fromDu({ x: OX + 5 * MM, y: OY + 5 * MM });
  const { entities } = scan(toSuperluminalDXF({
    source,
    spots: [{ id: 'sp', ...at, angle: 0,
              target: source.fromDu({ x: OX + 9 * MM, y: OY + 5 * MM }) }],
  }));
  const c = source.toDu(at);
  const solids = entities.filter((e) => e.type === 'SOLID' && e.layer === S.spots);
  /* THE HEAD IS THE ONE DEGENERATE SOLID THAT IS NOT PART OF THE CENTRE DOT.
     A dot is a fan of sixteen triangles about the fitting's own centre, so every
     one of them has a vertex ON the fitting; the arrowhead is a foot away. */
  const head = solids.filter((e) => Math.hypot(e['10'] - c.x, e['20'] - c.y) > MM * 0.5);
  ok(head.length === 1, `one filled head on the tail: ${head.length}`);
  const h = head[0];
  ok(h['13'] === h['12'] && h['23'] === h['22'],
    'drawn as a triangle — the degenerate SOLID, fourth vertex repeating the third');
  // The tip is at the tail's far end, a fixed reach from the fitting.
  ok(near(Math.hypot(h['10'] - c.x, h['20'] - c.y), AIM_FT.reach * MM, 1),
    `its tip is ${AIM_FT.reach} ft out, where the shaft ends: `
    + `${(Math.hypot(h['10'] - c.x, h['20'] - c.y) / MM).toFixed(2)} ft`);
  // ...and it points the way the fitting is aimed: along +x in the drawing.
  ok(h['10'] > h['11'] && h['10'] > h['12'],
    'and it POINTS — the tip is ahead of both base corners, along the aim');
  const wantLen = AIM_FT.start * AIM_FT.headFrac;
  const len = Math.hypot(h['10'] - (h['11'] + h['12']) / 2,
                         h['20'] - (h['21'] + h['22']) / 2) / MM;
  const wide = Math.hypot(h['11'] - h['12'], h['21'] - h['22']) / MM;
  ok(near(len, wantLen, 0.01) && near(wide, wantLen * AIM_FT.headWideFrac * 2, 0.01),
    `at the plotted sheet's own size: ${len.toFixed(3)} x ${wide.toFixed(3)} ft`);
  // The shaft is still there, and still stops clear of the body.
  const shaft = entities.filter((e) => e.type === 'LINE' && e.layer === S.spots);
  ok(shaft.length === 1, `one shaft under it: ${shaft.length}`);
  ok(near(Math.hypot(shaft[0]['10'] - c.x, shaft[0]['20'] - c.y), AIM_FT.start * MM, 1),
    'starting clear of the fitting rather than inside it');
}

console.log('\n-- a fan is three blades at its own sweep, not a plus --');
{
  /* FOUR ARMS AT NINETY DEGREES INSIDE A CIRCLE IS A CENTRE MARK — what a
     setting-out drawing puts on a hole to be cored — so a ceiling of fans read
     as coring information. And it was drawn at a flat 0.3 ft whatever the fan
     was, so a 1200mm fan and a 900mm one came out identical inside two different
     circles. Three spokes at 120, at the fan's own sweep, is what the canvas
     draws and what the object is. */
  const S = SUPERLUMINAL_LAYERS;
  const sweepFt = 2;                                   // a 4 ft fan
  const at = source.fromDu({ x: OX + 7 * MM, y: OY + 7 * MM });
  const { entities } = scan(toSuperluminalDXF({
    source,
    objects: [{ kind: 'fan', ...at, r: sweepFt * source.pxPerFt, source: 'placed' },
              // ...and a geyser, which is round too and keeps its crosshair:
              // nothing about it has three of anything.
              { kind: 'geyser', ...source.fromDu({ x: OX + 11 * MM, y: OY + 7 * MM }),
                r: 0.75 * source.pxPerFt, offCeiling: true, source: 'placed' }],
  }));
  const c = source.toDu(at);
  const spokes = entities.filter((e) => e.type === 'LINE' && e.layer === S.objects
    && near(e['10'], c.x, 0.01) && near(e['20'], c.y, 0.01));
  ok(spokes.length === FAN_FT.spokes,
    `three spokes, all from the fan's centre: ${spokes.length}`);
  const lens = spokes.map((e) => Math.hypot(e['11'] - e['10'], e['21'] - e['20']) / MM);
  ok(lens.every((l) => near(l, sweepFt * FAN_FT.spoke, 0.01)),
    `each the length of the blade it stands for: ${lens.map((l) => l.toFixed(2)).join(', ')} ft`);
  // 120 DEGREES APART, measured in the FILE — which is also the check that the
  // three directions survived the Y flip as a set rather than being mirrored
  // into a shape that is no longer even.
  const deg = spokes
    .map((e) => (Math.atan2(e['21'] - e['20'], e['11'] - e['10']) * 180) / Math.PI)
    .sort((a, b) => a - b);
  const gaps = [deg[1] - deg[0], deg[2] - deg[1], 360 - (deg[2] - deg[0])];
  ok(gaps.every((g) => near(g, 120, 0.01)),
    `120 degrees apart: ${gaps.map((g) => g.toFixed(1)).join(', ')}`);
  // The sweep circle stays: it is the dimension anybody scales off the drawing.
  const ring = entities.filter((e) => e.type === 'CIRCLE' && e.layer === S.objects
    && near(e['10'], c.x, 0.01));
  ok(ring.length === 1 && near(ring[0]['40'] / MM, sweepFt, 0.01),
    `inside a sweep circle at the fan's real radius: ${(ring[0]['40'] / MM).toFixed(2)} ft`);
  // A fan is not a lamp: nothing on this layer gets the filled mark.
  ok(entities.every((e) => e.type !== 'SOLID' || e.layer !== S.objects),
    'and nothing on the layer is filled — a ceiling object does not emit');
  /* THE GEYSER IS A TANK IN ITS CASING WITH A PIPE OFF IT, and it used to be the
     generic round mark — a circle with a crosshair, which is a fan with its
     blades missing. Two concentric rings and one stub, which is what the canvas
     draws and what says this is plumbing rather than a light. */
  const g = source.toDu(source.fromDu({ x: OX + 11 * MM, y: OY + 7 * MM }));
  const rings = entities.filter((e) => e.type === 'CIRCLE' && e.layer === S.objects
    && near(e['10'], g.x, 0.01)).map((e) => e['40'] / MM).sort((a, b) => b - a);
  ok(rings.length === 2 && near(rings[0], 0.75, 0.01) && near(rings[1], 0.375, 0.01),
    `the casing at its real radius and the tank inside it: ${rings.map((r) => r.toFixed(3)).join(', ')} ft`);
  const stub = entities.filter((e) => e.type === 'LINE' && e.layer === S.objects
    && near(e['10'], g.x, 0.01) && near(e['11'], g.x, 0.01));
  ok(stub.length === 1, `and one stub for the pipework, not a crosshair: ${stub.length}`);
  // AND IT LEAVES THE CASING RATHER THAN CROSSING IT: both ends outside the tank,
  // the far one outside the casing. The canvas draws 0.92R to 1.35R.
  const ends = stub[0] ? [Math.abs(stub[0]['21'] - g.y), Math.abs(stub[0]['20'] - g.y)]
    .map((d) => d / MM).sort((a, b) => a - b) : [];
  ok(ends.length === 2 && near(ends[0], 0.75, 0.02) && near(ends[1], 0.75 * 1.35, 0.02),
    `running out of the casing, not through it: ${ends.map((d) => d.toFixed(2)).join(' to ')} ft`);
}

console.log('\n-- a sconce is a crosshair STANDING OFF its wall --');
{
  /* IT WAS A RING AT THE WALL POINT, AND BOTH HALVES WERE WRONG. A circle on
     these drawings is a hole in a ceiling; a sconce is fixed to a vertical
     surface and hangs in the room. Drawn at the mounting point it landed exactly
     on the room outline, so what arrived in CAD was a circle sitting astride a
     wall line — which reads as a core through the wall.
     PLACED THROUGH `placeZone`, the same function the app itself uses, so this
     asserts what a real sconce exports as and not what a hand-built fixture
     does. It is also what supplies `inward`, which is the whole of the fix. */
  const S = SUPERLUMINAL_LAYERS;
  const poly = [{ x: OX, y: OY }, { x: OX + w, y: OY },
                { x: OX + w, y: OY + h }, { x: OX, y: OY + h }].map(source.fromDu);
  const mid = source.fromDu({ x: OX + w / 2, y: OY });   // on the bottom wall, in DU
  const seed = { id: 'man-1', type: 'sconce', roomId: 'r', source: 'placed',
                 rect: { x0: mid.x - 10, y0: mid.y - 7, x1: mid.x + 10, y1: mid.y + 7 } };
  const sc = placeZone(seed, poly);
  ok(!sc.rejected && !!sc.inward, `the fixture places on a wall: ${sc.rejected ?? 'ok'}`);

  const { entities } = scan(toSuperluminalDXF({ source, accents: [sc] }));
  const on = (t) => entities.filter((e) => e.layer === S.decorative && e.type === t);
  const foot = source.toDu(sc.point);

  const ring = on('CIRCLE');
  ok(ring.length === 1, `one ring: ${ring.length}`);
  ok(near(ring[0]['40'] / MM, SCONCE_FT.r, 0.001),
    `at the radius the canvas draws: ${(ring[0]['40'] / MM).toFixed(3)} ft`);
  // THE ASSERTION THIS BLOCK EXISTS FOR: the body is NOT on the wall.
  const off = Math.hypot(ring[0]['10'] - foot.x, ring[0]['20'] - foot.y) / MM;
  ok(near(off, SCONCE_FT.r * SCONCE_FT.stand, 0.001),
    `standing off the wall by ${off.toFixed(2)} ft rather than sitting on it`);
  // ...and it stands off INTO THE ROOM. The inward normal is a direction, and a
  // direction carried across the Y flip as a number comes out mirrored — which
  // would put every sconce on this sheet in next door.
  const inside = (p) => {
    const xs = [OX, OX + w], ys = [OY, OY + h];
    return p.x > xs[0] && p.x < xs[1] && p.y > ys[0] && p.y < ys[1];
  };
  ok(inside({ x: ring[0]['10'], y: ring[0]['20'] }),
    'on the room side of the wall and not in the one next door');

  const lines = on('LINE');
  ok(lines.length === 2, `a stem and a cross bar: ${lines.length}`);
  // THE STEM TOUCHES THE WALL — which is what keeps the mounting point, the
  // thing that actually gets set out on site, in the file.
  const stem = lines.find((e) => near(e['10'], foot.x, 0.01) && near(e['20'], foot.y, 0.01));
  ok(!!stem, 'the stem starts at the mounting point on the wall');
  ok(near(Math.hypot(stem['11'] - foot.x, stem['21'] - foot.y) / MM,
          SCONCE_FT.r * (SCONCE_FT.stand + SCONCE_FT.arm), 0.001),
    'and runs through the ring and out the far side, exactly as on screen');
  // THE BAR LIES ALONG THE WALL, which is what turns with the surface and is the
  // half of the symbol that says which way the fitting faces.
  const bar = lines.find((e) => e !== stem);
  const barLen = Math.hypot(bar['11'] - bar['10'], bar['21'] - bar['20']) / MM;
  ok(near(barLen, 2 * SCONCE_FT.r * SCONCE_FT.arm, 0.001),
    `the bar is two arms long: ${barLen.toFixed(2)} ft`);
  const wallDir = { x: 1, y: 0 };                    // the bottom wall runs in x
  const barDir = { x: bar['11'] - bar['10'], y: bar['21'] - bar['20'] };
  const bl = Math.hypot(barDir.x, barDir.y) || 1;
  ok(near(Math.abs((barDir.x * wallDir.x + barDir.y * wallDir.y) / bl), 1, 1e-6),
    'and lies ALONG the wall it is fixed to');
  // A ring is still the fallback for a fitting with no wall behind it — a plan
  // saved before the placer stored one. Missing from the file is worse.
  const bare = scan(toSuperluminalDXF({ source,
    accents: [{ id: 'old', type: 'sconce', point: sc.point }] }));
  const bareOn = bare.entities.filter((e) => e.layer === S.decorative);
  ok(bareOn.some((e) => e.type === 'CIRCLE') && !bareOn.some((e) => e.type === 'LINE'),
    'a sconce with no wall stored falls back to the ring rather than vanishing');
}

// ---------------------------------------------------------------------------
// THE ELECTRICAL DRAWING, WHICH REACHED NEITHER EXPORT.
//
// Every plate, every socket outlet, every wall and ceiling point, every
// air-conditioner's supply and lead and every switched loop lived only on
// screen: `toSuperluminalDXF` had no parameter for any of them. A plan whose
// second half is a wiring layout exported as a lighting drawing with the wiring
// silently gone — the same class of failure the three missing lamp populations
// were, one domain over.
//
// BUILT THROUGH THE REAL PASSES AND NOT BY HAND. `placedBoards` seats the plate,
// `projectElecPointsPx` resolves the points, `planFlows` builds the loops: a
// fixture shaped here to look like what those produce is a fixture that agrees
// with a misunderstanding rather than with the app.
// ---------------------------------------------------------------------------

console.log('\n-- the plates, the points and the wires reach the file --');
{
  const S = SUPERLUMINAL_LAYERS;
  const pf = source.pxPerFt;
  const poly = [{ x: OX, y: OY }, { x: OX + w, y: OY },
                { x: OX + w, y: OY + h }, { x: OX, y: OY + h }].map(source.fromDu);

  // A PLATE SOMEBODY DROPPED, and the same plate CONVERTED to a socket outlet.
  // The two are one rectangle on one layer, because a socket outlet IS a plate
  // — a board with an outlet on it and no switch — and the canvas draws them
  // identically. What tells them apart is the schedule.
  const [plate] = placedBoards([{ id: 'b1', roomId: 'r1', sFt: 6 }],
                               { polygonPx: poly, pxPerFt: pf });
  ok(!!plate, 'the plate seats on a wall through the real placement pass');

  // A WALL POINT AND A CEILING POINT, resolved the way the canvas resolves them.
  const host = pointHostFor(poly, pf);
  const pts = projectElecPointsPx(
    [wallPoint('r1', 0.3, { id: 'ep1' }), ceilingPoint('r1', 7, 5, { id: 'ep2' })],
    () => host, pf);
  ok(pts.length === 2 && !!pts[0].foot && !pts[1].foot,
    'a wall point carries a foot on the plaster and a ceiling point does not');

  // A LOOP, WITH A CHAIN IN IT AND A SECOND PLATE ON IT. Two plates, so the
  // two-way has somewhere else to be: `relink` refuses a second feed that names
  // the plate the loop already runs off, correctly.
  const both = placedBoards([{ id: 'b1', roomId: 'r1', sFt: 6 },
                             { id: 'b2', roomId: 'r1', sFt: 20 }],
                            { polygonPx: poly, pxPerFt: pf });
  /* THE LIGHTS CARRY THE CELL THEY STAND IN, because that is how a row is
     found: `chunkOf` and `crossOf` read a downlight's own `cell`, not its
     coordinates. Four lamps sharing a `j` is one row, which is what the planner
     hands over and what the loop is a loop of. */
  const lights = [0, 1, 2, 3].map((i) => ({ id: `L${i}`, kind: 'small',
    cell: { chunk: 'c0', i, j: 0 },
    ...source.fromDu({ x: OX + (3 + i * 2) * MM, y: OY + 6 * MM }) }));
  const scene = {
    room: { id: 'r1', polygonPx: poly },
    bays: [{ key: 'room', rect: { x0: poly[0].x, y0: poly[0].y,
                                  x1: poly[2].x, y1: poly[2].y } }],
    /* ONE CHUNK OVER THE ROW, because a row is a fact about a CHUNK — see
       `rowsOf`, which groups a chunk's own lights by their cross index. Handed
       an empty cut, every light is a light in no chunk and no loop runs. */
    chunks: [{ id: 'c0', x0: poly[0].x, y0: poly[0].y, x1: poly[2].x, y1: poly[2].y,
               xLines: [], yLines: [] }],
    cells: [], lights, lamps: [], objects: [], accents: [], spots: [],
    tracks: [], boards: both, handPlates: [], outlets: [], elecPoints: [],
    boardPool: both, owner: new Map(), zones: [], pxPerFt: pf,
  };
  const dry = planFlows(scene).flows;
  const loop = dry.find((f) => f.count > 1) ?? dry[0];
  const other = both.find((b) => b.id !== loop.boardId);
  const flows = planFlows({ ...scene, twoWay: { [loop.id]: other.id } }).flows;
  const two = flows.find((f) => f.also);
  ok(!!two, 'a flow two-wayed onto the other plate carries a second feed');

  const { entities } = scan(toSuperluminalDXF({
    source, switchboards: [asOutlet(both[0], 6), both[1]], elecPoints: pts, flows,
  }));
  const on = (layer, type) => entities.filter((e) => e.layer === layer
    && (!type || e.type === type));

  // --- the plate --------------------------------------------------------
  const plates = on(S.switchboards, 'POLYLINE');
  ok(plates.length === 2 && plates.every((e) => e.verts.length === 4 && e.closed),
    `both plates are closed four-point polygons: ${plates.length}`);
  ok(on(S.switchboards, 'SOLID').length === 2,
    'and each is FILLED — a plate is a solid, not a symbol outlined');
  // 230 x 80 mm, THE PLATE'S REAL SIZE, measured in the file. This is the one
  // that catches an export that draws the right shape at the wrong scale.
  const edge = (e, i, j) => Math.hypot(e.verts[j]['10'] - e.verts[i]['10'],
                                       e.verts[j]['20'] - e.verts[i]['20']);
  ok(near(edge(plates[0], 0, 1), SB_MM.along, 0.5)
     && near(edge(plates[0], 1, 2), SB_MM.deep, 0.5),
    `at 230 x 80 mm: ${edge(plates[0], 0, 1).toFixed(0)} x ${edge(plates[0], 1, 2).toFixed(0)} mm`);
  // AND A SOCKET OUTLET IS THE SAME RECTANGLE. `asOutlet` converted the first
  // one; if the exporter had filtered on `socketOnly` there would be one plate.
  ok(plates.length === on(S.switchboards, 'SOLID').length,
    'a converted plate is on the drawing like any other — a socket is a plate');

  // --- the points -------------------------------------------------------
  ok(on(S.points, 'CIRCLE').length === 2, 'both points are a circle on the points layer');
  ok(on(S.points, 'CIRCLE').every((e) => near(e['40'] / MM, POINT_FT.r, 1e-3)),
    `at the sconce's own radius: ${(on(S.points, 'CIRCLE')[0]['40'] / MM).toFixed(3)} ft`);
  ok(on(S.points, 'POLYLINE').length === 2
     && on(S.points, 'POLYLINE').every((e) => !e.closed && e.verts.length > 3),
    'each with an OPEN J in it — a closed one floods to a blob');
  // ONE STEM, NOT TWO. A ceiling point has no plaster to stand off, so a leader
  // drawn to the nearest wall would claim something the plan does not say.
  ok(on(S.points, 'LINE').length === 1,
    `the wall point has a stem and the ceiling point does not: ${on(S.points, 'LINE').length}`);

  // --- the wires --------------------------------------------------------
  const feeds = on(S.wireFeed, 'POLYLINE');
  const chain = on(S.wireChain, 'POLYLINE');
  const twos = on(S.wireTwoWay, 'POLYLINE');
  ok(feeds.length === flows.length,
    `one feed leg per loop, on its own layer: ${feeds.length} of ${flows.length}`);
  ok(chain.length > 0, `and the chain between fittings on another: ${chain.length}`);
  ok(twos.length === 1, `and the second feed of the two-way on a third: ${twos.length}`);
  // BOWED, WHICH IS THE WHOLE REASON THE GEOMETRY IS ARCS. A straight line
  // between two downlights is a setting-out line, a grid line or a wall — this
  // drawing has all three — and a flattener that dropped the curve would put the
  // wire back among them.
  const sag = (e) => {
    const a = e.verts[0], b = e.verts[e.verts.length - 1];
    const L = Math.hypot(b['10'] - a['10'], b['20'] - a['20']) || 1;
    return Math.max(...e.verts.map((v) =>
      Math.abs((b['10'] - a['10']) * (a['20'] - v['20'])
             - (a['10'] - v['10']) * (b['20'] - a['20'])) / L));
  };
  ok(feeds.every((e) => e.verts.length > 2) && sag(feeds[0]) > 1,
    `a wire arrives bowed and not as a straight run: ${(sag(feeds[0]) / MM).toFixed(2)} ft off the chord`);
  // THE TICK IS SOLID ON A DASHED LAYER, and it has to be: it is shorter than
  // the pattern the layer carries, so without the override it lands in a gap as
  // often as not and is simply not in the drawing.
  const ticks = [...scan(toSuperluminalDXF({ source, flows })).entities]
    .filter((e) => e.type === 'LINE' && e.layer === S.wireFeed);
  ok(ticks.length === flows.length, `one feed tick per loop: ${ticks.length}`);
  const raw = toSuperluminalDXF({ source, flows });
  ok(new RegExp(`0\nLINE\n8\n${S.wireFeed}\n6\nCONTINUOUS\n`).test(raw),
    'and it overrides its layer to CONTINUOUS so it cannot fall in a gap');

  // --- the lead from a wall unit to its socket ---------------------------
  //
  // AN AIR-CONDITIONER IS PLUGGED IN. Without the flex the unit and the socket a
  // foot away are two marks that happen to be near each other.
  const seatPt = { x: poly[0].x + 5 * source.pxPerFt, y: poly[0].y };
  const unit = { id: 'ac1', kind: 'split_ac', x: seatPt.x, y: seatPt.y + 8,
                 w: 3 * pf, h: 0.8 * pf, rot: 0, r: 1, onWall: true, source: 'placed',
                 seat: { point: seatPt, along: { x: 1, y: 0 }, inward: { x: 0, y: 1 } } };
  const acPlate = { ...both[1], acId: 'ac1' };
  const withLead = scan(toSuperluminalDXF({
    source, objects: [unit], switchboards: [acPlate] }));
  const leads = withLead.entities.filter((e) => e.type === 'LINE' && e.layer === S.wireFeed);
  ok(leads.length === 1, `the lead reaches the file as one line: ${leads.length}`);
  // A POINT FEED HAS NO LEAD, and that is not an omission: a point is centred
  // behind the body, so the line would run from the unit to itself.
  const noLead = scan(toSuperluminalDXF({
    source, objects: [{ ...unit, feed: 'point' }], switchboards: [acPlate] }));
  ok(!noLead.entities.some((e) => e.layer === S.wireFeed),
    'and a unit fed from a point behind it draws none');
}

console.log('\n-- a split unit is a rectangle, and it was coming out as a circle --');
{
  const S = SUPERLUMINAL_LAYERS;
  /* THE TEST WAS A CHAIN OF TWO KINDS AND THE CATALOGUE HAS FOUR. A split AC
     failed it, fell to the round branch, and exported as a circle at half its
     own DIAGONAL with a centre mark in it — the rectangle that is the whole of
     what a split unit looks like in plan was never drawn. */
  const wFt = 1000 / 304.8, hFt = 250 / 304.8;
  const unit = { id: 'sa', kind: 'split_ac', ...px, rot: 0,
                 w: wFt * source.pxPerFt, h: hFt * source.pxPerFt,
                 r: (Math.hypot(wFt, hFt) / 2) * source.pxPerFt,
                 offCeiling: true, onWall: true, source: 'placed' };
  const { entities } = scan(toSuperluminalDXF({ source, objects: [unit] }));
  const box = entities.filter((e) => e.type === 'POLYLINE' && e.layer === S.objects);
  ok(box.length === 1 && box[0].verts.length === 4,
    `the unit is a closed four-point rectangle: ${box.length}`);
  const side = (i, j) => Math.hypot(box[0].verts[j]['10'] - box[0].verts[i]['10'],
                                    box[0].verts[j]['20'] - box[0].verts[i]['20']) / MM;
  ok(near(side(0, 1), wFt, 0.01) && near(side(1, 2), hFt, 0.01),
    `at 1000 x 250 mm: ${(side(0, 1) * 304.8).toFixed(0)} x ${(side(1, 2) * 304.8).toFixed(0)} mm`);
  ok(!entities.some((e) => e.type === 'CIRCLE' && e.layer === S.objects),
    'and NOT a circle at half its diagonal, which is what it used to be');
  // THE LOUVRES, which are what make a long thin rectangle a split unit rather
  // than a duct, a beam or a shelf — this drawing carries all three.
  const louvres = entities.filter((e) => e.type === 'LINE' && e.layer === S.objects);
  ok(louvres.length === 3, `three louvres along its length: ${louvres.length}`);
  ok(louvres.every((e) => near(Math.abs(e['21'] - e['20']), 0, 1e-6)),
    'running the LENGTH of the unit, which is how the blades sit');
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
