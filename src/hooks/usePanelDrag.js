// ---------------------------------------------------------------------------
// usePanelDrag.js — PICKING THE FLOATING WINDOW UP AND PUTTING IT SOMEWHERE
// ELSE.
//
// NOT hooks/useDrag.js, AND THE DIFFERENCE IS NOT A MATTER OF TASTE. That hook
// is the lifecycle round lib/dragMove.js: pointer capture on the <svg>, a slop
// threshold measured over the zoom, positions read and written in the caller's
// own unit (feet, plan pixels, a fraction of a path), snap targets, alignment
// guides, the Option-copy fork and a snap-back on an invalid drop. Every one of
// those is about moving a THING THAT IS PART OF THE DRAWING.
//
// This moves a piece of CHROME. There is no unit to convert, nothing to snap
// to, nothing to copy, no drop that can be invalid and no document to write —
// the window is at an offset from where CSS put it, and that offset is a fact
// about this session and nothing else. Running it through the canvas machinery
// would mean answering six questions that have no answer here.
//
// --- WHAT IT GUARANTEES ----------------------------------------------------
//
// THE WINDOW CANNOT BE THROWN AWAY. Every frame is clamped so that at least
// `KEEP` pixels of it stay inside the viewport on all four sides, and the top
// edge can never go above the viewport at all. A window dragged off the screen
// is a window with no way back, and this one holds the readings somebody is
// working from.
//
// AND IT SURVIVES A RESIZE. The clamp is re-applied when the viewport changes,
// because a window parked against the right edge of a wide screen is off the
// side of a narrow one, and nobody dragged it there.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * HOW MUCH OF THE WINDOW MUST STAY REACHABLE, in CSS pixels. Enough to get the
 * pointer on the grip and drag it back — a sliver you can see but not grab is
 * the same as having lost it.
 */
const KEEP = 72;

/** ...and how close the top edge may come to the top of the viewport. */
const TOP_GAP = 8;

/**
 * THE OFFSET FROM WHERE CSS PUT IT, and the two handlers that change it.
 *
 * `ref` goes on the window itself — the clamp needs its box. `onGripDown` goes
 * on the grip and nothing else: a window you can drag by any part of its body
 * is a window that moves when somebody meant to select a reading in it.
 */
export default function usePanelDrag() {
  const ref = useRef(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  /* THE PRESS'S OWN SNAPSHOT. Same rule every drag in this app follows: the
     geometry is read ONCE, at the press, and every frame is measured from that
     — see rule 2 in lib/dragMove.js. Measuring live would mean measuring a box
     that the previous frame just moved, and the error compounds. */
  const from = useRef(null);

  /** Where the window would sit with no offset applied, plus its size. */
  const homeBox = useCallback((off) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return null;
    return { x: r.left - off.x, y: r.top - off.y, w: r.width, h: r.height };
  }, []);

  /** The offset, held to what keeps the window reachable. */
  const clamp = useCallback((box, x, y) => ({
    x: Math.min(window.innerWidth - KEEP - box.x, Math.max(KEEP - box.x - box.w, x)),
    y: Math.min(window.innerHeight - KEEP - box.y, Math.max(TOP_GAP - box.y, y)),
  }), []);

  const onGripDown = useCallback((e) => {
    if (e.button != null && e.button !== 0) return;
    const box = homeBox(offset);
    if (!box) return;
    from.current = { box, px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y };
    /* CAPTURE, so the gesture survives the pointer leaving the grip — which it
       does immediately, because the grip is 24px tall and the hand moves
       faster than the window follows. */
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    setDragging(true);
  }, [offset, homeBox]);

  const onGripMove = useCallback((e) => {
    const f = from.current;
    if (!f) return;
    setOffset(clamp(f.box, f.ox + e.clientX - f.px, f.oy + e.clientY - f.py));
  }, [clamp]);

  const onGripUp = useCallback((e) => {
    if (!from.current) return;
    from.current = null;
    setDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, []);

  /** Back to where CSS puts it. The grip's double-click, and `resetForNewPlan`. */
  const home = useCallback(() => setOffset({ x: 0, y: 0 }), []);

  /* --- A NARROWER SCREEN MUST NOT SWALLOW IT -------------------------------
     THE CLAMP IS A FUNCTION OF THE VIEWPORT, so it has to be re-asked when the
     viewport changes. Nothing happens while it is home — the offset is already
     zero and the clamp cannot move it — so this costs a rect read on resize
     only for somebody who has actually dragged the window. */
  useEffect(() => {
    if (!offset.x && !offset.y) return undefined;
    const onResize = () => setOffset((cur) => {
      const box = homeBox(cur);
      if (!box) return cur;
      const next = clamp(box, cur.x, cur.y);
      // BY REFERENCE WHEN NOTHING MOVED, so a resize that changes nothing does
      // not queue a render.
      return next.x === cur.x && next.y === cur.y ? cur : next;
    });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [offset.x, offset.y, clamp, homeBox]);

  return {
    ref,
    offset,
    dragging,
    /** Has somebody moved it? The grip reads this to show it can be put back. */
    moved: offset.x !== 0 || offset.y !== 0,
    home,
    grip: {
      onPointerDown: onGripDown,
      onPointerMove: onGripMove,
      onPointerUp: onGripUp,
      onPointerCancel: onGripUp,
    },
  };
}
