import React from 'react';

// ---------------------------------------------------------------------------
// PaletteButton — one cell of one of this panel's palettes.
//
// IT EXISTS BECAUSE THE CELL IS NOW IN FOUR PLACES AND WAS DRIFTING. The
// electrical row, the lighting row, the no-light-zone cell and the cove button
// hand-written in App.jsx were four copies of the same twelve lines of Tailwind,
// kept in step by hand — and the last restyle proved they would not be: the
// cove button sat in the old frosted-glass style beside three black ones until
// somebody noticed. The cells are not merely similar, they are the same
// control: the same square, the same symbol-above-caps-below, the same armed
// ring. One component, and a change to the look happens once.
//
// WHAT IT IS NOT is a palette. It knows nothing about tools, catalogue ids or
// which machine a press arms — the rows own all of that, which is why three
// quite different palettes can share it.
//
// THE BLACK IS THE GROUND, EDGE TO EDGE. The icon used to be a 40px stamp
// floating in a frosted cell, which spent most of the button's area on the
// panel showing through and left the artwork too small to read. Icon and label
// sit on one black field now, so nothing inside draws its own box and the whole
// square reads as the symbol.
//
// HOVER AND ARMED ARE BOTH EDGES, for the same reason: swapping the fill would
// re-introduce the box the black ground exists to remove. Armed takes the
// accent ramp as a 1px ring — `gradient-ring` is a ::before masked to its own
// 1px padding, defined in styles.css beside the gradient it reads, because a
// border cannot hold one. `border-transparent` keeps the button's SIZE
// identical armed and not: the border box is still 1px, it just stops painting.
// ---------------------------------------------------------------------------

/**
 * `on` is armed/open — whatever "this cell is the live one" means to the row
 * that owns it. `title` falls back to the label, which is what every caller
 * wanted anyway.
 */
export default function PaletteButton({ icon, label, on = false, disabled = false,
                                        title, onClick, ...rest }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      title={title ?? label} aria-pressed={on}
      className={'flex flex-col items-center gap-[4px] p-[6px] bg-black '
        + 'rounded-[8px] border cursor-pointer transition-colors duration-[120ms] '
        + 'disabled:opacity-[.45] disabled:cursor-not-allowed '
        + (on
          ? 'border-transparent gradient-ring'
          : 'border-border/10 enabled:hover:border-border/40')}
      {...rest}>
      {/* alt="" ON PURPOSE: the label below is the accessible name, and a screen
          reader reading "fan" twice is worse than not drawing the picture for it
          at all. GUARDED, so a row listing a cell without artwork degrades to
          its label instead of rendering a broken image. */}
      {icon && (
        <img src={icon} alt="" width="80" height="80"
          className="w-full aspect-square object-contain select-none" draggable="false" />
      )}
      {/* WHITE WHEN ARMED — `text-ink` was the bug it replaced. Ink is #000000,
          which is right on paper and invisible here: arming a fan made its name
          DISAPPEAR, the opposite of what a latched control should do.
          `text-subtle` and not `text-muted` at rest: the label is a caption
          under a picture that already names the thing. */}
      <span className={'text-[8.5px] leading-[1.15] text-center uppercase tracking-[0.07em] '
        + (on ? 'text-white' : 'text-subtle')}>{label}</span>
    </button>
  );
}
