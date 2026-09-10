// ---------------------------------------------------------------------------
// The heatmap feature's whole surface. FOUR NAMES, and that is the point:
// App wires and composes, and everything else — the model, the profiles, the
// grid, the colours, the caching — is behind this file.
//
//   useHeatmap        computes the field, or nothing at all when the layer is
//                     off. Every input is a list App already holds.
//   HeatmapOverlay    draws it, inside the drawing's own <svg>, taking no
//                     pointer.
//   HeatmapLegend     the key: the bands, the plane and the active target.
//   HeatmapSwitch     the capsule in the bar at the foot of the drawing.
//
// The constants a reader is likely to want next are re-exported too — the
// target table and the band table — because "what is this room aiming at" is
// a question asked from outside the feature.
// ---------------------------------------------------------------------------
export { default as useHeatmap } from './useHeatmap.js';
export { default as HeatmapOverlay } from './HeatmapOverlay.jsx';
export { default as HeatmapLegend } from './HeatmapLegend.jsx';
export { default as HeatmapSwitch } from './HeatmapSwitch.jsx';
export { HEATMAP_BANDS, HEATMAP_TARGET_LUX, HEATMAP_TARGET_LUX_BY_ROOM,
         HEATMAP_PLANE, heatmapTargetFor, heatmapBandFor } from './heatmapTargets.js';
