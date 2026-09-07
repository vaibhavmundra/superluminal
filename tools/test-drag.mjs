// ---------------------------------------------------------------------------
// test-drag.mjs — THE LIFECYCLE, DRIVEN BY A FAKE POINTER.
//
// FOUR CLAIMS, AND THEY ARE NOT THIS FILE'S. They are the four rules stated in
// the header of src/lib/dragMove.js, which says outright that three separate
// implementations had already got the same rules wrong independently before it
// existed. src/hooks/useDrag.js is the LIFECYCLE round that arithmetic — the
// slop, the live modifier, the copy fork, the release — and the rules are the
// part of it that keeps being got wrong. So they are asserted by name:
//
//   RULE 1  A PRESS IS NOT A DRAG UNTIL IT HAS TRAVELLED. A press that never
//           exceeds the slop writes NOTHING — no position, no copy, no commit.
//   RULE 2  THE DELTA IS MEASURED FROM THE PRESS, NEVER FROM THE LAST FRAME.
//   RULE 3  THE ORTHO LOCK IS RE-DECIDED EVERY FRAME AND NAMES ITS FROZEN AXIS.
//   RULE 4  A COPY RESTORES ITS ORIGINALS.
//
// The sequence every block below drives is the one a hand actually makes: down,
// a small move, a big move, a modifier arriving MID-DRAG, and a release.
//
//   node tools/test-drag.mjs
// ---------------------------------------------------------------------------

import { makeDrag } from '../src/hooks/useDrag.js';
import { DRAG_SLOP_PX } from '../src/lib/dragMove.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const say = (t) => console.log('\n' + t);
const near = (a, b) => Math.abs(a - b) < 1e-9;
const atPt = (o, x, y) => near(o.x, x) && near(o.y, y);

/** A pointer event, with only the three fields any of this reads. */
const ev = (x, y, mod = {}) => ({ x, y, pointerId: 1, ...mod });

/**
 * A whole rig: two members in a list, a mutable gesture, and a log of every
 * write. `cfg` is merged over the ordinary case, so each block below states
 * only the thing it is about.
 */
function rig(cfg = {}, members = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 140, y: 100 }]) {
  const r = {
    list: members.map((m) => ({ ...m })),
    gesture: null,
    captured: 0,
    snapCalls: [],
    commits: [],
    copies: [],
    releases: [],
    frames: [],
  };
  const api = makeDrag({
    get: () => r.gesture,
    set: (v) => { r.gesture = typeof v === 'function' ? v(r.gesture) : v; },
    point: (e) => ({ x: e.x, y: e.y }),
    capture: () => { r.captured++; },
    at: (o) => ({ x: o.x, y: o.y }),
    to: (o, p) => ({ ...o, x: p.x, y: p.y }),
    setList: (fn) => { r.list = fn(r.list); },
    onCommit: (ids, d) => r.commits.push({ ids, moved: d.moved }),
    onCopy: (info) => r.copies.push(info),
    onRelease: (d) => r.releases.push({ moved: d.moved, copied: d.copied }),
    onMove: (p, ctx) => r.frames.push({ p, axis: ctx.axis, delta: ctx.delta }),
    ...cfg,
  });
  r.down = (x, y, mod) => api.down(ev(x, y, mod), { id: 'a', members });
  r.move = (x, y, mod) => api.move(ev(x, y, mod));
  r.up = () => api.up();
  r.get = (id) => r.list.find((o) => o.id === id);
  return r;
}

