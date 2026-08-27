// ---------------------------------------------------------------------------
// dxf.js — the seam between a DXF file and the rest of this app.
//
// dxf-parser does the tokenising and the entity zoo; NOTHING else in this
// codebase imports it. What comes out of here is a flat, boring bag of
// primitives in DRAWING UNITS with DXF orientation (Y up):
//
//   segments  straight runs, from LINE / LWPOLYLINE / POLYLINE / SOLID edges
//   arcs      real arcs, from ARC and from polyline BULGES
//   circles   CIRCLE
//   texts     TEXT / MTEXT — room names and dimension strings live here
//   inserts   block insertion points, kept as hints (doors, fans, furniture)
//
// Swapping the parser means rewriting this file and nothing else.
//
// Two things here are worth more than they look:
//
//  1. BULGES. A curved wall in a polyline is not stored as an arc — it is a
//     scalar hung on the preceding vertex, `tan(included angle / 4)`, negative
//     if the arc runs clockwise. Get the sign wrong and a curved wall silently
//     becomes a straight one. See bulgeToArc.
//  2. BLOCK LAYER INHERITANCE. Geometry drawn on layer '0' inside a block
//     takes the layer of the INSERT that placed it. Ignore that and a wall
//     inside a block lands on layer '0' instead of A-WALL, and the layer
//     picker stops working on exactly the drawings that need it most.
// ---------------------------------------------------------------------------

import DxfParser from 'dxf-parser';

// --- units ------------------------------------------------------------------

/** $INSUNITS code -> unit. Only the ones a building is plausibly drawn in. */
export const UNITS = [
  { id: 'mm', code: 4, label: 'Millimetres', toFeet: 1 / 304.8 },
  { id: 'cm', code: 5, label: 'Centimetres', toFeet: 1 / 30.48 },
  { id: 'm',  code: 6, label: 'Metres',      toFeet: 3.280839895 },
  { id: 'in', code: 1, label: 'Inches',      toFeet: 1 / 12 },
  { id: 'ft', code: 2, label: 'Feet',        toFeet: 1 },
  { id: 'dm', code: 14, label: 'Decimetres', toFeet: 0.328083989 },
  { id: 'yd', code: 10, label: 'Yards',      toFeet: 3 },
];

// A floor plan's diagonal, in feet. One small room at the bottom, a large
// building at the top. Anything outside this means we guessed the unit wrong.
const PLAUSIBLE_FT = [7, 900];
// ...and what a drawing usually is, for ranking guesses that are all plausible.
const TYPICAL_FT = [25, 200];
// When the header is silent, this is the order we trust. mm first: it is what
// almost every practice in India draws in.
const GUESS_ORDER = ['mm', 'm', 'cm', 'in', 'ft', 'dm', 'yd'];

/**
 * Work out what one drawing unit means.
 *
 * $INSUNITS is authoritative WHEN IT IS BOTH SET AND PLAUSIBLE — a drawing
 * saved as "unitless" or mis-tagged is extremely common, and a header that
 * claims inches on a plan whose diagonal would then be 4 inches is not
 * evidence, it is a typo. So the header proposes and the bounding box vetoes.
 */
export function inferUnits(diagonal, header = {}) {
  const code = header.$INSUNITS;
  const plausible = (u) => {
    const ft = diagonal * u.toFeet;
    return ft >= PLAUSIBLE_FT[0] && ft <= PLAUSIBLE_FT[1];
  };
  const candidates = UNITS.filter(plausible).map((u) => ({
    ...u,
    diagonalFt: diagonal * u.toFeet,
    typical: diagonal * u.toFeet >= TYPICAL_FT[0] && diagonal * u.toFeet <= TYPICAL_FT[1],
  }));

  const fromHeader = UNITS.find((u) => u.code === code);
  if (fromHeader && plausible(fromHeader)) {
    return { unit: { ...fromHeader, source: 'header' }, candidates };
  }

  // Header absent, unitless, or contradicted by the drawing's own size.
  const rank = (u) => (u.typical ? 0 : 1) * 100 + GUESS_ORDER.indexOf(u.id);
  const best = [...candidates].sort((a, b) => rank(a) - rank(b))[0];
  if (best) {
    return {
      unit: { ...best, source: fromHeader ? 'overridden' : 'inferred' },
      candidates,
      headerSaid: fromHeader ? fromHeader.id : null,
    };
  }
  // Nothing plausible at all — hand back millimetres and let the user fix it.
  return {
    unit: { ...UNITS[0], source: 'fallback' },
    candidates: UNITS.map((u) => ({ ...u, diagonalFt: diagonal * u.toFeet, typical: false })),
    headerSaid: fromHeader ? fromHeader.id : null,
  };
}

