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

  /** ONE ROW'S WATTAGE, IN ONE ROOM — a run's own, or a counted family's. The
   *  ROW is the argument: `row.key` is whatever `fixtureGroups` said identifies
   *  it, and the row is also the only thing that knows what its default is. A
   *  choice that lands back on that default is stored as nothing, the rule every
   *  override in this app follows — see `boardKinds` and the wall tones.
   *  THE DEFAULT IS RESOLVED HERE, for the reason `materialsOf` is resolved by
   *  its caller: the catalogue is not the document's to know. What the action
   *  carries is the number a row at its default would be, which is the whole of
   *  what the reducer needs to decide whether this wattage is a decision or a
   *  restatement.
   *
   *  AND IT IS THE ROW'S DEFAULT RATHER THAN THE FAMILY'S, WHICH IS THE FIX FOR
   *  A WATTAGE THAT COULD NOT BE CHOSEN AT ALL. This took `familyId` and asked
   *  the catalogue for `FAMILY_BY_ID[familyId].defaultWatts` — and a row may
   *  open somewhere other than its family's default. The spots are why: a
   *  directional spot and an ambient downlight are one FAMILY and two catalogue
   *  lines, 5 W against 7 W, so `fixtureGroups` stamps the row's own
   *  `defaultWatts` and `wattsFor` honours it. The reducer was being handed the
   *  family's 7 regardless, so pressing the 7 W chip on a Directional spot row
   *  read as "back to the default", DELETED the override, and the row fell
   *  straight back to 5 — one chip out of five that could not be picked, and the
   *  most familiar figure of the five.
   *  SO THE ROW IS PASSED WHOLE rather than a fifth argument being added for
   *  its default. A trailing optional would let the next call site forget it and
   *  get this bug back silently; a row cannot be passed without the number that
   *  belongs to it. `row.defaultWatts` comes off `analyseSpace`, which is where
   *  the two halves of the answer already meet — see the note there. */
  const setRowWatts = useCallback(
    (roomId, row, watts) =>
      docActions.setRowWatts(roomId, row.key, watts,
        row.defaultWatts ?? FAMILY_BY_ID[row.familyId]?.defaultWatts),
    [docActions]);

  /** SWITCHING ONE FITTING OFF, OR BACK ON.
   *
   *  NO DEFAULT TO PASS, unlike the wattage above it: lit is the default, and
   *  the reducer already treats "on" as the absence of an entry. So the row is
   *  not needed whole — only its key — and the caller hands the state it WANTS
   *  rather than a toggle, because two presses racing on a toggle would land
   *  wherever the second one happened to read.
   *
   *  WHAT IT COSTS IS ONE LINE IN `analyseSpace`: an off row emits nothing, and
   *  every reader of the lumen model — the readout, the two contributions and
   *  the heatmap, which asks this same model what a fitting puts out — follows
   *  from that without being told separately. */
  const setRowOff = useCallback(
    (roomId, row, off) => docActions.setRowOff(roomId, row.key, off),
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
      /* ...AND THE PRESS THAT LEAVES THE OUTLINES, which is no longer one of
         them. It takes the spaces up and opens the design screen at once; the
         classifier and the bed re-check run behind it. See `confirmOutlines`. */
      confirmOutlines: pipeline.confirmOutlines,
      /* THE THREE EDITS THAT CHANGE WHAT A SPACE ADDS UP TO. Filling a ceiling's
         grid is `features/fixtures/`'s command, re-exposed here because the
         control it sits under is this panel's — see the space detail. */
      setRowWatts, setRowOff, cycleChunkOption, setAutoplace,
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
