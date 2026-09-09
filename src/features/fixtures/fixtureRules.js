/* --- WHAT A FITTING IS, WITHOUT A DRAWING UNDER IT -------------------------
   PURE. Every rule in this file is a function of its arguments: no React, no
   document, no pointer. That is what makes them the only part of this feature
   there is a test for — see tools/test-fixtures.mjs — and it is also the line
   the rest of the feature is drawn around. The hooks beside it hold state and
   dependency arrays; the arithmetic and the refusals are here.

   THE EXISTING LIBRARIES ARE USED RATHER THAN REIMPLEMENTED. `lib/cob.js` is
   still where a downlight's own rules live — what it may be specified at, what
   the gridding engine would have installed, and the two things worth warning
   about before the click — and `lib/magTrack.js` is still where a module's
   place on a profile is decided. What is here is the part that used to sit
   inline in App.jsx: the scans over a list, the stacking of four answers, and
   the two rollbacks. */
import { placeCob, chunkSpec, wallClearance, bedUnder,
         clampWatts, nearestBeam,
         arrayAsks, arrayQuanta, quantiseCount } from '../../lib/cob.js';
import { placeableU } from '../../lib/magTrack.js';
/* THE RUN IS A PATH AND A MODULE IS A POINT HELD ON IT. Everything about WHERE
   on a run something sits comes from the two primitives — lib/path.js for the
   parameter space and lib/point.js for the point — and `placeableU` above is
   the one thing that is genuinely a fact about the PRODUCT: two bodies cannot
   share a foot of extrusion. That is the domain's veto and it stays here. */
import { asPathHost, pathU, pathAt, pathLengthOf, makePath } from '../../lib/path.js';
import { pointsOn, uAt } from '../../lib/point.js';
import { ABSORB_FT, DODGE_FT } from '../../lib/track.js';
import { nearestOnSegment, pathLength, pointAt, pointInPolygon }
  from '../../lib/geometry.js';
import { surfaceDistance } from '../../lib/planner.js';

/* WHICH LIGHT IS PICKED, as `${outlineId}|${cellKey}` — the same pairing the
   store is keyed on, flattened, because a selection is one value. */
export const lightKey = (roomId, ck) => `${roomId}|${ck}`;

/** The room containing a track's path, including a path drawn on its wall. */
export function roomForTrackPath(rooms, pts, { closed = false, pxPerFt = 0,
                                               toleranceFt = 0.5 } = {}) {
  const total = pathLength(pts ?? [], { closed });
  if (!(total > 0)) return null;
  const at = pointAt(pts, total / 2, { closed });
  if (!at) return null;
  const polygon = (room) => room?.geo?.polygonPlanFt
    ?? (pxPerFt > 0 ? room?.geo?.polygonPx?.map(
      (p) => ({ x: p.x / pxPerFt, y: p.y / pxPerFt })) : null);
  const inside = rooms.find((room) => {
    const poly = polygon(room);
    return poly?.length >= 3 && pointInPolygon(at, poly);
  });
  if (inside) return inside;

  /* Ray casting has no single answer on a polygon edge. A line intentionally
     set out on a wall must still belong to that room, so fall back to the
     nearest outline within a small plan-space tolerance. */
  let best = null;
  for (const room of rooms) {
    const poly = polygon(room);
    if (!poly?.length) continue;
    for (let i = 0; i < poly.length; i++) {
      const q = nearestOnSegment(at, poly[i], poly[(i + 1) % poly.length]);
      const dist = Math.hypot(at.x - q.x, at.y - q.y);
      if (!best || dist < best.dist) best = { room, dist };
    }
  }
  return best && best.dist <= toleranceFt ? best.room : null;
}

/**
 * PROJECT THE GRID'S SPOTS ONTO A MAGNETIC TRACK.
 *
 * Used when the room has no ambient shortfall: its normal grid still says how
 * many track spots it would place and where. Each of those points is projected
 * to the nearest free position on the profile, with the same physical overlap
 * rule as a hand-placed track module. A short rail may therefore accept fewer
 * spots than the grid proposed, but it can never stack them.
 */
