import { useEffect, useMemo, useRef, useState } from 'react';
import { materialsOf, toneOf } from '../../lib/materials.js';
import { M_PER_FT } from './grid.js';
import { buildRoomGeometry, solveRoom } from './solve.js';
import { buildRoomEmitters, polygonInMetres } from './emitters.js';
import { heatmapTargetFor, HEATMAP_PLANE } from './heatmapTargets.js';
import { readHeatmapPalette } from './colours.js';

// ---------------------------------------------------------------------------
// useHeatmap — WHEN THE SOLVER RUNS, AND WHAT IT IS ALLOWED TO COST.
//
// EVERY DECISION IN THIS FILE IS ABOUT NOT DOING WORK. The physics is in
// solve.js and the adaptation is in emitters.js; what is here is three rules:
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
//   3. A MOVING HAND GETS THE COARSE ANSWER. While anything is changing the
//      solve runs at half the resolution — a quarter of the cells, a third of
//      the patches — and the full one lands a moment after the hand stops. That
//      is done WITHOUT a drag signal threaded down from App, and deliberately:
//      the inputs change identity on every frame of a drag, which is the signal.
//      One timer, reset by every change, and the fine pass is what happens when
//      it finally gets to fire.
//
// WHAT COMES BACK IS READY TO PAINT. One entry per room holding the ratio field
// over its own grid, the box it covers in PLAN PIXELS, and the target it was
// judged against — see HeatmapOverlay, which draws it and computes nothing.
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
  targets: [], focusTarget: null, mode: null, ms: 0,
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
  /* --- WHAT THE SOLVE DEPENDS ON, AS ONE OBJECT ---------------------------
     THE IDENTITY OF THIS IS THE "SOMETHING CHANGED" SIGNAL, which is why it is
     a memo over the whole input list rather than a list of dependencies on the
     solve below. React already recomputes it exactly when one of them changes,
     and the settle timer downstream needs a single thing to watch. */
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

  /* THE GEOMETRY CACHE. A ref rather than state: writing to it must not cause a
     render, because it is written DURING one — the memo below fills it as it
     goes. Keyed by room and mode, so a drag's coarse geometry and the fine one
     that follows it both survive and neither rebuilds the other. */
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

  return useMemo(() => {
    // RULE 1: the switch, before anything is read.
    if (!on) return EMPTY;
    const { pxPerFt: ppf } = inputs;
    if (!(ppf > 0) || !inputs.rooms.length) return { ...EMPTY, on: true, mode };
    const metresPerPx = M_PER_FT / ppf;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;

    const out = [];
    const targets = [];
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
        hit = { sig, geometry };
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

      const solved = solveRoom(geometry, sources);
      const targetLux = heatmapTargetFor(
        inputs.projectId, inputs.roomTypes?.[room.id]?.type);
      targets.push({ roomId: room.id, lux: targetLux });

      /* --- THE FIELD AS A RECTANGLE OF RATIOS -----------------------------
         THE FULL nx BY ny BOX AND NOT THE COMPACT LIST, because the overlay
         paints a rectangle of pixels and needs a value at every one of them.
         `NaN` OUTSIDE THE OUTLINE, and it is NaN rather than 0 on purpose: zero
         is a legitimate reading — a corner no fitting reaches — and the two must
         not be the same colour. The overlay treats NaN as "nothing here" and
         lets the clip decide the edge. */
      const { field } = geometry;
      const ratio = new Float32Array(field.nx * field.ny).fill(NaN);
      const lux = new Float32Array(field.nx * field.ny).fill(NaN);
      for (let g = 0; g < field.count; g++) {
        const at = field.at[g];
        lux[at] = solved.total[g];
        ratio[at] = targetLux > 0 ? solved.total[g] / targetLux : 0;
      }

      out.push({
        id: room.id,
        name: room.outline?.name || 'Space',
        nx: field.nx, ny: field.ny, inside: field.inside,
        ratio, lux,
        stepM: field.step,
        /* BACK IN PLAN PIXELS, which is the space the drawing is in. The overlay
           is a child of the same <svg> the fittings are, so an image placed on
           this box is aligned at every zoom by construction — the zoom is a
           scale on the whole element against a fixed viewBox, not a transform
           this layer has to reproduce. */
        boxPx: {
          x0: field.x0 / metresPerPx, y0: field.y0 / metresPerPx,
          x1: field.x1 / metresPerPx, y1: field.y1 / metresPerPx,
        },
        polygonPx: room.geo.polygonPx,
        targetLux,
        meanLux: solved.mean, minLux: solved.min, maxLux: solved.max,
        emittedLumens: solved.emitted,
        bounces: solved.bounces,
        sources: sources.length,
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
    return {
      on: true, mode, rooms: out, palette, plane: HEATMAP_PLANE,
      targets, distinct,
      /* WHICH TARGET THE LEGEND PRINTS. The space that is open, where one is;
         otherwise the single figure every space on the plan shares, where they
         do share one. Null means they differ and nobody has chosen — the legend
         prints the range, because a key claiming one target over a plan with
         three would be the wrong kind of confident. */
      focusTarget: focus?.lux ?? (distinct.length === 1 ? distinct[0] : null),
      ms: typeof performance !== 'undefined' ? performance.now() - t0 : 0,
    };
  }, [on, inputs, mode, palette, focusId]);
}
