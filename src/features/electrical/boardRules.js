// ---------------------------------------------------------------------------
// boardRules.js — WHERE THE PLATES ARE, AND WHAT EACH ONE IS.
//
// PURE. No React, no DOM, no document. Every function here takes the geometry,
// the classification and the hand decisions it needs and returns a value; the
// memo adapters in useBoardRules.js hold the dependency arrays. The algorithms
// themselves are lib/electrical.js's and are called unchanged — this file is
// the arrangement App used to hold inline, moved out so it can be tested
// without a renderer.
// ---------------------------------------------------------------------------
import { planSwitchboards, planChunkBoards, asDrawn, asOutlet, heightsFor,
         innerSpaceFor, nearestBoardTo, nearestSeat, placedBoards,
         lampPlateInReach, lampPlateToShare,
         LAMP_BOARD_ROLE, APPLIANCE_ROLES, plateHeightMm,
         boardSFt } from '../../lib/electrical.js';
import { bedZoneIn } from '../../lib/bedGrid.js';
import { lightSwitchA, applianceA } from '../../lib/switchboards.js';
import { isOutdoor, expectsBasin } from '../../lib/roomTypes.js';
import { bbox, pointInPolygon } from '../../lib/geometry.js';

/**
 * THE BOARDS THAT COST NOTHING, WITHOUT ASKING FOR THEM.
 *
 * TWO OF THE THREE RULES ARE FREE AND WERE BEING CHARGED FOR, and that was
 * the mistake this fixes. `planSwitchboards` has three, and they need three
 * different things:
 *
 *   the door      the door boxes, detected on arrival to set the scale, and
 *                 the room's own outline. Nothing else.
 *   the bedsides  the BED BOX, from the upload-time furniture detection. It
 *                 used to be the sconces the ACCENT pass placed, which made a
 *                 switch depend on a light somebody might delete — see rule 2
 *                 in electrical.js.
 *   the TV        a `tv_unit` strip if the accent pass found one, and a fresh
 *                 vision call if it did not. THIS is the expensive one.
 *
 * So only the third needs asking for, and the whole thing sat behind the bolt
 * on the room row for its sake. Now the first two run here, for every space,
 * on every layout: the door plate 300mm past the LATCH jamb on the side the
 * door opens to — which `swingSides` settles by cutting the room on the line
 * through the door and measuring the floor either side of it — and one plate at
 * each bedside, a foot clear of the mattress on the headboard wall.
 *
 * "AT" THE SCONCE IS "BELOW" IT, and the two words describe one place. A plan
 * is a view from above: a switch at 1200mm and the sconce at 1600mm on the
 * same wall are the same point on this drawing, and stacked in the room. So
 * the board is placed at the sconce's own point and needs no offset — an
 * offset would move it ALONG the wall, which is not below anything.
 *
 * A bay plate at the middle of the longest wall is not a cheaper version of
 * any of this. It is a different and worse answer, and having it stand in
 * silently while the real rules went unasked was the bug.
 *
 * IT WAS `derivedBoardsPx` AND IT USED TO BE THE POOR RELATION. There was an
 * on-demand pass beside it — a bolt per space, a vision call, its answer
 * stored — and this ran only for the rooms that pass had not been asked
 * about. The bolt is gone: what it bought over these rules was the television,
 * and the television is no longer looked for. So this is the pass, all three
 * rules, on every space, always.
 *
 * ALL THREE RULES ASKED FOR BY NAME. Every one of them reads something the app
 * has before there is a layout — the door boxes from the upload and the bed box
 * from the furniture detection — so there is nothing here that costs a call and
 * no reason to run a subset.
 */
