// ---------------------------------------------------------------------------
// track.js — a TRACK ceiling: what one is, where its runs land, and which
// fittings it swallows.
//
// A track is not a fitting and it is not a change to the plasterboard. It is a
// LINEAR CARRIER: a profile set into (or onto) a flat ceiling, into which
// modules clip anywhere along its length. Everything in this file follows from
// that one fact, and it is what makes a track cheap to implement next to a
// cove:
//
//   * A COVE CHANGES THE GRID. Its setting-out line cuts the ceiling into an
//     inside and a band, no cell straddles it, and nothing may sit near it. So
//     cove.js has to be consulted BEFORE the layout is planned.
//
//   * A TRACK CHANGES NOTHING ABOUT THE GRID. The room is lit by exactly the
//     downlights a Standard ceiling would have had, in exactly the positions a
//     Standard ceiling would have put them. The track is then drawn THROUGH
//     them, and the ones it reaches stop being recessed fittings and become
//     modules on the profile. So this file is consulted AFTER the layout, and
//     the layout it is handed is the ordinary one.
//
// That asymmetry is the whole design. A room whose chunk is flipped from
// Standard to Track keeps the same number of fittings, lighting the same cells,
// at the same spacing — which is the claim a person flipping the option needs
// to be able to trust. What changes is the SCHEDULE (a track module is a
// different product from a recessed downlight, and the profile is bought by the
// metre) and the DRAWING (the modules sit on the profile, because a module that
// is not on the profile cannot exist).
//
// WHERE THE RUNS GO: THROUGH THE FIXTURES, NOT AT AN INSET.
//
// A cove's band is set in from the wall by a joinery figure — see OFFSET_STEPS
// — because a cove is a piece of building and a builder works in feet. A track
// is set out by the ELECTRICIAN, to the lights, and the reason to run one at
// all is to gather a row of fittings onto a single circuit and a single
// profile. So a run is placed on a ROW OR COLUMN OF AMBIENT FIXTURES: the
// candidate positions are the grid's own light lines, and the one chosen is the
// one that puts the most fittings ON the profile. "Connect the maximum number
// of fixtures" is the rule, stated as a score.
//
// THE ABSORPTION ZONE, AND WHY IT IS THREE FEET EITHER SIDE.
//
// A module clips anywhere along a profile but nowhere across it, so a fitting
// off the line has to MOVE onto it to be carried. Three feet is how far one may
// be moved before the move stops being a detail of the same layout and becomes
// a different layout: it is under a fifth of the 50 sqft cell's own side, and
// under the 3.9 ft minimum spacing between two lights, so a fitting that slides
// that far is still lighting its own cell and still clear of its neighbours.
// Anything further away stays where it is and stays recessed.
//
// TWO MODULES CANNOT OVERLAP. The move is a PERPENDICULAR one — a fitting slides
// straight onto the profile and keeps its position along it — which preserves
// the spacing within a row and breaks it between rows: two fittings in the same
// column, in adjacent rows, both within three feet of one horizontal run, would
// land on the same inch of profile. The nearer one is absorbed and the further
// one stays recessed.
//
// HOW CLOSE IS TOO CLOSE IS THE TWO BODIES' BUSINESS, and the answer is that
// they may touch but not overlap. It is worth stating up here because getting it
// wrong was visible on a drawing, twice: a pair of task spots straddling a run
// came out with one absorbed and the other left recessed, first because the
// threshold was a single figure sized for the ambient head, and then because the
// joint allowance was still three inches. The rule is not here to second-guess
// the spot placer — a perpendicular move never brings two fittings closer than
// they already were — it is here to catch the two that would land on the same
// inch of profile. See MODULE_JOINT_FT and `absorbPoints`.
//
// THE SEVEN ARRANGEMENTS are the seven ways a rectilinear piece of ceiling can
// carry a track without the runs meeting at anything but a corner: all four
// sides as one closed rectangle, either opposite pair, or any one side alone.
// They are a CHOICE and not a derivation — which sides a track runs along is a
// design decision about how the room is used and lit, exactly as the chunking
// is — so this file enumerates them and scores the LINE POSITIONS within each,
// and somebody else picks the arrangement.
//
// PURE. No React, no DOM. Feet in, feet out.
// ---------------------------------------------------------------------------

import { distanceToBoundary } from './geometry.js';

/**
 * THE PRODUCT'S OWN DIMENSIONS, IN INCHES.
 *
 * ONLY THE LENGTHS ARE GEOMETRY. THE WIDTHS ARE DRAWING. That distinction is
 * worth stating because the file they came from made it look like one thing.
 *
 *   `head.len` / `spot.len`   LAYOUT. A body has to sit on the carrier it clips
 *                             to, so its length decides how far a run must be
 *                             cut past its last fitting and how far a head
 *                             landing on a corner slides in to stay on the
 *                             profile. Change these and positions move.
 *   `profile` / `*.wide`      DRAWING ONLY. A run's CENTRELINE is where the
 *                             fixtures are, and widening the profile from one
 *                             inch to one and a half moves nothing whatever —
 *                             the line is the same line, drawn heavier. Same for
 *                             a head across its run: it straddles the centreline
 *                             either way. Nothing in this file reads them.
 *
 * All five live here anyway, because "how big is a track head" should have one
 * answer and not two — the canvas reads the widths and the layout reads the
 * lengths. A schedule, a drawing and a layout each carrying their own idea of
 * how long a head is would eventually disagree about whether one fits.
 */
