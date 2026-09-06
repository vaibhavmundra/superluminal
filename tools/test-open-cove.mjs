// tools/test-open-cove.mjs — the cove that does not close. Pure geometry.
import { SHAPE_TOOLS, SHAPE_BY_ID, MIN_SPAN_FT, isOpen, lineShape, penShape,
         shapeFromDrag, outlineFt, runLengthFt, pathLengthFt, bigEnough,
         hitShape, handlesFor, roundable, stretchy, sizeLabel, movedShape,
         projectOnOutline, spanOnOutline, rayExit, penSpansOutline, sealShape }
  from '../src/lib/ceilingShapes.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`); } };
const at = (a, b, t = 1e-6) => Math.abs(a - b) <= t;
const sec = (s) => console.log('\n' + s);

/** A 20 x 12 room. Edge 0 is the bottom, 1 the right, 2 the top, 3 the left. */
const ROOM = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 12 }, { x: 0, y: 12 }];

sec('the two tools that do not close');
{
  ok('the line is in the menu', !!SHAPE_BY_ID.line);
  ok('...and it is a drag, not a pen', SHAPE_BY_ID.line.path !== true);
  ok('...and it says both ends land on a wall', SHAPE_BY_ID.line.spans === true);
  ok('the pen can be finished open', SHAPE_BY_ID.pen.canOpen === true);
  ok('nothing else can', SHAPE_TOOLS.filter((t) => t.open || t.canOpen).length === 2);
}

sec('a point put on the nearest wall');
{
  const q = projectOnOutline({ x: 5, y: 2 }, ROOM);
  ok('it lands on the wall it was nearest', at(q.y, 0) && at(q.x, 5));
  ok('...and says which one', q.edge === 0);
  ok('...and how far it moved', at(q.dist, 2));
  // A point outside the room still projects, which is what makes a press aimed
  // AT a wall work: those land outside as often as inside.
  const out = projectOnOutline({ x: -3, y: 6 }, ROOM);
  ok('a point outside still lands on the outline', at(out.x, 0) && at(out.y, 6));
  ok('a corner is the answer past the end of an edge',
    at(projectOnOutline({ x: -4, y: -4 }, ROOM).x, 0));
  ok('a polygon that is not one has no answer',
    projectOnOutline({ x: 1, y: 1 }, [{ x: 0, y: 0 }]) === null);
}

sec('a slot has to span two DIFFERENT walls');
{
  // The whole rule. Both ends on one wall is a line lying along the plaster,
  // which is a reverse cove and has its own tool.
  ok('two points on one wall is refused',
    spanOnOutline({ x: 3, y: 0.4 }, { x: 14, y: 0.6 }, ROOM) === null);

  const s = spanOnOutline({ x: 0.3, y: 5 }, { x: 19.6, y: 8 }, ROOM);
  ok('across the room is allowed', !!s);
  ok('...and BOTH ends are moved onto the plaster',
    at(s.a.x, 0) && at(s.b.x, 20), JSON.stringify(s));
  ok('...keeping the position along each wall', at(s.a.y, 5) && at(s.b.y, 8));
  ok('...and it says which walls', s.edgeA === 3 && s.edgeB === 1);
  // At an angle is the ordinary case, not a special one.
  ok('a diagonal is a span like any other',
    !!spanOnOutline({ x: 0.2, y: 1 }, { x: 8, y: 11.8 }, ROOM));

  // A drag that has barely left its start is a click that wobbled.
  ok('a span shorter than the floor is refused',
    spanOnOutline({ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }, ROOM) === null);
  ok('...and the floor is MIN_SPAN_FT', MIN_SPAN_FT > 0);
}

sec('Shift squares the run, and it is still on both walls');
{
  // THE HALF THAT MAKES THE LOCK WORTH HAVING. Projecting a locked pointer onto
  // the nearest wall gives a run that is NEARLY square and exactly on the wall;
  // walking the ray out to the plaster gives one that is both, because it is the
  // intersection of the two.
  const free = spanOnOutline({ x: 0.2, y: 5 }, { x: 19.6, y: 8 }, ROOM);
  ok('unlocked, the run follows the pointer', !at(free.a.y, free.b.y));

  const lock = spanOnOutline({ x: 0.2, y: 5 }, { x: 19.6, y: 8 }, ROOM, { lock: true });
  ok('locked, it is dead level', at(lock.a.y, lock.b.y), JSON.stringify(lock));
  ok('...and BOTH ends are still exactly on a wall',
    at(lock.a.x, 0) && at(lock.b.x, 20));
  ok('...on two different ones', lock.edgeA !== lock.edgeB);

  // Whichever axis the drag is more nearly already making — the same rule the
  // pens follow, off the same function.
  const vert = spanOnOutline({ x: 6, y: 0.2 }, { x: 7, y: 11.5 }, ROOM, { lock: true });
  ok('a mostly-downward drag locks vertical', at(vert.a.x, vert.b.x));
  ok('...and runs the full height', at(vert.a.y, 0) && at(vert.b.y, 12));

  // A locked ray along its own wall reaches the far corner and is caught by
  // whichever wall turns there — two different edges by the letter of the rule,
  // and a line lying flat on the plaster in fact.
  ok('locked along the wall it started on is refused',
    spanOnOutline({ x: 2, y: 0.1 }, { x: 15, y: 0.2 }, ROOM, { lock: true }) === null);

  // The ray itself, on its own terms.
  const hit = rayExit({ x: 0, y: 6 }, { x: 1, y: 0 }, ROOM);
  ok('a ray leaves by the far wall', at(hit.x, 20) && hit.edge === 1);
  ok('...and not by the one it started on', hit.edge !== 3);
  ok('a ray with nowhere to go answers nothing',
    rayExit({ x: 0, y: 6 }, { x: 1, y: 0 }, [{ x: 0, y: 0 }]) === null);
}

