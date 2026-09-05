import React from 'react';
import { Link } from 'react-router-dom';

// A URL STRING, NOT AN IMPORT. The file lives in `public/`, which Vite copies
// verbatim and does not hash — so this is its final URL in dev and in the build
// alike. An `import` of an absolute path happens to resolve through publicDir
// today, which is undocumented and not worth depending on. This works because
// `base` is '/' — see the note in vite.config.js.
//
// THE TRANSPARENT CUT, NOT THE ONE WITH THE BLACK PLATE BEHIND IT.
// `superluminal_logo.png` is the same artwork on an opaque #000 rectangle, and
// on a black bar the two look identical — until they do not. A plate has to
// match the surface under it EXACTLY: a header that is 5% white over black, a
// hover state, a scrim, a screenshot on a slightly different ground, and the
// rectangle shows as a seam round the mark. White ink on transparency has
// nothing to match. The plated cut is kept in `public/` because it is the right
// asset to hand somebody who needs a logo file; it is not the right asset to
// put in a bar.
const LOGO = '/superluminal_transparent.png';

// ---------------------------------------------------------------------------
// THE LOGO, AND ONLY THE LOGO.
//
// This used to draw the mark in CSS — a lit aperture, a disc with a halo — which
// was the FAVICON's artwork rendered a second time at a larger size. That is a
// tempting shortcut and it is wrong: a favicon is a 16px identifier that has to
// survive being one of thirty in a tab strip, and a logo is the brand's
// signature. Reusing one as the other means every change to either drags the
// other with it, and it puts a browser-chrome asset in the middle of the
// product. The favicon lives in index.html and nowhere else now.
//
// WHY IT IS A CROP AND NOT JUST AN <img>. The artwork does not fill its canvas:
// on the 2000×440 export the ink occupies x 117→1847, y 105→360, so two fifths
// of the height is padding. Dropped into a 56px bar as a plain image, a mark
// sized to the box would be a mark rendered well under the space it was given.
// So the wrapper is the size of the INK and the image is scaled and offset
// inside it.
//
// EVERY NUMBER BELOW IS DERIVED FROM THAT ONE MEASUREMENT (see .logo in
// styles.css), expressed against one custom property, so a usage sets a single
// width and the crop follows. If the artwork is ever re-exported with different
// padding, four numbers in one CSS rule change and nothing else does.
// ---------------------------------------------------------------------------

/** The mark on its own, croppable, at whatever width the caller wants. */
export function Logo({ width = 132, className = '' }) {
  return (
    <span
      className={'relative overflow-hidden flex-none block w-[var(--logo-w)] h-[calc(var(--logo-w)*0.147892)] ' + className}
      style={{ ['--logo-w']: `${width}px` }}
    >
      {/* `max-w-none` IS LOAD-BEARING AND IT IS THE WHOLE BUG THIS CROP HAD.
          Tailwind's preflight ships `img { max-width: 100% }`. The containing
          block here is the span, which is `--logo-w` wide — 88px in the nav —
          and the image is deliberately WIDER than that: 1.155402 × 88 =
          101.7px, because the crop works by scaling the whole 2000px canvas up
          until the 1731px of ink inside it measures exactly `--logo-w`. So
          preflight clamped it back down to 88px, the image rendered at 87%
          of the size the offsets were computed for, and the window showed
          the wrong part of the canvas — which is what "the logo is not
          centred" actually was. Every one of the four constants was correct;
          the element they applied to had been silently resized under them.

          MEASURED OFF THE FILE, NEVER GUESSED. The ink's alpha bounding box in
          the 2000×440 canvas is x 117→1847 (1731 wide) and y 105→360 (256
          tall), and all four numbers below fall out of that one measurement:
          2000/1731 for the scale, 256/1731 for the box's aspect, and 117/1731
          and 105/1731 for the two offsets. Re-export the artwork with different
          padding and these four change together and nothing else does.

          NO `invert`, AND ITS REMOVAL IS THE SECOND HALF OF THE NEW ARTWORK.
          The old cut was pure #000000 ink on transparency and the filter turned
          it white for the dark surfaces this mark lives on. This cut is already
          white — every opaque pixel samples about (253,253,253) — so inverting
          it would paint the wordmark black on a black bar and lose it
          completely. */}
      <img
        src={LOGO}
        alt="Super Luminal"
        className="absolute block max-w-none w-[calc(var(--logo-w)*1.155402)] h-auto left-[calc(var(--logo-w)*-0.067591)] top-[calc(var(--logo-w)*-0.060659)]"
      />
    </span>
  );
}

/**
 * `width` IS THE WIDTH OF THE INK, and the default moved with the artwork.
 *
 * The old mark was a STACKED two-line block — 352 × 123 of ink, an aspect of
 * 2.86:1 — so 88px wide put a 31px-tall logotype in a 56px bar. This one is a
 * single line with the disc beside it: 1731 × 256, an aspect of 6.76:1. At the
 * same 88px it would stand 13px tall, which in a 56px bar reads as a caption
 * rather than as a signature. 132 restores roughly the height the bar was
 * designed around.
 *
 * A REMINDER RATHER THAN A RULE: this number is not derived from anything, so
 * re-exporting the artwork at a third aspect means looking at the bar again.
 */
export default function Wordmark({ where = null, to = '/', width = 132 }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0 tracking-[-0.025em]">
      <Link to={to} className="flex items-center gap-2.5 no-underline" aria-label="Super Luminal">
        <Logo width={width} />
      </Link>
      {where && <>
        <span className="w-px h-[15px] bg-border/10 flex-none rotate-[15deg]" aria-hidden="true" />
        <span className="text-xs text-muted truncate">{where}</span>
      </>}
    </div>
  );
}
