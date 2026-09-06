import { useCallback, useMemo, useState } from 'react';
import { penAim, penClosesAt, penSegments } from '../lib/pen.js';

// ---------------------------------------------------------------------------
// usePen — one pen gesture, as state. The geometry is in lib/pen.js; this is
// the part that remembers.
//
// ONE HOOK, TWO TOOLS, AND IT IS THE SAME GESTURE BOTH TIMES. The cove pen and
// the track pen differ in what they hand their points to and in two options —
// `lock` and `closes` — which is exactly the shape a hook is for. The cove
// pen's own state used to live loose in App.jsx beside the shape drag's; adding
// a second pen there would have meant a second `penPts`, a second rubber band
// and a second undo, kept in step by hand.
//
// IT OWNS THE POINTER TOO, and that is the non-obvious half. `at` is not the
// raw cursor: it is where the next click WOULD land, lock already applied. So
// the rubber band and the click read one value, and a lock that is drawn but
// not committed — or committed but not drawn — cannot happen.
//
//   lock    'shift'  free, and axis-locked while shift is held.
//           'always' every segment is rectilinear. A track's runs are.
//           'never'  no lock, and shift does nothing.
//   closes  whether clicking the first point finishes the path.
// ---------------------------------------------------------------------------

export default function usePen({ lock = 'shift', closes = false } = {}) {
  const [pts, setPts] = useState([]);
  /** The raw pointer, in plan feet, and whether shift was down when it moved. */
  const [cursor, setCursor] = useState(null);
  const [shift, setShift] = useState(false);

  const locked = lock === 'always' || (lock === 'shift' && shift);
  /** Where the next click lands. See the note above: this is what gets drawn
   *  AND what gets committed. */
  const at = useMemo(() => penAim(pts, cursor, { lock: locked }),
                     [pts, cursor, locked]);

  /** The pointer moved. `shiftHeld` is read live, so holding shift halfway
   *  through a segment straightens it under your hand. */
  const move = useCallback((ptFt, shiftHeld = false) => {
    setCursor(ptFt); setShift(!!shiftHeld);
  }, []);

  /**
   * A CLICK. Returns 'closed' when it landed on the first point of a path that
   * closes, 'added' otherwise — the caller does different things with those two
   * and should not have to re-run the test to find out which happened.
   *
   * `tolFt` is the close target's radius, and it is the CALLER'S because it is
   * about how accurately somebody can hit a dot on screen: a figure in feet
   * would shrink as the drawing is zoomed in, which is backwards.
   */
  const add = useCallback((ptFt, { shiftHeld = false, tolFt = 0 } = {}) => {
    const p = penAim(pts, ptFt, { lock: lock === 'always' || (lock === 'shift' && shiftHeld) });
    if (closes && penClosesAt(pts, p, tolFt)) return 'closed';
    // A CLICK THAT DID NOT MOVE IS NOT A POINT. A locked pen makes these by the
    // handful — the second click of a double, or a click straight back onto the
    // last point — and each one is a zero-length segment somebody has to notice
    // and undo.
    const last = pts[pts.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1e-6) return 'added';
    setPts((l) => [...l, p]);
    setCursor(p); setShift(!!shiftHeld);
    return 'added';
  }, [pts, closes, lock]);

  /** The last point back off. What Backspace does in every drawing tool. */
  const undo = useCallback(() => setPts((l) => l.slice(0, -1)), []);

  const reset = useCallback(() => { setPts([]); setCursor(null); setShift(false); }, []);

  const path = useMemo(() => (at ? [...pts, at] : pts), [pts, at]);
  const segments = useCallback((opt) => penSegments(pts, opt), [pts]);

  /* MEMOISED, AND IT IS NOT AN OPTIMISATION. Callers put this object in
     dependency arrays — `disarmAdd` empties the track pen, `abandonShape`
     empties the cove pen — and a fresh object every render would make every
     callback built on one of them fresh every render too, which re-binds the
     window keydown listener on each frame and defeats the memo it is passed
     through. It changes when the gesture changes, which is when a callback that
     reads the gesture SHOULD change, and at no other time. */
  return useMemo(() => ({
    pts, at, shift, locked, path, segments,
    add, move, undo, reset,
    isEmpty: pts.length === 0,
  }), [pts, at, shift, locked, path, segments, add, move, undo, reset]);
}
