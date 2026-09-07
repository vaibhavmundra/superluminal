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
// THE BLACK IS THE GROUND, EDGE TO EDGE, AND NOW SO IS THE PICTURE. The icon
// used to be a stamp floating inside a padded, bordered, rounded cell — so every
// button drew its own box, the rail was a column of boxes on a second ground,
// and the artwork was two thirds the width it had to play with. There is one
// black field now: the rail's, the button's and the image's are the same black
// and no edge separates them, so what you see down the column is the symbols.
//
// NO PADDING AND NO RADIUS ON THE CELL. Both existed to keep the picture off the
// border, and there is no border. The caption keeps a few pixels under it,
// because type against the next button's artwork is not a margin anybody
// intended.
//
// HOVER AND ARMED ARE BOTH LIGHT RATHER THAN EDGES. On a bordered cell an edge
// was the only mark available; on a full-bleed one a hairline round the picture
// would put the box straight back. Hover lifts the ground a few percent; armed
// takes the accent ramp as a 1px ring — `gradient-ring` is a ::before masked to
// its own 1px padding, defined in styles.css beside the gradient it reads,
// because a border cannot hold one, and it needs no border to sit on.
// ---------------------------------------------------------------------------

/**
 * `on` is armed/open — whatever "this cell is the live one" means to the row
 * that owns it. `title` falls back to the label, which is what every caller
 * wanted anyway.
 *
 * `airy` GIVES THE CAPTION ROOM, AND IT IS FOR ARTWORK THAT REACHES THE EDGE.
 *
 * MOST OF THIS RAIL'S PICTURES CARRY THEIR OWN MARGIN — a fan, a cassette, a
 * downlight, all drawn with air round them — so a single pixel between the image
 * and its caption is enough and the column stays tight. The track modules do
 * not: each is a rail with a beam thrown DOWNWARD off it, so the bright part of
 * the picture runs to the bottom edge of the square and the caption sat in the
 * light. It read as a label printed on the artwork rather than under it.
 *
 * A FLAG AND NOT A CHANGE TO THE DEFAULT, because the default is right for
 * eleven cells and wrong for three. Padding every cell to suit the three would
 * lengthen a column whose positions people learn, for no reason on any of the
 * others. See TrackMenu, which is the only caller that sets it.
 */
export default function PaletteButton({ icon, label, on = false, disabled = false,
                                        airy = false,
                                        title, onClick, ...rest }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      title={title ?? label} aria-pressed={on}
      className={'flex flex-col items-center p-0 bg-black '
        + (airy ? 'gap-[5px] pb-[8px] ' : 'gap-[1px] pb-[5px] ')
        + 'border-0 cursor-pointer transition-colors duration-[120ms] '
        + 'disabled:opacity-[.45] disabled:cursor-not-allowed '
        + 'focus-visible:outline-2 focus-visible:outline-accent '
        + 'focus-visible:outline-offset-[-2px] '
        + (on ? 'gradient-ring' : 'enabled:hover:bg-white/[0.07]')}
      {...rest}>
      {/* alt="" ON PURPOSE: the label below is the accessible name, and a screen
          reader reading "fan" twice is worse than not drawing the picture for it
          at all. GUARDED, so a row listing a cell without artwork degrades to
          its label instead of rendering a broken image. */}
      {/* ARTWORK OR A MARK, AND THE TYPE OF `icon` DECIDES WHICH. Every cell in
          this rail is a photograph of a thing — a fan, a cassette, a downlight —
          because at this size a picture of an object beats a line drawing of it.
          A cell whose subject is not an object breaks that: the geometry tools
          are a rectangle, a circle and a line, and a circle is already the
          clearest possible picture of a circle. It is the same split ShapeMenu
          makes for the same six primitives, said about the rail.
          A STRING IS A FILE, ANYTHING ELSE IS DRAWN AS GIVEN. Sized by this
          file either way, so a mark and a photograph occupy the same square. */}
      {typeof icon === 'string' ? (
        <img src={icon} alt="" width="80" height="80"
          className="w-full aspect-square object-contain select-none" draggable="false" />
      ) : icon ? (
        <span className="w-full aspect-square flex items-center justify-center
          select-none" aria-hidden="true">{icon}</span>
      ) : null}
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
