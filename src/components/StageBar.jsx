import { useCallback, useEffect, useState } from 'react';

/* ---------------------------------------------------------------------------
   StageBar — THE WHITE PILL AT THE FOOT OF THE DRAWING, AND THERE IS ONLY ONE.

   IT WAS THE SAME TWENTY LINES IN TWO FILES. ShapeMenu and CobSpec both
   measured the stage, both fixed themselves to its bottom centre, both drew a
   white pill with a hairline and a shadow, and both stopped a pointer press
   from reaching the plan underneath. They were not similar bars, they were one
   bar with two sets of buttons in it — and the drift had already started: one
   had `px-1.5`, the other `px-2` and a `flex-wrap` nobody had given the first.

   AND THE THIRD CALLER IS WHAT FORCED IT OUT. The bar is now PERMANENT: the two
   scene buttons live at its right-hand end whatever else is in it, so a plan
   with no gesture running still has a bar. Rendering that from a third copy of
   the same pill would have made three.

   WHAT IT KNOWS IS WHERE IT SITS AND WHAT IT LOOKS LIKE, and nothing else. The
   buttons, the states and every latch are the caller's — see ShapeMenu for the
   four-state version of that argument.

   FIXED AND MEASURED, NOT ABSOLUTE, which is the one non-obvious part: the
   stage is a SCROLL container, so a child positioned inside it scrolls away
   with the drawing, and a child of the <svg> would be scaled by the zoom.
   --------------------------------------------------------------------------- */

/** Its clearance from the foot of the stage. */
export const BOTTOM = 26;

/**
 * WHERE THE BAR SITS. Centred over the stage, near its foot — the position
 * every drawing tool in every editor has trained people to look at, and the one
 * place on this screen that is neither the sheet's middle nor the panel.
 *
 * `null` while the stage has not been measured, which is one frame on mount.
 */
export function useStageRect(stage) {
  const [box, setBox] = useState(null);
  const measure = useCallback(() => {
    const el = stage?.current;
    setBox(el ? el.getBoundingClientRect() : null);
  }, [stage]);
  useEffect(() => {
    measure();
    const el = stage?.current;
    window.addEventListener('resize', measure);
    el?.addEventListener('scroll', measure);
    // The stage changes width when the panel does, and neither of the two
    // listeners above fires for that.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (el && ro) ro.observe(el);
    return () => {
      window.removeEventListener('resize', measure);
      el?.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
  }, [measure, stage]);
  return box;
}

/** The hairline between two groups of keys in the bar. */
export const SEP = <span className="w-px h-5 bg-black/10 mx-0.5" aria-hidden="true" />;

/* --- THE TWO SCENE BUTTONS' OWN SHAPE --------------------------------------
   TYPE AND NOT A MARK, because they are the only things in this bar that are
   not about the next press on the drawing: everything else here arms a tool or
   answers for a gesture, and these two LEAVE — to the wiring, or to the
   schedule. A glyph would file them with the keys beside them.
   THE INERT ONE IS `disabled` AND STILL DRAWN, which is the honest picture of
   a scene this build does not have: out of reach rather than absent, the same
   rule the COB drawer's unbuilt gesture follows. */
export const SCENE = 'flex items-center h-9 px-2.5 rounded-[7px] border-0 '
  + 'bg-transparent cursor-pointer text-[11.5px] leading-none tracking-[-0.01em] '
  + 'text-black/75 whitespace-nowrap transition-colors duration-[120ms] '
  + 'enabled:hover:bg-black/[0.07] enabled:hover:text-black '
  + 'disabled:opacity-40 disabled:cursor-not-allowed '
  + 'focus-visible:outline-2 focus-visible:outline-offset-[-2px] '
  + 'focus-visible:outline-black/40';

/**
 * `stage` is the scroll container to centre on. `tail` is drawn at the right
 * end after a rule, separated from `children` because it is the part that is
 * there whatever the bar is currently doing.
 */
export default function StageBar({ stage, className = '', label = null,
                                   tail = null, children = null }) {
  const box = useStageRect(stage);
  if (!box) return null;

  return (
    <div
      className={'fixed z-30 flex items-center gap-0.5 rounded-[11px] bg-white '
        + 'border border-black/[0.10] shadow-[0_6px_24px_rgba(0,0,0,0.22)] '
        + 'px-1.5 py-1.5 ' + className}
      style={{ left: (box.left + box.right) / 2,
               bottom: Math.max(12, window.innerHeight - box.bottom + BOTTOM),
               transform: 'translateX(-50%)' }}
      /* THE BAR MUST NOT START A GESTURE ON THE PLAN. The stage's own pointer
         handlers are on the SVG, so a press here never reaches them — but the
         canvas-wide click that clears the selection is on the document, and a
         press that both pressed a button and deselected the shape the button
         acts on is a press with two meanings. */
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={label ?? undefined}>
      {children}
      {/* THE RULE ONLY WHERE THERE ARE TWO GROUPS TO SEPARATE. On a bar holding
          nothing but the tail it would be a hairline against the left edge. */}
      {tail && children ? SEP : null}
      {tail}
    </div>
  );
}
