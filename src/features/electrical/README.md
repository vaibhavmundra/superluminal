# Electrical

Where the plates are, what each one is, what is on it, and how every fitting on
the ceiling gets back to a switch. `App` composes it with `usePlanDoc`,
`usePlanScene`, the scene projections, `useRoomIntelligence` and the shared
selection service; none of those changed.

`usePlanDoc` remains the single persistent-document boundary. Its public state
is not split and no part of it is duplicated here. Nine stores belong to this
domain — the plates thrown away (`boardsOff`), the ones dragged along their
plaster (`boardMoves`), the points added by hand (`boardPoints`), the wires
re-assigned (`flowBoards`) and nudged (`flowBends`), the plates placed by hand
(`manualBoards`), and the three overrides `boardKinds`, `boardHeights` and
`boardOrders` — plus `doorsOk`, the confirmation the wiring is gated behind.
Every one of them is still the document's, read out of the `doc` App hands in
and written through the supplied `docActions`.

What IS held here is the three pieces of transient state a wiring gesture needs:
the plate being slid, the wire being aimed, and whether the placing step is
open. None of the three is a fact about the plan and none survives the pointer.

## Derived versus manual, which is the shape of the whole domain

Preserved exactly, because it is the reason this feature has three sources of
boards rather than one list:

- A **rule's** plate is a memo over the door boxes, the sconces and the bed box.
  "Not this one" cannot be expressed by removing it — the next render puts it
  straight back — so it is a dismissal into `boardsOff`, and a hand position is
  an arc length in `boardMoves` that `asDrawn` applies. Its id is minted by
  `planSwitchboards` and is stable under everything but a re-trace.
- A **bay** plate is the same kind of thing one level down: derived by
  `planChunkBoards` from where the RULES put the boards, so that dragging one
  moves the mark and the wire and never the ownership.
- A **hand-placed** plate has no rule to come back from. It is a member of
  `manualBoards`, its `sFt` IS its position, and deleting one removes it rather
  than dismissing it — an id in `boardsOff` for a plate that no longer exists
  would suppress nothing for the life of the plan.

`boardKinds`, `boardHeights` and `boardOrders` are overrides and not values: a
plate with no entry is whatever it was born as, and reverting one deletes its
entry rather than writing the current default back.

## Public interface

**Two call sites, and App's own ordering decides it.** `pressState` — the
canvas's one arbitration table, see `lib/pressOwner.js` — carries the placing
step's flag, and it is built four hundred lines above anything that could give
this feature its geometry or its pointer. A hook's arguments are evaluated
during render, so the step is asked for on its own, early, and the rest of the
domain is composed later and handed the result. The room-intelligence feature is
split across two calls for the same reason; the scene feature across several.

### `useBoardStep({ setSel, docActions })` — the placing step

Returns `{ boardPlace, setBoardPlace, openBoardPlace, closeBoardPlace }`. App
takes `boardPlace` for `pressState` and `closeBoardPlace` for the four other
steps that stand this one down on their way in. The whole result is handed to
`useElectrical`, which folds it into the groups below.

### `useElectrical(inputs)` — the domain

Inputs, all explicit and all coordinated by App:

| Group | Members |
| --- | --- |
| the scene | `rooms`, `pxPerFt`, `obstaclesPx`, `wardrobesPx`, `accentZonesPx`, `taskSpotsPx` |
| room intelligence and the drawing | `roomTypes`, `doors`, `projectId`, `country`, `layers`, `doorEdit` |
| the selection service | `sel`, `setSel` |
| the pointer | `svgPoint`, `svgRef`, `pressState` |
| the step | `boardStep` |
| the document | `doc`, `docActions` |

| Group | Members |
| --- | --- |
| `canvas` | `switchboardsPx`, `flowsPx`, `allBoardsPx`, `boardNames`, `selBoardId`, `selFlowId`, `boardDrag`, `flowDrag`, `onBoardPointerDown`, `boardPointerMove`, `boardPointerUp`, `onFlowPointerDown`, `onFlowGripDown`, `flowPointerMove`, `flowPointerUp` |
| `panel` | `selBoard`, `selBoardExtras`, `selBoardParts`, `heightOf`, `country`, `placing`, `doorsOk`, `placedCount` |
| `sheet` | `groups`, `country` |
| `commands` | `pickFlow`, `reorderBoardUnit`, `setBoardOutlet`, `setBoardAmps`, `setBoardHeight`, `addBoardPoint`, `removeBoardPoint`, `resetBoard`, `deleteBoard`, `placeBoardAt`, `openBoardPlace`, `closeBoardPlace`, `clearPlacedBoards`, `confirmDoors`, `toggleLayer` |
| `selection` | `boardId`, `flowId`, `board` |
| `reset` | `electrical`, `doorConfirmation` |

