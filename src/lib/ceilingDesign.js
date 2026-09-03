// ---------------------------------------------------------------------------
// ceilingDesign.js — the ceiling design is chosen PER CHUNK, not per space.
//
// WHAT CHANGED, AND WHY IT HAD TO. A cove used to be a property of a SPACE:
// tick Cove on the room and one rectangle somewhere inside it got a dropped
// band. That reading breaks the moment a room is not a rectangle. An L-shaped
// living-dining room is two pieces of ceiling — the living end and the dining
// end — and a plasterer sets out a band over one of them, or over both, or over
// neither. "Cove: yes" cannot say which, so the app had to guess, and it
// guessed with the largest rectangle it could find.
//
// So the unit of the decision is the CHUNK, and the chunks come from the room
// OUTLINE — the ceiling as built. Furniture is deliberately not in that
// reading: a bed is a thing standing on the floor and it has no opinion about
// where a band of plasterboard is set out. It still moves the fittings (see
// `zonesFt` below), and inside a chunk that stays Standard it still cuts the
// grid up exactly as it always did.
//
// TWO LEVELS OF CHUNKING, AND THEY ANSWER DIFFERENT QUESTIONS.
//
//   design chunks   the room outline, minus the holes in the ceiling (shafts,
//                   enclosed rooms, reverse coves), cut into rectangles. These
//                   are the pieces somebody chooses a ceiling design for. An L
//                   gives two; a plain rectangle gives one.
//   inside a chunk  a Standard chunk is then gridded the ordinary way, WITH the
//                   furniture zones, so a bed still splits the grid round it. A
//                   Cove chunk is not: the cove line cuts it into an inside and
//                   a band, and that IS its decomposition.
//
// The consequence worth stating: a plain rectangular bedroom has exactly one
// design chunk, so its layout comes out identical to what this app produced
// before any of this existed. Nothing regressed to gain the L-shaped case.
//
// AND A THIRD THING A CHUNK CAN BE: A TRACK. It belongs in this file for the
// same reason the cove does — it is an answer to "what is this piece of ceiling"
// — but it enters the pipeline at the opposite end, and the asymmetry is worth
// stating once here rather than discovering it in step 3b.
//
//   a cove   changes the ceiling's SHAPE, so it has to be settled BEFORE the
//            layout: its line cuts the grid, and nothing may sit near it.
//   a track  changes nothing about the ceiling and nothing about the grid. It
//            is a profile set out TO THE FITTINGS, so it cannot be settled
//            until there are fittings to set it out to — it is laid over the
//            finished layout, and the fittings it reaches slide onto it and are
//            bought as track modules instead of as recessed downlights.
//
// So a track chunk is planned as a Standard one, start to finish, and the seven
// arrangements are seven ways of drawing a profile through that answer. The
// count of fittings, the cells they light and their spacing along a row are the
// Standard layout's, unchanged — which is the promise the option makes. See
// track.js.
//
// THE LADDER, ONCE PER COVE. cove.js explains it: a cove is an ambient source
// with a fixed output, so the question is whether the space under it needs
// downlights at all, and the answer is one of three rungs. With several coves
// on one plan each has its own answer — a small coved lobby may be carried by
// its strip alone while the big room next door needs its grid lit — so the
// stage is per cove and the passes escalate in lockstep: run the layout, ask
// every cove whether it is short, escalate the ones that are, run again. Three
// runs at most, which is what one cove has always cost.
//
// PURE. No React, no DOM. Feet in, feet out.
// ---------------------------------------------------------------------------

import { planLights, COVE_LUMENS_PER_FT, DEFAULTS, resolveOptions } from './planner.js';
import { enumerateChunkings, findChunking } from './chunking.js';
import { coveGeometry, bandFixtureFor, COVE_TOLERANCE } from './cove.js';
import { planTrack, isTrackPick, trackArrangementsFor,
         TRACK_ARRANGEMENTS, ABSORB_FT, WALL_CLEAR_FT } from './track.js';
import { FIXTURE_BY_ID } from './boq.js';

const R4 = (v) => Math.round(v * 1e4) / 1e4;

