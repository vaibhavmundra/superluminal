// ---------------------------------------------------------------------------
// test-press-owner.mjs — WHICH MACHINE OWNS THIS PRESS.
//
// SIX CLAIMS, and every assertion below belongs to one of them:
//
//   1. THE ANSWER IS TOTAL AND SINGULAR. Every state names exactly one machine
//      from the roster, and a state nobody claims is `grab` rather than null.
//   2. THE BRANCH CHAIN IS THE DOCUMENTED PRECEDENCE. Enumerated over the whole
//      truth table against a reference built from `PRECEDENCE` alone — so a
//      branch moved in the function without moving in the list is a failure
//      here rather than a bug found by reading eight hundred lines.
//   3. THE BAR OPEN IS NOT THE TOOL ARMED. `shapeMenuOn` with no primitive
//      picked owns nothing; it is the state a rail cell and a space click both
//      leave the geometry bar in. THIS IS THE DIFFUSER BUG.
//   4. NOTHING ON THE DRAWING IS GRABBABLE WHILE A TOOL IS IN HAND.
//   5. `dragging` CHANGES NO ANSWER. It is in the signature and not in the
//      ranking — see the note in the module.
//   6. THE TWO DELIBERATE EXEMPTIONS ARE EXEMPTIONS AND NOT THE RULE. The spot
//      tool and the module tool both let a press reach a fitting this function
//      says belongs to `tool`; that disagreement is theirs to declare at the
//      call site, and it must not be quietly folded in here.
//
//   node tools/test-press-owner.mjs
// ---------------------------------------------------------------------------

import { pressOwner, owns, canGrab, MACHINES, PRECEDENCE } from '../src/lib/pressOwner.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const say = (t) => console.log('\n' + t);

/** One state per machine, holding nothing else. */
const ALONE = {
  door:   { doorEdit: true },
  shape:  { shapeMenuOn: true, shapeTool: 'rect' },
  board:  { boardPlace: true },
  tool:   { addTool: 'cob' },
  object: { armed: 'fan' },
  zone:   { zoneMode: true },
  grab:   {},
};

say('-- 1. the answer is total, and it is one of the seven --');
{
  for (const m of MACHINES) {
    ok(pressOwner(ALONE[m]) === m, `${m} alone owns the press`);
  }
  ok(pressOwner() === 'grab', 'no state at all is a press on bare plan, not a crash');
  ok(pressOwner({}) === 'grab', '...and neither is an empty state');
  /* THE ROSTER AND THE RANKING HOLD THE SAME NAMES. They are two lists and they
     are allowed to be in different orders — the roster is names, the ranking is
     precedence — but a name in one and not the other is a machine that either
     cannot be returned or cannot be ranked. */
  ok(MACHINES.length === PRECEDENCE.length
    && MACHINES.every((m) => PRECEDENCE.includes(m)),
    'the roster and the ranking name the same seven machines');
  ok(PRECEDENCE[PRECEDENCE.length - 1] === 'grab',
    'grab is last and unconditional, which is what makes the answer total');
}

