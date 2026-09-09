// ---------------------------------------------------------------------------
// span.js — A STRETCH OF A PATH, AS A PRIMITIVE. Two points on one host, with
// the rule that keeps them a stretch.
//
// WHAT IT IS FOR. The app hand-rolls this four times and calls it something
// different each time:
//
//   the cove slot        both ends on the plaster — `spanOnOutline`
//   the accent run       a run on one wall of a room — lib/accentPlace.js
//   the reverse cove     a wall run, trimmed and merged — `trimWallRun`,
//                        `mergeReverseCoves`
//   the shelf strip      a strip along a shelf edge — `shelfStripsFor`
//
// Every one of them is a start and an end on a host path, and every one of them
// grew its own answer to the same five questions: where does it sit, how long
// is it, what happens when you drag one end past the other, what happens when
// two of them overlap, and how short is too short.
//
// A SPAN IS ALWAYS ON A HOST, and that is the line between it and a two-point
// path. A free stretch between two free points is a path of two points — that
// is `lib/path.js` and it needs nothing from here. What makes a span its own
// primitive is that both of its ends are constrained to one geometry, which is
// what "a run ON that wall" means and is the whole of why it can be trimmed,
// merged and slid.
//
//   `{ on: hostId, a, b }` — two fractions of the host, 0..1.
//
// SO IT IS TWO CONSTRAINED POINTS PLUS AN INVARIANT, and it is built that way:
// `a` and `b` go through point.js's `clampU`, resolve through its `atU`, and the
// span's own work is the invariant — ordered, long enough, on one host.
//
// --- THE TWO THINGS THAT ARE NOT OBVIOUS ------------------------------------
//
// A SPAN ON A CLOSED HOST MAY CROSS THE SEAM. A cove run around three sides of
// a room starts at 0.9 and ends at 0.2, and `b < a` is the record for it rather
// than an error to normalise away — the seam is an artefact of where the
// outline's first point happens to be, and refusing to cross it would refuse a
// run round a corner for a reason nobody drawing it can see. So `b < a` means
// WRAPPED on a closed host and is ordered on an open one, and every length,
// stretch and overlap question below is asked the wrap-aware way.
//
// A SLIDE KEEPS ITS LENGTH AND AN END DRAG DOES NOT. Those are the two gestures
// a span has and they are different verbs: dragging the middle of a run moves
// the run, and dragging its end lengthens it. `spanAdapters` is the first one
// and `setSpanEnd` is the second — see the note on modes in `spanAdapters`.
//
// PURE. The unit is the caller's, as in point.js.
// ---------------------------------------------------------------------------

import { legs, pathLength } from './geometry.js';
import { clampU, uAt, atU } from './point.js';
import { MIN_SEG_FT } from './pen.js';

export const SPAN = 'span';

/** Nothing shorter than this is a run — pen.js's own floor, so a span and the
 *  segment it was drawn along agree about what counts as a length. */
export const MIN_SPAN_FT = MIN_SEG_FT;

/** A span on a host, from `a` to `b`. */
export const makeSpan = (hostId, a, b, rest = {}) => ({
  ...rest, on: hostId, a: clampU(a), b: clampU(b),
});

export const isSpan = (sp) => sp?.on != null
  && Number.isFinite(sp?.a) && Number.isFinite(sp?.b);

/** Is this span's own host closed? Every wrap question below needs it, and it
 *  is a fact about the HOST rather than about the span. */
const wraps = (sp, host) => !!host?.closed && sp.b < sp.a;

/**
 * HOW FAR FROM `a` TO `b`, AS A SIGNED FRACTION — the one number every question
 * below is asked in terms of.
 *
 * WRAP-AWARE, which is the whole reason it is a function and not a subtraction:
 * a run from 0.9 to 0.2 round a closed host covers three tenths of it going
 * forward, and `b - a` says minus seven.
 *
 * AND THE SIGN IS KEPT rather than taken away here, because two different
 * questions are asked of it. HOW LONG is a geometric fact and has no sign —
 * `spanLength`. WHETHER THE SPAN IS STILL THE SAME SPAN is a rule, and the sign
 * is exactly what it turns on: an end dragged past the other one comes back
 * with the sign reversed, and that is the span inside out rather than a shorter
 * one. Collapsing to `Math.abs` in one place, which is what this did first,
 * made an inverted span read as a perfectly good one — see `spanValid`.
 */
