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
export const OPTION_LABEL = { standard: 'Standard', cove: 'Cove' };

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

export function optionsForChunk(chunk, opt = {}) {
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
  return out;
}

/** Which option a chunk actually has, tolerating a stale or unknown pick. */
export function resolvePick(chunk, picks = {}, opt = {}) {
  const options = optionsForChunk(chunk, opt);
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
 *   picks          key -> 'standard' | 'cove'. Absent means standard, and
 *                  nothing writes 'standard': a plan of ordinary ceilings
 *                  costs no state.
 *   strategy       the chunk-picker's id, passed down to the grid inside a
 *                  Standard chunk so one choice governs both levels
 *
 * Returns { plan, parts, coves }:
 *   parts   one entry per design chunk — its key, its options, what it got, and
 *           for a cove everything the ladder decided. This is what the canvas
 *           draws the option pill from.
 *   coves   the cove reports, in the shape the panel and the schedule read.
 */
export function planCeilingDesign({
  polygonFt, fixturesFt = [], zonesFt = [],
  designChunks = [], picks = {},
  opt = {}, chunkOpt = null, strategy = null,
  criteria = 20,
  fixtureFor = (kind) => kind,
  tolerance = COVE_TOLERANCE,
} = {}) {
  const o = resolveOptions({ ...DEFAULTS, ...opt });
  const co = chunkOpt ?? o;

  // --- 1. what each design chunk is -----------------------------------------
  const parts = designChunks.map((chunk) => {
    const { key, options, pick } = resolvePick(chunk, picks, o);
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
    return {
      key, chunk, options, pick: 'standard', kind: 'standard',
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
        + lumensOf(ch.coveFixture ?? fixtureFor(l.kind)));
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

  // --- 4. what everyone else is told ---------------------------------------
  const grid = gridLumensByDesign(res);
  const coves = coveParts().map((p) => coveReport(p, res, {
    criteria, tolerance, gridLumens: grid.get(p.key) || 0,
  }));

  return { plan: res, parts, coves };
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
