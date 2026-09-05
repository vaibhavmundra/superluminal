import { useCallback, useEffect, useState } from 'react';
import { SHAPE_TOOLS, POLY_SIDES } from '../lib/ceilingShapes.js';

// ---------------------------------------------------------------------------
// ShapeMenu — the floating white bar the cove shapes are drawn from.
//
// ON THE DRAWING AND NOT IN THE PANEL, and that is the whole of why it exists
// as its own thing. Every other palette in this app is a row in the right-hand
// column, because every other palette ARMS something and then gets out of the
// way: pick a fan, click the ceiling, done. This one has to stay in front of
// you for the length of a gesture that can take six clicks, and it changes what
// it is offering three times while that gesture runs — which shape, how many
// sides, keep it or throw it away. A control that talks back mid-gesture has to
// be where the gesture is happening.
//
// THE SAME BAR IN THREE STATES, NOT THREE BARS. It moves and resizes as little
// as it can between them: same height, same pill, same ground, so the eye keeps
// hold of it while the buttons underneath change. A menu that vanished and
// reappeared somewhere else at the moment you started dragging would read as
// having been dismissed.
//
//   pick     which shape. Six marks, drawn as marks.
//   sides    only for the polygon, and only until a number is chosen.
//   draw     the shape is being spanned: keep it, or throw it away.
//   edit     one on the sheet is selected: its corner radius, and the two
//            things that can be done to it.
//
// WHITE, WHICH IS THE ONE THING ON THIS SCREEN THAT IS. The panel is glass on a
// dark page and the sheet is either white paper or an inverted black plan — so
// a floating control has to be legible on both, and opaque white with a
// hairline and a shadow is what the pill on the drawing already uses. It is the
// same object, one size up.
//
// FIXED AND MEASURED, exactly as OptionCoach is, and for the same two reasons:
// the stage is a scroll container, so an absolutely positioned child scrolls
// away with the drawing; and this must not be inside the <svg>, where the zoom
// would scale it.
// ---------------------------------------------------------------------------

/** Its clearance from the foot of the stage. */
const BOTTOM = 26;

/**
 * THE MARKS. Black outline, white fill, 20 units square — the shapes drawn as
 * the shapes they place, which is the same argument CeilingPalette makes for
 * its artwork: the symbol IS the name, so choosing is recognition rather than
 * reading.
 *
 * DRAWN HERE AS SVG RATHER THAN SHIPPED AS ARTWORK, which is the opposite of
 * what the two ceiling palettes do. Those place PHOTOGRAPHABLE OBJECTS — a fan,
 * a cassette, a geyser — and a picture of one reads at button size where a line
 * symbol does not. These are not objects; they are five primitives, and a
 * circle is already the clearest possible picture of a circle.
 */
const MARK = {
  rect:     <rect x="2.5" y="5" width="15" height="10" rx="0.8" />,
  square:   <rect x="4" y="4" width="12" height="12" rx="0.8" />,
  circle:   <circle cx="10" cy="10" r="6.6" />,
  triangle: <polygon points="10,3.2 16.6,15.2 3.4,15.2" />,
  polygon:  <polygon points="10,3.4 15.7,6.7 15.7,13.3 10,16.6 4.3,13.3 4.3,6.7" />,
};

const Mark = ({ id }) => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"
    fill="#fff" stroke="#111" strokeWidth="1.3" strokeLinejoin="round">
    {id === 'pen'
      /* THE ONE THAT IS A TOOL AND NOT A SHAPE, so it is drawn as the tool:
         a nib, and the open path it leaves behind. A closed outline here would
         say the pen places a fixed shape, which is the one thing it does not. */
      ? (<>
          <path d="M3.2 16.8 L6.6 8.4 L11.4 13.2 Z" />
          <path d="M6.6 8.4 L13.4 3.4 L16.4 6.4 L11.4 13.2" />
        </>)
      : MARK[id]}
  </svg>
);

