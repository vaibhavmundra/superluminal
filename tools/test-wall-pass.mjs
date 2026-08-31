// ---------------------------------------------------------------------------
// test-wall-pass.mjs — THE RENDER PASS, both halves, with no network.
//
// THE THREE THINGS THAT CAN GO SILENTLY WRONG HERE, and they are the reason
// this file exists rather than a couple of prompt greps:
//
//   1. THE Y FLIP. PROMPT 02 says [1,1] is the BOTTOM-left cell and y counts
//      UP. Plan pixels count DOWN. Get it backwards and every element on the
//      plan is mirrored top-to-bottom — which looks completely plausible on a
//      rectangular room and is wrong for every single one.
//
//   2. FINDING THE ARRAY. PROMPT 02 is asked for a WORKSHEET and then the JSON,
//      and the worksheet is full of things that look like JSON — "[3, 7]", "W1
//      top wall" — so the shared extractJson() finds the wrong one, or nothing.
//
//   3. THE JOIN. Two calls, two lists, and an element that the second call
//      dropped must come back with its English and NO cells, not with somebody
//      else's cells.
//
//   node tools/test-wall-pass.mjs
// ---------------------------------------------------------------------------

import { elementsFromReply, cellsFromReply, lastJsonArray, joinPlacements,
         normaliseWallType, widthFtFrom, gridPrompt02, buildRenderPrompt,
         RENDER_PROMPT_01, WALL_IDS, MAX_ELEMENTS } from '../src/lib/wallPrompt.js';
import { gridFor, cellRect, cellsToRect, anchorLines, sideOf } from '../src/lib/wallGrid.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

console.log('-- the vocabulary --');
ok(WALL_IDS.join(',') === 'shelves,painting,wall_art,panelling,wallpaper',
  `five types: ${WALL_IDS.join(', ')}`);
ok(normaliseWallType('Wall Panelling') === 'panelling', '"Wall Panelling" normalises');
ok(normaliseWallType('wallpaper') === 'wallpaper', 'wallpaper is not read as "wall"');
ok(normaliseWallType('open shelving') === 'shelves', '"open shelving" is shelves');
ok(normaliseWallType('framed artwork') === 'wall_art', '"framed artwork" is wall art');
ok(normaliseWallType('fluted timber slats') === 'panelling', 'fluted slats are panelling');
ok(normaliseWallType('curtain') === null, 'a curtain is not a wall element');

console.log('\n-- PROMPT 01: what it asks --');
const p1 = buildRenderPrompt({ room: { name: 'Master Bedroom', widthFt: 12.5, heightFt: 14, areaSqft: 175 }, views: 2 });
ok(p1.includes(RENDER_PROMPT_01), 'the question is included verbatim');
ok(/2 views of ONE room/.test(p1), 'says how many views, so one thing is not counted twice');
ok(/12\.5 ft by 14\.0 ft/.test(p1), 'gives the room size, so "5ft wide" has something to scale against');
ok(/Return ONLY a JSON array/.test(p1), 'JSON only');
ok(!/\[x, y\]|grid|cell/i.test(p1), 'and asks for NO coordinates — that is the second call');

console.log('\n-- PROMPT 01: reading a reply --');
const r1 = `Here is what I can see:
\`\`\`json
[
  {"type":"panelling","wall":"the wall behind the bed","location":"full width of the bed, floor to 4ft","dimension":"4ft high and 9ft wide","confidence":0.9},
  {"type":"Wall Art","wall":"the wall opposite the bed above the TV unit","location":"centred over the TV, 2ft above it","dimension":"2ft high and 5ft wide"},
  {"type":"open shelving","wall":"the wall beside the window","location":"three shelves stacked","dimension":"3ft wide"},
  {"type":"rug","wall":"the floor","location":"middle","dimension":"6x8"},
  {"type":"painting","location":"somewhere","dimension":"2ft"}
]
\`\`\``;
const e1 = elementsFromReply(r1);
ok(e1.elements.length === 3, `3 elements read, got ${e1.elements.length}`);
ok(e1.skipped.length === 2, `2 dropped, got ${e1.skipped.length}`);
ok(e1.elements[1].type === 'wall_art', '"Wall Art" normalises');
ok(/no wall given/.test(e1.skipped.find((s) => /painting/.test(s.raw))?.reason ?? ''),
  'a painting with no wall is dropped with that as the reason, not silently placed');
