import React, { useCallback, useEffect, useState } from 'react';
import PaletteButton from './PaletteButton.jsx';

/* ---------------------------------------------------------------------------
   CobMenu — THE RAIL'S OWN DRAWER, AND THE ONE CELL THAT OPENS INSTEAD OF ARMING.

   Every other cell in the rail is a verb: press it and the next click on the
   drawing does the thing. This one is a noun with two verbs under it — a
   recessed COB placed one at a time, or a run of them — and there is no honest
   way to make that one press. Two cells in the rail would have been the other
   answer and is worse: they are the same fitting, they would sit apart from each
   other the moment anything was inserted between them, and the column would say
   this app has two kinds of downlight when it has one kind and two gestures.

   SO IT IS A DRAWER, AND IT OPENS SIDEWAYS. Down would push the eleven tools
   under it about while somebody is choosing, which is the one thing a tool strip
   must not do — the column's positions are what people learn. Sideways it lands
   over the drawing, where there is always room, and it butts against the rail so
   the two read as one object hinged open.

   FIXED AND MEASURED, NOT ABSOLUTE. The rail scrolls and clips its overflow
   (`overflow-x-hidden`, which is what keeps the icons from spilling), so a child
   positioned inside it would be cut off at the rail's edge — the whole drawer
   would be invisible. It is measured off the button's own rect instead, exactly
   as ShapeMenu and OptionCoach measure off the stage.

   THE RAIL'S BLACK AND NOT ShapeMenu's WHITE. The white bar on the drawing is
   white because it is a control that belongs to the SHEET and has to be legible
   on both grounds. This belongs to the rail: it carries the rail's cells, at the
   rail's width, with the rail's artwork, and painting it white would make two
   cells cut from one strip look like two different controls. The hairline and
   the shadow are what say it is in front of the drawing rather than part of it.
   --------------------------------------------------------------------------- */

/** The cells, and the artwork is the argument. Both marks are the COB's own
 *  symbol with the gesture drawn beside it — a cursor, or the run it steps
 *  along — so the drawer says what each does without a sentence under it. */
export const COB_MODES = [
  { id: 'manual', label: 'Manual', icon: '/icons/cob_manual.png',
    title: 'Manual — click the ceiling to place one at a time' },
  { id: 'array', label: 'Array', icon: '/icons/cob_array.png',
    title: 'Array — a run of them, evenly spaced' },
];

/** Where the drawer hangs: level with the button that opened it, hard against
 *  the rail's right edge. `null` until the anchor has been measured, which is
 *  one frame after the press. */
function useAnchorRect(anchor) {
  const [box, setBox] = useState(null);
  const measure = useCallback(() => {
    const el = anchor?.current;
    setBox(el ? el.getBoundingClientRect() : null);
  }, [anchor]);
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    /* THE RAIL SCROLLS, AND THE BUTTON GOES WITH IT. A drawer left behind at the
       pixel the button used to be at would point at the wrong tool — so the
       rail's own scroll is listened to as well as the window's. `true` catches
       it in the capture phase, because a scroll event does not bubble. */
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure]);
  return box;
}

/**
 * `mode` is which of the two is armed, or null for open-but-undecided — the
 * caller owns it, exactly as it owns every other latch in the rail. `disabled`
 * is a set of mode ids that cannot be picked yet.
 */
export default function CobMenu({ anchor, mode = null, disabled = [], onPick }) {
  const box = useAnchorRect(anchor);
  if (!box) return null;

  return (
    <div
      className="fixed z-30 flex flex-col bg-black border border-border/15
        rounded-r-[7px] shadow-[0_6px_24px_rgba(0,0,0,0.45)] overflow-hidden
        w-[64px]"
      style={{ left: box.right, top: box.top }}
      /* A PRESS IN HERE IS NOT A PRESS ON THE PLAN. The document-level click
         that clears the canvas selection does not know this bar exists, and a
         press that both picked a gesture and deselected something would be a
         press with two meanings. Same guard ShapeMenu carries. */
      onPointerDown={(e) => e.stopPropagation()}
      role="menu" aria-label="Recessed COB">
      {COB_MODES.map((m) => (
        <PaletteButton key={m.id} icon={m.icon} label={m.label} title={m.title}
          on={mode === m.id} disabled={disabled.includes(m.id)}
          onClick={() => onPick(mode === m.id ? null : m.id)} />
      ))}
    </div>
  );
}