// ---------------------------------------------------------------------------
say('RULE 1 — A PRESS IS NOT A DRAG UNTIL IT HAS TRAVELLED (movedEnough)');
// "Every one of these objects is also SELECTABLE, and a press that both selects
//  a thing and nudges it three pixels is a press that quietly damages the
//  drawing while appearing to do what you asked."
{
  const r = rig();
  r.down(100, 100);
  ok(r.captured === 1,
    'rule 1: the press captures the pointer — a lamp dragged to the edge of the '
    + 'sheet releases outside the element the press landed on');
  ok(r.gesture && r.gesture.moved === false,
    'rule 1: the press arms the gesture and does not start it');

  // A SMALL MOVE: inside DRAG_SLOP_PX of the press.
  r.move(100 + (DRAG_SLOP_PX - 1), 100);
  ok(atPt(r.get('a'), 100, 100) && atPt(r.get('b'), 140, 100),
    `rule 1: a press that never exceeds the slop (${DRAG_SLOP_PX} screen px) writes NOTHING`);
  ok(r.gesture.moved === false, 'rule 1: and the gesture is still not a drag');
  ok(r.frames.length === 0,
    'rule 1: nothing at all happens before the slop — no write, no guides, no frame');

  // ...AND NOT EVEN WITH THE MODIFIER DOWN. A press that has not travelled must
  // not mint an invisible duplicate stacked exactly on its original.
  const c = rig({ copy: true, mintId: (n) => `twin${n}` });
  c.down(100, 100);
  c.move(101, 100, { altKey: true });
  ok(c.list.length === 2 && c.copies.length === 0,
    'rule 1 before rule 4: a press inside the slop mints no twin, however the '
    + 'modifier is held — an invisible duplicate doubles a schedule line');

  // A BIG MOVE: past it, and the flag latches.
  r.move(120, 100);
  ok(atPt(r.get('a'), 120, 100),
    'rule 1: past the slop it is a drag, because somebody has visibly asked for one');
  ok(r.gesture.moved === true, 'rule 1: and the flag latches');
  // "A drag that came back to within three pixels of its origin is still a drag."
  r.move(101, 100);
  ok(r.gesture.moved === true && atPt(r.get('a'), 101, 100),
    'rule 1: the flag STAYS latched — a drag that came back inside the slop is still a drag');

  // THE RELEASE. A gesture that never travelled commits nothing.
  const n = rig();
  n.down(100, 100);
  n.move(101, 100);
  n.up();
  ok(n.commits.length === 0,
    'rule 1: a press that never travelled validates no drop — committing one '
    + 'marks a fitting "moved by hand" for a gesture nobody made');
  ok(n.releases.length === 1,
    'rule 1: but the release still tidies up — the guides belong to the gesture');
  ok(n.gesture === null, 'rule 1: and the gesture is cleared on release');

  // THE THRESHOLD IS IN SCREEN PIXELS, over the zoom: the wobble that arrives
  // with a click is the same three pixels at any scale.
  const z = rig({ zoom: 10 });
  z.down(100, 100);
  z.move(100.5, 100);
  ok(!atPt(z.get('a'), 100, 100),
    'rule 1: the slop is SCREEN pixels over the zoom — half a plan pixel at 10x '
    + 'is five on screen, which is a drag');
}

// ---------------------------------------------------------------------------
say('RULE 2 — THE DELTA IS MEASURED FROM THE PRESS, NEVER FROM THE LAST FRAME');
// "Accumulating per-frame offsets drifts, and a row of fittings that no longer
//  line up after a long drag is a row somebody has to fix by hand."
{
  const r = rig();
  r.down(100, 100);
  // Out in four frames and back in one. Accumulated, this member would be at
  // 100 + 20 + 20 + 20 + 20 - 50 = 130. From the press it is at 110.
  r.move(120, 100); r.move(140, 100); r.move(160, 100); r.move(180, 100);
  r.move(110, 100);
  ok(atPt(r.get('a'), 110, 100),
    'rule 2: five frames out and back land the member where ONE delta from the '
    + 'press puts it, not where the sum of the frames would');
  ok(atPt(r.get('b'), 150, 100),
    'rule 2: and the group keeps its exact relationship — 40 apart at the press, '
    + '40 apart after a long drag');
  ok(near(r.frames.at(-1).delta.dx, 10) && near(r.frames.at(-1).delta.dy, 0),
    'rule 2: the delta handed to the caller is deltaFrom(press, now) and nothing else');
  // THE ANCHOR IS NEVER REWRITTEN, which is the whole of the rule.
  ok(atPt(r.gesture.start, 100, 100) && atPt(r.gesture.startAll.a, 100, 100),
    'rule 2: the press-time anchor and snapshots are untouched by any number of frames');

  // WHERE INSIDE THE THING IT WAS GRABBED is held for the length of the gesture,
  // so the member does not jump to centre itself under the cursor.
  const g = rig();
  g.down(130, 100);              // 30 px right of member a's centre
  g.move(160, 100);
  ok(atPt(g.get('a'), 130, 100),
    'rule 2: the grab offset is subtracted from every later pointer position — '
    + 'a lamp grabbed off-centre does not jump on the first move');
}

