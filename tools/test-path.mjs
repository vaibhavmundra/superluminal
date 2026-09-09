// ---------------------------------------------------------------------------
// test-path.mjs — THE PATH PRIMITIVE.
//
// WHAT IS ASSERTED. Not geometry.js's shape maths and not pen.js's — both are
// called rather than copied, and both have their own tests. What is asserted is
// what a PATH adds:
//
//   HOST      it is the three fields a constrained point is held on, and its
//             parameter space is point.js's, not a second one.
//   MOVE      a translation, and nothing held on it moves as a fraction.
//   VERTICES  they are points; one moves with its legs kept square when the
//             path is rectilinear, and the tail is re-squared after a cut.
//   MINIMUM   a run needs two points and a circuit needs three.
//   CARRY     a delete or a copy names what is held on it.
//
//   node tools/test-path.mjs
// ---------------------------------------------------------------------------

import {
  PATH, makePath, isPath, asPathHost, pathU, pathAt, pathLengthOf, pathSegments,
  pathCorners, translatePath, pathAdapters, pathOrtho, vertexPoints,
  vertexIndex, moveVertex, canRemoveVertex, removeVertex, insertVertex,
  closePath, openPath, reversePath, reverseU, simplifyPath, pathBounds,
  dependentsOfPath,
} from '../src/lib/path.js';
import { pointOn, resolvePoint, isConstrained } from '../src/lib/point.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const say = (t) => console.log('\n' + t);
const near = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

/** An L: right 100, then down 100. Open. */
const L = makePath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
  { id: 'L' });
/** A 100 square, closed. */
const SQ = makePath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 },
  { x: 0, y: 100 }], { closed: true, id: 'SQ' });

// ---------------------------------------------------------------------------
say('WHAT A PATH IS — open or closed is a property, not two kinds');
{
  ok(PATH === 'path' && L.closed === false && SQ.closed === true, 'both are one record shape');
  ok(isPath(L) && isPath(SQ), 'and both are paths');
  ok(!isPath(makePath([{ x: 0, y: 0 }])), 'one point is not a path');
  ok(!isPath(makePath([{ x: 0, y: 0 }, { x: 1, y: 1 }], { closed: true })),
    'and two points cannot be a circuit — a line doubled back on itself');
  ok(near(pathLengthOf(L), 200) && near(pathLengthOf(SQ), 400),
    'a closed path counts the leg back to its first point; an open one does not');
  const b = pathBounds(L);
  ok(b.minX === 0 && b.maxX === 100 && b.maxY === 100 && b.w === 100,
    'its extent is geometry.js\'s bbox, with that file\'s own field names');
  ok(pathSegments(L).length === 2 && pathCorners(L) === 1,
    'two legs and one corner — what a schedule buys as pieces');
}

// ---------------------------------------------------------------------------
say('HOST — a path is what a constrained point is held on');
{
  const h = asPathHost(L);
  ok(h.id === 'L' && h.pts.length === 3 && h.closed === false,
    'asPathHost is the three fields point.js asks for, and no more');
  ok(asPathHost(makePath([{ x: 0, y: 0 }])) === null, 'and nothing that cannot hold a point');

  ok(near(pathU(L, { x: 50, y: 40 }), 0.25),
    'a quarter along the L is halfway down its first leg');
  ok(near(pathAt(L, 0.75).x, 100) && near(pathAt(L, 0.75).y, 50),
    'and three quarters is halfway down its second');
  ok(pathAt(L, 0.75).ux === 0 && pathAt(L, 0.75).uy === 1,
    'with the direction that leg is heading — a body has to lie ALONG it');

  const pt = pointOn('L', 0.75, { id: 'p' });
  const at = resolvePoint(pt, asPathHost(L));
  ok(isConstrained(pt) && near(at.x, 100) && near(at.y, 50),
    'so a point held on this path resolves through the primitive, not a copy of it');
}

// ---------------------------------------------------------------------------
say('MOVE — a translation, and the parameter space is untouched');
{
  const moved = translatePath(L, { dx: 10, dy: 20 });
  ok(near(moved.pts[0].x, 10) && near(moved.pts[2].y, 120), 'every point by one delta');
  ok(near(pathLengthOf(moved), pathLengthOf(L)),
    'its length is unchanged, so nothing held on it moves as a fraction');
  const pt = pointOn('L', 0.75);
  ok(near(resolvePoint(pt, asPathHost(moved)).x, 110),
    'a point at 0.75 is still at 0.75 — which is what makes moving a run with six '
    + 'diffusers on it ONE edit');

  const unit = pathAdapters();
  ok(near(unit.at(L).x, 0) && near(unit.at(L).y, 0), 'the anchor is the first point');
  const put = unit.to(L, { x: 5, y: 5 });
  ok(near(put.pts[0].x, 5) && near(put.pts[1].x, 105),
    'and `to` lands that point where it is asked, carrying the rest');
  ok(unit.to(makePath([]), { x: 1, y: 1 }).pts.length === 0,
    'a path with no points is refused rather than invented');
  ok(pathOrtho() === true,
    'and a path move takes the shift lock — a free translation can keep that claim');
}

