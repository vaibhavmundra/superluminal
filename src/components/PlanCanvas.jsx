import React, { forwardRef } from 'react';

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

const C = {
  region: '#16A34A', grid: '#6366F1', cell: '#6366F1',
  large: '#0A0A0A', small: '#6366F1', fan: '#DC2626', measure: '#B45309',
  zone: '#B45309',
};

const PlanCanvas = forwardRef(function PlanCanvas(
  { src, vector = null, wallLayers = null,
    width, height, plans = [], focusId = null,
    fansPx = [], pxPerFt, layers, zoom, measure, onCanvasClick, toPx,
    zones = [], draftZone = null, zoneMode = false, onZoneDown, onZoneMove, onZoneUp,
    cursor = null },
  ref
) {
  const s = pxPerFt || 1;
  const lw = Math.max(width, height) / 900; // line weight that survives any image size
  const laid = plans.filter((r) => r.plan?.ok);

  // each chunk draws its own outline plus its own interior grid lines —
  // no line ever crosses a no-light zone, because the zones aren't in any chunk
  const gridPath = (plan) => (
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

  const points = (poly) => poly.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <svg
      ref={ref}
      className="plan"
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: width * zoom, maxWidth: 'none',
               touchAction: zoneMode ? 'none' : undefined,
               cursor: cursor || undefined }}
      onClick={onCanvasClick}
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
          <line x1="0" y1="0" x2="0" y2={lw * 9} stroke={C.zone} strokeWidth={lw * 1.6} opacity="0.45" />
        </pattern>
      </defs>

      {/* The plan underneath. A raster plan is an image; a DXF is its own line
          work, drawn one path per layer — the layers being read as walls in
          black, everything else faint, so what the room outline was taken from
          stays visible under the layout. */}
      {layers.plan && (vector
        ? <g opacity={layers.dim ? 0.5 : 1}>
            <g fill="none" stroke="#9CA3AF" strokeWidth={lw * 1.1} opacity="0.45">
              {vector.filter((l) => !wallLayers?.has(l.layer))
                     .map((l) => <path key={l.layer} d={l.path} />)}
            </g>
            <g fill="none" stroke="#0A0A0A" strokeWidth={lw * 1.6} opacity="0.7">
              {vector.filter((l) => wallLayers?.has(l.layer))
                     .map((l) => <path key={l.layer} d={l.path} />)}
            </g>
            {vector.flatMap((l) => l.circles.map((c, k) => (
              <circle key={l.layer + k} cx={c.cx} cy={c.cy} r={c.r}
                fill="none" stroke="#9CA3AF" strokeWidth={lw} opacity="0.45" />
            )))}
          </g>
        : <image href={src} x="0" y="0" width={width} height={height} opacity={layers.dim ? 0.42 : 1} />
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
          {layers.grid && <g clipPath={`url(#roomclip-${i})`}>{gridPath(r.plan)}</g>}
          {layers.region && (
            <polygon points={points(r.plan.polygonPx)}
              fill="none" stroke={C.region}
              /* The room the panel is talking about is drawn heavier. With eight
                 green outlines on one sheet, "which one is Bedroom 2" is
                 otherwise a question the drawing cannot answer. */
              strokeWidth={lw * (r.id === focusId && laid.length > 1 ? 3.6 : 2.4)}
              strokeLinejoin="round" />
          )}
        </g>
      ))}

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

      {/* The lights. Tags are prefixed with the room once there is more than
          one, because L1 in the kitchen and L1 in the hall are two fittings and
          a schedule that calls them both L1 is a schedule nobody can order
          from. */}
      {layers.lights && laid.map((r) => (
        <g key={'l' + r.id}>
          {r.plan.lightsPx.map((l) => {
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
                {layers.labels && l.kind === 'large' && l.coverPx && l.coverPx.length > 1 && (
                  <g opacity="0.3">
                    {l.coverPx.map((q, k) => (
                      <line key={k} x1={l.x} y1={l.y} x2={q.x} y2={q.y} stroke={col} strokeWidth={lw} />
                    ))}
                  </g>
                )}
                {layers.labels && l.nudged && l.centrePx && (
                  <g opacity="0.5">
                    <line x1={l.centrePx.x} y1={l.centrePx.y} x2={l.x} y2={l.y}
                      stroke={col} strokeWidth={lw} strokeDasharray={`${lw * 2} ${lw * 2}`} />
                    <circle cx={l.centrePx.x} cy={l.centrePx.y} r={lw * 1.5} fill="none"
                      stroke={col} strokeWidth={lw} />
                  </g>
                )}
                {layers.labels && (
                  <text x={l.x + R * 1.6} y={l.y - R * 1.2} fontSize={s * 0.5}
                    fontFamily="JetBrains Mono, monospace" fill={col} opacity="0.75">
                    {laid.length > 1 && r.name ? `${r.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 4)}-` : ''}{l.id}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      ))}

      {/* Room names, on the same switch as the light tags: both are annotation,
          and both are in the way when what you want to see is the layout. */}
      {layers.labels && laid.length > 1 && laid.map((r) => {
        const poly = r.plan.polygonPx;
        const cx = poly.reduce((a, p) => a + p.x, 0) / poly.length;
        const cy = poly.reduce((a, p) => a + p.y, 0) / poly.length;
        return (
          <text key={'n' + r.id} x={cx} y={cy} textAnchor="middle"
            fontSize={s * 0.8} fontFamily="JetBrains Mono, monospace"
            fill={C.region} opacity="0.65">{r.name || 'Room'}</text>
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
