import { HEATMAP_BANDS } from './heatmapTargets.js';
import { useStageRect } from '../../components/StageBar.jsx';
import usePanelDrag from '../../hooks/usePanelDrag.js';
import { PROP_OFF, PROP_ON } from '../../ui/tokens.js';

// ---------------------------------------------------------------------------
// HeatmapLegend — WHICH READING IS ON SCREEN, WHERE IT IS TAKEN, WHAT THE OPEN
// SPACE IS AIMING AT, AND WHAT THE COLOURS MEAN. In that order, with one
// control: the two chips that choose between the readings.
//
// A KEY IS NOT HELPER TEXT. Every other floating thing on this drawing is
// suppressed on the principle that a control is its label — and a five-colour
// scale has no label it can be. So this one exists, and it is held to the same
// rule: it says what is being measured and what each colour is, and stops.
//
// --- ONE CONTROL, AND IT IS TWO CHIPS RATHER THAN THE SIX IT ONCE WAS -----
// THE CARD CARRIED A THREE-CHIP LAYER SELECTOR AND A THREE-CHIP HEIGHT
// CONTROL, and together they made a reader choose a photometric convention
// AND a measurement plane before the drawing meant anything — a lot to ask of
// somebody who came to lay out lights. Both were cut, and the blend was left
// as the single answer.
//
// WHAT THAT LOST IS THE FLOOR READING, which is the one a lighting drawing is
// actually judged on: horizontal lux is what a meter reads, what a standard is
// written in and what a client asks about. The blend is a fuller picture of the
// room and is not that figure, and somebody laying out fittings wants both, at
// different moments.
//
// SO THE LAYER CHIPS ARE BACK AND THE HEIGHT CHIPS ARE NOT. The two are not
// the same kind of question: which reading you are taking is a question with an
// answer on the drawing, where the height a probe stands at is a convention to
// settle once. `PROBE_HEIGHT_MM` stays a constant; see useHeatmapLayer.js.
//
// WHICH CHIPS EXIST IS THE TABLE'S DECISION AND NOT THIS FILE'S — see `pick`
// in heatmapTargets.js. The card draws whatever it is handed and draws NO
// control at all when there is one entry, so cutting back to a single reading
// removes the selector rather than leaving a chip that does nothing.
//
// --- THE TARGET IS NOT A CONTROL AND IT STAYS ------------------------------
// IT WENT WITH THE CONTROLS FOR ONE REVISION AND THAT WAS WRONG. The five
// bands are percentages OF the space's own target, so a card that does not
// say what the target is has printed five percentages of nothing. And the
// figure is not one figure: a kitchen is aiming at twice what a bedroom is —
// see REFLECTED_AMBIENT_LM_PER_SQFT_BY_ROOM — so the same green means a
// different number of lux in the two rooms of one flat.
//
// SO IT NAMES THE SPACE IT BELONGS TO. `focusId` is which room is open in the
// panel, which is the room you last clicked; the card prints that room's name
// and that room's target, and changes both when you click another. A figure
// that moves without saying whose it is is a figure nobody can check.
//
// THE SWATCHES TAKE THE CSS TOKENS DIRECTLY. `var(--color-heatmap-25-75)` in a
// style, off the band table — so the key is painted from the same five
// properties the field is (see colours.js), and there is no path by which the
// drawing and its legend can disagree. It does not go through
// `readHeatmapPalette` because it needs no arithmetic: a band's swatch is its
// anchor colour, which is the token itself.
//
// BOTTOM RIGHT OF THE STAGE, measured off it the way StageBar and OptionCoach
// are and for their reasons — the stage is a scroll container, so an absolutely
// positioned child scrolls away with the drawing, and anything inside the <svg>
// would be scaled by the zoom. The bar itself is bottom CENTRE; this sits clear
// of it on the right.
//
// AND IT CAN BE CARRIED, ON THE SAME TERMS AS THE ANALYSIS WINDOW. The grip is
// the only drag target, the body remains readable, the panel stays reachable at
// every viewport edge, and double-clicking the grip returns it home. Both use
// usePanelDrag so the two floating panels cannot quietly acquire different
// pointer behaviour. IT IS NOT CONTENT — it is the panel's own affordance, the
// one mark on the card that is not the name or the key.
// ---------------------------------------------------------------------------