// --- geometry helpers -------------------------------------------------------

const TAU = Math.PI * 2;
const ARC_STEP = 0.18;   // rad — how finely an arc is tessellated

/**
 * A polyline bulge, turned into a real arc.
 *
 * bulge = tan(theta / 4), negative when the arc runs clockwise from a to b.
 * Derivation checked at three values: theta -> 0 (shallow), theta = pi
 * (semicircle, centre lands on the chord midpoint), theta = 3pi/2 (major arc,
 * centre crosses to the far side — which is where a sign error shows up).
 */
export function bulgeToArc(x1, y1, x2, y2, bulge) {
  const theta = 4 * Math.atan(bulge);
  const dx = x2 - x1, dy = y2 - y1;
  const d = Math.hypot(dx, dy);
  if (!d || !Number.isFinite(theta) || Math.abs(theta) < 1e-9) return null;

  const half = theta / 2;
  const sinHalf = Math.sin(half);
  if (Math.abs(sinHalf) < 1e-12) return null;

  const r = Math.abs(d / (2 * sinHalf));
  // Distance from the chord midpoint to the centre, along the LEFT normal of
  // travel. tan(theta/2) carries the sign, so a major arc puts the centre on
  // the opposite side without a special case.
  const h = (d / 2) / Math.tan(half);
  const cx = (x1 + x2) / 2 + h * (-dy / d);
  const cy = (y1 + y2) / 2 + h * (dx / d);
  const a0 = Math.atan2(y1 - cy, x1 - cx);
  return { cx, cy, r, a0, a1: a0 + theta };
}

/** Sample an arc into a run of straight segments. */
export function arcToPoints(cx, cy, r, a0, a1) {
  const sweep = a1 - a0;
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / ARC_STEP));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

// --- INSERT flattening ------------------------------------------------------

const MAX_BLOCK_DEPTH = 8;

function makeTransform(insert) {
  const rot = ((insert.rotation || 0) * Math.PI) / 180;
  const sx = insert.xScale ?? 1;
  const sy = insert.yScale ?? 1;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const ox = insert.position?.x || 0;
  const oy = insert.position?.y || 0;
  return (p) => {
    const x = p.x * sx, y = p.y * sy;
    return { x: ox + x * cos - y * sin, y: oy + x * sin + y * cos };
  };
}

function composeTransform(outer, inner) {
  return (p) => outer(inner(p));
}

const IDENTITY = (p) => ({ x: p.x, y: p.y });

// --- the parse ---------------------------------------------------------------

/**
 * Read a DXF into our own shape.
 *
 * Returns { ok, segments, arcs, circles, texts, inserts, layers, bbox, units,
 *           unitCandidates, stats } — or { ok: false, reason }.
 */