say('-- 2. the branch chain IS the documented precedence --');
{
  /* THE REFERENCE IS BUILT FROM `PRECEDENCE` AND NOTHING ELSE, which is the
     point of it: if somebody reorders the `if`s in the function without
     reordering the list beside them, these 64 rows say so. */
  const FLAG = {
    door:   (s) => s.doorEdit,
    shape:  (s) => s.shapeMenuOn && s.shapeTool,
    board:  (s) => s.boardPlace,
    tool:   (s) => s.addTool,
    object: (s) => s.armed,
    zone:   (s) => s.zoneMode,
    grab:   () => true,
  };
  const expected = (s) => PRECEDENCE.find((m) => FLAG[m](s));

  const BITS = ['door', 'shape', 'board', 'tool', 'object', 'zone'];
  let rows = 0, bad = [];
  for (let mask = 0; mask < (1 << BITS.length); mask++) {
    const s = {};
    BITS.forEach((b, i) => { if (mask & (1 << i)) Object.assign(s, ALONE[b]); });
    rows++;
    const got = pressOwner(s), want = expected(s);
    if (got !== want) bad.push(`${JSON.stringify(s)} -> ${got}, wanted ${want}`);
  }
  ok(rows === 64, `the truth table is complete — ${rows} states over six flags`);
  ok(bad.length === 0,
    bad.length ? `${bad.length} rows disagree with PRECEDENCE: ${bad[0]}` : 'every row agrees with PRECEDENCE');

  // The pairs worth naming, because each one is a rank somebody could argue with.
  ok(owns({ doorEdit: true, shapeMenuOn: true, shapeTool: 'rect' }, 'door'),
    'the door editor outranks an armed primitive — it never falls through');
  ok(owns({ shapeMenuOn: true, shapeTool: 'rect', boardPlace: true }, 'shape'),
    'an armed primitive outranks the switchboard step');
  ok(owns({ boardPlace: true, addTool: 'cob' }, 'board'),
    'the switchboard step outranks an armed tool');
  ok(owns({ addTool: 'cob', armed: 'fan' }, 'tool'),
    'an armed tool outranks an armed ceiling object');
  ok(owns({ armed: 'fan', zoneMode: true }, 'object'),
    'an armed ceiling object outranks the no-light zone band');
}

say('-- 3. the bar open is not the tool armed (THE DIFFUSER BUG) --');
{
  /* THE NAMED ONE. With a module armed the geometry bar is still open and
     UNARMED, and the press belongs to the tool. When `shapeToolDown` did not
     test `addTool` it took the track under the pointer as a draft instead, and
     the track diffuser and the track spot were completely unplaceable. */
  ok(pressOwner({ addTool: 'module', shapeMenuOn: true, shapeTool: null }) !== 'shape',
    'an armed tool owns the press even though the geometry bar is still open '
    + '(the track diffuser and track spot were unplaceable when it did not)');
  ok(owns({ addTool: 'module', shapeMenuOn: true, shapeTool: null }, 'tool'),
    '...and the machine that owns it is the tool');

  ok(owns({ shapeMenuOn: true, shapeTool: null }, 'grab'),
    'the bar open with no primitive picked owns nothing — a rail cell and a '
    + 'space click both leave it that way');
  ok(canGrab({ shapeMenuOn: true, shapeTool: null }),
    '...so the drawing underneath is still grabbable, which is why the shape\'s '
    + 'own grab band has to answer the take');
  ok(owns({ shapeMenuOn: false, shapeTool: 'rect' }, 'grab'),
    'and a stale primitive with the bar shut owns nothing either');
}

say('-- 4. nothing on the drawing is grabbable while a tool is in hand --');
{
  /* THE SECOND NAMED ONE. Any state with a tool, an object, the board step or
     the zone band live is a state in which no press may reach a fitting. */
  const HANDS = [
    ['armed',      { armed: 'fan' }],
    ['addTool',    { addTool: 'cob' }],
    ['boardPlace', { boardPlace: true }],
    ['zoneMode',   { zoneMode: true }],
  ];
  for (const [name, s] of HANDS) {
    ok(!canGrab(s),
      `nothing on the drawing is grabbable while ${name} is live`);
  }
  // ...and in every combination of them, not only one at a time.
  let bad = 0;
  for (let mask = 1; mask < (1 << HANDS.length); mask++) {
    const s = {};
    HANDS.forEach(([, v], i) => { if (mask & (1 << i)) Object.assign(s, v); });
    if (canGrab(s)) bad++;
  }
  ok(bad === 0,
    'anything with armed || addTool || boardPlace || zoneMode is NOT grab, in '
    + 'all 15 combinations');
  ok(!canGrab({ doorEdit: true }) && !canGrab({ shapeMenuOn: true, shapeTool: 'rect' }),
    'and neither the door step nor an armed primitive leaves anything grabbable');
  ok(canGrab({}), 'with nothing in hand, the drawing is grabbable — which is ordinary use');
}

