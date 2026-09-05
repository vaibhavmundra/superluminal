// ---------------------------------------------------------------------------
// flows.js — the fittings, looped, and every loop back to a board.
//
// A FLOW IS ONE SWITCH. That is the whole idea and it is worth saying plainly,
// because "flow" sounds like a drawing convention and it is not: it is the set
// of fittings that come on together, so the number of flows in a space IS the
// number of modules on its plates, and the dotted arcs are only how a wireman
// reads which fitting belongs to which module.
//
// SO THE UNIT IS A ROW, NOT A ROOM AND NOT A FITTING. A long room with three
// rows of six downlights is three switches, and anybody who has stood in one
// knows why: you light the half of the room you are in. One switch for
// eighteen lamps is a room with one setting, and eighteen switches is a
// switchboard nobody can read. The row is the thing a person actually wants,
// and — this is the part the geometry can answer — the row is already ON the
// drawing. planner.js laid a grid inside each chunk; a row is a line of that
// grid, running the LONGER way across the chunk. Nothing is invented here.
//
// WHICH DIRECTION, AND WHY THE LONGER ONE. Cut a 20x10 room the short way and
// you get six switches of three lamps each, in bands across the room, which is
// not how anyone moves through a space or thinks about it. Along the length you
// get three switches of six, each one a strip of ceiling you can stand under.
// The long axis is also the direction the chunker was already reasoning in, so
// the two agree by construction rather than by coincidence.
//
// EVERYTHING THAT IS NOT A ROW OF DOWNLIGHTS IS ITS OWN FLOW, and the list is
// short because the reason is one reason: a fitting that is switched with the
// downlights is a fitting you cannot use on its own, and every one of these
// exists precisely to be used on its own.
//
//   a magnetic track   one profile, one switch. Two tracks in a room are two
//                      switches, because the second one was put there to be a
//                      different light.
//   a cove             the same, and a reverse cove the same again. Cove light
//                      IS the setting; putting it on the downlight switch
//                      deletes the setting.
//   a fan              its own, obviously — it is not a light at all. Any other
//                      powered ceiling object likewise.
//   the bedsides       one flow for the pair. They are read by, together, from
//                      either side of a bed, and nobody has ever wanted the
//                      left one alone.
//   directional spots  grouped by PROXIMITY rather than by grid, because a row
//                      of picture lights or a pair over a table is a formation
//                      that was placed as one thing and is used as one thing.
//
// THE BEDROOM IS THE ONE PLACE THE GRID IS OVERRULED, and it is overruled by
// the bed. The two bands either side of a bed are one flow even though they are
// two different rows in two different chunks: they are the lights you leave on
// while somebody else is asleep, and they are on both sides because a bed has
// two sides. The row immediately past the foot of the bed is its own flow — the
// one you switch on standing at the door — and everything further into the room
// goes back to being rows. bedGrid.js already worked out which chunks are which
// and this file asks it rather than guessing again.
//
// A FLOW IS OWNED BY A BAY, AND A BAY OWNS A BOARD. See planChunkBoards in
// electrical.js: a piece of ceiling over 25 sqft is switched from its own wall,
// which usually means the board already beside the door. The flow does not
// choose its board — its bay does — so two rows of the same bay cannot end up
// on two different plates.
//
// THE ARCS. AutoCAD draws a loop as a shallow curve from fitting to fitting and
// so does this, for the reason it is drawn that way there: a straight line
// between two downlights is indistinguishable from a setting-out line, a wall,
// a grid line or a dimension, and a bowed dotted one cannot be mistaken for any
// of them. The bow is a fixed fraction of each leg, always to the same side of
// travel, so a row of six reads as one wire and not as six.
//
// PLAN PIXELS throughout, like electrical.js — every list this is handed is
// already in them. `pxPerFt` is here for the two rules that are stated in real
// units: how far apart two spots stop being one formation, and how far a leg
// may bow.
//
// PURE. No React, no canvas, no fetch.
// ---------------------------------------------------------------------------

import { pointInPolygon } from './geometry.js';
import { footGeometry, BED_GRID_DEFAULTS } from './bedGrid.js';
import { servesBay } from './electrical.js';

export const FLOW_DEFAULTS = {
  // ft — two directional spots further apart than this are two formations.
  // A pair over a dining table is a foot apart; the spots on two different
  // pictures at opposite ends of a living room are not one switch.
  spotGroupFt: 6,
  // The bow on one leg of a loop: the peak of the arc, as a fraction of the
  // leg's own length...
  bulge: 0.075,
  // ...and a ceiling on it in feet, so the long leg from a board on the far
  // wall does not sweep across the room on its way in.
  maxBulgeFt: 0.9,
  // The leg from the board is drawn flatter than the legs between fittings. It
  // is the longest one on the drawing and the least interesting — it says
  // "this loop is switched from here" and nothing else.
  boardBulge: 0.035,
};

/**
 * THE CHAIN BETWEEN FITTINGS, AS AGAINST THE LEG OFF THE PLATE.
 *
 * GREY, AND THINNER, AND THE REASON IS WHAT EACH HALF OF A LOOP SAYS. The first
 * leg answers "where is this switched from" — the one question the electrical
 * layer exists for, and the one a reader has to trace across a sheet with six
 * plates on it. Everything after it says "and then it carries on to the next
 * lamp in this row", which the row's own geometry already made obvious.
 *
 * Drawing all of it in the switchboard's blue at one weight spent the emphasis
 * evenly over a figure that is not evenly interesting, and on a bay with three
 * rows of six it made a thicket of blue arcs out of what is really three short
 * blue lines and some joinery. See SB_COLOUR in electrical.js for the other half
 * of the pair.
 */
export const WIRE_CHAIN = '#8A8A8A';

/**
 * ...AND GREEN FOR THE ONE YOU ARE POINTING AT.
 *
 * A THIRD HUE AND NOT A HEAVIER BLUE, because what selection has to survive here
 * is a THICKET. A bay with three rows and a fan is four loops crossing each
 * other over the same ceiling, all of them blue and grey; a selected one drawn
 * in the same colours one and a half times thicker is findable only by
 * comparison, which means tracing every wire on the sheet to be sure which one
 * got thicker. A different colour is findable at a glance, which is the whole
 * job.
 *
 * GREEN BECAUSE NOTHING ELSE ON THIS CANVAS IS. The fittings are amber, the
 * plates and their feeds are blue, the chain is grey and the accent is the
 * cream ramp — so green cannot be mistaken for a kind of thing, only for a
 * state, which is what it is.
 *
 * IT IS THE SAME SELECTION THE PANEL SHOWS. Clicking a module on a switchboard
 * lights its wire green out here; clicking the wire fills that module in. One
 * `selFlowId`, two views of it — see `pickFlow` in App.jsx.
 */
