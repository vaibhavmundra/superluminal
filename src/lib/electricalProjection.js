import { pointInPolygon } from './geometry.js';
import { planFlows } from './flows.js';
import { markClashes } from './electrical.js';

/** Every plate, including socket outlets, as a wire-drop target. */
export function projectAllBoardsPx(rooms, boardsFor, bayBoardsFor, placedBoardsFor) {
    const out = [];
    for (const r of rooms) {
      out.push(...boardsFor(r), ...bayBoardsFor(r), ...placedBoardsFor(r));
    }
    /* EVERY PLATE, SOCKET OUTLETS INCLUDED. This list is what a dragged wire may
       be dropped ON, and dropping one on an outlet is a perfectly clear thing to
       mean: it says this appliance is switched from that plate. An outlet cannot
       switch anything — it has no switch on it — so what the drop does is
       CONVERT it, in the same gesture, exactly as adding a point does. See
       `flowPointerUp`.
       IT USED TO BE FILTERED HERE, which made an outlet inert to a drag: the
       ring never lit, the release did nothing, and nothing said why. Refusing a
       gesture whose meaning is obvious is worse than acting on it. */
    return out;
  
}

/** Project the room's fittings into switched circuit paths. */
export function projectFlowsPx(rooms, boardsFor, bayBoardsFor, bayResults,
  obstaclesPx, accentZonesPx, taskSpotsPx, outdoorFeeds, pxPerFt, baysOf,
  allBoardsPx, placedBoardsFor, flowBoards, flowBends, lampsPx = [], flowLinks = {}) {
    const out = [];
    if (!(pxPerFt > 0)) return out;
    for (const r of rooms) {
      if (!r.plan?.ok) continue;
      // BOTH KINDS OF PLATE, EACH AS DRAWN. `owner` below comes from the same
      // pass at its RULE positions, and the ids match across the two — which is
      // what lets the wire follow a dragged plate while the switching does not.
      /* AN OUTDOOR SPACE IS HANDED THE PLATE THAT SWITCHES IT, which stands in
         another room. `boardsFor(r)` is empty for one — the rules pass was
         skipped, see `boardResults` — so without this its fittings would come
         out with no board and no loop at all. With it, every flow on the
         balcony falls back to the one board on offer (there is no `owner` map
         to override it, because a balcony has no bays of its own) and the wire
         runs from the fittings, through the wall, to a plate somebody can reach
         from indoors.
         THE WIRE CROSSING THE WALL IS THE POINT AND NOT A GLITCH: that is what
         the circuit does, and a drawing that stopped the loop at the threshold
         would be hiding the only unusual thing about it. */
      const feed = outdoorFeeds[r.id];
      /* THE RULES' OWN FALLBACK LIST, MINUS ANY PLATE THAT IS NOW A SOCKET.
         `boardFor` in flows.js falls back to "the nearest plate that can carry a
         ceiling", and a converted board cannot: it has no switch on it. Leaving
         it in would give a row of downlights a board with nothing to press. */
      const boards = (feed ? [feed.board] : [...boardsFor(r), ...bayBoardsFor(r)])
        .filter((b) => !b.socketOnly);
      /* --- AND THE PLATES ON THIS ROOM'S WALLS, WHICH ARE NOT IN THAT LIST ---
         DELIBERATELY BESIDE `boards` AND NOT IN IT. That list is what a ceiling
         may fall back to, and a hand-placed plate has never been part of it —
         see the note above and `handPlates` in flows.js. What reads this one is
         the standing lamps and nothing else: a lamp's socket plate IS a
         hand-placed plate (the placement seats it), so without this the lamp
         could not find the very plate that was put there for it. */
      const handPlates = placedBoardsFor(r).filter((b) => !b.socketOnly);
      const bays = baysOf(r);
      /* EVERY BAY OUT HERE IS SWITCHED FROM THAT ONE PLATE, said as ownership
         rather than left to the fallback. `boardFor` falls back to the nearest
         board that `servesBay` — which excludes a bedside and a television
         plate, correctly, because neither can carry a ceiling. If the inner
         room's nearest plate happens to be one of those, the fallback would
         find nothing and the balcony would come out with no loops at all.
         Naming the owner says what has actually been decided: this ceiling runs
         off that plate, whatever kind of plate it turned out to be. */
      const owner = feed
        ? new Map(bays.map((b) => [b.key, feed.board.id]))
        : (bayResults[r.id]?.owner ?? new Map());
      const { flows } = planFlows({
        room: { id: r.id, polygonPx: r.plan.polygonPx },
        bays,
        /* THE CHUNKER'S OWN CUT AND ITS CELLS, WHICH IS NOT THE SAME LIST AS
           `chunksPx`/`cellsPx` WHILE THE FITTINGS ARE SWITCHED OFF.
           They are identical whenever `AUTO_GRID` is on — `gridChunks` is
           captured out of the very same `res.chunks` before the blanking runs,
           so this changes nothing about a plan the grid laid out itself. What it
           changes is the case that matters now: with the fittings off, the
           visible lists are empty and the private ones still hold the cut, and
           the cut is what a hand-placed lamp is seated in. Handing in the empty
           pair meant every lamp on the drawing was a lamp in no cell and no
           chunk, which is why the rows never ran.
           SEE THE NOTE ON `gridChunksPx` IN layout.js: these are deliberately
           NOT put back into `plan` in place of the visible lists, because
           everything else downstream of those is COUNTING what stands in them
           and would start reporting a layout that is not on the sheet. Reading
           them here is the reader that note anticipates — this pass counts
           nothing and places nothing; it asks which row a fitting is in. */
        chunks: r.plan.gridChunksPx ?? r.plan.chunksPx ?? [],
        cells: r.plan.gridCellsPx ?? r.plan.cellsPx ?? [],
        lights: r.plan.lightsPx ?? [],
        /* AND THE LAMPS SOMEBODY PUT THERE THEMSELVES. See `lamps` in flows.js
           for what is in this list and why it arrives separately from `lights`.
           FILTERED BY `roomId` LIKE THE SPOTS ABOVE, and every lamp on the
           drawing carries one: a hand-placed COB is stamped with the space it
           was dropped in, and an array's lamps take theirs from the array or
           from the geometry it was set out on. A lamp with no room is a lamp on
           no ceiling and matches nothing, which is the right answer for it. */
        lamps: lampsPx.filter((c) => c.roomId === r.id),
        objects: obstaclesPx.filter((f) => pointInPolygon({ x: f.x, y: f.y }, r.plan.polygonPx)),
        accents: accentZonesPx.filter((a) => a.roomId === r.id),
        spots: taskSpotsPx.filter((sp) => sp.roomId === r.id),
        tracks: r.plan.tracksPx ?? [],
        boards,
        handPlates,
        /* THE SOCKET OUTLETS ON THIS SPACE'S WALLS, each of which becomes one
           flow back to the nearest plate that can switch it — see section 0 of
           flows.js. They are handed in as FITTINGS and not as boards, which is
           what they are: a socket is a thing on a wall that needs switching, and
           the plate it is switched from grows a module for it.

           FROM ALL THREE SOURCES AND NOT ONLY THE HAND-PLACED ONES, because the
           conversion is offered on every plate. A board beside a door that
           somebody turned into an outlet is a socket outlet in every respect,
           and it has to produce its wire like any other or it would be a socket
           with no switch anywhere — the one thing this app does not allow. */
        outlets: [...boardsFor(r), ...bayBoardsFor(r), ...placedBoardsFor(r)]
          .filter((b) => b.socketOnly)
          .map((b) => ({ id: b.id, x: b.point.x, y: b.point.y, amps: b.amps })),
        /* AND THE POOL A DRAGGED WIRE MAY NAME, which is every plate on the
           drawing. `boards` above stays this room's own — the rules' fallback
           is "the nearest plate" and must not reach across a party wall — while
           an assignment is somebody having said outright which plate they mean.
           See the note on `boardPool` in flows.js. */
        /* THE POOL EXCLUDES OUTLETS EVEN THOUGH THE DROP TARGETS DO NOT, and
           the two lists differ for one reason: this one is the INVARIANT.
           Nothing may ever be switched from a plate that has no switch on it, so
           an assignment naming an outlet resolves to nothing and falls back to
           the rules. The canvas converts the plate on the drop, so by the next
           render there is no outlet to resolve — and if that ever failed to
           happen, the wire would sit on a real board rather than on a socket. */
        boardPool: allBoardsPx.filter((b) => !b.socketOnly),
        owner,
        assign: flowBoards,
        bends: flowBends,
        /* WHAT A HAND RE-PLUGGED — fitting id -> the fitting feeding it. Handed
           whole rather than filtered to this room: `planFlows` indexes it
           against the flows it just built and ignores anything whose ends are
           not both on them, which is also what makes a link to a fitting in
           another room harmless rather than wrong. */
        links: flowLinks,
        zones: r.plan.zonesPx ?? [],
        pxPerFt,
      });
      out.push(...flows);
    }
    return out;
  
}