export function planBoardResults({ rooms = [], doors = [], roomTypes = {}, projectId = null,
                                   wardrobesPx = [], basinsPx = [], boardMoves = {},
                                   pxPerFt = 0, warn = null } = {}) {
  const out = {};
  if (!(pxPerFt > 0) || !rooms.length) return out;
  const all = rooms.map((q) => ({
    id: q.id, name: q.outline.name || null, polygonPx: q.plan.polygonPx,
  }));
  for (const r of rooms) {
    if (!r.plan?.ok) continue;
    /* --- A BALCONY GETS NO BOARD OF ITS OWN ---------------------------
       The rules below all place a plate ON the space they are given: beside
       its door, at its bedside, on the wall facing its bed. Run on a balcony
       they would put a switch outside — on an external wall, in the weather,
       reachable only by somebody who has already walked out there in the
       dark. The light is switched from indoors instead, off a plate in the
       room the balcony opens off; `planOutdoorFeeds` below works out which
       plate, and the flows carry the balcony's fittings to it.
       AN EMPTY RESULT AND NOT A SKIPPED KEY. Everything downstream reads
       `boardResults[id]` and a missing entry is "the pass has not run", which
       is a different statement from "this space has no boards" — the second
       is a decision, and it comes with a sentence saying so. */
    if (isOutdoor(projectId, roomTypes[r.id]?.type)) {
      out[r.id] = { boards: [], notes: [
        'This space is outside, so its light is switched from the room it'
        + ' opens off rather than from a plate on its own wall.'] };
      continue;
    }
    try {
      out[r.id] = planSwitchboards({
        room: { id: r.id, polygonPx: r.plan.polygonPx },
        rooms: all, doors, roomTypes, pxPerFt,
        /* THE BASIN, AS ONE BOX, exactly the way `bedRect` arrives — see
           `projectBasinsPx`. It is what the accent pass SAW and not what it
           proposed, so the shaver plate survives somebody deleting the sconces
           at the mirror. The largest where a room somehow has two: the same
           choice `bedZoneIn` makes for beds. */
        basinRect: basinsPx
          .filter((z) => z.roomId === r.id)
          .map((z) => z.rect)
          .reduce((a, b) => (!a || (b.x1 - b.x0) * (b.y1 - b.y0)
            > (a.x1 - a.x0) * (a.y1 - a.y0) ? b : a), null),
        /* THE BED, OUT OF THIS ROOM'S OWN ZONE LIST. `plan.zonesPx` is what
           the planner was handed — every no-light zone standing in this space,
           the detected beds among them — so the bed is already attributed to
           the right room and there is no second containment test to get
           wrong. `bedZoneIn` takes the largest where a room has more than one,
           which is the same choice bedGrid.js makes for the flanking lights. */
        bedRect: bedZoneIn(r.plan.zonesPx ?? []),
        /* AND THE WARDROBES, WHICH NO PLATE MAY STAND ON. Raw rectangles: the
           six inches of clear plaster either side is the rules' number, not
           this file's, so it is applied in electrical.js where every caller
           gets the same one. See `keepOutsFor`.
           FROM `wardrobesPx` AND NOT FROM `r.plan.zonesPx`, even though the
           same rectangles are in there as no-light zones now. That list is
           what the CEILING keeps off — beds, hand-drawn boxes, reverse coves,
           wardrobes — and a switch has no reason to avoid a bed or a cove. A
           plate must keep off JOINERY, which is a different fact that happens
           to share some of its geometry, and the honest way to say it is to
           hand in the joinery. */
        keepOff: wardrobesPx.filter((w) => w.roomId === r.id).map((w) => w.rect),
        // WHERE SOMEBODY DRAGGED ONE OF THIS SPACE'S PLATES TO. Handed whole
        // rather than filtered by room: the keys are board ids and a board id
        // names its room, so a filter here would be a second place that has to
        // agree about that spelling.
        moves: boardMoves,
        /* BEDROOMS IN HOMES GET ALL THREE; EVERYTHING ELSE GETS THE DOOR.
           This gate used to decide whether a row in the panel had a BOLT on
           it, on the reasoning that two of the three rules are bedroom rules
           and a control that runs a pass with nothing to say is worse than no
           control. The bolt is gone and the reasoning is not: asked for on a
           kitchen, `bedside` and `facing` answer by reporting that there are
           no bedside sconces and no bed — both true, neither news, and printed
           under every space on the sheet. A rule that was never run has
           nothing to say, which is what `rules` is for. */
        /* AND A BATHROOM IN A HOME GETS THE DOOR AND THE BASIN. WHICH ROOM has
           a basin is asked of the vocabulary — see the `basin` flag on WET in
           lib/roomTypes.js — rather than written here as a `=== 'toilet'`, so
           the rule and the room list cannot drift apart. WHICH PROJECT is
           checked here, beside the bedroom rules and for the same reason: an
           office WC and a hotel bathroom both have a basin, and only one of the
           three is a place somebody keeps a trimmer. A hotel bathroom has the
           same socket and is deliberately not asked yet; that is one word here
           when it is wanted. */
        rules: projectId !== 'residential' ? ['door']
          : roomTypes[r.id]?.type === 'bedroom' ? ['door', 'bedside', 'facing']
            : expectsBasin(projectId, roomTypes[r.id]?.type) ? ['door', 'basin']
              : ['door'],
      });
    } catch (err) {
      warn?.(r.id, err);
    }
  }
  return out;
}

