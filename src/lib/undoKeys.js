// ---------------------------------------------------------------------------
// undoKeys.js — WHICH PRESS MEANS UNDO, AND WHICH MEANS REDO.
//
// The matcher only. The binding is src/hooks/useUndoKeys.js, and the split is
// the one escapeHatch.js makes for the same reason: a rule about keyboards is
// worth testing without a browser. See tools/test-undo-keys.mjs.
//
// --- WHAT THIS REPLACED AND WHY --------------------------------------------
//
// Undo used to be two branches near the top of App's four-hundred-line keydown
// handler, bound in the BUBBLE phase on `window`. It broke, twice, and both
// times for the same structural reason rather than a wrong condition:
//
//   1. A focus guard above it stood the whole handler down whenever an
//      `<input>` had focus — and the redesign put spec fields ON the drawing,
//      so "a field has focus" became the ordinary state of the screen.
//   2. With that fixed, any `stopPropagation` between the pressed element and
//      `window` still swallowed the key, because bubble-phase last is the
//      weakest position in the DOM.
//
// Either way the press fell through to Safari, where ⌘Z is Undo Close Tab, and
// the editor reopened a browser tab instead of taking back an edit.
//
// So the fix is not another condition in that handler. It is that undo stops
// being one of forty branches that share a listener with Delete, and becomes
// what Escape already is: ONE listener, in CAPTURE, bound once, that nothing
// downstream can outrank. Undo is about the document as a whole; it has no
// business being gated on what happens to be selected or focused.
//
// --- THE KEYCAP, NOT THE POSITION, EXCEPT WHEN THERE IS NO KEYCAP ----------
//
// `⌘Z` means "the key printed Z", so `e.key` is the right question and
// `e.code` — a physical position — is the wrong one. Matching position breaks
// AZERTY, where the key at `KeyZ` is printed W: we would eat ⌘W and refuse to
// close the tab.
//
// But `e.key` is empty of Latin letters on a Cyrillic or Greek layout, where a
// chord reports the character the layout produces. Nobody there can undo. So
// position is the FALLBACK and only then: if the layout handed us a Latin
// letter we believe it, and we reach for `e.code` only when it did not.
//
// PURE. No React, no DOM.
// ---------------------------------------------------------------------------

/** A single Latin letter — what a layout we can read a keycap from gives us. */
const LATIN = /^[a-z]$/;

/**
 * WHICH LETTER WAS PRESSED, as the keycap reads. '' when neither the layout nor
 * the position tells us anything we have a use for.
 */
function letterOf(e) {
  const key = typeof e.key === 'string' ? e.key.toLowerCase() : '';
  if (LATIN.test(key)) return key;
  // NON-LATIN LAYOUT. Fall back to the physical key, and only for the two we
  // answer to — a blanket code-to-letter map is how ⌘W gets eaten on AZERTY.
  if (e.code === 'KeyZ') return 'z';
  if (e.code === 'KeyY') return 'y';
  return '';
}

/**
 * WHAT THIS PRESS MEANS: 'undo', 'redo', or null for everything else.
 *
 * BOTH MODIFIERS, because this app runs on both kinds of keyboard and neither
 * audience should have to learn the other's shortcut. ⇧⌘Z and Ctrl+Y are both
 * redo for the same reason.
 *
 * ALT IS NOT OURS. ⌥⌘Z is a different chord and some systems bind it; claiming
 * every superset of ⌘Z would take keys we have no meaning for.
 */
export function matchUndoKey(e) {
  if (!e || (!e.metaKey && !e.ctrlKey)) return null;
  if (e.altKey) return null;
  const letter = letterOf(e);
  if (letter === 'z') return e.shiftKey ? 'redo' : 'undo';
  // ⇧ IS NOT PART OF THE Y CHORD. Ctrl+Y is already redo; ⇧Ctrl+Y is nothing,
  // and reading it as redo would be inventing a shortcut.
  if (letter === 'y' && !e.shiftKey) return 'redo';
  return null;
}