export const TRACK_DIMS_IN = {
  profile: 1.5,                    // the carrier, across
  head: { len: 12, wide: 1.5 },    // an ambient head
  spot: { len: 6, wide: 1.5 },     // a directional head
};

/** The same figures in feet, which is what everything below works in. */
const FT = (inches) => inches / 12;
export const HEAD_LEN_FT = FT(TRACK_DIMS_IN.head.len);
export const SPOT_LEN_FT = FT(TRACK_DIMS_IN.spot.len);

/**
 * HOW FAR A FITTING MAY BE FROM A RUN AND STILL BE CARRIED BY IT, each side.
 * See the header for why it is three feet and not four.
 */
export const ABSORB_FT = 3;

/**
 * HOW CLOSE ONE FITTING IS TO ITS OWN CANDIDATE LINE AND STILL COUNT AS "ON"
 * IT. The aligner has already snapped the lights into rows and columns within
 * `alignTol` (1.25 ft), and what survives that is a residue of a few inches —
 * so this is a hair over it. Wider and two genuinely different rows would score
 * as one; narrower and a row the aligner left three inches ragged would score
 * as none, and the run would be placed somewhere emptier.
 */
export const ON_TOL_FT = 0.75;

/**
 * HOW MUCH PROFILE RUNS PAST THE LAST MODULE, each end.
 *
 * DERIVED FROM THE HEAD, not chosen. The last head is centred on the last light
 * in the row, so half of it sticks out past that point — and a run that stopped
 * there would end under its own end fitting, which is not a thing that can be
 * built. So the run is cut long enough to carry the module (`HEAD_LEN_FT / 2`)
 * plus a visible margin of profile beyond it (`END_MARGIN_FT`), and if the head
 * ever changes length the run follows it rather than quietly starting to
 * overhang. That figure was a hard-coded 0.75 ft, which happened to be right for
 * an eight-inch head and would have been wrong for this one.
 *
 * It is not an inset from the wall: an open run is set out to the FITTINGS, so
 * its length follows the spread of the grid it gathers and not the room.
 */
export const END_MARGIN_FT = 0.25;                       // 3 in of visible profile
export const OVERHANG_FT = HEAD_LEN_FT / 2 + END_MARGIN_FT;

/**
 * THE LEAST CLEAR PROFILE BETWEEN TWO MODULE BODIES.
 *
 * HALF AN INCH, WHICH IS TO SAY: THEY MAY TOUCH, THEY MAY NOT OVERLAP. Modules
 * clip onto a magnetic carrier and sit adjacent as a matter of course; half an
 * inch is the clip and end-cap allowance and nothing more.
 *
 * IT TOOK TWO GOES TO GET HERE AND BOTH WRONG ANSWERS ARE WORTH RECORDING,
 * because they were the same mistake in different sizes. This began as ONE
 * constant — eighteen inches, centre to centre, whatever the two fittings were —
 * reasoned as "a twelve-inch head plus slack". Then it became the two
 * half-bodies plus a three-inch joint, which fixed the arithmetic and kept the
 * error: a pair of task spots seven and a half inches apart still needed nine,
 * and still came out with one of them absorbed and the other left recessed for
 * no reason anybody looking at the drawing could see.
 *
 * THE RULE IS NOT HERE TO SECOND-GUESS THE SPOT PLACER. That is the thing both
 * wrong answers assumed it was. Absorption moves a fitting PERPENDICULAR to the
 * run: it never brings two fittings closer together than they already were, so
 * whatever spacing the layout chose is a spacing the layout is entitled to. What
 * this exists for is the one case the perpendicular move creates out of nothing —
 * two fittings in the same column, in adjacent rows, projecting onto the same
 * inch of profile. That case is zero apart, and any honest threshold catches it.
 * So the honest threshold is the smallest one: the bodies must not occupy the
 * same space.
 *
 * `moduleGap` derives it per pair, so adding a third module length to the range
 * cannot silently get it wrong.
 */
export const MODULE_JOINT_FT = 0.5 / 12;      // half an inch

/** The least centre-to-centre distance between two bodies of these lengths. */
export const moduleGap = (a, b) => (a + b) / 2 + MODULE_JOINT_FT;

/**
 * HOW FAR A RUN KEEPS OFF A WALL.
 *
 * A COVE'S BAND IS DRAWN AGAINST THE WALL; A TRACK CANNOT BE. The band is
 * plasterboard and belongs to the perimeter — that is the detail. A track is a
 * surface or recessed extrusion carrying modules that throw light down and, in
 * the directional case, sideways, and against a wall all three of its facts turn
 * against it: the run is dead against the plaster on one side, half of every
 * head's cone lands on the wall instead of the floor, and there is nowhere to
 * stand to reach the modules it is meant to let you re-aim. A foot is the least
 * that reads as a run ON the ceiling rather than a shadow gap in it.
 *
 * IT IS MEASURED TO WALLS, NOT TO CHUNK EDGES, and the difference is the whole
 * reason `wallSides` exists. A design chunk's edge is sometimes a wall and
 * sometimes a line where the chunker cut one piece of ceiling from the next; a
 * track set back a foot from an imaginary line in the middle of a living-dining
 * room would be keeping clear of nothing.
 *
 * HOLES COUNT AS WALLS. The wall of an enclosed WC standing inside a living room
 * is a wall in every sense that matters here, and a shaft's edge likewise. They
 * arrive as the same `builtZones` the design chunks were cut around — see
 * ceilingDesign.js — so the two readings cannot drift apart.
 */