export function gridSpotsOnTrack(pts, gridSpots, { closed = false, watts = [] } = {}) {
  if (!Array.isArray(pts) || pts.length < 2 || !Array.isArray(gridSpots)) return [];
  const catalogue = (Array.isArray(watts) ? watts : [])
    .map(Number).filter((w) => w > 0).sort((a, b) => a - b);
  const out = [];
  for (const spot of gridSpots) {
    const p = { x: Number(spot?.xFt), y: Number(spot?.yFt) };
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const asked = Number(spot?.watts) || 0;
    const moduleW = catalogue.length && asked > 0
      ? catalogue.reduce((best, w) => (
        Math.abs(w - asked) < Math.abs(best - asked) ? w : best), catalogue[0])
      : null;
    /* THE SAME TWO STEPS `moduleU` TAKES — the primitive's projection, then the
       product's clearance. This one is handed bare points rather than a run, so
       it asks `uAt` directly instead of through a host. */
    const u = placeableU(pts, uAt(pts, p, { closed }), out, 'spot',
      { closed, watts: moduleW });
    if (u != null) out.push({ u, kind: 'spot', watts: moduleW,
                              gridCells: [...(spot.gridCells ?? [])] });
  }
  return out;
}

/** Does one path segment physically enter a grid-cell rectangle? */
function segmentCrossesRect(a, b, r) {
  let lo = 0, hi = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - r.x0], [dx, r.x1 - a.x],
    [-dy, a.y - r.y0], [dy, r.y1 - a.y],
  ]) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
    if (lo > hi) return false;
  }
  return true;
}

/**
 * WHICH GRID FITTINGS A MANUAL MAGNETIC TRACK OWNS.
 *
 * There is deliberately no capture distance here. A closed track owns cells
 * enclosed by its outline; an open track owns only cells its centreline
 * physically crosses. The planner may have combined several cells into one
 * fitting, so candidates remain fitting-shaped and carry every cell key they
 * replace.
 */
export function gridSpotsOwnedByTrack(pts, gridSpots, { closed = false } = {}) {
  if (!Array.isArray(pts) || pts.length < 2 || !Array.isArray(gridSpots)) return [];
  const ownsCell = closed
    ? (cell) => pointInPolygon({ x: (cell.x0 + cell.x1) / 2,
                                y: (cell.y0 + cell.y1) / 2 }, pts)
    : (cell) => {
      for (let i = 0; i < pts.length - 1; i++) {
        if (segmentCrossesRect(pts[i], pts[i + 1], cell)) return true;
      }
      return false;
    };
  return gridSpots.filter((spot) => {
    const cells = spot?.cellsFt ?? [];
    if (cells.some(ownsCell)) return true;
    if (cells.length) return false;
    const p = { x: Number(spot?.xFt), y: Number(spot?.yFt) };
    return closed && Number.isFinite(p.x) && Number.isFinite(p.y)
      ? pointInPolygon(p, pts) : false;
  });
}

/**
 * OFFER NEW AUTOPLACE SPOTS TO EXISTING MAGNETIC TRACKS.
 *
 * Only a rail already carrying a diffuser participates. Ownership was checked
 * before these spots were generated; this function answers the later physical
 * question—whether an otherwise recessed spot falls inside the ordinary track
 * capture distance and whether a clear module-length exists near that landing.
 */
