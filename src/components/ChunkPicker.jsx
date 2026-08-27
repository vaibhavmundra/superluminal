import React, { useEffect, useMemo, useState } from 'react';

// ---------------------------------------------------------------------------
// ChunkPicker — the step between reading the plan and lighting it.
//
// The room minus its no-light zones can be cut into rectangles several ways,
// and the geometry cannot tell you which is right: that depends on how the
// space is used. So before any light is placed, every reading is drawn to the
// same scale, over the same plan, measured the same way — and the person picks.
//
// The cards are drawn from exactly the data chunkingPayload() serialises for a
// model, so when the choice is automated later it is choosing from the same
// evidence a person sees here, not a parallel summary that can drift.
// ---------------------------------------------------------------------------

// The same value ramp the tracer uses — see the note there.
const FILL = ['#111111', '#8A8A8A', '#3D3D3D', '#B0B0B0', '#5C5C5C', '#9E9E9E', '#262626', '#767676'];

export default function ChunkPicker({
  options, recommendedId, initialId, onConfirm, onCancel = null,
  src, vector = null, wallLayers = null,
  imgW, imgH, polygonPx, zonesPx = [], fansPx = [], toPx,
}) {
  // Which card is highlighted is the picker's own business. Only CONFIRMING
  // leaves this screen — selecting has to be free, or you cannot compare two
  // readings without committing to the first one you click.
  const [draft, setDraft] = useState(initialId || recommendedId);
  useEffect(() => {
    if (!options.some((o) => o.id === draft)) setDraft(recommendedId);
  }, [options, recommendedId, draft]);

  const view = useMemo(() => {
    const xs = polygonPx.map((p) => p.x), ys = polygonPx.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = Math.max(maxX - minX, maxY - minY) * 0.06;
    return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
  }, [polygonPx]);

  const chosen = options.find((o) => o.id === draft) || null;

  return (
    <div className="picker">
      <div className="picker-head">
        <h2>How should this space be cut up?</h2>
        <p><b>{options.length} ways</b> to read it. Each chunk gets its own grid.</p>
      </div>

      <div className="picker-grid">
        {options.map((o, i) => (
          <ChunkCard key={o.id} option={o} index={i}
            recommended={o.id === recommendedId}
            selected={o.id === draft}
            onSelect={() => setDraft(o.id)}
            onConfirm={() => onConfirm(o.id)}
            view={view} src={src} vector={vector} wallLayers={wallLayers}
            imgW={imgW} imgH={imgH}
            polygonPx={polygonPx} zonesPx={zonesPx} fansPx={fansPx} toPx={toPx} />
        ))}
      </div>

      <div className="picker-foot">
        <div className="picker-foot-txt">
          {chosen
            ? <><b>{chosen.label}</b> — {chosen.metrics.pieces} chunks, about {chosen.metrics.estCells} cells.</>
            : <>Click a configuration to select it. Double-click to go straight through.</>}
        </div>
        {/* An escape. This screen used to be a GATE — you could not reach a
            layout without passing it — so leaving it was meaningless. Now the
            whole plan is lit off the recommended chunkings and this is somewhere
            you came to on purpose, which means there has to be a way back out
            without having to make a choice you did not want to make. */}
        <div className="btnrow">
          {onCancel && <button className="btn" onClick={onCancel}>Leave it as it is</button>}
          <button className="btn primary" disabled={!chosen} onClick={() => chosen && onConfirm(chosen.id)}>
            {chosen ? 'Place the lights →' : 'Select a configuration'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChunkCard({
  option: o, recommended, selected, onSelect, onConfirm,
  view, src, vector, wallLayers, imgW, imgH, polygonPx, zonesPx, fansPx, toPx,
}) {
  const lw = Math.max(view.w, view.h) / 260;      // line weight that survives any plan size
  const fs = Math.max(view.w, view.h) / 34;       // legible label at card size
  const rect = (c) => {
    const a = toPx({ x: c.x0, y: c.y0 }), b = toPx({ x: c.x1, y: c.y1 });
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  };
  const lost = o.metrics.lostArea;

  return (
    <button className={'chunk-card' + (selected ? ' on' : '')}
      onClick={onSelect} onDoubleClick={onConfirm}
      aria-pressed={selected} title={o.blurb}>
      <div className="chunk-card-top">
        <span className="chunk-card-name">{o.label}</span>
        {recommended && <span className="tag rec">recommended</span>}
        {selected && <span className="tag sel">selected</span>}
      </div>

      <svg className="chunk-thumb" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}>
        <defs>
          <pattern id={`pk-nlz-${o.id}`} width={lw * 8} height={lw * 8}
            patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2={lw * 8} stroke="#404040" strokeWidth={lw * 1.6} opacity="0.5" />
          </pattern>
          <pattern id={`pk-slv-${o.id}`} width={lw * 6} height={lw * 6}
            patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
            <line x1="0" y1="0" x2="0" y2={lw * 6} stroke="#A8A8A8" strokeWidth={lw * 1.4} opacity="0.7" />
          </pattern>
        </defs>

        {/* The plan under the card. A raster plan is the image; a DXF is its own
            line work, faint — either way the reading is shown OVER the drawing
            it is a reading of, which is the entire point of these cards. */}
        {src && <image href={src} x="0" y="0" width={imgW} height={imgH} opacity="0.16" />}
        {vector && (
          <g fill="none" stroke="#000000" strokeWidth={lw * 1.2} opacity="0.3">
            {vector.filter((l) => !wallLayers || wallLayers.has(l.layer))
                   .map((l) => <path key={l.layer} d={l.path} />)}
          </g>
        )}

        {o.chunks.map((c, k) => {
          const r = rect(c);
          const col = FILL[k % FILL.length];
          return <rect key={k} x={r.x} y={r.y} width={r.w} height={r.h}
            fill={col} fillOpacity="0.14" stroke={col} strokeWidth={lw * 2.2} />;
        })}

        {o.omitted.map((c, k) => {
          const r = rect(c);
          return <rect key={'s' + k} x={r.x} y={r.y} width={r.w} height={r.h}
            fill={`url(#pk-slv-${o.id})`} stroke="#A8A8A8" strokeWidth={lw} opacity="0.85" />;
        })}

        {zonesPx.map((z) => (
          <rect key={z.id} x={z.x0} y={z.y0} width={z.x1 - z.x0} height={z.y1 - z.y0}
            fill={`url(#pk-nlz-${o.id})`} stroke="#404040" strokeWidth={lw * 1.6}
            strokeDasharray={`${lw * 4} ${lw * 3}`} />
        ))}

        <polygon points={polygonPx.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none" stroke="#000000" strokeWidth={lw * 2.4} strokeLinejoin="round" />

        {fansPx.map((f, k) => (
          <g key={'f' + k}>
            <circle cx={f.x} cy={f.y} r={f.r} fill="none" stroke="#404040"
              strokeWidth={lw * 1.6} strokeDasharray={`${lw * 4} ${lw * 4}`} opacity="0.9" />
            <circle cx={f.x} cy={f.y} r={lw * 3} fill="#404040" />
          </g>
        ))}

        {/* sizes last, haloed: a dimension that a fan circle runs through is
            worse than no dimension at all */}
        {o.chunks.map((c, k) => {
          const r = rect(c);
          if (Math.min(r.w, r.h) < fs * 2.4) return null;
          return (
            <text key={'t' + k} x={r.x + r.w / 2} y={r.y + r.h / 2} fontSize={fs}
              fontFamily="Neue Montreal, sans-serif" fill={FILL[k % FILL.length]}
              stroke="#FAFAFA" strokeWidth={lw * 3.4} paintOrder="stroke"
              textAnchor="middle" dominantBaseline="central">
              {c.w.toFixed(1)}×{c.h.toFixed(1)}
            </text>
          );
        })}
      </svg>

      <div className="chip-row">
        <span className="chip"><b>{o.metrics.pieces}</b> chunks</span>
        <span className="chip">≈<b>{o.metrics.estCells}</b> cells</span>
        <span className={'chip' + (lost > 0.05 ? ' bad' : '')}>
          {lost > 0.05 ? <><b>{lost.toFixed(0)}</b> sq ft lost</> : 'nothing lost'}
        </span>
        <span className="chip">squareness <b>{o.metrics.avgSquareness.toFixed(2)}</b></span>
        {o.metrics.fansTotal > 0 && (
          <span className={'chip' + (o.metrics.fansOnAnEdge ? ' bad' : '')}>
            <b>{o.metrics.fansHeldClear}</b>/{o.metrics.fansTotal} fans clear
          </span>
        )}
      </div>

      {o.highlights?.length > 0 && (
        <div className="chip-row">
          {o.highlights.map((h) => <span key={h} className="tag good">{h}</span>)}
        </div>
      )}

      <p className="chunk-card-blurb">{o.blurb}</p>
      {o.aliasLabels?.length > 0 && (
        <p className="chunk-card-alias">Same answer as: {o.aliasLabels.join(', ')}</p>
      )}
    </button>
  );
}
