// ---------------------------------------------------------------------------
// boardSheet.js — WHAT IS ON A PLATE, AND THE SCHEDULE OF ALL OF THEM.
//
// PURE. `switchboards.js` composes one plate; this says which of its two
// composers a given plate gets, and folds the answer over the whole job. The
// panel's card and the sheet both come through `composeBoard`, so the two
// cannot come to disagree about what SB7 is.
// ---------------------------------------------------------------------------
import { composeSwitchboard, composeOutlet } from '../../lib/switchboards.js';
import { heightOf } from './boardRules.js';

/**
 * ONE PLATE, COMPOSED.
 *
 * AN OUTLET IS COMPOSED BY A DIFFERENT FUNCTION, and the split is in
 * switchboards.js rather than a flag here — see `composeOutlet`. Every path
 * through `composeSwitchboard` puts a switch beside a socket, because that
 * is the rule it exists to hold; the one plate that may break the rule must
 * not be built by the function that enforces it.
 * WHICH BOARD SWITCHES IT is read off the outlet's own flow, so the card can
 * say where its switch went. That is the whole of what a person needs to
 * know about an outlet, and it is the thing that changes when they drag its
 * wire somewhere else.
 *
 * `spareAmps` IS WHAT SURVIVES A CONVERSION. Every board carries one socket
 * of its own and the switch for it — the "spare pair" — and on a plate that
 * was an outlet a moment ago, that socket IS the one that was on the wall,
 * at the rating it was on the wall at. Composing it at the default would
 * silently re-rate somebody's air-conditioner point on the way through a
 * change that was about where the switch lives.
 */
export function composeBoard(b, { country, flowsPx = [], extras = [], order = [],
                                  withFlowId = false } = {}) {
  if (!b) return null;
  if (b.socketOnly) {
    const mine = flowsPx.find((f) => f.outletId === b.id);
    return composeOutlet({
      country, amps: b.amps,
      switchedFrom: mine?.boardLabel ?? null,
      // ...AND THE WIRE IT IS ON, so the socket lights with everything else on
      // that flow. Its switch is on another plate; this is the same point.
      ...(withFlowId ? { flowId: mine?.id ?? null } : {}),
    });
  }
  return composeSwitchboard({
    country, flows: flowsPx, boardId: b.id,
    extras, spareAmps: b.amps ?? null, order,
  });
}

/**
 * EVERY PLATE ON THE JOB, GROUPED BY SPACE AND ORDERED BY SIZE — the sheet.
 *
 * TWO ORDERINGS, EACH ANSWERING A DIFFERENT QUESTION. By space, because a
 * switchboard belongs to a room in a way a light does not: it is on that
 * room's wall, it switches that room's ceiling, and an electrician wires a
 * room at a time. Then by MODULE COUNT ascending within the space — not by
 * name, which would be the obvious thing and is the wrong one, because SB1..n
 * is an ordering by when a plate came into existence and that is an accident
 * of how somebody worked. Size is a fact about the part.
 *
 * COMPOSED HERE AND NOT IN THE SHEET, for the reason BOQView is handed a built
 * schedule: one place works out what is on a plate, and the view is markup.
 * It is the same pair of functions the panel's card uses, so the two cannot
 * come to disagree about what SB7 is.
 *
 * EVERY PLATE INCLUDING THE BAY BOARDS, whatever the layer says. The layer is
 * about what is drawn ON THE PLAN; this is a schedule, and a schedule that
 * omitted half the plates because a switch was off would be a schedule nobody
 * could order from.
 */
export function buildBoardSheet({ rooms = [], boardsFor, bayBoardsFor, placedBoardsFor,
                                  boardNames, country, flowsPx = [],
                                  boardPoints = {}, boardOrders = {} } = {}) {
  const groups = [];
  for (const r of rooms) {
    const plates = [...boardsFor(r), ...bayBoardsFor(r), ...placedBoardsFor(r)]
      .map((b) => {
        const composition = composeBoard(b, {
          country, flowsPx,
          extras: boardPoints[b.id] ?? [],
          order: boardOrders[b.id] ?? [],
        });
        return {
          id: b.id,
          name: boardNames.get(b.id) ?? '—',
          heightMm: heightOf(b),
          modules: composition.total,
          composition,
        };
      })
      // ASCENDING BY SIZE, and by NAME where two plates are the same size —
      // otherwise two equal boards would sit in whatever order the passes
      // happened to emit them, which is an order that can change.
      .sort((a, b) => a.modules - b.modules
        || a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (plates.length) {
      groups.push({ roomId: r.id, name: r.outline.name || 'Space', plates });
    }
  }
  return groups;
}

/**
 * MOVE A PAIR ALONG THE PLATE.
 *
 * REWRITTEN FROM THE CURRENT ARRANGEMENT AND NOT PATCHED INTO THE STORED ONE.
 * The stored order may be empty (nobody has moved anything yet) or stale (it
 * predates a fitting being added), and in both cases the list a person is
 * actually looking at is `units` — so the move is applied to THAT and the
 * result stored whole. A stored order that only ever gets appended to drifts
 * from what is on screen the first time the rules add something.
 *
 * NULL WHEN THE KEY IS NOT IN THE LIST, which is the caller's cue to do
 * nothing at all rather than store an arrangement that says something else.
 */
export function reorderUnits(units = [], key, toIndex) {
  const keys = units.map((u) => u.key);
  const from = keys.indexOf(key);
  if (from < 0) return null;
  const next = keys.filter((k) => k !== key);
  // THE TARGET IS AN INDEX IN THE LIST WITH THE UNIT STILL IN IT, which is
  // what the drawing measured — so dropping to the right of where it started
  // has to lose the slot it vacated, or a unit dragged one place right would
  // land back where it was.
  next.splice(Math.max(0, Math.min(next.length, toIndex > from ? toIndex - 1 : toIndex)),
    0, key);
  return { order: next, from };
}

/**
 * AN ID PER PRESS, AND NOT A KEY MADE OF THE POINT. Two 16A sockets on one
 * plate is an ordinary thing to want, and they have to be removable one at
 * a time — which `socket:16` used as a key cannot express.
 */
export function newBoardPointId() {
  return `bp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** The id a hand-placed plate is minted with. Same shape, same reason. */
export function newManualBoardId() {
  return `sb-hand-${Date.now().toString(36)}-${Math.round(Math.random() * 1e4).toString(36)}`;
}