// ---------------------------------------------------------------------------
say('RULE 3 — THE ORTHO LOCK IS RE-DECIDED EVERY FRAME AND NAMES ITS FROZEN AXIS');
// "Latching on the first pixel makes a drag that starts sideways and turns
//  vertical impossible; and a caller that is not TOLD which axis was frozen
//  will snap it and draw a guide for it, claiming an alignment the modifier
//  made."
{
  const seen = [];
  const r = rig({
    ortho: true,
    snap: (p, axis) => { seen.push({ p, axis }); return p; },
  });
  r.down(100, 100);

  // SIDEWAYS FIRST: travelled further across than down, so `y` freezes.
  r.move(160, 130, { shiftKey: true });
  ok(atPt(r.get('a'), 160, 100),
    'rule 3: whichever axis has travelled further wins — a sideways drag holds y');
  ok(r.frames.at(-1).axis === 'y',
    'rule 3: and the frozen axis is NAMED, so the caller can keep a guide off it — '
    + 'a guide drawn for a held axis takes credit for the modifier\'s work');

  // THEN VERTICAL, IN THE SAME GESTURE: it must switch over as it crosses the
  // diagonal rather than staying latched on the first pixel.
  r.move(130, 200, { shiftKey: true });
  ok(atPt(r.get('a'), 100, 200),
    'rule 3: re-decided every frame — a drag that sets off sideways and turns '
    + 'vertical switches over as it crosses the diagonal');
  ok(r.frames.at(-1).axis === 'x', 'rule 3: and it renames the frozen axis to x');

  // THE MODIFIER IS READ LIVE, so letting go of it mid-drag frees both axes.
  r.move(130, 200);
  ok(atPt(r.get('a'), 130, 200) && r.frames.at(-1).axis === null,
    'rule 3: the lock is read live off each move — releasing shift frees both axes '
    + 'and names nothing');

  // AND THE LOCK IS APPLIED BEFORE THE SNAP, which is the load-bearing order:
  // snapping first would let something four feet away pull the point off the
  // line the modifier had just held it to.
  ok(seen.length === 3 && atPt(seen[0].p, 160, 100) && seen[0].axis === 'y',
    'rule 3: the snap is handed the ALREADY-LOCKED point and the frozen axis, '
    + 'in that order — lock first, snap second');

  // THE LINE IS HELD TO THE PRESS, not to the last frame: rule 2 said about
  // rule 3, which is what keeps a long locked drag on one line.
  const l = rig({ ortho: true });
  l.down(100, 100);
  l.move(200, 140, { shiftKey: true }); l.move(300, 180, { shiftKey: true });
  ok(atPt(l.get('a'), 300, 100),
    'rule 3 on rule 2: the lock is anchored at the press, so a locked drag is on '
    + 'the same line however long it goes on');

  // AN OBJECT THAT DOES NOT HONOUR THE MODIFIER IS UNAFFECTED BY IT. `ortho` is
  // a fact about the object — an array is set out on a geometry and a plate
  // slides along walls.
  const f = rig({ ortho: false });
  f.down(100, 100);
  f.move(160, 130, { shiftKey: true });
  ok(atPt(f.get('a'), 160, 130) && f.frames.at(-1).axis === null,
    'rule 3: an object that does not honour the shift lock freezes nothing and '
    + 'names nothing, modifier or no modifier');
}

// ---------------------------------------------------------------------------
say('RULE 4 — A COPY RESTORES ITS ORIGINALS (forkCopy)');
// "The modifier is read live off each move — 'drag then Option' is how people
//  actually reach for it — so by the time it arrives the original may be half
//  way across the room, and leaving it there makes one gesture both move a
//  thing and copy it."
{
  const r = rig({ copy: true, mintId: (n) => `twin${n}` });
  r.down(100, 100);
  // A BIG MOVE FIRST, with no modifier: both originals are now well away from
  // where they were picked up.
  r.move(300, 260);
  ok(atPt(r.get('a'), 300, 260) && atPt(r.get('b'), 340, 260),
    'rule 4 setup: the drag has carried both originals half way across the room');

  // ...AND THEN THE MODIFIER ARRIVES, MID-DRAG.
  r.move(310, 270, { altKey: true });
  ok(atPt(r.get('a'), 100, 100) && atPt(r.get('b'), 140, 100),
    'rule 4: an Option-copy restores EVERY original to its press-time position — '
    + 'leaving them where they had got to makes one gesture both move and copy');
  ok(r.list.length === 4, 'rule 4: and the twins are added, one per member');
  ok(atPt(r.get('twin0'), 310, 270) && atPt(r.get('twin1'), 350, 270),
    'rule 4: the twins carry the whole delta from the press, and keep the group\'s '
    + 'exact relationship');

  // THE TWIN IS WHAT KEEPS MOVING, and the anchor is untouched.
  ok(r.gesture.id === 'twin0' && r.gesture.group.join() === 'twin0,twin1',
    'rule 4: the drag transfers to the twin of the thing under the pointer');
  ok(atPt(r.gesture.start, 100, 100),
    'rule 4: the anchor stays the ORIGINAL\'s position, so later frames go on '
    + 'taking one delta from the press');
  ok(r.copies.length === 1 && r.copies[0].twinOf.a === 'twin0',
    'rule 4: the caller is told which twin each original became, so it can retarget '
    + 'the selection');

  // ONCE MADE, IT STAYS MADE: letting go of Option does not un-create the twin
  // or hand the drag back to the original.
  r.move(400, 300);
  ok(r.list.length === 4 && atPt(r.get('a'), 100, 100) && atPt(r.get('twin0'), 400, 300),
    'rule 4: once made it stays made — releasing Option carries on moving the twin '
    + 'and does not restore it to the original');

  // AND ONLY ONCE. A modifier held down for forty frames is one copy.
  r.move(410, 300, { altKey: true });
  ok(r.list.length === 4 && r.copies.length === 1,
    'rule 4: the fork happens once per gesture, not once per frame');

  // THE ORIGINALS STAY LIVE SNAP TARGETS, because the twins' ids are minted
  // before the target is resolved and are not in the list yet.
  const s = rig({ copy: true, mintId: (n) => `twin${n}`, snap: (p, axis, ctx) => {
    s.excluded = ctx.ids; return p;
  } });
  s.down(100, 100);
  s.move(200, 100, { altKey: true });
  ok(s.excluded && s.excluded.join() === 'twin0,twin1',
    'rule 4: the snap is told to exclude the TWINS — which are not in the list yet, '
    + 'so nothing is excluded and the ORIGINALS stay live targets');

  // AN OBJECT WITH NO COPY GESTURE DOES NOT GET ONE BY ACCIDENT.
  const p = rig();
  p.down(100, 100);
  p.move(200, 100, { altKey: true });
  ok(p.list.length === 2 && atPt(p.get('a'), 200, 100),
    'rule 4: an object that does not support Option-copy just moves, modifier or no');
}

