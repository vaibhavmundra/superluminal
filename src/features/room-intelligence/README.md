# Room intelligence

Everything this app asks a model **about one room**, and everything a person
then does to that answer by hand. `App` composes it with `usePlanDoc`,
`usePlanScene` and the scene projections; none of those changed.

Four passes and one step, and they are one feature because they share a subject
and a picture. The subject is a single space with every other space on the sheet
erased; the picture is `roomSnapshot`'s crop of it, which the classifier, the
accent pass and the task-surface pass take turns at within one pipeline run
rather than rendering three times. The render pass is the odd one — it reads
photographs rather than the drawing — but it puts its answer back on the same
crop with a 1ft grid on it, and the wall step is what somebody does to the same
room by hand afterwards.

`usePlanDoc` remains the single persistent-document boundary. Its public state
is not split and no part of it is duplicated here: the answers (`roomTypes`,
`accentResults`, `surfaceResults`, `wallResults`), the decisions taken against
them (`accentDismissed`, `surfaceDismissed`, `artDismissed`, `runsOff`,
`runTrims`, `boardsOff`), the fittings placed by hand (`manualAccents`,
`manualSurfaces`, `manualCoves`) and the stored render pointers (`renderRefs`)
are all still the document's and are still written through the supplied
`docActions`. Model responses, user decisions and dismissal lists stay exactly
as separate as they were.

## Public interface

**Two call sites, and App's own ordering decides it.** The passes are needed by
the lighting pipeline, which is defined long before `svgPoint`, `pressState`,
the scene projections and `deleteShape` that the hand-editing gestures depend
on — and a hook's arguments are evaluated during render. The scene feature is
split across three calls for the same reason. Nothing is shared between the two
halves but the document.

### `useRoomIntelligence` — the passes and the wall step

Inputs: `source`, `img`, `wallLayerSet`, `pxPerFt`, `ceilingFt`, `projectId`,
`rooms`, `focus`, `materials`, `accentResults`, `doors`, `renderRefs`,
`renderStore`, `readOnly`, `onClaimPass`, `onReleasePass`, `docActions`.

