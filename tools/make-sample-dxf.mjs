// tools/make-sample-dxf.mjs — write a sample DXF into public/samples so the
// vector route can be tried without hunting for a drawing.
import { writeFileSync } from 'node:fs';
import { dxf, line, text, arc, lwpolyline } from './dxfwrite.mjs';
import { wall } from './fixtures.mjs';

const MM = 304.8;
const mm = (s) => line(s.layer, s.x1 * MM, s.y1 * MM, s.x2 * MM, s.y2 * MM);
const T = 0.75;

// A 2BHK: living/dining, two bedrooms, kitchen, two baths, off a small passage.
const walls = [
  // envelope, front door in the west wall
  ...wall(0, 0, 42, 0, T), ...wall(42, 0, 42, 30, T),
  ...wall(42, 30, 0, 30, T), ...wall(0, 30, 0, 0, T, [{ at: 22, width: 3.5 }]),
  // spine wall, doors into the passage
  ...wall(20, 0, 20, 30, T, [{ at: 8, width: 3 }, { at: 21, width: 3 }]),
  // east side split into two bedrooms
  ...wall(20, 16, 42, 16, T, [{ at: 4, width: 3 }]),
  // bathrooms off each bedroom
  ...wall(34, 0, 34, 8, T, [{ at: 4, width: 2.5 }]),
  ...wall(34, 8, 42, 8, T),
  ...wall(34, 22, 34, 30, T, [{ at: 4, width: 2.5 }]),
  ...wall(34, 22, 42, 22, T),
  // kitchen off the living side
  ...wall(0, 20, 12, 20, T, [{ at: 8, width: 3 }]),
  ...wall(12, 20, 12, 30, T),
].map((s) => ({ ...s, layer: 'A-WALL' }));

const labels = [
  [9, 9, 'LIVING / DINING'], [30, 25, 'BEDROOM 1'], [30, 8, 'BEDROOM 2'],
  [6, 25, 'KITCHEN'], [38, 26, 'BATH 1'], [38, 4, 'BATH 2'],
];

const doorArcs = [
  [20, 8, 3], [20, 21, 3], [20.5, 16 + 4, 3],
  [34, 4, 2.5], [34, 26, 2.5], [12 - 4, 20, 3],
];

writeFileSync('public/samples/sample-2bhk.dxf', dxf({
  insunits: 4,
  layers: ['A-WALL', 'A-TEXT', 'A-DOOR', 'A-DIMS', 'A-FURN'],
  entities: [
    ...walls.map(mm),
    ...labels.map(([x, y, s]) => text('A-TEXT', x * MM, y * MM, 0.55 * MM, s)),
    ...doorArcs.map(([x, y, r]) => arc('A-DOOR', x * MM, y * MM, r * MM, 0, 90)),
    // the clutter a real drawing carries, on its own layers
    line('A-DIMS', -4 * MM, 0, -4 * MM, 30 * MM),
    line('A-DIMS', -4.5 * MM, 0, -3.5 * MM, 0),
    line('A-DIMS', -4.5 * MM, 30 * MM, -3.5 * MM, 30 * MM),
    text('A-DIMS', -5.5 * MM, 15 * MM, 0.45 * MM, "30 FT"),
    lwpolyline('A-FURN', [
      { x: 3 * MM, y: 3 * MM }, { x: 10 * MM, y: 3 * MM },
      { x: 10 * MM, y: 6 * MM }, { x: 3 * MM, y: 6 * MM },
    ], true),
  ],
}));
console.log('wrote public/samples/sample-2bhk.dxf');
