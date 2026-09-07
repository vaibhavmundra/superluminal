// ---------------------------------------------------------------------------
// dragMove.js — PICKING A THING UP, MOVING IT, AND LEAVING A COPY BEHIND.
//
// WHAT IT IS FOR. Four objects on this canvas can be dragged — a ceiling object,
// an accent fitting, a light inside its cell, a hand-placed COB — and every one
// of them arrived with its own implementation of the same four rules. Three of
// those implementations have already been wrong at least once, in the same three
// ways, and the fixes were made one file at a time. This is those rules, written
// once, so the fifth draggable thing gets them right by construction.
//
// IT IS NOT A HOOK AND IT TOUCHES NO STATE. Every function here takes numbers
// and returns numbers: what state a store keeps, how it writes, and what an id
// looks like are the caller's business and differ in every case — a ceiling
// object is held in feet, an accent zone in plan pixels, a COB in plan feet with
// its specification riding along. What does NOT differ is the arithmetic, and
// the arithmetic is the part that keeps being got wrong.
//
// IT IS ALSO NOT geometry.js. That file answers questions about SHAPES — is
// this point inside that polygon, how far is it from the boundary. This one is
// about a GESTURE: a press, a delta, a modifier, a release. They are neighbours
// and they are not the same subject.
//
// --- THE FOUR RULES, AND WHY EACH ONE IS HERE -------------------------------
//
//   1. A PRESS IS NOT A DRAG UNTIL IT HAS TRAVELLED. Every one of these objects
//      is also SELECTABLE, and a press that both selects a thing and nudges it
//      three pixels is a press that quietly damages the drawing while appearing
//      to do what you asked. See `movedEnough`.
//
//   2. THE DELTA IS MEASURED FROM THE PRESS, NEVER FROM THE LAST FRAME.
//      Accumulating per-frame offsets drifts, and a row of fittings that no
//      longer line up after a long drag is a row somebody has to fix by hand.
//      See `deltaFrom` and `applyDelta`.
//
//   3. THE ORTHO LOCK IS RE-DECIDED EVERY FRAME AND NAMES ITS FROZEN AXIS.
//      Latching on the first pixel makes a drag that starts sideways and turns
//      vertical impossible; and a caller that is not TOLD which axis was frozen
//      will snap it and draw a guide for it, claiming an alignment the modifier
//      made. See `orthoLock`.
//
//   4. A COPY RESTORES ITS ORIGINALS. The modifier is read live off each move —
//      "drag then Option" is how people actually reach for it — so by the time
//      it arrives the original may be half way across the room, and leaving it
//      there makes one gesture both move a thing and copy it. See `forkCopy`.
// ---------------------------------------------------------------------------

/**
 * HOW FAR A PRESS TRAVELS BEFORE IT IS A DRAG, in SCREEN pixels.
 *
 * Screen and not drawing units, because it is a fact about a hand on a mouse and
 * not about the plan: the wobble that arrives with a click is the same three
 * pixels whether you are zoomed to a whole floor or to one bathroom. Callers
 * divide by the zoom — see `movedEnough`.
 *
 * THREE IS THE SMALLEST NUMBER THAT ACTUALLY WORKS. Two lets a firm click
 * through on a trackpad; much more and a deliberate small nudge feels dead
 * before it starts.
 */
export const DRAG_SLOP_PX = 3;

/**
 * Has this press travelled far enough to mean "move me"?
 *
 * `zoom` is the canvas's current scale, so the tolerance is constant on screen.
 * A caller with no zoom passes nothing and gets drawing units, which is right
 * for a surface that does not zoom.
 */
export const movedEnough = (from, to, { zoom = 1, slopPx = DRAG_SLOP_PX } = {}) =>
  Math.hypot(to.x - from.x, to.y - from.y) > slopPx / (zoom || 1);

/**
 * WHERE THE POINTER SITS INSIDE THE THING IT GRABBED.
 *
 * Kept for the length of the gesture and subtracted from every later pointer
 * position, which is what stops the object jumping so that its CENTRE lands
 * under the cursor at the first move. Aligning on wherever inside an object you
 * happened to grab it would also make the same drag land differently each time.
 */
export const grabOffset = (pointer, centre) =>
  ({ x: pointer.x - centre.x, y: pointer.y - centre.y });

/** Where the grabbed thing's centre wants to be, given the pointer now. */
export const wantedCentre = (pointer, grab) =>
  ({ x: pointer.x - grab.x, y: pointer.y - grab.y });

