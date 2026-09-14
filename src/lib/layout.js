/* ---------------------------------------------------------------------------
   THE LAYOUT PIPELINE.

   This is the `rooms` memo out of App.jsx, moved here unchanged. It was already
   pure — document in, laid-out rooms out — and being stranded in a React memo
   was the only reason none of tools/test-*.mjs could reach it. The twenty keys
   of `input` are exactly what the memo's dependency array named.
   --------------------------------------------------------------------------- */
import { planLights, withTargetArea, cellKey, centreBandBox } from './planner.js';
import { designChunking, planCeilingDesign, chunkKey } from './ceilingDesign.js';
import { STRIP_OFFSET_FT, coveHostFor, bandBetween, bandFixtureFor, COVE_GAP_FT,
         coveOutlineClearOfOutline } from './cove.js';
import { planDrawnTrack } from './track.js';
import { bbox, pointInPolygon } from './geometry.js';
import { regionFromOutline, outlineStats } from './outline.js';
import { targetAreaFor, fixtureForCell } from './roomTypes.js';
import { lumenCriteriaFor } from './settings.js';
import { coveRectFt, pathLengthFt, outlineFt as shapeOutlineFt,
         isOpen as shapeIsOpen, isBuilt as shapeIsBuilt } from './ceilingShapes.js';
import { trackFixtureFor } from './boq.js';

/* ---------------------------------------------------------------------------
   THE GRIDDING ENGINE IS OFF, AND THIS IS THE WHOLE OF THE SWITCH.

   A space used to arrive lit: the moment it was taken up, the chunker cut its
   ceiling, the ladder chose a fitting and a grid of downlights appeared. That
   was the app's opening move, and it is the wrong one for what this tool is
   becoming — you design the layout, and the app tells you whether the space has
   the ambient level it needs. A room that lights itself the instant you open it
   has answered the question before it was asked.

   So a space starts EMPTY, and the question the panel asks is what the room IS:
   how high the ceiling is, and what the three surfaces are finished in.

   AND THE SUGGESTIONS ARE BACK NOW, BEHIND A SWITCH — which is exactly what
   this constant said would happen to it. `layers.autoLights` is that switch:
   the Auto-placed lights tick in the View menu, threaded down here through
   `usePlanScene` so that the ENGINE answers to it and not merely the canvas. A
   layer that gated the drawing alone could not do this job, and that is worth
   stating because it looked like it could: what such a layer hides and shows is
   `plan.lightsPx`, and the blanking below has already emptied that — so the
   switch drew nothing whichever way it was thrown.

   AND IT IS OFF BY DEFAULT AGAIN, WHICH IS WHAT THIS HEADER ASKED FOR. The
   switch spent a while defaulting ON — a space lit itself the moment it was
   taken up, which is the exact opening move the block above calls the wrong
   one. What changed is that there is now a way to see the engine's opinion
   WITHOUT taking it: `layers.suggestGrid` draws the same answer as dotted
   proposals with nothing placed and nothing billed, and that is the capsule
   over the drawing. The question is asked before it is answered again.

   IT IS NOT `layers.lights`, WHICH IS THE MASTER OVER EVERY FITTING ON THE
   SHEET. That one is visibility and nothing else: a hand-placed COB hidden by
   it is still in the schedule, and the engine's grid has to behave the same
   way. So placement follows `autoLights` on its own, and the canvas keeps
   nesting the two — see PlanCanvas.

   IT SUPPRESSES THE ANSWER, NOT THE MACHINE. `planCeilingDesign` still runs and
   is still handed everything it always was — it is what produces the room's
   `stats`, which the schedule, the exporters and the panel all read, and half a
   dozen call sites would have to learn a second shape if it stopped. What is
   blanked is what it PLACED: the fittings, the cells they sit in, the chunks
   they were cut from, and the tracks derived from them. See the block in the
   `rooms` memo.

   WHAT SURVIVES IS EVERYTHING A HAND PUT THERE. A cove somebody drew keeps its
   tape, and the accents, spots, sconces and strips are separate machines that
   never came from the grid. A tool in the rail that did nothing would be worse
   than no tool.
   --------------------------------------------------------------------------- */
