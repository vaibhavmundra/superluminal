// ---------------------------------------------------------------------------
// test-accents.mjs — the accent pass, either side of the model.
//
// No network and no browser. The model is asked ONE thing — what furniture is
// in this room — and everything after that is code, which means everything
// after that is testable here: the five house rules, the pair either side of a
// bed, the run taken off a wardrobe's own length, and the refusals.
//
//   node tools/test-accents.mjs
// ---------------------------------------------------------------------------

import { pointInPolygon } from '../src/lib/geometry.js';
import { furnitureFromReply, buildAccentPrompt, normaliseType,
         FURNITURE_IDS, ACCENT_IDS } from '../src/lib/accentPrompt.js';
import { cropFor, toPlanRect } from '../src/lib/accentMask.js';
import { placeZone, placeZones, zonesFromFurniture, nearestWall, wallForRun,
         projectOntoWall, PLACEMENT_RULES } from '../src/lib/accentPlace.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

console.log('-- the vocabulary --');
ok(FURNITURE_IDS.length === 5, `five things to recognise: ${FURNITURE_IDS.join(', ')}`);
ok(ACCENT_IDS.join(',') === 'sconce,strip', 'two things to place');
ok(PLACEMENT_RULES.length === 5, 'five rules');

console.log('\n-- THE REGRESSION: the prompt must not talk the model out of answering --');
const t = buildAccentPrompt({ room: { name: 'Master Bedroom', widthFt: 14, heightFt: 12, areaSqft: 168 } });
ok(!/recommend NOTHING/i.test(t), 'no "recommend NOTHING"');
ok(!/Do not invent a reason/i.test(t), 'no "do not invent a reason"');
ok(!/valid and often correct answer/i.test(t), 'no "an empty list is often correct"');
ok(/BE WILLING TO ANSWER/.test(t), 'it is told to answer');
ok(/moderate confidence on a real reading is far more\nuseful than silence/.test(t),
  'and told that an unsure answer beats silence');
ok(!/sconce|strip|lighting layer|fixture/i.test(t.replace(/do not think about\s+lighting[^]*?You are the eyes\./i, '')),
  'the model is never told what the fittings are');
ok(/wardrobe\n {6}a long, shallow rectangle/.test(t), 'it is taught what a wardrobe looks like in plan');
ok(/pillows drawn as one or two smaller rectangles/.test(t), 'and what a bed looks like');
ok(/Master Bedroom/.test(t) && /14\.0 ft by 12\.0 ft/.test(t), 'room hints carried');
ok(/12\.0 ft by 10\.0 ft/.test(buildAccentPrompt({ room: { widthFt: '12', heightFt: 10 } })),
  'string dimensions coerced, not thrown on');

console.log('\n-- reading the reply --');
const reply = `\`\`\`json
{ "room":"master bedroom",
  "furniture":[
    {"type":"bed","x0":0.30,"y0":0.10,"x1":0.62,"y1":0.45,"confidence":0.92,"note":"pillows at the top"},
    {"type":"double bed","x0":0.30,"y0":0.10,"x1":0.62,"y1":0.45,"confidence":0.4},
    {"type":"TV console","x0":0.30,"y0":0.86,"x1":0.60,"y1":0.94,"confidence":0.6},
    {"type":"wardrobe/closet","x0":0.80,"y0":0.20,"x1":0.94,"y1":0.70,"confidence":0.7},
    {"type":"dining table","x0":0.1,"y0":0.1,"x1":0.2,"y1":0.2},
    {"type":"bed"}
  ],
  "notes":"" }
\`\`\``;
const p = furnitureFromReply(reply, { w: 1000, h: 1000 });
ok(p.furniture.length === 4, `4 pieces read, got ${p.furniture.length}`);
ok(p.skipped.length === 2, `2 dropped, got ${p.skipped.length}`);
ok(p.furniture[1].type === 'bed' && p.furniture[2].type === 'tv_unit' && p.furniture[3].type === 'wardrobe',
  'synonyms normalised rather than thrown away');
ok(/not furniture this pass reads/.test(p.skipped[0].reason), 'a dining table is refused, with a reason');
ok(near(p.furniture[0].rect.x0, 300), 'fractions resolved against the sent size');

