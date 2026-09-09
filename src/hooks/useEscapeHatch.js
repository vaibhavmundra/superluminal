// ---------------------------------------------------------------------------
// useEscapeHatch.js — THE TWO HALVES OF THE ESCAPE CONTRACT.
//
// The rule and the reasoning are in src/lib/escapeHatch.js. This is the React
// binding, and it is deliberately ONE file with two exports rather than two
// files with one each: they are the two ends of the same contract, and a
// claimant reading only one half is a claimant that will get it wrong.
//
//   useEscapeHatch(standDown)     bind the listener. ONCE, at the top.
//   useEscapeClaim(active, fn)    a MODAL: "Escape is mine, and it stops here."
//   useEscapeSweep(active, fn)    CHROME: "close me when the editor stands down."
//
// EVERY dismissable thing in the app uses one of the last two — dialogs and
// popovers claim, drawers and flyouts sweep. Not one of them binds its own key
// listener, because a second listener is a second ordering problem. Which of
// the two a thing wants is the line drawn in src/lib/escapeHatch.js.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from 'react';
import { claimEscape, fireEscape, isTextEntry, sweepEscape, sweepOnEscape } from '../lib/escapeHatch.js';

/**
 * CLAIM ESCAPE WHILE `active`. The handler runs instead of the stand-down; a
 * handler that does nothing is a flow saying "Escape does not get you out of
 * me", which is a real answer.
 *
 * THE HANDLER IS READ THROUGH A REF, so a caller may pass a fresh arrow every
 * render without the claim being popped and re-pushed underneath it. That
 * matters: re-pushing would move the claim to the TOP of the stack on every
 * frame, and a dialog opened over it would stop being the thing Escape closes.
 */
export function useEscapeClaim(active, handler, label = '') {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return undefined;
    return claimEscape(() => ref.current?.(), label);
  }, [active, label]);
}

/**
 * CLOSE THIS WHEN THE EDITOR STANDS DOWN. For chrome — a flyout, a drawer, a
 * menu — which goes with everything else rather than in place of it.
 *
 * Same ref for the same reason as above: a fresh arrow every render must not
 * churn the registration.
 */
export function useEscapeSweep(active, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return undefined;
    return sweepOnEscape(() => ref.current?.());
  }, [active]);
}

/**
 * BIND THE ONE LISTENER. Call it once, near the root of a screen.
 *
 * CAPTURE, AND `preventDefault` BEFORE ANY BRANCHING — see the module note. The
 * key is taken away from the browser whether or not anything in here has a use
 * for it, because the alternative is Safari leaving full screen on the press
 * that was meant to disarm a fitting.
 *
 * BOUND ONCE AND NEVER RE-BOUND. `standDown` is read through a ref for the
 * reason the old handler's sixty-entry dependency array is worth remembering:
 * every name that array missed was a stale closure and a key that quietly did
 * last render's thing.
 */
export function useEscapeHatch(standDown) {
  const ref = useRef(standDown);
  ref.current = standDown;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // A FIELD ANSWERS ITS OWN ESCAPE. Not stopped, not prevented: the input's
      // own handler reverts what was typed, and that is the claim.
      if (isTextEntry(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      // A MODAL TOOK IT, AND NOTHING ELSE HAPPENS. See the module note.
      if (fireEscape()) return;
      // OTHERWISE THE WHOLE EDITOR GOES: the chrome first, wherever it lives,
      // and then App's own list of machines.
      sweepEscape();
      ref.current?.();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}