export const WALL_CLEAR_FT = 1;

/**
 * THE LEAST DISTANCE BETWEEN TWO PARALLEL RUNS, and between the two sides of a
 * rectangle. Two runs closer than this are one run with a gap in it: their
 * absorption zones overlap almost completely, so the second gathers nothing the
 * first did not, and what gets drawn is a pair of tramlines nobody would build.
 */
export const MIN_SPAN_FT = 2;

/**
 * THE SEVEN ARRANGEMENTS.
 *
 * `sides` is which edges of the chunk carry a run, and it is the whole
 * specification — the POSITIONS come from the fixtures (see `placeLine`).
 * `closed` marks the one arrangement whose runs form a continuous circuit: four
 * sides is ONE track that turns four corners, not four tracks that happen to
 * meet, and the difference is four corner joins on the schedule.
 *
 * THE ORDER IS THE ORDER THEY CYCLE IN, and it goes widest-first: four sides,
 * then the pairs, then the singles. Flipping through the list is how somebody
 * finds the arrangement they want, and starting from the most track and working
 * down is the direction that reads as "less, less, less" rather than as a
 * shuffle.
 *
 * `label` NAMES THE SIDES AND NOT THE COUNT. The sketch that specified this
 * feature labelled them "04 SIDES", "02 SIDES", "01 SIDES" — which is exactly
 * right as a drawing, where you can see which sides, and useless as a pill on
 * a screen, where four of the seven would read "01 SIDES". So the count is kept
 * as `short` for anywhere the drawing is reproduced, and the label names the
 * sides so the seven can be told apart while flipping through them.
 */
export const TRACK_ARRANGEMENTS = [
  { id: 'track-4',  sides: ['top', 'right', 'bottom', 'left'], closed: true,
    label: 'Track · 4 sides', short: '04 SIDES' },
  { id: 'track-2h', sides: ['top', 'bottom'], closed: false,
    label: 'Track · top + bottom', short: '02 SIDES' },
  { id: 'track-2v', sides: ['left', 'right'], closed: false,
    label: 'Track · left + right', short: '02 SIDES' },
  { id: 'track-1t', sides: ['top'], closed: false,
    label: 'Track · top', short: '01 SIDES' },
  { id: 'track-1b', sides: ['bottom'], closed: false,
    label: 'Track · bottom', short: '01 SIDES' },
  { id: 'track-1l', sides: ['left'], closed: false,
    label: 'Track · left', short: '01 SIDES' },
  { id: 'track-1r', sides: ['right'], closed: false,
    label: 'Track · right', short: '01 SIDES' },
];

export const TRACK_BY_ID = Object.fromEntries(TRACK_ARRANGEMENTS.map((t) => [t.id, t]));

/** Is this option id a track arrangement? The one test the rest of the app
 *  needs, so nothing else has to know how the ids are spelled. */
export const isTrackPick = (id) => !!TRACK_BY_ID[id];

/** Which axis a side's run lies along. 'h' — a horizontal run, placed by its y. */
const AXIS = { top: 'h', bottom: 'h', left: 'v', right: 'v' };

/**
 * A FITTING'S OWN LEGAL SLACK, and why the absorption zone is measured from it
 * rather than from where the grid happened to park the fitting.
 *
 * THE GRID NEVER PINNED IT THERE. A small light goes at the centre of its cell,
 * but the planner does not require the centre — it requires the CENTRE BAND, and
 * it searches within `centreBand` of the cell's own width and height for a spot
 * that clears the fans and the zones (see `findSmallSpot` and `centreBand` in
 * planner.js). Every position in that band is a position the layout was free to
 * choose and would have accepted.
 *
 * So "three feet from the run" was being asked of the wrong point. The honest
 * question is how far the fitting is from the run FROM THE NEAREST POSITION IT
 * COULD LEGALLY OCCUPY, and the answer is the gap less its band. Without this a
 * light in a two-foot strip beside a bed, three feet and half an inch from a
 * run, is reported as out of reach — while the same light nudged five inches
 * inside its own cell, which the layout would have been perfectly happy with, is
 * within it. Half an inch of arithmetic deciding whether a fitting joins a
 * circuit is not a decision, it is a rounding error.
 *
 * ONLY SMALL LIGHTS HAVE A BAND. A large light sits at a SOLVED position on a
 * shared grid line — one of a discrete set of candidates the matching chose
 * between, not a point with a tolerance round it — and a task spot's position is
 * its own placer's answer for the same reason. Giving either of them a band
 * would be inventing a freedom they do not have. Both arrive here without a
 * `cell` and get nothing, which is the right answer by construction.
 */
export function fittingSlack(light, opt = {}) {
  const c = light?.cell;
  if (!c || !(c.w > 0) || !(c.h > 0)) return { x: 0, y: 0 };
  const band = opt.centreBand ?? 0.20;
  return { x: c.w * band, y: c.h * band };
}

const EDGE_TOL = 0.05;          // ft — "this edge is on that boundary"

