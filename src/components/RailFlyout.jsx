import React, { useCallback, useEffect, useState } from 'react';

/* ---------------------------------------------------------------------------
   RailFlyout — WHAT IS UNDER ONE OF THE RAIL'S FIVE CELLS.

   THE RAIL HOLDS CATEGORIES NOW, AND A CATEGORY IS NOT A TOOL. It used to hold
   fourteen cells, one per fitting, which is a column taller than any screen —
   so it scrolled, and a tool strip that scrolls has lost the one thing it was
   for: the positions are what people learn, and a position that moves is not
   one. Five cells fit on any screen with room to spare, and every fitting is
   one press further in.

   IT OPENS SIDEWAYS, WHICH WAS ALREADY THE RAIL'S IDIOM. Down would push the
   cells under it about while somebody is choosing, and the COB's drawer had
   settled this question once already — this is that drawer, generalised to all
   five cells. It butts against the rail so the two read as one object hinged
   open.

   FIXED AND MEASURED, NOT ABSOLUTE. The rail clips its own overflow, so a child
   positioned inside it would be cut off at the rail's edge and never seen.

   THE RAIL'S OWN GREY AND NOT THE WHITE OF THE BAR ON THE DRAWING. That bar is
   white because it belongs to the SHEET and has to be legible on both grounds.
   This belongs to the rail: it carries the rail's cells, at the rail's tone,
   with the rail's artwork, and painting it anything else would make two cells
   cut from one strip look like two different controls. A quiet border separates
   it from the drawing without throwing a shadow back across the rail.

   NOTHING IN HERE IS DECIDED HERE, exactly as in the rail above it. It is a
   panel with cells in it that report presses.
   --------------------------------------------------------------------------- */

/** One cell's width, and it is the artwork's rather than the rail's — see
 *  PaletteButton for why the picture is the name. */
/* EDIT THIS ONE VALUE TO MAKE EVERY LEFT-RAIL FLYOUT NARROWER OR WIDER.
   It is the width of one option column; categories with more than three options
   use two of these columns. */
export const FLYOUT_CELL_WIDTH = 76;

/** Where the flyout hangs: level with the cell that opened it, hard against the
 *  rail's right edge. `null` until the anchor has been measured, which is one
 *  frame after the press. */
function useAnchorRect(anchor) {
  const [box, setBox] = useState(null);
  const measure = useCallback(() => {
    const el = anchor?.current;
    setBox(el ? el.getBoundingClientRect() : null);
  }, [anchor]);
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    /* THE RAIL CAN SCROLL, AND THE CELL GOES WITH IT. A flyout left behind at
       the pixel the cell used to be at would point at the wrong category — so
       the rail's own scroll is listened to as well as the window's. `true`
       catches it in the capture phase, because a scroll event does not
       bubble. */
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure]);
  return box;
}

/**
 * `cols` IS ARITHMETIC AND NOT A CHOICE. Up to three cells read as a column
 * hinged off the cell that opened them; five in a column is a 350px strip
 * standing over the drawing, so those go two abreast. The caller does not
 * decide it because the caller would then be deciding it five times.
 *
 * PULLED BACK UP INSIDE THE WINDOW where a tall flyout would otherwise run off
 * the foot of it — the lowest cell in the rail is the one this matters for, and
 * it is also the one with the most in it.
 */
export default function RailFlyout({ anchor, label, children, placement = 'right', boundary = null }) {
  const box = useAnchorRect(anchor);
  if (!box) return null;

  const n = React.Children.toArray(children).length;
  /* THE TOP RAIL READS LEFT TO RIGHT, SO ITS DRAWER DOES TOO. Every option in
     the opened category stays in one row immediately beneath its parent cell;
     unlike the side rail, there is no second vertical navigation hiding inside
     the first. The drawer is allowed to extend over the drawing. */
  const cols = placement === 'down' ? Math.max(1, n) : (n > 3 ? 2 : 1);
  const naturalWidth = cols * FLYOUT_CELL_WIDTH + 2;
  /* A DOWNWARD TRAY BELONGS TO THE 9:16 VIEWPORT. Four lamps can still sit in
     one row; a longer group keeps that one-row reading and scrolls sideways
     inside the viewport instead of growing beyond it. */
  const width = placement === 'down' && boundary
    ? Math.min(naturalWidth, boundary.width)
    : naturalWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  /* THE CELLS ARE SQUARE PLUS A CAPTION, so a row is a shade over its width —
     enough to keep the panel off the bottom of the screen without measuring it
     after the fact and moving it under somebody's hand. */
  const rows = placement === 'down' ? 1 : Math.ceil(n / cols);
  const tall = rows * (FLYOUT_CELL_WIDTH + 14) + 2;
  const top = placement === 'down'
    ? Math.max(8, Math.min(box.bottom, vh - tall - 8))
    : Math.max(8, Math.min(box.top, vh - tall - 8));

  const left = placement === 'down'
    ? boundary
      ? Math.max(boundary.left,
          Math.min(box.left, boundary.left + boundary.width - width))
      : Math.max(8, Math.min(box.left, window.innerWidth - width - 8))
    : box.right;

  return (
    <div
      className={'fixed z-30 grid bg-chrome border border-border/10 '
        + (placement === 'down' ? 'overflow-x-auto overflow-y-hidden ' : 'overflow-hidden ')
        + (placement === 'down' ? 'rounded-b-[7px]' : 'rounded-r-[7px]')}
      style={{ left,
               top, width,
               gridTemplateColumns: `repeat(${cols}, ${FLYOUT_CELL_WIDTH}px)` }}
      /* A PRESS IN HERE IS NOT A PRESS ON THE PLAN. The document-level pointer
         handler that clears the canvas selection does not know this panel
         exists, and a press that both picked a tool and deselected something
         would be a press with two meanings. Same guard the bar on the drawing
         carries. */
      onPointerDown={(e) => e.stopPropagation()}
      role="menu" aria-label={label}>
      {children}
    </div>
  );
}
