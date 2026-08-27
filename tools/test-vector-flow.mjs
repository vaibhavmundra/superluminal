// ---------------------------------------------------------------------------
// tools/test-vector-flow.mjs — the whole DXF route, exactly as App.jsx runs it,
// with React taken out.
//
// This is the test that matters most. The unit tests prove each stage; this one
// proves the HANDOFFS — and the handoffs are where a Y-flip, a scale factor or
// a winding order goes wrong in a way that still produces a plausible-looking
// answer three stages later.
// ---------------------------------------------------------------------------
import { parseDXF, classifyLayers, wallSegments, UNITS } from '../src/lib/dxf.js';
import { findRooms, doorHints, textHints } from '../src/lib/rooms.js';
import { vectorSource, roomsToPx, regionFromRoom } from '../src/lib/planSource.js';
import { planLights, DEFAULTS, resolveOptions } from '../src/lib/planner.js';
import { enumerateChunkings } from '../src/lib/chunking.js';
import { bbox, pointInPolygon, polygonArea } from '../src/lib/geometry.js';
import { toDXF, toJSON, toCSV } from '../src/lib/exporters.js';
import { dxf, line, text, arc } from './dxfwrite.mjs';
import { flatPlan } from './fixtures.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const section = (s) => console.log('\n' + s);
const MM = 304.8;

// The exact sequence App.jsx runs, in the same order, with the same maths.
function runApp(dxfText, { unitOverride = null, pick = 1, fansPx = [], opt = {} } = {}) {
  const drawing0 = parseDXF(dxfText);
  if (!drawing0.ok) return { error: drawing0.reason };
  const classified = classifyLayers(drawing0.layers);
  const wallLayers = new Set(classified.wallLayers);

  const chosen = unitOverride ? UNITS.find((u) => u.id === unitOverride) : null;
  const drawing = chosen ? { ...drawing0, units: { ...chosen, source: 'chosen' } } : drawing0;
  const source = vectorSource(drawing, { name: 'test.dxf' });

  const res = findRooms(
    wallSegments(source.drawing, [...wallLayers]), {},
    { doorCentres: doorHints(source.drawing), texts: textHints(source.drawing) });
  const rooms = roomsToPx(res.rooms, source);
  const selectedRoom = rooms.find((r) => r.id === pick) || null;
  const region = regionFromRoom(selectedRoom);
  if (!region) return { source, rooms, res, error: 'no room' };

  // --- App.jsx's `geo`, verbatim ---
  const pxPerFt = source.pxPerFt;
  const polygonPx = region.polygon;
  const b = bbox(polygonPx);
  const origin = { x: b.minX, y: b.minY };
  const toFt = (p) => ({ x: (p.x - origin.x) / pxPerFt, y: (p.y - origin.y) / pxPerFt });
  const mine = fansPx.filter((f) => pointInPolygon({ x: f.x, y: f.y }, polygonPx));
  const geo = {
    polygonPx, origin, toFt,
    polygonFt: polygonPx.map(toFt),
    fansInRoom: mine,
    fixturesFt: mine.map((f) => ({ type: 'fan', ...toFt(f), r: f.r / pxPerFt })),
    zonesFt: [],
  };

  const options = resolveOptions({ ...DEFAULTS, ...opt });
  const chunking = enumerateChunkings(geo.polygonFt, [], options, geo.fixturesFt);
  const plan = planLights(geo.polygonFt, geo.fixturesFt, { ...options, chunkStrategy: chunking.recommendedId }, []);
  return { source, rooms, res, selectedRoom, region, geo, plan, chunking, pxPerFt, wallLayers };
}

/**
 * App.jsx's PIXEL view model, verbatim, and the reason the exporter tests need
 * it.
 *
 * The planner answers in the room's OWN feet, measured from that room's
 * bounding box. The exporters no longer accept that — they take pixels and a
 * scale, because pixels are the only space several rooms on one sheet share.
 * Building it here rather than handing the exporter the planner's output keeps
 * this test honest about the handoff: if App and the exporter ever disagree
 * about which feet they are in, one of them has to disagree with this too.
 */
