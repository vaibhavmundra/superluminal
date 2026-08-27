import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import PlanCanvas from './components/PlanCanvas.jsx';
import ChunkPicker from './components/ChunkPicker.jsx';
import OutlineTracer from './components/OutlineTracer.jsx';
import { imageToPixels, detectFans } from './lib/detect.js';
import { parseDXF, UNITS, classifyLayers } from './lib/dxf.js';
import { vectorSource, rasterSource } from './lib/planSource.js';
import { makeOutline, nextOutlineName, regionFromOutline, outlineStats } from './lib/outline.js';
import { PLAN_OPTIONS, FITTING_LUMENS, WALL_WEIGHT_IN, OTHER_STROKE_PX, FAN_DETECT,
         SIMPLIFY_ROOM_TO_RECTANGLE } from './lib/settings.js';
import { planLights } from './lib/planner.js';
import { enumerateChunkings, findChunking } from './lib/chunking.js';
import { bbox, pointInPolygon } from './lib/geometry.js';
import { REFERENCES, scaleFromReference } from './lib/scale.js';
import { detectDoors, doorsFromPayload, scaleFromDoor, DOOR_WIDTHS } from './lib/doors.js';
import { proposeOutlines } from './lib/outlineSources.js';
import { detectFurniture, detectionsToZones, zonesFromDetections, snapshotForDetection, rectCentre, iou, dedupe, downscaleForDetection, ZONE_CLASSES, PROVIDERS, DEFAULT_PROVIDER, wireProvider } from './lib/furniture.js';
import { download, toJSON, toCSV, toDXF, toSuperluminalDXF, svgString, svgToPNG } from './lib/exporters.js';
import LightPalette from './components/LightPalette.jsx';
import CeilingPalette from './components/CeilingPalette.jsx';
import ProjectTypeDialog from './components/ProjectTypeDialog.jsx';
import PlanLoader from './components/PlanLoader.jsx';
import BOQView from './components/BOQView.jsx';
import { buildBOQ } from './lib/boq.js';
import { boqToCSV, boqToXLSX, boqToPDF, CSV_BOM } from './lib/boqExport.js';
import { PROJECT_BY_ID, roomTypeIn, wantsAccents, wantsSpots, targetAreaFor } from './lib/roomTypes.js';
import FixtureTip from './components/FixtureTip.jsx';
import { SURFACE_BY_ID } from './lib/taskSurfaces.js';
import { planTaskSpots, chunkFor } from './lib/taskSpots.js';
import { roomSnapshot, requestAccents, toPlanRect } from './lib/accentMask.js';
import { BED_SOURCES, splitByProvider, label as labelBeds, bedsIn, contestFor,
         applyVerdict } from './lib/bedFit.js';
import { TYPE_BY_ID, FURNITURE_BY_ID } from './lib/accentPrompt.js';
import { zonesFromFurniture, slideSconceTo, setRunEnd, moveRun, placeZone, RUN_EDIT } from './lib/accentPlace.js';
import { CEILING_BY_ID, makeCeilingObject, toObstaclePx,
         sizeLabel, radiusFt, clampFt, resizeFromCorner, rotateTo, isRect,
         halfExtents, isUniform, applyResize, FAN_SWEEPS, sweepMm, withSweep }
         from './lib/ceilingObjects.js';
import { collectTargets, snapPoint, SNAP_DEFAULTS } from './lib/snapGuides.js';
import { buildSnapIndex, snapAt } from './lib/snap.js';

const LS = 'lightPlanner.v1';

const ftin = (v) => {
  const f = Math.floor(v), i = Math.round((v - f) * 12);
  return i === 12 ? `${f + 1}'0"` : `${f}'${i}"`;
};

