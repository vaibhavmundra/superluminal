// ---------------------------------------------------------------------------
// useDrag.js — THE LIFECYCLE ROUND lib/dragMove.js.
//
// WHAT IT IS FOR. Ten things on this canvas can be dragged — a ceiling object,
// a hand-placed COB, a COB array, a track module, a light inside its cell, a
// cove shape, a switchboard, a wire's grip, an accent run, a door box — and
// every one of them arrived with its own PointerDown / PointerMove / PointerUp
// trio. Thirty-eight handlers, and the ARITHMETIC in them was already unified:
// lib/dragMove.js states four rules and says outright that three of the
// implementations had got the same rules wrong independently before it existed.
//
// WHAT THAT FILE DID NOT UNIFY IS THE LIFECYCLE AROUND THEM, and this is it:
//
//   the pointer capture on the <svg>, so a gesture survives leaving the thing
//   it started on;
//   the slop threshold, and the fact that NOTHING at all happens before it —
//   no write, no guides, no copy;
//   the modifier read LIVE off each move rather than latched at the press;
//   the Option/Alt copy fork, and the retarget of the gesture onto the twin;
//   the snap-back on an invalid drop;
//   and clearing the gesture on release.
//
// THE ARITHMETIC STILL COMES FROM dragMove.js. Nothing in here computes a
// position: `movedEnough`, `grabOffset`, `wantedCentre`, `orthoLock`,
// `deltaFrom`, `applyDelta` and `forkCopy` are imported and called. If a number
// looks wrong the answer is in that file's four rules, not in this one.
//
// --- WHAT THE CALLER SUPPLIES, AND WHY EACH ONE IS ITS BUSINESS -------------
//
// `at`/`to` — HOW A MEMBER'S POSITION IS READ AND WRITTEN. dragMove.js's own
// contract, unchanged. A ceiling object is held in feet, an array in feet with
// the pointer in pixels, a COB in plan feet with a room id riding along, a
// module as a fraction of a path. The unit is the caller's and this hook never
// learns which it has.
//
// `moves` — DOES THIS GESTURE CARRY THE MEMBERS AT ALL. One press on a ceiling
// object can mean move, resize or rotate; only the first is a translation. The
// predicate is asked per frame, and a frame it answers no to resolves NOTHING —
// no lock, no snap, no guides, no delta, no copy: a corner being dragged is not
// a thing going anywhere, so there is no point to snap and no alignment to
// claim. The caller gets the raw pointer instead.
//
// `moved` — THE THRESHOLD, WHEN IT IS NOT THE ORDINARY ONE. The default is
// `movedEnough` in screen pixels over the zoom, which is what the lamp, the
// array and the module use. Four other drags have their own — a floor in plan
// pixels, a fraction of a cell, none at all for the door box — and one of them
// applies the threshold to only one of its four modes. Those are real
// differences in how much travel means "I meant to move this", so they stay
// the caller's to state rather than being averaged into one number here.
//
// WHERE AN OBJECT'S DRAG IS DELIBERATELY CONSTRAINED, THE CONSTRAINT STAYS IN
// THE CALLER. A slot does not move at all; a light is clamped to its own cell;
// a plate slides only along walls; a module only along its rail. Those are
// facts about the object and they belong next to it — expressed either in `to`,
// which sees the resolved point and may put the member anywhere it likes, or by
// the caller's own handler declining to call `move` at all.
//
// NO STORE IS REQUIRED. Give the hook `list`/`setList` and it applies one delta
// to the press-time snapshots — rule 2, said about a group. Give it neither and
// it writes nothing: `onMove` receives the resolved point and the frame is the
// caller's. Five of the ten drags are that shape, because what they write is
// not a member's position but an override in a map, or nothing at all until the
// release.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import {
  DRAG_SLOP_PX, movedEnough, grabOffset, wantedCentre, orthoLock,
  deltaFrom, applyDelta, forkCopy,
} from '../lib/dragMove.js';

/**
 * THE LIFECYCLE, WITHOUT REACT — so tools/test-drag.mjs can drive a whole
 * gesture with a fake pointer sequence and no renderer. `get`/`set` are the
 * only things `useDrag` adds, and they are exactly one `useState`.
 *
 * Returns `{ down, move, up }`.
 */
