import React, { forwardRef } from 'react';
import { guideLine } from '../lib/snapGuides.js';
import { CEILING_BY_ID, isRect } from '../lib/ceilingObjects.js';

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
  // Controls are not drawing. Selection frames, grips and alignment guides are
  // UI that happens to be rendered in the drawing's coordinate space, so they
  // take the colour every editor uses for exactly that and never the colour of
  // the object they are attached to — which would read as part of it.
  grip: '#0D99FF',
  guide: '#F0308C',
};

const PlanCanvas = forwardRef(function PlanCanvas(
  { src, vector = null, wallLayers = null,
    width, height, plans = [], focusId = null,
    fansPx = [], pxPerFt, layers, zoom, measure, onCanvasClick, toPx,
    zones = [], draftZone = null, zoneMode = false, onZoneDown, onZoneMove, onZoneUp,
    accents = [], objMode = false, selObjId = null, onObjPointerDown,
    objDragMode = null, guides = [], ghost = null, clearanceFt = 2,
    selAccId = null, onAccPointerDown, surfaces = [], taskSpots = [],
    cursor = null },
  ref
) {
  const s = pxPerFt || 1;
  // THIN AND CRISP. This was /900 and everything on the drawing is a multiple
  // of it, so the one number sets the weight of the whole sheet. A lighting
  // layout is an overlay on somebody else's line work and should read as one —
  // heavy strokes make it look like the plan is ours.
  const lw = Math.max(width, height) / 1500;
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

      {/* --- what is already on the ceiling ---------------------------------
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
        const sel = f.id != null && f.id === selObjId;
        // HANDLES ARE A CONSTANT SIZE ON SCREEN — divided by the zoom — and that
        // is most of why this reads as an editor rather than a drawing. The plan
        // scales with the zoom; a grab target must not, or it is unusably small
        // at 40% and a dinner plate at 300%.
        const HS = (Math.max(width, height) / 145) / (zoom || 1);
        const FW = (Math.max(width, height) / 1500) / (zoom || 1);
        // `.hit` is what makes an element a CONTROL rather than drawing — see
        // the hit-test rule in styles.css. Without it the element is inert and
        // the click falls through to the canvas.
        const grab = (mode) => (f.source === 'placed' && onObjPointerDown
          ? { className: 'hit',
              onPointerDown: (e) => onObjPointerDown(e, f.id, mode),
              style: { cursor: mode === 'move' ? 'move' : 'grab' } }
          : {});
        const col = f.kind === 'chandelier' ? '#B45309'
          : f.kind === 'ac' ? '#0F766E'
          : f.kind === 'trapdoor' ? '#6D28D9' : C.fan;
        const R = f.r || 0;
        // The BODY's radius, which is NOT the clearance radius: on a rectangle
        // the clearance circle is circumscribed and larger. The selection frame
        // has to fit the body, because the body is what a resize changes.
        const rect = f.kind === 'ac' || f.kind === 'trapdoor';
        // The clearance, in plan pixels. Drawn as the offset of the body, so a
        // circle keeps a ring and a rectangle keeps a rounded rectangle.
        const CL = clearanceFt * (pxPerFt || 0);
        const R0 = rect ? 0 : R;
        return (
          <g key={f.id ?? 'fan' + i} opacity={objMode && !sel && f.source === 'placed' ? 0.75 : 1}>
            {/* WHAT IS ACTUALLY RESERVED, and it is not always a circle.
                Clearance is measured to the object's own FACE, so the set of
                points exactly `fanClearance` away from a rectangle is that
                rectangle grown by the clearance with its corners rounded to
                that same radius. Drawing the true offset rather than a circle
                round everything is the only way the reserved area on screen is
                the reserved area in the layout — and drawing a big circle round
                a small cassette was how it came to be reserving one. */}
            {rect ? (
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
              <g stroke={col} strokeWidth={lw * 1.8} fill="none">
                <circle cx={f.x} cy={f.y} r={R0 * 0.68} fill={col} fillOpacity="0.1" />
                {[0, 1, 2, 3, 4, 5].map((k) => {
                  const a = (k * Math.PI) / 3;
                  return <circle key={k} cx={f.x + Math.cos(a) * R0 * 0.68}
                    cy={f.y + Math.sin(a) * R0 * 0.68} r={lw * 2.4} fill="#fff" />;
                })}
                <circle cx={f.x} cy={f.y} r={lw * 2.2} fill={col} stroke="none" />
              </g>
            ) : (f.kind === 'ac' || f.kind === 'trapdoor') ? (
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
                ) : (
                  <line x1={f.x} y1={f.y - f.h / 2} x2={f.x} y2={f.y - f.h / 2 + Math.min(f.w, f.h) * 0.28}
                    stroke={col} strokeWidth={lw * 1.8} />
                )}
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
                grab near its centre feels like it is dodging you. */}
            {objMode && f.source === 'placed' && (
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
                  <rect x={f.x - hw} y={f.y - hh} width={hw * 2} height={hh * 2}
                    fill="none" stroke={C.grip} strokeWidth={FW} />

                  {/* Rotate: a stem above the frame. Figma's invisible
                      just-outside-the-corner region is undiscoverable without a
                      hover cursor to teach it, so this one is drawn. */}
                  {rect && (
                    <g {...grab('rotate')}>
                      <line x1={f.x} y1={f.y - hh} x2={f.x} y2={f.y + stem}
                        stroke={C.grip} strokeWidth={FW} />
                      <circle cx={f.x} cy={f.y + stem} r={HS * 0.55} fill="#fff"
                        stroke={C.grip} strokeWidth={FW * 1.6} />
                    </g>
                  )}

                  {[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy], k) => (
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
                fontFamily="JetBrains Mono, monospace" fill={C.grip}>
                {objDragMode === 'rotate'
                  ? `${Math.round(((f.rot || 0) * 180) / Math.PI)}\u00B0`
                  : rect
                    ? `${Math.round((f.w / (pxPerFt || 1)) * 304.8)} \u00D7 ${Math.round((f.h / (pxPerFt || 1)) * 304.8)}`
                    : `${Math.round((R0 * 2 / (pxPerFt || 1)) * 304.8)} \u2300`}
              </text>
            )}

            {fansPx.length > 1 && layers.labels && (
              <text x={f.x + (rect ? f.w / 2 : R0) + CL + lw * 3} y={f.y - (rect ? f.h / 2 : R0) * 0.6} fontSize={(pxPerFt || 12) * 0.5}
                fontFamily="JetBrains Mono, monospace" fill={col} opacity="0.8">
                {(f.kind || 'fan').slice(0, 1).toUpperCase()}{i + 1}
              </text>
            )}
          </g>
        );
      })}

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
      {layers.accents && accents.map((a) => {
        const w = a.rect.x1 - a.rect.x0, h = a.rect.y1 - a.rect.y0;
        const dim = a.rejected ? 0.35 : 1;
        const accSel = a.id === selAccId;
        // Constant on screen, like every other control. See the ceiling-object
        // handles for the argument.
        const AH = (Math.max(width, height) / 155) / (zoom || 1);
        const AFW = (Math.max(width, height) / 1500) / (zoom || 1);
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
        return (
          <g key={a.id} opacity={dim}>
            {/* The box behind the fitting is the working, and it is worth seeing
                — a run half the length of the wardrobe is a bug you can only
                catch by looking at both. But a rule-derived sconce's box is
                NOMINAL: it was synthesised round a point that came from the
                bed's geometry, so drawing it claims an extent the fitting does
                not have, straddling the wall. Shown for a strip, whose box is
                the real furniture; hidden for a sconce that came from a rule. */}
            {accSel && a.run && (
              <line x1={a.run[0].x} y1={a.run[0].y} x2={a.run[1].x} y2={a.run[1].y}
                stroke={C.grip} strokeWidth={AFW * 5} strokeLinecap="round" opacity="0.28" />
            )}
            {!(a.type === 'sconce' && a.side) && (
              <rect x={a.rect.x0} y={a.rect.y0} width={w} height={h}
                fill={a.colour} fillOpacity={a.rejected ? 0.05 : 0.07}
                stroke={a.colour} strokeWidth={lw * 1.4} strokeOpacity={a.rejected ? 0.8 : 0.4}
                strokeDasharray={`${lw * 4} ${lw * 4}`} rx={lw * 2} />
            )}

            {/* the run: a strip, with the ends the object gave it */}
            {a.run && (() => {
              const [p0, p1] = a.run;
              const L = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
              // The end caps are perpendicular ticks, so a run reads as having
              // a definite start and stop rather than fading into the wall.
              const nx = -(p1.y - p0.y) / L, ny = (p1.x - p0.x) / L;
              const t = lw * 4;
              return (
                <g>
                  <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y}
                    stroke={a.colour} strokeWidth={lw * 4.5} strokeLinecap="round" />
                  {[p0, p1].map((p, i) => (
                    <line key={i} x1={p.x - nx * t} y1={p.y - ny * t}
                      x2={p.x + nx * t} y2={p.y + ny * t}
                      stroke={a.colour} strokeWidth={lw * 1.8} strokeLinecap="round" />
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
                a white ground so it stays legible on top of the plan's own line
                work. */}
            {SG && (() => {
              const { R, arm, ix, iy, ux, uy, cx, cy } = SG;
              return (
                <g>
                  <circle cx={cx} cy={cy} r={R} fill="#fff" />
                  <g stroke={a.colour} strokeWidth={lw * 1.8} strokeLinecap="round">
                    {/* the stem: from the wall, through the circle, out the far side */}
                    <line x1={a.point.x} y1={a.point.y}
                      x2={cx + ix * arm} y2={cy + iy * arm} />
                    {/* the cross bar, lying along the wall */}
                    <line x1={cx - ux * arm} y1={cy - uy * arm}
                      x2={cx + ux * arm} y2={cy + uy * arm} />
                  </g>
                  <circle cx={cx} cy={cy} r={R} fill="none"
                    stroke={a.colour} strokeWidth={lw * 2.1} />
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
            {a.run && onAccPointerDown && !a.rejected && (
              <g>
                <line x1={a.run[0].x} y1={a.run[0].y} x2={a.run[1].x} y2={a.run[1].y}
                  stroke="transparent" strokeWidth={AH * 1.6} strokeLinecap="round"
                  className="hit" style={{ cursor: 'move' }}
                  onPointerDown={(ev) => onAccPointerDown(ev, a.roomId, a.id, 'move')} />
                {accSel && a.run.map((q, k) => (
                  <rect key={k} x={q.x - AH / 2} y={q.y - AH / 2} width={AH} height={AH}
                    rx={AH * 0.18} fill="#fff" stroke={C.grip} strokeWidth={AFW * 1.6}
                    className="hit" style={{ cursor: 'move' }}
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

      {/* --- task surfaces ---------------------------------------------------
          FOUND, NOT LIT. Nothing has been placed on these — they are a reading
          of the plan, drawn so the reading can be judged before anything is
          built on it. So they are a plain box with corner ticks and no fitting
          symbol of any kind: the drawing should not imply a decision that has
          not been taken.

          Under the accent layer and under the lights, because it is the layer
          with the least committed to it. */}
      {layers.surfaces && surfaces.map((sf) => {
        const w = sf.rect.x1 - sf.rect.x0, h = sf.rect.y1 - sf.rect.y0;
        const tick = Math.min(w, h) * 0.24;
        const { x0, y0, x1, y1 } = sf.rect;
        return (
          <g key={sf.id} opacity={0.5 + 0.5 * (sf.confidence ?? 0.7)}>
            <rect x={x0} y={y0} width={w} height={h} rx={lw * 2}
              fill={sf.colour} fillOpacity="0.09"
              stroke={sf.colour} strokeWidth={lw * 1.4}
              strokeDasharray={`${lw * 5} ${lw * 4}`} />
            <g stroke={sf.colour} strokeWidth={lw * 2.4} fill="none" strokeLinecap="round">
              <path d={`M${x0},${y0 + tick} L${x0},${y0} L${x0 + tick},${y0}`} />
              <path d={`M${x1 - tick},${y0} L${x1},${y0} L${x1},${y0 + tick}`} />
              <path d={`M${x1},${y1 - tick} L${x1},${y1} L${x1 - tick},${y1}`} />
              <path d={`M${x0 + tick},${y1} L${x0},${y1} L${x0},${y1 - tick}`} />
            </g>
          </g>
        );
      })}

      {/* --- the secondary grid ----------------------------------------------
          INVISIBLE BY DEFAULT, and off in the layer list. It is not a thing on
          the drawing — it is the reasoning behind where a spot went, which is
          worth being able to switch on when a spot lands somewhere surprising
          and worth being absent the rest of the time. */}
      {layers.secondary && taskSpots.map((sp) => sp.grid && (
        <g key={'sg' + sp.id} opacity="0.5">
          {sp.grid.lines.map((l, i) => (
            <line key={i} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y}
              stroke="#0A0A0A" strokeWidth={lw * 0.8} opacity="0.55" />
          ))}
          {sp.segment && (
            <line x1={sp.segment.a.x} y1={sp.segment.a.y}
              x2={sp.segment.b.x} y2={sp.segment.b.y}
              stroke={C.small} strokeWidth={lw * 3} opacity="0.35" strokeLinecap="round" />
          )}
        </g>
      ))}

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
        // The arrow starts at the rim, not the centre, so the body of the
        // fitting stays a clean circle and the tail cannot be mistaken for a
        // conduit run back to it.
        const x0 = sp.x + ux * R * 1.15, y0 = sp.y + uy * R * 1.15;
        const x1 = sp.x + ux * R * 3.5, y1 = sp.y + uy * R * 3.5;
        const head = R * 1.05;
        const nx = -uy, ny = ux;
        return (
          <g key={sp.id}>
            <circle cx={sp.x} cy={sp.y} r={R} fill="#fff"
              stroke={C.small} strokeWidth={lw * 2} />
            <circle cx={sp.x} cy={sp.y} r={R * 0.4} fill={C.small} />
            <line x1={x0} y1={y0} x2={x1} y2={y1}
              stroke={C.small} strokeWidth={lw * 1.9} strokeLinecap="round" />
            <path d={`M${x1},${y1} L${x1 - ux * head + nx * head * 0.55},${y1 - uy * head + ny * head * 0.55}`
                   + ` L${x1 - ux * head - nx * head * 0.55},${y1 - uy * head - ny * head * 0.55} Z`}
              fill={C.small} />
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
                fontFamily="JetBrains Mono, monospace" fill={C.guide} opacity="0.85">
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
        const col = t.colour;
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
