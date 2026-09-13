// tools/test-dimension-intelligence.mjs — the scale, read off a drawing that states it.
import { reassemble, readDimension, inferBareUnit,
         findChains, chainCandidates,
         orientedExtent, matchPair, roomCandidates,
         consensus, readScale, statedRecord } from '../src/features/dimension-intelligence/index.js';
import { readLength, bareNumbers } from '../src/features/dimension-intelligence/dimText.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`); } };
const near = (a, b, t) => Number.isFinite(a) && Math.abs(a - b) <= t;
const sec = (s) => console.log('\n' + s);
/** A plain median, only so a test can show what the cluster rule beats. */
const median9 = (xs) => { const q = [...xs].sort((a, b) => a - b); return q[q.length >> 1]; };

const PPF = 20;   // px per foot, the answer every case below should reach

/** A text run placed by its CENTRE, which is what a dimension is centred on. */
const txt = (str, cx, cy, { w = null, h = 10, rot = 0 } = {}) => {
  const wid = w ?? str.length * 6;
  return { str, w: wid, h, rot,
           x: cx - (wid / 2) * Math.cos(rot), y: cy - (wid / 2) * Math.sin(rot) };
};
/** A rectangle in px. */
const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

sec('reading one length');
{
  ok('feet and inches', near(readLength(`18'-6"`), 18.5, 1e-9), `${readLength(`18'-6"`)}`);
  ok('feet and inches, no dash', near(readLength(`18' 6"`), 18.5, 1e-9));
  ok('whole feet', near(readLength(`18'-0"`), 18, 1e-9));
  ok('bare feet mark', near(readLength(`12'`), 12, 1e-9));
  ok('decimal with unit', near(readLength('18.5 ft'), 18.5, 1e-9));
  ok('millimetres', near(readLength('3600mm'), 11.811, 0.001), `${readLength('3600mm')}`);
  ok('metres', near(readLength('3.6m'), 11.811, 0.001));
  ok('bare number takes the sheet unit', near(readLength('3600', 'mm'), 11.811, 0.001));
  ok('bare number as feet', near(readLength('18', 'ft'), 18, 1e-9));
  ok('nothing in a word', readLength('BEDROOM') === null);
}

sec('which unit a naked number is in');
{
  ok('a millimetre sheet', inferBareUnit([3600, 4200, 2400, 900]) === 'mm');
  ok('a foot sheet', inferBareUnit([18, 12, 10, 14]) === 'ft');
  ok('an empty sheet defaults to feet', inferBareUnit([]) === 'ft');
  ok('units already stated are not counted',
     bareNumbers([{ str: `18'-0"` }, { str: '3600' }]).join() === '3600');
}

sec('reading a line as a dimension');
{
  const pair = readDimension({ str: `18'-0" X 12'-0"` });
  ok('a pair comes back as a pair', pair?.kind === 'pair');
  ok('...with both numbers', near(pair?.a, 18, 1e-9) && near(pair?.b, 12, 1e-9));
  const named = readDimension({ str: `BEDROOM 18'-0" X 12'-0"` });
  ok('a room name in front does not stop it', named?.kind === 'pair' && near(named.a, 18, 1e-9));
  const mm = readDimension({ str: '3600 X 4200' }, 'mm');
  ok('a millimetre pair', mm?.kind === 'pair' && near(mm.a, 11.811, 0.001));
  ok('a single', readDimension({ str: '3600' }, 'mm')?.kind === 'single');
  ok('a room name alone is not a dimension', readDimension({ str: 'BEDROOM' }) === null);
  ok('a sheet number is not a dimension', readDimension({ str: 'SHEET NO: 02' }) === null);
  ok('a revision is not a dimension', readDimension({ str: 'REV. NO. :07' }) === null);
  // THE ONE THAT WOULD HAVE BEEN A WRONG RULER: a space label reads as a bare
  // number through the naked-number branch unless the whole string is numeric.
  ok('a space label is not a dimension', readDimension({ str: 'Space 12' }) === null);
}

sec('reassembling text a PDF handed over in pieces');
{
  // `18'-0" X 12'-0"` as six runs on one baseline, which is what pdf.js does.
  const parts = ['18', `'`, '-0"', ' X ', '12', `'-0"`];
  let x = 0;
  const items = parts.map((s) => { const it = { str: s, x, y: 100, w: s.length * 6, h: 10, rot: 0 }; x += s.length * 6 + 1; return it; });
  const lines = reassemble(items);
  ok('six runs become one line', lines.length === 1, `${lines.length}`);
  ok('and the line reads as a pair', readDimension(lines[0])?.kind === 'pair', lines[0]?.str);

  // Two labels far apart on the same baseline must NOT join.
  const far = reassemble([txt('3600', 100, 200), txt('4200', 400, 200)]);
  ok('a wide gap cuts the line', far.length === 2, `${far.length}`);

  // Different baselines never join.
  const stacked = reassemble([txt('BEDROOM', 100, 100), txt(`18'-0" X 12'-0"`, 100, 130)]);
  ok('a name above a size stays two lines', stacked.length === 2, `${stacked.length}`);
}

sec('a dimension chain — no geometry read at all');
{
  // 10ft, 12.5ft, 8ft along a wall at 20 px/ft, each label centred on its run.
  const c1 = 10 * PPF / 2;                       // 100
  const c2 = 10 * PPF + 12.5 * PPF / 2;          // 325
  const c3 = 22.5 * PPF + 8 * PPF / 2;           // 530
  const items = [txt(`10'-0"`, c1, 50), txt(`12'-6"`, c2, 50), txt(`8'-0"`, c3, 50)];
  const lines = reassemble(items);
  ok('three labels, three lines', lines.length === 3, `${lines.length}`);
  const entries = lines.map((line) => ({ line, dim: readDimension(line) }))
    .filter((e) => e.dim?.kind === 'single');
  ok('all three read as singles', entries.length === 3, `${entries.length}`);

  const chains = findChains(entries);
  ok('they form one chain', chains.length === 1 && chains[0].entries.length === 3);
  const cands = chainCandidates(entries);
  ok('a chain of three gives two estimates', cands.length === 2, `${cands.length}`);
  ok('and both land on the real scale',
     cands.every((c) => near(c.pxPerFt, PPF, 0.001)), cands.map((c) => c.pxPerFt.toFixed(3)).join(' '));
}

sec('a chain in millimetres, running vertically');
{
  const rot = Math.PI / 2;
  const mk = (s, d) => txt(s, 50 + 0 * d, d, { rot });   // along +y
  const c1 = 3600 / 304.8 * PPF / 2;
  const c2 = 3600 / 304.8 * PPF + 4200 / 304.8 * PPF / 2;
  const items = [mk('3600', c1), mk('4200', c2)];
  const lines = reassemble(items);
  const bare = inferBareUnit(bareNumbers(lines));
  ok('the sheet reads as millimetres', bare === 'mm');
  const entries = lines.map((line) => ({ line, dim: readDimension(line, bare) }))
    .filter((e) => e.dim?.kind === 'single');
  const cands = chainCandidates(entries);
  ok('a rotated chain still measures', cands.length === 1 && near(cands[0].pxPerFt, PPF, 0.01),
     cands.map((c) => c.pxPerFt.toFixed(3)).join(' '));
}

sec("a room that states its own size");
{
  const ext = orientedExtent(rect(0, 0, 18 * PPF, 12 * PPF));
  ok('an axis-aligned room measures itself', near(ext.w, 360, 1e-6) && near(ext.h, 240, 1e-6));
  ok('...and is rectangular', near(ext.rectangularity, 1, 1e-6));

  const m = matchPair({ a: 18, b: 12 }, ext);
  ok('both ratios agree', m && near(m.pxPerFt, PPF, 1e-6) && m.disagree < 1e-6);
  ok('and it was not flipped', m && !m.flipped);

  const sw = matchPair({ a: 12, b: 18 }, ext);
  ok('a label written the other way round still matches',
     sw && near(sw.pxPerFt, PPF, 1e-6) && sw.flipped);

  ok('a label that does not fit the room is refused',
     matchPair({ a: 30, b: 9 }, ext) === null);
}

sec('a room drawn on an angle');
{
  const a = Math.PI / 7;
  const rot = (p) => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a),
                        y: p.x * Math.sin(a) + p.y * Math.cos(a) });
  const tilted = rect(0, 0, 18 * PPF, 12 * PPF).map(rot);
  const ext = orientedExtent(tilted);
  ok('the oriented extent is the room, not its bounding box',
     near(ext.w, 360, 0.01) && near(ext.h, 240, 0.01), `${ext.w.toFixed(1)} x ${ext.h.toFixed(1)}`);
  ok('a tilted room still matches', near(matchPair({ a: 18, b: 12 }, ext)?.pxPerFt, PPF, 0.01));
}