export function absorbAutoplaceSpots({ spots, tracks, fixtures, pxPerFt,
                                       roomId = null, absorbFt = ABSORB_FT,
                                       dodgeFt = DODGE_FT }) {
  if (!Array.isArray(spots) || !spots.length || !(pxPerFt > 0)) {
    return { spots: spots ?? [], modules: [] };
  }
  const eligible = (tracks ?? []).filter((track) =>
    (!roomId || track.roomId === roomId)
    && pointsOn(fixtures, track.id).some((f) => f.kind === 'diffuser'))
    .map((track) => ({
      ...track,
      /* THE RUN AS A PATH HOST, IN FEET. `asPathHost` is the three fields
         lib/point.js asks of anything a point can be held on, and building it
         here means every question below — the fraction, the position, the
         length — is asked of one object rather than of a loose pair of `pts`
         and `closed` that could drift apart. */
      host: asPathHost(makePath(
        (track.pts ?? []).map((p) => ({ x: p.x / pxPerFt, y: p.y / pxPerFt })),
        { closed: track.closed, id: track.id })),
    })).filter((track) => track.host);
  if (!eligible.length) return { spots, modules: [] };

  const taken = new Map(eligible.map((track) => [track.id,
    pointsOn(fixtures, track.id)
      .map((f) => ({ u: f.u, kind: f.kind, watts: f.watts }))]));
  const modules = [], keep = [];
  for (const spot of spots) {
    const p = { x: Number(spot?.xFt), y: Number(spot?.yFt) };
    const bids = eligible.map((track) => {
      const want = pathU(track.host, p);
      const at = pathAt(track.host, want);
      return { track, want, dist: at ? Math.hypot(p.x - at.x, p.y - at.y) : Infinity };
    }).filter((bid) => bid.dist <= absorbFt + 1e-9)
      .sort((a, b) => a.dist - b.dist);

    let seated = null;
    for (const bid of bids) {
      const { track, want } = bid;
      const u = placeableU(track.host.pts, want, taken.get(track.id), 'spot',
        { closed: track.host.closed, watts: spot.watts });
      if (u == null) continue;
      const total = pathLengthOf(track.host);
      const rawMove = Math.abs(u - want) * total;
      const move = track.closed ? Math.min(rawMove, Math.max(0, total - rawMove)) : rawMove;
      if (move > dodgeFt + 1e-9) continue;
      seated = { on: track.id, u, watts: spot.watts, beam: spot.beam,
        gridCells: spot.gridCell ? [spot.gridCell] : [] };
      taken.get(track.id).push({ u, kind: 'spot', watts: spot.watts });
      break;
    }
    if (seated) modules.push(seated); else keep.push(spot);
  }
  return { spots: keep, modules };
}

/** Everything the clamp has to know about the room a light is in. Assembled
 *  once per gesture rather than per frame: none of it changes while a pointer
 *  is down, and `r.coves` in particular is a map over the room's cove reports.
 *  THE COVE LINES ARE IN HERE and are not optional — the dead band either side
 *  of one is a rule about where a fitting may sit, exactly like a fan's
 *  clearance, and a drag that ignored it could park a downlight in the pocket
 *  the whole detail exists to hide. */
export function clampContext(r, opt) {
  return {
    polygon: r.geo.polygonFt,
    fans: r.geo.fixturesFt,
    zones: r.geo.zonesFt,
    options: { ...opt, coves: (r.coves ?? []).map((c) => c.line) },
  };
}

/* --- LINING ONE LAMP UP WITH ANOTHER ---------------------------------------
   THE LAMPS SOMEBODY HAS ALREADY PLACED, AS ALIGNMENT TARGETS, and nothing
   else. The rest of that screen snaps to the drawing — walls, room centres,
   the objects on the ceiling — through `snapTargets`, and that is right for a
   fitting whose position is about the ROOM. A row of hand-placed downlights is
   about ITSELF: the thing that has to be true is that the fourth one is level
   with the other three, and a wall three feet away pulling it off that line
   would be the drawing overruling the row.

   THE SPAN RUNS FROM THE LAMP TO THE POINTER, which is why these are built
   here instead of through `collectTargets`. That helper spans an object by its
   own radius — a two-inch tick beside a downlight — and what says "these two
   are in line" is the line BETWEEN them. Same construction the pen's own point
   targets use, with the far end filled in.

   IT SNAPS AS WELL AS DRAWING, and that is not a contradiction of the "no
   clamp" rule in lib/cob.js. That rule is about the ENGINE: the wall band and
   the bed are the layout's opinions, and a tool built to overrule the layout
   must not be stopped by them. This is not an opinion about where the lamp
   ought to go — it is the difference between a row that is straight and one
   that is seven pixels out, which nobody can hit by hand and everybody wants.
   The tolerance is the app's own, in SCREEN pixels, so it does not stiffen as
   you zoom in to place carefully. */
export function cobAlignTargets(cobsPx, p, exclude = null) {
  const skip = exclude == null ? null
    : exclude instanceof Set ? exclude
    : new Set(Array.isArray(exclude) ? exclude : [exclude]);
  const out = [];
  for (const c of cobsPx) {
    /* A LAMP CANNOT BE ASKED TO LINE UP WITH ITSELF — the same guard
       `collectTargets` states for a dragged object, and without it a drag
       locks solid the moment it starts: the thing under the pointer is within
       nought pixels of its own centre on both axes. */
    if (skip && skip.has(c.id)) continue;
    out.push({ axis: 'x', value: c.x, span: [Math.min(c.y, p.y), Math.max(c.y, p.y)],
               kind: 'object-centre', label: 'aligned' });
    out.push({ axis: 'y', value: c.y, span: [Math.min(c.x, p.x), Math.max(c.x, p.x)],
               kind: 'object-centre', label: 'aligned' });
  }
  return out;
}

