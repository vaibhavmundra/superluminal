# Fixtures

The things you PUT ON a ceiling, as against the geometry you set out on it. The
hand-placed downlight and the arrays it comes in, the modules that clip into a
magnetic track, the fan and the cassette and the trapdoor, and the ambient light
the grid put down that somebody nudged inside its own cell. `App` composes this
domain with `usePlanDoc`, `usePlanScene`, `features/ceiling-geometry/`, the
shared selection service and the snap engine; none of those changed.

It is built on **two public interfaces and nothing else**:

- `features/scene/useSceneFixtureProjections.js` — its three documented adapters
  (`useSceneTrackProjections`, `useSceneArrayProjections`,
  `useSceneManualProjections`) moved here from App's import list with the calls
  that were already the only readers of them.
- `features/ceiling-geometry/useCeilingGeometry.js` — `arrayOutline`,
  `lookup.at` and `lookup.forTool`, which that feature's README names as the
  entry "the later fixture controller will use". They are handed in by App and
  are the only thing this domain knows about how a cove, a guide or a track run
  is drawn. Nothing here reaches into a geometry private file.

`usePlanDoc` remains the single persistent-document boundary. Six stores belong
to this domain — `manualCobs`, `cobArrays`, `trackFixtures`, `ceilingObjs`,
`lightMoves` and `autoSpots` — and every one is still the document's, read out
of the stores App hands in and written through the supplied `docActions`. Its
public state is not split, the saved schema did not change, and no part of it is
duplicated here.

What IS held here is the **placing session**: which cell of the rail is open,
which of its two gestures is armed, the three specification slots the next lamp
reads, the ids placed since the tool was picked up, the one ceiling the run in
progress belongs to, the array being set out, the module armed, the type of
object armed, the sweep the next fan gets, the crosshair's ghost, and the five
drags in flight. Twenty-two pieces of transient state, none of them a fact about
the plan and none surviving a reopen.

## Five call sites, and App's own ordering decides every one

A hook's arguments are evaluated during render, and this domain has readers and
dependencies at five different depths of App. The electrical feature is split in
two for the same reason; the scene feature across several; the ceiling geometry
across four.

| # | Call | Where it stands, and why |
| --- | --- | --- |
| 1 | `useFixtureState({ sel, setSel })` | Beside the state it replaces, ~540 lines in. `pressState` — the canvas's one arbitration table, `lib/pressOwner.js` — carries `armed`, and `resetForNewPlan` calls three of its resets while `disarmAdd` calls the other two. Both are built above anything that could give this feature its rooms. |
| 2 | `useFixtures(…)` | Exactly where the track and array projection block stood, above the lighting analysis and the BOQ it builds. Both name `tracks.modulesPx` and `arrays.lampsPx`, and a `useMemo` evaluates its dependency array on every render, so a reader above its own `const` is a temporal dead zone and a blank screen. |
| 3 | `useFixtureCommands(…)` | Where `autoplaceIn` stood — the highest point at which everything exists. The basis pair comes from call 2; `spaceAnalysis`, which the diffuser allocator runs backwards, is two hundred lines above. It has to be ABOVE `useGeometryCommands`, four hundred lines down, because `allocateOnTrack` is handed to it. |
| 4 | `useCobTool(…)` | Where `manualCobsPx` stood, directly below `roomAt`. Which space the pointer is over decides the recommendation, the wall band and the bed warning, and that hit test is App's — the doors, the accents, the strip and the ceiling objects all ask it. |
| 5 | `useFixtureGestures(…)` | Below `snapTargets`, `snapTol`, `svgPoint`, `pressState` and `arrayStandDown`. Every one of the five drags is a `useDrag` and every press is a plain function, so nothing between the earlier call sites and this one calls any of them. |

## Public interface

### 1. `useFixtureState({ sel, setSel })` — the session

The selection REGISTER is App's and is handed in; six of its kinds are read
here. Same split `selShapeId` makes for the geometry.

| Group | Members |
| --- | --- |
| the register's reads | `selObjIds`, `selObjId`, `selCobId`, `selArrayId`, `selModuleId`, `selLightId`, `toggleSelObj` |
| `reset` | `objects`, `lightMoves`, `armed`, `module`, `cobGesture` |

