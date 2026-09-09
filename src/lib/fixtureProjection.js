import { pointInPolygon } from './geometry.js';
import { SHAPE_BY_ID, outlineFt as shapeOutlineFt, cornersFt as shapeCornersFt,
         pathLengthFt, isOpen as shapeIsOpen, isTrack as shapeIsTrack,
         isBuilt as shapeIsBuilt, frameFt as shapeFrameFt, handlesFor,
         editablePath as shapeEditablePath } from './ceilingShapes.js';
import { MODULE_BY_ID, moduleLenIn } from './magTrack.js';
import { resolvePoint } from './point.js';
import { asPathHost } from './path.js';
import { arraySpots, arrayPath, throwDiameterFt, DEFAULT_DROP_FT } from './cob.js';
import { STRIP_OFFSET_FT } from './cove.js';


/**
 * THE SETTING-OUT LINE OF THE ARRAY THAT IS OPEN — the "connector".
 *
 * DRAWN ONLY WHILE ITS ARRAY IS SELECTED, and that is the honest lifetime. It
 * is not a thing on the ceiling: nobody builds it, it appears on no drawing
 * that leaves here, and a dashed ring left under every array for ever would be
 * the sheet claiming a line that is not there. What it IS is the array's
 * handle — the one mark that says twelve separate lamps are one object — and
 * the moment that matters is the moment somebody has hold of it.
 *
 * IT IS ALSO WHAT MAKES THE RUN DRAGGABLE BY SOMETHING OTHER THAN A LAMP. On
 * a ring of four the lamps are four small targets a long way apart; the line
 * between them is the whole geometry and can be grabbed anywhere.
 */
export function projectSelectedArrayPathPx(cobArrays, selArrayId, arrayOutline, pxPerFt) {
    const a = cobArrays.find((q) => q.id === selArrayId);
    if (!a || !(pxPerFt > 0)) return null;
    const geo = arrayOutline(a.geomId);
    if (!geo) return null;
    const pts = arrayPath(geo.pts, {
      closed: geo.closed, side: a.side, offsetFt: (a.offsetFt || 0) * pxPerFt,
      dx: (a.dxFt || 0) * pxPerFt, dy: (a.dyFt || 0) * pxPerFt });
    return pts?.length > 1 ? { pts, closed: geo.closed, id: a.id } : null;
  }

/* --- HAND-PLACED COBs, IN THE SPACE THE CANVAS DRAWS IN --------------------
   THE STORE IS FEET AND EVERY READER WANTS PIXELS, so the conversion happens
   once, here, rather than in the four places that draw, count and hit-test
   them. It is the same shape `trackEditPx` and `penDraftPx` take, and the same
   multiplication: plan feet are plan pixels over `pxPerFt` with no origin to
   subtract, because unlike a room's own feet they are measured from the
   sheet's corner. */
export function projectManualCobsPx(manualCobs, pxPerFt, ceilingMmFor) {
  return pxPerFt > 0
    ? manualCobs.map((c) => ({
        ...c, x: c.xFt * pxPerFt, y: c.yFt * pxPerFt,
        /* WHAT THIS LAMP THROWS, AS A DIAMETER IN FEET. Computed here rather
           than on the canvas because it takes the SPACE's ceiling height, and
           the canvas is handed one flat list of fittings rather than a list per
           room. It is a real number for once: every other pool on this sheet is
           read out of THROW_STYLE's three stated diameters, which were worked
           out on a 9 ft assumption because the app had no height when they were
           written. A hand-placed lamp states its own beam angle and sits in a
           space with its own recorded height, so its pool is computed from both.
           See throwDiameterFt. */
        throwFt: throwDiameterFt(c.beam,
          (ceilingMmFor(c.roomId) / 304.8) || DEFAULT_DROP_FT),
      }))
    : [];
}

/* --- THE DRAWN COVES, FOR THE CANVAS ----------------------------------------
   PLAN PIXELS, because that is the space the canvas draws in, and the
   conversion is a multiply: a shape is held in the plan's own feet, whose
   origin is the drawing's own. See ceilingShapes.

   lit IS THE ONE NON-OBVIOUS FIELD. A shape over a lit space is already on
   the sheet — the room's covesPx carries its setting-out line and the accents
   carry its tape — so drawing it again in the shapes layer would be two marks
   for one object, at slightly different weights. A shape the layout did NOT
   take up has nothing else drawing it, and an object that disappears when you
   commit it is worse than one drawn twice. So the layer is told which is which
   and draws only the ones nobody else did. */
