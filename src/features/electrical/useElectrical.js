// ---------------------------------------------------------------------------
// useElectrical.js — THE WHOLE OF THE WIRING, IN ONE INTERFACE.
//
// WHAT IT CONSUMES. The scene (`rooms` and the projections that stand on it),
// the room-intelligence results the rules read (`roomTypes`, `accentZonesPx`),
// the shared selection service (`sel` / `setSel` — see lib/selection.js), and
// `doc` / `docActions`. Every one of those is an explicit input coordinated by
// App; nothing here imports App or another feature's private files.
//
// `usePlanDoc` REMAINS THE PERSISTENT-DOCUMENT BOUNDARY. Nine stores belong to
// this domain — `boardsOff`, `boardMoves`, `boardPoints`, `flowBoards`,
// `flowBends`, `manualBoards`, `boardKinds`, `boardHeights`, `boardOrders`,
// and the `doorsOk` confirmation that gates the layer — and every one of them
// is still the document's, read out of `doc` and written through `docActions`.
// Nothing is copied into this feature. What IS held here is the three pieces of
// transient state a wiring gesture needs: the plate being slid, the wire being
// aimed, and whether the placing step is open.
//
// DERIVED VERSUS MANUAL IS THE WHOLE SHAPE OF THIS DOMAIN, and it is preserved
// exactly. A rule's plate is a memo, so "not this one" is a dismissal into
// `boardsOff` and a hand position is an arc length in `boardMoves`; a
// hand-placed plate has no rule to come back from, so it is a member of
// `manualBoards` that is removed rather than dismissed, and its `sFt` IS its
// position. The three sources of boards keep their own reader functions and
// their own ids, which is what lets the flows take ownership from one list and
// geometry from another.
//
// THE SCENE'S OWN ELECTRICAL PROJECTIONS ARE CALLED FROM HERE, and that is the
// one cross-feature import in this file. `useSceneElectricalProjections` is a
// public adapter of features/scene (see its README) and it needs the three
// board readers, which are private to this feature — so the call has to stand
// on this side of the line. Nothing else of scene's is touched.
// ---------------------------------------------------------------------------
import { useCallback } from 'react';
import { idOf } from '../../lib/selection.js';
import { useSceneElectricalProjections } from '../scene/useSceneElectricalProjections.js';
import { useBoardRules } from './useBoardRules.js';
import { useBoardPanel } from './useBoardPanel.js';
import { useBoardGestures } from './useBoardGestures.js';

