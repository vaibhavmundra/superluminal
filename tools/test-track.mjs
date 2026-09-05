// ---------------------------------------------------------------------------
// test-track.mjs — a track is a profile drawn THROUGH the layout, not a
// different layout.
//
// Seven claims, and every assertion below belongs to one of them:
//
//   1. SEVEN ARRANGEMENTS, OFFERED ON WHAT A CHUNK CAN CARRY. All seven on a
//      room with room for them; the pairs withheld from a chunk too narrow to
//      hold two runs apart; none at all from a chunk a single run would swallow
//      whole.
//   2. THE RUNS GO THROUGH THE FIXTURES. Every run sits on a row or a column of
//      ambient lights, chosen to connect the most of them — which makes the
//      four-sided arrangement a rectangle round the outer ring, and a one-sided
//      one a line on the outermost row of the half it names.
//   3. THE GRID DOES NOT CHANGE. This is the promise the option makes and the
//      reason it is cheap: same number of fittings, same cells, and every
//      absorbed fitting moved at most the absorption zone ACROSS its run and
//      half a head ALONG it. Nothing was re-planned.
//   3b. A HEAD SITS WHOLLY ON ITS PROFILE. It is twelve inches long, so a run is
//      cut long enough to carry its end fittings, and one landing on the corner
//      of a closed track slides in by half its own length rather than hanging
//      off the end.
//   4. THE ZONE IS THREE FEET AND STOPS THERE. A fitting outside it keeps its
//      position and keeps its catalogue line.
//   5. TWO MODULES CANNOT OVERLAP — and that is the whole of it. They may
//      TOUCH. The rule exists for the one clash the perpendicular move creates
//      out of nothing (two fittings in one column, adjacent rows, landing on the
//      same inch of profile), not to second-guess a spacing the spot placer
//      already chose, and the threshold is therefore the smallest honest one:
//      the two half-bodies plus half an inch of clip.
//   6. THE SCHEDULE IS THE DRAWING, COUNTED. Profile in whole metres per run,
//      corner joins only where the track turns, and heads billed as heads
//      rather than as the recessed downlights they would have been.
//   6b. A RUN KEEPS A FOOT OFF EVERY WALL — and off walls, not off chunk edges.
//      A cove's band is drawn against the plaster; a track cannot be. The
//      clearance applies to the line, to the ends of an open run and to the
//      corners of a closed one, and it counts the wall of an enclosed room
//      standing inside the space. It does NOT apply to an internal cut between
//      two chunks, which is not a wall at all.
//   6c. REACH IS MEASURED FROM WHERE A FITTING MAY SIT, not from where the grid
//      happened to park it. A small light was never pinned to its cell centre —
//      the planner requires the centre BAND — so the absorption zone starts from
//      the nearest position it could legally occupy. And because that carries
//      fittings further, a head may not land inside a no-light zone: the profile
//      may cross a bed, a module on it may not.
//   7. IT CAN DECLINE, AND THE DRAWING SAYS SO. A chunk whose lights give an
//      arrangement nowhere to sit gets the Standard ceiling it already has.
//
//   node tools/test-track.mjs
// ---------------------------------------------------------------------------

import { designChunking, planCeilingDesign, optionsForChunk } from '../src/lib/ceilingDesign.js';
import { TRACK_ARRANGEMENTS, ABSORB_FT, MODULE_JOINT_FT, MIN_SPAN_FT,
         HEAD_LEN_FT, SPOT_LEN_FT, TRACK_DIMS_IN, OVERHANG_FT, END_MARGIN_FT,
         WALL_CLEAR_FT, moduleGap, fittingSlack,
         absorbPoints, trackArrangementsFor, trackRefusalsFor, planTrack,
         SINGLE_ACROSS_FT,
         trackBounds, wallSides } from '../src/lib/track.js';
import { buildBOQ, trackFixtureFor, trackMetres, FIXTURE_BY_ID } from '../src/lib/boq.js';
import { PLAN_OPTIONS } from '../src/lib/settings.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const say = (t) => console.log('\n' + t);
const opt = PLAN_OPTIONS;

const box = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const ALL = TRACK_ARRANGEMENTS.map((t) => t.id);

/** Distance from a point to a polygon's boundary. Written out here rather than
 *  imported, so the clearance assertions do not lean on the same helper the
 *  code under test uses to decide the clearance. */
function distanceToOutline(p, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 < 1e-12 ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}

/** Lay a room out with one pick on its (single) design chunk. */
function lay(polygon, pick = null) {
  const d = designChunking(polygon, [], opt, []);
  const key = d.chunks[0].key;
  const built = planCeilingDesign({
    polygonFt: polygon, designChunks: d.chunks,
    picks: pick ? { [key]: pick } : {}, opt, criteria: 20,
  });
  return { ...built, key, chunk: d.chunks[0], design: d };
}

// A room with a clean 4 x 2 grid of downlights on it: the shape every claim
// below is easiest to read on, and big enough that all seven arrangements fit.
const ROOM = box(24, 18);

