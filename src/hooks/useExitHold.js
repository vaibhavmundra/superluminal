// ---------------------------------------------------------------------------
// useExitHold.js — KEEP SHOWING WHAT WAS THERE WHILE IT SLIDES AWAY.
//
// THE PROBLEM IT SOLVES IS THE ONE EVERY EXIT ANIMATION HAS. A panel's contents
// are a function of what is selected; the panel closes BECAUSE the selection
// went away; so by the time it is animating out there is nothing left to draw
// in it. Animate the naive way and you get an empty box sliding off the screen,
// which looks worse than no animation at all — the content vanishes on the
// frame and only the frame is animated.
//
// SO THE LAST BODY IS HELD, AND IT IS HELD AS AN ELEMENT RATHER THAN AS DATA.
// A React element is an inert object describing what to render. Handing the
// same one back on the next render re-renders that same tree with the same
// props it was built from — stale on purpose, which is exactly what a thing on
// its way out should show. Nothing is recomputed and nothing is re-read.
//
// --- WHY THE BODY ARRIVES AS A FUNCTION -------------------------------------
//
// THIS IS THE PART THAT IS EASY TO GET WRONG. The obvious signature takes the
// element itself — `hold(open, <Body/>)` — and it cannot work: JSX arguments are
// evaluated before the call, so `<Body room={room.id}/>` throws the moment the
// room is null, which is precisely the state this hook exists for. The body has
// to be a thunk so it is never built while it is closed.
//
// --- AND WHY IT LETS GO -----------------------------------------------------
//
// The held tree stays mounted, so it re-renders with its parent for as long as
// it is held. Holding it forever would mean a closed panel's forty rows of
// analysis re-rendering behind every keystroke for the rest of the session, so
// the hold is released once the exit is over.
//
// A TIMER AND NOT `transitionend`, which is the tempting one. That event does
// not fire at all when the transition was never run — the window drops its
// animation below 960px and again for `prefers-reduced-motion` — so a hold
// waiting on it would never be released on either. A duration the caller states
// is a promise it can keep.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';

/**
 * `open` is the live state; `ms` is how long the exit takes — pass the same
 * figure the CSS uses, with a little slack.
 *
 * RETURNS A FUNCTION RATHER THAN THE BODY, and that is about WHERE a hook may
 * be called rather than about what this one does. The body it holds is a
 * thousand lines of JSX in the middle of a return, and a hook called down there
 * is a hook inside the render tree — one early return above it and the call
 * order changes between renders. So the hook is called with the rest of them,
 * at the top, and hands back the one thing the JSX needs.
 *
 * Give it a thunk; get the body to render — the live one while open, the last
 * one while it is leaving, and null once it has gone.
 */
export default function useExitHold(open, ms) {
  const held = useRef(null);
  /* WHETHER AN EXIT IS RUNNING. It is state and not a ref because the release
     has to cause a render — the whole point is to stop rendering the held tree,
     and a ref changing quietly would leave it on screen until something else
     happened to re-render App. */
  const [leaving, setLeaving] = useState(false);
  /* WHAT IT WAS LAST TIME, so the effect can tell an open→shut edge from an
     ordinary re-render. Without it, every render while shut would restart the
     timer and the hold would never expire. */
  const was = useRef(open);

  useEffect(() => {
    if (open === was.current) return undefined;
    was.current = open;
    if (open) { setLeaving(false); return undefined; }
    setLeaving(true);
    const t = setTimeout(() => setLeaving(false), ms);
    return () => clearTimeout(t);
  }, [open, ms]);

  /* A FRESH ARROW EVERY RENDER IS CORRECT HERE and is not the usual smell. It
     closes over THIS render's `open` and `leaving`, and it is called once,
     immediately, in the same render — it is never handed to a memo, an effect
     or a child, so there is nothing for its identity to churn. */
  return (make) => {
    if (open) {
      held.current = make();
      return held.current;
    }
    if (leaving) return held.current;
    /* GONE. Dropping the reference is the point of the release — a held tree is
       a mounted tree, and one nobody can see is pure cost. */
    held.current = null;
    return null;
  };
}