/**
 * THE BAYS OF ONE SPACE — the pieces of ceiling a board and a flow belong to.
 *
 * `designChunksPx` where there is one, because that is the piece somebody
 * chose a ceiling for, and the room's own bounding box where there is not.
 * The fallback is not a degenerate case: a space whose outline gives the
 * chunker nothing to work with is laid out as one grid over the whole floor,
 * and it is then genuinely one bay with one board and its rows.
 */
export function baysOfRoom(r) {
  if (!r.plan?.ok) return [];
  /* `bayChunksPx` AND NOT `designChunksPx`, WHICH IS THE FIX. The two hold the
     same cut and differ in one thing: the pill's list is emptied while the
     suggested grid is off — correctly, a pill there would offer to re-cut a
     piece of ceiling with nothing on it to move — and this one is not. How a
     ceiling is CUT is not a fact about whether the engine placed anything on
     it, and it is the whole of what a bay is.
     READING THE PILL'S LIST MEANT NO SECOND BOARD. With the grid off this fell
     to the line below, the whole space came out as one bay, that bay adopted the
     plate beside the door, and a living-dining room cut into two — the case this
     pass exists for — got one switchboard. See `bayChunksPx` in lib/layout.js.
     THE OLD LIST IS STILL CONSULTED as a fallback, for a room laid out by a
     caller that carries only it: every test in tools/ builds its rooms by hand,
     and a bay list that went empty for them would be a silent behaviour change
     in the pass under test. */
  const cut = r.bayChunksPx?.length ? r.bayChunksPx : r.designChunksPx;
  if (cut?.length) {
    return cut.map((c) => ({ key: c.key, rect: c.rect }));
  }
  const b = bbox(r.plan.polygonPx);
  return [{ key: 'room', rect: { x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY } }];
}

/**
 * THE BAY BOARDS — one per piece of ceiling that has none of its own.
 *
 * THE BAY IS THE DESIGN CHUNK, not the planner's. A cove design chunk comes
 * out of the planner as five rectangles — the inner and four bands — and five
 * plates on one wall is not a switchboard. It is one piece of ceiling somebody
 * chose a ceiling for, so it is one plate; the planner's chunks inside it are
 * what the ROWS come from. `designChunksPx` is empty whenever the design pass
 * declined and the plain layout ran, and then the space is one bay.
 *
 * IT IS HANDED THE DOOR BOARD, so the common case makes nothing at all: one
 * bay with a door in it adopts the plate beside that door. A new plate appears
 * only where a bay over 25 sqft genuinely has no board on any of its own
 * walls — the far half of a living-dining room, and not much else.
 */