`reset` is two members and not one because `resetForNewPlan` did not run those
statements together: the nine stores went in one block and the door
confirmation stood among the door resets, twenty lines further down. App calls
each where the statements it replaces stood, so the reducer sees the same
dispatches in the same order. It reaches them through a callback ref, which is
the pattern the recognition and room-intelligence features already use to
resolve the load/reset cycle.

`resetBoard` has no caller and is deliberately kept — see its note.

## Modules

| File | What it is |
| --- | --- |
| `useElectrical.js` | Composes the three halves, groups the interface, owns the door gate and both resets. |
| `useBoardRules.js` | The memo adapters. Nothing but dependency arrays. |
| `useBoardPanel.js` | The plate somebody is reading, the schedule, and every command on one. |
| `useBoardGestures.js` | Both `useDrag` instances, their handlers, and seating a plate by hand. |
| `useBoardStep.js` | The placing step's own flag. The feature's early call site. |
| `boardRules.js` | **Pure.** The three passes, the outdoor feeds, what a plate is, which plates are on the drawing, and where a click seats one. |
| `boardSheet.js` | **Pure.** What is on a plate, the schedule, the module arrangement, and the two minted ids. |

Nothing here imports `App.jsx`. The one cross-feature import is
`useSceneElectricalProjections`, a documented public adapter of
`features/scene/` — it needs the three board readers, which are private to this
feature, so the call has to stand on this side of the line. The existing pure
libraries are used rather than reimplemented: `electrical`, `switchboards`,
`flows` (through the projection), `electricalProjection`, `bedGrid`,
`roomTypes`, `geometry`, `selection`, `pressOwner` and `hooks/useDrag`.

## What stayed in App, and why

- **The stand-down half of `openBoardPlace`.** The step itself is
  `useBoardStep.openBoardPlace`; putting the door step, the zone step, the wall
  step, the shape tool and whatever is armed away on the way in is arbitration
  *between* features, and App is the only place that knows all seven owners.
  Same split the wall step already had.
- **`confirmDoors`'s outer half.** Closing the door editor is the door domain's
  screen; what confirming BUYS — `doorsOk`, and the wiring layer coming on —
  is `commands.confirmDoors`.
- **The layer switch's branch order.** `readOnly`, then the zone step, then the
  door step, then the gate. Three of those four are other people's screens. The
  gate itself is `panel.doorsOk` and the switch is `commands.toggleLayer`.
- **The canvas and panel bindings**, including the keydown handler's Delete
  branch for a plate (one call to `deleteBoard`) and for a wire (one call to
  `docActions.dropFlowOverrides`), and the canvas pointer router's dispatch to
  the two drags.
- **`resetForNewPlan`'s ordering**, which calls both reset members in place.

## Preserved behavior

- Every dependency array moved unchanged. Three callbacks gained `setSel`,
  which is now handed in rather than declared locally; a setter's identity is
  stable for the life of the component, so none is rebuilt on a render it was
  not rebuilt on before. `boardSheet` lost `heightOf` from its array because
  that function is now a module import — stable for the life of the process
  rather than the life of the component, which is strictly more stable.
- A board slide still writes per move and a wire's board-end still commits only
  on the drop; a bend still writes per move. Both thresholds are still a
  fraction of the drawing with a 12 px/ft fallback. A release over nothing is
  still a gesture abandoned, and a drop on the plate a wire was already on still
  clears the override rather than pinning it.
- A wire dropped on a socket outlet still converts it in the same gesture, and
  adding any point to one still converts it as the point lands.
- The height override still replaces only the FIRST plate of a facing board's
  list, and is still applied AFTER the outlet transform so it survives one.
- Board numbering is still one ungated sequence over the whole plan, in rooms
  order, rules then bays then hand — so a layer switch cannot renumber the job.
- The schedule still carries every plate whatever the layer says, sorted by
  module count and then by name numerically, and is still composed by the same
  pair of functions the card uses. The card asks for the outlet's `flowId` and
  the sheet does not, exactly as before.
