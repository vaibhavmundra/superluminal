/* --- WHAT A LIGHTING SCHEME ADDS UP TO, WITHOUT A DRAWING UNDER IT ---------
   PURE. Every rule in this file is a function of its arguments: no React, no
   document, no pointer, no model call. That is what makes them the only part of
   this feature there is a test for — see tools/test-lighting-planner.mjs — and
   it is also the line the rest of the feature is drawn around. The hooks beside
   it hold state, dependency arrays and the four passes that cost money; the
   counting, the grouping, the checklist arithmetic and the two translations are
   here.

   THE EXISTING LIBRARIES ARE USED RATHER THAN REIMPLEMENTED. `lib/lumens.js` is
   still where a room's illuminance model lives, `lib/boq.js` still owns the
   catalogue and the schedule, and `lib/ceilingDesign.js` still owns the step
   from one chunk option to the next. What is here is the part that used to sit
   inline in App.jsx: the scans over the projected lists, the folds over the
   rooms, and the checklist the loading screen draws. */
import { FIXTURE_BY_ID } from '../../lib/boq.js';
import { FITTING_LUMENS } from '../../lib/settings.js';
import { FIXTURE_FAMILIES } from '../../lib/lumens.js';
import { clampWatts, nearestBeam, COB_WATT_RANGE } from '../../lib/cob.js';
import { MODULE_BY_ID, moduleWatts } from '../../lib/magTrack.js';
import { bbox } from '../../lib/geometry.js';
import { roomTypeIn } from '../../lib/roomTypes.js';
import { nextChunkOption } from '../../lib/ceilingDesign.js';

/**
 * The layout, in the one number a lighting drawing is actually judged on.
 *
 * Counting fittings says nothing on its own — twelve lights in a 400 sqft hall
 * and twelve in a 90 sqft bedroom are different jobs. Lumens per square foot
 * is the figure that travels: 15-20 reads as comfortable ambient light for a
 * living space, 25+ as bright. Summed over the plan and not averaged over the
 * rooms, because a plan's brightness is its light over its area, and averaging
 * the ratio would let a bright cupboard flatter a dim hall.
 */
export function planTotals(rooms) {
  const done = rooms.filter((r) => r.plan?.ok);
  // PER FITTING, THROUGH THE CATALOGUE — not two counts times two constants.
  // The counts were `stats.small` and `stats.large`, which are GEOMETRY, and
  // the moment a room could contain a 5 W narrow lamp in a toilet or in the
  // band outside a cove they stopped matching what is actually specified. The
  // BOQ's own catalogue is the single place a fitting's output lives, so the
  // headline figure and the schedule cannot drift apart.
  const lumensOfLight = (l) =>
    FIXTURE_BY_ID[l.fixture]?.lumens
    ?? (l.kind === 'large' ? FITTING_LUMENS.large : FITTING_LUMENS.small);
  const gridLumens = done.reduce(
    (t, r) => t + r.plan.lights.reduce((u, l) => u + lumensOfLight(l), 0), 0);
  // AND THE COVES, which are the reason this had to change: a cove can be the
  // only ambient source in a space, and a lm/sqft figure that ignored it
  // would report a coved living room as unlit.
  const coveLumens = done.reduce((t, r) => t
    + (r.coves ?? []).reduce((u, c) => u + c.coveLumens, 0), 0);
  const lumens = gridLumens + coveLumens;
  const areaSqft = done.reduce((s, r) => s + r.plan.stats.areaSqft, 0);
  return {
    rooms: done.length,
    failed: rooms.length - done.length,
    lights: done.reduce((s, r) => s + r.plan.lights.length, 0),
    coves: done.reduce((t, r) => t + (r.coves?.length ?? 0), 0),
    areaSqft, lumens, gridLumens, coveLumens,
    perSqft: lumens / Math.max(1, areaSqft),
  };
}

