import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import FixtureTip from '../src/components/FixtureTip.jsx';
import PlanCanvas from '../src/components/PlanCanvas.jsx';
import { planSwitchboards, SB_MM } from '../src/lib/electrical.js';

const PPF = 30.48;
const ROOM = [{x:0,y:0},{x:549,y:0},{x:549,y:396},{x:0,y:396}];
// A door whose latch jamb lands right beside the head of the bed — the case in
// the screenshot: the door board and the left bedside board stack up.
const sconce = (x, what) => ({
  id: `acc-o1-${what}`, type: 'sconce', group: 'bedside', what,
  point: { x, y: 0 }, along: { x: 1, y: 0 }, inward: { x: 0, y: 1 },
  wall: { a: ROOM[0], b: ROOM[1], index: 0 }, t: x,
});
const room = { id: 'o1', name: 'Bedroom', polygonPx: ROOM };
const { boards } = planSwitchboards({
  room, rooms: [room], pxPerFt: PPF,
  doors: [{ id: 'd', conf: 0.99, rect: { x0: 60, y0: -18, x1: 150, y1: 90 } }],
  accentZones: [sconce(190, 'left of the bed'), sconce(420, 'right of the bed')],
});
const live = boards.filter(b => !b.rejected);
console.log('boards:', live.map(b => `${b.servesShort}@${b.point.x.toFixed(0)}${b.clash ? ' CLASH' : ''}`).join('  '));

// Rebuild the card exactly as PlanCanvas does, then render it.
const b = live.find(x => x.clash);
const group = [b, ...b.clash.map(cid => live.find(x => x.id === cid)).filter(Boolean)];
const spec = {
  id: 'switchboard', label: `${group.length} switchboards, one spot`,
  rows: [['Plate', `${SB_MM.along} x ${SB_MM.deep} mm each`],
    ...group.map((g, i) => [`${i + 1} · ${g.servesShort || 'Board'}`, g.shortWhy || g.why || ''])],
  note: 'They land within one plate of each other. Neither was moved, because both positions are rules. On site these would be ganged into one plate.',
};
console.log('\nTOOLTIP');
console.log('  ' + spec.label);
for (const [k, v] of spec.rows) console.log('   ', k.padEnd(14), v);
console.log('  ' + spec.note);

const keys = spec.rows.map(r => r[0]);
console.log('\nunique row keys:', new Set(keys).size === keys.length);
console.log('FixtureTip renders:', renderToStaticMarkup(
  <FixtureTip tip={{ ...spec, x: 10, y: 10 }} />).length > 100);
console.log('canvas renders:', renderToStaticMarkup(
  <PlanCanvas width={600} height={400} pxPerFt={PPF} zoom={1}
    layers={{ switchboards: true }} switchboards={live} />).includes('polygon'));
