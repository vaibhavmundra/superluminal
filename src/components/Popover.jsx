import React, { useCallback, useEffect, useRef, useState } from 'react';

/* ---------------------------------------------------------------------------
   Popover — A PANEL HUNG OFF A BUTTON, AND FOUR THINGS NOW HANG OFF ONE.

   THE CHROME MOVED TO THE EDGES AND THE PANEL STOPPED BEING A COLUMN. Share's
   three file formats, the View section's twelve layer checkboxes and the whole
   Admin block used to be sections in a 340px scroller — a column you scrolled
   to find them in. They are now a bar at the top and a bar at the foot, and
   neither has room to hold a list. So each one is a button that opens.

   ALL FOUR ARE THE SAME OBJECT, WHICH IS THE ONLY REASON THIS EXISTS. A
   measured panel, a click-outside, an Escape and a latch on the button that
   opened it: four copies of that would be four things to keep in step, and the
   rail's own drawers are the standing proof of what happens when a floating
   panel is written twice — there were two of them, byte-identical, until they
   became RailFlyout.

   MEASURED AND `fixed`, NOT `absolute`, for RailFlyout's reason: the bars it
   hangs off are inside containers that clip and scroll, so a child positioned
   within one would be cut off at that container's edge and never seen.

   IT OPENS TOWARDS THE MIDDLE OF THE SCREEN. A panel off the FOOT of the page
   opens upward and one off the head opens down — `side` says which — and it is
   pinned to whichever end of the button is nearer its own edge, so a panel off a
   button in the far right corner does not run off the page. That is arithmetic
   rather than a choice, so the caller does not make it.
   --------------------------------------------------------------------------- */

/** Its clearance from the button it belongs to. */
const GAP = 8;

/** ...and from the edge of the window, so a tall panel never runs off it. */
const EDGE = 10;

/* THE PANEL, ON THE SAME GROUND AS THE FLOATING WINDOW — `--color-panel`, and
   not the rail's #2F2F2F. That is arithmetic and not taste: what these hold is
   twelve layer checkboxes and two hundred lines of admin readings, all of it
   written in `--color-muted` (#525252), which is about 1.5:1 against #2F2F2F.
   The note on the editor's four surfaces in styles.css carries the figures.
   OPAQUE, AND THE SHADOW IS WHAT LIFTS IT. It opens over the drawing, so it has
   to be readable against line work; a translucent panel over a plan is a panel
   with a plan printed through it. */
const PANEL = 'fixed z-40 rounded-lg bg-panel '
  + 'shadow-[0_10px_34px_rgba(0,0,0,0.55)] py-2.5 overflow-y-auto';

/**
 * `open` and `onClose` are the caller's, because what else has to stand down
 * when this opens is never this component's business — the same rule every
 * latch in the rail follows.
 *
 * `side` is 'top' for a panel that opens upward off a footer, 'bottom' for one
 * that drops out of a header. `align` pins the panel's near edge: 'end' is the
 * right-hand one, which is what a control in the right of a bar wants.
 */
export default function Popover({ anchor, open, onClose, side = 'top',
                                  align = 'end', width = 248, label,
                                  children }) {
  const [box, setBox] = useState(null);
  const panelRef = useRef(null);

  const measure = useCallback(() => {
    const el = anchor?.current;
    setBox(el ? el.getBoundingClientRect() : null);
  }, [anchor]);

  useEffect(() => {
    if (!open) return undefined;
    measure();
    window.addEventListener('resize', measure);
    /* `true` FOR THE CAPTURE PHASE, because a scroll event does not bubble and
       the bar this hangs off may itself be inside something that scrolls. */
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, measure]);

  /* --- THE TWO WAYS OUT, AND NEITHER IS A BUTTON ------------------------
     A PRESS ANYWHERE ELSE CLOSES IT, which is what makes this a popover rather
     than a panel: it is a glance, not a place you are in. The anchor is excluded
     because that button's own handler toggles — without the exclusion a press on
     it would close this here and reopen it there, and the control would appear
     dead.
     ESCAPE TOO, because a thing that opened over the drawing has to be
     dismissable from the keyboard by anybody who cannot see where to click.
     `pointerdown` AND NOT `click`: the canvas commits gestures on pointer
     events, so waiting for a click would let one press both close this and
     start drawing under it. */
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (panelRef.current?.contains(e.target)) return;
      if (anchor?.current?.contains(e.target)) return;
      onClose?.();
    };
    const key = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key);
    };
  }, [open, onClose, anchor]);

  if (!open || !box) return null;

  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  /* PINNED TO WHICHEVER END THE CALLER ASKED FOR, then pulled back inside the
     window — a panel wider than the space left of its button would otherwise
     hang off the page rather than being read. */
  const raw = align === 'end' ? box.right - width : box.left;
  const left = Math.max(EDGE, Math.min(raw, vw - width - EDGE));

  const style = side === 'top'
    ? { left, width, bottom: vh - box.top + GAP, maxHeight: box.top - GAP - EDGE }
    : { left, width, top: box.bottom + GAP, maxHeight: vh - box.bottom - GAP - EDGE };

  return (
    <div ref={panelRef} className={PANEL} style={style}
      role="dialog" aria-label={label}>
      {children}
    </div>
  );
}

/**
 * THE BUTTON THAT OPENS ONE, because all four of them are the same button and
 * the caret has to know which way the panel goes.
 *
 * A CARET AND NOT A CHEVRON THAT SWAPS GLYPHS — the mark itself carries the
 * state by rotating, which is the rule the analysis rows' caret follows: a
 * control that changes shape reads as two controls.
 */
export const BAR_BTN = 'inline-flex items-center gap-1.5 h-[26px] px-2 rounded '
  + 'border-0 bg-transparent cursor-pointer text-[11.5px] leading-none '
  + 'whitespace-nowrap transition-colors duration-[120ms] '
  + 'focus-visible:outline-2 focus-visible:outline-accent '
  + 'focus-visible:outline-offset-2';

export function PopoverButton({ open, side = 'top', label, title, onClick,
                                innerRef, ...rest }) {
  /* WHICH WAY THE CARET POINTS AT REST is the direction the panel will go, and
     it flips when the panel is there — so the mark says both what pressing
     will do and what pressing has done. */
  const up = side === 'top' ? !open : open;
  return (
    <button type="button" ref={innerRef} onClick={onClick} title={title ?? label}
      aria-expanded={open}
      className={BAR_BTN + (open ? ' bg-white/10 text-white' : ' text-faint hover:text-white')}
      {...rest}>
      {label}
      <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"
        fill="none" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round"
        className={'shrink-0 transition-transform duration-[120ms] '
          + (up ? 'rotate-180' : '')}>
        <path d="M1.5 3.5 L5 7 L8.5 3.5" />
      </svg>
    </button>
  );
}
