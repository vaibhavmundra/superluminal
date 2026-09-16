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
/* THE FITTING SYMBOLS, SHARED WITH THE PDF PLOTTER AND WITH THE CANVAS — see
   settings.js for the tables and for why 0.29 and 0.5 are no longer written out
   here. A size is the same kind of claim as a position, and the head of
   pdfPlot.js states the property both files exist to keep about those.
   THE OTHER THREE ARE THE SAME KIND OF CLAIM ABOUT A SHAPE. The aim tail's
   length and its head, a sconce's crosshair and a fan's blades were each written
   out in one drawing and not the other, and every one of them had drifted: the
   plot drew an arrow where this drew a bare line, the canvas drew a crosshair
   standing off a wall where this drew a ring on it, and the canvas drew three
   blades at the fan's own sweep where this drew a fixed four-armed plus. */
import { SYMBOL_FT, AIM_FT, SCONCE_FT, FAN_FT } from './settings.js';
/* THE ELECTRICAL DRAWING'S OWN GEOMETRY, BORROWED WHOLE. Three shapes reach
   this file from where they are decided rather than being restated in it: a
   point's J (the canvas draws the same curve), a wire flattened into points
   (the canvas strokes the same path), and the lead from a wall unit to its
   socket (the canvas draws the same two ends). Every one of them is the kind of
   claim the note above is about — a shape written out in one drawing and not
   the other drifts, and every one that ever was written out twice here had. */
import { glyphJPoints } from './elecPoints.js';
import { flowWires, feedTicks, WIRE_TICK_FT } from './flows.js';
import { acLead } from './wallUnit.js';
/* WHICH CEILING OBJECTS ARE A RECTANGLE, from the catalogue rather than from a
   chain of `||` here. See `isRect` — the chain this file used to carry named
   two kinds, the catalogue has four, and the split unit was the one it missed. */
import { isRect } from './ceilingObjects.js';

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
    zones: (plan.zonesPx || []).map((z) => ({ ...rect(z),
      ...(z.polygon?.length ? { polygon: z.polygon.map(f) } : {}) })),
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
        ...(z.polygon?.length ? { polygon: z.polygon.map((p) => ({
          x: +p.x.toFixed(3), y: +p.y.toFixed(3),
        })) } : {}),
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

/**
 * The canvas as SVG markup.
 *
 * `asScanned` — DOES THE PLAN GO OUT AS SCANNED, OR AS IT IS ON SCREEN?
 *
 * It used to be neither a question nor an option: the plan always went out as
 * scanned, on the reasoning that a pixel-inverted copy is a way of LOOKING at a
 * drawing rather than a change to it, and nobody wants a negative on a sheet.
 * Half right. It is the correct default for anything the app generates for its
 * own purposes — a card thumbnail is a picture OF a plan and should look the
 * same whichever view somebody happened to leave it in.
 *
 * It is the wrong answer for an EXPORT. Night view is a deliverable in its own
 * right — a dark sheet with the fittings glowing on it is how a lighting scheme
 * gets presented — and an export that silently hands back the day version is
 * the app overruling a choice the user made on screen and can see.
 *
 * So the callers decide. `true` keeps the old behaviour, which is why it is the
 * default; the PNG and PDF exports pass the live view. The element carries both
 * images — see `srcAsScanned` in PlanCanvas — so this is a swap of one
 * attribute either way and never a re-render.
 */
export function svgString(svgEl, { asScanned = true } = {}) {
  const clone = svgEl.cloneNode(true);
  for (const im of clone.querySelectorAll('[data-src-as-scanned]')) {
    if (asScanned) im.setAttribute('href', im.getAttribute('data-src-as-scanned'));
    // The attribute goes either way: it is a channel between this app's canvas
    // and this function, and a file that carries it is a file with a second copy
    // of the whole plan base64'd into it for no reader's benefit.
    im.removeAttribute('data-src-as-scanned');
  }
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}

/**
 * The canvas as a PNG.
 *
 * `ground` IS NOT OPTIONAL DECORATION. The SVG paints no background — on screen
 * the ground is the wrapper's, white in day view and the page's black in night —
 * so a canvas filled white and then handed an inverted plan is a dark drawing
 * floating on a white page, which is neither view. The caller passes the ground
 * that goes with the plan it asked for, and `asScanned` and `ground` are
 * therefore two halves of one decision.
 */
