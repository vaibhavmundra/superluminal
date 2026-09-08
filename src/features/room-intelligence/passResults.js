/**
 * WHAT A MODEL ANSWER BECOMES, WITH NO REACT IN IT.
 *
 * Each of the three room passes is one network call wrapped in the same two
 * jobs: get the answer out of the crop's coordinate space and back onto the
 * plan, and then let the RULES — which are arithmetic, in lib/ — turn it into
 * fittings. Only the call needs a component; the rest is a function of its
 * arguments, and it is here so it can be read and tested without one.
 *
 * The controllers in this folder own the calls. Nothing in this file knows what
 * a request is.
 */
import { toPlanRect } from '../../lib/accentMask.js';
import { TYPE_BY_ID, FURNITURE_BY_ID } from '../../lib/accentPrompt.js';
import { SURFACE_BY_ID } from '../../lib/taskSurfaces.js';
import { WALL_BY_ID, joinPlacements } from '../../lib/wallPrompt.js';
import { zonesFromFurniture } from '../../lib/accentPlace.js';
import { bedsIn } from '../../lib/bedFit.js';

/**
 * ACCENTS: one payload, one room, one crop -> the result the reducer stores.
 *
 * `beds` is the AUTHORITATIVE bed list — bed-filter's, or the GPT bedroom
 * crop's — and not this pass's own boxes. See the note inside.
 */
export function accentResultFrom({ res, room: r, shot, beds = null, pxPerFt }) {
  // OUT OF THE CROP AND BACK ONTO THE PLAN. The model answered in fractions
  // of an image that was a cut-out of one room; every other rectangle in this
  // app is in plan pixels, and furniture left in the crop's space would sit in
  // the top-left corner of the sheet.
  const furniture = res.furniture.map((f, i) => {
    const t = FURNITURE_BY_ID[f.type];
    return {
      ...f,
      id: `furn-${r.id}-${i}`,
      rect: toPlanRect(f.rect, shot.crop, res.image),
      label: t?.label || f.type,
      colour: t?.colour || '#666',
    };
  });
  /* THE BED THE SCONCES HANG OFF IS THE BED-FILTER BOX, NEVER THIS PASS'S.
   *
   * The accent pass is asked what furniture is in the room. It answers about
   * beds too, and that box only ever had to be roughly right, because all it
   * was used for was deciding which wall to put a sconce on. A bedside sconce
   * is now placed a measured foot from the mattress edge, which makes the box
   * a DIMENSION rather than a hint — and the measured box already exists, from
   * bed-filter or (where bed-filter found nothing in a declared bedroom) from
   * the GPT bed pass.
   *
   * So this pass's own bed boxes are dropped and the authoritative ones
   * substituted, one furniture item per real bed. Two twins therefore produce
   * two symmetric pairs rather than one pair straddling both, which is what
   * happened when a single loose box covered the pair.
   *
   * NO AUTHORITATIVE BED MEANS NO SCONCES. If neither pass put a bed in this
   * room, the accent pass's belief that there is one is not promoted to a
   * position — a sconce derived from a rectangle nobody measured is a fitting
   * on a wall for a bed that may not be there. The room still gets its
   * wardrobe strips and everything else; the bed is simply not a bed until the
   * bed detector says so.
   */
  const mine = beds ? bedsIn(beds, r.plan.polygonPx) : [];
  const others = furniture.filter((f) => f.type !== 'bed');
  const dropped = furniture.length - others.length;
  const bedItems = mine.map((b, i) => ({
    type: 'bed', id: `furn-${r.id}-bed-${i}`, rect: b.rect,
    confidence: b.conf ?? 0.9,
    label: FURNITURE_BY_ID.bed?.label || 'Bed',
    colour: FURNITURE_BY_ID.bed?.colour || '#666',
    from: b.refound ? 'gpt-bedroom-crop' : 'bed-filter',
  }));
  if (dropped || bedItems.length) {
    console.log(`[beds] ${r.outline.name || r.id}: accents — dropped ${dropped} bed box(es)`
      + ` from the accent pass, using ${bedItems.length} from`
      + ` ${bedItems[0]?.from || 'no bed detector'}`);
  }
  const forRules = [...bedItems, ...others];

  // AND THEN THE RULES, IN CODE. The model was asked what furniture is in the
  // room and nothing else; this is where a bed becomes a pair of sconces one
  // foot clear of either end and a wardrobe becomes a strip along its own
  // length. Deterministic, so the house style is the same every run — see
  // accentPrompt.js's header for what happened when it was not.
  //
  // `pxPerFt` is passed because the bedside offset is a real distance now: one
  // foot from the mattress, not a fraction of it. Without a scale the rule
  // falls back to the old fraction rather than placing nothing.
  const { zones: placed, handled } = zonesFromFurniture(forRules, r.plan.polygonPx, { pxPerFt });
  const zones = placed.map((z, i) => ({
    ...z,
    id: `acc-${r.id}-${i}`,
    // Carried on the fitting so a drag handler knows which room's result list
    // to write back into. The zones live per-room in accentResults, and the
    // canvas draws them all in one flat pass.
    roomId: r.id,
    colour: TYPE_BY_ID[z.type]?.colour || '#666',
    label: TYPE_BY_ID[z.type]?.label || z.type,
    short: TYPE_BY_ID[z.type]?.short || z.type,
    // NO `runFt` HERE, deliberately. It used to be stamped on at placement
    // time and it was the one cached derivation on an accent zone — so the
    // moment a strip's end became draggable it started lying, because a drag
    // works in plan pixels and cannot know the scale. Feet are derived where
    // they are shown, from `runLength` and the live px/ft. See runMetres.
  }));
  return {
    ...res,
    // WHAT THE RULES ACTUALLY SAW, so the "show what was identified" overlay
    // draws the bed the sconces were derived from rather than a box that was
    // discarded before any of this ran.
    furniture: forRules,
    // ...and what was discarded, kept separately so the audit panel can say
    // how many accent-pass beds were excluded instead of silently showing a
    // zero nobody can interpret.
    bedsFromAccentPass: furniture.filter((f) => f.type === 'bed'),
    handled, zones,
  };
}

