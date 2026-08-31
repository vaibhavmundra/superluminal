// ---------------------------------------------------------------------------
// test-art-spots.mjs — lighting the wall art.
//
// THE RULE IS ONE LINE OF ARITHMETIC AND IT HAS A TRAP IN IT. "One spot for
// every two feet" reads like a division somebody would round, and rounding is
// wrong: `Math.round(5 / 2)` is 3 in JavaScript, and a five-foot piece gets two
// spots. That example is the specification, so it is asserted first and by name.
//
// The other half is that this file places nothing. It turns art into TARGETS and
// hands them to taskSpots.js, so what is checked here is the slicing — N equal
// parts along the piece's own wall, in the right axis — and the vocabulary:
// panelling and wallpaper are grazed with a strip and must NOT come back with a
// row of spots down them.
//
//   node tools/test-art-spots.mjs
// ---------------------------------------------------------------------------

import { spotCountFor, litByArtSpots, artWidthFt, artTargets, artTargetsFor,
         placeArtCluster, planArtSpots, ART_SPOT } from '../src/lib/artSpots.js';
import { buildBOQ, boqTable, FIXTURE_BY_ID, specsFor } from '../src/lib/boq.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

console.log('-- how many spots --');
ok(spotCountFor(5) === 2, `THE SPEC: a 5 ft piece gets 2 spots, not 3 — got ${spotCountFor(5)}`);
ok(Math.round(5 / 2) === 3, '...and Math.round(5/2) really is 3, which is the trap being avoided');
ok(spotCountFor(2) === 1, '2 ft -> 1');
ok(spotCountFor(3.9) === 1, '3.9 ft -> 1, because the second two feet is not complete');
ok(spotCountFor(4) === 2, '4 ft -> 2');
ok(spotCountFor(6) === 3, '6 ft -> 3');
ok(spotCountFor(9) === 4, '9 ft -> 4');
ok(spotCountFor(0.5) === 1, 'a small piece still gets one — never zero');
ok(spotCountFor(null) === 1, 'and so does one whose width could not be read');
ok(spotCountFor(400) === ART_SPOT.maxPerElement,
  `a gallery wall is capped at ${ART_SPOT.maxPerElement} rather than emptying the grid`);

console.log('\n-- what gets lit this way --');
ok(litByArtSpots('painting') && litByArtSpots('wall_art'), 'paintings and wall art do');
ok(!litByArtSpots('panelling'), 'panelling does NOT — it is grazed along its length, which is a strip');
ok(!litByArtSpots('wallpaper'), 'nor wallpaper, for the same reason');
ok(!litByArtSpots('shelves'), 'nor shelves, which are lit from inside');

console.log('\n-- which width the count uses --');
const grid = { cellWFt: 1, cellHFt: 1 };
{
  const documented = { type: 'painting', widthFt: 5, cells: [1, 2, 3].map((x) => ({ x, y: 9 })),
                       start: { x: 1, y: 9 }, end: { x: 3, y: 9 } };
  const w = artWidthFt(documented, grid);
  ok(w.ft === 5 && w.from === 'dimension',
    'the DOCUMENTED width wins over the cell run — it is a measurement of the artwork');
  const undocumented = { ...documented, widthFt: null };
  const w2 = artWidthFt(undocumented, grid);
  ok(w2.ft === 3 && w2.from === 'cells',
    'and with no dimension it falls back to the run rather than to nothing');
}