// ---------------------------------------------------------------------------
say('VERTICES — they are points, and they keep their legs square');
{
  const vs = vertexPoints(L);
  ok(vs.length === 3 && !isConstrained(vs[0]),
    'handed out as FREE point records, so the grips ride the point gesture');
  ok(vs[1].id === 'L#1' && vertexIndex(vs[1].id) === 1,
    'the id carries the index, because a vertex has no identity but its place');
  ok(vertexIndex('mtm-abc') === null, 'and anything else is not a vertex');

  const free = moveVertex(L, 1, { x: 120, y: 30 });
  ok(near(free.pts[1].x, 120) && near(free.pts[1].y, 30) && near(free.pts[0].y, 0),
    'moved free, only that vertex changes');
  const sq = moveVertex(L, 1, { x: 120, y: 30 }, { lock: true });
  ok(near(sq.pts[0].y, 30) && near(sq.pts[2].x, 120),
    'moved with the lock, the two legs FOLLOW — penMovePoint, not a second copy of it');
  ok(moveVertex(L, 9, { x: 0, y: 0 }) === L, 'an index off the end changes nothing');

  const ins = insertVertex(L, { x: 60, y: 8 });
  ok(ins.pts.length === 4 && near(ins.pts[1].x, 60) && near(ins.pts[1].y, 0),
    'a vertex goes in ON the leg nearest the point, at the place clicked');
}

// ---------------------------------------------------------------------------
say('MINIMUM — a run needs two points and a circuit needs three');
{
  /* THE RULE IS `deleteTrackPoint`'S, AND THE TWO MINIMA ARE DIFFERENT. An open
     path may go down to two points, because a line IS a run. A closed one may
     go down to three, because a two-point loop is a line doubled back on
     itself. So the same three-point path answers differently depending only on
     whether it closes. */
  ok(canRemoveVertex(L) === true,
    'an OPEN three-point path can lose one — a line is still a run');
  ok(removeVertex(L, 1).pts.length === 2, 'and does');
  ok(canRemoveVertex(makePath([{ x: 0, y: 0 }, { x: 10, y: 0 }])) === false,
    'a two-point run is at its minimum');
  ok(canRemoveVertex(SQ) === true, 'a four-point circuit can lose one, leaving a triangle');
  const tri = makePath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }],
    { closed: true });
  ok(canRemoveVertex(tri) === false,
    'a THREE-point circuit cannot — the same count that was legal open');
  ok(removeVertex(tri, 1) === tri,
    'and below the minimum NOTHING happens here — what happens instead is the caller\'s');
  const four = makePath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 },
    { x: 0, y: 10 }]);

  const relocked = removeVertex(four, 2, { lock: true });
  ok(relocked.pts.length === 3
    && (near(relocked.pts[2].x, relocked.pts[1].x)
      || near(relocked.pts[2].y, relocked.pts[1].y)),
    'and a rectilinear path is re-squared from the cut, so no diagonal is left behind');
}

// ---------------------------------------------------------------------------
say('CLOSURE, REVERSAL, SIMPLIFICATION');
{
  ok(closePath(L).closed === true && openPath(SQ).closed === false, 'both ways');
  ok(closePath(makePath([{ x: 0, y: 0 }, { x: 1, y: 0 }])).closed === false,
    'but two points cannot close');
  const rev = reversePath(L);
  ok(near(rev.pts[0].x, 100) && near(rev.pts[0].y, 100), 'reversed, the drawing is the same...');
  ok(near(pathAt(rev, reverseU(0.75)).x, 100) && near(pathAt(rev, reverseU(0.75)).y, 50),
    '...and `reverseU` is how anything held on it is re-mapped');
  const noisy = makePath([{ x: 0, y: 0 }, { x: 50, y: 0.001 }, { x: 100, y: 0 }]);
  ok(simplifyPath(noisy, 0.25).pts.length === 2, 'fewer points, same line');
}

// ---------------------------------------------------------------------------
say('CARRY — what a delete or a copy of this path takes with it');
{
  const points = [pointOn('L', 0.2, { id: 'p1' }), pointOn('L', 0.8, { id: 'p2' }),
    pointOn('SQ', 0.5, { id: 'p3' })];
  const spans = [{ id: 's1', on: 'L', a: 0.1, b: 0.4 }, { id: 's2', on: 'SQ', a: 0, b: 1 }];
  const dep = dependentsOfPath(L, { points, spans });
  ok(dep.points.join() === 'p1,p2' && dep.spans.join() === 's1',
    'the points and spans held on it, and nothing else');
  ok(dependentsOfPath({ pts: [] }, { points }).points.length === 0,
    'a path with no id holds nothing — an id is what a host is named by');
  ok(dep.points.length && !('deleted' in dep),
    'it returns IDS and deletes nothing: a delete carries them, a duplicate gives them away');
}

console.log('\n' + (fail ? `FAILED ${fail}` : 'all good'));
process.exit(fail ? 1 : 0);
