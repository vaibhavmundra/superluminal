// ---------------------------------------------------------------------------
// test-point.mjs — THE POINT PRIMITIVE, DRIVEN BY A FAKE POINTER.
//
// WHAT IS ASSERTED HERE IS NOT THE FOUR RULES. Those are lib/dragMove.js's, they
// are stated in its header and driven by tools/test-drag.mjs, and a point
// inherits them by handing that file its two adapters rather than by
// reimplementing anything. What is asserted here is what a POINT adds:
//
//   KIND     the two kinds are read off the record, and a constrained point
//            carries no coordinate to disagree with its fraction.
//   HELD     a constrained point moves ONLY on its host, whatever the pointer
//            does, and what is written is the fraction and nothing else.
//   GATE 1   a constrained point takes NO ortho lock. A free one takes it.
//   GATE 2   a constrained point takes NO snap, and says so at the press.
//   GATE 3   a point with no host cannot be pressed.
//   VETO     a domain's `clamp` may refuse a landing, and a refusal leaves the
//            point where it was rather than sliding it somewhere free.
//   COPY     a twin of a constrained point is on the same host, and the
//            original goes back to the fraction it was picked up at.
//   DELETE   the gesture holding a point is abandoned BEFORE it is removed, or
//            the next frame writes it back from the press-time snapshot.
//   GROUP    one delta, every point's own constraint.
//   ALIAS    the module's three u-functions are this primitive's, not copies.
//
//   node tools/test-point.mjs
// ---------------------------------------------------------------------------

import {
  FREE, ON_PATH, pointKind, isConstrained, orthoFor, freePoint, pointOn,
  clampU, uAt, atU, resolvePoint, constrainPoint, pointAdapters,
  movePoints, copyPoints, deletePoints, pointsOn, orphanPoints,
  attachPoint, detachPoint,
} from '../src/lib/point.js';
import { makePointDrag } from '../src/hooks/usePoint.js';
import { clampU as trackClampU, uAt as trackUAt, moduleAt } from '../src/lib/magTrack.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const say = (t) => console.log('\n' + t);
const near = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

/** A horizontal host, 100 long, and a vertical one somewhere else. */
const H = { id: 'h', pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }], closed: false };
const V = { id: 'v', pts: [{ x: 200, y: 0 }, { x: 200, y: 100 }], closed: false };
const HOSTS = { h: H, v: V };
const hostFor = (pt) => HOSTS[pt?.on] ?? null;

const ev = (x, y, mod = {}) => ({ x, y, pointerId: 1, ...mod });

/**
 * A rig: a list of points, a mutable gesture, and a log of what was asked of
 * the caller. `cfg` is merged over the ordinary case so each block below states
 * only the thing it is about.
 */
function rig(cfg = {}, members = null) {
  const list = members ?? [
    freePoint({ x: 100, y: 100 }, { id: 'f' }),
    pointOn('h', 0.5, { id: 'c' }),
  ];
  const r = {
    list: list.map((p) => ({ ...p })),
    gesture: null,
    snapCalls: [],
    snapOff: 0,
    copies: [],
    frames: [],
  };
  const api = makePointDrag({
    get: () => r.gesture,
    set: (v) => { r.gesture = typeof v === 'function' ? v(r.gesture) : v; },
    point: (e) => ({ x: e.x, y: e.y }),
    hostFor,
    setList: (fn) => { r.list = fn(r.list); },
    mintId: (n) => `twin${n}`,
    snap: (p, axis, ctx) => { r.snapCalls.push({ p, axis }); return p; },
    onSnapOff: () => { r.snapOff++; },
    onCopy: (info) => r.copies.push(info),
    onMove: (p, ctx) => r.frames.push({ p, axis: ctx.axis }),
    ...cfg,
  });
  r.api = api;
  r.get = (id) => r.list.find((p) => p.id === id);
  r.down = (id, x, y, mod) => api.down(ev(x, y, mod),
    { id, members: r.list.filter((p) => p.id === id) });
  r.downAll = (id, x, y, mod) => api.down(ev(x, y, mod), { id, members: r.list });
  r.move = (x, y, mod) => api.move(ev(x, y, mod));
  r.up = () => api.up();
  return r;
}

