import React from 'react';
import { Link } from 'react-router-dom';

// A URL STRING, NOT AN IMPORT. The file lives in `public/`, which Vite copies
// verbatim and does not hash — so this is its final URL in dev and in the build
// alike. An `import` of an absolute path happens to resolve through publicDir
// today, which is undocumented and not worth depending on. This works because
// `base` is '/' — see the note in vite.config.js.
//
// THE PLATED CUT: white ink on an opaque #000 rectangle.
//
// CHOSEN FOR WEIGHT, and the figure depends on which export is in place. The
// same artwork ships at 500 x 110 (11.6 kB) and at 2000 x 440 (116 kB); the
// transparent cut is 123 kB, because the soft alpha halo round the disc is
// exactly the kind of gradient PNG cannot compress, where flattening it onto
// black leaves a handful of flat runs. Against the SMALL plate that is a tenth
// the bytes on the critical path of every first paint. Against the large one it
// is a rounding error — so if weight is the reason, the 500 px export is the one
// to keep in `public/`; nothing here renders the mark wider than about 153 px,
// which the small file covers at 2x and more.
//
// WHAT IT COSTS is that the plate has to sit on black. It is a rectangle, and
// on any surface that is not #000 it shows as one — so every bar this mark
// appears in is opaque black rather than the 5% white glass the rest of the app
// wears. That is a real constraint and it is written down here because the next
// person to add a header will not guess it: put this logo on glass and you get
// a black box round it.
const LOGO = '/superluminal_logo.png';

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
// WHY IT IS A CROP AND NOT JUST AN <img>. The ink does not fill the plate: on
// the 2000×440 canvas it occupies x 118→1855, y 103→352, so two fifths of the
// height is padding. Dropped into a 56px bar as a plain image, a mark sized to the box
// would be a mark rendered well under the space it was given. So the wrapper is
// the size of the INK and the image is scaled and offset inside it.
//
// AND CROPPING AN OPAQUE PLATE COSTS NOTHING, which is worth saying because it
// looks like it should. The visible box is the ink's box and the plate fills it
// exactly — there is no edge of black left over, because the crop window ends
// where the ink does. On a black bar the result is indistinguishable from a
// transparent asset.
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
      className={'relative overflow-hidden flex-none block w-[var(--logo-w)] h-[calc(var(--logo-w)*0.143843)] ' + className}
      style={{ ['--logo-w']: `${width}px` }}
    >
      {/* `max-w-none` IS LOAD-BEARING AND IT IS THE WHOLE BUG THIS CROP HAD.
          Tailwind's preflight ships `img { max-width: 100% }`. The containing
          block here is the span, which is `--logo-w` wide — 132px in the nav —
          and the image is deliberately WIDER than that: 1.150748 × 132 =
          151.9px, because the crop works by scaling the whole 2000px canvas
          until the 1738px of ink inside it measures exactly `--logo-w`. So
          preflight clamped it back down to 132px, the image rendered at 87%
          of the size the offsets were computed for, and the window showed
          the wrong part of the canvas — which is what "the logo is not
          centred" actually was. Every one of the four constants was correct;
          the element they applied to had been silently resized under them.

          MEASURED OFF THE FILE, NEVER GUESSED — and on THIS file it is the ink
          against the plate rather than an alpha box, because every pixel is
          opaque. In the 2000×440 canvas the ink runs x 118→1855 (1738 wide) and
          y 103→352 (250 tall), and all four numbers below fall out of that one
          measurement: 2000/1738 for the scale, 250/1738 for the box's aspect,
          and 118/1738 and 103/1738 for the two offsets. Re-export the artwork
          with different padding and these four change together, and nothing else
          does.

          THE TWO EXPORTS OF THIS ARTWORK MEASURE 0.3% APART — the 500px cut's
          ink reads 432 x 64 against this one's 1738 x 250, because a threshold
          run over an antialiased edge is coarser at a quarter the resolution.
          Either set of numbers renders the other file correctly to well under a
          pixel, so swapping the file for the other size needs no edit here.

          NO `invert`. The old cut was pure #000000 ink on transparency and the
          filter turned it white for the dark surfaces this mark lives on. This
          one is already white on black — inverting it would give black ink on a
          white plate, which is both wrong and impossible to miss. */}
      <img
        src={LOGO}
        alt="Super Luminal"
        className="absolute block max-w-none w-[calc(var(--logo-w)*1.150748)] h-auto left-[calc(var(--logo-w)*-0.067894)] top-[calc(var(--logo-w)*-0.059264)]"
      />
    </span>
  );
}

/**
 * `width` IS THE WIDTH OF THE INK, and the default moved with the artwork.
 *
 * The old mark was a STACKED two-line block — 352 × 123 of ink, an aspect of
 * 2.86:1 — so 88px wide put a 31px-tall logotype in a 56px bar. This one is a
 * single line with the disc beside it: 1738 × 250, an aspect of 6.95:1. At the
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
