import { useEffect, useMemo, useRef, useState } from 'react';
import { materialsOf, toneOf } from '../../lib/materials.js';
import { M_PER_FT } from './grid.js';
import { buildRoomGeometry, solveRoom, surfacePass } from './solve.js';
import { buildSphereTransfer } from './reflection.js';
import { solveIndirect, solveAverage, probeHeightFor,
         probeWasClamped } from './indirect.js';
import { buildRoomEmitters, polygonInMetres } from './emitters.js';
import { heatmapTargetForLayer, heatmapLayerFor,
         HEATMAP_PLANE } from './heatmapTargets.js';
import { readHeatmapPalette } from './colours.js';
import useHeatmapLayer from './useHeatmapLayer.js';

// ---------------------------------------------------------------------------
// useHeatmap — WHEN THE SOLVER RUNS, AND WHAT IT IS ALLOWED TO COST.
//
// EVERY DECISION IN THIS FILE IS ABOUT NOT DOING WORK. The physics is in
// solve.js, the probes are in indirect.js and the adaptation is in emitters.js;
// what is here is four rules:
//
//   1. OFF MEANS OFF. The switch is the first line of the memo, before anything
//      is read, so a plan with the heatmap down pays for no grid, no patch set,
//      no transfer matrix and no bounce. A gate further in would still have
//      built the geometry.
//
//   2. THE GEOMETRY IS CACHED AND THE FITTINGS ARE NOT. A room's patch set and
//      its two transfer matrices are the expensive half and they depend on the
//      OUTLINE, the HEIGHT and the FINISHES — never on where a light is. So
//      they are kept per room against a signature of exactly those inputs, and
//      dragging a downlight round a ceiling re-runs the direct pass and the
//      bounce over a matrix that was already there. Change a wall tone and the
//      signature changes and it is rebuilt, which is correct: a dark wall is a
//      different room to light.
//
//   3. THE LIGHT TRANSPORT IS CACHED TOO, AND IT IS WHAT THE SECOND LAYER RIDES
//      ON. `surfacePass` produces one vector — the lumens each surface hands
//      back — and it depends on the room and the fittings and on NOTHING ELSE:
//      not the layer, not the probe height, not the target. So it is kept
//      against a signature of the emitters, and switching layers, moving the
//      measurement height or editing a target re-gathers a vector that is
//      already there rather than solving the room again. See `sourcesSignature`
//      and the three-level cache in the body.
//
//   4. A MOVING HAND GETS THE COARSE ANSWER. While anything is changing the
//      solve runs at half the resolution — a quarter of the cells, a third of
//      the patches — and the full one lands a moment after the hand stops. That
//      is done WITHOUT a drag signal threaded down from App, and deliberately:
//      the inputs change identity on every frame of a drag, which is the signal.
//      One timer, reset by every change, and the fine pass is what happens when
//      it finally gets to fire.
//
// WHAT COMES BACK IS READY TO PAINT. One entry per room holding the ratio field
// over its own grid, the box it covers in PLAN PIXELS, and the target it was
// judged against — see HeatmapOverlay, which draws it and computes nothing —
// plus the layer state the legend both reads and sets, so that the field on the
// drawing and the name on the card cannot come apart.
// ---------------------------------------------------------------------------

/** How long the hand has to be still before the full-resolution pass runs.
 *  Long enough that a drag never triggers one, short enough that letting go
 *  feels like it settled rather than like it caught up. */
export const SETTLE_MS = 140;

/** Nothing at all, and it is a module constant so that a switched-off heatmap
 *  hands every consumer the same object on every render and re-renders none of
 *  them. */
const EMPTY = {
  on: false, rooms: [], palette: null, plane: HEATMAP_PLANE,
  targets: [], distinct: [], focusTarget: null, mode: null, ms: 0,
};

/** THE SIGNATURE THE GEOMETRY CACHE COMPARES — the outline, the height, the
 *  three finishes and the scale, and nothing else. Written as a string because
 *  that is what makes "has anything that matters changed" one comparison rather
 *  than a deep walk, and because the outline is a list of points whose identity
 *  changes on every layout even when its values do not. */