// ---------------------------------------------------------------------------
say('KIND — read off the record, with nothing to disagree with it');
{
  const f = freePoint({ x: 3, y: 4 }, { id: 'f' });
  const c = pointOn('h', 0.25, { id: 'c' });
  ok(pointKind(f) === FREE && pointKind(c) === ON_PATH, 'both kinds are named');
  ok(!isConstrained(f) && isConstrained(c), 'and told apart by their host');
  ok(c.x === null && c.y === null,
    'a constrained point carries NO coordinate — a stale one is a lie that saves');
  ok(f.on === null && f.u === null, 'and a free one carries no fraction');
  ok(orthoFor(f) && !orthoFor(c),
    'shift is offered to a free point and refused to a held one');
  ok(clampU(1.4) === 1 && clampU(-2) === 0 && clampU('x') === 0,
    'a fraction is held inside its own path');

  const at = resolvePoint(c, H);
  ok(at && near(at.x, 25) && near(at.y, 0), 'a fraction resolves to a position');
  ok(at.ux === 1 && at.uy === 0,
    'with the direction the path is heading — a body has to lie ALONG the run');
  ok(resolvePoint(c, null) === null,
    'and to NULL with no host: not on the drawing, rather than at the origin');
  ok(resolvePoint({ id: 'x' }, null) === null, 'as does a free point with no coordinate');
}

// ---------------------------------------------------------------------------
say('HELD — a constrained point moves only on its host');
{
  const r = rig();
  r.down('c', 50, 0);
  r.move(80, 40);
  const c = r.get('c');
  ok(near(c.u, 0.8), 'the pointer at (80,40) writes u = 0.8 — projected, not placed');
  ok(c.x === null && c.y === null, 'and writes no coordinate');
  const at = r.api.resolve(c);
  ok(near(at.y, 0), 'so the point is ON the host, forty units from the pointer');
  r.move(-50, -50);
  ok(near(r.get('c').u, 0), 'a pointer off the near end pins it to the start');
  r.move(400, 400);
  ok(near(r.get('c').u, 1), 'and off the far end, to the finish');
  r.up();
  ok(r.gesture === null, 'the release clears the gesture');
}
{
  /* GRABBED AWAY FROM ITS OWN POINT, which is the ordinary case: the thing
     under the hand is a fitting's BODY and the point is somewhere inside it.
     The offset is kept for the length of the gesture — dragMove.js's
     `grabOffset` — so a held point does not jump to centre itself under the
     cursor on the first move any more than a free one does. */
  const r = rig();
  r.down('c', 25, 12);            // pressed 25 short of the point, 12 above the run
  r.move(85, 12);
  ok(near(r.get('c').u, 1.0), 'a press off the point keeps its offset: +60 from u = 0.5');
  const g = rig({ grab: false });
  g.down('c', 25, 12);
  g.move(85, 12);
  ok(near(g.get('c').u, 0.85), 'and a caller that wants the pointer itself says so');
}

// ---------------------------------------------------------------------------
say('GATE 1 — a constrained point takes no ortho lock; a free one does');
{
  /* THE PRESS IS AT u = 0.5, THE POINTER GOES TO (80,40), AND THE VERTICAL IS
     THE FURTHER TRAVEL — 40 down against 30 across. A lock would freeze x at
     the press, hand (50,40) to the projection, and land the point back on 0.5:
     the gesture would look broken while the modifier quietly held it still. */
  const r = rig();
  r.down('c', 50, 0);
  r.move(80, 40, { shiftKey: true });
  ok(near(r.get('c').u, 0.8),
    'shift does not hold it: u = 0.8, the same answer as without the key');
  ok(r.frames[r.frames.length - 1].axis === null,
    'and no axis is claimed, so nothing can draw a guide for one');
}
{
  const r = rig();
  r.down('f', 100, 100);
  r.move(130, 140, { shiftKey: true });
  const f = r.get('f');
  ok(near(f.x, 100) && near(f.y, 140),
    'a FREE point is held to the column — 40 down beats 30 across');
  ok(r.frames[r.frames.length - 1].axis === 'x', 'and the frozen axis is named');
  r.move(140, 130, { shiftKey: true });
  ok(near(r.get('f').y, 100),
    'and it is re-decided every frame, not latched on the first pixel');
}
{
  const r = rig({ ortho: false });
  r.down('f', 100, 100);
  r.move(130, 140, { shiftKey: true });
  ok(near(r.get('f').x, 130), 'a caller may switch the lock off for its free points too');
}

