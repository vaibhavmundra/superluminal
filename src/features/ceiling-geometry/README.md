# Ceiling geometry

The coves, the guides, the magnetic-track **runs** and the **drawn** tracks —
what is set out on a ceiling before any fitting is put on it. `App` composes
this domain with `usePlanDoc`, `usePlanScene`, the scene projections, the shared
selection service and the snap engine; none of those changed.

Two nouns share the word "track" here and they are different things:

- A **magnetic-track run** IS a ceiling shape with `role: 'track'` — one entry
  in `ceilingShapes` beside the coves and the guides. That is why there is no
  store of paths for it and why it resizes, duplicates, snaps, drags and saves
  like everything else the geometry bar draws. See the header of `lib/magTrack.js`
  for the argument at length. The **modules** clipped into one are NOT this
  feature and did not move.
- A **drawn track** is a path clicked out over the plan in `manualTracks`, with
  its own pen, its own point editor and its own refusal messages. All of it is
  here.

`usePlanDoc` remains the single persistent-document boundary. Two stores belong
to this domain — `ceilingShapes` and `manualTracks` — and both are still the
document's, read out of the `doc` App hands in and written through the supplied
`docActions`. Its public state is not split and no part of it is duplicated
here.

What IS held here is the **authoring session**: which primitive is armed, where
a drag started, what each pen has clicked out, which borrowed outline is being
offset and how far, which shape is showing its grips, which one is being
resized or dragged, which drawn path is open and which of its points is picked
up, and the geometry the pointer is offering to take. Seventeen pieces of
transient state, none of them a fact about the plan and none of them surviving a
reopen.

## Four call sites, and App's own ordering decides every one

A hook's arguments are evaluated during render, and this domain has readers and
dependencies on both sides of it. The electrical feature is split in two for the
same reason; the scene feature across several.

| # | Call | Where it stands, and why |
| --- | --- | --- |
| 1 | `useGeometryState()` | Beside the state it replaces, ~800 lines in. `pressState` — the canvas's one arbitration table, `lib/pressOwner.js` — carries `shapeMenuOn` and `shapeTool`, and `resetForNewPlan` calls three of its resets. Both are built above anything that could give this feature its rooms. |
| 2 | `useCeilingGeometry(…)` | Above `roomFixtureGroups` and `placeArray`, exactly where the block it replaces stood, and for the reason that block gave: both read `arrayOutline`, and a `useCallback` evaluates its dependency array on every render, so a hook naming it below its own `const` is a temporal dead zone and a blank screen. |
| 3 | `useGeometryCommands(…)` | Below `disarmAdd`. Arming this tool puts six other machines away and that list is App's — see **What stayed in App**. `allocateOnTrack` is declared directly above it. |
| 4 | `useGeometryGestures(…)` | Below `snapTargets`. That function is App's — the ceiling objects, the lights and the COB snap against the same targets — and it reads this domain's `coveShapesPx`, so the projections have to be built above it and the two geometry snaps below it. `penSnap` and `shapeSnapFt` already stood exactly here. |

## Public interface

### 1. `useGeometryState()` — the session

| Group | Members |
| --- | --- |
| `press` | `shapeMenuOn`, `shapeTool` — the two members `pressState` carries |
| `reset` | `shapes`, `shapeTool`, `tracks` |
| — | `covePen`, `trackPen`, `geomHover`, `setGeomHover` |

Everything else it returns is the feature's own working state, handed to calls 2
to 4 rather than read by App. It is listed member by member rather than spread,
so a reader can see exactly what the session is.

`reset` has three members and not one because `resetForNewPlan` did not run
those statements together: the shapes went in one block, the tool's own state
twenty lines below with the light moves in between, and the tracks below that.
App calls each where the statements it replaces stood, so the reducer sees the
same dispatches in the same order. The `docActions.clearShapes()` and
`docActions.clearTracks()` halves stay at the call site beside them — the
document boundary is not crossed from inside the session.

`reset` is memoised for the reason `usePen` memoises its own return, quoted
there: a fresh object every render makes `resetForNewPlan` — which names it in
its dependency array — a fresh callback every render too, and that one is handed
to `usePlanSource`.

