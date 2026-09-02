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
// currentColor for the RESTING states, so it inherits the row's — subtle by
// default, ink when the row is hovered, accent when the space is selected —
// without this file knowing any of those colours.
//
// AND THE ACCENT RAMP ON HOVER, which currentColor cannot carry. A gradient is
// not a colour: it is a paint server referenced by id, so it cannot arrive
// through a text utility the way every other state here does. Each icon
// therefore ships its own <linearGradient> and hands the reference to CSS as
// `--lp-chunk-ramp`; the swap itself is one rule in styles.css, keyed off the
// BUTTON's hover so the whole control lights rather than just the glyph.
//
// THE ID HAS TO BE UNIQUE PER ICON, because a list of spaces renders one of
// these per row and duplicate ids in a document are resolved to whichever came
// first. So the caller passes something distinguishing — the room id — and this
// sanitises it, rather than the component inventing a name that collides.
//
// SIZED IN PIXELS, NOT `em`, and that reversed an earlier decision. As a glyph
// beside the name it scaled with the name, which is right for something reading
// as punctuation in a line of text. It is not in the line any more: it sits
// beside the whole two-line item, centred on it, and its job is to be a small
// PICTURE of a decomposition. At 11px the three rectangles and the gaps between
// them were below the size the shape survives at.
// ---------------------------------------------------------------------------

/**
 * `ramp` is the accent's stops, as {at,color} — passed in rather than imported
 * so this stays a component that knows how to draw a decomposition and nothing
 * about where the brand lives. Omit it and the icon simply never lights.
 *
 * `uid` distinguishes this instance's gradient from every other one on screen.
 * Non-word characters go, because it lands in both an `id` and a `url(#…)`.
 */
export default function ChunkIcon({ title = 'Chunking', size = 19,
                                    uid = '', ramp = null }) {
  const gid = ramp ? `lp-chunk-${String(uid).replace(/[^A-Za-z0-9_-]/g, '') || 'x'}` : null;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden={!title}
         focusable="false" role={title ? 'img' : 'presentation'}
         className="lp-chunk"
         style={gid ? { '--lp-chunk-ramp': `url(#${gid})` } : undefined}>
      {title && <title>{title}</title>}
      {gid && (
        <defs>
          {/* ACROSS THE ICON, LEFT TO RIGHT. objectBoundingBox is safe here and
              worth stating: the trap that forces the plan's strips into user
              space needs a shape with zero width or height, and this box is
              square with three rectangles in it. */}
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
            {ramp.map((st) => (
              <stop key={st.at} offset={st.at} stopColor={st.color} />
            ))}
          </linearGradient>
        </defs>
      )}
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
