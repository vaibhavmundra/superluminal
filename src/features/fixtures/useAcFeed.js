// ---------------------------------------------------------------------------
// useAcFeed.js — AN AIR-CONDITIONER'S SUPPLY, AND THE ONE PLACE THAT KEEPS IT
// IN STEP WITH THE UNIT.
//
// WHY THIS IS A FILE AND NOT FOUR LINES IN THE PLACEMENT. An AC's feed has to
// be created when the unit is placed, MOVED when it is slid along its wall,
// SWAPPED when somebody changes their mind about which kind it is, RE-RATED
// when they change the amperage, and REMOVED when the unit is deleted. Five
// paths, two different stores — a socket is a plate in `manualBoards`, a point
// is a record in `elecPoints` — and every one of them is a chance for a unit
// and its supply to end up disagreeing about where they are or whether they
// exist. Written out at five call sites, the fifth one is the one somebody
// forgets, and the symptom is a socket left on a wall feeding an
// air-conditioner that was deleted last week.
//
// THE UNIT OWNS THE DECISION AND THE FEED OWNS NOTHING. `feed` on the object is
// which of the two it is, and it is the only truth about that; the record it
// names is found by its BACK-REFERENCE, `acId`. That direction is deliberate:
// a forward `feedId` on the unit dangles the moment somebody selects the socket
// and presses Delete — which they can, it is an ordinary plate — and a dangling
// id is a bar that lies about what is on the drawing. A back-reference simply
// stops matching, and the unit reads as having no supply, which is the truth.
//
// A HAND-DELETED FEED IS NOT PUT BACK. The toggle in the bar will build a fresh
// one, and that is the way back. Re-creating it on sight would make the socket
// undeletable, which is a worse answer than an honest gap.
//
// IT IS STORED AND NOT DERIVED, which is `socketForLamp`'s argument and is
// borrowed from it wholesale: a socket the app put there and a socket somebody
// dropped are the same object — drawn the same, dragged the same, re-rated,
// converted or deleted the same — and deriving this one would have meant a
// fourth source of plates for five readers to remember.
// ---------------------------------------------------------------------------

import { useCallback, useMemo } from 'react';
import {
  isWallUnit, isSeated, feedOf, FEED_POINT, FEED_SOCKET, feedSFt, acAmpsFor,
} from '../../lib/wallUnit.js';
import { AC_BOARD_ROLE, AC_HEIGHT_MM, boardU } from '../../lib/electrical.js';
import { wallPoint, newPointIdIn } from '../../lib/elecPoints.js';
import { newManualBoardId } from '../electrical/boardSheet.js';

/** Everything this file needs to know about one unit, gathered once. */
const seatedAc = (o) => isWallUnit(o) && isSeated(o);