### 2. `useCeilingGeometry(inputs)` — the domain

Inputs, all explicit and all coordinated by App:

| Group | Members |
| --- | --- |
| the session | `state` |
| the scene | `rooms`, `pxPerFt`, `opt` |
| the selection service | `selShapeId` |
| the other machines, as facts | `addTool`, `cobMode`, `boardPlace`, `zoneMode`, `readOnly` |
| the document | `doc` |

| Group | Members |
| --- | --- |
| `shapes` | `all`, `selected`, `editId`, `resizing`, `dragging` |
| `lookup` | `at(pPx)`, `forTool(pPx)`, `roomForSlot(pFt)` |
| `arrayOutline` | `(geomId) => { pts, corners, closed, isRoom, roomId, label }` |
| `tracks` | `editId`, `selPt`, `grip`, `notes`, `noteLines`, `penEmpty` |
| `canvas` | `coveShapes`, `draftShape`, `penDraft`, `trackDraft`, `trackEdit`, `hoverId`, `placingGeometry`, `clampLive` |
| `bar` | `mode`, `tool`, `sides`, `askSides`, `canCommit`, `toCommit`, `offset` |
| `panel` | `coveDraw`, `canFinishOpen` |
| `pens` | `cove`, `track` |
| `status` | `menuOn`, `tool`, `role`, `span`, `draft`, `penEmpty`, `geomHover` |
| `reset` | the session's, forwarded |

`lookup` and `arrayOutline` are the entry the later fixture controller will use:
the COB array asks `arrayOutline` for a path to space lamps along, and the array
and module tools both ask `lookup.at` and `lookup.forTool` — one hit test with
one tolerance, so a hover cannot light a line the press then misses.

### 3. `useGeometryCommands(inputs)`

Inputs: `state`, `geometry` (call 2), `docActions`, `ceilingShapes`,
`manualTracks`, `trackFixtures`, `setSel`, `setGuides`, and App's two halves
`allocateOnTrack` and `standDown`.

| Group | Members |
| --- | --- |
| `toolbar` | `coveOn`, `trackOn`, `toggleCove`, `toggleTrack` |
| commands | `abandonShape`, `closeShapeTool`, `clearShapeEdit`, `openShapeTool`, `setHeldOffset`, `finishOpenCove`, `commitShape`, `pickShapeTool`, `duplicateShape`, `deleteShape`, `finishTrack`, `deleteTrack`, `deleteTrackPoint`, `openTrackEdit`, `closeTrackEdit`, `moveTrackPoint` |

### 4. `useGeometryGestures(inputs)`

Inputs: `state`, `commands`, `geometry`, `rooms`, `pxPerFt`, `ceilingShapes`,
`roomAt`, `svgPoint`, `svgRef`, `pressState`, `addTool`, `docActions`, `setSel`,
`setGuides`, `snapTargets`, `snapTol`.

| Member | What it is |
| --- | --- |
| `shapeTook` | The ref that stops a captured pointer's synthesised click reading as a press on bare plan. App's `onCanvasClick` consumes it and `onZoneDown` resets it. |
| `shapePointerDown`, `shapeHandleDown`, `trackPointDown` | The three grab handlers `PlanCanvas` is given |
| `shapeToolDown` | The press that draws. Returns `true` when it has taken the event |
| `trackPenPress`, `trackPenMove` | The drawn track's pen, for App's two `addTool === 'track'` branches |
| `spanMove`, `hoverMove`, `penMove`, `dragMove` | The canvas move router's four geometry branches, each returning `true` when it has taken the move |
| `spanUp`, `gestureUp` | The same for the release |

The four move branches and the two release branches return a boolean rather than
being folded into one handler because the ORDER between them is App's: other
machines' branches sit in between, and only App knows the precedence.

## Modules

| File | What it is |
| --- | --- |
| `useGeometryState.js` | The authoring session and the two pens. The early call site. |
| `useCeilingGeometry.js` | Composes the derivations and the scene's shape projections, and groups the interface. |
| `useGeometryDerivations.js` | The memo adapters. Nothing but dependency arrays and calls into the rules. |
| `useGeometryCommands.js` | Every act on a shape or a drawn run that is not a pointer gesture. |
| `useGeometryGestures.js` | The two snaps, `useDrag`, both pens' presses, the grips and the canvas routers. |
| `geometryRules.js` | **Pure.** The hit test, the tool's take rule, the slot projection, the array outline, the refusal ranking, the bar's four states, the offset sign and the finished pen path. |

