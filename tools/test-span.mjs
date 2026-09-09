// ---------------------------------------------------------------------------
// test-span.mjs — THE SPAN PRIMITIVE.
//
// WHAT IS ASSERTED. The five questions the four hand-rolled spans in this app
// each answered separately — the cove slot, the accent run, the reverse cove
// and the shelf strip:
//
//   WHERE      it sits, and how long it is, WRAP-AWARE. A run from 0.9 to 0.2
//              round a closed host is seven tenths of it, not minus seven.
//   STRETCH    it is drawn along the host's own legs, so a run that turns a
//              corner keeps the corner.
//   SLIDE      dragging the middle keeps its length; an open host's end stops
//              it rather than shortening it.
//   END DRAG   dragging one end past the other STOPS at the minimum and does
//              not swap which end is which.
//   TRIM/MERGE/SPLIT  the three verbs a wall run needs, and their refusals.
//
//   node tools/test-span.mjs
// ---------------------------------------------------------------------------

import {
  SPAN, MIN_SPAN_FT, makeSpan, isSpan, spanLength, spanEnds, spanMidU,
  spanStretch, spanAdapters, spanOrtho, setSpanEnd, flipSpan, splitSpan,
  trimSpan, mergeSpans, spansOn, dependentsOfSpan, spanDu, spanValid,
} from '../src/lib/span.js';
import { makePath, asPathHost } from '../src/lib/path.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const say = (t) => console.log('\n' + t);
const near = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

/** A straight 100-long host, open. */
const H = asPathHost(makePath([{ x: 0, y: 0 }, { x: 100, y: 0 }], { id: 'h' }));
/** An L: right 100 then down 100, open, 200 long. */
const L = asPathHost(makePath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
  { id: 'L' }));
/** A 100 square, closed, 400 round. */
const SQ = asPathHost(makePath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 },
  { x: 0, y: 100 }], { closed: true, id: 'sq' }));

// ---------------------------------------------------------------------------
say('WHAT A SPAN IS — always on a host, which is what makes it not a path');
{
  const sp = makeSpan('h', 0.2, 0.6, { id: 's' });
  ok(SPAN === 'span' && sp.on === 'h' && near(sp.a, 0.2) && near(sp.b, 0.6),
    'two fractions and the host they are fractions of');
  ok(isSpan(sp) && !isSpan({ a: 0, b: 1 }),
    'and a stretch with no host is not a span — that is a two-point path');
  ok(near(makeSpan('h', -1, 4).a, 0) && near(makeSpan('h', -1, 4).b, 1),
    'both ends go through clampU: a fraction off the end of its own host is not one');
  ok(spanOrtho() === false,
    'it takes no shift lock — both ends are already held, same rule as a constrained point');
  ok(near(MIN_SPAN_FT, 0.25), 'and its floor is pen.js\'s own MIN_SEG_FT');
}

// ---------------------------------------------------------------------------
say('LENGTH — wrap-aware, or a run round a corner bills nothing');
{
  ok(near(spanLength(makeSpan('h', 0.2, 0.6), H), 40), 'four tenths of a 100 host');
  ok(near(spanLength(makeSpan('L', 0, 1), L), 200), 'and the whole of a 200 one');
  ok(near(spanLength(makeSpan('sq', 0.9, 0.2), SQ), 120),
    'a WRAPPED run on a closed host is three tenths of 400 — not minus seven tenths');
  ok(near(spanLength(makeSpan('h', 0.9, 0.2), H), 70),
    'and on an OPEN host the same pair measures 70 — a length has no sign');
  ok(near(spanDu(makeSpan('h', 0.9, 0.2), H), -0.7),
    '...but `spanDu` keeps the sign, which is what says it runs backwards');
  ok(near(spanDu(makeSpan('sq', 0.9, 0.2), SQ), 0.3),
    'and on a closed host b < a means WRAPPED FORWARD, so the sign is positive');
  ok(spanLength(makeSpan('h', 0, 1), null) === 0, 'no host, no length');

  ok(near(spanMidU(makeSpan('h', 0.2, 0.6), H), 0.4), 'its middle is the handle a slide uses');
  ok(near(spanMidU(makeSpan('sq', 0.9, 0.2), SQ), 0.05),
    'and a wrapped span\'s middle is on the far side of the seam');
}

// ---------------------------------------------------------------------------
say('ENDS AND STRETCH — a run that turns a corner keeps the corner');
{
  const ends = spanEnds(makeSpan('L', 0.25, 0.75), L);
  ok(near(ends.a.x, 50) && near(ends.a.y, 0), 'the start resolves on the host');
  ok(near(ends.b.x, 100) && near(ends.b.y, 50), 'and so does the end');
  ok(ends.b.ux === 0 && ends.b.uy === 1, 'each with the direction the host is heading there');
  ok(spanEnds(makeSpan('L', 0, 1), null) === null, 'and null with no host');

  const st = spanStretch(makeSpan('L', 0.25, 0.75), L);
  ok(st.length === 3, 'the stretch is drawn along the LEGS: start, the corner, end');
  ok(near(st[1].x, 100) && near(st[1].y, 0),
    'so a run on an L is not a diagonal shortcut that leaves the wall');
  ok(spanStretch(makeSpan('h', 0.1, 0.9), H).length === 2,
    'a straight stretch is just its two ends');
  const round = spanStretch(makeSpan('sq', 0.9, 0.2), SQ);
  ok(round.length === 3 && near(round[1].x, 0) && near(round[1].y, 0),
    'and a wrapped one crosses the seam, keeping the vertex it passes');
}

