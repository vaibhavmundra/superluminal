// ---------------------------------------------------------------------------
// FixtureTip — what a fitting is, under the cursor.
//
// AN HTML CARD AND NOT AN SVG ONE, and that is forced rather than chosen. The
// effect asked for is frosted glass, which is `backdrop-filter`, which needs a
// real element in the document — SVG has `filter` but nothing that samples what
// is painted behind it. It also has to be able to leave the canvas: a fitting
// near the right edge wants its card over the panel, and anything drawn inside
// the <svg> is clipped to the drawing.
//
// SO IT IS POSITIONED IN VIEWPORT COORDINATES, from the pointer event that
// raised it. The canvas is inside a pan/zoom wrapper whose transform this file
// would otherwise have to reproduce to place a card over a fitting, and
// reproducing a transform is how a tooltip ends up three inches from the thing
// it describes at 180% zoom. `position: fixed` plus clientX/clientY is exempt
// from all of it.
//
// AND IT FLIPS RATHER THAN OVERFLOWS. Near the right edge it hangs off the left
// of the cursor, near the bottom it sits above — measured against the real
// viewport, because the alternative is a card whose right half is off screen
// and unreadable exactly where the panel is.
// ---------------------------------------------------------------------------

const OFF = 16;          // clearance from the pointer, so the card never sits under it
const W = 260, H = 150;  // the card's own maximums, for the flip test

export default function FixtureTip({ tip }) {
  if (!tip) return null;

  const vw = typeof window === 'undefined' ? 1200 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const flipX = tip.x + OFF + W > vw - 8;
  const flipY = tip.y + OFF + H > vh - 8;

  return (
    <div
      /* The blur IS the effect and the rgba fallback is for anywhere it is
         unsupported — hence a real alpha rather than a token. See the note this
         replaces in styles.css. */
      className="fixed z-40 pointer-events-none min-w-[172px] max-w-[260px]
        pt-2.5 px-3 pb-[9px] rounded-lg bg-white/[0.72]
        backdrop-saturate-[1.8] backdrop-blur-[18px] border border-black/[0.09]
        shadow-[0_8px_26px_rgba(10,10,10,.14),0_1px_2px_rgba(10,10,10,.08)]
        animate-[tip-in_.11s_ease-out] motion-reduce:animate-none"
      role="tooltip"
      style={{
        left: flipX ? undefined : tip.x + OFF,
        right: flipX ? Math.max(8, vw - tip.x + OFF) : undefined,
        top: flipY ? undefined : tip.y + OFF,
        bottom: flipY ? Math.max(8, vh - tip.y + OFF) : undefined,
      }}>
      <h4 className="m-0 mb-[7px] text-xs text-ink tracking-[-0.01em] leading-[1.25]">{tip.label}</h4>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-[3px]">
        {tip.rows.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt className="text-[11px] text-muted whitespace-nowrap">{k}</dt>
            <dd className="m-0 font-sans text-[11px] text-ink text-right tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {tip.note && (
        <p className="mt-2 pt-[7px] border-t border-black/[0.08] text-[10.5px] leading-[1.4] text-subtle">
          {tip.note}
        </p>
      )}
    </div>
  );
}
