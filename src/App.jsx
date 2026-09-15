import React, { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
/* THE LAMP FAMILY'S FIGURE AND THE FUNCTION THAT RESOLVES IT PER ROOM. Read by
   `lampWatts`, the one thing in this file that has to state a wattage for a
   fitting that stores none — see the note there. */
/* THE LUMEN MODEL'S OWN THREE ANSWERS, read by `fittingOutput` — the one thing
   in this file that has to state a wattage and an output for a fitting that
   stores neither. Same calls `analyseSpace` makes, in the same order, which is
   what keeps the hover card and the Analysis panel from disagreeing. */
import { FAMILY_BY_ID, wattsFor, unitOutput,
         lumensPerWattFor } from './lib/lumens.js';
import { FIXTURE_BY_ID } from './lib/boq.js';
/* enumerateChunkings AND findChunking ARE GONE FROM THIS FILE. Both existed to
   run and resolve a second enumeration of the chunkings, on a different room
   from the one the drawing used — see the note in the rooms memo. There is one
   enumeration now and `designChunking` owns it. */
/* `nextChunkOption` WENT WITH THE ARROWS THAT CALL IT — see `chunkOptionPicks`
   in features/lighting-planner/lightingRules.js. */
import { COVE_GAP_FT } from './lib/cove.js';
import { useDrag } from './hooks/useDrag.js';
import { useEscapeHatch, useEscapeClaim } from './hooks/useEscapeHatch.js';
import { useUndoKeys } from './hooks/useUndoKeys.js';
import usePanelDrag from './hooks/usePanelDrag.js';
/* THE NATIVE TOOLTIPS, OFF IN THE VERTICAL COLUMN. One sweep rather than a flag
   threaded through twenty components — see the hook's header. */
import useNoTooltips from './hooks/useNoTooltips.js';
import useExitHold from './hooks/useExitHold.js';
import { isFormControl } from './lib/escapeHatch.js';
import useViewPrefs from './hooks/useViewPrefs.js';
import useScale from './hooks/useScale.js';
import useDimensionIntelligence from './features/dimension-intelligence/useDimensionIntelligence.js';
import usePlanSource from './hooks/usePlanSource.js';
import useOutlines from './hooks/useOutlines.js';
import usePlanScene from './features/scene/usePlanScene.js';
import { useSceneArchitecture, useSceneOutlines } from './features/scene/useSceneSource.js';
import { useScenePlanProjections } from './features/scene/useScenePlanProjections.js';
import { useSceneSuggestProjections } from './features/scene/useSceneFixtureProjections.js';
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
import BusyModal from './components/BusyModal.jsx';
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
/* THE SAME PLACE AT THE FOOT OF THE DRAWING, ABOUT THE NEXT MODULE. One bar
   stands there at a time — see the note where this one is rendered. */
import ModuleSpec from './components/ModuleSpec.jsx';
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
import { MODULE_SOON, MODULE_BY_ID, moduleWatts,
         moduleWattList } from './lib/magTrack.js';
import OptionCoach from './components/OptionCoach.jsx';
/* The walkthrough, playing in the panel rather than linked out of it. Named
   export: the default one is the line of type that opens it in a dialog. */
import { HowToVideo } from './components/HowToLink.jsx';
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
import { addablePoints, countryFor } from './lib/switchboards.js';
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
import { CEILING_BY_ID, sweepMm, wattsOf, typeOnWall } from './lib/ceilingObjects.js';
import { projectElecPointsPx, pointHostFor, POINT_IDS, WALL_POINT_ID,
         WALL_POINT_HEIGHT_MM, POINT_AMPS, heightOfPoint, isConstrained }
  from './lib/elecPoints.js';
import { isWallUnit, isSeated, feedOf, AC_FEED, acRatings, acAmpsFor }
  from './lib/wallUnit.js';
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
import Popover, { PopoverButton } from './components/Popover.jsx';
import StageBar, { SceneSwitch } from './components/StageBar.jsx';
import FanSpec from './components/FanSpec.jsx';
import PointSpec from './components/PointSpec.jsx';
import AcSpec from './components/AcSpec.jsx';
import useAcFeed from './features/fixtures/useAcFeed.js';
/* --- WHERE THE LIGHT LANDS, AND IT IS ONE IMPORT ------------------------
   FOUR NAMES OFF ONE FEATURE INDEX: the hook that computes the field, the
   overlay that draws it inside the drawing's own <svg>, the key, and the
   capsule that switches it. Everything else about it — the distribution
   profile per fixture family, the grid, the photometry, the reflection engine,
   the colour scale and the caching — is behind src/features/heatmap/ and is
   not reachable from here, which is the whole arrangement. */
import { useHeatmap, HeatmapOverlay, HeatmapLegend,
         HeatmapSwitch } from './features/heatmap/index.js';
import SpaceDetail from './components/SpaceDetail.jsx';
/* THE SELECTED FITTING'S TWO CONTROLS, IN THE HEAD OF THE VERTICAL COLUMN.
   Everywhere else the analysis is reached through SpaceDetail, which is why App
   had none of it; this is the one place that specifies a fitting without the
   panel around it. See `selectedFixtureRow`. */
import { FixtureSpec, wattsChangeable } from './components/SpaceAnalysis.jsx';
import WallTonePopup from './components/WallTonePopup.jsx';
import { DEFAULT_CEILING_MM, CEILING_MM_MIN, CEILING_MM_MAX,
         materialsOf, wallMix, wallMixLabel } from './lib/materials.js';
/* THE ILLUMINANCE MODEL, THE FAMILY TABLE AND THE FAMILY DEFAULTS are read in
   features/lighting-planner/, which is the only thing that counts what is on a
   ceiling or asks what that makes of a room. */
import {
  BTN, BTN_FULL, BTN_PRIMARY, BTN_EXIT, BTN_SECOND, BTN_MID, BTN_TINY,
  BTN_NUDGE, BTN_BOQ, N, NW, NE, NOTE, NOTE_WARN, CODE, PILL,
  PILL_OK, PILL_BAD, PILL_VIEW, PILL_RETRY, KV, KV_HEAD, KV_ADMIN, N_ADMIN,
  BTNROW, SEC, SEC_ADMIN, H3, H3_FLUSH, H3_ADMIN, DISCLOSE_ADMIN, CHECK, TABS,
  STEP, PROP_OFF, PROP_ON, MENU_ITEM, MENU_NOTE,
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
         LAYER_DEFAULTS, clampZoom }
  from './lib/planState.js';
import { usePlanDoc } from './hooks/usePlanDoc.js';


// WHAT THE SAVE PILL SAYS. Four words, and 'idle' says nothing at all — a bar
// that permanently reads "Saved" on a plan nobody has touched is noise, and it
// is also a claim about a write that never happened.
const SAVE_LABEL = { idle: '', dirty: 'Unsaved…', saving: 'Saving…', saved: 'Saved', error: 'Not saved' };

/* THE SHARE MENU HAS TWO KINDS OF ACT, so it gets two marks and no more:
   people for a live project grant, download for every file handed back. Keeping
   the three formats on one glyph lets the words carry the format distinction. */
function PeopleMenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" className="mt-px flex-none text-text">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function DownloadMenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" className="mt-px flex-none text-text">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5M12 15V3" />
    </svg>
  );
}

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

/* --- THE FOOTER'S SWITCHES ARE THE BAR'S SWITCH -----------------------------
   `FooterSwitch` WAS A SECOND SWITCH AND A BROKEN ONE. It drew a white track in
   both states and moved a black knob along it, so on and off were told apart by
   the knob's position and by nothing else — a 46px track with a 14px knob in
   it, on a black bar, at the far end of the screen from the thing it controls.
   Nobody could see whether the heatmap was on.
   SO THERE IS ONE SWITCH IN THIS APP AND IT KNOWS WHICH GROUND IT IS ON. See
   `SceneSwitch` and `TONE` in StageBar: the track carries the state and the
   knob is the ground's colour, which is the design the contextual bar over the
   drawing has always used. `tone="dark"` is the same control said on black. */
