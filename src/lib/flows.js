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

import { pointInPolygon, edges, distToSegment } from './geometry.js';
import { footGeometry, BED_GRID_DEFAULTS, bedZoneIn } from './bedGrid.js';
import { servesBay, nearestLampPlate } from './electrical.js';
import { CEILING_BY_ID } from './ceilingObjects.js';

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
  /* HOW FAR FROM THE BED A LIGHT IS STILL A BEDSIDE LIGHT, in feet, measured to
     the MATTRESS BOX and not to its centre — so the figure means the same thing
     on a single as on a king. Three is a nightstand's width and the reach of an
     arm from a pillow, which is what the rule is really about.
     IT IS ONE FIGURE FOR SCONCES AND PENDANTS BOTH, because on this question
     they are the same fitting: a reading light over a nightstand is a reading
     light whether it is bracketed off the plaster or hung off the slab, and the
     switch for either is the one you reach lying down.
     AND IT IS HALF THE TEST. See `atBedside`: a distance alone would catch the
     ceiling pendant hanging near the FOOT of the bed, which is the room's own
     light on the room's own switch. The other half is the headboard wall. */
  bedsideReachFt: 3,
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

/**
 * ...AND MAGENTA FOR THE SECOND FEED OF A TWO-WAY SWITCH.
 *
 * IT IS THE ONE LEG ON THIS DRAWING THAT IS NOT PART OF ITS LOOP. Everything
 * else a flow draws is one circuit read from one plate: the feed arrives, the
 * chain carries on. The second feed leaves a DIFFERENT plate and arrives at the
 * same fittings, which is a fact about the SWITCHING and not about the run — and
 * drawn in the feed's own blue at the feed's own weight, as it was, it read as a
 * second circuit. Two blue ticks on one loop is the sort of thing a reader
 * notices on the third pass, and a wireman not at all.
 *
 * AND IT IS WHAT MAKES THE GESTURE REVERSIBLE. Dropping a fitting's grip on a
 * plate now MEANS something — it two-ways that switch — so the drawing has to
 * answer instantly and unambiguously that it happened. A leg that merely joined
 * the blue ones would leave somebody hunting the plate elevation to find out
 * whether their drag landed. Magenta says it at a glance and says which wire to
 * grab to take it off again.
 *
 * NOTHING ELSE ON THIS CANVAS IS MAGENTA, which is the same argument green
 * makes above: the fittings are amber, the plates and feeds blue, the chain
 * grey, the accent the cream ramp, and green is already spoken for as the
 * SELECTED state. So this cannot be read as a state — only as a kind of wire.
 *
 * THE PICKED COLOUR STILL WINS OVER IT. Selection has to survive the thicket
 * whatever a leg is, and a two-way leg that stayed magenta while its own loop
 * lit green would be the one piece of a selected wire that did not look
 * selected. See the leg painter in PlanCanvas.
 */
export const WIRE_TWO_WAY = '#D946EF';

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

/**
 * THE SECOND PLACE A SWITCH IS REACHED FROM, AS A DRAWABLE LEG.
 *
 * ONE BUILDER AND NOT TWO, which is why it is out here. `add` builds this for a
 * flow the rules just made, and `relink` has to build it again for a flow whose
 * seating changed under it — and the second feed reaches THE NEAREST FITTING ON
 * THE FLOW, so a re-seated chain leaves the old leg pointing at a fitting that
 * is no longer the nearest one. Two copies of that reduce is how the leg comes
 * to end somewhere the wire does not.
 *
 * ITS OWN KEY SPACE, `a`, so a bend nudged onto this leg does not land on the
 * first leg of the loop. See `keyPrefix` in loopLegs.
 *
 * `manual` IS WHOSE DECISION IT WAS and nothing else — the card prints it and
 * the drawing does not, exactly as `assigned` works for the plate at the other
 * end. The leg is the same leg either way: a fan reached from the bed by rule
 * and a light reached from the hall by hand are the same piece of wiring.
 */
function secondFeed(plate, seat, { pxPerFt = 0, opt = {}, bends = {},
                                   manual = false } = {}) {
  if (!plate?.point || !seat?.length) return null;
  const near = seat.reduce((a, b) => (dist(b, plate.point) < dist(a, plate.point) ? b : a));
  const legs = loopLegs([near], { from: plate.point, pxPerFt, opt, bends,
                                  keyPrefix: 'a' });
  return {
    boardId: plate.id,
    boardLabel: plate.servesShort || 'Board',
    from: plate.point,
    manual,
    legs,
    path: pathOf(legs),
  };
}