export function planBayResults({ rooms = [], pxPerFt = 0, baysOf, ruleBoardsFor,
                                 wardrobesPx = [], boardMoves = {}, projectId = null,
                                 roomTypes = {} } = {}) {
  const out = {};
  if (!(pxPerFt > 0)) return out;
  for (const r of rooms) {
    if (!r.plan?.ok) continue;
    // AND NO BAY PLATES OUTSIDE, for the reason the rules pass skips it: a bay
    // plate is a switchboard on the drawing like any other, and this space's
    // switches are indoors. See `planOutdoorFeeds`.
    if (isOutdoor(projectId, roomTypes[r.id]?.type)) continue;
    const bays = baysOf(r);
    if (!bays.length) continue;
    out[r.id] = planChunkBoards({
      room: { id: r.id, polygonPx: r.plan.polygonPx },
      bays,
      // The same joinery the rules pass keeps off, for the same reason: a bay
      // plate is a switchboard on the drawing like any other.
      keepOff: wardrobesPx.filter((w) => w.roomId === r.id).map((w) => w.rect),
      // `ruleBoardsFor` AND NOT `boardsFor`, WHICH IS THE WHOLE OF "the
      // routing stays as it is". This pass decides which bay is switched from
      // which plate, and it decides it by which plate stands on the bay's own
      // walls — so a plate dragged across the room would take the switch off
      // the ceiling it was switching and this pass would grow a replacement.
      // Ownership is settled where the RULES put the boards; the drag moves
      // the mark and the wire, and nothing else. See the note on that function.
      boards: ruleBoardsFor(r),
      // ...and this pass's OWN plates answer to the same drag. See `moves`
      // there: it applies them to what it makes, after ownership is settled.
      moves: boardMoves,
      pxPerFt,
    });
  }
  return out;
}

/**
 * WHICH PLATE SWITCHES EACH OUTDOOR SPACE: balconyId -> the board, and the
 * room it stands in.
 *
 * THE RULE IN THREE STEPS, AND THE THIRD IS THE ONE THAT KEEPS IT HONEST.
 * `innerSpaceFor` says which room the balcony's LONG side is connected to —
 * see the note there for why the long side and not the nearest room.
 * `nearestBoardTo` then picks that room's plate nearest the balcony's own
 * boundary. And because it picks from `boardsFor` + `bayBoardsFor` — the
 * boards AS DRAWN, deletions applied — a plate added to the inner room later
 * takes the balcony over automatically if it lands nearer: the answer is
 * derived from what is on the sheet, not stored when the balcony was lit.
 * That is the second half of what was asked for ("if another switchboard is
 * placed in the inner space which is closest to the balcony, then the
 * connection is from that switchboard") and it needs no code of its own.
 *
 * A SPACE WITH NOWHERE TO FEED FROM FALLS BACK TO ITSELF. A detached terrace,
 * or a balcony whose inner room was never lit, has no plate to point at — so
 * `planBoardResults` has already given it none and this gives it none either,
 * and its flows come out with no board, which the drawing shows as fittings
 * with no loop rather than as a wire to nowhere.
 */
export function planOutdoorFeeds({ rooms = [], roomTypes = {}, projectId = null,
                                   pxPerFt = 0, boardsFor, bayBoardsFor } = {}) {
  const out = {};
  if (!(pxPerFt > 0) || !rooms.length) return out;
  const all = rooms.filter((r) => r.plan?.ok)
    .map((r) => ({ id: r.id, polygonPx: r.plan.polygonPx }));
  for (const r of rooms) {
    if (!r.plan?.ok) continue;
    if (!isOutdoor(projectId, roomTypes[r.id]?.type)) continue;
    const inner = innerSpaceFor({
      room: { id: r.id, polygonPx: r.plan.polygonPx }, rooms: all, pxPerFt });
    if (!inner) continue;
    const host = rooms.find((q) => q.id === inner.roomId);
    if (!host) continue;
    /* NEAREST, WHATEVER ITS ROLE — AND THAT IS A DELIBERATE EXCEPTION TO
       `servesBay`, WHICH IS WHY IT IS WRITTEN OUT.
       This filtered to the general plates first, on the reasoning `servesBay`
       gives inside a room: a bedside plate exists to switch its own sconce
       and a television plate its own socket, so a ROOM's ceiling must never
       be hung off either — otherwise the downlights come on from a plate at
       the pillow while the board beside the door feeds nothing.
       A BALCONY IS NOT A PIECE OF THAT ROOM'S CEILING. It is one light on the
       other side of a wall, and the question it asks is the plain one: which
       switch is nearest to reach. In a bedroom the answer is very often the
       bedside plate — a multi-gang plate at the pillow carrying the room's
       masters is exactly where somebody wants the balcony on it — and the
       general-plates rule sent the wire the length of the room to a board on
       the far wall instead. So the role test comes off for this one join.
       The room's own ceiling still obeys `servesBay`; nothing about that
       changed, and nothing here can change it. */
    // AND NOT A SOCKET OUTLET. A balcony's fittings are switched from indoors,
    // and a plate with no switch on it cannot switch them.
    const boards = [...boardsFor(host), ...bayBoardsFor(host)]
      .filter((b) => !b.socketOnly);
    const board = nearestBoardTo(boards, r.plan.polygonPx);
    if (!board) continue;
    out[r.id] = { board, roomId: host.id, roomName: host.outline.name || null };
  }
  return out;
}