// --- 1. seven arrangements, offered on what a chunk can carry --------------
say('1. SEVEN ARRANGEMENTS, OFFERED ON WHAT A CHUNK CAN CARRY');
{
  ok(TRACK_ARRANGEMENTS.length === 7, `there are exactly seven: ${ALL.length}`);
  ok(new Set(ALL).size === 7, '...with distinct ids');
  const sides = TRACK_ARRANGEMENTS.map((t) => t.sides.length).sort();
  ok(sides.join(',') === '1,1,1,1,2,2,4',
    'one of four sides, two of two, four of one — the sketch, exactly');
  ok(TRACK_ARRANGEMENTS.filter((t) => t.closed).length === 1,
    'and only the four-sided one is a closed circuit');

  const ids = optionsForChunk({ x0: 0, y0: 0, x1: 24, y1: 18 }, opt).map((o) => o.id);
  ok(ALL.every((id) => ids.includes(id)),
    'a 24 x 18 chunk is offered all seven, alongside standard and cove');
  ok(ids[0] === 'standard', '...with standard still first');

  // Narrow across, long along: a pair of horizontal runs cannot be two runs.
  const narrow = trackArrangementsFor({ x0: 0, y0: 0, x1: 30, y1: 7 }).map((t) => t.id);
  ok(!narrow.includes('track-2h') && !narrow.includes('track-4'),
    `7 ft across holds no PAIR of runs across it: ${narrow.join(' ') || 'none'}`);
  ok(narrow.includes('track-1t') && narrow.includes('track-1b'),
    '...but one run across it is fine');
  ok(narrow.includes('track-2v'),
    '...and a pair ALONG it is fine, because along it there is 30 ft');

  /* --- A NARROW BAND IS THE TRACK'S BEST CASE, NOT ITS WORST ---------------
     THIS TEST USED TO ASSERT THE OPPOSITE, and it is worth saying why it turned
     round. A chunk a single absorption zone would swallow whole was offered no
     track at all, on the reasoning that pulling every fitting onto one line is
     "a grid replaced by a line". True — and a grid replaced by a line is the
     right answer on a corridor, a galley, or the strip between a run of units
     and a wall, which is the one place a magnetic track is the obvious detail.
     The old rule refused it exactly there. See SINGLE_ACROSS_FT. */
  const strip = trackArrangementsFor({ x0: 0, y0: 0, x1: 20, y1: 5 },
    { polygon: box(20, 5), holes: [] }).map((t) => t.id);
  ok(strip.includes('track-1t') && strip.includes('track-1l'),
    `a 20 x 5 strip — 3 ft clear of its walls — is offered one run: ${strip.join(' ')}`);
  ok(!strip.includes('track-2h') && !strip.includes('track-4'),
    '...and still no PAIR, because two zones that cover each other are tramlines');

  ok(trackArrangementsFor({ x0: 0, y0: 0, x1: 20, y1: SINGLE_ACROSS_FT - 0.1 }).length === 0,
    `under ${SINGLE_ACROSS_FT} ft across, the ceiling is a reveal and gets nothing`);
  ok(trackArrangementsFor({ x0: 0, y0: 0, x1: 20, y1: SINGLE_ACROSS_FT }).length > 0,
    `...and at ${SINGLE_ACROSS_FT} ft it is a band, and gets a run`);
  /* THE BAND TEST IS ON THE CHUNK AND THE PAIR TEST IS ON THE USABLE REGION,
     which is the one asymmetry in this function. A 4 ft chunk walled both sides
     has 2 ft a profile may sit in — enough for a run, nowhere near enough for
     two — and measuring both questions on the same rectangle is what made the
     corridor above offer nothing. */
  ok(trackArrangementsFor({ x0: 0, y0: 0, x1: 20, y1: 4 },
       { polygon: box(20, 4), holes: [] }).length > 0,
    'a 4 ft chunk walled both sides still has somewhere for one profile to sit');
  ok(trackArrangementsFor({ x0: 0, y0: 0, x1: 20, y1: 2 },
       { polygon: box(20, 2), holes: [] }).length === 0,
    '...where a 2 ft one has none at all, and the usable region says so');

  ok(2 * ABSORB_FT + MIN_SPAN_FT === 8,
    `and the figures behind the pair are stated, not magic: ${ABSORB_FT} ft each side`);

  /* --- THE EXPLANATION CANNOT DISAGREE WITH THE DECISION -------------------
     `trackArrangementsFor` and `trackRefusalsFor` read the same predicate, and
     this is the assertion that keeps them doing so: across every shape and every
     wall arrangement, the two lists must PARTITION the seven — no arrangement in
     both, none in neither, and every refusal carrying a reason with a
     measurement in it. An explanation derived separately from the rule it
     explains is one that will eventually be confidently wrong, and the place
     that would surface is an operator reading a tooltip. */
  let partitioned = true, reasoned = true;
  for (const [w, h] of [[3, 3], [4, 4], [5, 20], [8, 8], [14, 7.5], [30, 7],
                        [24, 18], [2, 30], [4, 30], [10, 10]]) {
    for (const st of [null, { polygon: box(w, h), holes: [] }]) {
      const c = { x0: 0, y0: 0, x1: w, y1: h };
      const on = trackArrangementsFor(c, st).map((t) => t.id);
      const off = trackRefusalsFor(c, st);
      const ids = new Set([...on, ...off.map((r) => r.id)]);
      if (ids.size !== ALL.length || on.some((id) => off.some((r) => r.id === id))) {
        partitioned = false;
      }
      if (off.some((r) => !r.why || !/\d/.test(r.why))) reasoned = false;
    }
  }
  ok(partitioned,
    'offered and refused partition the seven exactly, at every size and wall set');
  ok(reasoned, '...and every refusal states a measurement, not just a verdict');
}