// ---------------------------------------------------------------------------
say('GATE 2 — a constrained point takes no snap, and says so at the press');
{
  const r = rig();
  r.down('c', 50, 0);
  ok(r.snapOff === 1, 'the press reports that this drag will draw no guides');
  r.move(80, 40);
  ok(r.snapCalls.length === 0,
    'and the snap is never asked: an alignment the projection then leaves is a false claim');
  r.down('f', 100, 100);
  ok(r.snapOff === 1, 'a free press reports nothing');
  r.move(130, 140);
  ok(r.snapCalls.length === 1, 'and DOES reach the snap');
}

// ---------------------------------------------------------------------------
say('GATE 3 — a point with no host cannot be pressed');
{
  const r = rig({}, [pointOn('gone', 0.5, { id: 'x' })]);
  const d = r.down('x', 10, 10);
  ok(d === null, 'the press is declined and says so, so a caller can let the event through');
  ok(r.gesture === null, 'no gesture is started');
  r.move(400, 400);
  ok(r.get('x').u === 0.5, 'and the frame that follows writes nothing');
}
{
  const r = rig({}, [pointOn('gone', 0.5, { id: 'x' }), freePoint({ x: 0, y: 0 }, { id: 'f' })]);
  r.downAll('f', 0, 0);
  r.move(30, 30);
  ok(near(r.get('f').x, 30) && r.get('x').u === 0.5,
    'a hostless point carried in a group is left untouched rather than thrown to the origin');
}

// ---------------------------------------------------------------------------
say('VETO — a domain may refuse a landing, and a refusal moves nothing');
{
  const quarters = (u) => Math.round(u * 4) / 4;
  const r = rig({ clamp: (u) => quarters(u) });
  r.down('c', 50, 0);
  r.move(80, 0);
  ok(near(r.get('c').u, 0.75), 'a clamp that rounds puts the point where it says');
  const full = rig({ clamp: () => null });
  full.down('c', 50, 0);
  full.move(80, 0);
  ok(near(full.get('c').u, 0.5),
    'and NULL leaves it exactly where it was — the run is full, so nothing lands');
}

// ---------------------------------------------------------------------------
say('COPY — a twin of a held point is on the same host, at the new fraction');
{
  const r = rig();
  r.down('c', 50, 0);
  r.move(60, 0);                       // a plain frame first
  r.move(80, 40, { altKey: true });    // ...then the modifier arrives
  const twin = r.get('twin0');
  ok(near(r.get('c').u, 0.5),
    'the original is back at the fraction it was picked up at — rule 4');
  ok(twin && twin.on === 'h', 'the twin is on the same host');
  ok(near(twin.u, 0.8), 'at the fraction the pointer had reached');
  ok(twin.x === null && twin.y === null, 'and carries no coordinate either');
  ok(r.copies.length === 1 && r.copies[0].ids[0] === 'twin0',
    'and the caller is told, once, which ids it now owns');
  r.move(90, 40);
  ok(near(r.get('twin0').u, 0.9) && near(r.get('c').u, 0.5),
    'the rest of the gesture carries the TWIN and leaves the original alone');
}
{
  const r = rig();
  r.down('f', 100, 100);
  r.move(130, 140, { altKey: true, shiftKey: true });
  ok(near(r.get('f').x, 100) && near(r.get('f').y, 100), 'a free original is restored too');
  ok(near(r.get('twin0').x, 100) && near(r.get('twin0').y, 140),
    'and an option+shift twin comes out exactly level with what it came from');
}

// ---------------------------------------------------------------------------
say('DELETE — the gesture lets go first, or the next frame resurrects it');
{
  const r = rig();
  r.down('c', 50, 0);
  r.move(80, 0);
  r.api.remove('c');
  ok(r.gesture === null, 'the gesture holding it is abandoned');
  ok(!r.get('c'), 'and it is gone from the store');
  r.move(90, 0);
  ok(!r.get('c'), 'so the frame that follows cannot write it back from the snapshot');
}
{
  const r = rig();
  r.downAll('f', 100, 100);
  r.api.remove('c');
  ok(r.gesture === null,
    'any member of the group abandons it, not only the one under the pointer');
}
{
  const r = rig({}, [
    pointOn('h', 0.2, { id: 'a' }), pointOn('h', 0.8, { id: 'b' }),
    pointOn('v', 0.5, { id: 'c' }), freePoint({ x: 1, y: 1 }, { id: 'f' }),
  ]);
  r.down('a', 20, 0);
  r.move(60, 0);
  r.api.removeOn('h');
  ok(r.list.length === 2 && !r.get('a') && !r.get('b'),
    'a host takes the points held on it with it');
  ok(r.get('c') && r.get('f'), 'and nothing else');
  ok(r.gesture === null, 'and a drag on one of them is abandoned first, same as `remove`');
  r.move(90, 0);
  ok(!r.get('a'), 'so the next frame cannot bring it back');
}

