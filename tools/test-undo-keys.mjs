// ---------------------------------------------------------------------------
// test-undo-keys.mjs — WHICH PRESS MEANS UNDO.
//
// SEVEN CLAIMS, and every assertion below belongs to one of them:
//
//   1. BOTH MODIFIERS UNDO. This app runs on both kinds of keyboard and neither
//      audience learns the other's shortcut.
//   2. SHIFT IS REDO, AND THE KEY ARRIVES UPPERCASE. Holding shift changes
//      `e.key` from 'z' to 'Z' — a matcher that compares to 'z' alone reads
//      ⇧⌘Z as nothing at all, which is redo silently missing.
//   3. Y IS REDO, WITHOUT SHIFT. ⇧Ctrl+Y is not a shortcut and reading it as
//      one would be inventing it.
//   4. NO MODIFIER, NO UNDO — a bare `z` is a letter somebody typed.
//   5. ALT IS NOT OURS. Claiming every superset of ⌘Z takes chords we have no
//      meaning for.
//   6. A NON-LATIN LAYOUT CAN STILL UNDO. Cyrillic reports 'я' for the key
//      printed Z, so the physical position is the fallback.
//   7. AND THE FALLBACK DOES NOT EAT ⌘W. On AZERTY the key at `KeyZ` is
//      printed W: matching position first would refuse to close the tab, which
//      is the same class of bug as the one this module was written to fix.
//
//   node tools/test-undo-keys.mjs
// ---------------------------------------------------------------------------

import { matchUndoKey } from '../src/lib/undoKeys.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const say = (t) => console.log('\n' + t);
/** A keydown, with the layout's letter and the physical key stated separately. */
const press = (key, code, mods = {}) => ({
  key, code, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods,
});

say('-- 1. both modifiers undo --');
{
  ok(matchUndoKey(press('z', 'KeyZ', { metaKey: true })) === 'undo', 'meta+Z is undo');
  ok(matchUndoKey(press('z', 'KeyZ', { ctrlKey: true })) === 'undo', 'ctrl+Z is undo');
}

say('-- 2. shift is redo, and the key arrives uppercase --');
{
  ok(matchUndoKey(press('Z', 'KeyZ', { metaKey: true, shiftKey: true })) === 'redo',
     'shift+meta+Z is redo even though the key reads Z');
  ok(matchUndoKey(press('Z', 'KeyZ', { ctrlKey: true, shiftKey: true })) === 'redo',
     'shift+ctrl+Z too');
  ok(matchUndoKey(press('Z', 'KeyZ', { metaKey: true })) === 'undo',
     'and an uppercase key with no shift is still undo');
}

say('-- 3. Y is redo, without shift --');
{
  ok(matchUndoKey(press('y', 'KeyY', { ctrlKey: true })) === 'redo', 'ctrl+Y is redo');
  ok(matchUndoKey(press('y', 'KeyY', { metaKey: true })) === 'redo', 'meta+Y too');
  ok(matchUndoKey(press('Y', 'KeyY', { ctrlKey: true, shiftKey: true })) === null,
     'shift+ctrl+Y is not a shortcut this app has');
}

say('-- 4. no modifier, no undo --');
{
  ok(matchUndoKey(press('z', 'KeyZ')) === null, 'a bare z is a letter');
  ok(matchUndoKey(press('y', 'KeyY')) === null, 'so is a bare y');
  ok(matchUndoKey(press('Z', 'KeyZ', { shiftKey: true })) === null, 'and so is shift+Z');
}

say('-- 5. alt is not ours --');
{
  ok(matchUndoKey(press('z', 'KeyZ', { metaKey: true, altKey: true })) === null,
     'alt+meta+Z is a different chord');
  ok(matchUndoKey(press('z', 'KeyZ', { ctrlKey: true, altKey: true })) === null,
     'alt+ctrl+Z likewise');
}

say('-- 6. a non-latin layout can still undo --');
{
  ok(matchUndoKey(press('я', 'KeyZ', { metaKey: true })) === 'undo',
     'cyrillic reports the layout letter, so the position answers');
  ok(matchUndoKey(press('Я', 'KeyZ', { metaKey: true, shiftKey: true })) === 'redo',
     'and shift there is still redo');
  ok(matchUndoKey(press('н', 'KeyY', { ctrlKey: true })) === 'redo',
     'the same for Y');
  ok(matchUndoKey(press('ф', 'KeyA', { metaKey: true })) === null,
     'but only for the two positions we answer to');
}

say('-- 7. and the fallback does not eat meta+W --');
{
  ok(matchUndoKey(press('w', 'KeyZ', { metaKey: true })) === null,
     'AZERTY prints W on the key at KeyZ, and meta+W must still close the tab');
  ok(matchUndoKey(press('z', 'KeyW', { metaKey: true })) === 'undo',
     'while the key PRINTED z is undo wherever it physically sits');
  ok(matchUndoKey(press('s', 'KeyS', { metaKey: true })) === null, 'meta+S is not ours');
  ok(matchUndoKey(null) === null, 'and nothing at all is nothing at all');
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
