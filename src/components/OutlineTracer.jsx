import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Path, Line, Circle, Rect, RegularPolygon, Text, Group,
         Image as KImage } from 'react-konva';
import { useEscapeClaim } from '../hooks/useEscapeHatch.js';
import Konva from 'konva';

// THE MIDDLE BUTTON DRAGS NOTHING BUT THE VIEW.
//
// Konva's default `dragButtons` is [0, 1] — left AND middle — so a middle press
// on a grip starts dragging that grip. With the middle button now meaning
// "pan", that is a corner of the outline quietly moving every time somebody
// pans with the cursor over a vertex, which is most of the time, because the
// vertices are what you are looking at. One global line, set before any node
// exists, and middle-drag can only ever mean the view.
Konva.dragButtons = [0];
import { buildSnapIndex, snapAt } from '../lib/snap.js';
import { outlineStats, validateOutline } from '../lib/outline.js';
import { REFERENCES, describeScale } from '../lib/scale.js';
import { parseDoorWidth } from '../lib/doors.js';
import { SB_COLOUR } from '../lib/electrical.js';

// ---------------------------------------------------------------------------
// OutlineTracer — draw the room over the plan, and let the plan hold the cursor.
//
// Automatic room reading works on a drawing whose layers mean what they say.
// Plenty of real drawings put the walls, the sofa, the WC and the dining table
// on layer 0 together, and no amount of layer-guessing recovers from that — it
// just produces a confident reading in which a dining table is a room. So the
// outline is traced by hand, and the whole job of this screen is to make the
// hand accurate.
//
// BOTH KINDS OF PLAN COME THROUGH HERE, and the difference between them is only
// what the cursor has to hold on to.
//
//   A DXF brings line work. The cursor snaps to wall ends, to the crossings
//   that form the inner corners of a wall junction, to anywhere along a wall,
//   and — with the right-angle lock on — carries along an axis until a wall
//   stops it.
//
//   An IMAGE brings pixels and nothing else. Nothing is inferred from them: no
//   edge detection, no line finding, because a wall guessed out of a JPEG is a
//   wall in the wrong place and the outline would be confidently off. What the
//   cursor holds on to instead is the geometry the user is drawing — the right
//   angle from the last corner, alignment with any corner already placed, the
//   crossing of two such alignments (which is what makes a hand-traced
//   rectangle come out rectangular), the edges of outlines already traced, and
//   an optional round-increment grid. See snap.js.
//
// The other difference is scale. A DXF states its own; an image has to be
// measured, and until it has been there is no way to say whether an outline
// encloses a bedroom or a wardrobe — so on an image the scale is set on this
// screen, before anything is traced.
//
// THE OUTLINES ARE NOW ALSO PROPOSED, not only traced. A segmentation model
// reads the plan on upload and hands back one polygon per room (see
// roomsDetect.js), which changes what this screen is for: less often "draw the
// room" and more often "the room is nearly right, put that corner where it
// belongs". So every corner of every outline carries a GRIP.
//
// A grip drags under exactly the same snap engine as a click while tracing, and
// that is the point rather than a convenience — a corner nudged by eye is off by
// the same two inches that made hand-tracing necessary in the first place, and
// the whole value of a proposal is that correcting it lands you somewhere more
// accurate than you would have got by hand. Two details make it work:
//
//   * the outline BEING dragged is taken out of the snap index, or its corner
//     snaps to its own edges and cannot be moved off them;
//   * the grips sit on the RAW points, not on the squared-up polygon. Squaring
//     is derived (see resolveOutline) and a grip on a derived point would move
//     something that is not stored.
//
// Canvas rather than SVG because this is the one screen where the frame budget
// is real: snapping runs on every mouse move over thousands of segments, and
// `strokeScaleEnabled={false}` keeps every line one screen pixel wide at any
// zoom without recomputing a stroke width for the whole drawing.
// ---------------------------------------------------------------------------