/**
 * WHAT IS ON THIS CEILING, COUNTED BY FAMILY — the input to the lumen model.
 *
 * COUNTING IS HERE AND THE ARITHMETIC IS IN lib/lumens.js, and the split is
 * deliberate: knowing that a zone with `kind: 'reverse-cove'` is a reverse
 * cove is this feature's business — it is the only place that knows what any of
 * these lists are — and knowing what a reverse cove does to a room is the
 * model's. Neither has to learn the other's vocabulary, and the model can be
 * tested without a drawing.
 *
 * EVERY LINEAR RUN ON THE PLAN IS `type: 'strip'` — that is what lets the
 * canvas, the schedule and the DXF take a cove, a reverse cove and a shelf run
 * without any of them knowing what a cove is — so `kind` is what separates
 * them here, exactly as it does in the BOQ.
 *
 * THE THREE THINGS THAT BECOME A COB. The ambient grid's downlights, the heads
 * a track has swallowed and the directional spots are one family: a recessed
 * lamp throwing down. They are three different products in the schedule and
 * one distribution here, which is the distinction this file exists to make.
 *
 * ...AND A CHANDELIER IS A LAMP. It is the one decorative fitting this app
 * places, it throws in every direction, and the floor/table lamp split is the
 * only one of the six that describes that. Stated rather than left out,
 * because a pendant contributing nothing to a room's level would read as a
 * bug on a plan that has one.
 */