/**
 * IS THIS PLATE AN OUTLET OR A SWITCHBOARD, AND AT WHAT RATING.
 *
 * ONE ANSWER, ASKED IN ONE PLACE. The mode decides four things — what the
 * plate composes to, whether it produces an outlet flow, whether a ceiling may
 * fall back to it, and whether a dragged wire may be dropped on it — and four
 * readers each working it out from `boardKinds` is four chances to disagree
 * about what a plate with no entry is.
 *
 * THE DEFAULT IS WHERE IT CAME FROM. A plate somebody dropped on a wall starts
 * as an outlet, because that is what the tool places; everything a rule put
 * beside a door or a bed starts as a board, because that is what the rule
 * placed. `boardKinds` holds only the ones somebody changed.
 */
export function boardModeOf(b, { boardKinds = {}, country } = {}) {
  const o = boardKinds[b?.id] ?? {};
  return {
    /* --- WHAT A PLATE IS BORN AS, AND A LAMP'S IS NOT AN OUTLET ------------
       A HAND-DROPPED PLATE IS BORN A SOCKET OUTLET because that is the
       commonest thing somebody means by dropping one: a socket on a wall,
       switched from the board by the door.
       A STANDING LAMP'S PLATE IS BORN A SWITCHBOARD, and that is the fix. It
       was born an outlet with the rest — so it arrived on the drawing carrying
       one socket and NO SWITCH, which is precisely what a lamp may not have.
       An outlet's switch lives on the board its wire runs to, and there is no
       sense in a plate three feet from a lamp whose switch is across the room.
       Worse, an outlet cannot be a flow's board, so the lamp had no wire to it
       either and a second lamp beside it got nothing at all.
       BORN A SWITCHBOARD, EVERY ONE OF THOSE FOLLOWS. The lamp's flow can land
       on it, so the wire is drawn; `pointsFromFlows` sees `kind: 'lamp'` and
       puts a socket AND its switch on the plate; and a second lamp within three
       feet lands on the same plate and grows a second pair rather than a second
       frame. See LAMP_BOARD_ROLE in lib/electrical.js.
       STILL AN OVERRIDE ANYBODY MAY GIVE. `o.outlet` wins, so a person who
       genuinely wants the switch elsewhere can tick it across — and the lamp
       then has no plate in reach that can carry a switched socket, loses its
       wire, and says so by having none. That is the honest consequence of the
       tick rather than a state to prevent. */
    outlet: o.outlet ?? (!!b?.placed && b?.role !== LAMP_BOARD_ROLE),
    /* THE RATING IS THE ROLE'S UNTIL SOMEBODY TYPES ONE. Almost every plate on
       this drawing switches lights and is built at the light rating; a basin
       plate carries a shaver, a trimmer, a hair dryer, and is built at the one
       above it. See APPLIANCE_ROLES in lib/electrical.js and `applianceA` in
       lib/switchboards.js — neither 6 nor 16 is written down anywhere. */
    amps: o.amps ?? (APPLIANCE_ROLES.has(b?.role) ? applianceA(country)
      : lightSwitchA(country)),
  };
}

/**
 * ...AND THE PLATE WITH THAT ANSWER APPLIED.
 *
 * WRAPPED ROUND ALL THREE SOURCES OF BOARDS below rather than round their
 * readers, so nothing downstream has to remember to ask. A board reaching the
 * canvas, the flows, the pool or the card is already the thing it is.
 */