export function spanDu(sp, host) {
  if (!isSpan(sp)) return 0;
  return wraps(sp, host) ? (sp.b - sp.a + 1) : (sp.b - sp.a);
}

/**
 * HOW LONG, IN THE HOST'S OWN UNIT. Unsigned: a length is a length, and an
 * inverted span on an open host still measures the distance between its two
 * ends. Whether it is a span the app will accept is `spanValid`'s question.
 */
export function spanLength(sp, host) {
  if (!isSpan(sp) || !host?.pts?.length) return 0;
  const total = pathLength(host.pts, { closed: !!host.closed });
  return Math.abs(spanDu(sp, host)) * total;
}

/**
 * IS THIS STILL A SPAN — long enough, AND running the same way it was?
 *
 * `was` IS THE SPAN BEFORE THE EDIT and it is what makes this two conditions
 * instead of one. A span may legitimately run either way on an open host —
 * `flipSpan` is a deliberate act — so "ordered" is not the rule; "still ordered
 * the way it was" is. Without that, an end dragged clean past the other comes
 * back long, positive-looking and inside out, and anything that remembered
 * which end was the start is now on the wrong one.
 */
export function spanValid(sp, was, host, { min = MIN_SPAN_FT } = {}) {
  if (!isSpan(sp) || !host?.pts?.length) return false;
  const du = spanDu(sp, host);
  const dir = spanDu(was ?? sp, host) < 0 ? -1 : 1;
  if (du === 0 || (du < 0 ? -1 : 1) !== dir) return false;
  return spanLength(sp, host) >= min;
}

/** Where its two ends are, each with the direction the host is heading — what
 *  anything with a body or an aim needs. `null` for a span with no host. */
export function spanEnds(sp, host) {
  if (!isSpan(sp) || !host?.pts?.length) return null;
  const opt = { closed: !!host.closed };
  const a = atU(host.pts, sp.a, opt), b = atU(host.pts, sp.b, opt);
  return a && b ? { a, b } : null;
}

/** The fraction half way along it — the handle a slide is measured from, and
 *  wrap-aware for `spanLength`'s reason. */
export function spanMidU(sp, host) {
  if (!isSpan(sp)) return 0;
  const m = sp.a + spanDu(sp, host) / 2;
  return host?.closed ? ((m % 1) + 1) % 1 : clampU(m);
}

/**
 * THE STRETCH ITSELF, AS A POLYLINE — what gets drawn, and it is not a straight
 * line between the two ends.
 *
 * A RUN THAT TURNS A CORNER IS THE ORDINARY CASE, not an edge case: an accent
 * run on an L-shaped wall, a cove round two sides of a room. Drawing it as a
 * segment from end to end would cut the corner off and put the fitting outside
 * the wall it is supposed to be on. So this walks the host's own legs between
 * the two arc lengths and keeps every vertex it passes.
 */
export function spanStretch(sp, host) {
  if (!isSpan(sp) || !host?.pts?.length) return [];
  const closed = !!host.closed;
  const total = pathLength(host.pts, { closed });
  if (!(total > 0)) return [];
  const ends = spanEnds(sp, host);
  if (!ends) return [];
  const s0 = sp.a * total;
  const s1 = (wraps(sp, host) ? sp.b + 1 : sp.b) * total;
  const out = [{ x: ends.a.x, y: ends.a.y }];
  const ls = legs(host.pts, { closed });
  // TWO TIMES ROUND FOR A WRAPPED SPAN, and no more: a span is at most the whole
  // host, so the second pass can never run past its own end.
  let run = 0;
  for (let pass = 0; pass < 2; pass += 1) {
    for (const l of ls) {
      const end = run + l.len;
      if (end > s0 && end < s1) out.push({ x: l.b.x, y: l.b.y });
      run = end;
      if (run >= s1) break;
    }
    if (run >= s1) break;
  }
  out.push({ x: ends.b.x, y: ends.b.y });
  return out;
}

// --- MOVE, AND THE TWO ADAPTERS ---------------------------------------------