console.log('\n-- synonyms --');
ok(normaliseType('sofa_bed') === 'sofa', 'a sofa bed is a sofa, not a bed');
ok(normaliseType('bedside_table') === null, 'a bedside table is not a bed');
for (const [w, e] of [['almirah','wardrobe'],['media unit','tv_unit'],['washbasin','basin'],
                      ['sectional','sofa'],['king mattress','bed'],['toilet',null]]) {
  ok(normaliseType(w) === e, `"${w}" -> ${e}`);
}

console.log('\n-- units, and the shapes models actually send --');
ok(furnitureFromReply('{"furniture":[{"type":"bed","x0":10,"y0":20,"x1":30,"y1":60}]}', { w: 1000, h: 1000 }).furniture[0].unit === 'percent', 'percent');
const neg = furnitureFromReply('{"furniture":[{"type":"bed","x0":-0.01,"y0":0.2,"x1":0.4,"y1":0.8}]}', { w: 1000, h: 1000 });
ok(neg.furniture[0].unit === 'fraction' && neg.furniture[0].rect.x0 === 0, 'a piece flush to the wall is clamped, not reinterpreted as pixels');
ok(furnitureFromReply('[{"type":"bed","x0":0.1,"y0":0.2,"x1":0.3,"y1":0.4}]', { w: 1000, h: 1000 }).furniture.length === 1, 'a bare array still parses');
for (const junk of ['', 'not json', '{}', '{"furniture":null}', '{"furniture":[null,3,"x"]}', '{"furniture":[{}]}']) {
  try { furnitureFromReply(junk, { w: 100, h: 100 }); } catch (e) { ok(false, `threw on ${JSON.stringify(junk)}`); }
}
ok(true, 'six junk replies parsed without throwing');

console.log('\n-- the crop, and the trip back --');
const poly4 = [{x:400,y:300},{x:700,y:300},{x:700,y:500},{x:400,y:500}];
const crop = cropFor(poly4, { w: 2000, h: 1600 });
ok(crop.x0 < 400 && crop.x1 > 700, 'crop contains the room');
const back = toPlanRect({x0:0,y0:0,x1:1400,y1:1400}, crop, {width:1400,height:1400});
ok(near(back.x0, crop.x0) && near(back.x1, crop.x1), 'a full-frame box maps back to the full crop');

console.log('\n-- THE RULES, applied in code --');
// A 20 x 12 room. Bed 6 wide against the top wall; wardrobe 8 along the left.
const room = [{x:0,y:0},{x:200,y:0},{x:200,y:120},{x:0,y:120}];
const bed      = { type:'bed',      rect:{ x0: 70, y0: 0,  x1: 130, y1: 70 },  confidence:.9 };
const wardrobe = { type:'wardrobe', rect:{ x0: 0,  y0: 20, x1: 20,  y1: 100 }, confidence:.8 };
const sofa     = { type:'sofa',     rect:{ x0: 60, y0: 100, x1: 140, y1: 120 }, confidence:.8 };
const tv       = { type:'tv_unit',  rect:{ x0: 80, y0: 112, x1: 130, y1: 120 }, confidence:.7 };

const r1 = zonesFromFurniture([bed], room);
ok(r1.zones.length === 2 && r1.zones.every((z) => z.type === 'sconce'), 'rule 1: a bed makes two sconces');
ok(r1.zones.every((z) => !z.rejected && near(z.point.y, 0)), 'both land on the headboard wall');
// WITH NO SCALE, the old fraction still applies: 24% of the bed's 60px span.
ok(near(r1.zones[0].point.x, 70 - 60 * 0.24) && near(r1.zones[1].point.x, 130 + 60 * 0.24),
  `with no px/ft it falls back to the fraction: ${r1.zones.map(z=>z.point.x.toFixed(1)).join(' / ')}`);
const mid = (r1.zones[0].point.x + r1.zones[1].point.x) / 2;
ok(near(mid, 100), 'symmetric about the bed by construction, not by correction');

// ONE FOOT FROM THE BOX, WHEN THERE IS A SCALE. This is the rule as stated: a
// sconce sits a real distance from the mattress edge, not a share of the
// mattress. 10 px/ft, so one foot is 10px past either end of the 70..130 box.
const S = 10;
const r1ft = zonesFromFurniture([bed], room, { pxPerFt: S });
ok(near(r1ft.zones[0].point.x, 70 - S) && near(r1ft.zones[1].point.x, 130 + S),
  `one foot clear of either end: ${r1ft.zones.map(z=>z.point.x.toFixed(1)).join(' / ')}`);
