import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { REFERENCES, scaleFromFans, scaleFromReference } from './lib/scale.js';
import { proposeOutlines } from './lib/outlineSources.js';
import { detectFurniture, detectionsToZones, zonesFromDetections, snapshotForDetection, rectCentre, iou, ZONE_CLASSES, PROVIDERS, DEFAULT_PROVIDER } from './lib/furniture.js';
import { download, toJSON, toCSV, toDXF, toSuperluminalDXF, svgString, svgToPNG } from './lib/exporters.js';
import AccentPanel from './components/AccentPanel.jsx';
import CeilingPalette from './components/CeilingPalette.jsx';
import TaskSurfacePanel from './components/TaskSurfacePanel.jsx';
import { SURFACE_BY_ID } from './lib/taskSurfaces.js';
import { planTaskSpots, chunkFor } from './lib/taskSpots.js';
import { roomSnapshot, requestAccents, toPlanRect } from './lib/accentMask.js';
import { TYPE_BY_ID, FURNITURE_BY_ID } from './lib/accentPrompt.js';
import { zonesFromFurniture, slideSconceTo, setRunEnd } from './lib/accentPlace.js';
import { CEILING_BY_ID, makeCeilingObject, toObstaclePx,
         sizeLabel, radiusFt, clampFt, resizeFromCorner, rotateTo, isRect,
         halfExtents, isUniform, applyResize, FAN_SWEEPS, sweepMm, withSweep }
         from './lib/ceilingObjects.js';