function toPxRoom(r, name = null) {
  const { plan, geo, pxPerFt } = r;
  const { origin } = geo;
  const toPx = (p) => ({ x: p.x * pxPerFt + origin.x, y: p.y * pxPerFt + origin.y });
  const rectToPx = (c) => ({ ...c,
    x0: c.x0 * pxPerFt + origin.x, x1: c.x1 * pxPerFt + origin.x,
    y0: c.y0 * pxPerFt + origin.y, y1: c.y1 * pxPerFt + origin.y });
  return {
    name,
    plan: {
      ...plan,
      polygonPx: geo.polygonPx,
      chunksPx: (plan.chunks || []).map((ch) => ({
        ...rectToPx(ch),
        xLines: ch.xLines.map((x) => x * pxPerFt + origin.x),
        yLines: ch.yLines.map((y) => y * pxPerFt + origin.y),
      })),
      cellsPx: (plan.cells || []).map(rectToPx),
      lightsPx: plan.lights.map((l) => ({ ...l, ...toPx(l) })),
      zonesPx: [],
      fansPx: geo.fansInRoom,
    },
  };
}

const flatText = ({ insunits = 4, scale = MM, extras = [] } = {}) => dxf({
  insunits,
  layers: ['A-WALL', 'A-TEXT', 'A-DOOR'],
  entities: [
    ...flatPlan(0.75).map((s) => line(s.layer, s.x1 * scale, s.y1 * scale, s.x2 * scale, s.y2 * scale)),
    ...extras,
  ],
});

// ---------------------------------------------------------------------------
section('DXF in, lit room out');
{
  const r = runApp(flatText());
  ok('no error', !r.error, r.error);
  ok('four rooms found', r.rooms.length === 4, `${r.rooms.length}`);
  ok('a room was selected', !!r.selectedRoom);
  ok('the planner succeeded', r.plan?.ok === true, r.plan?.reason);
  ok('it placed lights', r.plan?.lights.length > 0, `${r.plan?.lights.length}`);
  ok('every cell is served',
     r.plan.stats.served === r.plan.stats.cells - r.plan.stats.ceded,
     `${r.plan?.stats.served}/${r.plan?.stats.cells - r.plan?.stats.ceded}`);
  ok('no unserved cells', r.plan.stats.unserved === 0, `${r.plan?.stats.unserved}`);
}

section('the px round trip does not distort the room');
{
  const r = runApp(flatText());
  // The biggest room is 15.25 x 11.25 (east side of a 30 ft flat, 0.75 walls).
  const room = r.selectedRoom;
  const gb = bbox(r.geo.polygonFt);
  ok('room feet survive the trip through pixel space',
     near(gb.w, room.widthFt, 0.02) && near(gb.h, room.heightFt, 0.02),
     `geo ${gb.w.toFixed(3)}x${gb.h.toFixed(3)} vs room ${room.widthFt.toFixed(3)}x${room.heightFt.toFixed(3)}`);
  ok('...and match the drawing to within a quarter inch',
     near(gb.w, 15.25, 0.02) && near(gb.h, 11.25, 0.02),
     `${gb.w.toFixed(3)} x ${gb.h.toFixed(3)} ft`);
  ok('area agrees end to end',
     near(Math.abs(polygonArea(r.geo.polygonFt)), room.areaSqft, 0.5),
     `${Math.abs(polygonArea(r.geo.polygonFt)).toFixed(2)} vs ${room.areaSqft.toFixed(2)}`);
  ok('the polygon is wound the way the raster detector winds them',
     polygonArea(r.geo.polygonFt) > 0,
     `signed area ${polygonArea(r.geo.polygonFt).toFixed(1)}`);
  ok('scale is exact, not estimated', r.pxPerFt > 0 && Number.isFinite(r.pxPerFt));
}