ok(near((r1ft.zones[0].point.x + r1ft.zones[1].point.x) / 2, 100),
  'still symmetric — an absolute step is symmetric for the same reason a fraction was');

// THE POINT OF MAKING IT ABSOLUTE. A single bed and a king get their sconces
// the same distance from the mattress; under the fraction the narrower bed
// pulled its pair in with it, and the thing being lit is the same size in both.
const single = { type:'bed', rect:{ x0: 85, y0: 0, x1: 115, y1: 70 }, confidence:.9 };
const rSingle = zonesFromFurniture([single], room, { pxPerFt: S });
ok(near(rSingle.zones[0].point.x, 85 - S) && near(rSingle.zones[1].point.x, 115 + S),
  'a 3ft bed gets the same one-foot gap as a 6ft one');
const gapKing = 70 - r1ft.zones[0].point.x;
const gapSingle = 85 - rSingle.zones[0].point.x;
ok(near(gapKing, gapSingle),
  `the gap does not scale with the bed: ${gapKing} vs ${gapSingle}`);
const oldKing = 60 * 0.24, oldSingle = 30 * 0.24;
ok(!near(oldKing, oldSingle),
  `...whereas the fraction it replaces gave ${oldKing} and ${oldSingle} — the bug`);

// TWO TWINS ARE TWO PAIRS. App.jsx substitutes one furniture item per
// bed-filter box, so a room with two beds produces two symmetric pairs rather
// than one pair straddling both.
const twinA = { type:'bed', rect:{ x0: 30, y0: 0, x1: 70, y1: 60 }, confidence:.9 };
const twinB = { type:'bed', rect:{ x0: 110, y0: 0, x1: 150, y1: 60 }, confidence:.9 };
const twins = zonesFromFurniture([twinA, twinB], room, { pxPerFt: S });
ok(twins.zones.filter((z) => z.type === 'sconce' && !z.rejected).length === 4,
  'two beds, four sconces');
ok(near(twins.zones[0].point.x, 30 - S) && near(twins.zones[1].point.x, 70 + S)
   && near(twins.zones[2].point.x, 110 - S) && near(twins.zones[3].point.x, 150 + S),
  'each pair one foot clear of ITS OWN bed');

// The symbol stands off its wall, so it needs to know which side is the room.
ok(r1.zones.every((z) => z.inward && pointInPolygon(
  { x: z.point.x + z.inward.x * 0.5, y: z.point.y + z.inward.y * 0.5 }, room)),
  'each sconce carries an inward vector that really does point into the room');
ok(r1.zones.every((z) => !pointInPolygon(
  { x: z.point.x - z.inward.x * 0.5, y: z.point.y - z.inward.y * 0.5 }, room)),
  'and the other way is outside it — so the symbol cannot be drawn into the wall');
const leftWall = zonesFromFurniture([{ type:'bed', rect:{ x0: 0, y0: 40, x1: 60, y1: 90 }, confidence:.9 }], room);
ok(leftWall.zones.every((z) => near(Math.abs(z.inward.x), 1)),
  'on a side wall the inward vector turns with it');

ok(zonesFromFurniture([sofa], room).zones.length === 0, 'rule 2: a sofa makes nothing');
ok(zonesFromFurniture([sofa], room).handled[0].rule === 2,
  'and says so — the sofa is reported as seen and deliberately left alone');

const r4 = zonesFromFurniture([tv], room);
ok(r4.zones.length === 1 && r4.zones[0].type === 'strip', 'rule 4: a TV unit makes a strip and only a strip');

const r5 = zonesFromFurniture([wardrobe], room);
ok(r5.zones.length === 1 && r5.zones[0].type === 'strip', 'rule 5: a wardrobe makes a strip');
ok(!!r5.zones[0].run, 'which comes back as a run, not a box');
ok(near(r5.zones[0].runLength, 80 - 2 * (80 * 0.04)),
  `whose length is the wardrobe's own, less the end inset: ${r5.zones[0].runLength.toFixed(2)} of 80`);
ok(near(r5.zones[0].run[0].x, 0), 'lying on the wall the wardrobe stands against');

