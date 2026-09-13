import { useCallback, useEffect, useMemo, useRef } from 'react';
import { regionFromOutline } from '../../lib/outline.js';
import { mapLimit } from '../../lib/mapLimit.js';
import { bedsIn, contestFor, applyVerdict } from '../../lib/bedFit.js';
import { absorbContest } from '../room-intelligence/bedContest.js';
import { PROJECT_BY_ID, roomTypeIn, wantsAccents, wantsSpots, expectsBed } from '../../lib/roomTypes.js';
import { stepsWanted, advanceTo, noteOn, allDone, withFails,
         loaderShapes } from './lightingRules.js';

/**
 * THE PIPELINE, and the loading screen is its progress.
 *
 * Pressing "Light the whole plan" used to be one synchronous act: mark the
 * outlines lit and land on the layout. It now runs up to four model calls per
 * room before the user sees anything, which is a minute on a six-room flat, so
 * the wait needs to be both visible and worth it.
 *
 * WHY THE ROOMS ARE READ FROM A REF. Everything after step one needs the
 * COMPUTED rooms — polygons, chunks, the ambient lights — and those come out
 * of a memo that cannot run until React has re-rendered with the new litIds.
 * An async function holding `rooms` from its own closure would hold the empty
 * array it was created with, forever. So the ref is the live view and the
 * pipeline waits for it to fill.
 *
 * NOTHING ABORTS THE WHOLE RUN. A room whose classification fails is an
 * `other` and gets no accent pass; a room whose accent call 502s is noted and
 * skipped. Five rooms lit and one not is a far better outcome than a spinner
 * that gave up at room two, and every failure is on the console.
 *
 * IT COORDINATES RECOGNITION AND ROOM INTELLIGENCE THROUGH THEIR PUBLIC
 * COMMANDS. `computeBedFit`, `refindBeds` and `absorbBedRows` are
 * `usePlanRecognition`'s; `computeRoomType`, `computeAccents` and
 * `computeSurfaces` are `useRoomIntelligence`'s. Every one of them is handed in
 * by App and nothing here reaches into either feature's own state. What is this
 * feature's is the ORDER they run in, the concurrency they run at, what the
 * screen says while they do, and what happens to a room that fails.
 *
 * AND NOTHING HERE HOLDS DOCUMENT STATE. The verdicts, the detections, the room
 * types, the accent and surface results, the lit list and the dirty list are all
 * `usePlanDoc`'s, written through the `docActions` App hands in. The one list
 * this function keeps for itself is `bedsNow`, and the note at it says why: a
 * setState is not visible until the next render and this loop does not get one.
 */
