import React from 'react';

// ---------------------------------------------------------------------------
// LightPalette — the three fittings you add by hand, as three symbols.
//
// THE SAME ARGUMENT AS CeilingPalette, and deliberately the same component
// shape: the symbol is the name. What differs is that these three do not share
// a gesture. A sconce is one click on a wall, a strip is two clicks that span a
// run, a spot is a drag that encloses the thing being lit — so the button has
// to say what it will ASK OF YOU as well as what it will place, which is what
// the line under the row is for. A palette whose buttons all look alike and
// behave differently is a palette that gets clicked once and abandoned.
//
// THE MARKS ARE ARTWORK NOW, shipped in /public/icons, exactly as CeilingPalette
// carries its three. They were the plan's own line symbols flattened into a
// 24-unit box — a run with end ticks, a crosshair standing off its wall, a
// circle with an arrow — which kept the palette and the drawing in lockstep but
// asked three hairlines to survive at button size. Beside a row of ceiling
// objects rendered as pictures they also read as the unfinished half of one
// palette, which is the thing that actually decided it.
//
// THE DIVERGENCE IS REAL AND WORTH NAMING: the plan keeps its line symbols, so
// a button and the mark it places are no longer the same drawing. What has to
// hold is weaker but still binding — the button has to stay recognisably the
// thing that lands on the sheet. Change a fitting's symbol on the canvas and
// look at this row before deciding you are done.
//
// THE GESTURE PICTURE BELOW IS STILL DRAWN, and stays drawn. It is not an icon:
// it is a diagram of a drag and its consequence, it has to match the marquee the
// zones tab draws, and it is rendered at 72x46 where hairlines are fine.
// ---------------------------------------------------------------------------

/**
 * `arms` IS WHICH MACHINE A BUTTON TALKS TO, and it exists because this row is
 * no longer one machine's palette.
 *
 * Four of these arm `addTool` — the hand-placing tools whose gestures produce
 * accent zones and task surfaces. The chandelier arms `armed`, the ceiling
 * OBJECT one-shot, because that is what a chandelier is to this app's geometry:
 * a thing with a diameter that reserves clearance and that the grid keeps off.
 * It moved here from CeilingPalette because it is a LIGHT — chosen, specified
 * and paid for with the strips and the sconces — and the row of obstacles was
 * never where anybody would look for one. See the note in CeilingPalette.
 *
 * `arms: 'object'` rather than a hard-coded `id === 'chandelier'` test at the
 * call site: the next decorative fitting to move across should be a line in
 * this table and nothing else.
 */
export const LIGHT_TOOLS = [
  { id: 'strip',  label: 'LED strip',
    hint: 'Click the two ends of the run.' },
  { id: 'sconce', label: 'Sconce',
    hint: 'Click a wall — the fitting seats itself on it.' },
  { id: 'spot',   label: 'Directional spot',
    hint: 'Drag a box round what it should light.',
    // WHAT HAPPENS NEXT, WHICH IS THE HALF NOBODY GUESSES. The other two tools
    // put a fitting where you click. This one does not put a fitting anywhere
    // you point: the box says what is being lit, and the placer then stands the
    // spot on the ceiling's own grid, off to one side, aimed back at the box.
    // Somebody who does not know that drags the box where they want the FITTING
    // — and gets a spot several feet away from it, which reads as a bug in the
    // app rather than as the feature it is.
    // SHORT, because the picture is carrying it. "On the ceiling nearby" cost a
    // fourth line in a card whose drawing already shows the fitting standing off
    // to the side; the sentence only has to name the surprise, not describe it.
    consequence: 'The spot lands nearby, aimed at it.' },
  { id: 'chandelier', label: 'Chandelier', arms: 'object',
    hint: 'Click the ceiling to drop it.',
    // WHY IT IS NOT SIMPLY "click to place". A chandelier reserves clearance
    // like a fan does, so the grid moves out of its way — which looks like the
    // lights having been deleted if you did not know it was coming.
    consequence: 'The ambient grid keeps clear of it.' },
  { id: 'cove',   label: 'Reverse cove',
    hint: 'Select a start and end point on a wall to span a reverse cove.',
    consequence: 'It follows the wall you started on.' },
];

/**
 * The picture on each button. Keyed by tool id, so the row and LIGHT_TOOLS
 * cannot fall out of step: a tool added without artwork renders no image rather
 * than a broken one — see the guard at the call site.
 */
const ICON = {
  strip:  '/icons/led_strip.png',
  sconce: '/icons/sconce.png',
  spot:   '/icons/directional.png',
  chandelier: '/icons/chandelier.png',
  cove:   '/icons/reverse_cove.png',
};

