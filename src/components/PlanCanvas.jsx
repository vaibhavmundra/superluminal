import React, { forwardRef } from 'react';

const C = {
  region: '#16A34A', grid: '#6366F1', cell: '#6366F1',
  large: '#0A0A0A', small: '#6366F1', fan: '#DC2626', measure: '#B45309',
  zone: '#B45309',
};

const PlanCanvas = forwardRef(function PlanCanvas(
  { src, width, height, plan, fansPx = [], pxPerFt, layers, zoom, measure, onCanvasClick, toPx,
    zones = [], draftZone = null, zoneMode = false, onZoneDown, onZoneMove, onZoneUp },
  ref
) {
  const s = pxPerFt || 1;
  const lw = Math.max(width, height) / 900; // line weight that survives any image size

  // each chunk draws its own outline plus its own interior grid lines —
  // no line ever crosses a no-light zone, because the zones aren't in any chunk
  const gridPath = () => {
    if (!plan?.ok) return null;
    return (
      <g>
        {plan.chunksPx.map((ch, k) => (
          <g key={k}>
            <rect x={ch.x0} y={ch.y0} width={ch.x1 - ch.x0} height={ch.y1 - ch.y0}
              fill="none" stroke={C.grid} strokeWidth={lw * 1.8} opacity="0.55" />
            <g stroke={C.grid} strokeWidth={lw} opacity="0.42" strokeDasharray={`${lw * 6} ${lw * 4}`}>
              {ch.xLines.slice(1, -1).map((x, i) => <line key={'x' + i} x1={x} y1={ch.y0} x2={x} y2={ch.y1} />)}
              {ch.yLines.slice(1, -1).map((y, i) => <line key={'y' + i} x1={ch.x0} y1={y} x2={ch.x1} y2={y} />)}
            </g>
          </g>
        ))}
      </g>
    );
  };

  return (
    <svg
      ref={ref}
      className="plan"
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: width * zoom, maxWidth: 'none', touchAction: zoneMode ? 'none' : undefined }}
      onClick={onCanvasClick}
      onPointerDown={onZoneDown} onPointerMove={onZoneMove}
      onPointerUp={onZoneUp} onPointerCancel={onZoneUp}
    >
      <defs>
        {plan?.ok && (
          <clipPath id="roomclip">
            <polygon points={plan.polygonPx.map((p) => `${p.x},${p.y}`).join(' ')} />
          </clipPath>
        )}
        <pattern id="nlz" width={lw * 9} height={lw * 9} patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2={lw * 9} stroke={C.zone} strokeWidth={lw * 1.6} opacity="0.45" />
        </pattern>
      </defs>

      {layers.plan && <image href={src} x="0" y="0" width={width} height={height} opacity={layers.dim ? 0.42 : 1} />}

      {plan?.ok && (
        <>
          {layers.cells && (
            <g clipPath="url(#roomclip)">
              {plan.cellsPx.map((c, i) => (
                <rect key={i} x={c.x0} y={c.y0} width={c.x1 - c.x0} height={c.y1 - c.y0}
                  fill={C.cell} opacity={(c.i + c.j) % 2 ? 0.05 : 0.015} />
              ))}
            </g>
          )}
          {layers.grid && <g clipPath="url(#roomclip)">{gridPath()}</g>}
          {layers.region && (
            <polygon points={plan.polygonPx.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none" stroke={C.region} strokeWidth={lw * 2.4} strokeLinejoin="round" />
          )}
        </>
      )}

      {layers.zones && (
        <g>
          {zones.map((z) => (
            <rect key={z.id} x={z.x0} y={z.y0} width={z.x1 - z.x0} height={z.y1 - z.y0}
              fill="url(#nlz)" stroke={C.zone} strokeWidth={lw * 1.8}
              strokeDasharray={`${lw * 5} ${lw * 3.5}`} opacity="0.9" />
          ))}
          {draftZone && (
            <rect x={Math.min(draftZone.x0, draftZone.x1)} y={Math.min(draftZone.y0, draftZone.y1)}
              width={Math.abs(draftZone.x1 - draftZone.x0)} height={Math.abs(draftZone.y1 - draftZone.y0)}
              fill={C.zone} fillOpacity="0.12" stroke={C.zone} strokeWidth={lw * 2} />
          )}
        </g>
      )}

      {layers.fan && fansPx.map((f, i) => (
        <g key={'fan' + i}>
          <circle cx={f.x} cy={f.y} r={f.r} fill="none" stroke={C.fan}
            strokeWidth={lw * 1.6} strokeDasharray={`${lw * 5} ${lw * 5}`} opacity="0.85" />
          <circle cx={f.x} cy={f.y} r={lw * 3} fill={C.fan} />
          {fansPx.length > 1 && layers.labels && (
            <text x={f.x + f.r + lw * 3} y={f.y - f.r * 0.6} fontSize={(pxPerFt || 12) * 0.5}
              fontFamily="JetBrains Mono, monospace" fill={C.fan} opacity="0.8">F{i + 1}</text>
          )}
        </g>
      ))}

      {layers.lights && plan?.ok && plan.lightsPx.map((l) => {
        const R = (l.kind === 'large' ? 0.52 : 0.3) * s;
        const col = l.kind === 'large' ? C.large : C.small;
        return (
          <g key={l.id}>
            {l.kind === 'large' && (
              <circle cx={l.x} cy={l.y} r={R * 1.9} fill={col} opacity="0.07" />
            )}
            <circle cx={l.x} cy={l.y} r={R} fill={l.kind === 'large' ? col : '#fff'}
              stroke={col} strokeWidth={lw * 1.7} />
            {l.kind === 'small' && <circle cx={l.x} cy={l.y} r={R * 0.42} fill={col} />}
            {l.kind === 'large' && (
              <line
                x1={l.axis === 'v' ? l.x : l.x - R * 1.7} y1={l.axis === 'v' ? l.y - R * 1.7 : l.y}
                x2={l.axis === 'v' ? l.x : l.x + R * 1.7} y2={l.axis === 'v' ? l.y + R * 1.7 : l.y}
                stroke={col} strokeWidth={lw * 1.1} opacity="0.5" />
            )}
            {layers.labels && (
              <text x={l.x + R * 1.6} y={l.y - R * 1.2} fontSize={s * 0.5}
                fontFamily="JetBrains Mono, monospace" fill={col} opacity="0.75">{l.id}</text>
            )}
          </g>
        );
      })}

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