Everything else it returns is the session's own working state, listed member by
member rather than spread so a reader can see exactly what the session is:
`objType`, `fanSweepMm`, `objDrag`, `objMode`, `armed`, `ghost`, the six COB
drawer slots, `cobRun`, `cobLock`, `cobAt`, `cobDraftArray`, `arrayDrag`,
`trackMode`, `moduleDrag` and `lightDrag`, each with its setter.

`reset` has five members and not one because `resetForNewPlan` and `disarmAdd`
did not run those statements together: the objects went in one block with
`clearObjects`, the light drag with `clearLightMoves`, the armed one-shot below
that, and the modules with `clearTrackFixtures` — while `disarmAdd` clears the
COB bar and the armed module either side of the geometry highlight. App calls
each where the statements it replaces stood, so the reducer sees the same
dispatches in the same order. The `docActions.clear*` halves stay at the call
site beside them — the document boundary is not crossed from inside the session.

`reset` is memoised for the reason `usePen` memoises its own return, quoted
there: a fresh object every render makes `resetForNewPlan` — which names it in
its dependency array — a fresh callback every render too, and that one is handed
to `usePlanSource`.

### 2. `useFixtures(inputs)` — what is on the ceiling, projected

Inputs, all explicit and all coordinated by App: `state`, `rooms`, `pxPerFt`,
`country`, `ceilingShapes`, `trackFixtures`, `cobArrays`, `manualCobs`,
`arrayOutline`, `ceilingMmFor`, `selShapeId`.

| Group | Members |
| --- | --- |
| `tracks` | `runsPx`, `byId`, `modulesPx`, `selId` |
| `arrays` | `lampsPx`, `draftPx`, `selPathPx`, `bar`, `draftBar` |
| `cob` | `basisFor(room)`, `specInForce(room)` |

### 3. `useFixtureCommands(inputs)`

Inputs: `state`, `fixtures` (call 2), `docActions`, `rooms`, `pxPerFt`,
`readOnly`, `manualCobs`, `cobArrays`, `trackFixtures`, `arrayOutline`,
`spaceAnalysis`, `setSel`, `setOptionPick`.

| Group | Members |
| --- | --- |
| `autoplace` | `fill(room)`, `set(roomId, on)` |
| `arrays` | `place`, `setSpec`, `setShape`, `remove`, `setDraftCount`, `setDraftSide`, `setDraftOffset` |
| `modules` | `setSpec`, `isRow(key)`, `remove`, `allocateOnTrack(shape)` |
| `cob` | `setSpec`, `remove`, `dropRun` |
| `objects` | `remove`, `setSweep(mm)` |
| `lights` | `reset(key)` |

It also holds the effect that keeps every lamp nobody overruled in step with its
chunk.

### 4. `useCobTool(inputs)` — the next downlight

Inputs: `state`, `manualCobs`, `pxPerFt`, `ceilingMmFor`, `zoom`, `roomAt`,
`basisFor`, `addTool`, `roomTypes`, `setGuides`.

| Member | What it is |
| --- | --- |
| `cobsPx` | the hand-placed lamps in plan pixels, with their throw rings |
| `targets`, `snap`, `snapAt` | the alignment targets, the hover/press snap, and the drag's snap with the frozen axis kept out |
| `room`, `engine` | the space under the pointer and what the gridding engine would install there |
| `inForce`, `show`, `dirty`, `recommended` | the four-deep specification stack, and whether the bar is showing an uncommitted change |
| `guide` | the wall band and the bed under the pointer, or null |

### 5. `useFixtureGestures(inputs)`

Inputs: `state`, `fixtures`, `cobTool`, `rooms`, `pxPerFt`, `zoom`, `opt`,
`source`, `addTool`, `selAccId`, `overRoom`, the four stores, `svgPoint`,
`svgRef`, `pressState`, `roomAt`, `insideAnyRoom`, `snapTargets`,
`snapTol`, `arrayOutline`, `shapeAtPointer`, `geomUnder`, `geomHover`,
`setGeomHover`, `clearShapeEdit`, `standDown`, `docActions`, `setSel`, `guides`,
`setGuides`, `setOverRoom`, `setAddAt`, `setOptionPick`.