/* --- THE TWO THINGS WORTH SAYING BEFORE THE CLICK -------------------------
   AND NEITHER OF THESE TWO STOPS IT. See the header of lib/cob.js: the whole
   tool exists because the engine's answer is sometimes the wrong one, and a
   wall or bed guide that refused the press would be the engine winning the
   argument anyway, in a quieter voice. Physical ceiling-object clearances are
   tested separately below and do refuse placement.
   NULL WHERE THERE IS NOTHING TO SAY, so the canvas draws the ordinary case —
   which is most of the ceiling — with no extra marks on it at all. */
export function cobWallGuide({ room, at, pxPerFt }) {
  if (!room || !at || !(pxPerFt > 0)) return null;
  const polygonPx = room.plan?.polygonPx || room.geo?.polygonPx;
  const near = wallClearance(at, polygonPx, pxPerFt);
  const bed = bedUnder(at, room.plan?.zonesPx ?? []);
  if (!near && !bed) return null;
  return { polygonPx, bandPx: near ? near.limitFt * pxPerFt : 0, bed };
}

/**
 * WHETHER A MANUAL DOWNLIGHT WOULD FOUL A CEILING OBJECT'S RESERVED AREA.
 *
 * `fansPx` is the exact pixel-space list used to draw the dashed clearance
 * outlines. `surfaceDistance` is the planner's own face-distance calculation,
 * so a round fan and a rotated rectangular cassette are tested against the
 * same geometry the automatic layout obeys. Wall and bed warnings remain
 * advisory; a physical ceiling obstruction is the one hard refusal.
 */
export function cobObstacleBlocked({ room, at, pxPerFt, clearanceFt }) {
  if (!room || !at || !(pxPerFt > 0) || !(clearanceFt >= 0)) return false;
  const obstacles = room.plan?.fansPx ?? room.geo?.fansInRoom ?? [];
  const clearancePx = clearanceFt * pxPerFt;
  return obstacles.some((f) => !f.offCeiling && surfaceDistance(f, at) < clearancePx);
}

/**
 * WHAT A CHUNK HAS ALREADY BEEN DECIDED AT, if anybody has decided.
 *
 * Only a lamp somebody OVERRULED — on the bar, or in the Analysis panel — is a
 * decision. Mere presence counted as one would freeze the chunk at the first
 * lamp's own cell's answer and every larger cell beside it would inherit a lamp
 * too small. See `placeCob` and the spec setter.
 *
 * BY CHUNK AND NOT BY CELL, so the lookup is on `cell.chunk`, which the planner
 * stamps on every cell it cuts.
 */
export function chunkSpecInForce({ cobs, room, pxPerFt }) {
  return (cell) => {
    if (!room || cell?.chunk == null || !(pxPerFt > 0)) return null;
    const cells = room.plan?.gridCellsPx ?? [];
    for (const c of cobs) {
      if (c.roomId !== room.id || !c.spec) continue;
      const at = { x: c.xFt * pxPerFt, y: c.yFt * pxPerFt };
      const home = cells.find((q) => at.x >= q.x0 && at.x <= q.x1
                                  && at.y >= q.y0 && at.y <= q.y1);
      if (home?.chunk === cell.chunk) return { watts: c.watts, beam: c.beam };
    }
    return null;
  };
}