/**
 * THE NAME OF A CHUNK, AND IT IS ITS GEOMETRY.
 *
 * A pick has to survive a re-render, a nudge of the target-cell slider and a
 * reopened plan, and it must NOT survive somebody redrawing the room so that
 * the chunk no longer exists. An index would survive both, which is the failure
 * to avoid: chunk 2 of a room that has been re-traced is a different piece of
 * ceiling wearing the same name. The rectangle itself is the identity, so a
 * chunk that is still there keeps its cove and one that is gone loses it.
 */
export function chunkKey(r) {
  return [r.x0, r.y0, r.x1, r.y1].map((v) => R4(v).toFixed(3)).join(',');
}

/** A rectangle as a closed polygon, for the chunker to work inside. */
const rectPolygon = (r) => [
  { x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 },
  { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 },
];

/**
 * WHAT THIS PIECE OF CEILING COULD BE.
 *
 * Standard is always available — a flat slab with a grid on it is what any
 * ceiling can be. A cove is offered only where one can actually be built: the
 * inset is taken from the chunk's own shorter side and on a narrow chunk the
 * two insets meet, which coveGeometry reports by returning null. That is the
 * same test the geometry applies later, asked early enough that the picker
 * never offers an option that then declines.
 *
 * THE LIST IS THE ORDER THEY CYCLE IN, and Standard is first because it is the
 * default and because "flip forward to see what else is possible, flip back to
 * where you were" is the gesture this is for.
 */
export const OPTION_LABEL = {
  standard: 'Standard', cove: 'Cove',
  ...Object.fromEntries(TRACK_ARRANGEMENTS.map((t) => [t.id, t.label])),
};

/**
 * THE LEAST HIGHER CEILING A COVE CAN LEAVE AND STILL BE ONE.
 *
 * coveGeometry only refuses a chunk when the two insets MEET, which on a 2 ft
 * inset is anything over about 4½ ft across. That test was written when a cove
 * had to be the largest rectangle in a room, so it never had to say no to a
 * narrow one. Now that every chunk is offered the choice it does: a 5 ft chunk
 * would take a 2 ft band on both sides and leave a one-foot ribbon of high
 * ceiling in the middle, which is not a cove, it is a mistake with a strip in
 * it. Three feet is the least that reads as a raised centre from the floor.
 */
export const MIN_INNER_FT = 3;

/** "top and bottom", "left", "all four sides" — the sides a track runs along,
 *  said the way somebody would say them. */
const sideWords = (sides) => (sides.length === 4 ? 'all four sides'
  : sides.length === 1 ? `the ${sides[0]}`
  : `the ${sides.slice(0, -1).join(', ')} and ${sides[sides.length - 1]}`);

export function optionsForChunk(chunk, opt = {}, site = null) {
  const out = [{
    id: 'standard', label: OPTION_LABEL.standard,
    blurb: 'A flat ceiling with the ambient grid on it.',
  }];
  const geo = coveGeometry(chunk);
  if (geo && Math.min(geo.line.w, geo.line.h) >= MIN_INNER_FT) {
    out.push({
      id: 'cove', label: OPTION_LABEL.cove, offset: geo.offset,
      blurb: `A dropped band ${Math.round(geo.offset)} ft wide round this chunk, `
           + 'with a concealed strip washing the higher ceiling inside it.',
    });
  }
  // THE TRACKS, AND THEY ARE THE SAME KIND OF ANSWER AS THE COVE ABOVE: what
  // this piece of ceiling IS. Offered on size alone, because the option list
  // has to exist before the layout does — a chunk big enough for a run whose
  // lights turn out to give it nowhere to sit falls back to Standard when the
  // layout is built. See trackArrangementsFor, and `declined` in the parts.
  for (const t of trackArrangementsFor(chunk, site)) {
    out.push({
      id: t.id, label: t.label, short: t.short, sides: t.sides,
      blurb: `A track profile along ${sideWords(t.sides)} of this chunk, set out `
           + `through the ambient grid's own lines and kept ${WALL_CLEAR_FT} ft `
           + `clear of the walls. Every fitting within ${ABSORB_FT} ft of the run `
           + 'clips into it instead of into the slab; the grid itself does not '
           + 'change.',
    });
  }
  return out;
}

