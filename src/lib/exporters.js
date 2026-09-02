// ---------------------------------------------------------------------------
// exporters.js — get the layout out of the browser and into a drawing.
//
// THE WHOLE PLAN, NOT ONE ROOM. Every exporter takes the list of rooms, because
// a lighting drawing is a drawing of a floor and a per-room file is something
// the recipient has to reassemble by hand.
//
// Which raises the one genuinely awkward thing here: WHICH FEET. The planner
// works in each room's own local feet, measured from that room's bounding box,
// and it should — a room's layout must not depend on where the room sits on the
// sheet. But eight rooms each measured from their own corner would stack eight
// layouts on top of one another at the origin. The space every room actually
// shares is IMAGE PIXELS, so that is what the exporters are handed, and they
// divide by the scale to get one coherent set of feet for the whole plan. See
// roomInFeet, which is the only place that conversion happens.
// ---------------------------------------------------------------------------

import { TRACK_DIMS_IN } from './track.js';

export function download(filename, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * One room's layout, in feet, in the space the whole plan shares.
 *
 * `room` is { name, plan } where plan carries the *Px arrays App.jsx built.
 * Nothing here reads plan.lights or plan.polygonFt: those are room-local and
 * using them is the mistake this function exists to prevent.
 */
export function roomInFeet(room, pxPerFt) {
  const plan = room.plan || {};
  const f = (p) => ({ x: p.x / pxPerFt, y: p.y / pxPerFt });
  const rect = (r) => ({ x0: r.x0 / pxPerFt, y0: r.y0 / pxPerFt,
                         x1: r.x1 / pxPerFt, y1: r.y1 / pxPerFt });
  return {
    // Left null when there is none. A room called "Room" would put a TEXT
    // entity reading "Room" in the drawing and rename the ROOM layer to
    // ROOM-ROOM, both of which are worse than saying nothing.
    name: room.name ?? null,
    polygon: (plan.polygonPx || []).map(f),
    areaSqft: plan.stats?.areaSqft ?? null,
    stats: plan.stats ?? null,
    chunking: plan.chunking ?? null,
    opt: plan.opt ?? null,
    chunks: (plan.chunksPx || []).map((ch) => ({
      ...rect(ch),
      xLines: (ch.xLines || []).map((x) => x / pxPerFt),
      yLines: (ch.yLines || []).map((y) => y / pxPerFt),
    })),
    cells: (plan.cellsPx || []).map(rect),
    zones: (plan.zonesPx || []).map(rect),
    fans: (plan.fansPx || []).map((fan) => ({ ...f(fan), r: (fan.r || 0) / pxPerFt })),
    lights: (plan.lightsPx || []).map((l) => ({
      // `kind` IS GEOMETRY, `fixture` IS PRODUCT, and every export needs the
      // second. A schedule on which a toilet's 5 W 30-degree lamp is the same
      // entry as a bedroom's 7 W 36-degree one cannot be ordered from.
      id: l.id, kind: l.kind, fixture: l.fixture || l.kind,
      axis: l.axis ?? null, nudged: !!l.nudged, ...f(l),
    })),
  };
}

/** Only the rooms that produced a layout, converted once. */
function laidOut(rooms, pxPerFt) {
  return (rooms || [])
    .filter((r) => r?.plan?.ok)
    .map((r) => roomInFeet(r, pxPerFt));
}

export function toJSON(rooms, meta = {}) {
  const { pxPerFt } = meta;
  const out = laidOut(rooms, pxPerFt);
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    units: 'feet',
    // Y grows DOWNWARD here, as it does on screen and in the image the plan came
    // from. The DXF export is the one that flips it, because CAD does not.
    axes: 'x right, y down, origin at the top-left of the plan image',
    scale: meta,
    totals: {
      rooms: out.length,
      lights: out.reduce((s, r) => s + r.lights.length, 0),
      areaSqft: +out.reduce((s, r) => s + (r.areaSqft || 0), 0).toFixed(2),
    },
    rooms: out.map((r) => ({
      name: r.name,
      polygon: r.polygon.map((p) => ({ x: +p.x.toFixed(3), y: +p.y.toFixed(3) })),
      areaSqft: r.areaSqft != null ? +r.areaSqft.toFixed(2) : null,
      noLightZones: r.zones.map((z) => ({
        x0: +z.x0.toFixed(3), y0: +z.y0.toFixed(3), x1: +z.x1.toFixed(3), y1: +z.y1.toFixed(3),
      })),
      fans: r.fans.map((fan) => ({ x: +fan.x.toFixed(3), y: +fan.y.toFixed(3), r: +fan.r.toFixed(3) })),
      // which of the possible decompositions this layout was built on. Without
      // it a JSON export cannot be reproduced: the same room and the same
      // settings can legitimately produce several different layouts.
      chunking: r.chunking ? {
        id: r.chunking.id,
        label: r.chunking.label,
        chosenBy: r.chunking.chosenBy,
        optionsAvailable: r.chunking.optionCount,
        recommended: r.chunking.recommendedId,
        metrics: r.chunking.metrics,
      } : null,
      chunks: r.chunks.map((ch) => ({
        x0: +ch.x0.toFixed(3), y0: +ch.y0.toFixed(3), x1: +ch.x1.toFixed(3), y1: +ch.y1.toFixed(3),
        xLines: ch.xLines.map((v) => +v.toFixed(3)), yLines: ch.yLines.map((v) => +v.toFixed(3)),
      })),
      grid: { cells: r.cells.length, omittedChunks: r.stats?.omittedChunks ?? 0 },
      options: r.opt,
      lights: r.lights.map((l) => ({
        id: l.id, type: l.kind, fixture: l.fixture || l.kind,
        x: +l.x.toFixed(3), y: +l.y.toFixed(3),
        orientation: l.kind === 'large'
          ? (l.axis === 'v' ? 'on vertical grid line' : 'on horizontal grid line')
          : 'cell centre',
      })),
    })),
  }, null, 2);
}