// --- 2. the runs go through the fixtures ----------------------------------
say('2. THE RUNS GO THROUGH THE FIXTURES');
{
  const base = lay(ROOM);
  const xs = [...new Set(base.plan.lights.map((l) => +l.x.toFixed(3)))].sort((a, b) => a - b);
  const ys = [...new Set(base.plan.lights.map((l) => +l.y.toFixed(3)))].sort((a, b) => a - b);
  ok(xs.length === 4 && ys.length === 2,
    `the room lays out as a ${xs.length} x ${ys.length} grid: x ${xs.join(' ')} / y ${ys.join(' ')}`);

  for (const id of ALL) {
    const r = lay(ROOM, id);
    const t = r.tracks[0];
    if (!t) { ok(false, `${id} produced a track`); continue; }
    const onALightLine = t.runs.every((rn) => (rn.axis === 'h'
      ? ys.some((y) => near(y, rn.a.y, 0.01))
      : xs.some((x) => near(x, rn.a.x, 0.01))));
    ok(onALightLine, `${id}: every run sits on a line of lights`);
  }

  const four = lay(ROOM, 'track-4').tracks[0];
  ok(four.closed && four.runs.length === 4 && four.corners === 4,
    'four sides is one closed rectangle with four corners');
  ok(near(four.rect.x0, xs[0]) && near(four.rect.x1, xs[3])
     && near(four.rect.y0, ys[0]) && near(four.rect.y1, ys[1]),
    'and it is the rectangle round the OUTER ring of fittings — the widest one there is');
  ok(lay(ROOM, 'track-4').plan.lights.filter((l) => l.track).length === 8,
    '...which is why it connects every fitting in the room: 8 of 8');

  const t1l = lay(ROOM, 'track-1l').tracks[0];
  const t1r = lay(ROOM, 'track-1r').tracks[0];
  ok(near(t1l.runs[0].a.x, xs[0]) && near(t1r.runs[0].a.x, xs[3]),
    `left and right are different answers, not one answer twice: ${t1l.runs[0].a.x} vs ${t1r.runs[0].a.x}`);
  const t1t = lay(ROOM, 'track-1t').tracks[0];
  const t1b = lay(ROOM, 'track-1b').tracks[0];
  ok(near(t1t.runs[0].a.y, ys[0]) && near(t1b.runs[0].a.y, ys[1]),
    `and so are top and bottom: ${t1t.runs[0].a.y} vs ${t1b.runs[0].a.y}`);

  const t2v = lay(ROOM, 'track-2v').tracks[0];
  ok(t2v.runs.length === 2 && t2v.corners === 0 && t2v.pieces === 2,
    'a parallel pair is two pieces of profile and turns no corners');
  ok(Math.abs(t2v.runs[0].a.x - t2v.runs[1].a.x) >= MIN_SPAN_FT,
    '...and the two are far enough apart to be two runs');
}

// --- 3. the grid does not change ------------------------------------------
say('3. THE GRID DOES NOT CHANGE');
{
  const base = lay(ROOM);
  const bLights = base.plan.lights;
  for (const id of ALL) {
    const r = lay(ROOM, id);
    const tLights = r.plan.lights;
    const sameCount = tLights.length === bLights.length;
    const sameCells = tLights.every((l, i) => (l.cells ?? []).join() === (bLights[i].cells ?? []).join()
                                              && l.kind === bLights[i].kind);
    ok(sameCount && sameCells,
      `${id}: ${tLights.length} fittings, lighting the same cells as the standard ceiling`);
  }

  const r = lay(ROOM, 'track-4');
  const moved = r.plan.lights.filter((l) => l.gridPos);
  ok(moved.length === r.plan.lights.filter((l) => l.track).length,
    'every absorbed fitting records where the grid put it');
  ok(moved.every((l) => l.trackPerp <= ABSORB_FT + 1e-9),
    `none came further than the absorption zone ACROSS its run: ${ABSORB_FT} ft`);
  ok(moved.every((l) => l.trackSlide <= HEAD_LEN_FT / 2 + 1e-9),
    `and none slid further ALONG it than half a head: ${HEAD_LEN_FT / 2} ft`);
  // Every move is one or the other, never a diagonal: a fitting comes onto the
  // profile square, and then travels only on it.
  const clean = moved.every((l) =>
    near(l.x, l.gridPos.x, 1e-9) || near(l.y, l.gridPos.y, 1e-9));
  ok(clean, 'and every move was square to the run or along it — never diagonal');

  // The four-sided track on this room passes exactly through every fitting, so
  // no fitting has to come ONTO the profile at all — the only movement left is
  // the four corner heads sliding in to get their bodies onto the carrier.
  ok(moved.every((l) => l.trackPerp < 1e-9),
    'on a grid the rectangle already runs through, nothing had to come onto it');
  const slid = moved.filter((l) => l.trackSlide > 1e-9);
  ok(slid.length === 4, `and only the four corner heads moved at all: ${slid.length}`);
  ok(slid.every((l) => near(l.trackSlide, HEAD_LEN_FT / 2)),
    `each by exactly half its own length: ${HEAD_LEN_FT / 2} ft`);

  const un = lay(ROOM).plan.lights;
  ok(un.every((l) => !l.track && !l.gridPos),
    'a standard chunk stamps none of this on anything');
}

