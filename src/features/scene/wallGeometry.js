import { regionFromOutline } from '../../lib/outline.js';
import { wallHostFor } from '../../lib/electrical.js';
import { gridFor } from '../../lib/wallGrid.js';
import { reverseCovesFor, mergeReverseCoves, trimWallRun } from '../../lib/reverseCove.js';
import { shelfStripsFor } from '../../lib/shelfStrip.js';

/**
 * EVERY ROOM'S WALLS, AS A HOST — `roomId` -> what `wallHostFor` gives.
 *
 * WHAT ASKS FOR IT. Anything seated on the plaster rather than dropped on the
 * ceiling: a split AC's indoor unit stores how far round the walls it sits and
 * resolves its position and its ANGLE from them every frame — see
 * lib/wallUnit.js — and so does the point or socket that feeds it.
 *
 * FROM THE OUTLINES AND NOT FROM `rooms`, WHICH IS THE SAME CYCLE `buildReverseCoves`
 * BELOW AVOIDS AND FOR THE SAME REASON. The obstacle projection is what the
 * LAYOUT consumes, and `rooms` is what the layout produces; a host index built
 * over `rooms` could not be handed to the projection that feeds it. It does not
 * need one — a room's wall path comes from its OUTLINE and the scale, both of
 * which exist long before anything is lit.
 *
 * AND IT IS THE SAME POLYGON THE LAYOUT WILL USE, down to the bounding-rect
 * switch: `regionFromOutline` is the call layout.js makes and `useBoundingRect`
 * is the same flag it reads. That is what lets a unit's seat and the wall point
 * behind it resolve against one path rather than two that nearly agree.
 *
 * A MAP AND NOT A LIST, because every reader has a `roomId` in hand and wants
 * the walls for it. `null` for a room whose outline will not close, which is
 * the answer `resolveWallUnitPx` turns into "this one is not drawn".
 */
export function buildWallHosts({ source, pxPerFt, litOutlines = [], useBoundingRect }) {
  const hosts = new Map();
  if (!source || !pxPerFt) return hosts;
  for (const o of litOutlines) {
    const region = regionFromOutline(o, pxPerFt);
    if (!region?.ok) continue;
    const polygonPx = useBoundingRect ? region.boundingRect : region.polygon;
    hosts.set(o.id, wallHostFor(polygonPx, pxPerFt));
  }
  return hosts;
}

/**
 * THE REVERSE COVES, from the render pass's panelling and wallpaper.
 *
 * COMPUTED FROM THE OUTLINES AND NOT FROM `rooms`, and that is load-bearing
 * rather than tidy. A reverse cove is a no-light zone, no-light zones go into
 * the planner, and the planner is what builds `rooms` — so a memo over `rooms`
 * would be a cycle. It does not need one: the grid a cove is measured against
 * comes from the room's OUTLINE and the scale, both of which exist long before
 * anything is lit, and `regionFromOutline` is the same call the layout makes.
 *
 * See reverseCove.js for the rule. Merged, because a wall that came back both
 * panelled and papered is one wall and would otherwise get two bands in the
 * same eight inches of ceiling — drawn as one, billed as two.
 */
export function buildReverseCoves({
  source, pxPerFt, litOutlines, wallResults, useBoundingRect, doors, runTrims,       manualCoves,
  runsOff
}) {
  if (!source || !pxPerFt) return [];
  const out = [];
  for (const o of litOutlines) {
    const res = wallResults[o.id];
    if (!res?.elements?.length) continue;
    const region = regionFromOutline(o, pxPerFt);
    if (!region?.ok) continue;
    const polygonPx = useBoundingRect ? region.boundingRect : region.polygon;
    const grid = gridFor(polygonPx, pxPerFt);
    if (!grid) continue;
    const mine = [];
    for (const e of res.elements) {
      // A LIST PER ELEMENT, because a wall with a door in it is two walls.
      // `doors` is the whole sheet's detections — the ones already found to
      // set the scale — and reverseCovesFor picks out the ones in this wall.
      const got = reverseCovesFor(e, grid, { pxPerFt, doors });
      got.forEach((rc, i) => mine.push({
        ...rc, roomId: o.id, elementId: e.id,
        id: `rcove-${e.id}-${i}`,
      }));
    }
    // MERGE FIRST, THEN TRIM. The merge decides which coves exist and what
    // their ids are; a trim is keyed to an id, so trimming before it would
    // apply somebody's drag to a run that is about to be absorbed into
    // another one.
    for (const c of mergeReverseCoves(mine, { pxPerFt })) {
      // ...AND NOT THE ONES SOMEBODY DELETED. Filtered here rather than where
      // the tape is shaped, because the tape is not the thing: a reverse cove
      // is 200mm of ceiling detail with a strip at its lip, and dropping only
      // the strip would leave the slot drawn on the plan with nothing in it.
      // See `runsOff`.
      if (runsOff.includes(c.id)) continue;
      out.push(trimWallRun(c, runTrims[c.id], { pxPerFt }));
    }
  }
  /* THE HAND-PLACED ONES JOIN HERE, AFTER THE MERGE AND THROUGH THE SAME TRIM.
     After the merge on purpose: `mergeReverseCoves` decides which detected
     coves exist and what they are called, and feeding a manual slot into it
     would let a detection absorb something a person set out by hand — the id
     would vanish and with it their edit. Through `trimWallRun` because that is
     what gives a run its draggable ends, and a hand-placed cove wanting the
     same grips as a detected one is the whole reason its shape matches.

     ONLY IN ROOMS THAT STILL EXIST. A cove is placed against a room's own
     wall; delete or re-trace the room and the slot has nothing to be on. It is
     filtered rather than deleted, so re-lighting the space brings it back. */
  const live = new Set(litOutlines.map((o) => o.id));
  for (const c of manualCoves) {
    if (!live.has(c.roomId)) continue;
    out.push(trimWallRun(c, runTrims[c.id], { pxPerFt }));
  }
  return out;
}

