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

/**
 * THE INK IS A PARAMETER NOW, AND IT WAS A CONSTANT. White, because this card
 * lives on a dark glass panel and every other stroke on it is white.
 *
 * THEN THE SHEET ARRIVED. "See all switchboards" draws the same plates on WHITE
 * PAPER — see SwitchboardSheet — and white on white is nothing at all. One
 * drawing, two grounds, so the colour comes in from outside and the geometry
 * stays in one place. The default is the panel's, so every existing call site is
 * unchanged.
 */
const PANEL_INK = '#FFFFFF';

/**
 * ...AND WHAT IS BEHIND IT, which a filled module needs and a stroked one does
 * not. A module on the wire you have picked is drawn SOLID in the ink — that is
 * what "turns white" means on a panel whose every line is already white — and
 * its glyph then has to be the ground or it disappears into the fill.
 *
 * `#12100E` AND NOT `transparent`. The panel is 5% white over the page, so the
 * honest ground is what shows through it; a transparent glyph would leave the
 * fill unbroken and a module with no mark on it is a blank plate.
 */
const PANEL_GROUND = '#12100E';

/**
 * WHAT GOES INSIDE ONE DEVICE.
 *
 * A BLANK DRAWS NOTHING, deliberately: an empty rectangle in a frame IS a blank
 * plate, and a mark in the middle of it would be saying the opposite of what
 * the part is.
 */