/* EVERY SWITCHBOARD STILL STANDING, in plan pixels.

   IT SITS BELOW `flowsPx` AND NO LONGER HAS TO. It was moved down here when it
   briefly read the flows — to colour a plate red when nothing was switched
   from it — and a `useMemo` body runs the moment it is reached during render,
   so above `flowsPx` it would have read a `const` in its temporal dead zone
   and thrown on the first paint. That reading is gone with the red (see
   below); the position is kept because moving it back buys nothing and
   nothing reads the boards between the two.

   THE ROOM'S OWN BOARDS ALWAYS. Refused ones are kept in `boardResults` — the
   panel wants to say a board was refused and why — but they carry no geometry,
   so `boardsFor` drops them on the way to the drawing rather than letting the
   canvas draw a plate at NaN. It drops the ones somebody deleted in the same
   place, which is why every reader of the drawing goes through it.

   THE BAY BOARDS ONLY WHILE THE LAYER IS ON. A plate that exists because a bay
   needed one is part of the flow reading — it is what those loops run back to
   — and on a sheet with the loops switched off it is a blue rectangle nobody
   asked for. The board beside the DOOR is not like that: it is the answer to
   "where is the switch in this room", which is a question about the room and
   not about the wiring, so it stays on the drawing either way. */
export function projectSwitchboardsPx(rooms, boardsFor, bayBoardsFor, placedBoardsFor,
  boardNames, electricalLayer, doorEdit, pxPerFt) {
    const out = [];
    for (const r of rooms) {
      out.push(...boardsFor(r));
      /* A HAND-PLACED PLATE IS ON THE DRAWING WHATEVER THE LAYER SAYS, like the
         board beside the door and unlike a bay plate. A bay board exists because
         a piece of ceiling needed switching and is part of the flow reading; one
         somebody dropped on a wall is a decision they made about this building,
         and hiding it with the wiring would mean a gesture whose result vanishes
         when a switch is flicked. */
      out.push(...placedBoardsFor(r));
      // `!doorEdit` FOR THE SAME REASON `canvasLayers` DROPS THE LOOPS while
      // the doors are being confirmed: a bay board is part of the flow reading,
      // and the flows are what the boxes being edited will move. Half the
      // reading left on screen under the question is worse than none of it.
      if (electricalLayer && !doorEdit) out.push(...bayBoardsFor(r));
    }
    /* `loose` WAS COMPUTED HERE — which plates had nothing on them, so the
       canvas could draw those red. It is gone with the state it marked: a plate
       somebody drops on a wall is a SOCKET OUTLET and wires itself the moment it
       exists, so there is no unconfigured second to colour. See the note where
       SB_LOOSE used to be in electrical.js. */
    /* AND ITS NAME, STAMPED ON THE WAY OUT. Every reader of the drawing goes
       through this list — the canvas, its hover card, the panel — so the name is
       attached once here rather than each of them being handed the map and
       remembering to ask. */
    return markClashes(out.map((b) => ({ ...b, name: boardNames.get(b.id) ?? null })),
      pxPerFt);
  
}
