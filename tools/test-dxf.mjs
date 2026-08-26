// tools/test-dxf.mjs — the whole vector route: DXF text -> rooms.
import { parseDXF, classifyLayers, wallSegments, bulgeToArc, inferUnits, UNITS } from '../src/lib/dxf.js';
import { findRooms, doorHints, textHints } from '../src/lib/rooms.js';
import { dxf, line, lwpolyline, arc, circle, text, insert } from './dxfwrite.mjs';
import { flatPlan } from './fixtures.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const section = (s) => console.log('\n' + s);
const MM = 304.8;   // one foot, in millimetres

/** The four-room flat, written out as a millimetre DXF. */
function flatDXF({ insunits = 4, scale = MM, extras = [], blocks = {} } = {}) {
  const ents = flatPlan(0.75).map((s) =>
    line(s.layer, s.x1 * scale, s.y1 * scale, s.x2 * scale, s.y2 * scale));
  return dxf({
    insunits,
    layers: ['A-WALL', 'A-DIMS', 'A-FURN', 'A-DOOR', 'A-TEXT'],
    entities: [...ents, ...extras],
    blocks,
  });
}

// ---------------------------------------------------------------------------
section('reading the file at all');
{
  const d = parseDXF(flatDXF());
  ok('parses', d.ok === true, d.reason);
  ok('finds the wall segments', d.segments.length > 20, `got ${d.segments.length}`);
  ok('reads the layer table', d.layers.some((l) => l.name === 'A-WALL'));
  ok('reads millimetres from the header', d.units.id === 'mm' && d.units.source === 'header',
     `${d.units.id}/${d.units.source}`);
  ok('bbox spans the plan', near(d.bbox.w / MM, 30.75, 0.01), `${(d.bbox.w / MM).toFixed(2)} ft`);
  ok('rubbish input is refused, not thrown', parseDXF('not a dxf at all').ok === false);
}

section('units');
{
  // Same plan in metres, correctly tagged.
  const m = parseDXF(flatDXF({ insunits: 6, scale: 0.3048 }));
  ok('metres read from the header', m.units.id === 'm', m.units.id);

  // Unitless, drawn in millimetres. Must be inferred.
  const u = parseDXF(flatDXF({ insunits: 0, scale: MM }));
  ok('unitless mm drawing is inferred as mm', u.units.id === 'mm' && u.units.source === 'inferred',
     `${u.units.id}/${u.units.source}`);

  // Header LIES: says inches, drawing is in millimetres. A 30 ft plan called
  // inches would be 2.5 ft across, so the bounding box must veto the header.
  const liar = parseDXF(flatDXF({ insunits: 1, scale: MM }));
  ok('a header contradicted by the drawing size is overridden',
     liar.units.id === 'mm' && liar.units.source === 'overridden',
     `${liar.units.id}/${liar.units.source} (header said ${liar.headerSaid})`);

  // Feet, correctly tagged, plausible.
  const ft = parseDXF(flatDXF({ insunits: 2, scale: 1 }));
  ok('feet read from the header', ft.units.id === 'ft', ft.units.id);
  ok('unit candidates are offered for the user to override', ft.unitCandidates.length >= 1);
}

section('layer classification');
{
  const d = parseDXF(flatDXF({
    extras: [
      text('A-TEXT', 5 * MM, 5 * MM, 0.4 * MM, 'BEDROOM'),
      line('A-FURN', 3 * MM, 3 * MM, 9 * MM, 3 * MM),
      line('A-DIMS', -4 * MM, 0, -4 * MM, 24 * MM),
    ],
  }));
  const c = classifyLayers(d.layers);
  ok('A-WALL is guessed as the wall layer', c.wallLayers.includes('A-WALL'), c.wallLayers.join(','));
  ok('dimensions are not treated as walls', !c.wallLayers.includes('A-DIMS'), c.wallLayers.join(','));
  ok('furniture is not treated as walls', !c.wallLayers.includes('A-FURN'), c.wallLayers.join(','));
  ok('every layer is still listed for the user to tick',
     c.layers.length === d.layers.length, `${c.layers.length} vs ${d.layers.length}`);

  // A single-layer export, everything on layer 0. Must not give up.
  const flat0 = dxf({
    layers: ['0'],
    entities: flatPlan(0.75).map((s) => line('0', s.x1 * MM, s.y1 * MM, s.x2 * MM, s.y2 * MM)),
  });
  const c0 = classifyLayers(parseDXF(flat0).layers);
  ok('a drawing with no wall-named layer falls back to using what there is',
     c0.wallLayers.includes('0') && c0.guessed === true, JSON.stringify(c0.wallLayers));
}

section('DXF text all the way through to rooms');
{
  const d = parseDXF(flatDXF({
    extras: [
      text('A-TEXT', 6 * MM, 6 * MM, 0.5 * MM, 'LIVING'),
      text('A-TEXT', 22 * MM, 6 * MM, 0.5 * MM, 'BEDROOM 1'),
      text('A-TEXT', 6 * MM, 18 * MM, 0.5 * MM, "13'-3\" x 11'-3\""),   // a dimension string
      text('A-TEXT', 22 * MM, 18 * MM, 0.5 * MM, '148 SQFT'),           // an area note
    ],
  }));
  const walls = wallSegments(d, ['A-WALL']);
  const r = findRooms(walls, {}, { doorCentres: doorHints(d), texts: textHints(d) });

  ok('four rooms', r.rooms.length === 4,
     `got ${r.rooms.length}: ${r.rooms.map((x) => x.areaSqft.toFixed(0)).join(', ')}`);
  ok('areas come out in square feet', r.rooms.every((x) => x.areaSqft > 140 && x.areaSqft < 180),
     r.rooms.map((x) => x.areaSqft.toFixed(1)).join(', '));
  const labels = r.rooms.map((x) => x.label);
  ok('picks up the room names', labels.includes('LIVING') && labels.includes('BEDROOM 1'),
     JSON.stringify(labels));
  ok('does not mistake a dimension string for a room name',
     !labels.some((l) => l && l.includes('x')), JSON.stringify(labels));
  ok('does not mistake an area note for a room name',
     !labels.some((l) => l && /SQFT/i.test(l)), JSON.stringify(labels));
}