const SNAP_PX = 11;          // snap radius, in SCREEN pixels, at any zoom
// EIGHT SPACES, EIGHT HUES — and this is the one place the black-and-white
// palette is wrong. Everywhere else colour was saying a second time what a
// symbol already said, so it went. Here there is no symbol: eight polygons
// stacked edge to edge on a line drawing, and the ONLY thing distinguishing one
// from the next is its fill. A ramp of eight greys was tried and it reads as
// eight shades of the drawing rather than eight things on top of it — adjacent
// spaces at 0.1 opacity are four greys apart and separated by about nothing.
// Hue does in one glance what value could not, and the dot beside each name in
// the panel is the same hue, which is what ties the list to the plan.
const FILL = ['#6366F1', '#0EA5E9', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6', '#14B8A6', '#DC2626'];
const DRAFT = '#0070F3';    // the outline being drawn IS the live thing
const SNAPCOL = '#0070F3';  // ...and so is what it is snapping to
const GUIDE = '#0070F3';

// Outlines already traced are line work too — the only line work an image has.
// They go into the snap index under their own layer name so the show/snap panel
// can switch them off like any other.
const TRACED_LAYER = 'outlines traced';

// ---------------------------------------------------------------------------
// THE DESIGN LANGUAGE, AS UTILITY STRINGS — the same set App.jsx names, for the
// same reason: these were `.btn`, `.note`, `.kv`, `.sec` and their neighbours
// in styles.css, used dozens of times each in the panel below.
//
// EVERY VARIANT IS BUILT FROM A SHAPE THAT DOES NOT SET WHAT THE VARIANT SETS.
// `BTN + ' bg-cta'` does NOT give a filled button: Tailwind resolves two
// utilities touching one property by their order in the GENERATED stylesheet,
// not their order in the class attribute, so the base wins and the variant
// silently does nothing. Hence a shape plus a colourway, never an append.
//
// `leading-[1.5]` on the button carries what `.btn` inherited from body and
// Tailwind's `text-xs` would otherwise overwrite with its own 1rem.
// ---------------------------------------------------------------------------
const BTN_SHAPE = 'leading-[1.5] rounded border cursor-pointer '
  + 'transition-[background-color,border-color,color] duration-[120ms] '
  + 'disabled:opacity-100 disabled:cursor-not-allowed';
/* WORD FOR WORD THE PLANNING SCREEN'S PAIR (see App.jsx), because these two
   panels are the same panel two steps apart and they had drifted into two
   different themes. The quiet one was `bg-surface text-ink border-border` — ink
   type and a full-strength #EAEAEA hairline, which is a LIGHT-panel button
   rendered on a black page: black text on 5% white, inside a bright outline.
   White type and a `/10` hairline is what the other panel wears. */
const BTN_QUIET = 'bg-surface backdrop-blur-[5px] text-white border-border/10 '
  + 'hover:bg-surface-2 hover:text-black hover:border-border-strong active:bg-surface-3 '
  + 'disabled:hover:bg-surface disabled:hover:border-border/10';
/* WHITE IS THE PANEL'S PRIMARY, AND THE RAMP IS NOT A BUTTON COLOUR ANY MORE.
   This was `bg-accent-gradient` — the gold ramp — on the argument that every act
   this panel performs is a design act and the ramp is what the app spends on
   those. The trouble is that the ramp was ALSO the app's "this one is selected"
   marker (the light and ceiling swatches, the chunk card, the category tile),
   so a gold fill meant two different things depending on what it was painted
   on, and a panel could show a gold latch and a gold act in the same column.

   The ramp is now spent in exactly one place — a travelling stroke round the
   ONE button that proceeds (`BTN_GLOW` below) — and everything the panel
   promotes without wanting the glow is white. White is what the app already
   says for "this is the one you want": the door widths, the custom width's Use,
   the dashboard's New Project, the render pass's Run.

   It was `bg-cta` before the ramp, which resolves to #000000: a black button on
   a black page, findable only by its border. That is what not to go back to. */
const BTN_WHITE = 'bg-white text-black border-white hover:bg-text hover:border-text';
/* --- THE GLOWING ONE, AND THERE IS EXACTLY ONE ON THIS SCREEN -------------
   `lp-glow-btn` is the shared style (styles.css) and it brings its own black
   ground, white type, gradient stroke and breathing halo. Only the SIZE and the
   corner are set here, plus `border-transparent`: `BTN_SHAPE` declares `border`
   for the width every other colourway needs, and left to `currentColor` that
   would be a solid white 1px frame sitting on top of the gradient one.

   IT IS ON "LIGHT ALL N SPACES" AND ON NOTHING ELSE HERE. That button is the
   end of the tracing step — the one act this whole screen exists to reach — and
   it is one of four in the app allowed to glow. "Back to the design", right
   beside it in the other branch of the same foot, deliberately does not: it is
   a way OUT of a detour, and two glowing buttons in one corner would be the
   screen shouting twice. */
const BTN_GLOW = `text-[12px] px-3 py-[7px] ${BTN_SHAPE} lp-glow-btn border-transparent`;
const BTN = `text-[12px] px-3 py-[7px] ${BTN_SHAPE} ${BTN_QUIET}`;
const BTN_FULL = `${BTN} w-full`;
const BTN_PRIMARY = `text-[12px] px-3 py-[7px] ${BTN_SHAPE} ${BTN_WHITE}`;
const BTN_PRIMARY_FULL = `${BTN_PRIMARY} w-full`;
/* One of the three door widths: full width in the grid, and centred. */
const BTN_DOOR = `text-[12px] w-full px-1 py-[7px] text-center ${BTN_SHAPE} ${BTN_QUIET}`;
const BTN_DOOR_CTA = `text-[12px] w-full px-1 py-[7px] text-center ${BTN_SHAPE} ${BTN_WHITE}`;
/* The custom width's Use, which commits the same kind of value. */
const BTN_USE = `text-[12px] px-3 py-[7px] ${BTN_SHAPE} ${BTN_WHITE}`;
/* ...and the quieter "or, if you know" row under them. */
const BTN_CUSTOM = `text-[11.5px] w-full mt-1.5 px-3 py-[7px] ${BTN_SHAPE} `
  + 'bg-surface backdrop-blur-[5px] text-muted border-border/10 hover:bg-surface-2 '
  + 'hover:text-black hover:border-border-strong active:bg-surface-3';

/* ATTENTION, NOT ALARM: the warnings here are mostly guidance — "set the scale
   above first" — so the default is quiet, with a rule down the left saying
   "read this". `NE` is the red one, for something that actually failed.
   `N`/`NW` are the margin-less shapes, for the sites that set their own. */
const N = 'text-[11.5px] text-muted leading-[1.5]';
const NW = `${N} border-l-2 border-border-strong pl-[9px] ml-0`;
const NE = 'text-[11.5px] leading-[1.5] mt-2 text-danger border-l-2 border-danger pl-[9px]';
const NOTE = `${N} mt-2`;
const NOTE_WARN = `${NW} mt-2`;

/* TABULAR FIGURES WHEREVER A NUMBER IS READ DOWN A COLUMN. */
/* `[&>b]:text-white` AND NOT `text-ink`. The value is the half of a readout
   anybody actually reads, and #000000 on this ground is a value that is not
   there — the label was legible and the number was invisible. */
const KV = 'flex justify-between text-[11.5px] py-[3px] text-muted '
  + '[&>b]:text-white [&>b]:tabular-nums';
const BTNROW = 'flex gap-1.5 flex-wrap';
const SEC = 'border-t border-border/10 pt-3.5 mt-2.5 '
  + 'first-of-type:border-t-0 first-of-type:mt-0 first-of-type:pt-0';
const H3 = 'mt-0 mx-0 mb-2.5 text-[10px] tracking-[0.11em] uppercase text-subtle';
/* THE LABEL'S LAYOUT AND THE BOX'S SIZE, AND NOTHING ABOUT ITS COLOUR — the
   same split App.jsx's own CHECK makes. `accent-accent` was here and it was the
   amber: `accent-color` paints the box, so it gave an amber square. The box is
   `.lp-check` in styles.css now (white, black tick) and it is on the input. */
const CHECK = 'flex items-center gap-2 mb-[7px] text-muted cursor-pointer '
  + '[&>input]:w-3.5 [&>input]:h-3.5 [&>input]:m-0';
const ROW = 'flex items-center justify-between gap-2.5 mb-[9px] '
  + '[&>label]:text-muted [&>label]:flex-1 [&>label]:min-w-0';

/* THE TWO-WAY SWITCH above the scale controls. */
/* THE TWO-WAY SWITCH above the scale controls, and it is the planning screen's
   TABS shell — glass, a `/10` hairline, and the live half said with WHITE rather
   than with a raised near-white pill. `bg-surface-3` is #F2F2F2: an opaque slab
   with two invisible labels on it, which is exactly the bug the layout panel's
   undo/redo shell already had and already fixed. */
const SEG = 'flex bg-surface backdrop-blur-[5px] border border-border/10 rounded p-0.5 gap-0.5 mb-2.5';
const SEG_SHAPE = 'flex-1 border-0 text-[11.5px] leading-[1.5] px-1 py-1.5 rounded cursor-pointer '
  + 'transition-[background-color,color] duration-[120ms]';
const SEG_BTN = `${SEG_SHAPE} bg-transparent text-subtle hover:text-white`;
const SEG_BTN_ON = `${SEG_SHAPE} bg-white/10 text-white`;

/* THE HUD ON THE DRAWING: only what changes as you work. */
const HUD = 'absolute left-2.5 bottom-2.5 flex gap-1.5 flex-wrap pointer-events-none tabular-nums';
const CHIP_SHAPE = 'font-sans text-[10px] px-[7px] py-[3px] rounded-full border whitespace-nowrap';
/* THE TAG SITS ON THE DRAWING, WHICH IS WHY IT IS BLACK AND NOT PANEL GLASS.
   Every other frosted surface in this app floats over the page's own dark
   ground, so 5% white plus a blur reads as glass. This one floats over the PLAN
   — grey linework, sometimes a scan — and 5% white over that is a smear you can
   read the drawing through. So the ground is black at 58% and the blur is the
   panel's: a dark lozenge the linework goes quiet behind, with the hairline
   doing the work of an edge.
   ONE HAIRLINE FOR BOTH STATES, and the difference is the type. The live tag
   wore the accent ramp, which put a solid gold pill in the corner of a drawing
   whose fittings are drawn in that same ramp — the one colour that is supposed
   to mean "a fitting" was also meaning "a caption". */
const CHIP_GLASS = 'bg-black/[0.58] backdrop-blur-[5px] border-border/10';
const CHIP = `${CHIP_SHAPE} ${CHIP_GLASS} text-subtle`;
const CHIP_ON = `${CHIP_SHAPE} ${CHIP_GLASS} text-white`;

/* A ROW IN THE LIST OF SPACES. `border-transparent` lives on the off-state
   rather than the shape, because the on-state sets border-colour too. */
const ROW_EDGE = 'rounded-[7px] mb-[3px] border px-1.5 py-[5px]';
const ROW_OFF = 'border-transparent';
/* THE SAME TILE THE LAYOUT PANEL'S SPACE ROWS ARE — `bg-white/5`, a `/10`
   hairline, the panel's blur — rather than an opaque #F2F2F2 slab inside a
   #D4D4D4 outline. Two lists of the same object one screen apart. */
const ROW_ON = 'bg-white/5 border-border/10 backdrop-blur-[5px]';
const ROW_PICK = 'cursor-pointer hover:bg-white/5 focus:outline-none '
  + 'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1';
/* Three columns: the colour dot, the name, the area. */
const PICK = 'grid grid-cols-[10px_minmax(0,1fr)_auto] gap-[7px] items-center w-full '
  + 'border-0 bg-none p-0 text-left cursor-[inherit]';
const NAME = 'font-sans text-[11px] text-text overflow-hidden text-ellipsis whitespace-nowrap';
/* `META` AND `MINI` WENT WITH THE ROW'S SECOND LINE — see the note at the row
   itself. They dressed the dimensions, the corner count and the square toggle,
   and there is nothing left in the list that is not the dot, the name or the
   area. */
const COUNT = 'font-sans text-[10px] text-subtle';

/* THE DXF'S LAYERS: a checkbox, a name, a count. */
const LAYER_SHAPE = 'grid grid-cols-[14px_minmax(0,1fr)_auto_auto] gap-[7px] items-center '
  + 'px-[5px] py-[3px] rounded cursor-pointer text-[11.5px] '
  + '[&>input]:w-[13px] [&>input]:h-[13px] [&>input]:m-0';
const LAYER_ROW = `${LAYER_SHAPE} text-muted hover:bg-white/10 hover:text-text`;
/* WHITE, NOT THE ACCENT. A shown layer is a state, and the panel says a state
   with white — the ramp is spent on the things that act. */
const LAYER_ROW_ON = `${LAYER_SHAPE} bg-white/10 text-white`;
const LAYER_NAME = 'font-sans text-[10.5px] overflow-hidden text-ellipsis whitespace-nowrap tabular-nums';

// Grid increments offered, in inches. Coarser than three inches and a grid
// stops being a nicety and starts moving walls.

const ftin = (v) => {
  const f = Math.floor(v), i = Math.round((v - f) * 12);
  return i === 12 ? `${f + 1}'0"` : `${f}'${i}"`;
};
const flat = (pts) => pts.flatMap((p) => [p.x, p.y]);

/** A rect carried by a delta. Doors are moved, never resized — see the note on
    the corner marks: they say WHICH box is selected, they are not grips. */
const shiftRect = (r, dx, dy) => ({
  x0: r.x0 + dx, x1: r.x1 + dx, y0: r.y0 + dy, y1: r.y1 + dy,
});

/** A closed polygon's edges, as segments the snap index understands. */
const edgesOf = (pts, layer) => pts.map((p, i) => {
  const q = pts[(i + 1) % pts.length];
  return { x1: p.x, y1: p.y, x2: q.x, y2: q.y, layer };
});

/** The container's size, so the stage can fill it. */
function useSize(ref) {
  const [size, setSize] = useState({ w: 900, h: 620 });
  useEffect(() => {
    if (!ref.current) return;
    const measure = () => {
      const r = ref.current?.getBoundingClientRect();
      if (r && r.width > 0) setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export default function OutlineTracer({
  source, pxPerFt, outlines, selectedId, onSelect, onCommit,
  onUpdateOutline, onDeleteOutline, onConfirm,
  onMovePoint, onInsertPoint, onRemovePoint, onProceed,
  detectState = null,
  unitId, unitCandidates, onUnitChange,
  scale: scaleUI, invert = false, scalePending = false, dimensionNote = null,
  litIds = [], dirtyIds = [], onBackToDesign = null,
  /* --- THE DOOR STEP, WHICH NOW STANDS IN FRONT OF EVERYTHING ELSE --------
     `doorsOk` is the document's, and it is the same decision the wiring is
     gated on — see `doorsOk` in App.jsx. Until it is answered this screen is
     the door step and nothing else, so the four handlers below are what the
     step writes with. A caller that passes no `onConfirmDoors` gets the old
     behaviour: the step never appears. */
  doorsOk = true, onConfirmDoors = null,
  onAddDoor = null, onMoveDoor = null, onDeleteDoor = null,
}) {
  const wrapRef = useRef(null);
  const stageRef = useRef(null);
  const { w: SW, h: SH } = useSize(wrapRef);

  const isRaster = source.kind === 'raster';

  /* --- COMING BACK HERE FROM A FINISHED DESIGN ------------------------------
     THIS SCREEN USED TO BE REACHABLE ONLY ONE WAY: forwards, with nothing behind
     it, because the Outlines tab had to discard the layout to get here. It does
     not any more (see `backToOutlines` in App.jsx), so the tracer can now be
     opened OVER a design — and that is a different screen with a different
     question at the bottom of it.

     `hasLayout`    there is a design to go back to, so the foot offers that.
     `changed`      spaces that are lit AND have moved since. These are the ones
                    whose room type, accents and task surfaces may now be wrong,
                    and the only ones a relight needs to spend a call on.
     `unlit`        outlines that have never been lit. Not the same thing at all,
                    and counted separately: one is stale, the other is missing.

     BOTH LISTS ARE INTERSECTED WITH WHAT IS ON SCREEN. `dirtyIds` is serialised
     and `outlines` is not guaranteed to still contain every id in it — a space
     deleted in another tab, an older saved plan — and a foot that offers to
     relight four spaces when three exist is a foot that fails on the press. */
  const hasLayout = litIds.length > 0;
  const changed = outlines.filter((o) => litIds.includes(o.id) && dirtyIds.includes(o.id));
  const unlit = outlines.filter((o) => !litIds.includes(o.id));

  /* Re-applied whenever the flag, the source or the stage size changes: Konva
     rebuilds a layer's canvas element on resize, and a style set on the old node
     goes with it. Cheap enough to just state again. */
  const planLayer = useRef(null);
  useEffect(() => {
    const layer = planLayer.current;
    if (!layer) return;
    const canvas = layer.getNativeCanvasElement?.();
    if (!canvas) return;
    canvas.classList.toggle('plan-invert', invert && isRaster);
  }, [invert, isRaster, source, SW, SH]);
  const hasScale = pxPerFt > 0;

  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [draft, setDraft] = useState([]);
  const [snap, setSnap] = useState(null);
  const [orthoLock, setOrthoLock] = useState(true);
  const [alignOn, setAlignOn] = useState(true);
  const [shift, setShift] = useState(false);
  const [space, setSpace] = useState(false);
  const [visible, setVisible] = useState(() => new Set([...source.render.map((l) => l.layer), TRACED_LAYER]));
  const [problem, setProblem] = useState('');
  const [renaming, setRenaming] = useState(null);
  // Measuring is a MODE, and a mode you cannot leave is a trap: with the two
  // ends clicked and the scale on screen, the next click was still landing on
  // the measuring line instead of placing a corner. Taking the measurement is
  // an explicit act, exactly like closing an outline.
  const [measureDone, setMeasureDone] = useState(false);
  // The corner under the cursor, mid-drag. Held here and not pushed to the
  // parent on every mouse move: committing per move would rebuild the snap
  // index under the cursor sixty times a second, and the index is what the
  // cursor is snapping against.
  const [drag, setDrag] = useState(null);
  const [showGrips, setShowGrips] = useState(true);
  // Panning with the middle button held. Space-drag already existed and stays;
  // this is the version you do not have to reach for the keyboard for, and it
  // is the same gesture the layout canvas uses so the two screens behave alike.
  const [midPan, setMidPan] = useState(false);
  const panFrom = useRef(null);
  // The door under the cursor. A door box is a button, and a button that does
  // not answer the pointer leaves you clicking to find out whether it is one.
  const [hoverDoor, setHoverDoor] = useState(null);
  // The custom door width, typed rather than chosen. `customOpen` is separate
  // from "is there a value" so the field stays open while it is being corrected.
  const [customOpen, setCustomOpen] = useState(false);
  const [customMm, setCustomMm] = useState('');
  // ...and the space under it, for the same reason. These polygons are the
  // things being edited on this screen; a shape that does not acknowledge the
  // pointer reads as part of the drawing rather than as something you can grab.
  const [hoverSpace, setHoverSpace] = useState(null);

  /* --- THE DOOR STEP'S THREE PIECES OF GESTURE STATE ----------------------
     `doorBand` is a box being swept out and does not exist yet; `doorMove` is
     an existing box under the hand, and it carries the LIVE RECT for the same
     reason App's own door drag does — writing a move into the document on
     every pointer frame would re-run the scale off a box that is still
     moving; `doorSel` is which box the keyboard and the × are about. */
  const [doorBand, setDoorBand] = useState(null);
  const [doorMove, setDoorMove] = useState(null);
  const [doorSel, setDoorSel] = useState(null);

  const ortho = orthoLock && !shift;
  const panMode = space;
  const tracing = draft.length > 0;

  /* --- THE DOORS ARE IDENTIFIED BEFORE ANYTHING ELSE IS ASKED -------------
     THE ORDER WAS WRONG AND IT WAS WRONG IN A WAY THAT COST THE ANSWER TWICE.
     The first thing this screen did was hand somebody the detector's doors and
     ask them to pick one as a ruler — a question that treats the set as
     finished — and then, three steps later on the design screen, the wiring
     asked whether that same set was complete and made them go through it again
     under "Modify doors". Two passes over one list, in the wrong order: the
     ruler was chosen out of a set nobody had checked.

     SO THE STEP MOVES TO THE FRONT. Confirm the doors, then take the scale off
     one of them. It costs nothing extra — the boxes are already on the drawing
     at that moment, which is when they are cheapest to look at — and it buys
     the two things downstream needs: a complete set for the switchboards, and
     a ruler chosen from a set somebody has read.

     AND THE SCALE STEP IS SKIPPED WHEN THERE IS NOTHING TO SET. A DXF states
     its own scale, so it goes straight from here to the outlines; an image
     goes on to the door/measure pair. That is the whole sequence.

     RASTER ONLY, and that is not an omission. The door detector does not run
     on a DXF (see useDoorRecognition) — there is nothing to confirm, and a
     step that opened on "0 boxes on the plan" would be asking somebody to
     draw every door in the building before they had seen a single space. The
     wiring's own "Modify doors" still covers that case, where it always did.

     `onConfirmDoors` IS THE FEATURE SWITCH. A caller that does not pass it —
     the read-only viewer, anything embedding this for tracing alone — never
     sees the step. */
  const idScreen = isRaster && !doorsOk && !!onConfirmDoors;

  // On an image, clicking the plan sets the measuring line rather than a corner.
  const measuring = isRaster && scaleUI?.mode === 'ref' && !panMode && !measureDone
    && !idScreen;
  // The doors are live targets only while the door mode is the one being used
  // AND the scale is not settled — once it is, they are twelve blue rectangles
  // sitting on top of the drawing you are trying to trace.
  const pickingDoor = isRaster && scaleUI?.mode === 'door' && !panMode
    && !!(scaleUI.doors || []).length && !hasScale && !idScreen;
  /** The door the user clicked, if it is still in the list. */
  const picked = (scaleUI?.doors || []).find((d) => d.id === scaleUI?.pick?.id) || null;
  const customParsed = useMemo(() => parseDoorWidth(customMm), [customMm]);
  /** Is the width in force one the three buttons offer, or a typed one? */
  const isCustomMm = !!scaleUI?.pick?.mm
    && !(scaleUI.widths || []).some((w) => w.mm === scaleUI.pick.mm);

  // CLOSE THE TYPED FIELD WHEN THE DOOR CHANGES. The number is a width of THAT
  // door, and leaving the panel open across a re-pick shows a value that looks
  // applied and is not — the new pick's mm is null until something is chosen
  // again. The text is kept, because the next door is very often the same width.
  const pickedId = scaleUI?.pick?.id ?? null;
  useEffect(() => { setCustomOpen(false); }, [pickedId]);
  const canTrace = hasScale && !measuring && !pickingDoor && !idScreen;
  // THE DOOR SCREEN IS A SCREEN OF ITS OWN, and that is the point of this flag.
  // Before the scale exists there is exactly one thing to do — name a door —
  // and everything belonging to tracing is inert: the spaces cannot be drawn
  // because their dimensions are unknown, the snapping options change nothing,
  // the trace controls refuse the first click. A panel that offers six
  // sections when five of them do nothing is a panel nobody reads, so they are
  // put away until there is a ruler.
  /* `!scalePending` IS THE FOURTH TERM AND IT IS ABOUT TIMING, NOT STATE. The
     drawing may be dimensioned — see features/dimension-intelligence — and the
     half of that which reads a room's stated size cannot answer until the
     segmenter's polygons arrive, a beat after the plan itself. Without this the
     step mounts in that gap and vanishes under somebody who has started reading
     it, which is a worse wait than the wait. */
  const doorScreen = isRaster && scaleUI?.mode === 'door' && !hasScale && !idScreen
    && !scalePending;

  /* THE TWO FULL-PANEL STEPS, AS ONE NAME. Both take the panel over completely
     and both make everything below them inert, so every gate that used to read
     `!doorScreen` means `!stepScreen` now. */
  const stepScreen = doorScreen || idScreen;

  /** The door detector, still out. Nothing on the step is answerable until it
      is back, because the set it is about to hand over is the set. */
  const looking = scaleUI?.doorState?.status === 'running';

  // Every layer of a newly loaded plan starts visible. Held in state because
  // the user turns layers off to stop the cursor catching a sofa corner, and
  // that choice is per drawing — so it has to be rebuilt when the drawing is.
  useEffect(() => {
    setVisible(new Set([...source.render.map((l) => l.layer), TRACED_LAYER]));
    setDraft([]); setProblem('');
  }, [source]);

  useEffect(() => {
    if (scaleUI?.mode !== 'ref') setMeasureDone(false);
  }, [scaleUI?.mode]);

  // The last snap from before the door screen came up would otherwise sit there
  // frozen on the plan, glyph and all.
  useEffect(() => { if (stepScreen) setSnap(null); }, [stepScreen]);

  /* LEAVING THE DOOR STEP PUTS ITS GESTURES DOWN. A box left selected would
     keep the × floating over a drawing that is now about spaces, and a band
     half swept when the step was answered would commit on the next release. */
  useEffect(() => {
    if (idScreen) return;
    setDoorBand(null); setDoorMove(null); setDoorSel(null);
  }, [idScreen]);

  /* THE DOOR BOXES AS DRAWN. The list, with the box being moved at where the
     pointer has it rather than at where it started — the same gap `doorDrag`
     closes on the design screen, and for the same reason: the rect is local
     until the release. */
  const doorBoxes = useMemo(() => {
    const list = scaleUI?.doors || [];
    if (!doorMove) return list;
    return list.map((d) => (d.id === doorMove.id ? { ...d, rect: doorMove.rect } : d));
  }, [scaleUI?.doors, doorMove]);

  // The outlines as they look RIGHT NOW. Identical to the props except for the
  // one corner being dragged, which is local until the drag ends.
  const liveOutlines = useMemo(() => {
    if (!drag) return outlines;
    return outlines.map((o) => (o.id !== drag.id ? o : {
      ...o,
      pointsPx: o.pointsPx.map((p, i) => (i === drag.index ? { x: drag.x, y: drag.y } : p)),
    }));
  }, [outlines, drag]);

  // --- what the cursor can hold on to --------------------------------------
  const tracedSegs = useMemo(
    () => liveOutlines.flatMap((o) => edgesOf(o.pointsPx, TRACED_LAYER)),
    [liveOutlines]);

  // Outlines already traced join the index, so tracing the room next door picks
  // up the shared wall exactly rather than nearly. On an image they are the
  // only entries there are.
  const index = useMemo(
    () => buildSnapIndex([...source.segmentsPx, ...tracedSegs], source.circlesPx),
    [source, tracedSegs]);

  // Corners to line up with: the ones in this trace, and the ones in every
  // outline already committed.
  const alignTo = useMemo(() => {
    if (!alignOn) return [];
    const pts = [...draft];
    for (const o of liveOutlines) pts.push(...o.pointsPx);
    return pts;
  }, [alignOn, draft, liveOutlines]);

  // NO GRID. `snapPoint` still takes one — `src/lib/snap.js` implements it and
  // `tools/test-snap.mjs` covers it — but nothing on this screen turns it on any
  // more. It was a dimension rounder: anchored on the first corner placed, it
  // made a space come out 12'6" instead of 12'5.8". The snap engine makes that
  // moot. A corner lands on the wall it belongs to, and a wall in the drawing is
  // where the building actually is; rounding it to the nearest three inches
  // moves it OFF the wall to make a number tidier, which is a worse outline
  // dressed as a neater one. Two rounding schemes competing for the same corner
  // is also how a grip stops landing where the cursor says it will.

  /**
   * The snap index for a drag, with the dragged outline's OWN edges removed.
   *
   * Without this the corner cannot be moved: its two edges pass through it, so
   * `edge` and `end` candidates sit exactly under the cursor at zero distance
   * and win every comparison. Removing the whole outline rather than just its
   * two adjacent edges is deliberate — a corner dragged across the room would
   * otherwise catch on the far wall of its own polygon.
   *
   * Rebuilt once per drag, not once per move: `outlines` does not change while
   * a drag is in flight, which is the reason the drag is local state.
   */
  const dragIndex = useMemo(() => {
    if (!drag) return null;
    const others = outlines
      .filter((o) => o.id !== drag.id)
      .flatMap((o) => edgesOf(o.pointsPx, TRACED_LAYER));
    return buildSnapIndex([...source.segmentsPx, ...others], source.circlesPx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.id, outlines, source]);

  // --- fit to the frame, once per plan and on demand -----------------------
  const fit = useCallback(() => {
    const pad = 24;
    const s = Math.min((SW - pad * 2) / source.w, (SH - pad * 2) / source.h);
    const k = Number.isFinite(s) && s > 0 ? s : 1;
    setZoom(k);
    setPos({ x: (SW - source.w * k) / 2, y: (SH - source.h * k) / 2 });
  }, [SW, SH, source]);

  useEffect(() => { fit(); }, [source, SW, SH]);   // eslint-disable-line react-hooks/exhaustive-deps

  // --- pointer -------------------------------------------------------------
  const cursorAt = () => stageRef.current?.getRelativePointerPosition() || null;

  const recomputeSnap = () => {
    const c = cursorAt();
    if (!c) return null;
    const s = snapAt(index, c, {
      tol: SNAP_PX / zoom,
      last: draft.length ? draft[draft.length - 1] : null,
      points: draft,
      ortho,
      layers: visible,
      alignTo,
      gridPx: 0,
      gridOrigin: null,
    });
    setSnap(s);
    return s;
  };

  // NOT ON THE DOOR SCREEN. The snap engine exists to put a traced corner
  // exactly on a wall; on the door screen there is no corner to place and
  // nothing to measure, so every part of it is a lie about what a click does —
  // the crosshair, the glyph under the cursor, the dotted alignment guides, and
  // a pill reading "lined up with a corner" about a corner nobody is placing.
  const onMouseMove = () => {
    /* THE DOOR STEP OWNS THE POINTER OUTRIGHT while it is up — one pipeline,
       one owner, the same rule the design screen's door editor states. */
    if (idScreen) {
      if (panMode || midPan) return;
      const c = cursorAt();
      if (!c) return;
      if (doorMove) {
        setDoorMove((m) => {
          if (!m) return m;
          const dx = c.x - m.ox, dy = c.y - m.oy;
          /* `moved` IS WHAT DECIDES WHETHER THE RELEASE WRITES ANYTHING. A
             click on a box to select it is a press and a release with a
             pixel of hand-shake between them, and committing that would put
             a revision on the document for every box anybody looked at. */
          return { ...m, rect: shiftRect(m.from, dx, dy),
                   moved: m.moved || Math.hypot(dx, dy) > px(2) };
        });
        return;
      }
      if (doorBand) setDoorBand((b) => (b ? { ...b, x1: c.x, y1: c.y } : b));
      return;
    }
    if (!panMode && !midPan && !drag && !doorScreen) recomputeSnap();
  };

  /* --- THE DOOR STEP'S RELEASE, AND THE ONE WRITE IT MAKES ----------------
     A MOVE COMMITS HERE AND NOWHERE ELSE, for the reason `doorMove` exists.
     A NEW BOX IS A DOOR LIKE ANY OTHER — the parent gives it its id, its
     opening and its `placed` mark; this side only says where it is.
     THE HALF-FOOT FLOOR is the design screen's, to the pixel: a press with a
     twitch in it is a click on empty plan, which has already done what it
     meant to do — cleared the selection — and a two-pixel sliver on the sheet
     is a door as far as everything downstream is concerned. */
  const onMouseUp = () => {
    if (!idScreen) return;
    if (doorMove) {
      const m = doorMove;
      setDoorMove(null);
      if (m.moved) onMoveDoor?.(m.id, m.rect);
      return;
    }
    if (!doorBand) return;
    const b = doorBand;
    setDoorBand(null);
    const r = {
      x0: Math.min(b.x0, b.x1), x1: Math.max(b.x0, b.x1),
      y0: Math.min(b.y0, b.y1), y1: Math.max(b.y0, b.y1),
    };
    const minPx = Math.max(6, (pxPerFt || 0) * 0.5);
    if (r.x1 - r.x0 < minPx || r.y1 - r.y0 < minPx) return;
    const id = onAddDoor?.(r);
    if (id) setDoorSel(id);
  };

  /* ON THE WINDOW, AND FOR THE REASON THE PAN'S LISTENERS ARE. A box swept out
     to the edge of the canvas is the ordinary case — a door on the boundary of
     the drawing — and a release that only counts inside the stage would leave
     that gesture running with the button already up, so the next press
     anywhere would drop a box the size of the plan. The ref keeps the listener
     bound once per step rather than once per pointer frame. */
  const upRef = useRef(onMouseUp);
  upRef.current = onMouseUp;
  useEffect(() => {
    if (!idScreen) return;
    const up = (ev) => { if (ev.button === 0) upRef.current(); };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, [idScreen]);

  /**
   * MIDDLE-BUTTON PAN.
   *
   * Returns true if it took the event, so the caller can stop. `pos` is the
   * Stage's offset in SCREEN pixels — it is not scaled — so the pointer's delta
   * is the offset's delta, with no zoom arithmetic in between.
   *
   * `preventDefault` is load-bearing: without it Chrome and Firefox on Windows
   * and Linux start their own autoscroll on a middle press and then fight this
   * for the same drag.
   */
  const startMidPan = (e) => {
    const ev = e?.evt ?? e;
    if (!ev || ev.button !== 1) return false;
    ev.preventDefault();
    panFrom.current = { x: ev.clientX, y: ev.clientY, pos: { ...pos } };
    setMidPan(true);
    return true;
  };

  useEffect(() => {
    if (!midPan) return;
    // ON THE WINDOW. A pan that ends when the pointer leaves the canvas is a pan
    // that ends every time you reach the edge of the thing you are panning away
    // from — which is the only reason anyone pans.
    const move = (ev) => {
      const f = panFrom.current;
      if (!f) return;
      setPos({ x: f.pos.x + (ev.clientX - f.x), y: f.pos.y + (ev.clientY - f.y) });
    };
    const stop = () => { panFrom.current = null; setMidPan(false); };
    const up = (ev) => { if (ev.button === 1) stop(); };
    // The `auxclick` a middle release fires is swallowed, so a pan that happens
    // to end over a button does not also press it.
    const aux = (ev) => { if (ev.button === 1) { ev.preventDefault(); ev.stopPropagation(); } };
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
  }, [midPan]);

  /**
   * Where a dragged corner lands. The same engine as a click while tracing,
   * with three differences that all come from the fact that this corner already
   * exists:
   *
   *   `points: []`   nothing to close and no vertex of its own to catch on.
   *   `last: prev`   the right-angle lock works off the PREVIOUS corner, so a
   *                  wall being straightened stays a wall.
   *   alignTo        always carries both neighbours, even with alignment off,
   *                  because squaring a corner against the two walls it joins
   *                  is not an optional nicety — it is the correction.
   *
   * The grid is off. It is anchored on the first corner of a trace in progress
   * (see gridOrigin) and there is no trace in progress here; anchoring it on
   * the plan would round the corner's POSITION, which means nothing.
   *
   * AND THE RIGHT-ANGLE LOCK IS OFF, which is the important one. A corner is a
   * corner, not the end of a wall being drawn: moving one corner of a rectangle
   * is *meant* to leave two angled edges, and a lock that holds it on the
   * previous corner's axis makes that impossible — you drag 190px and the point
   * moves 115px sideways. What replaces the lock is the alignment snap, which
   * still pulls the corner into line with its neighbours when it is close to
   * being in line, and lets go when it is not. A preference rather than a rule.
   */
  const snapForDrag = (o, k, cursor) => {
    const pts = o.pointsPx;
    const n = pts.length;
    const prev = pts[(k - 1 + n) % n];
    const next = pts[(k + 1) % n];
    const others = [];
    for (const q of liveOutlines) {
      q.pointsPx.forEach((pt, j) => { if (!(q.id === o.id && j === k)) others.push(pt); });
    }
    return snapAt(dragIndex || index, cursor, {
      tol: SNAP_PX / zoom,
      last: prev,
      points: [],
      // Free angle. Shift is the ESCAPE from a lock everywhere else in this
      // screen, so here — where there is no lock — it is what turns one on, for
      // the times you do want the corner held on its neighbour's axis.
      ortho: shift,
      layers: visible,
      alignTo: alignOn ? others : [prev, next],
      gridPx: 0,
      gridOrigin: null,
    });
  };

  const removeCorner = (o, k) => {
    // Three is the floor the validator uses, so it is the floor here. Below it
    // there is no inside for the planner to light.
    if (o.pointsPx.length <= 3) {
      setProblem('That outline is down to three corners — delete the whole outline instead.');
      return;
    }
    setProblem('');
    onRemovePoint?.(o.id, k);
  };

  const isDragging = (id, k) => !!drag && drag.id === id && drag.index === k;

  const onMouseDown = (e) => {
    // Before the button guard, and before the grip check: a middle press
    // anywhere on this canvas is a pan, including one that lands on a grip or
    // on a finished outline.
    if (startMidPan(e)) return;
    if (panMode || e.evt.button !== 0) return;
    /* THE DOOR STEP, AHEAD OF EVERYTHING. A press that reaches the stage on
       this step landed on the plan rather than on a box — the boxes cancel
       their own bubbling — so it is either a new box being started or the
       selection being dropped. Both, in that order: the band is only a box
       once it has been dragged past the floor above. */
    if (idScreen) {
      const c = cursorAt();
      if (!c) return;
      setDoorSel(null);
      setDoorBand({ x0: c.x, y0: c.y, x1: c.x, y1: c.y });
      return;
    }
    // A mousedown on a grip is the start of a drag, not a corner being placed.
    // The click handler cancels bubbling; mousedown is a separate event and has
    // to be turned away by name.
    if (e.target?.name?.() === 'grip') return;
    const s = recomputeSnap();
    if (!s) return;

    // Measuring the plan for scale. Snapping still applies, and it earns its
    // keep here: a door leaf measured jamb to jamb off a real endpoint beats
    // one measured by eye, and the scale of everything downstream rests on it.
    if (measuring) {
      const m = scaleUI.measure;
      scaleUI.setMeasure(!m.a || m.b ? { a: { x: s.x, y: s.y }, b: null } : { ...m, b: { x: s.x, y: s.y } });
      return;
    }
    if (!hasScale) return;

    if (s.kind === 'close') { finish(); return; }
    setDraft((d) => {
      // Ignore a corner placed on top of the one before it — a stutter on the
      // mouse would otherwise leave a zero-length edge in the outline.
      const prev = d[d.length - 1];
      if (prev && Math.hypot(prev.x - s.x, prev.y - s.y) < 2 / zoom) return d;
      return [...d, { x: s.x, y: s.y }];
    });
    setProblem('');
  };

  /**
   * Close the outline.
   *
   * Deliberately NOT wired to a double-click. Konva decides a double-click
   * purely on the time between two clicks (400ms by default) and ignores where
   * they landed — so clicking two corners of a room in quick succession, which
   * is how anyone traces, registers as a double-click and finishes the outline
   * two corners in. Closing is an explicit act: click the first corner again,
   * press Enter, or use the button.
   *
   * The side effects live out here rather than inside a setDraft updater. An
   * updater has to be pure — React may call it more than once — and calling the
   * parent's onCommit from inside one commits the outline twice.
   */
  const finish = useCallback(() => {
    if (draft.length < 3 || !hasScale) return;
    const v = validateOutline(draft, pxPerFt);
    if (!v.ok) { setProblem(v.reason); return; }
    onCommit(draft);
    setDraft([]);
    setProblem('');
  }, [draft, hasScale, pxPerFt, onCommit]);

  // --- keys ----------------------------------------------------------------
  // THE DRAFT, READ THROUGH A REF. The key handler needs to know whether a trace
  // is in progress, and taking `draft` as a dependency would tear down and
  // rebind three window listeners on every corner clicked.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  /* THE DOOR STEP'S TWO, THROUGH REFS FOR THE SAME REASON. Taking either as a
     dependency would rebind three window listeners on every box clicked. */
  const idScreenRef = useRef(idScreen);
  idScreenRef.current = idScreen;
  const doorSelRef = useRef(doorSel);
  doorSelRef.current = doorSel;
  /* --- ESCAPE THROWS THE TRACE AWAY AND KEEPS THE SCREEN --------------------
     ONE OF THE THREE FLOWS THAT REFUSE TO EXIT. Everywhere else in the app
     Escape stands the whole editor down; here it clears the corners placed so
     far and leaves you on the tracer, because the way OFF this screen is the
     button in the chrome and losing the stage to a mis-hit key would be losing
     the plan you were working over.
     CLAIMED FROM THE HATCH rather than listened for below, so the exemption
     lives next to the state it is about. See src/lib/escapeHatch.js. */
  useEscapeClaim(true, () => {
    /* ON THE DOOR STEP IT DROPS THE GESTURE, not a trace there is none of. */
    if (idScreen) { setDoorBand(null); setDoorMove(null); setDoorSel(null); return; }
    setDraft([]); setProblem('');
  }, 'tracer');
  useEffect(() => {
    const down = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Shift') setShift(true);
      if (e.code === 'Space') { setSpace(true); e.preventDefault(); }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        /* ON THE DOOR STEP THE KEY IS ABOUT THE SELECTED BOX, and about
           nothing else — there is no draft and no outline to be about. The ×
           off the box's corner does the same thing for a hand that never
           learned the key; see the note there on why both exist. */
        if (idScreenRef.current) {
          if (doorSelRef.current) onDeleteDoor?.(doorSelRef.current);
          setDoorSel(null);
          return;
        }
        // TWO MEANINGS, SETTLED BY WHETHER A TRACE IS IN PROGRESS — and that is
        // the only reading that is never ambiguous. Mid-trace this key undoes
        // the last corner and is pressed constantly; with no draft it removes
        // the SELECTED OUTLINE, which is what the cross at the end of the row
        // used to do before the row became the control.
        //
        // Deliberately not gated on the `Delete` key alone. That would be safer
        // against a stray press, and it would also make the feature unreachable
        // on a laptop keyboard without fn — which is most of them.
        if (draftRef.current.length) {
          setDraft((d) => d.slice(0, -1));
          setProblem('');
          return;
        }
        if (selectedId && onDeleteOutline) onDeleteOutline(selectedId);
      }
      if (e.key === 'Enter') finish();
      if (e.key === 'o' || e.key === 'O') setOrthoLock((v) => !v);
      if (e.key === 'a' || e.key === 'A') setAlignOn((v) => !v);
      if (e.key === 'f' || e.key === 'F') fit();
    };
    const up = (e) => {
      if (e.key === 'Shift') setShift(false);
      if (e.code === 'Space') setSpace(false);
    };
    const blur = () => { setShift(false); setSpace(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [finish, fit, selectedId, onDeleteOutline, onDeleteDoor]);

  const onWheel = (e) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const old = zoom;
    const to = { x: (pointer.x - pos.x) / old, y: (pointer.y - pos.y) / old };
    const next = Math.min(24, Math.max(0.04, old * (e.evt.deltaY > 0 ? 1 / 1.09 : 1.09)));
    setZoom(next);
    setPos({ x: pointer.x - to.x * next, y: pointer.y - to.y * next });
  };

  // --- derived -------------------------------------------------------------
  const px = (n) => n / zoom;              // screen px -> plan units
  const stats = useMemo(
    () => (hasScale ? liveOutlines.map((o) => ({ o, st: outlineStats(o, pxPerFt) })) : []),
    [liveOutlines, pxPerFt, hasScale]);
  const chosen = stats.find((s) => s.o.id === selectedId) || null;

  const widthFt = isRaster ? (hasScale ? source.w / pxPerFt : null) : source.widthFt;
  const heightFt = isRaster ? (hasScale ? source.h / pxPerFt : null) : source.heightFt;

  // The length of the edge being drawn. Suppressed below an inch: straight
  // after a click the cursor is still on the corner it just placed, and a
  // label reading 0'0" beside the snap glyph is noise.
  const draftFt = useMemo(() => {
    if (draft.length < 1 || !hasScale) return null;
    const last = draft[draft.length - 1];
    if (!snap || snap.kind === 'close') return null;
    const d = Math.hypot(snap.x - last.x, snap.y - last.y) / pxPerFt;
    return d < 1 / 12 ? null : d;
  }, [draft, snap, pxPerFt, hasScale]);

  const measureLen = (() => {
    const m = scaleUI?.measure;
    return m?.a && m?.b ? Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y) : 0;
  })();

  /* --- THE DETECTOR IS STILL OUT AND THE PLAN IS STILL EMPTY --------------
     A NEW STATE, AND READING THE SCALE OFF THE DRAWING IS WHAT CREATED IT.
     The door step used to stand here for as long as the segmenter took, so by
     the time anybody reached this screen the spaces were already on the plan.
     A drawing that dimensions itself skips that step entirely and lands here
     immediately — where the old copy said "Nothing traced yet. Click a corner
     on the plan to start", which is an instruction to do by hand the work that
     is already under way, and a count of zero for a list that is still being
     written.

     `!outlines.length` KEEPS IT OUT OF THE WAY OF A RERUN. Asking for the
     spaces again on a plan that already has some must not blank the list and
     put this over the top of it — the existing outlines stay on screen and
     the panel's own line reports the second pass. */
  const finding = hasScale && !stepScreen && !outlines.length
    && detectState?.status === 'running';

  const headline = idScreen ? 'Check the doors'
    : measuring ? 'Measure the plan'
    // READING IS NOT "SET THE SCALE FIRST". For the second or two the drawing is
    // being read, the honest headline is that it is being read — telling somebody
    // to set a scale that is about to arrive on its own asks for work twice.
    : scalePending ? 'Reading the drawing'
    : doorScreen ? 'Pick a door'
    : !hasScale ? 'Set the scale first'
    : tracing ? 'Tracing…'
    : finding ? 'Finding the spaces'
    : outlines.length ? `${outlines.length} outline${outlines.length > 1 ? 's' : ''}`
    : 'Trace the space';

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="mb-4">
        <h2 className=" mt-2 mx-0 mb-3 text-[26px]
          text-white whitespace-nowrap">{headline}</h2>
        {/* WHAT THE DRAWING SAID ABOUT ITS OWN SIZE. Above the step's own copy
            because it is the reason that step is the one on screen: either the
            scale came off the sheet and there is nothing to answer, or it could
            not, and the sentence says why a door is being asked for. */}
        {dimensionNote && (
          <p className="m-0 mb-2 text-[13px] text-subtle max-w-[78ch]">{dimensionNote}</p>
        )}
        <p className="m-0 text-muted max-w-[78ch]">
          {idScreen
            ? <>Every switchboard is placed beside a door, and the scale comes off
                one — so the set has to be right before either. Add what was
                missed, throw out what is not a door.</>
            : measuring
            ? <>Click the two ends of something you can name, then say what it is.</>
            : doorScreen
              ? <>A door is a known width, so one of them gives the whole drawing
                  its scale. Click one on the plan.</>
            : !hasScale
              && <>Set the scale on the right first — an image does not say how big it is.</>
              }
        </p>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-[18px] items-start
        [@media(max-width:1080px)]:grid-cols-[minmax(0,1fr)]">
        <div ref={wrapRef}
          className="bg-surface backdrop-blur-[5px] backdrop-saturate-[1.8]
            border border-border/10 rounded-[12px] min-w-0
            relative p-0 overflow-hidden h-[calc(100vh-262px)] min-h-[380px]"
          onAuxClick={(e) => e.preventDefault()}
          style={{ cursor: midPan ? 'grabbing'
            : panMode ? 'grab'
            /* The doors are the only targets, and each one sets `pointer` for
               itself. Plain default over the rest of the plan — `not-allowed`
               reads as "this screen is broken" when it is simply waiting. */
            : doorScreen ? 'default'
            /* THE DOOR STEP IS A DRAWING GESTURE, and the crosshair is what
               says so before anybody presses. The boxes set their own cursor
               over themselves. */
            : idScreen ? 'crosshair'
            : canTrace || measuring ? 'crosshair' : 'not-allowed' }}>
          <Stage
            ref={stageRef}
            width={SW} height={SH}
            scaleX={zoom} scaleY={zoom} x={pos.x} y={pos.y}
            draggable={panMode}
            /* ONLY THE STAGE'S OWN DRAG MOVES THE STAGE.
               Konva bubbles a child's drag events up to the stage, so a grip's
               dragend arrived here too — and this handler read `e.target.x()`,
               which was then the GRIP's coordinate, and panned the plan to it.
               The plan flew off screen on the first nudge and every grip after
               that was outside the canvas, so nothing could be dragged again.
               "The whole plan vanishes as soon as I move a vertex" was this one
               line. Guarding on the target is the fix; it also covers anything
               draggable added here later. */
            onDragEnd={(e) => {
              if (e.target !== stageRef.current) return;
              setPos({ x: e.target.x(), y: e.target.y() });
            }}
            onMouseMove={onMouseMove}
            onMouseDown={onMouseDown}
            onWheel={onWheel}
            onMouseLeave={() => setSnap(null)}
          >
            {/* the plan */}
            {/* THE INVERSION HAS TO BE PUT ON THE CANVAS BY HAND HERE, and that
                is the whole reason this layer has a ref. Konva paints each Layer
                into its own `<canvas>`, and a `<canvas>` is opaque to anything
                Tailwind or JSX can say about its contents — there is no element
                per shape to hang a class on. What there IS is exactly one DOM
                node per layer, and this layer holds the scan and nothing else,
                so the same `.plan-invert` rule the SVG renderer uses inverts
                precisely the plan and leaves every outline, grip and guide on
                the layers above it alone.
                RASTER ONLY: on a DXF this layer holds our own paths, drawn by us
                in colours we chose, and inverting those inverts our ink rather
                than the plan. */}
            <Layer listening={false} ref={planLayer}>
              {isRaster
                ? source.el && <KImage image={source.el} width={source.w} height={source.h} />
                : <>
                    {source.render.filter((l) => visible.has(l.layer)).map((l) => (
                      <Path key={l.layer} data={l.path} stroke="#6E6E6E"
                        strokeWidth={1} strokeScaleEnabled={false} opacity={0.75} />
                    ))}
                    {source.circlesPx.filter((c) => visible.has(c.layer)).map((c, i) => (
                      <Circle key={'c' + i} x={c.cx} y={c.cy} radius={c.r} stroke="#6E6E6E"
                        strokeWidth={1} strokeScaleEnabled={false} opacity={0.6} />
                    ))}
                  </>}
            </Layer>

            {/* the outlines: traced by hand, or proposed by the detector */}
            <Layer listening={!tracing}>
              {(stepScreen ? [] : stats).map(({ o, st }, i) => {
                const col = FILL[i % FILL.length];
                const on = o.id === selectedId;
                // A proposal is drawn DASHED until it has been touched or
                // confirmed. The distinction is worth a stroke style: a solid
                // line is a boundary someone has agreed to, and lighting a plan
                // off four polygons nobody has looked at is exactly the failure
                // the old green-marker route used to produce.
                const provisional = o.detected && !o.reviewed;
                return (
                  <Group key={o.id} onClick={() => onSelect(o.id)} onTap={() => onSelect(o.id)}
                    onMouseEnter={() => setHoverSpace(o.id)}
                    onMouseLeave={() => setHoverSpace((h) => (h === o.id ? null : h))}>
                    {st.rectified && st.movedFt > 0.08 && (
                      <Line points={flat(st.rawPx)} closed stroke={col} dash={[4, 4]}
                        strokeWidth={1} strokeScaleEnabled={false} opacity={0.5} />
                    )}
                    {/* HOVER THICKENS THE OUTLINE, and only the outline. The
                        fill is already carrying identity — its hue is this
                        space's hue — so brightening it on hover would read as a
                        change of state rather than a change of cursor. */}
                    <Line points={flat(st.polygonPx)} closed
                      fill={col} opacity={on ? 0.26 : 0.1}
                      stroke={col}
                      strokeWidth={(on ? 2.6 : 1.6)
                        + (hoverSpace === o.id ? 1.2 : 0)}
                      dash={provisional ? [10, 6] : null}
                      strokeScaleEnabled={false} lineJoin="round" />
                  </Group>
                );
              })}
            </Layer>

            {/* THE GRIPS.
                Their own layer, above the fills, because a handle you cannot hit
                is not a handle — inside the outline group the polygon's own fill
                takes the pointer at the edges, which is precisely where every
                corner is. Hidden while a trace is in progress: mid-trace every
                click belongs to the draft. */}
            {showGrips && !tracing && hasScale && !stepScreen && (
              <Layer>
                {liveOutlines.map((o, i) => {
                  const col = FILL[i % FILL.length];
                  const on = o.id === selectedId;
                  const pts = o.pointsPx;
                  return (
                    <Group key={o.id}>
                      {/* Insert a corner. Only on the selected outline, and only
                          on an edge long enough to have a middle worth clicking
                          — a plan with four rooms otherwise carries forty
                          handles and the corners get lost among them. */}
                      {on && pts.map((pt, k) => {
                        const q = pts[(k + 1) % pts.length];
                        if (Math.hypot(q.x - pt.x, q.y - pt.y) < px(26)) return null;
                        const m = { x: (pt.x + q.x) / 2, y: (pt.y + q.y) / 2 };
                        return (
                          <Rect key={'m' + k} name="grip"
                            x={m.x} y={m.y} width={px(6.5)} height={px(6.5)}
                            offsetX={px(3.25)} offsetY={px(3.25)} rotation={45}
                            fill="#fff" stroke={col} strokeWidth={1.4}
                            strokeScaleEnabled={false} opacity={0.95}
                            onClick={(e) => { e.cancelBubble = true; onInsertPoint?.(o.id, k + 1, m); }}
                            onTap={(e) => { e.cancelBubble = true; onInsertPoint?.(o.id, k + 1, m); }} />
                        );
                      })}

                      {pts.map((pt, k) => (
                        <Circle key={'g' + k} name="grip"
                          x={pt.x} y={pt.y} radius={px(on ? 5.5 : 4.2)}
                          fill={isDragging(o.id, k) ? SNAPCOL : '#fff'}
                          stroke={isDragging(o.id, k) ? SNAPCOL : col}
                          strokeWidth={on ? 2.2 : 1.5} strokeScaleEnabled={false}
                          draggable
                          onDragStart={() => { onSelect(o.id); setDrag({ id: o.id, index: k, x: pt.x, y: pt.y, snap: null }); }}
                          onDragMove={(e) => {
                            const sp = snapForDrag(o, k, e.target.position());
                            // Put the node exactly where the snap says. Konva
                            // has already moved it to the raw cursor; leaving it
                            // there and only storing the snapped point makes the
                            // handle and the outline disagree under the hand.
                            e.target.position({ x: sp.x, y: sp.y });
                            setDrag({ id: o.id, index: k, x: sp.x, y: sp.y, snap: sp });
                          }}
                          onDragEnd={(e) => {
                            const at = e.target.position();
                            setDrag(null);
                            onMovePoint?.(o.id, k, { x: at.x, y: at.y });
                          }}
                          onClick={(e) => {
                            e.cancelBubble = true;
                            if (e.evt.altKey) removeCorner(o, k); else onSelect(o.id);
                          }}
                          onContextMenu={(e) => {
                            e.evt.preventDefault(); e.cancelBubble = true; removeCorner(o, k);
                          }} />
                      ))}
                    </Group>
                  );
                })}

                {/* What the dragged corner has caught on. The same guide and the
                    same glyph as tracing, for the same reason: a corner that
                    moved four inches on its own needs to say why. */}
                {drag?.snap?.guide && (
                  <Line listening={false}
                    points={drag.snap.guide.axis === 'x'
                      ? [drag.snap.guide.from.x, drag.snap.guide.from.y, drag.x, drag.snap.guide.from.y]
                      : [drag.snap.guide.from.x, drag.snap.guide.from.y, drag.snap.guide.from.x, drag.y]}
                    stroke={GUIDE} strokeWidth={1} strokeScaleEnabled={false}
                    dash={[3, 3]} opacity={0.9} />
                )}
                {drag?.snap?.align?.map((pt, i) => (
                  <Line key={'dal' + i} listening={false}
                    points={[pt.x, pt.y, drag.x, drag.y]}
                    stroke={GUIDE} strokeWidth={1} strokeScaleEnabled={false}
                    dash={[2, 4]} opacity={0.75} />
                ))}
                {drag?.snap && <SnapGlyph snap={drag.snap} px={px} />}
              </Layer>
            )}

            {/* the trace in progress */}
            <Layer listening={false}>
              {ortho && snap?.guide && draft.length > 0 && (
                <Line
                  points={snap.guide.axis === 'x'
                    ? [snap.guide.from.x, snap.guide.from.y, snap.x, snap.guide.from.y]
                    : [snap.guide.from.x, snap.guide.from.y, snap.guide.from.x, snap.y]}
                  stroke={GUIDE} strokeWidth={1} strokeScaleEnabled={false}
                  dash={[3, 3]} opacity={0.9} />
              )}

              {/* Which corners the cursor lined up with. Without these the point
                  lands somewhere the drawing does not explain — the alignment is
                  the whole reason it went there, so it has to be visible. */}
              {snap?.align?.map((p, i) => (
                <Line key={'al' + i} points={[p.x, p.y, snap.x, snap.y]}
                  stroke={GUIDE} strokeWidth={1} strokeScaleEnabled={false}
                  dash={[2, 4]} opacity={0.75} />
              ))}
              {snap?.align?.map((p, i) => (
                <Rect key={'ap' + i} x={p.x} y={p.y} width={px(4)} height={px(4)}
                  offsetX={px(2)} offsetY={px(2)} stroke={GUIDE} strokeWidth={1}
                  strokeScaleEnabled={false} />
              ))}

              {draft.length > 0 && (
                <Line points={flat(draft)} stroke={DRAFT} strokeWidth={2.2}
                  strokeScaleEnabled={false} lineJoin="round" />
              )}
              {draft.length > 0 && snap && (
                <Line points={[draft[draft.length - 1].x, draft[draft.length - 1].y, snap.x, snap.y]}
                  stroke={DRAFT} strokeWidth={1.6} strokeScaleEnabled={false} dash={[6, 4]} />
              )}
              {draft.length > 2 && snap && (
                <Line points={[snap.x, snap.y, draft[0].x, draft[0].y]}
                  stroke={DRAFT} strokeWidth={1} strokeScaleEnabled={false}
                  dash={[2, 5]} opacity={0.5} />
              )}
              {draft.map((p, i) => (
                <Rect key={i} x={p.x} y={p.y} width={px(5)} height={px(5)}
                  offsetX={px(2.5)} offsetY={px(2.5)} fill={DRAFT} />
              ))}

              {/* the measuring line, when the scale is being set off the plan */}
              {scaleUI?.measure?.a && (
                <Group listening={false}>
                  <Line points={[scaleUI.measure.a.x, scaleUI.measure.a.y,
                                 (scaleUI.measure.b || snap || scaleUI.measure.a).x,
                                 (scaleUI.measure.b || snap || scaleUI.measure.a).y]}
                    stroke="#0070F3" strokeWidth={2} strokeScaleEnabled={false}
                    dash={scaleUI.measure.b ? null : [6, 4]} />
                  {[scaleUI.measure.a, scaleUI.measure.b].filter(Boolean).map((p, i) => (
                    <Line key={'t' + i} points={[p.x, p.y - px(7), p.x, p.y + px(7)]}
                      stroke="#0070F3" strokeWidth={2} strokeScaleEnabled={false} />
                  ))}
                </Group>
              )}

              {snap && <SnapGlyph snap={snap} px={px} />}

              {draftFt != null && snap && (
                <Text x={snap.x} y={snap.y} offsetX={px(-10)} offsetY={px(20)}
                  text={ftin(draftFt)} fontSize={px(11)}
                  fontFamily="The Neue Montreal, sans-serif" fill="#000000" />
              )}
            </Layer>

            {/* THE DOORS GET THEIR OWN LISTENING LAYER, and that is the whole
                reason this is not folded into the layer above it. Everything
                drawn on top of the plan here lives in `listening={false}`
                layers, because it is annotation — a snap glyph, a guide, the
                measuring line — and annotation must never eat a click meant for
                the drawing underneath.

                A door box is not annotation. It is a BUTTON, and a button in a
                layer that does not listen is a button that cannot be pressed:
                the boxes drew perfectly, the cursor never changed, and clicking
                one did nothing at all. Same family as the sconce whose grab area
                was painted under its own symbol — a control that looks right and
                is not reachable. Second from last inside the Stage, under the
                door STEP's layer below — and the two never show together, so
                the order between them is a reading convenience rather than a
                rule: they are the two things done to a door box, in the order
                they are done. */}
            <Layer listening={pickingDoor}>
                {/* THE DOORS, offered as things to click.
                    Filled with the primary colour rather than merely outlined —
                    an outline on a drawing that is already all outlines is one
                    more rectangle to be squinted at, and these are not annotation,
                    they are BUTTONS. The one closest to the median opening is
                    marked as the suggestion, because the user is about to pick a
                    ruler for the whole drawing and the most typical door is the
                    safest thing to measure. */}
                {pickingDoor && (scaleUI.doors || []).map((d) => {
                  const on = scaleUI.pick?.id === d.id;
                  return (
                    <Rect key={d.id}
                      x={d.rect.x0} y={d.rect.y0}
                      width={d.rect.x1 - d.rect.x0} height={d.rect.y1 - d.rect.y0}
                      /* THE ACCENT, and not the violet this shipped with. The
                         palette went black-and-white-plus-#0070F3 and this fill
                         was left behind at rgba(97,97,245) — near enough to the
                         accent to look intentional and far enough to look like
                         a second brand colour on a screen that has one thing
                         on it. */
                      fill={on ? 'rgba(0,112,243,0.42)' : 'rgba(0,112,243,0.20)'}
                      stroke="#0070F3"
                      /* HOVER THICKENS THE OUTLINE and leaves the fill alone.
                         The stroke is the cheapest thing on this shape to
                         change: the fill already carries "these are the doors",
                         and a second fill value competing with the selected
                         state would say the wrong thing. */
                      strokeWidth={px((on ? 2.4 : d.typical ? 1.8 : 1.2)
                        + (hoverDoor === d.id ? 1.4 : 0))}
                      dash={d.typical && !on ? [px(6), px(4)] : null}
                      listening
                      onMouseEnter={(e) => {
                        setHoverDoor(d.id);
                        const st = e.target.getStage(); if (st) st.container().style.cursor = 'pointer';
                      }}
                      onMouseLeave={(e) => {
                        setHoverDoor((h) => (h === d.id ? null : h));
                        const st = e.target.getStage(); if (st) st.container().style.cursor = '';
                      }}
                      onMouseDown={(e) => {
                        if (e.evt.button !== 0) return;   // middle is the pan
                        e.cancelBubble = true;
                        scaleUI.onPickDoor(d.id);
                      }} />
                  );
                })}
            </Layer>

            {/* --- THE DOOR STEP'S OWN LAYER ---------------------------
                THE DESIGN SCREEN'S VOCABULARY, DRAWN IN KONVA. The same
                switchboard blue, the same light wash, the same corner marks on
                the selected box and the same × off its top-right — because it
                is the same question asked about the same objects, and teaching
                two gestures for one job is how somebody learns neither. See
                the door editor in PlanCanvas for the original.
                LISTENING ONLY WHILE THE STEP IS UP. Off it, these are twelve
                blue rectangles over a drawing somebody is trying to trace, and
                a layer that answers the pointer would eat every corner click
                that happened to land on one. */}
            <Layer listening={idScreen}>
              {idScreen && doorBoxes.map((d) => {
                if (!d.rect) return null;
                const r = d.rect;
                const on = d.id === doorSel;
                return (
                  <Group key={'de' + d.id}>
                    <Rect
                      x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0}
                      fill={SB_COLOUR} opacity={on ? 0.18 : 0.10}
                      onMouseEnter={(e) => {
                        const st = e.target.getStage(); if (st) st.container().style.cursor = 'move';
                      }}
                      onMouseLeave={(e) => {
                        const st = e.target.getStage(); if (st) st.container().style.cursor = '';
                      }}
                      /* THE WHOLE BOX IS THE MOVE HANDLE, which is why the ×
                         is outside it. `cancelBubble` is what keeps this press
                         off the stage below, where it would start sweeping a
                         second box out from inside the first. */
                      onMouseDown={(e) => {
                        if (e.evt.button !== 0) return;   // middle is the pan
                        e.cancelBubble = true;
                        const c = cursorAt();
                        if (!c) return;
                        setDoorSel(d.id);
                        setDoorMove({ id: d.id, from: r, rect: r,
                                      ox: c.x, oy: c.y, moved: false });
                      }} />
                    {/* THE STROKE IS ITS OWN SHAPE AND DOES NOT LISTEN, so the
                        fill above is the single hit target for the box. */}
                    <Rect listening={false}
                      x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0}
                      stroke={SB_COLOUR} strokeWidth={on ? 2.6 : 1.7}
                      strokeScaleEnabled={false} />
                    {/* THE CORNERS, ON THE SELECTED ONE ONLY. Not resize grips
                        and deliberately not drawn as any: they say which box
                        the keyboard and the × are about. */}
                    {on && [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]
                      .map(([cx, cy], k) => (
                        <Rect key={k} listening={false}
                          x={cx} y={cy} width={px(5)} height={px(5)}
                          offsetX={px(2.5)} offsetY={px(2.5)}
                          fill="#fff" stroke={SB_COLOUR} strokeWidth={1.4}
                          strokeScaleEnabled={false} />
                      ))}
                    {/* ...AND THE ONE WAY TO THROW IT AWAY WITH A MOUSE.
                        Delete and Backspace do the same thing and are what a
                        hand on a keyboard reaches for; this is here because a
                        step somebody is walked through cannot hide its only
                        destructive act behind a shortcut nobody was told
                        about. OUTSIDE THE BOX, because every pixel inside it
                        drags. */}
                    {on && onDeleteDoor && (
                      <Group
                        x={r.x1 + px(9)} y={r.y0 - px(9)}
                        onMouseEnter={(e) => {
                          const st = e.target.getStage(); if (st) st.container().style.cursor = 'pointer';
                        }}
                        onMouseLeave={(e) => {
                          const st = e.target.getStage(); if (st) st.container().style.cursor = '';
                        }}
                        onMouseDown={(e) => {
                          if (e.evt.button !== 0) return;
                          e.cancelBubble = true;
                          onDeleteDoor(d.id);
                          setDoorSel(null);
                        }}>
                        <Circle radius={px(8)} fill="#fff"
                          stroke={SB_COLOUR} strokeWidth={1.6} strokeScaleEnabled={false} />
                        <Line points={[-px(3.4), -px(3.4), px(3.4), px(3.4)]}
                          stroke={SB_COLOUR} strokeWidth={1.7}
                          strokeScaleEnabled={false} lineCap="round" listening={false} />
                        <Line points={[px(3.4), -px(3.4), -px(3.4), px(3.4)]}
                          stroke={SB_COLOUR} strokeWidth={1.7}
                          strokeScaleEnabled={false} lineCap="round" listening={false} />
                      </Group>
                    )}
                  </Group>
                );
              })}

              {/* The box being swept out. Same wash, no marks: it is not a
                  state, it is a gesture in progress. */}
              {idScreen && doorBand && (
                <Rect listening={false}
                  x={Math.min(doorBand.x0, doorBand.x1)}
                  y={Math.min(doorBand.y0, doorBand.y1)}
                  width={Math.abs(doorBand.x1 - doorBand.x0)}
                  height={Math.abs(doorBand.y1 - doorBand.y0)}
                  fill={SB_COLOUR} opacity={0.14}
                  stroke={SB_COLOUR} strokeWidth={2} strokeScaleEnabled={false} />
              )}
            </Layer>
          </Stage>

          {/* Only what changes as you work. The keyboard reference that used to
              live here — scroll to zoom, middle-drag or space to pan, F to fit —
              was static text taking up a third of the bar. */}
          <div className={HUD}>
            {midPan && <span className={CHIP_ON}>panning</span>}
            {!stepScreen && <>
            {!ortho && <span className={CHIP}>free angle</span>}
            {drag && <span className={CHIP_ON}>{shift ? 'nudging · square' : 'nudging · free'}</span>}
            {(drag?.snap || (!drag && snap)) && (
              <span className={CHIP_ON}>{(drag?.snap || snap).label}</span>
            )}
            </>}
          </div>
        </div>

        {/* `door-only` MADE THIS PANEL A COLUMN so the one question in it could
            sit in the middle. Same rule, now on the element that has it. */}
        {/* THE SAME SURFACE AS THE LAYOUT SCREEN'S FLOATING WINDOW, and now
            literally the same token: this IS that panel, one step earlier, so
            `--color-panel` paints both. It was `bg-grid` (#232323) against the
            window's `bg-panel` (#171717) — two near-blacks a step apart for one
            panel, which reads as the thing changing colour when you move
            between the two screens rather than as two surfaces.
            THE BLUR AND THE SATURATION WENT WITH IT. `--color-panel` is opaque,
            so a backdrop filter under it composites against nothing. */}
        <div className={'bg-panel '
          + 'border border-border/10 rounded-[12px] p-3.5 overflow-auto '
          + 'max-h-[calc(100vh-260px)] [@media(max-width:1080px)]:max-h-none '
          + (stepScreen
            ? 'h-[calc(100vh-262px)] [@media(max-width:1080px)]:h-auto flex flex-col'
            : '')}>

          {/* --- IDENTIFY THE DOORS, AND THE PANEL HOLDS NOTHING ELSE -------
              THE DESIGN SCREEN'S DOOR STEP, WORD FOR WORD AND PICTURE FOR
              PICTURE. It is the same question about the same boxes, moved to
              the front of the flow (see `idScreen`), and asking it in a second
              voice here would make one job read as two.
              THE QUESTION IS ONE LINE AND THE CARD UNDER IT IS THE
              INSTRUCTION: what to do is a sentence, HOW to do it is a picture
              of the gesture. Somebody who has drawn one of these before does
              not read the card, and somebody who has not cannot be told "draw
              a box" in words that mean anything until they have seen it. */}
          {idScreen && (
            <div className={`${SEC} flex-1 flex flex-col min-h-0`}>
              <div className="flex-1 flex flex-col items-center justify-center gap-4
                text-center px-1 py-6">
                <p className="m-0 text-[17px] leading-[1.32] tracking-[-0.02em]
                  text-white max-w-[22ch]">Please confirm that all doors are identified</p>

                {/* THE GESTURE, DRAWN — the door editor's own graphic, because
                    it is the same gesture: a dashed box with a live corner and
                    the pointer sweeping it out, over the plan's mark for a
                    door, in the switchboard's blue. */}
                <div className="flex flex-col items-center gap-2 px-4 pt-3.5 pb-3
                  border border-border/10 rounded-[10px] bg-white/5 text-center">
                  <svg viewBox="0 0 72 46" aria-hidden="true"
                    className="w-[72px] h-[46px] block overflow-visible">
                    <g stroke="var(--text-subtle)" strokeWidth="1.3" fill="none"
                      strokeLinecap="round" opacity="0.75">
                      <path d="M11 30h4M39 30h5" />
                      <path d="M15 30V12" />
                      <path d="M15 12a18 18 0 0 1 18 18" />
                    </g>
                    <rect x="7" y="7" width="44" height="28" rx="2"
                      fill={SB_COLOUR} fillOpacity="0.10"
                      stroke={SB_COLOUR} strokeWidth="1.4" strokeDasharray="4 3" />
                    <circle cx="7" cy="7" r="2" fill={SB_COLOUR} />
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

                {/* THE COUNT, AND IT IS THE ONLY NUMBER HERE. What is being
                    asked is whether the set is complete, and the one thing
                    nobody can see by looking at the plan is how many boxes are
                    on it — a door under a fitting, off the fold, or twice. */}
                {/* ...AND THE ANSWER IS NOT OFFERED UNTIL THERE IS ONE TO
                    GIVE. "There are no doors" over a search that has not come
                    back is the app inviting somebody to confirm an empty set
                    it is about to fill in underneath them — and a button
                    disabled instead would be a dead control, because a
                    disabled button on this panel is drawn at full strength.
                    So while the detector is out, the line IS the state and
                    there is nothing to press. */}
                {looking ? (
                  <p className={`${N} m-0`}>Looking for doors…</p>
                ) : (<>
                  <p className={`${N} m-0`}>
                    {doorBoxes.length} box{doorBoxes.length === 1 ? '' : 'es'} on the plan
                  </p>
                  <button className={`${BTN_PRIMARY} w-full`}
                    onClick={() => onConfirmDoors?.()}>
                    {doorBoxes.length ? 'These are all the doors' : 'There are no doors'}
                  </button>
                </>)}
              </div>
            </div>
          )}

          {/* --- the scale, on an image ------------------------------------ */}
          {isRaster && scaleUI && !idScreen && (
            <div className={SEC + (doorScreen ? ' flex flex-col flex-1 min-h-0' : '')}>
              <h3 className={H3}>Scale{hasScale ? '' : ' — needed first'}</h3>
              <div className={SEG}>
                {[['door', 'Doors'], ['ref', 'Measure']].map(([k, l]) => (
                  <button key={k} className={scaleUI.mode === k ? SEG_BTN_ON : SEG_BTN}
                    onClick={() => scaleUI.setMode(k)}>{l}</button>
                ))}
              </div>

              {/* --- from a door ------------------------------------------- */}
              {scaleUI.mode === 'door' && (<>
                {scaleUI.doorState?.status === 'running' && (
                  <p className={NOTE}>Looking for doors…</p>
                )}

                {scaleUI.doorState?.status === 'error' && (
                  <p className={NOTE_WARN}>
                    The door detector could not be reached. Measure something instead.
                  </p>
                )}

                {scaleUI.doorState?.status === 'done' && !scaleUI.doors.length && (
                  <p className={NOTE_WARN}>
                    No doors found on this plan. Measure something instead.
                  </p>
                )}

                {/* TWO SENTENCES, CENTRED IN THE PANEL, and the second one is
                    the escape hatch. The count of doors found and which of them
                    is the most typical were facts about the detector, not
                    instructions. And note size in the top-left corner of an
                    otherwise empty panel reads as a caption on nothing: this is
                    the only instruction on the screen, so it is set at display
                    size and given the whole panel to sit in the middle of. */}
                {!!scaleUI.doors.length && !picked && (
                  <div className="flex-1 flex flex-col justify-center items-center
                    text-center gap-2.5 px-1 py-4 [@media(max-width:1080px)]:py-[22px]">
                    <p className="m-0 text-[17px] leading-[1.32] tracking-[-0.02em]
                      text-white max-w-[20ch]">Select a door whose dimension you know.</p>
                    <p className="m-0 text-[12px] leading-[1.5] text-muted max-w-[28ch]">
                      If you wish to proceed with another dimension, click on the
                      Measure tab above.
                    </p>
                  </div>
                )}

                {/* THE QUESTION, asked only once a door is clicked. Three
                    buttons and not a dropdown: they are the whole vocabulary of
                    door widths, they are short, and a dropdown would hide two
                    of the three behind a click.
                    AND THEN A FOURTH WAY IN. The three cover the built world,
                    but a drawing that STATES a width — a dimension string, a
                    door schedule — knows better than the list does, and refusing
                    it refuses the one input more reliable than the guess. It is
                    below the three rather than among them because it is the
                    exception: a full-width row reads as "or, if you know". */}
                {picked && (<>
                  <p className={`${N} mt-2 mb-1.5`}>
                    How wide is this door? Its opening measures{' '}
                    <b>{picked.openingPx.toFixed(0)} px</b>.
                  </p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {scaleUI.widths.map((w) => (
                      <button key={w.mm}
                        className={scaleUI.pick?.mm === w.mm && !isCustomMm ? BTN_DOOR_CTA : BTN_DOOR}
                        onClick={() => { setCustomOpen(false); scaleUI.onSetWidth(w.mm); }}
                        title={w.note}>{w.label}</button>
                    ))}
                  </div>

                  {!customOpen ? (
                    <button className={BTN_CUSTOM}
                      onClick={() => {
                        // Seed the field with the width already in force, so
                        // "Custom — 825mm" opens on 825 rather than on empty.
                        if (isCustomMm && !customMm.trim()) setCustomMm(String(scaleUI.pick.mm));
                        setCustomOpen(true);
                      }}>
                      {isCustomMm ? `Custom — ${scaleUI.pick.mm}mm` : 'Enter a custom width…'}
                    </button>
                  ) : (
                    <div className="mt-1.5 p-2 rounded bg-white/5 backdrop-blur-[5px] border border-border/10">
                      <label className="block text-[11px] text-subtle mb-1"
                        htmlFor="door-custom-mm">Door width</label>
                      <div className="flex items-center gap-1.5">
                        {/* type=text, not number. A number input silently eats a
                            typed comma, spins the value on a stray scroll over
                            it, and hides the one thing worth showing here —
                            WHY a value was refused. */}
                        <input id="door-custom-mm" type="text" inputMode="numeric"
                          className="flex-1 min-w-0"
                          autoFocus value={customMm}
                          placeholder="e.g. 825"
                          onChange={(e) => setCustomMm(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && customParsed.ok) {
                              scaleUI.onSetWidth(customParsed.mm);
                            }
                            if (e.key === 'Escape') setCustomOpen(false);
                          }} />
                        <span className="text-[11.5px] text-subtle">mm</span>
                        <button className={`${BTN_USE} flex-none`} disabled={!customParsed.ok}
                          onClick={() => scaleUI.onSetWidth(customParsed.mm)}>Use</button>
                      </div>
                      {/* THE REFUSAL SAYS WHY. This one number divides the whole
                          plan — every cell, every fitting, the BOQ — so a typed
                          90 where 900 was meant does not fail, it produces a
                          drawing at ten times the scale that looks plausible
                          until somebody orders from it. */}
                      {customMm.trim() && !customParsed.ok && (
                        <p className={`${NW} mt-1.5`}>
                          {customParsed.why}
                        </p>
                      )}
                      {customParsed.ok && (
                        <p className={`${N} mt-1.5`}>
                          That makes this plan{' '}
                          <b>{(picked.openingPx / (customParsed.mm / 304.8)).toFixed(1)} px/ft</b>.
                        </p>
                      )}
                    </div>
                  )}

                  {scaleUI.pick?.mm && (
                    <button className={`${BTN_FULL} mt-1.5`}
                      onClick={() => scaleUI.onPickDoor(null)}>Pick a different door</button>
                  )}
                </>)}

              </>)}

              {scaleUI.mode === 'ref' && (<>
                <select value={scaleUI.refId} onChange={(e) => scaleUI.setRefId(e.target.value)}>
                  {['Door', 'Furniture', 'Sanitary', 'Kitchen', 'Fan', 'Other'].map((g) => (
                    <optgroup key={g} label={g}>
                      {REFERENCES.filter((r) => r.group === g).map((r) => (
                        <option key={r.id} value={r.id}>{r.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {scaleUI.refId === 'custom' && (
                  <div className={`${ROW} mt-2`}>
                    <label>Real length (ft)</label>
                    <input type="number" step="0.05" value={scaleUI.customFt} style={{ maxWidth: 90 }}
                      onChange={(e) => scaleUI.setCustomFt(parseFloat(e.target.value) || 0)} />
                  </div>
                )}
                <div className={`${KV} mt-2`}>
                  <span>{!scaleUI.measure.a ? 'Click the first end'
                    : !scaleUI.measure.b ? 'Click the other end' : 'Measured'}</span>
                  <b>{measureLen ? `${measureLen.toFixed(0)} px` : '—'}</b>
                </div>
                {scaleUI.measure.a && scaleUI.measure.b && !measureDone && (
                  <button className={`${BTN_PRIMARY_FULL} mt-2`}
                    onClick={() => setMeasureDone(true)}>
                    Use this measurement →
                  </button>
                )}
                {scaleUI.measure.a && (
                  <button className={`${BTN} mt-1.5`}
                    onClick={() => { scaleUI.setMeasure({ a: null, b: null }); setMeasureDone(false); }}>
                    Measure again</button>
                )}
              </>)}

              {/* NO SCALE READOUT AND NO PLAN SIZE HERE ANY MORE. Both were
                  standing figures on a screen whose whole job is the list of
                  spaces: "24.3 px/ft" is the app's own arithmetic shown back,
                  and the plan's overall size is the one measurement nobody is
                  on this screen to take. The scale is still SETTABLE — the two
                  tabs above are untouched — it just stops narrating itself.
                  A DXF states its size in "The file" below, which is where a
                  fact about the file belongs. */}
            </div>
          )}

          {/* --- 4. EVERY SPACE ON THE PLAN, IN ONE SECTION ---------------
              The detector's tally and the list of what it produced were two
              sections with three sections of unrelated controls between them —
              "Spaces on the plan: proposed 4" at the top, and the four spaces
              themselves at the bottom under a heading called "Outlines". One
              subject, one place. It also renders now without a detectState,
              which the tally-only version could not: a plan traced entirely by
              hand still has spaces to list. */}
          {(detectState || stats.length > 0) && !stepScreen && (
            <div className={SEC}>
              <h3 className={H3}>Spaces on the plan</h3>
              {detectState?.status === 'running' && (
                <p className={NOTE}>Reading the plan for spaces…</p>
              )}
              {detectState?.status === 'error' && (
                <p className={NE}>The space detector is not answering
                  ({detectState.error}). Trace by hand — everything below still works.</p>
              )}
              {detectState?.status === 'done' && (
                detectState.proposed > 0 ? (<>
                  <div className={KV}><span>Proposed</span><b>{detectState.proposed}</b></div>
                  {detectState.dropped > 0 && (
                    <div className={KV}><span>Discarded</span><b>{detectState.dropped}</b></div>
                  )}
                  <p className={NOTE}></p>
                </>) : detectState.returned > 0 ? (
                  <p className={NOTE}>Nothing new — the {detectState.returned} space
                    {detectState.returned > 1 ? 's' : ''} it found {detectState.returned > 1 ? 'are' : 'is'}
                    {' '}already on the plan.</p>
                ) : (
                  <p className={NOTE_WARN}>No spaces found on this plan. Trace them
                    by hand — click the corners.</p>
                )
              )}
              {stats.length > 0 && (
                /* --- CAPPED AND SCROLLED PAST FIVE, like the design panel's
                    own list of the same spaces (see the long note by `Spaces ·
                    N` in App.jsx). This list had no cap, and on a floor plan
                    with twenty rooms it was the entire panel: the trace
                    controls, the layer list and the checkboxes below it were all
                    pushed off the bottom, and the foot's own buttons are the
                    only reason the screen was still usable.

                    FIVE FOR THE SAME REASON IT IS FIVE THERE. Under five you
                    take the list in at a glance and a scroll box is a frame
                    round nothing; past it you are hunting a name, and hunting
                    inside a scroller beats hunting down a page that has moved
                    everything else out of reach.

                    AND THE CAP DOES NOT LIFT ON SELECTION, which is where it
                    differs from the design panel's. Opening a space THERE
                    reveals a workspace — a wall pass, a render pass, controls —
                    and nesting that in a 340px box would mean two scrollbars.
                    Selecting a space HERE only ever adds a line of note text to
                    a row that is otherwise the same size, so there is nothing to
                    make room for.

                    260px IS ABOUT FIVE OF THESE ROWS, which are tighter than the
                    design panel's: name and area, dimensions and corners, at 11
                    and 10 px. A row carrying a note is taller and fewer will
                    show, which is the right way round — a note is worth reading.

                    `.lp-scroll` is the thin visible bar (styles.css). The
                    negative margin and matching padding give it a gutter without
                    insetting the rows from the panel's edge. */
                <div className={'mt-2.5 mb-2 flex flex-col gap-0.5'
                  + (stats.length > 5 ? ' lp-scroll max-h-[260px] -mr-1.5 pr-1.5' : '')}>
                {/* THE WHOLE ROW IS THE TARGET, same as the layout screen's
                    list. It was the name-plus-area button only, with the
                    dimensions, the square toggle and the controls outside it, so
                    the bottom half of something that plainly looks like one row
                    did nothing. The controls inside stop the click so each can
                    still mean its own thing.
                    THE CROSS WENT; Delete removes the selected outline. */}
                {stats.map(({ o, st }, i) => (
                  <div key={o.id} role="button" tabIndex={0}
                    className={`${ROW_EDGE} ${ROW_PICK} `
                      + (o.id === selectedId ? ROW_ON : ROW_OFF)}
                    onClick={() => onSelect(o.id)}
                    onDoubleClick={() => onConfirm(o.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(o.id); }
                    }}>
                    <div className={PICK}>
                      <span className="w-[9px] h-[9px] rounded-[3px] block"
                        style={{ background: FILL[i % FILL.length] }} />
                      {renaming === o.id ? (
                        <input autoFocus defaultValue={o.name || ''}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => { onUpdateOutline(o.id, { name: e.target.value.trim() || o.name }); setRenaming(null); }}
                          onKeyDown={(e) => {
                            /* THE CHORDS GO THROUGH, EVERYTHING ELSE STOPS HERE.
                               The stop is for the ROW behind this field, which
                               answers Enter and Space, and for the window
                               listener above, where Backspace removes the
                               selected outline — neither may hear a character
                               being typed into a name. But it was unconditional,
                               and ⌘Z is not a character: it fell to Safari,
                               which reopened a tab instead of undoing an edit.
                               See App's keydown handler, which owns undo. */
                            if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
                            if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setRenaming(null); }}
                          style={{ fontSize: 11, padding: '1px 4px' }} />
                      ) : (
                        <span className={NAME} onDoubleClick={(e) => { e.stopPropagation(); setRenaming(o.id); }}>
                          {o.name || `Space ${i + 1}`}
                        </span>
                      )}
                      <span className={COUNT}>
                        {o.detected && !o.reviewed ? 'found · ' : ''}{Math.round(st.areaSqft)} sqft
                      </span>
                    </div>
                    {/* --- A NAME AND AN AREA, AND THAT IS THE WHOLE ROW ---
                        THE SECOND LINE IS GONE. It carried the width × height,
                        the corner count, a "square" checkbox and a rename
                        pencil — four things about how an outline was MADE,
                        stacked under the two things that say WHICH outline it
                        is. On this screen the list is a way of pointing at a
                        space on the drawing, and every one of those four was
                        answering a question nobody asks while pointing.
                        WHAT IS LOST AND WHERE IT WENT. The dimensions and the
                        corner count are on the drawing itself the moment a row
                        is selected — that is what selecting one is for.
                        Renaming is still here, on a double-click of the name,
                        which is the same gesture it always was; the pencil was
                        a second door onto it. Squaring stays a property of the
                        outline and stays honoured, it is simply no longer
                        toggled from a 10px checkbox in a list.
                        THE lit/changed MARK WENT WITH THE LINE. The foot names
                        its own counts and the button says what it will relight;
                        a per-row echo of that was the same fact twice. */}
                    {/* --- AND NEITHER NOTE IS THE READER'S BUSINESS -------
                        THE BOOLEAN PASS WAS REPORTING ITS OWN WORKING. `o.note`
                        is assembled in roomBooleans.js and reads "1 room
                        subtracted, 2 offcuts dropped" or "could not be
                        subtracted (…)" — the log of how one polygon was cut out
                        of another, printed under a room's name. Subtraction is
                        an implementation detail of turning overlapping
                        proposals into disjoint spaces; whether it succeeded
                        changes nothing anybody does on this screen, and naming
                        a failure they cannot act on only asks them to worry
                        about it.
                        THE ENCLOSING WARNING WENT WITH IT, and it is the same
                        subject in longer form — "N spaces sit wholly inside
                        this one, so it cannot be subtracted". What it asked for
                        was a corner dragged out to a wall to make the geometry
                        subtractable, which is the user doing the pass's job for
                        it. The inner spaces are held out of the ceiling either
                        way, so the drawing is right whether or not anybody
                        reads this.
                        THE DATA IS UNTOUCHED. `enclosingPx` still becomes the
                        no-light zones downstream — see roomsDetect.js — and
                        `note` still rides in `why`, which is where the working
                        belongs: the admin panel. */}
                  </div>
                ))}
                </div>
              )}
              <label className={CHECK}>
                <input type="checkbox" className="lp-check" checked={showGrips}
                  onChange={(e) => setShowGrips(e.target.checked)} />
                Show corner grips
              </label>
            </div>
          )}

          {/* --- tracing --------------------------------------------------- */}
          {!stepScreen && (<>
          {/* --- AND ONLY WHEN IT HAS SOMETHING IN IT ----------------------
              THE IDLE STATE WAS A HEADING OVER A SENTENCE. "Trace" and then
              "Start tracing with cursor to add another space" — a section that
              held no control, took the height of one, and described a gesture
              that works whether or not it is described. Tracing is what a click
              on the drawing already does; the section is worth its space once
              there is a draft to undo, close or start over, and not before.
              THE OTHER THREE BRANCHES ARE REAL and keep it open: the scale is
              not set, a measurement is being taken, or the last close was
              refused. Each of those is a thing the panel has to say. */}
          {(tracing || !hasScale || measuring || problem) && (
          <div className={SEC}>
            <h3 className={H3}>{tracing ? `Tracing — ${draft.length} corner${draft.length > 1 ? 's' : ''}` : 'Trace'}</h3>
            {tracing ? (
              <>
                <div className={BTNROW}>
                  <button className={BTN} onClick={() => setDraft((d) => d.slice(0, -1))}>Undo corner</button>
                  <button className={BTN} onClick={() => { setDraft([]); setProblem(''); }}>Start over</button>
                </div>
                <button className={`${BTN_PRIMARY_FULL} mt-2`}
                  disabled={draft.length < 3} onClick={finish}>
                  Close the outline
                </button>
              </>
            ) : !hasScale ? (
              <p className={NOTE_WARN}>Set the scale above first.</p>
            ) : measuring ? (
              <p className={NOTE}>{scaleUI?.measure?.b
                ? <>Press <b>Use this measurement</b> to go back to tracing.</>
                : <>Click the two ends of your reference on the plan.</>}</p>
            ) : null}
            {problem && <p className={NOTE_WARN}>{problem}</p>}
          </div>
          )}

          {/* --- snapping -------------------------------------------------- */}
          <div className={SEC}>
            <h3 className={H3}>Snapping</h3>
            <label className={CHECK}>
              <input type="checkbox" className="lp-check" checked={orthoLock}
                onChange={(e) => setOrthoLock(e.target.checked)} />
              Lock to right angles
            </label>
            <label className={CHECK}>
              <input type="checkbox" className="lp-check" checked={alignOn}
                onChange={(e) => setAlignOn(e.target.checked)} />
              Line up with corners already placed
            </label>
            {/* --- 3. SNAPPING TO WHAT IS ALREADY TRACED belongs here, not in
                    a section of its own. It is a snap target, it is a
                    checkbox, and it sat under a heading called "Snap to" one
                    section below a heading called "Snapping" — two names for
                    one idea, and the second one appeared and vanished with the
                    first outline, so the panel reshuffled itself as you
                    worked. */}
            {isRaster && tracedSegs.length > 0 && (
              <label className={CHECK}>
                <input type="checkbox" className="lp-check" checked={visible.has(TRACED_LAYER)}
                  onChange={() => setVisible((v) => {
                    const n = new Set(v);
                    if (n.has(TRACED_LAYER)) n.delete(TRACED_LAYER); else n.add(TRACED_LAYER);
                    return n;
                  })} />
                Outlines already traced ({tracedSegs.length} edges)
              </label>
            )}
          </div>
          </>)}

          {/* --- the file, on a DXF ---------------------------------------- */}
          {!isRaster && (
            <div className={SEC}>
              <h3 className={H3}>The file</h3>
              <div className={KV}><span>Scale</span><b>exact, from the file</b></div>
              <div className={KV}><span>Drawn in</span>
                <b>
                  <select value={unitId} onChange={(e) => onUnitChange(e.target.value)}
                    style={{ width: 'auto', padding: '2px 4px', fontSize: 11 }}>
                    {unitCandidates.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                  </select>
                </b>
              </div>
              <div className={KV}><span>Plan measures</span>
                <b>{ftin(widthFt)} × {ftin(heightFt)}</b></div>
              {(source.unitSource === 'inferred' || source.unitSource === 'overridden') && (
                <p className={NOTE_WARN}>
                  {source.unitSource === 'inferred'
                    ? 'The file did not say what it was drawn in — check the size above.'
                    : 'The file claims other units; at that scale this plan would be an implausible size.'}
                </p>
              )}
            </div>
          )}

          {/* --- layers, on a DXF ------------------------------------------ */}
          {!isRaster && (
            <div className={SEC}>
              <h3 className={H3}>Show &amp; snap to</h3>
              <div className="flex flex-col gap-px mb-1">
                {source.render.map((l) => (
                  <label key={l.layer} className={visible.has(l.layer) ? LAYER_ROW_ON : LAYER_ROW}>
                    <input type="checkbox" className="lp-check" checked={visible.has(l.layer)}
                      onChange={() => setVisible((v) => {
                        const n = new Set(v);
                        if (n.has(l.layer)) n.delete(l.layer); else n.add(l.layer);
                        return n;
                      })} />
                    <span className={LAYER_NAME} title={l.layer}>{l.layer}</span>
                    <span className={COUNT}>{l.count}</span>
                  </label>
                ))}
                {tracedSegs.length > 0 && (
                  <label className={visible.has(TRACED_LAYER) ? LAYER_ROW_ON : LAYER_ROW}>
                    <input type="checkbox" className="lp-check" checked={visible.has(TRACED_LAYER)}
                      onChange={() => setVisible((v) => {
                        const n = new Set(v);
                        if (n.has(TRACED_LAYER)) n.delete(TRACED_LAYER); else n.add(TRACED_LAYER);
                        return n;
                      })} />
                    <span className={LAYER_NAME}>{TRACED_LAYER}</span>
                    <span className={COUNT}>{tracedSegs.length}</span>
                  </label>
                )}
              </div>
              <p className={NOTE}>Hiding a layer stops the cursor snapping to it.</p>
            </div>
          )}

        </div>
      </div>

      {/* THE GRADIENT IS WHAT MAKES A STICKY FOOT READ AS ONE: the panel
          scrolls under it and fades out rather than butting against a line. */}
      {/* NO RULE ACROSS THE TOP OF IT. The gradient is the edge — that is the
          whole point of fading a sticky foot rather than butting it — and a
          hairline drawn over the fade gives the thing two edges half a pixel
          apart, one hard and one soft. Same argument the layout panel's own
          strip settled the same way. */}
      <div className="sticky bottom-0 mt-[18px] flex items-center gap-3.5
        px-0.5 py-3.5">
        <div className="flex-1 text-muted text-[12px]">
          {idScreen
            ? <>{doorMove ? <>Moving a door box.</>
                : doorBand ? <>Drawing a door box.</>
                : doorSel ? <>A box is selected — drag it, or press Delete.</>
                : <>Draw a box over any door that was missed.</>}</>
            : measuring
            ? <>{scaleUI?.measure?.b
                  ? <>Measured {Math.round(measureLen)} px — that makes it
                      {' '}{describeScale(pxPerFt)}. Check the reference in the panel is
                      right, then take it.</>
                  : scaleUI?.measure?.a
                    ? <>Now click the other end.</>
                    : <>Click one end of something you can name on the plan.</>}</>
            : doorScreen
            ? <>{picked
                  ? <>Now say how wide that door is.</>
                  : <>Click a door on the plan to set the scale.</>}</>
            : !hasScale
            ? <>The scale is not set, so nothing can be traced yet.</>
            : tracing
              ? <>{draft.length} corner{draft.length > 1 ? 's' : ''} down.
                  {draft.length >= 3 ? ' Close it to keep it.' : ' Keep clicking.'}</>
              : drag
                ? <>Nudging a corner. {drag.snap ? <>Holding on to <b>{drag.snap.label}</b>.</> : <>Nothing under it.</>}</>
                : chosen
                  ? <><b>{chosen.o.name || 'Space'}</b> — {ftin(chosen.st.widthFt)} × {ftin(chosen.st.heightFt)},
                      {' '}{Math.round(chosen.st.areaSqft)} sq ft, {chosen.st.corners} corners.
                      {' '}Drag a corner to move it, right-click one to delete it.</>
                  : hasLayout
                    ? <>{changed.length
                          ? <>{changed.length} space{changed.length > 1 ? 's have' : ' has'} moved
                              since {changed.length > 1 ? 'they were' : 'it was'} lit
                              {unlit.length ? <>, and {unlit.length} {unlit.length > 1
                                ? 'are' : 'is'} not lit yet</> : null}.
                              The rest of the design is untouched.</>
                          : unlit.length
                            ? <>{unlit.length} outline{unlit.length > 1 ? 's are' : ' is'} not
                                lit yet. Nothing already lit has changed.</>
                            : <>Nothing has changed. The design is as you left it.</>}</>
                  : outlines.length
                    /* NOTHING TO SAY WHEN THE LIST ALREADY SAYS IT. This read
                       "N outlines on the plan. Nudge the corners, then light
                       the lot." — a count the panel prints beside every row,
                       followed by an instruction for two gestures that are
                       already the only two gestures on the screen. The foot
                       still speaks for every state where something is HAPPENING
                       (measuring, picking a door, tracing, dragging a corner,
                       a space selected); standing still, it is quiet. */
                    ? null
                    : finding
                      /* SAYING IT IS NOT BLOCKED IS THE HALF THAT MATTERS.
                         The detector is a model call and can take a few
                         seconds; tracing by hand works throughout and always
                         has, so the foot offers it rather than implying a
                         wait is compulsory. */
                      ? <>Finding the spaces on this plan. You can trace by hand
                          instead if you would rather not wait.</>
                      : <>Nothing traced yet. Click a corner on the plan to start.</>}
        </div>
        {/* NO BUTTON IN THE FOOT ON THE DOOR STEP. The panel's own full-width
            answer is the one act on that screen, and a second copy of it down
            here would be two primaries in one corner. */}
        {idScreen ? null : measuring ? (
          <button className={BTN_PRIMARY} disabled={!scaleUI?.measure?.b}
            onClick={() => setMeasureDone(true)}>
            Use this measurement →
          </button>
        ) : !hasScale ? null : hasLayout ? (
          /* --- THE FOOT OVER AN EXISTING DESIGN ---------------------------
             Opened from the Outlines tab, this screen is a detour rather than a
             step, so the primary act is GOING BACK — and it is free, because
             nothing here discarded anything. Corner edits have already reached
             the drawing on their own; `rooms` in App.jsx is a memo over the lit
             outlines, so a nudged wall re-lays that room's ambient grid the
             moment it moves, with no call and no charge.

             THE RELIGHT IS OFFERED, NOT REQUIRED, AND ONLY FOR WHAT MOVED. It
             buys the things geometry cannot recompute by itself — what kind of
             room this is, where the accents belong, which surfaces are worked at
             — so it is worth a button when something has moved and worth nothing
             at all when nothing has. It names its own count so the press is not
             a guess about the bill: two spaces changed is two spaces charged.

             NOT THE PRIMARY, EVEN THOUGH IT IS THE EXPENSIVE ONE. Most trips
             here are to fix one wall and leave, and the button under the cursor
             should be the one most people want. The relight sits beside it and
             says exactly what it will do. */
          <div className={BTNROW}>
            {!!changed.length && (
              <button className={BTN} disabled={tracing}
                title={changed.map((o) => o.name || 'Space').join(', ')}
                onClick={() => onProceed?.({ only: changed.map((o) => o.id) })}>
                Relight {changed.length} changed space{changed.length > 1 ? 's' : ''}
              </button>
            )}
            {!!unlit.length && (
              <button className={BTN} disabled={tracing}
                onClick={() => onProceed?.({ only: unlit.map((o) => o.id) })}>
                Light {unlit.length} new space{unlit.length > 1 ? 's' : ''}
              </button>
            )}
            <button className={BTN_PRIMARY} disabled={tracing}
              onClick={() => onBackToDesign?.()}>
              Back to the design →
            </button>
          </div>
        ) : (
          /* THE WHOLE PLAN IS THE PRIMARY ACT. A floor plan is a floor plan —
             the rooms come as a set, the detector proposes the set, and lighting
             them one at a time was an artefact of there having been only ever
             one outline to light. Lighting a single room stays available because
             a single room is genuinely sometimes the job. */
          <div className={BTNROW}>
            {chosen && outlines.length > 1 && (
              <button className={BTN} disabled={tracing}
                onClick={() => onConfirm(chosen.o.id)}>
                Just this space
              </button>
            )}
            {/* THE GLOWING BUTTON, AND `lp-shine` IS GONE FROM IT. The sweep
                and the travelling stroke answer the same question — the pointer
                has arrived — and running both meant two flourishes crossing each
                other on one 90px button. The ring is the better of the two here
                because it also reads at REST: a stroke and a halo say "this is
                the one" before anybody points at anything, where a sweep can
                only say it afterwards. */}
            <button className={BTN_GLOW} disabled={!outlines.length || tracing}
              onClick={() => (outlines.length > 1 || !chosen
                ? onProceed?.()
                : onConfirm(chosen.o.id))}>
              {/* "CONFIRM", NOT "LIGHT", BECAUSE IT NO LONGER LIGHTS ANYTHING.
                  It used to start a run that placed a whole design; it now says
                  the outlines are right and opens the screen where the person
                  places the light themselves. A button that promises a layout
                  and delivers an empty ceiling is the wrong label, and the count
                  stays because what is being confirmed is a SET. */}
              {!outlines.length ? 'Trace an outline'
                : outlines.length === 1 ? 'Confirm this outline →'
                : `Confirm ${outlines.length} outlines →`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The snap indicator. A distinct glyph per kind, because "it snapped" is not
 * the useful information — WHAT it snapped to is, and the difference between an
 * endpoint and a point one pixel along the wall is the difference between a
 * clean outline and a nearly clean one.
 */
function SnapGlyph({ snap, px }) {
  const r = px(5.5);
  const common = { stroke: SNAPCOL, strokeWidth: 1.8, strokeScaleEnabled: false, listening: false };
  switch (snap.kind) {
    case 'close':
      return (
        <Group listening={false}>
          <Circle x={snap.x} y={snap.y} radius={px(8)} {...common} />
          <Circle x={snap.x} y={snap.y} radius={px(2.5)} fill={SNAPCOL} listening={false} />
        </Group>
      );
    case 'end':
    case 'vertex':
      return <Rect x={snap.x} y={snap.y} width={r * 2} height={r * 2}
        offsetX={r} offsetY={r} {...common} />;
    case 'int':
    case 'alignInt':
      return (
        <Group listening={false}>
          <Line points={[snap.x - r, snap.y - r, snap.x + r, snap.y + r]} {...common} />
          <Line points={[snap.x - r, snap.y + r, snap.x + r, snap.y - r]} {...common} />
        </Group>
      );
    case 'mid':
      return <RegularPolygon x={snap.x} y={snap.y} sides={3} radius={r * 1.15} {...common} />;
    case 'orthoInt':
    case 'ortho':
      return <RegularPolygon x={snap.x} y={snap.y} sides={4} radius={r * 1.2}
        rotation={0} {...common} />;
    case 'grid':
      return (
        <Group listening={false}>
          <Line points={[snap.x - r, snap.y, snap.x + r, snap.y]} {...common} />
          <Line points={[snap.x, snap.y - r, snap.x, snap.y + r]} {...common} />
        </Group>
      );
    case 'align':
    case 'edge':
      return <Circle x={snap.x} y={snap.y} radius={r} {...common} />;
    default:
      return <Circle x={snap.x} y={snap.y} radius={px(2)} fill={SNAPCOL} listening={false} />;
  }
}