sec('an L-shaped room is refused, because its extent is not its size');
{
  const L = [{ x: 0, y: 0 }, { x: 360, y: 0 }, { x: 360, y: 120 },
             { x: 180, y: 120 }, { x: 180, y: 240 }, { x: 0, y: 240 }];
  const ext = orientedExtent(L);
  ok('it reads as not rectangular', ext.rectangularity < 0.86, `${ext.rectangularity.toFixed(2)}`);
  const cands = roomCandidates(
    [{ line: txt(`18'-0" X 12'-0"`, 90, 60), dim: { kind: 'pair', a: 18, b: 12, raw: '18x12' } }],
    [{ id: 'r1', pts: L }]);
  ok('so no candidate comes from it', cands.length === 0, `${cands.length}`);
}

sec('labels matched to the rooms they sit in');
{
  const outlines = [
    { id: 'r1', name: 'BED', pts: rect(0, 0, 18 * PPF, 12 * PPF) },
    { id: 'r2', name: 'LIVING', pts: rect(400, 0, 20 * PPF, 14 * PPF) },
  ];
  const entries = [
    { line: txt(`18'-0" X 12'-0"`, 180, 120), dim: readDimension({ str: `18'-0" X 12'-0"` }) },
    { line: txt(`20'-0" X 14'-0"`, 600, 140), dim: readDimension({ str: `20'-0" X 14'-0"` }) },
    // A label outside every outline is not evidence about any of them.
    { line: txt(`9'-0" X 9'-0"`, 2000, 2000), dim: readDimension({ str: `9'-0" X 9'-0"` }) },
  ];
  const cands = roomCandidates(entries, outlines);
  ok('two rooms, two candidates', cands.length === 2, `${cands.length}`);
  ok('both agree on the scale', cands.every((c) => near(c.pxPerFt, PPF, 1e-6)));
  ok('each names its room', cands.some((c) => c.roomId === 'r1') && cands.some((c) => c.roomId === 'r2'));
}

