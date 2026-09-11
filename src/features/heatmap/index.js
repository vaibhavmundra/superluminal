// ---------------------------------------------------------------------------
// The heatmap feature's whole surface. FOUR NAMES, and that is the point:
// App wires and composes, and everything else — the model, the profiles, the
// grid, the colours, the caching — is behind this file.
//
//   useHeatmap        computes the field, or nothing at all when the layer is
//                     off. Every input is a list App already holds.
//   HeatmapOverlay    draws it, inside the drawing's own <svg>, taking no
//                     pointer.
//   HeatmapLegend     the key: the measurement's name, and the five bands.
//   HeatmapSwitch     the capsule in the bar at the foot of the drawing.
//
// The constants a reader is likely to want next are re-exported too — the
// target table and the band table — because "what is this room aiming at" is
// a question asked from outside the feature.
//
// AND THE FOUR NAMES STILL ANSWER FOR ONE HEATMAP BUILT OUT OF THREE LAYERS.
// `Estimated light level` is the reflected ambient at 1.2 m plus a quarter of
// the horizontal illuminance at the floor; the other two layers are its
// components and are never shown on their own. The switch in the bar is the
// whole of the on/off, and there is nothing else to choose — App wires the
// same four elements it always did, which is the test of whether any of this
// was added inside the feature or through it.
// ---------------------------------------------------------------------------
export { default as useHeatmap } from './useHeatmap.js';
export { default as HeatmapOverlay } from './HeatmapOverlay.jsx';
export { default as HeatmapLegend } from './HeatmapLegend.jsx';
export { default as HeatmapSwitch } from './HeatmapSwitch.jsx';
export { HEATMAP_BANDS, HEATMAP_TARGET_LUX, HEATMAP_TARGET_LUX_BY_ROOM,
         HEATMAP_PLANE, heatmapTargetFor, heatmapBandFor,
         /* THE SECOND LAYER'S OWN TABLE, exported for the same reason the
            first one's is: "what is this room aiming at" is a question asked
            from outside the feature, and the reflected-ambient figures are a
            different answer to it against a different measurement. */
         HEATMAP_LAYERS, HEATMAP_LAYERS_OFFERED, HEATMAP_LAYER_DEFAULT,
         heatmapLayerFor,
         REFLECTED_AMBIENT_LM_PER_SQFT, REFLECTED_AMBIENT_TARGET_LUX,
         REFLECTED_AMBIENT_TARGET_LUX_DEFAULT, LUX_PER_LM_PER_SQFT,
         AVERAGE_FLOOR_SHARE,
         reflectedAmbientTargetFor, heatmapTargetForLayer } from './heatmapTargets.js';
export { PROBE_HEIGHT_MM, probeHeightFor } from './indirect.js';
