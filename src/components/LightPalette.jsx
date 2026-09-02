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
};

export default function LightPalette({ tool, onPick, disabled = false }) {
  const live = LIGHT_TOOLS.find((t) => t.id === tool);
  return (
    <>
      <div className="grid grid-cols-3 gap-[5px] mt-2">
        {LIGHT_TOOLS.map((t) => (
          <button key={t.id} type="button" disabled={disabled}
            className={'flex flex-col items-center gap-[3px] pt-[7px] px-[2px] pb-[5px] rounded-[8px] border border-border/10 bg-surface text-accent cursor-pointer transition-colors duration-[120ms] enabled:hover:bg-input-bg disabled:opacity-45 disabled:cursor-not-allowed' +
              (tool === t.id ? ' bg-input-bg shadow-[inset_0_0_0_1px_currentColor]' : '')}
            title={`${t.label} — ${t.hint}`}
            /* `text-accent` IS STILL LOAD-BEARING, but for less than it was.
               It used to colour the glyph, which took `currentColor` — the
               artwork carries its own colour now, so all it feeds is the armed
               ring's `currentColor` in the inset shadow above. Same job the
               ceiling palette's `text-accent` does, and the same reason all
               three buttons share one hue: these all place the same KIND of
               thing, where a ceiling object and a light are two kinds. */
            aria-pressed={tool === t.id}
            onClick={() => onPick(tool === t.id ? null : t.id)}>
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
              (tool === t.id ? 'text-ink' : 'text-muted')}>{t.label}</span>
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