function Face({ kind, x, y, w, h, ink = PANEL_INK }) {
  const STROKE = ink;
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

/**
 * ONE MODULE, drawn at an offset within its own unit.
 *
 * AT MODULE SCOPE AND NOT INSIDE `BoardFrame`, which matters more than it looks.
 * A component declared inside a render is a NEW COMPONENT TYPE on every render,
 * so React cannot match it against the last one and tears its subtree down and
 * rebuilds it — every frame of a drag. The elements would be recreated under a
 * transition that is trying to interpolate them.
 */
function Module({ p, x, lit, ink, ground, onPick = null, onGrab = null }) {
  const STROKE = ink;
  const w = p.modules * W;
  return (
    <>
      <rect x={x} y={PAD} width={w} height={H} rx={2.5}
            /* SOLID WHEN IT IS THE PICKED ONE. On a panel where every line is
               already white, an outline cannot be made more emphatic by being
               whiter — so the module fills in, and its glyph flips to the
               ground. It is the same selection the canvas draws in green; see
               WIRE_PICKED in flows.js. */
            fill={lit ? STROKE : 'none'} stroke={STROKE}
            /* A BLANK IS DRAWN FAINTER THAN A DEVICE. It is a real part and it
               is on the schedule, but it is the absence of a point and the plate
               should read that way at a glance. */
            strokeOpacity={p.kind === 'blank' ? 0.35 : 1}
            strokeWidth={1.4} />
      <Face kind={p.kind} x={x} y={PAD} w={w} h={H} ink={lit ? ground : STROKE} />
      {/* THE RATING, ON THE PARTS THAT HAVE ONE. It is the one thing about a
          module that cannot be drawn — a 6A rocker and a 20A rocker are the same
          mark — and on a plate with both on it, which is the plate this is for,
          it is the only way to tell them apart. */}
      {p.amps != null && (
        <text x={x + w / 2} y={PAD + H - 5} textAnchor="middle"
              fill={lit ? ground : STROKE} fillOpacity={lit ? 0.85 : 0.75}
              fontSize={8} style={{ fontFamily: 'inherit' }}>{p.amps}A</text>
      )}
      {/* THE HIT TARGET, AND IT HAS TO BE ITS OWN RECTANGLE. The module above is
          `fill="none"` while it is not picked, and a path with no fill is not
          clickable in its interior — so without this you could only press a
          module on its 1.4px outline, and only when it happened to be the
          selected one. */}
      {(onPick || onGrab) && (
        <rect x={x} y={PAD} width={w} height={H} fill="transparent"
          style={{ cursor: onGrab ? 'grab' : 'pointer' }}
          /* ONE TARGET, TWO GESTURES, AND THE DRAG DECIDES WHICH. A press that
             goes nowhere is a pick; a press that travels is a move. The
             alternative — a separate handle to drag by — would put a second
             target inside a module fourteen pixels wide. */
          onPointerDown={onGrab ?? undefined}
          onClick={onPick ?? undefined}>
          {/* THE ONE PIECE OF TEXT ON THIS DRAWING, and it is the accessible name
              rather than a tooltip: `what` is what the flow calls itself —
              "Downlights", "Fan", "16A socket" — so a screen reader gets the
              connection the colour is making for everyone else. */}
          <title>{p.what || p.label}</title>
        </rect>
      )}
    </>
  );
}

/**
 * ONE FRAME: the plate, and the devices in it.
 *
 * EXPORTED, because the sheet draws the same thing. Two implementations of "what
 * a six-module plate looks like" would be two drawings of one part, and the day
 * one of them learned about a new module the other would not.
 */
export function BoardFrame({ board, ink = PANEL_INK, ground = PANEL_GROUND,
                             selectedFlowId = null, highlightKey = null,
                             onPickFlow = null, onReorder = null }) {
  const STROKE = ink;
  const n = board.points.length;
  const inner = board.size * W + Math.max(0, n - 1) * G;
  const vw = inner + PAD * 2;
  const vh = H + PAD * 2;
  const svgRef = React.useRef(null);
  /* THE DRAG, HELD HERE AND NOT LIFTED TO THE CALLER. `{ key, from, at, over }`
     — which unit is in the air, where it started in viewBox units, where the
     pointer is now, and which slot it would land in. It is local because nothing
     outside this drawing needs to know a module is mid-flight: the ORDER is the
     caller's, and it is told once, on release. */
  const [drag, setDrag] = React.useState(null);

  /* --- NO TEXT SELECTION WHILE A MODULE IS BEING DRAGGED -------------------
     A POINTERDOWN ON A DRAWING IS STILL A POINTERDOWN ON A DOCUMENT. The browser
     starts a text selection from wherever the press lands and extends it across
     whatever the pointer crosses — so dragging a switch painted the rating
     labels, and then the tally and the headings beside them, in the system's
     selection blue. The drag worked; it just left a trail.

     TWO PLACES, BECAUSE THE SELECTION HAS TWO HALVES. `userSelect: none` on the
     svg below stops one STARTING here, which is the whole fix on its own for a
     press that never leaves the frame. The body rule covers the rest: once the
     pointer is captured it travels over the panel, and a selection that began
     before this component saw the event has to be denied somewhere higher up.

     ONLY WHILE DRAGGING, AND PUT BACK AFTERWARDS. Making the panel permanently
     unselectable would be paying for a drag with the ability to copy a number
     out of the schedule beside it. The previous value is restored rather than
     cleared, so this cannot stamp on somebody else's rule. */
  const dragging = !!drag;
  React.useEffect(() => {
    if (!dragging) return undefined;
    const b = document.body;
    const was = b.style.userSelect;
    const wasWebkit = b.style.webkitUserSelect;
    b.style.userSelect = 'none';
    b.style.webkitUserSelect = 'none';
    return () => { b.style.userSelect = was; b.style.webkitUserSelect = wasWebkit; };
  }, [dragging]);

  /* --- THE FRAME'S CONTENTS, AS UNITS AND THEN AS BLANKS -------------------
     A PAIR MOVES AS A PAIR — that is the whole requirement — so what is laid
     out, dragged and animated is never a module, it is the run of modules
     sharing a `unitKey`. Blanks carry none: a blank is what is LEFT of the
     frame rather than part of the arrangement, so it is not draggable and it
     never moves. It cannot: reordering permutes units and permuting them cannot
     change their total width, so the blanks always begin at the same place. */
  const units = [];
  const blanks = [];
  for (const p of board.points) {
    if (!p.unitKey) { blanks.push(p); continue; }
    const last = units[units.length - 1];
    if (last && last.key === p.unitKey) last.points.push(p);
    else units.push({ key: p.unitKey, index: p.unitIndex, points: [p] });
  }
  for (const u of units) {
    u.w = u.points.reduce((t, p) => t + p.modules * W, 0) + (u.points.length - 1) * G;
  }

  /**
   * WHERE EACH UNIT SITS, GIVEN AN ORDER OF THEM.
   *
   * A FUNCTION AND NOT A FIELD, because it is asked twice: once for where things
   * ARE (the board's own order) and once for where they WOULD BE if the finger
   * came up now. The difference between those two answers is the animation.
   */
  const place = (list) => {
    const at = new Map();
    let x = PAD;
    for (const u of list) { at.set(u.key, x); x += u.w + G; }
    return { at, end: x };
  };
  const base = place(units);

  /* THE ORDER AS IT WOULD BE ON RELEASE. Everything except the unit in the air
     is drawn HERE rather than where it is now, and a CSS transition on the
     translate does the rest — so the plate opens a gap for what is coming and
     closes the one it left, continuously, while the finger is still down.
     `over` IS AN INDEX INTO THE WHOLE COMPOSITION, not into this frame, so the
     insertion point is found by comparing against the global index each unit
     came out with. See `slotAt`, and `reorderBoardUnit` in App.jsx, which does
     the same arithmetic on the same numbers when it commits. */
  const preview = (() => {
    if (!drag?.moved || drag.over == null) return units;
    const me = units.find((u) => u.key === drag.key);
    if (!me) return units;
    const rest = units.filter((u) => u.key !== drag.key);
    const pos = rest.findIndex((u) => u.index >= drag.over);
    rest.splice(pos < 0 ? rest.length : pos, 0, me);
    return rest;
  })();
  const now = place(preview);

  /** Client x -> this drawing's own units. The svg is scaled to its column. */
  const toVx = (clientX) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r?.width) return 0;
    return ((clientX - r.left) / r.width) * vw;
  };

  /* WHICH SLOT THE POINTER IS OVER, as an index into the WHOLE composition's
     units and not into this frame's. A position past a country's largest frame
     is two frames, and dragging inside the second of them still means moving a
     unit within one arrangement. Each unit carries the global index it came out
     with, so the answer is read off the unit under the pointer rather than
     counted here.
     MEASURED AGAINST WHERE THINGS ARE NOW AND NOT WHERE THEY STARTED, or the
     preview would fight itself: the gap opens, the units under the pointer move,
     and a reading taken against their old places would flip the answer back and
     forth as they slid past. */
  const slotAt = (vx) => {
    let best = null;
    for (const u of preview) {
      if (u.key === drag?.key) continue;
      const mid = (now.at.get(u.key) ?? 0) + u.w / 2;
      if (best == null || Math.abs(vx - mid) < Math.abs(vx - best.mid)) {
        best = { mid, index: u.index + (vx > mid ? 1 : 0) };
      }
    }
    return best?.index ?? null;
  };

  const start = (e, key) => {
    if (!onReorder) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const vx = toVx(e.clientX);
    setDrag({ key, from: vx, at: vx, over: null, moved: false });
  };
  const move = (e) => {
    if (!drag) return;
    const vx = toVx(e.clientX);
    // A FEW UNITS OF SLOP, so a press that wobbles is still a press. Without it
    // every click on a module would also be a reorder of zero distance, and the
    // plate would be marked as arranged by hand for the life of the plan.
    const moved = drag.moved || Math.abs(vx - drag.from) > W * 0.4;
    setDrag((d) => (d ? { ...d, at: vx, moved, over: moved ? slotAt(vx) : null } : d));
  };
  /* THE DROP, AND THE LANDING ANIMATES BECAUSE OF WHAT REACT DOES WITH THESE
     TWO CALLS. `onReorder` sets the order in the caller and `setDrag(null)`
     clears the flight, both inside one event handler — so React batches them and
     the next render has the NEW order with no drag in it. The unit's `<g>` is
     keyed by its unit key, so it is the same DOM node either side of that
     render: its transform goes from "where the finger left it" to "where it now
     belongs", and the transition below carries it there. Clearing the drag in a
     separate tick would show one frame of the unit snapped back to where it
     started, which is the flicker this ordering avoids. */
  const end = () => {
    if (!drag) return;
    if (drag.moved && drag.over != null) onReorder?.(drag.key, drag.over);
    setDrag(null);
  };

  return (
    <svg ref={svgRef} viewBox={`0 0 ${vw} ${vh}`} width="100%" role="img"
         style={{ maxWidth: `${vw}px`, display: 'block',
                  /* NOTHING IN THIS DRAWING IS TEXT ANYBODY COPIES — the ratings
                     are labels on a picture, and the words are in the tally
                     underneath. So the selection is refused outright here rather
                     than only while a drag is live: a press that starts on a
                     module should never begin one, dragged or not. */
                  userSelect: 'none', WebkitUserSelect: 'none',
                  touchAction: drag ? 'none' : undefined }}
         onPointerMove={move} onPointerUp={end} onPointerCancel={end}
         aria-label={`${board.size} ${board.size === 1 ? board.unit : board.units}`}>
      {/* THE PLATE, which is the thing screwed to the wall and the reason the
          devices have a margin round them at all. Half-opacity so the modules
          read as the content and the frame as the edge. */}
      <rect x={0.7} y={0.7} width={vw - 1.4} height={vh - 1.4} rx={5}
            fill="none" stroke={STROKE} strokeOpacity={0.45} strokeWidth={1.4} />

      {/* THE UNITS, EACH TRANSLATED INTO ITS PLACE.
          A TRANSFORM AND NOT AN `x` ATTRIBUTE, and that is the whole animation:
          an attribute jumps and a CSS transform transitions. Each unit's modules
          are drawn at offsets from zero and the `<g>` carries the position, so
          there is exactly one number per unit for the browser to interpolate.
          KEYED BY THE UNIT and not by its position, so React keeps one DOM node
          per pair across a reorder — a node that is destroyed and rebuilt has
          nothing to animate FROM. */}
      {units.map((u) => {
        const flying = !!drag?.moved && drag.key === u.key;
        const x = flying
          ? (base.at.get(u.key) ?? 0) + (drag.at - drag.from)
          : (now.at.get(u.key) ?? 0);
        let off = 0;
        return (
          <g key={u.key}
            style={{
              transform: `translate(${x - PAD}px, 0px)`,
              // NO TRANSITION ON THE ONE IN THE AIR. It is following a finger,
              // and a hundred and forty milliseconds of easing between the
              // pointer and the thing under it is the definition of lag.
              transition: flying ? 'none' : 'transform 150ms cubic-bezier(.2,.7,.3,1)',
              pointerEvents: flying ? 'none' : undefined,
            }}
            opacity={flying ? 0.85 : 1}>
            {u.points.map((p, k) => {
              /* IS THIS MODULE ON THE WIRE THAT IS PICKED? By `flowId`, which
                 every module made from a flow carries — so a FAN lights both of
                 its modules at once (the switch and the regulator are one flow)
                 and that is right rather than incidental: they are one thing you
                 operate.
                 OR IS IT THE ONE JUST MOVED? `highlightKey` is by UNIT, which is
                 what a unit with no wire needs — the spare socket and its switch
                 are on no flow at all, and dropping one somewhere has to leave it
                 visibly where it was dropped. */
              const lit = (!!p.flowId && p.flowId === selectedFlowId)
                || (!!p.unitKey && p.unitKey === highlightKey);
              const at = PAD + off;
              off += p.modules * W + G;
              return (
                <Module key={k} p={p} x={at} lit={lit} ink={STROKE} ground={ground}
                  onPick={p.flowId && onPickFlow && !drag?.moved
                    ? () => onPickFlow(p.flowId) : null}
                  onGrab={onReorder ? (e) => start(e, u.key) : null} />
              );
            })}
          </g>
        );
      })}

      {/* AND THE BLANKS, WHICH NEVER MOVE. They sit after every unit, and a
          permutation of the units cannot change their total width — so the
          blanks begin at the same place whatever the arrangement, and drawing
          them outside the animated group says so. */}
      {blanks.map((p, k) => (
        <Module key={`b${k}`} p={p} x={base.end + k * (W + G)} lit={false}
          ink={STROKE} ground={ground} />
      ))}
    </svg>
  );
}

