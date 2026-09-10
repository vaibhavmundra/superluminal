import { toObstaclePx } from './ceilingObjects.js';
import { pointInPolygon } from './geometry.js';
import { gridFor, cellsToPlanPx, cellsToRect } from './wallGrid.js';
import { WALL_BY_ID } from './wallPrompt.js';
import { sliceRect, artWidthFt, spotCountFor, litByArtSpots, planArtSpots,
         ART_SPOT } from './artSpots.js';
import { planTaskSpots, isBedZone, SPOT_DEFAULTS } from './taskSpots.js';
import { absorbPoints, SPOT_LEN_FT, DODGE_FT } from './track.js';
import { trackFixtureFor } from './boq.js';
import { outlineFt as shapeOutlineFt, isOpen as shapeIsOpen,
         isBuilt as shapeIsBuilt, runLengthFt } from './ceilingShapes.js';

// --- traced outlines --------------------------------------------------------
// Stored in the plan's own units and resolved into the current pixel space
// for use. On a DXF that indirection is load-bearing: correct the unit
// interpretation and the outline is reinterpreted exactly as the walls are,
// so it stays on its walls instead of sliding off them. On an image the pair
// is the identity — its pixels ARE its units — and the same code runs.
export function projectOutlinesPx(source, outlines) {
  if (!source) return [];
  return outlines.map((o) => ({
    ...o,
    pointsPx: o.pointsDu.map(source.fromDu),
    enclosingPx: o.enclosingDu ? o.enclosingDu.map((poly) => poly.map(source.fromDu)) : null,
  }));
}

/**
 * EVERY OBSTACLE ON THE CEILING, in plan pixels.
 *
 * One source since the red-circle detector was removed: the objects somebody
 * placed. They are held in FEET and converted here, which is what keeps them
 * the same real size when the scale is corrected underneath them.
 *
 * The planner is handed { x, y, r } and is not told what kind of thing it is
 * looking at — see the note in planner.js about why it calls them all fans.
 */
export function projectObstaclesPx(ceilingObjs, pxPerFt) {
  if (!pxPerFt) return [];
  return ceilingObjs.map((o) => toObstaclePx(o, pxPerFt));
}

/**
 * ...AND THE ONES THE GRID ACTUALLY HAS TO KEEP OFF.
 *
 * NOT ALL OF THEM, SINCE THE PALETTE GREW. A split AC's indoor unit hangs at
 * 2100mm on a wall and a geyser sits above a toilet door: both are placed on
 * this plan, both are drawn, both are on the schedule, and neither obstructs a
 * downlight in the middle of a ceiling. Handing them to the planner would
 * punch a hole in the layout for something that is not in its way — and
 * because clearance is circumscribed (see ceilingObjects.js), a 1000mm split
 * unit would reserve a two-and-a-half-foot radius of ceiling it is nowhere
 * near.
 *
 * ONE FLAG, ASKED OF THE CATALOGUE, and this is the only place it is read. The
 * full list stays whole for everything else — the canvas draws them, the
 * schedule counts them, the DXF and the plot carry them — because being off
 * the ceiling is a fact about clearance and about nothing else.
 */
export function projectCeilingObstaclesPx(obstaclesPx) {
  return obstaclesPx.filter((o) => !o.offCeiling);
}

/**
 * THE WARDROBES THE ACCENT PASS FOUND, in plan pixels, room by room.
 *
 * `accentResults[id].furniture` is what the RULES saw — the list the strips
 * and sconces were derived from, with this pass's own loose bed boxes already
 * swapped for the measured ones (see `computeAccents`). So a wardrobe in here
 * is a wardrobe the app has already acted on: it is the reason there is a
 * strip along that wall, and this is the same rectangle that produced it.
 *
 * OFF `litOutlines` AND NOT `rooms`, which is not a style preference — it is
 * the only ordering that works. `rooms` is computed FROM the zone list, and
 * the zone list is about to contain these; reading `rooms` here would be a
 * cycle. The results are keyed by the outline's own id, so there is nothing
 * `rooms` could add.
 */
export function projectWardrobesPx(litOutlines, accentResults) {
  const out = [];
  for (const o of litOutlines) {
    for (const f of accentResults[o.id]?.furniture ?? []) {
      if (f.type !== 'wardrobe' || !f.rect) continue;
      out.push({ id: `wd-${f.id}`, roomId: o.id, rect: f.rect });
    }
  }
  return out;
}

/**
 * What the canvas draws: every surface still standing, in plan pixels.
 * Every task surface on the plan, whatever put it there.
 *
 * TWO SOURCES, ONE LIST. The detector's surfaces and the ones drawn by hand
 * with the spot tool are the same kind of object and go through the same
 * placer below — which is why the spot tool is a surface tool underneath. A
 * hand-drawn area gets a spot on the secondary grid for the same reason a
 * detected dining table does, and neither of them knows about the other.
 */