export function applyMode(list, { boardMode, boardHeights = {} } = {}) {
  return list.map((b) => {
    const m = boardMode(b);
    const done = m.outlet
      ? asOutlet(b, m.amps)
      : { ...b, socketOnly: false, amps: m.amps };
    /* AND THE HEIGHT, AFTER THE MODE AND NOT BEFORE. `asOutlet` sets its own
       default — 300, outlet height — so an override applied first would be
       overwritten by the conversion. Applied last it survives one, which is
       right: a person who typed 900 into a plate meant 900 whichever of the two
       things that plate is. */
    const h = boardHeights[b.id];
    if (!Number.isFinite(h)) return done;
    const base = done.heightsMm ?? heightsFor(done.role);
    return { ...done, heightsMm: [h, ...base.slice(1)], heightSet: true };
  });
}

/**
 * This space's boards, minus the ones somebody threw away.
 *
 * `boardsOff` IS APPLIED HERE AND NOWHERE ELSE, which is what keeps one
 * answer to "is this plate on the drawing". The panel's count, the canvas, the
 * flows and the schedule all come through this function.
 */
export function drawnBoards(list = [], { boardsOff = [] } = {}) {
  return list
    .filter((b) => !b.rejected && b.point && !boardsOff.includes(b.id))
    // AS DRAWN, WHICH IS WHERE SOMEBODY PUT IT. Everything that paints a plate
    // or routes a wire to one comes through here; `ruleBoardsFor` is the other
    // half of this and is what decides.
    .map(asDrawn);
}

/**
 * The same boards, at the positions the RULES chose.
 *
 * TWO READINGS OF ONE LIST, AND THIS IS THE POINT OF THE SPLIT. Dragging a
 * plate along the plaster is a decision about where the switch is reachable
 * from. It is not a decision about what it switches — and `planChunkBoards`
 * decides that geometrically: a bay adopts a board standing on one of its own
 * walls and makes itself a new one when none does. Feed it the dragged
 * position and moving the door plate across the room would take the switch
 * away from the ceiling it was switching and grow a second plate to replace
 * it, which is the opposite of what dragging one is for.
 *
 * So ownership is settled where the rules put things, and only the drawing and
 * the wire follow the hand. The ids are the same in both lists, which is what
 * lets `flowsPx` take the ownership map from one and the geometry from the
 * other.
 */
export function ruleBoards(list = [], { boardsOff = [], boardMode } = {}) {
  return list
    .filter((b) => !b.rejected && b.point && !boardsOff.includes(b.id))
    /* AND NOT THE ONES SOMEBODY TURNED INTO SOCKETS. This list decides which bay
       is switched from which plate, and a socket outlet cannot switch a ceiling
       — it has no switch on it at all. Left in, converting the door's board to
       an outlet would leave the room's downlights owned by a plate with nothing
       to press, instead of falling through to the next board as they should. */
    .filter((b) => !boardMode(b).outlet);
}

/**
 * ...AND THE PLATES SOMEBODY PUT ON THIS SPACE'S WALLS THEMSELVES.
 *
 * THE THIRD SOURCE OF BOARDS, and it goes through a function of its own for
 * the reason the other two do: every reader of the drawing — the canvas, the
 * flows, the assignable pool, the switchboard card — has to get the same
 * answer to "is this plate there", and three filters written three times is
 * three chances to disagree.
 *
 * NO `asDrawn` AND NO `boardMoves`. A rule's board has two positions — where
 * the rule put it and where somebody dragged it — and `asDrawn` picks between
 * them. A hand-placed board has one: `sFt` IS the hand position, so dragging
 * one writes straight back to `manualBoards` and there is nothing to reconcile.
 * See `boardPointerMove`.
 */
export function handBoards(r, { manualBoards = [], boardsOff = [], pxPerFt = 0 } = {}) {
  return placedBoards(
    manualBoards.filter((m) => m.roomId === r.id && !boardsOff.includes(m.id)),
    { polygonPx: r.plan?.polygonPx ?? [], pxPerFt });
}