export async function svgToPNG(svgEl, width, { asScanned = true, ground = '#fff' } = {}) {
  const str = svgString(svgEl, { asScanned });
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
  ctx.fillStyle = ground; ctx.fillRect(0, 0, cv.width, cv.height);
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

/**
 * `ltype` IS AN ENTITY-LEVEL OVERRIDE, AND IT IS FOR ONE CASE ONLY.
 *
 * Every linetype in this file is set on the LAYER, for the reason SL_LINETYPE
 * gives: a layer that carries its own pattern survives being copied into another
 * drawing, where a per-entity override is the first thing a layer standard
 * strips out. The exception is a mark that is SHORTER THAN THE PATTERN ITS
 * LAYER carries — a wire's feed tick is three inches of line on a layer dashed
 * at eight — which lands in a gap as often as not and simply is not in the
 * drawing. A tick that is sometimes there is worse than no tick.
 */
function dxfLine(layer, x1, y1, x2, y2, ltype = null) {
  return ['0','LINE','8',layer,
          ...(ltype ? ['6',ltype] : []),
          '10',x1.toFixed(4),'20',y1.toFixed(4),'30','0.0',
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
  /* --- AND THE ELECTRICAL DRAWING, WHICH WAS NOT IN THIS FILE AT ALL -------
     NOT ONE MARK OF IT REACHED EITHER EXPORT. Every plate, every socket outlet,
     every wall and ceiling point, every air-conditioner's supply and lead, and
     every switched loop on the drawing existed only on screen: `plotArgs` and
     `dxfArgs` carried no electrical list of any kind, so a plan whose whole
     second half is a wiring layout exported as a lighting drawing with the
     wiring silently missing.
     FIVE LAYERS AND NOT ONE, BY THE TRADE RULE THIS LIST IS BUILT ON — and here
     the rule is sharper than usual, because the app itself already makes the
     cut. `switchboards` and `electrical` are two switches on the View menu:
     plates and points are WHERE THE SWITCHES AND THE OUTLETS GO, which a joiner
     and a tiler both need and neither wants a wire over; the loops are WHAT IS
     SWITCHED FROM WHERE, which is the wireman's own drawing. Somebody setting
     out a wall wants the first without the second.
     AND THE WIRES ARE THREE LAYERS BECAUSE THEY ARE THREE STATEMENTS. The feed
     leg answers "which plate switches this" — the question the layer exists for
     — the chain says "and on to the next lamp in this row", and a two-way's
     second feed leaves a DIFFERENT plate and is not part of that loop's circuit
     at all. The canvas paints those three in three colours for exactly that
     reason (see SB_COLOUR, WIRE_CHAIN and WIRE_TWO_WAY in flows.js); in a
     drawing the colour and the pattern both live on the layer, so the split
     that carries them IS the layer split. */
  switchboards: 'superluminal_switchboards',
  points: 'superluminal_points',
  wireFeed: 'superluminal_wire_feed',
  wireChain: 'superluminal_wire_chain',
  wireTwoWay: 'superluminal_wire_two_way',
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
  /* THE ELECTRICAL FOUR, AND THEY ARE THE SCREEN'S OWN COLOURS AT THE NEAREST
     INDEX R12 CAN NAME. A drawing before AutoCAD 2004 has no true colour: there
     is a table of 256 and an entity picks one. So #2563EB — the plate's blue,
     and the wire's — is 160, #8A8A8A is 8 (which is that grey exactly), and
     #D946EF is 200. A reader who has seen the sheet finds the same layer by the
     same colour, which is the whole job.
     THE FEED AND THE PLATE SHARE 160 ON PURPOSE, and it is the one place in this
     table where two layers are deliberately one colour. The canvas states the
     reason: "the wire and the plate are one object: the line means 'these
     fittings come on from that board', and it says so by being drawn in the
     board's colour." Giving the feed a hue of its own would break that sentence
     to satisfy a rule about telling layers apart — and the layers are already
     told apart, by name and by being switchable. */
  switchboards: 160, // blue — the plate's own
  points: 150,       // azure — a plate's neighbour, and not a plate
  wireFeed: 160,     // the plate's blue again; see above
  wireChain: 8,      // grey — the run between fittings
  wireTwoWay: 200,   // magenta — the second plate a switch is reached from
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
const SL_LINETYPE = {
  strips: 'DOTTED',
  /* A WIRE IS DASHED, AND THE TWO KINDS DASH DIFFERENTLY — which is the half of
     "in their respective colours and line types" that survives being printed in
     black. On screen the feed and the chain are told apart by colour AND by
     weight; R12 has no lineweight at all (`370` is an AC1015 group code), so
     weight has to be carried by the PATTERN. The feed is mostly ink and reads
     heavy, the chain is mostly air and reads light — the same hierarchy, said
     with the only two things this dialect has.
     THE TWO-WAY TAKES THE FEED'S PATTERN because it IS a feed: it is the same
     wire doing the same job from a second plate, and a lighter one would read as
     a lesser connection. What tells it apart is the colour, which is exactly
     what the canvas does. */
  wireFeed: 'WIRE',
  wireChain: 'WIRECHAIN',
  wireTwoWay: 'WIRE',
};

// The dot and the gap, IN FEET, converted to the drawing's units at write time
// so the pattern is the same size on a plan drawn in millimetres and one drawn
// in metres. $LTSCALE stays at 1: scaling a pattern that is already correct is
// how a dotted line ends up looking solid in somebody else's drawing, because
// LTSCALE is a document setting they may well have their own value for.
const DOT_FT = 0.05;   // ~15 mm of ink
const GAP_FT = 0.10;   // ~30 mm of air

// The wire patterns, in feet, for the same reason and converted at the same
// point. A feed is 67 mm of ink to 34 mm of air; a chain is 24 to 49. Longer
// than the strip's dot on purpose: a wire crosses the whole drawing and a
// pattern as fine as the tape's would read as the tape at any sensible scale.
const WIRE_DASH_FT = 0.22, WIRE_DASH_GAP_FT = 0.11;
const CHAIN_DASH_FT = 0.08, CHAIN_GAP_FT = 0.16;

// The filled centre dot on a fitting whose BODY is large — a chandelier, a
// pendant. A downlight's dot is 0.42 of its own ring, and this is that fraction
// held still so a big fitting does not get a big blob. See the chandelier branch.
const DOT_MARK_FT = SYMBOL_FT.small * 0.42;

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
    '0','TABLE','2','LTYPE','70','4',
    ...slLtype('CONTINUOUS', 'Solid line', []),
    ...slLtype('DOTTED', 'Dotted . . . . . . . . . . . . . . . . . .',
               [DOT_FT * duPerFt, -GAP_FT * duPerFt]),
    ...slLtype('WIRE', 'Wire __ __ __ __ __ __ __ __ __ __ __ __ __',
               [WIRE_DASH_FT * duPerFt, -WIRE_DASH_GAP_FT * duPerFt]),
    ...slLtype('WIRECHAIN', 'Wire, chain _ _ _ _ _ _ _ _ _ _ _ _ _ _ _',
               [CHAIN_DASH_FT * duPerFt, -CHAIN_GAP_FT * duPerFt]),
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
                                    spots = [],
                                    /* THE MAGNETIC TRACK AND ITS MODULES, which
                                       this file had no parameter for — see the
                                       block that draws them for what was
                                       missing. Already in plan pixels, the
                                       contract every list here arrives under. */
                                    tracks = [], trackModules = [],
                                    /* THE LAMPS A HAND PUT DOWN, AND THIS FILE
                                       HAD NO PARAMETER FOR THEM EITHER — the
                                       same gap the magnetic track had, one
                                       population later. See the block that
                                       draws them. Already in plan pixels. */
                                    cobs = [],
                                    /* --- AND THE ELECTRICAL DRAWING ---------
                                       THE WHOLE OF IT, AND NONE OF IT WAS HERE.
                                       See the note on the five new layers in
                                       SUPERLUMINAL_LAYERS for what was missing
                                       and why it is split the way it is.
                                       `switchboards` IS EVERY PLATE ON THE JOB
                                       AND NOT THE DRAWING'S LIST. `switchboardsPx`
                                       drops the bay plates while the wiring layer
                                       is off, correctly, because a sheet is a
                                       picture; a file is not, and withholding a
                                       plate from something somebody imports to
                                       work from would be this app deciding what
                                       another trade may see. Same argument the
                                       header already makes about `layers`.
                                       ALL THREE ARE `*Px` PROJECTIONS, the
                                       contract every list here arrives under. The
                                       stores hold FEET and fractions of a wall —
                                       a plate's position is a `u` and a point's
                                       is an `xFt` — so a store handed in draws
                                       nothing at all and says nothing about it. */
                                    switchboards = [], elecPoints = [],
                                    flows = [] } = {}) {
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
          trackFixtures: LY_KF, switchboards: LY_SB, points: LY_EP,
          wireFeed: LY_WF, wireChain: LY_WC, wireTwoWay: LY_W2 } = SUPERLUMINAL_LAYERS;
  /** Which layer a run of wire belongs on. @see flowWires for the three kinds. */
  const wireLayer = (kind) =>
    (kind === 'two' ? LY_W2 : kind === 'chain' ? LY_WC : LY_WF);

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
  /**
   * A WALL SCONCE: THE CROSSHAIR STANDING OFF ITS WALL.
   *
   * IT WAS A RING AT THE WALL POINT, AND BOTH HALVES OF THAT WERE WRONG.
   *
   * THE RING, because a circle on these drawings is a hole in a ceiling. A
   * sconce is not one: it is fixed to a vertical surface and hangs in the room,
   * and a ring says nothing about which surface it is on. On a plan the mark
   * landed exactly on the room outline, so what arrived in CAD was a circle
   * sitting astride a wall line — which reads as a core through the wall.
   *
   * THE POSITION, because "the mounting position is what gets set out on site"
   * is true and is what the STEM is for. The stem touches the wall at the
   * mounting point and the body stands off into the room, so the file gives the
   * setting-out point AND says which side of the wall the fitting is on. A
   * symbol centred on the line would be drawn half inside the wall — and on an
   * external wall, half in next door.
   *
   * THE SAME GEOMETRY THE CANVAS DRAWS, part for part: the ring at `r`, the
   * centre standing off by `stand` along the wall's inward normal, the stem
   * running from the wall through the ring and out the far side by `arm`, and
   * the cross bar of the same length lying ALONG the wall. See `SG` in
   * PlanCanvas and SCONCE_FT in settings.js, which is the one place those four
   * figures live.
   *
   * BUILT IN PIXELS AND CONVERTED POINT BY POINT, for the reason the header
   * gives: `inward` and `along` are directions, and a direction carried across
   * the Y flip as a number comes out mirrored — which would put every sconce on
   * the wrong side of its own wall.
   *
   * A SCONCE WITH NO WALL BEHIND IT FALLS BACK TO THE RING. `inward` comes off
   * the placer and every sconce this app makes has one (see placeZone), but a
   * plan saved before it did would otherwise export nothing at all, and a
   * fitting missing from the file is worse than a fitting drawn as a ring.
   */
  const sconce = (a) => {
    const r = SCONCE_FT.r * px;                       // the ring, in plan pixels
    const ix = a.inward?.x, iy = a.inward?.y;
    if (!Number.isFinite(ix) || !Number.isFinite(iy)) {
      marker(LY_D, a.point, SCONCE_FT.r);
      return;
    }
    // ALONG THE WALL, and derived from the normal when the placer did not say:
    // the left normal of `inward` is the wall's own direction either way.
    const ux = a.along?.x ?? -iy, uy = a.along?.y ?? ix;
    const stand = r * SCONCE_FT.stand, arm = r * SCONCE_FT.arm;
    const cx = a.point.x + ix * stand, cy = a.point.y + iy * stand;
    const c = P({ x: cx, y: cy });
    add(dxfCircle(LY_D, c.x, c.y, L(SCONCE_FT.r)));
    // The stem: from the mounting point on the wall, through the ring, out the
    // far side. One line, so the wall point stays snappable.
    const tail = P({ x: cx + ix * arm, y: cy + iy * arm });
    const foot = P(a.point);
    add(dxfLine(LY_D, foot.x, foot.y, tail.x, tail.y));
    // The cross bar, lying along the wall.
    const b0 = P({ x: cx - ux * arm, y: cy - uy * arm });
    const b1 = P({ x: cx + ux * arm, y: cy + uy * arm });
    add(dxfLine(LY_D, b0.x, b0.y, b1.x, b1.y));
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
    /* --- A STANDING LAMP IS A LIGHT FITTING TOO, AND ON THE SAME LAYER -----
       `decorative` FOR THE CHANDELIER'S REASON. It is a chosen fitting whose
       lamping is not ours, it is not part of the ceiling grid, and it is
       emphatically not a `ceiling_object`: nothing on that layer emits and this
       does. Without this branch it fell to the `else` below and left the
       drawing with a lamp filed as an obstruction, drawn as a fan.
       THE SYMBOL IS THE SCREEN'S, part for part — see the standing-lamp branch
       in PlanCanvas. The shade at its real radius, four strokes off the
       DIAGONALS, and a small ring with a cross in it for the lamp. The diagonals
       are what tell it from a pendant on a printed sheet, where both are
       otherwise one circle; the inner ring with the cross is the trade's own
       mark for a lamp holder and does the job the chandelier's filled dot does.
       NO FILLED DISC, DELIBERATELY. A solid blob and an open ring with a cross
       both mean "this emits", and the ring is the one that survives being
       plotted at a sensible line weight inside a 450mm circle. The chandelier
       keeps its dot because its body is three feet across and has room for one.
       THE RADII ARE THE SCREEN'S FRACTIONS OF `R0`, which is the body radius
       here as it is there, so the two drawings cannot come apart without
       somebody editing both. */
    if (o.kind === 'standing_lamp') {
      const c = P({ x: o.x, y: o.y });
      const rFt = (o.r || 0) / px;
      const R = L(rFt);
      add(dxfCircle(LY_D, c.x, c.y, R * 0.86));
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2 + Math.PI / 4;
        const ux = Math.cos(a), uy = Math.sin(a);
        add(dxfLine(LY_D, c.x + ux * R * 0.58, c.y + uy * R * 0.58,
                          c.x + ux * R * 1.34, c.y + uy * R * 1.34));
      }
      const ri = R * 0.34;
      add(dxfCircle(LY_D, c.x, c.y, ri));
      for (let k = 0; k < 2; k++) {
        const a = Math.PI / 4 + (k * Math.PI) / 2;
        const ux = Math.cos(a) * ri, uy = Math.sin(a) * ri;
        add(dxfLine(LY_D, c.x - ux, c.y - uy, c.x + ux, c.y + uy));
      }
      continue;
    }
    /* --- A SPLIT UNIT IS A RECTANGLE, AND IT WAS COMING OUT AS A CIRCLE ----
       THE TEST WAS A CHAIN OF TWO KINDS — `'ac' || 'trapdoor'` — AND THE
       CATALOGUE HAS FOUR. A split AC failed it, fell to the round branch below,
       and exported as a circle at whatever `r` the projection had given it,
       which for a rectangle is half its DIAGONAL: a 1000 x 250 mm unit arrived
       in CAD as a 1.7 ft circle with a centre mark in it, and the rectangle that
       is the whole of what a split unit looks like in plan was never drawn at
       all. ceilingObjects.js anticipated this exactly — see the note over
       `isRect`, which says a chain "will one day be missing the newest entry,
       and the symptom of that is an object drawn as a circle whose width and
       height are the only sizes it has". So the catalogue is asked. */
    if (o.w > 0 && o.h > 0 && isRect(o)) {
      // Rotated in PIXELS and converted corner by corner. See the header: an
      // angle carried across the Y flip comes out mirrored, four points cannot.
      const c = Math.cos(o.rot || 0), sn = Math.sin(o.rot || 0);
      const at = (lx, ly) => P({ x: o.x + lx * c - ly * sn, y: o.y + lx * sn + ly * c });
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) =>
        at((sx * o.w) / 2, (sy * o.h) / 2));
      add(dxfPolyline(LY_O, corners, true));
      /* --- AND THE LOUVRES, WHICH ARE WHAT MAKE IT A SPLIT UNIT -------------
         A LONG THIN RECTANGLE IS NOT A SYMBOL. On its own it is indistinguishable
         from a duct, a beam, a bulkhead or a shelf — this drawing carries all
         four — and the reader has no way to tell that the one thing on that wall
         needing a dedicated circuit is there at all. Three lines across the
         width say "grille", and they run the LENGTH of the unit because that is
         how the blades sit. The canvas draws exactly these three; see the
         split-unit branch in PlanCanvas.
         INSET FROM THE ENDS by a quarter of the depth, so the louvres read as
         being inside the casing rather than as the casing's own subdivision. */
      if (o.kind === 'split_ac') {
        const inset = o.h * 0.25;
        for (const k of [-1, 0, 1]) {
          const a = at(-o.w / 2 + inset, (o.h / 5) * k);
          const b = at(o.w / 2 - inset, (o.h / 5) * k);
          add(dxfLine(LY_O, a.x, a.y, b.x, b.y));
        }
      }
    } else if (o.kind === 'geyser') {
      /* --- THE CYLINDER SEEN FROM ABOVE, AND ITS PIPEWORK ------------------
         IT WAS THE GENERIC ROUND MARK — a circle with a crosshair, the same mark
         a cassette's centre gets — and a plain circle on a ceiling plan is a fan
         with its blades missing. A geyser is not notation: it is a tank, it is
         plumbing, and it is the second of the two things on this drawing that
         needs a dedicated circuit at a stated height.
         THE SAME THREE MARKS THE CANVAS DRAWS: the casing, the tank inside it,
         and the stub that says which side the pipework comes off — which is the
         half of the symbol that says this is plumbing rather than a light.
         THE OUTER RING IS THE BODY'S REAL RADIUS, where the canvas insets it a
         little. That is this file's rule everywhere — the ring carries the
         dimension, so a geyser can be measured off the drawing — and the inner
         ring keeps the screen's own fraction of it.
         THE STUB IS BUILT IN PIXELS AND CONVERTED, like every other direction
         here: "up the sheet" is a direction, and a direction carried across the
         Y flip as a number comes out mirrored. */
      const c = P({ x: o.x, y: o.y });
      const rPx = o.r || 0, rFt = rPx / px;
      add(dxfCircle(LY_O, c.x, c.y, L(rFt)));
      add(dxfCircle(LY_O, c.x, c.y, L(rFt) * 0.5));
      const a = P({ x: o.x, y: o.y - rPx });
      const b = P({ x: o.x, y: o.y - rPx * 1.35 });
      add(dxfLine(LY_O, a.x, a.y, b.x, b.y));
    } else {
      const c = P({ x: o.x, y: o.y });
      const rFt = (o.r || 0) / px;
      add(dxfCircle(LY_O, c.x, c.y, L(rFt)));
      /* --- A FAN IS ITS BLADES, AND THE BLADES ARE THREE ------------------
         A CROSS WAS THE WRONG MARK, AND IT WAS WRONG TWICE. Four arms at
         ninety degrees inside a circle is the drawing convention for a CENTRE
         MARK — what a setting-out drawing puts on a hole to be cored — so a
         ceiling of fans read as coring information; and it was drawn at a flat
         0.3 ft whatever the fan's sweep, so a 1200mm fan and a 900mm one came
         out as the same small plus inside two different circles, with the one
         dimension anybody scales off the drawing carried by the circle alone.
         THREE SPOKES AT 120, AT THE FAN'S OWN SWEEP. It is the symbol on
         screen, part for part — see the fan's branch in PlanCanvas, which
         draws the same count, the same phase and the same 0.94 of the body
         radius — and it is what the object IS, which is the test every mark in
         this file is held to.
         IN PIXELS AND THEN CONVERTED, like every other angle on this sheet.
         See the header: a spoke is a direction, and a direction carried across
         the Y flip as a number comes out mirrored. Three endpoints cannot.
         STILL NOT FILLED, which is the rule the cross was keeping and the one
         thing worth carrying over: nothing on `ceiling_objects` emits, so
         nothing on it gets the solid mark that means "this is a light". The
         spokes meet at the centre, so the fan still has the point an installer
         sets it out from. */
      if (o.kind === 'fan') {
        for (let k = 0; k < FAN_FT.spokes; k++) {
          const a = (k * 2 * Math.PI) / FAN_FT.spokes + FAN_FT.phase;
          const tip = P({ x: o.x + Math.cos(a) * (o.r || 0) * FAN_FT.spoke,
                          y: o.y + Math.sin(a) * (o.r || 0) * FAN_FT.spoke });
          add(dxfLine(LY_O, c.x, c.y, tip.x, tip.y));
        }
      } else {
        // Everything else round on this layer — a geyser, a split unit — keeps
        // the crosshair: a circle alone gives nothing to snap to, and the centre
        // is what the object gets set out from.
        const t = L(0.3);
        add(dxfLine(LY_O, c.x - t, c.y, c.x + t, c.y));
        add(dxfLine(LY_O, c.x, c.y - t, c.x, c.y + t));
      }
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

  /* --- A COVE'S SETTING-OUT LINE, WHICH IS THE CEILING CONTRACTOR'S ---------
     A COVE IS TWO LINES AND THE FILE ONLY CARRIED ONE. `plan.covesPx` is the
     pocket a cove is formed in — set out, boarded and skimmed weeks before the
     tape that goes in it arrives — and only the tape was being exported, so a
     coved ceiling imported as a dotted rectangle floating in a room with nothing
     to say what builds it.
     ON THE CEILING CONTRACTOR'S LAYER, which is the one the reverse cove already
     uses. The trade rule is this list's whole principle and it gives one answer
     here: a cove's pocket and a reverse cove's slot are the same scope, the same
     programme and the same person's drawing. The layer's NAME is narrower than
     what it now holds — renaming it would change what every plan already issued
     imports as, which is a worse cost than a name that reads as the smaller of
     two cases. See SUPERLUMINAL_LAYERS.
     DOTTED, LIKE THE TAPE, because it comes off that layer's linetype — and it
     should: a pocket is a thing you cannot see once the ceiling is closed. */
  for (const r of rooms) {
    for (const cv of r?.plan?.covesPx || []) {
      if (cv?.line?.length >= 3) add(dxfPolyline(LY_C, cv.line.map(P), true));
    }
  }

  /* --- THE MAGNETIC TRACK SOMEBODY DREW, AND WHAT IS CLIPPED ONTO IT --------
     THE SAME GAP THE PDF HAD, and for the same reason: the two exporters were
     given the engine's layout and nothing for the fittings a hand put down.
     `plan.tracksPx` above is the ABSORBING track — what the ceiling design made
     of a chunk — and this is a profile a person drew with modules they clipped
     on, which survives every re-grid.
     THE CARRIER AND THE HEADS ON THEIR TWO LAYERS, which is the split this file
     already states: the profile is set out and fixed by one visit, the modules
     are clipped in on another and are a different order from a different page of
     the catalogue. */
  for (const t of tracks) {
    if (!(t?.pts?.length >= 2)) continue;
    add(dxfPolyline(LY_K, t.pts.map(P), !!t.closed));
  }
  for (const m of trackModules) {
    if (!Number.isFinite(m?.x) || !Number.isFinite(m?.y)) continue;
    /* A DIFFUSER IS A BODY AND AN AIMED HEAD IS A RING, which is the same split
       the plotted sheet makes: a diffuser is 200 to 600 mm of extrusion lying
       along the rail and measurable off the drawing, and a track spot is the
       same fitting as a recessed COB with the ceiling taken away.
       `trackBody` TAKES AN ANGLE and the module carries a VECTOR, because a
       drawn track is not rectilinear and 'h' or 'v' cannot describe a diagonal.
       It is converted here rather than stored, so the one place that knows how
       an angle survives the Y flip stays `trackBody`. */
    if (m.kind === 'diffuser') {
      trackBody(m, IN(m.lenIn ?? TRACK_DIMS_IN.head.len),
                   IN(m.wideIn ?? TRACK_DIMS_IN.head.wide),
                   Math.atan2(m.uy ?? 0, m.ux ?? 1));
      continue;
    }
    marker(LY_KF, m, SYMBOL_FT.cob);
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
      const rFt = (l.kind === 'large' ? SYMBOL_FT.large : SYMBOL_FT.small)
        * ((l.fixture || l.kind) === 'small-narrow' ? SYMBOL_FT.narrow : 1);
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

  /* --- AND THE RECESSED LAMPS SOMEBODY PLACED ONE AT A TIME ---------------
     THEY WERE NOT IN THE FILE AT ALL. `plan.lightsPx` above is the LAYOUT —
     what the gridding engine made of a ceiling, thrown away and rebuilt every
     time a fan moves — and a lamp placed by hand is deliberately not in it (see
     the `manualCobs` prop in PlanCanvas and the header of lib/cob.js). So a
     ceiling laid out entirely by hand, which is what this app recommends for the
     cases the solver is wrong about, exported as a room outline with nothing in
     it. The plotted sheet has drawn them from the beginning; only the DXF was
     short, which is the drift the shared argument object exists to close.
     ON `spots`, WITH THE ENGINE'S OWN. A hand-placed COB is a recessed downlight
     — the same trim, the same cut-out, the same line on the schedule — and what
     differs is who chose where it went, which is not a fact about the ceiling.
     Splitting them onto a layer of their own would ask an electrician to switch
     two layers on to see one schedule.
     A DRAFT IS NOT A FITTING. The array bar's preview rides in the canvas's list
     so that what you watch move is what the tick will keep; nothing is placed
     until it is ticked, and a file carrying the preview would bill a run nobody
     committed to. Same gate as the plot's. */
  for (const c of cobs) {
    if (c?.draft || !Number.isFinite(c?.x) || !Number.isFinite(c?.y)) continue;
    marker(LY_S, c, SYMBOL_FT.cob);
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
    if (a.fixture === 'reverse-cove' && (a.band || a.rect)) {
      const ring = (a.band ?? (() => {
        const { x0, y0, x1, y1 } = a.rect;
        return [{ x: x0, y: y0 }, { x: x1, y: y0 },
                { x: x1, y: y1 }, { x: x0, y: y1 }];
      })()).map(P);
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
    // A sconce: the crosshair standing off its wall, exactly as on screen.
    else if (a.point) sconce(a);
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
      marker(LY_S, sp, SYMBOL_FT.spot);
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
    const d = Math.hypot(dx, dy) || 1, reach = L(AIM_FT.reach);
    // Clear of the body, which on a track is longer than a ring's radius.
    const start = onTrack
      ? L(IN(TRACK_DIMS_IN.spot.len) / 2 + 0.05) : L(AIM_FT.start);
    const ux = dx / d, uy = dy / d;
    const tip = { x: from.x + ux * reach, y: from.y + uy * reach };
    add(dxfLine(LY_A, from.x + ux * start, from.y + uy * start, tip.x, tip.y));
    /* --- AND A HEAD ON IT, WHICH IS WHAT MAKES IT AN ARROW ----------------
       IT WENT OUT AS A BARE LINE. A shaft with nothing on the end of it is not
       an arrow — it is a leader, or a setting-out line, or a wire — and on the
       one fitting whose ROTATION is part of its specification the drawing was
       therefore silent about the only thing it was drawn to say: a spot aimed
       at the wall and a spot aimed away from it came out as the same mark.
       THE SAME HEAD THE PLOTTED SHEET DRAWS, off the same two fractions — see
       AIM_FT in settings.js and the block that builds it in pdfPlot.js. A PDF
       and a DXF of one plan that disagreed about a fitting would be worse than
       either being wrong, and an arrow on one and a line on the other is the
       largest disagreement of that kind this drawing had.
       SIZED OFF THE FIXED STANDOFF AND NOT OFF THE BODY, so every arrow on the
       sheet carries the same head: the tail is an ANNOTATION — it says what the
       fitting is for — and scaling it to a six-inch track spot would shrink the
       one mark whose whole job is to be noticed. Same argument as the canvas's.
       FILLED, FOR THE REASON THE PLOT GIVES: at hairline weight an open V
       disappears, and a solid head is what reads. A SOLID is the only primitive
       in R12 that arrives with ink inside it — see dxfSolidTri.
       BUILT FROM THE TRANSFORMED DIRECTION, which is safe here and nowhere else
       in this file: both ends of the shaft are already transformed points, so
       the direction between them is the drawing's own, and a triangle symmetric
       about that direction cannot be mirrored by a flip that has happened. */
    const head = L(AIM_FT.start * AIM_FT.headFrac);
    const half = head * AIM_FT.headWideFrac;
    const nx = -uy, ny = ux;                       // the aim's left normal
    const back = { x: tip.x - ux * head, y: tip.y - uy * head };
    add(dxfSolidTri(LY_A, tip,
      { x: back.x + nx * half, y: back.y + ny * half },
      { x: back.x - nx * half, y: back.y - ny * half }));
  }

  /* --- THE ELECTRICAL DRAWING ---------------------------------------------
     LAST, SO IT SITS OVER THE LIGHTING. Entity order is paint order in most
     readers, and the wiring is the layer you switch ON to read over a layout you
     already have — the canvas stacks it the same way and for the same reason.

     --- THE PLATES, AS THE RECTANGLES THEY ARE ----------------------------
     A FILLED POLYGON AND NOT A SYMBOL, which is the canvas's own argument
     verbatim: everything else on this drawing is a light and is drawn as one —
     a ring, a run, a crosshair — and the board is not a light. It is the thing
     that turns them on, it is a real plate of a real size (230 x 80 mm, see
     SB_MM), and it is drawn at that size, in plan, like a piece of the building
     rather than a piece of notation.
     FILL AND OUTLINE BOTH, for the reverse cove's reason: a SOLID has vertices
     and no edges, so a fill on its own has nothing to snap to and nothing to
     dimension from — and where a plate goes on a wall is exactly what gets set
     out. The fill to be seen, the closed polyline to be measured.
     BUILT FROM THE PLATE'S OWN AXES rather than from a rotation. The placement
     pass returns the wall's `along` and `inward` with the point, so the four
     corners are already in hand; re-deriving a rotation and its sign from
     vectors that already say it is how a plate ends up inside its own wall.
     A SOCKET OUTLET IS THE SAME RECTANGLE ON THE SAME LAYER, because it is the
     same plate — a board somebody converted, which has an outlet on it and no
     switch. The canvas draws them identically and this file's standard is that
     it is a copy of the canvas; what tells them apart is the schedule, which is
     where the module list lives. */
  const plateRing = (b) => {
    const half = (b?.alongPx ?? 0) / 2, deep = b?.deepPx ?? 0;
    const u = b?.along, n = b?.inward, q = b?.point;
    if (!(half > 0) || !u || !n || !Number.isFinite(q?.x)) return null;
    const at = (a, d) => ({ x: q.x + u.x * a + n.x * d, y: q.y + u.y * a + n.y * d });
    return [at(-half, 0), at(half, 0), at(half, deep), at(-half, deep)];
  };
  for (const b of switchboards) {
    const ring = plateRing(b)?.map(P);
    if (!ring) continue;
    add(dxfSolidQuad(LY_SB, ring));
    add(dxfPolyline(LY_SB, ring, true));
  }

  /* --- THE POINTS: THE SCONCE'S MARK, WITH A J IN IT ----------------------
     THE TRADE'S OWN SYMBOL for "a cable ends here, switched". A WALL point is
     drawn exactly as a wall sconce is — a stem off the plaster to a circle
     standing in the room — because it is the same kind of thing on the same kind
     of wall; a CEILING point is the circle and the J alone, because there is no
     plaster to stand off and a leader drawn to the nearest wall would be
     claiming something about the plan that is not true.
     THE PROPORTIONS ARE `SCONCE_FT`'s AND THE GLYPH IS `glyphJ`'s, both read
     rather than restated — see POINT_FT, and `glyphJPoints`, which is that same
     curve evaluated because neither this dialect nor a plotted sheet can stroke
     a path. The sconce a dozen lines up is drawn from the same three numbers.
     THE CIRCLE IS WHERE THE PROJECTION PUT IT. `x`/`y` on a resolved point is
     the CIRCLE, already stood off the wall, and `foot` is where the stem meets
     the plaster — so the stem is drawn between two positions this file is handed
     rather than derived from an `inward` it would have to carry across the flip.
     THE STEM STOPS AT THE CIRCLE, as on screen: a line through the symbol would
     cross the J and turn the mark to mush at any scale where the two are close. */
  for (const w of elecPoints) {
    if (!Number.isFinite(w?.x) || !Number.isFinite(w?.y) || !(w.r > 0)) continue;
    const c = P({ x: w.x, y: w.y });
    add(dxfCircle(LY_EP, c.x, c.y, L(w.r / px)));
    add(dxfPolyline(LY_EP, glyphJPoints(w.x, w.y, w.r).map(P), false));
    if (Number.isFinite(w.foot?.x) && Number.isFinite(w.foot?.y)) {
      const dx = w.x - w.foot.x, dy = w.y - w.foot.y;
      const d = Math.hypot(dx, dy) || 1;
      const a = P(w.foot);
      const b = P({ x: w.x - (dx / d) * w.r, y: w.y - (dy / d) * w.r });
      add(dxfLine(LY_EP, a.x, a.y, b.x, b.y));
    }
  }

  /* --- THE LEAD FROM A WALL UNIT TO ITS SOCKET ----------------------------
     AN AIR-CONDITIONER IS PLUGGED IN, and this is the flex that does it.
     Without it the unit and the socket a foot away are two marks that happen to
     be near each other; the line is what says the second one is THERE BECAUSE OF
     the first, which is the whole reason the socket was put where it was put.
     ONLY FOR A SOCKET FEED, and `acLead` is the one that knows: a POINT feed is
     centred behind the body, so the lead would be a line from the unit to
     itself. That is not an omission — a point is a cable coming out of the
     plaster the unit covers, and the absence of any visible connection is the
     honest picture of it.
     ON THE FEED'S LAYER, in the plate's blue, because that is what it is: a live
     supply between a socket and the thing plugged into it. */
  for (const o of objects) {
    if (!o?.onWall) continue;
    const leg = acLead(o, switchboards.find((b) => b?.acId && b.acId === o.id));
    if (!leg) continue;
    const a = P(leg.from), b = P(leg.to);
    add(dxfLine(LY_WF, a.x, a.y, b.x, b.y));
  }

  /* --- AND THE LOOPS ------------------------------------------------------
     EVERY FLOW'S WIRE, BOARD FIRST. See flows.js for what a flow is; this only
     draws it, and it draws it from the same points the canvas strokes — see
     `flowWires`, which flattens one curve rather than letting two files each
     approximate it.
     THREE LAYERS, ONE PER KIND OF LEG, which is where the colour and the pattern
     come from: they are set on the LAYER, so a file copied into somebody else's
     drawing keeps them. See SUPERLUMINAL_LAYERS for why the three are split.
     BOWED, AND THE BOW IS WHAT DOES THE WORK. A straight line between two
     downlights is a setting-out line, a grid line, a dimension or a wall — this
     drawing has all four — and no linetype separates it from them. A shallow arc
     is not any of those things, which is why the geometry in flows.js is arcs.
     THE FEED TICK IS OVERRIDDEN TO CONTINUOUS, and it is the only entity in this
     file that overrides anything. It is three inches of line on a layer dashed
     at eight, so on the layer's own pattern it lands in a gap as often as not —
     and a tick that is sometimes there is worse than no tick. See `dxfLine`. */
  for (const f of flows) {
    if (f?.coincident) continue;
    for (const w of flowWires(f)) {
      add(dxfPolyline(wireLayer(w.kind), w.pts.map(P), false));
    }
    for (const t of feedTicks(f, { lenPx: px * WIRE_TICK_FT })) {
      const a = P(t.a), b = P(t.b);
      add(dxfLine(wireLayer(t.kind), a.x, a.y, b.x, b.y, 'CONTINUOUS'));
    }
  }

  out = out.concat(['0','ENDSEC','0','EOF']);
  return out.join('\n');
}