export function projectSurfacesPx(rooms, surfaceResults, surfaceDismissed, manualSurfaces) {
    const out = [];
    for (const r of rooms) {
      const res = surfaceResults[r.id];
      if (!res?.surfaces) continue;
      for (const sf of res.surfaces) if (!surfaceDismissed.includes(sf.id)) out.push(sf);
    }
    const live = new Set(rooms.map((r) => r.id));
    return [...out, ...manualSurfaces.filter((m) => live.has(m.roomId))];

}

/**
 * THE ART ON THE WALLS, one entry per PIECE, in plan pixels.
 *
 * Per piece and not per spot, and that is the change the drawing asked for. A
 * row of spots lighting one picture is placed as a formation — one line, a
 * fixed spacing, all of it or none — so the unit handed to the placer has to
 * be the picture, with the number of fittings it wants as a field. Handing it
 * the fittings one at a time is what put a pair several feet apart on two
 * different lines. See the header of the placement section in artSpots.js.
 */
export function projectArtPiecesPx(rooms, wallResults, pxPerFt, artDismissed) {
    const out = [];
    for (const r of rooms) {
      const res = wallResults[r.id];
      if (!res?.elements?.length || !r.plan?.ok) continue;
      const grid = gridFor(r.plan.polygonPx, pxPerFt);
      if (!grid) continue;
      for (const e of res.elements) {
        if (!litByArtSpots(e.type)) continue;
        // NOT LIT, BY SOMEBODY'S DECISION. Dropped here rather than filtered out
        // of the finished spots, so the row's segments go back to the ceiling and
        // the piece stops appearing as a refusal in the panel. A deleted fitting
        // should leave no trace of itself in the layout, and a rejection with no
        // fitting is a trace.
        if (artDismissed.includes(e.id)) continue;
        const rect = e.cells?.length ? cellsToRect(e.cells, grid) : null;
        if (!rect) continue;
        const { ft, from } = artWidthFt(e, grid);
        out.push({
          id: e.id, roomId: r.id, type: e.type,
          label: WALL_BY_ID[e.type]?.label || e.type,
          colour: WALL_BY_ID[e.type]?.colour || '#666',
          rect,
          // Which way the run lies, which is also which way the wall runs, which
          // is also the axis the row of spots has to lie along.
          horizontal: e.start && e.end ? e.start.y === e.end.y : true,
          n: spotCountFor(ft), widthFt: ft, widthFrom: from,
        });
      }
    }
    return out;

}

/**
 * A DIRECTIONAL SPOT FOR EVERY TASK SURFACE, on the secondary grid.
 *
 * Derived, not stored. The spot is a function of the surface, the ambient
 * layout and the obstacles, and all three of those move — nudge a fan and the
 * segment the spot was standing on can become illegal. Holding it in state
 * would mean a spot that is right when it is computed and quietly wrong ever
 * after; recomputing means it is always the answer to the layout as it
 * actually is.
 *
 * Everything crosses into the room's own FEET here, because that is the space
 * the chunks, the lights and the clearance rules all already live in, and
 * back out to plan pixels for the canvas.
 */
/* HOW FAR IN FRONT OF A HAND-PLACED SPOT ITS AIM POINT SITS WHEN THE RECORD
   DOES NOT SAY, in plan feet.
   IT WAS THE FIGURE FOR EVERY HAND-AIMED SPOT AND IT IS NOW ONLY THE FALLBACK,
   which is the correction of a real fault. The note here argued that "a
   hand-aimed spot has a direction and no target at all, so something has to
   stand in for one" — and that was simply not true of the gesture: the second
   click lands ON something, and its distance was being discarded on the way to
   the store. So a spot aimed at a table four feet away was drawn throwing at a
   point six feet away, past the table, and the heatmap tilted the cone to
   match. Aiming at a thing and lighting somewhere else is the one mistake this
   fitting cannot afford, since the arrow is the whole of what makes it a task
   light. The distance is stored now — see `aimFt` in `addSpot`.
   WHAT IS LEFT IS PLANS SAVED BEFORE THAT. They hold an angle and no reach, and
   six feet is what they were drawn with, so it is what they keep: a little over
   the throw of a 5 W narrow lamp at 2.7 m, which makes the pool and the arrow
   agree with each other. */
const HAND_AIM_FT = 6;

