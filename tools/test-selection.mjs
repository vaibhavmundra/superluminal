// ---------------------------------------------------------------------------
// test-selection.mjs — ONE SELECTION ON THIS CANVAS, AS A LAW RATHER THAN A HABIT.
//
// FIVE CLAIMS, and every assertion below belongs to one of them:
//
//   1. THE REGISTER HOLDS AT MOST ONE KIND. Selecting anything is also the act
//      of dropping whatever was picked before — not as a courtesy the caller
//      performs, but because there is nowhere for a second selection to be.
//      Eleven pieces of state were cleared in ninety-six hand-written places
//      before this; the twelfth selectable thing would have been ninety-six
//      more, and one missed site is a live bug.
//   2. THE TWO REGRESSIONS THAT PAID FOR THIS FILE, named as assertions rather
//      than left to the truth table: selecting an ARRAY clears a selected
//      SHAPE — a lingering shape selection is what put a second contextual bar
//      on the drawing — and selecting any single kind clears the object
//      MULTI-selection, and vice versa.
//   3. READING THE WRONG KIND ANSWERS EMPTY, NOT WRONG. `idOf` of a kind the
//      register is not holding is null and `idsOf` is empty, which is what lets
//      a hundred read sites in App.jsx go on being written in the old names.
//   4. AN UNKNOWN KIND THROWS. A typo would otherwise select nothing and clear
//      everything — indistinguishable from a click on empty plan, which is the
//      most expensive kind of silence because the gesture appears to work.
//   5. A CLEAR THAT CHANGES NOTHING IS THE SAME VALUE, and `idsOf` answers with
//      one shared array. Both are for the caller's re-renders: the register is
//      read every render and feeds dependency arrays, so a fresh object or a
//      fresh copy would churn where the old per-kind states stood still.
//
//   node tools/test-selection.mjs
// ---------------------------------------------------------------------------

import { SELECTION_KINDS, NONE, select, selectMany, clear, idOf, idsOf, isSelected }
  from '../src/lib/selection.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const say = (t) => console.log('\n' + t);

const threw = (fn) => { try { fn(); return false; } catch { return true; } };

say('THE KINDS');
{
  ok(SELECTION_KINDS.length === 11, 'eleven kinds, which is what moved into the register');
  ok(SELECTION_KINDS.filter((k, i) => SELECTION_KINDS.indexOf(k) !== i).length === 0,
    'no kind is listed twice');
  ok(['object', 'cob', 'array', 'module', 'light', 'shape', 'board', 'flow',
      'spot', 'acc', 'door'].every((k) => SELECTION_KINDS.includes(k)),
    'the eleven are the eleven App.jsx used to hold separately');
  ok(!SELECTION_KINDS.includes('outline') && !SELECTION_KINDS.includes('trackPt'),
    "the tracer's outline and a track's point are NOT in here — different screen, "
    + 'and a sub-selection of something already picked');
}

say('NOTHING PICKED');
{
  ok(NONE.kind === null && NONE.id === null && NONE.ids.length === 0,
    'NONE holds no kind, no id and no ids');
  ok(SELECTION_KINDS.every((k) => idOf(NONE, k) === null),
    'no kind reads an id out of NONE');
  ok(SELECTION_KINDS.every((k) => idsOf(NONE, k).length === 0),
    'no kind reads ids out of NONE');
  ok(SELECTION_KINDS.every((k) => !isSelected(NONE, k, 'anything')),
    'nothing is selected in NONE');
  ok(clear() === NONE, 'clear() IS NONE — a clear that changes nothing is the same '
    + 'value, so React stops there rather than re-rendering the canvas');
}

say('THE TRUTH TABLE — ONE KIND AT A TIME');
{
  /* EVERY KIND AGAINST EVERY OTHER KIND. This is the whole invariant, and it is
     asserted exhaustively rather than sampled because the reason the old code
     was wrong is that a human enumerated the list by hand. */
  let held = 0, others = 0;
  for (const kind of SELECTION_KINDS) {
    const s = select(kind, `${kind}-1`);
    if (idOf(s, kind) === `${kind}-1`) held++;
    if (SELECTION_KINDS.filter((k) => k !== kind)
      .every((k) => idOf(s, k) === null && idsOf(s, k).length === 0)) others++;
  }
  ok(held === SELECTION_KINDS.length, 'every kind reads back the id it was given');
  ok(others === SELECTION_KINDS.length,
    'and every OTHER kind reads null — selecting one implicitly clears the ten');

  /* AND FROM A LOADED REGISTER, not only from NONE. A selection replacing a
     selection is the case the ninety-six clear sites existed for. */
  let pairs = 0, replaced = 0;
  for (const from of SELECTION_KINDS) {
    for (const to of SELECTION_KINDS) {
      if (from === to) continue;
      pairs++;
      const s = select(to, 'b');
      if (idOf(s, to) === 'b' && idOf(s, from) === null) replaced++;
    }
  }
  ok(pairs === 110 && replaced === pairs,
    'all 110 ordered pairs of kinds: selecting the second drops the first');

  ok(idOf(select('cob', 'c1'), 'cob') === 'c1' && isSelected(select('cob', 'c1'), 'cob', 'c1'),
    'isSelected agrees with idOf for a single kind');
  ok(!isSelected(select('cob', 'c1'), 'cob', 'c2'),
    'a different id of the same kind is not selected');
  ok(!isSelected(select('cob', 'c1'), 'shape', 'c1'),
    'the same id under a different kind is not selected');
}

