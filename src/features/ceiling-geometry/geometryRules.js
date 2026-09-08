// ---------------------------------------------------------------------------
// geometryRules.js — THE PURE HALF OF THE CEILING-GEOMETRY DOMAIN.
//
// Everything here is a function of its arguments. No React, no pointer, no
// document: the hit test a press runs, the room a slot starts in, the span a
// drag projects onto the plaster, the path an array is set out on, the bar's
// four states, and why a drawn run is not on the plan. All of it was inline in
// App.jsx, where none of it could be checked without a canvas.
//
// THE LIBRARIES ARE USED AND NOT REIMPLEMENTED. `ceilingShapes`, `pen`,
// `geometry` and `track` already own the arithmetic; what is here is the
// decision-making that stood around the calls to them.
// ---------------------------------------------------------------------------
import { pointInPolygon } from '../../lib/geometry.js';
import { axisLock } from '../../lib/pen.js';
import { drawnTrackRefusal, TRACK_REFUSALS } from '../../lib/track.js';
import {
  SHAPE_BY_ID, hitShape, isOpen as shapeIsOpen, isTrack as shapeIsTrack,
  roleOf as shapeRoleOf, spanOnOutline, lineShape, projectOnOutline,
  outlineFt as shapeOutlineFt, cornersFt as shapeCornersFt,
} from '../../lib/ceilingShapes.js';

/**
 * THE ROOM UNDER THE PRESS, and failing that the nearest one its outline is
 * within reach of. The second half matters more than it looks: a slot starts
 * ON a wall, and a press aimed at a wall lands outside the polygon as often as
 * inside it — a containment test alone would refuse the most natural way to
 * begin the gesture.
 * PLAN FEET, because that is the space a shape lives in. `polygonPlanFt` is
 * the room's outline already converted; see the note on it in `geo`.
 */
export function roomForSlotAt(rooms, pFt, pxPerFt) {
  if (!pxPerFt) return null;
  const px = { x: pFt.x * pxPerFt, y: pFt.y * pxPerFt };
  const inside = rooms.find((r) => pointInPolygon(px, r.geo.polygonPx));
  if (inside) return inside;
  let best = null;
  for (const r of rooms) {
    const q = projectOnOutline(pFt, r.geo.polygonPlanFt);
    if (q && (!best || q.dist < best.dist)) best = { r, dist: q.dist };
  }
  // A press further than a couple of feet from any wall is not aimed at one.
  return best && best.dist <= 2 ? best.r : null;
}

/**
 * THE SHAPE UNDER A POINT ON THE PLAN, if any — the hit test both geometry-
 * taking tools run.
 *
 * ONE TEST AND NOT TWO, which is the whole reason it is a function. The COB
 * array had this inline in its branch of the canvas press; the cursor, the
 * ghost and the shape's own highlight all need the same answer on every MOVE,
 * and a second copy of the tolerance would be a hover that lit a line the
 * press then missed.
 *
 * THE TOLERANCE IS IN SCREEN PIXELS AND CONVERTED, the rule every hit test on
 * this canvas follows: it is about how accurately somebody can hit a line on
 * screen, which does not change when the drawing is scaled. `hitShape` grows
 * a closed outline by it and bands an open one either side — see its note.
 *
 * FIRST MATCH IN THE LIST, which is the order shapes were drawn in. Two
 * overlapping guides are a rare thing to have drawn on purpose and the press
 * has to pick one; the alternative — smallest first, as the door editor does —
 * would be a rule about area on objects that are very often the same size.
 */
export function shapeUnderPoint(ceilingShapes, pPx, pxPerFt) {
  if (!pPx || !(pxPerFt > 0)) return null;
  const pFt = { x: pPx.x / pxPerFt, y: pPx.y / pxPerFt };
  const tolFt = Math.max(8, pxPerFt * 0.4) / pxPerFt;
  return ceilingShapes.find((sh) => hitShape(sh, pFt, tolFt)) ?? null;
}