export function fixtureGroups(r, {
  accentZonesPx, taskSpotsPx, cobArrays, arrayCobsPx,
  magTracksPx, trackModulesPx, manualCobs, pxPerFt,
}) {
  const g = new Map();
  /* `key` IS THE ROW'S IDENTITY and `familyId` is what it is made of — see
     `analyseSpace`. Two groups with the same key merge; two with different
     keys are two rows even when they are the same family. */
  const bump = (key, familyId, count, lengthFt) => {
    const cur = g.get(key) ?? { key, familyId, count: 0, lengthFt: 0 };
    cur.count += count; cur.lengthFt += lengthFt;
    g.set(key, cur);
  };
  // FEET FROM PIXELS AND THE LIVE SCALE, never from a stored length — see
  // `runMetres` in boq.js for the bug that rule exists to prevent.
  const ft = (px) => (pxPerFt > 0 ? (px ?? 0) / pxPerFt : 0);

  for (const z of accentZonesPx) {
    if (z.roomId !== r.id || z.rejected) continue;
    if (z.type === 'sconce') { bump('sconce', 'sconce', 1, 0); continue; }
    if (z.type !== 'strip') continue;
    const familyId = z.kind === 'cove' ? 'cove'
      : z.kind === 'reverse-cove' ? 'reverse_cove'
      : z.kind === 'shelf' ? 'shelf_strip'
      // A run that is none of those is one somebody drew on the ceiling,
      // which is the family the brief calls "LED strips on the ceiling".
      : 'ceiling_strip';
    /* --- ONE ROW PER RUN, AND THE RUN'S OWN ID IS THE KEY -----------------
       A LENGTH OF TAPE IS A THING YOU SPECIFY ON ITS OWN. A bedroom's
       perimeter cove and the drop over the bed are two runs of two different
       lengths that a designer routinely orders at two different wattages, and
       one row saying "Cove — 32 ft" could express neither. Every other linear
       thing on this plan is the same: a reverse cove along one wall, a strip
       under a shelf, a run somebody clicked out by hand.
       COUNTED FAMILIES ARE NOT SPLIT THIS WAY, and the rule is the unit rather
       than a list of ids: anything sold by the METRE gets a row per run, and
       anything sold by the piece gets one row for the lot. Twelve COBs are one
       decision about COBs; twelve rows of chips would be eleven chances for
       two of them to disagree.
       THE KEY IS THE ZONE'S ID, which is what a chosen wattage is stored
       against — the same handle `accentDismissed` and `runTrims` already use,
       and stable for the same reasons. A run that stops existing takes its
       entry out of use; the entry simply lapses, exactly as a `lightMoves`
       offset does when its cell is re-cut. */
    bump(z.id, familyId, 1, ft(z.runLength));
  }

  /* --- THE THREE THINGS THAT USED TO BE ONE ROW --------------------------
     The ambient grid, the spots aimed at work surfaces and the spots aimed at
     pictures were bumped together as `cob`, on the argument that they are one
     family: a recessed lamp throwing down. That is still true of the PHYSICS —
     they share a distribution and the model treats them identically — and it
     was never true of the DESIGN. They are three layers of a lighting scheme,
     a designer specifies them separately, and now that the panel has three
     sections a single row could only appear in one of them.
     SO THE FAMILY STAYS ONE AND THE ROWS BECOME THREE, which is exactly the
     split `layer` was added for: `split` is where the light goes, `layer` is
     what it is for. See FIXTURE_FAMILIES in lumens.js.
     AND EACH OPENS AT ITS OWN CATALOGUE WATTAGE. A spot is a 5 W lamp and the
     grid's is 7 W — one row at one figure had to be wrong about one of them.
     See `defaultWatts` on the group and the note in `wattsFor`. */
  const grid = r.plan?.ok ? r.plan.lights.length : 0;
  if (grid) bump('cob', 'cob', grid, 0);

  for (const sp of taskSpotsPx) {
    if (sp.roomId !== r.id || sp.rejected || sp.x == null) continue;
    /* WHICH SPOT IT IS, OFF THE FITTING ITSELF. `art-spot` is a 24-degree lamp
       aimed at a picture and `spot` a 30-degree one aimed at a worktop; the
       schedule has always billed them as two lines, and they are two LAYERS
       for the same reason — one is what you work by, the other is what you
       look at. */
    const art = sp.fixture === 'art-spot';
    bump(art ? 'art-spot' : 'spot', 'cob', 1, 0);
    const row = g.get(art ? 'art-spot' : 'spot');
    row.label = art ? 'Art spot' : 'Directional spot';
    row.layer = art ? 'accent' : 'task';
    row.defaultWatts = FIXTURE_BY_ID[art ? 'art-spot' : 'spot']?.watts ?? null;
  }

  /* --- ...AND ONE ROW PER COB SOMEBODY PLACED BY HAND --------------------
     THIS IS THE COUNTED FAMILIES' RULE BROKEN ON PURPOSE, and it is worth
     saying why rather than leaving it to be found. The rule above is that
     anything sold by the piece gets ONE row for the lot, because twelve COBs
     are one decision about COBs and twelve rows of chips would be eleven
     chances for two of them to disagree. That holds exactly as long as one
     decision is what they are: the engine buys off the catalogue, once, for
     every cell in the room.
     A HAND-PLACED LAMP WAS SPECIFIED AS IT WAS PLACED. That is the whole point
     of the bar on the drawing — you may put a 24-degree 18 W lamp over the
     console and leave the rest of the ceiling alone — so each one is its own
     decision, and merging them into a row would be the panel unable to show
     the thing the tool exists to let somebody do. It is the same test the
     linear runs pass: a thing you point at and specify on its own.
     ITS OWN LABEL, so the numbering below does not run through the grid's row
     as if they were a series. See `analyseSpace`.
     AND IT CARRIES ITS OWN WATTAGE AND OPTIC rather than looking them up in
     `fixtureWatts`: the figures are on the fitting — see `manualCobs` — which
     is what makes them survive a room being re-gridded under them. */
  /* --- AN ARRAY IS ONE ROW, WHATEVER ITS COUNT --------------------------
     AND THAT IS THE OPPOSITE OF THE RULE BELOW IT, on purpose. A lamp placed
     by hand is its own decision and gets its own row. Twelve lamps on one ring
     are ONE decision — a geometry, a count and an offset — and they carry one
     wattage and one optic between them, because there is only one figure for
     them to read. So the row is the array, the quantity is how many it works
     out to, and changing the wattage here changes all twelve at once. That is
     not a convenience; it is what an array IS. See `cobArrays`. */
  for (const a of cobArrays) {
    const n = arrayCobsPx.filter((c) => c.arrayId === a.id && c.roomId === r.id).length;
    if (!n) continue;
    bump(a.id, 'cob', n, 0);
    const row = g.get(a.id);
    row.label = 'Spot array';
    row.layer = 'ambient';
    row.watts = clampWatts(a.watts);
    row.wattRange = COB_WATT_RANGE;
    row.beam = nearestBeam(a.beam);
  }

  /* --- THE MODULES ON A MAGNETIC TRACK, ONE ROW PER RUN -----------------
     ONE ROW PER RUN AND PER KIND, which is the array's rule rather than the
     hand-placed lamp's, and for the array's reason: four diffusers on one
     profile are ONE decision — a run, a module, a wattage — and they carry one
     figure between them. Two kinds on one run are two rows, because a diffuser
     and a spot are two products doing two different jobs on the same carrier.

     THE DIFFUSER IS AMBIENT AND THE SPOT IS NOT, and that is the whole point
     of offering both. A diffuser is a lens over a linear board: its light
     leaves a face that is already the ceiling and spreads (70% at the walls,
     30% at the floor — the `panel` family, which has been specified in
     lumens.js since it was written and had no tool behind it until now). A
     spot puts a cone on the floor and is `cob`'s distribution, layered as
     task light. So a run of four 18 W diffusers moves the two figures at the
     top of this panel and a run of four spots barely does, which is a true
     statement about the two products and the reason the choice matters.

     THE FAMILY COMES OFF THE MODULE and not out of a table here — see
     TRACK_MODULES in lib/magTrack.js, which is the one place a module's
     distribution is named. */
  /* --- ONE ROW PER MODULE, WHICH IS THE HAND-PLACED LAMP'S RULE ----------
     IT WENT FROM ONE ROW PER RUN, TO ONE PER RUN PER WATTAGE, TO THIS. Each
     step was forced by the one before it, and the third is where it should have
     started: a module on a track is a thing you point at and specify on its
     own, which is exactly the test the note below `manualCobs` sets out for
     breaking the counted-family rule.

     WHY THE FIRST TWO FAILED. One row per run assumed a run carries one
     figure, and the corner-first allocator puts 5 W at the corners and a 10 W
     in the middle of a rail. Grouping by wattage fixed the arithmetic and left
     you unable to say anything about ONE of them: five diffusers on a run, four
     of them in one row, and no way to change the wattage of a single corner or
     to see which row the module you just dragged belongs to.

     SO THE KEY IS THE FITTING'S OWN ID, and the rows are numbered by
     `analyseSpace` — "Track diffuser 1", "Track diffuser 2" — which is what it
     already does for any two rows sharing a label. Press a chip and it moves
     that module and nothing else.

     AND THE LAYER IS THE FAMILY'S. A diffuser is ambient and a spot is task;
     both now have families of their own that say so (see `track_diffuser` and
     `track_spot` in lumens.js), so this no longer decides it per module id. */
  for (const t of magTracksPx) {
    if (t.roomId !== r.id) continue;
    for (const q of trackModulesPx) {
      if (q.on !== t.id) continue;
      const m = MODULE_BY_ID[q.kind];
      if (!m?.family) continue;    // the wall washer, which has no numbers yet
      bump(q.id, m.family, 1, 0);
      const row = g.get(q.id);
      row.label = `Track ${m.label.toLowerCase()}`;
      row.watts = q.watts ?? moduleWatts(q.kind);
      row.beam = q.beam ?? m.beam;
    }
  }

  for (const c of manualCobs) {
    if (c.roomId !== r.id) continue;
    bump(c.id, 'cob', 1, 0);
    const row = g.get(c.id);
    row.label = 'Placed COB';
    /* AMBIENT, like the grid it stands in. A downlight placed by hand is doing
       the ambient layer's job in a cell the ambient grid cut — where it came
       from is a fact about who decided, not about what it is for. */
    row.layer = 'ambient';
    row.watts = clampWatts(c.watts);
    row.wattRange = COB_WATT_RANGE;
    row.beam = nearestBeam(c.beam);
  }

  const pendants = (r.geo?.fansInRoom ?? []).filter(
    (f) => f.kind === 'chandelier').length;
  if (pendants) bump('lamp', 'lamp', pendants, 0);

  /* IN THE TABLE'S OWN ORDER, so the rows do not reshuffle as fittings are
     added, and within a family in the order the drawing produced them.
     `FIXTURE_FAMILIES` is ordered the way the work happens — the surface
     details first, the things mounted on them after. */
  const order = new Map(FIXTURE_FAMILIES.map((f, i) => [f.id, i]));
  return [...g.values()].sort(
    (a, b) => (order.get(a.familyId) ?? 99) - (order.get(b.familyId) ?? 99));
}