Nothing here imports `App.jsx`. The one cross-feature import is
`useSceneShapeProjections`, a documented public adapter of `features/scene/` —
every one of its inputs but `rooms`, `pxPerFt` and the two document stores is
private to this feature (the draft, both pens, the armed tool, the open track),
so the call has to stand on this side of the line. The existing pure libraries
are used rather than reimplemented: `ceilingShapes`, `pen`, `cove`, `track`,
`magTrack`, `snapGuides`, `geometry`, `selection`, `pressOwner`, `cob`, and both
`hooks/usePen` and `hooks/useDrag`.

## What stayed in App, and why

- **The stand-down list.** `openShapeTool` arms a tool that owns every press on
  the canvas, so it has to put the zone editor, the door editor, the switchboard
  step and whatever is armed away on the way in. That is arbitration *between*
  features and App is the only place that knows all seven owners, so it is
  handed in as `standDown` and called exactly where the block stood — below the
  `!arm` return. Same split `openBoardPlace` already has.
- **`allocateOnTrack`.** Committing a magnetic track fills it, and what a run is
  filled WITH is the module domain's question: it reads the space analysis, the
  family catalogue and the room's shortfall. It is handed in and called on the
  line it was called on before. It moved up four hundred lines within App with
  nothing else changed.
- **`snapTargets` and `snapTol`.** Generic: the ceiling objects, the lights, the
  doors and the COB snap against the same targets. It reads this feature's
  `canvas.coveShapes`, which is why the gestures are a separate call.
- **`selShapeId`.** With the other nine reads of the selection register, because
  the magnetic-track domain asks for it four hundred lines above this feature is
  composed.
- **`guides` / `setGuides`.** Five gestures publish the momentary alignment
  lines and only two of them are this feature's.
- **The keydown handler's precedence**, including the drawn-track point
  editor's two keys, both pens' Enter/Backspace/Escape, the shape tool's
  two-stage Escape and Delete's shape branch. Each one calls a command or a pen;
  the ORDER is arbitration between eleven machines.
- **The canvas and panel bindings**, including the pointer router's dispatch
  into the six geometry branch functions, `PlanCanvas`'s props, `ShapeMenu`'s
  props, the cove step's cards and the drawn-track step's two buttons.
- **`resetForNewPlan`'s ordering**, which calls the three reset members in
  place.
- **The COB array and module presses**, which reach `lookup.at`,
  `lookup.forTool` and `arrayOutline` through the public interface.
- **The magnetic-track MODULE projection.** `useSceneTrackProjections` produces
  `magTracksPx` and `magTrackById` (geometry) in the same call as
  `trackModulesPx` (modules), so it stays with the module domain it belongs to
  until that domain moves. `selTrackId` stays with it for the same reason.

## Preserved behavior

- Every dependency array moved unchanged in membership. Where a body became a
  module import the array did not change: a module binding is stable for the
  life of the process, which is strictly more stable than the callback it
  replaced. Eleven callbacks gained a `useState` setter that is now handed in
  rather than declared locally; a setter's identity is stable for the life of
  the component, so none is rebuilt on a render it was not rebuilt on before.
- A released drag still does NOT commit: it becomes a held draft and the bar
  turns into a tick and a cross. The tick still lands the shape, selects it and
  hands the bar over as that shape's contextual menu, and it still fills a run
  it has just committed.
- The borrowed draft is still recomputed from the SOURCE on every change rather
  than accumulated, a refusal still leaves it where it was, and the control is
  still withheld for an open path and for a shape dragged out from scratch.
- The pen still has two endings — closed on the first point is a pocket, Enter
  or a double-click with both ends on plaster is a run — and an open cove is
  still offered only where it lands on a wall at both ends, while a guide or a
  track is finished at two points.
- A slot still projects both ends onto the plaster on every move, still refuses
  with the sentence that says why, and still exempts a guide and a track because
  neither is built into the plaster.
