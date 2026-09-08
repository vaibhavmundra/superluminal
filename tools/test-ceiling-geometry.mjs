/**
 * THE PURE HALF OF features/ceiling-geometry/.
 *
 * Which shape a press lands on, whether the tool in hand would take it, where a
 * slot's two ends go, the path an array is set out on, the four states of the
 * floating bar, how far a borrowed draft is being offset, what a finished pen
 * path stores, and why a drawn run is not on the plan. None of it needs React,
 * a canvas or a pointer — the hooks around it hold nothing but dependency
 * arrays — which is why it is out of the controller and can be checked here.
 *
 * The numbers follow the other geometry scripts: a 600x360 px room at 30 px/ft,
 * so the room is 20 ft by 12 ft and one foot is thirty pixels.
 *
 *   node tools/test-ceiling-geometry.mjs
 */
import assert from 'node:assert/strict';
import {
  roomForSlotAt, shapeUnderPoint, takeableGeometry, slotSpan, arrayOutlineFor,
  trackRefusals, groupTrackRefusals, shapeBarMode, offsetGapFt,
  trackPtsFromSegments,
} from '../src/features/ceiling-geometry/geometryRules.js';
import { TRACK_REFUSALS } from '../src/lib/track.js';
import { lineShape } from '../src/lib/ceilingShapes.js';

const PPF = 30;
const px = (ft) => ft * PPF;
const polyPx = (x0, y0, x1, y1) => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const polyFt = (x0, y0, x1, y1) => polyPx(x0, y0, x1, y1);

/** A lit space, in the shape the rules are handed. 20 ft x 12 ft at 30 px/ft. */
const ROOM = {
  id: 'r1',
  outline: { name: 'Living' },
  geo: {
    polygonPx: polyPx(0, 0, 600, 360),
    polygonPlanFt: polyFt(0, 0, 20, 12),
    polygonFt: polyFt(0, 0, 20, 12),
    zonesFt: [], fixturesFt: [],
    toFt: (p) => ({ x: p.x / PPF, y: p.y / PPF }),
  },
  plan: { ok: true, polygonPx: polyPx(0, 0, 600, 360), lights: [] },
};

/** A second space, well away from the first. */
const OTHER = {
  ...ROOM, id: 'r2', outline: { name: 'Study' },
  geo: { ...ROOM.geo,
         polygonPx: polyPx(900, 0, 1200, 300),
         polygonPlanFt: polyFt(30, 0, 40, 10),
         polygonFt: polyFt(30, 0, 40, 10) },
  plan: { ok: true, polygonPx: polyPx(900, 0, 1200, 300), lights: [] },
};

const rect = (id, x, y, wFt, hFt, extra = {}) =>
  ({ id, kind: 'rect', x, y, wFt, hFt, rot: 0, radiusFt: 0, ...extra });

// --- which space a slot starts in ------------------------------------------

{
  // INSIDE THE POLYGON is the easy half.
  assert.equal(roomForSlotAt([ROOM], { x: 10, y: 6 }, PPF)?.id, 'r1');

  // ON THE WALL IS THE POINT OF IT. A press aimed at a wall lands outside the
  // polygon as often as inside it, so containment alone would refuse the most
  // natural way to begin the gesture.
  assert.equal(roomForSlotAt([ROOM], { x: -0.5, y: 6 }, PPF)?.id, 'r1',
    'half a foot outside the wall still names the room');
  assert.equal(roomForSlotAt([ROOM], { x: -1.9, y: 6 }, PPF)?.id, 'r1',
    'just inside the two-foot reach');

  // ...AND NOT FURTHER. A press further than a couple of feet from any wall is
  // not aimed at one.
  assert.equal(roomForSlotAt([ROOM], { x: -2.5, y: 6 }, PPF), null);

  // THE NEAREST WALL WINS when two rooms are in reach of the point.
  assert.equal(roomForSlotAt([OTHER, ROOM], { x: 21, y: 6 }, PPF)?.id, 'r1');

  // No scale, no answer: the conversion has nothing to work with.
  assert.equal(roomForSlotAt([ROOM], { x: 10, y: 6 }, 0), null);
}

// --- the hit test ------------------------------------------------------------

