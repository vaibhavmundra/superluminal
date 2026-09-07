import React, { useCallback, useEffect, useState } from 'react';
import PaletteButton from './PaletteButton.jsx';
import { TRACK_MODULES } from '../lib/magTrack.js';

/* ---------------------------------------------------------------------------
   TrackMenu — THE MAGNETIC TRACK'S DRAWER, and the second cell in this rail
   that opens instead of arming.

   IT IS CobMenu's OBJECT, ONE ITEM LONGER, and that is deliberate rather than
   lazy: the two cells are the same KIND of thing — one fitting with several
   gestures under it — and a drawer that hinged the other way, or painted itself
   a different colour, would say they were two different mechanisms. Everything
   the header of CobMenu argues (sideways and not down, fixed and measured
   because the rail clips its overflow, the rail's black and not the sheet's
   white) applies here word for word and is not repeated.

   WHAT DIFFERS IS WHAT THE CELLS ARE. CobMenu's two are GESTURES for one
   product — place a lamp, or set a run of them out. These three are PRODUCTS:
   three modules that clip into the same carrier. So the drawer's cells arm a
   fixture rather than a way of placing one, and the press that follows lands on
   a track rather than on the ceiling.

   THE TRACK ITSELF IS NOT IN HERE, and that is the other half of the design.
   Pressing the rail cell opens the geometry bar in the track's own role — see
   `openShapeTool` in App.jsx — so drawing a run, or turning a guide already on
   the drawing into one, is the shape tool's business. A fourth cell called
   something like "Profile" would be a second door to a bar that is already open.
   --------------------------------------------------------------------------- */

/** Where the drawer hangs: level with the button that opened it, hard against
 *  the rail's right edge. `null` until the anchor has been measured, which is
 *  one frame after the press. CobMenu's own hook — see the note there on why
 *  the rail's scroll is listened to as well as the window's. */
function useAnchorRect(anchor) {
  const [box, setBox] = useState(null);
  const measure = useCallback(() => {
    const el = anchor?.current;
    setBox(el ? el.getBoundingClientRect() : null);
  }, [anchor]);
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure]);
  return box;
}

/**
 * `mode` is which module is armed, or null for open-but-undecided — the caller
 * owns it, exactly as it owns every other latch in the rail. `disabled` is a set
 * of module ids that cannot be picked yet.
 */
export default function TrackMenu({ anchor, mode = null, disabled = [], onPick }) {
  const box = useAnchorRect(anchor);
  if (!box) return null;

  return (
    <div
      className="fixed z-30 flex flex-col bg-black border border-border/15
        rounded-r-[7px] shadow-[0_6px_24px_rgba(0,0,0,0.45)] overflow-hidden
        w-[64px]"
      style={{ left: box.right, top: box.top }}
      /* A PRESS IN HERE IS NOT A PRESS ON THE PLAN. Same guard CobMenu and
         ShapeMenu carry: the document-level click that clears the canvas
         selection does not know this bar exists. */
      onPointerDown={(e) => e.stopPropagation()}
      role="menu" aria-label="Magnetic track modules">
      {TRACK_MODULES.map((m) => (
        /* `airy`, BECAUSE THESE THREE PICTURES REACH THE BOTTOM EDGE. Each is a
           rail with its beam thrown DOWNWARD off it, so the lit part of the
           artwork runs into the caption and the label read as printed on the
           image rather than under it. The rail's other cells carry their own
           margin and keep the tighter default — see PaletteButton. */
        <PaletteButton key={m.id} icon={m.icon} label={m.label} title={m.title}
          airy on={mode === m.id} disabled={disabled.includes(m.id)}
          onClick={() => onPick(mode === m.id ? null : m.id)} />
      ))}
    </div>
  );
}