/** Its clearance from the foot and the right edge of the stage. */
const BOTTOM = 26, RIGHT = 18;

/** The target as the card prints it. A whole number of lux — a heatmap target
 *  quoted to the decimal would claim a precision this approximation has no
 *  business claiming, and it is the reason the target tables keep their full
 *  precision and round HERE. */
const lx = (n) => `${Math.round(n)} lx`;

/** A height as a designer writes one: metres to one decimal. A probe height
 *  quoted to the millimetre would be claiming the room was measured. */
export const m = (n) => `${(Math.round(n * 10) / 10).toFixed(1)} m`;

/**
 * WHERE THE READING IS TAKEN — a plane on the floor layer, a height on the
 * blend, and nothing at all when neither is known.
 *
 * IT IS ON THE CARD BECAUSE THERE ARE TWO READINGS AGAIN. With one layer the
 * title carried the whole meaning; with two, "Estimated illuminance" and
 * "Estimated light level" are a word apart and describe measurements taken in
 * different places, and a card that does not say where has printed a lux figure
 * of nothing. It is also what the feature was asked for in the first place: a
 * legend explaining the colours AND the measurement plane.
 *
 * THE HEIGHT IS THE ONE THE DRAWING ACTUALLY USED, not the one that was asked
 * for. A 1.1 m loft cannot hold a 1.2 m probe — `probeHeightFor` clamps it into
 * the room — and the card says what it got.
 */
export function whereLine(heatmap) {
  const { plane, probeHeightM } = heatmap ?? {};
  if (plane?.label) return plane.label;
  return Number.isFinite(probeHeightM) ? m(probeHeightM) : null;
}

/**
 * THE CARD'S SECOND LINE: whose target, and what it is.
 *
 * THREE CASES, AND THE THIRD IS THE HONEST ONE. A space is open, so the figure
 * is that space's and is named with it; or nothing is open and every space on
 * the sheet happens to share a figure, so it is printed bare; or nothing is
 * open and they differ, and the card prints the RANGE rather than picking one
 * — a key claiming 133 lx over a plan that also holds a kitchen at 290 would
 * be wrong about most of the drawing.
 *
 * EXPORTED AND PURE, which is not a testing convenience so much as the only
 * way this line can be checked at all: the card measures itself off the stage
 * and so draws nothing outside a browser. tools/test-heatmap-indirect.mjs
 * asserts the exact strings against the hook's own output, so the label the
 * reader sees and the field on the drawing are checked as one thing.
 */
export function targetLine(heatmap) {
  const { focusTarget, focusName, distinct = [] } = heatmap ?? {};
  /* WHERE IT IS MEASURED GOES BETWEEN THE SPACE AND THE FIGURE, because that is
     the order the sentence runs in: whose reading, taken where, judged against
     what. Absent entirely rather than left blank when there is nothing to say. */
  const where = whereLine(heatmap);
  const at = where ? `${where} · ` : '';
  if (focusTarget != null) {
    return focusName
      ? `${focusName} · ${at}Target ${lx(focusTarget)}`
      : `${at}Target ${lx(focusTarget)}`;
  }
  if (distinct.length > 1) {
    return `${at}Target ${Math.round(distinct[0])}–${lx(distinct[distinct.length - 1])}`;
  }
  return where || null;
}