/**
 * ...AND WHETHER THE TOOL IN HAND WOULD ACTUALLY TAKE IT.
 *
 * THE ANSWER IS DIFFERENT FOR THE TWO TOOLS AND THAT DIFFERENCE IS THE POINT.
 *
 *   THE COB ARRAY takes ANY geometry. A run of spots can be set out on a
 *   cove's own rectangle as readily as on a guide — it references the line and
 *   builds nothing from it, so there is nothing for the line's role to clash
 *   with. See `cobArrays`.
 *
 *   THE SHAPE TOOL takes a geometry OF THE OTHER ROLE, and only that. Armed to
 *   draw a cove it will span one from a guide, which is exactly what a guide is
 *   for; armed to draw a cove it must NOT swallow the cove already there,
 *   because a press on bare ceiling inside an existing cove is how a second
 *   one is drawn across it — and that is the ordinary case, not the exception.
 *   The rule reads symmetrically (a guide can be taken from a cove) because it
 *   is one condition rather than a cove-only exemption.
 *
 * `null` WITH NOTHING ARMED, so a press on a shape with no tool in hand still
 * means what it has always meant: pick it up. See `shapePointerDown`.
 */
export function takeableGeometry(shapeAt, { addTool, cobMode, shapeMenuOn, shapeRole }) {
  if (addTool === 'cob' && cobMode === 'array') return shapeAt;
  /* --- A MODULE WANTS A TRACK, AND NOTHING ELSE WILL DO ------------------
     THE THIRD TOOL THAT TAKES A GEOMETRY, and the narrowest of the three: a
     diffuser clips into a magnetic track and cannot be clipped into a cove, a
     guide or the ceiling. So the cue is offered for a track and withheld for
     everything else — which is what makes the pointer honest over a guide
     drawn an inch away from the run. */
  if (addTool === 'module') {
    return shapeAt && shapeIsTrack(shapeAt) ? shapeAt : null;
  }
  /* THE BAR BEING OPEN IS ENOUGH — IT DOES NOT HAVE TO BE ARMED, and that is
     the whole flow for a magnetic track: press the rail cell and the bar
     arrives with no primitive live (see `openShapeTool`, and the space click
     that does the same), then press the guide you want to be a track. Requiring
     a primitive first would mean arming a rectangle you are not going to draw
     in order to borrow an outline that already exists. */
  if (shapeMenuOn) {
    return shapeAt && shapeRoleOf(shapeAt) !== shapeRole ? shapeAt : null;
  }
  return null;
}

/**
 * THE SLOT IN FLIGHT, AND WHY IT IS REFUSED WHEN IT IS.
 *
 * ONE ANSWER FOR BOTH, because the two are the same computation and a refusal
 * is not an error state — it is the ordinary condition of a drag that has not
 * reached a second wall yet. Splitting them would mean asking `spanOnOutline`
 * twice per frame and having two places that can disagree about whether this
 * drag is legal.
 * THE REASON IS A SENTENCE AND IT IS SHOWN, which is the half that was missing
 * from every other refusal in this tool: a cove that simply fails to appear
 * reads as a broken tool. See the shape step in the panel.
 */