const basin = { type:'basin', rect:{ x0: 70, y0: 0, x1: 110, y1: 15 }, confidence:.8 };
const r3 = zonesFromFurniture([basin], room);
ok(r3.zones.length === 2 && r3.zones.every((z) => z.type === 'sconce'), 'rule 3: a basin makes two sconces');
ok(near(r3.zones[0].point.x, 70 - 40 * 0.10), 'flanking closer in than a bed does');

console.log('\n-- everything at once, and the reporting --');
const all = zonesFromFurniture([bed, wardrobe, sofa, tv], room);
ok(all.zones.length === 4, `a bedroom with all four gives 4 fittings, got ${all.zones.length}`);
ok(all.handled.length === 4, 'every piece is reported back whether it produced anything or not');
ok(all.handled.filter((h) => h.emitted === 0).length === 1, 'exactly one produced nothing — the sofa');

console.log('\n-- A STRIP RUNS ALONG THE LONG SIDE, even in a corner --');
// The regression. A wardrobe 8 long x 2 deep pushed into the top-left corner
// touches TWO walls at distance zero. Nearest-wall alone breaks that tie on
// polygon edge order, which picks the top wall and yields a 2ft run across the
// wardrobe's depth instead of an 8ft run along its length.
const cornerWardrobe = { type:'wardrobe', rect:{ x0: 0, y0: 0, x1: 20, y1: 80 }, confidence:.8 };
const cw = zonesFromFurniture([cornerWardrobe], room).zones[0];
ok(!cw.rejected, 'a wardrobe in the corner places');
ok(near(cw.runLength, 80 - 2 * (80 * 0.04)),
  `and runs its LONG side (80), not its depth (20): got ${cw.runLength.toFixed(1)}`);
ok(near(cw.run[0].x, 0) && near(cw.run[1].x, 0), 'along the wall its long side lies against');
ok(nearestWall(cornerWardrobe.rect, room).index === 0 && wallForRun(cornerWardrobe.rect, room).index === 3,
  'nearest-wall and wall-for-run genuinely disagree here — which is the bug this fixes');

// The same wardrobe turned 90 degrees, in the same corner.
const turned = { type:'wardrobe', rect:{ x0: 0, y0: 0, x1: 80, y1: 20 }, confidence:.8 };
const tw = zonesFromFurniture([turned], room).zones[0];
ok(near(tw.runLength, 80 - 2 * (80 * 0.04)) && near(tw.run[0].y, 0),
  'turned 90 degrees it runs along the other wall, same length');

// A square-ish object has no long side; distance decides and nothing throws.
const squareish = zonesFromFurniture([{ type:'tv_unit', rect:{ x0: 60, y0: 0, x1: 100, y1: 38 }, confidence:.6 }], room);
ok(!squareish.zones[0].rejected, 'a near-square object still places, on the nearest wall');

console.log('\n-- refusals are sentences --');
const floating = placeZone({ type:'strip', rect:{ x0: 90, y0: 55, x1: 110, y1: 70 } }, room);
ok(/not against any wall/.test(floating.rejected || ''), `a floating object: "${floating.rejected}"`);
const midBed = zonesFromFurniture([{ type:'bed', rect:{ x0: 80, y0: 45, x1: 130, y1: 80 }, confidence:.5 }], room);
ok(midBed.zones.every((z) => z.rejected), 'a bed marooned in the middle of the room is refused, not snapped to the nearest wall');
ok(!!placeZone({ type:'strip', rect:{ x0: 60, y0: 0, x1: 62, y1: 8 } }, room).rejected, 'an object too short to run tape along is refused');

console.log('\n-- the wall frame --');
const w = nearestWall({ x0: 0, y0: 20, x1: 20, y1: 100 }, room);
ok(w.index === 3, 'a deep object is assigned by its nearest corner, not its centre');
ok(near(projectOntoWall({ x0: 0, y0: 20, x1: 20, y1: 100 }, w).t1 - projectOntoWall({ x0: 0, y0: 20, x1: 20, y1: 100 }, w).t0, 80),
  "the along-wall extent is the object's own length");
const crossPair = placeZones([
  { type:'sconce', rect:{ x0: 40, y0: -4, x1: 56, y1: 10 }, group:'x' },
  { type:'sconce', rect:{ x0: -4, y0: 60, x1: 10, y1: 76 }, group:'x' },
], room);
ok(!crossPair.some((z) => z.mirrored), 'a cross-wall "pair" is left alone rather than averaged onto nowhere');

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
