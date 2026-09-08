# Scene derivations

This feature derives scene geometry from explicit inputs. It owns no document,
UI or gesture state and has no editing commands, effects or network requests.
`usePlanDoc` remains the persistent-document boundary. App coordinates the stages
because recognition needs wall layers before layout, and electrical/fixture
projections need callbacks and draft inputs produced later in App.

## Files

Created in `src/features/scene/`: `usePlanScene.js`, `useSceneSource.js`,
`useScenePlanProjections.js`, `useSceneElectricalProjections.js`,
`useSceneFixtureProjections.js`, `roomGeometry.js`, `bedZones.js`,
`wallGeometry.js`, and this `README.md`.

Also created `tools/test-scene.mjs` and `tools/test-scene-memos.mjs`.
Changed `src/App.jsx`, `src/hooks/useOutlines.js` (derived outputs now come from
scene adapters), and `package.json` (register both new tests).

## Public adapters

| Adapter | Returned groups |
| --- | --- |
| `useSceneArchitecture({ isVector, source })` | `architecture.wallLayerSet` |
| `useSceneOutlines({ source, outlines, litIds })` | `rooms.outlinesPx`, `rooms.litOutlines`, `rooms.enclosedZones` |
| `usePlanScene(inputs)` | `rooms`, `architecture`, `furnishings`, `lightingGeometry` |
| `useScenePlanProjections(inputs)` | `projections`: surfaces, art, task spots, accents, wall cells |
| `useSceneElectricalProjections(inputs)` | `projections`: all boards, flows, visible switchboards, board names |
| `useSceneTrackProjections(inputs)` | `projections`: magnetic tracks, track lookup, modules |
| `useSceneArrayProjections(inputs)` | `projections`: array COBs, draft array, selected path |
| `useSceneManualProjections(inputs)` | `projections.manualCobsPx` |
| `useSceneShapeProjections(inputs)` | `projections`: cove shapes, draft shape, track draft/edit, pen draft |

`usePlanScene` accepts resolved outlines, source/scale, document field references,
layout options and focus; its signature lists every dependency. Its groups are:

- `rooms`: `items`, `focus`, `openRoom`, `litOutlines`, `planAreaSqft`.
- `architecture`: `obstaclesPx`, `ceilingObstaclesPx`.
- `furnishings`: `bedsPerRoom`, `detectedZones`, `wardrobesPx`, `shelfStrips`.
- `lightingGeometry`: `reverseCoves`, `wardrobeZones`, `reverseCoveZones`,
  `zoneList`, `drawnZones`, `chunkOpt`.

The original individual memo dependencies are retained. Group objects are naming
containers; downstream dependencies should use their memoized members. Focus
changes do not invalidate layout. Chunk options depend on their four scalar
settings, while layout retains its existing dependency on the full `opt` object.
Pen containers are explicit inputs but only their original member dependencies
invalidate draft projections.

## Private derivations and preserved behavior

`roomGeometry.js`, `bedZones.js` and `wallGeometry.js` contain the extracted
builders. Existing `layout.js`, `planProjection.js`, `fixtureProjection.js` and
`electricalProjection.js` algorithms are called unchanged.

Drawing-unit outlines resolve to plan pixels before measurement. Ceiling objects
and fixture paths remain in plan feet until projected; layout uses each room's
own origin for room feet. Room-tagged zones retain ownership, while detected bed
zones retain their existing pixel-containment ownership. Crop beds supersede
whole-sheet beds before dismissal/physical filtering; accent-pass beds remain
audit-only. Shelf strips are not no-light zones. Reverse coves still merge before
trimming; manual coves join after merging and survive only for lit rooms. Drawn
zones remain separate from planner zones. Focus falls back to the first room;
the open detail view does not. Board numbering remains independent of layers.

Bed diagnostics are returned as data by `buildDetectedZones` and logged by its
memo adapter during the same render evaluation, with the original messages and
dependencies. No effect or asynchronous work was added.

**Existing purity limitation:** outline rectification in `lib/geometry.js` can
mutate the point objects supplied through `outlineStats`/`regionFromOutline`.
`tools/test-layout.mjs` already pins this behavior. This migration deliberately
preserves it, including the order of area, wall and layout evaluation. The new
frozen-input repeat-call tests prove the unrectified geometry path and the other
pure builders; they do not claim to fix rectification. A separate fix is needed
before the whole graph can promise purity for every outline.

## Migration verification (2026-09-08)

Initial revision: `7f142f5`; working tree was clean. No applicable filesystem
AGENTS.md files were found in this repository or its ancestors. The supplied
project-mirror restrictions were respected; no synced source files were touched.
No commit was made.

App.jsx: **14,099 → 13,592 lines**, a reduction of **507**.

| Check | Before | After |
| --- | --- | --- |
| Repository lint | 0 errors, 68 warnings | 0 errors, same 68 warnings |
| Affected-file lint | App had 13 warnings | 0 errors, same 13 App warnings; new files clean |
| Production build | Pass | Pass |
| Registered scripts, run independently | 50/57 pass | 52/59 pass |
| `npm test` | Stops at missing `toDXF` export | Same failure, after both new tests pass |

Build warnings were already present: duplicate `coveClampPx` JSX attribute and
large output chunks. All seven failing registered scripts have identical failure
signatures before and after: `test-vector-flow.mjs` (missing `toDXF` export),
`test-cad-export.mjs` (1 failure), `test-roomtypes.mjs` (7),
`test-ceiling.mjs` (1), `test-cove.mjs` (2), `test-track.mjs` (8), and
`test-flows.mjs` (2).

Focused checks: 14 of 15 scripts pass. The extra `test-bed-grid.mjs`, which is not
in the npm test chain, has two failures out of 46 checks. Both were reproduced
from a fresh archive of the initial HEAD revision, using the same dependencies.

New registered tests:

- `tools/test-scene.mjs`: coordinate spaces, room ownership, guards, bed source
  precedence, diagnostics, cove/shelf filtering and frozen-input repeat calls.
- `tools/test-scene-memos.mjs`: actual adapters with a controlled React import
  boundary, checking identity/invalidation across every stage. Uses the existing
  VM-module testing approach; no framework or dependency was installed.

An additional migration comparison against the saved original App memo bodies
passed 14 scenarios (including rectification, source/scale guards, focus and
filtering), checked identical legacy mutations, and verified all 39 moved App
memo dependency lists. A forward-reference comparison found no new references
before declaration. `git diff --check` passed.

## Remaining scene-adjacent work in App

App still computes gesture previews such as `draftCove` and `shapeDraft`, selected
object/room views, wall-edit geometry and `wallGrid` for recognition. Electrical
board rules (`boardResults`, `bayResults`, `outdoorFeeds`) and their provider
callbacks remain upstream inputs to scene projections. Totals, lumens, BOQ,
loader/analysis views, snapping and hit-testing derivations also remain with
their current workflows. Network calls, editing commands and all temporary state
remain outside this feature.