// --- 3b. a head sits wholly on its profile -------------------------------
say('3b. A HEAD SITS WHOLLY ON ITS PROFILE');
{
  ok(TRACK_DIMS_IN.head.len === 12 && TRACK_DIMS_IN.head.wide === 1.5
     && TRACK_DIMS_IN.profile === 1.5,
    `the dimensions are stated in ONE place: profile ${TRACK_DIMS_IN.profile} in, `
    + `head ${TRACK_DIMS_IN.head.len} x ${TRACK_DIMS_IN.head.wide} in`);
  ok(near(OVERHANG_FT, HEAD_LEN_FT / 2 + END_MARGIN_FT),
    `and an open run's overhang is DERIVED from the head, not chosen: ${OVERHANG_FT} ft`);

  /** How far past a run's own ends this head's body reaches. Negative is good. */
  const overhang = (run, along) => {
    const half = HEAD_LEN_FT / 2;
    return Math.max(half - along, half - (run.lengthFt - along));
  };

  for (const id of ALL) {
    const r = lay(ROOM, id);
    const t = r.tracks[0];
    const bad = r.plan.lights.filter((l) => l.track)
      .filter((l) => overhang(t.runs[l.trackRun], l.trackAlong) > 1e-9);
    ok(bad.length === 0, `${id}: no head hangs off the end of its run`);
  }

  // The corner, stated directly. A closed run's ends ARE its corners, so a head
  // landing on one is the case the clamp exists for.
  const four = lay(ROOM, 'track-4');
  const t = four.tracks[0];
  const corners = four.plan.lights.filter((l) => l.trackSlide > 1e-9);
  ok(corners.every((l) => near(l.trackAlong, HEAD_LEN_FT / 2)
                          || near(l.trackAlong, t.runs[l.trackRun].lengthFt - HEAD_LEN_FT / 2)),
    'a corner head ends up exactly half a body in from the corner — flush, not proud');
  // And it went onto the LONGER of the two runs that meet there, so all four
  // corners of the rectangle answer the same way.
  const long = Math.max(...t.runs.map((rn) => rn.lengthFt));
  ok(corners.every((l) => near(t.runs[l.trackRun].lengthFt, long)),
    'and onto the longer of the two runs meeting at it, so all four agree');
  ok(new Set(corners.map((l) => l.trackAxis)).size === 1,
    `...which is why every corner head lies the same way: ${corners[0]?.trackAxis}`);

  // A directional body is shorter, so it is allowed nearer an end.
  const runs = [{ a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, side: 'top', axis: 'h', lengthFt: 10 }];
  const head = absorbPoints(runs, [{ x: 0, y: 0 }], { len: HEAD_LEN_FT });
  const spot = absorbPoints(runs, [{ x: 0, y: 0 }], { len: SPOT_LEN_FT });
  ok(near(head[0].along, HEAD_LEN_FT / 2) && near(spot[0].along, SPOT_LEN_FT / 2),
    `a 12 in head clamps to ${head[0].along} ft in from the end; a 6 in spot to `
    + `${spot[0].along} ft — each by half its own body`);
}

// --- 4. the zone is three feet and stops there ---------------------------
say('4. THE ZONE IS THREE FEET AND STOPS THERE');
{
  const r = lay(ROOM, 'track-1t');
  const ys = [...new Set(lay(ROOM).plan.lights.map((l) => +l.y.toFixed(3)))].sort((a, b) => a - b);
  const gap = ys[1] - ys[0];
  ok(gap > ABSORB_FT, `the two rows are ${gap} ft apart — more than the zone`);
  const took = r.plan.lights.filter((l) => l.track);
  ok(took.length === 4 && took.every((l) => near(l.y, ys[0], 0.01)),
    'so a run on the top row takes that row and nothing else: 4 of 8');
  const left = r.plan.lights.filter((l) => !l.track);
  ok(left.length === 4 && left.every((l) => !l.gridPos),
    'the far row is untouched — not moved, not restamped');
  ok(left.every((l) => trackFixtureFor(l.kind) && !l.track),
    '...and it is still bought as a recessed downlight');
}

