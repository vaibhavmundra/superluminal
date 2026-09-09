// ---------------------------------------------------------------------------
// test-escape.mjs — WHAT ESCAPE MEANS, EVERYWHERE, ONCE.
//
// SIX CLAIMS, and every assertion below belongs to one of them:
//
//   1. NOBODY REGISTERED MEANS THE EDITOR STANDS DOWN. `fireEscape` is false
//      with an empty registry, and false is the whole signal — the hatch reads
//      it as "sweep the chrome, then put every machine away".
//   2. THE LAST THING YOU OPENED IS THE FIRST THING YOU BACK OUT OF. Claims are
//      LIFO, and one press gives the key to exactly one of them.
//   3. A RELEASE TAKES ITS OWN CLAIM AND NOBODY ELSE'S, however many times it
//      is called. React runs a cleanup twice in StrictMode, and the second run
//      popping somebody else's claim is a flow silently losing its exemption.
//   4. A SWEEP IS NOT A CLAIM. Chrome does not stop the stand-down — that is
//      the entire difference between the two registries, and it is the one a
//      reader will get wrong.
//   5. A SWEEP MAY UNREGISTER ITSELF WHILE THE SWEEP IS RUNNING, because
//      closing a drawer usually unmounts the thing that registered it.
//   6. TEXT ENTRY IS NOT THE SAME QUESTION AS FORM CONTROL, and conflating
//      them is what sent ⌘Z to Safari: a wattage slider is an `<input>`, the
//      old guard stood down for it, and Safari's Undo Close Tab took the key.
//      A slider owns the arrow keys; it owns nothing undoable.
//
//   node tools/test-escape.mjs
// ---------------------------------------------------------------------------

import { claimEscape, fireEscape, sweepOnEscape, sweepEscape, isTextEntry, isFormControl,
         escapeClaims, escapeSweepCount, resetEscapeClaims } from '../src/lib/escapeHatch.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const say = (t) => console.log('\n' + t);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

say('-- 1. nobody registered means the editor stands down --');
{
  resetEscapeClaims();
  ok(fireEscape() === false, 'an empty registry does not take the key');
  ok(eq(escapeClaims(), []), 'and holds no claims');
  ok(escapeSweepCount() === 0, 'and no sweeps');
}

say('-- 2. the last thing opened is the first thing backed out of --');
{
  resetEscapeClaims();
  const seen = [];
  claimEscape(() => seen.push('tracer'), 'tracer');
  claimEscape(() => seen.push('pen'), 'pen');
  claimEscape(() => seen.push('dialog'), 'dialog');
  ok(eq(escapeClaims(), ['tracer', 'pen', 'dialog']), 'the stack is in the order it was pushed');
  ok(fireEscape() === true, 'a press with claims standing is taken');
  ok(eq(seen, ['dialog']), 'and ONLY the top one runs — one press, one act');
}

say('-- 3. a release takes its own claim and nobody else\'s --');
{
  resetEscapeClaims();
  const seen = [];
  claimEscape(() => seen.push('a'), 'a');
  const dropB = claimEscape(() => seen.push('b'), 'b');
  claimEscape(() => seen.push('c'), 'c');
  dropB();
  ok(eq(escapeClaims(), ['a', 'c']), 'the middle claim comes out of the middle');
  dropB(); dropB();
  ok(eq(escapeClaims(), ['a', 'c']), 'and a release called again is a no-op — THIS IS STRICTMODE');
  fireEscape();
  ok(eq(seen, ['c']), 'the top of what is left still owns the key');
}

say('-- 4. a sweep is not a claim --');
{
  resetEscapeClaims();
  const seen = [];
  sweepOnEscape(() => seen.push('flyout'));
  sweepOnEscape(() => seen.push('drawer'));
  ok(escapeSweepCount() === 2, 'both pieces of chrome are registered');
  ok(fireEscape() === false, 'and NEITHER takes the key — chrome goes WITH the stand-down');
  sweepEscape();
  ok(seen.length === 2 && seen.includes('flyout') && seen.includes('drawer'),
     'the sweep closes every one of them, not just the last');

  // ...and a claim standing over chrome still wins the press outright.
  resetEscapeClaims();
  const order = [];
  sweepOnEscape(() => order.push('chrome'));
  claimEscape(() => order.push('modal'), 'modal');
  ok(fireEscape() === true, 'a modal over an open drawer takes the key');
  ok(eq(order, ['modal']), 'and the drawer is left alone — the stand-down never ran');
}