- The balcony rule still takes the nearest plate in the inner room whatever its
  role, still refuses a socket outlet, and still gives a space with nowhere to
  feed from no board at all.
- Minting a hand point and a hand plate produce the same id shapes; no stored
  key, schema, timing constant, UI, copy, CSS or network payload changed.

**The one thing that moved rather than stayed:** the whole derivation block was
declared where its inputs land and now stands below `svgPoint`, where its
gestures can be made. Nothing between the two points reads a plate, a wire or a
schedule — checked by name over every moved identifier — and every member is a
`useMemo` or `useCallback` with no effect in it, so the only observable
difference is the position of `[electrical] the rules failed for …` in a console
log relative to other diagnostics printed during the same render. `App`'s
`canvasLayers` moved down the file for the same reason during the previous
migration.

## Migration verification (2026-09-08)

Baseline: clean working tree at `4a5f1a0`; App.jsx had **12,631 lines**.
After extraction: **11,724 lines**, a reduction of **907**.
No applicable filesystem `AGENTS.md` was found in this repository or its
ancestors. No commit was made.

| Check | Before | After |
| --- | --- | --- |
| Repository lint (`src api tools`) | 0 errors, 59 warnings | 0 errors, same 59 warnings |
| `src/App.jsx` lint | 0 errors, 4 warnings | 0 errors, same 4 warnings |
| Production build | Pass, large-chunk warning | Pass, same warning |
| Every `tools/test-*.mjs` run independently | 54/62 pass | 55/63 pass |
| `npm test` | Stops at the missing `toDXF` export | Stops at the same line, byte-identical output |

The failing set is **identical** before and after, and each script's output is
byte-identical for the two that were asked for by name:

| Pre-existing failing script | Failure |
| --- | --- |
| `test-vector-flow.mjs` | Missing `toDXF` export |
| `test-cad-export.mjs` | Raster export refusal expectation (1) |
| `test-roomtypes.mjs` | Target area and toilet layout expectations (7) |
| `test-ceiling.mjs` | Axis target count expectation (1) |
| `test-cove.mjs` | Commercial/institutional lumen expectations (2) |
| `test-track.mjs` | Track geometry, fitting count and load expectations (8) |
| `test-flows.mjs` | Row grouping expectations (2) |
| `test-bed-grid.mjs` | Two of 46 checks; not in the `npm test` chain |

Focused scripts asked for by name, all passing before and after:
`test-electrical`, `test-switchboards`, `test-drag`, `test-plan-projection`,
`test-plan-state`, `test-boq`, `test-press-owner`, `test-scene`,
`test-scene-memos`, `test-room-intelligence`, `test-recognition`.
`test-flows` and `test-cad-export` fail identically at both revisions.

New registered test — `tools/test-electrical-domain.mjs`, `node:assert` and one
`node` invocation like its neighbours; no framework or dependency was installed.
It covers `boardRules.js` and `boardSheet.js`: the three rules asked for by
name, the balcony's empty-result-with-a-sentence, the scale and failed-layout
guards, a throwing rule reported by its own room without taking the loop down,
non-mutation of the door list, design-chunk versus bounding-box bays, the
outdoor feed's nearest-and-not-a-socket rule and its fall-back to nothing, the
born-as default and its override, the height applied after the mode and the
facing board's plate count, the three drawing filters, the seat search across
rooms and its miss threshold, both composers and the `flowId` difference between
the card and the sheet, the schedule's grouping and its two sort keys, the
reorder's vacated-slot rule and its clamps, and the two minted id shapes.

Two mechanical checks were also run against the pre-change file: every literal
and every identifier in the three moved code blocks was confirmed present in the
feature (comments stripped, 0 missing), and a forward-reference scan over every
moved name found none read before its declaration. `git diff --check` passes.

These checks do not exercise browser rasterization, pointer events or live model
services.

## Remaining in App that belongs to this domain

The stand-down half of `openBoardPlace`, the closing half of `confirmDoors`,
the layer switch's branch order and its chrome, the canvas and panel bindings
(including the Delete key's two branches and the pointer router's dispatch into
the two drags), and `resetForNewPlan`'s ordering of the two reset members. No
board rule, no flow, no plate composition, no schedule, no gesture and no
electrical session state remains there.
