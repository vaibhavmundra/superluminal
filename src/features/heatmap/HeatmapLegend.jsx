import { HEATMAP_BANDS } from './heatmapTargets.js';
import { useStageRect } from '../../components/StageBar.jsx';
import usePanelDrag from '../../hooks/usePanelDrag.js';
import { PROP_OFF, PROP_ON } from '../../ui/tokens.js';

// ---------------------------------------------------------------------------
// HeatmapLegend — WHICH QUESTION IS BEING ASKED, WHAT THE COLOURS MEAN, WHERE
// THEY ARE MEASURED AND WHAT THEY ARE MEASURED AGAINST.
//
// A KEY IS NOT HELPER TEXT. Every other floating thing on this drawing is
// suppressed on the principle that a control is its label — and a five-colour
// scale has no label it can be. Without the target figure the colours say
// nothing at all: green is not "bright", it is "within a quarter of 150 lux",
// and 150 is a decision this app made on the space's behalf that the reader is
// entitled to see. So the card carries the bands, the measurement, and the
// target, and stops.
//
// AND SINCE THERE ARE TWO MEASUREMENTS, IT CARRIES THE CHOICE BETWEEN THEM.
// The switch in the bar is still the one visibility control — heatmap on, or
// heatmap off — and this is which heatmap: the estimated illuminance that has
// always been here, or reflected ambient light. It is two chips in the card
// that already names the measurement rather than a third capsule in the bar,
// because the bar's grammar is what the DRAWING SHOWS and this is a detail
// inside one of those things, not another one of them.
//
// THE ONE SENTENCE ABOUT EACH LAYER IS A TOOLTIP AND NOT A PARAGRAPH. What the
// card prints is the measurement, the height and the target, in that order, and
// that is the reading. What a layer EXCLUDES — direct fixture light — is the
// thing a name cannot say and the thing somebody will ask once; it is on the
// chip's `title`, where it costs the card no height.
//
// THE SWATCHES TAKE THE CSS TOKENS DIRECTLY. `var(--color-heatmap-25-75)` in a
// style, off the band table — so the key is painted from the same five
// properties the field is (see colours.js), and there is no path by which the
// drawing and its legend can disagree. It does not go through `readHeatmapPalette`
// because it needs no arithmetic: a band's swatch is its anchor colour, which is
// the token itself. THE BANDS DO NOT CHANGE WITH THE LAYER, and that is the
// point of one scale: green means "within a quarter of what this space is
// aiming at" whichever question is being asked.
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
// pointer behaviour.
// ---------------------------------------------------------------------------

/** Its clearance from the foot and the right edge of the stage. */
const BOTTOM = 26, RIGHT = 18;

/** The target as the legend prints it. A whole number of lux — a heatmap target
 *  quoted to the decimal would claim a precision this approximation has no
 *  business claiming, and it is the reason the target table keeps its full
 *  precision and rounds HERE. 108, 215, 323. */
const lx = (n) => `${Math.round(n)} lx`;

/** A height as a designer writes one: metres to one decimal, because the
 *  control offers 0.8, 1.2 and 1.7 and a probe height quoted to the millimetre
 *  would be claiming the room was measured. */
export const m = (n) => `${(Math.round(n * 10) / 10).toFixed(1)} m`;

/**
 * THE CARD'S SECOND LINE — the measurement, where it is taken, and what it is
 * judged against, in that order. One sentence, because none of the three means
 * anything without the other two: "108 lx" is not a target until you know of
 * what, and "1.2 m" is not a height until you know of which measurement.
 *
 * EXPORTED AND PURE, which is not a testing convenience so much as the only way
 * this line can be checked at all: the card measures itself off the stage and
 * so draws nothing outside a browser. tools/test-heatmap-indirect.mjs asserts
 * the exact string — "Reflected ambient · 1.2 m · Target 108 lx" — against the
 * hook's own output, so the label the reader sees and the field on the drawing
 * are checked as one thing.
 *
 * THE HEIGHT IS THE ONE THE DRAWING ACTUALLY USED and not the one the chips are
 * showing. A 1.1 m loft cannot hold a 1.2 m probe; the card says what it
 * measured and marks that it had to fit it in. See `probeHeightFor`.
 */
