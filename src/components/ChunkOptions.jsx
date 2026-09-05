import React from 'react';

// ---------------------------------------------------------------------------
// ChunkOptions — every way this space could be cut up, as pictures, in the row
// for that space.
//
// THE CHOICE ALREADY HAD A SCREEN AND IT IS STILL THERE. ChunkPicker takes the
// whole window, draws each reading over the plan at full size and prints what
// each one costs — pieces, cells, square feet lost, how many fans it holds
// clear. That is the screen for DECIDING, and nothing here replaces it.
//
// WHAT THIS IS FOR IS THE OTHER HALF: knowing there was a choice, seeing which
// one is in use, and changing your mind without leaving the panel. That was a
// single icon button in the row's header — one glyph, no indication of how many
// readings there were or which was live, and a full-screen step behind it. Four
// clicks to answer "is this space in bays or in courses?", and the answer was
// never visible while looking at the list.
//
// SO THE OPTIONS ARE DRAWN, SMALL, IN ROWS OF THREE. A chunking is a shape —
// two bays across, three courses down, an L split at the corner — and a shape
// is recognised in a thumbnail far faster than it is read from a name. At this
// size the picture carries the count too: you can see there are three pieces
// without being told.
//
// NOT THE ACCENT GRADIENT FOR THE SELECTED ONE. The accent on this app means
// "this is ours and it emits light" — it is the fittings' own hue, on the
// drawing and in the palettes that place them — and a chunking emits nothing.
// It is a reading of the room's SHAPE. So the live one is marked the way this
// panel marks everything structural: white, which is the strongest thing a dark
// glass panel can say, and said twice — a white rim on the cell AND white ink
// in the drawing, where the others sit in the subtle grey the panel uses for
// anything at rest. One cue is a state; two is unmistakable at 90 pixels.
// ---------------------------------------------------------------------------

/** How tall one glyph is. Small enough for three across a 340px panel with room
 *  for a name under each, big enough that a three-piece cut reads as three. */
const H = 52;

/**
 * ONE READING, DRAWN AT THUMBNAIL SIZE.
 *
 * IN THE ROOM'S OWN FEET, with no conversion at all — the outline and the
 * chunks are both already in that space, and the viewBox is the room's bounding
 * box. Converting to plan pixels first (which is what ChunkPicker does, because
 * it draws over the plan image) would mean carrying a `toPx` in here to undo it
 * with a viewBox immediately afterwards.
 *
 * NO PLAN UNDERNEATH, WHICH IS THE ONE THING THIS DROPS from the full cards. At
 * 90 pixels a floor plan at 16% opacity is grey noise behind the only marks
 * that matter. The outline is the room; the rectangles are the reading.
 *
 * THE OMITTED PIECES ARE DRAWN AND NOT COUNTED IN WORDS. A chunking that gives
 * up a sliver of ceiling shows it as a gap in the outline that no rectangle
 * covers, which is exactly what it is — see `lostArea` on the full card for the
 * number.
 */
function Glyph({ option, polygonFt, holesFt, on }) {
  const xs = polygonFt.map((p) => p.x), ys = polygonFt.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const pad = span * 0.06;
  // The line weight is in the room's feet, so a big room and a small one get
  // the same weight of line on screen rather than the same number of feet of it.
  const lw = span / 90;
  const ink = on ? '#FFFFFF' : '#7A7A7A';

  return (
    <svg width="100%" height={H} preserveAspectRatio="xMidYMid meet"
      viewBox={`${minX - pad} ${minY - pad} ${(maxX - minX) + pad * 2} ${(maxY - minY) + pad * 2}`}
      aria-hidden="true">
      {/* The pieces first, so the outline draws over their edges and the room
          reads as one shape with cuts in it rather than as a pile of boxes. */}
      {option.chunks.map((c, k) => (
        <rect key={k} x={c.x0} y={c.y0} width={c.x1 - c.x0} height={c.y1 - c.y0}
          fill={ink} fillOpacity={on ? 0.16 : 0.09}
          stroke={ink} strokeWidth={lw * 1.6} strokeOpacity={on ? 0.9 : 0.55} />
      ))}
      {/* THE HOLES THE READINGS HAD TO WORK AROUND — a drawn cove, an enclosed
          WC, a reverse cove, a boxed-out shaft. Without them a piece of ceiling
          no rectangle covers reads as area the reading GAVE UP, which is a real
          thing a chunking can do and the opposite of what these are: a hole is
          ceiling that was never on offer. Dotted, because a dotted line is how
          the rest of this app says "this is somebody else's". */}
      {holesFt.map((h, k) => (
        <rect key={'h' + k} x={h.x0} y={h.y0} width={h.x1 - h.x0} height={h.y1 - h.y0}
          fill="none" stroke={ink} strokeWidth={lw * 1.4}
          strokeDasharray={`${lw * 2} ${lw * 2.5}`} strokeLinecap="round"
          opacity={on ? 0.8 : 0.5} />
      ))}
      <polygon points={polygonFt.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="none" stroke={ink} strokeWidth={lw * 2.2}
        strokeLinejoin="round" opacity={on ? 1 : 0.7} />
    </svg>
  );
}

/**
 * `chosenId` is what the layout actually ran on, which is not always what was
 * asked for: a reading somebody picked can stop existing when the sliders move,
 * and the room falls back to the recommendation. Marking the REQUESTED one
 * would then light a cell that no chunk on the drawing came from. See
 * `chosenBy` on the room.
 */
export default function ChunkOptions({ options = [], polygonFt = [], holesFt = [],
                                       chosenId, onPick, disabled = false }) {
  if (options.length < 2 || polygonFt.length < 3) return null;
  return (
    <div className="grid grid-cols-3 gap-[5px]">
      {options.map((o) => {
        const on = o.id === chosenId;
        return (
          <button key={o.id} type="button" disabled={disabled}
            aria-pressed={on} title={o.label}
            className={
              'flex flex-col items-center gap-[5px] pt-[7px] px-[3px] pb-[6px] '
              + 'rounded-[8px] cursor-pointer transition-colors duration-[120ms] '
              + 'disabled:opacity-[.45] disabled:cursor-not-allowed border '
              /* A WHITE RIM AND NOT A GRADIENT ONE. The gradient ring is the
                 accent's own mark and belongs to the things that emit light —
                 see the head of this file. A 1px border either way, so the cell
                 does not change size when it becomes the live one and nothing
                 in the grid shifts under the cursor. */
              + (on
                ? 'border-white bg-input-bg'
                : 'border-border/10 bg-surface backdrop-blur-md enabled:hover:bg-input-bg enabled:hover:border-border/30')}
            onClick={(e) => {
              // The row this sits in selects the space when clicked. Choosing a
              // reading is a different act on a space that is already open.
              e.stopPropagation();
              onPick?.(o.id);
            }}>
            <Glyph option={o} polygonFt={polygonFt} holesFt={holesFt} on={on} />
            {/* THE NAME UNDER THE PICTURE, and it wraps rather than truncating.
                "Vertical bays" and "Courses along the length" are the whole of
                what separates two glyphs that can look alike on a square room,
                and half a name is worse than a name on two lines. */}
            <span className={'text-[9.5px] leading-[1.15] text-center tracking-[0.01em] '
              + (on ? 'text-white' : 'text-subtle')}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
