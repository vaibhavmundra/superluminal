import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSceneManualProjections } from '../scene/useSceneFixtureProjections.js';
import { recommendCob } from '../../lib/cob.js';
import { snapPoint, SNAP_DEFAULTS } from '../../lib/snapGuides.js';
import { cobAlignTargets, cobObstacleBlocked, cobWallGuide } from './fixtureRules.js';

/**
 * THE MANUAL DOWNLIGHT'S LIVE MODEL — the feature's THIRD call site.
 *
 * IT IS DOWN HERE BECAUSE `roomAt` IS. Which space the pointer is over decides
 * the recommendation, the wall band and the bed warning, and that hit test is
 * App's — the doors, the accents, the strip and the ceiling objects all ask it
 * — so it is built below the scene and handed in. A hook's arguments are
 * evaluated during render, which is why this cannot stand at the second call
 * site with the projections. Same split the scene feature makes across several
 * calls.
 *
 * WHAT IT ANSWERS IS FOUR QUESTIONS, and all four are about the NEXT lamp
 * rather than about one already placed: where would it land, what would it be,
 * what is worth saying before the click, and is the bar showing a change
 * somebody has not committed.
 */
export default function useCobTool({
  state, manualCobs, pxPerFt, ceilingMmFor, zoom, roomAt, basisFor,
  addTool, roomTypes, fanClearance, setGuides, suggestPoints = [],
}) {
  const { cobAt, cobStanding } = state;

  const { projections: { manualCobsPx } } = useSceneManualProjections({
    manualCobs, pxPerFt, ceilingMmFor
  });

  /** THE LAMPS SOMEBODY HAS ALREADY PLACED, AND THE GRID BEING SUGGESTED — see
   *  `cobAlignTargets`, which carries the whole argument for why a row of
   *  downlights aligns to ITSELF and not to the drawing, and for why the
   *  suggested centres are the one thing that exclusion was never about.
   *  `suggestPoints` IS ALREADY EMPTY WHEN THE LAYER IS OFF, so this asks no
   *  second question about it: one gate decides what is drawn and what can be
   *  aimed at, and a gate restated here could disagree with it. */
  const cobTargets = useCallback((p, exclude = null) =>
    cobAlignTargets(manualCobsPx, p, exclude, suggestPoints),
    [manualCobsPx, suggestPoints]);

  /** Where a COB would land, with the guides that say why. One function, called
   *  by the hover and by the click, so the indicator cannot promise a point the
   *  press does not take. */
  const cobSnap = useCallback((p, exclude = null) =>
    snapPoint(p, cobTargets(p, exclude),
      { tol: SNAP_DEFAULTS.tolScreenPx / (zoom || 1) }),
    [cobTargets, zoom]);

  /**
   * WHERE A LAMP BEING DRAGGED LANDS, once the shift lock has had its say.
   *
   * THE TWO RULES THIS USED TO STATE ARE THE HOOK'S NOW — the line measured
   * from the press rather than the last frame, and the axis re-decided every
   * frame instead of latched on the first pixel. Both are stated once in
   * lib/dragMove.js and enforced once in hooks/useDrag.js. What is left here is
   * the half that is a fact about DOWNLIGHTS.
   *
   * WHAT IT SNAPS TO IS THE OTHER PLACED LAMPS AND THE SUGGESTED GRID — the
   * same targets the placing gesture uses, so "level with that one" means one
   * thing whether you are putting a lamp down or moving it afterwards. That
   * shared function is the point: dropping a lamp onto a proposed centre has to
   * behave identically to placing one there in the first place.
   *
   * AND THE FROZEN AXIS TAKES NO SNAP AND DRAWS NO GUIDE. A guide is a claim
   * that the point took an alignment, and one drawn for an axis that was held
   * still by a modifier would be claiming credit for the modifier's work.
   */
  const cobSnapAt = useCallback((p, axis, exclude) => {
    /* THE LOCK IS APPLIED BEFORE THIS AND THE ORDER IS LOAD-BEARING — see
       `resolve` in hooks/useDrag.js, which holds the point to its line and then
       hands it here. Snapping first would let a lamp four feet away pull the
       point off the line the modifier had just held it to, and the row would
       come out crooked with the lock silently undone.
       SO ALL THAT IS LEFT IS TO KEEP THE FROZEN AXIS OUT OF BOTH THE SNAP'S
       RESULT AND ITS GUIDES — see `orthoLock` for why a guide on a held axis is
       a false claim. */
    const sn = cobSnap(p, exclude);
    setGuides(sn.guides.filter((g) => g.axis !== axis));
    return { x: axis === 'x' ? p.x : sn.x, y: axis === 'y' ? p.y : sn.y };
  }, [cobSnap, setGuides]);

  /* --- WHAT THE NEXT COB WILL BE --------------------------------------------
     TWO ANSWERS STACKED, MOST SPECIFIC FIRST, and it was four:

       the standing    what the bar was last set to, until the Recommended chip
       choice          clears it back to the engine.
       the engine      what the gridding engine would have installed in the cell
                       under the pointer. See recommendCob in lib/cob.js.

     `recommended` IS TRUE ONLY WHEN THE ENGINE IS ANSWERING, which is what the
     chip on the bar latches on — and now that the draft and the one-shot are
     gone it is exactly "nothing standing", which is the honest reading of it. */
  const cobRoom = useMemo(() => (cobAt ? roomAt(cobAt) : null), [cobAt, roomAt]);
  const cobEngine = useMemo(
    () => recommendCob(cobRoom, cobAt, basisFor(cobRoom)),
    [cobRoom, cobAt, basisFor]);

  /* --- WHY THE BAR SAYS WHAT IT SAYS, IN THE CONSOLE -------------------------
     ONE LINE, ONLY WHEN THE ANSWER CHANGES, and it earns its place: the 7 W
     bathroom was reported twice before it could be pinned down, because the
     three things that decide the answer — which space the pointer is in, what
     TYPE that space is, and whether the cell under it has a light — are all
     invisible on screen. A space nobody has classified is not a bathroom to this
     app however obviously it is one on the drawing, and that is the single most
     likely reason a recommendation looks wrong. `from` names which branch
     answered; see recommendCob.
     THROTTLED BY THE ANSWER AND NOT BY TIME. A pointer move fires this handler
     forty times a second and the answer changes perhaps twice a minute, so
     logging every move would bury the drawing's own diagnostics. */
  const cobLog = useRef('');
  useEffect(() => {
    if (addTool !== 'cob') { cobLog.current = ''; return; }
    /* THE CELL IS WHAT THE ANSWER IS ABOUT, so the cell is what the line
       prints: its size is the whole of the wattage and its short side is the
       whole of the optic (see `autoSpec`), and a figure that looks wrong is
       almost always a cell that is not the size anybody expected. The room's
       TYPE stays on the line even though the rule no longer reads it — it is
       still what decides the cell's target area upstream, in the chunker. */
    const c = cobEngine.cell;
    const line = `[cob] ${cobRoom?.outline?.name ?? 'no space'}`
      + ` · type ${roomTypes[cobRoom?.id]?.type ?? 'UNSET'}`
      + (c ? ` · cell ${c.w.toFixed(1)}×${c.h.toFixed(1)} ft (chunk ${c.chunk})` : '')
      + ` · ${cobEngine.watts}W ${cobEngine.beam}°`
      + ` (${cobEngine.from})`;
    if (line === cobLog.current) return;
    cobLog.current = line;
    console.log(line);
  }, [addTool, cobRoom, roomTypes, cobEngine]);

  /* --- WHAT THE NEXT LAMP WILL BE, AND IT IS TWO SLOTS RATHER THAN FOUR ----
     `cobOnce ?? cobStanding ?? cobEngine` WAS THE STACK, with a fourth value —
     `cobDraft` — layered over it for DISPLAY only. Both of the extra slots
     existed to serve the two buttons that used to stand on the bar, and both
     went with them: a draft that governs nothing is only useful when something
     can promote it, and a one-shot is only reachable through a button that no
     longer exists. See the state block in useFixtureState.
     `show` AND `inForce` ARE NOW THE SAME VALUE and both are still returned. It
     is not a redundancy worth collapsing: the two names answer different
     questions — what the bar PRINTS and what the next click WRITES — and the
     day they diverge again the callers should not have to be found and
     re-taught which of the two they meant. */
  const cobInForce = cobStanding ?? cobEngine;
  const cobShow = cobInForce;

  /** THE TWO THINGS WORTH SAYING BEFORE THE CLICK, and neither of them stops it
   *  — see `cobWallGuide`. */
  const cobGuide = useMemo(
    () => cobWallGuide({ room: cobRoom, at: cobAt, pxPerFt }),
    [cobRoom, cobAt, pxPerFt]);

  /* A CEILING OBJECT IS PHYSICAL, unlike the two advisory layout warnings
     above. The preview reads this and the press repeats the same test at its
     final snapped point, so the mark can never promise a placement that the
     click then accepts. */
  const cobBlocked = useMemo(() => cobObstacleBlocked({
    room: cobRoom, at: cobAt, pxPerFt, clearanceFt: fanClearance,
  }), [cobRoom, cobAt, pxPerFt, fanClearance]);

  return {
    cobsPx: manualCobsPx,
    targets: cobTargets, snap: cobSnap, snapAt: cobSnapAt,
    room: cobRoom, engine: cobEngine,
    inForce: cobInForce, show: cobShow,
    recommended: !cobStanding,
    guide: cobGuide, blocked: cobBlocked,
  };
}
