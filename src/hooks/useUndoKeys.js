// ---------------------------------------------------------------------------
// useUndoKeys.js — THE ONE LISTENER UNDO IS BOUND BY.
//
// The rule and the reasoning are in src/lib/undoKeys.js. This is the React
// binding, and it is deliberately shaped like useEscapeHatch: undo and Escape
// are the two keys that belong to the editor as a whole rather than to whatever
// is selected, and they are bound the same way for the same reason.
//
//   useUndoKeys({ enabled, undo, redo })   bind it. ONCE, at the top.
//
// --- THE FOUR PROPERTIES THAT MAKE IT HOLD ---------------------------------
//
// CAPTURE ON `window`. First position in the DOM, so no `stopPropagation`
// between the pressed element and here can swallow the key — which is what
// happened last time. It also means the key never reaches the focused element
// at all, which is the whole point: the field does not get it, React does not
// get it, Safari does not get it.
//
// BOUND ONCE AND NEVER RE-BOUND. No dependency array to be wrong. The old
// handler carried sixty entries and every name it missed was a stale closure.
//
// EVERYTHING READ THROUGH A REF, which is what lets the array be empty. A
// caller may pass a fresh object literal every render.
//
// `preventDefault` BEFORE THE `enabled` CHECK. The browser does not get this
// key whether or not we have a use for it today. A read-only viewer pressing
// ⌘Z should have nothing happen — not have Safari reopen a closed tab.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from 'react';
import { matchUndoKey } from '../lib/undoKeys.js';

/**
 * BIND UNDO AND REDO. Call it once, near the root of a screen.
 *
 * `enabled` GATES THE ACT, NOT THE BINDING, and that distinction is the bug
 * this file exists to stop coming back. A listener bound conditionally is a
 * listener that is missing exactly when some other state says so, and every
 * version of "is undo bound right now?" this app has had was wrong. It is
 * always bound; `enabled` decides what happens next, and it is read at press
 * time so it is never stale.
 *
 * `undo` AND `redo` ARE CALLED THROUGH THE REF for the same reason — the pair
 * they reach in App is assembled during render, well below this call.
 */
export function useUndoKeys({ enabled = true, undo, redo } = {}) {
  const ref = useRef(null);
  ref.current = { enabled, undo, redo };
  useEffect(() => {
    const onKey = (e) => {
      const move = matchUndoKey(e);
      if (!move) return;
      // THE BROWSER NEVER SEES IT. See the note above: unconditional, ahead of
      // every question about whether this editor has anything to undo.
      e.preventDefault();
      e.stopPropagation();
      const now = ref.current;
      if (!now?.enabled) return;
      if (move === 'redo') now.redo?.(); else now.undo?.();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}