const Glyph = ({ d }) => (
  <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"
    fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const TICK = 'M4 10.6 L8.2 14.6 L16 5.6';
const CROSS = 'M5 5 L15 15 M15 5 L5 15';

const BTN = 'flex items-center justify-center w-9 h-9 rounded-[7px] '
  + 'border-0 bg-transparent cursor-pointer p-0 '
  + 'transition-colors duration-[120ms] hover:bg-black/[0.07] '
  + 'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-black/40';
const BTN_ON = 'bg-black/[0.09] hover:bg-black/[0.12]';
const SEP = <span className="w-px h-5 bg-black/10 mx-0.5" aria-hidden="true" />;
const CAP = 'text-[10.5px] leading-none tracking-[0.02em] text-black/55 px-1.5 select-none';

/**
 * WHERE THE BAR SITS. Centred over the stage, near its foot — the position
 * every drawing tool in every editor has trained people to look at, and the one
 * place on this screen that is neither the sheet's middle nor the panel.
 *
 * `null` while the stage has not been measured, which is one frame on mount.
 */
function useStageRect(stage) {
  const [box, setBox] = useState(null);
  const measure = useCallback(() => {
    const el = stage?.current;
    setBox(el ? el.getBoundingClientRect() : null);
  }, [stage]);
  useEffect(() => {
    measure();
    const el = stage?.current;
    window.addEventListener('resize', measure);
    el?.addEventListener('scroll', measure);
    // The stage changes width when the panel does, and neither of the two
    // listeners above fires for that.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (el && ro) ro.observe(el);
    return () => {
      window.removeEventListener('resize', measure);
      el?.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
  }, [measure, stage]);
  return box;
}

/**
 * `mode` is which of the four states the bar is in, and the caller owns it —
 * this component decides nothing. It is a row of buttons that reports presses.
 *
 *   tool        the armed shape id, so its button reads as latched
 *   sides       the polygon's current side count
 *   radius      { ft, max } for the selected shape, or null where a shape has
 *               no corners to round (a circle)
 */
export default function ShapeMenu({
  stage, mode, tool = null, sides = POLY_SIDES.initial, radius = null, sizeLabel = null,
  canCommit = true,
  onTool, onSides, onCommit, onCancel, onRadius, onDuplicate, onDelete,
}) {
  const box = useStageRect(stage);
  if (!box) return null;

  return (
    <div
      className="fixed z-30 flex items-center gap-0.5 rounded-[11px] bg-white
        border border-black/[0.10] shadow-[0_6px_24px_rgba(0,0,0,0.22)] px-1.5 py-1.5"
      style={{ left: (box.left + box.right) / 2, bottom: Math.max(12, window.innerHeight - box.bottom + BOTTOM),
               transform: 'translateX(-50%)' }}
      /* THE BAR MUST NOT START A GESTURE ON THE PLAN. The stage's own pointer
         handlers are on the SVG, so a press here never reaches them — but the
         canvas-wide click that clears the selection is on the document, and a
         press that both pressed a button and deselected the shape the button
         acts on is a press with two meanings. */
      onPointerDown={(e) => e.stopPropagation()}>

      {mode === 'pick' && SHAPE_TOOLS.map((t) => (
        <button key={t.id} type="button" title={t.label}
          className={BTN + (tool === t.id ? ' ' + BTN_ON : '')}
          onClick={() => onTool?.(t.id)}>
          <Mark id={t.id} />
        </button>
      ))}

      {mode === 'sides' && (<>
        <span className={CAP}>Sides</span>
        {/* EVERY COUNT AS ITS OWN BUTTON, not a stepper. Ten numbers is a short
            row, and a stepper would make "I want an octagon" four presses with
            a look at a readout between each one. */}
        {Array.from({ length: POLY_SIDES.max - POLY_SIDES.min + 1 },
          (_, i) => POLY_SIDES.min + i).map((n) => (
          <button key={n} type="button"
            className={'flex items-center justify-center w-7 h-9 rounded-[7px] border-0 '
              + 'bg-transparent cursor-pointer p-0 text-[12px] text-black/80 '
              + 'transition-colors duration-[120ms] hover:bg-black/[0.07] '
              + (sides === n ? BTN_ON : '')}
            onClick={() => onSides?.(n)}>{n}</button>
        ))}
        {SEP}
        <button type="button" title="Back" className={BTN} onClick={onCancel}>
          <Glyph d={CROSS} />
        </button>
      </>)}

      {mode === 'draw' && (<>
        {/* WHAT IS BEING DRAWN, IN WORDS, because in this state the buttons are
            a tick and a cross and neither says what it is agreeing to. */}
        {sizeLabel && <span className={CAP}>{sizeLabel}</span>}
        {/* GREYED UNTIL THERE IS SOMETHING TO KEEP. Two clicks of the pen is
            a line, not a shape — and a tick that silently does nothing is worse
            than one that visibly cannot yet. */}
        <button type="button" title="Keep this shape" className={BTN} disabled={!canCommit}
          style={{ color: '#0a7d3c', opacity: canCommit ? 1 : 0.35,
                   cursor: canCommit ? 'pointer' : 'not-allowed' }}
          onClick={onCommit}>
          <Glyph d={TICK} />
        </button>
        <button type="button" title="Throw it away" className={BTN}
          style={{ color: '#b3261e' }} onClick={onCancel}>
          <Glyph d={CROSS} />
        </button>
      </>)}

      {mode === 'edit' && (<>
        {sizeLabel && <span className={CAP}>{sizeLabel}</span>}
        {/* THE CORNER RADIUS, AND IT IS A SLIDER BECAUSE IT IS A FEEL.
            Nobody knows they want an 18-inch corner; they know they want it
            rounder than it is, and they find out by watching the tape move. */}
        {radius && (<>
          {SEP}
          <span className={CAP}>Corner</span>
          <input type="range" min="0" max={radius.max} step={radius.max / 100 || 0.01}
            value={Math.min(radius.ft, radius.max)}
            className="w-[92px] mx-1 accent-black cursor-pointer"
            onChange={(e) => onRadius?.(Number(e.target.value))} />
          <span className={CAP + ' tabular-nums w-[42px] text-right'}>
            {radius.ft.toFixed(1)} ft
          </span>
        </>)}
        {SEP}
        <button type="button" title="Duplicate" className={BTN} onClick={onDuplicate}>
          <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"
            fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
            <rect x="2.8" y="2.8" width="10" height="10" rx="1.4" />
            <rect x="7.2" y="7.2" width="10" height="10" rx="1.4" fill="#fff" />
          </svg>
        </button>
        <button type="button" title="Delete" className={BTN}
          style={{ color: '#b3261e' }} onClick={onDelete}>
          <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"
            fill="none" stroke="currentColor" strokeWidth="1.7"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.6 5.6h12.8M8 5.6V3.8h4v1.8M5.4 5.6l.8 10.6h7.6l.8-10.6" />
          </svg>
        </button>
      </>)}
    </div>
  );
}