export default function usePlanPipeline({
  source, outlines, outlinesPx, rooms, pxPerFt, projectId, roomTypes, detections,
  bedSets, useBoundingRect, planAreaSqft,
  computeBedFit, refindBeds, absorbBedRows,
  computeRoomType, computeAccents, computeSurfaces,
  claimSpaces, docActions,
  prep, setPrep, cancelPrep,
  setPickingId, setOutlinesOpen, milestone,
}) {
  const roomsRef = useRef(rooms);
  useEffect(() => { roomsRef.current = rooms; }, [rooms]);

  /**
   * ONE FUNCTION FOR THE WHOLE RUN AND FOR EVERY RE-RUN.
   *
   * `opts` picks the steps. The tracer's button runs all three; the panels'
   * recompute buttons run one. Which means a recompute is the SAME code as the
   * first pass — same loader, same per-room progress, same error handling —
   * rather than a second implementation that drifts from it. The old per-room
   * "Find accent zones" button was exactly that second implementation, and it
   * is gone.
   */
  /**
   * ...AND `only` RUNS IT OVER A SUBSET, WHICH IS THE RELIGHT-WHAT-CHANGED PATH.
   *
   * An array of outline ids, or null for the whole sheet. Three things read it
   * and they are the three things that made a partial run impossible before:
   *
   *   THE CLAIM. `claimSpaces` is handed the subset, so a plan where one corner
   *   moved is charged for one space. This is what the pricing page has always
   *   said happens.
   *
   *   THE WORK LIST. Every pass runs `mapLimit` over `list`, so filtering that
   *   one array narrows the classifier, the accents and the surfaces together.
   *
   *   THE BED PASS, WHICH IS SKIPPED. It is one call over the WHOLE sheet — it
   *   contests bed candidates against each other across rooms — so running it
   *   for one room would either re-do the sheet or produce a worse answer than
   *   the one already saved. `beds` therefore defaults to "only on a full run".
   *
   * AND THE MERGES MATTER MORE THAN THE FILTER. `setRoomTypes(found)` REPLACED
   * the map, which is invisible on a full run and wipes eight rooms' types on a
   * partial one. The accent and surface passes already merged; the classifier
   * now does too.
   */
  const runPipeline = useCallback(async (opts = {}) => {
    const { classify = true, accents = true, surfaces = true, relight = true,
            only = null } = opts;
    const { beds = !only } = opts;
    if (!source || !outlines.length) return;
    // The subset, as ids, narrowed to outlines that still exist.
    const ids = only ? outlines.filter((o) => only.includes(o.id)).map((o) => o.id) : null;
    if (ids && !ids.length) return;
    const inRun = (id) => !ids || ids.includes(id);

    /* THE STEP LIST AND THE ROOM STATES ARE BUILT BEFORE THE GATE, and they are
       up here rather than below it for one reason: the loading screen needs them
       and the loading screen now goes up first. Both are pure and cost nothing —
       a filter over a constant and a loop over the outlines already in hand. */
    const wanted = stepsWanted({ beds, bedSets, classify, relight, accents, surfaces });
    const roomState = {};
    for (const o of outlines) if (inRun(o.id)) roomState[o.id] = 'idle';

    /* THE LOADING SCREEN GOES UP FIRST, AND THEN THE GATE. THIS IS A REVERSAL.
       The claim used to be the very first statement in this function, on the
       argument that everything below it spends money and a refusal should leave
       the tracer exactly as it was rather than show a progress dialog that dies
       on its first step. That is still the right instinct about the REFUSAL, and
       it is still honoured — the screen is torn down again below. What it got
       wrong is the WAIT.

       `claimSpaces` is a network round trip: the plan row has to have landed
       (`whenRowReady`) and then the till is asked over HTTP. That is a few
       hundred milliseconds on a warm function and a second or more on a cold
       one, and for the whole of it the old code painted nothing at all. The user
       had pressed the one button this screen exists for and the app looked
       broken — no press, no spinner, no dialog, just the tracer sitting there —
       so the honest reading of a second of silence is "it did not take the
       click", and the honest response to that is to press it again.

       IT IS NOT A FAKE STEP. Nothing in `wanted` is marked busy: every step is
       idle, the bar is at zero, and the phase says what is actually happening,
       which is that the spaces are being counted. The first real `paint()` below
       is what lights step one, so the checklist never claims work that has not
       started.

       `cancelPrep` IS RESET BEFORE THE SCREEN, not after the claim. The panel
       beside the loader offers "Stop and start over" the moment `prep` is
       truthy, so the flag it clears has to already be live by then; and a stale
       `true` left by a previous abandoned run would otherwise make step one bail
       on a run that was never cancelled. */
    cancelPrep.current = false;
    setPrep({
      phase: relight ? 'Checking your spaces' : 'Getting ready',
      detail: relight ? 'Counting what this run covers' : '',
      steps: wanted.map((st) => ({ ...st, state: 'idle' })),
      roomState, done: 0, total: 0,
    });

    // THE GATE. Everything past it spends something: three detectors, a room
    // classifier and an accent pass, two model calls at a time, across every
    // space on the sheet.
    //
    // ONLY WHEN THE LAYOUT IS ACTUALLY BEING (RE)BUILT. `runPipeline({ relight:
    // false })` is how the accent and surface passes are re-run over a layout
    // that already exists — the spaces were paid for when they were lit and
    // asking again would charge a second time for one dismissed accent.
    //
    // A REFUSAL PUTS THE SCREEN BACK DOWN. The paywall the claim raises is its
    // own dialog; leaving the loader up behind it would be a progress screen for
    // a run that is not going to happen.
    if (relight && !await claimSpaces(ids ?? outlines.map((o) => o.id))) {
      setPrep(null);
      return;
    }
    // A room that fails is skipped, not fatal — but a silent skip is how six
    // rooms quietly become four. Counted here and reported in the step's own
    // note, so a partial run says it was partial.
    const failed = { beds: 0, beds2: 0, types: 0, accents: 0, surfaces: 0 };
    // THE BED LIST AS IT STANDS, threaded through the run rather than read back
    // from state. Step 0 replaces it and step 2b adds to it, and neither can see
    // the other's setState — a React update is not visible until the next render
    // and this function does not get one.
    let bedsNow = detections;
    let steps = wanted.map((st, i) => ({ ...st, state: i === 0 ? 'busy' : 'idle' }));
    let done = 0, total = relight ? (ids ?? outlines).length : 0;
    /* `phase` AFTER `...prev`, AND `detail` BEFORE IT. The two are spread on
       opposite sides on purpose and the difference is which one is allowed to
       persist.

       `detail` is the sub-line, and most `paint()` calls do not pass one — a
       room going busy, a room going done. Defaulting it ahead of `...prev` means
       those calls keep whatever the last detail said instead of blanking the
       line under the heading on every tick.

       `phase` is the heading, and it is DERIVED: whichever step is busy. Spread
       ahead of `...prev` (which is where it was) the derivation ran and was then
       immediately overwritten by the previous render's value, so the heading
       froze on the first step of the run and stayed there while the checklist
       below it advanced — "Reading your geometry" over a plan three steps into
       its accents. Recomputed after `...prev` it tracks the step that is busy,
       and `...patch` still comes last so the final paint's explicit 'Ready'
       wins. */
    const paint = (patch = {}) => setPrep((prev) => ({
      detail: '', ...prev,
      phase: steps.find((x) => x.state === 'busy')?.label ?? 'Finishing',
      ...patch, steps: [...steps], roomState: { ...roomState },
      done, total,
    }));
    /* THE TWO CHECKLIST MOVES ARE PURE AND ARE IN lightingRules.js — see
       `advanceTo`, which takes the step up and finishes everything above it, and
       `noteOn`, which writes what a step found on its own row. Both are called
       unconditionally: a step this run is not doing is not in `wanted`, and
       moving to a step that is not there is a no-op. */
    const stepTo = (key) => { steps = advanceTo(steps, key); };
    const note = (key, text) => { steps = noteOn(steps, key, text); };
    paint({ detail: beds && bedSets ? 'Two readings of the beds' : relight ? 'Working out where the spaces are' : '' });

    // --- 0. the beds, decided BEFORE anything is laid out
    //
    // Room by room, because that is the unit the question makes sense in: a
    // whole-sheet A/B forces one detector to win every bedroom, and on a plan
    // where Roboflow nails one bed and GPT nails another there is no answer that
    // is right. Per room, each bed is judged against the other reading OF THAT
    // BED, in the same isolated crop the accent and task passes are shown.
    /* SKIPPED WHILE THE WHOLE-PLAN PASS IS OFF. `bedSets` is only ever set by
       that pass, so this whole step — the sheet-wide contest between the two
       vendors — is dormant by construction rather than by a flag. Switching the
       pass back on brings it back with it. */
    if (beds && bedSets) {
      stepTo('beds');
      const A = bedSets.roboflow || [], B = bedSets.openai || [];
      total += outlines.length;
      for (const o of outlines) roomState[o.id] = 'idle';
      paint({ detail: `${A.length} from Roboflow, ${B.length} from GPT` });

      // TWO AT A TIME, like the accent pass. Each contested room is a
      // high-detail two-image call and running eight of them at once is how a
      // rate limit turns into eight failures instead of one queue.
      const perRoom = await mapLimit(outlines, 2, async (o) => {
        if (cancelPrep.current) return null;
        const region = regionFromOutline(o, pxPerFt);
        const poly = region?.ok ? (useBoundingRect ? region.boundingRect : region.polygon) : null;
        const a = poly ? bedsIn(A, poly) : [];
        const b = poly ? bedsIn(B, poly) : [];

        roomState[o.id] = 'busy'; paint();
        const c = contestFor(a, b);
        let rec = { ...c, asked: false, confidence: 0 };

        if (c.ask) {
          paint({ detail: `Two readings of ${o.name || 'a space'}` });
          try {
            const out = await computeBedFit(o, a, b);
            rec = { kind: 'judged', asked: true, ...applyVerdict(a, b, out.verdict) };
          } catch (err) {
            // A judge that cannot be reached is not a reason to lose both
            // answers. applyVerdict with no verdict takes the documented
            // fallback and says it fell back, and the room is counted as failed
            // so the step's own note admits the run was partial.
            console.warn('[beds] the judge failed for', o.name, err);
            failed.beds++;
            rec = { kind: 'judged', asked: true, failed: true, ...applyVerdict(a, b, null) };
          }
        }
        roomState[o.id] = 'done'; done++; paint();
        return { id: o.id, name: o.name, a, b, rec };
      });
      if (cancelPrep.current) { setPrep(null); return; }

      const rows = perRoom.filter((r) => r && !r.error);
      /* THE FOLD IS features/room-intelligence/bedContest.js — one verdict per
         space, one merged list of beds attributed to whoever won them, and the
         boxes in no traced room kept as they always were. No call in it, which
         is why it is not in here. */
      const { verdicts, won } = absorbContest(rows, { a: A, b: B });

      bedsNow = won;
      docActions.setBedVerdicts(verdicts);
      // A DISMISSAL CANNOT SURVIVE THIS. The ids it holds are the merged set's
      // (`det-3-...`); the judged list's are the winning detector's
      // (`det-rf-0-...`), so a kept dismissal would silently apply to nothing —
      // a box the user struck out would come back with no way to tell that it
      // had. Cleared, so the list on screen is the list that was decided.
      docActions.clearDismissed();
      docActions.replaceDetections(won);

      const asked = rows.filter((r) => r.rec.asked).length;
      const withBeds = rows.filter((r) => r.rec.kind !== 'none').length;
      // COUNTED IN ROOMS, not over the whole list: the loose ones belong to no
      // room and saying "4 beds in 2 rooms" when two of them are in neither is
      // a sentence that does not add up on the screen it is printed on.
      const inRooms = won.filter((d) => d.roomId).length;
      note('beds', withFails(
        `${inRooms} bed${inRooms === 1 ? '' : 's'} in ${withBeds} space${withBeds === 1 ? '' : 's'}`
        + (asked ? ` · ${asked} judged` : ' · none needed judging'), failed.beds));
      console.log('[beds] verdicts', verdicts);
    }

    if (relight) {
      // Not a model call: mark everything lit so the memo produces the ambient
      // layout the rest of this depends on. AFTER the beds, so it is computed
      // once with their zones in it rather than once without and once with.
      /* ONE ACT AGAIN, AND THE LIT LIST IS A UNION. On a partial relight the
         spaces that were already lit have to STAY lit — assigning the subset
         would blank the rest of the sheet, which is the very thing the partial
         run exists to stop doing. `ids` null is the whole sheet, and RELIT
         reads that off the document rather than from `outlines` here. It also
         carries the note on why nothing is selected to begin with. */
      docActions.relight(ids);
      setPickingId(null);
      stepTo('geometry');
      paint({ detail: 'Working out where the spaces are' });
    }

    // --- 1. the ambient layout
    let list = [];
    for (let i = 0; i < 80 && !cancelPrep.current; i++) {
      list = (roomsRef.current || []).filter((r) => r.plan?.ok && inRun(r.id));
      if (list.length) break;
      await new Promise((res) => setTimeout(res, 60));
    }
    if (cancelPrep.current) { setPrep(null); return; }
    if (!list.length) {
      // Nothing laid out at all: there is no pipeline to run and the layout
      // screen will say why. Better to land there than to hold a loader over an
      // explanation the user needs to read.
      setPrep(null);
      return;
    }
    if (relight) {
      note('geometry', `${list.length} space${list.length > 1 ? 's' : ''}, `
        + `${list.reduce((n, r) => n + r.plan.lights.length, 0)} ambient lights`);
    }

    // --- 2. classify, unless we already know
    const shots = {};
    let types = roomTypes;
    if (classify) {
      stepTo('types');
      paint({ detail: `${PROJECT_BY_ID[projectId]?.label ?? 'Project'} — reading each space` });
      total += list.length;
      const found = {};
      await mapLimit(list, 3, async (r) => {
        if (cancelPrep.current) return null;
        roomState[r.id] = 'busy'; paint({ detail: `Reading ${r.outline.name || 'a room'}` });
        try {
          const out = await computeRoomType(r);
          // The crop is kept and reused by the next two passes. It is the same
          // picture of the same room, and building it three times is three
          // canvas renders and three JPEG encodes for one image.
          shots[r.id] = out.shot;
          found[r.id] = { type: out.type, confidence: out.confidence,
                          why: out.why, matched: out.matched };
        } catch (err) {
          console.warn('[types] failed for', r.outline.name, err);
          failed.types++;
          found[r.id] = { type: 'other', confidence: 0, why: 'could not be read', matched: false };
        }
        roomState[r.id] = 'done'; done++; paint();
        return null;
      });
      if (cancelPrep.current) { setPrep(null); return; }
      // MERGED, for the reason in this function's header: `found` covers only
      // the rooms in this run, and replacing the map would drop the type of
      // every room that was not.
      types = { ...roomTypes, ...found };
      docActions.mergeRoomTypes(found);
      const named = (r) => roomTypeIn(projectId, found[r.id]?.type)?.label ?? 'unclassified';
      note('types', withFails(list.map((r) => named(r)).slice(0, 4).join(', ')
        + (list.length > 4 ? `, +${list.length - 4}` : ''), failed.types));
      console.log('[pipeline] room types', found);
    }

    // --- 2b. bedrooms with no bed in them
    //
    // A CONTRADICTION, NOT A RESULT. See refindBeds for why this happens on a
    // large plan and why it matters more than any other miss: a bed is the one
    // piece of furniture that changes the ceiling, and a missed one is a
    // downlight over somebody's face.
    //
    // Gated on `classify` because the question cannot be asked without the
    // answer to "what kind of space is this", and on `beds` so that a re-run
    // asking only for accents does not quietly spend a model call per room.
    if (beds && classify) {
      // ASKING CHATGPT IS THE EXCEPTION, NOT THE ROUTINE.
      //
      // The whole sheet goes to the `bed-filter` workflow on upload — one call,
      // one trained segmenter — and that is the primary path for every bed on
      // every plan. This step exists for ONE situation: the classifier has
      // called a space a BEDROOM and the whole-plan pass put no bed in it. A
      // declared bedroom with no bed is a contradiction between two answers we
      // already have, and the cheapest way to resolve it is to look at that one
      // room, on its own, at four times the resolution.
      //
      // ONE CALL PER SUCH ROOM, and only such rooms. Not two samples, not a
      // judge — see the header of refindBeds.
      //
      // NO PLAN-SIZE BRANCH. It used to re-ask every bedroom on a sheet over
      // LARGE_PLAN_SQFT, on the theory that a big sheet's hits are as likely to
      // be mis-attributed neighbours as real beds. That is two calls per bedroom
      // spent on rooms whose answer nobody doubted, and the size of the sheet is
      // a poor proxy for the thing actually being asked. The contradiction is
      // the trigger; nothing else is.
      const bedrooms = list.filter((r) => expectsBed(projectId, types[r.id]?.type));
      const isEmpty = (r) => {
        const poly = r.plan?.polygonPx ?? r.geo?.polygonPx;
        return poly ? bedsIn(bedsNow, poly).length === 0 : false;
      };
      const empty = bedrooms.filter(isEmpty);

      stepTo('beds2');
      total += empty.length;
      if (!empty.length) note('beds2', 'every bedroom already has a bed');
      // `inRun` FOR THE SAME REASON THE WORK LIST IS NARROWED: a partial run
      // must not paint a row for a space it is not touching. See the header.
      for (const o of outlines) if (inRun(o.id)) roomState[o.id] = empty.some((r) => r.id === o.id) ? 'idle' : 'done';
      paint({ detail: empty.length
        ? `${empty.length} bedroom${empty.length > 1 ? 's' : ''} with no bed — looking closer`
        : 'nothing to re-check' });

      // Two at a time, like the accent pass: eight at once is how a rate limit
      // turns into eight failures instead of one queue.
      const rows = await mapLimit(empty, 2, async (r) => {
        if (cancelPrep.current) return null;
        roomState[r.id] = 'busy';
        paint({ detail: `Looking again in ${r.outline.name || 'a bedroom'}` });
        try {
          const out = await refindBeds(r, { reuseShot: shots[r.id] });
          roomState[r.id] = 'done'; done++; paint();
          return { id: r.id, name: r.outline.name,
                   poly: r.plan?.polygonPx ?? r.geo?.polygonPx ?? null, ...out };
        } catch (err) {
          console.warn('[beds] failed for', r.outline.name, err);
          failed.beds2++;
          roomState[r.id] = 'done'; done++; paint();
          return null;
        }
      });
      if (cancelPrep.current) { setPrep(null); return; }

      // The same three rules the admin button applies — see absorbBedRows.
      const { found, verdicts } = absorbBedRows(rows, bedsNow);
      if (found.length) bedsNow = [...bedsNow, ...found];

      const stillEmpty = empty.length
        - rows.filter((x) => x && (x.rec.winner || []).length).length;
      if (empty.length) {
        note('beds2', withFails(
          `${found.length} bed${found.length === 1 ? '' : 's'} in ${empty.length} `
          + `bedroom${empty.length === 1 ? '' : 's'}`
          + (stillEmpty ? ` · ${stillEmpty} still empty` : ''), failed.beds2));
      }
      console.log(`[beds] ${empty.length} declared bedroom(s) had no bed after the`
        + ` whole-plan pass — asked GPT about each crop, added ${found.length}`, { verdicts });
    }

    const forAccents = list.filter((r) => wantsAccents(projectId, types[r.id]?.type));
    const forSpots = list.filter((r) => wantsSpots(projectId, types[r.id]?.type));

    // --- 3. accents, for the types entitled to them
    if (accents) {
      total += forAccents.length;
      stepTo('accents');
      if (!forAccents.length) note('accents', 'nothing in this plan takes accents');
      paint({ detail: forAccents.length
        ? `${forAccents.length} space${forAccents.length > 1 ? 's' : ''} qualify` : 'none' });
      for (const o of outlines) if (inRun(o.id)) roomState[o.id] = forAccents.some((r) => r.id === o.id) ? 'idle' : 'done';
      const got = {};
      await mapLimit(forAccents, 2, async (r) => {
        if (cancelPrep.current) return null;
        roomState[r.id] = 'busy'; paint({ detail: `Accents in ${r.outline.name || 'a room'}` });
        try {
          // `bedsNow` AND NOT `detections`. This step runs after 2b in the same
          // invocation, so the GPT crop's beds are in the local list but not yet
          // in React state — a bedroom bed-filter missed would otherwise get its
          // sconces from no bed at all. Same reason the bed list is threaded
          // through this function rather than read back: a setState is not
          // visible until the next render and this loop does not get one.
          const out = await computeAccents(r, { reuseShot: shots[r.id], beds: bedsNow });
          got[r.id] = out.result;
        } catch (err) { console.warn('[accents] failed for', r.outline.name, err); failed.accents++; }
        roomState[r.id] = 'done'; done++; paint();
        return null;
      });
      if (cancelPrep.current) { setPrep(null); return; }
      // A re-run REPLACES a room's fittings, so its dismissals go too — the ids
      // are positional and would otherwise strike out whatever takes that index
      // next.
      docActions.dropAccentDismissals(forAccents.map((r) => r.id));
      docActions.mergeAccentResults(got);
      const fittings = Object.values(got)
        .reduce((n, a) => n + a.zones.filter((z) => !z.rejected).length, 0);
      if (forAccents.length) {
        note('accents', withFails(`${fittings} fitting${fittings === 1 ? '' : 's'}`, failed.accents));
      }
    }

    // --- 4. task surfaces, which is what the directional spots derive from
    if (surfaces) {
      total += forSpots.length;
      stepTo('spots');
      if (!forSpots.length) note('spots', 'nothing to aim at');
      for (const o of outlines) if (inRun(o.id)) roomState[o.id] = forSpots.some((r) => r.id === o.id) ? 'idle' : 'done';
      paint({ detail: forSpots.length ? 'Looking for task surfaces' : 'none' });
      const got = {};
      await mapLimit(forSpots, 2, async (r) => {
        if (cancelPrep.current) return null;
        roomState[r.id] = 'busy'; paint({ detail: `Task surfaces in ${r.outline.name || 'a room'}` });
        try {
          const out = await computeSurfaces(r, { reuseShot: shots[r.id] });
          got[r.id] = out.result;
        } catch (err) { console.warn('[surfaces] failed for', r.outline.name, err); failed.surfaces++; }
        roomState[r.id] = 'done'; done++; paint();
        return null;
      });
      if (cancelPrep.current) { setPrep(null); return; }
      docActions.dropSurfaceDismissals(forSpots.map((r) => r.id));
      docActions.mergeSurfaceResults(got);
      const n = Object.values(got).reduce((acc, sr) => acc + sr.surfaces.length, 0);
      if (forSpots.length) note('spots', withFails(`${n} surface${n === 1 ? '' : 's'}`, failed.surfaces));
    }

    const anyFailed = failed.types + failed.accents + failed.surfaces + failed.beds2;
    steps = allDone(steps);
    paint({ phase: anyFailed ? 'Ready, with gaps' : 'Ready',
            detail: anyFailed
              ? `${anyFailed} space${anyFailed > 1 ? 's' : ''} could not be read — recompute from the panel`
              : '' });
    // A beat on "Ready" rather than a cut. The list of what was found is worth
    // half a second, and a loader that vanishes the instant it completes reads
    // as a glitch.
    await new Promise((res) => setTimeout(res, anyFailed ? 2200 : 550));
    setPrep(null);
    // WHAT THE RUN ANSWERED IS NO LONGER OUTSTANDING. A full run clears the list
    // outright; a partial one clears only the ids it was given, so a space
    // somebody moved WHILE this was running stays marked and is still offered.
    if (relight) docActions.clearDirty(ids);
    // ...AND THE TRACER GETS OUT OF THE WAY. A relight is the act of leaving the
    // outlines, so finishing one lands on the drawing it just built rather than
    // back on the screen the user pressed the button from.
    /* ...AND ON THE SPACES TAB, WHICH USED TO BE Design. Finishing a run means
       the spaces have been taken up; what somebody does next is go into one and
       say how high it is and what it is finished in — see AUTO_GRID. Design is
       the tab with nothing on it until a tool has been used. */
    if (relight) { setOutlinesOpen(false); docActions.setView('spaces'); }
    /* AND THE DESIGN SCREEN INTRODUCES ITSELF WHEN IT ARRIVES — but nothing
       about that is arranged here. The run used to raise the flag itself, which
       made a hint about the ceiling a property of HOW you got to the design
       rather than of being on it: a reload of the same plan, or "Back to the
       design" from the outlines, landed on the identical screen and said
       nothing. It is a fact about arriving, so it is watched for where arriving
       can be seen — see `landed` and the effect that raises it. */
    // A DESIGN NOW EXISTS. This is the moment worth a snapshot and a row in the
    // revision trail — the beat above is also what makes it safe, since React
    // has re-rendered by now and the milestone reads the finished state rather
    // than the state as it was when this function was called.
    milestone.current?.('design');
    /* `planAreaSqft` IS IN THIS ARRAY AND IS NOT READ IN THE BODY, and it was
       carried across from App unchanged rather than tidied away: dropping it
       would make this callback stabler than it has ever been, which is a change
       to when it is rebuilt and not the extraction this move is. The
       `exhaustive-deps` warning it earns travelled with it, unsuppressed, so
       whoever decides to drop it does so on purpose. */
  }, [source, outlines, projectId, roomTypes, pxPerFt, useBoundingRect,
      bedSets, detections, computeBedFit, computeRoomType, computeAccents, computeSurfaces,
      refindBeds, absorbBedRows, planAreaSqft, claimSpaces, docActions,
      setPrep, cancelPrep, setPickingId, setOutlinesOpen, milestone]);

  /* --- CONFIRMING THE OUTLINES, WHICH IS NOT A RUN -------------------------
   *
   * THE PLAN IS NOT LIT FOR YOU ANY MORE, so the press that leaves this screen
   * has stopped being the expensive one. It used to mean "compute my layout":
   * beds, classification, accent zones and task surfaces, up to four model calls
   * per room, behind a checklist that was a minute long on a six-room flat. That
   * whole wait existed to produce a design nobody had asked for in detail.
   *
   * WHAT IT MEANS NOW IS "THESE OUTLINES ARE RIGHT". The spaces are taken up,
   * the design screen opens, and the person starts placing light. There is
   * nothing to watch, so there is no loader — the landing IS the response to the
   * press.
   *
   * TWO PASSES STILL RUN, AND THEY RUN BEHIND THE DESIGN SCREEN.
   *
   *   CLASSIFY  what kind of space each one is, which is what sets its lux
   *             target. A bedroom and a kitchen do not want the same light, and
   *             nobody should have to say so twice.
   *   BEDS      where the beds are, which is what lets the ceiling warn somebody
   *             who is about to put a downlight over a pillow.
   *
   * NEITHER BLOCKS ANYTHING. Both only ever ADD — a lux target the panel reads
   * and a zone the canvas draws — so arriving a few seconds after the user does
   * costs them nothing and waiting for them costs a few seconds of staring.
   *
   * AND NO ACCENTS, NO TASK SURFACES. Those place fittings, and placing fittings
   * is the user's job now. `run()` still performs them on demand from the
   * panels' own recompute buttons, which is where an expensive pass belongs: a
   * press, with a wait the presser asked for.
   *
   * THE ORDER IS REVERSED FROM `run()` AND HAS TO BE. There, the beds were
   * decided BEFORE the layout so the geometry memo was built once with their
   * zones in it. Here the layout must exist immediately, so it is relit first
   * and the beds fold in when they arrive — one extra recompute, on a screen the
   * user is already using, in exchange for the wait disappearing.
   */
  const confirmOutlines = useCallback(async (opts = {}) => {
    const ids = opts?.only ?? null;
    const inRun = (id) => !ids || ids.includes(id);

    // THE TILL STILL STANDS IN FRONT. Taking up a space is what is charged for,
    // and that has not changed because the passes behind it did. It is the one
    // thing awaited before landing: a refusal must not land on a design.
    if (!await claimSpaces(ids ?? outlines.map((o) => o.id))) return;

    /* --- THE LANDING, AND IT IS SYNCHRONOUS ------------------------------ */
    docActions.relight(ids);
    docActions.clearDirty(ids);
    setPickingId(null);
    setOutlinesOpen(false);
    docActions.setView('spaces');

    /* --- ...AND THE TWO PASSES, BEHIND IT -------------------------------- */
    // NOT AWAITED BY THE CALLER. Everything past here is allowed to take as long
    // as it takes, and a failure is a console line rather than a screen.
    (async () => {
      // THE ROOMS HAVE TO EXIST FIRST, and they cannot until React has
      // re-rendered with the new litIds — see the note at `roomsRef`. Same wait
      // the run does, for the same reason; the difference is that nobody is
      // watching it.
      let list = [];
      for (let i = 0; i < 80; i++) {
        list = (roomsRef.current || []).filter((r) => r.plan?.ok && inRun(r.id));
        if (list.length) break;
        await new Promise((res) => setTimeout(res, 60));
      }
      if (!list.length) { console.warn('[confirm] no spaces laid out — passes skipped'); return; }

      /* THE MILESTONE FIRES HERE AND NOT AT THE LANDING, and the difference is
         what it would record. `milestone.current` is REASSIGNED every render and
         closes over that render's `editorState`, `stats` and `getSnapshot` — so
         calling it in the same tick as `relight()` runs the closure from the
         render BEFORE the spaces were taken up, and files a revision of the
         document as it was a moment earlier, with a snapshot of an empty plan.
         `run()` bought the same safety with a deliberate half-second beat before
         its final paint; here the wait for the rooms above already provides it,
         and provides it for a better reason: by now the layout it is recording
         demonstrably exists. */
      milestone.current?.('design');

      // --- what kind of space each one is, which is what sets its lux target
      const shots = {};
      let types = roomTypes;
      const found = {};
      await mapLimit(list, 3, async (r) => {
        try {
          const out = await computeRoomType(r);
          shots[r.id] = out.shot;
          found[r.id] = { type: out.type, confidence: out.confidence,
                          why: out.why, matched: out.matched };
        } catch (err) {
          console.warn('[types] failed for', r.outline.name, err);
          found[r.id] = { type: 'other', confidence: 0, why: 'could not be read', matched: false };
        }
        return null;
      });
      types = { ...roomTypes, ...found };
      docActions.mergeRoomTypes(found);
      console.log('[confirm] room types', found);

      // --- the beds, so the ceiling can warn about a light over a pillow
      //
      // A DECLARED BEDROOM WITH NO BED IS THE ONLY THING RE-ASKED, exactly as in
      // `run()`: the whole-sheet pass on upload is the primary path, and this
      // resolves the contradiction between two answers already in hand. See
      // refindBeds.
      const bedsNow = detections;
      const bedrooms = list.filter((r) => expectsBed(projectId, types[r.id]?.type));
      const empty = bedrooms.filter((r) => {
        const poly = r.plan?.polygonPx ?? r.geo?.polygonPx;
        return poly ? bedsIn(bedsNow, poly).length === 0 : false;
      });
      if (!empty.length) { console.log('[confirm] every bedroom already has a bed'); return; }

      const rows = await mapLimit(empty, 2, async (r) => {
        try {
          const out = await refindBeds(r, { reuseShot: shots[r.id] });
          return { id: r.id, name: r.outline.name,
                   poly: r.plan?.polygonPx ?? r.geo?.polygonPx ?? null, ...out };
        } catch (err) {
          console.warn('[beds] failed for', r.outline.name, err);
          return null;
        }
      });
      const { found: moreBeds, verdicts } = absorbBedRows(rows, bedsNow);
      console.log(`[confirm] ${empty.length} bedroom(s) had no bed — added ${moreBeds.length}`,
        { verdicts });
    })();
  }, [outlines, projectId, roomTypes, detections, claimSpaces, docActions,
      computeRoomType, refindBeds, absorbBedRows, setPickingId, setOutlinesOpen, milestone]);

  /** Stop the run where it is and land on whatever finished. */
  const stopPipeline = useCallback(() => {
    cancelPrep.current = true;
    setPrep(null);
  }, [setPrep, cancelPrep]);

  /** The shapes the loader draws — see `loaderShapes`, which carries the note
   *  on why they come off the outlines and not off the computed rooms. */
  const loaderRooms = useMemo(() => loaderShapes({
    outlinesPx, roomTypes, projectId, roomState: prep?.roomState,
  }), [outlinesPx, prep, roomTypes, projectId]);

  return { prep, loaderRooms, run: runPipeline, stop: stopPipeline, confirmOutlines };
}