/** Is p within EDGE_TOL of the boundary of this rectangle? */
function onRectEdge(p, z) {
  const inside = p.x > z.x0 - EDGE_TOL && p.x < z.x1 + EDGE_TOL
              && p.y > z.y0 - EDGE_TOL && p.y < z.y1 + EDGE_TOL;
  if (!inside) return false;
  return Math.min(Math.abs(p.x - z.x0), Math.abs(p.x - z.x1),
                  Math.abs(p.y - z.y0), Math.abs(p.y - z.y1)) <= EDGE_TOL;
}

/**
 * WHICH OF A CHUNK'S FOUR EDGES IS A WALL.
 *
 * `site` is the room as BUILT: `{ polygon, holes }` — the outline, and the
 * things that are holes in the ceiling. Exactly the pair the design chunks were
 * cut from, which is what guarantees that every chunk edge is either on one of
 * these boundaries or is an internal cut between two chunks.
 *
 * SAMPLED ALONG THE EDGE, AND ANY HIT MAKES THE WHOLE EDGE A WALL. An edge can
 * be part wall and part cut: an L-shaped room split into two rectangles leaves
 * one of them with an edge that runs along the outside wall for some of its
 * length and along the neighbouring chunk for the rest. Deciding from the
 * midpoint alone would call that edge a cut and let a run sit hard against the
 * half of it that is plaster. So the conservative answer wins — clearance costs
 * a foot of ceiling, and getting it wrong costs a fitting against a wall.
 *
 * WITHOUT A `site` NOTHING IS A WALL. A headless call — a test, a script — gets
 * the geometry it asks for rather than a clearance measured against a polygon it
 * never supplied.
 */
export function wallSides(chunk, site = null) {
  const none = { left: false, right: false, top: false, bottom: false };
  if (!chunk || !site?.polygon?.length) return none;
  const holes = site.holes ?? [];
  const isWall = (p) => distanceToBoundary(p, site.polygon) <= EDGE_TOL
                     || holes.some((z) => onRectEdge(p, z));
  const SAMPLES = 9;
  const scan = (at) => {
    for (let i = 0; i <= SAMPLES; i++) {
      const f = i / SAMPLES;
      if (isWall(at(f))) return true;
    }
    return false;
  };
  const { x0, y0, x1, y1 } = chunk;
  return {
    left:   scan((f) => ({ x: x0, y: y0 + (y1 - y0) * f })),
    right:  scan((f) => ({ x: x1, y: y0 + (y1 - y0) * f })),
    top:    scan((f) => ({ x: x0 + (x1 - x0) * f, y: y0 })),
    bottom: scan((f) => ({ x: x0 + (x1 - x0) * f, y: y1 })),
  };
}

/**
 * THE PART OF A CHUNK A RUN MAY OCCUPY: the chunk, set back off every edge of
 * it that is a wall.
 *
 * One rectangle, and everything downstream works inside it — the candidate line
 * positions, the extent of an open run, and the corners of a closed one. Stating
 * the clearance once as a region beats testing it three times in three places
 * and eventually forgetting one.
 */
export function trackBounds(chunk, site = null, clear = WALL_CLEAR_FT) {
  const w = wallSides(chunk, site);
  return {
    x0: chunk.x0 + (w.left ? clear : 0),
    y0: chunk.y0 + (w.top ? clear : 0),
    x1: chunk.x1 - (w.right ? clear : 0),
    y1: chunk.y1 - (w.bottom ? clear : 0),
    walls: w,
  };
}

/**
 * WHAT A CHUNK IS BIG ENOUGH TO CARRY, on geometry alone.
 *
 * This is asked BEFORE the lights are known — the option list has to exist for
 * the picker, and the picker runs before the layout — so it can only rule out
 * the chunks that are too small on their face. A chunk that passes here and
 * then turns out to have no usable line to sit on is caught later: `planTrack`
 * returns null and the chunk falls back to Standard. Same shape as
 * `coveGeometry` refusing a narrow chunk, one step further down.
 *
 * A SINGLE RUN NEEDS `2 * ABSORB_FT` ACROSS. Any less and the absorption zone
 * covers the whole chunk from wall to wall, so every fitting in it is dragged
 * onto one line — which is not a track through a grid, it is a grid replaced by
 * a line, and if that is what the room wants it wants one run and one row of
 * lights, which is a different decision from this one.
 *
 * A PAIR NEEDS `2 * ABSORB_FT + MIN_SPAN_FT` — the two zones may touch but the
 * runs must be far enough apart to be two runs. See MIN_SPAN_FT.
 */
export function trackArrangementsFor(chunk, site = null) {
  if (!chunk) return [];
  // THE USABLE REGION AND NOT THE CHUNK, because the wall clearance is taken off
  // before any of these tests mean anything: a 7 ft chunk with walls both sides
  // has 5 ft a run may actually sit in, and offering it a pair of runs on the
  // strength of the 7 would be offering an arrangement that then declines.
  const b = trackBounds(chunk, site);
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  if (w <= 0 || h <= 0) return [];
  const single = 2 * ABSORB_FT;
  const pair = 2 * ABSORB_FT + MIN_SPAN_FT;
  return TRACK_ARRANGEMENTS.filter((t) => {
    const needH = t.sides.filter((s) => AXIS[s] === 'h').length;  // runs across
    const needV = t.sides.filter((s) => AXIS[s] === 'v').length;
    if (needH && h < (needH > 1 ? pair : single)) return false;
    if (needV && w < (needV > 1 ? pair : single)) return false;
    // A run has to have somewhere to run TO, as well as room across it: a
    // horizontal run in a chunk one foot wide is nine inches of overhang and
    // nothing else.
    if (needH && w < single) return false;
    if (needV && h < single) return false;
    return true;
  });
}