sec('consensus — the bar for skipping the step');
{
  const c = (v, source = 'room') => ({ pxPerFt: v, source, detail: String(v) });
  const good = consensus([c(20), c(20.1), c(19.95)]);
  ok('three that agree is a scale', good.ok && near(good.pxPerFt, 20, 0.11), `${good.pxPerFt}`);

  const one = consensus([c(20)]);
  ok('one alone is refused', !one.ok, one.reason);
  ok('...and says why', /one cannot check itself/.test(one.reason));

  const split = consensus([c(20), c(35)]);
  ok('two that disagree is refused', !split.ok, split.reason);

  const outlier = consensus([c(20), c(20.05), c(19.98), c(41)]);
  ok('an outlier is dropped, not averaged in',
     outlier.ok && near(outlier.pxPerFt, 20, 0.1), `${outlier.pxPerFt}`);
  ok('and it is recorded as rejected', outlier.rejected.length === 1);

  const mixed = consensus([c(20, 'chain'), c(20.05, 'room'), c(19.99, 'room')]);
  ok('two kinds of evidence reads as high confidence', mixed.confidence === 'high');

  ok('nothing found is refused', !consensus([]).ok);
}

sec('end to end — a plan that states its rooms');
{
  const outlines = [
    { id: 'r1', name: 'BED 1', pts: rect(0, 0, 18 * PPF, 12 * PPF) },
    { id: 'r2', name: 'BED 2', pts: rect(400, 0, 14 * PPF, 11 * PPF) },
    { id: 'r3', name: 'LIVING', pts: rect(0, 300, 20 * PPF, 16 * PPF) },
  ];
  const textItems = [
    txt('BED 1', 180, 100), txt(`18'-0" X 12'-0"`, 180, 130),
    txt('BED 2', 600, 100), txt(`14'-0" X 11'-0"`, 600, 130),
    txt('LIVING', 200, 380), txt(`20'-0" X 16'-0"`, 200, 410),
    txt('PROJECT: SOMETHING', 900, 900), txt('SHEET NO: 02', 900, 930),
  ];
  const v = readScale({ textItems, outlines });
  ok('it reads the scale', v.ok, v.reason || '');
  ok('and gets it right', near(v.pxPerFt, PPF, 0.01), `${v.pxPerFt}`);
  ok('three rooms corroborate it', v.used.length === 3, `${v.used.length}`);
  ok('the title block contributed nothing', v.candidates.length === 3);

  const rec = statedRecord(v);
  ok('the saved record carries the number', near(rec.pxPerFt, PPF, 0.01));
  ok('...and what it was read from', rec.from.length === 3 && rec.from[0].source === 'room');
}