/** The height a plate is actually set at, override or rule. */
/* THE EXPRESSION MOVED TO electrical.js AND THIS DELEGATES. `lampPlateInReach`
   has to ask the same question — a plate above 750mm is not something a floor
   lamp plugs into — and two copies of "the override, then the role, then 1200"
   is how the plate a lamp refuses comes to differ from the height its card
   prints. See `plateHeightMm`. */
export const heightOf = plateHeightMm;

/**
 * ONE CLICK SEATS A PLATE ON THE NEAREST WALL THAT CAN HOLD ONE.
 *
 * FREE ALONG THE WALLS AND NOWHERE ELSE, which is the same rule dragging a
 * plate follows and is not a limitation: a switchboard off its wall is not a
 * thing, and a blue rectangle in the middle of a room is a mark nobody could
 * build from. So the click means "which piece of plaster do you mean", and
 * `nearestSeat` answers it.
 *
 * ACROSS EVERY LIT SPACE AND NOT JUST THE ONE UNDER THE POINTER. A wall is
 * shared by two rooms and a click aimed at it lands a pixel either side by
 * luck; asking `roomAt` first would make which room's wall you got depend on
 * that pixel. Every room bids with its own nearest wall and the closest wins,
 * which is the answer the pointer was actually pointing at.
 */
export function seatForClick(p, { rooms = [], pxPerFt = 0 } = {}) {
  if (!(pxPerFt > 0)) return null;
  let best = null;
  for (const r of rooms) {
    const poly = r.plan?.polygonPx;
    if (!poly?.length) continue;
    const seat = nearestSeat(p, { polygonPx: poly, pxPerFt });
    if (!seat) continue;
    if (!best || seat.d < best.seat.d) best = { seat, roomId: r.id };
  }
  // TOO FAR FROM ANY WALL IS A MISS AND NOT A GUESS. Without a ceiling on it,
  // a click in the middle of a hall would seat a plate on whichever wall
  // happened to be nearest — twelve feet away, and nowhere near where the
  // person pointed.
  if (!best || best.seat.d > Math.max(24, pxPerFt * 4)) return null;
  return best;
}

/**
 * A STANDING LAMP HAS LANDED — DOES IT NEED A SOCKET OF ITS OWN, AND WHERE?
 *
 * THE ONE FITTING ON THIS DRAWING THAT IS PLUGGED IN. Everything else is wired
 * into a ceiling and the cable is run to wherever it has to go; a standard lamp
 * has a lead, so it either reaches a plate that already exists or it needs one
 * put on the wall behind it. See LAMP_SOCKET_FT in lib/electrical.js for the
 * reach and why it is short.
 *
 * NULL MEANS "NOTHING TO DO", AND THE TWO CASES IT COVERS ARE WORTH SEPARATING.
 * A plate that can carry a switched socket within reach — the board by the door,
 * or the plate the LAST standing lamp put on this wall — is what this lamp plugs
 * into as well, and seating a second frame beside it would be a plate nobody
 * asked for. What the second lamp still gets is its own SOCKET AND SWITCH, as
 * two more modules on that plate: its flow lands there and `pointsFromFlows`
 * emits the pair. Two lamps, two sockets, one frame — which is how it is built.
 * A BARE SOCKET OUTLET IS NOT SUCH A PLATE and `lampPlateInReach` skips it: an
 * outlet has no switch on it by definition, so a lamp "served" by one would have
 * no way to be turned off at the wall. That is the same test flows.js runs when
 * it decides which plate the lamp's wire runs to, which is why it is one
 * function in electrical.js and not a distance written down twice.
 *
 * ITS OWN ROOM AND NO OTHER, which is the opposite of `seatForClick` above and
 * for a different question. That one is resolving a CLICK — a wall is shared by
 * two rooms and which side of it you meant is decided by a pixel, so every room
 * bids. This is resolving a lamp that is already standing inside one room, and
 * the wall on the far side of a party wall is not a wall this lamp can be
 * plugged into however near it is.
 *
 * AND NO DISTANCE CEILING, which is the other difference. `seatForClick` refuses
 * a wall more than four feet from the pointer because a click that far out was
 * aimed at nothing; a lamp in the middle of a twenty-foot room is aimed at
 * exactly where it is, and the nearest wall is the answer however far away it
 * is. A socket ten feet from the lamp is a fair drawing of a real problem — the
 * lamp is where somebody put it — and a lamp with no socket at all is not.
 */