| Group | Members |
| --- | --- |
| `canvas` | `onLightPointerDown`, `onObjPointerDown`, `onCobPointerDown`, `onArrayPathDown`, `onModulePointerDown` — the five grab handlers `PlanCanvas` is given |
| `drag` | `light`, `object`, `cob`, `array`, `module` — the gesture in flight |
| `move` / `up` | the same five, for the canvas move and release routers |
| `tool` | `moduleDown`, `arrayDown`, `cobDown`, `objectDown`, `moduleMove`, `cobMove`, `armedMove` — the pointer router's seven fixture branches, each returning `true` when it has taken the event |
| `commands` | `openArray` |
| `draft` | `array`, `setArray` |

The router branches return a boolean rather than being folded into one handler
because the ORDER between them is App's: the door editor, the accents, the
plates and the wires all have branches in between, and only App knows the
precedence. Same idiom the geometry gestures already use.

## Modules

| File | What it is |
| --- | --- |
| `useFixtureState.js` | The placing session and the six selection reads. The early call site. |
| `useFixtures.js` | The scene's three fixture projections, the selected run, the two array bars and the specification basis. Grouped. |
| `useFixtureCommands.js` | Every act on a fitting that is not a pointer gesture, plus the diffuser allocator. |
| `useCobTool.js` | The manual downlight's live model: targets, snap, engine, stack, guide. |
| `useFixtureGestures.js` | The five `useDrag`s, the presses that place, and the canvas routers' fixture branches. |
| `fixtureRules.js` | **Pure.** The alignment targets, the two warnings, the chunk in force, the autoplace fill, the spec reconciliation, both drop rollbacks, both array bars, the fresh pick, the draft's quantum and the module's place on its rail. |

Nothing here imports `App.jsx`. The two cross-feature imports are
`useSceneFixtureProjections` and (through App) `useCeilingGeometry`'s public
`arrayOutline` and `lookup`, both documented adapters. The existing pure
libraries are used rather than reimplemented: `cob`, `magTrack`, `ceilingObjects`,
`ceilingShapes`, `lumens`, `planner`, `snapGuides`, `geometry`, `selection`,
`pressOwner`, and both `hooks/useDrag` and the scene's projections.

## What stayed in App, and why

- **The one armed tool.** `addTool`, `stripFrom`, `addAt`, `addSnap`,
  `addGhost`, `coveFrom` and `coveNote` are shared across three domains — the
  strip and the sconce are accent zones, the spot is a task surface, the drawn
  track is the geometry's, the reverse cove is its own — so the variable that
  says which is armed cannot belong to any one of them. `disarmAdd` is App's
  half plus two calls into this feature's `reset`, called where its statements
  stood. Same split `openShapeTool`/`geometryStandDown` already has.
- **`guides` and `overRoom`.** Five gestures publish the momentary alignment
  lines and only three are this feature's; the crosshair is maintained by the
  ceiling object, the COB, the strip, the sconce and the cove alike. Both
  setters are handed in.
- **`arrayStandDown`.** Opening an array's bar closes the zone editor, the door
  editor, the switchboard step, both geometry bars and whatever hand tool is
  armed. That is arbitration *between* features and App is the only place that
  knows all seven owners, so it is handed in and called on the line the block
  stood on.
- **`snapTargets` and `snapTol`.** Generic: the ceiling objects, the lights, the
  doors and the COB snap against the same targets, and it reads the geometry's
  `canvas.coveShapes`.
- **`sel` / `setSel`.** One register on this canvas.
- **`roomAt`, `insideAnyRoom`, `svgPoint`, `svgRef`, `pressState`.** All
  shared by five domains.
- **`spaceAnalysis`, `cobBasisFor`'s readers, the per-ceiling grouping, the BOQ,
  `analysisHighlight` and the reveal effect.** These are the counting and the
  panel, which read this domain's projections through the interface above and
  are not about a fitting's own behaviour.
- **The keydown handler's precedence**, including the nine Delete branches. Each
  one calls a command; the ORDER is arbitration between eleven machines.