/**
 * HOW HIGH OFF THE FINISHED FLOOR, IN MILLIMETRES — and it is an input, because
 * the number is a decision rather than a derivation.
 *
 * THE ONE THING ABOUT A SWITCHBOARD A PLAN VIEW CANNOT SHOW. A plate is a
 * rectangle on a wall from above whether it is at 300 or at 1200, and the
 * difference is the difference between a socket and a switch. The rules have a
 * default per role — see SB_HEIGHT_MM in electrical.js — and a default is all it
 * can be: 1200 is switch height in most of the world and 1100 in some offices,
 * and the person drawing knows which.
 *
 * `type="number"` AND NOT A TEXT BOX, so a phone gets a numeric keypad and the
 * arrows work. `step={50}` because nobody sets a socket to 317mm, and the
 * browser's own steppers then land on numbers a site would build to.
 *
 * IT COMMITS ON CHANGE AND NOT ON BLUR, so the drawing and the schedule follow
 * the number as it is typed — the same rule everything else editable in this app
 * follows. An empty box is not zero and is not written: it is somebody half way
 * through typing 1200, and writing 0 on the way past would put a plate on the
 * floor for one keystroke.
 *
 * SHARED BY THE PANEL AND THE SHEET, which is the reason it is exported rather
 * than written inline twice — two number boxes for one number is two places for
 * the step, the units and the empty-string rule to drift.
 */