sec('end to end — a plan with a chain and no room sizes');
{
  const c1 = 10 * PPF / 2, c2 = 10 * PPF + 12.5 * PPF / 2, c3 = 22.5 * PPF + 8 * PPF / 2;
  const v = readScale({
    textItems: [txt(`10'-0"`, c1, 50), txt(`12'-6"`, c2, 50), txt(`8'-0"`, c3, 50)],
    outlines: [],
  });
  ok('a chain alone is enough', v.ok, v.reason || '');
  ok('and it is right', near(v.pxPerFt, PPF, 0.01), `${v.pxPerFt}`);
}

/* --- THE THREE THINGS A REAL DENSELY DIMENSIONED PLAN BROKE ---------------
   Every number below is measured off `public/samples/floor_plan_dim_intelligence.pdf`,
   which read as "no dimensions" until each of these was fixed. They are kept as
   geometry rather than as a PDF fixture so the suite stays free of pdfjs. */
sec('a dense chain: neighbouring figures must not glue together');
{
  // Real gaps between neighbouring figures on that sheet run 0.54h to 11.8h at
  // h = 12.1 — so anything that joins at "about a space" joins the whole chain.
  const h = 12.1;
  const mk = (str, x) => ({ str, x, y: 500, w: str.length * 6, h, rot: 0 });
  const tight = reassemble([mk('205', 0), mk('425', 18 + 0.54 * h)]);
  ok('figures 0.54 heights apart stay two lines', tight.length === 2, `${tight.length}`);
  ok('...and neither is a glued pair',
     tight.every((l) => !/\s/.test(l.str)), tight.map((l) => l.str).join(' | '));

  // ...while a string pdf.js split mid-token still comes back whole.
  const split = reassemble([mk('18', 0), mk(`'-0"`, 12), mk(' X ', 36), mk(`12'-0"`, 54)]);
  ok('a run split by kerning still joins', split.length === 1, split.map((l) => l.str).join(' | '));
}

sec('a dense chain: a stacked second row is a different chain');
{
  // A figure too wide for its own segment goes on a row below. On that sheet
  // 25 figures sit at y=1292 and 3 more at y=1306 — 14px apart at h=12.1.
  const h = 12.1;
  const row = (y, vals) => vals.map((v, i) => txt(v, 300 + i * 120, y, { h }));
  const entries = reassemble([...row(1292, ['1800', '1200', '2400']), ...row(1306, ['169', '130'])])
    .map((line) => ({ line, dim: readDimension(line, 'mm') }))
    .filter((e) => e.dim?.kind === 'single');
  const chains = findChains(entries);
  ok('two rows 1.2 heights apart are two chains', chains.length === 2,
     `${chains.length}: ${chains.map((c) => c.entries.length).join('+')}`);
}