/**
 * THE GESTURE, DRAWN. Only the spot has one, and that is the point rather than
 * an omission.
 *
 * The zones tab's own note makes the argument this borrows: "draw a box" is a
 * sentence about a GESTURE, and a sentence is a poor way to describe one — it
 * has to be read and then imagined. A picture of the marquee being dragged is
 * the gesture itself, at a glance.
 *
 * It earns the space here for a second reason the zone hint does not have: the
 * spot is the one tool whose RESULT is not where the gesture is. The box, the
 * pointer dragging its far corner, and the fitting standing off to the side with
 * its beam pointing back into the box are three marks saying the one thing a
 * sentence keeps failing to: you are not placing the light, you are naming what
 * the light is for.
 *
 * DELIBERATELY THE ZONE HINT'S OWN VISUAL LANGUAGE — the same 72x46 box, the
 * same dashed marquee with a live corner, the same pointer — because it is the
 * same gesture. Two different pictures of one drag would say they were two
 * different drags. What is added is the consequence, in the accent, drawn as
 * PlanCanvas draws a spot: a ring with a filled pupil and an arrow off its rim.
 */
const GESTURE = {
  spot: (
    <svg viewBox="0 0 72 46" className="w-[72px] h-[46px] block overflow-visible" aria-hidden="true">
      {/* What is being lit: the box, and the corner the drag started from. */}
      <rect x="24" y="10" width="37" height="24" rx="2"
        fill="var(--accent)" fillOpacity="0.07"
        stroke="var(--text-subtle)" strokeWidth="1.4" strokeDasharray="4 3" />
      <circle cx="24" cy="10" r="2" fill="var(--text-subtle)" />
      {/* ...and the pointer dragging the far corner, tip ON it, so the two read
          as one gesture rather than as a box and an arrow. */}
      <g transform="translate(61 34)">
        <path d="M0,0 L0,15 L4,11.2 L6.8,17.6 L9.6,16.4 L6.8,10.2 L12,10 Z"
          fill="var(--accent)" stroke="#fff" strokeWidth="1.1"
          strokeLinejoin="round" />
      </g>
      {/* THE FITTING, OFF TO THE SIDE. At the middle of the left edge on
          purpose: the two corners are spoken for by the drag — one by its start
          dot, the other by the pointer — and a beam crossing either of them
          would read as part of the gesture instead of as its consequence. */}
      <g stroke="var(--accent)" strokeLinecap="round">
        <circle cx="7" cy="22" r="4.3" fill="#fff" strokeWidth="1.7" />
        <circle cx="7" cy="22" r="1.7" fill="var(--accent)" stroke="none" />
        <line x1="12" y1="22" x2="19.5" y2="22" strokeWidth="1.6" fill="none" />
        <path d="M20.6,22 L16.4,20 L16.4,24 Z" fill="var(--accent)" stroke="none" />
      </g>
    </svg>
  ),
  /* THE COVE'S GESTURE, AND IT EARNS A PICTURE FOR THE REASON THE SPOT DOES:
     the thing that is hard to guess is not where you click, it is what the
     SECOND click is allowed to be. The slot is locked to the wall the first
     point landed on, so the second point only ever slides along that wall —
     drag the pointer out into the room and the end stays on the line. A sentence
     has to say that in a clause nobody reads; two dots on one wall with the band
     between them and the pointer off the wall but the end still on it says it at
     a glance.

     THE WALL IS THE HEAVY LINE ALONG THE TOP and the band hangs INSIDE it, which
     is where a reverse cove actually sits — eight inches of ceiling at the wall,
     washing down it. Drawn in the accent because the tape is the thing being
     placed; the wall is the drawing's own ink. */
  cove: (
    <svg viewBox="0 0 72 46" className="w-[72px] h-[46px] block overflow-visible" aria-hidden="true">
      {/* The room, and the wall being coved along its top edge. */}
      <rect x="6" y="9" width="60" height="30" rx="1.5"
        fill="none" stroke="var(--text-subtle)" strokeWidth="1" strokeOpacity="0.45" />
      <line x1="6" y1="9" x2="66" y2="9" stroke="var(--text-subtle)" strokeWidth="2.2" />
      {/* The slot: the band, its inner lip, and the tape down the middle. */}
      <rect x="17" y="9" width="34" height="6" fill="var(--accent)" fillOpacity="0.18" />
      <line x1="17" y1="15" x2="51" y2="15" stroke="var(--accent)" strokeWidth="1.2" />
      <line x1="17" y1="12" x2="51" y2="12" stroke="var(--accent)" strokeWidth="1.6"
        strokeLinecap="round" />
      {/* Where it started, and where it ends — both ON the wall. */}
      <circle cx="17" cy="9" r="2.1" fill="var(--accent)" />
      <circle cx="51" cy="9" r="2.1" fill="#fff" stroke="var(--accent)" strokeWidth="1.5" />
      {/* ...and the pointer OFF the wall, out in the room, with the end left
          behind on the line. That gap is the whole instruction. */}
      <line x1="51" y1="9" x2="57" y2="27" stroke="var(--text-subtle)" strokeWidth="1"
        strokeDasharray="2 2.5" />
      <g transform="translate(55 26)">
        <path d="M0,0 L0,15 L4,11.2 L6.8,17.6 L9.6,16.4 L6.8,10.2 L12,10 Z"
          fill="var(--accent)" stroke="#fff" strokeWidth="1.1" strokeLinejoin="round" />
      </g>
    </svg>
  ),
};

