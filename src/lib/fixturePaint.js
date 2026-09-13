// ---------------------------------------------------------------------------
// fixturePaint.js — WHAT A FITTING IS PAINTED WITH. And the colours are not in
// here.
//
// THE VALUES LIVE IN src/styles.css, in the `:root` block, as
// `--lp-fixture-fill` and its siblings. This file resolves them off the document
// once per canvas; it holds no hex string that the drawing ever uses, and that
// is the point rather than a nicety. The fittings' palette used to be two ramps
// in src/lib/settings.js duplicated by hand from `--accent-stops` in the
// stylesheet, with a comment on both copies asking the next person to keep them
// in step. They are flat colours now, so there is nothing left to duplicate.
//
// WHY THE RAMPS COULD NOT DO THIS AND THESE CAN. An SVG shape cannot be filled
// from a CSS `linear-gradient()` — it needs a real `<linearGradient>` with real
// `<stop>`s — so a gradient authored in a stylesheet has to be re-typed as
// markup wherever it is used. A FLAT colour has no such problem: it is a string,
// and a string read off the document at runtime is the same string the
// stylesheet says. Same trick, same reasoning and the same shape of code as
// `readHeatmapPalette` in src/features/heatmap/colours.js, which is worth
// reading alongside this.
//
// THE HAIRLINE IS IN HERE TOO, and it is not a colour. It is the cap on how fat
// any stroke on the plan is allowed to get, in CSS pixels ON SCREEN, and it
// belongs with the paint for one reason: it is the other half of the same
// decision. "White body, black edge" is only a drawing if the edge is a
// hairline; at four pixels it is a black ring with some white in it.
// ---------------------------------------------------------------------------

/**
 * THE TOKEN NAMES, ONCE. Named here rather than spelled into the reader so that
 * a rename in the stylesheet is a rename in one place, and so that anything that
 * wants to offer these for editing has the list without parsing CSS.
 */
export const FIXTURE_PAINT_TOKENS = {
  fill: '--lp-fixture-fill',
  ink: '--lp-fixture-ink',
  glow: '--lp-fixture-glow',
  tape: '--lp-fixture-tape',
  led: '--lp-fixture-led',
  /* THE TWO DOTTED RINGS. Not `--lp-fixture-*` names, because neither is a
     fitting's own body: one is the floor a COB claims to cover, the other the
     floor a fan refuses to let one land on. See the note beside them in
     styles.css for why they are two tokens and not one. */
  beam: '--lp-beam-angle-stroke',
  clearance: '--lp-clearance-stroke',
};

/** Not a colour, and not in drawing units: CSS pixels on screen. */
export const HAIRLINE_TOKEN = '--lp-hairline-px';

/**
 * WHAT IS DRAWN WHEN THERE IS NO DOCUMENT TO READ, and why this is a copy and
 * not a second palette.
 *
 * `readHeatmapPalette` returns `null` off-document and its callers draw nothing,
 * which is right for an overlay: a heatmap that cannot find its scale should be
 * absent rather than wrong. A FITTING cannot take that answer. The canvas is
 * rendered headlessly by tools/test-render.mjs — that file exists because a
 * temporal-dead-zone crash in this component once reached the browser — and a
 * canvas that draws invisible fittings under test is a canvas the test cannot
 * speak for.
 *
 * So these exist, and they are deliberately the SEMANTIC values rather than
 * a spare palette: white body, black line work, at one pixel. If the stylesheet
 * is edited to something else, the browser follows the stylesheet and only the
 * headless render falls back here — which is the one place where "what a fitting
 * is" matters and "which white" does not.
 */
export const FIXTURE_PAINT_OFF_DOCUMENT = Object.freeze({
  fill: '#FFFFFF',
  ink: '#000000',
  glow: '#FFFFFF',
  tape: '#FFFFFF',
  led: '#000000',
  beam: '#FFFFFF',
  clearance: '#FFFFFF',
  hairlinePx: 1,
});

/**
 * Every token above, read off the root element — which is where the `:root`
 * block puts them.
 *
 * IT IS A REAL STYLE READ and costs a layout query, so it is done ONCE per
 * canvas and passed down, never once per fitting. See the `useState` lazy
 * initialiser in PlanCanvas: the stylesheet is static for the life of the page,
 * so re-reading on every render would buy nothing.
 *
 * A MISSING OR UNPARSEABLE TOKEN FALLS BACK PER FIELD rather than failing the
 * whole read. Deleting one line from the stylesheet should cost you that one
 * colour, not every fitting on the sheet.
 */
export function readFixturePaint(root = null) {
  const el = root
    ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (!el || typeof getComputedStyle !== 'function') {
    return { ...FIXTURE_PAINT_OFF_DOCUMENT };
  }
  const cs = getComputedStyle(el);
  const paint = {};
  for (const [key, token] of Object.entries(FIXTURE_PAINT_TOKENS)) {
    const raw = cs.getPropertyValue(token).trim();
    paint[key] = raw || FIXTURE_PAINT_OFF_DOCUMENT[key];
  }
  paint.hairlinePx = hairlineFrom(cs.getPropertyValue(HAIRLINE_TOKEN));
  return paint;
}

/**
 * THE CAP AS A NUMBER, AND IT IS CLAMPED. A `0` here would make every stroke on
 * the drawing vanish and would look like a rendering bug rather than a typo, and
 * a token someone has written as `1px` should mean what it plainly says. So the
 * unit is tolerated, nonsense falls back, and the floor is a quarter pixel —
 * thin enough for any sheet, still visible.
 */
export function hairlineFrom(raw) {
  const n = parseFloat(String(raw || '').trim());
  if (!Number.isFinite(n) || n <= 0) return FIXTURE_PAINT_OFF_DOCUMENT.hairlinePx;
  return Math.max(0.25, n);
}
