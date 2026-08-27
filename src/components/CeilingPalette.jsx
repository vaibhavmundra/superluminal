import React from 'react';
import { CEILING_TYPES } from '../lib/ceilingObjects.js';

// ---------------------------------------------------------------------------
// CeilingPalette — four symbols in a row, not a dropdown.
//
// A dropdown asks you to READ four words and then commit before you can see
// what you picked. These are drawn objects with drawn symbols, and the symbol
// IS the name — the same mark that will appear on the plan appears on the
// button, so choosing is recognition rather than reading, and what you clicked
// is confirmed by what shows up under the cursor.
//
// The glyphs are deliberately the same drawings PlanCanvas uses, simplified to
// a 24-unit box. If the plan's fan symbol ever changes, this one has to change
// with it — a palette that lies about what it places is worse than a dropdown.
// ---------------------------------------------------------------------------

const GLYPH = {
  fan: (
    <g fill="none" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" strokeDasharray="2.4 2.4" opacity="0.6" />
      {[0, 1, 2].map((k) => {
        const a = (k * 2 * Math.PI) / 3 + Math.PI / 6;
        return <line key={k} x1="12" y1="12"
          x2={12 + Math.cos(a) * 7.4} y2={12 + Math.sin(a) * 7.4} />;
      })}
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </g>
  ),
  chandelier: (
    <g fill="none">
      <circle cx="12" cy="12" r="9" strokeDasharray="2.4 2.4" opacity="0.6" />
      <circle cx="12" cy="12" r="5.4" />
      {[0, 1, 2, 3, 4, 5].map((k) => {
        const a = (k * Math.PI) / 3;
        return <circle key={k} cx={12 + Math.cos(a) * 5.4} cy={12 + Math.sin(a) * 5.4}
          r="1.5" fill="#fff" />;
      })}
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </g>
  ),
  ac: (
    <g fill="none">
      <circle cx="12" cy="12" r="9.2" strokeDasharray="2.4 2.4" opacity="0.6" />
      <rect x="5.5" y="5.5" width="13" height="13" />
      <rect x="7.6" y="7.6" width="8.8" height="8.8" opacity="0.5" />
      <line x1="12" y1="5.5" x2="12" y2="8.6" />
    </g>
  ),
  trapdoor: (
    <g fill="none">
      <circle cx="12" cy="12" r="9.2" strokeDasharray="2.4 2.4" opacity="0.6" />
      <rect x="5.5" y="5.5" width="13" height="13" />
      <line x1="5.5" y1="5.5" x2="18.5" y2="18.5" opacity="0.6" />
      <line x1="18.5" y1="5.5" x2="5.5" y2="18.5" opacity="0.6" />
    </g>
  ),
};

export default function CeilingPalette({ armed, onArm, disabled = false }) {
  return (
    <div className="palette">
      {CEILING_TYPES.map((t) => {
        const on = armed === t.id;
        return (
          <button key={t.id} type="button" disabled={disabled}
            className={'palette-btn' + (on ? ' on' : '')}
            title={t.label}
            style={on ? { color: t.colour, borderColor: t.colour } : { color: t.colour }}
            onClick={() => onArm(on ? null : t.id)}>
            <svg viewBox="0 0 24 24" width="26" height="26"
              stroke="currentColor" strokeWidth="1.3">
              {GLYPH[t.kind]}
            </svg>
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
