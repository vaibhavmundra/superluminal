import React from 'react';
import { tally } from '../lib/switchboards.js';

// ---------------------------------------------------------------------------
// SwitchboardCard — the plate you selected, drawn as the plate it is.
//
// AN ELEVATION IN A PANEL FULL OF PLAN. Everything else on this screen is a
// view from above, and a switchboard is the one object on the drawing whose
// whole content is invisible from up there: in plan it is a 230x80 rectangle
// and nothing else, and what a person actually wants to know about it is how
// many modules it is and what is in them. So this is the only elevation in the
// app, and it is in the panel rather than on the canvas because it is not at
// any position — it is what is AT a position the canvas already shows.
//
// THE MODULE IS THE UNIT AND IT IS 2:1. One module is a portrait rectangle
// twice as tall as it is wide; a two-module device is a SQUARE OF THE SAME
// HEIGHT. That is not a stylisation, it is the proportion of the real part, and
// it is the reason the geometry below abuts modules WITHIN a device and only
// leaves a gap BETWEEN devices. Put a gap inside a two-module socket and it
// stops being a square — it becomes two modules wide plus a hairline, which is
// visibly not the thing on the wall.
//
//   pitch W, height 2W. A device of m modules is m*W wide and 2W tall.
//   Devices are separated by G. A frame of `size` modules holding `n` devices
//   is therefore size*W + (n-1)*G across, inside its plate.
//
// WHITE STROKE, NO FILL, like the rest of the app's line work. A filled plate
// on this panel would be the loudest object on the screen for the smallest
// reason.
//
// IT SCALES DOWN AND NOT UP. The svg carries a viewBox and a `maxWidth` in the
// viewBox's own units, so a four-module board is drawn at its natural size and
// an eighteen-module one shrinks to the column rather than overflowing it. A
// board that grew to fill the panel would draw a one-gang plate the size of a
// postcard.
//
// GLYPHS AND NOT LABELS INSIDE THE DEVICE. At the width an eighteen-module
// frame renders here, a module is fourteen pixels across; nothing but a mark
// survives that. The words are underneath, in the tally, where they are read
// once rather than eighteen times.
// ---------------------------------------------------------------------------

const W = 22;          // one module, across
const H = W * 2;       // ...and its height. The 2:1 the brief asked for.
const G = 4;           // between two devices
const PAD = 9;         // the plate, around the modules
const STROKE = '#FFFFFF';

/**
 * WHAT GOES INSIDE ONE DEVICE.
 *
 * A BLANK DRAWS NOTHING, deliberately: an empty rectangle in a frame IS a blank
 * plate, and a mark in the middle of it would be saying the opposite of what
 * the part is.
 */
function Face({ kind, x, y, w, h }) {
  const cx = x + w / 2, cy = y + h / 2;
  const r = Math.min(w, h) * 0.26;
  const common = { fill: 'none', stroke: STROKE, strokeWidth: 1.3, strokeLinecap: 'round' };
  switch (kind) {
    // A rocker: the line the two halves of the switch meet on.
    case 'switch':
      return <line x1={cx - w * 0.3} y1={cy} x2={cx + w * 0.3} y2={cy} {...common} />;
    // A regulator is a knob with an index mark, which is what makes it read as
    // a thing you TURN rather than a thing you press.
    case 'fan':
      return (
        <g {...common}>
          <circle cx={cx} cy={cy} r={r} />
          <line x1={cx} y1={cy} x2={cx} y2={cy - r} />
        </g>
      );
    // Three pins in a ring — the outlet face, near enough in any country to be
    // unmistakable at this size.
    case 'socket':
      return (
        <g {...common}>
          <circle cx={cx} cy={cy} r={r * 1.45} />
          <circle cx={cx} cy={cy - r * 0.62} r={r * 0.2} fill={STROKE} />
          <circle cx={cx - r * 0.55} cy={cy + r * 0.42} r={r * 0.2} fill={STROKE} />
          <circle cx={cx + r * 0.55} cy={cy + r * 0.42} r={r * 0.2} fill={STROKE} />
        </g>
      );
    // The port itself: a flat oval, which is a USB-C receptacle and nothing else.
    case 'usb':
      return (
        <rect x={cx - w * 0.26} y={cy - 2} width={w * 0.52} height={4}
              rx={2} {...common} />
      );
    // A keystone jack: the body, and the latch slot above it.
    case 'data':
      return (
        <g {...common}>
          <rect x={cx - w * 0.24} y={cy - h * 0.1} width={w * 0.48} height={h * 0.18} />
          <line x1={cx - w * 0.08} y1={cy - h * 0.1} x2={cx - w * 0.08} y2={cy - h * 0.19} />
          <line x1={cx + w * 0.08} y1={cy - h * 0.1} x2={cx + w * 0.08} y2={cy - h * 0.19} />
          <line x1={cx - w * 0.08} y1={cy - h * 0.19} x2={cx + w * 0.08} y2={cy - h * 0.19} />
        </g>
      );
    default:
      return null;
  }
}