export default function HeatmapLegend({ heatmap, stage }) {
  /* `stage` IS THE SCROLL CONTAINER TO MEASURE OFF, handed in rather than
     reached for: it is App's ref, shared with the bar and the coach card, and a
     second way of finding it is a second thing to keep in step. */
  const box = useStageRect(stage);
  const drag = usePanelDrag();
  if (!heatmap?.on || !heatmap.rooms.length || !box) return null;

  const target = targetLine(heatmap);
  const layers = heatmap.layers ?? [];

  return (
    <div ref={drag.ref}
      data-carry={drag.dragging ? 'true' : 'false'}
      className="fixed z-30 rounded-lg bg-panel shadow-[0_10px_34px_rgba(0,0,0,0.55)]
        w-[220px] select-none overflow-hidden"
      style={{ right: Math.max(12, window.innerWidth - box.right + RIGHT),
               bottom: Math.max(12, window.innerHeight - box.bottom + BOTTOM),
               transform: `translate(${drag.offset.x}px, ${drag.offset.y}px)`,
               transition: drag.dragging ? 'none' : 'transform 150ms ease-out',
               willChange: 'transform' }}
      /* THE CARD MUST NOT START A GESTURE ON THE PLAN — StageBar's own rule, and
         its reason: the click that clears the selection is on the document, so a
         press here would deselect whatever the reader is looking at. */
      onPointerDown={(e) => e.stopPropagation()}
      aria-label="Heatmap key">
      {/* THE SAME SIX-DOT GRIP AS THE ANALYSIS WINDOW. Keeping the mark and its
          reset gesture identical makes both panels announce the same action. */}
      <div {...drag.grip}
        onDoubleClick={drag.moved ? drag.home : undefined}
        className={'flex items-center justify-center h-6 select-none touch-none '
          + (drag.dragging ? 'cursor-grabbing' : 'cursor-grab')}>
        <svg width="26" height="8" viewBox="0 0 26 8" aria-hidden="true"
          className={'transition-opacity duration-150 '
            + (drag.dragging ? 'opacity-70' : 'opacity-35')}>
          {[0, 1].map((row) => [0, 1, 2].map((col) => (
            <circle key={`${row}-${col}`} r="1.4" fill="var(--color-text)"
              cx={4 + col * 9} cy={2.6 + row * 3.4} />
          )))}
        </svg>
      </div>
      <div className="px-3 pb-2.5">
        {/* THE NAME, OFF THE LAYER TABLE. One place decides what the drawing
            shows and what it is called, so the card cannot name a measurement
            the field is not. */}
        <div className="text-[11px] leading-none text-text tracking-[-0.01em]">
          {heatmap.layer?.label ?? 'Estimated light level'}
        </div>
        {/* --- WHICH READING ---------------------------------------------
            `PROP_ON`/`PROP_OFF` — the app's own compact segmented chip, the
            same pair the switchboard's ratings wear. `PROP_SHAPE` already
            carries `flex-1`, so the chips split the card's width between them —
            which is what makes this read as one control with two states rather
            than as two buttons.
            THE SENTENCE ABOUT EACH IS THE CHIP'S `title` AND NOT A LINE ON THE
            CARD, where it would cost height on a panel whose whole job is to be
            small. The words are the layer table's — see `note`.
            DRAWN ONLY WHERE THERE IS A CHOICE. One offered layer is not a
            control, and a single chip that cannot be turned off is a button
            that does nothing. */}
        {layers.length > 1 && (
          <div className="flex gap-1 mt-2" role="group" aria-label="Heatmap reading">
            {layers.map((l) => (
              <button key={l.id} type="button" title={l.note}
                aria-pressed={l.id === heatmap.layer?.id}
                className={l.id === heatmap.layer?.id ? PROP_ON : PROP_OFF}
                onClick={() => heatmap.setLayer?.(l.id)}>
                {l.short}
              </button>
            ))}
          </div>
        )}
        {/* WHOSE TARGET, AND WHAT IT IS. Omitted entirely rather than printed
            empty when there is nothing to say — a plan with no target is a
            plan with no spaces on it, and the card is already gone by then. */}
        {target && (
          <div className="mt-2 text-[10px] leading-[1.35] text-subtle">
            {target}
          </div>
        )}



        <ul className="list-none m-0 mt-2 p-0 grid gap-[3px]">
          {HEATMAP_BANDS.map((b) => (
            <li key={b.id} className="flex items-center gap-2">
              <span aria-hidden="true"
                className="flex-none w-[18px] h-[9px] rounded-[2px]"
                style={{ background: `var(${b.token})` }} />
              <span className="text-[10px] leading-none text-muted tabular-nums">
                {b.label}
                {/* WHICH BAND IS THE ONE TO BE IN. The line above states the
                    target these five are percentages OF; this says which of
                    them is the answer, which the percentages alone do not. */}
                {b.id === '75-125' && (
                  <span className="ml-0.5 text-[8px] tracking-[0.04em] text-muted">
                    (Recommended)
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
