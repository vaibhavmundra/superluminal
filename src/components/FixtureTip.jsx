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
    <div className="fixture-tip" role="tooltip"
      style={{
        left: flipX ? undefined : tip.x + OFF,
        right: flipX ? Math.max(8, vw - tip.x + OFF) : undefined,
        top: flipY ? undefined : tip.y + OFF,
        bottom: flipY ? Math.max(8, vh - tip.y + OFF) : undefined,
      }}>
      <h4>{tip.label}</h4>
      <dl>
        {tip.rows.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt>{k}</dt><dd>{v}</dd>
          </div>
        ))}
      </dl>
      {tip.note && <p>{tip.note}</p>}
    </div>
  );
}
