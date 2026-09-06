// ---------------------------------------------------------------------------
// materials.js — what a space is finished in, and nothing else.
//
// A room's ambient level is not a property of its fittings alone: the same six
// downlights in a white bedroom and in a walnut-panelled study are two
// different rooms to stand in. So before anything is placed, a space is asked
// three questions — what is the ceiling, what is the floor, what are the walls
// — and the answers are a TONE rather than a material, because a tone is what
// the arithmetic needs and a material is what the client says.
//
// THE WALLS ARE PER SEGMENT AND THE OTHER TWO ARE NOT. A ceiling is one plane
// and a floor is one plane; walls are four to a dozen, and the one that is dark
// oak is exactly the one that changes the answer. So a wall answer is keyed by
// the index of the edge in the room's own outline, and what the panel reports
// is the MIX — how much of the room's wall length is in each tone.
//
// KEPT SEPARATE FROM THE RENDER PASS'S wallResults ON PURPOSE. That is what a
// model SAW on a photograph and is the pass's to replace; this is what somebody
// SAID, and no pass may overwrite it.
// ---------------------------------------------------------------------------

/** Floor to slab, in millimetres. The figure most residential work is drawn to. */
export const DEFAULT_CEILING_MM = 2700;
export const CEILING_MM_MIN = 1500;
export const CEILING_MM_MAX = 9000;

export const TONES = ['light', 'medium', 'dark'];
export const DEFAULT_TONE = 'light';

export const TONE_LABEL = { light: 'Light', medium: 'Medium', dark: 'Dark' };

/* THE THREE SENTENCES THE WALL POPUP SHOWS. They are here rather than in the
   popup because the same three tones are asked about in three places and a
   second copy is a second thing to keep true. Ceiling and floor take the label
   alone — a tone chip in a row called "Ceiling" needs no gloss. */
export const WALL_TONE_BLURB = {
  light: 'Any light wall finish, panelling, or wallpaper',
  medium: 'Medium wall finishes, wooden panelling, or wallpaper',
  dark: 'Dark wall paint, dark wood panelling, or dark wallpaper',
};

/* WHAT EACH TONE GIVES BACK. Mid-range CIBSE/IES surface reflectances: a white
   emulsion ceiling is 0.7–0.8, a mid-tone paint or timber is around 0.5, and a
   dark paint or dark wood is 0.1–0.2. Nothing reads these yet — the analysis is
   a fitting count until the gridding engine comes back — and they are stated
   here so that when it does there is one place the numbers live. */
export const TONE_REFLECTANCE = { light: 0.7, medium: 0.5, dark: 0.15 };

/** A tone that is not one of the three is the default, which is what a plan
 *  saved by an older build and a hand-edited state both come back as. */
export const toneOf = (t) => (TONES.includes(t) ? t : DEFAULT_TONE);

/** The record for one space, with every absent answer filled in. */
export function materialsOf(map, roomId) {
  const m = map?.[roomId] ?? null;
  return {
    ceiling: toneOf(m?.ceiling),
    floor: toneOf(m?.floor),
    walls: m?.walls ?? {},
  };
}

/**
 * HOW MUCH OF THIS ROOM'S WALL IS IN EACH TONE, by LENGTH and not by count.
 *
 * A 2 ft return and a 20 ft living-room wall are one segment each and are not
 * one answer each: painting the return dark changes almost nothing, and the app
 * must not report it as a third of the room. So every edge is weighted by how
 * long it is.
 *
 * Returns the three tones in order, each with its share as a whole number, and
 * the shares always sum to exactly 100 — largest remainder, so a room that is
 * 1/3 dark reads 33/67 rather than 33/66 and a percent unaccounted for.
 */
export function wallMix(polygon, walls = {}) {
  const zero = TONES.map((tone) => ({ tone, pct: 0, ft: 0 }));
  if (!polygon || polygon.length < 3) return zero;

  const by = { light: 0, medium: 0, dark: 0 };
  let total = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(len > 0)) continue;
    by[toneOf(walls[i])] += len;
    total += len;
  }
  if (!(total > 0)) return zero;

  const raw = TONES.map((tone) => ({ tone, ft: by[tone], exact: (by[tone] / total) * 100 }));
  const out = raw.map((r) => ({ ...r, pct: Math.floor(r.exact) }));
  let short = 100 - out.reduce((s, r) => s + r.pct, 0);
  // The tones with the biggest fractional part get the leftover points, one
  // each, which is what keeps a 1/3 split reading 34/33/33.
  [...out]
    .map((r, i) => ({ i, frac: r.exact - Math.floor(r.exact) }))
    .sort((p, q) => q.frac - p.frac)
    .forEach(({ i }) => { if (short > 0) { out[i].pct += 1; short -= 1; } });
  return out.map(({ tone, pct, ft }) => ({ tone, pct, ft }));
}

/** The mix as one line: "100% light", or "62% light · 38% dark". */
export function wallMixLabel(mix) {
  const live = mix.filter((m) => m.pct > 0);
  if (!live.length) return `100% ${TONE_LABEL[DEFAULT_TONE].toLowerCase()}`;
  return live.map((m) => `${m.pct}% ${TONE_LABEL[m.tone].toLowerCase()}`).join(' · ');
}

/**
 * WHAT THE COLLAPSED MATERIALS ROW SAYS.
 *
 * "Default" when nothing has been touched, and otherwise WHAT DIFFERS rather
 * than the word "Custom". A row that only says a room has been changed sends
 * you into the editor to find out how; one that says "Dark floor" has already
 * answered the question most of the time, because most rooms differ in one
 * surface.
 *
 * THE WALLS ARE STATED AS A SHARE and the other two as a tone, which is the
 * honest asymmetry: a ceiling is one plane with one answer, and the walls are a
 * mix. Only the non-default share is named — "31% dark walls" — because the
 * remainder is the default and saying so twice is what makes a summary long.
 */
export function materialsSummary(materials, polygon) {
  const bits = [];
  if (materials.ceiling !== DEFAULT_TONE) {
    bits.push(`${TONE_LABEL[materials.ceiling]} ceiling`);
  }
  if (materials.floor !== DEFAULT_TONE) {
    bits.push(`${TONE_LABEL[materials.floor]} floor`);
  }
  for (const m of wallMix(polygon, materials.walls)) {
    if (m.tone === DEFAULT_TONE || m.pct <= 0) continue;
    bits.push(`${m.pct}% ${TONE_LABEL[m.tone].toLowerCase()} walls`);
  }
  return bits.length ? bits.join(' · ') : 'Default';
}

/** Every wall on this space, with its tone and its midpoint — what the canvas
 *  draws and what the popup is anchored to. Geometry in, geometry out. */
export function wallSegments(polygon, walls = {}) {
  if (!polygon || polygon.length < 2) return [];
  return polygon.map((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    return {
      i, a, b,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      len: Math.hypot(b.x - a.x, b.y - a.y),
      tone: toneOf(walls[i]),
    };
  });
}