/**
 * THE CANDIDATE LINES ON ONE AXIS: the grid's own light lines, clustered.
 *
 * Lights that the aligner put in the same row are one candidate, not four, and
 * the cluster's position is the MEAN of its members rather than the first one's
 * — a run set out to the average of a row that is three inches ragged is at
 * most an inch and a half from any of them, where one set out to whichever
 * light happened to be first is three inches from the far end for no reason.
 */
function candidateLines(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const out = [];
  let group = [];
  for (const v of sorted) {
    if (group.length && v - group[group.length - 1] > ON_TOL_FT) {
      out.push(group); group = [];
    }
    group.push(v);
  }
  if (group.length) out.push(group);
  return out.map((g) => ({
    at: g.reduce((s, v) => s + v, 0) / g.length,
    on: g.length,
  }));
}

/**
 * WHERE ONE SIDE'S RUN GOES.
 *
 * The candidates are the light lines in the HALF of the chunk that side names —
 * a "left" run is a run in the left half, which is what makes the four
 * one-sided arrangements four different answers rather than one answer offered
 * four times. Within the half:
 *
 *   1. the most fittings ON the line. This is the rule the feature was asked
 *      for: connect as many as possible. A row of six beats a row of four
 *      whatever else is true, which is why it is worth a hundred of anything.
 *   2. then the most fittings the run would ABSORB, on-line and off-line
 *      together. Between two rows of six, the one with more strays within reach
 *      gathers more of the ceiling onto one circuit.
 *   3. then the OUTERMOST — leftmost for a left run, topmost for a top run.
 *      In an even grid every row scores the same on both counts above, and this
 *      is what decides it: a "left" track against the left of the fixture field
 *      is what somebody choosing "left" was asking for, and it leaves the
 *      middle of the ceiling clear. It is also what makes the four-sided
 *      arrangement come out as a rectangle round the outer ring of fittings,
 *      which is the drawing in the sketch.
 */
function placeLine(chunk, side, lights, bounds) {
  const axis = AXIS[side];
  const key = axis === 'h' ? 'y' : 'x';
  // THE HALVES ARE THE CHUNK'S; THE LEGAL RANGE IS THE BOUNDS'. Two different
  // questions: "is this line in the left half of this piece of ceiling" is about
  // the ceiling, and "may a run sit here at all" is about the walls. Splitting
  // the bounds instead would quietly shift what "left" means by half a foot on
  // a chunk walled on one side only.
  const lo = axis === 'h' ? chunk.y0 : chunk.x0;
  const hi = axis === 'h' ? chunk.y1 : chunk.x1;
  const mid = (lo + hi) / 2;
  const min = axis === 'h' ? bounds.y0 : bounds.x0;
  const max = axis === 'h' ? bounds.y1 : bounds.x1;
  const outer = side === 'top' || side === 'left';   // which end is "out"

  // A ROW TOO CLOSE TO THE WALL IS PULLED IN, NOT THROWN AWAY.
  //
  // It used to be filtered out, and that was wrong in the one case it fired: a
  // narrow strip of ceiling whose only row of fittings sits inside the wall
  // clearance would offer no candidate at all and the whole arrangement would
  // decline — when the obvious answer is a run at the clearance line with those
  // fittings sliding the few inches onto it. The inset is only a foot, so a
  // clamped candidate never moves more than a foot, which is well inside the
  // absorption zone. Clamping can only ADD candidates, never remove one.
  //
  // The SCORE is then taken at the clamped position, which makes the degradation
  // honest by itself: a row four inches outside the clearance still counts as
  // "on" the run once it is pulled in, and a row a foot outside no longer does —
  // it counts only as near, and loses to a row the run can sit on exactly.
  const clampAt = (v) => Math.min(max, Math.max(min, v));
  const seen = new Set();
  const all = [];
  for (const c of candidateLines(lights.map((l) => l[key]))) {
    const at = clampAt(c.at);
    const tag = at.toFixed(4);
    if (seen.has(tag)) continue;      // two rows either side of the clearance
    seen.add(tag);                     //   line collapse onto the same run
    all.push({ ...c, at });
  }
  // The half, with the midline available to both: a chunk with one row of
  // lights straight down the middle can still carry a left run or a right one,
  // and refusing both would be refusing the only line there is.
  const half = all.filter((c) => (outer ? c.at <= mid + ON_TOL_FT
                                        : c.at >= mid - ON_TOL_FT));
  const pool = half.length ? half : all;
  if (!pool.length) return null;

  let best = null;
  for (const c of pool) {
    const on = lights.filter((l) => Math.abs(l[key] - c.at) <= ON_TOL_FT).length;
    // REACH, NOT THE BARE ZONE. Each fitting is counted against what IT could
    // actually come from — the zone plus its own legal band. See fittingSlack.
    const near = lights.filter((l) => {
      const slack = key === 'y' ? (l.slackY ?? 0) : (l.slackX ?? 0);
      return Math.abs(l[key] - c.at) <= ABSORB_FT + slack;
    }).length;
    const score = on * 100 + near;
    if (!best || score > best.score
        || (score === best.score && (outer ? c.at < best.at : c.at > best.at))) {
      best = { at: c.at, on, near, score };
    }
  }
  return best;
}