export const WIRE_PICKED = '#22C55E';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const r2 = (v) => Math.round(v * 100) / 100;
const centroid = (pts) => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
});
const inRect = (p, r) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;

/**
 * ONE LOOP, LEG BY LEG — the board, then every fitting in order, bowed.
 *
 * A QUADRATIC PER LEG rather than one long spline through all of them. A spline
 * would be smoother and would also stop being a chain: its curvature at each
 * fitting depends on where the NEXT one is, so adding a lamp to the end of a row
 * moves the line at the other end of it. Leg by leg, each arc is a fact about
 * its own two fittings.
 *
 * The control point sits twice the wanted sag off the midpoint, because a
 * quadratic reaches half way to its control. `bulge` is therefore the peak of
 * the visible arc and not an internal number, which is what makes it tunable by
 * eye.
 *
 * THE LEGS ARE THE RETURN VALUE NOW, AND THE PATH IS DERIVED FROM THEM. This
 * used to hand back one `d` string, and one string is exactly the wrong shape
 * for the two things a wire has to do on this canvas:
 *
 *   THE FIRST LEG IS NOT LIKE THE OTHERS. A loop's first leg is the one that
 *   says "this comes off THAT plate" — it is the fact a reader is hunting for —
 *   and the rest are a chain between lamps that are already obviously in a row.
 *   Drawing all of them in the switchboard's blue at one weight spends the whole
 *   emphasis on the least interesting part of the figure. One string cannot be
 *   two weights.
 *
 *   AND A BEND IS A PROPERTY OF ONE LEG. A wire that crosses something somebody
 *   wants visible is nudged off it — see `bends` — and that nudge has to land on
 *   the leg that crosses, not on the loop.
 *
 * `bends` IS BY LEG KEY AND IS IN FEET. Feet for the reason `runTrims` and
 * `boardMoves` are stored in feet: a nudge in plan pixels means something
 * different the day somebody corrects the scale. The key is the leg's position
 * in the chain, prefixed — see `keyPrefix`, which is how the second feed of a
 * two-way switch gets its own keys without colliding with the loop's.
 *
 * IT IS A DELTA ON THE RULE AND NOT A POSITION. Zero is "however the rule bows
 * it", so a leg nobody touched keeps following its own length as the fittings
 * move, and a leg somebody nudged keeps the nudge on top of that. Storing the
 * absolute offset would freeze a leg's bow at whatever the geometry was on the
 * day it was dragged.
 */
export function loopLegs(nodes, { from = null, pxPerFt = 0, opt = {},
                                  bends = {}, keyPrefix = '' } = {}) {
  const o = { ...FLOW_DEFAULTS, ...opt };
  const pts = from ? [from, ...nodes] : [...nodes];
  const legs = [];
  if (pts.length < 2) return legs;
  const cap = o.maxBulgeFt * (pxPerFt || 0) || Infinity;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    const dx = b.x - a.x, dy = b.y - a.y;
    const L = Math.hypot(dx, dy);
    if (L < 1e-6) continue;
    const frac = from && k === 1 ? o.boardBulge : o.bulge;
    // Always to the left of travel, so every leg of one loop bows the same way.
    const nx = dy / L, ny = -dx / L;
    const key = `${keyPrefix}${legs.length}`;
    const bend = bends[key] ?? 0;
    // THE RULE'S BOW, AND THEN THE HAND'S. The cap is on the rule only: a leg
    // nobody touched must not sweep across the room, and a leg somebody dragged
    // is exactly a request to put it somewhere the rule would not.
    const base = Math.min(frac * L, cap);
    const h = base + bend * (pxPerFt || 0);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const cx = mid.x + nx * h * 2, cy = mid.y + ny * h * 2;
    legs.push({
      key, index: legs.length,
      // WHICH LEG IS THE ONE OFF THE PLATE. It is the first, and only when
      // there is a plate — a loop with no board is all chain.
      feed: !!from && legs.length === 0,
      a, b, mid, normal: { x: nx, y: ny }, base, bend,
      // The point on the curve you can actually grab, which is its own peak:
      // a quadratic reaches half way to its control, so the visible bow is `h`
      // where the control point is `2h` out. Grabbing the control point instead
      // would mean a handle floating twice as far off the wire as the wire is
      // from straight.
      grip: { x: mid.x + nx * h, y: mid.y + ny * h },
      q: `Q ${r2(cx)} ${r2(cy)} ${r2(b.x)} ${r2(b.y)}`,
      d: `M ${r2(a.x)} ${r2(a.y)} Q ${r2(cx)} ${r2(cy)} ${r2(b.x)} ${r2(b.y)}`,
    });
  }
  return legs;
}

/** The legs as one path, which is what a single stroked wire wants. */
export function pathOf(legs = []) {
  if (!legs.length) return '';
  return `M ${r2(legs[0].a.x)} ${r2(legs[0].a.y)} ` + legs.map((l) => l.q).join(' ');
}

/** The whole loop as one `d`. Kept for every reader that wants one stroke. */
export function loopPath(nodes, opts = {}) {
  return pathOf(loopLegs(nodes, opts));
}

/** The chain, oriented so the wire comes in at the end nearest the board. */
function towards(nodes, board) {
  if (!board || nodes.length < 2) return nodes;
  return dist(nodes[0], board) <= dist(nodes[nodes.length - 1], board)
    ? nodes : [...nodes].reverse();
}

/**
 * A NEAREST-NEIGHBOUR WALK, for a set of fittings with no grid to order them.
 *
 * Only the spot groups need this: everything else is a row, a run or a pair, and
 * each of those already has an order that means something. A group of spots does
 * not — it is a cluster — so the wire takes the short way round, starting at the
 * fitting nearest the board. Greedy and not optimal, and a five-fitting travelling
 * salesman is not a problem worth solving on a drawing.
 */
function walk(nodes, board) {
  if (nodes.length < 3) return towards(nodes, board);
  const left = [...nodes];
  const start = board
    ? left.reduce((a, b) => (dist(b, board) < dist(a, board) ? b : a))
    : left[0];
  const out = [start];
  left.splice(left.indexOf(start), 1);
  while (left.length) {
    const last = out[out.length - 1];
    const next = left.reduce((a, b) => (dist(b, last) < dist(a, last) ? b : a));
    out.push(next);
    left.splice(left.indexOf(next), 1);
  }
  return out;
}

/** Single-link clusters: everything within `reach` of anything in the group. */
export function cluster(items, reach) {
  const left = items.map((it, i) => i);
  const out = [];
  while (left.length) {
    const group = [left.shift()];
    for (let k = 0; k < group.length; k++) {
      for (let j = left.length - 1; j >= 0; j--) {
        if (dist(items[group[k]], items[left[j]]) <= reach) {
          group.push(left[j]);
          left.splice(j, 1);
        }
      }
    }
    out.push(group.map((i) => items[i]));
  }
  return out;
}

