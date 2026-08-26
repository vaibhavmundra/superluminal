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
import { detectFurniture, detectionsToZones, zonesFromDetections, snapshotForDetection, rectCentre, ZONE_CLASSES, PROVIDERS, DEFAULT_PROVIDER } from './lib/furniture.js';
import { download, toJSON, toCSV, toDXF, svgString, svgToPNG } from './lib/exporters.js';

const LS = 'lightPlanner.v1';

const ftin = (v) => {
  const f = Math.floor(v), i = Math.round((v - f) * 12);
  return i === 12 ? `${f + 1}'0"` : `${f}'${i}"`;
};

export default function App() {
  // TWO WAYS IN, one pipeline — and since the outline became something you
  // draw, the two have very nearly converged. BOTH kinds of plan are traced by
  // hand over the drawing (see OutlineTracer); the only thing a DXF still does
  // for you is state its own scale, where an image has to be measured first.
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
  const [litOutlineId, setLitOutlineId] = useState(null);             // the one being lit
  const [fanMode, setFanMode] = useState(false);

  const [busy, setBusy] = useState('');
  const [fans, setFans] = useState([]);
  const [fanReason, setFanReason] = useState('');

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

  // Which of the possible chunk decompositions to light. Held as a STRATEGY ID,
  // not a set of rectangles: the user is choosing how to read the space, and
  // that intent should survive a nudge of the target-cell slider.
  const [chunkPick, setChunkPick] = useState(null);

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
  const [layers, setLayers] = useState({ plan: true, dim: true, region: true, grid: true, cells: true, lights: true, labels: false, fan: true, zones: true });
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
    setZones([]); setZoneMode(false); setDraftZone(null); setChunkPick(null);
    setDetections([]); setDetectState({ status: 'idle' }); setDismissed([]);
    setFans([]); setFanReason(''); setFanMode(false);
    setOutlines([]); setSelectedOutlineId(null); setLitOutlineId(null); setUnitId(null);
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
    return outlines.map((o) => ({ ...o, pointsPx: o.pointsDu.map(source.fromDu) }));
  }, [source, outlines]);

  const litOutline = useMemo(
    () => outlinesPx.find((o) => o.id === litOutlineId) || null,
    [outlinesPx, litOutlineId]);

  const commitOutline = useCallback((pointsPx) => {
    if (!source) return;
    const o = makeOutline(pointsPx, { name: nextOutlineName(outlines) });
    const stored = { id: o.id, name: o.name, rectify: o.rectify,
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
    setLitOutlineId((s) => (s === id ? null : s));
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

  // ONE REGION, and now only one way of arriving at it: the outline the user
  // traced. It sits below the scale rather than above it because on an image
  // the scale is what turns a shape into a room — an outline with no px/ft has
  // corners but no size, and there is nothing to lay a grid of lights against.
  const region = litOutline && pxPerFt ? regionFromOutline(litOutline, pxPerFt) : null;

  // Which detections are obstacles in THIS ceiling. A whole-floor plan has
  // three bedrooms on it and only one of them is being lit, so a bed counts
  // only once its centre falls inside the region. Before a boundary exists
  // this is empty — the detections are held, not applied.
  const detectedZones = useMemo(() => {
    if (!source || !detections.length) return [];
    const poly = region?.ok ? (useBoundingRect ? region.boundingRect : region.polygon) : null;
    if (!poly) return [];
    const live = detections.filter((d) => !dismissed.includes(d.id)
      && pointInPolygon(rectCentre(d.rect), poly));
    return zonesFromDetections(live, { image: { w: source.w, h: source.h }, pxPerFt })
      .map((z, i) => ({ ...z, id: live[i].id }));
  }, [detections, dismissed, region, useBoundingRect, source, pxPerFt]);

  // What the planner and the canvas actually see. Hand-drawn zones and detected
  // ones behave identically from here on — that was the point of making a
  // detection produce a rectangle rather than a new kind of obstacle.
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

  // --- the space, in feet ---------------------------------------------------
  // Split out from the layout on purpose: the chunk choice sits between them.
  // Nothing here depends on how the space will be cut up, so it survives the
  // user changing their mind about that.
  const geo = useMemo(() => {
    if (!region?.ok || !pxPerFt) return null;
    const polygonPx = useBoundingRect ? region.boundingRect : region.polygon;
    const b = bbox(polygonPx);
    const origin = { x: b.minX, y: b.minY };
    const toFt = (p) => ({ x: (p.x - origin.x) / pxPerFt, y: (p.y - origin.y) / pxPerFt });
    const toPx = (p) => ({ x: p.x * pxPerFt + origin.x, y: p.y * pxPerFt + origin.y });
    // A whole-floor DXF carries fans for every room. Only the ones over THIS
    // ceiling are obstacles in THIS layout — and the same is true of a marked-up
    // image with several rooms circled on it.
    const mine = fans.filter((f) => pointInPolygon({ x: f.x, y: f.y }, polygonPx));
    return {
      polygonPx, origin, toFt, toPx,
      polygonFt: polygonPx.map(toFt),
      fansInRoom: mine,
      fixturesFt: mine.map((f) => ({ type: 'fan', ...toFt(f), r: f.r / pxPerFt })),
      zonesFt: zoneList.map((z) => {
        const a = toFt({ x: z.x0, y: z.y0 }), c = toFt({ x: z.x1, y: z.y1 });
        return { x0: a.x, y0: a.y, x1: c.x, y1: c.y };
      }),
    };
  }, [region, pxPerFt, fans, useBoundingRect, zoneList]);

  // --- step one: how should the space be cut up? ----------------------------
  // Only the three settings that genuinely shape a decomposition are in this
  // dependency list, so moving an unrelated slider does not re-enumerate and
  // cannot invalidate a choice that is still perfectly valid.
  const chunkOpt = useMemo(
    () => ({ targetArea: opt.targetArea, minChunk: opt.minChunk,
             minChunkArea: opt.minChunkArea, fanClearance: opt.fanClearance }),
    [opt.targetArea, opt.minChunk, opt.minChunkArea, opt.fanClearance]);

  const chunking = useMemo(
    () => (geo ? enumerateChunkings(geo.polygonFt, geo.zonesFt, chunkOpt, geo.fixturesFt) : null),
    [geo, chunkOpt]);

  // A remembered intent, resolved afresh each time. Change the space enough
  // that the chosen reading no longer exists and we ask again, rather than
  // quietly substituting a different one under the same name.
  const chosenId = useMemo(() => {
    if (!chunking?.options.length) return null;
    if (!chunking.needsChoice) return chunking.recommendedId;  // one reading: nothing to decide
    return findChunking(chunking.options, chunkPick)?.id ?? null;
  }, [chunking, chunkPick]);

  // An image reaches the tracer with no scale yet; the tracer is where it gets
  // set, so `trace` covers both "measure this plan" and "draw the room on it".
  const step = !source ? 'upload'
    : !litOutline ? 'trace'
    : (chunking?.needsChoice && !chosenId) ? 'chunks'
    : 'plan';
  const showTrace = step === 'trace';
  const showPicker = step === 'chunks' && !zoneMode && !!geo;

  // --- step two: the layout, inside the chosen configuration ----------------
  const plan = useMemo(() => {
    if (!geo) return null;
    if (chunking?.needsChoice && !chosenId) return null;   // no lights until it is picked
    const { polygonFt, fixturesFt, zonesFt, polygonPx, origin, toPx } = geo;
    const res = planLights(polygonFt, fixturesFt, { ...opt, chunkStrategy: chosenId || 'auto' }, zonesFt);
    if (!res.ok) return { ...res, polygonPx };

    const rectToPx = (c) => ({ ...c, x0: c.x0 * pxPerFt + origin.x, x1: c.x1 * pxPerFt + origin.x,
                               y0: c.y0 * pxPerFt + origin.y, y1: c.y1 * pxPerFt + origin.y });
    return {
      ...res,
      polygonFt, polygonPx, origin, toPx,
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
      fansFt: fixturesFt,
    };
  }, [geo, chunking, chosenId, opt, pxPerFt]);


  // --- interactions ---------------------------------------------------------
  const svgPoint = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * source.w, y: ((e.clientY - r.top) / r.height) * source.h };
  };

  const fanRadiusPx = () => {
    const sweep = REFERENCES.find((r) => r.id === fanSweep)?.ft ?? 3.94;
    return ((pxPerFt || 20) * sweep) / 2;
  };

  const onCanvasClick = (e) => {
    if (zoneMode || !source) return;
    // Placing a fan: a DXF has no red circle to find, so the fans are put where
    // you click. The sweep comes from the same standard-size list the raster
    // route uses as a ruler.
    if (fanMode) {
      const p = svgPoint(e);
      setFans((fs) => [...fs, { id: Date.now() + Math.random(), x: p.x, y: p.y, r: fanRadiusPx() }]);
      return;
    }
    if (scaleMode !== 'ref' || isVector) return;
    const p = svgPoint(e);
    setMeasure((m) => (!m.a || m.b ? { a: p, b: null } : { ...m, b: p }));
  };

  // no-light zones are drawn by dragging a rectangle on the plan
  const onZoneDown = (e) => {
    if (!zoneMode || !source) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = svgPoint(e);
    setDraftZone({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const onZoneMove = (e) => {
    if (!zoneMode || !draftZone) return;
    const p = svgPoint(e);
    setDraftZone((d) => (d ? { ...d, x1: p.x, y1: p.y } : d));
  };
  const onZoneUp = () => {
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

  const roomStats = useMemo(
    () => (litOutline && pxPerFt ? outlineStats(litOutline, pxPerFt) : null),
    [litOutline, pxPerFt]);

  /**
   * The layout, in the one number a lighting drawing is actually judged on.
   *
   * Counting fittings says nothing on its own — twelve lights in a 400 sqft
   * hall and twelve in a 90 sqft bedroom are different jobs. Lumens per square
   * foot is the figure that travels: 15-20 reads as comfortable ambient light
   * for a living space, 25+ as bright. What one fitting puts out is in
   * settings.js.
   */
  const light = useMemo(() => {
    if (!plan?.ok) return null;
    const total = plan.stats.large * FITTING_LUMENS.large + plan.stats.small * FITTING_LUMENS.small;
    return { total, perSqft: total / Math.max(1, plan.stats.areaSqft) };
  }, [plan]);

  /** One line, only when something actually went wrong. */
  const trouble = useMemo(() => {
    if (!plan?.ok) return '';
    const s = plan.stats;
    if (s.unserved > 0) return `${s.unserved} cell${s.unserved > 1 ? 's have' : ' has'} no light at all — that should not happen.`;
    if (s.clashes > 0) return `${s.clashes} light${s.clashes > 1 ? 's sit' : ' sits'} inside a fan's clearance or a no-light zone, because the cell has nowhere else to go.`;
    if (s.ceded > 0) return `${s.ceded} cell${s.ceded > 1 ? 's are' : ' is'} left to the fan — no light fits clear of the blades.`;
    if (s.outsideBand > 0) return `${s.outsideBand} light${s.outsideBand > 1 ? 's sit' : ' sits'} off its cell centre.`;
    return '';
  }, [plan]);
  const base = source ? source.name.replace(/\.[^.]+$/, '') : 'plan';
  const roomTag = litOutline?.name ? litOutline.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') : '';
  const exportBase = roomTag ? `${base}-${roomTag}` : base;


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
            onConfirm={(id) => { setSelectedOutlineId(id); setLitOutlineId(id); setChunkPick(null); }}
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
            options={chunking.options}
            recommendedId={chunking.recommendedId}
            initialId={chunkPick}
            onConfirm={setChunkPick}
            src={isVector ? null : source.src}
            vector={isVector ? source.render : null}
            wallLayers={null}
            imgW={source.w} imgH={source.h}
            polygonPx={geo.polygonPx} zonesPx={zoneList} fansPx={fans} toPx={geo.toPx} />
        ) : (
          <div className="canvas-wrap">
            <PlanCanvas ref={svgRef}
              src={isVector ? null : source.src}
              vector={isVector ? source.render : null}
              wallLayers={null}
              width={source.w} height={source.h}
              plan={plan} fansPx={fans} pxPerFt={pxPerFt} layers={layers} zoom={zoom}
              measure={measure} onCanvasClick={onCanvasClick}
              cursor={fanMode ? 'crosshair' : null}
              zones={zoneList} draftZone={draftZone} zoneMode={zoneMode}
              onZoneDown={onZoneDown} onZoneMove={onZoneMove} onZoneUp={onZoneUp} />
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
              setImg(null); setDxf(null); setFans([]); setChunkPick(null);
              setOutlines([]); setSelectedOutlineId(null); setLitOutlineId(null); setUnitId(null);
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
          {/* --- the rooms traced on this plan ----------------------------- */}
          <div className="sec">
            <h3>Room</h3>
            {outlinesPx.length > 0 && (
              <select value={litOutlineId || ''}
                onChange={(e) => { setLitOutlineId(e.target.value); setSelectedOutlineId(e.target.value); setChunkPick(null); }}>
                {outlinesPx.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
            {roomStats && <div style={{ marginTop: 8 }}>
              <div className="kv"><span>Size</span>
                <b>{ftin(roomStats.widthFt)} × {ftin(roomStats.heightFt)}</b></div>
              <div className="kv"><span>Area</span><b>{Math.round(roomStats.areaSqft)} sq ft</b></div>
              <div className="kv"><span>Corners</span><b>{roomStats.corners}</b></div>
              <div className="kv"><span>Lights</span><b>{plan?.ok ? plan.lights.length : '—'}</b></div>
            </div>}
            <button className="btn" style={{ marginTop: 8, width: '100%' }}
              onClick={() => { setLitOutlineId(null); setChunkPick(null); }}>
              Trace another room
            </button>
            {region?.warning && <p className="note warn">{region.warning}</p>}
          </div>

          {/* --- fans: an input, not a setting ---------------------------- */}
          {isVector && (
            <div className="sec">
              <h3>Ceiling fans</h3>
              <div className="btnrow">
                <button className={'btn' + (fanMode ? ' accent' : '')}
                  onClick={() => { setFanMode((v) => !v); setZoneMode(false); }}>
                  {fanMode ? 'Done placing' : 'Place fans'}
                </button>
                {fans.length > 0 && <button className="btn" onClick={() => setFans([])}>Clear all</button>}
              </div>
              <select value={fanSweep} onChange={(e) => setFanSweep(e.target.value)} style={{ marginTop: 8 }}>
                {REFERENCES.filter((r) => r.group === 'Fan').map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
              <div className="kv" style={{ marginTop: 8 }}><span>In this room</span>
                <b>{geo?.fansInRoom?.length ?? 0} of {fans.length}</b></div>
            </div>
          )}

          {!isVector && fans.length > 0 && (
            <div className="sec">
              <h3>Ceiling fans</h3>
              <div className="kv"><span>Found on the plan</span><b>{fans.length}</b></div>
              <div className="kv"><span>In this room</span><b>{geo?.fansInRoom?.length ?? 0}</b></div>
            </div>
          )}

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
                  ? `${detectState.count} on the plan, ${detectedZones.length} here`
                  : '—'}</b></div>
            <div className="kv"><span>Detector</span>
              <select value={provider} onChange={(e) => setProvider(e.target.value)}
                style={{ width: 'auto', padding: '2px 4px', fontSize: 11 }}>
                {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select></div>
            <button className="btn" style={{ marginTop: 6 }} disabled={!!busy}
              onClick={() => setDetectNonce((n) => n + 1)}>Look again</button>
          </div>

          {/* --- chunking: one button ------------------------------------- */}
          {/* Shown whenever there is a choice to make, including while it is
              still outstanding — drawing a zone holds the picker off the screen,
              and without this the panel simply ended and nothing said why. */}
          {chunking?.needsChoice && (
            <div className="sec">
              <h3>Chunking</h3>
              <button className="btn" style={{ width: '100%' }}
                onClick={() => { setChunkPick(null); setZoneMode(false); }}>
                {step === 'chunks' ? 'Pick a chunking' : 'Change chunking'}
              </button>
            </div>
          )}

          {step !== 'chunks' && step !== 'trace' && <>
          <div className="sec">
            <h3>View</h3>
            <div className="btnrow" style={{ marginBottom: 6 }}>
              <button className="btn" onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)))}>−</button>
              <button className="btn" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
              <button className="btn" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}>+</button>
            </div>
            {[['plan', 'Floor plan'], ['dim', 'Fade the plan'], ['region', 'Room outline'], ['grid', 'Grid lines'],
              ['cells', 'Cell shading'], ['lights', 'Lights'], ['labels', 'Light tags'], ['fan', 'Fan'],
              ['zones', 'No-light zones']].map(([k, l]) => (
              <label className="check" key={k}><input type="checkbox" checked={layers[k]} onChange={toggle(k)} />{l}</label>
            ))}
          </div>

          {plan?.ok && (
            <div className="sec">
              <h3>Result</h3>
              <div className="stats">
                <div className="stat"><b>{plan.lights.length}</b><span>lights</span></div>
                <div className="stat"><b>{light?.perSqft.toFixed(0)}</b><span>lm / sq ft</span></div>
              </div>
              {trouble && <p className="note warn">{trouble}</p>}
            </div>
          )}
          {plan && !plan.ok && <div className="sec"><p className="note warn">{plan.reason}</p></div>}

          <div className="sec">
            <h3>Export</h3>
            <div className="btnrow">
              <button className="btn" disabled={!plan?.ok} onClick={() => download(`${exportBase}-lights.dxf`, toDXF(plan, plan.fansFt), 'application/dxf')}>DXF</button>
              <button className="btn" disabled={!plan?.ok} onClick={() => download(`${exportBase}-lights.csv`, toCSV(plan), 'text/csv')}>CSV</button>
              <button className="btn" disabled={!plan?.ok} onClick={() => download(`${exportBase}-lights.json`, toJSON(plan, { pxPerFt, mode: isVector ? 'dxf' : scaleMode, units: isVector ? source.unitLabel : null, room: litOutline ? { id: litOutline.id, name: litOutline.name, outline: 'traced', rightAngles: litOutline.rectify } : null }), 'application/json')}>JSON</button>
              <button className="btn" disabled={!source} onClick={() => download(`${exportBase}-lights.svg`, svgString(svgRef.current), 'image/svg+xml')}>SVG</button>
              <button className="btn" disabled={!source} onClick={async () => download(`${exportBase}-lights.png`, await svgToPNG(svgRef.current, source.w))}>PNG</button>
            </div>
          </div>
          </>}
        </>}
      </div>
    </div>
  );
}