import { collectTargets, snapPoint, SNAP_DEFAULTS } from './lib/snapGuides.js';

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
  const [surfaceRoomId, setSurfaceRoomId] = useState(null);
  const [surfaceResults, setSurfaceResults] = useState({});
  const [surfaceState, setSurfaceState] = useState({ status: 'idle', roomId: null });
  const [surfaceDismissed, setSurfaceDismissed] = useState([]);

  const [selAccId, setSelAccId] = useState(null);
  const [accDrag, setAccDrag] = useState(null);   // {roomId, id, mode}
  // Not on the plan, and every mounting height and throw distance depends on
  // it. One field, and load-bearing — see the header of accentPrompt.js.
  const [ceilingFt, setCeilingFt] = useState(10);

  const [scaleMode, setScaleMode] = useState('fan');   // fan | ref | manual
  const [fanSweep, setFanSweep] = useState('fan1200');
  const [refId, setRefId] = useState('door900');
  const [customFt, setCustomFt] = useState(3);
  const [measure, setMeasure] = useState({ a: null, b: null });
  const [manualPx, setManualPx] = useState(20);

  // Not state. Every dial that used to be a slider now lives in settings.js —
  // see the header there for why.
  const opt = PLAN_OPTIONS;
  const useBoundingRect = SIMPLIFY_ROOM_TO_RECTANGLE;
  const [layers, setLayers] = useState({ plan: true, dim: true, region: true, grid: true, cells: true, lights: true, labels: false, fan: true, zones: true, accents: true, objects: true, surfaces: true, spots: true, secondary: false });
  const [zoom, setZoom] = useState(1);
  const [over, setOver] = useState(false);
  const svgRef = useRef(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS) || '{}');
      if (saved.provider) setProvider(saved.provider);
      if (saved.fanSweep) setFanSweep(saved.fanSweep);
    } catch { /* first run */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(LS, JSON.stringify({ fanSweep, provider })); } catch { /* private mode */ }
  }, [fanSweep, provider]);

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
    if (scaleMode === 'manual') return manualPx > 0 ? manualPx : null;
    if (scaleMode === 'ref') {
      if (!measure.a || !measure.b) return null;
      const len = Math.hypot(measure.b.x - measure.a.x, measure.b.y - measure.a.y);
      const ref = REFERENCES.find((r) => r.id === refId);
      return scaleFromReference(len, ref?.ft ?? customFt);
    }
    const sweep = REFERENCES.find((r) => r.id === fanSweep)?.ft ?? 3.94;
    return fans.length ? scaleFromFans(fans, sweep) : null;
  }, [isVector, source, scaleMode, manualPx, measure, refId, customFt, fans, fanSweep]);

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

      const chunking = enumerateChunkings(geo.polygonFt, geo.zonesFt, chunkOpt, geo.fixturesFt);
      // A remembered intent, resolved afresh each time. Change the space enough
      // that the chosen reading no longer exists and the recommendation takes
      // over, rather than a different reading quietly wearing the same name.
      const picked = chunkPicks[o.id]
        ? findChunking(chunking.options, chunkPicks[o.id])?.id ?? null
        : null;
      const chosenId = picked ?? chunking.recommendedId ?? null;

      const res = planLights(geo.polygonFt, geo.fixturesFt,
        { ...opt, chunkStrategy: chosenId || 'auto' }, geo.zonesFt);

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
      chunkOpt, chunkPicks, opt, enclosedZones]);

  // What the canvas draws: every zone, whoever it belongs to. The planner sees
  // the per-room subsets above; this is only for the eye.
  const drawnZones = useMemo(
    () => [...zoneList, ...rooms.flatMap((r) => enclosedZones(r.outline))],
    [zoneList, rooms, enclosedZones]);

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

  const runAccents = useCallback(async () => {
    if (!accentRoom?.plan?.ok || !source) return;
    const r = accentRoom;
    // The crop is built by the effect above. If it is not there yet, or belongs
    // to the room we were looking at a moment ago, make one now rather than
    // sending the wrong room's picture — which is a failure nothing downstream
    // could possibly detect.
    let shot = accentShot?.roomId === r.id ? accentShot : null;
    setAccentState({ status: 'running', roomId: r.id });
    const t0 = Date.now();
    // ZONE IDS ARE POSITIONAL — acc-<room>-<index> — so a second run renumbers
    // them from zero and a dismissal from the first run would land on whatever
    // fixture happens to take that index next. Clearing this room's dismissals
    // as the run starts is what stops a brand-new zone being born struck
    // through, invisible on the canvas, for no reason the user could see.
    setAccentDismissed((d) => d.filter((x) => !x.startsWith(`acc-${r.id}-`)));
    try {
      if (!shot) {
        shot = await roomSnapshot({
          source, img, polygonPx: r.plan.polygonPx,
          lightsPx: r.plan.lightsPx, wallLayers: wallLayerSet,
        });
        setAccentShot({ ...shot, roomId: r.id });
      }
      console.log(`[accents] ${r.outline.name || 'room'}: sending ${shot.w}x${shot.h} crop`,
        { crop: shot.crop, sent: shot.dataUrl });

      const payload = await requestAccents({
        plan: shot,
        room: {
          name: r.outline.name || null,
          widthFt: r.stats.widthFt, heightFt: r.stats.heightFt, areaSqft: r.stats.areaSqft,
        },
        ceilingFt,
      });
      console.log('[accents] server:', payload.meta);

      // OUT OF THE CROP AND BACK ONTO THE PLAN. The model answered in fractions
      // of an image that was a cut-out of one room; every other rectangle in
      // this app is in plan pixels, and a zone that stayed in the crop's space
      // would draw itself in the top-left corner of the sheet.
      // OUT OF THE CROP AND BACK ONTO THE PLAN. The model answered in fractions
      // of an image that was a cut-out of one room; every other rectangle in
      // this app is in plan pixels, and furniture left in the crop's space
      // would sit in the top-left corner of the sheet.
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

      // AND THEN THE RULES, IN CODE. The model was asked what furniture is in
      // the room and nothing else; this is where a bed becomes a pair of
      // sconces at either end of itself and a wardrobe becomes a strip along
      // its own length. Deterministic, so the house style is the same every
      // run — see accentPrompt.js's header for what happened when it was not.
      const { zones: placed, handled } = zonesFromFurniture(furniture, r.plan.polygonPx);
      const zones = placed.map((z, i) => ({
        ...z,
        id: `acc-${r.id}-${i}`,
        // Carried on the fitting so a drag handler knows which room's result
        // list to write back into. The zones live per-room in accentResults,
        // and the canvas draws them all in one flat pass.
        roomId: r.id,
        colour: TYPE_BY_ID[z.type]?.colour || '#666',
        label: TYPE_BY_ID[z.type]?.label || z.type,
        short: TYPE_BY_ID[z.type]?.short || z.type,
        runFt: z.runLength != null && pxPerFt ? z.runLength / pxPerFt : null,
      }));
      console.log(`[accents] ${furniture.length} piece(s) of furniture -> `
        + `${zones.length} fitting(s), ${zones.filter((z) => z.rejected).length} unplaceable`,
        { furniture, handled, zones });

      setAccentResults((m) => ({ ...m, [r.id]: { ...res, furniture, handled, zones } }));
      setAccentState({ status: 'done', roomId: r.id, ms: Date.now() - t0, meta: payload.meta });
    } catch (err) {
      console.warn('[accents] failed:', err);
      setAccentState({ status: 'error', roomId: r.id, error: String(err.message || err), ms: Date.now() - t0 });
    }
  }, [accentRoom, accentShot, source, img, wallLayerSet, pxPerFt, ceilingFt]);

  const surfaceRoom = useMemo(
    () => rooms.find((r) => r.id === surfaceRoomId) || rooms[0] || null,
    [rooms, surfaceRoomId]);

  /**
   * Find the task surfaces in one room.
   *
   * The SAME masked crop the accent pass sends, built the same way, because it
   * is the same picture of the same room — only the question over the wire
   * differs. Nothing here is cached: this runs once per press, and a crop is
   * cheap next to the call it precedes.
   */
  const runSurfaces = useCallback(async () => {
    if (!surfaceRoom?.plan?.ok || !source) return;
    const r = surfaceRoom;
    setSurfaceState({ status: 'running', roomId: r.id });
    const t0 = Date.now();
    try {
      const shot = await roomSnapshot({
        source, img, polygonPx: r.plan.polygonPx,
        lightsPx: r.plan.lightsPx, wallLayers: wallLayerSet,
      });
      const payload = await requestAccents({
        plan: shot,
        task: 'surfaces',
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
          id: `surf-${r.id}-${i}`,
          roomId: r.id,
          rect,
          colour: t?.colour || '#666',
          label: t?.label || sf.type,
          widthFt: pxPerFt ? (rect.x1 - rect.x0) / pxPerFt : null,
          heightFt: pxPerFt ? (rect.y1 - rect.y0) / pxPerFt : null,
        };
      });
      console.log(`[surfaces] ${r.outline.name || 'room'}: ${surfaces.length}`,
        { sent: shot.dataUrl, meta: payload.meta, surfaces });
      // A fresh run replaces this room's list, so its dismissals go with it —
      // the ids are positional and would otherwise land on different surfaces.
      setSurfaceDismissed((d) => d.filter((x) => !x.startsWith(`surf-${r.id}-`)));
      setSurfaceResults((m) => ({ ...m, [r.id]: { ...res, surfaces } }));
      setSurfaceState({ status: 'done', roomId: r.id, ms: Date.now() - t0 });
    } catch (err) {
      console.warn('[surfaces] failed:', err);
      setSurfaceState({ status: 'error', roomId: r.id,
                        error: String(err.message || err), ms: Date.now() - t0 });
    }
  }, [surfaceRoom, source, img, wallLayerSet, pxPerFt]);

  /** What the canvas draws: every surface still standing, in plan pixels. */
  const surfacesPx = useMemo(() => {
    const out = [];
    for (const r of rooms) {
      const res = surfaceResults[r.id];
      if (!res?.surfaces) continue;
      for (const sf of res.surfaces) if (!surfaceDismissed.includes(sf.id)) out.push(sf);
    }
    return out;
  }, [rooms, surfaceResults, surfaceDismissed]);

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
      // Chunk taken from the FIRST surface's centre. Every surface in one room
      // is placed against one chunk's grid, which is right for the common case
      // and is the known limit for a room cut into several.
      const chunk = chunkFor(
        { x: (inFt[0].x0 + inFt[0].x1) / 2, y: (inFt[0].y0 + inFt[0].y1) / 2 },
        r.plan.chunks);
      if (!chunk) continue;

      const placed = planTaskSpots(inFt, {
        chunk,
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
  const accentZonesPx = useMemo(() => {
    const out = [];
    for (const r of rooms) {
      const res = accentResults[r.id];
      if (!res?.zones) continue;
      for (const z of res.zones) if (!accentDismissed.includes(z.id)) out.push(z);
    }
    return out;
  }, [rooms, accentResults, accentDismissed]);

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

  /** One line per room, and only where something actually went wrong. */
  const troubles = useMemo(() => rooms.flatMap((r) => {
    const name = r.outline.name || 'Room';
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
  const step = !source ? 'upload'
    : !litIds.length ? 'trace'
    : pickingId ? 'chunks'
    : 'plan';
  const showTrace = step === 'trace';
  const picking = pickingId ? rooms.find((r) => r.id === pickingId) : null;
  const showPicker = step === 'chunks' && !zoneMode && !!picking;


  // --- interactions ---------------------------------------------------------
  const svgPoint = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * source.w, y: ((e.clientY - r.top) / r.height) * source.h };
  };

  const fanRadiusPx = () => {
    const sweep = REFERENCES.find((r) => r.id === fanSweep)?.ft ?? 3.94;
    return ((pxPerFt || 20) * sweep) / 2;
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

  const snapTargets = useCallback((excludeId) => collectTargets({
    rooms: rooms.map((r) => ({ id: r.id, name: r.outline.name, polygonPx: r.plan?.polygonPx || r.geo?.polygonPx })),
    objects: obstaclesPx.filter((o) => o.source === 'placed'),
    exclude: excludeId,
  }), [rooms, obstaclesPx]);

  /** Screen pixels -> plan pixels. The tolerance must not stiffen as you zoom. */
  const snapTol = () => SNAP_DEFAULTS.tolScreenPx / (zoom || 1);

  const applySnap = (ptPx, excludeId) => {
    const r = snapPoint(ptPx, snapTargets(excludeId), { tol: snapTol() });
    setGuides(r.guides);
    return r;
  };

  const objPointerDown = (e, id, mode, corner = null) => {
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
    e.stopPropagation();
    e.preventDefault();
    svgRef.current?.setPointerCapture?.(e.pointerId);
    setSelAccId(id);
    setSelObjId(null);
    setArmed(null);
    setAccDrag({ roomId, id, mode, pointerId: e.pointerId });
  };

  const accPointerMove = (e) => {
    if (!accDrag) return;
    const p = svgPoint(e);
    setAccentResults((m) => {
      const res = m[accDrag.roomId];
      if (!res?.zones) return m;
      const zones = res.zones.map((z) => {
        if (z.id !== accDrag.id) return z;
        if (accDrag.mode === 'slide') return slideSconceTo(z, p);
        if (accDrag.mode === 'end0') return setRunEnd(z, 0, p);
        if (accDrag.mode === 'end1') return setRunEnd(z, 1, p);
        return z;
      });
      return { ...m, [accDrag.roomId]: { ...res, zones } };
    });
  };

  const accPointerUp = () => { if (accDrag) setAccDrag(null); };

  /** Escape backs out, Delete removes. The two keys every editor answers to. */
  useEffect(() => {
    if (!objMode && !armed && !selAccId) return;
    const onKey = (e) => {
      const t = e.target;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (e.key === 'Escape') {
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
  }, [objMode, armed, selObjId, objDrag, selAccId, accDrag]);

  const onCanvasClick = (e) => {
    // Ceiling objects are handled entirely in the pointer events — see the note
    // on objPointerDown. Nothing about them may happen on a click.
    if (zoneMode || !source || objMode || armed) return;
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
  const onZoneDown = (e) => {
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
    if (!zoneMode || !draftZone) return;
    const p = svgPoint(e);
    setDraftZone((d) => (d ? { ...d, x1: p.x, y1: p.y } : d));
  };
  const onZoneUp = () => {
    if (objDrag) { objPointerUp(); return; }
    if (accDrag) { accPointerUp(); return; }
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
          provider, w: shot.w, h: shot.h,
        });
        if (!alive) return;
        if (payload?.meta) console.log('[detect] server:', payload.meta);

        // No polygon here on purpose: find everything on the plan now, and let
        // the room filter it later.
        const image = { w: source.w, h: source.h };
        const { kept, rejected } = detectionsToZones(payload, { image, polygon: null });
        console.log(`[detect] kept ${kept.length}, rejected ${rejected.length}`, { kept, rejected });

        setDetections(kept.map((k, i) => ({ ...k, id: `det-${i}-${Math.round(k.rect.x0)}-${Math.round(k.rect.y0)}` })));
        setDetectState({
          status: 'done', rejected, ms: Date.now() - t0,
          meta: payload?.meta ?? null, count: kept.length, kind: source.kind,
          provider,
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
      {/* Deliberately bare. This bar carried five status pills — outlines,
          room, fans, scale, chunking — and every one of them duplicated
          something in the panel on the right, so the eye had two places to look
          and no reason to trust either. What is left is the name of the thing
          and whether it is busy. */}
      <div className="topbar">
        <div className="brand">Light Planner <span>/ ambient layout</span></div>
        <div className="spacer" />
        {busy && <div className="pill">{busy}</div>}
      </div>

      <div className={'stage' + (source ? '' : ' empty') + (showPicker || showTrace ? ' wide' : '')}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); loadFile(e.dataTransfer.files[0]); }}
      >
        {!source ? (
          <div className={'dropzone' + (over ? ' over' : '')}>
            <h2>Drop a floor plan</h2>
            <p>To start creating lighting schemes</p>
            
            <label className="btn primary" style={{ display: 'inline-block' }}>
              Choose a DXF or an image
              <input type="file" accept=".dxf,image/*" style={{ display: 'none' }}
                onChange={(e) => loadFile(e.target.files[0])} />
            </label>
            {dxf?.error && <p className="note warn" style={{ maxWidth: '42ch', margin: '14px auto 0' }}>{dxf.error}</p>}
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
            onProceed={lightWholePlan}
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
              fanSweep, setFanSweep, refId, setRefId,
              customFt, setCustomFt, manualPx, setManualPx,
              measure, setMeasure, fanReason,
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
                : (fanMode || armed) ? (overRoom ? 'crosshair' : 'pointer')
                : null}
              zones={drawnZones} draftZone={draftZone} zoneMode={zoneMode}
              onZoneDown={onZoneDown} onZoneMove={onZoneMove} onZoneUp={onZoneUp}
              accents={accentZonesPx} />
          </div>
        )}
      </div>

      <div className="side">
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
            <h3>Rooms · {rooms.length}</h3>
            {rooms.map((r) => {
              const on = r.id === focus?.id;
              return (
                <div key={r.id} className={'outline-row' + (on ? ' on' : '')}>
                  <button className="outline-pick plain" onClick={() => setFocusId(r.id)}>
                    <span className="outline-name">{r.outline.name || 'Room'}</span>
                    <span className="layer-count">
                      {r.plan?.ok ? `${r.plan.lights.length} lights` : 'no layout'}
                    </span>
                  </button>
                  <div className="outline-meta">
                    <span>{ftin(r.stats.widthFt)} × {ftin(r.stats.heightFt)}
                      {' '}· {Math.round(r.stats.areaSqft)} sqft</span>
                    <span>
                      {r.chunking?.needsChoice && (
                        <button className="btn tiny"
                          title={r.chunkingChosenBy === 'user'
                            ? 'Change how this room is cut up'
                            : `${r.chunking.options.length} ways to cut this room up — the recommended one is in use`}
                          onClick={() => { setPickingId(r.id); setFocusId(r.id); setZoneMode(false); }}>
                          {r.chunkingChosenBy === 'user' ? 'chunking ✓' : 'chunking'}
                        </button>
                      )}
                      <button className="btn tiny" title="Take this room out of the layout"
                        onClick={() => setLitIds((ids) => ids.filter((x) => x !== r.id))}>×</button>
                    </span>
                  </div>
                  {r.outline.enclosingPx?.length > 0 && (
                    <p className="note warn" style={{ margin: '2px 0 0' }}>
                      {r.outline.enclosingPx.length} room
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
              <p className="note">Click the plan to place the
                {' '}{CEILING_BY_ID[armed]?.label.toLowerCase()}. Guides appear when it lines up
                with a room's centre or another object. Esc to cancel.</p>
            )}
            {objMode && !armed && (
              <p className="note">Drag to move. Corner handles resize — <b>Shift</b> keeps the
                ratio, <b>Alt</b> resizes from the centre. The stem above an AC unit rotates it;
                <b> Shift</b> snaps to 15°. <b>Del</b> removes, <b>Esc</b> deselects.</p>
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
              <span>In {focus?.outline?.name || 'this room'}</span>
              <b>{focus?.geo?.fansInRoom?.length ?? 0} of {obstaclesPx.length}</b></div>
          </div>

          {/* --- no-light zones ------------------------------------------- */}
          <div className="sec">
            <h3>No-light zones</h3>
            <div className="btnrow">
              <button className={'btn' + (zoneMode ? ' accent' : '')}
                onClick={() => { setZoneMode((v) => !v); setDraftZone(null); setFanMode(false); }}>
                {zoneMode ? 'Done drawing' : 'Draw zone'}
              </button>
              {zones.length > 0 && <button className="btn" onClick={() => setZones([])}>Clear all</button>}
            </div>

            {detectedZones.map((z) => (
              <div className="kv" key={z.id}>
                <span>{z.cls === 'bed' ? 'Bed' : z.cls} <span style={{ opacity: 0.6 }}>· found</span></span>
                <b>
                  {pxPerFt ? `${((z.x1 - z.x0) / pxPerFt).toFixed(1)} × ${((z.y1 - z.y0) / pxPerFt).toFixed(1)} ft` : `${Math.round(z.x1 - z.x0)} × ${Math.round(z.y1 - z.y0)} px`}
                  <button className="btn" style={{ marginLeft: 8, padding: '1px 7px', fontSize: 11 }}
                    title="Not a bed — remove this zone"
                    onClick={() => setDismissed((d) => [...d, z.id])}>×</button>
                </b>
              </div>
            ))}
            {zones.map((z, i) => (
              <div className="kv" key={z.id}>
                <span>Zone {i + 1}</span>
                <b>
                  {pxPerFt ? `${((z.x1 - z.x0) / pxPerFt).toFixed(1)} × ${((z.y1 - z.y0) / pxPerFt).toFixed(1)} ft` : `${Math.round(z.x1 - z.x0)} × ${Math.round(z.y1 - z.y0)} px`}
                  <button className="btn" style={{ marginLeft: 8, padding: '1px 7px', fontSize: 11 }}
                    title="Remove zone" onClick={() => setZones((zs) => zs.filter((q) => q.id !== z.id))}>×</button>
                </b>
              </div>
            ))}
            {dismissed.length > 0 && (
              <button className="btn" style={{ marginTop: 6 }} onClick={() => setDismissed([])}>
                Restore {dismissed.length} dismissed
              </button>
            )}

            {/* The bed detector, as three lines. It used to be a whole essay
                plus a side-by-side of what was sent and what came back — a
                debugging surface, useful once and in the way ever after. The
                console still carries all of it. */}
            <div className="kv" style={{ marginTop: 10 }}><span>Beds</span>
              <b>{detectState.status === 'running' ? 'looking…'
                : detectState.status === 'error' ? 'detector offline'
                : detectState.status === 'done'
                  ? `${detectState.count} on the plan, ${rooms.reduce((n, r) => n + (r.plan?.zonesPx?.filter((z) => z.source === 'detected').length ?? 0), 0)} in a room`
                  : '—'}</b></div>
            <div className="kv"><span>Detector</span>
              <select value={provider} onChange={(e) => setProvider(e.target.value)}
                style={{ width: 'auto', padding: '2px 4px', fontSize: 11 }}>
                {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select></div>
            <button className="btn" style={{ marginTop: 6 }} disabled={!!busy}
              onClick={() => setDetectNonce((n) => n + 1)}>Look again</button>
          </div>

          {/* Chunking moved into the room rows above. With one room a whole
              panel for it was reasonable; with eight, one panel can only talk
              about one of them, and which one it meant was never on screen. */}

          {step !== 'chunks' && step !== 'trace' && <>
          {/* The accent layer. It sits directly under the no-light zones
              because that is the order the work happens in: the ambient ceiling
              is settled, the obstacles on it are settled, and only then is
              there something to hang an accent scheme off. */}
          <AccentPanel
            rooms={rooms}
            roomId={accentRoom?.id ?? null}
            onRoomChange={setAccentRoomId}
            sent={accentShot?.roomId === accentRoom?.id ? accentShot : null}
            state={accentState.roomId === accentRoom?.id ? accentState : { status: 'idle' }}
            result={accentResults[accentRoom?.id] || null}
            dismissed={accentDismissed}
            onToggleZone={(zid) => setAccentDismissed((d) =>
              d.includes(zid) ? d.filter((x) => x !== zid) : [...d, zid])}
            onClear={() => {
              const rid = accentRoom?.id;
              setAccentResults((m) => { const n = { ...m }; delete n[rid]; return n; });
              setAccentDismissed((d) => d.filter((x) => !x.startsWith(`acc-${rid}-`)));
              setAccentState({ status: 'idle', roomId: null });
            }}
            onRun={runAccents}
            ceilingFt={ceilingFt}
            onCeilingChange={setCeilingFt}
            selId={selAccId}
            onSelect={(id) => { setSelAccId(id); setSelObjId(null); setArmed(null); }} />

          <TaskSurfacePanel
            rooms={rooms}
            roomId={surfaceRoom?.id ?? null}
            onRoomChange={setSurfaceRoomId}
            state={surfaceState.roomId === surfaceRoom?.id ? surfaceState : { status: 'idle' }}
            result={surfaceResults[surfaceRoom?.id] || null}
            dismissed={surfaceDismissed}
            onToggle={(id) => setSurfaceDismissed((d) =>
              d.includes(id) ? d.filter((x) => x !== id) : [...d, id])}
            onClear={() => {
              const rid = surfaceRoom?.id;
              setSurfaceResults((m) => { const n = { ...m }; delete n[rid]; return n; });
              setSurfaceDismissed((d) => d.filter((x) => !x.startsWith(`surf-${rid}-`)));
              setSurfaceState({ status: 'idle', roomId: null });
            }}
            onRun={runSurfaces}
            spots={taskSpotsPx} />

          <div className="sec">
            <h3>View</h3>
            <div className="btnrow" style={{ marginBottom: 6 }}>
              <button className="btn" onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)))}>−</button>
              <button className="btn" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
              <button className="btn" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}>+</button>
            </div>
            {[['plan', 'Floor plan'], ['dim', 'Fade the plan'], ['region', 'Room outline'], ['grid', 'Grid lines'],
              ['cells', 'Cell shading'], ['lights', 'Lights'], ['labels', 'Light tags'], ['fan', 'Ceiling objects'],
              ['zones', 'No-light zones'], ['accents', 'Accent zones'],
              ['surfaces', 'Task surfaces'], ['spots', 'Task spots'],
              ['secondary', 'Secondary grid']].map(([k, l]) => (
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
                <b>{totals.rooms} room{totals.rooms > 1 ? 's' : ''}, {Math.round(totals.areaSqft)} sq ft</b></div>
              {/* Named per room. A warning about a light off its cell centre is
                  useless if you cannot tell which of eight rooms it is in. */}
              {troubles.map((t, i) => (
                <p className="note warn" key={i}><b>{t.name}</b> — {t.msg}</p>
              ))}
            </div>
          )}
          {totals.rooms === 0 && rooms.length > 0 && (
            <div className="sec"><p className="note warn">
              No room on this plan produced a layout. {troubles[0]?.msg || ''}
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
            {totals.rooms > 1 && (
              <p className="note">One file for the whole plan. The DXF puts each
                room's outline and grid on its own layer; the CSV names the room
                in the first column.</p>
            )}
          </div>
          </>}
        </>}
      </div>
    </div>
  );
}