/** A finished `also` read back as the plate it names, so it can be re-aimed. */
const plateOfAlso = (also) => (also
  ? { id: also.boardId, servesShort: also.boardLabel, point: also.from } : null);

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
  /* THE LAMPS A HAND PUT ON THIS CEILING — `[{ id, x, y }]` in plan pixels.
     Hand-dropped COBs, the ones the autoplace tick filled the grid with, and
     the lamps of a committed array. One list, because on the ceiling they are
     the same fitting: a recessed COB is a recessed COB whether somebody put it
     there or a geometry did.

     THEY WERE NOT HANDED IN AT ALL, AND THAT WAS THE BUG. `lights` is the
     PLANNER's own answer and `AUTO_GRID` blanks it, so on a hand-laid ceiling
     this pass was given every derived fitting on the drawing — the coves, the
     tracks, the fans, the task spots — and not one of the lamps somebody had
     actually placed. They came out with no wire, no module and no plate: a
     ceiling full of fittings that the sheet said nothing about switching. It
     was not a rule declining to connect them; nothing had shown them to it.

     SEPARATE FROM `lights` AND NOT MERGED BY THE CALLER, for the reason
     section 1 gives: a planner light can be ON A TRACK and carries the stamp
     that says which piece of which rail it is a module of. A hand-placed lamp
     never is — the absorber moves one into `trackFixtures` and out of this list
     the moment it clips into a profile — so merging the two upstream would
     invite section 1 to interrogate a stamp that cannot be there. They join in
     section 6, which is where the question is the same for both. */
  lamps = [],
  objects = [],
  accents = [],
  spots = [],
  tracks = [],
  boards = [],
  /* --- THE PLATES ON THIS ROOM'S WALLS THAT SOMEBODY PUT THERE -------------
     A THIRD LIST OF BOARDS, AND IT HAS TO BE THIRD. `boards` is the rules'
     FALLBACK POOL — what a row of downlights may be switched from when its bay
     names no owner — and it is deliberately the door and bay plates only. A
     hand-placed plate has never been in it, and a standing lamp's plate must
     not be: it is a socket at 300mm behind a lamp, and a ceiling falling back
     to it would be a room switched from a point nobody stands at.
     BUT THE LAMP HAS TO BE ABLE TO FIND ITS OWN PLATE, and until this list
     existed it could not: the caller drops every socket-only plate out of
     `boards` and hands those in as `outlets`, and a lamp's plate is NEITHER —
     it is a switchboard, so it fell through both and the lamp had no plate in
     reach, no wire and no modules. That was the whole of the defect.
     SO THEY ARRIVE ON THEIR OWN AND ONLY SECTION 4a READS THEM. Nothing else in
     this file is handed them, which is what keeps `boards` meaning exactly what
     it meant before. */
  handPlates = [],
  /* THE SOCKET OUTLETS IN THIS SPACE — `[{ id, x, y, amps }]`, in plan pixels.
     Plates with one socket and no switch, dropped on a wall by hand. See
     `placedBoards` in electrical.js for what one is and why it is the only
     switchboard allowed to have no switch on it; section 0 below turns each one
     into a flow, which is what gives it its switch — on somebody else's plate. */
  outlets = [],
  /* THE POINTS IN THIS SPACE — `[{ id, x, y, heightMm, amps }]`, in plan pixels,
     RESOLVED. The circle-and-J somebody dropped on a wall or on the ceiling; see
     lib/elecPoints.js, and take `projectElecPointsPx`'s answer rather than the
     store, which holds a fraction for one kind and feet for the other.
     ONE LIST FOR BOTH KINDS, because on this question they are the same fitting:
     a cable ends there and it is switched. Where it ends — plaster or slab — is
     the difference the SYMBOL draws, and it changes nothing about the circuit.
     A FITTING AND NOT A PLATE, which is the whole of section 0b. It is switched
     from the board its BAY runs off — not from the nearest plate, and not from a
     plate of its own — so it arrives here as a thing to be wired, exactly as a
     socket outlet does, and `pointsFromFlows` grows the switch on whichever
     board the flow lands on. Drag the wire's end and the switch moves with it. */
  elecPoints = [],
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
     balcony is already switched from indoors; see `outdoorFeeds` in
     features/electrical/useBoardRules.js. */
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
  /* AND WHAT A HAND HAS RE-PLUGGED: fitting id -> the fitting its input now
     comes from. See `relink` at the foot of this file for the whole model; the
     short version is that a fitting has ONE input, so this is a map and not a
     list, and any number of fittings may name one parent because a fitting has
     as many outputs as you loop off it.
     KEYED ON FITTING IDS AND NOT ON FLOW IDS, which is the one thing about this
     store that had to be decided before anything was built. A flow id is
     DERIVED — `row-<chunk>-<n>`, `track-<id>` — so it is a fact about the
     current grid rather than about the ceiling, and a membership override keyed
     on one would evaporate the moment a chunk changed. A fitting id is a
     document fact and survives everything but deleting the fitting. */
  links = {},
  /* AND THE SECOND PLACE A HAND SAID THIS SWITCH IS REACHED FROM: flow id ->
     board id. Two-way switching, drawn by somebody rather than derived.

     KEYED ON FLOW IDS AND NOT FITTING IDS, WHICH IS THE OPPOSITE OF `links` AND
     IS NOT AN INCONSISTENCY. `links` re-plugs a FITTING's input, so it has to
     survive the grid being redrawn under it and a fitting id is the only thing
     that does. This names a second plate for a SWITCH, and a switch IS a flow —
     there is no fitting-shaped thing to hang it on, and a two-way that survived
     its own flow being dissolved would be a second point for a circuit that no
     longer exists. It is `flowBoards`' twin, stored the same way for the same
     reason: both answer "which plate does this wire report to".

     IT REPLACES THE RULE'S ANSWER AND DOES NOT ADD TO IT, which is what keeps
     one input one input — see `relink`. A flow has at most ONE second point,
     because a two-way switch has two ends and not three; wanting a third is
     intermediate switching, which is a different part and a different drawing.

     AN ID THAT NO LONGER RESOLVES FALLS BACK TO THE RULE, exactly as `assign`
     does — delete the bedside plate and the fan is switched from the door
     alone, rather than from a plate that is not there.

     AND `null` IS A THIRD STATE, NOT AN ABSENCE. Absent means the rules decide;
     a board id names a plate; `null` means this switch has NO second point even
     where a rule would give it one. See the note at its use in `add` for the
     button that could not work without it. */
  twoWay = {},
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
  /** The nearest of a set of plates to a point, and nothing beyond `cap`. */
  const nearestOf = (list, p, cap = Infinity) => {
    let best = null;
    for (const b of list) {
      if (!b?.point) continue;
      const d = dist(b.point, p);
      if (d > cap || (best && d >= best.d)) continue;
      best = { b, d };
    }
    return best?.b ?? null;
  };

  /* IS THIS FITTING AT A BEDSIDE? — which decides whether a light is switched
     from the plate at 700mm or from the room's own board at 1200.
     THE CASE IT EXISTS FOR IS A PLATE DIRECTLY ABOVE ANOTHER. A bedroom's main
     board and one of its bedside boards can land on the same piece of wall —
     the door is often right beside the head of the bed — and then they are one
     point in plan and 500mm apart in elevation. Every rule that picks "the
     nearest plate" picks whichever of the two the list held first, which is a
     coin toss deciding whether a reading light is on the switch by the door or
     the switch by the pillow. It has to be decided by what the fitting IS.
     TWO CONDITIONS, AND NEITHER IS ENOUGH ALONE.
       WITHIN `bedsideReachFt` OF THE MATTRESS, measured to the box.
       AND ON THE HEADBOARD WALL. Distance alone catches the pendant hanging
       near the FOOT of the bed, which is the room's own light; the wall is what
       says "this is at the pillow end".
     THE WALL IS NOT RE-DERIVED HERE, and that is the point of asking it this
     way round. A bedside plate STANDS on the headboard wall, so the wall nearest
     that plate IS the headboard wall — one geometry, one convention, and no wall
     INDEX compared across two modules that number their walls differently
     (accentPlace walks polygon edges; electrical.js merges them into runs).
     NO BED, OR NO BEDSIDE PLATE, AND THE ANSWER IS NO. There is then nothing to
     be beside and nothing to connect to, and the ordinary rules apply. */
  const bedBox = bedZoneIn(zones);
  const wallEdges = edges(polygon);
  const nearestEdge = (p) => {
    let best = -1, bd = Infinity;
    for (let i = 0; i < wallEdges.length; i++) {
      const d = distToSegment(p, wallEdges[i][0], wallEdges[i][1]);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };
  const headEdges = new Set(bedsideBoards.map((b) => nearestEdge(b.point)));
  const bedReach = o.bedsideReachFt * (pxPerFt || 0);
  /** Point to axis-aligned box, and zero for a point inside it. */
  const boxGap = (p, r) => Math.hypot(
    Math.max(r.x0 - p.x, 0, p.x - r.x1),
    Math.max(r.y0 - p.y, 0, p.y - r.y1));
  const atBedside = (p) => !!bedBox && headEdges.size > 0 && bedReach > 0
    && Number.isFinite(p?.x) && Number.isFinite(p?.y)
    && boxGap(p, bedBox) <= bedReach
    && headEdges.has(nearestEdge(p));
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
                 board: given = null, fallback = true, also = null, extra = {} }) => {
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
    /* `fallback` IS WHETHER "THE NEAREST PLATE THAT CAN SWITCH SOMETHING" IS AN
       ANSWER FOR THIS FITTING, and for one of them it is not.
       EVERY CEILING FLOW WANTS IT. A row of downlights whose bay names no owner
       is switched from the nearest board and that is a good rule.
       A STANDING LAMP DOES NOT. Its plate is decided by REACH — three feet, at
       socket height — and falling through to "the nearest plate" would wire a
       lamp to a board across the room the moment its own socket was deleted,
       which is a wire nobody could build from. So it passes `false`, and with no
       plate in reach and no hand assignment it comes out with no board: a lamp
       with nowhere to plug in, said plainly.
       THE HAND ASSIGNMENT IS UNAFFECTED BY ANY OF THIS, and that is the point of
       taking `forced` first. Three feet is the rule for what the app does BY
       ITSELF; drag a lamp's wire onto a plate fifty feet away in another room
       and it goes there, because somebody said so. See `boardPool`, which is
       every plate on the drawing and is what the assignment resolves against. */
    const board = forced ?? given ?? (fallback ? boardFor(bayKey, centroid(pts)) : null);
    const seat = order === 'walk' ? walk(pts, board?.point)
      : order === 'fixed' ? pts
      : towards(pts, board?.point);
    const myBends = bends[flowId] ?? {};
    /* THE SECOND PLATE, RESOLVED AGAINST EVERY BOARD ON THE DRAWING and not
       against this room's. `byIdAll` is `boardPool`, which is what a hand
       assignment resolves against for the reason given there — a bedroom light
       two-wayed from the landing is the ordinary case for this gesture, not the
       exotic one, and refusing it because the plate is through the door would
       refuse the thing people reach for two-way switching to do. */
    /* AND `null` IS THE THIRD STATE, WHICH IS THE ONE THE CUT BUTTON NEEDED.
       An absent key means THE RULES DECIDE — for a bedroom fan that is a second
       point on the far bedside, for everything else it is none. A board id means
       THAT PLATE. `null` means NO SECOND POINT, whatever the rules say.
       IT HAD TO BE A THIRD VALUE AND COULD NOT BE AN ABSENCE, which is the same
       sentence `links` carries three hundred lines down and was learned here the
       hard way: the badge that cuts the second end wrote a DELETE, and a delete
       on a fan removes an entry the fan never had. The rule then proposed the
       bedside again on the very next render, so the button drew perfectly and
       did nothing at all — on the one flow in the app that has a second point by
       rule. Deleting the key is already spoken for as "go back to the rules", so
       "take this two-way off" needed something positive to say. */
    const cutSecond = Object.hasOwn(twoWay, flowId) && twoWay[flowId] == null;
    const handSecond = twoWay[flowId] ? byIdAll.get(twoWay[flowId]) ?? null : null;
    const second = cutSecond ? null : (handSecond ?? also);
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
      /* A HAND'S SECOND PLATE BEATS THE RULE'S, exactly as `forced` beats
         `given` at the other end of the wire, and for the same reason: the rule
         that puts a fan's second point on the far bedside is a good rule and is
         still only a guess about which corner of the room somebody wants to
         reach the switch from. They dragged a fitting's grip onto a plate;
         there is nothing ambiguous about what they meant.
         AND IT REPLACES RATHER THAN ADDING. A flow has at most one second
         point — see `twoWay` in the parameters. Two-waying the fan from the
         hall moves its second point to the hall; it does not give it three.
         NEVER THE PLATE IT ALREADY RUNS OFF. "Also reached from the plate it is
         reached from" is not a circuit, it is a duplicate module on one plate —
         and it is a reachable drop, because the plate a wire runs to is sitting
         right there under the pointer. Refused here rather than in the gesture
         so a stored one from any source is equally harmless. */
      also: board && second && second.id !== board.id
        ? secondFeed(second, seat, { pxPerFt, opt: o, bends: myBends,
                                     manual: !!handSecond })
        : null,
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

  /* --- 0b. the points, wall and ceiling -------------------------------------
     ONE POINT, ONE SWITCH, ON THE PLATE ITS BAY RUNS OFF. That last clause is
     the whole of what makes this different from the outlet above: an outlet
     falls back to "the nearest plate that can switch something", which is right
     for a socket on a wall somebody will plug a vacuum cleaner into. A point is
     a POINT IN A ROOM — a geyser, an exhaust, a chimney, a mirror light — and
     the switch for it belongs with that room's other switches, which is what
     `bayKey` resolves to. See `boardFor`: the bay's owner wins outright and no
     distance is consulted.
     BOTH KINDS, ONE RULE. A ceiling point is wired exactly as a wall point is;
     the surface it ends at is a fact about the symbol and about the height, not
     about the circuit.
     ITS RATING TRAVELS WITH IT, for the reason the outlet's does: a 16A point is
     not controlled by a 6A switch, and `null` means the country's light rating
     rather than a hardcoded six.
     AND ITS HEIGHT DOES NOT, because nothing about the wire depends on it. It is
     carried for the card and the schedule and read by neither of them here. */
  for (const wp of elecPoints) {
    if (!Number.isFinite(wp?.x) || !Number.isFinite(wp?.y)) continue;
    const wall = wp.on != null;
    const name = wall ? 'wall point' : 'ceiling point';
    add({
      kind: 'point', tag: `point-${wp.id}`,
      label: wp.amps ? `${wp.amps}A ${name}` : (wall ? 'Wall point' : 'Ceiling point'),
      what: (wall ? `a point on the wall at ${wp.heightMm ?? 1200} mm` : 'a point on the ceiling')
        + ', switched from the board in this bay',
      nodes: [{ id: wp.id, x: wp.x, y: wp.y, what: `a ${name}` }],
      bayKey: bayAt(wp)?.key ?? null, order: 'fixed',
      extra: { pointId: wp.id, onWall: wall, amps: wp.amps ?? null,
               heightMm: wp.heightMm ?? null },
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
  // THE JOIN IS A DISTANCE NOW, AND IT USED TO BE AN ID. The board carried
  // `fromId` — the sconce it was placed for — which named the plate outright and
  // could not be caught out by a room where the two sconces are closer to each
  // other than to their own boards. That join is gone because the PLATE no
  // longer comes from the sconce: rule 2 in electrical.js places two plates off
  // the bed whether any sconce exists or not, precisely so that deleting a light
  // stops deleting a switch.
  //
  // SO IT IS THE NEARER OF THE TWO, which on this geometry is not a close call:
  // the plates are a foot off either end of the mattress and the sconces are at
  // the same two points, so each sconce is beside its own plate and five or six
  // feet from the other. The failure the id guarded against needs the two
  // pillows nearer each other than a pillow is to its own plate, which is a bed
  // narrower than a foot.
  const sconces = accents.filter((a) => a.type === 'sconce' && !a.rejected);
  const pointOf = (sc) => ({ id: sc.id, x: sc.point?.x ?? sc.x, y: sc.point?.y ?? sc.y,
                             what: sc.what || sc.label || 'a wall light' });

  /* WHICH SCONCES ARE BEDSIDE SCONCES — the rules' own, and any other standing
     at a bedside.
     `group` ALONE WAS NOT ENOUGH, and the gap it left is the ordinary way to get
     one: a sconce placed BY HAND beside the bed carries no group at all, so it
     fell through to the wall-light grouping below and was switched from whatever
     board the bay runs off. On a plan where the door's plate sits directly above
     a bedside plate that is a reading light wired to the switch by the door —
     the right fitting, the wrong switch, and nothing on the drawing to say so.
     SO THE GEOMETRY IS ASKED AS WELL. `atBedside` is where the test lives; a
     rule-placed bedside sconce keeps its group as the authority, because that
     group is WHY it is where it is and no distance should be able to overrule
     it — see accentPlace. */
  const atBed = new Set(sconces
    .filter((sc) => sc.group === 'bedside' || atBedside(pointOf(sc)))
    .map((sc) => sc.id));

  for (const sc of sconces.filter((a) => atBed.has(a.id))) {
    const p = pointOf(sc);
    if (!Number.isFinite(p.x)) continue;
    add({
      kind: 'bedside', label: 'Bedside', tag: `bedside-${sc.id}`,
      what: `the sconce ${sc.what || 'beside the bed'}, off the plate below it`,
      nodes: [p], order: 'fixed',
      board: nearestOf(bedsideBoards, p),
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
    if (atBed.has(sc.id)) continue;
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
  /* WHAT GETS A FLOW IS THE `kind`; WHAT IT IS CALLED ON THE SHEET IS NOT.
     Those were one lookup until a pendant existed, and a pendant is a chandelier
     to every piece of geometry in this app deliberately — one `kind`, two
     catalogue entries, see ceilingObjects.js. Left as one lookup it wired the
     pendant correctly and then labelled its flow "chandelier", which is a
     schedule naming a fitting nobody ordered.
     SO THE GATE STAYS ON THE KIND — that is the question being asked here, which
     is "is this thing on the lighting circuit at all" — and the NAME comes off
     the catalogue entry the object was placed from, falling back to the gate's
     own word for an object stored before `typeId` was carried. */
  const POWERED = { fan: 'Fan', chandelier: 'Chandelier' };
  for (const ob of objects) {
    const powered = POWERED[ob.kind];
    if (!powered) continue;
    const label = CEILING_BY_ID[ob.typeId]?.label ?? powered;
    const bayKey = bayAt(ob)?.key ?? null;
    /* A PENDANT HUNG AT A BEDSIDE IS SWITCHED FROM THAT BEDSIDE, and not from
       the plate by the door with the ceiling.
       IT IS THE SAME FITTING AS A SCONCE AS FAR AS THE ROOM IS CONCERNED. A
       reading light over a nightstand is a reading light whether it is bracketed
       off the wall or hung off the slab, and the switch for it is the one you
       can reach lying down — which is the whole reason rule 2 puts a plate
       there. Left to the ordinary rule it took the bay's owner, so a pendant a
       foot from its own switch was wired to the door.
       GEOMETRY AND NOT A KIND, because `chandelier` is the kind a pendant shares
       with the thing hanging over the middle of the room — see ceilingObjects.js,
       one kind and two catalogue entries — and that one is the room's light and
       belongs on the room's switch. `atBedside` is what separates them, and it is
       the same test the sconces take: within reach of the mattress AND at the
       headboard end. One question, one answer, whatever the fitting is.
       THE NEARER OF THE TWO PLATES, which is the side of the bed it is on.
       Nothing here says a pendant may not be alone: one at each bedside is two
       flows onto two plates, and one on its own takes its own side's. */
    const bedsidePlate = ob.kind === 'chandelier' && atBedside(ob)
      ? nearestOf(bedsideBoards, ob)
      : null;
    const main = boardFor(bayKey, ob);
    const twoWay = ob.kind === 'fan' && main && bedsideBoards.length
      ? bedsideBoards.reduce((a, b) =>
        (dist(b.point, main.point) > dist(a.point, main.point) ? b : a))
      : null;
    add({
      kind: 'object', label, tag: `object-${ob.id}`,
      what: `${label.toLowerCase()} — `
        + (bedsidePlate ? 'switched from the plate at that bedside'
          : 'switched on its own')
        + (twoWay ? ', and from the far bedside as well' : ''),
      nodes: [{ id: ob.id, x: ob.x, y: ob.y, what: label }],
      bayKey, order: 'fixed',
      /* NAMED OUTRIGHT, THE WAY A BEDSIDE SCONCE'S PLATE IS, and `fallback` is
         left alone: a pendant out of reach of both plates falls through to the
         bay's board exactly as every other ceiling fitting does. This replaces
         the automatic answer and not the manual one — drag the wire's end and
         the assignment still beats it. */
      board: bedsidePlate,
      also: twoWay,
      extra: { objectId: ob.id },
    });
  }

  /* --- 4a. the standing lamps ----------------------------------------------
     THE ONE FITTING ON THIS DRAWING THAT IS PLUGGED IN AND NOT WIRED, which is
     why it is its own section rather than a third entry in `POWERED` above. A
     fan and a pendant are fed from the ceiling and their flow runs to whichever
     plate the RULES say switches that piece of ceiling — the nearest one that
     can carry a bay. A standard lamp stands on the floor with a lead on it, so
     the question is not "which plate switches this ceiling" but "which plate can
     this lamp actually reach", and the answer is a distance: see LAMP_SOCKET_FT
     in electrical.js for the figure and why it is the lamp's flex.

     ITS OWN SOCKET FIRST, AND THAT IS THE CASE THAT DRAWS NOTHING. Placing a
     lamp out of reach of every plate seats a socket outlet on the nearest wall
     (see `objectDown` in features/fixtures/useFixtureGestures.js), and that
     outlet is already a flow of its own — section 0 — running back to the
     nearest board and growing the switch there. So the wire is drawn once. A
     second wire from the lamp to a plate a foot behind it would be a mark
     saying nothing, over the top of the one that says everything.

     A PLATE IN REACH GETS THE SOCKET AND ITS SWITCH. That is the other half of
     `lampPlateInReach`: the lamp names the plate outright with `board`, rather than
     falling back through `boardFor` to whatever switches the ceiling, because
     reach is the whole of the decision here. `pointsFromFlows` in
     switchboards.js reads `kind: 'lamp'` and puts a socket and its switch on
     that plate — the pair, because a lamp needs somewhere to plug in and the
     board's SPARE socket is explicitly the one nobody has claimed.

     AND NOTHING AT ALL WHEN NOTHING IS IN REACH, which is a lamp placed before
     this rule existed or one whose outlet was deleted afterwards. No flow, no
     module, no invented socket: the honest picture of a lamp with nowhere to
     plug in. Re-place it, or drop a plate beside it, and it wires itself. */
  /* EVERY PLATE IN THIS ROOM THAT COULD CARRY A SWITCHED SOCKET — the rules'
     own boards and the ones somebody put on a wall, which is where a lamp's own
     plate lives. See `handPlates`. `lampPlateInReach` drops the socket-only ones
     itself, so this list does not have to. */
  const lampPlates = [...live, ...handPlates.filter((b) => b && b.point)];
  for (const ob of objects) {
    if (ob.kind !== 'standing_lamp') continue;
    if (!Number.isFinite(ob.x) || !Number.isFinite(ob.y)) continue;
    const label = CEILING_BY_ID[ob.typeId]?.label ?? 'Standing lamp';
    /* NO REACH CAP ON THE WIRE — see `nearestLampPlate`. Three feet decides
       whether a socket has to go UP, and once one is there it is this lamp's
       socket at whatever distance the wall happened to be. Capping the wire too
       left a lamp in the middle of a room with a plate it could not reach: a
       blank frame and a fitting wired to nothing. */
    const plate = nearestLampPlate(ob, lampPlates)?.board ?? null;
    /* THE FLOW IS MADE WHETHER OR NOT ANYTHING IS IN REACH, and it used to be
       skipped when nothing was. That was wrong for a reason that only shows up
       later: a hand assignment is stored AGAINST A FLOW ID, and the wire is
       what somebody drags onto another plate — so a lamp with no flow has no
       wire to drag, no id to store against, and no way ever to be connected by
       hand. Refusing to draw the automatic answer also refused the manual one.
       WITH NO PLATE AND NO ASSIGNMENT IT COMES OUT WITH NO BOARD, draws nothing,
       and earns no module. That is the honest picture of a lamp with nowhere to
       plug in, and it is a state the app does not produce by itself — placing a
       lamp seats a plate — but reaches by deleting one. */
    /* ONE FLOW PER LAMP, WHICH IS WHAT GIVES EACH ONE ITS OWN SOCKET. Two lamps
       beside each other are two flows onto one plate, and `pointsFromFlows`
       emits a socket and its switch for each — two pairs on one frame, which is
       how it is built. A shared flow would have been one socket for two lamps. */
    add({
      kind: 'lamp', label, tag: `lamp-${ob.id}`,
      what: `${label.toLowerCase()} — plugged into the plate beside it`,
      nodes: [{ id: ob.id, x: ob.x, y: ob.y, what: label }],
      bayKey: bayAt(ob)?.key ?? null, order: 'fixed',
      board: plate,
      /* NO "NEAREST PLATE" FALLBACK — see `fallback` in `add`. Three feet at
         socket height is the whole of the automatic rule; anything further is
         somebody's own decision, and that arrives as an assignment. */
      fallback: false,
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

  /* --- 5a. the spot arrays ------------------------------------------------
     AN ARRAY IS ONE DECISION, SO IT IS ONE SWITCH. A ring of twelve spots or a
     run of four along a line is a geometry, a count and an offset — one thing
     somebody set out, carrying one wattage and one optic between them. The
     schedule has said so since arrays existed (`row.label = 'Spot array'` in
     features/lighting-planner/lightingRules.js, one row whatever the count) and
     this file did not know arrays were a thing at all.

     WHAT THAT COST WAS A STARBURST. An array's lamps went into section 6 as
     ordinary hand-placed COBs: seated in whatever cell they landed in, or — with
     no grid under them — thrown to the proximity fallback in section 7, which
     groups at `spotGroupFt`. Six feet is a sensible reach for picture lights and
     is NARROWER THAN A RUN OF DOWNLIGHTS IS SPACED. So a four-lamp array at the
     ordinary eight-foot pitch came out as four clusters, four flows, four
     modules and four separate wires fanning out of one plate — which is exactly
     what an array is not.

     NO PROXIMITY TEST AT ALL, WHICH IS THE POINT. Sections 5 and 7 cluster
     because they are RECOVERING a formation nobody recorded; an array HAS an
     id, so its membership is a fact rather than a guess and no distance can
     disagree with it. That is also why this runs before section 6 rather than
     being another case inside it: the cell a lamp stands in is irrelevant to a
     lamp that belongs to a named run.

     IN THE ORDER THEY WERE SET OUT, which is the order they arrive in — see
     `arrayLampsPx` in lib/fixtureProjection.js, which walks the offset path.
     That makes the loop trace the run itself rather than a nearest-neighbour
     path recovered from the points, and `chain` then turns the whole thing
     round if the board is nearer the far end.

     A LAMP A TRACK HAS SWALLOWED IS NOT ON IT. Same rule the downlights and the
     directional spots follow: a fitting clipped into a profile is a module on
     that rail and is fed by the rail's single connection. */
  const arrays = new Map();
  for (const c of lamps) {
    if (!c?.arrayId || onTrack.has(c.id)) continue;
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
    if (!arrays.has(c.arrayId)) arrays.set(c.arrayId, []);
    arrays.get(c.arrayId).push(c);
  }
  for (const [aid, set] of arrays) {
    const n = set.length;
    add({
      kind: 'array', tag: `array-${aid}`, label: 'Spot array',
      what: `${n} spot${n === 1 ? '' : 's'} set out on one run, switched together`,
      nodes: set.map((c) => ({ id: c.id, x: c.x, y: c.y, what: 'a spot on the run' })),
      bayKey: bayAt(centroid(set))?.key ?? null,
      extra: { arrayId: aid },
    });
  }

  // --- 6. the downlights, chunk by chunk -----------------------------------
  //
  /* A HAND-PLACED LAMP IS SEATED IN THE CELL IT STANDS IN, and then it IS a
     downlight as far as everything below is concerned.
     THE CELL AND NOT THE PROXIMITY OF THE NEXT LAMP, which is the whole of the
     rule and is worth saying against the obvious alternative. A cluster test
     would have been two lines — the directional spots already have one — and it
     is wrong here for the reason the header gives about the row: the grid is
     ALREADY the formation. A lamp somebody dropped on a ceiling was dropped on
     the grid the app drew for them, so the cell it landed in says which row it
     belongs to, and the row is the switch. Clustering by distance would instead
     chain the whole ceiling into one flow — cells are four or five feet across
     and `spotGroupFt` is six, and single-link clustering is transitive — which
     is "one switch for eighteen lamps" said in code.
     SO AUTOPLACE AND A HAND ARE NOT TOLD APART. An autoplaced lamp carries a
     `gridCell` stamp and a dropped one carries nothing, and this deliberately
     reads neither: two lamps in the same cell are in the same row whichever way
     they got there, and a rule that read the stamp would switch them
     differently for a reason nobody looking at the ceiling could see.
     THE GRID IS STILL THERE TO BE SEATED ON while the fittings are switched
     off — see `gridCellsPx` in layout.js, which is kept aside from the blanking
     for exactly this kind of reader. */
  const seated = [];
  const strays = [];
  for (const c of lamps) {
    if (!Number.isFinite(c?.x) || !Number.isFinite(c?.y)) continue;
    /* AN ARRAY'S LAMPS ARE ALREADY ON A FLOW — see section 5a. They are not
       seated in a cell and they do not fall to the proximity fallback in
       section 7: their run is their formation, and the cell one of them
       happens to stand in would only be a second, contradictory answer to
       which switch it is on. */
    if (c.arrayId && arrays.has(c.arrayId)) continue;
    const cell = cells.find((q) => inRect(c, q));
    // `kind: 'small'` BECAUSE THAT IS WHAT IT IS: one lamp in one cell. The
    // planner's other kind is a large fitting spanning several, which nothing a
    // hand places ever is.
    if (cell) seated.push({ ...c, kind: 'small', cell, cells: [cell.id] });
    else strays.push(c);
  }
  const ambient = [...lights, ...seated].filter((l) => !onTrack.has(l.id));
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

  /* --- 7. the lamps standing on no cell ------------------------------------
     A LAMP OFF THE GRID FALLS BACK TO PROXIMITY, because it has no row to be
     in. Two ways to get here and both are ordinary: a lamp dropped in the strip
     of ceiling a decomposition left over, and every lamp in a space the chunker
     could not cut at all — which has no cells, so all of them come through
     here and the room is grouped by distance from end to end.
     AND NOT SILENTLY NOTHING, which is what section 6 does with a light that
     belongs to no chunk. That note is right about a PLANNER light — one exists
     because a cell existed, so a cell it cannot name is a contradiction worth
     reporting — and it is wrong about a lamp somebody placed by hand, which is
     on the ceiling because they put it there and has to be switched from
     somewhere whatever the grid underneath it says.
     THE SAME REACH THE DIRECTIONAL SPOTS USE. It is the one distance this file
     states about fittings that have no grid to order them, and a second figure
     for the same question would be a second thing to keep in step. */
  if (strays.length) {
    const reach = o.spotGroupFt * (pxPerFt || 1);
    for (const group of cluster(strays, reach)) {
      add({
        kind: 'lamps',
        // The cluster's lowest lamp id, for the reason the spot clusters use
        // theirs: a cluster is recovered from proximity and has no id of its own.
        tag: `lamps-${group.map((l) => l.id).sort()[0]}`,
        label: 'Downlights',
        what: `${group.length} downlight${group.length === 1 ? '' : 's'} standing on`
          + ' no cell of this ceiling\'s grid'
          + (group.length > 1 ? ', within reach of each other' : ''),
        nodes: group.map((l) => ({ id: l.id, x: l.x, y: l.y, what: 'a downlight' })),
        bayKey: bayAt(centroid(group))?.key ?? null,
        order: 'walk',
      });
    }
  }

  if (!live.length && flows.length) {
    notes.push('There is no switchboard in this space yet, so the flows have nothing'
      + ' to run back to.');
  }
  /* AND LAST, WHATEVER A HAND HAS RE-PLUGGED. Every rule above has had its say
     and this reorganises the answer — see `relink`. It is last because it is an
     override and overrides go on top; it is inside planFlows rather than in the
     caller because a re-seated flow has to be re-pathed, and the arc options
     and the bend overrides are in scope exactly here. */
  return { flows: relink(flows, links, { pxPerFt, opt: o, bends, twoWay,
                                        mintId: id, assign, boardById: byIdAll }), notes };
}

/* ---------------------------------------------------------------------------
   MANUAL LINKS — ONE INPUT, MANY OUTPUTS, AND THE RULES KEEP THE REST.

   EVERY FITTING HAS EXACTLY ONE INPUT. That is not a convention this function
   enforces, it is the SHAPE OF THE STORE: `links` is `child id -> parent id`,
   and a map key holds one value, so a second wire into a fitting is not
   something you can write down. Outputs are the other direction and are
   unbounded by the same construction — any number of children may name one
   parent, which is what "loop the next lamp off this one" means on site.

   SO A LINK IS AN INPUT BEING RE-PLUGGED, and that is exactly the gesture: you
   take hold of a fitting's incoming wire and drop it on another fitting instead
   of on a plate. The board-end grip already does the plate half of this; a
   fitting is simply the other kind of thing an input can terminate at.

   THE AUTO RULES ARE NOT CONSULTED AND NOT DISABLED. Every pass above has
   already run and produced its answer, and this reorganises the RESULT — so a
   fitting nobody has linked is switched exactly as it was, and unlinking one
   puts it straight back under the rule that owned it, with no state to unwind.
   That is the same relationship `boardsOff` and `boardMoves` have with the
   plate rules, and it is why unlinking needs no memory of what was overruled.

   A SUBTREE TRAVELS WITH ITS PARENT. Link B to A and then C to B, and moving B
   takes C: the chain is the wire, and a wire does not come apart in the middle
   because somebody re-plugged its far end.

   AND A THIRD STATE, WHICH IS THE ONE `null` BUYS. An absent key means "the
   rules decide"; a fitting id means "fed from that fitting"; and `null` means
   DETACHED — this fitting is switched on its own, straight off the plate,
   whatever row the rules would have put it in. That is an override in the other
   direction from a link: a link overrules WHICH chain a fitting is on, and a
   detach overrules the fact that it is on one at all.
   IT HAD TO BE A THIRD VALUE AND COULD NOT BE AN ABSENCE. Deleting the key is
   already spoken for — it is how a fitting goes BACK to the rules — so "stand
   this one on its own" needed something positive to say. The map carries it.
   WHAT IT FEEDS COMES WITH IT. Detaching a fitting that heads a chain takes the
   whole chain onto the new switch rather than scattering it: those fittings
   named THIS one as their input and nothing about that changed.
   A FLOW IS ONE SWITCH, SO THIS ADDS A MODULE. Splitting one fitting out of a
   row of six leaves a row of five and a switch of its own — two plates' worth
   of module where there was one. That is what "its own connection" means and
   the schedule follows it; it is not a side effect to be suppressed.

   CYCLES ARE DROPPED, NOT REJECTED. A -> B -> A is not a wiring anybody can
   build, and it is reachable in two ordinary drags. The link that closes the
   loop is ignored — quietly, because the alternative is a modal in the middle
   of a drag — and the fitting stays where the rules had it. Nothing is written
   that a later drag cannot correct.

   CROSS-ROOM LINKS ARE IGNORED HERE, because `planFlows` runs per room and a
   parent in another room is not in this call's index at all. The link stays in
   the document; it simply has no effect until both ends are in one room's
   flows. Wiring across a wall is a real thing and this is the seam it would be
   added at, but it is not what the gesture offers today.
   --------------------------------------------------------------------------- */
function relink(flows, links, { pxPerFt, opt, bends, twoWay = {},
                                mintId, assign, boardById }) {
  const keys = links ? Object.keys(links) : [];
  /* NO LINKS, NOTHING TO REORGANISE — AND THE TWO-WAYS ARE ALREADY RIGHT. `add`
     reads the same `twoWay` map when it builds each flow, so a plan with a
     hand-drawn second point and no hand-drawn link never reaches this function
     and does not need to: what is below exists to REPAIR a second feed whose
     flow was re-seated or minted here, not to apply one. */
  if (!flows.length || !keys.length) return flows;

  /* WHERE EVERY FITTING CURRENTLY SITS. Built over the finished flows rather
     than over the fittings, because a fitting the rules never wired has no
     input to re-plug and is not addressable by this gesture. */
  const at = new Map();
  flows.forEach((f, i) => (f.nodes ?? []).forEach((n) => {
    if (n?.id != null && !at.has(n.id)) at.set(n.id, i);
  }));

  /* ONLY LINKS WHOSE BOTH ENDS ARE ON THIS ROOM'S FLOWS, and only those that do
     not close a loop. Resolved by walking UP to a fitting with no input of its
     own — which is the one the whole chain is ultimately switched with. */
  const parent = new Map();
  for (const child of keys) {
    const par = links[child];
    if (par == null || par === child) continue;
    if (!at.has(child) || !at.has(par)) continue;
    parent.set(child, par);
  }
  const rootOf = (idIn) => {
    const seen = new Set([idIn]);
    let cur = idIn;
    while (parent.has(cur)) {
      cur = parent.get(cur);
      if (seen.has(cur)) return null;      // a loop — this chain is unusable
      seen.add(cur);
    }
    return cur;
  };
  for (const child of [...parent.keys()]) {
    if (rootOf(child) == null) parent.delete(child);
  }
  /* THE DETACHED, WHICH ARE THE ENTRIES CARRYING `null`. Sorted so that two
     fittings detached in different orders produce the same drawing — the flows
     are built in this order and a set's iteration order is its insertion order,
     which is the order somebody happened to click in. */
  const loose = keys.filter((k) => links[k] === null && at.has(k)).sort();
  if (!parent.size && !loose.length) return flows;

  const kids = new Map();
  for (const [child, par] of parent) {
    if (!kids.has(par)) kids.set(par, []);
    kids.get(par).push(child);
  }
  /* A STABLE ORDER AMONG SIBLINGS. Two fittings looped off one parent have no
     natural precedence, and `Object.keys` order is the order they happened to
     be dragged in — which would redraw the wire when nothing about the ceiling
     had changed. Sorting by id makes the drawing a function of the document. */
  for (const list of kids.values()) list.sort();

  /* THE NODE OBJECTS THEMSELVES, so a moved fitting arrives complete — its
     position, its `what`, everything the leg builder and the card read. */
  const nodeOf = new Map();
  flows.forEach((f) => (f.nodes ?? []).forEach((n) => {
    if (n?.id != null && !nodeOf.has(n.id)) nodeOf.set(n.id, n);
  }));

  /* THE TWO WAYS A FITTING STOPS BEING WHERE THE RULES PUT IT, and they are not
     the same move. A RE-PLUGGED one leaves entirely — its input now comes from
     some other fitting, so it goes and sits behind that one. A DETACHED one
     stays exactly where it is in the chain and becomes the head of a new
     switch: its input was cut, not its position. */
  const replugged = new Set(parent.keys());
  const looseSet = new Set(loose);

  const subtree = (id) => {
    const out = [];
    for (const child of kids.get(id) ?? []) {
      const n = nodeOf.get(child);
      if (n) out.push(n, ...subtree(child));
    }
    return out;
  };

  /* A DETACHED FITTING'S NEW SWITCH — see the header for what it inherits and
     why the id is minted from the fitting rather than from the flow. */
  const bear = (head, nodes, src) => {
    const nid = mintId ? mintId(`own-${head.id}`) : `own-${head.id}`;
    const forced = assign?.[nid] ? boardById?.get(assign[nid]) ?? null : null;
    const what = String(head.what || '').replace(/^an?\s+/i, '').trim();
    return {
      ...src,
      id: nid,
      label: what ? what.charAt(0).toUpperCase() + what.slice(1) : (src.label ?? 'Fitting'),
      what: nodes.length > 1
        ? `switched on its own, with ${nodes.length - 1} more looped off it`
        : 'switched on its own',
      also: null,
      assigned: !!forced,
      from: forced ? forced.point : src.from,
      boardId: forced ? forced.id : src.boardId,
      boardLabel: forced ? (forced.servesShort || 'Board') : src.boardLabel,
      nodes,
      count: nodes.length,
    };
  };

  const changed = new Set();
  const rebuilt = [];

  for (const f of flows) {
    /* --- THE CHAIN IS CUT AT EVERY DETACHED FITTING ------------------------
       THE RULES' OWN ORDER IS AN INPUT/OUTPUT CHAIN TOO, and treating it as one
       is the whole of this. A row reads board -> A -> B -> C, which says A's
       output feeds B and B's output feeds C exactly as a hand-drawn link does;
       the only difference is that nothing was written down. So cutting the wire
       into B takes B's INPUT away and leaves B's output alone — and C, whose
       input is B, has no reason to move. It goes where B goes.
       THIS USED TO PLUCK ONE FITTING OUT AND CLOSE THE GAP, leaving A wired
       straight to C past a light that was no longer on that switch. Correct as
       wiring and wrong as a model: it treated the rules' chain as an unordered
       bag and the hand-drawn one as a chain, when a wireman reads both the same
       way.
       SO EACH FLOW BECOMES ONE OR MORE SEGMENTS, split at the detach points.
       The first stays with the flow; every later one is a new switch headed by
       the fitting whose input was cut. */
    const segs = [{ head: null, nodes: [] }];
    for (const n of f.nodes ?? []) {
      /* RE-PLUGGED FITTINGS ARE NOT PART OF ANY SEGMENT. They are somewhere
         else entirely by now, and a fitting that named another as its input has
         said where it belongs far more explicitly than its position in a row
         says anything. That is also what stops a cut from dragging along a
         fitting somebody had already wired into a different chain. */
      if (replugged.has(n.id)) continue;
      if (looseSet.has(n.id)) segs.push({ head: n, nodes: [] });
      const seg = segs[segs.length - 1];
      seg.nodes.push(n, ...subtree(n.id));
    }

    const head = segs[0];
    if (head.nodes.length) {
      const same = head.nodes.length === (f.nodes ?? []).length
        && head.nodes.every((n, i) => n === f.nodes[i]);
      if (same) rebuilt.push(f);
      else {
        const next = { ...f, nodes: head.nodes, count: head.nodes.length };
        changed.add(next);
        rebuilt.push(next);
      }
    }
    /* A FLOW WHOSE EVERY FITTING ENDED UP ON A LATER SEGMENT IS NOT AN EMPTY
       FLOW, IT IS NO FLOW — dropped by the `if` above rather than filtered
       afterwards. Keeping it would put a module on a plate for a switch that
       controls nothing, and `flowSummary` counts flows, so the schedule would
       bill for it. */
    for (const seg of segs.slice(1)) {
      const b = bear(seg.head, seg.nodes, f);
      changed.add(b);
      rebuilt.push(b);
    }
  }

  /* THE ARCS LAST, over the final seating. Recomputed only for the flows that
     actually changed, and from the same `from` point and bend overrides `add`
     used — two calls to loopLegs with different arguments is how a hit target
     comes to sit off the wire it is meant to be on. */
  return rebuilt.map((f) => {
    if (!changed.has(f)) return f;
    const myBends = bends?.[f.id] ?? {};
    const legs = loopLegs(f.nodes, { from: f.from ?? null, pxPerFt, opt,
                                     bends: myBends });
    /* AND THE SECOND FEED IS RE-AIMED WITH THEM, which is the half that is easy
       to miss. That leg reaches THE NEAREST FITTING ON THE FLOW — so a chain
       that gained a lamp, lost one, or was cut in two leaves it pointing at a
       fitting that is no longer the nearest, or no longer on this flow at all.
       Left alone it drew a wire from a bedside plate to a light now switched
       from somewhere else entirely.
       A MINTED FLOW LOOKS ITS OWN UP. `bear` hands back `also: null` because a
       detached fitting inherits nothing about switching from the flow it left —
       but its NEW id is a thing `twoWay` can name, and once somebody two-ways
       a fitting they stood on its own, this is where that is honoured.
       AND THE RULE'S OWN SECOND FEED IS REBUILT FROM WHAT IT SAYS, so a fan
       whose flow was re-seated keeps the bedside point the rule gave it rather
       than having it quietly promoted to a hand decision. */
    const cutSecond = !!twoWay && Object.hasOwn(twoWay, f.id) && twoWay[f.id] == null;
    const hand = twoWay?.[f.id] ? boardById?.get(twoWay[f.id]) ?? null : null;
    const plate = cutSecond ? null : (hand ?? plateOfAlso(f.also));
    const also = plate && plate.id !== f.boardId
      ? secondFeed(plate, f.nodes, { pxPerFt, opt, bends: myBends,
                                     manual: hand ? true : !!f.also?.manual })
      : null;
    return { ...f, legs, path: pathOf(legs), also };
  });
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

// --- a wire, for a reader that cannot stroke a path -------------------------
//
// THE CANVAS STROKES `d` AND THE TWO EXPORTERS CANNOT. An SVG path is the
// natural shape for a wire on screen and it is the wrong shape everywhere else:
// a DXF R12 has no curve worth writing a bowed leg as, and a plotted sheet is
// built out of page-space segments for the reason pdfPlot gives about
// `drawSvgPath`. So both files want the same wire as POINTS.
//
// FLATTENED HERE AND NOT IN EACH EXPORTER, which is the same argument this file
// already makes about the bow itself: two copies of one curve are two curves the
// day somebody tunes `bulge`, and a PDF and a DXF of one plan that disagreed
// about where a wire runs would be worse than either being wrong.

/**
 * THE LEG'S OWN `d`, EVALUATED — the dialect `loopLegs` writes and nothing else.
 *
 * `M x y`, then a `Q` per leg. That is the whole grammar `pathOf` emits, so this
 * parses what this file produces rather than SVG in general: an `A`, a `C` or a
 * relative command would be a curve nothing here can draw, and inventing a
 * reader for them would be inventing a caller.
 *
 * READ OFF THE STRING RATHER THAN OFF `a`/`grip`/`normal`, and that is the
 * point. A flow from a caller that predates `legs` — or one built by hand in a
 * test — still carries a `path`, and the canvas already falls back to stroking
 * it; a flattener that needed the fields would be a wire that vanished from the
 * file because a field was added. One code path, both cases.
 */
export function pathPoints(d, steps = 12) {
  if (typeof d !== 'string') return [];
  const tok = d.trim().split(/[\s,]+/).filter(Boolean);
  const num = () => Number(tok[i++]);
  const pts = [];
  let cur = null, i = 0;
  while (i < tok.length) {
    const op = tok[i++];
    if (op === 'M' || op === 'L') {
      cur = { x: num(), y: num() };
      pts.push(cur);
    } else if (op === 'Q') {
      const c = { x: num(), y: num() };
      const b = { x: num(), y: num() };
      if (!cur) { cur = b; pts.push(b); continue; }
      for (let k = 1; k <= steps; k++) {
        const t = k / steps, u = 1 - t;
        pts.push({ x: u * u * cur.x + 2 * u * t * c.x + t * t * b.x,
                   y: u * u * cur.y + 2 * u * t * c.y + t * t * b.y });
      }
      cur = b;
    }
  }
  return pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

/**
 * ONE FLOW, AS RUNS OF POINTS, EACH SAYING WHICH KIND OF WIRE IT IS.
 *
 * THE THREE KINDS ARE THE THREE COLOURS, and they are the canvas's own split:
 * `feed` is the leg off the plate, `chain` is fitting to fitting, `two` is the
 * second feed of a two-way. See SB_COLOUR, WIRE_CHAIN and WIRE_TWO_WAY for what
 * each one means and why it is drawn differently.
 *
 * THE PAINTER DECIDES ONCE PER RUN, which is the shape the canvas's own `leg`
 * already has: a run that had to be looked up in two lists to find out what
 * colour it is would be a run that gets it wrong the day a fourth kind arrives.
 */
export function flowWires(flow, { steps = 12 } = {}) {
  if (!flow) return [];
  const out = [];
  const take = (legs, path, two) => {
    const list = legs?.length ? legs : (path ? [{ d: path, feed: true }] : []);
    for (const l of list) {
      const pts = pathPoints(l.d, steps);
      if (pts.length >= 2) {
        out.push({ kind: two ? 'two' : l.feed ? 'feed' : 'chain', pts });
      }
    }
  };
  take(flow.legs, flow.path, false);
  if (flow.also) take(flow.also.legs, flow.also.path, true);
  return out;
}

/**
 * HOW LONG THE FEED TICK IS, in feet — about 75mm either side of the wire.
 *
 * IN FEET BECAUSE A SHEET AND A CAD FILE HAVE NO HAIRLINE BETWEEN THEM. The
 * canvas sizes the tick off `lw`, which is a screen pixel: it is an annotation
 * there and stays the same size as you zoom. On paper and in a drawing it is a
 * mark at a scale, so it is a real length like every other figure the exporters
 * share. @see feedTicks
 */
export const WIRE_TICK_FT = 0.25;

/**
 * THE SHORT TICK ACROSS THE WIRE WHERE IT LEAVES A PLATE.
 *
 * NOT AN ARROW — a wire has no direction and an arrowhead would claim one. It is
 * there because a loop's first leg is its longest and a reader has to be able to
 * find which of several plates it came off. The canvas draws exactly this, from
 * exactly these two points; @see the looping block in PlanCanvas.
 *
 * TWO OF THEM ON A TWO-WAY, and the second one is `two` so it takes that leg's
 * own colour. Painting it the feed's blue while the leg under it is magenta
 * would split one statement into two colours at the exact point somebody looks
 * to read it.
 */
export function feedTicks(flow, { lenPx = 0 } = {}) {
  if (!flow || !(lenPx > 0)) return [];
  const nodes = flow.nodes ?? [];
  if (!nodes.length) return [];
  const pairs = [];
  if (flow.from) pairs.push([flow.from, nodes[0], 'feed']);
  if (flow.also?.from) {
    const at = flow.also.from;
    pairs.push([at, nodes.reduce((a, b) => (dist(b, at) < dist(a, at) ? b : a)), 'two']);
  }
  const out = [];
  for (const [a, b, kind] of pairs) {
    if (!a || !b) continue;
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
    const q = { x: a.x + ux * lenPx * 1.6, y: a.y + uy * lenPx * 1.6 };
    out.push({ kind,
      a: { x: q.x - uy * lenPx, y: q.y + ux * lenPx },
      b: { x: q.x + uy * lenPx, y: q.y - ux * lenPx } });
  }
  return out;
}