// --- the pass ----------------------------------------------------------------

/**
 * One space in, its flows out.
 *
 * `bays` are the pieces of ceiling somebody chose a design for, each with the
 * key that `owner` maps to a board — see planChunkBoards. `chunks` and `cells`
 * are the planner's own decomposition, which is where the rows come from; every
 * planner chunk carries `design`, the key of the bay it came out of, so the two
 * levels line up without either being re-derived here.
 */
export function planFlows({
  room = null,
  bays = [],
  chunks = [],
  cells = [],
  lights = [],
  objects = [],
  accents = [],
  spots = [],
  tracks = [],
  boards = [],
  /* THE SOCKET OUTLETS IN THIS SPACE — `[{ id, x, y, amps }]`, in plan pixels.
     Plates with one socket and no switch, dropped on a wall by hand. See
     `placedBoards` in electrical.js for what one is and why it is the only
     switchboard allowed to have no switch on it; section 0 below turns each one
     into a flow, which is what gives it its switch — on somebody else's plate. */
  outlets = [],
  /* EVERY PLATE ON THE SHEET, and not only this room's — the pool a HAND
     ASSIGNMENT is allowed to name. It defaults to `boards`, so a caller that
     does not pass one behaves exactly as before.

     TWO LISTS AND NOT ONE, WHICH IS THE WHOLE POINT. `boards` is what the rules
     may fall back to, and it has to stay this room's own: "the nearest plate"
     resolved against the whole drawing would switch a bedroom's ceiling from a
     board in the hall the moment the hall's plate happened to be nearer the
     party wall. An ASSIGNMENT is the opposite case — somebody dragged this
     wire's end onto that plate and said so — and refusing it because the plate
     is in the next room would refuse the one thing the gesture is for. A
     balcony is already switched from indoors; see `outdoorFeeds` in App. */
  boardPool = null,
  owner = new Map(),
  /* WHERE A WIRE'S BOARD END WAS DRAGGED TO: flow id -> board id.

     AN OVERRIDE ON A DERIVED FITTING, the fourth of that shape in this app —
     see `boardsOff`, `boardMoves` and `runTrims`. The rules still work out every
     flow and still say which plate it would run off; an entry here replaces THAT
     ONE DECISION and nothing else. What the flow is, what is on it and how it is
     drawn are untouched, which is right: moving a wire's end from one board to
     another is a decision about which switch operates these lamps, and it is
     precisely the decision a person is better placed to make than a distance
     test — the rule's fallback is literally "the nearest plate that can carry a
     ceiling", and nearest is not always where the switch belongs.

     IT NAMES A BOARD AND NOT A POSITION, so the wire follows the plate if the
     plate is later slid along its wall. An id that no longer resolves — a board
     somebody deleted — falls back to the rule rather than to nothing. */
  assign = {},
  /* AND WHERE ITS BENDS WERE NUDGED TO: flow id -> { leg key -> feet }.
     See `loopLegs`. Two levels rather than one flat map because a leg key means
     nothing without its flow, and because clearing a wire's bends should be one
     delete. */
  bends = {},
  zones = [],
  pxPerFt = 0,
  opts = {},
} = {}) {
  const o = { ...FLOW_DEFAULTS, ...opts };
  const flows = [];
  const notes = [];
  const polygon = room?.polygonPx ?? [];
  if (!polygon.length) return { flows, notes };

  const live = boards.filter((b) => !b.rejected && b.point);
  const byId = new Map(live.map((b) => [b.id, b]));
  // ...AND EVERY PLATE AN ASSIGNMENT MAY NAME. See `boardPool`.
  const byIdAll = boardPool
    ? new Map(boardPool.filter((b) => !b.rejected && b.point).map((b) => [b.id, b]))
    : byId;
  // THE PLATES UNDER THE SCONCES. Read by two sections — the sconces themselves
  // and the fan's second point — so it is settled once here rather than
  // filtered twice with two chances to disagree about what a bedside board is.
  const bedsideBoards = live.filter((b) => b.role === 'bedside');
  // AND THE PLATES THAT CAN SWITCH A PIECE OF CEILING, which is not all of them.
  // See servesBay in electrical.js: a bedside plate switches its own sconce and
  // a TV plate its own television. A row of downlights falling back to "the
  // nearest board" must not fall back to one of those — and in a bedroom the
  // nearest board to most of the floor IS the one at the pillow, so this is the
  // common case rather than the odd one.
  const general = live.filter(servesBay);
  const cellById = new Map(cells.map((c) => [c.id, c]));

  /* AN ID THAT SAYS WHICH FLOW IT IS, AND IT USED TO BE A COUNTER.
     `fl-<room>-0`, `fl-<room>-1`, in the order the sections below happen to
     run. That was fine for exactly as long as nothing outside one render knew
     these ids — and it stopped being fine the moment a wire could be dragged
     onto another board, for precisely the reason electrical.js gives about its
     own board ids. A stored override against `fl-r1-7` means "whichever flow
     comes eighth next time": add one downlight to a chunk earlier in the room
     and somebody's reassignment silently moves from the wire they dragged onto
     a wire they never touched. Nothing on screen would say so.

     SO THE TAG IS WHAT THE FLOW IS FOR. A track piece names its track and its
     run, a cove names the accent, a fan names the object, a row names its chunk
     and its index within that chunk. Every one of those survives the edits that
     do not remove the thing the flow exists for — which is the same bar
     electrical.js sets and the same one it clears.

     AND THE COLLISION GUARD IS NOT DECORATION. Two spot clusters can, in
     principle, anchor on the same fitting id after a regroup; duplicate ids
     would silently drop one wire's overrides onto the other's. A suffix is a
     worse id than a unique tag and a better one than a collision. */
  const used = new Set();
  const id = (tag) => {
    const base = `fl-${room.id}-${tag}`;
    let k = base;
    for (let n = 2; used.has(k); n++) k = `${base}~${n}`;
    used.add(k);
    return k;
  };

  // WHICH BAY A POINT IS IN, and the nearest one when it is in none. A fitting
  // on a bay boundary, or in the sliver a decomposition left over, still has to
  // be switched from somewhere.
  const bayAt = (p) => bays.find((b) => inRect(p, b.rect))
    ?? (bays.length
      ? bays.reduce((a, b) => (dist(p, cen(b.rect)) < dist(p, cen(a.rect)) ? b : a))
      : null);
  const cen = (r) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });

  /** The plate a flow in this bay runs off, falling back to the nearest one. */
  const boardFor = (bayKey, at) => {
    const own = bayKey != null ? byId.get(owner.get(bayKey)) : null;
    if (own) return own;
    if (!general.length) return null;
    /* `rulePoint` FIRST, WHICH IS WHERE THE RULE PUT THE PLATE. A board can be
       dragged along its space's walls by hand, and that is a decision about
       where the switch is reachable from rather than about what it switches —
       so the plate a bay falls back to must not change because somebody moved
       one nearer. The WIRE still runs to `point`, which is where the plate now
       is; only the choice is made at the rule position. See asDrawn in
       electrical.js. Boards nobody moved carry no `rulePoint` and are unchanged. */
    const pick = (b) => b.rulePoint ?? b.point;
    return general.reduce((a, b) => (dist(pick(b), at) < dist(pick(a), at) ? b : a));
  };

  /**
   * A flow, finished: ordered toward its board, pathed, and counted.
   *
   * EVERY FLOW GOES THROUGH HERE, so there is exactly one place that decides
   * which end the wire comes in at and exactly one place that draws an arc. The
   * alternative — each rule pathing its own — is how two flows on one drawing
   * end up bowing opposite ways.
   */
  const add = ({ kind, tag, label, what, nodes, bayKey, order = 'chain',
                 board: given = null, also = null, extra = {} }) => {
    const pts = nodes.filter((n) => n && Number.isFinite(n.x) && Number.isFinite(n.y));
    if (!pts.length) return null;
    /* THE ID BEFORE THE BOARD, because the board may be an answer keyed on the
       id. That inverts the old order and it is the only structural consequence
       of hand assignment reaching in here. */
    const flowId = id(tag ?? kind);
    /* A HAND ASSIGNMENT BEATS EVERYTHING, including `given`. `given` names the
       plate outright for the one case where the fitting and its board were
       placed as a pair — a bedside sconce and the switch under it — and that is
       a very good rule which a person is nonetheless allowed to overrule: they
       dragged the wire's end onto another plate and there is nothing ambiguous
       about what they meant. An id that resolves to nothing falls through to the
       rules, so deleting a board un-assigns the wires that named it rather than
       leaving them switched from a plate that is not there. */
    const forced = assign[flowId] ? byIdAll.get(assign[flowId]) ?? null : null;
    const board = forced ?? given ?? boardFor(bayKey, centroid(pts));
    const seat = order === 'walk' ? walk(pts, board?.point)
      : order === 'fixed' ? pts
      : towards(pts, board?.point);
    const myBends = bends[flowId] ?? {};
    const legs = loopLegs(seat, { from: board?.point ?? null, pxPerFt, opt: o,
                                  bends: myBends });
    const flow = {
      id: flowId, roomId: room.id, kind, label, what,
      // WHETHER THE PLATE IS THE RULE'S OR A PERSON'S, which the card says and
      // the canvas does not draw. A wire nobody moved must not be marked as
      // moved, for the same reason a board nobody dragged must not be.
      assigned: !!forced,
      bayKey: bayKey ?? null,
      boardId: board?.id ?? null,
      // WHICH PLATE, IN WORDS. The id is what the drawing joins on and is
      // unreadable; this is what a card can print. `servesShort` is the board's
      // own name for itself — "Door", "Bedside", "Bay" — so the two cannot
      // disagree about what the plate beside the door is called.
      boardLabel: board ? (board.servesShort || 'Board') : null,
      from: board?.point ?? null,
      nodes: seat,
      count: seat.length,
      /* THE LEGS, AND THE WHOLE PATH DERIVED FROM THEM — not two calculations
         of one figure. The canvas draws the legs (the feed one weight and
         colour, the chain another) and hovers the path, and if those came from
         two calls the hit target could sit off the wire the day one of them
         changed. */
      legs,
      path: pathOf(legs),
      // NOTHING TO DRAW, AND THAT IS THE TRUTH RATHER THAN A GAP.
      //
      // A bedside sconce and the plate that switches it are ONE POINT on a
      // plan: the switch is at 1200mm and the sconce at 1600mm on the same
      // wall, so the wire between them runs straight up the plaster and has no
      // length in a view from above. `loopPath` skips a zero-length leg, so
      // such a flow comes back as a bare moveto that paints nothing.
      //
      // A WIRE WOULD HAVE TO BE INVENTED TO SHOW IT, and inventing one is the
      // wrong answer twice over: it would be a line that is not there, and it
      // would have to point somewhere arbitrary. What carries the fact instead
      // is the PLATE, whose own card already says what it serves — see
      // `serves` on a bedside board in electrical.js. So the flow is real, it
      // is counted as the switch it is, and it draws nothing; the flag is here
      // so the canvas skips it deliberately rather than rendering an empty
      // group with an unhoverable hit target in it.
      coincident: !!board && seat.length === 1
        && dist(board.point, seat[0]) < 1e-6,
      // A SECOND PLACE THE SAME SWITCH IS REACHED FROM — two-way switching, and
      // NOT a second flow. The distinction is the whole reason this is a field
      // rather than another entry in the list: a second flow would be a second
      // switch, and a schedule reading these would order two fan regulators for
      // one fan. One flow, one switch, two plates you can operate it from.
      also: also && board ? {
        boardId: also.id,
        boardLabel: also.servesShort || 'Board',
        from: also.point,
        ...(() => {
          /* FROM THE NEAREST FITTING ON THE FLOW, not from the whole chain
             again. The loop is already drawn; this leg only has to say "and
             from here too", so it reaches the one fitting closest to the second
             plate and stops.
             ITS OWN KEY SPACE, `a0`, so a bend nudged onto the second feed does
             not land on the first leg of the loop. One flow, two chains of legs,
             and the keys have to say which. */
          const near = seat.reduce((a, b) =>
            (dist(b, also.point) < dist(a, also.point) ? b : a));
          const aLegs = loopLegs([near], { from: also.point, pxPerFt, opt: o,
                                           bends: myBends, keyPrefix: 'a' });
          return { legs: aLegs, path: pathOf(aLegs) };
        })(),
      } : null,
      ...extra,
    };
    flows.push(flow);
    return flow;
  };

  // --- 0. the socket outlets ------------------------------------------------
  //
  // A SOCKET IS A FITTING AND ITS SWITCH IS SOMEWHERE ELSE, which is the whole
  // of this section and the whole of what makes an outlet work. Every socket
  // needs a switch — switchboards.js will not build one without — and the rule
  // has never said the switch has to be on the same plate. On a real job it
  // almost never is: the socket is where you plug something in and the switch is
  // by the door with the others.
  //
  // SO IT IS A FLOW, EXACTLY LIKE A SCONCE'S. One node, at the outlet; one
  // board, picked the ordinary way — the nearest plate that can actually switch
  // something. That single decision is what buys everything else for nothing:
  // the wire is drawn, it can be dragged onto a different plate, its bends can
  // be nudged, and the SWITCH follows, because the switch is a module that
  // exists on whichever board the flow lands on. See `pointsFromFlows` in
  // switchboards.js.
  //
  // FIRST IN THE FILE because an outlet is the one flow that is not about light
  // at all, and burying it among the rows would suggest it is a kind of them.
  //
  // ITS RATING TRAVELS WITH IT. A 16A outlet is not controlled by a 6A switch,
  // so the flow carries `amps` and the board's module is built at that rating.
  for (const so of outlets) {
    if (!Number.isFinite(so?.x) || !Number.isFinite(so?.y)) continue;
    add({
      kind: 'socket', tag: `socket-${so.id}`,
      label: so.amps ? `${so.amps}A socket` : 'Socket',
      what: 'a socket outlet on the wall, switched from another board',
      nodes: [{ id: so.id, x: so.x, y: so.y, what: 'a socket outlet' }],
      bayKey: bayAt(so)?.key ?? null, order: 'fixed',
      extra: { outletId: so.id, amps: so.amps ?? null },
    });
  }

  // --- 1. the tracks --------------------------------------------------------
  //
  // FIRST, BECAUSE A TRACK OWNS ITS FITTINGS. Every fitting the profile absorbed
  // carries `track`, and those are fed BY the rail: they are not separate nodes
  // on a loop, they are modules clipped into one. So a flow has a single node —
  // the feed point, at the end of the profile nearest the board — and the
  // modules are counted rather than drawn.
  //
  // ONE PIECE OF TRACK IS ONE CONNECTION TO THE SWITCHBOARD, EXACTLY, AND A
  // "PIECE" IS NOT A "TRACK". That distinction is the bug this section was
  // rewritten for. `Track · left + right` is one entry in `tracks` carrying TWO
  // runs, and they are two separate parallel rails — so the old loop, one flow
  // per entry, drew one wire to whichever rail happened to be nearer the board
  // and left the other one connected to nothing at all.
  //
  // track.js ALREADY DECIDED THIS AND THE SCHEDULE ALREADY BILLS IT. See the
  // note by `pieces` there: "a closed circuit is ONE track — it is cut and
  // joined on site — where two parallel runs are two tracks with two sets of end
  // caps and TWO FEEDS", and boq.js counts `t.pieces` as exactly that. The
  // drawing was the only thing still claiming one. So the split is `closed` and
  // nothing cleverer: a four-sided circuit is one rail fed once, and every open
  // arrangement is one rail per run.
  //
  // AND A DIRECTIONAL HEAD IS A MODULE LIKE ANY OTHER. This used to collect only
  // the absorbed DOWNLIGHTS, and the directional spots were left to section 5,
  // which duly gave each of them its own loop back to the board. So a track with
  // two task heads on it came out with three connections, two of them arcs drawn
  // from the middle of a rail nobody can tap. They are gathered here instead and
  // counted with the rest, and section 5 skips them.
  const onTrack = new Set();
  const spotOnTrack = new Set();
  for (const t of tracks) {
    const runs = (t.runs ?? []).filter((rn) => rn?.a && rn?.b);
    if (!runs.length) continue;

    /* THE PIECES OF THIS ENTRY, each one rail to be fed once.
       `runIdx` is which of `t.runs` a piece covers, and it is what an absorbed
       fitting's `trackRun` is matched against — both ceilingDesign and the spot
       absorber stamp that index. A closed circuit covers them all. */
    const pieces = t.closed
      ? [{ runs, runIdx: null, side: null }]
      : runs.map((rn) => ({ runs: [rn], runIdx: (t.runs ?? []).indexOf(rn),
                            side: rn.side ?? null }));

    const base = t.short || t.label || 'Track';
    for (const piece of pieces) {
      const ends = piece.runs.flatMap((rn) => [rn.a, rn.b]);
      const bay = bays.find((b) => b.key === t.key) ?? bayAt(centroid(ends));
      const board = boardFor(bay?.key ?? null, centroid(ends));
      const feed = board
        ? ends.reduce((a, b) => (dist(b, board.point) < dist(a, board.point) ? b : a))
        : ends[0];

      /* IS THIS FITTING ON THIS PIECE?
         A closed circuit takes everything stamped for the track. On an open one
         the run index decides — EXCEPT that a fitting carrying no index, or one
         that names a run this entry no longer has, falls to the FIRST piece
         rather than to none. A module belonging to no piece would be dropped
         from `onTrack`, rejoin the ambient rows, and be drawn as a recessed
         downlight sitting on top of a rail. An extra module on the wrong end of
         the right track is a miscount; that is a drawing that contradicts
         itself. */
      const first = piece.runIdx === 0 || piece.runIdx == null;
      const onThis = (f) => {
        if (f.track !== t.key) return false;
        if (piece.runIdx == null) return true;
        const idx = f.trackRun;
        if (!Number.isInteger(idx) || idx < 0 || idx >= runs.length) return first;
        return idx === piece.runIdx;
      };

      const mine = lights.filter((l) => l.track && onThis(l));
      // THE HEADS THIS PIECE TOOK. Filtered on the same two flags section 5
      // uses, so a spot the placer refused is not counted as a module — it is
      // not on the ceiling at all.
      const heads = spots.filter((sp) => sp.track && onThis(sp)
        && !sp.rejected && !sp.skipped);
      for (const l of mine) onTrack.add(l.id);
      // MARKED BY ID, AND ONLY FOR A PIECE THAT GOT A FLOW. A spot excluded from
      // section 5 on the strength of a `track` key that reached no flow would be
      // a fitting with no connection at all — worse than the extra one this
      // fixes.
      for (const sp of heads) spotOnTrack.add(sp.id);

      const modules = mine.length + heads.length;
      add({
        kind: 'track',
        // THE PIECE, AND NOT THE ENTRY. Two parallel rails are two flows off
        // one `tracks` entry — see `pieces` above — so the run index is part of
        // the name or the second rail's overrides would land on the first.
        tag: `track-${t.id}-${piece.runIdx ?? 'all'}`,
        // THE SIDE IS IN THE NAME WHERE THERE IS MORE THAN ONE PIECE. Two cards
        // both reading "Track" on one drawing is two hover cards nobody can tell
        // apart, on precisely the arrangement where telling them apart is the
        // whole point.
        label: pieces.length > 1 && piece.side ? `${base} · ${piece.side}` : base,
        what: `${t.label || 'a magnetic track'}`
          + (pieces.length > 1 && piece.side ? ` — the ${piece.side}-hand rail` : '')
          + (modules
            ? `${pieces.length > 1 && piece.side ? ',' : ' —'} ${modules}`
              + ` module${modules === 1 ? '' : 's'} on the profile`
              + (heads.length ? `, ${heads.length} of them directional` : '')
            : ''),
        nodes: [{ id: piece.runIdx == null ? t.id : `${t.id}-${piece.runIdx}`,
                  x: feed.x, y: feed.y, what: 'the profile\'s feed end' }],
        bayKey: bay?.key ?? null, order: 'fixed',
        extra: { trackId: t.id, trackPiece: piece.runIdx, side: piece.side,
                 absorbed: modules, heads: heads.length,
                 // THE PIECE'S OWN LENGTH, falling back to the entry's where
                 // the runs do not carry one. Two rails are two lengths, and
                 // reporting the pair's total on each of them would double the
                 // metres a card claims for one profile.
                 lengthFt: piece.runs.reduce((n, rn) => n + (rn.lengthFt ?? 0), 0)
                   || (t.lengthFt ?? null) },
      });
    }
  }

  // --- 2. the runs of tape: coves, reverse coves, shelves -------------------
  //
  // ONE FLOW EACH, and the label is the fitting's own. A cove is a closed loop
  // of tape and is fed at a corner; a reverse cove and a shelf are straight runs
  // and are fed at an end. In both cases the flow is one node — the tape is one
  // fitting however many metres of it there are.
  const RUN_KINDS = { cove: 'Cove', 'reverse-cove': 'Reverse cove', shelf: 'Shelf' };
  for (const a of accents) {
    if (a.type !== 'strip') continue;
    const label = RUN_KINDS[a.kind];
    const pts = a.loop ?? a.run ?? null;
    if (!label || !pts?.length) continue;
    const bay = bays.find((b) => a.id.endsWith(`-${b.key}`)) ?? bayAt(centroid(pts));
    const board = boardFor(bay?.key ?? null, centroid(pts));
    const feed = board
      ? pts.reduce((x, y) => (dist(y, board.point) < dist(x, board.point) ? y : x))
      : pts[0];
    add({
      kind: a.kind, label, tag: `${a.kind}-${a.id}`,
      what: `${a.label || label}, fed at ${a.loop ? 'a corner' : 'one end'}`,
      nodes: [{ id: a.id, x: feed.x, y: feed.y, what: a.label || label }],
      bayKey: bay?.key ?? null, order: 'fixed',
      extra: { accentId: a.id },
    });
  }

  // --- 3. the wall lights ---------------------------------------------------
  //
  // A BEDSIDE SCONCE IS SWITCHED FROM THE PLATE UNDER IT, and so it is one flow
  // per sconce rather than one for the pair.
  //
  // THIS USED TO BE ONE FLOW FOR BOTH, on the reasoning that nobody wants the
  // left one alone. That is wrong about the one thing that matters here: rule 2
  // of planSwitchboards puts a board AT EACH SCONCE — on the sconce's own wall,
  // at the sconce's own point, which on a plan is the same point and in the room
  // is directly below it. Two plates exist, one under each sconce, and a pair
  // sharing a switch would mean whoever is on the left reaching across the bed
  // to a plate on the far wall. Each side gets its own, which is the entire
  // reason the boards were placed in pairs.
  //
  // THE JOIN IS AN ID, NOT A DISTANCE. `fromId` on the board is the sconce it
  // was placed for, so the flow names its plate outright and cannot be caught
  // out by a room where the two sconces are closer to each other than to their
  // own boards.
  const sconces = accents.filter((a) => a.type === 'sconce' && !a.rejected);
  const pointOf = (sc) => ({ id: sc.id, x: sc.point?.x ?? sc.x, y: sc.point?.y ?? sc.y,
                             what: sc.what || sc.label || 'a wall light' });

  for (const sc of sconces.filter((a) => a.group === 'bedside')) {
    const p = pointOf(sc);
    if (!Number.isFinite(p.x)) continue;
    add({
      kind: 'bedside', label: 'Bedside', tag: `bedside-${sc.id}`,
      what: `the sconce ${sc.what || 'beside the bed'}, off the plate below it`,
      nodes: [p], order: 'fixed',
      board: bedsideBoards.find((b) => b.fromId === sc.id) ?? null,
      bayKey: bayAt(p)?.key ?? null,
      extra: { accentId: sc.id },
    });
  }

  // EVERY OTHER SCONCE BY THE GROUP IT WAS PLACED IN. See accentPlace: `group`
  // is not a label put on afterwards, it is why those sconces are where they
  // are, and outside the bedsides it is still the set that shares a switch —
  // a run of three down a corridor is one switch, because no board was placed
  // under any one of them.
  const groups = new Map();
  for (const sc of sconces) {
    if (sc.group === 'bedside') continue;
    const k = sc.group || 'wall';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(sc);
  }
  for (const [gk, set] of groups) {
    const pts = set.map(pointOf);
    if (pts.some((p) => !Number.isFinite(p.x))) continue;
    add({
      // THE GROUP IS THE NAME, and `group` is not a label put on afterwards —
      // see accentPlace: it is WHY those sconces are where they are, which is
      // exactly the kind of thing an id should be keyed to.
      kind: 'wall', label: 'Wall lights', tag: `wall-${gk}`,
      what: `${pts.length} wall light${pts.length === 1 ? '' : 's'}`,
      nodes: pts, bayKey: bayAt(centroid(pts))?.key ?? null,
    });
  }

  // --- 4. the ceiling objects ----------------------------------------------
  //
  // A FAN IS NOT A LIGHT AND GETS ITS OWN SWITCH — a regulator, in fact, which
  // is a module of its own on the same plate. So it is connected the moment it
  // is placed, which is what "automatically" means: nothing to choose, no rule
  // to satisfy, one object one flow.
  //
  // A TRAP DOOR IS NOT WIRED, and an AC cassette is not wired FROM HERE: it
  // runs off its own circuit at its own rating and putting it on the lighting
  // board would be drawing something a contractor would have to undo. Both are
  // skipped rather than quietly given a flow.
  //
  // AND A FAN IS REACHED FROM THE BED AS WELL. Its switch — a regulator — is on
  // the room's main board, beside the door, which is the right place for it and
  // is no use at all to somebody already lying down. So the fan gets a SECOND
  // point on a bedside plate: two-way switching, one switch, two places to
  // operate it from. This is not a second flow; see `also` in `add`.
  //
  // THE FARTHER BEDSIDE, AND THE REASON IS REACH. Of the two plates under the
  // sconces, one is nearer the main board and one is farther. A second point on
  // the NEAR one duplicates reach the room already has — you can very nearly
  // touch both plates from the same spot — whereas the far side of the bed is
  // precisely the corner of the room from which nothing is reachable. So the
  // extra point goes where the room is currently worst served.
  const POWERED = { fan: 'Fan', chandelier: 'Chandelier' };
  for (const ob of objects) {
    const label = POWERED[ob.kind];
    if (!label) continue;
    const bayKey = bayAt(ob)?.key ?? null;
    const main = boardFor(bayKey, ob);
    const twoWay = ob.kind === 'fan' && main && bedsideBoards.length
      ? bedsideBoards.reduce((a, b) =>
        (dist(b.point, main.point) > dist(a.point, main.point) ? b : a))
      : null;
    add({
      kind: 'object', label, tag: `object-${ob.id}`,
      what: `${label.toLowerCase()} — switched on its own`
        + (twoWay ? ', and from the far bedside as well' : ''),
      nodes: [{ id: ob.id, x: ob.x, y: ob.y, what: label }],
      bayKey, order: 'fixed',
      also: twoWay,
      extra: { objectId: ob.id },
    });
  }

  // --- 5. the directional spots --------------------------------------------
  //
  // BY PROXIMITY, and it is the one grouping on this drawing that ignores the
  // grid completely. A spot is aimed at something — a picture, a table, a
  // worktop — so what it belongs with is whatever else is aimed at the same
  // area, and that is a distance question. taskSpots.js and artSpots.js already
  // place a row as a formation; this recovers the formation from the geometry
  // rather than depending on either pass to label it.
  // A SPOT ON A TRACK IS NOT ONE OF THESE. It is a module on a busbar, already
  // counted and already fed by the profile's single connection — see section 1.
  // Left in, it got a loop of its own back to the board, which is a second wire
  // into a rail that is fed once.
  const placedSpots = spots.filter((s) => !s.rejected && !s.skipped
    && !spotOnTrack.has(s.id)
    && Number.isFinite(s.x) && Number.isFinite(s.y));
  if (placedSpots.length) {
    const reach = o.spotGroupFt * (pxPerFt || 1);
    for (const group of cluster(placedSpots, reach)) {
      add({
        kind: 'spots',
        /* THE CLUSTER'S LOWEST FITTING ID, which is the most stable name a
           cluster has. A cluster is not a thing anybody placed — it is
           recovered from proximity — so it has no id of its own, and its
           MEMBERSHIP can change when a spot is added nearby. The anchor
           survives everything that does not remove the anchor itself, and the
           collision guard in `id` covers the case where two clusters end up
           claiming one. */
        tag: `spots-${group.map((sp) => sp.id).sort()[0]}`,
        label: group.length === 1 ? 'Spot' : 'Spots',
        what: `${group.length} directional spot${group.length === 1 ? '' : 's'}`
          + (group.length > 1 ? ', within reach of each other' : ''),
        nodes: group.map((s) => ({ id: s.id, x: s.x, y: s.y, what: 'a directional spot' })),
        bayKey: bayAt(centroid(group))?.key ?? null,
        order: 'walk',
      });
    }
  }

  // --- 6. the downlights, chunk by chunk -----------------------------------
  const ambient = lights.filter((l) => !onTrack.has(l.id));
  const byChunk = new Map();
  const chunkOf = (l) => (l.kind === 'small'
    ? l.cell?.chunk ?? cellById.get(l.cells?.[0])?.chunk
    : l.chunk ?? cellById.get(l.cells?.[0])?.chunk);
  for (const l of ambient) {
    const ci = chunkOf(l);
    if (ci == null) { notes.push('A downlight belongs to no chunk, so it is not on a flow.'); continue; }
    if (!byChunk.has(ci)) byChunk.set(ci, []);
    byChunk.get(ci).push(l);
  }

  /** The row index of a light within its chunk, on the axis across the rows. */
  const crossOf = (l, key) => {
    const own = l.kind === 'small' && l.cell ? l.cell[key] : null;
    if (own != null) return own;
    // A LARGE LIGHT SITS ON THE LINE BETWEEN TWO ROWS and belongs to the first
    // of them. Both are true and one has to be picked; picking the lower index
    // is stable under everything, whereas splitting the difference would put
    // the fitting in a row that does not exist.
    const idx = (l.cells ?? []).map((cid) => cellById.get(cid)?.[key])
      .filter((v) => v != null);
    return idx.length ? Math.min(...idx) : null;
  };

  /**
   * A chunk's lights, cut into rows running the LONGER way across it.
   *
   * `along` OVERRIDES THAT, and exactly one caller uses it: the region past the
   * foot of a bed. Its rows are copies of the rows beside the bed — that is the
   * whole of bedGrid.js — so they run parallel to the foot of it whatever shape
   * the region came out. A 14x17 foot region says "my long axis is y" and is
   * not wrong about its proportions; it is wrong about which lines are rows,
   * and the bed is what knows.
   */
  const rowsOf = (ch, mine, along = null) => {
    const long = along ?? ((ch.x1 - ch.x0) >= (ch.y1 - ch.y0) ? 'x' : 'y');
    const cross = long === 'x' ? 'j' : 'i';
    const rows = new Map();
    for (const l of mine) {
      const k = crossOf(l, cross) ?? Math.round((long === 'x' ? l.y : l.x));
      if (!rows.has(k)) rows.set(k, []);
      rows.get(k).push(l);
    }
    return [...rows.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, set]) => set.sort((p, q) => (long === 'x' ? p.x - q.x : p.y - q.y)));
  };

  const nodeOf = (l) => ({ id: l.id, x: l.x, y: l.y,
                           what: l.kind === 'large' ? 'a shared downlight' : 'a downlight' });

  /** Row flows for a set of chunks, labelled 1..n within the bay. */
  const rowFlows = (chunkList, bayKey, { along = null } = {}) => {
    const all = [];
    for (const ch of chunkList) {
      const mine = byChunk.get(ch.id) ?? [];
      if (!mine.length) continue;
      for (const row of rowsOf(ch, mine, along)) all.push({ ch, row, along });
    }
    // THE ROW'S INDEX WITHIN ITS OWN CHUNK, for the tag — NOT `k`, which counts
    // across every chunk in the bay. `k` is right for the LABEL ("Row 3 of 7"
    // is a statement about the bay) and wrong for an id: adding a light to the
    // first chunk renumbers every row after it, and every override with it.
    const perChunk = new Map();
    all.forEach(({ ch, row }, k) => {
      const n = row.length;
      const long = along ?? ((ch.x1 - ch.x0) >= (ch.y1 - ch.y0) ? 'x' : 'y');
      const within = (perChunk.get(ch.id) ?? 0) + 1;
      perChunk.set(ch.id, within);
      add({
        kind: 'row', tag: `row-${ch.id}-${within}`,
        label: all.length > 1 ? `Row ${k + 1}` : 'Downlights',
        what: `${n} downlight${n === 1 ? '' : 's'} in a row across the`
          + ` ${long === 'x' ? 'width' : 'depth'} of this bay`
          + (all.length > 1 ? ` — row ${k + 1} of ${all.length}` : ''),
        nodes: row.map(nodeOf),
        bayKey,
        extra: { chunk: ch.id, row: k + 1, rows: all.length },
      });
    });
    return all.length;
  };

  // THE BED, WHERE THERE IS ONE. Asked of bedGrid.js rather than worked out
  // again: `flanks` are the bands either side of the bed and `foot` is what lies
  // beyond it, and those are the same chunks the second layout pass used, so the
  // flows cannot disagree with the grid they are drawn on.
  const bedOpt = { bedHeadGap: BED_GRID_DEFAULTS.bedHeadGap * (pxPerFt || 1),
                   flankOverlap: BED_GRID_DEFAULTS.flankOverlap };

  // WHICH BAY EACH PLANNER CHUNK BELONGS TO, decided ONCE, for all of them.
  //
  // BY ITS OWN STAMP WHERE IT HAS ONE. `ch.design` is the key of the design
  // chunk the planner chunk came out of — see planCeilingDesign — and that is
  // the authority: a cove's four band rectangles say they belong to the cove
  // chunk, and no amount of geometry would work that out.
  //
  // AND BY CONTAINMENT WHERE IT DOES NOT, which is the case that made this a
  // function rather than a filter. A chunk stamped with a key no bay carries —
  // a design pass that declined half way, a bay list from somewhere else — used
  // to match nothing, and matching nothing meant its lights appeared on NO
  // flow: silently unswitched, on a drawing whose whole purpose is to say what
  // is switched from where. Falling back to the bay the chunk's centre sits in
  // cannot be silently wrong in that way, and on every plan where the stamps do
  // line up it never runs.
  const bayOfChunk = new Map();
  for (const ch of chunks) {
    const stamped = ch.design != null
      ? bays.find((b) => b.key === ch.design) : null;
    bayOfChunk.set(ch.id, (stamped ?? bayAt(cen(ch)))?.key ?? null);
  }

  for (const bay of bays.length ? bays : [{ key: null, rect: null }]) {
    const mineChunks = bay.key == null
      ? chunks
      : chunks.filter((ch) => bayOfChunk.get(ch.id) === bay.key);
    if (!mineChunks.length) continue;

    const geo = zones.some((z) => z.cls === 'bed')
      ? footGeometry({ polygon, zones, chunks: mineChunks, opt: bedOpt })
      : null;

    if (!geo) { rowFlows(mineChunks, bay.key); continue; }

    const flankIds = new Set(geo.flanks.map((c) => c.id));
    const footIds = new Set(geo.foot.map((c) => c.id));

    // BOTH SIDES OF THE BED, ONE FLOW. Ordered up one band and back down the
    // other, so the loop reads as going round the bed rather than crossing it.
    const sides = geo.flanks
      .slice()
      .sort((a, b) => (geo.fit === 'x' ? a.x0 - b.x0 : a.y0 - b.y0));
    const sideNodes = sides.flatMap((ch, k) => {
      const mine = (byChunk.get(ch.id) ?? []).slice()
        .sort((p, q) => (geo.run === 'x' ? p.x - q.x : p.y - q.y));
      return (k % 2 ? mine.reverse() : mine).map(nodeOf);
    });
    if (sideNodes.length) {
      add({
        kind: 'bedsides', label: 'Beside the bed', tag: `bedsides-${bay.key ?? 'all'}`,
        what: `${sideNodes.length} downlight${sideNodes.length === 1 ? '' : 's'} in the bands`
          + ' either side of the bed, on one switch',
        nodes: sideNodes, bayKey: bay.key, order: 'fixed',
      });
    }

    // THE FOOT OF THE BED — the row immediately past it, and only that row.
    // Everything further into the room is ordinary ceiling and goes back to
    // being rows: the brief's "the rest of the lights, depending on the
    // gridding" is exactly what rowFlows does.
    const cut = geo.run === 'x'
      ? (geo.region.x0 > geo.bed.x0 ? geo.region.x0 : geo.region.x1)
      : (geo.region.y0 > geo.bed.y0 ? geo.region.y0 : geo.region.y1);
    const footLights = geo.foot.flatMap((ch) => byChunk.get(ch.id) ?? []);
    if (footLights.length) {
      const along = geo.run === 'x' ? 'x' : 'y';
      const ds = footLights.map((l) => Math.abs(l[along] - cut));
      const near = Math.min(...ds);
      // Within half a cell of the nearest one is the same row. The cell depth
      // is taken off the foot chunk's own grid rather than assumed.
      const ch0 = geo.foot[0];
      const lines = geo.run === 'x' ? (ch0.xLines ?? []) : (ch0.yLines ?? []);
      const pitch = lines.length > 1
        ? Math.min(...lines.slice(1).map((v, i) => Math.abs(v - lines[i])))
        : (pxPerFt || 1) * 4;
      const first = footLights.filter((l, i) => ds[i] - near < pitch / 2);
      const rest = footLights.filter((l, i) => ds[i] - near >= pitch / 2);
      if (first.length) {
        add({
          kind: 'bedfoot', label: 'Foot of the bed', tag: `bedfoot-${bay.key ?? 'all'}`,
          what: `${first.length} downlight${first.length === 1 ? '' : 's'} in the row`
            + ' immediately past the foot of the bed',
          nodes: first
            .sort((p, q) => (geo.fit === 'x' ? p.x - q.x : p.y - q.y))
            .map(nodeOf),
          bayKey: bay.key,
        });
      }
      if (rest.length) {
        // The remainder of the foot region, rowed the ordinary way — but only
        // the lights that are left, so the chunks are filtered rather than
        // re-gridded.
        const keep = new Set(rest.map((l) => l.id));
        for (const ch of geo.foot) {
          byChunk.set(ch.id, (byChunk.get(ch.id) ?? []).filter((l) => keep.has(l.id)));
        }
        rowFlows(geo.foot, bay.key, { along: geo.fit });
      }
    }

    rowFlows(mineChunks.filter((ch) => !flankIds.has(ch.id) && !footIds.has(ch.id)), bay.key);
  }

  if (!live.length && flows.length) {
    notes.push('There is no switchboard in this space yet, so the flows have nothing'
      + ' to run back to.');
  }
  return { flows, notes };
}

/** Fittings on flows, and flows per board — what the panel counts. */
export function flowSummary(flows = []) {
  const boards = new Map();
  let fittings = 0;
  for (const f of flows) {
    fittings += f.count;
    if (!f.boardId) continue;
    boards.set(f.boardId, (boards.get(f.boardId) ?? 0) + 1);
  }
  return { flows: flows.length, fittings, boards };
}

/** Kept for the callers that want to know a point is inside the space at all. */
export const inSpace = (p, polygon) => pointInPolygon(p, polygon);