{
  const shapes = [rect('s1', 5, 5, 4, 4), rect('s2', 5, 5, 10, 10)];

  // FIRST MATCH IN THE LIST, which is the order the shapes were drawn in — not
  // the smallest, which would be a rule about area on objects that are very
  // often the same size.
  assert.equal(shapeUnderPoint(shapes, { x: px(5), y: px(3) }, PPF)?.id, 's1',
    'the point is on s1’s top edge and inside s2; the earlier one wins');

  // THE TOLERANCE IS IN SCREEN PIXELS AND CONVERTED — a floor of 8 px or 0.4 of
  // a foot's worth of pixels, whichever is larger.
  const justOff = { x: px(5), y: px(3) - 7 };
  assert.equal(shapeUnderPoint([rect('s1', 5, 5, 4, 4)], justOff, PPF)?.id, 's1',
    'seven screen pixels off the line is still a hit');
  const wellOff = { x: px(5), y: px(3) - 20 };
  assert.equal(shapeUnderPoint([rect('s1', 5, 5, 4, 4)], wellOff, PPF), null);

  assert.equal(shapeUnderPoint(shapes, null, PPF), null);
  assert.equal(shapeUnderPoint(shapes, { x: 0, y: 0 }, 0), null);
}

// --- ...and whether the tool in hand would take it --------------------------

{
  const cove = rect('c', 5, 5, 4, 4);                        // role defaults to cove
  const guide = rect('g', 5, 5, 4, 4, { role: 'guide' });
  const track = rect('t', 5, 5, 4, 4, { role: 'track' });

  // THE COB ARRAY TAKES ANY GEOMETRY: it references the line and builds nothing
  // from it, so there is nothing for the line's role to clash with.
  for (const sh of [cove, guide, track]) {
    assert.equal(takeableGeometry(sh, { addTool: 'cob', cobMode: 'array' }), sh);
  }
  // ...and in manual mode a geometry under the pointer is scenery.
  assert.equal(takeableGeometry(cove, { addTool: 'cob', cobMode: null }), null);

  // A MODULE WANTS A TRACK AND NOTHING ELSE WILL DO — the narrowest of the
  // three. This is the rule tools/test-mag-track.mjs's truth table is about.
  assert.equal(takeableGeometry(track, { addTool: 'module' }), track);
  assert.equal(takeableGeometry(guide, { addTool: 'module' }), null);
  assert.equal(takeableGeometry(cove, { addTool: 'module' }), null);

  // THE SHAPE TOOL TAKES A GEOMETRY OF THE OTHER ROLE, AND ONLY THAT. Armed to
  // draw a cove it will span one from a guide; it must not swallow the cove
  // already there, because a press inside one is how a second is drawn across
  // it. The rule reads symmetrically.
  const barCove = { shapeMenuOn: true, shapeRole: 'cove' };
  assert.equal(takeableGeometry(guide, barCove), guide);
  assert.equal(takeableGeometry(track, barCove), track);
  assert.equal(takeableGeometry(cove, barCove), null);
  const barGuide = { shapeMenuOn: true, shapeRole: 'guide' };
  assert.equal(takeableGeometry(cove, barGuide), cove);
  assert.equal(takeableGeometry(guide, barGuide), null);

  // THE BAR BEING OPEN IS ENOUGH — it does not have to be armed. That is the
  // whole flow for a magnetic track: open the bar from the rail, press the
  // guide you want to be a run.
  assert.equal(takeableGeometry(guide, { shapeMenuOn: true, shapeRole: 'track' }), guide);

  // `null` WITH NOTHING ARMED, so a press on a shape with no tool in hand still
  // means what it always meant: pick it up.
  assert.equal(takeableGeometry(cove, {}), null);
  assert.equal(takeableGeometry(null, barCove), null);
}

// --- the slot in flight, and why it is refused when it is --------------------