/**
 * FILL A SPACE'S GRID CELLS WITH LAMPS — the autoplace toggle's whole job.
 *
 * ONE LAMP PER CELL, AT THE CELL'S OWN SPEC. `autoSpec` in lib/cob.js is the
 * rule and this only applies it: the cell's area decides the wattage, its
 * short side decides the optic, and a chunk that has already been decided
 * overrides both — see `chunkSpecInForce`. It reads `gridCellsPx`, which is the
 * chunker's answer whether or not the old auto-placement is switched on, so
 * this works on the ordinary state of this app.
 *
 * AT THE CELL'S CENTRE AND NOT AT THE PLANNER'S CHOSEN SPOT, and that is a
 * real difference worth stating. The old placement ran a solver: it slid a
 * lamp inside its centre band to line up with its neighbours, promoted pairs
 * of cells to one large fitting, and shoved lamps clear of fans. None of that
 * survives — `cx`/`cy` is the middle of the box. That is the honest reading of
 * "one lamp per cell at ten lumens a square foot": if the grid is right, the
 * middle of a cell is where its lamp goes, and if it is not, the fix is the
 * grid. Everything the solver did can be had back by hand, one lamp at a time,
 * because these are ordinary hand-placeable lamps once they land.
 *
 * IT SKIPS A CELL THAT ALREADY HAS A LAMP IN IT, so switching the toggle on in
 * a space somebody has already worked in adds the missing ones rather than
 * doubling the ones that are there.
 *
 * `auto` MARKS THEM AS THE TOGGLE'S. Switching it off takes back exactly the
 * lamps that are still the toggle's and no others — a lamp that has been
 * dragged or re-specified has been adopted, and losing somebody's work to a
 * checkbox is the one thing a reversible control must not do. See the flag's
 * two clearing points: the spec setter and the drag's commit.
 *
 * RETURNS THE LIST, unchanged BY REFERENCE when there is nothing to add.
 */
export function autoplaceCobs({ room, list, pxPerFt, basis, ownedCells = [] }) {
  if (!room || !(pxPerFt > 0)) return list;
  const cells = room.plan?.gridCellsPx ?? [];
  if (!cells.length) return list;
  /* --- THE TWO PIECES OF CEILING THAT GET NO LAMP -------------------------
     "The previous placement logic goes" is about the SOLVER — the sliding, the
     pairing, the shoving clear of fans — and not about the two rules that say
     a fitting must not be somewhere at all. Those are not tuning; they are the
     reasons the grid was cut the way it was, and a toggle that overrode them
     would put a downlight in the eye of whoever is lying in the bed while the
     app draws a warning about that very thing under the pointer two feet away.

       A NO-LIGHT ZONE is a bed, or a box somebody drew. Tested at the cell's
       CENTRE, because that is where the lamp would land — a cell merely
       clipped by a zone still has somewhere for its fitting to be, and
       refusing it would leave a hole beside every bed.
       A DARK CHUNK is laid out and deliberately unlit — the band outside a
       cove that is carrying the room on its own. See `ch.dark` in planner.js:
       it is an intention rather than a failure, and filling it would be
       undoing a decision the ceiling design made. */
  const zones = room.plan?.zonesPx ?? [];
  const chunksPx = room.plan?.gridChunksPx ?? [];
  const mine = list.filter((c) => c.roomId === room.id);
  const owned = ownedCells instanceof Set ? ownedCells : new Set(ownedCells);
  const taken = (cell) => mine.some((c) => {
    const x = c.xFt * pxPerFt, y = c.yFt * pxPerFt;
    return x >= cell.x0 && x <= cell.x1 && y >= cell.y0 && y <= cell.y1;
  });
  const add = [];
  /* ONE ANSWER PER CHUNK, WORKED OUT ONCE. `chunkSpec` walks every cell in
     the chunk, so asking it per cell would be quadratic on a big room and —
     worse — would invite somebody to "simplify" it back to a per-cell call,
     which is the bug this replaced: two wattages in one run of plasterboard
     because two boxes of the grid were different sizes. */
  const byChunk = new Map();
  const specFor = (ch) => {
    if (!byChunk.has(ch)) {
      byChunk.set(ch, chunkSpec(cells, ch,
        { dropFt: basis.dropFt, lumensPerWatt: basis.lumensPerWatt }));
    }
    return byChunk.get(ch);
  };
  for (const cell of cells) {
    if (!(cell.w > 0 && cell.h > 0) || taken(cell)) continue;
    if (owned.has(lightKey(room.id, cell.id))) continue;
    if (chunksPx[cell.chunk]?.dark) continue;
    const mid = { x: (cell.x0 + cell.x1) / 2, y: (cell.y0 + cell.y1) / 2 };
    if (zones.some((z) => mid.x >= z.x0 && mid.x <= z.x1
                       && mid.y >= z.y0 && mid.y <= z.y1)) continue;
    const held = basis.inForce?.(cell);
    const spec = held ?? specFor(cell.chunk);
    if (!spec) continue;
    add.push({
      ...placeCob({
        /* THE CENTRE OF THE CELL, TAKEN FROM THE BOUNDS AND NOT FROM
           `cx`/`cy`. Those are in the ROOM's own feet — see the note on
           `gridCellsPx` — and would need the room's origin applied again;
           the bounds are already plan pixels. */
        p: mid,
        pxPerFt, roomId: room.id,
        watts: spec.watts, beam: spec.beam,
        /* NOT A DECISION SOMEBODY MADE, even where it inherited one: it is
           the rule's answer for this cell, and `spec` is what marks a lamp
           as having been overruled. Setting it here would freeze the chunk
           on its own output — see `chunkSpecInForce`. */
        spec: false,
        seq: `a${add.length}`,
      }),
      auto: true,
      gridCell: lightKey(room.id, cell.id),
    });
  }
  return add.length ? [...list, ...add] : list;
}

