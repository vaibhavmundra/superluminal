import { useEffect, useState } from 'react';
import { SHAPE_TOOLS, SHAPE_BY_ID, POLY_SIDES } from '../lib/ceilingShapes.js';
import StageBar from './StageBar.jsx';

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
//
// ...AND THE PILL ITSELF IS StageBar's NOW. The white ground, the measuring, the
// centring and the pointer guard were written here and copied into CobSpec, and
// there is a third caller: the two scene buttons are on this bar whatever else
// is in it, and a plan with no gesture running still has a bar. `tail` is where
// they go — see StageBar, and the note on `tail` below.
// ---------------------------------------------------------------------------

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

/**
 * THE MARK, AND IT INVERTS WHEN ITS BUTTON IS THE LIVE ONE.
 *
 * The selected cell is a black chip on a white bar — see `BTN_ON` — and a mark
 * drawn in near-black ink would disappear into it. So the two colours swap: a
 * white outline on the chip, the same shape either way. It is the same rule
 * PaletteButton follows for its caption, said about a symbol.
 */
const Mark = ({ id, on = false }) => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"
    fill={on ? '#111' : '#fff'} stroke={on ? '#fff' : '#111'}
    strokeWidth="1.3" strokeLinejoin="round">
    {id === 'pen'
      /* THE ONE THAT IS A TOOL AND NOT A SHAPE, so it is drawn as the tool:
         a nib, and the open path it leaves behind. A closed outline here would
         say the pen places a fixed shape, which is the one thing it does not. */
      ? (<>
          <path d="M3.2 16.8 L6.6 8.4 L11.4 13.2 Z" />
          <path d="M6.6 8.4 L13.4 3.4 L16.4 6.4 L11.4 13.2" />
        </>)
      : id === 'line'
        /* A LINE, AND NOTHING ELSE ON THE BUTTON. It carried two faint uprights
           for the walls its ends land on — true about the tool, and at 20px it
           read as a symbol nobody could name: three marks where every other cell
           has one. The rule the row is built on is that the symbol IS the name,
           and the plainest possible picture of "line" is a line. What its ends
           have to touch is the panel's job to say, where there is room for a
           drawing of the room — see SHAPE_GESTURE.
           DIAGONAL AND NOT HORIZONTAL: a horizontal rule in a row of buttons
           reads as a separator. */
        ? <path d="M3.8 16.2 L16.2 3.8" fill="none" strokeWidth="1.9"
            strokeLinecap="round" />
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

/* --- THE SHELL CARRIES NO BACKGROUND, AND THAT IS A BUG FIX ----------------
   IT USED TO CARRY `bg-transparent`, and the armed cell added `bg-black` on top
   of it. Both are single-class utilities of identical specificity, so which one
   wins is decided by the ORDER THEY ARE EMITTED IN THE STYLESHEET and not by
   the order they appear in the class attribute — and Tailwind emits
   `.bg-transparent` after `.bg-black`. The armed chip was therefore never black.
   Worse than not-black: `Mark` inverts its stroke to WHITE when armed, so the
   tool you had just picked turned white on a white bar and vanished. Picking a
   primitive looked like picking nothing.
   SO EXACTLY ONE BACKGROUND CLASS IS EVER APPLIED. The shell has none and the
   state supplies it, which is a rule that cannot be lost to emission order
   however the palette is reordered later. The same trap is one concatenation
   away anywhere `A + (cond ? B : '')` puts two utilities of one property on one
   element; the fix is always this — make them alternatives, not layers. */
const BTN_SHELL = 'flex items-center justify-center w-9 h-9 rounded-[7px] '
  + 'border-0 cursor-pointer p-0 transition-colors duration-[120ms] '
  + 'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-black/40';
const BTN_OFF = 'bg-transparent hover:bg-black/[0.07]';
/* WHICH ONE IS ARMED, AND IT IS A FILLED CHIP RATHER THAN A TINT. It was
   `bg-black/[0.09]` — nine percent of black on a white bar, which is a shade you
   have to go looking for, on the one control in this bar whose whole job is to
   say what the next press on the drawing will do. The mark inverts with it (see
   `Mark`), so the pair reads as one latched key. */
const BTN_ON = 'bg-black hover:bg-black';
const BTN = `${BTN_SHELL} ${BTN_OFF}`;
/* THE SAME LATCH ON A BUTTON WHOSE CONTENT IS TEXT. The sides row prints a
   number, and a number in `text-black/80` on a black chip is a number nobody can
   read — so it takes the inversion the marks take. */
/* `flex-none whitespace-nowrap` FOR THE SAME REASON CobSpec's CHIP CARRIES IT,
   and this bar has the very same three labels in it — Inside / On the line /
   Outside, which is where it showed. StageBar is `flex-nowrap`, which stops the
   BAR wrapping and does nothing about a button: a flex child still shrinks below
   its content, and a shrunk button breaks its own label across two lines, which
   makes that one control a different height from every other cell on the bar.
   The digits do not need it and are not harmed by it; one rule for every button
   here is one fewer thing to get wrong when a longer word arrives. */
const NUM_SHELL = 'flex flex-none whitespace-nowrap items-center justify-center '
  + 'w-7 h-9 rounded-[7px] border-0 '
  + 'cursor-pointer p-0 text-[12px] transition-colors duration-[120ms]';
const NUM_OFF = 'bg-transparent hover:bg-black/[0.07] text-black/80';
const NUM_ON = 'bg-black hover:bg-black text-white';
const SEP = <span className="w-px h-5 bg-black/10 mx-0.5" aria-hidden="true" />;
const CAP = 'text-[10.5px] leading-none tracking-[0.02em] text-black/55 px-1.5 select-none';

/* --- THE CORNER RADIUS, IN MILLIMETRES, IN A BOX --------------------------
   IT WAS A SLIDER AND THIS BAR CANNOT AFFORD ONE. Ninety-two pixels of track,
   a caption and a readout is a third of the reading column's width spent on the
   least-used control in the bar — and the bar now has to hold the run's wattage
   as well, which is the thing somebody actually came to it for. A box is sixty.

   MILLIMETRES BECAUSE THAT IS WHAT THE DETAIL IS BUILT IN. A cove's corner is
   set out by a carpenter working in mm; "0.4 ft" is a figure nobody can cut to,
   and it was the slider's unit only because the shape's own geometry is in feet.
   The conversion is this file's — the document keeps feet, as everything on this
   canvas does. See `radiusFt`.

   AND IT STILL WRITES ONCE PER GESTURE, which is the rule the slider existed to
   obey: changing the stored shape re-chunks every room, replans its fittings,
   rebuilds the heatmap and queues the plan for saving, so a write per keystroke
   is a whole-plan rebuild per digit. The draft is local while typing and lands
   on Enter or on blur. */
const MM_PER_FT = 304.8;

function RadiusControl({ radius, onCommit }) {
  const limitMm = Math.round(Math.max(0, Number(radius.max) || 0) * MM_PER_FT);
  const fromMm = Math.min(limitMm,
    Math.round(Math.max(0, Number(radius.ft) || 0) * MM_PER_FT));
  const [draft, setDraft] = useState(fromMm);

  /* THE STORED FIGURE WHENEVER IT CHANGES UNDER US — an undo, a plan reloaded,
     or the selection moving to another shape (hence `radius.id`). */
  useEffect(() => { setDraft(fromMm); }, [radius.id, fromMm]);

  const commit = (raw) => {
    const mm = Math.max(0, Math.min(limitMm, Math.round(Number(raw) || 0)));
    setDraft(mm);
    const ft = +(mm / MM_PER_FT).toFixed(6);
    if (Math.abs(ft - (Number(radius.ft) || 0)) > 1e-6) onCommit?.(ft);
  };

  return (<>
    <input type="number" min="0" max={limitMm} step="5" value={draft}
      aria-label="Corner radius in millimetres"
      className="w-[56px] ml-1 px-1.5 py-[3px] text-[11.5px] tabular-nums
        rounded-[6px] border border-black/12 bg-transparent text-black
        focus-visible:outline-2 focus-visible:outline-offset-[-2px]
        focus-visible:outline-black/40"
      onChange={(e) => setDraft(e.target.value === '' ? '' : Number(e.target.value))}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(e.currentTarget.value); }}
      onBlur={(e) => commit(e.currentTarget.value)} />
    <span className={CAP}>mm</span>
  </>);
}

