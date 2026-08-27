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
      id: l.id, kind: l.kind, axis: l.axis ?? null, nudged: !!l.nudged, ...f(l),
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
        id: l.id, type: l.kind, x: +l.x.toFixed(3), y: +l.y.toFixed(3),
        orientation: l.kind === 'large'
          ? (l.axis === 'v' ? 'on vertical grid line' : 'on horizontal grid line')
          : 'cell centre',
      })),
    })),
  }, null, 2);
}

export function toCSV(rooms, { pxPerFt } = {}) {
  const rows = [['room', 'id', 'type', 'x_ft', 'y_ft', 'x_ft_in', 'y_ft_in']];
  const ftin = (v) => {
    const f = Math.floor(v); const i = Math.round((v - f) * 12);
    return i === 12 ? `${f + 1}'-0"` : `${f}'-${i}"`;
  };
  // A room name can contain a comma. Quoting only the field that can is enough
  // and keeps the file readable in a terminal.
  const q = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
  for (const r of laidOut(rooms, pxPerFt)) {
    for (const l of r.lights) {
      rows.push([q(r.name || 'Room'), l.id, l.kind, l.x.toFixed(3), l.y.toFixed(3), ftin(l.x), ftin(l.y)]);
    }
  }
  return rows.map((r) => r.join(',')).join('\n');
}