export function layoutRooms(input) {
  const {
    source, pxPerFt, litOutlines, useBoundingRect, ceilingObstaclesPx, zoneList,
    zones, reverseCoveZones, chunkOpt, chunkPicks, opt, enclosedZones, roomTypes,
    projectId, designPicks, ceilingKinds, ceilingShapes, lightMoves, manualTracks,
    isAdmin, autoLights,
    /* --- EVERY PLACED OBJECT, INCLUDING THE ONES THAT ARE NOT OBSTACLES -----
       `ceilingObstaclesPx` ABOVE IS THE PLANNER'S LIST AND IS DELIBERATELY
       SHORTER. It has already had the off-ceiling entries filtered out (see
       `offCeiling` in lib/ceilingObjects.js) because a split unit on a wall, a
       geyser over a door and a lamp standing on the floor obstruct no downlight,
       and feeding them in would punch holes in a layout for things that are not
       in its way. That filter is right and stays.
       BUT TWO READERS WANT THE OBJECT AND NOT THE OBSTACLE, and both of them
       broke on the standing lamp: the analysis has to COUNT it as a lamp (see
       `fixtureGroups`) and the heatmap has to LIGHT from it (see `emitters`), and
       both were reading `geo.fansInRoom`, which is the obstacle list. A fitting
       absent from both is a lamp on the drawing contributing nothing and
       appearing in no row, which reads as a bug rather than as a decision.
       SO THE FULL LIST COMES IN AS WELL, and `geo.objectsInRoom` is what those
       two read. Defaulted, so a caller that hands in only the obstacles — every
       test in tools/ — gets an empty list and behaves exactly as before rather
       than throwing. */
    obstaclesPx = [],
  } = input;
  /* THE SWITCH, READ ONCE PER LAYOUT — see the memo at the top of this file.
     A PLAIN BOOLEAN CAST AND NOT `!== false`, because the caller hands in a
     layer out of an object that has been merged over LAYER_DEFAULTS, so the key
     is always present and always an answer somebody gave. See `layers` in
     useViewPrefs for why that merge is the thing that makes this safe. */
  const AUTO_GRID = !!autoLights;
    if (!source || !pxPerFt || !litOutlines.length) return [];
    const out = [];

    for (const o of litOutlines) {
      const region = regionFromOutline(o, pxPerFt);
      if (!region?.ok) continue;

      const polygonPx = useBoundingRect ? region.boundingRect : region.polygon;
      const b = bbox(polygonPx);
      const origin = { x: b.minX, y: b.minY };
      const toFt = (p) => ({ x: (p.x - origin.x) / pxPerFt, y: (p.y - origin.y) / pxPerFt });
      const toPx = (p) => ({ x: p.x * pxPerFt + origin.x, y: p.y * pxPerFt + origin.y });

      // A whole-floor plan carries fans and beds for every room. Only the ones
      // over THIS ceiling are obstacles in THIS layout, and a centre inside the
      // polygon is the test — a bed belongs to the room it is standing in.
      const mine = ceilingObstaclesPx.filter(
        (f) => pointInPolygon({ x: f.x, y: f.y }, polygonPx));
      /* THE SAME CONTAINMENT TEST OVER THE LONGER LIST — see `obstaclesPx` in
         the signature. A superset of `mine`, so anything already reading
         `fansInRoom` is unaffected. */
      const myObjects = obstaclesPx.filter(
        (f) => pointInPolygon({ x: f.x, y: f.y }, polygonPx));
      const myZones = [
        // BY ROOM WHERE THE ZONE KNOWS ITS ROOM, and by containment otherwise.
        // A hand-drawn box belongs to whatever it is drawn over, which is what
        // the centre test is for. A reverse cove already knows: it was measured
        // against THIS room's grid. That grid is the room's BOUNDING BOX, so on
        // an L-shaped room a band along one bbox edge can have its centre out in
        // the notch — containment would drop it and the slot would be drawn on
        // the plan while the fittings walked straight through it. A zone outside
        // the polygon is harmless to the planner; a zone silently discarded is
        // not.
        ...zoneList.filter((z) => (z.roomId
          ? z.roomId === o.id
          : pointInPolygon({ x: (z.x0 + z.x1) / 2, y: (z.y0 + z.y1) / 2 }, polygonPx))),
        // This room's own enclosed rooms, which belong to it and to no other.
        ...enclosedZones(o),
      ];

      /* --- THE COVES SOMEBODY DREW ON THIS CEILING ------------------------
         BY CONTAINMENT, the same test a hand-drawn no-light zone answers: a
         shape belongs to the space it is standing in. A shape is held in the
         PLAN's own feet — see `ceilingShapes` — and every number below this
         point is in the room's own, so it is converted once, here, and never
         again.

         IT IS THREE THINGS AND THEY ARE NOT INTERCHANGEABLE. `rect` is the
         closest rectangle the shape fits in, and it is what the GRID is cut on;
         `outline` is the setting-out line as drawn; `stripOutline` is the tape,
         three inches outside it, which is what is installed and what is billed.
         See ceilingShapes.js. */
      // THE ROOM IN ITS OWN FEET, hoisted above the shapes because a drawn
      // cove's ring is grown INTO the room and therefore has to be able to ask
      // where its walls are. `geo` below reads the same array rather than
      // mapping it a second time — two conversions of one outline is two things
      // that can disagree.
      const polygonFt = polygonPx.map(toFt);

      /* --- THE HOLES IN THIS CEILING, hoisted for the same reason -----------
         Hand-drawn zones, enclosed rooms and reverse coves: the room as BUILT,
         minus the drawn coves, which are added back below once their rings are
         known. `geo.coveZonesFt` is this list plus those.

         IT IS UP HERE BECAUSE A RING HAS TO KNOW ABOUT THEM, and that was a real
         hole in the first version. The ring is grown by testing containment
         against the room's OUTLINE — and an enclosed WC is inside that outline,
         so a ring would happily grow straight across a room that is not part of
         this ceiling, claim its area in `chunkAreaSqft`, and lay a band chunk
         over it. They are walls, and the ring now stops at them (and may land on
         one exactly, which is the clean case). See `blocks` in coveHostFor. */
      const builtHolesFt = [
        ...zones.filter((z) => pointInPolygon(
          { x: (z.x0 + z.x1) / 2, y: (z.y0 + z.y1) / 2 }, polygonPx)),
        ...enclosedZones(o),
        // AND THE REVERSE COVES, which belong here rather than with the beds.
        // A bed is furniture and is dropped; a reverse cove is BUILT — eight
        // inches of ceiling that is now a slot — and an ordinary cove set out
        // through one would be two details in the same plasterboard. So the
        // perimeter band gets set out round it, which is what would be done on
        // site.
        ...reverseCoveZones.filter((z) => z.roomId === o.id
          || pointInPolygon({ x: (z.x0 + z.x1) / 2, y: (z.y0 + z.y1) / 2 }, polygonPx)),
      ].map((z) => {
        const a = toFt({ x: z.x0, y: z.y0 }), c = toFt({ x: z.x1, y: z.y1 });
        return { x0: a.x, y0: a.y, x1: c.x, y1: c.y,
                 ...(z.polygon?.length ? { polygon: z.polygon.map(toFt) } : {}) };
      });
      const originFt = { x: origin.x / pxPerFt, y: origin.y / pxPerFt };
      const localPt = (q) => ({ x: q.x - originFt.x, y: q.y - originFt.y });
      const localRect = (R) => ({ x0: R.x0 - originFt.x, y0: R.y0 - originFt.y,
                                  x1: R.x1 - originFt.x, y1: R.y1 - originFt.y });
      /* THE HOSTS ARE BUILT ONE AT A TIME, EACH AVOIDING THE REST. A ring is
         grown outward, so two coves eight feet apart would each reach four feet
         towards the other and produce two design chunks that overlap — which the
         planner has no way to survive. Every cove already fixed, and every cove
         not yet reached, is a wall to the one being grown; the order is the
         shapes' own, so the answer is stable rather than depending on which was
         drawn last. See `avoid` in coveHostFor. */
      const shapeBoxes = [], hostsSoFar = [];
      const shapeCoves = ceilingShapes
        /* A GUIDE IS NOT A COVE AND NOTHING IS BUILT FROM IT. It is a line
           somebody put on the ceiling to measure from — see `roleOf` — so it
           cuts no grid, grows no host chunk and produces no tape. Everything
           below this line is about a shape the LAYOUT has taken up. */
        /* ONLY A COVE IS BUILT. It was `!isGuide`, which was right with two
           roles and wrong the moment there were three: a magnetic track would
           have come through here as a pocket, re-cutting the grid and appearing
           in the schedule as tape. `isBuilt` falls the safe way for any role
           this file has not been told about — see the note there. */
        .filter((sh) => shapeIsBuilt(sh))
        /* A SLOT IS NOT A POCKET AND DOES NOT CUT THE GRID. Everything below
           this line — the box, the ring grown into the room, the chunk the
           layout is set out on — describes a cove that runs ROUND a piece of
           ceiling with the room's own grid outside it. An open cove has no
           inside: it is a line across the slab, and the only thing it produces
           is a length of tape. It reaches the drawing and the schedule as an
           accent run instead — see `accentZonesPx`. */
        .filter((sh) => !shapeIsOpen(sh))
        .filter((sh) => pointInPolygon({ x: sh.x * pxPerFt, y: sh.y * pxPerFt }, polygonPx))
        /* THE OUTLINE IS TAKEN ONCE, HERE, because two of the rules below ask
           about it and so does the geometry built at the end of this chain —
           and two conversions of one outline is two things that can disagree. */
        .map((sh) => ({ sh, rect: localRect(coveRectFt(sh)),
                        outline: shapeOutlineFt(sh).map(localPt) }))
        /* AND IT MAY NOT COME WITHIN SIX INCHES OF THE ROOM'S OWN OUTLINE. Same
           figure and same argument as the gap between two coves: a pocket four
           inches from the plaster leaves four inches of board between them, and
           that is not a detail anybody can build. A cove drawn across a wall, or
           outside the room altogether, fails the same test.
           REFUSED AND NOT NUDGED. Moving somebody's shape six inches so it
           qualifies is the app editing a drawing on their behalf; leaving it
           visible and inert is the app saying no where they can see it.
           ...AND IT IS THE OUTLINE THAT IS TESTED, NOT ITS BOUNDING BOX. The
           box test refused every concave cove in a concave room: an L-shaped
           room offset inward is an L-shaped cove, and an L's box covers the
           notch, which is outside the room by definition. So the shape was
           never taken up, and the drawing showed a setting-out line with no
           tape on it while the same gesture in a rectangular room worked. See
           `coveOutlineClearOfOutline`, which measures between the two outlines
           and catches the same three refusals this always caught. */
        .filter(({ outline }) => coveOutlineClearOfOutline(outline, polygonFt))
        /* AND TWO COVES MAY NOT COME WITHIN SIX INCHES OF EACH OTHER. Rings
           can be stopped short — they are a claim about ceiling and they give up
           the part they cannot have — but BOXES cannot: they are where the
           pockets go, and no growth rule moves them. Two of them overlapping is
           two design chunks covering the same ceiling; two of them four inches
           apart is a strip of plasterboard nobody can fix and a four-inch chunk
           on the drawing that can hold nothing.

           SO THE LATER ONE IS NOT TAKEN UP AS A COVE. It stays on the drawing,
           drawn as the setting-out line it is (see `lit` in coveShapesPx), so
           the refusal is visible and moving it apart undoes it. Refusing is the
           only honest answer here and refusing VISIBLY is the only useful one.
           See COVE_GAP_FT. */
        .filter(({ rect }) => {
          const clash = shapeBoxes.some((b) =>
            rect.x0 < b.x1 + COVE_GAP_FT - 1e-6 && b.x0 < rect.x1 + COVE_GAP_FT - 1e-6
            && rect.y0 < b.y1 + COVE_GAP_FT - 1e-6 && b.y0 < rect.y1 + COVE_GAP_FT - 1e-6);
          if (!clash) shapeBoxes.push(rect);
          return !clash;
        })
        .map(({ sh, rect, outline }, i, all) => {
          const out = {
            shape: sh, rect,
            /* --- THE RING OF CEILING THIS COVE OWNS ----------------------
               A DERIVED COVE HAS ONE AND A DRAWN ONE DID NOT, which is the
               whole of why a 7 W downlight could sit a foot outside a drawn
               cove's tape looking like a mistake. `coveOutside` keeps a fitting
               one foot off the line — right for a derived cove, where one foot
               out is inside its own dropped band and nothing goes there anyway,
               and far too generous for a drawn one, where one foot out is open
               ceiling.

               So the shape gets a host: its box grown into the room, one to four
               feet, snapping to a wall where one is in range. The ring between
               host and box is the cove's, marked dark like any other band. See
               coveHostFor for how each side is chosen, and for the honest
               difference — a derived cove's band is dropped plasterboard, this
               one is flat ceiling the cove happens to wash. */
            host: coveHostFor(rect, polygonFt, {
              // Walls it may run up to: the holes already in this ceiling.
              blocks: builtHolesFt,
              // ...and things it must keep six inches off: the rings already
              // fixed, and the boxes of the coves still to come.
              avoid: [...hostsSoFar, ...all.slice(i + 1).map((q) => q.rect)],
            }),
            outline,
            stripOutline: shapeOutlineFt(sh, STRIP_OFFSET_FT).map(localPt),
          };
          hostsSoFar.push(out.host);
          return out;
        })
        /* A COVE HAS TO HAVE AN INSIDE. Under a couple of feet across there is
           no ceiling left between the two sides of the pocket, which is the same
           refusal coveGeometry makes on a chunk about 4 ft wide — asked here
           because a shape this small must not become a chunk at all. It stays on
           the drawing and is simply not a cove yet; grow it and it becomes one. */
        .filter((c) => (c.rect.x1 - c.rect.x0) >= 2 && (c.rect.y1 - c.rect.y0) >= 2);

      const geo = {
        polygonPx, origin, toFt, toPx,
        polygonFt,
        /* THE SAME OUTLINE IN THE PLAN'S OWN FEET, which is the space the cove
           shapes live in — `polygonFt` above is room-local, measured from this
           room's bounding box. Two conversions of one outline is two things that
           can disagree, so the second one is stated here rather than done again
           inside a pointer handler on every frame. */
        polygonPlanFt: polygonPx.map((p) => ({ x: p.x / pxPerFt, y: p.y / pxPerFt })),
        fansInRoom: mine,
        /* EVERY OBJECT STANDING IN THIS ROOM, obstacle or not. `fansInRoom` is
           what the LAYOUT had to keep clear of; this is what is actually THERE,
           which is the question the schedule and the heatmap ask. See
           `obstaclesPx` in the signature for why they are two lists. */
        objectsInRoom: myObjects,
        // THE SHAPE TRAVELS WITH IT. A rectangular object hands the planner
        // its own w/h/rot so clearance is measured from its faces; anything
        // without a shape stays the circle it always was, which is every fan
        // the detector ever found.
        fixturesFt: mine.map((f) => ({
          // `type` stays 'fan' because that is what the planner filters on and
          // every obstacle is one as far as it is concerned. `kind` rides along
          // for everyone else: the chandelier veto on a task spot has to know
          // which of these is a chandelier, and nothing else can tell it.
          type: 'fan', kind: f.kind ?? 'fan', ...toFt(f), r: f.r / pxPerFt,
          ...(f.shape === 'rect'
            ? { shape: 'rect', w: f.w / pxPerFt, h: f.h / pxPerFt, rot: f.rot || 0 }
            : { shape: 'circle' }),
        })),
        // WHAT THE ZONE IS TRAVELS WITH WHERE IT IS. The conversion used to
        // return four numbers, and that is how a bed, a hole for a beam, an
        // enclosed room and a reverse cove arrived at the placers as the same
        // anonymous rectangle. They are not the same fact — a directional spot
        // may stand over a bed and may not stand in any of the others (see
        // SPOT_DEFAULTS.overBed) — and `cls`/`kind`/`source` is the only
        // evidence of which is which. Cheap to carry, impossible to recover.
        zonesFt: myZones.map((z) => {
          const a = toFt({ x: z.x0, y: z.y0 }), c = toFt({ x: z.x1, y: z.y1 });
          return { id: z.id, cls: z.cls, kind: z.kind, source: z.source,
                   x0: a.x, y0: a.y, x1: c.x, y1: c.y,
                   ...(z.polygon?.length ? { polygon: z.polygon.map(toFt) } : {}) };
        }),
        // THE SAME ROOM, WITHOUT THE FURNITURE. A bed is a no-light zone and a
        // no-light zone carves the room up — which is right for the grid (a
        // downlight over a pillow is the thing this app exists to avoid) and
        // wrong for a cove. A cove is BUILDING: a band dropped round the
        // perimeter, set out before anyone chose a bed and unaffected by which
        // wall it ends up against. Chunk a bedroom with the bed in it and the
        // "largest chunk" is whatever L-shaped remainder the mattress left, and
        // the cove would be drawn round that.
        //
        // So the cove is laid out on the room as BUILT — hand-drawn zones and
        // enclosed spaces kept, because those are holes in the ceiling itself,
        // and the detected beds dropped. The beds are still passed to the
        // planner as no-light zones, so the fittings inside the cove keep off
        // them exactly as they always did; it is only the SETTING OUT that
        // ignores them.
        /* THE ROOM AS BUILT: the holes hoisted above (see `builtHolesFt`)
           plus every drawn cove's RING. The ring and not the shape's own box —
           it belongs to the cove, it is dark ceiling the strip is lighting, and
           the chunker has to work around the whole of it. Handing over the box
           instead would cut the ordinary grid right up to the tape, which is the
           thing the ring exists to prevent. */
        coveZonesFt: [...builtHolesFt, ...shapeCoves.map((c) => c.host)],
      };

      // A KITCHEN IS LIT HARDER THAN A LIVING ROOM, AND AN OFFICE HARDER THAN
      // A HOUSE, and the only lever this engine has for either is the size of a
      // cell. See TARGET_AREA_BY_TYPE and TARGET_AREA_BY_PROJECT — the room's
      // own opinion and the building's, resolved to the denser of the two.
      //
      // IT HAS TO REACH THE CHUNKER TOO, not just the grid. The decompositions
      // are enumerated and scored against the cell they are expected to carry;
      // enumerate for 50 sqft cells and then lay 25 sqft ones on the winner and
      // the chunking chosen is the answer to a question nobody asked. So both
      // options objects carry the override, and a room whose type arrives after
      // it was first laid out re-enumerates — which is why `roomTypes` is a
      // dependency of this memo. A chunking the user had picked by hand is
      // resolved afresh below and falls back to the recommendation if the
      // denser reading no longer offers it.
      // `withTargetArea` RATHER THAN A SPREAD, and the difference is not
      // cosmetic. `opt` is a RESOLVED options object: targetCell, minCell and
      // maxCell are already materialised from the 50 sqft default, so
      // `{ ...opt, targetArea: 25 }` moved the area band and left all three
      // side dials describing a 7.07 ft cell — and the side dials are what
      // partitionAxis and evenCounts actually score. The helper drops them and
      // re-derives. `chunkOpt` needs no such care: it carries no side keys and
      // enumerateChunkings derives its own from whatever area it is handed.
      const cellArea = targetAreaFor(projectId, roomTypes[o.id]?.type);
      const roomOpt = cellArea ? withTargetArea(opt, cellArea) : opt;
      const roomChunkOpt = cellArea ? { ...chunkOpt, targetArea: cellArea } : chunkOpt;

      /* --- HOW THIS SPACE IS CUT UP, ENUMERATED ONCE --------------------
         IT WAS ENUMERATED TWICE, ON TWO DIFFERENT ROOMS, and the second one was
         always the authoritative one. `enumerateChunkings(polygonFt, zonesFt…)`
         produced the list the picker and the panel offered — the room with the
         FURNITURE cut out of it — while `designChunking(polygonFt,
         coveZonesFt…)` produced the chunks actually laid out, from the room as
         BUILT. Two readings of "how can this space be divided", answered about
         two different spaces, and only one of them reached the drawing.

         THAT WAS SURVIVABLE UNTIL A COVE COULD BE DRAWN, and it is not now. A
         hand-drawn cove is a hole in the middle of the ceiling; punch one into
         an L-shaped room and the decompositions genuinely change — a reading
         appears that did not exist before, the recommendation moves, and the
         two readings that kept their names come back with different rectangles.
         The panel was then offering two options where the drawing had three,
         marking the wrong one as live, and drawing chunks that were not on the
         sheet.

         SO THERE IS ONE ENUMERATION AND IT IS THE DESIGN'S. This is a DELETION
         rather than a new rule: nothing about the gridding changes, and the list
         that is now offered is the list that was already being used. The chunk
         picker, the glyphs in the Spaces list and the chunks on the drawing all
         read the same answer because there is only one.

         THE FURNITURE LEAVES THE OFFERED LIST WITH IT, and that follows the
         doctrine ceilingDesign.js already states rather than inventing one: a
         bed is a thing standing on the floor and has no opinion about where a
         band of plasterboard is set out. It still cuts the grid INSIDE a
         standard chunk — that is the second level of chunking, in
         planCeilingDesign, and it is untouched. What it no longer does is
         decide which readings of the CEILING somebody is offered. */
      const design = designChunking(geo.polygonFt, geo.coveZonesFt,
                                    roomChunkOpt, geo.fixturesFt,
                                    // A remembered intent, resolved afresh each
                                    // time: change the space enough that the
                                    // chosen reading no longer exists and the
                                    // recommendation takes over, rather than a
                                    // different reading quietly wearing the same
                                    // name. designChunking does that resolution
                                    // itself — see `chosenBy`.
                                    chunkPicks[o.id] ?? null);
      const chunking = design;
      const chosenId = design.chosenId;
      const picked = design.chosenBy === 'requested';

      /** What a light of this geometric kind is BOUGHT as in this room — and,
       *  in a bedroom, in this CELL. See fixtureForCell in roomTypes.js: a cell
       *  of 18 sqft or under takes the 5 W narrow lamp, because the foot-of-bed
       *  rule leaves a bedroom with rows of genuinely different depths and a
       *  36-degree cone over a shallow one lands on the wall. `cellSqft` is 0
       *  for a large light, which has no single cell, and the room-level answer
       *  stands for it. */
      const roomFixture = (kind, cellSqft = 0, narrow = false) =>
        fixtureForCell(projectId, roomTypes[o.id]?.type, kind, cellSqft, narrow);
      const cellSqftOf = (l) =>
        (l.kind === 'small' && l.cell ? l.cell.w * l.cell.h : 0);
      /* THE PLANNER'S VERDICT ON THE CELL, not this file's. `narrow` says the
         cell failed the gates this room's ordinary lamp's grid is judged by —
         see `cellMeetsGates` — and re-deriving it here from `w * h` would be a
         second copy of a rule that has side bounds as well as an area band. */
      const cellNarrowOf = (l) => !!(l.kind === 'small' && l.cell?.narrow);

      // --- THE CEILING ITSELF -------------------------------------------
      //
      // ONE DECISION PER PIECE OF CEILING. The space is cut into chunks by its
      // OWN OUTLINE — `coveZonesFt`, which keeps the holes in the ceiling and
      // drops the furniture standing under it, because a bed has no opinion
      // about where a band of plasterboard is set out — and each chunk carries
      // the design somebody chose for it. Standard chunks are then gridded the
      // ordinary way, furniture and all, so a plain rectangular bedroom comes
      // out exactly as it always did: one chunk, one grid, the bed still
      // cutting it up. See ceilingDesign.js.
      //
      // THE CHUNK PICKER'S CHOICE GOVERNS BOTH LEVELS. `chosenId` is a reading
      // of the space — bays across it, courses along it — and it is offered to
      // the design chunking and to the grid inside a standard chunk alike, so
      // one answer means one thing everywhere. The design chunking is resolved
      // above, where the readings are enumerated; this is the level below it.
      //
      // THE PICKS, WITH THE OLD STATE READ AS A LAST RESORT. See the note on
      // `ceilingKinds`: a space that has never been edited per chunk but was
      // coved under the old room-level switch puts its cove on the biggest
      // chunk, which is where that switch would have put it.
      const basePicks = designPicks[o.id]
        ?? (ceilingKinds[o.id] === 'cove' && design.chunks.length
            ? { [design.chunks[0].key]: 'cove' } : {});

      /* --- THE DRAWN COVES, AS CHUNKS ---------------------------------------
         ONE MORE PIECE OF CEILING PER SHAPE, and it arrives with its answer
         already on it. Everything the design machinery needs about a cove is in
         `coveGeo`, and it is the SHAPE's geometry rather than an inset of a
         chunk: the line is the rectangle the shape fits in, the strip is the
         outline that was drawn, and the band is EMPTY — because the ceiling
         outside this cove is not a band round it, it is the rest of the room,
         which the chunker has already cut into chunks of its own (see the hole
         added to `coveZonesFt` above).

         AN EMPTY BAND IS NOT A DEGENERATE CASE. It is what makes the ladder in
         cove.js come out right for a drawn shape: rung 1 is the strip carrying
         the space alone, rung 2 lights the ceiling inside the line, and rung 3
         — light the band too — has nothing left to light and is therefore the
         same answer as rung 2. Which is correct: there is no band. */
      const shapeChunks = shapeCoves.map((c) => {
        const w = c.rect.x1 - c.rect.x0, h = c.rect.y1 - c.rect.y0;
        const hw = c.host.x1 - c.host.x0, hh = c.host.y1 - c.host.y0;
        const sx = c.stripOutline.map((q) => q.x), sy = c.stripOutline.map((q) => q.y);
        const line = { ...c.rect, w, h, area: w * h };
        const host = { ...c.host, w: hw, h: hh, area: hw * hh };
        return {
          ...c.host, w: hw, h: hh, key: chunkKey(c.host), shapeId: c.shape.id,
          coveGeo: {
            /* ZERO INSET, AND IT STILL MEANS WHAT IT MEANT. `offset` is how far
               a DERIVED cove's line is set in from the chunk it was drawn in,
               and a drawn cove was not set in from anything — the shape is the
               line and the host was grown outward from IT. The number is kept at
               zero rather than back-filled with the ring's width, because the
               ring is not one width: see the per-piece lamp below. Nothing reads
               `offset` on a drawn cove except the band's default lamp, which
               every piece now overrides. */
            offset: 0,
            host, line,
            strip: { x0: Math.min(...sx), y0: Math.min(...sy),
                     x1: Math.max(...sx), y1: Math.max(...sy),
                     w: Math.max(...sx) - Math.min(...sx),
                     h: Math.max(...sy) - Math.min(...sy) },
            /* THE RING, CUT THE WAY EVERY OTHER BAND ON THIS APP IS CUT — two
               full-width runs and two shorter sides, by the same function a
               derived cove uses. Each piece names its own lamp off its own
               thickness, because the four are not the same width here. */
            band: bandBetween(host, line).map((b) => ({
              ...b, fixture: bandFixtureFor(Math.min(b.w, b.h)) })),
            // THE OUTLINE'S OWN LENGTH, not the rectangle's perimeter. A circle
            // 12 ft across is 39 ft of tape and its bounding square is 48; the
            // schedule bills what is installed.
            perimeterFt: pathLengthFt(c.stripOutline),
            /* THE CEILING THIS COVE IS ANSWERABLE FOR IS THE HOST, ring
               included, and that is what keeps the ring honest. `required` is
               `chunkAreaSqft * criteria`, so every foot of ceiling handed to
               the cove raises what it has to deliver — grow the ring too far and
               the ladder notices the strip cannot carry it and starts lighting
               the inside, then the ring itself. The margin polices itself. */
            chunkAreaSqft: hw * hh,
            innerAreaSqft: w * h,
            bandAreaSqft: hw * hh - w * h,
            smallerFt: Math.min(hw, hh),
            shapeId: c.shape.id, outline: c.outline, stripOutline: c.stripOutline,
          },
        };
      });
      const designChunks = shapeChunks.length
        ? [...design.chunks, ...shapeChunks] : design.chunks;
      // A DRAWN SHAPE IS NOT A PICK ANYBODY CAN CHANGE — see optionsForChunk,
      // which offers it nothing else — so its answer is written over whatever
      // the stored picks happen to say about a rectangle of the same size.
      const picks = shapeChunks.length
        ? { ...basePicks, ...Object.fromEntries(shapeChunks.map((c) => [c.key, 'cove'])) }
        : basePicks;
      const built = planCeilingDesign({
        polygonFt: geo.polygonFt,
        fixturesFt: geo.fixturesFt,
        zonesFt: geo.zonesFt,
        // THE SAME LIST THE DESIGN CHUNKING WAS GIVEN, and passing it twice is
        // the point rather than a duplication: these are the holes in the
        // ceiling, and a track keeping a foot off the walls has to count the
        // wall of an enclosed room exactly as the chunker counted it. Two
        // readings of "the room as built" would eventually disagree.
        builtZonesFt: geo.coveZonesFt,
        designChunks,
        picks,
        opt: roomOpt,
        chunkOpt: roomChunkOpt,
        strategy: chosenId,
        // WHERE SOMEBODY DRAGGED THIS ROOM'S LIGHTS TO. Handed to the layout
        // rather than applied to its answer — see the note in planner.js: a
        // hand position put on afterwards would leave that light the one
        // fitting out of line, because the rows would already have formed up
        // without it.
        handMoves: lightMoves[o.id] ?? null,
        // THE REASONING BEHIND EVERY ABSENCE, for an owner only — see `explain`.
        explain: isAdmin,
        criteria: lumenCriteriaFor(projectId, roomTypes[o.id]?.type),
        fixtureFor: roomFixture,
      });
      /* A DRAWN COVE IS NOT THE GRID'S — see AUTO_GRID. Every cove report that
         carries a `shapeId` came out of a shape somebody put on the ceiling by
         hand, and those keep their tape while the engine is off; the derived
         ones are the engine's answer and go with the rest of it. */
      const coves = built.coves.filter((c) => c.ok && (AUTO_GRID || c.shapeId));
      // THE TRACKS, WHICH ARE NOT FILTERED THE WAY THE COVES ARE. A cove report
      // carries `ok` because the ladder can run against a layout that failed;
      // a track is derived FROM a finished layout, so one exists only if there
      // was something to derive it from. What it can do instead is decline —
      // see `declined` in ceilingDesign.js — and a declined chunk simply has no
      // entry here.
      let tracks = built.tracks ?? [];
      let res = built.plan;
      // IT CAN DECLINE, AND THAT IS NOT AN ERROR STATE. A space whose own
      // outline gives the chunker nothing to work with falls back to the plain
      // layout on the room as a whole, which is the answer this app gave before
      // any of this existed.
      if (!res?.ok) {
        res = planLights(geo.polygonFt, geo.fixturesFt,
          { ...roomOpt, chunkStrategy: chosenId || 'auto',
            handMoves: lightMoves[o.id] ?? null }, geo.zonesFt);
        // AND THE TRACKS GO WITH THE LAYOUT THEY WERE SET OUT TO. Same argument
        // as `designChunksPx` being emptied here: these runs were placed through
        // fittings that are no longer on the drawing, so drawing them would be
        // drawing a profile through nothing.
        tracks = [];
      }

      /* --- AND NOW THROW THE GRID'S ANSWER AWAY -------------------------------
         See AUTO_GRID at the top of this file for why, and for why this blanks
         the ANSWER rather than skipping the run: `stats` is what the schedule,
         the exporters, the troubles list and the viewer all read, and it stays
         exactly the shape it has always been. What goes is what was placed.

         THE COUNTS IN `stats` GO WITH THE THINGS THEY COUNT. Leaving them would
         have the troubles list reporting that four cells are short of light in a
         room with no cells and no lights in it — a warning about a layout that
         is not on the drawing, which is the worst kind. `areaSqft`, `fans` and
         `avgCell` are facts about the ROOM and survive. */
      /* --- THE GRID SURVIVES THE BLANKING, AND ONLY THE GRID --------------
         WHAT `AUTO_GRID` IS ABOUT IS THE FITTINGS, and the block below throws
         the cells and the chunks away with them because everything that read
         them was counting or billing what stood IN them. One thing was not: the
         admin overlay, whose whole subject is how the ceiling was CUT — see
         `showGrid`, and `gridPath` in PlanCanvas. That switch has been drawing
         nothing since the day the lights were switched off, which is the wrong
         answer to "show me the grid without placing the lights": the chunker ran,
         it has an opinion, and the opinion is exactly what somebody laying lamps
         out by hand wants to see.
         SO THE GEOMETRY IS KEPT ASIDE, HERE, BEFORE IT GOES. It is deliberately
         NOT put back into `res`: everything downstream of that — `stats`, the
         schedule, the exporters, the troubles list — is counting a layout that is
         not on the drawing, and handing any of them cells again would have the
         troubles list reporting four dark cells in a room with no lights in it.
         These private grid fields are not the visible/billable `lights` and
         `cells`; the overlay and track allocator can inspect them without
         making the old automatic fittings reappear. */
      const gridChunks = res?.ok ? (res.chunks ?? []) : [];
      /* AND THE CELLS WITH THEM, for a second reader that arrived later: the
         autoplace rule needs one lamp per CELL, and the recommendation under the
         pointer needs the cell's area and its short side. Both are facts about
         how the ceiling divides rather than about what was placed on it, so they
         belong on this side of the blanking with the chunks. */
      const gridCells = res?.ok ? (res.cells ?? []) : [];
      /* THE FITTINGS THE GRID ACTUALLY CHOSE, kept separately from its cells.
         A large fitting can serve more than one cell, so one-per-cell is not
         the planner's answer. AUTO_GRID still removes these from the drawing;
         this private copy exists so a magnetic rail can inherit the same count
         and positions when it is being used for spots instead of ambient light. */
      const gridLights = res?.ok ? (res.lights ?? []) : [];

      if (!AUTO_GRID && res?.ok) {
        res = { ...res,
          chunks: [], omittedChunks: [], cells: [], lights: [],
          cededCells: [], awkwardCells: [],
          stats: { ...res.stats,
            chunks: 0, omittedChunks: 0, cells: 0, served: 0, dark: 0, unserved: 0,
            nudged: 0, awkward: 0, rescued: 0, outsideBand: 0, ceded: 0, offAxis: 0,
            alignedDiagonal: 0, clashes: 0, large: 0, small: 0 } };
        tracks = [];
      }

      /* --- THE TRACKS SOMEBODY DREW ------------------------------------------
         AFTER THE LAYOUT AND NOT BEFORE IT, which is not an implementation
         detail — it is the doctrine at the top of track.js, applied to a run
         whose position came from a hand rather than from a score. A cove
         changes the grid and has to be consulted first; a track changes
         nothing about it. The room is lit by exactly the downlights it would
         have had, and the profile is then drawn THROUGH them.

         THE PATH IS CLIPPED TO THIS ROOM'S FEET AND NOT TO THIS ROOM. A run
         drawn from the bedroom across the threshold into the dressing is one
         profile on site, and it is offered to both spaces here — each absorbs
         the fittings it owns and neither knows about the other's. What that
         costs is a length billed twice; what it buys is that the stretch over
         each room actually carries that room's lights. The length is settled
         below, per room, by the part of the path inside its polygon.

         IT CAN REACH NOTHING, AND THEN THERE IS NO TRACK HERE. `planDrawnTrack`
         returns null for a path that swallows no fitting, exactly as
         `planTrack` does — a profile with no head on it is a line, and billing
         one for a run that crossed a corner of this room on its way somewhere
         else would turn a geometric accident into an order. */
      if (res?.ok && manualTracks.length) {
        // THE PLAN'S FEET ARE NOT THE ROOM'S. A path is stored in the drawing's
        // own feet (see `manualTracks`) and the layout works from this room's
        // bounding box, so it converts once, here, rather than asking
        // absorbPoints to know about two coordinate spaces — the same move the
        // spot pass makes one screenful down.
        const toRoomFt = (q) => geo.toFt({ x: q.x * pxPerFt, y: q.y * pxPerFt });
        for (const mt of manualTracks) {
          /* A FITTING ALREADY ON A PROFILE IS NOT ON OFFER TO THE NEXT ONE, and
             two drawn runs crossing the same stretch of ceiling is an ordinary
             thing to draw. Nulled rather than filtered so the answer stays
             index-parallel to `res.lights` — `absorbPoints` skips a null point
             and returns a null verdict for it, which is exactly the reading
             wanted here. Whichever run was drawn first keeps the light. */
          const offer = res.lights.map((l) => (l.track ? null : l));
          // THE CLIP HAPPENS INSIDE, AGAINST `site.polygon`, so what follows is
          // numbered against the runs that are actually over this ceiling — see
          // `drawnRuns`. Nothing here re-derives the geometry.

          const t = planDrawnTrack(mt.ptsFt.map(toRoomFt), offer, roomOpt,
                                   /* THE SAME `site` THE CHOSEN TRACKS GET, and
                                      for the same three reasons: the polygon is
                                      what the run is cut down to, a head may
                                      not land in a keep-off zone, and no run
                                      may pass through a fan. A drawn run is
                                      held to the rules a derived one is held
                                      to — the hand chose where, not whether. */
                                   { polygon: geo.polygonFt,
                                     keepOff: geo.zonesFt,
                                     obstacles: geo.fixturesFt },
                                   { key: mt.id, id: mt.id, closed: !!mt.closed });
          if (!t) continue;
          /* THE FITTINGS MOVE ONTO THE PROFILE HERE, before the stamping below
             reads them. `lightFixture` swaps a recessed head for a module the
             moment it sees `track`, `gridPx` is drawn from `gridPos`, and a
             light on a run gets no drag band — all three already work off these
             fields, because this is the same shape `planTrack` leaves behind on
             a chunk that chose one. Nothing downstream learns that a person
             drew this one. */
          res = { ...res, lights: res.lights.map((l, i) => {
            const a = t.absorbed[i];
            if (!a) return l;
            /* `trackAxis` AND `trackAlong` ARE NOT DECORATION. A head is a
               300 x 38 mm module lying ALONG the profile, so the axis is what
               turns the mark through ninety degrees — without it every head on
               a vertical run is drawn across the run it is clipped into, which
               is a fitting that could not be installed. The exporters read the
               same field for the same reason. It was missing here while the
               chosen tracks set it in ceilingDesign.js, so drawn runs came out
               with their heads crossing them. */
            return { ...l, x: a.x, y: a.y, track: t.key, trackRun: a.run,
                     trackAxis: t.runs[a.run].axis, trackAlong: a.along,
                     // WHERE THE GRID PUT IT, kept for the reason the chosen
                     // track keeps it: the drawing shows the move, so the claim
                     // that nothing was re-planned is checkable rather than
                     // asserted.
                     gridPos: l.gridPos ?? { x: l.x, y: l.y } };
          }) };
          tracks = [...tracks, { ...t, drawn: true }];
        }
      }

      // WHAT EACH CHUNK IS, AND WHAT ELSE IT COULD BE, in plan pixels — the one
      // thing the canvas needs to draw the option pill. `pick` and `options`
      // ride along so the pill never has to ask the geometry anything.
      //
      // EMPTY WHEN THE FALLBACK RAN, because then these chunks are not what is
      // on the drawing: the fittings came from one grid over the whole space and
      // none of them carries a chunk key. A pill over a chunk no light belongs
      // to would offer a choice that changes nothing.
      /* THE SHAPE CHUNKS ARE NOT IN HERE, and that is what keeps the options
         pill off them. A pill over a drawn cove would offer one option — see
         optionsForChunk — which is a control that cannot do anything, parked on
         top of a shape that has a contextual menu of its own. */
      /* ...AND NO OPTION PILLS EITHER, WHILE THE GRID IS OFF. A pill offers to
         re-cut a piece of ceiling; with no fittings on it there is nothing for
         the re-cut to move, so it would be a control over an answer that is not
         on the drawing. See AUTO_GRID. */
      /* --- THE PIECES OF CEILING, KEPT ASIDE FROM THE PILL'S OWN LIST -------
         THE SAME SPLIT `gridChunksPx` MAKES, and it is here for the same reason:
         one list was answering two questions and got blanked for one reader's
         sake, silently breaking the other's.
         `designChunksPx` BELOW IS THE OPTION PILL'S — which chunk can be flipped
         through its arrangements — and it is rightly empty while the grid is
         off, because a pill offers to re-cut a piece of ceiling and there is
         nothing on it for the re-cut to move.
         THE ELECTRICAL PASS ASKS SOMETHING ELSE ENTIRELY: which pieces this
         ceiling is CUT INTO, because a piece over 25 sqft is switched from its
         own wall (see CHUNK_BOARD in lib/electrical.js, and `baysOfRoom`). That
         is true whether or not the suggestion engine placed anything — the cut
         is the chunker's, the fittings standing in it are the ones somebody laid
         by hand, and they still need a switch each.
         WHAT IT COST WAS THE SECOND BOARD. With the grid off, `baysOfRoom` fell
         through to "the whole space is one bay", that one bay adopted the plate
         beside the door, and a living-dining room cut into two — the exact case
         the bay pass was written for — came out with one switchboard and the
         sofa half switched from the far end of the room.
         NOT FOLDED BACK INTO `designChunksPx`, deliberately. Making that list
         survive would put a pill on every chunk with the grid off, which is the
         control-over-nothing the blanking exists to prevent. Two readers, two
         lists, each honest about its own question. */
      const bayChunksPx = !built.plan?.ok ? [] : built.parts
        .filter((p) => !p.chunk.shapeId)
        .map((p) => ({
          key: p.key,
          rect: { x0: p.chunk.x0 * pxPerFt + origin.x, y0: p.chunk.y0 * pxPerFt + origin.y,
                  x1: p.chunk.x1 * pxPerFt + origin.x, y1: p.chunk.y1 * pxPerFt + origin.y },
        }));

      const designChunksPx = (!AUTO_GRID || !built.plan?.ok) ? [] : built.parts
        .filter((p) => !p.chunk.shapeId)
        .map((p) => ({
        key: p.key, pick: p.pick,
        options: p.options.map((x) => ({ id: x.id, label: x.label })),
        /* WHAT WAS ASKED FOR, WHICH IS NOT ALWAYS WHAT IS ON THE DRAWING. An
           arrangement that declines leaves `pick` reading 'standard' — honestly,
           because Standard is what got built — and the pill indexes its list by
           what it reads. So flipping onto a declining track put the cursor back
           at the top of the list, and the next press went to the second entry
           again: right cycled between the first two options forever while left
           reached the last one. The arrows have to step from what you ASKED for.
           `order` is the same list before the layout pruned it (see
           `optionOrder`), so the sequence the arrows walk does not change shape
           depending on what the chunk currently is. */
        requested: p.declined ?? p.pick,
        order: p.optionOrder ?? p.options.map((x) => x.id),
        /* WHAT THIS CHUNK WAS NOT OFFERED, AND WHY. Computed only for an owner
           — see the `isAdmin` gate at the call site — because it is a question
           about the RULES rather than about the drawing, and a designer picking
           a ceiling does not need the pill reciting what it ruled out. It is
           also not free: seven predicates and a string per chunk, on every
           room, on every re-layout. */
        omitted: p.omitted ? p.omitted.map((x) => `${x.label} — ${x.why}`) : null,
        /* AND THE PIECE'S OWN SIZE, which is the first thing anybody asks when
           an option is missing and the one number the drawing does not state.
           `wFt`/`hFt` were already here and unread. It rides with `omitted`
           rather than being set unconditionally: the two are one card, and a
           size on its own would put a hover hint on every designer's pill for
           no reason. */
        sizeFt: `${Math.round(p.chunk.w * 10) / 10} × ${Math.round(p.chunk.h * 10) / 10} ft`,
        rect: { x0: p.chunk.x0 * pxPerFt + origin.x, y0: p.chunk.y0 * pxPerFt + origin.y,
                x1: p.chunk.x1 * pxPerFt + origin.x, y1: p.chunk.y1 * pxPerFt + origin.y },
        wFt: p.chunk.w, hFt: p.chunk.h,
      }));

      // WHICH CATALOGUE LINE ONE LIGHT IS, now that a chunk can have an opinion
      // of its own. The band outside a cove is lit with the 5 W narrow lamp
      // where it is too shallow for a 7 W — that is a property of the chunk the
      // light sits in, not of the room, so it wins over the room's own mapping.
      // See bandFixtureFor in cove.js.
      const chunkIndexOf = (l) => (l.kind === 'small' ? l.cell?.chunk : l.chunk);
      /**
       * WHICH CATALOGUE LINE ONE LIGHT IS.
       *
       * THREE OPINIONS, RESOLVED OUTWARDS. The room's type says what a `small`
       * light is bought as; the chunk overrides it where the band outside a cove
       * needs the narrow lamp; and the TRACK overrides both, because a fitting
       * clipped into a profile is a different product from a recessed one
       * whatever room it is in and whatever chunk it sits in. It is last because
       * it is the most specific: it is a fact about this one fitting, not about
       * its room or its piece of ceiling. See TRACK_FIXTURE in boq.js.
       */
      const lightFixture = (l) => {
        const base = res.chunks?.[chunkIndexOf(l)]?.coveFixture
          ?? roomFixture(l.kind, cellSqftOf(l), cellNarrowOf(l));
        return l.track ? trackFixtureFor(base) : base;
      };
      /**
       * WHICH DESIGN CHUNK PUT THIS LIGHT HERE.
       *
       * The chunk plan stamps every rectangle it hands the planner with the key
       * of the design chunk it came out of — a standard chunk's grid pieces, a
       * cove's inner rectangle, each of the four band runs. Carrying that stamp
       * out onto the drawn fitting is what makes the whole interface possible:
       * click a downlight and the pill knows which piece of ceiling's options it
       * is flipping through, with nothing to hit-test and no geometry to redo.
       */
      const lightDesign = (l) => res.chunks?.[chunkIndexOf(l)]?.design ?? null;

      /** A feet-space rectangle as its four corners in plan pixels, in order.
       *  Both the cove line and the tape round it are drawn as closed runs, and
       *  a closed run is a point list rather than a box. */
      const corners = (R) => [{ x: R.x0, y: R.y0 }, { x: R.x1, y: R.y0 },
                              { x: R.x1, y: R.y1 }, { x: R.x0, y: R.y1 }].map(toPx);

      const rectToPx = (c) => ({ ...c,
        x0: c.x0 * pxPerFt + origin.x, x1: c.x1 * pxPerFt + origin.x,
        y0: c.y0 * pxPerFt + origin.y, y1: c.y1 * pxPerFt + origin.y });
      /* A CHUNK IS A RECTANGLE PLUS THE LINES IT WAS DIVIDED ON, and it is
         converted in two places now — the layout's own list and the grid the
         admin overlay reads, which are the same list except while the lights are
         switched off. Written once so the two cannot drift. */
      const chunkToPx = (ch) => ({
        ...rectToPx(ch),
        xLines: ch.xLines.map((x) => x * pxPerFt + origin.x),
        yLines: ch.yLines.map((y) => y * pxPerFt + origin.y),
      });

      const plan = !res.ok ? { ...res, polygonPx } : {
        ...res,
        // The same stamp on the feet-space list, because the BOQ reads
        // `plan.lights` and the canvas reads `plan.lightsPx`, and a fixture that
        // is drawn small but billed as the 7 W line is the worst of both.
        lights: res.lights.map((l) => ({ ...l, fixture: lightFixture(l) })),
        polygonFt: geo.polygonFt, polygonPx, origin, toPx,
        chunksPx: res.chunks.map(chunkToPx),
        /* THE CHUNKER'S OWN READING OF THIS CEILING, whether or not anything was
           placed on it. The same conversion as `chunksPx` above and usually the
           same list — they part company only while `AUTO_GRID` is off, which is
           the whole reason this exists. Read by the admin grid overlay and by
           nothing else; see the note where `gridChunks` is captured. */
        gridChunksPx: gridChunks.map(chunkToPx),
        /* THE CELLS THE CHUNKER CUT, whether or not anything stands in them.
           Same conversion as `cellsPx` above and usually the same list — they
           part company only while the lights are switched off. Note what
           `rectToPx` does and does not touch: the BOUNDS come out in pixels and
           `w`, `h`, `cx`, `cy` stay in the room's own FEET, which is what lets
           the autoplace rule read an area and a short side straight off one of
           these without a division. */
        gridCellsPx: gridCells.map(rectToPx),
        /* AND WHAT EACH OF THE GRID'S OWN FITTINGS WOULD BE BOUGHT AS.
           `lightFixture` IS THE WRONG READER FOR THIS LIST and that is not a
           style point. It resolves the cove-band override off `res.chunks`,
           which is the list the blanking above has just emptied — so with the
           grid switched off every one of these came back as the room's plain
           mapping, and the 5 W narrow lamp in the shallow band outside a cove
           was reported as a 7 W. `gridChunks` is that same list kept aside, so
           the answer is the one the engine actually gave either way.
           IT IS HERE BECAUSE THE SUGGESTION LAYER DRAWS FROM IT. A downlight's
           symbol is sized by the PRODUCT and not by the geometry (see the
           `fx === 'small-narrow'` in PlanCanvas), so a proposal drawn without
           this would be the right positions at the wrong sizes — which is the
           one thing a drawing offered as "what the engine would do" may not be.
           The track allocator that already reads this list takes positions and
           cells only and is untouched by the extra field. */
        gridLightsPx: gridLights.map((l) => {
          const base = gridChunks[chunkIndexOf(l)]?.coveFixture
            ?? roomFixture(l.kind, cellSqftOf(l), cellNarrowOf(l));
          return { ...l, ...toPx(l),
                   fixture: l.track ? trackFixtureFor(base) : base };
        }),
        cellsPx: res.cells.map(rectToPx),
        // WHAT EACH LIGHT IS BOUGHT AS, stamped here because this is the one
        // place that knows both the layout and the room's type. The planner
        // deals in `kind` (geometry) and never in products; see FIXTURE_BY_TYPE.
        lightsPx: res.lights.map((l) => ({ ...l, ...toPx(l),
          fixture: lightFixture(l),
          design: lightDesign(l),
          // WHERE THE GRID PUT IT, for a fitting a track has since pulled onto
          // its profile. `l.x/l.y` above is the fitting's real position — the
          // one that gets set out, exported and billed — and this is the claim
          // the whole option rests on, drawn: the grid did not change, the
          // fitting slid onto the run. Absent on every light no track touched.
          gridPx: l.gridPos ? toPx(l.gridPos) : null,
          centrePx: l.cell ? toPx({ x: l.cell.cx, y: l.cell.cy }) : null,
          /* --- HOW FAR THIS ONE MAY BE MOVED, AND WHAT NAMES IT ------------
             `cellKey` is the handle: it is what an override is stored against
             and what a selection is, and it is the cell's geometry rather than
             the light's id for the reason `lightMoves` gives.

             `bandPx` is `centreBand` drawn — the box the grid allows this
             fitting, in the drawing's own pixels. It is on the LIGHT and not on
             the cell because it is a fact about the fitting's freedom, and
             because the cell it belongs to is one of hundreds the canvas is not
             otherwise given.

             ONLY WHERE THERE IS FREEDOM TO HAVE. A large light is fixed on one
             axis by the grid line it sits on and may only take discrete anchors
             on the other, so it has no box; a head a track has absorbed is set
             out to the profile, and dragging it would be arguing with the run
             it is clipped into. Both come through with `bandPx` null, and the
             canvas offers no grip on a light that has none. */
          cellKey: l.cell ? cellKey(l.cell) : null,
          bandPx: (l.kind === 'small' && l.cell && !l.track)
            ? (() => { const b = centreBandBox(l.cell, roomOpt);
                       const a = toPx({ x: b.x0, y: b.y0 }), c = toPx({ x: b.x1, y: b.y1 });
                       return { x0: a.x, y0: a.y, x1: c.x, y1: c.y }; })()
            : null,
          coverPx: l.cells.map((id) => {
            const c = res.cells.find((x) => x.id === id);
            return c ? toPx({ x: c.cx, y: c.cy }) : null;
          }).filter(Boolean) })),
        fansFt: geo.fixturesFt,
        // The obstacles in this room, in IMAGE PIXELS. The feet above are
        // room-local — measured from this room's own bounding box — which is
        // exactly what the planner wants and exactly what an export cannot use:
        // eight rooms each measuring from their own corner would stack eight
        // layouts on top of each other at the origin. Pixels are the one space
        // every room already shares, so the exporters work from these and the
        // scale. See roomInFeet in exporters.js.
        zonesPx: myZones,
        fansPx: mine,
        // THE COVE SETTING-OUT LINES, in plan pixels. They ride on the plan
        // rather than being handed to the canvas separately because everything
        // else the canvas draws for a room already does — one prop, one room —
        // and because a cove line without the layout it cut is a rectangle
        // floating over somebody's drawing.
        //
        // A LIST, BECAUSE A SPACE CAN CARRY SEVERAL. An L-shaped room coved over
        // both ends has two bands, set out square, exactly as they would be
        // built. Each line carries the key of the chunk it belongs to, so
        // clicking one opens that chunk's options — which is the only way back
        // for a chunk whose cove is carrying the space on its own and therefore
        // has no downlight left to click.
        /* THE OUTLINE WHERE THERE IS ONE, THE RECTANGLE WHERE THERE IS NOT.
           A cove this app set out is a rectangle and `line` describes it; a cove
           somebody drew is a shape, and `outline` is that shape. The canvas
           draws whichever it is handed as a closed run of points and does not
           need to know which — a polygon is a polygon. `shapeId` rides along so
           a press on the line can pick the shape up rather than open a chunk's
           options, which is the one thing that DOES differ. */
        covesPx: coves.map((c) => ({
          key: c.key, offset: c.offset, shapeId: c.shapeId ?? null,
          line: c.outline ? c.outline.map(toPx) : corners(c.line),
        })),
        // THE TRACK RUNS, in plan pixels, and they ride on the plan for exactly
        // the reasons `covesPx` does: one prop per room, and a profile without
        // the layout it was set out through is a line floating over somebody's
        // drawing. Each run carries the key of the chunk that owns it, so
        // clicking one opens that chunk's options — the way back for a track
        // whose fittings have all been absorbed and are therefore drawn ON it.
        tracksPx: tracks.map((t) => ({
          key: t.key, id: t.id, label: t.label, short: t.short,
          /* WHETHER A HAND PUT IT THERE, and it is the one thing about a track
             the canvas has to know the provenance of. A chosen track's rail
             opens its chunk's options when you click it — the way back for a
             piece of ceiling whose fittings are all on the profile — and a
             drawn one has no chunk and no options: what it has is a path, and
             double-clicking it opens the points. See `trackEditId`. */
          drawn: !!t.drawn,
          closed: t.closed, corners: t.corners, pieces: t.pieces,
          lengthFt: t.lengthFt,
          runs: t.runs.map((rn) => ({ a: toPx(rn.a), b: toPx(rn.b),
                                      side: rn.side, axis: rn.axis })),
        })),
      };

      /**
       * THE COVE AS A FITTING, in the plan's own pixels.
       *
       * ONE ZONE AND NOT FOUR. A cove turns the corner and carries on, so it is
       * one continuous run of tape — `loop` holds the four corners and whatever
       * draws it closes the circuit. Four separate runs would look right until
       * you counted them: the schedule bills strip by the metre AND reports the
       * number of pieces, because pieces is what tells a contractor how many
       * drivers and end caps to buy, and a single cove is one of each.
       *
       * It is shaped like every other accent zone on purpose — same `type`,
       * same `rect`, same `runLength` — so the canvas, the schedule and the
       * exporters all take it without knowing a cove exists.
       */
      const coveStrips = res.ok ? coves.map((c) => {
        // THE TAPE, NOT THE LINE — see STRIP_OFFSET_FT in cove.js. The run is
        // three inches outside the setting-out line, in the pocket, which is
        // both where it is installed and the length that gets billed.
        // ...and round a drawn shape it is the shape's own offset outline, for
        // the same reason: three inches out, in the pocket, whatever the shape.
        const pts = c.stripOutline ? c.stripOutline.map(toPx) : corners(c.strip);
        const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
        return {
          // THE CHUNK'S KEY IN THE ID, because a space can now hold more than
          // one cove and two runs called `cove-<room>` are one run as far as the
          // schedule and the exporters are concerned.
          id: `cove-${o.id}-${c.key}`, type: 'strip', kind: 'cove', roomId: o.id,
          source: 'cove', label: 'Cove LED strip',
          /* WHICH DRAWN SHAPE THIS TAPE BELONGS TO, or null for a cove the
             ceiling design derived. It rides along so the tape can be a HANDLE
             on the shape: selecting the run and pressing Delete is the obvious
             way to remove a cove somebody drew, and without this the only thing
             the key could reach was a strip that is not an object in its own
             right. See the accent delete branch. */
          shapeId: c.shapeId ?? null,
          loop: pts,
          runLength: c.perimeterFt * pxPerFt,
          rect: { x0: Math.min(...xs), y0: Math.min(...ys),
                  x1: Math.max(...xs), y1: Math.max(...ys) },
        };
      }) : [];

      out.push({
        id: o.id, outline: o, region, geo, chunking, plan,
        chosenId, chunkingChosenBy: picked ? 'user' : 'recommended',
        // The ceiling, chunk by chunk. `design` is how the space was cut up,
        // `designChunksPx` is what the canvas draws the option pills from, and
        // `coves` holds one report per cove — what the ladder decided, what the
        // strip delivers, how long the run is.
        ceiling: coves.length ? 'cove' : tracks.length ? 'track' : 'standard',
        // `tracks` IS IN FEET AND THAT IS DELIBERATE. The canvas reads
        // `plan.tracksPx`; this is what the SCHEDULE reads, and a schedule
        // measuring a profile off plan pixels would be measuring it off the
        // zoom. See buildBOQ, which takes the length from here.
        design, designChunksPx, bayChunksPx, coves, coveStrips, tracks,
        stats: outlineStats(o, pxPerFt),
      });
    }
    return out;
}
