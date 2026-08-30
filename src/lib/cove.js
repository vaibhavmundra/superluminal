// ---------------------------------------------------------------------------
// cove.js — a cove ceiling, and what it does to the layout underneath it.
//
// A COVE IS NOT A FITTING YOU PLACE. It is a change to the CEILING: a band is
// dropped around the perimeter of the space, a pocket runs along the inside
// edge of that band, and a strip in the pocket washes the higher ceiling in the
// middle. Everything this file does follows from that one fact.
//
//   * The cove line is a rectangle, always, however the space is shaped. A
//     cove that followed an L-shaped room round its inside corner is a detail
//     nobody builds — the band is set out square and the room is squared up to
//     it — so the cove takes ONE CHUNK of the decomposition and insets it.
//
//   * The inset comes from a table, not from a formula. It is a joinery figure:
//     how wide the dropped band has to be to hide a pocket, carry a service
//     void and still read as a band rather than as a mistake. It scales with
//     the room in steps because that is how it is drawn. See OFFSET_STEPS.
//
//   * THE COVE LINE CUTS THE GRID, the way the room outline does. Inside it is
//     one grid, outside it is another, and no cell straddles the line. That is
//     what makes "put the downlights inside the cove" a statement about cells
//     rather than a filter applied afterwards.
//
//   * AND IT IS A LINE NOTHING MAY CROWD. Two feet clear on the room side, one
//     foot on the pocket side. A downlight closer than that on the inside
//     flattens the cove's own glow; one closer on the outside is a fitting in
//     the pocket's shadow. The planner enforces this — see `opt.coves`.
//
// THE LADDER. A cove is an ambient source with a fixed output — 120 lm per foot
// of run, delivered — so the first question is whether the room needs anything
// else at all. Three rungs, taken in order, and the layout stops at the first
// that meets the brief:
//
//   1. cove alone     no downlights in the host chunk at all
//   2. + inside       the grid inside the cove line is lit
//   3. + the band     the band outside it is lit too, with the smaller 5 W lamp
//                     where the band is narrow enough that a 7 W would spill
//
// "Meets the brief" is `required < TOLERANCE * provided` at every rung, and the
// tolerance is a deliberate 1.2: a cove is indirect light and a room lit to
// within a sixth of its figure by indirect light reads BETTER than one lit to
// the figure exactly by forty downlights. It is the one place in this app where
// the arithmetic is allowed to be generous, and it is generous on purpose.
//
// PURE. No React, no DOM. Feet in, feet out — the caller converts.
// ---------------------------------------------------------------------------

import { planLights, COVE_LUMENS_PER_FT, DEFAULTS, resolveOptions } from './planner.js';
import { elementaryGrid, prepareZones, enumerateChunkings, findChunking } from './chunking.js';
import { FIXTURE_BY_ID } from './boq.js';

/**
 * HOW FAR IN THE COVE LINE SITS, by the smaller dimension of the chunk it is
 * drawn in. Read as "up to `under` feet across, inset `offset` feet".
 *
 * A step table and not a ratio, because the band is built and a builder works
 * in feet: 2, 3, 4, 6, 8. A proportional rule would ask for a 3ft 7in band and
 * get a 3ft 6in one, and the drawing would then disagree with the room.
 *
 * The SMALLER dimension governs because the band is subtracted from both ends
 * of it — a 3ft inset in a 10ft room leaves 4ft in the middle, and the same
 * inset in the 30ft length of it is neither here nor there.
 */
export const OFFSET_STEPS = [
  // The first band is the only OPEN one — "less than 10 feet" — and every band
  // after it closes on its upper figure, so a room exactly 12 ft across takes
  // the 3 ft inset and one exactly 30 ft takes the 6. The bands as spoken
  // overlap at their ends ("10 to 12", "12 to 20"), and the earlier band wins:
  // the smaller inset leaves more ceiling, which is the safer way to be wrong
  // about a boundary case.
  { under: 10, offset: 2 },
  { upTo: 15, offset: 3 },
  { upTo: 20, offset: 4 },
  { upTo: 30, offset: 6 },
];
export const OFFSET_MAX = 8;   // over 30 ft

/** The inset for a chunk whose smaller side is `ft`. */
export function coveOffsetFor(ft) {
  for (const s of OFFSET_STEPS) {
    if (s.under != null ? ft < s.under : ft <= s.upTo) return s.offset;
  }
  return OFFSET_MAX;
}

