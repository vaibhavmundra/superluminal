import { useCallback, useEffect, useMemo, useRef } from 'react';
import { analyseSpace } from '../../lib/lumens.js';
import { materialsOf } from '../../lib/materials.js';
import { buildBOQ } from '../../lib/boq.js';
import { boqToCSV, boqToXLSX, boqToPDF, CSV_BOM } from '../../lib/boqExport.js';
import { MODULE_BY_ID } from '../../lib/magTrack.js';
import { planTotals, fixtureGroups, highlightRows, troubleLines,
         fittingOffTest } from './lightingRules.js';

/**
 * WHAT THIS PLAN ADDS UP TO — the feature's SECOND call site, and the one
 * every other domain reads through.
 *
 * IT STANDS WHERE THE BLOCK IT REPLACES STOOD, below `useFixtures` and above
 * `useFixtureCommands`, and the position is load-bearing in both directions. It
 * reads the projected fittings — `tracks.modulesPx`, `arrays.lampsPx` — so it
 * cannot stand above the call that builds them; and `useFixtureCommands` is
 * handed `spaceAnalysis`, which the diffuser allocator runs backwards, so it
 * cannot stand below that. A `useMemo` evaluates its dependency array on every
 * render, so a reader above its own `const` is a temporal dead zone and a blank
 * screen.
 *
 * IT COORDINATES FOUR DOMAINS THROUGH THEIR PUBLIC LISTS AND NOTHING ELSE. The
 * accent runs and the task surfaces arrive as `features/scene/`'s projections,
 * the tracks, modules and array lamps as `features/fixtures/`'s, the room
 * polygons and ambient grids as `usePlanScene`'s rooms. Nothing here reaches
 * into any of their private files, and nothing here holds a fitting: every
 * store it reads — `manualCobs`, `cobArrays`, `ceilingObjs`, `fixtureWatts`,
 * `materials` — is still `usePlanDoc`'s and is read out of what App hands in.
 *
 * NOTHING HERE IS STATE. Every value is a memo or a callback over those lists,
 * which is what makes "the schedule matches the drawing" a property of the code
 * rather than something to remember. A BOQ held in state would be a second copy
 * of the drawing that drifts the moment a light moves — and lights move
 * constantly: a fan is dropped, a chunking is re-picked, a strip is dragged.
 */