export function toCSV(rooms, { pxPerFt } = {}) {
  const rows = [['space', 'id', 'type', 'fixture', 'x_ft', 'y_ft', 'x_ft_in', 'y_ft_in']];
  const ftin = (v) => {
    const f = Math.floor(v); const i = Math.round((v - f) * 12);
    return i === 12 ? `${f + 1}'-0"` : `${f}'-${i}"`;
  };
  // A room name can contain a comma. Quoting only the field that can is enough
  // and keeps the file readable in a terminal.
  const q = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
  for (const r of laidOut(rooms, pxPerFt)) {
    for (const l of r.lights) {
      rows.push([q(r.name || 'Space'), l.id, l.kind, l.fixture || l.kind,
                 l.x.toFixed(3), l.y.toFixed(3), ftin(l.x), ftin(l.y)]);
    }
  }
  return rows.map((r) => r.join(',')).join('\n');
}

export function svgString(svgEl) {
  const clone = svgEl.cloneNode(true);
  // THE PLAN GOES OUT AS SCANNED, EVEN IN DARK MODE. The canvas may be showing a
  // pixel-inverted copy of the drawing; that is a way of looking at it, not a
  // change to it, and a negative is not what anybody wants on a sheet. The
  // element carries the original alongside, and this puts it back.
  for (const im of clone.querySelectorAll('[data-src-as-scanned]')) {
    const original = im.getAttribute('data-src-as-scanned');
    im.setAttribute('href', original);
    im.removeAttribute('data-src-as-scanned');
  }
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}

export async function svgToPNG(svgEl, width) {
  const str = svgString(svgEl);
  const vb = svgEl.viewBox.baseVal;
  const w = width || vb.width, h = (vb.height / vb.width) * w;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise((res, rej) => {
    img.onload = res; img.onerror = rej;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
  });
  const cv = document.createElement('canvas');
  cv.width = Math.round(w); cv.height = Math.round(h);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  return new Promise((res) => cv.toBlob(res, 'image/png'));
}

// --- DXF primitives (R12 ASCII) --------------------------------------------
//
// ONE DXF EXPORT, and this is the only block that writes one. There used to be
// two — a "standalone" drawing on ROOM / CHUNK / GRID / NO-LIGHT layers and the
// CAD overlay below — and the standalone one was the file people actually got
// off the DXF button. It carried the planner's WORKING onto a deliverable
// sheet: every chunk boundary, every grid line, every no-light box, none of
// which anybody outside this app has a use for. It also predated the layer
// scheme and the fitting symbols entirely, so the file that came out looked
// nothing like the drawing on screen that it was supposed to be a copy of.
//
// So there is one exporter now, and the coordinate system is the only thing
// that varies: it lands ON the original drawing when there is one to land on,
// and falls back to feet with Y flipped when the plan came from an image. Same
// layers, same symbols, same fills, either way.

function dxfLine(layer, x1, y1, x2, y2) {
  return ['0','LINE','8',layer,'10',x1.toFixed(4),'20',y1.toFixed(4),'30','0.0',
          '11',x2.toFixed(4),'21',y2.toFixed(4),'31','0.0'];
}
function dxfCircle(layer, x, y, r) {
  return ['0','CIRCLE','8',layer,'10',x.toFixed(4),'20',y.toFixed(4),'30','0.0','40',r.toFixed(4)];
}