/**
 * WHAT THE BAND IS LIT WITH, when it comes to that.
 *
 * A downlight in the band is lighting a strip of ceiling a few feet wide, from
 * a foot or two away from a wall on one side and the cove pocket on the other.
 * The ordinary 7 W at 36 degrees throws a cone wider than the band and puts
 * most of it up the wall; under about 6 ft of band the 5 W narrow lamp — the
 * same one a toilet's grid uses, and already a line in the schedule — is the
 * fitting that actually lands on the floor.
 *
 * 6 FT IS THE BREAK because that is roughly where the band stops being a strip
 * and starts being a piece of ceiling in its own right.
 */
export const NARROW_BAND_FT = 6;
export const bandFixtureFor = (offsetFt) =>
  (offsetFt < NARROW_BAND_FT ? 'small-narrow' : 'small');

/**
 * WHERE THE TAPE ACTUALLY SITS, relative to the line that is drawn.
 *
 * THREE INCHES OUTSIDE IT, and the two are not the same object. The cove line
 * is the SETTING-OUT line — the visible edge of the dropped band, the thing a
 * builder measures to and the thing the grid is cut on. The tape lives in the
 * pocket just behind that edge, where it cannot be seen from the room, which is
 * the entire point of a cove: you see the light and never the source.
 *
 * So the drawing carries both. The line is drawn as a line — dotted, thin, the
 * way any setting-out mark is drawn — and the strip is drawn as a strip, three
 * inches out, with the dots and the glow every other run on this sheet has.
 * Collapsing them into one mark would be drawing the tape where the plaster is.
 *
 * IT IS ALSO THE LENGTH THAT GETS BILLED. The run round the outside of the line
 * is a foot longer on each axis than the line itself, and it is the tape that
 * is bought by the metre.
 */
export const STRIP_OFFSET_FT = 0.25;   // 3 in

/** How much slack the brief is allowed. See the header. */
export const COVE_TOLERANCE = 1.2;

const rect = (x0, y0, x1, y1) => ({
  x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, area: (x1 - x0) * (y1 - y0),
});

/**
 * WHERE THE COVE GOES: THE LARGEST RECTANGLE THAT FITS IN THE SPACE.
 *
 * THIS USED TO ASK THE CHUNKER, AND THAT WAS THE WRONG QUESTION. A chunking is
 * a decomposition — a way of cutting the WHOLE space into pieces that tile it —
 * and the pieces it produces are shaped by everything the space contains and by
 * each other. Taking its biggest piece gets you the biggest part of one
 * particular cut, which is not the same thing as the biggest rectangle in the
 * room and in a room with anything in it is not even close: on an L-shaped
 * bedroom it handed back a tall strip up one side.
 *
 * A cove is a rectangle set out in a room. So the question is the direct one —
 * what is the largest rectangle that fits — and it is asked of the room's own
 * geometry with nothing else in the way.
 *
 * WHAT COUNTS AS "FITS". The elementary grid is the chunker's own: every wall
 * line and every hole edge crossed, so each cell is wholly inside the free
 * space or wholly outside it. Every maximal free rectangle has its top-left
 * corner on a free cell, so walking those anchors enumerates the real candidate
 * set rather than a sample of it.
 *
 * WHAT IS IN THE WAY, AND WHAT IS NOT, is the caller's decision and the whole
 * reason `zones` is a parameter rather than something read off the room: a
 * shaft, a void or an enclosed room is a hole in the ceiling and stops a cove
 * dead; a bed is furniture standing on the floor and does not. See coveZonesFt
 * in App.jsx.
 *
 * SEVERAL ANSWERS, NOT ONE. The largest is a good default and is often obvious,
 * but "largest" and "right" part company constantly — an L-shaped living-dining
 * room has one rectangle over each end and only a person knows which end the
 * cove belongs over. So this returns a short list of genuinely DIFFERENT
 * options, largest first, and the panel lets somebody pick.
 */
