// ---------------------------------------------------------------------------
// consensus.js — deciding whether the drawing has actually told us its scale.
//
// THE BAR IS HIGH ON PURPOSE, and doors.js says why better than this file can:
// a wrong ruler is the worst failure this app has, "because every room comes
// out the wrong size while still looking exactly like a plan". Every other
// failure here is cheap — declining to read a scale costs one door click, which
// is what the user did before this existed. So the rule is that evidence has to
// CORROBORATE, never merely exist.
//
// WHAT THE SHEET SAYS ABOUT ITSELF IS NOT EVIDENCE, and "N.T.S" in a title
// block is the case that proved it. This file used to read that stamp and first
// refuse outright, then demand extra corroboration. Both were wrong for the same
// reason: the phrase goes into a template once and is never looked at again —
// every sample plan in this repo carries it, including ones dimensioned end to
// end. What tells you whether a drawing is proportional is whether its OWN
// measurements agree, which is the only thing weighed below.
//
// TWO INDEPENDENT AGREEING CANDIDATES, MINIMUM. One room's two ratios already
// check each other (see roomScale), but a single room cannot reveal a
// systematic error: if the detector's polygons sit on wall centrelines, that
// one room is confidently 4% wrong and has nothing to disagree with. A second
// room, or a chain pair, is what turns an internally consistent reading into a
// corroborated one.
// ---------------------------------------------------------------------------

/** How far from its neighbours a candidate may sit and still agree with them. */
export const TOL = 0.03;
/** How many agreeing candidates are needed before the step may be skipped. */
export const MIN_AGREE = 2;
/** ...and what share of everything found they must make up. */
export const MIN_SHARE = 0.4;

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * THE BIGGEST CLUSTER, NOT THE MIDDLE VALUE.
 *
 * This began as a plain median over every candidate, and a real densely
 * dimensioned plan broke it. The reason is worth stating, because it is a
 * property of dimension chains and not a quirk of one file:
 *
 * NOT EVERY SEGMENT IN A CHAIN CARRIES A FIGURE. Where one is too short to
 * label, the figure is left off or pushed to another row — so two figures that
 * LOOK adjacent can have an unlabelled segment between them, and the distance
 * between their centres covers more wall than the two halves they are credited
 * with. That reads as too MANY pixels per foot, never too few. The error is
 * therefore one-directional, and on a plan with many short segments it can
 * reach half the sample: on `floor_plan_dim_intelligence.pdf` the true 25.7
 * accounts for 34 of 57 adjacent pairs and the rest run from 28 to 70. A median
 * survives that at 60% and fails at 49%, which is too fine a margin to rest the
 * scale of a building on.
 *
 * So the winner is the value with the most OTHER candidates within TOL of it.
 * Scattered wrong answers do not cluster — a tight group of thirty is evidence
 * in a way that a midpoint between a right answer and a wrong one is not.
 *
 * TIES GO TO THE LOWER VALUE, for the same reason the contamination is
 * one-directional: when two clusters are equally big, the one that has not
 * skipped a segment is the smaller number.
 */
function largestCluster(values) {
  let best = null;
  for (const v of values) {
    const group = values.filter((w) => Math.abs(w - v) / v <= TOL);
    if (!best || group.length > best.group.length
        || (group.length === best.group.length && v < best.at)) {
      best = { at: v, group };
    }
  }
  return best ?? { at: null, group: [] };
}

/**
 * Candidates -> a verdict.
 *
 * `{ ok, pxPerFt, confidence, used, rejected, spread, reason }`
 *
 * THE MEDIAN AND NOT THE MEAN, at every step. A mean is moved by the outlier it
 * is trying to survive; on six candidates with one label read off the wrong
 * room, the mean lands between the right answer and the wrong one and agrees
 * with neither.
 */
export function consensus(candidates) {
  const all = (candidates || []).filter((c) => Number.isFinite(c?.pxPerFt) && c.pxPerFt > 0);

  if (!all.length) {
    return { ok: false, pxPerFt: null, confidence: 'none', used: [], rejected: [],
             spread: null, reason: 'no dimensions found on the drawing' };
  }

  const centre = largestCluster(all.map((c) => c.pxPerFt)).at;
  const used = all.filter((c) => Math.abs(c.pxPerFt - centre) / centre <= TOL);
  const rejected = all.filter((c) => !used.includes(c));
  const values = used.map((c) => c.pxPerFt);
  const spread = values.length > 1
    ? (Math.max(...values) - Math.min(...values)) / centre
    : 0;

  if (used.length < MIN_AGREE) {
    return { ok: false, pxPerFt: null, confidence: 'none', used, rejected, spread,
             reason: used.length === 1
               ? 'only one dimension could be read, and one cannot check itself'
               : 'the dimensions found do not agree with each other' };
  }
  if (used.length / all.length < MIN_SHARE) {
    return { ok: false, pxPerFt: null, confidence: 'none', used, rejected, spread,
             reason: 'too many of the dimensions found disagree' };
  }

  // WHICH KINDS OF EVIDENCE AGREED, not just how many. Two chain pairs from one
  // chain are less independent than a chain and a room — they share a row of
  // labels and an exporter's idea of where to centre them.
  const kinds = new Set(used.map((c) => c.source));
  const confidence = (kinds.size > 1 && spread <= 0.015) ? 'high'
    : (used.length >= 3 && spread <= 0.02) ? 'high'
    : 'medium';

  return {
    ok: true,
    pxPerFt: median(values),
    confidence,
    used,
    rejected,
    spread,
    reason: null,
  };
}