const segment = (a, b, side) => ({
  a, b, side, axis: AXIS[side],
  lengthFt: Math.hypot(b.x - a.x, b.y - a.y),
});

/**
 * THE TRACK ITSELF: the runs, in the chunk's own feet.
 *
 * Returns null when the arrangement cannot be set out on these lights — no
 * candidate line, or a pair of lines too close together to be two runs. That is
 * not an error: the caller falls back to Standard and says so, exactly as a
 * chunk too narrow for a cove does.
 *
 * OPEN RUNS ARE SET OUT TO THE FITTINGS AND CLOSED ONES TO EACH OTHER, and
 * that difference is the reason this is one function rather than two loops:
 *
 *   open    a single run, or a parallel pair, spans the SPREAD OF THE GRID on
 *           the other axis plus an overhang. Not the room — a run that stopped
 *           at the wall would be carrying feet of profile past the last module
 *           at each end for nothing, and would read as a line drawn on the room
 *           rather than through the lights.
 *   closed  four sides is one circuit, so the ends are not free: each run stops
 *           where the next one starts, at the four intersections of the two
 *           chosen x lines and the two chosen y lines. There is no overhang
 *           because there is no end.
 */
export function trackGeometry(chunk, arrangementId, lights = [], site = null,
                              opt = {}) {
  const arr = TRACK_BY_ID[arrangementId];
  if (!arr || !chunk || !lights.length) return null;
  // The same bands `absorbPoints` will use, so a candidate line is scored on the
  // fittings it can actually reach rather than on a stricter reading the
  // absorption pass then disagrees with.
  lights = lights.map((l) => {
    if (l.slackX != null) return l;
    const sl = fittingSlack(l, opt);
    return { ...l, slackX: sl.x, slackY: sl.y };
  });
  const bounds = trackBounds(chunk, site);
  if (bounds.x1 - bounds.x0 <= 0 || bounds.y1 - bounds.y0 <= 0) return null;

  const at = {};
  for (const side of arr.sides) {
    const line = placeLine(chunk, side, lights, bounds);
    if (!line) return null;
    at[side] = line.at;
  }

  // Two runs on the same axis have to be two runs. See MIN_SPAN_FT.
  if (at.top != null && at.bottom != null
      && at.bottom - at.top < MIN_SPAN_FT) return null;
  if (at.left != null && at.right != null
      && at.right - at.left < MIN_SPAN_FT) return null;

  // CLAMPED TO THE BOUNDS AND NOT TO THE CHUNK. An open run's END is as much a
  // piece of profile as its middle, so the clearance applies to it too — and it
  // is the end that would breach it, because the run is cut past its last
  // fitting and that last fitting is the one nearest the wall.
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const xs = lights.map((l) => l.x), ys = lights.map((l) => l.y);
  const spanX = [clamp(Math.min(...xs) - OVERHANG_FT, bounds.x0, bounds.x1),
                 clamp(Math.max(...xs) + OVERHANG_FT, bounds.x0, bounds.x1)];
  const spanY = [clamp(Math.min(...ys) - OVERHANG_FT, bounds.y0, bounds.y1),
                 clamp(Math.max(...ys) + OVERHANG_FT, bounds.y0, bounds.y1)];

  let runs;
  if (arr.closed) {
    const x0 = at.left, x1 = at.right, y0 = at.top, y1 = at.bottom;
    const c = { tl: { x: x0, y: y0 }, tr: { x: x1, y: y0 },
                br: { x: x1, y: y1 }, bl: { x: x0, y: y1 } };
    runs = [
      segment(c.tl, c.tr, 'top'),
      segment(c.tr, c.br, 'right'),
      segment(c.br, c.bl, 'bottom'),
      segment(c.bl, c.tl, 'left'),
    ];
  } else {
    runs = arr.sides.map((side) => (AXIS[side] === 'h'
      ? segment({ x: spanX[0], y: at[side] }, { x: spanX[1], y: at[side] }, side)
      : segment({ x: at[side], y: spanY[0] }, { x: at[side], y: spanY[1] }, side)));
  }
  if (runs.some((r) => r.lengthFt < MIN_SPAN_FT)) return null;

  const lengthFt = runs.reduce((s, r) => s + r.lengthFt, 0);
  return {
    id: arr.id,
    sides: arr.sides,
    closed: arr.closed,
    label: arr.label,
    short: arr.short,
    runs,
    // FOUR CORNER JOINS OR NONE. A closed rectangle turns four corners and each
    // one is a MOULDED CORNER PIECE — a separate item, bought separately, and
    // the thing a schedule that only reported metres would quietly leave off
    // the order. An open run turns no corners; two parallel open runs still
    // turn none between them.
    corners: arr.closed ? 4 : 0,
    // WHAT A CLOSED CIRCUIT ENCLOSES, kept because it is the rectangle the
    // drawing wants as a polygon and re-deriving it from four segments is four
    // chances to get a corner wrong.
    rect: arr.closed
      ? { x0: at.left, y0: at.top, x1: at.right, y1: at.bottom }
      : null,
    lengthFt,
    // THE REGION IT WAS ALLOWED TO SIT IN, carried through so anything that
    // wants to explain a run's position — or draw the clearance while somebody
    // is choosing — has the rectangle rather than having to re-derive it from
    // the polygon.
    bounds: { x0: bounds.x0, y0: bounds.y0, x1: bounds.x1, y1: bounds.y1,
              walls: bounds.walls },
    // PIECES, for the schedule. A closed circuit is ONE track — it is cut and
    // joined on site, and the corner pieces are counted above — where two
    // parallel runs are two tracks with two sets of end caps and two feeds.
    pieces: arr.closed ? 1 : runs.length,
  };
}