// --- 5. two modules cannot overlap ---------------------------------------
say('5. TWO MODULES CANNOT OVERLAP');
{
  const seg = (x0, x1, y) => [{ a: { x: x0, y }, b: { x: x1, y },
                                side: 'top', axis: 'h', lengthFt: x1 - x0 }];
  // A horizontal run, and two fittings in the SAME COLUMN either side of it.
  // Both are inside the zone and both project onto the same inch of profile.
  const run = seg(0, 20, 10);
  const got = absorbPoints(run, [{ x: 8, y: 8.5 }, { x: 8, y: 12.5 }]);
  ok(got.filter(Boolean).length === 1,
    'two fittings that would land on the same point: only one is taken');
  ok(got[0] && !got[1], 'and it is the NEARER one — 1.5 ft beats 2.5 ft');
  ok(near(got[0].x, 8) && near(got[0].y, 10), 'which lands square on the run');

  // THE REQUIREMENT IS THE TWO BODIES PLUS A CLIP, and this is the claim that
  // matters — it is the one this rule got wrong twice. Stated as the arithmetic
  // rather than as a passing example, so a future change to the joint cannot
  // quietly re-break the pairs it was loosened for.
  ok(near(MODULE_JOINT_FT * 12, 0.5),
    `the joint is half an inch — they may touch, not overlap: ${(MODULE_JOINT_FT * 12).toFixed(1)} in`);
  ok(near(moduleGap(HEAD_LEN_FT, HEAD_LEN_FT) * 12, 12.5)
     && near(moduleGap(SPOT_LEN_FT, SPOT_LEN_FT) * 12, 6.5)
     && near(moduleGap(SPOT_LEN_FT, HEAD_LEN_FT) * 12, 9.5),
    'head+head 12.5 in, spot+spot 6.5 in, one of each 9.5 in — the halves plus the clip');

  // THE PAIR OFF THE ACTUAL DRAWING. Two task spots aimed opposite ways, 7.6 in
  // apart along the run with one of them 6.3 in off it — measured off the
  // screenshot that reported this as a bug. Both must be absorbed: two 6 in
  // bodies that far apart leave an inch and a half of clear carrier.
  const pair = absorbPoints(seg(0, 20, 10),
    [{ x: 8, y: 10 }, { x: 8 + 7.6 / 12, y: 10 - 6.3 / 12 }], { len: SPOT_LEN_FT });
  ok(pair.filter(Boolean).length === 2,
    'the pair off the drawing — 7.6 in apart — are BOTH absorbed');
  ok(pair[1] && near(pair[1].y, 10) && near(pair[1].perp, 6.3 / 12),
    '...the second coming 6.3 in onto the run, square to it');

  // AND THE CASE THE RULE ACTUALLY EXISTS FOR: same column, adjacent rows, both
  // landing on the same inch of profile. Zero apart, so any honest threshold
  // catches it — which is why the threshold can be the smallest honest one.
  const stacked = absorbPoints(seg(0, 20, 10), [{ x: 8, y: 9.5 }, { x: 8, y: 11.5 }],
                               { len: SPOT_LEN_FT });
  ok(stacked.filter(Boolean).length === 1,
    'two fittings landing on the same point: still only one, which is the point');
  const overlap = absorbPoints(seg(0, 20, 10),
    [{ x: 8, y: 10 }, { x: 8 + 5 / 12, y: 9.6 }], { len: SPOT_LEN_FT });
  ok(overlap.filter(Boolean).length === 1,
    'and two spots 5 in apart are refused — their bodies would overlap');
  // The same 10 in gap is fine for two spots and not for two heads, which is the
  // whole reason the figure is derived per pair.
  const asSpots = absorbPoints(seg(0, 20, 10),
    [{ x: 8, y: 10 }, { x: 8 + 10 / 12, y: 9.6 }], { len: SPOT_LEN_FT });
  const asHeads = absorbPoints(seg(0, 20, 10),
    [{ x: 8, y: 10 }, { x: 8 + 10 / 12, y: 9.6 }], { len: HEAD_LEN_FT });
  ok(asSpots.filter(Boolean).length === 2 && asHeads.filter(Boolean).length === 1,
    '10 in apart: fine for two 6 in spots, refused for two 12 in heads');

  // AND ACROSS THE TWO PASSES, with each side's own body length. The ambient
  // modules hold their slots and say how big they are, so the spot pass asks for
  // the right amount of room rather than assuming.
  const chunk = { x0: 0, y0: 0, x1: 20, y1: 20 };
  const lights = [{ x: 5, y: 10 }, { x: 15, y: 10 }];
  const t = planTrack(chunk, 'track-1t', lights);
  ok(t && t.occupied.length === 2, 'a track reports the slots its ambient heads hold');
  ok(t.occupied.every((o) => near(o.len, HEAD_LEN_FT)),
    '...and the length of the body holding each one');
  const spot = absorbPoints(t.runs, [{ x: 5, y: 11 }],
                            { len: SPOT_LEN_FT, occupied: t.occupied });
  ok(!spot[0], 'a spot aiming straight at an ambient head stays recessed');
  const beside = absorbPoints(t.runs, [{ x: 5 + 10 / 12, y: 11 }],
                              { len: SPOT_LEN_FT, occupied: t.occupied });
  ok(!!beside[0],
    '...but one 10 in along from it is taken — a spot needs 9.5 in beside a head, not 18');
  const clear = absorbPoints(t.runs, [{ x: 10, y: 11 }],
                             { len: SPOT_LEN_FT, occupied: t.occupied });
  ok(!!clear[0], 'and one with profile to itself, of course');
}