/**
 * WHICH ANALYSIS ROWS THE CURRENT SELECTION IS, as row keys.
 *
 * THE TRANSLATION LIVES HERE BECAUSE ONLY THIS FEATURE KNOWS BOTH ENDS. The
 * panel is handed rows keyed by whatever `fixtureGroups` decided identifies
 * one, and that is a different kind of handle per family: a placed COB and a
 * length of tape are each their own row, so a fitting's id IS the key; every
 * task spot in a room is one row, so the key is the catalogue line it is billed
 * as. A component given a fitting id could not resolve either without learning
 * the grouping rules, which are this feature's.
 *
 * A LIST, because more than one thing can be picked at once — a run and a spot
 * are separate selections on this canvas and both should light up.
 *
 * A SELECTED SPACE IS NOT IN HERE. Opening a room is how you get the panel to
 * be about it at all; highlighting every row in it would be the panel telling
 * you what you just asked for.
 */
export function highlightRows({
  selCobId, selArrayId, selModuleId, selAccId, selSpotId, selLightId,
  manualCobs, cobArrays, trackModulesPx, accentZonesPx, taskSpotsPx,
}) {
  const keys = [];
  let roomId = null;
  if (selCobId) {
    keys.push(selCobId);
    roomId = manualCobs.find((c) => c.id === selCobId)?.roomId ?? roomId;
  }
  /* AN ARRAY'S ROW IS KEYED BY THE ARRAY, which is what `fixtureGroups`
     bumps it under: twelve lamps on one ring are one decision and therefore
     one row, so clicking any of the twelve marks the row all twelve share. */
  if (selArrayId) {
    keys.push(selArrayId);
    roomId = cobArrays.find((a) => a.id === selArrayId)?.roomId ?? roomId;
  }
  /* A MODULE'S ROW IS KEYED BY THE FITTING, exactly as a hand-placed COB's is
     — one row per module, see `fixtureGroups` — so clicking one on the
     drawing reveals the row that is about it and nothing else. */
  if (selModuleId) {
    keys.push(selModuleId);
    roomId = trackModulesPx.find((q) => q.id === selModuleId)?.roomId ?? roomId;
  }
  /* A RUN'S ROW IS KEYED BY THE ZONE'S OWN ID — see the note in
     `fixtureGroups` on why anything sold by the metre gets a row apiece —
     except a sconce, which is counted and therefore shares one. */
  if (selAccId) {
    const z = accentZonesPx.find((q) => q.id === selAccId);
    keys.push(z?.type === 'sconce' ? 'sconce' : selAccId);
    roomId = z?.roomId ?? roomId;
  }
  if (selSpotId) {
    const sp = taskSpotsPx.find((q) => q.id === selSpotId);
    if (sp) {
      keys.push(sp.fixture === 'art-spot' ? 'art-spot' : 'spot');
      roomId = sp.roomId ?? roomId;
    }
  }
  /* AND A GRID LIGHT LIGHTS THE GRID'S ROW. They are one row for the lot, so
     clicking one of twelve marks the decision all twelve share — which is the
     honest answer to "what is this fitting" for a lamp whose wattage cannot be
     set on its own. */
  if (selLightId) {
    keys.push('cob');
    /* THE ID IS `<roomId>|<cellKey>` — see where it is set on the canvas. The
       room is the half before the bar, which is the only part this needs. */
    roomId = String(selLightId).split('|')[0] || roomId;
  }
  return { keys, roomId };
}

