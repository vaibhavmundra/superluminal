// tools/test-snap.mjs — the snap engine. Pure geometry, no browser.
import { buildSnapIndex, snapAt, PRIORITY, HANDICAP } from '../src/lib/snap.js';
import { bbox } from '../src/lib/geometry.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`); } };
const at = (a, b, t = 1e-6) => Math.abs(a - b) <= t;
const sec = (s) => console.log('\n' + s);

// A wall junction: two horizontal lines and two vertical ones, as CAD draws a
// wall — so the INNER corner is a crossing and an endpoint of nothing.
const segs = [
  { x1: 0, y1: 100, x2: 400, y2: 100, layer: 'W' },   // outer face, horizontal
  { x1: 0, y1: 120, x2: 400, y2: 120, layer: 'W' },   // inner face, horizontal
  { x1: 200, y1: 100, x2: 200, y2: 500, layer: 'W' }, // outer face, vertical
  { x1: 220, y1: 100, x2: 220, y2: 500, layer: 'W' }, // inner face, vertical
  { x1: 300, y1: 300, x2: 360, y2: 300, layer: 'FURN' },
];
const ix = buildSnapIndex(segs, [{ cx: 50, cy: 400, r: 8, layer: 'W' }]);

sec('the basics');
{
  const s = snapAt(ix, { x: 3, y: 103 }, { tol: 10 });
  ok('an endpoint wins near a segment end', s.kind === 'end' && at(s.x, 0) && at(s.y, 100), `${s.kind} ${s.x},${s.y}`);

  const e = snapAt(ix, { x: 150, y: 103 }, { tol: 10 });
  ok('mid-wall gives the point on the wall', e.kind === 'edge' && at(e.y, 100), `${e.kind} ${e.x},${e.y}`);

  const m = snapAt(ix, { x: 200, y: 122 }, { tol: 10 });
  ok('a midpoint is offered', ['mid', 'int', 'end'].includes(m.kind), m.kind);

  const f = snapAt(ix, { x: 700, y: 700 }, { tol: 10 });
  ok('nothing near means the cursor is the answer', f.kind === 'free' && at(f.x, 700), f.kind);

  const c = snapAt(ix, { x: 50, y: 402 }, { tol: 10 });
  ok('a circle centre snaps', c.kind === 'end' && at(c.x, 50) && at(c.y, 400), `${c.kind} ${c.x},${c.y}`);
}

sec('the inner corner of a wall junction');
{
  // (220, 120) is where the two INNER faces cross. It is not an endpoint of
  // either line, so without an intersection snap the most useful point on the
  // drawing cannot be clicked.
  const s = snapAt(ix, { x: 223, y: 123 }, { tol: 10 });
  ok('the crossing is found', s.kind === 'int' && at(s.x, 220) && at(s.y, 120), `${s.kind} ${s.x},${s.y}`);
  ok('and it beats the two edges through it', PRIORITY.int < PRIORITY.edge
     && HANDICAP.int < HANDICAP.edge);
}

