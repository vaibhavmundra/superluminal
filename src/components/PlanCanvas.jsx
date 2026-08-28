import React, { forwardRef, useState } from 'react';
import { guideLine } from '../lib/snapGuides.js';
import { CEILING_BY_ID, isRect } from '../lib/ceilingObjects.js';
import { specsFor, runMetres } from '../lib/boq.js';
import { STRIP_STYLE } from '../lib/settings.js';

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

// THE DRAWING IS INK. THE ACCENT IS STATE.
//
// This was seven hues — indigo grid, green outline, red fans, amber zones, a
// magenta guide — and each of them was saying a second time what the symbol
// already said. A downlight is a circle, a large light is a bigger circle with
// a ring, a sconce is a crosshair on a wall, a spot has an arrow, a strip is a
// run with end caps, a fan is a blade circle. None of that needs a colour to be
// read, and spending the palette on it left nothing to say the one thing shape
// cannot: WHICH OF THESE AM I TOUCHING.
//
// So the drawing is an ink scale — the plan underneath in grey, our own line
// work in black, structure and annotation in between — and #0070F3 belongs to
// selection, hover, grips and guides. A blue element on this canvas is always a
// statement about state, never about type.
const C = {
  // our line work, heaviest to lightest
  ink: '#000000',
  region: '#000000',      // the space outline: the strongest thing we draw
  // THE FITTINGS ARE THE ACCENT, and this is the second considered exception to
  // "blue is state" — the first being the space fills on the tracer.
  //
  // The rule was written for a screen where the accent had one job and every
  // symbol could speak for itself. It still holds for the plan: walls, outlines
  // and dimensions are ink. But this drawing has a SUBJECT, and it is the
  // lights. On a finished layout the plan is the ground and the fittings are
  // the figure, and rendering the figure in the same black as the ground meant
  // forty downlights disappearing into somebody else's line work — the one
  // thing on the sheet the reader came for, drawn as if it were part of the
  // furniture. Blue on this canvas now means "this is ours and it emits light";
  // selection and guides are still blue too, and they are told apart by
  // behaviour — a grip is a handle you can grab, a fitting is a symbol.
  lit: '#0070F3',
  // The travelling pulse. LIGHTER, not brighter: the band sits under the dots,
  // so it has to read as the tape glowing rather than as a second line crossing
  // the first.
  pulse: '#7FB9FF',
  large: '#0070F3',
  small: '#0070F3',
  grid: '#C8C8C8',        // the grid is scaffolding, not drawing
  cell: '#D8D8D8',
  fan: '#404040',         // an obstacle is somebody else's object
  zone: '#737373',        // ...and so is a no-light zone
  measure: '#000000',
  faint: '#B8B8B8',       // debug overlays, the secondary grid
  // Controls are not drawing. Selection frames, grips and alignment guides are
  // UI that happens to be rendered in the drawing's coordinate space, so they
  // take the accent — and now that nothing else on the canvas is blue, the
  // accent means exactly one thing.
  grip: '#0070F3',
  guide: '#0070F3',
  sel: '#0070F3',
};

