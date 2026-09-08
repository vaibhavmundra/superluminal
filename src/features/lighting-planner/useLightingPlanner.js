import { useCallback } from 'react';
import { FAMILY_BY_ID } from '../../lib/lumens.js';
import useLightingClaims from './useLightingClaims.js';
import usePlanPipeline from './usePlanPipeline.js';
import { chunkOptionPicks } from './lightingRules.js';

/**
 * THE HIGH-LEVEL LIGHTING WORKFLOW — the feature's THIRD call site, and the
 * public one. What it means to light a plan: what a space is claimed for, what
 * gets run over it and in what order, what the loading screen says while that
 * happens, what the whole thing adds up to, and what comes out the other end as
 * a schedule.
 *
 * IT STANDS WHERE `runPipeline` STOOD, and it is the highest point at which
 * everything it needs exists: the analysis group is built at the second call
 * site above (because `useFixtureCommands`, between the two, is handed
 * `spaceAnalysis`), the recognition and room-intelligence commands are composed
 * above that, and the run's own screen state is asked for on its own near the
 * top of App because half the editor's controls carry `!prep`. Same three-way
 * split `features/fixtures/`, `features/ceiling-geometry/` and
 * `features/electrical/` make, and for the same reason.
 *
 * WHAT IT COORDINATES, AND IT DOES SO THROUGH PUBLIC APIs ONLY:
 *   · features/recognition/    `computeBedFit`, `refindBeds`, `absorbBedRows`
 *   · features/room-intelligence/  `computeRoomType`, `computeAccents`,
 *                              `computeSurfaces`, and the pure `absorbContest`
 *   · features/scene/          the projected accent runs and task surfaces, and
 *                              the computed rooms
 *   · features/ceiling-geometry/  nothing directly — what a chunk's options ARE
 *                              arrives on the room, off the layout
 *   · features/fixtures/       the projected tracks, modules and array lamps,
 *                              and the autoplace command it re-exposes
 * Not one of those is reached into. Every input is handed in by App, which is
 * where the cross-domain wiring belongs.
 *
 * `usePlanDoc` REMAINS THE SINGLE PERSISTENT-DOCUMENT BOUNDARY. Nothing here
 * holds a copy of anything saved: the room types, the verdicts, the detections,
 * the accent and surface results, the lit and dirty lists, the design picks and
 * the per-row wattages are all read out of the stores App hands in and written
 * through `docActions`. What IS held here is the RUN — a progress dialog and a
 * stop flag — and neither survives a reload, because what comes back next time
 * is the design.
 */