export function svgString(svgEl) {
  const clone = svgEl.cloneNode(true);
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

// --- minimal DXF (R12 ASCII) so this lands straight in AutoCAD -------------

function dxfHeader() {
  return ['0','SECTION','2','HEADER','9','$INSUNITS','70','2','0','ENDSEC',
          '0','SECTION','2','ENTITIES'];
}
function dxfLine(layer, x1, y1, x2, y2) {
  return ['0','LINE','8',layer,'10',x1.toFixed(4),'20',y1.toFixed(4),'30','0.0',
          '11',x2.toFixed(4),'21',y2.toFixed(4),'31','0.0'];
}
function dxfCircle(layer, x, y, r) {
  return ['0','CIRCLE','8',layer,'10',x.toFixed(4),'20',y.toFixed(4),'30','0.0','40',r.toFixed(4)];
}
function dxfText(layer, x, y, hgt, str) {
  return ['0','TEXT','8',layer,'10',x.toFixed(4),'20',y.toFixed(4),'30','0.0','40',hgt.toFixed(4),'1',str];
}

/**
 * DXF in feet, Y flipped so the drawing is right-way-up in CAD (screen Y grows
 * downward, CAD Y grows upward).
 *
 * The flip is about the WHOLE SHEET and not about each room's own extent, which
 * is the one thing to get right here: flipping each room about its own top edge
 * would mirror the plan's vertical arrangement, putting the bedroom above the
 * living room. `heightFt` is the plan image's height in feet, so every room is
 * reflected in the same line and the drawing comes out as it looks on screen.
 *
 * Each room's entities carry its name on the layer, so a lighting layer can be
 * isolated per room in CAD without re-tracing anything.
 */
export function toDXF(rooms, { pxPerFt, heightPx } = {}) {
  const out0 = dxfHeader();
  const list = laidOut(rooms, pxPerFt);
  const H = heightPx != null ? heightPx / pxPerFt
    : Math.max(0, ...list.flatMap((r) => r.polygon.map((p) => p.y)));
  const fy = (y) => H - y;
  // A layer name cannot carry a comma, a space is tolerated but awkward, and
  // CAD is happier with upper case. "Living / Dining" becomes LIVING-DINING.
  //
  // An UNNAMED room gets no suffix at all, so a single-room export produces the
  // plain ROOM / CHUNK / GRID layers it always did. Suffixing everything would
  // rename the layers in every existing consumer's drawing to buy nothing.
  const tag = (name) => String(name || '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || null;
  const on = (base, t) => (t ? `${base}-${t}` : base);
  let out = out0;

  for (const r of list) {
    const t = tag(r.name);
    const poly = r.polygon;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      out = out.concat(dxfLine(on('ROOM', t), a.x, fy(a.y), b.x, fy(b.y)));
    }
    // The room's name, at the top-left inside corner of its bounding box. Only
    // when it has one — a TEXT entity reading "Room" is noise in a drawing.
    if (t) {
      const minX = Math.min(...poly.map((p) => p.x));
      const minY = Math.min(...poly.map((p) => p.y));
      out = out.concat(dxfText('ROOM-NAME', minX + 0.3, fy(minY + 1.1), 0.6, String(r.name)));
    }

    for (const ch of r.chunks) {
      out = out.concat(dxfLine(on('CHUNK', t), ch.x0, fy(ch.y0), ch.x1, fy(ch.y0)));
      out = out.concat(dxfLine(on('CHUNK', t), ch.x1, fy(ch.y0), ch.x1, fy(ch.y1)));
      out = out.concat(dxfLine(on('CHUNK', t), ch.x1, fy(ch.y1), ch.x0, fy(ch.y1)));
      out = out.concat(dxfLine(on('CHUNK', t), ch.x0, fy(ch.y1), ch.x0, fy(ch.y0)));
      for (const x of ch.xLines.slice(1, -1)) out = out.concat(dxfLine(on('GRID', t), x, fy(ch.y0), x, fy(ch.y1)));
      for (const y of ch.yLines.slice(1, -1)) out = out.concat(dxfLine(on('GRID', t), ch.x0, fy(y), ch.x1, fy(y)));
    }

    for (const z of r.zones) {
      out = out.concat(dxfLine('NO-LIGHT', z.x0, fy(z.y0), z.x1, fy(z.y0)));
      out = out.concat(dxfLine('NO-LIGHT', z.x1, fy(z.y0), z.x1, fy(z.y1)));
      out = out.concat(dxfLine('NO-LIGHT', z.x1, fy(z.y1), z.x0, fy(z.y1)));
      out = out.concat(dxfLine('NO-LIGHT', z.x0, fy(z.y1), z.x0, fy(z.y0)));
      out = out.concat(dxfLine('NO-LIGHT', z.x0, fy(z.y0), z.x1, fy(z.y1)));
      out = out.concat(dxfLine('NO-LIGHT', z.x0, fy(z.y1), z.x1, fy(z.y0)));
    }

    for (const l of r.lights) {
      const layer = l.kind === 'large' ? 'LIGHT-LARGE' : 'LIGHT-SMALL';
      const rad = l.kind === 'large' ? 0.5 : 0.29;
      out = out.concat(dxfCircle(layer, l.x, fy(l.y), rad));
      out = out.concat(dxfLine(layer, l.x - rad, fy(l.y), l.x + rad, fy(l.y)));
      out = out.concat(dxfLine(layer, l.x, fy(l.y) - rad, l.x, fy(l.y) + rad));
      // L1 in the kitchen and L1 in the hall are two fittings. Prefixed with
      // the room where there is one, so a schedule can be ordered from.
      out = out.concat(dxfText('LIGHT-TAG', l.x + rad + 0.15, fy(l.y) - 0.15, 0.35,
        t ? `${t}-${l.id}` : l.id));
    }

    for (const fan of r.fans) {
      out = out.concat(dxfCircle('FAN', fan.x, fy(fan.y), fan.r || 2));
    }
  }

  out = out.concat(['0','ENDSEC','0','EOF']);
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// THE CAD EXPORT — a DXF that lands ON the drawing it came from.
//
// This is a different animal to toDXF above and the difference is the whole
// point. toDXF produces a STANDALONE drawing: feet, Y flipped, its own layer
// names, everything the planner knows. Useful to look at, useless to overlay.
//
// This one is meant to be imported into the drawing the user started from, so
// every entity has to come back out in THE ORIGINAL FILE'S OWN COORDINATES —
// its units, its origin, its Y-up orientation — or it lands somewhere in the
// next field along and at the wrong scale.
//
// `source.toDu` is exactly that mapping, inverted from the one that brought the
// drawing in, so it is used for every single point and nothing is converted by
// hand. Which leads to the one rule worth stating: TRANSFORM POINTS, NEVER
// ANGLES. Screen Y grows downward and CAD Y grows upward, so a rotation carried
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
 */
export const SUPERLUMINAL_LAYERS = {
  spots: 'superluminal_spots',
  strips: 'superluminal_led_strips',
  decorative: 'superluminal_decorative',
  objects: 'superluminal_ceiling_objects',
  rooms: 'superluminal_rooms',
};

/** Layer colours, so they are told apart the moment they import. */
const SL_COLOUR = {
  spots: 5,        // blue
  strips: 4,       // cyan
  decorative: 6,   // magenta
  objects: 1,      // red
  rooms: 3,        // green
};

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

function slHeader(insunits) {
  const layer = (name, colour) => ['0','LAYER','2',name,'70','0',
                                   '62',String(colour),'6','CONTINUOUS'];
  return [
    '0','SECTION','2','HEADER',
    '9','$ACADVER','1','AC1009',
    // The ORIGINAL drawing's units, not ours. Import scaling keys off this, and
    // a file that says feet while holding millimetres arrives 300x too big.
    '9','$INSUNITS','70',String(insunits ?? 0),
    '0','ENDSEC',
    // An explicit LAYER table. Most CAD will invent a layer named by an entity
    // that references a missing one, but "most" is not a promise, and inventing
    // it loses the colour.
    '0','SECTION','2','TABLES','0','TABLE','2','LAYER',
    '70',String(Object.keys(SUPERLUMINAL_LAYERS).length),
    ...Object.keys(SUPERLUMINAL_LAYERS)
      .flatMap((k) => layer(SUPERLUMINAL_LAYERS[k], SL_COLOUR[k])),
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
export function toSuperluminalDXF({ source, rooms = [], objects = [],
                                    accents = [], spots = [] } = {}) {
  if (source?.kind !== 'vector') {
    throw new Error('The CAD export needs the original DXF to line up with.');
  }
  const units = source.drawing?.units;
  const duPerFt = 1 / (units?.toFeet || 1);
  const P = (p) => source.toDu(p);              // plan pixels -> drawing units
  const L = (ft) => ft * duPerFt;               // feet -> drawing units
  const { spots: LY_S, strips: LY_T, decorative: LY_D,
          objects: LY_O, rooms: LY_R } = SUPERLUMINAL_LAYERS;

  let out = slHeader(units?.code);
  const add = (e) => { out = out.concat(e); };

  // A ring and a cross: the fitting symbol, in real size, so it can be
  // measured off the drawing rather than just seen.
  const marker = (layer, at, rFt) => {
    const c = P(at), r = L(rFt);
    add(dxfCircle(layer, c.x, c.y, r));
    add(dxfLine(layer, c.x - r, c.y, c.x + r, c.y));
    add(dxfLine(layer, c.x, c.y - r, c.x, c.y + r));
  };

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
      const rFt = (o.r || 0) / (source.pxPerFt || 1);
      add(dxfCircle(LY_D, c.x, c.y, L(rFt)));
      const t = L(0.3);
      add(dxfLine(LY_D, c.x - t, c.y, c.x + t, c.y));
      add(dxfLine(LY_D, c.x, c.y - t, c.x, c.y + t));
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
      const rFt = (o.r || 0) / (source.pxPerFt || 1);
      add(dxfCircle(LY_O, c.x, c.y, L(rFt)));
      // A cross at the centre: a circle alone gives nothing to snap to, and the
      // centre is what an electrician sets out from.
      const t = L(0.3);
      add(dxfLine(LY_O, c.x - t, c.y, c.x + t, c.y));
      add(dxfLine(LY_O, c.x, c.y - t, c.x, c.y + t));
    }
  }

  // --- spots: the recessed schedule, ambient and aimed alike
  for (const r of rooms) {
    for (const l of r?.plan?.lightsPx || []) {
      marker(LY_S, l, l.kind === 'large' ? 0.5 : 0.29);
    }
  }

  // --- accents: a strip is linear product, a sconce is decorative
  for (const a of accents) {
    if (a.rejected) continue;
    // A strip is its RUN — the two ends are the whole specification, and they
    // are the numbers the derivation existed to produce.
    if (a.run) add(dxfPolyline(LY_T, a.run.map(P), false));
    // A sconce goes at its wall point, not at the offset the drawing hangs the
    // symbol out to: the mounting position is what gets set out on site.
    else if (a.point) marker(LY_D, a.point, 0.3);
  }

  // --- directional spots, on the same layer as the ambient ones
  for (const sp of spots) {
    if (sp.x == null) continue;
    marker(LY_S, sp, 0.3);
    // The tail, pointing at what it lights. Drawn to a fixed length rather than
    // all the way to the surface, which would read as a line to somewhere.
    const from = P(sp), to = P(sp.target);
    const dx = to.x - from.x, dy = to.y - from.y;
    const d = Math.hypot(dx, dy) || 1, reach = L(1.2);
    add(dxfLine(LY_S, from.x + (dx / d) * L(0.42), from.y + (dy / d) * L(0.42),
                      from.x + (dx / d) * reach,   from.y + (dy / d) * reach));
  }

  out = out.concat(['0','ENDSEC','0','EOF']);
  return out.join('\n');
}