export function parseDXF(text) {
  let dxf;
  try {
    dxf = new DxfParser().parseSync(text);
  } catch (err) {
    return { ok: false, reason: `Could not read that DXF — ${err.message || err}. Binary DXF is not supported; re-save as ASCII DXF.` };
  }
  if (!dxf) return { ok: false, reason: 'That file did not parse as a DXF.' };

  const segments = [];
  const arcs = [];
  const circles = [];
  const texts = [];
  const inserts = [];
  const skipped = {};
  const layerMeta = new Map();

  const layerTable = dxf.tables?.layer?.layers || {};
  const blocks = dxf.blocks || {};

  const note = (layer, kind) => {
    let m = layerMeta.get(layer);
    if (!m) { m = { name: layer, count: 0, kinds: {} }; layerMeta.set(layer, m); }
    m.count++;
    m.kinds[kind] = (m.kinds[kind] || 0) + 1;
  };

  /**
   * Layer of an entity, honouring block inheritance: layer '0' inside a block
   * means "whatever layer the INSERT is on".
   */
  const layerOf = (ent, inheritedLayer) => {
    const own = ent.layer;
    if (inheritedLayer && (!own || own === '0')) return inheritedLayer;
    return own || '0';
  };

  const pushSegment = (a, b, layer) => {
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return;
    if (a.x === b.x && a.y === b.y) return;
    segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, layer });
  };

  /** Walk a vertex list, honouring bulges, emitting segments through `tf`. */
  const emitPolyline = (verts, closed, layer, tf) => {
    const n = verts.length;
    if (n < 2) return;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const v = verts[i], w = verts[(i + 1) % n];
      const bulge = v.bulge;
      if (bulge && Math.abs(bulge) > 1e-9) {
        const arc = bulgeToArc(v.x, v.y, w.x, w.y, bulge);
        if (arc) {
          const pts = arcToPoints(arc.cx, arc.cy, arc.r, arc.a0, arc.a1).map(tf);
          for (let k = 0; k < pts.length - 1; k++) pushSegment(pts[k], pts[k + 1], layer);
          continue;
        }
      }
      pushSegment(tf({ x: v.x, y: v.y }), tf({ x: w.x, y: w.y }), layer);
    }
  };

  const walk = (entities, tf, inheritedLayer, depth) => {
    for (const ent of entities || []) {
      if (ent.visible === false) continue;
      const layer = layerOf(ent, inheritedLayer);

      switch (ent.type) {
        case 'LINE': {
          const v = ent.vertices || [];
          if (v.length >= 2) { pushSegment(tf(v[0]), tf(v[1]), layer); note(layer, 'line'); }
          break;
        }
        case 'LWPOLYLINE':
        case 'POLYLINE': {
          const verts = (ent.vertices || []).filter((v) => Number.isFinite(v.x) && Number.isFinite(v.y));
          if (verts.length >= 2) {
            emitPolyline(verts, !!ent.shape, layer, tf);
            note(layer, 'polyline');
          }
          break;
        }
        case 'ARC': {
          const c = tf(ent.center || { x: 0, y: 0 });
          const a0 = ent.startAngle ?? 0;
          const a1 = ent.endAngle ?? TAU;
          const sweep = a1 >= a0 ? a1 - a0 : a1 - a0 + TAU;
          // Tessellate in the block's own space, THEN transform, so a rotated
          // or scaled block bends its arcs correctly.
          const raw = arcToPoints(ent.center?.x || 0, ent.center?.y || 0, ent.radius || 0, a0, a0 + sweep);
          const pts = raw.map(tf);
          for (let k = 0; k < pts.length - 1; k++) pushSegment(pts[k], pts[k + 1], layer);
          // The kept arc is a hint (door swings), so a world-space radius
          // measured off the transformed geometry beats the nominal one.
          arcs.push({ cx: c.x, cy: c.y, r: Math.hypot(pts[0].x - c.x, pts[0].y - c.y),
                      a0, a1: a0 + sweep, layer });
          note(layer, 'arc');
          break;
        }
        case 'CIRCLE': {
          const c = tf(ent.center || { x: 0, y: 0 });
          const edge = tf({ x: (ent.center?.x || 0) + (ent.radius || 0), y: ent.center?.y || 0 });
          circles.push({ cx: c.x, cy: c.y, r: Math.hypot(edge.x - c.x, edge.y - c.y), layer });
          note(layer, 'circle');
          break;
        }
        case 'ELLIPSE': {
          // Approximated as a polyline. Rare in walls; common in furniture.
          const c = ent.center || { x: 0, y: 0 };
          const maj = ent.majorAxisEndPoint || { x: 1, y: 0 };
          const ratio = ent.axisRatio ?? 1;
          const a0 = ent.startAngle ?? 0;
          const a1 = ent.endAngle ?? TAU;
          const rot = Math.atan2(maj.y, maj.x);
          const ra = Math.hypot(maj.x, maj.y), rb = ra * ratio;
          const sweep = a1 > a0 ? a1 - a0 : TAU;
          const n = Math.max(8, Math.ceil(sweep / ARC_STEP));
          const pts = [];
          for (let i = 0; i <= n; i++) {
            const t = a0 + (sweep * i) / n;
            const ex = ra * Math.cos(t), ey = rb * Math.sin(t);
            pts.push(tf({ x: c.x + ex * Math.cos(rot) - ey * Math.sin(rot),
                          y: c.y + ex * Math.sin(rot) + ey * Math.cos(rot) }));
          }
          for (let k = 0; k < pts.length - 1; k++) pushSegment(pts[k], pts[k + 1], layer);
          note(layer, 'ellipse');
          break;
        }
        case 'SPLINE': {
          // Straight through the fit points if we have them, control points
          // otherwise. A wall is never a spline; a garden path might be.
          const pts = (ent.fitPoints?.length ? ent.fitPoints : ent.controlPoints) || [];
          const w = pts.map(tf);
          for (let k = 0; k < w.length - 1; k++) pushSegment(w[k], w[k + 1], layer);
          if (w.length) note(layer, 'spline');
          break;
        }
        case 'SOLID':
        case '3DFACE': {
          const v = (ent.points || ent.vertices || []).map(tf);
          for (let k = 0; k < v.length; k++) pushSegment(v[k], v[(k + 1) % v.length], layer);
          if (v.length) note(layer, 'solid');
          break;
        }
        case 'TEXT':
        case 'MTEXT': {
          const p = tf(ent.startPoint || ent.position || { x: 0, y: 0 });
          const str = String(ent.text ?? '').replace(/\\[A-Za-z][^;]*;/g, '').trim();
          if (str) { texts.push({ x: p.x, y: p.y, h: ent.textHeight || ent.height || 0, text: str, layer }); note(layer, 'text'); }
          break;
        }
        case 'INSERT': {
          if (depth >= MAX_BLOCK_DEPTH) { skipped.DEEP_BLOCK = (skipped.DEEP_BLOCK || 0) + 1; break; }
          const block = blocks[ent.name];
          const base = block?.position || { x: 0, y: 0 };
          const cols = Math.max(1, ent.columnCount || 1);
          const rows = Math.max(1, ent.rowCount || 1);
          const cs = ent.columnSpacing || 0;
          const rs = ent.rowSpacing || 0;
          const here = tf(ent.position || { x: 0, y: 0 });
          inserts.push({ name: ent.name || '', x: here.x, y: here.y, layer,
                         rotation: ent.rotation || 0, xScale: ent.xScale ?? 1, yScale: ent.yScale ?? 1 });
          note(layer, 'insert');
          if (!block) { skipped.MISSING_BLOCK = (skipped.MISSING_BLOCK || 0) + 1; break; }
          for (let c = 0; c < cols; c++) {
            for (let r = 0; r < rows; r++) {
              const cell = {
                ...ent,
                position: { x: (ent.position?.x || 0) + c * cs, y: (ent.position?.y || 0) + r * rs },
              };
              // The block's own base point is subtracted before placing.
              const local = makeTransform(cell);
              const shifted = (p) => local({ x: p.x - base.x, y: p.y - base.y });
              walk(block.entities, composeTransform(tf, shifted), layer, depth + 1);
            }
          }
          break;
        }
        case 'DIMENSION':
        case 'POINT':
        case 'ATTDEF':
        case 'VERTEX':
          break;   // carries no wall geometry we want
        default:
          skipped[ent.type] = (skipped[ent.type] || 0) + 1;
      }
    }
  };

  walk(dxf.entities, IDENTITY, null, 0);

  // --- bounds, from the wall-ish geometry only -------------------------------
  // Text and dimension leaders wander a long way outside a building; letting
  // them set the bounds would wreck both the unit inference and the viewport.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x, y) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };
  for (const s of segments) { grow(s.x1, s.y1); grow(s.x2, s.y2); }
  for (const c of circles) { grow(c.cx - c.r, c.cy - c.r); grow(c.cx + c.r, c.cy + c.r); }
  if (!Number.isFinite(minX)) {
    return { ok: false, reason: 'That DXF has no line work in it — nothing to find spaces in.' };
  }

  const bbox = { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  const diagonal = Math.hypot(bbox.w, bbox.h);
  const { unit, candidates, headerSaid } = inferUnits(diagonal, dxf.header || {});

  const layers = [...layerMeta.values()]
    .map((m) => ({ ...m, color: layerTable[m.name]?.color ?? null,
                   frozen: !!layerTable[m.name]?.frozen }))
    .sort((a, b) => b.count - a.count);

  return {
    ok: true,
    segments, arcs, circles, texts, inserts, layers, bbox,
    units: unit,
    unitCandidates: candidates,
    headerSaid,
    header: dxf.header || {},
    stats: {
      segments: segments.length,
      circles: circles.length,
      texts: texts.length,
      inserts: inserts.length,
      layers: layers.length,
      skipped,
    },
  };
}

