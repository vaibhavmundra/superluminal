// ---------------------------------------------------------------------------
// test-surfaces.mjs — the task-surface pass.
//
// It shares the furniture pass's parser on purpose, so most of what could go
// wrong here is already covered by test-accents.mjs. What is NOT shared, and is
// what this checks, is the vocabulary and the qualifier: a rectangle is only a
// coffee table because there is a sofa beside it, and the prompt has to say so
// or the pass finds console tables in corridors.
//
//   node tools/test-surfaces.mjs
// ---------------------------------------------------------------------------

import { surfacesFromReply, buildSurfacePrompt, normaliseSurface,
         SURFACE_IDS, SURFACE_TYPES, MAX_SURFACES } from '../src/lib/taskSurfaces.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

console.log('-- the vocabulary --');
ok(SURFACE_IDS.join(',') === 'coffee_table,dining_table,conference_table,executive_desk',
  `four surfaces: ${SURFACE_IDS.join(', ')}`);
ok(SURFACE_TYPES.every((t) => t.context && t.plan), 'each carries both a plan description and its qualifier');

console.log('\n-- reading a reply --');
const reply = `\`\`\`json
{ "room":"living / dining",
  "surfaces":[
    {"type":"coffee_table","x0":0.20,"y0":0.55,"x1":0.38,"y1":0.68,"confidence":0.8,"note":"in front of the sofa"},
    {"type":"Dining Table","x0":0.60,"y0":0.20,"x1":0.88,"y1":0.50,"confidence":0.9,"note":"six chairs round it"},
    {"type":"coffee table","x0":0.42,"y0":0.55,"x1":0.52,"y1":0.66,"confidence":0.5},
    {"type":"sofa","x0":0.1,"y0":0.1,"x1":0.2,"y1":0.2},
    {"type":"dining_table"}
  ],
  "notes":"" }
\`\`\``;
const p = surfacesFromReply(reply, { w: 1000, h: 800 });
ok(p.surfaces.length === 3, `3 read, got ${p.surfaces.length}`);
ok(p.skipped.length === 2, `2 dropped, got ${p.skipped.length}`);
ok(p.surfaces[1].type === 'dining_table', '"Dining Table" normalises');
ok(p.surfaces[2].type === 'coffee_table', 'and so does "coffee table"');
ok(/not a task surface/.test(p.skipped[0].reason), 'a sofa is refused with a reason');
ok(near(p.surfaces[0].rect.x0, 200) && near(p.surfaces[0].rect.y1, 544),
  `fractions resolved against the sent size: ${JSON.stringify(p.surfaces[0].rect)}`);
ok(p.room === 'living / dining', 'the room reading comes through');
ok(p.surfaces.filter((s) => s.type === 'coffee_table').length === 2,
  'two coffee tables in one room are two surfaces, not one');

console.log('\n-- synonyms, and the ones that must NOT collide --');
for (const [w, e] of [
  ['centre table', 'coffee_table'], ['cocktail table', 'coffee_table'],
  ['boardroom table', 'conference_table'], ['meeting table', 'conference_table'],
  ['MD desk', 'executive_desk'], ['writing desk', 'executive_desk'],
  ['breakfast table', 'dining_table'], ['dining', 'dining_table'],
  ['bed', null], ['kitchen counter', null], ['chair', null],
]) ok(normaliseSurface(w) === e, `"${w}" -> ${e}`);
ok(normaliseSurface('conference desk') === 'conference_table',
  '"conference desk" is a conference table, not an executive desk — order matters');

console.log('\n-- junk and caps --');
for (const junk of ['', 'not json', '{}', '{"surfaces":null}', '{"surfaces":[null,3,"x"]}', '{"surfaces":[{}]}']) {
  try { surfacesFromReply(junk, { w: 100, h: 100 }); } catch (e) { ok(false, `threw on ${JSON.stringify(junk)}`); }
}
ok(true, 'six junk replies parsed without throwing');
const many = { surfaces: Array.from({ length: 14 }, () => ({ type: 'dining_table', x0: 0, y0: 0, x1: 0.2, y1: 0.2 })) };
ok(surfacesFromReply(JSON.stringify(many), { w: 100, h: 100 }).surfaces.length === MAX_SURFACES,
  `the ${MAX_SURFACES}-surface cap holds`);
ok(surfacesFromReply('[{"type":"dining_table","x0":0.1,"y0":0.2,"x1":0.3,"y1":0.4}]', { w: 100, h: 100 }).surfaces.length === 1,
  'a bare top-level array still parses');
const pc = surfacesFromReply('{"surfaces":[{"type":"dining_table","x0":10,"y0":20,"x1":30,"y1":60}]}', { w: 1000, h: 1000 });
ok(pc.surfaces[0].unit === 'percent', 'percent is read as percent — the shared parser, so this cannot drift');

console.log('\n-- the prompt --');
const t = buildSurfacePrompt({ room: { name: 'Living', widthFt: 18, heightFt: 14, areaSqft: 252 } });
ok(/Living/.test(t) && /18\.0 ft by 14\.0 ft/.test(t), 'room hints');
ok(/OUT IN FRONT of a sofa/.test(t), 'a coffee table is the one in FRONT of the sofa');
ok(/END AND SIDE TABLES/.test(t) && /is NOT one/.test(t),
  'and end tables are refused by name — the noisiest false positive there is');
ok(/several times the area of a side table/.test(t), 'with size given as the tell, not just position');
ok(/an end table is not a coffee table/.test(t), 'and again in the restraint rule');
ok(/"Only if" line matters as much as the shape/.test(t), 'and its importance is spelled out');
ok(/BOX THE SURFACE ITSELF, not the chairs/.test(t), 'the box is the top, not the arrangement');
ok(/THERE CAN BE MORE THAN ONE/.test(t), 'more than one per room is invited');
ok(/Wrong is worse\nthan unsure; unsure is much better than nothing/.test(t),
  'the restraint rule matches the bed prompt rather than suppressing');
ok(!/recommend|fixture|sconce|strip|pendant/i.test(t.replace(/not seating[^]*?not a bed\./, '')),
  'nothing about lighting — this pass only identifies');

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
