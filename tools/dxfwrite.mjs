// ---------------------------------------------------------------------------
// dxfwrite.mjs — build ASCII DXF text for the tests.
//
// Only exists so the tests can feed the real parser a real file rather than a
// hand-made object. If a fixture here is wrong, the tests are testing nothing.
// ---------------------------------------------------------------------------

const g = (code, value) => `${code}\n${value}`;

export function dxf({ insunits = 4, layers = ['A-WALL'], entities = [], blocks = {} }) {
  const out = [];
  out.push(g(0, 'SECTION'), g(2, 'HEADER'));
  out.push(g(9, '$INSUNITS'), g(70, insunits));
  out.push(g(9, '$ACADVER'), g(1, 'AC1015'));
  out.push(g(0, 'ENDSEC'));

  out.push(g(0, 'SECTION'), g(2, 'TABLES'));
  out.push(g(0, 'TABLE'), g(2, 'LAYER'), g(70, layers.length));
  for (const name of layers) {
    out.push(g(0, 'LAYER'), g(2, name), g(70, 0), g(62, 7), g(6, 'CONTINUOUS'));
  }
  out.push(g(0, 'ENDTAB'), g(0, 'ENDSEC'));

  out.push(g(0, 'SECTION'), g(2, 'BLOCKS'));
  for (const [name, ents] of Object.entries(blocks)) {
    out.push(g(0, 'BLOCK'), g(8, '0'), g(2, name), g(70, 0),
             g(10, 0), g(20, 0), g(30, 0), g(3, name));
    for (const e of ents) out.push(...e);
    out.push(g(0, 'ENDBLK'));
  }
  out.push(g(0, 'ENDSEC'));

  out.push(g(0, 'SECTION'), g(2, 'ENTITIES'));
  for (const e of entities) out.push(...e);
  out.push(g(0, 'ENDSEC'), g(0, 'EOF'));
  return out.join('\n');
}

export const line = (layer, x1, y1, x2, y2) => [
  g(0, 'LINE'), g(8, layer),
  g(10, x1), g(20, y1), g(30, 0),
  g(11, x2), g(21, y2), g(31, 0),
];

/** vertices: [{x,y,bulge?}] */
export const lwpolyline = (layer, vertices, closed = false) => {
  const out = [g(0, 'LWPOLYLINE'), g(8, layer), g(90, vertices.length), g(70, closed ? 1 : 0)];
  for (const v of vertices) {
    out.push(g(10, v.x), g(20, v.y));
    if (v.bulge) out.push(g(42, v.bulge));
  }
  return out;
};

export const arc = (layer, cx, cy, r, a0Deg, a1Deg) => [
  g(0, 'ARC'), g(8, layer), g(10, cx), g(20, cy), g(30, 0), g(40, r),
  g(50, a0Deg), g(51, a1Deg),
];

export const circle = (layer, cx, cy, r) => [
  g(0, 'CIRCLE'), g(8, layer), g(10, cx), g(20, cy), g(30, 0), g(40, r),
];

export const text = (layer, x, y, h, str) => [
  g(0, 'TEXT'), g(8, layer), g(10, x), g(20, y), g(30, 0), g(40, h), g(1, str),
];

export const insert = (layer, name, x, y, { rotation = 0, xScale = 1, yScale = 1 } = {}) => [
  g(0, 'INSERT'), g(8, layer), g(2, name),
  g(10, x), g(20, y), g(30, 0),
  g(41, xScale), g(42, yScale), g(43, 1), g(50, rotation),
];