export function projectTaskSpotsPx(rooms, surfacesPx, artPiecesPx, opt,
                                   manualSpots = [], pxPerFt = 0) {
    const out = [];
    for (const r of rooms) {
      if (!r.plan?.ok) continue;
      const mine = surfacesPx.filter((sf) => sf.roomId === r.id);
      const art = artPiecesPx.filter((a) => a.roomId === r.id);
      if (!mine.length && !art.length) continue;
      const { toFt, toPx } = r.geo;
      const rectFt = (rect) => {
        const a = toFt({ x: rect.x0, y: rect.y0 });
        const b = toFt({ x: rect.x1, y: rect.y1 });
        return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y),
                 x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
      };
      // The ceiling as both passes see it. One object, so a rule added to one
      // pass cannot quietly apply to only half the fittings in the room.
      const ceiling = {
        chunks: r.plan.chunks,
        lights: r.plan.lights,
        polygon: r.plan.polygonFt,
        fixtures: r.geo.fixturesFt,
        chandeliers: r.geo.fixturesFt.filter((f) => f.kind === 'chandelier'),
        zones: r.plan.zones ?? [],
        // The cove line, where there is one, so a spot keeps off it for the
        // same reason every other fitting does. `plan.opt` is the resolved
        // options the layout was actually built with, coves included.
        coves: r.plan.opt?.coves ?? [],
        // THE RAILS, FLATTENED, SO THE PLACER IS NOT TRACK-BLIND.
        //
        // Step 3 below still pulls a finished spot onto the profile if it
        // landed within reach of one, and that pass is not going away: it is
        // what actually moves the fitting and it is the only thing that knows
        // which inches of profile the ambient modules already hold. What it
        // cannot do is influence WHICH candidate position the placer picks, so
        // on a track ceiling the placer was choosing between a position that
        // becomes a track module and one that becomes a separate recessed
        // fitting without knowing that was the choice. Now it knows, and prefers
        // the rail by a stated amount rather than by luck. See
        // SPOT_DEFAULTS.trackMissFt.
        //
        // `absorb` rides on each run because it is the track's own figure and a
        // preference derived from a different one would disagree with the pass
        // that does the moving.
        tracks: (r.tracks ?? []).flatMap((t) =>
          (t.runs ?? []).map((run) => ({ ...run, absorb: t.absorb }))),
        opt,
      };

      // --- 1. TASK SURFACES FIRST, unchanged, and first on purpose.
      //
      // ALL of this room's surfaces at once, not one at a time, because the rule
      // that one spot lights one surface is a rule ABOUT THE SET: a segment can
      // only be spent once, and that cannot be decided by a function looking at
      // a single surface. ALL the room's chunks too — a living-dining room has
      // its coffee table in one chunk and its dining table in another, and
      // giving both the same grid puts one of them nowhere near what it is
      // lighting.
      // THE TYPE TRAVELS WITH THE RECT, and it is the only field the placer
      // needs beyond the geometry. Peer surfaces are lit as one run off one
      // ceiling line — see the RUNS header in taskSpots.js — and "peer" is
      // decided first of all by the two being the same kind of thing. A pair of
      // coffee tables is one piece of furniture; a coffee table and a desk that
      // happen to line up are not, and without the type the placer cannot tell
      // them apart and would have to guess.
      const placed = mine.length
        ? planTaskSpots(mine.map((sf) => ({ ...rectFt(sf.rect), type: sf.type })), ceiling) : [];

      mine.forEach((sf, k) => {
        const res = placed[k];
        if (!res?.spot) {
          out.push({ id: `spot-${sf.id}`, surfaceId: sf.id, fixture: 'spot', colour: sf.colour,
                     rejected: res?.rejected, skipped: res?.skipped });
          return;
        }
        const p = toPx(res.spot);
        const t = toPx(res.spot.target);
        out.push({
          id: `spot-${sf.id}`, surfaceId: sf.id, roomId: r.id, fixture: 'spot',
          highlight: sf.rect,
          x: p.x, y: p.y,
          target: t,
          angle: Math.atan2(t.y - p.y, t.x - p.x),
          via: res.spot.via,
          // HOW FAR IT IS AIMING, AND WHETHER THAT IS TOO FAR. A spot past the
          // cap is placed rather than refused — a fitting a person can see and
          // drag beats a sentence in a panel — but it is a compromise, and the
          // drawing and the panel have to be able to say so. Without this the
          // only difference between a good spot and one grazing a wall from
          // eleven feet is how the arrow looks.
          aimFt: res.spot.aimFt,
          far: res.spot.far ?? false,
          // Present only on a spot standing in a run, so the drawing and the
          // tooltip can say WHY it is where it is: the lane was chosen for the
          // group, not for this table on its own.
          run: res.spot.run ?? null,
          // The segment it is standing on, in pixels, so the drawing can show
          // its working when the secondary grid is switched on.
          segment: { a: toPx(res.spot.segment.a), b: toPx(res.spot.segment.b) },
          grid: res.grid ? {
            lines: res.grid.lines.map((l) => ({ ...l, a: toPx(l.a), b: toPx(l.b) })),
          } : null,
        });
      });

      if (!art.length) continue;

      // --- 2. THEN THE ART, out of the way of everything already there.
      //
      // AFTER, AND NOT IN THE SAME CALL. They used to go in together on the
      // reasoning that one placer sharing one used-once set is what stops two
      // fittings landing on one point. That is right about the goal and wrong
      // about the mechanism now: an art row does not stand on a SEGMENT, it
      // stands at a chosen point along a LINE, so the segment ledger says
      // nothing about it. What the two passes have to share is the list of
      // POSITIONS already taken — the ambient downlights included, because the
      // lines this row stands on are the ones those downlights define.
      //
      // Task surfaces still go first, and that is still the same judgement: a
      // dining table is a bigger commitment than a picture and is harder to
      // light from anywhere else.
      const taken = [
        ...r.plan.lights.map((l) => ({ x: l.x, y: l.y })),
        ...placed.filter((q) => q?.spot).map((q) => ({ x: q.spot.x, y: q.spot.y })),
      ];
      const rows = planArtSpots(
        art.map((a) => ({ ...a, rect: rectFt(a.rect) })),
        { ...ceiling, taken });

      art.forEach((a, k) => {
        const res = rows[k];
        if (!res?.spots) {
          // ONE ENTRY FOR THE WHOLE ROW, because the row is what was refused.
          // Pushing `n` identical rejections would report a five-foot picture as
          // two separate failures with one cause.
          // WITH ITS roomId, unlike a refused task spot. Nothing is billed for
          // it — buildBOQ skips anything carrying `rejected` — and the panel
          // needs it: the render pass is a per-space screen, and a refusal it
          // cannot attribute to a space is a refusal it cannot show.
          out.push({ id: `spot-${a.id}`, wallId: a.id, roomId: r.id,
                     fixture: ART_SPOT.fixture, art: true, colour: a.colour,
                     wanted: a.n, rejected: res?.rejected });
          return;
        }
        // WHAT EACH ONE AIMS AT. The row is tight — a foot between fittings —
        // and the artwork is not, so the spots are NOT all pointed at its
        // centre: each takes its own share of the width, which is how a pair
        // lights a five-foot piece evenly instead of twice-lighting the middle.
        const aims = sliceRect(rectFt(a.rect), a.n, a.horizontal);
        res.spots.forEach((sp, i) => {
          const aim = aims[i] ?? rectFt(a.rect);
          const t = toPx({ x: (aim.x0 + aim.x1) / 2, y: (aim.y0 + aim.y1) / 2 });
          const p = toPx(sp);
          out.push({
            id: `spot-${a.id}-${i}`, wallId: a.id, roomId: r.id,
            fixture: ART_SPOT.fixture, art: true, colour: a.colour,
            highlight: a.rect,
            x: p.x, y: p.y,
            target: t,
            angle: Math.atan2(t.y - p.y, t.x - p.x),
            via: 'art-row',
            standoff: sp.standoff, slid: sp.slid, index: i, of: sp.of,
            segment: { a: toPx(sp.line.a), b: toPx(sp.line.b) },
            grid: null,
          });
        });
      });
    }

    // --- 3. AND THEN THE TRACKS TAKE WHAT THEY CAN REACH ------------------
    //
    // A SECOND ABSORPTION PASS, BECAUSE THE TWO LAYERS ARE PLANNED AT DIFFERENT
    // TIMES AND THAT IS NOT AN ACCIDENT OF THE CODE. The ambient grid is settled
    // inside the ceiling design, and the track is set out through it there; the
    // task and art spots are placed HERE, afterwards, against that finished
    // grid. So a spot cannot be absorbed when the profile is drawn — it does not
    // exist yet — and the profile cannot wait for the spots, because the spots
    // are placed relative to the grid the profile was set out to. One pass each,
    // in the only order the dependency allows.
    //
    // `occupied` IS WHAT KEEPS THE TWO HONEST. The ambient modules already hold
    // their inches of profile, and a directional head clipped into the same inch
    // is a clash on site. The track reports its slots (see planTrack) and this
    // pass respects them, so a spot that has nowhere to go stays recessed rather
    // than being drawn on top of a downlight.
    //
    // AFTER THE LOOP AND NOT INSIDE IT, because the loop returns early for a
    // room with no art and a step at the bottom of its body would silently skip
    // those rooms — which is most of them.
    for (const r of rooms) {
      const tracks = r.tracks ?? [];
      if (!tracks.length) continue;
      const { toFt, toPx } = r.geo;
      const mine = [];
      out.forEach((sp, i) => {
        if (sp.roomId === r.id && !sp.rejected && sp.x != null && sp.target) mine.push({ i, sp });
      });
      if (!mine.length) continue;
      // The spots are in PLAN PIXELS by the time they are pushed above and the
      // track is in the room's own feet, so this converts once, here, rather
      // than asking absorbPoints to know about two coordinate spaces.
      const ptsFt = mine.map((m) => toFt({ x: m.sp.x, y: m.sp.y }));
      for (const t of tracks) {
        // `len` IS THE SPOT'S BODY AND NOT THE HEAD'S, and it decides two things
        // at once: how much profile a spot needs behind it at the end of a run,
        // and how much room it needs beside its neighbours. A directional body
        // is half the length of an ambient one, so passing the ambient figure
        // both pushes it needlessly far in from a corner AND refuses a second
        // spot beside it that would physically clear the first by eight inches.
        // THE SAME ZONES THE AMBIENT PASS OBEYED, LESS THE BEDS.
        //
        // This said "a spot dragged over a bed is as wrong as a downlight
        // there", and that is the sentence the whole overBed rule disagrees
        // with: a bed is a no-light zone because a downlight fires into the
        // eyes of somebody lying under it, and a directional head fires where
        // it is pointed. Keeping the beds in here would have contradicted the
        // placer one step after it — a spot deliberately stood over a mattress
        // to light the wall behind the bed would be the one spot the rail
        // running along that wall refused to carry, and it would come out
        // recessed six inches off the profile.
        //
        // Everything else in the list stays. A hole for a beam and a slot with
        // tape in it are places where there is no ceiling to clip a module to,
        // and that is true of a track head as much as of a downlight.
        const spotKeepOff = (SPOT_DEFAULTS.overBed && (opt.overBed ?? true))
          ? (t.keepOff ?? []).filter((z) => !isBedZone(z))
          : (t.keepOff ?? []);
        const got = absorbPoints(t.runs, ptsFt, { absorb: t.absorb, len: SPOT_LEN_FT,
                                                 // A SPOT MAY SLIDE ALONG THE
                                                 // PROFILE TO GET PAST A MODULE
                                                 // THAT IS ALREADY THERE, and an
                                                 // ambient head may not: a head
                                                 // is one of a row whose spacing
                                                 // is the layout, a spot is
                                                 // aimed at one object and owes
                                                 // nothing to its neighbours.
                                                 // Without this a spot whose
                                                 // landing was held by the
                                                 // corner head was dropped and
                                                 // drawn recessed, on a ceiling
                                                 // that is a track. See
                                                 // DODGE_FT.
                                                 dodge: DODGE_FT,
                                                 keepOff: spotKeepOff,
                                                 occupied: t.occupied });
        got.forEach((a, k) => {
          if (!a) return;
          const m = mine[k];
          const at = toPx({ x: a.x, y: a.y });
          out[m.i] = {
            ...m.sp, x: at.x, y: at.y,
            // Where the placer put it, kept for the same reason a light keeps
            // `gridPx`: the drawing shows the move, so the claim that nothing
            // was re-planned is checkable rather than asserted.
            gridPx: { x: m.sp.x, y: m.sp.y },
            track: t.key, trackRun: a.run, trackAxis: t.runs[a.run].axis,
            fixture: trackFixtureFor(m.sp.fixture),
            // RE-AIMED FROM WHERE IT NOW IS. A spot is a fitting plus a
            // direction, and moving the fitting without turning it leaves the
            // arrow — and the beam — pointing past the thing it is for.
            angle: Math.atan2(m.sp.target.y - at.y, m.sp.target.x - at.x),
          };
          // Spent. A spot absorbed by one run cannot be offered to the next.
          ptsFt[k] = null;
        });
      }
    }

    /* --- 4. AND THE ONES SOMEBODY PUT DOWN AND POINTED THEMSELVES ---------
       LAST, AND OUTSIDE EVERY PASS ABOVE, which is the whole of what makes
       them hand-placed. Nothing here is solved: the position is where the
       first click landed and the angle is where the second one locked it, and
       neither is offered to the segment ledger, the art row's `taken` list or
       the track absorption. A hand that has aimed a fitting has said the last
       word on it — the same rule `placeCob` states for a recessed lamp, which
       is deliberately given none of the wall bands and clearances the engine
       obeys. See lib/cob.js.

       THEY COME OUT IN THE SAME SHAPE AS A PLACED ONE, and that is the point
       of putting them here rather than in a list of their own. The canvas
       draws `taskSpots`, the analysis counts them as task lights, the schedule
       bills them by `fixture` and the electrical pass loops them back to a
       plate — four readers, none of which has to learn about a fourth kind of
       fitting. What they lack is the placer's WORKING: no `segment`, no
       `grid`, no `via`, no `highlight`, because there is no reasoning to show.

       PLAN FEET STRAIGHT TO PLAN PIXELS. A hand-placed spot is stored the way
       `manualCobs` are — in the drawing's own feet, so a scale correction moves
       it with everything else — and that space is shared by every room, so
       this needs no room origin and no `r.geo`. It is also why the loop is
       over the SPOTS and not over the rooms: a room with no task surface
       `continue`s out of the pass above, and a hand-placed spot in one would
       have been silently dropped.

       `target` IS DERIVED FROM THE ANGLE and not stored. What the hand chose is
       a DIRECTION; the aim point is a fixed distance along it, and it exists
       only because three readers want one — the pool goes on it, the arrow
       points at it, and the absorbed-onto-a-track case re-derives the angle
       from it. Storing a point instead would make the record say the spot is
       aimed at a particular spot on the floor, which is not what was said. */
    /* WHICH SPACE A HAND-PLACED SPOT BELONGS TO IS WHERE IT IS, NOT WHERE IT
       WAS PUT DOWN. The id stamped by the second click was never revisited,
       which was harmless only while the fitting could not move: it can be
       carried now (see useTaskSpots), and a spot dragged into the next room
       would go on being billed, analysed and heat-mapped in the one it was
       placed in — three readers all correct about wrong data, and nothing on
       the drawing to say so.
       AT THE READ AND NOT AT THE DRAG, which is already the house rule:
       `projectAccentZonesPx` says it in full about a hand-placed run and
       `projectMagTracksPx` about a track ("`roomId` IS WHERE THE MIDDLE OF IT
       IS"). One place the answer comes from instead of two, and a plan saved
       before this heals on reload rather than needing a migration.
       THE STORED ID IS THE FALLBACK, so a spot over no space at all — dropped
       across a threshold, or left outside a re-traced outline — keeps the home
       it had rather than falling out of every schedule. */
    const spotHome = (at) => rooms.find((r) => pointInPolygon(
      at, r.plan?.polygonPx ?? r.geo?.polygonPx ?? []))?.id ?? null;
    for (const sp of manualSpots) {
      if (!Number.isFinite(sp?.xFt) || !Number.isFinite(sp?.yFt)
          || !Number.isFinite(sp?.aim) || !(pxPerFt > 0)) continue;
      const x = sp.xFt * pxPerFt, y = sp.yFt * pxPerFt;
      /* WHERE THE SECOND CLICK LANDED IS WHERE THE BEAM LANDS. `aimFt` is that
         distance, and everything downstream reads the aim point rather than
         this figure: the throw pool is drawn on `target`, the heatmap tilts its
         cone at `target`, and the arrow points at it. So this one number is the
         whole of "aimed at THAT".
         FLOORED AT THE STANDOFF THE PLACER ALREADY USES. `minStandoff` is there
         because "a spot ON the table has no direction to point in, and the arrow
         is half the drawing" — which is exactly what a second click landing on
         the body would ask for. Same rule, same number, rather than a second
         one invented here.
         AND IT IS NOT CAPPED AT `maxAimFt`. That cap is how the placer CHOOSES
         between candidates; a hand that has aimed a fitting has said the last
         word on it, which is the rule this whole block exists to state. */
      const aimFt = Number.isFinite(sp.aimFt)
        ? Math.max(sp.aimFt, SPOT_DEFAULTS.minStandoff)
        : HAND_AIM_FT;
      const reach = aimFt * pxPerFt;
      out.push({
        id: sp.id, roomId: spotHome({ x, y }) ?? sp.roomId ?? null,
        fixture: sp.fixture || 'spot',
        hand: true,
        x, y,
        target: { x: x + Math.cos(sp.aim) * reach, y: y + Math.sin(sp.aim) * reach },
        angle: sp.aim,
        aimFt, far: false,
      });
    }
    return out;

}

