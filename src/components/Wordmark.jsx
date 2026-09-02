import React from 'react';
import { Link } from 'react-router-dom';

// A URL STRING, NOT AN IMPORT. The file lives in `public/`, which Vite copies
// verbatim and does not hash — so `/superluminal_logo.png` is its final URL in
// dev and in the build alike. An `import` of an absolute path happens to resolve
// through publicDir today, which is undocumented and not worth depending on.
// This works because `base` is '/' — see the note in vite.config.js.
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
// WHY IT IS A CROP AND NOT JUST AN <img>. The artwork is a stacked two-line
// wordmark sitting in the middle of a transparent 500×500 canvas: the ink
// occupies x 41→392, y 191→313, so the file is 75% empty space. Dropped into a
// 56px bar as a plain image it would either be a square box far taller than the
// bar, or — scaled to fit that height — a logotype rendered at a quarter of the
// available size. So the wrapper is the size of the INK and the image is scaled
// and offset inside it.
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
      className={'relative overflow-hidden flex-none block w-[var(--logo-w)] h-[calc(var(--logo-w)*0.349432)] ' + className}
      style={{ ['--logo-w']: `${width}px` }}
    >
      {/* `max-w-none` IS LOAD-BEARING AND IT IS THE WHOLE BUG THIS CROP HAD.
          Tailwind's preflight ships `img { max-width: 100% }`. The containing
          block here is the span, which is `--logo-w` wide — 104px in the nav —
          and the image is deliberately WIDER than that: 1.420455 × 104 =
          147.73px, because the crop works by scaling the whole 500px canvas up
          until the 352px of ink inside it measures exactly `--logo-w`. So
          preflight clamped 147.73px back down to 104px, the image rendered at
          70% of the size the offsets were computed for, and the window showed
          the wrong part of the canvas — which is what "the logo is not
          centred" actually was. Every one of the four constants was correct;
          the element they applied to had been silently resized under them.

          MEASURED, NOT DERIVED FROM THE OLD COMMENT. The ink's alpha bounding
          box in the 500×500 canvas is x 41→392 (352 wide) and y 191→313 (123
          tall), read off the file itself, and all four numbers below fall out of
          it: 500/352 for the scale, 123/352 for the box's aspect, and 41/352 and
          191/352 for the two offsets.

          `invert` MAKES IT WHITE, and it is a filter rather than a second asset
          because the artwork is pure #000000 on transparency — every ink pixel
          samples (0,0,0) — so inverting RGB gives exactly #FFFFFF and leaves the
          alpha channel alone. There is no halo to clean up and no white version
          of the file to keep in step with this one. Every surface that carries
          this mark is dark, so it is unconditional rather than a prop. */}
      <img
        src={LOGO}
        alt="Super Luminal"
        className="absolute block max-w-none invert w-[calc(var(--logo-w)*1.420455)] h-auto left-[calc(var(--logo-w)*-0.116477)] top-[calc(var(--logo-w)*-0.542614)]"
      />
    </span>
  );
}

export default function Wordmark({ where = null, to = '/', width = 88 }) {
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