/**
 * A FILLED SHAPE, IN A DIALECT THAT HAS NO HATCH.
 *
 * R12 predates HATCH, so the only primitive in the file that arrives with ink
 * inside it is SOLID — and SOLID is the one entity in DXF whose vertices are
 * NOT in ring order. The quad is traversed 10 -> 11 -> 13 -> 12: the third and
 * fourth points are swapped. Feed it four corners going round a rectangle and
 * you get a bow tie, which is exactly the bug this pair of wrappers exists to
 * make unwriteable. Nothing calls `dxfSolid` directly.
 */
function dxfSolid(layer, a, b, c, d) {
  return ['0','SOLID','8',layer,
          '10',a.x.toFixed(6),'20',a.y.toFixed(6),'30','0.0',
          '11',b.x.toFixed(6),'21',b.y.toFixed(6),'31','0.0',
          '12',c.x.toFixed(6),'22',c.y.toFixed(6),'32','0.0',
          '13',d.x.toFixed(6),'23',d.y.toFixed(6),'33','0.0'];
}
/** Four corners IN RING ORDER, filled. The swap happens here and only here. */
function dxfSolidQuad(layer, ring) {
  const [a, b, c, d] = ring;
  return dxfSolid(layer, a, b, d, c);
}
/** A triangle: the degenerate SOLID, fourth vertex repeating the third. */
function dxfSolidTri(layer, a, b, c) {
  return dxfSolid(layer, a, b, c, c);
}

// How many triangles a filled dot is made of. Sixteen is the point where the
// facets stop being visible at the zoom anybody checks a downlight at, and a
// downlight's dot is a couple of inches across — going finer buys nothing and
// every fitting on the sheet pays for it.
const DISC_FACETS = 16;

/**
 * A FILLED DISC, as a fan of triangles about its centre.
 *
 * The alternative was AutoCAD's donut trick — a two-vertex closed polyline with
 * a width — which is one entity instead of sixteen and renders as a true circle
 * rather than a sixteen-gon. It was rejected because a viewer that ignores
 * polyline width draws it as a thin ring, and a ring is precisely the mark this
 * fill is here to be distinguished FROM. A SOLID is filled everywhere or the
 * file is not being read at all.
 */