- A cove still stops six inches clear of the plaster on a move and on a resize;
  a guide and a track still do not. A slot's own drag is still declined outright
  rather than clamped.
- Alt still leaves a copy behind, a duplicate still lands half a foot down and
  across, and duplicating a run still brings its modules with it as fractions.
  Deleting a shape still takes its modules with it.
- The hit test is still first-match-in-list at a screen-pixel tolerance, the
  take rule still reads symmetrically across the two roles, and the module tool
  still takes a track and nothing else.
- Drawn-track refusals are still asked per room, answered once, ranked
  most-specific-first, and grouped one line per reason with a count.
- No stored key, schema, timing constant, UI, copy, CSS or network payload
  changed. `DOUBLE_MS` is still 400, the close tolerance is still 6 px or 0.4 ft,
  the wall tolerance is still 8 px or 0.5 ft, the hit tolerance 8 px or 0.4 ft,
  and the drag threshold 3 px or 0.12 ft.

**The three things that moved rather than stayed**, all of them `useMemo`s and
`useCallback`s with no effect in them:

- The **scene's shape projections** now run at call 2 instead of 3,500 lines
  lower. Nothing between the two points reads them — checked by name — and they
  are pure memos.
- The **drawn-track refusals** moved up with the rest of the derivations, from
  below `showTrace` to call 2. Same reasoning.
- **`allocateOnTrack`** moved up four hundred lines within App, from below the
  bar's derivations to just above the commands call.

The **presses and drags** moved DOWN, past `snapTargets`, to join the two snaps
they were already calling at run time. Every one of them is a plain function or
a `useDrag`, and nothing between the two points calls any of them.

## Migration verification (2026-09-08)

Baseline: clean working tree at `ea037bc`; App.jsx had **11,724 lines**.
After extraction: **10,378 lines**, a reduction of **1,346**.
No applicable filesystem `AGENTS.md` was found in this repository or its
ancestors. No commit was made.

| Check | Before | After |
| --- | --- | --- |
| Repository lint (`src api tools`) | 0 errors, 59 warnings | 0 errors, the same 59 warnings |
| `src/App.jsx` lint | 0 errors, 4 warnings | 0 errors, the same 4 warnings |
| `src/features/ceiling-geometry/` lint | — | 0 errors, 0 warnings |
| Production build | Pass, large-chunk warning | Pass, same warning |
| Every `tools/test-*.mjs` run independently | 55 pass, 8 fail | 55 pass, the same 8 fail |

The failing set is **identical** before and after:

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

New registered test — `tools/test-ceiling-geometry.mjs`, `node:assert` and one
`node` invocation like its neighbours; no framework or dependency was installed.
It covers `geometryRules.js`: the room a slot starts in including the
two-foot wall reach and the nearest-wall tie-break, the hit test's list order and
its screen-pixel tolerance, the take rule's full truth table across the three
tools and three roles, the slot's wall projection with both refusal sentences and
the guide/track exemption, the array outline from both a room and a shape
(including corners-are-not-pts and the deleted-shape miss), the refusal pass's
placed/outside/reach cases and its unlit-room skip, the one-line-per-reason
grouping, all four bar states including the `otherBar` gate and the
`shapeSpan`-counts-as-drawing rule, the offset's three sides, and the closed
path's dropped last segment.

Two mechanical checks were also run against the pre-change file: every
identifier and every string literal present in the old `App.jsx` and absent from
the new one was confirmed present in the feature (comments stripped — 0 missing
identifiers, and the only missing literals were three import paths whose relative
depth changed), and a forward-reference scan over every moved name found none
read before its declaration.

These checks do not exercise browser pointer events, pointer capture, or the
canvas itself.

## Remaining in App that belongs to this domain

The stand-down list, `allocateOnTrack`, `snapTargets`/`snapTol`, `selShapeId`,
the `guides` state, the keydown handler's precedence, the canvas and panel
bindings, `resetForNewPlan`'s ordering, and the magnetic-track run projection
(`useSceneTrackProjections`, `magTracksPx`, `magTrackById`, `selTrackId`), which
is held back with the modules it is called alongside. No shape derivation, no
drawn-track rule, no gesture state and no geometry session state remains there.