// --- 6. the schedule is the drawing, counted -----------------------------
say('6. THE SCHEDULE IS THE DRAWING, COUNTED');
{
  ok(trackFixtureFor('small') === 'track-ambient'
     && trackFixtureFor('large') === 'track-ambient'
     && trackFixtureFor('small-narrow') === 'track-ambient',
    'every ambient downlight becomes the ambient head — the range has one');
  ok(trackFixtureFor('spot') === 'track-spot'
     && trackFixtureFor('art-spot') === 'track-spot',
    'and every aimed spot becomes the directional head');
  ok(trackFixtureFor('strip') === 'strip',
    'a strip is not a thing a track can swallow, and is left alone');

  ok(trackMetres(54) === 16 && trackMetres(19.5) === 6,
    `whole metres: 54 ft -> ${trackMetres(54)} m, 19.5 ft -> ${trackMetres(19.5)} m`);
  ok(trackMetres(1.2) === 1, 'and a short run rounds UP to one, never out of existence');
  ok(trackMetres(0) === 0, 'while no run is no metres');

  const four = lay(ROOM, 'track-4');
  const t = four.tracks[0];
  const room = {
    id: 'r1', outline: { name: 'Bedroom' },
    plan: { ok: true, stats: { areaSqft: 24 * 18 },
            lights: four.plan.lights.map((l) => ({
              ...l, fixture: l.track ? trackFixtureFor(l.kind) : l.kind })) },
    tracks: [t],
  };
  const boq = buildBOQ({ rooms: [room], pxPerFt: 20, plan: 'test' });
  const line = (id) => boq.lines.find((l) => l.id === id);
  ok(!line('small') && !line('large'),
    'with every fitting on the track, the recessed lines are not on the order at all');
  ok(line('track-ambient')?.qty === 8,
    `and eight ambient heads are: ${line('track-ambient')?.qty}`);
  ok(line('track-profile')?.qty === trackMetres(t.lengthFt),
    `the profile is billed at ${line('track-profile')?.qty} m for ${t.lengthFt.toFixed(1)} ft of run`);
  ok(line('track-profile')?.pieces === 1,
    'as ONE piece, because a closed track is one circuit');
  ok(line('track-corner')?.qty === 4,
    `with four corner joins: ${line('track-corner')?.qty}`);
  ok(line('track-profile')?.load === 0 && line('track-corner')?.load === 0,
    'the carrier draws nothing, and says zero rather than nothing-stated');
  ok(!boq.totals.unstated.some((u) => u.id?.startsWith('track')),
    '...so it never appears in the load’s list of omissions');
  ok(boq.totals.stripMetres === 0,
    'and the track’s metres are NOT added to the tape figure');
  ok(boq.totals.trackMetres === trackMetres(t.lengthFt) && boq.totals.trackRuns === 1,
    `the summary reports the track on its own: ${boq.totals.trackMetres} m in ${boq.totals.trackRuns} run`);
  ok(boq.totals.watts === 8 * FIXTURE_BY_ID['track-ambient'].watts,
    `and the connected load is eight heads: ${boq.totals.watts} W`);

  const open = lay(ROOM, 'track-2h');
  const oRoom = { ...room, tracks: [open.tracks[0]],
    plan: { ...room.plan, lights: open.plan.lights.map((l) => ({
      ...l, fixture: l.track ? trackFixtureFor(l.kind) : l.kind })) } };
  const oBoq = buildBOQ({ rooms: [oRoom], pxPerFt: 20, plan: 'test' });
  ok(!oBoq.lines.find((l) => l.id === 'track-corner'),
    'a pair of open runs turns no corners, and no corner line is printed');
  ok(oBoq.lines.find((l) => l.id === 'track-profile')?.pieces === 2,
    'but it IS two pieces — two feeds, two sets of end caps');
}

