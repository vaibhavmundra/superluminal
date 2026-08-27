import React from 'react';

// ---------------------------------------------------------------------------
// PlanLoader — the wait, made legible.
//
// Four model calls per room happen behind this, and on a six-room flat that is
// twenty-odd round trips. A spinner over that is a lie by omission: it says
// "wait" without saying what for or how much longer, and a minute of it reads as
// a hang.
//
// So the loader IS THE PLAN. Every room the user just confirmed is drawn as its
// own outline, and each one carries its state on its face: a pulse travelling
// round the stroke while it is being worked on, solid and filled once it is
// done. You can see the work move across your own drawing, which is both the
// honest progress bar and the thing that makes the wait feel like progress
// rather than like nothing happening.
//
// THE TRAVELLING STROKE, mechanically. The obvious way is one dash painted with
// a gradient that fades at both ends, and it does not work: an SVG gradient is
// SPATIAL, so `objectBoundingBox` maps the fade to the polygon's width. The
// pulse then tapers nicely along the top and bottom edges of a room and is flat
// colour down the sides, which looks like a bug on any room that is not a
// letterbox.
//
// So the taper is built out of the DASHES instead, which are measured along the
// path and therefore work at every orientation: three laps of the same outline,
// each a longer dash at a lower opacity, phase-shifted to sit behind the one in
// front. Head, body, trail — a comet. `--from` is where each layer's dash
// starts and `--lap` is a whole perimeter further on, so one cycle is exactly
// one lap whatever shape the room is.
//
// The dash lengths are FRACTIONS of the polygon's own perimeter — hence
// perimeter() below — or a WC and a hall get the same absolute dash and the
// effect reads completely differently on each.
//
// Each room's animation is offset by its index, so six rooms do not pulse in
// lockstep like a Christmas light.
// ---------------------------------------------------------------------------

/**
 * Head, body, trail. Ordered back to front so the head paints last and stays
 * crisp over the top of its own glow.
 */
const PULSE = [
  { len: 0.26, back: 0.225, opacity: 0.16, width: 3.4, colour: '#6161f5' },
  { len: 0.13, back: 0.095, opacity: 0.42, width: 2.9, colour: '#6161f5' },
  { len: 0.045, back: 0,    opacity: 1,    width: 2.4, colour: '#8f8ff8' },
];

const perimeter = (pts) => {
  let d = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    d += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return d;
};

export default function PlanLoader({
  width, height, rooms = [], phase = '', detail = '',
  done = 0, total = 0, steps = [],
}) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="loader-wrap">
      <div className="loader-stage">
        <svg viewBox={`0 0 ${width} ${height}`} className="loader-plan"
          preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="sl-fill" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#6161f5" stopOpacity="0.04" />
              <stop offset="0.5" stopColor="#6161f5" stopOpacity="0.14" />
              <stop offset="1" stopColor="#6161f5" stopOpacity="0.04" />
            </linearGradient>
          </defs>

          {rooms.map((r, i) => {
            const pts = r.points.map((p) => `${p.x},${p.y}`).join(' ');
            const L = perimeter(r.points) || 1;
            const lw = Math.max(width, height) / 420;
            return (
              <g key={r.id}>
                <polygon points={pts}
                  fill={r.state === 'done' ? 'url(#sl-fill)' : 'rgba(97,97,245,0.045)'}
                  stroke="#DDE1FF" strokeWidth={lw} />
                {r.state === 'busy' && PULSE.map((seg, k) => (
                  <polygon key={k} points={pts} fill="none"
                    stroke={seg.colour} strokeOpacity={seg.opacity}
                    strokeWidth={lw * seg.width} strokeLinejoin="round"
                    strokeLinecap="round" className="sl-run"
                    style={{
                      strokeDasharray: `${L * seg.len} ${L}`,
                      // A positive dash offset shifts the pattern BACKWARD along
                      // the path, which is what puts the trail behind the head.
                      ['--from']: `${L * seg.back}px`,
                      ['--lap']: `${L * seg.back - L}px`,
                      animationDelay: `${(i % 6) * -0.28}s`,
                    }} />
                ))}
                {r.state === 'done' && (
                  <polygon points={pts} fill="none" stroke="#6161f5"
                    strokeWidth={lw * 1.6} strokeLinejoin="round" opacity="0.85" />
                )}
                {r.label && (
                  <text x={r.centre.x} y={r.centre.y} textAnchor="middle"
                    fontSize={Math.max(width, height) / 78}
                    fontFamily="JetBrains Mono, monospace"
                    fill={r.state === 'done' ? '#4B4BD8' : '#A9A9C9'}>
                    {r.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        <div className="loader-panel">
          <div className="loader-phase">{phase}</div>
          {detail && <div className="loader-detail">{detail}</div>}
          <div className="loader-bar"><i style={{ width: `${pct}%` }} /></div>
          <ol className="loader-steps">
            {steps.map((s) => (
              <li key={s.key} className={s.state}>
                <span className="dot" />
                {/* One wrapper, so the grid has exactly two children. Without it
                    the label, the note and the dot are three auto-placed items
                    and the note lands in the 14px dot column, wrapping to one
                    word per line. */}
                <div>
                  {s.label}
                  {s.note ? <em>{s.note}</em> : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