/** One frame: the plate, and the devices in it. */
function Frame({ board }) {
  const n = board.points.length;
  const inner = board.size * W + Math.max(0, n - 1) * G;
  const vw = inner + PAD * 2;
  const vh = H + PAD * 2;

  let cursor = PAD;
  const devices = board.points.map((p, i) => {
    const w = p.modules * W;
    const d = { p, i, x: cursor, y: PAD, w, h: H };
    cursor += w + G;
    return d;
  });

  return (
    <svg viewBox={`0 0 ${vw} ${vh}`} width="100%" role="img"
         style={{ maxWidth: `${vw}px`, display: 'block' }}
         aria-label={`${board.size} ${board.size === 1 ? board.unit : board.units}`}>
      {/* THE PLATE, which is the thing screwed to the wall and the reason the
          devices have a margin round them at all. Half-opacity so the modules
          read as the content and the frame as the edge. */}
      <rect x={0.7} y={0.7} width={vw - 1.4} height={vh - 1.4} rx={5}
            fill="none" stroke={STROKE} strokeOpacity={0.45} strokeWidth={1.4} />
      {devices.map(({ p, i, x, y, w, h }) => (
        <g key={i}>
          <rect x={x} y={y} width={w} height={h} rx={2.5}
                fill="none" stroke={STROKE}
                /* A BLANK IS DRAWN FAINTER THAN A DEVICE. It is a real part and
                   it is on the schedule, but it is the absence of a point and
                   the plate should read that way at a glance. */
                strokeOpacity={p.kind === 'blank' ? 0.35 : 1}
                strokeWidth={1.4} />
          <Face kind={p.kind} x={x} y={y} w={w} h={h} />
          {/* THE RATING, ON THE PARTS THAT HAVE ONE. It is the one thing about a
              module that cannot be drawn — a 6A rocker and a 20A rocker are the
              same mark — and on a plate with both on it, which is the plate this
              is for, it is the only way to tell them apart. */}
          {p.amps != null && (
            <text x={x + w / 2} y={y + h - 5} textAnchor="middle"
                  fill={STROKE} fillOpacity={0.75} fontSize={8}
                  style={{ fontFamily: 'inherit' }}>{p.amps}A</text>
          )}
        </g>
      ))}
    </svg>
  );
}

/**
 * `composition` is composeSwitchboard's answer. `onRemove(extraId)` is offered
 * only where there is something to remove — see the note in App.jsx about a
 * read-only sheet, where every control on this card is absent rather than inert.
 */
export default function SwitchboardCard({ composition, extras = [], onRemove = null }) {
  if (!composition?.boards?.length) return null;
  const { boards, country } = composition;
  const unitOf = (b) => (b.size === 1 ? b.unit : b.units);

  return (
    <div className="flex flex-col gap-3">
      {boards.map((b) => (
        <div key={b.index} className="flex flex-col gap-1.5">
          {/* WHAT YOU ARE LOOKING AT, IN ONE LINE, and the second half of it
              only exists when the position came out as more than one frame —
              which is the one case where a person needs telling that the plate
              on the drawing is two plates on the wall. */}
          <div className="flex justify-between text-[10px] tracking-[0.11em]
            uppercase text-subtle">
            <span>{b.size} {unitOf(b)}</span>
            {boards.length > 1 && <span>{b.index + 1} of {boards.length}</span>}
          </div>
          <Frame board={b} />
          <ul className="list-none m-0 p-0 mt-0.5">
            {tally(b).map((row) => (
              <li key={row.label}
                  className="flex justify-between text-[11.5px] text-muted py-[2px]">
                <span>{row.label}</span>
                <b className="text-text tabular-nums font-normal">×{row.count}</b>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {/* WHAT WAS ADDED BY HAND, WITH A WAY BACK. Grouped by the press that
          added it, so a socket — which is a switch and an outlet — comes off in
          the one press it went on in. */}
      {onRemove && extras.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {extras.map((e) => (
            <button key={e.id} type="button" onClick={() => onRemove(e.id)}
              className="appearance-none text-[11px] px-2 py-[3px] rounded-full
                border border-border-strong bg-surface text-muted cursor-pointer
                hover:text-black hover:bg-surface-2">
              {e.label} ×
            </button>
          ))}
        </div>
      )}
      <p className="text-[11.5px] text-muted leading-[1.5] m-0">
        {country.name} · {composition.total} {composition.total === 1
          ? country.unit : country.units}
      </p>
    </div>
  );
}
