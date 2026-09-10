import { useMemo } from 'react';
import { colourFor, heatmapOpacity } from './colours.js';

// ---------------------------------------------------------------------------
// HeatmapOverlay — THE FIELD, PAINTED. It draws and computes nothing.
//
// ONE <image> PER ROOM AND NOT ONE <rect> PER CELL, and the reason is both
// pictures and node counts. A 40 sqm room at 35 cm is 330 cells; a floor plan
// is eight rooms; two and a half thousand rects with individual fills is a lot
// of DOM for a layer that is switched on and off, and every one of them is a
// hard-edged square. An image of one pixel per cell, stretched over the room's
// own box, is one node — and the browser's own bilinear scaling is what turns
// the grid into the smooth field the reading actually is. Nobody wants to read
// a 35 cm mosaic; the samples are 35 cm apart, the light is not.
//
// IT IS A CHILD OF THE DRAWING'S OWN <svg>, WHICH IS WHAT ALIGNS IT. The canvas
// zooms by scaling that element against a fixed viewBox, so a box given in plan
// pixels is in register with every fitting on the sheet at every zoom, with no
// transform for this layer to reproduce and nothing to get out of step. See the
// note at the head of PlanCanvas about the <svg> and `zoom`.
//
// AND IT NEVER TAKES A POINTER. `pointerEvents: 'none'` on the group: selection,
// dragging, panning and zooming all reach through it untouched, which is the
// whole difference between an overlay and a sheet of glass over the drawing.
// ---------------------------------------------------------------------------

/**
 * HOW FAR THE EDGE COLOUR IS PUSHED OUT PAST THE OUTLINE, in cells.
 *
 * WITHOUT THIS THE ROOM GETS A PALE RIM AND IT LOOKS LIKE A BUG. The cells
 * outside the outline have no value, so they are transparent — and a browser
 * scaling the image smoothly blends that transparency INWARDS, so the outermost
 * half-cell of real floor fades out. The clip path is what defines the edge;
 * these rings only make sure there is colour to clip. Two is enough for any
 * scale factor a plan is drawn at.
 */
const BLEED = 2;

/**
 * THE FIELD AS A DATA URI. One pixel per cell, RGBA.
 *
 * A CANVAS AND NOT AN SVG PATTERN OR A PILE OF RECTS: `putImageData` writes the
 * whole field in one pass and `toDataURL` hands back something an <image> can
 * take, which is a few hundred bytes for a room. It costs a canvas element per
 * solve, which is why it is a memo on the field and the palette rather than
 * something the render does.
 *
 * `null` WHERE THERE IS NO DOCUMENT OR NO PALETTE. The palette is read off the
 * stylesheet and this file holds no colours of its own — see colours.js — so a
 * missing palette draws nothing rather than something invented.
 */
function fieldImage(room, palette) {
  if (!palette || typeof document === 'undefined') return null;
  const { nx, ny, ratio } = room;
  if (!(nx > 0) || !(ny > 0)) return null;
  const cv = document.createElement('canvas');
  cv.width = nx; cv.height = ny;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(nx, ny);
  const px = img.data;

  /* --- THE BLEED, AS A NEAREST-LIVE-NEIGHBOUR FILL ------------------------
     EACH RING TAKES THE MEAN OF WHATEVER LIVE CELLS TOUCH IT, and then counts as
     live for the next ring. It is two passes over the box and it is doing one
     job: putting a colour outside the outline so that the smooth scale has
     something to blend with other than transparency. What the reader sees at the
     edge is decided by the clip path, not by this. */
  const val = new Float32Array(ratio);
  for (let ring = 0; ring < BLEED; ring++) {
    const add = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (!Number.isNaN(val[k])) continue;
        let s = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const jj = j + dj, ii = i + di;
            if (jj < 0 || jj >= ny || ii < 0 || ii >= nx) continue;
            const v = val[jj * nx + ii];
            if (!Number.isNaN(v)) { s += v; n++; }
          }
        }
        if (n) add.push([k, s / n]);
      }
    }
    for (const [k, v] of add) val[k] = v;
  }

  for (let k = 0; k < val.length; k++) {
    const v = val[k];
    if (Number.isNaN(v)) continue;
    const c = colourFor(v, palette);
    if (!c) continue;
    const o = k * 4;
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}

const pointsOf = (pts) => pts.map((p) => `${p.x},${p.y}`).join(' ');

/**
 * `night` IS `layers.invert` AND IT CHANGES ONLY THE OPACITY.
 *
 * NOT THE COLOURS. Every other night decision on this canvas swaps a palette —
 * the fittings' ramp, the zone ink, the outline ink — because those are MARKS
 * and a mark has to be legible against its ground. This is not a mark, it is a
 * scale: the five bands mean five specific things, the legend states them, and a
 * heatmap whose green meant one ratio on paper and another at night would be
 * unreadable in the only way that matters. So the hues are the ground's
 * business in no way at all, and what changes is how much of the ground shows
 * through them. See `heatmapOpacity`.
 */
export default function HeatmapOverlay({ heatmap, night = false }) {
  const fields = heatmap?.on ? heatmap.rooms : null;
  const palette = heatmap?.palette ?? null;

  const images = useMemo(
    () => (fields ?? []).map((r) => ({ id: r.id, url: fieldImage(r, palette) })),
    [fields, palette]);

  if (!fields?.length || !palette) return null;

  return (
    <g pointerEvents="none" aria-hidden="true">
      <defs>
        {fields.map((r) => (
          /* A CLIP PATH OF ITS OWN AND NOT `roomclip-<i>`. The canvas's clips are
             indexed by position in a filtered list and are its business; borrowing
             one would tie this layer to that list's order, which is exactly the
             failure the note at the head of PlanCanvas describes. Keyed by room
             ID, which is unique on the sheet by construction. */
          <clipPath key={r.id} id={`heatclip-${r.id}`}>
            <polygon points={pointsOf(r.polygonPx)} />
          </clipPath>
        ))}
      </defs>
      {fields.map((r) => {
        const url = images.find((q) => q.id === r.id)?.url ?? null;
        if (!url) return null;
        const b = r.boxPx;
        return (
          <g key={r.id} clipPath={`url(#heatclip-${r.id})`}>
            <image href={url} x={b.x0} y={b.y0}
              width={b.x1 - b.x0} height={b.y1 - b.y0}
              /* STRETCHED EXACTLY ONTO THE BOX. Without this an image whose
                 aspect does not match the box is letterboxed inside it, and the
                 field would be drawn a foot or two from the floor it describes. */
              preserveAspectRatio="none"
              opacity={heatmapOpacity(night)}
              /* SMOOTH, WHICH IS THE WHOLE REASON THIS IS AN IMAGE. The samples
                 are a foot apart and the light between them is continuous;
                 `crispEdges` here would draw the sampling rather than the field.
                 Stated rather than left to the default because the default is
                 the renderer's choice and this is a decision. */
              style={{ imageRendering: 'auto' }} />
          </g>
        );
      })}
    </g>
  );
}