// --- 6b. a run keeps a foot off every wall -------------------------------
say('6b. A RUN KEEPS A FOOT OFF EVERY WALL');
{
  const site = { polygon: ROOM, holes: [] };
  const chunk = { x0: 0, y0: 0, x1: 24, y1: 18 };

  const w = wallSides(chunk, site);
  ok(w.left && w.right && w.top && w.bottom,
    'in a plain rectangular room, all four of a chunk\u2019s edges are walls');
  const b = trackBounds(chunk, site);
  ok(near(b.x0, WALL_CLEAR_FT) && near(b.y0, WALL_CLEAR_FT)
     && near(b.x1, 24 - WALL_CLEAR_FT) && near(b.y1, 18 - WALL_CLEAR_FT),
    `so the usable region is set back ${WALL_CLEAR_FT} ft on every side`);

  // AN INTERNAL CUT IS NOT A WALL, and this is the assertion that matters most:
  // an L-shaped room cut into two rectangles has one edge per chunk that is
  // simply where the chunker stopped, and setting a run back from it would be
  // keeping clear of nothing.
  const Lroom = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 28 },
                 { x: 16, y: 28 }, { x: 16, y: 14 }, { x: 0, y: 14 }];
  const lsite = { polygon: Lroom, holes: [] };
  // The left arm: its RIGHT edge at x=16 runs along the inside corner for the
  // lower half and along nothing at all for the upper half.
  const arm = { x0: 0, y0: 0, x1: 16, y1: 14 };
  const aw = wallSides(arm, lsite);
  ok(aw.left && aw.top && aw.bottom,
    'the L\u2019s left arm knows its three outside edges are walls');
  // A chunk floating in the middle of a big room touches no wall at all.
  const island = { x0: 8, y0: 6, x1: 20, y1: 14 };
  const iw = wallSides(island, { polygon: ROOM, holes: [] });
  ok(!iw.left && !iw.right && !iw.top && !iw.bottom,
    'and a chunk touching no wall is set back from nothing');
  const ib = trackBounds(island, { polygon: ROOM, holes: [] });
  ok(near(ib.x0, 8) && near(ib.x1, 20) && near(ib.y0, 6) && near(ib.y1, 14),
    '...so its usable region is the whole of it');

  // A HOLE IN THE CEILING IS A WALL. An enclosed WC standing inside the space
  // has plaster on the outside of it, and a track against that is as wrong as
  // one against the outside wall.
  const hole = { x0: 0, y0: 0, x1: 8, y1: 7 };
  const hw = wallSides({ x0: 8, y0: 0, x1: 24, y1: 7 },
                       { polygon: ROOM, holes: [hole] });
  ok(hw.left, 'the edge a chunk shares with an enclosed room reads as a wall');

  // AND THE WHOLE THING, END TO END: no part of any run, in any arrangement,
  // comes within a foot of the outline.
  const clear = (p) => distanceToOutline(p, ROOM);
  for (const id of ALL) {
    const r = lay(ROOM, id);
    const t = r.tracks[0];
    if (!t) { ok(false, `${id} produced a track`); continue; }
    // Sampled along each run, because it is the ENDS of an open run that would
    // breach this — the run is cut past its last fitting, and that fitting is
    // the one nearest the wall.
    let worst = Infinity;
    for (const rn of t.runs) {
      for (let k = 0; k <= 20; k++) {
        const f = k / 20;
        worst = Math.min(worst, clear({ x: rn.a.x + (rn.b.x - rn.a.x) * f,
                                        y: rn.a.y + (rn.b.y - rn.a.y) * f }));
      }
    }
    ok(worst >= WALL_CLEAR_FT - 1e-6,
      `${id}: the nearest point of profile to a wall is ${worst.toFixed(2)} ft`);
  }

  // AND IT HAS TO BITE, not merely hold. In the room above the grid keeps its
  // fittings well clear of the plaster anyway, so every assertion so far would
  // pass with the clearance switched off. These two are the cases where the rule
  // actually changes the answer.
  const SQ = box(20, 20);
  const sq = { x0: 0, y0: 0, x1: 20, y1: 20 };
  const sqSite = { polygon: SQ, holes: [] };
  {
    // A ROW OF FITTINGS HALF A FOOT OFF THE WALL. The run is PULLED IN to the
    // clearance line and keeps the row — it does not abandon it for the far row,
    // which is what the first version of this rule did, and which cost a track
    // its best-connected line over six inches of plaster.
    const lights = [{ x: 5, y: 0.5 }, { x: 10, y: 0.5 }, { x: 15, y: 0.5 },
                    { x: 5, y: 10 }, { x: 10, y: 10 }];
    const t = planTrack(sq, 'track-1t', lights, {}, sqSite);
    ok(!!t && near(t.runs[0].a.y, WALL_CLEAR_FT),
      `the run is pulled in to the clearance line: y ${t?.runs[0].a.y}`);
    ok(t.absorbedCount === 3,
      `...and still takes the row it was set out to: ${t.absorbedCount} of 3`);
    ok(t.absorbed.filter(Boolean).every((a) => near(a.perp, 0.5)),
      'those three sliding the 6 in onto it, which is well inside the zone');
    const loose = planTrack(sq, 'track-1t', lights);
    ok(!!loose && near(loose.runs[0].a.y, 0.5),
      '...where with no room supplied it would have sat on the row itself');
  }
  {
    // An open run whose END would breach the clearance. The last fitting is
    // 1.2 ft from the wall and the run is cut 0.75 ft past it, which would put
    // the end of the profile 0.45 ft from the plaster.
    const lights = [{ x: 1.2, y: 10 }, { x: 8, y: 10 }, { x: 15, y: 10 }];
    const t = planTrack(sq, 'track-1t', lights, {}, sqSite);
    const x0 = Math.min(t.runs[0].a.x, t.runs[0].b.x);
    ok(near(x0, WALL_CLEAR_FT),
      `the run is cut short at the clearance rather than past it: x ${x0}`);
    const loose = planTrack(sq, 'track-1t', lights);
    ok(near(Math.min(loose.runs[0].a.x, loose.runs[0].b.x), 1.2 - OVERHANG_FT),
      '...where unconstrained it would have overhung into the wall');
  }

  // The gating is asked of the USABLE region, so an arrangement is never offered
  // on room the clearance has already taken away.
  const tight = { x0: 0, y0: 0, x1: 30, y1: 8 };
  const before = trackArrangementsFor(tight).map((t) => t.id);
  const after = trackArrangementsFor(tight, { polygon: box(30, 8), holes: [] }).map((t) => t.id);
  ok(before.includes('track-2h') && !after.includes('track-2h'),
    'a 30 x 8 corridor is 8 ft across and only 6 ft clear, so the pair is withdrawn');
  ok(after.includes('track-1t'),
    '...while one run down it is still on offer');
}