/** Which option a chunk actually has, tolerating a stale or unknown pick. */
export function resolvePick(chunk, picks = {}, opt = {}, site = null) {
  const options = optionsForChunk(chunk, opt, site);
  const key = chunk.key ?? chunkKey(chunk);
  const wanted = picks[key];
  const pick = options.some((o) => o.id === wanted) ? wanted : 'standard';
  return { key, options, pick };
}

/**
 * THE PIECES OF CEILING A DESIGN IS CHOSEN FOR.
 *
 * `builtZones` is the room as BUILT — hand-drawn zones, enclosed spaces and
 * reverse coves, which are holes in the ceiling or details already in it — and
 * deliberately not the furniture. See the header.
 *
 * `preferStrategy` is the reading of the space somebody already chose in the
 * chunk picker. The same id is offered at both levels of chunking, so "cut this
 * space into vertical bays" means the same thing to the design chunks and to
 * the grid inside a Standard one. It falls back to the recommendation when the
 * geometry no longer offers it.
 */
export function designChunking(polygon, builtZones = [], opt = {}, fans = [],
                               preferStrategy = null) {
  const all = enumerateChunkings(polygon, builtZones, opt, fans);
  const wanted = preferStrategy ? findChunking(all.options, preferStrategy) : null;
  const chosen = wanted || findChunking(all.options, all.recommendedId);
  const chunks = (chosen?.chunks ?? []).map((c) => ({ ...c, key: chunkKey(c) }));
  return {
    options: all.options,
    recommendedId: all.recommendedId,
    needsChoice: all.needsChoice,
    chosenId: chosen?.id ?? null,
    chosenBy: wanted ? 'requested' : 'auto',
    chunks,
    omitted: chosen?.omitted ?? [],
  };
}

/** What one fitting of this id delivers. The catalogue is the BOQ's, so the
 *  arithmetic here and the schedule cannot disagree about a 5 W lamp. */
const lumensOf = (id) => FIXTURE_BY_ID[id]?.lumens ?? 0;

/**
 * LAY OUT ONE SPACE, chunk by chunk, with each chunk's chosen ceiling.
 *
 *   polygonFt      the space
 *   zonesFt        what the FITTINGS must keep off — furniture included
 *   designChunks   from designChunking(), each carrying its `key`
 *   picks          key -> 'standard' | 'cove' | a track arrangement id. Absent
 *                  means standard, and nothing writes 'standard': a plan of
 *                  ordinary ceilings costs no state.
 *   strategy       the chunk-picker's id, passed down to the grid inside a
 *                  Standard chunk so one choice governs both levels
 *
 * Returns { plan, parts, coves, tracks }:
 *   parts   one entry per design chunk — its key, its options, what it got, and
 *           for a cove everything the ladder decided. This is what the canvas
 *           draws the option pill from.
 *   coves   the cove reports, in the shape the panel and the schedule read.
 *   tracks  one per chunk that got a track and could carry it: the runs, the
 *           corner joins, the length, and which fittings clipped into it. The
 *           fittings themselves also carry the stamp — see `plan.lights[].track`
 *           — so the drawing and the schedule read it off the fitting.
 */
