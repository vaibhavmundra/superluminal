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

/*
 * Head, body, trail. Ordered back to front so the head paints last and stays
 * crisp over the top of its own glow.
 *
 * THE THREE LAPS ARE THE THREE STOPS OF THE ACCENT RAMP, and that is what makes
 * this a ramp rather than three tints of one colour. They were #0070F3 twice and
 * #66AEFF for the head — the old flat accent, which is not what anything on the
 * drawing is painted in any more. The ramp runs #c2a987 → #efd5b2 → #fef1dd
 * dark to bright, so the trail takes the darkest stop, the body the middle and
 * the HEAD the brightest: the comet gets warmer as well as denser towards its
 * nose, which is the same gradient the finished outline is stroked with, read
 * along time instead of along the path.
 */
const PULSE = [
  { len: 0.26,  back: 0.225, opacity: 0.16, width: 3.4, colour: '#c2a987' },
  { len: 0.13,  back: 0.095, opacity: 0.42, width: 2.9, colour: '#efd5b2' },
  { len: 0.045, back: 0,     opacity: 1,    width: 2.4, colour: '#fef1dd' },
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
    <div className="absolute inset-0 z-40 grid place-items-center bg-black/[0.92] backdrop-blur-[5px] backdrop-saturate-[1.8]">
      <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-[26px] items-center w-[min(1020px,calc(100%-56px))] max-[900px]:grid-cols-[minmax(0,1fr)] max-[900px]:gap-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-h-[min(62vh,560px)] block"
          preserveAspectRatio="xMidYMid meet">
          <defs>
            {/* THE WASH INSIDE A FINISHED ROOM, and it is the ramp at a few per
                cent — the same paint as the fittings about to land in it. */}
            <linearGradient id="sl-fill" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#c2a987" stopOpacity="0.05" />
              <stop offset="0.5" stopColor="#fef1dd" stopOpacity="0.16" />
              <stop offset="1" stopColor="#c2a987" stopOpacity="0.05" />
            </linearGradient>
            {/* ...AND THE RING ROUND IT IS THE RAMP ITSELF, not one stop of it.
                A finished outline was a flat #0070F3 line; on this screen the
                drawing's own outlines are stroked with this gradient, so the
                loader's version of the same object now matches it. */}
            <linearGradient id="sl-ring" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#c2a987" />
              <stop offset="0.25" stopColor="#efd5b2" />
              <stop offset="0.5" stopColor="#fef1dd" />
              <stop offset="0.75" stopColor="#efd5b2" />
              <stop offset="1" stopColor="#c2a987" />
            </linearGradient>
          </defs>

          {rooms.map((r, i) => {
            const pts = r.points.map((p) => `${p.x},${p.y}`).join(' ');
            const L = perimeter(r.points) || 1;
            const lw = Math.max(width, height) / 420;
            return (
              <g key={r.id}>
                <polygon points={pts}
                  fill={r.state === 'done' ? 'url(#sl-fill)' : 'rgba(255,255,255,0.03)'}
                  stroke="rgba(234,234,234,0.16)" strokeWidth={lw} />
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
                  <polygon points={pts} fill="none" stroke="url(#sl-ring)"
                    strokeWidth={lw * 1.6} strokeLinejoin="round" opacity="0.9" />
                )}
                {r.label && (
                  <text x={r.centre.x} y={r.centre.y} textAnchor="middle"
                    fontSize={Math.max(width, height) / 78}
                    fontFamily="The Neue Montreal, sans-serif"
                    fill={r.state === 'done' ? '#FFFFFF' : '#7A7A7A'}>
                    {r.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        <div>
          <div className="text-[15px] tracking-[-0.01em] text-white">{phase}</div>
          {detail && <div className="text-[11.5px] text-muted mt-[3px] min-h-[15px]">{detail}</div>}
          <div className="h-[3px] rounded-[2px] bg-white/10 mt-3 mb-3.5 overflow-hidden">
            <i className="block h-full bg-white rounded-[2px] transition-[width] duration-[350ms] ease-in-out" style={{ width: `${pct}%` }} />
          </div>
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