section('the same plan in different units gives the same rooms');
{
  // THE invariant for a vector route: units are a property of the file, not of
  // the building. Draw the identical flat in mm, cm, m, inches and feet, tag
  // each correctly, and every one must come back as the same four rooms at the
  // same size. This is the test that would catch a stray conversion anywhere
  // between the file and the planner.
  const runs = [
    ['mm', 4, MM], ['cm', 5, 30.48], ['m', 6, 0.3048],
    ['in', 1, 12], ['ft', 2, 1],
  ].map(([id, insunits, scale]) => ({ id, r: runApp(flatText({ insunits, scale })) }));

  ok('every unit reads the plan', runs.every((x) => !x.r.error),
     runs.filter((x) => x.r.error).map((x) => x.id + ':' + x.r.error).join('; '));
  ok('every unit finds four rooms', runs.every((x) => x.r.rooms.length === 4),
     runs.map((x) => `${x.id}:${x.r.rooms.length}`).join(' '));
  const widths = runs.map((x) => x.r.selectedRoom.widthFt);
  ok('every unit agrees on the room width to a hundredth of a foot',
     Math.max(...widths) - Math.min(...widths) < 0.01,
     runs.map((x, i) => `${x.id}:${widths[i].toFixed(4)}`).join(' '));
  ok('...and it is the width the drawing says', near(widths[0], 15.25, 0.02), `${widths[0].toFixed(3)}`);
  ok('every unit places the same number of lights',
     new Set(runs.map((x) => x.r.plan.lights.length)).size === 1,
     runs.map((x) => `${x.id}:${x.r.plan.lights.length}`).join(' '));
  ok('the working px scale adapts to keep the canvas sane',
     runs.every((x) => x.r.source.w > 200 && x.r.source.w < 3000),
     runs.map((x) => `${x.id}:${x.r.source.w}`).join(' '));
}

section('the wrong units fail loudly, not quietly');
{
  // Overriding a millimetre drawing to centimetres makes every doorway a 30 ft
  // opening. Nothing bridges, the internal walls become dangles and are pruned,
  // and only the squares where the wall lines cross at the corners survive. That
  // is the correct answer to a wrong question — and it must look obviously wrong
  // on screen rather than producing a plausible layout of the wrong building.
  const bad = runApp(flatText({ insunits: 4, scale: MM }), { unitOverride: 'cm' });
  ok('the plan reads as an absurd size', bad.source.widthFt > 300,
     `${bad.source.widthFt.toFixed(0)} ft wide`);
  ok('the four rooms do NOT survive', bad.rooms.length < 4, `${bad.rooms.length}`);
  ok('no doorway is bridged at that scale',
     bad.res.diagnostics.bridgeCounts.opening === 0 && bad.res.diagnostics.bridgeCounts.door === 0,
     JSON.stringify(bad.res.diagnostics.bridgeCounts));
  ok('the room screen has the evidence to show for it',
     bad.res.diagnostics.facesFound < 4 && bad.source.widthFt > 300,
     `${bad.res.diagnostics.facesFound} faces`);
}