/** One line per room, and only where something actually went wrong. */
export function troubleLines(rooms) {
  return rooms.flatMap((r) => {
    const name = r.outline.name || 'Space';
    if (!r.plan) return [];
    if (!r.plan.ok) return [{ name, msg: r.plan.reason }];
    const st = r.plan.stats;
    if (st.unserved > 0) return [{ name, msg: `${st.unserved} cell${st.unserved > 1 ? 's have' : ' has'} no light at all — that should not happen.` }];
    if (st.clashes > 0) return [{ name, msg: `${st.clashes} light${st.clashes > 1 ? 's sit' : ' sits'} inside a fan's clearance or a no-light zone, because the cell has nowhere else to go.` }];
    // A CEDED CELL IS A CELL THE OBSTACLE WON, and which obstacle matters. The
    // message named the fan unconditionally, which was true while a fan was the
    // only thing that could take a cell — a cove ceiling changed that, because
    // its chunk plan carries the beds as no-light zones rather than carving them
    // out, so a cell can now be ceded to a mattress in a room with no fan in it.
    if (st.ceded > 0) return [{ name, msg: st.fans
      ? `${st.ceded} cell${st.ceded > 1 ? 's are' : ' is'} left to the fan — no light fits clear of the blades.`
      : `${st.ceded} cell${st.ceded > 1 ? 's have' : ' has'} no light — the whole middle of ${st.ceded > 1 ? 'each' : 'it'} is a no-light zone.` }];
    if (st.outsideBand > 0) return [{ name, msg: `${st.outsideBand} light${st.outsideBand > 1 ? 's sit' : ' sits'} off its cell centre.` }];
    return [];
  });
}

