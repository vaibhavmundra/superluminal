import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import PlanCanvas from './components/PlanCanvas.jsx';
import ChunkPicker from './components/ChunkPicker.jsx';
import OutlineTracer from './components/OutlineTracer.jsx';
import { UNITS } from './lib/dxf.js';
/* `regionFromOutline` AND `outlineStats` WENT WITH THE WORK THAT ASKED THEM —
   the whole-plan bed pass's per-room crop and the claim's area, both now in
   features/lighting-planner/. Nothing else in this file measures an outline. */
import { PLAN_OPTIONS,
         SIMPLIFY_ROOM_TO_RECTANGLE,
         /* `THROW_STYLE` WAS IMPORTED HERE — the accent ramp, handed to the
            chunking icon in the spaces list. The icon went with the accordion
            (see AUTO_GRID and the note in that list), and the ramp had no other
            reader in this file. */
       } from './lib/settings.js';
/* enumerateChunkings AND findChunking ARE GONE FROM THIS FILE. Both existed to
   run and resolve a second enumeration of the chunkings, on a different room
   from the one the drawing used — see the note in the rooms memo. There is one
   enumeration now and `designChunking` owns it. */
/* `nextChunkOption` WENT WITH THE ARROWS THAT CALL IT — see `chunkOptionPicks`
   in features/lighting-planner/lightingRules.js. */
import { COVE_GAP_FT } from './lib/cove.js';
import { useDrag } from './hooks/useDrag.js';
import useViewPrefs from './hooks/useViewPrefs.js';
import useScale from './hooks/useScale.js';
import usePlanSource from './hooks/usePlanSource.js';
import useOutlines from './hooks/useOutlines.js';
import usePlanScene from './features/scene/usePlanScene.js';
import { useSceneArchitecture, useSceneOutlines } from './features/scene/useSceneSource.js';
import { useScenePlanProjections } from './features/scene/useScenePlanProjections.js';
import usePlanRecognition from './features/recognition/usePlanRecognition.js';
import useRoomIntelligence from './features/room-intelligence/useRoomIntelligence.js';
import useRoomEditing from './features/room-intelligence/useRoomEditing.js';
/* THE BED CONTEST'S FOLD AND THE BOUNDED-CONCURRENCY RUNNER WENT WITH THE
   PIPELINE — `absorbContest` and `mapLimit` are both read in
   features/lighting-planner/usePlanPipeline.js and nowhere else here. */
import { newHistory, record, stepBack, stepForward, historyDepth,
         QUIET_MS } from './lib/undo.js';
import { NONE, select, clear, idOf } from './lib/selection.js';
import { pointInPolygon } from './lib/geometry.js';
import { openingPx, DOOR_WIDTHS } from './lib/doors.js';
import { download, toJSON, toSuperluminalDXF, svgToPNG } from './lib/exporters.js';
import { plotToPDF, nightBase } from './lib/pdfPlot.js';
import { LIGHT_TOOLS, GESTURE } from './components/LightPalette.jsx';
import { owns, canGrab } from './lib/pressOwner.js';
import { Logo } from './components/Wordmark.jsx';
import ShapeMenu from './components/ShapeMenu.jsx';
/* WHAT IS LEFT OF THE GEOMETRY LIBRARY IN THIS FILE. Everything that draws,
   spans, seals, offsets, hits or resizes a shape went to
   features/ceiling-geometry/ with the tool that calls it, and the three reads
   the diffuser allocator and the module press wanted went to
   features/fixtures/ with them. What is left is the shape bar's two labels,
   which are rendered here. */
import { maxRadiusFt, roundable,
         sizeLabel as shapeSizeLabel } from './lib/ceilingShapes.js';
import ProjectTypeDialog from './components/ProjectTypeDialog.jsx';
import PlanLoader from './components/PlanLoader.jsx';
import ViewerPanel from './components/ViewerPanel.jsx';
import BOQView from './components/BOQView.jsx';
/* THE SCHEDULE IS BUILT AND ENCODED IN features/lighting-planner/ — the
   catalogue, the table and the three formats. What is left in this file is the
   BOQView call site and the `download` that hands the file over. */
/* WHICH TYPES TAKE ACCENTS, WHICH TAKE SPOTS AND WHICH EXPECT A BED are read by
   the pipeline, in features/lighting-planner/, along with the project's own
   label. What this file still reads is the label of ONE space's type, which is
   markup. */
import { roomTypeIn } from './lib/roomTypes.js';
import FixtureTip from './components/FixtureTip.jsx';
import CobSpec from './components/CobSpec.jsx';
/* THE DOWNLIGHT SOMEBODY PUTS DOWN THEMSELVES. Every rule about one — what it
   may be specified at, what the gridding engine would have installed where the
   pointer is, and the two things worth warning about before the click — is in
   lib/cob.js, and features/fixtures/ does the placing. See its header.
   WHAT IS LEFT HERE IS WHAT THE MARKUP READS: the ring a lamp throws (drawn on
   the ceiling), the fallback drop, the wattage band the analysis prints, and
   the three the array bar's own controls are built from. */
import { throwDiameterFt, DEFAULT_DROP_FT, clampWatts,
         nearestBeam } from './lib/cob.js';
/* THE MAGNETIC TRACK. Its RUN is a ceiling shape with `role: 'track'` — which
   is why there is no store of paths here and why it resizes, duplicates and
   snaps like everything else in the geometry library — and the modules that
   clip into one are features/fixtures/. See its header for why it is not
   track.js. What is left here is the catalogue line a module bills under and
   the list of the ones not written yet, both of them markup. */
import { MODULE_SOON } from './lib/magTrack.js';
import OptionCoach from './components/OptionCoach.jsx';
/* The walkthrough, playing in the panel rather than linked out of it. Named
   export: the default one is the line of type that opens it in a dialog. */
import { HowToVideo } from './components/HowToLink.jsx';
import { chunkFor } from './lib/taskSpots.js';
/* WHAT IS LEFT OF THE BED CONTEST IN THIS FILE IS ONE SENTENCE ON THE ADMIN
   SHEET. The boxes in a room, the contest, the verdict and its fallback are the
   pipeline's — see features/lighting-planner/usePlanPipeline.js. */
import { judgeNote } from './lib/bedFit.js';
import { manualReverseCove } from './lib/reverseCove.js';
/* THE ROOM PASSES' OWN IMPORTS WENT WITH THEM to
   features/room-intelligence/ — the crop and the request, the furniture,
   surface and wall-feature tables, the 1ft grid, the render downscaler and the
   accent-run edits. RenderPassPanel is still not mounted (see the note in the
   Spaces list where it used to be) and its handlers are still intact; they are
   in useRenderPass.js now rather than in this file. */
import { placeZone, nearestWall, alongWallAt } from './lib/accentPlace.js';
/* THE PLATES AND THE WIRES ARE features/electrical/ — the three board passes,
   the outdoor feeds, the flows, the compositions, the schedule, both gestures
   and every command. What is left in this file is the blue of a plate, which is
   the panel's own chrome, and the list of what may be added to one, which is a
   row of buttons. See that feature's README. */
import { SB_COLOUR } from './lib/electrical.js';
import { addablePoints } from './lib/switchboards.js';
import useBoardStep from './features/electrical/useBoardStep.js';
import useElectrical from './features/electrical/useElectrical.js';
/* THE COVES, THE GUIDES, THE TRACK RUNS AND THE DRAWN TRACKS — one tool, one
   store of shapes and one pen apiece. Four call sites, and the feature's
   README says why each of them is where it is. */
/* THE FITTINGS THEMSELVES — the hand-placed downlights and their arrays, the
   modules clipped into a magnetic track, the things already on the ceiling, and
   the lights the grid put down that somebody nudged. Five call sites, and the
   feature's README says why each of them is where it is. It is built on the
   scene's projections and on the ceiling geometry's PUBLIC interface —
   `arrayOutline`, `lookup.at` and `lookup.forTool` — and on nothing else of
   either. */
import useFixtureState from './features/fixtures/useFixtureState.js';
import useFixtures from './features/fixtures/useFixtures.js';
import useFixtureCommands from './features/fixtures/useFixtureCommands.js';
import useCobTool from './features/fixtures/useCobTool.js';
import useFixtureGestures from './features/fixtures/useFixtureGestures.js';
import useGeometryState from './features/ceiling-geometry/useGeometryState.js';
import useCeilingGeometry from './features/ceiling-geometry/useCeilingGeometry.js';
import useGeometryCommands from './features/ceiling-geometry/useGeometryCommands.js';
import useGeometryGestures from './features/ceiling-geometry/useGeometryGestures.js';
/* --- THE HIGH-LEVEL LIGHTING WORKFLOW -------------------------------------
   THREE CALL SITES, and the reason for each is at the site: the run's own
   screen early, because half the controls on this editor carry `!prep`; what
   the plan adds up to between the fitting projections and the fitting commands,
   because one reads the first and the other is handed the second; and the
   workflow itself where the pipeline stood. See that feature's README. */
import useLightingRun from './features/lighting-planner/useLightingRun.js';
import useLightingAnalysis from './features/lighting-planner/useLightingAnalysis.js';
import useLightingPlanner from './features/lighting-planner/useLightingPlanner.js';
import SwitchboardCard from './components/SwitchboardCard.jsx';
import { HeightField } from './components/SwitchboardCard.jsx';
import SwitchboardSheet from './components/SwitchboardSheet.jsx';
/* THE THINGS ALREADY ON THE CEILING. Placing one, moving it, resizing it from
   a corner, rotating it and setting a fan's sweep are all features/fixtures/;
   what is read here is the label a palette prints, the sweep chips and the
   sweep the selected fan is at. */
import { CEILING_BY_ID,
         radiusFt, FAN_SWEEPS, sweepMm }
         from './lib/ceilingObjects.js';
import { collectTargets, SNAP_DEFAULTS } from './lib/snapGuides.js';
/* PICKING A THING UP, MOVING IT, AND LEAVING A COPY BEHIND — the four rules
   every draggable object on this canvas needs and each of which has been got
   wrong at least once here. Nothing in this file calls that arithmetic by hand
   any more: hooks/useDrag.js is where it is spent, and every drag here reaches
   it through that. Read the header of lib/dragMove.js for the rules themselves.
   The slop is imported directly by the one drag that departs from it by naming
   a floor — see useAccentEditing.js in features/room-intelligence/. */
import { buildSnapIndex, snapAt } from './lib/snap.js';
import { openPdf } from './lib/pdfPlan.js';
import PdfPagePicker from './components/PdfPagePicker.jsx';
import ToolRail from './components/ToolRail.jsx';
import SpaceDetail from './components/SpaceDetail.jsx';
import WallTonePopup from './components/WallTonePopup.jsx';
import { DEFAULT_CEILING_MM, CEILING_MM_MIN, CEILING_MM_MAX,
         materialsOf, wallMix, wallMixLabel, materialsSummary } from './lib/materials.js';
/* THE ILLUMINANCE MODEL, THE FAMILY TABLE AND THE FAMILY DEFAULTS are read in
   features/lighting-planner/, which is the only thing that counts what is on a
   ceiling or asks what that makes of a room. */
import {
  BTN, BTN_FULL, BTN_PRIMARY, BTN_EXIT, BTN_SECOND, BTN_MID, BTN_TINY,
  BTN_NUDGE, BTN_EXPORT, BTN_BOQ, N, NW, NE, NOTE, NOTE_WARN, CODE, PILL,
  PILL_OK, PILL_BAD, PILL_VIEW, PILL_RETRY, KV, KV_HEAD, KV_ADMIN, N_ADMIN,
  BTNROW, SEC, SEC_ADMIN, H3, H3_FLUSH, H3_ADMIN, DISCLOSE_ADMIN, CHECK, TABS,
  STEP, ROW_OFF, ROW_FLUSH, ROW_PICK, PROP_OFF, PROP_ON, PICK, NAME, META,
  RTYPE, PTAB, PTAB_ON,
} from './ui/tokens.js';
import { introSpace, coachOff, silenceCoach } from './lib/intro.js';


/* --- THE COB GESTURES THIS BUILD DOES NOT ANSWER FOR YET --------------------
   EMPTY NOW, AND KEPT. It held 'array' while that gesture was undecided — the
   cell was in the drawer because the drawer is what says this fitting has two
   gestures, and out of reach because a press that arms nothing is worse than a
   cell you can see is not ready yet. The array is built, so the entry goes and
   the list stays: the next gesture to be sketched before it is written has a
   place to sit. */
const COB_SOON = [];

// The editor knows nothing about Supabase — see routes/Planner.jsx. What it
// knows is how to turn its own state into one object and back again, and that
// contract lives in planState.js so the writer and the reader stay in step.
import { serialiseEditor, applyEditor, statsFrom, statusFrom, NOT_UNDOABLE, setterFor,
         LAYER_DEFAULTS }
  from './lib/planState.js';
import { usePlanDoc } from './hooks/usePlanDoc.js';


// WHAT THE SAVE PILL SAYS. Four words, and 'idle' says nothing at all — a bar
// that permanently reads "Saved" on a plan nobody has touched is noise, and it
// is also a claim about a write that never happened.
const SAVE_LABEL = { idle: '', dirty: 'Unsaved…', saving: 'Saving…', saved: 'Saved', error: 'Not saved' };

// THE UPLOAD IS REPORTED SEPARATELY FROM THE SAVE, because they fail
// independently and mean different things. The autosave protects the work — the
// outlines, the tweaks, the layout. The upload protects the DRAWING, and only
// matters for reopening the plan later. A drawing still going up while the work
// is safely saved is a normal state, and one pill saying "Saving…" over both
// would make it unreadable.
const UPLOAD_LABEL = { creating: 'Preparing…', uploading: 'Uploading drawing…', done: '', error: 'Drawing not uploaded' };

const ftin = (v) => {
  const f = Math.floor(v), i = Math.round((v - f) * 12);
  return i === 12 ? `${f + 1}'0"` : `${f}'${i}"`;
};

/**
 * THE EDITOR. It was the whole app; it is now one route of five, and the props
 * are the entire difference.
 *
 * Every one of them is optional, and that is on purpose: with none of them this
 * component is exactly the standalone drop-a-file editor it has always been,
 * which is what keeps it testable and what keeps the storage layer from growing
 * roots into three thousand lines of geometry.
 *
 *   initialPdfPage        which page of a PDF to open, when reopening a saved
 *                         plan that was made from one. Without it a drawing set
 *                         would ask again on every open.
 *   initialProjectType    the CATEGORY, answered once at the project level. When
 *                         it is set the plan-level dialog never appears — see
 *                         NewProjectDialog. Null falls back to asking.
 *   planName / onRename   the name in the top-left, and where an edit to it goes
 *   planId                THIS PLAN'S IDENTITY, AND ONLY AS A KEY. Nothing here
 *                         looks it up, sends it anywhere or shows it: it names
 *                         the one preference this editor keeps in the browser
 *                         rather than in the saved state — whether the options
 *                         card has been switched off for this plan. Null in the
 *                         standalone editor and in every test, where nothing is
 *                         remembered and the card simply shows.
 *   initialFile           a File to open on mount instead of showing the drop zone
 *   restore               a saved editor_state to put back once the file is read
 *   onPersist             called with the full state whenever it changes; the
 *                         route debounces (this component does not know or care)
 *   onMilestone           called when something has actually been achieved, which
 *                         is when a snapshot and a revision row are worth writing
 *   onBack                ← Back to Projects
 *   isAdmin               role 1 in `profiles`: an owner of this app rather than
 *                         a user of it. Unlocks the audit overlays — see the
 *                         admin section at the foot of the panel.
 *   saveState             so the bar can say 'Saved' without owning the truth
 */
/**
 * WHAT THE LAYOUT SCREEN DRAWS.
 *
 * `region` — the traced space outline — is OFF. It is the one layer here that is
 * scaffolding rather than deliverable: it says where the boundary the user drew
 * is, which is the question of the TRACER screen and a settled fact by the time
 * fittings are being placed. On a plan with eight spaces it is eight heavy
 * closed curves laid over the drawing the fittings have to be read against.
 * Still a checkbox, because checking that a fitting sits inside its own space is
 * a real thing to want to do.
 *
 * The cost, and it is small: `focusId` is used in exactly one place — drawing
 * the focused space's outline heavier — so with this off, focus is not shown on
 * the canvas at all. Survivable because focus is ASSIGNED rather than chosen (it
 * falls back to the first room when nothing is picked), so it was never a
 * reliable signal of intent, and the panel already names the space it is editing.
 *
 * MODULE SCOPE so that restoring a saved plan can merge over it. A saved `ui
 * .layers` used to REPLACE this wholesale, which meant every layer added after a
 * plan was saved came back `undefined` — falsy, so off — on every existing plan,
 * with nothing to say why one drawing was missing a whole category of fitting.
 */
// NO `wallitems` HERE ANY MORE. The render pass's grid cells were a public
// layer and are now part of the admin overlay — see the canvas prop below and
// the note in PlanCanvas. A key left in this object would come back true on
// every saved plan and turn on nothing, which is the failure the comment above
// is about, in the other direction.
/* THE LAYER DEFAULTS MOVED TO lib/planState.js, and they had to: the document
   reducer needs them for the value a fresh plan starts at, `applyEditor` MERGES
   a saved plan's answer over them rather than assigning, and the test's fixture
   has to agree with both. Three readers and one copy — see LAYER_DEFAULTS
   there, which carries the note on the looping and on the inversion. */

export default function App({
  planName = null, planId = null, initialFile = null, restore = null, saveState = 'idle',
  initialProjectType = null, initialPdfPage = null, uploadState = null, isAdmin = false,
  onRename = null, onPersist = null, onMilestone = null, onBack = null,
  onRetryUpload = null,
  /* WHERE THE BUILDING IS — an ISO code, a country name, or nothing.
     THE ONE THING IT DECIDES IS WHAT A SWITCHBOARD IS MADE OF: modules or
     gangs, which switch ratings exist, how wide a socket is, and which frames
     you can actually order. See src/lib/switchboards.js, which holds the
     registry and is deliberately forgiving about what arrives here.
     NULL IN THE STANDALONE EDITOR AND IN EVERY TEST, and the registry reads
     that as India — which is the answer the brief asked for and, more to the
     point, is an answer rather than an empty plate. */
  country = null,
  // WHERE THE RENDERS LIVE, and the only storage this component is given.
  // `{ put(blob, { roomId, index }) -> path, url(path) -> href }`, supplied by
  // routes/Planner.jsx. Null in the standalone editor and in the tests, and
  // everything below degrades to what it did before: the pass still runs, the
  // views just do not come back next time.
  renderStore = null,
  // ---------------------------------------------------------------------
  // THE TILL, AND IT IS THREE FUNCTIONS RATHER THAN A CLIENT.
  //
  // Same contract as `renderStore` above and for the same reason: this component
  // is a pure editor over a File and it does not learn what a subscription is.
  // It knows only that lighting a space has to be CLAIMED first, that a claim
  // can come back refused, and that a refused claim means do nothing. Who
  // decides, where the balance lives, and what the user is shown instead are all
  // routes/Planner.jsx's business.
  //
  //   onClaimLayout({ spaces }) -> { ok }   spaces = [{id, points, pxPerFt, sqft}]
  //   onClaimPass({ roomId, runId }) -> { ok, fingerprint }
  //   onReleasePass(fingerprint)            a pass that was charged and failed
  //
  // NULL IN THE STANDALONE EDITOR, IN READ-ONLY MODE AND IN EVERY TEST, and
  // everything below degrades to exactly what it did before there was a meter:
  // `claimSpaces` returns true and the pipeline runs. That is deliberate — the
  // twenty-five scripts in tools/ light plans in Node with no server anywhere,
  // and a gate that failed closed would break all of them.
  //
  // A CLAIM MUST NEVER THROW. Planner's implementations catch their own network
  // failures and report them; a rejected promise here would land in the middle
  // of a click handler that has already set four pieces of state.
  onClaimLayout = null,
  onClaimPass = null,
  onReleasePass = null,
  // ---------------------------------------------------------------------
  // SHARING — A CALLBACK, AND NOT A DIALOG.
  //
  // This component does not know Supabase exists (see the header of
  // routes/Planner.jsx) and sharing is entirely a database act: a row per
  // invitee, a token per link, and RLS policies deciding what either one buys.
  // Importing the dialog here would put all of that one import away from an
  // 8,000-line editor that has stayed a pure function of a File.
  //
  // So the editor owns the BUTTON — it is a piece of this panel's chrome and it
  // has to sit where the panel says it sits — and the route owns everything
  // behind it. Null in the standalone editor and in every test, where the
  // button simply is not drawn, which is also what makes it absent on the
  // read-only sheet without a second guard: no route passes it there.
  onShare = null,
  // ---------------------------------------------------------------------
  // A GATE IN FRONT OF EVERY EXPORT, and like `onShare` it is a callback rather
  // than a dialog, for the same reason: what it asks for lives on the user's
  // `profiles` row, and this component does not know Supabase exists.
  //
  // ASYNC, AND FALSE MEANS DO NOTHING. It resolves true when the export may go
  // ahead and false when the person closed the question — see useContactGate in
  // components/ContactGate.jsx. Every export handler below awaits it first and
  // returns on false; the drawing is untouched either way, so a cancelled export
  // is a click that did nothing rather than a state to unwind.
  //
  // IT NEVER BLOCKS ON ITS OWN FAILURE. A gate that throws — a dead session, a
  // column that is not there yet — must not take the download with it: the user
  // asked for a file they are entitled to, and losing it to a lead-capture form
  // that broke is the worst possible trade. `gateExport` below swallows and
  // proceeds, deliberately.
  //
  // NULL IN THE STANDALONE EDITOR, IN THE ADMIN VIEWER AND IN EVERY TEST, where
  // there is nobody to ask and every export runs as it always did.
  onBeforeExport = null,
  // ---------------------------------------------------------------------
  // READ-ONLY MODE — the viewer an admin gets on somebody else's plan.
  //
  // ONE PROP, AND IT WAS THE RIGHT UNIT OF CHANGE. The alternative was a
  // second component that re-derived the drawing from `design_json`: a
  // parallel PlanCanvas call site, a parallel BOQ, a parallel set of memos
  // over the same geometry. Two renderers of one drawing drift within a
  // month, and the ONE thing this viewer must guarantee is that what the
  // operator sees is what the user sees. So it is this component, with the
  // writes taken out.
  //
  // WHAT IT TURNS OFF, all of it below and each marked `readOnly`:
  //   · the three detectors, which would spend model calls on a stored plan
  //   · the mutating keyboard shortcuts (Delete, Escape-to-disarm)
  //   · the tracer and the chunk picker, both of which exist to edit
  //   · rename, and the project-type dialog
  //   · every interaction handler on the canvas except hover
  //   · the entire editing panel, replaced by ViewerPanel
  //
  // WHAT IT DELIBERATELY LEAVES ON: pan, zoom, layer switches, the fixture
  // tooltip, the BOQ tab and every export. None of them write, and without
  // them this is a screenshot rather than a viewer.
  //
  // THE AUTOSAVE NEEDS NO GUARD. The route simply does not pass onPersist or
  // onMilestone, and both are already `if (!onPersist) return;` at the top.
  // Belt and braces would be a third check that hides the real contract.
  // ---------------------------------------------------------------------
  readOnly = false,
} = {}) {
  // Outlines traced over the drawing, in RAW DRAWING UNITS — see toDu/fromDu in
  // planSource. Several per drawing; one is lit at a time. This is the shape a
  // whole-floor version needs: one layout per outline id.
  // The outlines and the tracer's highlight are in the document reducer — see
  // the domain-6b block in hooks/usePlanDoc.js.
  // THE WHOLE PLAN IS LIT AT ONCE. This was one id, and it being one id was an
  // artefact of an outline having been something you traced by hand: tracing
  // four rooms to light one of them is work nobody would do, so the app only
  // ever had one. Now that the rooms arrive together from the detector, they
  // are lit together — one layout per outline, all on screen, one export.
  /* --- GOING BACK TO THE OUTLINES NO LONGER THROWS THE LAYOUT AWAY ---------
     `step` USED TO BE DERIVED FROM `litIds` ALONE, and that one line was the
     whole reason the Outlines tab had to ask "are you sure". There was no screen
     flag, so the only way to show the tracer was to empty the lit list — which
     is the input every downstream memo reads, so the grids, the fittings and the
     schedule all went with it, and coming back meant paying to have every space
     on the sheet re-run.

     THIS IS THAT MISSING FLAG. It says "the user asked to see the outlines",
     nothing more; `litIds` is left exactly as it was, so `rooms` still holds
     every room and one click on the Design tab puts them back on screen
     untouched.

     AND MOST OF WHAT A RELIGHT USED TO REBUILD REBUILDS ITSELF. `rooms` is a
     memo over the lit outlines: drag a corner and that room's ambient grid is
     recomputed on the spot, for free, because it was never stored. What a
     relight actually buys is the MODEL's answers — what kind of room this is,
     where the accents go, which surfaces are worked at — and those are the only
     things a geometry change can make stale. Which is why the next flag exists. */
  const [outlinesOpen, setOutlinesOpen] = useState(false);
  /* --- WHICH OUTLINES HAVE MOVED SINCE THEY WERE LIT -----------------------
     The pricing page has promised this in so many words for as long as it has
     existed — "you drag the corners on that one and re-light: the nine are
     already paid for and only the room whose geometry actually changed is
     charged again" — and nothing implemented it. A relight claimed and re-ran
     every space on the sheet.

     A ROOM IS IN HERE WHEN ITS GEOMETRY MOVED AND IT IS ALREADY LIT. Both halves
     matter. Geometry, not identity: a rename cannot change what the classifier
     would say, so `updateOutline` marks this only when `rectify` is in the patch
     and `editPoints` marks it on every corner move. And already lit, because an
     outline that has never been lit is not CHANGED, it is simply pending — the
     tracer counts those separately and neither list needs to know about the
     other.

     IT IS SERIALISED (see planState.js). The marks are the difference between
     "relight three spaces" and "relight eleven", so losing them on a reload
     would quietly put the bill back up. */
  /* THE OPEN SPACE'S ROW, SO THE PANEL CAN SCROLL TO IT. The list has no box
     of its own any more — see the note at it — but the panel column is still a
     scroller, and the room that gets opened is very often one the canvas was
     clicked on rather than one the panel was scrolled to. Without this, picking
     the ninth space of twelve highlights a row nobody can see and reveals a
     workspace below the fold. */
  /* `openRowRef` AND THE EFFECT THAT SCROLLED TO IT WERE HERE. A row no longer
     opens INTO the list — picking a space replaces the list with the space (see
     SpaceDetail) — so there is nothing below the fold to bring into view, and
     the detail arrives at the top of a fresh column by construction. */

  /* --- WHAT EACH SPACE IS, BEFORE ANYTHING IS PUT IN IT ---------------------
     TWO MAPS, BOTH KEYED BY ROOM, AND BOTH SPARSE. A room with no entry is a
     room at the defaults — 2700 to the slab and light on all three surfaces —
     so a plan where nobody touched the materials stores nothing at all, and a
     space added tomorrow arrives at the same defaults as the ones added today.
     PER SPACE AND NOT PER PLAN, which is the whole reason `ceilingFt` above is
     not simply reused. A flat has a 2700 bedroom and a 3600 double-height
     living room in the same drawing, and the level in each is worked out
     against ITS OWN height. `ceilingFt` stays what it always was: the figure
     the accent pass quotes to a model, one per plan.
     MILLIMETRES BECAUSE THAT IS WHAT IT IS SPECIFIED IN. Every other length in
     this file is feet — it is the unit the geometry works in — and a ceiling
     height is the one dimension on an Indian drawing that is always written in
     mm. Converting it for storage would mean 2700 coming back as 2699.9.
     THE WALLS ARE INSIDE `materials` AND KEYED BY EDGE INDEX. See materials.js:
     one entry per edge of the room's outline, absent meaning light. */
  /* --- THE PLAN DOCUMENT ----------------------------------------------------
     ONE REDUCER FOR THE STATE THAT IS THE SAVED PLAN, and the three sparse
     per-room maps are the first fields in it — see hooks/usePlanDoc.js for what
     belongs in there and, more importantly, what must not.

     THE READS DO NOT CHANGE. `ceilingMm`, `materials` and `fixtureWatts` are
     destructured straight back out, so the hundred-odd places that read them go
     on saying exactly what they said; only the WRITES moved, and they moved into
     one typed action each. Same shape of change as `sel` and lib/selection.js. */
  /* THE ONE FIELD SEEDED FROM A PROP. `projectType` — the kind of BUILDING —
     is answered once at the PROJECT level, so a plan added to a project already
     classified as a hotel arrives classified. Read once, on the first render,
     which is exactly the lifetime `useState(initialProjectType ?? null)` had;
     `resetForNewPlan` is what re-applies it on every file load. */
  const [doc, docActions, docSetters] = usePlanDoc({
    projectType: initialProjectType ?? null,
  });
  const { ceilingMm, materials, fixtureWatts,
          manualCoves, manualTracks, manualCobs, cobArrays, trackFixtures, autoSpots,
          ceilingShapes, designPicks, ceilingKinds, chunkPicks,
          accentResults, accentDismissed, manualAccents,
          surfaceResults, surfaceDismissed, manualSurfaces, artDismissed,
          wallResults, runTrims, runsOff, doors, zones,
          /* THE NINE ELECTRICAL STORES ARE READ INSIDE features/electrical/,
             off the same `doc` this destructures — they are still the
             document's and nothing keeps a copy. See that feature's README. */
          doorPick,
          roomTypes,
          detections, dismissed, bedVerdicts,
          ceilingObjs, lightMoves, renderRefs } = doc;
  /* THE ALIAS IS DELIBERATE AND IT IS THE ONE IN THIS FILE WORTH KEEPING.
     `projectId` is what a hundred reads below call the kind of BUILDING, and it
     is the one thing it is not — the database project's id never enters this
     component. The document calls it `projectType`, which is also what
     planState.js writes; the rename is here, once, rather than at every read. */
  const { projectType: projectId } = doc;

  /* WHAT WATTAGE EACH FITTING IS IN THIS SPACE — room id -> row key -> watts.
     Sparse like the two above: a row with no entry is at its family's default
     (see FIXTURE_FAMILIES in lib/lumens.js).
     PER ROOM AND NOT PER PLAN, because it is a design decision and not a product
     standard: the cove in a bedroom is often 5 W/m where the one over a dining
     table is 11, and a single figure for the drawing would make the two
     impossible to state. A project-wide default belongs in lumens.js, which is
     where it already is.
     AND PER ROW, WHICH IS PER RUN FOR ANYTHING LINEAR. A length of tape is a
     thing you point at and specify on its own — a room's perimeter cove and the
     drop over the bed are two runs at two wattages — so each is keyed by its own
     id. Twelve COBs are one decision about COBs and share one entry; a wattage
     per COB would be twelve rows in the panel saying the same thing, and eleven
     chances for two of them to disagree. See `fixtureGroups` in
     features/lighting-planner/lightingRules.js.
     IN THE DOCUMENT REDUCER, with `ceilingMm` and `materials` above. */

  /* --- THE DERIVED RUNS SOMEBODY THREW AWAY --------------------------------
     IN THE DOCUMENT REDUCER, with the two dismissal lists it sits beside — see
     `runsOff` in hooks/usePlanDoc.js for why it is a list of its own rather than
     an entry in `accentDismissed`, which is where it used to go and is why
     Delete on a reverse cove did nothing at all. Written through `dropRun`. */

  const [busy, setBusy] = useState('');

  // --- things already on the ceiling ---------------------------------------
  // IN THE DOCUMENT REDUCER as `ceilingObjs`, and the type armed, the sweep the
  // next one gets, the editing context and the drag in flight are all
  // features/fixtures/. See useFixtureState.js, which carries this store's note.
  /* --- WHAT IS PICKED ON THIS CANVAS, AND IT IS ONE VALUE -------------------
     ONE SELECTION HERE IS A RULE AND IT IS NOW STRUCTURAL. Eleven pieces of
     useState held it and every handler that picked one was answerable for
     putting the other ten away by hand; the register cannot hold two, so there
     is nowhere for a second contextual bar to come from. See lib/selection.js.

     THE OLD NAMES ARE DERIVED AND STAY DERIVED, each one beside the note that
     says why that thing is its own selection rather than filed under another.
     A hundred read sites and fifteen component props go on saying what they
     always said; only the WRITES moved. */
  const [sel, setSel] = useState(NONE);

  /* --- THE FITTING SESSION, AND IT IS HERE BECAUSE `pressState` IS ---------
     THE FEATURE'S FIRST CALL SITE. `armed` — the ceiling-object one-shot — is
     one of the seven machines in the arbitration table built three hundred
     lines below, and four of this session's resets are called by
     `resetForNewPlan` below that; a hook's arguments are evaluated during
     render, so the session is asked for on its own, here, and the rest of the
     domain is composed four times more further down. Same split
     `useGeometryState` and `useBoardStep` make. See its README.

     THE SELECTION REGISTER IS THIS FILE'S AND IS HANDED IN. There is one on
     this canvas and six of its kinds are that feature's, so the READS moved and
     the register did not — the same split `selShapeId` makes for the geometry.

     EVERY PIECE OF IT IS TRANSIENT. The fittings are the document's and stay
     there; what is here is which drawer is open, which gesture is armed, the
     specification the next click will use, which ceiling the run in progress
     belongs to, and the five drags in flight. */
  const fixtureState = useFixtureState({ sel, setSel });
  /* THE NAMES THIS FILE ALREADY USED. Taken off the session rather than reached
     through it, for the reason the geometry's four setters are: several of them
     are named by the keydown effect's dependency array, and `fixtureState` is a
     fresh object every render, so naming IT there would re-bind the window
     listener on every frame. See the note at the foot of usePen. */
  const {
    selObjIds, selObjId, objDrag, objMode, setObjMode,
    armed, setArmed, ghost, setGhost,
    selCobId, selArrayId, selModuleId, selLightId,
    cobOpen, setCobOpen, cobMode, setCobMode,
    cobDraft, setCobDraft, cobOnce, setCobOnce, cobStanding, setCobStanding,
    cobRun, cobLock,
    arrayDrag, trackMode, setTrackMode, moduleDrag, lightDrag,
    fanSweepMm, setObjType,
    /* THE FOUR RESETS. `resetForNewPlan` calls three of them and `disarmAdd`
       the other two, each where the statements they replace stood, so the
       reducer sees the same dispatches in the same order. Memoised — see the
       note on the session's own `reset`. */
    reset: fixtureReset,
  } = fixtureState;

  // What the pointer is over on the canvas, and where the pointer was when it
  // got there. Null when it is over nothing.
  const [tip, setTip] = useState(null);
  /**
   * ADDITIONAL LIGHTING: one armed tool, three gestures.
   *
   * `addTool` is the same one-shot idea as `armed` for ceiling objects — pick a
   * fitting, make the gesture, and the tool returns to the pointer. It is a
   * separate piece of state rather than a fourth value of `armed` because the
   * gestures are different shapes: a ceiling object is one click, a sconce is
   * one click, a strip is two, and a spot is a drag. One variable holding four
   * gestures is a switch statement in every handler on the canvas.
   *
   * WHAT THE THREE TOOLS PRODUCE IS NOT A FOURTH KIND OF THING. A hand-placed
   * strip is an accent zone, identical in shape to one the accent detector
   * proposes; a hand-drawn spot zone is a task surface, and the spot on it is
   * placed by the same secondary-grid code that places every other spot. That
   * is the whole design: the tools are another SOURCE for the two collections
   * that already exist, so the canvas, the BOQ, the exports and the editing
   * handles all work on them without knowing where they came from.
   */
  const [addTool, setAddTool] = useState(null);      // 'strip' | 'sconce' | 'spot' | null
  const [stripFrom, setStripFrom] = useState(null);  // the strip's first click
  const [addAt, setAddAt] = useState(null);          // the cursor, for the rubber band
  const [addSnap, setAddSnap] = useState(null);      // what the cursor caught on
  const [addGhost, setAddGhost] = useState(null);    // the sconce, before it is placed
  /* THE COVE BEING DRAGGED, and the ones that got finished.
     `coveFrom` is where the press landed plus THE WALL IT LANDED ON — both
     endpoints and the inward normal, resolved once at the press and then never
     asked again. That is what makes the far end stick: the pointer is projected
     onto this stored wall rather than re-tested against the polygon, so pulling
     out into the room slides the end ALONG the wall instead of hopping to
     whichever wall happens to be nearest now. Re-resolving per frame is the
     obvious implementation and it is the wrong one — a slot would jump walls
     mid-drag.
     IT LIVES ONLY FOR THE LENGTH OF ONE DRAG. It used to survive between two
     clicks, which is what made it possible to be holding half a cove while
     doing something else entirely. */
  const [coveFrom, setCoveFrom] = useState(null);
  // IN THE DOCUMENT REDUCER — see hooks/usePlanDoc.js.
  /* Why a press or a drag was refused, said where the gesture is rather than in
     a banner. Only ever set by the cove tool, and cleared by the next thing that
     happens. */
  const [coveNote, setCoveNote] = useState('');
  /* --- TRACKS SOMEBODY DREW --------------------------------------------------
     A LIST OF PATHS IN PLAN FEET, and the same kind of state `manualCoves` is:
     a real object of a real size, held in feet so that correcting the scale
     underneath it does not resize it.

     PLAN FEET AND NOT THE ROOM'S. A track is clicked out over the drawing and
     nothing about the gesture knows or cares which space it crosses; the room
     is worked out afterwards, once, where the absorption happens — see the
     drawn-track pass in the layout memo. Storing room-local points would have
     meant deciding which room owned a path at the moment it was drawn, and a
     path that runs from a bedroom into its dressing has no answer to give. */
  // IN THE DOCUMENT REDUCER, with the coves.
  /* EDITING A DRAWN TRACK'S POINTS — which path is open, which of its points
     is picked and the grip in flight are the geometry session's, three states
     with three lifetimes. See features/ceiling-geometry/useGeometryState.js. */
  /* THE ACCENTS AND TASK SURFACES PLACED BY HAND. In the document reducer with
     the two passes they sit beside — see hooks/usePlanDoc.js. Written through
     `addAccent` / `addSurface` and their removals. */

  /* --- RECESSED COBs SOMEBODY PUT DOWN THEMSELVES ----------------------------
     A FLAT LIST IN PLAN FEET, kept for the reason `manualCoves` and
     `manualTracks` are kept and not for the reason `lightMoves` is. Those two
     are fittings with no generator behind them: nothing re-derives a run
     somebody clicked out, so the geometry IS the record. `lightMoves` is the
     opposite — an offset from a layout that gets recomputed on every open — and
     a hand-placed COB is not that. It does not belong to a cell, it did not come
     out of a solver, and re-running the layout must not be able to move it or
     take it away. So it is stored whole.

     FEET AND NOT PIXELS, which is the newer of the two habits in this file and
     the right one: a plan reopened after its scale has been corrected has its
     lamps where they were SET OUT rather than where they happened to fall on
     screen. (`manualAccents` predates that and is still in pixels.)

     AND EACH ONE CARRIES ITS OWN WATTAGE AND OPTIC. Everything the engine places
     is bought off the catalogue and the room holds one decision per family — see
     `fixtureWatts` — because the engine made that decision once for all of them.
     A lamp placed by hand was specified as it was placed, which is what the card
     on the drawing is for, so the specification rides on the fitting. That is
     also what makes the analysis panel give each one a row of its own. */
  // IN THE DOCUMENT REDUCER, with the coves and the tracks.
  /* WHICH ONE IS PICKED, THE DRAWER, THE THREE SPECIFICATION SLOTS, THE RUN IN
     PROGRESS AND THE DRAG IN FLIGHT are all features/fixtures/ — see
     useFixtureState.js, which carries every one of their notes. */

  /* --- WHICH SPACES ARE FILLING THEIR OWN GRID -------------------------------
     A SET OF OUTLINE IDS, and it is SAVED, unlike the rest of the COB state.
     That is a gesture in flight; this is a decision about a ceiling — "this
     space's grid is laid out automatically" — and a plan reopened without it
     would come back with the lamps gone and nothing to say why they went.
     WHAT IT SWITCHES IS A PLACER AND NOT A LAYER. The lamps it puts down are
     real entries in `manualCobs`: they draw, they count, they can be dragged,
     re-specified and deleted one at a time, and once one of them has been
     touched it stops being the toggle's to take away. See `autoplaceCobs`.
     IN THE DOCUMENT REDUCER, with `manualCobs` — one gesture writes both.

     --- LAMPS SET OUT ON A GEOMETRY -------------------------------------------
     WHAT IS STORED IS THE INSTRUCTION, NOT THE LAMPS. Each entry names a
     geometry, how many lamps go on it, which side of it they sit and how far
     off — and the positions are worked out from that every time. That is the
     whole reason a geometry is a first-class thing: the same rectangle is the
     cove's setting-out line and the ring a run of spots is arranged a foot
     inside, and storing the twelve points it currently works out to would mean
     dragging the rectangle moved the cove and left the lamps behind.

     ONE SPECIFICATION FOR THE WHOLE ARRAY, which is what makes it one row in the
     Analysis: twelve lamps on one ring are one decision, and changing the
     wattage there changes all twelve because there is only one figure to change.

     `geomId` IS A SHAPE'S ID, OR `room:<outlineId>` FOR A ROOM'S OWN OUTLINE.
     One field rather than a shape id beside a room id and a flag saying which,
     because every reader wants the same thing from it — a path — and a prefix is
     the cheapest way to say which list to look in. See `arrayOutline`.
     IN THE DOCUMENT REDUCER.

     --- THE MODULES CLIPPED INTO A MAGNETIC TRACK ----------------------------
     THE RUN IS NOT IN HERE, AND THAT IS THE WHOLE DESIGN. A magnetic track is a
     ceiling shape with `role: 'track'` — one entry in `ceilingShapes` beside the
     coves and the guides — so it draws with every primitive the shape bar has,
     it resizes by its grips, it duplicates by its own button, it snaps, it drags
     and it saves, none of which is written by the module domain. See the header
     of lib/magTrack.js for the argument at length.

     WHAT IS IN THERE IS WHERE EACH MODULE SITS ON ITS RUN, and it is a FRACTION
     of the path rather than a distance along it. That trade is stated in
     `clampU`: the run came out of the geometry library and is routinely resized
     and copied onto a room of another size, and a module stored in feet falls
     off the end of a run somebody shortened. Stored as a fraction the
     arrangement survives the edit.

     ONE FLAT LIST KEYED BY `trackId` rather than a list per track, for the
     reason `manualCobs` is flat: every reader wants "the modules on this run",
     which is a filter, and a map of arrays is a second structure to keep in step
     with a store of shapes that can be deleted from anywhere.

     SAVED, because it is a decision somebody made about a drawing and nothing
     re-derives it. IN THE DOCUMENT REDUCER.

     THE DRAFT ARRAY, THE ARRAY THAT IS OPEN, THE ARRAY BEING CARRIED, THE ARMED
     MODULE, THE MODULE BEING SLID AND THE POINT THE COB BAR IS ANSWERING FOR are
     all the fitting session's — see features/fixtures/useFixtureState.js, which
     carries every one of their notes.

     THE GEOMETRY UNDER THE POINTER, WHILE SOMETHING CAN TAKE IT — one piece of
     state for three cues, and it is the geometry session's. The COB array and
     the module tool drive it from their own move branches; see
     features/ceiling-geometry/useGeometryState.js for what it is. */

  /* --- COVES SOMEBODY DREW ---------------------------------------------------
     A LIST OF SHAPES IN PLAN FEET, in the document reducer. The gesture that
     draws one — the armed primitive, the span, both pens, the held draft and
     the borrowed outline being offset — is the geometry session's, and so are
     the grips and the drag. See features/ceiling-geometry/. */
  /* --- LIGHTS SOMEBODY MOVED BY HAND ----------------------------------------
     outline id -> cell key -> { dx, dy }, in FEET from that cell's own centre.
     An OVERRIDE STORE, and it is the same kind of state `boardMoves`,
     `runTrims` and `flowBends` are, for the same reason: the thing being
     overridden is DERIVED. The layout is a memo — `planLights` runs again on
     every change to the room, the fans, the ceiling or the settings — so a
     position cannot be stored on a light. Lights are not kept anywhere.

     KEYED BY THE CELL'S GEOMETRY, never by a light's id. `S7` is an index into
     an array built fresh each time, so it names a different lamp the moment
     anything moves; the cell's rectangle names a piece of ceiling. See
     `cellKey` in planner.js — a cell that is still there keeps its hand
     position, and one the grid no longer produces loses it, which is the
     behaviour that stops a re-cut grid inheriting somebody's nudges.

     AN OFFSET AND NOT A POSITION, because the centre band is measured from the
     cell centre: "a foot right of centre" stays legal if the cell shifts a
     hair, where a pair of absolute coordinates could quietly fall outside the
     band that admitted them.
     WHICH ONE IS PICKED AND THE SLIDE IN FLIGHT are the fitting session's; the
     store itself is in the document reducer. */
  /* --- THE GEOMETRY AUTHORING SESSION ---------------------------------------
     THE FEATURE'S FIRST CALL SITE, AND IT IS HERE BECAUSE `pressState` IS.
     Two of its members — `shapeMenuOn` and `shapeTool` — are in the
     arbitration table built three hundred lines below, and three of its resets
     are called by `resetForNewPlan` below that; a hook's arguments are
     evaluated during render, so the session is asked for on its own, early,
     and the rest of the domain is composed three times more further down. Same
     split `useBoardStep` makes for the switchboard step. See its README.

     EVERY PIECE OF IT IS TRANSIENT. The shapes and the drawn tracks are the
     document's and stay there; what is here is which primitive is armed, where
     a drag started, what the pens have clicked out, the borrowed outline being
     offset, which shape is showing its grips and which track point is picked
     up. A plan reopened holding any of it would be a plan reopened mid-gesture. */
  const geomState = useGeometryState();
  const { press: geomPress, covePen, trackPen, geomHover, setGeomHover } = geomState;
  /* THE FOUR SETTERS THIS FILE STILL CALLS. Taken off the session rather than
     reached through it, because two of them are named by the keydown effect's
     dependency array — and `geomState` is a fresh object every render, so
     naming IT there would re-bind the window listener on every frame. See the
     note at the foot of usePen. A setter's identity is stable for the life of
     the component. */
  const { setShapeEditId, setSelTrackPt, setShapeTool,
          setShapeSides, setShapeAskSides } = geomState;
  /* WHICH SHAPE IS PICKED. With the other nine reads of the register and not in
     the feature, because the magnetic-track domain asks for it four hundred
     lines above the geometry is composed. See lib/selection.js. */
  const selShapeId = idOf(sel, 'shape');

  /* --- THE TWO CUES EVERY ARMED TOOL SHARES --------------------------------
     BOTH STAY HERE AND NEITHER IS ONE FEATURE'S. Five gestures publish the
     momentary alignment lines and only three of them are the fittings'; the
     crosshair is maintained by the ceiling object, the COB, the strip, the
     sconce and the cove alike, which is four features between them. They are
     handed to whichever domain writes them. */
  const [guides, setGuides] = useState([]);       // momentary alignment lines
  const [overRoom, setOverRoom] = useState(false); // is the pointer on a ceiling

  const [zoneMode, setZoneMode] = useState(false);
  const [draftZone, setDraftZone] = useState(null);

  // Which of the possible chunk decompositions to light, PER ROOM. Held as a
  // STRATEGY ID and not a set of rectangles: the user is choosing how to read
  // the space, and that intent should survive a nudge of the target-cell
  // slider. Keyed by outline id, and absent means "whatever is recommended" —
  // which is what makes lighting eight rooms one act instead of eight choices.
  // IN THE DOCUMENT REDUCER.
  /**
   * WHAT EACH PIECE OF CEILING IS. outline id -> { chunk key -> option id }.
   *
   * THE DECISION IS PER CHUNK, NOT PER SPACE. A space is cut into rectangles by
   * its own outline — see ceilingDesign.js — and each of those pieces gets a
   * ceiling design of its own: standard today, cove where one can be built,
   * whatever else this app learns to draw later. An L-shaped living-dining room
   * is two chunks and can be coved over one end, both, or neither, which is the
   * thing a single 'cove: yes' on the room could never say.
   *
   * ABSENT MEANS STANDARD, at both levels: nothing writes 'standard' into this
   * map, so a plan of ordinary ceilings costs no state at all. And the inner key
   * is the chunk's GEOMETRY (see chunkKey) rather than its index, so a pick
   * survives a slider nudge and is dropped by a re-traced outline — which is the
   * right way round. An index would survive the re-trace and quietly move
   * somebody's cove to a different piece of ceiling.
   *
   * `ceilingKinds` IS THE OLD ANSWER, KEPT ONLY TO BE READ. It was one word per
   * space — outline id -> 'cove' — and plans in the database still carry it.
   * Nothing in the UI writes it any more; the layout below reads it once, when a
   * space has no per-chunk answer yet, and puts the cove on the biggest chunk.
   * That is what the old state meant, so an old plan reopens with its coves
   * where they were and the first per-chunk edit retires the legacy entry.
   */
  // BOTH IN THE DOCUMENT REDUCER.
  /**
   * WHICH CHUNK'S OPTIONS ARE ON SCREEN. { roomId, key } or null.
   *
   * Clicking any ambient light in a chunk opens the little pill over that chunk
   * and flipping it through the options is the whole interface for choosing a
   * ceiling — see PlanCanvas. It is a pointer at a chunk and not at a light on
   * purpose: pick 'cove only' and the chunk has no downlights left to have been
   * clicked, and the pill has to still be there to flip back with.
   */
  const [optionPick, setOptionPick] = useState(null);
  /* --- THE CARD THAT SAYS THE PILL IS A CONTROL ----------------------------
     `{roomId, key, ticked}` — WHICH PILL IT IS ATTACHED TO, and not a boolean,
     because the answer to "is the card showing" is "is the card's pill the pill
     that is open". A flag would have gone on pointing after the user selected
     some other space, since `optionPick` moves and a boolean does not.

     `ticked` IS THE HALF-SECOND BETWEEN THE CLICK AND THE CARD GOING. "Do not
     show again" that vanishes the instant it is pressed never shows the reader
     that it took — so the box fills, and THEN the card leaves. See the effect
     below, which owns the timer.

     `landed` IS THE OTHER HALF, AND IT EXISTS BECAUSE THE ANSWER IS NOT READY
     WHEN THE QUESTION IS ASKED. The pipeline finishes and hands us the design
     screen, but `rooms` — with the chunks and their options in it — is a memo
     over state that run has only just set, so there is nothing to choose a space
     from until React has re-rendered. So the run raises a flag and the effect
     below spends it on the next pass. */
  const [coach, setCoach] = useState(null);
  const [landed, setLanded] = useState(false);
  /**
   * PUT THE CARD AWAY FOR NOW — the reader engaged with the thing it was
   * pointing at, so it has done its job on this screen. It remembers nothing:
   * only the checkbox speaks for the next landing.
   */
  const hideCoach = useCallback(() => setCoach(null), []);
  /**
   * ...AND FOR GOOD, ON THIS PLAN. The tick goes in first and the card follows
   * it out — see `ticked` above and the effect that clears it.
   */
  const silenceCoachHere = useCallback(() => {
    silenceCoach(planId);
    setCoach((c) => (c ? { ...c, ticked: true } : null));
  }, [planId]);
  /* THE ONLY REASON THIS IS AN EFFECT AND NOT A `setTimeout` IN THE HANDLER is
     unmounting: leaving the plan mid-fade would otherwise fire a setter on a
     component that has gone. A cleanup is the cheap way to be sure. */
  useEffect(() => {
    if (!coach?.ticked) return undefined;
    const t = setTimeout(() => setCoach(null), 430);
    return () => clearTimeout(t);
  }, [coach?.ticked]);
  const [pickingId, setPickingId] = useState(null);   // the room whose chunking is being chosen
  /* --- THE ELECTRICALS, AND THERE IS NO LONGER A PASS TO STORE --------------
     `sbResults` WAS HERE — one entry per room, written by a bolt in the list of
     spaces that ran a vision call and kept its answer. Both are gone. The rules
     read the door boxes, the placed sconces and the bed box, all of which the
     app already has by the time there is a layout, so the boards are a memo
     over state rather than a result to hold: see `boardResults` below.

     WHAT THE BOLT ACTUALLY BOUGHT WAS THE TELEVISION, and the television is not
     looked for any more — the wall facing the bed gets two plates whether or not
     a console was drawn on it. See the header of planSwitchboards for that
     trade. With nothing left that costs a call, there is nothing left to ask for.

     WHAT IS STORED INSTEAD IS WHAT A PERSON DID: the plates they threw away.
     A board is derived, so "not this one" cannot be expressed by removing it
     from a list — the next render would put it straight back. Same shape and
     the same reasoning as `accentDismissed` next door. */
  // ...and it is in the document reducer — see `boardsOff` in usePlanDoc.js.
  /* ...AND WHERE THEY DRAGGED ONE TO: board id -> distance round that space's
     walls, in feet. Same kind of store as `boardsOff` and for the same reason —
     a board is derived, so a hand position has to live outside the derivation or
     the next render puts the plate back on its rule.
     THE COORDINATE IS ARC LENGTH AND NOT A POINT. See `wallPath` in
     electrical.js: a run index renumbers when somebody re-traces a corner, and a
     point in plan pixels moves when somebody corrects the scale. */
  /* ...AND WHAT THEY PUT ON ONE: board id -> the points somebody added by hand,
     `[{ id, kind, amps, label }]`, in the order they added them.

     A THIRD STORE OF THE SAME SHAPE, and the shape is the point. A plate's
     composition is derived from the flows that come back to it — the rules know
     how many switches a ceiling needs and nobody should have to count them —
     but the rules cannot know that this wall wants a 16A socket for an air
     conditioner or a data point for a desk. So the derivation stands and the
     additions live beside it, exactly as `boardsOff` and `boardMoves` do for the
     other two things a person genuinely knows better than a rule.

     THE LABEL IS STORED WITH THE POINT, and it is the one field here that is
     redundant: `switchboards.js` can name a `{kind, amps}` pair on its own. It
     is stored because the chip that removes an addition has to say what it is
     removing, and a plan whose project moves country would otherwise print a
     15A socket's chip using India's word for it. */
  /* WHICH PLATE IS PICKED, AND THE GESTURE IN FLIGHT ON ONE, are both in
     features/electrical/ — see the note by the wires below. */

  /* --- THE WIRES ------------------------------------------------------------
     A FLOW IS DERIVED LIKE EVERYTHING ELSE HERE, so the two things a person can
     decide about one live outside the derivation, in the same shape as
     `boardsOff` and `boardMoves` above:

       `flowBoards`  flow id -> board id. Which plate this loop runs off, where
                     the rules' answer is not the one wanted. The rules pick the
                     nearest plate that can carry a ceiling, which is a good
                     guess and is not a decision — a room with two boards has a
                     real question about which switch these lamps belong on, and
                     nothing in the geometry can settle it.

       `flowBends`   flow id -> { leg key -> feet }. How far each leg's arc is
                     nudged off where the rule bows it. A DELTA and not a
                     position, so a leg nobody touched still follows its own
                     length as the fittings move — see `loopLegs` in flows.js.

     THE IDS ARE STABLE FOR THIS, and they were not until this feature. See the
     note by `id` in flows.js: a counter would have slid somebody's reassignment
     onto a different wire the first time a light was added to an earlier chunk.

     AND THERE IS NO "PUT IT BACK" BUTTON, deliberately. Both of these are in
     `editorState`, so the undo already covers a bend nudged too far or a wire
     dropped on the wrong plate — and a panel control for undoing the last thing
     you did is a second undo with a smaller scope. */
  // Both are in the document reducer — see usePlanDoc.js.
  /* WHICH WIRE IS PICKED, AND THE GESTURE IN FLIGHT ON ONE, are both in
     features/electrical/ — the first off the shared selection service, the
     second in useBoardGestures.js beside the drag that owns it. */

  /* --- PLATES SOMEBODY PUT THERE THEMSELVES --------------------------------
     `[{ id, roomId, sFt }]` — how far round that room's walls each one sits, in
     feet. The same coordinate `boardMoves` stores and for the same reasons: a
     run index renumbers when a corner is re-traced and a pixel moves when the
     scale is corrected. The geometry is derived on every render by
     `placedBoards`; this is the whole of what is kept.

     A LIST AND NOT AN OVERRIDE, WHICH MAKES IT THE ODD ONE OUT. `boardsOff`,
     `boardMoves`, `flowBoards` and `flowBends` all modify something the rules
     produced. This one is not a modification of anything — nothing derives these
     plates, so the list IS the fact, the way `manualAccents` and `manualCoves`
     are. That is also why deleting one removes it from here rather than adding
     an id to `boardsOff`: there is no rule to keep suppressing.

     WHERE IT IS, AND NOTHING ABOUT WHAT IT IS. Whether a plate is a socket
     outlet or a full switchboard lives in `boardKinds` below, because that is a
     question every plate on the drawing can be asked and not only these. */

  /* --- OUTLET OR SWITCHBOARD: `{ [boardId]: { outlet, amps } }` -------------
     TWO STATES OF ONE PLATE, AND A CHECKBOX BETWEEN THEM.

       A SOCKET OUTLET is one socket and no switch — the one composition allowed
       to have none. It is not switched from; it wires ITSELF to the nearest
       board that can switch it, and that board carries the switch.

       A SWITCHBOARD is everything else: the room's switches, its own socket and
       the switch for that socket, plus whatever was added by hand.

     THE CONVERSION IS THE WHOLE FEATURE AND IT COSTS ALMOST NOTHING, because
     every consequence is already derived. Tick the box on an outlet and it stops
     being one: its flow ceases to exist, so the wire disappears and the switch
     on the far board disappears with it — not because anything went and removed
     them, but because both were only ever a function of a flow that is no longer
     produced. Untick it on a switchboard and the reverse happens, and everything
     that was switched from it falls back to the next plate on its own, because
     `servesBay` is false for a socket.

     AN OVERRIDE AND NOT A VALUE, like every other hand decision in this file. A
     plate with no entry here is whatever it was born as: hand-placed ones are
     outlets, everything a rule put on a wall is a board. So the store holds only
     what somebody actually changed, and a plate reverts by having its entry
     deleted rather than by being set back to a default that might have moved.

     `amps` IS THE SOCKET'S RATING and it belongs here rather than on
     `manualBoards` for one reason: it survives the conversion. A 16A outlet
     ticked into a switchboard is a board with a 16A socket on it, and a rating
     that lived on the outlet would have been lost on the way through. */

  /* --- HOW HIGH OFF THE FINISHED FLOOR: `{ [boardId]: mm }` -----------------
     THE ONE THING ABOUT A SWITCHBOARD A PLAN VIEW CANNOT SHOW. A plate is the
     same rectangle from above at 300mm as at 1200mm, and the difference between
     those two numbers is the difference between a socket and a switch.

     THE RULES HAVE A DEFAULT PER ROLE — see SB_HEIGHT_MM in electrical.js — and
     a default is all it can be: 1200 is switch height in most of the world and
     1100 in some offices, a bedside plate is set to whatever that bed is, and
     the person drawing knows which. So this is an override like every other
     hand decision in this file, holding only the plates somebody set.

     THE PRIMARY HEIGHT ONLY, which matters for exactly one board. The wall
     facing a bed is TWO plates at two heights — that is what makes it two, see
     FACING_PLATES — so an override replaces the first of its list and leaves the
     second alone. Writing a single number over the whole list would silently
     turn a two-plate board into a one-plate board, which is a change to what
     gets ORDERED made by editing a dimension. */

  /* --- AND THE ORDER THE MODULES SIT IN: `{ [boardId]: [unitKey, ...] }` -----
     THE RULES DECIDE WHAT IS ON A PLATE AND A PERSON DECIDES WHERE. Which
     switch is leftmost is not a fact anything can derive — it is which one your
     hand finds first walking through the door, and that depends on which side
     the door is on, which lamp matters most and what the client is used to.

     KEYS AND NOT INDICES, AND UNITS AND NOT MODULES. An index means nothing the
     moment the plate gains a fitting; a key survives. And what is ordered is the
     PAIR — a fan's switch with its regulator, a socket with its switch — so
     there is no arrangement this can express in which the thing you press is
     separated from the thing it works. See `order` in switchboards.js. */
  /* IS THE SWITCHBOARD TOOL OPEN? A step, like the door editor and the zone
     editor — it takes the panel over and stays open across placements, because
     somebody putting a board on one wall is usually putting one on three.
     THE FEATURE'S FIRST CALL SITE, AND IT IS HERE BECAUSE `pressState` IS. The
     canvas's arbitration table is built a hundred lines below this and carries
     this flag, and the rest of the electrical domain cannot be composed until
     there is a pointer to hand it — see the note at `useElectrical`. So the
     step is asked for on its own, early, and handed to the controller later.
     Room intelligence is split across two calls for the same reason. */
  const boardStep = useBoardStep({ setSel, docActions });
  /* `closeBoardPlace` IS TAKEN OFF THE STEP HERE and not off the controller's
     command group below, because four of the other steps stand this one down on
     their way in and all four are defined above that line. It is the same
     function either way — the controller returns this one. */
  const { boardPlace, closeBoardPlace } = boardStep;
  /**
   * WHICH CATEGORY OF THE EDIT TOOLBOX IS OPEN.
   *
   * A view preference and nothing else — it says which of three palettes is on
   * screen and never reaches the drawing, which is why it is not in
   * planState.js. Reopening a plan on the tab you left it on would be a nicety;
   * reopening it with a tool armed under a tab you cannot see would be a bug,
   * and the two arrive together the moment this is persisted.
   */
  // WHAT KIND OF PROJECT. Asked once, on upload, and everything conditional
  // downstream reads it — see roomTypes.js for why it is asked rather than
  // guessed.
  // The kind of BUILDING — residential, hotel, office (see roomTypes.js), and
  // not the database project, whose id never enters this component. Seeded from
  // the project when the project knows: a plan added to a project already
  // classified as a hotel arrives classified.
  // Both are in the document reducer — `projectType` and `roomTypes`. The
  // reason this file goes on calling the first one `projectId` is at the
  // destructure above.
  /* --- THE LIGHTING WORKFLOW'S OWN SCREEN ---------------------------------
     THE FEATURE'S FIRST CALL SITE, AND IT IS HERE BECAUSE `stepTool` IS. Half
     the controls below carry `!prep` — while the pipeline runs the layout is
     being replaced underneath — and the first of those readers stands three
     hundred lines above the point where the workflow can be composed. A hook's
     arguments are evaluated DURING RENDER, so the controller cannot be moved up
     to meet it; the state can be. Same split `useFixtureState`,
     `useGeometryState` and `useBoardStep` make. See the feature's README. */
  const lightingRun = useLightingRun();
  /* THE NAMES THIS FILE ALREADY USED. Twenty-odd guards below say `prep`, one of
     them inside a memo's dependency array, and `resetForNewPlan` names the reset
     in its own — so both are taken off the session rather than reached through
     it, because the session is a fresh object every render. Same reason the
     geometry's four setters are taken off theirs. */
  const { prep, reset: resetLightingRun } = lightingRun;
  // WHICH SPOT IS PICKED. Its own selection and not `selAccId`, because a spot
  // is not an accent: the two panels describe different things and a click on
  // one must not leave the other looking selected. Same shape and same lifetime
  // as `selObjId` next door.
  const selSpotId = idOf(sel, 'spot');

  // --- UNDO ------------------------------------------------------------------
  //
  // FIVE REFS AND ONE PIECE OF STATE, and the split is the whole reason this
  // works without re-rendering the editor on every keystroke.
  //
  // The history, the in-flight burst timer and the "this change is my own doing"
  // flag are REFS: nothing on screen depends on them, and making any of them
  // state would re-render the app in the middle of recording a change to it.
  // `undoDepth` IS state, because two buttons are greyed out by it.
  //
  // `docRef` and `undoRef` are the file's existing latest-values pattern (see
  // `live` further down): the serialised document and the two actions are
  // defined AFTER the state they read, and the keydown handler is bound BEFORE
  // it. A ref is how the earlier listener calls the later function without a
  // dependency on a value that does not exist yet — which is the temporal dead
  // zone the `detectedZones` note describes, met from the other side.
  const history = useRef(newHistory());
  const undoing = useRef(false);
  const quietTimer = useRef(null);
  const docRef = useRef(null);
  const undoRef = useRef(null);
  /* AND THE EXPENSIVE SAVE, DECLARED HERE AND ASSIGNED AT THE FOOT OF THIS
     COMPONENT. The same latest-values pattern as `docRef` and `undoRef`, met
     from the other side: the lighting workflow is handed this ref hundreds of
     lines above the render that fills it, and a hook's arguments are evaluated
     DURING RENDER — so the REF has to exist by then even though the function it
     will hold cannot. See `milestone.current =` at the bottom, which is the line
     that used to declare it. */
  const milestone = useRef(null);
  const [undoDepth, setUndoDepth] = useState({ past: 0, future: 0 });

  const selAccId = idOf(sel, 'acc');
  // Not on the plan, and every mounting height and throw distance depends on
  // it. One field, and load-bearing — see the header of accentPrompt.js.

  // TWO WAYS TO SET THE SCALE, and there used to be four.
  //
  //   'door'  click a detected door, say how wide it is. The default, because it
  //           is the only one that asks the user to RECOGNISE rather than to
  //           measure, and recognising a bathroom door is something anyone
  //           looking at a plan can do without a steady hand.
  //   'ref'   drag a line across something and name it. The fallback, and the
  //           only thing that works on a plan with no legible doors.
  //
  // Gone: a px/ft box, which asked the user to know a number nobody knows about
  // their own drawing; and the fan-sweep scale, which needed red markers drawn
  // on the plan first and was strictly worse than a door once doors could be
  // found. Fans are still detected and still become ceiling obstacles — they
  // have simply stopped being a ruler.
  // ...and all four of the scale's own fields are in the document reducer —
  // see the `scaleMode` block in usePlanDoc.js, which carries this note's list.

  // --- THE DOORS, CONFIRMED BEFORE THE WIRING IS DRAWN ----------------------
  //
  // A SWITCHBOARD IS PLACED BESIDE A DOOR. That is the whole of the first rule
  // in electrical.js, so every plate on the sheet is only as right as the door
  // boxes it was derived from — and those boxes came from a detector that was
  // asked a different question. It was run on upload to find the RULER: one
  // clean opening, anywhere on the plan, is enough to scale the drawing, and a
  // detector that misses three doors out of nine still answers that perfectly.
  // The electricals need the opposite — every door, in every space that is
  // going to take a board — and nothing before now has ever asked whether the
  // set was complete.
  //
  // SO IT IS ASKED, ONCE, AND BY A PERSON. Not re-detected: a second model call
  // would come back with the same recall and no way for anybody to tell. The
  // boxes go on the drawing, the panel empties down to the question, and the
  // user draws in what is missing and throws out what is not a door. Confirming
  // is what makes the wiring visible.
  //
  // `doorsOk` IS A DECISION AND IS SAVED; `doorEdit` IS A SCREEN AND IS NOT.
  // Reopening a plan whose doors were confirmed must not ask again — the answer
  // is part of the design — but it must not reopen mid-edit either.
  // `doorsOk` is in the document reducer; `doorEdit` is a screen and stays here.
  const [doorEdit, setDoorEdit] = useState(false);

  /* --- WHICH MACHINE OWNS THE NEXT PRESS ----------------------------------
     ONE MEMO, AND THE RULE THAT READS IT IS IN lib/pressOwner.js. This canvas
     has one pointer pipeline and seven machines that can own a press on it, and
     the arbitration between them used to be a guard expression hand-copied into
     every handler that had to obey it — in variants that differed only by which
     terms they remembered. A variant missing one term is indistinguishable from
     a correct one by reading, which is how the track diffuser and the track spot
     came to be completely unplaceable. See the header of that file for the
     precedence and the reason for each rank.

     IT DOES NOT CARRY `readOnly`, `pxPerFt` OR `source`. The first is a veto on
     editing rather than a machine; the other two ask "is there a drawing at
     all", which is a different question with a different answer when it fails.
     All three stay as their own checks beside this one at the call sites. */
  const pressState = useMemo(() => ({
    doorEdit, boardPlace, zoneMode, armed, addTool,
    shapeMenuOn: geomPress.shapeMenuOn, shapeTool: geomPress.shapeTool,
  }), [doorEdit, boardPlace, zoneMode, armed, addTool,
       geomPress.shapeMenuOn, geomPress.shapeTool]);
  /* `zoneEdit` IS THE DOOR EDITOR'S TWIN, and it is a screen rather than a
     decision, so like `doorEdit` it is not saved. `zoneMode` is the older flag
     and it stays: that one says the canvas's pointer is boxing out a zone, and
     it is read by six handlers. This one says the PANEL has been taken over to
     ask for one. They are set and cleared together by `openZoneEdit` /
     `closeZoneEdit` and nowhere else, which is what keeps them honest. */
  const [zoneEdit, setZoneEdit] = useState(false);
  const selDoorId = idOf(sel, 'door');
  const [doorDraft, setDoorDraft] = useState(null);  // the rubber band, in plan px
  // A MOVE IN FLIGHT, HELD OUTSIDE `doors` ON PURPOSE. Writing the rect on every
  // pointermove would recompute the board pass, the bay pass and the flows forty
  // times a second — and the scale, if the box being dragged is the ruler. The
  // drag carries its own live rect and the commit happens on release.
  const [doorDrag, setDoorDrag] = useState(null);    // {id, from, rect}

  // Not state. Every dial that used to be a slider now lives in settings.js —
  // see the header there for why.
  const opt = PLAN_OPTIONS;
  const useBoundingRect = SIMPLIFY_ROOM_TO_RECTANGLE;
  // `grid`, `surfaces` and `secondary` are gone rather than defaulted false:
  // nothing draws them and nothing toggles them, so a key here would be a
  // setting with no effect, which is the kind of thing that survives three
  // refactors and then gets wired to the wrong render.
  const svgRef = useRef(null);
  const stageRef = useRef(null);

  /* --- WAS THIS CLICK'S PRESS A PRESS ON BARE PLAN? -------------------------
     ONE LATCH, SET BY THE CANVAS ITSELF, AND IT REPLACES A RULE EVERY HANDLER
     HAD TO REMEMBER. `onCanvasClick` selects a space or drops the selection,
     and the browser synthesises a click after EVERY press on this sheet — so
     without an answer to this question, picking anything up also let go of it
     forty milliseconds later. The bar appeared on the press and vanished on the
     release, which is what "the selection comes for a sec and goes away" is.

     WHY THE CLICK CANNOT SIMPLY BE STOPPED ON THE THING THAT WAS PRESSED. Nine
     of the ten drags capture the pointer on the <svg> — they have to, or a
     gesture that leaves the fitting it started on never ends — and a captured
     pointer RETARGETS everything that follows, the synthesised click included,
     to the capture element. By the time that click exists it is not being
     dispatched to the fitting at all, so no handler on the fitting can stop it.

     IT IS OPT-OUT AND IT USED TO BE OPT-IN, AND THAT IS THE WHOLE FIX. Every
     press handler was expected to raise a flag saying "this press is spoken
     for"; three of the eleven did, and the eight that did not were the eight
     selections that flickered. Same class of bug as the hand-copied press
     guards lib/pressOwner.js exists to end, and the same answer: state the rule
     once, where it cannot be forgotten. The capture-phase handler clears the
     latch for EVERY press on this canvas, and only a press that reaches the
     <svg>'s own bubble handler — which means no control on the drawing stopped
     it, which means it landed on bare plan — sets it. A twelfth selectable
     thing needs to do nothing at all to be safe.

     CLEARED IN THE CAPTURE PHASE RATHER THAN CONSUMED ON THE WAY OUT, so a
     press that produces no click at all (a drag cancelled, a release off the
     window) cannot leave the latch standing for somebody's next press. */
  const barePress = useRef(false);

  // Source loading calls the recognition reset, while recognition consumes the
  // resolved source. A ref bridges that callback cycle without copying state or
  // changing the source loader's callback identity on every recognition update.
  const recognitionReset = useRef(null);
  /* AND THE SAME CALLBACK REF FOR THE ROOM-INTELLIGENCE RESETS, for the reason
     the one above it exists: `resetForNewPlan` is handed to `usePlanSource`
     eighty lines below this and the feature is composed hundreds of lines
     further down again, so the reset it calls does not exist yet when this
     function is defined. A ref is how the earlier definition reaches the later
     value without duplicating any state. Both groups are merged into it at the
     second call site — see `roomEditing`. */
  const roomIntelReset = useRef(null);
  /* AND ONE FOR THE ELECTRICALS, for the same reason again: the wiring is
     composed below `svgPoint`, hundreds of lines past this function, and a
     fresh sheet has to take its plates and its wires away. */
  const electricalReset = useRef(null);

  // --- load -----------------------------------------------------------------
  const resetForNewPlan = useCallback(() => {
    docActions.clearMeasure(); docActions.setZoom(1);
    // NOTHING IS PICKED ON A FRESH SHEET. One line for what used to be eight,
    // and the three it used to miss — a COB, an array, a module — go with it.
    setSel(clear());
    docActions.clearZones(); setZoneMode(false); setDraftZone(null); setZoneEdit(false);
    docActions.clearChunkPicks(); setPickingId(null);
    docActions.clearCeilingKinds(); docActions.clearDesignPicks(); setOptionPick(null);
    recognitionReset.current.furniture();
    docActions.clearDismissed();
    recognitionReset.current.rooms();
    roomIntelReset.current.accentRoom();
    // The plates somebody threw away go with the plan they were on: a board id
    // names a room and a rule, and neither means anything on a fresh sheet.
    electricalReset.current.electrical();
    roomIntelReset.current.accentProposals();
    roomIntelReset.current.renders();
    // The hand-placed coves go with the trims, because they are the same
    // subject: a slot is set out against ONE plan's walls and means nothing
    // against another's. `runTrims` was already cleared here and leaving the
    // coves behind would have carried a previous drawing's slots onto a fresh
    // sheet, where they would sit at whatever plan pixels they were drawn at.
    docActions.clearCoves(); setCoveFrom(null); setCoveNote('');
    roomIntelReset.current.renderState();
    roomIntelReset.current.accentEditing();
    // BACK TO THE PROJECT'S ANSWER, NOT TO NULL. This runs on every file load,
    // including the one that opens a saved plan, and blanking it here would put
    // the plan-level dialog back in front of a user whose project already
    // answered the question.
    docActions.setProjectType(initialProjectType ?? null);
    docActions.clearRoomTypes(); resetLightingRun();
    recognitionReset.current.doors();
    // ...AND THE CONFIRMATION GOES WITH THEM. It is an answer about ONE set of
    // door boxes; carrying it onto a fresh sheet would draw wiring off a
    // detection nobody has looked at.
    electricalReset.current.doorConfirmation(); setDoorEdit(false);
    setDoorDraft(null); setDoorDrag(null);
    roomIntelReset.current.surfaces();
    docActions.clearObjects(); fixtureReset.objects();
    // AND THE DRAWN COVES, for the reason the hand-placed slots above go: a
    // shape is set out in ONE plan's feet, and carrying it onto a fresh sheet
    // would put a cove at whatever coordinates it happened to be drawn at.
    docActions.clearShapes(); geomState.reset.shapes();
    // The hand positions go with the grid they were chosen on: a cell key names
    // a rectangle in ONE plan's feet and means nothing in another's.
    docActions.clearLightMoves(); fixtureReset.lightMoves();
    geomState.reset.shapeTool();
    // AND THE DRAWN TRACKS, which go for the same reason the shapes do: a path
    // is clicked out in ONE plan's feet.
    docActions.clearTracks(); geomState.reset.tracks();
    /* AND THE MODULES. The RUNS go with `ceilingShapes` a few lines up — a
       magnetic track is a shape — but a module is keyed by a shape id, so
       leaving these would carry a new plan's first track a set of diffusers
       belonging to the last one. */
    docActions.clearTrackFixtures(); fixtureReset.module();
    fixtureReset.armed(); setGuides([]);
    docActions.clearOutlines(); docActions.setSelectedOutlineId(null);
    docActions.clearLit(); docActions.setFocusId(null);
    setOutlinesOpen(false); docActions.clearDirty();
    docActions.setUnitId(null);
  }, [docActions, initialProjectType, geomState.reset, fixtureReset,
      resetLightingRun]);

  // --- the plan source ------------------------------------------------------
  const {
    img, setImg, dxf, setDxf,
    pdfPage, pdfPick, setPdfPick, pdfRun,
    invertedSrc, loadFile, openPdfPage, source, isVector,
  } = usePlanSource({ doc, docActions, initialPdfPage, resetForNewPlan, setBusy });
  const {
    ceilingFt, scaleMode, refId, customFt, measure, pxPerFt,
  } = useScale({ doc, isVector, source, doors, doorPick });


  const { architecture: { wallLayerSet } } = useSceneArchitecture({ isVector, source });

  const {
    rooms: { state: roomState },
    doors: { state: doorState },
    furniture: { state: detectState, bedSets, bedLook },
    commands: recognitionCommands,
    reset: resetRecognition,
  } = usePlanRecognition({
    doc, docActions, source, img, isVector, pxPerFt, wallLayerSet, readOnly,
    restoredPlan: !!restore, useBoundingRect,
  });
  recognitionReset.current = resetRecognition;
  const { refindBeds, absorbBedRows, computeBedFit } = recognitionCommands;

  const {
    layers, zoom, view,
    over, setOver,
    nameDraft, setNameDraft,
    audit, setAudit,
    showGrid, setShowGrid,
    auditDoors, setAuditDoors,
    auditBeds, setAuditBeds,
    fitZoom,
  } = useViewPrefs({ doc, source, stageRef });

  /* --- TWO TOOLS ARE STEPS, AND THE OTHER THREE ARE NOT --------------------
     THE TEST IS WHETHER THE TOOL HAS A `GESTURE`, and that is deliberately the
     same test the palette already makes to decide between a picture card and a
     one-line sentence. Written there: a card is worth its space "where the
     gesture is hard to imagine or its result lands somewhere surprising, and
     'click a wall' is neither". That is exactly the line between a tool that
     can be explained beside a palette and one that deserves the panel, so it is
     one criterion and not two that can disagree.

     WHICH LEAVES THE SPOT AND THE COVE. Neither puts a fitting where you point.
     The spot's box names what is being LIT and the fitting then stands off on
     the ceiling grid, aimed back into it; the cove's drag is locked to the wall
     the press landed on, so pulling out into the room does not do what it looks
     like it does. Both are gestures somebody can perform
     correctly and still read as a bug — and both were being explained by one
     card under a six-cell palette, beside a spaces list and two more sections.

     A SCONCE, A STRIP AND A CHANDELIER STAY AS THEY WERE: click a wall, click
     two ends, drop it on the ceiling. The result is under the cursor, the
     palette stays up, and emptying the panel for them would be ceremony.

     `!readOnly` because an operator cannot place anything, and `!prep` for the
     reason every other control on this screen carries it: while the pipeline
     runs the layout is being replaced underneath. The door and zone editors
     take precedence in the panel's own branch order — they own the canvas
     outright, and `openZoneEdit`/`openDoorEdit` disarm the tools on the way in.

     THE TOOL'S OWN ROW IS WHAT THE STEP RENDERS FROM, so the heading, the hint
     and the consequence cannot drift from the palette button they came off. */
  const stepTool = addTool && GESTURE[addTool] && !readOnly && !prep
    ? LIGHT_TOOLS.find((t) => t.id === addTool) ?? null
    : null;

  // --- opening a saved plan -------------------------------------------------
  //
  // TWO STEPS, AND THEY CANNOT BE ONE. The file has to be READ before the state
  // can be put back: `loadFile` calls resetForNewPlan, which would wipe a
  // restore applied before it. So the file goes in first, and the restore waits
  // for `source` to exist — which is the same signal every other part of this
  // component waits on.
  const openedFile = useRef(false);
  useEffect(() => {
    if (!initialFile || openedFile.current) return;
    openedFile.current = true;
    loadFile(initialFile);
  }, [initialFile, loadFile]);

  // A STATE FLAG AND NOT A REF, and the difference is a data-loss bug.
  //
  // Effects run in declaration order within one commit. This effect sits near
  // the top of the component and the autosave effect sits near the bottom, so a
  // ref set here is already true when the autosave effect runs IN THE SAME PASS
  // — while `editorState` still holds the pre-restore blank, because the setters
  // below have only been scheduled. The autosave would then write an empty plan
  // over the saved one. A state flag cannot do that: it only reads true in a
  // later render, which is the same render that carries the restored values.
  const [restoreApplied, setRestoreApplied] = useState(!restore);
  const restored = useRef(false);

  /**
   * EVERY SETTER `applyEditor` NEEDS, AS ONE OBJECT.
   *
   * Lifted out of the restore effect because there are now TWO callers — opening
   * a saved plan, and Ctrl+Z — and planState.js's own header explains why they
   * must not each carry their own list: a field added to the writer and
   * forgotten in one reader is a change that silently does not come back. One
   * bundle, one place to add to.
   *
   * EVERY ENTRY BUT ONE IS GENERATED NOW. `docSetters` is built from the
   * reducer's own field table, so a field added tomorrow needs no line here at
   * all; the single hand-written entry left is `setLayers`, which MERGES over
   * the defaults rather than assigning and says why below.
   */
  const stateSetters = useMemo(() => ({
    /* THE TWO THAT ARE NOT DOCUMENT FIELDS, AND THE ONLY TWO LEFT. `applyEditor`
       calls sixty-three setters: the sixty-one fields of the document, and these
       two — which restore SESSION state DERIVED from what was just restored. A
       reopened plan with doors in it has a door detector that reads as `done`,
       so nothing offers to spend a model call finding doors that are already on
       the drawing. Neither is saved; both are computed off `p.doors` and
       `p.detections` in applyEditor. */
    setDoorState: resetRecognition.restoreDoorStatus,
    setDetectState: resetRecognition.restoreFurnitureStatus,
    /* AND EVERY OTHER FIELD COMES BACK THROUGH THE REDUCER, GENERATED. The bag
       is one flat object of `setX` functions so neither `applyEditor` nor
       `applyStep` has to know where a field lives — built from the reducer's own
       field table, so a field added tomorrow needs no line here at all. The
       names are `setterFor`'s, which is the rule this bag used to follow by
       hand and is now held to mechanically. See DOC_FIELDS. */
    ...docSetters,
    /* MERGED OVER THE DEFAULTS, NOT ASSIGNED, AND THIS LINE IS WHY THE BAG STILL
       HAS A HAND-WRITTEN ENTRY IN IT. `docSetters.setLayers` is the blunt
       restore the reducer generates — it writes what it is given — and a plan
       saved before a layer existed has no key for it, so assigning would leave
       that layer `undefined` and it would read as off on a sheet whose author
       never decided. The merge is the same class of defaulting as `applyEditor`'s
       own `??`, and it belongs on the same side of the door: what reaches
       DOC_FIELD_RESTORED is already the value that plan restores to.
       IT MUST STAY AFTER THE SPREAD. Declared above it, the generated setter
       would win and the merge would silently stop happening. See LAYER_DEFAULTS
       in planState.js. */
    setLayers: (saved) => docSetters.setLayers({ ...LAYER_DEFAULTS, ...(saved || {}) }),
  }), [docSetters, resetRecognition]);

  useEffect(() => {
    if (!restore || restored.current || !source) return;
    restored.current = true;
    applyEditor(restore, stateSetters);
    setRestoreApplied(true);
    console.log('[plan] restored', {
      outlines: restore.outlines?.length ?? 0, lit: restore.litIds?.length ?? 0,
      savedAt: restore.savedAt, v: restore.v,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restore, source]);

  const {
    outlines, selectedOutlineId, litIds, dirtyIds, focusId,
    commitOutline, updateOutline, deleteOutline,
    movePoint, insertPoint, removePoint,
  } = useOutlines({ doc, docActions, source });
  const { rooms: { outlinesPx, litOutlines, enclosedZones } } = useSceneOutlines({
    source, outlines, litIds,
  });
  const {
    rooms: { items: rooms, focus, openRoom, planAreaSqft },
    architecture: { obstaclesPx },
    furnishings: { bedsPerRoom, detectedZones, wardrobesPx, shelfStrips },
    lightingGeometry: { reverseCoves, drawnZones },
  } = usePlanScene({
    source, pxPerFt, outlines, outlinesPx, litOutlines, enclosedZones, focusId, ceilingObjs,
    accentResults, detections, dismissed, wallResults, useBoundingRect, doors, runTrims,
    manualCoves, runsOff, zones, opt, chunkPicks, roomTypes, projectId, designPicks, ceilingKinds,
    ceilingShapes, lightMoves, manualTracks, isAdmin
  });

  /* --- LIGHTING A SPACE COSTS SOMETHING ------------------------------------
     THE TILL AND THE TWO ACTS THAT PUT A DRAWING THROUGH IT ARE
     features/lighting-planner/ — `claimSpaces`, `lightWholePlan` and
     `lightOneRoom`, all three taken off `lighting.commands` at the workflow's
     own call site below. They stood HERE, below `pxPerFt`, and that position is
     still load-bearing for the same reason: a hook's dependency array is
     evaluated DURING RENDER, so a call naming the scale above the `const
     pxPerFt` it names is a temporal-dead-zone ReferenceError on the first paint
     — which in React means the whole tree unmounts and the app is a white page.
     Nothing between this line and that one claims or lights anything, so the
     move is a move. See that feature's README. */

  /* NO PLAN-SIZE BRANCHING IN THE BED PASSES, and this is the shape the whole
     thing settled into: the WHOLE SHEET goes to both detectors on every plan,
     they are contested against each other, and the judge settles it. Zooming
     into a single room happens for one reason only — the classifier called a
     space a bedroom and that space has no bed in it.
     A size threshold used to skip the whole-sheet pass on a large plan, which
     made every bedroom on it empty, which made every bedroom zoom. Two calls a
     room, on a sheet where the cheap pass had not been allowed to try. The
     contradiction is the trigger; the size of the drawing is not.
     `planAreaSqft` is still computed — the Result panel prints it. */

  /**
   * THE SLOT AS IT WOULD BE IF THE SECOND CLICK LANDED NOW.
   *
   * Built by the same function that builds the real one, from the stored wall
   * and the pointer projected onto it — so what is on screen while you aim is
   * the thing you get, down to the eight inches of band and which side of the
   * wall line it sits on. A preview drawn by separate code is a preview that
   * eventually disagrees with the placement.
   *
   * IT IS HANDED TO THE CANVAS APPENDED TO THE REAL LIST rather than as its own
   * prop with its own drawing. The canvas already knows how to draw a reverse
   * cove — band, inner lip, tape, the ramp along its length — and a draft that
   * is drawn by that code cannot look like anything other than what it will
   * become. It goes no further than the canvas: it is not in `reverseCoves`, so
   * it is not a no-light zone, not an accent run, not a line in the schedule and
   * not in the DXF. Nothing downstream can see a slot that does not exist yet.
   */
  const draftCove = useMemo(() => {
    if (addTool !== 'cove' || !coveFrom || !addAt || !(pxPerFt > 0)) return null;
    const { t } = alongWallAt({ a: coveFrom.a, b: coveFrom.b }, addAt);
    return manualReverseCove({
      a: coveFrom.a, b: coveFrom.b, t0: coveFrom.t,
      t1: Math.max(0, Math.min(coveFrom.L, t)),
      roomId: coveFrom.roomId, inward: coveFrom.inward, pxPerFt, id: 'mcove-draft',
    });
  }, [addTool, coveFrom, addAt, pxPerFt]);

  const ceilingMmFor = useCallback(
    (id) => ceilingMm[id] ?? DEFAULT_CEILING_MM, [ceilingMm]);

  /** THE FIELD TAKES WHAT IS TYPED AND THE STORE TAKES WHAT IS MEANT. Clamped
   *  rather than refused: 27 is somebody halfway through typing 2700, and a
   *  field that rejects it cannot be typed in at all. An empty box is the
   *  default, which is the only reading of "no height" there is. */
  /* THE CLAMP TRAVELS WITH THE ACTION rather than being applied here, because
     it is part of what the edit MEANS — see the reducer. What this call site
     owns is the intent and the two bounds; what a legal height is, is the
     document's business. */
  const setCeilingMmFor = useCallback(
    (id, raw) => docActions.setCeilingMm(id, raw,
      { min: CEILING_MM_MIN, max: CEILING_MM_MAX }),
    [docActions]);

  /* --- WHAT THE MODELS SAY ABOUT ONE ROOM ----------------------------------
     Room-type classification, the accent pass, the task-surface pass, the
     render pass and the wall-finishes step, all in features/room-intelligence/.
     THE DOCUMENT IS NOT SPLIT AND NOTHING IS COPIED INTO IT: every answer,
     every dismissal, every hand-placed fitting and every stored render pointer
     is still `usePlanDoc`'s and is still written through `docActions`. See the
     header of useRoomIntelligence for the whole boundary.
     HERE, AND NOT HIGHER UP, for the reason `claimSpaces` sits where it does: a
     hook's arguments are evaluated DURING RENDER, so this cannot stand above
     the `rooms` and `focus` it is handed. */
  const roomIntel = useRoomIntelligence({
    source, img, wallLayerSet, pxPerFt, ceilingFt, projectId,
    rooms, focus, materials, accentResults, doors, renderRefs, renderStore,
    readOnly, onClaimPass, onReleasePass, docActions,
  });
  /* THE NAMES THIS FILE ALREADY USED, and no more of them than have call sites
     here. `wallEdit` is the id — a step is open — and `wallEditGeo` is what the
     canvas draws from; the three compute functions are the pipeline's. Anything
     with one reader is read off `roomIntel` where it is read. */
  const { wallEdit: wallEditGeo, wallEditId: wallEdit,
          onWallSegment: pickWallSegment } = roomIntel.canvas;
  const { wallPick, setWallPick, wallEditRoom,
          materialsEdit, setMaterialsEdit } = roomIntel.panel;
  const { computeRoomType, computeAccents, computeSurfaces,
          setSurfaceTone, setWallTone,
          openWallEdit: enterWallEdit, closeWallEdit } = roomIntel.commands;

  /* INVERTED MEANS THE PLAN AND WHAT IS ON THE CEILING, AND NOTHING ELSE. Cell
     shading, the grid, space outlines and tags are all our WORKING drawn over
     somebody's plan, and on a black ground they are what stops it reading as
     the drawing. The fade goes too: it exists to keep black ink legible over a
     black scan, which is the opposite problem.

     `zones: false` WAS IN THIS LIST AND IS THE SAME MISTAKE AS `fan: false`
     BELOW, ONE ITEM ALONG. It filed the no-light boxes with the scaffolding on
     the reading that they are working marks — but a hand-drawn zone is not
     working, it is an INSTRUCTION somebody gave with a marquee, and the only
     evidence it landed is the box on the drawing. This ground is not the
     presentation ground either: night mode arms itself the moment a plan gets
     its first lights (see `hadLights`), so it is where the design is DONE. The
     result was that boxing out a wardrobe in the normal working view drew
     nothing at all — press, drag, release, and the plan is exactly as it was —
     which reads as the gesture having failed rather than as a layer being off.
     Nothing in the panel says this override exists, and the zone list a few
     inches away says the zone does.
     Nor does it cost the sheet anything: the beds are already held out of
     `drawnZones` for that reason, and the PDF plot has never drawn zones. What
     DOES have to change with the ground is their ink — a #737373 hatch on black
     is very nearly nothing — and that is handled in PlanCanvas, next to the
     ceiling objects' own night tone, rather than here.

     `fan: false` WAS IN THIS LIST AND SHOULD NOT HAVE BEEN. It filed ceiling
     objects with the scaffolding, and they are not scaffolding: a fan, a
     chandelier and an AC cassette are ITEMS somebody placed, they are the reason
     the lights are where they are, and every one of them holds a two-foot
     clearance the layout obeys. Turning them off in night mode meant a plan you
     could not check — the hole in the grid was there and the thing that made it
     was not — and it read as the objects having failed to place rather than as a
     layer being off, because nothing in the panel says this override exists.
     They are drawn in both modes now. What DOES have to change with the ground
     is their ink, and that is handled in PlanCanvas rather than here. */
  /* AND THE WIRING IS OFF WHILE THE DOORS ARE BEING CONFIRMED. The door editor
     is a question about the door boxes, and the answer to it is what MOVES the
     plates and re-runs the loops — so drawing the old answer under the question
     would be showing somebody wiring derived from boxes they are in the middle
     of correcting. It comes back the moment the editor closes; `layers.electrical`
     itself is untouched, so nothing has to be put back. */
  /* --- AND THE COVE STEP TURNS THE OUTLINES UP AND THE PLAN DOWN -----------
     THE GESTURE IS AIMED AT A LINE, WHICH NO OTHER GESTURE ON THIS CANVAS IS.
     A no-light zone is boxed over open ceiling, a spot's box encloses a piece
     of furniture, a sconce is a click at a wall with a foot of tolerance either
     side. A cove is dragged ALONG a wall and seats on the wall it starts on —
     so the one thing the drawing has to make easy to hit is the outline, and
     for the whole of this app's life that outline has been OFF by default and
     the thing under it — somebody else's scan, at full strength, with its own
     wall lines a few pixels away from ours — has been on.

     SO `region: true` AND `dim: true`, FOR THE LENGTH OF THE STEP ONLY. Our
     polygon is what the press is projected onto (see `coveWallAt`), so it is
     the only line on the sheet that is actually true here; the scan's own walls
     are a picture of the same wall, off by however much the trace was off by.
     Turning ours on and fading theirs makes the line you can hit the line you
     can see. Both are derived, not set: `layers` is untouched, so the View
     switches and the saved plan come back exactly as they were the moment Done
     is pressed.

     THE FADE IS NOT `layers.dim`, AND THAT IS THE ONE SUBTLE PART. `dim` is
     ELEMENT OPACITY on the plan itself, which does not wash a drawing towards
     the ground — it makes it SEE-THROUGH, and what is behind it in night mode
     is the page, which carries this app's graph-paper wallpaper. Turning it on
     over a scan on the negative would have put 24px graph paper through every
     room; the DXF branch in PlanCanvas has a note about the same hole, which is
     why it paints its own black sheet. Night mode drops `dim` for a related
     reason of its own: it exists to keep black ink legible over a black scan.
     So the wash is a SCRIM of the ground's own colour laid over the plan and
     under our line work — see `wash` in PlanCanvas. It cannot reveal anything
     behind it because it is opaque paint, it works on both grounds by taking
     the ground's colour, and it leaves every layer switch alone.

     THE OUTLINE'S INK FOLLOWS THE GROUND TOO — see `regionInk` in PlanCanvas,
     the same rule the no-light zones take — so neither mode is left drawing a
     line in the colour of the thing behind it. */
  const canvasLayers = useMemo(() => {
    const base = layers.invert
      ? { ...layers, dim: false, cells: false, region: false, labels: false }
      : layers;
    const aiming = stepTool?.id === 'cove' ? { ...base, region: true } : base;
    const doors = doorEdit ? { ...aiming, electrical: false } : aiming;
    /* --- AND THE WALL STEP TAKES EVERYTHING OFF BUT THE PLAN ---------------
       ONE SPACE'S EDGES ARE THE SUBJECT, so they have to be the only thing on
       the sheet that reads. Every layer here is a mark our own drawing makes —
       a fitting, a tag, a plate, a wire, a cell — and every one of them sits
       within a few pixels of the wall being clicked. The scan itself stays, at
       half strength (see `wash`), because you still have to know which room you
       are in.
       DERIVED AND NOT SET, exactly as the cove step's `region` is: `layers` is
       untouched, so the View switches and the saved plan come back precisely as
       they were the moment Done is pressed. */
    return wallEdit ? { ...doors,
      cells: false, region: false, lights: false, labels: false, fan: false,
      zones: false, accents: false, spots: false, switchboards: false,
      electrical: false } : doors;
  }, [layers, doorEdit, stepTool, wallEdit]);

  /* --- THE ELECTRICAL PASS WAS HERE, AND IT HAS BEEN RETIRED ---------------
     `computeElectrical` and `planElectrical` — the bolt in the list of spaces.
     One room, one vision call, one spinner. It ran the accent pass first if it
     had not run (two of the rules read a fitting that pass places), then asked a
     narrow question of its own: is there a television on the wall opposite the
     bed?

     THE ANSWER TO THAT QUESTION IS NOW ASSUMED. The wall facing the bed gets two
     plates in every bedroom, whether or not a console was ever drawn on it — see
     the header of planSwitchboards for why that trade is the right way round.
     With the television no longer looked for, nothing in the switchboard rules
     costs a model call, so there is nothing left to ASK for: the boards are a
     memo over the door boxes, the placed sconces and the bed box, and they are
     simply there. `boardResults` further down is the whole pass now.

     tvDetect.js AND /api/accents' `tv` TASK ARE STILL THERE, unwired. They are
     the prompt and the endpoint, not the decision to spend a call, and leaving
     them costs nothing while the new rule is being lived with. */

  const { projections: { surfacesPx, taskSpotsPx, accentZonesPx, wallCellsPx } } = useScenePlanProjections({
    rooms, surfaceResults, surfaceDismissed, manualSurfaces, wallResults, pxPerFt, artDismissed,
    opt, accentResults, accentDismissed, manualAccents, reverseCoves, shelfStrips, ceilingShapes
  });

  /* --- THE BOARDS, THE BAYS, THE FEEDS, THE FLOWS AND THE SHEET -------------
     ALL OF IT IS features/electrical/ NOW, and it is composed further down this
     file rather than here — see the note at `useElectrical`. It stood at this
     line because this is where its inputs land; it stands below `svgPoint`
     because that is where its gestures can be made. Nothing between the two
     points reads a plate, a wire or a schedule, so the move is a move and not a
     reordering of anything. */


  /* --- WHAT THIS PLAN ADDS UP TO ------------------------------------------
     THE PLAN'S TOTALS, THE SPOTS THAT LANDED AND THE SCHEDULE ITSELF ARE ALL
     features/lighting-planner/ NOW, and they are composed a little below this
     rather than here: the analysis reads the projected tracks, modules and array
     lamps, so it cannot stand above the call that builds them. Nothing between
     the two points reads a total, a count or a schedule row, so the move is a
     move. See that feature's README. */

  /* --- THE CEILING-GEOMETRY DOMAIN ------------------------------------------
     THE FEATURE'S SECOND CALL SITE, AND IT SITS ABOVE THE LIGHTING ANALYSIS AND
     `placeArray` FOR THE REASON THE BLOCK IT REPLACES GAVE: both read
     `arrayOutline`, and a `useCallback` evaluates its dependency ARRAY on every
     render, so a hook naming it below its own `const` would touch the binding
     before it existed — "Cannot access 'arrayOutline' before initialization",
     which is a blank screen and not a warning. Anything a callback names, in
     its body or its deps, is declared above it.

     THE COMMANDS AND THE GESTURES ARE COMPOSED FURTHER DOWN, where the things
     they need exist: arming this tool puts six other machines away and that
     list is App's, and the two geometry snaps read `snapTargets`, which is
     App's and reads this call's `coveShapesPx`. See the feature's README.

     NOTHING HERE HOLDS DOCUMENT STATE. The shapes and the drawn tracks are read
     out of `doc` and written through `docActions` at the third call site. */
  const geometry = useCeilingGeometry({
    state: geomState, rooms, pxPerFt, opt, selShapeId,
    addTool, cobMode, boardPlace, zoneMode, readOnly, doc,
  });
  const arrayOutline = geometry.arrayOutline;
  const shapeAtPointer = geometry.lookup.at;
  const geomUnder = geometry.lookup.forTool;

  /* --- WHAT IS ON THE CEILING, PROJECTED -----------------------------------
     THE FITTING FEATURE'S SECOND CALL SITE, AND IT STANDS WHERE THE BLOCK IT
     REPLACES STOOD — above the lighting analysis, which names `tracks.modulesPx`
     and `arrays.lampsPx` for its grouping and again for the schedule. A `useMemo`
     evaluates its dependency array on every render, so a reader above its own
     `const` is a temporal dead zone and a blank screen.

     IT TAKES THE CEILING GEOMETRY THROUGH ITS PUBLIC INTERFACE AND NOTHING
     ELSE. `arrayOutline` is `useCeilingGeometry`'s documented entry — one
     geometry id in, one path out — and it is the only thing the fittings know
     about how a cove, a guide or a track run is drawn.

     NOTHING HERE HOLDS DOCUMENT STATE. The arrays, the modules and the lamps are
     read out of the stores handed in; nothing is copied and nothing is written
     from there. */
  const fixtures = useFixtures({
    state: fixtureState, rooms, pxPerFt, country,
    ceilingShapes, trackFixtures, cobArrays, manualCobs,
    arrayOutline, ceilingMmFor, selShapeId,
  });
  /* THE NAMES THIS FILE ALREADY USED. Five of them are read by the BOQ, the
     lumen counting, the analysis highlight and the markup, all of which are
     App's and none of which moved. */
  const { runsPx: magTracksPx,
          modulesPx: trackModulesPx, selId: selTrackId } = fixtures.tracks;
  const { lampsPx: arrayCobsPx, draftPx: draftArrayPx,
          selPathPx: selArrayPathPx, bar: selArrayBar } = fixtures.arrays;
  const cobBasisFor = fixtures.cob.basisFor;


  /* --- WHAT THIS PLAN ADDS UP TO, ROOM BY ROOM AND AS A SCHEDULE -----------
     THE FEATURE'S SECOND CALL SITE, AND ITS POSITION IS LOAD-BEARING IN BOTH
     DIRECTIONS. It reads the projected fittings above it — `tracks.modulesPx`,
     `arrays.lampsPx` — so it cannot stand any higher; and `useFixtureCommands`
     below it is handed `spaceAnalysis`, which the diffuser allocator runs
     backwards, so it cannot stand any lower. A `useMemo` evaluates its
     dependency array on every render, so a reader above its own `const` is a
     temporal dead zone and a blank screen.

     IT TAKES FOUR DOMAINS THROUGH THEIR PUBLIC LISTS AND NOTHING ELSE — the
     scene's accent runs and task surfaces, the fittings' tracks, modules and
     array lamps, the rooms' polygons and ambient grids. Nothing in there
     reaches into any of their private files.

     NOTHING THERE HOLDS DOCUMENT STATE. The wattage overrides, the finishes, the
     placed lamps, the arrays and the ceiling objects are read out of the stores
     handed in; nothing is copied and nothing is written from there.

     `setOptionPick` IS PASSED IN because one effect in there moves the panel:
     clicking a fitting on the drawing reveals the analysis row it is, and the
     options pill over the chunk it stood in has to go with it. The pill is
     App's. */
  const { analysis: lightingAnalysis, boq: lightingBoq } = useLightingAnalysis({
    rooms, pxPerFt, source, country, projectId,
    accentZonesPx, taskSpotsPx,
    magTracksPx, trackModulesPx, arrayCobsPx,
    manualCobs, cobArrays, ceilingObjs,
    materials, fixtureWatts, ceilingMmFor,
    selCobId, selArrayId, selModuleId, selAccId, selSpotId, selLightId,
    docActions, setOptionPick,
  });
  /* THE NAMES THIS FILE ALREADY USED. Six are read by the footer, the Result
     panel, the space detail and the schedule tab, and `spaceAnalysis` is handed
     to the fitting commands below; every one of those bindings is App's. Taken
     off the group rather than reached through it for the reason the geometry's
     four setters are: several of them are named in dependency arrays, and the
     group is a fresh object every render. */
  const { totals, planLumens, spaceAnalysis, highlight: analysisHighlight,
          stripRuns, spotsPlaced, troubles } = lightingAnalysis;
  /* AND THE TWO HALVES OF THE SCHEDULE, taken off rather than reached through
     for the reason above: `boq` is named in three dependency arrays and
     `boqFile` in a fourth, and the group is a fresh object every render. */
  const { table: boq, file: boqFile } = lightingBoq;

  /* --- WHAT A CHUNK HAS ALREADY BEEN DECIDED TO BE -------------------------
     BOTH OF THESE ARE THE FITTING FEATURE'S NOW and both are taken off the call
     site above as `fixtures.cob.specInForce` and `fixtures.cob.basisFor`. The
     rule — a lamp somebody OVERRULED answers for its whole chunk, and mere
     presence does not — is in `chunkSpecInForce`; the two facts outside the cell
     it needs, the country's efficacy and the ceiling's height, are assembled in
     `useFixtures`. They stood HERE rather than with the rest of the COB
     machinery because `autoplaceIn` named them in its dependency array, and a
     hook's deps are ordinary expressions in the component body: a `const` below
     them does not exist yet. Both halves went together and the reason went with
     them. */

  /* --- EVERY ACT ON A FITTING THAT IS NOT A POINTER GESTURE ----------------
     THE FITTING FEATURE'S THIRD CALL SITE, AND IT STANDS WHERE `autoplaceIn`
     STOOD. It is the highest point at which everything it needs exists: the
     basis pair is built at the second call site above, `spaceAnalysis` — which
     the diffuser allocator runs backwards — is two hundred lines above that, and
     `arrayOutline` is the geometry's own. It has to be ABOVE the geometry
     commands, four hundred lines down, because `allocateOnTrack` is handed to
     them: what a committed magnetic track is FILLED with is this domain's
     question, not the geometry's. See both READMEs.

     THE ONE COMMAND DELIBERATELY NOT HERE is `openArray`. Opening one bar is
     also an act of closing six other machines, and that list is App's — so it
     is a gesture's command, at the fifth call site, with the list handed in.

     `setOptionPick` IS PASSED IN, because two of these commands move the panel:
     filling a run and clipping the first module onto one both change the two
     figures at the top of the Analysis, and a tool that changed a room's verdict
     silently would be the one act on this drawing worth watching, performed off
     screen. The pill is App's. */
  const fixtureCommands = useFixtureCommands({
    state: fixtureState, fixtures, docActions, rooms, pxPerFt, readOnly,
    manualCobs, cobArrays, trackFixtures,
    arrayOutline, spaceAnalysis, setSel, setOptionPick,
  });
  /* THE NAMES THIS FILE ALREADY USED — the panel's chips, the array bar's five
     controls, the ToolRail, the fan's sweep row and the keydown handler's nine
     Delete branches all call these, and every one of those bindings is App's. */
  /* THE ONE NAME HERE THAT IS NOT A CALL SITE. Filling a ceiling's own grid is
     this feature's command, and the control it sits under is the lighting
     workflow's panel — so it is taken off here and handed STRAIGHT ON to
     `useLightingPlanner`, which re-exposes it beside the per-space state that
     says which ceilings are switched on. See the space detail's two props. */
  const setAutoplace = fixtureCommands.autoplace.set;
  const { place: placeArray, setSpec: setArraySpec,
          setShape: setArrayShape, remove: deleteArray } = fixtureCommands.arrays;
  const { setSpec: setTrackModuleSpec, isRow: isModuleRow,
          remove: deleteModule, allocateOnTrack } = fixtureCommands.modules;
  const { setSpec: setCobSpec, remove: deleteCob,
          dropRun: dropCobRun } = fixtureCommands.cob;
  /* THE TWO OBJECT COMMANDS ARE ALIASED RATHER THAN REACHED THROUGH THE GROUP,
     because the keydown effect names one of them in its dependency array: the
     group is a fresh object every render and naming IT there would re-bind the
     window listener on every frame. Same reason the geometry's four setters are
     taken off its session. */
  const { remove: deleteObjects, setSweep: setFanSweep } = fixtureCommands.objects;
  const resetLightMove = fixtureCommands.lights.reset;

  /**
   * MAY THIS EXPORT GO AHEAD — one gate, awaited by all nine export buttons.
   *
   * See the note on `onBeforeExport` in the props. The two rules that matter are
   * both here rather than at nine call sites: no gate at all means yes, and a
   * gate that THROWS also means yes. The second is the one worth stating twice —
   * a lead-capture form that failed must never be the reason somebody does not
   * get the file they asked for, so the failure is logged and the download runs.
   * Only a person actively closing the question stops it.
   */
  const gateExport = useCallback(async () => {
    if (!onBeforeExport) return true;
    try { return (await onBeforeExport()) !== false; }
    catch (err) {
      console.warn('[export] the contact gate failed — exporting anyway', err);
      return true;
    }
  }, [onBeforeExport]);

  /** The schedule as a file. Three formats, one table — see boqExport.js.
   *  THE THREE FORMATS ARE PREPARED IN features/lighting-planner/ AND ARE HANDED
   *  OVER HERE. Naming the file, titling the sheet and encoding the table are
   *  facts about the SCHEDULE; putting a blob in front of a person is a fact
   *  about a BROWSER, and it is the thing the contact gate stands in front of.
   *  So the boundary runs between the two, and the gate stays on this side. */
  const exportBOQ = useCallback(async (fmt) => {
    // GATED ONCE FOR ALL THREE FORMATS, which is the whole reason this stayed a
    // single function when the buttons were split out.
    if (!await gateExport()) return;
    const f = boqFile(fmt);
    download(f.name, f.data, f.mime);
  }, [boqFile, gateExport]);


  // An image reaches the tracer with no scale yet; the tracer is where it gets
  // set, so `trace` covers "measure this plan", "correct what was found" and
  // "draw one the detector missed".
  /* --- THE HIGH-LEVEL LIGHTING WORKFLOW -----------------------------------
     THE FEATURE'S THIRD CALL SITE, AND THE PUBLIC ONE. What it means to light a
     plan: what a space is claimed for, which passes run over it and in what
     order, what the loading screen says while they do, and what happens to a
     room that fails. The pipeline itself — the bed passes before the layout, the
     classifier, the accents, the task surfaces, two and three calls at a time,
     the checklist, the cancellation and the milestone at the end — is in
     features/lighting-planner/usePlanPipeline.js, and the ordering note that
     used to sit at the head of this block sits at the head of that file.

     IT STANDS WHERE `runPipeline` STOOD, which is the highest point at which
     everything it needs exists: the analysis group is built above (because
     `useFixtureCommands`, between the two, is handed `spaceAnalysis`), the
     recognition and room-intelligence commands are composed above that, and the
     autoplace command is taken off the fitting commands a few lines up.

     IT COORDINATES THE OTHER DOMAINS THROUGH THEIR PUBLIC COMMANDS AND NOTHING
     ELSE — `computeBedFit`, `refindBeds` and `absorbBedRows` are
     features/recognition/'s; `computeRoomType`, `computeAccents` and
     `computeSurfaces` are features/room-intelligence/'s. All six are handed in
     from this file, which is where cross-domain wiring belongs.

     AND `usePlanDoc` REMAINS THE ONE DOCUMENT BOUNDARY. Every answer the run
     produces is written through `docActions`; the only thing the feature holds
     is the run's own screen, which is the first call site above. */
  const lighting = useLightingPlanner({
    run: lightingRun,
    analysis: lightingAnalysis, boq: lightingBoq,
    source, outlines, outlinesPx, rooms, pxPerFt, projectId, useBoundingRect,
    planAreaSqft,
    roomTypes, detections, autoSpots, docActions,
    bedSets, computeBedFit, refindBeds, absorbBedRows,
    computeRoomType, computeAccents, computeSurfaces,
    setAutoplace,
    readOnly, onClaimLayout, setPickingId, setOutlinesOpen, hideCoach, milestone,
  });
  /* THE NAMES THIS FILE ALREADY USED — the tracer's two buttons, the loading
     screen, the panel's Stop, the recompute buttons, the space detail's wattage
     rows and the chunk pill's arrows all call these, and every one of those
     bindings is App's. */
  /* `claim` IS NOT TAKEN OFF HERE and used to be a `const` in this file. Its
     four call sites were the tracer's two buttons and the pipeline, and all
     three of those are inside the feature now — so the gate is reached through
     the two acts below it rather than by hand, which is the point of it. */
  const { lightWholePlan, lightOneRoom,
          run: runPipeline, stop: stopPipeline,
          setRowWatts, cycleChunkOption } = lighting.commands;
  const loaderRooms = lighting.pipeline.loaderRooms;

  /* `outlinesOpen` IS THE FLAG THAT USED NOT TO EXIST — see its declaration.
     `!litIds.length` stays alongside it and is not redundant: a plan with
     outlines and nothing lit has no design to show, so it belongs on the tracer
     whether anybody asked for it or not. The flag adds the other way in. */
  const step = !source ? 'upload'
    : (outlinesOpen || !litIds.length) ? 'trace'
    : pickingId ? 'chunks'
    : 'plan';
  // NEVER THE TRACER IN READ-ONLY. `step` is 'trace' whenever nothing has been
  // lit yet, which is a perfectly normal state for a plan somebody abandoned —
  // and the tracer is an editing surface end to end. The viewer shows the drawing
  // with whatever outlines exist instead, and the panel says plainly that there
  // is no layout.
  const showTrace = step === 'trace' && !readOnly;

  /* WHY A DRAWN RUN IS NOT ON THE PLAN, one line per reason —
     `geometry.tracks.noteLines`. See features/ceiling-geometry/geometryRules.js
     for the per-room ask and the most-specific-wins ranking. */

  /* WHAT THIS STEP HAS PUT ON THE PLAN, AND HOW TO TAKE IT BACK. Two tools, two
     lists, one readout — kept as a table rather than as a pair of ternaries in
     the markup, because the noun and the list it counts have to stay together:
     a spot's drag makes a task SURFACE (the fitting is placed off it, see the
     spot branch in `onZoneUp`) and a cove's drag makes a cove, and reading
     the wrong one would report a plausible number that is about something
     else. The next tool to earn a step adds a row here or renders no count. */
  const PLACED = {
    cove:  { n: manualCoves.length, one: 'cove', many: 'coves',
             clear: () => docActions.clearCoves() },
    track: { n: manualTracks.length, one: 'run', many: 'runs',
             // AND THE EDITOR GOES WITH THEM. It is open on one of these paths
             // by id, and clearing the list would leave it holding an id that
             // no longer names anything.
             clear: () => { docActions.clearTracks(); closeTrackEdit(); } },
  };
  const placedHere = PLACED[stepTool?.id]
    ?? { n: manualSurfaces.length, one: 'spot', many: 'spots',
         clear: () => docActions.clearSurfaces() };

  /* --- ARRIVING AT THE DESIGN SCREEN TURNS THE PLAN DARK -------------------
     THE TWO STEPS WANT OPPOSITE GROUNDS AND THAT IS NOT AN INCONSISTENCY.
     Tracing is done ON somebody else's drawing: you are reading their line
     work, finding a wall, clicking a corner — and a scan is white paper with
     black ink on it, so inverting it to trace makes the thing you are reading
     harder to read for no gain. The design step's subject is not the plan, it
     is the LIGHT: pools, throws, strips, glows, every one of them drawn in the
     cream ramp, and cream on white paper is four percent of contrast. So the
     drawing goes to a negative at exactly the moment it stops being the subject.

     IT WATCHES `litIds`, NOT `step`, AND THAT IS THE SECOND VERSION OF THIS.
     The first watched `step` — `trace` → not `trace` — which was right while the
     only way to see the tracer was to have no layout. It is not right now that
     the Outlines tab is a detour that keeps the lights (see `outlinesOpen`): a
     trip to fix one wall and back is a `trace` → `plan` crossing, so somebody
     who had deliberately switched to paper would find it black again on the way
     back, every time. "The plan just got its first lights" is the moment worth
     acting on, and empty → non-empty says exactly that and nothing else. A
     partial relight, which grows a non-empty list, does not fire it either.

     Two consequences worth stating, because both are why this is not simply a
     different default:

       A REOPENED PLAN KEEPS WHAT IT WAS SAVED WITH. A plan that already has a
       layout mounts at `plan` and never crosses, so somebody who deliberately
       switched back to paper last week finds paper. `invert` is serialised with
       the other layers for exactly that reason.

       AND IT IS ARMED ONLY ONCE THE RESTORE HAS LANDED, which is the whole
       reason `restoreApplied` is read here. A reopened plan mounts with `litIds`
       empty and stays that way for one or more commits — the file has to be read
       before the restore can be applied — so the restore itself is an empty →
       non-empty crossing in every detail except intent. Without this guard,
       reopening a plan somebody had switched back to paper would silently turn
       it black again. `applyEditor` and `setRestoreApplied(true)` are called in
       one synchronous block, so the first render that reads the flag true is the
       same render that carries the restored `litIds` — see the note on the flag
       itself for why it is state and not a ref. Until then the ref is parked at
       `null`, which is not a state this fires from. */
  const hadLights = useRef(null);
  useEffect(() => {
    const lit = litIds.length > 0;
    if (restoreApplied && hadLights.current === false && lit) {
      docActions.setLayer('invert', true);
    }
    hadLights.current = restoreApplied ? lit : null;
  }, [litIds, restoreApplied, docActions]);
  // The BOQ tab takes the whole stage. Gated on `source` as well as on the tab
  // so that a stale `view` cannot survive a Clear and render a schedule of a
  // plan that is no longer loaded.
  const boqOpen = view === 'boq' && !!source;
  /* THE SWITCHBOARD SHEET TAKES THE STAGE TOO, on the same terms and gated the
     same way: a stale `view` must not survive a Clear and render a schedule of
     plates from a plan that is no longer loaded.

     `sheetOpen` IS THE TEST EVERY OTHER GATE WANTS, and it is why this is two
     constants rather than one. Roughly a dozen places ask "is the plan on
     screen" and every one of them was written as `!boqOpen`, because the
     schedule was the only thing that ever replaced it. Two answers to one
     question is how the second one gets forgotten in half of them — and the
     symptom would be the appearance toolbar and the plan's own keyboard
     shortcuts still live over a sheet of paper. Where a gate genuinely means the
     SCHEDULE and not "some sheet", it still says `boqOpen`. */
  /* `!readOnly` AS WELL, AND IT IS ABOUT THE WAY BACK. A viewer has no tab strip
     — see the gate on it — so the only routes into a view for them are the
     buttons ViewerPanel offers, and it offers one: the schedule. A `view` of
     'boards' restored from somebody else's saved state would put an operator on
     a sheet with no way off it. The sheet itself is perfectly readable read-only
     (`onHeight` is withheld and the numbers are printed), so this is a routing
     guard rather than a judgement about who may see it: add a button to
     ViewerPanel and this condition comes off. */
  const boardsOpen = view === 'boards' && !!source && !readOnly;
  const sheetOpen = boqOpen || boardsOpen;
  /* WHICH TAB THE PANEL IS ON, WITH ONE FALLBACK. `view` is what somebody
     clicked; this is what can actually be rendered. Admin is scoped to role 1,
     and a role can go away underneath a stale tab — a session that loses it, or
     an operator's own plan opened from the ordinary route — so an admin `view`
     without `isAdmin` reads as Design rather than as an empty column. Nothing
     resets `view` for it: the tab comes back if the role does. */
  const panelView = view === 'admin' && !isAdmin ? 'design' : view;
  const picking = pickingId ? rooms.find((r) => r.id === pickingId) : null;
  // `!doorEdit` FOR THE SAME REASON `!zoneMode` IS HERE: the picker replaces
  // the canvas, and a gesture that needs the drawing under it cannot be asked
  // for while the drawing has been swapped out for a chooser.
  const showPicker = step === 'chunks' && !zoneMode && !doorEdit && !!picking && !readOnly;

  /**
   * BACK TO THE OUTLINES, AND IT NO LONGER THROWS ANYTHING AWAY.
   *
   * THIS USED TO ASK "ARE YOU SURE" AND THEN EMPTY `litIds`, because `step` was
   * derived from that list and there was no other way to show the tracer. The
   * cost was the whole layout: every memo downstream reads the lit outlines, so
   * the grids, the fittings and the schedule went, and the only way back was a
   * full relight of every space on the sheet — re-run and re-charged.
   *
   * IT IS NOW WHAT A TAB IS SUPPOSED TO BE. `outlinesOpen` shows the tracer and
   * `litIds` is not touched, so nothing is discarded, nothing needs confirming,
   * and the Design tab puts the layout back exactly as it was. Corner edits made
   * while here reach the drawing on their own — `rooms` is a memo — and the ones
   * that need the model run again are collected in `dirtyIds` and offered on the
   * tracer's own foot.
   *
   * IT STILL RETURNS A BOOLEAN. The tab treats `false` as "decline to switch",
   * and nothing here can refuse any more — but the signature is the tab's
   * contract, not this function's, and the other two tabs read it too.
   */
  const backToOutlines = () => {
    setPickingId(null);
    setOutlinesOpen(true);
    // AND THE BOQ TAB HAS TO LET GO OF THE STAGE. `boqOpen` is checked BEFORE
    // `showTrace` in the stage's branch list, so coming here while the schedule
    // is up would leave the schedule on screen with the tracer's panel beside
    // it — the one combination of view and step that renders neither screen
    // properly.
    // ONLY THAT ONE, AND IT USED TO BE UNCONDITIONAL. This is reached from a
    // button in the Spaces list's heading now rather than from a tab of its
    // own, so forcing 'design' meant a trip to straighten one wall put you back
    // on a tab you had deliberately left. The schedule is the only view that
    // cannot survive the crossing.
    // ...AND SO DOES THE SWITCHBOARD SHEET, for exactly the same reason: both
    // replace the stage, and the tracer needs the stage.
    docActions.requireStageView();
    return true;
  };

  /** ...and the way back, which is the same flag and no questions either. */
  const backToDesign = () => { setOutlinesOpen(false); docActions.setView('design'); };


  // --- interactions ---------------------------------------------------------
  const svgPoint = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * source.w, y: ((e.clientY - r.top) / r.height) * source.h };
  };

  /**
   * Direct manipulation of a ceiling object.
   *
   * THE COPY BUG, written down because it is a trap anyone would fall into
   * twice. Placement used to live on the SVG's onClick, and the handles called
   * `e.stopPropagation()` on POINTERDOWN. Those are two different events:
   * stopping the pointerdown does nothing at all to the click that the browser
   * synthesises afterwards, so every drag ended with a click bubbling up to the
   * canvas, and the canvas dutifully placed a second object on top of the one
   * you had just moved.
   *
   * The fix is not another stopPropagation. It is that the whole gesture now
   * lives in the pointer events — down, move, up — with nothing on click at
   * all. Pointerdown bubbles child-first, so a handle stopping it means the
   * canvas genuinely never hears about it, and there is no second event left to
   * leak. See onZoneDown, which is the canvas's pointerdown.
   *
   * Everything is stored in FEET. A drag is the size the thing actually is,
   * not the size it looked at the zoom it was dragged at.
   */
  /**
   * What this drag may line up with, in plan pixels.
   *
   * Rebuilt per gesture rather than held in state: the rooms and the other
   * objects are exactly what they are at the moment the drag starts, and a
   * stale target list is a point snapping to where something used to be.
   */
  /**
   * Is this point on a ceiling we are laying out?
   *
   * OUTSIDE A ROOM, NOTHING IS ACTIVE. The canvas is bigger than the rooms on
   * it — there is margin, there are rooms nobody is lighting, there is the rest
   * of the sheet — and a tool that stays armed out there is a tool that drops a
   * fan into the garden because you clicked to dismiss something. So the
   * surrounding canvas is dead space that cancels rather than acts, and the
   * cursor says so before you click.
   */
  const insideAnyRoom = useCallback((p) => rooms.some((r) => {
    const poly = r.plan?.polygonPx || r.geo?.polygonPx;
    return poly && pointInPolygon(p, poly);
  }), [rooms]);

  /**
   * WHICH space a point is in, and not merely whether it is in one.
   *
   * Every hand-placed fitting has to be attributed to a space or it is invisible
   * to everything downstream: the BOQ counts per space, the spot placer needs
   * the space's chunks and its foot-local origin, and a strip with no `roomId`
   * is a strip that appears on the drawing and in no schedule.
   */
  const roomAt = useCallback((p) => rooms.find((r) => {
    const poly = r.plan?.polygonPx || r.geo?.polygonPx;
    return poly && pointInPolygon(p, poly);
  }) || null, [rooms]);

  /* --- THE MANUAL DOWNLIGHT'S LIVE MODEL -----------------------------------
     THE FITTING FEATURE'S FOURTH CALL SITE, AND IT IS DOWN HERE BECAUSE
     `roomAt` IS. Which space the pointer is over decides the recommendation, the
     wall band and the bed warning, and that hit test is App's — the doors, the
     accents, the strip and the ceiling objects all ask it — so it is built
     directly above and handed in. A hook's arguments are evaluated during
     render, which is why this cannot stand at the second call site with the
     projections. Same split the scene feature makes across several calls.

     `setGuides` IS PASSED IN because the alignment lines are not one feature's —
     see the note where they are declared. */
  const cobTool = useCobTool({
    state: fixtureState, manualCobs, pxPerFt, ceilingMmFor, zoom,
    roomAt, basisFor: cobBasisFor, addTool, roomTypes,
    fanClearance: opt.fanClearance, setGuides,
  });
  /* THE NAMES THIS FILE ALREADY USED. All eight are read by the markup — the
     lamps and their throw rings on the canvas, and the bar at the foot of the
     stage — which is App's. */
  const manualCobsPx = cobTool.cobsPx;
  const cobRoom = cobTool.room;
  const cobShow = cobTool.show;
  const cobInForce = cobTool.inForce;
  const cobDirty = cobTool.dirty;
  const cobGuide = cobTool.guide;
  const cobBlocked = cobTool.blocked;

  /**
   * WHICH WALL A COVE CLICK LANDED ON, and everything the rest of the gesture
   * needs to stay on it.
   *
   * `nearestWall` is the same function the sconce uses to seat itself, asked of
   * a degenerate one-pixel box round the click — a point, expressed the way that
   * function wants it. What comes back is a polygon EDGE, which is the unit that
   * matters here: "stick to that wall segment only" means this edge and not the
   * wall it is part of, so a room whose north side is drawn as two edges either
   * side of a recess gives two separate walls to cove along, which is correct —
   * the ceiling does not run straight across the recess.
   *
   * AXIS-ALIGNED ONLY, AND IT SAYS SO RATHER THAN COPING. Every rectangle in
   * this feature is `{x0,y0,x1,y1}` — the band, and the no-light zone taken from
   * it — so a slot on a diagonal wall has nowhere to be STORED, never mind
   * drawn. The detector never meets the case because it works off an
   * axis-aligned wall grid. A hand tool pointing at a real polygon does, and the
   * honest answer is to refuse the click with a reason.
   *
   * THE INWARD NORMAL IS DECIDED BY THE POLYGON, not by which side of a
   * bounding box the edge sits on. Probing a hair off the wall's midpoint and
   * asking `pointInPolygon` works on an L-shaped room, where an inner edge's
   * "inside" is not the side a bounding rect would guess.
   */
  const coveWallAt = useCallback((pt, poly) => {
    if (!poly?.length || !(pxPerFt > 0)) return null;
    const w = nearestWall({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y }, poly);
    if (!w) return null;
    const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y;
    const L = Math.hypot(dx, dy);
    if (!(L > 1e-9)) return null;
    const horizontal = Math.abs(dy) <= Math.abs(dx) * 1e-6;
    const vertical = Math.abs(dx) <= Math.abs(dy) * 1e-6;
    if (!horizontal && !vertical) {
      return { angled: true, reason: 'That wall runs at an angle. A reverse cove '
        + 'is set out square to the ceiling, so it can only go on a wall that runs '
        + 'straight across or straight down the sheet.' };
    }
    // A hair off the midpoint, on both sides: whichever is in the room is in.
    const mid = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
    const n = { x: -dy / L, y: dx / L };
    const eps = Math.max(1, pxPerFt * 0.08);
    const inward = pointInPolygon({ x: mid.x + n.x * eps, y: mid.y + n.y * eps }, poly)
      ? n : { x: -n.x, y: -n.y };
    const { t } = alongWallAt(w, pt);
    return { a: { ...w.a }, b: { ...w.b }, wallIndex: w.index, inward,
             t: Math.max(0, Math.min(L, t)), L };
  }, [pxPerFt]);

  /**
   * WHICH ROOM A COVE PRESS BELONGS TO, AND IT IS NOT SIMPLY `roomAt`.
   *
   * THE TARGET IS THE OUTLINE ITSELF, WHICH IS THE BOUNDARY OF THE TEST. Every
   * other gesture on this canvas is aimed at the INSIDE of a room — a box over
   * a bed, a click on open ceiling — so `pointInPolygon` is exactly the right
   * question for them. A cove is aimed AT the line, and half of the pixels a
   * careful person clicks when they are aiming at a line are on the far side of
   * it. `roomAt` answers null for those, the press did nothing at all, and the
   * tool looked broken precisely when it was being used most carefully.
   *
   * HALF A FOOT, IN THE DRAWING'S OWN UNITS, with an 8px floor so a plan zoomed
   * out to a thumbnail still has a grabbable edge. Wide enough to forgive the
   * aim, far too narrow to seat a cove on a room the pointer is not near.
   *
   * NEAREST WINS, NOT FIRST FOUND. Two rooms share a party wall, so a press on
   * it is within tolerance of both; taking the nearer one puts the cove in the
   * room whose side of the wall was pressed, which is the only reading of that
   * press anybody intends.
   */
  const coveRoomAt = useCallback((pt) => {
    const inside = roomAt(pt);
    if (inside) return inside;
    const tol = Math.max(8, (pxPerFt || 0) * 0.5);
    let best = null;
    let bestD = Infinity;
    for (const r of rooms) {
      const poly = r.plan?.polygonPx || r.geo?.polygonPx;
      if (!poly?.length) continue;
      const w = nearestWall({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y }, poly);
      if (!w) continue;
      // The perpendicular distance to that edge: the along-wall component is
      // `t`, so what is left of the offset vector is the distance off it.
      const { t, u } = alongWallAt(w, pt);
      const d = Math.hypot(pt.x - (w.a.x + u.x * t), pt.y - (w.a.y + u.y * t));
      if (d < bestD) { bestD = d; best = r; }
    }
    return bestD <= tol ? best : null;
  }, [roomAt, rooms, pxPerFt]);

  /** Where along the stored wall the pointer is, clamped to that wall's ends. */
  const coveTAt = useCallback((pt) => {
    if (!coveFrom) return 0;
    const { t } = alongWallAt({ a: coveFrom.a, b: coveFrom.b }, pt);
    return Math.max(0, Math.min(coveFrom.L, t));
  }, [coveFrom]);

  /** Put the tool away and forget any half-made gesture. */
  const disarmAdd = useCallback(() => {
    setAddTool(null); setStripFrom(null); setAddAt(null);
    setAddSnap(null); setAddGhost(null);
    setCoveFrom(null); setCoveNote('');
    /* THE COB BAR, THE HALF-MADE CHANGE ON IT AND THE ARRAY BEING SET UP — the
       fitting session's half, called where the block stood. `cobStanding`
       deliberately survives it; see `reset.cobGesture`. */
    fixtureReset.cobGesture();
    /* AND THE GEOMETRY HIGHLIGHT, which belongs to the tool that was offering to
       take it. A lit stroke under no tool is a line claiming a press that would
       now do something else entirely. */
    setGeomHover(null);
    /* AND THE ARMED MODULE. The DRAWER itself stays up as long as a run is
       selected — it is what says which fittings that run can take — and its
       cells simply unlatch because nothing is armed any more. */
    fixtureReset.module();
    // A HALF-CLICKED RUN IS NOT A TRACK. Putting the tool away throws the path
    // away with it, exactly as `abandonShape` does for the cove pen: the
    // alternative is a set of points with no tool armed to finish them.
    trackPen.reset(); setGuides([]);
  }, [trackPen, setGeomHover, fixtureReset]);


  /* --- ARMING THE GEOMETRY TOOL: THE HALF THAT IS APP'S ---------------------
     ONE POINTER PIPELINE, ONE OWNER — the same clearing `openZoneEdit` and
     `openBoardPlace` do. A press with two tools armed is a press with two
     meanings, and the geometry tool draws across the whole ceiling rather than
     at a point, so it is the least forgiving of the three about sharing.

     IT IS HERE AND NOT IN THE FEATURE because the list is the interesting part
     and App is the only place that knows all seven owners. `openShapeTool` calls
     it exactly where the block stood, below its `!arm` return — see that
     command. Same split `openBoardPlace` already has. */
  const geometryStandDown = useCallback(() => {
    setZoneEdit(false); setZoneMode(false); setDraftZone(null);
    setDoorEdit(false); setDoorDraft(null); setDoorDrag(null);
    closeBoardPlace();
    setArmed(null); setGhost(null); setGuides([]);
    disarmAdd();
  }, [disarmAdd, closeBoardPlace, setArmed, setGhost]);

  /* SPANNING A TRACK ALSO FILLS IT — the diffuser allocator, and it is the
     module domain's. What a run is filled WITH reads the space analysis, the
     family catalogue and the room's shortfall, none of which is geometry; it is
     taken off the fitting commands above and handed to `useGeometryCommands` on
     the line it was handed on before. See `allocateOnTrack` in
     features/fixtures/useFixtureCommands.js. */

  /* --- THE GEOMETRY TOOL'S COMMANDS -----------------------------------------
     THE FEATURE'S THIRD CALL SITE, AND IT IS HERE BECAUSE OF THE TWO THINGS IT
     TAKES FROM THIS FILE. `geometryStandDown` is the list of machines arming
     the tool has to put away, which is arbitration between features and App's;
     `allocateOnTrack` is what a committed magnetic track is FILLED with, which
     is the module domain's question. Both are declared directly above.
     `allocateOnTrack` stood four hundred lines below this and moved up with
     nothing else changed — it is a `useCallback` with no effect in it and
     nothing between the two points reads it. */
  const geometryCommands = useGeometryCommands({
    state: geomState, geometry, docActions,
    ceilingShapes, manualTracks, trackFixtures,
    setSel, setGuides,
    allocateOnTrack, standDown: geometryStandDown,
  });
  const {
    abandonShape, closeShapeTool, clearShapeEdit, openShapeTool,
    commitShape, pickShapeTool, duplicateShape, deleteShape,
    finishTrack, finishOpenCove, setHeldOffset,
    deleteTrack, deleteTrackPoint, openTrackEdit, closeTrackEdit,
  } = geometryCommands;

  /* --- WHY THIS BLOCK IS UP HERE ---------------------------------------------
     Beside `disarmAdd` rather than beside the pointer handlers that use it, and
     for the reason the undo note near the top of this file describes from the
     other side: the keydown listener answers Escape and Delete for this editor,
     and that effect is bound hundreds of lines above the canvas gestures. Its
     dependency array is evaluated during render, so a callback declared after
     it is a temporal dead zone and a ReferenceError on first paint. */
  /* --- CONFIRMING THE DOORS -------------------------------------------------
     The gesture is the no-light zone's, because it is the same gesture: press
     on empty plan and drag out a box. What is different is that the boxes
     already there are grabbable, since most of the work here is correcting a
     detection rather than making one from nothing.

     THE HIT TEST IS SMALLEST-FIRST. Door boxes overlap — a box round the leaf
     and a box round the swing survive doors.js's de-dup — and the box that is
     hard to reach is always the small one inside the big one. Area order is
     what makes it reachable at all. */
  const doorHitAt = (p) => {
    const inside = doors.filter((d) => d.rect
      && p.x >= d.rect.x0 && p.x <= d.rect.x1
      && p.y >= d.rect.y0 && p.y <= d.rect.y1);
    inside.sort((a, b) => ((a.rect.x1 - a.rect.x0) * (a.rect.y1 - a.rect.y0))
                        - ((b.rect.x1 - b.rect.x0) * (b.rect.y1 - b.rect.y0)));
    return inside[0] ?? null;
  };

  /** A rect shifted by (dx, dy) and kept on the sheet, corner-clamped. */
  const shiftRect = (r, dx, dy) => {
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    const x0 = Math.min(Math.max(r.x0 + dx, 0), Math.max(0, source.w - w));
    const y0 = Math.min(Math.max(r.y0 + dy, 0), Math.max(0, source.h - h));
    return { x0, y0, x1: x0 + w, y1: y0 + h };
  };

  /**
   * OPEN THE EDITOR, AND PUT EVERY OTHER GESTURE AWAY.
   *
   * The canvas has one pointer pipeline and four things that can own it — an
   * armed ceiling object, an add tool, the zone band, and now this. Two owners
   * is a press with two meanings, so opening this disarms the rest rather than
   * competing with them.
   */
  const openDoorEdit = useCallback(() => {
    setDoorEdit(true);
    setSel(clear());
    setZoneEdit(false); closeBoardPlace(); closeShapeTool();
    setDoorDraft(null); setDoorDrag(null);
    setZoneMode(false); setDraftZone(null);
    setArmed(null); setGhost(null); setGuides([]);
    disarmAdd();
  }, [disarmAdd, closeShapeTool, closeBoardPlace, setArmed, setGhost]);

  /* --- THE ELECTRICALS -------------------------------------------------------

     THE WHOLE DOMAIN, AND THIS IS ITS SECOND CALL SITE. The step's own flag was
     asked for hundreds of lines above — `pressState` carries it and is built
     long before there is a pointer to hand anybody — and everything else waits
     until here, because `svgPoint`, `svgRef` and `pressState` are what the plate
     drag and the wire drag are made of, and a hook's arguments are evaluated
     during render. The scene feature is split across several calls for the same
     reason and the room passes across two.

     WHAT IT IS GIVEN IS THE SCENE, the room-intelligence results the rules read,
     the shared selection service, and the document. Nothing about the wiring is
     computed on this side of the call any more: the three board passes, the
     flows, the plate compositions, the schedule, both gestures and every command
     are in features/electrical/. See its README. */
  const electrical = useElectrical({
    rooms, pxPerFt, obstaclesPx, wardrobesPx, accentZonesPx, taskSpotsPx,
    roomTypes, doors, projectId, country, layers, doorEdit,
    sel, setSel, svgPoint, svgRef, pressState, boardStep, doc, docActions,
  });
  electricalReset.current = electrical.reset;
  const { switchboardsPx, flowsPx, selBoardId, selFlowId, boardDrag, flowDrag,
          onBoardPointerDown: boardPointerDown, boardPointerMove, boardPointerUp,
          onFlowPointerDown: flowPointerDown, onFlowGripDown: flowGripDown,
          flowPointerMove, flowPointerUp } = electrical.canvas;
  const { selBoard, selBoardExtras, selBoardParts, heightOf,
          country: sbCountry, placedCount: placedBoardCount,
          /* THE GATE, ANSWERED BY THE FEATURE THAT IS BEHIND IT. It is the
             document's `doorsOk`; what the switch below does about it is App's,
             because the way in is the door step and that is another domain. */
          doorsOk } = electrical.panel;
  const { groups: boardSheet } = electrical.sheet;
  const { pickFlow, reorderBoardUnit, setBoardOutlet, setBoardAmps, setBoardHeight,
          addBoardPoint, removeBoardPoint, deleteBoard, placeBoardAt,
          openBoardPlace: enterBoardPlace, clearPlacedBoards,
          toggleLayer: toggleElectricalLayer,
          /* `closeBoardPlace` IS ALREADY IN SCOPE — it came off the step at the
             feature's first call site, because four other steps stand this one
             down and all four are defined above this line. Same function. */
          confirmDoors: confirmDoorsForWiring } = electrical.commands;

  const closeDoorEdit = useCallback(() => {
    setDoorEdit(false); setSel(clear()); setDoorDraft(null); setDoorDrag(null);
  }, []);

  /* --- THE NO-LIGHT ZONE, AS A STEP RATHER THAN A TAB ----------------------
     THE SAME SHAPE AS THE DOOR EDITOR ABOVE, FOR THE SAME REASON. What is being
     asked for is a GESTURE ON THE DRAWING, and the panel's job while it is being
     made is to say what the gesture is and then get out of the way. As a tab in
     the toolbox it competed with two palettes and a readout; as a step it is the
     only thing on screen, which is what makes a marquee over somebody's
     furniture read as the thing to do next.

     IT ARMS THE CANVAS ON THE WAY IN. The old tab needed a second press — the
     tab, then “+ Add a No Light Zone” — which is a click spent on getting
     ready. Pressing the button in the palette IS asking to draw one, so the band
     is live the moment the panel changes, and it stays live after a box lands
     because somebody drawing one zone is usually drawing two.

     AND IT PUTS EVERY OTHER GESTURE AWAY, exactly as `openDoorEdit` does: one
     pointer pipeline, one owner. */
  const openZoneEdit = useCallback(() => {
    setZoneEdit(true);
    setSel(clear());
    closeBoardPlace(); closeShapeTool();
    setZoneMode(true); setDraftZone(null);
    setDoorEdit(false); setDoorDraft(null); setDoorDrag(null);
    setArmed(null); setGhost(null); setGuides([]);
    disarmAdd();
  }, [disarmAdd, closeShapeTool, closeBoardPlace, setArmed, setGhost]);

  const closeZoneEdit = useCallback(() => {
    setZoneEdit(false); setZoneMode(false); setDraftZone(null);
  }, []);

  /* --- SAYING WHAT EACH WALL IS FINISHED IN ---------------------------------
     THE STEP IS features/room-intelligence/useWallMaterials.js. WHAT IS LEFT
     HERE IS THE HALF THAT IS APP'S: standing every other step and tool down on
     the way in, exactly as `openZoneEdit` does. One pointer pipeline, one owner
     — and App is the only place that knows every owner, which is why this is
     not in the feature. The order is the order it always was: the step opens
     and the space is focused, and then everything else goes away. */
  const openWallEdit = useCallback((roomId) => {
    enterWallEdit(roomId);
    docActions.setFocusId(roomId); setSel(clear());
    setZoneEdit(false); setZoneMode(false); setDraftZone(null);
    closeBoardPlace(); closeShapeTool();
    setDoorEdit(false); setDoorDraft(null); setDoorDrag(null);
    setArmed(null); setGhost(null); setGuides([]);
    disarmAdd();
  }, [disarmAdd, closeShapeTool, docActions, enterWallEdit, closeBoardPlace,
      setArmed, setGhost]);

  /* --- PUTTING SWITCHBOARDS ON WALLS BY HAND --------------------------------
     THE STEP IS features/electrical/useBoardStep.js. WHAT IS LEFT HERE IS THE
     HALF THAT IS APP'S, exactly as it is for the wall step above: standing
     every other step and tool down on the way in. One pointer pipeline, one
     owner — and App is the only place that knows every owner, which is why this
     is not in the feature. The order is the order it always was: the step
     opens, and then everything else goes away. */
  const openBoardPlace = useCallback(() => {
    enterBoardPlace();
    closeShapeTool();
    setZoneEdit(false); setZoneMode(false); setDraftZone(null);
    setDoorEdit(false); setDoorDraft(null); setDoorDrag(null);
    setArmed(null); setGhost(null); setGuides([]);
    disarmAdd();
  }, [disarmAdd, closeShapeTool, enterBoardPlace, setArmed, setGhost]);




  /**
   * PICKING ONE UP OFF THE SHEET.
   *
   * The same two-part gesture every other object on this canvas has: the press
   * selects, and the drag only becomes a MOVE once the pointer has gone past a
   * few pixels. Without the slop a click to select writes a new position onto a
   * shape that never moved, which re-keys its chunk and re-runs the layout for
   * nothing.
   *
   * ALT CLONES, exactly as it does for a ceiling object: the original stays put
   * and the copy comes away under the pointer. That is the "copy it around like
   * any other object" the brief asks for, said in the gesture this app already
   * uses for it.
   */
  /* --- MOVING ONE LIGHT INSIDE ITS CELL -------------------------------------
     THE FLEXIBILITY IS ALREADY IN THE ENGINE and this is a way to spend it by
     hand. A small light may sit anywhere within `centreBand` — ±20% of its own
     cell, so ±1.4 ft in a 7 ft cell and ±1 ft in a 5 ft one — and the layout
     picks a point in that box for its own reasons. Sometimes a person can see a
     better one: a lamp a foot off a beam, a row shifted to clear a curtain
     track. The box does not grow for them; what changes is who chooses inside
     it.

     THE BOX IS DRAWN, WHICH IS THE HALF THAT MAKES IT USABLE. `centreBand` is a
     number in a config object; the same number as a rectangle on the ceiling
     under the fitting you are holding is a rule you can see the edge of. Nobody
     has to be told what the limit is — the light stops.

     THE WHOLE GESTURE IS features/fixtures/ — the one drag on this canvas that
     refuses pointer capture, the clamp that runs per frame, the drop that is the
     only write, and the ref that stops the click at the end of it reading as a
     press on bare plan. `resetLightMove` is there too: Delete on a picked light
     is a DISMISSAL of the override and not a delete, because a light cannot be
     removed. */



  /* --- OPENING AN ARRAY'S BAR: THE HALF THAT IS APP'S ----------------------
     ONE CONTEXTUAL BAR AT A TIME, AND IT IS NOT A PREFERENCE. Both bars on this
     drawing are `position: fixed`, centred over the stage, 26px off its foot —
     see BOTTOM in CobSpec and in ShapeMenu, which deliberately share the figure
     on the argument that the two are never up together. Two of them up IS two
     rows of buttons in one place: the second draws over the first, and half the
     controls somebody can see belong to an object they are not looking at.

     SO OPENING ONE IS ALSO AN ACT OF CLOSING, and the LIST is here rather than
     in the feature because the list is the interesting part and App is the only
     place that knows all seven owners. `openArray` calls it exactly where the
     block stood — see features/fixtures/useFixtureGestures.js. Same split
     `openShapeTool` and `openBoardPlace` already have. */
  const arrayStandDown = useCallback(() => {
    closeShapeTool(); clearShapeEdit();
    closeTrackEdit(); closeBoardPlace();
    setZoneEdit(false); setZoneMode(false); setDraftZone(null);
    setDoorEdit(false); setDoorDraft(null); setDoorDrag(null);
    setGuides([]);
    disarmAdd();
  }, [closeShapeTool, clearShapeEdit, closeTrackEdit, closeBoardPlace, disarmAdd]);




  /**
   * THE ANSWER, AND THE ONE THING IT TURNS ON.
   *
   * Confirming is not "save the doors" — the doors were already saved, edit by
   * edit, because they are the same list the scale and the board pass read. It
   * records that a person has LOOKED, and that is the gate the wiring is behind.
   */
  const confirmDoors = useCallback(() => {
    closeDoorEdit();
    confirmDoorsForWiring();
  }, [closeDoorEdit, confirmDoorsForWiring]);

  const deleteDoor = useCallback((id) => {
    docActions.removeDoor(id);
    setSel((cur) => (idOf(cur, 'door') === id ? clear() : cur));
  }, [docActions]);

  /**
   * The door boxes AS DRAWN — the list, with the box being dragged at where the
   * pointer has it rather than at where it started.
   *
   * The whole reason `doorDrag` holds a rect at all. See the note on it: writing
   * a move into `doors` on every pointermove would re-run the board pass, the
   * bay pass and the flows on each frame, so the app's door list only changes on
   * release and this is what closes the gap for the eye.
   */
  const doorEditBoxes = useMemo(() => (doorDrag
    ? doors.map((d) => (d.id === doorDrag.id ? { ...d, rect: doorDrag.rect } : d))
    : doors), [doors, doorDrag]);

  /* --- A DOOR BOX'S WHOLE GESTURE -------------------------------------------

     THE LAST OF THE TEN AND THE ODDEST, in three ways that are each a decision.

     NO SLOP. `slopPx: 0`, and it is the only drag here that takes that
     position. A door box is not selectable by a bare press that might have been
     a nudge — the door editor is a modal step that owns the whole canvas, and a
     press either lands on a box or draws a new one — so there is no click
     meaning for a threshold to protect. What guards against a click writing
     nothing is the rect comparison in `onCommit`.

     NO POINTER CAPTURE FROM THE HOOK. The door branch of `onZoneDown` takes it
     on the canvas itself, before it knows whether the press hit a box or is
     about to start a new one, because BOTH need it. Handing the hook a `capture`
     would take it twice.

     NO STORE AND NO POSITION — what it carries is a RECT. Writing a move into
     `doors` on every pointermove would re-run the board pass, the bay pass and
     the flows forty times a second, and the scale too if the box being dragged
     is the ruler. So the gesture holds the live rect, `doorEditBoxes` draws it,
     and `onCommit` is the one write.

     THE OFFSET IS FROM THE PRESS, NOT FROM THE LAST FRAME — rule 2, and here the
     difference shows at the edge of the sheet, which is where half of these
     boxes are since a door is in a wall. `shiftRect` clamps, so an incremental
     delta would keep counting while the box was held against the edge and the
     box would then come away from the cursor by however far the pointer had gone
     past it. Measured from the press, a clamped box stays clamped until the
     pointer comes back for it. */
  const door = useDrag({
    state: [doorDrag, setDoorDrag],
    point: svgPoint,
    slopPx: 0,
    onMove: (p, { drag: d }) => door.set((cur) => (cur
      ? { ...cur, rect: shiftRect(d.base, p.x - d.from.x, p.y - d.from.y) }
      : cur)),
    /* THE RELEASE IS THE ONE WRITE.
       A PRESS THAT SELECTED AND DID NOT MOVE WRITES NOTHING. The rect would be
       identical, but the list's identity would not — and `doors` is what the
       board pass, the bay pass and the flows are all memoised on, so a click to
       select a box would re-run every one of them for nothing. */
    onCommit: (ids, d) => {
      if (d.rect.x0 === d.base.x0 && d.rect.y0 === d.base.y0) return;
      docActions.moveDoor(d.id, { rect: d.rect, openingPx: openingPx(d.rect) });
    },
  });

  const snapTargets = useCallback((excludeId, points = []) => collectTargets({
    rooms: rooms.map((r) => ({ id: r.id, name: r.outline.name, polygonPx: r.plan?.polygonPx || r.geo?.polygonPx })),
    objects: obstaclesPx.filter((o) => o.source === 'placed'),
    /* --- THE GEOMETRY ALREADY DRAWN ON THE CEILING ----------------------
       THE LINES SOMEBODY PUT THERE ON PURPOSE. A guide rectangle exists for one
       reason — to set the next thing out against — and until this was passed in,
       it was the only geometry on the sheet nothing could align to: the walls
       clicked, the placed fans clicked, and the line drawn deliberately a foot
       inside the wall did not. Everything that snaps on this screen goes through
       this one function, so a second rectangle, a pen path, a dragged fitting
       and an array's own ring all catch it from here.
       ITS SETTING-OUT LINE AND NOT ITS TAPE. `coveShapesPx` carries both — see
       `tape` there — and the tape is three inches outside the line on a pocket:
       offering both would put two targets three inches apart on one object and
       make which of them you caught a matter of luck. The line is the one the
       drawing is dimensioned from. */
    shapes: geometry.canvas.coveShapes.map((sh) => ({ id: sh.id, pts: sh.pts })),
    /* WHATEVER THE GESTURE IS ALREADY HOLDING — the pen's own points. Passed
       per call rather than collected here because they are not a fact about the
       drawing: they exist for the length of one path. */
    points,
    exclude: excludeId,
  }), [rooms, obstaclesPx, geometry.canvas.coveShapes]);

  /** Screen pixels -> plan pixels. The tolerance must not stiffen as you zoom. */
  const snapTol = () => SNAP_DEFAULTS.tolScreenPx / (zoom || 1);

  /* --- THE GEOMETRY TOOL'S POINTER ------------------------------------------
     THE FEATURE'S FOURTH AND LAST CALL SITE, AND IT IS BELOW `snapTargets`
     BECAUSE THE TWO GEOMETRY SNAPS READ IT. That function is App's — the
     ceiling objects, the lights and the COB snap against the same targets — and
     it reads `geometry.canvas.coveShapes`, so the projections have to be built
     above it and the gestures below it. `penSnap` and `shapeSnapFt` stood
     exactly here before; the presses and the drag moved down to join them, and
     every one of them is a plain function or a `useDrag` that nothing between
     the two points calls. */
  const geometryPointer = useGeometryGestures({
    state: geomState, commands: geometryCommands, geometry,
    rooms, pxPerFt, ceilingShapes, roomAt, svgPoint, svgRef, pressState, addTool,
    docActions, setSel, setGuides, snapTargets, snapTol,
  });

  /**
   * THE SAME SNAP ENGINE THE TRACER USES, pointed at this screen's geometry.
   *
   * Placing a strip by eye and placing an outline corner by eye are the same
   * problem — a run that is a hair off the wall it is concealed behind is as
   * wrong as a corner that is — so they get the same answer rather than a
   * second, weaker one written for this screen. `snap.js` takes segments, and
   * the segments here are the SPACE OUTLINES: on an image they are the only
   * geometry that exists, and they are the walls anyway, since an outline is
   * traced on the inner face. On a DXF the drawing's own line work joins them,
   * so a strip can catch the edge of a wardrobe the outline knows nothing about.
   */
  const placeIndex = useMemo(() => {
    if (!source) return null;
    const segs = [];
    for (const r of rooms) {
      const poly = r.plan?.polygonPx || r.geo?.polygonPx;
      if (!poly?.length) continue;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, layer: 'space' });
      }
    }
    if (isVector && source.segmentsPx?.length) segs.push(...source.segmentsPx);
    return buildSnapIndex(segs, isVector ? (source.circlesPx || []) : []);
  }, [rooms, source, isVector]);

  /**
   * Snap a point while a fitting is being placed.
   *
   * ORTHO IS ON BY DEFAULT AND SHIFT RELEASES IT, which is the tracer's
   * convention and the opposite of the one this screen uses for resizing a
   * ceiling object. That inconsistency is deliberate: the reference for this
   * gesture is drawing a line on a plan, and a run along a wall is horizontal
   * or vertical far more often than not.
   */
  const snapPlacing = useCallback((p, { last = null, ortho = true } = {}) => {
    if (!placeIndex) return { ...p, kind: 'free', guide: null, align: [] };
    return snapAt(placeIndex, p, {
      tol: SNAP_DEFAULTS.tolScreenPx / (zoom || 1),
      last, points: [], ortho, alignTo: [],
    });
  }, [placeIndex, zoom]);

  /**
   * The sconce as it would be placed, from the cursor — not an approximation of
   * it. `placeZone` is the function that will actually run on the click, so
   * running it on every move and drawing the result is the only preview that
   * cannot disagree with what lands. It is O(the polygon's edges); a room has
   * a dozen.
   */
  const sconceGhostAt = useCallback((p) => {
    const room = roomAt(p);
    if (!room) return null;
    const poly = room.plan?.polygonPx || room.geo?.polygonPx;
    if (!poly?.length) return null;
    const r = Math.max((pxPerFt || 12) * 0.35, 4);
    const z = placeZone({ id: 'ghost', type: 'sconce', roomId: room.id,
      rect: { x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r } }, poly);
    return z?.point ? z : null;
  }, [roomAt, pxPerFt]);


  /* --- SNAPPING A DRAGGED OBJECT, AND THE WHOLE CEILING-OBJECT GESTURE -----
     BOTH ARE features/fixtures/. `applySnap` is the round trip through
     `snapTargets` with the shift lock's frozen axis kept out of the result and
     out of the guides, and it is private to that feature: the ceiling object's
     drag, its armed ghost and the press that places one are its only three
     callers. The gesture itself is one press with three meanings — move, resize,
     rotate — of which only the first is a translation. */

  /* --- EDITING WHAT THE MODEL PROPOSED -------------------------------------
     The accent gesture, the three ways of deleting a run, and the task spots —
     features/room-intelligence/useRoomEditing.js.
     A SECOND CALL INTO THE SAME FEATURE, and it is this far down because of
     what it needs: `svgPoint`, `pressState`, the projections and `deleteShape`
     are all defined above this line and below the passes, and a hook's
     arguments are evaluated during render. The scene feature is split across
     three calls for the same reason. Nothing is shared between the two halves
     but the document. */
  const roomEditing = useRoomEditing({
    rooms, pxPerFt, zoom, svgPoint, svgRef, pressState,
    accentZonesPx, taskSpotsPx, manualAccents, manualCoves, manualSurfaces,
    addTool, zoneMode, setSel, setArmed, deleteShape, docActions,
  });
  /* BOTH RESET GROUPS, MERGED INTO THE ONE REF `resetForNewPlan` READS. It is
     assigned here rather than at the first call site because this is the first
     line at which both exist. */
  roomIntelReset.current = { ...roomIntel.reset, ...roomEditing.reset };
  const { accentDrag: accDrag, onAccPointerDown: accPointerDown,
          accPointerMove, accPointerUp,
          onSpotPointerDown: spotPointerDown } = roomEditing.canvas;
  const { deleteAccent, deleteSpot } = roomEditing.commands;

  /* --- THE FIVE DRAGS AND THE PRESSES THAT PLACE ---------------------------
     THE FITTING FEATURE'S FIFTH AND LAST CALL SITE, AND IT IS THE LOWEST
     BECAUSE OF WHAT IT NEEDS: `svgPoint`, `svgRef`, `pressState`,
     the geometry's two hit tests, `snapTargets` and `arrayStandDown` are all
     defined above this line and below the passes, and a hook's arguments are
     evaluated during render. The room editor above it is a second call into its
     own feature for exactly the same reason.

     EVERY ONE OF THE FIVE IS A `useDrag` AND EVERY PRESS IS A PLAIN FUNCTION,
     so nothing between the earlier call sites and this one calls any of them.
     They moved DOWN, past `snapTargets`, to join the snap they were already
     calling at run time.

     FOUR THINGS ARE HANDED IN THAT BELONG TO THIS FILE. `snapTargets` and
     `snapTol` are generic — the ceiling objects, the lights, the doors and the
     COB all snap against the same targets. `arrayStandDown` is the list of
     machines opening an array's bar has to put away. `selAccId` is the room
     domain's, and it is in the ceiling-object press guard because a bare press
     on plan is how a selected accent is let go. And `setGuides`, `setOverRoom`
     and `setAddAt` are the three cues no single feature owns. */
  const fixtureGestures = useFixtureGestures({
    state: fixtureState, fixtures, cobTool,
    rooms, pxPerFt, zoom, opt, source, addTool, selAccId, overRoom,
    manualCobs, cobArrays, trackFixtures, ceilingObjs,
    svgPoint, svgRef, pressState,
    roomAt, insideAnyRoom, snapTargets, snapTol,
    arrayOutline, shapeAtPointer, geomUnder, geomHover, setGeomHover,
    clearShapeEdit, standDown: arrayStandDown,
    docActions, setSel, guides, setGuides, setOverRoom, setAddAt, setOptionPick,
  });
  /* THE NAMES THIS FILE ALREADY USED. The canvas props, the pointer router's
     three branches and the keydown handler's guards all read them, and every one
     of those bindings is App's. */
  const { onLightPointerDown: lightPointerDown, onObjPointerDown: objPointerDown,
          onCobPointerDown: cobPointerDown, onArrayPathDown: arrayGrab,
          onModulePointerDown: modulePointerDown } = fixtureGestures.canvas;
  const fixtureDrag = fixtureGestures.drag;

  /** Escape backs out, Delete removes. The two keys every editor answers to. */
  useEffect(() => {
    // NO GUARD ANY MORE, AND THAT IS BECAUSE OF CTRL+Z. This bound the listener
    // only when something was selected or armed, which is right for keys that
    // act on a selection and wrong for one that acts on the document: undo has
    // to answer when nothing is picked, which is exactly the state somebody is
    // in immediately after deleting the thing they had selected. Every branch
    // below already checks its own condition, so an always-bound listener does
    // nothing it did not do before — and the read-only guard further down is
    // still the one that decides whether to listen at all.
    const onKey = (e) => {
      const t = e.target;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      // UNDO, BEFORE EVERY OTHER BRANCH. Not because the order matters to the
      // keys — nothing else here answers to Ctrl+Z — but because this is the one
      // branch that is about the editor as a whole rather than about whatever
      // happens to be selected, and reading it first says so.
      //
      // BOTH MODIFIERS, because this app runs on both kinds of keyboard and
      // neither audience should have to learn the other's shortcut. Shift+Z and
      // Ctrl+Y are both redo for the same reason.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) undoRef.current?.redo(); else undoRef.current?.undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        undoRef.current?.redo();
        return;
      }
      /* --- THE DOOR EDITOR ANSWERS BOTH KEYS FIRST, AND IT RETURNS --------
         It is a modal step: the panel beside it holds one question, and Delete
         while it is open means "that is not a door" — it cannot be allowed to
         also mean "take the space I had selected before I opened this out of the
         layout", which is what the branch at the foot of this handler would do
         with the very same keypress. Escape drops the selection if there is one
         and closes the editor if there is not, which is the two-stage back-out
         every other selection on this canvas has. */
      /* THE ZONE STEP ANSWERS ESCAPE FIRST, AND IT RETURNS. Same argument as
         the door editor below it: the panel holds one question, and Escape means
         “I am done drawing zones” — it cannot also be allowed to mean “drop
         whatever was selected before I got here”, which is what the branch at
         the foot of this handler would do with the same keypress. Delete is
         deliberately NOT answered: a zone is removed from its own row in the
         panel, and there is no zone selection on this canvas for a key to act
         on. */
      if (zoneEdit) {
        if (e.key === 'Escape') { e.preventDefault(); closeZoneEdit(); return; }
        return;
      }
      /* THE WALL STEP ANSWERS ESCAPE FIRST AND RETURNS, on the zone step's
         argument exactly: the panel holds one question and Escape means "I am
         done with the walls". A tone popup standing open answers its own Escape
         and stops the key here (see WallTonePopup, which listens in capture),
         so the two-stage back-out falls out of the two listeners rather than
         needing a stage flag. Delete is deliberately not answered: there is no
         wall selection to delete, and the branch at the foot of this handler
         would take the SPACE out of the layout with it. */
      if (wallEdit) {
        if (e.key === 'Escape') { e.preventDefault(); closeWallEdit(); return; }
        return;
      }
      /* --- THE TRACK PEN ANSWERS THREE KEYS AND RETURNS ---------------------
         The same argument the zone step makes above it: while the step is open
         the panel holds one question, and these keys mean things about the path
         in flight — they cannot also be allowed to mean "drop the selection I
         had before I got here", which is what the branch at the foot of this
         handler does with Escape and Delete.

         ENTER FINISHES, which is what Enter does at the end of a path in every
         drawing tool there is. BACKSPACE TAKES THE LAST POINT BACK, likewise —
         and it is why a mis-clicked corner is not a reason to start again.

         ESCAPE THROWS THE PATH AWAY BUT KEEPS THE PEN, and that two-stage
         back-out is deliberate: it is the same shape as the door editor's
         below, and the alternative — one Escape that both drops the path and
         disarms — means a person who wanted to redraw one leg loses the tool as
         well. With nothing drawn, Escape falls through to the ordinary way out.

         `addTool` AND NOT `stepTool`, because the keys are about the pen rather
         than about the panel: the step is what `stepTool` describes, and it
         happens to be open whenever this tool is armed. */
      /* --- THE POINT EDITOR ANSWERS BOTH KEYS FIRST, AND IT RETURNS ---------
         The same argument every step above it makes: while a path is open the
         canvas is about that path, and Delete has to mean "this corner" rather
         than "the space I had selected before I opened it", which is what the
         branch at the foot of this handler would do with the same keypress.
         Escape drops the point if one is picked and closes the editor if not —
         the two-stage back-out the door editor has. */
      if (geometry.tracks.editId) {
        /* DELETE MEANS THE POINT IF ONE IS PICKED AND THE WHOLE RUN IF NOT, and
           it RETURNS either way. That last part is the bug this fixes: the
           branch only claimed the key while a point was selected, so pressing
           Delete on a track you had just opened fell all the way through to the
           space branch at the foot of this handler — and took the room's entire
           layout out with it. A key pressed with a track open cannot be allowed
           to mean anything about the space behind it; that is the rule every
           step above states, and this branch was the one that did not keep it.

           DELETING THE RUN IS NOT DELETING ANY LIGHT. See `deleteTrack`: the
           fittings were never the track's, and they come straight back onto the
           grid the moment it stops being consulted. */
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          if (geometry.tracks.grip) return;
          if (geometry.tracks.selPt != null) deleteTrackPoint(geometry.tracks.editId, geometry.tracks.selPt);
          else deleteTrack(geometry.tracks.editId);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          if (geometry.tracks.selPt != null) setSelTrackPt(null); else closeTrackEdit();
          return;
        }
      }
      if (addTool === 'track') {
        if (e.key === 'Enter') { e.preventDefault(); finishTrack(); return; }
        if (e.key === 'Backspace' && !trackPen.isEmpty) {
          e.preventDefault(); trackPen.undo(); return;
        }
        if (e.key === 'Escape' && !trackPen.isEmpty) {
          e.preventDefault(); trackPen.reset(); return;
        }
      }
      /* THE COVE PEN ANSWERS THE SAME THREE KEYS, and it is the same pen — see
         usePen. Enter is the one that is new and it is the L-shaped cove: a path
         that lands on a wall at both ends can be finished OPEN, where clicking
         the first point closes it into a pocket. Two endings, two details.
         BACKSPACE TAKES THE LAST POINT BACK and Escape throws the path away but
         keeps the tool, exactly as the track pen's do — the same two-stage
         back-out, so a mis-clicked corner is not a reason to start again. */
      if (geometry.status.menuOn && geometry.status.tool === 'pen' && !covePen.isEmpty) {
        if (e.key === 'Enter' && geometry.panel.canFinishOpen) {
          e.preventDefault(); finishOpenCove(); return;
        }
        if (e.key === 'Backspace') { e.preventDefault(); covePen.undo(); return; }
      }
      if (doorEdit) {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (selDoorId) setSel(clear()); else closeDoorEdit();
          return;
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && selDoorId && !doorDrag) {
          e.preventDefault();
          deleteDoor(selDoorId);
          return;
        }
        // Ctrl+Z is handled above this and stays handled: it is about the
        // document rather than about whatever is selected.
        return;
      }
      if (e.key === 'Escape') {
        // THE STEP FIRST AND ON ITS OWN. A step has taken the panel over, so
        // Escape means "close it" and cannot also mean "drop the selection".
        if (boardPlace) { closeBoardPlace(); return; }
        /* THE SHAPE TOOL TAKES TWO ESCAPES WHERE THERE IS SOMETHING TO THROW
           AWAY, and that is deliberate rather than an oversight. A half-drawn
           pen path is work; closing the whole tool on the first press would take
           it away along with the bar, and the second press would then have
           nothing to do. First Escape abandons the draft, second puts the pen
           down — which is what the cross in the bar and the cove button in the
           panel do, in that order. */
        if (geometry.status.menuOn) {
          if (geometry.status.draft || !covePen.isEmpty || geometry.status.span) abandonShape();
          else closeShapeTool();
          return;
        }
        /* THE GRIPS COME OFF BEFORE THE SELECTION, which is the same
           innermost-first order the whole of this handler follows: Escape
           undoes the last thing you asked for, and asking for dimensions was
           the last thing. */
        if (geometry.shapes.editId) { setShapeEditId(null); return; }
        if (selShapeId) { setSel(clear()); return; }
        /* THE ARRAY'S BAR IS A CONTEXTUAL MENU AND CLOSES LIKE ONE, ahead of the
           plain selections below: it is the innermost thing open, and Escape
           undoes the last thing you asked for. */
        if (selArrayId) { setSel(clear()); return; }
        if (selModuleId) { setSel(clear()); return; }
        if (selLightId) { setSel(clear()); return; }
        /* THE COB DRAWER CLOSES WITH THE TOOL IT ARMED. `disarmAdd` puts the
           gesture away; leaving the drawer hanging open with neither cell
           latched would be a menu still claiming to be the live thing. */
        if (addTool) {
          disarmAdd();
          if (cobOpen) { setCobOpen(false); setCobMode(null); }
          /* THE TRACK DRAWER CLOSES WITH THE MODULE IT ARMED, exactly as the COB
             drawer does: a menu left hanging open with no cell latched is a menu
             still claiming to be the live thing. The GEOMETRY BAR goes too —
             opening the drawer raised it (see `onTrack`), so one Escape has to
             put away everything one press put up. */
          /* THE TRACK'S MODULE GOES WITH ITS TOOL, and the geometry bar with
             it: one press put both up (the rail cell raises the bar, a selected
             run raises the drawer), so one Escape has to put both away. */
          if (trackMode) { setTrackMode(null); closeShapeTool(); }
        }
        if (armed) { setArmed(null); setGhost(null); setGuides([]); }
        else if (selSpotId) setSel(clear());
        else if (selCobId) setSel(clear());
        else if (selAccId) setSel(clear());
        else if (selBoardId) setSel(clear());
        else if (selFlowId) setSel(clear());
        else if (selObjId) setSel(clear());
        else if (focusId) docActions.setFocusId(null);
        else setObjMode(false);
      }
      /* A SELECTED LIGHT, AND DELETE MEANS "PUT IT BACK WHERE THE RULES HAD IT".
         A light cannot be deleted — it is one cell's share of the ambient level
         and the ceiling has to carry it — so the only thing there is to take
         away is the position somebody chose for it. Exactly the argument the
         wire's own branch makes a few blocks down.
         AND THE BRANCH HAS TO EXIST EVEN WITH NOTHING TO UNDO, which is the part
         that matters: without the `return`, Delete on a picked light would fall
         all the way through to the SPACE and take the room out of the layout. */
      if ((e.key === 'Delete' || e.key === 'Backspace') && selLightId && !lightDrag) {
        e.preventDefault();
        resetLightMove(selLightId);
        return;
      }
      /* A SELECTED COVE SHAPE, FIRST AMONG THE DELETES. Not because it is the
         smallest thing on the sheet — it is one of the largest — but because
         picking one clears every other selection (see `shapePointerDown`), so
         when this is set it is the only thing Delete can be about. */
      /* A SELECTED ARRAY, AND DELETE TAKES THE WHOLE RUN. Twelve lamps on one
         ring are one decision — one row in the Analysis, one wattage, one optic
         — so there is no half of it to remove: the entry in `cobArrays` IS the
         fittings, and deleting it is the only thing "delete" can mean here.
         THE GEOMETRY STAYS. It was on the drawing before the array was set out
         on it and it is very often a cove's own setting-out line; taking a
         rectangle off the ceiling because somebody deleted the spots arranged
         inside it would be one press with two consequences. */
      /* A SELECTED MODULE, AND DELETE TAKES JUST THAT ONE. The run stays: a
         profile with one fewer diffuser on it is an ordinary thing to want, and
         deleting the carrier because somebody removed a fitting from it would be
         one press with two consequences. The run's own Delete is the shape's —
         see `deleteShape`, which takes every module with it. */
      if ((e.key === 'Delete' || e.key === 'Backspace') && selModuleId && !moduleDrag) {
        e.preventDefault();
        deleteModule(selModuleId);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selArrayId && !arrayDrag) {
        e.preventDefault();
        deleteArray(selArrayId);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selShapeId && !geometry.shapes.dragging) {
        e.preventDefault();
        deleteShape(selShapeId);
        return;
      }
      // A SELECTED SPOT, FIRST AMONG THE DELETES. A spot is the smallest and most
      // specific thing on this sheet, so it wins the key over the accent, the
      // ceiling object and the space — the same most-specific-first ordering the
      // note above the room branch describes.
      if ((e.key === 'Delete' || e.key === 'Backspace') && selSpotId) {
        e.preventDefault();
        deleteSpot(selSpotId);
        return;
      }
      /* A HAND-PLACED COB, AND DELETE REALLY DELETES IT. It has no generator
         behind it — nothing re-derives a lamp somebody put down — so there is
         nothing to dismiss and nothing to switch off; the fitting IS the record,
         and removing it from the list removes it from the drawing, the analysis
         and the plan that gets saved. Same rule the first of the three run cases
         below states, arrived at the same way. */
      if ((e.key === 'Delete' || e.key === 'Backspace') && selCobId && !fixtureDrag.cob) {
        e.preventDefault();
        deleteCob(selCobId);
        return;
      }
      /* A SELECTED RUN, AND THERE ARE THREE KINDS OF IT — see `deleteAccent`
         in features/room-intelligence/useAccentEditing.js, which carries the
         whole argument for why deleting one is three different acts and why
         filing it in the wrong list is silent. */
      if ((e.key === 'Delete' || e.key === 'Backspace') && selAccId && !accDrag) {
        e.preventDefault();
        deleteAccent(selAccId);
        return;
      }
      /* A SELECTED SWITCHBOARD. Above the ceiling objects and the space for the
         same most-specific-first reason the spot is above the accent: a plate is
         a small thing on a wall, and somebody who picked one and pressed Delete
         did not mean the room.
         IT IS A DISMISSAL AND NOT A DELETE, which is the whole of `deleteBoard`
         — see the note there. */
      if ((e.key === 'Delete' || e.key === 'Backspace') && selBoardId) {
        e.preventDefault();
        deleteBoard(selBoardId);
        return;
      }
      /* A SELECTED WIRE, AND DELETE MEANS "UNDO WHAT I DID TO IT".
         A flow cannot be deleted: it is the switch a fitting needs, it is
         derived from the fittings, and removing it from the drawing would be
         claiming a lamp with no way to turn it on. So the only thing there is
         to take away is the pair of overrides — the plate it was dragged onto
         and the bends it was nudged into — and Delete takes those, putting the
         wire back under the rules.

         AND THE BRANCH HAS TO EXIST EVEN IF IT DID NOTHING, which is the part
         that matters. Without it, Delete on a picked wire falls past the
         ceiling objects and reaches the SPACE — so picking a wire and pressing
         Delete would take the room out of the layout. */
      if ((e.key === 'Delete' || e.key === 'Backspace') && selFlowId && !flowDrag) {
        e.preventDefault();
        docActions.dropFlowOverrides(selFlowId);
        return;
      }
      // THE WHOLE SELECTION, not just the primary. Deleting one of four
      // selected objects and silently leaving the other three is the reading
      // nobody expects, and it is the one a single-id delete gives.
      if ((e.key === 'Delete' || e.key === 'Backspace') && selObjIds.length && !objDrag) {
        e.preventDefault();
        deleteObjects();
        return;
      }
      /* A SELECTED SPACE, AND THIS IS LAST ON PURPOSE. A fitting or a ceiling
         object selected inside a room is the more specific thing under the
         cursor, and every branch above returns — so Delete never takes the room
         out from under the fitting somebody meant to remove.

         It takes the space OUT OF THE LAYOUT rather than deleting its outline:
         the outline is the traced boundary and belongs to the tracer screen, and
         losing one to a keypress on a different screen would be unrecoverable
         work. Take it up again from the button under the spaces list.

         --- AND IT IS NOT ARMED WHILE A TOOL IS ---------------------------------
         `!addTool && !armed && !boardPlace` IS NEW AND IT CLOSES A REAL HOLE.
         `focusId` used to mean "somebody picked a space out of the list"; it now
         means "a space is open in the panel", which is the ordinary state of
         this screen — clicking a room is how you read its materials. So the
         fallthrough went from rare to constant, and any press of Delete that no
         branch above claimed silently dropped the room somebody was reading out
         of the layout, taking its height, its finishes and its wall tones with
         it.
         The presses that reach here with a tool in hand are exactly the ones
         that meant something else: a fitting that could not be selected because
         the tool had the pointer, or a mis-hit on open ceiling. Neither is a
         request to delete a room, and with a tool armed there is no way to see
         that one has been deleted. */
      if ((e.key === 'Delete' || e.key === 'Backspace') && focusId
          && !accDrag && !objDrag && !addTool && !armed && !boardPlace) {
        e.preventDefault();
        docActions.unlightRoom(focusId);
        docActions.setFocusId(null);
      }
    };
    // READ-ONLY: not bound at all. Every branch of this handler deletes
    // something — a fitting, a ceiling object, a space's layout — so the fix is
    // not to guard the branches but to never listen. The zoom keys are a second,
    // separate handler and they stay.
    if (readOnly) return undefined;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [objMode, armed, selObjId, selObjIds, objDrag, selAccId, accDrag, addTool, disarmAdd,
      finishTrack, trackPen, geometry.tracks.editId, geometry.tracks.selPt, geometry.tracks.grip,
      deleteTrackPoint, deleteTrack, closeTrackEdit,
      deleteAccent, focusId, readOnly, selSpotId, deleteSpot,
      docActions,
      selBoardId, deleteBoard, selFlowId, flowDrag, boardPlace, closeBoardPlace,
      doorEdit, selDoorId, doorDrag, deleteDoor, closeDoorEdit,
      zoneEdit, closeZoneEdit, wallEdit, closeWallEdit,
      geometry.status.menuOn, geometry.status.tool, geometry.status.draft, covePen,
      geometry.status.span, abandonShape, closeShapeTool,
      geometry.panel.canFinishOpen, finishOpenCove,
      selShapeId, geometry.shapes.dragging, deleteShape, geometry.shapes.editId,
      /* THE SETTERS THE GEOMETRY AND FITTING BRANCHES CALL. In the array
         because the scanner asks for them; a setter's identity is stable for the
         life of the component, so the listener is not re-bound on their
         account. */
      setShapeEditId, setSelTrackPt,
      setArmed, setGhost, setObjMode, setCobOpen, setCobMode, setTrackMode,
      selLightId, lightDrag, resetLightMove, selCobId, fixtureDrag.cob, cobOpen,
      deleteCob, deleteObjects,
      selArrayId, arrayDrag, deleteArray, trackMode,
      selModuleId, moduleDrag, deleteModule]);

  /**
   * OPEN A CHUNK'S OPTIONS. Called by a click on any ambient light — the light
   * carries the key of the design chunk that put it there — and by a click on a
   * cove line, which is the way back for a chunk lit by its strip alone.
   *
   * It selects the space as well. Clicking a fitting in a room the panel is not
   * describing and having the panel stay on the last room is the same
   * disagreement the canvas selection exists to prevent.
   */
  const pickChunkOptions = useCallback((roomId, key) => {
    if (!roomId || !key) return;
    hideCoach();
    docActions.setFocusId(roomId);
    setOptionPick({ roomId, key });
  }, [hideCoach, docActions]);

  /**
   * SELECT A SPACE FROM THE PANEL'S LIST — and open its ceiling options with it.
   *
   * The row used to do `setFocusId` alone, which left the two ways of asking
   * the same question behaving differently: clicking a downlight opened the pill
   * over its chunk (see `pickChunkOptions`), and clicking the SPACE that
   * downlight is in opened nothing. The pill is how a ceiling is changed, so the
   * list was the one route to a space that did not offer it.
   *
   * WHICH CHUNK, when a space has several. The BIGGEST by area, which is the one
   * the room reads as: an L-shaped space cut into a large rectangle and a short
   * leg is "that room with the leg off it", and a pill parked on the leg would
   * be answering about the wrong piece of ceiling. Measured in FEET off `wFt`
   * and `hFt` rather than off `rect`, so the answer cannot change with the zoom.
   *
   * `reduce` AND NOT `[0]`. The chunker does emit bigger-first today, so the
   * first entry is usually the right one — but that is a property of another
   * module's ordering, not a promise to this one, and a silently wrong pill is
   * not worth borrowing it for.
   *
   * DESELECTING CLOSES THE PILL. Toggling a row off means "no space is
   * selected", and a pill floating over a room the panel is no longer describing
   * is exactly the disagreement `pickChunkOptions` exists to prevent.
   */
  const optionPickFor = useCallback((roomId) => {
    const chunks = rooms.find((r) => r.id === roomId)?.designChunksPx ?? [];
    const biggest = chunks.reduce(
      (best, d) => (!best || d.wFt * d.hFt > best.wFt * best.hFt ? d : best), null);
    // A space whose layout failed has no chunks at all — select it and say
    // nothing, rather than opening a pill over a room with no ceiling in it.
    return biggest ? { roomId, key: biggest.key } : null;
  }, [rooms]);

  /* --- WHAT COUNTS AS LANDING ON THE DESIGN SCREEN -------------------------
     THE SCREEN AND NOT THE ROUTE THAT REACHED IT. There are four ways onto this
     drawing — a render finishing, reopening a saved plan, "Back to the design"
     from the Outlines tab, and closing the chunk picker — and the pill should
     open on the first three, because all three are somebody arriving at a
     ceiling they have not looked at yet in this sitting. Hanging the hint off
     the PIPELINE (which is where it started) got only the first of them: a
     reload of the very same plan landed on the identical screen and said
     nothing, which is exactly how somebody testing the feature by refreshing
     the page concludes it does not work.

     THE PICKER IS THE ONE EXCLUSION, and it is the reason this reads a previous
     value rather than just firing on `step === 'plan'`. Choosing a chunking
     leaves the design screen and comes straight back to it, mid-thought, on a
     room the user chose — yanking the selection to the living room at that
     moment would be the app interrupting a decision it had just asked for.

     `screen` FOLDS THE RUN IN AS A STATE OF ITS OWN, which is what makes the
     pipeline case work at all. `step` becomes 'plan' partway THROUGH a run —
     `setLitIds` lands in the geometry phase — so a bare step watcher recorded
     'plan' while the loader was still up and then saw no change when the loader
     came down. With the wait as its own value the sequence is busy → plan, and
     an arrival is a change like any other. */
  const screen = prep ? 'busy' : step;
  const wasScreen = useRef(null);
  useEffect(() => {
    const prev = wasScreen.current;
    wasScreen.current = screen;
    if (readOnly || screen !== 'plan') return;
    if (prev !== 'plan' && prev !== 'chunks') setLanded(true);
  }, [screen, readOnly]);

  /* --- AND SPENDING THE FLAG ------------------------------------
     ON THE NEXT PASS, NOT IN THE RUN, and the note on `landed` says why: the
     chunks and their options do not exist until React has re-rendered with the
     state the pipeline finished writing. `rooms` is in the dependencies for
     exactly that reason — the first pass where it is populated is the pass this
     fires on.

     `!prep` AND `step === 'plan'` ARE BOTH GUARDS AGAINST A LANDING THAT DID NOT
     HAPPEN. A run that was stopped from the panel clears `prep` with nothing
     lit, which leaves the tracer up; opening a pill under it would put a hint on
     a screen that is not showing.

     AND IT SPENDS THE FLAG BEFORE IT LOOKS, so a plan where nothing has options
     — every chunk standard, every ceiling flat — does not re-check on every
     later render of the same screen. */
  useEffect(() => {
    if (!landed || prep || step !== 'plan' || !rooms.length) return;
    setLanded(false);
    const at = introSpace(rooms, roomTypes, projectId);
    if (!at) return;
    docActions.setFocusId(at.roomId);
    setOptionPick({ roomId: at.roomId, key: at.key });
    /* THE PILL ALWAYS, THE CARD ONLY IF IT HAS NOT BEEN SWITCHED OFF HERE. They
       are two different promises: opening the pill is the app showing you what
       it decided about the ceiling and that the decision is yours, which is
       worth doing on every landing; the card is a sentence explaining the
       arrows, which is worth doing until somebody says stop. */
    if (!coachOff(planId)) setCoach({ roomId: at.roomId, key: at.key, ticked: false });
  }, [landed, prep, step, rooms, roomTypes, projectId, planId, docActions]);

  /* --- IS THE CARD SHOWING, AND WHAT DOES ITS COPY OF THE PILL SAY ---------
     ONE CONDITION IN ONE PLACE. `coach` names the pill the card was raised for
     and `optionPick` names the pill actually open, and the card exists only
     while those agree — selecting another space moves the second and not the
     first, which is exactly when a leader line would start pointing at bare
     ceiling. `armed` and `addTool` are in here for the reason the canvas's own
     `optionPick` prop has them: while a fitting is waiting to be placed the pill
     is not drawn, so there is nothing for the line to reach.

     AND THE LABEL IS READ OFF THE LAYOUT, not remembered from when the card went
     up. The card carries a picture of the chip, and the two are claiming to be
     the same object — so flipping the real pill has to move the copy with it, or
     the picture becomes a lie about what is on the drawing. */
  const coachOn = !!coach && !readOnly && !armed && !addTool
    && coach.roomId === optionPick?.roomId && coach.key === optionPick?.key;
  const coachLabel = useMemo(() => {
    if (!coachOn) return '';
    const ch = rooms.find((r) => r.id === coach.roomId)
      ?.designChunksPx?.find((d) => d.key === coach.key);
    return ch?.options?.find((o) => o.id === ch.pick)?.label ?? '';
  }, [coachOn, coach, rooms]);

  const pickSpace = useCallback((roomId) => {
    const off = focusId === roomId;
    hideCoach();
    docActions.setFocusId(off ? null : roomId);
    setOptionPick(off ? null : optionPickFor(roomId));
    /* AND THE FINISHES COLLAPSE ON THE WAY OUT. Leaving a room with its
       materials open would mean coming back to it on the editor rather than on
       the analysis, which is the resting state of that panel — see SpaceDetail.
       Only on the way OUT: picking a different space from the list does not need
       this, because `materialsEdit` holds a room id and stops matching by
       itself. */
    if (off) setMaterialsEdit(null);
    /* --- ...AND IT PUTS THE GEOMETRY TOOLS IN FRONT OF YOU -----------------
       CLICKING A SPACE RAISES THE BAR, AND THIS IS ONE OF THE TWO PLACES A
       SPACE CAN BE CLICKED. The other is the room itself on the drawing — see
       `onCanvasClick`, which carries the full argument. Both are the same act
       and now have to do the same thing, because the rail cell that used to
       offer these primitives has been removed (see the note above `ToolRail`):
       a click on a space is the ONLY way in, so a route that selected a space
       without raising the bar would be a route with no geometry tools at all.
       IT WAS EXACTLY THAT ROUTE. This handler is how a space is picked out of
       the panel's list, which is the more deliberate of the two gestures — you
       have read the room's name — and it was the one that opened nothing.
       NOT ON THE WAY OUT. Toggling a row off means "no space is selected", and
       a bar of primitives for a room nobody has chosen would be a tool aimed at
       whichever ceiling the panel happened to fall back to — which is the whole
       fault the rail cell was removed for.
       AND ONLY WHEN NOTHING ELSE IS ALREADY OPEN, which is `onCanvasClick`'s own
       gate for its own reason: somebody drawing a COVE must not have the tool
       taken out of their hands by a press on a room in the list. */
    if (!off && !geometry.status.menuOn && !boardPlace && !zoneEdit) {
      openShapeTool('guide', { arm: false });
    }
    /* `setMaterialsEdit` IS IN THE ARRAY AND WAS NOT, and nothing about when
       this callback is rebuilt has changed: it is a `useState` setter, handed
       through the room-intelligence panel group now that the finishes flag
       lives in that feature, and a setter's identity is stable for the life of
       the component. */
  }, [docActions, focusId, optionPickFor, hideCoach, geometry.status.menuOn, boardPlace, zoneEdit,
      openShapeTool, setMaterialsEdit]);

  /* FLIPPING ONE CHUNK THROUGH ITS OPTIONS IS features/lighting-planner/ —
     `cycleChunkOption`, taken off `lighting.commands` above. The arithmetic is
     `chunkOptionPicks`, which is pure and carries the argument for reading the
     current answer off the LAYOUT rather than out of `designPicks`. */

  const onCanvasClick = (e) => {
    // Ceiling objects are handled entirely in the pointer events — see the note
    // on objPointerDown. Nothing about them may happen on a click.
    //
    // `objMode` WAS IN THIS GUARD AND IT HAD TO COME OUT. It is sticky, not a
    // gesture in flight: grabbing one fan turns it on and nothing turns it off,
    // so every later click on the ceiling hit this early return and the whole
    // canvas went quiet — no space could be selected, the options pill could not
    // be dismissed, and the two lines at the bottom of this function that are
    // the ONLY way to clear a selected object never ran. You could select a fan
    // and then not let go of it.
    //
    // IT WAS ALSO ALREADY REDUNDANT, which is the tell. Everything interactive
    // on the plan calls `stopPropagation` on pointerdown, `objPointerDown`
    // included, so a press on an object never reaches the canvas — which is
    // exactly what `barePress` below reads, and it is the whole of why a click
    // on an object cannot arrive here. `armed` and `addTool` stay: those really
    // are gestures waiting to happen, and they own the next click.
    /* THE PRESS THIS CLICK CAME OFF WAS SPOKEN FOR, so the click is not one on
       the plan however much it looks like one by the time it gets here — see
       `barePress`, which is the one place that question is answered. Consumed
       outright rather than merely skipping the deselect: picking a cove up must
       not also yank the panel to whichever space it is drawn over, and letting
       go of a light must not re-select the room under it.
       FIRST, AHEAD OF EVERY OTHER GUARD, because it is the only one that is
       about the GESTURE rather than about the state the canvas is in. */
    if (!barePress.current) return;
    barePress.current = false;
    if (zoneMode || !source || armed || addTool) return;
    /* AND NOTHING WHILE A SHAPE IS BEING DRAWN. That press DID reach the canvas
       — a primitive draws on bare plan — so `barePress` above is true and the
       click the browser synthesises afterwards arrives here. Without this,
       dropping the first point of a pen path would also select the space under
       it and yank the panel to another room.
       LETTING GO OF A SELECTED SHAPE IS THE OTHER HALF, and it happens here
       rather than in a branch of its own: a click on empty plan is how every
       other selection on this canvas is cleared, and a shape you cannot let go
       of is a shape whose ring reads as part of the drawing. */
    if (geometry.status.menuOn && geometry.status.tool) return;
    /* AND EVERYTHING LETS GO. A press that really was on bare plan is how every
       selection on this canvas is cleared — the shape, the array whose dashed
       setting-out line would otherwise stay on the sheet as a drawn line (see
       `selArrayPathPx`), the module, the light, and the four below that used to
       be cleared only outside a room. One register, one line. */
    setSel(clear());
    if (geometry.shapes.editId) setShapeEditId(null);
    // AND THE TRACK'S POINTS, which are a selection like any other: a path left
    // open with its grips on the drawing reads as part of the drawing. A press
    // that came off a grip never reaches here — the grip stopped it, so
    // `barePress` above is false and this function has already returned.
    if (geometry.tracks.editId) closeTrackEdit();
    // THE SCALE IS SETTLED BY THE TIME WE ARE HERE. Measuring belongs to the
    // tracer screen, where the scale is actually being decided; leaving the
    // click live on this screen meant a stray click could redefine px-per-foot
    // under a finished layout, and every light on the plan would move.
    //
    // SO THE CLICK SELECTS A SPACE INSTEAD, which is the one harmless thing it
    // can mean here. Inside a space selects it; anywhere else clears the
    // selection. Both directions matter — a selection you cannot get out of is
    // worse than no selection, because the blue outline then reads as part of
    // the drawing rather than as a state.
    //
    // A FITTING'S CLICK NEVER REACHES THIS. Everything interactive on the plan
    // (a light, a strip's body, a sconce's grip, a ceiling object) calls
    // stopPropagation on pointerdown, so clicking one does not also re-select
    // the space under it and yank the panel to a different room.
    const hit = roomAt(svgPoint(e));
    hideCoach();
    docActions.setFocusId(hit ? hit.id : null);
    /* AND THE PANEL GOES TO THE SPACE THAT WAS CLICKED. Picking a space on the
       drawing is now the way into everything a space HAS — its height, its
       finishes, whether it is bright enough — and all of that lives on the
       Spaces tab. Without this, the most direct gesture there is (click the
       room) would set a selection the panel was on the wrong tab to show, which
       is a click that appears to do nothing. Only on a hit: clicking off the
       plan means "never mind", and yanking the tab strip about would be a
       strange thing for it to also mean. */
    if (hit) docActions.setView('spaces');
    /* --- ...AND IT PUTS THE GEOMETRY TOOLS IN FRONT OF YOU ------------------
       CLICKING A SPACE IS THE ONLY WAY THE GEOMETRY BAR OPENS. It had a cell in
       the rail as well and that cell has been removed — see the note above
       `ToolRail` — so this is not one of two doors into the primitives, it is
       the door. Which makes this line load-bearing rather than a convenience:
       lose it and there is no way to draw a guide at all.
       THE SAME LINE IS IN `pickSpace`, because a space can be clicked in two
       places — here on the drawing, and on its row in the panel's list — and
       "clicking a space" has to mean one thing in both. They are deliberately
       not folded into one function: this one has a hit test and a deselect to
       do first, that one has a toggle, and the shared part is a single call.

       AND CLICKING A SPACE IS THE RIGHT ACT TO HANG IT ON, WHICH IS WHY THE
       CELL WENT. Geometry is set out IN a room, and the room is what says which
       one — the click names the ceiling, puts the panel on that ceiling and
       brings up the primitives in one gesture. The rail cell could not name a
       ceiling: pressed with nothing chosen it armed a rectangle over whichever
       space the panel had happened to fall back to.

       IT IS A CLICK AND NOT `focusId`, and that distinction is the other half.
       A space is very nearly always focused — the panel falls back to the first
       room so that the drawing has something to be about — so a bar keyed on
       SELECTION would be a bar that never went away, permanently occupying the
       foot of the stage that the cove bar and the COB bar also want. A click is
       different: it happened, it is over, and the bar it opened is dismissed by
       Escape or by reaching for any other tool. There is no cell to un-press.

       ONLY WHEN A SPACE WAS HIT. Clicking the margin means "never mind" — see
       the two lines above, which read it that way for the selection and the tab
       — and opening a drawing tool would be a strange thing for it to also mean.

       AND ONLY WHEN NOTHING ELSE IS ALREADY OPEN. `shapeMenuOn` covers the case
       that matters: somebody drawing a COVE clicks the ceiling as part of that
       gesture, and switching them to guides mid-drag would take the tool out of
       their hands. Every other machine on this canvas has already returned long
       before this line — a press with a tool armed never reaches here at all. */
    if (hit && !geometry.status.menuOn && !boardPlace && !zoneEdit) {
      openShapeTool('guide', { arm: false });
    }
    /* --- SELECTING A SPACE OPENS ITS OPTIONS, WHEREVER YOU SELECTED IT FROM
       This used to close the pill outright on any click that was not on a
       fitting, and that made the same act mean two different things depending on
       where you performed it: clicking a space's ROW in the panel opened its
       ceiling options (see `pickSpace`), and clicking the space itself on the
       drawing — the more obvious of the two by far — opened nothing. The pill is
       how a ceiling is chosen, so the direct route to a space was the one route
       that did not offer it.

       IT ALSO MEANT THE PILL WAS ONLY EVER REACHABLE THROUGH A LIGHT. A chunk
       lit by a cove alone has no downlight to click, and a person who has not
       worked out that the fittings are clickable has no way in at all — so the
       control that decides the ceiling was behind a gesture nothing suggests.

       CLICKING OFF THE PLAN STILL CLOSES IT, and that is the half worth
       keeping: the ceiling around a space is the one place a click can honestly
       mean "never mind".

       AND A CLICK INSIDE THE ROOM WHOSE PILL IS ALREADY OPEN LEAVES IT WHERE IT
       IS. `optionPickFor` answers with the room's BIGGEST chunk, which is the
       right answer to "what is this room" and the wrong one to "and you were
       already looking at its little one": somebody who opened the pill on a
       small chunk by clicking a light in it, and then clicked the ceiling an
       inch away, would have watched their pill jump to the other end of the
       room. Same room, existing pill, no move. */
    setOptionPick((cur) => (hit
      ? (cur?.roomId === hit.id ? cur : optionPickFor(hit.id))
      : null));
  };

  // no-light zones are drawn by dragging a rectangle on the plan
  /**
   * PANNING WITH THE MIDDLE BUTTON.
   *
   * The stage is an ordinary scroll container — `overflow: auto` with the plan
   * sized by the zoom — so panning is scrolling it, and that is deliberately
   * the whole implementation. The alternative is a translate on the SVG, which
   * means owning the clamping, the scrollbars, the wheel, the keyboard and the
   * "where am I" problem that a scroll container already solves. Nothing else in
   * this file needs to know a pan happened, because as far as it is concerned
   * nothing did: the drawing's own coordinates are untouched.
   *
   * It is the MIDDLE button and not space-drag because the left button is spoken
   * for at every level here — tracing, dragging a grip, sliding a strip, boxing
   * a no-light zone — and a modifier that has to be held before the gesture
   * starts is a modifier you have to remember. The middle button is free.
   *
   * `preventDefault` on the mousedown is not optional: without it Chrome and
   * Firefox on Windows and Linux start their own autoscroll on a middle press,
   * which then fights this for the same drag.
   */
  const [panning, setPanning] = useState(false);
  const panFrom = useRef(null);

  /**
   * ZOOMING THE LAYOUT, THE WAY THE TRACER DOES IT.
   *
   * The tracer is a Konva stage and owns its own transform, so anchoring a
   * wheel zoom on the pointer is arithmetic on that transform. This screen is
   * an ordinary scroll container with an SVG sized by `zoom`, which is a better
   * fit for a drawing you pan around a lot — the browser owns the clamping, the
   * scrollbars and the keyboard — but it means the anchoring has to be done in
   * two halves, because the element's new size is not known until React has
   * laid it out.
   *
   * So: on the wheel, work out WHICH PLAN POINT is under the cursor and
   * remember it along with where the cursor was. After the re-render, ask the
   * SVG where that plan point ended up and scroll by the difference. Measuring
   * the element rather than predicting it is what makes this exact through the
   * stage's padding, the wrapper's padding and `justify-content: safe center`,
   * all three of which move the drawing around inside the scroll box as it
   * changes size, and none of which this has to know about.
   */
  /* `clampZoom` COMES FROM lib/planState.js, AND THE SECOND COPY IS WHY. The
     restore guard on `ui.zoom` is a truthiness test and is only safe while
     ZOOM_MIN is above zero — see the note at that guard. Two clamps is one that
     can drift down to 0 while the guard goes on trusting it. The reducer applies
     the same function to every write; `fitZoom` below applies it to its own
     result before handing it over. */
  const zoomAnchor = useRef(null);

  /* REMEMBER WHAT THE POINTER IS OVER, so the layout effect below can hold that
     point still while the drawing changes size under it. Split out of `zoomTo`
     because there are two zooms now and both anchor identically. */
  const anchorZoom = useCallback((at) => {
    const svg = svgRef.current;
    if (!svg || !at) return;
    const r = svg.getBoundingClientRect();
    // The plan-space point under the cursor, from the element's LIVE rect — so
    // it is right whatever the padding and centring are doing.
    zoomAnchor.current = {
      px: (at.x - r.left) / (r.width || 1),
      py: (at.y - r.top) / (r.height || 1),
      clientX: at.x, clientY: at.y,
    };
  }, []);

  /* TO A FIGURE, OR BY A FACTOR — AND THE FACTOR IS A NUMBER.
     This was one function taking either a value or a `z => z * k` closure, and
     every caller of the closure form was a plain multiplication. The reducer
     does the arithmetic against its OWN zoom (see ZOOM_SCALED), which is what a
     closure was buying, so the factor travels as a factor and there is one less
     function riding in an action. Both clamp in there. */
  const zoomTo = useCallback((to, at = null) => {
    anchorZoom(at);
    docActions.setZoom(to);
  }, [anchorZoom, docActions]);

  const zoomBy = useCallback((by, at = null) => {
    anchorZoom(at);
    docActions.scaleZoom(by);
  }, [anchorZoom, docActions]);

  // AFTER THE LAYOUT, NOT AFTER THE RENDER. The scroll correction reads the
  // SVG's new size, so it has to run once the browser has applied it and before
  // it paints — otherwise the drawing visibly jumps to the wrong place and back.
  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    if (!a) return;
    zoomAnchor.current = null;
    const svg = svgRef.current, el = stageRef.current;
    if (!svg || !el) return;
    const r = svg.getBoundingClientRect();
    el.scrollLeft += (r.left + a.px * r.width) - a.clientX;
    el.scrollTop += (r.top + a.py * r.height) - a.clientY;
  }, [zoom]);

  /** The middle of the stage, in screen coordinates — the button's stand-in
   *  for a pointer. */
  const stageCentre = useCallback(() => {
    const el = stageRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, []);

  // THE WHEEL, ON THE ELEMENT AND NOT THROUGH REACT. React attaches wheel
  // listeners passively at the root, and a passive listener cannot
  // preventDefault — so the container would zoom AND scroll on the same
  // gesture. A native non-passive listener is the only way to own it.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e) => {
      // Only over the drawing. Over the BOQ sheet or a picker this is an
      // ordinary scroll container and should keep behaving like one.
      if (!svgRef.current || !svgRef.current.contains(e.target)) return;
      e.preventDefault();
      // A trackpad pinch arrives as ctrl+wheel with small deltas; a mouse wheel
      // as large ones. One factor per notch reads the same on both because the
      // step is fixed rather than proportional to the delta.
      const k = e.deltaY > 0 ? 1 / 1.09 : 1.09;
      zoomBy(k, { x: e.clientX, y: e.clientY });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomTo, zoomBy]);

  // THE SAME KEYS THE TRACER USES, so the two screens do not have to be learned
  // separately: F fits the plan, + and − step, 0 goes back to actual size.
  // Guarded on an input having focus, because a rename box is a place where "f"
  // is a letter.
  useEffect(() => {
    const onKey = (e) => {
      if (!source || sheetOpen) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement
          || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'f' || e.key === 'F') { zoomTo(fitZoom()); }
      else if (e.key === '0') { zoomTo(1); }
      else if (e.key === '+' || e.key === '=') { zoomBy(1.2); }
      else if (e.key === '-' || e.key === '_') { zoomBy(1 / 1.2); }
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [source, sheetOpen, fitZoom, zoomTo, zoomBy]);

  const stageMouseDown = (e) => {
    if (e.button !== 1) return;
    const el = stageRef.current;
    if (!el) return;
    e.preventDefault();
    panFrom.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    setPanning(true);
  };

  useEffect(() => {
    if (!panning) return;
    // ON THE WINDOW, not on the element. A pan that ends when the pointer
    // leaves the stage is a pan that ends every time you reach the edge of the
    // thing you were trying to pan away from.
    const move = (e) => {
      const el = stageRef.current, f = panFrom.current;
      if (!el || !f) return;
      el.scrollLeft = f.left - (e.clientX - f.x);
      el.scrollTop = f.top - (e.clientY - f.y);
    };
    const up = (e) => { if (e.button === 1 || e.type !== 'mouseup') stop(); };
    const stop = () => { panFrom.current = null; setPanning(false); };
    // Middle-click emits `auxclick` after the drag; swallowed so a pan that
    // ended over a link or a button does not also activate it.
    const aux = (e) => { if (e.button === 1) { e.preventDefault(); e.stopPropagation(); } };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('auxclick', aux, true);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('auxclick', aux, true);
      window.removeEventListener('blur', stop);
    };
  }, [panning]);


  /* THE CAPTURE PHASE, AND IT IS THE HALF THAT CANNOT BE FORGOTTEN. It runs
     for EVERY press on this sheet before any control on the drawing has seen
     it, so it is the one place that can honestly say "we do not know yet". See
     `barePress`. */
  const onZoneDownCapture = () => { barePress.current = false; };

  const onZoneDown = (e) => {
    /* ...AND THE BUBBLE PHASE IS THE ANSWER. A press that got this far is a
       press no control on the drawing stopped, which is what "on bare plan"
       means — see `barePress`. */
    barePress.current = true;
    // NOT THE MIDDLE BUTTON. It is the pan, and every gesture on this canvas
    // has to say so — a middle press that reaches a drag handler starts a drag
    // that no mouseup will ever finish, because the pan swallows the release.
    if (e.button != null && e.button !== 0) return;

    // --- CONFIRMING THE DOORS OWNS THE WHOLE CANVAS ------------------------
    // Before every other branch, and it never falls through. This is a modal
    // step — the panel beside it holds one question and nothing else — so while
    // it is open a press on the plan cannot also select a space, arm a fitting
    // or start a no-light zone. Grab a box to move it; press empty plan to draw
    // a new one, or to drop the selection.
    if (owns(pressState, 'door') && source) {
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const p = svgPoint(e);
      const hit = doorHitAt(p);
      if (hit) {
        setSel(select('door', hit.id));
        // `base` IS THE RECT AT THE PRESS AND NEVER MOVES; `rect` is where the
        // pointer has it now. See `door` for why the offset is measured from the
        // press rather than accumulated frame by frame.
        door.down(e, { id: hit.id, base: hit.rect, rect: hit.rect });
        return;
      }
      setSel(clear());
      setDoorDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      return;
    }

    /* --- DRAWING A COVE OWNS THE CANVAS TOO -------------------------------
       Alongside the door editor above and ahead of everything below it, for the
       same reason both of those are where they are: while a primitive is armed
       a press on the plan means one thing, and any path that lets a selection
       or a ceiling object see it first is a path where the press does two
       things. A press with the BAR open but no primitive picked falls straight
       through, which is correct — there is nothing to draw yet. */
    if (geometryPointer.shapeToolDown(e)) return;

    // --- ADDITIONAL LIGHTING, before anything else claims the press ---------
    /* THE SWITCHBOARD STEP OWNS THE CLICK OUTRIGHT, and it is first because it
       is the most exclusive of the gestures here: while it is open, a press on
       the plan means one thing and nothing else on the canvas may see it. It
       does not disarm on a miss — a click too far from any wall places nothing
       and says nothing, and the step's way out is its Done button, exactly as
       the spot's and the cove's are. */
    if (owns(pressState, 'board') && source && pxPerFt) {
      e.preventDefault();
      placeBoardAt(svgPoint(e));
      return;
    }
    // First in the handler for the same reason the out-of-room check is first
    // in the block below it: a tool that is armed owns the next click, and any
    // path that lets selection or a ceiling object see it first is a path where
    // the click does two things.
    if (owns(pressState, 'tool') && source && pxPerFt) {
      // THE SNAPPED POINT, NOT THE RAW ONE. The indicator under the cursor is a
      // promise about where the click will land, and a click that lands
      // anywhere else makes every future indicator a lie.
      const raw = svgPoint(e);
      const p = addTool === 'strip'
        ? (() => { const sn = snapPlacing(raw, { last: stripFrom, ortho: !e.shiftKey });
                   return { x: sn.x, y: sn.y }; })()
        : raw;
      /* THE COVE'S SECOND CLICK WAS TAKEN HERE, ahead of the out-of-room guard,
         and it is a RELEASE now — see `onZoneUp`. The gesture is one press, a
         drag along the wall, and a let-go, which is what the other two marquee
         tools on this canvas already are. Two clicks made it the odd one out in
         a panel whose every other box is dragged, and it had the failure mode
         every click-click tool has: a half-made slot that lives between two
         separate events, so anything that happens in between — a stray click on
         the plan, a nudge of the panel — is holding a gesture nobody can see the
         state of. A drag cannot get stuck half-made; the pointer is either down
         or it is not.
         What has NOT changed is why the end point is not re-tested against the
         room: the wall IS the polygon's boundary, so an end aimed at it lands
         within a pixel or two of being outside, and `roomAt` would read a
         perfectly good end as "off the ceiling". The wall is resolved once, at
         the press, and every later position is projected onto that stored wall.
         Dragging past the end of it clamps rather than cancels. */

      /* THE COVE SEATS ITSELF FIRST, AHEAD OF THE OUT-OF-ROOM GUARD, and that
         ordering is load-bearing rather than tidy. The guard asks
         `pointInPolygon`, and this is the one gesture whose target IS the
         polygon's edge — so the press that is aimed best is the press most
         likely to land a pixel outside and be thrown away. It resolves its own
         room with a tolerance instead; see `coveRoomAt`. A press with no
         outline near it does nothing at all: no seat, and no disarm either,
         because the step's way out is its Done button. */
      /* THE TRACK PEN, AHEAD OF THE OUT-OF-ROOM GUARD AND AHEAD OF THE COVE.
         A run is set out over the DRAWING and not inside one space: it crosses a
         doorway into the dressing room as often as not, and a leg that reaches
         the wall lands within a pixel of being outside the polygon. The guard
         would throw away exactly the clicks that were aimed best — which is the
         same argument the cove makes one branch down, arrived at from the other
         side: the cove resolves its own room with a tolerance because it needs
         one, and this needs none at all. Which space each stretch belongs to is
         worked out once, later, where the absorption happens.

         `detail > 1` IS THE DOUBLE-CLICK, and it finishes the run rather than
         placing a fourth point on top of the third. The second click of a
         double lands on the same pixel as the first, so the hook would refuse
         it as a zero-length segment anyway — but "refused" and "finished" are
         different answers and the gesture has to give the second one. */
      if (addTool === 'track') {
        geometryPointer.trackPenPress(e, p);
        return;
      }
      if (addTool === 'cove') {
        const seatRoom = coveRoomAt(p);
        if (!seatRoom) return;
        e.preventDefault();
        const poly = seatRoom.plan?.polygonPx || seatRoom.geo?.polygonPx;
        const seat = coveWallAt(raw, poly);
        if (!seat) { setCoveNote('That space has no wall to cove along.'); return; }
        if (seat.angled) { setCoveNote(seat.reason); return; }
        setCoveNote('');
        setCoveFrom({ ...seat, roomId: seatRoom.id });
        /* THE POINTER IS CAPTURED, exactly as the spot's marquee captures it.
           The end of a run is very often PAST the end of the wall — that is the
           normal way to reach a corner, and the projection clamps it — so the
           release routinely happens outside the element the press landed on.
           Without capture that release is somebody else's event and the slot is
           never committed: the band would simply hang there, following a
           pointer that is no longer dragging anything. */
        e.currentTarget.setPointerCapture?.(e.pointerId);
        // THE BAND IS UP THE INSTANT THE PRESS LANDS, at zero length, rather
        // than waiting for the pointer to move. A tool that shows nothing until
        // you happen to move is a tool that looks like it missed the press.
        setAddAt(raw);
        return;
      }

      /* --- A MODULE CLIPS INTO A TRACK, AND ONLY INTO A TRACK --------------
         AHEAD OF THE ROOM TEST, AND THAT IS THE POINT OF ITS POSITION. Every
         other tool below asks "is there a ceiling here" first, because every
         other tool puts a fitting ON a ceiling. A module goes on a PROFILE: the
         run is the thing that has to be under the pointer, and a profile drawn
         across a threshold is one object whose middle may be over a doorway.
         Asking about the room first would refuse a press on the one thing the
         press is about. The branch is features/fixtures/ and it returns `true`
         either way — a press anywhere else places nothing and does NOT disarm.
         (SO A MODULE NEVER REACHES THE ROOM TEST BELOW, and it is exempt from
         the disarm for the COB's reason, stated there.) */
      if (fixtureGestures.tool.moduleDown(e, p)) return;

      const room = roomAt(p);
      /* Off the ceiling: put the tool away rather than place a fitting in a
         space that does not exist. Same rule the ceiling palette follows.

         EXCEPT FOR THE STEP TOOLS, WHICH IS THE ONE EXCEPTION AND IT IS ABOUT
         THE WAY OUT. For a tool armed from a palette that is still on screen,
         disarming on a stray click is cheap — the button is right there to arm
         it again. The spot and the cove have emptied the panel down to a step
         (see `stepTool`), so the same stray click would close the screen
         somebody is working on, take away the picture they were following, and
         do it for a click that placed nothing. A step ends at its Done button
         or at Escape. The click still does nothing, which is correct: there is
         no ceiling out here to put a fitting on. */
      /* ...AND THE COB IS THE THIRD EXEMPTION, ARRIVED AT FROM THE OTHER SIDE.
         The two above keep the tool armed because putting it away would close a
         STEP somebody is working inside. This one keeps it armed because a
         downlight is the fitting you place TWENTY of: a tool that had to be
         re-armed after every stray click on the margin would turn a ceiling's
         worth of lamps into a ceiling's worth of trips to the rail. Its way out
         is the same as its way in — the drawer is open and its cell is latched
         — plus Escape, like everything else here. */
      if (!room) { if (!GESTURE[addTool] && addTool !== 'cob') disarmAdd(); return; }
      /* (A MODULE NEVER REACHES HERE — its branch above returns either way. It
         is exempt from the disarm for the COB's reason, stated there.) */
      e.preventDefault();

      /* --- THE ARRAY PICKS A GEOMETRY RATHER THAN PLACING A LAMP -----------
         THE SAME TOOL AND A DIFFERENT QUESTION. Manual mode asks "where"; the
         array asks "on what", and the answer is a thing already on the drawing.
         So the press selects rather than places, and everything the bar goes on
         to ask — how many, which side, how far — is about the thing it selected.
         A SHAPE UNDER THE POINTER WINS OVER THE ROOM IT IS IN, which is the
         most-specific-first rule this canvas follows everywhere.
         AHEAD OF THE MANUAL PRESS, because they are the same tool in two modes
         and `cobMode` is the only thing that separates them. */
      if (fixtureGestures.tool.arrayDown(e, p, room, cobMode)) return;
      /* --- A RECESSED COB, EXACTLY WHERE THE CLICK LANDED -------------------
         NO SNAP TO THE DRAWING, NO PROJECTION, NO CLAMP, and the absence of all
         three is the feature rather than an omission — see the header of
         lib/cob.js. Both branches are features/fixtures/. */
      if (fixtureGestures.tool.cobDown(e, p, room)) return;

      if (addTool === 'sconce') {
        // ONE CLICK, AND THE WALL DOES THE REST. The click says WHICH wall and
        // roughly where along it; `placeZone` — the same function the accent
        // detector's output goes through — finds the nearest wall, projects the
        // point onto it, works out which way is into the room and returns a
        // fitting in exactly the shape the canvas and the schedule expect. A
        // hand-placed sconce is not a special case of anything.
        const poly = room.plan?.polygonPx || room.geo?.polygonPx;
        const r = Math.max((pxPerFt || 12) * 0.35, 4);
        const seed = { id: `man-${Date.now().toString(36)}`, type: 'sconce', roomId: room.id,
                       source: 'placed', label: 'Sconce',
                       rect: { x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r } };
        const placed = placeZone(seed, poly);
        docActions.addAccent(placed);
        setSel(select('acc', placed.id));
        disarmAdd();
        return;
      }

      if (addTool === 'strip') {
        // TWO CLICKS SPAN THE RUN, and the run is exactly what was clicked —
        // no wall projection. A strip placed by hand is being placed by
        // somebody looking at the drawing, and snapping their second click to a
        // wall they did not click is the tool disagreeing with them. The ends
        // are draggable afterwards with the same grips every other strip has.
        if (!stripFrom) { setStripFrom({ ...p, roomId: room.id }); setAddAt(p); return; }
        const a = stripFrom, b = p;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        // A run shorter than a foot is a mis-click, not a strip.
        if (len < Math.max(8, (pxPerFt || 12) * 1)) { setStripFrom(null); return; }
        const z = {
          id: `man-${Date.now().toString(36)}`, type: 'strip',
          roomId: a.roomId, source: 'placed', label: 'LED strip',
          run: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }],
          runLength: len,
          rect: { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y),
                  x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) },
        };
        docActions.addAccent(z);
        setSel(select('acc', z.id));
        disarmAdd();
        return;
      }

      if (addTool === 'spot') {
        // A DRAG, because a spot is placed for an AREA and not at a point.
        // What the drag produces is a task surface, and the spot then lands on
        // it by the same secondary-grid logic that serves every surface the
        // detector finds — which is the point: "put a spot here" means "treat
        // this as something worth aiming at", and the grid decides where the
        // fitting actually goes so it stays on a line with the ambient layout.
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setDraftZone({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, forSpot: true, roomId: room.id });
        return;
      }
    }

    // A ceiling-object gesture that started on an object stopped this event
    // before it got here, so reaching this point means the EMPTY ceiling was
    // hit. Armed: drop one, and disarm — the way a shape tool returns to the
    // pointer after you draw one shape. Not armed: deselect. Its guard reads
    // `selAccId`, which is the room domain's, because a bare press on plan is
    // also how a selected accent is let go — handed in for that.
    if (fixtureGestures.tool.objectDown(e)) return;
    if (!zoneMode || !source) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = svgPoint(e);
    setDraftZone({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const onZoneMove = (e) => {
    /* --- THE GEOMETRY TOOL'S FOUR BRANCHES, IN THE ORDER THEY STOOD IN -----
       Each answers `true` when it has taken the move, which is the idiom
       `shapeToolDown` already uses on the press. The bodies are the feature's —
       see useGeometryGestures — and the ORDER between them is this router's,
       because two of the branches below belong to other machines.

       THE SPAN, WHILE IT IS BEING DRAWN, ahead of every other branch and
       matching the press. Then the hover cue, which owns the move only when a
       primitive is armed. Then the pen's rubber band. */
    if (geometryPointer.spanMove(e)) return;
    if (geometryPointer.hoverMove(e)) return;
    if (geometryPointer.penMove(e)) return;
    /* A TRACK POINT, A SHAPE'S GRIP AND THE SHAPE ITSELF, in that order and
       ahead of the light: a gesture that has the pointer owns it until it is
       released, whatever else is armed. */
    if (geometryPointer.dragMove(e)) return;
    // A LIGHT BEING SLID INSIDE ITS OWN CELL. Same rule as every drag above it:
    // a gesture already in flight owns the pointer until it is released.
    if (lightDrag) { fixtureGestures.move.light(e); return; }
    // THE DOOR EDITOR FIRST, for the reason given on the press: it owns the
    // canvas outright while it is open.
    if (doorEdit) {
      if (doorDrag) { door.move(e); return; }
      if (doorDraft) {
        const p = svgPoint(e);
        setDoorDraft((d) => (d ? { ...d, x1: p.x, y1: p.y } : d));
      }
      return;
    }
    if (objDrag) { fixtureGestures.move.object(e); return; }
    // A LAMP BEING DRAGGED, with the rest of the in-flight gestures and for
    // their reason: a gesture that has the pointer owns it until it is released,
    // whatever else is armed.
    if (fixtureDrag.cob) { fixtureGestures.move.cob(e); return; }
    // A WHOLE RUN BEING CARRIED — the same rule, said about an array rather than
    // about one lamp. See `arrayGrab`.
    if (arrayDrag) { fixtureGestures.move.array(e); return; }
    // A MODULE SLIDING ALONG ITS RUN — same rule: a gesture already in flight
    // owns the pointer until it is released.
    if (moduleDrag) { fixtureGestures.move.module(e); return; }
    if (accDrag) { accPointerMove(e); return; }
    // A PLATE BEING SLID ROUND THE WALLS. Above the armed-tool branch below for
    // the same reason the object and accent drags are: a gesture already in
    // flight owns the pointer until it is released.
    if (boardDrag) { boardPointerMove(e); return; }
    // A WIRE'S END, OR ONE OF ITS BENDS. Same rule: a gesture already in flight
    // owns the pointer until it is released.
    if (flowDrag) { flowPointerMove(e); return; }
    // ARMED AND HOVERING. The guides have to appear BEFORE the click, not
    // after: their job is to tell you where the thing will land while you can
    // still move the pointer. features/fixtures/, and it maintains `overRoom`
    // for the crosshair.
    if (fixtureGestures.tool.armedMove(e)) return;
    // --- ADDITIONAL LIGHTING, while a tool is armed ------------------------
    // The cursor has to say what a click will do BEFORE it is spent, which
    // means `overRoom` has to be maintained here and not only in the ceiling-
    // object branch above — it was, which is why the crosshair never appeared
    // for these three and the pointer sat there claiming nothing would happen.
    if (addTool && source && pxPerFt) {
      const raw = svgPoint(e);
      /* WHAT "ON A CEILING" MEANS DEPENDS ON WHETHER A RUN IS UNDER WAY.
         For every tool but one it is the plain question — is there a room here.
         Once a COB run has chosen its space (see `cobLock`) it becomes a
         narrower one: is there a room here that the next press may act on. The
         cursor, the ghost and the crosshair all read this, which is the whole
         point of resolving it before the branches rather than inside one — the
         pointer has to say what a click will do BEFORE it is spent, and out here
         it will do nothing. */
      const here = roomAt(raw);
      const inside = addTool === 'cob'
        ? !!here && (!cobLock || here.id === cobLock)
        : !!here;
      if (inside !== overRoom) setOverRoom(inside);

      if (addTool === 'strip') {
        // Ortho is measured from the run's first end once there is one, so the
        // second click locks to the axis of the run rather than to nothing.
        const sn = snapPlacing(raw, { last: stripFrom, ortho: !e.shiftKey });
        setAddSnap(sn);
        setAddAt({ x: sn.x, y: sn.y });
        return;
      }
      if (addTool === 'sconce') {
        setAddGhost(sconceGhostAt(raw));
        setAddAt(raw);
        return;
      }
      /* THE COVE FOLLOWS THE POINTER BUT STAYS ON ITS WALL. `addAt` is the raw
         pointer and the DRAFT is what is projected — the two are deliberately
         different, because the preview is built from the projection while
         `addAt` is only what re-renders it. Before the press there is no wall to
         project onto and nothing to draw. */
      if (addTool === 'cove') {
        setAddAt(raw);
        return;
      }
      if (addTool === 'track') {
        geometryPointer.trackPenMove(raw);
        return;
      }
      /* --- WHAT THE COB BAR IS TALKING ABOUT -----------------------------
         THE PLAN POINT AND NOTHING ELSE. The bar is pinned to the foot of the
         stage (see CobSpec), so this is not a position to draw at — it is the
         question the recommendation and the two guides answer.
         NULL OUTSIDE A ROOM. Out there the next click places nothing, so there
         is no cell to read and no wall or bed worth warning about; the bar stays
         up and falls back to the catalogue's ordinary downlight.
         --- IS A MODULE ABOUT TO LAND ON A RUN? --------------------------
         AHEAD OF THE COB AND IT RETURNS, because a module reads none of what the
         COB branch maintains — there is no cell to recommend a wattage from and
         no wall band to warn about.
         BOTH BRANCHES ARE features/fixtures/ and both write `addAt`, which is
         this file's rubber-band position. */
      if (fixtureGestures.tool.moduleMove(raw)) return;
      if (fixtureGestures.tool.cobMove(raw, inside)) return;
      // The spot draws an area, so the plain cursor position is the truth; the
      // grid decides where the fitting goes once the area exists.
      setAddAt(raw);
      if (draftZone?.forSpot) setDraftZone((d) => (d ? { ...d, x1: raw.x, y1: raw.y } : d));
      return;
    }
    if (!zoneMode || !draftZone) return;
    const p = svgPoint(e);
    setDraftZone((d) => (d ? { ...d, x1: p.x, y1: p.y } : d));
  };
  const onZoneUp = () => {
    /* A SPAN LET GO IS A SHAPE HELD, NOT A SHAPE PLACED — see `spanUp`, and
       `commitShape` for why a cove is confirmed rather than dropped. Ahead of
       every other release, matching the press and the move. */
    if (geometryPointer.spanUp()) return;
    /* THEN THE THREE GESTURES THAT HAD THE POINTER: a track point, a shape's
       grip and the shape itself, in that order and ahead of the light. */
    if (geometryPointer.gestureUp()) return;
    if (lightDrag) { fixtureGestures.up.light(); return; }
    /* --- THE DOOR EDITOR'S RELEASE, AND THE ONE WRITE IT MAKES -------------
       A move commits here and nowhere else — see `doorDrag`, which carries the
       live rect precisely so that dragging a box does not re-run the board
       pass, the bay pass and the flows on every frame.

       A NEW BOX IS A DOOR LIKE ANY OTHER, in the shape doors.js produces: the
       opening is the shorter side, because that is what the whole file means by
       one, and `conf: 1` because a person drew it. `placed` is the only thing
       marking it as hand-made, and nothing downstream reads it — the board pass
       must not be able to prefer a detection over a correction. */
    if (doorEdit) {
      if (doorDrag) { door.up(); return; }
      if (!doorDraft) return;
      const r = {
        x0: Math.min(doorDraft.x0, doorDraft.x1), x1: Math.max(doorDraft.x0, doorDraft.x1),
        y0: Math.min(doorDraft.y0, doorDraft.y1), y1: Math.max(doorDraft.y0, doorDraft.y1),
      };
      setDoorDraft(null);
      // A press with no drag in it is a click on empty plan, which already did
      // what it meant to do — cleared the selection. Same half-foot floor as the
      // no-light zone, so a twitch does not leave a sliver on the sheet.
      const minPx = Math.max(6, (pxPerFt || 0) * 0.5);
      if (r.x1 - r.x0 < minPx || r.y1 - r.y0 < minPx) return;
      /* NOT NAMED `door`, WHICH IS THE GESTURE — see the hook of that name. A
         `const door` in this block would shadow it for the whole block, and the
         `door.up()` eight lines above would throw before this line ran. */
      const made = {
        id: `door-hand-${Date.now().toString(36)}`,
        cls: 'door', conf: 1, rect: r, openingPx: openingPx(r), placed: true,
      };
      docActions.addDoor(made);
      setSel(select('door', made.id));
      return;
    }
    if (objDrag) { fixtureGestures.up.object(); return; }
    if (fixtureDrag.cob) { fixtureGestures.up.cob(); return; }
    if (arrayDrag) { fixtureGestures.up.array(); return; }
    if (moduleDrag) { fixtureGestures.up.module(); return; }
    if (accDrag) { accPointerUp(); return; }
    if (boardDrag) { boardPointerUp(); return; }
    if (flowDrag) { flowPointerUp(); return; }
    /* A COVE IS A DRAG TOO, AND THIS IS WHERE IT LANDS. Press seats the wall,
       the move projects onto it, and the let-go is the commit — one gesture,
       with no state left over between two events. It reads the LAST TRACKED
       POINT rather than an event position for the reason `draftCove` does: that
       point is what has been drawn on the plan all the way through the drag, so
       the slot that lands is the band that was on screen when the finger came
       up. Taking the release coordinate instead would be a second source of
       truth for one number, and the two would differ by exactly the pixel of
       movement that arrives with the pointerup.
       AHEAD OF THE SPOT because the two are mutually exclusive — `addTool` is
       one tool — so the order is only about reading, not about precedence. */
    if (addTool === 'cove' && coveFrom) {
      // No movement at all is t1 === t0, a zero-length slot, which the length
      // floor below then refuses in the ordinary way. A press with no drag in
      // it should say what is wrong, not silently do nothing.
      const t1 = addAt ? coveTAt(addAt) : coveFrom.t;
      const c = manualReverseCove({
        a: coveFrom.a, b: coveFrom.b, t0: coveFrom.t, t1,
        roomId: coveFrom.roomId, inward: coveFrom.inward, pxPerFt,
        id: `mcove-${Date.now().toString(36)}-${Math.round(Math.random() * 1e4).toString(36)}`,
      });
      // A SLOT SHORTER THAN A FOOT IS A CLICK, NOT A COVE. Same threshold and
      // same reasoning as the strip's: the gesture is abandoned rather than
      // half-committed, and the tool stays armed so the next press starts a new
      // one.
      if (!c || c.runLength < Math.max(8, pxPerFt)) {
        setCoveFrom(null); setAddAt(null);
        setCoveNote('That is too short to be a slot — press at one end and drag to the other.');
        return;
      }
      docActions.addCove(c);
      /* ARMED FOR THE NEXT RUN, FOR THE REASON THE SPOT IS — see the note in
         the spot's branch below. Arming the cove empties the panel to a step,
         and a tool that puts itself away after one slot would close that step
         from under somebody who is coving four walls of a room. Only the
         half-made gesture is cleared: the press is spent, the band goes with
         it. */
      setCoveFrom(null); setAddAt(null); setCoveNote('');
      return;
    }
    // A spot's drag makes a SURFACE, not a no-light zone — same gesture, same
    // rubber band, different destination.
    if (draftZone?.forSpot) {
      const r = {
        x0: Math.min(draftZone.x0, draftZone.x1), x1: Math.max(draftZone.x0, draftZone.x1),
        y0: Math.min(draftZone.y0, draftZone.y1), y1: Math.max(draftZone.y0, draftZone.y1),
      };
      const roomId = draftZone.roomId;
      setDraftZone(null);
      const minPx = Math.max(6, (pxPerFt || 0) * 0.5);
      if (r.x1 - r.x0 >= minPx && r.y1 - r.y0 >= minPx) {
        docActions.addSurface({
          id: `mansurf-${Date.now().toString(36)}`, roomId, rect: r,
          kind: 'custom', label: 'Task area', confidence: 1, source: 'placed',
        });
      }
      /* THE TOOL STAYS ARMED, AND THIS IS THE HALF THAT MAKES THE STEP WORK.
         It called `disarmAdd()` here — the one-shot every other hand tool has,
         which is right while the palette it was armed from is still on screen
         to arm it again. Arming the spot now EMPTIES the panel down to a step
         (see `stepTool`), so putting the tool away after one box would close
         that step from underneath somebody halfway through a room: the panel
         would fill back in, the picture they were following would go, and the
         Done button would never once be reachable. A step ends when its Done is
         pressed — or Escape, which still calls `disarmAdd` — exactly as the
         no-light zone's does. The half-made gesture is cleared either way;
         `draftZone` went to null above. */
      setAddAt(null); setAddSnap(null); setAddGhost(null);
      return;
    }
    if (!zoneMode || !draftZone) return;
    const z = {
      x0: Math.min(draftZone.x0, draftZone.x1), x1: Math.max(draftZone.x0, draftZone.x1),
      y0: Math.min(draftZone.y0, draftZone.y1), y1: Math.max(draftZone.y0, draftZone.y1),
    };
    setDraftZone(null);
    const minPx = Math.max(6, (pxPerFt || 0) * 0.5); // ignore accidental clicks / sub-half-foot slivers
    if (z.x1 - z.x0 >= minPx && z.y1 - z.y0 >= minPx) {
      /* THE ID IS MINTED HERE AND NOT IN THE REDUCER. `Date.now()` inside an
         updater is not a pure function of its arguments, and React is free to
         invoke a reducer twice — the two runs would mint two different ids. See
         LIST_ADDED_MINTED for the one case that has to read the list's length
         and therefore takes the stamp as an argument instead; a zone's id does
         not depend on the list, so it is simply made before the dispatch. */
      docActions.addZone({ id: Date.now() + Math.random(), ...z });
    }
  };

  const toggle = (k) => () => docActions.toggleLayer(k);

  const base = source ? source.name.replace(/\.[^.]+$/, '') : 'plan';
  /* THE UPLOAD'S OWN KIND, from its own name. Read off `initialFile` and not off
     `source`, and the two are not the same file: a PDF upload becomes a raster
     `source` one page at a time, so `source.name` can say PNG about something
     the user handed us as a PDF — and it is the PDF the operator wants back.

     A MATCH AND NOT A SPLIT, because `split('.').pop()` on a name with no dot
     in it returns the WHOLE NAME: a file called `floorplan` came back as
     "FLOO", which reads like a format. The dot has to be there for there to be
     an extension, and anything longer than four characters or carrying a
     non-alphanumeric is not one either. Empty when there is nothing to say,
     which the button below turns into the word "file". */
  const uploadExt = initialFile
    ? (String(initialFile.name || '').match(/\.([A-Za-z0-9]{1,4})$/)?.[1] ?? '').toUpperCase()
    : '';
  // One room lit on its own still gets its name in the filename; the whole plan
  // does not need one, because the plan's name already is one.
  const exportBase = rooms.length === 1 && rooms[0].outline.name
    ? `${base}-${rooms[0].outline.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    : base;
  const exportMeta = {
    pxPerFt,
    mode: isVector ? 'dxf' : scaleMode,
    units: isVector ? source?.unitLabel : null,
    plan: source?.name ?? null,
    rooms: rooms.map((r) => ({
      id: r.id, name: r.outline.name,
      outline: r.outline.detected ? 'detected' : 'traced',
      reviewed: !!r.outline.reviewed,
      rightAngles: r.outline.rectify,
      chunkingChosenBy: r.chunkingChosenBy,
    })),
  };

  // --- persistence ----------------------------------------------------------
  //
  // ONE OBJECT OUT, ONE OBJECT IN, and the route decides when to write it. The
  // shape is defined in planState.js — see the header there for what is kept and
  // what is deliberately not.
  //
  // THE MEMO IS LOAD-BEARING, and not as an optimisation. `onPersist` marks the
  // route dirty, which re-renders this component; if the state object were built
  // fresh every render the effect below would fire again on that re-render, and
  // that is a loop that writes to the database forever. Identity stability IS
  // the termination condition, so every dependency here is a piece of state and
  // nothing is derived — with ONE named exception, `pxPerFt`, which is a memo
  // over the scale settings and is passed as the serialiser's second argument
  // rather than smuggled in as a field. It is safe because it is a stable memo
  // and because it is WRITE-ONLY: it is stamped as `scale.pxPerFtAtSave` and
  // nothing reads it back. Naming it in the signature is what stops the next
  // derived value being added here quietly. See serialiseEditor.
  /* THE DOCUMENT, AND ONE NAMED DERIVED ARGUMENT. THERE IS NO LIST HERE ANY
     MORE, and that is the whole of what this refactor was for: `serialiseEditor`
     and `applyEditor` were two hand-written lists of the same sixty-one fields
     and this memo was the THIRD, naming every one of them twice — once in the
     object and once in the dependency array. A field added to two of the three
     was a user's edit that was quietly not saved, and nothing said so.
     `doc` IS ONE OBJECT AND IT IS THE ONLY DEPENDENCY THAT CARRIES STATE, so a
     field migrated, added or renamed tomorrow reaches the serialiser by being in
     the reducer's own field table and by nothing else. See DOC_FIELDS.
     `pxPerFt` STAYS THE ONE EXCEPTION, by name, in the signature. It is the only
     derived value in the output, it is stamped as `scale.pxPerFtAtSave`, and it
     is WRITE-ONLY — nothing reads it back. Naming it in the signature is what
     stops the next derived value being added here quietly, and what stops one
     being smuggled in as a document field. See serialiseEditor. */
  const editorState = useMemo(
    () => serialiseEditor(doc, { pxPerFt }), [doc, pxPerFt]);

  // --- UNDO, THE HALF THAT NEEDS THE DOCUMENT -------------------------------
  //
  // Here rather than beside its refs at the top, because all of it reads
  // `editorState` — which cannot be computed until every piece of state it
  // serialises exists. The refs are declared up there so the keydown handler,
  // bound in between, can reach these functions. See undo.js for what a step is.
  docRef.current = editorState;

  /**
   * RECORD A GESTURE, ONCE IT HAS FINISHED.
   *
   * Every change to the document restarts a timer; the push happens when the
   * timer finally runs, and what it pushes is the state from BEFORE the burst.
   * That is what makes one drag one undo instead of forty — see QUIET_MS.
   *
   * NOT WHILE RESTORING. `restoreApplied` gates the first document a reopened
   * plan produces, which is not a change anybody made and must not become a step
   * you can undo BACK to an empty editor. And `undoing` gates the documents that
   * this feature itself causes: applying a step changes the state, which produces
   * a new document, which would otherwise be recorded as a fresh change and
   * poison the redo stack.
   */
  useEffect(() => {
    if (readOnly || !restoreApplied) return undefined;
    if (undoing.current) {
      undoing.current = false;
      history.current.base = editorState;
      return undefined;
    }
    if (history.current.base == null) { history.current.base = editorState; return undefined; }
    clearTimeout(quietTimer.current);
    quietTimer.current = setTimeout(() => {
      if (record(history.current, editorState)) {
        setUndoDepth(historyDepth(history.current));
      }
    }, QUIET_MS);
    return () => clearTimeout(quietTimer.current);
  }, [editorState, readOnly, restoreApplied]);

  /* THE FIELDS CTRL+Z LEAVES ALONE, AS NO-OP SETTERS.
   *
   * READ FROM planState.js's `NOT_UNDOABLE` AND NOT WRITTEN OUT HERE. These six
   * names used to be six hand-typed `setX: hold` entries, which made them a
   * second hand-maintained list of document fields sitting a thousand lines away
   * from the first — the exact pair this refactor exists to remove. A field
   * added to the document and forgotten in a hand-written copy starts jumping
   * the canvas on every undo and nothing says so. One list, two readers, and
   * test-plan-state asserts they agree.
   */
  const heldBack = useMemo(() => {
    const hold = () => {};
    return Object.fromEntries(NOT_UNDOABLE.map((f) => [setterFor(f), hold]));
  }, []);

  /**
   * APPLY A STEP.
   *
   * THE VIEWPORT AND THE SELECTION ARE HELD BACK, by handing `applyEditor`
   * no-ops for them — see `heldBack` above for the list and where it lives. The
   * document carries zoom, pan, the layer switches, the selected space — because
   * reopening a plan should put you back where you were looking — and none of
   * that is what Ctrl+Z is for. Undoing a change while the canvas jumps to where
   * it was two gestures ago is a worse experience than not having undo: the
   * person loses their place and cannot see what changed.
   *
   * Zoom and layers are left ALONE rather than restored, which is the only
   * behaviour that makes the two independent: pan somewhere, undo three
   * gestures, and you are still looking at the thing you were looking at.
   */
  const applyStep = useCallback((step) => {
    if (!step) return;
    undoing.current = true;
    applyEditor(step, { ...stateSetters, ...heldBack });
    // A FITTING THAT NO LONGER EXISTS CANNOT STAY SELECTED. Cheaper and more
    // honest than reconciling every selection against the restored document:
    // whatever was picked, the picture just changed under it.
    setSel(clear());
    setUndoDepth(historyDepth(history.current));
  }, [stateSetters, heldBack]);

  const undo = useCallback(() => {
    // THE IN-FLIGHT BURST IS CLOSED FIRST, so a change made half a second ago is
    // undoable rather than invisible. Without this, hitting Ctrl+Z immediately
    // after a click would step past the click — the timer had not run, so the
    // click was never recorded, and the state it would return to is the state
    // you are already in.
    clearTimeout(quietTimer.current);
    record(history.current, docRef.current);
    applyStep(stepBack(history.current, docRef.current));
  }, [applyStep]);

  const redo = useCallback(() => {
    clearTimeout(quietTimer.current);
    applyStep(stepForward(history.current, docRef.current));
  }, [applyStep]);

  // ...and the handle the keydown listener bound further up reaches them by.
  undoRef.current = { undo, redo };

  const stats = useMemo(() => statsFrom({ totals, rooms, boq }), [totals, rooms, boq]);
  const status = useMemo(() => statusFrom({ outlines, litIds, totals }), [outlines, litIds, totals]);

  // THE LATEST-VALUES REF. The two getters below are handed to the route and
  // called later — after a debounce, or when a milestone lands — so they must
  // read the state as it is AT THAT MOMENT, not as it was when they were
  // created. A ref reassigned on every render is how a stable function reads
  // fresh values, and it is why neither getter needs a dependency array.
  const live = useRef({});
  live.current = { rooms, exportMeta, boq, pxPerFt, source, projectId };

  /**
   * The design, on demand and not before. Serialising forty rooms of geometry
   * costs something, and the route only wants it when it is actually about to
   * write — not on every pointermove that marks the plan dirty.
   *
   * THE SAME SHAPE AS THE JSON EXPORT, deliberately: exporters.toJSON is the
   * representation that gets read by other tools and by whoever is training on
   * this, and a second serialisation of the same drawing would drift from it
   * within a month.
   */
  const getDesign = useCallback(() => {
    const L = live.current;
    if (!L.source) return {};
    const out = {
      pxPerFt: L.pxPerFt ?? null,
      width: L.source.w, height: L.source.h,
      units: L.source.unitLabel ?? null,
      projectType: L.projectId ?? null,
    };
    if ((L.rooms || []).some((r) => r.plan?.ok)) {
      // THE SAME MAPPING THE EXPORT BUTTON DOES, and it is not optional:
      // exporters.roomInFeet reads `room.name`, whereas a room in here carries
      // its name on `room.outline`. Handing it the editor's own objects
      // serialises cleanly and silently names every space `null` — which is a
      // corrupt training row that looks like a valid one.
      out.design = JSON.parse(toJSON(
        L.rooms.map((r) => ({ name: r.outline?.name ?? null, plan: r.plan })),
        L.exportMeta));
      out.boq = L.boq ?? null;
    }
    return out;
  }, []);

  /** The sheet as a PNG. Capped at 1600px: this is a card thumbnail and a
   *  training reference, not a print. */
  const getSnapshot = useCallback(async () => {
    const L = live.current;
    if (!svgRef.current || !L.source) return null;
    try { return await svgToPNG(svgRef.current, Math.min(L.source.w, 1600)); }
    catch (err) { console.warn('[plan] snapshot failed', err); return null; }
  }, []);

  // A RESTORED PLAN'S FIRST STATE IS ALREADY IN THE DATABASE. It came from
  // there a moment ago, so persisting it is a write that changes nothing and
  // moves `updated_at`, which re-sorts the dashboard because somebody opened a
  // plan. The first pass arms the autosave instead of firing it; every real edit
  // after that goes through.
  const persistArmed = useRef(!restore);
  useEffect(() => {
    if (!onPersist || !source) return;
    // NOT BEFORE THE RESTORE HAS LANDED — see restoreApplied above. The render
    // after the file is read has empty outlines, and writing that would
    // overwrite the saved plan with a blank one.
    if (!restoreApplied) return;
    if (!persistArmed.current) { persistArmed.current = true; return; }
    onPersist({ editorState, stats, status, getDesign });
  }, [onPersist, source, restoreApplied, editorState, stats, status, getDesign]);

  /**
   * The expensive save, reachable from anywhere in this component without
   * threading twelve values through a callback. Kept in a ref for the same
   * reason as `live`: the pipeline is async and captures its closure early.
   * THE REF IS DECLARED WITH THE OTHER LATEST-VALUES REFS at the top of this
   * component — see the note there. Only the assignment is here, where the
   * values it closes over exist.
   */
  milestone.current = (kind) => {
    if (!onMilestone) return;
    onMilestone(kind, { editorState, stats, status, getDesign, getSnapshot });
  };


  return (
    /* THREE COLUMNS NOW, AND THE FIRST ONE IS `auto` SO IT CAN BE NOTHING.
       The tools moved out of the right panel and onto the left edge (see
       ToolRail), and a rail that is only there once a plan is laid out must not
       leave a 58px gutter on the upload screen. Rendering nothing collapses the
       track, which is what `auto` buys over a fixed width. */
    <div className="grid grid-cols-[auto_1fr_340px] h-full gap-0 [@media(max-width:960px)]:grid-cols-1 [@media(max-width:960px)]:grid-rows-[auto_1fr_auto] [@media(max-width:960px)]:overflow-auto">
      {/* ONE QUESTION, BEFORE ANYTHING ELSE. Shown the moment a plan is
          readable and dismissed only by answering — see ProjectTypeDialog. */}
      {source && !readOnly && (!projectId || doorState.status === 'running') && (
        <ProjectTypeDialog planName={source.name} onPick={docActions.setProjectType}
          busy={doorState.status === 'running' ? 'Looking for doors…' : null}
          note="A door is a standard width, so one of them is the drawing's ruler." />
      )}
      {/* A "PLANNING THE ELECTRICALS…" MODAL WAS HERE. It covered the bolt's
          vision call, and there is no call left to cover — the switchboard rules
          read the door boxes, the placed sconces and the bed box, all of which
          are already in hand, so the boards appear with the layout rather than
          after a wait. */}
      {/* WHICH SHEET, ASKED BEFORE ANYTHING ELSE — and only when there is more
          than one. See PdfPagePicker. */}
      {pdfPick && (
        <PdfPagePicker
          name={pdfPick.name} pages={pdfPick.pages} thumbs={pdfPick.thumbs}
          onPick={(n) => {
            const doc = pdfPick.doc, name = pdfPick.name;
            pdfRun.current++;            // stop the thumbnail loop
            setPdfPick(null);
            openPdfPage(doc, n, name).finally(() => doc.destroy());
          }}
          onCancel={() => { pdfRun.current++; pdfPick.doc.destroy(); setPdfPick(null); }} />
      )}
      {/* --- THE THREE FINISHES, ASKED WHERE THE WALL WAS CLICKED -----------
          IT IS HERE AND NOT IN THE PANEL because the panel cannot say WHICH
          wall — see WallTonePopup. `fixed`, so it takes no grid track and does
          not move when the stage scrolls under it.
          IT CLOSES ON ANSWERING. Somebody clicking a wall has one thing to say
          about it, and a card that stayed open would leave the next wall's
          click landing on its own backdrop. */}
      {wallEdit && wallPick && (
        <WallTonePopup at={wallPick}
          tone={materialsOf(materials, wallEdit).walls[wallPick.edge] ?? 'light'}
          onPick={(tone) => { setWallTone(wallEdit, wallPick.edge, tone); setWallPick(null); }}
          onClose={() => setWallPick(null)} />
      )}
      {/* Deliberately bare. This bar carried five status pills — outlines,
          room, fans, scale, chunking — and every one of them duplicated
          something in the panel on the right, so the eye had two places to look
          and no reason to trust either. What is left is the name of the thing
          and whether it is busy. */}
      <div className="absolute top-0 left-0 right-[340px] [@media(max-width:960px)]:right-0 h-14 z-[5] flex items-center gap-3.5 px-5 bg-white/5 backdrop-saturate-[1.8] backdrop-blur-[2px]  border-b border-border/10">
        {/* THE LOCKUP. The mark is drawn, not loaded: it is a lit aperture — a
            disc with a halo — which is a circle and a box-shadow, and that is
            smaller than the PNG, sharp at any density, and takes the ink colour
            with it. The wordmark is live text in Lunar rather than an image, so
            it stays crisp and can be selected and searched. */}
        {/* THE WORDMARK GAVE UP ITS CORNER, and it was the right trade. On a
            screen you reach by choosing a plan inside a project, the top-left
            has one job: say which plan this is and get you back out. A brand
            mark there is decoration in the most valuable position on the page —
            and the mark is still on every screen that leads here.

            THE NAME IS EDITED IN PLACE rather than behind a dialog, because a
            plan auto-named from a filename is a name nobody chose, and this is
            where anybody who cares about it is looking. */}
        {onBack ? (
          <div className="flex items-center gap-3 min-w-0">
            <button className="border-0 bg-none text-[12px] text-subtle cursor-pointer py-1 inline-flex items-center gap-[7px] m-0 whitespace-nowrap transition-colors duration-[120ms] hover:text-white [&>span]:text-[13px]" onClick={onBack}>
              <span aria-hidden="true">←</span> Back to Projects
            </button>
            <span className="w-px h-[15px] bg-border flex-none rotate-[15deg]" aria-hidden="true" />
            {/* WHITE, NOT `text-ink`. This bar is frosted glass over a black
                page and ink is #000000 — the name of the plan, which is the one
                thing this bar exists to say, was reading as a dark smudge on a
                dark ground. Both the viewer's span and the editor's button take
                it, because they are the same words in the same place. */}
            {readOnly ? (
              /* A SPAN, NOT A DISABLED BUTTON. The name is not a control here and
                 dressing it as a dead one invites the click that does nothing. */
              <span className="text-[13px] text-white py-1 overflow-hidden text-ellipsis whitespace-nowrap max-w-[38ch]">{planName || 'Untitled plan'}</span>
            ) : nameDraft == null ? (
              /* HOVER HINTS AT THE FIELD IT BECOMES. It was `hover:bg-surface-3`
                 — #F2F2F2, a near-white flash on this dark bar — and it now
                 warms to the same glass the input below wears, so the hover is a
                 preview of the edit rather than a different effect. */
              <button title="Rename this plan"
                className="border-0 bg-none text-[13.5px] text-white cursor-text px-1.5 py-[3px] rounded max-w-[34ch] overflow-hidden text-ellipsis whitespace-nowrap transition-colors duration-[120ms] hover:bg-surface hover:backdrop-blur-md"
                onClick={() => setNameDraft(planName || '')}>
                {planName || 'Untitled plan'}
              </button>
            ) : (
              /* --- EDITING: A GLASS FIELD THAT ASKS TO BE TYPED IN -----------
                  IT WAS RAW OS CHROME, and that is a real bug rather than a
                  plain omission. styles.css styles text entry through
                  `input[type=text], input[type=email], …` — an ATTRIBUTE
                  selector, and this input has no `type` at all, so it matched
                  none of them. The file's own comment warns about exactly this
                  trap (it is how the login field ended up unstyled). Rather than
                  add `type="text"` and inherit a field built for a white panel —
                  `--input-bg` is #FFFFFF and `--text` is #e1dccd, which is
                  off-white text on a white box — it states what it is.
                  `bg-surface` + `backdrop-blur-md` is the panel's own glass, so
                  the field reads as part of this bar rather than punched through
                  it, and the border gives the edge a text field needs to invite
                  the caret. Utilities beat the element rules either way, being
                  in `@layer utilities`. */
              <input className="text-[13.5px] w-[26ch] px-2 py-[3px] rounded
                bg-surface backdrop-blur-md text-white border border-border/20
                focus:outline-none" autoFocus value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => { onRename?.(nameDraft); setNameDraft(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { onRename?.(nameDraft); setNameDraft(null); }
                  if (e.key === 'Escape') setNameDraft(null);
                }} />
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2.5 min-w-0 tracking-[-0.025em]">
            {/* The standalone editor — no project, no route above it.
                `<Logo>` AND NOT A SECOND COPY OF THE CROP. This was the same
                four offsets written out again in hard pixels, and the new
                artwork is what proved why that was a mistake: the numbers are
                measured off the FILE, so re-exporting it left this copy pointing
                at a region of a canvas that no longer existed while the shared
                component was correct. One crop, one place, one measurement.
                NARROWER THAN THE MARKETING BAR'S 132, because this one is not
                alone: a divider and the view's name sit beside it in a header
                that also carries the exports and Share. See `width` there. */}
            <Logo width={116} />
            <span className="w-px h-[15px] bg-border flex-none rotate-[15deg]" aria-hidden="true" />
            <span className="text-[12px] text-muted whitespace-nowrap overflow-hidden text-ellipsis">{view === 'boq' ? 'schedule' : 'lighting layout'}</span>
          </div>
        )}
        <div className="flex-1" />
        {/* THE STANDING REMINDER. The stage below is pixel-for-pixel the editor,
            so the only thing separating "looking at their plan" from "editing
            mine" is this pill and the banner on the way in. It is magenta for the
            same reason everything else operator-facing is. */}
        {readOnly && <div className={PILL_VIEW}>Read only · viewer</div>}
        {busy && <div className={PILL}>{busy}</div>}
        {/* Only where there is somewhere for a save to go. */}
        {onPersist && SAVE_LABEL[saveState] && (
          <div className={saveState === 'error' ? PILL_BAD
            : saveState === 'saved' ? PILL_OK : PILL}>
            {SAVE_LABEL[saveState]}
          </div>
        )}
        {/* The drawing, on its own clock. Silent once it has landed — a
            permanent "Uploaded" badge is a claim nobody needs twice. */}
        {UPLOAD_LABEL[uploadState] && (
          uploadState === 'error'
            ? <button className={PILL_RETRY} onClick={() => onRetryUpload?.()}
                title="The work is saved; the drawing did not upload. Click to retry.">
                {UPLOAD_LABEL.error} · Retry
              </button>
            : <div className={PILL}>{UPLOAD_LABEL[uploadState]}</div>
        )}
        {/* UNDO AND REDO. The keyboard is the gesture people will actually use,
            and the buttons are here because a shortcut nobody knows about is not
            a feature: the pair is the only thing on screen that says this plan
            HAS a history, and its disabled state says how much of one. Off on
            the read-only sheet, along with every other mutation. */}
        {source && !readOnly && (
          <div className={TABS} role="group" aria-label="History">
            {/* HEROICONS' arrow-uturn-left / arrow-uturn-right, DRAWN RATHER
                THAN LOADED — the same decision as the rail's house and the
                lit-aperture mark: two paths inline take the ink colour with
                them, stay sharp at any density, and cost nothing at build time,
                where a dependency for two icons would be a package to keep in
                step forever.

                THE GLYPHS THEY REPLACE WERE TYPE, and that was the problem with
                them. ↶ and ↷ are characters, so their weight, size and baseline
                came from whatever font resolved them — they sat light and small
                beside the Design/BOQ tabs and shifted between platforms. A path
                is drawn to this chrome's own stroke weight and sits where it is
                put.

                1.7 AND NOT HEROICONS' 1.5, which is the one liberty taken with
                them: the rest of the chrome's icons are 1.7 (see ProfileRail),
                and at 15px a 1.5 stroke reads a shade thinner than the tab
                labels beside it. Same paths, this app's weight. */}
            <button type="button" title="Undo — ⌘Z or Ctrl+Z" className={STEP}
              aria-label="Undo" disabled={!undoDepth.past}
              onClick={() => undoRef.current?.undo()}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none"
                stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
                strokeLinejoin="round" aria-hidden="true">
                <path d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
              </svg>
            </button>
            <button type="button" title="Redo — ⇧⌘Z or Ctrl+Y" className={STEP}
              aria-label="Redo" disabled={!undoDepth.future}
              onClick={() => undoRef.current?.redo()}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none"
                stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
                strokeLinejoin="round" aria-hidden="true">
                <path d="m15 15 6-6m0 0-6-6m6 6H9a6 6 0 0 0 0 12h3" />
              </svg>
            </button>
          </div>
        )}
        {/* THE PLAN'S APPEARANCE, AS A TWO-SIDED SWITCH. Sun is the scan as
            it arrived, moon inverts it — a white plan with black lines becomes a
            black plan with white lines. Both sides are always drawn and one is
            always latched, which is what makes it a switch rather than a button
            with a hidden state: you can see which of the two you are in without
            having to remember what pressing it did.

            OFFERED ONLY WHERE IT DOES SOMETHING. A scan is pixels, so inverting
            it is meaningful. A DXF is not: its geometry is drawn by us, in
            colours from `C` in PlanCanvas, and a filter over it would invert our
            own ink rather than the plan. So the switch is absent on a vector
            plan rather than present and inert — the rule the View section
            follows about a checkbox that turns on nothing. */}
        {/* THE SUN/MOON SWITCH WAS HERE, and it is now over the CANVAS, lower
            right — see the block after this bar. It is a control over the
            drawing's own appearance, and the drawing is what you are looking at
            while you use it; up here it was in the row that names the plan and
            says whether it is busy, four hundred pixels from the thing it
            changes. */}
        {/* THE DESIGN/BOQ PAIR WAS HERE, and it is now the right panel's own
            three-tab strip — Outlines, Design, BOQ. It left the top bar because
            two of the three steps it names had their controls in the panel and
            the third was a pill up here: the same navigation split across two
            pieces of chrome, in two different idioms, so "where am I" had two
            answers and neither was complete. See the strip in the panel. */}
      </div>

      {/* --- THE PLAN'S APPEARANCE, OVER THE DRAWING IT CHANGES ------------
          A TWO-SIDED SWITCH, NOT A BUTTON. Sun is the scan as it arrived, moon
          inverts it — a white plan with black lines becomes a black plan with
          white ones. Both sides are always drawn and one is always latched,
          which is what makes it a switch: you can see which of the two you are
          in without having to remember what pressing it did.

          LOWER RIGHT, OVER THE CANVAS, because that is where the thing it
          changes is. In the top bar it sat in the row that names the plan and
          says whether it is busy — a control over the drawing's ink, filed with
          the drawing's metadata.

          A WHITE PILL, NOT GLASS, AND GLASS WAS TRIED FIRST. The panel's own
          five-percent white works there because the panel is a large surface
          against a black page with its own grid showing through — the glass IS
          the read. A 70px control floating on the drawing has no area to build
          that up: it came out as a barely-there smudge over whatever it happened
          to be sitting on, which is the opposite of what a switch has to be.
          Solid white, a hairline and a lift instead.

          THE SHADOW IS DOING REAL WORK, not decoration. This thing floats over
          two different grounds — the black page around the sheet, and the white
          paper of a day-mode plan when the drawing is large enough to reach the
          corner. White-on-black needs nothing; white-on-white needs an edge and
          a shadow or it disappears. The hairline handles the first case and the
          shadow the second.

          POSITIONED LIKE THE TOP BAR, which is deliberate rather than copied:
          `right-[364px]` clears the 340px panel with the same 24px the stage
          pads by, and the 960px query is where the panel stops being a column
          and goes underneath. Anchored to whatever the top bar is anchored to,
          so the two cannot drift apart.

          OUTSIDE THE STAGE ON PURPOSE. The stage is the scroll container; an
          absolutely-positioned child of it would scroll away with the plan, and
          a switch you have to scroll back to find is not pinned chrome.

          IT IS OFFERED ON A DXF TOO NOW, AND IT USED NOT TO BE. The old reason
          was sound and has been dealt with: a DXF has no bitmap to subtract from
          255, and a CSS filter over one would invert OUR OWN ink rather than the
          plan, so the switch was hidden rather than left present and inert. What
          changed is that PlanCanvas no longer needs a filter — it takes the line
          work's greys from the ground (see the `vector` branch there), so a DXF
          has a real night mode and the switch has something to do on one. */}
      {source && !sheetOpen && !showTrace && (
        <div className="absolute bottom-6 right-[364px] [@media(max-width:960px)]:right-6
          z-[5] flex gap-0.5 p-1 rounded-lg bg-white border border-border
          shadow-[0_2px_10px_rgba(0,0,0,0.35)]"
          role="group" aria-label="Plan appearance">
          {[[false, 'Show the plan as scanned',
             /* Heroicons `sun`, outline. */
             'M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591'
             + 'M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636'
             + 'M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z'],
            [true, 'Invert the plan — black plan, white lines',
             /* Heroicons `moon`, outline. */
             'M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75'
             + ' 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21'
             + ' 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z']].map(([on, label, d]) => {
            const live = layers.invert === on;
            /* INK ON THE LIVE SIDE, GREY ON THE OTHER, and the PILL decides
               which — this has been round the houses, so the reasoning stays
               written down. The accent RAMP was tried and read as washed out at
               17px: its tones are #c2a987 through #fef1dd, which carry as a fill
               over a large shape and resolve to a pale smudge in 1.7px strokes.
               There is nothing wrong with the gradient; there is not enough of
               it in an icon for a gradient to be anything. White was tried while
               the pill was dark glass and is wrong on a white one.
               THE PILL IS DELIBERATELY OPAQUE WHITE AND STAYS THAT WAY. It is
               the one piece of chrome that has to read against BOTH grounds —
               it is the control that switches between them — so it cannot be
               glass tinted for either. A white chip with black glyphs is legible
               over a white scan and over a black one; anything translucent is
               legible over one of them.
               NO PAINT SERVER EITHER WAY, AND `currentColor` DOES IT ALL. Both
               states are a text colour on the button, which is why there is no
               `<defs>` in here. */
            return (
              <button key={String(on)} type="button"
                className={'appearance-none border-0 bg-transparent cursor-pointer '
                  + 'px-2 py-1.5 rounded inline-flex items-center justify-center leading-[0] '
                  + 'transition-colors duration-[120ms] '
                  + 'focus-visible:outline-2 focus-visible:outline-accent '
                  + 'focus-visible:outline-offset-1 '
                  /* GREYED, NOT HIDDEN. The side you are not in still has to be
                     findable — it is half the switch. #7A7A7A on white is quiet
                     without being absent, and it goes to ink on hover so the
                     button reads as live before you press it. */
                  + (live ? 'text-ink' : 'text-subtle hover:text-ink')}
                aria-pressed={live} title={label}
                onClick={() => docActions.setLayer('invert', on)}>
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none"
                  stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
                  strokeLinejoin="round" aria-hidden="true">
                  <path d={d} />
                </svg>
              </button>
            );
          })}
        </div>
      )}

      {/* --- THE ELECTRICAL SWITCH AND THE DOOR BUTTON WERE HERE ------------
          A WHITE PLATE IN THE LOWER LEFT, opposite the appearance switch in the
          lower right. They are the right panel's FOOTER now — see the block at
          the end of the panel — and the move is not a tidy-up.

          THE PLATE WAS BUILT FOR A PROBLEM IT NO LONGER HAS TO SOLVE. Floating
          over the drawing it had to be findable against a black page AND against
          a white scan, which is what bought it the opaque ground, the hairline
          and the drop shadow, and what kept its label down to a single word:
          "Electrical". On a known ground it can say the whole sentence.

          AND IT WAS THE WRONG CORNER FOR THE PAIRING. The switch's honesty
          depends entirely on the door boxes — every switchboard on the sheet is
          placed beside a door, see electrical.js — and the count of those boxes
          was nowhere near it. Footer, one under the other: the act, then the
          thing it rests on.

          THE APPEARANCE SWITCH STAYS WHERE IT IS, and that is not an
          inconsistency. It is a control over the DRAWING'S OWN INK, so it
          belongs over the drawing. */}

      {/* --- THE TOOLS, DOWN THE LEFT EDGE --------------------------------
          THEY WERE TWO GRIDS IN THE RIGHT-HAND PANEL — Lighting, then
          Electrical elements — and the panel is now what it should always have
          been: a place that describes the space you are in. A tool is not a
          description. It is what you pick up before you touch the drawing, so
          it belongs against the drawing, on an edge that never scrolls. See
          ToolRail.

          THE SAME GATES THE PANEL'S OWN TAB STRIP HAS, less one. `doorEdit` and
          the wall step both take the pointer for a question about the DRAWING
          rather than about the design, and a palette live beside either is six
          ways to answer something else. Every other step — the zone, the board,
          the cove and the spot — keeps the rail, because in all four the rail is
          how you can see what is armed and how you put it away. */}
      {/* ALWAYS AN ELEMENT IN THIS TRACK, EVEN WITH NOTHING IN IT. The grid has
          three columns and this is the first of them; a child that simply is not
          rendered does not leave a gap — it shunts the stage into the rail's
          track and the panel into the stage's, and the 340px column ends up
          empty with the panel squeezed into the middle. An empty div in an
          `auto` track is zero wide, which is exactly what "no rail" should look
          like, and the same holds for the `auto` first ROW on a narrow screen. */}
      {!(source && !readOnly && !prep && !sheetOpen && step === 'plan'
        && !doorEdit && !wallEdit) ? <div aria-hidden="true" /> : (
        <ToolRail
          tool={addTool} objArmed={armed} boardOn={boardPlace}
          disabled={!pxPerFt || !rooms.length}
          objDisabled={!pxPerFt}
          /* --- THE COB DRAWER -------------------------------------------
             THE CELL OPENS AND THE GESTURES INSIDE IT ARM, which is why this
             is one handler taking four messages rather than the rail's usual
             pair. `open`/`close` are the cell; a mode id or null is the
             drawer. See CobMenu.
             THE ARRAY IS SHOWN AND NOT YET ANSWERED FOR. Its cell is in the
             drawer because the drawer is what says this fitting has two
             gestures, and a menu that grew a second item later would be a
             menu somebody had already learned the shape of. It is out of
             reach rather than absent, which is the honest picture of a
             gesture this build does not implement. */
          cobOpen={cobOpen} cobMode={cobMode} cobSoon={COB_SOON}
          onCob={(m) => {
            if (m === 'close') { setCobOpen(false); setCobMode(null); disarmAdd(); return; }
            if (m === 'open') { setCobOpen(true); return; }
            /* PICKING A GESTURE PUTS EVERY OTHER MACHINE AWAY, which is the
               rule the rail's own two handlers already follow: one pointer
               pipeline, one owner. Two armed tools is a click with two
               meanings. */
            setZoneMode(false); setDraftZone(null);
            closeShapeTool(); closeTrackEdit(); closeBoardPlace();
            // AND THE ARRAY THAT WAS OPEN, whose bar stands exactly where this
            // gesture's bar is about to — see `openArray`.
            setSel(clear());
            // ...AND THE TRACK'S ARMED MODULE. Two live tools is a press with
            // two meanings.
            setTrackMode(null);
            setArmed(null); setGhost(null);
            /* THROUGH `disarmAdd` AND NOT STRAIGHT TO `setAddTool`, because the
               tool being put down might be a half-clicked strip or an unfinished
               track path, and those have to be thrown away with it — see the
               note there. It clears this cell's own bar too, which is right:
               switching gesture is not the moment to carry a slider position
               across. `cobStanding` survives it deliberately. */
            disarmAdd();
            setCobMode(m);
            /* THE DRAWER STAYS OPEN WHILE A GESTURE IS ARMED. It is the only
               thing on screen saying which of the two is live, and closing it
               on the press would take that away at the moment it starts
               mattering. */
            setAddTool(m ? 'cob' : null);
          }}
          /* --- THE MAGNETIC TRACK'S DRAWER -----------------------------
             THE SAME FOUR MESSAGES THE COB CELL TAKES — open, close, a module
             id, or null — because it is the same kind of cell: one product with
             several things under it. What differs is that these are MODULES
             rather than gestures, and that opening this cell also raises the
             GEOMETRY BAR in the track's own role. That is not a convenience, it
             is the feature: a module has to have a run to clip into, and the two
             ways of getting one are both the shape tool's — drag out a primitive,
             or press a guide already on the drawing and have its outline handed
             over (see `takeGeometry`). A drawer offering three modules and no way
             to make a run would be a drawer about nothing on a fresh plan.
             PICKING A MODULE DOES NOT CLOSE THE BAR EITHER. Clipping a diffuser
             on and then drawing a second run is one continuous piece of work,
             and the bar is how the second run gets drawn — its primitives are
             simply unarmed while a module is. */
          /* --- THE MAGNETIC TRACK CELL, AND ITS DRAWER --------------------
             THE CELL OPENS THE GEOMETRY BAR AND NOTHING ELSE. It used to open
             the drawer as well, and that was three modules offered on a plan
             with no profile to clip them into — controls that cannot do anything
             are worse than controls that are not there yet. A module has to have
             a run, and the two ways of getting one are both the shape tool's:
             drag out a primitive, or press a guide already on the drawing and
             have its outline handed over (see `takeGeometry`).

             SO THE LATCH IS THE BAR'S OWN ROLE. `shapeMenuOn && shapeRole ===
             'track'` is the honest answer to "is the track tool in hand" — the
             same shape the Cove cell's latch has — and there is no second piece
             of state to keep in step with it.

             AND THE DRAWER OPENS ON A SELECTED RUN. Press a track on the drawing
             and the three modules appear beside the cell, which is where
             somebody has already learned a drawer lives. It stays up while one is
             armed, so clipping six diffusers on is six presses and not twelve.
             `selTrackId` is the selection; a track is a ceiling shape, so being
             selected is `selShapeId` naming one. */
          trackOn={geometryCommands.toolbar.trackOn}
          onTrack={geometryCommands.toolbar.toggleTrack}
          trackDrawer={!!selTrackId || addTool === 'module'}
          trackMode={trackMode} trackSoon={MODULE_SOON}
          onTrackPick={(m) => {
            /* A MODULE IS ARMED, AND THE PRIMITIVES ARE PUT DOWN WITH IT. Two
               live tools is a press with two meanings, and here the two would
               fight over the same object: a press on a run would both drag out a
               new shape and clip a module onto the run underneath. The BAR stays
               open with nothing armed, so the way back to drawing is one press.
               EVERY OTHER MACHINE GOES TOO — one pointer pipeline, one owner. */
            const next = trackMode === m ? null : m;
            setShapeTool(null); abandonShape();
            setZoneMode(false); setDraftZone(null);
            closeTrackEdit(); closeBoardPlace();
            setArmed(null); setGhost(null);
            setCobOpen(false); setCobMode(null); setSel(clear());
            setAddTool(next ? 'module' : null);
            setTrackMode(next);
          }}
          /* ONE CELL FOR TWO ROLES' WORTH OF BAR, AND ONLY THE COVE IS IN THE
             RAIL. The bar draws the same six primitives either way and `shapeRole`
             is the whole difference — what a committed shape BECOMES — but the
             two are asked for in different ways, and that is why only one of them
             is a tool you pick up:

               COVE      an act you bring to a ceiling. Nothing on the drawing
                         suggests it, so it lives here, latched while it is open.
               GEOMETRY   what you set out IN a space, and the space is what says
                         which one. A click on a room raises it — see
                         `onCanvasClick` — and it had a cell under this one until
                         that cell turned out to be a second door into the same
                         room: pressed with no space chosen it armed a rectangle
                         over whichever room the panel had fallen back to.

             LATCHED ONLY IN ITS OWN ROLE, so this cell reads as off while the bar
             is up as the space's geometry — which is true: pressing it then is
             not "close", it is "make this a cove instead", and switching the bar
             over is what somebody asking for that means. */
          shapeOn={geometryCommands.toolbar.coveOn}
          onShape={geometryCommands.toolbar.toggleCove}
          zoneOn={zoneEdit} onZones={openZoneEdit}
          onPick={(t, arms) => {
            /* TWO MACHINES BEHIND ONE COLUMN. Most of these arm `addTool`, the
               hand-placing tools; the chandelier arms `armed`, the ceiling-object
               one-shot, because that is what a chandelier is to the geometry — a
               thing with a diameter that reserves clearance. The rail says which
               it wants rather than this branch testing for an id.
               EITHER WAY THE OTHER MACHINE IS DISARMED. Two armed tools is a
               click with two meanings. */
            setZoneMode(false); setDraftZone(null);
            closeShapeTool();
            // ...AND THE COB DRAWER, which is a third machine and closes on the
            // way in like the other two. `disarmAdd` takes the bar with it.
            setCobOpen(false); setCobMode(null); setSel(clear());
            setTrackMode(null);
            if (arms === 'object') {
              disarmAdd();
              setArmed(t); setGhost(null);
              if (t) setObjType(t);
              return;
            }
            setAddTool(t); setStripFrom(null); setAddAt(null);
            setCoveFrom(null); setCoveNote('');
            // AND THE HALF-CLICKED RUN, for the reason `disarmAdd` throws one
            // away: leaving the points behind would mean coming back to the
            // track tool later and finding a path somebody abandoned three tools
            // ago, with no way to tell it from a fresh one.
            trackPen.reset();
            // ...AND THE POINT EDITOR, for the reason every step on this canvas
            // disarms the others on the way in: one pointer pipeline, one owner.
            closeTrackEdit();
            setArmed(null); setGhost(null);
          }}
          onArmObject={(id, machine) => {
            /* THE SAME TWO MACHINES AGAIN. Five cells arm the ceiling-object
               one-shot; the switchboard opens a STEP, which seats plates on
               walls until it is closed. */
            if (machine === 'board') {
              if (id) openBoardPlace(); else closeBoardPlace();
              return;
            }
            closeBoardPlace(); closeShapeTool();
            setCobOpen(false); setCobMode(null);
            if (addTool === 'cob') disarmAdd();
            setArmed(id);
            if (id) { setObjType(id); setObjMode(true); setZoneMode(false); }
            setGuides([]); setGhost(null);
          }} />
      )}

      <div ref={stageRef}
        className={'relative overflow-auto '
          + (sheetOpen || showPicker || showTrace
            ? 'block pt-[68px] px-[22px] pb-6'
            : source
              ? 'pt-[68px] px-[18px] pb-6 flex [justify-content:safe_center] items-start'
              : 'p-[18px] flex items-center justify-center')
          + (panning
            ? ' cursor-grabbing! [&_*]:cursor-grabbing! select-none [&_*]:select-none' : '')}
        onMouseDown={stageMouseDown}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); loadFile(e.dataTransfer.files[0]); }}
      >
        {boqOpen ? (
          <BOQView boq={boq} planName={source.name} />
        ) : boardsOpen ? (
          /* THE SWITCHBOARD SHEET, ON THE SAME TERMS AS THE SCHEDULE. See
             SwitchboardSheet for why it replaces the drawing rather than
             sitting beside it. `onHeight` is withheld from a viewer, exactly
             as every other write on this screen is: they get the numbers
             printed rather than typed. */
          <SwitchboardSheet groups={boardSheet} planName={source.name}
            country={sbCountry}
            onHeight={readOnly ? null : setBoardHeight} />
        ) : !source ? (
          <div className={'w-[min(560px,92%)] border border-dashed border-border/10 '
            + 'rounded-lg bg-surface backdrop-blur-[5px] px-8 py-[52px] text-center '
            + 'transition-[border-color,background-color] duration-150'
            + (over ? ' border-border/10 border-solid bg-white/10' : '')}>
            <h2 className="m-0 mb-2 text-[20px] tracking-[-0.03em]">Drop a floor plan</h2>
            <p className="mx-auto mt-0 mb-[18px] text-muted max-w-[42ch]">
              To start creating lighting schemes</p>

            <label className={`${BTN_PRIMARY} inline-block`}>
              Choose a DXF or an image
              <input type="file" accept=".dxf,.pdf,image/*,application/pdf" style={{ display: 'none' }}
                onChange={(e) => loadFile(e.target.files[0])} />
            </label>
            {dxf?.error && <p className={`${NE} max-w-[42ch] mx-auto mt-3.5`}>{dxf.error}</p>}
          </div>
        ) : showTrace ? (
          <OutlineTracer
            source={source}
            /* The same flag the layout screen's canvas reads. Two renderers,
               one switch in the top bar — see `.plan-invert` in styles.css. */
            invert={layers.invert}
            pxPerFt={pxPerFt}
            outlines={outlinesPx}
            selectedId={selectedOutlineId}
            onSelect={docActions.setSelectedOutlineId}
            onCommit={commitOutline}
            onUpdateOutline={updateOutline}
            onDeleteOutline={deleteOutline}
            onConfirm={lightOneRoom}
            onProceed={runPipeline}
            /* --- THE ROUND TRIP, AS THREE PROPS -----------------------------
               `litIds` tells the tracer there is a design behind it, so its foot
               can offer a way back instead of only a way forward; `dirtyIds` is
               which spaces have moved since they were lit, which is what turns
               "relight everything" into "relight the two you touched". Both are
               ids and not counts, because the tracer marks the rows too. */
            litIds={litIds}
            dirtyIds={dirtyIds}
            onBackToDesign={backToDesign}
            onMovePoint={movePoint}
            onInsertPoint={insertPoint}
            onRemovePoint={removePoint}
            detectState={roomState}
            onRedetect={recognitionCommands.rerunRooms}
            unitId={source.unitId}
            unitCandidates={UNITS}
            onUnitChange={(u) => { docActions.setUnitId(u); }}
            /* The scale controls live on the tracer screen for an image, but the
               state stays here: it is the same scale the sidebar edits later,
               and two copies of it would drift the moment either was touched. */
            /* THE FOUR SETTERS THE CHILD IS HANDED TAKE A VALUE, which is why
               they are the reducer's own named creators and not `dispatch`.
               OutlineTracer calls `setMode('ref')`, `setCustomFt(3)` and
               `setMeasure({a, b})` with finished values — see the measuring
               branch in its `onCanvasClick` — and it must not have to know that
               the state behind them is a reducer. */
            scale={isVector ? null : {
              mode: scaleMode, setMode: docActions.setScaleMode,
              refId, setRefId: docActions.setRefId,
              customFt, setCustomFt: docActions.setCustomFt,
              measure, setMeasure: docActions.setMeasure,
              doors, doorState, pick: doorPick,
              /* THE RECT RIDES ALONG WITH THE ID. See the note in `pxPerFt`:
                 the door boxes are editable from the electrical step now, so
                 the scale has to be anchored to the box that was measured
                 rather than looked up in a list that can change. */
              onPickDoor: (id) => docActions.setDoorPick(id
                ? { id, mm: null, rect: doors.find((d) => d.id === id)?.rect ?? null }
                : null),
              onSetWidth: (mm) => docActions.setDoorWidth(mm),
              onRetryDoors: recognitionCommands.rerunDoors,
              widths: DOOR_WIDTHS,
            }} />
        ) : showPicker ? (
          <ChunkPicker
            options={picking.chunking.options}
            recommendedId={picking.chunking.recommendedId}
            initialId={chunkPicks[picking.id] ?? null}
            onConfirm={(id) => {
              docActions.setChunkPick(picking.id, id);
              setPickingId(null);
            }}
            onCancel={() => setPickingId(null)}
            src={isVector ? null : source.src}
            vector={isVector ? source.render : null}
            wallLayers={null}
            imgW={source.w} imgH={source.h}
            polygonPx={picking.geo.polygonPx} zonesPx={picking.plan?.zonesPx ?? []}
            fansPx={picking.geo.fansInRoom} toPx={picking.geo.toPx} />
        ) : (
          /* NO SHEET UNDER AN INVERTED PLAN. The white card, its hairline and
             its shadow are the paper the drawing sits on; behind a plan whose
             own ground is now black they read as a frame around a hole.

             `bg-white` AND NOT `bg-surface`, WHICH IS THE BUG THIS FIXES.
             `--color-surface` is `rgba(255,255,255,0.05)` — five percent white,
             a glass token for panels floating over the black page — and the
             paper under a drawing is the one surface in this app that must be
             OPAQUE. With it translucent the page's black ground came through the
             sheet, so a day-mode plan (whose scan is faded to 42% by the "Fade
             the plan" layer, on by default) sat on near-black instead of on
             paper and read as washed out. Night mode was unaffected because the
             card is not drawn there at all, which is why this only showed on the
             flip.

             LITERAL WHITE, DELIBERATELY, where the rest of this file prefers a
             token. `bg-surface-2` is opaque today and would do — but this is
             PAPER, its whole job is to be an opaque sheet the colour of paper,
             and a token that can be retuned into glass is exactly what broke it
             once. */
          <div className={'flex-none inline-block '
            + (layers.invert ? '' : 'bg-white border border-border rounded-lg p-3 shadow')}>
            <PlanCanvas ref={svgRef}
              src={isVector ? null : (invertedSrc ?? source.src)}
              srcAsScanned={isVector ? null : source.src}
              vector={isVector ? source.render : null}
              wallLayers={null}
              width={source.w} height={source.h}
              plans={rooms.map((r) => ({ id: r.id, name: r.outline.name, plan: r.plan,
                                         design: r.designChunksPx }))}
              /* WHICH CHUNK'S OPTIONS ARE OPEN, and the two things that can be
                 done about it. Read-only viewers get neither, so the drawing is
                 a drawing: the pill is a control and a control nobody may use is
                 a thing to explain rather than a thing to draw. */
              optionPick={readOnly || armed || addTool ? null : optionPick}
              onPickChunk={readOnly || armed || addTool ? null : pickChunkOptions}
              onCycleOption={readOnly || armed || addTool ? null : cycleChunkOption}
              focusId={focus?.id ?? null}
              /* THE RAW `focusId`, NOT `focus`. `focus` falls back to rooms[0]
                 so the details panel always has something to describe; the blue
                 outline must show only what somebody actually picked, and
                 nothing when they have picked nothing. */
              selectedId={focusId}
              fansPx={obstaclesPx} pxPerFt={pxPerFt} layers={canvasLayers} zoom={zoom}
              /* THE PLAN GOES QUIET WHILE A COVE IS BEING AIMED. Not a layer:
                 it is a property of the gesture in flight, it is never
                 serialised, and it must not appear in the View list as
                 something to switch. See `canvasLayers` above. */
              /* ...AND WHILE THE WALLS ARE BEING ANSWERED FOR, for the same
                 reason again: the subject is one polygon's edges, and the scan's
                 own wall lines are a picture of the same walls a few pixels
                 away. See the wall step at the foot of PlanCanvas. */
              wash={stepTool?.id === 'cove' || !!wallEdit}
              /* WHICH SPACE'S WALLS, AND WHAT THEY ARE. Geometry in — the
                 polygon this room was traced as and one tone per edge — because
                 the canvas draws and does not decide. */
              wallEdit={wallEditGeo}
              onWallSegment={wallEditGeo ? pickWallSegment : null}
              /* READ-ONLY: EVERY HANDLER OFF, AND `onFixture` BELOW LEFT ON.
                 PlanCanvas treats each of these as optional — a null
                 onObjPointerDown is a fan you cannot pick up, a false objMode is
                 a canvas with no grips — so the read-only canvas is the same
                 component drawing the same geometry with nothing to grab. Hover
                 is not a mutation and it is the entire reason to open this
                 screen, so `onFixture` is untouched. */
              objMode={!readOnly && objMode}
              /* WHILE A TOOL IS ARMED THE NEXT CLICK IS A PLACEMENT, so the
                 ceiling objects' move targets stand down for it — otherwise a
                 sconce aimed just inside a fan's footprint would grab the fan
                 instead of landing. It is the only thing that suppresses them
                 now; see the long note at the move target in PlanCanvas. */
              /* THE BOARD STEP COUNTS AS PLACING, and it is the strictest of
                 the three: while it is open every press on the plan seats a
                 plate, so every other hit target on the canvas has to be inert
                 or it will eat the click. */
              placing={!readOnly && !!(armed || addTool || boardPlace)}
              selObjIds={readOnly ? [] : selObjIds}
              onObjPointerDown={readOnly ? null : objPointerDown}
              objDragMode={objDrag?.moved ? objDrag.mode : null}
              guides={readOnly ? [] : guides} ghost={readOnly ? null : ghost}
              clearanceFt={opt.fanClearance}
              selAccId={readOnly ? null : selAccId}
              /* AND NOTHING ON THE DRAWING IS GRABBABLE WHILE A TOOL IS ARMED.
                 Same reasoning as `onPickChunk` above and the same phrase, for
                 the three fittings that carry their own press handlers: an
                 armed tool has spoken for the pointer, and a press that both
                 places a cove and picks up the strip it was aimed past is a
                 press nobody asked for. It matters most for the cove, whose
                 whole gesture is a drag ALONG A WALL — which is where the runs
                 that would steal it already live. `placing` does the same for
                 the hover targets inside the canvas; see `INERT` there. */
              onAccPointerDown={readOnly || armed || addTool ? null : accPointerDown}
              surfaces={surfacesPx} taskSpots={taskSpotsPx}
              selSpotId={readOnly ? null : selSpotId}
              /* ...AND THE SPOT TOOL IS THE EXCEPTION, so a spot can be picked
                 up during the step that places spots. `spotsLive` is the other
                 half — the handler is useless while `placing` has made the
                 fitting inert. See `spotPointerDown`. */
              onSpotPointerDown={readOnly || armed || (addTool && addTool !== 'spot')
                ? null : spotPointerDown}
              spotsLive={!readOnly && addTool === 'spot'}
              /* THE GRID CELLS ARE A READING, NOT A FITTING, and they have
                 moved to where the other readings live.
                 They were a public layer while the render pass was being built,
                 and that was right then: a shaded run of cells is how you check
                 the model put the panelling on the wall you meant. On a finished
                 sheet it is a coloured band along a wall beside the cove it
                 produced — two marks where the drawing needs one, and the one
                 that is not a fitting is the one to lose. The CONSEQUENCES stay
                 on the drawing for everybody: the reverse cove, the shelf strip,
                 the art spots. What went is the working.
                 Same switch as the bed boxes and the task surfaces — "Show what
                 was identified" under Admin. */
              wallCells={isAdmin && audit ? wallCellsPx : []}
              /* The draft rides in with the real ones — see `draftCove`. The
                 canvas draws it identically, which is the point. */
              reverseCoves={draftCove ? [...reverseCoves, draftCove] : reverseCoves}
              measure={null} onCanvasClick={readOnly ? null : onCanvasClick}
              /* Crosshair only where a click would actually do something. Off
                 the ceiling it reverts to a pointer, which is the cursor's job:
                 saying what the click will do before it is spent. */
              cursor={readOnly ? null
                : objDrag || accDrag ? 'grabbing'
                /* THE COVE KEEPS ITS CROSSHAIR OFF THE CEILING, and it is the
                   only tool that does. `overRoom` is `pointInPolygon`, so it
                   goes false the moment the pointer crosses the outline — which
                   for every other tool is honest (nothing will land out there)
                   and for this one is a lie told at the exact pixel the gesture
                   is aimed at: the wall IS the boundary, the press is forgiven
                   for half a foot either side (see `coveRoomAt`), and dragging
                   PAST the end of a wall is the normal way to finish a run. A
                   hand cursor there says "this press picks something up", and
                   the press it invited was the wrong one. */
                /* AND THE SHAPE TOOL, WHICH IS AIMED AT THE CEILING AND NOT
                   AT ANYTHING ON IT. Crosshair everywhere, including off the
                   spaces: a cove is spanned from a point that may well be
                   outside the room while the shape it makes is inside it, and a
                   pointer that changed halfway through the drag would be
                   reporting on the anchor rather than on the gesture. */
                /* --- THE ONE THING THAT OUTRANKS A TOOL'S OWN CURSOR ------
                   A GEOMETRY UNDER THE POINTER THAT THE TOOL WOULD TAKE. Both
                   geometry-taking tools show a crosshair by default, because
                   both are aimed at the ceiling — and over a line they are not:
                   the press takes THAT OBJECT, which is what a hand says and a
                   crosshair does not. Ahead of both tools' branches below, and
                   ahead of the shape tool's deliberate "crosshair everywhere"
                   rule, because this is the exception that rule is worth having.
                   `geomHover` IS ONLY EVER SET WHILE ONE OF THOSE TOOLS IS
                   ARMED — see it — so this cannot fire under anything else. */
                : geomHover ? 'pointer'
                : (geometry.status.menuOn && geometry.status.tool) ? 'crosshair'
                : geometry.shapes.dragging ? 'grabbing'
                /* THE TRACK PEN, FOR THE COVE'S REASON ONE LINE DOWN: a run is
                   set out over the drawing, and a leg deliberately taken to the
                   wall lands a pixel outside the polygon. A pointer that turned
                   back into an arrow there would be saying the click will do
                   nothing, and the click works. */
                : addTool === 'track' ? 'crosshair'
                : addTool === 'cove' ? 'crosshair'
                /* A MODULE HAS NOWHERE TO GO BUT A RUN, so off one the press is
                   dead and the cursor says so with a plain arrow — never a
                   crosshair, which would claim the ceiling was a target. Over a
                   run the `geomHover` branch above has already made it a hand. */
                : addTool === 'module' ? 'default'
                : addTool === 'cob'
                  ? (cobBlocked ? 'not-allowed' : overRoom ? 'crosshair' : 'default')
                : (armed || addTool) ? (overRoom ? 'crosshair' : 'pointer')
                : null}
              zones={drawnZones} draftZone={readOnly ? null : draftZone}
              zoneMode={!readOnly && zoneMode}
              onZoneDown={readOnly ? null : onZoneDown}
              /* AND ITS CAPTURE-PHASE HALF, WHICH IS NOT WITHHELD FOR A VIEWER.
                 It clears a latch and nothing else — see `barePress` — and a
                 sheet whose presses never clear it is a sheet whose first click
                 is read against whatever the last one left behind. */
              onZoneDownCapture={onZoneDownCapture}
              onZoneMove={readOnly ? null : onZoneMove}
              onZoneUp={readOnly ? null : onZoneUp}
              accents={accentZonesPx} switchboards={switchboardsPx} onFixture={setTip}
              /* A PLATE CAN BE PICKED AND THROWN AWAY, and that is all it can
                 be — see `deleteBoard` for why there is no drag. Null in the
                 viewer, like every other editing handler here. */
              selBoardId={readOnly ? null : selBoardId}
              onBoardPointerDown={readOnly || armed || addTool ? null : boardPointerDown}
              /* SO THE CURSOR CAN SAY THE PLATE IS GRABBABLE, and so a plate in
                 flight can be drawn as such. The canvas is told the gesture is
                 happening rather than deriving it from a moved position: a board
                 that was dragged yesterday and a board being dragged now are the
                 same geometry and want different cursors. */
              draggingBoardId={boardDrag?.moved ? boardDrag.id : null}
              /* THE WIRING, ON ITS OWN SWITCH. Handed in regardless of the
                 layer — PlanCanvas gates the drawing on `layers.electrical`, so
                 there is one place that decides whether the arcs are on rather
                 than two that have to agree. */
              flows={flowsPx}
              /* --- EDITING A WIRE. Gated exactly as the plate's own handlers
                 are: nothing on the read-only sheet, and nothing while a tool
                 is in hand, because a press with a tool armed is aiming at the
                 drawing rather than at the wire in the way. */
              selFlowId={readOnly ? null : selFlowId}
              onFlowPointerDown={readOnly || armed || addTool ? null : flowPointerDown}
              onFlowGripDown={readOnly || armed || addTool ? null : flowGripDown}
              /* THE END IN FLIGHT, and only once the drag is past its slop —
                 otherwise a press on the grip would paint a rubber band of zero
                 length over the plate before anybody had moved. */
              flowGrab={flowDrag?.kind === 'board' && flowDrag.moved
                ? { id: flowDrag.id, at: flowDrag.at, overId: flowDrag.overId } : null}
              /* The audit layer — now the lit task surfaces and the render
                 pass's wall cells. The BED zones used to be passed here too and
                 are not any more: see the note in PlanCanvas's audit group.
                 `detectedZones` still feeds `zoneList`, so the planner obeys
                 them exactly as before; only the box round them is gone. */
              audit={isAdmin && audit}
              /* THE DOOR BOXES, on a switch of their own — they answer "is the
                 SCALE right", which is asked on arrival and on its own. */
              auditDoors={isAdmin && auditDoors}
              /* THE BEDS AS THE PLANNER HAS THEM — `detectedZones` and not the
                 accent pass's own boxes, which is the same list the chunking
                 obeys. A debug overlay drawn from a second source is a debug
                 overlay that can agree with nothing. */
              bedBoxes={isAdmin && auditBeds ? detectedZones : []}
              doorBoxes={doors} doorRejects={doorState.rejected ?? []}
              doorPickId={doorPick?.id ?? null}
              /* --- CONFIRMING THE DOORS ------------------------------------
                 The list handed over has the DRAG'S live rect folded into it,
                 which is why the canvas takes `doorEditBoxes` rather than
                 reading `doors` a second time: a move is not written to the
                 door list until the pointer is released — see `doorDrag` — so
                 the canvas would otherwise draw the box at the place it started
                 from for the whole of the gesture. */
              doorEdit={doorEdit}
              doorEditBoxes={doorEdit ? doorEditBoxes : []}
              selDoorId={selDoorId} doorDraft={doorDraft}
              onDoorDelete={deleteDoor}
              /* THE SCAFFOLDING UNDER THE LAYOUT. Same gate as the audit
                 overlay and for the same reason — it is working, not drawing —
                 but its own switch, because "why did this chunk split here" and
                 "what did the model see" are two different questions. */
              showGrid={isAdmin && showGrid}
              /* --- THE COVES SOMEBODY DREW ---------------------------------
                 In plan pixels, because that is the space the canvas draws in.
                 `lit` is whether the layout actually took the shape up as a cove
                 — see `litShapeIds` — which is what tells the canvas whether the
                 shape is already drawn by the room's own cove line or needs
                 drawing here. The handler is withheld while any other tool is in
                 hand, exactly as the plate's and the wire's are: a press with a
                 fitting armed is aiming at the drawing, not at the shape in the
                 way. */
              /* --- MOVING A LIGHT INSIDE ITS CELL -------------------------
                 Withheld while any other tool is in hand, exactly as the plate's
                 and the wire's handlers are: a press with a fitting armed is
                 aiming at the ceiling, not at the lamp in the way. */
              selLightId={readOnly ? null : selLightId}
              onLightPointerDown={readOnly || !canGrab(pressState)
                ? null : lightPointerDown}
              /* THE ONE IN FLIGHT, AND ONLY ONCE THE DRAG IS PAST ITS SLOP —
                 otherwise a press meant as a click would move the fitting by the
                 pixel of wobble that arrives with it. */
              movingLight={!readOnly && lightDrag?.moved ? lightDrag : null}
              /* THE KEEP-OUT BAND, AND ONLY WHILE IT IS BEING MET. Shown when
                 a cove is being drawn, moved or resized — the three states in
                 which somebody is placing one and can be stopped by it. On a
                 finished sheet it would be a rule drawn over a drawing for
                 nobody. */
              coveClampPx={!readOnly && pxPerFt && geometry.canvas.clampLive
                ? COVE_GAP_FT * pxPerFt : null}
              /* THE KEEP-OUT BAND, AND ONLY WHILE IT IS BEING MET. Shown while
                 a cove is being drawn, moved or resized — the three states in
                 which somebody is placing one and can be stopped by it. On a
                 finished sheet it would be a rule drawn over a drawing for
                 nobody to meet. */
              coveClampPx={!readOnly && pxPerFt && geometry.canvas.clampLive
                ? COVE_GAP_FT * pxPerFt : null}
              coveShapes={geometry.canvas.coveShapes}
              selShapeId={readOnly ? null : selShapeId}
              /* AND WHICH ONE IS SHOWING ITS DIMENSIONS, which is a second and
                 narrower thing — see `shapeEditId`. */
              shapeEditId={readOnly || armed || addTool || boardPlace || zoneMode
                ? null : geometry.shapes.editId}
              onShapeHandleDown={readOnly ? null : geometryPointer.shapeHandleDown}
              onShapePointerDown={readOnly || !canGrab(pressState)
                ? null : geometryPointer.shapePointerDown}
              /* WHICH GEOMETRY THE TOOL IN HAND WOULD TAKE, so the line itself
                 says it before the press — the third of the three cues
                 `geomHover` drives, alongside the cursor and the array's ghost. */
              hoverShapeId={readOnly ? null : geomHover}
              /* THE MAGNETIC TRACKS AND THEIR MODULES. Resolved from the shapes
                 and the fixtures on every render — see `magTracksPx` — so a grip
                 dragged on a run carries its diffusers with it. */
              magTracks={magTracksPx} trackModules={trackModulesPx}
              selTrackId={readOnly ? null : selShapeId}
              /* A MODULE CAN BE SLID ALONG ITS RUN. Withheld with every other
                 grab handler while a tool is armed — except that the MODULE tool
                 is the press that places one, and `modulePointerDown` returns for
                 it rather than being withheld here, so a press on an existing
                 module during a run of placements still lands on the ceiling
                 underneath. Same exemption the spot tool takes. */
              selModuleId={readOnly ? null : selModuleId}
              onModulePointerDown={readOnly || armed || boardPlace || zoneMode
                ? null : modulePointerDown}
              draftShape={readOnly ? null : geometry.canvas.draftShape}
              /* ONE PEN DRAWING, WHICHEVER PEN IS HOLDING THE POINTER. The two
                  cannot both be live — arming the track tool closes the shape
                  menu and vice versa — so this is a choice and not a merge. */
              penDraft={readOnly ? null : (geometry.canvas.penDraft ?? geometry.canvas.trackDraft)}
              trackEdit={readOnly ? null : geometry.canvas.trackEdit} selTrackPt={geometry.tracks.selPt}
              onTrackPointDown={readOnly ? null : geometryPointer.trackPointDown}
              /* NOT WHILE THE PEN IS ARMED. A double click on the drawing is
                 how a run is FINISHED — see `finishTrack` — so letting it also
                 open the points of a run underneath would give one gesture two
                 meanings at the moment somebody is most likely to make it. */
              onEditTrack={readOnly || addTool === 'track' ? null : openTrackEdit}
              draftRun={!readOnly && addTool === 'strip' && stripFrom && addAt
                ? [stripFrom, addAt] : null}
              placeSnap={!readOnly && addTool === 'strip' ? addSnap : null}
              sconceGhost={!readOnly && addTool === 'sconce' ? addGhost : null}
              /* --- THE COBs SOMEBODY PUT DOWN, AND THE THREE MARKS THAT GO
                     WITH PUTTING ONE DOWN --------------------------------------
                 `manualCobs` is the fittings themselves, in plan pixels, and
                 they are drawn whatever tool is armed — they are on the ceiling.
                 The other two are momentary and belong to the gesture: the ghost
                 under the pointer, and the guide that says the point is hard
                 against a wall or over a bed. Both are null the moment the
                 gesture ends, and neither refuses anything — see lib/cob.js. */
              /* THE HAND-PLACED LAMPS AND THE ARRAYS' TOGETHER. One list,
                 because on the ceiling they are the same fitting: a recessed COB
                 is a recessed COB whether somebody put it there or a geometry
                 did. What differs is where the record lives, and that is this
                 file's business rather than the canvas's — see `cobArrays`.
                 THE DRAFT RIDES WITH THEM while the bar is still asking, so what
                 you are watching move as you change the count IS what the tick
                 will keep. */
              manualCobs={[...manualCobsPx, ...arrayCobsPx,
                ...(draftArrayPx?.pts ?? []).map((p, i) => ({
                  id: `cob-draft-${i}`, x: p.x, y: p.y,
                  watts: cobShow.watts, beam: cobShow.beam, draft: true,
                  throwFt: throwDiameterFt(cobShow.beam,
                    (cobRoom ? ceilingMmFor(cobRoom.id) / 304.8 : 0) || DEFAULT_DROP_FT),
                }))]}
              /* THE PATH AN ARRAY IS SET OUT ON, while it is being set out. It
                 is the offset ring rather than the geometry itself — that is
                 what the lamps are actually spaced along, and seeing it is how
                 you judge whether a foot is the right foot. */
              arrayPath={draftArrayPx
                ? { pts: draftArrayPx.path, closed: draftArrayPx.closed } : null}
              /* AND THE ONE UNDER AN ARRAY THAT IS OPEN, which is that array's
                 handle rather than a mark on the ceiling — see `selArrayPathPx`.
                 Withheld on the read-only sheet with everything else that can be
                 grabbed. */
              selArrayPath={readOnly ? null : selArrayPathPx}
              selArrayId={readOnly ? null : selArrayId}
              onArrayPathDown={readOnly || !canGrab(pressState) ? null : arrayGrab}
              /* THE FITTINGS STAND DOWN AND THE GUIDES COME UP WHILE A
                 PRIMITIVE IS ARMED. `shapeMenuOn` alone is not the condition:
                 the bar also arrives unarmed on a click in a space (see
                 `onCanvasClick`), and dimming a ceiling's worth of lamps because
                 somebody selected a room would be the drawing reacting to a
                 selection. It is the LIVE primitive that means "I am about to
                 place geometry". */
              placingGeometry={!readOnly && geometry.canvas.placingGeometry}
              selCobId={readOnly ? null : selCobId}
              onCobPointerDown={readOnly || !canGrab(pressState) ? null : cobPointerDown}
              /* THE GHOST CARRIES THE POOL IT WOULD THROW, so the beam angle on
                 the bar is something you can see rather than only read. Computed
                 from what is in force for the NEXT lamp and the space's own
                 ceiling — the same two figures `manualCobsPx` uses once the lamp
                 is real, so the disc does not change size at the moment of the
                 click. */
              /* ...AND IT GOES THE MOMENT THE PRESS STOPS BEING ABOUT A POINT.
                 Over a geometry the array tool takes the LINE, so a lamp drawn
                 under the pointer is a promise about a place no lamp will land —
                 and it is the brightest thing on the sheet, sitting on top of
                 the one line the press is actually about. See `geomHover`. */
              cobGhost={!readOnly && addTool === 'cob' && overRoom && addAt
                && !geomHover
                ? { ...addAt,
                    blocked: cobBlocked,
                    throwFt: throwDiameterFt(cobShow.beam,
                      (cobRoom ? ceilingMmFor(cobRoom.id) / 304.8 : 0) || DEFAULT_DROP_FT) }
                : null}
              cobGuide={!readOnly && addTool === 'cob' ? cobGuide : null} />
            <FixtureTip tip={tip} />
            {/* --- WHAT THE NEXT COB WILL BE, AT THE FOOT OF THE DRAWING -----
                UP FOR AS LONG AS THE GESTURE IS ARMED, and not only while the
                pointer is on a ceiling: it is the one thing on screen saying
                what the next press will place, and a bar that blinked out every
                time somebody crossed the margin would be a control you could not
                rely on finding. What the FIGURES on it describe still follows
                the pointer — see `cobEngine`, which answers for the point under
                it and falls back to the catalogue's ordinary downlight when
                there is no ceiling under it to read.
                IT IS PINNED RATHER THAN CARRIED, and that is a fix rather than a
                preference — see the header of CobSpec for the card that ran away
                from the cursor.
                THE FOUR HANDLERS ARE THE FOUR LIFETIMES the state block over
                `cobDraft` sets out: the slider and the chips write the draft and
                nothing else, the two buttons promote it to a one-shot or to a
                standing choice, and the chip clears the lot back to the engine's
                answer. */}
            {!readOnly && addTool === 'cob' && (
              <CobSpec stage={stageRef} watts={cobShow.watts} beam={cobShow.beam}
                recommended={!cobDraft && !cobOnce && !cobStanding}
                dirty={cobDirty}
                onWatts={(w) => setCobDraft((d) => ({ ...(d ?? cobInForce),
                                                      watts: clampWatts(w) }))}
                onBeam={(b) => setCobDraft((d) => ({ ...(d ?? cobInForce),
                                                     beam: nearestBeam(b) }))}
                onRecommended={() => {
                  setCobDraft(null); setCobOnce(null); setCobStanding(null);
                }}
                onThis={() => { setCobOnce(cobDraft); setCobDraft(null); }}
                onAll={() => { setCobStanding(cobDraft); setCobDraft(null); }}
                /* THE RUN, AND THE TWO WAYS IT CAN END. Both put the tool down —
                   see `cobRun`, and the note in CobSpec on why neither is a
                   pause. The cross removes exactly the ids this arming of the
                   tool created, so a lamp placed earlier in the session, or on a
                   previous visit to the plan, is out of its reach. */
                placed={cobRun.length}
                space={cobLock
                  ? rooms.find((r) => r.id === cobLock)?.outline?.name || 'Space'
                  : null}
                onKeep={() => {
                  setCobOpen(false); setCobMode(null); disarmAdd();
                }}
                onDiscard={() => {
                  dropCobRun();
                  setCobOpen(false); setCobMode(null); disarmAdd();
                }}
                /* --- THE ARRAY, WHERE THAT IS THE GESTURE --------------------
                   WHAT MAY BE ASKED COMES FROM THE GEOMETRY. `arrayAsks` reads
                   the outline and answers with the controls it can honestly
                   offer — no side or distance for an open path, no outward for a
                   room — so the bar draws what it is handed rather than working
                   it out from a flag per question. See `arrayDraftBar`, and
                   `draftCount` for why the number box is quantised against the
                   draft's own geometry. */
                array={cobMode !== 'array' ? null : fixtures.arrays.draftBar}
                onCount={fixtureCommands.arrays.setDraftCount}
                onSide={fixtureCommands.arrays.setDraftSide}
                onOffset={fixtureCommands.arrays.setDraftOffset}
                onPlaceArray={placeArray} />
            )}
            {/* --- THE SAME BAR, ABOUT AN ARRAY ALREADY ON THE DRAWING -------
                CLICKING ONE OF ITS LAMPS OPENS IT, which is the whole of why
                this exists: a spot on a ring is not a fitting anybody can edit
                on its own — it is one of twelve consequences of a count and an
                offset — so a press on it has to resolve to the thing that CAN be
                edited. See `arrayGrab`.
                THE SAME COMPONENT AND NOT A SECOND ONE. The middle of the bar is
                identical either way — a count, a side, a distance, a wattage,
                eight optics — and `editing` is what swaps the tick for a bin and
                takes the two "next lamp" controls off. See CobSpec.
                NEVER WITH THE TOOL IN HAND. `addTool === 'cob'` renders the bar
                above this one, and two of them would be two bars in one place;
                the press that selects an array disarms every tool anyway, so
                this is belt and braces rather than a live case. */}
            {!readOnly && addTool !== 'cob' && selArrayBar && (
              <CobSpec stage={stageRef}
                watts={selArrayBar.watts} beam={selArrayBar.beam}
                array={selArrayBar.array}
                onWatts={(w) => setArraySpec(selArrayId, { watts: w })}
                onBeam={(b) => setArraySpec(selArrayId, { beam: b })}
                onCount={(n) => setArrayShape(selArrayId, { count: n })}
                onSide={(id) => setArrayShape(selArrayId, { side: id })}
                onOffset={(ft) => setArrayShape(selArrayId, { offsetFt: ft })}
                onDeleteArray={() => deleteArray(selArrayId)} />
            )}
            {/* --- THE CARD THAT EXPLAINS THE OPTIONS PILL --------------------
                BESIDE THE CANVAS AND NOT INSIDE IT, because it deliberately
                sits OFF the sheet with a leader line back to the chip — see
                OptionCoach, which measures the pill in the document rather than
                recomputing where it ought to be.

                ONLY WHILE ITS OWN PILL IS THE ONE OPEN. `coach` names the pill
                it was raised for; `optionPick` is the pill actually showing, and
                the two part company the moment somebody selects another space.
                A card left pointing at a chip that is no longer there would be a
                leader line to a piece of blank ceiling. */}
            {coachOn && (
              <OptionCoach stage={stageRef} label={coachLabel}
                ticked={coach.ticked} onSilence={silenceCoachHere} />
            )}
            {/* --- THE SHAPE BAR --------------------------------------------
                RENDERED HERE AND POSITIONED SOMEWHERE ELSE, which looks odd
                and is right: it is `position: fixed`, measured off the stage,
                for the two reasons OptionCoach is — the stage scrolls, so an
                absolutely positioned child scrolls away with the drawing, and
                anything inside the <svg> would be scaled by the zoom. Where it
                sits in the tree decides only what it is a sibling of.
                NOT ON THE READ-ONLY SHEET. Every button on it changes the
                ceiling. */}
            {!readOnly && geometry.bar.mode && (
              <ShapeMenu stage={stageRef} mode={geometry.bar.mode}
                tool={geometry.status.tool} sides={geometry.bar.sides}
                sizeLabel={geometry.bar.mode === 'draw' && geometry.bar.toCommit
                  ? shapeSizeLabel(geometry.bar.toCommit)
                  : geometry.bar.mode === 'edit' && geometry.shapes.selected
                    ? shapeSizeLabel(geometry.shapes.selected) : null}
                canCommit={geometry.bar.canCommit}
                showDrawActions={geometry.status.role !== 'cove'}
                /* THE OFFSET, AND IT IS NULL UNLESS THE DRAFT WAS BORROWED. See
                   `heldAsks` — a shape dragged out from scratch has no geometry
                   to be set in from. */
                offset={geometry.bar.offset}
                onOffsetSide={(id) => setHeldOffset({ side: id })}
                onOffsetFt={(ft) => setHeldOffset({ ft: Math.max(0, Number(ft) || 0) })}
                radius={geometry.bar.mode === 'edit' && geometry.shapes.selected
                  && roundable(geometry.shapes.selected)
                  ? { ft: geometry.shapes.selected.radiusFt || 0,
                      max: maxRadiusFt(geometry.shapes.selected) } : null}
                onTool={pickShapeTool}
                onSides={(n) => { setShapeSides(n); setShapeAskSides(false); }}
                onCommit={commitShape}
                onCancel={() => {
                  /* ONE CROSS, TWO MEANINGS, AND THEY DO NOT COLLIDE. In the
                     sides step it is "back" — the polygon was never started, so
                     there is nothing to throw away and the tool goes back to
                     unarmed. Everywhere else there IS a draft and this is the
                     bin. */
                  if (geometry.bar.askSides) { setShapeAskSides(false); setShapeTool(null); return; }
                  abandonShape();
                }}
                onRadius={(ft) => geometry.shapes.selected
                  && docActions.patchShape(geometry.shapes.selected.id, { radiusFt: ft })}
                onDuplicate={() => geometry.shapes.selected && duplicateShape(geometry.shapes.selected.id)}
                onDelete={() => geometry.shapes.selected && deleteShape(geometry.shapes.selected.id)} />
            )}
          </div>
        )}
        {prep && !sheetOpen && (
          <PlanLoader
            width={source.w} height={source.h}
            rooms={loaderRooms}
            phase={prep.phase} detail={prep.detail}
            done={prep.done} total={prep.total} steps={prep.steps} />
        )}
      </div>

      {/* FROSTED, OVER THE PAGE'S OWN GRAPH PAPER. The panel keeps its grid
          column — the drawing still stops at its left edge rather than sliding
          under it — so what shows through the glass is the dark ground and its
          grid lines, not the plan. Same three declarations as the top bar, for
          the obvious reason: two pieces of chrome on one screen made of
          different glass read as a mistake. */}
      {/* --- A COLUMN IN THREE PARTS, AND IT USED TO BE ONE SCROLLER ------
          The panel was a single `overflow-y-auto` box: Share at the top, the
          tab strip under it, then however many sections the current step
          carries. Everything scrolled, which was fine while everything in here
          was a control over the drawing.

          IT IS NOT FINE FOR THE ELECTRICALS. That switch is the one control on
          this panel that is a different TRADE, and it is the last thing anybody
          does with a plan — so it has to be reachable from wherever the scroll
          happens to be, on a plan with twenty spaces as much as on one with
          two. A footer is what "always reachable" looks like in a column.

          SO: `min-h-0` AND `overflow-hidden` ON THE COLUMN, and the scroll moves
          inside it. `min-h-0` is the load-bearing one — a flex child's default
          `min-height:auto` refuses to shrink below its content, so without it
          the column grows past the grid row and the footer walks off the bottom
          of the screen instead of pinning to it.

          THE HEADER AND THE STRIP LEFT THE SCROLLER TOO, and that is a second
          gain rather than a side effect: Share and the exports used to scroll
          away behind the spaces list, and "where am I" is not a question a tab
          strip should answer only near the top of the page.

          AND THE PADDING SPLIT UP WITH THEM. It was `pt-4 px-4 pb-10` on the
          one box; each part now states its own, because a footer with the
          scroller's 40px foot on it would be a footer with a hole under it. */}
      <div className="bg-white/5 backdrop-saturate-[1.8] backdrop-blur-[5px]
        border-l border-border/10 flex flex-col min-h-0 overflow-hidden">
        {/* --- THE HEADER: THE EXPORTS, THEN SHARE -------------------------
            TWO ACTS THAT ARE NOT CONTROLS OVER THE DRAWING, in one row above
            the tabs. Everything below this changes what is on the sheet; these
            two take the sheet somewhere — to a file, or to somebody else. That
            is what they have in common, and it is why they read as a masthead
            rather than as the first and last sections of a list.

            EXPORT WAS A SECTION AT THE FOOT OF THE DESIGN TAB, three `BTN`s and
            a paragraph about DXF layers, below the View disclosure. Nothing was
            wrong with it except where it was: exporting is not a design
            decision, so it sat under a fold, after every control that is one,
            in a panel you had to scroll to the end of to find it. The note went
            with the section — it is on the DXF button's own `title` now, which
            is where a sentence about a file format is read anyway.

            SHARE STAYS THE ONLY WHITE BUTTON ON THIS PANEL. Everything else in
            here is glass on a dark ground, deliberately quiet, because the
            panel is a column of controls and a stack of solid buttons would be
            a wall. This is the one act on this screen that reaches somebody
            else, so it gets the treatment "New Project" and "Add a plan" get on
            the screens above. It is no longer FULL WIDTH, and that reasoning has
            simply expired: full width was because a small button floated in a
            340px column has to be aimed at, and there was nothing to sit beside
            it. There is now.

            AND IT IS A `<header>`, NOT A `<div>`. `SEC` cancels its own top
            border with `first-of-type:border-t-0`, and `first-of-type` counts
            siblings of the SAME TAG — the trap the tab strip's `<nav>` note
            below tells the whole story of. This row is outside the scroller, so
            it could not take that slot anyway; it is a `<header>` because that
            is the honest element.

            `!prep` AND `!doorEdit` AND `!zoneEdit` FOR ONE REASON, SAID THREE
            TIMES: each of those is a panel that holds a single question — a
            wait with one way out, or a gesture being asked for — and a row of
            file formats and a modal invite over the top of one is an invitation
            to walk away from a thing that is happening. */}
        {source && !readOnly && !prep && !doorEdit && !zoneEdit && !boardPlace
          && !stepTool && !wallEdit && !geometry.panel.coveDraw && !sheetOpen && (
          <header className="flex-none flex items-center justify-between gap-2
            pt-4 px-4 pb-3">
            {/* NOTHING TO EXPORT ON THE TRACER. There is no layout yet, so all
                three would be dead buttons — and a dead button is a claim that
                something is available. The empty span holds Share at its end. */}
            {step !== 'trace' ? (
              <div className="flex gap-1.5">
                <button className={BTN_EXPORT} disabled={!totals.rooms}
                  /* THE PARAGRAPH THIS SECTION USED TO CARRY, AS A TOOLTIP.
                     "Everything is on a superluminal_ layer, split by trade" is
                     a sentence about a file format, read once by the one person
                     who opens the file in CAD — it does not need permanent
                     space in a panel, and it has none to spend in a header. */
                  title={'One DXF, everything on a superluminal_ layer, split by'
                    + ' trade. ' + (isVector
                      ? 'In this drawing\u2019s own units and origin, so it lands'
                        + ' straight on top of the original.'
                      : 'In feet.')}
                  onClick={async () => {
                    if (!await gateExport()) return;
                    download(`${exportBase}-lights.dxf`, toSuperluminalDXF({
                      source, pxPerFt, heightPx: source.h,
                      rooms: rooms.map((r) => ({ name: r.outline.name, plan: r.plan })),
                      objects: obstaclesPx,
                      accents: accentZonesPx,
                      spots: taskSpotsPx,
                    }), 'application/dxf');
                    milestone.current?.('export');
                  }}>DXF</button>
                {/* SVG WENT. It was the only export nobody could open in the
                    thing they were going to open it in: a consultant gets a DXF,
                    a client gets a PDF or a PNG, and an SVG is a file for a
                    browser or a designer's editor — neither of which is on the
                    path this drawing takes. It also carried the whole plan
                    base64'd into it, so it was the largest file on the row and the
                    least useful. PDF is the vector export now, which is what the
                    SVG was really being asked for. */}
                {/* PNG AND PDF FOLLOW THE VIEW. Night view is a deliverable in its
                    own right — a dark sheet with the fittings glowing on it is how
                    a scheme gets presented — so an export that quietly handed back
                    the day version would be overruling a choice that is visibly
                    on screen. `layers.invert` is that choice, and it decides the
                    plan's polarity AND the ground together: either alone is the
                    wrong sheet. The thumbnail does NOT follow it — see
                    `getSnapshot` — because a card picture should look the same
                    whichever view somebody left the plan in. */}
                <button className={BTN_EXPORT} disabled={!source} onClick={async () => {
                  if (!await gateExport()) return;
                  download(`${exportBase}-lights.png`,
                    await svgToPNG(svgRef.current, source.w,
                      { asScanned: !layers.invert, ground: layers.invert ? '#000000' : '#fff' }));
                }}>PNG</button>
                {/* PDF IS PLOTTED FROM THE GEOMETRY, NOT PRINTED FROM THE SCREEN.
                    It went through the browser's print dialog for one revision and
                    the output was a photograph of a user interface: haloes, hover
                    states and selection frames all landed as ink, up to 1.1mm on
                    an A4. See pdfPlot.js — same inputs as the DXF, three line
                    weights, and the imported page embedded as vector so the plan
                    stays sharp at any zoom on its own sheet size.
                    AND IT FOLLOWS THE VIEW: day view gives the line plot, night
                    view the presentation sheet — black paper, the plan inverted,
                    the fittings glowing as real PDF gradients. */}
                <button className={BTN_EXPORT} disabled={!source} onClick={async () => {
                  if (!await gateExport()) return;
                  try {
                    /* THE SHEET FOLLOWS THE VIEW. Night view is the
                       presentation drawing — black paper, the plan inverted
                       under it, the fittings glowing as the accent ramp — and
                       day view is the line plot. The base is re-rendered from
                       the original file at the sheet's own resolution rather
                       than reusing the editor's 2400px copy; that is the whole
                       reason it is awaited separately. */
                    const base = layers.invert
                      ? await nightBase(openPdf, initialFile, pdfPage).catch(() => null)
                      : null;
                    const out = await plotToPDF({
                      source, pxPerFt, rooms, objects: obstaclesPx,
                      accents: accentZonesPx, spots: taskSpotsPx, coves: reverseCoves,
                      file: initialFile, pageNo: pdfPage, title: exportBase,
                      night: layers.invert, base,
                    });
                    download(`${exportBase}-lights.pdf`, out.bytes, 'application/pdf');
                    milestone.current?.('export');
                  } catch (err) { console.error('[export] the plot failed', err); }
                }}>PDF</button>
              </div>
            ) : <span />}
            {/* THE ICON IS DRAWN, not loaded — the same decision as the top
                bar's undo/redo pair and the rail's house. Heroicons' `share`,
                outline, at this chrome's own 1.7 stroke rather than their 1.5,
                and at 13px to sit with the smaller type. */}
            {onShare && (
              <button type="button" onClick={onShare}
                title="Share this project with somebody"
                className="flex-none text-[11.5px] leading-none px-2.5 py-[6px] rounded
                  border border-white bg-white text-black cursor-pointer inline-flex
                  items-center justify-center gap-[6px]
                  transition-colors duration-[120ms] hover:bg-text hover:border-text
                  focus-visible:outline-2 focus-visible:outline-accent
                  focus-visible:outline-offset-2">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none"
                  stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
                  strokeLinejoin="round" aria-hidden="true">
                  <path d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283
                    1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25
                    2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0
                    3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
                </svg>
                Share
              </button>
            )}
          </header>
        )}
        {/* --- WHERE YOU ARE, AND IT IS ABOVE EVERYTHING IT NAVIGATES ------
            FOUR PLACES, AS FOUR TABS. The spaces on the plan, the design laid
            out on them, the schedule that falls out of it, and — for role 1 —
            the model readings behind all three. They used to be navigated three
            different ways: a button at the foot of the panel, an implicit "you
            are here", and a pill in the top bar. One strip, one idiom, one
            answer to "where am I".

            ABOVE THE PANEL'S OWN BRANCHING, which is what the hoist buys and
            the reason this is not inside the design branch with the rest of it.
            The panel swaps its whole contents when the schedule is open — see
            the note below — so a strip further down would VANISH exactly when
            you needed it to get back. It is the frame, not one of the views.

            AND OUTSIDE THE SCROLLER NOW, with the header above it. It was the
            first thing IN the scroller, which meant the answer to "where am I"
            scrolled away the moment somebody opened a space — on a plan with
            twenty of them the strip was several screens behind. See the note on
            the column.

            NOT IN THE VIEWER AND NOT WHILE THE PIPELINE RUNS. `readOnly` has no
            step to move between, and `prep` is a wait with one way out that the
            panel already offers; tabs during either would be controls that
            cannot do what they claim.

            BOQ IS GATED ON A LAYOUT rather than on `source`, which is a slight
            tightening of what the old pill did. The pill appeared as soon as a
            plan was loaded, on the reasoning that an empty BOQ tab on the drop
            screen is an invitation to a blank page — but a plan with outlines
            and no layout is the same blank page, and this strip only exists past
            `step !== 'trace'`, which is exactly "there is a layout". */}
        {source && step !== 'trace' && !readOnly && !prep && !doorEdit && !zoneEdit
          && !boardPlace && !stepTool && !wallEdit && !geometry.panel.coveDraw && (
          /* NO RULE UNDER THE STRIP. It carried `border-b border-border/10` — a
             full-width hairline, the convention for a tab strip on a light
             ground where the tabs are cards sitting on a sheet. These are not
             cards: they are three words on glass, and the current one is picked
             out by a white underline of its own. The hairline ran on past that
             underline to the panel's edge, so the mark that means "you are here"
             was a two-pixel-thicker segment of a line that was already there —
             which is exactly as hard to read as it sounds. Without it the white
             underline is the only horizontal rule in the strip and needs no
             help being seen.

             AND IT IS A `<nav>`, NOT A `<div>`, WHICH IS THE OTHER HALF OF
             REMOVING THAT RULE. `SEC` cancels its own top border with
             `first-of-type:border-t-0` — the first section in the panel has
             nothing above it to be separated from. `first-of-type` counts
             siblings of the SAME TAG, so putting a `<div>` here quietly took
             that slot: the Spaces section stopped being the first div, its
             `border-t` started painting, and a hairline appeared a dozen pixels
             below the tabs that looked exactly like the one I had just removed
             from the strip. A `<nav>` is a different tag, so the first `<div>`
             child is the first section again and the rule cancels as it always
             did — in this branch and in the BOQ and viewer branches alike.
             It is also the honest element: this is navigation between the three
             things the app does. `role="tablist"` overrides nav's implicit
             `navigation` role, which is what we want it announced as. */
          <nav className="flex px-4 mb-3" role="tablist" aria-label="Plan view">
            {/* --- FOUR TABS, AND TWO OF THEM ARE NEW WORK -----------------
                “OUTLINES” IS “SPACES” AND IT IS NO LONGER A TRIP. The old tab
                did not select a view at all: it called `backToOutlines`, which
                shows the tracer — so one of the three tabs in a strip about
                where you are in the panel actually replaced the CANVAS, and it
                was `aria-selected="false"` for ever because there was no state
                for it to be selected in. It is an ordinary tab now, holding the
                list it is named after, and the route to the tracer is a button
                in that list's heading where it belongs.

                AND ADMIN IS THE FOURTH, for the audience it is for rather than
                for the step it is in — see the note over its section. It is the
                one tab that is not offered to everybody, so it is the one tab
                whose absence has to leave the other three looking deliberate:
                three words instead of four, no gap, no disabled stub. */}
            {/* BOARDS SITS BETWEEN DESIGN AND BOQ, which is where it belongs in
                the order the work happens: the drawing, then the plates that
                switch it, then the schedule of everything. It is also a tab and
                not a modal because "See all switchboards" has to be somewhere
                you can get BACK from, and the strip is that place. */}
            {[['spaces', 'Spaces'], ['design', 'Design'], ['boards', 'Boards'],
              ['boq', 'BOQ'],
              ...(isAdmin ? [['admin', 'Admin']] : [])].map(([k, label]) => (
              <button key={k} role="tab" aria-selected={panelView === k}
                className={panelView === k ? PTAB_ON : PTAB}
                onClick={() => docActions.setView(k)}>{label}</button>
            ))}
          </nav>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-10
          flex flex-col gap-1.5">
        {/* --- THE WALKTHROUGH, UNDER IT ------------------------------------
            ONLY ON THE OUTLINES STEP, AND THAT IS THE WHOLE PLACEMENT. On this
            step the panel holds the Share button and nothing else — everything
            below is gated on `step !== 'trace'` because every one of those
            sections is a control over a LAYOUT, and there is no layout yet. So
            this column is 340px of empty glass beside the one screen that asks
            somebody to do something with a mouse they have not done before.
            Past this step the panel has fourteen sections to hold, and a video
            at the top of it would push the spaces list off the fold to explain
            a screen you have already got through.

            UNDER SHARE RATHER THAN OVER IT, because Share is the primary act of
            this surface — the one white button on the panel — and the thing that
            reads as "press me first" should not be a video. It is also where the
            tab strip sits on the other two steps: the slot under the button is
            already the panel's "about this screen" slot.

            `!prep` FOR THE SAME REASON THE BUTTON ABOVE HAS IT: while the
            pipeline runs the panel collapses to the wait and its one way out,
            and a walkthrough over that is an invitation to walk away from a
            thing that is happening. */}
        {showTrace && !prep && <HowToVideo className="flex-none mb-3" />}
        {/* THE BOQ PANEL HAS ONE JOB.        {/* THE BOQ PANEL HAS ONE JOB. Every other section here is a control over
            the drawing — arm a fan, recompute the accents, toggle a layer — and
            not one of them means anything while a schedule is on screen. A panel
            full of controls that act on something you cannot see is worse than
            an empty one, so it collapses to the only thing there is to do with a
            schedule: get it out of here — which the strip above now does. */}
        {boardsOpen ? (
          /* --- THE PANEL BESIDE THE SHEET, AND IT SAYS ALMOST NOTHING.
              THE SAME ARGUMENT THE SCHEDULE'S PANEL MAKES. Every other section
              in this column is a control over the DRAWING, and not one of them
              means anything while a sheet of paper is on screen — a panel full
              of controls acting on something you cannot see is worse than an
              empty one.
              WHAT IS DIFFERENT IS THAT THERE IS NOTHING TO DO WITH THIS SHEET.
              A schedule collapses to its three export buttons; a switchboard
              sheet is edited ON the sheet, where each plate's height is a box
              you type in. So the panel holds the count, and the way out is the
              strip above it. */
          <div className={SEC}>
            <h3 className={H3}>Switchboards</h3>
            <div className={KV_HEAD}>
              <span>{boardSheet.reduce((n, g) => n + g.plates.length, 0)} plates</span>
              <span>{sbCountry.name}</span>
            </div>
            {boardSheet.map((g) => (
              <div className={KV} key={g.roomId}>
                <span>{g.name}</span>
                <b>{g.plates.map((q) => q.name).join(', ')}</b>
              </div>
            ))}
          </div>
        ) : boqOpen ? (
          <div className={SEC}>
            <h3 className={H3}>Export the schedule</h3>
            <p className={`${N} mt-0.5 mb-2.5`}>
              {boq.totals.fittings} fitting{boq.totals.fittings === 1 ? '' : 's'}
              {boq.totals.stripMetres > 0 && <> · {boq.totals.stripMetres.toFixed(2)} m of strip</>}
              {' '}· {boq.totals.watts} W
            </p>
            <div className="flex flex-col gap-1.5">
              {[['xlsx', 'Excel', '.xlsx — one sheet, quantities as numbers'],
                ['csv', 'CSV', '.csv — UTF-8, opens anywhere'],
                ['pdf', 'PDF', '.pdf — plain, for printing and marking up']].map(([k, label, note]) => (
                <button key={k} title={note} onClick={() => exportBOQ(k)}
                  className={BTN_BOQ}>
                  <b>{label}</b><span>{note}</span>
                </button>
              ))}
            </div>
            {!boq.scaled && (
              <p className={`${NW} mt-2.5`}>
                No scale is set, so the LED strip runs are counted but not
                measured. Set the scale and the metres appear.
              </p>
            )}
            {/* "← BACK TO THE DRAWING" WAS HERE. The Design tab in the strip
                at the top of this panel is the same act, said once, in the place
                that also says where you are. A button at the foot of a panel
                whose only job is to leave it was the second answer. */}
          </div>
        ) : readOnly ? (
          /* THE READING, NOT THE CONTROLS. See ViewerPanel for why the editing
             panel is removed rather than disabled. The exports are wired here
             rather than inside that component because every one of them needs
             something that only exists in this closure — `svgRef` for the two
             raster formats, the room-to-feet mapping for the two DXFs — and
             threading six values through a prop to rebuild the same three calls
             on the other side would be a second export path to keep in step
             with this one.

             NO MILESTONE ON THE DXF. In the editor that button records an
             `export` revision, on the sound reasoning that somebody taking a
             file away is the strongest signal a design is finished. An operator
             downloading somebody else's drawing is not that signal, and writing
             a revision row would put a fictional milestone in the training
             corpus — and a write on a screen that promises it does not write. */
          <ViewerPanel
            rooms={rooms} totals={totals} boq={boq}
            layers={layers} onToggleLayer={toggle}
            focusId={focusId} onFocus={docActions.setFocusId}
            surfaceCount={surfacesPx.length}
            accentCount={accentZonesPx.length}
            spotCount={taskSpotsPx.length}
            isVector={isVector}
            /* THE OPERATOR'S TWO. `isAdmin` is only passed by the /admin route —
               the share-link viewer passes none — so both stay off a client's
               copy of this same panel. */
            isAdmin={isAdmin}
            showGrid={showGrid}
            onToggleGrid={() => setShowGrid((v) => !v)}
            originalName={initialFile?.name || null}
            /* NOT BEHIND `gateExport`. That gate is the till, and it is asking
               the OWNER to pay for a drawing this app produced. This is the file
               they already own, handed back to an operator who is looking at
               their plan; charging for it would be charging the wrong person for
               the wrong thing. */
            onDownloadOriginal={initialFile
              ? () => download(initialFile.name || 'original', initialFile,
                               initialFile.type || 'application/octet-stream')
              : null}
            onOpenBOQ={() => docActions.setView('boq')}
            onExport={async (kind) => {
              /* ALL THREE BEHIND ONE GATE, at the top, before any of the work.
                 The DXF is built synchronously and the PDF re-renders the base
                 page — doing either and then asking would mean a cancelled
                 export that had already spent a second of somebody's laptop. */
              if (!await gateExport()) return;
              /* ONE DXF, AND IT IS THE SAME ONE ON BOTH SCREENS. There were two
                 — a CAD overlay and a "standalone" file on its own invented
                 layers — and the standalone one carried the planner's working
                 onto a deliverable sheet. See the header of the DXF block in
                 exporters.js. The exporter decides for itself whether it can
                 overlay, from `source.kind`. */
              if (kind === 'dxf') {
                download(`${exportBase}-lights.dxf`, toSuperluminalDXF({
                  source, pxPerFt, heightPx: source.h,
                  rooms: rooms.map((r) => ({ name: r.outline.name, plan: r.plan })),
                  objects: obstaclesPx, accents: accentZonesPx, spots: taskSpotsPx,
                }), 'application/dxf');
                return;
              }
              // The same sheet the editor prints, and the same view rule — one
              // implementation, so an operator's PDF and an owner's cannot come
              // out differently.
              if (kind === 'pdf') {
                (layers.invert
                  ? nightBase(openPdf, initialFile, pdfPage).catch(() => null)
                  : Promise.resolve(null))
                  .then((base) => plotToPDF({
                    source, pxPerFt, rooms, objects: obstaclesPx,
                    accents: accentZonesPx, spots: taskSpotsPx, coves: reverseCoves,
                    file: initialFile, pageNo: pdfPage, title: exportBase,
                    night: layers.invert, base,
                  }))
                  .then((out) => download(`${exportBase}-lights.pdf`, out.bytes, 'application/pdf'))
                  .catch((err) => console.error('[viewer] the plot failed', err));
                return;
              }
              svgToPNG(svgRef.current, source.w,
                { asScanned: !layers.invert, ground: layers.invert ? '#000000' : '#fff' })
                .then((png) => download(`${exportBase}-lights.png`, png))
                .catch((err) => console.error('[viewer] png export failed', err));
            }} />
        ) : (
          /* WHILE THE PIPELINE RUNS, THE PANEL SAYS NOTHING ELSE. Every section
             below reads results the run is in the middle of replacing — half of
             them would show a stale count and the other half a control that
             fires a second run into the first. So the panel collapses to the
             state and the two ways out, and the loader over the drawing carries
             the detail. */
          prep ? (
          /* ONE SENTENCE AND ONE WAY OUT, and the rest is on the drawing.
             This panel used to carry the phase, the sub-phase, a done-of-total
             count and two buttons — every one of which the loader over the
             canvas was already showing, larger and with the checklist that
             gives them context. Two live readouts of one process, three inches
             apart, is not twice the information: it is the same information
             asking to be reconciled, and the eye goes back and forth checking
             they agree.
             So the panel says the one thing the loader does not — that this is
             a wait with an end — and offers the way out. */
          <div className={`${SEC} flex-1 flex flex-col min-h-0`}>
            <div className="flex-1 flex flex-col items-center justify-center gap-4
              text-center px-1 py-6">
              <p className="m-0 text-[17px] leading-[1.35] tracking-[-0.02em] text-white
                max-w-[18ch]">Lighting up your space…</p>
              {/* ONE BUTTON, and it is the destructive one. `Stop` on its own
                  kept whatever had finished, which is genuinely useful and
                  genuinely hard to explain in a panel with nothing else in it —
                  it left you on a half-lit plan with no account of which half.
                  A wait either finishes or is abandoned. */}
              <button className={BTN_MID} onClick={() => {
                stopPipeline();
                setImg(null); setDxf(null); resetForNewPlan();
              }}>Stop and start over</button>
            </div>
          </div>
        ) : doorEdit ? (
          /* --- CONFIRM THE DOORS, AND THE PANEL HOLDS NOTHING ELSE ---------
             THE SAME SHAPE AS THE WAIT ABOVE, FOR A DIFFERENT REASON. That one
             empties because everything in it is stale; this one empties because
             everything in it is a control over a LAYOUT, and what is being
             asked here is a question about the DRAWING — which boxes on the plan
             are doors. Nine sections of ceiling options, cove pickers and layer
             checkboxes beside a one-sentence question is nine invitations to
             answer something else, and the sentence loses.
             It is also what makes the step read as a step. A panel that keeps
             its contents and grows a prompt at the top is a notice; a panel with
             one line in the middle of it is a place you have been taken to.

             THE QUESTION IS ONE LINE AND THE CARD UNDER IT IS THE INSTRUCTION,
             which is the same division the No Light Zone tab makes: what to do
             is a sentence, HOW to do it is a picture of the gesture. Somebody
             who has drawn one of these before does not read the card, and
             somebody who has not cannot be told "draw a box" in words that
             mean anything until they have seen the box being drawn. */
          <div className={`${SEC} flex-1 flex flex-col min-h-0`}>
            <div className="flex-1 flex flex-col items-center justify-center gap-4
              text-center px-1 py-6">
              <p className="m-0 text-[17px] leading-[1.35] tracking-[-0.02em] text-white
                max-w-[22ch]">Please confirm that all doors are identified</p>

              {/* THE GESTURE, DRAWN. Deliberately the No Light Zone card's own
                  graphic — a dashed box with a live corner and the pointer that
                  is sweeping it out — because it is the same gesture and drawing
                  it a second way would be teaching two. What differs is the
                  subject: the box is over a DOOR, so the plan's own mark for one
                  is under it, and the wash is the switchboard's blue rather than
                  the accent, which is the hue these boxes are drawn in on the
                  canvas and the hue of the plate they produce. */}
              <div className="flex flex-col items-center gap-2 px-4 pt-3.5 pb-3
                border border-border rounded-[10px] bg-input-bg text-center">
                <svg viewBox="0 0 72 46" aria-hidden="true"
                  className="w-[72px] h-[46px] block overflow-visible">
                  {/* the door on the plan: a leaf, its swing, and the wall it
                      is hinged into */}
                  <g stroke="var(--text-subtle)" strokeWidth="1.3" fill="none"
                    strokeLinecap="round" opacity="0.75">
                    <path d="M11 30h4M39 30h5" />
                    <path d="M15 30V12" />
                    <path d="M15 12a18 18 0 0 1 18 18" />
                  </g>
                  {/* ...and the box being swept out over it */}
                  <rect x="7" y="7" width="44" height="28" rx="2"
                    fill={SB_COLOUR} fillOpacity="0.10"
                    stroke={SB_COLOUR} strokeWidth="1.4" strokeDasharray="4 3" />
                  <circle cx="7" cy="7" r="2" fill={SB_COLOUR} />
                  {/* the pointer doing it, tip on the far corner it is dragging
                      to, so the two read as one gesture rather than as a box and
                      an arrow */}
                  <g transform="translate(51 35)">
                    <path d="M0,0 L0,15 L4,11.2 L6.8,17.6 L9.6,16.4 L6.8,10.2 L12,10 Z"
                      fill={SB_COLOUR} stroke="#fff" strokeWidth="1.1"
                      strokeLinejoin="round" />
                  </g>
                </svg>
                <p className="m-0 text-[11px] leading-[1.5] text-subtle max-w-[30ch]">
                  Draw a box over a door that was missed. Click one to drag it,
                  or to remove it.
                </p>
              </div>

              {/* THE COUNT, AND IT IS THE ONLY NUMBER HERE. What somebody is
                  being asked is whether the set is complete, and the one thing
                  they cannot see by looking at the plan is how many boxes are on
                  it — a door under a fitting, off the fold, or drawn twice. */}
              <p className={`${N} m-0`}>
                {doors.length} box{doors.length === 1 ? '' : 'es'} on the plan
              </p>

              {/* THE ANSWER, FULL WIDTH AND THE PRIMARY ACT OF THE SURFACE —
                  the same treatment Share gets on the panel it sits on, for the
                  same reason: it is the one thing this screen is for. */}
              <button className={`${BTN_PRIMARY} w-full`} onClick={confirmDoors}>
                {doors.length ? 'These are all the doors' : 'There are no doors'}
              </button>
            </div>
          </div>
        ) : boardPlace ? (
          /* --- PUT A SOCKET ON A WALL, AND NOTHING ELSE --------------------
             THE ZONE STEP'S SHAPE, FOR THE ZONE STEP'S REASON. A third question
             about the DRAWING answered with a gesture on it, and the panel's
             whole job while that gesture is being made is to say what is being
             asked and then get out of the way.

             WHAT THIS PLACES IS AN OUTLET, and the copy says so rather than
             saying "switchboard". It IS a switchboard — one socket, no switch,
             which is the one composition allowed to have none — but calling it
             that would set the wrong expectation twice over: nothing is switched
             FROM it, and it is not something you then have to go and configure.

             THE PICTURE IS THE INSTRUCTION, and what it has to carry is the
             thing nobody guesses: it goes ON A WALL. A click in the middle of a
             room does nothing, and a tool that silently ignores half the clicks
             aimed at it reads as broken. So the drawing is a pointer at a wall
             with a plate seated on it, and a wire leaving that plate — because
             the wire is the other half of what happens on the click. */
          <div className={`${SEC} flex-1 flex flex-col min-h-0`}>
            <div className="flex-1 flex flex-col items-center justify-center gap-4
              text-center px-1 py-6">
              <p className="m-0 text-[17px] leading-[1.35] tracking-[-0.02em] text-white
                max-w-[22ch]">Click a wall to put a socket on it</p>

              <div className="flex flex-col items-center gap-2 px-4 pt-3.5 pb-3
                border border-border rounded-[10px] bg-input-bg text-center">
                <svg viewBox="0 0 72 46" aria-hidden="true"
                  className="w-[72px] h-[46px] block overflow-visible">
                  {/* The wall, as a corner of a room — two strokes, because one
                      line is a dimension and a corner is a room. */}
                  <path d="M6 10 H60 M6 10 V40" fill="none"
                    stroke="var(--text-subtle)" strokeWidth="1.6" />
                  {/* The wire it leaves with, bowed the way every loop on the
                      drawing is bowed, running off to a board out of frame. */}
                  <path d="M37 14 Q22 24 8 22" fill="none" stroke={SB_COLOUR}
                    strokeWidth="1.3" strokeDasharray="2.5 2.5" strokeLinecap="round" />
                  {/* The plate, seated on the inside face of the top wall and
                      drawn in the colour it actually lands in. */}
                  <rect x="30" y="10.8" width="15" height="5" rx="1"
                    fill={SB_COLOUR} stroke="#fff" strokeWidth="1.1" />
                  {/* ...and the pointer, tip on the plate. */}
                  <g transform="translate(38 19)">
                    <path d="M0,0 L0,15 L4,11.2 L6.8,17.6 L9.6,16.4 L6.8,10.2 L12,10 Z"
                      fill="var(--accent)" stroke="#fff" strokeWidth="1.1"
                      strokeLinejoin="round" />
                  </g>
                </svg>
                <p className="m-0 text-[11px] leading-[1.5] text-subtle max-w-[30ch]">
                  It seats itself on the nearest wall and wires itself to the
                  nearest board, which grows a switch for it. Place as many as
                  you need.
                </p>
              </div>

              {/* HOW MANY ARE ON THE PLAN, AND THE WAY TO TAKE THEM ALL BACK —
                  the zone step's readout, in the zone step's words, because it
                  is the same question. ONLY THE ONES PLACED HERE: the rules put
                  boards beside doors and beds of their own, and a "clear all"
                  that took those would be offering to undo work this step did
                  not do. One at a time is Delete on the plate itself. */}
              {placedBoardCount > 0 && (
                <div className="w-full text-left">
                  <div className={KV_HEAD}>
                    <span>{placedBoardCount} socket{placedBoardCount === 1 ? '' : 's'} placed</span>
                    <button className={BTN_TINY}
                      onClick={clearPlacedBoards}>Clear all</button>
                  </div>
                </div>
              )}

              {/* NO "SET THE SCALE FIRST" HERE, and it is not an omission. The
                  palette cell that opens this step is `disabled` without a
                  scale, so the step cannot be reached without one — a warning
                  about a condition that cannot occur is a sentence that only
                  ever costs the reader a moment. */}
              <button className={`${BTN_EXIT} w-full`} onClick={closeBoardPlace}>Done</button>
            </div>
          </div>
        ) : zoneEdit ? (
          /* --- BOX OUT WHAT THE LIGHT KEEPS OFF, AND NOTHING ELSE ----------
             THE DOOR STEP'S OWN SHAPE, AND DELIBERATELY SO. Both are a question
             about the DRAWING answered with a marquee, and both used to be
             something else: the doors were a floating icon button, and this was
             the middle tab of a three-tab toolbox. A tab put the instruction
             beside two palettes and a readout — nine other things to click while
             being told to drag one box — and the instruction lost.

             WHAT IT IS NOT is a section that appears at the top of a full panel.
             That is a notice. A panel with one thing in the middle of it is a
             place you have been taken to, which is what a step has to feel like
             if the way out is going to be obvious.

             THE PICTURE IS THE INSTRUCTION and the sentence only names the
             subject. "Draw a box" is a sentence about a GESTURE, and a sentence
             is a poor way to describe one: it has to be read, and then imagined.
             A marquee being dragged is the gesture itself, at a glance. It is the
             same drawing the door step uses — same 72x46 box, same live corner,
             same pointer — because it is the same drag; what differs is the
             hue and what is under it. */
          <div className={`${SEC} flex-1 flex flex-col min-h-0`}>
            <div className="flex-1 flex flex-col items-center justify-center gap-4
              text-center px-1 py-6">
              <p className="m-0 text-[17px] leading-[1.35] tracking-[-0.02em] text-white
                max-w-[22ch]">Box out anything the light should keep off</p>

              <div className="flex flex-col items-center gap-2 px-4 pt-3.5 pb-3
                border border-border rounded-[10px] bg-input-bg text-center">
                <svg viewBox="0 0 72 46" aria-hidden="true"
                  className="w-[72px] h-[46px] block overflow-visible">
                  {/* The zone being swept out: a dashed box with a live corner. */}
                  <rect x="7" y="7" width="44" height="28" rx="2"
                    fill="var(--accent)" fillOpacity="0.07"
                    stroke="var(--text-subtle)" strokeWidth="1.4"
                    strokeDasharray="4 3" />
                  <circle cx="7" cy="7" r="2" fill="var(--text-subtle)" />
                  {/* ...and the pointer that is doing it, tip on the far corner
                      it is dragging to, so the two read as one gesture rather
                      than as a box and an arrow. */}
                  <g transform="translate(51 35)">
                    <path d="M0,0 L0,15 L4,11.2 L6.8,17.6 L9.6,16.4 L6.8,10.2 L12,10 Z"
                      fill="var(--accent)" stroke="#fff" strokeWidth="1.1"
                      strokeLinejoin="round" />
                  </g>
                </svg>
                <p className="m-0 text-[11px] leading-[1.5] text-subtle max-w-[30ch]">
                  Drag a box over a bed, a wardrobe, anything the fittings should
                  stay clear of. Draw as many as you need.
                </p>
              </div>

              {/* WHAT IS ALREADY THERE, AND THE ONLY WAY TO TAKE ONE BACK. A
                  zone has no selection on the canvas — nothing to click, so
                  nothing for Delete to act on — which makes this list the whole
                  of its editing. The door step's count is a plain sentence for
                  the opposite reason: a door box IS selectable, so its list
                  would have been a second way to do one thing. */}
              {zones.length > 0 ? (
                <div className="w-full text-left">
                  <div className={KV_HEAD}>
                    <span>{zones.length} zone{zones.length === 1 ? '' : 's'}</span>
                    <button className={BTN_TINY}
                      onClick={() => docActions.clearZones()}>Clear all</button>
                  </div>
                  {zones.map((z, i) => (
                    <div className={KV} key={z.id}>
                      <span>Zone {i + 1}</span>
                      <b>
                        {pxPerFt
                          ? `${((z.x1 - z.x0) / pxPerFt).toFixed(1)} × ${((z.y1 - z.y0) / pxPerFt).toFixed(1)} ft`
                          : `${Math.round(z.x1 - z.x0)} × ${Math.round(z.y1 - z.y0)} px`}
                        <button className={BTN_NUDGE} title="Remove zone"
                          onClick={() => docActions.removeZone(z.id)}>×</button>
                      </b>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={`${N} m-0`}>None on the plan yet.</p>
              )}

              {/* THE WAY OUT, FULL WIDTH AND THE PRIMARY ACT OF THE SURFACE —
                  the same treatment the door step's answer gets, for the same
                  reason: it is the one thing this screen is for once the boxes
                  are drawn. Escape does it too; a step whose only exit is a
                  keystroke is a step people get stuck in. */}
              <button className={`${BTN_EXIT} w-full`} onClick={closeZoneEdit}>Done</button>
            </div>
          </div>
        ) : geometry.panel.coveDraw ? (
          /* --- DRAWING A COVE, AND THE PANEL HOLDS NOTHING ELSE -------------
             THE FOURTH STEP ON THIS SCREEN AND THE SAME SHAPE AS THE OTHERS.
             The bar with the primitives on it is on the DRAWING, where the
             shapes are — that is the whole idea of it — and while it is open the
             panel was still showing the space list, the finishes and the
             analysis: nine sections of controls over a layout, beside somebody
             halfway through a gesture. A panel with one thing in the middle of
             it is a place you have been taken to, which is what a step has to
             feel like if the way out is going to be obvious.

             THE PICTURE IS THE INSTRUCTION and the sentence names the subject,
             the same division the door, zone and wall steps make. The two open
             coves are the ones that need it: nothing on the drawing says that a
             line has to land on a wall at both ends, and nothing suggests that a
             pen path can be finished without closing it. */
          <div className={`${SEC} flex-1 flex flex-col min-h-0`}>
            <div className="flex-1 flex flex-col items-center justify-center gap-4
              text-center px-1 py-6">
              <p className="m-0 text-[17px] leading-[1.35] tracking-[-0.02em] text-white
                max-w-[22ch]">{geometry.panel.coveDraw.title}</p>

              <div className="flex flex-col items-center gap-2 px-4 pt-3.5 pb-3
                border border-border rounded-[10px] bg-input-bg text-center">
                {geometry.panel.coveDraw.art}
                <p className="m-0 text-[11px] leading-[1.5] text-muted max-w-[30ch]">
                  {geometry.panel.coveDraw.hint}
                </p>
              </div>

              {/* WHY THE SPAN IN FLIGHT IS NOT A COVE. Under the card because it
                  is the answer to the drag being made right now, and it is only
                  ever there when something is wrong. */}
              {geometry.panel.coveDraw.why && <p className={`${NW} m-0 text-left`}>{geometry.panel.coveDraw.why}</p>}

              {/* FINISHING THE PATH IS NOT FINISHING WITH THE PEN, so it is its
                  own button and it only exists while there is a path that can be
                  finished — which for an open cove means one that lands on a
                  wall at both ends. Enter says the same thing; a keystroke
                  nobody is told about is not a way out. */}
              {geometry.panel.canFinishOpen && (
                <button className={`${BTN_FULL} w-full`} onClick={finishOpenCove}>
                  Finish the run
                </button>
              )}

              {/* DONE IS THE COVE'S ONLY CONFIRMATION. If a valid draft is on
                  the drawing it is committed; otherwise Done simply leaves the
                  tool, preserving the button's existing way-out behaviour. */}
              <button className={`${BTN_EXIT} w-full`}
                onClick={geometry.bar.canCommit ? commitShape : closeShapeTool}>
                Done
              </button>
            </div>
          </div>
        ) : wallEdit ? (
          /* --- WHAT EACH WALL IS FINISHED IN, AND NOTHING ELSE -------------
             THE ZONE STEP'S SHAPE, FOR THE ZONE STEP'S REASON. Both are a
             question about the DRAWING answered by pointing at it, and neither
             can be answered in a panel: "wall 3" names nothing, and the wall you
             are looking at names itself. So the column empties to the one
             sentence, the picture of the gesture, and the way out.

             THE PICTURE IS THE INSTRUCTION and the sentence only names the
             subject — the same division the door and zone steps make. What is
             hard to guess here is not that walls can be clicked, it is WHICH
             lines are live: the room is one polygon among eight on the sheet and
             its neighbours look exactly like it. The drawing shows one outline
             picked out with a pointer on one of its edges, which says that in a
             glance.

             THE MIX IS UNDER IT, LIVE. This is the one step whose answer
             accumulates — you click four walls, not one — so there has to be
             somewhere that says what you have said so far. It is the same line
             the space detail shows, in the same words, because it is the same
             reading. */
          <div className={`${SEC} flex-1 flex flex-col min-h-0`}>
            <div className="flex-1 flex flex-col items-center justify-center gap-4
              text-center px-1 py-6">
              <p className="m-0 text-[17px] leading-[1.35] tracking-[-0.02em] text-white
                max-w-[22ch]">Pick a wall and say what it is finished in</p>

              <div className="flex flex-col items-center gap-2 px-4 pt-3.5 pb-3
                border border-border rounded-[10px] bg-input-bg text-center">
                <svg viewBox="0 0 72 46" className="w-[72px] h-[46px] block overflow-visible"
                  aria-hidden="true">
                  {/* The room, with three of its walls light and the one being
                      pointed at dark — the before and the after in one picture. */}
                  <rect x="7" y="8" width="58" height="30" rx="1.5"
                    fill="var(--accent)" fillOpacity="0.05" stroke="none" />
                  <g strokeLinecap="round" fill="none">
                    <polyline points="7,38 7,8 65,8 65,38" stroke="#F2F2F2" strokeWidth="3" />
                    <line x1="7" y1="38" x2="65" y2="38" stroke="#7A7A7A" strokeWidth="4.4" />
                    <line x1="7" y1="38" x2="65" y2="38" stroke="#242424" strokeWidth="3" />
                  </g>
                  {/* ...and the pointer on that wall, tip ON the line, so the
                      two read as one gesture rather than as a wall and an arrow. */}
                  <g transform="translate(38 38)">
                    <path d="M0,0 L0,15 L4,11.2 L6.8,17.6 L9.6,16.4 L6.8,10.2 L12,10 Z"
                      fill="var(--accent)" stroke="#fff" strokeWidth="1.1"
                      strokeLinejoin="round" />
                  </g>
                </svg>
                <p className="m-0 text-[11px] leading-[1.5] text-muted max-w-[30ch]">
                  Click any wall of the highlighted space. Light, medium or dark.
                </p>
              </div>

              {wallEditRoom && (
                <div className="w-full text-left">
                  <div className={KV_HEAD}>
                    <span>{wallEditRoom.outline.name || 'Space'}</span>
                    <span>{wallMixLabel(wallMix(wallEditRoom.geo.polygonFt,
                      materialsOf(materials, wallEditRoom.id).walls))}</span>
                  </div>
                </div>
              )}

              {/* THE WAY OUT, FULL WIDTH AND THE PRIMARY ACT OF THE SURFACE —
                  the same treatment the other three steps' answers get. Escape
                  does it too; a step whose only exit is a keystroke is a step
                  people get stuck in. */}
              <button className={`${BTN_EXIT} w-full`} onClick={closeWallEdit}>Done</button>
            </div>
          </div>
        ) : stepTool ? (
          /* --- ONE GESTURE, AND NOTHING ELSE ON THE PANEL -----------------
             THE NO-LIGHT ZONE'S SHAPE, FOR THE NO-LIGHT ZONE'S REASON. All
             three are a question about the DRAWING answered with a gesture, and
             these two are the gestures people get wrong: the spot's box says
             what is being LIT and the fitting then stands off on the ceiling
             grid aimed back into it, and the cove's drag is locked to the wall
             the press landed on. Told in a hint card under a
             six-cell palette, beside a spaces list and two more sections, that
             is one sentence competing with everything else this panel offers.
             Told on an empty panel it is the screen. See `stepTool` for why
             these two and not the other three.

             THE PICTURE IS THE INSTRUCTION, and it is the palette's own — see
             the note over `GESTURE`, which is exported for exactly this. One
             drawing per gesture, shown in both places, so the card and the step
             cannot come to describe two different drags.

             AND THE TOOL STAYS ARMED UNTIL `Done`. Both used to put themselves
             away after one placement, which is right for a tool armed from a
             palette that is still on screen and wrong for a step: the panel
             would empty, take one box, and fill itself back in — a screen that
             closes itself while you are still using it, with a Done button
             nobody could ever reach. See the spot branch in `onZoneUp` and the
             cove's in the press handler. */
          <div className={`${SEC} flex-1 flex flex-col min-h-0`}>
            <div className="flex-1 flex flex-col items-center justify-center gap-4
              text-center px-1 py-6">
              <p className="m-0 text-[17px] leading-[1.35] tracking-[-0.02em] text-white
                max-w-[22ch]">{stepTool.stepTitle}</p>

              <div className="flex flex-col items-center gap-2 px-4 pt-3.5 pb-3
                border border-border rounded-[10px] bg-input-bg text-center">
                {GESTURE[stepTool.id]}
                {/* THE PALETTE'S OWN WORDS TOO, read out of `LIGHT_TOOLS`
                    rather than retyped: the hint and the consequence are what
                    the button's card says, and two copies of a sentence about a
                    gesture is how the panel ends up describing two gestures.
                    `Esc` is dropped — down here the way out is a button. */}
                <p className="m-0 text-[11px] leading-[1.5] text-muted max-w-[30ch]">
                  {stepTool.hint} {stepTool.consequence}
                </p>
              </div>

              {/* WHY A GESTURE WAS REFUSED, and it belongs to the cove. A diagonal
                  wall and a slot an inch long are both things a person can
                  reasonably try and both have real reasons they cannot be done.
                  It used to sit under the palette; with the palette off screen
                  while the step is open, the answer has to be here or the click
                  simply does nothing and says nothing. */}
              {coveNote && <p className={`${NW} m-0 text-left`}>{coveNote}</p>}

              {/* HOW MANY ARE ON THE PLAN, and the way to take them all back —
                  the zone step's readout, in the zone step's words, because it
                  is the same question.
                  ONLY THE ONES PLACED BY HAND. The pass finds task surfaces and
                  reverse coves of its own, and a count that mixed them in would
                  be offering to clear work this screen did not do. */}
              {placedHere.n > 0 && (
                <div className="w-full text-left">
                  <div className={KV_HEAD}>
                    {/* ONE LINE, DELIBERATELY. A break between the noun and
                        its plural is a SPACE once JSX has collapsed it — "4
                        spot s placed" — which is the kind of thing that reads
                        as a rendering fault rather than as a typo. */}
                    <span>{placedHere.n} {placedHere.n === 1 ? placedHere.one : placedHere.many} placed</span>
                    <button className={BTN_TINY} onClick={placedHere.clear}>Clear all</button>
                  </div>
                </div>
              )}

              {/* FINISHING THE RUN IS NOT FINISHING WITH THE PEN, so it is its
                  own button and it only exists while there is a path to finish.
                  Enter and a double-click say the same thing on the drawing —
                  see `finishTrack` — and this is the one that is visible: a
                  keyboard shortcut nobody is told about is not a way out.
                  ABOVE `Done`, because in the middle of a path it is the thing
                  somebody means. Done still disarms, and it drops what is
                  half-drawn, which is what putting a pen down does. */}
              {/* WRAPPED AND NOT PASSED. `finishTrack` takes `closed` as its
                  first argument now, and handing it straight to onClick would
                  hand it the click event — which is truthy, so every run
                  finished from this button would come out as a closed
                  circuit. */}
              {stepTool.id === 'track' && !trackPen.isEmpty && (
                <button className={`${BTN_FULL} w-full`} onClick={() => finishTrack()}>
                  Finish run
                </button>
              )}
              {/* DONE FINISHES WHAT IS IN FLIGHT FIRST, and it did not, which
                  is the bug that made this tool look broken. `disarmAdd` throws
                  a half-drawn path away — right for a pen being put down
                  mid-stroke, and wrong for the button somebody presses when
                  they think they are finished. Nobody clicks out four corners
                  and then presses Done meaning "discard that": Done means done.
                  The path still has to survive the refusals below, but it gets
                  the chance. */}
              <button className={`${BTN_EXIT} w-full`}
                onClick={stepTool.id === 'track'
                  ? () => { finishTrack(); disarmAdd(); } : disarmAdd}>Done</button>

              {/* ...AND WHY A RUN IS NOT ON THE DRAWING. Under the button on
                  purpose: it is the answer to the press that was just made, and
                  it is the last thing on the panel because it is only ever
                  there when something did not work. See `trackNotes`. */}
              {stepTool.id === 'track' && geometry.tracks.noteLines.map((ln) => (
                <p key={ln.why} className={`${NW} m-0 text-left w-full`}>
                  {ln.n > 1 ? `${ln.n} runs are not on the plan. ` : 'That run is not on the plan. '}
                  {ln.text}
                </p>
              ))}
            </div>
          </div>
        ) : <>
        {source && step !== 'trace' && <>
          {/* --- SPACES, AND IT IS THE WHOLE OF THIS TAB --------------------
              “OUTLINES” WAS THE TAB'S NAME AND “SPACES” IS WHAT IT HELD. The
              strip said Outlines / Design / BOQ while the section under it said
              Spaces, which is one thing called two names in two pieces of
              chrome a dozen pixels apart — and “outline” is the geometry, the
              polygon somebody traced, where “space” is the room it describes.
              The rooms are what this list is of.

              AND IT IS THE ONLY THING IN HERE NOW. The tab holds two views and
              never both: the list of spaces, and — once one is picked — that
              space on its own. It used to be an accordion, and the accordion is
              what had to go; see the note on the detail below. One tab, one
              subject, one room at a time. */}
          {panelView === 'spaces' && (openRoom ? (
            /* --- ONE SPACE, AND IT REPLACES THE LIST ----------------------
                IT WAS AN ACCORDION and the accordion is what had to go. A
                room's height, its three finishes and its illuminance are four
                decisions deep; opened inside a row, every other space on the
                plan sat between them and the bottom of the panel, and on a
                twelve-room flat the thing you had just clicked was the one
                thing you could not see all of.
                So opening a space REPLACES the list, and the way back is the
                first thing in the view. See SpaceDetail. */
            <SpaceDetail
              key={openRoom.id}
              name={openRoom.outline.name || 'Space'}
              meta={[
                roomTypes[openRoom.id]
                  ? roomTypeIn(projectId, roomTypes[openRoom.id].type)?.label ?? 'Other'
                  : null,
                `${ftin(openRoom.stats.widthFt)} × ${ftin(openRoom.stats.heightFt)}`,
                `${Math.round(openRoom.stats.areaSqft)} sqft`,
              ].filter(Boolean).join(' · ')}
              disabled={readOnly}
              ceilingMm={ceilingMmFor(openRoom.id)}
              onCeilingMm={(v) => setCeilingMmFor(openRoom.id, v)}
              materials={materialsOf(materials, openRoom.id)}
              wallLabel={wallMixLabel(
                wallMix(openRoom.geo.polygonFt, materialsOf(materials, openRoom.id).walls))}
              materialsLabel={materialsSummary(
                materialsOf(materials, openRoom.id), openRoom.geo.polygonFt)}
              editing={materialsEdit === openRoom.id}
              onEdit={() => setMaterialsEdit(openRoom.id)}
              onDone={() => setMaterialsEdit(null)}
              onTone={(surface, tone) => setSurfaceTone(openRoom.id, surface, tone)}
              onConfigureWalls={() => openWallEdit(openRoom.id)}
              onBack={() => pickSpace(openRoom.id)}
              analysis={spaceAnalysis(openRoom)}
              /* TWO STORES BEHIND ONE CONTROL, AND THE ROW SAYS WHICH. A row
                 with a `wattRange` is a fitting somebody placed by hand and its
                 key is that fitting's id; everything else is a family this room
                 holds one decision about. See `setCobSpec`. */
              /* THREE STORES BEHIND ONE CONTROL, AND THE ROW'S KEY SAYS
                 WHICH. An array's key is its own id, a hand-placed lamp's is
                 the fitting's, and everything else is a family this room holds
                 one decision about. Asked in that order because an array is
                 checked by id and cannot be mistaken for either of the others. */
              /* FOUR STORES BEHIND ONE CONTROL, AND THE ROW'S KEY SAYS WHICH.
                 A track's modules are keyed `<trackId>|<kind>` and are asked
                 about FIRST, because that key cannot be mistaken for any of the
                 other three — see `isModuleRow`, and `setTrackModuleSpec` for
                 why a module's figure has to be written onto the fitting rather
                 than into the room's override store. */
              onWatts={(row, w) => (isModuleRow(row.key)
                ? setTrackModuleSpec(row.key, { watts: w })
                : cobArrays.some((a) => a.id === row.key)
                  ? setArraySpec(row.key, { watts: w })
                  : row.wattRange
                    ? setCobSpec(row.key, { watts: w })
                    : setRowWatts(openRoom.id, row.key, row.familyId, w))}
              onBeam={(row, deg) => (isModuleRow(row.key)
                ? setTrackModuleSpec(row.key, { beam: deg })
                : cobArrays.some((a) => a.id === row.key)
                  ? setArraySpec(row.key, { beam: deg })
                  : setCobSpec(row.key, { beam: deg }))}
              /* WHICH ROWS ARE THE FITTING THAT IS SELECTED ON THE DRAWING.
                 A LIST OF ROW KEYS AND NOT A FITTING ID, because the two are not
                 the same thing and only this file knows the mapping: a placed
                 COB and a run of tape ARE their own row, so their id is the key;
                 a task spot is one row for all of them, so the key is the
                 catalogue line. `analysisHighlight` does that translation once.
                 SEVERAL AT ONCE IS POSSIBLE and correct — a spot and a run can
                 both be picked — so it is a list rather than one key. */
              highlight={analysisHighlight.keys}
              /* THE AMBIENT GRID, FILLED OR NOT. Per space, because it is a
                 decision about one ceiling: a flat can have its bedrooms laid
                 out automatically and its living room by hand. */
              autoplace={lighting.status.autoplaceOn(openRoom.id)}
              onAutoplace={readOnly ? null
                : (on) => lighting.commands.setAutoplace(openRoom.id, on)} />
          ) : (
            <div className={SEC}>
              {/* --- THE HEADING CARRIES THE WAY BACK TO THE TRACER -------
                  THE TAB USED TO BE THAT ROUTE. “Outlines” sat where “Spaces”
                  sits now and its whole job was `backToOutlines` — show the
                  tracer, keep the lights. Renaming it to the thing this panel
                  is actually a list OF would have quietly deleted the only way
                  back to a mis-traced wall, so the route comes with the list:
                  the list is what you have, and this is how you change it. */}
              <div className="flex items-baseline justify-between gap-2">
                <h3 className={H3}>Spaces · {rooms.length}</h3>
                <button className={`${BTN_TINY} mb-2.5`} onClick={backToOutlines}
                  title="Go back to the outlines — nothing is discarded">Trace</button>
              </div>
              {/* --- NO CAP. THE TAB IS THE CAP NOW ---------------------------
                  This list was a scroller inside a scroller because it shared
                  the panel with four other sections. The Spaces tab removed that
                  reason, and the detail view removed the last of it: nothing
                  opens inside a row any more, so a row is one line high and the
                  list is as long as the plan has rooms. */}
              {rooms.map((r) => {
                const coved = (r.coves?.length ?? 0) > 0;
                /* NOTHING FROM THE ELECTRICALS IS READ HERE. The bolt, then
                   `electric`, then a plate count off `boardResults` — three
                   revisions of the same mistake, which is that a list of rooms
                   is a place to report on the wiring. It is not; the wiring has
                   a layer and a switch of its own. */
                return (
                  <div key={r.id} className={`group ${ROW_FLUSH} ${ROW_OFF}`}>
                    {/* ONE HANDLER FOR THE POINTER AND THE KEYBOARD. They were
                        two copies of the same expression, which is how they would
                        have drifted the moment selecting a space did anything more
                        than set the focus — and it now does. See `pickSpace`. */}
                    <div role="button" tabIndex={0} className={ROW_PICK}
                      onClick={() => pickSpace(r.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault(); pickSpace(r.id);
                        }
                      }}>
                      <div className="flex items-center gap-[9px]">
                        <div className="flex-auto min-w-0">
                          <div className={PICK}>
                            <span className={NAME}>{r.outline.name || 'Space'}</span>
                          </div>
                          <div className={META}>
                            <span>
                              {/* The classification, where it exists. It is the
                                  reason a room did or did not get accents, so it
                                  belongs next to the room rather than buried in a
                                  console log. */}
                              {roomTypes[r.id] && (
                                <b className={RTYPE} title={roomTypes[r.id].why}>
                                  {roomTypeIn(projectId, roomTypes[r.id].type)?.label ?? 'Other'}
                                </b>
                              )}
                              {ftin(r.stats.widthFt)} × {ftin(r.stats.heightFt)}
                              {' '}· {Math.round(r.stats.areaSqft)} sqft
                              {coved && <b className={RTYPE}>Cove</b>}
                            </span>
                          </div>
                        </div>
                      </div>
                      {r.outline.enclosingPx?.length > 0 && (
                        <p className={`${NW} mt-0.5`}>
                          {r.outline.enclosingPx.length} space
                          {r.outline.enclosingPx.length > 1 ? 's sit' : ' sits'} wholly inside this
                          one, so {r.outline.enclosingPx.length > 1 ? 'they are' : 'it is'} held out
                          of the ceiling as a no-light zone. Drag a corner out to a wall and it
                          will be subtracted properly instead.
                        </p>
                      )}
                      {r.region?.warning && <p className={`${NW} mt-0.5`}>{r.region.warning}</p>}
                    </div>
                    {/* THE CHUNKING ICON AND THE OPTIONS DRAWINGS WERE HERE, and
                        both are readings of a grid that is not being cut — see
                        AUTO_GRID. A picture of six ways to divide a ceiling, on a
                        ceiling with nothing on it, is a control over an answer
                        nobody asked for. `pickingId`, `ChunkOptions` and the
                        full-screen picker are all still wired; putting them back
                        is putting the icon back in this row. */}
                  </div>
                );
              })}
              {outlinesPx.length > rooms.length && (
                <button className={`${BTN_FULL} mt-1.5`}
                  onClick={lightWholePlan}>
                  Take up all {outlinesPx.length} outlines
                </button>
              )}
            </div>
          ))}

          {step !== 'chunks' && step !== 'trace' && <>

          {/* --- DESIGN: SECTIONS, NOT TABS --------------------------------
              “EDIT” WAS ONE BOX WITH THREE TABS — Ceiling objects, No-light
              zones, Lighting — on the reasoning that the three are mutually
              exclusive in USE as well as in layout: each arms a tool, and this
              canvas takes one armed tool at a time.

              WHAT THAT MISSED IS THAT A TAB STRIP HIDES TWO THIRDS OF A
              TOOLBOX. The palette you are not looking at is not merely unarmed,
              it is invisible — and this panel is where somebody finds out what
              this app can put on a drawing at all. Exclusivity is a fact about
              the CANVAS's pointer, and it is already enforced there: picking any
              tool disarms every other. It was never a reason to hide the rest.

              So the palettes are stacked and open, in the order the work
              happens: the lights first, because they are what the plan is for,
              and the ceiling objects under them, because they are the things the
              light has to keep off.

              AND THE ZONES TAB IS NOT A SECTION AT ALL. Boxing out a no-light
              zone is a gesture on the DRAWING rather than a control in a panel
              — the same thing confirming the doors is — so it takes the panel
              over for as long as it lasts, and the button that starts it sits in
              the palette with the fittings. See `zoneEdit`. */}
          {panelView === 'design' && <>
          {/* --- THE PLATE YOU CLICKED, ABOVE EVERYTHING ------------------
              FIRST IN THE TAB AND NOT LAST, because it is not a control over
              the drawing — it is the ANSWER to a gesture that has just been
              made, and an answer three sections below the fold is a click that
              appeared to do nothing. It is also the only section here that is
              conditional on a selection, so it takes the top slot without
              permanently displacing anything: with no plate selected the
              Lighting palette is the first section, exactly as before.

              A SECTION AND NOT A STEP. Boxing a zone or tracing an outline
              takes the whole panel over, because both are gestures on the
              canvas that the panel cannot help with. Reading a switchboard is
              the opposite: the plate stays selected on the drawing, the
              palettes below stay live, and the card is one more thing the panel
              is saying. See SwitchboardCard for why it is an elevation. */}
          {selBoardParts && (
            <div className={SEC}>
              {/* --- THE NAME, AND THE WAY TO THE WHOLE SET -----------------
                  SB7 AND NOT "SWITCHBOARD". The generic word was the heading
                  when a plate was the only plate you could see; on a plan with
                  nine of them it names the CLASS of thing and says nothing about
                  which one — and SB7 is what the sheet, the schedule and the
                  person on site call it. What KIND it is moves to the row below,
                  where it belongs beside the height: those two together are the
                  whole of what a plate is.

                  AND THE LINK IS TOP-RIGHT, in the heading's own row. It is not
                  a control over this plate — it leaves for a different screen —
                  so it must not sit among the chips that are. Link-styled rather
                  than a button for the same reason: a bordered button here would
                  read as the third thing you can do to SB7. */}
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <h3 className={H3_FLUSH}>{selBoard?.name ?? 'Switchboard'}</h3>
                <button type="button"
                  className={'appearance-none border-0 bg-transparent p-0 cursor-pointer '
                    + 'text-[11px] leading-none underline underline-offset-2 '
                    + 'whitespace-nowrap transition-colors duration-[120ms] '
                    + 'focus-visible:outline-2 focus-visible:outline-accent '
                    + 'focus-visible:outline-offset-2 '
                    + 'text-white/70 decoration-white/25 hover:text-white'}
                  onClick={() => docActions.setView('boards')}>
                  See all switchboards →
                </button>
              </div>

              {/* WHAT IT IS, AND HOW HIGH — space-betweened, directly above the
                  illustration. The height is the one thing about a plate that a
                  plan view cannot show (a rectangle at 300 and a rectangle at
                  1200 are the same rectangle from above), and it is a DECISION
                  rather than a derivation, so it is a box you type in and not a
                  number that is printed. The same box is on the sheet; see
                  HeightField for why it is shared. */}
              <div className="flex items-baseline justify-between gap-2 mb-2.5
                text-[11.5px] text-muted">
                <span>{selBoardParts.outlet ? 'Socket outlet' : 'Switchboard'}</span>
                <HeightField mm={heightOf(selBoard)}
                  onChange={(mm) => setBoardHeight(selBoard.id, mm)} />
              </div>

              {/* THE MODULES ARE PICKABLE, AND THE PICKED ONE IS FILLED IN. One
                  selection seen from two sides: press a module and its wire goes
                  green on the drawing, press a wire and its module fills here.
                  A fan lights both of its modules — the switch and the regulator
                  are one flow — which is right rather than incidental. */}
              <SwitchboardCard composition={selBoardParts}
                extras={selBoardParts.outlet ? [] : selBoardExtras}
                onRemove={selBoardParts.outlet ? null : removeBoardPoint}
                selectedFlowId={selFlowId} onPickFlow={pickFlow}
                /* AND THEY CAN BE DRAGGED ALONG THE PLATE. Not on an outlet:
                   one socket has no arrangement to have. */
                onReorder={selBoardParts.outlet ? null : reorderBoardUnit} />

              {/* --- THE RATING, AND ONLY ON AN OUTLET -----------------------
                  "CAN BE ANY POWER RATING" IS THE WHOLE OF WHAT VARIES BETWEEN
                  ONE OUTLET AND THE NEXT. A 6A point for a lamp and a 16A one
                  for an air conditioner are the same fitting at two ratings, and
                  the switch on the far board is rebuilt to match — see
                  `pointsFromFlows`. Same shape as a fan's sweep chips, and there
                  for the same reason: a property of the selected thing, asked
                  where the thing is described.

                  IT WAS ON THE SWITCHBOARD TOO AND SHOULD NOT HAVE BEEN. On a
                  board these chips set the rating of one socket among a dozen
                  modules — a detail of one part, given the same weight as the
                  question the panel is actually for — and they sat directly
                  above a row of "+ 6A switch / + 16A socket" buttons that ALSO
                  name ratings. Two rows of amperages meaning two different
                  things is a panel nobody can read at a glance. On a board the
                  socket's rating is chosen the same way every other part on it
                  is: by adding the one you want. */}
              {selBoardParts.outlet && (
                <div className="flex flex-wrap gap-1 mt-2.5">
                  {sbCountry.switchRatings.map((a) => (
                    <button key={a} type="button"
                      className={selBoard?.amps === a ? PROP_ON : PROP_OFF}
                      onClick={() => setBoardAmps(selBoard.id, a)}>{a}A</button>
                  ))}
                </div>
              )}

              {/* --- WHAT CAN GO ON IT, generated from the country rather than
                  listed — see addablePoints. A socket's chip prints the width of
                  the PAIR, because that is what pressing it costs the plate.

                  ON AN OUTLET AS WELL, AND THAT IS THE CONVERSION. An outlet is
                  one socket and nothing else — that is the definition, not a
                  setting — so pressing "+ 16A switch" on one IS saying it is not
                  an outlet any more, and it flips as the point lands. See
                  `addBoardPoint`. A "Single socket outlet" checkbox used to live
                  here for that; it was a second way to say the same thing as
                  these buttons, and the two would have disagreed the first time
                  somebody used the one you did not expect. */}
              <div className="flex flex-wrap gap-1 mt-2">
                {addablePoints(sbCountry).map((p) => (
                  <button key={`${p.kind}:${p.amps ?? ''}`} type="button"
                    className={BTN_TINY} onClick={() => addBoardPoint(p)}>
                    + {p.label}
                  </button>
                ))}
              </div>

              {/* --- AND THE WAY BACK, WHICH IS ONE PRESS AND NOT A TOGGLE.
                  A BUTTON AND NOT THE OTHER HALF OF A CHECKBOX. The two
                  directions are not symmetrical and pretending they were is what
                  made the checkbox confusing: going TO an outlet is a decision
                  ("this plate is just a socket"), where coming BACK is a
                  consequence of adding something. So the decision gets a button,
                  the consequence gets no control at all, and neither is a state
                  anybody has to interpret.

                  OFFERED ON EVERY PLATE, including the board a rule put beside
                  the door. It is not destructive: whatever was switched from it
                  falls back to the next board by itself, and adding any point
                  brings it straight back. */}
              {!selBoardParts.outlet && (
                <button type="button" className={`${BTN_TINY} mt-2`}
                  onClick={() => setBoardOutlet(selBoard, true)}>
                  Single socket outlet
                </button>
              )}
            </div>
          )}
          {/* --- WHAT WAS PLACED BY HAND, AND HOW TO TAKE IT BACK ---------
              THE LIGHTING PALETTE WAS HERE, and it is the left-hand rail now
              — see ToolRail. What stays is the part of this section that was
              never a tool: a count of what a hand put on the drawing, and the
              one button that undoes all of it. That is a READING of the plan,
              which is what this column is for.
              THE HEADING WENT WITH THE PALETTE. With nothing under it but a
              button that names its own subject, "Lighting" was a title over one
              sentence. */}
          {(manualCoves.length > 0 || manualAccents.length > 0
            || manualSurfaces.length > 0 || !rooms.length) && (
          <div className={SEC}>
            {/* `coveNote` WAS RENDERED HERE and is now in the cove's step. It
                is only ever set while the cove tool is armed — and arming it
                replaces this whole panel — so a copy under the palette could
                not fire: it would have been a refusal shown on a screen the
                refusal cannot happen on. */}
            {/* WHAT HAS BEEN SET OUT BY HAND, with a way back. The detected
                coves are counted in the Result panel; these are the ones
                somebody drew, and they are the only ones that can be undone
                wholesale. */}
            {manualCoves.length > 0 && (
              <button className={`${BTN_FULL} mt-2`}
                onClick={() => { docActions.clearCoves(); disarmAdd(); }}>
                Clear the {manualCoves.length} reverse cove
                {manualCoves.length === 1 ? '' : 's'} placed by hand
              </button>
            )}
            {!rooms.length && (
              <p className={NOTE_WARN}>
                Light a space first — a fitting has to belong to one.
              </p>
            )}
            {/* NO "ON THE PLAN" COUNT. It said how many strips, sconces and
                spots the drawing carries, three inches above a Result panel
                that says it again — two live readouts of one number, which is
                not twice the information: it is the same information asking
                to be reconciled. */}
            {(manualAccents.length > 0 || manualSurfaces.length > 0) && (
              <button className={`${BTN_FULL} mt-2`}
                onClick={() => { docActions.clearAccents(); docActions.clearSurfaces();
                                 disarmAdd(); }}>
                Clear the {manualAccents.length + manualSurfaces.length} placed by hand
              </button>
            )}
          </div>
          )}

          {/* --- THE ELECTRICAL ELEMENTS ---------------------------------
              IT WAS "CEILING OBJECTS", AND THAT NAME STOPPED BEING TRUE. The
              row held a fan, a cassette and a hatch — three things ON a ceiling
              that the grid has to keep off — and the argument for its position
              under the lights was that they are CONSTRAINTS and belong after the
              thing they constrain.

              Half of that is still right and the name is not. A split AC's
              indoor unit is on a wall at 2100mm, a geyser is over a door, and a
              switchboard is a plate on the plaster: none of them is on the
              ceiling, and none of them moves a downlight. What the six items
              share is that they are what the ELECTRICAL drawing is about — the
              things that need a circuit, and the plate that circuit runs from.

              IT KEEPS ITS PLACE UNDER THE LIGHTING, which the rename does not
              change: the lights are what somebody came here to lay out, and
              three of these six still shape where they can go. */}
          {/* THE PALETTE IS IN THE RAIL NOW — see ToolRail — and what is left
              here is the one PROPERTY it always carried underneath: a fan's
              sweep. That is a fact about the object you have selected, which is
              exactly what this column is for; the six buttons that placed them
              were not.
              THE HEADING WENT WITH THE PALETTE, for the reason the Lighting one
              did: it named a row of tools that is no longer here. */}
          {(!pxPerFt || !!armed
            || ceilingObjs.some((o) => o.id === selObjId && o.kind === 'fan')) && (
          <div className={SEC}>
            {/* A fan's sweep, offered only when a fan is in play — armed, or
                selected. It is the one property of the four that is a standard
                size rather than something to drag to. */}
            {(() => {
              const obj = ceilingObjs.find((o) => o.id === selObjId);
              if (armed !== 'fan' && obj?.kind !== 'fan') return null;
              const current = obj?.kind === 'fan' ? sweepMm(obj) : fanSweepMm;
              return (
                <div className="flex gap-1 mt-[7px]">
                  {FAN_SWEEPS.map((mm) => (
                    <button key={mm} type="button"
                      className={current === mm ? PROP_ON : PROP_OFF}
                      /* EVERY SELECTED FAN, NOT JUST THE PRIMARY — see
                         `setSweep`, which carries the argument. */
                      onClick={() => setFanSweep(mm)}
                      >{mm} sweep</button>
                  ))}
                </div>
              );
            })()}

            {/* THE "AC OR TRAP DOOR" CHIPS WERE HERE, and they were the cost of
                one shared palette cell: the button placed a rectangle and this
                row said which rectangle it was. The cassette and the hatch have
                their own buttons now — see CeilingPalette — so the question is
                answered by the thing you pressed, and a property row that only
                ever repeated the press is a second control for one decision.
                WHAT WENT WITH IT is RETYPING a placed object from cassette to
                hatch without moving it. That was real, and it is not worth a
                permanent row: the object is deleted and the other button
                pressed, which is two clicks on a mistake nobody makes twice. */}

            {!pxPerFt && <p className={NOTE_WARN}>Set the scale first — these are placed at a real size.</p>}
            {armed && (
              <p className={NOTE}>Click on the plan to place the
                {' '}{CEILING_BY_ID[armed]?.label.toLowerCase()}.</p>
            )}

            {/* HOW TO GET A SECOND ONE, SAID ONCE AND ONLY WHEN IT APPLIES.
                Option-drag is invisible: nothing on the drawing suggests a
                modifier exists, and a gesture nobody can discover is a gesture
                nobody has. It appears only once something is actually placed —
                before that there is nothing to copy and the line would be a
                rule about a thing that does not exist yet. */}
            

            {/* THE LIST OF PLACED OBJECTS WAS HERE, AND SO WAS THE COUNT
                BEFORE IT. Both were answers to "did that land, and where" —
                and both were written when an object was a grey mark you could
                lose on somebody else's line work. It is not one any more: a
                fan, a cassette and a trapdoor are drawn in white in night mode
                and in our own ink on paper, they carry a clearance ring, and
                selecting one frames it with handles where it sits. So the list
                restated the drawing in words, a scroll box away from it, and
                the two ways of picking an object disagreed about which was
                canonical.

                WHAT WENT WITH IT, STATED SO IT IS A CHOICE AND NOT AN
                ACCIDENT: picking an object by NAME (the canvas has the same
                shift-click, on the thing itself), its size READOUT, and the mm
                boxes for a rectangle. The last is the only one that was a
                capability rather than a second view — a corner drag resizes an
                AC or a trapdoor and reads its size out as you go, so what is
                gone is typing an exact number, not setting an exact size. If
                that comes back it belongs beside the sweep chips above, as a
                property of the SELECTED object, rather than as a row in a list
                of all of them. */}
          </div>
          )}

            {/* --- THE RESULT PANEL WAS HERE, AND IT IS A LINE IN THE FOOTER
                NOW. Two tiles, a verdict sentence and a recommendation, in a
                section of their own between the palettes and the View
                disclosure — half a screen of chrome saying four numbers, in a
                column where every other section is something to press.

                It was also in the wrong place to be READ. Every figure in it
                moves when a fitting is placed, and the placing happens on the
                canvas: a readout you have to find by scrolling the panel is a
                readout nobody watches while they work. In the footer it is
                always on screen, beside the door count, which is the other
                standing fact about this drawing. See the footer.

                WHAT SURVIVES HERE IS THE FAILURES, AND ONLY THE FAILURES. A
                space that produced no layout, and a space whose layout has
                something wrong with it, are not summary — they are the app
                telling somebody their plan did not come out, and a line in a
                footer is not where that belongs. They render nothing at all
                when there is nothing wrong, which is the usual case. */}
            {troubles.length > 0 && (
              <div className={SEC}>
                {/* Named per room. A warning about a light off its cell centre
                    is useless if you cannot tell which of eight rooms it is in. */}
                {troubles.map((t, i) => (
                  <p className={i ? NOTE_WARN : NW} key={i}><b>{t.name}</b> — {t.msg}</p>
                ))}
              </div>
            )}
            {totals.rooms === 0 && rooms.length > 0 && (
              <div className={SEC}><p className={NOTE_WARN}>
                No space on this plan produced a layout. {troubles[0]?.msg || ''}
              </p></div>
            )}

            {/* --- VIEW, CLOSED. Every control in here is a preference about the
                picture rather than a decision about the design, and a preference
                you set once and forget does not deserve permanent space above the
                export button. `<details>` and not a state flag: the browser owns
                the open/closed, keyboard and screen-reader behaviour of a
                disclosure, and reimplementing it is how one gets it wrong. */}
            {/* THE CHEVRON IS THE `::after` ON THE SUMMARY, rotated on [open] —
                the same rule as before, now written as variants. The native marker
                goes because it is the browser's triangle, not this one. */}
            <details className={`${SEC} [&>summary]:cursor-pointer [&>summary]:list-none
              [&>summary]:flex [&>summary]:items-center [&>summary]:gap-1.5
              [&>summary::-webkit-details-marker]:hidden
              [&>summary]:after:content-[''] [&>summary]:after:ml-auto
              [&>summary]:after:w-1.5 [&>summary]:after:h-1.5
              [&>summary]:after:border-r-[1.5px] [&>summary]:after:border-b-[1.5px]
              [&>summary]:after:border-subtle [&>summary]:after:transition-transform
              [&>summary]:after:duration-[120ms]
              [&>summary]:after:[transform:rotate(45deg)_translate(-2px,-2px)]
              [&[open]>summary]:mb-2.5
              [&[open]>summary]:after:[transform:rotate(225deg)_translate(-1px,-1px)]`}>
              <summary><h3 className={H3_FLUSH}>View</h3></summary>
              {/* THE BUTTONS ZOOM ABOUT THE MIDDLE OF WHAT IS ON SCREEN, not
                  about the drawing's origin. Stepping the number alone kept the
                  top-left corner still, which means the thing you were looking at
                  slid off the bottom-right every time you pressed +. The wheel
                  anchors on the pointer for the same reason; there is no pointer
                  on a button, so the centre of the viewport is the honest
                  substitute. */}
              <div className={`${BTNROW} mb-1.5`}>
                <button className={BTN} title="Zoom out (−)"
                  onClick={() => zoomBy(1 / 1.2, stageCentre())}>−</button>
                <button className={BTN} title="Actual size (0)"
                  onClick={() => zoomTo(1, stageCentre())}>{Math.round(zoom * 100)}%</button>
                <button className={BTN} title="Zoom in (+)"
                  onClick={() => zoomBy(1.2, stageCentre())}>+</button>
                <button className={BTN} title="Fit the plan to the window (F)"
                  onClick={() => zoomTo(fitZoom())}>Fit</button>
              </div>
              <p className={`${N} mt-0 mb-2`}>
                Scroll to zoom, middle-drag to pan. <b>F</b> fits, <b>0</b> is
                actual size.
              </p>
              {/* NO TOGGLE FOR A THING THAT IS NO LONGER DRAWN. The ambient grid,
                  the task-surface boxes and the secondary grid came off the
                  canvas, and a checkbox that turns on nothing is worse than no
                  checkbox: it is a promise the drawing does not keep. `zones`
                  stays, because hand-drawn no-light zones are still on the plan
                  and are still worth being able to hide while looking at the
                  layout under one. */}
              {[['plan', 'Floor plan'], ['dim', 'Fade the plan'], ['region', 'Space outline'],
                ['cells', 'Cell shading'], ['lights', 'Lights'], ['labels', 'Light tags'],
                ['fan', 'Ceiling objects'], ['zones', 'No-light zones'],
                ['accents', 'Accent lighting'], ['spots', 'Directional spots'],
                ['switchboards', 'Switchboards'],
                ['electrical', 'Electrical lines']].map(([k, l]) => (
                <label className={CHECK} key={k}>
                  <input className="lp-check" type="checkbox"
                    checked={layers[k]} onChange={toggle(k)} />{l}</label>
              ))}
            </details>
          </>}

          {/* --- ADMIN, AND IT HAS ITS OWN TAB NOW -------------------------
              IT USED TO BE THE FOOT OF THE EXPORT SECTION. Role 1 in `profiles`
              — an owner of this app, not a user of it — so it was filed last,
              behind a magenta rule, on the reasoning that it is not part of
              anybody's workflow: it exposes what the models DECIDED, which is
              what you need when a spot lands somewhere surprising and what must
              never appear on a sheet a client sees.

              That reasoning is why it is a TAB. Nested at the bottom of a
              section about file formats, it was two hundred lines of readings
              standing between the panel's last real control and the end of the
              scroll — for the admin, who had to scroll past every design
              control to reach the one thing they came for, and for the panel,
              which ended on a block most people never see. A tab is what a
              separate audience gets. It is scoped to `isAdmin` in the strip and
              again here, and `panelView` falls back to Design for anybody whose
              role changes underneath a stale tab. */}
          {panelView === 'admin' && isAdmin && <>
            <div className={SEC_ADMIN}>
              <h3 className={H3_ADMIN}>Admin · model readings</h3>
              <label className={CHECK}>
                <input className="lp-check" type="checkbox" checked={audit}
                  onChange={(e) => setAudit(e.target.checked)} />
                Show what was identified
              </label>
              {/* THE DOORS, SEPARATELY. Every dimension on the sheet hangs off
                  one of these boxes, so "did it find the doors" is a different
                  question from "why is the layout like this" and is asked at a
                  different moment. */}
              <label className={`${CHECK} mt-2`}>
                <input className="lp-check" type="checkbox" checked={auditDoors}
                  onChange={(e) => setAuditDoors(e.target.checked)} />
                Show the doors it found
              </label>
              
              {/* THE COUNTS STAY WITH THEIR OWN SWITCH rather than joining the
                  ledger below. That one answers "what did the models see on
                  this plan"; these four numbers answer "is the scale right",
                  and they are read while the boxes are on the canvas. */}
              {auditDoors && (
                <div className="mt-2 flex flex-col gap-[5px]">
                  <div className={KV_ADMIN}><span>Doors kept</span><b>{doors.length}</b></div>
                  <div className={KV_ADMIN}><span>Boxes rejected</span>
                    <b>{doorState.restored ? '—' : (doorState.rejected?.length ?? 0)}</b></div>
                  {/* A REOPENED PLAN HAS NO REJECTS TO SHOW. The kept doors are
                      saved with the plan; the refused boxes are not, so a
                      restored plan would otherwise report a confident zero and
                      read as "it refused nothing". */}
                  {doorState.restored && (
                    <p className={`${N_ADMIN} mt-1`}>
                      Restored from the saved plan, which keeps the doors but not
                      the boxes it turned down. Re-run the detection to see those.
                    </p>
                  )}
                  <div className={KV_ADMIN}><span>Scale</span>
                    <b>{pxPerFt ? `${pxPerFt.toFixed(2)} px/ft` : 'not set'}</b></div>
                  {doorPick?.id && (
                    <div className={KV_ADMIN}><span>&nbsp;&nbsp;· from a door called</span>
                      <b>{doorPick.mm ? `${doorPick.mm}mm` : '—'}</b></div>
                  )}
                  {doorState.status === 'error' && (
                    <p className={`${NE} mt-1`}>
                      The detector failed: {doorState.error}
                    </p>
                  )}
                  {!doorState.restored && doorState.rejected?.length > 0 && (
                    <details className={`${DISCLOSE_ADMIN} mt-1`}>
                      <summary>Why each box was turned down</summary>
                      {doorState.rejected.map((d, i) => (
                        <p key={i} className={`${N_ADMIN} mt-1`}>
                          <b>{(d.cls || 'box')} {(d.conf ?? 0).toFixed(2)}</b>{' — '}{d.reason}
                        </p>
                      ))}
                    </details>
                  )}
                  <p className={`${N_ADMIN} mt-1`}>
                    The gates are <code className={CODE}>DOOR_DEFAULTS</code> in{' '}
                    <code className={CODE}>doors.js</code>.
                  </p>
                </div>
              )}


              {/* THE BED, AND THEN THE GRID — TWO MORE OVERLAYS, TWO MORE
                  CHECKBOXES. Every switch in this section is now the same
                  control: a box you tick to put a reading on the drawing.
                  THE GRID WAS A BUTTON, and the argument for that was that it
                  is an ACT — put the scaffolding on, take it off — rather than
                  a standing preference. It reads better as the odd one out than
                  it did as a button: four switches over one drawing, three of
                  them ticked and one of them pressed, with the pressed one
                  carrying its state in a word that changes under the cursor
                  while the other three carry theirs in a tick. One idiom. The
                  label stays put and the tick says which way it is, which is
                  also what makes the pair readable at a glance — "grid on, beds
                  off" is a shape, not two sentences to read. */}
              {/* NO NOTE AND NO TOOLTIP. What the box is for — the rectangle
                  the planner keeps the downlights off, invisible on the sheet
                  otherwise — is written above in the bed group in PlanCanvas,
                  which is where the reasoning belongs. The label is the
                  control. */}
              <label className={`${CHECK} mt-2`}>
                <input className="lp-check" type="checkbox" checked={auditBeds}
                  onChange={(e) => setAuditBeds(e.target.checked)} />
                Show the beds it identified
              </label>
              {/* THE GRID, ON THE DRAWING. Its own switch and not part of the
                  overlay above: that one is what the MODELS read off the
                  plan, this is what our own chunker and planner did with it
                  afterwards. A light that lands somewhere odd is almost
                  always a chunk that split somewhere odd, and the split is
                  the one thing on this drawing with no visible trace at all —
                  `gridPath` has been in PlanCanvas the whole time with
                  nothing calling it.
                  ...AND IT DRAWS WITH THE LIGHTS SWITCHED OFF, which is what it
                  is mostly for now. `AUTO_GRID` places no fittings, and this
                  switch drew nothing for as long as the chunks were thrown away
                  along with them — see `gridChunks` in the `rooms` memo. The
                  chunker still runs and still has an opinion about how the
                  ceiling divides, and that opinion is exactly what somebody
                  laying lamps out by hand wants under the pointer.
                  DISABLED WITH NOTHING TO DRAW, which the button said by going
                  grey and a checkbox says the same way. There is no grid until
                  there is a laid-out space — which is a lower bar than there
                  being lights, and deliberately so. */}
              <label className={`${CHECK} mt-2 ${totals.rooms ? '' : 'opacity-40'}`}
                title="Draw the chunk boxes and cell lines the chunker cut, whether or not any lights were placed">
                <input className="lp-check" type="checkbox" checked={showGrid}
                  disabled={!totals.rooms}
                  onChange={(e) => setShowGrid(e.target.checked)} />
                Show the planning grid
              </label>
              {/* LOOK AGAIN — the manual bedroom pass. Admin-only because it
                  spends a model call per room and because the person who
                  wants it is the person tuning the detectors: on a plan where
                  the first answer was wrong there is otherwise no way to ask
                  twice without re-running the whole pipeline. */}
              <div className={`${BTNROW} mt-2.5`}>
                <button className={BTN_SECOND} disabled={bedLook === 'busy' || !rooms.length}
                  title={focus
                    ? `Ask both detectors about ${focus.outline?.name || 'this space'} again`
                    : 'Ask both detectors about every bedroom again'}
                  onClick={() => recognitionCommands.lookAgainAtBeds({ rooms, focus })}>
                  {bedLook === 'busy' ? 'Looking…'
                    : focus ? `Look again in ${focus.outline?.name || 'this space'}`
                    : 'Look again at the beds'}
                </button>
              </div>
              {bedLook && bedLook !== 'busy' && (
                <p className={`${N} mt-1.5`}>{bedLook}</p>
              )}

              {/* --- THE LEDGER, CLOSED, AND NO LONGER TIED TO THE OVERLAY.
                  It was an always-open card that appeared with the checkbox
                  above, on a #F2F2F2 ground with near-black type — a white
                  slab two thirds of the way down a dark panel, and fifteen
                  rows of counts permanently occupying the space between the
                  switch and the bottom of the panel.
                  IT IS A DISCLOSURE NOW, and shut: these are numbers you go
                  and look up when something on the drawing surprises you, not
                  numbers you read while working. `<details>` rather than a
                  state flag for the same reason the View section is one — the
                  browser already owns the open/closed, the keyboard and the
                  screen reader.
                  AND IT IS NO LONGER BEHIND `audit`. That checkbox draws
                  marks on the CANVAS, which is the thing you have to remember
                  to turn off before exporting; these are counts in a panel,
                  which cost an export nothing. Tying them together meant the
                  only way to read the ledger was to first put magenta on a
                  sheet — so they are two switches now, and each one governs
                  the surface it actually changes. */}
              <details className={`${DISCLOSE_ADMIN} mt-3`}>
                <summary>What was identified</summary>
                <div className="mt-2 flex flex-col gap-[5px]">
                  <div className={KV_ADMIN}><span>Task surfaces</span><b>{surfacesPx.length}</b></div>
                  {/* WHAT THE RENDER PASS READ, and what it turned into. The
                      cells are the working; the three fittings under them are
                      the product, and they stay on the drawing whether or not
                      this box is ticked. Counted here so that "the cells look
                      wrong" and "the cells are right and the rule did nothing"
                      are two different readings rather than one shrug. */}
                  {/* THE RENDER PASS'S WHOLE LEDGER, and this is now the only
                      place it is written down. `seen` is what PROMPT 01 read
                      off the photographs; `placed` is how many of those PROMPT
                      02 could tie to a wall on this drawing. The two differing
                      is the pass's most useful single fact — "it saw nothing"
                      and "it saw it and could not place it" are completely
                      different problems — and it left the render-pass panel
                      along with the rest of the reporting. */}
                  <div className={KV_ADMIN}><span>Wall features seen</span>
                    <b>{Object.values(wallResults)
                      .reduce((n, w) => n + (w.elements?.length ?? 0), 0)}</b></div>
                  <div className={KV_ADMIN}><span>&nbsp;&nbsp;· placed on the plan</span>
                    <b>{wallCellsPx.length}</b></div>
                  <div className={KV_ADMIN}><span>&nbsp;&nbsp;· reverse coves</span>
                    <b>{reverseCoves.length}</b></div>
                  <div className={KV_ADMIN}><span>&nbsp;&nbsp;· shelf strips</span>
                    <b>{shelfStrips.length}</b></div>
                  <div className={KV_ADMIN}><span>&nbsp;&nbsp;· art spots</span>
                    <b>{taskSpotsPx.filter((sp) => sp.art && !sp.rejected).length}
                      {taskSpotsPx.some((sp) => sp.art && sp.rejected)
                        ? ` (${taskSpotsPx.filter((sp) => sp.art && sp.rejected)
                            .reduce((n, sp) => n + (sp.wanted ?? 1), 0)} dropped)` : ''}</b></div>
                  {/* WHERE EACH ONE CAME FROM. Two sources feed this list and
                      they can double up — they did, and the count was the only
                      thing on screen that knew. A split reads as a description
                      of the pipeline when it is right and as an obvious bug
                      when it is not. */}
                  {/* THE FOOT-OF-BED RE-CUT. Its ordinary answer is "no",
                      so a count alone would be indistinguishable from the
                      rule being off or broken — the sentence beside each
                      space is the point. See bedGrid.js. */}
                  {(() => {
                    const bedrooms = rooms.filter((r) => r.plan?.ok
                      && (r.plan.stats?.bedFootApplied || r.plan.stats?.bedFootWhy));
                    if (!bedrooms.length) return null;
                    const on = bedrooms.filter((r) => r.plan.stats.bedFootApplied);
                    return (
                      <>
                        <div className={KV_ADMIN}><span>Foot-of-bed re-cut</span>
                          <b>{on.length} of {bedrooms.length}</b></div>
                        {bedrooms.filter((r) => r.plan.stats.bedFootWhy).map((r) => (
                          <p key={r.id} className="text-[11px] text-white leading-[1.5] mt-1">
                            <b>{r.outline?.name || 'Space'}</b>
                            {' — '}{r.plan.stats.bedFootWhy}
                          </p>
                        ))}
                      </>
                    );
                  })()}
                  <div className={KV_ADMIN}><span>Bed zones</span><b>{detectedZones.length}</b></div>
                  <div className={KV_ADMIN}><span>&nbsp;&nbsp;· bed-filter, whole plan</span>
                    <b>{detectedZones.filter((z) => !z.closeUp).length}</b></div>
                  <div className={KV_ADMIN}><span>&nbsp;&nbsp;· GPT, one bedroom crop</span>
                    <b>{detectedZones.filter((z) => z.judged).length}</b></div>
                  {/* AN EXCLUSION YOU CAN SEE. This used to be a third
                      SOURCE of bed geometry and is now none: the accent pass's
                      bed boxes never reach the chunking or the sconce rule.
                      Counting them anyway is what stops "bed-filter found
                      nothing here" and "there is no bed here" looking the
                      same. */}
                  <div className={KV_ADMIN}><span>&nbsp;&nbsp;· accent pass (excluded)</span>
                    <b>{bedsPerRoom.length}</b></div>
                  {detectState.whyRejected && (
                    <>
                      <div className={KV_ADMIN}><span>Bed boxes rejected</span>
                        <b>{detectState.whyRejected.n}</b></div>
                      <p className={`${N_ADMIN} border-l-2 border-[#C026D3] pl-[9px] mt-1`}>
                        Mostly: {detectState.whyRejected.top}
                        {detectState.whyRejected.topCount < detectState.whyRejected.n
                          ? ` (${detectState.whyRejected.topCount} of ${detectState.whyRejected.n})` : ''}
                        . The size gate is <code className={CODE}>BED_FT</code> in{' '}
                        <code className={CODE}>furniture.js</code>.
                      </p>
                    </>
                  )}
                  {/* SPACES, NOT BEDS. The labels used to say neither, which
                      is how "Beds re-asked 3 / Judged 1" read as three beds of
                      which two were dropped. It was three SPACES. A space is
                      re-asked only when the classifier called it a bedroom and
                      the whole-plan pass put no bed in it; the list below says
                      what came back for each one. */}
                  <div className={KV_ADMIN}><span>Bedrooms GPT was asked about</span>
                    <b>{Object.values(bedVerdicts).filter((v) => v?.refound).length}</b></div>
                  <div className={KV_ADMIN}><span>&nbsp;&nbsp;· of those, still empty</span>
                    <b>{Object.values(bedVerdicts).filter((v) => v?.refound && v.kind === 'none').length}</b></div>
                  {!!Object.keys(bedVerdicts).length && (
                    <details className="mt-1 border-t border-border/20 pt-1.5
                      [&>summary]:cursor-pointer [&>summary]:text-[11.5px]
                      [&>summary]:text-white [&>summary]:list-none
                      [&>summary]:select-none [&>summary]:hover:text-[#C026D3]
                      [&>summary::-webkit-details-marker]:hidden
                      [&>summary]:before:content-['▸_'] [&>summary]:before:text-[9px]
                      [&[open]>summary]:before:content-['▾_']">
                      <summary>What came back for each bedroom</summary>
                      {Object.entries(bedVerdicts).map(([id, v]) => (
                        <p key={id} className="text-[11px] text-white leading-[1.5] mt-1.5">
                          <b>{outlines.find((o) => o.id === id)?.name || id}</b>
                          {' — '}{judgeNote(v)}
                        </p>
                      ))}
                    </details>
                  )}
                </div>
              </details>

              {/* --- THE FILE THEY UPLOADED -------------------------------
                  LAST IN HERE, AND IT IS THE ONE THING IN THIS SECTION THAT
                  IS NOT A READING. Everything above exposes what the models
                  decided; this hands back what they were deciding ABOUT. It
                  belongs together with them anyway, because it is the same
                  job: a fitting lands somewhere surprising, the overlays say
                  what was seen, and the next question is always "what does
                  the drawing actually look like" — which needs the drawing,
                  in the application that made it, not a PNG of it with our
                  fittings on top.

                  THE FILENAME IS THE LABEL. "The original" is a different
                  file on every plan, and the extension is what says whether
                  it is worth opening — a DXF opens in CAD, a phone photo of
                  a printout does not.

                  NOT BEHIND `gateExport`. That gate is the till and it asks
                  the OWNER to pay for a drawing this app produced. This is
                  the file they already own, handed to an operator looking at
                  their plan; charging for it would be charging the wrong
                  person for the wrong thing.

                  AND NO `milestone`. Every export writes a revision row on
                  the reasoning that somebody taking a file away is the
                  strongest signal a design is finished. An operator
                  downloading somebody else's upload is not that signal, and
                  the row would put a fictional milestone in the corpus. Same
                  argument as the read-only panel's copy of this button —
                  see `onDownloadOriginal` in ViewerPanel. */}
              <div className={`${BTNROW} mt-2.5`}>
                <button className={BTN_SECOND} disabled={!initialFile}
                  title={initialFile
                    ? `${initialFile.name || 'the uploaded file'} — the file this plan was made from`
                    : 'This plan was not opened from a stored upload, so there is'
                      + ' no original to hand back'}
                  onClick={() => {
                    if (!initialFile) return;
                    download(initialFile.name || 'original', initialFile,
                             initialFile.type || 'application/octet-stream');
                  }}>
                  {initialFile
                    ? `Download the original (${uploadExt || 'file'})`
                    : 'No original on this plan'}
                </button>
              </div>
            </div>
          </>}
          </>}
        </>}
        </>
        )}
        </div>

        {/* --- THE ELECTRICALS, PINNED TO THE FOOT OF THE PANEL -------------
            THE LAST THING ANYBODY DOES WITH A PLAN, and the one control on this
            panel that is a different TRADE. It was a white plate floating in the
            bottom-left of the canvas; the note where it used to be says why that
            corner was wrong. What the footer buys is the pairing:

            THE ACT, AND THEN THE THING IT RESTS ON. Every switchboard on the
            sheet is placed beside a door — see electrical.js — so this switch is
            exactly as right as the door boxes it was derived from. The count
            under it is the one number that says how much was found, and "Modify
            doors" is the way back into them. Floating on the drawing those two
            were a diagonal apart.

            OUTSIDE THE SCROLLER, WHICH IS THE WHOLE POINT OF THE FOOTER. On a
            plan with twenty spaces the panel is several screens of column; a
            switch you have to scroll to the end of the design to reach is a
            switch that gets missed. See the note on the column for the `min-h-0`
            that makes the pinning actually pin.

            A SWITCH, NOT A BUTTON THAT CHANGES ITS OWN NAME. It was a full
            width outlined button reading "Show Electrical Layout" / "Hide
            Electrical Layout", latched by a wash of white — which is a control
            whose LABEL is its state, so the words move under you every time you
            press it and the only way to read what is on is to read what the
            button is offering to do next. A switch says both at once: the label
            names the layer and never moves, and the knob says whether it is on.
            The outline and the full width stay — this is still the second
            loudest thing on the panel, under Share.

            IT SURVIVES `doorEdit` AND `zoneEdit` ON PURPOSE, unlike everything
            above it. Both of those steps empty the panel — and this footer is
            how you get out of them: "Modify doors" is the door step's own toggle,
            and the switch above it closes the step and shows the wiring. A footer
            that vanished with the panel would take the way out with it.

            `!prep` LIKE EVERY OTHER CONTROL ON THIS SCREEN: while the pipeline
            runs the layout is being replaced under the drawing, so a switch that
            reveals wiring derived from it cannot do what it claims. And not over
            the schedule or the tracer, neither of which has wiring to show. */}
        {source && !sheetOpen && !showTrace && !prep && (
          <footer className="flex-none border-t border-border/10 px-4 pt-3 pb-4
            flex flex-col gap-2">
            <button type="button" role="switch"
              className={'appearance-none cursor-pointer w-full '
                + 'inline-flex items-center justify-between gap-2 px-3 py-[9px] '
                + 'rounded-lg border border-white text-white '
                + 'text-[12.5px] leading-none tracking-[-0.01em] '
                + 'transition-colors duration-[120ms] '
                + 'focus-visible:outline-2 focus-visible:outline-accent '
                + 'focus-visible:outline-offset-2 '
                + (layers.electrical && !doorEdit
                  ? 'bg-white/10' : 'bg-transparent hover:bg-white/10')}
              aria-checked={layers.electrical && !doorEdit}
              /* --- THE FIRST PRESS ASKS ABOUT THE DOORS -------------------
                 A switchboard is placed beside a door, so this switch cannot
                 honestly turn the wiring on until somebody has said the door
                 boxes are right — see the note by `doorsOk`. It is the same
                 control either way rather than a second button that appears once
                 and then never again: what this button means is "show me the
                 electricals", and the first time that is asked the honest answer
                 is a question. */
              title={!doorsOk && !readOnly
                ? 'Confirm the doors, then the wiring'
                : layers.electrical
                  ? 'Hide the looping and the bay boards'
                  : 'Loop every fitting back to its switchboard'}
              onClick={() => {
                /* IN THE VIEWER IT IS A LAYER SWITCH AND NOTHING MORE. An
                   operator looking at somebody else's plan is not the person who
                   can answer whether the doors are right, and this panel writes
                   nothing — see ViewerPanel. They see the wiring the owner
                   confirmed. */
                if (readOnly) { toggleElectricalLayer(); return; }
                if (zoneEdit) closeZoneEdit();
                if (doorEdit) { closeDoorEdit(); return; }
                if (!doorsOk) { openDoorEdit(); return; }
                toggleElectricalLayer();
              }}>
              {/* THE LABEL, AND IT DOES NOT MOVE. The wire itself beside it:
                  two arcs and a plate, which is exactly what the layer draws.
                  Live in the board's blue when it is on, so the state is said
                  twice on one line — at the words and at the knob. */}
              <span className="inline-flex items-center gap-2 min-w-0">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" className="flex-none"
                  stroke={layers.electrical && !doorEdit ? SB_COLOUR : 'currentColor'}
                  strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
                  aria-hidden="true">
                  <path d="M3 16c2.5-3 4.5-3 7 0M10 16c2.5-3 4.5-3 7 0" />
                  <rect x="18.5" y="5" width="3.5" height="6" rx="1" />
                  <path d="M20.25 11v2c0 1.5-1 2-2.25 2.6" />
                </svg>
                Show electrical layout
              </span>
              {/* THE KNOB CARRIES THE STATE. The track takes the board's own
                  blue when the layer is on — the same blue the plates are drawn
                  in — so the switch and the thing it reveals are one colour.
                  `aria-hidden`: `role="switch"` on the button already announces
                  on/off, and a screen reader has no use for the picture of it. */}
              <span aria-hidden="true"
                className={'flex-none inline-flex items-center w-[34px] h-[19px] '
                  + 'rounded-full p-[2px] transition-colors duration-[120ms] '
                  + (layers.electrical && !doorEdit ? '' : 'bg-white/25')}
                style={layers.electrical && !doorEdit
                  ? { backgroundColor: SB_COLOUR } : undefined}>
                <span className={'block w-[15px] h-[15px] rounded-full bg-white '
                  + 'transition-transform duration-[120ms] '
                  + (layers.electrical && !doorEdit
                    ? 'translate-x-[15px]' : 'translate-x-0')} />
              </span>
            </button>
            {/* THE COUNT AND THE WAY BACK, AND NOT IN THE VIEWER. An operator
                reading somebody else's sheet has no door to modify, and a count
                with no question attached to it is a fact in a corner that
                carries none.

                TABULAR FIGURES, LIKE EVERY NUMBER THAT CHANGES IN PLACE — this
                face's proportional `1` is half the width of its `0`, so a count
                going 9 → 10 → 11 would shuffle the words after it.

                A RULED LINK RATHER THAN A SECOND CHIP. The button above is the
                act this footer is for; this reopens a step, and a second
                bordered button under it would read as a second layer to turn
                on. `doorEdit` latches it, so the way in is also the way out. */}
            {!readOnly && (
              <div className="flex items-baseline justify-between gap-2
                text-[11px] leading-none">
                <span className="text-subtle tabular-nums">
                  {doors.length} door{doors.length === 1 ? '' : 's'} detected
                </span>
                <button type="button"
                  className={'appearance-none border-0 bg-transparent p-0 cursor-pointer '
                    + 'text-[11px] leading-none underline underline-offset-2 '
                    + 'transition-colors duration-[120ms] '
                    + 'focus-visible:outline-2 focus-visible:outline-accent '
                    + 'focus-visible:outline-offset-2 '
                    + (doorEdit
                      ? 'text-white decoration-white/60'
                      : 'text-white/70 decoration-white/25 hover:text-white')}
                  aria-pressed={doorEdit}
                  title={doorEdit ? 'Done with the doors' : 'Check the doors again'}
                  onClick={() => (doorEdit ? closeDoorEdit() : openDoorEdit())}>
                  {doorEdit ? 'Done with doors' : 'Modify doors'}
                </button>
              </div>
            )}
            {/* --- WHAT IS ON THE DRAWING, AND WHETHER IT IS ENOUGH LIGHT.
                THE RESULT PANEL, AS ONE LINE. It was a section up in the Design
                tab: two big tiles, a tick and two sentences of recommendation.
                Everything in it moves when a fitting is placed on the CANVAS,
                and a readout you have to scroll a panel to find is a readout
                nobody watches while they are working. Down here it is beside the
                door count — the other standing fact about this sheet — and it is
                on screen whatever tab the panel is on.

                THE SAME 11px AS THE DOORS LINE ABOVE IT, deliberately: these are
                two readings of one drawing, and a heavier one would claim to be
                the more important of the two.

                COUNTS ON THE LEFT AND THE VERDICT ON THE RIGHT, because they are
                different kinds of fact. The left is what you put there. The
                right is whether it works, and it is the half with a threshold
                attached — so it is the half that gets the tick.

                THE VERDICT IS COMPUTED AND NOT ASSERTED, which is the one thing
                carried over verbatim from the panel this replaces. A tick
                printed unconditionally would be the app congratulating itself on
                plans that are short. Over the target it ticks; under it, the
                dash — the same mark the schedule uses for "not specified",
                because a plan under its criterion may be exactly what the
                designer wants and is not an error.

                JUDGED ON THE ROUNDED FIGURE, so the tick can never contradict
                the number printed beside it: a raw `got >= target` reads 19.9 as
                short and then prints it as "20". */}
            {/* --- THE WHOLE PLAN'S LEVEL, AND IT IS THE PANEL'S OWN MODEL ---
                IT USED TO BE lm/sqft OF FLOOR against `lumenCriteriaFor`, which
                is what the grid was laid to. That model has a rival now — the
                space panel judges each room on its SURFACES, its finishes and
                its height (see lib/lumens.js) — and two verdicts on one drawing
                is not two readings, it is one reading and an argument. A footer
                saying a plan was short while the room open beside it ticked would
                be the app disagreeing with itself in two places you can see at
                once.
                SO THE FOOTER SUMS THE PANEL. Same arithmetic, same constants,
                every room added up: what the plan is owed, and what is on it.
                `lumenCriteriaFor` is untouched and still drives the grid — it is
                an input to the LAYOUT, and this was only ever a readout. */}
            {rooms.length > 0 && (() => {
              const got = Math.round(planLumens.achieved);
              const want = Math.round(planLumens.required);
              const n = (v) => v.toLocaleString('en-US');
              const bits = [
                // HIDDEN AT ZERO, all three, which was this panel's own rule and
                // stays it: a line that spends a third of its width saying a
                // thing is absent is a line that is harder to read for nothing.
                // `lights` joined the other two when the grid was suppressed —
                // "0 lights" on every plan is the case it was written to avoid.
                totals.lights > 0
                  ? `${totals.lights} light${totals.lights === 1 ? '' : 's'}` : null,
                spotsPlaced > 0 ? `${spotsPlaced} spot${spotsPlaced === 1 ? '' : 's'}` : null,
                stripRuns > 0 ? `${stripRuns} strip${stripRuns === 1 ? '' : 's'}` : null,
              ].filter(Boolean);
              return (
                <div className="flex items-baseline justify-between gap-2
                  text-[11px] leading-none">
                  <span className="text-subtle tabular-nums">{bits.join(', ')}</span>
                  <span className="inline-flex items-baseline gap-1 tabular-nums
                    text-subtle whitespace-nowrap">
                    {/* JUDGED ON THE ROUNDED FIGURES, so the tick can never
                        contradict the numbers printed beside it. */}
                    {got >= want ? (
                      <svg viewBox="0 0 24 24" width="10" height="10" fill="none"
                        stroke="#FFFFFF" strokeWidth="3.2" strokeLinecap="round"
                        strokeLinejoin="round" className="flex-none
                          self-center translate-y-[0.5px]"
                        aria-hidden="true"><path d="M4.5 12.75l5.25 5.25L19.5 6" /></svg>
                    ) : (
                      <span className="flex-none text-subtle leading-none"
                        aria-hidden="true">—</span>
                    )}
                    {n(got)} of {n(want)} lm
                  </span>
                </div>
              );
            })()}
          </footer>
        )}
      </div>
    </div>
  );
}
