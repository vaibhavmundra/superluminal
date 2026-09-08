# Plan recognition

`usePlanRecognition` owns source-recognition sessions. `App` composes it with
`usePlanSource`, `useScale`, and `useOutlines`; those hooks and `usePlanDoc` are
unchanged. All persistent writes still go through the supplied `docActions`.

## Public interface

Inputs: `doc`, `docActions`, `source`, `img`, `isVector`, `pxPerFt`,
`wallLayerSet`, `restoredPlan`, `readOnly`, and `useBoundingRect`.

| Group | Members |
| --- | --- |
| `rooms` | `state` (the document's existing room status) |
| `doors` | `state` (session status) |
| `furniture` | `state`, `provider`, `bedSets`, `bedLook` |
| `status` | `running` (derived from the three detector statuses) |
| `commands` | `rerunRooms`, `rerunDoors`, `rerunFurniture`, `setProvider`, `refindBeds`, `absorbBedRows`, `lookAgainAtBeds`, `computeBedFit` |
| `reset` | `rooms`, `doors`, `furniture`, `restoreDoorStatus`, `restoreFurnitureStatus` |

`lookAgainAtBeds({ rooms, focus })` receives the current layout and focus from
App. `refindBeds(room, { reuseShot, signal })`, `computeBedFit(outline, a, b,
{ signal })`, and `absorbBedRows(rows, existing)` retain their previous call
contracts. The lighting workflow still chooses when to invoke them.

The reset methods preserve the previous reset scope and action order. Loading
a new file does not reset rerun nonces, `bedSets`, or the admin result line.
The restore-status adapters support both saved-plan restoration and undo/redo.
App uses a callback ref to connect source loading to the recognition reset;
this resolves the source/reset dependency cycle without duplicating state.

## Preserved behavior

- Independent room, door, then furniture effect registration and unchanged
  dependency arrays. Changing the scale does not launch another bed request.
- Rooms run before raster scale is known. DXF rooms use the source scale.
  Door recognition requires a raster image and project type; DXF skips it.
  PDFs continue through the existing raster source path.
- Read-only upload effects never run. Restored plans skip initial recognition;
  explicit nonzero rerun nonces retain their previous behavior.
- Existing AbortControllers and alive checks protect against stale upload
  responses, including cancellation while a bed snapshot is still rendering.
- Hand-traced and reviewed room outlines survive, merging against the latest
  reducer state. Overlap thresholds, names, IDs, coordinate conversions,
  enclosed polygons, returned/proposed counts, and metadata are unchanged.
- The live whole-sheet bed-filter path, inactive legacy provider path, provider
  preference storage, crop fallback, bed judging, result ordering, physical size
  gates, containment, deduplication, and verdict record formats are unchanged.
- No saved schema, timing constants, UI, copy, CSS, or network formats changed.

Private modules separate room, door, whole-sheet furniture, and per-room bed
controllers. `roomProposals.js` and `bedResults.js` hold extracted calculations.
The shared bounded worker pool moved verbatim to `src/lib/mapLimit.js`.

## Migration verification

Baseline: clean working tree at `a28a602`; App.jsx had **14,843 lines**.
After extraction: **14,099 lines**, a reduction of **744**.

- Ten focused existing scripts passed before and after: furniture, detect-api,
  detect-flow, openai-detect, rooms-detect, doors, beds, bedfit, plan-state,
  and plan-projection.
- New `test-recognition.mjs` covers room merges, bed results, and bounded
  concurrency. `test-recognition-lifecycle.mjs` covers actual effect bodies
  with mocked services, dependency arrays, gates, payloads, cancellation,
  stale results, errors, provider persistence, and the public reset contract.
  The latter uses Node's built-in VM modules flag; no framework was installed.
  These checks do not exercise browser rasterization or live model services.
- Lint: no errors; 71 baseline warnings, 68 afterward. Affected files retain
  14 existing warnings, including the moved inactive-pass suppression.
- Production build passes before and after, with the existing large-chunk warning.
- `npm test` stops at the pre-existing missing `toDXF` export in
  `test-vector-flow.mjs`, both before and after.
- Running all scripts independently: baseline **48/55** pass; afterward
  **50/57** pass, including both new scripts. An isolated archive of the
  original revision reproduces the same seven failing scripts:

| Pre-existing failing script | Failure |
| --- | --- |
| `test-vector-flow.mjs` | Missing `toDXF` export |
| `test-cad-export.mjs` | Raster export refusal expectation (1) |
| `test-roomtypes.mjs` | Target area and toilet layout expectations (7) |
| `test-ceiling.mjs` | Axis target count expectation (1) |
| `test-cove.mjs` | Commercial/institutional lumen expectations (2) |
| `test-track.mjs` | Track geometry, fitting count and load expectations (8) |
| `test-flows.mjs` | Row grouping expectations (2) |

Remaining in App: shared wall-layer derivation; detected-bed/zone projections
and room attribution used by layout; lighting-pipeline sequencing and legacy
contest coordination; manual door/zone editing and confirmation; recognition
UI bindings; and source-load/restore reset coordination. No source-detection
effect or recognition request payload remains there.