/**
 * THE SHELF STRIPS, from the render pass's shelving.
 *
 * NOT A NO-DRAW AREA, unlike the reverse cove beside it, and the difference is
 * the difference between the two fittings. A reverse cove is a slot cut in the
 * CEILING: eight inches of it are gone and nothing else can go there. A shelf
 * strip is tape inside a piece of joinery standing against the wall — the
 * ceiling above it is ordinary ceiling, and a downlight in front of the unit is
 * a perfectly good thing to have. So this list is drawn and billed and changes
 * nothing about the layout.
 *
 * Same reason as the reverse coves for computing it off the OUTLINES: it does
 * not need `rooms`, and not depending on it keeps the two memos independent.
 */
export function buildShelfStrips({
  source, pxPerFt, litOutlines, wallResults, useBoundingRect, doors, runTrims,       runsOff
}) {
  if (!source || !pxPerFt) return [];
  const out = [];
  for (const o of litOutlines) {
    const res = wallResults[o.id];
    if (!res?.elements?.length) continue;
    const region = regionFromOutline(o, pxPerFt);
    if (!region?.ok) continue;
    const polygonPx = useBoundingRect ? region.boundingRect : region.polygon;
    const grid = gridFor(polygonPx, pxPerFt);
    if (!grid) continue;
    for (const e of res.elements) {
      shelfStripsFor(e, grid, { pxPerFt, doors }).forEach((st, i) => {
        const id = `shelf-${e.id}-${i}`;
        // The same deletion the reverse coves answer to, and for the same
        // reason: nothing stores a shelf strip, so a deleted one has to be
        // recorded or it comes back on the next render. See `runsOff`.
        if (runsOff.includes(id)) return;
        out.push(trimWallRun({ ...st, roomId: o.id, elementId: e.id, id },
                             runTrims[id], { pxPerFt }));
      });
    }
  }
  return out;
}

/**
 * A WARDROBE IS A NO-LIGHT ZONE, on the same terms as a bed.
 *
 * A DOWNLIGHT OVER A WARDROBE LIGHTS THE TOP OF THE WARDROBE. It is a foot and
 * a half of dust-catcher at head height and the light lands on it, so the
 * fitting is spent on the one square metre of the room nobody looks at, and
 * the wall the wardrobe is on gets its light from the strip inside the unit —
 * which is why the strip is there. This is the same argument the bed makes
 * (nobody wants a downlight over a pillow) reaching the same list.
 *
 * DERIVED, NOT DRAWN, exactly like the beds. `drawnZones` is hand-drawn zones
 * and enclosed spaces only — see the note there about a hatched box over
 * somebody's bed on a sheet handed to a client. The zone moves the fittings
 * and does not argue about it on the drawing.
 *
 * IT ARRIVES AFTER THE FIRST LAYOUT, and that is fine and worth stating. The
 * accent pass runs on a space that is already lit, so the lights move once
 * when its answer lands — the same way they move when somebody boxes a zone
 * by hand. Nothing loops: `accentResults` is a stored answer, not a
 * derivation of the layout, so a re-layout does not re-run the pass.
 */
export function buildWardrobeZones({ wardrobesPx }) {
  return wardrobesPx.map((w) => ({ id: w.id, roomId: w.roomId, ...w.rect,
                                  kind: 'wardrobe' }));
}

/**
 * ...and as no-light zones, which is how "a reverse cove is a no-draw area"
 * is actually enforced.
 *
 * Not by a new rule in every placer — there are four of them and they would
 * drift — but by the band joining the shared list of zones that every placer
 * in this app already keeps out of. An angled band keeps its polygon as well as
 * its bounding box, so the two large triangles beside it remain usable ceiling.
 */
export function buildReverseCoveZones({ reverseCoves }) {
  return reverseCoves.map((c) => ({ id: c.id, roomId: c.roomId, ...c.rect,
                                   polygon: c.band,
                                   kind: 'reverse-cove' }));
}

// Hand-drawn zones and detected ones behave identically from here on — that
// was the point of making a detection produce a rectangle rather than a new
// kind of obstacle. So do the reverse coves.
export function buildZoneList({ zones, detectedZones, wardrobeZones, reverseCoveZones }) {
  return [...zones, ...detectedZones, ...wardrobeZones, ...reverseCoveZones];
}