export default function App() {
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
  const [focusId, setFocusId] = useState(null);       // which room the panel is editing
  const [fanMode, setFanMode] = useState(false);

  const [busy, setBusy] = useState('');
  const [fans, setFans] = useState([]);
  const [fanReason, setFanReason] = useState('');

  // --- things already on the ceiling ---------------------------------------
  // A SEPARATE LIST FROM `fans`, and deliberately. `fans` is what the red-circle
  // detector found, measured in pixels, and it is also the RULER the raster
  // route scales the whole drawing from — put a hand-placed chandelier in there
  // and the plan's scale would change when you added a light fitting.
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
  const [selObjId, setSelObjId] = useState(null);
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
  const [manualAccents, setManualAccents] = useState([]);
  const [manualSurfaces, setManualSurfaces] = useState([]);
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
  // The image that is actually sent. Held in state rather than made at call
  // time so the panel can show it: "what did it look at" is the first question
  // whenever an answer is strange, and a crop that is off the room or washed
  // out the wrong way is invisible in a list of zones.
  const [accentShot, setAccentShot] = useState(null);
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
  const [projectId, setProjectId] = useState(null);
  const [roomTypes, setRoomTypes] = useState({});   // outline id -> {type,confidence,why}
  // The pipeline's own state while it runs. Null when it is not running, which
  // is also what the loader keys off.
  const [prep, setPrep] = useState(null);
  const cancelPrep = useRef(false);

  const [surfaceRoomId, setSurfaceRoomId] = useState(null);
  const [surfaceResults, setSurfaceResults] = useState({});
  const [surfaceState, setSurfaceState] = useState({ status: 'idle', roomId: null });
  const [surfaceDismissed, setSurfaceDismissed] = useState([]);

  const [selAccId, setSelAccId] = useState(null);
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

  // Not state. Every dial that used to be a slider now lives in settings.js —
  // see the header there for why.
  const opt = PLAN_OPTIONS;
  const useBoundingRect = SIMPLIFY_ROOM_TO_RECTANGLE;
  // `grid`, `surfaces` and `secondary` are gone rather than defaulted false:
  // nothing draws them and nothing toggles them, so a key here would be a
  // setting with no effect, which is the kind of thing that survives three
  // refactors and then gets wired to the wrong render.
  const [layers, setLayers] = useState({ plan: true, dim: true, region: true, cells: true, lights: true, labels: false, fan: true, zones: true, accents: true, objects: true, spots: true });
  const [zoom, setZoom] = useState(1);
  // WHICH HALF OF THE DELIVERABLE IS ON SCREEN. A schedule is not a second view
  // of the drawing — it is the other half of what leaves the studio, read at a
  // different moment by a different person. So it replaces the canvas rather
  // than crowding it.
  const [view, setView] = useState('design');   // design | boq
  // How far the pointer must travel before a press becomes a drag, in SCREEN
  // pixels — divided by the zoom at the point of use, so it is the same
  // distance under the hand at 40% and at 300%.
  const DRAG_SLOP_PX = 3;
  const [over, setOver] = useState(false);
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
    setZones([]); setZoneMode(false); setDraftZone(null);
    setChunkPicks({}); setPickingId(null);
    setDetections([]); setDetectState({ status: 'idle' }); setDismissed([]);
    setRoomState({ status: 'idle' });
    setAccentRoomId(null); setAccentResults({});
    setAccentState({ status: 'idle', roomId: null }); setAccentDismissed([]); setAccentShot(null);
    setSelAccId(null); setAccDrag(null);
    setProjectId(null); setRoomTypes({}); setPrep(null); cancelPrep.current = false;
    setDoors([]); setDoorPick(null); setDoorState({ status: 'idle' });
    setSurfaceRoomId(null); setSurfaceResults({});
    setSurfaceState({ status: 'idle', roomId: null }); setSurfaceDismissed([]);
    setFans([]); setFanReason(''); setFanMode(false);
    setCeilingObjs([]); setObjMode(false); setSelObjId(null); setObjDrag(null);
    setArmed(null); setGuides([]); setGhost(null);
    setOutlines([]); setSelectedOutlineId(null); setLitIds([]); setFocusId(null);
    setUnitId(null);
  }, []);

  const loadFile = useCallback((file) => {
    if (!file) return;
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
  }, [resetForNewPlan]);

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

  const commitOutline = useCallback((pointsPx) => {
    if (!source) return;
    const o = makeOutline(pointsPx, { name: nextOutlineName(outlines) });
    const stored = { id: o.id, name: o.name, rectify: o.rectify,
                     detected: false, reviewed: true,
                     pointsDu: pointsPx.map(source.toDu) };
    setOutlines((os) => [...os, stored]);
    setSelectedOutlineId(stored.id);   // highlight it; confirming is a separate act
  }, [source, outlines]);

  const updateOutline = useCallback((id, patch) => {
    setOutlines((os) => os.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }, []);

  const deleteOutline = useCallback((id) => {
    setOutlines((os) => os.filter((o) => o.id !== id));
    setSelectedOutlineId((s) => (s === id ? null : s));
    setLitIds((ids) => ids.filter((x) => x !== id));
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
    setOutlines((os) => os.map((o) => {
      if (o.id !== id) return o;
      const px = o.pointsDu.map(source.fromDu);
      const next = fn(px);
      if (!next || next.length < 3) return o;
      return { ...o, reviewed: true, pointsDu: next.map(source.toDu) };
    }));
  }, [source]);

  const movePoint = useCallback((id, index, pointPx) => {
    editPoints(id, (px) => px.map((p, i) => (i === index ? pointPx : p)));
  }, [editPoints]);

  const insertPoint = useCallback((id, index, pointPx) => {
    editPoints(id, (px) => [...px.slice(0, index), pointPx, ...px.slice(index)]);
  }, [editPoints]);

  const removePoint = useCallback((id, index) => {
    editPoints(id, (px) => (px.length > 3 ? px.filter((_, i) => i !== index) : px));
  }, [editPoints]);

  /** Light everything traced or proposed. The primary act on the tracer screen. */
  const lightWholePlan = useCallback(() => {
    setOutlines((os) => os.map((o) => ({ ...o, reviewed: true })));
    setLitIds(outlines.map((o) => o.id));
    setFocusId(outlines[0]?.id ?? null);
    setPickingId(null);
  }, [outlines]);

  const lightOneRoom = useCallback((id) => {
    setOutlines((os) => os.map((o) => (o.id === id ? { ...o, reviewed: true } : o)));
    setSelectedOutlineId(id);
    setLitIds([id]);
    setFocusId(id);
    setPickingId(null);
  }, []);

  // --- fan markers (raster only: a DXF has its fans placed by hand) --------
  useEffect(() => {
    if (!img) return;
    let cancelled = false;
    setBusy('Looking for fan markers…');
    const t = setTimeout(() => {
      try {
        const f = detectFans(imageToPixels(img.el), { sat: FAN_DETECT.redSat, link: FAN_DETECT.link });
        if (cancelled) return;
        setFans(f.ok ? f.fans : []); setFanReason(f.ok ? '' : f.reason);
      } finally { if (!cancelled) setBusy(''); }
    }, 30);
    return () => { cancelled = true; clearTimeout(t); };
  }, [img]);

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
    const d = doors.find((q) => q.id === doorPick.id);
    return d ? scaleFromDoor(d.rect, doorPick.mm) : null;
  }, [isVector, source, scaleMode, measure, refId, customFt, doors, doorPick]);

  /**
   * EVERY OBSTACLE ON THE CEILING, in plan pixels, whoever put it there.
   *
   * The detector's fans and the hand-placed objects meet here and nowhere
   * earlier, because they are different upstream — one is measured in pixels
   * and doubles as the drawing's ruler, the other is held in feet — and
   * identical downstream: the planner is handed { x, y, r } and is not told
   * which kind it is looking at.
   */
  const obstaclesPx = useMemo(() => {
    const det = fans.map((f) => ({ ...f, kind: 'fan', source: 'detected' }));
    if (!pxPerFt) return det;
    return [...det, ...ceilingObjs.map((o) => toObstaclePx(o, pxPerFt))];
  }, [fans, ceilingObjs, pxPerFt]);

  // Every no-light zone on the plan, whoever drew it.
  //
  // A DETECTION IS A PROPERTY OF THE IMAGE, not of a room. The bed detector runs
  // on upload, before any boundary exists, and finds every bed on the sheet;
  // which of them is an obstacle depends on which ceiling is being laid out, and
  // that question is answered per room, below. So this list is unfiltered — it
  // is what the canvas draws — and the planner sees only the subset that falls
  // inside the room it is working on.
  const detectedZones = useMemo(() => {
    if (!source || !detections.length) return [];
    const live = detections.filter((d) => !dismissed.includes(d.id));
    return zonesFromDetections(live, { image: { w: source.w, h: source.h }, pxPerFt })
      .map((z, i) => ({ ...z, id: live[i].id }));
  }, [detections, dismissed, source, pxPerFt]);

  // Hand-drawn zones and detected ones behave identically from here on — that
  // was the point of making a detection produce a rectangle rather than a new
  // kind of obstacle.
  const zoneList = useMemo(() => [...zones, ...detectedZones], [zones, detectedZones]);

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
      const mine = obstaclesPx.filter((f) => pointInPolygon({ x: f.x, y: f.y }, polygonPx));
      const myZones = [
        ...zoneList.filter((z) => pointInPolygon(
          { x: (z.x0 + z.x1) / 2, y: (z.y0 + z.y1) / 2 }, polygonPx)),
        // This room's own enclosed rooms, which belong to it and to no other.
        ...enclosedZones(o),
      ];

      const geo = {
        polygonPx, origin, toFt, toPx,
        polygonFt: polygonPx.map(toFt),
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
        zonesFt: myZones.map((z) => {
          const a = toFt({ x: z.x0, y: z.y0 }), c = toFt({ x: z.x1, y: z.y1 });
          return { x0: a.x, y0: a.y, x1: c.x, y1: c.y };
        }),
      };

      // A KITCHEN IS LIT HARDER THAN A LIVING ROOM, and the only lever this
      // engine has for that is the size of a cell. See TARGET_AREA_BY_TYPE.
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
      const cellArea = targetAreaFor(roomTypes[o.id]?.type);
      const roomOpt = cellArea ? { ...opt, targetArea: cellArea } : opt;
      const roomChunkOpt = cellArea ? { ...chunkOpt, targetArea: cellArea } : chunkOpt;

      const chunking = enumerateChunkings(geo.polygonFt, geo.zonesFt, roomChunkOpt, geo.fixturesFt);
      // A remembered intent, resolved afresh each time. Change the space enough
      // that the chosen reading no longer exists and the recommendation takes
      // over, rather than a different reading quietly wearing the same name.
      const picked = chunkPicks[o.id]
        ? findChunking(chunking.options, chunkPicks[o.id])?.id ?? null
        : null;
      const chosenId = picked ?? chunking.recommendedId ?? null;

      const res = planLights(geo.polygonFt, geo.fixturesFt,
        { ...roomOpt, chunkStrategy: chosenId || 'auto' }, geo.zonesFt);

      const rectToPx = (c) => ({ ...c,
        x0: c.x0 * pxPerFt + origin.x, x1: c.x1 * pxPerFt + origin.x,
        y0: c.y0 * pxPerFt + origin.y, y1: c.y1 * pxPerFt + origin.y });

      const plan = !res.ok ? { ...res, polygonPx } : {
        ...res,
        polygonFt: geo.polygonFt, polygonPx, origin, toPx,
        chunksPx: res.chunks.map((ch) => ({
          ...rectToPx(ch),
          xLines: ch.xLines.map((x) => x * pxPerFt + origin.x),
          yLines: ch.yLines.map((y) => y * pxPerFt + origin.y),
        })),
        cellsPx: res.cells.map(rectToPx),
        lightsPx: res.lights.map((l) => ({ ...l, ...toPx(l),
          centrePx: l.cell ? toPx({ x: l.cell.cx, y: l.cell.cy }) : null,
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
      };

      out.push({
        id: o.id, outline: o, region, geo, chunking, plan,
        chosenId, chunkingChosenBy: picked ? 'user' : 'recommended',
        stats: outlineStats(o, pxPerFt),
      });
    }
    return out;
  }, [source, pxPerFt, litOutlines, useBoundingRect, obstaclesPx, zoneList,
      chunkOpt, chunkPicks, opt, enclosedZones, roomTypes]);

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

  /** The room the right-hand panel and the chunk picker are talking about. */
  const focus = useMemo(
    () => rooms.find((r) => r.id === focusId) || rooms[0] || null,
    [rooms, focusId]);

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
  const computeAccents = useCallback(async (r, { reuseShot = null } = {}) => {
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
    // AND THEN THE RULES, IN CODE. The model was asked what furniture is in the
    // room and nothing else; this is where a bed becomes a pair of sconces at
    // either end of itself and a wardrobe becomes a strip along its own length.
    // Deterministic, so the house style is the same every run — see
    // accentPrompt.js's header for what happened when it was not.
    const { zones: placed, handled } = zonesFromFurniture(furniture, r.plan.polygonPx);
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
    return { shot, meta: payload.meta, result: { ...res, furniture, handled, zones } };
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

  const surfaceRoom = useMemo(
    () => rooms.find((r) => r.id === surfaceRoomId) || rooms[0] || null,
    [rooms, surfaceRoomId]);

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
  const taskSpotsPx = useMemo(() => {
    const out = [];
    for (const r of rooms) {
      if (!r.plan?.ok) continue;
      const mine = surfacesPx.filter((sf) => sf.roomId === r.id);
      if (!mine.length) continue;
      const { toFt, toPx } = r.geo;
      // ALL OF THIS ROOM'S SURFACES AT ONCE, not one at a time, because the
      // rule that one spot lights one surface is a rule ABOUT THE SET: a
      // segment can only be spent once, and that cannot be decided by a
      // function looking at a single surface.
      const inFt = mine.map((sf) => {
        const a = toFt({ x: sf.rect.x0, y: sf.rect.y0 });
        const b = toFt({ x: sf.rect.x1, y: sf.rect.y1 });
        return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y),
                 x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
      });
      // ALL the room's chunks. Which one a surface belongs to is decided per
      // surface inside planTaskSpots — a living-dining room has its coffee
      // table in one chunk and its dining table in another, and giving both the
      // same grid puts one of them nowhere near what it is lighting.
      const placed = planTaskSpots(inFt, {
        chunks: r.plan.chunks,
        lights: r.plan.lights,
        polygon: r.plan.polygonFt,
        fixtures: r.geo.fixturesFt,
        chandeliers: r.geo.fixturesFt.filter((f) => f.kind === 'chandelier'),
        zones: r.plan.zones ?? [],
        opt,
      });

      mine.forEach((sf, k) => {
        const res = placed[k];
        if (!res?.spot) {
          out.push({ id: `spot-${sf.id}`, surfaceId: sf.id, colour: sf.colour,
                     rejected: res?.rejected, skipped: res?.skipped });
          return;
        }
        const p = toPx(res.spot);
        const t = toPx(res.spot.target);
        out.push({
          id: `spot-${sf.id}`, surfaceId: sf.id, roomId: r.id,
          x: p.x, y: p.y,
          target: t,
          angle: Math.atan2(t.y - p.y, t.x - p.x),
          via: res.spot.via,
          // The segment it is standing on, in pixels, so the drawing can show
          // its working when the secondary grid is switched on.
          segment: { a: toPx(res.spot.segment.a), b: toPx(res.spot.segment.b) },
          grid: res.grid ? {
            lines: res.grid.lines.map((l) => ({ ...l, a: toPx(l.a), b: toPx(l.b) })),
          } : null,
        });
      });
    }
    return out;
  }, [rooms, surfacesPx, opt]);

  /** What the canvas draws: every accent zone still standing, in plan pixels. */
  /** The same two-source rule for strips and sconces. See surfacesPx. */
  const accentZonesPx = useMemo(() => {
    const out = [];
    for (const r of rooms) {
      const res = accentResults[r.id];
      if (!res?.zones) continue;
      for (const z of res.zones) if (!accentDismissed.includes(z.id)) out.push(z);
    }
    const live = new Set(rooms.map((r) => r.id));
    return [...out, ...manualAccents.filter((m) => live.has(m.roomId))];
  }, [rooms, accentResults, accentDismissed, manualAccents]);

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
    const lumens = done.reduce((s, r) =>
      s + r.plan.stats.large * FITTING_LUMENS.large
        + r.plan.stats.small * FITTING_LUMENS.small, 0);
    const areaSqft = done.reduce((s, r) => s + r.plan.stats.areaSqft, 0);
    return {
      rooms: done.length,
      failed: rooms.length - done.length,
      lights: done.reduce((s, r) => s + r.plan.lights.length, 0),
      areaSqft, lumens,
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
  const boq = useMemo(() => buildBOQ({
    rooms,
    accents: accentZonesPx,
    spots: taskSpotsPx,
    objects: ceilingObjs,
    fans,
    pxPerFt,
    plan: source?.name ?? null,
  }), [rooms, accentZonesPx, taskSpotsPx, ceilingObjs, fans, pxPerFt, source]);

  /** The schedule as a file. Three formats, one table — see boqExport.js. */
  const exportBOQ = useCallback((fmt) => {
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
  }, [boq, source]);

  /** One line per room, and only where something actually went wrong. */
  const troubles = useMemo(() => rooms.flatMap((r) => {
    const name = r.outline.name || 'Space';
    if (!r.plan) return [];
    if (!r.plan.ok) return [{ name, msg: r.plan.reason }];
    const st = r.plan.stats;
    if (st.unserved > 0) return [{ name, msg: `${st.unserved} cell${st.unserved > 1 ? 's have' : ' has'} no light at all — that should not happen.` }];
    if (st.clashes > 0) return [{ name, msg: `${st.clashes} light${st.clashes > 1 ? 's sit' : ' sits'} inside a fan's clearance or a no-light zone, because the cell has nowhere else to go.` }];
    if (st.ceded > 0) return [{ name, msg: `${st.ceded} cell${st.ceded > 1 ? 's are' : ' is'} left to the fan — no light fits clear of the blades.` }];
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
    { key: 'beds', label: 'Placing the beds' },
    { key: 'geometry', label: 'Reading your geometry' },
    { key: 'types', label: 'Understanding space types' },
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
  const runPipeline = useCallback(async (opts = {}) => {
    const { classify = true, accents = true, surfaces = true, relight = true,
            beds = true } = opts;
    if (!source || !outlines.length) return;
    cancelPrep.current = false;

    const wanted = PREP_STEPS.filter((st) =>
      st.key === 'beds' ? (beds && !!bedSets)
      : st.key === 'geometry' ? relight
      : st.key === 'types' ? classify
      : st.key === 'accents' ? accents
      : surfaces);
    // A room that fails is skipped, not fatal — but a silent skip is how six
    // rooms quietly become four. Counted here and reported in the step's own
    // note, so a partial run says it was partial.
    const failed = { beds: 0, types: 0, accents: 0, surfaces: 0 };
    const withFails = (text, n) => (n ? `${text} · ${n} space${n > 1 ? 's' : ''} failed` : text);
    const roomState = {};
    for (const o of outlines) roomState[o.id] = 'idle';
    let steps = wanted.map((st, i) => ({ ...st, state: i === 0 ? 'busy' : 'idle' }));
    let done = 0, total = relight ? outlines.length : 0;
    const paint = (patch = {}) => setPrep((prev) => ({
      phase: steps.find((x) => x.state === 'busy')?.label ?? 'Finishing',
      detail: '', ...prev, ...patch, steps: [...steps], roomState: { ...roomState },
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
      setOutlines((os) => os.map((o) => ({ ...o, reviewed: true })));
      setLitIds(outlines.map((o) => o.id));
      setFocusId(outlines[0]?.id ?? null);
      setPickingId(null);
      stepTo('geometry');
      paint({ detail: 'Working out where the spaces are' });
    }

    // --- 1. the ambient layout
    let list = [];
    for (let i = 0; i < 80 && !cancelPrep.current; i++) {
      list = (roomsRef.current || []).filter((r) => r.plan?.ok);
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
      types = found;
      setRoomTypes(found);
      const named = (r) => roomTypeIn(projectId, found[r.id]?.type)?.label ?? 'unclassified';
      note('types', withFails(list.map((r) => named(r)).slice(0, 4).join(', ')
        + (list.length > 4 ? `, +${list.length - 4}` : ''), failed.types));
      console.log('[pipeline] room types', found);
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
      for (const o of outlines) roomState[o.id] = forAccents.some((r) => r.id === o.id) ? 'idle' : 'done';
      const got = {};
      await mapLimit(forAccents, 2, async (r) => {
        if (cancelPrep.current) return null;
        roomState[r.id] = 'busy'; paint({ detail: `Accents in ${r.outline.name || 'a room'}` });
        try {
          const out = await computeAccents(r, { reuseShot: shots[r.id] });
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
      for (const o of outlines) roomState[o.id] = forSpots.some((r) => r.id === o.id) ? 'idle' : 'done';
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

    const anyFailed = failed.types + failed.accents + failed.surfaces;
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
  }, [source, outlines, projectId, roomTypes, PREP_STEPS, pxPerFt, useBoundingRect,
      bedSets, computeBedFit, computeRoomType, computeAccents, computeSurfaces]);

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

  const step = !source ? 'upload'
    : !litIds.length ? 'trace'
    : pickingId ? 'chunks'
    : 'plan';
  const showTrace = step === 'trace';
  // The BOQ tab takes the whole stage. Gated on `source` as well as on the tab
  // so that a stale `view` cannot survive a Clear and render a schedule of a
  // plan that is no longer loaded.
  const boqOpen = view === 'boq' && !!source;
  const picking = pickingId ? rooms.find((r) => r.id === pickingId) : null;
  const showPicker = step === 'chunks' && !zoneMode && !!picking;


  // --- interactions ---------------------------------------------------------
  const svgPoint = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * source.w, y: ((e.clientY - r.top) / r.height) * source.h };
  };

  // A fan drawn on the plan, in pixels. 1200mm is the default sweep almost
  // everywhere, and this is only the size of a symbol the user can resize —
  // it stopped being the drawing's ruler when the door scale arrived.
  const fanRadiusPx = () => ((pxPerFt || 20) * 3.94) / 2;

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

  /** Put the tool away and forget any half-made gesture. */
  const disarmAdd = useCallback(() => {
    setAddTool(null); setStripFrom(null); setAddAt(null);
    setAddSnap(null); setAddGhost(null);
  }, []);

  const snapTargets = useCallback((excludeId) => collectTargets({
    rooms: rooms.map((r) => ({ id: r.id, name: r.outline.name, polygonPx: r.plan?.polygonPx || r.geo?.polygonPx })),
    objects: obstaclesPx.filter((o) => o.source === 'placed'),
    exclude: excludeId,
  }), [rooms, obstaclesPx]);

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

  const applySnap = (ptPx, excludeId) => {
    const r = snapPoint(ptPx, snapTargets(excludeId), { tol: snapTol() });
    setGuides(r.guides);
    return r;
  };

  const objPointerDown = (e, id, mode, corner = null) => {
    if (e.button != null && e.button !== 0) return;   // middle button is the pan
    if (!pxPerFt) return;
    e.stopPropagation();
    e.preventDefault();
    const svg = svgRef.current;
    svg?.setPointerCapture?.(e.pointerId);
    const o = ceilingObjs.find((q) => q.id === id);
    if (!o) return;
    setObjMode(true);
    setArmed(null); setGuides([]); setGhost(null);
    setSelObjId(id);
    const p = svgPoint(e);
    const ft = { x: p.x / pxPerFt, y: p.y / pxPerFt };
    setObjDrag({
      id, mode, corner, pointerId: e.pointerId,
      grabFt: { x: ft.x - o.x, y: ft.y - o.y },
      startRot: o.rot || 0,
      startAngle: Math.atan2(ft.y - o.y, ft.x - o.x),
      start: { ...o },
      moved: false,
    });
  };

  const objPointerMove = (e) => {
    if (!objDrag || !pxPerFt) return;
    const p = svgPoint(e);
    const ft = { x: p.x / pxPerFt, y: p.y / pxPerFt };
    if (!objDrag.moved) setObjDrag((d) => (d ? { ...d, moved: true } : d));
    setCeilingObjs((os) => os.map((o) => {
      if (o.id !== objDrag.id) return o;
      if (objDrag.mode === 'move') {
        // The OBJECT'S CENTRE is what snaps, not the pointer. Snapping the
        // pointer would align wherever inside the object you happened to grab
        // it, so the same drag would land differently depending on where you
        // picked it up.
        const want = { x: (ft.x - objDrag.grabFt.x) * pxPerFt,
                       y: (ft.y - objDrag.grabFt.y) * pxPerFt };
        const snapped = applySnap(want, o.id);
        return { ...o, x: snapped.x / pxPerFt, y: snapped.y / pxPerFt };
      }
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
  const accPointerDown = (e, roomId, id, mode) => {
    if (e.button != null && e.button !== 0) return;   // middle button is the pan
    e.stopPropagation();
    e.preventDefault();
    svgRef.current?.setPointerCapture?.(e.pointerId);
    setSelAccId(id);
    setSelObjId(null);
    setArmed(null);
    // WHERE THE GESTURE STARTED, twice over. `from` advances with the pointer,
    // because a run must move by the DELTA and not jump to centre itself under
    // the cursor — grab a strip near one end and it stays grabbed near that end.
    // `origin` does not, because it is what the drag threshold is measured from.
    const at = svgPoint(e);
    setAccDrag({ roomId, id, mode, pointerId: e.pointerId, from: at, origin: at, live: false });
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

    const o = runOpts(accDrag.roomId, e);
    setAccentResults((m) => {
      const res = m[accDrag.roomId];
      if (!res?.zones) return m;
      const zones = res.zones.map((z) => {
        if (z.id !== accDrag.id) return z;
        if (accDrag.mode === 'slide') return slideSconceTo(z, p);
        if (accDrag.mode === 'end0') return setRunEnd(z, 0, p, o);
        if (accDrag.mode === 'end1') return setRunEnd(z, 1, p, o);
        if (accDrag.mode === 'move') return moveRun(z, p, accDrag.from, o);
        return z;
      });
      return { ...m, [accDrag.roomId]: { ...res, zones } };
    });
    // The body drag is relative, so the origin advances with the pointer.
    if (accDrag.mode === 'move') setAccDrag((d) => (d ? { ...d, from: p } : d));
  };

  const accPointerUp = () => {
    if (!accDrag) return;
    // The snap indicator is a property of the GESTURE, not of the fitting, so
    // it goes when the gesture does. Left on the zone it would draw a guide
    // line through a strip nobody is touching.
    const { roomId, id } = accDrag;
    setAccentResults((m) => {
      const res = m[roomId];
      if (!res?.zones) return m;
      return { ...m, [roomId]: { ...res,
        zones: res.zones.map((z) => (z.id === id && z.snap ? { ...z, snap: null } : z)) } };
    });
    setAccDrag(null);
  };

  /** Escape backs out, Delete removes. The two keys every editor answers to. */
  useEffect(() => {
    if (!objMode && !armed && !selAccId && !addTool) return;
    const onKey = (e) => {
      const t = e.target;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (e.key === 'Escape') {
        if (addTool) { disarmAdd(); }
        if (armed) { setArmed(null); setGhost(null); setGuides([]); }
        else if (selAccId) setSelAccId(null);
        else if (selObjId) setSelObjId(null);
        else setObjMode(false);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selAccId && !accDrag) {
        e.preventDefault();
        setAccentDismissed((d) => (d.includes(selAccId) ? d : [...d, selAccId]));
        setSelAccId(null);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selObjId && !objDrag) {
        e.preventDefault();
        setCeilingObjs((os) => os.filter((q) => q.id !== selObjId));
        setSelObjId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [objMode, armed, selObjId, objDrag, selAccId, accDrag, addTool, disarmAdd]);

  const onCanvasClick = (e) => {
    // Ceiling objects are handled entirely in the pointer events — see the note
    // on objPointerDown. Nothing about them may happen on a click.
    if (zoneMode || !source || objMode || armed || addTool) return;
    // Placing a fan: a DXF has no red circle to find, so the fans are put where
    // you click. The sweep comes from the same standard-size list the raster
    // route uses as a ruler.
    if (fanMode) {
      const p = svgPoint(e);
      setFans((fs) => [...fs, { id: Date.now() + Math.random(), x: p.x, y: p.y, r: fanRadiusPx() }]);
      return;
    }
    // THE SCALE IS SETTLED BY THE TIME WE ARE HERE. Measuring belongs to the
    // tracer screen, where the scale is actually being decided; leaving the
    // click live on this screen meant a stray click could redefine px-per-foot
    // under a finished layout, and every light on the plan would move.
    return;
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
      if (!source || boqOpen) return;
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
  }, [source, boqOpen, fitZoom, zoomTo]);

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
    // NOT THE MIDDLE BUTTON. It is the pan, and every gesture on this canvas
    // has to say so — a middle press that reaches a drag handler starts a drag
    // that no mouseup will ever finish, because the pan swallows the release.
    if (e.button != null && e.button !== 0) return;

    // --- ADDITIONAL LIGHTING, before anything else claims the press ---------
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
      const room = roomAt(p);
      // Off the ceiling: put the tool away rather than place a fitting in a
      // space that does not exist. Same rule the ceiling palette follows.
      if (!room) { disarmAdd(); return; }
      e.preventDefault();

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
        setSelAccId(placed.id);
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
        setSelAccId(z.id);
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
        setSelObjId(null); setSelAccId(null);
        return;
      }
      if (armed) {
        const snapped = applySnap(p, null);
        let o = makeCeilingObject(armed, { x: snapped.x / pxPerFt, y: snapped.y / pxPerFt });
        if (o.kind === 'fan') o = withSweep(o, fanSweepMm);
        setCeilingObjs((os) => [...os, o]);
        setSelObjId(o.id);
        setArmed(null);
        setGuides([]); setGhost(null); setGuides([]); setGhost(null);
      } else {
        setSelObjId(null);
        setSelAccId(null);
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
    if (objDrag) { objPointerMove(e); return; }
    if (accDrag) { accPointerMove(e); return; }
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
      const inside = insideAnyRoom(raw);
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
    if (objDrag) { objPointerUp(); return; }
    if (accDrag) { accPointerUp(); return; }
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
      disarmAdd();
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
        const { kept, rejected } = detectionsToZones(payload, { image, polygon: null });
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
            detectionsToZones(half, { image, polygon: null }));
          for (const src of BED_SOURCES) sets[src.id] = labelBeds(split[src.id].kept, src.id);
          console.log('[detect] judged sets:',
            BED_SOURCES.map((x) => `${x.label} ${sets[x.id].length}`).join(', '));
        }
        setBedSets(sets);
        setBedVerdicts({});

        setDetections(kept.map((k, i) => ({ ...k, id: `det-${i}-${Math.round(k.rect.x0)}-${Math.round(k.rect.y0)}` })));
        setDetectState({
          status: 'done', rejected, ms: Date.now() - t0,
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
    // `provider` is a dependency because switching provider is a deliberate act
    // whose whole purpose is to see the other answer — waiting for a second
    // click would just be a click. The nonce is the explicit re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, img, detectNonce, provider]);

  const toggle = (k) => () => setLayers((l) => ({ ...l, [k]: !l[k] }));

  const base = source ? source.name.replace(/\.[^.]+$/, '') : 'plan';
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


  return (
    <div className="app">
      {/* ONE QUESTION, BEFORE ANYTHING ELSE. Shown the moment a plan is
          readable and dismissed only by answering — see ProjectTypeDialog. */}
      {source && (!projectId || doorState.status === 'running') && (
        <ProjectTypeDialog planName={source.name} onPick={setProjectId}
          busy={doorState.status === 'running' ? 'Looking for doors…' : null}
          note="A door is a standard width, so one of them is the drawing's ruler." />
      )}
      {/* Deliberately bare. This bar carried five status pills — outlines,
          room, fans, scale, chunking — and every one of them duplicated
          something in the panel on the right, so the eye had two places to look
          and no reason to trust either. What is left is the name of the thing
          and whether it is busy. */}
      <div className="topbar">
        {/* THE LOCKUP. The mark is drawn, not loaded: it is a lit aperture — a
            disc with a halo — which is a circle and a box-shadow, and that is
            smaller than the PNG, sharp at any density, and takes the ink colour
            with it. The wordmark is live text in Lunar rather than an image, so
            it stays crisp and can be selected and searched. */}
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <span className="wordmark">Super&nbsp;Luminal</span>
          <span className="sep" aria-hidden="true" />
          <span className="where">{view === 'boq' ? 'schedule' : 'lighting layout'}</span>
        </div>
        <div className="spacer" />
        {busy && <div className="pill">{busy}</div>}
        {/* THE TAB PAIR, and it is only there once there is something to
            schedule. An empty BOQ tab on the drop screen is an invitation to a
            blank page. */}
        {source && (
          <div className="tabs" role="tablist">
            {[['design', 'Design'], ['boq', 'BOQ']].map(([k, label]) => (
              <button key={k} role="tab" aria-selected={view === k}
                className={view === k ? 'on' : ''}
                onClick={() => setView(k)}>{label}</button>
            ))}
          </div>
        )}
      </div>

      <div ref={stageRef}
        className={'stage' + (source ? '' : ' empty')
          + (boqOpen ? ' wide' : (showPicker || showTrace ? ' wide' : ''))
          + (panning ? ' panning' : '')}
        onMouseDown={stageMouseDown}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); loadFile(e.dataTransfer.files[0]); }}
      >
        {boqOpen ? (
          <BOQView boq={boq} planName={source.name} />
        ) : !source ? (
          <div className={'dropzone' + (over ? ' over' : '')}>
            <h2>Drop a floor plan</h2>
            <p>To start creating lighting schemes</p>
            
            <label className="btn primary" style={{ display: 'inline-block' }}>
              Choose a DXF or an image
              <input type="file" accept=".dxf,image/*" style={{ display: 'none' }}
                onChange={(e) => loadFile(e.target.files[0])} />
            </label>
            {dxf?.error && <p className="note err" style={{ maxWidth: '42ch', margin: '14px auto 0' }}>{dxf.error}</p>}
          </div>
        ) : showTrace ? (
          <OutlineTracer
            source={source}
            pxPerFt={pxPerFt}
            outlines={outlinesPx}
            selectedId={selectedOutlineId}
            onSelect={setSelectedOutlineId}
            onCommit={commitOutline}
            onUpdateOutline={updateOutline}
            onDeleteOutline={deleteOutline}
            onConfirm={lightOneRoom}
            onProceed={runPipeline}
            onMovePoint={movePoint}
            onInsertPoint={insertPoint}
            onRemovePoint={removePoint}
            detectState={roomState}
            onRedetect={() => setRoomNonce((n) => n + 1)}
            unitId={source.unitId}
            unitCandidates={UNITS}
            onUnitChange={(u) => { setUnitId(u); }}
            fans={isVector ? [] : fans}
            /* The scale controls live on the tracer screen for an image, but the
               state stays here: it is the same scale the sidebar edits later,
               and two copies of it would drift the moment either was touched. */
            scale={isVector ? null : {
              mode: scaleMode, setMode: setScaleMode,
              refId, setRefId, customFt, setCustomFt,
              measure, setMeasure,
              doors, doorState, pick: doorPick,
              onPickDoor: (id) => setDoorPick(id ? { id, mm: null } : null),
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
          <div className="canvas-wrap">
            <PlanCanvas ref={svgRef}
              src={isVector ? null : source.src}
              vector={isVector ? source.render : null}
              wallLayers={null}
              width={source.w} height={source.h}
              plans={rooms.map((r) => ({ id: r.id, name: r.outline.name, plan: r.plan }))}
              focusId={focus?.id ?? null}
              fansPx={obstaclesPx} pxPerFt={pxPerFt} layers={layers} zoom={zoom}
              objMode={objMode} selObjId={selObjId} onObjPointerDown={objPointerDown}
              objDragMode={objDrag?.moved ? objDrag.mode : null}
              guides={guides} ghost={ghost} clearanceFt={opt.fanClearance}
              selAccId={selAccId} onAccPointerDown={accPointerDown}
              surfaces={surfacesPx} taskSpots={taskSpotsPx}
              measure={null} onCanvasClick={onCanvasClick}
              /* Crosshair only where a click would actually do something. Off
                 the ceiling it reverts to a pointer, which is the cursor's job:
                 saying what the click will do before it is spent. */
              cursor={objDrag || accDrag ? 'grabbing'
                : (fanMode || armed || addTool) ? (overRoom ? 'crosshair' : 'pointer')
                : null}
              zones={drawnZones} draftZone={draftZone} zoneMode={zoneMode}
              onZoneDown={onZoneDown} onZoneMove={onZoneMove} onZoneUp={onZoneUp}
              accents={accentZonesPx} onFixture={setTip}
              draftRun={addTool === 'strip' && stripFrom && addAt
                ? [stripFrom, addAt] : null}
              placeSnap={addTool === 'strip' ? addSnap : null}
              sconceGhost={addTool === 'sconce' ? addGhost : null} />
            <FixtureTip tip={tip} />
          </div>
        )}
        {prep && !boqOpen && (
          <PlanLoader
            width={source.w} height={source.h}
            rooms={loaderRooms}
            phase={prep.phase} detail={prep.detail}
            done={prep.done} total={prep.total} steps={prep.steps} />
        )}
      </div>

      <div className="side">
        {/* THE BOQ PANEL HAS ONE JOB. Every other section here is a control over
            the drawing — arm a fan, recompute the accents, toggle a layer — and
            not one of them means anything while a schedule is on screen. A panel
            full of controls that act on something you cannot see is worse than
            an empty one, so it collapses to the only thing there is to do with a
            schedule: get it out of here. */}
        {boqOpen ? (
          <div className="sec">
            <h3>Export the schedule</h3>
            <p className="note" style={{ marginTop: 2, marginBottom: 10 }}>
              {boq.totals.fittings} fitting{boq.totals.fittings === 1 ? '' : 's'}
              {boq.totals.stripMetres > 0 && <> · {boq.totals.stripMetres.toFixed(2)} m of strip</>}
              {' '}· {boq.totals.watts} W
            </p>
            <div className="boq-export">
              {[['xlsx', 'Excel', '.xlsx — one sheet, quantities as numbers'],
                ['csv', 'CSV', '.csv — UTF-8, opens anywhere'],
                ['pdf', 'PDF', '.pdf — plain, for printing and marking up']].map(([k, label, note]) => (
                <button key={k} className={'btn' + (k === 'xlsx' ? ' primary' : '')}
                  onClick={() => exportBOQ(k)} title={note}>
                  <b>{label}</b><span>{note}</span>
                </button>
              ))}
            </div>
            {!boq.scaled && (
              <p className="note warn" style={{ marginTop: 10 }}>
                No scale is set, so the LED strip runs are counted but not
                measured. Set the scale and the metres appear.
              </p>
            )}
            <button className="btn" style={{ marginTop: 12, width: '100%' }}
              onClick={() => setView('design')}>← Back to the drawing</button>
          </div>
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
          <div className="sec loading-sec">
            <div className="loading-mid">
              <p className="loading-say">Lighting up your space…</p>
              {/* ONE BUTTON, and it is the destructive one. `Stop` on its own
                  kept whatever had finished, which is genuinely useful and
                  genuinely hard to explain in a panel with nothing else in it —
                  it left you on a half-lit plan with no account of which half.
                  A wait either finishes or is abandoned. */}
              <button className="btn" onClick={() => {
                stopPipeline();
                setImg(null); setDxf(null); resetForNewPlan();
              }}>Stop and start over</button>
            </div>
          </div>
        ) : <>
        <div className="sec">
          <h3>Plan</h3>
          <div className="btnrow">
            <label className="btn">Load DXF or image
              <input type="file" accept=".dxf,image/*" style={{ display: 'none' }} onChange={(e) => loadFile(e.target.files[0])} />
            </label>
            {source && <button className="btn" onClick={() => {
              setImg(null); setDxf(null); setFans([]); setChunkPicks({}); setPickingId(null);
              setOutlines([]); setSelectedOutlineId(null); setLitIds([]); setFocusId(null);
              setRoomState({ status: 'idle' }); setUnitId(null);
            }}>Clear</button>}
          </div>
          {source && (
            <div className="kv" style={{ marginTop: 8 }}>
              <span>{isVector ? 'Drawing' : 'Image'}</span>
              <b title={source.name}>{source.name.length > 22 ? source.name.slice(0, 20) + '…' : source.name}</b>
            </div>
          )}
          {dxf?.error && <p className="note warn">{dxf.error}</p>}
        </div>

        {source && step !== 'trace' && <>
          {/* --- every room on the plan ----------------------------------- */}
          {/* A list and not a dropdown. The whole plan is lit, so every room is
              on screen and every one of them is a thing you might want to look
              at the numbers for — a dropdown would hide seven of eight rooms
              behind a click and still not say which was which. */}
          <div className="sec">
            <h3>Spaces · {rooms.length}</h3>
            {rooms.map((r) => {
              const on = r.id === focus?.id;
              return (
                <div key={r.id} className={'outline-row' + (on ? ' on' : '')}>
                  <button className="outline-pick plain" onClick={() => setFocusId(r.id)}>
                    <span className="outline-name">{r.outline.name || 'Space'}</span>
                    <span className="layer-count">
                      {r.plan?.ok ? `${r.plan.lights.length} lights` : 'no layout'}
                    </span>
                  </button>
                  <div className="outline-meta">
                    <span>
                      {/* The classification, where it exists. It is the reason a
                          room did or did not get accents, so it belongs next to
                          the room rather than buried in a console log. */}
                      {roomTypes[r.id] && (
                        <b className="rtype" title={roomTypes[r.id].why}>
                          {roomTypeIn(projectId, roomTypes[r.id].type)?.label ?? 'Other'}
                        </b>
                      )}
                      {ftin(r.stats.widthFt)} × {ftin(r.stats.heightFt)}
                      {' '}· {Math.round(r.stats.areaSqft)} sqft</span>
                    <span>
                      {r.chunking?.needsChoice && (
                        <button className="btn tiny"
                          title={r.chunkingChosenBy === 'user'
                            ? 'Change how this space is cut up'
                            : `${r.chunking.options.length} ways to cut this space up — the recommended one is in use`}
                          onClick={() => { setPickingId(r.id); setFocusId(r.id); setZoneMode(false); }}>
                          {r.chunkingChosenBy === 'user' ? 'chunking ✓' : 'chunking'}
                        </button>
                      )}
                      <button className="btn tiny" title="Take this space out of the layout"
                        onClick={() => setLitIds((ids) => ids.filter((x) => x !== r.id))}>×</button>
                    </span>
                  </div>
                  {r.outline.enclosingPx?.length > 0 && (
                    <p className="note warn" style={{ margin: '2px 0 0' }}>
                      {r.outline.enclosingPx.length} space
                      {r.outline.enclosingPx.length > 1 ? 's sit' : ' sits'} wholly inside this
                      one, so {r.outline.enclosingPx.length > 1 ? 'they are' : 'it is'} held out
                      of the ceiling as a no-light zone. Drag a corner out to a wall and it
                      will be subtracted properly instead.
                    </p>
                  )}
                  {r.region?.warning && <p className="note warn" style={{ margin: '2px 0 0' }}>{r.region.warning}</p>}
                </div>
              );
            })}
            <button className="btn" style={{ marginTop: 8, width: '100%' }}
              onClick={() => { setPickingId(null); setLitIds([]); }}>
              Back to the outlines
            </button>
            {outlinesPx.length > rooms.length && (
              <button className="btn" style={{ marginTop: 6, width: '100%' }}
                onClick={lightWholePlan}>
                Light all {outlinesPx.length} outlines
              </button>
            )}
          </div>

          {/* --- what is already on the ceiling --------------------------- */}
          {/* One section for all of them, because to the layout they ARE all
              one: a centre, a radius and the same clearance. The old pair of
              fan panels — one for DXF, one for raster — said the same thing
              twice and neither could hold anything but a fan. */}
          <div className="sec">
            <h3>Ceiling objects</h3>

            {/* Four symbols, and clicking one arms it. There is no separate
                "place" button: picking the thing IS asking to place it, and a
                picker that then needs confirming was a click spent on nothing. */}
            <CeilingPalette armed={armed} disabled={!pxPerFt}
              onArm={(id) => {
                setArmed(id);
                if (id) { setObjType(id); setObjMode(true); setFanMode(false); setZoneMode(false); }
                setGuides([]); setGhost(null);
              }} />

            {/* A fan's sweep, offered only when a fan is in play — armed, or
                selected. It is the one property of the four that is a standard
                size rather than something to drag to. */}
            {(() => {
              const sel = ceilingObjs.find((o) => o.id === selObjId);
              if (armed !== 'fan' && sel?.kind !== 'fan') return null;
              const current = sel?.kind === 'fan' ? sweepMm(sel) : fanSweepMm;
              return (
                <div className="sweep">
                  {FAN_SWEEPS.map((mm) => (
                    <button key={mm} type="button" className={current === mm ? 'on' : ''}
                      onClick={() => {
                        setFanSweepMm(mm);
                        if (sel?.kind === 'fan') setCeilingObjs((os) =>
                          os.map((o) => (o.id === sel.id ? withSweep(o, mm) : o)));
                      }}>{mm} sweep</button>
                  ))}
                </div>
              );
            })()}

            {!pxPerFt && <p className="note warn">Set the scale first — these are placed at a real size.</p>}
            {armed && (
              <p className="note">Click on the plan to place the
                {' '}{CEILING_BY_ID[armed]?.label.toLowerCase()}.</p>
            )}
            

            {ceilingObjs.map((o) => {
              const on = o.id === selObjId;
              return (
                <div key={o.id} className={'outline-row' + (on ? ' on' : '')}>
                  <button className="outline-pick plain"
                    onClick={() => { setSelObjId(o.id); setObjMode(true); setArmed(null); }}>
                    <span className="outline-name">{CEILING_BY_ID[o.typeId]?.label ?? o.kind}</span>
                    <span className="layer-count">{sizeLabel(o)}</span>
                  </button>
                  <div className="outline-meta">
                    <span>
                      {isRect(o) ? (
                        <>
                          <input type="number" min="100" max="3600" step="50"
                            value={Math.round(o.wFt * 304.8)} className="mm"
                            onChange={(e) => setCeilingObjs((os) => os.map((q) => q.id === o.id
                              ? { ...q, wFt: clampFt(Number(e.target.value) / 304.8) } : q))} />
                          <span>×</span>
                          <input type="number" min="100" max="3600" step="50"
                            value={Math.round(o.hFt * 304.8)} className="mm"
                            onChange={(e) => setCeilingObjs((os) => os.map((q) => q.id === o.id
                              ? { ...q, hFt: clampFt(Number(e.target.value) / 304.8) } : q))} />
                          <span>mm · {Math.round(((o.rot || 0) * 180) / Math.PI)}°</span>
                        </>
                      ) : (
                        <span>keeps {opt.fanClearance.toFixed(1)} ft clear of its
                        {' '}{isRect(o) ? 'faces' : 'sweep'}</span>
                      )}
                    </span>
                    <button className="btn tiny" title="Remove"
                      onClick={() => { setCeilingObjs((os) => os.filter((q) => q.id !== o.id));
                                       setSelObjId((v) => (v === o.id ? null : v)); }}>×</button>
                  </div>
                </div>
              );
            })}

            {/* The detector's own fans, which are a different animal: found in
                the image, measured in pixels, and the ruler the whole drawing
                is scaled from. Listed, not editable. */}
            {fans.length > 0 && (
              <div className="kv" style={{ marginTop: 8 }}>
                <span>Fans found on the plan</span><b>{fans.length}</b></div>
            )}
            {isVector && (
              <div className="btnrow" style={{ marginTop: 8 }}>
                <button className={'btn' + (fanMode ? ' accent' : '')}
                  onClick={() => { setFanMode((v) => !v); setObjMode(false); setZoneMode(false); }}>
                  {fanMode ? 'Done' : 'Quick-place fans'}
                </button>
                {fans.length > 0 && <button className="btn" onClick={() => setFans([])}>Clear</button>}
              </div>
            )}
            <div className="kv" style={{ marginTop: 6 }}>
              <span>In {focus?.outline?.name || 'this space'}</span>
              <b>{focus?.geo?.fansInRoom?.length ?? 0} of {obstaclesPx.length}</b></div>
          </div>

          {/* --- no-light zones -------------------------------------------
              DRAW ONE, AND SEE THE ONES THAT ARE THERE. That is the whole
              section now.

              It used to also carry the bed detector's tally, a picker for which
              detector to use, a restore button for dismissed detections, and a
              line per space explaining which of two models won the judge's vote
              and why. Every one of those was real and was worth having while
              the bed pipeline was being built. None of them is the user's
              business: the beds are found, judged and kept out of the light
              before the plan is handed over, and a panel that reports on it is
              asking somebody to audit a decision they did not know was being
              made. The console still carries all of it, and the zones still
              move the fittings — see `drawnZones` for the split between what is
              obeyed and what is drawn. */}
          <div className="sec">
            <h3>No-light zones</h3>
            <div className="btnrow">
              <button className={'btn' + (zoneMode ? ' accent' : '')}
                onClick={() => {
                  setZoneMode((v) => !v); setDraftZone(null); setFanMode(false);
                  setArmed(null); disarmAdd();
                }}>
                {zoneMode ? 'Done drawing' : 'Draw zone'}
              </button>
              {zones.length > 0 && <button className="btn" onClick={() => setZones([])}>Clear all</button>}
            </div>

            {zones.length === 0 ? (
              <p className="note" style={{ marginTop: 8 }}>
                None in the layout. Draw a box over anything the lights should
                keep off.
              </p>
            ) : zones.map((z, i) => (
              <div className="kv" key={z.id}>
                <span>Zone {i + 1}</span>
                <b>
                  {pxPerFt
                    ? `${((z.x1 - z.x0) / pxPerFt).toFixed(1)} × ${((z.y1 - z.y0) / pxPerFt).toFixed(1)} ft`
                    : `${Math.round(z.x1 - z.x0)} × ${Math.round(z.y1 - z.y0)} px`}
                  <button className="btn" style={{ marginLeft: 8, padding: '1px 7px', fontSize: 11 }}
                    title="Remove zone" onClick={() => setZones((zs) => zs.filter((q) => q.id !== z.id))}>×</button>
                </b>
              </div>
            ))}
          </div>

          {step !== 'chunks' && step !== 'trace' && <>
          {/* --- ADDITIONAL LIGHTING ---------------------------------------
              THREE TOOLS WHERE THERE WERE TWO PANELS OF RESULTS.

              Both of the sections this replaces were reports: one listed what
              the accent detector had found in the selected space with a button
              to ask it again, the other did the same for task surfaces. They
              were the right shape while those detectors were the thing being
              built. On a finished layout they are two dropdowns, two model
              buttons and a scrolling list of zones nobody edits — a debugging
              surface, in the place where the obvious question is "how do I add
              a strip along that wardrobe".

              THE DETECTORS STILL RUN. They are part of the pipeline that lays
              the plan out before anyone sees it, exactly like the bed pass, and
              what they place is on the drawing and in the schedule. What went
              is their reporting, and the assumption that a fitting only exists
              because a model proposed it. */}
          <div className="sec">
            <h3>Additional lighting</h3>
            <LightPalette tool={addTool} disabled={!pxPerFt || !rooms.length}
              onPick={(t) => {
                // ONE ARMED TOOL ON THIS CANVAS AT A TIME. A ceiling object and
                // a sconce both want the next click, and two tools waiting for
                // one click is a click that does something nobody predicted.
                setAddTool(t); setStripFrom(null); setAddAt(null);
                setArmed(null); setGhost(null);
                setZoneMode(false); setDraftZone(null); setFanMode(false);
              }} />
            {!rooms.length && (
              <p className="note warn" style={{ marginTop: 8 }}>
                Light a space first — a fitting has to belong to one.
              </p>
            )}
            {(accentZonesPx.length > 0 || taskSpotsPx.length > 0) && (
              <div className="kv" style={{ marginTop: 10 }}>
                <span>On the plan</span>
                <b>{[
                  accentZonesPx.filter((z) => z.type === 'strip' && !z.rejected).length
                    ? `${accentZonesPx.filter((z) => z.type === 'strip' && !z.rejected).length} strip` : null,
                  accentZonesPx.filter((z) => z.type === 'sconce' && !z.rejected).length
                    ? `${accentZonesPx.filter((z) => z.type === 'sconce' && !z.rejected).length} sconce` : null,
                  taskSpotsPx.filter((sp) => !sp.rejected).length
                    ? `${taskSpotsPx.filter((sp) => !sp.rejected).length} spot` : null,
                ].filter(Boolean).join(' · ') || 'none yet'}</b>
              </div>
            )}
            {(manualAccents.length > 0 || manualSurfaces.length > 0) && (
              <button className="btn" style={{ marginTop: 8, width: '100%' }}
                onClick={() => { setManualAccents([]); setManualSurfaces([]); disarmAdd(); }}>
                Clear the {manualAccents.length + manualSurfaces.length} placed by hand
              </button>
            )}
          </div>

          <div className="sec">
            <h3>View</h3>
            {/* THE BUTTONS ZOOM ABOUT THE MIDDLE OF WHAT IS ON SCREEN, not
                about the drawing's origin. Stepping the number alone kept the
                top-left corner still, which means the thing you were looking at
                slid off the bottom-right every time you pressed +. The wheel
                anchors on the pointer for the same reason; there is no pointer
                on a button, so the centre of the viewport is the honest
                substitute. */}
            <div className="btnrow" style={{ marginBottom: 6 }}>
              <button className="btn" title="Zoom out (−)"
                onClick={() => zoomTo((z) => z / 1.2, stageCentre())}>−</button>
              <button className="btn" title="Actual size (0)"
                onClick={() => zoomTo(1, stageCentre())}>{Math.round(zoom * 100)}%</button>
              <button className="btn" title="Zoom in (+)"
                onClick={() => zoomTo((z) => z * 1.2, stageCentre())}>+</button>
              <button className="btn" title="Fit the plan to the window (F)"
                onClick={() => setZoom(fitZoom())}>Fit</button>
            </div>
            <p className="note" style={{ marginTop: 0, marginBottom: 8 }}>
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
              ['accents', 'Accent lighting'], ['spots', 'Directional spots']].map(([k, l]) => (
              <label className="check" key={k}><input type="checkbox" checked={layers[k]} onChange={toggle(k)} />{l}</label>
            ))}
          </div>

          {totals.rooms > 0 && (
            <div className="sec">
              <h3>Result</h3>
              <div className="stats">
                <div className="stat"><b>{totals.lights}</b><span>lights</span></div>
                <div className="stat"><b>{totals.perSqft.toFixed(0)}</b><span>lm / sq ft</span></div>
              </div>
              <div className="kv" style={{ marginTop: 6 }}>
                <span>Over</span>
                <b>{totals.rooms} space{totals.rooms > 1 ? 's' : ''}, {Math.round(totals.areaSqft)} sq ft</b></div>
              {/* Named per room. A warning about a light off its cell centre is
                  useless if you cannot tell which of eight rooms it is in. */}
              {troubles.map((t, i) => (
                <p className="note warn" key={i}><b>{t.name}</b> — {t.msg}</p>
              ))}
            </div>
          )}
          {totals.rooms === 0 && rooms.length > 0 && (
            <div className="sec"><p className="note warn">
              No space on this plan produced a layout. {troubles[0]?.msg || ''}
            </p></div>
          )}

          <div className="sec">
            <h3>Export</h3>
            {/* THE CAD EXPORT, and it is only offered on a DXF because it is
                only meaningful on one: it comes back out in the ORIGINAL file's
                coordinates so it overlays the drawing it came from. There is
                nothing for an image's pixels to line up with. */}
            {isVector && (
              <>
                <button className="btn primary" style={{ width: '100%', marginBottom: 8 }}
                  disabled={!totals.rooms}
                  onClick={() => download(`${exportBase}-superluminal.dxf`,
                    toSuperluminalDXF({
                      source,
                      rooms: rooms.map((r) => ({ name: r.outline.name, plan: r.plan })),
                      objects: obstaclesPx,
                      accents: accentZonesPx,
                      spots: taskSpotsPx,
                    }), 'application/dxf')}>
                  Export for CAD
                </button>
                <p className="note" style={{ marginBottom: 10 }}>
                  Five layers, split by trade — <code>superluminal_spots</code>
                  {' '}(ambient and directional), <code>superluminal_led_strips</code>,
                  {' '}<code>superluminal_decorative</code> (chandeliers and sconces),
                  {' '}<code>superluminal_ceiling_objects</code> (fans, AC, trap doors)
                  {' '}and <code>superluminal_rooms</code> — in this drawing's own units
                  and origin, so it lands straight on top of the original.
                </p>
              </>
            )}

            <div className="btnrow">
              <button className="btn" disabled={!totals.rooms}
                onClick={() => download(`${exportBase}-lights.dxf`,
                  toDXF(rooms.map((r) => ({ name: r.outline.name, plan: r.plan })),
                        { pxPerFt, heightPx: source.h }), 'application/dxf')}>DXF</button>
              <button className="btn" disabled={!totals.rooms}
                onClick={() => download(`${exportBase}-lights.csv`,
                  toCSV(rooms.map((r) => ({ name: r.outline.name, plan: r.plan })),
                        { pxPerFt }), 'text/csv')}>CSV</button>
              <button className="btn" disabled={!totals.rooms}
                onClick={() => download(`${exportBase}-lights.json`,
                  toJSON(rooms.map((r) => ({ name: r.outline.name, plan: r.plan })),
                         exportMeta), 'application/json')}>JSON</button>
              <button className="btn" disabled={!source} onClick={() => download(`${exportBase}-lights.svg`, svgString(svgRef.current), 'image/svg+xml')}>SVG</button>
              <button className="btn" disabled={!source} onClick={async () => download(`${exportBase}-lights.png`, await svgToPNG(svgRef.current, source.w))}>PNG</button>
            </div>
          
          </div>
          </>}
        </>}
        </>
        )}
      </div>
    </div>
  );
}