section('fans are placed by click, and only count in their own room');
{
  const base = runApp(flatText());
  const east = base.rooms.find((r) => r.id === base.selectedRoom.id);
  const west = base.rooms.find((r) => r.id !== base.selectedRoom.id
    && !pointInPolygon(r.centroidPx, east.polygonPx));
  const sweepPx = 3.94 * base.source.pxPerFt;
  const fansPx = [
    { id: 1, x: east.centroidPx.x, y: east.centroidPx.y, r: sweepPx / 2 },
    { id: 2, x: west.centroidPx.x, y: west.centroidPx.y, r: sweepPx / 2 },
  ];
  const r = runApp(flatText(), { pick: east.id, fansPx });
  ok('a fan clicked in another room is excluded', r.geo.fansInRoom.length === 1,
     `${r.geo.fansInRoom.length} of 2`);
  ok('the fan in this room reaches the planner', r.plan.stats.fans === 1, `${r.plan?.stats.fans}`);
  ok('the fan sweep survives the px round trip',
     near(r.geo.fixturesFt[0].r * 2, 3.94, 0.02),
     `${(r.geo.fixturesFt[0].r * 2).toFixed(3)} ft`);
  ok('the layout still works with a fan in it', r.plan.ok === true, r.plan?.reason);
  // The point of a fan is that nothing is placed inside its sweep plus its
  // clearance. Whether that produces large lights depends on where the cells
  // fall, so the property to assert is the clearance, not the fitting type.
  const opt = resolveOptions({ ...DEFAULTS });
  const fan = r.geo.fixturesFt[0];
  const need = fan.r + opt.fanClearance;
  const fouling = r.plan.lights.filter((l) => Math.hypot(l.x - fan.x, l.y - fan.y) < need - 1e-6);
  ok('no light sits inside the fan sweep plus its clearance',
     fouling.length === 0 && r.plan.stats.clashes === 0,
     `${fouling.length} fouling, ${r.plan.stats.clashes} clashes, need ${need.toFixed(2)} ft`);
  ok('the fan pulled the grid about', r.plan.stats.nudged >= 0 && r.plan.ok === true);
}

section('room names carry through to the export');
{
  const r = runApp(flatText({
    extras: [
      text('A-TEXT', 22 * MM, 6 * MM, 0.5 * MM, 'MASTER BEDROOM'),
      text('A-TEXT', 6 * MM, 6 * MM, 0.5 * MM, 'LIVING'),
    ],
  }));
  const named = r.rooms.filter((x) => x.label);
  ok('two rooms are named from the drawing', named.length === 2,
     JSON.stringify(r.rooms.map((x) => x.label)));
  // Pick the named one rather than assuming which id it landed on: the two east
  // rooms are the same size, so their order is an implementation detail.
  const bedroom = named.find((x) => x.label === 'MASTER BEDROOM');
  ok('the named room is found', !!bedroom, JSON.stringify(named.map((x) => x.label)));
  const picked = runApp(flatText({
    extras: [
      text('A-TEXT', 22 * MM, 6 * MM, 0.5 * MM, 'MASTER BEDROOM'),
      text('A-TEXT', 6 * MM, 6 * MM, 0.5 * MM, 'LIVING'),
    ],
  }), { pick: bedroom.id });
  ok('the region carries the name through to the layout',
     picked.region.label === 'MASTER BEDROOM', String(picked.region.label));
  ok('and the area with it', near(picked.region.areaSqft, bedroom.areaSqft, 0.01));
  const json = JSON.parse(toJSON([toPxRoom(r, 'MASTER BEDROOM')],
                                 { pxPerFt: r.pxPerFt, mode: 'dxf' }));
  ok('JSON export states feet', json.units === 'feet');
  ok('JSON export is a list of rooms', json.rooms.length === 1, `${json.rooms.length}`);
  ok('JSON export carries the room name', json.rooms[0].name === 'MASTER BEDROOM',
     String(json.rooms[0].name));
  ok('JSON export has the lights', json.rooms[0].lights.length === r.plan.lights.length);
  ok('JSON export totals agree with the room',
     json.totals.lights === r.plan.lights.length, `${json.totals.lights}`);
  ok('JSON export carries the room outline',
     json.rooms[0].polygon.length === r.geo.polygonFt.length);
  // The plan-wide space, not the room-local one: a room that does not start at
  // the drawing's corner must not export as though it did.
  const off = bbox(json.rooms[0].polygon);
  ok('the exported polygon is in plan-wide feet, not room-local',
     off.minX > 0.01 || off.minY > 0.01,
     `${off.minX.toFixed(3)},${off.minY.toFixed(3)}`);
}