export function HeightField({ mm, onChange, ink = 'currentColor' }) {
  return (
    <span className="inline-flex items-baseline gap-1 text-[11.5px] tabular-nums"
      style={{ color: ink }}>
      <input type="number" min={0} max={3000} step={50}
        value={Number.isFinite(mm) ? mm : ''}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '') return;
          const n = Number(v);
          if (Number.isFinite(n)) onChange(Math.max(0, Math.min(3000, Math.round(n))));
        }}
        aria-label="Height above finished floor level, in millimetres"
        className="w-[52px] bg-transparent border-0 border-b border-current/40
          px-0 py-0 text-right tabular-nums text-[11.5px] leading-none
          focus:outline-none focus:border-current
          [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none
          [&::-webkit-outer-spin-button]:appearance-none"
        style={{ color: 'inherit' }} />
      <span className="opacity-70">mm above FFL</span>
    </span>
  );
}

/**
 * `composition` is composeSwitchboard's answer. `onRemove(extraId)` is offered
 * only where there is something to remove — see the note in App.jsx about a
 * read-only sheet, where every control on this card is absent rather than inert.
 */
export default function SwitchboardCard({ composition, extras = [], onRemove = null,
                                          selectedFlowId = null, onPickFlow = null,
                                          onReorder = null }) {
  /* THE ONE JUST MOVED STAYS LIT, and it is held HERE rather than in the frame
     below for one reason: a plate past a country's largest frame is two frames,
     and a unit dragged out of the first into the second must stay marked when it
     gets there. State inside a frame would light the wrong drawing.

     A UNIT KEY AND NOT A FLOW ID, because half the things on a plate are on no
     wire at all — the spare socket and its switch, a data point somebody added —
     and dropping one of those has to leave it visibly where it was dropped just
     as much as a switch does.

     AND IT IS CLEARED BY PICKING SOMETHING ELSE. "What I just moved" and "what I
     have selected" are the same slot in a reader's head; two things lit at once
     would be the panel pointing in two directions. */
  const [movedKey, setMovedKey] = React.useState(null);
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
          <BoardFrame board={b} selectedFlowId={selectedFlowId}
            highlightKey={movedKey}
            onPickFlow={onPickFlow
              ? (id) => { setMovedKey(null); onPickFlow(id); } : null}
            onReorder={onReorder
              ? (key, to) => { setMovedKey(key); onReorder(key, to); } : null} />
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
        {/* WHERE ITS SWITCH IS, for the one plate that has none of its own. The
            card would otherwise be describing a socket with nothing to turn it
            on, which is either a mistake or a rule somebody has to be told
            about — and it is the second. Drag the outlet's wire onto another
            board and this line follows it, because both are read off the flow. */}
        {composition.outlet && (
          <> · switched from{' '}
            <b className="text-text font-normal">
              {composition.switchedFrom
                ? `the ${composition.switchedFrom.toLowerCase()} board`
                : 'no board yet'}
            </b>
          </>
        )}
      </p>
    </div>
  );
}
