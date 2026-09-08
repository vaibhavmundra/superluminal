# Lighting planner

The high-level act this app exists for: taking a set of traced spaces and
LIGHTING them. What a space costs and who is asked, which passes run over it and
in what order, what the loading screen says while they do, what a room that
failed says about itself, what the finished thing adds up to per space and over
the plan, and what comes out the other end as a schedule somebody can order
against.

It is the last of the domains to come out of `App.jsx` and it is the one that
COORDINATES the others. `App` composes it with `usePlanDoc`, `usePlanScene`,
`features/recognition/`, `features/room-intelligence/`,
`features/ceiling-geometry/` and `features/fixtures/`; none of those changed,
and not one of them is reached into.

## What it takes from the other domains, and how

Every cross-domain input is a documented public entry, handed in by `App`:

- `features/recognition/` — `computeBedFit`, `refindBeds` and `absorbBedRows`
  off `usePlanRecognition`'s `commands` group, plus `bedSets`, the two whole-
  plan readings. The pipeline decides WHEN a bed question is worth asking; that
  feature decides what asking one means.
- `features/room-intelligence/` — `computeRoomType`, `computeAccents` and
  `computeSurfaces` off `useRoomIntelligence`'s `commands` group, and the pure
  `absorbContest` fold, which has no call in it and is why it is not in here.
- `features/scene/` — the projected accent runs and task surfaces
  (`useScenePlanProjections`) and the computed rooms (`usePlanScene`): polygons,
  ambient grids, chunk plans, cove reports.
- `features/fixtures/` — the projected tracks, modules and array lamps
  (`useFixtures`), and `autoplace.set` off `useFixtureCommands`, which is
  re-exposed here beside the per-space state that says which ceilings are
  switched on, because the control it sits under is this panel's.
- `features/ceiling-geometry/` — nothing directly. What a chunk's options ARE
  arrives on the room, off the layout, which is what makes flipping one a fact
  about the drawing rather than about the shape library.

Nothing here imports `App.jsx`, and nothing here touches another feature's
private files.

## The document

`usePlanDoc` remains the single persistent-document boundary. This feature
WRITES a great deal — bed verdicts, the merged detections, room types, accent
and surface results, both dismissal lists, the lit list, the dirty list, the
design picks and the per-row wattage overrides — and every one of those writes
goes through the `docActions` App hands in, into the store that already held it.
Its public state is not split, the saved schema did not change, and no part of
it is copied here.

Two things look like exceptions and are not:

- `bedsNow`, threaded through one run of the pipeline. A React `setState` is not
  visible until the next render and that async function does not get one, so the
  bed list has to be carried in a local while step 0 replaces it and step 2b
  adds to it. It is not a second copy of the store; it is the store's next value
  in flight, and the store is written from it.
- `prep`, the run's own progress screen, and `cancelPrep`, the stop flag. Both
  are transient by construction: what comes back next time is the DESIGN, and a
  progress dialog restored from a database would be a screen for work that is
  not happening.

## Three call sites, and why

The same split `features/fixtures/`, `features/ceiling-geometry/` and
`features/electrical/` make, forced by the same rule: a hook's arguments are
evaluated DURING RENDER, so nothing can be composed above a value it names.

1. **`useLightingRun()`** — near the top of `App`, because `stepTool` is. Half
   the controls on this editor carry `!prep`, and the first of those readers
   stands three hundred lines above the point where the workflow can be built.
   The state can move up to meet it; the controller cannot.
2. **`useLightingAnalysis({...})`** — between the fitting PROJECTIONS and the
   fitting COMMANDS, and it is pinned from both sides. It reads
   `tracks.modulesPx` and `arrays.lampsPx`, so it cannot stand higher;
   `useFixtureCommands` is handed its `spaceAnalysis`, which the diffuser
   allocator runs backwards, so it cannot stand lower.
3. **`useLightingPlanner({...})`** — where `runPipeline` stood, the highest
   point at which everything exists. It is handed the other two and returns the
   whole public interface, so there is one object App reads a lighting answer
   off whichever call computed it.

## Files