{
  const base = { shapeTool: 'line', rooms: [ROOM], shapeRole: 'cove' };

  // NOTHING TO ANSWER ABOUT: no tool, no anchor or no pointer.
  assert.deepEqual(slotSpan({ ...base, shapeTool: 'rect', shapeSpan: {}, shapeAt: {} }),
    { shape: null, why: '' });
  assert.deepEqual(slotSpan({ ...base, shapeSpan: null, shapeAt: { x: 1, y: 1 } }),
    { shape: null, why: '' });

  // A COVE LINE HAS TO LAND ON TWO WALLS. Wall to wall across the room is the
  // ordinary case and it produces a shape.
  const across = slotSpan({ ...base,
    shapeSpan: { aFt: { x: 0, y: 6 }, uniform: false, roomId: 'r1' },
    shapeAt: { x: 20, y: 6 } });
  assert.ok(across.shape, 'a span from one wall to the opposite one is a slot');
  assert.equal(across.why, '');

  // NO ROOM AT THE PRESS, AND THE SENTENCE SAYS SO — a cove that simply fails
  // to appear reads as a broken tool.
  const noRoom = slotSpan({ ...base,
    shapeSpan: { aFt: { x: 0, y: 6 }, uniform: false, roomId: null },
    shapeAt: { x: 20, y: 6 } });
  assert.deepEqual(noRoom, { shape: null, why: 'Start on a wall of a space.' });

  // BOTH ENDS ON THE SAME WALL is the refusal, and it has its own sentence.
  const sameWall = slotSpan({ ...base,
    shapeSpan: { aFt: { x: 2, y: 0 }, uniform: false, roomId: 'r1' },
    shapeAt: { x: 8, y: 0 } });
  assert.equal(sameWall.shape, null);
  assert.equal(sameWall.why, 'A cove spans two walls — drag to a different one.');

  // ...AND SHIFT HAS ITS OWN, because "square to that wall" is a different
  // thing to be told than "drag to a different one".
  const locked = slotSpan({ ...base,
    shapeSpan: { aFt: { x: 2, y: 0 }, uniform: true, roomId: 'r1' },
    shapeAt: { x: 8, y: 0.2 } });
  assert.equal(locked.shape, null);
  assert.equal(locked.why, 'Square to that wall runs along it — aim across the room.');

  // A GUIDE IS NOT BUILT, SO THE PROJECTION IS SKIPPED and the drag IS the
  // line, ends included — no room is even consulted. Same exemption a track
  // takes, for the same reason: neither is a channel in plasterboard.
  for (const role of ['guide', 'track']) {
    const free = slotSpan({ ...base, shapeRole: role,
      shapeSpan: { aFt: { x: 4, y: 4 }, uniform: false, roomId: null },
      shapeAt: { x: 9, y: 7 } });
    assert.ok(free.shape, `a ${role} line goes where it is drawn`);
    assert.equal(free.why, '');
  }

  // AND SHIFT STILL SQUARES ONE UP: a run somebody wants level is a run
  // somebody wants level whatever it is for.
  const square = slotSpan({ ...base, shapeRole: 'guide',
    shapeSpan: { aFt: { x: 4, y: 4 }, uniform: true, roomId: null },
    shapeAt: { x: 9, y: 4.3 } });
  assert.ok(square.shape);
  assert.equal(square.shape.y, 4, 'the longer axis wins and the short one freezes');
}

// --- the path an array is set out on ----------------------------------------

{
  const shapes = [rect('s1', 10, 6, 6, 4),
                  { ...lineShape({ x: 2, y: 5 }, { x: 8, y: 5 }), id: 'open' }];
  const ctx = { rooms: [ROOM], ceilingShapes: shapes, pxPerFt: PPF };

  // THE `room:` PREFIX SAYS WHICH LIST TO LOOK IN, and nothing downstream has
  // to know there were two.
  const asRoom = arrayOutlineFor('room:r1', ctx);
  assert.equal(asRoom.isRoom, true);
  assert.equal(asRoom.roomId, 'r1');
  assert.equal(asRoom.closed, true);
  assert.equal(asRoom.label, 'Living');
  // EVERY VERTEX OF A ROOM IS A CORNER — it is traced on the plaster and has no
  // fillets and no sampled curve in it — so the same list is handed twice.
  assert.deepEqual(asRoom.pts, asRoom.corners);

  // A SHAPE IS A POLYLINE AND ITS CORNERS ARE ITS OWN ANSWER, not `pts`
  // filtered: there is no reading of a 72-point circle that recovers "four
  // corners".
  const asShape = arrayOutlineFor('s1', ctx);
  assert.equal(asShape.isRoom, false);
  assert.equal(asShape.closed, true);
  assert.equal(asShape.corners.length, 4, 'a rectangle has four corners');
  assert.equal(asShape.roomId, 'r1', 'the space the shape sits in is resolved');
  assert.deepEqual(asShape.pts[0], { x: px(7), y: px(4) });

  // AN OPEN PATH SAYS SO, which is what makes a run on one freely spaced.
  assert.equal(arrayOutlineFor('open', ctx).closed, false);

  // A SHAPE THAT HAS BEEN DELETED FROM UNDER AN ARRAY resolves to nothing
  // rather than throwing.
  assert.equal(arrayOutlineFor('gone', ctx), null);
  assert.equal(arrayOutlineFor('room:nope', ctx), null);
  assert.equal(arrayOutlineFor(null, ctx), null);
  assert.equal(arrayOutlineFor('s1', { ...ctx, pxPerFt: 0 }), null);
}