section('polylines, bulges and blocks');
{
  // A room drawn as one closed LWPOLYLINE — the friendliest possible input.
  const poly = dxf({
    layers: ['WALL'],
    entities: [lwpolyline('WALL', [
      { x: 0, y: 0 }, { x: 16 * MM, y: 0 }, { x: 16 * MM, y: 12 * MM }, { x: 0, y: 12 * MM },
    ], true)],
  });
  const pd = parseDXF(poly);
  const pr = findRooms(wallSegments(pd, ['WALL']));
  ok('a closed polyline is one room', pr.rooms.length === 1, `got ${pr.rooms.length}`);
  ok('...of the right area', near(pr.rooms[0]?.areaSqft, 192, 0.5), `got ${pr.rooms[0]?.areaSqft}`);

  // A bay window: the north edge carries a bulge, so that wall is curved.
  //
  // The bulge is stored on the vertex BEFORE the curved run, and its sign
  // decides which way the wall bows. Asserting both signs is what actually
  // pins the convention down — a sign error would swap these two areas and
  // every other test here would still pass.
  //
  // bulge 0.5 over a 16 ft chord is a 106.3 degree arc of radius 10, so the
  // circular segment it adds or removes is r^2/2 * (theta - sin theta) = 44.7.
  const bay = (bulge) => {
    const d = parseDXF(dxf({
      layers: ['WALL'],
      entities: [lwpolyline('WALL', [
        { x: 0, y: 0 }, { x: 16 * MM, y: 0 },
        { x: 16 * MM, y: 12 * MM, bulge },     // the run back along the north wall
        { x: 0, y: 12 * MM },
      ], true)],
    }));
    return { d, r: findRooms(wallSegments(d, ['WALL']), { simplifyEps: 0.15, snapTol: 0.3 }) };
  };
  const out = bay(0.5), into = bay(-0.5);
  ok('a bulged edge becomes a curved wall, not a straight one',
     out.d.segments.length > 4, `${out.d.segments.length} segments from a 4-vertex polyline`);
  ok('a positive bulge bows the wall OUTWARD, adding ~44.7 sqft',
     out.r.rooms.length === 1 && near(out.r.rooms[0].areaSqft, 192 + 44.7, 6),
     `${out.r.rooms.length} room(s), area ${out.r.rooms[0]?.areaSqft?.toFixed(1)}`);
  ok('a negative bulge bows it INWARD, removing the same amount',
     into.r.rooms.length === 1 && near(into.r.rooms[0].areaSqft, 192 - 44.7, 6),
     `${into.r.rooms.length} room(s), area ${into.r.rooms[0]?.areaSqft?.toFixed(1)}`);

  // Walls inside a block, placed rotated and scaled.
  const blocks = {
    'ROOM-UNIT': [
      line('0', 0, 0, 10 * MM, 0), line('0', 10 * MM, 0, 10 * MM, 8 * MM),
      line('0', 10 * MM, 8 * MM, 0, 8 * MM), line('0', 0, 8 * MM, 0, 0),
    ],
  };
  const blocked = dxf({
    layers: ['WALL'], blocks,
    entities: [insert('WALL', 'ROOM-UNIT', 0, 0, { rotation: 90 })],
  });
  const kd = parseDXF(blocked);
  const kr = findRooms(wallSegments(kd, ['WALL']));
  ok('geometry inside a block is found', kr.rooms.length === 1, `got ${kr.rooms.length}`);
  ok('a rotated block keeps its area', near(kr.rooms[0]?.areaSqft, 80, 0.5), `got ${kr.rooms[0]?.areaSqft}`);
  ok('a rotated block swaps its sides',
     near(kr.rooms[0]?.widthFt, 8, 0.05) && near(kr.rooms[0]?.heightFt, 10, 0.05),
     `${kr.rooms[0]?.widthFt?.toFixed(2)} x ${kr.rooms[0]?.heightFt?.toFixed(2)}`);
  ok('block geometry on layer 0 inherits the INSERT layer',
     kd.segments.every((s) => s.layer === 'WALL'),
     [...new Set(kd.segments.map((s) => s.layer))].join(','));
}

section('door swing arcs as evidence');
{
  // The internal door openings in the flat, each with a swing arc on its jamb.
  const d = parseDXF(flatDXF({
    extras: [
      arc('A-DOOR', 14 * MM, 3.5 * MM, 3 * MM, 0, 90),
      arc('A-DOOR', 14 * MM, 17.5 * MM, 3 * MM, 0, 90),
    ],
  }));
  const hints = doorHints(d);
  ok('door-width arcs are collected as hints', hints.length === 2, `got ${hints.length}`);
  const r = findRooms(wallSegments(d, ['A-WALL']), {}, { doorCentres: hints, texts: [] });
  ok('gaps at a swing arc are reported as doors, not bare openings',
     r.diagnostics.bridgeCounts.door > 0, JSON.stringify(r.diagnostics.bridgeCounts));
  ok('still four rooms', r.rooms.length === 4, `got ${r.rooms.length}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