function geometrySignature(room, ceilingMm, mats, metresPerPx, mode) {
  const poly = room.geo?.polygonPx ?? [];
  let s = `${mode}|${metresPerPx.toFixed(6)}|${ceilingMm}|`;
  s += `${toneOf(mats.ceiling)}${toneOf(mats.floor)}|`;
  for (let i = 0; i < poly.length; i++) {
    s += `${poly[i].x.toFixed(2)},${poly[i].y.toFixed(2)};`;
    // PER WALL, because the patches carry per-wall reflectance — see
    // `buildPatches`. An averaged tone here would leave a dark accent wall
    // reflecting like emulsion until something else happened to invalidate.
    s += `${toneOf(mats.walls?.[i])}|`;
  }
  return s;
}

/**
 * ...AND THE SIGNATURE THE LIGHT-TRANSPORT CACHE COMPARES: every emitter, by
 * everything the solver reads off it.
 *
 * IT HAS TO BE THE VALUES AND NOT THE IDENTITY. `buildRoomEmitters` builds a
 * fresh list on every call — it is an adapter over lists that are themselves
 * rebuilt on every layout — so an identity check would miss every hit and this
 * cache would never fire. What actually decides the answer is the position, the
 * lumens, the optic, the aim and the wall direction of each source; that is
 * what is written down here, and nothing else is.
 *
 * ROUNDED, AND THE ROUNDING IS THE POINT. Positions to the tenth of a
 * millimetre and lumens to a hundredth: past that a change cannot move a
 * heatmap and the only thing extra precision buys is a cache miss on a fitting
 * that a projection re-derived to the last float bit. Coarser than this would
 * start hiding real edits.
 */
export function sourcesSignature(sources) {
  let s = '';
  const p = (q) => (q ? `${q.x.toFixed(4)},${q.y.toFixed(4)},${(q.z ?? 0).toFixed(4)}` : '');
  for (const q of sources) {
    const g = q.geom;
    s += `${q.profileId}|${q.lm.toFixed(2)}|${q.beamDeg ?? ''}|${g.kind}|`;
    if (g.kind === 'point') s += p(g.p);
    else if (g.kind === 'line') s += `${p(g.a)}>${p(g.b)}`;
    else if (g.kind === 'ring') s += `${p(g.c)}r${g.r.toFixed(4)}n${g.n}`;
    else if (g.kind === 'area') s += `${p(g.c)}u${p(g.u)}v${p(g.v)}`;
    if (q.aim) s += `@${p(q.aim)}`;
    if (q.inward) s += `^${q.inward.x.toFixed(4)},${q.inward.y.toFixed(4)}`;
    s += ';';
  }
  return s;
}

/**
 * ONE ROOM, ONE LAYER, AGAINST WHATEVER THE CACHE ALREADY HOLDS.
 *
 * `entry` IS THE CACHE RECORD AND THIS MUTATES IT — that is the function's
 * whole job, and it is exported so the caching can be exercised without a
 * browser: a server render mounts a fresh hook every time, so the one thing a
 * rendered test can never reach is what happens on the SECOND pass. Calling
 * this twice on one entry is exactly that, and tools/test-heatmap-indirect.mjs
 * does.
 *
 * THE THREE LEVELS, AND WHAT INVALIDATES EACH:
 *
 *   `surface`  the light transport — the exitance vector. Rebuilt when the
 *              EMITTERS change, and also when the horizontal layer needs the
 *              direct field and the cached pass was run without it.
 *
 *   `sphere`   the probe transfer at one height. Rebuilt when the HEIGHT
 *              changes; untouched by the emitters, because it is geometry.
 *
 *   `layers`   the gathered field, one per layer. Rebuilt when its own key
 *              changes, which is the emitters and — for the reflected layer —
 *              the height.
 *
 * AND THE GATHERED FIELDS SURVIVE A CELLS-ONLY REBUILD, which is not a
 * micro-optimisation but a statement about the model: the exitance does not
 * depend on whether the direct pass visited the grid, so re-running
 * `surfacePass` to ADD the cells produces a bit-identical vector and every
 * field already gathered from it is still correct. Only a change of EMITTERS
 * makes them stale, and that is the one case that clears them.
 */