- **The canvas and panel bindings**, including the pointer router's dispatch
  into the seven branch functions, `PlanCanvas`'s props, both `CobSpec` call
  sites, the `ToolRail`'s COB and module drawers, and the fan-sweep chips.
- **`resetForNewPlan`'s ordering**, which calls three reset members in place.
- **`optionPick`**, the ceiling-options pill, whose setter two commands call.

## Preserved behavior

- Every dependency array moved unchanged in membership. Where a body became a
  module import the array did not change: a module binding is stable for the
  life of the process, which is strictly more stable than the callback it
  replaced. Callbacks that gained a `useState` setter handed in rather than
  declared locally are not rebuilt on a render they were not rebuilt on before —
  a setter's identity is stable for the life of the component. Five stand-down
  lists and the keydown effect gained `setArmed`/`setGhost` and four more
  setters in their arrays because the scanner now asks for them; none is a fresh
  value.
- **Press slop** is unchanged and still differs per gesture: the light and the
  lamp and the array and the module keep the shared 3 px / 0.12 ft threshold, and
  the ceiling object still has `slopPx: 0` — selecting one is a press with a
  handle under it or Shift held, never a bare press that might have been a nudge.
- **Option-copy** still leaves the original behind and keeps the TWIN under the
  pointer, for the lamp and for the ceiling object, and the copy is what stays
  selected.
- **Orthogonal locking** still measures from the press anchor rather than the
  last frame, still re-decides the axis every frame, and the frozen axis still
  takes no snap and draws no guide.
- **Snap priority** is unchanged: the drag's lock is applied before the snap and
  not after, a row of lamps still aligns only to other placed lamps, a ceiling
  object still snaps to the walls, the room centres, the placed objects and the
  drawn geometry, and an array still snaps to nothing at all.
- **Invalid-drop rollback** is unchanged for both: a lamp dropped off every
  ceiling returns to its position at the press, and an array is refused only
  when NOT ONE of its lamps is inside a room — a ring on a room's own outline has
  lamps on the walls and keeps its ordinary position.
- **Read-only gates** are unchanged. The keydown listener is still not bound at
  all, the spec-reconciliation effect still returns early, and every canvas
  handler is still `readOnly ? null : …` at the `PlanCanvas` call site.
- **Selection replacement rules** are unchanged: Shift-click on a ceiling object
  builds the list and starts no drag, pressing a MEMBER drags the whole group,
  pressing anything else replaces the group, a handle is always singular, and a
  press on an array's lamp still resolves to the ARRAY rather than to the lamp.
- The three named press exemptions still stand exactly where they were: the
  module tool's press falls through to the canvas so the next module is placed,
  the COB tool stays armed on a stray click on the margin, and a module press
  anywhere but on a run places nothing and does not disarm.
- The COB run still owns one ceiling, the first lamp still chooses it and opens
  its space on the Spaces tab, the tick and the cross still act only on the ids
  placed since the tool was armed, and `cobStanding` still survives `disarmAdd`.
- A chunk somebody overruled still answers for its whole chunk; a lamp still on
  the rule is still not a decision; the autoplace toggle still takes back only
  what is still the toggle's; and a dragged or re-specified lamp is still adopted.
- No stored key, schema, timing constant, UI, copy, CSS or network payload
  changed. The wall clearance is still 2 ft, the count cap still 200, the array
  draft still opens at one lamp per corner `on` the line at a foot, and the
  slop is still 3 px or 0.12 ft.

**The things that moved rather than stayed**, all of them memos, callbacks or
effects with no gesture in them:

- The **scene's three fixture projections** now run at calls 2 and 4 instead of
  wherever they stood; nothing between the points reads them — checked by name —
  and they are pure memos.
- **`allocateOnTrack`** moved out of App entirely, into call 3, where it is
  handed to `useGeometryCommands` on the line it was handed on before. It stood
  directly above that call.
- The **spec-reconciliation effect** now runs at call 3's position instead of
  four hundred lines lower, so it commits its `replaceCobs` before the analysis
  reveal effect's `setFocusId` instead of after. The two touch disjoint document
  fields and neither reads the other's result.
