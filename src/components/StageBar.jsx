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

/* --- A SCENE THAT IS A STATE RATHER THAN A DESTINATION ---------------------
   THE OTHER TAIL BUTTONS LEAVE and this one does not: the wiring is drawn over
   the layout you are already looking at, so the honest picture of it is a
   switch that is visibly on or off, not a word you press and then have to look
   at the drawing to find out what happened.

   THE STATE IS WRITTEN INSIDE THE TRACK, opposite the knob. A capsule with a
   knob and no word is a control you read by remembering which side means on;
   ON and OFF in the track say it outright, in the space the knob is not using,
   without a caption beside the bar. */
export function SceneSwitch({ label, on = false, title = null, onClick }) {
  return (
    <button type="button" role="switch" aria-checked={on} title={title ?? undefined}
      className={`${SCENE} gap-2`} onClick={onClick}>
      {label}
      <span aria-hidden="true"
        className={'relative flex-none block w-[46px] h-[20px] rounded-full '
          + 'transition-colors duration-150 '
          + (on ? 'bg-black' : 'bg-black/[0.13]')}>
        <span className={'absolute top-1/2 -translate-y-1/2 text-[9px] leading-none '
          + 'font-semibold tracking-[0.08em] '
          + (on ? 'left-[7.5px] text-white' : 'right-[6.5px] text-black/55')}>
          {on ? 'ON' : 'OFF'}
        </span>
        {/* `left` AND NOT A TRANSFORM, because the knob is inside a box that is
            already translating its own label vertically; two transforms on one
            capsule is one of them being overwritten. */}
        <span className={'absolute top-[3px] w-[14px] h-[14px] rounded-full bg-white '
          + 'shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-[left] duration-150 '
          + (on ? 'left-[29px]' : 'left-[3px]')} />
      </span>
    </button>
  );
}

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
      /* --- ONE ROW, WHATEVER IS IN IT -----------------------------------
         `flex-nowrap` IS STATED RATHER THAN LEFT TO THE DEFAULT, because it is
         a rule about this bar and not an accident of flexbox: a contextual bar
         that wraps is a bar whose buttons move to a different line as you use
         it — the tick you were about to press is suddenly under the wattage
         slider — and the position people have learned is the CENTRE of one row.
         The downlight bar carried `flex-wrap` and a 92vw cap for exactly the
         case this forbids; it grows sideways now. */
      className={'fixed z-30 flex flex-nowrap items-center gap-0.5 rounded-[11px] '
        + 'bg-white border border-black/[0.10] shadow-[0_6px_24px_rgba(0,0,0,0.22)] '
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