export function solveRoomLayer(entry, { sources, layerId, probeHeightM }) {
  const layer = heatmapLayerFor(layerId);
  /* --- THE COMPOSITE LAYER IS COMPOSED, AND NOT RE-SOLVED ------------------
     `average` IS ITS TWO COMPONENTS ADDED, so it asks for them by name rather
     than reaching into the engine again — which means computing it fills BOTH
     of their cache slots on the way past, and the reader who switches to
     either one next pays nothing. The sub-calls settle the surface pass
     between them (the horizontal one needs the cells, the reflected one does
     not and will take a pass that has them), so this function does no cache
     work of its own beyond its own slot. */
  if (layer.id === 'average') {
    const floor = solveRoomLayer(entry, { sources, layerId: 'illuminance', probeHeightM });
    const probe = solveRoomLayer(entry, { sources, layerId: 'reflected', probeHeightM });
    /* KEYED AFTER THE SUB-CALLS, not before: one of them may have found the
       emitters changed and cleared `entry.layers`, and a key read before that
       would match a slot that had just been thrown away. */
    const key = `${entry.surface.key}|z${probe.probeZ.toFixed(4)}`;
    const held = entry.layers[layer.id];
    if (held && held.key === key) {
      return { solved: held.result, values: held.values,
               probeZ: probe.probeZ, cached: true };
    }
    const avg = solveAverage(entry.geometry.field,
                             { sphere: probe.values, total: floor.values });
    /* THE ACCOUNTING COMES OFF THE COMPONENTS, because it is about the room
       and the fittings rather than about how the two were combined — the same
       emitted lumens and the same bounces either way. */
    const solved = { ...avg, sphere: avg.value, probeZ: probe.probeZ,
                     emitted: floor.solved.emitted, bounces: floor.solved.bounces };
    entry.layers[layer.id] = { key, result: solved, values: avg.value };
    return { solved, values: avg.value, probeZ: probe.probeZ, cached: false };
  }

  const geometry = entry.geometry;
  const srcSig = sourcesSignature(sources);
  /* `cells` IS WHAT A FLOOR LAYER NEEDS AND A PROBE-ONLY ONE MUST NOT PAY FOR
     — the direct illuminance at every grid cell, nine sub-samples apiece. A
     cached pass that HAS the cells serves a layer that does not need them; one
     that does not cannot serve one that does. `layer.floor` is the table's own
     answer; see HEATMAP_LAYERS. */
  const wantCells = !!layer.floor;
  const emittersChanged = !entry.surface || entry.surface.key !== srcSig;
  if (emittersChanged || (wantCells && !entry.surface.cells)) {
    entry.surface = { key: srcSig, cells: wantCells,
                      result: surfacePass(geometry, sources, { cells: wantCells }) };
    if (emittersChanged) entry.layers = {};
  }
  const surface = entry.surface.result;

  /* THE PROBE HEIGHT IS CLAMPED INTO THIS ROOM'S OWN VOLUME, because a plan
     holds a 2.7 m living space and a 1.1 m loft and the two cannot share an
     answer. See `probeHeightFor`, which owns the rule, and the legend, which
     prints what the room actually got rather than what was asked for. */
  const probeZ = layer.probe ? probeHeightFor(probeHeightM, geometry.heightM) : null;
  const layerKey = layer.probe ? `${srcSig}|z${probeZ.toFixed(4)}` : srcSig;
  const held = entry.layers[layer.id];
  if (held && held.key === layerKey) {
    return { solved: held.result, values: held.values, probeZ, cached: true };
  }

  let solved, values;
  if (layer.probe) {
    /* THE PROBE TRANSFER IS KEPT AGAINST ITS HEIGHT, so moving the height and
       moving it back is two matrices and not four, and so that switching
       layers at a settled height costs nothing at all. */
    if (!entry.sphere || entry.sphere.z !== probeZ) {
      entry.sphere = { z: probeZ,
        S: buildSphereTransfer(geometry.patches, geometry.field, geometry.poly,
                               { convex: geometry.convex, probeZ }) };
    }
    solved = solveIndirect(geometry, surface, { probeZ, S: entry.sphere.S });
    values = solved.sphere;
  } else {
    solved = solveRoom(geometry, sources, surface);
    values = solved.total;
  }
  entry.layers[layer.id] = { key: layerKey, result: solved, values };
  return { solved, values, probeZ, cached: false };
}

