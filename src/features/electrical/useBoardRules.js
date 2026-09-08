// ---------------------------------------------------------------------------
// useBoardRules.js — THE MEMO ADAPTERS OVER boardRules.js.
//
// Nothing is computed here. Every body is a call into the pure module and every
// dependency array is the one App carried, unchanged — which is what keeps a
// board slide from recomputing the layout and a focus change from recomposing
// a plate. The three sources of boards (the rules, the bays, the hand) come out
// as three functions of a room rather than three lists, because that is how
// every reader downstream asks for them.
// ---------------------------------------------------------------------------
import { useCallback, useMemo } from 'react';
import { countryFor } from '../../lib/switchboards.js';
import { planBoardResults, planBayResults, planOutdoorFeeds, baysOfRoom,
         boardModeOf, applyMode, drawnBoards, ruleBoards, handBoards } from './boardRules.js';

const warnRules = (roomId, err) => console.warn('[electrical] the rules failed for', roomId, err);

export function useBoardRules({
  rooms, doors, roomTypes, projectId, accentZonesPx, wardrobesPx, pxPerFt, country,
  boardMoves, boardsOff, boardKinds, boardHeights, manualBoards,
}) {
  /** @see planBoardResults — the three free rules, on every space, always. */
  const boardResults = useMemo(() => planBoardResults({
    rooms, doors, roomTypes, projectId, accentZonesPx, wardrobesPx, boardMoves, pxPerFt,
    warn: warnRules,
  }), [rooms, doors, roomTypes, projectId, accentZonesPx, wardrobesPx, boardMoves, pxPerFt]);

  /**
   * WHERE THE BUILDING IS, as the registry's own record for it.
   *
   * UP HERE, AND NOT BESIDE THE COMPOSITION IT IS FOR. It belongs in the block
   * five hundred lines down where the plates are composed, and that is where it
   * was — until `boardMode` below started needing it. A `useCallback`'s BODY is
   * deferred but its DEPENDENCY ARRAY is evaluated the moment the line is
   * reached, so naming a `const` declared later reads it in its temporal dead
   * zone and throws during the first render. The error says "Cannot access
   * 'sbCountry' before initialization" and points at a line that looks fine,
   * because the offending read is in the array and not in the function.
   *
   * `country` IS A PROP, so this can be resolved as early as it likes and there
   * is nothing above it that could want it later.
   */
  const sbCountry = useMemo(() => countryFor(country), [country]);

  /** @see boardModeOf — outlet or switchboard, and at what rating. */
  const boardMode = useCallback(
    (b) => boardModeOf(b, { boardKinds, country: sbCountry }), [boardKinds, sbCountry]);

  /** @see applyMode — the plate with that answer applied, and its height. */
  const withMode = useCallback(
    (list) => applyMode(list, { boardMode, boardHeights }), [boardMode, boardHeights]);

  /** @see drawnBoards — this space's boards, minus the ones thrown away. */
  const boardsFor = useCallback(
    (r) => withMode(drawnBoards(boardResults[r.id]?.boards ?? [], { boardsOff })),
    [boardResults, boardsOff, withMode]);

  /** @see ruleBoards — the same boards, at the positions the RULES chose. */
  const ruleBoardsFor = useCallback(
    (r) => ruleBoards(boardResults[r.id]?.boards ?? [], { boardsOff, boardMode }),
    [boardResults, boardsOff, boardMode]);

  /** @see baysOfRoom — the pieces of ceiling a board and a flow belong to. */
  const baysOf = useCallback((r) => baysOfRoom(r), []);

  /** @see planBayResults — one plate per piece of ceiling that has none. */
  const bayResults = useMemo(() => planBayResults({
    rooms, pxPerFt, baysOf, ruleBoardsFor, wardrobesPx, boardMoves, projectId, roomTypes,
  }), [rooms, pxPerFt, baysOf, ruleBoardsFor, wardrobesPx, boardMoves, projectId, roomTypes]);

  /**
   * The bay plates of one space, as drawn.
   *
   * THE SAME TWO FILTERS THE RULE BOARDS GET, and they were missing. A bay plate
   * is a switchboard on the drawing — same rectangle, same blue, same hover card
   * — so it is selectable and grabbable like any other, and a delete or a drag
   * that quietly did nothing to one would be an affordance that lies. `boardsOff`
   * and `asDrawn` belong to "a plate on this sheet", not to "a plate a rule
   * placed".
   *
   * ONE FUNCTION BECAUSE THERE ARE TWO READERS. The canvas and the flows both
   * want these, and two copies of the filter is two chances to disagree about
   * whether a deleted bay plate is still on the drawing.
   */
  const bayBoardsFor = useCallback(
    (r) => withMode(drawnBoards(bayResults[r.id]?.boards ?? [], { boardsOff })),
    [bayResults, boardsOff, withMode]);

  /** @see handBoards — the plates somebody put on this space's walls. */
  const placedBoardsFor = useCallback(
    (r) => withMode(handBoards(r, { manualBoards, boardsOff, pxPerFt })),
    [manualBoards, boardsOff, pxPerFt, withMode]);

  /** @see planOutdoorFeeds — which plate switches each outdoor space. */
  const outdoorFeeds = useMemo(() => planOutdoorFeeds({
    rooms, roomTypes, projectId, pxPerFt, boardsFor, bayBoardsFor,
  }), [rooms, roomTypes, projectId, pxPerFt, boardsFor, bayBoardsFor]);

  return { boardResults, sbCountry, boardMode, boardsFor, ruleBoardsFor,
           baysOf, bayResults, bayBoardsFor, placedBoardsFor, outdoorFeeds };
}

export default useBoardRules;