console.log('\n-- the targets --');
{
  // A 5 ft piece placed as a 5-cell run along a horizontal wall, 100px wide.
  const e = { id: 'w1', type: 'wall_art', widthFt: 5,
              cells: [1, 2, 3, 4, 5].map((x) => ({ x, y: 14 })),
              start: { x: 1, y: 14 }, end: { x: 5, y: 14 } };
  const rect = { x0: 0, y0: 0, x1: 100, y1: 20 };
  const t = artTargets(e, rect, { grid });
  ok(t.length === 2, `5 ft -> 2 targets, got ${t.length}`);
  ok(near(t[0].rect.x0, 0) && near(t[0].rect.x1, 50)
     && near(t[1].rect.x0, 50) && near(t[1].rect.x1, 100),
    'sliced into equal halves ALONG the wall, so the spots come out evenly spaced');
  ok(t.every((q) => q.rect.y0 === 0 && q.rect.y1 === 20),
    'and each slice keeps the full depth — the run is one cell deep either way');
  ok(t.every((q) => q.wholeRect === rect),
    'each target carries the whole piece, so a spot can highlight the art and not its own slice');
  ok(t[0].of === 2 && t[1].index === 1, 'and knows which of how many it is');
}
{
  // The same piece on a VERTICAL wall must slice down y, not across x. Slicing
  // the wrong axis puts every spot on top of the last one.
  const e = { id: 'w2', type: 'painting', widthFt: 6,
              cells: [4, 5, 6, 7, 8, 9].map((y) => ({ x: 1, y })),
              start: { x: 1, y: 4 }, end: { x: 1, y: 9 } };
  const t = artTargets(e, { x0: 0, y0: 0, x1: 20, y1: 120 }, { grid });
  ok(t.length === 3, `6 ft -> 3 targets, got ${t.length}`);
  ok(near(t[0].rect.y1, 40) && near(t[1].rect.y0, 40) && near(t[2].rect.y1, 120),
    'sliced down y for a vertical run');
  ok(t.every((q) => q.rect.x0 === 0 && q.rect.x1 === 20), 'x is the depth here, and is not divided');
}
ok(artTargets({ type: 'panelling', widthFt: 9, cells: [{ x: 1, y: 1 }] },
              { x0: 0, y0: 0, x1: 90, y1: 10 }, { grid }).length === 0,
  'panelling gets no targets at all');
ok(artTargets({ type: 'painting', widthFt: 5, cells: [] }, { x0: 0, y0: 0, x1: 9, y1: 9 }, { grid }).length === 0,
  'and neither does a piece the second call could not place — no cells, no wall, no spot');
{
  const els = [{ id: 'a', type: 'painting', widthFt: 4, cells: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
                 start: { x: 1, y: 1 }, end: { x: 2, y: 1 } },
               { id: 'b', type: 'wallpaper', widthFt: 12, cells: [{ x: 5, y: 1 }],
                 start: { x: 5, y: 1 }, end: { x: 5, y: 1 } }];
  const all = artTargetsFor(els, () => ({ x0: 0, y0: 0, x1: 40, y1: 20 }), { grid });
  ok(all.length === 2 && all.every((t) => t.elementId === 'a'),
    'over a whole room, only the art contributes targets');
}