/**
 * EVERY LAMP NOBODY HAS OVERRULED FOLLOWS ITS CHUNK.
 *
 * `chunkSpec` makes a run of downlights uniform at the moment they are PLACED;
 * this keeps them uniform afterwards, which is when it actually matters —
 * because the two things the rule reads both move under the drawing:
 *
 *   THE GRID GETS RE-CUT. A fan is dropped, a cove is added, a chunking is
 *   re-picked, and the chunk that was four equal boxes is now three unequal
 *   ones. The lamps standing in it were sized for a ceiling that no longer
 *   exists.
 *   SOMEBODY OVERRULES ONE. Set a lamp to 12 W on the bar or in the Analysis
 *   panel and every other lamp in its chunk should become 12 W — that is what
 *   `inForce` is for, and until now it only reached lamps placed AFTER the
 *   decision.
 *
 * IT TOUCHES ONLY `spec: false`, WHICH IS THE WHOLE SAFETY OF IT. Such a lamp
 * carries no decision — its wattage IS the rule's answer, recorded at the
 * moment it was placed — so re-deriving it is not overwriting anybody's work,
 * it is keeping a memo in step with what it is a memo OF. A lamp somebody set
 * by hand is never touched, whatever the grid does around it. Same doctrine
 * `lightMoves` follows when a cell is re-cut: a stored override survives, a
 * stored derivation lapses.
 *
 * IT CONVERGES IN ONE EXTRA PASS AND CANNOT LOOP. An unchanged list is
 * returned BY REFERENCE — React bails out of the re-render, so the
 * dependencies that brought us here do not change again. `chunkSpec` is a pure
 * function of the cells and the basis, so there is nothing for it to oscillate
 * between.
 */
export function reconcileCobSpecs({ list, rooms, pxPerFt, basisFor }) {
  let changed = false;
  const next = list.map((c) => {
    if (c.spec) return c;
    const room = rooms.find((r) => r.id === c.roomId);
    const cells = room?.plan?.gridCellsPx ?? [];
    if (!cells.length) return c;
    const at = { x: c.xFt * pxPerFt, y: c.yFt * pxPerFt };
    const home = cells.find((q) => at.x >= q.x0 && at.x <= q.x1
                                && at.y >= q.y0 && at.y <= q.y1);
    /* A LAMP IN NO CELL IS LEFT ALONE — dragged into a cove pocket, or into
       a chunk the design has since taken away. There is nothing to derive
       from, and the figures it is carrying are the last honest answer
       anybody had for it. */
    if (!home) return c;
    const basis = basisFor(room);
    const want = basis.inForce?.(home) ?? chunkSpec(cells, home.chunk, basis);
    if (!want || (want.watts === c.watts && want.beam === c.beam)) return c;
    changed = true;
    return { ...c, watts: want.watts, beam: want.beam };
  });
  return changed ? next : list;
}

/**
 * A LAMP DROPPED OFF EVERY CEILING GOES BACK WHERE IT CAME FROM.
 *
 * `roomId` is what the Analysis counts a lamp under, what its throw is clipped
 * to and what its ceiling height is read from, so a lamp belonging to no space
 * is a fitting that is drawn on the sheet, absent from every reading of it, and
 * impossible to account for. Refusing the drop is kinder than keeping a stale
 * `roomId`, which would put a lamp visibly in the hall and count it in the
 * bedroom.
 */