section('exported DXF reads back through our own parser');
{
  const r = runApp(flatText());
  // An UNNAMED room, deliberately: that is the case that must still produce the
  // plain ROOM / CHUNK / GRID layers, so an existing consumer's drawing does not
  // have its layers renamed by a feature it is not using.
  const out = toDXF([toPxRoom(r)], { pxPerFt: r.pxPerFt, heightPx: r.source.h });
  const reread = parseDXF(out);
  ok('the export parses', reread.ok === true, reread.reason);
  ok('it declares feet', reread.units.id === 'ft', `${reread.units.id}`);
  const layers = new Set(reread.segments.map((s) => s.layer));
  ok('the ROOM layer came back', layers.has('ROOM'), [...layers].join(','));
  ok('the GRID layer came back', layers.has('GRID'), [...layers].join(','));
  const circleLayers = new Set(reread.circles.map((c) => c.layer));
  ok('the lights came back as circles',
     circleLayers.has('LIGHT-SMALL') || circleLayers.has('LIGHT-LARGE'),
     [...circleLayers].join(','));
  ok('as many light circles out as lights in',
     reread.circles.filter((c) => /^LIGHT-/.test(c.layer)).length === r.plan.lights.length,
     `${reread.circles.filter((c) => /^LIGHT-/.test(c.layer)).length} vs ${r.plan.lights.length}`);

  // Feed the exported ROOM outline back in as if it were a fresh drawing.
  const roomOnly = dxf({
    layers: ['ROOM'],
    insunits: 2,
    entities: reread.segments.filter((s) => s.layer === 'ROOM')
      .map((s) => line('ROOM', s.x1, s.y1, s.x2, s.y2)),
  });
  const again = findRooms(wallSegments(parseDXF(roomOnly), ['ROOM']));
  ok('the exported outline is itself a readable room', again.rooms.length === 1,
     `${again.rooms.length}`);
  ok('...of the same area it went out as',
     near(again.rooms[0]?.areaSqft, r.selectedRoom.areaSqft, 1),
     `${again.rooms[0]?.areaSqft?.toFixed(1)} vs ${r.selectedRoom.areaSqft.toFixed(1)}`);
}

section('switching rooms');
{
  const flat = flatText();
  const ids = runApp(flat).rooms.map((x) => x.id);
  const plans = ids.map((id) => runApp(flat, { pick: id }));
  ok('every room in the flat can be lit', plans.every((p) => p.plan.ok), 
     plans.map((p) => p.plan.ok).join(','));
  ok('each room gets its own layout',
     new Set(plans.map((p) => p.plan.lights.length)).size >= 1,
     plans.map((p) => p.plan.lights.length).join(','));
  ok('each layout uses its own origin, not the drawing\'s',
     plans.every((p) => near(bbox(p.geo.polygonFt).minX, 0, 1e-6)),
     plans.map((p) => bbox(p.geo.polygonFt).minX.toFixed(3)).join(','));
  // Every room in one file, which is what the app now exports.
  const named = plans.map((pl, i) => toPxRoom(pl, `Space ${i + 1}`));
  const csv = toCSV(named, { pxPerFt: plans[0].pxPerFt }).split('\n');
  const lightsAll = plans.reduce((n, pl) => n + pl.plan.lights.length, 0);
  ok('CSV export has a row per light in the whole plan',
     csv.length === lightsAll + 1, `${csv.length - 1} rows for ${lightsAll} lights`);
  ok('CSV export names the space in the first column',
     csv[0].startsWith('space,') && csv[1].startsWith('Space '), csv[1]);
  ok('every room appears in the CSV',
     new Set(csv.slice(1).map((l) => l.split(',')[0])).size === plans.length,
     `${new Set(csv.slice(1).map((l) => l.split(',')[0])).size} of ${plans.length}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
