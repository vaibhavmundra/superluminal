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
// The glyphs are the plan's own marks flattened into a 24-unit box: a run with
// end ticks, a crosshair standing off its wall, a circle with an arrow. If
// PlanCanvas ever draws one of them differently, this has to follow — a palette
// that lies about what it places is worse than a dropdown.
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

const GLYPH = {
  strip: (
    <g fill="none" strokeLinecap="round">
      <line x1="4" y1="12" x2="20" y2="12" strokeWidth="3"
        strokeDasharray="2.6 2.8" />
      <line x1="4" y1="8.4" x2="4" y2="15.6" strokeWidth="1.4" />
      <line x1="20" y1="8.4" x2="20" y2="15.6" strokeWidth="1.4" />
    </g>
  ),
  sconce: (
    <g fill="none" strokeLinecap="round">
      {/* the wall it hangs off */}
      <line x1="3.6" y1="3" x2="3.6" y2="21" strokeWidth="1.6" opacity="0.45" />
      <circle cx="13" cy="12" r="5" fill="#fff" />
      <line x1="3.6" y1="12" x2="19.4" y2="12" strokeWidth="1.6" />
      <line x1="13" y1="6.4" x2="13" y2="17.6" strokeWidth="1.6" />
      <circle cx="13" cy="12" r="5" strokeWidth="1.8" />
    </g>
  ),
  spot: (
    <g fill="none" strokeLinecap="round">
      <circle cx="9.5" cy="12" r="4.6" fill="#fff" strokeWidth="1.8" />
      <circle cx="9.5" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <line x1="15" y1="12" x2="20" y2="12" strokeWidth="1.7" />
      <path d="M20,12 L16.8,10.2 L16.8,13.8 Z" fill="currentColor" stroke="none" />
    </g>
  ),
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
    <svg viewBox="0 0 72 46" aria-hidden="true">
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
      <div className="palette three">
        {LIGHT_TOOLS.map((t) => (
          <button key={t.id} type="button" disabled={disabled}
            className={'palette-btn' + (tool === t.id ? ' on' : '')}
            title={`${t.label} — ${t.hint}`}
            /* THESE ARE LIGHTS, so they wear the colour lights wear on the
               canvas. The ceiling palette colours each button by the object it
               places for the same reason; here all three place the same kind of
               thing, so all three are the accent. */
            style={{ color: 'var(--accent)' }}
            aria-pressed={tool === t.id}
            onClick={() => onPick(tool === t.id ? null : t.id)}>
            <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"
              stroke="currentColor" strokeWidth="1.5">{GLYPH[t.id]}</svg>
            <span>{t.label}</span>
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
        <div className="gesture-hint">
          {GESTURE[live.id]}
          <p>
            {live.hint}{live.consequence ? ` ${live.consequence}` : ''}
            <br /><span className="esc"><b>Esc</b> to put it away.</span>
          </p>
        </div>
      ) : (
        <p className="note" style={{ marginTop: 8 }}>
          <b>{live.label}.</b> {live.hint} <b>Esc</b> to put it away.
        </p>
      ))}
    </>
  );
}