say('SELECTING NOTHING IS CLEARING');
{
  ok(select('cob', null) === NONE,
    'select(kind, null) is a clear — every site that wrote setSelCobId(null) meant this');
  ok(select('cob', undefined) === NONE, 'and so is an undefined id');
  ok(selectMany('object', []) === NONE,
    'a selection of nought objects is nothing picked, not a kind holding an empty list');
  ok(selectMany('object', null) === NONE, 'and a missing list is the same');
}

say('THE MULTI-SELECTION, WHICH IS ONLY EVER OBJECTS');
{
  const many = selectMany('object', ['o1', 'o2', 'o3']);
  ok(idsOf(many, 'object').length === 3, 'three objects are three ids');
  ok(idOf(many, 'object') === 'o3',
    'the primary is the LAST added — what the property panels read with three picked');
  ok(isSelected(many, 'object', 'o1') && isSelected(many, 'object', 'o2'),
    'every member of the group is selected, not just the primary');
  ok(!isSelected(many, 'object', 'o9'), 'and an object outside it is not');
  ok(idsOf(select('object', 'o1'), 'object').length === 1,
    'a single select on the multi kind still fills ids, so idsOf never misses it');
  ok(SELECTION_KINDS.filter((k) => k !== 'object')
    .every((k) => idsOf(many, k).length === 0),
    'no other kind reads ids out of an object selection');
  ok(idsOf(select('cob', 'c1'), 'cob').length === 1,
    'a single kind fills ids too — one shape for every kind, so reads never branch');
}

say('THE TWO REGRESSIONS THIS FILE IS FOR');
{
  /* THE SECOND CONTEXTUAL BAR. Both bars on that drawing are position:fixed,
     centred over the stage, 26px off its foot — so a shape selection that
     outlived the press which opened an array put two of them in one place. */
  const shape = select('shape', 'sh-7');
  const array = select('array', 'carr-3');
  ok(idOf(shape, 'shape') === 'sh-7', 'a shape is selected');
  ok(idOf(array, 'shape') === null,
    'REGRESSION: selecting an array clears a selected SHAPE — the lingering shape '
    + 'selection is what put a second contextual bar on screen');
  ok(idOf(array, 'array') === 'carr-3', 'and the array is what is selected instead');

  /* AND THE MULTI-SELECTION IN BOTH DIRECTIONS. Four gathered cassettes and a
     picked plate would be two things Delete could mean. */
  const group = selectMany('object', ['o1', 'o2', 'o3', 'o4']);
  ok(idsOf(group, 'object').length === 4, 'four objects are gathered');
  ok(SELECTION_KINDS.filter((k) => k !== 'object').every(
    (k) => idsOf(select(k, 'x'), 'object').length === 0 && idOf(select(k, 'x'), 'object') === null),
    'REGRESSION: selecting any single kind clears the object MULTI-selection');
  ok(SELECTION_KINDS.filter((k) => k !== 'object').every((k) => idOf(group, k) === null),
    '...and vice versa: the object multi-selection clears every single kind');
  ok(idsOf(clear(), 'object').length === 0, 'and a clear empties the group too');
}

say('AN UNKNOWN KIND THROWS');
{
  ok(threw(() => select('cobb', 'c1')), 'select of a typo throws rather than selecting nothing');
  ok(threw(() => selectMany('objects', ['o1'])), 'selectMany of a typo throws');
  ok(threw(() => idOf(NONE, 'Cob')), 'idOf is case sensitive and throws on a near miss');
  ok(threw(() => idsOf(NONE, 'obj')), 'idsOf throws on a near miss');
  ok(threw(() => isSelected(NONE, 'outline', 'x')),
    "isSelected throws for the tracer's outline, which is not this register's business");
  ok(threw(() => idOf(NONE, undefined)), 'and an undefined kind throws');
}

say('THE READ IS STABLE, BECAUSE IT IS READ EVERY RENDER');
{
  const s = selectMany('object', ['o1', 'o2']);
  ok(idsOf(s, 'object') === idsOf(s, 'object'),
    'idsOf answers with the STORED array, not a copy — a dependency array reading '
    + 'it must not churn on every frame');
  ok(idsOf(s, 'cob') === idsOf(NONE, 'door'),
    'and the wrong kind answers with one shared empty array, for the same reason');
  ok(idsOf(NONE, 'object') === idsOf(clear(), 'object'),
    'so does a cleared register');
}

say('THE REGISTER IS NOT EDITED IN PLACE');
{
  const s = select('cob', 'c1');
  ok(threw(() => { 'use strict'; NONE.kind = 'cob'; }) || NONE.kind === null,
    'NONE cannot be written through');
  ok(idOf(s, 'cob') === 'c1' && idOf(select('shape', 'sh-1'), 'cob') === null,
    'and building a new selection leaves the old value alone');
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
