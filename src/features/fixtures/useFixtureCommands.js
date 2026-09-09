// ---------------------------------------------------------------------------
// useFixtureCommands.js — EVERY ACT ON A FITTING THAT IS NOT A POINTER GESTURE.
//
// Filling a grid, keeping an array, re-specifying one, re-setting one out,
// re-specifying a module, deleting an array, a module, a lamp or a ceiling
// object, putting a nudged light back under the rules, throwing a run away,
// setting a fan's sweep, and filling a magnetic track the moment it is spanned.
//
// THE DOCUMENT IS WRITTEN THROUGH `docActions` AND NOWHERE ELSE. `manualCobs`,
// `cobArrays`, `trackFixtures`, `ceilingObjs`, `lightMoves` and `autoSpots` are
// all `usePlanDoc`'s; nothing here keeps a copy of any of them, and no clamp,
// quantum or `spec: true` flag is applied on this side of the boundary that the
// reducer is already applying on the other.
//
// THE ONE THING DELIBERATELY NOT HERE is `openArray`, which is a gesture's
// command: opening one bar is also an act of closing six other machines, and
// that list is App's. See `useFixtureGestures`.
// ---------------------------------------------------------------------------
import { useCallback, useEffect } from 'react';
import { clear, idOf } from '../../lib/selection.js';
import { clampWatts, nearestBeam, arrayQuanta, quantiseCount } from '../../lib/cob.js';
import { outlineFt as shapeOutlineFt, isOpen as shapeIsOpen,
         isTrack as shapeIsTrack } from '../../lib/ceilingShapes.js';
import { MODULE_BY_ID, placeModule, planDiffusers } from '../../lib/magTrack.js';
import { netPerUnit, FAMILY_BY_ID } from '../../lib/lumens.js';
import { absorbAutoplaceSpots, autoplaceCobs, draftCount,
         gridSpotsOnTrack, gridSpotsOwnedByTrack,
         lightKey, roomForTrackPath,
         reconcileCobSpecs } from './fixtureRules.js';

