import React from 'react';

// ---------------------------------------------------------------------------
// ChunkIcon — the mark for "this space is cut into more than one piece".
//
// WHY A DRAWING AND NOT THE WORD. It sits at the right-hand end of a row in a
// list of spaces, beside a name, two dimensions and an area. The row is already
// four pieces of text wide, and a fifth reading "chunking" competes with the
// name for the eye while saying less than the picture does: the whole point of
// a chunking is its SHAPE, and the shape is what the icon is.
//
// The figure is a decomposition — a large piece, a wide piece under it, a tall
// piece beside them. Three unequal rectangles with a gap between, which is what
// a chunked room looks like on this canvas and what the picker shows in full
// when it opens.
//
// currentColor throughout, so it inherits the row's state — subtle by default,
// ink on hover, accent when the space is selected — without this file knowing
// any of those colours.
//
// SIZED IN PIXELS, NOT `em`, and that reversed an earlier decision. As a glyph
// beside the name it scaled with the name, which is right for something reading
// as punctuation in a line of text. It is not in the line any more: it sits
// beside the whole two-line item, centred on it, and its job is to be a small
// PICTURE of a decomposition. At 11px the three rectangles and the gaps between
// them were below the size the shape survives at.
// ---------------------------------------------------------------------------

export default function ChunkIcon({ title = 'Chunking', size = 19 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden={!title}
         focusable="false" role={title ? 'img' : 'presentation'}>
      {title && <title>{title}</title>}
      {/* Stroked and not filled: filled at this size it reads as three solid
          blocks and the gaps disappear, and the gaps are the information. */}
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <rect x="2.6" y="2.6" width="11.6" height="11.6" />
        <rect x="2.6" y="16.4" width="11.6" height="5" />
        <rect x="16.4" y="2.6" width="5" height="18.8" />
      </g>
    </svg>
  );
}