export function slotSpan({ shapeTool, shapeSpan, shapeAt, rooms, shapeRole }) {
  if (shapeTool !== 'line' || !shapeSpan || !shapeAt) return { shape: null, why: '' };
  /* --- A GUIDE LINE GOES WHERE IT IS DRAWN ------------------------------
     A COVE LINE HAS TO LAND ON TWO WALLS. That is not a preference: a slot is
     a channel cut across the slab, and a channel that stops in mid-air has no
     end detail and cannot be built — see `spanOnOutline`, which is what
     projects a rough drag onto the plaster at both ends.
     A GUIDE LINE IS NOT BUILT. It is a line to set an array of fittings out
     along, and the useful ones are exactly the ones the cove rule forbids: a
     run over a worktop that starts and stops where the worktop does, a line
     across the middle of a room touching nothing. Forcing its ends onto the
     walls would make the tool refuse the one thing it is for.
     SO THE PROJECTION IS SKIPPED AND THE DRAG IS THE LINE, ends included. The
     square-up modifier still applies, because a run somebody wants level is a
     run somebody wants level whatever it is for. */
  /* ...AND A TRACK IS NOT BUILT EITHER, so it takes the same exemption. The
     test is "is this a cove" rather than a list of the roles that escape: a
     magnetic track profile has to be able to run across the middle of a room
     and stop, exactly as a guide does, and the wall projection below exists
     only because a COVE is a channel in plasterboard whose ends need something
     to land on. */
  if (shapeRole !== 'cove') {
    const b = shapeSpan.uniform
      ? axisLock(shapeSpan.aFt, shapeAt) : shapeAt;
    return { shape: lineShape(shapeSpan.aFt, b), why: '' };
  }
  const room = shapeSpan.roomId
    ? rooms.find((r) => r.id === shapeSpan.roomId) : null;
  if (!room) return { shape: null, why: 'Start on a wall of a space.' };
  /* SHIFT SQUARES IT UP, and it is the same Shift the pen has — see
     `axisLock`. Read live off `shapeSpan.uniform`, which `onZoneMove` keeps in
     step with the key, so holding it half way through a drag straightens the
     run under your hand and letting go frees it again. */
  const span = spanOnOutline(shapeSpan.aFt, shapeAt, room.geo.polygonPlanFt,
                             { lock: shapeSpan.uniform });
  if (!span) {
    return { shape: null,
             why: shapeSpan.uniform
               ? 'Square to that wall runs along it — aim across the room.'
               : 'A cove spans two walls — drag to a different one.' };
  }
  return { shape: lineShape(span.a, span.b), why: '' };
}

/**
 * THE PATH AN ARRAY IS SET OUT ON, in plan pixels — geometry or room outline.
 *
 * ONE FUNCTION FOR BOTH SOURCES, because every reader wants the same thing
 * from either: a closed or open run of points to space lamps along. Which list
 * to look in is the `room:` prefix on the id, and nothing downstream has to
 * know there were two lists.
 */
export function arrayOutlineFor(geomId, { rooms, ceilingShapes, pxPerFt }) {
  if (!geomId || !(pxPerFt > 0)) return null;
  if (String(geomId).startsWith('room:')) {
    const r = rooms.find((q) => q.id === String(geomId).slice(5));
    const poly = r?.plan?.polygonPx || r?.geo?.polygonPx;
    /* EVERY VERTEX OF A ROOM IS A CORNER, which is why this hands the same
       list twice rather than deriving one from the other. A room's outline is
       traced on the plaster and has no fillets and no sampled curve in it —
       each point IS a corner of the room — so a ring of downlights set out on
       one lands on the corners at four lamps and adds the middle of each wall
       at eight. See `arraySpots`. */
    return poly?.length ? { pts: poly, corners: poly,
                            closed: true, isRoom: true, roomId: r.id,
                            label: r.outline?.name || 'Space' } : null;
  }
  const sh = ceilingShapes.find((q) => q.id === geomId);
  if (!sh) return null;
  const toPx = (q) => ({ x: q.x * pxPerFt, y: q.y * pxPerFt });
  const pts = shapeOutlineFt(sh).map(toPx);
  if (pts.length < 2) return null;
  const home = rooms.find((r) => pointInPolygon(
    { x: sh.x * pxPerFt, y: sh.y * pxPerFt }, r.geo.polygonPx));
  /* AND THE SHAPE'S CORNERS SEPARATELY, WHICH IS NOT `pts` FILTERED. The
     outline is a POLYLINE — 72 points for a circle, ten per rounded corner —
     so there is no reading of it that recovers "this shape has four corners".
     `cornersFt` is the shape's own answer, and it comes back EMPTY for a
     circle, which is what makes a run on one freely spaced. */
  return { pts, corners: shapeCornersFt(sh).map(toPx),
           closed: !shapeIsOpen(sh), isRoom: false, roomId: home?.id ?? null,
           label: SHAPE_BY_ID[sh.kind]?.label ?? 'Geometry' };
}