function dxfDisc(layer, c, r) {
  let out = [];
  for (let i = 0; i < DISC_FACETS; i++) {
    const a0 = (i / DISC_FACETS) * Math.PI * 2;
    const a1 = ((i + 1) / DISC_FACETS) * Math.PI * 2;
    out = out.concat(dxfSolidTri(layer, c,
      { x: c.x + r * Math.cos(a0), y: c.y + r * Math.sin(a0) },
      { x: c.x + r * Math.cos(a1), y: c.y + r * Math.sin(a1) }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// THE DXF EXPORT — the drawing on screen, as a drawing.
//
// THE FILE IS A COPY OF THE CANVAS, and that is the standard every decision
// below is held to. If a fitting is a ring with a filled dot in it on screen it
// is a ring with a filled dot in the file; if a reverse cove is a filled band it
// is a filled band; if a strip is dotted it is dotted. The planner's WORKING —
// chunk boundaries, grid lines, cells, no-light boxes — is on screen behind a
// checkbox and is not in the file at all. What is left of the plan itself is the
// space outline, because a fitting with nothing round it cannot be read.
//
// WHERE IT LANDS is the one thing that varies, and it varies on what the plan
// came from:
//
//   a DXF     every entity comes back out in THE ORIGINAL FILE'S OWN
//             COORDINATES — its units, its origin, its Y-up orientation — so it
//             imports straight onto the drawing the user started from.
//             `source.toDu` is that mapping, inverted from the one that brought
//             the drawing in, so it is used for every single point and nothing
//             is converted by hand.
//   an image  there is nothing to line up with, so the file is feet with Y
//             flipped about the WHOLE SHEET. Flipping each space about its own
//             top edge would mirror the plan's vertical arrangement and put the
//             bedroom above the living room; `heightPx` is the plan's height, so
//             every space is reflected in the same line.
//
// Same layers, same symbols, same fills down both routes. Only `P` differs.
//
// And the one rule worth stating: TRANSFORM POINTS, NEVER ANGLES. Screen Y
// grows downward and CAD Y grows upward, so a rotation carried
// across as a number comes out mirrored; carried across as four corners it
// cannot. The AC unit's rectangle is built in pixels, rotated in pixels, and
// only then converted — which is why there is no minus sign anywhere below.
//
// DXF R12, deliberately: POLYLINE/VERTEX/SEQEND rather than LWPOLYLINE, no
// handles, no object section. It is the dialect every CAD program on earth can
// read, and nothing here needs anything newer.
// ---------------------------------------------------------------------------

/**
 * FIVE LAYERS, SPLIT BY WHAT GETS ORDERED AND SWITCHED, not by which pass of
 * this app produced it.
 *
 * That is the whole principle, and it is why a chandelier is not a ceiling
 * object here even though it is one everywhere else in the code. Internally a
 * chandelier is an obstacle: it has a body, it keeps a clearance, it anchors the
 * grid — identical treatment to a fan, which is the point of ceilingObjects.js.
 * On a drawing it is a decorative light fitting: it is bought from a lighting
 * supplier, wired to a lighting circuit, and switched with the sconces. A fan
 * and an AC cassette are none of those things.
 *
 * So the layers follow the trades. Strips are a linear product on their own
 * driver; spots are the recessed downlight schedule whether they are lighting a
 * ceiling evenly or aimed at a table; decorative is what an interior designer
 * specifies by model number; ceiling objects are somebody else's scope entirely.
 * Each is a thing a person switches off on its own to look at the rest.
 *
 * AND THE REVERSE COVE IS A SIXTH, WHICH IS THE TRADE RULE APPLIED AGAIN RATHER
 * THAN AN EXCEPTION TO IT. Everything on `led_strips` is bought from a lighting
 * supplier and run by an electrician. A reverse cove is eight inches of ceiling:
 * it is set out, boarded, taped and skimmed by a CEILING CONTRACTOR, weeks
 * before the tape that goes in it arrives on site. Two trades, two programmes,
 * two people who need to see their own work without the other's on top of it —
 * which is the whole test this list is built on.
 *
 * It also wants a different KIND of geometry, and that is the tell. Everything
 * else here is a symbol or a run: a circle, a cross, a polyline. This is an
 * outline of something that gets built to a dimension, so it exports as the
 * rectangle it is and can be measured off the drawing.
 */
export const SUPERLUMINAL_LAYERS = {
  spots: 'superluminal_spots',
  strips: 'superluminal_led_strips',
  reverseCoves: 'superluminal_reverse_coves',
  // A SEVENTH, BY THE SAME TRADE RULE. A track is not a fitting and not tape: it
  // is a carrier that has to be SET OUT and fixed before any head goes near it,
  // and it is the one thing on this drawing an electrician marks on the slab
  // first and works to. The heads clipped into it stay on `spots` with every
  // other fitting — they are the schedule — and the profile is the line they are
  // set out along, which is a different drawing to work from.
  tracks: 'superluminal_tracks',
  // AND THE HEADS ON THEIR OWN LAYER TOO, which is the trade rule taken one step
  // further than the profile. The profile is set out and fixed by one visit; the
  // heads are clipped in on another, are the only fittings on the drawing that
  // can be slid along afterwards without touching the ceiling, and are a
  // different order from a different page of the catalogue. Somebody setting out
  // carrier wants the runs without forty modules on top of them, and somebody
  // commissioning wants the modules without the recessed schedule.
  trackFixtures: 'superluminal_track_fixtures',
  decorative: 'superluminal_decorative',
  objects: 'superluminal_ceiling_objects',
  rooms: 'superluminal_rooms',
};

/** Layer colours, so they are told apart the moment they import. */
const SL_COLOUR = {
  spots: 5,        // blue
  strips: 4,       // cyan
  reverseCoves: 2, // yellow — a builder's line, not an electrician's
  tracks: 7,       // white/black — the setting-out line the heads sit on
  trackFixtures: 30, // orange — what clips into it
  decorative: 6,   // magenta
  objects: 1,      // red
  rooms: 3,        // green
};

/**
 * A DOTTED LINE IS THE DRAWING CONVENTION FOR "THIS IS BEHIND SOMETHING", and
 * that is what a strip is: tape in a pocket, in a slot, under a shelf, never in
 * the open. The canvas has drawn it dotted from the beginning; the file used to
 * hand over a continuous polyline, which on somebody else's sheet reads as a
 * pipe or a setting-out line.
 *
 * SET ON THE LAYER, NOT ON THE ENTITY. Every run in the file is tape, so there
 * is nothing to vary per entity — and a layer that carries its own linetype
 * survives being copied into another drawing, where a per-entity override is the
 * first thing a purge or a layer standard strips out.
 */
const SL_LINETYPE = { strips: 'DOTTED' };

// The dot and the gap, IN FEET, converted to the drawing's units at write time
// so the pattern is the same size on a plan drawn in millimetres and one drawn
// in metres. $LTSCALE stays at 1: scaling a pattern that is already correct is
// how a dotted line ends up looking solid in somebody else's drawing, because
// LTSCALE is a document setting they may well have their own value for.
const DOT_FT = 0.05;   // ~15 mm of ink
const GAP_FT = 0.10;   // ~30 mm of air

// The filled centre dot on a fitting whose BODY is large — a chandelier, a
// pendant. A downlight's dot is 0.42 of a 0.29 ft ring, and this is that number,
// held still so a big fitting does not get a big blob. See the chandelier branch.
const DOT_MARK_FT = 0.29 * 0.42;

/**
 * One LTYPE table entry. `dashes` is the pattern in drawing units: positive is
 * ink, negative is gap, and an empty list is CONTINUOUS.
 *
 * A SHORT DASH RATHER THAN A TRUE ZERO-LENGTH DOT. AutoCAD renders a 0 in the
 * pattern as a point and it looks right; several lighter viewers render it as
 * nothing at all and the strip disappears from the drawing entirely. Fifteen
 * millimetres of ink is a dot at any scale a floor plan is looked at.
 */
function slLtype(name, descr, dashes) {
  const total = dashes.reduce((sum, d) => sum + Math.abs(d), 0);
  const out = ['0','LTYPE','2',name,'70','0','3',descr,'72','65',
               '73',String(dashes.length),'40',total.toFixed(6)];
  for (const d of dashes) out.push('49', d.toFixed(6));
  return out;
}

function dxfPolyline(layer, pts, closed = true) {
  if (!pts?.length) return [];
  const out = ['0','POLYLINE','8',layer,'66','1','70',closed ? '1' : '0',
               '10','0.0','20','0.0','30','0.0'];
  for (const p of pts) {
    out.push('0','VERTEX','8',layer,
             '10',p.x.toFixed(6),'20',p.y.toFixed(6),'30','0.0');
  }
  out.push('0','SEQEND','8',layer);
  return out;
}

function slHeader(insunits, duPerFt) {
  const keys = Object.keys(SUPERLUMINAL_LAYERS);
  const layer = (k) => ['0','LAYER','2',SUPERLUMINAL_LAYERS[k],'70','0',
                        '62',String(SL_COLOUR[k]),
                        '6',SL_LINETYPE[k] || 'CONTINUOUS'];
  return [
    '0','SECTION','2','HEADER',
    '9','$ACADVER','1','AC1009',
    // The ORIGINAL drawing's units, not ours. Import scaling keys off this, and
    // a file that says feet while holding millimetres arrives 300x too big.
    '9','$INSUNITS','70',String(insunits ?? 0),
    // ONE, DELIBERATELY. See DOT_FT: the pattern is written in this drawing's
    // own units, so it is already the right size and multiplying it is how it
    // stops being.
    '9','$LTSCALE','40','1.0',
    '0','ENDSEC',
    '0','SECTION','2','TABLES',
    // THE LTYPE TABLE COMES FIRST, and it has to: a LAYER entry names a
    // linetype, and a CAD that reads the layer before the pattern exists throws
    // the reference away — silently, so the only symptom is a strip that arrives
    // continuous. CONTINUOUS is defined here too even though every CAD has it
    // built in, because every other layer in the table references it by name.
    '0','TABLE','2','LTYPE','70','2',
    ...slLtype('CONTINUOUS', 'Solid line', []),
    ...slLtype('DOTTED', 'Dotted . . . . . . . . . . . . . . . . . .',
               [DOT_FT * duPerFt, -GAP_FT * duPerFt]),
    '0','ENDTAB',
    // An explicit LAYER table. Most CAD will invent a layer named by an entity
    // that references a missing one, but "most" is not a promise, and inventing
    // it loses the colour.
    '0','TABLE','2','LAYER','70',String(keys.length),
    ...keys.flatMap(layer),
    '0','ENDTAB','0','ENDSEC',
    '0','SECTION','2','ENTITIES',
  ];
}

/**
 * The layers, in the original drawing's coordinates.
 *
 * Everything arrives in PLAN PIXELS — the one space every part of this app
 * shares — and leaves in drawing units.
 *
 * WHAT GOES WHERE is decided by SUPERLUMINAL_LAYERS above — by trade, not by
 * which pass of this app produced the thing. Note in particular that a
 * chandelier lands on `decorative` and not on `ceiling_objects`, which is where
 * it lives everywhere else in the code.
 */
export function toSuperluminalDXF({ source, pxPerFt, heightPx, rooms = [],
                                    objects = [], accents = [],
                                    spots = [] } = {}) {
  // A DXF SOURCE OVERLAYS; ANYTHING ELSE IS A SHEET OF ITS OWN. This used to
  // throw on an image, which is why there was a second exporter and why the
  // second exporter was the one most people actually got.
  const overlay = source?.kind === 'vector';
  const units = overlay ? source.drawing?.units : null;
  const px = (overlay ? source.pxPerFt : null) || pxPerFt || null;
  if (!px) throw new Error('The DXF export needs the plan scale.');
  // In overlay mode the drawing's own unit; on a sheet of our own, feet.
  const duPerFt = overlay ? 1 / (units?.toFeet || 1) : 1;
  const insunits = overlay ? units?.code : 2;   // 2 = feet
  // THE FLIP IS ABOUT THE WHOLE SHEET, not about each space's own extent:
  // reflecting every space in its own top edge would mirror the plan's vertical
  // arrangement and stand the drawing on its head one room at a time.
  const H = (heightPx ?? source?.h ?? 0) / px;
  const P = overlay
    ? (p) => source.toDu(p)                     // plan pixels -> drawing units
    : (p) => ({ x: p.x / px, y: H - p.y / px }); // plan pixels -> feet, Y up
  const L = (ft) => ft * duPerFt;               // feet -> drawing units
  const { spots: LY_S, strips: LY_T, reverseCoves: LY_C, decorative: LY_D,
          objects: LY_O, rooms: LY_R, tracks: LY_K,
          trackFixtures: LY_KF } = SUPERLUMINAL_LAYERS;

  let out = slHeader(insunits, duPerFt);
  const add = (e) => { out = out.concat(e); };

  /**
   * THE FITTING SYMBOL: A RING WITH A FILLED DOT INSIDE IT.
   *
   * WHICH IS WHAT IS ON SCREEN, and that is the whole justification. It used to
   * be a ring with a crosshair through it — the CAD convention for a centre
   * mark, chosen so a fitting could be snapped to — and it was wrong twice over.
   * A crosshair is what a drawing puts on a HOLE, so forty of them read as a
   * setting-out drawing for coring rather than as forty lamps; and it did not
   * match the sheet the designer had just approved, which is the only reference
   * anybody has for whether the file is right.
   *
   * The dot is not decoration: it is the lamp, and the ring is the trim round
   * it. Both are drawn AT REAL SIZE, so the ring can still be measured off the
   * drawing and the dot still gives the centre something to snap to — a filled
   * SOLID fan has its own centre vertex on every one of its sixteen triangles.
   */
  const marker = (layer, at, rFt) => {
    const c = P(at), r = L(rFt);
    add(dxfCircle(layer, c.x, c.y, r));
    // 0.42 of the ring, which is the ratio the canvas draws (see PlanCanvas —
    // `r={R * 0.42}`). Copied rather than re-judged: the point is that the two
    // drawings match, so the number has one home and this is a quotation of it.
    add(dxfDisc(layer, c, r * 0.42));
  };

  /**
   * A TRACK HEAD, AS THE RECTANGLE IT IS, plus a cross at its centre.
   *
   * NOT A RING, WHICH IS WHAT EVERY OTHER FITTING GETS. A ring is the honest
   * symbol for a round cut-out; a track head is a body with a length and an
   * orientation, and both of those are the whole reason it is on a track — the
   * length decides how many fit on a run and the orientation is which way it
   * lies on the carrier. A circle in a CAD file throws both away, and the person
   * who opens it can no longer check that the heads fit between the corners.
   *
   * ROTATED IN PIXELS AND CONVERTED CORNER BY CORNER, for the reason the AC unit
   * block gives above: an angle carried across the Y flip comes out mirrored,
   * four points cannot.
   */
  const trackBody = (at, lenFt, wideFt, angle) => {
    const c = Math.cos(angle || 0), sn = Math.sin(angle || 0);
    const hx = (lenFt * px) / 2, hy = (wideFt * px) / 2;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
      const lx = sx * hx, ly = sy * hy;
      return P({ x: at.x + lx * c - ly * sn, y: at.y + lx * sn + ly * c });
    });
    add(dxfPolyline(LY_KF, corners, true));
    // The centre, because that is what an electrician sets a module out to and a
    // rectangle alone gives nothing to snap to.
    const q = P(at), t = L(0.15);
    add(dxfLine(LY_KF, q.x - t, q.y, q.x + t, q.y));
    add(dxfLine(LY_KF, q.x, q.y - t, q.x, q.y + t));
  };
  const IN = (n) => n / 12;

  // --- room outlines
  for (const r of rooms) {
    const poly = r?.plan?.polygonPx;
    if (!poly?.length) continue;
    add(dxfPolyline(LY_R, poly.map(P), true));
  }

  // --- ceiling objects, less the chandeliers
  for (const o of objects) {
    // A chandelier is a light fitting on a drawing, whatever it is in the
    // planner. Same symbol, different layer.
    if (o.kind === 'chandelier') {
      const c = P({ x: o.x, y: o.y });
      // A CHANDELIER IS A LIGHT FITTING, so it takes the fitting symbol: the
      // ring at the body's real radius with the filled dot at its centre. It had
      // a crosshair for the same wrong reason every other fitting did.
      //
      // THE DOT DOES NOT SCALE WITH THE BODY, though, and that is the one place
      // the 0.42 ratio is wrong. A chandelier's ring is as wide as the fitting
      // actually is — three feet across on a dining pendant — and 0.42 of that
      // is a nine-inch blob of ink that reads as a column, not a lamp. The dot
      // means "this emits"; it is a mark, not a measurement, so it is drawn at
      // a downlight's size and the RING carries the real dimension.
      const rFt = (o.r || 0) / px;
      add(dxfCircle(LY_D, c.x, c.y, L(rFt)));
      add(dxfDisc(LY_D, c, Math.min(L(rFt) * 0.42, L(DOT_MARK_FT))));
      continue;
    }
    if (o.w > 0 && o.h > 0 && (o.kind === 'ac' || o.kind === 'trapdoor')) {
      // Rotated in PIXELS and converted corner by corner. See the header: an
      // angle carried across the Y flip comes out mirrored, four points cannot.
      const c = Math.cos(o.rot || 0), sn = Math.sin(o.rot || 0);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
        const lx = (sx * o.w) / 2, ly = (sy * o.h) / 2;
        return P({ x: o.x + lx * c - ly * sn, y: o.y + lx * sn + ly * c });
      });
      add(dxfPolyline(LY_O, corners, true));
    } else {
      const c = P({ x: o.x, y: o.y });
      const rFt = (o.r || 0) / px;
      add(dxfCircle(LY_O, c.x, c.y, L(rFt)));
      // A CROSS AND NOT A FILLED DOT, and the difference is the point of the
      // layer. A fan is not a lamp: nothing on `ceiling_objects` emits, so
      // nothing on it gets the filled symbol that means "this is a light". The
      // cross stays because a circle alone gives nothing to snap to and the
      // centre is what a fan gets set out from.
      const t = L(0.3);
      add(dxfLine(LY_O, c.x - t, c.y, c.x + t, c.y));
      add(dxfLine(LY_O, c.x, c.y - t, c.x, c.y + t));
    }
  }

  // --- the track profiles: the line the heads are set out along
  //
  // A CLOSED TRACK GOES OUT AS A CLOSED POLYLINE and an open one as an open
  // polyline, which is the same distinction the cove and the strip make one
  // block down and for the same reason: a four-sided track is ONE circuit, cut
  // and cornered on site, and a file that delivered it as four separate lines
  // would leave somebody joining them up by eye — and counting four corner
  // pieces by eye too.
  for (const r of rooms) {
    for (const t of r?.plan?.tracksPx || []) {
      const pts = t.closed
        ? t.runs.map((rn) => rn.a)          // the corners, in order
        : null;
      if (pts) { add(dxfPolyline(LY_K, pts.map(P), true)); continue; }
      for (const rn of t.runs) add(dxfPolyline(LY_K, [rn.a, rn.b].map(P), false));
    }
  }

  // --- spots: the recessed schedule, ambient and aimed alike
  //
  // ...LESS THE ONES A TRACK TOOK. A head clipped into a profile is not part of
  // the recessed schedule — it is not cut into the ceiling at all — so it leaves
  // this layer for the track's own, drawn as its body rather than as a ring.
  for (const r of rooms) {
    for (const l of r?.plan?.lightsPx || []) {
      if (l.track) {
        trackBody(l, IN(TRACK_DIMS_IN.head.len), IN(TRACK_DIMS_IN.head.wide),
                  l.trackAxis === 'v' ? Math.PI / 2 : 0);
        continue;
      }
      const rFt = (l.kind === 'large' ? 0.5 : 0.29)
        * ((l.fixture || l.kind) === 'small-narrow' ? 0.8 : 1);
      marker(LY_S, l, rFt);
      // THE BAR THROUGH A LARGE FITTING, WHICH IS ITS ORIENTATION AND NOT
      // DECORATION. A large fitting sits ON a grid line rather than in a cell,
      // and which line it sits on is the thing the layout decided — so the bar
      // lies along that axis and runs past the ring, exactly as on screen. Drawn
      // from the transformed centre outward along a SCREEN axis and then
      // converted, for the reason at the top of this block: an axis is an angle,
      // and angles do not survive the flip. Vertical on screen is vertical in
      // the file either way, which is why this one is safe to write directly.
      if (l.kind === 'large') {
        const c = P(l), bar = L(rFt * 1.7);
        if (l.axis === 'v') add(dxfLine(LY_S, c.x, c.y - bar, c.x, c.y + bar));
        else add(dxfLine(LY_S, c.x - bar, c.y, c.x + bar, c.y));
      }
    }
  }

  // --- accents: a strip is linear product, a sconce is decorative
  for (const a of accents) {
    if (a.rejected) continue;
    // A REVERSE COVE IS THE SLOT, NOT THE TAPE IN IT — a closed rectangle on
    // its own layer, drawn from the band's four corners so it imports as one
    // thing that can be selected, dimensioned and set out. It went out as a
    // two-point polyline on the strips layer, which is the tape's geometry and
    // says nothing about the eight inches of ceiling that has to be built.
    //
    // The tape is NOT drawn as well. It runs down the middle of a rectangle
    // whose width is the specification; a second line inside the first adds no
    // information and one more thing to snap to by accident.
    if (a.fixture === 'reverse-cove' && a.rect) {
      const { x0, y0, x1, y1 } = a.rect;
      const ring = [{ x: x0, y: y0 }, { x: x1, y: y0 },
                    { x: x1, y: y1 }, { x: x0, y: y1 }].map(P);
      // FILLED, BECAUSE EIGHT INCHES OF CEILING IS AN AREA AND NOT A LINE.
      //
      // An outline alone was the whole of this before, and on a busy sheet it is
      // indistinguishable from the wall it runs beside — four thin lines that
      // could be a bulkhead, a skirting, a change of floor finish, anything. The
      // fill is what says the band IS the detail: this rectangle of ceiling has
      // been given over to lighting.
      //
      // AND THE OUTLINE STAYS ON TOP OF IT. A SOLID has vertices but no edges,
      // so a fill on its own has nothing to snap to and nothing to dimension
      // from — and the lip of the slot is exactly what gets set out on site. So
      // both: the fill to be seen, the closed polyline to be measured.
      add(dxfSolidQuad(LY_C, ring));
      add(dxfPolyline(LY_C, ring, true));
      continue;
    }
    // A strip is its RUN — the two ends are the whole specification, and they
    // are the numbers the derivation existed to produce.
    if (a.run) add(dxfPolyline(LY_T, a.run.map(P), false));
    // A COVE IS ITS PERIMETER, and it closes. Same layer and same product —
    // it is the same tape — but drawn as a closed polyline so the run that
    // comes off this file into a CAD package is one continuous circuit rather
    // than four pieces somebody has to join up by eye.
    else if (a.loop) add(dxfPolyline(LY_T, a.loop.map(P), true));
    // A sconce goes at its wall point, not at the offset the drawing hangs the
    // symbol out to: the mounting position is what gets set out on site.
    else if (a.point) marker(LY_D, a.point, 0.3);
  }

  // --- directional spots, on the same layer as the ambient ones
  //
  // ...AND, LIKE THEM, THE ONES ON A TRACK GO ELSEWHERE. The body is drawn as
  // its rectangle, turned to the aim — which is the one fitting on the drawing
  // whose ROTATION is part of the specification, so exporting it as a ring would
  // throw away the thing an installer has to set.
  for (const sp of spots) {
    if (sp.x == null) continue;
    const onTrack = !!sp.track;
    if (onTrack) {
      trackBody(sp, IN(TRACK_DIMS_IN.spot.len), IN(TRACK_DIMS_IN.spot.wide), sp.angle || 0);
    } else {
      marker(LY_S, sp, 0.3);
    }
    // The tail, pointing at what it lights. Drawn to a fixed length rather than
    // all the way to the surface, which would read as a line to somewhere.
    //
    // ON THE FITTING'S OWN LAYER, whichever that is: the arrow says what this
    // fitting is aimed at, so a person who has switched the recessed schedule
    // off to look at the track keeps the aim of every head they can see.
    const LY_A = onTrack ? LY_KF : LY_S;
    const from = P(sp), to = P(sp.target);
    const dx = to.x - from.x, dy = to.y - from.y;
    const d = Math.hypot(dx, dy) || 1, reach = L(1.2);
    // Clear of the body, which on a track is longer than a ring's radius.
    const start = onTrack ? L(IN(TRACK_DIMS_IN.spot.len) / 2 + 0.05) : L(0.42);
    add(dxfLine(LY_A, from.x + (dx / d) * start, from.y + (dy / d) * start,
                      from.x + (dx / d) * reach, from.y + (dy / d) * reach));
  }

  out = out.concat(['0','ENDSEC','0','EOF']);
  return out.join('\n');
}