sec('the slot itself');
{
  const s = spanOnOutline({ x: 0.3, y: 5 }, { x: 19.6, y: 5 }, ROOM);
  const sh = lineShape(s.a, s.b);
  ok('it is open', isOpen(sh));
  ok('...and shapeFromDrag builds the same thing',
    isOpen(shapeFromDrag('line', s.a, s.b)));
  ok('its outline is the two ends and nothing else', outlineFt(sh).length === 2);
  ok('...back where they were put',
    at(outlineFt(sh)[0].x, 0) && at(outlineFt(sh)[1].x, 20));

  // THE HALF THAT WOULD BE BILLED WRONG: a closed reading walks the run twice.
  ok('it is measured along itself, once', at(runLengthFt(sh), 20));
  ok('...where a closed reading would double it',
    at(pathLengthFt(outlineFt(sh)), 40));

  ok('a slot survives the size floor even though its box is flat', bigEnough(sh));
  ok('...and it reads as a length rather than a box', sizeLabel(sh) === '20.0 ft run');

  // Its ends are pinned, so there is nothing to drag and nothing to round.
  ok('no grips', handlesFor(sh).length === 0);
  ok('no rounding', roundable(sh) === false);
  ok('no stretching', stretchy(sh) === false);

  // Point-in-polygon answers false everywhere on a line; without the distance
  // test an open cove would be an object nobody could pick up.
  ok('it can be hit on its own line', hitShape(sh, { x: 10, y: 5.2 }, 0.4));
  ok('...and not away from it', !hitShape(sh, { x: 10, y: 8 }, 0.4));

  ok('it moves like any other shape',
    at(outlineFt(movedShape(sh, 0, 3))[0].y, 8));
  ok('and it can be sealed', !!sealShape(sh).id);
  ok('two points the same is not a slot', lineShape({ x: 1, y: 1 }, { x: 1, y: 1 }) === null);
}

sec('the L, which is a pen path finished open');
{
  const L = [{ x: 0, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 12 }];
  ok('both ends on a wall is a run', penSpansOutline(L, ROOM, 0.3));
  // Only the ENDS answer to the walls — the corner is wherever it was put.
  ok('...and the corner in the middle is nobody\'s business',
    penSpansOutline([{ x: 0, y: 4 }, { x: 13, y: 7 }, { x: 8, y: 12 }], ROOM, 0.3));
  ok('an end in mid-air is not',
    !penSpansOutline([{ x: 3, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 9 }], ROOM, 0.3));
  ok('one end on a wall is not enough',
    !penSpansOutline([{ x: 0, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 9 }], ROOM, 0.3));
  ok('a single point is not a run', !penSpansOutline([{ x: 0, y: 4 }], ROOM, 0.3));

  const sh = penShape(L, { open: true });
  ok('it comes out open', isOpen(sh));
  ok('...with all three points', outlineFt(sh).length === 3);
  ok('...measured along itself', at(runLengthFt(sh), 16));
  ok('...and not round the closing leg',
    !at(runLengthFt(sh), pathLengthFt(outlineFt(sh))));
  ok('it can be hit on its second leg', hitShape(sh, { x: 8, y: 10 }, 0.4));

  // Two points enclose no area, so they are a run and never a pocket.
  ok('two points make a run', !!penShape([{ x: 0, y: 4 }, { x: 8, y: 4 }], { open: true }));
  ok('...but not a pocket', penShape([{ x: 0, y: 4 }, { x: 8, y: 4 }]) === null);
}

sec('a closed cove is untouched by any of it');
{
  const box = shapeFromDrag('rect', { x: 2, y: 2 }, { x: 10, y: 8 });
  ok('a rectangle is not open', !isOpen(box));
  ok('...its outline still closes', outlineFt(box).length === 4);
  ok('...it is still billed round itself', at(runLengthFt(box), 28));
  ok('...it still has grips', handlesFor(box).length > 0);
  ok('...it still rounds and stretches', roundable(box) && stretchy(box));
  ok('...and still reads as a box', sizeLabel(box) === '8.0 × 6.0 ft');
  const hex = shapeFromDrag('polygon', { x: 10, y: 6 }, { x: 14, y: 6 });
  ok('a polygon is not open either', !isOpen(hex) && outlineFt(hex).length === 6);
  const pocket = penShape([{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 5 }]);
  ok('a closed pen path is still closed', !isOpen(pocket));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