export function planCeilingDesign({
  polygonFt, fixturesFt = [], zonesFt = [],
  // THE ROOM AS BUILT, and it is a DIFFERENT list from `zonesFt`. That one is
  // what the fittings keep off — furniture included. This is the holes in the
  // ceiling: shafts, enclosed rooms, reverse coves. It is the same list
  // `designChunking` was handed, and it is here because a track keeps a foot off
  // every WALL, and the wall of an enclosed WC standing in a living room is a
  // wall. Absent, a track keeps clear of the outline alone.
  builtZonesFt = [],
  designChunks = [], picks = {},
  opt = {}, chunkOpt = null, strategy = null,
  criteria = 20,
  // `(kind, cellSqft) => catalogueId`. The second argument is what lets a
  // bedroom's shallow cells be priced as the 5 W lamp they are actually bought
  // as — see fixtureForCell in roomTypes.js. A caller that ignores it gets the
  // room-level answer, which is what this defaulted to before it existed.
  fixtureFor = (kind) => kind,
  tolerance = COVE_TOLERANCE,
} = {}) {
  const o = resolveOptions({ ...DEFAULTS, ...opt });
  const co = chunkOpt ?? o;
  // The room as built, in the one shape track.js asks for. One object, so the
  // option list and the geometry cannot be asked about different rooms.
  const site = polygonFt?.length
    ? {
        polygon: polygonFt,
        holes: builtZonesFt,
        // AND THE ZONES A FITTING MAY NOT SIT IN, which is a third list and not
        // either of the other two. `holes` are holes in the CEILING and decide
        // where a wall is; these are what the FITTINGS keep off — the furniture
        // included — and they decide where a head may land. Absorption is the
        // one thing in this app that moves a fitting after the grid is settled,
        // so it is the one thing that has to ask.
        keepOff: zonesFt,
      }
    : null;

  // --- 1. what each design chunk is -----------------------------------------
  const parts = designChunks.map((chunk) => {
    const { key, options, pick } = resolvePick(chunk, picks, o, site);
    if (pick === 'cove') {
      const geo = coveGeometry(chunk);
      return {
        key, chunk, options, pick: 'cove', kind: 'cove', geo,
        bandFixture: bandFixtureFor(geo.offset),
        // Two feet of clearance either side of the cove line eats 4 ft of the
        // middle, so a line under about that across encloses no lightable
        // ceiling at all — see the note on rung 2 in cove.js.
        innerLightable: Math.min(geo.line.w, geo.line.h) > 2 * o.coveInside + 1e-9,
        stage: 'cove',
        innerSkipped: false,
      };
    }
    // A STANDARD CHUNK IS GRIDDED THE ORDINARY WAY, furniture and all. This is
    // the second level of chunking and the reason a plain bedroom comes out
    // exactly as it did before: the room is one design chunk, and this call is
    // then the same call the planner used to make on the whole room.
    const sub = enumerateChunkings(rectPolygon(chunk), zonesFt, co, fixturesFt);
    const wanted = strategy ? findChunking(sub.options, strategy) : null;
    const best = wanted || findChunking(sub.options, sub.recommendedId);
    //
    // AND A TRACK CHUNK IS GRIDDED THE SAME WAY, WHICH IS THE WHOLE POINT OF
    // ONE. A track does not touch the ceiling's shape and does not touch the
    // grid: the fittings come out exactly where Standard would have put them,
    // and the profile is drawn through them afterwards, once there is a layout
    // to draw it through. So there is nothing to do here beyond remembering
    // which arrangement was asked for. See track.js, and step 3b below.
    const track = isTrackPick(pick) ? pick : null;
    return {
      key, chunk, options,
      pick: track ?? 'standard', kind: track ? 'track' : 'standard',
      arrangement: track,
      chunks: best?.chunks ?? [], omitted: best?.omitted ?? [],
    };
  });

  const coveParts = () => parts.filter((p) => p.kind === 'cove');

  // --- 2. the chunk plan the planner is handed ------------------------------
  //
  // Every chunk carries `design`: the key of the design chunk it came out of.
  // That one stamp is what lets a light on the drawing be traced back to the
  // decision that put it there — click it, and the pill knows which chunk's
  // options it is flipping through.
  const buildPlan = () => {
    const chunks = [], omitted = [];
    for (const p of parts) {
      if (p.kind === 'cove') {
        chunks.push({ ...p.geo.line, design: p.key, cove: 'inner',
                      dark: p.stage === 'cove' });
        for (const b of p.geo.band) {
          chunks.push({ ...b, design: p.key, cove: 'band',
                        coveFixture: p.bandFixture, dark: p.stage !== 'band' });
        }
      } else {
        for (const c of p.chunks) chunks.push({ ...c, design: p.key });
        omitted.push(...p.omitted);
      }
    }
    return { id: 'design', label: 'Ceiling design', strategy: 'design', chunks, omitted };
  };

  const run = () => planLights(polygonFt, fixturesFt, {
    ...o,
    chunkPlan: buildPlan(),
    // EVERY COVE LINE IS A LINE NOTHING MAY CROWD, and they are handed over
    // together: a downlight in one chunk sitting two feet from the cove in the
    // next one is still a downlight flattening a cove's glow.
    coves: coveParts().map((p) => ({ ...p.geo.line })),
  }, zonesFt);

  // Which design chunk each light's lumens belong to. Only lights under a cove
  // are attributed at all — a downlight in a different part of the room is
  // lighting a different part of the room, and counting it here would let a
  // bright corridor talk a cove out of its own fittings.
  const chunkOf = (l) => (l.kind === 'small' ? l.cell?.chunk : l.chunk);
  const gridLumensByDesign = (res) => {
    const m = new Map();
    if (!res?.ok) return m;
    for (const l of res.lights) {
      const ch = res.chunks[chunkOf(l)];
      if (!ch?.cove) continue;
      m.set(ch.design, (m.get(ch.design) || 0)
        // THE CELL, NOT JUST THE KIND. The ladder is deciding whether a cove
        // needs more fittings, and it decides on lumens — so it has to count
        // the lamp the schedule will actually bill, not the one the room type
        // alone would name. A bedroom whose shallow rows buy the 450 lm lamp
        // and whose ladder counted them at 900 would talk a cove out of half
        // its fittings.
        + lumensOf(ch.coveFixture
                   ?? fixtureFor(l.kind, l.kind === 'small' && l.cell ? l.cell.w * l.cell.h : 0)));
    }
    return m;
  };

  // --- 3. the ladder, climbed in lockstep ----------------------------------
  let res = run();
  for (let pass = 0; pass < 2; pass++) {
    const grid = gridLumensByDesign(res);
    let escalated = false;
    for (const p of coveParts()) {
      const required = p.geo.chunkAreaSqft * criteria;
      const provided = p.geo.perimeterFt * COVE_LUMENS_PER_FT + (grid.get(p.key) || 0);
      if (required < tolerance * provided) continue;      // this cove is content
      if (p.stage === 'cove') {
        if (p.innerLightable) { p.stage = 'inner'; } else { p.innerSkipped = true; p.stage = 'band'; }
        escalated = true;
      } else if (p.stage === 'inner') {
        p.stage = 'band';
        escalated = true;
      }
      // 'band' is the last rung. A space still short with everything lit is a
      // real answer and the report says so.
    }
    if (!escalated) break;
    res = run();
  }

  // --- 3b. the tracks, drawn THROUGH the layout the grid already settled ---
  //
  // AFTER THE LADDER AND NOT BEFORE, and this is the one structural difference
  // between a track and a cove. A cove has to be settled first because its line
  // cuts the grid; a track cannot be settled first because it is set out to the
  // fittings, and until the grid has run there are no fittings to set it out
  // to. So everything above this line ran as though a track chunk were a plain
  // Standard one — which it is, as a ceiling — and this is where the profile is
  // laid over the answer.
  //
  // NOTHING HERE MOVES A LIGHT INTO OR OUT OF A CELL. Absorption changes a
  // fitting's POSITION and what it is BOUGHT as, and nothing else: the cell it
  // lights, the count, and the omissions are all exactly the Standard layout's,
  // which is the promise the option makes to the person flipping it.
  //
  // THE MOVE IS AT MOST `ABSORB_FT` ACROSS THE RUN plus half a head ALONG it.
  // The first is absorption — a fitting sliding onto the profile it is carried
  // by. The second is the body having a length: a twelve-inch head centred on
  // the corner of a closed track would hang half of itself off the end of the
  // profile, so it slides in by half its own length. See `nearestOn` in
  // track.js; both components are reported per fitting.
  const trackParts = parts.filter((p) => p.kind === 'track');
  const tracks = [];
  const moved = new Map();          // index into res.lights -> where it lands
  if (res?.ok) {
    const designOf = (l) => res.chunks[chunkOf(l)]?.design ?? null;
    for (const p of trackParts) {
      // This chunk's own ambient fittings, with their index kept, because the
      // answer has to be stamped back onto the very same objects.
      const mine = [];
      res.lights.forEach((l, i) => { if (designOf(l) === p.key) mine.push({ i, l }); });
      const t = planTrack(p.chunk, p.arrangement, mine.map((m) => m.l), o, site);
      if (!t) {
        // IT CAN DECLINE, AND THE DRAWING IS WHAT IT SAYS. A chunk whose lights
        // give the arrangement nowhere to sit gets the Standard ceiling it
        // already has, and the part says Standard — because that IS what is on
        // the drawing, and a pill reading TRACK over a chunk with no profile on
        // it would be the pill lying. `declined` keeps the request, so anything
        // that wants to explain the fallback can.
        p.kind = 'standard'; p.pick = 'standard';
        p.declined = p.arrangement; p.arrangement = null;
        continue;
      }
      t.absorbed.forEach((a, k) => {
        if (!a) return;
        // THE RUN'S AXIS TRAVELS WITH THE FITTING. A head clipped into a profile
        // lies ALONG it — it is a 200 x 25 mm body, not a disc — so the drawing
        // cannot draw one without knowing which way its run goes, and looking
        // that up from a light means the canvas re-deriving geometry it was
        // already handed. One field, stamped where the answer is known.
        moved.set(mine[k].i, { key: p.key, axis: t.runs[a.run].axis, ...a });
      });
      p.track = t;
      tracks.push({ key: p.key, chunk: p.chunk, ...t });
    }
  }

  // The layout, with the absorbed fittings sitting on the profile they are
  // clipped into. `gridPos` keeps where the grid actually put each one, so the
  // drawing can show the move and nobody has to take the claim above on trust.
  const plan = moved.size ? {
    ...res,
    lights: res.lights.map((l, i) => {
      const m = moved.get(i);
      if (!m) return l;
      return {
        ...l, x: m.x, y: m.y,
        gridPos: { x: l.x, y: l.y },
        track: m.key, trackRun: m.run, trackAxis: m.axis, trackAlong: m.along,
        // THE TWO COMPONENTS, KEPT APART. `trackPerp` is how far it came onto
        // the profile and is what the absorption zone bounds; `trackSlide` is
        // how far it moved along the profile to keep its body on it. Summing
        // them into one number would make a corner head look like a fitting
        // dragged further than the rule allows.
        trackPerp: m.perp, trackSlide: m.slide,
        trackMoved: Math.hypot(m.x - l.x, m.y - l.y) > 1e-6,
      };
    }),
  } : res;

  // --- 4. what everyone else is told ---------------------------------------
  const grid = gridLumensByDesign(res);
  const coves = coveParts().map((p) => coveReport(p, res, {
    criteria, tolerance, gridLumens: grid.get(p.key) || 0,
  }));

  return { plan, parts, coves, tracks };
}

