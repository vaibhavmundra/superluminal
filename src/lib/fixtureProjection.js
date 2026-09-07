import { pointInPolygon } from './geometry.js';
import { SHAPE_BY_ID, outlineFt as shapeOutlineFt, cornersFt as shapeCornersFt,
         pathLengthFt, isOpen as shapeIsOpen, isTrack as shapeIsTrack } from './ceilingShapes.js';
import { MODULE_BY_ID, moduleAt, moduleLenIn } from './magTrack.js';
import { arraySpots, arrayPath, throwDiameterFt, DEFAULT_DROP_FT } from './cob.js';

/**
 * EVERY MAGNETIC TRACK ON THE DRAWING, RESOLVED — in plan pixels.
 *
 * DERIVED FROM `ceilingShapes` AND NOT FROM A STORE OF ITS OWN, which is what
 * makes a track editable: drag a grip and the profile moves, because there was
 * never a copy of its path to go stale. See `trackFixtures`.
 *
 * THE LENGTH IS MEASURED FROM THE LIVE OUTLINE AND THE LIVE SCALE, never
 * stored — the rule `runMetres` in boq.js exists to enforce. A run whose scale
 * was corrected after it was drawn is a different number of metres of profile,
 * and a plan that billed the old figure would be ordering the wrong length.
 *
 * `corners` IS THE TURNS AND NOT THE POINTS. A moulded corner join is bought
 * per turn of profile — see boq.js — so a closed rectangle is four and an open
 * L is one. A circle's outline is 72 segments and none of them is a corner
 * anybody orders a join for, which is exactly what `cornersFt` answers: it
 * returns nothing for a circle, and a run on one is a bent extrusion rather
 * than a set of mitres.
 *
 * `roomId` IS WHERE THE MIDDLE OF IT IS. A profile drawn across a threshold
 * belongs to one room for the purposes of the Analysis, and the honest single
 * answer is the space its centre is over — the same reading `arrayOutline`
 * takes for a shape. The absorbing track splits itself per room because it is
 * billed per room off the layout; this one is a hand-placed object and is
 * counted where it sits.
 */
export function projectMagTracksPx(ceilingShapes, rooms, pxPerFt) {
    if (!(pxPerFt > 0)) return [];
    const out = [];
    for (const sh of ceilingShapes) {
      if (!shapeIsTrack(sh)) continue;
      const toPx = (q) => ({ x: q.x * pxPerFt, y: q.y * pxPerFt });
      const pts = shapeOutlineFt(sh).map(toPx);
      if (pts.length < 2) continue;
      const closed = !shapeIsOpen(sh);
      const cn = shapeCornersFt(sh).length;
      const home = rooms.find((r) => pointInPolygon(
        { x: sh.x * pxPerFt, y: sh.y * pxPerFt }, r.geo.polygonPx));
      out.push({
        id: sh.id, pts, closed,
        lengthFt: pathLengthFt(pts, { closed }) / pxPerFt,
        // A CLOSED RUN TURNS AT EVERY CORNER; AN OPEN ONE HAS TWO FEWER, because
        // its two ends are cut rather than mitred.
        corners: cn >= 3 ? (closed ? cn : cn - 2) : 0,
        roomId: home?.id ?? null,
        label: SHAPE_BY_ID[sh.kind]?.label ?? 'Track',
      });
    }
    return out;
  
}

/**
 * EVERY MODULE, RESOLVED ONTO ITS RUN — what the drawing and the Analysis both
 * read. Nothing here is stored; see `trackFixtures` for why.
 *
 * A MODULE WHOSE RUN HAS GONE IS DROPPED RATHER THAN DRAWN AT THE ORIGIN. The
 * shape can be deleted from anywhere — the bar, the Delete key, a cleared plan
 * — and `deleteShape` takes the fixtures with it, so this is the belt to that
 * braces: a stale entry produces nothing rather than a fitting floating off
 * the drawing.
 */