say('-- 5. `dragging` changes no answer --');
{
  /* IT IS IN THE SIGNATURE AND NOT IN THE RANKING. A gesture in flight owns the
     pointer by the MOVE handler's branch order, not by the press — and
     withholding grab handlers mid-drag would break the drag it was protecting. */
  let bad = 0;
  for (const m of MACHINES) {
    if (pressOwner({ ...ALONE[m], dragging: true }) !== m) bad++;
  }
  ok(bad === 0, 'every machine answers the same with a gesture in flight');
}

say('-- 6. the two deliberate exemptions are exemptions, not the rule --');
{
  /* NAMED HERE SO THEY CANNOT BE FOLDED IN SILENTLY. Both are call-site
     departures from this function, and both are load-bearing:

     THE SPOT lets an existing spot be selected mid-step. Arming the spot opens
     a step that stays open until Done, so without it every spot on the drawing
     was unselectable for the whole of the time somebody was placing spots —
     and Delete then fell past every branch to the SPACE and took the room out
     of the layout. See `spotPointerDown`.

     THE MODULE lets a press on an existing module place a new one. You clip six
     onto a run, and a press stolen by the module already there would make the
     one thing somebody does repeatedly fail the moment two were near each
     other. See `modulePointerDown`, whose first line returns for its own tool. */
  ok(owns({ addTool: 'spot' }, 'tool'),
    'the rule says the spot tool owns the press — spotPointerDown exempts itself, '
    + 'and that exemption is what makes a spot deletable mid-step');
  ok(owns({ addTool: 'module' }, 'tool'),
    'the rule says the module tool owns the press — modulePointerDown exempts '
    + 'itself so a press on a module places the next one');
  /* AND NEITHER EXEMPTION REACHES ANY OTHER TOOL. `addTool` is a string, so an
     exemption is a test on its VALUE and never on its truthiness. */
  ok(owns({ addTool: 'cove' }, 'tool') && owns({ addTool: 'track' }, 'tool')
    && owns({ addTool: 'strip' }, 'tool') && owns({ addTool: 'sconce' }, 'tool')
    && owns({ addTool: 'cob' }, 'tool'),
    'every other tool owns its press with no exemption at all');
}

// --------------------------------------------------------------------------
/* --- THE SPOT ARRAY, WHOSE GESTURE HOLDS TWO TOOLS AT ONCE ----------------
   ARMING THE ARRAY RAISES THE GEOMETRY BAR IN THE GUIDE ROLE — an array has to
   have a path, and the two ways of getting one are both the shape tool's. So
   `addTool: 'cob'` and `shapeMenuOn: true` are live TOGETHER for the whole of
   that flow, which is a combination nothing else on this canvas produces, and
   the whole gesture rests on this function telling the two apart.

   THE DISTINCTION IS THE ARMED PRIMITIVE AND NOT THE OPEN BAR — which is the
   line this file's own header calls "the bug" and which is load-bearing here
   rather than incidental. Unarmed, the array keeps the press, so a cove or a
   guide already on the drawing can be pressed and taken as the run's path.
   Armed, the shape tool takes it, because the next press is a drag that draws
   the rectangle the run will be set out on. */
console.log('the spot array holds the cob tool and the geometry bar at once');
{
  const array = { addTool: 'cob', shapeMenuOn: true };
  ok(owns({ ...array, shapeTool: null }, 'tool'),
    'bar open and no primitive armed: the array keeps the press, so an outline '
    + 'already on the drawing can be pressed and taken as its path');
  ok(owns({ ...array, shapeTool: 'rect' }, 'shape'),
    '...and the moment a primitive is armed the shape tool takes it, because '
    + 'the next press draws the geometry the run is set out on');
  /* AND NOTHING IS GRABBABLE THROUGH EITHER OF THEM. `shapePointerDown` bails
     on `canGrab`, which is what stops a press on a cove SELECTING it — and
     hence what lets it fall through to the array's own handler. */
  ok(!canGrab({ ...array, shapeTool: null }) && !canGrab({ ...array, shapeTool: 'rect' }),
    'neither state grabs, so a press on a shape reaches the tool that wants it');
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
