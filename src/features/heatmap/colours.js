// ---------------------------------------------------------------------------
// colours.js — LUX OVER TARGET -> A COLOUR. And the colours are not in here.
//
// THE FIVE VALUES LIVE IN src/styles.css, in the `@theme` block, as
// `--color-heatmap-below-25` and its four siblings. This file resolves them off
// the document once and interpolates between them; it holds no hex string, and
// that is the point rather than a nicety. A heatmap and its legend that hold
// two copies of a palette are a drawing and a key that come to disagree, and
// the disagreement is invisible until somebody edits one of them.
//
// SO THERE IS ONE READER AND TWO CONSUMERS. `readHeatmapPalette` is the reader;
// the overlay and the legend are the consumers, and both take the palette as an
// argument. Which also makes the interpolation testable without a browser: the
// arithmetic is a pure function of the anchors it is handed.
//
// THE SCALE IS ABSOLUTE AND IS NEVER FITTED TO THE ROOM. This is the property
// the whole feature is judged on and it is worth stating as a rule: a cell at
// 150 lux against a 150 lux target is the same green whether the room's
// brightest corner is 200 lux or 2,000, and whether there are two fittings in it
// or forty. Nothing here looks at a minimum, a maximum, a mean or a percentile.
// Move a light and the colours under it change; the colours everywhere else do
// not. See `colourFor`, which takes a ratio and nothing else.
// ---------------------------------------------------------------------------

import { HEATMAP_BANDS } from './heatmapTargets.js';

/**
 * THE FIVE ANCHORS, READ OFF THE DOCUMENT.
 *
 * `getComputedStyle` ON THE ROOT ELEMENT, which is where Tailwind's `@theme`
 * puts them. It is a real style read, so it costs a layout query — hence once
 * per solve rather than once per cell, and hence the palette being passed down
 * rather than looked up.
 *
 * `null` WHERE THERE IS NO DOCUMENT OR NO TOKEN, and the callers draw nothing.
 * That is deliberate and it is the alternative to a fallback: a hard-coded
 * default here would be exactly the second copy of the palette this file exists
 * to prevent, and it would hide a missing token instead of showing it. In a
 * browser with the stylesheet loaded the tokens are always there; in Node they
 * never are, which is why the tests exercise `colourFor` with anchors of their
 * own.
 */
export function readHeatmapPalette(root = null) {
  const el = root
    ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (!el || typeof getComputedStyle !== 'function') return null;
  const cs = getComputedStyle(el);
  const stops = [];
  for (const band of HEATMAP_BANDS) {
    const raw = cs.getPropertyValue(band.token).trim();
    const rgb = parseColour(raw);
    if (!rgb) return null;
    stops.push({ at: band.anchor, rgb, id: band.id, token: band.token, css: raw });
  }
  return stops;
}

/**
 * A CSS COLOUR AS THREE NUMBERS. `#rgb`, `#rrggbb` and `rgb()`/`rgba()`, which
 * between them cover everything a browser hands back for a custom property —
 * the computed value of a custom property is the TOKEN STREAM as authored, so a
 * hex in the stylesheet comes back as that hex rather than as `rgb()`. Both
 * forms are read anyway, because the value is a stylesheet's to choose.
 */
export function parseColour(s) {
  const t = String(s || '').trim();
  if (!t) return null;
  let m = /^#([0-9a-f]{3})$/i.exec(t);
  if (m) {
    const [r, g, b] = m[1].split('');
    return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)];
  }
  m = /^#([0-9a-f]{6})$/i.exec(t);
  if (m) {
    return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16),
            parseInt(m[1].slice(4, 6), 16)];
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(t);
  if (m) {
    const n = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (n.length >= 3 && n.slice(0, 3).every(Number.isFinite)) {
      return [n[0], n[1], n[2]];
    }
  }
  return null;
}