/** Is this landing point inside a zone no fitting may sit in? */
function inKeepOff(p, zones) {
  for (const z of zones || []) {
    const x0 = Math.min(z.x0, z.x1), x1 = Math.max(z.x0, z.x1);
    const y0 = Math.min(z.y0, z.y1), y1 = Math.max(z.y0, z.y1);
    if (p.x > x0 + 1e-9 && p.x < x1 - 1e-9
        && p.y > y0 + 1e-9 && p.y < y1 - 1e-9) return true;
  }
  return false;
}

/**
 * WHERE ON A RUN A FITTING LANDS, and how far it had to come.
 *
 * TWO MOVEMENTS, REPORTED SEPARATELY, because they are answers to two different
 * questions and only one of them is a rule about absorption.
 *
 *   perp    straight onto the profile. This is the one the absorption zone is
 *           about — "within three feet of the run" means within three feet
 *           ACROSS it — and it is what the bids are ordered by.
 *   slide   along the profile, and only ever to keep the BODY on the carrier.
 *           A head is twelve inches long and clips onto the run; one centred on
 *           a corner of a closed track has half of itself hanging in mid-air off
 *           the end of the profile, which is not a fitting, it is a drawing
 *           mistake. `fit` is half the body, and the landing point is clamped
 *           into the run by that much at each end — so a head sitting exactly on
 *           a corner slides in by half its own length and no more, and one that
 *           already fits does not move at all.
 *
 * The clamp is continuous rather than a special case for corners: it is zero
 * everywhere except within half a body of an end, which is the only place the
 * problem exists.
 */
function nearestOn(run, p, fit = 0) {
  const dx = run.b.x - run.a.x, dy = run.b.y - run.a.y;
  const len2 = dx * dx + dy * dy;
  const len = Math.sqrt(len2);
  const t0 = len2 < 1e-12 ? 0
    : Math.max(0, Math.min(1, ((p.x - run.a.x) * dx + (p.y - run.a.y) * dy) / len2));
  const foot = t0 * len;
  const perp = Math.hypot(p.x - (run.a.x + dx * t0), p.y - (run.a.y + dy * t0));
  // A run shorter than the body it is asked to carry cannot satisfy the clamp at
  // both ends, so the body is centred on it instead — as close to right as the
  // geometry allows, and never a NaN from a reversed range.
  const along = len < 2 * fit ? len / 2
    : Math.min(Math.max(foot, fit), len - fit);
  const t = len < 1e-12 ? 0 : along / len;
  return {
    t, along, perp, slide: Math.abs(along - foot),
    x: run.a.x + dx * t, y: run.a.y + dy * t,
    dist: perp,
  };
}

/**
 * WHICH FITTINGS THE TRACK TAKES, and where each one lands on it.
 *
 * `points` is anything with an x and a y in the chunk's feet — ambient lights on
 * the first pass, directional spots on the second — and the answer is an array
 * the same length, holding null for a fitting the track does not reach and the
 * landing position for one it does.
 *
 * TWO PASSES, BECAUSE THE TWO LAYERS ARE PLANNED AT DIFFERENT TIMES. The
 * ambient grid is settled inside the ceiling design; the task and art spots are
 * placed later, against that grid. So the second call is told what the first
 * one already put on the profile, via `occupied`, and a spot that would land on
 * top of an ambient module stays recessed. Same rule as within a pass — see
 * MODULE_JOINT_FT — asked across the two, and asked of the two bodies' real
 * lengths, since a six-inch spot beside a twelve-inch head needs less room than
 * two heads do.
 *
 * NEAREST WINS, AND IT IS SETTLED IN ONE ORDER FOR A REASON. Sorting the
 * candidates by how far they have to move and taking them in that order means
 * the fitting that barely moves is never displaced by one dragged three feet:
 * the profile is a scarce resource and the fitting with the strongest claim to
 * a piece of it is the one that was nearly on it already.
 */