// ---------------------------------------------------------------------------
// The case that matters most, and the one that was wrong.
//
// CAD draws a wall as two lines running corner to corner along its CENTRELINE,
// so at every junction both faces overrun the wall they meet and stop inside
// the cavity. That leaves an endpoint exactly half a wall thickness from the
// room corner — nearer to the cursor than the corner itself, which is an
// intersection of two faces and an endpoint of neither.
//
// Ranking snaps by kind alone let that debris win every time, and every traced
// room came out one wall thickness too big in each direction.
sec('a wall overrunning its junction must not steal the corner');
{
  const T = 20;            // wall thickness, px
  const W = 600, H = 400;  // room, centreline to centreline
  const walls = [];
  // Each wall's two faces run the FULL centreline span, overrunning at corners.
  const face = (x1, y1, x2, y2) => walls.push({ x1, y1, x2, y2, layer: 'W' });
  for (const o of [-T / 2, T / 2]) {
    face(0, o, W, o);            // south
    face(0, H + o, W, H + o);    // north
    face(o, 0, o, H);            // west
    face(W + o, 0, W + o, H);    // east
  }
  const wix = buildSnapIndex(walls);
  // The room's true inside corners, on the inner faces.
  const inner = [
    { x: T / 2, y: T / 2 }, { x: W - T / 2, y: T / 2 },
    { x: W - T / 2, y: H - T / 2 }, { x: T / 2, y: H - T / 2 },
  ];

  const traceWith = (off, tol) => {
    let last = null; const got = [];
    for (const c of inner) {
      const s = snapAt(wix, { x: c.x + off, y: c.y + off },
        { tol, last, points: got, ortho: true });
      got.push({ x: s.x, y: s.y });
      last = got[got.length - 1];
    }
    return got;
  };
  const size = (pts) => { const b = bbox(pts); return [b.w, b.h]; };
  const trueSize = [W - T, H - T];

  for (const off of [0, 4, 8]) {
    const [w, h] = size(traceWith(off, 18));
    ok(`clicking ${off}px off the corner still gives the exact room`,
       at(w, trueSize[0], 0.01) && at(h, trueSize[1], 0.01),
       `${w} x ${h}, want ${trueSize.join(' x ')}`);
  }

  // And the loose ends are identified as such rather than just out-ranked.
  const looseCount = wix.loose.flat().filter(Boolean).length;
  ok('every overrunning wall end is marked loose', looseCount === 16,
     `${looseCount} of ${wix.loose.flat().length}`);

  // A corner where two lines genuinely meet is NOT loose.
  const shared = buildSnapIndex([
    { x1: 0, y1: 0, x2: 100, y2: 0, layer: 'W' },
    { x1: 100, y1: 0, x2: 100, y2: 80, layer: 'W' },
  ]);
  ok('an endpoint two lines share is not a loose end',
     shared.loose[0][1] === false && shared.loose[1][0] === false,
     JSON.stringify(shared.loose));
  ok('...while the far ends of both still are',
     shared.loose[0][0] === true && shared.loose[1][1] === true,
     JSON.stringify(shared.loose));
}

sec('layer visibility filters snapping');
{
  const on = snapAt(ix, { x: 330, y: 302 }, { tol: 10 });
  ok('furniture snaps when visible', on.kind !== 'free', on.kind);
  const off = snapAt(ix, { x: 330, y: 302 }, { tol: 10, layers: new Set(['W']) });
  ok('hiding its layer makes it unsnappable', off.kind === 'free', off.kind);
  const wall = snapAt(ix, { x: 3, y: 103 }, { tol: 10, layers: new Set(['W']) });
  ok('...without affecting the walls', wall.kind === 'end');
}

sec('ortho lock');
{
  const last = { x: 220, y: 120 };
  // Cursor well to the right and a little off the axis: must land ON the axis.
  const s = snapAt(ix, { x: 380, y: 132 }, { tol: 10, last, ortho: true });
  ok('the point is forced onto the axis', at(s.y, 120), `y=${s.y}`);
  ok('the guide says which axis', s.guide?.axis === 'x', JSON.stringify(s.guide));

  // Nearer in y than x: the other axis wins.
  const v = snapAt(ix, { x: 232, y: 400 }, { tol: 10, last, ortho: true });
  ok('the closer axis is the one that locks', at(v.x, 220), `x=${v.x}`);

  // An endpoint off the axis must NOT capture the point.
  const off = snapAt(ix, { x: 402, y: 104 }, { tol: 10, last, ortho: true });
  ok('an off-axis endpoint is refused while locked', at(off.y, 120), `y=${off.y} kind=${off.kind}`);
}

sec('carry on until you hit a wall');
{
  // Running RIGHT from a point on the inner wall face at y=120, the two
  // vertical faces at x=200 and x=220 both cross that line. One of them should
  // capture the point — this is the "carry on until you hit something" case,
  // and it is the snap that makes tracing a room four clicks instead of eight.
  const last = { x: 50, y: 120 };
  const hit = snapAt(ix, { x: 203, y: 124 }, { tol: 12, last, ortho: true });
  ok('the crossing wall on the axis stops the point',
     at(hit.y, 120) && (at(hit.x, 200) || at(hit.x, 220)), `${hit.kind} ${hit.x},${hit.y}`);
  // Either label is honest here: the point is both a crossing of two lines and
  // the place the axis meets a wall. What must not happen is landing on the
  // bare cursor x.
  ok('...and is reported as real geometry, not a bare axis point',
     hit.kind === 'int' || hit.kind === 'orthoInt', hit.kind);

  // With nothing at all on the constraint line, the axis point is the answer.
  const bare = snapAt(ix, { x: 122, y: 305 },
    { tol: 12, last: { x: 220, y: 300 }, ortho: true, layers: new Set(['W']) });
  ok('with nothing on the axis it stays a bare axis point',
     bare.kind === 'ortho' && at(bare.y, 300) && at(bare.x, 122), `${bare.kind} ${bare.x},${bare.y}`);
}