/**
 * `objArmed` IS THE CEILING-OBJECT ONE-SHOT, alongside `tool` which is the
 * hand-placing one. Two pieces of state rather than one because they are two
 * different machines with two different lifetimes — see `arms` above — and this
 * row is the one place both are on screen, so it is the one place that has to
 * ask which of them a button is lit by.
 */
export default function LightPalette({ tool, objArmed = null, onPick, disabled = false }) {
  const isOn = (t) => (t.arms === 'object' ? objArmed === t.id : tool === t.id);
  const live = LIGHT_TOOLS.find(isOn);
  return (
    <>
      {/* FIVE IN A THREE-WIDE GRID, so the second row carries two and a gap.
          The alternative was five columns, which shrinks every button to fit the
          narrowest panel and makes the artwork — the whole point of a palette
          whose symbols are its names — too small to recognise. */}
      <div className="grid grid-cols-3 gap-[5px] mt-2">
        {LIGHT_TOOLS.map((t) => (
          <button key={t.id} type="button" disabled={disabled}
            className={'flex flex-col items-center gap-[3px] pt-[7px] px-[2px] pb-[5px] '
              + 'rounded-[8px] border cursor-pointer transition-colors duration-[120ms] '
              + 'disabled:opacity-45 disabled:cursor-not-allowed '
              /* ARMED TAKES THE ACCENT RAMP AS A 1px RING, exactly as the
                 ceiling palette does — see the note there for the mechanism.
                 It was `shadow-[inset_0_0_0_1px_currentColor]` over
                 `text-accent`, which is the flat amber, and a flat amber ring
                 beside a ceiling palette whose armed ring is the ramp made two
                 rows of the same panel disagree about what "armed" looks like.
                 `text-accent` GOES WITH IT. It used to colour the glyph through
                 `currentColor`; the artwork carries its own colour now, and the
                 ring is a paint server rather than a text colour, so nothing was
                 left for it to feed.
                 ONE `bg-*` PER BRANCH. The base string used to carry `bg-surface`
                 and the armed suffix added `bg-input-bg` on top — two utilities
                 on one property, which is the ordering trap this codebase warns
                 about at the top of App.jsx. Each state now names its own. */
              + (isOn(t)
                ? 'border-transparent bg-input-bg gradient-ring'
                : 'border-border/10 bg-surface enabled:hover:bg-input-bg')}
            title={`${t.label} — ${t.hint}`}
            aria-pressed={isOn(t)}
            onClick={() => onPick(isOn(t) ? null : t.id, t.arms ?? 'tool')}>
            {/* alt="" ON PURPOSE, same as the ceiling palette: the label below
                is the accessible name, and a screen reader saying "sconce"
                twice is worse than not describing the picture at all.
                GUARDED, so a tool listed in LIGHT_TOOLS without artwork degrades
                to its label instead of rendering a broken image. */}
            {ICON[t.id] && (
              <img src={ICON[t.id]} alt="" width="40" height="40"
                className="w-10 h-10 object-contain select-none" draggable="false" />
            )}
            <span className={'text-[9.5px] leading-[1.15] text-center tracking-[0.01em] ' +
              /* THE SAME FIX AS THE CEILING PALETTE, and the same reason: this
                 row sits on the same dark panel, so `text-ink` made an armed
                 tool's name vanish rather than stand out. Two palettes side by
                 side that answer "which one is armed" differently would be worse
                 than either answer. */
              (isOn(t) ? 'text-white' : 'text-subtle')}>{t.label}</span>
          </button>
        ))}
      </div>
      {/* WHAT THE ARMED TOOL WANTS FROM YOU. Only while one is armed: three
          gesture descriptions on screen at rest is a manual, and one at the
          moment it applies is an instruction.
          
          A PICTURE WHERE THERE IS ONE, AND THE SENTENCE OTHERWISE. Not a
          fallback to be filled in later — a hint card is worth its space where
          the gesture is hard to imagine or its result lands somewhere
          surprising, and "click a wall" is neither. The card also drops the
          tool's NAME, which the sentence version needs and it does not: the
          button directly above it is visibly pressed, and its own label is
          two lines up. */}
      {live && (GESTURE[live.id] ? (
        <div className="flex flex-col items-center gap-2 pt-3.5 px-4 pb-3 rounded-lg border border-border bg-input-bg text-center mt-2">
          {GESTURE[live.id]}
          <p className="m-0 text-[11px] leading-[1.5] text-muted max-w-[30ch]">
            {live.hint}{live.consequence ? ` ${live.consequence}` : ''}
            <br /><span className="text-subtle"><b>Esc</b> to put it away.</span>
          </p>
        </div>
      ) : (
        <p className="text-[11.5px] text-muted leading-[1.5] mt-2">
          <b>{live.label}.</b> {live.hint} <b>Esc</b> to put it away.
        </p>
      ))}
    </>
  );
}