// ---------------------------------------------------------------------------
say('SLIDE — the length is what survives');
{
  const unit = spanAdapters(() => H);
  const sp = makeSpan('h', 0.2, 0.4);
  ok(near(unit.at(sp).x, 30), 'the anchor is the middle — what the hand has hold of');

  const flipped = unit.to(flipSpan(sp, H), { x: 60, y: 0 });
  ok(flipped.a > flipped.b,
    'a flipped span slides while STAYING flipped — a move must not edit which end is the start');

  const slid = unit.to(sp, { x: 60, y: 0 });
  ok(near(slid.a, 0.5) && near(slid.b, 0.7), 'slid to 0.6, and 20 long still');
  ok(near(spanLength(slid, H), spanLength(sp, H)), 'exactly as long as it was');

  const pushed = unit.to(sp, { x: 400, y: 0 });
  ok(near(pushed.b, 1) && near(pushed.a, 0.8),
    'pushed off the end of an OPEN host it stops with its length intact...');
  ok(near(spanLength(pushed, H), 20), '...rather than being silently shortened');

  const loop = spanAdapters(() => SQ);
  const on = makeSpan('sq', 0.9, 0.1);
  const round = loop.to(on, { x: 0, y: 50 });
  ok(near(spanLength(round, SQ), spanLength(on, SQ)),
    'on a CLOSED host there is no end to stop at, so it wraps and keeps its length');
  ok(unit.to(sp, { x: 1, y: 1 }, null) !== null, 'a slide always returns a span');
  ok(spanAdapters(() => null).to(sp, { x: 1, y: 1 }) === sp,
    'and a span whose host is gone is refused, not freed');
}

// ---------------------------------------------------------------------------
say('END DRAG — it stops at the minimum and does not swap ends');
{
  const sp = makeSpan('h', 0.2, 0.6);
  ok(near(setSpanEnd(sp, 'b', { x: 80, y: 0 }, H).b, 0.8), 'the end goes where it is dragged');
  ok(near(setSpanEnd(sp, 'a', { x: 10, y: 0 }, H).a, 0.1), 'and so does the start');

  const crossed = setSpanEnd(sp, 'b', { x: 5, y: 0 }, H);
  ok(near(crossed.a, 0.2), 'dragged past the other end, the FIXED end has not moved');
  ok(near(spanLength(crossed, H), MIN_SPAN_FT),
    'and the dragged one stops exactly a minimum away');
  ok(crossed.b > crossed.a,
    'so the ends never exchange identities — a feed at the start stays at the start');

  const other = setSpanEnd(sp, 'a', { x: 90, y: 0 }, H);
  ok(other.a < other.b && near(spanLength(other, H), MIN_SPAN_FT),
    'and the same the other way round');
  ok(setSpanEnd(sp, 'b', { x: 1, y: 1 }, null) === sp, 'no host, no change');

  const f = flipSpan(sp, H);
  ok(near(f.a, 0.6) && near(f.b, 0.2),
    'a deliberate flip is its own verb — the drawing is the same, the start is not');
  const pinned = setSpanEnd(f, 'b', { x: 90, y: 0 }, H);
  ok(pinned.a > pinned.b && near(spanLength(pinned, H), MIN_SPAN_FT),
    'and a flipped span STAYS flipped under an end drag: the rule is "the way it '
    + 'was", not "ordered"');
  const loop = makeSpan('sq', 0.2, 0.6);
  ok(flipSpan(loop, SQ) === loop,
    'on a CLOSED host a flip is refused — swapping there names the complementary '
    + 'stretch, not the same one');
  ok(spanValid(makeSpan('h', 0.2, 0.6), makeSpan('h', 0.2, 0.6), H) === true
    && spanValid(makeSpan('h', 0.6, 0.2), makeSpan('h', 0.2, 0.6), H) === false,
    'and `spanValid` is the rule the three verbs share: long enough AND running '
    + 'the way it was');
}

// ---------------------------------------------------------------------------
say('SPLIT, TRIM, MERGE — and what each one refuses');
{
  const sp = makeSpan('h', 0, 1);
  const halves = splitSpan(sp, 0.5, H);
  ok(halves && near(halves[0].b, 0.5) && near(halves[1].a, 0.5), 'cut in two at a fraction');
  ok(splitSpan(sp, 0.0005, H) === null,
    'and REFUSED where a side would be shorter than a run — better refused than silently dropped');

  const trimmed = trimSpan(makeSpan('h', 0.1, 0.9), 5, H);
  ok(near(trimmed.a, 0.15) && near(trimmed.b, 0.85),
    'shorter at both ends by a distance — how a wall run keeps clear of its corners');
  ok(trimSpan(makeSpan('h', 0.4, 0.5), 20, H) === null, 'and null where nothing would be left');

  const runs = [makeSpan('h', 0, 0.3, { id: 'a' }), makeSpan('h', 0.3, 0.6, { id: 'b' }),
    makeSpan('h', 0.8, 1, { id: 'c' })];
  const merged = mergeSpans(runs, H);
  ok(merged.length === 2, 'two runs that meet end to end are ONE run');
  ok(near(merged[0].a, 0) && near(merged[0].b, 0.6), 'joined across the touch');
  ok(near(merged[1].a, 0.8), 'and the one with a real gap is left alone');
  ok(mergeSpans([runs[0]], H).length === 1, 'one run merges to itself');
  ok(mergeSpans([...runs].reverse(), H).length === 2,
    'and the input order does not matter — sorted before the sweep');

  ok(spansOn(runs, 'h').length === 3 && spansOn(runs, 'sq').length === 0,
    'the spans on one host can be found');
  const dep = dependentsOfSpan();
  ok(dep.points.length === 0 && dep.spans.length === 0,
    'a span hosts nothing, and says so rather than leaving the question out');
}

console.log('\n' + (fail ? `FAILED ${fail}` : 'all good'));
process.exit(fail ? 1 : 0);