- The **console line that explains the bar** moved from below `showTrace` to
  call 4, so it now runs before the `hadLights` effect instead of after. It only
  logs.
- The **array draft's bar** was an inline IIFE at the `CobSpec` call site and is
  a memo in call 2. It is a pure function of the draft, the outline and the
  scale, so this changes when it runs and not what it answers.
- One private helper was renamed: `clampCtxFor` is `clampContext` in
  `fixtureRules.js`. No stored key, prop or public name changed.

## Migration verification (2026-09-08)

Baseline: clean working tree at `c1a30bb`; App.jsx had **10,378 lines**.
After extraction: **8,853 lines**, a reduction of **1,525**.
No applicable filesystem `AGENTS.md` was found in this repository or its
ancestors. No commit was made.

| Check | Before | After |
| --- | --- | --- |
| Repository lint (`src api tools`) | 0 errors, 59 warnings | 0 errors, 58 warnings |
| `src/App.jsx` lint | 0 errors, 4 warnings | 0 errors, 3 warnings |
| `src/features/fixtures/` lint | — | 0 errors, 0 warnings |
| Production build | Pass, large-chunk warning | Pass, same warning |
| Every `tools/test-*.mjs` run independently | 57 pass, 8 fail | 57 pass, the same 8 fail |

The one warning that went is `'objType' is assigned a value but never used` at
the old `useState`: the same state is now returned from the session, so nothing
is unused. No warning was added.

The failing set is **identical** before and after: `test-vector-flow.mjs`,
`test-cad-export.mjs`, `test-roomtypes.mjs`, `test-ceiling.mjs`, `test-cove.mjs`,
`test-track.mjs`, `test-flows.mjs` and `test-bed-grid.mjs` (the last is not in
the `npm test` chain). All eight are pre-existing and none touches this domain.

New registered test — `tools/test-fixtures.mjs`, `node:assert` and one `node`
invocation like its neighbours; no framework or dependency was installed. 63
checks over `fixtureRules.js`: the light's key, the clamp context including the
room's own cove lines, the alignment targets with all three exclusion shapes and
the pointer-to-lamp span, both warnings under the pointer and all four ways they
answer nothing, the chunk in force including the `spec`-and-not-presence rule and
the other-room skip, the autoplace fill (one lamp per cell at the bounds' centre,
the chunk's own spec, a decided chunk's override, the occupied-cell skip, the
no-light-zone centre test, the clipped-cell case, the dark chunk, and all three
by-reference no-ops), the spec reconciliation (stale pulled back, a decision
never touched, convergence by reference, a lamp in no cell, an orphaned room, and
a decided chunk pulling its neighbours), both rollbacks (refused, kept, no prior
room, other ids, no snapshot, and the array's any-one-lamp leniency), both array
bars (null cases, quantised count, the geometry's steps, the pixels-to-feet
offset limit, the pre-offset plan), the fresh pick (one per corner, the
geometry's room winning, the carried side and distance, the re-asked count on a
new geometry), the draft's cap and free count, and the module's place on its rail
including the projection from mid-room and the no-overlap gap.

Two mechanical checks were also run against the pre-change file: every
identifier and every string literal present in the old `App.jsx` and absent from
the new one was confirmed present in the feature (comments stripped — the only
missing identifier is the renamed `clampCtxFor`, and the only missing literals
are two import paths whose relative depth changed), and a forward-reference scan
over every moved name found none read before its declaration.

These checks do not exercise browser pointer events, pointer capture, or the
canvas itself.

## Remaining in App that belongs to this domain

The one armed tool (`addTool` and its five gesture states), `guides` and
`overRoom`, `arrayStandDown`, `snapTargets`/`snapTol`, the selection register,
the six shared pointer and hit-test helpers, the counting and panel readers
(the per-ceiling grouping, `spaceAnalysis`, the BOQ, `analysisHighlight` and its
reveal effect), the keydown handler's precedence, the canvas and panel bindings,
`resetForNewPlan`'s ordering, and `optionPick`. No fitting derivation, no
placement or specification rule, no gesture state and no placing-session state
remains there.
