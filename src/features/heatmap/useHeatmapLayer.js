import { useCallback, useMemo, useState } from 'react';
import { HEATMAP_LAYERS_OFFERED, HEATMAP_LAYER_DEFAULT,
         heatmapLayerFor } from './heatmapTargets.js';

// ---------------------------------------------------------------------------
// useHeatmapLayer — WHICH QUESTION THE HEATMAP IS ANSWERING.
//
// ONE PIECE OF STATE, and a file of its own because the feature's own division
// is worth keeping visible in the directory listing: the TARGETS are a table,
// the EVALUATION is a solver, the STATE is this, and the UI is the legend. Any
// one of them can be read without the other three.
//
// IT IS COMPOSED INSIDE `useHeatmap` RATHER THAN CALLED BY App. The hook
// already hands the legend everything the legend draws, so putting the choice
// on the same object keeps App's wiring at exactly the one call it already had
// — and, more usefully, it makes it impossible for the selector to say one
// thing while the field on the drawing is another: the layer that produced the
// field and the layer the card names are one value.
//
// THE HEIGHT IS NOT HERE, AND IT WAS ONCE. This hook used to hold the probe
// height too, for a three-chip control in the card. That control is not back:
// what was asked for is the FLOOR reading beside the blend, which is a choice
// of measurement and not a choice of where to stand. `PROBE_HEIGHT_MM` is a
// constant again — see indirect.js — and the solver still takes any height, so
// the day the height is worth choosing this is the file it comes back to.
//
// NOT PERSISTED, AND THAT IS A CHOICE. `useViewPrefs` remembers what the
// drawing SHOWS across sessions; which of two readings you are taking is a
// question you are asking right now, and a plan that reopened on the floor
// layer with the heatmap switch off would be answering a question nobody had
// asked yet. The day it should stick, this is the one file that changes.
// ---------------------------------------------------------------------------

export default function useHeatmapLayer() {
  const [layerId, setLayerId] = useState(HEATMAP_LAYER_DEFAULT);

  /* A LAYER THIS BUILD DOES NOT HAVE FALLS BACK RATHER THAN BLANKING THE
     DRAWING — `heatmapLayerFor`'s rule, applied at the SETTER as well as at the
     read, so the state can never hold an id the table has never heard of. */
  const setLayer = useCallback((id) => {
    setLayerId(heatmapLayerFor(id).id);
  }, []);

  return useMemo(() => ({
    layerId,
    layer: heatmapLayerFor(layerId),
    /* WHAT THE CARD DRAWS CHIPS FOR, and it is the OFFERED list rather than
       every layer the engine can solve: `reflected` is a component of the blend
       and not a question anybody is asking. See `pick` in heatmapTargets.js,
       which is the one place that decides. */
    layers: HEATMAP_LAYERS_OFFERED,
    setLayer,
  }), [layerId, setLayer]);
}