export default function useAcFeed({
  ceilingObjs = [], elecPoints = [], manualBoards = [], boardKinds = {}, wallHosts,
  pxPerFt = 0, country = null, docActions,
}) {
  const hostOf = useCallback(
    (o) => (o?.roomId ? (wallHosts?.get?.(o.roomId) ?? null) : null), [wallHosts]);

  /* --- WHAT FEEDS WHICH UNIT, INDEXED ONCE PER RENDER ----------------------
     TWO STORES, ONE MAP. Every reader here asks the same question — "what is
     this unit's supply" — and answering it by scanning both lists per call
     would be two passes per unit per frame on the drag. */
  const byAc = useMemo(() => {
    const m = new Map();
    for (const q of elecPoints) if (q?.acId) m.set(q.acId, { kind: FEED_POINT, rec: q });
    for (const b of manualBoards) if (b?.acId) m.set(b.acId, { kind: FEED_SOCKET, rec: b });
    return m;
  }, [elecPoints, manualBoards]);

  /** This unit's supply as it actually exists, or null where there is none. */
  const feedFor = useCallback((ac) => (ac?.id ? byAc.get(ac.id) ?? null : null), [byAc]);

  /**
   * THE RATING IN FORCE — the feed's own, and the country's default until one
   * exists. The number lives on the FEED and not on the unit, which is what
   * keeps it to one truth: `PointSpec` writes a point's amps directly and the
   * plate panel writes a plate's, and a second copy on the object would be a
   * figure that disagrees with the drawing the moment either of those is used.
   */
  const ampsOf = useCallback((ac) => {
    const f = feedFor(ac);
    if (!f) return acAmpsFor(country);
    /* AND THE TWO KEEP IT IN DIFFERENT PLACES, which is the one asymmetry here
       and is not this file's to fix. A point carries its own `amps`; a PLATE's
       rating lives in `boardKinds` beside its outlet flag, deliberately — see
       the note there: it has to survive the plate being converted from a socket
       to a switchboard and back, and a field on the plate would not. */
    const a = f.kind === FEED_POINT ? f.rec.amps : boardKinds?.[f.rec.id]?.amps;
    return Number.isFinite(a) ? a : acAmpsFor(country);
  }, [feedFor, boardKinds, country]);

  /** Take a feed off the drawing, through whichever store it lives in. */
  const removeRec = useCallback((f) => {
    if (!f) return;
    if (f.kind === FEED_POINT) docActions.removeElecPoints([f.rec.id]);
    else docActions.deleteBoard(f.rec.id);
  }, [docActions]);

  /**
   * WRITE THE SUPPLY THIS UNIT SHOULD HAVE, wherever it should be.
   *
   * ONE FUNCTION FOR CREATE AND FOR MOVE, because they are the same write with
   * a different starting point, and splitting them is how the two drift: the
   * position a socket is CREATED at and the position it is MOVED to have to be
   * the same expression or a dragged unit leaves its socket a foot out. That
   * expression is `feedSFt` and it is called here exactly once.
   */
  const write = useCallback((ac, { amps }) => {
    const host = hostOf(ac);
    const sFt = feedSFt(ac, host, pxPerFt);
    if (sFt == null || !host) return;
    const have = feedFor(ac);
    const want = feedOf(ac);

    /* ALREADY THE RIGHT KIND: MOVE IT AND LEAVE EVERYTHING ELSE ALONE. A
       re-rate or a hand-edited height on this plate is somebody's decision and
       a slide along the wall must not quietly undo it. */
    if (have?.kind === want) {
      if (want === FEED_POINT) {
        docActions.patchElecPoint(have.rec.id, { u: boardU(sFt, host) });
      } else if (have.rec.sFt !== sFt) {
        docActions.slideBoard(have.rec.id, sFt);
      }
      return;
    }

    // THE WRONG KIND IS REMOVED BEFORE THE RIGHT ONE IS MADE, in this order and
    // in the same tick, so the two writes coalesce into one undo step.
    if (have) removeRec(have);

    if (want === FEED_POINT) {
      /* A WALL POINT BEHIND THE UNIT. `u` and not `sFt`, because a point is the
         primitive's constrained point and stores a FRACTION of the walls — see
         lib/elecPoints.js — where a plate stores the same position as an arc
         length. `boardU` is the one place those two spellings meet. */
      docActions.addElecPoint(wallPoint(ac.roomId, boardU(sFt, host), {
        id: newPointIdIn(elecPoints.length),
        heightMm: AC_HEIGHT_MM, amps, acId: ac.id,
      }));
      return;
    }

    /* ...OR A SOCKET OUTLET A FOOT CLEAR OF IT. A hand-placed plate is born an
       outlet — see `boardMode` — so nothing has to say so; what has to be said
       is the RATING and the HEIGHT, because `asOutlet` would otherwise put an
       air-conditioner's supply at 300mm above the skirting. `applyMode` spends
       a stored height after the conversion for exactly this. */
    const id = newManualBoardId();
    docActions.addManualBoard({ id, roomId: ac.roomId, sFt, role: AC_BOARD_ROLE, acId: ac.id });
    docActions.setBoardAmps(id, amps);
    docActions.setBoardHeight(id, AC_HEIGHT_MM);
  }, [hostOf, pxPerFt, feedFor, removeRec, docActions, elecPoints.length]);

  /**
   * A UNIT HAS JUST BEEN PLACED — give it its supply, at the country's rating.
   *
   * IN THE SAME TICK AS THE PLACEMENT, which is what makes the pair ONE undo
   * step rather than two: the history coalesces a burst into the state before
   * it. See QUIET_MS in lib/undo.js, and `socketForLamp`, which is this same
   * sentence about a standing lamp.
   */
  const place = useCallback(
    (ac) => { if (seatedAc(ac)) write(ac, { amps: acAmpsFor(country) }); },
    [write, country]);

  /**
   * ...AND IT HAS JUST BEEN SLID ALONG ITS WALL — bring the supply with it.
   *
   * THE FEED FOLLOWS THE UNIT, WHICH IS THE ONE PLACE THIS DEPARTS FROM THE
   * LAMP'S SOCKET. That one is placed once and is then its own thing to move,
   * on the argument that the lamp is where somebody put it and the socket is
   * where it had to go. An AC's supply is not like that: "behind the unit" and
   * "a foot clear of the casing" were stated as RULES, and a rule that only
   * held at the moment of placement would be wrong the first time anybody
   * nudged the unit six inches.
   */
  const sync = useCallback((ac) => {
    if (!seatedAc(ac)) return;
    write(ac, { amps: ampsOf(ac) });
  }, [write, ampsOf]);

  /** Several at once, for a group drag. */
  const syncAll = useCallback((ids) => {
    for (const id of ids) {
      const ac = ceilingObjs.find((o) => o.id === id);
      if (ac) sync(ac);
    }
  }, [ceilingObjs, sync]);

  /**
   * THE UNIT IS GONE — take its supply with it.
   *
   * BY ID AND NOT BY RECORD, because the object has already been removed from
   * the list by the time anything can ask what it was. The index is built from
   * the FEEDS, which are still there, so `acId` is enough.
   */
  const remove = useCallback((ids = []) => {
    for (const id of ids) {
      const f = byAc.get(id);
      if (f) removeRec(f);
    }
  }, [byAc, removeRec]);

  /** Socket or point. The number carries across, which is why it is read first. */
  const setFeed = useCallback((ac, feed) => {
    if (!seatedAc(ac) || feedOf(ac) === feed) return;
    const amps = ampsOf(ac);
    docActions.patchObject(ac.id, { feed });
    write({ ...ac, feed }, { amps });
  }, [ampsOf, docActions, write]);

  /** ...and the rating, written to whichever of the two this unit has. */
  const setAmps = useCallback((ac, amps) => {
    const f = feedFor(ac);
    if (!f || !Number.isFinite(amps)) return;
    if (f.kind === FEED_POINT) docActions.patchElecPoint(f.rec.id, { amps });
    else docActions.setBoardAmps(f.rec.id, amps);
  }, [feedFor, docActions]);

  /* --- MEMOISED, AND THIS IS NOT A MICRO-OPTIMISATION ----------------------
     `deleteObjects` TAKES THIS AND APP'S KEYDOWN EFFECT TAKES `deleteObjects`.
     A fresh object here makes a fresh command, which makes the effect's
     dependency array change every render, which re-binds the window listener
     on every frame — see the note by that array, which was written after
     exactly this class of bug cost a working Delete key. Every member below is
     already a `useCallback`, so this only has to stop the wrapper churning. */
  return useMemo(
    () => ({ feedFor, ampsOf, place, sync, syncAll, remove, setFeed, setAmps }),
    [feedFor, ampsOf, place, sync, syncAll, remove, setFeed, setAmps]);
}