// --- 6c. reach is measured from where a fitting MAY sit ------------------
say('6c. REACH IS MEASURED FROM WHERE A FITTING MAY SIT, NOT WHERE IT SITS');
{
  // A small light goes at its cell centre, but the planner only ever required
  // the centre BAND — `centreBand` of the cell, searched for a spot that clears
  // the fans and the zones. Every position in that band is one the layout would
  // have accepted, so the absorption zone is measured from the nearest of them.
  const cell = (w, h) => ({ w, h, cx: 0, cy: 0, chunk: 0 });
  ok(near(fittingSlack({ cell: cell(2, 7) }, { centreBand: 0.2 }).x, 0.4),
    'a light in a 2 ft cell has 0.4 ft of legal slack across it');
  ok(fittingSlack({ kind: 'large' }, {}).x === 0,
    'a large light has none — its position is a solved point on a grid line, not a band');
  ok(fittingSlack({}, {}).y === 0, 'and neither has anything without a cell');

  const run = [{ a: { x: 0, y: 0 }, b: { x: 20, y: 0 }, side: 'top', axis: 'h',
                 lengthFt: 20 }];
  // THE CASE OFF THE DRAWING: 3.06 ft from the run, in a 2 ft strip beside a
  // bed. Three feet and three quarters of an inch — reported out of reach, while
  // the same light five inches inside its own cell is within it.
  const light = { x: 10, y: 3.056, cell: cell(2.04, 7) };
  const bare = absorbPoints(run, [{ x: light.x, y: light.y }]);
  ok(!bare[0], `measured from the nominal point it is out of reach: 3.056 ft > ${ABSORB_FT}`);
  const sl = fittingSlack(light, { centreBand: 0.2 });
  const withBand = absorbPoints(run, [{ x: light.x, y: light.y,
                                        slackX: sl.x, slackY: sl.y }]);
  ok(!!withBand[0], '...and measured from where it MAY sit, it is absorbed');
  ok(near(withBand[0].perp, 3.056) && near(withBand[0].slack, sl.y),
    `the report keeps the two apart: ${withBand[0].perp.toFixed(3)} ft in all, `
    + `of which ${withBand[0].slack.toFixed(2)} ft is the fitting's own band`);
  // The band is not a licence. Far enough out and it is still out.
  const far = absorbPoints(run, [{ x: 10, y: 5, slackX: sl.x, slackY: sl.y }]);
  ok(!far[0], 'a light 5 ft out is still out of reach — the band is inches, not feet');

  // AND THE CHECK THAT MAKES THE BAND SAFE TO ADD. Extending the reach carries
  // fittings further, and three feet is far enough to carry one over a bed. The
  // profile may cross a bed — it is a carrier, not a light — but a HEAD may not
  // land in that stretch of it.
  const bed = [{ x0: 6, y0: -1, x1: 14, y1: 1 }];
  const overBed = absorbPoints(run, [{ x: 10, y: 2, slackX: sl.x, slackY: sl.y }],
                               { keepOff: bed });
  ok(!overBed[0], 'a fitting whose landing point is inside a no-light zone is refused');
  const beside = absorbPoints(run, [{ x: 3, y: 2, slackX: sl.x, slackY: sl.y }],
                              { keepOff: bed });
  ok(!!beside[0], '...while one landing clear of it, on the same run, is taken');
  ok(near(beside[0].y, 0), 'and it lands on the run, which crosses the bed regardless');
}

// --- 7. it can decline ---------------------------------------------------
say('7. IT CAN DECLINE, AND THE DRAWING SAYS SO');
{
  // One row of lights down the middle: a pair of runs across it has only one
  // line to sit on, so both would land on top of each other.
  const chunk = { x0: 0, y0: 0, x1: 30, y1: 12 };
  const oneRow = [{ x: 5, y: 6 }, { x: 15, y: 6 }, { x: 25, y: 6 }];
  ok(planTrack(chunk, 'track-2h', oneRow) === null,
    'one row of fittings cannot carry two runs across it');
  ok(planTrack(chunk, 'track-1t', oneRow) !== null,
    '...but it carries one perfectly well');
  ok(planTrack(chunk, 'track-4', []) === null,
    'and a chunk with no fittings carries nothing');

  // AND THE SAME THING AS A WHOLE ROOM, so the part — which is what the pill
  // reads — is what gets checked.
  //
  // A 30 x 12 BEDROOM WITH THE BED TAKING NINE FEET OF IT. The DESIGN chunk is
  // still the whole room — furniture has no opinion about ceilings, see
  // ceilingDesign.js — so the pair is offered on size, and the offer is honest
  // about it. What the room then LAYS OUT with is one row of three downlights in
  // the three-foot strip the bed left, so the pair has a single line to sit on
  // and both runs would land on top of each other. That is the case the decline
  // exists for, and it is a real one: the two levels of chunking are asked
  // different questions and can disagree.
  const ROOM2 = box(30, 12);
  const BED = [{ x0: 0, y0: 3.2, x1: 30, y1: 12 }];
  const d = designChunking(ROOM2, [], opt, []);
  const key = d.chunks[0].key;
  ok(trackArrangementsFor(d.chunks[0], { polygon: ROOM2, holes: [] })
       .some((t) => t.id === 'track-2h'),
    'the room is OFFERED the pair — 12 ft across is 10 ft clear of the walls');
  const r = planCeilingDesign({
    polygonFt: ROOM2, designChunks: d.chunks, zonesFt: BED,
    picks: { [key]: 'track-2h' }, opt, criteria: 20,
  });
  const rows = [...new Set(r.plan.lights.map((l) => +l.y.toFixed(2)))];
  ok(rows.length === 1, `...but lays out with one row of fittings: y ${rows.join(' ')}`);
  const part = r.parts[0];
  ok(r.tracks.length === 0, 'so no track is produced');
  ok(part.kind === 'standard' && part.pick === 'standard',
    'the part reads Standard — which is what is actually drawn, so the pill cannot lie');
  ok(part.declined === 'track-2h',
    '...while keeping the request, so the fallback can be explained');
  ok(r.plan.lights.every((l) => !l.track), 'and no fitting claims to be on a track');
  ok(r.plan.ok, 'the layout is a layout, not an error');
  // And the single run it CAN carry, asked of the same room, still works.
  const one = planCeilingDesign({
    polygonFt: ROOM2, designChunks: d.chunks, zonesFt: BED,
    picks: { [key]: 'track-1t' }, opt, criteria: 20,
  });
  ok(one.tracks.length === 1 && one.parts[0].pick === 'track-1t',
    'while one run along that strip is exactly what it can carry');
}

console.log('\n' + (fail ? `${fail} FAILED` : 'all good'));
process.exit(fail ? 1 : 0);
