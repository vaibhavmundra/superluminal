import React, { forwardRef, useState } from 'react';
import { guideLine } from '../lib/snapGuides.js';
import { CEILING_BY_ID, isRect } from '../lib/ceilingObjects.js';
import { specsFor, runMetres, FIXTURE_BY_ID } from '../lib/boq.js';
import { STRIP_STYLE, THROW_STYLE, GLINT_STYLE, PILL_STYLE,
         COVE_BAND_STYLE } from '../lib/settings.js';
import { TRACK_DIMS_IN } from '../lib/track.js';
import { SB_COLOUR, SB_MM } from '../lib/electrical.js';
import { WIRE_CHAIN, WIRE_PICKED } from '../lib/flows.js';
import { doorWidthAt } from '../lib/doors.js';

// ---------------------------------------------------------------------------
// PlanCanvas — the finished drawing. EVERY room on it, not one.
//
// This took a `plan` and now takes `plans`, and the change is not cosmetic: a
// clip path, a grid, a cell shading and a set of lights all belong to one room,
// so each of them is now per-room and the clip paths need distinct ids. An id
// reused across rooms is the failure to watch for — SVG resolves url(#roomclip)
// to the FIRST match in the document, so every room would be clipped to room
// one and rooms two onward would vanish except where they happened to overlap
// it. Hence roomclip-<index>.
// ---------------------------------------------------------------------------

// THE DRAWING IS INK. THE ACCENT IS STATE.
//
// This was seven hues — indigo grid, green outline, red fans, amber zones, a
// magenta guide — and each of them was saying a second time what the symbol
// already said. A downlight is a circle, a large light is a bigger circle with
// a ring, a sconce is a crosshair on a wall, a spot has an arrow, a strip is a
// run with end caps, a fan is a blade circle. None of that needs a colour to be
// read, and spending the palette on it left nothing to say the one thing shape
// cannot: WHICH OF THESE AM I TOUCHING.
//
// So the drawing is an ink scale — the plan underneath in grey, our own line
// work in black, structure and annotation in between — and #0070F3 belongs to
// selection, hover, grips and guides. A blue element on this canvas is always a
// statement about state, never about type.
const C = {
  // our line work, heaviest to lightest
  ink: '#000000',
  region: '#000000',      // the space outline: the strongest thing we draw
  // THE FITTINGS ARE THE ACCENT, and this is the second considered exception to
  // "blue is state" — the first being the space fills on the tracer.
  //
  // The rule was written for a screen where the accent had one job and every
  // symbol could speak for itself. It still holds for the plan: walls, outlines
  // and dimensions are ink. But this drawing has a SUBJECT, and it is the
  // lights. On a finished layout the plan is the ground and the fittings are
  // the figure, and rendering the figure in the same black as the ground meant
  // forty downlights disappearing into somebody else's line work — the one
  // thing on the sheet the reader came for, drawn as if it were part of the
  // furniture. Blue on this canvas now means "this is ours and it emits light";
  // selection and guides are still blue too, and they are told apart by
  // behaviour — a grip is a handle you can grab, a fitting is a symbol.
  lit: '#ffb900',
  // The travelling pulse. LIGHTER, not brighter: the band sits under the dots,
  // so it has to read as the tape glowing rather than as a second line crossing
  // the first.
  pulse: '#7FB9FF',
  large: '#ffb900',
  small: '#ffb900',
  grid: '#C8C8C8',        // the grid is scaffolding, not drawing
  /* THE OPERATOR HUE. #C026D3 appears nowhere in the drawing and that is its
     whole job — see the note on the audit layer. Named here because the grid
     overlay now uses it too, and two literals of the same intent drift. */
  audit: '#C026D3',
  cell: '#D8D8D8',
  /* THE TWO ROUND CEILING OBJECTS. White, because it is the one thing the
     accent ramp is not — see the long note by `col` in the fansPx block for why
     they stopped being drawn in the accent at all. */
  object: '#FFFFFF',
  fan: '#404040',         // an obstacle is somebody else's object
  zone: '#737373',        // ...and so is a no-light zone
  measure: '#000000',
  faint: '#B8B8B8',       // debug overlays, the secondary grid
  // Controls are not drawing. Selection frames, grips and alignment guides are
  // UI that happens to be rendered in the drawing's coordinate space, so they
  // take the accent — and now that nothing else on the canvas is blue, the
  // accent means exactly one thing.
  grip: '#0070F3',
  guide: '#0070F3',
  sel: '#0070F3',
};

/**
 * HOW WIDE A POOL THIS CATALOGUE LINE THROWS, IN FEET — or null for none.
 *
 * Asked of the fitting's STATED WATTAGE and not of its id, which is the whole
 * point: `small` and `track-ambient` are two products bought from two pages, and
 * they are the same 7 W lamp throwing the same pool. Likewise `spot`,
 * `small-narrow` and `track-spot` are one 5 W lamp in three mountings. See
 * THROW_STYLE, which is also where the trigonometry behind the three diameters
 * is written down.
 *
 * A fitting the catalogue does not carry, or one whose wattage is deliberately
 * left null — a sconce, a strip, the track profile — answers null, because
 * neither `undefined` nor `null` is a key in the table. That is the honest
 * answer rather than an accident: a mark claiming a coverage the schedule
 * refuses to state a wattage for is a mark nobody can check.
 */
const poolFtFor = (fx) =>
  THROW_STYLE.diameterFtByWatt[FIXTURE_BY_ID[fx]?.watts] ?? null;

/**
 * THE ACCENT RAMP'S RIM TONE — the one flat colour on this canvas, and why.
 *
 * A gradient is the right paint for a FILL and useless on the line work around
 * it: the ring on a spot and its arrow are a couple of line-weights thick, and a
 * ramp across two pixels resolves to one colour whichever end you look at. The
 * arrow is worse than that — it is a LINE, so it has the degenerate bounding box
 * that already forced the strips into user space, and there is nothing to ramp
 * across in the first place. So a mark too thin to hold a gradient takes one
 * tone, and every such mark takes the SAME tone, so the symbol still reads as
 * one object cut from one ramp.
 *
 * IT IS NO LONGER A MODULE CONSTANT, because there are two palettes now. The
 * value is picked per render from the ground the plan is on — see `RAMP` and
 * `rim` inside the component — and it is `THROW_STYLE.rim` or
 * `THROW_STYLE.day.rim`. Nothing outside this file needs it.
 */