/**
 * THE ADAPTER PAIR: A SLIDE ALONG THE HOST, KEEPING ITS LENGTH.
 *
 * THE ANCHOR IS THE MIDDLE, because that is what the hand has hold of when it
 * drags a run — grab a three-foot accent run anywhere along it and the run
 * follows, rather than its start jumping to the cursor.
 *
 * IT KEEPS ITS LENGTH AND CLAMPS AT THE ENDS OF AN OPEN HOST. A run slid at the
 * end of a wall stops there with its length intact; letting the far end run off
 * and shortening it would be a slide that silently resized the thing being slid.
 * On a closed host there is no end to stop at and it wraps instead.
 *
 * AND IT IS ONLY ONE OF THE SPAN'S TWO GESTURES. Dragging an END is
 * `setSpanEnd`, and the two are told apart by the caller's own mode — the same
 * shape the ceiling object's move/resize/rotate already has, gated with
 * `moves: (d) => d.mode === 'move'` in hooks/useDrag.js.
 */
export function spanAdapters(hostFor = null) {
  return {
    at: (sp) => {
      const host = hostFor?.(sp);
      return atU(host?.pts, spanMidU(sp, host), { closed: !!host?.closed })
        ?? { x: 0, y: 0 };
    },
    to: (sp, p) => {
      const host = hostFor?.(sp);
      if (!isSpan(sp) || !host?.pts?.length) return sp;
      const closed = !!host.closed;
      const want = uAt(host.pts, p, { closed });
      const du = spanDu(sp, host);
      if (closed) {
        const w = (u) => ((u % 1) + 1) % 1;
        return { ...sp, a: w(want - du / 2), b: w(want + du / 2) };
      }
      /* ON AN OPEN HOST THE LENGTH IS WHAT SURVIVES, so the middle is pushed
         back inside rather than the ends being cut. THE SIGNED du IS CARRIED
         THROUGH and not taken away: a span somebody flipped deliberately would
         otherwise come back the other way round from a slide, which is an edit
         to which end is the start disguised as a move. */
      const half = Math.min(0.5, Math.abs(du) / 2);
      const mid = Math.max(half, Math.min(1 - half, want));
      return { ...sp, a: clampU(mid - du / 2), b: clampU(mid + du / 2) };
    },
  };
}

/**
 * A SPAN TAKES NO ORTHO LOCK, for the reason `orthoFor` gives in point.js: both
 * of its ends are already held to the host, so a lock on the wanted position
 * would hold it to a row the run then leaves, and claim an alignment the drawing
 * does not have.
 */
export const spanOrtho = () => false;

// --- ITS OWN VERBS ----------------------------------------------------------

/**
 * ONE END, DRAGGED.
 *
 * `which` IS 'a' OR 'b' AND IT DOES NOT SWAP. Dragging an end past the other
 * one is the case every editor has to decide, and the choice here is to STOP at
 * the minimum rather than flip: a run whose ends exchange identities mid-drag
 * puts the hand on the end it was not holding, and anything that remembered
 * which end was which — a feed, a driver, a start-of-run label — is now on the
 * wrong one. So the dragged end travels until the span is `min` long and then
 * stays there.
 *
 * ON A CLOSED HOST IT MAY WRAP, and the minimum is measured the wrap-aware way,
 * so an end dragged the long way round a room is a legal three-quarter run
 * rather than a refusal.
 */
export function setSpanEnd(sp, which, want, host, { min = MIN_SPAN_FT } = {}) {
  if (!isSpan(sp) || !host?.pts?.length) return sp;
  const closed = !!host.closed;
  const total = pathLength(host.pts, { closed });
  if (!(total > 0)) return sp;
  const u = uAt(host.pts, want, { closed });
  const next = which === 'a' ? { ...sp, a: u } : { ...sp, b: u };
  if (spanValid(next, sp, host, { min })) return next;
  /* TOO SHORT, OR PAST THE OTHER END: the dragged end is put exactly `min` from
     the fixed one, on the side it was already on, so the drag ends against a
     wall rather than collapsing to nothing and reappearing inverted. */
  const step = (spanDu(sp, host) < 0 ? -1 : 1) * (min / total);
  const w = (v) => (closed ? ((v % 1) + 1) % 1 : clampU(v));
  return which === 'a'
    ? { ...sp, a: w(sp.b - step) }
    : { ...sp, b: w(sp.a + step) };
}

