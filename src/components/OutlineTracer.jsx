import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Path, Line, Circle, Rect, RegularPolygon, Text, Group,
         Image as KImage } from 'react-konva';
import { buildSnapIndex, snapAt } from '../lib/snap.js';
import { outlineStats, validateOutline } from '../lib/outline.js';
import { REFERENCES, describeScale } from '../lib/scale.js';

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
const FILL = ['#6366F1', '#0EA5E9', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6', '#14B8A6', '#DC2626'];
const DRAFT = '#16A34A';
const SNAPCOL = '#DC2626';
const GUIDE = '#B45309';

// Outlines already traced are line work too — the only line work an image has.
// They go into the snap index under their own layer name so the show/snap panel
// can switch them off like any other.
const TRACED_LAYER = 'outlines traced';

// Grid increments offered, in inches. Coarser than three inches and a grid
// stops being a nicety and starts moving walls.
const GRIDS = [[0, 'off'], [3, '3″'], [6, '6″'], [12, '1′']];

const ftin = (v) => {
  const f = Math.floor(v), i = Math.round((v - f) * 12);
  return i === 12 ? `${f + 1}'0"` : `${f}'${i}"`;
};
const flat = (pts) => pts.flatMap((p) => [p.x, p.y]);

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
  detectState = null, onRedetect = null,
  unitId, unitCandidates, onUnitChange,
  scale: scaleUI, fans = [],
}) {
  const wrapRef = useRef(null);
  const stageRef = useRef(null);
  const { w: SW, h: SH } = useSize(wrapRef);

  const isRaster = source.kind === 'raster';
  const hasScale = pxPerFt > 0;

  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [draft, setDraft] = useState([]);
  const [snap, setSnap] = useState(null);
  const [orthoLock, setOrthoLock] = useState(true);
  const [alignOn, setAlignOn] = useState(true);
  const [gridIn, setGridIn] = useState(0);
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

  const ortho = orthoLock && !shift;
  const panMode = space;
  const tracing = draft.length > 0;
  // On an image, clicking the plan sets the measuring line rather than a corner.
  const measuring = isRaster && scaleUI?.mode === 'ref' && !panMode && !measureDone;
  const canTrace = hasScale && !measuring;

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

  // The grid is anchored on the FIRST CORNER PLACED, not on the plan's origin.
  // Anchored to the plan it rounds coordinates, which is meaningless; anchored
  // to the first corner it rounds DIMENSIONS, so the room comes out 12'6" and
  // not 12'5.8". Which means there is no grid for the first corner — nothing to
  // anchor it to yet, and no dimension to round.
  const gridPx = gridIn > 0 && hasScale && draft.length ? (gridIn / 12) * pxPerFt : 0;
  const gridOrigin = draft[0] || null;

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
      gridPx,
      gridOrigin,
    });
    setSnap(s);
    return s;
  };

  const onMouseMove = () => { if (!panMode && !drag) recomputeSnap(); };

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
    if (panMode || e.evt.button !== 0) return;
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
  useEffect(() => {
    const down = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Shift') setShift(true);
      if (e.code === 'Space') { setSpace(true); e.preventDefault(); }
      if (e.key === 'Escape') { setDraft([]); setProblem(''); }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        setDraft((d) => d.slice(0, -1));
        setProblem('');
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
  }, [finish, fit]);

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

  const headline = measuring ? 'Measure the plan'
    : !hasScale ? 'Set the scale first'
    : tracing ? 'Tracing…'
    : outlines.length ? `${outlines.length} outline${outlines.length > 1 ? 's' : ''}`
    : 'Trace the room';

  return (
    <div className="picker tracer">
      <div className="picker-head">
        <h2>{headline}</h2>
        <p>
          {measuring
            ? <>Click the two ends of something you can name, then say what it is.</>
            : !hasScale
              ? <>Set the scale on the right first — an image does not say how big it is.</>
              : outlines.length
                ? <>Drag a corner to move it — free angle, snapping to walls and
                    to the other corners. <b>Shift</b> holds it square.
                    Click an edge's diamond to add a corner, right-click one to
                    remove it.</>
                : <>Click the corners. <b>Shift</b> releases the right-angle lock,
                  <b> Backspace</b> undoes one, <b>Enter</b> closes.</>}
        </p>
      </div>

      <div className="rooms-layout">
        <div className="rooms-plan tracer-plan" ref={wrapRef}
          style={{ cursor: panMode ? 'grab' : canTrace || measuring ? 'crosshair' : 'not-allowed' }}>
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
            <Layer listening={false}>
              {isRaster
                ? source.el && <KImage image={source.el} width={source.w} height={source.h} />
                : <>
                    {source.render.filter((l) => visible.has(l.layer)).map((l) => (
                      <Path key={l.layer} data={l.path} stroke="#4B5563"
                        strokeWidth={1} strokeScaleEnabled={false} opacity={0.75} />
                    ))}
                    {source.circlesPx.filter((c) => visible.has(c.layer)).map((c, i) => (
                      <Circle key={'c' + i} x={c.cx} y={c.cy} radius={c.r} stroke="#4B5563"
                        strokeWidth={1} strokeScaleEnabled={false} opacity={0.6} />
                    ))}
                  </>}
              {/* Fan markers found on the image — the ruler, when the scale
                  comes off a fan, so it has to be visible while measuring. */}
              {isRaster && fans.map((f, i) => (
                <Circle key={'f' + i} x={f.x} y={f.y} radius={f.r} stroke="#DC2626"
                  strokeWidth={1.4} strokeScaleEnabled={false} dash={[5, 4]} opacity={0.85} />
              ))}
            </Layer>

            {/* the outlines: traced by hand, or proposed by the detector */}
            <Layer listening={!tracing}>
              {stats.map(({ o, st }, i) => {
                const col = FILL[i % FILL.length];
                const on = o.id === selectedId;
                // A proposal is drawn DASHED until it has been touched or
                // confirmed. The distinction is worth a stroke style: a solid
                // line is a boundary someone has agreed to, and lighting a plan
                // off four polygons nobody has looked at is exactly the failure
                // the old green-marker route used to produce.
                const provisional = o.detected && !o.reviewed;
                return (
                  <Group key={o.id} onClick={() => onSelect(o.id)} onTap={() => onSelect(o.id)}>
                    {st.rectified && st.movedFt > 0.08 && (
                      <Line points={flat(st.rawPx)} closed stroke={col} dash={[4, 4]}
                        strokeWidth={1} strokeScaleEnabled={false} opacity={0.5} />
                    )}
                    <Line points={flat(st.polygonPx)} closed
                      fill={col} opacity={on ? 0.26 : 0.1}
                      stroke={col} strokeWidth={on ? 2.6 : 1.6}
                      dash={provisional ? [10, 6] : null}
                      strokeScaleEnabled={false} lineJoin="round" />
                    <Text x={st.centroid.x} y={st.centroid.y}
                      text={`${o.name || 'Room'}${provisional ? ' ·  found' : ''}\n${ftin(st.widthFt)} × ${ftin(st.heightFt)} · ${Math.round(st.areaSqft)} sqft`}
                      fontSize={px(11)} fontFamily="JetBrains Mono, monospace"
                      fill={col} align="center" lineHeight={1.35}
                      offsetX={px(60)} offsetY={px(14)} width={px(120)}
                      listening={false} />
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
            {showGrips && !tracing && hasScale && (
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
                    stroke="#0EA5E9" strokeWidth={2} strokeScaleEnabled={false}
                    dash={scaleUI.measure.b ? null : [6, 4]} />
                  {[scaleUI.measure.a, scaleUI.measure.b].filter(Boolean).map((p, i) => (
                    <Line key={'t' + i} points={[p.x, p.y - px(7), p.x, p.y + px(7)]}
                      stroke="#0EA5E9" strokeWidth={2} strokeScaleEnabled={false} />
                  ))}
                </Group>
              )}

              {snap && <SnapGlyph snap={snap} px={px} />}

              {draftFt != null && snap && (
                <Text x={snap.x} y={snap.y} offsetX={px(-10)} offsetY={px(20)}
                  text={ftin(draftFt)} fontSize={px(11)}
                  fontFamily="JetBrains Mono, monospace" fill="#0A0A0A" />
              )}
            </Layer>
          </Stage>

          {/* Only what changes as you work. The keyboard reference that used to
              live here — scroll to zoom, space to pan, F to fit — was static text
              taking up a third of the bar. */}
          <div className="tracer-hud">
            {!ortho && <span className="chip">free angle</span>}
            {gridIn > 0 && <span className="chip on">{gridIn === 12 ? '1′' : `${gridIn}″`} grid</span>}
            {drag && <span className="chip on">{shift ? 'nudging · square' : 'nudging · free'}</span>}
            {(drag?.snap || (!drag && snap)) && (
              <span className="chip snap">{(drag?.snap || snap).label}</span>
            )}
          </div>
        </div>

        <div className="rooms-side">
          {/* --- the scale, on an image ------------------------------------ */}
          {isRaster && scaleUI && (
            <div className="sec">
              <h3>Scale{hasScale ? '' : ' — needed first'}</h3>
              <div className="seg">
                {[['fan', 'From fan'], ['ref', 'Measure'], ['manual', 'Manual']].map(([k, l]) => (
                  <button key={k} className={scaleUI.mode === k ? 'on' : ''}
                    onClick={() => scaleUI.setMode(k)}>{l}</button>
                ))}
              </div>

              {scaleUI.mode === 'fan' && (<>
                <select value={scaleUI.fanSweep} onChange={(e) => scaleUI.setFanSweep(e.target.value)}>
                  {REFERENCES.filter((r) => r.group === 'Fan').map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
                {fans.length
                  ? fans.map((f, i) => (
                      <div className="kv" key={i} style={i === 0 ? { marginTop: 8 } : undefined}>
                        <span>Fan {i + 1} sweep</span><b>{(f.r * 2).toFixed(0)} px</b></div>
                    ))
                  : <p className="note warn">{scaleUI.fanReason || 'No red fan marker found.'}
                      {' '}Measure something instead, or type the scale in.</p>}
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
                  <div className="row" style={{ marginTop: 8 }}>
                    <label>Real length (ft)</label>
                    <input type="number" step="0.05" value={scaleUI.customFt} style={{ maxWidth: 90 }}
                      onChange={(e) => scaleUI.setCustomFt(parseFloat(e.target.value) || 0)} />
                  </div>
                )}
                <div className="kv" style={{ marginTop: 8 }}>
                  <span>{!scaleUI.measure.a ? 'Click the first end'
                    : !scaleUI.measure.b ? 'Click the other end' : 'Measured'}</span>
                  <b>{measureLen ? `${measureLen.toFixed(0)} px` : '—'}</b>
                </div>
                {scaleUI.measure.a && scaleUI.measure.b && !measureDone && (
                  <button className="btn primary" style={{ marginTop: 8, width: '100%' }}
                    onClick={() => setMeasureDone(true)}>
                    Use this measurement →
                  </button>
                )}
                {scaleUI.measure.a && (
                  <button className="btn" style={{ marginTop: 6 }}
                    onClick={() => { scaleUI.setMeasure({ a: null, b: null }); setMeasureDone(false); }}>
                    Measure again</button>
                )}
              </>)}

              {scaleUI.mode === 'manual' && (
                <div className="row"><label>Pixels per foot</label>
                  <input type="number" step="0.01" value={scaleUI.manualPx} style={{ maxWidth: 100 }}
                    onChange={(e) => scaleUI.setManualPx(parseFloat(e.target.value) || 0)} />
                </div>
              )}

              <div className="kv" style={{ marginTop: 10 }}>
                <span>Scale</span><b>{hasScale ? describeScale(pxPerFt) : 'not set'}</b></div>
              {hasScale && (
                <div className="kv"><span>Plan measures</span>
                  <b>{ftin(widthFt)} × {ftin(heightFt)}</b></div>
              )}
              {hasScale && <p className="note">Does that overall size look right?</p>}
            </div>
          )}

          {/* --- what the detector proposed -------------------------------- */}
          {detectState && (
            <div className="sec">
              <h3>Rooms on the plan</h3>
              {detectState.status === 'running' && (
                <p className="note">Reading the plan for rooms…</p>
              )}
              {detectState.status === 'error' && (
                <p className="note warn">The room detector is not answering
                  ({detectState.error}). Trace by hand — everything below still works.</p>
              )}
              {detectState.status === 'done' && (
                detectState.proposed > 0 ? (<>
                  <div className="kv"><span>Proposed</span><b>{detectState.proposed}</b></div>
                  {detectState.dropped > 0 && (
                    <div className="kv"><span>Discarded</span><b>{detectState.dropped}</b></div>
                  )}
                  <p className="note">Drag any corner to put it on the wall. The
                    grip snaps like the cursor does. A dashed outline is one
                    nobody has looked at yet.</p>
                </>) : detectState.returned > 0 ? (
                  <p className="note">Nothing new — the {detectState.returned} room
                    {detectState.returned > 1 ? 's' : ''} it found {detectState.returned > 1 ? 'are' : 'is'}
                    {' '}already on the plan.</p>
                ) : (
                  <p className="note warn">No rooms found on this plan. Trace them
                    by hand — click the corners.</p>
                )
              )}
              <label className="check">
                <input type="checkbox" checked={showGrips}
                  onChange={(e) => setShowGrips(e.target.checked)} />
                Show corner grips
              </label>
              {onRedetect && (
                <button className="btn" style={{ marginTop: 6, width: '100%' }}
                  disabled={detectState.status === 'running'}
                  onClick={onRedetect}>Look again</button>
              )}
            </div>
          )}

          {/* --- tracing --------------------------------------------------- */}
          <div className="sec">
            <h3>{tracing ? `Tracing — ${draft.length} corner${draft.length > 1 ? 's' : ''}` : 'Trace'}</h3>
            {tracing ? (
              <>
                <div className="btnrow">
                  <button className="btn" onClick={() => setDraft((d) => d.slice(0, -1))}>Undo corner</button>
                  <button className="btn" onClick={() => { setDraft([]); setProblem(''); }}>Start over</button>
                </div>
                <button className="btn primary" style={{ marginTop: 8, width: '100%' }}
                  disabled={draft.length < 3} onClick={finish}>
                  Close the outline
                </button>
              </>
            ) : !hasScale ? (
              <p className="note warn">Set the scale above first.</p>
            ) : measuring ? (
              <p className="note">{scaleUI?.measure?.b
                ? <>Press <b>Use this measurement</b> to go back to tracing.</>
                : <>Click the two ends of your reference on the plan.</>}</p>
            ) : (
              <p className="note">Trace the <b>inner face</b> of the walls.</p>
            )}
            {problem && <p className="note warn">{problem}</p>}
          </div>

          {/* --- snapping -------------------------------------------------- */}
          <div className="sec">
            <h3>Snapping</h3>
            <label className="check">
              <input type="checkbox" checked={orthoLock}
                onChange={(e) => setOrthoLock(e.target.checked)} />
              Lock to right angles
            </label>
            <label className="check">
              <input type="checkbox" checked={alignOn}
                onChange={(e) => setAlignOn(e.target.checked)} />
              Line up with corners already placed
            </label>
            <div className="row" style={{ marginTop: 8 }}>
              <label>Grid</label>
              <select value={gridIn} onChange={(e) => setGridIn(parseInt(e.target.value, 10))}
                disabled={!hasScale} style={{ maxWidth: 90 }}>
                {GRIDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <p className="note">The grid is measured from the first corner you place,
              so it rounds the room's dimensions rather than its position.</p>
          </div>

          {/* --- the file, on a DXF ---------------------------------------- */}
          {!isRaster && (
            <div className="sec">
              <h3>The file</h3>
              <div className="kv"><span>Scale</span><b>exact, from the file</b></div>
              <div className="kv"><span>Drawn in</span>
                <b>
                  <select value={unitId} onChange={(e) => onUnitChange(e.target.value)}
                    style={{ width: 'auto', padding: '2px 4px', fontSize: 11 }}>
                    {unitCandidates.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                  </select>
                </b>
              </div>
              <div className="kv"><span>Plan measures</span>
                <b>{ftin(widthFt)} × {ftin(heightFt)}</b></div>
              {(source.unitSource === 'inferred' || source.unitSource === 'overridden') && (
                <p className="note warn">
                  {source.unitSource === 'inferred'
                    ? 'The file did not say what it was drawn in — check the size above.'
                    : 'The file claims other units; at that scale this plan would be an implausible size.'}
                </p>
              )}
            </div>
          )}

          {/* --- layers, on a DXF ------------------------------------------ */}
          {!isRaster && (
            <div className="sec">
              <h3>Show &amp; snap to</h3>
              <div className="layer-list">
                {source.render.map((l) => (
                  <label key={l.layer} className={'layer-row' + (visible.has(l.layer) ? ' on' : '')}>
                    <input type="checkbox" checked={visible.has(l.layer)}
                      onChange={() => setVisible((v) => {
                        const n = new Set(v);
                        if (n.has(l.layer)) n.delete(l.layer); else n.add(l.layer);
                        return n;
                      })} />
                    <span className="layer-name" title={l.layer}>{l.layer}</span>
                    <span className="layer-count">{l.count}</span>
                  </label>
                ))}
                {tracedSegs.length > 0 && (
                  <label className={'layer-row' + (visible.has(TRACED_LAYER) ? ' on' : '')}>
                    <input type="checkbox" checked={visible.has(TRACED_LAYER)}
                      onChange={() => setVisible((v) => {
                        const n = new Set(v);
                        if (n.has(TRACED_LAYER)) n.delete(TRACED_LAYER); else n.add(TRACED_LAYER);
                        return n;
                      })} />
                    <span className="layer-name">{TRACED_LAYER}</span>
                    <span className="layer-count">{tracedSegs.length}</span>
                  </label>
                )}
              </div>
              <p className="note">Hiding a layer stops the cursor snapping to it.</p>
            </div>
          )}

          {/* --- snap to outlines already traced, on an image -------------- */}
          {isRaster && tracedSegs.length > 0 && (
            <div className="sec">
              <h3>Snap to</h3>
              <label className={'check' + (visible.has(TRACED_LAYER) ? ' on' : '')}>
                <input type="checkbox" checked={visible.has(TRACED_LAYER)}
                  onChange={() => setVisible((v) => {
                    const n = new Set(v);
                    if (n.has(TRACED_LAYER)) n.delete(TRACED_LAYER); else n.add(TRACED_LAYER);
                    return n;
                  })} />
                Outlines already traced ({tracedSegs.length} edges)
              </label>

            </div>
          )}

          {stats.length > 0 && (
            <div className="sec">
              <h3>Outlines</h3>
              {stats.map(({ o, st }, i) => (
                <div key={o.id} className={'outline-row' + (o.id === selectedId ? ' on' : '')}>
                  <button className="outline-pick" onClick={() => onSelect(o.id)}
                    onDoubleClick={() => onConfirm(o.id)}>
                    <span className="room-dot" style={{ background: FILL[i % FILL.length] }} />
                    {renaming === o.id ? (
                      <input autoFocus defaultValue={o.name || ''}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => { onUpdateOutline(o.id, { name: e.target.value.trim() || o.name }); setRenaming(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setRenaming(null); }}
                        style={{ fontSize: 11, padding: '1px 4px' }} />
                    ) : (
                      <span className="outline-name" onDoubleClick={(e) => { e.stopPropagation(); setRenaming(o.id); }}>
                        {o.name || `Room ${i + 1}`}
                      </span>
                    )}
                    <span className="layer-count">
                      {o.detected && !o.reviewed ? 'found · ' : ''}{Math.round(st.areaSqft)} sqft
                    </span>
                  </button>
                  <div className="outline-meta">
                    <span>{ftin(st.widthFt)} × {ftin(st.heightFt)} · {st.corners} cnr</span>
                    <span>
                      <label className="mini" title="Force right angles on this outline">
                        <input type="checkbox" checked={o.rectify}
                          onChange={(e) => onUpdateOutline(o.id, { rectify: e.target.checked })} />
                        square
                      </label>
                      <button className="btn tiny" title="Rename"
                        onClick={() => setRenaming(o.id)}>✎</button>
                      <button className="btn tiny" title="Delete this outline"
                        onClick={() => onDeleteOutline(o.id)}>×</button>
                    </span>
                  </div>
                  {o.enclosingPx?.length > 0 && (
                    <p className="note warn" style={{ margin: '2px 0 0' }}>
                      {o.enclosingPx.length} room{o.enclosingPx.length > 1 ? 's sit' : ' sits'} wholly
                      inside this one, so it cannot be subtracted — the inner
                      {o.enclosingPx.length > 1 ? ' rooms are' : ' room is'} held out of this
                      ceiling instead. Drag a corner of the inner room out to a wall and it
                      will be subtracted properly.
                    </p>
                  )}
                  {o.note && !o.enclosingPx?.length && (
                    <p className="note" style={{ margin: '2px 0 0' }}>{o.note}</p>
                  )}
                  {o.rectify && st.movedFt > 0.08 && (
                    <p className="note" style={{ margin: '2px 0 0' }}>
                      Squaring moved a corner {(st.movedFt * 12).toFixed(0)}″ — the dashed
                      line on the plan is what you clicked.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="picker-foot">
        <div className="picker-foot-txt">
          {measuring
            ? <>{scaleUI?.measure?.b
                  ? <>Measured {Math.round(measureLen)} px — that makes it
                      {' '}{describeScale(pxPerFt)}. Check the reference in the panel is
                      right, then take it.</>
                  : scaleUI?.measure?.a
                    ? <>Now click the other end.</>
                    : <>Click one end of something you can name on the plan.</>}</>
            : !hasScale
            ? <>The scale is not set, so nothing can be traced yet.</>
            : tracing
              ? <>{draft.length} corner{draft.length > 1 ? 's' : ''} down.
                  {draft.length >= 3 ? ' Close it to keep it.' : ' Keep clicking.'}</>
              : drag
                ? <>Nudging a corner. {drag.snap ? <>Holding on to <b>{drag.snap.label}</b>.</> : <>Nothing under it.</>}</>
                : chosen
                  ? <><b>{chosen.o.name || 'Room'}</b> — {ftin(chosen.st.widthFt)} × {ftin(chosen.st.heightFt)},
                      {' '}{Math.round(chosen.st.areaSqft)} sq ft, {chosen.st.corners} corners.
                      {' '}Drag a corner to move it, right-click one to delete it.</>
                  : outlines.length
                    ? <>{outlines.length} outline{outlines.length > 1 ? 's' : ''} on the plan.
                        Nudge the corners, then light the lot.</>
                    : <>Nothing traced yet. Click a corner on the plan to start.</>}
        </div>
        {measuring ? (
          <button className="btn primary" disabled={!scaleUI?.measure?.b}
            onClick={() => setMeasureDone(true)}>
            Use this measurement →
          </button>
        ) : (
          /* THE WHOLE PLAN IS THE PRIMARY ACT. A floor plan is a floor plan —
             the rooms come as a set, the detector proposes the set, and lighting
             them one at a time was an artefact of there having been only ever
             one outline to light. Lighting a single room stays available because
             a single room is genuinely sometimes the job. */
          <div className="btnrow">
            {chosen && outlines.length > 1 && (
              <button className="btn" disabled={tracing}
                onClick={() => onConfirm(chosen.o.id)}>
                Just this room
              </button>
            )}
            <button className="btn primary" disabled={!outlines.length || tracing}
              onClick={() => (outlines.length > 1 || !chosen
                ? onProceed?.()
                : onConfirm(chosen.o.id))}>
              {!outlines.length ? 'Trace an outline'
                : outlines.length === 1 ? 'Light this room →'
                : `Light all ${outlines.length} rooms →`}
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