export default function useLightingAnalysis({
  rooms, pxPerFt, source, country, projectId,
  accentZonesPx, taskSpotsPx,
  magTracksPx, trackModulesPx, arrayCobsPx,
  manualCobs, cobArrays, ceilingObjs,
  materials, fixtureWatts, fixtureOff, ceilingMmFor,
  selCobId, selArrayId, selModuleId, selAccId, selSpotId, selLightId, selShapeId,
  selObjIds,
  docActions, setOptionPick,
}) {
  const totals = useMemo(() => planTotals(rooms), [rooms]);

  /**
   * THE AIMED SPOTS THAT ACTUALLY LANDED, for the Result panel's count.
   *
   * `taskSpotsPx` carries an entry for every surface the placer was ASKED about,
   * including the ones it turned down — those hold a `rejected` or `skipped`
   * reason and no coordinates, so the panel can say why a dining table has no
   * spot over it. They are not fittings and must not be counted as any.
   */
  const spotsPlaced = useMemo(
    () => taskSpotsPx.filter((sp) => !sp.rejected && sp.x != null).length,
    [taskSpotsPx]);

  /**
   * RUNS OF TAPE ON THE DRAWING — coves, reverse coves, shelf strips and every
   * run somebody set out by hand.
   *
   * A COUNT AND NOT METRES, which is a change of unit from what the Result
   * panel printed and is deliberate. The footer line beside it counts LIGHTS and
   * SPOTS, and "12 lights, 3 spots, 4.7 m of strip" mixes a quantity with a
   * measurement in one comma list — the eye reads all three as counts and the
   * third one is not. The metres are still on the schedule, which is where a
   * number somebody orders against belongs.
   */
  const stripRuns = useMemo(
    () => accentZonesPx.filter((a) => a.type === 'strip' && !a.rejected).length,
    [accentZonesPx]);

  /** WHAT IS ON ONE CEILING, COUNTED BY FAMILY — see `fixtureGroups`, which
   *  carries the whole argument for which rows merge and which do not. */
  const groupsFor = useCallback((r) => fixtureGroups(r, {
    accentZonesPx, taskSpotsPx, cobArrays, arrayCobsPx,
    magTracksPx, trackModulesPx, manualCobs, pxPerFt,
    /* THE SAME MAP `analyseSpace` RESOLVES THE ROWS AGAINST, handed in one step
       earlier for one reason: a grid downlight's row opens at whatever the ROOM
       was set to before each lamp had a row of its own. That is a per-room
       legacy figure rather than a per-row one, so the only place that can apply
       it is the one deciding what the rows ARE. See the grid block. */
    roomWatts: fixtureWatts[r.id] ?? {},
    /* WHICH OF THEM ARE SWITCHED OFF. Same shape and same handle as the wattages
       above — a sparse map keyed by row — and handed in at the same step for the
       same reason: the only thing that can match a stored key to a fitting is
       the function deciding what the rows are. */
    roomOff: fixtureOff[r.id] ?? {},
  }), [accentZonesPx, taskSpotsPx, pxPerFt, manualCobs, cobArrays, arrayCobsPx,
       magTracksPx, trackModulesPx, fixtureWatts, fixtureOff]);

  /**
   * IS THIS SPACE BRIGHT ENOUGH — the Analysis section of the space detail.
   *
   * ASKED PER SPACE, WHICH IS THE POINT. The figure in the footer is the whole
   * plan's, and that is the right thing for a sheet and the wrong thing for a
   * decision: you light a bedroom against a bedroom's surfaces, and a flat that
   * averages out can hold one room a thousand lumens short.
   *
   * EVERY INPUT IS SOMETHING THE PANEL ABOVE THIS ONE ASKED FOR — the height,
   * the three finishes, the wattage of each family. That is the whole design:
   * Materials is what the room IS, and this is what that makes it, and pressing
   * anything in the first moves the second while you watch. See lib/lumens.js
   * for the model and for every constant it reads.
   */
  const spaceAnalysis = useCallback((r) => analyseSpace({
    polygonFt: r.geo.polygonFt,
    ceilingMm: ceilingMmFor(r.id),
    materials: materialsOf(materials, r.id),
    projectId,
    // WHERE THE BUILDING IS, and it decides what a watt is worth: 75 lm/W in
    // India against 100 elsewhere. Same prop the switchboards read, same
    // forgiving lookup — see `lumensPerWattFor`.
    country,
    groups: groupsFor(r),
    watts: fixtureWatts[r.id] ?? {},
  }), [ceilingMmFor, materials, projectId, country, groupsFor, fixtureWatts]);

  /**
   * THE SAME FIGURE FOR THE WHOLE PLAN — what the footer prints.
   *
   * A SUM OF THE ROOMS AND NOT A SECOND MODEL. It comes out of `spaceAnalysis`,
   * one room at a time, so the line at the bottom of the screen and the panel
   * beside it cannot come to disagree — which they would within a week if this
   * recomputed anything.
   *
   * IT SUMMED `achieved` TOO, and the footer compared the two. That figure is no
   * longer on the analysis (see the end of `analyseSpace`), so what the plan
   * reports is what it is owed.
   */
  const planLumens = useMemo(() => {
    let required = 0;
    for (const r of rooms) required += spaceAnalysis(r).required;
    return { required };
  }, [rooms, spaceAnalysis]);

  /** WHICH ANALYSIS ROWS THE CURRENT SELECTION IS — see `highlightRows`, which
   *  carries the note on why a row key is not a fitting id. */
  const highlight = useMemo(() => highlightRows({
    selCobId, selArrayId, selModuleId, selAccId, selSpotId, selLightId, selShapeId,
    selObjIds,
    manualCobs, cobArrays, trackModulesPx, accentZonesPx, taskSpotsPx, rooms,
  }), [selCobId, selArrayId, selModuleId, selAccId, selSpotId, selLightId, selShapeId,
      selObjIds, manualCobs, cobArrays, trackModulesPx, accentZonesPx, taskSpotsPx,
      rooms]);

  /**
   * CLICKING A FITTING TAKES YOU TO IT IN THE ANALYSIS.
   *
   * ONE EFFECT AND NOT FOUR HANDLERS, which is why `highlight` carries the room
   * as well as the keys. A COB, a length of tape, a spot and a grid light are
   * picked up by four different pointer handlers with four different stores
   * behind them, and "show me what I just clicked" is one behaviour: put it in
   * each of them and the fourth one gets forgotten, which is exactly what had
   * already happened before this existed.
   *
   * IT FIRES ON THE SELECTION CHANGING AND NOT ON EVERY RENDER, so somebody who
   * selects a lamp and then goes to read the BOQ is not dragged back to the
   * drawing a moment later. `keys` is the dependency; re-selecting the same
   * fitting is not a change and does nothing.
   *
   * GETTING TO THE RIGHT VIEW AND THE RIGHT ROW IS THE WINDOW'S HALF. This gets
   * the right space in front of you; SpaceDetail swaps itself over to the
   * fitting list, and SpaceAnalysis opens that row and scrolls to it. The split
   * is the same one this feature makes everywhere: which space the window is
   * about is the editor's business, how the window reads is the window's.
   *
   * `setView('spaces')` MEANS "GET BACK ONTO THE DRAWING" AND NOT "the Spaces
   * tab". There are no tabs any more — see the note where the strip used to be
   * in App.jsx — and the only thing `view` still decides is which SCENE has the
   * stage: 'boq' and 'boards' are the two sheets, and every other value is the
   * plan. This line is a press on a fitting getting the schedule out of the way,
   * which is what it always was.
   *
   * `setOptionPick` IS HANDED IN, because the pill it puts away is App's — one
   * chunk's options, over the drawing, owned by the canvas rather than by any
   * one domain.
   */
  const revealed = useRef('');
  useEffect(() => {
    const { keys, roomId } = highlight;
    const tag = keys.join('|');
    if (!tag) { revealed.current = ''; return; }
    if (tag === revealed.current) return;
    revealed.current = tag;
    if (roomId) { docActions.setFocusId(roomId); setOptionPick(null); }
    docActions.setView('spaces');
  }, [highlight, docActions, setOptionPick]);

  /** One line per room, and only where something actually went wrong. */
  const troubles = useMemo(() => troubleLines(rooms), [rooms]);

  /**
   * THE SCHEDULE, derived like everything else here.
   *
   * A BOQ held in state would be a second copy of the drawing that drifts the
   * moment a light moves — and lights move constantly: a fan is dropped, a
   * chunking is re-picked, a strip is dragged. So it is a memo over the same
   * sources the canvas draws from, which makes "the schedule matches the
   * drawing" a property of the code rather than something to remember.
   */
  const boq = useMemo(() => buildBOQ({
    rooms,
    accents: accentZonesPx,
    spots: taskSpotsPx,
    objects: ceilingObjs,
    /* THE MAGNETIC TRACKS AND THEIR MODULES, resolved. The profile is billed by
       the metre off the LIVE outline and the LIVE scale — never a stored length,
       which is the rule `runMetres` exists to enforce — and each module names
       its own catalogue line. See `magTracksPx`. */
    magTracks: magTracksPx,
    /* AND EACH MODULE'S OWN WATTAGE AND OPTIC WITH IT, which is what was
       missing: only the room and the catalogue line were handed over, so the
       schedule billed every diffuser at the catalogue's 18 W however it was
       specified on the drawing — and a hand-placed one opens at 10 W. A module
       carries its figures on itself (see `placeModule`) exactly as a
       hand-placed COB does, and `buildBOQ` gives it a line per specification
       for the same reason. */
    modules: trackModulesPx.map((m) => ({
      roomId: m.roomId, fixture: MODULE_BY_ID[m.kind]?.fixture ?? null,
      watts: m.watts, beam: m.beam })),
    /* --- AND EVERY DOWNLIGHT A HAND PUT DOWN, WHICH WAS NOT BEING BILLED ----
       THE SCHEDULE HAD NO COBs IN IT AT ALL. `rooms` carries what the gridding
       ENGINE placed and nothing else; a lamp clicked onto the ceiling lives in
       `manualCobs` and a lamp on a ring is one of an array's, and neither list
       was ever handed over — so a plan laid out entirely by hand scheduled
       nothing. `buildBOQ` gives them a line per (wattage, beam) pair; see
       `cobLineId`.
       THE DOCUMENT'S OWN LIST FOR THE LOOSE ONES AND THE PROJECTION FOR THE
       ARRAYS, which is not an inconsistency: a manual COB stores its room, its
       wattage and its optic on itself, and an array stores one specification
       and a COUNT — its lamps only exist once the geometry has been resolved.
       `arrayCobsPx` is that resolution and is already computed for the canvas.
       Neither position is read here; only the room and the two figures. */
    cobs: [...manualCobs, ...arrayCobsPx],
    pxPerFt,
    plan: source?.name ?? null,
  }), [rooms, accentZonesPx, taskSpotsPx, ceilingObjs, magTracksPx, trackModulesPx,
       manualCobs, arrayCobsPx, pxPerFt, source]);

  /**
   * THE SCHEDULE AS A FILE, PREPARED BUT NOT HANDED OVER. Three formats, one
   * table — see boqExport.js.
   *
   * THE DOWNLOAD ITSELF IS NOT HERE, AND THAT IS THE BOUNDARY. Naming the file,
   * titling the sheet and encoding the table are all facts about the SCHEDULE;
   * putting a blob in front of a person is a fact about a BROWSER, and it is
   * gated by the contact form, which is App's. So this answers with the three
   * things `download` needs and App spends them — one gate, one call, three
   * formats, exactly as before.
   */
  const boqFile = useCallback((fmt) => {
    const base = (source?.name || 'plan').replace(/\.[^.]+$/, '');
    const title = `Lighting schedule — ${base}`;
    if (fmt === 'csv') {
      // The BOM is what makes Excel read the file as UTF-8 rather than as the
      // local codepage, which is the difference between 36° and 36Â°.
      return { name: `${base}-boq.csv`, data: CSV_BOM + boqToCSV(boq),
               mime: 'text/csv;charset=utf-8' };
    }
    if (fmt === 'xlsx') {
      return { name: `${base}-boq.xlsx`, data: boqToXLSX(boq),
               mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    }
    return { name: `${base}-boq.pdf`, data: boqToPDF(boq, { title }),
             mime: 'application/pdf' };
  }, [boq, source]);

  /**
   * IS THIS DRAWN FITTING SWITCHED OFF — for the canvas, which draws from the
   * projected lists and knows nothing about rows.
   *
   * BUILT HERE BECAUSE THIS IS WHERE THE STORE ARRIVES, and the mapping it
   * closes over is `lightingRules`' — see `fittingOffTest`. The canvas is handed
   * the finished tests rather than the store, so the one place that decides what
   * a row IS stays the one place that can resolve a key.
   *
   * WHAT IT IS FOR IS THE CLAIMS AND NOT THE SYMBOLS. An off lamp is still a
   * hole in the ceiling and is still drawn; what it must stop doing is claiming
   * light — the pool on the floor, the halo under it, the dotted beam footprint.
   * The lumen model already agrees (see `off` in `analyseSpace`), and the
   * heatmap follows the lumen model, so this is what keeps the third reader —
   * the drawing — from being the only one still saying the lamp is lit.
   */
  const fittingOff = useMemo(() => fittingOffTest(fixtureOff), [fixtureOff]);

  return {
    analysis: { totals, planLumens, spaceAnalysis, groupsFor, highlight,
                fittingOff, stripRuns, spotsPlaced, troubles },
    boq: { table: boq, file: boqFile },
  };
}