/**
 * ITS TWO ENDS THE OTHER WAY ROUND — the drawing does not change, which end is
 * the start does, and that is what a feed or a driver at one end cares about.
 *
 * REFUSED ON A CLOSED HOST, AND THAT IS NOT A GAP. On a loop `b < a` already
 * MEANS wrapped — see the header — so swapping the pair does not name the same
 * stretch the other way round, it names the COMPLEMENTARY stretch: a 0.4 run
 * becomes the 0.6 run that is everything else. The record genuinely cannot
 * express "this stretch, other end first" on a closed host, and returning
 * something that looks like it did would be worse than saying so.
 */
export const flipSpan = (sp, host = null) => (host?.closed
  ? sp : { ...sp, a: sp.b, b: sp.a });

/**
 * ONE SPAN CUT IN TWO AT A FRACTION. Returns the pair, or `null` when the cut
 * would leave either side shorter than a run — which is a cut nobody can build
 * and is better refused than made and then silently dropped.
 */
export function splitSpan(sp, u, host, { min = MIN_SPAN_FT } = {}) {
  if (!isSpan(sp) || !host?.pts?.length) return null;
  const cut = clampU(u);
  const left = { ...sp, b: cut }, right = { ...sp, a: cut };
  if (!spanValid(left, sp, host, { min })
    || !spanValid(right, sp, host, { min })) return null;
  return [left, right];
}

/** Shorter at both ends by `by`, in the host's unit — `trimWallRun`'s question,
 *  which is how a wall run keeps clear of the corners it runs into. `null` when
 *  there would be nothing left. */
export function trimSpan(sp, by, host, { min = MIN_SPAN_FT } = {}) {
  if (!isSpan(sp) || !host?.pts?.length) return null;
  const total = pathLength(host.pts, { closed: !!host.closed });
  if (!(total > 0)) return null;
  const dir = spanDu(sp, host) < 0 ? -1 : 1;
  const step = dir * (by / total);
  const w = (v) => (host.closed ? ((v % 1) + 1) % 1 : clampU(v));
  const next = { ...sp, a: w(sp.a + step), b: w(sp.b - step) };
  /* AND IT IS `spanValid` AND NOT A LENGTH TEST. Trimming more than there is
     turns the span inside out, and an inverted span measures a perfectly
     respectable length — which is exactly how a run trimmed out of existence
     came back as a long one running the wrong way. */
  return spanValid(next, sp, host, { min }) ? next : null;
}

/**
 * TWO SPANS THAT TOUCH, MADE ONE.
 *
 * `mergeReverseCoves`' question, and the reason it has to be asked: two runs
 * that meet end to end are ONE run on site, and billed as two they buy two sets
 * of end caps and two drivers. `gap` is how close counts as touching, in the
 * host's unit — a hair of a gap between two runs somebody drew separately is
 * still one run.
 *
 * ONLY SPANS ON THE SAME HOST, and unordered input is fine: they are sorted by
 * start before the sweep, because a list that runs the other way round the
 * outline is the same set of runs.
 */
export function mergeSpans(list, host, { gap = MIN_SPAN_FT } = {}) {
  const on = (list ?? []).filter((sp) => isSpan(sp) && sp.on === (host?.id ?? sp.on));
  if (on.length < 2 || !host?.pts?.length) return on;
  const total = pathLength(host.pts, { closed: !!host.closed });
  if (!(total > 0)) return on;
  const step = gap / total;
  const sorted = [...on].sort((p, q) => p.a - q.a);
  const out = [sorted[0]];
  for (const sp of sorted.slice(1)) {
    const prev = out[out.length - 1];
    if (sp.a <= prev.b + step) {
      if (sp.b > prev.b) out[out.length - 1] = { ...prev, b: sp.b };
    } else out.push(sp);
  }
  return out;
}

/** The spans held on one geometry — what a host's delete has to deal with. */
export const spansOn = (list, hostId) =>
  (list ?? []).filter((sp) => isSpan(sp) && sp.on === hostId);

/** A span hosts nothing, so a delete of one carries nothing with it. Stated
 *  rather than left out: the four primitives answer the same question, and an
 *  absent answer reads as one nobody got round to. */
export const dependentsOfSpan = () => ({ points: [], spans: [] });