/**
 * HOLD THE MOVE TO ONE AXIS, AND SAY WHICH ONE IS HELD.
 *
 * `anchor` is where the thing was at the PRESS — rule 2 — so a locked drag stays
 * on one line however long it goes on, and a copy taken mid-drag comes out
 * exactly level with the thing it came from.
 *
 * WHICHEVER AXIS HAS TRAVELLED FURTHER WINS, and it is re-decided on every call
 * rather than latched: a drag that sets off sideways and turns into a vertical
 * one switches over as it crosses the diagonal, which is what every other tool
 * with this modifier does and what the hand expects.
 *
 * `axis` NAMES THE FROZEN ONE, and returning it is half the point of this
 * function. The caller must not snap that axis and must not draw a guide for it:
 * a guide is a claim that the point took an alignment, and one drawn for an axis
 * a modifier was holding still would be taking credit for the modifier's work.
 * `null` when nothing is held.
 */
export function orthoLock(want, anchor, on = true) {
  if (!on) return { at: want, axis: null };
  const row = Math.abs(want.x - anchor.x) >= Math.abs(want.y - anchor.y);
  return row
    ? { at: { x: want.x, y: anchor.y }, axis: 'y' }
    : { at: { x: anchor.x, y: want.y }, axis: 'x' };
}

/**
 * The one delta this whole gesture is: from where the thing was at the press to
 * where it has been asked to be now.
 */
export const deltaFrom = (anchor, at) => ({ dx: at.x - anchor.x, dy: at.y - anchor.y });

/**
 * MOVE A WHOLE GROUP BY ONE DELTA, FROM THE SNAPSHOTS TAKEN AT THE PRESS.
 *
 * `startAll` is id -> the member as it was when the press landed. Applying one
 * delta to those is rule 2 said about a group, and it buys the thing that makes
 * a multi-selection worth having: four fittings dragged together are still in
 * the same relationship to each other at the end of the drag, exactly.
 *
 * ONE MEMBER SNAPS AND THE REST FOLLOW, which is a rule for the CALLER and is
 * why the snapping does not happen in here. Snapping each member independently
 * pulls a group apart — every one of them finds its own nearest alignment and
 * they arrive no longer in a row. Resolve the target for the thing under the
 * pointer, take the delta from that, and hand it to this.
 *
 * `at` is how a member's position is read and `to` how it is written, so this
 * serves a store in feet and a store in pixels without knowing which it has.
 */
export function applyDelta(list, startAll, { dx, dy },
                           { at = (o) => o, to = (o, p) => ({ ...o, ...p }) } = {}) {
  return list.map((o) => {
    const base = startAll[o.id];
    if (!base) return o;
    const b = at(base);
    return to(o, { x: b.x + dx, y: b.y + dy });
  });
}

/**
 * OPTION-DRAG: LEAVE THE ORIGINALS WHERE THEY WERE AND CARRY ON WITH TWINS.
 *
 * THE MODIFIER IS READ LIVE, OFF EVERY MOVE, which is what makes this function
 * necessary rather than a convenience. Latching it at the press means Option has
 * to be down BEFORE you touch the thing, and that is not how anyone reaches for
 * it: you pick the object up, you watch it move, and THEN you decide you wanted
 * a copy. Read late, "Option then drag" and "drag then Option" are one gesture.
 *
 * WHAT IT COSTS IS THIS RESTORE, AND IT HAS TO BE PAID. By the time Option
 * arrives the originals may be half way across the room; leaving them there
 * would make one gesture both move a thing and copy it — two edits, one of which
 * nobody asked for. `startAll` is what they looked like at the press, so putting
 * them back returns the position and anything else the drag had touched.
 *
 * NOTHING HAPPENS WITHOUT MOVEMENT, and that is the caller's guard rather than
 * this function's: pressing a key fires no pointermove, so a caller that only
 * reaches here from a move handler can never mint an invisible duplicate stacked
 * exactly on its original, doubling a schedule line where nobody can see it.
 *
 * THE TWINS' IDS ARE MINTED BEFORE THE TARGET IS RESOLVED so the caller can
 * exclude them from its own snap targets — they are not in the list yet, so
 * nothing is actually excluded and the ORIGINALS stay live targets. That is the
 * alignment worth having: the copy catches the centre of the thing it came from.
 *
 * Returns `{ list, twins, ids }` — the whole new list, the twin objects, and the
 * old id -> new id map the caller needs to retarget the drag in flight.
 */
export function forkCopy(list, startAll, { dx, dy }, mintId,
                         { at = (o) => o, to = (o, p) => ({ ...o, ...p }) } = {}) {
  const ids = {};
  const twins = [];
  let n = 0;
  for (const [gid, base] of Object.entries(startAll)) {
    const twinId = mintId(n++, base);
    ids[gid] = twinId;
    const b = at(base);
    twins.push({ ...to({ ...base }, { x: b.x + dx, y: b.y + dy }), id: twinId });
  }
  return {
    // Every original straight back to where it was picked up, then the twins.
    list: [...list.map((o) => (startAll[o.id] ? { ...startAll[o.id] } : o)), ...twins],
    twins,
    ids,
  };
}