export function rollbackCobs({ list, ids, startAll, pxPerFt, roomAt }) {
  let changed = false;
  const next = list.map((c) => {
    if (!ids.includes(c.id)) return c;
    if (c.roomId && roomAt({ x: c.xFt * pxPerFt, y: c.yFt * pxPerFt })) return c;
    const base = startAll[c.id];
    if (!base) return c;
    changed = true;
    return { ...c, xFt: base.xFt, yFt: base.yFt, roomId: base.roomId };
  });
  return changed ? next : list;
}

/**
 * IS A DROPPED RUN STILL ON A CEILING?
 *
 * ANY ONE LAMP INSIDE A ROOM IS ENOUGH, and it is deliberately that lenient.
 * A ring set out on a room's own outline has lamps ON the walls, and a strict
 * "every lamp is inside" test would refuse the array's ordinary position. What
 * this catches is the run carried right off the plan.
 */
export function arrayLanded({ lamps, roomAt }) {
  if (!lamps.length) return true;
  return lamps.some((c) => !!roomAt({ x: c.x, y: c.y }));
}

/**
 * WHAT THE BAR ASKS ABOUT THE ARRAY THAT IS OPEN.
 *
 * THE SAME SHAPE THE DRAFT HANDS IT, deliberately — see the `array` prop at
 * the CobSpec call site — because it is the same bar and the same questions.
 * `editing` is the one field that differs, and everything the bar does
 * differently follows from it rather than from a second component.
 *
 * `arrayAsks` DECIDES THE CONTROLS FROM THE GEOMETRY and not from what was
 * stored on the array. That matters after the fact rather than only while
 * setting out: a run set out INSIDE a rectangle that has since been reduced to
 * a line has no inside any more, and a side control offered for it would be
 * offering a choice between two paths with nothing to say which was meant.
 *
 * `null` WHERE THE GEOMETRY HAS GONE. A shape can be deleted from under an
 * array — the geometry is referenced, not owned — and a bar with a label and
 * no path behind it would be a control acting on nothing.
 */
export function arrayBarFor({ array: a, geo, pxPerFt }) {
  if (!a || !geo) return null;
  const asks = arrayAsks(geo.pts, { closed: geo.closed, isRoom: geo.isRoom,
                                    corners: geo.corners });
  return {
    watts: clampWatts(a.watts), beam: nearestBeam(a.beam),
    array: {
      editing: true, picked: true, label: geo.label,
      /* THE COUNT AS THE GEOMETRY CAN PRODUCE IT, not as it happens to be
         stored. A plan saved before the corners mattered, or an array whose
         hexagon has since been resized into a rectangle, would otherwise show
         a figure the drawing is not obeying — `arraySpots` quantises what it
         draws, so the bar has to quantise what it prints or the two disagree
         about the run in front of you. */
      count: quantiseCount(a.count, arrayQuanta(geo.corners, geo.closed)),
      sideId: a.side, offsetFt: a.offsetFt ?? 0,
      side: asks.side, sides: asks.sides,
      /* WHAT THE NUMBER BOX MAY STEP IN — one per corner and up in whole
         passes round the shape. See `arrayQuanta`. */
      countMin: asks.countMin, countStep: asks.countStep,
      // FEET AT THE CONTROL, PIXELS IN THE OUTLINE — the draft's own note.
      maxOffsetFt: asks.maxOffsetFt / (pxPerFt || 1),
    },
  };
}

/**
 * THE DRAFT AFTER A PRESS PICKED A GEOMETRY.
 *
 * WHAT IT OPENS ON: ONE LAMP PER CORNER, on the line itself.
 * THE COUNT COMES FROM THE GEOMETRY AND IS NOT A CONSTANT. It was 4 for
 * everything, which is the right answer for a rectangle and a wrong one for a
 * triangle (a lamp stranded mid-edge) and for a hexagon (four of six corners
 * served). One per corner is the smallest run that describes the shape it was
 * set out on, and it is the base every step of the control counts from — see
 * `arrayQuanta`.
 * `on` RATHER THAN A SIDE, because the first thing to be sure of is that the
 * right geometry was picked, and the only arrangement that shows it
 * unambiguously is the one drawn on the geometry. The offset is carried at a
 * foot so that choosing a side is one press and not two.
 */