- `lightingRules.js` — **pure**, and the only part with a test. The plan's
  totals, the per-ceiling grouping, the selection-to-row translation, the
  trouble lines, `PREP_STEPS` and the run's step filter, the three checklist
  moves, the loader's shapes and the chunk-option rewrite. No React, no
  document, no pointer, no model call. See `tools/test-lighting-planner.mjs`.
- `useLightingRun.js` — the run's screen state and the stop flag (call site 1).
- `useLightingAnalysis.js` — the derivations and the schedule (call site 2).
- `useLightingClaims.js` — the till, and the two acts that put a drawing through
  it: `claimSpaces`, `lightWholePlan`, `lightOneRoom`.
- `usePlanPipeline.js` — the passes: the order, the bounded concurrency, the
  progress, the cancellation, the error aggregation, the dirty-room clearing and
  the milestone.
- `useLightingPlanner.js` — the public controller (call site 3).

## The invariants the pipeline is built around

**BEDS BEFORE THE LAYOUT.** A bed is a no-light zone, a zone changes where the
ambient lights go, and everything after that reads those light positions: the
accent pass is shown them so it does not put a sconce under a downlight, and the
task spots are placed on the grid they form. So the whole-plan bed contest runs
before `relight` marks anything lit — off the traced outlines, which is all it
needs — and the layout is then computed ONCE with the beds already in it. The
step filter cannot express any other order; `stepsWanted` is checked against
that.

**AND THE BEDROOM RE-CHECK BEFORE THE ROOM-DEPENDENT PASSES.** Step 2b exists
for one contradiction — the classifier called a space a bedroom and the
whole-plan pass put no bed in it — so it needs the classification above it and
the accents need its answer below it. It is also why `bedsNow` is threaded: the
accent pass runs in the same invocation and would otherwise get its sconces from
no bed at all.

**NOTHING ABORTS THE WHOLE RUN.** A room whose classification fails is an
`other` and gets no accent pass; a room whose accent call 502s is noted and
skipped. Failures are counted per pass and each step's own note admits how many
spaces it lost — see `withFails` — because a silent skip is how six rooms
quietly become four.

**PARTIAL RELIGHT.** `only` is a list of outline ids, or null for the sheet, and
three things read it: the claim (so a plan where one corner moved is charged for
one space), the work list (so the classifier, the accents and the surfaces
narrow together), and the whole-plan bed pass, which is SKIPPED because it
contests candidates across rooms and cannot be run for one. Every result is
MERGED rather than assigned — a replaced room-type map wipes eight rooms' types
on a partial run — the lit list is a UNION, and the dirty list is cleared only
for the ids the run was given, so a space somebody moved while it was running
stays marked and is still offered.

**THE CLAIM IS SAFE TO REPEAT.** It is keyed on each space's geometry (see
`fingerprintOutline` in `lib/plans.js`), so lighting one room and then the whole
plan charges the room once. `onClaimLayout` is null in the standalone editor, in
read-only mode and in every test, and everything degrades to what it did before
there was a meter — which is what lets the scripts in `tools/` light plans in
Node with no server anywhere.

**THE SCREEN GOES UP BEFORE THE GATE, AND COMES BACK DOWN ON A REFUSAL.** The
claim is a network round trip and painting nothing across it read as a click
that had not landed. No step is marked busy until the first real `paint()`, so
the checklist never claims work that has not started.

## Where the boundary with the UI runs

`boq.file(fmt)` prepares the download — the file name, the sheet title and the
encoded table — and does not perform it. Naming and encoding are facts about the
SCHEDULE; putting a blob in front of a person is a fact about a BROWSER, and it
is the thing the contact gate stands in front of. So `download` and
`gateExport` stay in App, on the other side of the line.

## The public interface

```
analysis: { totals, planLumens, spaceAnalysis, groupsFor, highlight,
            stripRuns, spotsPlaced, troubles }
pipeline: { prep, loaderRooms, run, stop }
boq:      { table, file }
commands: { claim, lightWholePlan, lightOneRoom, run, stop,
            setRowWatts, cycleChunkOption, setAutoplace }
status:   { running, autoplaceIn }
reset:    () => void
```