/* --- WHY A DRAWN RUN IS NOT ON THE PLAN -----------------------------------
   A RUN THAT WAS REFUSED USED TO VANISH IN SILENCE, and that is the whole of
   what this fixes. Somebody clicks out a path in a bedroom, presses the
   button, and nothing appears — no track, no line, no message — which reads
   as the tool being broken rather than as the answer it actually is (the run
   reaches no fitting, or it crosses the fan). The path is still there, in
   `manualTracks`; what was missing was anybody saying so.

   ASKED PER ROOM AND ANSWERED ONCE. A run is offered to every space it
   crosses — see the drawn-track pass — so "it was refused" means every one of
   them refused it, and the reason to report is the most specific of theirs.
   A run over no lit space at all is refused by nobody, which is why `outside`
   is the answer when no room had an opinion.

   THE SAME FUNCTION THE LAYOUT USED. `drawnTrackRefusal` is what
   `planDrawnTrack` itself asks before building anything, so the sentence
   under the button cannot describe a refusal that did not happen. */
export function trackRefusals({ pxPerFt, manualTracks, rooms, opt }) {
  if (!pxPerFt || !manualTracks.length) return [];
  const placed = new Set(rooms.flatMap((r) => (r.tracks ?? []).map((t) => t.key)));
  // MOST SPECIFIC WINS. "It crosses the fan" is something to act on; "it is
  // not over a lit space" is the answer of a room that never saw it.
  const RANK = { fan: 3, reach: 2, short: 1, outside: 0 };
  const out = [];
  for (const mt of manualTracks) {
    if (placed.has(mt.id)) continue;
    let why = 'outside';
    for (const r of rooms) {
      if (!r.geo || !r.plan?.ok) continue;
      const pts = mt.ptsFt.map((q) => r.geo.toFt({ x: q.x * pxPerFt, y: q.y * pxPerFt }));
      // ONLY A ROOM THE RUN ACTUALLY REACHES HAS AN OPINION WORTH HAVING.
      // Every other room would say `reach` about a path nowhere near it,
      // which is true and useless.
      if (!pts.some((q) => pointInPolygon(q, r.geo.polygonFt))) continue;
      const got = drawnTrackRefusal(pts, r.plan.lights ?? [], opt,
                                    { polygon: r.geo.polygonFt,
                                      keepOff: r.geo.zonesFt,
                                      obstacles: r.geo.fixturesFt },
                                    { closed: !!mt.closed });
      if (got && RANK[got] > RANK[why]) why = got;
    }
    out.push({ id: mt.id, why });
  }
  return out;
}

/* THE REFUSALS, ONE LINE PER REASON. Three runs refused for the same reason
   is one sentence and a count, not three identical sentences — and two runs
   refused for two different reasons are two lines, because the thing to do
   about each is different. */
export function groupTrackRefusals(trackNotes) {
  const by = {};
  for (const n of trackNotes) by[n.why] = (by[n.why] ?? 0) + 1;
  return Object.entries(by).map(([why, n]) => ({ why, n, text: TRACK_REFUSALS[why] }));
}

/* WHICH OF THE FOUR THINGS THE BAR IS. Derived, so the bar cannot be showing
   a tick for a shape that is no longer being drawn.
   THE TOOL BEING OPEN OUTRANKS A SELECTION, which is why `edit` is only
   reachable with the menu closed — and why picking a shape on the sheet
   closes it (see `shapePointerDown`). Two bars' worth of controls in one bar
   would be a row where half the buttons act on the thing under the cursor and
   half on the thing you drew last. */