/**
 * THE RAMP. A ratio and the anchors, in; three numbers, out.
 *
 * SMOOTH BETWEEN ANCHORS AND FLAT OUTSIDE THEM. Between two anchors it is a
 * straight line in RGB — which is not a perceptual space and is the right
 * choice anyway, because the five anchors are already spread across the hue
 * circle and the reader is asked to tell five bands apart rather than to judge a
 * gradient. Below the first anchor and above the last it SATURATES: a room at
 * four times its target is the same orange as one at three, because the scale
 * has said everything it has to say, and running on into a sixth colour would be
 * inventing a band nothing documented.
 *
 * PURE, AND THAT IS WHAT MAKES THE STABILITY CHECKABLE. Same ratio, same
 * colour, always — no room, no neighbours, no extremes.
 */
export function colourFor(ratio, stops) {
  if (!stops?.length) return null;
  const r = Number.isFinite(ratio) ? Math.max(0, ratio) : 0;
  if (r <= stops[0].at) return stops[0].rgb;
  const last = stops[stops.length - 1];
  if (r >= last.at) return last.rgb;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    if (r > b.at) continue;
    const span = b.at - a.at;
    const t = span > 0 ? (r - a.at) / span : 0;
    return [
      a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t,
      a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t,
      a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t,
    ];
  }
  return last.rgb;
}

/**
 * HOW HARD THE HEATMAP READS OVER THE DRAWING — TWO FIGURES, BECAUSE THERE ARE
 * TWO GROUNDS.
 *
 * IT IS NOT `THROW_STYLE.opacity`. The throw pools are at 0.1 because they are
 * a decorative claim laid over somebody else's line work and have to stay out
 * of its way — and they are switched OFF while this is on, so there is nothing
 * to be consistent with. This layer IS the subject while it is up: at 0.1 a
 * five-band scale collapses into five shades of the plan.
 *
 * 0.55 ON PAPER IS WHERE THE FITTINGS STILL WIN. The symbols and the room
 * outlines are painted after it and have to stay legible — that is the
 * requirement the feature is judged on — and at much past this the amber of a
 * downlight over green floor stops separating. Under it, the blue of a dark
 * corner stops reading as blue.
 *
 * --- AND ON THE NIGHT SHEET IT HAS TO BE MUCH HIGHER --------------------
 * ONE FIGURE FOR BOTH GROUNDS WAS WRONG AND IT WAS INVISIBLY WRONG. `layers
 * .invert` turns the scan into a negative, so the drawing's ground is BLACK —
 * and alpha compositing over black MULTIPLIES: the deep blue of the bottom band
 * at 0.55 over black is (15, 35, 88), which is not a quiet blue, it is very
 * nearly the ground. The whole cold half of the scale disappeared on exactly
 * the sheet a lighting designer looks at a night scene on.
 *
 * 0.82 IS WHERE THE FIVE BANDS COME BACK. Each token keeps four fifths of its
 * own value, so a deep blue reads as deep blue and the amber and orange still
 * separate from the fittings' cream. WHAT IT COSTS is the scan showing through
 * inside a room, which is the right thing to spend on this sheet: the plan's own
 * white line work inside a space is furniture and dimensions, the walls are
 * outside the traced outline the field is clipped to, and every mark this app
 * makes is painted after the field and unaffected.
 *
 * THE SAME `layers.invert ? night : day` SHAPE EVERY OTHER DECISION ON THAT
 * CANVAS TAKES — see `RAMP`, `zoneInk` and `regionInk` in PlanCanvas. One
 * question, asked in one place, answered per ground.
 */
export const HEATMAP_OPACITY = 0.55;
export const HEATMAP_OPACITY_NIGHT = 0.82;

/** Which of the two, given the ground. `night` is `layers.invert`. */
export const heatmapOpacity = (night = false) =>
  (night ? HEATMAP_OPACITY_NIGHT : HEATMAP_OPACITY);

/** `rgb(...)` for a colour the markup has to state — the legend's swatches take
 *  the token directly through `var()`, so this is only for the one place a
 *  blended value is drawn: the ramp preview. */
export const cssRgb = (c) => (c
  ? `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])})` : 'transparent');