/** TASK SURFACES: the same crop-to-plan conversion, and a size in feet. */
export function surfaceResultFrom({ res, room: r, shot, pxPerFt }) {
  const surfaces = res.surfaces.map((sf, i) => {
    const rect = toPlanRect(sf.rect, shot.crop, res.image);
    const t = SURFACE_BY_ID[sf.type];
    return {
      ...sf,
      id: `surf-${r.id}-${i}`, roomId: r.id, rect,
      colour: t?.colour || '#666', label: t?.label || sf.type,
      widthFt: pxPerFt ? (rect.x1 - rect.x0) / pxPerFt : null,
      heightFt: pxPerFt ? (rect.y1 - rect.y0) / pxPerFt : null,
    };
  });
  return { ...res, surfaces };
}

/** THE RENDER PASS, PROMPT 01: what was read off the photographs. */
export function wallElementsFrom({ res, roomId }) {
  return (res?.elements ?? []).map((e, i) => ({
    ...e,
    id: `wall-${roomId}-${i}`,
    roomId,
    label: WALL_BY_ID[e.type]?.label || e.type,
    colour: WALL_BY_ID[e.type]?.colour || '#666',
  }));
}

/** THE RENDER PASS, WITH NOTHING SEEN. Short-circuited before PROMPT 02. */
export function wallResultNoneSeen({ first }) {
  return { elements: [], skipped: first?.skipped ?? [], placedNone: false };
}

/** THE RENDER PASS, PROMPT 02: the join between the English and the cells. */
export function wallResultFrom({ elements, first, second }) {
  // THE JOIN, AND IT IS DELIBERATELY FORGIVING. Step 5 asks for the original
  // array back unchanged, so index order is the first thing tried; a model
  // that reordered or dropped one is matched on type-and-wall instead. What
  // is NOT done is inventing cells for an element that came back without
  // them — see the panel: "seen but not placed" is a real, legible state.
  const joined = joinPlacements(elements, second?.placed ?? []);
  return {
    elements: joined,
    skipped: [...(first?.skipped ?? []), ...(second?.skipped ?? [])],
    // The one distinction the panel cannot draw for itself: the second call
    // came back with an array that placed NOTHING, versus the second call
    // came back with no array at all. Both leave every element unplaced.
    placedNone: !second?.matched,
  };
}
