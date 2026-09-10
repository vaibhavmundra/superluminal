import React from 'react';

// ---------------------------------------------------------------------------
// PaletteButton — one cell of one of the rail's five flyouts.
//
// IT EXISTS BECAUSE THE CELL WAS IN FOUR PLACES AND WAS DRIFTING. The electrical
// row, the lighting row, the no-light-zone cell and the cove button hand-written
// in App.jsx were four copies of the same twelve lines of Tailwind, kept in step
// by hand — and the restyle that prompted this proved they would not be: the
// cove button sat in the old frosted-glass style beside three black ones until
// somebody noticed. The cells are not merely similar, they are the same control:
// the same square, the same symbol-above-caps-below, the same armed ring. One
// component, and a change to the look happens once — which is what let the whole
// rail change tone in one line when the chrome went grey.
//
// ITS CALLERS ARE NOW THE FIVE FLYOUTS AND NOTHING ELSE. The rail's own five
// cells are not these: a category has no object to photograph, so it gets a line
// mark at its own size, and `RailCell` in ToolRail draws it. See the note there
// on why that is a separate component rather than a flag on this one.
//
// WHAT IT IS NOT is a palette. It knows nothing about tools, catalogue ids or
// which machine a press arms — the rows own all of that, which is why three
// quite different palettes can share it.
//
// ONE GROUND, EDGE TO EDGE, AND THE CELL DOES NOT PAINT IT. The icon used to be
// a stamp floating inside a padded, bordered, rounded cell — so every button
// drew its own box, the rail was a column of boxes on a second ground, and the
// artwork was two thirds the width it had to play with. There is one field now
// and it belongs to whatever this cell is put on, so no edge separates them and
// what you see down the column is the symbols.
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
 * others. The Tracks flyout in ToolRail is the only caller that sets it.
 */
export default function PaletteButton({ icon, label, on = false, disabled = false,
                                        airy = false,
                                        title, onClick, ...rest }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      title={title ?? label} aria-pressed={on}
      /* `bg-transparent` AND NOT `bg-black`, WHICH IS THE WHOLE OF THE NOTE
         ABOVE MADE LITERAL. The cell used to paint its own black, which was the
         same black the rail was, so nothing showed — and then the rail went
         grey (see `--color-chrome`) and a black cell on a grey flyout was the
         box this component exists to have removed, drawn again. A cell takes
         whatever surface it is put on; only the hover and the armed ring are
         the cell's own. */
      className={'flex flex-col items-center p-0 bg-transparent '
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
          `text-faint` AND NOT `text-subtle` AT REST, AND THE CHROME'S TONE IS
          WHY IT MOVED. The caption is deliberately quiet — it sits under a
          picture that already names the thing — but #7A7A7A on the flyout's
          #2F2F2F is about 2.4:1, which is quiet to the point of absent. #A8A8A8
          is 4.2:1 and is the ink the rail's own five labels wear, so a category
          and the cells inside it read at one weight. */}
      {/* A NAME WITH A LONG WORD IN IT GETS A POINT LESS TYPE RATHER THAN A
          SHORTER NAME. Eight tracked capitals is about all 64px holds, and past
          that the default is not a tidy wrap: CSS breaks at spaces only, so a
          single long word overflows its cell and the flyout's `overflow-hidden`
          clips it — "ADJUSTABL". The abbreviations in ToolRail's `SHORT` are one
          answer to that and are still right for most of them (a chandelier is a
          chandelier however it is captioned), but they cost the one case where
          the words ARE the name: "Adjustable spot" is a verb, and "Adj. spot"
          hands the fitting back to being called a spot.
          THE CELL DECIDES AND NOT THE CALLER, because the constraint is the
          cell's — 64px and no padding — and a flag would be one more thing a
          new row has to know. A label whose longest word still fits is
          untouched, so this changes nothing about the eleven that already fit.
          8 IS MEASURED OFF THIS RAIL RATHER THAN CHOSEN: every caption of nine
          characters or more is in `SHORT`, and every one of eight or fewer —
          Diffuser, Pendant, Sconce, Cassette — is not. */}
      <span className={(String(label ?? '').split(/\s+/).some((w) => w.length > 8)
          ? 'text-[7.2px] ' : 'text-[8.5px] ')
        + 'leading-[1.15] text-center uppercase tracking-[0.07em] '
        + (on ? 'text-white' : 'text-faint')}>{label}</span>
    </button>
  );
}