// --- layer classification ---------------------------------------------------

// Walls first, because that is the only class we actually need to get right.
const LAYER_HINTS = [
  // `walls?` and a trailing letter class that does NOT eat the plural. The
  // first version of this required a non-letter after "wall", so `KMBD Walls`
  // did not match, nothing was recognised as a wall layer, and the fallback
  // ticked every layer including the one with 1,656 pieces of furniture on it.
  // Every sofa and dining chair then became a wall. Plurals matter.
  { role: 'wall',    weight: 100, re: /(^|[^a-z])(walls?|mur|muro|w[-_]?ext|w[-_]?int)([^a-z]|$)/i },
  { role: 'wall',    weight: 60,  re: /^(a-)?walls?/i },
  { role: 'wall',    weight: 40,  re: /(brick|masonry|rcc|column|partition)/i },
  { role: 'door',    weight: 0,   re: /(door|shutter|dr[-_]?swing)/i },
  { role: 'window',  weight: 0,   re: /(window|glazing|wind|glz)/i },
  { role: 'dim',     weight: -80, re: /(dim|dimension|annot|text|note|label|title|grid[-_]?line|hatch|centre|center)/i },
  { role: 'furn',    weight: -60, re: /(furn|furniture|sofa|bed|kitchen|sanitary|plumb|elec|light|ceil|fan|tree|plant|car|veh)/i },
  { role: 'floor',   weight: -40, re: /(floor|tile|pattern|hatch|paving)/i },
];