/** What the canvas draws: every accent zone still standing, in plan pixels. */
/** The same two-source rule for strips and sconces. See projectSurfacesPx. */
export function projectAccentZonesPx(rooms, accentResults, accentDismissed, manualAccents, reverseCoves, shelfStrips, ceilingShapes, pxPerFt) {
    const out = [];
    for (const r of rooms) {
      const res = accentResults[r.id];
      if (!res?.zones) continue;
      for (const z of res.zones) if (!accentDismissed.includes(z.id)) out.push(z);
    }
    // THE COVES. Derived, not placed — they exist because the ceiling is a cove,
    // so there is nothing to dismiss and nothing to drag. They go in here
    // rather than into `manualAccents` for exactly that reason: this list is
    // what the drawing and the schedule read, and `manualAccents` is a store of
    // things a person made.
    for (const r of rooms) out.push(...(r.coveStrips ?? []));
    // THE REVERSE COVES' TAPE, on the same terms and for the same reason. A
    // reverse cove is a slot with a strip in it, so it is billed by the metre
    // like every other run — shaped as an ordinary accent zone, so the canvas,
    // the schedule and the DXF take it without any of them knowing what a
    // reverse cove is. `run` and not `loop`: this one does not turn a corner.
    const litRooms = new Set(rooms.map((r) => r.id));
    for (const c of reverseCoves) {
      if (!litRooms.has(c.roomId)) continue;
      out.push({
        id: `rcove-strip-${c.id}`, type: 'strip', kind: 'reverse-cove', roomId: c.roomId,
        source: 'reverse-cove', label: 'Reverse cove',
        // WHICH CATALOGUE LINE. `type: 'strip'` is what makes the canvas, the
        // schedule and the DXF take this without any of them needing to know
        // what a reverse cove is; `fixture` is what they read when they DO need
        // to know — the tooltip's words, the schedule's line, the DXF's layer.
        fixture: 'reverse-cove',
        run: c.run, rect: c.rect, band: c.band, lip: c.lip,
        runLength: c.runLength,
        // WHAT THE DRAG NEEDS. `derived` says this run has no stored geometry to
        // edit — the ends write a trim instead — and the rest is what turns a
        // pointer position into one: which way the run lies, where the RULE put
        // its ends, and how far it may be stretched before it hits the door.
        derived: 'reverse-cove', trimId: c.id, horizontal: c.horizontal,
        axis: c.axis, base: c.base, seg: c.seg, bounds: c.bounds,
        trimmed: c.trimmed,
      });
    }
    /* --- THE SLOTS SOMEBODY DREW ACROSS A CEILING ---------------------------
       AN OPEN COVE IS A LENGTH OF TAPE AND NOTHING ELSE, which is why it arrives
       here rather than through the ceiling design like its closed cousin. A
       pocket run round an island cuts the grid in two and has a box, a ring and a
       chunk; a slot from wall to wall has none of those — it is a line on the
       slab with a strip in it — and shaping it as an ordinary accent run is what
       lets the canvas, the schedule and the lumen model take it without any of
       them learning a new kind of object. Same argument, third time: see the
       reverse coves above.

       `kind: 'cove'` PUTS IT IN THE COVE FAMILY, so it is billed as cove tape and
       counted against the cove's own distribution — four fifths at the ceiling.
       That is what it is: a concealed strip in a pocket, throwing up.

       `open: true` IS FOR THE DRAWING ALONE. Every other `loop` on this sheet is
       a closed circuit and is stroked with a Z; this one must not be, or an
       L-shaped run would carry a spurious leg back across the room. */
    for (const sh of ceilingShapes) {
      // A GUIDE BUYS NOTHING. Same rule the closed pipeline states one memo up:
      // an open guide is a line to measure from, not a slot to fill with tape.
      // A COVE AND NOTHING ELSE MAKES A RUN OF TAPE. Same swap, same reason as
      // the pocket filter above.
      if (!shapeIsBuilt(sh) || !shapeIsOpen(sh)) continue;
      const home = rooms.find((r) => pointInPolygon(
        { x: sh.x * pxPerFt, y: sh.y * pxPerFt }, r.geo.polygonPx));
      if (!home) continue;
      const pts = shapeOutlineFt(sh).map((q) => ({ x: q.x * pxPerFt, y: q.y * pxPerFt }));
      if (pts.length < 2) continue;
      const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
      out.push({
        id: `cove-line-${sh.id}`, type: 'strip', kind: 'cove', roomId: home.id,
        source: 'cove', label: 'Cove LED strip',
        // THE HANDLE THE DELETE BRANCH READS. A slot's tape is not an object in
        // its own right — the shape is — so Delete on the run removes the shape.
        shapeId: sh.id,
        loop: pts, open: true,
        runLength: runLengthFt(sh) * pxPerFt,
        rect: { x0: Math.min(...xs), y0: Math.min(...ys),
                x1: Math.max(...xs), y1: Math.max(...ys) },
      });
    }
    // ...and the shelves, on exactly the same terms. Three sources of strip on
    // this drawing now — a perimeter cove, a reverse cove and a run of shelving
    // — and all three are the same tape bought by the metre, which is why they
    // are all shaped as ordinary accent zones and none of them needs the canvas
    // or the schedule to know it exists.
    for (const st of shelfStrips) {
      if (!litRooms.has(st.roomId)) continue;
      out.push({
        id: `shelf-strip-${st.id}`, type: 'strip', kind: 'shelf', roomId: st.roomId,
        source: 'shelf', label: 'Shelf LED strip',
        run: st.run, rect: st.rect, runLength: st.runLength,
        derived: 'shelf', trimId: st.id, horizontal: st.horizontal,
        base: st.base, seg: st.seg, trimmed: st.trimmed,
      });
    }
    const live = new Set(rooms.map((r) => r.id));
    // THE DISMISSED FILTER APPLIES HERE TOO. Deleting a hand-placed fitting now
    // removes it outright, so nothing new lands in `accentDismissed` — but a
    // plan saved while that was broken has manual ids sitting in the list, and
    // those fittings should stay deleted rather than reappearing on reload.
    /* --- ...AND A HAND-PLACED FITTING BELONGS TO THE SPACE IT IS OVER -------
       IT BELONGED TO WHICHEVER ROOM THE FIRST CLICK LANDED IN, AND THAT WAS A
       BUG WITH NO VISIBLE CAUSE. A strip is two clicks and the first one is
       SNAPPED (see `snapPlacing` — it pulls onto walls, corners and existing
       fittings), so a run aimed at the edge of a space can have its opening
       pixel resolve into the space NEXT DOOR. `roomId` was stamped from that
       pixel and never revisited; the run was then DRAWN at its own coordinates,
       which is over the space you aimed at. So the fitting appeared in one room
       and was counted in another — the schedule billed it next door, the
       Analysis panel reported the room you had just lit as ACHIEVED 0, and the
       heatmap coloured it dark. All three were right about the data and the data
       was wrong.
       SO THE HOME IS RESOLVED FROM THE GEOMETRY, WHICH IS ALREADY THE HOUSE
       RULE. `projectMagTracksPx` says it in as many words about a hand-placed
       track: "`roomId` IS WHERE THE MIDDLE OF IT IS ... the honest single answer
       is the space its centre is over". A run of tape is the same kind of
       object and gets the same rule.
       AT THE READ AND NOT AT THE PLACEMENT, deliberately: a plan already saved
       with a run stamped next door heals on reload rather than needing a
       migration, and there is one place the answer comes from instead of two.
       THE STORED ID IS THE FALLBACK, so a run whose centre is over no space at
       all — across a threshold, or outside a re-traced outline — keeps the home
       it had rather than disappearing from the drawing. */
    const homeOf = (m) => {
      const at = m.point
        ?? (m.run?.length >= 2
          ? { x: (m.run[0].x + m.run[m.run.length - 1].x) / 2,
              y: (m.run[0].y + m.run[m.run.length - 1].y) / 2 }
          : (m.rect ? { x: (m.rect.x0 + m.rect.x1) / 2,
                        y: (m.rect.y0 + m.rect.y1) / 2 } : null));
      if (!Number.isFinite(at?.x) || !Number.isFinite(at?.y)) return m.roomId;
      const hit = rooms.find((r) => pointInPolygon(
        at, r.plan?.polygonPx ?? r.geo?.polygonPx ?? []));
      return hit ? hit.id : m.roomId;
    };
    return [...out, ...manualAccents
      .filter((m) => !accentDismissed.includes(m.id))
      .map((m) => { const roomId = homeOf(m); return roomId === m.roomId ? m : { ...m, roomId }; })
      // LIVE AGAINST THE RESOLVED HOME AND NOT THE STORED ONE, so a fitting
      // whose stored room has been re-traced away survives if it is standing
      // over one that exists.
      .filter((m) => live.has(m.roomId))];

}