| Group | Members |
| --- | --- |
| `canvas` | `wallEdit` (the step's polygon and per-edge tones), `wallEditId`, `onWallSegment` |
| `panel` | `accentRoom`, `accentRoomId`, `setAccentRoomId`, `accentShot`, `surfaceRoomId`, `setSurfaceRoomId`, `renders`, `wallShot`, `wallTranscripts`, `wallGrid`, `wallPick`, `setWallPick`, `wallEditRoom`, `materialsEdit`, `setMaterialsEdit` |
| `commands` | `computeRoomType`, `computeAccents`, `setAccentState`, `computeSurfaces`, `setSurfaceState`, `computeWallItems`, `runWallPass`, `addRenders`, `setSurfaceTone`, `setWallTone`, `pickWallSegment`, `openWallEdit`, `closeWallEdit` |
| `status` | `accent`, `surface`, `wall` (each carries its own `roomId`), `running` |
| `reset` | `accentRoom`, `accentProposals`, `renders`, `renderState`, `surfaces` |

### `useRoomEditing` — the hand-editing half

Inputs: `rooms`, `pxPerFt`, `zoom`, `svgPoint`, `svgRef`, `pressState`,
`accentZonesPx`, `taskSpotsPx`, `manualAccents`, `manualCoves`,
`manualSurfaces`, `addTool`, `zoneMode`, `setSel`, `setArmed`, `deleteShape`,
`docActions`.

| Group | Members |
| --- | --- |
| `canvas` | `accentDrag`, `onAccPointerDown`, `accPointerMove`, `accPointerUp`, `onSpotPointerDown` |
| `commands` | `updateAccentZone`, `deleteAccent`, `deleteSpot` |
| `reset` | `accentEditing` |

`computeRoomType(room, { reuseShot })`, `computeAccents(room, { reuseShot,
beds })`, `computeSurfaces(room, { reuseShot })` and `computeWallItems(room,
views, { onPhase, onCall })` retain their previous call contracts, including the
shared crop the pipeline threads between the first three. The lighting pipeline
still chooses when to invoke them.

`reset` is five members and not one because `resetForNewPlan` did not run those
statements together — they were interleaved with the recognition resets, the
switchboard stores and the hand-placed coves. App calls each where the
statements it replaces stood, so the reducer sees the same dispatches in the same
order. Both reset groups are merged into one callback ref, which is the pattern
the recognition feature already uses to resolve the source/reset cycle.
`wallEdit`, `wallPick` and `materialsEdit` are still not reset by a file load;
the wall step still closes itself when its room goes.

## What stayed in App, and why

- **The lighting pipeline** (`runPipeline`, `PREP_STEPS`, `stopPipeline`,
  `prep`, `cancelPrep`). It sequences recognition, geometry, classification,
  beds, accents and surfaces, and belongs to no one domain. It now calls the
  three compute commands and `absorbContest`.
- **`openWallEdit`'s outer half.** The step itself is
  `useWallMaterials.openWallEdit`; standing the door step, the zone step, the
  switchboard step, the pens and whatever is armed down on the way in is
  arbitration *between* features, and App is the only place that knows all of
  them. The order is unchanged: the step opens, the space is focused, then
  everything else goes away.
- **The keydown handler.** Its accent branch is now one call to `deleteAccent`
  and its spot branch was already one call to `deleteSpot`.
- **The admin "look again" flow**, which reaches
  `recognitionCommands.lookAgainAtBeds` — it belongs to the bed detectors and
  was extracted with them. The admin ledger's counts are read off the scene
  projections and the document, and are UI.
- **`canvasLayers`**, which reads `wallEditId`. It moved *down* the file to sit
  behind the hook call; its body is unchanged.

## Preserved behavior

- The eager crops still re-render on the same dependency arrays: `accentShot` on
  `[source, img, accentRoom, wallLayerSet]` and `wallShot` on
  `[source, img, focus, wallLayerSet, wallGrid]`, so a layout change still
  refreshes the picture the model is shown and a scale change still does not
  launch a call.
- Crop-to-plan conversion, positional ids (`furn-`, `acc-`, `surf-`, `wall-`),
  the type/surface/wall-feature tables, the bed substitution and its
  no-authoritative-bed rule, the excluded-bed audit list, the absence of a
  cached `runFt`, and the deterministic rule pass are all unchanged.
- The render pass still charges before its calls and releases on failure with a
  fresh `runId` per click, still clears a room's transcript up front, still
  short-circuits before PROMPT 02 when nothing was seen, still joins by index
  then by type-and-wall, still caps a two-part drop at `RENDER_DEFAULTS`, still
  uploads after the state and never fails a drop on the bucket, and still
  fetches stored views lazily for the open space only, never overwriting a
  working copy.
- The accent gesture keeps its two-pixel floor, its body-drag-only threshold,
  its advancing `last` pointer, its per-gesture `derived` snapshot, the shift
  key's opposite meanings on ordinary and derived runs, `RUN_TRIM.snapFt`
  rounding, and the release that clears only the snap indicator. Derived runs
  are still selectable without a body handle.
- Deleting a run still removes, switches off, dismisses or deletes the shape
  depending on which kind it is; deleting a spot still removes or dismisses the
  surface, or dismisses the art element, and never the fitting.
- The wall step still derives its layer overrides rather than setting them, so
  the View switches and the saved plan come back untouched; the tone popup still
  stands in viewport coordinates; the two tone setters still refuse to resolve a
  room's current tones.
- No saved schema, timing constant, UI, copy, CSS or network payload changed.

Two dependency arrays gained a `useState` setter that is now handed in rather
than declared locally (`deleteSpot`'s `setSel`, `pickSpace`'s
`setMaterialsEdit`). A setter's identity is stable for the life of the
component, so neither callback is rebuilt on any render it was not rebuilt on
before. The keydown listener's array traded `manualAccents`, `accentZonesPx` and
`manualCoves` — read only by the branch that moved — for `deleteAccent`, which
changes identity on exactly the renders those three did.

## Retired panels

`RenderPassPanel`, `AccentPanel`, `TaskSurfacePanel` and `PromptTranscript` are
**not mounted anywhere** — no file in `src/`, `api/` or `tools/` imports any of
the four, and the only references left are comments. Their state and handlers
were deliberately kept intact when the panels came off the Spaces list (see the
note App carries where `RenderPassPanel` used to be), so this extraction
**moved** them and removed nothing:

| Left behind by a retired panel | Where it is now |
| --- | --- |
| `accentRoomId`, `accentState`, `accentShot` and its effect | `useAccentPass` |
| `surfaceRoomId`, `surfaceState` | `useSurfacePass` |
| `renders`, `wallState`, `wallShot`, `wallTranscripts`, `wallGrid`, `wallAnchors`, `computeWallItems`, `runWallPass`, `addRenders`, the lazy fetch effect | `useRenderPass` |

Removing any of them would change runtime behavior, not just delete code: the
two crop effects rasterize on every focus and layout change and the fetch effect
pulls stored views out of the bucket. Timing is one of the things an extraction
must not touch, so they are returned from `panel`, `commands` and `status`,
ready for the panels to be mounted against, and their removal is a separate
decision. Nine `no-unused-vars` warnings disappeared as a result — the values
are now returned rather than dropped.

## Modules

| File | What it is |
| --- | --- |
| `useRoomIntelligence.js` | Composes the four passes and the wall step; groups the interface. |
| `useRoomEditing.js` | Composes the accent gesture and the task spots. |
| `useRoomTypePass.js` | Classification. One call, no state. |
| `useAccentPass.js` | Session state, the eager crop, and `computeAccents`. |
| `useSurfacePass.js` | Session state and `computeSurfaces`. |
| `useRenderPass.js` | Uploads, references, transcripts, the gridded crop, both calls. |
| `useWallMaterials.js` | The wall step's screen state, its geometry and the tone setters. |
| `useAccentEditing.js` | The drag, the trim, and the three ways of deleting a run. |
| `useTaskSpots.js` | Picking a spot and deleting the reason it exists. |
| `passResults.js` | **Pure.** What an accent, surface or wall-feature answer becomes. |
| `bedContest.js` | **Pure.** The fold from bed-fit records to verdicts and attributed beds. |

Nothing here imports `App.jsx` or another feature's private files. The existing
pure modules are used rather than reimplemented: `accentMask`, `accentPrompt`,
`accentPlace`, `taskSurfaces`, `wallPrompt`, `wallGrid`, `renderImage`,
`reverseCove`, `bedFit`, `furniture`, `materials`, `selection`, `pressOwner`,
`dragMove` and `hooks/useDrag`.

## Migration verification

Baseline: clean working tree at `2f297d6`; App.jsx had **13,592 lines**.
After extraction: **12,631 lines**, a reduction of **961**.

- Focused scripts, all passing before and after: `test-accents`,
  `test-accent-edit`, `test-surfaces`, `test-spots`, `test-art-spots`,
  `test-reverse-cove`, `test-shelf-strip`, `test-wall-pass`,
  `test-api-accents`, `test-bedfit`, `test-beds`, `test-render`,
  `test-materials`, `test-plan-projection`, `test-plan-state`, `test-scene`,
  `test-scene-memos`, `test-recognition`, `test-recognition-lifecycle`.
- New `test-room-intelligence.mjs` covers `passResults.js` and `bedContest.js`:
  crop-to-plan conversion, positional ids, bed substitution and containment, the
  no-bed rule, the excluded-bed audit, `handled`, non-mutation, surface sizes
  with and without a scale, wall-element decoration, the nothing-seen
  short-circuit, the forgiving join and both unplaced states, and the verdict
  fold including untraced beds. No test framework was installed; it is
  `node:assert` and one `node` invocation, like its neighbours.
- Lint: no errors. **68 warnings before, 59 after** — the nine that went are the
  dead-state `no-unused-vars` warnings listed above. The four warnings App still
  carries (`chunkFor`, `radiusFt`, `objType`, and `runPipeline`'s unnecessary
  `planAreaSqft` dependency) are all pre-existing. The feature's own files are
  warning-free.
- Production build passes before and after, with the existing large-chunk warning.
- `npm test` stops at the pre-existing missing `toDXF` export in
  `test-vector-flow.mjs`, both before and after.
- Running every script independently: baseline **52/59** pass; afterward
  **53/60**, including the new one. The failing set is **identical**:

| Pre-existing failing script | Failure |
| --- | --- |
| `test-vector-flow.mjs` | Missing `toDXF` export |
| `test-cad-export.mjs` | Raster export refusal expectation |
| `test-roomtypes.mjs` | Target area and toilet layout expectations |
| `test-ceiling.mjs` | Axis target count expectation |
| `test-cove.mjs` | Commercial/institutional lumen expectations |
| `test-track.mjs` | Track geometry, fitting count and load expectations |
| `test-flows.mjs` | Row grouping expectations |

These checks do not exercise browser rasterization or live model services.

Remaining in App that belongs to this domain: the lighting pipeline's
sequencing of the three passes and the bed contest; `openWallEdit`'s
stand-down half; the keydown bindings for the accent and spot deletes; the
canvas and panel bindings, including the admin ledger's counts; and the
`resetForNewPlan` ordering. No model request payload, no pass post-processing
and no room-level session state remains there.