export function projectCoveShapesPx(ceilingShapes, litShapeIds, shapePts, pxPerFt) {
  return pxPerFt ? ceilingShapes.map((sh) => ({
    id: sh.id,
    /* AN OPEN COVE IS ALWAYS "LIT", because the accent layer is always drawing
       it — it does not go through the ceiling design and so never appears in a
       room's `coves`, but it does become a run (see `accentZonesPx`) and that
       run is on the sheet whether the space has a layout or not. Without this it
       would be drawn twice: the tape, and a dashed line under it. */
    /* A GUIDE IS NEVER "LIT". `lit` means something else on this sheet is already
       drawing the shape — its setting-out line among the room's coves, its tape
       among the accents — so this layer owes it only a way to grab it. Nothing
       else draws a guide, by definition, so this layer draws it: the dashed
       outline is the whole of the mark. */
    /* `lit` MEANS SOMETHING ELSE IS ALREADY DRAWING THIS SHAPE — its
       setting-out line among the room's coves, its tape among the accents. Only
       a COVE ever is: a guide is drawn by this layer alone, and a magnetic
       track by the track layer, which draws the profile itself rather than a
       dotted line to set out from. */
    lit: shapeIsBuilt(sh) && (litShapeIds.has(sh.id) || shapeIsOpen(sh)),
    /* AND WHETHER THIS LAYER OWES IT A DASHED LINE AT ALL. A track is drawn
       SOLID, as a visible profile with modules on it — see the track layer — so
       a dotted setting-out line under it would be two marks for one object at
       two different weights, which is the exact fault `lit` exists to prevent. */
    track: shapeIsTrack(sh),
    open: shapeIsOpen(sh),
    pts: shapePts(sh),
    /* THE TAPE IS PART OF THE OBJECT AND HAS TO BE GRABBABLE TOO. On the sheet
       a drawn cove is two marks three inches apart — the dotted setting-out
       line, and the run of glowing dots outside it — and to anybody looking at
       it they are one thing. Offering the grab on only the line meant aiming at
       the fainter of the two, with the brighter one sitting right beside it
       doing nothing.
       BOTH LISTS RATHER THAN ONE FAT BAND OVER THE PAIR, because three inches
       is three inches: at low zoom the two are a pixel apart and one band covers
       both, and at high zoom they are far enough apart that a band wide enough
       to span them would be a band reaching well into the room. */
    /* NO SECOND BAND ON A SLOT. The tape and the setting-out line are three
       inches apart on a pocket and are the same line on a slot — see `outlineFt`
       — so offering both here would be two grab bands on one set of points. */
    tape: (shapeIsOpen(sh) || !shapeIsBuilt(sh)) ? null
      : shapePts(sh, STRIP_OFFSET_FT),
    /* THE FRAME AND ITS GRIPS, drawn only on the shape whose dimensions are
       being asked for. Which grips there are is a fact about the SHAPE — a
       circle has no edge to drag independently, see `handlesFor` — so it is
       answered here where the shape is, and the canvas draws what it is given. */
    frame: (() => { const f = shapeFrameFt(sh);
      return { x0: f.x0 * pxPerFt, y0: f.y0 * pxPerFt,
               x1: f.x1 * pxPerFt, y1: f.y1 * pxPerFt }; })(),
    handles: handlesFor(sh),
  })) : [];
}