export function lampSocketSeat(at, { rooms = [], plates = [], lamps = [],
                                     pxPerFt = 0 } = {}) {
  if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  if (!(pxPerFt > 0)) return null;
  const room = rooms.find((r) => r.plan?.polygonPx?.length
    && pointInPolygon(at, r.plan.polygonPx));
  if (!room) return null;
  const polygonPx = room.plan.polygonPx;
  const mine = plates.filter((b) => b.roomId === room.id);

  // 1. ALREADY SERVED. Nothing to do, and this is the common answer.
  if (lampPlateInReach(at, mine, pxPerFt)) return null;

  /* 2. ...OR ONE PLATE COULD SERVE THIS LAMP AND THE ONES ANOTHER ALREADY
        DOES, if it were seated between them rather than hard against the first
        lamp that asked for it. See `lampPlateToShare`: this is the case where
        two lamps four feet apart were coming out with two plates. */
  const inRoom = lamps.filter((l) => l && Number.isFinite(l.x)
    && Number.isFinite(l.y) && pointInPolygon(l, polygonPx));
  const share = lampPlateToShare(at, { plates: mine, lamps: inRoom,
                                       polygonPx, pxPerFt });
  if (share) return { slide: share.id, sFt: share.sFt };

  // 3. NOTHING WILL REACH, SO A PLATE OF ITS OWN, on the wall it is nearest.
  const seat = nearestSeat(at, { polygonPx, pxPerFt });
  return seat ? { seat, roomId: room.id, role: LAMP_BOARD_ROLE } : null;
}

/**
 * ONE PLATE-AS-A-POINT LIST, TURNED INTO THE WRITES THAT STORE IT.
 *
 * THE ONE PLACE THE PRIMITIVE MEETS THE STORE, and it is here rather than
 * inside the gesture so it can be driven without a renderer. `useDrag` moves and
 * forks a LIST — that is how every other element on this canvas inherits the
 * Option-copy — and a plate does not live in one: a hand-placed plate is a
 * `manualBoards` entry and a rule board's hand position is a `boardMoves` value,
 * told apart in the reducer on purpose. So the gesture keeps its own list of the
 * members it picked up and this says what each frame of it means.
 *
 * A RECORD THAT WAS NOT THERE BEFORE IS A TWIN. Everything else is a slide, and
 * an unchanged record is nothing at all — a dispatch per frame per plate that
 * had not moved would re-order the loop and re-compose a switchboard for no
 * change.
 *
 * A TWIN IS ALWAYS A HAND-PLACED PLATE WHATEVER IT WAS COPIED FROM. There is no
 * second door in a room and no second bay, so a duplicate of either is simply a
 * plate somebody put on a wall, and carrying `role: 'door'` across would give it
 * a rule's height and a rule's name for a position no rule chose.
 *
 * THE LAMP ROLE IS THE ONE THAT CARRIES OVER, and it is named rather than passed
 * through so that the exception is a decision rather than an accident of what
 * happened to be on the record: copying a standing lamp's socket to make a
 * second one has to give another socket at 300mm, born a switchboard, and not a
 * switch plate at 1200. See LAMP_BOARD_ROLE.
 */
export function boardSeatWrites(before = [], after = []) {
  const out = [];
  for (const rec of after) {
    const sFt = boardSFt(rec.u, rec.host);
    if (sFt == null) continue;
    const was = before.find((q) => q.id === rec.id);
    if (!was) {
      out.push({ kind: 'add', id: rec.id, roomId: rec.roomId, sFt,
                 ...(rec.role === LAMP_BOARD_ROLE ? { role: rec.role } : {}) });
    } else if (was.u !== rec.u) {
      out.push({ kind: 'slide', id: rec.id, sFt });
    }
  }
  return out;
}