/** What the panel, the schedule and the drawing are told about one cove. */
function coveReport(p, res, x) {
  const coveLumens = p.geo.perimeterFt * COVE_LUMENS_PER_FT;
  const requiredLumens = p.geo.chunkAreaSqft * x.criteria;
  const provided = coveLumens + x.gridLumens;
  return {
    ok: !!res?.ok,
    key: p.key,
    stage: p.stage,                 // 'cove' | 'inner' | 'band'
    offset: p.geo.offset,
    host: p.geo.host,     // the chunk the cove was set out in
    line: p.geo.line,     // the setting-out line: drawn, and what cuts the grid
    strip: p.geo.strip,   // the tape, 3 in outside it: installed, and billed
    band: p.geo.band,
    perimeterFt: p.geo.perimeterFt,
    chunkAreaSqft: p.geo.chunkAreaSqft,
    innerAreaSqft: p.geo.innerAreaSqft,
    bandAreaSqft: p.geo.bandAreaSqft,
    criteria: x.criteria,
    requiredLumens,
    coveLumens,
    gridLumens: x.gridLumens,
    providedLumens: provided,
    perSqft: provided / Math.max(1e-9, p.geo.chunkAreaSqft),
    bandFixture: p.bandFixture,
    sufficient: requiredLumens < x.tolerance * provided,
    tolerance: x.tolerance,
    innerSkipped: !!p.innerSkipped,
    reason: null,
  };
}