export default function useHeatmap({
  on = false,
  rooms = [],
  pxPerFt = 0,
  projectId = null,
  roomTypes = {},
  materials = {},
  ceilingMmFor,
  spaceAnalysis,
  focusId = null,
  /* --- EVERY LIST HERE IS A PROJECTION AND IS IN PLAN PIXELS --------------
     THE `Px` SUFFIX IS THE CONTRACT AND IT IS NOT DECORATION. Each of these is
     the list the CANVAS draws, resolved out of a store that is held in FEET —
     `manualCobsPx` carries `x`/`y` where `manualCobs` carries `xFt`/`yFt`, and
     handing the store instead put every hand-placed lamp at NaN and lit
     nothing. Named with the suffix so the mistake is visible at the call site;
     refused by the adapter so it cannot be silent again. */
  accentZonesPx = [],
  taskSpotsPx = [],
  manualCobsPx = [],
  arrayCobsPx = [],
  magTracksPx = [],
  trackModulesPx = [],
}) {
  /* WHICH LAYER, AND WHAT HEIGHT ITS PROBES SIT AT. Its own module — see
     useHeatmapLayer.js — and composed here rather than called by App so that
     the choice and the field it produced are one object. */
  const view = useHeatmapLayer();
  const { layerId, probeHeightM } = view;

  /* --- WHAT THE SOLVE DEPENDS ON, AS ONE OBJECT ---------------------------
     THE IDENTITY OF THIS IS THE "SOMETHING CHANGED" SIGNAL, which is why it is
     a memo over the whole input list rather than a list of dependencies on the
     solve below. React already recomputes it exactly when one of them changes,
     and the settle timer downstream needs a single thing to watch.
     THE LAYER AND THE HEIGHT ARE NOT IN IT, and that is deliberate: picking a
     layer or a height is not a moving hand, so it must not drop the drawing to
     the coarse pass and make the reader wait for it to sharpen again. The two
     caches below are what make that safe. */
  const inputs = useMemo(() => ({
    rooms, pxPerFt, projectId, roomTypes, materials, ceilingMmFor, spaceAnalysis,
    accentZonesPx, taskSpotsPx, manualCobsPx, arrayCobsPx, magTracksPx, trackModulesPx,
  }), [rooms, pxPerFt, projectId, roomTypes, materials, ceilingMmFor, spaceAnalysis,
       accentZonesPx, taskSpotsPx, manualCobsPx, arrayCobsPx, magTracksPx, trackModulesPx]);

  /* --- COARSE WHILE ANYTHING IS MOVING ------------------------------------
     `settled` GOES FALSE ON EVERY CHANGE AND TRUE ONCE, LATE. During a drag the
     inputs are rebuilt every frame, so the timer never reaches its end and the
     mode stays coarse; the frame after the hand stops, it fires and the full
     pass runs. React bails out of a re-render when the state is already false,
     so resetting it forty times a second costs nothing. */
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!on) return undefined;
    setSettled(false);
    const t = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, [inputs, on]);
  const mode = settled ? 'fine' : 'coarse';

  /* THE CACHE. A ref rather than state: writing to it must not cause a render,
     because it is written DURING one — the memo below fills it as it goes.
     Keyed by room and mode, so a drag's coarse geometry and the fine one that
     follows it both survive and neither rebuilds the other.

     THREE LEVELS IN ONE ENTRY, NESTED BY WHAT INVALIDATES THEM:
       `geometry`  the patches and the two matrices     — the room's outline,
                                                          height and finishes
       `surface`   the exitance, i.e. the light transport — ...and the emitters
       `sphere`    the probe transfer at one height      — ...and the height
       `layers`    the gathered field, per layer         — ...and nothing else
     An entry is discarded whole when the geometry signature changes, which is
     correct: everything under it was computed on that geometry. */
  const cache = useRef(new Map());

  /* THE PALETTE, READ OFF THE DOCUMENT ONCE THE LAYER IS UP. It is a computed
     style read, so it is not free, and it cannot be read at module load: the
     stylesheet may not have arrived. Re-read whenever the layer is switched on,
     which is also what picks up an edit to the tokens during development. */
  const [palette, setPalette] = useState(null);
  useEffect(() => {
    if (!on) return;
    setPalette(readHeatmapPalette());
  }, [on]);

  const field = useMemo(() => {
    // RULE 1: the switch, before anything is read.
    if (!on) return EMPTY;
    const { pxPerFt: ppf } = inputs;
    if (!(ppf > 0) || !inputs.rooms.length) return { ...EMPTY, on: true, mode };
    const metresPerPx = M_PER_FT / ppf;
    /* WHETHER THIS LAYER IS READ AT A PROBE IN THE ROOM'S VOLUME, which is
       what decides whether there is a height to report and a plane to name.
       Off the layer table rather than off the id — see HEATMAP_LAYERS. */
    const indirect = !!heatmapLayerFor(layerId).probe;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;

    const out = [];
    const targets = [];
    const heights = [];
    for (const room of inputs.rooms) {
      if (!room.plan?.ok) continue;
      const polygonM = polygonInMetres(room, metresPerPx);
      if (polygonM.length < 3) continue;
      const ceilingMm = inputs.ceilingMmFor ? inputs.ceilingMmFor(room.id) : 0;
      const mats = materialsOf(inputs.materials, room.id);
      const heightM = (Number(ceilingMm) || 0) / 1000;
      if (!(heightM > 0)) continue;

      // RULE 2: the cache, on the signature of what the geometry is made of.
      const sig = geometrySignature(room, ceilingMm, mats, metresPerPx, mode);
      const key = `${room.id}|${mode}`;
      let hit = cache.current.get(key);
      if (!hit || hit.sig !== sig) {
        const geometry = buildRoomGeometry({ polygonM, heightM, materials: mats, mode });
        if (!geometry) { cache.current.delete(key); continue; }
        hit = { sig, geometry, surface: null, sphere: null, layers: {} };
        cache.current.set(key, hit);
      }
      const geometry = hit.geometry;

      /* THE LUMENS COME THROUGH THE EXISTING MODEL. `spaceAnalysis` is the
         Analysis panel's own call — see features/lighting-planner — so the
         heatmap is lit by the figures the panel is printing beside it, at the
         wattages somebody actually chose. See the header of emitters.js for why
         this and not the BOQ catalogue. */
      const analysis = inputs.spaceAnalysis ? inputs.spaceAnalysis(room) : null;
      const sources = buildRoomEmitters({
        room, analysis, metresPerPx, ceilingMm,
        accentZones: inputs.accentZonesPx, taskSpots: inputs.taskSpotsPx,
        manualCobs: inputs.manualCobsPx, arrayCobs: inputs.arrayCobsPx,
        magTracks: inputs.magTracksPx, trackModules: inputs.trackModulesPx,
      });

      /* --- RULE 3: THE LIGHT TRANSPORT, AND WHERE IT IS READ --------------
         ALL OF IT IS `solveRoomLayer`, which is where the three-level cache
         lives and is a pure function of the entry it is handed. `values` is
         `total` on the horizontal layer — direct and reflected together — and
         the probe field on the reflected one, which carries no direct term at
         all. Both are lux, and the layer says which lux. */
      const { solved, values, probeZ } =
        solveRoomLayer(hit, { sources, layerId, probeHeightM });

      const targetLux = heatmapTargetForLayer(
        layerId, inputs.projectId, inputs.roomTypes?.[room.id]?.type);
      targets.push({ roomId: room.id, lux: targetLux });

      /* --- THE FIELD AS A RECTANGLE OF RATIOS -----------------------------
         THE FULL nx BY ny BOX AND NOT THE COMPACT LIST, because the overlay
         paints a rectangle of pixels and needs a value at every one of them.
         `NaN` OUTSIDE THE OUTLINE, and it is NaN rather than 0 on purpose: zero
         is a legitimate reading — a corner no fitting reaches — and the two must
         not be the same colour. The overlay treats NaN as "nothing here" and
         lets the clip decide the edge. */
      const { field: grid } = geometry;
      const ratio = new Float32Array(grid.nx * grid.ny).fill(NaN);
      const lux = new Float32Array(grid.nx * grid.ny).fill(NaN);
      for (let g = 0; g < grid.count; g++) {
        const at = grid.at[g];
        lux[at] = values[g];
        ratio[at] = targetLux > 0 ? values[g] / targetLux : 0;
      }

      if (indirect) heights.push(probeZ);
      out.push({
        id: room.id,
        name: room.outline?.name || 'Space',
        nx: grid.nx, ny: grid.ny, inside: grid.inside,
        ratio, lux,
        stepM: grid.step,
        /* BACK IN PLAN PIXELS, which is the space the drawing is in. The overlay
           is a child of the same <svg> the fittings are, so an image placed on
           this box is aligned at every zoom by construction — the zoom is a
           scale on the whole element against a fixed viewBox, not a transform
           this layer has to reproduce. */
        boxPx: {
          x0: grid.x0 / metresPerPx, y0: grid.y0 / metresPerPx,
          x1: grid.x1 / metresPerPx, y1: grid.y1 / metresPerPx,
        },
        polygonPx: room.geo.polygonPx,
        targetLux,
        layer: layerId,
        meanLux: solved.mean, minLux: solved.min, maxLux: solved.max,
        emittedLumens: solved.emitted,
        bounces: solved.bounces,
        sources: sources.length,
        /* WHAT THE PROBES ACTUALLY GOT, per room. `null` on the horizontal
           layer, which has a plane rather than a probe height. */
        probeHeightM: probeZ,
        probeClamped: indirect && probeWasClamped(probeHeightM, probeZ),
        roomHeightM: heightM,
      });
    }

    /* --- AND THE CACHE IS SWEPT OF ROOMS THAT NO LONGER EXIST --------------
       A ROOM IS DELETED OR RE-TRACED EVERY TIME SOMEBODY EDITS AN OUTLINE, and
       an entry keyed to one that is gone is a transfer matrix nothing will read
       again — a megabyte of it on a large room, on a plan that gets re-traced a
       dozen times in a session. Signature changes replace an entry in place, so
       this only has to catch the ids that vanished.
       BY ROOM AND NOT BY KEY, so a live room keeps BOTH its modes: the coarse
       geometry a drag is using and the fine one that follows it. */
    for (const key of [...cache.current.keys()]) {
      const roomId = key.slice(0, key.lastIndexOf('|'));
      if (!inputs.rooms.some((r) => r.id === roomId)) cache.current.delete(key);
    }

    const distinct = [...new Set(targets.map((t) => t.lux))].sort((a, b) => a - b);
    const focus = targets.find((t) => t.roomId === focusId) ?? null;
    const focusRoom = out.find((r) => r.id === focusId) ?? null;
    const heightSet = [...new Set(heights)];
    return {
      on: true, mode, rooms: out, palette,
      /* THE MEASUREMENT GEOMETRY, WHICH IS WHAT THE CARD'S SECOND LINE IS MADE
         OF. A fixed plane on the horizontal layer; on the reflected one, the
         height the drawing is actually showing — the open space's own, where a
         space is open, and otherwise the one figure every room shares. Null
         where they differ and nobody has chosen, which the legend answers by
         printing the height that was ASKED for. Same shape, and the same
         argument, as `focusTarget` below. */
      plane: indirect ? null : HEATMAP_PLANE,
      probeHeightM: focusRoom?.probeHeightM
        ?? (heightSet.length === 1 ? heightSet[0] : null),
      probeClamped: focusRoom
        ? !!focusRoom.probeClamped
        : out.some((r) => r.probeClamped),
      targets, distinct,
      /* WHICH TARGET THE LEGEND PRINTS. The space that is open, where one is;
         otherwise the single figure every space on the plan shares, where they
         do share one. Null means they differ and nobody has chosen — the legend
         prints the range, because a key claiming one target over a plan with
         three would be the wrong kind of confident. */
      focusTarget: focus?.lux ?? (distinct.length === 1 ? distinct[0] : null),
      ms: typeof performance !== 'undefined' ? performance.now() - t0 : 0,
    };
  }, [on, inputs, mode, palette, focusId, layerId, probeHeightM]);

  /* THE FIELD AND THE CHOICE, AS ONE OBJECT — and it is a memo so that the
     switched-off case still hands every consumer the same thing on every
     render. `view` has a stable identity between changes and so does `field`,
     so this changes when one of them does and at no other time. */
  return useMemo(() => ({ ...field, ...view }), [field, view]);
}