// --- why a drawn run is not on the plan --------------------------------------

{
  const run = (id, ptsFt, extra = {}) => ({ id, ptsFt, closed: false, ...extra });

  // A RUN THE LAYOUT TOOK UP IS NOT REFUSED AT ALL. `r.tracks` carries the keys
  // that were placed, and for a drawn run the key IS the manual track's id.
  const placed = { ...ROOM, tracks: [{ key: 'mt1' }] };
  assert.deepEqual(
    trackRefusals({ pxPerFt: PPF, manualTracks: [run('mt1', [{ x: 2, y: 2 }, { x: 8, y: 2 }])],
                    rooms: [placed], opt: {} }),
    [], 'a run that was built has nothing to explain');

  // A RUN OVER NO LIT SPACE AT ALL IS REFUSED BY NOBODY, which is why `outside`
  // is the answer when no room had an opinion.
  const far = trackRefusals({ pxPerFt: PPF,
    manualTracks: [run('mt2', [{ x: 100, y: 100 }, { x: 106, y: 100 }])],
    rooms: [ROOM], opt: {} });
  assert.deepEqual(far, [{ id: 'mt2', why: 'outside' }]);

  // ONLY A ROOM THE RUN ACTUALLY REACHES HAS AN OPINION WORTH HAVING. A run
  // inside the lit room with no fittings anywhere near it is `reach`, and the
  // room it is nowhere near does not get to say `reach` about it too.
  const inside = trackRefusals({ pxPerFt: PPF,
    manualTracks: [run('mt3', [{ x: 2, y: 2 }, { x: 8, y: 2 }])],
    rooms: [OTHER, ROOM], opt: {} });
  assert.deepEqual(inside, [{ id: 'mt3', why: 'reach' }]);

  // AN UNLIT ROOM IS SKIPPED — `plan.ok` is the gate.
  const unlit = trackRefusals({ pxPerFt: PPF,
    manualTracks: [run('mt4', [{ x: 2, y: 2 }, { x: 8, y: 2 }])],
    rooms: [{ ...ROOM, plan: { ...ROOM.plan, ok: false } }], opt: {} });
  assert.deepEqual(unlit, [{ id: 'mt4', why: 'outside' }]);

  // Nothing drawn, or no scale to convert with: nothing to say either way.
  assert.deepEqual(trackRefusals({ pxPerFt: PPF, manualTracks: [], rooms: [ROOM], opt: {} }), []);
  assert.deepEqual(trackRefusals({ pxPerFt: 0, manualTracks: [run('m', [])], rooms: [ROOM], opt: {} }), []);
}

{
  // THREE RUNS REFUSED FOR THE SAME REASON IS ONE SENTENCE AND A COUNT, and two
  // refused for two reasons are two lines, because the thing to do about each
  // is different.
  const lines = groupTrackRefusals([
    { id: 'a', why: 'reach' }, { id: 'b', why: 'reach' }, { id: 'c', why: 'fan' }]);
  assert.deepEqual(lines, [
    { why: 'reach', n: 2, text: TRACK_REFUSALS.reach },
    { why: 'fan', n: 1, text: TRACK_REFUSALS.fan },
  ]);
  assert.deepEqual(groupTrackRefusals([]), []);
}