const FooterSwitch = (props) => <SceneSwitch {...props} tone="dark" />;

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
  /* THE WAY OUT OF THE EDITOR, AND IT IS THE DASHBOARD NOW. `onBack` went to
     the PROJECT this plan sits in, as a worded link in the top-left; the top bar
     is a row of marks either side of the plan's name, and a house is what
     everything else in this app uses for "all the way out". The project page is
     one press further on from there.
     IT FALLS BACK TO `onBack` where a caller supplies only that — the tests and
     the standalone editor — so neither loses its exit. */
  onHome = null,
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
  const { ceilingMm, materials, fixtureWatts, fixtureOff,
          manualCoves, manualTracks, manualCobs, manualSpots, cobArrays, trackFixtures,
          autoSpots,
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
    selCobId, selCobIds, selPointIds, selArrayId, selArrayIds, selModuleId, selLightId,
    cobOpen, setCobOpen, cobMode, setCobMode,
    cobStanding, setCobStanding, cobLock,
    /* THE ADJUSTABLE SPOT BETWEEN ITS TWO CLICKS — see `spotAim`. Read here
       because the gesture is App's router (`onZonePointerDown` and its move
       partner) and the drawing of it is a canvas prop. */
    spotAim, setSpotAim,
    arrayDrag, trackMode, setTrackMode, moduleDrag, lightDrag,
    /* WHICH RUN WAS PRESSED, AND WHAT THE NEXT MODULE WILL BE. The first is
       what opens the module drawer beside the rail and the second is what the
       bar at the foot of the drawing shows; see `trackAdd` and `moduleSpec` in
       the fitting session for why neither is derivable from the selection. */
    trackAdd, setTrackAdd, moduleSpec, setModuleSpec,
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

     ONE FLAT LIST KEYED BY `on` rather than a list per track, for the
     reason `manualCobs` is flat: every reader wants "the modules on this run",
     which is a filter — `pointsOn` in lib/point.js — and a map of arrays is a
     second structure to keep in step with a store of shapes that can be deleted
     from anywhere.

     AND `on` IS NOT A LOCAL NAME. A module clipped to a run is a POINT HELD ON
     A PATH: the run is the path (lib/path.js) and the module is the constrained
     point (lib/point.js), so the field is the primitive's and every reader of
     it — the projection, the drag, the delete, the schedule — asks the
     primitive rather than knowing anything about tracks.

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
  const { setShapeEditId, setShapeTool,
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

     THE PRIMARY HEIGHT ONLY, which is a rule about the LIST and not about any
     board in particular today. The wall facing a bed used to be the case that
     needed it — one board of two plates at two heights — and it is now two
     boards of one plate each, so each override is simply that plate's height.
     The rule stands because the count is derived from the list (see
     FACING_PLATES): writing a single number over a multi-height list would
     silently turn a two-plate board into a one-plate board, which is a change to
     what gets ORDERED made by editing a dimension. */

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
    roomIntelReset.current.spotEditing();
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
    /* THE SCALE THE LAST DRAWING STATED ABOUT ITSELF. A latched reading is the
       one thing on this list that would be actively dangerous to carry over: it
       is a number, it is plausible, and applied to a different plan it puts the
       whole building at the wrong size while still looking exactly like a plan.
       Clearing it also puts `scaleMode` back to 'door' — see STATED_SET. */
    docActions.setStated(null);
  }, [docActions, initialProjectType, geomState.reset, fixtureReset,
      resetLightingRun]);

  // --- the plan source ------------------------------------------------------
  const {
    img, setImg, dxf, setDxf,
    pdfPage, pdfPick, setPdfPick, pdfRun, planText, textKind,
    invertedSrc, loadFile, openPdfPage, source, isVector,
  } = usePlanSource({ doc, docActions, initialPdfPage, resetForNewPlan, setBusy });

  /* --- DOES THE DRAWING ALREADY SAY HOW BIG IT IS? -------------------------
     BEFORE `useScale`, BECAUSE IT IS AN INPUT TO IT. A plan dimensioned by the
     person who drew it has answered the door step's question already — a chain
     of figures along a wall, or a room labelled `18'-0" X 12'-0"` — and reading
     it is both faster and more accurate than measuring a detected door leaf.
     See features/dimension-intelligence, and the note there about why the
     answer is latched into the document rather than recomputed.
     IT NEEDS NOTHING THAT NEEDS A SCALE. The outlines it compares against are
     projected with `fromDu`, which is the identity on a raster — so this sits
     above every other hook on the screen without an ordering problem. */
  const dimensions = useDimensionIntelligence({
    doc, docActions, source, planText, textKind, isVector,
    /* SO IT CAN TELL "NOT STARTED" FROM "NOT STARTING". A reopened plan never
       re-runs its detectors, so an 'idle' room state on one is final. */
    restoredPlan: !!restore });

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
    /* ONLY ONCE THE DRAWING HAS BEEN GIVEN ITS CHANCE TO ANSWER. 'reading' means
       the room detector is still out and a stated room size may yet settle the
       scale; 'read' means it already has. In both cases spending a door call now
       would be paying for a ruler we are about to have, or already hold. Only
       'none' — nothing found, and nothing more coming — falls through to it. */
    deferDoors: dimensions.status !== 'none',
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

  /* --- WHICH OF THE THREE PANELS IN THE CHROME IS OPEN ---------------------
     THE PANEL BECAME BARS, AND A BAR HAS NO ROOM FOR A LIST. Share's three file
     formats, the View section's layer checkboxes and the whole Admin
     block were sections in a 340px scroller; they are now buttons in the top and
     bottom bars that open over the drawing. See Popover.

     LOCAL AND NOT IN THE DOCUMENT, all three. Which menu somebody has open is a
     fact about the next half second, not about the plan — it must not be saved,
     must not be undoable, and must not survive a reload. `useViewPrefs` above is
     for the ones that are the opposite of all three.

     ONE FLAG EACH RATHER THAN ONE `openMenu`, because they are in different
     corners and do not exclude one another the way the rail's flyouts do: the
     View panel and the Share panel cannot both be pressed without a press
     landing outside one of them, and that press closes it. */
  const [shareMenu, setShareMenu] = useState(false);
  const [viewMenu, setViewMenu] = useState(false);
  const [adminMenu, setAdminMenu] = useState(false);
  /* ADMIN-ONLY AND SESSION-ONLY. This is a different arrangement of the same
     editor, not plan data; opening the plan elsewhere must not inherit an
     operator's narrow workspace. */
  const [verticalMode, setVerticalMode] = useState(false);
  const normalZoom = useRef(null);
  const shareRef = useRef(null);
  const viewRef = useRef(null);
  const adminRef = useRef(null);

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
    architecture: { obstaclesPx, wallHosts },
    furnishings: { bedsPerRoom, detectedZones, wardrobesPx, basinsPx, shelfStrips },
    lightingGeometry: { reverseCoves, drawnZones },
  } = usePlanScene({
    source, pxPerFt, outlines, outlinesPx, litOutlines, enclosedZones, focusId, ceilingObjs,
    accentResults, detections, dismissed, wallResults, useBoundingRect, doors, runTrims,
    manualCoves, runsOff, zones, opt, chunkPicks, roomTypes, projectId, designPicks, ceilingKinds,
    ceilingShapes, lightMoves, manualTracks, isAdmin,
    /* THE ENGINE'S OWN SWITCH — `autoLights` is not a layer to this hook, it is
       whether the gridding engine places anything at all. See AUTO_GRID in
       lib/layout.js; the tick that flips it is Auto-placed lights in the View
       menu, and it is off by default — see LAYER_DEFAULTS. */
    autoLights: layers.autoLights,
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
          /* `materialsEdit` IS GONE FROM THIS GROUP. It gated a FOLD over the
             finishes — a summary line you pressed to open, which replaced the
             analysis while it was open — and the floating window shows the
             finishes and the readout at once, so there is nothing to be open.
             See the note where it used to be declared, in useWallMaterials. */
        } = roomIntel.panel;
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
    /* --- THE PLATES BELONG TO THE WIRING, AND THEY GO OFF WITH IT ----------
       `switchboards` AND `electrical` WERE TWO INDEPENDENT SWITCHES, and the
       combination that made them wrong is the ordinary one: the wiring off,
       the plates on, which is what every plan opened with. A lighting sheet
       came up carrying nine blue rectangles on its walls with nothing running
       off them — half of a drawing the reader had not asked for, and unnamed,
       because the loops that say what a plate IS were the half that was off.
       SO THE WIRING IS ONE LAYER WITH TWO KINDS OF MARK IN IT. `switchboards`
       still stands on its own INSIDE the scene — plates without loops is a
       legitimate thing to want to look at once you are looking at wiring — it
       simply cannot outlive the scene it is part of.
       DERIVED AND NOT SET, as everything else in this memo is: the View
       switch's own tick and the saved plan are untouched, so turning the
       wiring back on brings the plates back exactly as they were left.
       EXCEPT WHILE THE STEP THAT PLACES THEM IS RUNNING. The switchboard tool
       seats plates on walls with the layer in whatever state it was in, and a
       step whose whole output is invisible is a step that looks broken. It is
       the same exception the cove step's `region` is: the gesture turns on the
       thing the gesture is about, for as long as it lasts. */
    const wiring = base.electrical || boardPlace
      ? base : { ...base, switchboards: false };
    const aiming = stepTool?.id === 'cove' ? { ...wiring, region: true } : wiring;
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
  }, [layers, doorEdit, stepTool, wallEdit, boardPlace]);

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
    opt, accentResults, accentDismissed, manualAccents, reverseCoves, shelfStrips, ceilingShapes,
    manualSpots,
  });

  /* THE SUGGESTED GRID, WHICH THE CANVAS DRAWS AND THE SNAP ENGINE AIMS AT.
     BELOW THE SPOTS BECAUSE IT READS THEM, and above `snapTargets`, which is
     its second consumer. Both halves of the layer come out of this one list —
     see the hook. */
  const { projections: { suggestPointsPx } } = useSceneSuggestProjections({
    rooms, taskSpotsPx, pxPerFt, layers: canvasLayers,
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
    materials, fixtureWatts, fixtureOff, ceilingMmFor,
    selCobId, selArrayId, selModuleId, selAccId, selSpotId, selLightId, selShapeId,
    /* AND THE CEILING OBJECTS, because a chandelier is one. It is the only
       fitting on this drawing whose selection lives in the OBJECT register —
       alongside the fans and the cassettes, which are not fittings — and until
       it was handed in, pressing a pendant opened no row and there was no
       gesture that reached its wattage. See `highlightRows`. */
    selObjIds,
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
  /* --- AN AIR-CONDITIONER'S SUPPLY, AND THE ONE PLACE THAT KEEPS IT IN STEP --
     ABOVE THE COMMANDS AND THE GESTURES BECAUSE BOTH SPEND IT. Placing a split
     unit places its socket or its point, sliding one brings that with it, and
     DELETING one takes it off the drawing — five paths through two stores, held
     together in one hook so the fifth is not the one somebody forgets. See
     features/fixtures/useAcFeed.js. */
  /* `countryFor` DIRECTLY AND NOT `sbCountry`, WHICH IS A TEMPORAL DEAD ZONE
     HERE. That name is destructured off the electrical feature eight hundred
     lines below this, and naming it now would be the exact "cannot access
     before initialization" the note at the head of useBoardRules describes. The
     resolver is pure and the lookup is a table read, so the second call costs
     nothing and both answers are the same object. */
  const acCountry = useMemo(() => countryFor(country), [country]);
  const acFeed = useAcFeed({
    ceilingObjs, elecPoints: doc.elecPoints, manualBoards: doc.manualBoards,
    boardKinds: doc.boardKinds, wallHosts, pxPerFt, country: acCountry, docActions,
  });

  const fixtureCommands = useFixtureCommands({
    state: fixtureState, fixtures, docActions, rooms, pxPerFt, readOnly,
    manualCobs, cobArrays, trackFixtures,
    arrayOutline, spaceAnalysis, setSel, setOptionPick, acFeed,
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
          setShape: setArrayShape, remove: deleteArray,
          removeSelected: deleteArrays } = fixtureCommands.arrays;
  const { setSpec: setTrackModuleSpec, isRow: isModuleRow,
          remove: deleteModule, allocateOnTrack } = fixtureCommands.modules;
  /* `remove` IS NOT TAKEN OFF HERE — the by-id delete is the panel's own cross,
     and this file only ever deleted what was PICKED. See `removeSelected`. */
  const { setSpec: setCobSpec, removeSelected: deleteCobs } = fixtureCommands.cob;
  /* AND THE POINTS' ONE, for the same reason the object's two are aliased here:
     the keydown effect names it in its dependency array. */
  const { removeSelected: deletePoints } = fixtureCommands.points;
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
  /* `lightWholePlan` WENT WITH THE LIST'S "TAKE UP ALL N OUTLINES" BUTTON, and
     the decision it made belongs on the step that owns it: the tracer's own
     Proceed (`runPipeline`) is how a plan's outlines are taken up, on the screen
     where you can see which ones they are. It is still on `lighting.commands`
     for whoever wants it back. */
  /* `run` IS NOT TAKEN OFF HERE ANY MORE, AND NOTHING IN THIS FILE CALLS IT.
     The whole pipeline — beds, classify, accent zones, task surfaces, behind a
     checklist — had exactly ONE caller: the tracer's own button, which now calls
     `confirmOutlines` instead. It is still on `lighting.commands` and still
     works; what it no longer has is a way in, because placing fittings is the
     user's job and an automatic layout is not offered. The loader it drives, its
     Stop, and the `!prep` guards all stay live for it: `prep` simply stays null
     while nothing runs it. Give it a button and the whole path comes back. */
  const { lightOneRoom, stop: stopPipeline, confirmOutlines,
          setRowWatts, setRowOff, cycleChunkOption } = lighting.commands;
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
  /* --- `view` NAMES A SCENE NOW, AND ONLY TWO OF ITS VALUES MEAN ANYTHING ---
     IT USED TO NAME A TAB — Spaces, Design, Boards, BOQ, Admin — and the strip
     is gone (see the note where it was). What survives is the half that was
     real: two of those five REPLACE the drawing on the stage, and the other
     three were views of a panel that is now driven by what is selected.
     SO THE TEST IS ALWAYS AGAINST A SHEET AND NEVER FOR THE PLAN. 'boq' and
     'boards' are the two sheets; every other value — 'spaces', which is still
     the stored default, 'design', and a stale 'admin' out of somebody's saved
     state — means the drawing. That is why nothing anywhere asks `view ===
     'design'`, and why the half-dozen `setView('spaces')` calls scattered
     through the features still read correctly: they mean "get off the sheet".
     Gated on `source` as well, so a stale `view` cannot survive a Clear and
     render a schedule of a plan that is no longer loaded. */
  const boqOpen = view === 'boq' && !!source;
  /* SHARE BELONGS TO THE DRAWING, NOT ITS SCHEDULE. Closing the latch as the
     BOQ opens matters as much as hiding the button: otherwise leaving the BOQ
     could resurrect a menu that had been open on the previous sheet. */
  useEffect(() => {
    if (boqOpen) setShareMenu(false);
  }, [boqOpen]);
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
  /* --- WHICH OF THE TWO DRAWINGS IS ON THE STAGE --------------------------
     THE ELECTRICAL LAYER IS A SCENE AND NOT A LAYER, which is what the two
     scene buttons on the bar over the drawing now say out loud. It was a switch
     at the foot of the panel labelled "Show electrical layout", ticked on top of
     a lighting drawing — but nothing in the lighting panel means anything while
     you are looking at wiring, and nothing in the wiring panel means anything
     while you are not. So the floating window swaps with it: a space's lumens
     and its fittings on one, that space's plates on the other.
     `!doorEdit` BECAUSE THE DOOR STEP IS THE WAY IN. The first press of the
     scene button asks about the doors — a switchboard is placed beside one — and
     while that question is open the wiring is not yet being shown. The same test
     the old switch's own latch used. */
  const elecScene = layers.electrical && !doorEdit;
  /* WHICH TAB THE PANEL IS ON, WITH ONE FALLBACK. `view` is what somebody
     clicked; this is what can actually be rendered. Admin is scoped to role 1,
     and a role can go away underneath a stale tab — a session that loses it, or
     an operator's own plan opened from the ordinary route — so an admin `view`
     without `isAdmin` reads as Design rather than as an empty column. Nothing
     resets `view` for it: the tab comes back if the role does. */
  /* `panelView` WENT WITH THE TAB STRIP. It was "which tab can actually be
     rendered", with one fallback for an `admin` view held by somebody who is no
     longer an admin — and there are no tabs: the floating window is driven by
     what is selected on the drawing, and the two views that took the whole stage
     (`boqOpen`, `boardsOpen`) are read straight off `view` above.
     A RESTORED `view` OF 'admin' IS THEREFORE HARMLESS, which is what the
     fallback existed to guarantee: it names no scene, so neither sheet opens and
     the drawing is what shows. */
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

  /**
   * WHAT ONE FITTING OF A FAMILY IS RATED AT AND WHAT IT PUTS OUT, where it is
   * standing. `{ watts, lumens }`, or null for a family the model has never
   * heard of.
   *
   * THE CARD UNDER THE POINTER AND THE PANEL BESIDE THE DRAWING MUST NOT
   * DISAGREE, which is the whole reason this is a lookup rather than two
   * constants. A room's wattage is a CHOICE — the Analysis panel offers the
   * family's chips and `fixtureWatts` stores what was picked — and the lumens
   * per watt is a fact about the COUNTRY (75 in India against 100 abroad, see
   * `lumensPerWattFor`). A card printing 525 lm over a room somebody has set to
   * 12 W, or over a project in Dubai, would be the drawing contradicting the
   * reading two inches to its right.
   *
   * SO IT IS `wattsFor` AND `unitOutput`, WHICH ARE THE TWO FUNCTIONS
   * `analyseSpace` RESOLVES ITS OWN ROWS WITH. Not a re-derivation of them: the
   * same calls in the same order, so the figure on the card is the figure in the
   * panel by construction rather than by coincidence — and the family's loss and
   * its own lumens-per-watt come along for free, which is what makes this
   * correct for a family whose numbers are not a plain multiplication.
   *
   * HERE AND NOT IN THE CANVAS, because the answer needs `fixtureWatts`, the
   * project's country and the hit test that says which space a point is in, and
   * all three of those are App's — the doors, the accents and the ceiling
   * objects all ask `roomAt`. What the canvas gets is one function.
   *
   * THE ROOM COMES OFF THE THING WHERE IT KNOWS IT AND OFF ITS POSITION WHERE IT
   * DOES NOT. An accent zone was placed by a rule that ran on one room and
   * carries its `roomId`; a ceiling object stores none and belongs to whichever
   * space it is standing in, which is the same rule `layoutRooms` uses to decide
   * whose obstacle it is and `planFlows` uses to decide whose circuit it is on.
   * A fitting in no room falls back to the family's own default rather than to
   * nothing, because it is still a 7 W lamp — it is simply on no schedule.
   *
   * DIRECTLY BELOW `roomAt` FOR THE REASON THE COB'S MODEL IS: it needs it.
   */
  const fittingOutput = useCallback((familyId, at) => {
    const family = FAMILY_BY_ID[familyId];
    if (!family) return null;
    const r = at?.roomId
      ? rooms.find((q) => q.id === at.roomId)
      : (Number.isFinite(at?.x) && Number.isFinite(at?.y) ? roomAt(at) : null);
    /* --- THE FITTING'S OWN FIGURE FIRST, WHERE IT HAS ONE -------------------
       A DECORATIVE FITTING IS SPECIFIED ON ITSELF and not on the room. A
       chandelier, a pendant and a standing lamp each carry `watts` beside their
       diameter — see `wattsOf` in lib/ceilingObjects.js — and they are ONE
       family, so the room-level lookup below answers the same figure for all
       three of them. Left to it, a pendant set to 12 W hovered as 7, which is
       this card contradicting the Analysis panel about the fitting they are
       both pointed at.
       `wattsOf` ANSWERS NULL FOR EVERYTHING ELSE, including the accent zone a
       sconce hands in, so this is a branch a lamp takes and nothing else does. */
    const own = wattsOf(at);
    const watts = own ?? wattsFor(familyId, (r && fixtureWatts[r.id]) || {}, familyId);
    return { watts, lumens: unitOutput(family, watts, lumensPerWattFor(country)) };
  }, [rooms, roomAt, fixtureWatts, country]);

  /* THE CIRCLE A RECESSED COB'S BEAM CUTS ON THE FLOOR. The heatmap draws the
     full photometric field, but its dotted beam annotation still has to state
     the fixture's optic at the room's real mounting height. Catalogue beam and
     recorded ceiling height meet here because App is the one place that owns
     both; PlanCanvas only draws the diameter it is handed. */
  const beamDiameterFtFor = useCallback((roomId, fixtureId) => {
    const beam = FIXTURE_BY_ID[fixtureId]?.beam;
    if (!(beam > 0)) return null;
    const dropFt = (ceilingMmFor(roomId) / 304.8) || DEFAULT_DROP_FT;
    return throwDiameterFt(beam, dropFt);
  }, [ceilingMmFor]);

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
    /* THE SAME LIST THE CANVAS DRAWS AND THE GEOMETRY TOOL AIMS AT. The COB
       tool keeps its own narrow target set on purpose — see `cobAlignTargets` —
       so it takes this explicitly rather than reaching `snapTargets`. */
    suggestPoints: suggestPointsPx,
  });
  /* THE NAMES THIS FILE ALREADY USED. All six are read by the markup — the
     lamps and their throw rings on the canvas, and the bar at the foot of the
     stage — which is App's. `cobDirty` was a seventh and went with the two
     buttons it drew: there is no half-made change to be dirty about now that a
     control on the bar writes straight through. */
  const manualCobsPx = cobTool.cobsPx;
  const cobRoom = cobTool.room;
  const cobShow = cobTool.show;
  const cobInForce = cobTool.inForce;
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
   * AT THE WALL'S ACTUAL ANGLE. The seat keeps the edge's unit direction and
   * inward normal; `manualReverseCove` turns those into an oriented four-corner
   * band. No page-axis test belongs here: the outline is the authority, so an
   * angled outline edge produces an angled slot.
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
    /* THE COB BAR, THE SPECIFICATION STANDING ON IT AND THE ARRAY BEING SET UP
       — the fitting session's half, called where the block stood. `cobStanding`
       goes with the tool: the engine's recommendation is per CELL, so an
       override carried into the next arming would discard an answer nobody had
       heard. See `reset.cobGesture`. */
    fixtureReset.cobGesture();
    /* AND THE SPOT BETWEEN ITS TWO CLICKS — see `spotAim`. A body placed and
       not yet aimed is half a gesture, and putting the tool down is the answer
       "not that one" rather than "leave it pointing at wherever the pointer
       happened to be". */
    fixtureReset.spotGesture();
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


  /* --- STANDING EVERY MACHINE DOWN: ONE FUNCTION, AND IT WAS FIVE ----------
     ONE POINTER PIPELINE, ONE OWNER. Every step and every tool on this screen
     has to put the other six away on the way in, and the block that did it was
     COPIED BY HAND into all five openers in variants that differed only by
     which terms each one remembered — `openDoorEdit` cleared the selection and
     `openBoardPlace` did not, `geometryStandDown` forgot the wall step, and no
     two of them agreed about the track editor.

     That is the disease pressOwner.js was written to cure on the READ side —
     see the note at the head of that file, which is about the very same five
     call sites. This is the cure on the WRITE side, and it is also what the
     Escape key means: see src/lib/escapeHatch.js.

     `except` IS THE ONE ARGUMENT AND IT EXISTS FOR `openShapeTool`. That opener
     stands the others down AFTER raising its own bar (it is in the geometry
     feature and the order is its own), so a plain stand-down would close the
     tool it had just opened. Every other caller runs this FIRST and then opens,
     which needs no exemption — React batches the pair and the opener wins.

     --- WHY THE BODY IS ASSIGNED AND NOT DECLARED ---------------------------
     It has to be callable from `openShapeTool`, which is built by
     `useGeometryCommands` two dozen lines below this — and it has to CALL
     `closeShapeTool`, which is one of that hook's results. A `useCallback` here
     could not name it. So the handle is declared here, stable and safe to hand
     out, and the body is written once every command exists. Same
     ref-during-render pattern OutlineTracer's `draftRef` uses. */
  const standDownRef = useRef(null);
  const standDown = useCallback((except) => standDownRef.current?.(except), []);
  /* THE GEOMETRY FEATURE'S VIEW OF IT — stable, so the hook below is not handed
     a fresh function every render. */
  const geometryStandDown = useCallback(() => standDown('shape'), [standDown]);

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
    /* AND A COMMITTED GUIDE GOES TO WHATEVER ASKED FOR ONE, which today is the
       spot array: its gesture raises this bar in the guide role and the tick
       has to finish the array's first question. The command declines a guide
       drawn for any other reason — see `takeArrayGeometry`. Handed in for
       `allocateOnTrack`'s reason: the consequence is another domain's. */
    onGuideDrawn: fixtureCommands.arrays.takeGeometry,
  });
  const {
    abandonShape, closeShapeTool, clearShapeEdit, openShapeTool,
    /* NO `duplicateShape`. It is still a geometry command — see the note in
       ShapeMenu where its key was — and nothing on this screen calls it. */
    commitShape, pickShapeTool, deleteShape,
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
    standDown();
    setDoorEdit(true);
  }, [standDown]);

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
  /* EVERY LAMP A HAND PUT ON A CEILING, AS ONE LIST FOR THE WIRING.
     THE SAME PAIR THE CANVAS DRAWS, and that is the point of assembling it
     here: `manualCobs` on PlanCanvas is `manualCobsPx` and `arrayCobsPx`
     together for the reason given at that prop — on the ceiling they are the
     same fitting — and a fitting the sheet draws and the sheet does not switch
     is the fault this list exists to close.
     WITHOUT THE DRAFT, which is the one member of that trio left out. A draft
     array is what the bar is still asking about; it appears and disappears as
     the count is typed, and giving it flows would put a switch module on a
     plate for each keystroke. It joins this list when the tick keeps it, at
     which point it is in `cobArrays` like any other. */
  const lampsPx = useMemo(() => [...manualCobsPx, ...arrayCobsPx],
    [manualCobsPx, arrayCobsPx]);

  /* --- THE WALL POINTS, IN PLAN PIXELS ------------------------------------
     THE STORE HOLDS FEET and every consumer of a POSITION takes this list — see
     the note on `manualCobs`, which is the same store shape and the same trap:
     a reader handed the raw list reads `undefined` for `x`, computes NaN and
     draws nothing at all, with no throw and no warning. */
  /* --- THE POINTS, RESOLVED -----------------------------------------------
     THE ONE WAY TO GET A POSITION OUT OF EITHER KIND. A wall point's record is a
     FRACTION of its room's perimeter and a ceiling point's is feet — see
     lib/elecPoints.js — so a reader handed the store gets `undefined` for one of
     them and a silent NaN downstream. Everything that draws, wires or hit-tests
     a point takes this list.
     THE HOSTS ARE BUILT HERE BECAUSE THE ROOMS ARE HERE. `wallRuns` walks an
     outline, so it is done once per room per render rather than once per point,
     and `elecPoints.js` is handed the index rather than being taught what a room
     is. A wall point whose room has gone resolves to null and drops out, which
     is what lib/point.js's third gate needs: a point that cannot be placed
     cannot be pressed. */
  const elecPointsPx = useMemo(() => {
    const hosts = new Map();
    const hostOf = (q) => {
      if (!hosts.has(q.roomId)) {
        hosts.set(q.roomId, pointHostFor(
          rooms.find((r) => r.id === q.roomId)?.plan?.polygonPx ?? [], pxPerFt));
      }
      return hosts.get(q.roomId);
    };
    return projectElecPointsPx(doc.elecPoints, hostOf, pxPerFt);
  }, [doc.elecPoints, pxPerFt, rooms]);

  /* --- WHERE THE LIGHT ACTUALLY LANDS -------------------------------------
     THE ESTIMATED ILLUMINANCE HEATMAP. Everything about it is
     features/heatmap/ — the distribution profile per fixture family, the grid,
     the photometry, the reflection engine, the colour scale and the caching —
     and what is here is one call plus, further down, three elements. It costs
     nothing while the switch is off; see the first line of the hook's memo.

     IT STANDS HERE AND BOTH BOUNDS ARE LOAD-BEARING. It is lit by
     `spaceAnalysis`, so it cannot stand above the call that makes that; and it
     needs the lamps in PLAN PIXELS, so it cannot stand above `manualCobsPx`.
     A `useMemo` evaluates its dependency array on every render, so a reader
     above its own `const` is a temporal dead zone and a blank screen.

     --- AND IT WAS HANDED `manualCobs` FIRST, WHICH WAS A REAL BUG ----------
     THE STORE IS IN FEET AND EVERY PROJECTION IS IN PIXELS. A `manualCobs`
     entry carries `xFt`/`yFt` and no `x`/`y` at all — see `projectManualCobsPx`,
     which is what puts them on — so the adapter read `undefined`, placed the
     lamp at NaN, and every hand-placed COB contributed exactly nothing to the
     field. Silently: a NaN source throws nothing and draws nothing, so a spot
     somebody put down simply did not appear, which is how it was reported.
     THE ADAPTER REFUSES A SOURCE WITHOUT A POSITION NOW rather than trusting
     its caller, and tools/test-heatmap.mjs asserts that a feet-only fitting
     produces no emitter. The lists below are the same ones the CANVAS draws,
     which is the rule for every projection in this file. */
  const heatmap = useHeatmap({
    on: canvasLayers.heatmap,
    rooms, pxPerFt, projectId, roomTypes, materials, ceilingMmFor,
    spaceAnalysis, focusId,
    accentZonesPx, taskSpotsPx,
    manualCobsPx, arrayCobsPx, magTracksPx, trackModulesPx,
  });

  const electrical = useElectrical({
    rooms, pxPerFt, obstaclesPx, wardrobesPx, basinsPx, accentZonesPx, taskSpotsPx, lampsPx,
    elecPointsPx,
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
             document's `doorsOk`; confirming it remains part of the door and
             switchboard workflow even though the floating layer toggle is gone. */
          doorsOk } = electrical.panel;
  const { groups: boardSheet } = electrical.sheet;
  const { pickFlow, reorderBoardUnit, setBoardOutlet, setBoardAmps, setBoardHeight,
          addBoardPoint, removeBoardPoint, deleteBoard, placeBoardAt,
          openBoardPlace: enterBoardPlace, clearPlacedBoards,
          /* HANDED STRAIGHT TO THE FIXTURE GESTURES, which is the one command on
             that list another domain spends. Placing a standing lamp can oblige
             a socket to appear on the wall behind it — see `socketForLamp` — and
             the lamp is placed by the fixtures feature. */
          socketForLamp,
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
  /* THE ZONE STEP'S OPENER, AND NOTHING CALLS IT ANY MORE. The No-Light Zone
     tool is retired — see the note at the top of ToolRail — so there is no
     control that arms this, and the step, its gates and the drawn zones a saved
     plan already carries are all untouched: putting the tool back is putting one
     cell in the Electrical flyout and pointing it here.
     KEPT RATHER THAN DELETED because the way OUT of the step (`closeZoneEdit`)
     and every `!zoneEdit` gate around the app are still live, and half a machine
     is worse than a whole one nobody is currently pressing. */
  // eslint-disable-next-line no-unused-vars
  const openZoneEdit = useCallback(() => {
    standDown();
    setZoneEdit(true); setZoneMode(true);
  }, [standDown]);

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
    standDown();
    enterWallEdit(roomId);
    docActions.setFocusId(roomId);
  }, [standDown, docActions, enterWallEdit]);

  /* --- PUTTING SWITCHBOARDS ON WALLS BY HAND --------------------------------
     THE STEP IS features/electrical/useBoardStep.js. WHAT IS LEFT HERE IS THE
     HALF THAT IS APP'S, exactly as it is for the wall step above: standing
     every other step and tool down on the way in. One pointer pipeline, one
     owner — and App is the only place that knows every owner, which is why this
     is not in the feature. The order is the order it always was: the step
     opens, and then everything else goes away. */
  const openBoardPlace = useCallback(() => {
    standDown();
    enterBoardPlace();
  }, [standDown, enterBoardPlace]);

  /* --- THE STAND-DOWN ITSELF ------------------------------------------------
     THE BODY OF THE HANDLE DECLARED ABOVE, written here because this is the
     first line at which every command it calls exists. See that declaration for
     why it is split; what follows is THE LIST, and the list is the interesting
     part — App is the only place that knows every machine on this screen.

     ASSIGNED DURING RENDER rather than in an effect, so a press landing on the
     very first paint finds a body rather than a no-op.

     IT IS EVERY TRANSIENT THING AND NOTHING THE DOCUMENT OWNS. The fittings,
     the rooms and the geometry are the drawing and are untouched; what goes is
     which drawer is open, what is armed, what is selected and which step has
     the panel. The test of a line belonging here is simple: would a page reload
     have cleared it?

     `focusId` IS NOT IN THE LIST, AND IT WAS. It is the one judgement call here
     and it has been made the other way round: it is not a command — it is which
     space the panel is describing — so it survived every early draft, went in on
     the reading that the brief was "back to how it would be if refreshed", and a
     reload has no space in the panel.

     THAT READING WAS TOO WIDE. Escape's job is to get you out of what you
     STARTED; a panel you are reading is not something you started, and closing
     it was a second consequence of a press aimed at the first. In practice that
     is the expensive half: arm a tool, change your mind, press Escape, and the
     analysis you were working against goes with the tool — so the next act is
     always finding the room in the list again.

     THE PANEL STILL HAS A WAY OUT, which is what makes this safe rather than a
     trap: clicking bare plan clears the focus (see the stage's click handler,
     `setFocusId(hit ? hit.id : null)`), and so does picking a different space in
     the list. What has gone is Escape as a THIRD way, and it was the only one of
     the three nobody was asking for.

     ONE THING RIDES WITH IT. Delete acts on the focused room — it unlights it,
     see the keydown handler — and Escape used to make that press safe by
     dropping the focus. It no longer does, so a focused room stays deletable
     after an Escape. That is the same exposure as any other moment the panel is
     open, which is the state this now preserves. */
  standDownRef.current = (except) => {
    setSel(clear());
    setZoneEdit(false); setZoneMode(false); setDraftZone(null);
    setDoorEdit(false); setDoorDraft(null); setDoorDrag(null);
    closeWallEdit();
    closeTrackEdit();
    if (except !== 'board') closeBoardPlace();
    /* THE ONE EXEMPTION, AND IT IS `openShapeTool`'S. See the handle's note:
       that opener raises its bar and THEN stands the others down, so closing
       the tool here would undo the press that got us here. */
    if (except !== 'shape') { closeShapeTool(); clearShapeEdit(); }
    setArmed(null); setGhost(null); setGuides([]);
    setCobOpen(false); setCobMode(null);
    setTrackMode(null);
    setObjMode(false);
    setOptionPick(null); setTip(null); hideCoach();
    // LAST, because it is the biggest of them: the add tool, the half-made
    // gesture under it, the module armed on a run and the track pen's path.
    disarmAdd();
  };


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

     SO OPENING ONE IS ALSO AN ACT OF CLOSING — and it is `standDown`, the same
     one every other opener on this screen calls. This was the SIXTH hand-copied
     variant of that block; it differed from the other five by not clearing the
     selection, which was not a decision but an accident of `openArray` selecting
     the array BEFORE standing the rest down. That order is now the other way
     round, like every other opener's, and the copy is gone. */




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

  /* --- THE SAME THREE WRITES, FOR THE DOOR STEP ON THE OUTLINE SCREEN -----
     THE STEP MOVED TO THE FRONT OF THE FLOW — see `idScreen` in OutlineTracer
     for why — and the tracer draws on Konva rather than on the SVG canvas, so
     it cannot borrow App's pointer pipeline the way the design screen's editor
     does. What it borrows instead is the WRITES, which is the half that has to
     agree: a box added here is the same shape doors.js produces, in the same
     list the scale, the board pass and the schedule all read.

     `addDoorBox` HANDS BACK THE ID so the tracer can select what it just drew;
     the design screen does the same thing through `setSel`, which is its own
     selection service and means nothing on the other screen. */
  const addDoorBox = useCallback((rect) => {
    const made = {
      id: `door-hand-${Date.now().toString(36)}`,
      cls: 'door', conf: 1, rect, openingPx: openingPx(rect), placed: true,
    };
    docActions.addDoor(made);
    return made.id;
  }, [docActions]);

  const moveDoorBox = useCallback((id, rect) => {
    docActions.moveDoor(id, { rect, openingPx: openingPx(rect) });
  }, [docActions]);

  /* `confirmDoorsOnTracer` WAS HERE, AND THE STEP IT ANSWERED HAS MOVED.
     It set `doorsOk` from the tracer, for a "check the doors" step that stood at
     the front of the flow. That question is about SWITCHBOARDS and is now asked
     by the wiring itself, the first time the electrical layer goes on — see the
     door effect above, which runs the detector and opens the editor there.
     Nothing sets `doorsOk` on this screen any more, which is why the tracer is
     handed `onConfirmDoors={null}`. */

  /* HAS THE WIRING ALREADY PUT THE DOOR QUESTION UP THIS TIME ROUND?
     WITHOUT IT THE STEP IS A TRAP. Closing the editor without answering leaves
     `doorsOk` false and the electrical layer on, which is exactly the state the
     effect below opens on — so it would reopen on the same render, for ever,
     and the only way out of the door step would be through it. The gate is
     offered ONCE per time the wiring is switched on; back out and the wiring
     shows with its own unanswered-doors gate, which is a state the panel
     already knows how to draw, and "Modify doors" is still there. */
  const doorAsked = useRef(false);

  /* --- THE DOORS, ASKED FOR AT THE MOMENT SOMETHING NEEDS THEM -------------
     A SWITCHBOARD IS PLACED BESIDE A DOOR, and for a long time that was the
     second reason to run the door detector — the first being the scale, which
     it answered on upload for every raster plan. A drawing that dimensions
     itself has taken the first reason away (see features/dimension-intelligence
     and `deferDoors` above), and the second one is not a question about the
     drawing at all: it is a question about the WIRING, which most plans never
     reach. So it is asked here, once, the first time somebody turns the
     electricals on — and a plan that is only ever lit never spends the call.

     THE SEQUENCE IS DETECT, THEN CONFIRM, THEN WIRING, and each step is one
     render of this effect rather than a chain of callbacks: bumping the nonce
     puts the detector into 'running', coming back puts it into 'done', and the
     editor opens on the boxes it found. `elecScene` is already gated on
     `!doorEdit`, so the wiring stays behind the question while it is open and
     appears the moment `confirmDoors` answers it.

     NOT WHILE THE EDITOR IS OPEN, and not once somebody has said the boxes are
     right: `doorsOk` is exactly that decision, and a plan that answered this on
     the tracer — the fallback route, where the doors were found for the ruler —
     arrives here already confirmed and never sees it twice. */
  useEffect(() => {
    /* SWITCHING THE WIRING OFF ARMS THE QUESTION AGAIN, and this branch is the
       only thing that does. See `doorAsked` for what would happen without it. */
    if (!layers.electrical) { doorAsked.current = false; return; }
    if (doorsOk || doorEdit || doorAsked.current) return;
    /* THE DETECTOR'S OWN GATES, RESTATED. Asking for a run this effect's twin
       will refuse spends the nonce on nothing and leaves the step waiting for a
       status change that is never coming — see useDoorRecognition, which checks
       the same five things and returns. */
    if (!source || isVector || readOnly || !projectId || !img?.el) return;
    if (doorState.status === 'running') return;
    if (doorState.status === 'idle') { recognitionCommands.rerunDoors(); return; }
    // 'done' or 'error' — either way there is nothing more coming, and an empty
    // set is a perfectly good thing to show somebody: the step's own answer is
    // "there are no doors", and it draws the boxes they can add by hand.
    doorAsked.current = true;
    openDoorEdit();
  }, [layers.electrical, doorsOk, doorEdit, source, img, isVector, readOnly, projectId,
      doorState.status, recognitionCommands, openDoorEdit]);

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
    /* THE SUGGESTED GRID'S CENTRES — the same list the canvas draws, so the
       pen, the primitive marquee and a dragged fitting all catch a proposed
       centre here exactly as they catch a wall. Already empty when the layer is
       off, so there is no second condition: a gate restated at the point of use
       is a gate that can disagree with the one that decides what is drawn. */
    lights: suggestPointsPx,
    exclude: excludeId,
  }), [rooms, obstaclesPx, geometry.canvas.coveShapes, suggestPointsPx]);

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
    /* A PRESS ON A RUN OPENS ITS MODULE DRAWER, and the drawer is the fitting
       session's — see `trackAdd`. Handed over raw because the gesture already
       answers the only question there is: it calls this with the id when the
       shape pressed is a track and with null for anything else, so pressing a
       cove closes the drawer without this line having to know that. */
    onTrackPress: setTrackAdd,
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
    rooms, pxPerFt, zoom, svgPoint, svgRef, pressState, roomAt,
    accentZonesPx, taskSpotsPx, manualAccents, manualCoves, manualSurfaces,
    /* THE HAND-PLACED SPOTS' STORE AND THE SNAP, both for the one gesture the
       spot has that a derived one does not: it can be picked up and carried.
       The store because a patch is written in FEET and the projection cannot be
       patched; `snapTargets`, `snapTol` and `setGuides` because a dragged
       fitting aligns against the same collector the ceiling objects, the lights
       and the geometry use — see useTaskSpots.
       `spotAiming` IS THE ONE THING THAT WITHHOLDS THE DRAG. Between the two
       clicks that place a spot the pointer is already turning a fitting that
       does not exist yet, and a second gesture reading the same moves would
       carry one spot while aiming another. */
    manualSpots, addTool, zoneMode, spotAiming: !!spotAim,
    setSel, setArmed, setGuides, snapTargets, snapTol, deleteShape, docActions,
  });
  /* BOTH RESET GROUPS, MERGED INTO THE ONE REF `resetForNewPlan` READS. It is
     assigned here rather than at the first call site because this is the first
     line at which both exist. */
  roomIntelReset.current = { ...roomIntel.reset, ...roomEditing.reset };
  const { accentDrag: accDrag, onAccPointerDown: accPointerDown,
          accPointerMove, accPointerUp,
          spotDrag, onSpotPointerDown: spotPointerDown,
          spotPointerMove, spotPointerUp } = roomEditing.canvas;
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
    manualCobs, cobArrays, trackFixtures, ceilingObjs, elecPoints: doc.elecPoints,
    svgPoint, svgRef, pressState,
    roomAt, insideAnyRoom, snapTargets, snapTol,
    arrayOutline, shapeAtPointer, geomUnder, geomHover, setGeomHover,
    clearShapeEdit, standDown,
    socketForLamp, acFeed, wallHosts,
    docActions, setSel, guides, setGuides, setOverRoom, setAddAt, setOptionPick,
  });
  /* THE NAMES THIS FILE ALREADY USED. The canvas props, the pointer router's
     three branches and the keydown handler's guards all read them, and every one
     of those bindings is App's. */
  const { onLightPointerDown: lightPointerDown, onObjPointerDown: objPointerDown,
          onCobPointerDown: cobPointerDown, onArrayPathDown: arrayGrab,
          onModulePointerDown: modulePointerDown } = fixtureGestures.canvas;
  const fixtureDrag = fixtureGestures.drag;

  /* --- THE ESCAPE HATCH ------------------------------------------------------
     ONE KEY, ONE MEANING, EVERYWHERE: get me out of whatever I started. Somebody
     presses a rail cell to place a fitting, thinks better of it before the
     click, and presses Escape — and that has to work whether the tool they
     armed was written last year or this morning.

     THE WHOLE RULE IS `standDown` UNLESS SOMETHING CLAIMED THE KEY, and it
     replaces two hundred lines of branch chain that used to live in the handler
     below. The chain had to be re-read and re-ordered every time a tool was
     added, and it was wrong in two ways nobody could see by reading it: a press
     with a tool armed AND a spot selected did both (the `addTool` branch had no
     `return`), and half the selections backed out at one rung while the other
     half backed out at another. A single stand-down cannot have either bug.

     See src/lib/escapeHatch.js for the mechanism and for why the browser never
     sees this key. What is here is the THREE FLOWS THAT REFUSE TO EXIT.

     --- 1. THE PEN, EITHER OF THEM ------------------------------------------
     A half-drawn path is work. Escape throws the PATH away and keeps the tool,
     because the alternative — one press that drops the path and puts the pen
     down — means somebody who wanted to redraw one leg has to go back to the
     rail for the tool as well. With nothing drawn it does nothing at all: you
     leave the pen by pressing its cell again, not by pressing Escape. */
  const penInHand = addTool === 'track'
    || (geometry.status.menuOn && geometry.status.tool === 'pen');
  useEscapeClaim(penInHand, () => {
    if (!trackPen.isEmpty) trackPen.reset();
    else abandonShape();
  }, 'pen');

  /* --- 2. CLIPPING A LIGHT ONTO A TRACK -------------------------------------
     TWO PRESSES, TWO SIZES OF EXIT, because arming a module is TWO decisions
     stacked and not one: "I am filling this run" and "with a 12 W spot". One
     press that undid both would charge somebody who changed their mind about
     the WATTAGE the drawer, the run they had pressed and the trip back to the
     rail — and one press that undid NEITHER, which is what this claim used to
     be, left the key dead in the one flow people hold longest.

       FIRST PRESS   the light type goes, the command stays. The drawer is still
                     open beside the rail with no cell latched, so the next kind
                     is one press away.
       SECOND PRESS  nothing is armed, so this claim is no longer standing and
                     the key falls through to `standDown` — the whole command,
                     the same exit as everywhere else.

     THE CLAIM IS ITS OWN LADDER AND NEEDS NO COUNTER. What registers it is
     `trackMode` and what the handler clears is `trackMode`, so the release runs
     on the very next render and the second press finds an empty stack. A
     press-count beside it would be a second piece of state saying what the
     first already says, and one more thing to reset.

     THE RUNG BETWEEN THEM IS A STATE THAT ALREADY EXISTED. `moduleDown` gates
     on `!trackMode` and places nothing; `moduleBarOn` reads `moduleSpec`, so
     the specification bar comes off with the arming rather than lingering over
     a module nobody is holding; and the plus over a run is deliberate there
     whether or not a module is armed — see the cursor's own note. Nothing new
     is being invented for the middle press to land in. */
  const placingTrackLight = addTool === 'module' && !!trackMode;
  useEscapeClaim(placingTrackLight, () => fixtureReset.module(), 'track-module');

  /* --- 3. TRACING THE SPACE OUTLINES ---------------------------------------
     Claimed by OutlineTracer itself, because the draft it throws away is that
     component's own state. Same hook, and it is the reason the hook exists
     rather than a list of flags here: a flow declares its own exemption, next to
     the state the exemption is about. */

  useEscapeHatch(standDown);

  /* A `title` PAINTS A BOX THE BROWSER SIZES TO ITS OWN TEXT, over whatever the
     pointer is resting on — which in a 380px reading column is the drawing. Off
     while the column is up, and put back on the way out. */
  useNoTooltips(verticalMode);

  /* AND THE ONE CARD THIS APP DRAWS ITSELF GOES WITH THEM. `onFixture` is
     withheld in the column so no new tip is raised; this clears one that was
     already up at the moment the switch was pressed. */
  useEffect(() => { if (verticalMode) setTip(null); }, [verticalMode]);

  /* --- UNDO IS ITS OWN LISTENER NOW, AND THAT IS THE FIX --------------------
     IT USED TO BE TWO BRANCHES OF THE HANDLER BELOW, and it broke twice from
     living there: once behind a focus guard that stood the whole handler down
     for any focused `<input>` — and the redesign put spec fields ON the drawing
     — and once, with that fixed, to a `stopPropagation` between the pressed
     element and `window`, because bubble-phase-last is the weakest position in
     the DOM. Both times the press fell through to Safari, where ⌘Z is Undo
     Close Tab: the editor reopened a browser tab instead of taking back an edit.

     Undo is about the DOCUMENT, not about what is selected, so sharing a
     listener with forty branches that are all about a selection was the error.
     It is bound like Escape now — capture, once, ungated. See
     src/lib/undoKeys.js for which press means what.

     READ-ONLY GATES THE ACT AND NOT THE BINDING: a viewer's ⌘Z does nothing,
     rather than reaching Safari. */
  useUndoKeys({
    enabled: !readOnly,
    undo: () => undoRef.current?.undo(),
    redo: () => undoRef.current?.redo(),
  });

  /** Delete removes. Escape is the hatch above it, and undo the one above that. */
  useEffect(() => {
    // NO SELECTION GUARD ON THE BINDING. This used to bind only while something
    // was selected or armed. Every branch below already checks its own
    // condition, so the guard bought nothing and cost a listener that went
    // missing whenever the state binding it was a render behind. The read-only
    // guard at the foot is the one that decides whether to listen at all.
    const onKey = (e) => {
      /* A FOCUSED CONTROL OWNS ITS OWN KEYS — ALL OF THEM, and that is why this
         is one line where it used to be two with an exemption carved through
         them. Every branch below is an unmodified key acting on a selection:
         Delete on a fitting, Enter to finish a run, `f` to fit. None of them may
         fire while somebody is typing a name or nudging a wattage spinner.
         UNDO WAS THE ONE BRANCH THAT HAD TO ANSWER WITH A FIELD FOCUSED, and it
         is not here any more — it is bound in capture above, where neither this
         guard nor anything else can reach it. See src/hooks/useUndoKeys.js. */
      if (isFormControl(e.target)) return;
      /* THE TWO MODAL STEPS SWALLOW DELETE, AND THAT IS ALL THEY DO HERE NOW.
         Each one's panel holds a single question, and Delete while it is open
         cannot be allowed to mean "take the space I had selected before I got
         here out of the layout" — which is exactly what the branch at the foot
         of this handler would do with the same keypress. Neither has a selection
         of its own for the key to act on: a zone is removed from its own row in
         the panel, and a wall from the tone popup.
         THEIR ESCAPE IS THE HATCH'S. Both used to answer it here, ahead of
         everything, so that closing a step could not also drop a selection —
         which is a problem a single stand-down does not have. */
      if (zoneEdit) return;
      if (wallEdit) return;
      /* --- THE POINT EDITOR ANSWERS DELETE FIRST, AND IT RETURNS ------------
         The same argument the two steps above make: while a path is open the
         canvas is about that path, and Delete has to mean "this corner" rather
         than "the space I had selected before I opened it", which is what the
         branch at the foot of this handler would do with the same keypress.
         ITS ESCAPE IS THE HATCH'S, like everything else's. */
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
      }
      /* --- THE TRACK PEN'S TWO REMAINING KEYS -------------------------------
         ENTER FINISHES, which is what Enter does at the end of a path in every
         drawing tool there is. BACKSPACE TAKES THE LAST POINT BACK, which is why
         a mis-clicked corner is not a reason to start again. Escape used to be
         the third; the pen CLAIMS it now — see the hatch above — and throwing
         the path away while keeping the tool is what that claim does.

         `addTool` AND NOT `stepTool`, because the keys are about the pen rather
         than about the panel: the step is what `stepTool` describes, and it
         happens to be open whenever this tool is armed. */
      if (addTool === 'track') {
        if (e.key === 'Enter') { e.preventDefault(); finishTrack(); return; }
        if (e.key === 'Backspace' && !trackPen.isEmpty) {
          e.preventDefault(); trackPen.undo(); return;
        }
      }
      /* THE COVE PEN ANSWERS THE SAME TWO, and it is the same pen — see usePen.
         Enter is the one that is different and it is the L-shaped cove: a path
         that lands on a wall at both ends can be finished OPEN, where clicking
         the first point closes it into a pocket. Two endings, two details.
         BACKSPACE TAKES THE LAST POINT BACK. Escape is the pen's claim on the
         hatch above, exactly as the track pen's is. */
      if (geometry.status.menuOn && geometry.status.tool === 'pen' && !covePen.isEmpty) {
        if (e.key === 'Enter' && geometry.panel.canFinishOpen) {
          e.preventDefault(); finishOpenCove(); return;
        }
        if (e.key === 'Backspace') { e.preventDefault(); covePen.undo(); return; }
      }
      if (doorEdit) {
        if ((e.key === 'Delete' || e.key === 'Backspace') && selDoorId && !doorDrag) {
          e.preventDefault();
          deleteDoor(selDoorId);
          return;
        }
        // Ctrl+Z is handled above this and stays handled: it is about the
        // document rather than about whatever is selected.
        return;
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
      /* A SELECTED POINT, AND THE WHOLE SELECTION WITH IT. Delete is one of the
         ten verbs lib/point.js says an element on the primitive inherits, and
         `removeElecPoints` is the store side of it — the ids straight, so a
         ⌘-click gathering three and a Delete taking one cannot happen.
         AHEAD OF THE CEILING OBJECT, on the most-specific-first ordering the
         note by the room branch describes: a point is a smaller and more
         specific thing than the object it may be standing beside. */
      if ((e.key === 'Delete' || e.key === 'Backspace') && selPointIds.length
          && !fixtureDrag.point) {
        e.preventDefault();
        deletePoints();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selModuleId && !moduleDrag) {
        e.preventDefault();
        deleteModule(selModuleId);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selArrayId && !arrayDrag) {
        e.preventDefault();
        /* THE WHOLE SELECTION, because ⌘-click can gather several now and a
           Delete that took only the primary would leave the rest behind. With
           one picked this is that one. */
        deleteArrays();
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
        deleteCobs();   // the whole gathered selection — see the array branch
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
  }, [readOnly, docActions,
      // the two modal steps, which swallow the key and nothing more
      zoneEdit, wallEdit,
      // the track point editor and the two pens
      geometry.tracks.editId, geometry.tracks.selPt, geometry.tracks.grip,
      deleteTrackPoint, deleteTrack, addTool, finishTrack, trackPen,
      geometry.status.menuOn, geometry.status.tool, covePen,
      geometry.panel.canFinishOpen, finishOpenCove,
      // the door editor
      doorEdit, selDoorId, doorDrag, deleteDoor,
      // one branch per kind of thing Delete can be about, in the order they read
      selLightId, lightDrag, resetLightMove,
      /* THE POINTS, AND THEY WERE THE NAMES THIS ARRAY FORGOT. See the note
         below it: a dependency missing here is a stale closure, and this was
         exactly the key that quietly did last render's thing. `selPointIds` is
         the one shared empty array while nothing is held — see `idsOf` — so
         nothing else in this list changes when a point is selected, the
         listener was never re-bound, and Delete read an empty selection and
         fell through to the SPACE branch at the foot.
         ALL THREE NAMES ARE STABLE ONES, deliberately. The branch used to read
         `fixtureGestures.point`, and that object is rebuilt every render — so
         naming it here would re-bind the window listener on every frame and NOT
         naming it is the stale closure above. The drag is read off
         `fixtureDrag`, the way the COB's already was, and the delete is a
         memoised command beside every other kind's. See `deletePoints`. */
      selPointIds, fixtureDrag.point, deletePoints,
      selModuleId, moduleDrag, deleteModule,
      selArrayId, arrayDrag, deleteArrays,
      selShapeId, geometry.shapes.dragging, deleteShape,
      selSpotId, deleteSpot,
      selCobId, fixtureDrag.cob, deleteCobs,
      selAccId, accDrag, deleteAccent,
      selBoardId, deleteBoard,
      selFlowId, flowDrag,
      selObjIds, objDrag, deleteObjects,
      // and the space, which is last and is guarded on the two armed machines
      focusId, armed, boardPlace]);
  /* TWENTY-EIGHT NAMES CAME OUT OF THIS ARRAY when Escape left the handler, and
     every one of them was a chance to be wrong: a dependency this list forgot
     was a stale closure, and a stale closure here is a key that quietly does
     last render's thing. The hatch has no array at all — see useEscapeHatch. */

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

  /* --- `pickSpace` WAS HOW A SPACE WAS PICKED OUT OF THE PANEL'S LIST -----
     THE LIST IS GONE, so this is too. It did four things — move the focus, put
     the right ceiling options up, clear the finishes flag, and raise the
     geometry bar — and every one of them still happens on the OTHER route,
     which is a click on the room itself on the drawing. See `onCanvasClick`,
     which was always the more used of the two and is now the only one.
     THE TWO WERE NEVER ONE FUNCTION, which is worth recording as the reason
     this could be deleted rather than rewired: they were parallel
     implementations of the same act, and keeping them in step was a standing
     cost — the note that used to be here described a bug where the list's route
     raised no geometry bar and the drawing's did. */


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

  /* --- WHICH BOX IS THE SCROLLER, AND THERE ARE TWO OF THEM NOW -------------
     THE STAGE IS THE SCROLLER ON THE OPEN CANVAS and it is the wrong box in
     vertical mode: there the stage is the whole window and the drawing lives in
     a 380px column that does its own clipping, so the stage has no overflow to
     give and every pan wrote to a container already at its end stops. See the
     note on the viewport in the markup.
     ONE ACCESSOR AND NOT A SECOND PAIR OF HANDLERS. Three places write a scroll
     offset — the pan, the wheel-zoom's anchor and the button that zooms from the
     middle of the view — and all three mean "the box the drawing is read in".
     Asking once is what keeps them from disagreeing. */
  /* IN STATE AND NOT ONLY IN A REF, because it is MEASURED as well as scrolled:
     `useStageRect` reads its box on mount and cannot know a ref filled in after
     it ran, so a bar keyed on one would sometimes never appear. The memo is what
     keeps the ref-shaped object stable per element — a fresh one every render
     would re-attach that hook's three listeners every render. */
  const [canvasBox, setCanvasBox] = useState(null);
  const canvasBoxRef = useMemo(() => ({ current: canvasBox }), [canvasBox]);
  /* --- THE VIEW OPENS ON THE SHEET, NOT ON THE ROOM AROUND IT --------------
     `--lp-canvas-room` PUTS THE SHEET IN THE MIDDLE OF A BOX BIGGER THAN THE
     VIEWPORT, and a scroll container opens at its origin — which is now the
     top-left corner of the slack, with the drawing off to the bottom-right. So
     the offsets are set once, where the content is centred. It is two lines
     rather than an alignment property for the reason `safe center` exists: a
     centred overflow puts half of itself off the start edge, where scrolling
     cannot reach it. */
  const centreScroll = (el) => {
    if (!el) return;
    el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
    el.scrollTop = Math.max(0, (el.scrollHeight - el.clientHeight) / 2);
  };
  /* ONE SHOT, AND IT IS THE ZOOM'S OWN LAYOUT PASS THAT SPENDS IT. Fitting the
     sheet changes its size, and the box can only be centred once that size has
     landed — the same two-halves problem the wheel anchor below solves, so it is
     handed to the same effect. */
  const centreWanted = useRef(false);
  const scrollBox = useCallback(() => (
    (verticalMode ? canvasBox : null) ?? stageRef.current
  ), [verticalMode, canvasBox]);

  /* --- AND THE SAME BOX IS WHAT EVERY CONTEXTUAL BAR MEASURES OFF ----------
     THE BARS STAND AT THE FOOT OF THE DRAWING, and in the column the drawing is
     the band rather than the window: measured off the stage they pinned
     themselves 26px above the analysis card's bottom edge, which is under it.
     One name so the four call sites cannot drift — the downlight's bar, a
     selected array's, the module's and the fan's — and so the shape bar, which
     found this first, is saying the same thing as the rest. */
  const barBox = verticalMode ? canvasBoxRef : stageRef;
  /* --- AND WHICH END OF IT THEY STAND AT ----------------------------------
     THE FOOT OF THE DRAWING IS THE POSITION EVERY EDITOR HAS TRAINED PEOPLE TO
     LOOK AT, and the 9:16 column is the one place it is the wrong one: the foot
     of the band is where the analysis card begins, so a bar there is the last
     thing before a wall of readings. The head of the column is the slot the
     light window already uses — ONE place where something appears about what you
     just did, whether that is a fitting you clicked or a gesture you armed.
     Both are handed the same box and the same 12px clearance, so they land on
     the same line to the pixel; only one is ever up. */
  const barPlace = verticalMode ? 'top' : 'bottom';

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
    /* THE FIT'S SECOND HALF COMES FIRST. It is not an anchored zoom — there is
       no point under a cursor to hold still, the whole view is being placed —
       and it happens on the one pass where both could be pending. */
    if (centreWanted.current) {
      centreWanted.current = false;
      zoomAnchor.current = null;
      centreScroll(scrollBox());
      return;
    }
    const a = zoomAnchor.current;
    if (!a) return;
    zoomAnchor.current = null;
    const svg = svgRef.current, el = scrollBox();
    if (!svg || !el) return;
    const r = svg.getBoundingClientRect();
    el.scrollLeft += (r.left + a.px * r.width) - a.clientX;
    el.scrollTop += (r.top + a.py * r.height) - a.clientY;
  }, [zoom, scrollBox]);

  /* --- THE SHEET IS SIZED TO THE BAND, AND THE BAND IS MEASURED ------------
     IT WAS `min(356 / w, 268 / h)`, WHICH IS THE BAND AT ONE WINDOW HEIGHT.
     380 minus a gutter is a fair guess at the column's width because the column
     is fixed; 268 is not a guess at anything — the band is whatever the window
     leaves between the fixture rail and the analysis card, so on a tall screen
     the drawing sat in the middle of it with a hundred pixels of the page's own
     black above and below, and on a short one it was bigger than the band and
     clipped. The box is right there and can say how big it is.
     A LAYOUT EFFECT AND NOT A `requestAnimationFrame`, which is the same
     argument the zoom anchor above makes: this reads a box whose size depends
     on classes React has only just committed, and a frame callback races that
     commit rather than following it. A measurement taken one frame early is
     zero, and a zoom fitted to zero is the drawing at ZOOM_MIN.
     AND IT IS DECLARED AFTER THE ANCHOR ABOVE, WHICH IS LOAD-BEARING. React
     runs layout effects in source order: written first, this one set the zoom
     and raised `centreWanted` in the same commit the anchor then consumed —
     centring the box against the size the sheet had a moment ago, which the
     browser promptly clamped when the sheet was re-laid out. Second, the flag
     survives to the pass the new size lands on.
     ONCE PER ENTRY, which is what the latch is for. It is the sheet's STARTING
     size, not a rule about it — re-running on every resize would take the zoom
     out of somebody's hands the moment they touched the window. */
  const fittedVertical = useRef(false);
  useLayoutEffect(() => {
    if (!verticalMode) { fittedVertical.current = false; return; }
    if (fittedVertical.current) return;
    const el = canvasBox;
    if (!el || !source?.w || !source?.h) return;
    /* NO AIR, AND THAT IS DELIBERATE. A gutter here is a strip of the band's
       ground showing on the limiting axis, which on the inverted plan is the
       page's black — the very thing the band's padding was fixed to remove. The
       sheet fills the band and the panels are its margins. */
    const w = el.clientWidth, h = el.clientHeight;
    if (!(w > 0) || !(h > 0)) return;
    fittedVertical.current = true;
    /* CLAMPED HERE AS WELL AS IN THE REDUCER, so the comparison below is
       against the figure that will actually be stored. Without it a fit outside
       the zoom range would look like a change, no re-render would follow, and
       the pass that centres the view would never run. */
    const z = clampZoom(Math.min(w / source.w, h / source.h));
    if (z === zoom) { centreScroll(el); return; }
    centreWanted.current = true;
    docActions.setZoom(z);
  }, [verticalMode, canvasBox, source, docActions, zoom]);

  /* --- ...AND IT STARTS THE WAIT AT THE TOP OF IT -------------------------
     `overflow-hidden` STOPS THE WHEEL BUT DOES NOT REWIND THE BOX. A hidden
     overflow container keeps whatever `scrollTop` it had — the property is
     still writable, it is only the gesture that is taken away — so a run
     started after somebody had scrolled down to look at a far corner of their
     plan would clip the loader off the top of the visible area and show a black
     rectangle with nothing in it.
     A LAYOUT EFFECT, so it lands in the same frame the overflow changes in. As
     an ordinary effect the browser paints once with the old offset, which is
     the wait appearing half off screen and snapping into place. */
  useLayoutEffect(() => {
    if (!prep) return;
    const el = stageRef.current;
    if (!el) return;
    /* IT RE-RUNS AS THE RUN PROGRESSES — `prep` carries the phase, the detail
       and the two counts, so it is a fresh object on every tick — and that is
       harmless rather than merely tolerable: the offset is READ before it is
       written, so a run that is already at the top costs nothing, and anything
       that did manage to move the box mid-run gets put back. Depending on
       `!!prep` instead would trade that for a dependency the linter cannot
       check against the body. */
    if (el.scrollTop) el.scrollTop = 0;
    if (el.scrollLeft) el.scrollLeft = 0;
  }, [prep]);

  /** The middle of the stage, in screen coordinates — the button's stand-in
   *  for a pointer. */
  const stageCentre = useCallback(() => {
    /* THE VIEWPORT'S MIDDLE AND NOT THE WINDOW'S. In vertical mode the stage
       carries the rail's and the analysis card's clearance as padding, so its
       own centre is some way below the middle of the band the drawing is
       actually read in — and this figure is a stand-in for a pointer. */
    const el = scrollBox();
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, [scrollBox]);

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
      if (isFormControl(e.target)) return;
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
    const el = scrollBox();
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
      const el = scrollBox(), f = panFrom.current;
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
  }, [panning, scrollBox]);


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

      /* --- THE ADJUSTABLE SPOT: PLACE IT, THEN POINT IT ------------------
         IT WAS A DRAG AND IT IS TWO CLICKS, and the old gesture is worth
         recording because it was reasonable and stopped being so. You dragged
         a BOX round the thing to be lit; that box became a task surface, and
         the placer then stood a spot on the ambient grid nearby, aimed back at
         it. The whole of that rested on there BEING an ambient grid to stand
         on — and the engine's placement is off by default now (see
         LAYER_DEFAULTS), so the gesture was asking the layout a question the
         layout had stopped answering.

         SO THE HAND SAYS BOTH THINGS. First click: the body goes exactly where
         it landed, which is `placeCob`'s rule for a recessed lamp and for its
         reason — somebody who has aimed at a point has said everything there
         is to say about where the fitting goes. Every move after that turns
         it. Second click: the angle is locked and the fitting is written.

         THE TASK-SURFACE PLACER IS UNTOUCHED. It still runs, it still places a
         spot for every surface the detector finds and every picture on a wall,
         and those still answer to the grid — see `projectTaskSpotsPx`. What
         changed is the one gesture that was pretending to be manual.

         FEET AND NOT PIXELS, like every other hand-placed fitting: a plan
         reopened after its scale is corrected has its spots where they were set
         out. See `manualSpots`. */
      if (addTool === 'spot') {
        e.preventDefault();
        if (!spotAim) {
          setSpotAim({ xFt: p.x / pxPerFt, yFt: p.y / pxPerFt,
                       roomId: room.id, aim: 0, aimFt: 0 });
          return;
        }
        /* THE SECOND CLICK IS THE COMMIT, and it takes the angle off the state
           rather than recomputing it from this event: the arrow on screen is
           what was agreed to, and a press that re-derives from its own
           coordinates would place the fitting at whatever the pointer had
           moved to between the last frame and the button going down. */
        docActions.addSpot({
          id: `mspot-${Date.now().toString(36)}`,
          roomId: spotAim.roomId,
          xFt: spotAim.xFt, yFt: spotAim.yFt, aim: spotAim.aim,
          /* AND HOW FAR OUT IT IS AIMED, which is the second click's DISTANCE
             and not just its direction. A record holding only the angle cannot
             say where the beam lands, and the projection had to invent a reach
             for it. See the note at the move above and `HAND_AIM_FT`. */
          aimFt: spotAim.aimFt,
        });
        /* THE TOOL STAYS ARMED, like the COB's. Spots come in threes over a
           worktop, and a tool that disarms after one costs a trip to the rail
           between each. Escape puts it down. */
        setSpotAim(null);
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
    /* --- THE ADJUSTABLE SPOT BEING POINTED ------------------------------
       A GESTURE IN FLIGHT WITH NO BUTTON HELD DOWN, which is the one thing
       that makes this branch unlike every drag above it. The body is already
       placed; what the pointer is doing now is choosing a DIRECTION, and it
       does that with the button up between two clicks. So it sits with the
       drags rather than below them — it owns the move for as long as it lasts —
       and it is tested on the state rather than on a captured pointer.
       IT TURNS AND DOES NOT MOVE. `xFt`/`yFt` are settled; only `aim` is
       written, which is what the second click will store. */
    if (spotAim && pxPerFt) {
      const p = svgPoint(e);
      /* THE POINTER SAYS TWO THINGS AND BOTH ARE KEPT: which way the fitting is
         turned, and HOW FAR IN FRONT OF IT THE BEAM LANDS. The distance used to
         be thrown away and a fixed six feet used in its place — see
         `HAND_AIM_FT` — so a spot aimed at a table four feet off was drawn and
         modelled throwing at a point six feet off, past the thing it was for.
         Aiming AT something and having the light land somewhere else is the one
         mistake this gesture must not make: the second click is a point on the
         floor, so the point on the floor is what is recorded. */
      setSpotAim((d) => (d ? { ...d,
        aim: Math.atan2(p.y / pxPerFt - d.yFt, p.x / pxPerFt - d.xFt),
        aimFt: Math.hypot(p.x / pxPerFt - d.xFt, p.y / pxPerFt - d.yFt) } : d));
      return;
    }
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
    /* A POINT BEING CARRIED — same rule. A wall one is being slid along its
       plaster and a ceiling one across the slab, and the primitive knows which
       without this branch being told. */
    if (fixtureDrag.point) { fixtureGestures.move.point(e); return; }
    if (accDrag) { accPointerMove(e); return; }
    /* A DIRECTIONAL SPOT BEING CARRIED — same rule, and it is the branch that
       makes the spot STEP survive the gesture: the tool stays armed after a
       spot is placed, so this sits above the armed-tool branches below exactly
       as the lamp's and the accent's do. A gesture that has the pointer owns it
       until it is released, whatever else is in hand. */
    if (spotDrag) { spotPointerMove(e); return; }
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
      /* THE PLAIN CURSOR POSITION IS THE TRUTH for a tool that places at a
         point. The spot's rubber band was tracked on the line below this one
         and is gone with the box gesture it belonged to — a spot mid-aim is
         turned by the branch at the top of `onZoneMove`, which owns the move
         outright and never reaches here. */
      setAddAt(raw);
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
    if (fixtureDrag.point) { fixtureGestures.up.point(); return; }
    if (accDrag) { accPointerUp(); return; }
    if (spotDrag) { spotPointerUp(); return; }
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
    /* --- THE SPOT'S BOX WAS RELEASED HERE, AND THERE IS NO BOX ANY MORE ---
       The gesture dragged a rectangle round the thing to be lit, wrote it into
       `manualSurfaces` as a task area, and let the placer stand a spot on the
       ambient grid nearby aimed back at it. All of that rested on there BEING
       an ambient grid, and the engine's placement is off by default now — so
       the one gesture that called itself manual was the one asking the layout
       a question it had stopped answering. It is two clicks on the ceiling
       instead: see the `addTool === 'spot'` branch on the press.
       THE SURFACES ALREADY DRAWN ARE UNTOUCHED, and so is the DETECTOR that
       finds most of them. `manualSurfaces` is still read, still projected and
       still placed against — what went is the only thing that wrote to it by
       hand. `projectTaskSpotsPx` is unchanged in that half. */
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

  /* --- WHAT A PLOTTED SHEET IS MADE OF, ASSEMBLED ONCE ---------------------
     TWO CALL SITES ISSUE THE SAME PDF — the editor's Share menu and the
     viewer's panel — and the note at the second one already says why they must
     not differ: "one implementation, so an operator's PDF and an owner's cannot
     come out differently". They were nonetheless two hand-written argument
     lists, which is the same hand-maintained pair this file warns about
     everywhere else, and the drift was real: three whole populations were
     missing from both, and adding them to one would have left the other behind.
     So the arguments are one object and the call sites pass it.

     EVERY LIST IS A `*Px` PROJECTION, never a document store. The stores hold
     FEET (`manualCobs` has `xFt`/`yFt` and no `x` at all) and the plotter works
     in plan pixels, so handing it a store gives it `undefined` coordinates —
     which is not an error anywhere, just a fitting that silently fails to
     appear. See `projected lists, not stores` in the note on `lampsPx`.

     `lampsPx` IS THE PAIR THE CANVAS DRAWS, draft excluded — the hand-placed
     COBs and every array's lamps, assembled for the wiring and reused here
     because it is the same question: every lamp a hand put on a ceiling.

     AND `canvasLayers` RATHER THAN `layers`, which is the one that is easy to
     get wrong. `canvasLayers` is what the DRAWING is showing — it is `layers`
     with the derived rules applied (the plates go off with the wiring, the
     night view drops the dimensions and the cells) — and the sheet is supposed
     to be the drawing on paper. Passing the raw switches would plot marks the
     screen is not showing. */
  const plotArgs = useMemo(() => ({
    source, pxPerFt, rooms,
    objects: obstaclesPx,
    accents: accentZonesPx,
    spots: taskSpotsPx,
    coves: reverseCoves,
    cobs: lampsPx,
    tracks: magTracksPx,
    trackModules: trackModulesPx,
    layers: canvasLayers,
  }), [source, pxPerFt, rooms, obstaclesPx, accentZonesPx, taskSpotsPx,
       reverseCoves, lampsPx, magTracksPx, trackModulesPx, canvasLayers]);

  /* --- AND THE DXF'S, WHICH IS THE SAME DRAWING FOR A DIFFERENT READER -------
     TWO CALL SITES AGAIN, and the same hand-written pair the PDF's had: the
     Share menu's and the viewer panel's. Assembled here so the two cannot
     differ, and so the next list a drawing grows reaches both files at once —
     the magnetic track reached neither until now, which is exactly the drift
     this closes.
     `rooms` IS NARROWED ON PURPOSE. The DXF wants a name and a layout per room
     and nothing else; handing it the live room objects would tie a file format
     to whatever the scene happens to carry this week.
     NO `layers`. A DXF has layers of its OWN — eight of them, split by trade —
     and which ones a reader looks at is a decision they make in their own CAD.
     Withholding geometry from a file somebody imports to work from would be
     this app deciding what another trade may see. The SHEET honours the
     switches because a sheet is a picture; a file is not. */
  /* --- IS THIS A DARK SHEET? ------------------------------------------------
     THE INVERTED VIEW SAYS YES AND THE HEATMAP SAYS NO, and the second half is
     what stops the export producing a blank page. The ink rule is one colour for
     every mark — white on a dark sheet, black on a light one — with the heatmap
     forcing black, because an illuminance field is a light-coloured wash and
     white marks on it are a drawing with nothing on it. Put those together on a
     sheet whose GROUND was still black and every mark on it is black on black.
     SO THE HEATMAP DECIDES THE SHEET AND NOT JUST THE INK. A heatmap plot is a
     READING — it is asked for to be measured off, not to be presented — so it
     goes on light paper, in black, with the plan the right way up underneath.
     That is also why this is here rather than inside the plotter: the base image
     is chosen from the same answer, and an inverted plan under a white ground
     would be the other half of the same mistake. */
  const darkSheet = !!layers.invert && !layers.heatmap;

  /* --- WHAT GOES UNDER A NIGHT SHEET, RESOLVED ONCE -------------------------
     THE EXPORT HAS TO BE THE DRAWING ON SCREEN, and for a night sheet that means
     the INVERTED plan — a white plan with black lines comes out a black plan
     with white lines, which is exactly what the canvas is showing. It was coming
     out as a black page with the linework floating on it and no plan at all,
     because `nightBase` re-renders the imported PDF page and every other kind of
     import threw on the way in — swallowed by a `.catch(() => null)` right here.
     `invertedSrc` IS THE ANSWER THE SCREEN IS ALREADY USING. usePlanSource
     inverts the plan's pixels for the canvas (see the note there on why it is
     done to the bitmap and not with a CSS filter) and the canvas draws
     `invertedSrc ?? source.src`. Handing the same image to the plot is what
     makes the two agree by construction rather than by two implementations
     happening to match.
     THE RE-RENDER STILL WINS WHERE THERE IS A PAGE — see `nightBase`, which
     prefers it and takes this as its fallback: the editor's copy is 2400px on
     the long edge, which is 72 dpi on an A1.
     ONE FUNCTION, TWO CALL SITES. The editor's Share menu and the viewer's
     panel both issue this sheet, and the note at the second one is the reason
     this is not written out twice: "one implementation, so an operator's PDF and
     an owner's cannot come out differently". */
  const nightSheetBase = useCallback(() => (darkSheet
    ? nightBase(openPdf, initialFile, pdfPage, {
        fallback: invertedSrc && source?.w > 0
          ? { dataUrl: invertedSrc, w: source.w, h: source.h } : null,
      }).catch(() => null)
    : Promise.resolve(null)),
  /* `openPdf` IS NOT IN HERE. It is a module import rather than a value this
     component holds, so it cannot change between renders — see the lint rule's
     own wording. */
  [darkSheet, initialFile, pdfPage, invertedSrc, source]);

  const dxfArgs = useMemo(() => ({
    source, pxPerFt, heightPx: source?.h,
    rooms: rooms.map((r) => ({ name: r.outline.name, plan: r.plan })),
    objects: obstaclesPx,
    accents: accentZonesPx,
    spots: taskSpotsPx,
    /* `lampsPx`, THE SAME LIST THE PLOT IS HANDED — the hand-placed COBs and
       every array's lamps, draft excluded. It was missing from this object
       alone, so a ceiling laid out by hand exported to CAD as an empty room
       while the PDF of the same plan was full of fittings. A `*Px` projection
       and not the store, for the reason the plot's own note gives: the store
       holds feet and the exporter works in plan pixels, and handing it one is
       not an error anywhere — just a fitting that silently fails to appear. */
    cobs: lampsPx,
    tracks: magTracksPx,
    trackModules: trackModulesPx,
  }), [source, pxPerFt, rooms, obstaclesPx, accentZonesPx, taskSpotsPx,
       lampsPx, magTracksPx, trackModulesPx]);

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


  /* --- WHAT THE CHROME DERIVES, AND IT IS DOWN HERE FOR A REASON ----------
     THESE TWO READ HALF THE COMPONENT, and both of them sat up beside
     `elecScene` — which is a hundred and fifty lines above `selBoardParts` is
     taken off `electrical.panel`. A `const` read before its declaration is a
     temporal dead zone, not an undefined, so the whole editor threw
     "Cannot access 'selBoardParts' before initialization" on load.
     SO THEY LIVE WHERE EVERYTHING THEY READ IS IN SCOPE, which is here, beside
     the other thing the markup derives rather than holds. Anything added to
     either expression has to be declared above this line; the rule is simply
     that these are the LAST things the body computes. */
  /* --- A STEP HAS TAKEN THE WINDOW OVER -----------------------------------
     SIX GESTURES ASK A QUESTION AND EMPTY THE WINDOW DOWN TO IT: the doors, a
     board being seated, a zone being boxed, a cove being spanned, a wall being
     toned, and the two tools that have a `GESTURE`. This is the list those
     branches are written from, said once — it was spelled out in full at three
     different gates and they had already drifted by one term. */
  const stepPanel = doorEdit || boardPlace || zoneEdit
    || geometry.panel.coveDraw || wallEdit || !!stepTool;

  /* Vertical mode always has one analysis card under the sheet. When no room
     is explicitly open, the planner's existing focus fallback supplies it;
     normal mode keeps the current selection-driven floating-window rule. */
  const panelRoom = verticalMode ? (openRoom ?? focus) : openRoom;

  /* --- IS THERE ANYTHING FOR THE FLOATING WINDOW TO SAY? ------------------
     IT TAKES NO LAYOUT, SO IT MUST NOT BE DRAWN EMPTY. The window was a grid
     track and an empty column is merely empty; it is a card floating over the
     drawing now, and an empty card in the corner of a plan is a thing somebody
     will click to find out what it is for.

     THIS IS THE BRANCH LIST OF THE WINDOW'S OWN CONTENTS, IN ORDER. There is no
     way to ask React "did that render anything", so the test is written out —
     and it has to be kept in step with the chain inside. Adding a section to the
     window means adding its condition here; the symptom of forgetting is a
     section that never appears.

     THE LAST FOUR TERMS ARE THE ONES THAT ARE NOT ABOUT A SELECTION. A trouble
     to report, a plan that produced no layout, a fan being placed, and no scale
     set — each of those is the window speaking without having been asked, which
     is right in all four cases. */
  const windowSpeaks = !!source && !boardsOpen && (
    boqOpen || readOnly || prep || stepPanel || showTrace
    || (elecScene ? true : !!panelRoom)
    || !!selBoardParts
    || (!!armed || !pxPerFt)
    || troubles.length > 0 || !rooms.length
  );

  /* --- AND WHERE SOMEBODY HAS PUT IT ---------------------------------------
     AN OFFSET FROM WHERE CSS PUTS IT, AND NOTHING MORE. See
     hooks/usePanelDrag.js for why this is not `useDrag`, and styles.css
     `.lp-window` for how the two transforms compose.

     TRANSIENT, LIKE EVERY OTHER GESTURE STATE ON THIS SCREEN. It is not the
     document's — a plan reopened on another machine with the readings window
     parked over somebody else's second monitor would be a plan carrying a fact
     about a session that ended. It survives the window SHUTTING, though, which
     is the half that matters in use: the window comes and goes on every click
     that changes what is selected, and one that jumped back to the corner each
     time would be one nobody could move at all. */
  const panelDrag = usePanelDrag();

  /* --- AND WHAT IT SHOWS ON THE WAY OUT ------------------------------------
     THE WINDOW'S CONTENTS ARE A FUNCTION OF WHAT IS SELECTED, and it closes
     BECAUSE the selection went away — so at the moment it starts sliding there
     is, by construction, nothing left to draw in it. Without this the slide
     would carry an empty box off the screen, which reads worse than no
     animation: the content still vanishes on the frame and only the frame is
     animated. See hooks/useExitHold.js.

     260 AGAINST THE STYLESHEET'S 220. Slack, deliberately: the hold has to
     outlast the transition rather than race it, and a body released one frame
     early is a blink of empty panel at the very end of the slide — the exact
     artefact this exists to remove. */
  const holdPanelBody = useExitHold(windowSpeaks, 260);

  /* --- IS THE MODULE BAR THE ONE STANDING AT THE FOOT OF THE DRAWING? -------
     ONE BAR IN THAT PLACE, AND THIS IS THE FOURTH THING THAT CLAIMS IT — after
     the downlight's specification, a selected array's, and the shape bar. So it
     is a named condition rather than an inline test, because it is read TWICE:
     once to draw the bar and once by the plain bar below it, whose whole
     condition is the negation of every claim on that position.
     `geometry.bar.mode` IS IN IT AND IS NOT REDUNDANT. Arming a module clears
     the selection and puts the primitives down, which in the ordinary flow
     leaves that bar closed — the run was pressed, and a press on a shape closes
     the geometry bar (see `shapePointerDown`) — but the bar deliberately
     survives arming when it was already open, and two pills in one place is two
     controls competing for the position people have learned. The shape bar wins
     because it is about the drawing rather than about the next press. */
  const moduleBarOn = !readOnly && addTool === 'module' && !!trackMode
    && !!moduleSpec && !geometry.bar.mode;

  /* --- THE FAN'S BAR, AND THE SWEEP IT IS TALKING ABOUT --------------------
     TWO TENSES, ONE BAR. With the tool armed it is the sweep the NEXT fan will
     be placed at — the standing choice, which is sticky; with a fan selected it
     is THAT fan's, read off the object, because a bar showing the standing
     choice while a 600 sits selected underneath it would be a control lying
     about the thing it is pointed at. `setFanSweep` writes both — see
     `setSweep`, which sets the standing value and every selected fan in one
     act — so the two tenses stay one control.

     THE SELECTED FAN WINS WHEN BOTH ARE TRUE. Arming a tool does not clear the
     selection, and the object in front of you is the more specific subject.

     `!geometry.bar.mode` IS THE ONE-BAR-AT-A-TIME RULE, exactly as `moduleBarOn`
     states it: the shape bar and this one stand in the same place at the foot
     of the stage, and the shape bar is about what the DRAWING shows. */
  const selFan = ceilingObjs.find((o) => o.id === selObjId && o.kind === 'fan') ?? null;
  /* AND IT YIELDS TO THE THREE THAT WERE HERE FIRST. A fan selection and an
     armed downlight cannot really coexist — the register holds one kind (see
     selection.js) and arming either machine disarms the other — but a
     SELECTION outlives a press that arms a tool, so "a fan is picked and the
     COB tool is now in hand" is reachable, and two bars in one place is the
     bug lib/selection.js was written to end. The tool in hand is the more
     urgent subject; the fan is still there when it is put away. */
  const fanBarOn = !readOnly && !geometry.bar.mode && !moduleBarOn
    && addTool !== 'cob' && !selArrayBar && (armed === 'fan' || !!selFan);
  const fanBarSweep = selFan ? sweepMm(selFan) : fanSweepMm;

  /* --- THE POINT BAR, ON THE SAME TERMS AS THE FAN'S ------------------------
     TWO TENSES, ONE CONTROL. Armed, the chips say what the NEXT point will be;
     with points selected they say what THOSE are and change them — which is why
     `pointArmed` and the selection are one condition rather than two bars.
     THE STANDING CHOICE IS THE DOCUMENT'S NEAREST ANSWER and not a piece of
     state: a point carries its own height and rating, so with one selected the
     bar reads it, and with none it reads the defaults the next one will be born
     with. A second store for "what the tool is set to" would be a third place
     for those numbers to live and disagree.
     AND IT YIELDS TO THE THREE THAT WERE HERE FIRST, exactly as the fan's does
     and for the same reason: one bar at a time at the foot of the stage. */
  /* --- THE SPLIT UNIT'S BAR, ON THE SAME TERMS AS THE FAN'S -----------------
     TWO TENSES, ONE CONTROL, exactly as the fan's and the point's: armed, it
     says what the next unit will be fed by; with one selected it says what THAT
     unit is fed by and changes it.
     AND THE STANDING CHOICE IS NOT A PIECE OF STATE. A unit carries its own
     feed and its supply carries its own rating, so with one selected the bar
     reads them, and with none it reads the defaults the next one will be born
     with — the socket, and this country's AC rating. A second store for "what
     the tool is set to" would be a third place for those to live and disagree.
     ONLY A SEATED ONE GETS THE BAR. A split unit from a plan saved before any
     of this is a free box with no wall and no supply; offering to re-feed it
     would be offering a decision the app cannot then carry out. */
  const selAc = ceilingObjs.find(
    (o) => o.id === selObjId && isWallUnit(o) && isSeated(o)) ?? null;
  const acArmed = typeOnWall(armed);
  const acBarOn = !readOnly && !geometry.bar.mode && !moduleBarOn && !fanBarOn
    && addTool !== 'cob' && !selArrayBar && (acArmed || !!selAc);
  const acBar = selAc
    ? { feed: feedOf(selAc), amps: acFeed.ampsOf(selAc) }
    : { feed: AC_FEED, amps: acAmpsFor(acCountry) };

  const selPoints = doc.elecPoints.filter((q) => selPointIds.includes(q.id));
  const pointArmed = POINT_IDS.includes(armed);
  const pointBarOn = !readOnly && !geometry.bar.mode && !moduleBarOn && !fanBarOn
    && !acBarOn && addTool !== 'cob' && !selArrayBar
    && (pointArmed || selPoints.length > 0);
  const pointBar = (() => {
    const first = selPoints[0] ?? null;
    if (first) {
      return { onWall: isConstrained(first), heightMm: heightOfPoint(first),
               amps: Number.isFinite(first.amps) ? first.amps : null };
    }
    return { onWall: armed === WALL_POINT_ID, heightMm: WALL_POINT_HEIGHT_MM,
             amps: POINT_AMPS };
  })();
  /* THE WRITE GOES TO EVERY SELECTED POINT, which is what makes the two tenses
     one control: with none selected there is nothing to write and the bar is
     showing what the next one will be born with — the defaults, which are not
     stored and so cannot be edited into disagreement with themselves. */
  const setPointHeight = (mm) => {
    for (const q of selPoints) if (isConstrained(q)) docActions.patchElecPoint(q.id, { heightMm: mm });
  };
  const setPointAmps = (a) => {
    for (const q of selPoints) docActions.patchElecPoint(q.id, { amps: a });
  };

  /* One write path serves both the ordinary analysis window and the compact
     selected-fixture card in vertical mode. The UI is duplicated in position,
     not in behaviour. */
  const changeRowWatts = (room, row, w) => (isModuleRow(row.key)
    ? setTrackModuleSpec(row.key, { watts: w })
    : cobArrays.some((a) => a.id === row.key)
      ? setArraySpec(row.key, { watts: w })
      : ceilingObjs.some((o) => o.id === row.key)
        ? docActions.patchObject(row.key, { watts: w })
        : row.wattRange
          ? setCobSpec(row.key, { watts: w })
          : setRowWatts(room.id, row, w));
  const changeRowBeam = (row, deg) => (isModuleRow(row.key)
    ? setTrackModuleSpec(row.key, { beam: deg })
    : cobArrays.some((a) => a.id === row.key)
      ? setArraySpec(row.key, { beam: deg })
      : setCobSpec(row.key, { beam: deg }));

  const roomWallMix = panelRoom
    ? wallMix(panelRoom.geo.polygonFt, materialsOf(materials, panelRoom.id).walls)
    : [];
  const wallTonesInUse = roomWallMix.filter((m) => m.pct > 0);
  const panelWallTone = wallTonesInUse.length === 1 ? wallTonesInUse[0].tone : null;

  /* --- THE ONE THING THAT EARNS THE HEAD OF THE COLUMN --------------------
     109px OF A 9:16 FRAME IS THE MOST EXPENSIVE PIXEL REAL ESTATE IN THIS APP,
     and until now three different things spent it: a selected fitting, a tool
     in hand, and any of the three specification bars. The last two are gone from
     up there — see the note at the foot of the band, where the bars stand now —
     and this is the only claim left. It is also the narrowest it can be:

       A LIGHT, CLICKED, WHOSE WATTAGE CAN ACTUALLY BE CHANGED. `wattsChangeable`
       is the test (see SpaceAnalysis): a range or a product list. A fitting
       specified at one wattage has nothing on this window a press can do, so the
       window would be a caption over the drawing — and a caption is exactly what
       the strip stopped being.

     THE ROW IS THE CONDITION, NOT THE HIGHLIGHT LIST. It used to hand the whole
     panel its keys and let it filter, which is how the card came up for a
     selection this room's analysis had no row for and then drew an empty box.

     ARRAYS AND FANS KEEP THEIR OWN BARS. Both own richer controls than a
     wattage and an optic, and both stand at the foot of the band like every
     other contextual bar; two controls for one fitting in two places is the
     one-bar-at-a-time rule broken in the vertical. */
  /* --- ...AND THE CONTEXTUAL BARS STAND IN THE SAME SLOT NOW --------------
     THE BAR WITH A PRIMITIVE IN HAND OUTRANKS THE WINDOW, and only that one.
     The geometry bar arrives UNARMED on a space click — the most ordinary press
     on this drawing — and it does not close when a lamp is then picked up (see
     `standDown`, which only the array flow calls), so a rule that simply let the
     bar win would mean clicking a light showed nothing at all for most of a
     session. With a shape tool live it is the other way round: somebody is
     mid-gesture, the tick and the bin are on that bar, and a readout about a
     lamp they selected earlier must not take its place.
     THE OTHER THREE BARS CANNOT COLLIDE WITH THIS. Arming the downlight or the
     module clears the selection (see the rail's own handlers, and the note on
     `moduleBarOn`), and an array's bar and a fan's are already terms here. */
  /* --- AND A SELECTED GEOMETRY IS NOT A SELECTED FITTING --------------------
     `!selShapeId` IS A FIX AND IT IS ONE CONDITION WIDE. A magnetic track is a
     SHAPE (see ceilingShapes) and `highlightRows` reads `selShapeId` — so
     pressing a run lit up the modules clipped along it, and because a module
     has a wattage list the test below said yes and this window opened. What it
     opened over is that track's OWN contextual menu: its corner radius, its
     duplicate, its bin. And it says nothing about the thing a press on a run is
     usually about, which is where the run goes.
     A GEOMETRY ANSWERS TO THE SHAPE BAR, A FITTING TO THIS WINDOW, so the two
     can never want the same slot. The modules clipped along the track still
     raise it when one of THEM is pressed — a module is a fitting. */
  const shapeBarArmed = !readOnly && !!geometry.bar.mode && !!geometry.status.tool;
  /* --- THE ROW THE SELECTION IS, WORKED OUT ONCE ---------------------------
     TWO BARS ASK THE SAME QUESTION OF THE SAME ANALYSIS. The light window wants
     a FITTING's wattage and optic; the shape bar wants a RUN's wattage per
     metre. `highlightRows` answers both from one place — it reads `selShapeId`
     alongside every fitting id — so the lookup is one call and the two readers
     differ only in which kind of selection they accept. Computed when there is
     something highlighted and something to draw it in, so an ordinary press on
     bare plan costs nothing. */
  const panelAnalysis = panelRoom && analysisHighlight.keys.length > 0
    && (verticalMode || selShapeId) && !readOnly
    ? spaceAnalysis(panelRoom) : null;
  const highlightedRow = panelAnalysis
    ? (panelAnalysis.rows.find((r) => analysisHighlight.keys.includes(r.key)) ?? null)
    : null;
  /* A SELECTED RUN'S OWN SPECIFICATION, FOR THE SHAPE BAR. Null unless a shape
     is what is selected — the window below takes the other half of that. */
  const selShapeRow = selShapeId ? highlightedRow : null;
  /* THERE IS NO `selShapeIsTrack` ANY MORE. It existed to withhold the bar's
     duplicate and bin from a run, and the bar draws neither for anything now —
     see the note where they were, in ShapeMenu. A run and a cove differ on that
     bar only in what the analysis has to say about each. */
  const selectedFixtureRow = verticalMode && !selShapeId
    && !selArrayBar && !fanBarOn && !shapeBarArmed
    && highlightedRow && wattsChangeable(highlightedRow) ? highlightedRow : null;
  const selectedFixtureAtTop = !!selectedFixtureRow;
  /* --- THE TOOL CARD IS GONE, AND NOTHING REPLACED IT ---------------------
     IT WAS A ✦, A FIXTURE'S NAME AND A SENTENCE TELLING YOU TO CLICK THE PLAN,
     standing in that same strip whenever anything was armed — a cove, a socket,
     a sconce. Three things were wrong with it and they are the same thing: it
     was CHROME EXPLAINING CHROME. The rail cell you just pressed is latched and
     on screen, the cursor over the drawing is already the tool's, and the bar at
     the foot of the band says what the next press will place. It spent the
     dearest strip in the layout on a caption for all three.
     SO PLACING A COVE RAISES NO WINDOW AT ALL, and placing spots raises the
     white bar at the foot of the drawing with the engine's recommendation on it
     — which is what that bar has always been for. */
  /* THERE IS NO `verticalTopTaken` AND NO `verticalClose` EITHER. The first hid
     the fixture rail and then set the band's padding — two ways for a contextual
     card to move the drawing underneath itself. The second was a cross for
     putting the thing in hand down, which is what pressing its own rail cell
     again does, and what Escape does, in both modes. */

  /* --- THE LAYOUT SWITCHES ON THE FLOATING BAR ----------------------------
     THE ELECTRICAL LAYER SWITCH IS DELIBERATELY NOT HERE. Wiring remains
     available from the Electrical tool and the View menu, while this contextual
     bar stays about the lighting layout being edited: its suggestions and its
     heatmap.

     `autoLights` WAS THE CAPSULE HERE AND IT IS NOT ANY MORE. Two switches over
     the same population is one question too many at the front of the bar: the
     first asked whether the engine's answer was on the sheet, the second how it
     was drawn, and between them they had four states of which only three meant
     anything. What is left is the one that matters — is the planner PROPOSING,
     or is the ceiling yours? The placement is off by default now (see
     LAYER_DEFAULTS) and its tick lives in the View menu with every other layer,
     which is where a switch nobody reaches for every session belongs, and which
     keeps a sheet saved with it ON from having no way to take it off.

     THE SAME GATES FOR BOTH CONTROLS, TO THE TERM. There is no layout to show
     without a drawing, none while the pipeline is still making one, and a
     viewer gets the sheet as it was left rather than switches over it.
     IT IS `layers.suggestGrid` AND NOT A THIRD STORE. The same key the exports
     and PlanCanvas read, so this switch and the drawing cannot disagree — see
     LAYER_DEFAULTS for why the grid stopped being part of `lights`. */
  /* --- ...AND THE HEATMAP RIDES IN THE SAME SLOT ---------------------------
     THE THIRD SWITCH THAT IS ABOUT WHAT THE DRAWING SHOWS, which is what the
     lead slot is for — see the note on the slots in StageBar. The Suggested Grid
     asks whether the planner is PROPOSING; this asks what the ceiling as it
     stands actually DELIVERS to the floor, which is the same kind of question
     about the same sheet and belongs beside it rather than in the View menu with
     the marks nobody reaches for.
     THE SAME GATES, TO THE TERM. No drawing, no field; nothing while the
     pipeline is still making one; and a viewer gets the sheet as it was left
     rather than switches over it. Sharing the list is what keeps the bar from
     arriving with one of its three switches missing. */
  /* --- ...AND THE OPERATOR GETS A THIRD, WHICH NOBODY ELSE SEES -----------
     ROLE 1 ONLY, like the audit overlays and Vertical Mode. The wiring is
     scaffolding to everybody except the person checking where the passes put
     it, and a client looking at their ceiling has no use for a switch that
     turns blue rectangles and dotted arcs on over it.

     IT IS A MASTER SWITCH OVER TWO LAYERS, AND THAT IS THE WHOLE OF IT. On puts
     the wiring on screen; off takes it off. Both `electrical` and `switchboards`
     follow it together, because between them they ARE the wiring: the arcs are
     one and the plates the other, and a bar switch called Switchboards that left
     half of it on the sheet would be lying about what it just did.

     ON MEANS ON, WHATEVER THE VIEW MENU SAYS. Pressing it ticks BOTH boxes in
     View rather than restoring whatever was last ticked there — so the state
     after a press is knowable without remembering what you did last week, which
     is the property a master switch is for. Untick either one in View afterwards
     to pare it back; the bar switch is the way to the whole thing, the menu is
     the way to part of it.

     IT READS `electrical` AND NOT `switchboards`, WHICH LOOKS WRONG AND IS NOT.
     The plates are DERIVED OFF whenever the wiring is off (see `wiring` in the
     layer memo above) while `switchboards` itself DEFAULTS ON — so on a plan
     nobody has touched the stored flag says true and the drawing shows nothing.
     A switch bound to that flag would stand here latched over a sheet with no
     plates on it. `electrical` is the one that actually decides whether any of
     this is visible, so it is the one the switch reports.

     `|| boardPlace` MIRRORS THE DERIVATION EXACTLY — the placement step is the
     standing exception that shows plates with the wiring off, because a step
     whose whole output is invisible looks broken. Reading the effective state
     means reading all of it, or the switch sits unlatched while the plates it
     names are on screen during the one gesture entirely about them. */
  const wiringShown = !!(layers.electrical || (boardPlace && layers.switchboards));
  const autoLead = verticalMode || !source || showTrace || prep || readOnly || sheetOpen ? null : (
    <>
      <SceneSwitch label="Suggested Grid" on={layers.suggestGrid}
        title="Draw the planner's answer as dotted suggestions instead of fittings"
        onClick={toggle('suggestGrid')} />
      <HeatmapSwitch on={layers.heatmap} onClick={toggle('heatmap')} />
      {isAdmin && (
        <SceneSwitch label="Switchboards" on={wiringShown}
          title="Every wire and every plate. Off takes them all; on brings them all back."
          onClick={() => {
            const next = !wiringShown;
            docActions.setLayer('electrical', next);
            docActions.setLayer('switchboards', next);
          }} />
      )}
    </>
  );

  const toggleVerticalMode = () => {
    if (!isAdmin || !source || prep || showTrace || sheetOpen) return;
    if (!verticalMode) {
      normalZoom.current = zoom;
      /* AND THE SHEET IS SIZED TO THE BAND BY THE LAYOUT EFFECT THAT WATCHES
         THIS FLAG — see `fittedVertical`, which measures the band rather than
         being told two numbers about it. */
      setVerticalMode(true);
      return;
    }
    setVerticalMode(false);
    if (normalZoom.current != null) docActions.setZoom(normalZoom.current);
    normalZoom.current = null;
  };

  return (
    /* --- THE DRAWING TAKES THE SCREEN, AND THE CHROME SITS ON THE EDGES ----
       IT WAS THREE COLUMNS, THE LAST OF THEM A 340px PANEL, and the panel was
       the problem: it was a column of controls that mostly did not apply, it
       had to scroll to hold them, and it took a fifth of the width of the one
       thing this app is for away from it permanently — on every screen, whether
       or not anything in it was being read.

       SO THERE ARE TWO COLUMNS AND TWO ROWS. The rail down the left, the stage
       filling everything else, and a bar across the foot of the stage for the
       preferences and the readings. What used to be the panel is a WINDOW that
       floats over the drawing's top-right corner (see the block after the
       stage) — present when it has something to say about the thing you have
       selected, and taking no layout at all when it does not.

       THE FIRST COLUMN IS `auto` SO IT CAN BE NOTHING. The rail is only there
       once a plan is laid out, and a rail that is not rendered must not leave an
       86px gutter on the upload screen; rendering nothing collapses the track,
       which is what `auto` buys over a fixed width. The tracks are named
       explicitly on the two children below rather than left to auto-placement,
       because auto-placement puts the footer beside the stage on exactly the
       screens where the rail is absent.

       AND THE FOOT OF THE STAGE IS NOT THE FOOT OF THE SCREEN. The bar is a
       grid row rather than something absolute over the drawing: a scroll
       container with chrome floating in front of its own last inch is a
       container whose bottom edge you cannot reach. */
    <div className={'lp-shell relative grid grid-cols-[auto_1fr] grid-rows-[1fr_auto] h-full gap-0 '
      + '[@media(max-width:960px)]:grid-cols-1 '
      + '[@media(max-width:960px)]:grid-rows-[auto_1fr_auto] '
      + '[@media(max-width:960px)]:overflow-auto '
      + (verticalMode ? 'lp-shell-vertical ' : '')}>
      {/* ONE QUESTION, BEFORE ANYTHING ELSE. Shown the moment a plan is
          readable and dismissed only by answering — see ProjectTypeDialog. */}
      {source && !readOnly && (!projectId || doorState.status === 'running') && (
        <ProjectTypeDialog planName={source.name} onPick={docActions.setProjectType}
          busy={doorState.status === 'running' ? 'Looking for doors…' : null}
          note="A door is a standard width, so one of them is the drawing's ruler." />
      )}
      {/* --- AND THE SPACES, WHICH NOW HAVE NOTHING STANDING IN FRONT OF THEM ---
          THE SAME MODAL THE DOOR SEARCH USES, for the same reason: a thing the
          user asked for, that takes a few seconds, that the rest of the screen
          cannot usefully be used during. It did not exist before because it did
          not need to — the project question and then the door search covered
          the segmenter's whole run, so the spaces were always on the plan by
          the time anybody could look. Reading the scale off the drawing removed
          BOTH of those waits and left this one uncovered, landing people on an
          empty tracer that said "nothing traced yet".

          NEVER TWO MODALS AT ONCE. `!projectId` is the question and
          `doorState.status === 'running'` is the door search; both render the
          same box above, so this one stands down while either is up.

          `!outlines.length` — A RE-RUN MUST NOT BLANK THE SCREEN. Asking for
          the spaces again on a plan that already has them is a correction, not
          a wait: the outlines stay on the plan, the panel's own line reports
          the second pass, and covering the drawing would hide the very thing
          being corrected. */}
      {source && !readOnly && projectId && doorState.status !== 'running'
        && !outlines.length && (roomState.status === 'running' || dimensions.pending) && (
        <BusyModal
          line={roomState.status === 'running'
            ? 'Finding the spaces…'
            : 'Reading the dimensions…'}
          note={roomState.status === 'running'
            ? 'It proposes one outline per room — you nudge the corners after.'
            : 'Checking what the drawing says its rooms measure.'} />
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
      {/* --- THE TOP BAR: OUT, BACK, WHICH PLAN, AND WHERE IT GOES ---------
          FULL WIDTH NOW, over the rail as well as the stage. It used to stop
          short of the panel's 340px, which is what a bar belonging to the
          drawing does; it belongs to the SCREEN — the house takes you out of the
          editor entirely and the name in the middle is the name of the whole
          document, neither of which is about the sheet.

          THE NAME IS IN THE CENTRE AND THE ACTS ARE AT THE ENDS. Left is
          navigation — out of the plan, and back a step inside it. Right is
          history and what leaves the building. Between them, the one fact this
          bar exists to state.

          THREE TRACKS AND NOT A `flex` WITH SPACERS, which is what makes the
          centring true rather than approximate: with `1fr auto 1fr` the name is
          in the middle of the SCREEN whatever is beside it, where a flexbox
          would centre it in the space left over and shift it every time a pill
          appeared. */}
      {/* --- THE ONE WHITE SURFACE ON THE SCREEN, AND IT IS THE MASTHEAD ----
          IT WAS FROSTED GLASS over the page's own graph paper, which was right
          when it was one bar on a page whose ground you could see. There are
          four surfaces now — this bar, the rail, the drawing and the bar along
          the foot — and three of them are the chrome's grey (`--color-chrome`)
          against a black drawing. This one is white.

          WHY THE ODD ONE OUT IS THE RIGHT ONE. Everything in this bar is about
          the DOCUMENT rather than about the sheet: what it is called, what has
          happened to it, and where it goes next. Nothing in it changes a line on
          the plan. The grey surfaces are the tools and the readings, which are
          all about the drawing; a masthead in the same grey would file it with
          them.

          NO BOTTOM HAIRLINE. White against the drawing's black is already the
          hardest edge on the screen, and a #EAEAEA line on top of it would be a
          border nobody can see doing a job nothing needs done.

          EVERY FOREGROUND IN HERE IS INKED FOR WHITE, and three of them are
          shared tokens that had one caller each: `TABS` and `STEP` (the undo and
          redo pair) and the save pills. See their notes in ui/tokens.js — all
          three were built to be legible on a dark bar, and 5% white on white is
          nothing at all. */}
      <div className="absolute top-0 left-0 right-0 h-14 z-[5] grid
        grid-cols-[1fr_auto_1fr] items-center gap-3.5 px-4 bg-white">
        {/* --- OUT, AND BACK ONE STEP -----------------------------------
            A HOUSE AND A WORDED LINK, WHICH IS THE RIGHT WAY ROUND. The house
            is the same mark this app uses for "all the way out" everywhere else,
            and it needs no label because it is the only icon in the corner. The
            step back inside the plan does need one: "outlines" is this app's own
            word for a stage of the work, and there is no picture of it.

            THE OUTLINES LINK IS A TOGGLE AND IT LATCHES. Pressing it shows the
            tracer; pressing it again puts the layout back. That is what
            `backToOutlines` and `backToDesign` already were — see the note on
            `outlinesOpen` for why the trip discards nothing — and a link that
            only went one way would leave the drawing behind a button somebody
            had to guess at. */}
        <div className="flex items-center gap-1.5 min-w-0 justify-self-start">
          {(onHome || onBack) && (
            <button type="button" onClick={onHome ?? onBack}
              title="Back to your dashboard" aria-label="Dashboard"
              className="flex-none inline-flex items-center justify-center w-8 h-8
                rounded border-0 bg-transparent text-muted cursor-pointer
                transition-colors duration-[120ms] hover:text-ink hover:bg-ink/[0.07]
                focus-visible:outline-2 focus-visible:outline-accent
                focus-visible:outline-offset-2">
              {/* HEROICONS' `home`, OUTLINE, DRAWN RATHER THAN LOADED — the
                  same decision as the undo/redo pair further along this bar:
                  a path inline takes the ink colour with it, stays sharp at any
                  density, and costs nothing at build time. 1.7 and not their
                  1.5, which is this chrome's own weight. */}
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none"
                stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
                strokeLinejoin="round" aria-hidden="true">
                <path d="M2.25 12 11.2 3.05a1.13 1.13 0 0 1 1.6 0L21.75 12M4.5
                  9.75v10.13c0 .62.5 1.12 1.13 1.12H9.75v-4.875c0-.62.5-1.125
                  1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0
                  1.125-.5 1.125-1.125V9.75" />
              </svg>
            </button>
          )}
          {/* ONLY WHERE THERE ARE OUTLINES TO GO BACK TO. On the upload screen
              and in the viewer there is no stage to step back into, and a link
              to one would be a control that cannot do what it says.
              AND NOT ON THE OUTLINE SCREEN ITSELF. A link back to the stage you
              are standing on is a control with nothing behind it; the way out of
              this screen is its own foot, which already offers exactly one — the
              design, or the light. */}
          {/* --- AND ON A SHEET IT IS THE WAY BACK TO THE DRAWING ----------
              THE SCHEDULE IS NOT A STAGE OF THE PLAN, it is another page of the
              same document, and the one thing anybody wants from this corner
              while they are reading it is out. "Space outlines" there offered a
              jump two stages backwards from a screen that has no stage at all —
              and it would have thrown away the reader's place in the schedule
              to do it.
              IT IS NOT GATED ON `readOnly` LIKE THE LINK BELOW IT. The BOQ
              toggle further along this bar is, so a viewer who reaches the
              schedule has no other way off it; a back button that vanished for
              them would be a page with no exit. */}
          {boqOpen ? (
            <button type="button"
              title="Back to the drawing"
              onClick={() => docActions.setView('design')}
              className={'flex-none inline-flex items-center gap-[7px] h-8 px-2 rounded '
                + 'border-0 bg-transparent text-[12px] leading-none whitespace-nowrap '
                + 'cursor-pointer transition-colors duration-[120ms] '
                + 'focus-visible:outline-2 focus-visible:outline-accent '
                + 'focus-visible:outline-offset-2 '
                + 'text-muted hover:text-ink hover:bg-ink/[0.07]'}>
              <span aria-hidden="true" className="text-[13px]">←</span>
              Back
            </button>
          ) : source && !readOnly && !showTrace && (
            <button type="button"
              title="Back to the space outlines — nothing is discarded"
              aria-pressed={false}
              onClick={() => backToOutlines()}
              className={'flex-none inline-flex items-center gap-[7px] h-8 px-2 rounded '
                + 'border-0 bg-transparent text-[12px] leading-none whitespace-nowrap '
                + 'cursor-pointer transition-colors duration-[120ms] '
                + 'focus-visible:outline-2 focus-visible:outline-accent '
                + 'focus-visible:outline-offset-2 '
                /* ONE BACKGROUND CLASS EITHER WAY — see the rail's cells for
                   the emission-order trap that makes two of them a bug. */
                + 'text-muted hover:text-ink hover:bg-ink/[0.07]'}>
              <span aria-hidden="true" className="text-[13px]">←</span>
              Space outlines
            </button>
          )}
        </div>

        {/* --- WHICH PLAN, IN THE MIDDLE OF THE SCREEN --------------------
            THE ONE FACT THIS BAR EXISTS TO STATE, and it is centred because it
            is a title rather than a control. It was in the top-left beside a
            "Back to Projects" link, where it read as the second half of that
            link's sentence.

            EDITED IN PLACE rather than behind a dialog, because a plan
            auto-named from a filename is a name nobody chose and this is where
            anybody who cares about it is looking. WHITE, NOT `text-ink`: this
            bar is frosted glass over a black page, and ink is #000000. */}
        {source || onBack ? (
          <div className="min-w-0 justify-self-center text-center">
            {readOnly ? (
              /* A SPAN, NOT A DISABLED BUTTON. The name is not a control here
                 and dressing it as a dead one invites the click that does
                 nothing. */
              <span className="block text-[14px] tracking-[-0.02em] text-ink py-1
                overflow-hidden text-ellipsis whitespace-nowrap max-w-[38ch]">
                {planName || 'Untitled plan'}
              </span>
            ) : nameDraft == null ? (
              /* HOVER HINTS AT THE FIELD IT BECOMES — the same glass the input
                 below wears, so the hover is a preview of the edit rather than a
                 different effect. */
              <button title="Rename this plan"
                className="border-0 bg-transparent text-[14px] tracking-[-0.02em] text-ink
                  cursor-text px-2 py-[3px] rounded max-w-[34ch] overflow-hidden
                  text-ellipsis whitespace-nowrap transition-colors duration-[120ms]
                  hover:bg-ink/[0.06]"
                onClick={() => setNameDraft(planName || '')}>
                {planName || 'Untitled plan'}
              </button>
            ) : (
              /* --- EDITING: A FIELD THAT ASKS TO BE TYPED IN ---------------
                  IT STATES WHAT IT IS rather than inheriting from styles.css's
                  `input[type=text], …` rules — an ATTRIBUTE selector this input
                  does not match, having no `type` at all. That trap is how the
                  login field ended up unstyled, and it is worth stating rather
                  than discovering; what this wants is a light field on a light
                  bar, which is a wash of ink and the app's own hairline. */
              <input className="text-[14px] tracking-[-0.02em] w-[26ch] px-2 py-[3px]
                rounded bg-ink/[0.04] text-ink text-center
                border border-border-strong focus:outline-none"
                autoFocus value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => { onRename?.(nameDraft); setNameDraft(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { onRename?.(nameDraft); setNameDraft(null); }
                  if (e.key === 'Escape') setNameDraft(null);
                }} />
            )}
          </div>
        ) : (
          /* The standalone editor — no project, no route above it. `<Logo>` and
             not a second copy of the crop: the numbers are measured off the
             FILE, so re-exporting the artwork left a hard-coded copy pointing at
             a region of a canvas that no longer existed. */
          <div className="flex items-center gap-2.5 min-w-0 justify-self-center
            tracking-[-0.025em]">
            <Logo width={116} />
            {/* THE ARTWORK IS WHITE INK ON AN OPAQUE BLACK PLATE, so on this
                bar it reads as a black badge rather than as a wordmark set in
                the bar. That is legible and it is left alone: this branch is the
                standalone editor — no project, no route above it — which the
                app's own routes never reach. A light cut of the logo is what
                would fix it properly. */}
            <span className="w-px h-[15px] bg-border-strong flex-none rotate-[15deg]"
              aria-hidden="true" />
            <span className="text-[12px] text-muted whitespace-nowrap overflow-hidden text-ellipsis">
              {view === 'boq' ? 'schedule' : 'lighting layout'}
            </span>
          </div>
        )}

        {/* --- WHAT HAS HAPPENED, AND WHAT LEAVES ------------------------
            THE HISTORY AND THE EXPORTS, at the end of the bar. `justify-self-end`
            with `min-w-0` so a long plan name in the middle track never pushes
            Share off the screen. */}
        <div className="flex items-center gap-2 min-w-0 justify-self-end">
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
        {/* --- THE SCHEDULE, BESIDE THE THING IT IS A SCHEDULE FOR ---------
            IT WAS ON THE BAR OVER THE DRAWING, on the reasoning that the plan
            and the schedule are two DRAWINGS of one job and the control that
            says which you are looking at belongs on the sheet. Half of that is
            right and it is the wrong half: the wiring is a layer on this sheet,
            which is why the switch for it stayed down there — the schedule is
            not a layer, it is somewhere else, and it takes the whole stage when
            you go. Where the document is open TO is the same kind of fact as
            what it is called and where it goes next, and that is this bar.

            IT ALSO GIVES THE SCHEDULE ITS WAY BACK. The bar over the drawing is
            not rendered while a sheet is up, so the button that used to leave
            the schedule was drawn on a bar nobody could see; latched here, one
            control opens it and closes it and is legible from both.

            QUIET, BESIDE SHARE AND NOT DRESSED AS IT. Share is the one act on
            this screen that reaches somebody else and it is the only filled
            button in the chrome; this goes to another page of the same
            document. */}
        {source && !readOnly && !prep && !showTrace && (
          <button type="button" aria-pressed={boqOpen}
            title={boqOpen
              ? 'Back to the drawing'
              : 'The schedule of everything on this plan'}
            onClick={() => docActions.setView(boqOpen ? 'design' : 'boq')}
            className={'flex-none text-[11.5px] leading-none px-3 py-[7px] rounded '
              + 'border cursor-pointer inline-flex items-center justify-center '
              + 'transition-colors duration-[120ms] '
              + 'focus-visible:outline-2 focus-visible:outline-accent '
              + 'focus-visible:outline-offset-2 '
              /* ONE BACKGROUND CLASS EITHER WAY — see the outlines link above
                 for the emission-order trap that makes two of them a bug. */
              + (boqOpen
                ? 'border-border-strong bg-ink/[0.07] text-ink'
                : 'border-border-strong bg-transparent text-ink hover:bg-ink/[0.06]')}>
            BOQ
          </button>
        )}

        {/* --- SHARE, AND EVERYTHING THAT LEAVES IS BEHIND IT --------------
            IT WAS FOUR BUTTONS: DXF, PNG, PDF and then Share, three of them
            file formats in a row across the head of the panel. They are one act
            — this drawing, going somewhere else — and a row of formats spends
            the most valuable position on the page on a question nobody asks
            until they are finished.

            SO THE ACT IS THE BUTTON AND THE FORMATS ARE INSIDE IT. Share stays
            the one white button on this screen, for the reason it always was:
            everything else in this chrome is quiet glass on a dark ground, and
            this is the one thing here that reaches somebody else.

            THE PANEL HOLDS FOUR ITEMS AND ONE OF THEM IS NOT A FILE. Sending
            the project to a person is the same act as handing them a PDF of it,
            and separating the two would put the app's own answer ("a link")
            behind a different control from the three fallbacks. It is first,
            under its own rule, because it is the one that does not download.

            THE DXF IS THE ONE GATED ON A LAYOUT, and the other two are not.
            `!totals.rooms` disables it because a DXF of this app's own work with
            no work in it is an empty file; a PNG or a PDF of the plan as it
            stands is the plan, which is a thing somebody may legitimately want
            on the outlines step. A dead button is a claim that something is
            available — and so is a hidden one, in reverse. */}
        {source && !readOnly && !prep && !boqOpen && (
          <>
            <button type="button" ref={shareRef}
              onClick={() => setShareMenu((v) => !v)}
              title="Take this drawing somewhere else"
              aria-expanded={shareMenu}
              /* IT INVERTED WITH THE BAR. It was the one WHITE button on a dark
                 panel, for the reason it is now the one BLACK button on a white
                 one: everything else in this chrome is deliberately quiet, and
                 this is the single act on the screen that reaches somebody else.
                 The rule is "the loudest thing available", not "white". */
              className="flex-none text-[11.5px] leading-none px-3 py-[7px] rounded
                border border-cta bg-cta text-white cursor-pointer inline-flex
                items-center justify-center gap-[6px]
                transition-colors duration-[120ms]
                hover:bg-cta-hover hover:border-cta-hover
                focus-visible:outline-2 focus-visible:outline-accent
                focus-visible:outline-offset-2">
              {/* HEROICONS' `share`, OUTLINE, at this chrome's own 1.7 stroke
                  rather than their 1.5, and at 13px to sit with the smaller
                  type. Drawn, not loaded — see the house at the other end. */}
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
            <Popover anchor={shareRef} open={shareMenu} side="bottom" align="end"
              width={252} label="Share and export"
              onClose={() => setShareMenu(false)}>
              {onShare && (
                <>
                  <button type="button" className={MENU_ITEM}
                    onClick={() => { setShareMenu(false); onShare(); }}>
                    <span className="grid w-full grid-cols-[16px_minmax(0,1fr)] gap-x-2">
                      <PeopleMenuIcon />
                      <span className="flex min-w-0 flex-col items-start gap-[3px]">
                        <b className="font-normal text-text">Share with people</b>
                        <span className={MENU_NOTE}>A link, with who may see it</span>
                      </span>
                    </span>
                  </button>
                  <div className="h-px bg-border/15 my-1.5 mx-3" aria-hidden="true" />
                </>
              )}
              {/* THE PARAGRAPH THE EXPORT SECTION USED TO CARRY IS THE SECOND
                  LINE OF EACH ITEM. "Everything on a superluminal_ layer, split
                  by trade" is read once, by the one person who opens the file in
                  CAD — it does not need permanent space in a panel, and a menu
                  has room for it where a row of three chips did not. */}
              <button type="button" className={MENU_ITEM} disabled={!totals.rooms}
                onClick={async () => {
                  setShareMenu(false);
                  if (!await gateExport()) return;
                  download(`${exportBase}-lights.dxf`, toSuperluminalDXF(dxfArgs), 'application/dxf');
                  milestone.current?.('export');
                }}>
                <span className="grid w-full grid-cols-[16px_minmax(0,1fr)] gap-x-2">
                  <DownloadMenuIcon />
                  <span className="flex min-w-0 flex-col items-start gap-[3px]">
                    <b className="font-normal text-text">Download DXF</b>
                    <span className={MENU_NOTE}>
                      One superluminal_ layer, split by trade
                      {isVector ? ', in the drawing\u2019s own units' : ', in feet'}
                    </span>
                  </span>
                </span>
              </button>
              {/* PNG AND PDF FOLLOW THE VIEW. Night view is a deliverable in its
                  own right — a dark sheet with the fittings glowing on it is how
                  a scheme gets presented — so an export that quietly handed back
                  the day version would be overruling a choice that is visibly on
                  screen. `layers.invert` decides the plan's polarity AND the
                  ground together: either alone is the wrong sheet. */}
              <button type="button" className={MENU_ITEM} disabled={!source}
                onClick={async () => {
                  setShareMenu(false);
                  if (!await gateExport()) return;
                  download(`${exportBase}-lights.png`,
                    await svgToPNG(svgRef.current, source.w,
                      { asScanned: !layers.invert, ground: layers.invert ? '#000000' : '#fff' }));
                }}>
                <span className="grid w-full grid-cols-[16px_minmax(0,1fr)] gap-x-2">
                  <DownloadMenuIcon />
                  <span className="flex min-w-0 flex-col items-start gap-[3px]">
                    <b className="font-normal text-text">Download PNG</b>
                    <span className={MENU_NOTE}>
                      The sheet as you see it{layers.invert ? ', night view' : ''}
                    </span>
                  </span>
                </span>
              </button>
              {/* PDF IS PLOTTED FROM THE GEOMETRY, NOT PRINTED FROM THE SCREEN.
                  It went through the browser's print dialog for one revision and
                  the output was a photograph of a user interface: haloes, hover
                  states and selection frames all landed as ink. See pdfPlot.js. */}
              <button type="button" className={MENU_ITEM} disabled={!source}
                onClick={async () => {
                  setShareMenu(false);
                  if (!await gateExport()) return;
                  try {
                    /* THE BASE IS RE-RENDERED FROM THE ORIGINAL FILE at the
                       sheet's own resolution rather than reusing the editor's
                       2400px copy; that is the whole reason it is awaited
                       separately. */
                    const base = await nightSheetBase();
                    const out = await plotToPDF({
                      ...plotArgs,
                      file: initialFile, pageNo: pdfPage, title: exportBase,
                      night: darkSheet, base,
                    });
                    download(`${exportBase}-lights.pdf`, out.bytes, 'application/pdf');
                    milestone.current?.('export');
                  } catch (err) { console.error('[export] the plot failed', err); }
                }}>
                <span className="grid w-full grid-cols-[16px_minmax(0,1fr)] gap-x-2">
                  <DownloadMenuIcon />
                  <span className="flex min-w-0 flex-col items-start gap-[3px]">
                    <b className="font-normal text-text">Download PDF</b>
                    <span className={MENU_NOTE}>
                      {layers.invert
                        ? 'The presentation sheet, plotted as vector'
                        : 'The line plot, on its own sheet size'}
                    </span>
                  </span>
                </span>
              </button>
            </Popover>
          </>
        )}
        </div>
      </div>

      {/* --- THE PLAN'S APPEARANCE MOVED TO THE BOTTOM BAR -----------------
          IT WAS A WHITE PILL FLOATING OVER THE DRAWING, lower right, and every
          line of reasoning that put it there was about the two grounds it had to
          be legible against: the black page and a white scan. That is why it was
          opaque white with a hairline and a shadow rather than the glass the
          rest of this chrome wears.

          THERE IS A BAR ALONG THE FOOT OF THE STAGE NOW, and the pill's whole
          problem is somebody else's: the bar has its own ground, so the switch
          can be the same two glyphs in the same idiom as the two controls beside
          it. It also sits with them for a reason — day or night, which layers
          are drawn, and the model readings are three preferences ABOUT THE
          PICTURE, and they were in three different corners of the screen.

          The switch itself is unchanged in every way that matters: both sides
          always drawn, one always latched, so you can see which of the two you
          are in without having to remember what pressing it did. See the bar. */}

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

          THE SAME GATES THE PANEL'S TAB STRIP USED TO HAVE, less one — the
          strip is gone (see the note where it was) and these are the rail's own
          now. `doorEdit` and
          the wall step both take the pointer for a question about the DRAWING
          rather than about the design, and a palette live beside either is six
          ways to answer something else. Every other step — the zone, the board,
          the cove and the spot — keeps the rail, because in all four the rail is
          how you can see what is armed and how you put it away. */}
      {/* ALWAYS AN ELEMENT IN THIS TRACK, EVEN WITH NOTHING IN IT. The rail is
          the grid's first column and this is that column's only child: a child
          that is simply not rendered does not leave the track empty, it lets
          auto-placement put the NEXT child in it. The stage and the footer name
          their tracks explicitly now, which makes this belt and braces rather
          than the load-bearing thing it used to be — but an empty div in an
          `auto` track is zero wide, which is exactly what "no rail" should look
          like, and the same holds for the `auto` first ROW on a narrow screen. */}
      {!(source && !readOnly && !prep && !sheetOpen && step === 'plan'
        && !doorEdit && !wallEdit) ? (
        /* THE SAME SPAN AS THE RAIL IT STANDS IN FOR, so the two children below
           keep the tracks they name whether or not there is a rail. It is zero
           wide either way — the column is `auto` — so the span costs nothing and
           saves the next reader working out why one of the two cases places
           differently from the other. */
        <div aria-hidden="true" className="row-span-2
          [@media(max-width:960px)]:row-span-1" />
      ) : (
        /* --- ONE RAIL, DOWN THE LEFT EDGE, IN BOTH MODES -----------------
           IT WAS `orientation="top"` IN VERTICAL MODE — the same cells in a
           380px strip across the head of the column — and with it went a second
           set of behaviours: the flyouts opened DOWNWARD, the rail measured
           itself off the stage instead of sitting in the grid, and it had to be
           hidden every time a fixture bar wanted that strip, which is what took
           the light menu away mid-gesture. The rail is chrome on an edge that
           never scrolls; that is as true of the column as it is of the open
           canvas, and one rail with one set of behaviours is the whole point of
           the component. ToolRail's `top` branch is still there and unused.
           NO `stage` EITHER: it was only ever the box the top variant measured
           itself against. This is the call the open canvas makes. */
        <ToolRail
          tool={addTool} objArmed={armed} boardOn={boardPlace}
          disabled={!pxPerFt || !rooms.length}
          objDisabled={!pxPerFt}
          /* --- THE COB DRAWER -------------------------------------------
             THE CELL OPENS AND THE GESTURES INSIDE IT ARM, which is why this
             is one handler taking four messages rather than the rail's usual
             pair. `open`/`close` are the cell; a mode id or null is the
             drawer. See RailFlyout, and the Spots cell in ToolRail.
             THE ARRAY IS SHOWN AND NOT YET ANSWERED FOR. Its cell is in the
             drawer because the drawer is what says this fitting has two
             gestures, and a menu that grew a second item later would be a
             menu somebody had already learned the shape of. It is out of
             reach rather than absent, which is the honest picture of a
             gesture this build does not implement. */
          cobOpen={cobOpen} cobMode={cobMode} cobSoon={COB_SOON}
          onCob={(m) => {
            /* CLOSING THE DRAWER TAKES THE ARRAY'S GEOMETRY BAR WITH IT.
               That gesture raises one (see below) and `disarmAdd` does not
               reach it — a bar left standing for a tool that has been put down
               is a control over nothing. Guarded on the mode so closing the
               drawer never touches a cove bar somebody opened separately. */
            if (m === 'close') {
              if (cobMode === 'array') closeShapeTool();
              setCobOpen(false); setCobMode(null); disarmAdd(); return;
            }
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
               across, and `cobStanding` with them — see `reset.cobGesture`. */
            disarmAdd();
            setCobMode(m);
            /* THE DRAWER STAYS OPEN WHILE A GESTURE IS ARMED. It is the only
               thing on screen saying which of the two is live, and closing it
               on the press would take that away at the moment it starts
               mattering. */
            setAddTool(m ? 'cob' : null);
            /* --- AND THE ARRAY BRINGS THE GEOMETRY BAR WITH IT --------------
               AN ARRAY HAS TO HAVE A PATH, and the two ways of getting one are
               both the shape tool's — the same argument the magnetic track's
               cell makes a screen below. UNARMED, like the track's, so a cove
               or guide already on the drawing can still be pressed and taken
               (`takeableGeometry`); an armed primitive would own every press.
               AFTER `setAddTool`, because `openShapeTool` stands everything
               down on its way in and would otherwise disarm the gesture. */
            if (m === 'array') openShapeTool('guide', { arm: false });
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

             AND THE DRAWER OPENS ON A PRESSED RUN. Press a track on the drawing
             and the three modules appear beside the cell, which is where
             somebody has already learned a drawer lives. It stays up while one is
             armed, so clipping six diffusers on is six presses and not twelve.

             A PRESSED RUN AND NOT A SELECTED ONE, WHICH IS THE FIX. `selTrackId`
             is the selection — a track is a ceiling shape, so being selected is
             `selShapeId` naming one — and committing a shape SELECTS it, because
             that is how the geometry bar becomes the new object's contextual
             menu (see `commitShape`). So a drawer following the selection alone
             flew open the moment a run was drawn, over a profile the allocator
             had just filled and that nobody had asked to add anything to. What
             opens it is the act: hover the profile, see the plus, press it. See
             `trackAdd`, which is the one thing that press writes, and the note on
             `trackDrawer` in ToolRail for the flow this produces.
             READ AGAINST `selTrackId` RATHER THAN ALONE, so a selection moved
             anywhere else closes the drawer for free — including the rail cell's
             own press, which clears the selection on its way to opening the bar
             (see `openShapeTool`). */
          trackOn={geometryCommands.toolbar.trackOn}
          /* TWO MESSAGES, AND THE SECOND IS THE RAIL'S ONE-PANEL RULE REACHING
             OUT HERE. A bare press is the cell's own toggle; `'close'` is what
             the other four cells say on the way in, and it has to be GUARDED by
             `trackOn` because `toggleTrack` would otherwise OPEN the bar — a
             cell pressed to show the Electrical flyout would raise the track's
             geometry bar as a side effect. See `openOnly` in ToolRail. */
          onTrack={(m) => {
            if (m === 'close') {
              if (geometryCommands.toolbar.trackOn) geometryCommands.toolbar.toggleTrack();
              return;
            }
            geometryCommands.toolbar.toggleTrack();
          }}
          trackDrawer={(!!trackAdd && trackAdd === selTrackId) || addTool === 'module'}
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
            /* PUT THE PREVIOUS PLACER DOWN BEFORE ARMING THE MODULE. In
               particular this clears a manual COB wattage/beam override; a
               module picked after a run of COBs is the end of that arming, and
               returning to manual placement must ask the grid cell again. */
            disarmAdd();
            setAddTool(next ? 'module' : null);
            setTrackMode(next);
            /* AND THE BAR AT THE FOOT OF THE DRAWING OPENS ON THE MODULE'S OWN
               DEFAULTS, which is what makes it an answer before it is a
               question: the ordinary case is that you read two figures, agree,
               and press the run. `moduleWatts` is the family's figure and the
               beam is the product's optic — the same two the placement falls
               back to — so the bar and the press cannot come to disagree. See
               ModuleSpec, and `moduleDown` for where they are spent. */
            setModuleSpec(next
              ? { watts: moduleWatts(next), beam: MODULE_BY_ID[next]?.beam ?? null }
              : null);
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
          /* `zoneOn` AND `onZones` WENT WITH THE CELL. The No-Light Zone is
             retired — see the note at the top of ToolRail — and `openZoneEdit`,
             `zoneEdit` and the whole step behind them are untouched, so a plan
             that already carries zones still draws them and still has the layer
             switch to hide them. There is simply no longer a way to arm a new
             one. Putting the tool back is putting a cell in that flyout. */
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
            /* THIS IS ALSO A REAL DISARM, even though another hand-placement
               tool is armed immediately afterwards. The old inline clearing
               covered strip/cove points but missed the COB's standing wattage
               and beam, so using a sconce or spot between two manual COB runs
               carried the old override into the new run. `disarmAdd` owns the
               complete gesture boundary; the new tool is armed after it. */
            disarmAdd();
            setAddTool(t);
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
            /* THE LAYERS THE MARK AND ITS WIRE ARE ON COME ON WITH THE TOOL,
               which is what `openBoardPlace` does for the plate and for the same
               reason: a point dropped onto a sheet with these switched off lands
               invisibly and the gesture appears to have done nothing at all.
               BOTH OF THEM, AND THE SECOND ONE IS THE ONE THAT WAS MISSING. The
               symbol is on `switchboards`; the WIRE back to the plate its bay
               runs off is on `electrical`, which is OFF by default — so the
               point appeared and its connection did not, which reads as a
               fitting that failed to connect rather than one whose wire is
               hidden. Only for these two cells: every other one here drops a
               ceiling object, which is on a layer nobody turns off to place. */
            if (POINT_IDS.includes(id)) {
              docActions.setLayer('switchboards', true);
              docActions.setLayer('electrical', true);
            }
            setArmed(id);
            if (id) { setObjType(id); setObjMode(true); setZoneMode(false); }
            setGuides([]); setGhost(null);
          }} />
      )}

      {selectedFixtureAtTop && (
        /* --- CENTRED ON THE STAGE AND NOT ON THE WINDOW -------------------
           A GRID ITEM IN THE STAGE'S OWN CELL, which is what keeps this card,
           the analysis card, the canvas band and the two hairlines on one centre
           line. They were `absolute left-1/2` — the middle of the WINDOW — and
           that was the same thing only while the stage was the whole window;
           with the fixture rail back in the grid's first column the stage is
           86px narrower and everything measured off it moved 43px right of
           these. `justify-self-center` asks the layout instead of arithmetic, so
           it stays true whether or not the rail is drawn — and the rail comes
           and goes with the step, the viewer and the door editor. */
        /* --- A WINDOW OVER THE DRAWING, NOT A STRIP HUNG OFF THE CHROME ---
           IT WAS FLUSH WITH THE TOP BAR — square top corners, no top border,
           and the band's padding opening up underneath it to make room. Reading
           it as chrome is what made it push the sheet down. It is a WINDOW: it
           is about the fitting you just clicked, it lasts exactly as long as
           that selection, and a press anywhere on bare plan clears it (see
           `setSel(clear())` in `onCanvasClick`). So it floats clear of the top
           bar with all four corners rounded and its own shadow, and the drawing
           under it does not move.
           NO BACKDROP FILTER. The ground is opaque `--color-panel`, so the sheet
           behind it is either covered or untouched — nothing is blurred, which
           on a drawing would read as the plan itself going soft.
           NARROWER THAN THE COLUMN BY ITS OWN GUTTER, which is what makes it
           read as floating rather than as another panel: it was the column's
           full 380 and sat edge to edge with the hairlines, which is the one
           thing the two fixed panels do. `--lp-float-w` is the column less
           `--lp-col-pad` at each end — the same gutter the analysis card sets
           its own contents in by, so the window's sides line up with the type
           in the panel below it rather than merely being near it. */
        <div className="col-start-2 row-start-1 justify-self-center self-start
          [@media(max-width:960px)]:col-start-1 [@media(max-width:960px)]:row-start-2
          mt-[68px] z-30 h-[44px] w-[var(--lp-float-w)]
          overflow-hidden rounded-[11px] border border-border/10
          bg-panel shadow-[0_10px_34px_rgba(0,0,0,0.45)]"
          onPointerDown={(e) => e.stopPropagation()}>
          {/* ONE ROW, 44px, AND NOTHING ON IT THAT IS NOT A CONTROL — see
              FixtureSpec. It was a 109px card with the fitting's name and its
              lumen contribution on it; a bar in the dearest strip of a 9:16
              frame earns its height in presses, and a name is a caption for the
              thing ringed on the drawing right under it.
              `overflow-hidden` AND NEVER A SCROLLBAR. One row cannot overflow,
              and a scrollbar here would mean the bar was holding more than it
              can show — the state that put a fitting's wattage below the fold
              when this was the whole analysis panel. */}
            <div className="h-full overflow-hidden px-3">
              <FixtureSpec key={selectedFixtureRow.key} row={selectedFixtureRow}
                disabled={readOnly}
                onWatts={(w) => changeRowWatts(panelRoom, selectedFixtureRow, w)}
                onBeam={(d) => changeRowBeam(selectedFixtureRow, d)}
                /* THE SAME WRITE THE PANEL'S OWN EYE MAKES — see `setRowOff`,
                   which zeroes the fitting once in `analyseSpace` so the
                   readout, the heatmap and the drawing all follow from one
                   flag. */
                onToggleOff={(off) => setRowOff(panelRoom.id, selectedFixtureRow, off)} />
            </div>
        </div>
      )}

      <div ref={stageRef}
        className={'relative col-start-2 row-start-1 '
          + (verticalMode ? 'lp-stage-vertical ' : '')
          /* --- THE WAIT DOES NOT SCROLL, AND THAT IS A ONE-WORD FIX --------
             THE LOADER IS `absolute inset-0` INSIDE THIS BOX (see PlanLoader),
             so it is sized to the stage's VISIBLE area and pinned to the origin
             of its SCROLLABLE area — which are the same rectangle only while
             the scroll is at zero. The sheet behind it is the plan at full
             size, routinely two or three screens tall, so the stage had
             something to scroll and one flick of the wheel slid the entire wait
             up and off, leaving the drawing it was covering on show underneath.
             Nothing is lost by clipping instead: what overflows is the sheet,
             and the sheet is what the loader exists to cover. */
          + (prep || verticalMode ? 'overflow-hidden ' : 'overflow-auto ')
          + '[@media(max-width:960px)]:col-start-1 [@media(max-width:960px)]:row-start-2 '
          /* --- AND THE RE-CENTRING IS A GLIDE RATHER THAN A CUT -------------
             THIS IS THE JUMP. The right pad below swings between 18px and
             374px as the window opens and shuts, and the drawing is centred
             with `safe center` INSIDE the padding box — so every appearance of
             the window shunted the plan 178px sideways on a single frame.
             Nobody reads that as "a panel opened"; they read it as the drawing
             moving under them.
             SO IT IS TRANSITIONED, on the window's own curve and duration —
             see `.lp-window` — which is what makes the two read as ONE
             movement: the window comes in from the right and the sheet slides
             over to make room for it, together.
             PADDING AND NOT `transform`, which is the usual advice and is wrong
             here. The stage is the scroll container; transforming it would move
             its scrollbars and its clipping edge along with the plan. Padding
             is a relayout, but of ONE box — the SVG inside carries its own
             width and height, so nothing within it reflows and the cost is a
             composite of an already-painted layer.
             ...AND IT IS OFF FOR ANYBODY WHO ASKED FOR LESS MOVEMENT, the same
             answer the window gives. */
          + 'transition-[padding] duration-[220ms] ease-[cubic-bezier(.22,.61,.36,1)] '
          + 'motion-reduce:transition-none '
          /* --- THE DRAWING IS CENTRED IN WHAT THE WINDOW LEAVES ------------
             THE PLAN WAS CENTRED IN THE VIEWPORT AND THE WINDOW SAT ON TOP OF
             IT, which is the one thing a floating panel must not do: the corner
             of the sheet somebody is working on was under the readout about it.
             The panel used to be a grid TRACK, so the stage was already narrower
             than the screen by 340px and `safe center` centred inside what was
             left; taking the track away gave the drawing the whole width and
             took the allowance with it.
             SO THE ALLOWANCE COMES BACK AS PADDING. `safe center` centres within
             the padding box, so a right pad of the window's own width plus its
             margins puts the middle of the sheet in the middle of the space
             actually free — and unlike a track, padding costs nothing when the
             window is not there. 340 + 16 of margin + 18 of the stage's own
             gutter = 374.
             ONLY WHILE THE WINDOW IS UP, which is what `windowSpeaks` answers,
             and never below 960px where the window stops floating and goes
             underneath. */
          /* --- THE BAND IS THE GAP BETWEEN THE TWO PANELS, TO THE PIXEL ----
             IT WAS 194 AND 270 AND THE PANELS ARE AT 165 AND 242, which left a
             29px strip of the page's own black under the fixture card and a 28px
             one over the analysis card — two black bands across the column with
             nothing in them, and they cut the sheet off from the two panels it
             belongs between.
             SO THE PADDING IS THE PANELS' OWN EDGES, and it is arithmetic
             rather than a guess: the fixture card is `top-14` and 109 tall, so
             it ends at 165 from the top of the stage; the analysis card is
             `bottom-12` and 242 tall, and the stage's foot is that same 12 above
             the window's, so its top edge is 242 up from the stage's bottom.
             Change either card's height or offset and these two move with it. */
          /* --- THE BAND IS FIXED, AND WHAT SITS IN THE HEAD OF THE COLUMN
             FLOATS OVER IT ----------------------------------------------------
             `pt` SWUNG BETWEEN 56 AND 165 AS THE FIXTURE CARD CAME AND WENT,
             which resized the band and re-centred the sheet inside it: clicking
             a light pushed the whole drawing down. A card about a thing you just
             clicked must not move the thing you clicked. So the band runs from
             the top bar to the analysis card and stays there, and the card is a
             window over it — see the note where it is drawn.
             THE FOOT IS THE ANALYSIS CARD'S HEIGHT, AND IT IS THAT CARD'S OWN
             FIGURE. `--lp-analysis-h` is the readout plus `--lp-safe-foot` — the
             empty ground the column is recorded against — and both this padding
             and the card read it, so the band can never overlap the card or
             leave a strip of page between them. Tune the foot in styles.css. */
          + (verticalMode && source && !sheetOpen && !showPicker && !showTrace
            ? 'pt-14 px-[18px] pb-[var(--lp-analysis-h)] '
              + 'flex [justify-content:safe_center] items-center '
            : sheetOpen || showPicker || showTrace
            ? 'block pt-[68px] pl-[22px] pb-6 '
              + (windowSpeaks
                ? 'pr-[374px] [@media(max-width:960px)]:pr-[22px]' : 'pr-[22px]')
            : source
              ? 'pt-[68px] pl-[18px] pb-6 flex [justify-content:safe_center] items-start '
                + (windowSpeaks
                  ? 'pr-[374px] [@media(max-width:960px)]:pr-[18px]' : 'pr-[18px]')
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
            /* CONFIRMING THE OUTLINES, NOT RUNNING THE PIPELINE. The press
               that leaves this screen used to compute a whole design behind a
               minute-long checklist; it now takes the spaces up and opens the
               design screen at once, with the classifier and the bed re-check
               running behind it. See `confirmOutlines`, and the note at the
               command list above for what became of the old run. */
            onProceed={confirmOutlines}
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
            /* --- THE DOORS, ASKED ABOUT FIRST -----------------------------
               `doorsOk` is the document's own decision and is the SAME one the
               electrical layer is gated on, which is the whole point of asking
               it here: a plan whose doors were confirmed on this screen never
               gets asked again by the wiring switch, and "Modify doors" in the
               foot of the design screen stays as the way back into them. */
            doorsOk={doorsOk}
            /* NEVER THE CONFIRM-THE-DOORS STEP HERE ANY MORE, and passing
               nothing is how that step is switched off — see `idScreen` in
               OutlineTracer, where the prop IS the feature switch.

               IT BELONGS TO THE WIRING NOW. "Are these all the doors" is a
               question about SWITCHBOARDS, which most plans never reach, and it
               is asked the first time somebody turns the electricals on (see the
               door effect above). Leaving it here as well meant a plan whose
               scale could not be read landed on "Check the doors" — a review of
               a set nothing has used yet — instead of on the one question that
               actually blocks it: which door is the ruler.

               SO THE TWO LANDINGS ARE NOW EXACTLY TWO. Scale read off the
               drawing → the outlines. Scale not read → pick a door. */
            onConfirmDoors={null}
            /* ...AND DO NOT ASK WHILE THE ANSWER MAY STILL ARRIVE. A stated room
               size needs the segmenter's polygons, which land a beat after the
               plan does; putting the door step up in that gap and pulling it
               away again is worse than the wait. */
            scalePending={dimensions.pending}
            /* WHAT THE DRAWING SAID ABOUT ITSELF, IN ONE SENTENCE. Without it
               the two outcomes are indistinguishable on screen: a plan scaled
               off its own figures and one that fell through to the door step
               look the same until somebody is already answering a question they
               did not need to be asked — and when nothing could be read, the
               reason is the only thing that makes the door step make sense. */
            dimensionNote={dimensions.note}
            onAddDoor={addDoorBox}
            onMoveDoor={moveDoorBox}
            onDeleteDoor={deleteDoor}
            detectState={roomState}
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
            /* `min-h` IS THE FLOOR UNDER `h-full`. The band is the stage's
               height less 464px of padding, so a window short enough (or a
               pane dragged small enough) makes it zero — and a viewport of no
               height clips the drawing away entirely, which reads as the canvas
               having gone black. Below the floor it overflows into the padding
               the way it did before the band was a box, which is the honest
               degradation: the sheet is cramped, not absent. */
            + (verticalMode ? 'w-[380px] max-w-[380px] h-full min-h-[140px] ' : '')
            /* --- THE PAPER IS THE WHOLE BAND IN THE COLUMN ------------------
               THE CARD'S ROUNDING, BORDER AND SHADOW ARE WHAT PUT THE PAGE BACK
               AROUND IT. On the open canvas the sheet is a card floating on a
               dark page and all three say so; in the column the band runs from
               the fixture card to the analysis card with nothing either side of
               it, so a radius is four black corners and a shadow is a dark edge
               against the two panels it butts onto. Squared and full-bleed, the
               paper IS the band.
               NOTHING HERE WHEN THE PLAN IS INVERTED, which is the rule the note
               below states: that sheet's own ground is black, and the band's is
               the same black, so the two are already one surface. */
            + (layers.invert ? ''
              : verticalMode ? 'bg-white '
              : 'bg-white border border-border rounded-lg p-3 shadow')}>
            {/* VERTICAL MODE IS A VIEWPORT, NOT A SECOND CANVAS. The same
                PlanCanvas stays mounted with the same handlers and layers, but
                its paint is clipped at the shared 380px panel width. That keeps
                future canvas behaviour common to both modes while preventing a
                zoomed drawing from bleeding past either side of the vertical
                column. */}
            {/* --- ...AND A VIEWPORT IS THE THING A PAN SCROLLS ---------------
                IT CLIPPED AND DID NOT SCROLL, WHICH IS WHY THE DRAWING WOULD
                NOT MOVE. Panning on this screen is scrolling the box the
                drawing sits in — see `stageMouseDown`, which says why that is
                the whole implementation — and in vertical mode the box that
                clips is THIS one, not the stage: the stage is the full window
                and its only child is 380px wide, so it has nothing to scroll
                sideways however far in somebody zooms. A middle-drag wrote
                offsets to a container that was already at its end stops.
                SO IT IS THE SCROLLER, and `canvasBox` is what the pan and the
                wheel-zoom's anchor both reach for — see `scrollBox`. It is the
                box the shape bar is measured off as well, for the same reason
                said about position rather than about scrolling.
                `overflow-auto` RATHER THAN `hidden`, so the wheel, the keyboard
                and a trackpad keep working inside the column exactly as they do
                over the open canvas; the bars are hidden in CSS (see
                `.lp-canvas-viewport`) because a scrollbar down the middle of a
                380px reading column is chrome inside the picture.
                `h-full` ON BOTH BOXES is what gives it a viewport to be: the
                stage's padding already reserves the rail and the analysis card,
                so 100% of what is left is exactly the band the drawing is read
                in. Without a height the box grows to the drawing and clips
                nothing vertically. */}
            <div ref={setCanvasBox}
              className={verticalMode
                ? 'lp-canvas-viewport w-full max-w-full h-full min-h-[140px] overflow-auto'
                : 'contents'}>
            {/* THE CENTRING MOVED IN HERE, AND THE SIZING IS THE WHOLE POINT OF
                IT. A drawing centred in a box it OVERFLOWS puts half of that
                overflow off the start edge, where no amount of scrolling reaches
                it — `scrollLeft` does not go negative. That is the trap `safe
                center` answers for on the stage, and this answers it with
                geometry instead, which needs no alignment keyword to be
                supported: the box is `max-content` wide and never narrower than
                the viewport, so a small drawing is centred in the column and a
                zoomed one sits in a box exactly its own size — no offset to
                scroll back past. `min-h-full` says the same thing down the other
                axis, where a block box grows to its content on its own. */}
            <div className={verticalMode
              ? 'flex w-max min-w-full min-h-full items-center justify-center '
                + 'p-[var(--lp-canvas-room)]'
              : 'contents'}>
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
              /* --- AND THE REST OF THE SHEET GOES OUT BEHIND IT --------------
                 THE SAME RAW `focusId` THE BLUE OUTLINE TAKES, and it is the
                 same answer to the same question — which space did somebody
                 actually click — said at two strengths. The outline names it;
                 this puts everything else out so the named one is the only
                 thing left to read.

                 IT IS THE RAW ONE FOR THE REASON THE OUTLINE ABOVE IS. `focus`
                 falls back to `rooms[0]` so the details panel always has
                 something to describe, and a mask keyed on THAT would black out
                 seven eighths of every plan the moment it opened, with nobody
                 having clicked anything.

                 AND IT IS ALREADY THE WHOLE OF "WHEREVER THE CLICK CAME FROM",
                 which is why no new state was invented for it. `onCanvasClick`
                 writes the room under the press and null for the margin; the
                 first lamp of a COB run writes its space (see `cobLock`); the
                 first module of a run writes the run's room; `pickSpace` writes
                 the row that was clicked in the panel; and `standDown` writes
                 null, so Escape puts the sheet back. Every one of those is
                 already "the space this gesture is about", so a second flag
                 beside them could only ever disagree with them.

                 THE TWO STEPS THAT ALREADY DIM THE SHEET KEEP THEIR OWN
                 TREATMENT. `wash` is a designed pass with a reason of its own —
                 a scrim of the GROUND's colour, under our line work, so a cove
                 or a wall can be aimed at somebody else's scan — and stacking a
                 blackout on top of it would be two dimmers fighting over one
                 drawing. The condition is exactly the `wash` one below.

                 OFF FOR A VIEWER. The shared sheet is a drawing rather than an
                 editor: there is no rail and no Escape out there, so a stray
                 click that blacked out seven rooms would be a state with no
                 door. Same rule the pill and its two handlers take one screen
                 above. */
              isolateId={readOnly || stepTool?.id === 'cove' || wallEdit
                ? null : focusId}
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
              suggestPoints={suggestPointsPx}
              /* THE SPOT MID-AIM, CONVERTED HERE. The gesture is held in plan
                 FEET (see `spotAim`) because that is what the second click
                 stores; the canvas draws pixels. One multiplication, at the
                 boundary, exactly as every other hand-placed fitting crosses
                 it. */
              spotAiming={spotAim && pxPerFt
                ? { x: spotAim.xFt * pxPerFt, y: spotAim.yFt * pxPerFt,
                    angle: spotAim.aim }
                : null}
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
                /* AND A PLUS WHERE THE PRESS ADDS SOMETHING TO THE OBJECT
                   RATHER THAN TAKING IT. The array tool BORROWS the line it is
                   over — a hand is exactly right for that — and the module tool
                   CLIPS ONTO the run it is over, which is the same thing the
                   grab band says with `copy` when no tool is in hand. One
                   gesture, one pointer, whether or not a module is armed. */
                : geomHover ? (addTool === 'module' ? 'copy' : 'pointer')
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
                   run the `geomHover` branch above has already made it a plus. */
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
              accents={accentZonesPx} switchboards={switchboardsPx}
              elecPoints={elecPointsPx} selPointIds={selPointIds}
              onPointPointerDown={readOnly ? null : fixtureGestures.point.down}
              /* --- NO HOVER CARD IN THE READING COLUMN, AT THE SOURCE --------
                 WITHHELD HERE AS WELL AS AT THE RENDER, and the pair is
                 deliberate rather than belt-and-braces: with the handler gone
                 the canvas raises no tip at all in vertical mode, so there is
                 no state to be shown by any path — a second render of the card
                 added later, a `tip` read by something that is not the card.
                 See FixtureTip below for what the card costs in a 380px
                 column. */
              onFixture={verticalMode ? null : setTip}
              /* WHAT A FITTING ON THE SHEET IS RATED AT AND PUTS OUT, for its
                 hover card. A FUNCTION AND NOT A PAIR OF FIGURES, because the
                 answer is per space and per country — see `fittingOutput`
                 directly above `roomAt`. */
              fittingOutput={fittingOutput}
              /* --- THE HEATMAP, AS AN ELEMENT RATHER THAN AS DATA -----------
                 PlanCanvas TAKES THE PICTURE AND NOT THE FIELD, and that is the
                 direction the import rules already run in: a component does not
                 reach into a feature (see features/ceiling-geometry, which
                 imports from components and not the reverse). So the feature
                 renders its own overlay, App composes it, and the canvas's whole
                 involvement is knowing WHERE in the paint order it goes — over
                 the plan, under every mark we make. One slot, one prop.
                 `heatmapOn` IS SEPARATE AND IS NOT DERIVED FROM THE ELEMENT,
                 because it answers a different question: not "draw this" but
                 "stand the decorative washes down" — the throw pools and the
                 cove's ceiling fill, which are a second, cruder claim about the
                 same floor and would sit on top of this one.
                 `night` IS THE GROUND AND IT IS THE ONE THING THE FIELD TAKES
                 FROM THE VIEW. On the night sheet the drawing's ground is black,
                 and alpha over black multiplies — the cold half of the scale
                 vanished at the paper opacity. It changes how much ground shows
                 through and not one of the five colours; see the note on
                 `heatmapOpacity`. */
              heatmapLayer={<HeatmapOverlay heatmap={heatmap}
                night={canvasLayers.invert} />}
              heatmapOn={canvasLayers.heatmap}
              beamDiameterFtFor={beamDiameterFtFor}
              /* WHICH FITTINGS ARE SWITCHED OFF, as tests rather than as the
                 store — see `fittingOffTest`. The drawing is the third reader
                 of that fact: the readout and the heatmap both take it off the
                 lumen model, which already zeroes an off row. */
              fittingOff={lightingAnalysis.fittingOff}
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
              flowGrab={(flowDrag?.kind === 'board' || flowDrag?.kind === 'node')
                && flowDrag.moved
                ? { id: flowDrag.id, kind: flowDrag.kind, key: flowDrag.key,
                    at: flowDrag.at, overId: flowDrag.overId } : null}
              /* CUTTING A WIRE DETACHES THE FITTING IT RAN TO: `null` is the
                 stored word for "switched on its own, straight off the plate",
                 and it is a WRITE rather than a delete. Deleting the entry is a
                 different act with a different meaning — it puts the fitting
                 back under the rules — and the two must not share a button.
                 Off on the read-only sheet with everything else that edits. */
              onFlowUnlink={readOnly ? null : ((id) => docActions.setFlowLink(id, null))}
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
              /* --- AND THE ROOM'S OWN OUTLINE, WHILE THE BAR IS OPEN -------
                 A SPACE IS A GEOMETRY TOO, and the bar that a space click
                 already raises is the thing that can set a line out from it:
                 press the perimeter, choose Inside and a distance, press the
                 tick, and what commits is the room's own outline moved in by
                 that much — as a guide, a cove or a magnetic track, whichever
                 role the bar is open in. See `roomOutlineDown`.
                 THE SAME CONDITION `canTakeGeometry` USES FOR A SHAPE, said
                 about a room: the bar OPEN and no primitive armed. With one
                 armed the press is a drag that draws, and with the bar shut
                 there is nothing for a borrowed outline to be offered to — a
                 press near a wall then means what it always meant, which is why
                 the band is not even rendered. `penEmpty` because a click
                 mid-path is a corner and not a press anything else may take. */
              onRoomOutlineDown={readOnly || !geometry.status.menuOn
                || geometry.status.tool || !geometry.status.penEmpty
                ? null
                : (e, roomId) => {
                  const room = rooms.find((r) => r.id === roomId);
                  if (room) geometryPointer.roomOutlineDown(e, room);
                }}
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
              selArrayIds={readOnly ? [] : selArrayIds}
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
              selCobIds={readOnly ? [] : selCobIds}
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
            </div>
            </div>
            {/* --- ...AND THE ONE TOOLTIP THIS APP DRAWS ITSELF --------------
                NOT A `title`, SO THE SWEEP CANNOT REACH IT. `useNoTooltips`
                takes the browser's own boxes off; this is a 260x150 frosted
                card of our own, raised on hover over any fitting — which is
                two thirds of the width of the reading column and most of the
                height of the band, landing on the drawing beside the thing it
                describes. On the open canvas it has the page to sit on.
                GATED AT THE RENDER AND NOT AT THE HOVER. `tip` is written by
                half a dozen pointer handlers across the canvas and the fittings
                feature; withholding it here is one line, where withholding it
                there is six and a seventh the next time a fitting gets a hover.
                A null card costs a render of nothing. */}
            <FixtureTip tip={verticalMode ? null : tip} />
            {/* ...AND ANY TIP LEFT STANDING FROM BEFORE THE SWITCH GOES WITH
                IT. `onFixture` above stops new ones; a card already up when
                somebody pressed Vertical Mode would otherwise sit there with
                nothing to clear it, since the handler that used to is gone. */}
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
                TWO HANDLERS NOW, AND THERE WERE FOUR. The slider and the chips
                used to write a DRAFT that governed nothing until one of two
                buttons promoted it — "Update this" or "Update all next" — which
                was one question too many: a change made on a bar you opened in
                order to make it is not ambiguous. They write the standing choice
                straight through, and the chip clears it back to the engine's
                answer. See CobSpec, where those two buttons stood. */}
            {/* `!geometry.bar.mode` IS THE ONE-BAR-AT-A-TIME RULE, and it is the
                array's whole flow. That gesture raises the geometry bar in the
                guide role, and the two stand in the same place at the foot of
                the stage; the shape bar wins while it is up for the reason
                `moduleBarOn` gives — it is about the DRAWING, and this one is
                about the next press. Committing the guide closes it, and this
                bar takes the position back carrying a path to ask about.
                IT COSTS THE MANUAL GESTURE NOTHING. With a tool armed the shape
                bar's `edit` state is withheld (`otherBar` in `shapeBarMode`),
                so `geometry.bar.mode` is null unless something opened it. */}
            {!readOnly && addTool === 'cob' && !geometry.bar.mode && (
              <CobSpec key={cobMode} stage={barBox} lead={autoLead}
                placement={barPlace} watts={cobShow.watts} beam={cobShow.beam}
                recommended={!cobStanding}
                /* THE MODE IS ALSO THE EDITOR'S LIFETIME, hence the key. React
                   otherwise preserves CobSpec's local `specOpen` while a
                   batched manual-to-array switch replaces the props in place;
                   returning to Manual would then reopen directly on controls
                   even though the command and its override had been reset. */
                /* STRAIGHT THROUGH, AND `cobInForce` IS THE BASE. A change here
                   is the choice from the next lamp on, which is what the second
                   of the two retired buttons used to mean and the only one of
                   the two that survived contact with the gesture — see CobSpec.
                   Based on what is in force rather than on nothing, so setting
                   a wattage does not silently take the optic back to the
                   engine's answer for wherever the pointer happens to be. */
                onWatts={(w) => setCobStanding((d) => ({ ...(d ?? cobInForce),
                                                         watts: clampWatts(w) }))}
                onBeam={(b) => setCobStanding((d) => ({ ...(d ?? cobInForce),
                                                        beam: nearestBeam(b) }))}
                onRecommended={() => setCobStanding(null)}
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
                /* THE TICK, AND IT HANDS IN WHAT THE BAR IS SHOWING. The
                   draft's own wattage was seeded when the PATH was chosen and
                   the two controls beside this write the COB spec stack, so
                   the draft goes stale the moment somebody sets a wattage
                   after picking a geometry — see `placeArray`. App is the only
                   thing holding both halves.
                   ...AND THE GEOMETRY BAR COMES BACK. The tool stays armed and
                   the draft is cleared, so the next array wants the next path;
                   without this the gesture would be live with no way to make
                   one, which is the state this whole flow removed. Ringing
                   four rooms is four draws and no trip to the rail. */
                onPlaceArray={() => {
                  placeArray({ watts: cobShow.watts, beam: cobShow.beam });
                  openShapeTool('guide', { arm: false });
                }} />
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
              <CobSpec stage={barBox} lead={autoLead} placement={barPlace}
                watts={selArrayBar.watts} beam={selArrayBar.beam}
                array={selArrayBar.array}
                onWatts={(w) => setArraySpec(selArrayId, { watts: w })}
                onBeam={(b) => setArraySpec(selArrayId, { beam: b })}
                onCount={(n) => setArrayShape(selArrayId, { count: n })}
                onSide={(id) => setArrayShape(selArrayId, { side: id })}
                onOffset={(ft) => setArrayShape(selArrayId, { offsetFt: ft })}
                onDeleteArray={() => deleteArray(selArrayId)} />
            )}
            {/* --- AND THE SAME BAR, ABOUT THE NEXT MODULE ON A RUN ----------
                THE SPECIFICATION HAS TO BE ON SCREEN AT THE MOMENT OF CLIPPING,
                which is CobSpec's argument and is why this is the same object in
                the same place — see ModuleSpec for why it is not that component
                with three more flags on it.
                IT IS THE LAST STEP OF THE TRACK'S OWN FLOW: draw the run and the
                allocator fills it, hover the profile and the pointer turns into a
                plus, press it and the modules arrive beside the rail cell, pick
                one and this says what the next press will clip in. */}
            {moduleBarOn && (
              <ModuleSpec stage={barBox} lead={autoLead} placement={barPlace}
                label={MODULE_BY_ID[trackMode]?.label ?? 'Module'}
                watts={moduleSpec.watts} wattList={moduleWattList(trackMode)}
                beam={moduleSpec.beam}
                onWatts={(w) => setModuleSpec((d) => ({ ...d, watts: w }))}
                onBeam={(b) => setModuleSpec((d) => ({ ...d, beam: b }))} />
            )}
            {/* THE PLAIN BAR, WHEN NO EDITING CONTROL CLAIMS ITS POSITION.
                `autoLead` is the complete content now: the electrical layer
                toggle has left this floating context bar. */}
            {/* --- AND THE FAN'S, WHICH IS ITS ONE PROPERTY -----------------
                A SWEEP IS A FOOT AND A HALF OF DIAMETER EITHER WAY, so it is a
                decision made while the fan is in hand and not a row in a panel
                behind a drawer — the journey the downlight's wattage and the
                module's both made. `fanBarOn` carries the two tenses and the
                one-bar-at-a-time rule; see it, and FanSpec's header for why the
                Design column no longer holds a second copy of this. */}
            {fanBarOn && (
              <FanSpec stage={barBox} lead={autoLead} placement={barPlace}
                sweepMm={fanBarSweep} onSweep={setFanSweep} />
            )}
            {/* --- THE POINT'S TWO PROPERTIES, WHILE IT IS IN HAND ----------
                THE SAME BAR AND THE SAME TWO TENSES FanSpec HAS: armed, it says
                what the next point will be; with points selected it says what
                THEY are and changes them. The height row is drawn only for a
                wall point — a ceiling point is at ceiling level and there is
                nothing else it could be at. See PointSpec. */}
            {/* --- HOW THE SPLIT UNIT IS FED, WHILE IT IS IN HAND -----------
                THE BAR THAT WOULD HAVE HELD A ROTATION. A wall unit takes its
                angle from the plaster it lands on, so there is nothing to turn
                and nothing to correct after a placement — what is left to decide
                is the supply, and that is what stands here. Two tenses, like the
                fan's and the point's: armed it says what the next unit will get,
                selected it says what this one has. See AcSpec. */}
            {!readOnly && acBarOn && autoLead && (
              <AcSpec stage={barBox} lead={autoLead} placement={barPlace}
                label={CEILING_BY_ID[selAc?.typeId ?? armed]?.label ?? 'Split AC'}
                feed={acBar.feed} amps={acBar.amps} ratings={acRatings(acCountry)}
                /* BOTH WRITE THROUGH THE UNIT AND NOT THROUGH THE FITTING ON
                   THE WALL. Swapping the feed has to move the mark and carry
                   the rating across, which is two stores and four writes; the
                   bar states the decision and `useAcFeed` spends it.
                   AND NEITHER DOES ANYTHING WITH THE TOOL MERELY ARMED. There
                   is no unit to write to yet, and the bar is showing the
                   defaults the next one will be born with — which are not
                   stored, and so cannot be edited into disagreeing with
                   themselves. Same rule the point bar's two writes follow. */
                onFeed={(f) => selAc && acFeed.setFeed(selAc, f)}
                onAmps={(a) => selAc && acFeed.setAmps(selAc, a)} />
            )}
            {!readOnly && pointBarOn && autoLead && (
              <PointSpec stage={barBox} lead={autoLead} placement={barPlace}
                onWall={pointBar.onWall} heightMm={pointBar.heightMm}
                /* THE RESOLVED COUNTRY AND NOT App's OWN `country` PROP,
                   which is an ISO code or a name — a STRING, with no
                   `switchRatings` on it, so this read `undefined` and the bar
                   offered nothing but Auto. `sbCountry` is the table entry the
                   electrical feature already resolved, and it is what every
                   other rating control on this screen reads. */
                amps={pointBar.amps} ratings={sbCountry.switchRatings}
                onHeight={setPointHeight} onAmps={setPointAmps} />
            )}
            {/* `!fanBarOn` joins the other ownership gates so a tool and the
                plain layout controls never stack in the same position. */}
            {!(!readOnly && (addTool === 'cob' || selArrayBar || geometry.bar.mode))
              && !moduleBarOn && !fanBarOn && !acBarOn && !pointBarOn && autoLead && (
              <StageBar stage={barBox} lead={autoLead} placement={barPlace}
                label="Drawing" />
            )}
            {/* --- THE HEATMAP'S KEY ----------------------------------------
                OUTSIDE THE BAR'S OWN CONDITION, because it is not part of the
                bar: the bar is one row at the bottom CENTRE of the stage and is
                replaced wholesale every time a tool claims it, and the key has
                to survive that — a scale is unreadable without its legend
                whether or not somebody happens to be drawing a cove at the time.
                It measures off the same stage and sits at its bottom RIGHT, clear
                of the bar. It draws nothing while the layer is off. */}
            <HeatmapLegend heatmap={heatmap} stage={stageRef} />
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
            {!readOnly && geometry.bar.mode && !selectedFixtureAtTop && (
              /* --- AND IT STANDS AT THE FOOT OF THE DRAWING, NOT OF THE WINDOW
                 THE BOX IT IS MEASURED OFF IS THE WHOLE OF THE FIX. Every bar
                 here is fixed to the bottom centre of whatever it is handed (see
                 StageBar), and in vertical mode the stage is the entire window:
                 its last inch is under the analysis card, so this bar — the one
                 contextual bar that does not move to the head of the column, for
                 the reason given at `selectedFixtureAtTop` — came up over the
                 readings instead of over the ceiling it is editing. The canvas
                 band is the box that IS the drawing there, and it is already
                 measured for the pan; handing it over puts the bar back on the
                 sheet, clear of the card, with no second position invented for
                 it. */
              <ShapeMenu stage={barBox} lead={autoLead} placement={barPlace}
                mode={geometry.bar.mode}
                /* THE RUN'S OWN WATTAGE, WHERE THE ANALYSIS HAS ONE FOR IT —
                   see `selShapeRow`, and the note on `wattage` in ShapeMenu for
                   why a lighting figure belongs on the geometry bar. */
                wattage={selShapeRow && selShapeRow.wattOptions?.length > 1
                  ? { watts: selShapeRow.watts, options: selShapeRow.wattOptions,
                      unit: selShapeRow.unit }
                  : null}
                onWatts={(w) => changeRowWatts(panelRoom, selShapeRow, w)}
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
                  ? { id: geometry.shapes.selected.id,
                      ft: geometry.shapes.selected.radiusFt || 0,
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
                onRadius={(ft) => {
                  const id = geometry.shapes.selected?.id;
                  /* A RADIUS INVALIDATES THE WHOLE CEILING PLAN. The slider
                     already collapses a drag to one commit in ShapeMenu; make
                     that one rebuild non-urgent as well, so releasing its thumb
                     and painting its final value are never held behind layout. */
                  if (id) startTransition(() => docActions.patchShape(id, { radiusFt: ft }));
                }}
                /* NO `onDuplicate` AND NO `onDelete`. The bar is what the
                   selected object IS; both of those were acts on the document
                   sitting beside its specification — see the note where they
                   were drawn, in ShapeMenu. Delete and Backspace still take a
                   selected shape off the drawing. */ />
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
      {/* --- THE BAR ALONG THE FOOT OF THE STAGE ---------------------------
          WHAT IS TRUE OF THIS DRAWING, AND HOW YOU ARE LOOKING AT IT. Two kinds
          of thing, at the two ends, and neither of them is a decision about the
          design:

            LEFT   the standing readings — how many doors were found, what is on
                   the sheet, and whether it adds up to enough light. Facts, in
                   the place facts go.
            RIGHT  the preferences — which layers are drawn, day or night, and
                   the model readings. Three controls that were in three
                   different corners of the screen.

          IT REPLACES THE PANEL'S FOOTER AND THREE OF ITS SECTIONS. The readings
          were pinned to the bottom of a 340px column, the View disclosure was
          two thirds of the way down its scroller, and Admin was a tab. All four
          are about the whole plan rather than about the thing you have selected,
          which is exactly what the floating window is for — so they came out of
          it, and the window is now only ever about one space or one plate.

          A GRID ROW AND NOT SOMETHING ABSOLUTE OVER THE DRAWING, which is the
          one structural thing to get right: the stage is a scroll container, and
          chrome floating in front of its own last inch is chrome you cannot
          scroll out from under.

          BLACK, AND THE RAIL BESIDE IT IS NOT. The rail is `--color-chrome`
          #2F2F2F and this is the drawing's own black — so the two dark surfaces
          on this screen are deliberately different, and the hairline along the
          top is what gives this one its edge where the rail gets one from tone.
          It is the reading that decides it: the rail is a column of TOOLS, a
          thing you reach into, and it earns a surface of its own; this bar is
          facts about the sheet and preferences about the picture, which belong
          to the sheet and sit on its ground.

          NOT ON THE UPLOAD SCREEN, and not while the pipeline runs. There is no
          drawing to report on or to set a preference about, and a bar full of
          controls that cannot do what they claim is worse than no bar.

          AND NOT ON THE OUTLINE SCREEN. Every cell in it was already gated off
          there one at a time — the door count, the View popover, the day/night
          switch — because none of them is about a plan that has not been lit
          yet, which left an empty 48px strip along the foot of the drawing. The
          gate belongs on the bar, not on each of its children. */}
      {source && !prep && !showTrace && (
        <div className="col-start-2 row-start-2
          [@media(max-width:960px)]:col-start-1 [@media(max-width:960px)]:row-start-3
          h-12 flex-none flex items-center gap-4 px-4 z-[5]
          bg-black border-t border-border/10">

          {/* --- THE STANDING READINGS -----------------------------------
              THE SAME 11px AS EACH OTHER, deliberately: these are two readings
              of one drawing, and a heavier one would claim to be the more
              important of the two. TABULAR FIGURES, like every number that
              changes in place — this face's proportional `1` is half the width
              of its `0`, so a count going 9 → 10 → 11 would shuffle the words
              after it. */}
          {/* `text-subtle` DOWN THIS ROW, WHICH THE BLACK GROUND BUYS BACK.
              #7A7A7A is 4.6:1 on black and about 2.4:1 on the rail's #2F2F2F —
              so while this bar was that grey the readings had to be lifted a
              step to #A8A8A8. They are back on the quieter ink, which is the
              right weight for a standing reading nobody is looking straight
              at. See the note on the two chrome tones in styles.css. */}
          <div className="flex items-center gap-4 min-w-0 text-[11px] leading-none">
            {/* THE DOORS, AND THE WAY BACK INTO THEM. Every switchboard is
                placed beside a door — see electrical.js — so this count is the
                one number that says how sound the wiring is, and "Modify doors"
                is the way to change it. Not in the viewer: an operator reading
                somebody else's sheet has no door to modify, and a count with no
                question attached to it is a fact in a corner that carries
                none. */}
            {!readOnly && !showTrace && (
              <span className="flex items-center gap-2 whitespace-nowrap">
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
              </span>
            )}
            {/* --- WHAT IS ON THE DRAWING, AND WHAT IT IS OWED ---------------
                THE WHOLE PLAN'S TARGET, AND IT IS THE SPACE WINDOW'S OWN MODEL.
                It used to be lm/sqft of FLOOR against `lumenCriteriaFor`, which
                is what the grid was laid to. That model has a rival now — the
                window judges each room on its SURFACES, its finishes and its
                height (see lib/lumens.js) — and two figures on one drawing is
                not two readings, it is one reading and an argument. So this sums
                the window: same arithmetic, same constants, every room added up.
                THERE IS NO VERDICT ANY MORE, and there was one: this line read
                "N of M lm" with a tick over the target and a dash under it. The
                achieved half of that comparison is gone from the model (see the
                note at the end of `analyseSpace`), and a tick with nothing
                behind it would be the app congratulating itself on a plan it has
                not measured. What is left is the requirement. */}
            {rooms.length > 0 && (() => {
              const want = Math.round(planLumens.required);
              const n = (v) => v.toLocaleString('en-US');
              const bits = [
                // HIDDEN AT ZERO, all three, which was the footer's own rule and
                // stays it: a line that spends a third of its width saying a
                // thing is absent is harder to read for nothing.
                totals.lights > 0
                  ? `${totals.lights} light${totals.lights === 1 ? '' : 's'}` : null,
                spotsPlaced > 0 ? `${spotsPlaced} spot${spotsPlaced === 1 ? '' : 's'}` : null,
                stripRuns > 0 ? `${stripRuns} strip${stripRuns === 1 ? '' : 's'}` : null,
              ].filter(Boolean);
              return (
                <span className="flex items-center gap-3 min-w-0 whitespace-nowrap">
                  {bits.length > 0 && (
                    <span className="text-subtle tabular-nums overflow-hidden
                      text-ellipsis">{bits.join(', ')}</span>
                  )}
                  <span className="inline-flex items-baseline gap-1 tabular-nums
                    text-subtle">
                    {n(want)} lm required
                  </span>
                </span>
              );
            })()}
          </div>

          <div className="flex-1" />

          {verticalMode && (
            <>
              <FooterSwitch label="Heatmap" on={layers.heatmap}
                onClick={toggle('heatmap')} />
              <FooterSwitch label="Electrical" on={layers.electrical}
                onClick={toggle('electrical')} />
            </>
          )}

          {isAdmin && !sheetOpen && !showTrace && (
            <FooterSwitch label="Vertical Mode" on={verticalMode}
              onClick={toggleVerticalMode} />
          )}

          {/* --- ADMIN, AND IT IS A PANEL FOR A DIFFERENT AUDIENCE ---------
              ROLE 1 IN `profiles` — an owner of this app rather than a user of
              it. It exposes what the models DECIDED, which is what you need when
              a spot lands somewhere surprising and what must never appear on a
              sheet a client sees.
              IT WAS A TAB, and a tab is a poor answer for two hundred lines of
              readings nobody else can see: it took a quarter of the panel's
              navigation to say a thing that is invisible to almost everybody
              looking at it. Behind a button in the bar it costs one word, and
              only for the people who have it.
              FIRST OF THE THREE, which puts the ordinary controls nearest the
              corner somebody reaches for. */}
          {isAdmin && (
            <>
              <PopoverButton innerRef={adminRef} open={adminMenu} side="top"
                label="Admin" title="What the models decided"
                onClick={() => setAdminMenu((v) => !v)} />
              <Popover anchor={adminRef} open={adminMenu} side="top" align="end"
                width={320} label="Admin — model readings"
                onClose={() => setAdminMenu(false)}>
                <div className="px-3">
              <>
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
          </>
                </div>
              </Popover>
            </>
          )}

          {/* --- VIEW: WHAT IS DRAWN, AND HOW BIG ------------------------
              EVERY CONTROL IN HERE IS A PREFERENCE ABOUT THE PICTURE rather
              than a decision about the design, which is what it always was —
              the change is that it is no longer two thirds of the way down a
              scroller, under the controls that ARE decisions.
              A POPOVER AND NOT A `<details>`, which is the one thing lost in
              the move: the browser owned that disclosure's open/closed,
              keyboard and screen-reader behaviour. `Popover` is what took the
              job over, once, for all four of the chrome's panels — see the note
              there on why reimplementing it four times is how one gets it
              wrong. */}
          <PopoverButton innerRef={viewRef} open={viewMenu} side="top"
            label="View" title="Which layers are drawn, and how big"
            onClick={() => setViewMenu((v) => !v)} />
          <Popover anchor={viewRef} open={viewMenu} side="top" align="end"
            width={244} label="View" onClose={() => setViewMenu(false)}>
            {/* THE BUTTONS ZOOM ABOUT THE MIDDLE OF WHAT IS ON SCREEN, not
                about the drawing's origin. Stepping the number alone kept the
                top-left corner still, which means the thing you were looking at
                slid off the bottom-right every time you pressed +. The wheel
                anchors on the pointer for the same reason; there is no pointer
                on a button, so the centre of the viewport is the honest
                substitute. */}
            <div className="px-3 pb-1">
              <div className={BTNROW}>
                <button className={BTN} title="Zoom out (−)"
                  onClick={() => zoomBy(1 / 1.2, stageCentre())}>−</button>
                <button className={BTN} title="Actual size (0)"
                  onClick={() => zoomTo(1, stageCentre())}>{Math.round(zoom * 100)}%</button>
                <button className={BTN} title="Zoom in (+)"
                  onClick={() => zoomBy(1.2, stageCentre())}>+</button>
                <button className={BTN} title="Fit the plan to the window (F)"
                  onClick={() => zoomTo(fitZoom())}>Fit</button>
              </div>
              <p className={`${N} mt-1.5 mb-0`}>
                Scroll to zoom, middle-drag to pan. <b>F</b> fits, <b>0</b> is
                actual size.
              </p>
            </div>
            <div className="h-px bg-border/15 my-2 mx-3" aria-hidden="true" />
            {/* NO TOGGLE FOR A THING THAT IS NO LONGER DRAWN. The ambient grid,
                the task-surface boxes and the secondary grid came off the
                canvas, and a checkbox that turns on nothing is worse than no
                checkbox: it is a promise the drawing does not keep. `zones`
                stays, because hand-drawn no-light zones are still on the plan
                and are still worth being able to hide while looking at the
                layout under one — the tool that made them is retired, the ones
                already drawn are not. */}
            {/* `suggestGrid` IS NOT IN THIS LIST, AND THAT IS DELIBERATE. It is
                the one layer with a switch of its own on the bar over the
                drawing (see `autoLead`), beside the electrical toggle it is the
                pair to, and a second tick for it in here would be the same
                state said twice in two idioms a screen apart — which is how a
                checkbox and a capsule come to look like they disagree.
                `autoLights` IS IN IT, AND IT USED TO BE THE OTHER CAPSULE. It
                came off the bar when the suggestion took that position — see
                `autoLead` — and a layer with no control at all would have been
                the wrong way to demote it: it is off by default now, but a plan
                saved while it was on still opens with placed fittings, and the
                only other way to clear those is `lights`, which takes the
                hand-placed ones with them. Directly under its own master, which
                is what the indent of the pair would say if this list had one. */}
            <div className="px-3 pb-0.5">
              {[['plan', 'Floor plan'], ['dim', 'Fade the plan'], ['region', 'Space outline'],
                ['cells', 'Cell shading'], ['lights', 'Lights'],
                ['autoLights', 'Auto-placed lights'], ['labels', 'Light tags'],
                ['beamAngles', 'Beam angles'],
                ['fan', 'Ceiling objects'], ['zones', 'No-light zones'],
                ['accents', 'Accent lighting'], ['spots', 'Directional spots'],
                ['switchboards', 'Switchboards'],
                ['electrical', 'Electrical lines']].map(([k, l]) => (
                <label className={CHECK} key={k}>
                  <input className="lp-check" type="checkbox"
                    checked={layers[k]} onChange={toggle(k)} />{l}</label>
              ))}
            </div>
          </Popover>

          {/* --- DAY OR NIGHT, AND BOTH SIDES ARE ALWAYS DRAWN -------------
              A TWO-SIDED SWITCH, NOT A BUTTON. Sun is the scan as it arrived,
              moon inverts it — a white plan with black lines becomes a black
              plan with white ones. One side is always latched, which is what
              makes it a switch rather than a button with a hidden state: you can
              see which of the two you are in without having to remember what
              pressing it did.
              THE OPAQUE WHITE PILL IS GONE AND SO IS ITS REASON. Floating over
              the drawing this had to be legible against the black page AND
              against a white scan, which bought it a solid ground, a hairline
              and a shadow. In the bar it has the bar's ground, so it is the same
              glass as the two controls beside it, and the live side is picked out
              in white the way "current" is said everywhere else in this chrome.
              IT IS OFFERED ON A DXF TOO. The old reason not to was sound and has
              been dealt with: a DXF has no bitmap to subtract from 255, and a
              CSS filter over one would invert OUR OWN ink — but PlanCanvas no
              longer needs a filter, it takes the line work's greys from the
              ground, so a vector plan has a real night mode now.
              NOT OVER A SHEET OF PAPER. The schedule and the switchboard sheet
              are not the drawing, and inverting them is not a thing this switch
              can do. */}
          {!sheetOpen && !showTrace && (
            <div className="flex items-center gap-2 flex-none">
              <span className="text-[11.5px] leading-none text-faint select-none">Mode</span>
              {/* QUIETER THAN IT WAS, because the bar under it went black. A
                  10%-white capsule on 5%-white glass is a chip; on black it is
                  the brightest object in the corner, which is not what a
                  preference is worth. */}
              {/* THE CAPSULE IS BARELY THERE AND THE LIVE SIDE IS NOT. On
                  black, 6% white is enough to say "these two are one control"
                  and a solid white chip inside it would be the brightest object
                  in the corner of the screen — which is not what a preference
                  about the picture is worth. The step between 6% and 18% is what
                  says which side you are on. */}
              <div className="flex gap-0.5 p-[2px] rounded-md bg-white/[0.06]
                border border-border/15" role="group" aria-label="Plan appearance">
                {[[true, 'Invert the plan — black plan, white lines',
                   /* Heroicons `moon`, outline. */
                   'M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75'
                   + ' 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21'
                   + ' 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z'],
                  [false, 'Show the plan as scanned',
                   /* Heroicons `sun`, outline. */
                   'M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591'
                   + 'M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636'
                   + 'M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z']].map(([on, label, d]) => {
                  const live = layers.invert === on;
                  return (
                    <button key={String(on)} type="button"
                      className={'appearance-none border-0 cursor-pointer '
                        + 'px-2 py-1 rounded inline-flex items-center justify-center '
                        + 'leading-[0] transition-colors duration-[120ms] '
                        + 'focus-visible:outline-2 focus-visible:outline-accent '
                        + 'focus-visible:outline-offset-1 '
                        /* QUIET, NOT ABSENT. The side you are not in still has
                           to be findable — it is half the switch — so it is the
                           bar's own muted ink and goes white on hover. */
                        /* EXACTLY ONE BACKGROUND CLASS EITHER WAY — see the
                           note on the rail's cells for the emission-order trap
                           that makes two a bug rather than a redundancy. */
                        + (live
                          ? 'bg-white/[0.18] text-white'
                          : 'bg-transparent text-subtle hover:text-white')}
                      aria-pressed={live} title={label}
                      onClick={() => docActions.setLayer('invert', on)}>
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none"
                        stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
                        strokeLinejoin="round" aria-hidden="true">
                        <path d={d} />
                      </svg>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- THE FLOATING WINDOW, OVER THE DRAWING'S TOP-RIGHT CORNER -------
          IT WAS A 340px COLUMN AND IT IS A WINDOW NOW. The column was a grid
          track: it took a fifth of the width of the one thing this app is for,
          permanently, on every screen, whether or not anything in it applied.
          Most of the time nothing did — its four tabs, its header of file
          formats and its footer of whole-plan readings have all gone somewhere
          they belong, and what is left is the answer to a gesture: the space you
          clicked, or the plate you clicked.

          SO IT TAKES NO LAYOUT AT ALL. `absolute` over the stage rather than a
          track beside it, which means the drawing is the full width of the
          screen and this sits in the corner of it — and when there is nothing
          selected there is nothing in the corner.

          IT IS NOT INSIDE THE STAGE, WHICH IS THE ONE THING TO GET RIGHT. The
          stage is the scroll container; an absolutely positioned child of it
          would scroll away with the plan, and a window you have to scroll back
          to find is not pinned chrome. It is a child of the shell, measured off
          the shell's own edges — the top bar's height and the bottom bar's — so
          it cannot drift out of the gap between them.

          THE CHROME'S OWN GREY AND A REAL SHADOW, WHICH THE COLUMN DID NOT
          NEED. Against the page's own graph paper a `border-l` and 5% white were
          enough, because the column WAS the edge. Floating over a drawing it has
          to say it is in front of one — so it is opaque, and the shadow is what
          lifts it off the sheet. `--color-panel` AND NOT `--color-chrome`, which
          is the one thing here that is arithmetic rather than taste: this window
          is dense muted type, and that scale is written for a near-black ground.
          The note on the two tokens carries the figures. No border: the tone
          against black is the edge, and a hairline on top of that is a line
          nobody can see.

          ITS HEIGHT IS ITS CONTENT'S, UP TO THE GAP IT HAS. `max-height` and not
          `height`: a space's readings are six lines and its fitting list is
          forty, and a window that was always as tall as the tallest thing it
          might hold would be an empty box over the plan most of the time.
          IT SURVIVES THE SCHEDULE AND NOT THE SWITCHBOARD SHEET, which is not
          an inconsistency: the window is about whatever is ON the stage, and a
          schedule has three things to do with it — Excel, CSV, PDF. It is the
          only place those live. The switchboard sheet has nothing: every plate
          on it is edited on the sheet, where its height is a box you type in, so
          the window would be an empty box over a drawing you cannot act on. */}
      {/* --- IT IS ALWAYS MOUNTED NOW, AND THAT IS THE FIX FOR THE JUMP ------
          THIS WAS `{windowSpeaks && <div>}`, and a thing that is not in the DOM
          cannot animate out of it: the window appeared and vanished on the
          frame, which is half of what somebody means by "the screen jumps". So
          the state is an ATTRIBUTE and CSS moves it — see `.lp-window`.

          THE OTHER HALF OF THE JUMP WAS NOT THIS ELEMENT AT ALL, and it is
          worth saying plainly because it is the surprising one: the STAGE
          carries `pr-[374px]` while the window is up, and the drawing is
          centred with `safe center` INSIDE that padding. So opening the window
          re-centred the plan by 178px on the frame it appeared. The padding
          still changes — the allowance is the whole reason the sheet is not
          under the window — but it is transitioned now, on the same curve and
          the same 220ms as the slide, so the drawing glides across instead of
          cutting. See the stage's own note.

          THE ALLOWANCE FOLLOWS OPEN AND SHUT, NEVER THE DRAG. Once this window
          has been carried somewhere the reserved gutter is in the wrong place,
          and the honest fix looks worse than the dishonest one: re-computing it
          from the window's position would slide the entire drawing sideways
          under the hand that is dragging, forty times a second. A gutter that
          is briefly reserved for nothing is a cosmetic cost; a plan that swims
          while you move a panel is not. */}
      <div ref={panelDrag.ref}
        data-open={windowSpeaks ? 'true' : 'false'}
        data-carry={panelDrag.dragging ? 'true' : 'false'}
        /* WHERE IT WAS CARRIED TO, HANDED TO CSS AS TWO NUMBERS. The shut state
           needs to compose its own `translateX` on top of these, and a
           `transform` written here would overwrite that one outright — so the
           offset arrives as custom properties and `.lp-window` owns the
           declaration. */
        style={{ '--lp-win-x': `${panelDrag.offset.x}px`,
                 '--lp-win-y': `${panelDrag.offset.y}px` }}
        /* NOT FOCUSABLE AND NOT A DIALOG. It is a readout that follows the
           selection, not something you are answering — so while it is shut it
           has to be out of reach as well as out of sight. It is parked off the
           side of the screen and still in the document, and a window like that
           is exactly the one somebody Tabs into and cannot see.
           BOTH ATTRIBUTES, AND THEY ARE NOT THE SAME PROMISE. `aria-hidden`
           takes it out of the accessibility tree; `inert` takes its controls
           out of the tab order and stops them being clicked. `aria-hidden`
           alone over focusable content is the classic version of this bug.
           AN EMPTY STRING AND NOT `true`, because this is React 18: `inert` is
           not in its known-boolean list, so a boolean renders as the string
           "true" with a console warning, while "" renders the bare attribute.
           `undefined` removes it. */
        aria-hidden={windowSpeaks ? undefined : true}
        inert={windowSpeaks ? undefined : ''}
        className={verticalMode
          /* THE SAME GRID CELL THE FIXTURE CARD TAKES, and centred the same
             way — see the note there. `self-end` puts its foot on the stage's
             own bottom edge, which is the footer's top: exactly where
             `bottom-12` had it, without a figure that has to be kept in step
             with the footer's height. */
          /* --- 442 IS 242 OF READOUT AND 200 OF DELIBERATE NOTHING --------
             THE FOOT OF THIS CARD IS A SAFE ZONE. The column is recorded for a
             feed that draws its own controls over the bottom of the frame, so
             the last 200px carry the card's ground and no content: the readout
             and its verdict stay above the line anything covers. The body is
             top-aligned inside it (see the Lumens wrapper in SpaceDetail), so
             the space is simply what is left over rather than a spacer element.
             THE STAGE'S `pb` READS THE SAME PROPERTY, so the band and the card
             cannot drift apart. Both are `--lp-analysis-h` in styles.css. */
          ? 'col-start-2 row-start-1 justify-self-center self-end '
            + '[@media(max-width:960px)]:col-start-1 '
            + '[@media(max-width:960px)]:row-start-2 '
            + 'z-[4] h-[var(--lp-analysis-h)] w-[380px] rounded-t-[11px] bg-panel '
            + 'shadow-[0_-8px_30px_rgba(0,0,0,0.42)] '
            + 'flex flex-col min-h-0 overflow-hidden '
            + (windowSpeaks ? '' : 'hidden ')
          : 'lp-window absolute top-[68px] right-4 w-[340px] z-[4] '
            + 'max-h-[calc(100%-68px-72px)] '
            + 'rounded-lg bg-panel '
            + 'shadow-[0_10px_34px_rgba(0,0,0,0.55)] '
            + 'flex flex-col min-h-0 overflow-hidden '
            + '[@media(max-width:960px)]:static [@media(max-width:960px)]:w-auto '
            + '[@media(max-width:960px)]:max-h-none [@media(max-width:960px)]:rounded-none '}>
        {/* --- THE GRIP, AND IT IS THE ONLY PART THAT PICKS THE WINDOW UP ---
            A WINDOW YOU CAN DRAG BY ITS BODY IS A WINDOW THAT MOVES WHEN
            SOMEBODY MEANT TO SELECT A READING IN IT. Forty rows of analysis,
            a wattage slider, a list of fittings — every one of those is a
            press target, and a body-drag would fight all of them. So the
            gesture lives on a strip of its own, and the strip does nothing
            else.

            THE DOTS ARE THE WHOLE LABEL. Six of them in two rows is the one
            mark that reads as "carry this" without a word next to it, which is
            the point: a caption saying so would be chrome explaining chrome.

            DOUBLE-CLICK PUTS IT BACK. The clamp in usePanelDrag already
            guarantees the window cannot be lost off an edge, but "reachable"
            and "where it belongs" are different promises, and the second one
            costs one handler. Only offered once it has actually been moved. */}
        <div {...panelDrag.grip}
          onDoubleClick={panelDrag.moved ? panelDrag.home : undefined}
          className={'flex-none flex items-center justify-center h-6 '
            + 'select-none touch-none '
            + (verticalMode ? 'hidden ' : '[@media(max-width:960px)]:hidden ')
            + (panelDrag.dragging ? 'cursor-grabbing' : 'cursor-grab')}>
          <svg width="26" height="8" viewBox="0 0 26 8" aria-hidden="true"
            className={'transition-opacity duration-150 '
              + (panelDrag.dragging ? 'opacity-70' : 'opacity-35')}>
            {[0, 1].map((row) => [0, 1, 2].map((col) => (
              <circle key={`${row}-${col}`} r="1.4" fill="var(--color-text)"
                cx={4 + col * 9} cy={2.6 + row * 3.4} />
            )))}
          </svg>
        </div>
        {/* --- THE HEADER WENT TO THE TOP BAR ---------------------------
            THREE FILE FORMATS AND A SHARE BUTTON, in a row across the head of
            this panel. They are one act — this drawing, going somewhere else —
            and they are about the DOCUMENT rather than about the space in front
            of you, which is all this window holds now. They are the Share
            dropdown in the top bar; see the note there on why the formats are
            inside the act rather than beside it. */}
        {/* --- THE FOUR TABS ARE GONE, AND NOTHING REPLACED THEM DIRECTLY --
            SPACES / DESIGN / BOARDS / BOQ / ADMIN was one strip answering two
            different questions, which is why it could be removed rather than
            moved. Two of the five were SCENES — the schedule and the switchboard
            sheet both take the whole stage — and those are the scene buttons on
            the bar over the drawing, where "which drawing am I looking at"
            belongs. Admin is a panel in the bottom bar, for the audience it is
            for. And the remaining two were never a choice: Spaces held the room
            you had clicked and Design held the controls for the thing you had
            selected, so which one you wanted was already decided by what was
            selected on the drawing.

            SO THIS WINDOW IS DRIVEN BY THE SELECTION AND NOT BY A TAB. Click a
            room and it is that room; click a plate and it is that plate; turn on
            the electrical scene and it is that room's plates. A tab strip over
            that would be a control that could disagree with the drawing. */}
        {/* `pb-4` AND NOT `pb-10`. The column's ten was clearance above a
            pinned footer that is no longer under it; a window sized to its own
            content would render the extra as an inch of empty glass. */}
        {/* `--lp-col-pad` AND NOT A LITERAL 26: the floating light window is
            inset by this same figure (see `--lp-float-w`), so the two cannot
            drift into looking almost-aligned. */}
        {holdPanelBody(() => (
        <div className={'flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 '
          + (verticalMode ? 'px-[var(--lp-col-pad)] py-[18px]' : 'px-4 py-4')}>
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
        {/* THE BOQ PANEL HAS ONE JOB. Every other section here is a control over
            the drawing — arm a fan, recompute the accents, toggle a layer — and
            not one of them means anything while a schedule is on screen. A panel
            full of controls that act on something you cannot see is worse than
            an empty one, so it collapses to the three things there are to do
            with a schedule: Excel, CSV, PDF. The way out is the BOQ button in
            the top bar, latched, which is also the way in. */}
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
            {/* "← BACK TO THE DRAWING" WAS HERE. The BOQ button in the top bar
                is the same act, said once, latched, in the place that also says
                where you are. A button at the foot of a panel whose only job is
                to leave it was the second answer. */}
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
                download(`${exportBase}-lights.dxf`,
                  toSuperluminalDXF(dxfArgs), 'application/dxf');
                return;
              }
              // The same sheet the editor prints, and the same view rule — one
              // implementation, so an operator's PDF and an owner's cannot come
              // out differently.
              if (kind === 'pdf') {
                nightSheetBase()
                  .then((base) => plotToPDF({
                    ...plotArgs,
                    file: initialFile, pageNo: pdfPage, title: exportBase,
                    night: darkSheet, base,
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
          /* --- ...AND IN THE COLUMN IT IS THE SAME STEP, HALF THE HEIGHT ---
             IT SCROLLED, WHICH A STEP MUST NOT. This card is a title, a drawing
             of the gesture, a sentence, sometimes a refusal and one or two
             buttons — about 320px of it — and the analysis card it sits in is
             267px of content in the vertical column. A step you have to scroll
             to reach the way out of is a step people get stuck in, which is the
             one thing this shape exists to prevent.
             THE DRAWING IS WHAT GOES. It is the instruction on the open canvas,
             where the panel has a column's worth of room for it — and it is the
             tallest thing here by a factor of three. The sentence under it says
             the same thing in words and is the half that still fits, so the
             column keeps the words and the buttons. Everything else just
             tightens: 17px to 13, `py-6` to `py-2`, `gap-4` to `gap-2`. */
          <div className={`${SEC} flex-1 flex flex-col min-h-0`}>
            <div className={'flex-1 flex flex-col items-center justify-center '
              + 'text-center px-1 '
              + (verticalMode ? 'gap-2 py-2' : 'gap-4 py-6')}>
              <p className={'m-0 tracking-[-0.02em] text-white max-w-[22ch] '
                + (verticalMode
                  ? 'text-[13px] leading-[1.3]' : 'text-[17px] leading-[1.35]')}>
                {geometry.panel.coveDraw.title}
              </p>

              <div className={'flex flex-col items-center gap-2 text-center '
                + 'border border-border rounded-[10px] bg-input-bg '
                + (verticalMode ? 'px-3 py-2' : 'px-4 pt-3.5 pb-3')}>
                {!verticalMode && geometry.panel.coveDraw.art}
                <p className={'m-0 text-muted max-w-[30ch] '
                  + (verticalMode
                    ? 'text-[10.5px] leading-[1.4]' : 'text-[11px] leading-[1.5]')}>
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

              {/* WHY A GESTURE WAS REFUSED, and it belongs to the cove. A slot
                  an inch long is something a person can reasonably try and it
                  has a real reason it cannot be done. Angled walls are valid:
                  the slot follows the outline edge at whatever angle it runs.
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
          {/* --- ONE SPACE, AND THERE IS NO LIST BEHIND IT ANY MORE --------
              THE LIST OF SPACES WAS THE OTHER HALF OF THIS BRANCH and it is
              gone. It was a column of every room on the plan with its type, its
              size and its area — a second way to select a space, in words,
              beside a drawing that shows all of it: the rooms are ON the plan,
              they are labelled, and clicking one is how anybody actually picks
              one. The list's own two extra buttons went with it — "Trace" is
              the "Space outlines" link in the top bar, and "Take up all N
              outlines" is what the tracer's own Proceed does on the step that
              owns that decision.
              SO THE WINDOW IS ABOUT A SELECTION OR IT IS NOT THERE. With no
              room picked there is nothing to say about one, and `windowSpeaks`
              is what stops an empty card floating in the corner of the plan. */}
          {!elecScene && panelRoom && (
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
              key={panelRoom.id}
              vertical={verticalMode}
              name={panelRoom.outline.name || 'Space'}
              meta={[
                roomTypes[panelRoom.id]
                  ? roomTypeIn(projectId, roomTypes[panelRoom.id].type)?.label ?? 'Other'
                  : null,
                `${ftin(panelRoom.stats.widthFt)} × ${ftin(panelRoom.stats.heightFt)}`,
                `${Math.round(panelRoom.stats.areaSqft)} sqft`,
              ].filter(Boolean).join(' · ')}
              disabled={readOnly}
              ceilingMm={ceilingMmFor(panelRoom.id)}
              onCeilingMm={(v) => setCeilingMmFor(panelRoom.id, v)}
              materials={materialsOf(materials, panelRoom.id)}
              wallLabel={wallMixLabel(roomWallMix)} wallTone={panelWallTone}
              onAllWallsTone={(tone) => panelRoom.geo.polygonFt.forEach((_, edge) =>
                setWallTone(panelRoom.id, edge, tone))}
              /* `materialsLabel`, `editing`, `onEdit` AND `onDone` WENT WITH
                 THE FOLD. The finishes were a one-line summary you pressed to
                 open, and opening them replaced the analysis; the window shows
                 both at once now — see the note in SpaceDetail on why. So there
                 is nothing to summarise and nothing to be done with.
                 THE SUMMARY WENT WITH THEM — `materialsSummary` in
                 lib/materials.js has no caller now, and it is left there rather
                 than deleted because it is the one place that knows how to say
                 "Default" versus what actually differs. */
              onTone={(surface, tone) => setSurfaceTone(panelRoom.id, surface, tone)}
              /* RENAMING A SPACE MARKS NOTHING DIRTY, which is `updateOutline`'s
                 own rule and the reason it is safe to offer here: `rectify`
                 moves corners and costs a relight, a better name does not. */
              onRename={readOnly ? null
                : (next) => updateOutline(panelRoom.id, { name: next })}
              onConfigureWalls={() => openWallEdit(panelRoom.id)}
              analysis={spaceAnalysis(panelRoom)}
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
              /* FIVE STORES NOW, AND A DECORATIVE FITTING IS THE NEW ONE. A
                 chandelier, a pendant and a standing lamp are CEILING OBJECTS,
                 and each is its own row keyed by its own id — see the note in
                 `fixtureGroups` on why they stopped sharing one. So the wattage
                 is written onto the OBJECT, beside its diameter, exactly as a
                 hand-placed COB's is written onto the lamp.
                 ASKED BEFORE `wattRange`, which is what used to catch it: both
                 carry a slider, and a row that reached `setCobSpec` would be a
                 patch aimed at a list this fitting is not in — a silent no-op,
                 and a slider that moved and changed nothing. */
              onWatts={(row, w) => changeRowWatts(panelRoom, row, w)}
              /* SWITCHED OFF, AND IT NEEDS NONE OF THE FAN-OUT ABOVE. A
                 wattage has to reach whichever list the fitting actually lives
                 in — the module, the array, the object, the lamp — because that
                 is where the figure is stored. Being switched off is not a
                 property of the fitting at all: it is the ROOM's record of which
                 of its rows are dark, keyed exactly as its wattage overrides
                 are, so there is one door for every family. */
              onToggleOff={(row, off) => setRowOff(panelRoom.id, row, off)}
              onBeam={changeRowBeam}
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
              autoplace={lighting.status.autoplaceOn(panelRoom.id)}
              onAutoplace={readOnly ? null
                : (on) => lighting.commands.setAutoplace(panelRoom.id, on)} />
          )}

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
          {/* --- THE CONTROLS FOR WHATEVER IS SELECTED -------------------
              NO LONGER BEHIND A TAB, and the tab was never a choice: every
              section below is gated on something being armed or selected, so
              "Design" was a tab you had to be on for the answer to a gesture you
              had just made to appear. See the note where the strip used to
              be. */}
          <>
          {/* --- EVERY PLATE IN THIS SPACE, WHILE THE WIRING IS ON SCREEN ---
              THE WINDOW SWAPS WITH THE SCENE. On the lighting drawing this
              column is a space's lumens and the fittings that make them; on the
              electrical drawing neither of those means anything, and what you
              want in front of you is the plates on that room's walls. See
              `elecScene`.
              IT IS THE SHEET'S OWN GROUPING, READ FOR ONE ROOM. `boardSheet` is
              every plate on the job grouped by space and ordered by module count
              — see buildBoardSheet, which explains why size and not name — and
              this takes the group for the space in front of you rather than
              re-deriving it. Two orderings of one list is how the panel and the
              sheet come to disagree about what SB7 is.
              A ROW IS A WAY IN AND NOT A READING. Pressing one selects that
              plate, which is the same act as pressing it on the drawing and
              raises the same card below — so the two ways of picking a board
              cannot disagree about which is canonical.
              AND THE WAY TO ALL OF THEM IS AT THE FOOT. "Show all boards" is the
              switchboard sheet, which takes the whole stage: the plates of every
              room at once, which is what an electrician orders from. */}
          {elecScene && !readOnly && (() => {
            const mine = openRoom
              ? boardSheet.find((g) => g.roomId === openRoom.id) : null;
            return (
              <div className={SEC}>
                <h3 className={H3}>
                  Switchboards{openRoom ? '' : ' · this plan'}
                </h3>
                {!openRoom ? (
                  /* NOTHING IS SELECTED, so there is no room to list the plates
                     of. Saying which spaces have them would be the sheet, in a
                     300px window; saying "click a space" is the one useful
                     thing. */
                  <p className={`${N} mt-0.5`}>
                    Click a space to see the boards on its walls.
                  </p>
                ) : !mine ? (
                  <p className={`${N} mt-0.5`}>
                    No switchboard in this space yet.
                  </p>
                ) : mine.plates.map((q) => (
                  <button key={q.id} type="button"
                    className={'w-full flex items-baseline justify-between gap-2 '
                      + 'text-left px-2 -mx-2 py-[5px] rounded border-0 '
                      + 'cursor-pointer text-[11.5px] leading-[1.4] '
                      + 'transition-colors duration-[120ms] '
                      + 'focus-visible:outline-2 focus-visible:outline-accent '
                      + 'focus-visible:outline-offset-1 '
                      + (selBoardId === q.id
                        ? 'bg-white/10 text-white' : 'bg-transparent text-text hover:bg-white/5')}
                    onClick={() => setSel(select('board', q.id))}>
                    <span className="truncate">{q.name}</span>
                    <span className="flex-none text-[10.5px] text-subtle tabular-nums">
                      {q.modules} mod · {q.heightMm} mm
                    </span>
                  </button>
                ))}
                <button type="button" className={`${BTN_FULL} mt-2.5`}
                  onClick={() => docActions.setView('boards')}>
                  Show all boards →
                </button>
              </div>
            );
          })()}
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
          {/* --- THE TWO "CLEAR EVERYTHING PLACED BY HAND" BUTTONS ARE GONE --
              THEY WERE A SECOND WAY TO DELETE, AND A WORSE ONE. Every fitting on
              this drawing can be pressed and deleted where it sits — that is
              what the selection and the Backspace key are for, and it is the
              only way that lets somebody remove the one they meant. A button
              reading "Clear the 3 placed by hand" removes three things to get rid
              of one, and it is not even a category anybody thinks in: "placed by
              hand" is a fact about how a cove came to exist, not about whether it
              is still wanted.
              WHAT THEY REALLY WERE is an escape hatch from a build where a
              hand-placed fitting was hard to find and select on the drawing. It
              is not any more — a press frames it with handles — so the hatch is
              a button whose only remaining use is the mistake it makes easy.
              `docActions.clearCoves`, `clearAccents` AND `clearSurfaces` ARE
              UNTOUCHED on the document; nothing in the chrome calls them now.
              WHAT SURVIVES IS THE ONE THING IN HERE THAT WAS NOT A BUTTON: a
              plan with no lit space cannot take a fitting at all, and that is
              worth saying before somebody arms a tool and clicks into nothing. */}
          {!rooms.length && (
            <div className={SEC}>
              <p className={NOTE_WARN}>
                Light a space first — a fitting has to belong to one.
              </p>
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
          {/* THE PALETTE IS IN THE RAIL NOW — see ToolRail — and the one
              PROPERTY it carried underneath, a fan's sweep, HAS FOLLOWED THE
              TOOL TO THE STAGE BAR. See FanSpec. It was the last thing in this
              block, and it was in the wrong place for the reason the six
              buttons above it were: a fan's sweep is a foot and a half of
              diameter either way, and a decision that size is made while you
              are choosing where the fan goes — not in a column on the other
              side of the screen, behind a drawer that is shut while you place
              it. THERE IS NO SECOND COPY OF IT HERE, deliberately: two controls
              for one decision is exactly what retired the "AC or trap door"
              chips that used to stand below.
              WHAT IS LEFT IS THE TWO WARNINGS, which are not controls — one
              says the drawing has no scale yet and the other says what the
              armed tool is waiting for.
              THE HEADING WENT WITH THE PALETTE, for the reason the Lighting one
              did: it named a row of tools that is no longer here. */}
          {(!pxPerFt || !!armed) && (
          <div className={SEC}>
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

          </>

          {/* --- ADMIN IS A PANEL IN THE BOTTOM BAR NOW --------------------
              ROLE 1 IN `profiles` — an owner of this app rather than a user of
              it — so it was filed last in this column, behind a tab, on the
              reasoning that it is not part of anybody's workflow. That was the
              right instinct and a tab was the wrong answer: two hundred lines
              of readings, invisible to almost everybody, taking a fifth of this
              panel's navigation to say so.
              It also does not belong here for the reason the footer did not.
              Every reading in it is about the whole plan and the passes that
              built it, and this window is about one space. See the bottom
              bar. */}
          </>}
        </>}
        </>
        )}
        </div>
        ))}

        {/* --- THE FOOTER IS THE BAR ALONG THE FOOT OF THE STAGE NOW ------
            IT HELD THREE THINGS AND ALL THREE WERE ABOUT THE WHOLE PLAN: the
            "Show electrical layout" switch, the door count with its way back
            into the door step, and the plan's own lumen reading. This window is
            about ONE THING — the space you clicked, or the plate you clicked —
            and it appears and disappears with that thing, so a footer pinned
            under it was three whole-plan facts hanging off a panel about a
            room.
            THE ELECTRICAL SWITCH NOW LIVES IN VIEW, not on the floating context
            bar. The Electrical rail tool still turns the layer on when its
            workflow needs it; removing the duplicate from the bar changes no
            drawing or saved preference.
            THE OTHER TWO ARE IN THE BOTTOM BAR, on the left, where the standing
            readings go. */}
      </div>
    </div>
  );
}