export default function useFixtureCommands({
  state, fixtures, docActions, rooms, pxPerFt, readOnly,
  manualCobs, cobArrays, trackFixtures,
  arrayOutline, spaceAnalysis, setSel, setOptionPick,
}) {
  const {
    cobDraftArray, setCobDraftArray, cobRun, selObjIds,
    setArrayDrag, setModuleDrag, setFanSweepMm,
  } = state;
  const cobBasisFor = fixtures.cob.basisFor;
  const magTracksPx = fixtures.tracks.runsPx;
  const trackModulesPx = fixtures.tracks.modulesPx;

  /** FILL A SPACE'S GRID CELLS WITH LAMPS — see `autoplaceCobs`, which carries
   *  the whole rule including the two pieces of ceiling that get no lamp. */
  const autoplaceIn = useCallback((room) => {
    if (!room || !(pxPerFt > 0)) return;
    const ownedCells = new Set(trackFixtures.flatMap((f) => f.gridCells ?? []));
    /* A HAND-PLACED TRACK SPOT MAY PREDATE CELL OWNERSHIP. Its physical cell is
       still occupied, so the checkbox must not generate another fitting there. */
    for (const mod of trackModulesPx) {
      if (mod.kind !== 'spot' || mod.roomId !== room.id) continue;
      const cell = (room.plan.gridCellsPx ?? []).find((q) =>
        mod.x >= q.x0 && mod.x <= q.x1 && mod.y >= q.y0 && mod.y <= q.y1);
      if (cell) ownedCells.add(lightKey(room.id, cell.id));
    }
    const filled = autoplaceCobs({
      room, list: manualCobs, pxPerFt, basis: cobBasisFor(room),
      ownedCells,
    });
    const added = filled.slice(manualCobs.length);
    const absorbed = absorbAutoplaceSpots({
      spots: added, tracks: magTracksPx, fixtures: trackFixtures,
      pxPerFt, roomId: room.id,
    });
    docActions.replaceCobs([...manualCobs, ...absorbed.spots]);
    if (absorbed.modules.length) {
      docActions.addTrackFixtures(absorbed.modules.map((mod, i) => placeModule({
        ...mod, kind: 'spot', seq: `g${trackFixtures.length + i}`,
      })));
    }
  }, [pxPerFt, cobBasisFor, manualCobs, trackFixtures, magTracksPx,
      trackModulesPx, docActions]);

  /**
   * KEEP THE ARRAY — the tick on the bar, and the only way one gets onto the
   * drawing.
   *
   * A PREVIEW UNTIL SOMEBODY SAYS YES, which is the shape tool's rule and the
   * right one here for its reason: an array is a dozen fittings arriving at
   * once, and the count, the side and the distance are all being adjusted while
   * you watch them move. Committing on every keystroke would put a dozen lamps
   * into the schedule for each digit typed.
   *
   * THE SPECIFICATION IS TAKEN FROM THE BAR AT THE MOMENT OF THE TICK, so an
   * array carries the wattage and optic that were showing when it was placed —
   * one figure for the whole run, which is what makes it one row in the
   * Analysis and what makes changing it there change every lamp in it.
   *
   * THE TOOL STAYS ARMED AND THE DRAFT IS CLEARED, so the next press picks the
   * next geometry. Somebody ringing four rooms does it four times without
   * touching the rail.
   */
  const placeArray = useCallback(() => {
    const d = cobDraftArray;
    if (!d?.geomId || !(d.count > 0)) return;
    const geo = arrayOutline(d.geomId);
    if (!geo) return;
    docActions.addArray({
      geomId: d.geomId, roomId: d.roomId ?? geo.roomId,
      count: d.count, side: geo.closed ? d.side : 'on',
      offsetFt: geo.closed ? d.offsetFt : 0,
      watts: clampWatts(d.watts ?? 7), beam: nearestBeam(d.beam ?? 36),
    }, Date.now().toString(36));
    setCobDraftArray(null);
    setSel(clear());
  }, [docActions, cobDraftArray, arrayOutline, setCobDraftArray, setSel]);

  /** ONE ARRAY'S SPECIFICATION, from the Analysis panel. Every lamp in it moves
   *  together, because there is only one figure and they all read it. */
  const setArraySpec = useCallback((id, patch) => {
    docActions.setArraySpec(id, patch);
  }, [docActions]);

  /**
   * ONE ARRAY'S SETTING-OUT, from its own bar — how many, which side, how far.
   *
   * IT WRITES STRAIGHT THROUGH AND THERE IS NO TICK, which is the one way an
   * array already on the drawing differs from one being set out. A draft is a
   * preview and needs a yes; this run exists, it is in the schedule, and every
   * one of these three figures is a thing somebody adjusts while watching the
   * lamps move. A confirmation on each keystroke would be a control you cannot
   * sweep.
   *
   * THE SAME CLAMPS THE DRAFT'S HANDLERS APPLY, because they are the same
   * questions asked of the same object — a count of zero is not a run, and a
   * negative distance is the other side by another name. See `arrayAsks` for
   * which of the three a given geometry may honestly be asked at all.
   */
  const setArrayShape = useCallback((id, patch) => {
    /* THE COUNT IS QUANTISED AGAINST THIS ARRAY'S OWN GEOMETRY, and the
       quantiser is handed to the action rather than applied here — see
       ARRAY_SHAPE_SET. The number box steps in the right units already (see
       `countStep` on the bar) but a typed figure, a held arrow key and a stored
       plan all reach this too, so one place has to decide what a count may be
       and the drawing can never hold a run of five on a rectangle.
       IT IS A CLOSURE AND NOT A NUMBER BECAUSE THE GEOMETRY IS DERIVED.
       `arrayOutline` is a memo over the shapes and the rooms, which is state the
       document may not contain; the array being edited is found by the reducer,
       so what it needs from here is the arithmetic and not its answer. */
    const quantise = (count) => {
      const geo = arrayOutline(cobArrays.find((a) => a.id === id)?.geomId);
      const q = geo ? arrayQuanta(geo.corners, geo.closed) : null;
      return Math.min(200, quantiseCount(count, q ?? { free: true }));
    };
    docActions.setArrayShape(id, patch, quantise);
  }, [arrayOutline, cobArrays, docActions]);

  /* --- THE DRAFT'S OWN THREE CONTROLS -------------------------------------
     QUANTISED AGAINST THE DRAFT'S OWN GEOMETRY, exactly as a placed array's
     count is — see `draftCount`. The side and the distance are carried straight
     through: a draft is a preview and nothing about it needs a clamp the bar has
     not already applied. */
  const setDraftCount = useCallback((n) => setCobDraftArray((d) => (d
    ? { ...d, count: draftCount(d, arrayOutline(d.geomId), n) } : d)),
    [arrayOutline, setCobDraftArray]);
  const setDraftSide = useCallback((id) => setCobDraftArray((d) => (d
    ? { ...d, side: id } : d)), [setCobDraftArray]);
  const setDraftOffset = useCallback((ft) => setCobDraftArray((d) => (d
    ? { ...d, offsetFt: Math.max(0, Number(ft) || 0) } : d)), [setCobDraftArray]);

  /**
   * ONE RUN'S MODULES, RE-SPECIFIED — from the Analysis panel's own chips.
   *
   * THE ROW'S KEY IS THE FITTING. It was `<trackId>|<kind>` and then
   * `<trackId>|<kind>|<watts>`, and both were groups — so a chip moved four
   * corners together and there was no way to reach one of them. A module is a
   * thing you point at and specify on its own. See `fixtureGroups`.
   *
   * WHY THIS HAD TO EXIST. The row reads its wattage off the fittings — `row.watts
   * = own[0].watts` — and `analyseSpace` believes a group that states its own
   * wattage over anything in the room's override store (see the note on `watts`
   * there, which is the right rule for a hand-placed fitting). So the chips were
   * writing to `fixtureWatts`, the row was ignoring it, and the figure sat at
   * whatever the allocator chose for ever. The chip has to write where the row
   * reads, and that is the fitting.
   *
   * WHOLE WATTS, because a module is specified in them and the length bands are
   * keyed on them — see `DIFFUSER_LENGTHS_MM`. The clamp rides with the action.
   */
  const setTrackModuleSpec = useCallback((id, patch) => {
    docActions.setTrackModuleSpec(id, patch);
  }, [docActions]);

  /** IS THIS ROW A TRACK'S MODULES? One test, because three handlers ask it and
   *  a row key is the only thing they are given. */
  const isModuleRow = useCallback(
    (key) => trackFixtures.some((f) => f.id === key), [trackFixtures]);

  /** THE WHOLE RUN, OFF THE DRAWING. The geometry it was set out on stays — see
   *  the note at the Delete key. */
  const deleteArray = useCallback((id) => {
    docActions.removeArray(id);
    setSel((cur) => (idOf(cur, 'array') === id ? clear() : cur));
    setArrayDrag((d) => (d?.id === id ? null : d));
  }, [docActions, setSel, setArrayDrag]);

  /** ONE MODULE, OFF THE RUN. Its own act, unlike deleting the run — which takes
   *  every module with it (see `deleteShape`). */
  const deleteModule = useCallback((id) => {
    docActions.removeTrackFixture(id);
    setSel((cur) => (idOf(cur, 'module') === id ? clear() : cur));
    setModuleDrag((d) => (d?.id === id ? null : d));
  }, [docActions, setSel, setModuleDrag]);

  /** THE TOGGLE. On fills the grid; off takes back only what is still the
   *  toggle's — see `autoplaceCobs` for why that distinction is the whole safety
   *  of the control. */
  const setAutoplace = useCallback((roomId, on) => {
    docActions.setAutoplace(roomId, on);
    if (on) autoplaceIn(rooms.find((r) => r.id === roomId));
    else docActions.dropAutoCobs(roomId);
  }, [docActions, autoplaceIn, rooms]);

  /** EVERY LAMP NOBODY HAS OVERRULED FOLLOWS ITS CHUNK — see
   *  `reconcileCobSpecs`, which carries the argument and the convergence proof. */
  useEffect(() => {
    if (readOnly || !(pxPerFt > 0) || !rooms.length) return;
    docActions.replaceCobs(reconcileCobSpecs({
      list: manualCobs, rooms, pxPerFt, basisFor: cobBasisFor }));
  }, [rooms, pxPerFt, cobBasisFor, readOnly, manualCobs, docActions]);

  /** RE-SPECIFYING A LAMP SOMEBODY PLACED, from the analysis panel.
   *
   *  IT WRITES TO THE FITTING AND NOT TO `fixtureWatts`, which is the whole
   *  difference between this and `setRowWatts`. That store is a room's override
   *  of a FAMILY — the right shape when the engine chose once for twelve lamps
   *  and somebody is overruling that one choice. A hand-placed COB has no family
   *  decision behind it to override: it was specified as it was put down, the
   *  figures ride on it (see `manualCobs`), and a second store keyed by row would
   *  be a second opinion about the same lamp, kept somewhere the drawing does not
   *  read.
   *  BOTH FIGURES THROUGH THE SAME DOOR, because both are the specification. The
   *  wattage moves the lumen model; the beam angle does not and is not meant to
   *  — it decides where the light lands, and this app's model is about how much
   *  there is. It is stored because it is half of what was ordered.
   *  THE CLAMPS, `spec: true` AND `auto: false` ALL RIDE WITH THE ACTION — see
   *  COB_SPEC_SET. Re-specified is specified, and a re-specified lamp is no
   *  longer the autoplace toggle's to take away. */
  const setCobSpec = useCallback((id, patch) => {
    docActions.setCobSpec(id, patch);
  }, [docActions]);

  /** ONE HAND-PLACED LAMP, AND DELETE REALLY DELETES IT. It has no generator
   *  behind it — nothing re-derives a lamp somebody put down — so there is
   *  nothing to dismiss and nothing to switch off; the fitting IS the record,
   *  and removing it from the list removes it from the drawing, the analysis and
   *  the plan that gets saved. */
  const deleteCob = useCallback((id) => {
    docActions.removeCob(id);
    setSel(clear());
  }, [docActions, setSel]);

  /** THE WHOLE SELECTION, not just the primary. Deleting one of four selected
   *  objects and silently leaving the other three is the reading nobody expects,
   *  and it is the one a single-id delete gives. */
  const deleteObjects = useCallback(() => {
    docActions.removeObjects(selObjIds);
    setSel(clear());
  }, [docActions, selObjIds, setSel]);

  /** THROW THE RUN AWAY — the cross on the bar. Scoped to the lamps placed since
   *  the tool was armed and no others; see `cobRun`. */
  const dropRun = useCallback(() => {
    const doomed = new Set(cobRun);
    docActions.removeCobs([...doomed]);
    setSel((cur) => (doomed.has(idOf(cur, 'cob')) ? clear() : cur));
  }, [cobRun, docActions, setSel]);

  /** A FAN'S SWEEP. EVERY SELECTED FAN, NOT JUST THE PRIMARY — the chip reads
   *  the primary's sweep, because with three fans selected the only honest
   *  "current" value is the one you touched last, but the ACT is what a
   *  properties panel does, and that is to apply the chosen value to everything
   *  selected it makes sense for. Non-fans in the selection are left alone rather
   *  than refused: selecting two fans and a cassette and setting a sweep is a
   *  perfectly clear instruction about the fans. */
  const setSweep = useCallback((mm) => {
    setFanSweepMm(mm);
    docActions.setObjectSweep(selObjIds, mm);
  }, [docActions, selObjIds, setFanSweepMm]);

  /**
   * PUT IT BACK UNDER THE RULES. Delete on a selected light, and it is a
   * DISMISSAL OF THE OVERRIDE rather than a delete — the same act Delete
   * performs on a picked wire, and for the same reason: a light cannot be
   * removed. It is one cell's share of the ambient level, the grid put it there,
   * and a ceiling with a hole in it where a lamp should be is not a thing this
   * app can express. What CAN be taken away is the decision somebody made about
   * where inside its cell it sits.
   */
  const resetLightMove = useCallback((key) => {
    const [roomId, ck] = String(key).split('|');
    docActions.resetLightMove(roomId, ck);
  }, [docActions]);

  /**
   * SPANNING A TRACK ALSO FILLS IT — the automatic module allocator.
   *
   * WHY IT RUNS ON THE COMMIT AND NOT ON A BUTTON. A diffuser answers the
   * room's ambient shortfall. If there is no such shortfall, the hidden grid
   * still supplies the intended spot positions and those are projected onto the
   * rail. The moment a run exists both questions have an answer.
   *
   * THE COUNT IS THE PANEL'S OWN ARITHMETIC RUN BACKWARDS. `spaceAnalysis` says
   * what the space is owed and what it is getting; `netPerUnit` says what one
   * diffuser is worth against THIS room's surfaces, height and country. The
   * quotient, rounded up, is the number. Nothing here re-derives a lumen —
   * see the note on `netPerUnit` for why that matters.
   *
   * AND THE GEOMETRY DECIDES WHERE THEY LAND, which is the other half and a
   * different question: corners on a closed run, ends-then-seven-feet on an
   * open one. See `allocateDiffusers`.
   *
   * FEET AND NOT PIXELS. The allocator's own figures — a module's length, the
   * seven-foot gap — are in feet, and a shape is held in the plan's own feet
   * anyway, so there is no conversion to get wrong.
   *
   * A ROOM IS REQUIRED. A run drawn over no lit
   * space has no shortfall to answer and no reflectances to answer it against;
   * it remains a bare profile. When ambient light is still owed, diffusers
   * answer that shortfall. When it is not, the room's normal grid is projected
   * onto the profile as magnetic track spots instead of leaving the rail empty.
   *
   * IT IS HANDED TO THE GEOMETRY FEATURE AND CALLED BY ITS COMMIT. What a run is
   * filled WITH is this domain's question, not the geometry's — see the head of
   * useGeometryCommands.
   */
  const allocateOnTrack = useCallback((shape) => {
    if (!shapeIsTrack(shape) || !(pxPerFt > 0)) return;
    const pts = shapeOutlineFt(shape);
    if (pts.length < 2) return;
    const closed = !shapeIsOpen(shape);
    const home = roomForTrackPath(rooms, pts, { closed, pxPerFt });
    if (!home?.plan?.ok) return;
    const a = spaceAnalysis(home);
    /* THE COUNT AND THE WATTAGE ARE SOLVED TOGETHER, and `netFor` is the panel's
       own arithmetic handed to the solver as a function of wattage — see
       `chooseDiffusers`, and `netPerUnit` for why nothing here re-derives a
       lumen. This replaced a fixed 18 W and a count rounded up to the geometry's
       quantum, which put 3,834 lm of diffuser into a room that wanted 1,250. */
    /* THE SHORTFALL, IN WATTS. The allocator's rule is written in watts —
       "27 W over four corners is 6.75 W each" — so the conversion happens here,
       once, against what ONE watt of this family is worth to THIS room. Linear,
       because `unitOutput` is: no fixed lumens on the family, so a watt is a
       watt and the division is exact rather than a fit.
       `track_diffuser` AND NOT `panel`. They share a distribution and are two
       products with two ranges — see lumens.js. */
    const fam = MODULE_BY_ID.diffuser.family;
    const perW = netPerUnit(fam, 1, { ref: a.ref, lumensPerWatt: a.lumensPerWatt });
    const watts = FAMILY_BY_ID[fam]?.watts;
    const needsAmbient = a.shortfall > 0;
    let plan = [];
    if (needsAmbient && perW > 0) {
      plan = planDiffusers(pts, {
        closed, needW: a.shortfall / perW,
        /* --- THE CATALOGUE, OFF THE FAMILY, AND THE SAME ARRAY THE CHIPS USE ---
           WHAT A DIFFUSER IS SOLD AT COMES FROM UPSTREAM AND NOT FROM THE
           ALLOCATOR. `FAMILY_BY_ID.track_diffuser.watts` is the one store — see
           `TRACK_DIFFUSER_WATTS` in lumens.js — and it is also exactly what
           `analyseSpace` copies onto the row as `wattOptions` for SpaceAnalysis to
           draw a chip per entry. Read here through the FAMILY rather than by
           importing the constant, so the allocator and the panel look at the same
           array object: the allocator cannot pick a wattage the chips cannot show,
           and a brand's catalogue swapped into the family is followed by both
           without either being touched.
           IT IS PASSED AND NOT DEFAULTED. `planDiffusers` has no built-in list —
           see its note — so a caller that forgets this places nothing rather than
           quietly solving against a range nobody in this project sells. */
        watts,
      });
    } else if (!needsAmbient) {
      /* USE THE PLANNER'S FITTINGS, NOT ITS CELLS. A large grid fitting may
         cover two cells; treating every cell as a spot is how a four-light
         answer became seven heads on the rail. */
      const cells = new Map((home.plan.gridCellsPx ?? []).map((cell) => [cell.id, cell]));
      const grid = (home.plan.gridLightsPx ?? []).map((light) => {
        const ids = light.cells ?? (light.cell?.id != null ? [light.cell.id] : []);
        return {
          xFt: light.x / pxPerFt, yFt: light.y / pxPerFt,
          gridCells: ids.map((id) => lightKey(home.id, id)),
          cellsFt: ids.map((id) => cells.get(id)).filter(Boolean).map((cell) => ({
            x0: cell.x0 / pxPerFt, y0: cell.y0 / pxPerFt,
            x1: cell.x1 / pxPerFt, y1: cell.y1 / pxPerFt,
          })),
        };
      });
      const owned = gridSpotsOwnedByTrack(pts, grid, { closed });
      plan = gridSpotsOnTrack(pts, owned, {
        closed, watts: FAMILY_BY_ID[MODULE_BY_ID.spot.family]?.watts,
      });
    }
    if (!plan.length) return;
    /* IF AUTOPLACE WAS ALREADY ON, TAKE BACK ONLY ITS LAMPS IN CELLS THE NEW
       TRACK NOW OWNS. A dragged or re-specified lamp has `auto: false` and is
       somebody's decision, so it is never removed here. */
    const claimed = new Set(plan.flatMap((mod) => mod.gridCells ?? []));
    if (claimed.size) {
      const nextCobs = manualCobs.filter((cob) => {
        if (!cob.auto || cob.roomId !== home.id) return true;
        const x = cob.xFt * pxPerFt, y = cob.yFt * pxPerFt;
        const cell = (home.plan.gridCellsPx ?? []).find((q) =>
          x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1);
        return !cell || !claimed.has(lightKey(home.id, cell.id));
      });
      if (nextCobs.length !== manualCobs.length) docActions.replaceCobs(nextCobs);
    }
    /* EACH MODULE CARRIES THE WATTAGE ITS OWN SLOT WAS GIVEN, which is the whole
       point of the corner-first rule: a run comes out as four 5 W at the corners
       and a 10 W in the middle of a rail, and those are two figures on one
       profile. The Analysis panel groups by wattage for the same reason — see
       `fixtureGroups`. */
    docActions.addTrackFixtures(plan.map((mod, i) => placeModule({
      on: shape.id, kind: needsAmbient ? 'diffuser' : 'spot',
      u: mod.u, watts: mod.watts, gridCells: mod.gridCells,
      seq: `a${i}` })));
    /* AND THE PANEL GOES TO THE SPACE, because the two figures at the top of it
       have just moved by the whole of what the run adds. A tool that changed a
       room's verdict silently would be the one act on this drawing worth
       watching, performed off screen. */
    docActions.setFocusId(home.id); setOptionPick(null); docActions.setView('spaces');
  }, [docActions, manualCobs, pxPerFt, rooms, spaceAnalysis, setOptionPick]);

  return {
    autoplace: { fill: autoplaceIn, set: setAutoplace },
    arrays: { place: placeArray, setSpec: setArraySpec, setShape: setArrayShape,
              remove: deleteArray,
              setDraftCount, setDraftSide, setDraftOffset },
    modules: { setSpec: setTrackModuleSpec, isRow: isModuleRow,
               remove: deleteModule, allocateOnTrack },
    cob: { setSpec: setCobSpec, remove: deleteCob, dropRun },
    objects: { remove: deleteObjects, setSweep },
    lights: { reset: resetLightMove },
  };
}
