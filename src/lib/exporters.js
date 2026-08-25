// ---------------------------------------------------------------------------
// exporters.js — get the layout out of the browser and into a drawing.
// ---------------------------------------------------------------------------

export function download(filename, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function toJSON(plan, meta) {
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    units: 'feet',
    scale: meta,
    room: { polygon: plan.polygonFt, areaSqft: plan.stats?.areaSqft },
    noLightZones: (plan.zones || []).map((z) => ({
      x0: +z.x0.toFixed(3), y0: +z.y0.toFixed(3), x1: +z.x1.toFixed(3), y1: +z.y1.toFixed(3),
    })),
    // which of the possible decompositions this layout was built on. Without
    // it a JSON export cannot be reproduced: the same room and the same
    // settings can legitimately produce several different layouts.
    chunking: plan.chunking ? {
      id: plan.chunking.id,
      label: plan.chunking.label,
      chosenBy: plan.chunking.chosenBy,
      optionsAvailable: plan.chunking.optionCount,
      recommended: plan.chunking.recommendedId,
      metrics: plan.chunking.metrics,
    } : null,
    chunks: (plan.chunks || []).map((ch) => ({
      x0: +ch.x0.toFixed(3), y0: +ch.y0.toFixed(3), x1: +ch.x1.toFixed(3), y1: +ch.y1.toFixed(3),
      xLines: ch.xLines.map((v) => +v.toFixed(3)), yLines: ch.yLines.map((v) => +v.toFixed(3)),
    })),
    grid: { cells: plan.cells?.length, omittedChunks: plan.stats?.omittedChunks ?? 0 },
    options: plan.opt,
    lights: plan.lights.map((l) => ({
      id: l.id, type: l.kind, x: +l.x.toFixed(3), y: +l.y.toFixed(3),
      orientation: l.kind === 'large' ? (l.axis === 'v' ? 'on vertical grid line' : 'on horizontal grid line') : 'cell centre',
    })),
  }, null, 2);
}

export function toCSV(plan) {
  const rows = [['id', 'type', 'x_ft', 'y_ft', 'x_ft_in', 'y_ft_in']];
  const ftin = (v) => {
    const f = Math.floor(v); const i = Math.round((v - f) * 12);
    return i === 12 ? `${f + 1}'-0"` : `${f}'-${i}"`;
  };
  for (const l of plan.lights) rows.push([l.id, l.kind, l.x.toFixed(3), l.y.toFixed(3), ftin(l.x), ftin(l.y)]);
  return rows.map((r) => r.join(',')).join('\n');
}

export function svgString(svgEl) {
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}

export async function svgToPNG(svgEl, width) {
  const str = svgString(svgEl);
  const vb = svgEl.viewBox.baseVal;
  const w = width || vb.width, h = (vb.height / vb.width) * w;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise((res, rej) => {
    img.onload = res; img.onerror = rej;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
  });
  const cv = document.createElement('canvas');
  cv.width = Math.round(w); cv.height = Math.round(h);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  return new Promise((res) => cv.toBlob(res, 'image/png'));
}

// --- minimal DXF (R12 ASCII) so this lands straight in AutoCAD -------------

function dxfHeader() {
  return ['0','SECTION','2','HEADER','9','$INSUNITS','70','2','0','ENDSEC',
          '0','SECTION','2','ENTITIES'];
}
function dxfLine(layer, x1, y1, x2, y2) {
  return ['0','LINE','8',layer,'10',x1.toFixed(4),'20',y1.toFixed(4),'30','0.0',
          '11',x2.toFixed(4),'21',y2.toFixed(4),'31','0.0'];
}
function dxfCircle(layer, x, y, r) {
  return ['0','CIRCLE','8',layer,'10',x.toFixed(4),'20',y.toFixed(4),'30','0.0','40',r.toFixed(4)];
}
function dxfText(layer, x, y, hgt, str) {
  return ['0','TEXT','8',layer,'10',x.toFixed(4),'20',y.toFixed(4),'30','0.0','40',hgt.toFixed(4),'1',str];
}

/**
 * DXF in feet, Y flipped so the drawing is right-way-up in CAD
 * (screen Y grows downward, CAD Y grows upward).
 */
export function toDXF(plan, fansFt) {
  const H = plan.stats ? Math.max(...plan.polygonFt.map((p) => p.y)) : 0;
  const fy = (y) => H - y;
  let out = dxfHeader();

  const poly = plan.polygonFt;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    out = out.concat(dxfLine('ROOM', a.x, fy(a.y), b.x, fy(b.y)));
  }
  for (const ch of plan.chunks || []) {
    out = out.concat(dxfLine('CHUNK', ch.x0, fy(ch.y0), ch.x1, fy(ch.y0)));
    out = out.concat(dxfLine('CHUNK', ch.x1, fy(ch.y0), ch.x1, fy(ch.y1)));
    out = out.concat(dxfLine('CHUNK', ch.x1, fy(ch.y1), ch.x0, fy(ch.y1)));
    out = out.concat(dxfLine('CHUNK', ch.x0, fy(ch.y1), ch.x0, fy(ch.y0)));
    for (const x of ch.xLines.slice(1, -1)) out = out.concat(dxfLine('GRID', x, fy(ch.y0), x, fy(ch.y1)));
    for (const y of ch.yLines.slice(1, -1)) out = out.concat(dxfLine('GRID', ch.x0, fy(y), ch.x1, fy(y)));
  }

  for (const z of plan.zones || []) {
    out = out.concat(dxfLine('NO-LIGHT', z.x0, fy(z.y0), z.x1, fy(z.y0)));
    out = out.concat(dxfLine('NO-LIGHT', z.x1, fy(z.y0), z.x1, fy(z.y1)));
    out = out.concat(dxfLine('NO-LIGHT', z.x1, fy(z.y1), z.x0, fy(z.y1)));
    out = out.concat(dxfLine('NO-LIGHT', z.x0, fy(z.y1), z.x0, fy(z.y0)));
    out = out.concat(dxfLine('NO-LIGHT', z.x0, fy(z.y0), z.x1, fy(z.y1)));
    out = out.concat(dxfLine('NO-LIGHT', z.x0, fy(z.y1), z.x1, fy(z.y0)));
  }

  for (const l of plan.lights) {
    const layer = l.kind === 'large' ? 'LIGHT-LARGE' : 'LIGHT-SMALL';
    const r = l.kind === 'large' ? 0.5 : 0.29;
    out = out.concat(dxfCircle(layer, l.x, fy(l.y), r));
    out = out.concat(dxfLine(layer, l.x - r, fy(l.y), l.x + r, fy(l.y)));
    out = out.concat(dxfLine(layer, l.x, fy(l.y) - r, l.x, fy(l.y) + r));
    out = out.concat(dxfText('LIGHT-TAG', l.x + r + 0.15, fy(l.y) - 0.15, 0.35, l.id));
  }
  for (const f of (Array.isArray(fansFt) ? fansFt : fansFt ? [fansFt] : [])) {
    out = out.concat(dxfCircle('FAN', f.x, fy(f.y), f.r || 2));
  }

  out = out.concat(['0','ENDSEC','0','EOF']);
  return out.join('\n');
}
