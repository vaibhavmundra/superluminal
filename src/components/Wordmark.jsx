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
    <span className={'logo ' + className} style={{ ['--logo-w']: `${width}px` }}>
      <img src={LOGO} alt="Super Luminal" />
    </span>
  );
}

export default function Wordmark({ where = null, to = '/', width = 104 }) {
  return (
    <div className="brand">
      <Link to={to} className="brand-link" aria-label="Super Luminal">
        <Logo width={width} />
      </Link>
      {where && <>
        <span className="sep" aria-hidden="true" />
        <span className="where">{where}</span>
      </>}
    </div>
  );
}