// ---------------------------------------------------------------------------
say('THE REST OF THE LIFECYCLE — the release, and a drop that is refused');
{
  // A DROP THE CALLER REJECTS SNAPS BACK, from the press-time snapshots.
  const r = rig({
    onCommit: (ids, d) => {
      // A lamp dropped off every ceiling goes back where it came from.
      r.list = r.list.map((o) => (o.x > 500 && d.startAll[o.id]
        ? { ...d.startAll[o.id] } : o));
    },
  });
  r.down(100, 100);
  r.move(900, 100);
  ok(atPt(r.get('a'), 900, 100), 'the drag went where it was pushed');
  r.up();
  ok(atPt(r.get('a'), 100, 100) && atPt(r.get('b'), 140, 100),
    'an invalid drop snaps back to the press-time snapshots — the same ones rule 2 '
    + 'takes its delta from and rule 4 restores from');
  ok(r.gesture === null, 'and the gesture is cleared on release either way');

  // NO THRESHOLD AT ALL is a position a caller may take: the door box is not
  // selectable, so there is no click meaning to protect.
  const n = rig({ slopPx: 0 });
  n.down(100, 100);
  n.move(100.5, 100);
  ok(atPt(n.get('a'), 100.5, 100),
    'slopPx 0 means the first move is the drag — the door box has no click to protect');

  // A GESTURE THAT DOES NOT CARRY ITS MEMBERS WRITES NOTHING TO THEM. One press
  // on a ceiling object can mean move, resize or rotate; only the first is a
  // translation, and only the first may leave a copy behind.
  let snapped = 0;
  const h = rig({ moves: () => false, copy: true, ortho: true,
                  mintId: (n2) => `twin${n2}`, snap: (q) => { snapped++; return q; } });
  h.down(130, 100);              // grabbed 30 px off centre
  h.move(200, 100, { altKey: true, shiftKey: true });
  ok(h.list.length === 2 && atPt(h.get('a'), 100, 100) && h.frames.length === 1,
    'a frame that is not a translation moves nothing and forks nothing — but the '
    + 'caller still gets the frame');
  ok(snapped === 0 && h.frames[0].axis === null && h.frames[0].delta === null,
    'and it resolves NOTHING: no snap, no guides, no lock, no delta — a corner '
    + 'being dragged is not a thing going anywhere');
  ok(atPt(h.frames[0].p, 200, 100),
    'the caller gets the RAW pointer, not a point pulled back by the grab offset — '
    + 'a resize reads the corner where the hand is');

  // AND A HOOK WITH NO STORE WRITES NOTHING AND STILL RUNS THE LIFECYCLE: five
  // of the ten drags write an override in a map, or nothing until the release.
  const o = rig({ setList: undefined });
  o.down(100, 100);
  o.move(200, 140);
  ok(atPt(o.get('a'), 100, 100) && atPt(o.frames.at(-1).p, 200, 140),
    'with no store the hook writes nothing and hands the caller the resolved point');
  o.up();
  ok(o.commits.length === 1 && o.commits[0].ids.join() === 'a,b',
    'and the release still validates the drop, naming who moved');
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