/**
 * Guess what each layer is for, and which ones bound rooms.
 *
 * This only ever PROPOSES. The picker shows every layer with its entity count
 * and the guess, and the user ticks what they mean — because layer naming is a
 * office-by-office convention and no regex is going to win that argument.
 */
export function classifyLayers(layers) {
  const scored = layers.map((l) => {
    let role = 'other', score = 0;
    for (const h of LAYER_HINTS) {
      if (h.re.test(l.name)) {
        if (Math.abs(h.weight) > Math.abs(score) || role === 'other') { role = h.role; score = h.weight; }
      }
    }
    return { ...l, role, score };
  });

  const namedWalls = scored.filter((l) => l.role === 'wall' && l.count > 0);
  let wallLayers;
  if (namedWalls.length) {
    wallLayers = namedWalls.map((l) => l.name);
  } else {
    // No layer admits to being a wall — a single-layer export, or a naming
    // scheme we do not know. Fall back to every layer that is not obviously
    // annotation or furniture, which for a one-layer drawing means all of it.
    //
    // This fallback is DANGEROUS and deliberately loud about it (`guessed`).
    // Practices routinely dump furniture, sanitaryware and appliances onto
    // layer 0 alongside the walls; ticking that produces a plausible-looking
    // reading in which a dining table is a room. Tracing the outline by hand
    // exists precisely because this cannot be fixed by a better regex.
    wallLayers = scored.filter((l) => l.score >= 0 && l.count > 0).map((l) => l.name);
    if (!wallLayers.length) wallLayers = scored.map((l) => l.name);
  }
  return {
    layers: scored.map((l) => ({ ...l, isWallGuess: wallLayers.includes(l.name) })),
    wallLayers,
    guessed: !namedWalls.length,
  };
}

/** Segments from the chosen layers, converted to feet, Y still up. */
export function wallSegments(drawing, layerNames) {
  const keep = new Set(layerNames);
  const f = drawing.units.toFeet;
  const out = [];
  for (const s of drawing.segments) {
    if (!keep.has(s.layer)) continue;
    out.push({ x1: s.x1 * f, y1: s.y1 * f, x2: s.x2 * f, y2: s.y2 * f, layer: s.layer });
  }
  return out;
}