export function useElectrical({
  // --- the scene ---------------------------------------------------------
  rooms, pxPerFt, obstaclesPx, wardrobesPx, accentZonesPx, taskSpotsPx, lampsPx,
  // --- room intelligence and the drawing's own facts ----------------------
  roomTypes, doors, projectId, country, layers, doorEdit,
  // --- the shared selection service ---------------------------------------
  sel, setSel,
  // --- the pointer ---------------------------------------------------------
  svgPoint, svgRef, pressState,
  // --- the switchboard step, composed at App's earlier call site -----------
  boardStep,
  // --- the document ---------------------------------------------------------
  doc, docActions,
}) {
  const { boardsOff, boardMoves, boardPoints, flowBoards, flowBends,
          manualBoards, boardKinds, boardHeights, boardOrders, doorsOk } = doc;

  const selBoardId = idOf(sel, 'board');
  const selFlowId = idOf(sel, 'flow');

  const rules = useBoardRules({
    rooms, doors, roomTypes, projectId, accentZonesPx, wardrobesPx, pxPerFt, country,
    boardMoves, boardsOff, boardKinds, boardHeights, manualBoards,
  });
  const { sbCountry, boardsFor, bayResults, bayBoardsFor,
          placedBoardsFor, baysOf, outdoorFeeds } = rules;

  const { projections: { allBoardsPx, flowsPx, switchboardsPx, boardNames } } =
    useSceneElectricalProjections({
      rooms, boardsFor, bayBoardsFor, placedBoardsFor, bayResults, obstaclesPx, accentZonesPx,
      taskSpotsPx, lampsPx, outdoorFeeds, pxPerFt, baysOf, flowBoards, flowBends, layers, doorEdit
    });

  const panel = useBoardPanel({
    rooms, boardsFor, bayBoardsFor, placedBoardsFor, boardNames, sbCountry,
    switchboardsPx, flowsPx, selBoardId, selFlowId, setSel,
    boardPoints, boardOrders, docActions,
  });

  const gestures = useBoardGestures({
    rooms, pxPerFt, svgPoint, svgRef, pressState, setSel, docActions,
    flowsPx, allBoardsPx, setBoardOutlet: panel.setBoardOutlet,
    /* THE PLACED OBJECTS, FOR ONE COMMAND ONLY. `socketForLamp` needs to know
       what else is standing in the room before it decides whether a plate has
       to go up — see `lampPlateToShare`. */
    obstaclesPx,
  });

  /**
   * THE ANSWER, AND THE ONE THING IT TURNS ON.
   *
   * Confirming is not "save the doors" — the doors were already saved, edit by
   * edit, because they are the same list the scale and the board pass read. It
   * records that a person has LOOKED, and that is the gate the wiring is behind.
   *
   * CLOSING THE DOOR STEP IS APP'S HALF and stands where it stood: the step is
   * the door domain's screen, and this feature only owns what confirming BUYS.
   */
  const confirmDoors = useCallback(() => {
    docActions.setDoorsOk(true);
    docActions.setLayer('electrical', true);
  }, [docActions]);

  /** Every plate this step put down, taken back. See `panel.placedCount`. */
  const clearPlacedBoards = useCallback(() => docActions.clearManualBoards(), [docActions]);

  /** The layer switch itself, once the doors have been looked at. */
  const toggleLayer = useCallback(
    () => docActions.toggleLayer('electrical'), [docActions]);

  /* --- WHAT A FRESH SHEET TAKES AWAY ---------------------------------------
     The plates somebody threw away go with the plan they were on: a board id
     names a room and a rule, and neither means anything on a fresh sheet. The
     statements are in the order `resetForNewPlan` ran them. */
  const { setBoardDrag, setFlowDrag } = gestures;
  const { setBoardPlace } = boardStep;
  const resetElectrical = useCallback(() => {
    docActions.clearBoardsOff(); docActions.clearBoardMoves();
    docActions.clearBoardPoints();
    setBoardDrag(null);
    docActions.clearFlowBoards(); docActions.clearFlowBends(); setFlowDrag(null);
    docActions.clearManualBoards(); docActions.clearBoardKinds();
    docActions.clearBoardHeights(); docActions.clearBoardOrders();
    setBoardPlace(false);
  }, [docActions, setBoardDrag, setFlowDrag, setBoardPlace]);

  /* ...AND THE CONFIRMATION GOES WITH THEM. It is an answer about ONE set of
     door boxes; carrying it onto a fresh sheet would draw wiring off a
     detection nobody has looked at. Its own member because it did not run with
     the block above — it stood among the door resets, and App calls it there. */
  const resetDoorConfirmation = useCallback(
    () => docActions.setDoorsOk(false), [docActions]);

  return {
    /** What the canvas draws and what it hands a pointer to. */
    canvas: {
      switchboardsPx, flowsPx, allBoardsPx, boardNames,
      selBoardId, selFlowId,
      boardDrag: gestures.boardDrag, flowDrag: gestures.flowDrag,
      onBoardPointerDown: gestures.boardPointerDown,
      boardPointerMove: gestures.boardPointerMove,
      boardPointerUp: gestures.boardPointerUp,
      onFlowPointerDown: gestures.flowPointerDown,
      onFlowGripDown: gestures.flowGripDown,
      flowPointerMove: gestures.flowPointerMove,
      flowPointerUp: gestures.flowPointerUp,
    },
    /** The card in the editing column, and the step that puts plates down. */
    panel: {
      selBoard: panel.selBoard,
      selBoardExtras: panel.selBoardExtras,
      selBoardParts: panel.selBoardParts,
      heightOf: panel.heightOf,
      country: sbCountry,
      placing: boardStep.boardPlace,
      /* THE GATE, WHERE THE SWITCH THAT OBEYS IT IS. A switchboard is placed
         beside a door, so the wiring cannot honestly be turned on until
         somebody has said the door boxes are right — see `confirmDoors`. */
      doorsOk,
      /* HOW MANY PLATES THE STEP ITSELF PUT DOWN. Only the hand-placed ones:
         the rules put boards beside doors and beds of their own, and a
         "clear all" that took those would be offering to undo work this step
         did not do. See the step's readout. */
      placedCount: manualBoards.length,
    },
    /** Every plate on the job — the schedule, and the country it is drawn for. */
    sheet: { groups: panel.boardSheet, country: sbCountry },
    /** Everything a person can do to a plate, a wire or the wiring itself. */
    commands: {
      pickFlow: panel.pickFlow,
      reorderBoardUnit: panel.reorderBoardUnit,
      setBoardOutlet: panel.setBoardOutlet,
      setBoardAmps: panel.setBoardAmps,
      setBoardHeight: panel.setBoardHeight,
      addBoardPoint: panel.addBoardPoint,
      removeBoardPoint: panel.removeBoardPoint,
      resetBoard: panel.resetBoard,
      deleteBoard: panel.deleteBoard,
      placeBoardAt: gestures.placeBoardAt,
      /* THE ONE COMMAND ON THIS LIST THAT ANOTHER DOMAIN CALLS. Placing a
         standing lamp can oblige the electrical drawing to grow a socket — see
         `socketForLamp` — and the lamp is placed by the fixtures feature, so
         this is handed across rather than being reached for. It is a command
         and not a rule: it writes a plate, once, at the moment of placement. */
      socketForLamp: gestures.socketForLamp,
      openBoardPlace: boardStep.openBoardPlace,
      closeBoardPlace: boardStep.closeBoardPlace,
      clearPlacedBoards,
      confirmDoors, toggleLayer,
    },
    /** What is picked, and the pool the pick is resolved against. */
    selection: { boardId: selBoardId, flowId: selFlowId, board: panel.selBoard },
    /** Two members, because `resetForNewPlan` did not run them together. */
    reset: { electrical: resetElectrical, doorConfirmation: resetDoorConfirmation },
  };
}

export default useElectrical;