export function projectDraftShapePx(shapeDraft, shapePts, pxPerFt) {
  return shapeDraft && pxPerFt
      ? { pts: shapePts(shapeDraft), open: shapeIsOpen(shapeDraft) } : null;
}
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
      const t = magTrackById[f.on];
      if (!t) continue;
      /* THE RUN AS A PATH, THE MODULE AS A POINT HELD ON IT. `resolvePoint` is
         lib/point.js's one reader of a constrained point's position, so a
         module is placed by exactly the arithmetic every other point on this
         canvas is — and `null` still means "not on the drawing" rather than a
         fitting at the origin, which is the note above. */
      const at = resolvePoint(f, asPathHost(t));
      if (!at) continue;
      const m = MODULE_BY_ID[f.kind] ?? MODULE_BY_ID.spot;
      out.push({
        id: f.id, on: f.on, kind: f.kind, roomId: t.roomId,
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

/* THE DRAWN RUN IN FLIGHT, IN THE PEN DRAWING THE COVE PEN ALREADY HAS.
   `closed: false` is the whole difference: no dashed closing leg back to the
   first point, and no ring round it, because clicking it does nothing. See
   the canvas — one drawing, two pens, which is the same argument usePen
   makes about the state behind them. */
export function projectTrackDraftPx(pxPerFt, addTool, pts, at, isEmpty) {
    if (!pxPerFt || addTool !== 'track' || isEmpty) return null;
    const toPlanPx = (q) => ({ x: q.x * pxPerFt, y: q.y * pxPerFt });
    /* CLOSED, NOW THAT THE TRACK PEN CLOSES. The dashed leg back to the first
       point and the ring round it are both promises about a click that works —
       which is exactly what they were not while this said `false`. */
    return { pts: pts.map(toPlanPx), closed: true,
             at: at ? toPlanPx(at) : null };

}

/* THE OPEN PATH IN PLAN PIXELS. The one drawing on this canvas that shows a
   drawn run whole: `tracksPx` carries it clipped to each room it crosses (see
   `trackRunsInRoom`), and a corner that fell in a doorway appears in neither
   room's copy. */
export function projectTrackEditPx(pxPerFt, trackEditId, manualTracks) {
    if (!pxPerFt || !trackEditId) return null;
    const t = manualTracks.find((q) => q.id === trackEditId);
    if (!t) return null;
    /* `of` SAYS WHICH STORE THE VERTEX BELONGS TO. Two things on this canvas
       have an editable path — a drawn track in `manualTracks` and a `pen` or
       `line` ceiling shape — and they are the SAME editor: a polyline and a
       grip per vertex. One canvas block draws both, so the record has to say
       where a moved vertex is written back. See `projectShapeEditPx`. */
    return { of: 'track', id: t.id, closed: !!t.closed,
             pts: t.ptsFt.map((q) => ({ x: q.x * pxPerFt, y: q.y * pxPerFt })) };

}

/**
 * THE SHAPE BEING EDITED, AS THE SAME POINT EDITOR A DRAWN TRACK GETS.
 *
 * WHY THIS EXISTS AT ALL: a magnetic track run IS a ceiling shape, and a single
 * straight run had no way to be edited. `handlesFor` refused it grips under a
 * rule written for a cove slot, and nothing else offered its two ends. A run is
 * a PATH — `editablePath` is the host — and a path's vertices are points, so the
 * editor a drawn track already had is the editor this wants.
 *
 * ONLY WHERE THERE ARE VERTICES TO EDIT. `editablePath` answers `null` for
 * every box-parameterised kind, because a circle's seventy-two outline points
 * are derived and there is no field to write one back to. Those resize.
 */
export function projectShapeEditPx(pxPerFt, shapeEditId, ceilingShapes) {
    if (!pxPerFt || !shapeEditId) return null;
    const sh = (ceilingShapes ?? []).find((q) => q.id === shapeEditId);
    const host = sh ? shapeEditablePath(sh) : null;
    if (!host) return null;
    return { of: 'shape', id: sh.id, closed: !!host.closed,
             pts: host.pts.map((q) => ({ x: q.x * pxPerFt, y: q.y * pxPerFt })) };
}

export function projectPenDraftPx(pxPerFt, shapeMenuOn, shapeTool, pts, at, isEmpty) {
    if (!pxPerFt || !shapeMenuOn || shapeTool !== 'pen' || isEmpty) return null;
    const toPlanPx = (q) => ({ x: q.x * pxPerFt, y: q.y * pxPerFt });
    /* CLOSED, because a cove pen's path encloses something and the canvas
       draws the closing leg dashed to say so before the click that commits it.
       The track pen hands the same drawing `closed: false`. */
    return { pts: pts.map(toPlanPx), closed: true,
             at: at ? toPlanPx(at) : null };

}