const PlanCanvas = forwardRef(function PlanCanvas(
  { src, srcAsScanned = null, vector = null, wallLayers = null,
    width, height, plans = [], focusId = null, selectedId = null,
    fansPx = [], pxPerFt, layers, zoom, measure, onCanvasClick, toPx,
    zones = [], draftZone = null, zoneMode = false, onZoneDown, onZoneMove, onZoneUp,
    accents = [], objMode = false, onObjPointerDown,
    /* EVERY SELECTED CEILING OBJECT, because Shift-click builds a set of them.
       This was `selObjId`, one id. The frame is drawn on all of them; the resize
       and rotate HANDLES only appear when there is exactly one — see the note by
       them — so a canvas handed several selected objects shows several framed
       objects and no grips, which is the honest picture of what can be done to a
       group here. */
    selObjIds = [],
    /* IS A FITTING TOOL ARMED? Only the ceiling objects' move target reads it,
       and only to get out of the way — see the long note there. Default false,
       so a canvas that does not pass it is one whose objects are always
       grabbable, which is the right default for a canvas with no tools. */
    placing = false,
    /* PUT THE PLAN ITSELF DOWN, so our own line work is what reads. Set while a
       reverse cove is being aimed and at no other time — see the scrim below,
       and `canvasLayers` in App.jsx for why the cove and nothing else. */
    wash = false,
    objDragMode = null, guides = [], ghost = null, clearanceFt = 2,
    selAccId = null, onAccPointerDown, surfaces = [], taskSpots = [], switchboards = [],
    /* WHICH PLATE IS PICKED, AND HOW ONE GETS PICKED. Optional, like every
       other handler here — a canvas given neither draws boards that cannot be
       selected, which is what the read-only sheet wants. A board is DERIVED, so
       the only edit there is on one is removal; there is no drag, and hence no
       pointer-move or pointer-up pair to go with this. */
    selBoardId = null, onBoardPointerDown = null,
    /* --- COVES SOMEBODY DREW -------------------------------------------------
       ONE ENTRY PER SHAPE, already in plan pixels — this file draws geometry and
       does not compute it. `lit` says whether the layout took the shape up as a
       cove: a shape over a lit space is already on the sheet twice over (its
       setting-out line in `plan.covesPx`, its tape among the accents), so all
       this layer owes it is a way to grab it. One that is NOT lit — drawn over a
       space that has not been laid out, or too small to carry a pocket — has
       nothing else drawing it, and would otherwise be an object that vanished
       the moment it was committed.

       `draftShape` is the gesture in flight and `penDraft` the pen's path so
       far; both are drawn by this file and go no further, exactly as the reverse
       cove's own draft does. Nothing downstream can see a shape that has not
       been ticked. */
    coveShapes = [], selShapeId = null, onShapePointerDown = null,
    /* WHICH SHAPE IS SHOWING ITS DIMENSIONS, and the press on one of its grips.
       Narrower than `selShapeId` on purpose: selection is one press and gets the
       contextual bar, dimensions are a second press and get eight handles. See
       `shapeEditId` in App.jsx. */
    shapeEditId = null, onShapeHandleDown = null,
    draftShape = null, penDraft = null,
    /* WHICH PLATE IS IN FLIGHT, if any. Told rather than derived: a board moved
       yesterday and a board being moved right now are the same geometry and want
       different cursors, and there is nothing on the board itself that separates
       them. */
    draggingBoardId = null,
    /* THE LOOPING. One entry per flow, each already carrying its own path — see
       flows.js. Nothing here recomputes it: the arcs are geometry and this file
       draws geometry. Empty by default, so a canvas handed none is a lighting
       sheet with no wiring on it, which is every caller that has not asked. */
    flows = [],
    /* --- EDITING A WIRE ------------------------------------------------------
       WHICH LOOP IS PICKED, AND THE TWO GESTURES ON IT. Optional like every
       other handler here, so a canvas given none draws wires that cannot be
       touched — which is the read-only sheet and the print.

       ONE SELECTION FOR THE WHOLE LOOP, AND NOT PER LEG. A flow is one switch;
       its legs are how that switch reaches its lamps, and picking "the third
       arc" as a thing in its own right would be picking a piece of drawing
       rather than a piece of the design. So the click selects the flow, the
       whole chain lights, and the grips then appear on EVERY leg — which is
       what makes "adjust any one of them" possible without ever making a leg a
       selectable object.

       TWO GRIPS, TWO MEANINGS, ONE HANDLER. `onFlowGripDown` is told which:
       'board' is the end at the plate, and dragging it re-assigns the switch;
       'bend' is a leg's own peak, and dragging it moves the arc off whatever it
       was crossing. They are one handler because they are one pointer pipeline
       in the caller — see `flowDrag` in App.jsx — and two would be two places to
       forget to capture the pointer. */
    selFlowId = null, onFlowPointerDown = null, onFlowGripDown = null,
    /* WHERE THE BOARD END IS RIGHT NOW, mid-drag, in plan pixels — and the
       plate it would land on if the finger came up here.

       TOLD RATHER THAN DERIVED, exactly as `draggingBoardId` above is. The
       committed assignment is not written until the drop (unlike a board slide,
       which writes per move — see the note there), because a wire re-assigned
       on every pointermove would re-order the loop, re-cut both plates'
       compositions and repaint the panel forty times on the way past. So for
       the length of the gesture the wire's end is a thing the caller is holding,
       and this is how it gets drawn. */
    flowGrab = null,
    // WHICH SPOT IS PICKED, AND HOW ONE GETS PICKED. Optional like every other
    // handler here: a canvas given neither is a drawing whose spots cannot be
    // selected, which is what the read-only sheet wants.
    selSpotId = null, onSpotPointerDown = null,
    // THE RENDER PASS'S READING. A list of wall features, each already reduced
    // to ONE rectangle in plan pixels — the union of its run of grid cells —
    // plus the individual cells for the tick marks. See wallGrid.js.
    wallCells = [], reverseCoves = [],
    // THE AUDIT LAYER — off for everybody except an owner of this app. See the
    // block near the bottom of this file for what it draws and why the marks it
    // restores were removed from the drawing proper.
    audit = false,
    // THE DOOR DETECTOR'S OWN READING, on a switch of its own rather than on
    // `audit`. The bed and surface overlays answer "why is the layout like
    // this"; this one answers "is the SCALE right", which is a different
    // question asked at a different moment — and it is the question, because
    // every dimension on the sheet hangs off one of these boxes.
    auditDoors = false, doorBoxes = [], doorRejects = [], doorPickId = null,
    /* THE BEDS THE DETECTOR FOUND, on a switch of their own like the doors.
       Empty unless somebody asked, so this list IS the switch — see the group
       that draws it for why they came off the general audit overlay and what
       brought them back. */
    bedBoxes = [],
    /* --- CONFIRMING THE DOORS ------------------------------------------------
       A DIFFERENT LAYER FROM `auditDoors` ABOVE, THOUGH IT DRAWS THE SAME
       BOXES, and the difference is who it is for. That one is an owner asking
       whether the SCALE is right — a read-only print of what the detector
       thought, on an admin switch. This is a step in the electrical workflow
       that a client is walked through: the boxes are the thing being edited,
       because a switchboard is placed beside a door and a door nobody found is
       a room with no switch.
       `doorEditBoxes` and not `doorBoxes`, because the caller resolves the box
       being dragged into the list before handing it over — the drag's live rect
       is deliberately not written into the app's door list until release. */
    doorEdit = false, doorEditBoxes = [], selDoorId = null, doorDraft = null,
    onDoorDelete = null,
    /* THE PLANNER'S OWN SCAFFOLDING, ON REQUEST.
       The chunk boxes and the 
       cell lines every downlight was laid on. It came off the drawing because
       it is not the design — a sheet with the working still on it is a sheet
       nobody can read — and `gridPath` has sat here unused ever since.
       It comes back as an explicit, admin-only switch, because the one question
       this drawing genuinely cannot answer without it is "why did the layout
       come out like that": a light sitting oddly is a chunk that split oddly,
       and the split is invisible unless it is drawn. Gated `isAdmin && showGrid`
       upstream, and defaulted false here so every other caller — the read-only
       sheet, the thumbnail, the tests — is exactly as it was. */
    showGrid = false,
    onFixture = null, draftRun = null,
    /* --- MOVING A LIGHT INSIDE ITS OWN CELL ---------------------------------
       `selLightId` is `${roomId}|${cellKey}` — a light is named by the cell it
       serves, because its own id is an index into an array rebuilt on every
       layout. `movingLight` is the one in flight, carried rather than committed:
       the store is written on release (see `lightPointerMove` in App.jsx for why
       a solver must not run in a mousemove), so for the length of the gesture
       this prop is the only thing that knows where the fitting is. */
    selLightId = null, onLightPointerDown = null, movingLight = null,
    // WHICH PIECE OF CEILING IS BEING DECIDED, and the two things that can be
    // done about it. `optionPick` is { roomId, key }; `plans[i].design` carries
    // the chunks themselves. See the pill at the foot of this file.
    optionPick = null, onPickChunk = null, onCycleOption = null,
    placeSnap = null, sconceGhost = null, cursor = null },
  ref
) {
  // WHICH FITTING IS WARM. Local, because nothing outside this file needs to
  // know — the tooltip is told separately through `onFixture`, and what it
  // needs is a screen position this component would otherwise have to invent.
  const [hot, setHot] = useState(null);
  /**
   * WHAT A FITTING IS WHILE SOMETHING IS BEING PLACED: nothing to hover, nothing
   * to click, and no cursor of its own.
   *
   * THE COVE IS WHAT FOUND THIS. Its gesture is a drag ALONG A WALL, which is
   * exactly where the fittings that hug walls already are — a cove, a strip, a
   * sconce — and every one of them carries a hit band ten line-widths wide with
   * `cursor: pointer` on it. Aiming at the wall put the pointer on an existing
   * run instead: the crosshair that says "this click will place something"
   * turned into a hand that says "this click will select something else", and
   * the press it invited was the wrong one. The same was true of every fitting
   * on the sheet for every armed tool; the cove is only where it became
   * unmissable, because the cove has to be aimed AT the line rather than at
   * open ceiling.
   *
   * `pointerEvents: 'none'` AND NOT MERELY A DIFFERENT CURSOR. Getting the
   * cursor right and leaving the target live would fix the lie and keep the
   * theft — the click would still land on the fitting. What is wanted is for
   * the fittings to not be there for the duration of the gesture, which is what
   * this says.
   *
   * IT IS THE SAME `placing` THE CEILING OBJECTS' MOVE TARGETS ALREADY OBEY —
   * see the note by them — so this is that rule applied to the rest of the
   * drawing rather than a new one.
   */
  const INERT = { style: { pointerEvents: 'none' } };
  /**
   * The hover contract for one fitting: warm its stroke and hand the tooltip
   * enough to draw itself. Enter and leave only — following the pointer with
   * mousemove made the card jitter under the cursor and told nobody anything
   * they did not already have.
   */
  const feel = (id, spec) => (placing ? INERT : {
    onMouseEnter: (e) => {
      setHot(id);
      if (spec) onFixture?.({ ...spec, x: e.clientX, y: e.clientY });
    },
    onMouseLeave: () => {
      setHot((h) => (h === id ? null : h));
      onFixture?.(null);
    },
    style: { cursor: 'pointer' },
  });

  /**
   * WHICH PALETTE THIS DRAWING IS IN, and it is the ground that decides.
   *
   * `layers.invert` means the scan has been turned into a negative, so the plan
   * is BLACK — and the cream ramp (#fef1dd through #c2a987) is what reads on it.
   * Un-inverted, the plan is white paper, and cream is four percent off white:
   * the fittings were there and could not be seen. The light-ground palette is
   * the same three ramps in amber. See THROW_STYLE.day in settings.js for the
   * tones and for why their depths run the opposite way round.
   *
   * THE GRADIENT IDS DO NOT CHANGE — only their stops do. That is what keeps
   * this to one decision: `url(#lp-core)`, `url(#lp-throw)`, `url(#lp-lit)`,
   * every per-run strip and rail ramp and the pill all go on referring to the
   * same paint servers, and not one of the fifty places that paints with them
   * has to know which mode it is in. Swapping a gradient for a flat colour per
   * mode would have meant touching every one of them.
   *
   * A VECTOR PLAN USED TO BE THE KNOWN INEXACTNESS AND IS NOT ANY MORE. The
   * note here said a DXF has no bitmap to invert, draws on the page's own black,
   * and therefore sits on a dark ground while reporting `invert: false` — so it
   * took the amber set, amber being readable on both grounds and cream on only
   * one. Two halves of that have since changed: a DXF is drawn on an opaque
   * white sheet in day mode (see the paper card in App.jsx), so it was NOT on a
   * dark ground; and it now has a real night mode of its own, so the flag tells
   * the truth about it. Either way `layers.invert` is the ground, for a DXF as
   * much as for a scan, and this line needs no exception.
   */
  const RAMP = layers.invert ? THROW_STYLE : THROW_STYLE.day;
  const rim = RAMP.rim;

  /**
   * A NO-LIGHT ZONE IS INK, SO IT FOLLOWS THE GROUND.
   *
   * `C.zone` is #737373 — somebody else's object, deliberately quieter than our
   * own line work, and correct on white paper. On the inverted plan the ground
   * is black and a mid-grey hatch at 45% is very nearly nothing: you draw a box
   * over a bed, the marquee lets go, and the thing you just drew is gone. The
   * zone is not a fitting and has no ramp to take, so it goes the way the
   * ceiling objects went — white, which is the one tone that is legible on
   * black and is not the accent (see `C.object`).
   *
   * ONE TONE FOR THE HATCH, THE BORDER AND THE DRAFT, because they are one
   * mark: the pattern in `defs` is what fills the rect it is stroked around,
   * and the draft is that same rect mid-drag.
   */
  const zoneInk = layers.invert ? C.object : C.zone;

  /**
   * THE SPACE OUTLINE, AND IT FOLLOWS THE GROUND FOR THE ZONE'S OWN REASON.
   *
   * `C.region` is pure black — "the strongest thing we draw", which is exactly
   * right on white paper and is the page's own background on the negative. The
   * layer was force-OFF in night mode for most of this app's life, so nothing
   * ever painted it there and the collision never showed. It paints there now:
   * the cove step turns the outlines on precisely BECAUSE the drag has to be
   * aimed at one (see `canvasLayers` in App.jsx), and an outline drawn in the
   * ground colour would have made that step worse than the state it fixes —
   * the plan faded, and the line it was faded for invisible.
   *
   * WHITE, LIKE THE ZONES AND THE CEILING OBJECTS. Not the accent: the accent
   * on this canvas means "ours and it emits light", and an outline is neither.
   */
  const regionInk = layers.invert ? C.object : C.region;

  const s = pxPerFt || 1;
  /**
   * INCHES, IN THE DRAWING'S OWN UNITS.
   *
   * Almost everything on this sheet is sized in MULTIPLES OF `lw` — the fitting
   * symbols, the option pill, the guides — because almost everything on this
   * sheet is a SYMBOL, and a symbol is sized to be read rather than to be true.
   * A downlight drawn to its real 90 mm cut-out would be a dot on an apartment
   * plan and would tell the reader nothing.
   *
   * A TRACK IS THE EXCEPTION, and it is an exception because it is not a symbol.
   * It is an OBJECT: a profile with a real width, carrying modules of a real
   * length, set out on the slab and measured to. Drawn to size, the heads read
   * as what they are — white modules seated in a dark run, spaced as they will
   * actually be spaced — and the drawing can be scaled off. Drawn as symbols
   * they would be circles floating over a line, which is the one thing a track
   * drawing must not look like.
   *
   * The figures come from TRACK_DIMS_IN in track.js rather than from here, and
   * only the LENGTHS there affect the layout — a run's centreline does not move
   * when the profile is drawn heavier. This file is the only reader of the
   * widths.
   *
   * Nothing here is clamped to a minimum. `s` is fixed per plan (the zoom is a
   * CSS scale on the whole stage, not a change to these units), so a true inch
   * is a true inch at every zoom, and inventing a floor would make the profile
   * read as wider than it is on exactly the plans where space is tightest.
   */
  const inch = (n) => (n * s) / 12;

  // THIN AND CRISP. This was /900 and everything on the drawing is a multiple
  // of it, so the one number sets the weight of the whole sheet. A lighting
  // layout is an overlay on somebody else's line work and should read as one —
  // heavy strokes make it look like the plan is ours.
  const lw = Math.max(width, height) / 1500;

  /**
   * HOW A LINEAR MARK IS CLICKED, and why it needs saying out loud.
   *
   * `.hit` means `pointer-events: all`, and on an SVG shape that means the
   * INTERIOR as well as the stroke — regardless of `fill`. A closed path with
   * `fill="none"` and `.hit` on it is therefore live over everything it
   * encloses, which is fine until something else needs to be clicked in there.
   * That is exactly the bug styles.css warns about, and it bit twice: the cove
   * STRIP is a closed dotted path drawn after the cove LINE, so it was live over
   * the whole coved chunk and swallowed every click meant for the line — leaving
   * a chunk whose cove carries it on its own with no way back to its options at
   * all. The track profile arrived later with the same shape and the same fault.
   *
   * AND IT HAS TO BE DECLARED AFTER `lw`, which is the other thing this block
   * has already got wrong once. A const initialised from `lw` above its
   * declaration is a temporal-dead-zone error that throws on the first render —
   * `vite build` compiles it happily and no test in tools/ rendered a component,
   * so it reached the browser. tools/test-render.mjs exists because of this.
   *
   * So a linear mark gets an explicit BAND: an invisible, solid, fat stroke over
   * the same path, with `pointer-events: stroke` in an INLINE STYLE — inline
   * beats the `.hit` class rule, where a `pointerEvents` attribute would lose to
   * it. Solid because `pointer-events: stroke` on a DASHED stroke follows the
   * dashes, so a dotted mark would be clickable only on its dots.
   *
   * The band is generous on purpose. A cove line is 1.6 lw and a track profile
   * an inch: both are far finer than a pointer, and both are the only mark their
   * piece of ceiling has.
   */
  const HIT_BAND = lw * 10;
  const bandStyle = placing ? INERT.style : { cursor: 'pointer', pointerEvents: 'stroke' };

  const laid = plans.filter((r) => r.plan?.ok);
  /**
   * IS A CLICK ON A FITTING A CHOICE ABOUT THE CEILING RIGHT NOW?
   *
   * Not while something else owns the click. Boxing a no-light zone or placing
   * an armed fitting means the pointer is spoken for, and a click that both
   * drops a sconce and reopens a chunk's options is a click nobody asked for.
   * The caller withholds the handler while a tool is armed — see the PlanCanvas
   * call site — and this is only the local reading of that.
   *
   * `!objMode` WAS IN HERE AND IT WAS A BUG. `objMode` is not a gesture in
   * flight, it is a sticky context: once anything turned it on it stayed on, so
   * after touching a single fan EVERY downlight on the plan quietly stopped
   * offering its options pill — the click landed, `pickable` was false, and no
   * handler was attached to fire. Nothing about a fan being selected makes a
   * question about a chunk's ceiling invalid.
   *
   * AND THE TWO CANNOT COMPETE FOR THE CLICK ANYWAY, which is why removing it
   * costs nothing. A light's pill and an object's grab are two different `.hit`
   * shapes, and where they overlap the answer is paint order, not a mode: the
   * objects layer is drawn after the grid, so a click inside a fan's footprint
   * goes to the fan and a click outside it goes to the lamp. A dragged object
   * is separately safe — `objPointerDown` calls `stopPropagation`, so the drag
   * never reaches a light underneath it.
   */
  const pickable = !!onPickChunk && !zoneMode;

  // each chunk draws its own outline plus its own interior grid lines —
  // no line ever crosses a no-light zone, because the zones aren't in any chunk
  //
  // IN THE OPERATOR HUE, NOT THE GREY IT USED TO BE. `C.grid` is #C8C8C8, which
  // was right when this was a layer of the drawing and had to sit under the ink
  // without competing with it. It is not a layer of the drawing any more — it
  // only appears when an owner asks for it — so it takes the same magenta as
  // the audit marks, meaning the same thing they mean: you are looking at the
  // working, not at the sheet. It also has to be legible on a night plan, where
  // a pale grey line over an inverted scan is very nearly nothing.
  //
  // `chunksPx` GUARDED, because a plan that laid no chunks is a real state —
  // see the same `?? []` on the coves below — and this now renders on demand
  // rather than only where the caller already knew there was a grid.
  const gridPath = (plan) => (
    <g pointerEvents="none">
      {(plan.chunksPx ?? []).map((ch, k) => (
        <g key={k}>
          <rect x={ch.x0} y={ch.y0} width={ch.x1 - ch.x0} height={ch.y1 - ch.y0}
            fill="none" stroke={C.audit} strokeWidth={lw * 1.8} opacity="0.75" />
          <g stroke={C.audit} strokeWidth={lw} opacity="0.5" strokeDasharray={`${lw * 6} ${lw * 4}`}>
            {ch.xLines.slice(1, -1).map((x, i) => <line key={'x' + i} x1={x} y1={ch.y0} x2={x} y2={ch.y1} />)}
            {ch.yLines.slice(1, -1).map((y, i) => <line key={'y' + i} x1={ch.x0} y1={y} x2={ch.x1} y2={y} />)}
          </g>
        </g>
      ))}
    </g>
  );

  const points = (poly) => poly.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <svg
      ref={ref}
      className="plan"
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: width * zoom, maxWidth: 'none',
               touchAction: (zoneMode || doorEdit) ? 'none' : undefined,
               cursor: cursor || undefined }}
      /* THE CLICK IS OFF WHILE THE DOORS ARE BEING CONFIRMED. `onCanvasClick`
          selects a space or clears the selection, and the browser synthesises it
          after every press this layer has already answered — so without this a
          box drawn over a bedroom would also select the bedroom, and the panel
          the step just emptied would fill back up underneath the question. */
      onClick={doorEdit ? undefined : onCanvasClick}
      onPointerDown={onZoneDown} onPointerMove={onZoneMove}
      onPointerUp={onZoneUp} onPointerCancel={onZoneUp}
    >
      <defs>
        {laid.map((r, i) => (
          <clipPath key={r.id} id={`roomclip-${i}`}>
            <polygon points={points(r.plan.polygonPx)} />
          </clipPath>
        ))}
        <pattern id="nlz" width={lw * 9} height={lw * 9} patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2={lw * 9} stroke={zoneInk} strokeWidth={lw * 1.6}
            opacity={layers.invert ? 0.6 : 0.45} />
        </pattern>

        {/* THE GLOW UNDER A FITTING, AS A GRADIENT AND NOT A BLUR.
            A feGaussianBlur over a solid disc is the literal reading of "a
            blurred circle", and it is the wrong tool three times over: the blur
            radius is in user units so it needs a different filter for a small
            and a large downlight, filters are re-rasterised on every frame of
            an animation and there are forty of these on a plan, and a blurred
            disc still has a solid core with a soft rim — which reads as a
            smudge rather than as light. A radial gradient falls off from the
            middle the whole way out, costs nothing to animate, and is what a
            pool of light actually looks like from above. */}
        {/* THE GLOW UNDER A STRIP. A run is a line, so the downlights' radial
            gradient is the wrong shape for it — what a strip throws is a band,
            brightest on the tape and falling off to either side. A real
            Gaussian blur on a thick line gives exactly that, and the objection
            that killed the idea for the downlights does not apply here: the
            blur radius is in user units, and there is one line weight per
            sheet, so one filter serves every strip on the plan. There are also
            a handful of strips rather than forty downlights, which is the
            difference between a filter being affordable and not. */}
        {/* userSpaceOnUse, AND THAT IS A BUG FIX, NOT A PREFERENCE.
            A filter region given in percentages is relative to the filtered
            element's OWN BOUNDING BOX, and a horizontal or vertical line has a
            bounding box with zero height or zero width. `height="900%"` of zero
            is zero, so the region collapses and the renderer improvises: the
            blurred band came out with a one-tile-wide white notch in it that
            MOVED as the stroke width animated, which looks exactly like a
            deliberate spark travelling down the run and is nothing of the sort.
            It only appeared while the glow was animating, which is what made it
            look like our own animation misbehaving rather than a filter region
            being degenerate.
            An explicit region in user space cannot collapse. The plan's own
            extent plus a margin for the blur covers every strip on the sheet,
            and one filter serves them all because there is one line weight per
            drawing. */}
        <filter id="lp-strip-glow" filterUnits="userSpaceOnUse"
          x={-lw * 60} y={-lw * 60}
          width={width + lw * 120} height={height + lw * 120}>
          <feGaussianBlur stdDeviation={lw * STRIP_STYLE.glowBlur} />
        </filter>

        <radialGradient id="lp-glow">
          <stop offset="0%" stopColor={C.lit} stopOpacity="0.42" />
          <stop offset="45%" stopColor={C.lit} stopOpacity="0.20" />
          <stop offset="100%" stopColor={C.lit} stopOpacity="0" />
        </radialGradient>

        {/* THE FLOOR POOL'S FILL — RADIAL, FROM THE LAMP OUTWARDS.
            A light does not fall across the floor left to right; it falls from
            the fitting outwards, so the ramp runs from the centre out. `offset`
            is therefore a RADIUS and not a distance across the sheet: 0% is
            directly under the lamp and 100% is the rim of the six-foot circle.
            CENTRED ON THE FITTING FOR FREE, and that is worth stating because it
            is the one thing this could get wrong. There is no `gradientUnits`
            here, so it defaults to objectBoundingBox — the box of the circle
            being filled — and cx/cy of 50% is that box's middle, which is the
            light's own position. Nothing has to be recomputed per fitting, and
            the pool cannot drift off its lamp when the plan is panned or the
            fitting is nudged. `userSpaceOnUse` would have needed cx/cy in plan
            pixels, i.e. a gradient per light, which is forty gradients in the
            defs and forty chances to be out of step with the mark they fill.
            THE STOPS ARE THE BRAND ACCENT, UNCHANGED — see THROW_STYLE. That
            list mirrors about its middle (dark, light, dark), which sweeping
            across a shape reads as a sheen and reading outwards from a centre
            reads as a soft ring. Reverse the list in settings.js for a
            centre-bright pool instead; it is one edit in one place. */}
        <radialGradient id="lp-throw" cx="50%" cy="50%" r="50%">
          {RAMP.stops.map((st) => (
            <stop key={st.at} offset={st.at} stopColor={st.color} />
          ))}
        </radialGradient>

        {/* THE SAME STOPS, LAID FLAT — for filling an AREA rather than a pool.
            `lp-throw` above is the right shape for a circle under a lamp and the
            WRONG one for a rectangle, which is a mistake worth recording because
            it looked correct in the markup and only failed on screen. Read
            outwards from a centre, the accent ramp is dark-light-dark, and
            objectBoundingBox stretches that mirror into an ellipse fitted to the
            rect's aspect — so a lit dining table came out with a visible dark
            DONUT floating in it. It read as a stain on the drawing, not as a
            surface with light on it.
            Laid across instead, the same mirror reads as an even sheen: bright
            through the middle, settling to the accent's deeper tone at both
            edges. Which is also what a wash off a ceiling spot actually looks
            like on a worktop.
            objectBoundingBox IS SAFE HERE, unlike on the strips. The degenerate
            -bbox trap that forces those into user space needs a shape with zero
            width or zero height, and a task surface is a rectangle with real
            extent in both axes — the detector cannot mark a table with no
            depth. So one gradient serves every surface on the sheet. */}
        <linearGradient id="lp-lit" x1="0" y1="0" x2="1" y2="0">
          {RAMP.stops.map((st) => (
            <stop key={st.at} offset={st.at} stopColor={st.color} />
          ))}
        </linearGradient>

        {/* A FITTING'S OWN BODY. Every symbol on this sheet that stands for
            something with a lamp in it used to be filled FLAT WHITE, and the
            white was doing a real job: it is an opaque ground, so the symbol
            stays legible sitting on top of somebody else's line work instead of
            having a wall or a door jamb showing through the middle of it.
            This keeps that job and stops being white. The ramp is opaque at
            every stop — see `coreStops` in settings.js — so the ground is as
            solid as it ever was, and it now says the one thing a white disc
            could not: that the thing you are looking at is emitting. Brightest
            at the centre, falling to the accent's deepest tone at the rim, which
            is what a lit aperture looks like from below.
            objectBoundingBox again, and safe for the same reason `lp-lit` is:
            every shape this fills — a circle, a track head's rect, a spot's
            ellipse — has real extent in both axes. The one thing to know is that
            a NON-SQUARE bbox stretches the ramp into an ellipse fitted to the
            shape, which is why the track head reads as a lamp lying along its
            profile rather than as a disc floating in a rectangle. That is the
            right answer here; it was the wrong one on a task surface. */}
        <radialGradient id="lp-core" cx="50%" cy="50%" r="50%">
          {RAMP.coreStops.map((st) => (
            <stop key={st.at} offset={st.at} stopColor={st.color} />
          ))}
        </radialGradient>

        {/* THE SELECTION OUTLINE'S RAMP. `lp-lit` was the obvious thing to
            stroke it with and it was WRONG on the sheet: that ramp's middle stop
            is #fef1dd, so the outline faded out along the middle of the top and
            bottom edges and the selected room stopped being marked at all over
            half its perimeter. Caught by cropping the render onto the palest
            part of the edge, which is worth doing to anything stroked with a
            gradient — a fill hides this and a line cannot.
            `inkStops` is the same mirror between the ramp's two deeper tones:
            still a gradient, still seamless where a closed outline joins itself,
            and never lighter than #efd5b2. See settings.js. */}
        <linearGradient id="lp-sel-ramp" x1="0" y1="0" x2="1" y2="0">
          {RAMP.inkStops.map((st) => (
            <stop key={st.at} offset={st.at} stopColor={st.color} />
          ))}
        </linearGradient>
      </defs>

      {/* The plan underneath. A raster plan is an image; a DXF is its own line
          work, drawn one path per layer — the layers being read as walls at full
          weight, everything else faint, so what the room outline was taken from
          stays visible under the layout.

          AND A DXF HAS A NIGHT MODE NOW, WHICH IT DID NOT BEFORE. `invert` used
          to mean one thing only — the scan has been subtracted from 255 upstream
          — and a DXF has no bitmap to subtract, so the switch was hidden on one
          and this branch drew #4A4A4A walls on white paper unconditionally. On
          the black ground the design step now opens with, those greys are two
          shades off invisible.

          SO THE GREYS COME FROM THE GROUND, which is the one thing a filter
          could never have done here: these paths are OUR ink, so inverting the
          element would invert the drawing we chose the colours for. Picking a
          light pair instead of a dark pair is the same decision made in the
          right place, and it costs two ternaries.

          NOT A LITERAL INVERSION OF THE TWO VALUES. 255 minus #4A4A4A is
          #B5B5B5 and minus #9E9E9E is #616161 — a wall that reads and a
          secondary line that has gone dark grey on black, i.e. the faint layer
          becomes the invisible one and the hierarchy flips over. The pair below
          keeps the hierarchy: walls carry, everything else recedes, on either
          ground. */}
      {layers.plan && (vector
        ? <g opacity={layers.dim ? 0.5 : 1}>
            {/* --- THE DRAWING'S OWN GROUND, AND ITS SIZE IS KNOWN EXACTLY ---
                A DXF in night mode had no ground at all. A raster gets one for
                free — the bitmap is opaque, and in day mode there is a white
                paper card behind it (App.jsx) — but a vector plan is a handful
                of stroked paths with nothing between them, so the page showed
                through: 24px graph paper crossing every room, which reads as
                part of somebody's drawing rather than as the wallpaper it is.

                AND THE EXTENT IS NOT A GUESS. The source carries `w`/`h` —
                derived from the DXF's own bbox in planSource.js — and this
                <svg> is `viewBox="0 0 width height"` with those very numbers in
                it. So `0,0,width,height` IS the drawing's bounding box, in the
                same coordinate space, to the pixel. No measuring, no heuristic,
                and nothing to fall back to.

                NIGHT ONLY, because day already has the paper card and it does
                the job better: it carries the padding, the hairline and the
                shadow that make the sheet read as a sheet. A second opaque rect
                inside it would be invisible at best and would cover the card's
                own margin at worst. */}
            {layers.invert && <rect x="0" y="0" width={width} height={height} fill="#000" />}
            <g fill="none" stroke={layers.invert ? '#8C8C8C' : '#9E9E9E'}
              strokeWidth={lw * 1.5} opacity="0.6">
              {vector.filter((l) => !wallLayers?.has(l.layer))
                     .map((l) => <path key={l.layer} d={l.path} />)}
            </g>
            {/* --- THE WALLS CARRY THE DRAWING, SO THEY ARE DRAWN LIKE IT ----
                These two weights were 1.1 and 1.6 — a 45% difference, which is
                not enough to read as a hierarchy at all, and both of them thin
                enough that a DXF under a finished layout looked like a faint
                sketch the fittings were floating over. The walls are what makes
                a plan legible as rooms, so they get more than double the
                secondary weight (1.5 against 3.2) and close to full opacity.
                STILL LIGHTER THAN THE FITTINGS. `lw` is the sheet's own line
                weight and the fittings are drawn in multiples of it too, so this
                stays proportional at every zoom and on every drawing size —
                the plan gets heavier without becoming the subject. */}
            <g fill="none" stroke={layers.invert ? '#D9D9D9' : '#3A3A3A'}
              strokeWidth={lw * 3.2} opacity="0.95" strokeLinecap="round"
              strokeLinejoin="round">
              {vector.filter((l) => wallLayers?.has(l.layer))
                     .map((l) => <path key={l.layer} d={l.path} />)}
            </g>
            {vector.flatMap((l) => l.circles.map((c, k) => (
              <circle key={l.layer + k} cx={c.cx} cy={c.cy} r={c.r}
                fill="none" stroke={layers.invert ? '#8C8C8C' : '#9E9E9E'}
                strokeWidth={lw * 1.4} opacity="0.6" />
            )))}
          </g>
        /* NO FILTER ON THIS ELEMENT. The bitmap handed down as `src` is
           ALREADY inverted when dark mode is on — App.jsx subtracts every
           channel from 255 once, because a CSS filter only reaches whichever
           element happens to be painting the plan and this app paints it two
           ways. A filter here as well would invert it straight back.
           `data-src-as-scanned` CARRIES THE ORIGINAL, so an export can be
           either polarity without this component re-rendering: `svgString` swaps
           the one attribute on its clone. It used to always put the scan back —
           now the PNG and PDF exports follow the view and the thumbnail does
           not, which is a decision that belongs to them and not here. See
           `asScanned` in exporters.js. The fade is handled upstream too — an
           inverted plan is passed `dim: false`. */
        : <image href={src} x="0" y="0" width={width} height={height}
            data-src-as-scanned={srcAsScanned || undefined}
            opacity={layers.dim ? 0.42 : 1} />
      )}

      {/* --- THE PLAN, PUT DOWN WHILE SOMETHING IS BEING AIMED AT A LINE -----
          A SCRIM OF THE GROUND'S OWN COLOUR, AND NOT OPACITY ON THE PLAN.
          Fading the plan element is the obvious way to do this and it is the
          wrong one: opacity makes a drawing SEE-THROUGH rather than quiet, and
          what is behind it here is the page — which carries this app's
          graph-paper wallpaper. The DXF branch above already paints a black
          sheet against exactly that hole. Paint is safe where transparency is
          not: this rect covers the plan with the colour the plan is sitting on,
          so the scan recedes and nothing else can appear.

          BOTH GROUNDS, FROM ONE RULE. On paper the ground is white and on the
          negative it is black, which is the whole of the mode difference — and
          it is the same `layers.invert` every other night decision on this
          canvas is taken from.

          HERE IN THE PAINT ORDER, WHICH IS THE POINT OF IT. Everything above
          this line is somebody else's drawing; everything below is ours — the
          cells, the outlines, the fittings, the guides. So the scan goes quiet
          and not one mark we make goes with it.

          HALF, RATHER THAN NEARLY ALL. The plan still has to be READABLE while
          a cove is aimed at it: you are looking for the wall of a particular
          room, and a sheet washed to a whisper would mean aiming at our polygon
          with no idea which room it is. Half is enough for a 2.4-weight outline
          to sit clearly on top of the scan's own wall lines. */}
      {wash && (
        <rect x="0" y="0" width={width} height={height}
          fill={layers.invert ? '#000000' : '#FFFFFF'} opacity="0.5"
          pointerEvents="none" />
      )}

      {/* Cells, grid and outline, room by room. All three under the lights, so
          no light is ever obscured by a grid line drawn after it. */}
      {laid.map((r, i) => (
        <g key={'g' + r.id}>
          {layers.cells && (
            <g clipPath={`url(#roomclip-${i})`}>
              {r.plan.cellsPx.map((c, k) => (
                <rect key={k} x={c.x0} y={c.y0} width={c.x1 - c.x0} height={c.y1 - c.y0}
                  fill={C.cell} opacity={(c.i + c.j) % 2 ? 0.05 : 0.015} />
              ))}
            </g>
          )}
          {/* THE GRID, WHEN AN OWNER ASKED FOR IT. Clipped to the room like
              the cells above it and under everything else in this group, so it
              can never obscure a fitting — the whole point of it is to be read
              UNDERNEATH the layout it produced. */}
          {showGrid && (
            <g clipPath={`url(#roomclip-${i})`}>{gridPath(r.plan)}</g>
          )}
          {layers.region && (
            <polygon points={points(r.plan.polygonPx)}
              fill="none" stroke={regionInk}
              /* The room the panel is talking about is drawn heavier. With eight
                 outlines on one sheet, "which one is Bedroom 2" is otherwise a
                 question the drawing cannot answer. */
              strokeWidth={lw * (r.id === focusId && laid.length > 1 ? 3.6 : 2.4)}
              strokeLinejoin="round" />
          )}
          {/* THE SELECTED SPACE, and this is a different thing from the layer
              above. That one is the OUTLINE — scaffolding, off by default,
              ink-coloured because it is part of the drawing. This is SELECTION:
              blue because blue is state on this canvas, thin because it is not
              competing with the fittings, and drawn whether or not the outline
              layer is on. Without it, turning the outline off left the canvas
              with no way at all to say which space the panel was describing.
              `strokeSelected` and not a fill: a wash over the space would sit
              between the plan and the fittings and dull both. */}
          {r.id === selectedId && (() => {
            // THE PERIMETER, IN THE DRAWING'S OWN PIXELS. The glint below is a
            // dash travelling once round the outline, and both the length of the
            // dash and the distance it has to cover are measured off the polygon
            // rather than guessed — an outline is L-shaped as often as not, and
            // a bounding box would send the glint round a rectangle the room
            // does not have.
            const poly = r.plan.polygonPx;
            let per = 0;
            for (let k = 0; k < poly.length; k++) {
              const a = poly[k], b = poly[(k + 1) % poly.length];
              per += Math.hypot(b.x - a.x, b.y - a.y);
            }
            const pts = points(poly);
            return (
              <g pointerEvents="none">
                {/* THE SELECTED SPACE, ON THE ACCENT RAMP.
                    A room outline is a big shape, so unlike the fittings' line
                    work it CAN hold a gradient: opposite sides of the room sample
                    opposite ends of the ramp and the outline grades round itself.
                    That is why this one takes a ramp at all where a two-pixel
                    fitting ring takes the single rim tone — and why the ramp
                    is `lp-sel-ramp` rather than `lp-lit`, which went invisible
                    here. See the note in the defs. */}
                <polygon points={pts} className="lp-sel" fill="none"
                  stroke="url(#lp-sel-ramp)" strokeWidth={lw * 1.6}
                  strokeLinejoin="round" />
                {/* --- THE GLINT ---------------------------------------------
                    A short bright arc that runs once round the outline in a
                    second and goes, the way a highlight travels across
                    something as it catches the light.

                    IT IS A TRAVELLING DASH, NOT A MOVING GRADIENT, and that is
                    a real constraint rather than a shortcut. SVG gradient
                    geometry — `x1`, `gradientTransform` — is not animatable
                    from CSS, so a ramp cannot be swept round a shape that way;
                    the portable trick is a dasharray of one short dash and a
                    gap the length of everything else, with `stroke-dashoffset`
                    animated through a full perimeter. What travels is the dash,
                    and it is painted in the ramp's brightest stop, so what you
                    see is the highlight moving over an outline that is already
                    the gradient.

                    KEYED ON THE ROOM, WHICH IS WHAT MAKES IT FIRE ON SELECT. A
                    CSS animation runs when its element MOUNTS, and this element
                    exists only while this room is the selected one — so picking
                    a room mounts it and it glints once. Picking a different room
                    unmounts this and mounts that one, which glints in turn. No
                    state, no timer, no effect: the thing the animation is about
                    is the thing that creates it. The key makes that explicit and
                    survives React reusing the node between two selected rooms.

                    The two lengths go in as custom properties for the same
                    reason the strips' widths do — they are measured in the
                    drawing's units, which a stylesheet cannot know. */}
                <polygon key={`glint-${r.id}`} points={pts} className="lp-glint"
                  fill="none" stroke={GLINT_STYLE.color}
                  strokeWidth={lw * GLINT_STYLE.weight}
                  strokeLinejoin="round" strokeLinecap="round"
                  /* THE TIMING IS HANDED TO CSS, NOT DUPLICATED IN IT. Same
                     idiom as the strips' breath a few hundred lines up: the
                     stylesheet owns the keyframes because that is the only place
                     that can own them, and every NUMBER comes from GLINT_STYLE
                     so there is one file to tune this from. The two lengths are
                     custom properties because they are measured in the drawing's
                     units, which a stylesheet cannot know. */
                  style={{
                    '--lp-per': `${per}px`,
                    '--lp-arc': `${per * GLINT_STYLE.arc}px`,
                    animationDuration: `${GLINT_STYLE.ms}ms`,
                    animationTimingFunction: GLINT_STYLE.ease,
                    animationIterationCount: GLINT_STYLE.laps,
                  }} />
              </g>
            );
          })()}

          {/* --- A CEILING THE COVE CARRIES ON ITS OWN --------------------
              WHY THIS MARK HAS TO EXIST. Every other lit ceiling on this sheet
              says so with throw pools — a circle of accent under each fitting.
              A chunk on rung 1 of the cove ladder has NO fittings: the strip in
              the pocket meets the brief by itself (see the ladder in cove.js),
              so the piece of ceiling that is most completely solved was the one
              piece drawn as though nothing had been decided about it. This fills
              that silence.

              THE SAME PAINT AND THE SAME OPACITY AS A THROW POOL, deliberately,
              because it is the same claim: this floor is lit. `THROW_STYLE`
              owns the number so the two cannot drift — change the pools' opacity
              and this follows.

              `lp-lit` AND NOT `lp-throw`. The pools are radial because a pool
              radiates from a lamp; this is a rectangle, and the radial ramp
              stretched into a rectangle puts a visible dark donut in the middle
              of it. That is recorded in the defs and it is the same reason the
              task surfaces use the flat ramp.

              THE WHOLE HOST CHUNK, NOT THE INNER RECTANGLE. The cove is what
              lights this piece of ceiling — all of it, the dropped band
              included — so the wash covers the piece, the way a room lit by a
              grid is covered by its pools. Filling only inside the cove line
              would draw a hole round the edge of a ceiling that has no hole in
              it.

              WHICH CHUNKS, AND IT IS NOT A `dark` FILTER. `dark` is stamped per
              PIECE (see ceilingDesign.js), and the ladder's middle rung sets it
              true on the band while the inner grid is lit — so filtering on
              `cove && dark` would wash the band of a half-lit cove and say
              something false. The question is about the RUNG, and the honest
              reading of it is: is the INNER piece dark? That is `stage ===
              'cove'`, which is rung 1, which is "the strip did it alone". Having
              found those design keys, every piece carrying one gets included.

              ONE RECT PER CHUNK, FROM THE UNION OF ITS PIECES — and that is the
              whole reason this is not a two-line filter. A cove chunk reaches
              here as five rectangles: the inner one and up to four band pieces
              that tile the ring round it. Filling them individually looks
              correct and is not: `lp-lit` is an objectBoundingBox ramp, so each
              piece would restart the gradient across its own width and the
              chunk would come out with four visible seams in it. One rect over
              the union carries one ramp. The pieces tile the host exactly, so
              the union of their bounds IS the host. */}
          {(() => {
            const chunks = r.plan.chunksPx ?? [];
            const lit = new Set(chunks
              .filter((ch) => ch.cove === 'inner' && ch.dark)
              .map((ch) => ch.design));
            if (!lit.size) return null;
            return [...lit].map((key) => {
              const parts = chunks.filter((ch) => ch.design === key);
              if (!parts.length) return null;
              const x0 = Math.min(...parts.map((c) => c.x0));
              const y0 = Math.min(...parts.map((c) => c.y0));
              const x1 = Math.max(...parts.map((c) => c.x1));
              const y1 = Math.max(...parts.map((c) => c.y1));
              return (
                <rect key={'cvfill' + key} x={x0} y={y0}
                  width={x1 - x0} height={y1 - y0}
                  fill="url(#lp-lit)" fillOpacity={THROW_STYLE.opacity}
                  pointerEvents="none" />
              );
            });
          })()}

          {/* THE COVE'S SETTING-OUT LINE.
              The visible edge of the dropped band: where the plaster stops and
              the higher ceiling begins. It is not the tape — that runs three
              inches behind it, in the pocket, and is drawn with the strip
              fittings further down — so it is drawn as what it is, a line
              somebody sets out to: the finest dotted line on the sheet, and
              NOT in the grid's grey, because a cove IS the lighting design for
              the space it is in — on a room where the cove carries the whole
              ambient load this rectangle and the wash inside it are the only
              marks the design left, and drawing either as scaffolding would say
              the opposite. What it is not any more is the fittings' own accent;
              see the note on the stroke below.
              Under the lights and over the grid, like every other room layer,
              and pointer-transparent because there is nothing here to grab —
              the cove follows the ceiling, and the ceiling is set in the panel. */}
          {(r.plan.covesPx ?? []).map((cv) => (
            <g key={cv.key}>
            <polygon points={points(cv.line)}
              /* AND IT IS THE WAY BACK — THE WHOLE OF WHAT IT ENCLOSES, not a
                 band along the line, and that is deliberate rather than
                 accidental. A chunk whose cove carries it on its own has NO
                 downlight left to click, so this rectangle is the only mark the
                 design left on that piece of ceiling and it has to be reliably
                 hittable. A band would not be: the tape runs three inches
                 outside this line, which at a normal zoom is a couple of pixels,
                 so a band round each would overlap and the tape — drawn later —
                 would take the click. `.hit` is `pointer-events: all`, which on
                 a `fill="none"` shape means the interior too, so clicking
                 anywhere on the coved ceiling opens its options.
                 THE COST IS ACCEPTED: a click inside a coved chunk opens the
                 pill instead of clearing the selection. A control that can be
                 reached beats a deselect that can be done an inch to the left.
                 THE TRACK PROFILE IS DELIBERATELY DIFFERENT — see below. It
                 keeps its heads, so it always has something better to click and
                 takes a band instead. */
              /* EXCEPT ROUND A COVE SOMEBODY DREW, WHICH HAS NO OPTIONS TO
                 OPEN. Its chunk offers one ceiling design and no other (see
                 optionsForChunk), so a pill on it would be a control that
                 cannot do anything; and the press means something else here —
                 it picks the shape up. That is handled in the shapes layer
                 further down, which is painted later and therefore takes the
                 press first. Leaving the pill wired as well would make a click
                 on the line do two things. */
              className={pickable && !cv.shapeId ? 'hit' : undefined}
              style={pickable && !cv.shapeId ? { cursor: 'pointer' } : undefined}
              onClick={pickable && !cv.shapeId
                ? (e) => { e.stopPropagation(); onPickChunk(r.id, cv.key); }
                : undefined}

              /* DOTTED, WHITE AND FINER — a setting-out line, drawn like one.
                 It was a 1.6-weight DASHED line in the fittings' accent, which
                 said the wrong thing twice over. A dash at that weight reads as
                 drawing; this is a mark somebody measures to, and the convention
                 for that everywhere is the finest dotted line on the sheet.
                 In the accent it also competed with the wash now filling the
                 ceiling it encloses — two warm marks, one inside the other,
                 neither winning.
                 DOTS AND NOT DASHES: `1 3` at round caps gives round dots with
                 air between them, where `5 4` gives ticks. `lw * 1` is the
                 sheet's own line weight, the thinnest thing drawn on it.
                 WHITE ONLY WHERE WHITE READS, and this follows the ceiling
                 objects rather than inventing a second answer — see the note by
                 `col` in the fansPx block. On the inverted plan the ground is
                 black and white is the mark that carries; on the plan as
                 scanned, white on white paper is nothing at all, so it takes the
                 ramp's rim tone instead. Ask for white in both and it disappears
                 in day mode.
                 THE HIT AREA IS UNAFFECTED. `.hit` is `pointer-events: all`,
                 which on a `fill="none"` closed path means its whole INTERIOR —
                 not its stroke — so thinning the line to dots does not shrink
                 the target. (`pointer-events: stroke` would have: it follows the
                 dashes, and on a dotted line that leaves you clicking dots.) */
              fill="none" stroke={layers.invert ? C.object : rim}
              strokeWidth={lw}
              strokeDasharray={`${lw} ${lw * 3}`} strokeLinecap="round"
              strokeLinejoin="round" opacity="0.85" />
            </g>
          ))}

          {/* --- THE TRACK PROFILE ------------------------------------------
              SOLID, AND THAT IS THE WHOLE IDIOM. Every concealed run on this
              sheet is dotted — the cove's setting-out line, a strip, a reverse
              cove — because a dotted line is how a drawing says "this is behind
              something". A track is the opposite: it is the one linear element
              you can see from the floor, a visible profile with visible heads
              clipped into it. So it is drawn solid, and the two marks cannot be
              confused at a glance.

              A BODY AND A CORE, because a profile has a WIDTH and at plan scale
              that width is a hairline. Drawing it as one thin line would make it
              read as a leader or a dimension; the pale wider stroke behind the
              core gives it the presence of an object without pretending to a
              dimension it is too small to show.

              IN THE FITTINGS' BLUE, like the cove line and for the same reason:
              on a chunk whose lights have all been absorbed, this is where every
              fitting in that piece of ceiling is, and drawing it in the grid's
              grey would file the lighting design under scaffolding.

              AND IT IS A WAY BACK. Same as the cove line — click the profile and
              that chunk's options open. Its own fittings are clickable too, but
              they sit ON it, so the profile is the larger and more obvious
              target for "what else could this ceiling be". */}
          {(r.plan.tracksPx ?? []).map((t, ti) => {
            const click = pickable && onPickChunk
              ? (e) => { e.stopPropagation(); onPickChunk(r.id, t.key); }
              : undefined;
            // --- THE RAIL IS OUTLINED NOW, NOT FILLED ------------------------
            //
            // It was a solid one-inch band of accent, which read as a filled
            // bar. A magnetic track is a black extrusion with a lit slot in it,
            // so it is drawn the way it looks: BLACK THROUGH THE MIDDLE, with
            // the accent as an edge round it.
            //
            // TWO STROKES ON THE SAME PATH, NOT A FILLED OUTLINE. The profile is
            // a centreline plus a width — there is no closed shape here to give
            // a fill and a stroke to, and offsetting a mitred polyline by half
            // an inch to build one is a geometry problem nobody needs to solve
            // on every render. A wide stroke with a narrower stroke painted on
            // top of it produces exactly the same picture: the wide one survives
            // only as a rim, which IS the outline.
            //
            // The core is `w - trackEdge * 2` so the rim is `trackEdge` on each
            // side and the OUTSIDE dimension stays a true inch — the drawing can
            // still be scaled off it, which was the whole reason this one element
            // is drawn to size (see `inch`).
            //
            // THE EDGE IS A GRADIENT ALONG THE RUN, like the strips, because a
            // rail is the same kind of object: a length of product with the
            // light graduating down it. Same userSpaceOnUse reasoning as the
            // strips too — see the note by `gline` — and here the endpoints come
            // from the extent of every run in the arrangement, so a closed track
            // grades across its whole rectangle instead of each side restarting.
            const railPts = t.closed
              ? t.runs.map((rn) => rn.a)
              : t.runs.flatMap((rn) => [rn.a, rn.b]);
            const rgid = `lp-rail-${i}-${ti}`;
            const rgrad = {
              x1: Math.min(...railPts.map((q) => q.x)),
              y1: Math.min(...railPts.map((q) => q.y)),
              x2: Math.max(...railPts.map((q) => q.x)),
              y2: Math.max(...railPts.map((q) => q.y)),
            };
            // ONE INCH, WHICH IS THE PROFILE ITSELF AND NOT A LINE STANDING FOR
            // IT. See `inch` at the top of this file for why this one element is
            // drawn to size. What it buys is the whole drawing: the heads are an
            // inch wide too, so they seat INSIDE the run as white modules in a
            // dark carrier — which is what a track looks like on a ceiling, and
            // what no pair of hairlines could say.
            /* THE ONE STROKE ON THIS SHEET THAT STILL SCALES WITH THE ZOOM,
               and every element drawn from `w`, `core` or `grab` below carries
               `.real-width` to say so. A CLASS AND NOT A `vector-effect`
               ATTRIBUTE: the attribute loses to the stylesheet's own rule, which
               is how this first shipped doing nothing at all. See styles.css.
               Everything else here is a LINE WEIGHT — a convention about how
               heavy a mark reads — and the stylesheet now holds all of it at a
               constant screen width. This is not a line weight. It is the track
               extrusion's actual profile, one true inch of aluminium, and the
               heads seat inside it as white modules at their own real width. Pin
               it to the screen and it stops being a dimension: at 8x the rail
               would be a hairline with inch-wide heads sitting outside it. */
            const w = inch(TRACK_DIMS_IN.profile);
            // The black core, inset by one edge weight on each side. Clamped so
            // a very small plan cannot invert it into a negative stroke width —
            // at which point the rail would vanish and take the drawing's only
            // mark for that chunk with it.
            const core = Math.max(w - lw * 1.5 * 2, w * 0.25);
            // A CLICK TARGET WIDER THAN THE THING. An inch is an inch, and on a
            // large plan that is a few pixels of pointer — too fine to hit,
            // where the pill it opens is the main way anybody changes a ceiling.
            // Invisible, so the drawing is unaffected.
            const grab = Math.max(w * 3, HIT_BAND);
            const hit = pickable ? 'hit' : undefined;
            /* THE HIT BAND SCALES WITH THE RAIL IT GUARDS. It is `w * 3`, so
               pinning it to the screen while the rail grew would leave a pointer
               target narrower than the visible track at high zoom — the one
               place where a stroke that is not drawn still has to be a real
               dimension. Both classes, because it is also the click target. */
            const railHit = [hit, 'real-width'].filter(Boolean).join(' ');
            // `pointerEvents: 'stroke'` AND NOT THE `.hit` DEFAULT OF `all`.
            // The closed arrangement is a closed path, and `all` would make it
            // live over the whole rectangle it encloses — the same fault the
            // cove strip had. See `bandStyle`.
            const cur = pickable ? bandStyle : undefined;
            // A CLOSED TRACK IS ONE PATH, NOT FOUR LINES. Mitred corners are the
            // difference between a rectangle and four strokes that overlap at
            // the ends, and at a real width the overlap shows — as a lump at
            // each corner where the drawing should show a corner piece.
            if (t.closed) {
              const d = `M${t.runs.map((rn) => `${rn.a.x},${rn.a.y}`).join(' L')} Z`;
              return (
                <g key={'trk' + t.key}>
                  <defs>
                    <linearGradient id={rgid} gradientUnits="userSpaceOnUse" {...rgrad}>
                      {RAMP.stops.map((st) => (
                        <stop key={st.at} offset={st.at} stopColor={st.color} />
                      ))}
                    </linearGradient>
                  </defs>
                  <path d={d} fill="none" stroke={`url(#${rgid})`} strokeWidth={w}
                    className="real-width" strokeLinejoin="miter" pointerEvents="none" />
                  <path d={d} fill="none" stroke={C.ink} strokeWidth={core}
                    className="real-width" strokeLinejoin="miter" pointerEvents="none" />
                  <path className={railHit} style={cur} onClick={click} d={d}
                    fill="none" stroke="transparent" strokeWidth={grab} />
                </g>
              );
            }
            return (
              <g key={'trk' + t.key}>
                <defs>
                  <linearGradient id={rgid} gradientUnits="userSpaceOnUse" {...rgrad}>
                    {RAMP.stops.map((st) => (
                      <stop key={st.at} offset={st.at} stopColor={st.color} />
                    ))}
                  </linearGradient>
                </defs>
                {t.runs.map((rn, k) => (
                  <g key={k}>
                    {/* BUTT ENDS, AND NO END-CAP TICK. A hairline needed a tick
                        to say it was a cut length rather than a line running off
                        the sheet; a one-inch run has a visible squared end of
                        its own, and a tick on top of it would be drawing an end
                        cap that is not a separate item. */}
                    <line x1={rn.a.x} y1={rn.a.y} x2={rn.b.x} y2={rn.b.y}
                      stroke={`url(#${rgid})`} strokeWidth={w} strokeLinecap="butt"
                      className="real-width" pointerEvents="none" />
                    <line x1={rn.a.x} y1={rn.a.y} x2={rn.b.x} y2={rn.b.y}
                      stroke={C.ink} strokeWidth={core} strokeLinecap="butt"
                      className="real-width" pointerEvents="none" />
                    <line className={railHit} style={cur} onClick={click}
                      x1={rn.a.x} y1={rn.a.y} x2={rn.b.x} y2={rn.b.y}
                      stroke="transparent" strokeWidth={grab} strokeLinecap="butt" />
                  </g>
                ))}
              </g>
            );
          })}
        </g>
      ))}

      {layers.zones && (
        <g>
          {zones.map((z) => (
            <rect key={z.id} x={z.x0} y={z.y0} width={z.x1 - z.x0} height={z.y1 - z.y0}
              fill="url(#nlz)" stroke={zoneInk} strokeWidth={lw * 1.8}
              strokeDasharray={`${lw * 5} ${lw * 3.5}`} opacity="0.9" />
          ))}
          {draftZone && (
            <rect x={Math.min(draftZone.x0, draftZone.x1)} y={Math.min(draftZone.y0, draftZone.y1)}
              width={Math.abs(draftZone.x1 - draftZone.x0)} height={Math.abs(draftZone.y1 - draftZone.y0)}
              fill={zoneInk} fillOpacity="0.12" stroke={zoneInk} strokeWidth={lw * 2} />
          )}
        </g>
      )}

      {/* --- what the render pass found on the walls -------------------------
          AN ADMIN OVERLAY, AND NOT A LAYER ANY MORE. There is no `layers` check
          here because the caller does the gating: App.jsx passes an empty list
          unless the viewer is an owner with "Show what was identified" ticked.
          A `layers.wallitems &&` in front of this would be a second switch on a
          thing with one, and the one that is not in the View list is the one
          somebody would eventually wire a checkbox to.

          WHY IT LEFT THE VIEW LIST. It is a READING, not a fitting. Shading the
          cells is how you check the model put the panelling on the wall you
          meant, which is exactly the question the bed boxes and the task
          surfaces answer and exactly why those two are behind the same switch.
          On a finished sheet it is a coloured band along a wall beside the cove
          it produced — two marks where the drawing needs one. The CONSEQUENCES
          stay for everybody: the reverse cove, the shelf strip, the art spots.

          UNDER THE FITTINGS AND OVER THE PLAN, like every other reading, and
          quiet enough that a strip drawn along the same wall reads as the louder
          of the two. Hence a wash plus a hairline, in the element's own muted
          colour, and no blue anywhere near it — blue on this canvas means
          "ours, and it emits light".

          ONE RECT FOR THE RUN, AND TICKS BETWEEN THE CELLS. Eleven abutting
          squares each with their own outline read as eleven separate things;
          one rectangle with the cell divisions ticked inside it reads as what
          it is — an eleven-foot run, measured. */}
      {wallCells.map((wc) => (
        <g key={wc.id} pointerEvents="none">
          <rect x={wc.rect.x0} y={wc.rect.y0}
            width={wc.rect.x1 - wc.rect.x0} height={wc.rect.y1 - wc.rect.y0}
            fill={wc.colour} fillOpacity="0.22"
            stroke={wc.colour} strokeWidth={lw * 1.6} strokeOpacity="0.9" />
          <g stroke={wc.colour} strokeWidth={lw} strokeOpacity="0.45">
            {wc.rects.slice(1).map((c, k) => (
              wc.horizontal
                ? <line key={k} x1={c.x0} y1={c.y0} x2={c.x0} y2={c.y1} />
                : <line key={k} x1={c.x0} y1={c.y0} x2={c.x1} y2={c.y0} />
            ))}
          </g>
        </g>
      ))}

      {/* --- WHAT EACH FITTING COVERS ---------------------------------------
          A circle of accent at a tenth opacity under every lamp the catalogue
          gives a wattage this app has a pool for: 5 ft at 5 W, 6 ft at 7 W,
          10 ft at 12 W. See THROW_STYLE in settings.js for those diameters, the
          beam-angle trigonometry they come from and the 9 ft ceiling they
          assume; `poolFtFor` at the head of this file for how a fitting is
          matched to one, and why it is matched on WATTAGE rather than on a list
          of ids.

          THE THREE SIZES ARE NOT DECORATION. A 12 W 60-degree downlight covers
          nearly three times the floor of a 7 W 36-degree one, and drawing them
          the same size was the layer saying every lamp does the same work. The
          reason to have this on the sheet at all is to see where the coverage
          doubles up and where it runs out, and it could not say either while
          one circle stood for every fitting.

          A SEPARATE PASS, AHEAD OF THE FITTINGS, and not a shape inside each
          fitting's own group. Two reasons, and they are the same reason twice:
            - EVERY POOL IS UNDER EVERY SYMBOL. Drawn inside the loop, light
              L7's pool would be painted over L6's mark, because SVG has no
              z-index and paints in document order. Forty fittings would each
              have their neighbour's wash sitting on top of them.
            - ONE CLIP FOR THE WHOLE ROOM. The clip belongs to the room, so it
              is set once on one group here rather than restated on forty
              circles.

          THE WALLS CUT IT — `roomclip-<i>` is this room's traced outline, the
          same path the cells and the grid are clipped to, and it is the walls.
          A pool spilling through a partition into the next room is not a
          drawing error to be tidied later, it is a false statement: it says a
          lamp lights floor it cannot reach. Every one of these diameters is
          wider than the setback of a fitting near a wall — a 12 W pool is ten
          feet across — so this happens on most plans rather than rarely. `laid` is indexed here because the clip ids are — see the note
          at the top of this file about what a reused clip id does.

          INERT. `pointerEvents="none"` on the group, for the same reason the
          glow inside each fitting carries it: six feet of live surface would
          have one downlight swallowing every click meant for its neighbours,
          and this mark is not something you can grab. */}
      {(layers.lights || layers.spots) && laid.map((r, ri) => {
        const pools = [];
        // THE GRID AND THE TRACK HEADS — 7 W ambient, 12 W over a pair of
        // cells, 5 W narrow in a wet room. A ceiling light points straight
        // down, so its pool is centred on the fitting.
        if (layers.lights) {
          for (const l of r.plan.lightsPx) {
            const ft = poolFtFor(l.fixture || l.kind);
            if (ft) pools.push({ k: l.id, x: l.x, y: l.y, ft });
          }
        }
        // THE AIMED SPOTS, AND THEIR POOL IS NOT UNDER THE FITTING.
        //
        // This is the one place the two kinds of light genuinely differ and it
        // would have been easy to get wrong. A downlight lights the floor
        // beneath it; a directional spot stands off and lights something ELSE —
        // that is the whole reason it has an arrow. Drawing its pool under its
        // own body would put the light two or three feet from where the arrow
        // says it lands, and would contradict the only annotation the fitting
        // has. So the pool goes on `target`, which is the aim point the placer
        // already worked out and the same point the arrow is drawn towards.
        //
        // `sp.x == null` GUARDS A REAL SHAPE, not a hypothetical: a surface the
        // placer refused still produces an entry — carrying `rejected` or
        // `skipped` and no geometry at all — so that the panel can say why.
        // Those have no position to draw a pool at.
        //
        // BEHIND `layers.spots`, not `layers.lights`, because the fitting it
        // belongs to is. A pool with no fitting over it is a stain.
        if (layers.spots) {
          for (const sp of taskSpots) {
            if (sp.rejected || sp.roomId !== r.id || sp.x == null) continue;
            const ft = poolFtFor(sp.fixture || 'spot');
            if (!ft) continue;
            const c = sp.target ?? { x: sp.x, y: sp.y };
            pools.push({ k: sp.id, x: c.x, y: c.y, ft });
          }
        }
        if (!pools.length) return null;
        return (
          <g key={'throw' + r.id} clipPath={`url(#roomclip-${ri})`}
            pointerEvents="none">
            {/* OPACITY PER CIRCLE, NOT ON THE GROUP, and they are not the same
                picture. Group opacity composites the whole layer ONCE, so two
                overlapping pools look exactly like one — which throws away the
                most useful thing this layer says, that these two lamps double
                up here and that corner has nothing. Per circle, an overlap
                reads darker. */}
            {pools.map((p) => (
              <circle key={p.k} cx={p.x} cy={p.y} r={(p.ft / 2) * s}
                fill="url(#lp-throw)" opacity={THROW_STYLE.opacity} />
            ))}
          </g>
        );
      })}

      {/* --- THE LOOPING -----------------------------------------------------
          Every flow's wire, board first. See flows.js for what a flow is; this
          only draws it.

          UNDER THE FITTINGS AND OVER THE POOLS, which is the one place it can
          go. Over the fittings and forty arcs cross forty symbols — the symbols
          being the entire subject of the sheet. Under the pools and the wire
          disappears wherever two lights overlap, which on a real layout is
          most of it.

          DOTTED AND BOWED, AND THE BOW IS WHAT DOES THE WORK. A straight line
          between two downlights is a setting-out line, a grid line, a dimension
          or a wall — this drawing has all four — and no amount of dash pattern
          separates it from them. A shallow arc is not any of those things. That
          is why AutoCAD draws a loop this way and it is the whole reason the
          geometry in flows.js is arcs rather than segments.

          IN THE SWITCHBOARD'S OWN BLUE. The wire and the plate are one object:
          the line means "these fittings come on from that board", and it says
          so by being drawn in the board's colour. It is also the one hue on
          this canvas that is not a light — the fittings are amber — so the
          layer reads as a different KIND of information at a glance rather
          than as more of the same.

          THE FEED LEG IS BLUE AND THE REST OF THE CHAIN IS GREY, and thinner.
          One loop is not one uniform statement: the first leg answers "which
          plate switches this", which is the whole question the layer exists to
          answer and the thing a reader traces across the sheet; every leg after
          it says "and on to the next lamp in this row", which the row already
          said by being a row. Drawn all in blue at one weight, a bay with three
          rows of six was a thicket, and the three short lines that actually
          carry the information were lost in it. See WIRE_CHAIN in flows.js.

          NOT INERT ANY MORE, AND THAT REVERSED AN EARLIER DECISION. The note
          here used to read "there is nothing to grab on a wire" — which was
          true while a wire was purely derived. It is not now: the plate a loop
          runs off can be dragged onto another plate, and a leg that crosses
          something somebody wants visible can be nudged off it. The group is
          still `pointerEvents="none"`; what is live is the fattened hit path,
          exactly as before, plus the grips on the picked loop. */}
      {layers.electrical && (
        <g pointerEvents="none" fill="none" stroke={SB_COLOUR}>
          {flows.filter((f) => !f.coincident).map((f) => {
            const picked = f.id === selFlowId;
            /* THE LEGS, OR THE WHOLE PATH AS ONE LEG. A flow from a caller that
               predates `legs` — or one built by hand in a test — still has a
               `path`, and drawing nothing for it would be a wire that vanished
               because a field was added. */
            const legs = f.legs?.length
              ? f.legs
              : (f.path ? [{ key: '0', d: f.path, feed: true }] : []);
            const alsoLegs = f.also
              ? (f.also.legs?.length ? f.also.legs
                : (f.also.path ? [{ key: 'a0', d: f.also.path, feed: true }] : []))
              : [];
            /* ONE DESCRIPTION OF A LEG'S PAINT, used for the loop and for the
               second feed alike. `picked` brightens rather than recolours: a
               selected wire that changed hue would stop reading as the same
               object it was a moment ago, and the grey legs have to stay
               visibly the chain even while they are lit. */
            const leg = (l) => {
              const feed = l.feed;
              return {
                key: l.key,
                d: l.d,
                /* GREEN WHEN IT IS THE PICKED ONE, AND NOT A HEAVIER BLUE. The
                   weight still doubles — feed and chain keep telling each other
                   apart — but weight alone cannot carry selection in a thicket
                   of four loops crossing one ceiling: "thicker than the others"
                   is findable only by comparing it with the others. See
                   WIRE_PICKED in flows.js for why green in particular. */
                stroke: picked ? WIRE_PICKED : feed ? SB_COLOUR : WIRE_CHAIN,
                width: (feed ? lw * 1.5 : lw * 0.95) * (picked ? 1.6 : 1),
                dash: feed ? `${lw * 1.5} ${lw * 3.2}` : `${lw * 1.2} ${lw * 2.4}`,
                halo: feed ? lw * 3.4 : lw * 2.4,
              };
            };
            const painted = [...legs, ...alsoLegs].map(leg);

            return (
            <g key={f.id}>
              {/* A WHITE UNDERLAY, one weight heavier. The wire crosses the
                  scan, the cell lines, the chunk boxes and the room outline,
                  and a 1.2px dotted blue over somebody's hatched wall is not a
                  line, it is a texture. The halo is what makes it one.
                  ALL THE HALOES FIRST AND THEN ALL THE WIRES, which matters now
                  that a loop is several strokes: painted leg by leg, the halo of
                  leg two would be laid over the wire of leg one and would eat a
                  bite out of it at every joint. */}
              {painted.map((l) => (
                <path key={`h${l.key}`} d={l.d} stroke="#fff" strokeWidth={l.halo}
                  strokeLinecap="round" opacity={layers.invert ? 0.55 : 0.9} />
              ))}
              {/* THE SECOND PLACE THE SAME SWITCH IS REACHED FROM — the fan's
                  point on the far bedside plate — is in this list too, and it is
                  a FEED, so it is blue at feed weight. That is the same wire
                  doing the same job: a lighter one would read as a lesser
                  connection, and it is not one. What tells them apart is that
                  the loop has two feed ticks and the card says so. */}
              {painted.map((l) => (
                <path key={l.key} d={l.d} stroke={l.stroke} strokeWidth={l.width}
                  strokeLinecap="round" strokeDasharray={l.dash}
                  opacity={picked ? 1 : undefined} />
              ))}
              {/* THE FEED, at the board end: one short tick across the wire
                  where it leaves the plate. Not an arrow — a wire has no
                  direction, and an arrowhead would claim one. It is there
                  because a loop's first leg is its longest and a reader has to
                  be able to find which of several plates it came off. */}
              {[f.from && f.nodes[0] ? [f.from, f.nodes[0]] : null,
                f.also ? [f.also.from, f.nodes.reduce((a, b) => (
                  Math.hypot(b.x - f.also.from.x, b.y - f.also.from.y)
                  < Math.hypot(a.x - f.also.from.x, a.y - f.also.from.y) ? b : a))] : null]
                .filter(Boolean).map(([a, b], i) => {
                  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
                  const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
                  const t = lw * 3.2;
                  const q = { x: a.x + ux * t * 1.6, y: a.y + uy * t * 1.6 };
                  return (
                    <line key={i} x1={q.x - uy * t} y1={q.y + ux * t}
                      x2={q.x + uy * t} y2={q.y - ux * t}
                      stroke={picked ? WIRE_PICKED : SB_COLOUR}
                      strokeWidth={lw * 1.5} strokeLinecap="round" />
                  );
                })}
              {/* WHICH FLOW THIS IS, once per loop, at its first fitting — and
                  only with the tags on. `layers.labels` is the switch for "name
                  everything on this drawing"; a flow's name is exactly that
                  kind of mark, and a sheet with forty loops and forty captions
                  is unreadable whatever the captions say. */}
              {layers.labels && f.nodes[0] && (
                <text x={f.nodes[0].x} y={f.nodes[0].y - s * 0.42}
                  textAnchor="middle" fontSize={s * 0.34} stroke="none"
                  fill={SB_COLOUR} fontFamily="The Neue Montreal, sans-serif"
                  paintOrder="stroke" strokeWidth={lw * 3} style={{ stroke: '#fff' }}>
                  {f.label}
                </text>
              )}
              {/* THE HIT TARGET IS THE WIRE, FATTENED — a stroked-only copy
                  wide enough to hover without being wide enough to cover a
                  neighbouring fitting. Live even though the group is not: the
                  card is the only way to read what a loop actually switches. */}
              <path className="hit" d={f.path + (f.also ? ` ${f.also.path}` : '')}
                stroke="transparent"
                strokeWidth={lw * 7} strokeLinecap="round"
                {...feel(f.id, {
                  id: 'flow', label: f.label,
                  note: f.what || null,
                  rows: [
                    ['Fittings', String(f.count)],
                    /* WHAT IS CLIPPED INTO THE RAIL, and how much of it aims.
                       A magnetic profile is fed once and everything on it is
                       live from that feed — `Fittings` above is therefore 1 for
                       a track flow however many modules it carries, which is
                       correct and reads as wrong without this line. The
                       directional count is the half people go looking for:
                       those heads have no wire of their own, and somebody
                       counting arcs on the drawing needs to be told where they
                       went. See section 1 of flows.js. */
                    ...(f.absorbed ? [['On the profile',
                      f.heads ? `${f.absorbed} — ${f.heads} directional`
                        : String(f.absorbed)]] : []),
                    ['Switched from', f.boardLabel ? `the ${f.boardLabel.toLowerCase()} board`
                      : 'nowhere yet'],
                    ...(f.also ? [['...and from', `the ${f.also.boardLabel.toLowerCase()} board`
                      + ' — two-way']] : []),
                    /* WHOSE DECISION THE PLATE IS. A wire dragged onto another
                       board is the one thing about a loop that is not derived,
                       and a card that did not say so would be presenting
                       somebody's override as the rules' answer. */
                    ...(f.assigned ? [['Note', 'moved onto this board by hand']] : []),
                  ],
                })}
                /* AND THE SAME PATH IS WHAT PICKS THE LOOP. Pointerdown rather
                   than click, like every other selectable thing here, and it
                   stops propagating for the reason at the top of this file: the
                   root svg's handler selects a space or clears the selection,
                   and a press that did both would deselect the wire it had just
                   picked. */
                onPointerDown={placing || !onFlowPointerDown ? undefined
                  : (e) => { e.stopPropagation(); onFlowPointerDown(e, f.id); }}
                /* `INERT.style` WHILE SOMETHING IS BEING PLACED, exactly as the
                   plate does. `feel` already returns it, and this attribute is
                   spread after `feel` — so writing a cursor here unconditionally
                   would put the pointer events back on a wire that is meant to
                   be out of the way. */
                /* `pointerEvents` IN THE STYLE AND NOT AS AN ATTRIBUTE, which
                   is the same correction the accent runs carry — see the note
                   over `.plan .hit` in styles.css. That rule declares
                   `pointer-events:all`, and a CSS declaration beats a
                   presentation attribute, so the `pointerEvents="stroke"`
                   written here did nothing: `all` makes a path's INTERIOR live
                   as well as its perimeter, so the target was not the fat band
                   along the wire this comment claims, it was the whole region a
                   loop encloses. Tolerable while a wire was only hoverable and
                   not while it can be SELECTED — a press anywhere inside a row
                   of six downlights would have picked the wire. */
                style={placing ? INERT.style
                  : { cursor: 'pointer', pointerEvents: 'stroke' }} />

            </g>
            );
          })}
        </g>
      )}

      {/* The lights. Tags are prefixed with the room once there is more than
          one, because L1 in the kitchen and L1 in the hall are two fittings and
          a schedule that calls them both L1 is a schedule nobody can order
          from. */}
      {layers.lights && laid.map((r) => (
        <g key={'l' + r.id}>
          {r.plan.lightsPx.map((l0, li) => {
            /* --- THE ONE IN FLIGHT, DRAWN WHERE THE POINTER HAS IT -----------
               A light's position is INSIDE the layout, and the layout is a
               solver — so a drag cannot commit per frame and the store is still
               saying where this fitting was when the press landed. For the
               length of the gesture this substitution is the only thing that
               knows better. Everything below draws `l` and does not care which
               of the two it got.
               THE POOL AND THE RING TRAVEL WITH IT, because they are computed
               from `l.x/l.y` a few lines down. That is the whole reason this is
               a substitution at the top rather than a transform on the symbol:
               a fitting whose glow stayed behind would read as two lights. */
            const l = (movingLight && movingLight.roomId === r.id
                       && movingLight.cellKey === l0.cellKey)
              ? { ...l0, x: movingLight.at.x, y: movingLight.at.y }
              : l0;
            // THE SYMBOL IS SIZED BY THE PRODUCT, NOT BY THE GEOMETRY. A
            // toilet's grid light is the same `kind: 'small'` as a bedroom's —
            // one per cell — but it is a 5 W 30-degree lamp rather than a 7 W
            // 36-degree one, and a drawing on which two different fittings are
            // the same circle is a drawing the person ordering them cannot use.
            // 20% smaller, which is enough to read as deliberate next to a
            // standard downlight and not so much that it reads as a spot.
            const fx = l.fixture || l.kind;
            const R = (l.kind === 'large' ? 0.52 : 0.3)
              * (fx === 'small-narrow' ? 0.8 : 1) * s;
            // `const col = l.kind === 'large' ? C.large : C.small` WAS HERE, and
            // it is gone because nothing in this block wants a hue any more.
            // Every mark on a light — recessed or seated in a track, ambient or
            // aimed — is now cut from the accent ramp: the body takes `lp-core`
            // and the line work takes rim. `C.large` and `C.small` were the
            // same value as each other anyway, which is a good sign the fill was
            // never carrying the distinction it looked like it was carrying.
            const warm = hot === l.id;

            // --- A HEAD SEATED IN A TRACK -------------------------------------
            //
            // NOT A CIRCLE, BECAUSE IT IS NOT A DOWNLIGHT. A recessed downlight
            // is a round cut-out and its symbol is a circle; a track head is a
            // 300 x 38 mm module that slides along a profile, and drawn as a
            // circle it would say the wrong thing twice — the wrong shape, and
            // the wrong length along the run, which is the dimension that
            // decides how many heads a run can carry AND the one the layout
            // itself depends on. See TRACK_DIMS_IN, which is where all five of
            // these figures live and which says which of them move a fitting.
            //
            // WHITE IN THE RUN. The profile under it is solid ink an inch wide,
            // so a white module with a blue edge reads as a lamp seated in a
            // dark carrier — the way the product actually looks from below, and
            // the way the two marks tell each other apart at a glance.
            //
            // ALONG THE RUN, which is what `trackAxis` is for: the same module
            // is eight inches wide on a run across the room and eight inches
            // tall on one down it. Nothing else on this sheet has an
            // orientation it did not choose for itself.
            if (l.track) {
              const along = inch(TRACK_DIMS_IN.head.len);
              const across = inch(TRACK_DIMS_IN.head.wide);
              const horiz = l.trackAxis !== 'v';
              const rw = horiz ? along : across;
              const rh = horiz ? across : along;
              // THE POOL, STRETCHED THE WAY THE FITTING IS. A round glow under a
              // linear source is the one thing that would give the game away —
              // an eight-inch lamp throws an eight-inch pool, and the radial
              // gradient scaled into an ellipse says exactly that.
              const gw = rw / 2 + inch(3), gh = rh / 2 + inch(3);
              // The click target, again wider than the mark. Same argument as
              // the profile's: an inch of pointer is not a target.
              const px = Math.max(rw / 2, lw * 5), py = Math.max(rh / 2, lw * 5);
              return (
                <g key={l.id} {...feel(l.id, specsFor(fx))}>
                  <ellipse cx={l.x} cy={l.y} rx={gw} ry={gh} fill="url(#lp-glow)"
                    className="lp-pulse" pointerEvents="none"
                    style={{ animationDelay: `${((li * 137) % 1000) / 1000 * -2.8}s` }} />
                  <rect className="hit" x={l.x - px} y={l.y - py}
                    width={px * 2} height={py * 2} fill="transparent"
                    onClick={pickable && l.design
                      ? (e) => { e.stopPropagation(); onPickChunk(r.id, l.design); }
                      : undefined} />
                  <rect x={l.x - rw / 2} y={l.y - rh / 2} width={rw} height={rh}
                    fill="url(#lp-core)" stroke={rim} strokeWidth={lw * (warm ? 2.6 : 1.5)}
                    pointerEvents="none" />
                  {layers.labels && l.gridPx && (
                    <g opacity="0.45" pointerEvents="none">
                      <line x1={l.gridPx.x} y1={l.gridPx.y} x2={l.x} y2={l.y}
                        stroke={rim} strokeWidth={lw}
                        strokeDasharray={`${lw * 2} ${lw * 2}`} />
                      <circle cx={l.gridPx.x} cy={l.gridPx.y} r={lw * 1.4}
                        fill="none" stroke={rim} strokeWidth={lw} />
                    </g>
                  )}
                  {layers.labels && (
                    <text x={l.x + rw / 2 + lw * 2.5} y={l.y - rh / 2 - lw * 2}
                      fontSize={s * 0.5} fontFamily="The Neue Montreal, sans-serif"
                      fill={rim} opacity="0.75">
                      {laid.length > 1 && r.name ? `${r.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 4)}-` : ''}{l.id}
                    </text>
                  )}
                </g>
              );
            }

            return (
              <g key={l.id} {...feel(l.id, specsFor(fx))}>
                {/* --- HOW FAR THIS ONE MAY GO ------------------------------
                    `centreBand` DRAWN. A small light may sit anywhere within
                    ±20% of its own cell, and until now that was a number in a
                    config object: the layout spent the freedom and nobody could
                    see there had been any. As a rectangle under the fitting you
                    are holding it is a rule with an edge you can watch the light
                    stop against — which is why the drag needs no message saying
                    it has hit the limit, and why the limit needs no explaining
                    before you reach it.

                    A FRACTION OF THE CELL AND NOT A FIXED DISTANCE, so this box
                    is a different size on a 5 ft cell and a 9 ft one. That is
                    worth being able to see too: it is the honest picture of a
                    grid where the cells are not all the same.

                    ONLY ON THE ONE BEING TOUCHED. Forty of these on a finished
                    sheet would be a drawing about the tolerance rather than
                    about the lighting.

                    THE TICK IS WHERE THE RULE PUT IT — the cell's own centre —
                    so the offset can be read off the drawing rather than taken
                    on trust, and so there is something to aim at when putting a
                    light back by hand. */}
                {l.bandPx && (selLightId === `${r.id}|${l.cellKey}`) && (
                  <g pointerEvents="none">
                    <rect x={l.bandPx.x0} y={l.bandPx.y0}
                      width={l.bandPx.x1 - l.bandPx.x0}
                      height={l.bandPx.y1 - l.bandPx.y0}
                      fill={C.lit} fillOpacity="0.06" stroke={C.lit} strokeWidth={lw}
                      strokeDasharray={`${lw * 3} ${lw * 3}`} opacity="0.8" />
                    {l.centrePx && (<>
                      <line x1={l.centrePx.x - R * 0.7} y1={l.centrePx.y}
                        x2={l.centrePx.x + R * 0.7} y2={l.centrePx.y}
                        stroke={C.lit} strokeWidth={lw} opacity="0.7" />
                      <line x1={l.centrePx.x} y1={l.centrePx.y - R * 0.7}
                        x2={l.centrePx.x} y2={l.centrePx.y + R * 0.7}
                        stroke={C.lit} strokeWidth={lw} opacity="0.7" />
                    </>)}
                  </g>
                )}
                {/* THE POOL OF LIGHT. Under the symbol, wider than it, and
                    breathing. The stagger is deliberate and it is the whole
                    difference between a lit ceiling and a blinking one: forty
                    discs pulsing on the same beat read as a single flashing
                    element, and forty on their own beats read as forty lamps.
                    A prime-ish multiplier keeps the pattern from settling into
                    rows, since the lights are laid out on a grid. */}
                <circle cx={l.x} cy={l.y} r={R * 2.6} fill="url(#lp-glow)"
                  className="lp-pulse" pointerEvents="none"
                  style={{ animationDelay: `${((li * 137) % 1000) / 1000 * -2.8}s` }} />
                {l.kind === 'large' && (
                  <circle cx={l.x} cy={l.y} r={R * 1.9} fill={rim} opacity="0.07" />
                )}
                {/* `.hit` ON THE CIRCLE, NOT ON THE GROUP. Everything inside
                    `.plan` is inert by default — see the note in styles.css,
                    and the three bugs that earned it — and each shape carries
                    its own `pointer-events:none` from an element rule. An
                    inherited `all` from a `.hit` group loses to that, so the
                    class goes on the shape the pointer is meant to find. The
                    glow keeps its inline `none`: it is 2.6× the fitting's
                    radius, and making that live would have one downlight
                    swallowing the clicks meant for its neighbours. */}
                <circle className="hit" cx={l.x} cy={l.y} r={R}
                  /* CLICKING A LIGHT ASKS ABOUT THE CEILING IT IS ON. The
                     fitting carries the key of the design chunk that put it
                     there, so there is nothing to hit-test: the pill opens over
                     that chunk and flips it through what it could be. */
                  onClick={pickable && l.design
                    ? (e) => { e.stopPropagation(); onPickChunk(r.id, l.design); }
                    : undefined}
                  /* ...AND PRESSING ONE PICKS IT UP, WHICH IS NOT THE SAME ACT.
                     Both handlers are live on the same circle and they do not
                     compete: the press starts a drag that only becomes a move
                     once the pointer has travelled a few pixels, and a press
                     that never travels is still the click above. So a light
                     answers "what is this ceiling?" and "put it here" with the
                     same target, told apart by whether you moved.
                     ONLY WHERE THERE IS FREEDOM TO SPEND. `bandPx` is null on a
                     large light and on a head a track has absorbed — see the
                     note where it is built — and a grip on one of those would
                     be a cursor promising a drag that cannot happen. */
                  onPointerDown={onLightPointerDown && l.bandPx
                    ? (e) => onLightPointerDown(e, r.id, l) : undefined}
                  style={onLightPointerDown && l.bandPx && !placing
                    ? { cursor: 'move' } : undefined}
                  /* CUT FROM THE RAMP AND NOTHING ELSE, like the spots.
                     ONE FILL FOR BOTH SIZES. A small downlight was flat white
                     and a large one was solid accent — the fill was carrying the
                     size difference, which it never needed to: a large fitting
                     is half again the radius and has a bar through it. So both
                     get the lit ramp, and the two marks are told apart by the
                     things that actually differ.
                     AND THE RING IS THE RAMP'S RIM TONE, so no amber survives on
                     a recessed fitting — the body, the ring, the bar, the
                     coverage fans, both label tethers and the tag all sample the
                     one accent ramp. See rim at the head of this file for
                     why a two-pixel stroke takes a colour rather than a
                     gradient.
                     THE TRACK HEADS ABOVE ARE DELIBERATELY UNTOUCHED. A head
                     clipped into a profile is not a recessed downlight — it is
                     not cut into the ceiling at all, it is a different line on
                     the schedule, and it is drawn as a rect for exactly that
                     reason. It keeps `col`. */
                  fill="url(#lp-core)"
                  stroke={rim} strokeWidth={lw * (warm ? 3.1 : 1.7)} />
                {/* THE CENTRE DOT IS GONE, same as on the spot and for the same
                    reason: a solid disc of the accent COLOUR at 0.42R sat right
                    where the ramp is brightest, so it covered the lit core with
                    the one hue this is removing. Its job was to read as the lamp
                    inside a white body; the ramp does that itself now.
                    WHAT TELLS A SMALL FROM A LARGE WITHOUT IT: the radius (a
                    large is 0.52 to a small's 0.3) and the ORIENTATION BAR, which
                    only a large carries. Both were already doing the work — the
                    fill and the dot were saying it a third and fourth time. */}
                {l.kind === 'large' && (
                  <line
                    x1={l.axis === 'v' ? l.x : l.x - R * 1.7} y1={l.axis === 'v' ? l.y - R * 1.7 : l.y}
                    x2={l.axis === 'v' ? l.x : l.x + R * 1.7} y2={l.axis === 'v' ? l.y + R * 1.7 : l.y}
                    stroke={rim} strokeWidth={lw * 1.1} opacity="0.5" />
                )}
                {layers.labels && l.kind === 'large' && l.coverPx && l.coverPx.length > 1 && (
                  <g opacity="0.3">
                    {l.coverPx.map((q, k) => (
                      <line key={k} x1={l.x} y1={l.y} x2={q.x} y2={q.y} stroke={rim} strokeWidth={lw} />
                    ))}
                  </g>
                )}
                {/* WHERE THE GRID PUT IT, before the track took it. Same
                    idiom as the nudge tether below and behind the same switch:
                    it is WORKING — the evidence for the claim that flipping a
                    chunk to Track does not re-plan its grid — and working does
                    not belong on a sheet handed to a client. Anybody checking
                    that claim turns the labels on and sees every move, and every
                    one of them is under three feet and square to the run. */}
                {layers.labels && l.gridPx && (
                  <g opacity="0.45" pointerEvents="none">
                    <line x1={l.gridPx.x} y1={l.gridPx.y} x2={l.x} y2={l.y}
                      stroke={rim} strokeWidth={lw}
                      strokeDasharray={`${lw * 2} ${lw * 2}`} />
                    <circle cx={l.gridPx.x} cy={l.gridPx.y} r={lw * 1.4}
                      fill="none" stroke={rim} strokeWidth={lw} />
                  </g>
                )}
                {layers.labels && l.nudged && l.centrePx && (
                  <g opacity="0.5">
                    <line x1={l.centrePx.x} y1={l.centrePx.y} x2={l.x} y2={l.y}
                      stroke={rim} strokeWidth={lw} strokeDasharray={`${lw * 2} ${lw * 2}`} />
                    <circle cx={l.centrePx.x} cy={l.centrePx.y} r={lw * 1.5} fill="none"
                      stroke={rim} strokeWidth={lw} />
                  </g>
                )}
                {layers.labels && (
                  <text x={l.x + R * 1.6} y={l.y - R * 1.2} fontSize={s * 0.5}
                    fontFamily="The Neue Montreal, sans-serif" fill={rim} opacity="0.75">
                    {laid.length > 1 && r.name ? `${r.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 4)}-` : ''}{l.id}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      ))}

      {/* --- WHAT IS ALREADY ON THE CEILING, AND IT IS PAINTED AFTER THE
          LIGHTS ON PURPOSE ------------------------------------------------
          This block used to sit ABOVE the grid, between the wall findings and
          the throws, and that made a placed fan nearly impossible to pick up
          again. SVG has no z-index: paint order IS hit order, so whatever is
          drawn later takes the pointer. Every light carries a `.hit` target
          deliberately WIDER than its own symbol — `max(rw / 2, lw * 5)`, an
          inch of pointer being no target at all — and a grid of them blankets
          the whole ceiling. Drawn afterwards, those invisible pads lay over
          the fan you had just placed and swallowed the drag.

          IT IS ALSO THE HONEST STACKING. A downlight is IN the ceiling and a
          fan or a cassette hangs BELOW it, so the fan is what you would see
          over the lamp if you stood underneath. The drawing said the opposite.

          STILL BELOW THE ACCENTS AND THE TASK SPOTS, which are painted later
          again and carry their own drag handles. That is a deliberate stop
          rather than an oversight: an accent is a band round the perimeter and
          a spot sits on a worktop, so neither blankets the ceiling the way the
          grid does, and putting objects over them would shadow THEIR handles
          to fix a problem they were not causing. If a fan under an accent band
          turns out to be just as hard to grab, this block moves once more —
          past the spots and below the alignment guides.

          A fan, a chandelier and an AC cassette are three drawings of one
          thing: a centre, a radius and the clearance the planner keeps round
          it. The dashed circle is that clearance and it is drawn for all three
          identically, because it IS identical — the difference between them is
          entirely in the solid symbol inside it.

          On a rectangular object the dashed circle is visibly bigger than the
          body. That is not a drawing error, it is the circumscribed radius the
          planner actually reserves, and showing it is the only way anyone would
          know. See ceilingObjects.js. */}
      {layers.fan && fansPx.map((f, i) => {
        const sel = f.id != null && selObjIds.includes(f.id);
        /* THE HANDLES ARE FOR ONE OBJECT ONLY. A resize works from a corner of
           the object's OWN rotated frame and a rotate works about its own
           centre; neither has a meaning for a set of four, which would want a
           group bounding box and a scale applied through it — a different
           feature, not a loop over this one. So a multi-selection shows the
           frames and no grips, and stays fully movable, copyable and
           deletable, which is what it is for. */
        const only = sel && selObjIds.length === 1;
        // HANDLES ARE A CONSTANT SIZE ON SCREEN — divided by the zoom — and that
        // is most of why this reads as an editor rather than a drawing. The plan
        // scales with the zoom; a grab target must not, or it is unusably small
        // at 40% and a dinner plate at 300%.
        /* NO LONGER DIVIDED BY THE ZOOM, and leaving the division in would
           have been a double correction: the stylesheet now pins every stroke
           on this sheet to screen space (`non-scaling-stroke` — see the note in
           styles.css), so a width already scaled DOWN by the zoom would have
           got thinner the further you zoomed IN. `HS` is a hit target's size
           and not a stroke, so it keeps its division — a grab handle has to be
           the same size under the finger at every magnification, and geometry
           is the only way to say that. */
        const HS = (Math.max(width, height) / 145) / (zoom || 1);
        const FW = Math.max(width, height) / 1500;
        // `.hit` is what makes an element a CONTROL rather than drawing — see
        // the hit-test rule in styles.css. Without it the element is inert and
        // the click falls through to the canvas.
        const grab = (mode) => (f.source === 'placed' && onObjPointerDown
          ? { className: 'hit',
              onPointerDown: (e) => onObjPointerDown(e, f.id, mode),
              style: { cursor: mode === 'move' ? 'move' : 'grab' } }
          : {});
        // ALL ONE INK. A fan is a blade circle, a chandelier is a rosette, an
        // AC unit is a louvred rectangle and a trap door is a hatched square —
        // four unmistakable symbols that were also being given four hues.
        // THE ACCENT, HELD BACK. A fan, a cassette and a trap door are things
        // in this ceiling that are not ours, and they used to be drawn in a
        // dark grey that competed with the fittings for attention. They belong
        // to the same family as the lights — objects on the ceiling plane — so
        // they take the same hue, and then they are pulled back with opacity so
        // a downlight sitting near a fan still reads as the brighter mark. The
        // group's own opacity does it rather than a lighter colour, because a
        // washed-out blue on a white plan and a washed-out blue over the fan's
        // dashed clearance circle are two different colours if you fake it.
        // WHITE FOR A FAN AND A CHANDELIER, AND WHY THEY WERE INVISIBLE.
        //
        // Everything above chose the accent, on the reasoning quoted in the note
        // over this line: a fan and a cassette are objects on the ceiling plane
        // like the fittings, so they took the fittings' hue and were then pulled
        // back with opacity so a downlight still read as the brighter mark.
        //
        // THAT ARGUMENT DIED WHEN THE FITTINGS MOVED ONTO THE ACCENT RAMP. The
        // sheet is now covered in warm cream — six-foot throw pools at a tenth
        // opacity, lit fitting bodies, graded strips — and an amber fan at 55%
        // over a cream pool is not a quiet mark, it is a missing one. The
        // multiplication is the other half: unselected and in object mode it was
        // 0.75 x 0.55 = 0.41.
        //
        // So the two ROUND objects go white, which is the one thing the ramp
        // never is, and they read against the pools and against the plan's own
        // grey line work at the same time. The rectangles keep the accent: a
        // cassette and a hatch are drawn as filled shapes with hatching inside
        // them, and white-on-white would erase the marks that tell those two
        // apart.
        //
        // WHITE ASSUMES A DARK GROUND, WHICH IS ONLY HALF THE TIME — so the ink
        // follows the ground rather than being fixed. That is not a preference;
        // white on the as-scanned plan is a white mark on white paper, which is
        // the same bug as the amber one it replaced, pointing the other way.
        //
        //   night mode (`layers.invert`)  the scan is a negative, so the ground
        //                                 is black and WHITE is the mark that
        //                                 carries furthest from the accent ramp
        //   day mode                      the ground is the paper, so the object
        //                                 takes the accent, which is what it
        //                                 always was and what reads on white
        //
        // THE DXF EXCEPTION THAT USED TO BE HERE IS GONE. It read: a vector
        // plan has no bitmap to invert, draws on the page's own black, and so is
        // a dark ground whatever this flag says while reporting `invert: false`
        // — meaning an object on a DXF took the accent rather than white, the
        // one case this got slightly wrong. A DXF has a real night mode now (see
        // the `vector` branch, which picks its greys from the ground) and in day
        // mode it sits on an opaque white sheet, so the flag is true of a DXF as
        // much as of a scan and the rule above applies unaltered.
        //
        // THE RECTANGLES KEEP THE ACCENT IN BOTH MODES. A cassette and a hatch
        // are filled shapes with hatching inside them, and white-on-white would
        // erase the marks that tell those two apart.
        // ROUND OR RECTANGULAR, ASKED OF THE CATALOGUE. It was a list of two
        // kinds here and a different list of two kinds a dozen lines down, and
        // adding a split unit and a geyser to the catalogue would have left
        // both of them out of both lists — drawn as a fan, and framed as one.
        const round = !isRect(f);
        const col = round && layers.invert ? C.object : C.lit;
        // THE CHANDELIER'S SIX LAMPS SIT ON ITS RING, so they have to be the
        // opposite of it or they stop being lamps and become part of the
        // rosette. White on the accent ring in day mode — which is what they
        // always were and why they worked — and the ramp's rim tone on the white
        // ring at night, since white on white is nothing at all.
        const lamp = layers.invert ? rim : '#fff';
        const R = f.r || 0;
        // The BODY's radius, which is NOT the clearance radius: on a rectangle
        // the clearance circle is circumscribed and larger. The selection frame
        // has to fit the body, because the body is what a resize changes.
        const rect = isRect(f);
        // The clearance, in plan pixels. Drawn as the offset of the body, so a
        // circle keeps a ring and a rectangle keeps a rounded rectangle.
        const CL = clearanceFt * (pxPerFt || 0);
        const R0 = rect ? 0 : R;
        return (
          <g key={f.id ?? 'fan' + i}
            /* 0.82 RESTING, NOT 0.55. The old figure was set when these were
               the only warm marks on a white sheet and it made them polite;
               against the accent pools it made them vanish. They are still
               pulled back — a placed object is somebody else's item and should
               not out-shout a fitting — just not to the point of disappearing.
               The objMode factor stays: while you are dragging one, the ones you
               are NOT dragging step back, which is what makes the gesture
               readable. */
            opacity={(objMode && !sel && f.source === 'placed' ? 0.8 : 1) * (sel ? 1 : 0.82)}>
            {/* WHAT IS ACTUALLY RESERVED, and it is not always a circle.
                Clearance is measured to the object's own FACE, so the set of
                points exactly `fanClearance` away from a rectangle is that
                rectangle grown by the clearance with its corners rounded to
                that same radius. Drawing the true offset rather than a circle
                round everything is the only way the reserved area on screen is
                the reserved area in the layout — and drawing a big circle round
                a small cassette was how it came to be reserving one. */}
            {/* AND NOTHING AT ALL FOR THE THINGS THAT ARE NOT ON THE CEILING.
                A split unit sits at 2100mm on a wall and a geyser above a
                toilet door; neither obstructs a downlight, so neither reserves
                anything and a dashed ring round one would be drawing a hole in
                a layout that has none. See `offCeiling` in ceilingObjects.js —
                the same flag keeps them out of what the planner is handed. */}
            {f.offCeiling ? null : rect ? (
              <rect transform={`rotate(${((f.rot || 0) * 180) / Math.PI} ${f.x} ${f.y})`}
                x={f.x - f.w / 2 - CL} y={f.y - f.h / 2 - CL}
                width={f.w + CL * 2} height={f.h + CL * 2} rx={CL} ry={CL}
                fill="none" stroke={col} strokeWidth={lw * 1.4}
                strokeDasharray={`${lw * 5} ${lw * 5}`} opacity="0.8" />
            ) : (
              <circle cx={f.x} cy={f.y} r={R + CL} fill="none" stroke={col}
                strokeWidth={lw * 1.4} strokeDasharray={`${lw * 5} ${lw * 5}`} opacity="0.8" />
            )}

            {f.kind === 'chandelier' ? (
              /* THE LAMPS TAKE `lamp`, NOT THE GROUP'S STROKE. They were
                 `fill="#fff"` with the group's own stroke round them, which read
                 as six lamps while that stroke was amber and became six
                 invisible dots the moment the ring could be white too. See
                 `lamp` above: it is whichever of the two contrasts with the ring
                 this mode is drawing. The stroke is set explicitly for the same
                 reason — inheriting `col` would put a white rim on a white dot
                 in day mode's inverse case. */
              <g stroke={col} strokeWidth={lw * 1.8} fill="none">
                <circle cx={f.x} cy={f.y} r={R0 * 0.68} fill={col} fillOpacity="0.1" />
                {[0, 1, 2, 3, 4, 5].map((k) => {
                  const a = (k * Math.PI) / 3;
                  return <circle key={k} cx={f.x + Math.cos(a) * R0 * 0.68}
                    cy={f.y + Math.sin(a) * R0 * 0.68} r={lw * 2.4}
                    fill={lamp} stroke={lamp} />;
                })}
                <circle cx={f.x} cy={f.y} r={lw * 2.2} fill={lamp} stroke="none" />
              </g>
            ) : rect ? (
              <g transform={`rotate(${((f.rot || 0) * 180) / Math.PI} ${f.x} ${f.y})`}>
                <rect x={f.x - f.w / 2} y={f.y - f.h / 2} width={f.w} height={f.h}
                  fill={col} fillOpacity="0.12" stroke={col} strokeWidth={lw * 2} />
                <rect x={f.x - f.w / 2 + lw * 3} y={f.y - f.h / 2 + lw * 3}
                  width={Math.max(0, f.w - lw * 6)} height={Math.max(0, f.h - lw * 6)}
                  fill="none" stroke={col} strokeWidth={lw} opacity="0.6" />
                {/* A trap door is crossed; a cassette gets a grille tick to say
                    which way is up, so a rotation is legible at all. Two marks
                    rather than one symbol at two sizes: on a printed sheet
                    "small square" and "slightly smaller square" is not a
                    distinction anyone can make. */}
                {f.kind === 'trapdoor' ? (
                  <g stroke={col} strokeWidth={lw * 1.2} opacity="0.7">
                    <line x1={f.x - f.w / 2} y1={f.y - f.h / 2} x2={f.x + f.w / 2} y2={f.y + f.h / 2} />
                    <line x1={f.x + f.w / 2} y1={f.y - f.h / 2} x2={f.x - f.w / 2} y2={f.y + f.h / 2} />
                  </g>
                ) : f.kind === 'split_ac' ? (
                  /* LOUVRES, ALONG THE LONG AXIS. A split unit's plan mark is a
                     long thin rectangle, which on its own is indistinguishable
                     from a duct, a beam or a shelf — this drawing has all
                     three. Three lines across the width say "grille", and they
                     run the length of the unit because that is how the blades
                     actually sit. */
                  <g stroke={col} strokeWidth={lw} opacity="0.7">
                    {[-1, 0, 1].map((k) => (
                      <line key={k} x1={f.x - f.w / 2 + lw * 5} y1={f.y + (f.h / 5) * k}
                        x2={f.x + f.w / 2 - lw * 5} y2={f.y + (f.h / 5) * k} />
                    ))}
                  </g>
                ) : (
                  <line x1={f.x} y1={f.y - f.h / 2} x2={f.x} y2={f.y - f.h / 2 + Math.min(f.w, f.h) * 0.28}
                    stroke={col} strokeWidth={lw * 1.8} />
                )}
              </g>
            ) : f.kind === 'geyser' ? (
              /* THE CYLINDER, SEEN FROM ABOVE, AND ITS INLET. A plain circle is
                 a fan with its blades missing; the double ring is the tank in
                 its casing, and the stub is the pipework, which is the half of
                 the mark that says this is plumbing rather than a light. */
              <g stroke={col} strokeWidth={lw * 1.6} fill="none">
                <circle cx={f.x} cy={f.y} r={R * 0.92} fill={col} fillOpacity="0.12" />
                <circle cx={f.x} cy={f.y} r={R * 0.5} />
                <line x1={f.x} y1={f.y - R * 0.92} x2={f.x} y2={f.y - R * 1.35}
                  strokeLinecap="round" />
              </g>
            ) : (
              <g>
                <circle cx={f.x} cy={f.y} r={lw * 3} fill={col} />
                {[0, 1, 2].map((k) => {
                  const a = (k * 2 * Math.PI) / 3 + Math.PI / 6;
                  return <line key={k} x1={f.x} y1={f.y}
                    x2={f.x + Math.cos(a) * R0 * 0.94} y2={f.y + Math.sin(a) * R0 * 0.94}
                    stroke={col} strokeWidth={lw * 2.2} strokeLinecap="round" opacity="0.75" />;
                })}
              </g>
            )}

            {/* THE BODY IS THE MOVE TARGET. A filled hit area over the whole
                footprint, not a ring round the middle: an object you can only
                grab near its centre feels like it is dodging you.

                AND IT IS NOT GATED ON `objMode` ANY MORE. THIS WAS THE BUG.
                The target only existed once object mode was already on, and
                object mode is turned on by a button in the right-hand panel —
                so the only way to pick up a fan you had just placed was to go
                and arm the tool for it first. That is backwards twice over: the
                object is RIGHT THERE under the pointer, and `objPointerDown`
                turns object mode on by itself the moment anything is grabbed
                (see App.jsx), so the flag was a precondition for the very
                gesture that sets it. A placed object is now always grabbable,
                which is what "selectable" has to mean.

                `placing` IS THE ONE THING THAT STILL SUPPRESSES IT, and it is
                not the same kind of flag. While a fitting tool is armed the
                next click is a PLACEMENT — drop a sconce, start a strip, drag a
                spot — and those are gestures aimed at the ceiling that happen to
                land inside a fan's footprint. Letting the fan eat them would
                trade one stolen click for another. Nothing else suppresses it:
                `zoneMode` is handled by the zone layer's own surface, which is
                painted over this one. */}
            {f.source === 'placed' && !placing && (
              rect
                ? <rect transform={`rotate(${((f.rot || 0) * 180) / Math.PI} ${f.x} ${f.y})`}
                    x={f.x - f.w / 2} y={f.y - f.h / 2} width={f.w} height={f.h}
                    fill="transparent" {...grab('move')} />
                : <circle cx={f.x} cy={f.y} r={Math.max(R0, HS * 1.4)}
                    fill="transparent" {...grab('move')} />
            )}

            {/* --- the selection frame ------------------------------------
                Drawn in the object's OWN rotated frame, so it turns with the
                thing rather than staying square to the page. The frame is
                telling you what a resize will change; on a rotated object an
                axis-aligned box would be lying about that. */}
            {sel && (() => {
              const hw = rect ? f.w / 2 : R0;
              const hh = rect ? f.h / 2 : R0;
              const deg = ((f.rot || 0) * 180) / Math.PI;
              const stem = -hh - HS * 3.2;
              return (
                <g transform={`rotate(${deg} ${f.x} ${f.y})`}>
                  {/* THE FRAME IS THE ACCENT RAMP, AND THE GRIPS ARE NOT.
                      The border that appears on select now grades like
                      everything else this app owns — `lp-sel-ramp`, the same
                      paint the selected room's outline takes, and for the same
                      reason it is that ramp rather than `lp-lit`: a frame is a
                      LINE, and the fill ramp's near-white middle would drop out
                      of the middle of each side. See the note in the defs.
                      objectBoundingBox is safe on a frame — it is a rectangle
                      with real extent both ways.

                      THE FOUR CORNER GRIPS AND THE ROTATE STEM STAY BLUE, which
                      is a deliberate split and the one thing to look at on
                      screen. #0070F3 means "you can grab this" everywhere on
                      this canvas, and a resize handle is the most literal case
                      of it there is. The frame says WHICH object is selected;
                      the squares say what you can do to it. If the mix reads as
                      a mistake rather than as two statements, the grips are one
                      edit away.

                      AND IT IS AS SLIM AS THIS SHEET DRAWS. `FW` is the
                      drawing's own line weight divided by the zoom, so it is one
                      pixel on screen at every magnification — there is nothing
                      thinner here to make it. Where it READS thick is on a
                      rectangular object, because the frame sits exactly on the
                      body's edge (`hw = f.w / 2`) and the body carries its own
                      `lw * 2` outline underneath: two strokes on one line. That
                      coincidence is on purpose — the frame has to show what a
                      resize will change — so the fix, if it wants one, is to
                      thin the BODY rather than the frame. */}
                  <rect x={f.x - hw} y={f.y - hh} width={hw * 2} height={hh * 2}
                    fill="none" stroke="url(#lp-sel-ramp)" strokeWidth={FW} />

                  {/* Rotate: a stem above the frame. Figma's invisible
                      just-outside-the-corner region is undiscoverable without a
                      hover cursor to teach it, so this one is drawn. */}
                  {/* `.hit` ON THE SHAPES, NOT ON THIS GROUP — the same trap
                      the grid light's own note describes, and the rotate stem
                      had walked straight into it. `.plan .hit{pointer-events:
                      all}` scores (0,2,0); `.plan circle{pointer-events:none}`
                      scores (0,1,1) but it matches the CIRCLE DIRECTLY, and a
                      direct match beats a value inherited from an ancestor
                      however specific that ancestor's rule was. So a `.hit`
                      group full of bare shapes is a group whose every child is
                      inert: the stem was drawn, it showed the grab cursor, and
                      it could not be grabbed. `grab()` supplies the class, so
                      each shape takes the spread itself.

                      THE STEM IS A LINE AND NEEDS `pointerEvents="stroke"`. An
                      unfilled line has no interior to hit; without this only
                      the knob at the end would answer, which is most of the
                      target thrown away. */}
                  {rect && only && (<>
                    <line x1={f.x} y1={f.y - hh} x2={f.x} y2={f.y + stem}
                      stroke={C.grip} strokeWidth={FW} strokeLinecap="round"
                      style={{ pointerEvents: 'stroke' }} {...grab('rotate')} />
                    <circle cx={f.x} cy={f.y + stem} r={HS * 0.55} fill="#fff"
                      stroke={C.grip} strokeWidth={FW * 1.6} {...grab('rotate')} />
                  </>)}

                  {only && [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy], k) => (
                    <rect key={k}
                      x={f.x + sx * hw - HS / 2} y={f.y + sy * hh - HS / 2}
                      width={HS} height={HS} rx={HS * 0.18} className="hit"
                      fill="#fff" stroke={C.grip} strokeWidth={FW * 1.6}
                      style={{ cursor: sx * sy > 0 ? 'nwse-resize' : 'nesw-resize' }}
                      onPointerDown={(e) => onObjPointerDown?.(e, f.id, 'resize', { sx, sy })} />
                  ))}
                </g>
              );
            })()}

            {/* The readout, only while the gesture is running: the number you
                are actually setting, next to where you are looking. */}
            {sel && objDragMode && (
              <text x={f.x} y={f.y - (rect ? f.h / 2 : R0) - HS * 5}
                textAnchor="middle" fontSize={HS * 1.1}
                fontFamily="The Neue Montreal, sans-serif" fill={C.grip}>
                {objDragMode === 'rotate'
                  ? `${Math.round(((f.rot || 0) * 180) / Math.PI)}\u00B0`
                  : rect
                    ? `${Math.round((f.w / (pxPerFt || 1)) * 304.8)} \u00D7 ${Math.round((f.h / (pxPerFt || 1)) * 304.8)}`
                    : `${Math.round((R0 * 2 / (pxPerFt || 1)) * 304.8)} \u2300`}
              </text>
            )}

            {fansPx.length > 1 && layers.labels && (
              <text x={f.x + (rect ? f.w / 2 : R0) + CL + lw * 3} y={f.y - (rect ? f.h / 2 : R0) * 0.6} fontSize={(pxPerFt || 12) * 0.5}
                fontFamily="The Neue Montreal, sans-serif" fill={col} opacity="0.8">
                {(f.kind || 'fan').slice(0, 1).toUpperCase()}{i + 1}
              </text>
            )}
          </g>
        );
      })}

      {/* --- the reverse coves ----------------------------------------------
          THE SLOT ITSELF, and the tape inside it is drawn by the accents layer
          below like every other run. Two marks for one detail, exactly as an
          ordinary cove gets two — the setting-out line and the tape — because
          they are two different things to set out: the plasterer builds the slot
          and the electrician runs the tape down the middle of it.

          A BAND AND NOT A LINE. Eight inches is the specification, and drawing
          it as a line would throw away the one dimension the rule is about. So
          it is a filled band with its inner lip drawn heavier: the lip is the
          edge that gets set out, and the wall side of it is the wall.

          FILLED IN THE FITTINGS' OWN BLUE, and solidly enough to read as a
          filled shape rather than as a rectangle with a tint in it. Every other
          blue on this sheet is a fitting or a selection, and that is exactly
          what this is: eight inches of ceiling that is now lighting. It is still
          transparent, because the plan's own line work — the wall, the door
          jamb, whatever the slot is set out against — has to stay readable
          underneath it. A solid band would hide the very edges it is dimensioned
          from.

          IT STOPS AT A DOOR, and that is not this file's doing: the geometry
          arrives already cut into one band per wall segment. See wallSegments in
          reverseCove.js.

          UNDER `layers.accents`, with the tape it holds. The band without the
          strip is a rectangle nobody can interpret, and the strip without the
          band is a run floating eight inches off a wall for no visible reason.
          They are one fitting and they hide together. */}
      {layers.accents && reverseCoves.map((c, ci) => {
        const B = COVE_BAND_STYLE;
        // The inner lip: the edge away from the wall. `wall` says which side of
        // the band the wall is on, so the lip is the other one.
        const lip = c.wall === 'top' ? [{ x: c.rect.x0, y: c.rect.y1 }, { x: c.rect.x1, y: c.rect.y1 }]
          : c.wall === 'bottom' ? [{ x: c.rect.x0, y: c.rect.y0 }, { x: c.rect.x1, y: c.rect.y0 }]
          : c.wall === 'left' ? [{ x: c.rect.x1, y: c.rect.y0 }, { x: c.rect.x1, y: c.rect.y1 }]
          : [{ x: c.rect.x0, y: c.rect.y0 }, { x: c.rect.x0, y: c.rect.y1 }];
        // --- THE RAMP, ALONG THE BAND -------------------------------------
        //
        // `horizontal` FINALLY DOES SOMETHING. It sat here behind a `void` for
        // exactly this reason — the band's orientation was worked out and then
        // nothing on the mark needed it, because a flat fill has no direction.
        // A gradient does, and it has to run the LENGTH of the slot: this is
        // linear product, billed by the metre, and the strips and the track
        // rails already grade along themselves. Across the eight inches the ramp
        // would resolve over a fingernail of drawing and read as a flat tone
        // with a dirty edge.
        //
        // userSpaceOnUse, and here it is a choice about DIRECTION rather than a
        // dodge round a degenerate bounding box — a band has real extent both
        // ways, so objectBoundingBox would work and would grade the wrong way on
        // half the walls in the room: across for a horizontal band, along for a
        // vertical one, from the same markup. Pinning the vector to the rect's
        // own long axis makes every band on the sheet read the same.
        const g = c.horizontal
          ? { x1: c.rect.x0, y1: c.rect.y0, x2: c.rect.x1, y2: c.rect.y0 }
          : { x1: c.rect.x0, y1: c.rect.y0, x2: c.rect.x0, y2: c.rect.y1 };
        const gid = `lp-rcove-${ci}`;
        return (
          <g key={c.id} pointerEvents="none">
            <defs>
              <linearGradient id={gid} gradientUnits="userSpaceOnUse" {...g}>
                {RAMP.stops.map((st) => (
                  <stop key={st.at} offset={st.at} stopColor={st.color} />
                ))}
              </linearGradient>
            </defs>
            {/* A COMPLETE FILL, and transparent on purpose — see
                COVE_BAND_STYLE. The outline and the lip take the ramp's rim tone
                rather than the ramp itself: they are line work, and the slot's
                set-out edge has to hold its weight the whole way along where a
                ramp would fade it out in the middle. That is the same failure
                the room selection outline hit; it is worth not repeating. */}
            <rect x={c.rect.x0} y={c.rect.y0}
              width={c.rect.x1 - c.rect.x0} height={c.rect.y1 - c.rect.y0}
              fill={`url(#${gid})`} fillOpacity={B.fillOpacity}
              stroke={rim} strokeWidth={lw} strokeOpacity={B.edgeOpacity} />
            <line x1={lip[0].x} y1={lip[0].y} x2={lip[1].x} y2={lip[1].y}
              stroke={rim} strokeWidth={lw * B.lipWeight}
              strokeOpacity={B.lipOpacity} />
          </g>
        );
      })}

      {/* --- accent lighting -----------------------------------------------
          THE FITTING IS THE DRAWING, the box is the working. A strip is a solid
          red line with real ends, because the whole reason the model was asked
          to box the OBJECT rather than the run was to get those two ends out of
          the object's own extent — drawing it back as a box would throw away the
          one thing that was hard to get. A sconce is a mark ON the wall it
          projected onto.

          The box stays visible behind it, faint and dashed, so what the model
          said and what the geometry did with it are both on screen. When they
          disagree — a run half the length of the wardrobe, a sconce snapped to
          the wrong wall — that disagreement is the bug, and it is invisible if
          only one of the two is drawn. */}
      {layers.accents && accents.map((a, ai) => {
        // `const w = a.rect.x1 - ...` USED TO BE HERE, and it went because it was
        // an unconditional dereference in aid of nothing: `w` and `h` were never
        // read — eslint had been saying so for a long time — and every accent the
        // app passes happens to carry a `rect`, so the crash it was one field
        // away from never fired. test-render.mjs fired it on the first fixture
        // that left `rect` off, which is exactly the kind of thing that file is
        // for. The model's box is not drawn any more (see the note above), so
        // the accent's own extent is nobody's business here.
        const dim = a.rejected ? 0.35 : 1;
        const accSel = a.id === selAccId;
        // ONE COLOUR FOR EVERYTHING THAT EMITS. `a.colour` was set per accent
        // type back when a strip was red and a sconce amber; the type is
        // already in the symbol — a run with end caps, a crosshair on a wall —
        // so the hue was spare, and it is spent on "this is a light" instead.
        //
        // NOW ONLY THE SCONCE'S, AND NOW THE RAMP'S RIM TONE RATHER THAN AMBER.
        // A linear run takes the accent GRADIENT along its length (see `tape`
        // below); a sconce cannot, because a crosshair is line work and there is
        // no length to grade across. So it takes the ramp's outermost colour,
        // exactly as the spots' and the downlights' rings do — see rim at
        // the head of this file. Its own body already carries the full ramp, so
        // the fitting reads as one object cut from one gradient, and there is no
        // amber left anywhere on a sconce.
        const acol = rim;
        // Constant on screen, like every other control. See the ceiling-object
        // handles for the argument.
        // Same split as the ceiling object's HS/FW above: the handle stays
        // zoom-compensated because it is a size, the frame's weight does not
        // because it is a stroke and the stylesheet holds it now.
        const AH = (Math.max(width, height) / 155) / (zoom || 1);
        const AFW = Math.max(width, height) / 1500;
        // THE SYMBOL'S GEOMETRY, WORKED OUT ONCE. It used to live inside the
        // block that draws the sconce, which meant the hit area was put at
        // `a.point` — on the WALL — while the symbol it was supposed to catch
        // is drawn standing off into the room. You had to click the wall line
        // to select a fitting you could see three feet away.
        const SG = (a.point && a.inward) ? (() => {
          const R = Math.max((pxPerFt || 12) * 0.3, lw * 3);
          const { x: ix, y: iy } = a.inward;
          const stand = R * 2.6;
          return {
            R, stand, arm: R * 1.7, ix, iy,
            ux: a.along?.x ?? -iy, uy: a.along?.y ?? ix,
            cx: a.point.x + ix * stand, cy: a.point.y + iy * stand,
          };
        })() : null;
        // WHAT THE CARD UNDER THE POINTER CALLS THIS — by `fixture`, falling
        // back to the type. Every linear run on this drawing is `type: 'strip'`,
        // which is what lets one block draw all of them; what a given run IS —
        // plain tape, or an eight-inch slot formed in the ceiling to wash a
        // panelled wall — is the fixture, and it is the fixture the card should
        // name. A reverse cove reading "LED strip · concealed cove /
        // under-cabinet" describes the component and not the item.
        const spec = a.type === 'strip'
          ? specsFor(a.fixture || 'strip', { metres: runMetres(a, pxPerFt) })
          : specsFor('sconce');
        // --- THE ACCENT GRADIENT, RUNNING ALONG THE TAPE ------------------
        //
        // The brand ramp laid down the LENGTH of the run rather than across it,
        // so a strip reads as one continuous piece of product with the light
        // graduating along it — which is what the gradient is for and what a
        // flat #ffb900 could not say.
        //
        // userSpaceOnUse, AND THAT IS THE WHOLE DIFFICULTY. The obvious
        // implementation is objectBoundingBox with x1=0,x2=1 — the default, and
        // what the floor pools use — and on a strip it is BROKEN, for exactly
        // the reason the `lp-strip-glow` filter region above is in user space:
        // a horizontal or vertical line has a bounding box with zero height or
        // zero width. A gradient mapped onto a degenerate box has nowhere to
        // ramp, and most runs on a lighting plan are dead horizontal or dead
        // vertical. So the stops are pinned to the run's ACTUAL endpoints in
        // plan pixels, which cannot collapse.
        //
        // ONE GRADIENT PER RUN, KEYED ON THE MAP INDEX. It has to be per-run
        // because the coordinates are — a gradient cannot be shared by two
        // strips pointing different ways — and it is keyed on `ai` rather than
        // on `a.id` because an accent id is composed from room and chunk keys
        // and is not guaranteed to be a legal SVG fragment id. `ai` is unique
        // within this map, which is all a document-scoped id needs to be.
        //
        // A COVE HAS NO ENDPOINTS, so it takes the diagonal of its own bounding
        // box: a closed circuit has no single direction, and the diagonal is the
        // one line that grades every side of it rather than leaving two sides
        // flat. `x0` and friends are read off the loop rather than off `a.rect`
        // — the rect is the model's box, which the drawing deliberately does
        // not use for anything (see the note above).
        const gid = `lp-strip-${ai}`;
        const gline = a.run
          ? { x1: a.run[0].x, y1: a.run[0].y, x2: a.run[1].x, y2: a.run[1].y }
          : a.loop
            ? {
                x1: Math.min(...a.loop.map((q) => q.x)),
                y1: Math.min(...a.loop.map((q) => q.y)),
                x2: Math.max(...a.loop.map((q) => q.x)),
                y2: Math.max(...a.loop.map((q) => q.y)),
              }
            : null;
        // The tape's ink. Falls back to the flat accent for a sconce, which has
        // no run to grade along — it is a crosshair on a wall, not a length of
        // product.
        const tape = gline ? `url(#${gid})` : acol;
        return (
          <g key={a.id} opacity={dim} {...feel(a.id, spec)}>
            {gline && (
              <defs>
                <linearGradient id={gid} gradientUnits="userSpaceOnUse" {...gline}>
                  {RAMP.stops.map((st) => (
                    <stop key={st.at} offset={st.at} stopColor={st.color} />
                  ))}
                </linearGradient>
              </defs>
            )}
            {accSel && a.run && (
              <line x1={a.run[0].x} y1={a.run[0].y} x2={a.run[1].x} y2={a.run[1].y}
                stroke={C.grip} strokeWidth={AFW * 5} strokeLinecap="round" opacity="0.28" />
            )}
            {/* THE MODEL'S BOX IS NOT ON THE DRAWING ANY MORE.
                It was the region the accent detector marked — the wardrobe, the
                TV unit — drawn dashed behind the fitting so that what the model
                said and what the geometry did with it were both visible. That
                is a debugging view, and the right one while the placer was
                being written: a run half the length of the wardrobe is a bug
                you can only catch by looking at both.
                On a sheet somebody is handed it is a dashed rectangle round a
                piece of furniture, in the lights' own colour, beside the strip
                it produced — three marks where the drawing needs one. Same
                argument as the task-surface boxes and the same answer: the
                FITTING is the visible consequence, the region is working, and
                the region is still on the zone for anything that wants it.
                Only the lights show. */}

            {/* THE COVE: A CLOSED RUN, WITH NO ENDS AND NO HANDLES.
                Every other strip on this drawing is a segment somebody placed
                and can drag — two points, two grips, two end caps. A cove is
                none of those things: it is the perimeter of a band that has
                been built, it turns all four corners, and moving it would mean
                moving the ceiling. So it is drawn as a closed circuit and it is
                drawn HERE rather than as four ordinary strips, because four
                strips would put an end cap at every corner and read as tape
                that had been cut — which is precisely the detail a coving
                drawing exists to deny.
                Same ink, same dotted idiom and same breathing glow as every
                other run, because it is the same tape. */}
            {a.loop && (() => {
              const S = STRIP_STYLE;
              const boost = hot === a.id ? S.hoverBoost : 0;
              const dot = lw * S.dash, gapl = lw * S.gap;
              const d = a.loop.map((q, i) => `${i ? 'L' : 'M'}${q.x},${q.y}`).join(' ') + ' Z';
              return (
                <g>
                  <path d={d} fill="none" stroke={tape}
                    strokeWidth={lw * (S.glow + boost * 2)} strokeLinejoin="round"
                    opacity={S.glowOpacity} filter="url(#lp-strip-glow)"
                    pointerEvents="none" className="lp-breathe"
                    style={{ '--lp-glow-o': S.glowOpacity,
                             '--lp-w0': `${lw * (S.glow + boost * 2) * (1 - S.glowSwell)}px`,
                             '--lp-w1': `${lw * (S.glow + boost * 2) * (1 + S.glowSwell)}px`,
                             animationDuration: `${S.pulseMs}ms`,
                             animationDelay: `${((ai * 137) % 1000) / 1000 * -S.pulseMs}ms`,
                             animationPlayState: hot === a.id ? 'paused' : 'running' }} />
                  <path d={d} fill="none" stroke={tape}
                    strokeWidth={lw * (S.stroke + boost)} strokeLinecap="round"
                    strokeDasharray={`${dot} ${gapl}`} className="lp-flow" />
                  {/* THE TAPE IS THE TARGET, NOT THE AREA IT ENCLOSES.
                      This path used to carry `.hit` itself, and a closed path
                      with `pointer-events: all` is live over its whole interior:
                      a cove strip was therefore eating every click inside the
                      chunk it runs round, including the ones meant for the cove
                      line underneath it — which is the only way back to a coved
                      chunk's options. The card still comes up on the tape, which
                      is the only thing this was ever for; a cove has no ends and
                      no handles to drag. See `bandStyle`. */}
                  <path className="hit" style={{ pointerEvents: 'stroke' }} d={d}
                    fill="none" stroke="transparent"
                    strokeWidth={Math.max(lw * (S.stroke + boost) * 3, lw * 6)} />
                </g>
              );
            })()}

            {/* the run: a strip, with the ends the object gave it */}
            {a.run && (() => {
              const [p0, p1] = a.run;
              const L = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
              // The end caps are perpendicular ticks, so a run reads as having
              // a definite start and stop rather than fading into the wall.
              const nx = -(p1.y - p0.y) / L, ny = (p1.x - p0.x) / L;
              const t = lw * 4;
              // A DOTTED RUN THAT PULSATES, THE WAY A SPOT DOES.
              //
              // THREE VERSIONS OF A TRAVELLING PULSE WENT IN THE BIN BEFORE
              // THIS, and the reason they all failed is worth keeping. First:
              // walk the dots themselves by one dash cycle — seven pixels over
              // two seconds, which moved and could not be seen, and was
              // conceptually wrong anyway because the dots ARE the emitters and
              // emitters do not slide along their own tape. Second: a band of
              // lighter blue underneath, which at 3.8× the line weight was
              // invisible under 2.4× dots and at 7× read as the tape swelling
              // rather than as anything travelling. Third: one dot of white at
              // the run's own weight, shooting along in 900ms — legible,
              // correct on its own terms, and still wrong on the drawing,
              // because a white mark racing down a line is an ANIMATION and
              // everything else on this sheet is a fitting quietly breathing.
              //
              // So a strip does what a spot does: the glow under it swells and
              // fades on the same 2.8-second cycle, and the dots hold still.
              // One idiom for "this is on" across every fitting on the plan,
              // which is the thing the drawing was missing while the strips had
              // an idiom of their own. The stagger is the same trick the
              // downlights use — a per-fitting phase offset, so a plan reads as
              // several lamps rather than one blinking element.
              //
              // Every dimension comes from STRIP_STYLE in settings.js, and each
              // is a multiple of the sheet's line weight so the same numbers
              // describe this strip on a 900px sketch and a 6000px survey.
              const S = STRIP_STYLE;
              const boost = hot === a.id ? S.hoverBoost : 0;
              const dot = lw * S.dash, gapl = lw * S.gap;
              return (
                <g>
                  {/* THE GLOW BREATHES BY GETTING FATTER, NOT BY FADING.
                      Opacity alone was the first go at this and it did not read
                      as pulsating at all — a blurred band at 38% and the same
                      band at 62% look like the same band, because the blur has
                      already thrown most of its contrast away. A downlight's
                      halo works because it SCALES, and the strip's equivalent
                      of scaling is stroke-width: a line grows perpendicular to
                      its own axis, so the band gets wider and stays exactly as
                      long. `butt` caps rather than `round` for the same reason
                      — a round cap adds half the stroke width at each end, so a
                      breathing run with round caps would creep past its own end
                      caps twice a cycle. The two widths go in as custom
                      properties because they are multiples of the sheet's line
                      weight, which the stylesheet cannot know. */}
                  <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y}
                    stroke={tape} strokeWidth={lw * (S.glow + boost * 2)}
                    strokeLinecap="butt" opacity={S.glowOpacity}
                    filter="url(#lp-strip-glow)" pointerEvents="none"
                    className="lp-breathe"
                    style={{ '--lp-glow-o': S.glowOpacity,
                             '--lp-w0': `${lw * (S.glow + boost * 2) * (1 - S.glowSwell)}px`,
                             '--lp-w1': `${lw * (S.glow + boost * 2) * (1 + S.glowSwell)}px`,
                             animationDuration: `${S.pulseMs}ms`,
                             animationDelay: `${((ai * 137) % 1000) / 1000 * -S.pulseMs}ms`,
                             animationPlayState: hot === a.id ? 'paused' : 'running' }} />
                  <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y}
                    stroke={tape} strokeWidth={lw * (S.stroke + boost)}
                    strokeLinecap="round"
                    strokeDasharray={`${dot} ${gapl}`}
                    className="lp-flow hit" />
                  {/* SMALL SQUARE END CAPS. They were perpendicular ticks at
                      grip size, which is precisely what a grip looks like — so
                      people tried to drag them. A small square says "the run
                      stops here" and says nothing about being draggable; the
                      actual handles are bigger, white-filled and appear on
                      hover or selection. */}
                  {[p0, p1].map((q, i) => (
                    <rect key={i} x={q.x - lw * S.cap / 2} y={q.y - lw * S.cap / 2}
                      width={lw * S.cap} height={lw * S.cap}
                      fill={tape} pointerEvents="none" />
                  ))}
                </g>
              );
            })()}

            {/* the point: a sconce.
                A crosshair STANDING OFF ITS WALL, not sitting astride it. The
                long stem touches the wall and nothing else does: the fitting is
                fixed to that surface and hangs in the room, so a symbol centred
                on the line would be drawn half inside the wall — and, on an
                external wall, half in next door.
                The stem is the bracket, so it is what points at the wall; the
                other three arms are equal and the whole thing turns with the
                surface. Lines cross the circle rather than stopping at it, over
                an OPAQUE ground so it stays legible on top of the plan's own
                line work — the lit ramp now, not flat white. Same swap as every
                other fitting on the sheet and for the same reason: the ground
                still has to be opaque, and it may as well say the fitting is
                emitting while it is there. */}
            {SG && (() => {
              const { R, arm, ix, iy, ux, uy, cx, cy } = SG;
              return (
                <g>
                  <circle cx={cx} cy={cy} r={R} fill="url(#lp-core)" />
                  <g stroke={acol} strokeWidth={lw * 1.8} strokeLinecap="round">
                    {/* the stem: from the wall, through the circle, out the far side */}
                    <line x1={a.point.x} y1={a.point.y}
                      x2={cx + ix * arm} y2={cy + iy * arm} />
                    {/* the cross bar, lying along the wall */}
                    <line x1={cx - ux * arm} y1={cy - uy * arm}
                      x2={cx + ux * arm} y2={cy + uy * arm} />
                  </g>
                  <circle className="hit" cx={cx} cy={cy} r={R} fill="none"
                    stroke={acol} strokeWidth={lw * (hot === a.id ? 3.4 : 2.1)} />
                </g>
              );
            })()}

            {/* --- editing -------------------------------------------------
                DRAWN LAST, and that is not a detail. SVG paints in document
                order and hit-tests the topmost thing under the pointer, so a
                transparent grab area drawn BEFORE the symbol is covered by the
                symbol's own white ground — the click lands on a shape with no
                handler, bubbles to the canvas, and deselects instead of
                selecting. Which is exactly what it did.

                A SCONCE is one-dimensional — it is fixed to a wall and slides
                along it. A STRIP IS NOT, any more: its ends go where you put
                them and the body drags whole, because the case that needed
                fixing was a run on the wrong wall, and no amount of sliding
                along the wrong wall gets you off it. The old constraint is
                still there as a snap, and on Shift as a hard axis lock. */}
            {/* A DERIVED RUN GETS ENDS AND NOTHING ELSE.
                A reverse cove is a slot at a wall and a shelf strip is inside
                joinery: neither is a thing somebody placed, so neither can be
                picked up and put somewhere else — what a person legitimately
                wants to change is HOW LONG it is. So the body handle is not
                offered, and the ends resize along the run's own axis. Offering a
                move handle that quietly refused would be worse than offering
                none: the cursor would promise a gesture the drawing will not
                make.
                The cursor says which way it goes, which is the only hint a grip
                on a fitting can give before the drag starts. */}
            {a.run && onAccPointerDown && !a.rejected && (
              <g>
                {/* THE BODY LINE COMES FIRST, WHATEVER IT DOES, AND THAT IS
                    NOT A STYLE CHOICE — IT IS THE WHOLE BUG.
                    SVG hit-testing is by PAINT ORDER: the last thing painted at
                    a point is the thing that gets the pointer. This line is 1.6
                    grips wide and runs straight through both of them, so drawn
                    after the grips it swallows every press on them. A derived
                    run's grips looked completely correct, highlighted on hover,
                    showed a resize cursor — and could not be dragged, because
                    every pointerdown was landing on the select line underneath
                    the pointer instead. The ordinary strip never had the problem
                    because its move line was always first.
                    So both variants are drawn here, before the grips, and the
                    only difference between them is what the press means. */}
                <line x1={a.run[0].x} y1={a.run[0].y} x2={a.run[1].x} y2={a.run[1].y}
                  stroke="transparent" strokeWidth={AH * 1.6} strokeLinecap="round"
                  className="hit"
                  style={{ cursor: a.derived ? 'pointer' : 'move' }}
                  onPointerDown={(ev) => onAccPointerDown(ev, a.roomId, a.id,
                    a.derived ? 'select' : 'move')} />
                {/* ON HOVER AS WELL AS ON SELECTION. A run you can drag but
                    whose handles only appear once you have already clicked it
                    is a run that looks fixed until you guess otherwise. The
                    pointer being on it is enough of a question to answer.
                    A derived run has no body to hover, so its hit area IS the
                    pair of grips — they are drawn whenever it is selected, and
                    the strip itself selects on a click like any other. */}
                {(accSel || hot === a.id) && a.run.map((q, k) => (
                  <rect key={k} x={q.x - AH / 2} y={q.y - AH / 2} width={AH} height={AH}
                    rx={AH * 0.18} fill="#fff" stroke={C.grip} strokeWidth={AFW * 1.6}
                    className="hit"
                    style={{ cursor: a.derived
                      ? (a.horizontal ? 'ew-resize' : 'ns-resize') : 'move' }}
                    onPointerDown={(ev) => onAccPointerDown(ev, a.roomId, a.id, k === 0 ? 'end0' : 'end1')} />
                ))}
              </g>
            )}

            {/* THE SNAP THAT FIRED, drawn only while it is firing. A strip that
                has landed on a wall or stayed collinear looks identical to one
                that is a hair off, and the difference is the whole reason the
                drag feels precise or feels vague. Extended past both ends so it
                reads as a line the run is ON rather than as the run itself. */}
            {a.run && a.snap && (() => {
              const [p0, p1] = a.run;
              const dx = p1.x - p0.x, dy = p1.y - p0.y;
              const L = Math.hypot(dx, dy) || 1;
              const ex = (dx / L) * AH * 3, ey = (dy / L) * AH * 3;
              return (
                <line x1={p0.x - ex} y1={p0.y - ey} x2={p1.x + ex} y2={p1.y + ey}
                  stroke={C.guide} strokeWidth={AFW} opacity="0.9"
                  strokeDasharray={`${AFW * 5} ${AFW * 3}`} />
              );
            })()}

            {SG && accSel && a.wall && (
              /* The wall it was taken off. Not a constraint any more — a
                 reference, and the thing the run snaps back onto. */
              <line x1={a.wall.a.x} y1={a.wall.a.y} x2={a.wall.b.x} y2={a.wall.b.y}
                stroke={C.grip} strokeWidth={AFW} strokeDasharray={`${AFW * 4} ${AFW * 4}`}
                opacity="0.7" />
            )}
            {SG && onAccPointerDown && !a.rejected && (
              <circle cx={SG.cx} cy={SG.cy}
                r={Math.max(SG.R * 1.7, AH * 1.1)} fill="transparent"
                className="hit" style={{ cursor: 'move' }}
                onPointerDown={(ev) => onAccPointerDown(ev, a.roomId, a.id, 'slide')} />
            )}
            {SG && accSel && (
              <rect x={SG.cx - AH / 2} y={SG.cy - AH / 2} width={AH} height={AH}
                rx={AH * 0.18} fill="#fff" stroke={C.grip} strokeWidth={AFW * 1.6}
                className="hit" style={{ cursor: 'move' }}
                onPointerDown={(ev) => onAccPointerDown(ev, a.roomId, a.id, 'slide')} />
            )}

            {/* NO TEXT. The symbols carry it: a red line is a strip and a
                crosshair on a wall is a sconce, and a drawing that has to
                caption its own symbols has the wrong symbols. What the fitting
                is, why it is there and how long it runs are all in the panel,
                where there is room to say it properly. Rejected zones are drawn
                faint and listed there with their reason. */}
          </g>
        );
      })}

      {/* THE SWITCHBOARDS. Above the accents, because a board sits on the same
          wall as the sconce it feeds and the two would otherwise fight over the
          same few pixels; the board is the smaller mark and wins by being on
          top.

          A FILLED RECTANGLE, AND NOT A SYMBOL. Everything else on this drawing
          is a light and is drawn as one — a crosshair, a dotted run, a ring.
          The board is not a light: it is the thing that turns them on, it is a
          real plate of a real size, and it is drawn at that size, in plan, like
          a piece of the building rather than a piece of notation. That is also
          why it is blue and filled where the fittings are blue and stroked:
          same layer, different kind of object.

          A POLYGON RATHER THAN A ROTATED RECT, because the four corners are
          already in hand — the placement pass returns the wall's own axes with
          the point — and a transform would mean re-deriving a rotation, and its
          sign, from vectors that already say it. */}
      {layers.switchboards && switchboards.map((b) => {
        const half = b.alongPx / 2, deep = b.deepPx;
        const { along: u, inward: n, point: q } = b;
        const pt = (a, d) => `${q.x + u.x * a + n.x * d},${q.y + u.y * a + n.y * d}`;
        const poly = [pt(-half, 0), pt(half, 0), pt(half, deep), pt(-half, deep)].join(' ');
        // The selection frame: the same four corners, pushed out by a hairline
        // in the plate's OWN axes, which is why it is built from `pt` rather
        // than stroked wider or nudged with a transform — the plate is rotated
        // onto its wall, and both of those would be an offset in screen space.
        const pad = lw * 2.4;
        const ring = [pt(-half - pad, -pad), pt(half + pad, -pad),
                      pt(half + pad, deep + pad), pt(-half - pad, deep + pad)].join(' ');

        // WHEN TWO BOARDS WANT THE SAME PIECE OF WALL, THE CARD DESCRIBES BOTH.
        //
        // Not a nicety. Clashing plates are drawn at the same point, so they sit
        // exactly on top of each other and only the last one painted can be
        // hovered — which one that is comes down to array order. A card that
        // described only the board on top would leave the other one with no way
        // of being read at all, and the whole reason the clash is marked rather
        // than tidied away is that the person has to decide between them.
        //
        // So the pile is described as a pile: what each board is for, and where
        // each came from, in one card.
        const group = b.clash?.length
          ? [b, ...b.clash.map((cid) => switchboards.find((x) => x.id === cid)).filter(Boolean)]
          : [b];
        const spec = group.length > 1 ? {
          id: 'switchboard',
          label: `${group.length} switchboards, one spot`,
          // The index prefix is not decoration: two bedside boards can clash,
          // and FixtureTip keys its rows by the label.
          rows: [
            ['Plate', `${SB_MM.along} x ${SB_MM.deep} mm each`],
            ...group.map((g, i) => [
              `${g.name ?? i + 1} · ${g.servesShort || 'Board'}`,
              g.shortWhy || g.why || '',
            ]),
          ],
          note: 'They land within one plate of each other. Neither was moved, because'
            + ' both positions are rules. On site these would be ganged into one plate.',
        } : {
          /* SB7 AND NOT "SWITCHBOARD", where the caller has numbered it. The
             generic word names the class of thing and says nothing about WHICH
             one, and on a plan with nine plates the card's whole job is to tell
             you which one is under the cursor. `?? 'Switchboard'` because the
             read-only sheet and the tests hand over boards with no name. */
          id: 'switchboard', label: b.name ?? 'Switchboard',
          /* THE RULE, AND THEN HOW TO SAY NO TO IT. Every plate on this drawing
             is placed by a rule and none of them can be dragged, so `why` is the
             whole of what a board is — but two of the three rules now place a
             plate on a wall somebody may simply not want one on (see the
             facing-wall rule in electrical.js), which makes "you can take this
             one off" part of what the card has to say. It is added only where
             the plate is actually selectable: on the read-only sheet there is no
             handler and the sentence would be a lie. */
          note: [b.why || null,
                 onBoardPointerDown
                   ? 'Drag it along the walls of this space to move it; Delete removes it.'
                   : null]
            .filter(Boolean).join(' ') || null,
          rows: [
            /* HOW MANY PLATES, WHERE IT IS NOT ONE. The television wall's board
               is two plates stacked in elevation at one point in plan — see
               FACING_PLATES — so the rectangle under the cursor is one mark and
               two things to order. Saying "230 x 80 mm" and nothing else about
               it would be a plan that quietly under-counts the job. */
            (b.plates ?? 1) > 1
              ? ['Plates', `${b.plates} × ${SB_MM.along} x ${SB_MM.deep} mm, stacked`]
              : ['Plate', `${SB_MM.along} x ${SB_MM.deep} mm`],
            /* HOW HIGH IT IS SET, which is the one thing about a switchboard
               that a plan view cannot show. Both numbers where the board is two
               plates — that IS what makes it two, see SB_HEIGHT_MM — and the
               row is dropped rather than guessed for a board that carries no
               heights, which today is none of them. */
            ...(b.heightsMm?.length
              ? [['Height', `${b.heightsMm.join(' + ')} mm from floor`]] : []),
            ['Serves', b.serves || '—'],
            ...(b.turnedCorner ? [['Note', 'turned the corner — the wall ran out']] : []),
            /* THE SWING, WHICH IS NOT A `poor` AND NOT A FAULT. A board past
               the open leaf is in the RIGHT place — the rule moved it there so
               it would be reachable — but it is not where a reader looking
               300mm past the latch expects to find it, and a plate whose
               position cannot be accounted for is one somebody redraws. */
            ...(b.pastSwing ? [['Note', 'past the open leaf — the latch side is joinery']] : []),
            ...(b.poor ? [['Note', b.poor]] : []),
            /* AN OUTLET HAS NO SWITCH ON IT AND HAS TO SAY SO. It is the one
               plate on this drawing that may have none — see `placedBoards` in
               electrical.js — and a card that listed a socket and stopped would
               read as a plate somebody forgot to finish. */
            ...(b.socketOnly ? [['Note',
              'a socket on its own — its switch is on the board its wire runs to']] : []),
          ],
        };

        const picked = b.id === selBoardId;
        const flying = b.id === draggingBoardId;
        /* AN `ink` WAS HERE, AND IT WAS RED FOR AN UNWIRED PLATE. The state is
           gone rather than the colour: a plate somebody drops on a wall is a
           socket outlet and wires itself the moment it exists, so no board is
           ever sitting there unconfigured. See the note where SB_LOOSE used to
           be in electrical.js. */
        return (
          <g key={b.id} {...feel(b.id, spec)}
            /* SELECTION IS A POINTERDOWN AND NOT A CLICK, like every other
               selectable thing on this canvas, and it STOPS PROPAGATION for the
               reason the note at the top of this file gives: the root svg's own
               handler selects a space or clears the selection, and a press that
               did both would deselect the plate it had just picked.
               THE ROOM ID GOES WITH IT because the drag is confined to the walls
               of ONE space — see slideBoardTo. The board knows which room it is
               in and the caller would otherwise have to find out by hit-testing
               a polygon it has already been told the answer to. */
            onPointerDown={onBoardPointerDown
              ? (e) => { e.stopPropagation(); onBoardPointerDown(e, b.id, b.roomId); }
              : undefined}
            /* GRAB, NOT POINTER, WHERE IT CAN ACTUALLY BE MOVED. `feel` sets
               `pointer` for everything it is spread over, which is right for a
               fitting whose card is the only thing a click gets you; a plate
               slides along its walls, and the cursor is the only place that says
               so before somebody tries. Spread AFTER `feel` so this wins. */
            style={placing ? INERT.style
              : onBoardPointerDown
                ? { cursor: flying ? 'grabbing' : 'grab' }
                : { cursor: 'pointer' }}>
            {/* White under the fill, so the plan's own line work cannot show
                through a solid we are claiming is a solid. */}
            <polygon points={poly} fill="#fff" />
            <polygon className="hit" points={poly} fill={SB_COLOUR}
              stroke="#fff" strokeWidth={lw * (hot === b.id ? 2.6 : 1.4)}
              strokeLinejoin="round" />
            {/* THE FRAME THAT MEANS "THIS ONE", in the accent rather than in the
                board's blue. The plate is already a filled blue rectangle, so a
                heavier blue edge on it is not a state anybody can read; the
                accent is what selection means everywhere else on this canvas —
                see the note by `C.grip`. Drawn OUTSIDE the plate so it does not
                eat into the solid it is marking. */}
            {picked && (
              <polygon points={ring} fill="none" stroke={C.grip}
                strokeWidth={lw * 2} strokeLinejoin="round" pointerEvents="none" />
            )}
            {/* WHERE A WIRE WOULD LAND. The same frame in the same accent as
                selection, because it means the same thing at the moment it is
                shown — "this is the plate you are pointing at" — and a second
                colour for it would be a second vocabulary to learn for a mark
                that is on screen for the length of one drag. It cannot collide
                with the selection frame: selecting a wire clears the board
                selection, so nothing is ever both. */}
            {flowGrab?.overId === b.id && !picked && (
              <polygon points={ring} fill="none" stroke={C.grip}
                strokeWidth={lw * 2} strokeLinejoin="round" pointerEvents="none" />
            )}
          </g>
        );
      })}

      {/* Room names, on the same switch as the light tags: both are annotation,
          and both are in the way when what you want to see is the layout. */}
      {layers.labels && laid.length > 1 && laid.map((r) => {
        const poly = r.plan.polygonPx;
        const cx = poly.reduce((a, p) => a + p.x, 0) / poly.length;
        const cy = poly.reduce((a, p) => a + p.y, 0) / poly.length;
        return (
          <text key={'n' + r.id} x={cx} y={cy} textAnchor="middle"
            fontSize={s * 0.8} fontFamily="The Neue Montreal, sans-serif"
            fill={C.region} opacity="0.65">{r.name || 'Space'}</text>
        );
      })}

      {/* --- THE AUDIT LAYER ------------------------------------------------
          What the models decided, drawn over the plan for the person tuning
          them. Everything here was on the drawing once and was deliberately
          removed — see the two notes below — so this does not reinstate it; it
          gates it behind a role.
          
          MAGENTA, AND NOT THE ACCENT. Every other mark on this canvas obeys the
          ink-and-one-blue rule, and the whole point of this layer is that it is
          NOT part of the drawing: it has to be unmistakable at a glance, and it
          has to be obvious in a screenshot that what is being looked at is
          working rather than a sheet. A hue that appears nowhere else does both.
          It is the only place in this app where that is the right answer. */}
      {audit && (
        <g className="audit">
          {/* THE BEDS ARE NOT DRAWN HERE ANY MORE, and the reason is a
              consequence of this overlay's default rather than a change of mind
              about the beds.
              They used to be the argument FOR the overlay: the planner obeys a
              bed — a downlight never lands over a mattress — but `drawnZones`
              deliberately excludes them, so a wrong bed is invisible except as
              a hole in the grid. Worth a magenta box while you are opening the
              overlay on purpose to check one.
              Now that it opens by default, they are a magenta box round the bed
              on every plan, every time, next to the fittings they pushed out of
              the way — and the thing the overlay is now open FOR is the lit task
              surfaces. So the beds come off and the switch keeps its other two
              readings. Their counts are still in the admin panel, which is where
              a number belongs when the drawing does not need the shape; the
              zones themselves still reach the planner through `zoneList`,
              entirely unaffected. */}
          {/* The task surfaces, with the box the detector marked. The spot that
              came out of it is already on the drawing; this is the evidence
              behind it.

              LIT IN THE BEAM'S OWN PAINT, AND NOT ONE MARK OF MAGENTA LEFT.
              The fill is the accent ramp — the same stops the floor pools use,
              laid flat rather than radial; see `lp-lit` in the defs for why the
              radial one donuts on a rectangle. The dashed edge and the caption
              are the accent too, so a task surface now reads entirely as
              lighting: "the spot above this is FOR this", said in one colour,
              which is the question the mark exists to answer. It used to say
              only that a model had noticed a table.

              THIS SPENDS THE OPERATOR HUE ON THIS ONE OVERLAY, deliberately and
              on instruction. #C026D3 means exactly one thing everywhere else in
              this app — see the note in styles.css — and it is "you are looking
              at a reading, not at the design". The task surfaces no longer say
              that, so the only thing marking them as working is the DASHED edge
              against the solid line work of everything real. The beds and the
              wall cells beside them keep the magenta and keep saying it.
              WHAT TO WATCH, since this overlay now defaults to ON and nothing
              strips it out of the PNG or SVG: a lit rectangle on an exported
              sheet is no longer self-evidently ours-by-mistake. It is a dashed
              amber box round the dining table, which reads as something drawn on
              purpose.

              A REJECTED SURFACE STILL DIMS TO 0.35 on the group, so it is lit
              faintly rather than not at all: the detector found it and the
              placer turned it down, and both halves of that are the point. */}
          {surfaces.map((sf) => {
            if (!sf.rect) return null;
            const r = sf.rect;
            return (
              <g key={'as' + sf.id} opacity={sf.rejected ? 0.35 : 1}>
                <rect x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0}
                  fill="url(#lp-lit)" fillOpacity={THROW_STYLE.litSurfaceOpacity}
                  stroke={C.lit} strokeOpacity="0.75"
                  strokeWidth={lw * 1.6} strokeDasharray={`${lw * 6} ${lw * 3}`} />
                <text x={r.x0 + lw * 3} y={r.y0 - lw * 2} fill={C.lit}
                  fontSize={Math.max(width, height) / 130} fontFamily="The Neue Montreal, sans-serif">
                  {sf.label || sf.type || 'surface'}{sf.rejected ? ' (rejected)' : ''}
                </text>
              </g>
            );
          })}
        </g>
      )}

      {/* --- THE BEDS THE DETECTOR FOUND -------------------------------------
          BACK ON THE DRAWING, AND ON A SWITCH OF THEIR OWN. They used to be
          part of the general audit overlay and came off it when that overlay
          started opening by default: a magenta box round the bed on every plan,
          every time, next to the fittings it had pushed out of the way. The
          reasoning for drawing them at all never went away, and it is the
          strongest of any mark on this canvas — the planner OBEYS a bed (a
          downlight never lands over a mattress) while `drawnZones` deliberately
          excludes it, so a bed in the wrong place is invisible except as an
          unexplained hole in the grid. Its own checkbox is what that wants: off
          by default, on while somebody is asking why a room came out like this.

          THE OPERATOR HUE, like the doors and the wall cells. #C026D3 appears
          nowhere in the design, which is the whole of what it says: you are
          looking at a reading, not at the drawing. The task surfaces above gave
          it up because a lit surface genuinely is about lighting; a bed box is
          not, and it keeps it.

          THE SOURCE IS ON THE CAPTION because two different passes put beds on
          this plan — the whole-sheet detector and the GPT bedroom crop — and
          "which one found this" is the first question asked of a bed that is
          wrong. `cls` where a zone carries no source is the honest fallback.

          `pointerEvents="none"`, like every audit group: it is drawn over the
          room and there is nothing here to click. */}
      {bedBoxes.length > 0 && (
        <g className="audit" pointerEvents="none">
          {bedBoxes.map((z) => (
            <g key={'bed' + z.id}>
              <rect x={z.x0} y={z.y0} width={z.x1 - z.x0} height={z.y1 - z.y0}
                fill="#C026D3" fillOpacity="0.06" stroke="#C026D3"
                strokeWidth={lw * 1.8} strokeDasharray={`${lw * 6} ${lw * 4}`} />
              <text x={z.x0 + lw * 3} y={z.y0 - lw * 2} fill="#C026D3"
                fontSize={Math.max(width, height) / 130} fontFamily="The Neue Montreal, sans-serif">
                {z.cls || 'bed'}
                {z.source && z.source !== 'detected' ? ` · ${z.source}` : ''}
                {Number.isFinite(z.confidence) ? ` · ${z.confidence.toFixed(2)}` : ''}
              </text>
            </g>
          ))}
        </g>
      )}

      {/* --- THE DOORS THE DETECTOR FOUND ------------------------------------
          Same magenta, same "this is working, not a sheet" idiom as the layer
          above, on its own toggle.

          THE REJECTED ONES ARE THE POINT, and they are why this is not just a
          debug print. A door that was found is visible in its consequence — the
          scale is right, the dimensions read true. A door that was REFUSED is
          invisible everywhere: the drawing looks the same, it just quietly had
          one fewer candidate to measure with. When the detector misses the only
          door on a plan, the reason it gave is the whole diagnosis, so it is
          drawn where the box was rather than counted in a panel.

          Rejects go down FIRST so a kept door sits on top of one it overlaps —
          which is exactly the case worth looking at, since that is what the
          de-dup pass just did. */}
      {auditDoors && (
        <g className="audit" pointerEvents="none">
          {doorRejects.map((d, i) => d.rect && (
            <g key={'dr' + i} opacity="0.45">
              <rect x={d.rect.x0} y={d.rect.y0}
                width={d.rect.x1 - d.rect.x0} height={d.rect.y1 - d.rect.y0}
                fill="none" stroke="#C026D3" strokeWidth={lw * 1.2}
                strokeDasharray={`${lw * 2} ${lw * 3}`} />
              <text x={d.rect.x0 + lw * 3} y={d.rect.y1 + Math.max(width, height) / 120} fill="#C026D3"
                fontSize={Math.max(width, height) / 150} fontFamily="The Neue Montreal, sans-serif">
                {(d.reason || 'rejected').slice(0, 44)}
              </text>
            </g>
          ))}
          {doorBoxes.map((d) => {
            // THE ONE THAT SET THE SCALE, drawn heavier. Out of every box here
            // exactly one is load-bearing: the door the user named a width for.
            // `typical` is only the one this pass OFFERED as that ruler — the
            // median opening — and the two are different claims worth telling
            // apart when a plan comes out at half size.
            const ruler = d.id === doorPickId;
            const mm = pxPerFt > 0 ? doorWidthAt(d.rect, pxPerFt) : null;
            return (
              <g key={'dk' + d.id}>
                <rect x={d.rect.x0} y={d.rect.y0}
                  width={d.rect.x1 - d.rect.x0} height={d.rect.y1 - d.rect.y0}
                  fill="#C026D3" fillOpacity={ruler ? 0.12 : 0.05} stroke="#C026D3"
                  strokeWidth={lw * (ruler ? 2.8 : 1.6)}
                  strokeDasharray={ruler ? undefined : `${lw * 5} ${lw * 3}`} />
                {/* The opening itself — the shorter side, which is the number
                    the scale is actually derived from. Drawn as a bar across
                    the box so a box that got its short side from a frame or a
                    neighbouring wall is visible as one. */}
                <line
                  x1={d.rect.x0} y1={d.rect.y1 + lw * 2}
                  x2={d.rect.x0 + d.openingPx} y2={d.rect.y1 + lw * 2}
                  stroke="#C026D3" strokeWidth={lw * 2} />
                <text x={d.rect.x0 + lw * 3} y={d.rect.y0 - lw * 2} fill="#C026D3"
                  fontSize={Math.max(width, height) / 130} fontFamily="The Neue Montreal, sans-serif">
                  {ruler ? 'the ruler · ' : d.typical ? 'typical · ' : ''}
                  {d.openingPx.toFixed(0)}px
                  {mm ? ` · ${mm.toFixed(0)}mm` : ''}
                  {` · ${(d.conf ?? 1).toFixed(2)}`}
                </text>
              </g>
            );
          })}
        </g>
      )}

      {/* --- task surfaces: FOUND, AND NO LONGER DRAWN -----------------------
          They were a dashed box with corner ticks — a reading of the plan, put
          on screen so the reading could be judged before anything was built on
          it. That was the right call while the surface detector was the thing
          being debugged. On a finished layout it is a box around a dining table
          saying "we noticed the dining table", drawn over the drawing that
          already shows one, and the fitting it justifies is three feet away
          with its own arrow pointing at it. The spot IS the visible consequence
          of the surface; the surface itself is working, and working belongs in
          the console. `surfaces` is still a prop and still feeds the spots. */}

      {/* --- the secondary grid: REASONING, AND NOT ON THE DRAWING -----------
          The lines a spot was placed on. It was already off by default and in
          the layer list for the times a spot lands somewhere surprising; with
          the surfaces themselves gone from the canvas it is the last piece of
          the spot placer's working still able to appear on a client's sheet, so
          it goes the same way. `sp.grid` is still computed and still in the
          console, which is where working belongs. */}

      {/* --- directional spots -----------------------------------------------
          THE SAME BLUE AS THE AMBIENT DOWNLIGHTS, because it is the same kind
          of thing: a fitting in this ceiling. What makes it a task light is
          that it is AIMED, and the arrow is the whole of that — it points at
          the centre of the surface the spot was placed for, so the drawing says
          not just where the fitting goes but what it is for.

          Drawn above the surfaces and below nothing, since it is the one mark
          on this layer that somebody will order a fitting from. */}
      {layers.spots && taskSpots.map((sp) => {
        if (sp.rejected) return null;
        const R = Math.max((pxPerFt || 12) * 0.3, lw * 3);
        const ux = Math.cos(sp.angle), uy = Math.sin(sp.angle);
        // --- A DIRECTIONAL HEAD ON A TRACK -------------------------------
        //
        // A BODY WITH A LENGTH, LIKE THE AMBIENT HEAD AND FOR THE SAME REASON:
        // it is a 150 mm cylinder that clips onto a profile, not a recessed
        // spot, and its length is what decides how much of a run it occupies.
        // Drawn to size — see `inch` at the top of this file.
        //
        // AND IT IS THE ONE FITTING ON THIS SHEET THAT ALREADY HAD A DIRECTION.
        // The arrow has always pointed at what the spot is for; the body was a
        // circle, so the direction lived entirely in the arrow. A cylinder can
        // carry it too, so it does: the body lies ALONG the aim with its lens at
        // the far end, and the drawing says which way the fitting is turned as
        // well as which way it is looking.
        const onTrack = !!sp.track;
        const bodyLen = inch(TRACK_DIMS_IN.spot.len);
        const bodyWide = inch(TRACK_DIMS_IN.spot.wide);
        // The arrow leaves the fitting where the fitting ends. On a circle that
        // is the rim; on a cylinder it is the nose, half a body-length out.
        const off = onTrack ? bodyLen / 2 + inch(0.6) : R * 1.15;
        // THE BODY IS DRAWN TO SIZE; THE ARROW IS NOT, AND THAT IS THE LINE
        // BETWEEN THE TWO KINDS OF MARK ON THIS SHEET. The cylinder is an
        // OBJECT — six inches of it, measurable off the drawing. The arrow is an
        // ANNOTATION: it says what the fitting is for, it is read at the same
        // size everywhere on the sheet, and scaling it to a six-inch body would
        // shrink the one mark whose whole job is to be noticed. So it keeps the
        // length and the head it has always had, and only its START moves out to
        // the nose of the body.
        const reach = onTrack ? off + R * 2.35 : R * 3.5;
        const x0 = sp.x + ux * off, y0 = sp.y + uy * off;
        const x1 = sp.x + ux * reach, y1 = sp.y + uy * reach;
        const head = R * 1.05;
        const nx = -uy, ny = ux;
        // WHAT IT IS LIGHTING, ON HOVER. The task surfaces came off the drawing
        // because a dashed box round a dining table is working, not design —
        // but the question "why is this spot here, and aimed at what" is a fair
        // one to ask of any fitting, and the arrow alone answers only half of
        // it. Under the pointer is the right moment: it is asked about one
        // fitting at a time, and it costs the sheet nothing the rest of the
        // time.
        //
        // `sp.highlight` IS THE RECT, whatever the spot is aimed at. It used to
        // look the surface up by id, which worked while a task surface was the
        // only thing a spot could point at — an art spot points at a slice of a
        // wall element, which is in a different list entirely, and would have
        // hovered as nothing at all. The spot carries what it is lighting, so
        // this does not have to know how many kinds of target exist.
        const hl = hot === sp.id
          ? (sp.highlight ?? surfaces.find((sf) => sf.id === sp.surfaceId)?.rect ?? null)
          : null;
        const spotSel = sp.id === selSpotId;
        // The selection ring's own size, CONSTANT ON SCREEN like every other
        // control on this canvas — see the ceiling-object handles. A ring drawn
        // in drawing units would vanish at low zoom on the one fitting somebody
        // is trying to confirm they have hold of.
        // ...and again for the spot's ring: `SR` is a radius, `SFW` a weight.
        const SR = Math.max(R * 2.1, (Math.max(width, height) / 150) / (zoom || 1));
        const SFW = Math.max(width, height) / 1400;
        return (
          // THE SAME SYMBOL FOR BOTH, deliberately. A spot aimed at a painting
          // and one aimed at a desk are the same fitting in the same ceiling and
          // an installer sets them out identically; inventing a second glyph
          // would say they are different things on site, which they are not.
          // What differs is the OPTIC, and that is a specification rather than a
          // drawing — so it is on the hover card and on the schedule, which is
          // where specifications belong. `sp.fixture` names the catalogue line.
          //
          // THE WHOLE GROUP TAKES THE CLICK, not the body alone, and the body is
          // six inches of ceiling: at any sensible zoom that is a few pixels, and
          // a fitting you have to hit within two pixels to select is one nobody
          // will select. The hit shapes inside — the capsule's rect, the recessed
          // circle — are what the pointer actually lands on, and the arrow and
          // the ring come with them.
          <g key={sp.id} {...feel(sp.id, specsFor(sp.fixture || 'spot'))}
            onPointerDown={onSpotPointerDown
              ? (ev) => onSpotPointerDown(ev, sp.id) : undefined}>
            {/* PICKED. A ring around the fitting and nothing else: a spot has no
                grips, because there is nothing about one to drag — where it
                stands is a consequence of what it lights (see spotPointerDown in
                App.jsx). So the ring's only job is to say "this is the one the
                Delete key will take", and it says it in the control colour that
                means selection everywhere else on this canvas. */}
            {spotSel && (
              <circle cx={sp.x} cy={sp.y} r={SR} fill="none"
                stroke={C.sel} strokeWidth={SFW * 1.6}
                strokeDasharray={`${SFW * 5} ${SFW * 3.5}`} pointerEvents="none" />
            )}
            {hl && (
              <g pointerEvents="none">
                <rect x={hl.x0} y={hl.y0}
                  width={hl.x1 - hl.x0} height={hl.y1 - hl.y0}
                  rx={lw * 2} fill={C.lit} fillOpacity="0.10"
                  stroke={C.lit} strokeWidth={lw * 1.4} strokeOpacity="0.55"
                  strokeDasharray={`${lw * 5} ${lw * 4}`} />
                {/* The line from the fitting to what it is for. The arrow
                    already points this way; the tether says how far. */}
                <line x1={sp.x} y1={sp.y} x2={sp.target.x} y2={sp.target.y}
                  stroke={C.lit} strokeWidth={lw} strokeOpacity="0.4"
                  strokeDasharray={`${lw * 2} ${lw * 3}`} />
              </g>
            )}
            {/* WHERE THE PLACER PUT IT, before a track took it. Same tether,
                same switch and same argument as the ambient lights': the move is
                perpendicular and under three feet, and this is how somebody
                checks that rather than taking it on trust. */}
            {layers.labels && sp.gridPx && (
              <g opacity="0.45" pointerEvents="none">
                <line x1={sp.gridPx.x} y1={sp.gridPx.y} x2={sp.x} y2={sp.y}
                  stroke={rim} strokeWidth={lw}
                  strokeDasharray={`${lw * 2} ${lw * 2}`} />
                <circle cx={sp.gridPx.x} cy={sp.gridPx.y} r={lw * 1.4}
                  fill="none" stroke={rim} strokeWidth={lw} />
              </g>
            )}
            <ellipse cx={sp.x} cy={sp.y}
              rx={onTrack ? bodyLen / 2 + inch(2.4) : R * 2.4}
              ry={onTrack ? bodyWide / 2 + inch(2.4) : R * 2.4}
              transform={onTrack
                ? `rotate(${(sp.angle * 180) / Math.PI} ${sp.x} ${sp.y})` : undefined}
              fill="url(#lp-glow)" className="lp-pulse" pointerEvents="none"
              style={{ animationDelay: `${((sp.x | 0) % 1000) / 1000 * -2.8}s` }} />
            {onTrack ? (
              <g transform={`rotate(${(sp.angle * 180) / Math.PI} ${sp.x} ${sp.y})`}>
                {/* A wider, invisible target — see the profile's `grab`. */}
                <rect className="hit" x={sp.x - bodyLen / 2} y={sp.y - Math.max(bodyWide, lw * 9) / 2}
                  width={bodyLen} height={Math.max(bodyWide, lw * 9)} fill="transparent" />
                {/* THE CYLINDER, AS A CAPSULE. `rx` at half the width is what
                    makes the ends round rather than square, which is the
                    difference between a cylinder seen from below and a second
                    ambient head — and those two must never be confused, because
                    one of them is aimed.
                    
                    SOLID, WHERE THE AMBIENT HEAD IS WHITE, and that inversion is
                    the drawing doing what the product does. A track spot is a
                    dark body with a bright lens in its nose; an ambient head is a
                    lit panel the length of its module. Filling this white too
                    would have put the two on the same footing at a scale where
                    the only difference left is a rounded corner — and it would
                    have cost the lens its contrast, because a 1.5 in body is
                    five pixels on a large plan and there is not room for a white
                    shape inside a white shape. */}
                <rect x={sp.x - bodyLen / 2} y={sp.y - bodyWide / 2}
                  width={bodyLen} height={bodyWide}
                  rx={bodyWide / 2} ry={bodyWide / 2}
                  fill="url(#lp-core)" stroke={rim}
                  strokeWidth={lw * (hot === sp.id ? 2.4 : 0.7)} pointerEvents="none" />
                {/* THE LENS, IN THE NOSE. Centred on the capsule's own end
                    radius, so it reads as the round end of the cylinder being
                    the thing that emits — which is what you see looking up at
                    one. Wider across the body than along it, because a round
                    aperture on a head tilted off vertical is an ellipse, and
                    because an ellipse points and a circle does not: this is what
                    says which way the fitting is turned with the arrow layer
                    switched off. */}
                <ellipse cx={sp.x + bodyLen / 2 - bodyWide / 2} cy={sp.y}
                  rx={bodyWide * 0.31} ry={bodyWide * 0.47}
                  fill="url(#lp-core)" stroke={rim}
                  strokeWidth={lw * (hot === sp.id ? 2.2 : 1.1)} pointerEvents="none" />
              </g>
            ) : (
              <>
                {/* NOT ONE MARK OF AMBER LEFT ON A SPOT. The body is the
                    accent ramp and the ring is the ramp's rim tone, so the
                    whole symbol is cut from one gradient.
                    THE CENTRE DOT IS GONE, and that is the part worth
                    recording. It was a solid disc of #ffb900 at 0.4R — the most
                    saturated thing on the fitting, sitting exactly where the
                    ramp is brightest, so it covered the bright core and put
                    back the one colour this was removing. Its job was to read
                    as the lamp inside a WHITE body, and a lit ramp does that
                    job by itself: the bright middle IS the aperture now. What
                    still separates a spot from a downlight is what always
                    separated them — the arrow. */}
                <circle className="hit" cx={sp.x} cy={sp.y} r={R} fill="url(#lp-core)"
                  stroke={rim} strokeWidth={lw * (hot === sp.id ? 3.4 : 2)} />
              </>
            )}
            <line x1={x0} y1={y0} x2={x1} y2={y1}
              stroke={rim} strokeWidth={lw * 1.9} strokeLinecap="round" />
            <path d={`M${x1},${y1} L${x1 - ux * head + nx * head * 0.55},${y1 - uy * head + ny * head * 0.55}`
                   + ` L${x1 - ux * head - nx * head * 0.55},${y1 - uy * head - ny * head * 0.55} Z`}
              fill={rim} />
          </g>
        );
      })}

      {/* --- alignment guides ------------------------------------------------
          Momentary: they exist only while something is being dragged or
          placed, which is the only time they mean anything. A guide that
          stayed on screen would be a drawn line, and there are enough of
          those.

          Each one stops at the thing it came from rather than running the full
          width of the sheet — a line that ends at the room it is about is a
          line that says which room it is about. */}
      {guides.map((g, i) => {
        const l = guideLine(g, Math.max(width, height) * 0.012);
        return (
          <g key={'gd' + i}>
            <line {...l} stroke={C.guide} strokeWidth={lw * 1.1}
              strokeDasharray={`${lw * 6} ${lw * 4}`} opacity="0.9" />
            {layers.labels && (
              <text x={g.axis === 'x' ? g.value + lw * 4 : l.x1 + lw * 4}
                y={g.axis === 'x' ? l.y1 + lw * 10 : g.value - lw * 4}
                fontSize={Math.max(width, height) / 130}
                fontFamily="The Neue Montreal, sans-serif" fill={C.guide} opacity="0.85">
                {g.label}
              </text>
            )}
          </g>
        );
      })}

      {/* Where an armed object would land. Shown before the click, because that
          is when it is still useful to know. */}
      {ghost && pxPerFt && (() => {
        const t = CEILING_BY_ID[ghost.typeId];
        if (!t) return null;
        // THE GHOST TAKES THE PLACED OBJECT'S INK, NOT THE TYPE'S OWN `colour`.
        //
        // Every entry in the catalogue carries `colour: '#404040'` — near black
        // — and this preview was the only thing that read it. That was fine on a
        // white scan and invisible the moment the plan was inverted: dark grey
        // at 0.55 opacity on a black ground is nothing, so arming an object and
        // moving onto the plan in night mode showed no object at all. It looked
        // like the tool had failed to arm.
        //
        // SO IT MIRRORS THE RULE THE PLACED OBJECT USES, exactly — see the long
        // note by `col` in the fansPx block. A preview drawn in a colour the
        // click will not produce is a small lie about the gesture, which is the
        // same argument the sconce ghost's ground already makes; and matching it
        // fixes the invisibility for free, because that rule is the one that
        // knows about the ground.
        //
        // `colour` IS NOW UNREAD. It is left in ceilingObjects.js rather than
        // deleted — it is a data field on a catalogue that gets serialised, and
        // dropping it is a change to saved plans for no gain — but nothing paints
        // with it any more, so do not reach for it expecting it to matter.
        const round = !isRect(t);
        const col = round && layers.invert ? C.object : C.lit;
        const r = (isRect(t) ? Math.hypot(t.wFt, t.hFt) / 2 : (t.diaFt || 0) / 2) * pxPerFt;
        return (
          <g opacity="0.55">
            {isRect(t) ? (
              <rect x={ghost.x - (t.wFt * pxPerFt) / 2 - clearanceFt * pxPerFt}
                y={ghost.y - (t.hFt * pxPerFt) / 2 - clearanceFt * pxPerFt}
                width={t.wFt * pxPerFt + clearanceFt * pxPerFt * 2}
                height={t.hFt * pxPerFt + clearanceFt * pxPerFt * 2}
                rx={clearanceFt * pxPerFt} ry={clearanceFt * pxPerFt}
                fill="none" stroke={col} strokeWidth={lw * 1.2}
                strokeDasharray={`${lw * 4} ${lw * 4}`} />
            ) : (
              <circle cx={ghost.x} cy={ghost.y} r={r + clearanceFt * pxPerFt} fill="none"
                stroke={col} strokeWidth={lw * 1.2} strokeDasharray={`${lw * 4} ${lw * 4}`} />
            )}
            {isRect(t) ? (
              <rect x={ghost.x - (t.wFt * pxPerFt) / 2} y={ghost.y - (t.hFt * pxPerFt) / 2}
                width={t.wFt * pxPerFt} height={t.hFt * pxPerFt}
                fill={col} fillOpacity="0.1" stroke={col} strokeWidth={lw * 1.4} />
            ) : (
              <circle cx={ghost.x} cy={ghost.y} r={r * 0.6} fill={col} fillOpacity="0.1"
                stroke={col} strokeWidth={lw * 1.4} />
            )}
            <line x1={ghost.x - r * 0.3} y1={ghost.y} x2={ghost.x + r * 0.3} y2={ghost.y}
              stroke={col} strokeWidth={lw} />
            <line x1={ghost.x} y1={ghost.y - r * 0.3} x2={ghost.x} y2={ghost.y + r * 0.3}
              stroke={col} strokeWidth={lw} />
          </g>
        );
      })()}

      {/* THE RUN BEING SPANNED. Between the strip tool's first click and its
          second there is a fitting that has a start and no end, and the only
          place that fact can live is on the drawing. Drawn in the strip's own
          dotted idiom rather than as a plain rubber band, so what you are
          dragging out looks like what you will get — and with the length beside
          it, because "is that long enough for the wardrobe" is the question
          being answered in that second. */}
      {draftRun && (() => {
        const [a, b] = draftRun;
        const L = Math.hypot(b.x - a.x, b.y - a.y);
        return (
          <g pointerEvents="none">
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={C.lit} strokeWidth={lw * 4.8} strokeLinecap="round"
              strokeDasharray={`${lw * 3.2} ${lw * 3.4}`} opacity="0.75" />
            <circle cx={a.x} cy={a.y} r={lw * 3.4} fill={C.lit} />
            {pxPerFt > 0 && L > lw * 8 && (
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - lw * 8}
                fontSize={Math.max(width, height) / 120} textAnchor="middle"
                fontFamily="The Neue Montreal, sans-serif" fill={C.lit}>
                {(L / pxPerFt).toFixed(1)} ft
              </text>
            )}
          </g>
        );
      })()}

      {/* --- WHAT A CLICK WOULD DO, while a fitting is being placed ---------
          Drawn last, over everything, because it is the answer to a question
          being asked right now and it stops existing the moment it is answered.

          THE SNAP INDICATOR IS THE SAME PROMISE THE TRACER MAKES. A run placed
          a hair off the wall it is concealed behind is as wrong as an outline
          corner placed a hair off, so the cursor holds on to the same geometry
          — and having caught something, it has to SAY so, or a click that
          quietly moved four inches looks like a misclick. */}
      {placeSnap && placeSnap.kind && placeSnap.kind !== 'free' && (() => {
        const R = Math.max(width, height) / 190;
        return (
          <g pointerEvents="none">
            {placeSnap.guide && (
              <line
                x1={placeSnap.guide.from.x} y1={placeSnap.guide.from.y}
                x2={placeSnap.guide.axis === 'x' ? placeSnap.x : placeSnap.guide.from.x}
                y2={placeSnap.guide.axis === 'x' ? placeSnap.guide.from.y : placeSnap.y}
                stroke={C.guide} strokeWidth={lw} opacity="0.9"
                strokeDasharray={`${lw * 3} ${lw * 3}`} />
            )}
            {/* A DIAMOND FOR AN EDGE, A SQUARE FOR AN END, A RING OTHERWISE —
                the tracer's alphabet, because "it snapped" is not the useful
                information and WHAT it snapped to is. */}
            {placeSnap.kind === 'edge' ? (
              /* A diamond: the square offset onto its own centre, then turned
                 about that same point. Rotating about the rect's x/y instead
                 swings it a half-width off the snap it is supposed to mark. */
              <rect x={placeSnap.x - R / 2} y={placeSnap.y - R / 2} width={R} height={R}
                transform={`rotate(45 ${placeSnap.x} ${placeSnap.y})`}
                fill="#fff" stroke={C.guide} strokeWidth={lw * 1.6} />
            ) : (placeSnap.kind === 'end' || placeSnap.kind === 'vertex') ? (
              <rect x={placeSnap.x - R / 2} y={placeSnap.y - R / 2} width={R} height={R}
                fill="#fff" stroke={C.guide} strokeWidth={lw * 1.6} />
            ) : (
              <circle cx={placeSnap.x} cy={placeSnap.y} r={R * 0.6}
                fill="#fff" stroke={C.guide} strokeWidth={lw * 1.6} />
            )}
          </g>
        );
      })()}

      {/* THE SCONCE, BEFORE IT IS PLACED. Not a marker at the cursor: the whole
          point of this fitting is that it seats itself on a wall, so a preview
          at the pointer would show something that is never what lands. This is
          the output of `placeZone` — the same function the click runs — drawn
          faint, so what you see move along the wall as the pointer moves IS the
          fitting. */}
      {sconceGhost && (() => {
        const R = Math.max((pxPerFt || 12) * 0.3, lw * 3);
        const { x: ix, y: iy } = sconceGhost.inward;
        const ux = sconceGhost.along?.x ?? -iy, uy = sconceGhost.along?.y ?? ix;
        const cx = sconceGhost.point.x + ix * R * 2.6;
        const cy = sconceGhost.point.y + iy * R * 2.6;
        const arm = R * 1.7;
        return (
          <g pointerEvents="none" opacity="0.55">
            {sconceGhost.wall && (
              <line x1={sconceGhost.wall.a.x} y1={sconceGhost.wall.a.y}
                x2={sconceGhost.wall.b.x} y2={sconceGhost.wall.b.y}
                stroke={C.guide} strokeWidth={lw} opacity="0.7"
                strokeDasharray={`${lw * 4} ${lw * 4}`} />
            )}
            {/* THE GHOST TAKES THE SAME GROUND AS THE REAL THING. It previews
                what the click is about to place, so a white-bodied preview of a
                lit-bodied fitting would be a small lie about the gesture. */}
            <circle cx={cx} cy={cy} r={R} fill="url(#lp-core)" />
            {/* AND THE GHOST'S LINE WORK MATCHES THE PLACED FITTING'S, for the
                same reason its ground does: a preview drawn in a colour the
                click will not produce is a small lie about the gesture. */}
            <g stroke={rim} strokeWidth={lw * 1.8} strokeLinecap="round">
              <line x1={sconceGhost.point.x} y1={sconceGhost.point.y}
                x2={cx + ix * arm} y2={cy + iy * arm} />
              <line x1={cx - ux * arm} y1={cy - uy * arm}
                x2={cx + ux * arm} y2={cy + uy * arm} />
            </g>
            <circle cx={cx} cy={cy} r={R} fill="none"
              stroke={rim} strokeWidth={lw * 2.1} />
          </g>
        );
      })()}


      {/* --- COVES SOMEBODY DREW -------------------------------------------
          OVER THE FITTINGS AND UNDER THE PILL, which is where a selectable
          object belongs: the grab has to beat a downlight that happens to be
          under the pointer, and it must not beat a control.

          A BAND ALONG THE OUTLINE, NOT THE WHOLE INTERIOR, and this is the one
          place a drawn cove parts company with the cove line drawn one layer up.
          That line takes its whole interior because it has to: a chunk carried
          by its strip alone has no downlight left to click, so the rectangle is
          the only mark the design left and it must be reliably hittable. It can
          afford to, too — it is painted BEFORE the fittings, so a light inside
          it still takes the press.

          This layer is painted AFTER them, because a selectable object has to
          beat a downlight that happens to be under the pointer. An interior
          target here would therefore swallow every click inside the cove: the
          lights, the fan in the middle of it, the ceiling objects, the accent
          runs — a twenty-foot hole in the drawing where nothing can be touched.

          So it takes the TRACK PROFILE's answer instead, for the track's own
          reason: there is always something better to click inside, so the thing
          itself is grabbed by its line. `pointer-events: stroke` on a
          transparent stroke eight line-weights wide is a band you can hit
          without aiming, and it scales with the sheet like every other weight
          here.

          TWO BANDS AND NOT ONE: the setting-out line, and the tape three inches
          outside it. They are one object to anybody looking at the sheet, so
          both have to answer the press — see `tape` in coveShapesPx. */}
      {(coveShapes.length > 0 || draftShape || penDraft) && (() => {
        const path = (pts) =>
          pts.map((q, i) => `${i ? 'L' : 'M'}${q.x},${q.y}`).join(' ') + ' Z';
        // WHITE WHERE WHITE READS, following the cove line and the ceiling
        // objects rather than inventing a third answer. See the note by `col`
        // in the fansPx block.
        const ink = layers.invert ? C.object : rim;
        const dot = `${lw} ${lw * 3}`;
        return (
          <g>
            {coveShapes.map((sh) => (
              <g key={sh.id}>
                {/* A SHAPE THE LAYOUT DID NOT TAKE UP still has to be visible,
                    or committing one over an unlit space would look like the
                    tick having thrown it away. Drawn as the setting-out line it
                    will become the moment the space is lit. */}
                {!sh.lit && (
                  <path d={path(sh.pts)} fill="none" stroke={ink} strokeWidth={lw}
                    strokeDasharray={dot} strokeLinecap="round" strokeLinejoin="round"
                    opacity="0.55" pointerEvents="none" />
                )}
                {selShapeId === sh.id && (
                  <path d={path(sh.pts)} fill="none" stroke={C.lit}
                    strokeWidth={lw * 2.2} strokeLinejoin="round"
                    opacity="0.95" pointerEvents="none" />
                )}
                {onShapePointerDown && [sh.pts, sh.tape].filter(Boolean).map((band, i) => (
                  <path key={i} className="hit" d={path(band)} fill="none"
                    stroke="transparent" strokeWidth={Math.max(lw * 8, 6)}
                    strokeLinejoin="round"
                    style={{ pointerEvents: 'stroke', cursor: 'move' }}
                    onPointerDown={(e) => onShapePointerDown(e, sh.id)}
                    /* AND THE CLICK IS STOPPED TOO, WHICH IS NOT THE SAME ACT
                       AS STOPPING THE PRESS AND WAS THE BUG. A click is its own
                       event: `stopPropagation` on `pointerdown` does nothing to
                       the `click` the browser synthesises after the release, so
                       it bubbled to the canvas's own handler, which reads "a
                       click on empty plan" and clears the selection. The shape
                       was being selected and deselected by one press, forty
                       milliseconds apart, which looks exactly like a shape that
                       cannot be selected at all.
                       The cove line above stops its click for the same reason;
                       every control on this canvas has to stop both. */
                    onClick={(e) => e.stopPropagation()} />
                ))}
                {/* THE GRIPS ARE PAINTED LAST, WHICH IS LOAD-BEARING RATHER
                    THAN TIDY. On a rectangle the frame and the outline are the
                    same four lines, so every corner grip sits directly under
                    the grab band that follows that outline — and later paint
                    takes the press. Drawn before it, a grip would be visible,
                    would show its resize cursor, and would hand every press to
                    the band underneath: the shape would move instead of
                    resizing, which is the one failure that looks like the
                    feature not existing. */}
                {shapeEditId === sh.id && sh.frame && (() => {
                  /* --- THE FRAME AND ITS GRIPS -----------------------------
                     THE BOX AND NOT THE OUTLINE, and on a circle or a triangle
                     the two are visibly different — which is the honest
                     picture. A resize acts on the box: the grips move its
                     sides, and the shape is refitted into whatever box they
                     leave. Drawing them on the outline instead would put a
                     corner grip in mid-air beside a curve and claim you were
                     dragging the curve.
                     IT IS ALSO THE BOX THE GRID IS CUT ON — see coveRectFt —
                     so the frame is telling you the other true thing about a
                     drawn cove at the moment you are changing its size.
                     THE GRIPS ARE WHITE SQUARES WITH A DARK EDGE, which is what
                     a handle looks like in every editor anybody has used, and
                     is deliberately not the accent: the accent on this canvas
                     means "this emits light", and a grip does not. */
                  const F = sh.frame;
                  const R = Math.max(lw * 3, 3);
                  const at = (h) => ({
                    x: h.sx > 0 ? F.x1 : h.sx < 0 ? F.x0 : (F.x0 + F.x1) / 2,
                    y: h.sy > 0 ? F.y1 : h.sy < 0 ? F.y0 : (F.y0 + F.y1) / 2,
                  });
                  // The cursor a grip offers is the axis it moves, which is the
                  // only wordless way to say what an edge grip does differently
                  // from the corner beside it.
                  const cur = (h) => (h.sx && h.sy
                    ? (h.sx === h.sy ? 'nwse-resize' : 'nesw-resize')
                    : h.sx ? 'ew-resize' : 'ns-resize');
                  return (
                    <g>
                      <rect x={F.x0} y={F.y0} width={F.x1 - F.x0} height={F.y1 - F.y0}
                        fill="none" stroke={C.lit} strokeWidth={lw}
                        strokeDasharray={`${lw * 4} ${lw * 3}`}
                        opacity="0.75" pointerEvents="none" />
                      {(sh.handles ?? []).map((h, i) => {
                        const q = at(h);
                        return (
                          <rect key={i} className={onShapeHandleDown ? 'hit' : undefined}
                            x={q.x - R} y={q.y - R} width={R * 2} height={R * 2}
                            fill="#fff" stroke={C.lit} strokeWidth={lw * 1.4}
                            style={onShapeHandleDown ? { cursor: cur(h) } : undefined}
                            onPointerDown={onShapeHandleDown
                              ? (e) => onShapeHandleDown(e, sh.id, h) : undefined}
                            onClick={(e) => e.stopPropagation()} />
                        );
                      })}
                    </g>
                  );
                })()}
              </g>
            ))}

            {/* THE SHAPE BEING SPANNED. In the fittings' own accent and not in
                the ink the committed line takes, because it is not a line on
                the drawing yet — it is a gesture, and the accent is what every
                other gesture on this canvas is drawn in. A pale wash inside it
                so a shape being dragged out over a busy plan reads as an AREA
                rather than as four more lines crossing the ones already there. */}
            {draftShape && (
              <g pointerEvents="none">
                <path d={path(draftShape.pts)} fill={C.lit} opacity="0.07" />
                <path d={path(draftShape.pts)} fill="none" stroke={C.lit}
                  strokeWidth={lw * 1.8} strokeLinejoin="round"
                  strokeDasharray={`${lw * 5} ${lw * 4}`} strokeLinecap="round" />
              </g>
            )}

            {/* THE PEN'S PATH SO FAR: the committed segments solid, the segment
                under the pointer rubber-banded, and the run home to the first
                point drawn as the dashed CLOSURE it will become. The last of the
                three is the whole reason this is drawn separately from
                `draftShape` — the shape auto-closes, and showing the closing leg
                while it is still open is the only way to say so before the
                click that commits it. */}
            {penDraft && penDraft.pts.length > 0 && (() => {
              const pts = penDraft.at ? [...penDraft.pts, penDraft.at] : penDraft.pts;
              const open = pts.map((q, i) => `${i ? 'L' : 'M'}${q.x},${q.y}`).join(' ');
              const first = pts[0], last = pts[pts.length - 1];
              const R = Math.max(lw * 2.6, 2.5);
              return (
                <g pointerEvents="none">
                  {pts.length > 1 && (
                    <path d={open} fill="none" stroke={C.lit} strokeWidth={lw * 1.8}
                      strokeLinejoin="round" strokeLinecap="round" />
                  )}
                  {pts.length > 2 && (
                    <line x1={last.x} y1={last.y} x2={first.x} y2={first.y}
                      stroke={C.lit} strokeWidth={lw * 1.4}
                      strokeDasharray={`${lw * 4} ${lw * 4}`} opacity="0.7" />
                  )}
                  {penDraft.pts.map((q, i) => (
                    <circle key={i} cx={q.x} cy={q.y} r={R} fill="#fff"
                      stroke={C.lit} strokeWidth={lw * 1.4} />
                  ))}
                  {/* THE FIRST POINT, RINGED, because it is a target: clicking it
                      closes the path, and nothing else on the run does anything
                      when clicked. */}
                  <circle cx={penDraft.pts[0].x} cy={penDraft.pts[0].y} r={R * 2}
                    fill="none" stroke={C.lit} strokeWidth={lw} opacity="0.8" />
                </g>
              );
            })()}
          </g>
        );
      })()}

      {/* --- THE CEILING DESIGN, CHOSEN ON THE DRAWING ----------------------
          A cove is a thing you judge by looking at it, so the choice belongs on
          the drawing and not in a panel three inches away from the only view
          that tells you anything. Click any light in a chunk and this appears
          over that chunk: what the piece of ceiling is now, and arrows to flip
          it through everything else it could be.

          IT IS ANCHORED TO THE CHUNK, NOT TO THE LIGHT THAT OPENED IT. Flip to
          a cove that carries the space on its own and the light you clicked
          ceases to exist; a pill anchored to it would vanish mid-decision with
          no way back. The chunk is the thing being decided and the chunk does
          not move.

          AND IT DOES NOT RESIZE. The width is set by the longest label in the
          list rather than by the one showing, because this control is used by
          clicking the same spot repeatedly — a pill that grew from STANDARD to
          COVE would slide the arrow out from under the cursor doing the
          flipping. */}
      {optionPick && onCycleOption && (() => {
        const room = laid.find((x) => x.id === optionPick.roomId);
        const ch = room?.design?.find((d) => d.key === optionPick.key);
        if (!ch) return null;
        const opts = ch.options ?? [];
        if (!opts.length) return null;
        const at = Math.max(0, opts.findIndex((o) => o.id === ch.pick));
        const label = (opts[at]?.label ?? '').toUpperCase();
        const many = opts.length > 1;

        const fs = s * 0.4;                 // the sheet's own annotation size
        const h = fs * 1.9;
        const arrow = h * 0.9;
        // THE WORD'S OWN BREATHING ROOM, AND IT IS NOT THE ARROWS'.
        //
        // These were one number, and a chunk with nothing to flip through was
        // the case that showed it: with two arrows on the pill their cells sat
        // between the word and the ends and stood in for padding, so a single
        // half-em looked fine — take the arrows away and STANDARD was jammed
        // against both ends. Padding is a property of the label, so it is
        // charged for the label, and the arrows are added outside it.
        const side = fs * 0.95;
        // A GENEROUS PER-CHARACTER ESTIMATE, because the alternative is
        // measuring text in the DOM to lay out an SVG. Upper case in this face
        // runs close to 0.62 em and the letter-spacing below adds a tenth on
        // top, so 0.72 covers the word with a little to spare — and erring wide
        // costs a slightly roomy pill, where erring narrow clips a word.
        const longest = opts.reduce((m, o) => Math.max(m, (o.label || '').length), 0);
        const tw = Math.max(longest, 6) * fs * 0.72;
        const w = tw + side * 2 + (many ? arrow * 2 : 0);
        const cx = (ch.rect.x0 + ch.rect.x1) / 2;
        // Inside the chunk, near its top edge — and never past its middle, so a
        // shallow chunk keeps its pill on itself rather than over the next one.
        const cy = Math.min(ch.rect.y0 + h * 1.4, (ch.rect.y0 + ch.rect.y1) / 2);
        const step = (dir) => (e) => {
          e.stopPropagation();
          onCycleOption(optionPick.roomId, optionPick.key, dir);
        };
        // --- HOW THE PILL IS PAINTED -------------------------------------
        //
        // EVERY COLOUR COMES FROM PILL_STYLE, which is a block of its own in
        // settings.js rather than part of THROW_STYLE. The reason is stated
        // there and worth repeating in one line: this is a CONTROL, not a
        // fitting. Everything else warm on this sheet shares one ramp because it
        // is all making the same claim; the pill is a button sitting on top of
        // the drawing, and it is allowed to look like one.
        //
        // FLAT BY DEFAULT, RAMPED IF ASKED. `stops` is null, so the body is a
        // flat white and no gradient element is emitted at all. Set `stops` and
        // it becomes ONE gradient in user space spanning the pill's left edge to
        // its right — one, because the arrow ends and the body would otherwise
        // each restart their own objectBoundingBox ramp and put two visible
        // seams across a single control. There is only ever one pill on the
        // canvas (it is drawn for `optionPick` and nothing else), so a fixed id
        // is safe here where the strips and rails needed one per run.
        /* --- WHY THE LIST IS THE LENGTH IT IS -----------------------------
            AN OWNER'S CARD AND NOBODY ELSE'S. `ch.omitted` is null for every
            other reader — see `explain` in planCeilingDesign — so nothing is
            raised on a designer's screen and the pill stays what it is: a
            control that offers what a piece of ceiling can be.

            IT WAS A NATIVE SVG <title> AND THAT DID NOT WORK. The argument for
            one was good — the browser already has somewhere to put text that
            appears when you rest on a thing, and it costs no layout on an
            element that must not resize. The argument does not survive Safari,
            which does not reliably render a tooltip for a `<title>` inside an
            <svg> at all. A hover hint nobody can see is worse than none.

            SO IT USES THE CARD THIS CANVAS ALREADY HAS. `onFixture` raises
            FixtureTip — an HTML card positioned from the pointer in viewport
            coordinates — which is what every fitting on this sheet already does
            on hover, works in every browser, and can leave the drawing instead
            of being clipped to it. One hover mechanism on this canvas, not two.

            THE SIZE IS THE HEADING, because it is the first thing anybody asks
            when an option is missing and the one number the drawing never
            states. */
        const P = PILL_STYLE;
        const why = ch.omitted ? {
          label: `Chunk ${ch.sizeFt}`,
          lines: ch.omitted.length ? ch.omitted : ['Every option is on offer here.'],
        } : null;
        const pillFill = P.stops ? 'url(#lp-pill)' : P.fill;
        const pillGrad = { x1: cx - w / 2, y1: cy, x2: cx + w / 2, y2: cy };
        // THE ARROW BUTTONS ARE HIT TARGETS AND NOTHING ELSE — `transparent`,
        // where they used to be filled with the pill's own paint.
        //
        // They never needed a fill. `w` is computed to INCLUDE both arrow cells,
        // so the body rect already spans the full width and is already painted
        // under them; filling them again only ever reproduced what was
        // underneath. It was harmless while both were the same gradient and
        // stops being harmless the moment the body took an EDGE: these rects
        // cover the pill's rounded ends exactly, are drawn after it, and a
        // white fill would have painted the edge off both caps. Dropping the
        // fill fixes that and makes it impossible for a button to drift out of
        // step with the body it sits on.
        const glyph = (x, mark, dir) => (
          <g>
            <rect className="hit" x={x} y={cy - h / 2} width={arrow} height={h}
              fill="transparent" rx={h / 2} ry={h / 2}
              style={{ cursor: 'pointer' }} onClick={step(dir)} />
            <text x={x + arrow / 2} y={cy + fs * 0.36} textAnchor="middle"
              fontSize={fs * 1.15} fontFamily="The Neue Montreal, sans-serif"
              fill={P.ink} opacity={P.arrowInk}>{mark}</text>
          </g>
        );
        return (
          <g>
            {P.stops && (
              <defs>
                <linearGradient id="lp-pill" gradientUnits="userSpaceOnUse" {...pillGrad}>
                  {P.stops.map((st) => (
                    <stop key={st.at} offset={st.at} stopColor={st.color} />
                  ))}
                </linearGradient>
              </defs>
            )}
            {/* WHICH PIECE OF CEILING THIS IS ABOUT. The pill names the design;
                only this says where it lands — so it stays on the ACCENT while
                the pill has gone white. It belongs to the drawing; the pill
                belongs to the interface. Its wash was `url(#lp-lit)` and is now
                a flat tone: at 4.5% opacity a ramp and its own midpoint are the
                same picture, and a colour is something PILL_STYLE can hold. */}
            <rect x={ch.rect.x0} y={ch.rect.y0}
              width={ch.rect.x1 - ch.rect.x0} height={ch.rect.y1 - ch.rect.y0}
              fill={P.region.fill} fillOpacity={P.region.fillOpacity}
              stroke={P.region.edge} strokeWidth={lw * P.region.weight}
              strokeDasharray={`${lw * 8} ${lw * 5}`} opacity={P.region.opacity}
              pointerEvents="none" />
            {/* THE BODY, AND IT CARRIES THE EDGE. A white chip on a white plan
                is a floating word without it — see PILL_STYLE. Drawn before the
                arrow glyphs and, now that those are transparent, never painted
                over at the caps. */}
            {/* `data-pill-body` IS AN ANCHOR FOR SOMETHING OUTSIDE THIS FILE.
                The card that explains this control sits OFF the drawing with a
                leader line back to it (see OptionCoach), which means something
                in the document has to be able to find the pill and measure it.
                Measuring the real element rather than recomputing this
                arithmetic in viewport space is the whole point: the answer
                cannot drift from the pill, whatever the pan, the zoom or the
                scroll position, because it IS the pill. */}
            <rect className="hit" data-pill-body="" x={cx - w / 2} y={cy - h / 2}
              width={w} height={h}
              rx={h / 2} ry={h / 2} fill={pillFill}
              stroke={P.edge} strokeWidth={lw * P.edgeWeight}
              onClick={(e) => e.stopPropagation()}
              /* ON THE BODY AND NOT ON THE GROUP, so resting on an arrow does
                 not raise it: those two have a job of their own and no need to
                 explain the geometry. `onFixture` is the same channel every
                 fitting's hover card comes through — see `feel` at the head of
                 this file — so there is one card and one way of raising it. */
              onMouseEnter={why && onFixture
                ? (e) => onFixture({ ...why, x: e.clientX, y: e.clientY }) : undefined}
              onMouseLeave={why && onFixture ? () => onFixture(null) : undefined} />
            <text x={cx} y={cy + fs * 0.36} textAnchor="middle" fontSize={fs}
              fontFamily="The Neue Montreal, sans-serif" fill={P.ink}
              letterSpacing={fs * 0.1}>{label}</text>
            {many && glyph(cx - w / 2, '\u2039', -1)}
            {many && glyph(cx + w / 2 - arrow, '\u203A', 1)}
          </g>
        );
      })()}

      {/* --- CONFIRMING THE DOORS, AND IT SITS OVER EVERYTHING --------------
          LAST IN THE FILE, WHICH IS TO SAY ON TOP OF THE WHOLE DRAWING. Every
          other overlay here is a layer OF the sheet and takes its place in the
          stack accordingly; this one is a modal step in front of it. The
          plates, the loops, the fittings and the space outlines all keep
          drawing underneath — you are correcting boxes against the plan and
          need to see the plan — but not one of them may take the press.

          THE FULL-SHEET RECT IS WHAT MAKES THAT TRUE, and it is not
          decoration. Everything interactive on this canvas calls
          `stopPropagation` on pointerdown — a fitting, a ceiling object, an
          accent, a chunk pill — and the door gestures are handled by the ROOT
          svg's handler, which those calls exist to prevent reaching. So a door
          sitting under a downlight would have been ungrabbable, and a box drawn
          across a room would have started somewhere and ended nowhere. A
          transparent sheet above them all is the press target instead: it stops
          nothing, so the event bubbles to the root exactly as a press on empty
          plan does. It is also, deliberately, what makes the hover cards and the
          option pills inert for the duration.

          `fill="transparent"` AND NOT `fill="none"`. The second one is not a
          colour, it is the absence of a fill, and a shape with no fill is not a
          pointer target — which would leave this element doing nothing at all
          while looking exactly the same. */}
      {doorEdit && (
        <g>
          <rect x="0" y="0" width={width} height={height} fill="transparent"
            style={{ cursor: 'crosshair' }} />

          {/* THE BOXES, IN THE SWITCHBOARD'S OWN BLUE.
              Not the magenta the audit print uses. Magenta on this canvas means
              "you are looking at the working" and is reserved for it; these
              boxes are not working, they are the question a client is being
              asked. Blue because of what they are FOR: the plate beside a door
              is drawn in this hue and the loop back to it is too, so a door
              being confirmed is visibly the same subject as the thing it
              produces.

              FILLED, LIGHTLY. A dashed outline over somebody's hatched wall is
              a texture; a wash is what makes a box a box at a glance, which is
              the whole of what this step asks somebody to check. */}
          {doorEditBoxes.map((d) => {
            if (!d.rect) return null;
            const r = d.rect;
            const on = d.id === selDoorId;
            const w = r.x1 - r.x0, h = r.y1 - r.y0;
            return (
              <g key={'de' + d.id} style={{ cursor: 'move' }}>
                <rect x={r.x0} y={r.y0} width={w} height={h}
                  fill={SB_COLOUR} fillOpacity={on ? 0.18 : 0.10}
                  stroke={SB_COLOUR} strokeWidth={lw * (on ? 2.8 : 1.8)} />
                {/* THE CORNERS, ON THE SELECTED ONE ONLY. They are not resize
                    grips and are not drawn as anything that looks like one —
                    they say WHICH box the keyboard is about, in the same idiom
                    the ceiling objects' selection frame uses. */}
                {on && [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]
                  .map(([cx, cy], i) => (
                    <rect key={i} x={cx - lw * 2.2} y={cy - lw * 2.2}
                      width={lw * 4.4} height={lw * 4.4}
                      fill="#fff" stroke={SB_COLOUR} strokeWidth={lw * 1.4} />
                  ))}
                {/* ...AND THE ONE WAY TO THROW IT AWAY WITH A MOUSE. Delete and
                    Backspace do the same thing and are what somebody with a
                    keyboard will reach for; this is here because a step a client
                    is walked through cannot have a destructive action that is
                    only available as a shortcut nobody was told about.
                    OUTSIDE THE BOX, off its top-right corner, because a target
                    inside the box would be a piece of the box that does not drag
                    — and the box's whole surface is the move handle. */}
                {on && onDoorDelete && (
                  <g onPointerDown={(e) => { e.stopPropagation(); e.preventDefault();
                                             onDoorDelete(d.id); }}
                    style={{ cursor: 'pointer' }}>
                    <circle cx={r.x1 + lw * 5} cy={r.y0 - lw * 5} r={lw * 4.6}
                      fill="#fff" stroke={SB_COLOUR} strokeWidth={lw * 1.6} />
                    <path d={`M${r.x1 + lw * 3.2},${r.y0 - lw * 6.8}`
                           + `L${r.x1 + lw * 6.8},${r.y0 - lw * 3.2}`
                           + `M${r.x1 + lw * 6.8},${r.y0 - lw * 6.8}`
                           + `L${r.x1 + lw * 3.2},${r.y0 - lw * 3.2}`}
                      stroke={SB_COLOUR} strokeWidth={lw * 1.7} strokeLinecap="round" />
                  </g>
                )}
              </g>
            );
          })}

          {/* The box being swept out. Same wash, no dashes: it is not a state,
              it is a gesture in progress. */}
          {doorDraft && (
            <rect pointerEvents="none"
              x={Math.min(doorDraft.x0, doorDraft.x1)}
              y={Math.min(doorDraft.y0, doorDraft.y1)}
              width={Math.abs(doorDraft.x1 - doorDraft.x0)}
              height={Math.abs(doorDraft.y1 - doorDraft.y0)}
              fill={SB_COLOUR} fillOpacity="0.14"
              stroke={SB_COLOUR} strokeWidth={lw * 2} />
          )}
        </g>
      )}

      {/* --- THE HANDLES ON THE PICKED WIRE ------------------------------------
          LAST IN THE DOCUMENT, AND THAT IS THE WHOLE REASON THIS IS NOT DRAWN
          WITH ITS OWN WIRE. SVG hit-tests the topmost PAINTED thing, and the
          switchboards are painted a thousand lines after the looping — so the
          grip at a wire's board end, drawn with the wire, sat underneath the
          plate's own hit polygon. Pressing it selected the board. There was
          nothing wrong with the handler; the handle was simply not the thing
          under the pointer. Everything interactive on this canvas that sits ON
          something else has to be painted after it, and the only place that is
          true of every layer at once is the end.

          AND EVERY CIRCLE IS `.hit`, which is the second half of the same bug.
          `.plan g, .plan circle, …{pointer-events:none}` in styles.css makes the
          whole drawing inert by default and `.hit` is what re-enables a control
          — see the note over that rule. A CSS declaration beats a presentation
          attribute, so `pointerEvents="all"` written on the element did nothing
          at all: the class is the only way in.

          TWO SHAPES FOR TWO MEANINGS. The bend grips are small hollow rings
          sitting ON the wire, because what they move is the wire. The board grip
          is a filled ring at the plate, because what it moves is the CONNECTION
          — it comes off one plate and lands on another.

          ONLY ON THE PICKED LOOP, and that is not tidiness: forty loops with six
          legs each is two hundred and forty handles laid over a lighting layout,
          every one of them a target that is not a fitting. */}
      {layers.electrical && !placing && (() => {
        const f = flows.find((q) => q.id === selFlowId && !q.coincident);
        if (!f) return null;
        const all = [...(f.legs ?? []), ...(f.also?.legs ?? [])].filter((l) => l.grip);
        return (
          <g fill="none">
            {onFlowGripDown && all.map((l) => (
              <circle className="hit" key={`g${l.key}`} cx={l.grip.x} cy={l.grip.y}
                r={lw * 3.2} fill="#fff" stroke={SB_COLOUR} strokeWidth={lw * 1.3}
                style={{ cursor: 'grab' }}
                onPointerDown={(e) => {
                  e.stopPropagation(); e.preventDefault();
                  onFlowGripDown(e, f.id, 'bend', l.key);
                }} />
            ))}
            {/* THE END AT THE PLATE, drawn after the bend grips so it wins where
                the two overlap — on a short feed leg they are a few pixels
                apart, and the one somebody means when they press on the plate is
                this one. */}
            {/* THE GRIPS ARE THE PICKED WIRE'S OWN, so they take its colour: they
                only ever appear on it, and a blue handle on a green wire would
                read as belonging to something else. */}
            {onFlowGripDown && f.from && (
              <circle className="hit" cx={f.from.x} cy={f.from.y} r={lw * 4.4}
                fill={WIRE_PICKED} stroke="#fff" strokeWidth={lw * 1.5}
                style={{ cursor: 'grab' }}
                onPointerDown={(e) => {
                  e.stopPropagation(); e.preventDefault();
                  onFlowGripDown(e, f.id, 'board', null);
                }} />
            )}
            {/* WHERE THAT END IS RIGHT NOW, while it is being carried: a dashed
                band from the first fitting to the pointer, and a dot under it.
                The ring round the plate it would land on is drawn by the plate
                itself — see `flowGrab` there. This is the whole of the feedback,
                because the assignment is not committed until the drop. */}
            {flowGrab?.id === f.id && f.nodes[0] && (
              <g pointerEvents="none">
                {/* THE BAND IS THIS WIRE BEING CARRIED, so it is this wire's
                    colour — the drag only ever happens on the picked one. */}
                <line x1={f.nodes[0].x} y1={f.nodes[0].y}
                  x2={flowGrab.at.x} y2={flowGrab.at.y}
                  stroke={WIRE_PICKED} strokeWidth={lw * 1.5}
                  strokeDasharray={`${lw * 2} ${lw * 2}`} strokeLinecap="round" />
                <circle cx={flowGrab.at.x} cy={flowGrab.at.y} r={lw * 3}
                  fill={WIRE_PICKED} stroke="#fff" strokeWidth={lw * 1.2} />
              </g>
            )}
          </g>
        );
      })()}

      {measure?.a && (
        <g stroke={C.measure} strokeWidth={lw * 2} fill={C.measure}>
          <circle cx={measure.a.x} cy={measure.a.y} r={lw * 4} />
          {measure.b && <>
            <line x1={measure.a.x} y1={measure.a.y} x2={measure.b.x} y2={measure.b.y} />
            <circle cx={measure.b.x} cy={measure.b.y} r={lw * 4} />
          </>}
        </g>
      )}
    </svg>
  );
});

export default PlanCanvas;
