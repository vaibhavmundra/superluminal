import React from 'react';

// ---------------------------------------------------------------------------
// BoltIcon — the mark for "plan the electricals in this space".
//
// A SIBLING OF ChunkIcon, and it has to be: the two sit next to each other at
// the right-hand end of a row in the list of spaces, so they share a size, a
// stroke weight and `currentColor`, and neither one may out-shout the other.
// See ChunkIcon.jsx for why a drawing rather than a word.
//
// FILLED, WHERE THE CHUNKING MARK IS STROKED. That is the one deliberate
// difference. A bolt outlined at 19px reads as a squiggle — the shape is a
// single narrow zigzag and the two strokes either side of it sit close enough
// to close up. Filled, it is unmistakable at a glance, which is the whole job
// of an icon in a list.
//
// AND IT IS A BOLT AND NOT A SWITCH PLATE, even though a plate is what gets
// drawn. A rectangle at this size is a rectangle; the bolt is the sign every
// drawing already uses for "this is the electrical layer".
// ---------------------------------------------------------------------------

export default function BoltIcon({ title = 'Electricals', size = 19 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden={!title}
         focusable="false" role={title ? 'img' : 'presentation'}>
      {title && <title>{title}</title>}
      <path fill="currentColor"
        d="M13.4 2.2 5.2 13.1a.7.7 0 0 0 .56 1.12h4.3l-1.2 7.4a.36.36 0 0 0 .64.27l8.3-11a.7.7 0 0 0-.56-1.12h-4.3l1.2-7.3a.36.36 0 0 0-.64-.27Z" />
    </svg>
  );
}