// BEDS FIRST, and it is the only step whose ORDER is load-bearing.
//
// A bed is a no-light zone, a zone changes where the ambient lights go, and
// everything after this reads those light positions: the accent pass is shown
// them so it does not put a sconce under a downlight, and the task spots are
// placed on the grid they form. Decide the beds after the layout and every
// one of those is working from a layout that is about to change.
//
// So this runs before "Reading your geometry" — before the rooms are marked
// lit at all — and it works off the traced outlines, which is everything it
// needs. The layout is then computed ONCE, with the beds already in it.
//
// A MODULE CONSTANT WHERE IT WAS A `useMemo` OVER AN EMPTY DEPENDENCY LIST,
// which is the same thing said without a hook: the list never depended on a
// render, so nothing about when it is built can change.
export const PREP_STEPS = [
  // The whole-plan bed pass. Its step is listed only when the superseded
  // contested version is switched on (it is gated on `bedSets`); the live
  // `bed-filter` call runs on upload, before there is a pipeline to show.
  { key: 'beds', label: 'Placing the beds' },
  { key: 'geometry', label: 'Reading your geometry' },
  { key: 'types', label: 'Understanding space types' },
  // AFTER the classification, because it is the classification that makes it
  // possible: only once a space is known to be a bedroom is "no bed here" a
  // contradiction worth spending a model call on.
  { key: 'beds2', label: 'Checking the bedrooms' },
  { key: 'accents', label: 'Adding accent lighting' },
  { key: 'spots', label: 'Aiming task lights' },
];

/** WHICH STEPS THIS RUN IS ACTUALLY GOING TO DO — the checklist the loading
 *  screen draws, before the gate and before any work. Pure and cheap: a filter
 *  over a constant. */
export function stepsWanted({ beds, bedSets, classify, relight, accents, surfaces }) {
  return PREP_STEPS.filter((st) =>
    st.key === 'beds' ? (beds && !!bedSets)
    // The re-check needs the classification to know which spaces are bedrooms,
    // so it is listed only when both are running.
    : st.key === 'beds2' ? (beds && classify)
    : st.key === 'geometry' ? relight
    : st.key === 'types' ? classify
    : st.key === 'accents' ? accents
    : surfaces);
}