export default function useLightingPlanner({
  // the run's own screen, from the first call site
  run,
  // everything the second call site worked out
  analysis, boq,
  // the drawing
  source, outlines, outlinesPx, rooms, pxPerFt, projectId, useBoundingRect,
  planAreaSqft,
  // the document's stores and its one writer
  roomTypes, detections, autoSpots, docActions,
  // the other domains, through their public commands
  bedSets, computeBedFit, refindBeds, absorbBedRows,
  computeRoomType, computeAccents, computeSurfaces,
  setAutoplace,
  // App's own screens and its two callbacks
  readOnly, onClaimLayout, setPickingId, setOutlinesOpen, hideCoach, milestone,
}) {
  const { claimSpaces, lightWholePlan, lightOneRoom } = useLightingClaims({
    outlines, outlinesPx, pxPerFt, readOnly, onClaimLayout, docActions,
    setPickingId, setOutlinesOpen, milestone,
  });

  const pipeline = usePlanPipeline({
    source, outlines, outlinesPx, rooms, pxPerFt, projectId, roomTypes, detections,
    bedSets, useBoundingRect, planAreaSqft,
    computeBedFit, refindBeds, absorbBedRows,
    computeRoomType, computeAccents, computeSurfaces,
    claimSpaces, docActions,
    prep: run.prep, setPrep: run.setPrep, cancelPrep: run.cancelPrep,
    setPickingId, setOutlinesOpen, milestone,
  });

  /** ONE ROW'S WATTAGE, IN ONE ROOM — a run's own, or a counted family's. `key`
   *  is whatever `fixtureGroups` said identifies the row; `familyId` is only
   *  needed to know what its default is. A choice that lands back on that
   *  default is stored as nothing, the rule every override in this app
   *  follows — see `boardKinds` and the wall tones.
   *  THE FAMILY'S DEFAULT IS RESOLVED HERE, for the reason `materialsOf` is
   *  resolved by its caller: FAMILY_BY_ID is the catalogue and the catalogue is
   *  not the document's to know. What the action carries is the number a row at
   *  its default would be, which is the whole of what the reducer needs to
   *  decide whether this wattage is a decision or a restatement. */
  const setRowWatts = useCallback(
    (roomId, key, familyId, watts) =>
      docActions.setRowWatts(roomId, key, watts, FAMILY_BY_ID[familyId]?.defaultWatts),
    [docActions]);

  /**
   * FLIP ONE CHUNK THROUGH ITS OPTIONS.
   *
   * THE ARITHMETIC IS `chunkOptionPicks`, which is pure and carries the whole
   * argument for reading the current answer off the LAYOUT rather than out of
   * `designPicks`. What is left here is the two things that need a component:
   * finding the room, and the card that has done its job.
   */
  const cycleChunkOption = useCallback((roomId, key, dir = 1) => {
    // THE ARROW WAS PRESSED, SO THE CARD HAS DONE ITS JOB — and it goes now
    // rather than on the second press, because the first flip is the moment the
    // chip stops being a label and starts being a control.
    hideCoach();
    const base = chunkOptionPicks(rooms.find((r) => r.id === roomId), key, dir);
    if (!base) return;
    docActions.setDesignPick(roomId, base);
  }, [docActions, rooms, hideCoach]);

  return {
    /* WHAT THE PLAN ADDS UP TO. Passed straight through from the second call
       site so there is ONE object App reads a lighting answer off, whichever of
       the three calls happened to compute it. */
    analysis,
    /* THE SCHEDULE, AND THE SCHEDULE AS A FILE. `boq.file(fmt)` prepares the
       download and does not perform it — see the note at it. */
    boq,
    /* THE RUN. `prep` is null when nothing is running, which is also what the
       loader keys off, and `loaderRooms` is what it draws. */
    pipeline,
    commands: {
      /* THE TILL. Every route into a layout goes through `claim`; the two acts
         beside it are the tracer's own buttons. */
      claim: claimSpaces, lightWholePlan, lightOneRoom,
      /* THE PASSES. `run(opts)` is the whole pipeline and every re-run of one
         part of it; `stop()` lands on whatever finished. */
      run: pipeline.run, stop: pipeline.stop,
      /* THE THREE EDITS THAT CHANGE WHAT A SPACE ADDS UP TO. Filling a ceiling's
         grid is `features/fixtures/`'s command, re-exposed here because the
         control it sits under is this panel's — see the space detail. */
      setRowWatts, cycleChunkOption, setAutoplace,
    },
    status: {
      /* IS A RUN ON. One flag rather than every caller testing `prep` for
         truthiness, which is what a dozen `!prep` guards in App were doing. */
      running: !!run.prep,
      /* WHICH CEILINGS ARE FILLING THEIR OWN GRID. Per space, because it is a
         decision about one ceiling: a flat can have its bedrooms laid out
         automatically and its living room by hand.
         `autoplaceOn` AND NOT `autoplaceIn`, WHICH IS A DIFFERENT FUNCTION AND
         STILL EXISTS. features/fixtures/'s `autoplace.fill` is `autoplaceIn` —
         it FILLS a ceiling's empty cells — and this one only ASKS whether a
         ceiling is switched on. Two names one letter apart for a placer and a
         predicate is how the wrong one gets called. */
      autoplaceOn: (roomId) => autoSpots.includes(roomId),
    },
    /* A FRESH SHEET TAKES THE RUN'S SCREEN DOWN — the two statements
       `resetForNewPlan` used to make, in the same order. Everything else this
       feature can be said to hold is either derived or the document's, and both
       are cleared by the caller. */
    reset: run.reset,
  };
}