sec('a chain where not every segment carries a figure');
{
  /* THE CONTAMINATION IS ONE-DIRECTIONAL, which is why the median had to go.
     Where a segment is too short to label, two figures that look adjacent have
     unlabelled wall between them, so the span is credited with too few feet and
     reads as too MANY px/ft — never too few. On the real sheet the true 25.7
     was 34 of 57 pairs and the rest ran 28 to 70. */
  const c = (v) => ({ pxPerFt: v, source: 'chain', detail: String(v) });
  const truth = [20, 20.1, 19.95, 20.05];
  const skipped = [31, 37, 44, 51, 58];        // all higher, none agreeing
  const v = consensus([...truth, ...skipped].map(c));
  ok('the tight group wins even as a minority of the sample', v.ok, v.reason || '');
  ok('...and it is the true scale', near(v.pxPerFt, 20, 0.06), `${v.pxPerFt}`);
  ok('...which a plain median would have missed',
     near(median9([...truth, ...skipped]), 31, 1e-9), `${median9([...truth, ...skipped])}`);
  ok('every skipped-segment pair is rejected', v.rejected.length === 5, `${v.rejected.length}`);

  // Scattered values that agree with nothing are still refused.
  ok('no cluster is still no answer', !consensus([20, 31, 44, 58].map(c)).ok);
}

sec('whether it is still worth waiting for the room detector');
{
  /* A chain settles from the text alone, so nothing is pending — and it takes
     THREE figures, not two: two give a single estimate and MIN_AGREE is 2,
     because one estimate has nothing to check itself against. */
  const c1 = 10 * PPF / 2, c2 = 10 * PPF + 12.5 * PPF / 2, c3 = 22.5 * PPF + 8 * PPF / 2;
  const short = readScale({ textItems: [txt(`10'-0"`, c1, 50), txt(`12'-6"`, c2, 50)], outlines: [] });
  ok('two figures is one estimate, and one is refused', !short.ok, short.reason);
  const chain = readScale({
    textItems: [txt(`10'-0"`, c1, 50), txt(`12'-6"`, c2, 50), txt(`8'-0"`, c3, 50)], outlines: [] });
  ok('three figures settle it with no outlines', chain.ok && chain.pairsFound === 0);

  // Room sizes with no outlines YET — this is the case the door step waits on.
  const waiting = readScale({
    textItems: [txt(`18'-0" X 12'-0"`, 180, 130), txt(`14'-0" X 11'-0"`, 600, 130)],
    outlines: [],
  });
  ok('room sizes with no outlines yet is not an answer', !waiting.ok);
  ok('...but it says two are pending', waiting.pairsFound === 2, `${waiting.pairsFound}`);

  // Nothing a polygon could ever unlock.
  const nothing = readScale({
    textItems: [txt('KITCHEN', 100, 100), txt('SHEET NO: 02', 900, 930)], outlines: [] });
  ok('a sheet with no room sizes has nothing pending', nothing.pairsFound === 0);

  /* A TITLE BLOCK IS NOT EVIDENCE. `SCALE = N.T.S` used to veto the sheet, then
     to demand extra corroboration. Both were wrong: every sample plan in this
     repo carries the stamp, including ones dimensioned end to end. It is
     ordinary text now and changes nothing about the reading. */
  const stamped = readScale({
    textItems: [txt('SCALE = N.T.S', 900, 900),
                txt(`10'-0"`, 10 * PPF / 2, 50),
                txt(`12'-6"`, 10 * PPF + 12.5 * PPF / 2, 50),
                txt(`8'-0"`, 22.5 * PPF + 8 * PPF / 2, 50)],
    outlines: [] });
  ok('a sheet stamped N.T.S still reads', stamped.ok, stamped.reason);
  ok('...at the right scale', near(stamped.pxPerFt, PPF, 0.01), `${stamped.pxPerFt}`);
}

sec('end to end — a plan with nothing on it');
{
  const v = readScale({
    textItems: [txt('KITCHEN', 100, 100), txt('BEDROOM', 300, 100), txt('SCALE = N.T.S', 900, 900)],
    outlines: [{ id: 'r1', pts: rect(0, 0, 360, 240) }],
  });
  ok('no dimensions means no scale', !v.ok, v.reason);
  ok('the door route is what happens next', v.pxPerFt === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