console.log('\n-- the schedule --');
{
  const f = FIXTURE_BY_ID['art-spot'];
  ok(!!f, 'there is a catalogue line for it');
  ok(f.beam === 24, `at 24 degrees, not 30: ${f.beam}`);
  ok(FIXTURE_BY_ID.spot.beam === 30, 'and the task spot is still 30 — two optics, two lines');
  ok(f.id !== 'spot' && f.watts === FIXTURE_BY_ID.spot.watts,
    'same lamp, separate line: a schedule that merged them could not be ordered from');
  ok(specsFor('art-spot').rows.some(([k, v]) => k === 'Beam angle' && v === '24°'),
    'and the hover card reads its beam from the same place the schedule does');
}
{
  const rm = (id, name, small) => ({
    id, outline: { name },
    plan: { ok: true, stats: { areaSqft: 200 }, lights: Array(small).fill({ kind: 'small' }) },
  });
  const boq = buildBOQ({
    rooms: [rm('r1', 'Living', 6), rm('r2', 'Bed 1', 4)],
    spots: [
      { roomId: 'r1', fixture: 'spot' },
      { roomId: 'r1', fixture: 'art-spot', art: true },
      { roomId: 'r1', fixture: 'art-spot', art: true },
      { roomId: 'r2', fixture: 'art-spot', art: true },
      // Refused by the placer: it has no room and must not be billed.
      { fixture: 'art-spot', art: true, rejected: 'no segment' },
      // A spot from a plan saved before any of this existed.
      { roomId: 'r2' },
    ],
    pxPerFt: 20,
  });
  const line = (id) => boq.lines.find((l) => l.id === id);
  ok(line('art-spot').qty === 3, `3 art spots billed, got ${line('art-spot').qty}`);
  ok(line('spot').qty === 2, `2 task spots, including the one with no fixture field: ${line('spot').qty}`);
  ok(line('art-spot').load === 15, `and they carry load at 5 W each: ${line('art-spot').load} W`);
  ok(boq.rooms[0].qty['art-spot'] === 2 && boq.rooms[1].qty['art-spot'] === 1,
    'counted per room too');

  const rows = boqTable(boq);
  const head = rows.find((r) => r[0] === 'Space');
  ok(head[7] === 'Art spots', 'the space breakdown grows an Art spots column when there are any');
  ok(head.length === 8, 'in the eighth slot that was always reserved and always blank');
  const living = rows.find((r) => r[0] === 'Living');
  ok(living[7] === '2', `and the row carries the count: ${living[7]}`);

  // ...and stays out of the way when there are none.
  const plain = buildBOQ({ rooms: [rm('r1', 'Living', 6)], spots: [{ roomId: 'r1' }], pxPerFt: 20 });
  ok(!plain.lines.some((l) => l.id === 'art-spot'), 'no line on a plan with no art');
  ok(boqTable(plain).find((r) => r[0] === 'Space')[7] === '',
    'and no column either — a column of zeros is a question the reader has to answer');
}

console.log('\n-- the row: one line, one foot apart, or nothing --');
//
// A 20 x 14 ft room with a plain ambient grid: four columns of lights at
// x = 2.5, 7.5, 12.5, 17.5 and two rows at y = 3.5 and 10.5. The secondary grid
// is therefore two horizontal lines and four vertical ones.
const ROOM = {
  chunks: [{ x0: 0, y0: 0, x1: 20, y1: 14 }],
  lights: [2.5, 7.5, 12.5, 17.5].flatMap((x) => [3.5, 10.5].map((y) => ({ x, y, id: `${x},${y}` }))),
  polygon: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 14 }, { x: 0, y: 14 }],
  fixtures: [], zones: [], coves: [],
};
{
  // 5.5 ft of art on the top wall, so its run is horizontal and the row that
  // lights it must be too.
  const art = { id: 'a', rect: { x0: 7, y0: 0, x1: 12.5, y1: 1 }, horizontal: true, n: 2 };
  const res = placeArtCluster(art, { ...ROOM, taken: ROOM.lights });
  ok(!!res.spots, `placed: ${res.rejected ?? 'yes'}`);
  ok(res.spots.length === 2, `both spots or none — got ${res.spots?.length}`);
  ok(res.spots[0].y === res.spots[1].y,
    'THE HEADLINE: both on ONE line, so they stand the same distance off the wall');
  ok(near(Math.abs(res.spots[1].x - res.spots[0].x), ART_SPOT.spacingFt),
    `and ${ART_SPOT.spacingFt} ft apart — got ${Math.abs(res.spots[1].x - res.spots[0].x).toFixed(2)}`);
  ok(res.spots[0].y === 3.5, 'on the nearest line PARALLEL to that wall, not the nearest line');
  ok(near((res.spots[0].x + res.spots[1].x) / 2, 9.75), 'centred on the artwork');
  ok(near(res.standoff, 2.5), `and its standoff is reported: ${res.standoff} ft`);
}
{
  // The same piece on a side wall. The row has to turn with it — a vertical run
  // lit by a horizontal row would put every spot at a different distance from
  // the wall, which is the failure the whole formation rule exists to prevent.
  const art = { id: 'b', rect: { x0: 19, y0: 5, x1: 20, y1: 10.5 }, horizontal: false, n: 2 };
  const res = placeArtCluster(art, { ...ROOM, taken: ROOM.lights });
  ok(!!res.spots, `placed on a vertical wall: ${res.rejected ?? 'yes'}`);
  ok(res.spots[0].x === res.spots[1].x, 'both on one VERTICAL line for a vertical run');
  ok(near(Math.abs(res.spots[1].y - res.spots[0].y), ART_SPOT.spacingFt), 'still a foot apart');
  ok(res.spots[0].x === 17.5, 'on the nearest vertical line inside the standoff band');
}
{
  // Four spots is still one row.
  const art = { id: 'c', rect: { x0: 4, y0: 0, x1: 13, y1: 1 }, horizontal: true, n: 4 };
  const res = placeArtCluster(art, { ...ROOM, taken: ROOM.lights });
  ok(res.spots?.length === 4, 'a four-spot row lands whole');
  ok(new Set(res.spots.map((p) => p.y)).size === 1, 'all four on one line');
  const xs = res.spots.map((p) => p.x).sort((a, b) => a - b);
  ok(xs.every((x, i) => i === 0 || near(x - xs[i - 1], ART_SPOT.spacingFt)),
    'evenly spaced a foot apart end to end');
}