export function makeDrag({
  // --- the gesture's own state
  get, set,
  // --- reading the pointer, and holding on to it
  point, capture,
  // --- the store, when the hook is the one writing it
  at, to, list, setList,
  // --- the four rules
  grab = true,          // subtract where inside the thing it was grabbed
  ortho = false,        // does this object honour the shift lock
  snap,                 // (p, lockedAxis, ctx) -> p
  copy = false,         // does this object support Option-copy
  mintId,               // (n, base) -> id for a twin
  moves = () => true,   // (drag) -> is this frame a translation
  slopPx = DRAG_SLOP_PX,
  zoom = 1,
  moved,                // (from, p, drag) -> bool, when the default is wrong
  // --- the caller's own work
  onDown, onMove, onCopy, onCommit, onRelease,
}) {
  /* dragMove.js's defaults, named once. A caller with no `at`/`to` is one whose
     members ARE points, which is that file's own default too. */
  const unit = { at: at ?? ((o) => o), to: to ?? ((o, p) => ({ ...o, ...p })) };

  /* RULE 1, AND THE `<= 0` IS NOT A DEGENERATE CASE. The door box has no
     threshold on purpose: it is not selectable, so there is no click meaning to
     protect, and it is the only drag on this canvas that says so. */
  const past = (from, p, d) => (moved ? moved(from, p, d)
    : slopPx <= 0 || movedEnough(from, p, { zoom, slopPx }));

  /**
   * WHERE THE THING WANTS TO BE THIS FRAME. Three steps and the order is
   * load-bearing — see `orthoLock` and `cobMoveTarget`: the lock is applied
   * FIRST and the snap SECOND, because snapping first would let something four
   * feet away pull the point off the line the modifier had just held it to.
   *
   * `ids` IS WHAT THE SNAP MUST EXCLUDE, and during a copy fork it is the
   * TWINS' ids — which are not in the list yet, so nothing is actually excluded
   * and the ORIGINALS stay live targets. That is the alignment worth having.
   */
  const resolve = (p, e, d, ids) => {
    const want = (grab && d.grabPx) ? wantedCentre(p, d.grabPx) : p;
    // No anchor means no line to hold to and no delta to take: the resolved
    // point is the pointer, and the frame is entirely the caller's.
    if (!d.start) return { target: want, axis: null };
    const lock = orthoLock(want, d.start, ortho && !!e?.shiftKey);
    const ctx = { ids, drag: d, event: e, pointer: p };
    return { target: snap ? snap(lock.at, lock.axis, ctx) : lock.at, axis: lock.axis };
  };

  /**
   * RULE 4. `forkCopy` does the restore and the clone in ONE write, and then
   * this returns: every line after it in `move` reads the drag as it was when
   * the handler was created — the retarget has not landed yet — so a second
   * pass through them would take the ORIGINAL for the twin and move it after
   * all.
   */
  const fork = (p, e, d) => {
    /* THE IDS ARE MINTED BEFORE THE TARGET IS RESOLVED, outside the write.
       `setList` takes an UPDATER because two moves can fire before a re-render,
       and anything computed inside an updater is not available to the lines
       after it — but the retarget below needs to know which twin each original
       became. So the mapping is decided up front and `forkCopy` is handed a
       minter that reads it. */
    const pairs = d.group
      .map((gid, i) => ({ gid, twinId: mintId(i, d.startAll[gid]), base: d.startAll[gid] }))
      .filter((q) => q.base);
    if (!pairs.length) return;
    const twinOf = Object.fromEntries(pairs.map((q) => [q.gid, q.twinId]));
    const ids = pairs.map((q) => q.twinId);
    const { target } = resolve(p, e, d, ids);
    const delta = deltaFrom(d.start, target);
    setList?.((l) => forkCopy(l, d.startAll, delta,
      (_n, base) => twinOf[base.id], unit).list);
    set((cur) => (cur ? {
      ...cur,
      /* THE DRAG TRANSFERS TO THE TWIN and `start` is untouched: it is still the
         ORIGINAL's position, so later frames go on computing one delta from the
         press and applying it to these snapshots exactly as a plain move does —
         which is what leaves an Option+Shift twin exactly level with the thing
         it came from. */
      id: twinOf[cur.id] ?? ids[0],
      group: ids,
      startAll: Object.fromEntries(
        pairs.map(({ twinId, base }) => [twinId, { ...base, id: twinId }])),
      copied: true, moved: true,
    } : cur));
    onCopy?.({ ids, twinOf, pairs, drag: d });
  };

  /**
   * THE PRESS. `seed` is `{ id, members, ...extra }`: which member was pressed,
   * who is coming with it, and anything else this gesture wants to carry.
   *
   * WHO IS MOVING AND WHAT THEY LOOKED LIKE — rule 2, said about a group. One
   * delta applied to these snapshots is what keeps four fittings dragged
   * together in exactly the same relationship at the end of the drag, and it is
   * also what the Option copy restores the originals from and what an invalid
   * drop snaps back to.
   *
   * THE GUARD IS THE CALLER'S. Every press handler on this canvas gates on
   * `canGrab(pressState)` — see lib/pressOwner.js — and on whether there is a
   * drawing at all. Neither is arbitration this hook can do: one is a question
   * about seven machines and the other fails to nothing rather than to somebody
   * else's machine.
   */
  const down = (e, seed = {}) => {
    const { id = null, members = [], ...extra } = seed;
    const p = point(e);
    const anchor = members.find((m) => m.id === id) ?? members[0] ?? null;
    const start = anchor ? unit.at(anchor) : null;
    capture?.(e);
    const d = {
      id, pointerId: e?.pointerId,
      // WHERE THE PRESS WAS. The slop is measured from here and so is nothing
      // else: the delta comes off `start`, in the store's own unit.
      from: p,
      // WHERE THE THING WAS AT THE PRESS — the anchor for rules 2, 3 and 4.
      start,
      /* WHERE INSIDE THE THING IT WAS GRABBED, subtracted from every later
         pointer position so the symbol does not jump to centre itself under the
         cursor on the first move. */
      grabPx: (grab && start) ? grabOffset(p, start) : null,
      group: members.map((m) => m.id),
      startAll: Object.fromEntries(members.map((m) => [m.id, { ...m }])),
      moved: false,
      /* HAS THIS DRAG ALREADY LEFT A COPY BEHIND? Nothing about the modifier is
         recorded at the press — it is read live off each move — so this exists
         only so the twin is made once and not once per frame. Once made it
         stays made: letting go of Option mid-drag does not un-create it. */
      copied: false,
      ...extra,
    };
    set(d);
    onDown?.(e, d);
    return d;
  };

  /**
   * A FRAME.
   *
   * NOTHING AT ALL HAPPENS BEFORE THE SLOP — no write, no guides, no copy — so
   * a click that wobbles is a click. Past it the flag latches and stays latched,
   * because a drag that came back to within three pixels of its origin is still
   * a drag.
   */
  const move = (e) => {
    const d = get();
    if (!d) return;
    const p = point(e);
    if (!d.moved) {
      if (!past(d.from, p, d)) return;
      set((cur) => (cur ? { ...cur, moved: true } : cur));
    }
    /* A FRAME THAT IS NOT A TRANSLATION HAS NO TARGET TO RESOLVE, so none of the
       three steps runs: no lock, no snap and therefore NO GUIDES, and no delta.
       A ceiling object being resized or rotated is not going anywhere, and a
       guide drawn during one would be claiming an alignment for a corner that is
       moving on its own. The caller gets the RAW pointer and does its own work. */
    if (!moves(d)) {
      onMove?.(p, { pointer: p, delta: null, axis: null, event: e, drag: d });
      return;
    }
    /* THE MODIFIER IS READ LIVE, OFF THIS EVENT, so "Option then drag" and
       "drag then Option" are one gesture — and nothing can happen without
       movement, because pressing a key fires no pointermove. That is what stops
       an invisible duplicate stacked exactly on its original. */
    if (copy && !d.copied && e?.altKey) { fork(p, e, d); return; }
    const { target, axis } = resolve(p, e, d, d.group);
    const delta = d.start ? deltaFrom(d.start, target) : null;
    /* ONE MEMBER SNAPS AND THE REST FOLLOW — `resolve` above did the snapping,
       once, for the thing under the pointer. Snapping each member
       independently would pull the group apart. */
    if (setList && delta) {
      setList((l) => applyDelta(l, d.startAll, delta, unit));
    }
    onMove?.(target, { pointer: p, delta, axis, event: e, drag: d });
  };

  /**
   * THE RELEASE.
   *
   * `onCommit` IS ONLY CALLED FOR A GESTURE THAT MOVED. A press that never
   * travelled was a click, and validating or committing a drop that never
   * happened is how a fitting gets marked "moved by hand" for the life of the
   * plan for a gesture nobody made.
   *
   * `onRelease` IS CALLED EITHER WAY, for the tidy-up that is a property of the
   * GESTURE rather than of the drop — the guides, a snap indicator. Left behind
   * they draw a line through something nobody is touching.
   */
  const up = () => {
    const d = get();
    if (!d) return;
    set(null);
    if (d.moved) onCommit?.(d.group, d);
    onRelease?.(d);
  };

  return { down, move, up };
}