/* `shapeSpan` COUNTS AS DRAWING EVEN WITH NO DRAFT TO SHOW FOR IT. A slot
   whose second end has not reached another wall yet produces no shape — see
   `lineSpan` — and without this the bar would drop back to the row of
   primitives half way through the drag, which reads as the tool letting go. */
/* THE BAR HAS FOUR STATES AND `edit` IS REACHABLE TWO WAYS.
   It used to be reachable only with the tool CLOSED, which was right while the
   only way to open the bar was to ask to draw: if you were drawing, you were
   not editing. The bar now also arrives on a space click, unarmed (see
   `onCanvasClick`), and in that state selecting a shape has to offer what can
   be done to it — otherwise the one gesture that puts the tools in front of
   you would be the one that takes the corner radius, the duplicate and the
   delete away. NOTHING ARMED AND SOMETHING SELECTED IS EDITING; a live
   primitive means you are drawing, whatever is selected underneath. */
/* --- ...AND `edit` DOES NOT SURVIVE ANOTHER TOOL OWNING THE BAR ------------
   `otherBar` IS A FIX FOR TWO CONTEXTUAL BARS STACKED IN ONE PLACE. The COB
   array tool selects the geometry it is setting out on — `select('shape', …)` in
   its branch of the canvas press, and rightly so: that ring is what says which
   shape the run belongs to. But a selected shape with the shape tool CLOSED is
   this bar's `edit` state, so arming the array put the shape's corner radius,
   duplicate and delete up at the foot of the stage alongside the array's own
   count and offset. Both are `position: fixed` at the same 26px — see BOTTOM
   in ShapeMenu and in CobSpec — so they overlapped: two rows of controls, half
   of them about an object nobody was working on, and a bin that deletes the
   GEOMETRY sitting beside a bar asking about lamps.
   A SELECTION IS NOT A REQUEST FOR A MENU WHILE SOMETHING ELSE IS IN HAND. So
   the fallback state is withheld whenever another machine on this canvas owns
   the next press — an add tool, the board step, the zone band. The ring on the
   shape stays, because that is a true statement about what the array is set
   out on; what goes is the second bar. Same one-bar-at-a-time rule `openArray`
   enforces from the other side.
   IT IS ONLY THE FALLBACK THAT IS GATED. `shapeMenuOn` means somebody
   deliberately asked for this bar, and the tool that armed it has already put
   every other machine away — so those states are untouched. */
export function shapeBarMode({
  shapeMenuOn, shapeAskSides, shapeDraft, penEmpty, shapeSpan, shapeTool,
  selShape, otherBar,
}) {
  return shapeMenuOn
    ? (shapeAskSides ? 'sides'
      : ((shapeDraft || !penEmpty || shapeSpan) ? 'draw'
        : (!shapeTool && selShape ? 'edit' : 'pick')))
    : (selShape && !otherBar ? 'edit' : null);
}

/** How far in or out the borrowed draft is being set, as one signed figure. */
export function offsetGapFt({ side, ft }) {
  return side === 'on' ? 0
    : (side === 'out' ? 1 : -1) * Math.max(0, ft || 0);
}

/* THE MERGED PATH AND NOT THE CLICKS. `penSegments` has already thrown away
   the doubled points and joined the two halves of a leg drawn in two goes,
   so this is the run as it will be BUILT rather than as it was drawn.
   A CLOSED PATH KEEPS ITS POINTS AND NOT ITS LAST SEGMENT. `penSegments`
   was given the closing leg so it could merge across the join — a rectangle
   whose first and last legs are collinear is one leg — and the stored path
   is the corners alone, with `closed` saying the leg back exists. Storing
   the repeat of the first point would make it a corner in its own right. */
export function trackPtsFromSegments(segs, closed) {
  return closed ? segs.map((sg) => sg.a) : [segs[0].a, ...segs.map((sg) => sg.b)];
}