export function absorbPoints(runs, points = [], { absorb = ABSORB_FT,
                                                  len = HEAD_LEN_FT,
                                                  fit = null,
                                                  joint = MODULE_JOINT_FT,
                                                  keepOff = [],
                                                  occupied = [] } = {}) {
  const out = points.map(() => null);
  if (!runs?.length) return out;

  // `len` IS THE BODY BEING PLACED, and everything else follows from it: how far
  // it must sit from the end of a run to stay on it, and how much room it needs
  // beside its neighbours. `fit` can still be given explicitly, but half the
  // body is what it means and defaulting it here stops the two drifting apart.
  const clear = fit ?? len / 2;
  const taken = occupied.map((o) => ({ run: o.run, along: o.along,
                                       len: o.len ?? HEAD_LEN_FT }));
  const bids = [];
  points.forEach((p, i) => {
    if (p == null || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    // THE FITTING'S OWN LEGAL BAND, on the axis that matters. For a horizontal
    // run a fitting comes onto it in y, so the y band is what extends its reach.
    // Zero for anything the planner did not give a band — see fittingSlack.
    const slackFor = (run) => (run.axis === 'h' ? (p.slackY ?? 0) : (p.slackX ?? 0));
    let best = null;
    runs.forEach((run, ri) => {
      const n = nearestOn(run, p, clear);
      if (n.perp > absorb + slackFor(run) + 1e-9) return;
      // AND IT MAY NOT LAND SOMEWHERE A FITTING MAY NOT GO.
      //
      // The grid never puts a light in a no-light zone — the zones carve the
      // chunks, so the question cannot arise there — and absorption is the one
      // thing in this app that MOVES a fitting after the fact. Three feet is far
      // enough to carry one over a bed, and a track run crossing a bed is
      // perfectly normal: the profile is a carrier, not a light. What must not
      // happen is a HEAD in that stretch of it. Without this check, extending the
      // reach by the fitting's own band (just above) would have put a downlight
      // over a pillow in the first plan it was tried on.
      if (inKeepOff(n, keepOff)) return;
      // A CORNER FITTING IS EQUIDISTANT FROM TWO RUNS, AND THE LONGER ONE WINS.
      //
      // On a closed track the corner light sits at zero distance from both runs
      // that meet there, so something has to break the tie — and taken in list
      // order it would break inconsistently, putting one corner's head along the
      // top and the next one's down the side of the same rectangle. The longer
      // run wins instead: it has more profile to slide the body into, and it
      // means all four corners of a rectangle answer the same way, so the
      // drawing reads as one decision rather than four coincidences.
      const better = !best || n.perp < best.perp - 1e-9
        || (Math.abs(n.perp - best.perp) <= 1e-9 && run.lengthFt > best.runLength);
      if (better) best = { ...n, run: ri, runLength: run.lengthFt, slack: slackFor(run) };
    });
    if (best) bids.push({ i, ...best });
  });
  bids.sort((a, b) => a.perp - b.perp);

  for (const b of bids) {
    const clash = taken.some((t) => t.run === b.run
      && Math.abs(t.along - b.along) < moduleGap(len, t.len) - 1e-9);
    if (clash) continue;
    taken.push({ run: b.run, along: b.along, len });
    out[b.i] = { run: b.run, t: b.t, along: b.along, x: b.x, y: b.y, len,
                 dist: b.perp, perp: b.perp, slide: b.slide,
                 // How much of the perpendicular move was the fitting spending
                 // its OWN legal band, and how much was absorption proper. Kept
                 // apart because only the second is bounded by ABSORB_FT, and a
                 // report that summed them would look like a broken rule.
                 slack: Math.min(b.perp, b.slack ?? 0) };
  }
  return out;
}

/**
 * ONE CHUNK'S TRACK, GEOMETRY AND AMBIENT ABSORPTION TOGETHER.
 *
 * The one call the ceiling design makes. `lights` is this chunk's ambient
 * fittings, in the room's feet, and the answer carries both the profile and the
 * verdict on every one of them — so the caller stamps and never re-measures.
 *
 * Returns null when the arrangement cannot be set out (see `trackGeometry`), and
 * ALSO when it can be set out but reaches nothing: a track that carries no
 * fittings is a profile on a ceiling for decoration, which is not what any of
 * the seven arrangements means. Falling back to Standard is the honest answer.
 */
export function planTrack(chunk, arrangementId, lights = [], opt = {}, site = null) {
  const geo = trackGeometry(chunk, arrangementId, lights, site, opt);
  if (!geo) return null;
  const absorb = opt.trackAbsorb ?? ABSORB_FT;
  // EACH FITTING WITH ITS OWN LEGAL BAND ATTACHED, derived here so no caller has
  // to remember to and no two callers can derive it differently.
  const withSlack = lights.map((l) => {
    const sl = fittingSlack(l, opt);
    return { ...l, slackX: sl.x, slackY: sl.y };
  });
  // AN AMBIENT HEAD'S OWN LENGTH, stated rather than defaulted, because the
  // second pass hands a different one for the shorter directional body.
  const taken = absorbPoints(geo.runs, withSlack, {
    absorb, len: HEAD_LEN_FT, keepOff: site?.keepOff ?? [],
  });
  const n = taken.filter(Boolean).length;
  if (!n) return null;
  return {
    ...geo,
    absorb,
    // Parallel to `lights`: null, or where that light now sits on the profile.
    absorbed: taken,
    absorbedCount: n,
    // WHAT THE SECOND PASS NEEDS. The slots the ambient modules hold — WITH the
    // length of the body holding each one, because how much room a later spot
    // needs beside it depends on how big it is. Without that the second pass
    // would have to assume, and assuming is what the single gap constant did.
    occupied: taken.filter(Boolean).map((a) => ({ run: a.run, along: a.along,
                                                 len: HEAD_LEN_FT })),
    // The zones a head may not land in, carried through so the second pass obeys
    // the same rule without the caller having to hand them over twice.
    keepOff: site?.keepOff ?? [],
  };
}