export function measurementLine(heatmap) {
  const { focusTarget, distinct = [], plane, layer } = heatmap ?? {};
  const target = focusTarget != null ? lx(focusTarget)
    : distinct.length > 1
      ? `${Math.round(distinct[0])}–${lx(distinct[distinct.length - 1])}`
      : null;
  if (!layer?.probe) {
    return [plane?.label ?? 'Floor level', target ? `target ${target}` : null]
      .filter(Boolean).join(' · ');
  }
  const h = heatmap.probeHeightM ?? (heatmap.probeHeightMm ?? 0) / 1000;
  return [layer.measure, m(h) + (heatmap.probeClamped ? ' (fits room)' : ''),
          target ? `Target ${target}` : null].filter(Boolean).join(' · ');
}

export default function HeatmapLegend({ heatmap, stage }) {
  /* `stage` IS THE SCROLL CONTAINER TO MEASURE OFF, handed in rather than
     reached for: it is App's ref, shared with the bar and the coach card, and a
     second way of finding it is a second thing to keep in step. */
  const box = useStageRect(stage);
  const drag = usePanelDrag();
  if (!heatmap?.on || !heatmap.rooms.length || !box) return null;

  const { layer, layers = [], setLayer,
          probeHeights = [], probeHeightMm, setProbeHeightMm } = heatmap;
  const indirect = !!layer?.probe;
  /* ONE FIGURE WHERE THE PLAN HAS ONE, AND A RANGE WHERE IT DOES NOT — a flat
     holds a bedroom at 100 and a kitchen at 300, and a key claiming either one
     over the whole sheet would be wrong about most of it. All of that is in
     `measurementLine` above, which is where it can be checked. */
  const measured = measurementLine(heatmap);

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
        <div className="text-[11px] leading-none text-text tracking-[-0.01em]">
          {layer?.label ?? 'Estimated illuminance'}
        </div>
        {/* THE MEASUREMENT, WHERE IT IS TAKEN AND WHAT IT IS JUDGED AGAINST, on
            one line, because they are one sentence and none of the three means
            anything without the other two. */}
        <div className="mt-1 text-[10px] leading-[1.35] text-subtle">
          {measured}
        </div>

        {/* --- WHICH MEASUREMENT ---------------------------------------------
            `PROP_ON`/`PROP_OFF` — the app's own compact segmented chip, the
            same pair the switchboard's ratings wear. Two `flex-1` chips split
            the card's width, which is what makes this read as one control with
            two states rather than as two buttons. */}
        {layers.length > 1 && (
          <div className="flex gap-1 mt-2" role="group" aria-label="Heatmap layer">
            {layers.map((l) => (
              <button key={l.id} type="button" title={l.note}
                aria-pressed={l.id === layer?.id}
                className={l.id === layer?.id ? PROP_ON : PROP_OFF}
                onClick={() => setLayer?.(l.id)}>
                {l.short}
              </button>
            ))}
          </div>
        )}

        {/* --- AND AT WHAT HEIGHT, WHERE THE LAYER HAS ONE -------------------
            ONLY ON THE LAYER THAT HAS A PROBE. The horizontal layer measures on
            a fixed plane and offering to move it here would be offering a
            control that does nothing — see HEATMAP_PLANE, which is a table
            entry and a legend field for exactly the day it becomes adjustable.
            THE SAME CHIPS AS THE ROW ABOVE, because it is the same kind of
            question: one of a short list, and the answer is on the drawing. */}
        {indirect && probeHeights.length > 1 && (
          <div className="flex gap-1 mt-1" role="group" aria-label="Measurement height">
            {probeHeights.map((mm) => (
              <button key={mm} type="button"
                aria-pressed={mm === probeHeightMm}
                className={mm === probeHeightMm ? PROP_ON : PROP_OFF}
                onClick={() => setProbeHeightMm?.(mm)}>
                {m(mm / 1000)}
              </button>
            ))}
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
                {b.id === '75-125' && (
                  <span className="ml-0.5 text-[8px] tracking-[0.04em] text-muted">
                    (Recommended)
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
        {/* "ABOVE TARGET" AND NOT "TOO BRIGHT". A room over its figure is a design
            decision — a bright kitchen, a gallery wall, a hotel lobby at night —
            and the two warm bands are a statement about a ratio, not a verdict on
            a scheme. The one word the card will not use is a failure. */}
        <div className="mt-2 pt-[7px] border-t border-white/[0.08]
          text-[10px] leading-[1.35] text-subtle">
          Warm bands are above target.
        </div>
      </div>
    </div>
  );
}