sec('closing the loop');
{
  const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }];
  const s = snapAt(ix, { x: 4, y: 3 }, { tol: 10, points, last: points[3] });
  ok('near the first point offers to close', s.kind === 'close' && at(s.x, 0) && at(s.y, 0), s.kind);

  const few = snapAt(ix, { x: 4, y: 3 }, { tol: 10, points: points.slice(0, 2), last: points[1] });
  ok('but not with only two points down', few.kind !== 'close', few.kind);

  // Closing must survive the ortho lock, since it is an explicit act.
  const locked = snapAt(ix, { x: 4, y: 3 },
    { tol: 10, points, last: { x: 0, y: 80 }, ortho: true });
  ok('closing is still allowed while ortho is locked', locked.kind === 'close', locked.kind);

  const v = snapAt(ix, { x: 98, y: 4 }, { tol: 10, points, last: points[3] });
  ok('an earlier corner of the outline is snappable', v.kind === 'vertex', v.kind);
}

sec('a big drawing stays responsive');
{
  const many = [];
  for (let i = 0; i < 4000; i++) many.push({ x1: i % 200 * 7, y1: Math.floor(i / 200) * 7, x2: i % 200 * 7 + 6, y2: Math.floor(i / 200) * 7, layer: 'W' });
  const big = buildSnapIndex(many);
  const tb = process.hrtime.bigint();
  const big2 = buildSnapIndex(many);
  const buildMs = Number(process.hrtime.bigint() - tb) / 1e6;
  ok('indexing 4,000 segments (loose-end pass included) stays under 400ms',
     buildMs < 400, `${buildMs.toFixed(0)}ms`);
  const t0 = process.hrtime.bigint();
  for (let k = 0; k < 600; k++) snapAt(big2, { x: (k * 13) % 1400, y: (k * 7) % 140 }, { tol: 10 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  // 600 snaps is ten seconds of continuous mouse movement at 60Hz. The budget
  // that matters is per-snap: anything over ~16ms drops a frame.
  ok('600 snaps over 4,000 segments stay well inside the frame budget',
     ms < 150, `${ms.toFixed(1)}ms total, ${(ms / 600).toFixed(3)}ms per snap`);
}

// ---------------------------------------------------------------------------
// Tracing over an IMAGE. There is no line work at all — the only geometry is
// what the user has drawn — so every one of these runs against an empty index.
// ---------------------------------------------------------------------------
const empty = buildSnapIndex([], []);

sec('lining up with corners already placed');
{
  const corners = [{ x: 100, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 300 }];

  const bare = snapAt(empty, { x: 250, y: 250 }, { tol: 10, alignTo: corners });
  ok('nothing near, nothing to snap to', bare.kind === 'free', bare.kind);

  const a = snapAt(empty, { x: 404, y: 250 }, { tol: 10, alignTo: corners });
  ok('a corner directly above pulls the x', a.kind === 'align' && at(a.x, 400) && at(a.y, 250),
     `${a.kind} ${a.x},${a.y}`);
  ok('and says which corner it lined up with', a.align?.length === 1 && at(a.align[0].x, 400));

  // The fourth corner of a rectangle: nothing has ever been drawn there, but
  // two corners between them say exactly where it is.
  const c = snapAt(empty, { x: 103, y: 297 }, { tol: 10, alignTo: corners });
  ok('two alignments crossing give the missing corner exactly',
     c.kind === 'alignInt' && at(c.x, 100) && at(c.y, 300), `${c.kind} ${c.x},${c.y}`);
  ok('and names both corners it agreed with', c.align?.length === 2);

  // 5px off in x, 3px off in y. A single alignment could explain either one;
  // only the crossing explains both, and it is the one that should win.
  const both = snapAt(empty, { x: 105, y: 303 }, { tol: 10, alignTo: corners });
  ok('the crossing beats either alignment alone', both.kind === 'alignInt', both.kind);
}

sec('the right-angle lock, with nothing on the drawing to stop it');
{
  const corners = [{ x: 100, y: 100 }, { x: 400, y: 100 }];
  const last = { x: 400, y: 300 };

  const s = snapAt(empty, { x: 108, y: 304 }, { tol: 14, last, ortho: true, alignTo: corners });
  ok('carrying along the axis squares up with a corner',
     s.kind === 'alignInt' && at(s.x, 100) && at(s.y, 300), `${s.kind} ${s.x},${s.y}`);

  const free = snapAt(empty, { x: 260, y: 306 }, { tol: 10, last, ortho: true, alignTo: corners });
  ok('with no corner on the axis it stays a bare axis point',
     free.kind === 'ortho' && at(free.y, 300), `${free.kind} ${free.x},${free.y}`);
}

sec('the grid');
{
  const origin = { x: 100, y: 100 };
  const g = snapAt(empty, { x: 143, y: 217 }, { tol: 10, gridPx: 20, gridOrigin: origin });
  ok('lands on a whole increment from the origin',
     g.kind === 'grid' && at(g.x, 140) && at(g.y, 220), `${g.kind} ${g.x},${g.y}`);

  // Dead between two increments, with a tolerance far too small to reach
  // either. The grid still holds: it stands in for the free cursor rather than
  // competing at a radius, which is what "snap to a grid" has to mean.
  const between = snapAt(empty, { x: 150, y: 210 }, { tol: 4, gridPx: 20, gridOrigin: origin });
  ok('it holds even out of snapping range, because it replaces the free cursor',
     between.kind === 'grid', between.kind);

  // ...but it is still only a fallback. A real endpoint in range takes it.
  const real = snapAt(ix, { x: 218, y: 103 }, { tol: 10, gridPx: 20, gridOrigin: { x: 0, y: 0 } });
  ok('and anything real in range beats it', real.kind === 'end' && at(real.x, 220) && at(real.y, 100),
     `${real.kind} ${real.x},${real.y}`);

  const none = snapAt(empty, { x: 143, y: 217 }, { tol: 10, gridOrigin: origin });
  ok('no grid unless one is asked for', none.kind === 'free', none.kind);

  // Ortho lock plus grid: the axis fixes one coordinate, the grid rounds the
  // other, so the edge comes out a whole number of increments long.
  const last = { x: 100, y: 100 };
  const both = snapAt(empty, { x: 237, y: 104 },
    { tol: 10, last, ortho: true, gridPx: 20, gridOrigin: origin });
  ok('with the lock on, the grid rounds the free coordinate only',
     both.kind === 'grid' && at(both.x, 240) && at(both.y, 100), `${both.kind} ${both.x},${both.y}`);
}

sec('drawn geometry never outranks the drawing');
{
  // An endpoint of a real wall and an alignment with a placed corner, the same
  // distance from the cursor. The wall wins: it is a fact about the plan, the
  // alignment is a guess about intent.
  ok('an alignment is handicapped below an endpoint', HANDICAP.align > HANDICAP.end
     && PRIORITY.align > PRIORITY.end);
  ok('...and the grid below everything that came off the plan',
     HANDICAP.grid > HANDICAP.edge && HANDICAP.grid > HANDICAP.mid);
  ok('an alignment crossing sits just behind a real intersection',
     HANDICAP.alignInt > HANDICAP.int && HANDICAP.alignInt < HANDICAP.mid);

  const s = snapAt(ix, { x: 2, y: 102 }, { tol: 10, alignTo: [{ x: 4, y: 999 }] });
  ok('so a wall end beats a corner lined up just as close', s.kind === 'end', s.kind);

  // Closing the loop still beats everything, including a perfect alignment.
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
  const c = snapAt(empty, { x: 3, y: 2 }, { tol: 10, points: pts, alignTo: pts });
  ok('and closing the outline still beats an alignment', c.kind === 'close', c.kind);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
