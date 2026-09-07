import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import PlanCanvas from './components/PlanCanvas.jsx';
import ChunkPicker from './components/ChunkPicker.jsx';
import OutlineTracer from './components/OutlineTracer.jsx';
import { parseDXF, UNITS, classifyLayers } from './lib/dxf.js';
import { vectorSource, rasterSource } from './lib/planSource.js';
import { makeOutline, nextOutlineName, regionFromOutline, outlineStats } from './lib/outline.js';
import { PLAN_OPTIONS, FITTING_LUMENS, WALL_WEIGHT_IN, OTHER_STROKE_PX,
         SIMPLIFY_ROOM_TO_RECTANGLE, lumenCriteriaFor,
         /* `THROW_STYLE` WAS IMPORTED HERE — the accent ramp, handed to the
            chunking icon in the spaces list. The icon went with the accordion
            (see AUTO_GRID and the note in that list), and the ramp had no other
            reader in this file. */
       } from './lib/settings.js';
import { planLights, withTargetArea, cellKey, centreBandBox,
         clampLightMove } from './lib/planner.js';
/* enumerateChunkings AND findChunking ARE GONE FROM THIS FILE. Both existed to
   run and resolve a second enumeration of the chunkings, on a different room
   from the one the drawing used — see the note in the rooms memo. There is one
   enumeration now and `designChunking` owns it. */
import { designChunking, planCeilingDesign, chunkKey, nextChunkOption }
         from './lib/ceilingDesign.js';
import { STRIP_OFFSET_FT, coveHostFor, bandBetween, bandFixtureFor, COVE_GAP_FT,
         coveClearOfOutline } from './lib/cove.js';
import { absorbPoints, planDrawnTrack, drawnTrackRefusal,
         TRACK_REFUSALS, SPOT_LEN_FT, DODGE_FT } from './lib/track.js';
import usePen from './hooks/usePen.js';
import { penSegments, penLengthFt, penRelock, penMovePoint, penAim, axisLock,
         MIN_SEG_FT } from './lib/pen.js';
import { newHistory, record, stepBack, stepForward, historyDepth,
         QUIET_MS } from './lib/undo.js';
import { NONE, select, selectMany, clear, idOf, idsOf } from './lib/selection.js';
import { bbox, pointInPolygon, maxInset } from './lib/geometry.js';
import { REFERENCES, scaleFromReference } from './lib/scale.js';
import { detectDoors, doorsFromPayload, scaleFromDoor, openingPx, DOOR_WIDTHS } from './lib/doors.js';
import { proposeOutlines } from './lib/outlineSources.js';
import { detectFurniture, detectBeds, detectionsToZones, zonesFromDetections, snapshotForDetection, rectCentre, iou, dedupe, downscaleForDetection, plausibleBed, ZONE_CLASSES, PROVIDERS, DEFAULT_PROVIDER, wireProvider } from './lib/furniture.js';
import { download, toJSON, toSuperluminalDXF, svgToPNG } from './lib/exporters.js';
import { plotToPDF, nightBase } from './lib/pdfPlot.js';
import { LIGHT_TOOLS, GESTURE } from './components/LightPalette.jsx';
import { Logo } from './components/Wordmark.jsx';
import ShapeMenu, { SHAPE_GESTURE } from './components/ShapeMenu.jsx';
import { SHAPE_BY_ID, POLY_SIDES, shapeFromDrag, penShape, sealShape, clampCoveMove,
         outlineFt as shapeOutlineFt, cornersFt as shapeCornersFt,
         hitShape, coveRectFt, pathLengthFt,
         isOpen as shapeIsOpen, roleOf as shapeRoleOf,
         isTrack as shapeIsTrack, isBuilt as shapeIsBuilt, insetShape,
         canTakeGeometry,
         spanOnOutline, penSpansOutline, runLengthFt,
         lineShape, projectOnOutline,
         bigEnough, maxRadiusFt, roundable, newShapeId, bboxFt as shapeBboxFt,
         MIN_SPAN_FT as SHAPE_MIN_SPAN_FT,
         resizeShape, handlesFor, frameFt as shapeFrameFt,
         sizeLabel as shapeSizeLabel } from './lib/ceilingShapes.js';
import ProjectTypeDialog from './components/ProjectTypeDialog.jsx';
import PlanLoader from './components/PlanLoader.jsx';
import ViewerPanel from './components/ViewerPanel.jsx';
import BOQView from './components/BOQView.jsx';
import { buildBOQ, FIXTURE_BY_ID, trackFixtureFor } from './lib/boq.js';
import { boqToCSV, boqToXLSX, boqToPDF, CSV_BOM } from './lib/boqExport.js';
import { PROJECT_BY_ID, roomTypeIn, wantsAccents, wantsSpots, expectsBed, isOutdoor, targetAreaFor, fixtureForCell } from './lib/roomTypes.js';
import FixtureTip from './components/FixtureTip.jsx';
import CobSpec from './components/CobSpec.jsx';
/* THE DOWNLIGHT SOMEBODY PUTS DOWN THEMSELVES. Every rule about one — what it
   may be specified at, what the gridding engine would have installed where the
   pointer is, and the two things worth warning about before the click — is in
   lib/cob.js, and this file does the placing. See its header. */
import { recommendCob, placeCob, newCobId, chunkSpec, wallClearance, bedUnder,
         clampWatts, nearestBeam, throwDiameterFt, DEFAULT_DROP_FT,
         COB_WATT_RANGE, arraySpots, arrayPath, arrayAsks, ARRAY_SIDES,
         arrayQuanta, quantiseCount } from './lib/cob.js';
/* THE MAGNETIC TRACK. Its RUN is a ceiling shape with `role: 'track'` — which
   is why there is no store of paths here and why it resizes, duplicates and
   snaps like everything else in the geometry library — and this file holds the
   modules that clip into one. See its header for why it is not track.js. */
import { MODULE_BY_ID, MODULE_SOON, moduleAt, uAt, moduleWatts,
         moduleLenIn,
         placeableU, placeModule, newModuleId,
         planDiffusers } from './lib/magTrack.js';
import OptionCoach from './components/OptionCoach.jsx';
/* The walkthrough, playing in the panel rather than linked out of it. Named
   export: the default one is the line of type that opens it in a dialog. */
import { HowToVideo } from './components/HowToLink.jsx';
import { SURFACE_BY_ID } from './lib/taskSurfaces.js';
import { planTaskSpots, chunkFor, isBedZone,
         SPOT_DEFAULTS } from './lib/taskSpots.js';
import { roomSnapshot, requestAccents, toPlanRect } from './lib/accentMask.js';
import { BED_SOURCES, splitByProvider, label as labelBeds, bedsIn, contestFor, judgeNote,
         applyVerdict } from './lib/bedFit.js';
import { TYPE_BY_ID, FURNITURE_BY_ID } from './lib/accentPrompt.js';
import { WALL_BY_ID, joinPlacements } from './lib/wallPrompt.js';
import { gridFor, anchorLines, cellsToPlanPx, cellsToRect } from './lib/wallGrid.js';
import { fitAll, RENDER_DEFAULTS, renderBlob, renderRef, fetchRender }
  from './lib/renderImage.js';
import { sliceRect, artWidthFt, spotCountFor, litByArtSpots, planArtSpots,
         ART_SPOT } from './lib/artSpots.js';
import { reverseCovesFor, mergeReverseCoves, trimWallRun,
         manualReverseCove, RUN_TRIM } from './lib/reverseCove.js';
import { shelfStripsFor } from './lib/shelfStrip.js';
/* RenderPassPanel IS NO LONGER MOUNTED — see the note in the Spaces list where
   it used to be. The import goes with it rather than sitting here unused; the
   component, its state and every handler that fed it are intact. */
import { zonesFromFurniture, slideSconceTo, setRunEnd, moveRun, placeZone,
         nearestWall, alongWallAt, RUN_EDIT } from './lib/accentPlace.js';
import { planSwitchboards, planChunkBoards, markClashes, asDrawn, slideBoardTo,
         innerSpaceFor, nearestBoardTo, boardUnder, nearestSeat, placedBoards,
         asOutlet, heightsFor, SB_COLOUR } from './lib/electrical.js';
// THE BED, FOR THE SWITCHBOARD RULE THAT BRACKETS IT. One function, and it is
// borrowed rather than copied so that "which bed" has one answer on a plan with
// two of them in one room — see the note by `bedRect` below.
import { bedZoneIn } from './lib/bedGrid.js';
import { planFlows } from './lib/flows.js';
// WHAT IS ON THE PLATE, as against where the plate is. electrical.js above
// answers the second; this answers the first, and it is a different question in
// every country — see its header.
import { composeSwitchboard, composeOutlet, countryFor, addablePoints,
         lightSwitchA } from './lib/switchboards.js';
import SwitchboardCard from './components/SwitchboardCard.jsx';
import { HeightField } from './components/SwitchboardCard.jsx';
import SwitchboardSheet from './components/SwitchboardSheet.jsx';
import { CEILING_BY_ID, makeCeilingObject, toObstaclePx,
         radiusFt, resizeFromCorner, rotateTo,
         halfExtents, isUniform, applyResize, FAN_SWEEPS, sweepMm, withSweep,
         newCeilingObjectId }
         from './lib/ceilingObjects.js';
import { collectTargets, snapPoint, SNAP_DEFAULTS } from './lib/snapGuides.js';
/* PICKING A THING UP, MOVING IT, AND LEAVING A COPY BEHIND — the four rules
   every draggable object on this canvas needs and each of which has been got
   wrong at least once here. See its header. The COB is the first store wired
   through it; the ceiling objects still carry their own copy of the same
   arithmetic, and moving them across is the next job. */
import { movedEnough, grabOffset, wantedCentre, orthoLock,
         deltaFrom, applyDelta, forkCopy } from './lib/dragMove.js';
import { buildSnapIndex, snapAt } from './lib/snap.js';
import { openPdf, isPdf, pageToImg } from './lib/pdfPlan.js';
import PdfPagePicker from './components/PdfPagePicker.jsx';
import ToolRail from './components/ToolRail.jsx';
import SpaceDetail from './components/SpaceDetail.jsx';
import WallTonePopup from './components/WallTonePopup.jsx';
import { DEFAULT_CEILING_MM, CEILING_MM_MIN, CEILING_MM_MAX,
         materialsOf, wallMix, wallMixLabel, materialsSummary } from './lib/materials.js';
import { analyseSpace, netPerUnit, FIXTURE_FAMILIES, FAMILY_BY_ID, lumensPerWattFor } from './lib/lumens.js';

/* ---------------------------------------------------------------------------
   THE GRIDDING ENGINE IS OFF, AND THIS IS THE WHOLE OF THE SWITCH.

   A space used to arrive lit: the moment it was taken up, the chunker cut its
   ceiling, the ladder chose a fitting and a grid of downlights appeared. That
   was the app's opening move, and it is the wrong one for what this tool is
   becoming — you design the layout, and the app tells you whether the space has
   the ambient level it needs. A room that lights itself the instant you open it
   has answered the question before it was asked.

   So a space now starts EMPTY, and the question the panel asks is what the room
   IS: how high the ceiling is, and what the three surfaces are finished in.
   Suggestions come back later, and when they do it is this constant that turns
   them on.

   IT SUPPRESSES THE ANSWER, NOT THE MACHINE. `planCeilingDesign` still runs and
   is still handed everything it always was — it is what produces the room's
   `stats`, which the schedule, the exporters and the panel all read, and half a
   dozen call sites would have to learn a second shape if it stopped. What is
   blanked is what it PLACED: the fittings, the cells they sit in, the chunks
   they were cut from, and the tracks derived from them. See the block in the
   `rooms` memo.

   WHAT SURVIVES IS EVERYTHING A HAND PUT THERE. A cove somebody drew keeps its
   tape, and the accents, spots, sconces and strips are separate machines that
   never came from the grid. A tool in the rail that did nothing would be worse
   than no tool.
   --------------------------------------------------------------------------- */
const AUTO_GRID = false;

/* --- THE COB GESTURES THIS BUILD DOES NOT ANSWER FOR YET --------------------
   EMPTY NOW, AND KEPT. It held 'array' while that gesture was undecided — the
   cell was in the drawer because the drawer is what says this fitting has two
   gestures, and out of reach because a press that arms nothing is worse than a
   cell you can see is not ready yet. The array is built, so the entry goes and
   the list stays: the next gesture to be sketched before it is written has a
   place to sit. */
const COB_SOON = [];

// ---------------------------------------------------------------------------
// THE DESIGN LANGUAGE, AS UTILITY STRINGS.
//
// These were `.btn`, `.note`, `.kv`, `.pill`, `.sec` and their neighbours in
// styles.css — the classes this file uses forty and fifty times each, which is
// exactly why they are named here rather than typed out at every use.
//
// EVERY VARIANT IS BUILT FROM A SHAPE THAT DOES NOT SET WHAT THE VARIANT SETS,
// and that is not tidiness, it is the only thing that works. `BTN + ' bg-cta'`
// does NOT give a black button: Tailwind resolves two utilities that touch the
// same property by their order in the GENERATED STYLESHEET, not by their order
// in the class attribute, and `bg-surface` is emitted after `bg-accent` — so
// the base wins and the variant silently does nothing. It cost a real bug: the
// save pill stayed white and the primary button stayed grey while both looked
// correct in the source. So colour lives on the variants and never on a shape
// they share, and a size override gets its own shape rather than an append.
//
// `leading-[1.5]` IS NOT DECORATION EITHER. Tailwind's `text-xs` ships a
// line-height of its own (1rem), and `.btn` never set one — it inherited body's
// 1.5. Take the override away and every button loses 2px of height, which you
// only notice as a row of them failing to line up with the input beside it.
// ---------------------------------------------------------------------------

/* --- buttons. A shape, a size, and one of three colourways. --------------- */
const BTN_SHAPE = 'leading-[1.5] rounded border cursor-pointer '
  + 'transition-[background-color,border-color,color] duration-[120ms] '
  + 'disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_QUIET = 'bg-surface text-white border-border/10 hover:bg-surface-2 hover:text-black '
  + 'hover:border-border-strong active:bg-surface-3 '
  + 'disabled:hover:bg-surface disabled:hover:border-border';
/* THE PRIMARY BUTTON IS THE `cta` TOKEN. Not the accent — the accent means
   "this is the live thing", and a page with three blue buttons on it has
   stopped saying that. */
const BTN_CTA = 'bg-cta text-white border-cta hover:bg-cta-hover hover:border-cta-hover';

/* WHITE FILL, BLACK TEXT — the loudest answer a panel on a black ground can
   give, and the same colourway Share wears in the header. It is for a STEP'S
   WAY OUT: a screen that has taken the whole panel over has exactly one thing
   to press when you are done with it, and the `cta` blue is a shade of the
   ground it sits on rather than a break from it. Hover goes to `text` (the
   off-white) so the press is felt without the label ever leaving black. */
const BTN_WHITE = 'bg-white text-black border-white '
  + 'hover:bg-text hover:border-text active:bg-text';

const BTN = `text-[12px] px-3 py-[7px] ${BTN_SHAPE} ${BTN_QUIET}`;
const BTN_FULL = `${BTN} w-full`;
const BTN_PRIMARY = `text-[12px] px-3 py-[7px] ${BTN_SHAPE} ${BTN_CTA}`;
const BTN_EXIT = `text-[12px] px-3 py-[7px] ${BTN_SHAPE} ${BTN_WHITE}`;
/* `BTN_ACCENT` WAS HERE — the accent-filled button. Its only user was the
   "+ Add a No Light Zone" toggle in the old zones tab, and that tab is a step
   now: the button that starts it is a cell in the light palette (which latches
   with the palette's own gradient ring), and the way out of it is `BTN_PRIMARY`
   like every other step's answer. Nothing else on this screen ever wanted a
   filled accent — the accent means "this is the live thing", and a panel with
   three of them has stopped saying that. */
const BTN_SECOND = `text-[12px] px-3 py-[7px] ${BTN_SHAPE} bg-surface text-white `
  + 'border-border-strong hover:bg-surface-2 hover:border-ink active:bg-surface-3 hover:text-black';
/* The wider one, which is the loading panel's; and the two small ones. */
const BTN_MID = `text-[12px] px-3.5 py-[7px] ${BTN_SHAPE} ${BTN_QUIET}`;
const BTN_TINY = `text-[11px] px-[5px] py-0 ${BTN_SHAPE} ${BTN_QUIET}`;
const BTN_NUDGE = `text-[11px] px-[7px] py-px ml-2 ${BTN_SHAPE} ${BTN_QUIET}`;
/* THE THREE EXPORTS, AS CHIPS IN THE PANEL'S HEADER. They were `BTN` in a
   section of their own; three format names beside a Share button want the
   smaller shape, and `BTN_TINY`'s `py-0` is a chip for sitting inside a table
   row rather than for standing next to one. */
const BTN_EXPORT = `text-[11px] px-2 py-[4px] ${BTN_SHAPE} ${BTN_QUIET}`;
/* The schedule's three exports: a block, its label above its explanation. */
const BOQ_SHAPE = `text-[12px] w-full text-left px-2.5 py-2 block ${BTN_SHAPE} `
  + '[&>b]:block [&>b]:text-[12px] [&>span]:block [&>span]:text-[10px] '
  + '[&>span]:opacity-70 [&>span]:mt-px [&>span]:whitespace-normal';
/* ONE COLOURWAY FOR ALL THREE, and `BTN_BOQ_CTA` is gone with the distinction.
   Excel was the filled one on the reasoning that it is what most people want —
   but these three are not a primary and two alternatives, they are the SAME act
   in three file formats, and which one somebody wants is a fact about the office
   they work in rather than a recommendation this panel gets to make. A row of
   three identical blocks says "pick your format"; two quiet and one filled says
   "take the Excel", to a quantity surveyor who has asked for a CSV.
   IT WAS ALSO INVISIBLE. `BTN_CTA` is the `cta` token, which is #000000 — a
   black block on a black panel, findable only by its border, while the two
   underneath it were legible glass. So the "recommended" option was the one you
   could not read. */
const BTN_BOQ = `${BOQ_SHAPE} ${BTN_QUIET}`;

/* --- notes. ATTENTION, NOT ALARM: most of the warnings in this file are
   guidance — "set the scale first", "light a space first" — and rendering all
   of them in red spent the one loud colour on sentences that are not alarms.
   So the default is quiet: ink, with a rule down the left saying "read this".
   `NOTE_ERR` is the red one, and it is for something that actually failed.
   `N`/`NW`/`NE` are the margin-less shapes, for the sites that set their own. */
const N = 'text-[11.5px] text-muted leading-[1.5]';
const NW = `${N} border-l-2 border-border-strong pl-[9px] ml-0`;
const NE = 'text-[11.5px] leading-[1.5] text-danger-ink border-l-2 border-danger pl-[9px]';
const NOTE = `${N} mt-2`;
const NOTE_WARN = `${NW} mt-2`;
const CODE = 'font-sans text-[10px] bg-input-bg px-[3px] rounded-[3px] text-text';

/* --- the status pills in the top bar. */
const PILL_SHAPE = 'font-sans text-[10.5px] px-2 py-[3px] rounded-full border '
  + 'whitespace-nowrap tabular-nums';
/* ONE GROUND FOR EVERY STATE OF THE SAVE PILL, AND IT IS WHITE. The three were
   three different pills — 5% glass, a pale green wash, a pale red one — so the
   thing in the corner of the bar changed SHAPE as well as wording every time it
   changed state, which is a lot of movement for a label nobody is looking at.
   White reads at 10.5px on this bar in a way glass does not, and the state is
   then said by the type alone: grey while it is happening, green once it has,
   red if it did not. The `-soft`/`-line` pairs it drops are light-theme tokens
   anyway — #EDFAF1 on #FAFAFA was a tint of the old page, not of this one. */
const PILL_WHITE = 'border-white bg-white';
const PILL = `${PILL_SHAPE} ${PILL_WHITE} text-muted`;
const PILL_OK = `${PILL_SHAPE} ${PILL_WHITE} text-ok`;
const PILL_BAD = `${PILL_SHAPE} ${PILL_WHITE} text-danger-ink`;
const PILL_VIEW = `${PILL_SHAPE} border-[#F0ABFC] bg-[#FDF2FE] text-[#C026D3]`;
const PILL_RETRY = `${PILL_BAD} cursor-pointer hover:bg-danger-soft`;

/* TABULAR FIGURES WHEREVER A NUMBER IS READ DOWN A COLUMN. Not a nicety in
   this face: its proportional `1` is half the width of its `0`. */
const KV_SHAPE = 'flex justify-between text-[11.5px] py-[3px] '
  + '[&>b]:text-ink [&>b]:tabular-nums';
const KV = `${KV_SHAPE} text-muted`;
const KV_HEAD = `${KV_SHAPE} text-subtle`;
/* THE SAME ROW ON NO GROUND AT ALL. The admin ledger used to sit in a #F2F2F2
   card, which is where `KV`'s dark label and near-black `<b>` were legible; the
   card is gone, so both halves of the row are white on the panel's own dark
   ground. It restates the shape rather than appending overrides to `KV`,
   because `[&>b]:text-ink` and `[&>b]:text-white` in one class list are decided
   by the order Tailwind emits them in, not the order they are written. */
const KV_ADMIN = 'flex justify-between text-[11.5px] py-[3px] text-white '
  + '[&>b]:text-white [&>b]:tabular-nums';
const N_ADMIN = 'text-[11.5px] text-white leading-[1.5]';
const BTNROW = 'flex gap-1.5 flex-wrap';

/* --- a section and its heading. `first-of-type:` carries the rule that the
   first section in the panel has no line above it; the admin section states
   its own edge and margin, as its own rule always did. */
const SEC = 'border-t border-border/10 pt-3.5 mt-2.5 '
  + 'first-of-type:border-t-0 first-of-type:mt-0 first-of-type:pt-0';
/* IT IS THE FIRST THING IN THE ADMIN TAB NOW, and it used to be the last thing
   in the Export section — a magenta-ruled footnote hung below three file-format
   buttons. The rule and the 20px above it were the separation that nesting
   needed; at the top of a tab of its own they are a hairline under nothing and
   a gap over nothing. `first-of-type` cancels all three, exactly as `SEC` does,
   so the block still states its own edge wherever it is not first. */
const SEC_ADMIN = 'border-t border-border-strong pt-3.5 mt-5 '
  + 'first-of-type:border-t-0 first-of-type:mt-0 first-of-type:pt-0';
/* `mt-0 mx-0 mb-*` and not `m-0 mb-*`: the shorthand and the longhand touch
   the same property, which is the ordering trap described at the top. */
const H3_SHAPE = 'mt-0 mx-0 text-[10px] tracking-[0.11em] uppercase';
const H3 = `${H3_SHAPE} mb-2.5 text-subtle`;
const H3_FLUSH = `${H3_SHAPE} mb-0 text-subtle`;
const H3_ADMIN = `${H3_SHAPE} mb-2.5 text-[#C026D3]`;
/* A DISCLOSURE, IN THE OPERATOR HUE. Same construction as the View section's —
   the browser owns open/closed, keyboard and screen reader, and the chevron is
   an `::after` rotated on `[open]` — but sized and coloured for a sub-block
   inside a section rather than for a section heading of its own. */
const DISCLOSE_ADMIN = `[&>summary]:cursor-pointer [&>summary]:list-none
  [&>summary]:flex [&>summary]:items-center [&>summary]:gap-1.5
  [&>summary]:text-[11px] [&>summary]:tracking-[0.08em] [&>summary]:uppercase
  [&>summary]:text-[#C026D3] [&>summary]:select-none
  [&>summary::-webkit-details-marker]:hidden
  [&>summary]:after:content-[''] [&>summary]:after:ml-auto
  [&>summary]:after:w-1.5 [&>summary]:after:h-1.5
  [&>summary]:after:border-r-[1.5px] [&>summary]:after:border-b-[1.5px]
  [&>summary]:after:border-[#C026D3] [&>summary]:after:transition-transform
  [&>summary]:after:duration-[120ms]
  [&>summary]:after:[transform:rotate(45deg)_translate(-2px,-2px)]
  [&[open]>summary]:after:[transform:rotate(225deg)_translate(-1px,-1px)]`;
/* `accent-white` AND NOT `accent-accent`. `accent-color` is the one property a
   native checkbox exposes, and it sets the BOX — the tick is then drawn by the
   browser in whatever contrasts with it. So a white box gets a near-black tick
   for free, which is the whole ask, and it needs no `appearance-none` and no
   hand-drawn SVG check. Verified in the browser rather than assumed: at 4x zoom
   #fff renders a white box with a dark tick, where the amber it replaces
   rendered an amber box with the same dark tick.
   THE UNCHECKED BOX IS THE UA'S OWN, and stays that way deliberately. Nothing
   here declares `color-scheme`, so it is the light-mode control — a white box
   with a grey border — which is already the right thing beside a checked white
   one on this panel's dark ground. */
/* THE LABEL'S LAYOUT ONLY. The box itself is `.lp-check` in styles.css, which
   owns its size, its border and its tick — `accent-color` could not be made to
   say what colour the tick is, so the control is drawn there instead. The
   `[&>input]:*` utilities that used to live here are gone with it: two places
   setting one control's size is one place too many. */
const CHECK = 'flex items-center gap-2 mb-[7px] text-muted cursor-pointer';

/* --- THE UNDO/REDO SHELL, and it is the only thing left using this.
   The name is historical: it dressed the Design/BOQ tab pair too, and that pair
   is now the right panel's own three-tab strip.
   GLASS, LIKE EVERY OTHER PIECE OF CHROME ON THIS SCREEN. It was `bg-surface-3`
   — #F2F2F2, an opaque near-white pill — which is a light-panel token sitting on
   a dark bar: it read as a bright slab with two invisible icons in it. The
   panel's own glass is what the top bar, the appearance switch and the name
   field all wear, and this is the last of the four to get it.
   `border-border/10` rather than `border-border` for the same reason: #EAEAEA at
   full strength is a bright outline round a translucent thing. */
const TABS = 'inline-flex gap-0.5 p-0.5 rounded border border-border/10 '
  + 'bg-surface backdrop-blur-md';
const TAB_SHAPE = 'appearance-none border-0 cursor-pointer text-[11.5px] leading-[1.5] '
  + 'tracking-[0.01em] py-1 rounded transition-[background-color,color] duration-[120ms]';
/* `TAB` AND `TAB_ON` WERE HERE. They dressed the Design/BOQ pill pair in the top
   bar, which is now the panel's three-tab strip — see PTAB below. `TAB_SHAPE`
   stays: the undo/redo and plan-appearance switches are built on it, which is
   why the shape outlived the pair that used it as a pill. */
const ICON_SHAPE_TAB = 'px-2 inline-flex items-center justify-center leading-[0] [&>svg]:block';
/* WHITE WHEN THERE IS SOMETHING TO DO, GREY WHEN THERE IS NOT — and for these
   two "active" is exactly `enabled`. The pair is the only thing on screen that
   says this plan HAS a history, and its disabled state says how much of one, so
   the difference between the two has to be legible at 15px.
   A COLOUR RATHER THAN `opacity-35`, which is what this was. Opacity dims the
   whole button — its hover ground included — and on a translucent shell that
   compounds into a smudge; `text-subtle` greys the one thing that should grey.
   THE HOVER IS A GROUND, NOT A COLOUR SHIFT, since the icon is already white.
   Gated on `enabled:` so a dead button does not light up under the pointer. */
const STEP = `${TAB_SHAPE} ${ICON_SHAPE_TAB} bg-transparent text-white `
  + 'enabled:hover:bg-white/10 disabled:text-subtle disabled:cursor-default';
/* `STEP_ON` WAS HERE — the same shell latched on, for an icon button that is a
   state rather than an action. The sun/moon switch was its only user, and that
   switch now says its state with the accent RAMP on the live icon instead of
   with a pill behind it (see the block over the canvas). `STEP` stays: undo and
   redo are actions, and they never had an on state to draw. */

/* --- a row in a list of spaces or objects. */
/* `border-transparent` IS ON THE OFF-STATE, not on the shape: `ROW_ON` sets
   border-colour too, and two utilities on one property is the ordering trap. */
/* THE ROW IS A TILE, and it is the SAME tile as the two readouts under Result —
   `bg-white/5`, a `border-border/10` hairline, `rounded`, over `backdrop-blur-md`.
   Named once so the two cannot drift apart: a space row and a stat readout that
   are nearly the same object read as a mistake rather than as a family.

   `border` (THE WIDTH) STAYS ON THE SHAPE and the colour on the states, which is
   the split that makes this editable at all. With the width dropped from the
   shape, `ROW_ON`'s border colour had nothing to paint and the row looked as
   though it were refusing to take a border. */
const ROW_TILE = 'bg-white/5 border-border/10 backdrop-blur-md';
const ROW_EDGE = 'rounded mb-3 border';
/* Resting: no edge at all, and the tile arrives on hover. */
const ROW_OFF = 'border-transparent hover:bg-white/5 hover:border-border/10 '
  + 'hover:backdrop-blur-md';
/* Open: the tile stays put, and it wraps the render-pass block with it. */
/* `ROW_ON` WAS HERE — the tile a row wore while it was OPEN. Nothing opens
   inside a row any more: picking a space replaces the list with the space (see
   SpaceDetail), so a row has exactly one state and `ROW_OFF` above is it. */
/* `ROW` AND THEN `ROW_TIGHT` WERE HERE, and the ceiling-object list was the
   only caller either of them ever had. `ROW` went when those rows lost their
   delete button and carried one line; `ROW_TIGHT` went with the list itself.
   Nothing else in this panel is a one-line row: the Spaces list is an accordion
   on `ROW_FLUSH`, and the chips below are chips. */
const ROW_FLUSH = `p-0 overflow-hidden ${ROW_EDGE}`;
/* THE HEAD PAINTS NOTHING. It is the click target inside the tile; a background
   of its own would cover the tile it sits in and leave the blur nothing to
   blur. */
const ROW_PICK = 'px-1.5 py-2 rounded cursor-pointer '
  + 'focus:outline-none focus-visible:outline-2 focus-visible:outline-accent '
  + 'focus-visible:outline-offset-1';

/* --- A PROPERTY CHIP: a fan's sweep, or which rectangle a hatch is.
   THE SAME TILE AS A SPACE ROW, built from the same two constants rather than
   from a lookalike. These were `bg-input-bg` when latched and `bg-surface`
   otherwise — and `--input-bg` is #FFFFFF, so the picked chip was a solid white
   pill in a panel of frosted glass over black. It read as a form control
   borrowed from another app, which is roughly what it was: the pair predates the
   panel's tile idiom and never got moved onto it.
   Sharing ROW_TILE and ROW_OFF is the point. A chip and a space row are the same
   KIND of thing — a small surface you pick — and two nearly-identical surfaces
   that differ slightly read as a mistake rather than as a family. Same argument
   the ROW_TILE comment makes about the Result readouts.
   ONE PAIR FOR BOTH ROWS. The sweep picker and the AC/trap picker were two
   copies of one long class string, and they had already drifted — one of them
   had picked up a `border-border/10` the other never got. Two copies of a style
   is one copy too many for exactly this reason. */
const PROP_SHAPE = 'flex-1 px-0 py-[3px] font-sans text-[10px] rounded border '
  + 'cursor-pointer transition-colors duration-[120ms]';
const PROP_OFF = `${PROP_SHAPE} text-muted ${ROW_OFF}`;
const PROP_ON = `${PROP_SHAPE} text-text ${ROW_TILE}`;
const PICK_SHAPE = 'grid grid-cols-[minmax(0,1fr)_auto] gap-[7px] items-center w-full '
  + 'border-0 bg-none p-0 text-left';
const PICK = `${PICK_SHAPE} cursor-[inherit]`;
/* `PICK_BTN` — the same grid with its own pointer — WENT WITH THE
   CEILING-OBJECT LIST. It was the shape for a row that is ITSELF the button;
   every remaining user of this grid sits inside a row that handles the click,
   which is what `cursor-[inherit]` above is for. */
const NAME = 'font-sans text-[11px] text-text overflow-hidden text-ellipsis whitespace-nowrap';
const META = 'flex justify-between items-center gap-1.5 text-[10px] text-subtle mt-[3px] '
  + 'tabular-nums [&>span]:flex [&>span]:items-center [&>span]:gap-[5px]';
const RTYPE = 'font-sans text-[9px] tracking-[0.02em] bg-surface backdrop-blur-md text-subtle '
  + 'rounded-[4px] px-[5px] py-px mr-[5px]';
/* `ICON_SHAPE`, `ICON` AND `ICON_ON` WERE HERE — the 26px icon button in a
   spaces row, and the two colourways it wore at rest and while its row was
   open. Their one user was the chunking button, which went with the accordion
   and with the grid it was a reading of. See AUTO_GRID and the note in the
   spaces list. `.lp-chunk-btn` in styles.css is what painted the ramp on hover
   and is likewise unreferenced from here; it stays, because putting the button
   back is putting these three lines back. */


/* --- THE PANEL'S OWN TAB STRIP, and its current tab is WHITE.
   An underline strip like the Edit tabs below it, and deliberately not the
   pill-shaped TABS pair in the top bar: this is a tab strip INSIDE a panel, and
   two different tab idioms three inches apart would read as two different kinds
   of control.
   WHITE AND NOT THE ACCENT. Everything warm on this app is now the accent ramp
   — the fittings, the pools, the strips, the rails — and an amber underline in
   the panel was one more warm mark competing with the drawing for the same
   meaning. The page's ground is black, so white is the strongest thing a panel
   can say with, and it says only this: you are here. */
const PTAB_SHAPE = 'appearance-none border-0 bg-transparent cursor-pointer '
  /* BIGGER THAN THE EDIT TABS BELOW, and that is the hierarchy being said out
     loud rather than a size preference. This strip names the STEP you are in —
     the three things this app does — and the strip under it names a category of
     tool within one of them. They were both 11px, so the panel opened with two
     tab rows of equal weight and no clue which was the outer one. */
  + 'text-[13px] px-0 py-[6px] mr-[18px] last:mr-0 border-b-2 whitespace-nowrap '
  /* NO `-mb-px`. It pulled the tab's own underline down by a pixel so it would
     sit ON the container's hairline and cover it. The hairline is gone (see the
     strip itself), so the nudge has nothing to align to and would just lift the
     underline off its baseline. */
  + 'transition-[color,border-color] duration-[120ms] '
  + 'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 '
  + 'focus-visible:rounded-[3px]';
const PTAB = `${PTAB_SHAPE} text-subtle border-transparent hover:text-text`;
const PTAB_ON = `${PTAB_SHAPE} text-white border-b-white`;
// The editor knows nothing about Supabase — see routes/Planner.jsx. What it
// knows is how to turn its own state into one object and back again, and that
// contract lives in planState.js so the writer and the reader stay in step.
import { serialiseEditor, applyEditor, statsFrom, statusFrom } from './lib/planState.js';

const LS = 'lightPlanner.v1';

/* --- SWITCHING THE OPTIONS CARD OFF, PER PLAN ------------------------------
   THE PILL OPENS ON EVERY LANDING; THE CARD OVER IT IS THE PART THAT CAN BE
   SILENCED, and it is silenced for ONE PLAN rather than for the person. A plan
   is a job somebody comes back to a dozen times — every landing on it would
   otherwise re-explain a control they have been using all afternoon — while the
   next plan is a fresh set of rooms and may well be somebody else's first look
   at the app on this machine.

   IN THE BROWSER AND NOT IN THE SAVED STATE, WHICH IS THE ONE DECISION HERE
   WORTH ARGUING. `editorState` is the undo stack's basis — see the note on the
   memo — so a tutorial flag living in it would make ticking a checkbox an
   undoable step, and, worse, an undo of something real would resurrect the card.
   It is a preference about being told things, not a fact about the drawing.

   ONE KEY HOLDING A LIST, CAPPED. A key per plan would grow without limit in a
   store nothing ever prunes; a list keeps the whole preference in one entry, and
   the cap means the oldest plans quietly start explaining themselves again
   rather than the entry growing forever. Losing the tail is the cheapest thing
   in this file to lose.

   A READ THAT THROWS SHOWS THE CARD. Private mode and blocked storage cannot
   remember a tick, so the choice is between a card that has to be dismissed once
   per landing and a control that is never explained — and here the dismissal is
   a single click on the card itself, so the nag is cheap and the silence is not
   worth faking. */
const COACH_LS = 'lightPlanner.optionsCoach.v1';
const COACH_CAP = 200;
const coachList = () => {
  try { const l = JSON.parse(localStorage.getItem(COACH_LS) || '[]'); return Array.isArray(l) ? l : []; }
  catch { return []; }
};
const coachOff = (planId) => !!planId && coachList().includes(planId);
const silenceCoach = (planId) => {
  if (!planId) return;
  // MOVED TO THE END RATHER THAN APPENDED BLINDLY, so re-ticking a plan that is
  // already in the list refreshes its place instead of adding a duplicate that
  // pushes something else off the front.
  const kept = coachList().filter((x) => x !== planId);
  try { localStorage.setItem(COACH_LS, JSON.stringify([...kept, planId].slice(-COACH_CAP))); }
  catch { /* private mode */ }
};

/**
 * WHICH SPACE INTRODUCES THE DESIGN SCREEN.
 *
 * THE ROOM PEOPLE CAME FOR, PER PROJECT TYPE. The point of the pill is that a
 * ceiling has alternatives, and the room where that lands hardest is the one the
 * project is actually about — the living room in a flat, the lobby in a hotel,
 * the dining area in a restaurant. Opening on a toilet would be technically
 * correct (it has a pill) and would teach the feature at its least interesting.
 *
 * ONLY CHUNKS WITH SOMETHING TO FLIP TO. A chunk with one option draws no
 * arrows, so a card pointing at them would point at nothing — this is the same
 * `many` test the pill itself uses, applied one step earlier to the choice of
 * where to park. Note this can pick a room's SECOND-biggest chunk, where
 * `optionPickFor` always takes the biggest: there the question is "which piece
 * of ceiling is this room", here it is "which piece of ceiling has a choice in
 * it", and they are not the same question.
 *
 * THEN THE BIGGEST OF THOSE, and area is the tie-break rather than the ranking,
 * so a large toilet never outranks a small living room.
 */
const INTRO_TYPES = {
  residential: ['living_space', 'bedroom'],
  office: ['conference_room', 'reception', 'office_chamber'],
  hotel: ['lobby', 'banquet', 'suite'],
  restaurant: ['dining_area', 'private_dining', 'bar'],
  educational: ['library', 'canteen', 'lecture_hall'],
};

function introSpace(rooms, roomTypes, projectId) {
  const pref = INTRO_TYPES[projectId] ?? [];
  let best = null;
  for (const r of rooms) {
    const many = (r.designChunksPx ?? []).filter((d) => (d.options?.length ?? 0) > 1);
    if (!many.length) continue;
    const chunk = many.reduce((m, d) => (d.wFt * d.hFt > m.wFt * m.hFt ? d : m));
    const at = pref.indexOf(roomTypes[r.id]?.type ?? '');
    const rank = at < 0 ? pref.length : at;
    const area = chunk.wFt * chunk.hFt;
    if (!best || rank < best.rank || (rank === best.rank && area > best.area)) {
      best = { roomId: r.id, key: chunk.key, rank, area };
    }
  }
  return best;
}

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
const LAYER_DEFAULTS = { plan: true, dim: true, region: false, cells: true,
  lights: true, labels: false, fan: true, zones: true, accents: true,
  objects: true, spots: true, switchboards: true,
  /* THE LOOPING, OFF BY DEFAULT. A lighting drawing and a wiring drawing are
     two sheets read by two trades, and the arcs cross the layout everywhere
     they exist — so they are asked for. Serialised with the rest, so a plan
     reopens showing whatever it was left showing. */
  electrical: false,
  /* DARK MODE FOR THE DRAWING, AND IT IS A PIXEL INVERSION OF THE SCAN — the
     same thing ⌘I does in Photoshop, applied to the plan image and nothing
     else. It lives in `layers` because it is a preference about the picture
     rather than a decision about the design, which means it is serialised with
     the rest of them and the plan reopens the way it was left. */
  invert: false };

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
  // TWO WAYS IN, one pipeline — and since the outline became something you
  // draw, the two have very nearly converged. BOTH kinds of plan are read for
  // rooms on upload and then corrected by hand over the drawing (see
  // OutlineTracer); the only thing a DXF still does for you is state its own
  // scale, where an image has to be measured first.
  //
  // The green-marker route is gone. It asked the user to mark up the plan in an
  // image editor before uploading it, then guessed at the loop they had drawn —
  // and a guess that is nearly right is the worst possible outcome, because
  // nothing on screen says so. Drawing the outline in the app is less work than
  // drawing it in Preview was, and it is exact.
  const [img, setImg] = useState(null);          // raster: {src, el, w, h, base64, mime, name}
  const [dxf, setDxf] = useState(null);          // vector: {drawing, name}
  // A PDF IS NOT A THIRD KIND OF SOURCE. It is rendered to a raster and then it
  // IS a raster — `img` above holds the result and nothing downstream knows the
  // difference. What is held here is only what the raster cannot say for itself:
  // which page it came from (so a reopened plan renders the same one) and, while
  // a drawing set is being chosen from, the open document.
  const [pdfPage, setPdfPage] = useState(null);
  const [pdfPick, setPdfPick] = useState(null);  // {name, pages, thumbs, doc} while asking
  const [unitId, setUnitId] = useState(null);    // user override of the file's own units
  // Outlines traced over the drawing, in RAW DRAWING UNITS — see toDu/fromDu in
  // planSource. Several per drawing; one is lit at a time. This is the shape a
  // whole-floor version needs: one layout per outline id.
  const [outlines, setOutlines] = useState([]);
  const [selectedOutlineId, setSelectedOutlineId] = useState(null);   // tracer highlight
  // THE WHOLE PLAN IS LIT AT ONCE. This was one id, and it being one id was an
  // artefact of an outline having been something you traced by hand: tracing
  // four rooms to light one of them is work nobody would do, so the app only
  // ever had one. Now that the rooms arrive together from the detector, they
  // are lit together — one layout per outline, all on screen, one export.
  const [litIds, setLitIds] = useState([]);
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
  const [dirtyIds, setDirtyIds] = useState([]);
  const [focusId, setFocusId] = useState(null);       // which room the panel is editing
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
  const [ceilingMm, setCeilingMm] = useState({});
  const [materials, setMaterials] = useState({});

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
     chances for two of them to disagree. See `roomFixtureGroups`. */
  const [fixtureWatts, setFixtureWatts] = useState({});

  /* `wallEdit` IS A SCREEN AND IS NOT SAVED, exactly as `zoneEdit` and
     `doorEdit` are not: it holds the id of the space whose walls are being
     answered for, and it means "the panel is a step and the sheet is inert".
     What it PRODUCES — the tones — is in `materials` above, which is saved.
     `wallPick` is the popup: which edge was clicked and where on the screen, so
     the card can stand on its own answer. Null the rest of the time. */
  const [wallEdit, setWallEdit] = useState(null);
  const [wallPick, setWallPick] = useState(null);

  /* WHICH SPACE HAS ITS FINISHES OPEN — a room id, or null, and it is a SCREEN
     rather than a decision so it is not saved. Setting the finishes replaces the
     analysis in the space panel; see SpaceDetail for why that is a swap and not
     a disclosure.
     A ROOM ID AND NOT A BOOLEAN, which is what makes it close itself: opening a
     different space is a different id, so the finishes collapse with no effect
     to watch `focusId` and no way for the two to disagree.
     IT SURVIVES THE WALL STEP, which is the reason it lives up here with the
     rest of the editor's state rather than inside SpaceDetail. "Configure walls"
     is reached FROM the finishes and unmounts the whole panel while it runs;
     local state would put somebody back on the analysis when they pressed Done,
     one step further out than they left. */
  const [materialsEdit, setMaterialsEdit] = useState(null);

  /* --- THE DERIVED RUNS SOMEBODY THREW AWAY --------------------------------
     A LIST OF IDS, AND IT IS THE ONLY WAY A DERIVED RUN CAN BE DELETED. A
     reverse cove and a shelf strip are both re-derived on every render out of
     `wallResults` — nothing stores them — so removing one from the drawing means
     recording that it is gone, exactly as `boardsOff`, `artDismissed` and
     `surfaceDismissed` do for the three other things a pass produces.

     NOT `accentDismissed`, WHICH IS WHERE THIS USED TO GO AND WHY DELETE DID
     NOTHING. Both of these reach the drawing as accent zones, so Delete filed
     their ids in the accent pass's dismissal list — and that list is only ever
     applied to the accent pass's OWN zones. The id went in, nothing read it, and
     the run stayed on the sheet. The two lists are separated because they are
     applied in two different places: an accent zone is filtered where the accent
     zones are built, and a reverse cove has to be filtered where the COVE is
     built, or the tape would go and the slot it sits in would stay.

     BY THE RUN'S OWN ID, which is `rcove-<element>-<n>` or `shelf-<element>-<n>`
     — two namespaces that cannot collide, which is what lets one list serve
     both. A HAND-PLACED cove is not in here at all: it has a store of its own
     (`manualCoves`) and is removed from it, for the reason the accent branch
     gives — a dismissal for a thing with no generator would suppress an id for
     the life of the plan long after the thing itself was gone. */
  const [runsOff, setRunsOff] = useState([]);

  const [busy, setBusy] = useState('');

  // --- things already on the ceiling ---------------------------------------
  // THE ONLY LIST OF THEM, NOW. There used to be two: this one, and whatever the
  // red-circle detector found. That detector is gone — see the note in
  // settings.js — and with it the last reason for a fan to exist in two places
  // measured in two units.
  //
  // These are held in FEET. A fan the detector found has to be pixels because
  // that is all it knows; an object someone placed is a real thing of a real
  // size, and feet is what keeps it that size when the scale is corrected
  // underneath it.
  //
  // To the planner they are all one thing — see ceilingObjects.js.
  const [ceilingObjs, setCeilingObjs] = useState([]);
  const [objType, setObjType] = useState('fan');
  const [fanSweepMm, setFanSweepMm] = useState(1200);
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

  /* THE SELECTION IS A LIST FOR CEILING OBJECTS, because Shift-clicking builds
     one, and they are the only kind that can be several — see `selectMany`.

     `selObjId` IS THE PRIMARY — the most recently added — and it is what the
     property panels read. "What sweep is this fan?" and "is this an AC or a
     trapdoor?" are questions about ONE object, and with three selected the
     honest answer is the one you touched last; the CHANGE those panels make is
     applied to everything selected of the right kind, which is what a
     properties panel does everywhere else.

     THERE IS NO `setSelObjId` ANY MORE and it is not missed. It existed to say
     "this one object and nothing else" in one call; `select('object', id)` is
     that sentence, and it says the "nothing else" part about the whole canvas
     rather than about this list. */
  const selObjIds = idsOf(sel, 'object');
  const selObjId = idOf(sel, 'object');
  /** Add an object to the selection, or take it out if it is already in. */
  const toggleSelObj = useCallback((id) => setSel((cur) => {
    const ids = idsOf(cur, 'object');
    return selectMany('object',
      ids.includes(id) ? ids.filter((q) => q !== id) : [...ids, id]);
  }), []);
  const [objDrag, setObjDrag] = useState(null);   // {id, mode, ...} while dragging

  // TWO SEPARATE THINGS, and conflating them was half of why this felt wrong.
  //
  // `objMode` is the editing CONTEXT: handles are shown, objects can be picked
  // up. `armed` is a one-shot — the next click on empty ceiling drops an object
  // of that type, and then it disarms itself.
  //
  // One flag could not be both. It meant the tool that let you MOVE something
  // was the same tool that placed a new one on any click, so a click that
  // missed by a pixel added an object instead of selecting one.
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
  const [manualCoves, setManualCoves] = useState([]);
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
  const [manualTracks, setManualTracks] = useState([]);
  /* --- EDITING A DRAWN TRACK'S POINTS ----------------------------------------
     WHICH PATH IS OPEN, WHICH OF ITS POINTS IS PICKED, AND THE DRAG IN FLIGHT.
     Three pieces rather than one for the reason the shape editor keeps three:
     they have three different lifetimes. The path stays open while somebody
     moves four corners in a row; the selection survives a drag and is what
     Delete acts on; the drag lives for one press.

     THE PATH IS OPENED BY A DOUBLE CLICK ON THE RAIL and closed by Escape or by
     a press on empty plan, which is the same two-stage back-out every other
     selection on this canvas has. */
  const [trackEditId, setTrackEditId] = useState(null);
  const [selTrackPt, setSelTrackPt] = useState(null);
  const [trackGrip, setTrackGrip] = useState(null);
  const [manualAccents, setManualAccents] = useState([]);
  const [manualSurfaces, setManualSurfaces] = useState([]);

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
  const [manualCobs, setManualCobs] = useState([]);
  /* WHICH ONE IS PICKED, so Delete has something to act on. Its own selection
     and not `selAccId`: an accent zone is a strip or a sconce out of the accent
     machinery, and filing a COB in that list would mean Delete looking for it in
     three stores that have never heard of it. */
  const selCobId = idOf(sel, 'cob');
  /* THE DRAG IN FLIGHT, and it lives for one press. Everything in it is a
     snapshot taken when the pointer went down — see `cobPointerDown`, and rule 2
     in lib/dragMove.js for why every frame is measured from there rather than
     from the frame before it. */
  const [cobDrag, setCobDrag] = useState(null);

  /* --- THE COB DRAWER, AND WHAT THE NEXT LAMP WILL BE ------------------------
     ALL TRANSIENT. None of this is saved: it is which cell of the rail is open,
     which of its gestures is armed, and the specification the next click will
     use — and a plan reopened holding a half-made intention would be a plan that
     places a lamp somebody decided about last week.

     THE THREE SPECIFICATION SLOTS ARE THREE DIFFERENT LIFETIMES, which is the
     whole of the two buttons on the card:

       cobDraft     what the slider and the chips are showing. It has no effect
                    on anything until one of the buttons is pressed, which is
                    what makes dragging the slider free.
       cobOnce      "Update this" — one lamp, then gone.
       cobStanding  "Update all next" — every lamp from now until it is cleared
                    by the Recommended chip.

     Null in all three means "ask the engine", which is the default and the thing
     the card opens on. */
  const [cobOpen, setCobOpen] = useState(false);
  const [cobMode, setCobMode] = useState(null);
  const [cobDraft, setCobDraft] = useState(null);
  const [cobOnce, setCobOnce] = useState(null);
  const [cobStanding, setCobStanding] = useState(null);
  /* --- THE LAMPS PUT DOWN SINCE THE TOOL WAS PICKED UP -----------------------
     A LIST OF IDS, AND IT IS WHAT THE TICK AND THE CROSS ON THE BAR ACT ON.
     Placing is immediate — a lamp appears the moment it is clicked, it is on the
     drawing, it is in the analysis — and that is deliberate: a tool where twenty
     fittings are invisible until you confirm them is a tool you cannot judge the
     ceiling with. What the two buttons decide is whether the RUN stays.

     SCOPED TO THIS ARMING OF THE TOOL AND NOT TO THE PLAN, which is the whole
     safety of the cross. "Reject all placements" has to mean the ones just made,
     not every COB anybody ever placed on this drawing — a button that could take
     out last week's work in one press does not belong beside a button you press
     twenty times a minute. Cleared when the tool is put down, so the next run
     starts empty and the cross can never reach back past it.

     NOT SAVED. It is a fact about a gesture in flight, and a plan reopened
     holding one would offer to throw away lamps from a session that ended. */
  const [cobRun, setCobRun] = useState([]);
  /* --- THE SPACE THE RUN BELONGS TO -----------------------------------------
     SET BY THE FIRST LAMP AND HELD UNTIL THE RUN ENDS. Placing a downlight is
     not really an act on a POINT — it is an act on a CEILING: the recommendation
     comes from that ceiling's cells, the analysis that has to move while you
     work is that space's, and the row of lamps you are lining up is a row in one
     room. A run that wandered across a doorway would be one gesture editing two
     spaces, with the panel able to show only one of them.

     SO THE FIRST PRESS CHOOSES THE ROOM AND THE REST OF THE RUN IS INSIDE IT.
     Clicks on any other ceiling place nothing — and, more importantly, SAY they
     will place nothing before they are spent: the pointer goes back to an arrow,
     the ghost lamp and the guides come off, and the bar stops answering for
     wherever the cursor is. A rule you discover by pressing is a bug; a rule the
     cursor states is a boundary.

     THE WAY TO THE NEXT ROOM IS THE TICK, which is what gives that button its
     second job. Keep the run, and the tool re-arms unlocked on the next press;
     the cross does the same having thrown the run away. Both were already the
     way out — this is what they are the way out OF.

     NOT SAVED, like `cobRun` beside it: it is a fact about a gesture in flight. */
  const [cobLock, setCobLock] = useState(null);

  /* --- WHICH SPACES ARE FILLING THEIR OWN GRID -------------------------------
     A SET OF OUTLINE IDS, and it is SAVED, unlike everything else in this block.
     The rest of the COB state is a gesture in flight; this is a decision about a
     ceiling — "this space's grid is laid out automatically" — and a plan
     reopened without it would come back with the lamps gone and nothing to say
     why they went.
     WHAT IT SWITCHES IS A PLACER AND NOT A LAYER. The lamps it puts down are
     real entries in `manualCobs`: they draw, they count, they can be dragged,
     re-specified and deleted one at a time, and once one of them has been
     touched it stops being the toggle's to take away. See `autoplaceIn`. */
  const [autoSpots, setAutoSpots] = useState([]);

  /* --- LAMPS SET OUT ON A GEOMETRY -------------------------------------------
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
     the cheapest way to say which list to look in. See `arrayOutline`. */
  const [cobArrays, setCobArrays] = useState([]);
  /* THE ARRAY BEING SET UP, which is a gesture and not a record: which geometry
     is picked, and what the bar is currently asking about it. It becomes an
     entry above when the tick is pressed, and is thrown away otherwise. */
  const [cobDraftArray, setCobDraftArray] = useState(null);
  /* --- THE ARRAY THAT IS OPEN ------------------------------------------------
     ITS OWN SELECTION, beside `selCobId` rather than inside it, and the reason
     is what a press on one of its lamps MEANS. A hand-placed COB is a fitting
     and clicking it selects that fitting; an array lamp is not a fitting at all
     — it is one of twelve consequences of a count and an offset, and there is
     nothing about it on its own that anybody can change. So the press has to
     resolve to the ARRAY, and the bar it opens has to be the array's.

     WHICH IS ALSO WHY IT CANNOT BE FILED UNDER `selCobId`. That id is looked up
     in `manualCobs` by Delete, by the analysis highlight and by the drag — three
     lookups that would all miss, because an array's lamps are a memo (see
     `arrayCobsPx`) and were never in that store.

     TRANSIENT. A selection is a fact about what somebody is looking at. */
  const selArrayId = idOf(sel, 'array');
  /* THE ARRAY BEING CARRIED, for one press. Same snapshot-at-the-press rule
     every other drag on this canvas follows — see rule 2 in lib/dragMove.js. */
  const [arrayDrag, setArrayDrag] = useState(null);

  /* --- THE GEOMETRY UNDER THE POINTER, WHILE SOMETHING CAN TAKE IT ----------
     A SHAPE ID, AND IT IS ONLY EVER SET WHILE A TOOL CAN ACTUALLY USE ONE. Two
     tools take a geometry rather than a point — the shape tool, which spans a
     cove from a guide already drawn, and the COB array, which sets a run out on
     one — and until this existed neither said so before the press. Both showed a
     crosshair over a line they were about to swallow, and the array drew a ghost
     lamp at the pointer that was never going to be placed there.

     ONE PIECE OF STATE FOR THREE CUES, which is why it is a state and not three
     tests at three call sites: the cursor turns into a pointer, the ghost lamp
     goes, and the geometry's own stroke comes up to full weight. All three are
     saying the same sentence — "press here and you get THIS line" — and they
     have to agree frame by frame.

     TRANSIENT, and cleared with whatever tool set it. A highlight left on a
     shape after the tool was put down is a shape claiming to be selectable by a
     press that would do something else. */
  const [geomHover, setGeomHover] = useState(null);

  /* --- THE MODULES CLIPPED INTO A MAGNETIC TRACK ----------------------------
     THE RUN IS NOT IN HERE, AND THAT IS THE WHOLE DESIGN. A magnetic track is a
     ceiling shape with `role: 'track'` — one entry in `ceilingShapes` beside the
     coves and the guides — so it draws with every primitive the shape bar has,
     it resizes by its grips, it duplicates by its own button, it snaps, it drags
     and it saves, none of which is written here. See the header of
     lib/magTrack.js for the argument at length.

     WHAT IS IN HERE IS WHERE EACH MODULE SITS ON ITS RUN, and it is a FRACTION
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
     re-derives it. */
  const [trackFixtures, setTrackFixtures] = useState([]);
  /* THE DRAWER, AND WHICH MODULE IS ARMED. Transient, exactly as the COB's two
     are: which cell of the rail is open and what the next press will clip in. */
  /* WHICH MODULE IS ARMED. There is no `trackOpen` beside it any more: the rail
     cell's latch is the geometry bar's own role (`shapeRole === 'track'`) and the
     drawer follows the SELECTED RUN, so both were state that had to be kept in
     step with something already true. See the cell at the ToolRail call site. */
  const [trackMode, setTrackMode] = useState(null);
  /* WHICH MODULE IS HELD, AND THE SLIDE IN FLIGHT.
     A DIFFUSER THE ALLOCATOR PUT DOWN IS A PROPOSAL AND NOT A DECISION — it
     answered "how much light" from the room's shortfall and "where" from the
     geometry, and neither of those is a claim about the console being under it.
     So it has to be movable, and the only direction it CAN move is along the run:
     a module clips anywhere on a profile and nowhere across one. That is why the
     drag writes a fraction rather than a point. */
  const selModuleId = idOf(sel, 'module');
  const [moduleDrag, setModuleDrag] = useState(null);
  /* WHERE THE POINTER IS ON THE PLAN, and only that. It is what the
     recommendation and the two warnings are computed from — the bar that shows
     them is pinned to the foot of the stage and needs no position of its own,
     which is the whole of why this is one point rather than two. See CobSpec for
     the card at the cursor that this replaced and why it could not work.
     NULL OFF THE CEILING, so the guides draw nothing out there and the engine
     falls back to the catalogue. */
  const [cobAt, setCobAt] = useState(null);

  /* --- COVES SOMEBODY DREW ---------------------------------------------------
     A LIST OF SHAPES IN PLAN FEET, and the same kind of state `ceilingObjs` is:
     real objects of a real size, held in feet so that correcting the scale
     underneath them does not resize them. See ceilingShapes.js for what one is
     and why its bounding box is what the grid gets cut on.

     THE REST OF THIS BLOCK IS THE GESTURE, and it is all transient. `shapeTool`
     is which primitive is armed, `shapeSpan` is where the drag started,
     `penPts` is the path so far, and `shapeAt` is the pointer — none of it is
     saved, because a half-drawn shape is not a thing a plan can be reopened
     holding. */
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
     band that admitted them. */
  const [lightMoves, setLightMoves] = useState({});
  /* WHICH LIGHT IS PICKED, as `${outlineId}|${cellKey}` — the same pairing the
     store is keyed on, flattened, because a selection is one value. */
  const selLightId = idOf(sel, 'light');
  const [lightDrag, setLightDrag] = useState(null);

  const [ceilingShapes, setCeilingShapes] = useState([]);
  /* IS THE FLOATING BAR OPEN? Separate from `shapeTool` because the bar opens
     BEFORE a shape has been chosen — pressing the cove button in the panel puts
     the menu on the drawing, and choosing a primitive from it is the next act.
     A single piece of state would make "open with nothing picked" impossible to
     say. */
  const [shapeMenuOn, setShapeMenuOn] = useState(false);
  const [shapeTool, setShapeTool] = useState(null);        // a SHAPE_TOOLS id
  /* WHAT THE BAR IS DRAWING FOR — 'cove' or 'guide'. THE BAR ITSELF IS THE SAME
     BAR, which is the whole of this: the six primitives, the gestures, the
     grips, the tick and the cross were all built for the cove tool and none of
     them was ever ABOUT coves. What differs is only what the drawing becomes
     once it is committed, and that is one field on the shape. See `roleOf` in
     ceilingShapes.js. Transient — a shape carries its own role once sealed. */
  const [shapeRole, setShapeRole] = useState('cove');
  const [shapeSides, setShapeSides] = useState(POLY_SIDES.initial);
  const [shapeAskSides, setShapeAskSides] = useState(false);
  const [shapeSpan, setShapeSpan] = useState(null);        // { aFt, uniform }
  /* --- THE TWO PENS, WHICH ARE ONE PEN TWICE ---------------------------------
     `penPts` AND ITS RUBBER BAND USED TO LIVE LOOSE HERE, beside the shape
     drag's state, and adding a second pen for the track would have meant a
     second point list, a second live segment and a second undo kept in step by
     hand. They are one hook now — see hooks/usePen.js — and the two tools
     differ in the two options they pass and in nothing else.

     THE COVE PEN CLOSES AND IS FREE-ANGLED, because a cove is an OUTLINE: the
     path has to come back to where it started or it encloses nothing, and a
     ceiling is not obliged to be rectilinear. Shift locks a segment square for
     the walls that are.

     THE TRACK PEN IS OPEN AND ALWAYS LOCKED, because a track is a RUN: it goes
     from somewhere to somewhere and stops, and a profile is set out along the
     building. There is no shift to hold — every segment is square, which is
     what makes an L or a C the natural thing to draw and a diagonal impossible
     to draw by accident. */
  const covePen = usePen({ lock: 'shift', closes: true });
  /* IT CLOSES TOO, WHICH THE FIRST VERSION OF THIS GOT WRONG. The argument for
     an open-only pen was that a track is a RUN — it goes from somewhere to
     somewhere and stops — and that is true of most of them and not of the one
     everybody draws first, which is a rectangle round a room. Clicking the
     first point again placed a second point on top of it and left the loop
     open. A track is closed when somebody closes it. */
  const trackPen = usePen({ lock: 'always', closes: true });
  const [shapeAt, setShapeAt] = useState(null);            // feet, plan space
  /* THE SHAPE THE DRAG LEFT BEHIND, waiting for the tick. A released drag does
     NOT commit — see the note on `commitShape` — so this is where it sits in
     between, and it is the one piece of the gesture that survives the pointer
     coming up. */
  const [shapeHeld, setShapeHeld] = useState(null);
  /* --- A DRAFT TAKEN FROM A GEOMETRY, AND HOW FAR OFF IT IS BEING SET -------
     TWO PIECES BECAUSE THE ANSWER IS RECOMPUTED AND NOT ACCUMULATED. `heldSrc`
     is the borrowed outline exactly as it was found, untouched for the life of
     the gesture; `heldOff` is the side and the distance the bar is showing. The
     draft is `insetShape(heldSrc, ...)` of the pair, worked out afresh on every
     change — so sweeping the distance from 1 ft to 2 ft and back lands on the
     original rather than on a shape that has been offset three times.

     IT IS ONLY EVER SET FOR A BORROWED DRAFT. A shape dragged out with a
     primitive has no source geometry to be offset FROM: the drag IS the
     position, and offering "a foot inside" of it would be asking about the wrong
     thing. `heldSrc` null is what withholds the control — see the shape bar.

     WHY THE CONTROL EXISTS AT ALL: a magnetic track set out a foot inside a
     guide is the ordinary case, and the whole reason to draw the guide first.
     It applies to a cove borrowed from a guide identically, because it is the
     same act — see `insetShape`. */
  const [heldSrc, setHeldSrc] = useState(null);
  const [heldOff, setHeldOff] = useState({ side: 'on', ft: 1 });
  const selShapeId = idOf(sel, 'shape');
  const [shapeDrag, setShapeDrag] = useState(null);        // moving one already there
  /* WHICH SHAPE IS SHOWING ITS HANDLES, and it is NOT the same thing as which
     one is selected. Selection is one press and gets the contextual bar — the
     corner radius, the copy, the bin. Dimensions are a second press on the same
     shape, and they get grips.

     TWO STATES BECAUSE THEY ARE TWO DEPTHS, and putting the grips on plain
     selection would mean eight handles appearing round a twenty-foot cove every
     time somebody clicked it to check its radius — grips over the drawing, over
     the fittings inside it, for a gesture nobody asked to make. It is the same
     depth a double-click buys everywhere else: select the thing, then get at
     what it is made of. */
  const [shapeEditId, setShapeEditId] = useState(null);
  const [shapeResize, setShapeResize] = useState(null);    // { id, handle }
  const [objMode, setObjMode] = useState(false);
  const [armed, setArmed] = useState(null);       // a type id, or null
  const [guides, setGuides] = useState([]);       // momentary alignment lines
  const [overRoom, setOverRoom] = useState(false); // is the pointer on a ceiling
  const [ghost, setGhost] = useState(null);       // where an armed object would land

  const [zones, setZones] = useState([]);        // no-light rects in image px {id,x0,y0,x1,y1}
  // Furniture found on the plan. Deliberately NOT the same thing as a zone:
  // a detection is a property of the IMAGE and is found once, whereas whether
  // it is a no-light zone depends on which room is being lit. Keeping them
  // apart is what lets the detection run before a boundary exists.
  const [detections, setDetections] = useState([]);          // {id,cls,conf,rect} in image px
  const [detectState, setDetectState] = useState({ status: 'idle' });
  // THE TWO ANSWERS, KEPT APART. The ordinary path walks the whole `both`
  // response at once so that dedupe() collapses two boxes over one bed into one
  // zone; the judge needs the opposite — the two claims side by side, because
  // they are what is being compared. Empty on any single-provider run.
  const [bedSets, setBedSets] = useState(null);   // {roboflow:[...], openai:[...]}
  // What the judge decided, per room, so the panel can say why a bed is where
  // it is. Keyed by outline id.
  const [bedVerdicts, setBedVerdicts] = useState({});
  const [dismissed, setDismissed] = useState([]);            // detection ids the user rejected
  const [detectNonce, setDetectNonce] = useState(0);         // bumping this re-runs detection
  const [provider, setProvider] = useState(DEFAULT_PROVIDER);
  const [zoneMode, setZoneMode] = useState(false);
  const [draftZone, setDraftZone] = useState(null);

  // Which of the possible chunk decompositions to light, PER ROOM. Held as a
  // STRATEGY ID and not a set of rectangles: the user is choosing how to read
  // the space, and that intent should survive a nudge of the target-cell
  // slider. Keyed by outline id, and absent means "whatever is recommended" —
  // which is what makes lighting eight rooms one act instead of eight choices.
  const [chunkPicks, setChunkPicks] = useState({});
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
  const [designPicks, setDesignPicks] = useState({});
  const [ceilingKinds, setCeilingKinds] = useState({});
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

  // The room detector. Runs on upload, like the bed one, and for the same
  // reason: by the time there is anything to light the answer is already in.
  const [roomState, setRoomState] = useState({ status: 'idle' });
  const [roomNonce, setRoomNonce] = useState(0);

  // --- accent lighting ------------------------------------------------------
  // A SECOND QUESTION ABOUT A ROOM THAT ALREADY HAS A CEILING. Everything above
  // is the ambient layer: a grid, and a light at the centre of every cell. This
  // is the layer that goes on top of it — coves, sconces, picture lights, strips
  // — and it is asked ROOM BY ROOM rather than plan-wide, because the image that
  // goes over the wire is one room with every other room on the sheet erased.
  //
  // Keyed by outline id throughout, so switching rooms in the panel does not
  // lose the answer the last one gave.
  const [accentRoomId, setAccentRoomId] = useState(null);
  const [accentResults, setAccentResults] = useState({});   // roomId -> parsed reply, boxes in PLAN px
  // Carries its own roomId. Everything else here is keyed by room, and a bare
  // status was the odd one out: a failure on room A left its error banner sitting
  // under room B's controls, over a button still offering to run.
  const [accentState, setAccentState] = useState({ status: 'idle', roomId: null });
  const [accentDismissed, setAccentDismissed] = useState([]);
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
  const [boardsOff, setBoardsOff] = useState([]);   // board ids somebody removed
  /* ...AND WHERE THEY DRAGGED ONE TO: board id -> distance round that space's
     walls, in feet. Same kind of store as `boardsOff` and for the same reason —
     a board is derived, so a hand position has to live outside the derivation or
     the next render puts the plate back on its rule.
     THE COORDINATE IS ARC LENGTH AND NOT A POINT. See `wallPath` in
     electrical.js: a run index renumbers when somebody re-traces a corner, and a
     point in plan pixels moves when somebody corrects the scale. */
  const [boardMoves, setBoardMoves] = useState({});
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
  const [boardPoints, setBoardPoints] = useState({});
  const selBoardId = idOf(sel, 'board');
  const [boardDrag, setBoardDrag] = useState(null);   // {id, roomId, origin, live}

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
  const [flowBoards, setFlowBoards] = useState({});
  const [flowBends, setFlowBends] = useState({});
  const selFlowId = idOf(sel, 'flow');
  /* THE GESTURE IN FLIGHT: `{ id, kind, key, origin, live, at, overId }`.
     `kind` is 'board' or 'bend'; `at` is where the pointer is now, and `overId`
     the plate a board drag would land on. Both are here rather than in
     `flowBoards` because a re-assignment written per pointermove would re-order
     the loop, re-compose two switchboards and repaint the panel on every frame
     of the drag — see the note on `boardPointerMove`, which writes per move for
     the opposite reason. A BEND does write per move: it changes one arc and
     nothing downstream reads it. */
  const [flowDrag, setFlowDrag] = useState(null);

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
  const [manualBoards, setManualBoards] = useState([]);

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
  const [boardKinds, setBoardKinds] = useState({});

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
  const [boardHeights, setBoardHeights] = useState({});

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
  const [boardOrders, setBoardOrders] = useState({});
  /* IS THE SWITCHBOARD TOOL OPEN? A step, like the door editor and the zone
     editor — it takes the panel over and stays open across placements, because
     somebody putting a board on one wall is usually putting one on three. */
  const [boardPlace, setBoardPlace] = useState(false);
  // The image that is actually sent. Held in state rather than made at call
  // time so the panel can show it: "what did it look at" is the first question
  // whenever an answer is strange, and a crop that is off the room or washed
  // out the wrong way is invisible in a list of zones.
  const [accentShot, setAccentShot] = useState(null);

  // --- the render pass ------------------------------------------------------
  //
  // THE ONE PASS THAT DOES NOT READ THE DRAWING. Everything else in this app
  // starts from the plan; a plan is a horizontal cut and cannot say that there
  // is fluted panelling behind the bed. So this one takes PHOTOGRAPHS — renders,
  // views — of a space, reads the wall features off them in English, and then
  // puts that English back onto the plan against a 1ft grid. Two model calls,
  // both in wallPrompt.js, which is also where both prompts live.
  //
  // Keyed by outline id like the accent pass, and for the same reason: the
  // renders somebody uploaded for Bedroom 2 must still be there after they click
  // through to Bedroom 3 and back.
  const [renders, setRenders] = useState({});          // roomId -> [shrunk render]
  /**
   * WHERE THOSE RENDERS WENT. roomId -> [{ path, name, w, h, bytes, ... }].
   *
   * The pointers, and the half of the pair that is SAVED — see planState.js.
   * `renders` above is the working copy: base64 in memory, which is what goes to
   * the model and what the thumbnails draw. This is a storage key and ninety
   * bytes of description per view, which is what survives a reload.
   *
   * Two lists rather than one field with a mode, because they genuinely differ
   * in lifetime: a render dropped while the plan's row is still being inserted
   * has no path and works perfectly well for the pass, and a render restored
   * from the bucket has a path before its bytes have arrived.
   */
  const [renderRefs, setRenderRefs] = useState({});
  const [wallResults, setWallResults] = useState({});  // roomId -> { elements: [...] }
  const [wallState, setWallState] = useState({ status: 'idle', roomId: null });
  // The gridded crop, made eagerly so the panel can show it — same argument as
  // accentShot, one step stronger: a grid drawn the wrong way up is invisible in
  // a list of cell references and obvious in a thumbnail with numbers on it.
  const [wallShot, setWallShot] = useState(null);
  // WHAT WENT AND WHAT CAME BACK, per room, so the panel can put both on screen.
  //
  // NOT IN `wallResults`, AND THEREFORE NOT SAVED. The results are a few hundred
  // bytes of cells that must survive a reload; a transcript is several kilobytes
  // of prompt and worksheet per room, it describes ONE run rather than the state
  // of the plan, and it would be stale the moment anything was re-analysed. It
  // belongs to the session, like the renders it came from. See planState.js.
  const [wallTranscripts, setWallTranscripts] = useState({});
  /**
   * THE LENGTHS SOMEBODY CHANGED BY HAND. run id -> { a, b } in FEET.
   *
   * Reverse coves and shelf strips are derived, not placed — see trimWallRun for
   * why the EDIT is stored rather than the result. Two numbers per run: how far
   * each end was moved from where the rule put it. Everything else stays
   * derived, so a trimmed cove still follows its wall when the outline moves and
   * still redraws at the right size when the scale changes.
   *
   * Keyed by the run's own id rather than per room, because a room can hold
   * several and they are edited one at a time.
   */
  const [runTrims, setRunTrims] = useState({});

  /**
   * WHICH CATEGORY OF THE EDIT TOOLBOX IS OPEN.
   *
   * A view preference and nothing else — it says which of three palettes is on
   * screen and never reaches the drawing, which is why it is not in
   * planState.js. Reopening a plan on the tab you left it on would be a nicety;
   * reopening it with a tool armed under a tab you cannot see would be a bug,
   * and the two arrive together the moment this is persisted.
   */

  // Editing what the model proposed. A fitting is a starting point, not a
  // verdict — see the note in accentPlace.js.
  // --- task surfaces --------------------------------------------------------
  // The third layer. Ambient covers the ceiling, accent picks out a surface for
  // the look of it, and a TASK surface is a plane somebody works at. This pass
  // only FINDS them — same order the accent pass was built in, and the order
  // that made its one real failure obvious instead of mysterious.
  // WHAT KIND OF PROJECT. Asked once, on upload, and everything conditional
  // downstream reads it — see roomTypes.js for why it is asked rather than
  // guessed.
  // The kind of BUILDING — residential, hotel, office (see roomTypes.js), and
  // not the database project, whose id never enters this component. Seeded from
  // the project when the project knows: a plan added to a project already
  // classified as a hotel arrives classified.
  const [projectId, setProjectId] = useState(initialProjectType ?? null);
  const [roomTypes, setRoomTypes] = useState({});   // outline id -> {type,confidence,why}
  // The pipeline's own state while it runs. Null when it is not running, which
  // is also what the loader keys off.
  const [prep, setPrep] = useState(null);
  const cancelPrep = useRef(false);

  const [surfaceRoomId, setSurfaceRoomId] = useState(null);
  const [surfaceResults, setSurfaceResults] = useState({});
  const [surfaceState, setSurfaceState] = useState({ status: 'idle', roomId: null });
  const [surfaceDismissed, setSurfaceDismissed] = useState([]);
  // THE ART SOMEBODY DECIDED NOT TO LIGHT, by wall-element id. Deleting a spot
  // aimed at a painting takes the piece out of the LIGHTING design, not out of
  // the render pass's reading of the wall — see planState.js.
  const [artDismissed, setArtDismissed] = useState([]);
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
  const [undoDepth, setUndoDepth] = useState({ past: 0, future: 0 });

  const selAccId = idOf(sel, 'acc');
  const [accDrag, setAccDrag] = useState(null);   // {roomId, id, mode}
  // Not on the plan, and every mounting height and throw distance depends on
  // it. One field, and load-bearing — see the header of accentPrompt.js.
  const [ceilingFt, setCeilingFt] = useState(10);

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
  const [scaleMode, setScaleMode] = useState('door');   // door | ref
  const [refId, setRefId] = useState('door900');
  const [customFt, setCustomFt] = useState(3);
  const [measure, setMeasure] = useState({ a: null, b: null });

  // The doors found on upload, and the one the user picked as the ruler.
  const [doors, setDoors] = useState([]);
  const [doorState, setDoorState] = useState({ status: 'idle' });
  const [doorPick, setDoorPick] = useState(null);   // {id, mm} | {id, mm:null} while choosing
  const [doorNonce, setDoorNonce] = useState(0);    // bumping this looks again

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
  const [doorsOk, setDoorsOk] = useState(false);
  const [doorEdit, setDoorEdit] = useState(false);
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
  const [layers, setLayers] = useState(LAYER_DEFAULTS);
  const [zoom, setZoom] = useState(1);
  // WHICH HALF OF THE DELIVERABLE IS ON SCREEN. A schedule is not a second view
  // of the drawing — it is the other half of what leaves the studio, read at a
  // different moment by a different person. So it replaces the canvas rather
  // than crowding it.
  /* THE SPACES TAB IS WHERE THIS OPENS NOW, and it used to be Design. The
     Design tab was the toolbox — two palettes and a View disclosure — and the
     palettes are the left-hand rail (see ToolRail); what a plan opens ON should
     be what it is FOR, which is the list of spaces and what each of them is.
     A saved plan still comes back on whatever tab it was left on: this is the
     default, not an override — see `ui.view` in planState.js. */
  const [view, setView] = useState('spaces');  // spaces | design | boards | boq | admin
  // How far the pointer must travel before a press becomes a drag, in SCREEN
  // pixels — divided by the zoom at the point of use, so it is the same
  // distance under the hand at 40% and at 300%.
  const DRAG_SLOP_PX = 3;
  const [over, setOver] = useState(false);
  // null = not editing. An empty string is a legitimate draft mid-edit, so the
  // two cannot share a value.
  const [nameDraft, setNameDraft] = useState(null);
  // THE AUDIT OVERLAY — the task-surface highlights, the beds the detector
  // found, the render pass's wall cells. Invisible to everyone but an owner
  // either way: every use of it downstream is gated `isAdmin && audit`.
  //
  // OFF BY DEFAULT, and back to off after a spell on. The argument for on was
  // that an owner opens a plan in order to look at the readings, so a default
  // of off cost two clicks before the drawing showed the thing being debugged.
  // Two clicks is the cheaper mistake.
  //
  // BECAUSE THE COST OF ON IS THE EXPORTS, and nothing filters this overlay out
  // of them — the PNG and the SVG serialise the live canvas. On by default meant
  // every owner who exported a sheet without first remembering a switch they
  // never touched put lit, captioned boxes on a client's drawing. A default is
  // exactly the setting nobody remembers, which is the wrong place to put a
  // thing that has to be turned off before the work leaves the building.
  const [audit, setAudit] = useState(false);
  /* THE PLANNER'S GRID, ON THE DRAWING, ON REQUEST — the chunk boxes and the
     cell lines the downlights were laid on. Separate state from `audit` and not
     a layer, on purpose: `audit` is what the MODELS read off the plan, and this
     is what OUR OWN code did with it afterwards. They are debugged at different
     moments and by different people, and folding the grid into `audit` would
     mean nobody can look at a chunk split without also lighting up every task
     surface on the sheet. Admin-only, and it carries the same export caveat the
     audit overlay does. */
  const [showGrid, setShowGrid] = useState(false);
  // A SWITCH OF ITS OWN, not a row under `audit`. The bed and surface overlays
  // are looked at while asking why a layout came out the way it did; the doors
  // are looked at while asking whether the SCALE is right, which happens on
  // arrival and usually with nothing else on screen. One checkbox for both
  // would mean turning on four overlays to check one number.
  const [auditDoors, setAuditDoors] = useState(false);
  /* THE BEDS, ON A THIRD SWITCH, for the reason the doors have a second one.
     They were dropped from `audit` when that overlay began opening by default —
     see the note in PlanCanvas's bed group — and what was lost with them is the
     only view of a fact the layout obeys but never draws: a bed moves every
     downlight around it and appears nowhere on the sheet. Asked on its own,
     because "is that bed right" is a question about one room at one moment, not
     a thing to have standing on. */
  const [auditBeds, setAuditBeds] = useState(false);
  const svgRef = useRef(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS) || '{}');
      if (saved.provider) setProvider(saved.provider);
    } catch { /* first run */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(LS, JSON.stringify({ provider })); } catch { /* private mode */ }
  }, [provider]);

  // --- load -----------------------------------------------------------------
  const resetForNewPlan = useCallback(() => {
    setMeasure({ a: null, b: null }); setZoom(1);
    // NOTHING IS PICKED ON A FRESH SHEET. One line for what used to be eight,
    // and the three it used to miss — a COB, an array, a module — go with it.
    setSel(clear());
    setZones([]); setZoneMode(false); setDraftZone(null); setZoneEdit(false);
    setChunkPicks({}); setPickingId(null);
    setCeilingKinds({}); setDesignPicks({}); setOptionPick(null);
    setDetections([]); setDetectState({ status: 'idle' }); setDismissed([]);
    setRoomState({ status: 'idle' });
    setAccentRoomId(null); setAccentResults({});
    // The plates somebody threw away go with the plan they were on: a board id
    // names a room and a rule, and neither means anything on a fresh sheet.
    setBoardsOff([]); setBoardMoves({}); setBoardPoints({});
    setBoardDrag(null);
    setFlowBoards({}); setFlowBends({}); setFlowDrag(null);
    setManualBoards([]); setBoardKinds({}); setBoardHeights({}); setBoardOrders({});
    setBoardPlace(false);
    setAccentState({ status: 'idle', roomId: null }); setAccentDismissed([]); setAccentShot(null);
    setRenders({}); setRenderRefs({});
    setWallResults({}); setWallTranscripts({}); setRunTrims({});
    // The hand-placed coves go with the trims, because they are the same
    // subject: a slot is set out against ONE plan's walls and means nothing
    // against another's. `runTrims` was already cleared here and leaving the
    // coves behind would have carried a previous drawing's slots onto a fresh
    // sheet, where they would sit at whatever plan pixels they were drawn at.
    setManualCoves([]); setCoveFrom(null); setCoveNote('');
    setWallState({ status: 'idle', roomId: null }); setWallShot(null);
    setAccDrag(null);
    // BACK TO THE PROJECT'S ANSWER, NOT TO NULL. This runs on every file load,
    // including the one that opens a saved plan, and blanking it here would put
    // the plan-level dialog back in front of a user whose project already
    // answered the question.
    setProjectId(initialProjectType ?? null);
    setRoomTypes({}); setPrep(null); cancelPrep.current = false;
    setDoors([]); setDoorPick(null); setDoorState({ status: 'idle' });
    // ...AND THE CONFIRMATION GOES WITH THEM. It is an answer about ONE set of
    // door boxes; carrying it onto a fresh sheet would draw wiring off a
    // detection nobody has looked at.
    setDoorsOk(false); setDoorEdit(false);
    setDoorDraft(null); setDoorDrag(null);
    setSurfaceRoomId(null); setSurfaceResults({});
    setSurfaceState({ status: 'idle', roomId: null }); setSurfaceDismissed([]);
    setArtDismissed([]);
    setCeilingObjs([]); setObjMode(false); setObjDrag(null);
    // AND THE DRAWN COVES, for the reason the hand-placed slots above go: a
    // shape is set out in ONE plan's feet, and carrying it onto a fresh sheet
    // would put a cove at whatever coordinates it happened to be drawn at.
    setCeilingShapes([]); setShapeDrag(null);
    setShapeEditId(null); setShapeResize(null);
    // The hand positions go with the grid they were chosen on: a cell key names
    // a rectangle in ONE plan's feet and means nothing in another's.
    setLightMoves({}); setLightDrag(null);
    setShapeMenuOn(false); setShapeTool(null);
    setShapeSpan(null); covePen.reset(); setShapeAt(null); setShapeHeld(null);
    setShapeAskSides(false);
    // AND THE DRAWN TRACKS, which go for the same reason the shapes do: a path
    // is clicked out in ONE plan's feet.
    setManualTracks([]); trackPen.reset();
    /* AND THE MODULES. The RUNS go with `ceilingShapes` a few lines up — a
       magnetic track is a shape — but a module is keyed by a shape id, so
       leaving these would carry a new plan's first track a set of diffusers
       belonging to the last one. */
    setTrackFixtures([]); setTrackMode(null);
    setArmed(null); setGuides([]); setGhost(null);
    setOutlines([]); setSelectedOutlineId(null); setLitIds([]); setFocusId(null);
    setOutlinesOpen(false); setDirtyIds([]);
    setUnitId(null);
  }, [initialProjectType, covePen, trackPen]);

  /**
   * Render one page of an open PDF and become a raster plan.
   *
   * `resetForNewPlan` runs AFTER the image is set, exactly as the image path
   * does, because the reset is what clears the previous drawing's outlines and
   * detections — doing it first would clear the state of a load that then fails
   * and leave the user with nothing instead of with what they had.
   */
  const openPdfPage = useCallback(async (doc, pageNo, name) => {
    setBusy('Rendering the page…');
    try {
      const im = await pageToImg(await doc.render(pageNo), { name });
      setDxf(null);
      setImg(im);
      setPdfPage(pageNo);
      resetForNewPlan();
    } finally { setBusy(''); }
  }, [resetForNewPlan]);

  // Bumped on every PDF opened, so the thumbnail loop of an abandoned document
  // stops rendering into a picker nobody is looking at.
  const pdfRun = useRef(0);

  const loadPdf = useCallback(async (file) => {
    const run = ++pdfRun.current;
    setBusy('Reading the PDF…');
    let doc = null;
    try {
      doc = await openPdf(file);
      // A REOPENED PLAN DOES NOT ASK AGAIN. The page that was chosen last time
      // is part of what "this plan" means, so a drawing set opens on its plan
      // sheet rather than on its title page.
      const saved = initialPdfPage && initialPdfPage <= doc.pages ? initialPdfPage : null;
      if (doc.pages === 1 || saved) {
        await openPdfPage(doc, saved || 1, file.name);
        doc.destroy();
        return;
      }

      setPdfPick({ name: file.name, pages: doc.pages, thumbs: {}, doc });
      setBusy('');
      // ONE AT A TIME. A forty-sheet set rendered in parallel is forty canvases
      // of a document that is still being parsed; sequentially, the first
      // thumbnails appear immediately and the rest fill in while the user is
      // already looking.
      for (let n = 1; n <= doc.pages; n++) {
        if (pdfRun.current !== run) return;
        const t = await doc.thumb(n);
        if (pdfRun.current !== run) return;
        setPdfPick((prev) => (prev && prev.doc === doc
          ? { ...prev, thumbs: { ...prev.thumbs, [n]: t.src } } : prev));
      }
    } catch (err) {
      console.warn('[pdf] could not be read', err);
      // The dropzone's error slot. It is called `dxf` because the DXF parser was
      // the first thing that could fail to open; it is the load-error channel
      // for every route in.
      setDxf({ error: `That PDF could not be read — ${err.message || err}`, name: file.name });
      setImg(null);
    } finally { if (pdfRun.current === run) setBusy(''); }
  }, [initialPdfPage, openPdfPage]);

  const loadFile = useCallback((file) => {
    if (!file) return;
    // THREE WAYS IN, TWO PIPELINES. A PDF is rasterised and then travels the
    // image path exactly — see the header of pdfPlan.js for why it is not
    // treated as vector data despite being made of vectors.
    if (isPdf(file)) { loadPdf(file); return; }
    const isDxf = /\.dxf$/i.test(file.name) || file.type === 'application/dxf' || file.type === 'image/vnd.dxf';

    if (isDxf) {
      const reader = new FileReader();
      reader.onload = () => {
        setBusy('Reading the drawing…');
        // Parsing is synchronous and can take a moment on a big drawing, so
        // let the busy pill paint before we block on it.
        setTimeout(() => {
          try {
            const drawing = parseDXF(String(reader.result));
            if (!drawing.ok) { setDxf({ error: drawing.reason, name: file.name }); setImg(null); return; }
            setImg(null);
            setDxf({ drawing, name: file.name });
            resetForNewPlan();
          } finally { setBusy(''); }
        }, 20);
      };
      reader.readAsText(file);
      return;
    }

    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result;
      const el = new Image();
      el.onload = () => {
        setDxf(null);
        setImg({ src, el, w: el.naturalWidth, h: el.naturalHeight, name: file.name,
                 base64: String(src).split(',')[1], mime: file.type });
        resetForNewPlan();
      };
      el.src = src;
    };
    reader.readAsDataURL(file);
  }, [resetForNewPlan, loadPdf]);

  // --- the plan source ------------------------------------------------------
  // A DXF becomes a virtual image of exactly known scale, so the pixel-space
  // pipeline below it does not need to know which kind of plan it is looking at.
  const source = useMemo(() => {
    if (dxf?.drawing) {
      const chosen = unitId ? UNITS.find((u) => u.id === unitId) : null;
      const drawing = chosen
        ? { ...dxf.drawing, units: { ...chosen, source: 'chosen' } }
        : dxf.drawing;
      return vectorSource(drawing, { name: dxf.name });
    }
    if (img) return rasterSource(img);
    return null;
  }, [dxf, img, unitId]);
  const isVector = source?.kind === 'vector';

  /* THE INVERSION IS DONE TO THE PIXELS, NOT WITH A CSS FILTER, and that is a
     correction rather than a preference. A filter has to land on whichever
     element happens to be painting the plan, and this app paints it two
     different ways — an SVG `<image>` here, a Konva `<canvas>` on the tracing
     screen — so "it works" was true of one renderer at a time and false on
     screen. Reading the bitmap out, subtracting every channel from 255 and
     handing back the result is renderer-independent: whatever draws this image
     draws an inverted image, because the image IS inverted.
     ALPHA IS LEFT ALONE. Inverting it would turn a transparent margin opaque. */
  const [invertedSrc, setInvertedSrc] = useState(null);
  useEffect(() => {
    if (!layers.invert || isVector || !source?.el) { setInvertedSrc(null); return; }
    try {
      const cv = document.createElement('canvas');
      cv.width = source.w; cv.height = source.h;
      const cx = cv.getContext('2d');
      cx.drawImage(source.el, 0, 0, source.w, source.h);
      const frame = cx.getImageData(0, 0, source.w, source.h);
      const px = frame.data;
      for (let i = 0; i < px.length; i += 4) {
        px[i] = 255 - px[i]; px[i + 1] = 255 - px[i + 1]; px[i + 2] = 255 - px[i + 2];
      }
      cx.putImageData(frame, 0, 0);
      setInvertedSrc(cv.toDataURL('image/png'));
    } catch (e) {
      // A cross-origin bitmap taints the canvas and `getImageData` throws. The
      // plan then simply shows as scanned rather than the screen breaking.
      console.warn('[app] the plan could not be inverted', e);
      setInvertedSrc(null);
    }
  }, [layers.invert, isVector, source]);

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

  // TRUE FOR THE WHOLE LIFE OF A RESTORED PLAN, not just until the restore
  // lands. It is what stops the four detectors below from firing on a drawing
  // whose answers are already saved — four model calls, real money, and the
  // results would overwrite the corrections the user made last time. Their
  // explicit re-run buttons bump a nonce, and a non-zero nonce means the user
  // asked, so it goes through.
  const restoring = useRef(!!restore);
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
   * Stable for the life of the component: every value in it is a useState setter
   * except the `setLayers` wrapper, which closes over one.
   */
  const stateSetters = useMemo(() => ({
    setUnitId, setScaleMode, setRefId, setCustomFt, setMeasure, setDoorPick, setCeilingFt,
    setOutlines, setLitIds, setDirtyIds, setFocusId, setSelectedOutlineId, setRoomState,
    // `projectId` in here is the kind of BUILDING (residential, hospitality —
    // see roomTypes.js), not the database project. The alias is the whole
    // reason planState.js calls it projectType.
    setProjectType: setProjectId,
    setPdfPage,
    setRoomTypes, setDetections, setDismissed, setBedVerdicts, setProvider, setZones,
    setDoors, setDoorState, setDoorsOk, setDetectState,
    setCeilingObjs, setChunkPicks, setCeilingKinds, setDesignPicks, setCeilingShapes,
    setLightMoves,
    setAccentResults, setAccentDismissed, setManualAccents,
    setSurfaceResults, setSurfaceDismissed, setManualSurfaces, setArtDismissed,
    setBoardsOff, setBoardMoves, setBoardPoints, setFlowBoards, setFlowBends,
    setManualBoards, setBoardKinds, setBoardHeights, setBoardOrders,
    setCeilingMm, setMaterials, setFixtureWatts, setRunsOff,
    // THE ELEMENTS COME BACK, THE RENDERS DO NOT. See planState.js: the cells
    // are a few hundred bytes of JSON and the renders are megabytes of
    // somebody's photographs, which do not belong in a jsonb column.
    setWallResults,
    // ...and the lengths somebody dragged. Two numbers per run, and the only
    // thing about these derived fittings a person actually chose.
    setRunTrims, setManualCoves, setManualTracks,
    // ...and the downlights somebody put down themselves, which carry their own
    // wattage and beam angle. See `manualCobs`.
    setManualCobs, setAutoSpots, setCobArrays, setTrackFixtures,
    // ...and where the views themselves are. The bytes are fetched back out
    // of the bucket by the effect below, lazily and per space.
    setRenderRefs,
    // MERGED OVER THE DEFAULTS, not assigned. See LAYER_DEFAULTS.
    setLayers: (saved) => setLayers({ ...LAYER_DEFAULTS, ...(saved || {}) }),
    setZoom, setView,
  }), []);

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

  // --- traced outlines ------------------------------------------------------
  // Stored in the plan's own units and resolved into the current pixel space
  // for use. On a DXF that indirection is load-bearing: correct the unit
  // interpretation and the outline is reinterpreted exactly as the walls are,
  // so it stays on its walls instead of sliding off them. On an image the pair
  // is the identity — its pixels ARE its units — and the same code runs.
  const outlinesPx = useMemo(() => {
    if (!source) return [];
    return outlines.map((o) => ({
      ...o,
      pointsPx: o.pointsDu.map(source.fromDu),
      enclosingPx: o.enclosingDu ? o.enclosingDu.map((poly) => poly.map(source.fromDu)) : null,
    }));
  }, [source, outlines]);

  /**
   * A room that sits wholly inside another becomes a NO-LIGHT ZONE in the outer
   * one.
   *
   * Subtracting it would be better and is what happens whenever the geometry
   * allows (see roomBooleans.js) — but an annulus is not a polygon the planner
   * can lay a grid inside, and the alternative to this is a ceiling laid over a
   * room that is not the room being lit. The zone is keyed to the OUTER room
   * only: put it in the global list and the inner room would find a no-light
   * zone covering the whole of itself and come back with no lights at all.
   */
  const enclosedZones = useCallback((outline) => {
    if (!outline?.enclosingPx?.length) return [];
    return outline.enclosingPx.map((poly, i) => {
      const b = bbox(poly);
      return { id: `encl-${outline.id}-${i}`, source: 'enclosed', cls: 'room',
               x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY };
    });
  }, []);

  const litOutlines = useMemo(
    () => outlinesPx.filter((o) => litIds.includes(o.id)),
    [outlinesPx, litIds]);

  /* WHICH SPACES ARE LIT, READABLE FROM A CALLBACK. `markChanged` runs inside
     the edit handlers and has to know whether the outline it is about to mark is
     already lit; reading `litIds` through a `setLitIds` reducer to peek at it
     would mean a `setDirtyIds` call inside another setter's reducer, and React
     is free to invoke a reducer twice. Same pattern as `roomsRef` below. */
  const litRef = useRef(litIds);
  litRef.current = litIds;

  const commitOutline = useCallback((pointsPx) => {
    if (!source) return;
    const o = makeOutline(pointsPx, { name: nextOutlineName(outlines) });
    const stored = { id: o.id, name: o.name, rectify: o.rectify,
                     detected: false, reviewed: true,
                     pointsDu: pointsPx.map(source.toDu) };
    setOutlines((os) => [...os, stored]);
    setSelectedOutlineId(stored.id);   // highlight it; confirming is a separate act
  }, [source, outlines]);

  /**
   * A ROOM IS MARKED DIRTY ONLY IF IT IS LIT. An outline nobody has lit yet is
   * not a space whose answers have gone stale — it is a space with no answers,
   * which the tracer already reports as "not lit". Kept as a callback so the two
   * edit paths below cannot drift on the condition.
   */
  const markChanged = useCallback((id) => {
    if (!litRef.current.includes(id)) return;
    setDirtyIds((d) => (d.includes(id) ? d : [...d, id]));
  }, []);

  const updateOutline = useCallback((id, patch) => {
    // `rectify` SQUARES THE POLYGON, so it moves corners and counts as a change.
    // A rename does not, and marking on one would offer a paid relight for
    // having typed a better name.
    if ('rectify' in patch) markChanged(id);
    setOutlines((os) => os.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }, [markChanged]);

  const deleteOutline = useCallback((id) => {
    setOutlines((os) => os.filter((o) => o.id !== id));
    setSelectedOutlineId((s) => (s === id ? null : s));
    setLitIds((ids) => ids.filter((x) => x !== id));
    // A SPACE THAT IS GONE IS NOT A SPACE THAT CHANGED. Left in, its id would
    // sit in the dirty list for ever, and the tracer would offer a relight of a
    // room that no longer exists.
    setDirtyIds((d) => d.filter((x) => x !== id));
    setFocusId((f) => (f === id ? null : f));
  }, []);

  /**
   * Editing an outline's corners.
   *
   * All three go through the SAME conversion the tracer's own commits do: the
   * point arrives in pixels, it is stored in the plan's own units. That is what
   * keeps a nudged corner on its wall when the DXF's unit interpretation is
   * corrected afterwards — the alternative, storing what the grip was dragged
   * to, slides every correction off the drawing the moment the units change.
   *
   * Touching an outline marks it REVIEWED, which is the only thing that
   * distinguishes a proposal someone has looked at from one nobody has. It is
   * not the same as confirming it: it means the dashed line goes solid, because
   * the corner is now where a person put it.
   */
  const editPoints = useCallback((id, fn) => {
    if (!source) return;
    markChanged(id);
    setOutlines((os) => os.map((o) => {
      if (o.id !== id) return o;
      const px = o.pointsDu.map(source.fromDu);
      const next = fn(px);
      if (!next || next.length < 3) return o;
      return { ...o, reviewed: true, pointsDu: next.map(source.toDu) };
    }));
  }, [source, markChanged]);

  const movePoint = useCallback((id, index, pointPx) => {
    editPoints(id, (px) => px.map((p, i) => (i === index ? pointPx : p)));
  }, [editPoints]);

  const insertPoint = useCallback((id, index, pointPx) => {
    editPoints(id, (px) => [...px.slice(0, index), pointPx, ...px.slice(index)]);
  }, [editPoints]);

  const removePoint = useCallback((id, index) => {
    editPoints(id, (px) => (px.length > 3 ? px.filter((_, i) => i !== index) : px));
  }, [editPoints]);

  // THE RED-CIRCLE FAN DETECTOR IS GONE.
  //
  // It scanned the raster for round red blobs, called each one a ceiling fan,
  // and — for a while — used their blade circles as the drawing's RULER. Both
  // halves of that have been retired. The scale comes from a door, which is a
  // thing that is actually standard; and a fan is now placed by hand from the
  // ceiling palette, in feet, like every other object on the ceiling.
  //
  // The reason to delete it rather than leave it switched off: it was guessing
  // from COLOUR, which is the least reliable signal on a drawing — a red
  // dimension leader, a north arrow, a revision cloud, a hatched WC are all
  // round-ish and red-ish on some office's sheet. A detector nobody trusts
  // still fills a state array that eight other things read from, and it
  // silently placed obstacles the user never asked for.
  //
  // What stays is everything downstream: `fanClearance`, the chunker's
  // preference for holding an obstacle clear, `cellIsAwkward`. Those never cared
  // where an obstacle came from — planner.js calls them "fans" because that was
  // the first kind it met.

  // --- scale ----------------------------------------------------------------
  const pxPerFt = useMemo(() => {
    // A DXF states its own scale. There is nothing to measure and nothing to
    // guess, so the scale controls are not offered at all.
    if (isVector) return source.pxPerFt;
    if (scaleMode === 'ref') {
      if (!measure.a || !measure.b) return null;
      const len = Math.hypot(measure.b.x - measure.a.x, measure.b.y - measure.a.y);
      const ref = REFERENCES.find((r) => r.id === refId);
      return scaleFromReference(len, ref?.ft ?? customFt);
    }
    // A door picked and named. Until BOTH have happened there is no scale —
    // a clicked door with no width yet is a question, not an answer.
    if (!doorPick?.id || !doorPick.mm) return null;
    // THE PICK CARRIES ITS OWN RECT, AND THAT IS WHAT MAKES THE DOOR EDITOR
    // SAFE. This used to read the rect out of `doors` and nothing else — which
    // was fine while that list was written once by the detector and never
    // touched. The confirm-the-doors step can now move a box or throw one away,
    // and if that box happened to be the ruler the scale of the entire drawing
    // changed underneath a finished layout: every fitting, every metre of strip
    // and the whole schedule, silently, from a gesture about switchboards.
    //
    // The snapshot is taken when the door is CLICKED as the ruler — see
    // `onPickDoor` on the tracer screen — so the scale is anchored to the box
    // that was measured rather than to whatever is in the list now. The lookup
    // stays first, and is what keeps a plan saved before this existed working:
    // its `doorPick` has no rect, and its doors have never been editable.
    const d = doors.find((q) => q.id === doorPick.id);
    const rect = d?.rect ?? doorPick.rect ?? null;
    return rect ? scaleFromDoor(rect, doorPick.mm) : null;
  }, [isVector, source, scaleMode, measure, refId, customFt, doors, doorPick]);

  /**
   * EVERY OBSTACLE ON THE CEILING, in plan pixels.
   *
   * One source since the red-circle detector was removed: the objects somebody
   * placed. They are held in FEET and converted here, which is what keeps them
   * the same real size when the scale is corrected underneath them.
   *
   * The planner is handed { x, y, r } and is not told what kind of thing it is
   * looking at — see the note in planner.js about why it calls them all fans.
   */
  const obstaclesPx = useMemo(() => {
    if (!pxPerFt) return [];
    return ceilingObjs.map((o) => toObstaclePx(o, pxPerFt));
  }, [ceilingObjs, pxPerFt]);

  /**
   * ...AND THE ONES THE GRID ACTUALLY HAS TO KEEP OFF.
   *
   * NOT ALL OF THEM, SINCE THE PALETTE GREW. A split AC's indoor unit hangs at
   * 2100mm on a wall and a geyser sits above a toilet door: both are placed on
   * this plan, both are drawn, both are on the schedule, and neither obstructs a
   * downlight in the middle of a ceiling. Handing them to the planner would
   * punch a hole in the layout for something that is not in its way — and
   * because clearance is circumscribed (see ceilingObjects.js), a 1000mm split
   * unit would reserve a two-and-a-half-foot radius of ceiling it is nowhere
   * near.
   *
   * ONE FLAG, ASKED OF THE CATALOGUE, and this is the only place it is read. The
   * full list stays whole for everything else — the canvas draws them, the
   * schedule counts them, the DXF and the plot carry them — because being off
   * the ceiling is a fact about clearance and about nothing else.
   */
  const ceilingObstaclesPx = useMemo(
    () => obstaclesPx.filter((o) => !o.offCeiling), [obstaclesPx]);

  /**
   * THE BUILT AREA, in square feet — the sum of the spaces, not the sheet.
   *
   * The sheet is the wrong measure and it would be the easy one: it includes the
   * title block, the margins and whatever site plan is sitting off to the side,
   * so the same building drawn on A1 and A0 would be two different sizes. The
   * spaces are what the models are being asked about.
   *
   * Null until there is a scale, which on a raster means until a door has been
   * measured. Everything that reads this treats null as "not known yet" rather
   * than as small — see the note on the bed pass.
   */
  const planAreaSqft = useMemo(() => {
    // `outlinesPx`, NOT `outlines`, AND THE DIFFERENCE BLANKED THE SCREEN.
    //
    // An outline is STORED in drawing units — `pointsDu` — and resolved into
    // pixels by the outlinesPx memo above. Everything that measures one goes
    // through that resolved list; the raw one is the storage format. A
    // detector-proposed outline in particular has no `pointsPx` at all (see
    // where `made.push` builds them), so handing a raw outline to outlineStats
    // reaches `ensureCCW(undefined)` and throws — during render, which in React
    // means the whole tree unmounts and the app is a white page.
    //
    // It surfaced at the strangest possible moment: this memo returns null until
    // there is a scale, so the crash landed the instant somebody set a door's
    // width. Two features away from its cause.
    if (!pxPerFt || !outlinesPx.length) return null;
    let a = 0;
    for (const o of outlinesPx) a += outlineStats(o, pxPerFt)?.areaSqft ?? 0;
    return a || null;
  }, [outlinesPx, pxPerFt]);

  // ---------------------------------------------------------------------------
  // LIGHTING A SPACE COSTS SOMETHING, AND THESE THREE ARE WHERE IT IS ASKED FOR.
  //
  // THEY SIT HERE, BELOW `pxPerFt`, AND THE POSITION IS LOAD-BEARING. A hook's
  // dependency array is evaluated DURING RENDER, so `[..., pxPerFt]` a hundred
  // lines above the `const pxPerFt` it names is a temporal-dead-zone
  // ReferenceError on the first paint — which in React means the whole tree
  // unmounts and the app is a white page. The same trap as the `outlinesPx`
  // note above, arrived at from the other direction: there the value was wrong,
  // here it does not exist yet.
  // ---------------------------------------------------------------------------
  /**
   * CLAIM THE SPACES ABOUT TO BE LIT, AND SAY WHETHER TO GO ON.
   *
   * Every route into a layout goes through here — the tracer's Light button, the
   * panel's "Light all N outlines", a single room confirmed by double-click, and
   * the pipeline itself. Four call sites and one gate, because a fifth route
   * added later that forgot to ask would be a free tier with no ceiling.
   *
   * SAFE TO CALL FROM ALL FOUR, because the claim is keyed on the geometry of
   * each space (see fingerprintOutline in lib/plans.js). Lighting one room and
   * then the whole plan charges the room once, not twice; a double click charges
   * once; a re-light of untouched outlines charges nothing at all.
   *
   * NO SCALE, NO CHARGE. `outlineStats` needs px/ft to produce an area, and
   * without one nothing is laid out either — there is no cost to meter and no
   * layout to refuse. Letting it through is not a hole; it is the only reading
   * that is not an error message in front of a drawing that was never going to
   * light.
   */
  const claimSpaces = useCallback(async (ids) => {
    if (!onClaimLayout || readOnly) return true;
    const wanted = new Set(ids);
    const spaces = [];
    for (const o of outlinesPx) {
      if (!wanted.has(o.id)) continue;
      const sqft = outlineStats(o, pxPerFt)?.areaSqft ?? 0;
      if (!(sqft > 0)) continue;
      // THE RESOLVED PIXEL POINTS, not the stored drawing units, and the two are
      // interchangeable here for one reason: `pointsPx` is a deterministic
      // function of `pointsDu` and the source, so it is just as stable across a
      // reload — and it is the list that is guaranteed to exist. A
      // detector-proposed outline has no `pointsPx` until the memo above builds
      // them, which is the same trap documented at `planAreaSqft`.
      spaces.push({ id: o.id, points: o.pointsPx ?? [], pxPerFt, sqft });
    }
    if (!spaces.length) return true;
    const verdict = await onClaimLayout({ spaces });
    return !!verdict?.ok;
  }, [onClaimLayout, readOnly, outlinesPx, pxPerFt]);

  /** Light everything traced or proposed. The primary act on the tracer screen. */
  const lightWholePlan = useCallback(async () => {
    if (!await claimSpaces(outlines.map((o) => o.id))) return;
    setOutlines((os) => os.map((o) => ({ ...o, reviewed: true })));
    setLitIds(outlines.map((o) => o.id));
    // NOTHING IS SELECTED TO BEGIN WITH. `focusId` used to be seeded with the
    // first outline, which was harmless while it only decided which room the
    // panel described — it now also draws a blue outline on the canvas, and a
    // space highlighted because it happens to be first is a selection nobody
    // made. `focus` still falls back to rooms[0] for the panel's own purposes,
    // so the details pane is unaffected.
    setFocusId(null);
    setPickingId(null);
    setDirtyIds([]);
    setOutlinesOpen(false);
  }, [outlines, claimSpaces]);

  const lightOneRoom = useCallback(async (id) => {
    if (!await claimSpaces([id])) return;
    setOutlines((os) => os.map((o) => (o.id === id ? { ...o, reviewed: true } : o)));
    setSelectedOutlineId(id);
    setLitIds([id]);
    setFocusId(id);
    setPickingId(null);
    setDirtyIds((d) => d.filter((x) => x !== id));
    setOutlinesOpen(false);
    // CONFIRMING THE SPACES IS ITS OWN DATAPOINT — "here is what the segmenter
    // proposed and here is what a person accepted" — and it is worth recording
    // whether or not the pipeline is ever run on it.
    //
    // THE BEAT IS THE POINT. `milestone` is reassigned on every render and reads
    // the state of the render it was assigned in, so calling it synchronously
    // here would record the state as it was BEFORE the four setters above. A
    // quarter of a second is far longer than a commit needs and short enough
    // that nothing else can have happened.
    setTimeout(() => milestone.current?.('outlines'), 250);
  }, [claimSpaces]);

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

  // Every no-light zone on the plan, whoever drew it.
  //
  // A DETECTION IS A PROPERTY OF THE IMAGE, not of a room. The bed detector runs
  // on upload, before any boundary exists, and finds every bed on the sheet;
  // which of them is an obstacle depends on which ceiling is being laid out, and
  // that question is answered per room, below. So this list is unfiltered — it
  // is what the canvas draws — and the planner sees only the subset that falls
  // inside the room it is working on.
  /**
   * THE BEDS THE ACCENT PASS THOUGHT IT SAW — FOR THE AUDIT PANEL ONLY.
   *
   * NOTHING DOWNSTREAM OF THIS PLACES A LIGHT. These boxes are deliberately not
   * in `detectedZones`, so they do not reach the chunking, the no-light zones,
   * or the sconce rule. Read the header of `detectedZones` for why; the short
   * version is that the accent pass is a question about furniture in general,
   * where a bed arrives as a side effect and its box only ever had to be roughly
   * right. A bed's rectangle decides where the ceiling lights are NOT, and a
   * second looser opinion about the same mattress competing with a measured one
   * is how one bed became several stacked zones.
   *
   * It is still counted, and that is the whole point of keeping it: an exclusion
   * you can see is a decision, an exclusion you cannot is a bug. If this number
   * is high on a plan where bed-filter found nothing, that is worth knowing.
   *
   * FROM THE OUTLINES, NOT FROM `rooms`, AND THAT IS NOT A STYLE CHOICE. The
   * first version read `rooms`, which crashed the app on load with "Cannot
   * access 'rooms' before initialization" — and the temporal dead zone was only
   * the symptom. `rooms` is the LAID-OUT plan, computed from `zoneList`, which
   * is computed from these very zones: a bed moves the fittings around it, so
   * the layout cannot be an input to the beds without the beds being an input to
   * themselves. Reordering the declarations would have swapped the crash for an
   * infinite loop or a stale render.
   */
  const bedsPerRoom = useMemo(() => {
    const out = [];
    for (const o of outlines) {
      const found = accentResults[o.id]?.bedsFromAccentPass;
      if (!found?.length) continue;
      found.forEach((f, i) => {
        if (!f.rect) return;
        out.push({
          id: `bed-room-${o.id}-${i}`, cls: 'bed', conf: f.confidence ?? 0.8,
          rect: f.rect, roomId: o.id, closeUp: true,
        });
      });
    }
    return out;
  }, [outlines, accentResults]);

  const detectedZones = useMemo(() => {
    if (!source) return [];
    /* THREE SOURCES, ONE WINNER PER SPACE, IN A STATED ORDER.
     *
     * TWO SOURCES, AND THE ACCENT PASS IS NOT ONE OF THEM.
     *
     *   1. `bed-filter`, THE WHOLE PLAN — one trained segmenter, one call. The
     *      primary path, and the answer for very nearly every bed.
     *   2. GPT ON ONE BEDROOM CROP — and ONLY where the classifier called a
     *      space a bedroom and bed-filter put nothing in it. Where it exists it
     *      is the answer to a question the primary pass got wrong, so it wins
     *      for its own space.
     *
     * THE ACCENT PASS IS DELIBERATELY EXCLUDED, and this is the rule, not a
     * tuning choice: a bed's rectangle decides where the ceiling lights are NOT,
     * which moves real fittings. The accent pass is a question about furniture in
     * general — a wardrobe, a TV unit, a sofa — where a bed comes back as a side
     * effect and its box only ever had to be roughly right, because all it was
     * used for was hanging sconces off. Letting a box drawn to that standard
     * into the chunking meant a second, looser opinion about the same mattress
     * silently competing with a measured one. `bedsPerRoom` still exists and is
     * still shown in the audit panel; it does not reach this list.
     *
     * Matched by `roomId`, which every per-room bed carries, so this is set
     * membership and not a point-in-polygon guess.
     */
    const judged = detections.filter((d) => d.refound && d.roomId);
    const judgedRooms = new Set(judged.map((d) => d.roomId));
    const sheet = detections.filter((d) => {
      if (d.refound) return false;                       // counted in `judged`
      return !(d.roomId && judgedRooms.has(d.roomId));
    });
    const live = [...sheet, ...judged].filter((d) => !dismissed.includes(d.id));
    if (judged.length) {
      console.log(`[beds] ${live.length} zones = ${sheet.length} from bed-filter`
        + ` + ${judged.length} from a GPT bedroom crop`
        + ` (${bedsPerRoom.length} accent-pass beds deliberately excluded)`);
    }
    if (!live.length) return [];

    /**
     * THE PHYSICAL GATE, AND THIS IS THE RIGHT PLACE FOR IT.
     *
     * Every bed — from the whole-sheet pass, from a per-room re-ask, from a
     * reopened plan — becomes a no-light zone here and nowhere else, and by this
     * point the scale is known. So this is the one checkpoint that cannot be
     * bypassed by adding another detector later, and it re-runs if the scale is
     * corrected, which means a plan measured wrongly and then fixed does not
     * keep a set of beds sized for the wrong ruler.
     *
     * A LIGHT IS PLACED AROUND THESE RECTANGLES, so a wrong one is not a
     * cosmetic error: a box covering a whole bedroom moves every fitting in it.
     * The detector returning 121 beds on an 11-space plan is what this exists to
     * stop, and it stops it by knowing how big a bed is — see BED_FT.
     */
    const kept = [], tossed = [];
    for (const d of live) {
      const fit = plausibleBed(d.rect, pxPerFt);
      (fit.ok ? kept : tossed).push({ d, fit });
    }
    if (tossed.length) {
      console.warn(`[beds] rejected ${tossed.length} of ${live.length} as impossible`,
        tossed.slice(0, 12).map(({ d, fit }) => `${d.id}: ${fit.why}`));
    }
    const ok = kept.map(({ d }) => d);
    return zonesFromDetections(ok, { image: { w: source.w, h: source.h }, pxPerFt })
      .map((z, i) => ({ ...z, id: ok[i].id,
                        closeUp: !!ok[i].closeUp || !!ok[i].refound,
                        judged: !!ok[i].refound }));
  }, [detections, dismissed, source, pxPerFt, bedsPerRoom]);

  /**
   * THE REVERSE COVES, from the render pass's panelling and wallpaper.
   *
   * COMPUTED FROM THE OUTLINES AND NOT FROM `rooms`, and that is load-bearing
   * rather than tidy. A reverse cove is a no-light zone, no-light zones go into
   * the planner, and the planner is what builds `rooms` — so a memo over `rooms`
   * would be a cycle. It does not need one: the grid a cove is measured against
   * comes from the room's OUTLINE and the scale, both of which exist long before
   * anything is lit, and `regionFromOutline` is the same call the layout makes.
   *
   * See reverseCove.js for the rule. Merged, because a wall that came back both
   * panelled and papered is one wall and would otherwise get two bands in the
   * same eight inches of ceiling — drawn as one, billed as two.
   */
  const reverseCoves = useMemo(() => {
    if (!source || !pxPerFt) return [];
    const out = [];
    for (const o of litOutlines) {
      const res = wallResults[o.id];
      if (!res?.elements?.length) continue;
      const region = regionFromOutline(o, pxPerFt);
      if (!region?.ok) continue;
      const polygonPx = useBoundingRect ? region.boundingRect : region.polygon;
      const grid = gridFor(polygonPx, pxPerFt);
      if (!grid) continue;
      const mine = [];
      for (const e of res.elements) {
        // A LIST PER ELEMENT, because a wall with a door in it is two walls.
        // `doors` is the whole sheet's detections — the ones already found to
        // set the scale — and reverseCovesFor picks out the ones in this wall.
        const got = reverseCovesFor(e, grid, { pxPerFt, doors });
        got.forEach((rc, i) => mine.push({
          ...rc, roomId: o.id, elementId: e.id,
          id: `rcove-${e.id}-${i}`,
        }));
      }
      // MERGE FIRST, THEN TRIM. The merge decides which coves exist and what
      // their ids are; a trim is keyed to an id, so trimming before it would
      // apply somebody's drag to a run that is about to be absorbed into
      // another one.
      for (const c of mergeReverseCoves(mine, { pxPerFt })) {
        // ...AND NOT THE ONES SOMEBODY DELETED. Filtered here rather than where
        // the tape is shaped, because the tape is not the thing: a reverse cove
        // is 200mm of ceiling detail with a strip at its lip, and dropping only
        // the strip would leave the slot drawn on the plan with nothing in it.
        // See `runsOff`.
        if (runsOff.includes(c.id)) continue;
        out.push(trimWallRun(c, runTrims[c.id], { pxPerFt }));
      }
    }
    /* THE HAND-PLACED ONES JOIN HERE, AFTER THE MERGE AND THROUGH THE SAME TRIM.
       After the merge on purpose: `mergeReverseCoves` decides which detected
       coves exist and what they are called, and feeding a manual slot into it
       would let a detection absorb something a person set out by hand — the id
       would vanish and with it their edit. Through `trimWallRun` because that is
       what gives a run its draggable ends, and a hand-placed cove wanting the
       same grips as a detected one is the whole reason its shape matches.

       ONLY IN ROOMS THAT STILL EXIST. A cove is placed against a room's own
       wall; delete or re-trace the room and the slot has nothing to be on. It is
       filtered rather than deleted, so re-lighting the space brings it back. */
    const live = new Set(litOutlines.map((o) => o.id));
    for (const c of manualCoves) {
      if (!live.has(c.roomId)) continue;
      out.push(trimWallRun(c, runTrims[c.id], { pxPerFt }));
    }
    return out;
  }, [source, pxPerFt, litOutlines, wallResults, useBoundingRect, doors, runTrims,
      manualCoves, runsOff]);

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

  /**
   * THE WARDROBES THE ACCENT PASS FOUND, in plan pixels, room by room.
   *
   * `accentResults[id].furniture` is what the RULES saw — the list the strips
   * and sconces were derived from, with this pass's own loose bed boxes already
   * swapped for the measured ones (see `computeAccents`). So a wardrobe in here
   * is a wardrobe the app has already acted on: it is the reason there is a
   * strip along that wall, and this is the same rectangle that produced it.
   *
   * OFF `litOutlines` AND NOT `rooms`, which is not a style preference — it is
   * the only ordering that works. `rooms` is computed FROM the zone list, and
   * the zone list is about to contain these; reading `rooms` here would be a
   * cycle. The results are keyed by the outline's own id, so there is nothing
   * `rooms` could add.
   */
  const wardrobesPx = useMemo(() => {
    const out = [];
    for (const o of litOutlines) {
      for (const f of accentResults[o.id]?.furniture ?? []) {
        if (f.type !== 'wardrobe' || !f.rect) continue;
        out.push({ id: `wd-${f.id}`, roomId: o.id, rect: f.rect });
      }
    }
    return out;
  }, [litOutlines, accentResults]);

  /**
   * A WARDROBE IS A NO-LIGHT ZONE, on the same terms as a bed.
   *
   * A DOWNLIGHT OVER A WARDROBE LIGHTS THE TOP OF THE WARDROBE. It is a foot and
   * a half of dust-catcher at head height and the light lands on it, so the
   * fitting is spent on the one square metre of the room nobody looks at, and
   * the wall the wardrobe is on gets its light from the strip inside the unit —
   * which is why the strip is there. This is the same argument the bed makes
   * (nobody wants a downlight over a pillow) reaching the same list.
   *
   * DERIVED, NOT DRAWN, exactly like the beds. `drawnZones` is hand-drawn zones
   * and enclosed spaces only — see the note there about a hatched box over
   * somebody's bed on a sheet handed to a client. The zone moves the fittings
   * and does not argue about it on the drawing.
   *
   * IT ARRIVES AFTER THE FIRST LAYOUT, and that is fine and worth stating. The
   * accent pass runs on a space that is already lit, so the lights move once
   * when its answer lands — the same way they move when somebody boxes a zone
   * by hand. Nothing loops: `accentResults` is a stored answer, not a
   * derivation of the layout, so a re-layout does not re-run the pass.
   */
  const wardrobeZones = useMemo(
    () => wardrobesPx.map((w) => ({ id: w.id, roomId: w.roomId, ...w.rect,
                                    kind: 'wardrobe' })),
    [wardrobesPx]);

  /**
   * ...and as no-light zones, which is how "a reverse cove is a no-draw area"
   * is actually enforced.
   *
   * Not by a new rule in every placer — there are four of them and they would
   * drift — but by the band joining the list of rectangles that every placer in
   * this app already keeps out of. Eight inches of ceiling with tape in it is
   * exactly the same kind of fact as a hole for a beam.
   */
  const reverseCoveZones = useMemo(
    () => reverseCoves.map((c) => ({ id: c.id, roomId: c.roomId, ...c.rect,
                                     kind: 'reverse-cove' })),
    [reverseCoves]);

  /**
   * THE SHELF STRIPS, from the render pass's shelving.
   *
   * NOT A NO-DRAW AREA, unlike the reverse cove beside it, and the difference is
   * the difference between the two fittings. A reverse cove is a slot cut in the
   * CEILING: eight inches of it are gone and nothing else can go there. A shelf
   * strip is tape inside a piece of joinery standing against the wall — the
   * ceiling above it is ordinary ceiling, and a downlight in front of the unit is
   * a perfectly good thing to have. So this list is drawn and billed and changes
   * nothing about the layout.
   *
   * Same reason as the reverse coves for computing it off the OUTLINES: it does
   * not need `rooms`, and not depending on it keeps the two memos independent.
   */
  const shelfStrips = useMemo(() => {
    if (!source || !pxPerFt) return [];
    const out = [];
    for (const o of litOutlines) {
      const res = wallResults[o.id];
      if (!res?.elements?.length) continue;
      const region = regionFromOutline(o, pxPerFt);
      if (!region?.ok) continue;
      const polygonPx = useBoundingRect ? region.boundingRect : region.polygon;
      const grid = gridFor(polygonPx, pxPerFt);
      if (!grid) continue;
      for (const e of res.elements) {
        shelfStripsFor(e, grid, { pxPerFt, doors }).forEach((st, i) => {
          const id = `shelf-${e.id}-${i}`;
          // The same deletion the reverse coves answer to, and for the same
          // reason: nothing stores a shelf strip, so a deleted one has to be
          // recorded or it comes back on the next render. See `runsOff`.
          if (runsOff.includes(id)) return;
          out.push(trimWallRun({ ...st, roomId: o.id, elementId: e.id, id },
                               runTrims[id], { pxPerFt }));
        });
      }
    }
    return out;
  }, [source, pxPerFt, litOutlines, wallResults, useBoundingRect, doors, runTrims,
      runsOff]);

  // Hand-drawn zones and detected ones behave identically from here on — that
  // was the point of making a detection produce a rectangle rather than a new
  // kind of obstacle. So do the reverse coves.
  const zoneList = useMemo(
    () => [...zones, ...detectedZones, ...wardrobeZones, ...reverseCoveZones],
    [zones, detectedZones, wardrobeZones, reverseCoveZones]);

  // Which layers are walls, for the detector's render. classifyLayers already
  // works this out for room extraction; the same answer decides which lines get
  // drawn heavy. On APT_01 it picks "KMBD Walls" out of a drawing whose other
  // 1656 entities all sit on layer 0.
  const wallLayerSet = useMemo(() => {
    if (!isVector || !source?.drawing?.layers) return null;
    const { wallLayers } = classifyLayers(source.drawing.layers);
    return wallLayers.length ? new Set(wallLayers) : null;
  }, [isVector, source]);

  // Only the three settings that genuinely shape a decomposition are in this
  // dependency list, so moving an unrelated slider does not re-enumerate and
  // cannot invalidate a choice that is still perfectly valid.
  const chunkOpt = useMemo(
    () => ({ targetArea: opt.targetArea, minChunk: opt.minChunk,
             minChunkArea: opt.minChunkArea, fanClearance: opt.fanClearance }),
    [opt.targetArea, opt.minChunk, opt.minChunkArea, opt.fanClearance]);

  /**
   * THE WHOLE PLAN, ROOM BY ROOM.
   *
   * This used to be six hooks in a column — region, geo, chunking, the chosen
   * chunking, the layout — each holding the one room being lit. They are one
   * loop now, and the reason is not tidiness: a floor plan's rooms arrive
   * together from the detector, so they are laid out together, and a per-room
   * value cannot live in a hook when the number of rooms is not known until the
   * detector answers.
   *
   * The pipeline inside the loop is UNCHANGED, deliberately. Each room is still
   * an outline resolved to a polygon, a polygon converted into its own local
   * feet space with its own origin, a decomposition enumerated on that space and
   * a layout computed inside the chosen one. Feeding the planner a room-local
   * space rather than a plan-wide one is what keeps eight rooms eight
   * independent problems: nothing about room 3's layout can perturb room 4's,
   * and the numbers the planner sees are the same numbers it saw when there was
   * only ever one room. The plan-wide coordinates the exporters need are
   * recovered from the pixel space instead — see exporters.js.
   *
   * WHAT DID CHANGE is the chunking choice. With one room, an ambiguous
   * decomposition was worth stopping the world for; with eight, stopping eight
   * times is not a choice, it is an interrogation. So an unanswered room takes
   * the recommendation and says so, and the picker is somewhere to go rather
   * than a gate to get through.
   */
  const rooms = useMemo(() => {
    if (!source || !pxPerFt || !litOutlines.length) return [];
    const out = [];

    for (const o of litOutlines) {
      const region = regionFromOutline(o, pxPerFt);
      if (!region?.ok) continue;

      const polygonPx = useBoundingRect ? region.boundingRect : region.polygon;
      const b = bbox(polygonPx);
      const origin = { x: b.minX, y: b.minY };
      const toFt = (p) => ({ x: (p.x - origin.x) / pxPerFt, y: (p.y - origin.y) / pxPerFt });
      const toPx = (p) => ({ x: p.x * pxPerFt + origin.x, y: p.y * pxPerFt + origin.y });

      // A whole-floor plan carries fans and beds for every room. Only the ones
      // over THIS ceiling are obstacles in THIS layout, and a centre inside the
      // polygon is the test — a bed belongs to the room it is standing in.
      const mine = ceilingObstaclesPx.filter(
        (f) => pointInPolygon({ x: f.x, y: f.y }, polygonPx));
      const myZones = [
        // BY ROOM WHERE THE ZONE KNOWS ITS ROOM, and by containment otherwise.
        // A hand-drawn box belongs to whatever it is drawn over, which is what
        // the centre test is for. A reverse cove already knows: it was measured
        // against THIS room's grid. That grid is the room's BOUNDING BOX, so on
        // an L-shaped room a band along one bbox edge can have its centre out in
        // the notch — containment would drop it and the slot would be drawn on
        // the plan while the fittings walked straight through it. A zone outside
        // the polygon is harmless to the planner; a zone silently discarded is
        // not.
        ...zoneList.filter((z) => (z.roomId
          ? z.roomId === o.id
          : pointInPolygon({ x: (z.x0 + z.x1) / 2, y: (z.y0 + z.y1) / 2 }, polygonPx))),
        // This room's own enclosed rooms, which belong to it and to no other.
        ...enclosedZones(o),
      ];

      /* --- THE COVES SOMEBODY DREW ON THIS CEILING ------------------------
         BY CONTAINMENT, the same test a hand-drawn no-light zone answers: a
         shape belongs to the space it is standing in. A shape is held in the
         PLAN's own feet — see `ceilingShapes` — and every number below this
         point is in the room's own, so it is converted once, here, and never
         again.

         IT IS THREE THINGS AND THEY ARE NOT INTERCHANGEABLE. `rect` is the
         closest rectangle the shape fits in, and it is what the GRID is cut on;
         `outline` is the setting-out line as drawn; `stripOutline` is the tape,
         three inches outside it, which is what is installed and what is billed.
         See ceilingShapes.js. */
      // THE ROOM IN ITS OWN FEET, hoisted above the shapes because a drawn
      // cove's ring is grown INTO the room and therefore has to be able to ask
      // where its walls are. `geo` below reads the same array rather than
      // mapping it a second time — two conversions of one outline is two things
      // that can disagree.
      const polygonFt = polygonPx.map(toFt);

      /* --- THE HOLES IN THIS CEILING, hoisted for the same reason -----------
         Hand-drawn zones, enclosed rooms and reverse coves: the room as BUILT,
         minus the drawn coves, which are added back below once their rings are
         known. `geo.coveZonesFt` is this list plus those.

         IT IS UP HERE BECAUSE A RING HAS TO KNOW ABOUT THEM, and that was a real
         hole in the first version. The ring is grown by testing containment
         against the room's OUTLINE — and an enclosed WC is inside that outline,
         so a ring would happily grow straight across a room that is not part of
         this ceiling, claim its area in `chunkAreaSqft`, and lay a band chunk
         over it. They are walls, and the ring now stops at them (and may land on
         one exactly, which is the clean case). See `blocks` in coveHostFor. */
      const builtHolesFt = [
        ...zones.filter((z) => pointInPolygon(
          { x: (z.x0 + z.x1) / 2, y: (z.y0 + z.y1) / 2 }, polygonPx)),
        ...enclosedZones(o),
        // AND THE REVERSE COVES, which belong here rather than with the beds.
        // A bed is furniture and is dropped; a reverse cove is BUILT — eight
        // inches of ceiling that is now a slot — and an ordinary cove set out
        // through one would be two details in the same plasterboard. So the
        // perimeter band gets set out round it, which is what would be done on
        // site.
        ...reverseCoveZones.filter((z) => z.roomId === o.id
          || pointInPolygon({ x: (z.x0 + z.x1) / 2, y: (z.y0 + z.y1) / 2 }, polygonPx)),
      ].map((z) => {
        const a = toFt({ x: z.x0, y: z.y0 }), c = toFt({ x: z.x1, y: z.y1 });
        return { x0: a.x, y0: a.y, x1: c.x, y1: c.y };
      });
      const originFt = { x: origin.x / pxPerFt, y: origin.y / pxPerFt };
      const localPt = (q) => ({ x: q.x - originFt.x, y: q.y - originFt.y });
      const localRect = (R) => ({ x0: R.x0 - originFt.x, y0: R.y0 - originFt.y,
                                  x1: R.x1 - originFt.x, y1: R.y1 - originFt.y });
      /* THE HOSTS ARE BUILT ONE AT A TIME, EACH AVOIDING THE REST. A ring is
         grown outward, so two coves eight feet apart would each reach four feet
         towards the other and produce two design chunks that overlap — which the
         planner has no way to survive. Every cove already fixed, and every cove
         not yet reached, is a wall to the one being grown; the order is the
         shapes' own, so the answer is stable rather than depending on which was
         drawn last. See `avoid` in coveHostFor. */
      const shapeBoxes = [], hostsSoFar = [];
      const shapeCoves = ceilingShapes
        /* A GUIDE IS NOT A COVE AND NOTHING IS BUILT FROM IT. It is a line
           somebody put on the ceiling to measure from — see `roleOf` — so it
           cuts no grid, grows no host chunk and produces no tape. Everything
           below this line is about a shape the LAYOUT has taken up. */
        /* ONLY A COVE IS BUILT. It was `!isGuide`, which was right with two
           roles and wrong the moment there were three: a magnetic track would
           have come through here as a pocket, re-cutting the grid and appearing
           in the schedule as tape. `isBuilt` falls the safe way for any role
           this file has not been told about — see the note there. */
        .filter((sh) => shapeIsBuilt(sh))
        /* A SLOT IS NOT A POCKET AND DOES NOT CUT THE GRID. Everything below
           this line — the box, the ring grown into the room, the chunk the
           layout is set out on — describes a cove that runs ROUND a piece of
           ceiling with the room's own grid outside it. An open cove has no
           inside: it is a line across the slab, and the only thing it produces
           is a length of tape. It reaches the drawing and the schedule as an
           accent run instead — see `accentZonesPx`. */
        .filter((sh) => !shapeIsOpen(sh))
        .filter((sh) => pointInPolygon({ x: sh.x * pxPerFt, y: sh.y * pxPerFt }, polygonPx))
        .map((sh) => ({ sh, rect: localRect(coveRectFt(sh)) }))
        /* AND IT MAY NOT COME WITHIN SIX INCHES OF THE ROOM'S OWN OUTLINE. Same
           figure and same argument as the gap between two coves: a pocket four
           inches from the plaster leaves four inches of board between them, and
           that is not a detail anybody can build. A cove drawn across a wall, or
           outside the room altogether, fails the same test.
           REFUSED AND NOT NUDGED. Moving somebody's shape six inches so it
           qualifies is the app editing a drawing on their behalf; leaving it
           visible and inert is the app saying no where they can see it. */
        .filter(({ rect }) => coveClearOfOutline(rect, polygonFt))
        /* AND TWO COVES MAY NOT COME WITHIN SIX INCHES OF EACH OTHER. Rings
           can be stopped short — they are a claim about ceiling and they give up
           the part they cannot have — but BOXES cannot: they are where the
           pockets go, and no growth rule moves them. Two of them overlapping is
           two design chunks covering the same ceiling; two of them four inches
           apart is a strip of plasterboard nobody can fix and a four-inch chunk
           on the drawing that can hold nothing.

           SO THE LATER ONE IS NOT TAKEN UP AS A COVE. It stays on the drawing,
           drawn as the setting-out line it is (see `lit` in coveShapesPx), so
           the refusal is visible and moving it apart undoes it. Refusing is the
           only honest answer here and refusing VISIBLY is the only useful one.
           See COVE_GAP_FT. */
        .filter(({ rect }) => {
          const clash = shapeBoxes.some((b) =>
            rect.x0 < b.x1 + COVE_GAP_FT - 1e-6 && b.x0 < rect.x1 + COVE_GAP_FT - 1e-6
            && rect.y0 < b.y1 + COVE_GAP_FT - 1e-6 && b.y0 < rect.y1 + COVE_GAP_FT - 1e-6);
          if (!clash) shapeBoxes.push(rect);
          return !clash;
        })
        .map(({ sh, rect }, i, all) => {
          const out = {
            shape: sh, rect,
            /* --- THE RING OF CEILING THIS COVE OWNS ----------------------
               A DERIVED COVE HAS ONE AND A DRAWN ONE DID NOT, which is the
               whole of why a 7 W downlight could sit a foot outside a drawn
               cove's tape looking like a mistake. `coveOutside` keeps a fitting
               one foot off the line — right for a derived cove, where one foot
               out is inside its own dropped band and nothing goes there anyway,
               and far too generous for a drawn one, where one foot out is open
               ceiling.

               So the shape gets a host: its box grown into the room, one to four
               feet, snapping to a wall where one is in range. The ring between
               host and box is the cove's, marked dark like any other band. See
               coveHostFor for how each side is chosen, and for the honest
               difference — a derived cove's band is dropped plasterboard, this
               one is flat ceiling the cove happens to wash. */
            host: coveHostFor(rect, polygonFt, {
              // Walls it may run up to: the holes already in this ceiling.
              blocks: builtHolesFt,
              // ...and things it must keep six inches off: the rings already
              // fixed, and the boxes of the coves still to come.
              avoid: [...hostsSoFar, ...all.slice(i + 1).map((q) => q.rect)],
            }),
            outline: shapeOutlineFt(sh).map(localPt),
            stripOutline: shapeOutlineFt(sh, STRIP_OFFSET_FT).map(localPt),
          };
          hostsSoFar.push(out.host);
          return out;
        })
        /* A COVE HAS TO HAVE AN INSIDE. Under a couple of feet across there is
           no ceiling left between the two sides of the pocket, which is the same
           refusal coveGeometry makes on a chunk about 4 ft wide — asked here
           because a shape this small must not become a chunk at all. It stays on
           the drawing and is simply not a cove yet; grow it and it becomes one. */
        .filter((c) => (c.rect.x1 - c.rect.x0) >= 2 && (c.rect.y1 - c.rect.y0) >= 2);

      const geo = {
        polygonPx, origin, toFt, toPx,
        polygonFt,
        /* THE SAME OUTLINE IN THE PLAN'S OWN FEET, which is the space the cove
           shapes live in — `polygonFt` above is room-local, measured from this
           room's bounding box. Two conversions of one outline is two things that
           can disagree, so the second one is stated here rather than done again
           inside a pointer handler on every frame. */
        polygonPlanFt: polygonPx.map((p) => ({ x: p.x / pxPerFt, y: p.y / pxPerFt })),
        fansInRoom: mine,
        // THE SHAPE TRAVELS WITH IT. A rectangular object hands the planner
        // its own w/h/rot so clearance is measured from its faces; anything
        // without a shape stays the circle it always was, which is every fan
        // the detector ever found.
        fixturesFt: mine.map((f) => ({
          // `type` stays 'fan' because that is what the planner filters on and
          // every obstacle is one as far as it is concerned. `kind` rides along
          // for everyone else: the chandelier veto on a task spot has to know
          // which of these is a chandelier, and nothing else can tell it.
          type: 'fan', kind: f.kind ?? 'fan', ...toFt(f), r: f.r / pxPerFt,
          ...(f.shape === 'rect'
            ? { shape: 'rect', w: f.w / pxPerFt, h: f.h / pxPerFt, rot: f.rot || 0 }
            : { shape: 'circle' }),
        })),
        // WHAT THE ZONE IS TRAVELS WITH WHERE IT IS. The conversion used to
        // return four numbers, and that is how a bed, a hole for a beam, an
        // enclosed room and a reverse cove arrived at the placers as the same
        // anonymous rectangle. They are not the same fact — a directional spot
        // may stand over a bed and may not stand in any of the others (see
        // SPOT_DEFAULTS.overBed) — and `cls`/`kind`/`source` is the only
        // evidence of which is which. Cheap to carry, impossible to recover.
        zonesFt: myZones.map((z) => {
          const a = toFt({ x: z.x0, y: z.y0 }), c = toFt({ x: z.x1, y: z.y1 });
          return { id: z.id, cls: z.cls, kind: z.kind, source: z.source,
                   x0: a.x, y0: a.y, x1: c.x, y1: c.y };
        }),
        // THE SAME ROOM, WITHOUT THE FURNITURE. A bed is a no-light zone and a
        // no-light zone carves the room up — which is right for the grid (a
        // downlight over a pillow is the thing this app exists to avoid) and
        // wrong for a cove. A cove is BUILDING: a band dropped round the
        // perimeter, set out before anyone chose a bed and unaffected by which
        // wall it ends up against. Chunk a bedroom with the bed in it and the
        // "largest chunk" is whatever L-shaped remainder the mattress left, and
        // the cove would be drawn round that.
        //
        // So the cove is laid out on the room as BUILT — hand-drawn zones and
        // enclosed spaces kept, because those are holes in the ceiling itself,
        // and the detected beds dropped. The beds are still passed to the
        // planner as no-light zones, so the fittings inside the cove keep off
        // them exactly as they always did; it is only the SETTING OUT that
        // ignores them.
        /* THE ROOM AS BUILT: the holes hoisted above (see `builtHolesFt`)
           plus every drawn cove's RING. The ring and not the shape's own box —
           it belongs to the cove, it is dark ceiling the strip is lighting, and
           the chunker has to work around the whole of it. Handing over the box
           instead would cut the ordinary grid right up to the tape, which is the
           thing the ring exists to prevent. */
        coveZonesFt: [...builtHolesFt, ...shapeCoves.map((c) => c.host)],
      };

      // A KITCHEN IS LIT HARDER THAN A LIVING ROOM, AND AN OFFICE HARDER THAN
      // A HOUSE, and the only lever this engine has for either is the size of a
      // cell. See TARGET_AREA_BY_TYPE and TARGET_AREA_BY_PROJECT — the room's
      // own opinion and the building's, resolved to the denser of the two.
      //
      // IT HAS TO REACH THE CHUNKER TOO, not just the grid. The decompositions
      // are enumerated and scored against the cell they are expected to carry;
      // enumerate for 50 sqft cells and then lay 25 sqft ones on the winner and
      // the chunking chosen is the answer to a question nobody asked. So both
      // options objects carry the override, and a room whose type arrives after
      // it was first laid out re-enumerates — which is why `roomTypes` is a
      // dependency of this memo. A chunking the user had picked by hand is
      // resolved afresh below and falls back to the recommendation if the
      // denser reading no longer offers it.
      // `withTargetArea` RATHER THAN A SPREAD, and the difference is not
      // cosmetic. `opt` is a RESOLVED options object: targetCell, minCell and
      // maxCell are already materialised from the 50 sqft default, so
      // `{ ...opt, targetArea: 25 }` moved the area band and left all three
      // side dials describing a 7.07 ft cell — and the side dials are what
      // partitionAxis and evenCounts actually score. The helper drops them and
      // re-derives. `chunkOpt` needs no such care: it carries no side keys and
      // enumerateChunkings derives its own from whatever area it is handed.
      const cellArea = targetAreaFor(projectId, roomTypes[o.id]?.type);
      const roomOpt = cellArea ? withTargetArea(opt, cellArea) : opt;
      const roomChunkOpt = cellArea ? { ...chunkOpt, targetArea: cellArea } : chunkOpt;

      /* --- HOW THIS SPACE IS CUT UP, ENUMERATED ONCE --------------------
         IT WAS ENUMERATED TWICE, ON TWO DIFFERENT ROOMS, and the second one was
         always the authoritative one. `enumerateChunkings(polygonFt, zonesFt…)`
         produced the list the picker and the panel offered — the room with the
         FURNITURE cut out of it — while `designChunking(polygonFt,
         coveZonesFt…)` produced the chunks actually laid out, from the room as
         BUILT. Two readings of "how can this space be divided", answered about
         two different spaces, and only one of them reached the drawing.

         THAT WAS SURVIVABLE UNTIL A COVE COULD BE DRAWN, and it is not now. A
         hand-drawn cove is a hole in the middle of the ceiling; punch one into
         an L-shaped room and the decompositions genuinely change — a reading
         appears that did not exist before, the recommendation moves, and the
         two readings that kept their names come back with different rectangles.
         The panel was then offering two options where the drawing had three,
         marking the wrong one as live, and drawing chunks that were not on the
         sheet.

         SO THERE IS ONE ENUMERATION AND IT IS THE DESIGN'S. This is a DELETION
         rather than a new rule: nothing about the gridding changes, and the list
         that is now offered is the list that was already being used. The chunk
         picker, the glyphs in the Spaces list and the chunks on the drawing all
         read the same answer because there is only one.

         THE FURNITURE LEAVES THE OFFERED LIST WITH IT, and that follows the
         doctrine ceilingDesign.js already states rather than inventing one: a
         bed is a thing standing on the floor and has no opinion about where a
         band of plasterboard is set out. It still cuts the grid INSIDE a
         standard chunk — that is the second level of chunking, in
         planCeilingDesign, and it is untouched. What it no longer does is
         decide which readings of the CEILING somebody is offered. */
      const design = designChunking(geo.polygonFt, geo.coveZonesFt,
                                    roomChunkOpt, geo.fixturesFt,
                                    // A remembered intent, resolved afresh each
                                    // time: change the space enough that the
                                    // chosen reading no longer exists and the
                                    // recommendation takes over, rather than a
                                    // different reading quietly wearing the same
                                    // name. designChunking does that resolution
                                    // itself — see `chosenBy`.
                                    chunkPicks[o.id] ?? null);
      const chunking = design;
      const chosenId = design.chosenId;
      const picked = design.chosenBy === 'requested';

      /** What a light of this geometric kind is BOUGHT as in this room — and,
       *  in a bedroom, in this CELL. See fixtureForCell in roomTypes.js: a cell
       *  of 18 sqft or under takes the 5 W narrow lamp, because the foot-of-bed
       *  rule leaves a bedroom with rows of genuinely different depths and a
       *  36-degree cone over a shallow one lands on the wall. `cellSqft` is 0
       *  for a large light, which has no single cell, and the room-level answer
       *  stands for it. */
      const roomFixture = (kind, cellSqft = 0, narrow = false) =>
        fixtureForCell(projectId, roomTypes[o.id]?.type, kind, cellSqft, narrow);
      const cellSqftOf = (l) =>
        (l.kind === 'small' && l.cell ? l.cell.w * l.cell.h : 0);
      /* THE PLANNER'S VERDICT ON THE CELL, not this file's. `narrow` says the
         cell failed the gates this room's ordinary lamp's grid is judged by —
         see `cellMeetsGates` — and re-deriving it here from `w * h` would be a
         second copy of a rule that has side bounds as well as an area band. */
      const cellNarrowOf = (l) => !!(l.kind === 'small' && l.cell?.narrow);

      // --- THE CEILING ITSELF -------------------------------------------
      //
      // ONE DECISION PER PIECE OF CEILING. The space is cut into chunks by its
      // OWN OUTLINE — `coveZonesFt`, which keeps the holes in the ceiling and
      // drops the furniture standing under it, because a bed has no opinion
      // about where a band of plasterboard is set out — and each chunk carries
      // the design somebody chose for it. Standard chunks are then gridded the
      // ordinary way, furniture and all, so a plain rectangular bedroom comes
      // out exactly as it always did: one chunk, one grid, the bed still
      // cutting it up. See ceilingDesign.js.
      //
      // THE CHUNK PICKER'S CHOICE GOVERNS BOTH LEVELS. `chosenId` is a reading
      // of the space — bays across it, courses along it — and it is offered to
      // the design chunking and to the grid inside a standard chunk alike, so
      // one answer means one thing everywhere. The design chunking is resolved
      // above, where the readings are enumerated; this is the level below it.
      //
      // THE PICKS, WITH THE OLD STATE READ AS A LAST RESORT. See the note on
      // `ceilingKinds`: a space that has never been edited per chunk but was
      // coved under the old room-level switch puts its cove on the biggest
      // chunk, which is where that switch would have put it.
      const basePicks = designPicks[o.id]
        ?? (ceilingKinds[o.id] === 'cove' && design.chunks.length
            ? { [design.chunks[0].key]: 'cove' } : {});

      /* --- THE DRAWN COVES, AS CHUNKS ---------------------------------------
         ONE MORE PIECE OF CEILING PER SHAPE, and it arrives with its answer
         already on it. Everything the design machinery needs about a cove is in
         `coveGeo`, and it is the SHAPE's geometry rather than an inset of a
         chunk: the line is the rectangle the shape fits in, the strip is the
         outline that was drawn, and the band is EMPTY — because the ceiling
         outside this cove is not a band round it, it is the rest of the room,
         which the chunker has already cut into chunks of its own (see the hole
         added to `coveZonesFt` above).

         AN EMPTY BAND IS NOT A DEGENERATE CASE. It is what makes the ladder in
         cove.js come out right for a drawn shape: rung 1 is the strip carrying
         the space alone, rung 2 lights the ceiling inside the line, and rung 3
         — light the band too — has nothing left to light and is therefore the
         same answer as rung 2. Which is correct: there is no band. */
      const shapeChunks = shapeCoves.map((c) => {
        const w = c.rect.x1 - c.rect.x0, h = c.rect.y1 - c.rect.y0;
        const hw = c.host.x1 - c.host.x0, hh = c.host.y1 - c.host.y0;
        const sx = c.stripOutline.map((q) => q.x), sy = c.stripOutline.map((q) => q.y);
        const line = { ...c.rect, w, h, area: w * h };
        const host = { ...c.host, w: hw, h: hh, area: hw * hh };
        return {
          ...c.host, w: hw, h: hh, key: chunkKey(c.host), shapeId: c.shape.id,
          coveGeo: {
            /* ZERO INSET, AND IT STILL MEANS WHAT IT MEANT. `offset` is how far
               a DERIVED cove's line is set in from the chunk it was drawn in,
               and a drawn cove was not set in from anything — the shape is the
               line and the host was grown outward from IT. The number is kept at
               zero rather than back-filled with the ring's width, because the
               ring is not one width: see the per-piece lamp below. Nothing reads
               `offset` on a drawn cove except the band's default lamp, which
               every piece now overrides. */
            offset: 0,
            host, line,
            strip: { x0: Math.min(...sx), y0: Math.min(...sy),
                     x1: Math.max(...sx), y1: Math.max(...sy),
                     w: Math.max(...sx) - Math.min(...sx),
                     h: Math.max(...sy) - Math.min(...sy) },
            /* THE RING, CUT THE WAY EVERY OTHER BAND ON THIS APP IS CUT — two
               full-width runs and two shorter sides, by the same function a
               derived cove uses. Each piece names its own lamp off its own
               thickness, because the four are not the same width here. */
            band: bandBetween(host, line).map((b) => ({
              ...b, fixture: bandFixtureFor(Math.min(b.w, b.h)) })),
            // THE OUTLINE'S OWN LENGTH, not the rectangle's perimeter. A circle
            // 12 ft across is 39 ft of tape and its bounding square is 48; the
            // schedule bills what is installed.
            perimeterFt: pathLengthFt(c.stripOutline),
            /* THE CEILING THIS COVE IS ANSWERABLE FOR IS THE HOST, ring
               included, and that is what keeps the ring honest. `required` is
               `chunkAreaSqft * criteria`, so every foot of ceiling handed to
               the cove raises what it has to deliver — grow the ring too far and
               the ladder notices the strip cannot carry it and starts lighting
               the inside, then the ring itself. The margin polices itself. */
            chunkAreaSqft: hw * hh,
            innerAreaSqft: w * h,
            bandAreaSqft: hw * hh - w * h,
            smallerFt: Math.min(hw, hh),
            shapeId: c.shape.id, outline: c.outline, stripOutline: c.stripOutline,
          },
        };
      });
      const designChunks = shapeChunks.length
        ? [...design.chunks, ...shapeChunks] : design.chunks;
      // A DRAWN SHAPE IS NOT A PICK ANYBODY CAN CHANGE — see optionsForChunk,
      // which offers it nothing else — so its answer is written over whatever
      // the stored picks happen to say about a rectangle of the same size.
      const picks = shapeChunks.length
        ? { ...basePicks, ...Object.fromEntries(shapeChunks.map((c) => [c.key, 'cove'])) }
        : basePicks;
      const built = planCeilingDesign({
        polygonFt: geo.polygonFt,
        fixturesFt: geo.fixturesFt,
        zonesFt: geo.zonesFt,
        // THE SAME LIST THE DESIGN CHUNKING WAS GIVEN, and passing it twice is
        // the point rather than a duplication: these are the holes in the
        // ceiling, and a track keeping a foot off the walls has to count the
        // wall of an enclosed room exactly as the chunker counted it. Two
        // readings of "the room as built" would eventually disagree.
        builtZonesFt: geo.coveZonesFt,
        designChunks,
        picks,
        opt: roomOpt,
        chunkOpt: roomChunkOpt,
        strategy: chosenId,
        // WHERE SOMEBODY DRAGGED THIS ROOM'S LIGHTS TO. Handed to the layout
        // rather than applied to its answer — see the note in planner.js: a
        // hand position put on afterwards would leave that light the one
        // fitting out of line, because the rows would already have formed up
        // without it.
        handMoves: lightMoves[o.id] ?? null,
        // THE REASONING BEHIND EVERY ABSENCE, for an owner only — see `explain`.
        explain: isAdmin,
        criteria: lumenCriteriaFor(projectId, roomTypes[o.id]?.type),
        fixtureFor: roomFixture,
      });
      /* A DRAWN COVE IS NOT THE GRID'S — see AUTO_GRID. Every cove report that
         carries a `shapeId` came out of a shape somebody put on the ceiling by
         hand, and those keep their tape while the engine is off; the derived
         ones are the engine's answer and go with the rest of it. */
      const coves = built.coves.filter((c) => c.ok && (AUTO_GRID || c.shapeId));
      // THE TRACKS, WHICH ARE NOT FILTERED THE WAY THE COVES ARE. A cove report
      // carries `ok` because the ladder can run against a layout that failed;
      // a track is derived FROM a finished layout, so one exists only if there
      // was something to derive it from. What it can do instead is decline —
      // see `declined` in ceilingDesign.js — and a declined chunk simply has no
      // entry here.
      let tracks = built.tracks ?? [];
      let res = built.plan;
      // IT CAN DECLINE, AND THAT IS NOT AN ERROR STATE. A space whose own
      // outline gives the chunker nothing to work with falls back to the plain
      // layout on the room as a whole, which is the answer this app gave before
      // any of this existed.
      if (!res?.ok) {
        res = planLights(geo.polygonFt, geo.fixturesFt,
          { ...roomOpt, chunkStrategy: chosenId || 'auto',
            handMoves: lightMoves[o.id] ?? null }, geo.zonesFt);
        // AND THE TRACKS GO WITH THE LAYOUT THEY WERE SET OUT TO. Same argument
        // as `designChunksPx` being emptied here: these runs were placed through
        // fittings that are no longer on the drawing, so drawing them would be
        // drawing a profile through nothing.
        tracks = [];
      }

      /* --- AND NOW THROW THE GRID'S ANSWER AWAY -------------------------------
         See AUTO_GRID at the top of this file for why, and for why this blanks
         the ANSWER rather than skipping the run: `stats` is what the schedule,
         the exporters, the troubles list and the viewer all read, and it stays
         exactly the shape it has always been. What goes is what was placed.

         THE COUNTS IN `stats` GO WITH THE THINGS THEY COUNT. Leaving them would
         have the troubles list reporting that four cells are short of light in a
         room with no cells and no lights in it — a warning about a layout that
         is not on the drawing, which is the worst kind. `areaSqft`, `fans` and
         `avgCell` are facts about the ROOM and survive. */
      /* --- THE GRID SURVIVES THE BLANKING, AND ONLY THE GRID --------------
         WHAT `AUTO_GRID` IS ABOUT IS THE FITTINGS, and the block below throws
         the cells and the chunks away with them because everything that read
         them was counting or billing what stood IN them. One thing was not: the
         admin overlay, whose whole subject is how the ceiling was CUT — see
         `showGrid`, and `gridPath` in PlanCanvas. That switch has been drawing
         nothing since the day the lights were switched off, which is the wrong
         answer to "show me the grid without placing the lights": the chunker ran,
         it has an opinion, and the opinion is exactly what somebody laying lamps
         out by hand wants to see.
         SO THE GEOMETRY IS KEPT ASIDE, HERE, BEFORE IT GOES. It is deliberately
         NOT put back into `res`: everything downstream of that — `stats`, the
         schedule, the exporters, the troubles list — is counting a layout that is
         not on the drawing, and handing any of them cells again would have the
         troubles list reporting four dark cells in a room with no lights in it.
         One reader, one field, and nothing else can see it. */
      const gridChunks = res?.ok ? (res.chunks ?? []) : [];
      /* AND THE CELLS WITH THEM, for a second reader that arrived later: the
         autoplace rule needs one lamp per CELL, and the recommendation under the
         pointer needs the cell's area and its short side. Both are facts about
         how the ceiling divides rather than about what was placed on it, so they
         belong on this side of the blanking with the chunks. */
      const gridCells = res?.ok ? (res.cells ?? []) : [];

      if (!AUTO_GRID && res?.ok) {
        res = { ...res,
          chunks: [], omittedChunks: [], cells: [], lights: [],
          cededCells: [], awkwardCells: [],
          stats: { ...res.stats,
            chunks: 0, omittedChunks: 0, cells: 0, served: 0, dark: 0, unserved: 0,
            nudged: 0, awkward: 0, rescued: 0, outsideBand: 0, ceded: 0, offAxis: 0,
            alignedDiagonal: 0, clashes: 0, large: 0, small: 0 } };
        tracks = [];
      }

      /* --- THE TRACKS SOMEBODY DREW ------------------------------------------
         AFTER THE LAYOUT AND NOT BEFORE IT, which is not an implementation
         detail — it is the doctrine at the top of track.js, applied to a run
         whose position came from a hand rather than from a score. A cove
         changes the grid and has to be consulted first; a track changes
         nothing about it. The room is lit by exactly the downlights it would
         have had, and the profile is then drawn THROUGH them.

         THE PATH IS CLIPPED TO THIS ROOM'S FEET AND NOT TO THIS ROOM. A run
         drawn from the bedroom across the threshold into the dressing is one
         profile on site, and it is offered to both spaces here — each absorbs
         the fittings it owns and neither knows about the other's. What that
         costs is a length billed twice; what it buys is that the stretch over
         each room actually carries that room's lights. The length is settled
         below, per room, by the part of the path inside its polygon.

         IT CAN REACH NOTHING, AND THEN THERE IS NO TRACK HERE. `planDrawnTrack`
         returns null for a path that swallows no fitting, exactly as
         `planTrack` does — a profile with no head on it is a line, and billing
         one for a run that crossed a corner of this room on its way somewhere
         else would turn a geometric accident into an order. */
      if (res?.ok && manualTracks.length) {
        // THE PLAN'S FEET ARE NOT THE ROOM'S. A path is stored in the drawing's
        // own feet (see `manualTracks`) and the layout works from this room's
        // bounding box, so it converts once, here, rather than asking
        // absorbPoints to know about two coordinate spaces — the same move the
        // spot pass makes one screenful down.
        const toRoomFt = (q) => geo.toFt({ x: q.x * pxPerFt, y: q.y * pxPerFt });
        for (const mt of manualTracks) {
          /* A FITTING ALREADY ON A PROFILE IS NOT ON OFFER TO THE NEXT ONE, and
             two drawn runs crossing the same stretch of ceiling is an ordinary
             thing to draw. Nulled rather than filtered so the answer stays
             index-parallel to `res.lights` — `absorbPoints` skips a null point
             and returns a null verdict for it, which is exactly the reading
             wanted here. Whichever run was drawn first keeps the light. */
          const offer = res.lights.map((l) => (l.track ? null : l));
          // THE CLIP HAPPENS INSIDE, AGAINST `site.polygon`, so what follows is
          // numbered against the runs that are actually over this ceiling — see
          // `drawnRuns`. Nothing here re-derives the geometry.

          const t = planDrawnTrack(mt.ptsFt.map(toRoomFt), offer, roomOpt,
                                   /* THE SAME `site` THE CHOSEN TRACKS GET, and
                                      for the same three reasons: the polygon is
                                      what the run is cut down to, a head may
                                      not land in a keep-off zone, and no run
                                      may pass through a fan. A drawn run is
                                      held to the rules a derived one is held
                                      to — the hand chose where, not whether. */
                                   { polygon: geo.polygonFt,
                                     keepOff: geo.zonesFt,
                                     obstacles: geo.fixturesFt },
                                   { key: mt.id, id: mt.id, closed: !!mt.closed });
          if (!t) continue;
          /* THE FITTINGS MOVE ONTO THE PROFILE HERE, before the stamping below
             reads them. `lightFixture` swaps a recessed head for a module the
             moment it sees `track`, `gridPx` is drawn from `gridPos`, and a
             light on a run gets no drag band — all three already work off these
             fields, because this is the same shape `planTrack` leaves behind on
             a chunk that chose one. Nothing downstream learns that a person
             drew this one. */
          res = { ...res, lights: res.lights.map((l, i) => {
            const a = t.absorbed[i];
            if (!a) return l;
            /* `trackAxis` AND `trackAlong` ARE NOT DECORATION. A head is a
               300 x 38 mm module lying ALONG the profile, so the axis is what
               turns the mark through ninety degrees — without it every head on
               a vertical run is drawn across the run it is clipped into, which
               is a fitting that could not be installed. The exporters read the
               same field for the same reason. It was missing here while the
               chosen tracks set it in ceilingDesign.js, so drawn runs came out
               with their heads crossing them. */
            return { ...l, x: a.x, y: a.y, track: t.key, trackRun: a.run,
                     trackAxis: t.runs[a.run].axis, trackAlong: a.along,
                     // WHERE THE GRID PUT IT, kept for the reason the chosen
                     // track keeps it: the drawing shows the move, so the claim
                     // that nothing was re-planned is checkable rather than
                     // asserted.
                     gridPos: l.gridPos ?? { x: l.x, y: l.y } };
          }) };
          tracks = [...tracks, { ...t, drawn: true }];
        }
      }

      // WHAT EACH CHUNK IS, AND WHAT ELSE IT COULD BE, in plan pixels — the one
      // thing the canvas needs to draw the option pill. `pick` and `options`
      // ride along so the pill never has to ask the geometry anything.
      //
      // EMPTY WHEN THE FALLBACK RAN, because then these chunks are not what is
      // on the drawing: the fittings came from one grid over the whole space and
      // none of them carries a chunk key. A pill over a chunk no light belongs
      // to would offer a choice that changes nothing.
      /* THE SHAPE CHUNKS ARE NOT IN HERE, and that is what keeps the options
         pill off them. A pill over a drawn cove would offer one option — see
         optionsForChunk — which is a control that cannot do anything, parked on
         top of a shape that has a contextual menu of its own. */
      /* ...AND NO OPTION PILLS EITHER, WHILE THE GRID IS OFF. A pill offers to
         re-cut a piece of ceiling; with no fittings on it there is nothing for
         the re-cut to move, so it would be a control over an answer that is not
         on the drawing. See AUTO_GRID. */
      const designChunksPx = (!AUTO_GRID || !built.plan?.ok) ? [] : built.parts
        .filter((p) => !p.chunk.shapeId)
        .map((p) => ({
        key: p.key, pick: p.pick,
        options: p.options.map((x) => ({ id: x.id, label: x.label })),
        /* WHAT WAS ASKED FOR, WHICH IS NOT ALWAYS WHAT IS ON THE DRAWING. An
           arrangement that declines leaves `pick` reading 'standard' — honestly,
           because Standard is what got built — and the pill indexes its list by
           what it reads. So flipping onto a declining track put the cursor back
           at the top of the list, and the next press went to the second entry
           again: right cycled between the first two options forever while left
           reached the last one. The arrows have to step from what you ASKED for.
           `order` is the same list before the layout pruned it (see
           `optionOrder`), so the sequence the arrows walk does not change shape
           depending on what the chunk currently is. */
        requested: p.declined ?? p.pick,
        order: p.optionOrder ?? p.options.map((x) => x.id),
        /* WHAT THIS CHUNK WAS NOT OFFERED, AND WHY. Computed only for an owner
           — see the `isAdmin` gate at the call site — because it is a question
           about the RULES rather than about the drawing, and a designer picking
           a ceiling does not need the pill reciting what it ruled out. It is
           also not free: seven predicates and a string per chunk, on every
           room, on every re-layout. */
        omitted: p.omitted ? p.omitted.map((x) => `${x.label} — ${x.why}`) : null,
        /* AND THE PIECE'S OWN SIZE, which is the first thing anybody asks when
           an option is missing and the one number the drawing does not state.
           `wFt`/`hFt` were already here and unread. It rides with `omitted`
           rather than being set unconditionally: the two are one card, and a
           size on its own would put a hover hint on every designer's pill for
           no reason. */
        sizeFt: `${Math.round(p.chunk.w * 10) / 10} × ${Math.round(p.chunk.h * 10) / 10} ft`,
        rect: { x0: p.chunk.x0 * pxPerFt + origin.x, y0: p.chunk.y0 * pxPerFt + origin.y,
                x1: p.chunk.x1 * pxPerFt + origin.x, y1: p.chunk.y1 * pxPerFt + origin.y },
        wFt: p.chunk.w, hFt: p.chunk.h,
      }));

      // WHICH CATALOGUE LINE ONE LIGHT IS, now that a chunk can have an opinion
      // of its own. The band outside a cove is lit with the 5 W narrow lamp
      // where it is too shallow for a 7 W — that is a property of the chunk the
      // light sits in, not of the room, so it wins over the room's own mapping.
      // See bandFixtureFor in cove.js.
      const chunkIndexOf = (l) => (l.kind === 'small' ? l.cell?.chunk : l.chunk);
      /**
       * WHICH CATALOGUE LINE ONE LIGHT IS.
       *
       * THREE OPINIONS, RESOLVED OUTWARDS. The room's type says what a `small`
       * light is bought as; the chunk overrides it where the band outside a cove
       * needs the narrow lamp; and the TRACK overrides both, because a fitting
       * clipped into a profile is a different product from a recessed one
       * whatever room it is in and whatever chunk it sits in. It is last because
       * it is the most specific: it is a fact about this one fitting, not about
       * its room or its piece of ceiling. See TRACK_FIXTURE in boq.js.
       */
      const lightFixture = (l) => {
        const base = res.chunks?.[chunkIndexOf(l)]?.coveFixture
          ?? roomFixture(l.kind, cellSqftOf(l), cellNarrowOf(l));
        return l.track ? trackFixtureFor(base) : base;
      };
      /**
       * WHICH DESIGN CHUNK PUT THIS LIGHT HERE.
       *
       * The chunk plan stamps every rectangle it hands the planner with the key
       * of the design chunk it came out of — a standard chunk's grid pieces, a
       * cove's inner rectangle, each of the four band runs. Carrying that stamp
       * out onto the drawn fitting is what makes the whole interface possible:
       * click a downlight and the pill knows which piece of ceiling's options it
       * is flipping through, with nothing to hit-test and no geometry to redo.
       */
      const lightDesign = (l) => res.chunks?.[chunkIndexOf(l)]?.design ?? null;

      /** A feet-space rectangle as its four corners in plan pixels, in order.
       *  Both the cove line and the tape round it are drawn as closed runs, and
       *  a closed run is a point list rather than a box. */
      const corners = (R) => [{ x: R.x0, y: R.y0 }, { x: R.x1, y: R.y0 },
                              { x: R.x1, y: R.y1 }, { x: R.x0, y: R.y1 }].map(toPx);

      const rectToPx = (c) => ({ ...c,
        x0: c.x0 * pxPerFt + origin.x, x1: c.x1 * pxPerFt + origin.x,
        y0: c.y0 * pxPerFt + origin.y, y1: c.y1 * pxPerFt + origin.y });
      /* A CHUNK IS A RECTANGLE PLUS THE LINES IT WAS DIVIDED ON, and it is
         converted in two places now — the layout's own list and the grid the
         admin overlay reads, which are the same list except while the lights are
         switched off. Written once so the two cannot drift. */
      const chunkToPx = (ch) => ({
        ...rectToPx(ch),
        xLines: ch.xLines.map((x) => x * pxPerFt + origin.x),
        yLines: ch.yLines.map((y) => y * pxPerFt + origin.y),
      });

      const plan = !res.ok ? { ...res, polygonPx } : {
        ...res,
        // The same stamp on the feet-space list, because the BOQ reads
        // `plan.lights` and the canvas reads `plan.lightsPx`, and a fixture that
        // is drawn small but billed as the 7 W line is the worst of both.
        lights: res.lights.map((l) => ({ ...l, fixture: lightFixture(l) })),
        polygonFt: geo.polygonFt, polygonPx, origin, toPx,
        chunksPx: res.chunks.map(chunkToPx),
        /* THE CHUNKER'S OWN READING OF THIS CEILING, whether or not anything was
           placed on it. The same conversion as `chunksPx` above and usually the
           same list — they part company only while `AUTO_GRID` is off, which is
           the whole reason this exists. Read by the admin grid overlay and by
           nothing else; see the note where `gridChunks` is captured. */
        gridChunksPx: gridChunks.map(chunkToPx),
        /* THE CELLS THE CHUNKER CUT, whether or not anything stands in them.
           Same conversion as `cellsPx` above and usually the same list — they
           part company only while the lights are switched off. Note what
           `rectToPx` does and does not touch: the BOUNDS come out in pixels and
           `w`, `h`, `cx`, `cy` stay in the room's own FEET, which is what lets
           the autoplace rule read an area and a short side straight off one of
           these without a division. */
        gridCellsPx: gridCells.map(rectToPx),
        cellsPx: res.cells.map(rectToPx),
        // WHAT EACH LIGHT IS BOUGHT AS, stamped here because this is the one
        // place that knows both the layout and the room's type. The planner
        // deals in `kind` (geometry) and never in products; see FIXTURE_BY_TYPE.
        lightsPx: res.lights.map((l) => ({ ...l, ...toPx(l),
          fixture: lightFixture(l),
          design: lightDesign(l),
          // WHERE THE GRID PUT IT, for a fitting a track has since pulled onto
          // its profile. `l.x/l.y` above is the fitting's real position — the
          // one that gets set out, exported and billed — and this is the claim
          // the whole option rests on, drawn: the grid did not change, the
          // fitting slid onto the run. Absent on every light no track touched.
          gridPx: l.gridPos ? toPx(l.gridPos) : null,
          centrePx: l.cell ? toPx({ x: l.cell.cx, y: l.cell.cy }) : null,
          /* --- HOW FAR THIS ONE MAY BE MOVED, AND WHAT NAMES IT ------------
             `cellKey` is the handle: it is what an override is stored against
             and what a selection is, and it is the cell's geometry rather than
             the light's id for the reason `lightMoves` gives.

             `bandPx` is `centreBand` drawn — the box the grid allows this
             fitting, in the drawing's own pixels. It is on the LIGHT and not on
             the cell because it is a fact about the fitting's freedom, and
             because the cell it belongs to is one of hundreds the canvas is not
             otherwise given.

             ONLY WHERE THERE IS FREEDOM TO HAVE. A large light is fixed on one
             axis by the grid line it sits on and may only take discrete anchors
             on the other, so it has no box; a head a track has absorbed is set
             out to the profile, and dragging it would be arguing with the run
             it is clipped into. Both come through with `bandPx` null, and the
             canvas offers no grip on a light that has none. */
          cellKey: l.cell ? cellKey(l.cell) : null,
          bandPx: (l.kind === 'small' && l.cell && !l.track)
            ? (() => { const b = centreBandBox(l.cell, roomOpt);
                       const a = toPx({ x: b.x0, y: b.y0 }), c = toPx({ x: b.x1, y: b.y1 });
                       return { x0: a.x, y0: a.y, x1: c.x, y1: c.y }; })()
            : null,
          coverPx: l.cells.map((id) => {
            const c = res.cells.find((x) => x.id === id);
            return c ? toPx({ x: c.cx, y: c.cy }) : null;
          }).filter(Boolean) })),
        fansFt: geo.fixturesFt,
        // The obstacles in this room, in IMAGE PIXELS. The feet above are
        // room-local — measured from this room's own bounding box — which is
        // exactly what the planner wants and exactly what an export cannot use:
        // eight rooms each measuring from their own corner would stack eight
        // layouts on top of each other at the origin. Pixels are the one space
        // every room already shares, so the exporters work from these and the
        // scale. See roomInFeet in exporters.js.
        zonesPx: myZones,
        fansPx: mine,
        // THE COVE SETTING-OUT LINES, in plan pixels. They ride on the plan
        // rather than being handed to the canvas separately because everything
        // else the canvas draws for a room already does — one prop, one room —
        // and because a cove line without the layout it cut is a rectangle
        // floating over somebody's drawing.
        //
        // A LIST, BECAUSE A SPACE CAN CARRY SEVERAL. An L-shaped room coved over
        // both ends has two bands, set out square, exactly as they would be
        // built. Each line carries the key of the chunk it belongs to, so
        // clicking one opens that chunk's options — which is the only way back
        // for a chunk whose cove is carrying the space on its own and therefore
        // has no downlight left to click.
        /* THE OUTLINE WHERE THERE IS ONE, THE RECTANGLE WHERE THERE IS NOT.
           A cove this app set out is a rectangle and `line` describes it; a cove
           somebody drew is a shape, and `outline` is that shape. The canvas
           draws whichever it is handed as a closed run of points and does not
           need to know which — a polygon is a polygon. `shapeId` rides along so
           a press on the line can pick the shape up rather than open a chunk's
           options, which is the one thing that DOES differ. */
        covesPx: coves.map((c) => ({
          key: c.key, offset: c.offset, shapeId: c.shapeId ?? null,
          line: c.outline ? c.outline.map(toPx) : corners(c.line),
        })),
        // THE TRACK RUNS, in plan pixels, and they ride on the plan for exactly
        // the reasons `covesPx` does: one prop per room, and a profile without
        // the layout it was set out through is a line floating over somebody's
        // drawing. Each run carries the key of the chunk that owns it, so
        // clicking one opens that chunk's options — the way back for a track
        // whose fittings have all been absorbed and are therefore drawn ON it.
        tracksPx: tracks.map((t) => ({
          key: t.key, id: t.id, label: t.label, short: t.short,
          /* WHETHER A HAND PUT IT THERE, and it is the one thing about a track
             the canvas has to know the provenance of. A chosen track's rail
             opens its chunk's options when you click it — the way back for a
             piece of ceiling whose fittings are all on the profile — and a
             drawn one has no chunk and no options: what it has is a path, and
             double-clicking it opens the points. See `trackEditId`. */
          drawn: !!t.drawn,
          closed: t.closed, corners: t.corners, pieces: t.pieces,
          lengthFt: t.lengthFt,
          runs: t.runs.map((rn) => ({ a: toPx(rn.a), b: toPx(rn.b),
                                      side: rn.side, axis: rn.axis })),
        })),
      };

      /**
       * THE COVE AS A FITTING, in the plan's own pixels.
       *
       * ONE ZONE AND NOT FOUR. A cove turns the corner and carries on, so it is
       * one continuous run of tape — `loop` holds the four corners and whatever
       * draws it closes the circuit. Four separate runs would look right until
       * you counted them: the schedule bills strip by the metre AND reports the
       * number of pieces, because pieces is what tells a contractor how many
       * drivers and end caps to buy, and a single cove is one of each.
       *
       * It is shaped like every other accent zone on purpose — same `type`,
       * same `rect`, same `runLength` — so the canvas, the schedule and the
       * exporters all take it without knowing a cove exists.
       */
      const coveStrips = res.ok ? coves.map((c) => {
        // THE TAPE, NOT THE LINE — see STRIP_OFFSET_FT in cove.js. The run is
        // three inches outside the setting-out line, in the pocket, which is
        // both where it is installed and the length that gets billed.
        // ...and round a drawn shape it is the shape's own offset outline, for
        // the same reason: three inches out, in the pocket, whatever the shape.
        const pts = c.stripOutline ? c.stripOutline.map(toPx) : corners(c.strip);
        const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
        return {
          // THE CHUNK'S KEY IN THE ID, because a space can now hold more than
          // one cove and two runs called `cove-<room>` are one run as far as the
          // schedule and the exporters are concerned.
          id: `cove-${o.id}-${c.key}`, type: 'strip', kind: 'cove', roomId: o.id,
          source: 'cove', label: 'Cove LED strip',
          /* WHICH DRAWN SHAPE THIS TAPE BELONGS TO, or null for a cove the
             ceiling design derived. It rides along so the tape can be a HANDLE
             on the shape: selecting the run and pressing Delete is the obvious
             way to remove a cove somebody drew, and without this the only thing
             the key could reach was a strip that is not an object in its own
             right. See the accent delete branch. */
          shapeId: c.shapeId ?? null,
          loop: pts,
          runLength: c.perimeterFt * pxPerFt,
          rect: { x0: Math.min(...xs), y0: Math.min(...ys),
                  x1: Math.max(...xs), y1: Math.max(...ys) },
        };
      }) : [];

      out.push({
        id: o.id, outline: o, region, geo, chunking, plan,
        chosenId, chunkingChosenBy: picked ? 'user' : 'recommended',
        // The ceiling, chunk by chunk. `design` is how the space was cut up,
        // `designChunksPx` is what the canvas draws the option pills from, and
        // `coves` holds one report per cove — what the ladder decided, what the
        // strip delivers, how long the run is.
        ceiling: coves.length ? 'cove' : tracks.length ? 'track' : 'standard',
        // `tracks` IS IN FEET AND THAT IS DELIBERATE. The canvas reads
        // `plan.tracksPx`; this is what the SCHEDULE reads, and a schedule
        // measuring a profile off plan pixels would be measuring it off the
        // zoom. See buildBOQ, which takes the length from here.
        design, designChunksPx, coves, coveStrips, tracks,
        stats: outlineStats(o, pxPerFt),
      });
    }
    return out;
  }, [source, pxPerFt, litOutlines, useBoundingRect, ceilingObstaclesPx, zoneList, zones,
      reverseCoveZones, chunkOpt, chunkPicks, opt, enclosedZones, roomTypes, projectId,
      designPicks, ceilingKinds, ceilingShapes, lightMoves, manualTracks, isAdmin]);

  // What the canvas draws: every zone, whoever it belongs to. The planner sees
  // the per-room subsets above; this is only for the eye.
  /**
   * The zones that are DRAWN, which is not the same set as the zones that are
   * OBEYED.
   *
   * `zoneList` is what the planner gets: hand-drawn zones plus whatever the bed
   * detector found, because a light over a bed is wrong whether or not anybody
   * was shown a rectangle about it. What goes on screen is the hand-drawn ones
   * and the enclosed spaces — the first because the user put them there and has
   * to be able to see and remove them, the second because it is a fact about
   * the plan's own geometry.
   *
   * The bed zones are neither. They are the visible half of a pipeline that
   * runs two detectors and a judge over the plan before anyone sees it, and
   * they were being drawn as if they were part of the design — a hatched box
   * across the bed, on a sheet handed to a client, explaining a decision nobody
   * asked about. The zone still moves the fittings. It just stops arguing.
   */
  const drawnZones = useMemo(
    () => [...zones, ...rooms.flatMap((r) => enclosedZones(r.outline))],
    [zones, rooms, enclosedZones]);


  // THE PLAN-WIDE `coved` LIST IS GONE WITH THE SECTION IT FED. A cove is now
  // described inside its own space's row in the Spaces list, which reads
  // `r.cove` directly — so a list of every coved space on the plan is a
  // derivation with nothing left to derive it for.

  /** The room the right-hand panel and the chunk picker are talking about. */
  const focus = useMemo(
    () => rooms.find((r) => r.id === focusId) || rooms[0] || null,
    [rooms, focusId]);

  /* --- THE SPACE THE PANEL IS OPENED ON, WHICH IS NOT `focus` ---------------
     `focus` falls back to the first room so that the drawing always has
     something to talk about; the detail view must not. Opening a space is a
     deliberate act and closing it puts the list back, so a fallback here would
     make "Back to Spaces" a button that goes nowhere. */
  const openRoom = useMemo(
    () => (focusId ? rooms.find((r) => r.id === focusId) ?? null : null),
    [rooms, focusId]);

  const ceilingMmFor = useCallback(
    (id) => ceilingMm[id] ?? DEFAULT_CEILING_MM, [ceilingMm]);

  /** THE FIELD TAKES WHAT IS TYPED AND THE STORE TAKES WHAT IS MEANT. Clamped
   *  rather than refused: 27 is somebody halfway through typing 2700, and a
   *  field that rejects it cannot be typed in at all. An empty box is the
   *  default, which is the only reading of "no height" there is. */
  const setCeilingMmFor = useCallback((id, raw) => {
    const n = Math.round(Number(raw));
    setCeilingMm((m) => {
      if (raw === '' || !Number.isFinite(n)) {
        if (!(id in m)) return m;
        const next = { ...m }; delete next[id]; return next;
      }
      const mm = Math.min(CEILING_MM_MAX, Math.max(CEILING_MM_MIN, n));
      return m[id] === mm ? m : { ...m, [id]: mm };
    });
  }, []);

  const setSurfaceTone = useCallback((id, surface, tone) => {
    setMaterials((m) => {
      const cur = materialsOf(m, id);
      if (cur[surface] === tone) return m;
      return { ...m, [id]: { ...cur, [surface]: tone } };
    });
  }, []);

  const setWallTone = useCallback((id, edge, tone) => {
    setMaterials((m) => {
      const cur = materialsOf(m, id);
      const walls = { ...cur.walls };
      // A WALL BACK AT THE DEFAULT IS A WALL WITH NO ENTRY, so a room somebody
      // set dark and then set light again stores nothing — the same rule
      // `boardKinds` follows, and it is what keeps a saved plan honest about
      // which decisions were actually taken.
      if (tone === 'light') delete walls[edge]; else walls[edge] = tone;
      return { ...m, [id]: { ...cur, walls } };
    });
  }, []);

  /* WHAT THE CANVAS IS HANDED WHILE THE WALL STEP IS OPEN: one polygon and one
     tone per edge, in plan pixels. Null the rest of the time, which is what
     turns the step off in PlanCanvas — there is no second flag. */
  const wallEditRoom = useMemo(
    () => (wallEdit ? rooms.find((q) => q.id === wallEdit) ?? null : null),
    [wallEdit, rooms]);

  const wallEditGeo = useMemo(() => {
    const r = wallEditRoom;
    if (!r) return null;
    return {
      roomId: r.id,
      polygonPx: r.geo.polygonPx,
      tones: materialsOf(materials, r.id).walls,
      selected: wallPick?.edge ?? null,
    };
  }, [wallEditRoom, materials, wallPick]);

  /* THE POPUP GOES WHERE THE POINTER IS, IN VIEWPORT COORDINATES — the stage
     scrolls and zooms under it, and a card anchored to the drawing would have to
     be chased. See WallTonePopup. */
  const pickWallSegment = useCallback((edge, e) => {
    setWallPick({ edge, x: e.clientX, y: e.clientY });
  }, []);

  // --- accent lighting, room by room ----------------------------------------
  //
  // THE MODEL IS NEVER ASKED FOR A COORDINATE. It is asked for a REGION — a
  // rough box round the wall a cove runs along, or round the painting a spot
  // should graze — and the placement of the fitting inside that region is
  // arithmetic done here, later, by code that can measure. That is the whole
  // architecture of this feature and the reason it can work at all where
  // asking for the bed's exact bounds could not: a box 20% too big still
  // contains the right wall, so the several-percent error that makes a point
  // useless is simply absorbed. See the header of accentPrompt.js.
  //
  // Nothing is placed yet. This step produces the zones and draws them; turning
  // a zone into a fixture is the next one.
  const accentRoom = useMemo(
    () => rooms.find((r) => r.id === accentRoomId) || rooms[0] || null,
    [rooms, accentRoomId]);

  /**
   * The picture that goes over the wire, made ahead of the call.
   *
   * Eagerly and not at call time, for two reasons. The panel shows it, and "what
   * did it actually look at" is the first question whenever an answer is odd —
   * a crop that missed the room or a wash that came out the wrong way round is
   * invisible in a list of zones and obvious in a thumbnail. And it re-renders
   * when the LAYOUT changes, not just when the room does, because the ambient
   * lights are drawn onto it: send yesterday's crop and the model is being told
   * about downlights that have since moved.
   */
  useEffect(() => {
    if (!source || !accentRoom?.plan?.ok) { setAccentShot(null); return; }
    let alive = true;
    (async () => {
      try {
        const shot = await roomSnapshot({
          source, img,
          polygonPx: accentRoom.plan.polygonPx,
          lightsPx: accentRoom.plan.lightsPx,
          wallLayers: wallLayerSet,
        });
        if (alive) setAccentShot({ ...shot, roomId: accentRoom.id });
      } catch (err) {
        console.warn('[accents] could not build the room crop:', err);
        if (alive) setAccentShot(null);
      }
    })();
    return () => { alive = false; };
  }, [source, img, accentRoom, wallLayerSet]);

  /**
   * ACCENTS FOR ONE ROOM, without touching state.
   *
   * Pulled out of the button handler because the pipeline needs the same work
   * for a room the panel is not looking at. A handler that reads `accentRoom`
   * and writes `accentResults` cannot be reused for the fourth room of six
   * while the panel is showing the first, and the alternative — driving the
   * panel's state from the pipeline to make the handler fire — is a loop
   * waiting to happen.
   */
  const computeAccents = useCallback(async (r, { reuseShot = null, beds = null } = {}) => {
    const shot = reuseShot ?? await roomSnapshot({
      source, img, polygonPx: r.plan.polygonPx,
      lightsPx: r.plan.lightsPx, wallLayers: wallLayerSet,
    });
    const payload = await requestAccents({
      plan: shot,
      room: {
        name: r.outline.name || null,
        widthFt: r.stats.widthFt, heightFt: r.stats.heightFt, areaSqft: r.stats.areaSqft,
      },
      ceilingFt,
    });
    // OUT OF THE CROP AND BACK ONTO THE PLAN. The model answered in fractions
    // of an image that was a cut-out of one room; every other rectangle in this
    // app is in plan pixels, and furniture left in the crop's space would sit in
    // the top-left corner of the sheet.
    const res = payload.result;
    const furniture = res.furniture.map((f, i) => {
      const t = FURNITURE_BY_ID[f.type];
      return {
        ...f,
        id: `furn-${r.id}-${i}`,
        rect: toPlanRect(f.rect, shot.crop, res.image),
        label: t?.label || f.type,
        colour: t?.colour || '#666',
      };
    });
    /* THE BED THE SCONCES HANG OFF IS THE BED-FILTER BOX, NEVER THIS PASS'S.
     *
     * The accent pass is asked what furniture is in the room. It answers about
     * beds too, and that box only ever had to be roughly right, because all it
     * was used for was deciding which wall to put a sconce on. A bedside sconce
     * is now placed a measured foot from the mattress edge, which makes the box
     * a DIMENSION rather than a hint — and the measured box already exists, from
     * bed-filter or (where bed-filter found nothing in a declared bedroom) from
     * the GPT bed pass.
     *
     * So this pass's own bed boxes are dropped and the authoritative ones
     * substituted, one furniture item per real bed. Two twins therefore produce
     * two symmetric pairs rather than one pair straddling both, which is what
     * happened when a single loose box covered the pair.
     *
     * NO AUTHORITATIVE BED MEANS NO SCONCES. If neither pass put a bed in this
     * room, the accent pass's belief that there is one is not promoted to a
     * position — a sconce derived from a rectangle nobody measured is a fitting
     * on a wall for a bed that may not be there. The room still gets its
     * wardrobe strips and everything else; the bed is simply not a bed until the
     * bed detector says so.
     */
    const mine = beds ? bedsIn(beds, r.plan.polygonPx) : [];
    const others = furniture.filter((f) => f.type !== 'bed');
    const dropped = furniture.length - others.length;
    const bedItems = mine.map((b, i) => ({
      type: 'bed', id: `furn-${r.id}-bed-${i}`, rect: b.rect,
      confidence: b.conf ?? 0.9,
      label: FURNITURE_BY_ID.bed?.label || 'Bed',
      colour: FURNITURE_BY_ID.bed?.colour || '#666',
      from: b.refound ? 'gpt-bedroom-crop' : 'bed-filter',
    }));
    if (dropped || bedItems.length) {
      console.log(`[beds] ${r.outline.name || r.id}: accents — dropped ${dropped} bed box(es)`
        + ` from the accent pass, using ${bedItems.length} from`
        + ` ${bedItems[0]?.from || 'no bed detector'}`);
    }
    const forRules = [...bedItems, ...others];

    // AND THEN THE RULES, IN CODE. The model was asked what furniture is in the
    // room and nothing else; this is where a bed becomes a pair of sconces one
    // foot clear of either end and a wardrobe becomes a strip along its own
    // length. Deterministic, so the house style is the same every run — see
    // accentPrompt.js's header for what happened when it was not.
    //
    // `pxPerFt` is passed because the bedside offset is a real distance now: one
    // foot from the mattress, not a fraction of it. Without a scale the rule
    // falls back to the old fraction rather than placing nothing.
    const { zones: placed, handled } = zonesFromFurniture(forRules, r.plan.polygonPx, { pxPerFt });
    const zones = placed.map((z, i) => ({
      ...z,
      id: `acc-${r.id}-${i}`,
      // Carried on the fitting so a drag handler knows which room's result list
      // to write back into. The zones live per-room in accentResults, and the
      // canvas draws them all in one flat pass.
      roomId: r.id,
      colour: TYPE_BY_ID[z.type]?.colour || '#666',
      label: TYPE_BY_ID[z.type]?.label || z.type,
      short: TYPE_BY_ID[z.type]?.short || z.type,
      // NO `runFt` HERE, deliberately. It used to be stamped on at placement
      // time and it was the one cached derivation on an accent zone — so the
      // moment a strip's end became draggable it started lying, because a drag
      // works in plan pixels and cannot know the scale. Feet are derived where
      // they are shown, from `runLength` and the live px/ft. See runMetres.
    }));
    return { shot, meta: payload.meta, result: {
      ...res,
      // WHAT THE RULES ACTUALLY SAW, so the "show what was identified" overlay
      // draws the bed the sconces were derived from rather than a box that was
      // discarded before any of this ran.
      furniture: forRules,
      // ...and what was discarded, kept separately so the audit panel can say
      // how many accent-pass beds were excluded instead of silently showing a
      // zero nobody can interpret.
      bedsFromAccentPass: furniture.filter((f) => f.type === 'bed'),
      handled, zones,
    } };
  }, [source, img, wallLayerSet, pxPerFt, ceilingFt]);

  /** Task surfaces for one room, likewise. */
  const computeSurfaces = useCallback(async (r, { reuseShot = null } = {}) => {
    const shot = reuseShot ?? await roomSnapshot({
      source, img, polygonPx: r.plan.polygonPx,
      lightsPx: r.plan.lightsPx, wallLayers: wallLayerSet,
    });
    const payload = await requestAccents({
      plan: shot, task: 'surfaces',
      room: {
        name: r.outline.name || null,
        widthFt: r.stats.widthFt, heightFt: r.stats.heightFt, areaSqft: r.stats.areaSqft,
      },
    });
    const res = payload.result;
    const surfaces = res.surfaces.map((sf, i) => {
      const rect = toPlanRect(sf.rect, shot.crop, res.image);
      const t = SURFACE_BY_ID[sf.type];
      return {
        ...sf,
        id: `surf-${r.id}-${i}`, roomId: r.id, rect,
        colour: t?.colour || '#666', label: t?.label || sf.type,
        widthFt: pxPerFt ? (rect.x1 - rect.x0) / pxPerFt : null,
        heightFt: pxPerFt ? (rect.y1 - rect.y0) / pxPerFt : null,
      };
    });
    return { shot, meta: payload.meta, result: { ...res, surfaces } };
  }, [source, img, wallLayerSet, pxPerFt]);

  // --- the render pass, room by room ----------------------------------------
  //
  // TWO CALLS AND THE JOIN BETWEEN THEM. See wallPrompt.js's header for why they
  // are two: recognition off a photograph and localisation on a plan are
  // different jobs, they fail differently, and asked together a failure in
  // either is one indistinguishable silence.

  /** The 1ft grid for the space the panel is looking at. Null with no scale. */
  const wallGrid = useMemo(
    () => (focus?.plan?.ok ? gridFor(focus.plan.polygonPx, pxPerFt) : null),
    [focus, pxPerFt]);

  /**
   * The ANCHORS block for PROMPT 02, built from what this app already knows.
   *
   * The prompt as written carries four anchors with their answers filled in by
   * hand — bed wall, window wall, door, TV unit. Filling those in per room per
   * plan is not a feature, so they are DERIVED: the accent pass has already told
   * us where the bed and the TV unit are in plan pixels, and the door detector
   * has already found the doors. Nothing that was not actually detected is
   * asserted; see anchorLines() for what the block says when nothing was.
   */
  const wallAnchors = useCallback((r, grid) => anchorLines({
    furniture: accentResults[r.id]?.furniture ?? [],
    // `doors` carry their rect in the SOURCE's pixels, which is the same space
    // the room polygons and the grid are in — see scaleFromDoor, which divides
    // one by the other to get px/ft. No conversion, and none wanted: a second
    // coordinate space here is a second thing to get the wrong way round.
    doors,
    grid,
  }), [accentResults, doors]);

  /**
   * The gridded crop, made ahead of the call so the panel can show it.
   *
   * Same argument as accentShot and one step stronger. The grid encodes a
   * coordinate system — [1,1] bottom-left, y counting UP — and a grid drawn the
   * wrong way up produces confident answers that are all mirrored. That is
   * invisible in a list of cell references and instantly obvious in a thumbnail
   * with the numbers running the wrong way.
   */
  useEffect(() => {
    if (!source || !focus?.plan?.ok || !wallGrid) { setWallShot(null); return; }
    let alive = true;
    (async () => {
      try {
        const shot = await roomSnapshot({
          source, img,
          polygonPx: focus.plan.polygonPx,
          lightsPx: focus.plan.lightsPx,
          wallLayers: wallLayerSet,
          grid: wallGrid,
        });
        if (alive) setWallShot({ ...shot, roomId: focus.id });
      } catch (err) {
        console.warn('[render pass] could not build the gridded crop:', err);
        if (alive) setWallShot(null);
      }
    })();
    return () => { alive = false; };
  }, [source, img, focus, wallLayerSet, wallGrid]);

  /**
   * THE PASS ITSELF, for one room. No state written in here — same rule as
   * computeAccents, and for the same reason.
   *
   * `onPhase` exists because this is the longest-running thing in the app by
   * some margin: two reasoning calls on high effort, one of them looking at
   * several photographs. A single "working…" for ninety seconds is
   * indistinguishable from a hang, and the two phases genuinely mean different
   * things to somebody waiting.
   */
  const computeWallItems = useCallback(async (r, views,
                                              { onPhase = () => {}, onCall = () => {} } = {}) => {
    const grid = gridFor(r.plan.polygonPx, pxPerFt);
    if (!grid) throw new Error('No 1ft grid could be laid in this space — is the scale set?');
    if (!views?.length) throw new Error('No renders to look at.');

    const roomInfo = {
      name: r.outline.name || null,
      widthFt: r.stats.widthFt, heightFt: r.stats.heightFt, areaSqft: r.stats.areaSqft,
    };

    // --- PROMPT 01. The renders in, English out. No plan, no coordinates.
    onPhase('reading');
    const first = await requestAccents({
      plans: views, task: 'wallitems', room: roomInfo,
    });
    // REPORTED AS SOON AS IT LANDS, not returned at the end. If the SECOND call
    // then throws, this is the transcript that says whether the first one was
    // fine — which is the first question anybody asks about a failed run, and it
    // would be lost with the exception if both were handed back together.
    onCall('first', first.meta);
    const elements = (first.result?.elements ?? []).map((e, i) => ({
      ...e,
      id: `wall-${r.id}-${i}`,
      roomId: r.id,
      label: WALL_BY_ID[e.type]?.label || e.type,
      colour: WALL_BY_ID[e.type]?.colour || '#666',
    }));

    // NOTHING SEEN IS AN ANSWER, AND IT SHORT-CIRCUITS. Sending an empty array
    // into PROMPT 02 would spend a second reasoning call to be told there is
    // nothing to place, and buildGridRequest refuses it for exactly that reason.
    if (!elements.length) {
      return { grid, shot: null, meta: { first: first.meta, second: null },
               result: { elements: [], skipped: first.result?.skipped ?? [], placedNone: false } };
    }

    // --- PROMPT 02. The plan with a grid on it, plus that English, cells out.
    onPhase('gridding');
    const shot = await roomSnapshot({
      source, img, polygonPx: r.plan.polygonPx,
      lightsPx: r.plan.lightsPx, wallLayers: wallLayerSet, grid,
    });

    onPhase('placing');
    const second = await requestAccents({
      plan: shot, task: 'wallgrid', room: roomInfo,
      elements, anchorLines: wallAnchors(r, grid), grid,
    });
    onCall('second', second.meta);

    // THE JOIN, AND IT IS DELIBERATELY FORGIVING. Step 5 asks for the original
    // array back unchanged, so index order is the first thing tried; a model
    // that reordered or dropped one is matched on type-and-wall instead. What
    // is NOT done is inventing cells for an element that came back without
    // them — see the panel: "seen but not placed" is a real, legible state.
    const joined = joinPlacements(elements, second.result?.placed ?? []);

    return {
      grid, shot,
      meta: { first: first.meta, second: second.meta },
      result: {
        elements: joined,
        skipped: [...(first.result?.skipped ?? []), ...(second.result?.skipped ?? [])],
        // The one distinction the panel cannot draw for itself: the second call
        // came back with an array that placed NOTHING, versus the second call
        // came back with no array at all. Both leave every element unplaced.
        placedNone: !second.result?.matched,
      },
    };
  }, [source, img, wallLayerSet, pxPerFt, wallAnchors]);

  /** The button. Shrinks whatever was dropped in, runs the pass, writes state. */
  const runWallPass = useCallback(async () => {
    const r = focus;
    const views = renders[r?.id] ?? [];
    if (!r?.plan?.ok || !views.length) return;

    // CHARGED BEFORE THE CALLS, AND GIVEN BACK IF THEY FAIL.
    //
    // Before, because this is the moment the money is committed — two vision
    // calls go out and a user who closes the tab has still spent them, so
    // charging on success would make an abandoned pass free.
    //
    // Given back, because a pass that comes back as a 500 has cost nobody
    // anything, and quietly keeping one of five is the sort of small theft that
    // produces a support email. The reversal is a second ledger row rather than
    // a deletion — see releaseAction in api/billing.js.
    //
    // A FRESH runId PER CLICK, so a retry after a failure is a new charge and
    // not a silently deduplicated no-op. The idempotency this key buys is only
    // against the same click arriving twice.
    let claim = null;
    if (onClaimPass && !readOnly) {
      const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      claim = await onClaimPass({ roomId: r.id, runId });
      if (!claim?.ok) return;
    }

    setWallState({ status: 'running', roomId: r.id, phase: 'reading' });
    // A FRESH TRANSCRIPT FOR THIS RUN, cleared up front rather than merged into.
    // Leaving the last run's second call sitting there while this run's first
    // call is still in flight is a dialog showing two halves of two different
    // runs, which is worse than showing nothing.
    setWallTranscripts((m) => ({ ...m, [r.id]: {} }));
    const record = (which, meta) => setWallTranscripts((m) => ({
      ...m,
      [r.id]: {
        ...(m[r.id] ?? {}),
        [which]: {
          model: meta?.model ?? null, ms: meta?.ms ?? null,
          usage: meta?.usage ?? null, bytes: meta?.bytes ?? null,
          sentImages: meta?.sentImages ?? meta?.images ?? 0,
          prompt: meta?.prompt ?? '',
          // `fullReply` where the route sent one — the render-pass tasks do —
          // and the 900-character head slice as the fallback, so a route that
          // has not been redeployed yet degrades to something rather than blank.
          reply: meta?.fullReply ?? meta?.reply ?? '',
        },
      },
    }));
    const t0 = Date.now();
    try {
      const out = await computeWallItems(r, views, {
        onPhase: (phase) => setWallState((st) =>
          (st.roomId === r.id ? { ...st, phase } : st)),
        onCall: record,
      });
      setWallResults((m) => ({ ...m, [r.id]: out.result }));
      if (out.shot) setWallShot({ ...out.shot, roomId: r.id });
      setWallState({ status: 'done', roomId: r.id, ms: Date.now() - t0 });
      console.log(`[render pass] ${r.outline.name || r.id}:`,
        `${out.result.elements.length} element(s),`,
        `${out.result.elements.filter((e) => e.cells?.length).length} placed`,
        out.meta);
    } catch (err) {
      console.warn('[render pass] failed', err);
      // The pass is the thing that was bought and it did not happen. Fire and
      // forget: a failed release must not turn one error into two, and the
      // ledger is auditable either way.
      if (claim?.fingerprint) onReleasePass?.(claim.fingerprint);
      setWallState({ status: 'error', roomId: r.id, error: String(err.message || err),
                     ms: Date.now() - t0 });
    }
  }, [focus, renders, computeWallItems, onClaimPass, onReleasePass, readOnly]);

  /** Files in -> downscaled renders on the selected space. See renderImage.js
   *  for why nothing that arrives here is ever sent at the size it arrived. */
  const addRenders = useCallback(async (files) => {
    const r = focus;
    if (!r) return;
    setWallState({ status: 'running', roomId: r.id, phase: 'shrinking' });
    try {
      const have = renders[r.id] ?? [];
      const { renders: shrunk, notes } = await fitAll(files);
      // THE CAP IS RENDERIMAGE'S NUMBER, NOT A SECOND ONE HERE. fitAll() already
      // refuses more than this in a single drop; this is the same limit applied
      // to a drop that ARRIVES IN TWO GOES, and two constants that must agree
      // is one constant with a bug waiting in it.
      const kept = [...have, ...shrunk].slice(0, RENDER_DEFAULTS.maxRenders);
      setRenders((m) => ({ ...m, [r.id]: kept }));
      setWallState({ status: 'idle', roomId: r.id, notes });

      // --- and then, in the background, to the bucket ----------------------
      //
      // AFTER THE STATE, NOT BEFORE IT. The thumbnails and the Analyse button
      // are ready the moment the canvas has finished; making either of them
      // wait on an upload would put a spinner in front of a picture that is
      // already decoded and in memory for no benefit to the person looking at
      // it. And it must not be able to fail the drop: a bucket that refuses is
      // a render that is not KEPT, which is a smaller problem than a render
      // that cannot be USED.
      if (!renderStore?.put) return;
      const base = (renderRefs[r.id] ?? []).length;
      shrunk.forEach((v, i) => {
        // Only the ones that survived the cap above are worth storing.
        if (!kept.includes(v)) return;
        renderStore.put(renderBlob(v), { roomId: r.id, index: base + i })
          .then((path) => {
            if (!path) return;
            setRenderRefs((m) => ({ ...m, [r.id]: [...(m[r.id] ?? []), renderRef(v, path)] }));
          })
          .catch((err) => console.warn('[render pass] a view was not stored', err));
      });
    } catch (err) {
      setWallState({ status: 'error', roomId: r.id, error: String(err.message || err) });
    }
  }, [focus, renders, renderRefs, renderStore]);

  /**
   * THE VIEWS, BACK OUT OF THE BUCKET — for the space that is open, and no other.
   *
   * WHY LAZY. A flat of nine rooms with four views each is thirty-six JPEGs and
   * several megabytes; fetching all of them to open a plan would put that on the
   * critical path of every reload to populate drop targets nobody has looked at.
   * The refs are already restored, so the panel knows how many views a space has
   * before a single byte is fetched — this only pays for the one on screen.
   *
   * WHY IT NEVER OVERWRITES. `renders[id]` being present means either these
   * bytes are already here or somebody has just dropped new files in, and the
   * second one must win. So an id that already has a working copy is skipped
   * outright rather than merged.
   */
  const fetchingRenders = useRef(new Set());
  useEffect(() => {
    const id = focus?.id;
    const refs = id ? (renderRefs[id] ?? []) : [];
    if (!id || !refs.length || !renderStore?.url) return;
    if (renders[id]?.length || fetchingRenders.current.has(id)) return;
    fetchingRenders.current.add(id);
    let alive = true;
    (async () => {
      try {
        const back = [];
        for (const ref of refs) {
          const href = renderStore.url(ref.path);
          if (!href) continue;
          try { back.push(await fetchRender(href, ref)); }
          catch (err) { console.warn('[render pass] a stored view is missing', ref.path, err); }
        }
        if (alive && back.length) setRenders((m) => (m[id]?.length ? m : { ...m, [id]: back }));
      } finally {
        fetchingRenders.current.delete(id);
      }
    })();
    return () => { alive = false; };
  }, [focus?.id, renderRefs, renders, renderStore]);

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

  /** What kind of space is it? One small call, one word back. */
  const computeRoomType = useCallback(async (r, { reuseShot = null } = {}) => {
    const shot = reuseShot ?? await roomSnapshot({
      source, img, polygonPx: r.plan.polygonPx,
      lightsPx: r.plan.lightsPx, wallLayers: wallLayerSet,
    });
    const payload = await requestAccents({
      plan: shot, task: 'roomtype', projectId,
      room: {
        name: r.outline.name || null,
        widthFt: r.stats.widthFt, heightFt: r.stats.heightFt, areaSqft: r.stats.areaSqft,
      },
    });
    return { shot, ...payload.result };
  }, [source, img, wallLayerSet, projectId]);

  /**
   * WHICH DETECTOR GOT THE BED RIGHT, for one room.
   *
   * Two crops of the same room, made by the same roomSnapshot() that feeds the
   * accent and task passes, differing in NOTHING but the rectangles drawn on
   * them. Same crop rectangle, same wash, same colour, same line weight — the
   * only thing the model can prefer is the geometry, which is the only thing it
   * is being asked about.
   *
   * NO LIGHTS ON THESE CROPS. Everywhere else the ambient layout is drawn onto
   * the picture so the model does not recommend a fitting where one already
   * hangs. Here it would be noise at best and misleading at worst: this runs
   * BEFORE the layout, precisely because the answer moves the layout.
   *
   * Takes the outline rather than a laid-out room for the same reason — there
   * is no `plan` yet when this runs.
   */
  const computeBedFit = useCallback(async (o, a, b, { signal = null } = {}) => {
    const region = regionFromOutline(o, pxPerFt);
    if (!region?.ok) throw new Error('That outline has no region.');
    const polygonPx = useBoundingRect ? region.boundingRect : region.polygon;
    const stats = outlineStats(o, pxPerFt);

    const shots = await Promise.all([a, b].map((boxes, i) => roomSnapshot({
      source, img, polygonPx, lightsPx: [], wallLayers: wallLayerSet,
      boxes: boxes.map((d) => d.rect),
      badge: BED_SOURCES[i].letter,
    })));

    const payload = await requestAccents({
      plans: shots, task: 'bedfit', signal,
      counts: { a: a.length, b: b.length },
      room: {
        name: o.name || null,
        widthFt: stats?.widthFt ?? null, heightFt: stats?.heightFt ?? null,
        areaSqft: stats?.areaSqft ?? null,
      },
    });
    return { shots, verdict: payload.result, meta: payload.meta };
  }, [source, img, wallLayerSet, pxPerFt, useBoundingRect]);

  /**
   * ASK CHATGPT ABOUT ONE ROOM — the fallback, and the ONLY thing GPT does
   * with beds now.
   *
   * WHEN IT RUNS, AND IT IS THE WHOLE RULE: the classifier called a space a
   * bedroom and the whole-plan `bed-filter` pass put no bed in it. That is a
   * contradiction between two answers already in hand, and it is the only
   * trigger. A bedroom that has its bed does not come here. A space that is not
   * a bedroom does not come here whatever the pass found.
   *
   * WHY IT IS WORTH A CALL. A bedroom with no bed is not an unusual bedroom, it
   * is a failed detection — see expectsBed in roomTypes.js — and it matters more
   * than any other miss because a bed is the one piece of furniture that CHANGES
   * THE CEILING: nothing goes over it, because whoever is lying there looks
   * straight up into the fitting. A missed bed is a downlight in somebody's eyes.
   *
   * WHY THE CROP HELPS. The whole plan is one image at roughly 17 pixels to the
   * foot on a large sheet, where a mattress is 45px across. This sends ONE room
   * at 700x700 — nearer 54 pixels to the foot for a 13ft room — reusing the crop
   * the classifier already built, so it costs no extra render. Same model, same
   * question, four times the resolution.
   *
   * ONE CALL. NO CONTEST. NO JUDGE.
   *
   * What was here before, in order: two vendors contested and arbitrated; then
   * two SAMPLES of GPT contested and arbitrated. Both were ways of buying
   * confidence in a bed outline nobody trusted. With `bed-filter` handling the
   * primary path, this is a narrow fallback on a room the primary pass already
   * missed — and a second opinion about a single fallback answer is a call spent
   * to choose between two guesses rather than to improve either. `contestFor`,
   * `applyVerdict` and `computeBedFit` all still exist, unused by this path.
   */
  const refindBeds = useCallback(async (r, { reuseShot = null, signal = null } = {}) => {
    const shot = reuseShot ?? await roomSnapshot({
      source, img, polygonPx: r.plan.polygonPx, lightsPx: [], wallLayers: wallLayerSet,
    });
    const who = r.outline.name || r.id;

    const payload = await detectFurniture({
      base64: shot.base64, mime: shot.mime,
      // ONLY BEDS. The whole-plan pass asks a bed-specific model; here the
      // question is precisely "is there a bed in this room", and a narrower
      // prompt is a better answer.
      classes: ['bed'],
      provider: 'openai',
      w: shot.w, h: shot.h, signal,
    });

    // The crop's own space first, then back onto the plan. detectionsToZones
    // resolves fractions and rescales against the image it was given; every
    // threshold in it (confidence, area fraction) is therefore relative to THE
    // ROOM, which is the right frame — a bed is a large share of a bedroom crop
    // and a tiny share of a floor plan.
    const image = { w: shot.w, h: shot.h };
    const read = detectionsToZones(payload, { image, polygon: null, classes: ['bed'] });

    // OUT OF THE CROP'S SPACE FIRST, THEN MEASURED. The crop is upscaled or
    // downscaled by roomSnapshot, so the plan's px-per-foot means nothing inside
    // it — a size gate applied to a crop-space rectangle would be measuring in
    // the wrong units. `toPlanRect` is the line where real feet become knowable
    // again, so the gate goes immediately after it.
    let rejected = 0;
    const beds = labelBeds(read.kept, 'openai')
      .map((d, i) => ({
        ...d,
        id: `det-refound-oa-${r.id}-${i}`,
        rect: toPlanRect(d.rect, shot.crop, image),
        refound: true,
      }))
      .filter((d) => {
        const fit = plausibleBed(d.rect, pxPerFt);
        if (!fit.ok) {
          rejected++;
          console.warn(`[beds] ${who}: GPT returned a box that is not a bed — ${fit.why}`);
        }
        return fit.ok;
      });

    // The record the panel and planState keep per space. `asked: false` because
    // nothing was arbitrated; `kind` describes what the one call came back with,
    // so the panel's per-space line still says something true.
    const rec = {
      kind: beds.length ? 'gpt' : 'none',
      pick: 'openai', asked: false, confidence: 0,
      why: beds.length
        ? `GPT found ${beds.length} bed(s) in the crop`
        : 'GPT found no bed in the crop either',
      winner: beds,
      counts: { openai: beds.length, roboflow: 0 },
      rejected,
    };
    console.log(`[beds] ${who}: ${judgeNote(rec)}`);

    // `a`/`b` are still in the returned shape because absorbBedRows reads
    // row.a.length and row.b.length for its own record. One call, so b is empty.
    return { a: beds, b: [], rec, shot };
  }, [source, img, wallLayerSet, pxPerFt]);

  /**
   * TAKE A BATCH OF PER-ROOM BED ANSWERS AND MAKE THEM THE PLAN'S BEDS.
   *
   * Extracted because two callers need identical behaviour and a second copy of
   * this would drift within a week: the pipeline's bedroom pass, and the admin
   * "Look again" button. Both have to apply the same three rules, and each one
   * exists because of a specific way this went wrong:
   *
   *   CONTAINMENT — a crop carries a margin, so a room's picture routinely
   *   includes its neighbour's bed. One call came back with four beds labelled
   *   ROOM 8 and ROOM 9. Unattributed, they double-count and let a room test as
   *   "has a bed" on somebody else's mattress.
   *
   *   DEDUPE — a room can be asked again when it already holds a bed, so the
   *   same mattress arrives twice. iou 0.45, the same limit the whole-sheet
   *   merge uses.
   *
   *   `existing` IS PASSED IN rather than read from state, because the pipeline
   *   calls this mid-run when its own setDetections has not rendered yet. A
   *   React update is not visible until the next render and neither caller gets
   *   one in the middle of its loop.
   *
   * The physical gate is NOT here: it lives in refindBeds (right after the crop
   * is mapped back to plan pixels) and again in detectedZones. This is about
   * whose bed it is, not whether it is one.
   */
  const absorbBedRows = useCallback((rows, existing) => {
    const found = [];
    const verdicts = {};
    for (const row of rows) {
      if (!row || row.error) continue;
      const winner = row.rec.winner || [];
      const poly = row.poly;
      const mine = poly ? bedsIn(winner, poly) : winner;
      const already = poly ? bedsIn(existing, poly) : [];
      const fresh = mine.filter((d) => !already.some((e) => iou(d.rect, e.rect) > 0.45));
      for (const d of fresh) found.push({ ...d, roomId: row.id, contest: row.rec.kind });
      verdicts[row.id] = {
        kind: row.rec.kind, pick: row.rec.pick, asked: row.rec.asked,
        confidence: row.rec.confidence ?? 0, why: row.rec.why || '',
        fellBack: !!row.rec.fellBack, failed: !!row.rec.failed,
        refound: true,
        counts: { roboflow: row.a.length, openai: row.b.length },
        kept: mine.length, fresh: fresh.length,
      };
    }
    if (found.length) setDetections((prev) => [...prev, ...found]);
    setBedVerdicts((prev) => ({ ...prev, ...verdicts }));
    return { found, verdicts };
  }, []);

  /**
   * LOOK AGAIN — the admin's manual version of the bedroom pass.
   *
   * The pipeline asks about a bedroom once, and on a plan where the first answer
   * was wrong there is otherwise no way to ask twice without re-running the whole
   * thing. This is that button: same crop, same two samples, same judge, same
   * gates.
   *
   * SCOPED TO THE ROOM IN FOCUS when there is one, because that is the room whose
   * beds the person is looking at and two calls is a cheap question. With no
   * focus it sweeps every space that ought to contain a bed.
   */
  const [bedLook, setBedLook] = useState(null);   // null | 'busy' | a result line

  const lookAgainAtBeds = useCallback(async () => {
    if (!source || !pxPerFt || !rooms.length) return;
    const targets = focus
      ? [focus]
      : rooms.filter((r) => expectsBed(projectId, roomTypes[r.id]?.type));
    if (!targets.length) { setBedLook('no bedrooms to look in'); return; }

    setBedLook('busy');
    try {
      const rows = await mapLimit(targets, 2, async (r) => {
        try {
          const out = await refindBeds(r);
          return { id: r.id, name: r.outline.name,
                   poly: r.plan?.polygonPx ?? r.geo?.polygonPx ?? null, ...out };
        } catch (err) {
          console.warn('[beds] look again failed for', r.outline.name, err);
          return null;
        }
      });
      const { found } = absorbBedRows(rows, detections);
      const asked = rows.filter(Boolean).length;
      setBedLook(`${found.length} bed${found.length === 1 ? '' : 's'} added`
        + ` from ${asked} space${asked === 1 ? '' : 's'}`);
      console.log('[beds] look again', { targets: targets.map((r) => r.outline.name), found });
    } catch (err) {
      console.error('[beds] look again failed', err);
      setBedLook('that did not work — see the console');
    }
  }, [source, pxPerFt, rooms, focus, projectId, roomTypes, refindBeds, absorbBedRows, detections]);

  /** What the canvas draws: every surface still standing, in plan pixels. */
  /**
   * Every task surface on the plan, whatever put it there.
   *
   * TWO SOURCES, ONE LIST. The detector's surfaces and the ones drawn by hand
   * with the spot tool are the same kind of object and go through the same
   * placer below — which is why the spot tool is a surface tool underneath. A
   * hand-drawn area gets a spot on the secondary grid for the same reason a
   * detected dining table does, and neither of them knows about the other.
   */
  const surfacesPx = useMemo(() => {
    const out = [];
    for (const r of rooms) {
      const res = surfaceResults[r.id];
      if (!res?.surfaces) continue;
      for (const sf of res.surfaces) if (!surfaceDismissed.includes(sf.id)) out.push(sf);
    }
    const live = new Set(rooms.map((r) => r.id));
    return [...out, ...manualSurfaces.filter((m) => live.has(m.roomId))];
  }, [rooms, surfaceResults, surfaceDismissed, manualSurfaces]);

  /**
   * A DIRECTIONAL SPOT FOR EVERY TASK SURFACE, on the secondary grid.
   *
   * Derived, not stored. The spot is a function of the surface, the ambient
   * layout and the obstacles, and all three of those move — nudge a fan and the
   * segment the spot was standing on can become illegal. Holding it in state
   * would mean a spot that is right when it is computed and quietly wrong ever
   * after; recomputing means it is always the answer to the layout as it
   * actually is.
   *
   * Everything crosses into the room's own FEET here, because that is the space
   * the chunks, the lights and the clearance rules all already live in, and
   * back out to plan pixels for the canvas.
   */
  /**
   * THE ART ON THE WALLS, one entry per PIECE, in plan pixels.
   *
   * Per piece and not per spot, and that is the change the drawing asked for. A
   * row of spots lighting one picture is placed as a formation — one line, a
   * fixed spacing, all of it or none — so the unit handed to the placer has to
   * be the picture, with the number of fittings it wants as a field. Handing it
   * the fittings one at a time is what put a pair several feet apart on two
   * different lines. See the header of the placement section in artSpots.js.
   */
  const artPiecesPx = useMemo(() => {
    const out = [];
    for (const r of rooms) {
      const res = wallResults[r.id];
      if (!res?.elements?.length || !r.plan?.ok) continue;
      const grid = gridFor(r.plan.polygonPx, pxPerFt);
      if (!grid) continue;
      for (const e of res.elements) {
        if (!litByArtSpots(e.type)) continue;
        // NOT LIT, BY SOMEBODY'S DECISION. Dropped here rather than filtered out
        // of the finished spots, so the row's segments go back to the ceiling and
        // the piece stops appearing as a refusal in the panel. A deleted fitting
        // should leave no trace of itself in the layout, and a rejection with no
        // fitting is a trace.
        if (artDismissed.includes(e.id)) continue;
        const rect = e.cells?.length ? cellsToRect(e.cells, grid) : null;
        if (!rect) continue;
        const { ft, from } = artWidthFt(e, grid);
        out.push({
          id: e.id, roomId: r.id, type: e.type,
          label: WALL_BY_ID[e.type]?.label || e.type,
          colour: WALL_BY_ID[e.type]?.colour || '#666',
          rect,
          // Which way the run lies, which is also which way the wall runs, which
          // is also the axis the row of spots has to lie along.
          horizontal: e.start && e.end ? e.start.y === e.end.y : true,
          n: spotCountFor(ft), widthFt: ft, widthFrom: from,
        });
      }
    }
    return out;
  }, [rooms, wallResults, pxPerFt, artDismissed]);

  const taskSpotsPx = useMemo(() => {
    const out = [];
    for (const r of rooms) {
      if (!r.plan?.ok) continue;
      const mine = surfacesPx.filter((sf) => sf.roomId === r.id);
      const art = artPiecesPx.filter((a) => a.roomId === r.id);
      if (!mine.length && !art.length) continue;
      const { toFt, toPx } = r.geo;
      const rectFt = (rect) => {
        const a = toFt({ x: rect.x0, y: rect.y0 });
        const b = toFt({ x: rect.x1, y: rect.y1 });
        return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y),
                 x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
      };
      // The ceiling as both passes see it. One object, so a rule added to one
      // pass cannot quietly apply to only half the fittings in the room.
      const ceiling = {
        chunks: r.plan.chunks,
        lights: r.plan.lights,
        polygon: r.plan.polygonFt,
        fixtures: r.geo.fixturesFt,
        chandeliers: r.geo.fixturesFt.filter((f) => f.kind === 'chandelier'),
        zones: r.plan.zones ?? [],
        // The cove line, where there is one, so a spot keeps off it for the
        // same reason every other fitting does. `plan.opt` is the resolved
        // options the layout was actually built with, coves included.
        coves: r.plan.opt?.coves ?? [],
        // THE RAILS, FLATTENED, SO THE PLACER IS NOT TRACK-BLIND.
        //
        // Step 3 below still pulls a finished spot onto the profile if it
        // landed within reach of one, and that pass is not going away: it is
        // what actually moves the fitting and it is the only thing that knows
        // which inches of profile the ambient modules already hold. What it
        // cannot do is influence WHICH candidate position the placer picks, so
        // on a track ceiling the placer was choosing between a position that
        // becomes a track module and one that becomes a separate recessed
        // fitting without knowing that was the choice. Now it knows, and prefers
        // the rail by a stated amount rather than by luck. See
        // SPOT_DEFAULTS.trackMissFt.
        //
        // `absorb` rides on each run because it is the track's own figure and a
        // preference derived from a different one would disagree with the pass
        // that does the moving.
        tracks: (r.tracks ?? []).flatMap((t) =>
          (t.runs ?? []).map((run) => ({ ...run, absorb: t.absorb }))),
        opt,
      };

      // --- 1. TASK SURFACES FIRST, unchanged, and first on purpose.
      //
      // ALL of this room's surfaces at once, not one at a time, because the rule
      // that one spot lights one surface is a rule ABOUT THE SET: a segment can
      // only be spent once, and that cannot be decided by a function looking at
      // a single surface. ALL the room's chunks too — a living-dining room has
      // its coffee table in one chunk and its dining table in another, and
      // giving both the same grid puts one of them nowhere near what it is
      // lighting.
      // THE TYPE TRAVELS WITH THE RECT, and it is the only field the placer
      // needs beyond the geometry. Peer surfaces are lit as one run off one
      // ceiling line — see the RUNS header in taskSpots.js — and "peer" is
      // decided first of all by the two being the same kind of thing. A pair of
      // coffee tables is one piece of furniture; a coffee table and a desk that
      // happen to line up are not, and without the type the placer cannot tell
      // them apart and would have to guess.
      const placed = mine.length
        ? planTaskSpots(mine.map((sf) => ({ ...rectFt(sf.rect), type: sf.type })), ceiling) : [];

      mine.forEach((sf, k) => {
        const res = placed[k];
        if (!res?.spot) {
          out.push({ id: `spot-${sf.id}`, surfaceId: sf.id, fixture: 'spot', colour: sf.colour,
                     rejected: res?.rejected, skipped: res?.skipped });
          return;
        }
        const p = toPx(res.spot);
        const t = toPx(res.spot.target);
        out.push({
          id: `spot-${sf.id}`, surfaceId: sf.id, roomId: r.id, fixture: 'spot',
          highlight: sf.rect,
          x: p.x, y: p.y,
          target: t,
          angle: Math.atan2(t.y - p.y, t.x - p.x),
          via: res.spot.via,
          // HOW FAR IT IS AIMING, AND WHETHER THAT IS TOO FAR. A spot past the
          // cap is placed rather than refused — a fitting a person can see and
          // drag beats a sentence in a panel — but it is a compromise, and the
          // drawing and the panel have to be able to say so. Without this the
          // only difference between a good spot and one grazing a wall from
          // eleven feet is how the arrow looks.
          aimFt: res.spot.aimFt,
          far: res.spot.far ?? false,
          // Present only on a spot standing in a run, so the drawing and the
          // tooltip can say WHY it is where it is: the lane was chosen for the
          // group, not for this table on its own.
          run: res.spot.run ?? null,
          // The segment it is standing on, in pixels, so the drawing can show
          // its working when the secondary grid is switched on.
          segment: { a: toPx(res.spot.segment.a), b: toPx(res.spot.segment.b) },
          grid: res.grid ? {
            lines: res.grid.lines.map((l) => ({ ...l, a: toPx(l.a), b: toPx(l.b) })),
          } : null,
        });
      });

      if (!art.length) continue;

      // --- 2. THEN THE ART, out of the way of everything already there.
      //
      // AFTER, AND NOT IN THE SAME CALL. They used to go in together on the
      // reasoning that one placer sharing one used-once set is what stops two
      // fittings landing on one point. That is right about the goal and wrong
      // about the mechanism now: an art row does not stand on a SEGMENT, it
      // stands at a chosen point along a LINE, so the segment ledger says
      // nothing about it. What the two passes have to share is the list of
      // POSITIONS already taken — the ambient downlights included, because the
      // lines this row stands on are the ones those downlights define.
      //
      // Task surfaces still go first, and that is still the same judgement: a
      // dining table is a bigger commitment than a picture and is harder to
      // light from anywhere else.
      const taken = [
        ...r.plan.lights.map((l) => ({ x: l.x, y: l.y })),
        ...placed.filter((q) => q?.spot).map((q) => ({ x: q.spot.x, y: q.spot.y })),
      ];
      const rows = planArtSpots(
        art.map((a) => ({ ...a, rect: rectFt(a.rect) })),
        { ...ceiling, taken });

      art.forEach((a, k) => {
        const res = rows[k];
        if (!res?.spots) {
          // ONE ENTRY FOR THE WHOLE ROW, because the row is what was refused.
          // Pushing `n` identical rejections would report a five-foot picture as
          // two separate failures with one cause.
          // WITH ITS roomId, unlike a refused task spot. Nothing is billed for
          // it — buildBOQ skips anything carrying `rejected` — and the panel
          // needs it: the render pass is a per-space screen, and a refusal it
          // cannot attribute to a space is a refusal it cannot show.
          out.push({ id: `spot-${a.id}`, wallId: a.id, roomId: r.id,
                     fixture: ART_SPOT.fixture, art: true, colour: a.colour,
                     wanted: a.n, rejected: res?.rejected });
          return;
        }
        // WHAT EACH ONE AIMS AT. The row is tight — a foot between fittings —
        // and the artwork is not, so the spots are NOT all pointed at its
        // centre: each takes its own share of the width, which is how a pair
        // lights a five-foot piece evenly instead of twice-lighting the middle.
        const aims = sliceRect(rectFt(a.rect), a.n, a.horizontal);
        res.spots.forEach((sp, i) => {
          const aim = aims[i] ?? rectFt(a.rect);
          const t = toPx({ x: (aim.x0 + aim.x1) / 2, y: (aim.y0 + aim.y1) / 2 });
          const p = toPx(sp);
          out.push({
            id: `spot-${a.id}-${i}`, wallId: a.id, roomId: r.id,
            fixture: ART_SPOT.fixture, art: true, colour: a.colour,
            highlight: a.rect,
            x: p.x, y: p.y,
            target: t,
            angle: Math.atan2(t.y - p.y, t.x - p.x),
            via: 'art-row',
            standoff: sp.standoff, slid: sp.slid, index: i, of: sp.of,
            segment: { a: toPx(sp.line.a), b: toPx(sp.line.b) },
            grid: null,
          });
        });
      });
    }

    // --- 3. AND THEN THE TRACKS TAKE WHAT THEY CAN REACH ------------------
    //
    // A SECOND ABSORPTION PASS, BECAUSE THE TWO LAYERS ARE PLANNED AT DIFFERENT
    // TIMES AND THAT IS NOT AN ACCIDENT OF THE CODE. The ambient grid is settled
    // inside the ceiling design, and the track is set out through it there; the
    // task and art spots are placed HERE, afterwards, against that finished
    // grid. So a spot cannot be absorbed when the profile is drawn — it does not
    // exist yet — and the profile cannot wait for the spots, because the spots
    // are placed relative to the grid the profile was set out to. One pass each,
    // in the only order the dependency allows.
    //
    // `occupied` IS WHAT KEEPS THE TWO HONEST. The ambient modules already hold
    // their inches of profile, and a directional head clipped into the same inch
    // is a clash on site. The track reports its slots (see planTrack) and this
    // pass respects them, so a spot that has nowhere to go stays recessed rather
    // than being drawn on top of a downlight.
    //
    // AFTER THE LOOP AND NOT INSIDE IT, because the loop returns early for a
    // room with no art and a step at the bottom of its body would silently skip
    // those rooms — which is most of them.
    for (const r of rooms) {
      const tracks = r.tracks ?? [];
      if (!tracks.length) continue;
      const { toFt, toPx } = r.geo;
      const mine = [];
      out.forEach((sp, i) => {
        if (sp.roomId === r.id && !sp.rejected && sp.x != null && sp.target) mine.push({ i, sp });
      });
      if (!mine.length) continue;
      // The spots are in PLAN PIXELS by the time they are pushed above and the
      // track is in the room's own feet, so this converts once, here, rather
      // than asking absorbPoints to know about two coordinate spaces.
      const ptsFt = mine.map((m) => toFt({ x: m.sp.x, y: m.sp.y }));
      for (const t of tracks) {
        // `len` IS THE SPOT'S BODY AND NOT THE HEAD'S, and it decides two things
        // at once: how much profile a spot needs behind it at the end of a run,
        // and how much room it needs beside its neighbours. A directional body
        // is half the length of an ambient one, so passing the ambient figure
        // both pushes it needlessly far in from a corner AND refuses a second
        // spot beside it that would physically clear the first by eight inches.
        // THE SAME ZONES THE AMBIENT PASS OBEYED, LESS THE BEDS.
        //
        // This said "a spot dragged over a bed is as wrong as a downlight
        // there", and that is the sentence the whole overBed rule disagrees
        // with: a bed is a no-light zone because a downlight fires into the
        // eyes of somebody lying under it, and a directional head fires where
        // it is pointed. Keeping the beds in here would have contradicted the
        // placer one step after it — a spot deliberately stood over a mattress
        // to light the wall behind the bed would be the one spot the rail
        // running along that wall refused to carry, and it would come out
        // recessed six inches off the profile.
        //
        // Everything else in the list stays. A hole for a beam and a slot with
        // tape in it are places where there is no ceiling to clip a module to,
        // and that is true of a track head as much as of a downlight.
        const spotKeepOff = (SPOT_DEFAULTS.overBed && (opt.overBed ?? true))
          ? (t.keepOff ?? []).filter((z) => !isBedZone(z))
          : (t.keepOff ?? []);
        const got = absorbPoints(t.runs, ptsFt, { absorb: t.absorb, len: SPOT_LEN_FT,
                                                 // A SPOT MAY SLIDE ALONG THE
                                                 // PROFILE TO GET PAST A MODULE
                                                 // THAT IS ALREADY THERE, and an
                                                 // ambient head may not: a head
                                                 // is one of a row whose spacing
                                                 // is the layout, a spot is
                                                 // aimed at one object and owes
                                                 // nothing to its neighbours.
                                                 // Without this a spot whose
                                                 // landing was held by the
                                                 // corner head was dropped and
                                                 // drawn recessed, on a ceiling
                                                 // that is a track. See
                                                 // DODGE_FT.
                                                 dodge: DODGE_FT,
                                                 keepOff: spotKeepOff,
                                                 occupied: t.occupied });
        got.forEach((a, k) => {
          if (!a) return;
          const m = mine[k];
          const at = toPx({ x: a.x, y: a.y });
          out[m.i] = {
            ...m.sp, x: at.x, y: at.y,
            // Where the placer put it, kept for the same reason a light keeps
            // `gridPx`: the drawing shows the move, so the claim that nothing
            // was re-planned is checkable rather than asserted.
            gridPx: { x: m.sp.x, y: m.sp.y },
            track: t.key, trackRun: a.run, trackAxis: t.runs[a.run].axis,
            fixture: trackFixtureFor(m.sp.fixture),
            // RE-AIMED FROM WHERE IT NOW IS. A spot is a fitting plus a
            // direction, and moving the fitting without turning it leaves the
            // arrow — and the beam — pointing past the thing it is for.
            angle: Math.atan2(m.sp.target.y - at.y, m.sp.target.x - at.x),
          };
          // Spent. A spot absorbed by one run cannot be offered to the next.
          ptsFt[k] = null;
        });
      }
    }
    return out;
  }, [rooms, surfacesPx, artPiecesPx, opt]);

  /** What the canvas draws: every accent zone still standing, in plan pixels. */
  /** The same two-source rule for strips and sconces. See surfacesPx. */
  const accentZonesPx = useMemo(() => {
    const out = [];
    for (const r of rooms) {
      const res = accentResults[r.id];
      if (!res?.zones) continue;
      for (const z of res.zones) if (!accentDismissed.includes(z.id)) out.push(z);
    }
    // THE COVES. Derived, not placed — they exist because the ceiling is a cove,
    // so there is nothing to dismiss and nothing to drag. They go in here
    // rather than into `manualAccents` for exactly that reason: this list is
    // what the drawing and the schedule read, and `manualAccents` is a store of
    // things a person made.
    for (const r of rooms) out.push(...(r.coveStrips ?? []));
    // THE REVERSE COVES' TAPE, on the same terms and for the same reason. A
    // reverse cove is a slot with a strip in it, so it is billed by the metre
    // like every other run — shaped as an ordinary accent zone, so the canvas,
    // the schedule and the DXF take it without any of them knowing what a
    // reverse cove is. `run` and not `loop`: this one does not turn a corner.
    const litRooms = new Set(rooms.map((r) => r.id));
    for (const c of reverseCoves) {
      if (!litRooms.has(c.roomId)) continue;
      out.push({
        id: `rcove-strip-${c.id}`, type: 'strip', kind: 'reverse-cove', roomId: c.roomId,
        source: 'reverse-cove', label: 'Reverse cove',
        // WHICH CATALOGUE LINE. `type: 'strip'` is what makes the canvas, the
        // schedule and the DXF take this without any of them needing to know
        // what a reverse cove is; `fixture` is what they read when they DO need
        // to know — the tooltip's words, the schedule's line, the DXF's layer.
        fixture: 'reverse-cove',
        run: c.run, rect: c.rect, runLength: c.runLength,
        // WHAT THE DRAG NEEDS. `derived` says this run has no stored geometry to
        // edit — the ends write a trim instead — and the rest is what turns a
        // pointer position into one: which way the run lies, where the RULE put
        // its ends, and how far it may be stretched before it hits the door.
        derived: 'reverse-cove', trimId: c.id, horizontal: c.horizontal,
        base: c.base, seg: c.seg, bounds: c.bounds, trimmed: c.trimmed,
      });
    }
    /* --- THE SLOTS SOMEBODY DREW ACROSS A CEILING ---------------------------
       AN OPEN COVE IS A LENGTH OF TAPE AND NOTHING ELSE, which is why it arrives
       here rather than through the ceiling design like its closed cousin. A
       pocket run round an island cuts the grid in two and has a box, a ring and a
       chunk; a slot from wall to wall has none of those — it is a line on the
       slab with a strip in it — and shaping it as an ordinary accent run is what
       lets the canvas, the schedule and the lumen model take it without any of
       them learning a new kind of object. Same argument, third time: see the
       reverse coves above.

       `kind: 'cove'` PUTS IT IN THE COVE FAMILY, so it is billed as cove tape and
       counted against the cove's own distribution — four fifths at the ceiling.
       That is what it is: a concealed strip in a pocket, throwing up.

       `open: true` IS FOR THE DRAWING ALONE. Every other `loop` on this sheet is
       a closed circuit and is stroked with a Z; this one must not be, or an
       L-shaped run would carry a spurious leg back across the room. */
    for (const sh of ceilingShapes) {
      // A GUIDE BUYS NOTHING. Same rule the closed pipeline states one memo up:
      // an open guide is a line to measure from, not a slot to fill with tape.
      // A COVE AND NOTHING ELSE MAKES A RUN OF TAPE. Same swap, same reason as
      // the pocket filter above.
      if (!shapeIsBuilt(sh) || !shapeIsOpen(sh)) continue;
      const home = rooms.find((r) => pointInPolygon(
        { x: sh.x * pxPerFt, y: sh.y * pxPerFt }, r.geo.polygonPx));
      if (!home) continue;
      const pts = shapeOutlineFt(sh).map((q) => ({ x: q.x * pxPerFt, y: q.y * pxPerFt }));
      if (pts.length < 2) continue;
      const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
      out.push({
        id: `cove-line-${sh.id}`, type: 'strip', kind: 'cove', roomId: home.id,
        source: 'cove', label: 'Cove LED strip',
        // THE HANDLE THE DELETE BRANCH READS. A slot's tape is not an object in
        // its own right — the shape is — so Delete on the run removes the shape.
        shapeId: sh.id,
        loop: pts, open: true,
        runLength: runLengthFt(sh) * pxPerFt,
        rect: { x0: Math.min(...xs), y0: Math.min(...ys),
                x1: Math.max(...xs), y1: Math.max(...ys) },
      });
    }
    // ...and the shelves, on exactly the same terms. Three sources of strip on
    // this drawing now — a perimeter cove, a reverse cove and a run of shelving
    // — and all three are the same tape bought by the metre, which is why they
    // are all shaped as ordinary accent zones and none of them needs the canvas
    // or the schedule to know it exists.
    for (const st of shelfStrips) {
      if (!litRooms.has(st.roomId)) continue;
      out.push({
        id: `shelf-strip-${st.id}`, type: 'strip', kind: 'shelf', roomId: st.roomId,
        source: 'shelf', label: 'Shelf LED strip',
        run: st.run, rect: st.rect, runLength: st.runLength,
        derived: 'shelf', trimId: st.id, horizontal: st.horizontal,
        base: st.base, seg: st.seg, trimmed: st.trimmed,
      });
    }
    const live = new Set(rooms.map((r) => r.id));
    // THE DISMISSED FILTER APPLIES HERE TOO. Deleting a hand-placed fitting now
    // removes it outright, so nothing new lands in `accentDismissed` — but a
    // plan saved while that was broken has manual ids sitting in the list, and
    // those fittings should stay deleted rather than reappearing on reload.
    return [...out, ...manualAccents.filter(
      (m) => live.has(m.roomId) && !accentDismissed.includes(m.id))];
  }, [rooms, accentResults, accentDismissed, manualAccents, reverseCoves, shelfStrips,
      ceilingShapes, pxPerFt]);

  /**
   * What the canvas draws for the render pass: every placed wall feature, in
   * plan pixels.
   *
   * THE GRID IS RECOMPUTED HERE RATHER THAN STORED WITH THE RESULT, and that is
   * the same argument as `runFt` in computeAccents. A grid is a memo over the
   * room's polygon and the scale; store it on the answer and it starts lying the
   * moment somebody drags an outline corner or renames the door that sets the
   * scale — the cells would then be drawn against a grid the room no longer has.
   * Derived every render, it moves with the room, which is what anybody would
   * expect of a mark that says "there is panelling along this wall".
   */
  const wallCellsPx = useMemo(() => {
    const out = [];
    for (const r of rooms) {
      const res = wallResults[r.id];
      if (!res?.elements?.length || !r.plan?.ok) continue;
      const grid = gridFor(r.plan.polygonPx, pxPerFt);
      if (!grid) continue;
      for (const e of res.elements) {
        if (!e.cells?.length) continue;
        const rect = cellsToRect(e.cells, grid);
        if (!rect) continue;
        out.push({
          id: e.id || `${r.id}-${out.length}`, roomId: r.id, type: e.type,
          label: e.label || WALL_BY_ID[e.type]?.label || e.type,
          colour: e.colour || WALL_BY_ID[e.type]?.colour || '#666',
          rect, rects: cellsToPlanPx(e.cells, grid),
          // Which way the run lies, so the cell ticks are drawn ACROSS it
          // rather than along it. A run one cell long is called horizontal and
          // draws no ticks either way.
          horizontal: e.start && e.end ? e.start.y === e.end.y : true,
        });
      }
    }
    return out;
  }, [rooms, wallResults, pxPerFt]);

  /**
   * THE BOARDS THAT COST NOTHING, WITHOUT ASKING FOR THEM.
   *
   * TWO OF THE THREE RULES ARE FREE AND WERE BEING CHARGED FOR, and that was
   * the mistake this fixes. `planSwitchboards` has three, and they need three
   * different things:
   *
   *   the door      the door boxes, detected on arrival to set the scale, and
   *                 the room's own outline. Nothing else.
   *   the bedsides  the sconces the ACCENT pass placed — and that pass is part
   *                 of runPipeline, so by the time a space is lit they are
   *                 already in `accentZonesPx`.
   *   the TV        a `tv_unit` strip if the accent pass found one, and a fresh
   *                 vision call if it did not. THIS is the expensive one.
   *
   * So only the third needs asking for, and the whole thing sat behind the bolt
   * on the room row for its sake. Now the first two run here, for every space,
   * on every layout: the door plate 300mm past the LATCH jamb on the side the
   * door opens to — which `swingSides` settles by cutting the room on the line
   * through the door and measuring the floor either side of it — and one plate
   * at each bedside sconce, on the sconce's own wall.
   *
   * "AT" THE SCONCE IS "BELOW" IT, and the two words describe one place. A plan
   * is a view from above: a switch at 1200mm and the sconce at 1600mm on the
   * same wall are the same point on this drawing, and stacked in the room. So
   * the board is placed at the sconce's own point and needs no offset — an
   * offset would move it ALONG the wall, which is not below anything.
   *
   * A bay plate at the middle of the longest wall is not a cheaper version of
   * any of this. It is a different and worse answer, and having it stand in
   * silently while the real rules went unasked was the bug.
   *
   * IT WAS `derivedBoardsPx` AND IT USED TO BE THE POOR RELATION. There was an
   * on-demand pass beside it — a bolt per space, a vision call, its answer
   * stored — and this ran only for the rooms that pass had not been asked
   * about. The bolt is gone: what it bought over these rules was the television,
   * and the television is no longer looked for. So this is the pass, all three
   * rules, on every space, always.
   *
   * ALL THREE RULES ASKED FOR BY NAME. Every one of them reads something the app
   * has before there is a layout — the door boxes from the upload, the sconces
   * the accent pass placed, the bed box from the furniture detection — so there
   * is nothing here that costs a call and no reason to run a subset.
   */
  const boardResults = useMemo(() => {
    const out = {};
    if (!(pxPerFt > 0) || !rooms.length) return out;
    const all = rooms.map((q) => ({
      id: q.id, name: q.outline.name || null, polygonPx: q.plan.polygonPx,
    }));
    for (const r of rooms) {
      if (!r.plan?.ok) continue;
      /* --- A BALCONY GETS NO BOARD OF ITS OWN ---------------------------
         The rules below all place a plate ON the space they are given: beside
         its door, at its bedside, on the wall facing its bed. Run on a balcony
         they would put a switch outside — on an external wall, in the weather,
         reachable only by somebody who has already walked out there in the
         dark. The light is switched from indoors instead, off a plate in the
         room the balcony opens off; `outdoorFeeds` below works out which plate,
         and the flows carry the balcony's fittings to it.
         AN EMPTY RESULT AND NOT A SKIPPED KEY. Everything downstream reads
         `boardResults[id]` and a missing entry is "the pass has not run", which
         is a different statement from "this space has no boards" — the second
         is a decision, and it comes with a sentence saying so. */
      if (isOutdoor(projectId, roomTypes[r.id]?.type)) {
        out[r.id] = { boards: [], notes: [
          'This space is outside, so its light is switched from the room it'
          + ' opens off rather than from a plate on its own wall.'] };
        continue;
      }
      try {
        out[r.id] = planSwitchboards({
          room: { id: r.id, polygonPx: r.plan.polygonPx },
          rooms: all, doors, roomTypes, pxPerFt,
          accentZones: accentZonesPx.filter((a) => a.roomId === r.id),
          /* THE BED, OUT OF THIS ROOM'S OWN ZONE LIST. `plan.zonesPx` is what
             the planner was handed — every no-light zone standing in this space,
             the detected beds among them — so the bed is already attributed to
             the right room and there is no second containment test to get
             wrong. `bedZoneIn` takes the largest where a room has more than one,
             which is the same choice bedGrid.js makes for the flanking lights. */
          bedRect: bedZoneIn(r.plan.zonesPx ?? []),
          /* AND THE WARDROBES, WHICH NO PLATE MAY STAND ON. Raw rectangles: the
             six inches of clear plaster either side is the rules' number, not
             this file's, so it is applied in electrical.js where every caller
             gets the same one. See `keepOutsFor`.
             FROM `wardrobesPx` AND NOT FROM `r.plan.zonesPx`, even though the
             same rectangles are in there as no-light zones now. That list is
             what the CEILING keeps off — beds, hand-drawn boxes, reverse coves,
             wardrobes — and a switch has no reason to avoid a bed or a cove. A
             plate must keep off JOINERY, which is a different fact that happens
             to share some of its geometry, and the honest way to say it is to
             hand in the joinery. */
          keepOff: wardrobesPx.filter((w) => w.roomId === r.id).map((w) => w.rect),
          // WHERE SOMEBODY DRAGGED ONE OF THIS SPACE'S PLATES TO. Handed whole
          // rather than filtered by room: the keys are board ids and a board id
          // names its room, so a filter here would be a second place that has to
          // agree about that spelling.
          moves: boardMoves,
          /* BEDROOMS IN HOMES GET ALL THREE; EVERYTHING ELSE GETS THE DOOR.
             This gate used to decide whether a row in the panel had a BOLT on
             it, on the reasoning that two of the three rules are bedroom rules
             and a control that runs a pass with nothing to say is worse than no
             control. The bolt is gone and the reasoning is not: asked for on a
             kitchen, `bedside` and `facing` answer by reporting that there are
             no bedside sconces and no bed — both true, neither news, and printed
             under every space on the sheet. A rule that was never run has
             nothing to say, which is what `rules` is for. */
          rules: projectId === 'residential' && roomTypes[r.id]?.type === 'bedroom'
            ? ['door', 'bedside', 'facing']
            : ['door'],
        });
      } catch (err) {
        console.warn('[electrical] the rules failed for', r.id, err);
      }
    }
    return out;
  }, [rooms, doors, roomTypes, projectId, accentZonesPx, wardrobesPx, boardMoves, pxPerFt]);

  /**
   * This space's boards, minus the ones somebody threw away.
   *
   * `boardsOff` IS APPLIED HERE AND NOWHERE ELSE, which is what keeps one
   * answer to "is this plate on the drawing". The panel's count, the canvas, the
   * flows and the schedule all come through this function.
   */
  /**
   * WHERE THE BUILDING IS, as the registry's own record for it.
   *
   * UP HERE, AND NOT BESIDE THE COMPOSITION IT IS FOR. It belongs in the block
   * five hundred lines down where the plates are composed, and that is where it
   * was — until `boardMode` below started needing it. A `useCallback`'s BODY is
   * deferred but its DEPENDENCY ARRAY is evaluated the moment the line is
   * reached, so naming a `const` declared later reads it in its temporal dead
   * zone and throws during the first render. The error says "Cannot access
   * 'sbCountry' before initialization" and points at a line that looks fine,
   * because the offending read is in the array and not in the function.
   *
   * `country` IS A PROP, so this can be resolved as early as it likes and there
   * is nothing above it that could want it later.
   */
  const sbCountry = useMemo(() => countryFor(country), [country]);

  /**
   * IS THIS PLATE AN OUTLET OR A SWITCHBOARD, AND AT WHAT RATING.
   *
   * ONE ANSWER, ASKED IN ONE PLACE. The mode decides four things — what the
   * plate composes to, whether it produces an outlet flow, whether a ceiling may
   * fall back to it, and whether a dragged wire may be dropped on it — and four
   * readers each working it out from `boardKinds` is four chances to disagree
   * about what a plate with no entry is.
   *
   * THE DEFAULT IS WHERE IT CAME FROM. A plate somebody dropped on a wall starts
   * as an outlet, because that is what the tool places; everything a rule put
   * beside a door or a bed starts as a board, because that is what the rule
   * placed. `boardKinds` holds only the ones somebody changed.
   */
  const boardMode = useCallback((b) => {
    const o = boardKinds[b?.id] ?? {};
    return {
      outlet: o.outlet ?? !!b?.placed,
      amps: o.amps ?? lightSwitchA(sbCountry),
    };
  }, [boardKinds, sbCountry]);

  /**
   * ...AND THE PLATE WITH THAT ANSWER APPLIED.
   *
   * WRAPPED ROUND ALL THREE SOURCES OF BOARDS below rather than round their
   * readers, so nothing downstream has to remember to ask. A board reaching the
   * canvas, the flows, the pool or the card is already the thing it is.
   */
  const withMode = useCallback((list) => list.map((b) => {
    const m = boardMode(b);
    const done = m.outlet
      ? asOutlet(b, m.amps)
      : { ...b, socketOnly: false, amps: m.amps };
    /* AND THE HEIGHT, AFTER THE MODE AND NOT BEFORE. `asOutlet` sets its own
       default — 300, outlet height — so an override applied first would be
       overwritten by the conversion. Applied last it survives one, which is
       right: a person who typed 900 into a plate meant 900 whichever of the two
       things that plate is. */
    const h = boardHeights[b.id];
    if (!Number.isFinite(h)) return done;
    const base = done.heightsMm ?? heightsFor(done.role);
    return { ...done, heightsMm: [h, ...base.slice(1)], heightSet: true };
  }), [boardMode, boardHeights]);

  const boardsFor = useCallback((r) => withMode((boardResults[r.id]?.boards ?? [])
    .filter((b) => !b.rejected && b.point && !boardsOff.includes(b.id))
    // AS DRAWN, WHICH IS WHERE SOMEBODY PUT IT. Everything that paints a plate
    // or routes a wire to one comes through here; `ruleBoardsFor` is the other
    // half of this and is what decides.
    .map(asDrawn)),
  [boardResults, boardsOff, withMode]);

  /**
   * The same boards, at the positions the RULES chose.
   *
   * TWO READINGS OF ONE LIST, AND THIS IS THE POINT OF THE SPLIT. Dragging a
   * plate along the plaster is a decision about where the switch is reachable
   * from. It is not a decision about what it switches — and `planChunkBoards`
   * decides that geometrically: a bay adopts a board standing on one of its own
   * walls and makes itself a new one when none does. Feed it the dragged
   * position and moving the door plate across the room would take the switch
   * away from the ceiling it was switching and grow a second plate to replace
   * it, which is the opposite of what dragging one is for.
   *
   * So ownership is settled where the rules put things, and only the drawing and
   * the wire follow the hand. The ids are the same in both lists, which is what
   * lets `flowsPx` take the ownership map from one and the geometry from the
   * other.
   */
  const ruleBoardsFor = useCallback((r) => (boardResults[r.id]?.boards ?? [])
    .filter((b) => !b.rejected && b.point && !boardsOff.includes(b.id))
    /* AND NOT THE ONES SOMEBODY TURNED INTO SOCKETS. This list decides which bay
       is switched from which plate, and a socket outlet cannot switch a ceiling
       — it has no switch on it at all. Left in, converting the door's board to
       an outlet would leave the room's downlights owned by a plate with nothing
       to press, instead of falling through to the next board as they should. */
    .filter((b) => !boardMode(b).outlet),
  [boardResults, boardsOff, boardMode]);


  /**
   * THE BAYS OF ONE SPACE — the pieces of ceiling a board and a flow belong to.
   *
   * `designChunksPx` where there is one, because that is the piece somebody
   * chose a ceiling for, and the room's own bounding box where there is not.
   * The fallback is not a degenerate case: a space whose outline gives the
   * chunker nothing to work with is laid out as one grid over the whole floor,
   * and it is then genuinely one bay with one board and its rows.
   */
  const baysOf = useCallback((r) => {
    if (!r.plan?.ok) return [];
    if (r.designChunksPx?.length) {
      return r.designChunksPx.map((c) => ({ key: c.key, rect: c.rect }));
    }
    const b = bbox(r.plan.polygonPx);
    return [{ key: 'room', rect: { x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY } }];
  }, []);

  /**
   * THE BAY BOARDS — one per piece of ceiling that has none of its own.
   *
   * THE BAY IS THE DESIGN CHUNK, not the planner's. A cove design chunk comes
   * out of the planner as five rectangles — the inner and four bands — and five
   * plates on one wall is not a switchboard. It is one piece of ceiling somebody
   * chose a ceiling for, so it is one plate; the planner's chunks inside it are
   * what the ROWS come from. `designChunksPx` is empty whenever the design pass
   * declined and the plain layout ran, and then the space is one bay.
   *
   * IT IS HANDED THE DOOR BOARD, so the common case makes nothing at all: one
   * bay with a door in it adopts the plate beside that door. A new plate appears
   * only where a bay over 25 sqft genuinely has no board on any of its own
   * walls — the far half of a living-dining room, and not much else.
   */
  const bayResults = useMemo(() => {
    const out = {};
    if (!(pxPerFt > 0)) return out;
    for (const r of rooms) {
      if (!r.plan?.ok) continue;
      // AND NO BAY PLATES OUTSIDE, for the reason the rules pass skips it: a bay
      // plate is a switchboard on the drawing like any other, and this space's
      // switches are indoors. See `outdoorFeeds`.
      if (isOutdoor(projectId, roomTypes[r.id]?.type)) continue;
      const bays = baysOf(r);
      if (!bays.length) continue;
      out[r.id] = planChunkBoards({
        room: { id: r.id, polygonPx: r.plan.polygonPx },
        bays,
        // The same joinery the rules pass keeps off, for the same reason: a bay
        // plate is a switchboard on the drawing like any other.
        keepOff: wardrobesPx.filter((w) => w.roomId === r.id).map((w) => w.rect),
        // `ruleBoardsFor` AND NOT `boardsFor`, WHICH IS THE WHOLE OF "the
        // routing stays as it is". This pass decides which bay is switched from
        // which plate, and it decides it by which plate stands on the bay's own
        // walls — so a plate dragged across the room would take the switch off
        // the ceiling it was switching and this pass would grow a replacement.
        // Ownership is settled where the RULES put the boards; the drag moves
        // the mark and the wire, and nothing else. See the note on that function.
        boards: ruleBoardsFor(r),
        // ...and this pass's OWN plates answer to the same drag. See `moves`
        // there: it applies them to what it makes, after ownership is settled.
        moves: boardMoves,
        pxPerFt,
      });
    }
    return out;
  }, [rooms, pxPerFt, baysOf, ruleBoardsFor, wardrobesPx, boardMoves, projectId, roomTypes]);

  /**
   * The bay plates of one space, as drawn.
   *
   * THE SAME TWO FILTERS THE RULE BOARDS GET, and they were missing. A bay plate
   * is a switchboard on the drawing — same rectangle, same blue, same hover card
   * — so it is selectable and grabbable like any other, and a delete or a drag
   * that quietly did nothing to one would be an affordance that lies. `boardsOff`
   * and `asDrawn` belong to "a plate on this sheet", not to "a plate a rule
   * placed".
   *
   * ONE FUNCTION BECAUSE THERE ARE TWO READERS. The canvas and the flows both
   * want these, and two copies of the filter is two chances to disagree about
   * whether a deleted bay plate is still on the drawing.
   */
  const bayBoardsFor = useCallback((r) => withMode((bayResults[r.id]?.boards ?? [])
    .filter((b) => !b.rejected && b.point && !boardsOff.includes(b.id))
    .map(asDrawn)),
  [bayResults, boardsOff, withMode]);

  /**
   * ...AND THE PLATES SOMEBODY PUT ON THIS SPACE'S WALLS THEMSELVES.
   *
   * THE THIRD SOURCE OF BOARDS, and it goes through a function of its own for
   * the reason the other two do: every reader of the drawing — the canvas, the
   * flows, the assignable pool, the switchboard card — has to get the same
   * answer to "is this plate there", and three filters written three times is
   * three chances to disagree.
   *
   * NO `asDrawn` AND NO `boardMoves`. A rule's board has two positions — where
   * the rule put it and where somebody dragged it — and `asDrawn` picks between
   * them. A hand-placed board has one: `sFt` IS the hand position, so dragging
   * one writes straight back to `manualBoards` and there is nothing to reconcile.
   * See `boardPointerMove`.
   */
  const placedBoardsFor = useCallback((r) => withMode(placedBoards(
    manualBoards.filter((m) => m.roomId === r.id && !boardsOff.includes(m.id)),
    { polygonPx: r.plan?.polygonPx ?? [], pxPerFt })),
  [manualBoards, boardsOff, pxPerFt, withMode]);

  /**
   * WHICH PLATE SWITCHES EACH OUTDOOR SPACE: balconyId -> the board, and the
   * room it stands in.
   *
   * THE RULE IN THREE STEPS, AND THE THIRD IS THE ONE THAT KEEPS IT HONEST.
   * `innerSpaceFor` says which room the balcony's LONG side is connected to —
   * see the note there for why the long side and not the nearest room.
   * `nearestBoardTo` then picks that room's plate nearest the balcony's own
   * boundary. And because it picks from `boardsFor` + `bayBoardsFor` — the
   * boards AS DRAWN, deletions applied — a plate added to the inner room later
   * takes the balcony over automatically if it lands nearer: the answer is
   * derived from what is on the sheet, not stored when the balcony was lit.
   * That is the second half of what was asked for ("if another switchboard is
   * placed in the inner space which is closest to the balcony, then the
   * connection is from that switchboard") and it needs no code of its own.
   *
   * A SPACE WITH NOWHERE TO FEED FROM FALLS BACK TO ITSELF. A detached terrace,
   * or a balcony whose inner room was never lit, has no plate to point at — so
   * `boardResults` has already given it none and this gives it none either, and
   * its flows come out with no board, which the drawing shows as fittings with
   * no loop rather than as a wire to nowhere.
   */
  const outdoorFeeds = useMemo(() => {
    const out = {};
    if (!(pxPerFt > 0) || !rooms.length) return out;
    const all = rooms.filter((r) => r.plan?.ok)
      .map((r) => ({ id: r.id, polygonPx: r.plan.polygonPx }));
    for (const r of rooms) {
      if (!r.plan?.ok) continue;
      if (!isOutdoor(projectId, roomTypes[r.id]?.type)) continue;
      const inner = innerSpaceFor({
        room: { id: r.id, polygonPx: r.plan.polygonPx }, rooms: all, pxPerFt });
      if (!inner) continue;
      const host = rooms.find((q) => q.id === inner.roomId);
      if (!host) continue;
      /* NEAREST, WHATEVER ITS ROLE — AND THAT IS A DELIBERATE EXCEPTION TO
         `servesBay`, WHICH IS WHY IT IS WRITTEN OUT.
         This filtered to the general plates first, on the reasoning `servesBay`
         gives inside a room: a bedside plate exists to switch its own sconce
         and a television plate its own socket, so a ROOM's ceiling must never
         be hung off either — otherwise the downlights come on from a plate at
         the pillow while the board beside the door feeds nothing.
         A BALCONY IS NOT A PIECE OF THAT ROOM'S CEILING. It is one light on the
         other side of a wall, and the question it asks is the plain one: which
         switch is nearest to reach. In a bedroom the answer is very often the
         bedside plate — a multi-gang plate at the pillow carrying the room's
         masters is exactly where somebody wants the balcony on it — and the
         general-plates rule sent the wire the length of the room to a board on
         the far wall instead. So the role test comes off for this one join.
         The room's own ceiling still obeys `servesBay`; nothing about that
         changed, and nothing here can change it. */
      // AND NOT A SOCKET OUTLET. A balcony's fittings are switched from indoors,
      // and a plate with no switch on it cannot switch them.
      const boards = [...boardsFor(host), ...bayBoardsFor(host)]
        .filter((b) => !b.socketOnly);
      const board = nearestBoardTo(boards, r.plan.polygonPx);
      if (!board) continue;
      out[r.id] = { board, roomId: host.id, roomName: host.outline.name || null };
    }
    return out;
  }, [rooms, roomTypes, projectId, pxPerFt, boardsFor, bayBoardsFor]);


  /**
   * EVERY FLOW ON THE SHEET. See flows.js for what a flow is and why the row is
   * the unit; this only gathers what one space's worth of it needs.
   *
   * NOT GATED ON THE LAYER. It is cheap, it feeds the schedule's switch count as
   * well as the drawing, and a memo that only runs while something is visible is
   * a memo that recomputes the moment somebody looks at it.
   */
  /**
   * EVERY PLATE ON THE SHEET, whatever room it stands in and whatever the
   * layers say.
   *
   * NOT `switchboardsPx`, WHICH IS THE DRAWING'S LIST. That one drops the bay
   * boards while the electrical layer is off, correctly — a plate that exists
   * because a bay needed one is part of the flow reading and has no business on
   * a sheet with the wiring switched off. This list is not for drawing: it is
   * the pool a HAND ASSIGNMENT may name (see `boardPool` in flows.js), and a
   * wire dropped onto a plate last week must not come unstuck because somebody
   * turned a layer off today.
   */
  /**
   * SB1, SB2, SB3 — every plate on the job, numbered.
   *
   * ONE SEQUENCE OVER THE WHOLE PLAN AND NOT ONE PER ROOM, because that is what
   * a switchboard number IS on a drawing: SB7 is a plate you can point at across
   * a sheet, and "the third one in the kitchen" is not a name.
   *
   * DERIVED, LIKE THE PLATES THEMSELVES, and therefore ORDER IS EVERYTHING. The
   * numbering has to be stable under things that do not add or remove a plate,
   * or the names would shuffle while somebody worked:
   *
   *   · rooms in the order the layout holds them, which is the order everything
   *     else on this sheet is in;
   *   · within a room, the rules' boards, then the bay boards, then the ones
   *     placed by hand — the order the three passes run in;
   *   · UNGATED BY LAYERS, which is the trap this avoids. `switchboardsPx` drops
   *     the bay boards while the electrical layer is off; numbering off that
   *     list would renumber half the plan when somebody flicked a switch.
   *
   * WHAT DOES RENUMBER IS ADDING OR DELETING A PLATE, and that is unavoidable in
   * any sequential scheme — it is also how SB numbers behave on a real job, where
   * the schedule is renumbered when the drawing changes.
   */
  const boardNames = useMemo(() => {
    const m = new Map();
    let n = 0;
    for (const r of rooms) {
      for (const b of [...boardsFor(r), ...bayBoardsFor(r), ...placedBoardsFor(r)]) {
        if (!m.has(b.id)) m.set(b.id, `SB${++n}`);
      }
    }
    return m;
  }, [rooms, boardsFor, bayBoardsFor, placedBoardsFor]);

  /** The height a plate is actually set at, override or rule. */
  const heightOf = useCallback(
    (b) => b?.heightsMm?.[0] ?? heightsFor(b?.role)[0] ?? 1200, []);

  const setBoardHeight = useCallback((id, mm) => {
    setBoardHeights((m) => ({ ...m, [id]: mm }));
  }, []);

  const allBoardsPx = useMemo(() => {
    const out = [];
    for (const r of rooms) {
      out.push(...boardsFor(r), ...bayBoardsFor(r), ...placedBoardsFor(r));
    }
    /* EVERY PLATE, SOCKET OUTLETS INCLUDED. This list is what a dragged wire may
       be dropped ON, and dropping one on an outlet is a perfectly clear thing to
       mean: it says this appliance is switched from that plate. An outlet cannot
       switch anything — it has no switch on it — so what the drop does is
       CONVERT it, in the same gesture, exactly as adding a point does. See
       `flowPointerUp`.
       IT USED TO BE FILTERED HERE, which made an outlet inert to a drag: the
       ring never lit, the release did nothing, and nothing said why. Refusing a
       gesture whose meaning is obvious is worse than acting on it. */
    return out;
  }, [rooms, boardsFor, bayBoardsFor, placedBoardsFor]);

  const flowsPx = useMemo(() => {
    const out = [];
    if (!(pxPerFt > 0)) return out;
    for (const r of rooms) {
      if (!r.plan?.ok) continue;
      // BOTH KINDS OF PLATE, EACH AS DRAWN. `owner` below comes from the same
      // pass at its RULE positions, and the ids match across the two — which is
      // what lets the wire follow a dragged plate while the switching does not.
      /* AN OUTDOOR SPACE IS HANDED THE PLATE THAT SWITCHES IT, which stands in
         another room. `boardsFor(r)` is empty for one — the rules pass was
         skipped, see `boardResults` — so without this its fittings would come
         out with no board and no loop at all. With it, every flow on the
         balcony falls back to the one board on offer (there is no `owner` map
         to override it, because a balcony has no bays of its own) and the wire
         runs from the fittings, through the wall, to a plate somebody can reach
         from indoors.
         THE WIRE CROSSING THE WALL IS THE POINT AND NOT A GLITCH: that is what
         the circuit does, and a drawing that stopped the loop at the threshold
         would be hiding the only unusual thing about it. */
      const feed = outdoorFeeds[r.id];
      /* THE RULES' OWN FALLBACK LIST, MINUS ANY PLATE THAT IS NOW A SOCKET.
         `boardFor` in flows.js falls back to "the nearest plate that can carry a
         ceiling", and a converted board cannot: it has no switch on it. Leaving
         it in would give a row of downlights a board with nothing to press. */
      const boards = (feed ? [feed.board] : [...boardsFor(r), ...bayBoardsFor(r)])
        .filter((b) => !b.socketOnly);
      const bays = baysOf(r);
      /* EVERY BAY OUT HERE IS SWITCHED FROM THAT ONE PLATE, said as ownership
         rather than left to the fallback. `boardFor` falls back to the nearest
         board that `servesBay` — which excludes a bedside and a television
         plate, correctly, because neither can carry a ceiling. If the inner
         room's nearest plate happens to be one of those, the fallback would
         find nothing and the balcony would come out with no loops at all.
         Naming the owner says what has actually been decided: this ceiling runs
         off that plate, whatever kind of plate it turned out to be. */
      const owner = feed
        ? new Map(bays.map((b) => [b.key, feed.board.id]))
        : (bayResults[r.id]?.owner ?? new Map());
      const { flows } = planFlows({
        room: { id: r.id, polygonPx: r.plan.polygonPx },
        bays,
        chunks: r.plan.chunksPx ?? [],
        cells: r.plan.cellsPx ?? [],
        lights: r.plan.lightsPx ?? [],
        objects: obstaclesPx.filter((f) => pointInPolygon({ x: f.x, y: f.y }, r.plan.polygonPx)),
        accents: accentZonesPx.filter((a) => a.roomId === r.id),
        spots: taskSpotsPx.filter((sp) => sp.roomId === r.id),
        tracks: r.plan.tracksPx ?? [],
        boards,
        /* THE SOCKET OUTLETS ON THIS SPACE'S WALLS, each of which becomes one
           flow back to the nearest plate that can switch it — see section 0 of
           flows.js. They are handed in as FITTINGS and not as boards, which is
           what they are: a socket is a thing on a wall that needs switching, and
           the plate it is switched from grows a module for it.

           FROM ALL THREE SOURCES AND NOT ONLY THE HAND-PLACED ONES, because the
           conversion is offered on every plate. A board beside a door that
           somebody turned into an outlet is a socket outlet in every respect,
           and it has to produce its wire like any other or it would be a socket
           with no switch anywhere — the one thing this app does not allow. */
        outlets: [...boardsFor(r), ...bayBoardsFor(r), ...placedBoardsFor(r)]
          .filter((b) => b.socketOnly)
          .map((b) => ({ id: b.id, x: b.point.x, y: b.point.y, amps: b.amps })),
        /* AND THE POOL A DRAGGED WIRE MAY NAME, which is every plate on the
           drawing. `boards` above stays this room's own — the rules' fallback
           is "the nearest plate" and must not reach across a party wall — while
           an assignment is somebody having said outright which plate they mean.
           See the note on `boardPool` in flows.js. */
        /* THE POOL EXCLUDES OUTLETS EVEN THOUGH THE DROP TARGETS DO NOT, and
           the two lists differ for one reason: this one is the INVARIANT.
           Nothing may ever be switched from a plate that has no switch on it, so
           an assignment naming an outlet resolves to nothing and falls back to
           the rules. The canvas converts the plate on the drop, so by the next
           render there is no outlet to resolve — and if that ever failed to
           happen, the wire would sit on a real board rather than on a socket. */
        boardPool: allBoardsPx.filter((b) => !b.socketOnly),
        owner,
        assign: flowBoards,
        bends: flowBends,
        zones: r.plan.zonesPx ?? [],
        pxPerFt,
      });
      out.push(...flows);
    }
    return out;
  }, [rooms, boardsFor, bayBoardsFor, bayResults, obstaclesPx, accentZonesPx, taskSpotsPx,
      outdoorFeeds, pxPerFt, baysOf, allBoardsPx, placedBoardsFor, flowBoards, flowBends]);


  /* EVERY SWITCHBOARD STILL STANDING, in plan pixels.

     IT SITS BELOW `flowsPx` AND NO LONGER HAS TO. It was moved down here when it
     briefly read the flows — to colour a plate red when nothing was switched
     from it — and a `useMemo` body runs the moment it is reached during render,
     so above `flowsPx` it would have read a `const` in its temporal dead zone
     and thrown on the first paint. That reading is gone with the red (see
     below); the position is kept because moving it back buys nothing and
     nothing reads the boards between the two.

     THE ROOM'S OWN BOARDS ALWAYS. Refused ones are kept in `boardResults` — the
     panel wants to say a board was refused and why — but they carry no geometry,
     so `boardsFor` drops them on the way to the drawing rather than letting the
     canvas draw a plate at NaN. It drops the ones somebody deleted in the same
     place, which is why every reader of the drawing goes through it.

     THE BAY BOARDS ONLY WHILE THE LAYER IS ON. A plate that exists because a bay
     needed one is part of the flow reading — it is what those loops run back to
     — and on a sheet with the loops switched off it is a blue rectangle nobody
     asked for. The board beside the DOOR is not like that: it is the answer to
     "where is the switch in this room", which is a question about the room and
     not about the wiring, so it stays on the drawing either way. */
  const switchboardsPx = useMemo(() => {
    const out = [];
    for (const r of rooms) {
      out.push(...boardsFor(r));
      /* A HAND-PLACED PLATE IS ON THE DRAWING WHATEVER THE LAYER SAYS, like the
         board beside the door and unlike a bay plate. A bay board exists because
         a piece of ceiling needed switching and is part of the flow reading; one
         somebody dropped on a wall is a decision they made about this building,
         and hiding it with the wiring would mean a gesture whose result vanishes
         when a switch is flicked. */
      out.push(...placedBoardsFor(r));
      // `!doorEdit` FOR THE SAME REASON `canvasLayers` DROPS THE LOOPS while
      // the doors are being confirmed: a bay board is part of the flow reading,
      // and the flows are what the boxes being edited will move. Half the
      // reading left on screen under the question is worse than none of it.
      if (layers.electrical && !doorEdit) out.push(...bayBoardsFor(r));
    }
    /* `loose` WAS COMPUTED HERE — which plates had nothing on them, so the
       canvas could draw those red. It is gone with the state it marked: a plate
       somebody drops on a wall is a SOCKET OUTLET and wires itself the moment it
       exists, so there is no unconfigured second to colour. See the note where
       SB_LOOSE used to be in electrical.js. */
    /* AND ITS NAME, STAMPED ON THE WAY OUT. Every reader of the drawing goes
       through this list — the canvas, its hover card, the panel — so the name is
       attached once here rather than each of them being handed the map and
       remembering to ask. */
    return markClashes(out.map((b) => ({ ...b, name: boardNames.get(b.id) ?? null })),
      pxPerFt);
  }, [rooms, boardsFor, bayBoardsFor, placedBoardsFor, boardNames,
      layers.electrical, doorEdit, pxPerFt]);

  /* --- WHAT IS ON THE PLATE -------------------------------------------------

     `sbCountry` IS DECLARED WELL ABOVE THIS, beside `boardMode` — see the note
     there. It used to be the first thing in this block, which is where it reads
     best and is no longer where it can go.

     THE PLATE SOMEBODY SELECTED, AND ONLY THAT ONE. Composing every board on the
     sheet would be a parts list for a drawing nobody is looking at; the card
     exists because a person clicked a rectangle and wants to know what is behind
     it, and that is one plate at a time.

     THE FLOWS ARE HANDED IN WHOLE and the composition filters them by board id.
     That is deliberate rather than lazy: a flow can name a SECOND plate as well
     as its own (two-way switching — see `also` in flows.js), so "the flows on
     this board" is not a partition of the list and cannot be pre-grouped
     without deciding, here, a question switchboards.js already answers. */
  /**
   * THE PLATE THE PANEL IS SHOWING — the one somebody picked, or failing that
   * the one the picked WIRE runs to.
   *
   * THE FALLBACK IS THE WHOLE OF "CLICK A WIRE, SEE ITS SWITCH". Selecting a
   * wire clears the board selection (one selection on this canvas), so without
   * this the card would close at the exact moment there was something in it
   * worth looking at — and the module that ought to light up would not be on
   * screen to light. Falling back to the wire's own board means clicking any
   * loop on the drawing opens the plate it is switched from, with its module
   * filled in.
   *
   * AND PICKING A MODULE KEEPS `selBoardId`, which is why the explicit
   * selection comes first rather than the two being merged. A two-way point on
   * plate X belongs to a flow whose board is plate Y; pressing it must not throw
   * you over to Y's card, because X is the plate you are reading.
   */
  const selBoard = useMemo(() => {
    const byFlow = selFlowId
      ? flowsPx.find((f) => f.id === selFlowId)?.boardId ?? null
      : null;
    const want = selBoardId ?? byFlow;
    return want ? switchboardsPx.find((b) => b.id === want) ?? null : null;
  }, [switchboardsPx, selBoardId, selFlowId, flowsPx]);

  /**
   * PICK A WIRE FROM ITS MODULE — the other direction of the same selection.
   *
   * IT DOES NOT CLEAR `selBoardId`, and that is the one thing separating it from
   * `flowPointerDown`. Pressing a module is a gesture made INSIDE the card, so
   * closing the card would take away the surface the gesture was made on; a
   * press on the drawing has no such problem and clears everything, as every
   * other selection there does.
   *
   * PRESSING THE LIT ONE AGAIN LETS GO. A module is the only place in this app
   * where the selected thing and the control for it are the same object, so
   * without a toggle there would be no way to put a wire down again without
   * finding somewhere empty to click.
   */
  const pickFlow = useCallback((id) => {
    setSel((cur) => (idOf(cur, 'flow') === id ? clear() : select('flow', id)));
  }, []);

  /* The points somebody added to THIS plate. Its own memo because it is a
     dependency of the composition, and `boardPoints[id]` computed inline would
     be a fresh array reference on every render of a component that re-renders
     on every pointermove. */
  const selBoardExtras = useMemo(
    () => (selBoardId ? boardPoints[selBoardId] ?? [] : []),
    [boardPoints, selBoardId]);

  const selBoardParts = useMemo(() => {
    if (!selBoard) return null;
    /* AN OUTLET IS COMPOSED BY A DIFFERENT FUNCTION, and the split is in
       switchboards.js rather than a flag here — see `composeOutlet`. Every path
       through `composeSwitchboard` puts a switch beside a socket, because that
       is the rule it exists to hold; the one plate that may break the rule must
       not be built by the function that enforces it.
       WHICH BOARD SWITCHES IT is read off the outlet's own flow, so the card can
       say where its switch went. That is the whole of what a person needs to
       know about an outlet, and it is the thing that changes when they drag its
       wire somewhere else. */
    if (selBoard.socketOnly) {
      const mine = flowsPx.find((f) => f.outletId === selBoard.id);
      return composeOutlet({
        country: sbCountry, amps: selBoard.amps,
        switchedFrom: mine?.boardLabel ?? null,
        // ...AND THE WIRE IT IS ON, so the socket lights with everything else on
        // that flow. Its switch is on another plate; this is the same point.
        flowId: mine?.id ?? null,
      });
    }
    /* `spareAmps` IS WHAT SURVIVES A CONVERSION. Every board carries one socket
       of its own and the switch for it — the "spare pair" — and on a plate that
       was an outlet a moment ago, that socket IS the one that was on the wall,
       at the rating it was on the wall at. Composing it at the default would
       silently re-rate somebody's air-conditioner point on the way through a
       change that was about where the switch lives. */
    return composeSwitchboard({
      country: sbCountry, flows: flowsPx, boardId: selBoard.id,
      extras: selBoardExtras, spareAmps: selBoard.amps ?? null,
      order: boardOrders[selBoard.id] ?? [],
    });
  }, [selBoard, sbCountry, flowsPx, selBoardExtras, boardOrders]);

  /**
   * MOVE A PAIR ALONG THE PLATE.
   *
   * REWRITTEN FROM THE CURRENT ARRANGEMENT AND NOT PATCHED INTO THE STORED ONE.
   * The stored order may be empty (nobody has moved anything yet) or stale (it
   * predates a fitting being added), and in both cases the list a person is
   * actually looking at is `units` — so the move is applied to THAT and the
   * result stored whole. A stored order that only ever gets appended to drifts
   * from what is on screen the first time the rules add something.
   */
  const reorderBoardUnit = useCallback((key, toIndex) => {
    const id = selBoard?.id;
    const units = selBoardParts?.units;
    if (!id || !units) return;
    const keys = units.map((u) => u.key);
    const from = keys.indexOf(key);
    if (from < 0) return;
    const next = keys.filter((k) => k !== key);
    // THE TARGET IS AN INDEX IN THE LIST WITH THE UNIT STILL IN IT, which is
    // what the drawing measured — so dropping to the right of where it started
    // has to lose the slot it vacated, or a unit dragged one place right would
    // land back where it was.
    next.splice(Math.max(0, Math.min(next.length, toIndex > from ? toIndex - 1 : toIndex)),
      0, key);
    setBoardOrders((m) => ({ ...m, [id]: next }));
    /* AND THE THING JUST MOVED IS WHAT IS SELECTED, where it is on a wire. The
       card lights the dropped unit by its own key — see `movedKey` there, which
       is what a unit with no flow needs — and this is the other half of it: the
       wire goes green on the drawing at the same moment, so the two views do not
       disagree about what was just touched. */
    const flowId = units[from]?.flowId ?? null;
    if (flowId) setSel(select('flow', flowId));
  }, [selBoard, selBoardParts]);

  /**
   * A PLATE IS A SOCKET OUTLET, OR IT IS A SWITCHBOARD.
   *
   * TWO ONE-WAY ACTIONS AND NOT A TOGGLE, and that is a UI decision the panel
   * makes rather than one this function knows about: going TO an outlet is a
   * press of "Single socket outlet", and coming BACK is a consequence of adding
   * any point to one. The two directions are not symmetrical, and the checkbox
   * that used to pretend they were is what people found confusing about it.
   *
   * NOTHING IS MOVED, ADDED OR DELETED HERE, and that is the whole reason this
   * is three lines. It writes one flag; everything the change is FOR then
   * happens because the derivation reads that flag:
   *
   *   · the plate composes as one socket instead of a board full of switches
   *   · it produces an outlet flow — so a wire appears, running to the nearest
   *     board, and THAT board grows a switch for it
   *   · `servesBay` is false for a socket, so anything that used to be switched
   *     from it falls back to the next plate by itself
   *   · it drops out of the pool a dragged wire may be dropped on
   *
   * Set it the other way and all four reverse, in the same way and for the same
   * reason: the flow stops being produced, so the wire and the far board's
   * switch simply are not there any more. Nothing had to go and remove them.
   *
   * BACK TO NOTHING RATHER THAN TO A VALUE, when the flag matches what the plate
   * was born as. Same rule `resetBoard` follows: an entry that only restates the
   * default is a plate marked "changed by hand" for ever, and one that would
   * stop following its own default if that default ever moved.
   */
  const setBoardOutlet = useCallback((b, outlet) => {
    if (!b) return;
    // WHAT IT WAS BORN AS, off the plate itself: hand-placed plates are outlets
    // and everything a rule put on a wall is a board. `placed` survives the
    // outlet transform (see `asOutlet`), so it is readable in either state.
    const born = !!b.placed;
    setBoardKinds((m) => {
      const cur = m[b.id] ?? {};
      if (outlet === born && cur.amps == null) {
        if (!(b.id in m)) return m;
        const out = { ...m }; delete out[b.id]; return out;
      }
      return { ...m, [b.id]: { ...cur, outlet } };
    });
  }, []);

  /** Re-rate the selected plate's socket. Its switch follows, wherever it is. */
  const setBoardAmps = useCallback((id, amps) => {
    setBoardKinds((m) => ({ ...m, [id]: { ...(m[id] ?? {}), amps } }));
  }, []);

  /**
   * EVERY PLATE ON THE JOB, GROUPED BY SPACE AND ORDERED BY SIZE — the sheet.
   *
   * TWO ORDERINGS, EACH ANSWERING A DIFFERENT QUESTION. By space, because a
   * switchboard belongs to a room in a way a light does not: it is on that
   * room's wall, it switches that room's ceiling, and an electrician wires a
   * room at a time. Then by MODULE COUNT ascending within the space — not by
   * name, which would be the obvious thing and is the wrong one, because SB1..n
   * is an ordering by when a plate came into existence and that is an accident
   * of how somebody worked. Size is a fact about the part.
   *
   * COMPOSED HERE AND NOT IN THE SHEET, for the reason BOQView is handed a built
   * schedule: one place works out what is on a plate, and the view is markup.
   * It is the same pair of functions the panel's card uses, so the two cannot
   * come to disagree about what SB7 is.
   *
   * EVERY PLATE INCLUDING THE BAY BOARDS, whatever the layer says. The layer is
   * about what is drawn ON THE PLAN; this is a schedule, and a schedule that
   * omitted half the plates because a switch was off would be a schedule nobody
   * could order from.
   */
  const boardSheet = useMemo(() => {
    const groups = [];
    for (const r of rooms) {
      const plates = [...boardsFor(r), ...bayBoardsFor(r), ...placedBoardsFor(r)]
        .map((b) => {
          const composition = b.socketOnly
            ? composeOutlet({
              country: sbCountry, amps: b.amps,
              switchedFrom: flowsPx.find((f) => f.outletId === b.id)?.boardLabel ?? null,
            })
            : composeSwitchboard({
              country: sbCountry, flows: flowsPx, boardId: b.id,
              extras: boardPoints[b.id] ?? [], spareAmps: b.amps ?? null,
              order: boardOrders[b.id] ?? [],
            });
          return {
            id: b.id,
            name: boardNames.get(b.id) ?? '—',
            heightMm: heightOf(b),
            modules: composition.total,
            composition,
          };
        })
        // ASCENDING BY SIZE, and by NAME where two plates are the same size —
        // otherwise two equal boards would sit in whatever order the passes
        // happened to emit them, which is an order that can change.
        .sort((a, b) => a.modules - b.modules
          || a.name.localeCompare(b.name, undefined, { numeric: true }));
      if (plates.length) {
        groups.push({ roomId: r.id, name: r.outline.name || 'Space', plates });
      }
    }
    return groups;
  }, [rooms, boardsFor, bayBoardsFor, placedBoardsFor, boardNames, heightOf,
      sbCountry, flowsPx, boardPoints, boardOrders]);

  /** A point added by hand, onto the selected plate. See `boardPoints`. */
  const addBoardPoint = useCallback((p) => {
    if (!selBoardId) return;
    /* ADDING A POINT TO A SOCKET OUTLET IS HOW ONE STOPS BEING ONE, and that is
       the whole of the conversion now — there is no checkbox.

       AN OUTLET IS "ONE SOCKET AND NOTHING ELSE". That is not a setting that
       happens to be true of it, it is the definition — so pressing "+ 16A
       switch" on one is not a request that needs reconciling with a mode flag,
       it is a statement that this plate is not an outlet any more. A checkbox
       beside these buttons would have been a second way to say the same thing,
       and two controls for one fact disagree the first time somebody uses the
       one you did not expect.
       THE FLIP AND THE POINT LAND TOGETHER, in one gesture, so the plate a
       person is looking at is the plate they asked for. */
    if (selBoard?.socketOnly) setBoardOutlet(selBoard, false);
    /* AN ID PER PRESS, AND NOT A KEY MADE OF THE POINT. Two 16A sockets on one
       plate is an ordinary thing to want, and they have to be removable one at
       a time — which `socket:16` used as a key cannot express. */
    const id = `bp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    setBoardPoints((m) => ({
      ...m,
      [selBoardId]: [...(m[selBoardId] ?? []),
        { id, kind: p.kind, amps: p.amps ?? null, label: p.label }],
    }));
  }, [selBoardId, selBoard, setBoardOutlet]);

  const removeBoardPoint = useCallback((pid) => {
    if (!selBoardId) return;
    setBoardPoints((m) => ({
      ...m, [selBoardId]: (m[selBoardId] ?? []).filter((e) => e.id !== pid),
    }));
  }, [selBoardId]);

  /**
   * The layout, in the one number a lighting drawing is actually judged on.
   *
   * Counting fittings says nothing on its own — twelve lights in a 400 sqft hall
   * and twelve in a 90 sqft bedroom are different jobs. Lumens per square foot
   * is the figure that travels: 15-20 reads as comfortable ambient light for a
   * living space, 25+ as bright. Summed over the plan and not averaged over the
   * rooms, because a plan's brightness is its light over its area, and averaging
   * the ratio would let a bright cupboard flatter a dim hall.
   */
  const totals = useMemo(() => {
    const done = rooms.filter((r) => r.plan?.ok);
    // PER FITTING, THROUGH THE CATALOGUE — not two counts times two constants.
    // The counts were `stats.small` and `stats.large`, which are GEOMETRY, and
    // the moment a room could contain a 5 W narrow lamp in a toilet or in the
    // band outside a cove they stopped matching what is actually specified. The
    // BOQ's own catalogue is the single place a fitting's output lives, so the
    // headline figure and the schedule cannot drift apart.
    const lumensOfLight = (l) =>
      FIXTURE_BY_ID[l.fixture]?.lumens
      ?? (l.kind === 'large' ? FITTING_LUMENS.large : FITTING_LUMENS.small);
    const gridLumens = done.reduce(
      (t, r) => t + r.plan.lights.reduce((u, l) => u + lumensOfLight(l), 0), 0);
    // AND THE COVES, which are the reason this had to change: a cove can be the
    // only ambient source in a space, and a lm/sqft figure that ignored it
    // would report a coved living room as unlit.
    const coveLumens = done.reduce((t, r) => t
      + (r.coves ?? []).reduce((u, c) => u + c.coveLumens, 0), 0);
    const lumens = gridLumens + coveLumens;
    const areaSqft = done.reduce((s, r) => s + r.plan.stats.areaSqft, 0);
    return {
      rooms: done.length,
      failed: rooms.length - done.length,
      lights: done.reduce((s, r) => s + r.plan.lights.length, 0),
      coves: done.reduce((t, r) => t + (r.coves?.length ?? 0), 0),
      areaSqft, lumens, gridLumens, coveLumens,
      perSqft: lumens / Math.max(1, areaSqft),
    };
  }, [rooms]);

  /**
   * THE SCHEDULE, derived like everything else here.
   *
   * A BOQ held in state would be a second copy of the drawing that drifts the
   * moment a light moves — and lights move constantly: a fan is dropped, a
   * chunking is re-picked, a strip is dragged. So it is a memo over the same
   * sources the canvas draws from, which makes "the schedule matches the
   * drawing" a property of the code rather than something to remember.
   */
  /**
   * THE AIMED SPOTS THAT ACTUALLY LANDED, for the Result panel's count.
   *
   * `taskSpotsPx` carries an entry for every surface the placer was ASKED about,
   * including the ones it turned down — those hold a `rejected` or `skipped`
   * reason and no coordinates, so the panel can say why a dining table has no
   * spot over it. They are not fittings and must not be counted as any.
   */
  const spotsPlaced = useMemo(
    () => taskSpotsPx.filter((sp) => !sp.rejected && sp.x != null).length,
    [taskSpotsPx]);

  /* --- THESE THREE SIT ABOVE `roomFixtureGroups` AND `placeArray` BECAUSE
         BOTH READ THEM ------------------------------------------------------
     A `useCallback` evaluates its dependency ARRAY on every render, so a hook
     naming one of these below its own `const` would touch the binding before it
     existed — "Cannot access 'arrayOutline' before initialization", which is a
     blank screen and not a warning. They were declared with the rest of the COB
     machinery and that is exactly what happened; the scanner over the hook deps
     is what caught it. Anything a callback names, in its body or its deps, is
     declared above it. */

  /**
   * THE PATH AN ARRAY IS SET OUT ON, in plan pixels — geometry or room outline.
   *
   * ONE FUNCTION FOR BOTH SOURCES, because every reader wants the same thing
   * from either: a closed or open run of points to space lamps along. Which list
   * to look in is the `room:` prefix on the id, and nothing downstream has to
   * know there were two lists.
   */
  const arrayOutline = useCallback((geomId) => {
    if (!geomId || !(pxPerFt > 0)) return null;
    if (String(geomId).startsWith('room:')) {
      const r = rooms.find((q) => q.id === String(geomId).slice(5));
      const poly = r?.plan?.polygonPx || r?.geo?.polygonPx;
      /* EVERY VERTEX OF A ROOM IS A CORNER, which is why this hands the same
         list twice rather than deriving one from the other. A room's outline is
         traced on the plaster and has no fillets and no sampled curve in it —
         each point IS a corner of the room — so a ring of downlights set out on
         one lands on the corners at four lamps and adds the middle of each wall
         at eight. See `arraySpots`. */
      return poly?.length ? { pts: poly, corners: poly,
                              closed: true, isRoom: true, roomId: r.id,
                              label: r.outline?.name || 'Space' } : null;
    }
    const sh = ceilingShapes.find((q) => q.id === geomId);
    if (!sh) return null;
    const toPx = (q) => ({ x: q.x * pxPerFt, y: q.y * pxPerFt });
    const pts = shapeOutlineFt(sh).map(toPx);
    if (pts.length < 2) return null;
    const home = rooms.find((r) => pointInPolygon(
      { x: sh.x * pxPerFt, y: sh.y * pxPerFt }, r.geo.polygonPx));
    /* AND THE SHAPE'S CORNERS SEPARATELY, WHICH IS NOT `pts` FILTERED. The
       outline is a POLYLINE — 72 points for a circle, ten per rounded corner —
       so there is no reading of it that recovers "this shape has four corners".
       `cornersFt` is the shape's own answer, and it comes back EMPTY for a
       circle, which is what makes a run on one freely spaced. */
    return { pts, corners: shapeCornersFt(sh).map(toPx),
             closed: !shapeIsOpen(sh), isRoom: false, roomId: home?.id ?? null,
             label: SHAPE_BY_ID[sh.kind]?.label ?? 'Geometry' };
  }, [ceilingShapes, rooms, pxPerFt]);

  /**
   * THE SHAPE UNDER A POINT ON THE PLAN, if any — the hit test both geometry-
   * taking tools run.
   *
   * ONE TEST AND NOT TWO, which is the whole reason it is a function. The COB
   * array had this inline in its branch of the canvas press; the cursor, the
   * ghost and the shape's own highlight all need the same answer on every MOVE,
   * and a second copy of the tolerance would be a hover that lit a line the
   * press then missed.
   *
   * THE TOLERANCE IS IN SCREEN PIXELS AND CONVERTED, the rule every hit test on
   * this canvas follows: it is about how accurately somebody can hit a line on
   * screen, which does not change when the drawing is scaled. `hitShape` grows
   * a closed outline by it and bands an open one either side — see its note.
   *
   * FIRST MATCH IN THE LIST, which is the order shapes were drawn in. Two
   * overlapping guides are a rare thing to have drawn on purpose and the press
   * has to pick one; the alternative — smallest first, as the door editor does —
   * would be a rule about area on objects that are very often the same size.
   */
  const shapeAtPointer = useCallback((pPx) => {
    if (!pPx || !(pxPerFt > 0)) return null;
    const pFt = { x: pPx.x / pxPerFt, y: pPx.y / pxPerFt };
    const tolFt = Math.max(8, pxPerFt * 0.4) / pxPerFt;
    return ceilingShapes.find((sh) => hitShape(sh, pFt, tolFt)) ?? null;
  }, [ceilingShapes, pxPerFt]);

  /**
   * ...AND WHETHER THE TOOL IN HAND WOULD ACTUALLY TAKE IT.
   *
   * THE ANSWER IS DIFFERENT FOR THE TWO TOOLS AND THAT DIFFERENCE IS THE POINT.
   *
   *   THE COB ARRAY takes ANY geometry. A run of spots can be set out on a
   *   cove's own rectangle as readily as on a guide — it references the line and
   *   builds nothing from it, so there is nothing for the line's role to clash
   *   with. See `cobArrays`.
   *
   *   THE SHAPE TOOL takes a geometry OF THE OTHER ROLE, and only that. Armed to
   *   draw a cove it will span one from a guide, which is exactly what a guide is
   *   for; armed to draw a cove it must NOT swallow the cove already there,
   *   because a press on bare ceiling inside an existing cove is how a second
   *   one is drawn across it — and that is the ordinary case, not the exception.
   *   The rule reads symmetrically (a guide can be taken from a cove) because it
   *   is one condition rather than a cove-only exemption.
   *
   * `null` WITH NOTHING ARMED, so a press on a shape with no tool in hand still
   * means what it has always meant: pick it up. See `shapePointerDown`.
   */
  const geomUnder = useCallback((pPx) => {
    if (addTool === 'cob' && cobMode === 'array') return shapeAtPointer(pPx);
    /* --- A MODULE WANTS A TRACK, AND NOTHING ELSE WILL DO ------------------
       THE THIRD TOOL THAT TAKES A GEOMETRY, and the narrowest of the three: a
       diffuser clips into a magnetic track and cannot be clipped into a cove, a
       guide or the ceiling. So the cue is offered for a track and withheld for
       everything else — which is what makes the pointer honest over a guide
       drawn an inch away from the run. */
    if (addTool === 'module') {
      const sh = shapeAtPointer(pPx);
      return sh && shapeIsTrack(sh) ? sh : null;
    }
    /* THE BAR BEING OPEN IS ENOUGH — IT DOES NOT HAVE TO BE ARMED, and that is
       the whole flow for a magnetic track: press the rail cell and the bar
       arrives with no primitive live (see `openShapeTool`, and the space click
       that does the same), then press the guide you want to be a track. Requiring
       a primitive first would mean arming a rectangle you are not going to draw
       in order to borrow an outline that already exists. */
    if (shapeMenuOn) {
      const sh = shapeAtPointer(pPx);
      return sh && shapeRoleOf(sh) !== shapeRole ? sh : null;
    }
    return null;
  }, [shapeAtPointer, addTool, cobMode, shapeMenuOn, shapeRole]);

  /**
   * EVERY MAGNETIC TRACK ON THE DRAWING, RESOLVED — in plan pixels.
   *
   * DERIVED FROM `ceilingShapes` AND NOT FROM A STORE OF ITS OWN, which is what
   * makes a track editable: drag a grip and the profile moves, because there was
   * never a copy of its path to go stale. See `trackFixtures`.
   *
   * THE LENGTH IS MEASURED FROM THE LIVE OUTLINE AND THE LIVE SCALE, never
   * stored — the rule `runMetres` in boq.js exists to enforce. A run whose scale
   * was corrected after it was drawn is a different number of metres of profile,
   * and a plan that billed the old figure would be ordering the wrong length.
   *
   * `corners` IS THE TURNS AND NOT THE POINTS. A moulded corner join is bought
   * per turn of profile — see boq.js — so a closed rectangle is four and an open
   * L is one. A circle's outline is 72 segments and none of them is a corner
   * anybody orders a join for, which is exactly what `cornersFt` answers: it
   * returns nothing for a circle, and a run on one is a bent extrusion rather
   * than a set of mitres.
   *
   * `roomId` IS WHERE THE MIDDLE OF IT IS. A profile drawn across a threshold
   * belongs to one room for the purposes of the Analysis, and the honest single
   * answer is the space its centre is over — the same reading `arrayOutline`
   * takes for a shape. The absorbing track splits itself per room because it is
   * billed per room off the layout; this one is a hand-placed object and is
   * counted where it sits.
   */
  const magTracksPx = useMemo(() => {
    if (!(pxPerFt > 0)) return [];
    const out = [];
    for (const sh of ceilingShapes) {
      if (!shapeIsTrack(sh)) continue;
      const toPx = (q) => ({ x: q.x * pxPerFt, y: q.y * pxPerFt });
      const pts = shapeOutlineFt(sh).map(toPx);
      if (pts.length < 2) continue;
      const closed = !shapeIsOpen(sh);
      const cn = shapeCornersFt(sh).length;
      const home = rooms.find((r) => pointInPolygon(
        { x: sh.x * pxPerFt, y: sh.y * pxPerFt }, r.geo.polygonPx));
      out.push({
        id: sh.id, pts, closed,
        lengthFt: pathLengthFt(pts, { closed }) / pxPerFt,
        // A CLOSED RUN TURNS AT EVERY CORNER; AN OPEN ONE HAS TWO FEWER, because
        // its two ends are cut rather than mitred.
        corners: cn >= 3 ? (closed ? cn : cn - 2) : 0,
        roomId: home?.id ?? null,
        label: SHAPE_BY_ID[sh.kind]?.label ?? 'Track',
      });
    }
    return out;
  }, [ceilingShapes, rooms, pxPerFt]);

  const magTrackById = useMemo(
    () => Object.fromEntries(magTracksPx.map((t) => [t.id, t])), [magTracksPx]);

  /**
   * THE RUN THAT IS SELECTED, if the selected shape is one.
   *
   * A TRACK IS A CEILING SHAPE, so being selected is `selShapeId` naming it —
   * there is no second selection to keep in step. What this adds is the TEST:
   * `selShapeId` is just as likely to be a cove or a guide, and the module
   * drawer must not appear for either. See the ToolRail call site.
   */
  const selTrackId = useMemo(
    () => (selShapeId && magTrackById[selShapeId] ? selShapeId : null),
    [selShapeId, magTrackById]);

  /**
   * EVERY MODULE, RESOLVED ONTO ITS RUN — what the drawing and the Analysis both
   * read. Nothing here is stored; see `trackFixtures` for why.
   *
   * A MODULE WHOSE RUN HAS GONE IS DROPPED RATHER THAN DRAWN AT THE ORIGIN. The
   * shape can be deleted from anywhere — the bar, the Delete key, a cleared plan
   * — and `deleteShape` takes the fixtures with it, so this is the belt to that
   * braces: a stale entry produces nothing rather than a fitting floating off
   * the drawing.
   */
  const trackModulesPx = useMemo(() => {
    if (!(pxPerFt > 0)) return [];
    const out = [];
    for (const f of trackFixtures) {
      const t = magTrackById[f.trackId];
      if (!t) continue;
      const at = moduleAt(t.pts, f.u, { closed: t.closed });
      if (!at) continue;
      const m = MODULE_BY_ID[f.kind] ?? MODULE_BY_ID.spot;
      out.push({
        id: f.id, trackId: f.trackId, kind: f.kind, roomId: t.roomId,
        x: at.x, y: at.y, ux: at.ux, uy: at.uy,
        /* INCHES, BECAUSE THAT IS WHAT THE PRODUCT IS AND WHAT THE CANVAS DRAWS
           FROM. `inch()` there turns them into drawing units at the live scale,
           exactly as the absorbing track's heads are drawn — see TRACK_DIMS_IN.
           Handing feet would have been a second unit for one dimension.
           AND THE LENGTH IS ASKED OF THE WATTAGE. A diffuser's body is a band of
           its output — 200 mm under 15 W, 400 to 25, 600 above (see
           `DIFFUSER_LENGTHS_MM`) — so a 5 W corner module and an 18 W one are
           two different objects on the drawing. It was a flat 24 in for every
           diffuser, which drew the whole range as the biggest thing in it. */
        lenIn: moduleLenIn(f.kind, f.watts), wideIn: m.wideIn ?? 1.5,
        watts: f.watts ?? m.watts, beam: f.beam ?? m.beam,
      });
    }
    return out;
  }, [trackFixtures, magTrackById, pxPerFt]);

  /**
   * EVERY ARRAY'S LAMPS, WORKED OUT AFRESH — what the drawing and the schedule
   * both read. Nothing here is stored; see `cobArrays` for why.
   */
  const arrayCobsPx = useMemo(() => {
    if (!(pxPerFt > 0)) return [];
    const out = [];
    for (const a of cobArrays) {
      const geo = arrayOutline(a.geomId);
      if (!geo) continue;
      const pts = arraySpots(geo.pts, {
        closed: geo.closed, side: a.side, offsetFt: (a.offsetFt || 0) * pxPerFt,
        count: a.count,
        /* WHERE THE LAMPS ARE OBLIGED TO SIT, which is what makes a run on a
           rectangle land on its corners rather than at four equal steps round
           its perimeter. See `arraySpots`; a shape with none — a circle — is
           spaced freely. */
        corners: geo.corners,
        /* WHERE THE RUN HAS BEEN DRAGGED TO, in pixels because the outline is.
           Stored in FEET on the array for the reason every other placed thing on
           this drawing is — see `manualCobs` — so a scale correction does not
           carry the run across the ceiling. */
        dx: (a.dxFt || 0) * pxPerFt, dy: (a.dyFt || 0) * pxPerFt,
      });
      pts.forEach((p, i) => out.push({
        id: `${a.id}#${i}`, arrayId: a.id, roomId: a.roomId ?? geo.roomId,
        x: p.x, y: p.y, watts: a.watts, beam: a.beam,
        throwFt: throwDiameterFt(a.beam,
          (ceilingMmFor(a.roomId ?? geo.roomId) / 304.8) || DEFAULT_DROP_FT),
      }));
    }
    return out;
  }, [cobArrays, arrayOutline, pxPerFt, ceilingMmFor]);

  /** The draft array's lamps, drawn while the bar is still asking about them —
   *  the same resolution the committed ones go through, so what you are looking
   *  at is what the tick will keep. */
  const draftArrayPx = useMemo(() => {
    const d = cobDraftArray;
    if (!d?.geomId || !(pxPerFt > 0)) return null;
    const geo = arrayOutline(d.geomId);
    if (!geo) return null;
    const pts = arraySpots(geo.pts, {
      closed: geo.closed, side: d.side, offsetFt: (d.offsetFt || 0) * pxPerFt,
      count: d.count, corners: geo.corners,
    });
    const path = arrayPath(geo.pts, {
      closed: geo.closed, side: d.side, offsetFt: (d.offsetFt || 0) * pxPerFt });
    return { pts, path, closed: geo.closed, geo };
  }, [cobDraftArray, arrayOutline, pxPerFt]);

  /**
   * THE SETTING-OUT LINE OF THE ARRAY THAT IS OPEN — the "connector".
   *
   * DRAWN ONLY WHILE ITS ARRAY IS SELECTED, and that is the honest lifetime. It
   * is not a thing on the ceiling: nobody builds it, it appears on no drawing
   * that leaves here, and a dashed ring left under every array for ever would be
   * the sheet claiming a line that is not there. What it IS is the array's
   * handle — the one mark that says twelve separate lamps are one object — and
   * the moment that matters is the moment somebody has hold of it.
   *
   * IT IS ALSO WHAT MAKES THE RUN DRAGGABLE BY SOMETHING OTHER THAN A LAMP. On
   * a ring of four the lamps are four small targets a long way apart; the line
   * between them is the whole geometry and can be grabbed anywhere.
   */
  const selArrayPathPx = useMemo(() => {
    const a = cobArrays.find((q) => q.id === selArrayId);
    if (!a || !(pxPerFt > 0)) return null;
    const geo = arrayOutline(a.geomId);
    if (!geo) return null;
    const pts = arrayPath(geo.pts, {
      closed: geo.closed, side: a.side, offsetFt: (a.offsetFt || 0) * pxPerFt,
      dx: (a.dxFt || 0) * pxPerFt, dy: (a.dyFt || 0) * pxPerFt });
    return pts?.length > 1 ? { pts, closed: geo.closed, id: a.id } : null;
  }, [cobArrays, selArrayId, arrayOutline, pxPerFt]);

  /**
   * WHAT THE BAR ASKS ABOUT THE ARRAY THAT IS OPEN.
   *
   * THE SAME SHAPE THE DRAFT HANDS IT, deliberately — see the `array` prop at
   * the CobSpec call site — because it is the same bar and the same questions.
   * `editing` is the one field that differs, and everything the bar does
   * differently follows from it rather than from a second component.
   *
   * `arrayAsks` DECIDES THE CONTROLS FROM THE GEOMETRY and not from what was
   * stored on the array. That matters after the fact rather than only while
   * setting out: a run set out INSIDE a rectangle that has since been reduced to
   * a line has no inside any more, and a side control offered for it would be
   * offering a choice between two paths with nothing to say which was meant.
   *
   * `null` WHERE THE GEOMETRY HAS GONE. A shape can be deleted from under an
   * array — the geometry is referenced, not owned — and a bar with a label and
   * no path behind it would be a control acting on nothing.
   */
  const selArrayBar = useMemo(() => {
    const a = cobArrays.find((q) => q.id === selArrayId);
    if (!a) return null;
    const geo = arrayOutline(a.geomId);
    if (!geo) return null;
    const asks = arrayAsks(geo.pts, { closed: geo.closed, isRoom: geo.isRoom,
                                      corners: geo.corners });
    return {
      watts: clampWatts(a.watts), beam: nearestBeam(a.beam),
      array: {
        editing: true, picked: true, label: geo.label,
        /* THE COUNT AS THE GEOMETRY CAN PRODUCE IT, not as it happens to be
           stored. A plan saved before the corners mattered, or an array whose
           hexagon has since been resized into a rectangle, would otherwise show
           a figure the drawing is not obeying — `arraySpots` quantises what it
           draws, so the bar has to quantise what it prints or the two disagree
           about the run in front of you. */
        count: quantiseCount(a.count, arrayQuanta(geo.corners, geo.closed)),
        sideId: a.side, offsetFt: a.offsetFt ?? 0,
        side: asks.side, sides: asks.sides,
        /* WHAT THE NUMBER BOX MAY STEP IN — one per corner and up in whole
           passes round the shape. See `arrayQuanta`. */
        countMin: asks.countMin, countStep: asks.countStep,
        // FEET AT THE CONTROL, PIXELS IN THE OUTLINE — the draft's own note.
        maxOffsetFt: asks.maxOffsetFt / (pxPerFt || 1),
      },
    };
  }, [cobArrays, selArrayId, arrayOutline, pxPerFt]);


  /**
   * WHAT IS ON THIS CEILING, COUNTED BY FAMILY — the input to the lumen model.
   *
   * COUNTING IS HERE AND THE ARITHMETIC IS IN lib/lumens.js, and the split is
   * deliberate: knowing that a zone with `kind: 'reverse-cove'` is a reverse
   * cove is this file's business — it is the only place that knows what any of
   * these lists are — and knowing what a reverse cove does to a room is the
   * model's. Neither has to learn the other's vocabulary, and the model can be
   * tested without a drawing.
   *
   * EVERY LINEAR RUN ON THE PLAN IS `type: 'strip'` — that is what lets the
   * canvas, the schedule and the DXF take a cove, a reverse cove and a shelf run
   * without any of them knowing what a cove is — so `kind` is what separates
   * them here, exactly as it does in the BOQ.
   *
   * THE THREE THINGS THAT BECOME A COB. The ambient grid's downlights, the heads
   * a track has swallowed and the directional spots are one family: a recessed
   * lamp throwing down. They are three different products in the schedule and
   * one distribution here, which is the distinction this file exists to make.
   *
   * ...AND A CHANDELIER IS A LAMP. It is the one decorative fitting this app
   * places, it throws in every direction, and the floor/table lamp split is the
   * only one of the six that describes that. Stated rather than left out,
   * because a pendant contributing nothing to a room's level would read as a
   * bug on a plan that has one.
   */
  const roomFixtureGroups = useCallback((r) => {
    const g = new Map();
    /* `key` IS THE ROW'S IDENTITY and `familyId` is what it is made of — see
       `analyseSpace`. Two groups with the same key merge; two with different
       keys are two rows even when they are the same family. */
    const bump = (key, familyId, count, lengthFt) => {
      const cur = g.get(key) ?? { key, familyId, count: 0, lengthFt: 0 };
      cur.count += count; cur.lengthFt += lengthFt;
      g.set(key, cur);
    };
    // FEET FROM PIXELS AND THE LIVE SCALE, never from a stored length — see
    // `runMetres` in boq.js for the bug that rule exists to prevent.
    const ft = (px) => (pxPerFt > 0 ? (px ?? 0) / pxPerFt : 0);

    for (const z of accentZonesPx) {
      if (z.roomId !== r.id || z.rejected) continue;
      if (z.type === 'sconce') { bump('sconce', 'sconce', 1, 0); continue; }
      if (z.type !== 'strip') continue;
      const familyId = z.kind === 'cove' ? 'cove'
        : z.kind === 'reverse-cove' ? 'reverse_cove'
        : z.kind === 'shelf' ? 'shelf_strip'
        // A run that is none of those is one somebody drew on the ceiling,
        // which is the family the brief calls "LED strips on the ceiling".
        : 'ceiling_strip';
      /* --- ONE ROW PER RUN, AND THE RUN'S OWN ID IS THE KEY -----------------
         A LENGTH OF TAPE IS A THING YOU SPECIFY ON ITS OWN. A bedroom's
         perimeter cove and the drop over the bed are two runs of two different
         lengths that a designer routinely orders at two different wattages, and
         one row saying "Cove — 32 ft" could express neither. Every other linear
         thing on this plan is the same: a reverse cove along one wall, a strip
         under a shelf, a run somebody clicked out by hand.
         COUNTED FAMILIES ARE NOT SPLIT THIS WAY, and the rule is the unit rather
         than a list of ids: anything sold by the METRE gets a row per run, and
         anything sold by the piece gets one row for the lot. Twelve COBs are one
         decision about COBs; twelve rows of chips would be eleven chances for
         two of them to disagree.
         THE KEY IS THE ZONE'S ID, which is what a chosen wattage is stored
         against — the same handle `accentDismissed` and `runTrims` already use,
         and stable for the same reasons. A run that stops existing takes its
         entry out of use; the entry simply lapses, exactly as a `lightMoves`
         offset does when its cell is re-cut. */
      bump(z.id, familyId, 1, ft(z.runLength));
    }

    /* --- THE THREE THINGS THAT USED TO BE ONE ROW --------------------------
       The ambient grid, the spots aimed at work surfaces and the spots aimed at
       pictures were bumped together as `cob`, on the argument that they are one
       family: a recessed lamp throwing down. That is still true of the PHYSICS —
       they share a distribution and the model treats them identically — and it
       was never true of the DESIGN. They are three layers of a lighting scheme,
       a designer specifies them separately, and now that the panel has three
       sections a single row could only appear in one of them.
       SO THE FAMILY STAYS ONE AND THE ROWS BECOME THREE, which is exactly the
       split `layer` was added for: `split` is where the light goes, `layer` is
       what it is for. See FIXTURE_FAMILIES in lumens.js.
       AND EACH OPENS AT ITS OWN CATALOGUE WATTAGE. A spot is a 5 W lamp and the
       grid's is 7 W — one row at one figure had to be wrong about one of them.
       See `defaultWatts` on the group and the note in `wattsFor`. */
    const grid = r.plan?.ok ? r.plan.lights.length : 0;
    if (grid) bump('cob', 'cob', grid, 0);

    for (const sp of taskSpotsPx) {
      if (sp.roomId !== r.id || sp.rejected || sp.x == null) continue;
      /* WHICH SPOT IT IS, OFF THE FITTING ITSELF. `art-spot` is a 24-degree lamp
         aimed at a picture and `spot` a 30-degree one aimed at a worktop; the
         schedule has always billed them as two lines, and they are two LAYERS
         for the same reason — one is what you work by, the other is what you
         look at. */
      const art = sp.fixture === 'art-spot';
      bump(art ? 'art-spot' : 'spot', 'cob', 1, 0);
      const row = g.get(art ? 'art-spot' : 'spot');
      row.label = art ? 'Art spot' : 'Directional spot';
      row.layer = art ? 'accent' : 'task';
      row.defaultWatts = FIXTURE_BY_ID[art ? 'art-spot' : 'spot']?.watts ?? null;
    }

    /* --- ...AND ONE ROW PER COB SOMEBODY PLACED BY HAND --------------------
       THIS IS THE COUNTED FAMILIES' RULE BROKEN ON PURPOSE, and it is worth
       saying why rather than leaving it to be found. The rule above is that
       anything sold by the piece gets ONE row for the lot, because twelve COBs
       are one decision about COBs and twelve rows of chips would be eleven
       chances for two of them to disagree. That holds exactly as long as one
       decision is what they are: the engine buys off the catalogue, once, for
       every cell in the room.
       A HAND-PLACED LAMP WAS SPECIFIED AS IT WAS PLACED. That is the whole point
       of the bar on the drawing — you may put a 24-degree 18 W lamp over the
       console and leave the rest of the ceiling alone — so each one is its own
       decision, and merging them into a row would be the panel unable to show
       the thing the tool exists to let somebody do. It is the same test the
       linear runs pass: a thing you point at and specify on its own.
       ITS OWN LABEL, so the numbering below does not run through the grid's row
       as if they were a series. See `analyseSpace`.
       AND IT CARRIES ITS OWN WATTAGE AND OPTIC rather than looking them up in
       `fixtureWatts`: the figures are on the fitting — see `manualCobs` — which
       is what makes them survive a room being re-gridded under them. */
    /* --- AN ARRAY IS ONE ROW, WHATEVER ITS COUNT --------------------------
       AND THAT IS THE OPPOSITE OF THE RULE BELOW IT, on purpose. A lamp placed
       by hand is its own decision and gets its own row. Twelve lamps on one ring
       are ONE decision — a geometry, a count and an offset — and they carry one
       wattage and one optic between them, because there is only one figure for
       them to read. So the row is the array, the quantity is how many it works
       out to, and changing the wattage here changes all twelve at once. That is
       not a convenience; it is what an array IS. See `cobArrays`. */
    for (const a of cobArrays) {
      const n = arrayCobsPx.filter((c) => c.arrayId === a.id && c.roomId === r.id).length;
      if (!n) continue;
      bump(a.id, 'cob', n, 0);
      const row = g.get(a.id);
      row.label = 'Spot array';
      row.layer = 'ambient';
      row.watts = clampWatts(a.watts);
      row.wattRange = COB_WATT_RANGE;
      row.beam = nearestBeam(a.beam);
    }

    /* --- THE MODULES ON A MAGNETIC TRACK, ONE ROW PER RUN -----------------
       ONE ROW PER RUN AND PER KIND, which is the array's rule rather than the
       hand-placed lamp's, and for the array's reason: four diffusers on one
       profile are ONE decision — a run, a module, a wattage — and they carry one
       figure between them. Two kinds on one run are two rows, because a diffuser
       and a spot are two products doing two different jobs on the same carrier.

       THE DIFFUSER IS AMBIENT AND THE SPOT IS NOT, and that is the whole point
       of offering both. A diffuser is a lens over a linear board: its light
       leaves a face that is already the ceiling and spreads (70% at the walls,
       30% at the floor — the `panel` family, which has been specified in
       lumens.js since it was written and had no tool behind it until now). A
       spot puts a cone on the floor and is `cob`'s distribution, layered as
       task light. So a run of four 18 W diffusers moves the two figures at the
       top of this panel and a run of four spots barely does, which is a true
       statement about the two products and the reason the choice matters.

       THE FAMILY COMES OFF THE MODULE and not out of a table here — see
       TRACK_MODULES in lib/magTrack.js, which is the one place a module's
       distribution is named. */
    /* --- ONE ROW PER MODULE, WHICH IS THE HAND-PLACED LAMP'S RULE ----------
       IT WENT FROM ONE ROW PER RUN, TO ONE PER RUN PER WATTAGE, TO THIS. Each
       step was forced by the one before it, and the third is where it should have
       started: a module on a track is a thing you point at and specify on its
       own, which is exactly the test the note below `manualCobs` sets out for
       breaking the counted-family rule.

       WHY THE FIRST TWO FAILED. One row per run assumed a run carries one
       figure, and the corner-first allocator puts 5 W at the corners and a 10 W
       in the middle of a rail. Grouping by wattage fixed the arithmetic and left
       you unable to say anything about ONE of them: five diffusers on a run, four
       of them in one row, and no way to change the wattage of a single corner or
       to see which row the module you just dragged belongs to.

       SO THE KEY IS THE FITTING'S OWN ID, and the rows are numbered by
       `analyseSpace` — "Track diffuser 1", "Track diffuser 2" — which is what it
       already does for any two rows sharing a label. Press a chip and it moves
       that module and nothing else.

       AND THE LAYER IS THE FAMILY'S. A diffuser is ambient and a spot is task;
       both now have families of their own that say so (see `track_diffuser` and
       `track_spot` in lumens.js), so this no longer decides it per module id. */
    for (const t of magTracksPx) {
      if (t.roomId !== r.id) continue;
      for (const q of trackModulesPx) {
        if (q.trackId !== t.id) continue;
        const m = MODULE_BY_ID[q.kind];
        if (!m?.family) continue;    // the wall washer, which has no numbers yet
        bump(q.id, m.family, 1, 0);
        const row = g.get(q.id);
        row.label = `Track ${m.label.toLowerCase()}`;
        row.watts = q.watts ?? moduleWatts(q.kind);
        row.beam = q.beam ?? m.beam;
      }
    }

    for (const c of manualCobs) {
      if (c.roomId !== r.id) continue;
      bump(c.id, 'cob', 1, 0);
      const row = g.get(c.id);
      row.label = 'Placed COB';
      /* AMBIENT, like the grid it stands in. A downlight placed by hand is doing
         the ambient layer's job in a cell the ambient grid cut — where it came
         from is a fact about who decided, not about what it is for. */
      row.layer = 'ambient';
      row.watts = clampWatts(c.watts);
      row.wattRange = COB_WATT_RANGE;
      row.beam = nearestBeam(c.beam);
    }

    const pendants = (r.geo?.fansInRoom ?? []).filter(
      (f) => f.kind === 'chandelier').length;
    if (pendants) bump('lamp', 'lamp', pendants, 0);

    /* IN THE TABLE'S OWN ORDER, so the rows do not reshuffle as fittings are
       added, and within a family in the order the drawing produced them.
       `FIXTURE_FAMILIES` is ordered the way the work happens — the surface
       details first, the things mounted on them after. */
    const order = new Map(FIXTURE_FAMILIES.map((f, i) => [f.id, i]));
    return [...g.values()].sort(
      (a, b) => (order.get(a.familyId) ?? 99) - (order.get(b.familyId) ?? 99));
  }, [accentZonesPx, taskSpotsPx, pxPerFt, manualCobs, cobArrays, arrayCobsPx,
      magTracksPx, trackModulesPx]);

  /**
   * IS THIS SPACE BRIGHT ENOUGH — the Analysis section of the space detail.
   *
   * ASKED PER SPACE, WHICH IS THE POINT. The figure in the footer is the whole
   * plan's, and that is the right thing for a sheet and the wrong thing for a
   * decision: you light a bedroom against a bedroom's surfaces, and a flat that
   * averages out can hold one room a thousand lumens short.
   *
   * EVERY INPUT IS SOMETHING THE PANEL ABOVE THIS ONE ASKED FOR — the height,
   * the three finishes, the wattage of each family. That is the whole design:
   * Materials is what the room IS, and this is what that makes it, and pressing
   * anything in the first moves the second while you watch. See lib/lumens.js
   * for the model and for every constant it reads.
   */
  const spaceAnalysis = useCallback((r) => analyseSpace({
    polygonFt: r.geo.polygonFt,
    ceilingMm: ceilingMmFor(r.id),
    materials: materialsOf(materials, r.id),
    projectId,
    // WHERE THE BUILDING IS, and it decides what a watt is worth: 75 lm/W in
    // India against 100 elsewhere. Same prop the switchboards read, same
    // forgiving lookup — see `lumensPerWattFor`.
    country,
    groups: roomFixtureGroups(r),
    watts: fixtureWatts[r.id] ?? {},
  }), [ceilingMmFor, materials, projectId, country, roomFixtureGroups, fixtureWatts]);

  /**
   * THE SAME READING FOR THE WHOLE PLAN — what the footer prints.
   *
   * A SUM OF THE ROOMS AND NOT A SECOND MODEL. Every figure here comes out of
   * `spaceAnalysis`, one room at a time, so the line at the bottom of the screen
   * and the panel beside it cannot come to disagree — which they would within a
   * week if this recomputed anything.
   */
  const planLumens = useMemo(() => {
    let required = 0, achieved = 0;
    for (const r of rooms) {
      const a = spaceAnalysis(r);
      required += a.required; achieved += a.achieved;
    }
    return { required, achieved };
  }, [rooms, spaceAnalysis]);

  /**
   * WHICH ANALYSIS ROWS THE CURRENT SELECTION IS, as row keys.
   *
   * THE TRANSLATION LIVES HERE BECAUSE ONLY THIS FILE KNOWS BOTH ENDS. The panel
   * is handed rows keyed by whatever `roomFixtureGroups` decided identifies one,
   * and that is a different kind of handle per family: a placed COB and a length
   * of tape are each their own row, so a fitting's id IS the key; every task spot
   * in a room is one row, so the key is the catalogue line it is billed as. A
   * component given a fitting id could not resolve either without learning the
   * grouping rules, which are this file's.
   *
   * A LIST, because more than one thing can be picked at once — a run and a spot
   * are separate selections on this canvas and both should light up.
   *
   * A SELECTED SPACE IS NOT IN HERE. Opening a room is how you get the panel to
   * be about it at all; highlighting every row in it would be the panel telling
   * you what you just asked for.
   */
  const analysisHighlight = useMemo(() => {
    const keys = [];
    let roomId = null;
    if (selCobId) {
      keys.push(selCobId);
      roomId = manualCobs.find((c) => c.id === selCobId)?.roomId ?? roomId;
    }
    /* AN ARRAY'S ROW IS KEYED BY THE ARRAY, which is what `roomFixtureGroups`
       bumps it under: twelve lamps on one ring are one decision and therefore
       one row, so clicking any of the twelve marks the row all twelve share. */
    if (selArrayId) {
      keys.push(selArrayId);
      roomId = cobArrays.find((a) => a.id === selArrayId)?.roomId ?? roomId;
    }
    /* A MODULE'S ROW IS KEYED BY THE FITTING, exactly as a hand-placed COB's is
       — one row per module, see `roomFixtureGroups` — so clicking one on the
       drawing reveals the row that is about it and nothing else. */
    if (selModuleId) {
      keys.push(selModuleId);
      roomId = trackModulesPx.find((q) => q.id === selModuleId)?.roomId ?? roomId;
    }
    /* A RUN'S ROW IS KEYED BY THE ZONE'S OWN ID — see the note in
       `roomFixtureGroups` on why anything sold by the metre gets a row apiece —
       except a sconce, which is counted and therefore shares one. */
    if (selAccId) {
      const z = accentZonesPx.find((q) => q.id === selAccId);
      keys.push(z?.type === 'sconce' ? 'sconce' : selAccId);
      roomId = z?.roomId ?? roomId;
    }
    if (selSpotId) {
      const sp = taskSpotsPx.find((q) => q.id === selSpotId);
      if (sp) {
        keys.push(sp.fixture === 'art-spot' ? 'art-spot' : 'spot');
        roomId = sp.roomId ?? roomId;
      }
    }
    /* AND A GRID LIGHT LIGHTS THE GRID'S ROW. They are one row for the lot, so
       clicking one of twelve marks the decision all twelve share — which is the
       honest answer to "what is this fitting" for a lamp whose wattage cannot be
       set on its own. */
    if (selLightId) {
      keys.push('cob');
      /* THE ID IS `<roomId>|<cellKey>` — see where it is set on the canvas. The
         room is the half before the bar, which is the only part this needs. */
      roomId = String(selLightId).split('|')[0] || roomId;
    }
    return { keys, roomId };
  }, [selCobId, selArrayId, selModuleId, selAccId, selSpotId, selLightId,
      manualCobs, cobArrays, trackModulesPx, accentZonesPx, taskSpotsPx]);

  /**
   * CLICKING A FITTING TAKES YOU TO IT IN THE ANALYSIS.
   *
   * ONE EFFECT AND NOT FOUR HANDLERS, which is why `analysisHighlight` carries
   * the room as well as the keys. A COB, a length of tape, a spot and a grid
   * light are picked up by four different pointer handlers with four different
   * stores behind them, and "show me what I just clicked" is one behaviour: put
   * it in each of them and the fourth one gets forgotten, which is exactly what
   * had already happened before this existed.
   *
   * IT FIRES ON THE SELECTION CHANGING AND NOT ON EVERY RENDER, so somebody who
   * selects a lamp and then goes to read the BOQ is not dragged back to the
   * Spaces tab a moment later. `keys` is the dependency; re-selecting the same
   * fitting is not a change and does nothing.
   *
   * OPENING THE ROW AND SCROLLING TO IT IS SpaceAnalysis's HALF. This gets the
   * right space in front of you; that panel gets the right row in front of you.
   * The split is the same one this file makes everywhere: which space the panel
   * is about is the editor's business, how the panel reads is the panel's.
   */
  const revealed = useRef('');
  useEffect(() => {
    const { keys, roomId } = analysisHighlight;
    const tag = keys.join('|');
    if (!tag) { revealed.current = ''; return; }
    if (tag === revealed.current) return;
    revealed.current = tag;
    if (roomId) { setFocusId(roomId); setOptionPick(null); }
    setView('spaces');
  }, [analysisHighlight]);

  /** ONE ROW'S WATTAGE, IN ONE ROOM — a run's own, or a counted family's. `key`
   *  is whatever `roomFixtureGroups` said identifies the row; `familyId` is only
   *  needed to know what its default is. A choice that lands back on that
   *  default is stored as nothing, the rule every override in this file
   *  follows — see `boardKinds` and the wall tones. */
  /* --- THESE TWO SIT HERE BECAUSE `autoplaceIn` BELOW READS THEM -----------
     THEY WERE DECLARED WITH THE REST OF THE COB MACHINERY, a thousand lines
     down beside `cobEngine`, and that crashed the app outright: a `useCallback`
     evaluates its dependency ARRAY on every render, so `autoplaceIn` naming
     `cobBasisFor` in its deps touched the binding before the `const` had been
     reached — "Cannot access 'cobBasisFor' before initialization".
     IT IS NOT A HOISTING QUIRK TO WORK AROUND, it is the rule: a hook's deps are
     ordinary expressions in the component body and a `const` below them does not
     exist yet. Anything a callback names, in its body or its deps, has to be
     declared above it. The COB block still owns everything else.
     THE ORDER WITHIN THE PAIR MATTERS TOO — `cobBasisFor` calls `cobChunkSpec`
     and lists it as a dependency, so it follows it. */

  /**
   * WHAT A CHUNK HAS ALREADY BEEN DECIDED TO BE, if anything.
   *
   * A CHUNK IS ONE PIECE OF CEILING AND ONE RUN OF LAMPS. The moment one of them
   * carries a specification somebody chose, the rest are not a fresh question —
   * they are the same decision, and a flat plane of downlights that came out at
   * three different wattages is a grid nobody would build. So a lamp with `spec`
   * set anywhere in the chunk answers for the whole of it, and both callers ask
   * this: the bar under the pointer, and the autoplace toggle.
   *
   * `spec` AND NOT MERELY "EXISTS", which is the distinction that keeps this
   * from eating its own tail. Every autoplaced lamp is on the rule, so if their
   * presence counted as a decision the first one placed would freeze the chunk
   * at its own cell's answer and every larger cell beside it would inherit a
   * lamp too small. Only a lamp somebody OVERRULED — on the bar, or in the
   * Analysis panel — is a decision. See `placeCob` and `setCobSpec`.
   *
   * BY CHUNK AND NOT BY CELL, so the lookup is on `cell.chunk`, which the
   * planner stamps on every cell it cuts.
   */
  const cobChunkSpec = useCallback((room) => (cell) => {
    if (!room || cell?.chunk == null || !(pxPerFt > 0)) return null;
    const cells = room.plan?.gridCellsPx ?? [];
    for (const c of manualCobs) {
      if (c.roomId !== room.id || !c.spec) continue;
      const at = { x: c.xFt * pxPerFt, y: c.yFt * pxPerFt };
      const home = cells.find((q) => at.x >= q.x0 && at.x <= q.x1
                                  && at.y >= q.y0 && at.y <= q.y1);
      if (home?.chunk === cell.chunk) return { watts: c.watts, beam: c.beam };
    }
    return null;
  }, [manualCobs, pxPerFt]);

  /* WHERE THE BUILDING IS AND HOW HIGH THE CEILING IS — the two facts outside
     the cell that the rule needs. Both callers share this so the bar and the
     toggle cannot come to disagree. */
  const cobBasisFor = useCallback((room) => ({
    lumensPerWatt: lumensPerWattFor(country),
    dropFt: (room ? ceilingMmFor(room.id) / 304.8 : 0) || DEFAULT_DROP_FT,
    inForce: cobChunkSpec(room),
  }), [country, ceilingMmFor, cobChunkSpec]);

  /**
   * FILL A SPACE'S GRID CELLS WITH LAMPS — the autoplace toggle's whole job.
   *
   * ONE LAMP PER CELL, AT THE CELL'S OWN SPEC. `autoSpec` in lib/cob.js is the
   * rule and this only applies it: the cell's area decides the wattage, its
   * short side decides the optic, and a chunk that has already been decided
   * overrides both — see `cobChunkSpec`. It reads `gridCellsPx`, which is the
   * chunker's answer whether or not the old auto-placement is switched on, so
   * this works on the ordinary state of this app.
   *
   * AT THE CELL'S CENTRE AND NOT AT THE PLANNER'S CHOSEN SPOT, and that is a
   * real difference worth stating. The old placement ran a solver: it slid a
   * lamp inside its centre band to line up with its neighbours, promoted pairs
   * of cells to one large fitting, and shoved lamps clear of fans. None of that
   * survives — `cx`/`cy` is the middle of the box. That is the honest reading of
   * "one lamp per cell at ten lumens a square foot": if the grid is right, the
   * middle of a cell is where its lamp goes, and if it is not, the fix is the
   * grid. Everything the solver did can be had back by hand, one lamp at a time,
   * because these are ordinary hand-placeable lamps once they land.
   *
   * IT SKIPS A CELL THAT ALREADY HAS A LAMP IN IT, so switching the toggle on in
   * a space somebody has already worked in adds the missing ones rather than
   * doubling the ones that are there.
   *
   * `auto` MARKS THEM AS THE TOGGLE'S. Switching it off takes back exactly the
   * lamps that are still the toggle's and no others — a lamp that has been
   * dragged or re-specified has been adopted, and losing somebody's work to a
   * checkbox is the one thing a reversible control must not do. See the flag's
   * two clearing points: `setCobSpec` and the drag's commit.
   */
  const autoplaceIn = useCallback((room) => {
    if (!room || !(pxPerFt > 0)) return;
    const cells = room.plan?.gridCellsPx ?? [];
    if (!cells.length) return;
    const basis = cobBasisFor(room);
    /* --- THE TWO PIECES OF CEILING THAT GET NO LAMP -------------------------
       "The previous placement logic goes" is about the SOLVER — the sliding, the
       pairing, the shoving clear of fans — and not about the two rules that say
       a fitting must not be somewhere at all. Those are not tuning; they are the
       reasons the grid was cut the way it was, and a toggle that overrode them
       would put a downlight in the eye of whoever is lying in the bed while the
       app draws a warning about that very thing under the pointer two feet away.

         A NO-LIGHT ZONE is a bed, or a box somebody drew. Tested at the cell's
         CENTRE, because that is where the lamp would land — a cell merely
         clipped by a zone still has somewhere for its fitting to be, and
         refusing it would leave a hole beside every bed.
         A DARK CHUNK is laid out and deliberately unlit — the band outside a
         cove that is carrying the room on its own. See `ch.dark` in planner.js:
         it is an intention rather than a failure, and filling it would be
         undoing a decision the ceiling design made. */
    const zones = room.plan?.zonesPx ?? [];
    const chunksPx = room.plan?.gridChunksPx ?? [];
    setManualCobs((list) => {
      const mine = list.filter((c) => c.roomId === room.id);
      const taken = (cell) => mine.some((c) => {
        const x = c.xFt * pxPerFt, y = c.yFt * pxPerFt;
        return x >= cell.x0 && x <= cell.x1 && y >= cell.y0 && y <= cell.y1;
      });
      const add = [];
      /* ONE ANSWER PER CHUNK, WORKED OUT ONCE. `chunkSpec` walks every cell in
         the chunk, so asking it per cell would be quadratic on a big room and —
         worse — would invite somebody to "simplify" it back to a per-cell call,
         which is the bug this replaced: two wattages in one run of plasterboard
         because two boxes of the grid were different sizes. */
      const byChunk = new Map();
      const specFor = (ch) => {
        if (!byChunk.has(ch)) {
          byChunk.set(ch, chunkSpec(cells, ch,
            { dropFt: basis.dropFt, lumensPerWatt: basis.lumensPerWatt }));
        }
        return byChunk.get(ch);
      };
      for (const cell of cells) {
        if (!(cell.w > 0 && cell.h > 0) || taken(cell)) continue;
        if (chunksPx[cell.chunk]?.dark) continue;
        const mid = { x: (cell.x0 + cell.x1) / 2, y: (cell.y0 + cell.y1) / 2 };
        if (zones.some((z) => mid.x >= z.x0 && mid.x <= z.x1
                           && mid.y >= z.y0 && mid.y <= z.y1)) continue;
        const held = basis.inForce?.(cell);
        const spec = held ?? specFor(cell.chunk);
        if (!spec) continue;
        add.push({
          ...placeCob({
            /* THE CENTRE OF THE CELL, TAKEN FROM THE BOUNDS AND NOT FROM
               `cx`/`cy`. Those are in the ROOM's own feet — see the note on
               `gridCellsPx` — and would need the room's origin applied again;
               the bounds are already plan pixels. */
            p: mid,
            pxPerFt, roomId: room.id,
            watts: spec.watts, beam: spec.beam,
            /* NOT A DECISION SOMEBODY MADE, even where it inherited one: it is
               the rule's answer for this cell, and `spec` is what marks a lamp
               as having been overruled. Setting it here would freeze the chunk
               on its own output — see `cobChunkSpec`. */
            spec: false,
            seq: `a${add.length}`,
          }),
          auto: true,
        });
      }
      return add.length ? [...list, ...add] : list;
    });
  }, [pxPerFt, cobBasisFor]);

  /**
   * KEEP THE ARRAY — the tick on the bar, and the only way one gets onto the
   * drawing.
   *
   * A PREVIEW UNTIL SOMEBODY SAYS YES, which is the shape tool's rule and the
   * right one here for its reason: an array is a dozen fittings arriving at
   * once, and the count, the side and the distance are all being adjusted while
   * you watch them move. Committing on every keystroke would put a dozen lamps
   * into the schedule for each digit typed.
   *
   * THE SPECIFICATION IS TAKEN FROM THE BAR AT THE MOMENT OF THE TICK, so an
   * array carries the wattage and optic that were showing when it was placed —
   * one figure for the whole run, which is what makes it one row in the
   * Analysis and what makes changing it there change every lamp in it.
   *
   * THE TOOL STAYS ARMED AND THE DRAFT IS CLEARED, so the next press picks the
   * next geometry. Somebody ringing four rooms does it four times without
   * touching the rail.
   */
  const placeArray = useCallback(() => {
    const d = cobDraftArray;
    if (!d?.geomId || !(d.count > 0)) return;
    const geo = arrayOutline(d.geomId);
    if (!geo) return;
    setCobArrays((l) => [...l, {
      id: `carr-${Date.now().toString(36)}-${l.length}`,
      geomId: d.geomId, roomId: d.roomId ?? geo.roomId,
      count: d.count, side: geo.closed ? d.side : 'on',
      offsetFt: geo.closed ? d.offsetFt : 0,
      watts: clampWatts(d.watts ?? 7), beam: nearestBeam(d.beam ?? 36),
    }]);
    setCobDraftArray(null);
    setSel(clear());
  }, [cobDraftArray, arrayOutline]);

  /** ONE ARRAY'S SPECIFICATION, from the Analysis panel. Every lamp in it moves
   *  together, because there is only one figure and they all read it. */
  const setArraySpec = useCallback((id, patch) => {
    setCobArrays((l) => l.map((a) => (a.id === id ? { ...a,
      ...(patch.watts != null ? { watts: clampWatts(patch.watts) } : {}),
      ...(patch.beam != null ? { beam: nearestBeam(patch.beam) } : {}) } : a)));
  }, []);

  /**
   * ONE ARRAY'S SETTING-OUT, from its own bar — how many, which side, how far.
   *
   * IT WRITES STRAIGHT THROUGH AND THERE IS NO TICK, which is the one way an
   * array already on the drawing differs from one being set out. A draft is a
   * preview and needs a yes; this run exists, it is in the schedule, and every
   * one of these three figures is a thing somebody adjusts while watching the
   * lamps move. A confirmation on each keystroke would be a control you cannot
   * sweep.
   *
   * THE SAME CLAMPS THE DRAFT'S HANDLERS APPLY, because they are the same
   * questions asked of the same object — a count of zero is not a run, and a
   * negative distance is the other side by another name. See `arrayAsks` for
   * which of the three a given geometry may honestly be asked at all.
   */
  const setArrayShape = useCallback((id, patch) => {
    setCobArrays((l) => l.map((a) => {
      if (a.id !== id) return a;
      /* THE COUNT IS QUANTISED AGAINST THIS ARRAY'S OWN GEOMETRY, here rather
         than at the control, and that is the point: the number box steps in the
         right units already (see `countStep` on the bar) but a typed figure, a
         held arrow key and a stored plan all reach this too. One place decides
         what a count may be, so the drawing can never hold a run of five on a
         rectangle. See `quantiseCount`. */
      const geo = patch.count != null ? arrayOutline(a.geomId) : null;
      const q = geo ? arrayQuanta(geo.corners, geo.closed) : null;
      return { ...a,
        ...(patch.count != null
          ? { count: Math.min(200, quantiseCount(patch.count, q ?? { free: true })) }
          : {}),
        ...(patch.side != null ? { side: patch.side } : {}),
        ...(patch.offsetFt != null
          ? { offsetFt: Math.max(0, Number(patch.offsetFt) || 0) } : {}) };
    }));
  }, [arrayOutline]);

  /**
   * ONE RUN'S MODULES, RE-SPECIFIED — from the Analysis panel's own chips.
   *
   * THE ROW'S KEY IS `<trackId>|<kind>`, which is what `roomFixtureGroups` bumps
   * a track's modules under: one row per run per kind, because four diffusers on
   * one profile are ONE decision and carry one figure between them.
   *
   * WHY THIS HAD TO EXIST. The row reads its wattage off the fittings — `row.watts
   * = own[0].watts` — and `analyseSpace` believes a group that states its own
   * wattage over anything in the room's override store (see the note on `watts`
   * there, which is the right rule for a hand-placed fitting). So the chips were
   * writing to `fixtureWatts`, the row was ignoring it, and the figure sat at
   * whatever the allocator chose for ever. The chip has to write where the row
   * reads, and that is the fitting.
   *
   * EVERY MODULE OF THAT KIND ON THAT RUN MOVES TOGETHER, because there is one
   * figure and they all show it. A single module specified differently from its
   * neighbours is not something this panel can express, and pretending otherwise
   * would put a row on it nobody could reach.
   */
  const setTrackModuleSpec = useCallback((id, patch) => {
    /* ONE MODULE, BY ITS OWN ID. The key was `<trackId>|<kind>` and then
       `<trackId>|<kind>|<watts>`, and both were groups — so a chip moved four
       corners together and there was no way to reach one of them. A module is a
       thing you point at and specify on its own; the row's key is the fitting.
       See `roomFixtureGroups`.
       WHOLE WATTS, because a module is specified in them and the length bands
       are keyed on them — see `DIFFUSER_LENGTHS_MM`. */
    setTrackFixtures((l) => l.map((f) => (f.id === id
      ? { ...f,
          ...(patch.watts != null ? { watts: Math.max(1, Math.round(patch.watts)) } : {}),
          ...(patch.beam != null ? { beam: nearestBeam(patch.beam) } : {}) }
      : f)));
  }, []);

  /** IS THIS ROW A TRACK'S MODULES? One test, because three handlers ask it and
   *  a row key is the only thing they are given. */
  const isModuleRow = useCallback(
    (key) => trackFixtures.some((f) => f.id === key), [trackFixtures]);

  /** THE WHOLE RUN, OFF THE DRAWING. The geometry it was set out on stays — see
   *  the note at the Delete key. */
  const deleteArray = useCallback((id) => {
    setCobArrays((l) => l.filter((a) => a.id !== id));
    setSel((cur) => (idOf(cur, 'array') === id ? clear() : cur));
    setArrayDrag((d) => (d?.id === id ? null : d));
  }, []);

  /** THE TOGGLE. On fills the grid; off takes back only what is still the
   *  toggle's — see `autoplaceIn` for why that distinction is the whole safety
   *  of the control. */
  const setAutoplace = useCallback((roomId, on) => {
    setAutoSpots((ids) => (on
      ? (ids.includes(roomId) ? ids : [...ids, roomId])
      : ids.filter((x) => x !== roomId)));
    if (on) autoplaceIn(rooms.find((r) => r.id === roomId));
    else setManualCobs((l) => l.filter((c) => !(c.roomId === roomId && c.auto)));
  }, [autoplaceIn, rooms]);

  /**
   * EVERY LAMP NOBODY HAS OVERRULED FOLLOWS ITS CHUNK.
   *
   * THIS IS THE OTHER HALF OF "the rest will follow suit", and it was missing.
   * `chunkSpec` makes a run of downlights uniform at the moment they are PLACED;
   * this keeps them uniform afterwards, which is when it actually matters —
   * because the two things the rule reads both move under the drawing:
   *
   *   THE GRID GETS RE-CUT. A fan is dropped, a cove is added, a chunking is
   *   re-picked, and the chunk that was four equal boxes is now three unequal
   *   ones. The lamps standing in it were sized for a ceiling that no longer
   *   exists.
   *   SOMEBODY OVERRULES ONE. Set a lamp to 12 W on the bar or in the Analysis
   *   panel and every other lamp in its chunk should become 12 W — that is what
   *   `inForce` is for, and until now it only reached lamps placed AFTER the
   *   decision.
   *
   * IT TOUCHES ONLY `spec: false`, WHICH IS THE WHOLE SAFETY OF IT. Such a lamp
   * carries no decision — its wattage IS the rule's answer, recorded at the
   * moment it was placed — so re-deriving it is not overwriting anybody's work,
   * it is keeping a memo in step with what it is a memo OF. A lamp somebody set
   * by hand is never touched, whatever the grid does around it. Same doctrine
   * `lightMoves` follows when a cell is re-cut: a stored override survives, a
   * stored derivation lapses.
   *
   * IT CONVERGES IN ONE EXTRA PASS AND CANNOT LOOP. The write is guarded on
   * something having actually differed, and an unchanged list is returned BY
   * REFERENCE — React bails out of the re-render, so the dependencies that
   * brought us here do not change again. `chunkSpec` is a pure function of the
   * cells and the basis, so there is nothing for it to oscillate between.
   */
  useEffect(() => {
    if (readOnly || !(pxPerFt > 0) || !rooms.length) return;
    setManualCobs((list) => {
      let changed = false;
      const next = list.map((c) => {
        if (c.spec) return c;
        const room = rooms.find((r) => r.id === c.roomId);
        const cells = room?.plan?.gridCellsPx ?? [];
        if (!cells.length) return c;
        const at = { x: c.xFt * pxPerFt, y: c.yFt * pxPerFt };
        const home = cells.find((q) => at.x >= q.x0 && at.x <= q.x1
                                    && at.y >= q.y0 && at.y <= q.y1);
        /* A LAMP IN NO CELL IS LEFT ALONE — dragged into a cove pocket, or into
           a chunk the design has since taken away. There is nothing to derive
           from, and the figures it is carrying are the last honest answer
           anybody had for it. */
        if (!home) return c;
        const basis = cobBasisFor(room);
        const want = basis.inForce?.(home) ?? chunkSpec(cells, home.chunk, basis);
        if (!want || (want.watts === c.watts && want.beam === c.beam)) return c;
        changed = true;
        return { ...c, watts: want.watts, beam: want.beam };
      });
      return changed ? next : list;
    });
  }, [rooms, pxPerFt, cobBasisFor, readOnly]);

  /** RE-SPECIFYING A LAMP SOMEBODY PLACED, from the analysis panel.
   *
   *  IT WRITES TO THE FITTING AND NOT TO `fixtureWatts`, which is the whole
   *  difference between this and `setRowWatts` below. That store is a room's
   *  override of a FAMILY — the right shape when the engine chose once for
   *  twelve lamps and somebody is overruling that one choice. A hand-placed COB
   *  has no family decision behind it to override: it was specified as it was
   *  put down, the figures ride on it (see `manualCobs`), and a second store
   *  keyed by row would be a second opinion about the same lamp, kept somewhere
   *  the drawing does not read.
   *  BOTH FIGURES THROUGH THE SAME DOOR, because both are the specification. The
   *  wattage moves the lumen model; the beam angle does not and is not meant to
   *  — it decides where the light lands, and this app's model is about how much
   *  there is. It is stored because it is half of what was ordered. */
  const setCobSpec = useCallback((id, patch) => {
    setManualCobs((l) => l.map((c) => (c.id === id
      ? { ...c,
          ...(patch.watts != null ? { watts: clampWatts(patch.watts) } : {}),
          ...(patch.beam != null ? { beam: nearestBeam(patch.beam) } : {}),
          /* RE-SPECIFIED IS SPECIFIED. A lamp placed on the engine's own
             recommendation and then dialled to 18 W in the panel is no longer
             carrying the engine's answer, and the flag has to say so or it would
             be recording where the figure came from at birth rather than what it
             is now. */
          spec: true,
          /* ...AND IT IS NO LONGER THE TOGGLE'S TO TAKE AWAY. Switching autoplace
             off removes the lamps that are still the rule's answer; one somebody
             has re-specified is theirs. See `autoplaceIn`. */
          auto: false }
      : c)));
  }, []);

  const setRowWatts = useCallback((roomId, key, familyId, watts) => {
    setFixtureWatts((m) => {
      const room = { ...(m[roomId] ?? {}) };
      if (watts === FAMILY_BY_ID[familyId]?.defaultWatts) delete room[key];
      else room[key] = watts;
      if (!Object.keys(room).length) {
        if (!(roomId in m)) return m;
        const next = { ...m }; delete next[roomId]; return next;
      }
      return { ...m, [roomId]: room };
    });
  }, []);

  /**
   * RUNS OF TAPE ON THE DRAWING — coves, reverse coves, shelf strips and every
   * run somebody set out by hand.
   *
   * A COUNT AND NOT METRES, which is a change of unit from what the Result
   * panel printed and is deliberate. The footer line beside it counts LIGHTS and
   * SPOTS, and "12 lights, 3 spots, 4.7 m of strip" mixes a quantity with a
   * measurement in one comma list — the eye reads all three as counts and the
   * third one is not. The metres are still on the schedule, which is where a
   * number somebody orders against belongs.
   */
  const stripRuns = useMemo(
    () => accentZonesPx.filter((a) => a.type === 'strip' && !a.rejected).length,
    [accentZonesPx]);

  const boq = useMemo(() => buildBOQ({
    rooms,
    accents: accentZonesPx,
    spots: taskSpotsPx,
    objects: ceilingObjs,
    /* THE MAGNETIC TRACKS AND THEIR MODULES, resolved. The profile is billed by
       the metre off the LIVE outline and the LIVE scale — never a stored length,
       which is the rule `runMetres` exists to enforce — and each module names
       its own catalogue line. See `magTracksPx`. */
    magTracks: magTracksPx,
    modules: trackModulesPx.map((m) => ({
      roomId: m.roomId, fixture: MODULE_BY_ID[m.kind]?.fixture ?? null })),
    pxPerFt,
    plan: source?.name ?? null,
  }), [rooms, accentZonesPx, taskSpotsPx, ceilingObjs, magTracksPx, trackModulesPx,
       pxPerFt, source]);

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

  /** The schedule as a file. Three formats, one table — see boqExport.js. */
  const exportBOQ = useCallback(async (fmt) => {
    // GATED ONCE FOR ALL THREE FORMATS, which is the whole reason this stayed a
    // single function when the buttons were split out.
    if (!await gateExport()) return;
    const base = (source?.name || 'plan').replace(/\.[^.]+$/, '');
    const title = `Lighting schedule — ${base}`;
    if (fmt === 'csv') {
      // The BOM is what makes Excel read the file as UTF-8 rather than as the
      // local codepage, which is the difference between 36° and 36Â°.
      download(`${base}-boq.csv`, CSV_BOM + boqToCSV(boq), 'text/csv;charset=utf-8');
      return;
    }
    if (fmt === 'xlsx') {
      download(`${base}-boq.xlsx`, boqToXLSX(boq),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return;
    }
    download(`${base}-boq.pdf`, boqToPDF(boq, { title }), 'application/pdf');
  }, [boq, source, gateExport]);

  /** One line per room, and only where something actually went wrong. */
  const troubles = useMemo(() => rooms.flatMap((r) => {
    const name = r.outline.name || 'Space';
    if (!r.plan) return [];
    if (!r.plan.ok) return [{ name, msg: r.plan.reason }];
    const st = r.plan.stats;
    if (st.unserved > 0) return [{ name, msg: `${st.unserved} cell${st.unserved > 1 ? 's have' : ' has'} no light at all — that should not happen.` }];
    if (st.clashes > 0) return [{ name, msg: `${st.clashes} light${st.clashes > 1 ? 's sit' : ' sits'} inside a fan's clearance or a no-light zone, because the cell has nowhere else to go.` }];
    // A CEDED CELL IS A CELL THE OBSTACLE WON, and which obstacle matters. The
    // message named the fan unconditionally, which was true while a fan was the
    // only thing that could take a cell — a cove ceiling changed that, because
    // its chunk plan carries the beds as no-light zones rather than carving them
    // out, so a cell can now be ceded to a mattress in a room with no fan in it.
    if (st.ceded > 0) return [{ name, msg: st.fans
      ? `${st.ceded} cell${st.ceded > 1 ? 's are' : ' is'} left to the fan — no light fits clear of the blades.`
      : `${st.ceded} cell${st.ceded > 1 ? 's have' : ' has'} no light — the whole middle of ${st.ceded > 1 ? 'each' : 'it'} is a no-light zone.` }];
    if (st.outsideBand > 0) return [{ name, msg: `${st.outsideBand} light${st.outsideBand > 1 ? 's sit' : ' sits'} off its cell centre.` }];
    return [];
  }), [rooms]);

  // An image reaches the tracer with no scale yet; the tracer is where it gets
  // set, so `trace` covers "measure this plan", "correct what was found" and
  // "draw one the detector missed".
  /**
   * THE PIPELINE, and the loading screen is its progress.
   *
   * Pressing "Light the whole plan" used to be one synchronous act: mark the
   * outlines lit and land on the layout. It now runs up to four model calls per
   * room before the user sees anything, which is a minute on a six-room flat, so
   * the wait needs to be both visible and worth it.
   *
   * WHY THE ROOMS ARE READ FROM A REF. Everything after step one needs the
   * COMPUTED rooms — polygons, chunks, the ambient lights — and those come out
   * of a memo that cannot run until React has re-rendered with the new litIds.
   * An async function holding `rooms` from its own closure would hold the empty
   * array it was created with, forever. So the ref is the live view and the
   * pipeline waits for it to fill.
   *
   * NOTHING ABORTS THE WHOLE RUN. A room whose classification fails is an
   * `other` and gets no accent pass; a room whose accent call 502s is noted and
   * skipped. Five rooms lit and one not is a far better outcome than a spinner
   * that gave up at room two, and every failure is on the console.
   */
  const roomsRef = useRef(rooms);
  useEffect(() => { roomsRef.current = rooms; }, [rooms]);

  // BEDS FIRST, and it is the only step whose ORDER is load-bearing.
  //
  // A bed is a no-light zone, a zone changes where the ambient lights go, and
  // everything after this reads those light positions: the accent pass is shown
  // them so it does not put a sconce under a downlight, and the task spots are
  // placed on the grid they form. Decide the beds after the layout and every
  // one of those is working from a layout that is about to change.
  //
  // So this runs before "Reading your geometry" — before the rooms are marked
  // lit at all — and it works off the traced outlines, which is everything it
  // needs. The layout is then computed ONCE, with the beds already in it.
  const PREP_STEPS = useMemo(() => [
    // The whole-plan bed pass. Its step is listed only when the superseded
    // contested version is switched on (it is gated on `bedSets`); the live
    // `bed-filter` call runs on upload, before there is a pipeline to show.
    { key: 'beds', label: 'Placing the beds' },
    { key: 'geometry', label: 'Reading your geometry' },
    { key: 'types', label: 'Understanding space types' },
    // AFTER the classification, because it is the classification that makes it
    // possible: only once a space is known to be a bedroom is "no bed here" a
    // contradiction worth spending a model call on.
    { key: 'beds2', label: 'Checking the bedrooms' },
    { key: 'accents', label: 'Adding accent lighting' },
    { key: 'spots', label: 'Aiming task lights' },
  ], []);

  /** Run `fn` over `items`, at most `limit` at a time. */
  const mapLimit = async (items, limit, fn) => {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        try { out[i] = await fn(items[i], i); }
        catch (err) { out[i] = { error: err }; }
      }
    }));
    return out;
  };

  /**
   * ONE FUNCTION FOR THE WHOLE RUN AND FOR EVERY RE-RUN.
   *
   * `opts` picks the steps. The tracer's button runs all three; the panels'
   * recompute buttons run one. Which means a recompute is the SAME code as the
   * first pass — same loader, same per-room progress, same error handling —
   * rather than a second implementation that drifts from it. The old per-room
   * "Find accent zones" button was exactly that second implementation, and it
   * is gone.
   */
  /**
   * ...AND `only` RUNS IT OVER A SUBSET, WHICH IS THE RELIGHT-WHAT-CHANGED PATH.
   *
   * An array of outline ids, or null for the whole sheet. Three things read it
   * and they are the three things that made a partial run impossible before:
   *
   *   THE CLAIM. `claimSpaces` is handed the subset, so a plan where one corner
   *   moved is charged for one space. This is what the pricing page has always
   *   said happens.
   *
   *   THE WORK LIST. Every pass runs `mapLimit` over `list`, so filtering that
   *   one array narrows the classifier, the accents and the surfaces together.
   *
   *   THE BED PASS, WHICH IS SKIPPED. It is one call over the WHOLE sheet — it
   *   contests bed candidates against each other across rooms — so running it
   *   for one room would either re-do the sheet or produce a worse answer than
   *   the one already saved. `beds` therefore defaults to "only on a full run".
   *
   * AND THE MERGES MATTER MORE THAN THE FILTER. `setRoomTypes(found)` REPLACED
   * the map, which is invisible on a full run and wipes eight rooms' types on a
   * partial one. The accent and surface passes already merged; the classifier
   * now does too.
   */
  const runPipeline = useCallback(async (opts = {}) => {
    const { classify = true, accents = true, surfaces = true, relight = true,
            only = null } = opts;
    const { beds = !only } = opts;
    if (!source || !outlines.length) return;
    // The subset, as ids, narrowed to outlines that still exist.
    const ids = only ? outlines.filter((o) => only.includes(o.id)).map((o) => o.id) : null;
    if (ids && !ids.length) return;
    const inRun = (id) => !ids || ids.includes(id);

    /* THE STEP LIST AND THE ROOM STATES ARE BUILT BEFORE THE GATE, and they are
       up here rather than below it for one reason: the loading screen needs them
       and the loading screen now goes up first. Both are pure and cost nothing —
       a filter over a constant and a loop over the outlines already in hand. */
    const wanted = PREP_STEPS.filter((st) =>
      st.key === 'beds' ? (beds && !!bedSets)
      // The re-check needs the classification to know which spaces are bedrooms,
      // so it is listed only when both are running.
      : st.key === 'beds2' ? (beds && classify)
      : st.key === 'geometry' ? relight
      : st.key === 'types' ? classify
      : st.key === 'accents' ? accents
      : surfaces);
    const roomState = {};
    for (const o of outlines) if (inRun(o.id)) roomState[o.id] = 'idle';

    /* THE LOADING SCREEN GOES UP FIRST, AND THEN THE GATE. THIS IS A REVERSAL.
       The claim used to be the very first statement in this function, on the
       argument that everything below it spends money and a refusal should leave
       the tracer exactly as it was rather than show a progress dialog that dies
       on its first step. That is still the right instinct about the REFUSAL, and
       it is still honoured — the screen is torn down again below. What it got
       wrong is the WAIT.

       `claimSpaces` is a network round trip: the plan row has to have landed
       (`whenRowReady`) and then the till is asked over HTTP. That is a few
       hundred milliseconds on a warm function and a second or more on a cold
       one, and for the whole of it the old code painted nothing at all. The user
       had pressed the one button this screen exists for and the app looked
       broken — no press, no spinner, no dialog, just the tracer sitting there —
       so the honest reading of a second of silence is "it did not take the
       click", and the honest response to that is to press it again.

       IT IS NOT A FAKE STEP. Nothing in `wanted` is marked busy: every step is
       idle, the bar is at zero, and the phase says what is actually happening,
       which is that the spaces are being counted. The first real `paint()` below
       is what lights step one, so the checklist never claims work that has not
       started.

       `cancelPrep` IS RESET BEFORE THE SCREEN, not after the claim. The panel
       beside the loader offers "Stop and start over" the moment `prep` is
       truthy, so the flag it clears has to already be live by then; and a stale
       `true` left by a previous abandoned run would otherwise make step one bail
       on a run that was never cancelled. */
    cancelPrep.current = false;
    setPrep({
      phase: relight ? 'Checking your spaces' : 'Getting ready',
      detail: relight ? 'Counting what this run covers' : '',
      steps: wanted.map((st) => ({ ...st, state: 'idle' })),
      roomState, done: 0, total: 0,
    });

    // THE GATE. Everything past it spends something: three detectors, a room
    // classifier and an accent pass, two model calls at a time, across every
    // space on the sheet.
    //
    // ONLY WHEN THE LAYOUT IS ACTUALLY BEING (RE)BUILT. `runPipeline({ relight:
    // false })` is how the accent and surface passes are re-run over a layout
    // that already exists — the spaces were paid for when they were lit and
    // asking again would charge a second time for one dismissed accent.
    //
    // A REFUSAL PUTS THE SCREEN BACK DOWN. The paywall the claim raises is its
    // own dialog; leaving the loader up behind it would be a progress screen for
    // a run that is not going to happen.
    if (relight && !await claimSpaces(ids ?? outlines.map((o) => o.id))) {
      setPrep(null);
      return;
    }
    // A room that fails is skipped, not fatal — but a silent skip is how six
    // rooms quietly become four. Counted here and reported in the step's own
    // note, so a partial run says it was partial.
    const failed = { beds: 0, beds2: 0, types: 0, accents: 0, surfaces: 0 };
    const withFails = (text, n) => (n ? `${text} · ${n} space${n > 1 ? 's' : ''} failed` : text);
    // THE BED LIST AS IT STANDS, threaded through the run rather than read back
    // from state. Step 0 replaces it and step 2b adds to it, and neither can see
    // the other's setState — a React update is not visible until the next render
    // and this function does not get one.
    let bedsNow = detections;
    let steps = wanted.map((st, i) => ({ ...st, state: i === 0 ? 'busy' : 'idle' }));
    let done = 0, total = relight ? (ids ?? outlines).length : 0;
    /* `phase` AFTER `...prev`, AND `detail` BEFORE IT. The two are spread on
       opposite sides on purpose and the difference is which one is allowed to
       persist.

       `detail` is the sub-line, and most `paint()` calls do not pass one — a
       room going busy, a room going done. Defaulting it ahead of `...prev` means
       those calls keep whatever the last detail said instead of blanking the
       line under the heading on every tick.

       `phase` is the heading, and it is DERIVED: whichever step is busy. Spread
       ahead of `...prev` (which is where it was) the derivation ran and was then
       immediately overwritten by the previous render's value, so the heading
       froze on the first step of the run and stayed there while the checklist
       below it advanced — "Reading your geometry" over a plan three steps into
       its accents. Recomputed after `...prev` it tracks `stepTo`, and `...patch`
       still comes last so the final paint's explicit 'Ready' wins. */
    const paint = (patch = {}) => setPrep((prev) => ({
      detail: '', ...prev,
      phase: steps.find((x) => x.state === 'busy')?.label ?? 'Finishing',
      ...patch, steps: [...steps], roomState: { ...roomState },
      done, total,
    }));
    const stepTo = (key) => {
      const at = steps.findIndex((q) => q.key === key);
      if (at < 0) return false;
      steps = steps.map((st, i) => ({ ...st, state: i === at ? 'busy' : i < at ? 'done' : st.state }));
      return true;
    };
    const note = (key, text) => {
      steps = steps.map((st) => (st.key === key ? { ...st, note: text } : st));
    };
    paint({ detail: beds && bedSets ? 'Two readings of the beds' : relight ? 'Working out where the spaces are' : '' });

    // --- 0. the beds, decided BEFORE anything is laid out
    //
    // Room by room, because that is the unit the question makes sense in: a
    // whole-sheet A/B forces one detector to win every bedroom, and on a plan
    // where Roboflow nails one bed and GPT nails another there is no answer that
    // is right. Per room, each bed is judged against the other reading OF THAT
    // BED, in the same isolated crop the accent and task passes are shown.
    /* SKIPPED WHILE THE WHOLE-PLAN PASS IS OFF. `bedSets` is only ever set by
       that pass, so this whole step — the sheet-wide contest between the two
       vendors — is dormant by construction rather than by a flag. Switching the
       pass back on brings it back with it. */
    if (beds && bedSets) {
      stepTo('beds');
      const A = bedSets.roboflow || [], B = bedSets.openai || [];
      total += outlines.length;
      for (const o of outlines) roomState[o.id] = 'idle';
      paint({ detail: `${A.length} from Roboflow, ${B.length} from GPT` });

      // TWO AT A TIME, like the accent pass. Each contested room is a
      // high-detail two-image call and running eight of them at once is how a
      // rate limit turns into eight failures instead of one queue.
      const perRoom = await mapLimit(outlines, 2, async (o) => {
        if (cancelPrep.current) return null;
        const region = regionFromOutline(o, pxPerFt);
        const poly = region?.ok ? (useBoundingRect ? region.boundingRect : region.polygon) : null;
        const a = poly ? bedsIn(A, poly) : [];
        const b = poly ? bedsIn(B, poly) : [];

        roomState[o.id] = 'busy'; paint();
        const c = contestFor(a, b);
        let rec = { ...c, asked: false, confidence: 0 };

        if (c.ask) {
          paint({ detail: `Two readings of ${o.name || 'a space'}` });
          try {
            const out = await computeBedFit(o, a, b);
            rec = { kind: 'judged', asked: true, ...applyVerdict(a, b, out.verdict) };
          } catch (err) {
            // A judge that cannot be reached is not a reason to lose both
            // answers. applyVerdict with no verdict takes the documented
            // fallback and says it fell back, and the room is counted as failed
            // so the step's own note admits the run was partial.
            console.warn('[beds] the judge failed for', o.name, err);
            failed.beds++;
            rec = { kind: 'judged', asked: true, failed: true, ...applyVerdict(a, b, null) };
          }
        }
        roomState[o.id] = 'done'; done++; paint();
        return { id: o.id, name: o.name, a, b, rec };
      });
      if (cancelPrep.current) { setPrep(null); return; }

      const rows = perRoom.filter((r) => r && !r.error);
      const verdicts = {};
      const won = [];
      const claimed = new Set();
      for (const r of rows) {
        verdicts[r.id] = {
          kind: r.rec.kind, pick: r.rec.pick, asked: r.rec.asked,
          confidence: r.rec.confidence ?? 0, why: r.rec.why || '',
          fellBack: !!r.rec.fellBack, failed: !!r.rec.failed,
          counts: { roboflow: r.a.length, openai: r.b.length },
        };
        for (const d of [...r.a, ...r.b]) claimed.add(d.id);
        for (const d of (r.rec.winner || [])) won.push({ ...d, roomId: r.id, contest: r.rec.kind });
      }

      // BEDS IN NO TRACED ROOM. Nothing judged these — there was no room to
      // isolate and no ceiling for them to affect — so they keep the behaviour
      // they have always had: both readings merged, overlaps de-duplicated.
      // Dropping them instead would silently remove boxes the user can see on
      // the canvas today, on a plan where they simply have not drawn that room
      // yet.
      const loose = [...A, ...B].filter((d) => !claimed.has(d.id));
      for (const d of dedupe(loose)) won.push({ ...d, roomId: null, contest: 'unjudged' });

      bedsNow = won;
      setBedVerdicts(verdicts);
      // A DISMISSAL CANNOT SURVIVE THIS. The ids it holds are the merged set's
      // (`det-3-...`); the judged list's are the winning detector's
      // (`det-rf-0-...`), so a kept dismissal would silently apply to nothing —
      // a box the user struck out would come back with no way to tell that it
      // had. Cleared, so the list on screen is the list that was decided.
      setDismissed([]);
      setDetections(won);

      const asked = rows.filter((r) => r.rec.asked).length;
      const withBeds = rows.filter((r) => r.rec.kind !== 'none').length;
      // COUNTED IN ROOMS, not over the whole list: the loose ones belong to no
      // room and saying "4 beds in 2 rooms" when two of them are in neither is
      // a sentence that does not add up on the screen it is printed on.
      const inRooms = won.filter((d) => d.roomId).length;
      note('beds', withFails(
        `${inRooms} bed${inRooms === 1 ? '' : 's'} in ${withBeds} space${withBeds === 1 ? '' : 's'}`
        + (asked ? ` · ${asked} judged` : ' · none needed judging'), failed.beds));
      console.log('[beds] verdicts', verdicts);
    }

    if (relight) {
      // Not a model call: mark everything lit so the memo produces the ambient
      // layout the rest of this depends on. AFTER the beds, so it is computed
      // once with their zones in it rather than once without and once with.
      setOutlines((os) => os.map((o) => (inRun(o.id) ? { ...o, reviewed: true } : o)));
      // A UNION, NOT AN ASSIGNMENT. On a partial relight the spaces that were
      // already lit have to stay lit — assigning the subset here would blank the
      // rest of the sheet, which is the very thing this whole change exists to
      // stop happening.
      setLitIds((prev) => (ids
        ? [...prev, ...ids.filter((id) => !prev.includes(id))]
        : outlines.map((o) => o.id)));
      // NOTHING IS SELECTED TO BEGIN WITH. `focusId` used to be seeded with the
      // first outline, which was harmless while it only decided which room the
      // panel described — it now also draws a blue outline on the canvas, and a
      // space highlighted because it happens to be first is a selection nobody
      // made. `focus` still falls back to rooms[0] for the panel's own purposes,
      // so the details pane is unaffected.
      setFocusId(null);
      setPickingId(null);
      stepTo('geometry');
      paint({ detail: 'Working out where the spaces are' });
    }

    // --- 1. the ambient layout
    let list = [];
    for (let i = 0; i < 80 && !cancelPrep.current; i++) {
      list = (roomsRef.current || []).filter((r) => r.plan?.ok && inRun(r.id));
      if (list.length) break;
      await new Promise((res) => setTimeout(res, 60));
    }
    if (cancelPrep.current) { setPrep(null); return; }
    if (!list.length) {
      // Nothing laid out at all: there is no pipeline to run and the layout
      // screen will say why. Better to land there than to hold a loader over an
      // explanation the user needs to read.
      setPrep(null);
      return;
    }
    if (relight) {
      note('geometry', `${list.length} space${list.length > 1 ? 's' : ''}, `
        + `${list.reduce((n, r) => n + r.plan.lights.length, 0)} ambient lights`);
    }

    // --- 2. classify, unless we already know
    const shots = {};
    let types = roomTypes;
    if (classify) {
      stepTo('types');
      paint({ detail: `${PROJECT_BY_ID[projectId]?.label ?? 'Project'} — reading each space` });
      total += list.length;
      const found = {};
      await mapLimit(list, 3, async (r) => {
        if (cancelPrep.current) return null;
        roomState[r.id] = 'busy'; paint({ detail: `Reading ${r.outline.name || 'a room'}` });
        try {
          const out = await computeRoomType(r);
          // The crop is kept and reused by the next two passes. It is the same
          // picture of the same room, and building it three times is three
          // canvas renders and three JPEG encodes for one image.
          shots[r.id] = out.shot;
          found[r.id] = { type: out.type, confidence: out.confidence,
                          why: out.why, matched: out.matched };
        } catch (err) {
          console.warn('[types] failed for', r.outline.name, err);
          failed.types++;
          found[r.id] = { type: 'other', confidence: 0, why: 'could not be read', matched: false };
        }
        roomState[r.id] = 'done'; done++; paint();
        return null;
      });
      if (cancelPrep.current) { setPrep(null); return; }
      // MERGED, for the reason in this function's header: `found` covers only
      // the rooms in this run, and replacing the map would drop the type of
      // every room that was not.
      types = { ...roomTypes, ...found };
      setRoomTypes((m) => ({ ...m, ...found }));
      const named = (r) => roomTypeIn(projectId, found[r.id]?.type)?.label ?? 'unclassified';
      note('types', withFails(list.map((r) => named(r)).slice(0, 4).join(', ')
        + (list.length > 4 ? `, +${list.length - 4}` : ''), failed.types));
      console.log('[pipeline] room types', found);
    }

    // --- 2b. bedrooms with no bed in them
    //
    // A CONTRADICTION, NOT A RESULT. See refindBeds for why this happens on a
    // large plan and why it matters more than any other miss: a bed is the one
    // piece of furniture that changes the ceiling, and a missed one is a
    // downlight over somebody's face.
    //
    // Gated on `classify` because the question cannot be asked without the
    // answer to "what kind of space is this", and on `beds` so that a re-run
    // asking only for accents does not quietly spend a model call per room.
    if (beds && classify) {
      // ASKING CHATGPT IS THE EXCEPTION, NOT THE ROUTINE.
      //
      // The whole sheet goes to the `bed-filter` workflow on upload — one call,
      // one trained segmenter — and that is the primary path for every bed on
      // every plan. This step exists for ONE situation: the classifier has
      // called a space a BEDROOM and the whole-plan pass put no bed in it. A
      // declared bedroom with no bed is a contradiction between two answers we
      // already have, and the cheapest way to resolve it is to look at that one
      // room, on its own, at four times the resolution.
      //
      // ONE CALL PER SUCH ROOM, and only such rooms. Not two samples, not a
      // judge — see the header of refindBeds.
      //
      // NO PLAN-SIZE BRANCH. It used to re-ask every bedroom on a sheet over
      // LARGE_PLAN_SQFT, on the theory that a big sheet's hits are as likely to
      // be mis-attributed neighbours as real beds. That is two calls per bedroom
      // spent on rooms whose answer nobody doubted, and the size of the sheet is
      // a poor proxy for the thing actually being asked. The contradiction is
      // the trigger; nothing else is.
      const bedrooms = list.filter((r) => expectsBed(projectId, types[r.id]?.type));
      const isEmpty = (r) => {
        const poly = r.plan?.polygonPx ?? r.geo?.polygonPx;
        return poly ? bedsIn(bedsNow, poly).length === 0 : false;
      };
      const empty = bedrooms.filter(isEmpty);

      stepTo('beds2');
      total += empty.length;
      if (!empty.length) note('beds2', 'every bedroom already has a bed');
      // `inRun` FOR THE SAME REASON THE WORK LIST IS NARROWED: a partial run
      // must not paint a row for a space it is not touching. See the header.
      for (const o of outlines) if (inRun(o.id)) roomState[o.id] = empty.some((r) => r.id === o.id) ? 'idle' : 'done';
      paint({ detail: empty.length
        ? `${empty.length} bedroom${empty.length > 1 ? 's' : ''} with no bed — looking closer`
        : 'nothing to re-check' });

      // Two at a time, like the accent pass: eight at once is how a rate limit
      // turns into eight failures instead of one queue.
      const rows = await mapLimit(empty, 2, async (r) => {
        if (cancelPrep.current) return null;
        roomState[r.id] = 'busy';
        paint({ detail: `Looking again in ${r.outline.name || 'a bedroom'}` });
        try {
          const out = await refindBeds(r, { reuseShot: shots[r.id] });
          roomState[r.id] = 'done'; done++; paint();
          return { id: r.id, name: r.outline.name,
                   poly: r.plan?.polygonPx ?? r.geo?.polygonPx ?? null, ...out };
        } catch (err) {
          console.warn('[beds] failed for', r.outline.name, err);
          failed.beds2++;
          roomState[r.id] = 'done'; done++; paint();
          return null;
        }
      });
      if (cancelPrep.current) { setPrep(null); return; }

      // The same three rules the admin button applies — see absorbBedRows.
      const { found, verdicts } = absorbBedRows(rows, bedsNow);
      if (found.length) bedsNow = [...bedsNow, ...found];

      const stillEmpty = empty.length
        - rows.filter((x) => x && (x.rec.winner || []).length).length;
      if (empty.length) {
        note('beds2', withFails(
          `${found.length} bed${found.length === 1 ? '' : 's'} in ${empty.length} `
          + `bedroom${empty.length === 1 ? '' : 's'}`
          + (stillEmpty ? ` · ${stillEmpty} still empty` : ''), failed.beds2));
      }
      console.log(`[beds] ${empty.length} declared bedroom(s) had no bed after the`
        + ` whole-plan pass — asked GPT about each crop, added ${found.length}`, { verdicts });
    }

    const forAccents = list.filter((r) => wantsAccents(projectId, types[r.id]?.type));
    const forSpots = list.filter((r) => wantsSpots(projectId, types[r.id]?.type));

    // --- 3. accents, for the types entitled to them
    if (accents) {
      total += forAccents.length;
      stepTo('accents');
      if (!forAccents.length) note('accents', 'nothing in this plan takes accents');
      paint({ detail: forAccents.length
        ? `${forAccents.length} space${forAccents.length > 1 ? 's' : ''} qualify` : 'none' });
      for (const o of outlines) if (inRun(o.id)) roomState[o.id] = forAccents.some((r) => r.id === o.id) ? 'idle' : 'done';
      const got = {};
      await mapLimit(forAccents, 2, async (r) => {
        if (cancelPrep.current) return null;
        roomState[r.id] = 'busy'; paint({ detail: `Accents in ${r.outline.name || 'a room'}` });
        try {
          // `bedsNow` AND NOT `detections`. This step runs after 2b in the same
          // invocation, so the GPT crop's beds are in the local list but not yet
          // in React state — a bedroom bed-filter missed would otherwise get its
          // sconces from no bed at all. Same reason the bed list is threaded
          // through this function rather than read back: a setState is not
          // visible until the next render and this loop does not get one.
          const out = await computeAccents(r, { reuseShot: shots[r.id], beds: bedsNow });
          got[r.id] = out.result;
        } catch (err) { console.warn('[accents] failed for', r.outline.name, err); failed.accents++; }
        roomState[r.id] = 'done'; done++; paint();
        return null;
      });
      if (cancelPrep.current) { setPrep(null); return; }
      // A re-run REPLACES a room's fittings, so its dismissals go too — the ids
      // are positional and would otherwise strike out whatever takes that index
      // next.
      setAccentDismissed((d) => d.filter((x) =>
        !forAccents.some((r) => x.startsWith(`acc-${r.id}-`))));
      setAccentResults((m) => ({ ...m, ...got }));
      const fittings = Object.values(got)
        .reduce((n, a) => n + a.zones.filter((z) => !z.rejected).length, 0);
      if (forAccents.length) {
        note('accents', withFails(`${fittings} fitting${fittings === 1 ? '' : 's'}`, failed.accents));
      }
    }

    // --- 4. task surfaces, which is what the directional spots derive from
    if (surfaces) {
      total += forSpots.length;
      stepTo('spots');
      if (!forSpots.length) note('spots', 'nothing to aim at');
      for (const o of outlines) if (inRun(o.id)) roomState[o.id] = forSpots.some((r) => r.id === o.id) ? 'idle' : 'done';
      paint({ detail: forSpots.length ? 'Looking for task surfaces' : 'none' });
      const got = {};
      await mapLimit(forSpots, 2, async (r) => {
        if (cancelPrep.current) return null;
        roomState[r.id] = 'busy'; paint({ detail: `Task surfaces in ${r.outline.name || 'a room'}` });
        try {
          const out = await computeSurfaces(r, { reuseShot: shots[r.id] });
          got[r.id] = out.result;
        } catch (err) { console.warn('[surfaces] failed for', r.outline.name, err); failed.surfaces++; }
        roomState[r.id] = 'done'; done++; paint();
        return null;
      });
      if (cancelPrep.current) { setPrep(null); return; }
      setSurfaceDismissed((d) => d.filter((x) =>
        !forSpots.some((r) => x.startsWith(`surf-${r.id}-`))));
      setSurfaceResults((m) => ({ ...m, ...got }));
      const n = Object.values(got).reduce((acc, sr) => acc + sr.surfaces.length, 0);
      if (forSpots.length) note('spots', withFails(`${n} surface${n === 1 ? '' : 's'}`, failed.surfaces));
    }

    const anyFailed = failed.types + failed.accents + failed.surfaces + failed.beds2;
    steps = steps.map((st) => ({ ...st, state: 'done' }));
    paint({ phase: anyFailed ? 'Ready, with gaps' : 'Ready',
            detail: anyFailed
              ? `${anyFailed} space${anyFailed > 1 ? 's' : ''} could not be read — recompute from the panel`
              : '' });
    // A beat on "Ready" rather than a cut. The list of what was found is worth
    // half a second, and a loader that vanishes the instant it completes reads
    // as a glitch.
    await new Promise((res) => setTimeout(res, anyFailed ? 2200 : 550));
    setPrep(null);
    // WHAT THE RUN ANSWERED IS NO LONGER OUTSTANDING. A full run clears the list
    // outright; a partial one clears only the ids it was given, so a space
    // somebody moved WHILE this was running stays marked and is still offered.
    if (relight) setDirtyIds((d) => (ids ? d.filter((x) => !ids.includes(x)) : []));
    // ...AND THE TRACER GETS OUT OF THE WAY. A relight is the act of leaving the
    // outlines, so finishing one lands on the drawing it just built rather than
    // back on the screen the user pressed the button from.
    /* ...AND ON THE SPACES TAB, WHICH USED TO BE Design. Finishing a run means
       the spaces have been taken up; what somebody does next is go into one and
       say how high it is and what it is finished in — see AUTO_GRID. Design is
       the tab with nothing on it until a tool has been used. */
    if (relight) { setOutlinesOpen(false); setView('spaces'); }
    /* AND THE DESIGN SCREEN INTRODUCES ITSELF WHEN IT ARRIVES — but nothing
       about that is arranged here. The run used to raise the flag itself, which
       made a hint about the ceiling a property of HOW you got to the design
       rather than of being on it: a reload of the same plan, or "Back to the
       design" from the outlines, landed on the identical screen and said
       nothing. It is a fact about arriving, so it is watched for where arriving
       can be seen — see `landed` and the effect that raises it. */
    // A DESIGN NOW EXISTS. This is the moment worth a snapshot and a row in the
    // revision trail — the beat above is also what makes it safe, since React
    // has re-rendered by now and the milestone reads the finished state rather
    // than the state as it was when this function was called.
    milestone.current?.('design');
  }, [source, outlines, projectId, roomTypes, PREP_STEPS, pxPerFt, useBoundingRect,
      bedSets, detections, computeBedFit, computeRoomType, computeAccents, computeSurfaces,
      refindBeds, absorbBedRows, planAreaSqft, claimSpaces]);

  /** Stop the run where it is and land on whatever finished. */
  const stopPipeline = useCallback(() => {
    cancelPrep.current = true;
    setPrep(null);
  }, []);

  /**
   * The shapes the loader draws.
   *
   * Taken from the OUTLINES rather than from the computed rooms, so the loader
   * has something to draw the instant it opens — the layout it is waiting for
   * does not exist yet, and a loading screen that starts empty and fills in is
   * the thing it exists to avoid.
   */
  const loaderRooms = useMemo(() => outlinesPx.map((o) => {
    const b = bbox(o.pointsPx);
    return {
      id: o.id,
      points: o.pointsPx,
      centre: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
      label: roomTypes[o.id]
        ? (roomTypeIn(projectId, roomTypes[o.id].type)?.label ?? null)
        : (o.name || null),
      state: prep?.roomState?.[o.id] ?? 'idle',
    };
  }), [outlinesPx, prep, roomTypes, projectId]);

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

  /* --- WHY A DRAWN RUN IS NOT ON THE PLAN -----------------------------------
     A RUN THAT WAS REFUSED USED TO VANISH IN SILENCE, and that is the whole of
     what this fixes. Somebody clicks out a path in a bedroom, presses the
     button, and nothing appears — no track, no line, no message — which reads
     as the tool being broken rather than as the answer it actually is (the run
     reaches no fitting, or it crosses the fan). The path is still there, in
     `manualTracks`; what was missing was anybody saying so.

     ASKED PER ROOM AND ANSWERED ONCE. A run is offered to every space it
     crosses — see the drawn-track pass — so "it was refused" means every one of
     them refused it, and the reason to report is the most specific of theirs.
     A run over no lit space at all is refused by nobody, which is why `outside`
     is the answer when no room had an opinion.

     THE SAME FUNCTION THE LAYOUT USED. `drawnTrackRefusal` is what
     `planDrawnTrack` itself asks before building anything, so the sentence
     under the button cannot describe a refusal that did not happen. */
  const trackNotes = useMemo(() => {
    if (!pxPerFt || !manualTracks.length) return [];
    const placed = new Set(rooms.flatMap((r) => (r.tracks ?? []).map((t) => t.key)));
    // MOST SPECIFIC WINS. "It crosses the fan" is something to act on; "it is
    // not over a lit space" is the answer of a room that never saw it.
    const RANK = { fan: 3, reach: 2, short: 1, outside: 0 };
    const out = [];
    for (const mt of manualTracks) {
      if (placed.has(mt.id)) continue;
      let why = 'outside';
      for (const r of rooms) {
        if (!r.geo || !r.plan?.ok) continue;
        const pts = mt.ptsFt.map((q) => r.geo.toFt({ x: q.x * pxPerFt, y: q.y * pxPerFt }));
        // ONLY A ROOM THE RUN ACTUALLY REACHES HAS AN OPINION WORTH HAVING.
        // Every other room would say `reach` about a path nowhere near it,
        // which is true and useless.
        if (!pts.some((q) => pointInPolygon(q, r.geo.polygonFt))) continue;
        const got = drawnTrackRefusal(pts, r.plan.lights ?? [], opt,
                                      { polygon: r.geo.polygonFt,
                                        keepOff: r.geo.zonesFt,
                                        obstacles: r.geo.fixturesFt },
                                      { closed: !!mt.closed });
        if (got && RANK[got] > RANK[why]) why = got;
      }
      out.push({ id: mt.id, why });
    }
    return out;
  }, [pxPerFt, manualTracks, rooms, opt]);

  /* THE REFUSALS, ONE LINE PER REASON. Three runs refused for the same reason
     is one sentence and a count, not three identical sentences — and two runs
     refused for two different reasons are two lines, because the thing to do
     about each is different. */
  const trackNoteLines = useMemo(() => {
    const by = {};
    for (const n of trackNotes) by[n.why] = (by[n.why] ?? 0) + 1;
    return Object.entries(by).map(([why, n]) => ({ why, n, text: TRACK_REFUSALS[why] }));
  }, [trackNotes]);

  /* WHAT THIS STEP HAS PUT ON THE PLAN, AND HOW TO TAKE IT BACK. Two tools, two
     lists, one readout — kept as a table rather than as a pair of ternaries in
     the markup, because the noun and the list it counts have to stay together:
     a spot's drag makes a task SURFACE (the fitting is placed off it, see the
     spot branch in `onZoneUp`) and a cove's drag makes a cove, and reading
     the wrong one would report a plausible number that is about something
     else. The next tool to earn a step adds a row here or renders no count. */
  const PLACED = {
    cove:  { n: manualCoves.length, one: 'cove', many: 'coves',
             clear: () => setManualCoves([]) },
    track: { n: manualTracks.length, one: 'run', many: 'runs',
             // AND THE EDITOR GOES WITH THEM. It is open on one of these paths
             // by id, and clearing the list would leave it holding an id that
             // no longer names anything.
             clear: () => { setManualTracks([]); closeTrackEdit(); } },
  };
  const placedHere = PLACED[stepTool?.id]
    ?? { n: manualSurfaces.length, one: 'spot', many: 'spots',
         clear: () => setManualSurfaces([]) };

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
      setLayers((l) => (l.invert ? l : { ...l, invert: true }));
    }
    hadLights.current = restoreApplied ? lit : null;
  }, [litIds, restoreApplied]);
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
    setView((v) => (v === 'boq' || v === 'boards' ? 'design' : v));
    return true;
  };

  /** ...and the way back, which is the same flag and no questions either. */
  const backToDesign = () => { setOutlinesOpen(false); setView('design'); };


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

  /* --- HAND-PLACED COBs, IN THE SPACE THE CANVAS DRAWS IN --------------------
     THE STORE IS FEET AND EVERY READER WANTS PIXELS, so the conversion happens
     once, here, rather than in the four places that draw, count and hit-test
     them. It is the same shape `trackEditPx` and `penDraftPx` take, and the same
     multiplication: plan feet are plan pixels over `pxPerFt` with no origin to
     subtract, because unlike a room's own feet they are measured from the
     sheet's corner. */
  const manualCobsPx = useMemo(() => (pxPerFt > 0
    ? manualCobs.map((c) => ({
        ...c, x: c.xFt * pxPerFt, y: c.yFt * pxPerFt,
        /* WHAT THIS LAMP THROWS, AS A DIAMETER IN FEET. Computed here rather
           than on the canvas because it takes the SPACE's ceiling height, and
           the canvas is handed one flat list of fittings rather than a list per
           room. It is a real number for once: every other pool on this sheet is
           read out of THROW_STYLE's three stated diameters, which were worked
           out on a 9 ft assumption because the app had no height when they were
           written. A hand-placed lamp states its own beam angle and sits in a
           space with its own recorded height, so its pool is computed from both.
           See throwDiameterFt. */
        throwFt: throwDiameterFt(c.beam,
          (ceilingMmFor(c.roomId) / 304.8) || DEFAULT_DROP_FT),
      }))
    : []), [manualCobs, pxPerFt, ceilingMmFor]);

  /* --- LINING ONE LAMP UP WITH ANOTHER ---------------------------------------
     THE LAMPS SOMEBODY HAS ALREADY PLACED, AS ALIGNMENT TARGETS, and nothing
     else. The rest of this screen snaps to the drawing — walls, room centres,
     the objects on the ceiling — through `snapTargets`, and that is right for a
     fitting whose position is about the ROOM. A row of hand-placed downlights is
     about ITSELF: the thing that has to be true is that the fourth one is level
     with the other three, and a wall three feet away pulling it off that line
     would be the drawing overruling the row.

     THE SPAN RUNS FROM THE LAMP TO THE POINTER, which is why these are built
     here instead of through `collectTargets`. That helper spans an object by its
     own radius — a two-inch tick beside a downlight — and what says "these two
     are in line" is the line BETWEEN them. Same construction the pen's own point
     targets use, with the far end filled in.

     IT SNAPS AS WELL AS DRAWING, and that is not a contradiction of the "no
     clamp" rule in lib/cob.js. That rule is about the ENGINE: the wall band and
     the bed are the layout's opinions, and a tool built to overrule the layout
     must not be stopped by them. This is not an opinion about where the lamp
     ought to go — it is the difference between a row that is straight and one
     that is seven pixels out, which nobody can hit by hand and everybody wants.
     The tolerance is the app's own, in SCREEN pixels, so it does not stiffen as
     you zoom in to place carefully. */
  const cobTargets = useCallback((p, exclude = null) => {
    const skip = exclude == null ? null
      : exclude instanceof Set ? exclude
      : new Set(Array.isArray(exclude) ? exclude : [exclude]);
    const out = [];
    for (const c of manualCobsPx) {
      /* A LAMP CANNOT BE ASKED TO LINE UP WITH ITSELF — the same guard
         `collectTargets` states for a dragged object, and without it a drag
         locks solid the moment it starts: the thing under the pointer is within
         nought pixels of its own centre on both axes. */
      if (skip && skip.has(c.id)) continue;
      out.push({ axis: 'x', value: c.x, span: [Math.min(c.y, p.y), Math.max(c.y, p.y)],
                 kind: 'object-centre', label: 'aligned' });
      out.push({ axis: 'y', value: c.y, span: [Math.min(c.x, p.x), Math.max(c.x, p.x)],
                 kind: 'object-centre', label: 'aligned' });
    }
    return out;
  }, [manualCobsPx]);

  /** Where a COB would land, with the guides that say why. One function, called
   *  by the hover and by the click, so the indicator cannot promise a point the
   *  press does not take. */
  const cobSnap = useCallback((p, exclude = null) =>
    snapPoint(p, cobTargets(p, exclude),
      { tol: SNAP_DEFAULTS.tolScreenPx / (zoom || 1) }),
    [cobTargets, zoom]);

  /**
   * WHERE A LAMP BEING DRAGGED WANTS TO BE, with Shift holding it to one axis.
   *
   * DELIBERATELY `moveTargetPx` FOR DOWNLIGHTS, and it is the same three rules
   * said about a different store — read that one first if this is unfamiliar.
   *
   *   THE LINE IS MEASURED FROM THE PRESS, not from the last frame. Frame to
   *   frame the constraint creeps: each frame is straight relative to the one
   *   before it and the path as a whole bends. From the anchor, a locked drag is
   *   on the same line however long it goes on — and for a COPY that anchor is
   *   the ORIGINAL, so Option+Shift leaves the twin exactly level with the lamp
   *   it came from, which is the gesture that lays out a row.
   *
   *   WHICHEVER AXIS HAS TRAVELLED FURTHER WINS, re-decided every frame rather
   *   than latched on the first pixel: a drag that starts off sideways and turns
   *   into a vertical one switches over as it crosses the diagonal, which is
   *   what every other tool with this modifier does.
   *
   *   THE FROZEN AXIS TAKES NO SNAP AND DRAWS NO GUIDE. A guide is a claim that
   *   the point took an alignment, and one drawn for an axis that was held still
   *   by a modifier would be claiming credit for the modifier's work.
   *
   * WHAT IT SNAPS TO IS THE OTHER PLACED LAMPS AND NOTHING ELSE — the same
   * targets the placing gesture uses, so "level with that one" means one thing
   * whether you are putting a lamp down or moving it afterwards.
   */
  const cobMoveTarget = useCallback((p, drag, shift, exclude) => {
    /* THE THREE STEPS, IN THIS ORDER, AND THE ORDER IS LOAD-BEARING.
       The lock is applied FIRST and the snap SECOND: snapping first would let a
       lamp four feet away pull the point off the line the modifier had just held
       it to, and the row would come out crooked with the lock silently undone.
       Then the frozen axis is dropped from both the snap's result and its guides
       — see `orthoLock` for why a guide on a held axis is a false claim. */
    const { at, axis } = orthoLock(wantedCentre(p, drag.grabPx), drag.start, shift);
    const sn = cobSnap(at, exclude);
    setGuides(sn.guides.filter((g) => g.axis !== axis));
    return { x: axis === 'x' ? at.x : sn.x, y: axis === 'y' ? at.y : sn.y };
  }, [cobSnap]);

  /* --- WHAT THE NEXT COB WILL BE --------------------------------------------
     FOUR ANSWERS STACKED, MOST SPECIFIC FIRST, and the stack IS the feature:

       the draft       what the bar is showing while somebody drags the slider.
                       It governs nothing — see the note on `cobDraft` — so it is
                       deliberately absent from `inForce` below.
       "this one"      a one-shot, spent by the next click.
       "all next"      a standing override, until the Recommended chip clears it.
       the engine      what the gridding engine would have installed in the cell
                       under the pointer. See recommendCob in lib/cob.js.

     `recommended` IS TRUE ONLY WHEN THE ENGINE IS ANSWERING, which is what the
     chip on the bar latches on. A one-shot in flight is not a recommendation
     even though nothing has been placed with it yet. */
  const cobRoom = useMemo(() => (cobAt ? roomAt(cobAt) : null), [cobAt, roomAt]);
  /* WHAT THE RULE NEEDS THAT IS NOT IN THE CELL.
     A CALLBACK AND NOT A MEMO OVER THE HOVERED ROOM, because THREE callers need
     it now and they are asking about different rooms. The bar asks about
     whichever space the pointer is over; the press asks about the space it
     actually landed in, resolved afresh at that moment; and autoplace asks about
     whichever space's toggle was switched. One function, so the three can never
     come to disagree — which matters more here than anywhere, because a
     recommendation that differed from what the toggle beside it places would be
     this app holding two opinions about one hole in one ceiling. */
  const cobEngine = useMemo(
    () => recommendCob(cobRoom, cobAt, cobBasisFor(cobRoom)),
    [cobRoom, cobAt, cobBasisFor]);

  /* --- WHY THE BAR SAYS WHAT IT SAYS, IN THE CONSOLE -------------------------
     ONE LINE, ONLY WHEN THE ANSWER CHANGES, and it earns its place: the 7 W
     bathroom was reported twice before it could be pinned down, because the
     three things that decide the answer — which space the pointer is in, what
     TYPE that space is, and whether the cell under it has a light — are all
     invisible on screen. A space nobody has classified is not a bathroom to this
     app however obviously it is one on the drawing, and that is the single most
     likely reason a recommendation looks wrong. `from` names which branch
     answered; see recommendCob.
     THROTTLED BY THE ANSWER AND NOT BY TIME. A pointer move fires this handler
     forty times a second and the answer changes perhaps twice a minute, so
     logging every move would bury the drawing's own diagnostics. */
  const cobLog = useRef('');
  useEffect(() => {
    if (addTool !== 'cob') { cobLog.current = ''; return; }
    /* THE CELL IS WHAT THE ANSWER IS ABOUT, so the cell is what the line
       prints: its size is the whole of the wattage and its short side is the
       whole of the optic (see `autoSpec`), and a figure that looks wrong is
       almost always a cell that is not the size anybody expected. The room's
       TYPE stays on the line even though the rule no longer reads it — it is
       still what decides the cell's target area upstream, in the chunker. */
    const c = cobEngine.cell;
    const line = `[cob] ${cobRoom?.outline?.name ?? 'no space'}`
      + ` · type ${roomTypes[cobRoom?.id]?.type ?? 'UNSET'}`
      + (c ? ` · cell ${c.w.toFixed(1)}×${c.h.toFixed(1)} ft (chunk ${c.chunk})` : '')
      + ` · ${cobEngine.watts}W ${cobEngine.beam}°`
      + ` (${cobEngine.from})`;
    if (line === cobLog.current) return;
    cobLog.current = line;
    console.log(line);
  }, [addTool, cobRoom, roomTypes, cobEngine]);
  const cobInForce = cobOnce ?? cobStanding ?? cobEngine;
  const cobShow = cobDraft ?? cobInForce;
  /* A DRAFT THAT AGREES WITH WHAT IS ALREADY IN FORCE IS NOT A CHANGE. Dragging
     the slider away and back must put the two buttons away again, or the bar
     would be asking somebody to confirm a decision they had just undone. */
  const cobDirty = !!cobDraft
    && (cobDraft.watts !== cobInForce.watts || cobDraft.beam !== cobInForce.beam);

  /* --- THE TWO THINGS WORTH SAYING BEFORE THE CLICK -------------------------
     AND NEITHER OF THEM STOPS IT. See the header of lib/cob.js: this whole tool
     exists because the engine's answer is sometimes the wrong one, and a guide
     that refused the press would be the engine winning the argument anyway, in a
     quieter voice.
     NULL WHERE THERE IS NOTHING TO SAY, so the canvas draws the ordinary case —
     which is most of the ceiling — with no extra marks on it at all. */
  const cobGuide = useMemo(() => {
    if (!cobRoom || !cobAt || !(pxPerFt > 0)) return null;
    const polygonPx = cobRoom.plan?.polygonPx || cobRoom.geo?.polygonPx;
    const near = wallClearance(cobAt, polygonPx, pxPerFt);
    const bed = bedUnder(cobAt, cobRoom.plan?.zonesPx ?? []);
    if (!near && !bed) return null;
    return { polygonPx, bandPx: near ? near.limitFt * pxPerFt : 0, bed };
  }, [cobRoom, cobAt, pxPerFt]);

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
    /* THE COB BAR AND THE HALF-MADE CHANGE ON IT. `cobAt` is the point the bar
       was answering for, so it has to go with the tool; `cobDraft` is a slider
       position nobody committed and `cobOnce` was aimed at a lamp that is no
       longer about to be placed.
       `cobStanding` DELIBERATELY SURVIVES. "Update all next" is a standing
       decision about this session's fittings, not about this arming of the tool
       — somebody who sets 24 W, places four, reaches for the strip tool and
       comes back is still placing 24 W lamps, and having to say so again would
       make the button mean "update the next few". The card says which is in
       force every time it opens, so nothing is hidden. */
    setCobAt(null); setCobDraft(null); setCobOnce(null);
    setCobRun([]); setCobLock(null);
    /* THE ARRAY BEING SET UP GOES WITH THE TOOL. It is a geometry picked and a
       count half-typed — a gesture, not a record — and one left behind would
       reappear over a different plan the next time the tool was armed. The
       arrays already PLACED are untouched: those are fittings. */
    setCobDraftArray(null);
    /* AND THE GEOMETRY HIGHLIGHT, which belongs to the tool that was offering to
       take it. A lit stroke under no tool is a line claiming a press that would
       now do something else entirely. */
    setGeomHover(null);
    /* AND THE ARMED MODULE. The DRAWER itself stays up as long as a run is
       selected — it is what says which fittings that run can take — and its
       cells simply unlatch because nothing is armed any more. */
    setTrackMode(null);
    // A HALF-CLICKED RUN IS NOT A TRACK. Putting the tool away throws the path
    // away with it, exactly as `abandonShape` does for the cove pen: the
    // alternative is a set of points with no tool armed to finish them.
    trackPen.reset(); setGuides([]);
  }, [trackPen]);

  /* --- FINISHING A DRAWN TRACK ------------------------------------------------
     A RUN ENDS WHEN SOMEBODY SAYS IT DOES, and that is the one way the track pen
     differs from the cove pen as a GESTURE rather than as a setting. A cove
     path closes on its own first point, so the last click both places a point
     and says "done"; an open run has no such click to borrow — the point you
     want last looks exactly like a point in the middle — so there has to be a
     separate act. There are three of them, all saying the same thing: Enter, a
     double-click, and the button on the step. Three ways in because a pen is
     held with one hand and the mouse is the other, and which one is free
     depends on where in the path you are.

     THE TOOL STAYS ARMED. Finishing a run is not finishing with the tool, for
     the reason the step gives generally: this panel is the screen while it is
     open, and a tool that put itself away after one run would empty and refill
     the screen under somebody who was drawing three.

     TWO POINTS IS THE MINIMUM AND IT IS NOT ARBITRARY. One point is a click, not
     a run — and `penSegments` drops anything shorter than a few inches, so a
     path of two points a hair apart finishes as nothing at all rather than as a
     profile of no length. */
  const finishTrack = useCallback((closed = false) => {
    // THE GUIDES GO WITH THE GESTURE. They are momentary by definition — see
    // the note over them in PlanCanvas — and a dotted line left on the sheet
    // after the run is finished is a drawn line, which is the one thing they
    // must never become.
    setGuides([]);
    const segs = penSegments(trackPen.pts, { minFt: MIN_SEG_FT, closed });
    if (!segs.length) { trackPen.reset(); return; }
    /* THE MERGED PATH AND NOT THE CLICKS. `penSegments` has already thrown away
       the doubled points and joined the two halves of a leg drawn in two goes,
       so this is the run as it will be BUILT rather than as it was drawn.
       A CLOSED PATH KEEPS ITS POINTS AND NOT ITS LAST SEGMENT. `penSegments`
       was given the closing leg so it could merge across the join — a rectangle
       whose first and last legs are collinear is one leg — and the stored path
       is the corners alone, with `closed` saying the leg back exists. Storing
       the repeat of the first point would make it a corner in its own right. */
    const pts = closed ? segs.map((sg) => sg.a) : [segs[0].a, ...segs.map((sg) => sg.b)];
    setManualTracks((l) => [...l, {
      id: `mtrack-${Date.now().toString(36)}-${l.length}`,
      ptsFt: pts, closed,
      lengthFt: penLengthFt(pts, { closed }),
    }]);
    trackPen.reset();
  }, [trackPen]);

  /* --- DRAWING A COVE ---------------------------------------------------------
     THE SAME SHAPE AS THE OTHER STEPS ON THIS SCREEN — it owns the pointer, it
     stays open across placements, and it puts every other gesture away on the
     way in — with one difference that is worth naming rather than discovering:
     its controls are on the DRAWING and not in the panel. See ShapeMenu for why.

     `abandonShape` IS THE HALF-MADE GESTURE AND NOTHING ELSE. Closing the whole
     tool has to forget the draft too, so `closeShapeTool` calls it; the cross in
     the bar calls only this, because throwing a shape away is not the same act
     as putting the pen down. */
  const abandonShape = useCallback(() => {
    setShapeSpan(null); covePen.reset(); setShapeAt(null); setShapeHeld(null);
    // AND THE BORROWED SOURCE WITH IT. It exists for the length of one held
    // draft; left behind, the offset control would appear over a shape dragged
    // out from scratch and offer to set it in from a geometry it never came from.
    setHeldSrc(null);
    setShapeAskSides(false); setGuides([]);
  }, [covePen]);

  const closeShapeTool = useCallback(() => {
    setShapeMenuOn(false); setShapeTool(null); setShapeDrag(null);
    // ...AND THE GEOMETRY IT WAS OFFERING TO TAKE. See `geomHover`.
    setGeomHover(null);
    abandonShape();
  }, [abandonShape]);

  /** ...and the grips, which belong to a shape rather than to the tool. Taken
   *  off wherever the drawing is about to be about something else. */
  const clearShapeEdit = useCallback(() => {
    setShapeEditId(null); setShapeResize(null);
  }, []);

  const openShapeTool = useCallback((role = 'cove', { arm = true } = {}) => {
    /* THREE ROLES NOW, AND THE LIST IS NOT WRITTEN OUT HERE. It was
       `role === 'guide' ? 'guide' : 'cove'`, which silently turned every role it
       had not heard of into a cove — so opening the bar for a magnetic track
       committed a pocket. `roleOf` is the one place that knows the roles; asking
       it means a fourth one is a change to that file and not to this line. */
    setShapeRole(shapeRoleOf({ role }));
    /* ARMED ON THE RECTANGLE, NOT ON NOTHING. Opening with no primitive picked
       was a bar that looked ready and answered no press — you had to notice
       that one more click was owed before the drawing would respond, which is
       the kind of step nobody sees until they have already tried. The rectangle
       is the default for the reason it is first in the row: it is the one
       everybody reaches for, and picking any other is one press either way.

       ...UNLESS NOBODY ASKED TO DRAW, WHICH IS THE ONE EXEMPTION AND IT MATTERS.
       The bar also arrives as a consequence of clicking a space — see
       `onCanvasClick` — and that click was about the SPACE. Arming a placer on
       it would give one press two meanings and the second one would bite
       immediately: click a room to select it, click the room next door to select
       THAT, and instead of a selection you would have dragged out a rectangle.
       So the bar opens showing its primitives with none of them live, and the
       press that arms one is a press somebody made for that purpose. */
    setShapeMenuOn(true); setShapeTool(arm ? 'rect' : null);
    abandonShape();
    /* AND THE ARRAY'S BAR GOES, ARMED OR NOT. This one is above the `!arm`
       return on purpose: the unarmed bar is what a click on a space raises, and
       it lands in exactly the place the array's bar is standing — see
       `openArray` for why one is the limit. Nothing else in the takeover below
       has to happen for an unarmed bar, but this does. */
    setSel(clear());
    /* THE TAKEOVER BELOW BELONGS TO ARMING AND NOT TO OPENING, which is why it
       stops here when nothing was armed. Everything under this line exists to
       make this tool the sole owner of the next press; a bar showing six
       primitives with none of them live owns no press at all, and putting away
       somebody's zone editor or their half-placed switchboard because they
       clicked a room would be a click with two meanings — the very thing the
       note below is about. */
    if (!arm) return;
    clearShapeEdit();
    /* ONE POINTER PIPELINE, ONE OWNER — the same clearing `openZoneEdit` and
       `openBoardPlace` do. A press with two tools armed is a press with two
       meanings, and this one draws across the whole ceiling rather than at a
       point, so it is the least forgiving of the three about sharing. */
    setZoneEdit(false); setZoneMode(false); setDraftZone(null);
    setDoorEdit(false); setDoorDraft(null); setDoorDrag(null);
    setBoardPlace(false);
    setArmed(null); setGhost(null); setGuides([]);
    disarmAdd();
  }, [abandonShape, disarmAdd, clearShapeEdit]);

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
    setZoneEdit(false); setBoardPlace(false); closeShapeTool();
    setDoorDraft(null); setDoorDrag(null);
    setZoneMode(false); setDraftZone(null);
    setArmed(null); setGhost(null); setGuides([]);
    disarmAdd();
  }, [disarmAdd, closeShapeTool]);

  /* --- REMOVING A SWITCHBOARD ------------------------------------------------
     THE ONLY EDIT THERE IS ON A BOARD, and that is not a gap in the feature —
     it is what a derived fitting can be. A plate's position is a rule: 300mm
     past the latch jamb, at the sconce, 300mm outboard of the bed. Dragging one
     would put it somewhere no rule says, and the drawing would then be claiming
     a switch position nobody can account for. What a person genuinely knows
     better than the rule is whether the switch is WANTED — see the note on the
     facing-wall rule in electrical.js for why two plates are placed and then
     offered up for deletion rather than hunted for and sometimes missed.

     BY ID INTO `boardsOff`, not by removing anything: the boards are a memo, so
     a plate taken out of the list is back on the next render. Same machinery as
     a dismissed accent. */
  const boardPointerDown = (e, id, roomId) => {
    if (e.button != null && e.button !== 0) return;   // middle button is the pan
    // A TOOL IN HAND WINS. Somebody placing a fitting or boxing a zone across a
    // plate is aiming at the drawing, not at the switch in the way — the same
    // rule every other selectable thing on this canvas follows.
    if (addTool || zoneMode || armed) return;
    e.preventDefault();
    // ONE SELECTION ON THIS CANVAS. A plate and a fitting both picked would be
    // two things Delete could mean.
    setSel(select('board', id));
    /* AND THE PANEL COMES WITH IT. Selecting a plate puts its composition in the
       panel — see the Switchboard section — and that section lives in the Design
       tab, so a click made from the BOQ or the spaces list would otherwise open
       a card on a surface nobody can see. The tab follows the selection because
       the selection is what the tab is now about.
       NOT FROM `admin`, WHICH IS NOT A STEP IN THIS WORK. It is a different
       audience's tab and yanking an operator out of it because they clicked the
       drawing would lose whatever they were reading. */
    setView((v) => (v === 'admin' ? v : 'design'));
    /* AND THE DRAG IS ARMED BUT NOT LIVE. `live` turns on once the pointer has
       moved past a few pixels — the accent runs' own slop, and for the same
       reason: without it a click that wobbles one pixel writes a hand position
       onto a board that was exactly where the rule put it, and the plate is
       then marked "moved by hand" for the life of the plan. */
    if (roomId) {
      svgRef.current?.setPointerCapture?.(e.pointerId);
      setBoardDrag({ id, roomId, origin: svgPoint(e), live: false });
    }
  };

  /**
   * A PLATE FOLLOWS THE POINTER ROUND THE WALLS OF ITS OWN SPACE.
   *
   * `slideBoardTo` is the whole of it: the pointer is projected onto every wall
   * of that room that can hold a plate and the nearest wins, so the gesture is
   * "which piece of plaster do you mean" rather than "drag this rectangle
   * wherever". A switchboard off its wall is not a thing.
   *
   * WRITTEN STRAIGHT INTO `boardMoves`, ON EVERY MOVE, and that is deliberate
   * rather than lazy. The chain it re-runs — the board rules, the bay boards,
   * the flows — is pure geometry over a handful of objects and does NOT reach
   * the planner, so the layout is not recomputed; and the alternative (a live
   * position held in the drag and committed on release) would leave the wires
   * hanging off the plate's old position for the whole gesture. The derived
   * cove's end-drag already writes its trim per move for the same reason.
   */
  const boardPointerMove = (e) => {
    if (!boardDrag) return;
    const p = svgPoint(e);
    if (!boardDrag.live) {
      const slop = Math.max(3, (pxPerFt || 12) * 0.12);
      if (Math.hypot(p.x - boardDrag.origin.x, p.y - boardDrag.origin.y) < slop) return;
      setBoardDrag((d) => (d ? { ...d, live: true } : d));
    }
    const r = rooms.find((q) => q.id === boardDrag.roomId);
    const poly = r?.plan?.polygonPx;
    if (!poly?.length) return;
    const sFt = slideBoardTo(p, { polygonPx: poly, pxPerFt });
    if (sFt == null) return;
    /* A HAND-PLACED PLATE HAS ONE POSITION AND IT IS THIS ONE. `boardMoves` is
       an OVERRIDE — it exists so a rule's board can be somewhere the rule did
       not put it, and so the card can say both. A board somebody dropped on a
       wall has no rule behind it, so writing a move for one would be storing
       "moved from" a position that was itself a hand position: two records of
       one fact, and a plate that could be reset to a place nobody chose. */
    if (manualBoards.some((m) => m.id === boardDrag.id)) {
      setManualBoards((list) => list.map((m) => (
        m.id === boardDrag.id ? { ...m, sFt } : m)));
      return;
    }
    setBoardMoves((m) => ({ ...m, [boardDrag.id]: sFt }));
  };

  const boardPointerUp = () => {
    if (!boardDrag) return;
    setBoardDrag(null);
  };

  /* --- A WIRE, PICKED ------------------------------------------------------
     ONE PRESS SELECTS THE WHOLE LOOP. A flow is one switch — its legs are how
     that switch reaches its lamps — so picking "the third arc" would be picking
     a piece of drawing rather than a piece of the design. The grips then appear
     on every leg, which is what makes "adjust any one of them" possible without
     a leg ever being a selectable object of its own. */
  const flowPointerDown = (e, id) => {
    if (e.button != null && e.button !== 0) return;
    // A TOOL IN HAND WINS, exactly as it does for a plate: somebody placing a
    // fitting across a wire is aiming at the drawing, not at the wire.
    if (addTool || zoneMode || armed) return;
    e.preventDefault();
    // ONE SELECTION ON THIS CANVAS.
    setSel(select('flow', id));
  };

  /**
   * AND THEN A GRIP ON IT — the end at the plate, or one leg's own bow.
   *
   * THE POINTER IS CAPTURED HERE AND THE WORK HAPPENS IN THE MOVE, which is the
   * same shape every other drag on this canvas has. `live` turns on once the
   * pointer has gone past a few pixels, for the reason the board drag gives: a
   * click that wobbles writes a hand value onto something that was exactly where
   * the rule put it, and the wire is then marked as moved for the life of the
   * plan.
   */
  const flowGripDown = (e, id, kind, key) => {
    if (e.button != null && e.button !== 0) return;
    if (addTool || zoneMode || armed) return;
    e.preventDefault();
    setSel(select('flow', id));
    svgRef.current?.setPointerCapture?.(e.pointerId);
    const p = svgPoint(e);
    setFlowDrag({ id, kind, key, origin: p, at: p, live: false, overId: null });
  };

  const flowPointerMove = (e) => {
    if (!flowDrag) return;
    const p = svgPoint(e);
    if (!flowDrag.live) {
      const slop = Math.max(3, (pxPerFt || 12) * 0.12);
      if (Math.hypot(p.x - flowDrag.origin.x, p.y - flowDrag.origin.y) < slop) return;
      setFlowDrag((d) => (d ? { ...d, live: true } : d));
    }
    const flow = flowsPx.find((f) => f.id === flowDrag.id);
    if (!flow) return;

    if (flowDrag.kind === 'board') {
      /* NOTHING IS COMMITTED UNTIL THE DROP. The end is carried — `at` for the
         rubber band, `overId` for the ring round the plate it would land on —
         and `flowBoards` is written once, on release. Writing per move would
         re-order the loop, re-compose two switchboards and repaint the panel on
         every frame; a board SLIDE writes per move precisely because it does
         none of those things. */
      const over = boardUnder(p, allBoardsPx, { pxPerFt });
      setFlowDrag((d) => (d ? { ...d, at: p, overId: over?.id ?? null } : d));
      return;
    }

    /* A BEND IS THE PERPENDICULAR DISTANCE FROM THE LEG'S OWN CHORD, minus what
       the rule already bows it by — so what is stored is the DELTA the hand
       added and a leg's own length still drives the rest. In feet, like every
       other stored hand position in this file.

       AGAINST THE LEG AS IT IS DRAWN RIGHT NOW, which includes the bend applied
       so far. That is what makes the grip track the pointer instead of doubling
       its movement: `base` is the rule's bow and the pointer's offset from the
       chord IS the new total, so the delta is one subtraction and not an
       accumulation. */
    const leg = [...(flow.legs ?? []), ...(flow.also?.legs ?? [])]
      .find((l) => l.key === flowDrag.key);
    if (!leg || !(pxPerFt > 0)) return;
    const off = (p.x - leg.mid.x) * leg.normal.x + (p.y - leg.mid.y) * leg.normal.y;
    const bendFt = (off - leg.base) / pxPerFt;
    setFlowBends((m) => ({
      ...m, [flowDrag.id]: { ...(m[flowDrag.id] ?? {}), [flowDrag.key]: bendFt },
    }));
  };

  const flowPointerUp = () => {
    if (!flowDrag) return;
    /* THE DROP IS THE COMMIT, for a board drag. A release over nothing is a
       gesture abandoned and leaves the wire where it was — NOT an un-assignment,
       because "let go over empty floor" is what a person does when they change
       their mind, and reading it as "disconnect this" would lose the plate they
       had picked deliberately last week.
       A DROP ON THE PLATE IT WAS ALREADY ON CLEARS THE OVERRIDE rather than
       storing it, which is the way back: dragging a wire home puts it back under
       the rules instead of pinning it to the answer the rules currently give. */
    if (flowDrag.kind === 'board' && flowDrag.live && flowDrag.overId) {
      const flow = flowsPx.find((f) => f.id === flowDrag.id);
      const home = !flow?.assigned && flow?.boardId === flowDrag.overId;
      /* A WIRE DROPPED ON A SOCKET OUTLET CONVERTS IT, in the same gesture.
         An outlet is one socket and no switch — that is the definition — so
         "this appliance is switched from that plate" is a statement that the
         plate is not an outlet any more, exactly as pressing "+ 16A switch" on
         one is. Refusing the drop instead would be refusing a gesture whose
         meaning is not in doubt; converting it is the reading that does what
         the person plainly meant.
         WHAT THEY GET IS A BOARD SERVING THAT APPLIANCE: the switch for the
         flow, plus the socket that was on the wall and its own switch — see
         `spareAmps`, which is why the rating survives. */
      const target = allBoardsPx.find((b) => b.id === flowDrag.overId);
      if (target?.socketOnly) setBoardOutlet(target, false);
      setFlowBoards((m) => {
        if (home) {
          if (!(flowDrag.id in m)) return m;
          const out = { ...m }; delete out[flowDrag.id]; return out;
        }
        return { ...m, [flowDrag.id]: flowDrag.overId };
      });
    }
    setFlowDrag(null);
  };

  /**
   * PUT A PLATE BACK WHERE THE RULE WANTED IT.
   *
   * BACK TO NOTHING RATHER THAN TO THE RULE'S NUMBER, which is the same
   * distinction `runTrims` makes when a run is dragged back to its derived
   * length: a board with no entry in this map is a board the rules own, and one
   * carrying its own rule position as a hand position would be marked "moved by
   * hand" for ever and would stop following the door it was placed off.
   *
   * NO CALLER AT THE MOMENT, DELIBERATELY KEPT. The way back used to be a "put
   * back" button in the Spaces list, and that list is a list of rooms again —
   * see the note where the switchboard readout was. The undo itself is a rule
   * about `boardMoves`, not about that button, so it stays here for whatever
   * offers it next; deleting it would mean rediscovering the paragraph above.
   */
  // eslint-disable-next-line no-unused-vars
  const resetBoard = useCallback((id) => {
    setBoardMoves((m) => {
      if (!(id in m)) return m;
      const out = { ...m }; delete out[id]; return out;
    });
  }, []);

  const deleteBoard = useCallback((id) => {
    /* TWO VERBS, AND THE SAME DISTINCTION `accentDismissed` MAKES. A rule's
       board is DERIVED, so "not this one" cannot be expressed by removing it —
       the next render puts it straight back — and the answer is a dismissal that
       has to persist. A hand-placed board has no rule to come back from, so
       dismissing one would leave an id in `boardsOff` for the life of the plan,
       suppressing something that no longer exists. It is removed instead. */
    if (manualBoards.some((m) => m.id === id)) {
      setManualBoards((list) => list.filter((m) => m.id !== id));
    } else {
      setBoardsOff((off) => (off.includes(id) ? off : [...off, id]));
    }
    setSel((cur) => (idOf(cur, 'board') === id ? clear() : cur));
  }, [manualBoards]);

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
    setBoardPlace(false); closeShapeTool();
    setZoneMode(true); setDraftZone(null);
    setDoorEdit(false); setDoorDraft(null); setDoorDrag(null);
    setArmed(null); setGhost(null); setGuides([]);
    disarmAdd();
  }, [disarmAdd, closeShapeTool]);

  const closeZoneEdit = useCallback(() => {
    setZoneEdit(false); setZoneMode(false); setDraftZone(null);
  }, []);

  /* --- SAYING WHAT EACH WALL IS FINISHED IN ---------------------------------
     THE FOURTH STEP ON THIS SCREEN, AND THE SAME SHAPE AS THE OTHER THREE. Like
     the door, zone and switchboard editors it empties the panel, owns the
     pointer and stays open until it is closed — because what is being asked for
     is a gesture on the DRAWING, and a room's walls cannot be named in a panel:
     "wall 3" means nothing, and the wall you can see does.
     IT PUTS EVERY OTHER GESTURE AWAY on the way in, exactly as `openZoneEdit`
     does. One pointer pipeline, one owner. */
  const openWallEdit = useCallback((roomId) => {
    setWallEdit(roomId); setWallPick(null);
    setFocusId(roomId); setSel(clear());
    setZoneEdit(false); setZoneMode(false); setDraftZone(null);
    setBoardPlace(false); closeShapeTool();
    setDoorEdit(false); setDoorDraft(null); setDoorDrag(null);
    setArmed(null); setGhost(null); setGuides([]);
    disarmAdd();
  }, [disarmAdd, closeShapeTool]);

  const closeWallEdit = useCallback(() => {
    setWallEdit(null); setWallPick(null);
  }, []);

  /* A STEP CANNOT OUTLIVE ITS SUBJECT. Deleting the space, re-tracing it or
     clearing the plan all take the room out from under this, and a panel asking
     about the walls of a room that is not there has no way out that makes
     sense. */
  useEffect(() => {
    if (wallEdit && !rooms.some((r) => r.id === wallEdit)) closeWallEdit();
  }, [wallEdit, rooms, closeWallEdit]);

  /* --- PUTTING SWITCHBOARDS ON WALLS BY HAND --------------------------------
     THE THIRD STEP ON THIS SCREEN, AND THE SAME SHAPE AS THE OTHER TWO. Like
     the door editor and the zone editor it empties the panel, owns the pointer
     and stays open until it is closed — and for the same reason all three do:
     what is being asked for is a GESTURE ON THE DRAWING, and the panel's job
     while it is being made is to say what the gesture is and get out of the way.

     IT STAYS OPEN ACROSS PLACEMENTS, which is the whole of why it is a step and
     not the one-shot the rest of the palette uses. A fan is dropped one at a
     time; boards come in threes, because a room has a door wall and two others
     somebody wants a switch on. A tool that disarmed after the first plate would
     mean going back to the palette between each one.

     AND IT PUTS EVERY OTHER GESTURE AWAY on the way in, exactly as the other two
     do: one pointer pipeline, one owner. */
  const openBoardPlace = useCallback(() => {
    setBoardPlace(true);
    setSel(clear());
    closeShapeTool();
    setZoneEdit(false); setZoneMode(false); setDraftZone(null);
    setDoorEdit(false); setDoorDraft(null); setDoorDrag(null);
    setArmed(null); setGhost(null); setGuides([]);
    disarmAdd();
    /* THE WIRING LAYER COMES ON WITH IT. A plate placed on a sheet with the
       electricals switched off lands invisibly — the gesture appears to do
       nothing at all — and the entire point of the red plate is that somebody
       can see it is not connected yet. */
    setLayers((l) => (l.electrical ? l : { ...l, electrical: true }));
  }, [disarmAdd, closeShapeTool]);

  const closeBoardPlace = useCallback(() => setBoardPlace(false), []);

  /* --- WHICH ROOM A SLOT IS BEING DRAWN IN ----------------------------------
     THE ROOM UNDER THE PRESS, and failing that the nearest one its outline is
     within reach of. The second half matters more than it looks: a slot starts
     ON a wall, and a press aimed at a wall lands outside the polygon as often as
     inside it — a containment test alone would refuse the most natural way to
     begin the gesture.
     PLAN FEET, because that is the space a shape lives in. `polygonPlanFt` is
     the room's outline already converted; see the note on it in `geo`. */
  const roomForSlot = useCallback((pFt) => {
    if (!pxPerFt) return null;
    const px = { x: pFt.x * pxPerFt, y: pFt.y * pxPerFt };
    const inside = rooms.find((r) => pointInPolygon(px, r.geo.polygonPx));
    if (inside) return inside;
    let best = null;
    for (const r of rooms) {
      const q = projectOnOutline(pFt, r.geo.polygonPlanFt);
      if (q && (!best || q.dist < best.dist)) best = { r, dist: q.dist };
    }
    // A press further than a couple of feet from any wall is not aimed at one.
    return best && best.dist <= 2 ? best.r : null;
  }, [rooms, pxPerFt]);

  /* --- THE SLOT IN FLIGHT, AND WHY IT IS REFUSED WHEN IT IS ------------------
     ONE MEMO ANSWERING BOTH, because the two are the same computation and a
     refusal is not an error state — it is the ordinary condition of a drag that
     has not reached a second wall yet. Splitting them would mean asking
     `spanOnOutline` twice per frame and having two places that can disagree
     about whether this drag is legal.
     THE REASON IS A SENTENCE AND IT IS SHOWN, which is the half that was missing
     from every other refusal in this tool: a cove that simply fails to appear
     reads as a broken tool. See the shape step in the panel. */
  const lineSpan = useMemo(() => {
    if (shapeTool !== 'line' || !shapeSpan || !shapeAt) return { shape: null, why: '' };
    /* --- A GUIDE LINE GOES WHERE IT IS DRAWN ------------------------------
       A COVE LINE HAS TO LAND ON TWO WALLS. That is not a preference: a slot is
       a channel cut across the slab, and a channel that stops in mid-air has no
       end detail and cannot be built — see `spanOnOutline`, which is what
       projects a rough drag onto the plaster at both ends.
       A GUIDE LINE IS NOT BUILT. It is a line to set an array of fittings out
       along, and the useful ones are exactly the ones the cove rule forbids: a
       run over a worktop that starts and stops where the worktop does, a line
       across the middle of a room touching nothing. Forcing its ends onto the
       walls would make the tool refuse the one thing it is for.
       SO THE PROJECTION IS SKIPPED AND THE DRAG IS THE LINE, ends included. The
       square-up modifier still applies, because a run somebody wants level is a
       run somebody wants level whatever it is for. */
    /* ...AND A TRACK IS NOT BUILT EITHER, so it takes the same exemption. The
       test is "is this a cove" rather than a list of the roles that escape: a
       magnetic track profile has to be able to run across the middle of a room
       and stop, exactly as a guide does, and the wall projection below exists
       only because a COVE is a channel in plasterboard whose ends need something
       to land on. */
    if (shapeRole !== 'cove') {
      const b = shapeSpan.uniform
        ? axisLock(shapeSpan.aFt, shapeAt) : shapeAt;
      return { shape: lineShape(shapeSpan.aFt, b), why: '' };
    }
    const room = shapeSpan.roomId
      ? rooms.find((r) => r.id === shapeSpan.roomId) : null;
    if (!room) return { shape: null, why: 'Start on a wall of a space.' };
    /* SHIFT SQUARES IT UP, and it is the same Shift the pen has — see
       `axisLock`. Read live off `shapeSpan.uniform`, which `onZoneMove` keeps in
       step with the key, so holding it half way through a drag straightens the
       run under your hand and letting go frees it again. */
    const span = spanOnOutline(shapeSpan.aFt, shapeAt, room.geo.polygonPlanFt,
                               { lock: shapeSpan.uniform });
    if (!span) {
      return { shape: null,
               why: shapeSpan.uniform
                 ? 'Square to that wall runs along it — aim across the room.'
                 : 'A cove spans two walls — drag to a different one.' };
    }
    return { shape: lineShape(span.a, span.b), why: '' };
  }, [shapeTool, shapeSpan, shapeAt, rooms, shapeRole]);

  /* --- THE SHAPE THE GESTURE HAS MADE SO FAR --------------------------------
     A MEMO AND NOT A PIECE OF STATE, so there is exactly one place the live
     shape comes from and the preview on the drawing cannot drift from the thing
     the tick commits. It is the same argument `draftCove` makes one screen
     over: a preview built by separate code is a preview that eventually
     disagrees with the placement.

     `shapeHeld` WINS WHEN THERE IS ONE. The drag is over — the pointer came up
     — and what is on the drawing is the shape waiting for a tick. Recomputing
     it from `shapeSpan` and a pointer that has since moved elsewhere would make
     the shape follow the mouse after the gesture ended. */
  const shapeDraft = useMemo(() => {
    if (shapeHeld) return shapeHeld;
    if (!shapeMenuOn || !shapeTool) return null;
    if (shapeTool === 'pen') {
      // Closed the whole way through, including while it is being drawn: the
      // shape auto-closes, so a preview with a gap in it would be promising
      // something that cannot be committed.
      // THE PEN'S OWN AIMED POINT AND NOT `shapeAt`. `at` is the pointer with
      // the axis lock already applied, so the outline being drawn and the point
      // a click would commit are one value. See usePen.
      const pts = covePen.path;
      return pts.length >= 3 ? penShape(pts) : null;
    }
    if (!shapeSpan || !shapeAt) return null;
    /* --- A SLOT IS THE ONE DRAG WHOSE ENDS ARE NOT WHERE THE POINTER IS ------
       Both go on the WALL, and they are re-projected on every move rather than
       once at the press: the room's outline is what the run has to land on, so
       what is drawn while you drag is what would be built. A span that cannot
       be one — both ends on the same wall, or nothing left of the run — draws
       NOTHING, and the panel beside it says why. See `lineSpan`. */
    if (shapeTool === 'line') return lineSpan.shape;
    return shapeFromDrag(shapeTool, shapeSpan.aFt, shapeAt,
                         { sides: shapeSides, uniform: shapeSpan.uniform });
  }, [shapeHeld, shapeMenuOn, shapeTool, covePen.path, shapeAt, shapeSpan, shapeSides,
      lineSpan]);

  /** The shape the contextual bar is talking about. */
  const selShape = useMemo(
    () => ceilingShapes.find((q) => q.id === selShapeId) ?? null,
    [ceilingShapes, selShapeId]);

  /* WHICH OF THE FOUR THINGS THE BAR IS. Derived, so the bar cannot be showing
     a tick for a shape that is no longer being drawn.
     THE TOOL BEING OPEN OUTRANKS A SELECTION, which is why `edit` is only
     reachable with the menu closed — and why picking a shape on the sheet
     closes it (see `shapePointerDown`). Two bars' worth of controls in one bar
     would be a row where half the buttons act on the thing under the cursor and
     half on the thing you drew last. */
  /* `shapeSpan` COUNTS AS DRAWING EVEN WITH NO DRAFT TO SHOW FOR IT. A slot
     whose second end has not reached another wall yet produces no shape — see
     `lineSpan` — and without this the bar would drop back to the row of
     primitives half way through the drag, which reads as the tool letting go. */
  /* THE BAR HAS FOUR STATES AND `edit` IS REACHABLE TWO WAYS.
     It used to be reachable only with the tool CLOSED, which was right while the
     only way to open the bar was to ask to draw: if you were drawing, you were
     not editing. The bar now also arrives on a space click, unarmed (see
     `onCanvasClick`), and in that state selecting a shape has to offer what can
     be done to it — otherwise the one gesture that puts the tools in front of
     you would be the one that takes the corner radius, the duplicate and the
     delete away. NOTHING ARMED AND SOMETHING SELECTED IS EDITING; a live
     primitive means you are drawing, whatever is selected underneath. */
  /* --- ...AND `edit` DOES NOT SURVIVE ANOTHER TOOL OWNING THE BAR ------------
     `otherBar` IS A FIX FOR TWO CONTEXTUAL BARS STACKED IN ONE PLACE. The COB
     array tool selects the geometry it is setting out on — `select('shape', …)` in
     its branch of the canvas press, and rightly so: that ring is what says which
     shape the run belongs to. But a selected shape with the shape tool CLOSED is
     this bar's `edit` state, so arming the array put the shape's corner radius,
     duplicate and delete up at the foot of the stage alongside the array's own
     count and offset. Both are `position: fixed` at the same 26px — see BOTTOM
     in ShapeMenu and in CobSpec — so they overlapped: two rows of controls, half
     of them about an object nobody was working on, and a bin that deletes the
     GEOMETRY sitting beside a bar asking about lamps.
     A SELECTION IS NOT A REQUEST FOR A MENU WHILE SOMETHING ELSE IS IN HAND. So
     the fallback state is withheld whenever another machine on this canvas owns
     the next press — an add tool, the board step, the zone band. The ring on the
     shape stays, because that is a true statement about what the array is set
     out on; what goes is the second bar. Same one-bar-at-a-time rule `openArray`
     enforces from the other side.
     IT IS ONLY THE FALLBACK THAT IS GATED. `shapeMenuOn` means somebody
     deliberately asked for this bar, and the tool that armed it has already put
     every other machine away — so those states are untouched. */
  const otherBar = !!addTool || boardPlace || zoneMode;
  const shapeMode = shapeMenuOn
    ? (shapeAskSides ? 'sides'
      : ((shapeDraft || !covePen.isEmpty || shapeSpan) ? 'draw'
        : (!shapeTool && selShape ? 'edit' : 'pick')))
    : (selShape && !otherBar ? 'edit' : null);

  /**
   * KEEP IT. The tick, and the only way a shape gets onto the drawing.
   *
   * A RELEASED DRAG DOES NOT COMMIT, which is the one place this tool departs
   * from every other marquee in the app, and it is what the brief asked for.
   * The reason it is right: a cove is a piece of BUILDING, not a box round a
   * bed — it changes what the ceiling is, it re-cuts the grid and it re-runs
   * the layout — so it gets a confirmation, and the drag can be redone as many
   * times as it takes before anybody says yes.
   *
   * AND THE TOOL PUTS ITSELF DOWN, WHICH IS THE OPPOSITE OF WHAT IT DID FIRST.
   * It stayed armed, on the switchboard step's reasoning: plates come in
   * threes, so a tool that disarms after the first one costs a press between
   * each. That reasoning does not survive contact with this tool, for a reason
   * specific to it — WHILE A PRIMITIVE IS ARMED, NOTHING ON THE SHEET CAN BE
   * PICKED UP. The armed tool owns every press on the canvas, and it has to: a
   * new cove may well be spanned across an existing one. So the shape that had
   * just been committed could not be selected, could not be given a corner
   * radius and could not be moved. The tick appeared to place something and
   * then leave it inert.
   *
   * So the tick lands the shape, SELECTS it, and hands the bar over to it as
   * that shape's contextual menu — which is also the order the brief describes:
   * click the tick, then set the corner radius on the thing you just drew.
   * Another cove is one press on the palette, which is a fair price for the
   * thing that was actually in the way.
   */
  /* WHAT THE TICK WOULD ACTUALLY COMMIT, which is not always what is drawn.
     The pen's preview carries the point under the CURSOR as a live vertex —
     that is what makes the rubber band a preview — and committing it would put
     a corner of the cove wherever the pointer happened to be resting. So the
     tick takes the clicked points and nothing else, and the preview keeps its
     extra vertex. Every other tool has no such distinction and this is the
     draft. */
  const shapeToCommit = useMemo(() => {
    if (shapeHeld) return shapeHeld;
    if (shapeMenuOn && shapeTool === 'pen') return penShape(covePen.pts);
    return shapeDraft;
  }, [shapeHeld, shapeMenuOn, shapeTool, covePen.pts, shapeDraft]);

  const canCommitShape = !!shapeToCommit && bigEnough(shapeToCommit);

  /**
   * SET THE BORROWED DRAFT IN OR OUT — the one control a borrowed shape gets.
   *
   * RECOMPUTED FROM THE SOURCE EVERY TIME, never applied to the current draft.
   * `insetShape` is not reversible in the accumulating sense — a rectangle set
   * in a foot and then out a foot is the original, but a pen path offset twice
   * has been through the bisector solver twice and has drifted — so the source
   * is the only safe thing to measure from. See `heldSrc`.
   *
   * A REFUSAL LEAVES THE DRAFT WHERE IT WAS. `insetShape` returns null when the
   * offset eats the shape, and the honest reading of that is "not that far":
   * the control stops moving rather than the preview vanishing.
   */
  const setHeldOffset = useCallback((patch) => {
    setHeldOff((cur) => {
      const next = { ...cur, ...patch };
      if (!heldSrc) return next;
      const g = next.side === 'on' ? 0
        : (next.side === 'out' ? 1 : -1) * Math.max(0, next.ft || 0);
      const made = insetShape(heldSrc, g);
      if (!made) return cur;
      setShapeHeld(made);
      return next;
    });
  }, [heldSrc]);

  /**
   * WHAT THE SHAPE BAR MAY ASK ABOUT A BORROWED DRAFT.
   *
   * `null` UNLESS ONE IS HELD, which is what keeps the control off a shape
   * dragged out from scratch — that drag IS the position.
   *
   * AND NO SIDE ON AN OPEN PATH. A line has no inside: "a foot in from it" names
   * two paths and nothing in the drawing says which. `insetShape` returns an
   * open shape unchanged for exactly that reason, so offering the control would
   * be offering one that does nothing. Same call `arrayAsks` makes.
   */
  const heldAsks = useMemo(() => {
    if (!heldSrc || shapeIsOpen(heldSrc)) return null;
    const pts = shapeOutlineFt(heldSrc);
    return { sideId: heldOff.side, ft: heldOff.ft,
             sides: ARRAY_SIDES,
             // HOW FAR IN THE CONTROL MAY GO, from the geometry itself — see
             // `maxInset`, which bisects on the real offset rather than guessing
             // at an inradius, because an L-shaped outline has not got one.
             maxFt: Math.max(0, maxInset(pts) - SHAPE_MIN_SPAN_FT / 2) };
  }, [heldSrc, heldOff]);

  /* --- FINISHING A PEN PATH OPEN, WHICH IS THE L-SHAPED COVE ----------------
     THE PEN HAS TWO ENDINGS NOW AND THEY MEAN DIFFERENT DETAILS. Clicking the
     first point closes the path, and a closed path is a pocket run round an
     island. Pressing Enter leaves it OPEN, and an open path is a slot across the
     ceiling — which is only buildable if it lands on plaster at both ends, so
     this is offered exactly when it does and not otherwise.

     THE MIDDLE POINTS ARE LEFT WHERE THEY WERE PUT. Only the two ENDS answer to
     the walls, and they are tested rather than projected — unlike the line's,
     which are dragged and can be snapped continuously. A click is a considered
     act; moving somebody's corner after they placed it is the tool arguing with
     them. See `penSpansOutline`.

     THE TOLERANCE IS IN PIXELS AND CONVERTED, the same rule the closing click
     follows: it is about how accurately a person can hit a wall on screen, which
     does not change when the drawing is scaled. */
  const openPenRoom = useMemo(() => {
    if (!shapeMenuOn || shapeTool !== 'pen' || covePen.pts.length < 2) return null;
    return roomForSlot(covePen.pts[0]);
  }, [shapeMenuOn, shapeTool, covePen.pts, roomForSlot]);

  const canFinishOpen = useMemo(() => {
    /* A GUIDE PATH IS FINISHED WHEN IT HAS TWO POINTS. The wall test below is
       the cove's — an open cove is a channel and both its ends have to reach the
       plaster or there is no end detail to build. A guide reaches nothing on
       purpose: a run of spots set out over a worktop stops where the worktop
       does. Same exemption `lineSpan` makes, for the same reason. */
    // A GUIDE OR A TRACK IS FINISHED WHEN IT HAS TWO POINTS. Same exemption
    // `lineSpan` makes, for its reason: neither is built into the plaster.
    if (shapeRole !== 'cove') return covePen.pts.length >= 2;
    if (!openPenRoom || !pxPerFt) return false;
    const tolFt = Math.max(8, pxPerFt * 0.5) / pxPerFt;
    return penSpansOutline(covePen.pts, openPenRoom.geo.polygonPlanFt, tolFt);
  }, [openPenRoom, covePen.pts, pxPerFt, shapeRole]);

  /* --- WHAT THE PANEL SAYS WHILE A COVE IS BEING DRAWN ---------------------
     ONE OBJECT DESCRIBING THE STEP, so the branch that renders it is a layout
     and not a decision tree. Null whenever the tool is not open, which is what
     switches the step off.

     THE TWO OPEN COVES CARRY A PICTURE AND THE CLOSED ONES DO NOT — see
     SHAPE_GESTURE for why. Dragging out a rectangle is a marquee; what nobody
     can guess is that a line has to land on a wall at both ends. */
  const coveDraw = useMemo(() => {
    if (!shapeMenuOn || readOnly) return null;
    /* --- A GUIDE HAS NO STEP, AND THAT IS LOAD-BEARING --------------------
       WHAT A STEP DOES HERE IS EMPTY THE PANEL. Returning anything from this
       memo replaces the whole right-hand column — the tab strip, the header and
       the space detail with it — because a cove is a gesture the panel cannot
       help with and the cards are what it says instead.

       THE GEOMETRY BAR OPENS ON A SPACE CLICK, and that click's other half is to
       open that space in the panel: its height, its finishes, its Analysis. A
       step here would take all of it away again at the same instant — one
       gesture doing a thing and undoing it, and the more useful half would be
       the one that lost.

       THERE IS ALSO NOTHING TO SAY. The three cards below explain a COVE: where
       its ends have to land, what a pocket does to the grid, what gets built.
       A guide has no consequence to warn anybody about — it is a line on the
       ceiling and it goes where you draw it — and the bar on the drawing
       already shows the six primitives. Which of the two roles is live is on
       the rail, latched. */
    /* NO STEP CARD FOR A GUIDE OR A TRACK. The card explains a cove's
       CONSEQUENCES — where its ends have to land, what a pocket does to the
       grid, what gets built — and neither of the other two has any: a line goes
       where you draw it, and a profile is screwed to the ceiling you drew it on.
       The bar on the drawing already shows the six primitives. */
    if (shapeRole !== 'cove') return null;
    if (!shapeTool) {
      return { title: 'Pick a shape for the cove', art: null,
               hint: 'The bar on the drawing has the primitives.', why: '' };
    }
    if (shapeTool === 'line') {
      return {
        title: 'Span the cove from wall to wall',
        art: SHAPE_GESTURE.line,
        hint: 'Press on one wall and drag to another. Both ends land on the plaster. Shift squares it up.',
        why: lineSpan.why,
      };
    }
    if (shapeTool === 'pen') {
      return {
        title: 'Click out the cove',
        art: SHAPE_GESTURE.pen,
        // BOTH ENDINGS IN ONE SENTENCE, because the difference between them is
        // the difference between two details and the pen is the one tool that
        // can draw either.
        hint: covePen.isEmpty
          ? 'Click each corner, Shift to square. Close it on the first point for a pocket, or land on a wall at both ends for a run.'
          : canFinishOpen
            ? 'Close it on the first point for a pocket, or double-click to finish the run.'
            : 'Close it on the first point for a pocket. To finish it open, land on a wall.',
        why: '',
      };
    }
    return {
      title: `Drag out the ${SHAPE_BY_ID[shapeTool]?.label?.toLowerCase() ?? 'shape'}`,
      art: null,
      hint: 'Press on the ceiling and drag. The pocket runs round what you draw.',
      why: '',
    };
  }, [shapeMenuOn, shapeTool, readOnly, lineSpan.why, covePen.isEmpty, canFinishOpen,
      shapeRole]);

  const finishOpenCove = useCallback(() => {
    if (!canFinishOpen) return;
    const shape = penShape(covePen.pts, { open: true });
    if (!shape) return;
    // THE PATH GOES WITH IT, exactly as it does when the pen closes: the held
    // shape and the pen's own dots are two drawings of one outline.
    setShapeHeld(shape);
    covePen.reset(); setShapeAt(null);
  }, [canFinishOpen, covePen]);

  /**
   * SPANNING A TRACK ALSO FILLS IT — the diffuser allocator.
   *
   * WHY IT RUNS HERE AND NOT ON A BUTTON. Every other module on a run is placed
   * by hand because every other module is AIMED: a spot goes over the console
   * because that is where the console is. A diffuser is not aimed at anything —
   * it is ambient light — and the only question worth asking about how many a
   * run carries is the one the Analysis panel is already asking about the room.
   * So the moment a run exists, that question has an answer, and making somebody
   * press a second button to get it would be making them ask for the obvious.
   *
   * THE COUNT IS THE PANEL'S OWN ARITHMETIC RUN BACKWARDS. `spaceAnalysis` says
   * what the space is owed and what it is getting; `netPerUnit` says what one
   * diffuser is worth against THIS room's surfaces, height and country. The
   * quotient, rounded up, is the number. Nothing here re-derives a lumen —
   * see the note on `netPerUnit` for why that matters.
   *
   * AND THE GEOMETRY DECIDES WHERE THEY LAND, which is the other half and a
   * different question: corners on a closed run, ends-then-seven-feet on an
   * open one. See `allocateDiffusers`.
   *
   * FEET AND NOT PIXELS. The allocator's own figures — a module's length, the
   * seven-foot gap — are in feet, and a shape is held in the plan's own feet
   * anyway, so there is no conversion to get wrong.
   *
   * A ROOM IS REQUIRED AND A BRIGHT ONE GETS NOTHING. A run drawn over no lit
   * space has no shortfall to answer and no reflectances to answer it against;
   * a run in a room already over its criterion gets a bare profile, which is a
   * perfectly ordinary thing to want. Either way the spots still go on by hand.
   */
  const allocateOnTrack = useCallback((shape) => {
    if (!shapeIsTrack(shape) || !(pxPerFt > 0)) return;
    const pts = shapeOutlineFt(shape);
    if (pts.length < 2) return;
    const home = rooms.find((r) => pointInPolygon(
      { x: shape.x * pxPerFt, y: shape.y * pxPerFt }, r.geo.polygonPx));
    if (!home?.plan?.ok) return;
    const closed = !shapeIsOpen(shape);
    const a = spaceAnalysis(home);
    /* THE COUNT AND THE WATTAGE ARE SOLVED TOGETHER, and `netFor` is the panel's
       own arithmetic handed to the solver as a function of wattage — see
       `chooseDiffusers`, and `netPerUnit` for why nothing here re-derives a
       lumen. This replaced a fixed 18 W and a count rounded up to the geometry's
       quantum, which put 3,834 lm of diffuser into a room that wanted 1,250. */
    /* THE SHORTFALL, IN WATTS. The allocator's rule is written in watts —
       "27 W over four corners is 6.75 W each" — so the conversion happens here,
       once, against what ONE watt of this family is worth to THIS room. Linear,
       because `unitOutput` is: no fixed lumens on the family, so a watt is a
       watt and the division is exact rather than a fit.
       `track_diffuser` AND NOT `panel`. They share a distribution and are two
       products with two ranges — see lumens.js. */
    const fam = MODULE_BY_ID.diffuser.family;
    const perW = netPerUnit(fam, 1, { ref: a.ref, lumensPerWatt: a.lumensPerWatt });
    const plan = perW > 0 ? planDiffusers(pts, {
      closed, needW: a.shortfall / perW,
      /* --- THE CATALOGUE, OFF THE FAMILY, AND THE SAME ARRAY THE CHIPS USE ---
         WHAT A DIFFUSER IS SOLD AT COMES FROM UPSTREAM AND NOT FROM THE
         ALLOCATOR. `FAMILY_BY_ID.track_diffuser.watts` is the one store — see
         `TRACK_DIFFUSER_WATTS` in lumens.js — and it is also exactly what
         `analyseSpace` copies onto the row as `wattOptions` for SpaceAnalysis to
         draw a chip per entry. Read here through the FAMILY rather than by
         importing the constant, so the allocator and the panel look at the same
         array object: the allocator cannot pick a wattage the chips cannot show,
         and a brand's catalogue swapped into the family is followed by both
         without either being touched.
         IT IS PASSED AND NOT DEFAULTED. `planDiffusers` has no built-in list —
         see its note — so a caller that forgets this places nothing rather than
         quietly solving against a range nobody in this project sells. */
      watts: FAMILY_BY_ID[fam]?.watts,
    }) : [];
    if (!plan.length) return;
    /* EACH MODULE CARRIES THE WATTAGE ITS OWN SLOT WAS GIVEN, which is the whole
       point of the corner-first rule: a run comes out as four 5 W at the corners
       and a 10 W in the middle of a rail, and those are two figures on one
       profile. The Analysis panel groups by wattage for the same reason — see
       `roomFixtureGroups`. */
    setTrackFixtures((l) => [...l, ...plan.map((mod, i) => placeModule({
      trackId: shape.id, kind: 'diffuser', u: mod.u, watts: mod.watts,
      seq: `a${i}` }))]);
    /* AND THE PANEL GOES TO THE SPACE, because the two figures at the top of it
       have just moved by the whole of what the run adds. A tool that changed a
       room's verdict silently would be the one act on this drawing worth
       watching, performed off screen. */
    setFocusId(home.id); setOptionPick(null); setView('spaces');
  }, [pxPerFt, rooms, spaceAnalysis]);

  const commitShape = useCallback(() => {
    if (!shapeToCommit || !bigEnough(shapeToCommit)) return;
    const shape = sealShape(shapeToCommit, shapeRole);
    setCeilingShapes((l) => [...l, shape]);
    closeShapeTool();
    // ONE SELECTION ON THIS CANVAS, exactly as picking one off the sheet does.
    setSel(select('shape', shape.id));
    // ...AND IF IT IS A TRACK, IT ARRIVES FILLED. See `allocateOnTrack`.
    allocateOnTrack(shape);
  }, [shapeToCommit, shapeRole, closeShapeTool, allocateOnTrack]);

  /** Pick a primitive off the bar. The polygon is the one that asks a question
   *  first, because "how many sides" has no sensible default to assume. */
  const pickShapeTool = useCallback((id) => {
    abandonShape();
    setShapeTool((t) => (t === id ? null : id));
    if (id !== shapeTool && SHAPE_BY_ID[id]?.asks === 'sides') setShapeAskSides(true);
  }, [abandonShape, shapeTool]);

  const duplicateShape = useCallback((id) => {
    const src = ceilingShapes.find((q) => q.id === id);
    if (!src) return;
    // HALF A FOOT DOWN AND ACROSS, so the copy is visibly a second object rather
    // than a shape that appears not to have been copied at all. The same offset
    // a duplicate gets in every editor, for the same reason.
    // THE ID IS MINTED OUT HERE and not inside the updater: an updater has to be
    // pure, React is entitled to run it twice, and a `setSel` in the
    // middle of one would be selecting whichever of the two copies it ran last.
    const copy = { ...src, id: newShapeId(), x: src.x + 0.5, y: src.y + 0.5 };
    setCeilingShapes((l) => [...l, copy]);
    setSel(select('shape', copy.id));
    /* --- AND A TRACK BRINGS ITS MODULES WITH IT ---------------------------
       COPYING A RUN AND LEAVING ITS FITTINGS BEHIND WOULD NOT BE A COPY. A
       magnetic track is a profile with modules clipped into it, and "duplicate"
       said of one means the second run is the same run — same length, same three
       diffusers at the same places along it. That is the whole reason to
       duplicate rather than draw a second one and clip six modules onto it by
       hand.
       THE FRACTIONS COPY UNCHANGED, WHICH IS WHY THEY ARE FRACTIONS. A module is
       stored as a proportion of its run (see `clampU`), so the arrangement
       survives onto a copy of any length — and it will be another length the
       moment somebody drags a grip on it. Stored in feet the copy would be
       right until it was resized and then quietly shed its far modules.
       NOTHING HAPPENS FOR A COVE OR A GUIDE, because neither carries a module —
       the filter is empty and the write is skipped. */
    const mods = trackFixtures.filter((f) => f.trackId === id);
    if (mods.length) {
      setTrackFixtures((l) => [...l, ...mods.map((f, i) => ({
        ...f, id: newModuleId(`d${i}`), trackId: copy.id,
      }))]);
    }
  }, [ceilingShapes, trackFixtures]);

  const deleteShape = useCallback((id) => {
    setCeilingShapes((l) => l.filter((q) => q.id !== id));
    setSel((cur) => (idOf(cur, 'shape') === id ? clear() : cur));
    setShapeEditId((cur) => (cur === id ? null : cur));
    /* AND THE MODULES GO WITH THE RUN THEY WERE CLIPPED INTO. A module with no
       profile is not a fitting anybody can install, and an orphan in the store
       would be an entry nothing draws and nothing can reach to delete — it would
       simply sit in every saved plan for ever. `trackModulesPx` also drops one
       whose run has gone, which is the belt to this braces. */
    setTrackFixtures((l) => l.filter((f) => f.trackId !== id));
  }, []);

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
     has to be told what the limit is — the light stops. */
  const lightKey = (roomId, ck) => `${roomId}|${ck}`;

  /* THE DRAG THAT ACTUALLY MOVED SOMETHING, remembered for one click.
     A press on a light does NOT capture the pointer (see `lightPointerDown`),
     so a release that lands back on the fitting produces a click on the fitting
     — which opens the pill, exactly as it always did. A release that lands
     anywhere ELSE produces a click on the canvas, and the canvas reads that as
     "a press on empty plan" and drops the selection: you would move a light and
     watch its band vanish at the moment you let go.
     So the drop records that it happened, and `onCanvasClick` consumes it.
     Cleared by the next press either way, so a gesture that produced no click
     cannot swallow somebody's next deselect. */
  const lightMoved = useRef(false);

  /** Everything the clamp has to know about the room a light is in. Assembled
   *  once per gesture rather than per frame: none of it changes while a pointer
   *  is down, and `r.coves` in particular is a map over the room's cove reports.
   *  THE COVE LINES ARE IN HERE and are not optional — the dead band either side
   *  of one is a rule about where a fitting may sit, exactly like a fan's
   *  clearance, and a drag that ignored it could park a downlight in the pocket
   *  the whole detail exists to hide. */
  const clampCtxFor = useCallback((r) => ({
    polygon: r.geo.polygonFt,
    fans: r.geo.fixturesFt,
    zones: r.geo.zonesFt,
    options: { ...opt, coves: (r.coves ?? []).map((c) => c.line) },
  }), [opt]);

  /**
   * PICKING A LIGHT UP.
   *
   * THE PRESS SELECTS AND THE DRAG MOVES, with the usual slop between them —
   * and here the slop is doing something it does nowhere else on this canvas: a
   * click on a light already means "open this chunk's ceiling options", and that
   * meaning has to survive. So a press that does not travel is still a click,
   * the pill still opens, and only a press that travels becomes a move.
   */
  const lightPointerDown = (e, roomId, l) => {
    if (e.button != null && e.button !== 0) return;
    if (addTool || zoneMode || armed || boardPlace) return;
    if (!l.bandPx || !l.cellKey || !pxPerFt) return;
    e.preventDefault();
    e.stopPropagation();
    // ONE SELECTION ON THIS CANVAS.
    setSel(select('light', lightKey(roomId, l.cellKey)));
    clearShapeEdit();
    lightMoved.current = false;
    /* NO POINTER CAPTURE, AND THIS IS THE ONE DRAG ON THIS CANVAS THAT REFUSES
       IT. Every other one captures to the <svg> so the gesture survives leaving
       the thing it started on — but capture RETARGETS the click the browser
       synthesises on release, and a click on a light already means something:
       it opens that chunk's ceiling options. Capture would send that click to
       the canvas instead, and the pill — the way this app's main decision is
       made — would stop opening on a press that had merely wobbled.
       IT COSTS NOTHING HERE. The svg carries the move and up handlers itself, so
       a drag that leaves the fitting is still tracked; and the fitting can only
       travel ±20% of one cell, so there is no version of this gesture that
       leaves the sheet. Capture buys the other drags something this one does not
       need. */
    const p = svgPoint(e);
    setLightDrag({
      roomId, cellKey: l.cellKey, live: false,
      // The pointer and the fitting, both in PLAN PIXELS, and the offset between
      // them held so the light does not jump to the cursor on the first move.
      from: p, grab: { x: p.x - l.x, y: p.y - l.y }, at: { x: l.x, y: l.y },
    });
  };

  /**
   * ...AND DRAGGING IT.
   *
   * NOTHING IS WRITTEN UNTIL THE DROP, which is the opposite of what the ceiling
   * objects and the cove shapes do, and the difference is what it costs. Those
   * write per move and the layout memo re-runs — which for them is a re-chunk
   * and a re-grid, expensive but survivable. A light's own position is INSIDE
   * that layout: committing per frame would re-run `planLights` for the room on
   * every pointer event, and `planLights` runs its placement up to four times
   * and then two alignment passes. That is a solver in a mousemove.
   *
   * So the gesture carries the live position, the canvas draws the fitting there
   * (see `movingLight`), and the store is written once on release. What is lost
   * is the neighbours re-aligning live; what is gained is a drag that keeps up
   * with the pointer. The neighbours tidy onto it the moment you let go, which
   * is the frame the layout actually re-runs.
   *
   * THE CLAMP RUNS PER FRAME EVEN SO. It is the cheap half — a band, four
   * predicates and a walk back along one segment — and it is the whole point of
   * the gesture: the light has to STOP at the edge while you are still pushing,
   * or the box on the drawing is decoration.
   */
  const lightPointerMove = (e) => {
    if (!lightDrag || !pxPerFt) return;
    const p = svgPoint(e);
    if (!lightDrag.live) {
      const slop = Math.max(3, pxPerFt * 0.12);
      if (Math.hypot(p.x - lightDrag.from.x, p.y - lightDrag.from.y) < slop) return;
      setLightDrag((d) => (d ? { ...d, live: true } : d));
    }
    const r = rooms.find((q) => q.id === lightDrag.roomId);
    const light = r?.plan?.lightsPx?.find((q) => q.cellKey === lightDrag.cellKey);
    if (!light?.cell) return;
    const want = {
      x: (p.x - lightDrag.grab.x - r.geo.origin.x) / pxPerFt,
      y: (p.y - lightDrag.grab.y - r.geo.origin.y) / pxPerFt,
    };
    const at = clampLightMove(light.cell, want, {
      ...clampCtxFor(r),
      // Every OTHER light in the space. The dragged one is excluded by cell
      // rather than by identity: it is a different object each render.
      others: r.plan.lights.filter((q) => q.cell?.id !== light.cell.id),
    });
    if (!at) return;
    const px = r.geo.toPx(at);
    setLightDrag((d) => (d ? { ...d, at: px } : d));
  };

  /**
   * LETTING GO, which is the only write.
   *
   * A PRESS THAT NEVER TRAVELLED WRITES NOTHING. It was a click on a light,
   * which already means something — see `lightPointerDown` — and storing an
   * offset of zero for it would mark the fitting "moved by hand" for the life of
   * the plan, pinning it out of the alignment pass for a gesture nobody made.
   */
  const lightPointerUp = () => {
    if (!lightDrag) return;
    const d = lightDrag;
    setLightDrag(null);
    if (!d.live || !pxPerFt) return;
    lightMoved.current = true;
    const r = rooms.find((q) => q.id === d.roomId);
    const light = r?.plan?.lightsPx?.find((q) => q.cellKey === d.cellKey);
    if (!light?.cell) return;
    const ft = { x: (d.at.x - r.geo.origin.x) / pxPerFt,
                 y: (d.at.y - r.geo.origin.y) / pxPerFt };
    setLightMoves((m) => ({
      ...m,
      [d.roomId]: { ...(m[d.roomId] || {}),
                    [d.cellKey]: { dx: ft.x - light.cell.cx, dy: ft.y - light.cell.cy } },
    }));
  };

  /**
   * PUT IT BACK UNDER THE RULES. Delete on a selected light, and it is a
   * DISMISSAL OF THE OVERRIDE rather than a delete — the same act Delete
   * performs on a picked wire, and for the same reason: a light cannot be
   * removed. It is one cell's share of the ambient level, the grid put it there,
   * and a ceiling with a hole in it where a lamp should be is not a thing this
   * app can express. What CAN be taken away is the decision somebody made about
   * where inside its cell it sits.
   */
  const resetLightMove = useCallback((key) => {
    const [roomId, ck] = String(key).split('|');
    setLightMoves((m) => {
      const room = m[roomId];
      if (!room || !(ck in room)) return m;
      const next = { ...room };
      delete next[ck];
      const out = { ...m };
      if (Object.keys(next).length) out[roomId] = next; else delete out[roomId];
      return out;
    });
  }, []);

  /* --- THE PRESS THAT PICKED A SHAPE UP, REMEMBERED FOR ONE CLICK -----------
     A REF AND NOT STATE, because nothing renders from it and it has to be
     readable by the click that arrives after this render, not the one after the
     next.
     IT EXISTS BECAUSE POINTER CAPTURE MOVES THE CLICK. `shapePointerDown` stops
     the press and captures the pointer to the <svg> so the drag survives leaving
     the shape — and a captured pointer RETARGETS everything that follows,
     including the click the browser synthesises on release, to the capture
     element. So the click was landing on the canvas itself, where it reads as "a
     press on empty plan" and clears the selection: the contextual bar appeared
     on the press and vanished on the release, every time.
     Stopping the click on the shape's own path cannot fix that — by then the
     click is not being dispatched to that path at all. This is the record that
     survives the retarget, and `onCanvasClick` consumes it.
     RESET AT THE TOP OF `onZoneDown`, which is the invariant that keeps it from
     going stale: any press that reaches the canvas directly is a press that did
     NOT come off a shape, so a latch left over from a gesture that produced no
     click cannot swallow somebody's next deselect. */
  const shapeTook = useRef(false);

  /* THE LAST PRESS ON A SHAPE, for telling a second one from a first.
     A REF AND A TIMESTAMP RATHER THAN `onDoubleClick`, and the reason is the
     same one `shapeTook` exists for: the press captures the pointer to the
     <svg>, and a captured pointer retargets the compatibility mouse events that
     follow — so a `dblclick` handler on the shape's own path is a handler that
     may never be called. Two presses on the same shape inside the platform's
     own double-click window is the thing being detected anyway; this measures it
     directly instead of asking for it through an event that has been moved. */
  const lastShapePress = useRef({ id: null, t: 0 });
  /** How long two presses on one thing count as a double. */
  const DOUBLE_MS = 400;

  const shapePointerDown = (e, id) => {
    if (e.button != null && e.button !== 0) return;
    /* A TOOL IN HAND WINS, the same rule every selectable thing on this canvas
       follows — and the SHAPE TOOL is in that list, which is the one that is
       easy to miss. Somebody spanning a second cove across the first is aiming
       at the ceiling, not at the shape in the way, and without this the press
       would be swallowed here and the new shape would never start. The caller
       withholds the handler for exactly the same set (so the grab area is not
       even drawn); this is the local reading of it. */
    if (addTool || zoneMode || armed || boardPlace || (shapeMenuOn && shapeTool)) return;
    /* --- THE BAR IS OPEN, AND THIS SHAPE IS THE OTHER ROLE ------------------
       THEN THE PRESS TAKES IT RATHER THAN SELECTING IT. This is the same act
       `shapeToolDown` performs; which handler gets it depends only on whether a
       primitive is armed, because an armed primitive is what makes the caller
       withhold this handler (and the grab band with it). With the bar open and
       unarmed the band is live and answers first, so the take has to happen here
       too — see `takeGeometry`, which is the one copy of it.
       THE CUE HAS ALREADY SAID SO. `geomHover` lit this line and turned the
       cursor into a hand the moment the pointer reached it, so a press that
       borrows an outline instead of selecting it is signposted rather than
       surprising. */
    if (!shapeTool) {
      const sh = ceilingShapes.find((q) => q.id === id);
      if (canTakeGeometry({ shape: sh, role: shapeRole, menuOpen: shapeMenuOn,
                            addTool, penEmpty: covePen.isEmpty })) {
        takeGeometry(e, sh); return;
      }
    }
    e.preventDefault();
    e.stopPropagation();
    shapeTook.current = true;
    /* A SECOND PRESS ON THE SAME SHAPE ASKS FOR ITS DIMENSIONS. The first
       selected it; this one goes a level in. Any other shape's press cancels
       the grips — they belong to one shape and showing them on two would be
       eight handles that could each mean either. */
    const now = Date.now(), prev = lastShapePress.current;
    const again = prev.id === id && now - prev.t < DOUBLE_MS;
    lastShapePress.current = { id, t: now };
    setShapeEditId(again ? id : (cur) => (cur === id ? cur : null));
    // A press on a shape is an act on THAT shape, so the bar becomes its
    // contextual menu — see `shapeMode`.
    setShapeMenuOn(false); setShapeTool(null); abandonShape();
    setSel(select('shape', id));
    const src = ceilingShapes.find((q) => q.id === id);
    if (!src || !pxPerFt) return;
    svgRef.current?.setPointerCapture?.(e.pointerId);
    const p = svgPoint(e);
    // AND THE HIGHLIGHT GOES WITH THE PRESS. The move handler stops tracking for
    // the length of a drag, so a value left behind would keep the cursor a hand
    // over a shape that is already moving.
    setGeomHover(null);
    setShapeDrag({ id, from: { x: p.x / pxPerFt, y: p.y / pxPerFt },
                   base: { x: src.x, y: src.y }, live: false, copied: false });
  };

  const shapePointerMove = (e) => {
    if (!shapeDrag || !pxPerFt) return;
    /* --- A SLOT DOES NOT MOVE, AND THAT IS THE HONEST ANSWER -----------------
       Both its ends are on the plaster — that is what makes it buildable, see
       `spanOnOutline` — so there is no direction it can be dragged in that
       leaves it a cove. Sliding it along its own two walls is not a translation
       and every other direction pulls it off them.
       IT IS STOPPED HERE RATHER THAN CLAMPED, because `clampCoveMove` is the
       keep-off-the-plaster rule and a slot is deliberately ON the plaster: it
       would find the shape already illegal and refuse every pixel, which is a
       drag that judders rather than one that plainly does nothing. The band is
       still grabbable, because grabbing it is how it is SELECTED and deleted. */
    if (shapeIsOpen(ceilingShapes.find((q) => q.id === shapeDrag.id))) return;
    const p = svgPoint(e);
    const at = { x: p.x / pxPerFt, y: p.y / pxPerFt };
    const drag = shapeDrag;
    /* --- A GUIDE IS NOT KEPT OFF THE PLASTER, AND A COVE IS --------------
       `clampCoveMove` holds a shape six inches clear of the room's outline,
       because a pocket four inches from the wall leaves four inches of board
       between them and nobody can build that. A guide is not built. It is a
       line to set out FROM — and the most useful place to put one is very often
       exactly on the wall, or a foot inside it, which is the one position the
       cove's rule exists to forbid. Applying it to a guide would make the tool
       refuse the thing it is for. */
    const settle = (sh, to) => (shapeIsBuilt(sh) && room?.geo?.polygonPlanFt
      ? clampCoveMove(sh, to, room.geo.polygonPlanFt, COVE_GAP_FT) : to);
    if (!drag.live) {
      const slop = Math.max(3, pxPerFt * 0.12) / pxPerFt;
      if (Math.hypot(at.x - drag.from.x, at.y - drag.from.y) < slop) return;
      setShapeDrag({ ...drag, live: true });
    }
    const dx = at.x - drag.from.x, dy = at.y - drag.from.y;
    /* AND THE ROOM STOPS IT. A cove may not come within six inches of the
       plaster — see coveClearOfOutline — and the honest way to say that during a
       drag is to have the shape stop, not to let it go anywhere and refuse it
       once the pointer is up. `clampCoveMove` slides it along the wall it
       reached, and along a notch the bounding box knows nothing about.
       THE ROOM IS THE ONE IT IS IN NOW, resolved from where it currently sits
       rather than from where the pointer is: a cove being pushed at a wall must
       not be handed the room on the other side of it half way through. */
    const want = { x: drag.base.x + dx, y: drag.base.y + dy };
    const held = ceilingShapes.find((q) => q.id === drag.id);
    const room = held ? roomAt({ x: held.x * pxPerFt, y: held.y * pxPerFt }) : null;

    /* ALT LEAVES A COPY BEHIND, AND THE MODIFIER IS READ LIVE — every word of
       the long note on `objPointerMove` applies here unchanged, so it is not
       repeated. The short of it: "Alt then drag" and "drag then Alt" are one
       gesture, the ORIGINAL is put back where it was picked up, the TWIN is what
       keeps moving, and once made it stays made whether or not Alt is let go.
       ONE `setCeilingShapes` DOING THE RESTORE AND THE CLONE TOGETHER, then a
       return, for the reason given there: `shapeDrag` in this closure is the
       value from the render that installed the handler, so a second write here
       would move the original. */
    if (!drag.copied && e.altKey) {
      const src = ceilingShapes.find((q) => q.id === drag.id);
      if (!src) return;
      const to = settle(src, want);
      const twin = { ...src, id: newShapeId(), x: to.x, y: to.y };
      setCeilingShapes((l) => [
        ...l.map((q) => (q.id === drag.id ? { ...q, x: drag.base.x, y: drag.base.y } : q)),
        twin,
      ]);
      setShapeDrag({ ...drag, id: twin.id, live: true, copied: true });
      setSel(select('shape', twin.id));
      return;
    }
    setCeilingShapes((l) => l.map((q) => {
      if (q.id !== drag.id) return q;
      const to = settle(q, want);
      return { ...q, x: to.x, y: to.y };
    }));
  };

  const shapePointerUp = () => { if (shapeDrag) setShapeDrag(null); };

  /**
   * A GRIP ON THE FRAME, PRESSED.
   *
   * NO SLOP AND NO `live` FLAG, which every other drag on this canvas has. Those
   * exist to stop a click that wobbles from writing a hand position onto
   * something a rule had placed — but a grip is not a thing you click, it is a
   * thing you drag, and a press on one that goes nowhere resizes the shape to
   * exactly the size it already is. There is nothing to protect against.
   */
  /* --- A DRAWN TRACK'S POINTS, PICKED UP AND MOVED --------------------------
     THE SAME SHAPE AS `shapeHandleDown` DIRECTLY BELOW, and deliberately: a
     grip is a grip. The press selects the point, takes the pointer, and marks
     `shapeTook` so the click it synthesises on release is not read as a press
     on bare plan — which would close the path being edited on every drag.

     THE POINT MOVES WITH ITS TWO LEGS. See `penMovePoint`: the corner goes
     where the pointer is and the two neighbours follow it onto their own axes,
     so a path that was square stays square without the far end of the run
     swinging about behind the hand. */
  const trackPointDown = (e, id, i) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    shapeTook.current = true;
    setTrackEditId(id); setSelTrackPt(i);
    svgRef.current?.setPointerCapture?.(e.pointerId);
    setTrackGrip({ id, i });
  };

  /** ...and dragged. Written straight into the list on every move, exactly as a
   *  shape's resize is: the answer depends only on where the pointer is now. */
  const trackGripMove = (e) => {
    if (!trackGrip || !pxPerFt) return;
    const p = svgPoint(e);
    const at = { x: p.x / pxPerFt, y: p.y / pxPerFt };
    setManualTracks((l) => l.map((t) => {
      if (t.id !== trackGrip.id) return t;
      const pts = penMovePoint(t.ptsFt, trackGrip.i, at);
      return { ...t, ptsFt: pts, lengthFt: penLengthFt(pts) };
    }));
  };

  /**
   * A WHOLE DRAWN RUN, TAKEN OFF THE PLAN.
   *
   * IT PUTS THE LIGHTS BACK, AND THERE IS NOTHING HERE THAT DOES SO. That is
   * the point worth stating: a track never moved a light out of the layout, it
   * only carried one that was already there — see the doctrine at the top of
   * track.js — so removing the path is the whole of the undo. The layout memo
   * re-runs with one fewer entry in `manualTracks`, the absorption that
   * relabelled those fittings simply does not happen, and every one of them is
   * back on its own grid position as a recessed downlight. Same as deleting a
   * cove, and for a simpler reason: a cove had to re-cut the grid to be
   * removed, and this only has to stop being consulted.
   */
  const deleteTrack = useCallback((id) => {
    setManualTracks((l) => l.filter((t) => t.id !== id));
    setTrackEditId(null); setSelTrackPt(null); setTrackGrip(null);
  }, []);

  /**
   * A POINT TAKEN OUT, AND THE PATH PUT BACK ON ITS AXES BEHIND IT.
   *
   * Removing a corner leaves the two points that were either side of it joined
   * by a diagonal, and a track cannot be built along one — so the tail is
   * re-squared from the cut. See `penRelock` for why it cascades.
   *
   * Below the minimum the whole track goes instead — see the guard.
   */
  const deleteTrackPoint = useCallback((id, i) => {
    const t = manualTracks.find((q) => q.id === id);
    if (!t) return;
    /* A CIRCUIT NEEDS THREE POINTS AND A RUN NEEDS TWO. Below that there is no
       path left to have, so the whole track goes rather than being left as a
       line doubled back on itself — which is what a two-point closed loop is —
       and the editor closes with it, because there is nothing to keep open. */
    if (t.ptsFt.length <= (t.closed ? 3 : 2)) { deleteTrack(id); return; }
    const cut = [...t.ptsFt.slice(0, i), ...t.ptsFt.slice(i + 1)];
    const pts = penRelock(cut, Math.max(1, i));
    setManualTracks((l) => l.map((q) => (q.id === id
      ? { ...q, ptsFt: pts, lengthFt: penLengthFt(pts, { closed: !!q.closed }) } : q)));
    setSelTrackPt(null);
  }, [manualTracks, deleteTrack]);

  /**
   * OPENING A PATH FROM A RAIL SOMEBODY CLICKED.
   *
   * The canvas hands over the track's `key`, which for a drawn run IS the
   * manual track's id — stamped in the layout pass — so this is a lookup rather
   * than a hit test. Guarded anyway: a key that matches nothing would open an
   * editor with no points in it, which reads as the feature being broken.
   */
  const openTrackEdit = useCallback((key) => {
    if (!manualTracks.some((t) => t.id === key)) return;
    setTrackEditId(key); setSelTrackPt(null);
  }, [manualTracks]);

  /** Shut the point editor. One place, because three keys and a press reach it. */
  const closeTrackEdit = useCallback(() => {
    setTrackEditId(null); setSelTrackPt(null); setTrackGrip(null);
  }, []);

  /**
   * OPEN AN ARRAY, AND CLOSE EVERYTHING ELSE THAT WANTS THE SAME SPACE.
   *
   * ONE CONTEXTUAL BAR AT A TIME, AND IT IS NOT A PREFERENCE. Both bars on this
   * drawing are `position: fixed`, centred over the stage, 26px off its foot —
   * see BOTTOM in CobSpec and in ShapeMenu, which deliberately share the figure
   * on the argument that the two are never up together. Two of them up IS two
   * rows of buttons in one place: the second draws over the first, and half the
   * controls somebody can see belong to an object they are not looking at.
   *
   * SO OPENING ONE IS ALSO AN ACT OF CLOSING, and it is written here rather than
   * spread across the four presses that can open an array because the list of
   * what has to go is the interesting part and it must not be maintained in four
   * copies. `openShapeTool`, `openZoneEdit`, `openBoardPlace` and the rail's own
   * handlers already do the same thing from the other side.
   *
   * IT ALSO PUTS THE PANEL ON THE SPACE THE RUN IS IN, which is what every other
   * fitting's press does through `analysisHighlight` — an array is one row in
   * that panel (see `roomFixtureGroups`) and the row is where its wattage can
   * also be changed, so the two have to be looking at the same room.
   */
  const openArray = useCallback((id) => {
    // ONE SELECTION ON THIS CANVAS. Two things picked would be two things Delete
    // could mean, and taking the register is how this one stops being a list of
    // ten clears that had to be kept in step with the ten selections.
    setSel(select('array', id));
    /* THE SHAPE BAR GOES WITH THE SHAPE. Selecting a shape is what puts the bar
       into its `edit` state — see `shapeMode` — so clearing the tool is not
       enough on its own; the selection has to go too, which the line above now
       does, or the bar comes straight back up over the array's. */
    closeShapeTool(); clearShapeEdit();
    closeTrackEdit(); closeBoardPlace();
    setTrackMode(null);
    setZoneEdit(false); setZoneMode(false); setDraftZone(null);
    setDoorEdit(false); setDoorDraft(null); setDoorDrag(null);
    setArmed(null); setGhost(null); setGuides([]);
    disarmAdd();
    const roomId = cobArrays.find((a) => a.id === id)?.roomId ?? null;
    if (roomId) { setFocusId(roomId); setView('spaces'); }
  }, [closeShapeTool, clearShapeEdit, closeTrackEdit, closeBoardPlace,
      disarmAdd, cobArrays]);

  const shapeHandleDown = (e, id, handle) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    // The click this press will synthesise lands on the <svg> once the pointer
    // is captured — see `shapeTook` — and must not read as a press on bare plan.
    shapeTook.current = true;
    setSel(select('shape', id)); setShapeEditId(id);
    svgRef.current?.setPointerCapture?.(e.pointerId);
    setShapeResize({ id, handle });
  };

  /**
   * ...AND DRAGGED. Written straight into the list on every move, exactly as a
   * shape's own drag is, and for the reason `resizeShape` gives: the side
   * opposite the grip does not move, so reading the shape back off the list each
   * frame gives the same anchor it gave last frame. There is no start-of-gesture
   * geometry to carry, which is what makes this three lines instead of thirty.
   */
  const shapeResizeMove = (e) => {
    if (!shapeResize || !pxPerFt) return;
    const p = svgPoint(e);
    const at = { x: p.x / pxPerFt, y: p.y / pxPerFt };
    setCeilingShapes((l) => l.map((q) => {
      if (q.id !== shapeResize.id) return q;
      const next = resizeShape(q, shapeResize.handle, at, { uniform: e.shiftKey });
      /* A GRIP MAY NOT PUSH THE COVE INTO THE KEEP-OUT BAND EITHER. Growing a
         shape is a move of one of its sides, and the six inches off the plaster
         is a rule about where the cove IS, not about how it got there. There is
         nothing to slide along here — a resize has one degree of freedom and it
         is already at its limit — so the side simply stops. */
      const room = roomAt({ x: q.x * pxPerFt, y: q.y * pxPerFt });
      const poly = room?.geo?.polygonPlanFt;
      if (poly && !coveClearOfOutline(shapeBboxFt(next), poly, COVE_GAP_FT)) return q;
      return next;
    }));
  };

  /**
   * THE PRESS THAT DRAWS. Returns true when it has taken the event, so the
   * handler below it can stop reading rather than testing the same conditions a
   * second time.
   *
   * TWO GESTURES BEHIND ONE TOOL. The five primitives are a drag — press,
   * span, release — and the pen is a run of separate clicks that ends on the
   * first point. Nothing about the two can be shared beyond this branch, which
   * is why the split is here and not four levels down.
   */
  /**
   * TAKE A GEOMETRY ALREADY ON THE DRAWING AS THE TOOL'S DRAFT.
   *
   * A FUNCTION AND NOT A BRANCH, because two different presses arrive at it. With
   * a primitive armed the press lands on the <svg> and comes through
   * `shapeToolDown`; with the bar merely OPEN the shape's own grab band answers
   * first and stops the event, so it comes through `shapePointerDown`. Same act,
   * same result, and one copy of it — the alternative was the same eight lines in
   * two handlers, which is how they come to disagree about whether the role is
   * stripped.
   *
   * IT ALWAYS TAKES THE EVENT. `shapeTook` is what stops the click the browser
   * synthesises on release being read as a press on bare plan, which would clear
   * the selection and swap this bar for the space's own, forty milliseconds after
   * the draft appeared.
   */
  const takeGeometry = (e, took) => {
    const { id: _id, role: _role, ...draft } = took;
    e.preventDefault();
    e.stopPropagation();
    setShapeSpan(null); setShapeAt(null); setGuides([]); setGeomHover(null);
    /* THE SOURCE IS KEPT AND THE OFFSET IS RESET. Kept, because every later
       change to the distance is computed from it rather than from the last
       answer — see `heldSrc`. Reset to "on the line", because the first thing to
       be sure of is that the right geometry was taken, and the only arrangement
       that shows that unambiguously is the one drawn on it. The distance is
       carried at a foot so choosing a side is one press. */
    setHeldSrc(draft);
    setHeldOff({ side: 'on', ft: 1 });
    setShapeHeld(draft);
    shapeTook.current = true;
    return true;
  };

  const shapeToolDown = (e) => {
    if (!shapeMenuOn || !pxPerFt) return false;
    const p = svgPoint(e);
    /* --- A GEOMETRY ALREADY ON THE DRAWING IS SOMETHING TO SPAN FROM --------
       THE WHOLE POINT OF A GUIDE IS THAT SOMETHING GETS BUILT ON IT, and until
       this branch existed nothing could be: you drew a line to set out from,
       reached for the cove tool, and then had to drag a second rectangle over
       the first by eye — on the one drawing where the geometry to match was
       already there and exact. So a press on a geometry of the OTHER role hands
       that geometry to the tool as its draft. See `geomUnder` for why "the other
       role" and not "any shape".

       IT ARRIVES AS A HELD DRAFT AND NOT AS A COMMITTED COVE, which is what
       makes this one branch rather than a feature: the bar goes to its `draw`
       state, showing the size and a tick and a cross, and `commitShape` does the
       rest exactly as it does for a shape somebody dragged out. A cove is a
       piece of building — see the note there — so it gets its confirmation
       whether the outline was drawn or borrowed.

       THE ID AND THE ROLE ARE STRIPPED, AND BOTH MATTER. The id, because
       `sealShape` mints a fresh one and a draft carrying the source's would
       commit a second shape claiming to be the first. The role, because
       `sealShape` spreads the draft and only ADDS `role: 'guide'` — so a guide
       copied with its role intact would come back a guide however the tool was
       armed, which is this branch failing silently at the one thing it does.

       AND THE GUIDE STAYS WHERE IT IS. It was a setting-out line before the
       press and it is one after: the cove is a new shape on the same outline,
       and consuming the line that positioned it would take away the thing the
       next detail is set out from.

       NOT WHILE A PEN PATH IS OPEN. A click mid-path is a corner, and a corner
       is not a press anything else may take — the same rule every in-flight
       gesture on this canvas owns its pointer by. */
    /* --- AND AN ARMED TOOL OWNS THIS PRESS ---------------------------------
       `canTakeGeometry` IS THE WHOLE TEST AND IT IS NOT INLINE ANY MORE. It read
       `covePen.isEmpty && geomUnder(p)` here, and `geomUnder` answers for
       whichever tool is in hand — so with a track MODULE armed it returned the
       track under the pointer and this branch converted it into a fresh draft.
       The press never reached the module branch below: the diffuser and the spot
       were unreachable, which is what was reported. See the note on that
       function for the rule and tools/test-mag-track.mjs for the truth table. */
    const took = shapeAtPointer(p);
    if (canTakeGeometry({ shape: took, role: shapeRole, menuOpen: shapeMenuOn,
                          addTool, penEmpty: covePen.isEmpty })) {
      return takeGeometry(e, took);
    }
    /* NOTHING WAS TAKEN. With no primitive armed the bar is merely OPEN — the
       state a rail cell and a space click both leave it in — and this press is
       not its business: it falls through to the canvas, where it selects the
       space or lets go of a selection like any other press on bare plan. */
    if (!shapeTool) return false;
    e.preventDefault();
    /* THE PRESS IS ABOUT TO DRAW, so the highlight goes — here rather than in
       the two branches below. The move handler stops tracking for the length of a
       gesture (a span owns the pointer, and a pen with points down draws a band
       instead), so a shape lit up a pixel before the press would stay lit for the
       whole of it, claiming a press already spent on something else. */
    setGeomHover(null);
    const at = shapeTool === 'pen'
      // THE POINT THE GUIDES ARE PROMISING. `penSnap` is what the rubber band
      // was drawn from a moment ago, so running it again on the press is the
      // only way the click can land where the preview said it would.
      ? penSnap(p, covePen)
      // ...AND THE SAME RULE FOR THE FIVE DRAGGED PRIMITIVES. The anchor of a
      // marquee is a corner somebody aimed at a line; see `shapeSnapFt`.
      : shapeSnapFt(p);
    if (shapeTool === 'pen') {
      // A NEW PATH REPLACES WHATEVER WAS HELD, exactly as a new span does
      // below: the first click of a second outline means "not that one, this
      // one". Without it the held shape would keep winning in `shapeDraft` and
      // the clicks would appear to do nothing at all.
      if (shapeHeld && covePen.isEmpty) setShapeHeld(null);
      /* A DOUBLE-CLICK FINISHES THE RUN OPEN, which is what the track pen does
         and what every pen in every drawing tool does. It was Enter and a button
         only, and a gesture everybody already has in their hands should not have
         to be found on a keyboard.
         `detail > 1` AND NOT AN `onDoubleClick` HANDLER, for the reason the
         track pen gives: the second click of a double lands on the same pixel as
         the first, so the hook would refuse it as a zero-length segment — and
         "refused" and "finished" are different answers. */
      if (e.detail > 1) {
        if (canFinishOpen) finishOpenCove();
        return true;
      }
      /* CLICKING THE FIRST POINT CLOSES IT, which is the gesture everybody
         already knows from Figma — and the shape closes on its own anyway, so
         this is a way to say "done" rather than the only way to get a closed
         path. The tolerance is in PIXELS and converted, not in feet: it is
         about how accurately a person can hit a dot on screen, which does not
         change when the drawing is scaled. */
      const closeFt = Math.max(6, pxPerFt * 0.4) / pxPerFt;
      /* THE PEN ANSWERS WHICH OF THE TWO THINGS THE CLICK WAS, rather than this
         branch testing the first point itself and the hook testing it again on
         the way in. Two tests of one question is how they come to disagree. */
      if (covePen.add(at, { shiftHeld: e.shiftKey, tolFt: closeFt }) === 'closed') {
        setShapeHeld(penShape(covePen.pts));
        // THE PATH GOES WITH IT. `penDraft` and the held shape are two drawings
        // of the same outline, and leaving both up would draw it twice — the
        // dots and the rubber band over the shape they made.
        covePen.reset(); setShapeAt(null);
        return true;
      }
      setShapeAt(at);
      return true;
    }
    // A NEW SPAN REPLACES WHATEVER WAS HELD. Pressing on the plan with a shape
    // waiting for its tick means "not that one, this one" — the alternative is
    // a press that does nothing until you have found the cross.
    setShapeHeld(null);
    /* THE ROOM IS DECIDED AT THE PRESS AND HELD FOR THE WHOLE DRAG, and only a
       slot needs it. Re-deciding it per move would let a drag that strayed over
       a doorway re-target the neighbouring room halfway through, so the end you
       had already placed would jump to a wall of a room you were not drawing
       in. One press, one room. */
    const roomId = shapeTool === 'line' ? (roomForSlot(at)?.id ?? null) : null;
    setShapeSpan({ aFt: at, uniform: e.shiftKey, roomId });
    setShapeAt(at);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    return true;
  };

  /* --- THE DRAWN COVES, FOR THE CANVAS --------------------------------------
     PLAN PIXELS, because that is the space the canvas draws in, and the
     conversion is a multiply: a shape is held in the plan's own feet, whose
     origin is the drawing's own. See `ceilingShapes`.

     `lit` IS THE ONE NON-OBVIOUS FIELD. A shape over a lit space is already on
     the sheet — the room's `covesPx` carries its setting-out line and the
     accents carry its tape — so drawing it again in the shapes layer would be
     two marks for one object, at slightly different weights. A shape the layout
     did NOT take up has nothing else drawing it, and an object that disappears
     when you commit it is worse than one drawn twice. So the layer is told
     which is which and draws only the ones nobody else did. */
  const litShapeIds = useMemo(() => new Set(
    rooms.flatMap((r) => (r.coves ?? []).map((c) => c.shapeId).filter(Boolean))),
    [rooms]);

  const shapePts = useCallback((sh, grow = 0) => (pxPerFt
    ? shapeOutlineFt(sh, grow).map((q) => ({ x: q.x * pxPerFt, y: q.y * pxPerFt }))
    : []), [pxPerFt]);

  const coveShapesPx = useMemo(() => (pxPerFt ? ceilingShapes.map((sh) => ({
    id: sh.id,
    /* AN OPEN COVE IS ALWAYS "LIT", because the accent layer is always drawing
       it — it does not go through the ceiling design and so never appears in a
       room's `coves`, but it does become a run (see `accentZonesPx`) and that
       run is on the sheet whether the space has a layout or not. Without this it
       would be drawn twice: the tape, and a dashed line under it. */
    /* A GUIDE IS NEVER "LIT". `lit` means something else on this sheet is already
       drawing the shape — its setting-out line among the room's coves, its tape
       among the accents — so this layer owes it only a way to grab it. Nothing
       else draws a guide, by definition, so this layer draws it: the dashed
       outline is the whole of the mark. */
    /* `lit` MEANS SOMETHING ELSE IS ALREADY DRAWING THIS SHAPE — its
       setting-out line among the room's coves, its tape among the accents. Only
       a COVE ever is: a guide is drawn by this layer alone, and a magnetic
       track by the track layer, which draws the profile itself rather than a
       dotted line to set out from. */
    lit: shapeIsBuilt(sh) && (litShapeIds.has(sh.id) || shapeIsOpen(sh)),
    /* AND WHETHER THIS LAYER OWES IT A DASHED LINE AT ALL. A track is drawn
       SOLID, as a visible profile with modules on it — see the track layer — so
       a dotted setting-out line under it would be two marks for one object at
       two different weights, which is the exact fault `lit` exists to prevent. */
    track: shapeIsTrack(sh),
    open: shapeIsOpen(sh),
    pts: shapePts(sh),
    /* THE TAPE IS PART OF THE OBJECT AND HAS TO BE GRABBABLE TOO. On the sheet
       a drawn cove is two marks three inches apart — the dotted setting-out
       line, and the run of glowing dots outside it — and to anybody looking at
       it they are one thing. Offering the grab on only the line meant aiming at
       the fainter of the two, with the brighter one sitting right beside it
       doing nothing.
       BOTH LISTS RATHER THAN ONE FAT BAND OVER THE PAIR, because three inches
       is three inches: at low zoom the two are a pixel apart and one band covers
       both, and at high zoom they are far enough apart that a band wide enough
       to span them would be a band reaching well into the room. */
    /* NO SECOND BAND ON A SLOT. The tape and the setting-out line are three
       inches apart on a pocket and are the same line on a slot — see `outlineFt`
       — so offering both here would be two grab bands on one set of points. */
    tape: (shapeIsOpen(sh) || !shapeIsBuilt(sh)) ? null
      : shapePts(sh, STRIP_OFFSET_FT),
    /* THE FRAME AND ITS GRIPS, drawn only on the shape whose dimensions are
       being asked for. Which grips there are is a fact about the SHAPE — a
       circle has no edge to drag independently, see `handlesFor` — so it is
       answered here where the shape is, and the canvas draws what it is given. */
    frame: (() => { const f = shapeFrameFt(sh);
      return { x0: f.x0 * pxPerFt, y0: f.y0 * pxPerFt,
               x1: f.x1 * pxPerFt, y1: f.y1 * pxPerFt }; })(),
    handles: handlesFor(sh),
  })) : []), [ceilingShapes, litShapeIds, shapePts, pxPerFt]);

  const draftShapePx = useMemo(
    () => (shapeDraft && pxPerFt
      ? { pts: shapePts(shapeDraft), open: shapeIsOpen(shapeDraft) } : null),
    [shapeDraft, shapePts, pxPerFt]);

  /* THE DRAWN RUN IN FLIGHT, IN THE PEN DRAWING THE COVE PEN ALREADY HAS.
     `closed: false` is the whole difference: no dashed closing leg back to the
     first point, and no ring round it, because clicking it does nothing. See
     the canvas — one drawing, two pens, which is the same argument usePen
     makes about the state behind them. */
  const trackDraftPx = useMemo(() => {
    if (!pxPerFt || addTool !== 'track' || trackPen.isEmpty) return null;
    const toPlanPx = (q) => ({ x: q.x * pxPerFt, y: q.y * pxPerFt });
    /* CLOSED, NOW THAT THE TRACK PEN CLOSES. The dashed leg back to the first
       point and the ring round it are both promises about a click that works —
       which is exactly what they were not while this said `false`. */
    return { pts: trackPen.pts.map(toPlanPx), closed: true,
             at: trackPen.at ? toPlanPx(trackPen.at) : null };
  }, [pxPerFt, addTool, trackPen.pts, trackPen.at, trackPen.isEmpty]);

  /* THE OPEN PATH IN PLAN PIXELS. The one drawing on this canvas that shows a
     drawn run whole: `tracksPx` carries it clipped to each room it crosses (see
     `trackRunsInRoom`), and a corner that fell in a doorway appears in neither
     room's copy. */
  const trackEditPx = useMemo(() => {
    if (!pxPerFt || !trackEditId) return null;
    const t = manualTracks.find((q) => q.id === trackEditId);
    if (!t) return null;
    return { id: t.id, closed: !!t.closed,
             pts: t.ptsFt.map((q) => ({ x: q.x * pxPerFt, y: q.y * pxPerFt })) };
  }, [pxPerFt, trackEditId, manualTracks]);

  const penDraftPx = useMemo(() => {
    if (!pxPerFt || !shapeMenuOn || shapeTool !== 'pen' || covePen.isEmpty) return null;
    const toPlanPx = (q) => ({ x: q.x * pxPerFt, y: q.y * pxPerFt });
    /* CLOSED, because a cove pen's path encloses something and the canvas
       draws the closing leg dashed to say so before the click that commits it.
       The track pen hands the same drawing `closed: false`. */
    return { pts: covePen.pts.map(toPlanPx), closed: true,
             at: covePen.at ? toPlanPx(covePen.at) : null };
  }, [pxPerFt, shapeMenuOn, shapeTool, covePen.pts, covePen.at, covePen.isEmpty]);


  /**
   * ONE CLICK SEATS A PLATE ON THE NEAREST WALL THAT CAN HOLD ONE.
   *
   * FREE ALONG THE WALLS AND NOWHERE ELSE, which is the same rule dragging a
   * plate follows and is not a limitation: a switchboard off its wall is not a
   * thing, and a blue rectangle in the middle of a room is a mark nobody could
   * build from. So the click means "which piece of plaster do you mean", and
   * `nearestSeat` answers it.
   *
   * ACROSS EVERY LIT SPACE AND NOT JUST THE ONE UNDER THE POINTER. A wall is
   * shared by two rooms and a click aimed at it lands a pixel either side by
   * luck; asking `roomAt` first would make which room's wall you got depend on
   * that pixel. Every room bids with its own nearest wall and the closest wins,
   * which is the answer the pointer was actually pointing at.
   */
  const placeBoardAt = useCallback((p) => {
    if (!(pxPerFt > 0)) return;
    let best = null;
    for (const r of rooms) {
      const poly = r.plan?.polygonPx;
      if (!poly?.length) continue;
      const seat = nearestSeat(p, { polygonPx: poly, pxPerFt });
      if (!seat) continue;
      if (!best || seat.d < best.seat.d) best = { seat, roomId: r.id };
    }
    // TOO FAR FROM ANY WALL IS A MISS AND NOT A GUESS. Without a ceiling on it,
    // a click in the middle of a hall would seat a plate on whichever wall
    // happened to be nearest — twelve feet away, and nowhere near where the
    // person pointed.
    if (!best || best.seat.d > Math.max(24, pxPerFt * 4)) return;
    const id = `sb-hand-${Date.now().toString(36)}-${Math.round(Math.random() * 1e4).toString(36)}`;
    /* WHERE IT IS, AND NOTHING ABOUT WHAT IT IS. It is a socket outlet at the
       country's low-power rating because that is the DEFAULT for a hand-placed
       plate — see `boardMode` — and defaults are not written down. Both are
       changed in the panel afterwards: a checkbox for which of the two things it
       is, and a chip for the rating. */
    setManualBoards((m) => [...m, { id, roomId: best.roomId, sFt: best.seat.sFt }]);
  }, [rooms, pxPerFt]);

  /**
   * THE ANSWER, AND THE ONE THING IT TURNS ON.
   *
   * Confirming is not "save the doors" — the doors were already saved, edit by
   * edit, because they are the same list the scale and the board pass read. It
   * records that a person has LOOKED, and that is the gate the wiring is behind.
   */
  const confirmDoors = useCallback(() => {
    closeDoorEdit();
    setDoorsOk(true);
    setLayers((l) => ({ ...l, electrical: true }));
  }, [closeDoorEdit]);

  const deleteDoor = useCallback((id) => {
    setDoors((ds) => ds.filter((d) => d.id !== id));
    setSel((cur) => (idOf(cur, 'door') === id ? clear() : cur));
  }, []);

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
    shapes: coveShapesPx.map((sh) => ({ id: sh.id, pts: sh.pts })),
    /* WHATEVER THE GESTURE IS ALREADY HOLDING — the pen's own points. Passed
       per call rather than collected here because they are not a fact about the
       drawing: they exist for the length of one path. */
    points,
    exclude: excludeId,
  }), [rooms, obstaclesPx, coveShapesPx]);

  /** Screen pixels -> plan pixels. The tolerance must not stiffen as you zoom. */
  const snapTol = () => SNAP_DEFAULTS.tolScreenPx / (zoom || 1);

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

  /**
   * A PEN POINT, SNAPPED, WITH THE GUIDES TO SAY WHY.
   *
   * THE SAME BLUE DOTTED LINES THE TRACER DRAWS, and pointed at the same
   * targets — the space outlines and the objects on them. Clicking out a run
   * along a wall is the same problem as clicking out the wall was: a point a
   * hair off the line it was aimed at is wrong in exactly the way a traced
   * corner is, and a guide is the only thing on screen that says the aim has
   * been taken. Without them the pen was the one placing tool on this screen
   * with no alignment feedback at all.
   *
   * THE LOCK IS APPLIED FIRST AND THE SNAP SECOND, and the order is the whole
   * of the tricky part. The pen decides which axis a segment runs along; the
   * snap may then only move the point ALONG that axis. Snapping first would let
   * a wall three feet away pull the point off the line the pen had locked it
   * to, and the segment would come out crooked or the lock would silently be
   * undone.
   *
   * ...AND NO GUIDE IS DRAWN FOR THE FROZEN AXIS. Same rule `applySnap` states
   * below: a guide is a claim that the point took an alignment, and drawing one
   * for a coordinate the lock is about to overwrite would be a line that lies
   * about where the point is going.
   */
  /* A PLAIN FUNCTION, LIKE `applySnap` BELOW IT AND FOR ITS REASON: it is only
     ever called from a pointer handler, so there is nothing for a memo to buy
     and `snapTol` reads the live zoom rather than a captured one. */
  const penSnap = (rawPx, pen) => {
    const raw = { x: rawPx.x / pxPerFt, y: rawPx.y / pxPerFt };
    const aim = penAim(pen.pts, raw, { lock: pen.locked });
    const last = pen.pts[pen.pts.length - 1];
    // WHICH COORDINATE THE LOCK FROZE, read off the answer rather than
    // re-derived: the pen already decided, and asking again is a second rule
    // that can disagree with the first.
    const lock = (pen.locked && last)
      ? (Math.abs(aim.y - last.y) < 1e-9 ? 'y' : 'x') : null;
    const at = { x: aim.x * pxPerFt, y: aim.y * pxPerFt };
    /* THE PATH'S OWN POINTS ARE TARGETS, which is what makes clicking out a
       rectangle possible: the fourth corner lines up with the first, and no
       source in `collectTargets` knows anything about a path that is still
       being drawn. THE LAST POINT IS LEFT OUT — the segment in flight starts
       there, so on a locked pen it is already exactly aligned on one axis and
       offering it would jam the free axis onto it too, which is a pen that
       cannot leave the point it is standing on. */
    const own = pen.pts.slice(0, -1).map((q) => ({ x: q.x * pxPerFt, y: q.y * pxPerFt }));
    const r = snapPoint(at, snapTargets(null, own), { tol: snapTol() });
    setGuides(r.guides.filter((g) => g.axis !== lock));
    return { x: (lock === 'x' ? at.x : r.x) / pxPerFt,
             y: (lock === 'y' ? at.y : r.y) / pxPerFt };
  };

  /**
   * A CORNER OF ONE OF THE FIVE DRAGGED PRIMITIVES, SNAPPED, IN PLAN FEET.
   *
   * THE PEN HAD GUIDES AND THE MARQUEE DID NOT, and there was no argument for
   * the difference — only that the pen was wired up later. Dragging out a
   * rectangle a foot inside another one is the single most common thing anybody
   * does with the geometry tool, and by eye at any zoom it is a guess. So the
   * anchor and the moving corner both go through the same engine everything else
   * on this screen uses, and the blue dotted lines say what was caught.
   *
   * NO LOCK IS PASSED, and that is the one place this differs from `penSnap`.
   * Shift on a primitive does not freeze an axis — it makes the shape UNIFORM
   * (a square, a circle, an equilateral triangle), which `shapeFromDrag` applies
   * to the pair of points AFTER this — so there is no frozen coordinate for a
   * guide to lie about. Squaring up a rectangle whose corner has snapped is
   * exactly what somebody holding Shift asked for.
   *
   * IT SNAPS THE POINTER AND NOT THE RESULT. A slot's ends are then projected
   * onto the room's outline by `spanOnOutline`, and a circle is fitted into the
   * box the two corners make; in both the snap decides where the DRAG is, which
   * is the thing the guides are drawn about.
   */
  const shapeSnapFt = (rawPx) => {
    if (!pxPerFt) return { x: 0, y: 0 };
    const r = snapPoint(rawPx, snapTargets(null), { tol: snapTol() });
    setGuides(r.guides);
    return { x: r.x / pxPerFt, y: r.y / pxPerFt };
  };

  /**
   * Snap a point, publish the guides for it, and hand back where it landed.
   *
   * `lock` IS THE COORDINATE A SHIFT-DRAG HAS FROZEN — 'x' or 'y', or null for
   * an unconstrained drag. Two things follow from it and both matter.
   *
   * THE FROZEN COORDINATE SURVIVES THE SNAP. Snapping is free to pull a point
   * anywhere within tolerance, so without this a straight drag would come off
   * its line the moment it passed something worth aligning to — Shift promises a
   * straight line and the snap does not get to break that promise. The other
   * axis is snapped as usual, which is the combination actually wanted: slide
   * along the row, catch the next cassette's centre, stay exactly on the line.
   *
   * AND NO GUIDE IS DRAWN FOR IT. A guide is a claim that the drag has taken an
   * alignment; drawing one for an axis we are about to override would be a line
   * that lies about where the object is going.
   */
  const applySnap = (ptPx, excludeId, lock = null) => {
    const r = snapPoint(ptPx, snapTargets(excludeId), { tol: snapTol() });
    setGuides(r.guides.filter((g) => g.axis !== lock));
    return { x: lock === 'x' ? ptPx.x : r.x, y: lock === 'y' ? ptPx.y : r.y };
  };

  /**
   * WHERE A DRAGGED OBJECT WANTS TO BE, in plan pixels, with Shift holding it to
   * one axis. Shared by the ordinary move and by the first move of an
   * Option-drag copy, because "hold Shift to go straight" has to mean the same
   * thing whichever of the two you are doing — and holding both modifiers at
   * once (copy, in a straight line) is the gesture that lays out a row.
   *
   * THE LINE IS MEASURED FROM WHERE THE PRESS WAS, `drag.start`, not from the
   * last frame. Frame-to-frame would let the constraint creep: each frame is
   * straight relative to the one before it and the path as a whole bends. From
   * the anchor, a locked drag is on the same line however long it goes on, and
   * for a copy that anchor is the ORIGINAL — so Option+Shift leaves the twin
   * exactly level with the object it came from, which is the whole point.
   *
   * WHICHEVER AXIS HAS TRAVELLED FURTHER WINS, re-decided every frame. It is not
   * latched on the first pixel: a drag that starts off sideways and turns into a
   * vertical one switches over as it crosses the diagonal, which is what every
   * other tool with this modifier does and what the hand expects.
   */
  const moveTargetPx = (ft, drag, shift, excludeId) => {
    const ax = drag.start.x * pxPerFt, ay = drag.start.y * pxPerFt;
    const want = { x: (ft.x - drag.grabFt.x) * pxPerFt,
                   y: (ft.y - drag.grabFt.y) * pxPerFt };
    if (!shift) return applySnap(want, excludeId);
    // Travelled further across than down: it is a row, so `y` is what freezes.
    const row = Math.abs(want.x - ax) >= Math.abs(want.y - ay);
    return applySnap(row ? { x: want.x, y: ay } : { x: ax, y: want.y },
                     excludeId, row ? 'y' : 'x');
  };

  const objPointerDown = (e, id, mode, corner = null) => {
    if (e.button != null && e.button !== 0) return;   // middle button is the pan
    if (!pxPerFt) return;
    e.stopPropagation();
    e.preventDefault();

    /* SHIFT-CLICK BUILDS THE SELECTION AND STARTS NO DRAG, and that separation
       is what lets one modifier do two jobs without either being ambiguous.
       Shift on a PRESS adds or removes an object; Shift during a DRAG holds it
       to one axis. A press cannot yet know whether it will become a drag, so
       guessing here would mean either a click that sometimes nudged the object
       or an axis lock you could not engage without first deselecting something.
       Split by gesture instead: Shift-click to gather them up, then press
       WITHOUT Shift on any member to drag the group, adding Shift mid-drag for
       the straight line. Both modifiers are still available for the group. */
    if (mode === 'move' && e.shiftKey) {
      setObjMode(true); setArmed(null); setGuides([]); setGhost(null);
      toggleSelObj(id);
      return;
    }

    const svg = svgRef.current;
    svg?.setPointerCapture?.(e.pointerId);
    const o = ceilingObjs.find((q) => q.id === id);
    if (!o) return;
    setObjMode(true);
    setArmed(null); setGuides([]); setGhost(null);

    /* PRESSING A MEMBER OF THE SELECTION DRAGS ALL OF IT; pressing anything
       else makes that one thing the selection. This is the rule that makes a
       multi-selection worth having — gather four cassettes, then move them as
       one — and it is also what stops a stale selection biting: a press on an
       object that is not in the group replaces the group rather than dragging a
       set the user has stopped thinking about.

       A HANDLE IS ALWAYS SINGULAR. Resize and rotate act on one object's own
       frame, and the handles are only drawn when exactly one thing is selected
       (see PlanCanvas), so a resize press can only ever mean `[id]`. */
    const group = mode === 'move' && selObjIds.includes(id) ? selObjIds : [id];
    setSel(selectMany('object', group));

    const p = svgPoint(e);
    const ft = { x: p.x / pxPerFt, y: p.y / pxPerFt };
    setObjDrag({
      id, mode, corner, pointerId: e.pointerId,
      grabFt: { x: ft.x - o.x, y: ft.y - o.y },
      startRot: o.rot || 0,
      startAngle: Math.atan2(ft.y - o.y, ft.x - o.x),
      start: { ...o },
      /* WHO IS MOVING, AND WHERE THEY ALL WERE WHEN IT STARTED. The group is
         moved by applying ONE delta to each member's snapshot rather than by
         accumulating per-frame offsets: accumulation drifts, and a set of
         cassettes that no longer line up with each other after a long drag is a
         set somebody has to fix by hand. `startAll` is also what the Option copy
         restores the originals from. */
      group,
      startAll: Object.fromEntries(ceilingObjs
        .filter((q) => group.includes(q.id))
        .map((q) => [q.id, { ...q }])),
      moved: false,
      /* HAS THIS DRAG ALREADY LEFT A COPY BEHIND? Nothing about the modifier is
         recorded here — see the note in `objPointerMove`, which reads Option
         live off every move event. This flag exists only so the twin is made
         once and not once per frame. */
      copied: false,
    });
  };

  const objPointerMove = (e) => {
    if (!objDrag || !pxPerFt) return;
    const p = svgPoint(e);
    const ft = { x: p.x / pxPerFt, y: p.y / pxPerFt };

    /* OPTION-DRAG LEAVES A COPY BEHIND — a fan, a cassette, a chandelier, any of
       them, because they are one collection with a type on each row and nothing
       in here reads the type.

       THE MODIFIER IS READ LIVE, OFF EVERY MOVE EVENT, AND THE ORDER OF THE TWO
       DOES NOT MATTER. It was latched at the press — `e.altKey` recorded in
       `objPointerDown` — which meant Option had to be down BEFORE the object was
       even touched, and that is not how anyone reaches for it: you pick the
       thing up, you see it move, and then you decide you wanted a copy. Read
       here, "Option then drag" and "drag then Option" are the same gesture, and
       it sits with every other modifier on this canvas rather than being the one
       exception — Shift locks a ratio, Alt resizes from the centre, all read
       from the move event that uses them.

       THE ORIGINAL IS PUT BACK WHERE IT WAS PICKED UP. This is what reading the
       modifier late actually costs, and it has to be paid: by the time Option
       arrives the original may have been dragged half way across the room, and
       leaving it there would mean one gesture both moved a thing and copied it —
       two edits, one of which nobody asked for. `objDrag.start` is the object as
       it was at the press, so restoring from it returns the position AND any
       rotation the drag had touched. When Option was already down at the press
       the original never moved and this is a no-op.

       THE TWIN IS WHAT KEEPS MOVING, which is the convention everywhere this
       gesture exists and the one that makes a row of cassettes possible: drag,
       Option, release — and the thing you just positioned is the one still
       selected, ready to be dragged again.

       ONCE MADE, IT STAYS MADE. `copied` latches, so letting go of Option
       mid-drag does not un-create the twin or hand the drag back to the
       original; it simply carries on moving what is now under the pointer. A
       modifier that can undo a thing it already did is a modifier you cannot
       let go of.

       AND NOTHING HAPPENS WITHOUT MOVEMENT. Pressing a key fires no
       `pointermove`, so Option on a held-still object mints nothing: no
       invisible duplicate stacked exactly on its original, doubling a schedule
       line where nobody can see it.

       ONE `setCeilingObjs` DOING THE RESTORE AND THE CLONE TOGETHER, then a
       return. `objDrag` in this closure is the value from the render that
       installed this handler, so the retarget below cannot be seen by the code
       after it — a second `setCeilingObjs` here would move the ORIGINAL. Every
       later move event sees the new id and takes the ordinary path.

       THE TWIN MAY SNAP TO THE OBJECT IT CAME FROM. `applySnap` is told to
       exclude the TWIN's id, which is not in the list yet, so nothing is
       excluded and the original is a live snap target — which is exactly what
       lining a second cassette up with the first wants. */
    if (objDrag.mode === 'move' && !objDrag.copied && e.altKey) {
      /* THE IDS ARE MINTED BEFORE THE SNAP so the snapper can be told to ignore
         them — they are not in the list yet, so nothing is actually excluded and
         the ORIGINALS stay live targets. That is the alignment worth having: the
         copy catches the centre of the thing it came from. */
      const pairs = objDrag.group.map((gid) => (
        { gid, twinId: newCeilingObjectId(), base: objDrag.startAll[gid] }
      )).filter((q) => q.base);
      if (!pairs.length) return;
      const at = moveTargetPx(ft, objDrag, e.shiftKey, pairs.map((q) => q.twinId));
      const dx = at.x / pxPerFt - objDrag.start.x;
      const dy = at.y / pxPerFt - objDrag.start.y;
      const twins = pairs.map(({ twinId, base }) => (
        { ...base, id: twinId, x: base.x + dx, y: base.y + dy }
      ));
      setCeilingObjs((os) => [
        // Every original straight back to where it was picked up.
        ...os.map((o) => (objDrag.startAll[o.id] ? { ...objDrag.startAll[o.id] } : o)),
        ...twins,
      ]);
      setSel(selectMany('object', twins.map((t) => t.id)));
      setObjDrag((d) => (d ? {
        ...d,
        // The drag transfers to the twin of the object under the pointer, and the
        // anchor is untouched: `start` is still the ORIGINAL's position, so later
        // frames go on computing one delta from the press and applying it to
        // these snapshots exactly as a plain group move does.
        id: pairs.find((q) => q.gid === d.id)?.twinId ?? twins[0].id,
        group: twins.map((t) => t.id),
        startAll: Object.fromEntries(pairs.map(({ twinId, base }) => [twinId, { ...base, id: twinId }])),
        copied: true, moved: true,
      } : d));
      return;
    }

    if (!objDrag.moved) setObjDrag((d) => (d ? { ...d, moved: true } : d));

    /* THE MOVE IS THE ONE GESTURE THAT CAN TOUCH MORE THAN ONE OBJECT, so it is
       lifted out of the per-object map below rather than living inside it.
       Resize and rotate stay in there and stay singular: their handles are only
       drawn when exactly one thing is selected.
       THE OBJECT UNDER THE POINTER IS WHAT SNAPS, and everything else follows by
       the same delta. Snapping each member independently would pull the group
       apart — four cassettes would each find their own nearest alignment and
       arrive no longer in a row. And it is the CENTRE that snaps, not the
       pointer: aligning on wherever inside the object you happened to grab it
       would make the same drag land differently each time.
       Shift holds the delta to one axis — see `moveTargetPx`. */
    if (objDrag.mode === 'move') {
      const at = moveTargetPx(ft, objDrag, e.shiftKey, objDrag.group);
      const dx = at.x / pxPerFt - objDrag.start.x;
      const dy = at.y / pxPerFt - objDrag.start.y;
      setCeilingObjs((os) => os.map((o) => {
        const base = objDrag.startAll[o.id];
        return base ? { ...o, x: base.x + dx, y: base.y + dy } : o;
      }));
      return;
    }

    setCeilingObjs((os) => os.map((o) => {
      if (o.id !== objDrag.id) return o;
      if (objDrag.mode === 'resize') {
        if (guides.length) setGuides([]);
        const base = objDrag.start;
        const { hw, hh } = halfExtents(base);
        const next = resizeFromCorner(
          { wFt: hw * 2, hFt: hh * 2, x: base.x, y: base.y, rot: base.rot || 0 },
          objDrag.corner, ft,
          // Shift locks the ratio; a round object has no ratio to unlock. Alt
          // resizes about the centre instead of the opposite corner.
          { uniform: e.shiftKey || isUniform(base), fromCentre: e.altKey });
        return applyResize(o, next);
      }
      if (objDrag.mode === 'rotate') {
        if (guides.length) setGuides([]);
        return { ...o, rot: rotateTo(o, ft, {
          startRot: objDrag.startRot, startAngle: objDrag.startAngle, snap: e.shiftKey }) };
      }
      return o;
    }));
  };

  const objPointerUp = () => { if (objDrag) { setObjDrag(null); setGuides([]); } };

  /**
   * Editing an accent fitting.
   *
   * Everything here is in PLAN PIXELS, unlike the ceiling objects, and it is
   * worth knowing why the two differ. A ceiling object is a real thing of a
   * real size that someone placed, so it is held in feet and survives a scale
   * correction. An accent fitting is DERIVED — from a box the model drew on a
   * crop, projected onto a wall that is itself in plan pixels — so pixels are
   * the space it already lives in, and converting to feet and back would only
   * add two roundings to every drag.
   */
  /**
   * APPLY AN EDIT TO ONE ACCENT FITTING, WHEREVER IT LIVES.
   *
   * THIS IS THE FIX FOR A REAL BUG: a strip or sconce placed BY HAND could not
   * be moved at all. The grips appeared, the drag armed, and nothing happened.
   *
   * The cause is that accent fittings live in two stores and the editor only
   * knew one. `accentResults[roomId].zones` holds what the accent pass produced;
   * `manualAccents` is a flat list of the ones placed with the palette. The
   * canvas draws the MERGE of the two (see accentZonesPx), so a hand-placed
   * strip looks and behaves identically right up until it is dragged, at which
   * point the write went `setAccentResults(...)` and the id was not in there.
   * Worse in a room with no accent pass at all, where `res?.zones` is undefined
   * and the updater bailed on the first line.
   *
   * SO THE WRITE FOLLOWS THE ZONE INSTEAD OF ASSUMING THE STORE. Both updaters
   * run; each returns its own state UNCHANGED when the id is not one of its
   * own, so the miss costs a referential no-op and never a re-render. That is
   * deliberately not "look up which store first" — the lookup would have to
   * happen outside a setState updater, against a possibly stale copy, which is
   * the same class of bug one level down.
   *
   * `fn` must be pure: it can be invoked more than once for one edit.
   */
  const updateAccentZone = useCallback((roomId, id, fn) => {
    setManualAccents((list) => (list.some((z) => z.id === id)
      ? list.map((z) => (z.id === id ? fn(z) : z))
      : list));
    setAccentResults((m) => {
      const res = m[roomId];
      if (!res?.zones || !res.zones.some((z) => z.id === id)) return m;
      return { ...m, [roomId]: { ...res, zones: res.zones.map((z) => (z.id === id ? fn(z) : z)) } };
    });
  }, []);

  const accPointerDown = (e, roomId, id, mode) => {
    if (e.button != null && e.button !== 0) return;   // middle button is the pan
    // A DERIVED RUN HAS NO BODY DRAG. A reverse cove is a slot at a wall and a
    // shelf strip is inside joinery: neither can be picked up and moved
    // somewhere else, because neither is a thing somebody placed. Only the ends
    // move, and they only move along the run's own axis. The canvas does not
    // offer the body handle for these, and this is the second half of that —
    // belt and braces on the one gesture that would silently do nothing.
    const derived = accentZonesPx.find((z) => z.id === id && z.derived);
    if (derived && mode !== 'end0' && mode !== 'end1') {
      // ...but it is still SELECTABLE, and it has to be: without a body handle
      // there would be nothing on it to click, and a fitting you cannot select
      // is one you cannot find the grips of.
      e.stopPropagation();
      e.preventDefault();
      setSel(select('acc', id)); setArmed(null);
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    svgRef.current?.setPointerCapture?.(e.pointerId);
    setSel(select('acc', id));
    setArmed(null);
    // WHERE THE GESTURE STARTED, twice over. `from` advances with the pointer,
    // because a run must move by the DELTA and not jump to centre itself under
    // the cursor — grab a strip near one end and it stays grabbed near that end.
    // `origin` does not, because it is what the drag threshold is measured from.
    const at = svgPoint(e);
    setAccDrag({ roomId, id, mode, pointerId: e.pointerId, from: at, origin: at, live: false,
                 // Carried on the GESTURE, not looked up per frame. The item is
                 // rebuilt by a memo on every trim, so a fresh lookup mid-drag
                 // would read the base off the run the last frame produced and
                 // the end would run away from the pointer.
                 derived: derived
                   ? { trimId: derived.trimId, horizontal: derived.horizontal,
                       base: derived.base }
                   : null });
  };

  /**
   * The tolerances, converted once per drag.
   *
   * accentPlace quotes them in feet — a snap should be the same size on a site
   * plan at 6 px/ft as on a flat at 40 — and everything here is in plan pixels,
   * so this is the one place the two meet.
   */
  const runOpts = (roomId, e) => {
    const r = rooms.find((q) => q.id === roomId);
    return {
      polygon: r?.plan?.polygonPx ?? null,
      snap: RUN_EDIT.snapFt * (pxPerFt || 1),
      minLen: RUN_EDIT.minLenFt * (pxPerFt || 1),
      // Shift pins the end to the run's existing axis: the old wall-slide
      // behaviour, on demand rather than as the only option.
      constrain: !!e?.shiftKey,
    };
  };

  const accPointerMove = (e) => {
    if (!accDrag) return;
    const p = svgPoint(e);

    // A CLICK IS NOT A DRAG. Pointerdown on a strip's body both selects it and
    // arms the move, because needing one click to select and a second to drag
    // is the thing that makes a canvas feel slow. The cost of that is that
    // every plain click would otherwise translate the run by whatever fraction
    // of a pixel the hand wobbled, and mark it `edited` for it — a fitting
    // claiming to have been moved by hand when nobody moved it.
    //
    // So the move does not begin until the pointer has genuinely travelled.
    // Measured from the ORIGIN, not from the last frame, so a slow drag still
    // crosses it.
    if (accDrag.mode === 'move' && !accDrag.live) {
      const slop = Math.max(2, DRAG_SLOP_PX / (zoom || 1));
      if (Math.hypot(p.x - accDrag.origin.x, p.y - accDrag.origin.y) < slop) return;
      setAccDrag((d) => (d ? { ...d, live: true, from: d.origin } : d));
    }

    // --- a derived run: the ends write a TRIM, and nothing else moves.
    if (accDrag.derived) {
      const { trimId, horizontal, base } = accDrag.derived;
      if (!base || !(pxPerFt > 0)) return;
      // Only the along-wall component of the pointer counts. A cove is on its
      // wall and stays there, so the across component is not a degree of
      // freedom — dragging away from the wall shortens nothing.
      const v = horizontal ? p.x : p.y;
      // Shift is the FINE drag here — the opposite hand of the same key on an
      // ordinary strip, where it locks the axis. There is no axis to lock on a
      // run that only moves along one, so the modifier is spent on the thing
      // there is a use for: the exact position, off the setting-out increment.
      const step = e?.shiftKey ? 0 : RUN_TRIM.snapFt;
      const round = (ft) => (step > 0 ? Math.round(ft / step) * step : ft);
      setRunTrims((m) => {
        const cur = m[trimId] ?? { a: 0, b: 0 };
        const next = accDrag.mode === 'end0'
          ? { ...cur, a: round((v - base.lo) / pxPerFt) }
          : { ...cur, b: round((base.hi - v) / pxPerFt) };
        // BACK TO NOTHING RATHER THAN TO ZERO. A run dragged to where the rule
        // put it is a run with no edit on it, and leaving {a:0,b:0} behind would
        // mark it as hand-edited for ever and keep a row in the saved plan.
        if (Math.abs(next.a) < 1e-6 && Math.abs(next.b) < 1e-6) {
          if (!(trimId in m)) return m;
          const out = { ...m }; delete out[trimId]; return out;
        }
        return { ...m, [trimId]: next };
      });
      return;
    }

    const o = runOpts(accDrag.roomId, e);
    updateAccentZone(accDrag.roomId, accDrag.id, (z) => {
      if (accDrag.mode === 'slide') return slideSconceTo(z, p);
      if (accDrag.mode === 'end0') return setRunEnd(z, 0, p, o);
      if (accDrag.mode === 'end1') return setRunEnd(z, 1, p, o);
      if (accDrag.mode === 'move') return moveRun(z, p, accDrag.from, o);
      return z;
    });
    // The body drag is relative, so the origin advances with the pointer.
    if (accDrag.mode === 'move') setAccDrag((d) => (d ? { ...d, from: p } : d));
  };

  const accPointerUp = () => {
    if (!accDrag) return;
    // A derived run keeps no per-gesture state on itself — the trim is the whole
    // of it — so there is nothing to tidy up.
    if (accDrag.derived) { setAccDrag(null); return; }
    // The snap indicator is a property of the GESTURE, not of the fitting, so
    // it goes when the gesture does. Left on the zone it would draw a guide
    // line through a strip nobody is touching.
    const { roomId, id } = accDrag;
    updateAccentZone(roomId, id, (z) => (z.snap ? { ...z, snap: null } : z));
    setAccDrag(null);
  };

  // --- picking a spot, and deleting one ---------------------------------------

  /**
   * A CLICK ON A DIRECTIONAL SPOT PICKS IT.
   *
   * Same gesture, same shape and the same three lines as `accPointerDown` — one
   * selection at a time, and arming a tool is cancelled — because a person
   * should not have to know which kind of fitting they are pointing at to know
   * what clicking it does.
   *
   * NO DRAG. A spot is not dragged and this is not a stub for one: where it goes
   * is a consequence of what it lights and of the grid it stands on, and a spot
   * moved by hand would be a fitting the placer no longer explains — the arrow,
   * the segment, the track absorption and the panel's account of it would all
   * still describe the position it was dragged away from. Moving the SURFACE is
   * how you move the spot.
   *
   * AND IT SELECTS THE SPACE. Clicking a fitting in a room the panel is not
   * describing and having the panel stay on the last room is the disagreement
   * the canvas selection exists to prevent — the same argument as
   * `pickChunkOptions`.
   */
  const spotPointerDown = (e, id) => {
    if (e.button != null && e.button !== 0) return;   // middle button is the pan
    /* A TOOL IN HAND WINS, AND SO DOES A ZONE BEING DRAWN. While something is
       armed for placement the next click belongs to the ceiling underneath —
       somebody dropping a strip beside a spot, or boxing a no-light zone across
       it, is aiming at the drawing and not at the fitting in the way. So this
       does not intercept, and the click falls through to the canvas exactly as
       if the fitting were not there.

       EXCEPT THE SPOT TOOL ITSELF, and that exception is what makes a spot
       deletable. Arming the spot opens a STEP that stays open until Done is
       pressed (see `stepTool`), so for the whole of the time somebody is placing
       spots, every spot on the drawing was unselectable — place one, notice it
       is wrong, and there was no way to pick it up. Worse than nothing
       happening: Delete then fell past every branch below to the SPACE, and took
       the room out of the layout.

       IT IS SAFE FOR THIS TOOL AND NOT FOR THE OTHERS BECAUSE OF THE GESTURE. A
       spot is placed by DRAGGING a box over open ceiling; the pens place a point
       on press, and a press stolen from a pen is a corner that never lands. A
       press that starts on an existing spot is a press on a fitting a few pixels
       across, and selecting it is what somebody meant. Dragging a box that
       happens to cover one still works — start it anywhere but on the fitting. */
    if ((addTool && addTool !== 'spot') || zoneMode) return;
    e.stopPropagation();
    e.preventDefault();
    setSel(select('spot', id));
    setArmed(null);
    const sp = taskSpotsPx.find((q) => q.id === id);
    if (sp?.roomId) setFocusId(sp.roomId);
  };

  /**
   * PICKING UP A COB SOMEBODY PLACED — and it can be MOVED, which is a reversal.
   *
   * IT USED TO BE SELECTION ONLY, and the note here argued that a fitting which
   * could be nudged by a press meant to select it would quietly undo the one act
   * it exists to record. The argument was about a press that acts immediately;
   * it is answered by the drag slop rather than by refusing the gesture. A press
   * that never travels three screen pixels is still a click and still only
   * selects; past that it is a move, because somebody has visibly asked for one.
   * See `movedEnough` in lib/dragMove.js.
   *
   * WHAT IT DOES NOT DO IS RESIZE OR ROTATE. A downlight is a round hole of a
   * size the catalogue decides and it has no orientation, so the frame of grips
   * a ceiling object carries would be three controls that cannot do anything.
   * Position is the whole of what a person chooses about one.
   *
   * NOT WHILE ANY TOOL IS ARMED, and this one has no exemption of the sort the
   * spot grants itself. The COB's own gesture is a press on open ceiling that
   * places a lamp, so a press stolen by the lamp already there would make the
   * one thing somebody does twenty times in a row fail the moment two of them
   * were near each other. Put the tool down to pick one up — which is one press
   * on the cell that is latched right in front of them.
   *
   * THE POINTER IS CAPTURED ON THE SVG, exactly as the object drag captures it:
   * a lamp dragged toward the edge of the sheet routinely releases outside the
   * element the press landed on, and without capture that release is somebody
   * else's event and the drag never ends.
   */
  const cobPointerDown = (e, id) => {
    if (e.button != null && e.button !== 0) return;   // middle button is the pan
    if (addTool || zoneMode || armed || boardPlace || !pxPerFt) return;
    /* --- A LAMP THAT BELONGS TO AN ARRAY IS NOT A LAMP YOU CAN PICK UP -------
       The canvas draws the hand-placed lamps and every array's lamps in ONE list
       — on the ceiling they are the same fitting, see the note at the call site
       — so this handler receives both, and the id is the only thing that says
       which. A hand-placed one is in `manualCobs`; an array's is a memo worked
       out from a geometry and a count, and there is nothing about it on its own
       to select or to move.
       SO THE PRESS RESOLVES TO THE ARRAY. That is what somebody aiming at one of
       twelve lamps on a ring has actually got hold of, and the array is a thing
       with a specification, a count and a position. See `arrayGrab`. */
    const own = arrayCobsPx.find((q) => q.id === id);
    if (own) { arrayGrab(e, own.arrayId); return; }
    const c = manualCobs.find((q) => q.id === id);
    if (!c) return;
    e.stopPropagation();
    e.preventDefault();
    setSel(select('cob', id));
    setArmed(null);
    /* THE SPACE AND THE TAB ARE NOT SET HERE. Selecting a fitting reveals it in
       the Analysis, and that is one behaviour shared by every fitting on this
       canvas — so it lives in one effect over `analysisHighlight` rather than
       being written out in this handler and the three like it. */

    svgRef.current?.setPointerCapture?.(e.pointerId);
    const p = svgPoint(e);
    const centre = { x: c.xFt * pxPerFt, y: c.yFt * pxPerFt };
    setCobDrag({
      id, pointerId: e.pointerId,
      /* WHERE INSIDE THE LAMP IT WAS GRABBED, subtracted from every later
         pointer position so the symbol does not jump to centre itself under the
         cursor on the first move. */
      grabPx: grabOffset(p, centre),
      /* WHERE IT WAS AT THE PRESS. Every frame's delta is measured from here and
         never from the frame before — see rule 2 in lib/dragMove.js — and it is
         also the anchor the ortho lock holds the line to, and what the Option
         copy puts the original back to. */
      start: centre,
      from: p,
      /* WHO IS MOVING AND WHAT THEY LOOKED LIKE. One lamp today, because a COB
         has no multi-selection; kept in the group shape anyway so that adding
         one is a change to the SELECTION and not to this gesture. */
      group: [id],
      startAll: { [id]: { ...c } },
      moved: false,
      copied: false,
    });
  };

  /**
   * THE LAMP FOLLOWING THE POINTER — and, if Option arrives, its twin.
   *
   * EVERYTHING IN PLAN FEET AT THE STORE AND PLAN PIXELS AT THE POINTER, which
   * is why `at`/`to` are handed to the library: `manualCobs` holds `xFt`/`yFt`
   * so that a scale correction does not move a lamp (see the store's own note),
   * and the pointer only ever speaks pixels.
   */
  const cobPointerMove = (e) => {
    if (!cobDrag || !pxPerFt) return;
    const p = svgPoint(e);
    /* NOT A DRAG UNTIL IT HAS TRAVELLED. Before that this handler does nothing
       at all: no write, no guides, no copy — so a click that wobbles is a click.
       Once past the slop the flag latches and stays latched, because a drag that
       came back to within three pixels of its origin is still a drag. */
    if (!cobDrag.moved) {
      if (!movedEnough(cobDrag.from, p, { zoom })) return;
      setCobDrag((d) => (d ? { ...d, moved: true } : d));
    }

    /* PLAN FEET IN, PLAN FEET OUT — the two adapters the library asks for. */
    const inFt = (o) => ({ x: o.xFt * pxPerFt, y: o.yFt * pxPerFt });
    const outFt = (o, q) => ({ ...o, xFt: q.x / pxPerFt, yFt: q.y / pxPerFt,
                               roomId: roomAt(q)?.id ?? o.roomId,
                               /* MOVING A LAMP ADOPTS IT. It is no longer where
                                  the rule put it, so switching autoplace off
                                  must not take it away — see `autoplaceIn`. */
                               auto: false });

    /* --- OPTION LEAVES A COPY BEHIND ------------------------------------
       READ LIVE OFF THE MOVE and not latched at the press, so "Option then
       drag" and "drag then Option" are the same gesture. `forkCopy` puts the
       original back where it was picked up, which is what reading the modifier
       late costs — see its note. The twins' ids are minted first so they can be
       kept out of the snap targets, which leaves the ORIGINAL a live target:
       exactly what lining a second lamp up with the first wants.
       ONE WRITE DOING THE RESTORE AND THE CLONE TOGETHER, then a return. Every
       line below this branch reads `cobDrag` as it was when this handler was
       created — the retarget has not landed yet — so a second pass through them
       would take the ORIGINAL for the twin and move it after all. */
    if (!cobDrag.copied && e.altKey) {
      /* THE IDS ARE MINTED HERE, OUTSIDE THE WRITE, and that is not tidiness.
         `setManualCobs` takes an UPDATER because two moves can fire before a
         re-render and a plain value would write a stale list — but an updater
         runs whenever React chooses, so anything computed inside it is not
         available to the two lines after it. The retarget below needs to know
         which twin each original became, so the mapping is decided up front and
         `forkCopy` is handed a minter that reads it. */
      const pairs = cobDrag.group
        .map((gid, i) => ({ gid, twinId: newCobId(`c${i}`), base: cobDrag.startAll[gid] }))
        .filter((q) => q.base);
      if (!pairs.length) return;
      const twinOf = Object.fromEntries(pairs.map((q) => [q.gid, q.twinId]));
      /* THE TWINS ARE EXCLUDED FROM THE SNAP TARGETS — they are not in the list
         yet, so nothing is actually excluded and the ORIGINALS stay live, which
         is exactly what lining a copy up with the lamp it came from wants. */
      const at = cobMoveTarget(p, cobDrag, e.shiftKey, pairs.map((q) => q.twinId));
      const d = deltaFrom(cobDrag.start, at);
      setManualCobs((list) => forkCopy(list, cobDrag.startAll, d,
        (_n, base) => twinOf[base.id], { at: inFt, to: outFt }).list);
      setCobDrag((cur) => (cur ? {
        ...cur,
        /* THE DRAG TRANSFERS TO THE TWIN and the anchor is untouched: `start` is
           still the ORIGINAL's position, so later frames go on computing one
           delta from the press and applying it to these snapshots exactly as a
           plain move does. */
        id: twinOf[cur.id] ?? pairs[0].twinId,
        group: pairs.map((q) => q.twinId),
        startAll: Object.fromEntries(
          pairs.map(({ twinId, base }) => [twinId, { ...base, id: twinId }])),
        copied: true, moved: true,
      } : cur));
      setSel(select('cob', twinOf[cobDrag.id] ?? pairs[0].twinId));
      return;
    }

    const at = cobMoveTarget(p, cobDrag, e.shiftKey, cobDrag.group);
    const d = deltaFrom(cobDrag.start, at);
    setManualCobs((list) => applyDelta(list, cobDrag.startAll, d,
                                       { at: inFt, to: outFt }));
  };

  /**
   * LETTING GO.
   *
   * A LAMP DROPPED OFF EVERY CEILING GOES BACK WHERE IT CAME FROM, and that is
   * the one thing this does beyond clearing the gesture. `roomId` is what the
   * Analysis counts a lamp under, what its throw is clipped to and what its
   * ceiling height is read from, so a lamp belonging to no space is a fitting
   * that is drawn on the sheet, absent from every reading of it, and impossible
   * to account for. Refusing the drop is kinder than keeping a stale `roomId`,
   * which would put a lamp visibly in the hall and count it in the bedroom.
   */
  const cobPointerUp = () => {
    if (!cobDrag) return;
    if (cobDrag.moved) {
      setManualCobs((list) => list.map((c) => {
        if (!cobDrag.group.includes(c.id)) return c;
        if (c.roomId && roomAt({ x: c.xFt * pxPerFt, y: c.yFt * pxPerFt })) return c;
        const base = cobDrag.startAll[c.id];
        return base ? { ...c, xFt: base.xFt, yFt: base.yFt, roomId: base.roomId } : c;
      }));
    }
    setCobDrag(null);
    setGuides([]);
  };

  /* --- AN ARRAY: OPENED BY ITS LAMPS, CARRIED BY ANY OF THEM -----------------

     ONE PRESS, TWO ANSWERS, AND THE SLOP DECIDES WHICH. A press that never
     travels is a click and only opens the array; past three screen pixels it is
     a move, because somebody has visibly asked for one. That is rule 1 in
     lib/dragMove.js and it is what lets one gesture both select and drag without
     a click that wobbles quietly shifting a run of twelve lamps.

     WHAT MOVES IS THE ARRAY AND NOT THE GEOMETRY UNDER IT. See `shiftPts` in
     lib/cob.js: an array records which geometry it is set out on and what it did
     to it, and a displacement is one more entry in the second list. The
     rectangle keeps its position, the cove drawn on it keeps its position, and
     editing the rectangle still carries the run with it — which is the thing the
     reference was for.

     IT ALSO OPENS THE ARRAY'S OWN BAR AND CLOSES EVERY OTHER ONE. Two
     contextual bars are pinned to the same place at the foot of the stage — see
     the note on BOTTOM in CobSpec — so "the one you just opened" has to be the
     only one up. `closeContextual` is that rule in one place. */
  const arrayGrab = (e, arrayId) => {
    const a = cobArrays.find((q) => q.id === arrayId);
    if (!a || !pxPerFt) return;
    e.stopPropagation();
    e.preventDefault();
    /* THE PRESS IS SPOKEN FOR, so the click the browser synthesises on release
       is not read as a press on bare plan — which would clear the selection and
       swap the array's bar for the space's geometry tools, forty milliseconds
       after opening it. Same flag every grip on this canvas sets. */
    shapeTook.current = true;
    openArray(arrayId);
    svgRef.current?.setPointerCapture?.(e.pointerId);
    const p = svgPoint(e);
    setArrayDrag({
      id: arrayId, pointerId: e.pointerId,
      from: p,
      // WHERE THE RUN ALREADY WAS. Every frame's delta is measured from here and
      // never from the frame before it — rule 2 in lib/dragMove.js.
      base: { x: a.dxFt || 0, y: a.dyFt || 0 },
      moved: false,
    });
  };

  const arrayPointerMove = (e) => {
    if (!arrayDrag || !pxPerFt) return;
    const p = svgPoint(e);
    if (!arrayDrag.moved) {
      if (!movedEnough(arrayDrag.from, p, { zoom })) return;
      setArrayDrag((d) => (d ? { ...d, moved: true } : d));
    }
    /* SHIFT HOLDS IT TO ONE AXIS, from the anchor rather than from the last
       frame, so a run nudged sideways stays exactly level with where it was —
       which is the whole reason anybody reaches for the modifier here. No guide
       is drawn for the frozen axis, and none is drawn for the free one either:
       an array is set out on a geometry, and a dotted line claiming it had found
       an alignment of its own would be a claim about the wrong object. */
    const want = { x: p.x - arrayDrag.from.x, y: p.y - arrayDrag.from.y };
    const { at } = orthoLock(want, { x: 0, y: 0 }, e.shiftKey);
    setCobArrays((l) => l.map((q) => (q.id === arrayDrag.id
      ? { ...q, dxFt: arrayDrag.base.x + at.x / pxPerFt,
                dyFt: arrayDrag.base.y + at.y / pxPerFt }
      : q)));
  };

  /**
   * LETTING GO OF A RUN.
   *
   * A RUN DROPPED OFF EVERY CEILING GOES BACK WHERE IT CAME FROM — the lamp
   * drag's own rule (see `cobPointerUp`), said about twelve at once and there
   * for its reason rather than as a tidy-up. An array's `roomId` is what the
   * Analysis counts it under, what its pools are clipped to and what its ceiling
   * height is read from; carried clear of that room it would be a row of
   * fittings drawn in the hall, counted in the bedroom, and clipped to a
   * polygon they are nowhere near — visible on the sheet and absent from every
   * reading of it.
   *
   * ANY ONE LAMP INSIDE A ROOM IS ENOUGH, and it is deliberately that lenient. A
   * ring set out on a room's own outline has lamps ON the walls, and a strict
   * "every lamp is inside" test would refuse the array's ordinary position. What
   * this catches is the run carried right off the plan.
   */
  const arrayPointerUp = () => {
    if (!arrayDrag) return;
    if (arrayDrag.moved) {
      const own = arrayCobsPx.filter((c) => c.arrayId === arrayDrag.id);
      if (own.length && !own.some((c) => roomAt({ x: c.x, y: c.y }))) {
        setCobArrays((l) => l.map((q) => (q.id === arrayDrag.id
          ? { ...q, dxFt: arrayDrag.base.x, dyFt: arrayDrag.base.y } : q)));
      }
    }
    setArrayDrag(null);
  };

  /* --- A MODULE, PICKED UP AND SLID ALONG ITS RUN ---------------------------

     ONE AXIS, AND IT IS NOT A CONSTRAINT THIS APP INVENTED. A module clips
     anywhere along a magnetic profile and nowhere across one, so "move it" can
     only mean "move it along" — which is why the drag resolves the pointer to a
     FRACTION of the path rather than to a point. Drag it out into the middle of
     the room and it slides to the nearest place on the rail, which is the honest
     answer rather than a refusal.

     THE SAME SLOP EVERY OTHER DRAG ON THIS CANVAS USES, so a press that only
     meant to select does not nudge a fitting three pixels — rule 1 in
     lib/dragMove.js.

     AND IT WILL NOT SIT ON ANOTHER ONE. `placeableU` is what the placing press
     runs too, with this module excluded from what it has to clear: two bodies
     cannot share an inch of extrusion, so a drag that would overlap lands at the
     nearest gap instead of stacking. Excluded rather than included, because a
     module always clashes with itself. */
  const modulePointerDown = (e, id) => {
    if (e.button != null && e.button !== 0) return;
    if (addTool === 'module') return;   // a press with the tool in hand PLACES one
    if (addTool || zoneMode || armed || boardPlace || !pxPerFt) return;
    const f = trackFixtures.find((q) => q.id === id);
    if (!f) return;
    e.stopPropagation();
    e.preventDefault();
    /* THE PRESS IS SPOKEN FOR, so the click the browser synthesises on release is
       not read as one on bare plan — which would clear the selection and swap
       whatever bar is up for the space's own. */
    shapeTook.current = true;
    setSel(select('module', id));
    svgRef.current?.setPointerCapture?.(e.pointerId);
    setModuleDrag({ id, pointerId: e.pointerId, from: svgPoint(e), moved: false });
  };

  const modulePointerMove = (e) => {
    if (!moduleDrag || !pxPerFt) return;
    const p = svgPoint(e);
    if (!moduleDrag.moved) {
      if (!movedEnough(moduleDrag.from, p, { zoom })) return;
      setModuleDrag((d) => (d ? { ...d, moved: true } : d));
    }
    const f = trackFixtures.find((q) => q.id === moduleDrag.id);
    const run = f ? magTrackById[f.trackId] : null;
    if (!run) return;
    const taken = trackFixtures.filter(
      (q) => q.trackId === f.trackId && q.id !== f.id);
    const u = placeableU(run.pts, uAt(run.pts, p, { closed: run.closed }),
                         taken, f.kind,
                         { closed: run.closed, watts: f.watts });
    if (u == null) return;   // the rest of the run is full — leave it where it is
    setTrackFixtures((l) => l.map((q) => (q.id === f.id ? { ...q, u } : q)));
  };

  const modulePointerUp = () => { if (moduleDrag) setModuleDrag(null); };

  /** ONE MODULE, OFF THE RUN. Its own act, unlike deleting the run — which takes
   *  every module with it (see `deleteShape`). */
  const deleteModule = useCallback((id) => {
    setTrackFixtures((l) => l.filter((f) => f.id !== id));
    setSel((cur) => (idOf(cur, 'module') === id ? clear() : cur));
    setModuleDrag((d) => (d?.id === id ? null : d));
  }, []);

  /**
   * DELETE A SPOT — WHICH MEANS DELETING THE THING IT WAS PLACED FOR.
   *
   * A spot is not a fitting somebody positioned; it is what the placer does
   * about a surface or a piece of art. So there is no "the spot" to remove
   * independently of its reason: suppress the fitting and leave the reason, and
   * the plan holds a surface that is invisible on the sheet (the boxes came off
   * the drawing long ago), silently holding a segment of the secondary grid
   * against a fitting that no longer exists, and re-appearing as a refusal in
   * the panel. The reason is what a person is actually deleting.
   *
   * THREE SOURCES, THREE VERBS, and they are the verbs this app already uses —
   * see the note in the accent branch of the keydown handler for the argument:
   *
   *   · A HAND-PLACED SURFACE is removed. It has no generator to come back
   *     from, so dismissing it would leave an id suppressing something that no
   *     longer exists for the life of the plan.
   *   · A DETECTED SURFACE is dismissed. The pass can run again and must not
   *     put it back — "the model proposed this and I said no" is a decision, and
   *     it persists.
   *   · A PIECE OF ART is dismissed by element id, which takes the WHOLE ROW
   *     with it. Deliberately: artSpots.js places a row as one formation, all of
   *     it or none, because two spots lighting one picture are one decision.
   *     Deleting one of a pair would leave a lopsided half of a design nobody
   *     drew. The wall element itself stays — the render pass saw a painting and
   *     it is still there; what changed is that it is not being lit.
   *
   * EITHER WAY THE SEGMENT GOES BACK TO THE CEILING, which is why this deletes
   * the source rather than filtering the output: the room re-places, and another
   * surface that lost that segment can now have it. A fitting elsewhere may move
   * as a result. That is not a side effect to be suppressed — it is the layout
   * being correct about a ceiling that now has one less thing to light.
   */
  const deleteSpot = useCallback((id) => {
    const sp = taskSpotsPx.find((q) => q.id === id);
    setSel(clear());
    if (!sp) return;
    if (sp.surfaceId) {
      if (manualSurfaces.some((sf) => sf.id === sp.surfaceId)) {
        setManualSurfaces((list) => list.filter((sf) => sf.id !== sp.surfaceId));
      } else {
        setSurfaceDismissed((d) => (d.includes(sp.surfaceId) ? d : [...d, sp.surfaceId]));
      }
      return;
    }
    if (sp.wallId) {
      setArtDismissed((d) => (d.includes(sp.wallId) ? d : [...d, sp.wallId]));
    }
  }, [taskSpotsPx, manualSurfaces]);

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
      if (trackEditId) {
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
          if (trackGrip) return;
          if (selTrackPt != null) deleteTrackPoint(trackEditId, selTrackPt);
          else deleteTrack(trackEditId);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          if (selTrackPt != null) setSelTrackPt(null); else closeTrackEdit();
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
      if (shapeMenuOn && shapeTool === 'pen' && !covePen.isEmpty) {
        if (e.key === 'Enter' && canFinishOpen) {
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
        if (shapeMenuOn) {
          if (shapeDraft || !covePen.isEmpty || shapeSpan) abandonShape();
          else closeShapeTool();
          return;
        }
        /* THE GRIPS COME OFF BEFORE THE SELECTION, which is the same
           innermost-first order the whole of this handler follows: Escape
           undoes the last thing you asked for, and asking for dimensions was
           the last thing. */
        if (shapeEditId) { setShapeEditId(null); return; }
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
        else if (focusId) setFocusId(null);
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
      if ((e.key === 'Delete' || e.key === 'Backspace') && selShapeId && !shapeDrag) {
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
      if ((e.key === 'Delete' || e.key === 'Backspace') && selCobId && !cobDrag) {
        e.preventDefault();
        setManualCobs((l) => l.filter((c) => c.id !== selCobId));
        setSel(clear());
        return;
      }
      /* --- A SELECTED RUN, AND THERE ARE THREE KINDS OF IT ------------------
         EVERY LINEAR THING ON THIS DRAWING IS AN ACCENT ZONE — that is what lets
         the canvas, the schedule and the DXF take a cove, a reverse cove, a
         shelf run and a hand-drawn strip without any of them knowing what a cove
         is. It is also why deleting one is three different acts, and why doing
         the wrong one is SILENT: every store here is applied somewhere else, so
         filing a deletion in the wrong list leaves the run on the sheet and
         nothing to say why.

           A HAND-PLACED FITTING IS REMOVED. It has no generator to come back
           from, so dismissing it would leave an id suppressing something that no
           longer exists for the life of the plan.

           A DERIVED RUN — a reverse cove, a shelf strip — IS SWITCHED OFF in
           `runsOff`, which is read where the RUN is built and not where its tape
           is. This is the case that was broken: both were falling through to
           `accentDismissed`, which is only ever applied to the accent pass's own
           zones, so Delete on a reverse cove wrote an id nothing reads and left
           the slot on the drawing. A hand-placed one is in `manualCoves` and is
           removed from there instead, by the first rule.

           AND AN ACCENT THE PASS PROPOSED IS DISMISSED, which has to persist:
           the pass can run again and must not put the same fitting back.

         A DRAWN COVE'S TAPE IS A FOURTH CASE and deletes the SHAPE — see the
         branch. A cove the ceiling design derived is the one thing here with
         nothing to delete: it is not a fitting somebody placed, it is what a
         coved ceiling IS, and the way to remove it is to stop that chunk being
         a cove. */
      if ((e.key === 'Delete' || e.key === 'Backspace') && selAccId && !accDrag) {
        e.preventDefault();
        const zone = accentZonesPx.find((z) => z.id === selAccId);
        if (manualAccents.some((z) => z.id === selAccId)) {
          setManualAccents((list) => list.filter((z) => z.id !== selAccId));
        } else if (zone?.derived && zone.trimId) {
          const gone = zone.trimId;
          if (manualCoves.some((c) => c.id === gone)) {
            setManualCoves((list) => list.filter((c) => c.id !== gone));
          } else {
            setRunsOff((d) => (d.includes(gone) ? d : [...d, gone]));
          }
        } else if (zone?.source === 'cove' && zone.shapeId) {
          /* A DRAWN COVE'S TAPE IS A HANDLE ON THE SHAPE. The run is not an
             object in its own right — it is what the shape produces — so Delete
             on it removes the shape, which is the only thing there is to remove
             and what somebody pressing the key over a cove they drew means. The
             shape's own selection reaches the same function; two handles, one
             act. */
          deleteShape(zone.shapeId);
        } else {
          setAccentDismissed((d) => (d.includes(selAccId) ? d : [...d, selAccId]));
        }
        setSel(clear());
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
        const drop = (m) => {
          if (!(selFlowId in m)) return m;
          const out = { ...m }; delete out[selFlowId]; return out;
        };
        setFlowBoards(drop);
        setFlowBends(drop);
        return;
      }
      // THE WHOLE SELECTION, not just the primary. Deleting one of four
      // selected objects and silently leaving the other three is the reading
      // nobody expects, and it is the one a single-id delete gives.
      if ((e.key === 'Delete' || e.key === 'Backspace') && selObjIds.length && !objDrag) {
        e.preventDefault();
        const doomed = new Set(selObjIds);
        setCeilingObjs((os) => os.filter((q) => !doomed.has(q.id)));
        setSel(clear());
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
        setLitIds((ids) => ids.filter((x) => x !== focusId));
        setFocusId(null);
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
      finishTrack, trackPen, trackEditId, selTrackPt, trackGrip,
      deleteTrackPoint, deleteTrack, closeTrackEdit,
      manualAccents, accentZonesPx, manualCoves, focusId, readOnly, selSpotId, deleteSpot,
      setManualCoves,
      selBoardId, deleteBoard, selFlowId, flowDrag, boardPlace, closeBoardPlace,
      doorEdit, selDoorId, doorDrag, deleteDoor, closeDoorEdit,
      zoneEdit, closeZoneEdit, wallEdit, closeWallEdit,
      shapeMenuOn, shapeTool, shapeDraft, covePen, shapeSpan, abandonShape, closeShapeTool,
      canFinishOpen, finishOpenCove,
      selShapeId, shapeDrag, deleteShape, shapeEditId,
      selLightId, lightDrag, resetLightMove, selCobId, cobDrag, cobOpen,
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
    setFocusId(roomId);
    setOptionPick({ roomId, key });
  }, [hideCoach]);

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
    setFocusId(at.roomId);
    setOptionPick({ roomId: at.roomId, key: at.key });
    /* THE PILL ALWAYS, THE CARD ONLY IF IT HAS NOT BEEN SWITCHED OFF HERE. They
       are two different promises: opening the pill is the app showing you what
       it decided about the ceiling and that the decision is yours, which is
       worth doing on every landing; the card is a sentence explaining the
       arrows, which is worth doing until somebody says stop. */
    if (!coachOff(planId)) setCoach({ roomId: at.roomId, key: at.key, ticked: false });
  }, [landed, prep, step, rooms, roomTypes, projectId, planId]);

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
    setFocusId(off ? null : roomId);
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
    if (!off && !shapeMenuOn && !boardPlace && !zoneEdit) {
      openShapeTool('guide', { arm: false });
    }
  }, [focusId, optionPickFor, hideCoach, shapeMenuOn, boardPlace, zoneEdit,
      openShapeTool]);

  /**
   * FLIP ONE CHUNK THROUGH ITS OPTIONS.
   *
   * THE CURRENT ANSWER IS READ OFF THE LAYOUT, not out of `designPicks`, and
   * that is what makes the legacy path and the "standard costs no state" rule
   * agree with each other. `designChunksPx` says what each chunk ACTUALLY got —
   * including a cove that came from the old room-level switch and a pick that
   * was dropped because the chunk it named no longer exists — so writing the
   * whole space back from it retires the legacy entry, keeps every other chunk
   * exactly as it is, and still stores nothing for a standard ceiling.
   */
  const cycleChunkOption = useCallback((roomId, key, dir = 1) => {
    // THE ARROW WAS PRESSED, SO THE CARD HAS DONE ITS JOB — and it goes now
    // rather than on the second press, because the first flip is the moment the
    // chip stops being a label and starts being a control.
    hideCoach();
    const room = rooms.find((r) => r.id === roomId);
    const chunk = room?.designChunksPx?.find((d) => d.key === key);
    if (!chunk || (chunk.options?.length ?? 0) < 2) return;
    /* THE STEP ITSELF IS IN ceilingDesign.js, and it is there rather than here
       because it was wrong for as long as it lived in this handler and nothing
       could catch it: the symptom was "the right arrow never reaches the track,
       the left one does", which no test of a LAYOUT would ever see. See
       `nextChunkOption` for the two lists and why it steps from what was asked
       for rather than from what got built. */
    const next = nextChunkOption(chunk, dir);
    if (!next) return;
    const base = {};
    // EVERY OTHER CHUNK KEEPS WHAT IT ASKED FOR, not what it got. Reading `pick`
    // here dropped a neighbour's declined request the moment anybody flipped a
    // different chunk — invisible on the drawing, and a decision quietly lost.
    for (const d of room.designChunksPx) {
      const want = d.requested ?? d.pick;
      if (d.key !== key && want !== 'standard') base[d.key] = want;
    }
    if (next === 'standard') delete base[key]; else base[key] = next;
    setDesignPicks((m) => ({ ...m, [roomId]: base }));
  }, [rooms, hideCoach]);

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
    // IT WAS ALSO ALREADY REDUNDANT, which is the tell. The note below says it:
    // everything interactive on the plan calls `stopPropagation` on pointerdown,
    // `objPointerDown` included, so a click on an object cannot arrive here in
    // the first place. `armed` and `addTool` stay — those really are gestures
    // waiting to happen, and they own the next click.
    if (zoneMode || !source || armed || addTool) return;
    /* AND NOTHING WHILE A SHAPE IS BEING DRAWN. `shapeToolDown` already
       stopped the press, but the browser synthesises a click afterwards and it
       arrives here — so without this, dropping the first point of a pen path
       would also select the space under it and yank the panel to another room.
       LETTING GO OF A SELECTED SHAPE IS THE OTHER HALF, and it happens here
       rather than in a branch of its own: a click on empty plan is how every
       other selection on this canvas is cleared, and a shape you cannot let go
       of is a shape whose ring reads as part of the drawing. */
    if (shapeMenuOn && shapeTool) return;
    /* THE CLICK THAT CAME OFF A SHAPE IS NOT A CLICK ON THE PLAN, however much
       it looks like one by the time it gets here — see `shapeTook`. It is
       consumed outright rather than merely skipping the deselect: picking a
       cove up must not also yank the panel to whichever space it is drawn over.
       LETTING GO IS THE OTHER HALF, and it happens on any press that really was
       on bare plan, which is how every other selection on this canvas is
       cleared. */
    if (shapeTook.current) { shapeTook.current = false; return; }
    // ...and the click at the end of a light's drag is not one either.
    if (lightMoved.current) { lightMoved.current = false; return; }
    /* AND EVERYTHING LETS GO. A press that really was on bare plan is how every
       selection on this canvas is cleared — the shape, the array whose dashed
       setting-out line would otherwise stay on the sheet as a drawn line (see
       `selArrayPathPx`), the module, the light, and the four below that used to
       be cleared only outside a room. One register, one line. */
    setSel(clear());
    if (shapeEditId) setShapeEditId(null);
    // AND THE TRACK'S POINTS, which are a selection like any other: a path left
    // open with its grips on the drawing reads as part of the drawing. A press
    // that came off a grip never reaches here — see `shapeTook` above, which
    // the grip sets for exactly this.
    if (trackEditId) closeTrackEdit();
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
    setFocusId(hit ? hit.id : null);
    /* AND THE PANEL GOES TO THE SPACE THAT WAS CLICKED. Picking a space on the
       drawing is now the way into everything a space HAS — its height, its
       finishes, whether it is bright enough — and all of that lives on the
       Spaces tab. Without this, the most direct gesture there is (click the
       room) would set a selection the panel was on the wrong tab to show, which
       is a click that appears to do nothing. Only on a hit: clicking off the
       plan means "never mind", and yanking the tab strip about would be a
       strange thing for it to also mean. */
    if (hit) setView('spaces');
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
    if (hit && !shapeMenuOn && !boardPlace && !zoneEdit) {
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
  const stageRef = useRef(null);
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
  const ZOOM_MIN = 0.2, ZOOM_MAX = 6;
  const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +z.toFixed(3)));
  const zoomAnchor = useRef(null);

  const zoomTo = useCallback((next, at = null) => {
    const svg = svgRef.current;
    if (svg && at) {
      const r = svg.getBoundingClientRect();
      // The plan-space point under the cursor, from the element's LIVE rect —
      // so it is right whatever the padding and centring are doing.
      zoomAnchor.current = {
        px: (at.x - r.left) / (r.width || 1),
        py: (at.y - r.top) / (r.height || 1),
        clientX: at.x, clientY: at.y,
      };
    }
    setZoom((z) => clampZoom(typeof next === 'function' ? next(z) : next));
  }, []);

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

  /** The zoom at which the whole plan fits the stage, with a little air. */
  const fitZoom = useCallback(() => {
    const el = stageRef.current;
    if (!el || !source?.w || !source?.h) return 1;
    const cs = getComputedStyle(el);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 34;
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + 34;
    return clampZoom(Math.min((el.clientWidth - padX) / source.w,
                              (el.clientHeight - padY) / source.h));
  }, [source]);

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
      zoomTo((z) => z * k, { x: e.clientX, y: e.clientY });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomTo]);

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
      if (e.key === 'f' || e.key === 'F') { setZoom(fitZoom()); }
      else if (e.key === '0') { setZoom(1); }
      else if (e.key === '+' || e.key === '=') { zoomTo((z) => z * 1.2); }
      else if (e.key === '-' || e.key === '_') { zoomTo((z) => z / 1.2); }
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [source, sheetOpen, fitZoom, zoomTo]);

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


  const onZoneDown = (e) => {
    // A PRESS THAT REACHES THE CANVAS CAME OFF NEITHER A SHAPE NOR A LIGHT.
    // See `shapeTook` and `lightMoved`.
    shapeTook.current = false;
    lightMoved.current = false;
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
    if (doorEdit && source) {
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const p = svgPoint(e);
      const hit = doorHitAt(p);
      if (hit) {
        setSel(select('door', hit.id));
        // `base` IS THE RECT AT THE PRESS AND NEVER MOVES; `rect` is where the
        // pointer has it now. See the move handler for why the offset is
        // measured from the press rather than accumulated frame by frame.
        setDoorDrag({ id: hit.id, from: p, base: hit.rect, rect: hit.rect });
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
    if (shapeToolDown(e)) return;

    // --- ADDITIONAL LIGHTING, before anything else claims the press ---------
    /* THE SWITCHBOARD STEP OWNS THE CLICK OUTRIGHT, and it is first because it
       is the most exclusive of the gestures here: while it is open, a press on
       the plan means one thing and nothing else on the canvas may see it. It
       does not disarm on a miss — a click too far from any wall places nothing
       and says nothing, and the step's way out is its Done button, exactly as
       the spot's and the cove's are. */
    if (boardPlace && source && pxPerFt) {
      e.preventDefault();
      placeBoardAt(svgPoint(e));
      return;
    }
    // First in the handler for the same reason the out-of-room check is first
    // in the block below it: a tool that is armed owns the next click, and any
    // path that lets selection or a ceiling object see it first is a path where
    // the click does two things.
    if (addTool && source && pxPerFt) {
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
        e.preventDefault();
        if (e.detail > 1) { finishTrack(); return; }
        /* CLICKING THE FIRST POINT CLOSES THE RUN, which is the gesture the
           cove pen already answers and the one everybody tries on a rectangle.
           The tolerance is in PIXELS and converted, not in feet: it is about
           how accurately a person can hit a dot on screen, which does not
           change when the drawing is scaled. */
        const closeFt = Math.max(6, pxPerFt * 0.4) / pxPerFt;
        if (trackPen.add(penSnap(p, trackPen), { tolFt: closeFt }) === 'closed') {
          finishTrack(true);
        }
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
         press is about.

         A PRESS ANYWHERE ELSE DOES NOTHING AND DOES NOT DISARM, which is the
         COB's third exemption said about a module: you clip six of these onto a
         run, and a tool that had to be re-armed after a stray click on the
         ceiling beside it would be a trip to the rail per module. The cursor has
         already said the press is dead out there — see `geomHover`, which is
         what turns the pointer into a hand over a run and leaves it an arrow
         everywhere else.

         WHERE ALONG THE RUN IS WHERE THE CLICK LANDED, projected onto the path
         and then moved to the nearest place the body fits — see `placeableU`.
         Two modules cannot occupy the same inch of extrusion, and that is a fact
         about the product rather than a rule this app is imposing. */
      if (addTool === 'module') {
        const hit = shapeAtPointer(p);
        const run = hit && shapeIsTrack(hit) ? magTrackById[hit.id] : null;
        if (!run || !trackMode) return;
        e.preventDefault();
        const taken = trackFixtures.filter((f) => f.trackId === run.id);
        /* CLEARED AT THE BODY THIS MODULE WILL ACTUALLY BE, and every module
           already on the run at its own — a 5 W diffuser is a 200 mm stub and an
           18 W one a 400 mm bar, so one clearance figure for the lot would refuse
           the small one a gap it fits and let the big one overlap. See
           `DIFFUSER_LENGTHS_MM`. */
        const u = placeableU(run.pts, uAt(run.pts, p, { closed: run.closed }),
                             taken, trackMode,
                             { closed: run.closed, watts: moduleWatts(trackMode) });
        if (u == null) return;   // the run is full — see `placeableU`
        setTrackFixtures((l) => [...l,
          placeModule({ trackId: run.id, kind: trackMode, u, seq: l.length })]);
        /* AND THE PANEL GOES TO THE SPACE IT LANDED IN, on the first module of
           a run, for the reason the first COB of a run opens its space: a
           diffuser is an ambient source and the two figures at the top of the
           Analysis move as you clip them on, which is the only reason watching
           them is worth anything. */
        if (run.roomId && !trackFixtures.some((f) => f.trackId === run.id)) {
          setFocusId(run.roomId); setOptionPick(null); setView('spaces');
        }
        return;
      }

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

      /* --- A RECESSED COB, EXACTLY WHERE THE CLICK LANDED -------------------
         NO SNAP, NO PROJECTION, NO CLAMP, and the absence of all three is the
         feature rather than an omission — see the header of lib/cob.js. The
         sconce below seats itself on a wall and the strip snaps to a guide,
         because in both cases the geometry is what the fitting IS. A downlight
         is a hole in a ceiling, and somebody who has aimed at a point has said
         everything there is to say about where it goes.
         THE SPECIFICATION IS RESOLVED AT THE CLICK AND NOT OFF THE BAR. Same
         stack the bar reads — one-shot, then standing, then the engine — but
         asked of THIS point, because the pointer moves between the last render
         and the press, and a lamp specified for the cell next door would be the
         bar and the drawing disagreeing about what was just placed.
         THE TOOL STAYS ARMED, and the one-shot is spent. */
      /* --- THE ARRAY PICKS A GEOMETRY RATHER THAN PLACING A LAMP -----------
         THE SAME TOOL AND A DIFFERENT QUESTION. Manual mode asks "where"; the
         array asks "on what", and the answer is a thing already on the drawing.
         So the press selects rather than places, and everything the bar goes on
         to ask — how many, which side, how far — is about the thing it selected.

         A SHAPE UNDER THE POINTER WINS OVER THE ROOM IT IS IN, which is the
         most-specific-first rule this canvas follows everywhere. A guide drawn
         inside a room is always also inside that room's outline; without the
         ordering the smaller of the two targets could never be hit.

         AND THE ROOM'S OWN OUTLINE IS A GEOMETRY. It is the one every plan has,
         it is what you offset from to ring a room with downlights, and it needs
         no drawing first. `room:` says which list to look in — see
         `arrayOutline`. */
      if (addTool === 'cob' && cobMode === 'array') {
        /* THE SAME HIT TEST THE CURSOR AND THE HIGHLIGHT RUN, which is what
           makes the press land on the line the pointer said it would — see
           `shapeAtPointer`. It was inline here, and a second copy of the
           tolerance is a hover that lights one thing and a press that takes
           another. */
        const hitSh = shapeAtPointer(p);
        const geomId = hitSh ? hitSh.id : `room:${room.id}`;
        const geo = arrayOutline(geomId);
        if (!geo) return;
        /* WHAT IT OPENS ON: ONE LAMP PER CORNER, on the line itself.
           THE COUNT COMES FROM THE GEOMETRY AND IS NOT A CONSTANT ANY MORE. It
           was 4 for everything, which is the right answer for a rectangle and a
           wrong one for a triangle (a lamp stranded mid-edge) and for a hexagon
           (four of six corners served). One per corner is the smallest run that
           describes the shape it was set out on, and it is the base every step
           of the control counts from — see `arrayQuanta`.
           `on` RATHER THAN A SIDE, because the first thing to be sure of is that
           the right geometry was picked, and the only arrangement that shows it
           unambiguously is the one drawn on the geometry. The offset is carried
           at a foot so that choosing a side is one press and not two. */
        const q = arrayQuanta(geo.corners, geo.closed);
        setCobDraftArray((d) => ({
          side: 'on', offsetFt: 1,
          ...(d ?? {}), geomId, roomId: geo.roomId ?? room.id,
          /* THE COUNT IS RE-ASKED ON EVERY PICK, unlike the side and the
             distance. Those are a preference somebody has expressed and it
             carries to the next geometry; a count is a fact about the shape
             underneath, and eight carried from a rectangle onto a triangle is a
             run of eight on three corners. `quantiseCount` would rescue it to
             nine, which is a number nobody asked for either — so the new
             geometry answers for it. */
          count: d?.geomId === geomId ? quantiseCount(d.count, q) : q.base,
          watts: d?.watts ?? cobShow.watts, beam: d?.beam ?? cobShow.beam,
        }));
        setSel(select('shape', hitSh ? hitSh.id : null));
        return;
      }

      if (addTool === 'cob') {
        /* THE RUN OWNS ONE CEILING. A press on any other one places nothing and
           says nothing — it does NOT disarm, and it does not move the run: the
           cursor has already said this click was dead (see `inside` in the move
           handler), and a stray press near a doorway must not silently start
           laying lamps in the next flat. */
        if (cobLock && room.id !== cobLock) return;
        const sn = cobSnap(p);
        const at = { x: sn.x, y: sn.y };
        const override = cobOnce ?? cobStanding ?? null;
        const spec = override ?? recommendCob(room, at, cobBasisFor(room));
        const lamp = placeCob({
          p: at, pxPerFt, roomId: room.id,
          watts: spec.watts, beam: spec.beam,
          spec: !!override, seq: manualCobs.length,
        });
        setManualCobs((l) => [...l, lamp]);
        /* AND IT JOINS THE RUN, which is what the tick and the cross on the bar
           act on. See `cobRun`. */
        setCobRun((r) => [...r, lamp.id]);
        /* --- THE FIRST LAMP CHOOSES THE SPACE, AND OPENS IT ----------------
           The lock is what stops the rest of the run wandering into the next
           room — see `cobLock`. Opening the space is the other half of the same
           thought: a run of downlights is an argument about how bright one
           ceiling is, and the panel has to be showing THAT ceiling's Analysis
           for the argument to be watchable. Every lamp placed after this moves
           the two figures at the top of it while you watch, which is the only
           reason the section is worth having.
           THE SPACES TAB AND NOT THE DESIGN ONE, because that is where a space's
           own detail lives — its finishes, its height, and the Analysis with a
           row per placed lamp. The Design tab holds the palettes, which are
           about the drawing rather than about this room.
           ONLY ON THE FIRST. Re-focusing on every press would fight anybody who
           opened a different space mid-run to compare a figure. */
        if (!cobLock) {
          setCobLock(room.id);
          setFocusId(room.id);
          setOptionPick(null);
          setView('spaces');
        }
        if (cobOnce) setCobOnce(null);
        return;
      }

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
        setManualAccents((m) => [...m, placed]);
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
        setManualAccents((m) => [...m, z]);
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
    // pointer after you draw one shape. Not armed: deselect.
    if ((armed || objMode || selAccId) && source && pxPerFt) {
      const p = svgPoint(e);
      // Outside every room: cancel, do not act. One branch, before anything
      // else, so there is no path by which a click out here places something.
      if (!insideAnyRoom(p)) {
        setArmed(null); setGhost(null); setGuides([]);
        setSel(clear());
        return;
      }
      if (armed) {
        const snapped = applySnap(p, null);
        let o = makeCeilingObject(armed, { x: snapped.x / pxPerFt, y: snapped.y / pxPerFt });
        if (o.kind === 'fan') o = withSweep(o, fanSweepMm);
        setCeilingObjs((os) => [...os, o]);
        setSel(select('object', o.id));
        setArmed(null);
        setGuides([]); setGhost(null); setGuides([]); setGhost(null);
      } else {
        setSel(clear());
      }
      return;
    }
    if (!zoneMode || !source) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = svgPoint(e);
    setDraftZone({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const onZoneMove = (e) => {
    /* THE SPAN, WHILE IT IS BEING DRAWN. `shapeAt` is the only thing that
       moves — the anchor was fixed at the press — and the shape itself is a
       memo over the pair. Shift is read live rather than at the press, so
       holding it halfway through a rectangle squares it up under your hand.
       AHEAD OF EVERY OTHER BRANCH, matching the press. */
    if (shapeSpan && shapeMenuOn && shapeTool && pxPerFt) {
      const p = svgPoint(e);
      // SNAPPED, AND THE GUIDES SAY WHY — see `shapeSnapFt`. The far corner of a
      // marquee is aimed at a line as much as the near one was.
      setShapeAt(shapeSnapFt(p));
      if (shapeSpan.uniform !== e.shiftKey) {
        setShapeSpan((d) => (d ? { ...d, uniform: e.shiftKey } : d));
      }
      return;
    }
    /* --- A PRIMITIVE IS ARMED AND NOTHING IS BEING DRAWN YET ---------------
       THE ONE THING WORTH KNOWING IN THIS STATE is whether the next press would
       drag out a new shape or take the geometry already under the pointer — see
       the branch at the top of `shapeToolDown`, whose `covePen.isEmpty` gate
       this mirrors exactly. Nothing else on this canvas is live here (every grab
       handler is withheld while a primitive is armed), so this owns the move.

       AFTER THE SPAN AND BEFORE THE PEN'S RUBBER BAND, and both halves of that
       are the gate. A span is a gesture in flight and owns the pointer, so a
       drag passing over a guide must not light it up. A pen with no points down
       has nothing to draw a band from and CAN still take a geometry, so it wants
       the cue; a pen mid-path cannot, and falls through to the band below. */
    if (shapeMenuOn && pxPerFt && covePen.isEmpty
        && !shapeResize && !shapeDrag && !trackGrip) {
      const h = geomUnder(svgPoint(e));
      const id = h?.id ?? null;
      if (id !== geomHover) setGeomHover(id);
      /* IT ONLY OWNS THE MOVE WHEN A PRIMITIVE IS ARMED. Unarmed, the bar is
         merely open — the state a rail cell and a space click both leave it in —
         and every grab handler on this canvas is live underneath it. Returning
         here would swallow the moves that drag a shape, resize one by its grips
         or slide a track's point. */
      if (shapeTool) return;
    }
    /* THE PEN'S RUBBER BAND. No press to wait for — the path is a run of
       clicks — so the segment from the last point to the pointer is drawn
       whenever there is a point to draw it from. */
    if (shapeMenuOn && shapeTool === 'pen' && pxPerFt) {
      // SHIFT IS READ LIVE, exactly as the drag primitives read it: holding it
      // halfway along a segment straightens that segment under your hand rather
      // than only affecting the next one. The pen is handed a point that is
      // already snapped — see `penSnap` — so the guides on screen, the rubber
      // band and the click all describe one place.
      covePen.move(penSnap(svgPoint(e), covePen), e.shiftKey);
      return;
    }
    // A TRACK POINT BEING DRAGGED, with the rest of the in-flight gestures and
    // for their reason: a gesture that has the pointer owns it until it is
    // released, whatever else is armed.
    if (trackGrip) { trackGripMove(e); return; }
    // A GRIP ON A SHAPE'S FRAME, ahead of the shape's own drag: a gesture
    // already in flight owns the pointer until it is released, and these two
    // start from the same press on the same object.
    if (shapeResize) { shapeResizeMove(e); return; }
    if (shapeDrag) { shapePointerMove(e); return; }
    // A LIGHT BEING SLID INSIDE ITS OWN CELL. Same rule as every drag above it:
    // a gesture already in flight owns the pointer until it is released.
    if (lightDrag) { lightPointerMove(e); return; }
    // THE DOOR EDITOR FIRST, for the reason given on the press: it owns the
    // canvas outright while it is open.
    if (doorEdit) {
      if (doorDrag) {
        /* THE OFFSET IS FROM THE PRESS, NOT FROM THE LAST FRAME, and the
           difference only shows at the edge of the sheet — which is where half
           of these boxes are, since a door is in a wall. `shiftRect` clamps, so
           an incremental delta would keep counting while the box was held
           against the edge and the box would then come away from the cursor by
           however far the pointer had gone past it. Measured from the press, a
           clamped box stays clamped until the pointer comes back for it. */
        const p = svgPoint(e);
        setDoorDrag((d) => (d
          ? { ...d, rect: shiftRect(d.base, p.x - d.from.x, p.y - d.from.y) }
          : d));
        return;
      }
      if (doorDraft) {
        const p = svgPoint(e);
        setDoorDraft((d) => (d ? { ...d, x1: p.x, y1: p.y } : d));
      }
      return;
    }
    if (objDrag) { objPointerMove(e); return; }
    // A LAMP BEING DRAGGED, with the rest of the in-flight gestures and for
    // their reason: a gesture that has the pointer owns it until it is released,
    // whatever else is armed.
    if (cobDrag) { cobPointerMove(e); return; }
    // A WHOLE RUN BEING CARRIED — the same rule, said about an array rather than
    // about one lamp. See `arrayGrab`.
    if (arrayDrag) { arrayPointerMove(e); return; }
    // A MODULE SLIDING ALONG ITS RUN — same rule: a gesture already in flight
    // owns the pointer until it is released.
    if (moduleDrag) { modulePointerMove(e); return; }
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
    // still move the pointer.
    if (armed && source && pxPerFt) {
      const p = svgPoint(e);
      const inside = insideAnyRoom(p);
      if (inside !== overRoom) setOverRoom(inside);
      if (!inside) {
        // No ghost and no guides off the ceiling: nothing is going to land
        // there, so nothing should be promised.
        if (ghost) setGhost(null);
        if (guides.length) setGuides([]);
        return;
      }
      const snapped = applySnap(p, null);
      setGhost({ x: snapped.x, y: snapped.y, typeId: armed });
      return;
    }
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
      /* THE TRACK'S RUBBER BAND, and it is the pen's own aimed point that gets
         drawn — the pointer with the axis lock already on it. Nothing is shown
         before the first click, because a locked segment has to be locked TO
         something. */
      if (addTool === 'track') {
        trackPen.move(penSnap(raw, trackPen));
        return;
      }
      /* --- WHAT THE COB BAR IS TALKING ABOUT -----------------------------
         THE PLAN POINT AND NOTHING ELSE. The bar is pinned to the foot of the
         stage (see CobSpec), so this is not a position to draw at — it is the
         question the recommendation and the two guides answer.
         NULL OUTSIDE A ROOM. Out there the next click places nothing, so there
         is no cell to read and no wall or bed worth warning about; the bar stays
         up and falls back to the catalogue's ordinary downlight. */
      /* --- IS A MODULE ABOUT TO LAND ON A RUN? --------------------------
         THE ONLY THING WORTH SAYING WHILE THIS TOOL IS ARMED. A module goes on
         a profile, so the pointer's whole job is to distinguish "over a run"
         from "over the ceiling", and it does it with the cues `geomHover`
         drives: the cursor becomes a hand and the run's own stroke comes up. No
         ghost is drawn because nothing lands at the pointer.
         AHEAD OF THE COB AND IT RETURNS, because a module reads none of what the
         branch below maintains — there is no cell to recommend a wattage from
         and no wall band to warn about. */
      if (addTool === 'module') {
        const h = geomUnder(raw);
        const hid = h?.id ?? null;
        if (hid !== geomHover) setGeomHover(hid);
        setAddAt(raw);
        return;
      }
      if (addTool === 'cob') {
        /* --- IS THE ARRAY ABOUT TO TAKE A GEOMETRY? -----------------------
           THE ARRAY TOOL DOES NOT PLACE A LAMP AT THE POINTER — it picks the
           line the run is set out on — so over a geometry the ghost lamp is a
           promise the press will not keep, and the crosshair is aimed at a point
           the press will not use. Both are exchanged for a pointer and a lit
           stroke on the line itself; see `geomHover`.
           NOT IN MANUAL MODE, where a press really does put a lamp at the point
           and a geometry under it is scenery. `geomUnder` answers `null` there
           by construction. */
        const h = geomUnder(raw);
        const hid = h?.id ?? null;
        if (hid !== geomHover) setGeomHover(hid);
        /* THE SNAPPED POINT, NOT THE RAW ONE — the same rule the strip tool's
           press states: the ghost under the cursor is a promise about where the
           click will land, and a click that lands anywhere else makes every
           future indicator a lie. `cobSnap` is what the press runs too. */
        const sn = inside ? cobSnap(raw) : null;
        const at = sn ? { x: sn.x, y: sn.y } : raw;
        setGuides(sn?.guides ?? []);
        setCobAt(inside ? at : null);
        setAddAt(at);
        return;
      }
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
    /* A SPAN LET GO IS A SHAPE HELD, NOT A SHAPE PLACED. The draft is frozen
       where the pointer left it and the bar turns into a tick and a cross; see
       `commitShape` for why a cove is confirmed rather than dropped. Anything
       too small to be a shape is simply forgotten — a click that wobbled is a
       click, and leaving a two-inch cove on the drawing to be hunted down is
       the worse of the two ways to be wrong. */
    if (shapeSpan) {
      const held = shapeDraft;
      setShapeSpan(null);
      /* THE GUIDES GO WITH THE GESTURE, whichever way it ended. `abandonShape`
         clears them on the throw-away path; a shape that is KEPT would otherwise
         be left standing beside the dotted lines that helped place it, and a
         guide that outlives its drag is a drawn line. */
      setGuides([]);
      if (held && bigEnough(held)) setShapeHeld(held); else abandonShape();
      return;
    }
    /* A TRACK POINT IS LET GO, and there is nothing to commit: `trackGripMove`
       wrote every frame straight into the list, exactly as a shape's resize
       does, so the release only has to put the gesture away. The path is
       re-measured on each write, so the schedule is already right. */
    if (trackGrip) { setTrackGrip(null); return; }
    if (shapeResize) { setShapeResize(null); return; }
    if (shapeDrag) { shapePointerUp(); return; }
    if (lightDrag) { lightPointerUp(); return; }
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
      if (doorDrag) {
        const { id, base, rect } = doorDrag;
        setDoorDrag(null);
        // A PRESS THAT SELECTED AND DID NOT MOVE WRITES NOTHING. The rect would
        // be identical, but the list's identity would not — and `doors` is what
        // the board pass, the bay pass and the flows are all memoised on, so a
        // click to select a box would re-run every one of them for nothing.
        if (rect.x0 === base.x0 && rect.y0 === base.y0) return;
        setDoors((ds) => ds.map((d) => (d.id === id
          ? { ...d, rect, openingPx: openingPx(rect) } : d)));
        return;
      }
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
      const door = {
        id: `door-hand-${Date.now().toString(36)}`,
        cls: 'door', conf: 1, rect: r, openingPx: openingPx(r), placed: true,
      };
      setDoors((ds) => [...ds, door]);
      setSel(select('door', door.id));
      return;
    }
    if (objDrag) { objPointerUp(); return; }
    if (cobDrag) { cobPointerUp(); return; }
    if (arrayDrag) { arrayPointerUp(); return; }
    if (moduleDrag) { modulePointerUp(); return; }
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
      setManualCoves((l) => [...l, c]);
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
        setManualSurfaces((m) => [...m, {
          id: `mansurf-${Date.now().toString(36)}`, roomId, rect: r,
          kind: 'custom', label: 'Task area', confidence: 1, source: 'placed',
        }]);
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
      setZones((zs) => [...zs, { id: Date.now() + Math.random(), ...z }]);
    }
  };

  // --- find the rooms -------------------------------------------------------
  //
  // The step that used to be the whole of the user's job. A segmentation model
  // reads the plan and proposes one polygon per room; the user drags the corners
  // that are wrong and lights the lot. Tracing by hand is still there, unchanged
  // and still exact, and it is what happens when this comes back empty — which
  // is why the failure path here is a message and not an error.
  //
  // IT RUNS ON UPLOAD, before the scale is known on an image. That is fine and
  // deliberate: a polygon is pixels, and pixels do not need a scale. The scale
  // only decides whether a polygon is a WC or a cupboard, and roomsFromPayload
  // falls back to a fraction of the sheet for that when there is no scale yet.
  // Waiting for the scale would mean the proposals appear after the user has
  // already started tracing over them.
  //
  // Not in the same effect as the bed detector, and not in the same request: two
  // workflows, two models, two answers, and one of them failing must not take
  // the other down with it.
  useEffect(() => {
    if (!source) return;
    // A REOPENED PLAN ALREADY HAS THIS ANSWER, and it has the user's corrections
    // on top of it. Re-running would cost a model call and throw those away.
    // The nonce is the user asking again, explicitly.
    if (restoring.current && roomNonce === 0) return;
    // READ-ONLY: never. This is a stored plan belonging to somebody else, and
    // re-running the rooms detector on it would spend a model call to recompute
    // an answer that is already in the row — and then hold a different one in
    // memory from the one the user is looking at on their own screen.
    if (readOnly) return;
    let alive = true;
    const ctl = new AbortController();

    (async () => {
      setRoomState({ status: 'running' });
      const t0 = Date.now();
      let meta = null;
      const res = await proposeOutlines('roboflow-rooms', {
        source, img,
        // A DXF states its scale, so the area floor can be in feet from the
        // start. An image cannot, and passing the not-yet-measured scale would
        // be worse than passing none — it would apply a floor computed from a
        // number the user has not agreed to.
        pxPerFt: isVector ? source.pxPerFt : null,
        signal: ctl.signal,
        snapshotOpts: {
          stroke: OTHER_STROKE_PX,
          wallStroke: Math.max(1, (WALL_WEIGHT_IN / 12) * (source.pxPerFt || 20)),
          wallLayers: wallLayerSet,
        },
        onMeta: (m) => { meta = m; },
      });
      if (!alive) return;

      if (!res.ok) {
        console.warn('[rooms] failed:', res.reason);
        setRoomState({ status: 'error', error: res.reason, ms: Date.now() - t0 });
        return;
      }
      console.log(`[rooms] ${res.outlines.length} proposed`, { meta, outlines: res.outlines });

      // Merge, never replace. Anything traced by hand is the user's work and
      // outranks a proposal; re-running the detector must not delete it. The
      // previous run's proposals DO go, because they are the same answer to the
      // same question and keeping both would double every room.
      let added = 0;
      setOutlines((os) => {
        // MERGE, NEVER REPLACE, and the rule is about work rather than about
        // provenance: anything the user has TOUCHED survives, whether they drew
        // it or dragged a corner of it. Only untouched proposals go, because they
        // are the same answer to the same question and keeping both would double
        // every room.
        //
        // This matters more than it looks. The effect re-runs whenever the plan
        // source changes, and correcting a DXF's unit interpretation on the
        // tracer screen changes it — so without this, choosing the right units
        // after nudging four rooms would silently throw the nudges away.
        const kept = os.filter((o) => !o.detected || o.reviewed);

        // ...which means a re-run can propose a room the user has already
        // corrected. Drop a proposal that lands on top of an outline that is
        // already there rather than stacking two outlines on one room.
        const existing = kept.map((o) => {
          const b = bbox(o.pointsDu.map(source.fromDu));
          return { x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY };
        });

        // Names are handed out against a list that grows as we go, so two rooms
        // cannot both come out "Room 1". A label from the drawing or the model
        // wins when it is not already taken — "Kitchen" is worth more than
        // "Room 2" — and the counter fills in the rest.
        const seen = kept.map((o) => ({ name: o.name }));
        const made = [];
        for (const prop of res.outlines) {
          const b = bbox(prop.pointsPx);
          const rect = { x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY };
          if (existing.some((e) => iou(e, rect) > 0.5)) continue;
          const taken = new Set(seen.map((u) => u.name).filter(Boolean));
          const name = prop.label && !taken.has(prop.label)
            ? prop.label : nextOutlineName(seen);
          seen.push({ name });
          existing.push(rect);
          made.push({
            id: makeOutline(prop.pointsPx, { name }).id,
            name,
            // ALREADY SQUARE. roomsFromPayload rectified it, so the stored
            // points ARE the polygon and a grip moves what you can see. Leaving
            // this on would square the correction away under the user's hand.
            // The per-room switch stays available to re-apply it.
            rectify: false,
            detected: true, reviewed: false,
            confidence: prop.confidence ?? null,
            why: prop.why || '',
            note: prop.note || '',
            pointsDu: prop.pointsPx.map(source.toDu),
            // Rooms that sit wholly inside this one and could not be subtracted
            // from it. Held in the plan's own units like everything else, so a
            // unit correction moves them with the walls.
            enclosingDu: prop.enclosingPx
              ? prop.enclosingPx.map((poly) => poly.map(source.toDu)) : null,
          });
        }
        added = made.length;
        return [...kept, ...made];
      });

      setRoomState({
        status: 'done', ms: Date.now() - t0,
        // What is on screen, not what came back: a proposal that landed on a
        // room the user had already corrected was not added, and reporting it as
        // found would have them looking for an outline that is not there.
        proposed: added,
        returned: res.outlines.length,
        dropped: meta?.rejected?.length ?? 0,
        meta,
      });
    })();

    return () => { alive = false; ctl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, roomNonce]);

  // --- find the doors -------------------------------------------------------
  //
  // THE SCALE COMES FIRST AND FROM A DOOR. Everything downstream is stated in
  // feet, so px/ft is the first number this app needs, and a door is the only
  // object on a floor plan whose real width is standard enough to read it off:
  // 750 to a bathroom, 900 to a room, 1200 to a hall. See src/lib/doors.js.
  //
  // GATED ON THE PROJECT TYPE, which is not an arbitrary place to hang it. The
  // dialog is a moment the user is already spending, the search takes a couple
  // of seconds, and its answer has to be on screen before the tracer is useful
  // — landing them on an empty tracer and popping doors in underneath them a
  // beat later is the worse version of the same wait, because by then they have
  // started clicking.
  //
  // NOT ON A DXF. A drawing states its own scale in its own units; there is
  // nothing to measure and nothing to guess, and asking a detector would be
  // asking a worse source than the one already in the file.
  useEffect(() => {
    if (!source || isVector || !projectId) return;
    if (!img?.el) return;
    // A REOPENED PLAN ALREADY HAS THIS ANSWER, and it has the user's corrections
    // on top of it. Re-running would cost a model call and throw those away.
    // The nonce is the user asking again, explicitly.
    if (restoring.current && doorNonce === 0) return;
    // READ-ONLY: never. This is a stored plan belonging to somebody else, and
    // re-running the doors detector on it would spend a model call to recompute
    // an answer that is already in the row — and then hold a different one in
    // memory from the one the user is looking at on their own screen.
    if (readOnly) return;
    let alive = true;
    const ctl = new AbortController();

    (async () => {
      setDoorState({ status: 'running' });
      const t0 = Date.now();
      try {
        const shot = downscaleForDetection(img.el);
        const payload = await detectDoors({
          base64: shot.base64, mime: shot.mime, signal: ctl.signal });
        if (!alive) return;
        // Against the ORIGINAL image, not the downscaled one that was sent. The
        // response declares the space it answered in and doorsFromPayload maps
        // back — get this wrong and every door is out by the downscale ratio,
        // which is not a wonky box, it is the whole drawing at the wrong scale,
        // silently, because a wrong scale still looks like a plan.
        const { doors: found, rejected, medianPx } = doorsFromPayload(payload,
          { image: { w: source.w, h: source.h } });
        console.log(`[doors] ${found.length} found, ${rejected.length} rejected`
          + `, median opening ${medianPx ? medianPx.toFixed(0) : '—'}px`, { found, rejected });
        setDoors(found);
        setDoorState({ status: 'done', count: found.length, rejected,
                       ms: Date.now() - t0, meta: payload?.meta ?? null });
      } catch (err) {
        if (!alive || err.name === 'AbortError') return;
        // SURVIVABLE, and that is the whole reason the fallback still exists.
        // No doors means the user measures something by hand, which is what
        // they did before this feature.
        console.warn('[doors] failed:', err);
        setDoors([]);
        setDoorState({ status: 'error', error: String(err.message || err), ms: Date.now() - t0 });
      }
    })();

    return () => { alive = false; ctl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, img, isVector, projectId, doorNonce]);

  // --- find the bed ---------------------------------------------------------
  // A bed is the one piece of furniture whose position CHANGES THE CEILING: you
  // do not put a downlight over it, because whoever is lying there looks
  // straight up into the fitting.
  //
  // BOTH ROUTES IN COME THROUGH HERE. A photo is downscaled; a DXF is rendered
  // to a plain black-on-white raster first. After that neither this effect nor
  // anything downstream knows which it was looking at — same detector, same
  // rectangles, same zones. A DXF *could* be read directly when it names its
  // blocks, but across drawings from different offices it usually does not, so
  // one path that always works beats two that each work sometimes.
  //
  // Fires on load, before any boundary exists: detection needs only the plan,
  // so by the time there is a region to light the answer is already in. It is
  // fire-and-forget — a detector being down must not stop anyone planning a
  // room by hand.
  useEffect(() => {
    if (!source) return;
    // A REOPENED PLAN ALREADY HAS THIS ANSWER, and it has the user's corrections
    // on top of it. Re-running would cost a model call and throw those away.
    // The nonce is the user asking again, explicitly.
    if (restoring.current && detectNonce === 0) return;
    // READ-ONLY: never. This is a stored plan belonging to somebody else, and
    // re-running the beds detector on it would spend a model call to recompute
    // an answer that is already in the row — and then hold a different one in
    // memory from the one the user is looking at on their own screen.
    if (readOnly) return;
    // A BIG PLAN DOES NOT GET ASKED ALL AT ONCE. Over LARGE_PLAN_SQFT the answer
    // to this question is reliably "no beds" — fifteen mattresses at forty pixels
    // each — and every bedroom is asked about on its own crop in the pipeline
    // instead. Spending 25 seconds and a call to be told nothing is worse than
    // not asking.
    //
    // ON THE FIRST UPLOAD THIS IS STILL FALSE, and deliberately: the area is not
    // knowable until there is a scale, which on a raster means until a door has
    // been measured — after this effect has run. So the first pass happens, the
    // pipeline supersedes it per room, and any re-run (the nonce, or a reopened
    // plan) is correctly skipped. Better one wasted call than a bed pass that
    // waits for the tracer on every plan, large or small.
    /* ================= THE WHOLE-PLAN BED PASS ==========================
     *
     * ONE CALL TO ONE TRAINED SEGMENTER — the `bed-filter` workflow — and this
     * is the primary path for every bed on every plan.
     *
     * It replaces three arrangements in a row, each of which was a way of
     * compensating for a detector that could not resolve a bed on a whole sheet:
     * the general-segmentation workflow asked for `bed` (whose boxes enclosed
     * whole twin PAIRS at 17 pixels to the foot), then GPT contested against it,
     * then two SAMPLES of GPT contested against each other with an arbiter to
     * settle them. A model that draws the mattress correctly the first time
     * makes all of that an expensive way to agree with itself. On the
     * FLOOR_PLAN_03 sample it returns one tight box with the nightstands
     * outside it.
     *
     * NO SECOND OPINION AND NO JUDGE. `bedSets` stays null, which is what keeps
     * the contest machinery dormant rather than deleted.
     *
     * THE SIZE GATE STILL RUNS, here and again in detectedZones. A better
     * detector is not a reason to stop measuring what came back; that gate is
     * what caught the twin-pair boxes and it costs nothing when the boxes are
     * right.
     *
     * The superseded implementation is below this block's `return`, intact.
     */
    let alive = true;
    const ctl = new AbortController();

    (async () => {
      setDetectState({ status: 'running' });
      const t0 = Date.now();
      try {
        const shot = await snapshotForDetection(source, img, {
          stroke: OTHER_STROKE_PX,
          // Two inches, always. See WALL_WEIGHT_IN in settings.js.
          wallStroke: Math.max(1, (WALL_WEIGHT_IN / 12) * (source.pxPerFt || 20)),
          wallLayers: wallLayerSet,
        });
        if (!alive) return;
        console.log(`[beds] whole plan -> bed-filter: sending ${shot.w}x${shot.h}`
          + ` of ${source.w}x${source.h}${shot.layers ? ` (${shot.layers} layers)` : ''}`);

        // No polygon: find every bed on the sheet now, and let the room filter
        // attribute them later. pxPerFt is null on a raster until a door has
        // been measured, in which case the gate simply does not run here —
        // detectedZones applies it once the scale exists.
        const image = { w: source.w, h: source.h };
        const { kept, rejected, payload } = await detectBeds({
          base64: shot.base64, mime: shot.mime, signal: ctl.signal,
          w: shot.w, h: shot.h, image, polygon: null, pxPerFt,
        });
        if (!alive) return;
        if (payload?.meta) console.log('[beds] server:', payload.meta);
        console.log(`[beds] bed-filter found ${kept.length} bed(s) on the whole plan`
          + `${rejected.length ? `, rejected ${rejected.length}` : ''}`,
          { kept, rejected });

        // NULL, DELIBERATELY. There is no second answer to contest, so the
        // judge has nothing to arbitrate. Setting this to null is what leaves
        // the contest path dormant instead of removed.
        setBedSets(null);
        setBedVerdicts({});
        setDetections(kept.map((k, i) => ({
          ...k, id: `bed-sheet-${i}-${Math.round(k.rect.x0)}-${Math.round(k.rect.y0)}`,
        })));

        // THE REASONS, NOT JUST THE COUNT. A size gate that quietly drops every
        // box on a plan is indistinguishable from a detector that found nothing,
        // and the two want completely different fixes.
        //
        // NOT FILTERED TO cls === 'bed' any more: this workflow answers one
        // question, so its class name is whatever its author called the project
        // and everything it returns is a bed. Filtering on the name here is how
        // the panel would report zero rejections on a run that rejected
        // everything.
        const whyRejected = (() => {
          if (!rejected.length) return null;
          const tally = new Map();
          for (const r of rejected) {
            // The reason without its measurement, so "10.6ft across" and
            // "8.8ft across" tally as one cause rather than as two.
            const key = String(r.reason).replace(/^[\d.]+ *(ft|sqft)/, '…').replace(/^[\d.]+:1/, '…:1');
            tally.set(key, (tally.get(key) || 0) + 1);
          }
          const [top, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
          return { n: rejected.length, top, topCount: n };
        })();
        setDetectState({
          status: 'done', rejected, whyRejected, ms: Date.now() - t0,
          meta: payload?.meta ?? null, count: kept.length, kind: source.kind,
          provider: 'bed-filter', sets: null,
        });
      } catch (err) {
        if (!alive || err.name === 'AbortError') return;
        console.warn('[beds] bed-filter failed:', err);
        setDetectState({ status: 'error', error: String(err.message || err), ms: Date.now() - t0 });
      }
    })();

    return () => { alive = false; ctl.abort(); };

    /* ============ THE SUPERSEDED WHOLE-PLAN PASS, COMMENTED OUT ==========
     * Intact below the return so it can be switched back on in one edit. It
     * asked BOTH detectors (general-segmentation + GPT) about the entire sheet
     * and contested them. Kept because the `provider` switch, `bedSets` and the
     * judge all still exist and this is the only caller that fed them.
     */
    /* eslint-disable no-unreachable */

    {  /* SCOPED so its `alive`/`ctl` do not collide with the live pass above.
       * The braces are the only edit to this block; everything inside is as it
       * was. */
    let alive = true;
    const ctl = new AbortController();

    (async () => {
      setDetectState({ status: 'running' });
      const t0 = Date.now();
      try {
        const shot = await snapshotForDetection(source, img, {
          stroke: OTHER_STROKE_PX,
          // Two inches, always. See WALL_WEIGHT_IN in settings.js.
          wallStroke: Math.max(1, (WALL_WEIGHT_IN / 12) * (source.pxPerFt || 20)),
          wallLayers: wallLayerSet,
        });
        if (!alive) return;
        console.log(`[detect] ${source.kind}: sending ${shot.w}x${shot.h} of ${source.w}x${source.h}`
          + `${shot.layers ? ` (${shot.layers} layers)` : ''}`
          + `${shot.wallLayerNames?.length ? `, walls@${shot.wallStroke}px on [${shot.wallLayerNames.join(', ')}]` : ''}`
          + `, classes=${ZONE_CLASSES.join(',')}`);

        const payload = await detectFurniture({
          base64: shot.base64, mime: shot.mime, classes: ZONE_CLASSES, signal: ctl.signal,
          // The size SENT, not the size of the original. The GPT route answers
          // in fractions of the image it was given and needs this to resolve
          // them; rescaleRect maps the result back afterwards as ever.
          // `judge` is two calls and a decision, and the decision is not made
          // here — the wire only knows about `both`.
          provider: wireProvider(provider), w: shot.w, h: shot.h,
        });
        if (!alive) return;
        if (payload?.meta) console.log('[detect] server:', payload.meta);

        // No polygon here on purpose: find everything on the plan now, and let
        // the room filter it later.
        const image = { w: source.w, h: source.h };
        // pxPerFt is null on a raster until a door has been measured, in which
        // case the gate simply does not judge — detectedZones applies it later.
        const { kept, rejected } = detectionsToZones(payload, { image, polygon: null, pxPerFt });
        console.log(`[detect] kept ${kept.length}, rejected ${rejected.length}`, { kept, rejected });

        // THE SAME RESPONSE, READ TWICE AND DIFFERENTLY. Above: everything at
        // once, de-duplicated, which is what goes on the canvas the moment
        // detection lands and what every non-judged run has always used. Below:
        // the two halves kept apart, because the judge's whole question is which
        // of them is right and a merge has already answered it.
        //
        // Both, and not one or the other, so there is something on screen before
        // the pipeline runs and the judged answer REPLACES it rather than being
        // the only thing that ever appears. A detector that lands while the user
        // is still tracing outlines should show its work.
        let sets = null;
        if (provider === 'judge') {
          sets = {};
          const split = splitByProvider(payload, (half) =>
            detectionsToZones(half, { image, polygon: null, pxPerFt }));
          for (const src of BED_SOURCES) sets[src.id] = labelBeds(split[src.id].kept, src.id);
          console.log('[detect] judged sets:',
            BED_SOURCES.map((x) => `${x.label} ${sets[x.id].length}`).join(', '));
        }
        setBedSets(sets);
        setBedVerdicts({});

        setDetections(kept.map((k, i) => ({ ...k, id: `det-${i}-${Math.round(k.rect.x0)}-${Math.round(k.rect.y0)}` })));
        // THE REASONS, NOT JUST THE COUNT. A size gate that quietly drops every
        // box on a plan is indistinguishable from a detector that found nothing,
        // and the two want completely different fixes. This is the difference
        // between reading server logs for twenty minutes and reading one line in
        // the panel.
        const whyRejected = (() => {
          const bedish = rejected.filter((r) => r.cls === 'bed');
          if (!bedish.length) return null;
          const tally = new Map();
          for (const r of bedish) {
            // The reason without its measurement, so "10.6ft across" and
            // "8.8ft across" tally as one cause rather than as two.
            const key = String(r.reason).replace(/^[\d.]+ *(ft|sqft)/, '…').replace(/^[\d.]+:1/, '…:1');
            tally.set(key, (tally.get(key) || 0) + 1);
          }
          const [top, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
          return { n: bedish.length, top, topCount: n };
        })();
        setDetectState({
          status: 'done', rejected, whyRejected, ms: Date.now() - t0,
          meta: payload?.meta ?? null, count: kept.length, kind: source.kind,
          provider,
          sets: sets ? Object.fromEntries(BED_SOURCES.map((x) => [x.id, sets[x.id].length])) : null,
        });
      } catch (err) {
        if (!alive || err.name === 'AbortError') return;
        console.warn('[detect] failed:', err);
        setDetectState({ status: 'error', error: String(err.message || err), ms: Date.now() - t0 });
      }
    })();

    return () => { alive = false; ctl.abort(); };
    }  /* end of the superseded pass */
    // `provider` is a dependency because switching provider is a deliberate act
    // whose whole purpose is to see the other answer — waiting for a second
    // click would just be a click. The nonce is the explicit re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, img, detectNonce, provider]);

  const toggle = (k) => () => setLayers((l) => ({ ...l, [k]: !l[k] }));

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
  // nothing is derived.
  const editorState = useMemo(() => serialiseEditor({
    unitId, scaleMode, refId, customFt, measure, doorPick, pxPerFt, ceilingFt,
    outlines, litIds, dirtyIds, focusId, selectedOutlineId, roomState,
    projectType: projectId, roomTypes, pdfPage,
    detections, dismissed, bedVerdicts, provider, zones,
    doors, doorsOk,
    ceilingObjs, chunkPicks, designPicks, ceilingKinds, ceilingShapes,
    lightMoves,
    accentResults, accentDismissed, manualAccents,
    surfaceResults, surfaceDismissed, manualSurfaces, artDismissed,
    wallResults, runTrims, manualCoves, manualTracks, manualCobs, autoSpots,
    cobArrays, trackFixtures,
    renderRefs, boardsOff, boardMoves, boardPoints, flowBoards, flowBends, manualBoards, boardKinds,
    boardHeights, boardOrders,
    // WHAT EACH SPACE IS FINISHED IN, AND HOW HIGH ITS CEILING IS — see the
    // note in planState.js. Both are sparse; both are the answer rather than an
    // adjustment to one, so both have to be kept.
    ceilingMm, materials, fixtureWatts, runsOff,
    layers, zoom, view,
  }), [unitId, scaleMode, refId, customFt, measure, doorPick, pxPerFt, ceilingFt,
       outlines, litIds, dirtyIds, focusId, selectedOutlineId, roomState, projectId, roomTypes, pdfPage,
       detections, dismissed, bedVerdicts, provider, zones, doors, doorsOk,
       ceilingObjs, chunkPicks, designPicks, ceilingKinds, ceilingShapes,
       lightMoves,
       accentResults, accentDismissed, manualAccents,
       surfaceResults, surfaceDismissed, manualSurfaces, artDismissed,
       wallResults, runTrims, manualCoves, manualTracks, manualCobs, autoSpots,
       cobArrays, trackFixtures, renderRefs, boardsOff, boardMoves, boardPoints,
       flowBoards, flowBends, manualBoards, boardKinds, boardHeights, boardOrders,
       ceilingMm, materials, fixtureWatts, runsOff,
       layers, zoom, view]);

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

  /**
   * APPLY A STEP.
   *
   * THE VIEWPORT AND THE SELECTION ARE HELD BACK, by handing `applyEditor`
   * no-ops for them. The document carries zoom, pan, the layer switches, the
   * selected space — because reopening a plan should put you back where you were
   * looking — and none of that is what Ctrl+Z is for. Undoing a change while the
   * canvas jumps to where it was two gestures ago is a worse experience than not
   * having undo: the person loses their place and cannot see what changed.
   *
   * Zoom and layers are left ALONE rather than restored, which is the only
   * behaviour that makes the two independent: pan somewhere, undo three
   * gestures, and you are still looking at the thing you were looking at.
   */
  const applyStep = useCallback((doc) => {
    if (!doc) return;
    undoing.current = true;
    const hold = () => {};
    applyEditor(doc, { ...stateSetters,
                       setFocusId: hold, setSelectedOutlineId: hold, setRoomState: hold,
                       setLayers: hold, setZoom: hold, setView: hold });
    // A FITTING THAT NO LONGER EXISTS CANNOT STAY SELECTED. Cheaper and more
    // honest than reconciling every selection against the restored document:
    // whatever was picked, the picture just changed under it.
    setSel(clear());
    setUndoDepth(historyDepth(history.current));
  }, [stateSetters]);

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
   * reason as `live`: runPipeline is async and captures its closure early.
   */
  const milestone = useRef(null);
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
        <ProjectTypeDialog planName={source.name} onPick={setProjectId}
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
                onClick={() => setLayers((l) => ({ ...l, invert: on }))}>
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
          trackOn={shapeMenuOn && shapeRole === 'track'}
          onTrack={() => (shapeMenuOn && shapeRole === 'track'
            ? closeShapeTool() : openShapeTool('track', { arm: false }))}
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
          shapeOn={shapeMenuOn && shapeRole === 'cove'}
          onShape={() => (shapeMenuOn && shapeRole === 'cove'
            ? closeShapeTool() : openShapeTool('cove'))}
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
            onSelect={setSelectedOutlineId}
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
            onRedetect={() => setRoomNonce((n) => n + 1)}
            unitId={source.unitId}
            unitCandidates={UNITS}
            onUnitChange={(u) => { setUnitId(u); }}
            /* The scale controls live on the tracer screen for an image, but the
               state stays here: it is the same scale the sidebar edits later,
               and two copies of it would drift the moment either was touched. */
            scale={isVector ? null : {
              mode: scaleMode, setMode: setScaleMode,
              refId, setRefId, customFt, setCustomFt,
              measure, setMeasure,
              doors, doorState, pick: doorPick,
              /* THE RECT RIDES ALONG WITH THE ID. See the note in `pxPerFt`:
                 the door boxes are editable from the electrical step now, so
                 the scale has to be anchored to the box that was measured
                 rather than looked up in a list that can change. */
              onPickDoor: (id) => setDoorPick(id
                ? { id, mm: null, rect: doors.find((d) => d.id === id)?.rect ?? null }
                : null),
              onSetWidth: (mm) => setDoorPick((d) => (d ? { ...d, mm } : d)),
              onRetryDoors: () => setDoorNonce((n) => n + 1),
              widths: DOOR_WIDTHS,
            }} />
        ) : showPicker ? (
          <ChunkPicker
            options={picking.chunking.options}
            recommendedId={picking.chunking.recommendedId}
            initialId={chunkPicks[picking.id] ?? null}
            onConfirm={(id) => {
              setChunkPicks((m) => ({ ...m, [picking.id]: id }));
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
                : (shapeMenuOn && shapeTool) ? 'crosshair'
                : shapeDrag ? 'grabbing'
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
                : addTool === 'cob' ? (overRoom ? 'crosshair' : 'default')
                : (armed || addTool) ? (overRoom ? 'crosshair' : 'pointer')
                : null}
              zones={drawnZones} draftZone={readOnly ? null : draftZone}
              zoneMode={!readOnly && zoneMode}
              onZoneDown={readOnly ? null : onZoneDown}
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
              draggingBoardId={boardDrag?.live ? boardDrag.id : null}
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
              flowGrab={flowDrag?.kind === 'board' && flowDrag.live
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
              onLightPointerDown={readOnly || armed || addTool || boardPlace || zoneMode
                || (shapeMenuOn && shapeTool) ? null : lightPointerDown}
              /* THE ONE IN FLIGHT, AND ONLY ONCE THE DRAG IS PAST ITS SLOP —
                 otherwise a press meant as a click would move the fitting by the
                 pixel of wobble that arrives with it. */
              movingLight={!readOnly && lightDrag?.live ? lightDrag : null}
              /* THE KEEP-OUT BAND, AND ONLY WHILE IT IS BEING MET. Shown when
                 a cove is being drawn, moved or resized — the three states in
                 which somebody is placing one and can be stopped by it. On a
                 finished sheet it would be a rule drawn over a drawing for
                 nobody. */
              coveClampPx={!readOnly && pxPerFt
                && ((shapeMenuOn && shapeTool) || shapeDrag?.live || shapeResize)
                ? COVE_GAP_FT * pxPerFt : null}
              /* THE KEEP-OUT BAND, AND ONLY WHILE IT IS BEING MET. Shown while
                 a cove is being drawn, moved or resized — the three states in
                 which somebody is placing one and can be stopped by it. On a
                 finished sheet it would be a rule drawn over a drawing for
                 nobody to meet. */
              coveClampPx={!readOnly && pxPerFt
                && ((shapeMenuOn && shapeTool) || shapeDrag?.live || shapeResize)
                ? COVE_GAP_FT * pxPerFt : null}
              coveShapes={coveShapesPx}
              selShapeId={readOnly ? null : selShapeId}
              /* AND WHICH ONE IS SHOWING ITS DIMENSIONS, which is a second and
                 narrower thing — see `shapeEditId`. */
              shapeEditId={readOnly || armed || addTool || boardPlace || zoneMode
                ? null : shapeEditId}
              onShapeHandleDown={readOnly ? null : shapeHandleDown}
              onShapePointerDown={readOnly || armed || addTool || boardPlace || zoneMode
                || (shapeMenuOn && shapeTool) ? null : shapePointerDown}
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
              draftShape={readOnly ? null : draftShapePx}
              /* ONE PEN DRAWING, WHICHEVER PEN IS HOLDING THE POINTER. The two
                  cannot both be live — arming the track tool closes the shape
                  menu and vice versa — so this is a choice and not a merge. */
              penDraft={readOnly ? null : (penDraftPx ?? trackDraftPx)}
              trackEdit={readOnly ? null : trackEditPx} selTrackPt={selTrackPt}
              onTrackPointDown={readOnly ? null : trackPointDown}
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
              onArrayPathDown={readOnly || armed || addTool || boardPlace || zoneMode
                ? null : arrayGrab}
              /* THE FITTINGS STAND DOWN AND THE GUIDES COME UP WHILE A
                 PRIMITIVE IS ARMED. `shapeMenuOn` alone is not the condition:
                 the bar also arrives unarmed on a click in a space (see
                 `onCanvasClick`), and dimming a ceiling's worth of lamps because
                 somebody selected a room would be the drawing reacting to a
                 selection. It is the LIVE primitive that means "I am about to
                 place geometry". */
              placingGeometry={!readOnly && shapeMenuOn && !!shapeTool}
              selCobId={readOnly ? null : selCobId}
              onCobPointerDown={readOnly || armed || addTool || boardPlace || zoneMode
                ? null : cobPointerDown}
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
                  const doomed = new Set(cobRun);
                  setManualCobs((l) => l.filter((c) => !doomed.has(c.id)));
                  setSel((cur) => (doomed.has(idOf(cur, 'cob')) ? clear() : cur));
                  setCobOpen(false); setCobMode(null); disarmAdd();
                }}
                /* --- THE ARRAY, WHERE THAT IS THE GESTURE --------------------
                   WHAT MAY BE ASKED COMES FROM THE GEOMETRY. `arrayAsks` reads
                   the outline and answers with the controls it can honestly
                   offer — no side or distance for an open path, no outward for a
                   room — so the bar draws what it is handed rather than working
                   it out from a flag per question. See lib/cob.js. */
                array={cobMode !== 'array' ? null : (() => {
                  const d = cobDraftArray;
                  const geo = d?.geomId ? arrayOutline(d.geomId) : null;
                  if (!geo) return { picked: false };
                  const asks = arrayAsks(geo.pts,
                    { closed: geo.closed, isRoom: geo.isRoom,
                      corners: geo.corners });
                  return {
                    picked: true, label: geo.label,
                    count: d.count, sideId: d.side, offsetFt: d.offsetFt,
                    side: asks.side, sides: asks.sides,
                    /* THE GEOMETRY'S OWN STEPS — see `arrayQuanta`. A rectangle
                       counts 4, 8, 12; a hexagon 6, 12, 18; a circle, which has
                       no corner a lamp is owed, counts freely. */
                    countMin: asks.countMin, countStep: asks.countStep,
                    /* THE LIMIT IS IN FEET AND THE OUTLINE IS IN PIXELS, so it
                       is converted here rather than at the input — which reads
                       feet, like every other length somebody types into this
                       app. */
                    maxOffsetFt: asks.maxOffsetFt / (pxPerFt || 1),
                  };
                })()}
                /* QUANTISED HERE TOO, AND AGAINST THE DRAFT'S OWN GEOMETRY.
                   The box steps in the right units, but it is also typable and
                   its arrows can be held — and a draft holding a count the
                   geometry cannot produce would draw a run that disagreed with
                   the figure beside it. Same rule `setArrayShape` applies to a
                   placed array; see `quantiseCount`. */
                onCount={(n) => setCobDraftArray((d) => {
                  if (!d) return d;
                  const geo = arrayOutline(d.geomId);
                  const q = arrayQuanta(geo?.corners, geo?.closed ?? true);
                  return { ...d, count: Math.min(200, quantiseCount(n, q)) };
                })}
                onSide={(id) => setCobDraftArray((d) => (d ? { ...d, side: id } : d))}
                onOffset={(ft) => setCobDraftArray((d) => (d
                  ? { ...d, offsetFt: Math.max(0, Number(ft) || 0) } : d))}
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
            {!readOnly && shapeMode && (
              <ShapeMenu stage={stageRef} mode={shapeMode}
                tool={shapeTool} sides={shapeSides}
                sizeLabel={shapeMode === 'draw' && shapeToCommit ? shapeSizeLabel(shapeToCommit)
                  : shapeMode === 'edit' && selShape ? shapeSizeLabel(selShape) : null}
                canCommit={canCommitShape}
                /* THE OFFSET, AND IT IS NULL UNLESS THE DRAFT WAS BORROWED. See
                   `heldAsks` — a shape dragged out from scratch has no geometry
                   to be set in from. */
                offset={heldAsks}
                onOffsetSide={(id) => setHeldOffset({ side: id })}
                onOffsetFt={(ft) => setHeldOffset({ ft: Math.max(0, Number(ft) || 0) })}
                radius={shapeMode === 'edit' && selShape && roundable(selShape)
                  ? { ft: selShape.radiusFt || 0, max: maxRadiusFt(selShape) } : null}
                onTool={pickShapeTool}
                onSides={(n) => { setShapeSides(n); setShapeAskSides(false); }}
                onCommit={commitShape}
                onCancel={() => {
                  /* ONE CROSS, TWO MEANINGS, AND THEY DO NOT COLLIDE. In the
                     sides step it is "back" — the polygon was never started, so
                     there is nothing to throw away and the tool goes back to
                     unarmed. Everywhere else there IS a draft and this is the
                     bin. */
                  if (shapeAskSides) { setShapeAskSides(false); setShapeTool(null); return; }
                  abandonShape();
                }}
                onRadius={(ft) => selShape && setCeilingShapes((l) => l.map((q) => (
                  q.id === selShape.id ? { ...q, radiusFt: ft } : q)))}
                onDuplicate={() => selShape && duplicateShape(selShape.id)}
                onDelete={() => selShape && deleteShape(selShape.id)} />
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
          && !stepTool && !wallEdit && !coveDraw && !sheetOpen && (
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
          && !boardPlace && !stepTool && !wallEdit && !coveDraw && (
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
                onClick={() => setView(k)}>{label}</button>
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
            focusId={focusId} onFocus={setFocusId}
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
            onOpenBOQ={() => setView('boq')}
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
              {manualBoards.length > 0 && (
                <div className="w-full text-left">
                  <div className={KV_HEAD}>
                    <span>{manualBoards.length} socket{manualBoards.length === 1 ? '' : 's'} placed</span>
                    <button className={BTN_TINY}
                      onClick={() => setManualBoards([])}>Clear all</button>
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
                    <button className={BTN_TINY} onClick={() => setZones([])}>Clear all</button>
                  </div>
                  {zones.map((z, i) => (
                    <div className={KV} key={z.id}>
                      <span>Zone {i + 1}</span>
                      <b>
                        {pxPerFt
                          ? `${((z.x1 - z.x0) / pxPerFt).toFixed(1)} × ${((z.y1 - z.y0) / pxPerFt).toFixed(1)} ft`
                          : `${Math.round(z.x1 - z.x0)} × ${Math.round(z.y1 - z.y0)} px`}
                        <button className={BTN_NUDGE} title="Remove zone"
                          onClick={() => setZones((zs) => zs.filter((q) => q.id !== z.id))}>×</button>
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
        ) : coveDraw ? (
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
                max-w-[22ch]">{coveDraw.title}</p>

              <div className="flex flex-col items-center gap-2 px-4 pt-3.5 pb-3
                border border-border rounded-[10px] bg-input-bg text-center">
                {coveDraw.art}
                <p className="m-0 text-[11px] leading-[1.5] text-muted max-w-[30ch]">
                  {coveDraw.hint}
                </p>
              </div>

              {/* WHY THE SPAN IN FLIGHT IS NOT A COVE. Under the card because it
                  is the answer to the drag being made right now, and it is only
                  ever there when something is wrong. */}
              {coveDraw.why && <p className={`${NW} m-0 text-left`}>{coveDraw.why}</p>}

              {/* FINISHING THE PATH IS NOT FINISHING WITH THE PEN, so it is its
                  own button and it only exists while there is a path that can be
                  finished — which for an open cove means one that lands on a
                  wall at both ends. Enter says the same thing; a keystroke
                  nobody is told about is not a way out. */}
              {canFinishOpen && (
                <button className={`${BTN_FULL} w-full`} onClick={finishOpenCove}>
                  Finish the run
                </button>
              )}

              <button className={`${BTN_EXIT} w-full`} onClick={closeShapeTool}>Done</button>
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
              {stepTool.id === 'track' && trackNoteLines.map((ln) => (
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
              autoplace={autoSpots.includes(openRoom.id)}
              onAutoplace={readOnly ? null
                : (on) => setAutoplace(openRoom.id, on)} />
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
                  onClick={() => setView('boards')}>
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
                onClick={() => { setManualCoves([]); disarmAdd(); }}>
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
                onClick={() => { setManualAccents([]); setManualSurfaces([]); disarmAdd(); }}>
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
                      onClick={() => {
                        setFanSweepMm(mm);
                        /* EVERY SELECTED FAN, NOT JUST THE PRIMARY. The chip
                           above it reads the primary's sweep, because with
                           three fans selected the only honest "current" value
                           is the one you touched last — but the ACT is what a
                           properties panel does, and that is to apply the
                           chosen value to everything selected it makes sense
                           for. Non-fans in the selection are left alone rather
                           than refused: selecting two fans and a cassette and
                           setting a sweep is a perfectly clear instruction
                           about the fans. */
                        const picked = new Set(selObjIds);
                        setCeilingObjs((os) => os.map((o) => (
                          picked.has(o.id) && o.kind === 'fan' ? withSweep(o, mm) : o)));
                      }}>{mm} sweep</button>
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
                  onClick={() => zoomTo((z) => z / 1.2, stageCentre())}>−</button>
                <button className={BTN} title="Actual size (0)"
                  onClick={() => zoomTo(1, stageCentre())}>{Math.round(zoom * 100)}%</button>
                <button className={BTN} title="Zoom in (+)"
                  onClick={() => zoomTo((z) => z * 1.2, stageCentre())}>+</button>
                <button className={BTN} title="Fit the plan to the window (F)"
                  onClick={() => setZoom(fitZoom())}>Fit</button>
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
                  onClick={lookAgainAtBeds}>
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
                if (readOnly) { setLayers((l) => ({ ...l, electrical: !l.electrical })); return; }
                if (zoneEdit) closeZoneEdit();
                if (doorEdit) { closeDoorEdit(); return; }
                if (!doorsOk) { openDoorEdit(); return; }
                setLayers((l) => ({ ...l, electrical: !l.electrical }));
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