say('-- 5. a sweep may unregister itself while the sweep is running --');
{
  resetEscapeClaims();
  const seen = [];
  const drop = sweepOnEscape(() => { seen.push('self'); drop(); });
  sweepOnEscape(() => seen.push('other'));
  sweepEscape();
  ok(seen.length === 2, 'both ran even though one removed itself mid-walk');
  ok(escapeSweepCount() === 1, 'and the self-removal took effect');
}

say('-- 6. text entry is not the same question as form control --');
{
  // WHERE TEXT IS TYPED — the field owns ⌘Z.
  ok(isTextEntry({ tagName: 'TEXTAREA' }), 'a textarea is text entry');
  ok(isTextEntry({ tagName: 'INPUT' }), 'an input with no type is text — the HTML default');
  ok(isTextEntry({ tagName: 'input', type: 'Text' }), 'and neither tag nor type is case-sensitive');
  ok(isTextEntry({ tagName: 'INPUT', type: 'number' }), 'a number field is text entry');
  ok(isTextEntry({ tagName: 'INPUT', type: 'email' }), 'so is an email field');
  ok(isTextEntry({ tagName: 'DIV', isContentEditable: true }),
     'a contenteditable — THE ONE ALL THREE OLD SPELLINGS MISSED');

  // ...AND WHERE IT IS NOT. THIS IS THE ⌘Z BUG.
  ok(!isTextEntry({ tagName: 'INPUT', type: 'range' }),
     'A WATTAGE SLIDER IS NOT TEXT ENTRY — this is the bug: the old guard saw '
     + 'INPUT, stood down, and Safari took ⌘Z as Undo Close Tab');
  ok(!isTextEntry({ tagName: 'INPUT', type: 'checkbox' }), 'nor is a checkbox');
  ok(!isTextEntry({ tagName: 'INPUT', type: 'radio' }), 'nor a radio');
  ok(!isTextEntry({ tagName: 'INPUT', type: 'color' }), 'nor a colour well');
  ok(!isTextEntry({ tagName: 'SELECT' }), 'nor a select — you operate it, you do not write in it');
  ok(!isTextEntry({ tagName: 'DIV' }), 'a plain div is not');
  ok(!isTextEntry(null) && !isTextEntry(undefined), 'and a missing target is not, rather than a throw');

  // THE BROAD QUESTION, for keys with no modifier.
  ok(isFormControl({ tagName: 'INPUT', type: 'range' }), 'the slider IS a form control');
  ok(isFormControl({ tagName: 'SELECT' }), 'so is a select');
  ok(isFormControl({ tagName: 'TEXTAREA' }), 'and a textarea');
  ok(isFormControl({ tagName: 'DIV', isContentEditable: true }), 'and a contenteditable');
  ok(!isFormControl({ tagName: 'DIV' }), 'a plain div is not');
  ok(!isFormControl({ tagName: 'BUTTON' }), 'nor a button');
  ok(!isFormControl(null), 'and a missing target is not, rather than a throw');

  // AND THE ONE THAT MATTERS: every text entry is a form control, never the reverse.
  const texty = [{ tagName: 'TEXTAREA' }, { tagName: 'INPUT' }, { tagName: 'INPUT', type: 'number' }];
  ok(texty.every(isFormControl), 'text entry is always a form control too');
  ok(isFormControl({ tagName: 'INPUT', type: 'range' }) && !isTextEntry({ tagName: 'INPUT', type: 'range' }),
     'and the gap between them is exactly where the editor keeps its ⌘-shortcuts');
}

resetEscapeClaims();
console.log(fail ? `\n${fail} FAILED` : '\nall ok');
process.exit(fail ? 1 : 0);
