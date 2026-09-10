import { useCallback, useMemo, useState } from 'react';
import { HEATMAP_LAYERS, HEATMAP_LAYER_DEFAULT,
         heatmapLayerFor } from './heatmapTargets.js';
import { PROBE_HEIGHT_MM, PROBE_HEIGHTS_MM } from './indirect.js';

// ---------------------------------------------------------------------------
// useHeatmapLayer — WHICH QUESTION THE HEATMAP IS ANSWERING, AND FROM WHERE.
//
// TWO PIECES OF STATE AND NOTHING ELSE: the layer, and the height its probes
// sit at. It is a file of its own because the brief's own division is worth
// keeping visible in the directory listing — the TARGETS are a table, the
// EVALUATION is a solver, the STATE is this, and the UI is the legend. Any one
// of them can be read without the other three.
//
// IT IS COMPOSED INSIDE `useHeatmap` RATHER THAN CALLED BY App. The hook
// already hands the legend everything the legend draws, so putting the choice
// on the same object is what keeps App's wiring at exactly the one call it
// already had — and, more usefully, it makes it impossible for the selector to
// say one thing while the field on the drawing is another: the layer that
// produced the field and the layer the card names are one value.
//
// NOT PERSISTED, AND THAT IS A CHOICE. `useViewPrefs` remembers what the
// drawing SHOWS across sessions; a layer within a layer is a question you are
// asking right now, and a plan that reopened on reflected ambient with the
// heatmap switch off would be answering a question nobody had asked yet. The
// day it should stick, this is the one file that changes.
// ---------------------------------------------------------------------------

export default function useHeatmapLayer() {
  const [layerId, setLayerId] = useState(HEATMAP_LAYER_DEFAULT);
  /* IN MILLIMETRES, WHICH IS HOW EVERY OTHER HEIGHT IN THIS APP IS HELD —
     `ceilingMm`, `SCONCE_MM`, `PROBE_HEIGHT_MM`. The solver wants metres and
     converts once, at the boundary, exactly as the rest of the feature does. */
  const [probeHeightMm, setHeightMm] = useState(PROBE_HEIGHT_MM);

  /* A LAYER THIS BUILD DOES NOT HAVE FALLS BACK RATHER THAN BLANKING THE
     DRAWING — `heatmapLayerFor`'s rule, applied at the setter as well as at the
     read, so the state can never hold an id the table has never heard of. */
  const setLayer = useCallback((id) => {
    setLayerId(heatmapLayerFor(id).id);
  }, []);
  const setProbeHeightMm = useCallback((mm) => {
    const n = Number(mm);
    if (Number.isFinite(n) && n >= 0) setHeightMm(n);
  }, []);

  return useMemo(() => ({
    layerId,
    layer: heatmapLayerFor(layerId),
    layers: HEATMAP_LAYERS,
    setLayer,
    /* THE HEIGHT IS OFFERED IN BOTH UNITS because both callers are honest: the
       legend prints metres and the solver works in them, and the state and the
       chips are in millimetres like every other height in the app. One
       conversion, in one place, rather than at each of the three. */
    probeHeightMm,
    probeHeightM: probeHeightMm / 1000,
    probeHeights: PROBE_HEIGHTS_MM,
    setProbeHeightMm,
  }), [layerId, probeHeightMm, setLayer, setProbeHeightMm]);
}