export function coveRectOptions(polygon, zones = [], opt = {},
                                { limit = 6, distinct = 0.72 } = {}) {
  const o = resolveOptions({ ...DEFAULTS, ...opt });
  if (!polygon || polygon.length < 4) return [];
  const grid = elementaryGrid(polygon, prepareZones(zones));
  if (grid.empty) return [];
  const { nx, ny, free, X, Y } = grid;

  const seen = new Set();
  const all = [];
  for (let i0 = 0; i0 < nx; i0++) {
    for (let j0 = 0; j0 < ny; j0++) {
      if (!free[i0][j0]) continue;
      let jMax = ny;   // the tallest usable span shrinks as the rectangle widens
      for (let i1 = i0; i1 < nx; i1++) {
        let j1 = j0;
        while (j1 < jMax && free[i1][j1]) j1++;
        jMax = j1;
        if (jMax === j0) break;
        const r = rect(X[i0], Y[j0], X[i1 + 1], Y[jMax]);
        const key = `${r.x0}|${r.y0}|${r.x1}|${r.y1}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // A rectangle that cannot carry a cove is not an option. The inset is
        // taken from its own shorter side, so this is the same test the
        // geometry applies later, asked early enough to keep the list honest.
        if (!coveGeometry(r)) continue;
        all.push(r);
      }
    }
  }

  // Biggest first. Squareness breaks ties and nothing more: a cove is judged on
  // how much ceiling it encloses, and a 4:1 rectangle that encloses more than a
  // square one is still the bigger cove. It is a TIEBREAK because two
  // rectangles of equal area are a real and common case on a rectilinear plan.
  all.sort((a, b) => (b.area - a.area)
    || (Math.min(b.w, b.h) / Math.max(b.w, b.h)) - (Math.min(a.w, a.h) / Math.max(a.w, a.h)));

  // DIFFERENT, not merely distinct. Six options that are the same rectangle
  // give or take a foot is a picker that costs a person six looks and offers
  // one choice, so anything that mostly overlaps something already kept is
  // dropped. `distinct` is an intersection-over-union ceiling.
  const overlap = (a, b) => {
    const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (w <= 0 || h <= 0) return 0;
    const inter = w * h;
    return inter / (a.area + b.area - inter);
  };
  const kept = [];
  for (const r of all) {
    if (kept.length >= limit) break;
    if (kept.some((k) => overlap(k, r) > distinct)) continue;
    kept.push(r);
  }
  return kept.map((r) => ({ ...r, offset: coveOffsetFor(Math.min(r.w, r.h)) }));
}

/**
 * The cove drawn in one chunk: the line itself, and the four pieces of band
 * left outside it.
 *
 * The band is cut into four rectangles the obvious way — two full-width runs
 * top and bottom, two shorter ones down the sides — because the chunk list the
 * planner takes is a list of rectangles and they must not overlap. Corners
 * belong to the horizontal runs.
 *
 * Returns null when the chunk cannot carry a cove at all: the inset would meet
 * itself in the middle, which happens only on a chunk about 4 ft across.
 */
export function coveGeometry(chunk, { offset = null } = {}) {
  // `chunk` is any rectangle in the room's own feet — a candidate from
  // coveRectOptions, or one somebody picked. The name is historical.
  if (!chunk) return null;
  const w = chunk.x1 - chunk.x0, h = chunk.y1 - chunk.y0;
  const small = Math.min(w, h);
  const off = offset ?? coveOffsetFor(small);
  // Half an inch of daylight either side of the middle. A "cove" whose two
  // insets touch is a dropped ceiling with no ceiling left.
  if (small <= off * 2 + 0.5) return null;

  const line = rect(chunk.x0 + off, chunk.y0 + off, chunk.x1 - off, chunk.y1 - off);
  // The tape, in the pocket behind the line. Always inside the chunk, because
  // the smallest inset in the table is 2 ft and this is 3 in.
  const strip = rect(line.x0 - STRIP_OFFSET_FT, line.y0 - STRIP_OFFSET_FT,
                     line.x1 + STRIP_OFFSET_FT, line.y1 + STRIP_OFFSET_FT);
  const band = [
    rect(chunk.x0, chunk.y0, chunk.x1, line.y0),          // top, corner to corner
    rect(chunk.x0, line.y1, chunk.x1, chunk.y1),          // bottom, corner to corner
    rect(chunk.x0, line.y0, line.x0, line.y1),            // left, between them
    rect(line.x1, line.y0, chunk.x1, line.y1),            // right, between them
  ].filter((r) => r.w > 1e-6 && r.h > 1e-6);

  return {
    offset: off,
    // THE RECTANGLE THE COVE WAS SET OUT IN, carried through so the panel can
    // say which of the options is in use and the picker can highlight it.
    host: rect(chunk.x0, chunk.y0, chunk.x1, chunk.y1),
    line,
    strip,
    band,
    // THE RUN IS THE PERIMETER OF THE TAPE, not of the line it hides behind —
    // see STRIP_OFFSET_FT. A cove is continuous, it turns the corner and
    // carries on, so this is one run of 2(w+h) and not four that happen to meet.
    perimeterFt: 2 * (strip.w + strip.h),
    chunkAreaSqft: w * h,
    innerAreaSqft: line.w * line.h,
    bandAreaSqft: w * h - line.w * line.h,
    smallerFt: small,
  };
}

/** What one fitting of this id delivers. The catalogue is the BOQ's, so the
 *  arithmetic here and the schedule cannot disagree about a 5 W lamp. */
const lumensOf = (id) => FIXTURE_BY_ID[id]?.lumens ?? 0;

/**
 * THE LADDER, run.
 *
 * Every rung is a complete `planLights` call on the same chunk plan with a
 * different set of chunks marked dark, and the result of the rung that stops is
 * the layout. Re-running rather than patching the previous answer is
 * deliberate: which cells are lit changes what the matching, the spacing repair
 * and the alignment pass all do, and a layout assembled by deleting fittings
 * from a bigger one is not a layout this engine would ever have produced.
 *
 * `chunks` is the decomposition to lay the cove into — the caller's business,
 * and see the note in App.jsx about which one that should be in a bedroom.
 */
export function planWithCove({
  polygonFt, fixturesFt = [], zonesFt = [], coveZonesFt = null,
  opt = {}, chunkOpt = null,
  rect: host = null,
  options: givenOptions = null,
  criteria = 20,
  offset = null,
  fixtureFor = (kind) => kind,
  tolerance = COVE_TOLERANCE,
} = {}) {
  const o = resolveOptions({ ...DEFAULTS, ...opt });
  // WHAT THE COVE IS SET OUT ON. Defaults to the same zones the lights obey,
  // and the caller overrides it to take the furniture back out — see the note
  // on coveRectOptions.
  const setOut = coveZonesFt ?? zonesFt;
  // The caller usually has these already — it has to, to offer the picker — so
  // it hands them back rather than paying for the search twice.
  const options = givenOptions ?? coveRectOptions(polygonFt, setOut, o);
  const rect0 = host ?? options[0] ?? null;
  const geo = rect0 ? coveGeometry(rect0, { offset }) : null;

  if (!geo) {
    return {
      plan: null,
      options,
      cove: { ok: false, options,
              reason: options.length
                ? 'That rectangle is too narrow for a cove — the two insets would meet.'
                : 'No rectangle in this space is big enough to carry a cove.' },
    };
  }

  // WHAT IS LEFT OF THE ROOM once the cove's rectangle is taken out of it, cut
  // into chunks the ordinary way. The cove rectangle is handed to the chunker
  // as a hole for exactly the length of this call: it is not a hole in the
  // ceiling, it is the piece that has already been dealt with, and the only
  // question left is how to grid whatever surrounds it.
  const rest = enumerateChunkings(
    polygonFt, [...setOut, { x0: geo.host.x0, y0: geo.host.y0, x1: geo.host.x1, y1: geo.host.y1 }],
    chunkOpt ?? o, fixturesFt);
  const restPick = findChunking(rest.options, rest.recommendedId);
  const others = restPick?.chunks ?? [];
  const omitted = restPick?.omitted ?? [];

  const bandFixture = bandFixtureFor(geo.offset);

  // The three chunk plans, differing only in what is dark. `cove: 'inner'` and
  // `cove: 'band'` ride along on the chunk so everything downstream — the
  // fixture stamp, the canvas, the panel — can tell the two apart without
  // re-deriving the geometry.
  const planFor = (stage) => ({
    id: 'cove', label: 'Cove ceiling', strategy: 'cove',
    chunks: [
      ...others,
      { ...geo.line, cove: 'inner', dark: stage === 'cove' },
      ...geo.band.map((b) => ({ ...b, cove: 'band', coveFixture: bandFixture,
                                dark: stage !== 'band' })),
    ],
    omitted,
  });

  const run = (stage) => planLights(polygonFt, fixturesFt, {
    ...o,
    chunkPlan: planFor(stage),
    coves: [{ ...geo.line }],
  }, zonesFt);

  // WHAT THE ROOM IS OWED, over the WHOLE of the cove's rectangle — band
  // included. The band is ceiling somebody stands under; a criterion applied
  // only to the middle would let a big offset quietly shrink the brief.
  const requiredLumens = geo.chunkAreaSqft * criteria;
  const coveLumens = geo.perimeterFt * COVE_LUMENS_PER_FT;
  const enough = (provided) => requiredLumens < tolerance * provided;

  // Which chunk each light ended up in, so its lumens can be attributed. A
  // small light knows its cell; a large one is stamped with the chunk whose
  // grid line it sits on.
  const chunkOf = (l) => (l.kind === 'small' ? l.cell?.chunk : l.chunk);
  const gridLumensOf = (res) => {
    if (!res?.ok) return 0;
    let sum = 0;
    for (const l of res.lights) {
      const ch = res.chunks[chunkOf(l)];
      // ONLY WHAT IS UNDER THE COVE COUNTS. A downlight in a different part of
      // the room is lighting a different part of the room; adding it here would
      // let a bright corridor talk the cove out of its own fittings.
      if (!ch?.cove) continue;
      sum += lumensOf(ch.coveFixture ?? fixtureFor(l.kind));
    }
    return sum;
  };

  const finish = (stage, res, gridLumens, extra = {}) => ({
    plan: res,
    options,
    cove: report(stage, res, geo, {
      requiredLumens, coveLumens, gridLumens, criteria, bandFixture, tolerance,
      options, ...extra }),
  });

  // --- rung 1: the cove on its own
  if (enough(coveLumens)) return finish('cove', run('cove'), 0);

  // --- rung 2: light the grid inside the cove line
  //
  // Unless there is nowhere inside to put one. Two feet of clearance either
  // side of the line eats 4 ft of the middle, so a cove line under about that
  // across encloses no lightable ceiling at all and rung 2 would place fittings
  // that the planner then has to flag as fouling the cove. Skip straight to the
  // band, which is where the light can actually go.
  const innerLightable = Math.min(geo.line.w, geo.line.h) > 2 * o.coveInside + 1e-9;
  if (innerLightable) {
    const res = run('inner');
    const gridLumens = gridLumensOf(res);
    if (enough(coveLumens + gridLumens)) return finish('inner', res, gridLumens);
  }

  // --- rung 3: the band as well
  const res = run('band');
  return finish('band', res, gridLumensOf(res), { innerSkipped: !innerLightable });
}

/** What the panel, the schedule and the drawing are told about the cove. */
function report(stage, res, geo, x) {
  const provided = x.coveLumens + x.gridLumens;
  return {
    ok: !!res?.ok,
    stage,                       // 'cove' | 'inner' | 'band'
    offset: geo.offset,
    host: geo.host,       // the rectangle the cove was set out in
    options: x.options || [],
    line: geo.line,       // the setting-out line: what is drawn, and what cuts the grid
    strip: geo.strip,     // the tape, 3 in outside it: what is installed and billed
    band: geo.band,
    perimeterFt: geo.perimeterFt,
    chunkAreaSqft: geo.chunkAreaSqft,
    innerAreaSqft: geo.innerAreaSqft,
    bandAreaSqft: geo.bandAreaSqft,
    criteria: x.criteria,
    requiredLumens: x.requiredLumens,
    coveLumens: x.coveLumens,
    gridLumens: x.gridLumens,
    providedLumens: provided,
    perSqft: provided / Math.max(1e-9, geo.chunkAreaSqft),
    bandFixture: x.bandFixture,
    // TRUE ONLY IF THE LAST RUNG ACTUALLY GOT THERE. A cove space that is still
    // short after everything has been lit is a real answer and the panel says
    // so — the alternative is a design that quietly under-lights and nobody
    // finds out until it is built.
    sufficient: x.requiredLumens < x.tolerance * provided,
    tolerance: x.tolerance,
    innerSkipped: !!x.innerSkipped,
    reason: null,
  };
}