/**
 * What the canvas draws for the render pass: every placed wall feature, in
 * plan pixels.
 *
 * THE GRID IS RECOMPUTED HERE RATHER THAN STORED WITH THE RESULT, and that is
 * the same argument as runFt in computeAccents. A grid is a memo over the
 * room's polygon and the scale; store it on the answer and it starts lying the
 * moment somebody drags an outline corner or renames the door that sets the
 * scale — the cells would then be drawn against a grid the room no longer has.
 * Derived every render, it moves with the room, which is what anybody would
 * expect of a mark that says "there is panelling along this wall".
 */
export function projectWallCellsPx(rooms, wallResults, pxPerFt) {
    const out = [];
    for (const r of rooms) {
      const res = wallResults[r.id];
      if (!res?.elements?.length || !r.plan?.ok) continue;
      const grid = gridFor(r.plan.polygonPx, pxPerFt);
      if (!grid) continue;
      for (const e of res.elements) {
        if (!e.cells?.length) continue;
        const rect = cellsToRect(e.cells, grid);
        if (!rect) continue;
        out.push({
          id: e.id || `${r.id}-${out.length}`, roomId: r.id, type: e.type,
          label: e.label || WALL_BY_ID[e.type]?.label || e.type,
          colour: e.colour || WALL_BY_ID[e.type]?.colour || '#666',
          rect, rects: cellsToPlanPx(e.cells, grid),
          // Which way the run lies, so the cell ticks are drawn ACROSS it
          // rather than along it. A run one cell long is called horizontal and
          // draws no ticks either way.
          horizontal: e.start && e.end ? e.start.y === e.end.y : true,
        });
      }
    }
    return out;

}
