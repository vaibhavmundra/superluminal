import { useMemo } from 'react';
import { projectAllBoardsPx, projectFlowsPx, projectSwitchboardsPx } from '../../lib/electricalProjection.js';
export function useSceneElectricalProjections({
  rooms, boardsFor, bayBoardsFor, placedBoardsFor, bayResults, obstaclesPx, accentZonesPx,
  taskSpotsPx, lampsPx, elecPointsPx, outdoorFeeds, pxPerFt, baysOf, flowBoards, flowBends, flowLinks,
  layers, doorEdit
}) {
  /**
   * SB1, SB2, SB3 — every plate on the job, numbered.
   *
   * ONE SEQUENCE OVER THE WHOLE PLAN AND NOT ONE PER ROOM, because that is what
   * a switchboard number IS on a drawing: SB7 is a plate you can point at across
   * a sheet, and "the third one in the kitchen" is not a name.
   *
   * DERIVED, LIKE THE PLATES THEMSELVES, and therefore ORDER IS EVERYTHING. The
   * numbering has to be stable under things that do not add or remove a plate,
   * or the names would shuffle while somebody worked:
   *
   *   · rooms in the order the layout holds them, which is the order everything
   *     else on this sheet is in;
   *   · within a room, the rules' boards, then the bay boards, then the ones
   *     placed by hand — the order the three passes run in;
   *   · UNGATED BY LAYERS, which is the trap this avoids. `switchboardsPx` drops
   *     the bay boards while the electrical layer is off; numbering off that
   *     list would renumber half the plan when somebody flicked a switch.
   *
   * WHAT DOES RENUMBER IS ADDING OR DELETING A PLATE, and that is unavoidable in
   * any sequential scheme — it is also how SB numbers behave on a real job, where
   * the schedule is renumbered when the drawing changes.
   */
  const boardNames = useMemo(() => {
    const m = new Map();
    let n = 0;
    for (const r of rooms) {
      for (const b of [...boardsFor(r), ...bayBoardsFor(r), ...placedBoardsFor(r)]) {
        if (!m.has(b.id)) m.set(b.id, `SB${++n}`);
      }
    }
    return m;
  }, [rooms, boardsFor, bayBoardsFor, placedBoardsFor]);

  /**
   * EVERY PLATE ON THE SHEET, whatever room it stands in and whatever the
   * layers say.
   *
   * NOT `switchboardsPx`, WHICH IS THE DRAWING'S LIST. That one drops the bay
   * boards while the electrical layer is off, correctly — a plate that exists
   * because a bay needed one is part of the flow reading and has no business on
   * a sheet with the wiring switched off. This list is not for drawing: it is
   * the pool a HAND ASSIGNMENT may name (see `boardPool` in flows.js), and a
   * wire dropped onto a plate last week must not come unstuck because somebody
   * turned a layer off today.
   */
  const allBoardsPx = useMemo(() => projectAllBoardsPx(rooms, boardsFor, bayBoardsFor, placedBoardsFor), [rooms, boardsFor, bayBoardsFor, placedBoardsFor]);

  /**
   * EVERY FLOW ON THE SHEET. See flows.js for what a flow is and why the row is
   * the unit; this only gathers what one space's worth of it needs.
   *
   * NOT GATED ON THE LAYER. It is cheap, it feeds the schedule's switch count as
   * well as the drawing, and a memo that only runs while something is visible is
   * a memo that recomputes the moment somebody looks at it.
   */
  const flowsPx = useMemo(() => projectFlowsPx(rooms, boardsFor, bayBoardsFor, bayResults, obstaclesPx, accentZonesPx, taskSpotsPx, outdoorFeeds, pxPerFt, baysOf, allBoardsPx, placedBoardsFor, flowBoards, flowBends, lampsPx, flowLinks, elecPointsPx), [rooms, boardsFor, bayBoardsFor, bayResults, obstaclesPx, accentZonesPx, taskSpotsPx,
      outdoorFeeds, pxPerFt, baysOf, allBoardsPx, placedBoardsFor, flowBoards, flowBends, lampsPx, flowLinks, elecPointsPx]);

  const switchboardsPx = useMemo(() => projectSwitchboardsPx(rooms, boardsFor, bayBoardsFor, placedBoardsFor, boardNames, layers.electrical, doorEdit, pxPerFt), [rooms, boardsFor, bayBoardsFor, placedBoardsFor, boardNames,
      layers.electrical, doorEdit, pxPerFt]);
  return { projections: { allBoardsPx, flowsPx, switchboardsPx, boardNames } };
}
