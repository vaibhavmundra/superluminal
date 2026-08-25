import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PlanCanvas from './components/PlanCanvas.jsx';
import ChunkPicker from './components/ChunkPicker.jsx';
import { imageToPixels, detectRegion, detectFans } from './lib/detect.js';
import { planLights, DEFAULTS } from './lib/planner.js';
import { enumerateChunkings, findChunking } from './lib/chunking.js';
import { bbox } from './lib/geometry.js';
import { REFERENCES, scaleFromFans, scaleFromReference, describeScale, estimateScaleWithAI } from './lib/scale.js';
import { download, toJSON, toCSV, toDXF, svgString, svgToPNG } from './lib/exporters.js';

const LS = 'lightPlanner.v1';

export default function App() {
  const [img, setImg] = useState(null);          // {src, el, w, h, base64, mime, name}
  const [busy, setBusy] = useState('');
  const [tuning, setTuning] = useState({ sat: 0.22, val: 0.15, seal: 3, redSat: 0.30, link: 8 });
  const [region, setRegion] = useState(null);
  const [fans, setFans] = useState([]);
  const [fanReason, setFanReason] = useState('');
  const [useBoundingRect, setUseBoundingRect] = useState(false);

  const [zones, setZones] = useState([]);        // no-light rects in image px {id,x0,y0,x1,y1}
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

  const [opt, setOpt] = useState({ ...DEFAULTS });
  const [layers, setLayers] = useState({ plan: true, dim: true, region: true, grid: true, cells: true, lights: true, labels: false, fan: true, zones: true });
  const [zoom, setZoom] = useState(1);
  const [apiKey, setApiKey] = useState('');
  const [aiResult, setAiResult] = useState(null);
  const [over, setOver] = useState(false);
  const svgRef = useRef(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS) || '{}');
      if (saved.opt) setOpt((o) => ({ ...o, ...saved.opt }));
      if (saved.apiKey) setApiKey(saved.apiKey);
      if (saved.fanSweep) setFanSweep(saved.fanSweep);
    } catch { /* first run */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(LS, JSON.stringify({ opt, apiKey, fanSweep })); } catch { /* private mode */ }
  }, [opt, apiKey, fanSweep]);

  // --- load -----------------------------------------------------------------
  const loadFile = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result;
      const el = new Image();
      el.onload = () => {
        setImg({ src, el, w: el.naturalWidth, h: el.naturalHeight, name: file.name,
                 base64: String(src).split(',')[1], mime: file.type });
        setMeasure({ a: null, b: null }); setAiResult(null); setZoom(1);
        setZones([]); setZoneMode(false); setDraftZone(null); setChunkPick(null);
      };
      el.src = src;
    };
    reader.readAsDataURL(file);
  }, []);

  // --- detect ---------------------------------------------------------------
  useEffect(() => {
    if (!img) return;
    let cancelled = false;
    setBusy('Reading annotations…');
    const t = setTimeout(() => {
      try {
        const pix = imageToPixels(img.el);
        const r = detectRegion(pix, { sat: tuning.sat, val: tuning.val, seal: tuning.seal });
        const f = detectFans(pix, { sat: tuning.redSat, link: tuning.link });
        if (cancelled) return;
        setRegion(r); setFans(f.ok ? f.fans : []); setFanReason(f.ok ? '' : f.reason);
      } finally { if (!cancelled) setBusy(''); }
    }, 30);
    return () => { cancelled = true; clearTimeout(t); };
  }, [img, tuning]);

  // --- scale ----------------------------------------------------------------
  const pxPerFt = useMemo(() => {
    if (scaleMode === 'manual') return manualPx > 0 ? manualPx : null;
    if (scaleMode === 'ref') {
      if (!measure.a || !measure.b) return null;
      const len = Math.hypot(measure.b.x - measure.a.x, measure.b.y - measure.a.y);
      const ref = REFERENCES.find((r) => r.id === refId);
      return scaleFromReference(len, ref?.ft ?? customFt);
    }
    const sweep = REFERENCES.find((r) => r.id === fanSweep)?.ft ?? 3.94;
    return fans.length ? scaleFromFans(fans, sweep) : null;
  }, [scaleMode, manualPx, measure, refId, customFt, fans, fanSweep]);

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
    return {
      polygonPx, origin, toFt, toPx,
      polygonFt: polygonPx.map(toFt),
      fixturesFt: fans.map((f) => ({ type: 'fan', ...toFt(f), r: f.r / pxPerFt })),
      zonesFt: zones.map((z) => {
        const a = toFt({ x: z.x0, y: z.y0 }), c = toFt({ x: z.x1, y: z.y1 });
        return { x0: a.x, y0: a.y, x1: c.x, y1: c.y };
      }),
    };
  }, [region, pxPerFt, fans, useBoundingRect, zones]);

  // --- step one: how should the space be cut up? ----------------------------
  // Only the three settings that genuinely shape a decomposition are in this
  // dependency list, so moving an unrelated slider does not re-enumerate and
  // cannot invalidate a choice that is still perfectly valid.
  const chunkOpt = useMemo(
    () => ({ targetCell: opt.targetCell, minChunk: opt.minChunk, fanClearance: opt.fanClearance }),
    [opt.targetCell, opt.minChunk, opt.fanClearance]);

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

  const step = !img ? 'upload'
    : (chunking?.needsChoice && !chosenId) ? 'chunks'
    : 'plan';
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
    return { x: ((e.clientX - r.left) / r.width) * img.w, y: ((e.clientY - r.top) / r.height) * img.h };
  };

  const onCanvasClick = (e) => {
    if (zoneMode || scaleMode !== 'ref' || !img) return;
    const p = svgPoint(e);
    setMeasure((m) => (!m.a || m.b ? { a: p, b: null } : { ...m, b: p }));
  };

  // no-light zones are drawn by dragging a rectangle on the plan
  const onZoneDown = (e) => {
    if (!zoneMode || !img) return;
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

  const runAI = async () => {
    if (!img) return;
    setBusy('Asking Claude for the scale…'); setAiResult(null);
    try {
      const r = await estimateScaleWithAI({ apiKey, imageBase64: img.base64, mediaType: img.mime, width: img.w, height: img.h });
      setAiResult(r);
      if (r.pxPerFoot > 0) { setManualPx(+r.pxPerFoot.toFixed(3)); setScaleMode('manual'); }
    } catch (err) { setAiResult({ error: String(err.message || err) }); }
    finally { setBusy(''); }
  };

  const set = (k) => (e) => setOpt((o) => ({ ...o, [k]: parseFloat(e.target.value) }));
  const toggle = (k) => () => setLayers((l) => ({ ...l, [k]: !l[k] }));
  const base = img ? img.name.replace(/\.[^.]+$/, '') : 'plan';

  const measureLen = measure.a && measure.b ? Math.hypot(measure.b.x - measure.a.x, measure.b.y - measure.a.y) : 0;

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">Light Planner <span>/ ambient layout</span></div>
        <div className={'pill ' + (region?.ok ? 'ok' : region ? 'bad' : '')}>
          {region?.ok ? `region · ${plan?.polygonFt?.length ?? region.polygon.length} corners` : region ? 'no region' : 'awaiting plan'}
        </div>
        <div className={'pill ' + (fans.length ? 'ok' : 'warn')} title={fanReason || ''}>
          {fans.length ? `${fans.length} fan${fans.length > 1 ? 's' : ''} found` : 'no fan marker'}</div>
        <div className={'pill ' + (pxPerFt ? 'ok' : 'bad')}>{pxPerFt ? describeScale(pxPerFt) : 'scale not set'}</div>
        {chunking && chunking.options.length > 1 && (
          <div className={'pill ' + (chosenId ? 'ok' : 'warn')}>
            {chosenId
              ? `chunks · ${plan?.chunking?.label ?? chosenId}`
              : `${chunking.options.length} ways to chunk — pick one`}
          </div>
        )}
        <div className="spacer" />
        {busy && <div className="pill">{busy}</div>}
      </div>

      <div className={'stage' + (img ? '' : ' empty') + (showPicker ? ' wide' : '')}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); loadFile(e.dataTransfer.files[0]); }}
      >
        {!img ? (
          <div className={'dropzone' + (over ? ' over' : '')}>
            <h2>Drop a marked-up floor plan</h2>
            <p>Draw a <b>solid green</b> box or polyline around the area you want lit, and a
               <b> red dotted circle</b> on the ceiling fan. Then drop the image here.</p>
            <label className="btn primary" style={{ display: 'inline-block' }}>
              Choose image
              <input type="file" accept="image/*" style={{ display: 'none' }}
                onChange={(e) => loadFile(e.target.files[0])} />
            </label>
            <div className="legend">
              <div><span className="swatch g" /> area of interest</div>
              <div><span className="swatch r" /> ceiling fan</div>
            </div>
          </div>
        ) : showPicker ? (
          <ChunkPicker
            options={chunking.options}
            recommendedId={chunking.recommendedId}
            initialId={chunkPick}
            onConfirm={setChunkPick}
            src={img.src} imgW={img.w} imgH={img.h}
            polygonPx={geo.polygonPx} zonesPx={zones} fansPx={fans} toPx={geo.toPx} />
        ) : (
          <div className="canvas-wrap">
            <PlanCanvas ref={svgRef} src={img.src} width={img.w} height={img.h}
              plan={plan} fansPx={fans} pxPerFt={pxPerFt} layers={layers} zoom={zoom}
              measure={measure} onCanvasClick={onCanvasClick}
              zones={zones} draftZone={draftZone} zoneMode={zoneMode}
              onZoneDown={onZoneDown} onZoneMove={onZoneMove} onZoneUp={onZoneUp} />
          </div>
        )}
      </div>

      <div className="side">
        <div className="sec">
          <h3>Plan</h3>
          <div className="btnrow">
            <label className="btn">Load image
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => loadFile(e.target.files[0])} />
            </label>
            {img && <button className="btn" onClick={() => { setImg(null); setRegion(null); setFans([]); setChunkPick(null); }}>Clear</button>}
          </div>
          {region && !region.ok && <p className="note warn">{region.reason}</p>}
          {region?.ok && region.warning && <p className="note warn">{region.warning}</p>}
        </div>

        {img && <>
          <div className="sec">
            <h3>Detection</h3>
            <Slider label="Green sensitivity" v={tuning.sat} min={0.08} max={0.6} step={0.01}
              onChange={(v) => setTuning((t) => ({ ...t, sat: v }))} fmt={(v) => v.toFixed(2)} invert />
            <Slider label="Seal gaps (min)" v={tuning.seal} min={0} max={30} step={1}
              onChange={(v) => setTuning((t) => ({ ...t, seal: v }))} fmt={(v) => `${v} px`} />
            <Slider label="Red sensitivity" v={tuning.redSat} min={0.1} max={0.7} step={0.01}
              onChange={(v) => setTuning((t) => ({ ...t, redSat: v }))} fmt={(v) => v.toFixed(2)} invert />
            <Slider label="Join fan dots" v={tuning.link} min={2} max={20} step={1}
              onChange={(v) => setTuning((t) => ({ ...t, link: v }))} fmt={(v) => `${v} px`} />
            <label className="check">
              <input type="checkbox" checked={useBoundingRect} onChange={(e) => setUseBoundingRect(e.target.checked)} />
              Simplify region to a rectangle
            </label>
          </div>

          <div className="sec">
            <h3>No-light zones</h3>
            <div className="btnrow">
              <button className={'btn' + (zoneMode ? ' accent' : '')} onClick={() => { setZoneMode((v) => !v); setDraftZone(null); }}>
                {zoneMode ? 'Done drawing' : 'Draw zone'}
              </button>
              {zones.length > 0 && <button className="btn" onClick={() => setZones([])}>Clear all</button>}
            </div>
            {zoneMode && (
              <div className="hint" style={{ marginTop: 10 }}>
                Drag a rectangle over anything that can't take a light — a beam, skylight,
                duct or AC unit. The zone is cut out of the space, as if the outline changed,
                and the rest re-chunks around it.
              </div>
            )}
            {!zoneMode && zones.length === 0 && (
              <p className="note">Mark rectangles where lights can't go. They're subtracted from
                the space; what remains is chunked into rectangles, and every chunk gets its own grid.</p>
            )}
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
          </div>

          {chunking && chunking.options.length > 0 && (
            <div className="sec">
              <h3>Chunking</h3>
              {!chunking.needsChoice ? (
                <p className="note">
                  {chunking.options[0].metrics.pieces === 1
                    ? 'The space is a single rectangle, so there is nothing to decide.'
                    : `Only one way to read this space — ${chunking.options[0].metrics.pieces} chunks — so there is nothing to decide.`}
                </p>
              ) : step === 'chunks' ? (
                <p className="note">{chunking.options.length} configurations. Pick one on the plan and
                  the lights get placed inside it. Nothing is placed until you do.</p>
              ) : (<>
                <div className="kv"><span>Reading</span><b>{plan?.chunking?.label ?? '—'}</b></div>
                <div className="kv"><span>Chunks</span><b>{plan?.chunking?.metrics?.pieces ?? '—'}</b></div>
                <div className="kv"><span>Chosen from</span><b>{chunking.options.length} options</b></div>
                {plan?.chunking?.chosenBy === 'auto' && (
                  <p className="note">Using the recommendation. Change it below if the space reads
                    differently to you.</p>
                )}
                <button className="btn" style={{ marginTop: 6 }} onClick={() => setChunkPick(null)}>
                  Change chunking
                </button>
                <p className="note">The target cell, the sliver threshold and the zones all re-read
                  the space. Your choice is kept for as long as it still exists.</p>
              </>)}
            </div>
          )}

          <div className="sec">
            <h3>Scale</h3>
            <div className="seg">
              {[['fan', 'From fan'], ['ref', 'Measure'], ['manual', 'Manual']].map(([k, l]) => (
                <button key={k} className={scaleMode === k ? 'on' : ''} onClick={() => setScaleMode(k)}>{l}</button>
              ))}
            </div>

            {scaleMode === 'fan' && (<>
              <div className="hint">You already drew the fan{fans.length > 1 ? 's' : ''} — and a fan is a standard
                object, so it doubles as a ruler.{fans.length > 1 ? ' With several, the median is used.' : ''}</div>
              <select value={fanSweep} onChange={(e) => setFanSweep(e.target.value)}>
                {REFERENCES.filter((r) => r.group === 'Fan').map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
              {!fans.length && <p className="note warn">{fanReason} Raise the red sensitivity, or switch to Measure.</p>}
              {fans.map((f, i) => (
                <div className="kv" key={i} style={i === 0 ? { marginTop: 8 } : undefined}>
                  <span>Fan {i + 1} sweep</span><b>{(f.r * 2).toFixed(0)} px</b></div>
              ))}
              {fans.length > 1 && (() => {
                const d = fans.map((f) => f.r * 2);
                const spread = (Math.max(...d) - Math.min(...d)) / (d.reduce((a, b) => a + b, 0) / d.length);
                return spread > 0.15
                  ? <p className="note warn">Those markers differ in size by {Math.round(spread * 100)}%. If they
                      aren't the same fitting, set the scale by Measure instead.</p>
                  : null;
              })()}
            </>)}

            {scaleMode === 'ref' && (<>
              <div className="hint">Click the two ends of something you can identify on the plan, then say what it is.</div>
              <select value={refId} onChange={(e) => setRefId(e.target.value)}>
                {['Door', 'Furniture', 'Sanitary', 'Kitchen', 'Fan', 'Other'].map((g) => (
                  <optgroup key={g} label={g}>
                    {REFERENCES.filter((r) => r.group === g).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </optgroup>
                ))}
              </select>
              {refId === 'custom' && (
                <div className="row" style={{ marginTop: 8 }}>
                  <label>Real length (ft)</label>
                  <input type="number" step="0.05" value={customFt} style={{ maxWidth: 90 }}
                    onChange={(e) => setCustomFt(parseFloat(e.target.value) || 0)} />
                </div>
              )}
              <div className="kv" style={{ marginTop: 8 }}>
                <span>{!measure.a ? 'Click the first end' : !measure.b ? 'Click the other end' : 'Measured'}</span>
                <b>{measureLen ? `${measureLen.toFixed(0)} px` : '—'}</b>
              </div>
              {measure.a && <button className="btn" style={{ marginTop: 6 }} onClick={() => setMeasure({ a: null, b: null })}>Reset measurement</button>}
            </>)}

            {scaleMode === 'manual' && (
              <div className="row"><label>Pixels per foot</label>
                <input type="number" step="0.01" value={manualPx} style={{ maxWidth: 100 }}
                  onChange={(e) => setManualPx(parseFloat(e.target.value) || 0)} />
              </div>
            )}

            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11.5 }}>Let Claude find the scale</summary>
              <p className="note">Sends the image to the Claude API and asks it to spot a door, fixture or dimension line. Your key stays in this browser.</p>
              <input type="password" placeholder="sk-ant-…" value={apiKey} onChange={(e) => setApiKey(e.target.value)} style={{ marginTop: 6 }} />
              <button className="btn accent" style={{ marginTop: 6 }} disabled={!apiKey || !!busy} onClick={runAI}>Estimate scale</button>
              {aiResult && (aiResult.error
                ? <p className="note warn">{aiResult.error}</p>
                : <div style={{ marginTop: 8 }}>
                    <div className="kv"><span>Reference</span><b>{aiResult.object}</b></div>
                    <div className="kv"><span>px / ft</span><b>{Number(aiResult.pxPerFoot).toFixed(2)}</b></div>
                    <div className="kv"><span>Confidence</span><b>{aiResult.confidence}</b></div>
                    <p className="note">{aiResult.note}</p>
                  </div>)}
            </details>
          </div>

          <div className="sec">
            <h3>Grid</h3>
            <Slider label="Target cell" v={opt.targetCell} min={3} max={12} step={0.25} onChange={(v) => setOpt((o) => ({ ...o, targetCell: v }))} fmt={(v) => `${v} ft`} />
            <Slider label="Min cell" v={opt.minCell} min={2} max={8} step={0.25} onChange={(v) => setOpt((o) => ({ ...o, minCell: v }))} fmt={(v) => `${v} ft`} />
            <Slider label="Max cell" v={opt.maxCell} min={5} max={14} step={0.25} onChange={(v) => setOpt((o) => ({ ...o, maxCell: v }))} fmt={(v) => `${v} ft`} />
            <Slider label="Hold to target" v={opt.sizeWeight} min={0} max={10} step={0.25}
              onChange={(v) => setOpt((o) => ({ ...o, sizeWeight: v }))} fmt={(v) => v.toFixed(2)} />
            <Slider label="Fan pull" v={opt.fanAnchorWeight} min={0} max={3} step={0.1} onChange={(v) => setOpt((o) => ({ ...o, fanAnchorWeight: v }))} fmt={(v) => v.toFixed(1)} />
            <Slider label="Skip chunks under" v={opt.minChunk} min={0} max={4} step={0.25} onChange={(v) => setOpt((o) => ({ ...o, minChunk: v }))} fmt={(v) => `${v} ft`} />
            <p className="note">The space (minus no-light zones) is chopped into rectangular chunks,
              and each chunk is gridded on its own. A chunk narrower than this in either direction
              is left out entirely.</p>
          </div>

          {step !== 'chunks' && <>
          <div className="sec">
            <h3>Lights</h3>
            <Slider label="Min wall distance" v={opt.minWallDistance} min={2} max={9} step={0.25}
              onChange={(v) => setOpt((o) => ({ ...o, minWallDistance: v }))} fmt={(v) => `${v} ft`} />
            <p className="note">A large light needs this much clear to the nearest wall in
              every direction. Anything closer becomes a small light at the cell centre.</p>
            <Slider label="Centre band" v={opt.centreBand} min={0.05} max={0.45} step={0.01}
              onChange={(v) => setOpt((o) => ({ ...o, centreBand: v }))} fmt={(v) => `±${Math.round(v * 100)}%`} />
            <label className="check">
              <input type="checkbox" checked={opt.smallFirst}
                onChange={(e) => setOpt((o) => ({ ...o, smallFirst: e.target.checked }))} />
              Small lights first — large only where forced
            </label>
            {opt.smallFirst ? (
              <>
                <Slider label="Neighbour cost" v={opt.pairCostNormal} min={0} max={2} step={0.05}
                  onChange={(v) => setOpt((o) => ({ ...o, pairCostNormal: v }))} fmt={(v) => v.toFixed(2)} />
                <p className="note">Every cell gets a small light at its centre. A large light is used
                  only where a fan's clearance covers a cell's centre band — it then serves that cell
                  and a neighbour, and the neighbour gives up its own light. With no fan on the plan
                  there are no large lights at all.</p>
              </>
            ) : (
              <Slider label="Awkward-cell priority" v={opt.awkwardPriority} min={0} max={5} step={0.25}
                onChange={(v) => setOpt((o) => ({ ...o, awkwardPriority: v }))} fmt={(v) => v.toFixed(2)} />
            )}
            <label className="check">
              <input type="checkbox" checked={opt.allowEdgeSliding}
                onChange={(e) => setOpt((o) => ({ ...o, allowEdgeSliding: e.target.checked }))} />
              Large light may sit anywhere along its grid line
            </label>
            <label className="check">
              <input type="checkbox" checked={opt.allowChunkAxis}
                onChange={(e) => setOpt((o) => ({ ...o, allowChunkAxis: e.target.checked }))} />
              ...preferring the chunk's centre axis
            </label>
            <label className="check">
              <input type="checkbox" checked={opt.allowRoaming}
                onChange={(e) => setOpt((o) => ({ ...o, allowRoaming: e.target.checked }))} />
              ...or leave the grid line entirely, as a last resort
            </label>
            <Slider label="Alignment strictness" v={opt.misalignPenalty} min={0} max={5} step={0.25}
              onChange={(v) => setOpt((o) => ({ ...o, misalignPenalty: v }))} fmt={(v) => v.toFixed(2)} />
            <Slider label="Cost of roaming" v={opt.roamPenalty} min={0} max={5} step={0.25}
              onChange={(v) => setOpt((o) => ({ ...o, roamPenalty: v }))} fmt={(v) => v.toFixed(2)} />
            <Slider label="Vertex dead band" v={opt.vertexBand} min={0} max={2} step={0.05}
              onChange={(v) => setOpt((o) => ({ ...o, vertexBand: v }))} fmt={(v) => `${v.toFixed(2)} ft`} />
            <label className="check">
              <input type="checkbox" checked={opt.allowGridEdgePositions}
                onChange={(e) => setOpt((o) => ({ ...o, allowGridEdgePositions: e.target.checked }))} />
              ...or to a grid crossing at the end of its line
            </label>
            <p className="note">A large light prefers the midpoint of the line it shares, then a chunk
              centre axis or a vertex, then anywhere else along that line — and only as a last resort
              does it leave the line, sliding along the row or column joining the two boxes instead.
              Alignment strictness is what buys a tidy position at the price of a box or two; cost of
              roaming is what keeps it on the grid until it really cannot be.</p>
            <label className="check">
              <input type="checkbox" checked={opt.omitAwkwardCells}
                onChange={(e) => setOpt((o) => ({ ...o, omitAwkwardCells: e.target.checked }))} />
              Leave a cell to the fan rather than place an off-centre light
            </label>
            <p className="note">A small light must sit within the centre band of its cell. A cell
              that can't take one is paired with a neighbour and served by a large light instead.</p>
            <Slider label="Align tolerance" v={opt.alignTol} min={0} max={3} step={0.05} onChange={(v) => setOpt((o) => ({ ...o, alignTol: v }))} fmt={(v) => `${v} ft`} />
            <Slider label="Min light spacing" v={opt.minLightSpacing} min={0} max={8} step={0.1}
              onChange={(v) => setOpt((o) => ({ ...o, minLightSpacing: v }))} fmt={(v) => `${v.toFixed(1)} ft`} />
            <Slider label="Fan clearance" v={opt.fanClearance} min={0} max={6} step={0.25} onChange={(v) => setOpt((o) => ({ ...o, fanClearance: v }))} fmt={(v) => `${v} ft`} />
            <label className="check">
              <input type="checkbox" checked={opt.preferLongAxis} onChange={(e) => setOpt((o) => ({ ...o, preferLongAxis: e.target.checked }))} />
              Bias pairs along the room's long axis
            </label>
            <label className="check">
              <input type="checkbox" checked={opt.uniformOrientation} onChange={(e) => setOpt((o) => ({ ...o, uniformOrientation: e.target.checked }))} />
              Prefer one pairing direction (regular array)
            </label>
            <button className="btn" style={{ marginTop: 4 }} onClick={() => setOpt({ ...DEFAULTS })}>Reset to defaults</button>
          </div>

          <div className="sec">
            <h3>View</h3>
            <Slider label="Zoom" v={zoom} min={0.25} max={3} step={0.05} onChange={setZoom} fmt={(v) => `${Math.round(v * 100)}%`} />
            {[['plan', 'Floor plan'], ['dim', 'Fade the plan'], ['region', 'Region outline'], ['grid', 'Grid lines'],
              ['cells', 'Cell shading'], ['lights', 'Lights'], ['labels', 'Light tags'], ['fan', 'Fan'],
              ['zones', 'No-light zones']].map(([k, l]) => (
              <label className="check" key={k}><input type="checkbox" checked={layers[k]} onChange={toggle(k)} />{l}</label>
            ))}
          </div>

          {plan?.ok && (
            <div className="sec">
              <h3>Result</h3>
              <div className="stats">
                <div className="stat"><b>{plan.stats.large}</b><span>large</span></div>
                <div className="stat"><b>{plan.stats.small}</b><span>small</span></div>
                <div className="stat"><b>{plan.stats.cells}</b><span>cells</span></div>
                <div className="stat"><b>{Math.round(plan.stats.areaSqft)}</b><span>sq ft</span></div>
              </div>
              <div style={{ marginTop: 10 }}>
                <div className="kv"><span>Cells lit</span>
                  <b style={{ color: plan.stats.unserved ? 'var(--danger)' : 'var(--success)' }}>
                    {plan.stats.served} / {plan.stats.cells - plan.stats.ceded}</b></div>
                {plan.stats.ceded > 0 && (
                  <div className="kv"><span>Cells left to a fan</span><b>{plan.stats.ceded}</b></div>
                )}
                <div className="kv"><span>Chunks</span>
                  <b>{plan.stats.chunks}{plan.stats.omittedChunks > 0 ? ` (+${plan.stats.omittedChunks} slivers skipped)` : ''}</b></div>
                <div className="kv"><span>Average cell side</span><b>{plan.stats.avgCell.toFixed(2)} ft</b></div>
                <div className="kv"><span>Sq ft per light</span><b>{(plan.stats.areaSqft / Math.max(1, plan.lights.length)).toFixed(0)}</b></div>
                <div className="kv"><span>Distinct rows / cols</span>
                  <b>{new Set(plan.lights.map((l) => l.y.toFixed(1))).size} / {new Set(plan.lights.map((l) => l.x.toFixed(1))).size}</b></div>
                {plan.stats.fans > 1 && (
                  <div className="kv"><span>Fans on the plan</span><b>{plan.stats.fans}</b></div>
                )}
                {plan.stats.nudged > 0 && (
                  <div className="kv"><span>Moved clear of the fan</span><b>{plan.stats.nudged}</b></div>
                )}
                {plan.lights.filter((l) => l.roaming).length > 0 && (
                  <div className="kv"><span>Large lights off the grid line</span>
                    <b>{plan.lights.filter((l) => l.roaming).length}</b></div>
                )}
                {plan.lights.filter((l) => l.kind === 'large' && l.cells.length === 4).length > 0 && (
                  <div className="kv"><span>Lights covering 4 boxes</span>
                    <b>{plan.lights.filter((l) => l.kind === 'large' && l.cells.length === 4).length}</b></div>
                )}
                {plan.lights.filter((l) => l.kind === 'large' && l.spot !== 'midpoint').length > 0 && (
                  <div className="kv"><span>Large lights off the midpoint</span>
                    <b>{plan.lights.filter((l) => l.kind === 'large' && l.spot !== 'midpoint').length}</b></div>
                )}
                {plan.stats.awkward > 0 && (
                  <div className="kv"><span>Off-centre cells rescued</span>
                    <b style={{ color: plan.stats.rescued === plan.stats.awkward ? 'var(--success)' : undefined }}>
                      {plan.stats.rescued} / {plan.stats.awkward}</b></div>
                )}
              </div>
              {plan.stats.unserved > 0 && (
                <p className="note warn">{plan.stats.unserved} cell{plan.stats.unserved > 1 ? 's have' : ' has'} no
                  light. That should never happen — please send me the plan.</p>
              )}
              {plan.stats.ceded > 0 && (
                <p className="note">{plan.stats.ceded} cell{plan.stats.ceded > 1 ? 's have' : ' has'} no light
                  of {plan.stats.ceded > 1 ? 'their' : 'its'} own — a fan sits too close to the centre for a
                  small light, and no large light can reach {plan.stats.ceded > 1 ? 'them' : 'it'} either. The fan
                  is the ceiling feature there. Lower the fan clearance if you want a light anyway.</p>
              )}
              {plan.stats.outsideBand > 0 && (
                <p className="note warn">{plan.stats.outsideBand} small
                  light{plan.stats.outsideBand > 1 ? 's sit' : ' sits'} outside the centre band. Switch on
                  "leave a cell to the fan" to drop {plan.stats.outsideBand > 1 ? 'them' : 'it'} instead.</p>
              )}
              {plan.stats.clashes > 0 && (
                <p className="note warn">{plan.stats.clashes} light{plan.stats.clashes > 1 ? 's sit' : ' sits'} inside
                  the fan's clearance or a no-light zone because its cell has nowhere else to go.
                  Lower the fan clearance, enlarge the zone so the whole cell is blocked, or move the grid.</p>
              )}
            </div>
          )}
          {plan && !plan.ok && <div className="sec"><p className="note warn">{plan.reason}</p></div>}

          <div className="sec">
            <h3>Export</h3>
            <div className="btnrow">
              <button className="btn" disabled={!plan?.ok} onClick={() => download(`${base}-lights.dxf`, toDXF(plan, plan.fansFt), 'application/dxf')}>DXF</button>
              <button className="btn" disabled={!plan?.ok} onClick={() => download(`${base}-lights.csv`, toCSV(plan), 'text/csv')}>CSV</button>
              <button className="btn" disabled={!plan?.ok} onClick={() => download(`${base}-lights.json`, toJSON(plan, { pxPerFt, mode: scaleMode }), 'application/json')}>JSON</button>
              <button className="btn" disabled={!img} onClick={() => download(`${base}-lights.svg`, svgString(svgRef.current), 'image/svg+xml')}>SVG</button>
              <button className="btn" disabled={!img} onClick={async () => download(`${base}-lights.png`, await svgToPNG(svgRef.current, img.w))}>PNG</button>
            </div>
            <p className="note">DXF comes out in feet on layers ROOM / CHUNK / GRID / NO-LIGHT / LIGHT-LARGE / LIGHT-SMALL / FAN.</p>
          </div>
          </>}
        </>}
      </div>
    </div>
  );
}

function Slider({ label, v, min, max, step, onChange, fmt, invert }) {
  return (
    <div className="row">
      <label>{label}</label>
      <input type="range" min={min} max={max} step={step}
        value={invert ? min + max - v : v}
        onChange={(e) => onChange(invert ? min + max - parseFloat(e.target.value) : parseFloat(e.target.value))} />
      <span className="val">{fmt ? fmt(v) : v}</span>
    </div>
  );
}