export function nextArrayDraft(d, { geomId, geo, roomId, watts, beam }) {
  const q = arrayQuanta(geo.corners, geo.closed);
  return {
    side: 'on', offsetFt: 1,
    ...(d ?? {}), geomId, roomId: geo.roomId ?? roomId,
    /* THE COUNT IS RE-ASKED ON EVERY PICK, unlike the side and the
       distance. Those are a preference somebody has expressed and it
       carries to the next geometry; a count is a fact about the shape
       underneath, and eight carried from a rectangle onto a triangle is a
       run of eight on three corners. `quantiseCount` would rescue it to
       nine, which is a number nobody asked for either — so the new
       geometry answers for it. */
    count: d?.geomId === geomId ? quantiseCount(d.count, q) : q.base,
    watts: d?.watts ?? watts, beam: d?.beam ?? beam,
  };
}

/**
 * WHAT THE BAR ASKS ABOUT THE ARRAY BEING SET OUT.
 *
 * THE SAME QUESTIONS THE PLACED ARRAY'S BAR ASKS, and `arrayAsks` answers both
 * from the geometry — no side or distance for an open path, no outward for a
 * room — so the bar draws what it is handed rather than working it out from a
 * flag per question. See lib/cob.js.
 *
 * `{ picked: false }` UNTIL A GEOMETRY HAS BEEN TAKEN. The bar is up with the
 * tool and has to say so; a label with no path behind it would be a control
 * acting on nothing.
 */
export function arrayDraftBar({ draft: d, geo, pxPerFt }) {
  if (!geo || !d) return { picked: false };
  const asks = arrayAsks(geo.pts, { closed: geo.closed, isRoom: geo.isRoom,
                                    corners: geo.corners });
  return {
    picked: true, label: geo.label,
    count: d.count, sideId: d.side, offsetFt: d.offsetFt,
    side: asks.side, sides: asks.sides,
    /* THE GEOMETRY'S OWN STEPS — see `arrayQuanta`. A rectangle counts 4, 8,
       12; a hexagon 6, 12, 18; a circle, which has no corner a lamp is owed,
       counts freely. */
    countMin: asks.countMin, countStep: asks.countStep,
    /* THE LIMIT IS IN FEET AND THE OUTLINE IS IN PIXELS, so it is converted
       here rather than at the input — which reads feet, like every other length
       somebody types into this app. */
    maxOffsetFt: asks.maxOffsetFt / (pxPerFt || 1),
  };
}

/** THE COUNT A DRAFT'S NUMBER BOX MAY HOLD, against its own geometry. The box
 *  steps in the right units, but it is also typable and its arrows can be held
 *  — and a draft holding a count the geometry cannot produce would draw a run
 *  that disagreed with the figure beside it. Same rule the placed array's setter
 *  applies; see `quantiseCount`. */
export function draftCount(d, geo, n) {
  const q = arrayQuanta(geo?.corners, geo?.closed ?? true);
  return Math.min(200, quantiseCount(n, q));
}

/**
 * WHERE A MODULE LANDS ON ITS RUN.
 *
 * ONE AXIS, AND IT IS NOT A CONSTRAINT THIS APP INVENTED. A module clips
 * anywhere along a magnetic profile and nowhere across one, so "move it" can
 * only mean "move it along" — which is why this resolves the pointer to a
 * FRACTION of the path rather than to a point. Drag it out into the middle of
 * the room and it slides to the nearest place on the rail, which is the honest
 * answer rather than a refusal.
 *
 * AND IT WILL NOT SIT ON ANOTHER ONE. `placeableU` is what the placing press
 * runs too: two bodies cannot share an inch of extrusion, so a drag that would
 * overlap lands at the nearest gap instead of stacking.
 *
 * `null` MEANS THE RUN IS FULL — leave the module where it is.
 */
export function moduleU({ run, p, taken, kind, watts }) {
  const host = asPathHost(run);
  if (!host) return null;
  /* TWO STEPS AND THEY ARE DIFFERENT KINDS OF THING. `pathU` is the PRIMITIVE:
     where on this path does the pointer project to, which is the same division
     every constrained point on the canvas goes through. `placeableU` is the
     PRODUCT: the nearest fraction at which this body actually fits, or null
     when the run is full. Keeping them apart is what lets the module's drag
     hand the second one to `usePointDrag` as its `clamp` and inherit the
     first. */
  return placeableU(host.pts, pathU(host, p), taken, kind,
                    { closed: host.closed, watts });
}