// --- the four states of the floating bar -------------------------------------

{
  const sel = rect('s1', 5, 5, 4, 4);
  const shut = { shapeMenuOn: false, shapeAskSides: false, shapeDraft: null,
                 penEmpty: true, shapeSpan: null, shapeTool: null,
                 selShape: null, otherBar: false };

  // CLOSED AND NOTHING SELECTED: no bar at all.
  assert.equal(shapeBarMode(shut), null);

  // CLOSED WITH A SHAPE SELECTED IS THE CONTEXTUAL MENU.
  assert.equal(shapeBarMode({ ...shut, selShape: sel }), 'edit');

  // ...AND IT DOES NOT SURVIVE ANOTHER TOOL OWNING THE BAR. Two contextual bars
  // are `position: fixed` at the same 26px and would stack.
  assert.equal(shapeBarMode({ ...shut, selShape: sel, otherBar: true }), null);

  // OPEN WITH NOTHING ARMED AND NOTHING SELECTED: the row of primitives.
  assert.equal(shapeBarMode({ ...shut, shapeMenuOn: true }), 'pick');

  // OPEN, UNARMED, WITH A SELECTION: `edit` is reachable this way too, because
  // the bar now arrives unarmed on a click in a space.
  assert.equal(shapeBarMode({ ...shut, shapeMenuOn: true, selShape: sel }), 'edit');

  // A LIVE PRIMITIVE MEANS YOU ARE DRAWING, whatever is selected underneath.
  assert.equal(shapeBarMode({ ...shut, shapeMenuOn: true, shapeTool: 'rect',
                              selShape: sel }), 'pick');

  // ANY OF THE THREE SIGNS OF A GESTURE IN FLIGHT IS `draw`. `shapeSpan` counts
  // even with no draft to show for it — a slot whose second end has not reached
  // another wall yet produces no shape, and dropping back to the row of
  // primitives half way through the drag reads as the tool letting go.
  for (const live of [{ shapeDraft: sel }, { penEmpty: false }, { shapeSpan: {} }]) {
    assert.equal(shapeBarMode({ ...shut, shapeMenuOn: true, shapeTool: 'rect', ...live }),
      'draw');
  }

  // THE SIDES QUESTION OUTRANKS EVERYTHING, because the polygon has no sensible
  // default to assume.
  assert.equal(shapeBarMode({ ...shut, shapeMenuOn: true, shapeAskSides: true,
                              shapeDraft: sel, selShape: sel }), 'sides');
}

// --- the borrowed draft's offset ---------------------------------------------

{
  // ON THE LINE IS NO OFFSET AT ALL, whatever distance is carried — which is
  // what makes choosing a side one press rather than two.
  assert.equal(offsetGapFt({ side: 'on', ft: 3 }), 0);
  // OUT IS POSITIVE AND IN IS NEGATIVE, which is the sign `insetShape` reads.
  assert.equal(offsetGapFt({ side: 'out', ft: 1.5 }), 1.5);
  assert.equal(offsetGapFt({ side: 'in', ft: 1.5 }), -1.5);
  // A NEGATIVE OR MISSING DISTANCE IS NOT A REVERSAL OF THE SIDE.
  assert.equal(offsetGapFt({ side: 'in', ft: -4 }), -0);
  assert.equal(offsetGapFt({ side: 'out', ft: null }), 0);
}

// --- what a finished pen path stores -----------------------------------------

{
  const segs = [
    { a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
    { a: { x: 4, y: 0 }, b: { x: 4, y: 3 } },
    { a: { x: 4, y: 3 }, b: { x: 0, y: 3 } },
    { a: { x: 0, y: 3 }, b: { x: 0, y: 0 } },
  ];
  // AN OPEN RUN IS THE FIRST POINT AND EVERY SEGMENT'S FAR END.
  assert.deepEqual(trackPtsFromSegments(segs.slice(0, 3), false),
    [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]);
  // A CLOSED PATH KEEPS ITS CORNERS AND NOT ITS LAST SEGMENT: `closed` says the
  // leg back exists, and storing the repeat of the first point would make it a
  // corner in its own right.
  assert.deepEqual(trackPtsFromSegments(segs, true),
    [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]);
}

console.log('ceiling-geometry: ok');