/** THE CHECKLIST WITH ONE STEP TAKEN UP, and everything above it finished.
 *  A step this run is not doing is not in the list, and moving to it is a
 *  no-op — which is what lets the pipeline call this unconditionally. */
export function advanceTo(steps, key) {
  const at = steps.findIndex((q) => q.key === key);
  if (at < 0) return steps;
  return steps.map((st, i) => ({ ...st, state: i === at ? 'busy' : i < at ? 'done' : st.state }));
}

/** WHAT ONE STEP FOUND, said on the step's own row. */
export function noteOn(steps, key, text) {
  return steps.map((st) => (st.key === key ? { ...st, note: text } : st));
}

/** THE WHOLE CHECKLIST TICKED — the last paint of a run that got to the end. */
export function allDone(steps) {
  return steps.map((st) => ({ ...st, state: 'done' }));
}

/** A room that fails is skipped, not fatal — but a silent skip is how six
 *  rooms quietly become four. So a step's note admits the run was partial. */
export function withFails(text, n) {
  return n ? `${text} · ${n} space${n > 1 ? 's' : ''} failed` : text;
}

/**
 * The shapes the loader draws.
 *
 * Taken from the OUTLINES rather than from the computed rooms, so the loader
 * has something to draw the instant it opens — the layout it is waiting for
 * does not exist yet, and a loading screen that starts empty and fills in is
 * the thing it exists to avoid.
 */
export function loaderShapes({ outlinesPx, roomTypes, projectId, roomState }) {
  return outlinesPx.map((o) => {
    const b = bbox(o.pointsPx);
    return {
      id: o.id,
      points: o.pointsPx,
      centre: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
      label: roomTypes[o.id]
        ? (roomTypeIn(projectId, roomTypes[o.id].type)?.label ?? null)
        : (o.name || null),
      state: roomState?.[o.id] ?? 'idle',
    };
  });
}

/**
 * ONE CHUNK FLIPPED THROUGH ITS OPTIONS — the whole space's picks, rewritten.
 *
 * THE CURRENT ANSWER IS READ OFF THE LAYOUT, not out of `designPicks`, and
 * that is what makes the legacy path and the "standard costs no state" rule
 * agree with each other. `designChunksPx` says what each chunk ACTUALLY got —
 * including a cove that came from the old room-level switch and a pick that
 * was dropped because the chunk it named no longer exists — so writing the
 * whole space back from it retires the legacy entry, keeps every other chunk
 * exactly as it is, and still stores nothing for a standard ceiling.
 *
 * NULL MEANS DO NOTHING: no such chunk, nothing to step to, or a chunk with
 * fewer than two options to step between.
 */
export function chunkOptionPicks(room, key, dir = 1) {
  const chunk = room?.designChunksPx?.find((d) => d.key === key);
  if (!chunk || (chunk.options?.length ?? 0) < 2) return null;
  /* THE STEP ITSELF IS IN ceilingDesign.js, and it is there rather than here
     because it was wrong for as long as it lived in the handler and nothing
     could catch it: the symptom was "the right arrow never reaches the track,
     the left one does", which no test of a LAYOUT would ever see. See
     `nextChunkOption` for the two lists and why it steps from what was asked
     for rather than from what got built. */
  const next = nextChunkOption(chunk, dir);
  if (!next) return null;
  const base = {};
  // EVERY OTHER CHUNK KEEPS WHAT IT ASKED FOR, not what it got. Reading `pick`
  // here dropped a neighbour's declined request the moment anybody flipped a
  // different chunk — invisible on the drawing, and a decision quietly lost.
  for (const d of room.designChunksPx) {
    const want = d.requested ?? d.pick;
    if (d.key !== key && want !== 'standard') base[d.key] = want;
  }
  if (next === 'standard') delete base[key]; else base[key] = next;
  return base;
}