// ---------------------------------------------------------------------------
say('GROUP — one delta, every point\'s own constraint');
{
  const members = [
    freePoint({ x: 10, y: 10 }, { id: 'f' }),
    pointOn('h', 0.1, { id: 'a' }),
    pointOn('v', 0.1, { id: 'b' }),
  ];
  const startAll = Object.fromEntries(members.map((m) => [m.id, { ...m }]));
  const out = movePoints(members, startAll, { dx: 20, dy: 20 }, hostFor);
  const by = Object.fromEntries(out.map((p) => [p.id, p]));
  ok(near(by.f.x, 30) && near(by.f.y, 30), 'the free one translates');
  ok(near(by.a.u, 0.3),
    'the one on the horizontal slides 20 along it and ignores the 20 across');
  ok(near(by.b.u, 0.3), 'the one on the vertical does the opposite, on its OWN host');

  const forked = copyPoints(members, startAll, { dx: 20, dy: 20 },
    (n) => `t${n}`, hostFor);
  const kept = forked.list.find((p) => p.id === 'a');
  ok(near(kept.u, 0.1), 'a group copy restores every original');
  ok(forked.twins.length === 3 && forked.twins.every((t) => t.id.startsWith('t')),
    'and mints one twin each');

  ok(deletePoints(members, ['a', 'b']).length === 1, 'delete takes a list');
  ok(deletePoints(members, new Set(['f'])).length === 2, '...or a Set');
  ok(deletePoints(members, 'f').length === 2, '...or one id');
}

// ---------------------------------------------------------------------------
say('HOSTS — attaching, detaching, and what a deleted host leaves behind');
{
  const f = freePoint({ x: 30, y: 25 }, { id: 'f' });
  const held = attachPoint(f, H);
  ok(held.on === 'h' && near(held.u, 0.3),
    'a free point dropped on a host lands nearest to where it already was');
  ok(held.x === null, 'and gives up its coordinate');
  ok(attachPoint(f, null).on === null, 'with no host it stays free');

  const freed = detachPoint(held, H);
  ok(freed.on === null && near(freed.x, 30) && near(freed.y, 0),
    'detaching keeps the position it was HOLDING, not the one it arrived with');
  ok(detachPoint(held, null).on === 'h',
    'and a point whose host cannot place it is left held rather than freed to the origin');

  const list = [held, pointOn('gone', 0.5, { id: 'z' }), f];
  ok(pointsOn(list, 'h').length === 1, 'the points on a host can be found');
  const orphans = orphanPoints(list, (id) => id === 'h');
  ok(orphans.length === 1 && orphans[0].id === 'z',
    'and so can the ones whose host has gone — saved, billed, and never drawn');
}

// ---------------------------------------------------------------------------
say('ADAPTERS AND ALIAS — the two functions dragMove.js asks for, and one u');
{
  const unit = pointAdapters(hostFor);
  ok(near(unit.at(pointOn('h', 0.4)).x, 40), '`at` resolves a member for the delta');
  ok(near(unit.to(pointOn('h', 0.4), { x: 70, y: 9 }).u, 0.7), '`to` puts it back under its rule');
  ok(unit.to(pointOn('gone', 0.4), { x: 70, y: 9 }).u === 0.4,
    'and refuses a member it cannot place, so a meaningless delta is never stored');
  ok(constrainPoint(freePoint({ x: 0, y: 0 }), { x: 5, y: 6 }).x === 5,
    'a free point takes the position it is given');
  ok(constrainPoint(freePoint({ x: 1, y: 2 }), { x: NaN, y: 0 }).x === 1,
    'and a position that is not one is refused');

  ok(trackClampU === clampU && trackUAt === uAt && moduleAt === atU,
    "the module's three u-functions ARE the primitive's — aliases, not copies");
  ok(near(uAt(H.pts, { x: 25, y: 60 }), 0.25) && atU(H.pts, 0.25).x === 25,
    'and they still answer as lib/magTrack.js documented them');
  ok(atU([], 0.5) === null, 'including the null for a path that is not one');
}

console.log('\n' + (fail ? `FAILED ${fail}` : 'all good'));
process.exit(fail ? 1 : 0);
