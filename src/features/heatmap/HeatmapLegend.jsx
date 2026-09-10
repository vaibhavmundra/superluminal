import { HEATMAP_BANDS } from './heatmapTargets.js';
import { useStageRect } from '../../components/StageBar.jsx';

// ---------------------------------------------------------------------------
// HeatmapLegend — WHAT THE COLOURS MEAN, THE PLANE THEY ARE MEASURED ON, AND
// THE FIGURE THEY ARE MEASURED AGAINST.
//
// A KEY IS NOT HELPER TEXT. Every other floating thing on this drawing is
// suppressed on the principle that a control is its label — and a five-colour
// scale has no label it can be. Without the target figure the colours say
// nothing at all: green is not "bright", it is "within a quarter of 150 lux",
// and 150 is a decision this app made on the space's behalf that the reader is
// entitled to see. So the card carries exactly three things and stops: the
// bands, the plane, and the target.
//
// THE SWATCHES TAKE THE CSS TOKENS DIRECTLY. `var(--color-heatmap-25-75)` in a
// style, off the band table — so the key is painted from the same five
// properties the field is (see colours.js), and there is no path by which the
// drawing and its legend can disagree. It does not go through `readHeatmapPalette`
// because it needs no arithmetic: a band's swatch is its anchor colour, which is
// the token itself.
//
// BOTTOM LEFT OF THE STAGE, measured off it the way StageBar and OptionCoach
// are and for their reasons — the stage is a scroll container, so an absolutely
// positioned child scrolls away with the drawing, and anything inside the <svg>
// would be scaled by the zoom. The bar itself is bottom CENTRE; this sits clear
// of it on the left.
// ---------------------------------------------------------------------------

/** Its clearance from the foot and the left edge of the stage. */
const BOTTOM = 26, LEFT = 18;

/** The target as the legend prints it. A whole number of lux — a heatmap target
 *  quoted to the decimal would claim a precision this approximation has no
 *  business claiming. */
const lx = (n) => `${Math.round(n)} lx`;

export default function HeatmapLegend({ heatmap, stage }) {
  /* `stage` IS THE SCROLL CONTAINER TO MEASURE OFF, handed in rather than
     reached for: it is App's ref, shared with the bar and the coach card, and a
     second way of finding it is a second thing to keep in step. */
  const box = useStageRect(stage);
  if (!heatmap?.on || !heatmap.rooms.length || !box) return null;

  const { focusTarget, distinct = [], plane } = heatmap;
  /* ONE FIGURE WHERE THE PLAN HAS ONE, AND A RANGE WHERE IT DOES NOT. A flat
     holds a bedroom at 100 and a kitchen at 300, and a key claiming either one
     over the whole sheet would be wrong about most of it. `focusTarget` is the
     open space's own figure where a space is open, which is the common case and
     the useful one; the range is the honest fallback. */
  const target = focusTarget != null ? lx(focusTarget)
    : distinct.length > 1 ? `${Math.round(distinct[0])}–${lx(distinct[distinct.length - 1])}`
    : null;

  return (
    <div
      className="fixed z-30 rounded-lg bg-panel shadow-[0_10px_34px_rgba(0,0,0,0.55)]
        px-3 py-2.5 w-[190px] select-none"
      style={{ left: box.left + LEFT,
               bottom: Math.max(12, window.innerHeight - box.bottom + BOTTOM) }}
      /* THE CARD MUST NOT START A GESTURE ON THE PLAN — StageBar's own rule, and
         its reason: the click that clears the selection is on the document, so a
         press here would deselect whatever the reader is looking at. */
      onPointerDown={(e) => e.stopPropagation()}
      aria-label="Heatmap key">
      <div className="text-[11px] leading-none text-text tracking-[-0.01em]">
        Estimated illuminance
      </div>
      {/* THE PLANE AND THE TARGET ON ONE LINE, because they are one sentence:
          this is horizontal lux at floor level, judged against this figure. Both
          are stated because neither means anything without the other. */}
      <div className="mt-1 text-[10px] leading-[1.35] text-subtle">
        {plane?.label ?? 'Floor level'}{target ? ` · target ${target}` : ''}
      </div>
      <ul className="list-none m-0 mt-2 p-0 grid gap-[3px]">
        {HEATMAP_BANDS.map((b) => (
          <li key={b.id} className="flex items-center gap-2">
            <span aria-hidden="true"
              className="flex-none w-[18px] h-[9px] rounded-[2px]"
              style={{ background: `var(${b.token})` }} />
            <span className="text-[10px] leading-none text-muted tabular-nums">
              {b.label}
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
  );
}