const PlanCanvas = forwardRef(function PlanCanvas(
  { src, vector = null, wallLayers = null,
    width, height, plans = [], focusId = null, selectedId = null,
    fansPx = [], pxPerFt, layers, zoom, measure, onCanvasClick, toPx,
    zones = [], draftZone = null, zoneMode = false, onZoneDown, onZoneMove, onZoneUp,
    accents = [], objMode = false, selObjId = null, onObjPointerDown,
    objDragMode = null, guides = [], ghost = null, clearanceFt = 2,
    selAccId = null, onAccPointerDown, surfaces = [], taskSpots = [],
    // THE AUDIT LAYER — off for everybody except an owner of this app. See the
    // block near the bottom of this file for what it draws and why the marks it
    // restores were removed from the drawing proper.
    audit = false, auditZones = [],
    onFixture = null, draftRun = null,
    placeSnap = null, sconceGhost = null, cursor = null },
  ref
) {
  // WHICH FITTING IS WARM. Local, because nothing outside this file needs to
  // know — the tooltip is told separately through `onFixture`, and what it
  // needs is a screen position this component would otherwise have to invent.
  const [hot, setHot] = useState(null);
  /**
   * The hover contract for one fitting: warm its stroke and hand the tooltip
   * enough to draw itself. Enter and leave only — following the pointer with
   * mousemove made the card jitter under the cursor and told nobody anything
   * they did not already have.
   */
  const feel = (id, spec) => ({
    onMouseEnter: (e) => {
      setHot(id);
      if (spec) onFixture?.({ ...spec, x: e.clientX, y: e.clientY });
    },
    onMouseLeave: () => {
      setHot((h) => (h === id ? null : h));
      onFixture?.(null);
    },
    style: { cursor: 'pointer' },
  });

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

        {/* THE GLOW UNDER A FITTING, AS A GRADIENT AND NOT A BLUR.
            A feGaussianBlur over a solid disc is the literal reading of "a
            blurred circle", and it is the wrong tool three times over: the blur
            radius is in user units so it needs a different filter for a small
            and a large downlight, filters are re-rasterised on every frame of
            an animation and there are forty of these on a plan, and a blurred
            disc still has a solid core with a soft rim — which reads as a
            smudge rather than as light. A radial gradient falls off from the
            middle the whole way out, costs nothing to animate, and is what a
            pool of light actually looks like from above. */}
        {/* THE GLOW UNDER A STRIP. A run is a line, so the downlights' radial
            gradient is the wrong shape for it — what a strip throws is a band,
            brightest on the tape and falling off to either side. A real
            Gaussian blur on a thick line gives exactly that, and the objection
            that killed the idea for the downlights does not apply here: the
            blur radius is in user units, and there is one line weight per
            sheet, so one filter serves every strip on the plan. There are also
            a handful of strips rather than forty downlights, which is the
            difference between a filter being affordable and not. */}
        {/* userSpaceOnUse, AND THAT IS A BUG FIX, NOT A PREFERENCE.
            A filter region given in percentages is relative to the filtered
            element's OWN BOUNDING BOX, and a horizontal or vertical line has a
            bounding box with zero height or zero width. `height="900%"` of zero
            is zero, so the region collapses and the renderer improvises: the
            blurred band came out with a one-tile-wide white notch in it that
            MOVED as the stroke width animated, which looks exactly like a
            deliberate spark travelling down the run and is nothing of the sort.
            It only appeared while the glow was animating, which is what made it
            look like our own animation misbehaving rather than a filter region
            being degenerate.
            An explicit region in user space cannot collapse. The plan's own
            extent plus a margin for the blur covers every strip on the sheet,
            and one filter serves them all because there is one line weight per
            drawing. */}
        <filter id="lp-strip-glow" filterUnits="userSpaceOnUse"
          x={-lw * 60} y={-lw * 60}
          width={width + lw * 120} height={height + lw * 120}>
          <feGaussianBlur stdDeviation={lw * STRIP_STYLE.glowBlur} />
        </filter>

        <radialGradient id="lp-glow">
          <stop offset="0%" stopColor={C.lit} stopOpacity="0.42" />
          <stop offset="45%" stopColor={C.lit} stopOpacity="0.20" />
          <stop offset="100%" stopColor={C.lit} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* The plan underneath. A raster plan is an image; a DXF is its own line
          work, drawn one path per layer — the layers being read as walls in
          black, everything else faint, so what the room outline was taken from
          stays visible under the layout. */}
      {layers.plan && (vector
        ? <g opacity={layers.dim ? 0.5 : 1}>
            <g fill="none" stroke="#9E9E9E" strokeWidth={lw * 1.1} opacity="0.5">
              {vector.filter((l) => !wallLayers?.has(l.layer))
                     .map((l) => <path key={l.layer} d={l.path} />)}
            </g>
            <g fill="none" stroke="#4A4A4A" strokeWidth={lw * 1.6} opacity="0.85">
              {vector.filter((l) => wallLayers?.has(l.layer))
                     .map((l) => <path key={l.layer} d={l.path} />)}
            </g>
            {vector.flatMap((l) => l.circles.map((c, k) => (
              <circle key={l.layer + k} cx={c.cx} cy={c.cy} r={c.r}
                fill="none" stroke="#9E9E9E" strokeWidth={lw} opacity="0.5" />
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
          {layers.region && (
            <polygon points={points(r.plan.polygonPx)}
              fill="none" stroke={C.region}
              /* The room the panel is talking about is drawn heavier. With eight
                 outlines on one sheet, "which one is Bedroom 2" is otherwise a
                 question the drawing cannot answer. */
              strokeWidth={lw * (r.id === focusId && laid.length > 1 ? 3.6 : 2.4)}
              strokeLinejoin="round" />
          )}
          {/* THE SELECTED SPACE, and this is a different thing from the layer
              above. That one is the OUTLINE — scaffolding, off by default,
              ink-coloured because it is part of the drawing. This is SELECTION:
              blue because blue is state on this canvas, thin because it is not
              competing with the fittings, and drawn whether or not the outline
              layer is on. Without it, turning the outline off left the canvas
              with no way at all to say which space the panel was describing.
              `strokeSelected` and not a fill: a wash over the space would sit
              between the plan and the fittings and dull both. */}
          {r.id === selectedId && (
            <polygon points={points(r.plan.polygonPx)}
              className="lp-sel" fill="none" stroke={C.lit}
              strokeWidth={lw * 1.6} strokeLinejoin="round" pointerEvents="none" />
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
        // ALL ONE INK. A fan is a blade circle, a chandelier is a rosette, an
        // AC unit is a louvred rectangle and a trap door is a hatched square —
        // four unmistakable symbols that were also being given four hues.
        // THE ACCENT, HELD BACK. A fan, a cassette and a trap door are things
        // in this ceiling that are not ours, and they used to be drawn in a
        // dark grey that competed with the fittings for attention. They belong
        // to the same family as the lights — objects on the ceiling plane — so
        // they take the same hue, and then they are pulled back with opacity so
        // a downlight sitting near a fan still reads as the brighter mark. The
        // group's own opacity does it rather than a lighter colour, because a
        // washed-out blue on a white plan and a washed-out blue over the fan's
        // dashed clearance circle are two different colours if you fake it.
        const col = C.lit;
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
          <g key={f.id ?? 'fan' + i}
            opacity={(objMode && !sel && f.source === 'placed' ? 0.75 : 1) * (sel ? 1 : 0.55)}>
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
                fontFamily="The Neue Montreal, sans-serif" fill={C.grip}>
                {objDragMode === 'rotate'
                  ? `${Math.round(((f.rot || 0) * 180) / Math.PI)}\u00B0`
                  : rect
                    ? `${Math.round((f.w / (pxPerFt || 1)) * 304.8)} \u00D7 ${Math.round((f.h / (pxPerFt || 1)) * 304.8)}`
                    : `${Math.round((R0 * 2 / (pxPerFt || 1)) * 304.8)} \u2300`}
              </text>
            )}

            {fansPx.length > 1 && layers.labels && (
              <text x={f.x + (rect ? f.w / 2 : R0) + CL + lw * 3} y={f.y - (rect ? f.h / 2 : R0) * 0.6} fontSize={(pxPerFt || 12) * 0.5}
                fontFamily="The Neue Montreal, sans-serif" fill={col} opacity="0.8">
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
          {r.plan.lightsPx.map((l, li) => {
            // THE SYMBOL IS SIZED BY THE PRODUCT, NOT BY THE GEOMETRY. A
            // toilet's grid light is the same `kind: 'small'` as a bedroom's —
            // one per cell — but it is a 5 W 30-degree lamp rather than a 7 W
            // 36-degree one, and a drawing on which two different fittings are
            // the same circle is a drawing the person ordering them cannot use.
            // 20% smaller, which is enough to read as deliberate next to a
            // standard downlight and not so much that it reads as a spot.
            const fx = l.fixture || l.kind;
            const R = (l.kind === 'large' ? 0.52 : 0.3)
              * (fx === 'small-narrow' ? 0.8 : 1) * s;
            const col = l.kind === 'large' ? C.large : C.small;
            const warm = hot === l.id;
            return (
              <g key={l.id} {...feel(l.id, specsFor(fx))}>
                {/* THE POOL OF LIGHT. Under the symbol, wider than it, and
                    breathing. The stagger is deliberate and it is the whole
                    difference between a lit ceiling and a blinking one: forty
                    discs pulsing on the same beat read as a single flashing
                    element, and forty on their own beats read as forty lamps.
                    A prime-ish multiplier keeps the pattern from settling into
                    rows, since the lights are laid out on a grid. */}
                <circle cx={l.x} cy={l.y} r={R * 2.6} fill="url(#lp-glow)"
                  className="lp-pulse" pointerEvents="none"
                  style={{ animationDelay: `${((li * 137) % 1000) / 1000 * -2.8}s` }} />
                {l.kind === 'large' && (
                  <circle cx={l.x} cy={l.y} r={R * 1.9} fill={col} opacity="0.07" />
                )}
                {/* `.hit` ON THE CIRCLE, NOT ON THE GROUP. Everything inside
                    `.plan` is inert by default — see the note in styles.css,
                    and the three bugs that earned it — and each shape carries
                    its own `pointer-events:none` from an element rule. An
                    inherited `all` from a `.hit` group loses to that, so the
                    class goes on the shape the pointer is meant to find. The
                    glow keeps its inline `none`: it is 2.6× the fitting's
                    radius, and making that live would have one downlight
                    swallowing the clicks meant for its neighbours. */}
                <circle className="hit" cx={l.x} cy={l.y} r={R}
                  fill={l.kind === 'large' ? col : '#fff'}
                  stroke={col} strokeWidth={lw * (warm ? 3.1 : 1.7)} />
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
                    fontFamily="The Neue Montreal, sans-serif" fill={col} opacity="0.75">
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
      {layers.accents && accents.map((a, ai) => {
        const w = a.rect.x1 - a.rect.x0, h = a.rect.y1 - a.rect.y0;
        const dim = a.rejected ? 0.35 : 1;
        const accSel = a.id === selAccId;
        // ONE COLOUR FOR EVERYTHING THAT EMITS. `a.colour` was set per accent
        // type back when a strip was red and a sconce amber; the type is
        // already in the symbol — a run with end caps, a crosshair on a wall —
        // so the hue was spare, and it is spent on "this is a light" instead.
        const acol = C.lit;
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
          <g key={a.id} opacity={dim}
            {...feel(a.id, a.type === 'strip'
              ? specsFor('strip', { metres: runMetres(a, pxPerFt) })
              : specsFor('sconce'))}>
            {accSel && a.run && (
              <line x1={a.run[0].x} y1={a.run[0].y} x2={a.run[1].x} y2={a.run[1].y}
                stroke={C.grip} strokeWidth={AFW * 5} strokeLinecap="round" opacity="0.28" />
            )}
            {/* THE MODEL'S BOX IS NOT ON THE DRAWING ANY MORE.
                It was the region the accent detector marked — the wardrobe, the
                TV unit — drawn dashed behind the fitting so that what the model
                said and what the geometry did with it were both visible. That
                is a debugging view, and the right one while the placer was
                being written: a run half the length of the wardrobe is a bug
                you can only catch by looking at both.
                On a sheet somebody is handed it is a dashed rectangle round a
                piece of furniture, in the lights' own colour, beside the strip
                it produced — three marks where the drawing needs one. Same
                argument as the task-surface boxes and the same answer: the
                FITTING is the visible consequence, the region is working, and
                the region is still on the zone for anything that wants it.
                Only the lights show. */}

            {/* the run: a strip, with the ends the object gave it */}
            {a.run && (() => {
              const [p0, p1] = a.run;
              const L = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
              // The end caps are perpendicular ticks, so a run reads as having
              // a definite start and stop rather than fading into the wall.
              const nx = -(p1.y - p0.y) / L, ny = (p1.x - p0.x) / L;
              const t = lw * 4;
              // A DOTTED RUN THAT PULSATES, THE WAY A SPOT DOES.
              //
              // THREE VERSIONS OF A TRAVELLING PULSE WENT IN THE BIN BEFORE
              // THIS, and the reason they all failed is worth keeping. First:
              // walk the dots themselves by one dash cycle — seven pixels over
              // two seconds, which moved and could not be seen, and was
              // conceptually wrong anyway because the dots ARE the emitters and
              // emitters do not slide along their own tape. Second: a band of
              // lighter blue underneath, which at 3.8× the line weight was
              // invisible under 2.4× dots and at 7× read as the tape swelling
              // rather than as anything travelling. Third: one dot of white at
              // the run's own weight, shooting along in 900ms — legible,
              // correct on its own terms, and still wrong on the drawing,
              // because a white mark racing down a line is an ANIMATION and
              // everything else on this sheet is a fitting quietly breathing.
              //
              // So a strip does what a spot does: the glow under it swells and
              // fades on the same 2.8-second cycle, and the dots hold still.
              // One idiom for "this is on" across every fitting on the plan,
              // which is the thing the drawing was missing while the strips had
              // an idiom of their own. The stagger is the same trick the
              // downlights use — a per-fitting phase offset, so a plan reads as
              // several lamps rather than one blinking element.
              //
              // Every dimension comes from STRIP_STYLE in settings.js, and each
              // is a multiple of the sheet's line weight so the same numbers
              // describe this strip on a 900px sketch and a 6000px survey.
              const S = STRIP_STYLE;
              const boost = hot === a.id ? S.hoverBoost : 0;
              const dot = lw * S.dash, gapl = lw * S.gap;
              return (
                <g>
                  {/* THE GLOW BREATHES BY GETTING FATTER, NOT BY FADING.
                      Opacity alone was the first go at this and it did not read
                      as pulsating at all — a blurred band at 38% and the same
                      band at 62% look like the same band, because the blur has
                      already thrown most of its contrast away. A downlight's
                      halo works because it SCALES, and the strip's equivalent
                      of scaling is stroke-width: a line grows perpendicular to
                      its own axis, so the band gets wider and stays exactly as
                      long. `butt` caps rather than `round` for the same reason
                      — a round cap adds half the stroke width at each end, so a
                      breathing run with round caps would creep past its own end
                      caps twice a cycle. The two widths go in as custom
                      properties because they are multiples of the sheet's line
                      weight, which the stylesheet cannot know. */}
                  <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y}
                    stroke={acol} strokeWidth={lw * (S.glow + boost * 2)}
                    strokeLinecap="butt" opacity={S.glowOpacity}
                    filter="url(#lp-strip-glow)" pointerEvents="none"
                    className="lp-breathe"
                    style={{ '--lp-glow-o': S.glowOpacity,
                             '--lp-w0': `${lw * (S.glow + boost * 2) * (1 - S.glowSwell)}px`,
                             '--lp-w1': `${lw * (S.glow + boost * 2) * (1 + S.glowSwell)}px`,
                             animationDuration: `${S.pulseMs}ms`,
                             animationDelay: `${((ai * 137) % 1000) / 1000 * -S.pulseMs}ms`,
                             animationPlayState: hot === a.id ? 'paused' : 'running' }} />
                  <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y}
                    stroke={acol} strokeWidth={lw * (S.stroke + boost)}
                    strokeLinecap="round"
                    strokeDasharray={`${dot} ${gapl}`}
                    className="lp-flow hit" />
                  {/* SMALL SQUARE END CAPS. They were perpendicular ticks at
                      grip size, which is precisely what a grip looks like — so
                      people tried to drag them. A small square says "the run
                      stops here" and says nothing about being draggable; the
                      actual handles are bigger, white-filled and appear on
                      hover or selection. */}
                  {[p0, p1].map((q, i) => (
                    <rect key={i} x={q.x - lw * S.cap / 2} y={q.y - lw * S.cap / 2}
                      width={lw * S.cap} height={lw * S.cap}
                      fill={acol} pointerEvents="none" />
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
                  <g stroke={acol} strokeWidth={lw * 1.8} strokeLinecap="round">
                    {/* the stem: from the wall, through the circle, out the far side */}
                    <line x1={a.point.x} y1={a.point.y}
                      x2={cx + ix * arm} y2={cy + iy * arm} />
                    {/* the cross bar, lying along the wall */}
                    <line x1={cx - ux * arm} y1={cy - uy * arm}
                      x2={cx + ux * arm} y2={cy + uy * arm} />
                  </g>
                  <circle className="hit" cx={cx} cy={cy} r={R} fill="none"
                    stroke={acol} strokeWidth={lw * (hot === a.id ? 3.4 : 2.1)} />
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
                {/* ON HOVER AS WELL AS ON SELECTION. A run you can drag but
                    whose handles only appear once you have already clicked it
                    is a run that looks fixed until you guess otherwise. The
                    pointer being on it is enough of a question to answer. */}
                {(accSel || hot === a.id) && a.run.map((q, k) => (
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
            fontSize={s * 0.8} fontFamily="The Neue Montreal, sans-serif"
            fill={C.region} opacity="0.65">{r.name || 'Space'}</text>
        );
      })}

      {/* --- THE AUDIT LAYER ------------------------------------------------
          What the models decided, drawn over the plan for the person tuning
          them. Everything here was on the drawing once and was deliberately
          removed — see the two notes below — so this does not reinstate it; it
          gates it behind a role.
          
          MAGENTA, AND NOT THE ACCENT. Every other mark on this canvas obeys the
          ink-and-one-blue rule, and the whole point of this layer is that it is
          NOT part of the drawing: it has to be unmistakable at a glance, and it
          has to be obvious in a screenshot that what is being looked at is
          working rather than a sheet. A hue that appears nowhere else does both.
          It is the only place in this app where that is the right answer. */}
      {audit && (
        <g className="audit">
          {/* The beds. These are the one reading with no visible consequence
              anywhere else on the sheet: the planner obeys them — a downlight
              never lands over a mattress — but `drawnZones` deliberately
              excludes them, so a wrong bed is invisible unless you know to look
              for the hole it left in the grid. */}
          {auditZones.map((z, i) => (
            <g key={'az' + i}>
              <rect x={z.x0} y={z.y0} width={z.x1 - z.x0} height={z.y1 - z.y0}
                fill="#C026D3" fillOpacity="0.06" stroke="#C026D3"
                strokeWidth={lw * 1.6} strokeDasharray={`${lw * 4} ${lw * 3}`} />
              <text x={z.x0 + lw * 3} y={z.y0 - lw * 2} fill="#C026D3"
                fontSize={Math.max(width, height) / 130} fontFamily="The Neue Montreal, sans-serif">
                bed
              </text>
            </g>
          ))}
          {/* The task surfaces, with the box the detector marked. The spot that
              came out of it is already on the drawing; this is the evidence
              behind it. */}
          {surfaces.map((sf) => {
            if (!sf.rect) return null;
            const r = sf.rect;
            return (
              <g key={'as' + sf.id} opacity={sf.rejected ? 0.35 : 1}>
                <rect x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0}
                  fill="#C026D3" fillOpacity="0.05" stroke="#C026D3"
                  strokeWidth={lw * 1.6} strokeDasharray={`${lw * 6} ${lw * 3}`} />
                <text x={r.x0 + lw * 3} y={r.y0 - lw * 2} fill="#C026D3"
                  fontSize={Math.max(width, height) / 130} fontFamily="The Neue Montreal, sans-serif">
                  {sf.label || sf.type || 'surface'}{sf.rejected ? ' (rejected)' : ''}
                </text>
              </g>
            );
          })}
        </g>
      )}

      {/* --- task surfaces: FOUND, AND NO LONGER DRAWN -----------------------
          They were a dashed box with corner ticks — a reading of the plan, put
          on screen so the reading could be judged before anything was built on
          it. That was the right call while the surface detector was the thing
          being debugged. On a finished layout it is a box around a dining table
          saying "we noticed the dining table", drawn over the drawing that
          already shows one, and the fitting it justifies is three feet away
          with its own arrow pointing at it. The spot IS the visible consequence
          of the surface; the surface itself is working, and working belongs in
          the console. `surfaces` is still a prop and still feeds the spots. */}

      {/* --- the secondary grid: REASONING, AND NOT ON THE DRAWING -----------
          The lines a spot was placed on. It was already off by default and in
          the layer list for the times a spot lands somewhere surprising; with
          the surfaces themselves gone from the canvas it is the last piece of
          the spot placer's working still able to appear on a client's sheet, so
          it goes the same way. `sp.grid` is still computed and still in the
          console, which is where working belongs. */}

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
        // WHAT IT IS LIGHTING, ON HOVER. The task surfaces came off the drawing
        // because a dashed box round a dining table is working, not design —
        // but the question "why is this spot here, and aimed at what" is a fair
        // one to ask of any fitting, and the arrow alone answers only half of
        // it. Under the pointer is the right moment: it is asked about one
        // fitting at a time, and it costs the sheet nothing the rest of the
        // time.
        const surf = hot === sp.id ? surfaces.find((sf) => sf.id === sp.surfaceId) : null;
        return (
          <g key={sp.id} {...feel(sp.id, specsFor('spot'))}>
            {surf && (
              <g pointerEvents="none">
                <rect x={surf.rect.x0} y={surf.rect.y0}
                  width={surf.rect.x1 - surf.rect.x0} height={surf.rect.y1 - surf.rect.y0}
                  rx={lw * 2} fill={C.lit} fillOpacity="0.10"
                  stroke={C.lit} strokeWidth={lw * 1.4} strokeOpacity="0.55"
                  strokeDasharray={`${lw * 5} ${lw * 4}`} />
                {/* The line from the fitting to what it is for. The arrow
                    already points this way; the tether says how far. */}
                <line x1={sp.x} y1={sp.y} x2={sp.target.x} y2={sp.target.y}
                  stroke={C.lit} strokeWidth={lw} strokeOpacity="0.4"
                  strokeDasharray={`${lw * 2} ${lw * 3}`} />
              </g>
            )}
            <circle cx={sp.x} cy={sp.y} r={R * 2.4} fill="url(#lp-glow)"
              className="lp-pulse" pointerEvents="none"
              style={{ animationDelay: `${((sp.x | 0) % 1000) / 1000 * -2.8}s` }} />
            <circle className="hit" cx={sp.x} cy={sp.y} r={R} fill="#fff"
              stroke={C.small} strokeWidth={lw * (hot === sp.id ? 3.4 : 2)} />
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
                fontFamily="The Neue Montreal, sans-serif" fill={C.guide} opacity="0.85">
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

      {/* THE RUN BEING SPANNED. Between the strip tool's first click and its
          second there is a fitting that has a start and no end, and the only
          place that fact can live is on the drawing. Drawn in the strip's own
          dotted idiom rather than as a plain rubber band, so what you are
          dragging out looks like what you will get — and with the length beside
          it, because "is that long enough for the wardrobe" is the question
          being answered in that second. */}
      {draftRun && (() => {
        const [a, b] = draftRun;
        const L = Math.hypot(b.x - a.x, b.y - a.y);
        return (
          <g pointerEvents="none">
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={C.lit} strokeWidth={lw * 4.8} strokeLinecap="round"
              strokeDasharray={`${lw * 3.2} ${lw * 3.4}`} opacity="0.75" />
            <circle cx={a.x} cy={a.y} r={lw * 3.4} fill={C.lit} />
            {pxPerFt > 0 && L > lw * 8 && (
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - lw * 8}
                fontSize={Math.max(width, height) / 120} textAnchor="middle"
                fontFamily="The Neue Montreal, sans-serif" fill={C.lit}>
                {(L / pxPerFt).toFixed(1)} ft
              </text>
            )}
          </g>
        );
      })()}

      {/* --- WHAT A CLICK WOULD DO, while a fitting is being placed ---------
          Drawn last, over everything, because it is the answer to a question
          being asked right now and it stops existing the moment it is answered.

          THE SNAP INDICATOR IS THE SAME PROMISE THE TRACER MAKES. A run placed
          a hair off the wall it is concealed behind is as wrong as an outline
          corner placed a hair off, so the cursor holds on to the same geometry
          — and having caught something, it has to SAY so, or a click that
          quietly moved four inches looks like a misclick. */}
      {placeSnap && placeSnap.kind && placeSnap.kind !== 'free' && (() => {
        const R = Math.max(width, height) / 190;
        return (
          <g pointerEvents="none">
            {placeSnap.guide && (
              <line
                x1={placeSnap.guide.from.x} y1={placeSnap.guide.from.y}
                x2={placeSnap.guide.axis === 'x' ? placeSnap.x : placeSnap.guide.from.x}
                y2={placeSnap.guide.axis === 'x' ? placeSnap.guide.from.y : placeSnap.y}
                stroke={C.guide} strokeWidth={lw} opacity="0.9"
                strokeDasharray={`${lw * 3} ${lw * 3}`} />
            )}
            {/* A DIAMOND FOR AN EDGE, A SQUARE FOR AN END, A RING OTHERWISE —
                the tracer's alphabet, because "it snapped" is not the useful
                information and WHAT it snapped to is. */}
            {placeSnap.kind === 'edge' ? (
              /* A diamond: the square offset onto its own centre, then turned
                 about that same point. Rotating about the rect's x/y instead
                 swings it a half-width off the snap it is supposed to mark. */
              <rect x={placeSnap.x - R / 2} y={placeSnap.y - R / 2} width={R} height={R}
                transform={`rotate(45 ${placeSnap.x} ${placeSnap.y})`}
                fill="#fff" stroke={C.guide} strokeWidth={lw * 1.6} />
            ) : (placeSnap.kind === 'end' || placeSnap.kind === 'vertex') ? (
              <rect x={placeSnap.x - R / 2} y={placeSnap.y - R / 2} width={R} height={R}
                fill="#fff" stroke={C.guide} strokeWidth={lw * 1.6} />
            ) : (
              <circle cx={placeSnap.x} cy={placeSnap.y} r={R * 0.6}
                fill="#fff" stroke={C.guide} strokeWidth={lw * 1.6} />
            )}
          </g>
        );
      })()}

      {/* THE SCONCE, BEFORE IT IS PLACED. Not a marker at the cursor: the whole
          point of this fitting is that it seats itself on a wall, so a preview
          at the pointer would show something that is never what lands. This is
          the output of `placeZone` — the same function the click runs — drawn
          faint, so what you see move along the wall as the pointer moves IS the
          fitting. */}
      {sconceGhost && (() => {
        const R = Math.max((pxPerFt || 12) * 0.3, lw * 3);
        const { x: ix, y: iy } = sconceGhost.inward;
        const ux = sconceGhost.along?.x ?? -iy, uy = sconceGhost.along?.y ?? ix;
        const cx = sconceGhost.point.x + ix * R * 2.6;
        const cy = sconceGhost.point.y + iy * R * 2.6;
        const arm = R * 1.7;
        return (
          <g pointerEvents="none" opacity="0.55">
            {sconceGhost.wall && (
              <line x1={sconceGhost.wall.a.x} y1={sconceGhost.wall.a.y}
                x2={sconceGhost.wall.b.x} y2={sconceGhost.wall.b.y}
                stroke={C.guide} strokeWidth={lw} opacity="0.7"
                strokeDasharray={`${lw * 4} ${lw * 4}`} />
            )}
            <circle cx={cx} cy={cy} r={R} fill="#fff" />
            <g stroke={C.lit} strokeWidth={lw * 1.8} strokeLinecap="round">
              <line x1={sconceGhost.point.x} y1={sconceGhost.point.y}
                x2={cx + ix * arm} y2={cy + iy * arm} />
              <line x1={cx - ux * arm} y1={cy - uy * arm}
                x2={cx + ux * arm} y2={cy + uy * arm} />
            </g>
            <circle cx={cx} cy={cy} r={R} fill="none"
              stroke={C.lit} strokeWidth={lw * 2.1} />
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