ok(e1.elements[0].widthFt === 9, `"4ft high and 9ft wide" -> 9, got ${e1.elements[0].widthFt}`);
ok(e1.elements[1].widthFt === 5, `"2ft high and 5ft wide" -> 5, got ${e1.elements[1].widthFt}`);
ok(e1.elements[2].widthFt === 3, `"3ft wide" -> 3, got ${e1.elements[2].widthFt}`);
ok(widthFtFrom('2ft x 5ft') === 5, 'h x w takes the second number');
ok(widthFtFrom("5' wide") === 5, 'a foot mark is a foot');
ok(widthFtFrom('large') === null, 'and an unreadable dimension is null rather than a guess');
ok(elementsFromReply('nothing here').elements.length === 0, 'an unparseable reply is empty, not a throw');
const big = elementsFromReply(JSON.stringify(
  Array.from({ length: MAX_ELEMENTS + 5 }, () => ({ type: 'painting', wall: 'a wall' }))));
ok(big.elements.length === MAX_ELEMENTS, `the ${MAX_ELEMENTS}-element cap is enforced in the parser`);

console.log('\n-- PROMPT 02: the fill-ins --');
const p2 = gridPrompt02({
  anchorLines: '   - Bed headboard wall = the top wall',
  rows: 14, cols: 12, cellFt: 1, elements: e1.elements,
});
ok(!/\{ROWS\}|\{COLS\}|\{N\}|\{top wall\}/.test(p2), 'no placeholder survives into the sent prompt');
ok(/W1 top wall, horizontal, y = 14, x from 1 to 12/.test(p2), 'the wall-table example uses THIS room');
ok(/Bed headboard wall = the top wall/.test(p2), 'the derived anchors are in');
ok(/1 cell = 1 ft/.test(p2), 'the scale is stated');
ok(/"type": "panelling"/.test(p2), 'the elements array is pasted in');
ok(/output these steps as a short worksheet before the JSON/.test(p2), 'the worksheet is still asked for');

console.log('\n-- finding the array after a worksheet --');
const r2 = `Step 1. Wall table.
W1 top wall, horizontal, y = 14, x from 1 to 12.
W2 bottom wall, horizontal, y = 1, x from 1 to 12.
Step 2. Anchor table. Bed occupies [4, 14] to [9, 14].
Step 3. Panelling -> W1, 9 ft -> 9 cells. Wall art -> W2, 5 ft -> 5 cells.
Step 4. Self-check: all on one line, all inside the room. OK.
Step 5.
[
  {"type":"panelling","wall":"the wall behind the bed","location":"full width of the bed, floor to 4ft","dimension":"4ft high and 9ft wide","wall_ref":"W1","start_cell":[2,14],"end_cell":[10,14]},
  {"type":"wall_art","wall":"the wall opposite the bed above the TV unit","location":"centred over the TV","dimension":"2ft high and 5ft wide","wall_ref":"W2","start_cell":[4,1],"end_cell":[8,1]},
  {"type":"shelves","wall":"the wall beside the window","location":"three shelves stacked","dimension":"3ft wide","wall_ref":"W3","start_cell":[1,5],"end_cell":[1,7]}
]`;
ok(Array.isArray(lastJsonArray(r2)), 'the array is found past a worksheet full of [3, 7]s');
ok(lastJsonArray(r2).length === 3, 'and it is the WHOLE array, not the first bracket in the prose');
ok(lastJsonArray('no array at all') === null, 'a reply with no array returns null rather than throwing');
ok(lastJsonArray('[{"a":"] not really ]"}]')?.[0]?.a === '] not really ]',
  'a bracket inside a string does not end the array');

const c2 = cellsFromReply(r2, { rows: 14, cols: 12 });
ok(c2.placed.length === 3, `3 placed, got ${c2.placed.length}`);
ok(c2.placed[0].cells.length === 9, `a [2,14]..[10,14] run is 9 cells, got ${c2.placed[0].cells.length}`);
ok(c2.placed[2].cells.length === 3, 'a vertical run counts too');
ok(c2.placed[0].cells.every((c) => c.y === 14), 'a horizontal run holds y constant (rule A)');
ok(c2.placed[2].cells.every((c) => c.x === 1), 'a vertical run holds x constant (rule A)');