/**
 * `mode` is which of the four states the bar is in, and the caller owns it —
 * this component decides nothing. It is a row of buttons that reports presses.
 *
 *   tool        the armed shape id, so its button reads as latched
 *   sides       the polygon's current side count
 *   radius      { id, ft, max } for the selected shape, or null where a shape
 *               has no corners to round (a circle)
 */
export default function ShapeMenu({
  stage, mode, tool = null, sides = POLY_SIDES.initial, radius = null, sizeLabel = null,
  canCommit = true, showDrawActions = true,
  /* --- THE OFFSET, AND ONLY FOR A DRAFT BORROWED FROM A GEOMETRY -----------
     `{ sideId, ft, sides, maxFt }` OR NULL, and null is the ordinary case. A
     shape dragged out with a primitive has no source to be offset FROM — the
     drag IS the position — so the control appears for exactly one thing: an
     outline taken off a geometry already on the drawing, which is how a
     magnetic track gets set out a foot inside the guide that positioned it.
     THE CHIPS ARE THE ARRAY'S OWN THREE, in the array's own words (see
     ARRAY_SIDES in lib/cob.js). Inside, on the line, outside is the same
     question asked of the same kind of object, and inventing a second
     vocabulary for it — "inset/offset", a signed number — would be two ways to
     say one thing in two bars on the same drawing. */
  offset = null,
  /* THE TWO SCENE BUTTONS, PASSED IN AND DRAWN AT THE FAR END. They belong to
     neither this bar nor any other — they say which DRAWING you are looking at —
     and they are on whichever contextual bar happens to be up so that there is
     never a second pill beside this one saying it. The caller owns them because
     the caller is the only thing that knows what scenes there are. */
  tail = null,
  /* ...AND THE VIEW SWITCHES AT THE NEAR END, on the same terms: whatever this
     bar is currently doing, `lead` is there. See StageBar's three slots. */
  lead = null,
  /* WHICH END OF THE BOX IT STANDS AT, HANDED STRAIGHT THROUGH. Every bar on
     this canvas takes it and they all take the same value — see `barPlace` in
     App: the foot of the drawing on the open canvas, the head of it in the
     vertical column, where the slot is shared with the light window. */
  placement = 'bottom',
  /* --- WHAT THE SELECTED RUN DRAWS, AND IT IS THE LIGHTING DOMAIN'S --------
     `{ watts, options, unit }` OR NULL, from the space analysis row for this
     shape — see `selShapeRow` in App. It is on a GEOMETRY bar because a cove is
     the one object on this canvas whose geometry and whose specification are the
     same press: you draw a line and a run of tape appears on it, and the only
     thing left to decide is how much light per metre. The bar showed the
     shape's DIMENSIONS in that slot, which is a figure you can read off the
     drawing and cannot act on.
     NULL WHERE THE ROOM HAS NOTHING TO SAY — a guide, a shape the layout has
     not taken up yet, a run with one wattage in its family. Then the slot is
     simply not drawn; a single latched chip is a control that cannot do
     anything. */
  wattage = null,
  onWatts = null,
  onTool, onSides, onCommit, onCancel, onRadius, onDuplicate, onDelete,
  onOffsetSide, onOffsetFt,
}) {
  return (
    <StageBar stage={stage} lead={lead} tail={tail} placement={placement}
      label="Ceiling shapes">

      {mode === 'pick' && SHAPE_TOOLS.map((t) => (
        <button key={t.id} type="button" title={t.label} aria-pressed={tool === t.id}
          className={`${BTN_SHELL} ${tool === t.id ? BTN_ON : BTN_OFF}`}
          onClick={() => onTool?.(t.id)}>
          <Mark id={t.id} on={tool === t.id} />
        </button>
      ))}
      {/* WHICH ONE IS ARMED, IN WORDS. The latched chip says it too, and the
          chip alone was not enough: six marks at 20px are told apart by somebody
          who already knows what they are looking at, and the one moment you need
          to be sure is just after picking — when the next press is going to draw
          something. The name costs a few characters at the end of a bar that has
          room for them, and it removes the doubt outright.
          ONLY WITH SOMETHING ARMED, so the bar does not carry a permanent
          caption for a state it is usually not in. */}
      {mode === 'pick' && tool && (<>
        {SEP}
        <span className={CAP}>{SHAPE_BY_ID[tool]?.label ?? tool}</span>
      </>)}

      {mode === 'sides' && (<>
        <span className={CAP}>Sides</span>
        {/* EVERY COUNT AS ITS OWN BUTTON, not a stepper. Ten numbers is a short
            row, and a stepper would make "I want an octagon" four presses with
            a look at a readout between each one. */}
        {Array.from({ length: POLY_SIDES.max - POLY_SIDES.min + 1 },
          (_, i) => POLY_SIDES.min + i).map((n) => (
          <button key={n} type="button" aria-pressed={sides === n}
            className={`${NUM_SHELL} ${sides === n ? NUM_ON : NUM_OFF}`}
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
        {/* --- HOW FAR OFF THE BORROWED GEOMETRY IT SITS ------------------
            AHEAD OF THE TICK, because it is the question that comes first: the
            size printed to the left of it MOVES as this changes, so a control
            after the confirm button would be one you found only by pressing the
            wrong thing.
            NO CAPTION ON THE CHIPS. They read "Inside / On the line / Outside",
            which is the label — and a word in front of them would be labelling
            three words. The distance takes `ft` because a bare number in a bar
            of buttons is ambiguous about its unit. */}
        {offset && (<>
          {SEP}
          {offset.sides.map((sd) => (
            <button key={sd.id} type="button" aria-pressed={offset.sideId === sd.id}
              className={`${NUM_SHELL} w-auto px-2 `
                + (offset.sideId === sd.id ? NUM_ON : NUM_OFF)}
              onClick={() => onOffsetSide?.(sd.id)}>{sd.label}</button>
          ))}
          {offset.sideId !== 'on' && (<>
            <input type="number" min="0" step="0.25"
              max={offset.maxFt > 0 ? offset.maxFt.toFixed(2) : undefined}
              value={offset.ft} aria-label="Offset in feet"
              className="w-[58px] ml-1.5 px-1.5 py-[3px] text-[11.5px] tabular-nums
                rounded-[6px] border border-black/12 bg-transparent text-black
                focus-visible:outline-2 focus-visible:outline-offset-[-2px]
                focus-visible:outline-black/40"
              onChange={(e) => onOffsetFt?.(Number(e.target.value))} />
            <span className={CAP}>ft</span>
          </>)}
          {SEP}
        </>)}
        {/* COVES ARE CONFIRMED BY THE PANEL'S DONE BUTTON. Guides and magnetic
            tracks have no dedicated panel step, so they keep the bar's own
            confirmation controls. */}
        {showDrawActions && (<>
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
      </>)}

      {mode === 'edit' && (<>
        {/* --- WHAT IT DRAWS, WHERE ITS SIZE USED TO BE -------------------
            THE DIMENSIONS WERE THE WRONG THING IN THE ONLY SLOT THIS BAR HAS.
            "10.6 x 7.4 ft" is a reading of the shape on the drawing — true, and
            nothing you can do anything about from here — while the run's
            wattage was reachable only by going to the analysis list and finding
            its row. A contextual menu is for the acts available on the thing
            under it. The size is still printed while the shape is being DRAWN,
            which is the moment it is a decision rather than a fact. */}
        {wattage && wattage.options.length > 1 && (<>
          <span className={CAP}>Wattage</span>
          {wattage.options.map((w) => (
            <button key={w} type="button" aria-pressed={wattage.watts === w}
              className={`${NUM_SHELL} w-auto px-2 `
                + (wattage.watts === w ? NUM_ON : NUM_OFF)}
              onClick={() => onWatts?.(w)}>
              {w}W{wattage.unit === 'm' ? '/m' : ''}
            </button>
          ))}
          {SEP}
        </>)}
        {/* THE CORNER RADIUS, IN MILLIMETRES AND IN A BOX — see RadiusControl
            for why it stopped being a slider. */}
        {radius && (<>
          <span className={CAP}>Corner</span>
          <RadiusControl radius={radius} onCommit={onRadius} />
          {SEP}
        </>)}
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
    </StageBar>
  );
}

/* ---------------------------------------------------------------------------
   THE GESTURE, DRAWN — for the panel, while a cove is being set out.

   THE SAME IDIOM `GESTURE` IN LightPalette USES, and it is exported for the same
   reason: the bar on the drawing and the card in the panel must describe ONE
   gesture, and two drawings of it would drift the first time either was
   retouched.

   ONLY THE TWO OPEN COVES GET ONE, and that is the point rather than an
   omission. Dragging out a rectangle is a marquee — every app has one, and a
   picture of it would be a manual. What nobody can guess is that a LINE has to
   land on a wall at both ends, and that a pen path can be finished without
   closing it. A hint card is worth its space where the gesture is hard to
   imagine or its result lands somewhere surprising.
   --------------------------------------------------------------------------- */

/** The room, as the faint box both pictures are drawn inside. */
const Room = () => (
  <>
    <rect x="6" y="7" width="60" height="32" rx="1.5"
      fill="var(--accent)" fillOpacity="0.05" stroke="none" />
    <rect x="6" y="7" width="60" height="32" rx="1.5"
      fill="none" stroke="var(--text-subtle)" strokeWidth="1" strokeOpacity="0.45" />
  </>
);

/** Where a run lands: a dot ON the wall, which is the whole instruction. */
const End = ({ cx, cy, open = false }) => (
  <circle cx={cx} cy={cy} r="2.4" fill={open ? '#fff' : 'var(--accent)'}
    stroke="var(--accent)" strokeWidth="1.5" />
);

const Pointer = ({ x, y }) => (
  <g transform={`translate(${x} ${y})`}>
    <path d="M0,0 L0,15 L4,11.2 L6.8,17.6 L9.6,16.4 L6.8,10.2 L12,10 Z"
      fill="var(--accent)" stroke="#fff" strokeWidth="1.1" strokeLinejoin="round" />
  </g>
);

export const SHAPE_GESTURE = {
  /* A SLOT AT AN ANGLE ON PURPOSE. Drawn square to the room it would read as
     "along a wall", which is the one thing this is not — that detail is the
     reverse cove and it has a tool of its own. Both ends sit exactly on the
     line work, and the pointer is off the wall with the end left behind on it:
     that gap is what says the ends are pinned. */
  line: (
    <svg viewBox="0 0 72 46" className="w-[72px] h-[46px] block overflow-visible"
      aria-hidden="true">
      <Room />
      <line x1="6" y1="16" x2="66" y2="29" stroke="var(--accent)" strokeWidth="2.4"
        strokeLinecap="round" />
      <End cx={6} cy={16} />
      <End cx={66} cy={29} open />
      <line x1="66" y1="29" x2="62" y2="36" stroke="var(--text-subtle)" strokeWidth="1"
        strokeDasharray="2 2.5" />
      <Pointer x={60} y={35} />
    </svg>
  ),
  /* THE L, WITH ITS TWO ENDS ON TWO DIFFERENT WALLS and its corner out in the
     open — which is exactly the rule: the ends answer to the plaster, the
     corners are wherever you put them. */
  pen: (
    <svg viewBox="0 0 72 46" className="w-[72px] h-[46px] block overflow-visible"
      aria-hidden="true">
      <Room />
      <polyline points="6,15 44,15 44,39" fill="none" stroke="var(--accent)"
        strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <End cx={6} cy={15} />
      <circle cx="44" cy="15" r="1.9" fill="#fff" stroke="var(--accent)" strokeWidth="1.3" />
      <End cx={44} cy={39} open />
      <Pointer x={47} y={39} />
    </svg>
  ),
};