/**
 * THE SAME THING WITH ITS STATE IN REACT.
 *
 * `state` LETS THE CALLER OWN IT, and it is not a convenience. Four of the
 * deletes on this canvas have to be able to abandon a gesture holding the thing
 * they are removing — `deleteArray`, `deleteModule`, `deleteShape`, the door
 * editor's several exits — and every one of them is a `useCallback` declared
 * hundreds of lines ABOVE where the drag it touches is set up. A setter reached
 * through the hook's return value cannot go in one of their dependency arrays
 * without being read before it exists. So those keep their own `useState` where
 * it always was and hand the pair in; the rest let the hook hold it.
 *
 * `get` READS THE RENDER'S OWN VALUE and deliberately not a ref. Every handler
 * these replaced read the drag out of its closure, which is the value from the
 * render that installed it — and the copy fork depends on that: the retarget it
 * writes must NOT be visible to the lines after it in the same frame, or the
 * original gets moved as well as copied. A ref would make it visible.
 */
export function useDrag({ state, ...cfg }) {
  /* Called unconditionally so the hook order never moves, and ignored when the
     caller brought its own. */
  const own = useState(null);
  const [drag, setDrag] = state ?? own;
  const api = makeDrag({ ...cfg, get: () => drag, set: setDrag });
  // `set` is the escape hatch the deletes need: removing the thing under a
  // pointer has to be able to abandon the gesture holding it.
  return { ...api, drag, set: setDrag };
}