console.log('\n-- and dropped rather than scattered when it will not fit --');
{
  const art = { id: 'd', rect: { x0: 7, y0: 0, x1: 12.5, y1: 1 }, horizontal: true, n: 2 };
  // No line within the standoff band at all.
  const tight = placeArtCluster(art, { ...ROOM, taken: ROOM.lights, opt: { maxStandoffFt: 1.5 } });
  ok(!tight.spots, 'no parallel line close enough -> no spots');
  ok(/parallel to this wall/.test(tight.rejected), `and it says why: "${tight.rejected}"`);
  // A line, but every position on it is on top of something already there.
  const crowded = placeArtCluster(art, { ...ROOM, taken: ROOM.lights, opt: { clearOfFittingFt: 40 } });
  ok(!crowded.spots, 'nowhere clear of the fittings already there -> no spots');
  ok(/already there/.test(crowded.rejected), `and says that instead: "${crowded.rejected}"`);
  // NEVER A PARTIAL ROW. Whatever the reason, the answer is n or 0.
  for (const r of [tight, crowded]) ok((r.spots?.length ?? 0) === 0, 'never half a row');
}
{
  // A no-light zone over the only usable line.
  const art = { id: 'e', rect: { x0: 7, y0: 0, x1: 12.5, y1: 1 }, horizontal: true, n: 2 };
  const res = placeArtCluster(art, {
    ...ROOM, taken: ROOM.lights,
    zones: [{ x0: 0, y0: 2, x1: 20, y1: 5 }],
  });
  ok(!res.spots && /no-light zone/.test(res.rejected),
    `the ceiling's own rules still apply, and are quoted: "${res.rejected}"`);
}

console.log('\n-- two pieces on one wall stay out of each other --');
{
  const a = { id: 'a', rect: { x0: 7, y0: 0, x1: 12.5, y1: 1 }, horizontal: true, n: 2 };
  const b = { id: 'b', rect: { x0: 8, y0: 0, x1: 13, y1: 1 }, horizontal: true, n: 2 };
  const rows = planArtSpots([a, b], { ...ROOM, taken: ROOM.lights });
  const pts = rows.flatMap((r) => r.spots ?? []);
  ok(rows[0].spots?.length === 2, 'the first row lands');
  if (rows[1].spots) {
    let min = Infinity;
    for (const p of rows[0].spots) for (const q of rows[1].spots) {
      min = Math.min(min, Math.hypot(p.x - q.x, p.y - q.y));
    }
    ok(min >= ART_SPOT.clearOfFittingFt - 1e-9,
      `and the second keeps clear of it — closest pair ${min.toFixed(2)} ft`);
  } else {
    ok(/already there|parallel/.test(rows[1].rejected),
      `or is dropped with a reason rather than overlapping: "${rows[1].rejected}"`);
  }
  ok(pts.length % 2 === 0, 'and every row is whole');
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