console.log('\n-- rule A, the clamp, and the shapes a model writes --');
const bad = cellsFromReply(`[
  {"type":"painting","start_cell":[2,3],"end_cell":[7,9]},
  {"type":"panelling","start_cell":[1,14],"end_cell":[40,14]},
  {"type":"shelves","start_cell":{"x":3,"y":2},"end_cell":{"x":5,"y":2}},
  {"type":"wallpaper","start_cell":"[6, 6]"},
  {"type":"painting"}
]`, { rows: 14, cols: 12 });
ok(bad.skipped.some((s) => /not on one wall line/.test(s.reason)),
  'a diagonal run is refused, not drawn as a rectangle in the middle of the room');
const clamped = bad.placed.find((p) => p.type === 'panelling');
ok(clamped.end.x === 12 && clamped.clamped, 'a run longer than the wall is clamped to it AND says so');
ok(bad.placed.some((p) => p.type === 'shelves' && p.cells.length === 3), '{x,y} objects are read');
ok(bad.placed.some((p) => p.type === 'wallpaper' && p.cells.length === 1),
  'a string cell is read, and a missing end means a one-cell run');
ok(bad.skipped.some((s) => /no readable start_cell/.test(s.reason)), 'and no cells at all is dropped');

console.log('\n-- the grid, and the flip --');
// A 12ft x 14ft room at 20 px/ft, top-left at (100, 200).
const poly = [{ x: 100, y: 200 }, { x: 340, y: 200 }, { x: 340, y: 480 }, { x: 100, y: 480 }];
const g = gridFor(poly, 20);
ok(g.cols === 12 && g.rows === 14, `12 x 14 cells, got ${g.cols} x ${g.rows}`);
ok(near(g.cellW, 20) && near(g.cellH, 20), 'each cell is 20px, which is one foot');
const bl = cellRect(g, 1, 1);
ok(near(bl.x0, 100) && near(bl.y1, 480),
  'cell [1,1] is the BOTTOM-left: smallest x, LARGEST plan-pixel y');
const tr = cellRect(g, 12, 14);
ok(near(tr.x1, 340) && near(tr.y0, 200), 'cell [12,14] is the top-right');
ok(cellRect(g, 1, 14).y0 < cellRect(g, 1, 1).y0, 'y counts UP, so row 14 is above row 1 on the sheet');
const run = cellsToRect(Array.from({ length: 9 }, (_, i) => ({ x: 2 + i, y: 14 })), g);
ok(near(run.x0, 120) && near(run.x1, 300) && near(run.y0, 200) && near(run.y1, 220),
  'a nine-cell run along the top wall is one 180x20 rectangle hugging that wall');
ok(gridFor(poly, 0) === null, 'no scale means no grid, rather than a divide by zero');
// A room whose feet do not divide evenly still divides EXACTLY into cells —
// see the header of wallGrid.js for why a sliver cell is the bug being avoided.
const odd = gridFor([{ x: 0, y: 0 }, { x: 247, y: 0 }, { x: 247, y: 100 }, { x: 0, y: 100 }], 20);
ok(near(cellRect(odd, odd.cols, 1).x1, 247), 'the last column ends exactly on the wall, with no sliver left over');

console.log('\n-- which wall a piece is against --');
const ga = gridFor([{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 280 }, { x: 0, y: 280 }], 20);
ok(sideOf({ x0: 60, y0: 2, x1: 180, y1: 120 }, ga, { across: true }) === 'top',
  'a bed against the top wall reads as top');
ok(sideOf({ x0: 100, y0: 120, x1: 140, y1: 160 }, ga) === null,
  'and something floating in the middle is against no wall at all');

