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
import { planTrack, isTrackPick, trackArrangementsFor, trackRefusalsFor,
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
  /* --- A CHUNK THAT IS ALREADY A DECISION -------------------------------
     A DRAWN COVE SHAPE HAS NO OPTIONS, and that is not a gap in the picker.
     Every other chunk here is a piece of ceiling the room's own outline
     produced, and the question "what is this piece" is genuinely open. A shape
     somebody drew is the ANSWER to that question already given, by hand, in a
     gesture whose entire purpose was to say "a cove goes here" — so offering to
     flip it to Standard would be offering to delete the thing they drew while
     leaving it on the drawing.
     It carries its geometry rather than having it derived, because the line is
     the shape's own bounding box and not an inset of anything. See
     ceilingShapes.js, and `coveGeo` in planCeilingDesign. */
  if (chunk?.coveGeo) {
    return [{
      id: 'cove', label: OPTION_LABEL.cove, offset: chunk.coveGeo.offset,
      blurb: 'A cove set out to a shape drawn on this ceiling.',
    }];
  }
  const out = [{
    id: 'standard', label: OPTION_LABEL.standard,
    blurb: 'A flat ceiling with the ambient grid on it.',
  }];
  /* --- A COVE IS NOT ON OFFER HERE ANY MORE, AND IT WAS FOR A LONG TIME.
     What used to be here: a cove set out by INSETTING this chunk, by a figure
     from OFFSET_STEPS. It went because it was never the automatic answer people
     assumed it was — nothing in this app ever picked it; `designPicks` starts
     empty, so every cove on every plan was already somebody pressing the pill.
     So there were two MANUAL ways to place a cove, and this was the one that
     could only ever be the whole chunk, inset uniformly, at a width from a
     table. A drawn cove is any shape, any size, anywhere, and it grids the same
     way. Keeping both meant two cove geometries, two meanings of `offset`, two
     band-fixture paths and two resize gestures, for one detail.

     WHAT THIS LIST IS NOW is what an AUTOMATIC pass can decide about a piece of
     ceiling: leave it flat, or run a track through the grid it produces. A cove
     is a thing somebody draws. See ceilingShapes.js.

     THE GEOMETRY STAYS. `coveGeometry` is still here and still correct, because
     a plan saved before this change may carry a coved chunk and must keep it —
     see the grandfather clause in `resolvePick`. Nothing can create a new one. */
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

/**
 * WHAT THIS CHUNK CANNOT BE, AND WHY — one entry per option it was not offered.
 *
 * FOR AN OPERATOR AND NOT FOR A DESIGNER. The pill offers what a piece of
 * ceiling CAN be, and that is the whole of what somebody laying out a plan
 * needs; a control that also recited everything it had ruled out would be
 * arguing with its own user. But when the offer looks wrong — a chunk that
 * plainly ought to take a track and does not — there is currently no way to find
 * out which figure refused it, and the only recourse is to read the source with
 * a ruler. This is that answer, behind the admin switch.
 *
 * IT IS DERIVED FROM THE SAME PREDICATES THAT DECIDE, never from a second
 * reading of them — see `arrangementFit` in track.js. An explanation computed
 * separately from the rule it explains is an explanation that will eventually be
 * confidently wrong.
 */
export function omittedOptionsFor(chunk, opt = {}, site = null) {
  if (!chunk) return [];
  if (chunk.coveGeo) return [];       // a drawn cove was never offered a choice
  /* NO COVE REASON, BECAUSE A COVE IS NOT REFUSED — it is not offered on any
     chunk at all, so there is nothing to explain about its absence. Reporting
     "this chunk is too narrow for a cove" on every chunk in the job would be
     explaining a rule that no longer exists. See optionsForChunk. */
  return trackRefusalsFor(chunk, site);
}

/**
 * THE NEXT OPTION AN ARROW ON THE PILL SHOULD LAND ON.
 *
 * PURE, AND HERE RATHER THAN IN THE COMPONENT, because it is the one piece of
 * this decision that used to be wrong in a way nothing could catch: it lived
 * inline in a click handler, indexed the wrong list by the wrong value, and the
 * symptom — "the right arrow never reaches the track, the left one does" — is
 * not something a test of the layout would ever see.
 *
 * TWO LISTS, TWO JOBS.
 *   `order`    every option this chunk's GEOMETRY allows, in a sequence that
 *              never changes shape. The arrows always mean the same traversal.
 *   `options`  what the finished LAYOUT can actually deliver — smaller, because
 *              an arrangement with nowhere to sit is gone and two that draw the
 *              same profile have collapsed into one. Nothing may be landed on
 *              that is not in here.
 *
 * AND IT STEPS FROM WHAT WAS ASKED FOR, not from what was built. An arrangement
 * that declines leaves `pick` reading 'standard' — correctly, that is what is on
 * the drawing — so stepping from `pick` put the cursor back at the top of the
 * list every time one declined, and the next press repeated the second entry.
 *
 * Returns null when there is nowhere else to go.
 */
export function nextChunkOption(chunk, dir = 1) {
  const options = chunk?.options ?? [];
  if (options.length < 2) return null;
  const order = chunk.order?.length ? chunk.order : options.map((x) => x.id);
  const avail = new Set(options.map((x) => x.id));
  const from = chunk.requested ?? chunk.pick;
  let i = order.indexOf(from);
  if (i < 0) i = Math.max(0, order.indexOf(chunk.pick));
  for (let k = 1; k <= order.length; k++) {
    const cand = order[(((i + dir * k) % order.length) + order.length) % order.length];
    if (avail.has(cand)) return cand === from ? null : cand;
  }
  return null;
}

/** Which option a chunk actually has, tolerating a stale or unknown pick. */
export function resolvePick(chunk, picks = {}, opt = {}, site = null) {
  const options = optionsForChunk(chunk, opt, site);
  const key = chunk.key ?? chunkKey(chunk);
  let wanted = picks[key];
  /* --- A COVE A SAVED PLAN ALREADY HAS -------------------------------------
     `optionsForChunk` no longer offers one, and without this a plan drawn before
     that change would reopen with every cove silently gone: the pick would not
     be in the list, `resolvePick` would fall back to Standard, and there would
     be no mark on the drawing to say a cove had ever been there. That is
     somebody's work disappearing on load.

     SO A STORED COVE IS HONOURED, AND ONLY A STORED ONE. The option is put back
     into the list for this chunk alone, so the pill still reads Cove and still
     flips through everything else the chunk can be — and once it is flipped
     away it is gone, because nothing offers it again. Grandfathered rather than
     migrated: converting somebody's saved design into drawn shapes on load is a
     rewrite of their data to save them one gesture. */
  if (wanted === 'cove' && !options.some((o) => o.id === 'cove')) {
    const geo = coveGeometry(chunk);
    if (geo && Math.min(geo.line.w, geo.line.h) >= MIN_INNER_FT) {
      options.splice(1, 0, {
        id: 'cove', label: OPTION_LABEL.cove, offset: geo.offset, legacy: true,
        blurb: `A dropped band ${Math.round(geo.offset)} ft wide round this chunk. `
             + 'Set out before coves were drawn by hand; flip away and it is gone.',
      });
    } else { wanted = null; }
  }
  /* THE FALLBACK IS THE FIRST OPTION AND NOT THE WORD "standard". They are the
     same thing on every chunk the chunker produced — Standard is always first
     in that list — and they part company on a chunk that has only one option,
     which is what a drawn cove shape is. Falling back to a literal 'standard'
     there would resolve a shape to a ceiling design it does not offer, and the
     branch below would then grid it as a flat slab with no cove on it. */
  const pick = options.some((o) => o.id === wanted) ? wanted : (options[0]?.id ?? 'standard');
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
  /* WHERE SOMEBODY DRAGGED A LIGHT TO, cell key -> offset from that cell's own
     centre. Passed through untouched: this file decides what a piece of ceiling
     IS, and where one fitting sits inside a cell is the planner's business. See
     `handMoves` in planner.js. */
  handMoves = null,
  /* ASK FOR THE REASONING. Off by default: `omittedOptionsFor` is seven
     predicates and a formatted string per chunk, on every room, on every
     re-layout, and nothing on a designer's screen reads it. See the note there
     for who it is for. */
  explain = false,
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
    // HERE AND NOT AT THE CALL SITE, because `site` is built in this function
    // and rebuilding it outside would be two readings of "the room as built"
    // that can disagree — which is the exact bug the chunking enumeration had.
    const omitted = explain ? omittedOptionsFor(chunk, o, site) : null;
    if (pick === 'cove') {
      /* THE SHAPE'S OWN GEOMETRY WINS WHERE THERE IS ONE. A cove set out by
         this app is an INSET of the chunk it lives in, so its geometry is
         derived; a cove somebody drew is a shape, and the rectangle here is the
         box that shape fits in — the line IS that box, the band is empty
         because the ceiling outside it is the room's own chunks, and the strip
         is the outline that was drawn. Everything below this line then treats
         the two identically, which is the point: the ladder, the clearance, the
         grid cut and the schedule all read `geo` and none of them has to learn
         that a cove can be round. */
      const geo = chunk.coveGeo ?? coveGeometry(chunk);
      return {
        key, chunk, options, omitted, pick: 'cove', kind: 'cove', geo,
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
      key, chunk, options, omitted,
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
          /* THE PIECE'S OWN LAMP WHERE IT HAS ONE. A derived cove's band is one
             uniform inset, so every piece of it is the same width and one answer
             does for all four — which is what `bandFixture` is. A DRAWN cove's
             ring is not uniform: each side is grown as far as that side of the
             room allows, so a four-foot piece and a one-foot piece can face each
             other across the same shape, and giving both the same lamp would put
             a 7 W cone across a one-foot strip on the strength of the other
             side's width. See coveHostFor. */
          chunks.push({ ...b, design: p.key, cove: 'band',
                        coveFixture: b.fixture ?? p.bandFixture,
                        dark: p.stage !== 'band' });
        }
      } else {
        for (const c of p.chunks) chunks.push({ ...c, design: p.key });
        omitted.push(...p.omitted);
      }
    }
    return { id: 'design', label: 'Ceiling design', strategy: 'design', chunks, omitted };
  };

  const run = () => planLights(polygonFt, fixturesFt, {
    ...o, handMoves,
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

  /* --- 3c. THE OPTIONS A CHUNK CAN ACTUALLY CARRY -------------------------
     `optionsForChunk` answers on GEOMETRY ALONE, because it has to: the list
     exists before the layout does. Now the layout has run, and two of its
     answers turn out to be wrong in ways a person flipping through the pill
     feels immediately.

     ONE: AN ARRANGEMENT THAT DECLINES IS STILL IN THE LIST. Flip to it, planTrack
     refuses, the chunk falls back to Standard and the pill reads STANDARD —
     honestly, because that is what is on the drawing. But the pill INDEXES the
     list by what it currently reads, so the next press starts from Standard
     again and you bounce between the first two entries forever. Pressing the
     other arrow walks backwards to the last entry, which is why a track could be
     reached going left and never going right. That is not a cycling bug to be
     patched in the caller; the list contained things that were never available.

     TWO: TWO NAMES FOR ONE DRAWING. A chunk whose fittings make a single column
     has one candidate line, so "Track · left" and "Track · right" both put the
     profile on it and produce the same four coordinates. Offering both is
     offering a choice that does not exist, and the person flipping cannot tell
     the two apart because there is nothing to tell apart.

     SO THE LIST IS RE-ASKED OF THE LAYOUT. Every offered arrangement is planned
     against the fittings that are actually in the chunk; the ones that refuse
     are dropped, and the ones that come out to the same profile collapse to one.
     THE PICKED ONE IS EVALUATED FIRST, so when two collapse it is the one
     somebody chose that survives — otherwise the pill would read STANDARD over a
     chunk with a track on it.

     AND A LONE SURVIVOR LOSES ITS SIDE. "Track · left" names the side so that
     seven of them can be told apart while flipping; with one there is nothing to
     tell apart, and the side is then a detail of the answer rather than a
     description of the choice. See the note on `label` in TRACK_ARRANGEMENTS,
     which makes the same argument the other way round. */
  if (res?.ok) {
    const designOf2 = (l) => res.chunks[chunkOf(l)]?.design ?? null;
    for (const p of parts) {
      if (!p.options.some((x) => isTrackPick(x.id))) continue;
      /* THE ORDER IS KEPT BEFORE ANYTHING IS TAKEN OUT OF IT, and it is what the
         pill steps through — see `order` in cycleChunkOption. The DISPLAYED list
         shrinks with the layout; the order a person flips in must not, or the
         arrows would mean something different depending on what the chunk
         currently is. */
      p.optionOrder = p.options.map((x) => x.id);
      /* AND A COVED CHUNK IS NOT PRUNED. Its fittings are the ones inside the
         cove line — none at all on rung 1 — so every track would refuse, and the
         pill would come out [Standard, Cove] with no way to reach a track from
         either of them. The question "could this piece of ceiling carry a track"
         is about the ceiling gridded normally, which is what a chunk currently
         wearing a cove is not. It keeps the geometric list; one press lands on a
         track, the chunk grids itself, and the press after that is answered by a
         pruned list like any other. */
      if (p.kind === 'cove') continue;
      const mine = res.lights.filter((l) => designOf2(l) === p.key);
      const order = [...p.options].sort(
        (a, b) => (b.id === p.pick ? 1 : 0) - (a.id === p.pick ? 1 : 0));
      const seen = new Set(), keep = new Set();
      for (const o of order) {
        if (!isTrackPick(o.id)) { keep.add(o.id); continue; }
        const t = planTrack(p.chunk, o.id, mine, o, site);
        if (!t) continue;
        // The profile itself, to three decimals, as the identity. Two
        // arrangements that draw the same four segments ARE the same answer.
        const sig = t.runs
          .map((r) => [r.a.x, r.a.y, r.b.x, r.b.y].map((v) => v.toFixed(3)).join(','))
          .sort().join('|');
        if (seen.has(sig)) continue;
        seen.add(sig);
        keep.add(o.id);
      }
      // Back into the list's own order — the sort above was only to give the
      // picked arrangement first refusal on a shared profile.
      p.options = p.options.filter((x) => keep.has(x.id));
      const tracksLeft = p.options.filter((x) => isTrackPick(x.id));
      if (tracksLeft.length === 1) tracksLeft[0].label = 'Track';
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
    /* --- AND THE SHAPE, WHERE THERE WAS ONE ------------------------------
       NULL ON EVERY COVE THIS APP SET OUT, which is the common case: those are
       rectangles and `line` and `strip` describe them completely. A cove drawn
       by hand is a rectangle to the GRID and an outline to the EYE, and these
       two lists are the outline — the setting-out line as drawn, and the tape
       three inches outside it. The canvas draws these where they exist and the
       rectangles where they do not; the schedule reads `perimeterFt`, which is
       the outline's own length either way and needs no branch at all. */
    shapeId: p.geo.shapeId ?? null,
    outline: p.geo.outline ?? null,
    stripOutline: p.geo.stripOutline ?? null,
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
