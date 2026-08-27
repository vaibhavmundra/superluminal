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
    hint: 'Drag a box round what it should light.' },
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
          moment it applies is an instruction. */}
      {live && (
        <p className="note" style={{ marginTop: 8 }}>
          <b>{live.label}.</b> {live.hint} <b>Esc</b> to put it away.
        </p>
      )}
    </>
  );
}