// THE CORNER TIE — the bug this whole rule exists for. A TV unit running the
// full width of the bottom wall sits in the bottom-LEFT corner, so it touches
// the bottom wall and the left wall at distance zero. Plain nearest-wall ties,
// and the tie used to break toward the left; the prompt then said
// "TV unit = the left wall" and PROMPT 02 placed everything from there.
{
  const g16 = gridFor([{ x: 0, y: 0 }, { x: 320, y: 0 }, { x: 320, y: 260 }, { x: 0, y: 260 }], 20);
  ok(sideOf({ x0: 0, y0: 230, x1: 280, y1: 260 }, g16) === 'bottom',
    'a TV unit in the BOTTOM-LEFT corner is on the bottom wall, not the left one');
  ok(sideOf({ x0: 0, y0: 0, x1: 280, y1: 30 }, g16) === 'top',
    'and one in the top-left corner is on the top wall');
  ok(sideOf({ x0: 300, y0: 0, x1: 320, y1: 200 }, g16) === 'right',
    'a tall shallow wardrobe in the top-RIGHT corner is on the right wall, not the top');
  // The mirror rule. A 5 x 6.5 ft double bed's long axis is head-to-foot, so
  // its headboard wall is the one ACROSS that axis — exactly the pair the
  // furniture rule excludes. Same box, two answers, and both are right for
  // what they are being asked.
  const bed = { x0: 0, y0: 0, x1: 100, y1: 130 };
  ok(sideOf(bed, g16, { across: true }) === 'top', 'a bed in the top-left corner has its head on the top wall');
  ok(sideOf(bed, g16) === 'left', 'while the same box read as a shelf would be on the left — the flip is real');
  // A king at 6 x 6.5 has no long axis worth the name, so nothing is excluded.
  ok(sideOf({ x0: 0, y0: 0, x1: 120, y1: 130 }, g16, { across: true }) === 'top',
    'a near-square king bed falls back to all four walls rather than guessing an axis');
}

console.log('\n-- the anchors --');
const lines = anchorLines({
  furniture: [{ type: 'bed', rect: { x0: 60, y0: 2, x1: 180, y1: 120 } },
              { type: 'tv_unit', rect: { x0: 60, y0: 268, x1: 180, y1: 278 } }],
  doors: [{ rect: { x0: 210, y0: 0, x1: 238, y1: 20 } },
          { rect: { x0: 900, y0: 900, x1: 940, y1: 940 } }],
  grid: ga,
});
ok(/Bed headboard wall = the top wall/.test(lines), 'the bed becomes the headboard-wall anchor');
ok(/TV unit = the bottom wall/.test(lines), 'the TV unit becomes its own anchor');
ok(/Door = the right end of the top wall/.test(lines), 'a door is placed along its wall, not just on it');
ok(!/900/.test(lines) && lines.split('\n').filter((l) => /Door/.test(l)).length === 1,
  'a door in another room on the same sheet is not an anchor for this one');
ok(/none were detected/.test(anchorLines({ grid: ga })),
  'and with nothing detected it says so rather than asserting four walls it cannot know');

// Two wardrobes on ONE wall is one anchor; two on different walls is two, and
// they have to be told apart or the block reads as contradicting itself.
{
  const w = { x0: 220, y0: 40, x1: 240, y1: 180 };
  const same = anchorLines({ furniture: [{ type: 'wardrobe', rect: w },
                                         { type: 'wardrobe', rect: w }], grid: ga });
  ok(same.split('\n').filter((l) => /Wardrobe/.test(l)).length === 1,
    'a repeated anchor line is not printed twice');
  const split = anchorLines({
    furniture: [{ type: 'wardrobe', rect: w },
                { type: 'wardrobe', rect: { x0: 0, y0: 40, x1: 20, y1: 180 } }], grid: ga });
  ok(/Wardrobe 1 = the right wall/.test(split) && /Wardrobe 2 = the left wall/.test(split),
    'but two on different walls are numbered so the block is not self-contradictory');
}

console.log('\n-- the join --');
const joined = joinPlacements(e1.elements, c2.placed);
ok(joined.length === 3, 'every element from the first call survives the join');
ok(joined[0].cells.length === 9, 'in order, by index, as step 5 asks for');
const dropped = joinPlacements(e1.elements, [c2.placed[0]]);
ok(dropped[1].cells.length === 0 && dropped[1].wall === e1.elements[1].wall,
  'an element the second call dropped keeps its English and gets NO cells');
const shuffled = joinPlacements(e1.elements, [c2.placed[2], c2.placed[0], c2.placed[1]]);
ok(shuffled[0].cells.length === 9 && shuffled[2].cells.length === 3,
  'a reordered second reply is matched back on type and wall');

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