export function projectTrackModulesPx(trackFixtures, magTrackById, pxPerFt) {
    if (!(pxPerFt > 0)) return [];
    const out = [];
    for (const f of trackFixtures) {
      const t = magTrackById[f.trackId];
      if (!t) continue;
      const at = moduleAt(t.pts, f.u, { closed: t.closed });
      if (!at) continue;
      const m = MODULE_BY_ID[f.kind] ?? MODULE_BY_ID.spot;
      out.push({
        id: f.id, trackId: f.trackId, kind: f.kind, roomId: t.roomId,
        x: at.x, y: at.y, ux: at.ux, uy: at.uy,
        /* INCHES, BECAUSE THAT IS WHAT THE PRODUCT IS AND WHAT THE CANVAS DRAWS
           FROM. `inch()` there turns them into drawing units at the live scale,
           exactly as the absorbing track's heads are drawn — see TRACK_DIMS_IN.
           Handing feet would have been a second unit for one dimension.
           AND THE LENGTH IS ASKED OF THE WATTAGE. A diffuser's body is a band of
           its output — 200 mm under 15 W, 400 to 25, 600 above (see
           `DIFFUSER_LENGTHS_MM`) — so a 5 W corner module and an 18 W one are
           two different objects on the drawing. It was a flat 24 in for every
           diffuser, which drew the whole range as the biggest thing in it. */
        lenIn: moduleLenIn(f.kind, f.watts), wideIn: m.wideIn ?? 1.5,
        watts: f.watts ?? m.watts, beam: f.beam ?? m.beam,
      });
    }
    return out;
  
}

/**
 * EVERY ARRAY'S LAMPS, WORKED OUT AFRESH — what the drawing and the schedule
 * both read. Nothing here is stored; see `cobArrays` for why.
 */
export function projectArrayCobsPx(cobArrays, arrayOutline, pxPerFt, ceilingMmFor) {
    if (!(pxPerFt > 0)) return [];
    const out = [];
    for (const a of cobArrays) {
      const geo = arrayOutline(a.geomId);
      if (!geo) continue;
      const pts = arraySpots(geo.pts, {
        closed: geo.closed, side: a.side, offsetFt: (a.offsetFt || 0) * pxPerFt,
        count: a.count,
        /* WHERE THE LAMPS ARE OBLIGED TO SIT, which is what makes a run on a
           rectangle land on its corners rather than at four equal steps round
           its perimeter. See `arraySpots`; a shape with none — a circle — is
           spaced freely. */
        corners: geo.corners,
        /* WHERE THE RUN HAS BEEN DRAGGED TO, in pixels because the outline is.
           Stored in FEET on the array for the reason every other placed thing on
           this drawing is — see `manualCobs` — so a scale correction does not
           carry the run across the ceiling. */
        dx: (a.dxFt || 0) * pxPerFt, dy: (a.dyFt || 0) * pxPerFt,
      });
      pts.forEach((p, i) => out.push({
        id: `${a.id}#${i}`, arrayId: a.id, roomId: a.roomId ?? geo.roomId,
        x: p.x, y: p.y, watts: a.watts, beam: a.beam,
        throwFt: throwDiameterFt(a.beam,
          (ceilingMmFor(a.roomId ?? geo.roomId) / 304.8) || DEFAULT_DROP_FT),
      }));
    }
    return out;
  
}

/** The draft array's lamps, drawn while the bar is still asking about them —
 *  the same resolution the committed ones go through, so what you are looking
 *  at is what the tick will keep. */
export function projectDraftArrayPx(cobDraftArray, arrayOutline, pxPerFt) {
    const d = cobDraftArray;
    if (!d?.geomId || !(pxPerFt > 0)) return null;
    const geo = arrayOutline(d.geomId);
    if (!geo) return null;
    const pts = arraySpots(geo.pts, {
      closed: geo.closed, side: d.side, offsetFt: (d.offsetFt || 0) * pxPerFt,
      count: d.count, corners: geo.corners,
    });
    const path = arrayPath(geo.pts, {
      closed: geo.closed, side: d.side, offsetFt: (d.offsetFt || 0) * pxPerFt });
    return { pts, path, closed: geo.closed, geo };
  
}

