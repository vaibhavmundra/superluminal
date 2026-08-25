// ---------------------------------------------------------------------------
// test-chunking.mjs — the enumeration has to be trustworthy before anyone is
// asked to choose from it. Every option must be an EXACT COVER of the free
// space: no overlap, no gap, nothing inside a wall or a zone. An option that
// quietly loses a corner of the room would look perfectly plausible on a card.
// ---------------------------------------------------------------------------

import {
  enumerateChunkings, elementaryGrid, signatureOf, findChunking,
  selectChunking, registerChunkSelector, chunkingPayload, buildChunkingPrompt,
  createClaudeChunkSelector, listChunkSelectors,
} from '../src/lib/chunking.js';
import { planLights, DEFAULTS } from '../src/lib/planner.js';
import { pointInPolygon } from '../src/lib/geometry.js';

let fails = 0, checks = 0;
const ok = (cond, what) => { checks++; if (!cond) { fails++; console.log(`   FAIL  ${what}`); } };

const R = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const L = [{x:0,y:0},{x:30,y:0},{x:30,y:12},{x:12,y:12},{x:12,y:30},{x:0,y:30}];
const U = [{x:0,y:0},{x:36,y:0},{x:36,y:26},{x:24,y:26},{x:24,y:10},{x:12,y:10},{x:12,y:26},{x:0,y:26}];
const T = [{x:0,y:0},{x:36,y:0},{x:36,y:10},{x:24,y:10},{x:24,y:30},{x:12,y:30},{x:12,y:10},{x:0,y:10}];

const CASES = [
  ['12x12 plain',            R(12,12), [],                                                        []],
  ['36x24 plain',            R(36,24), [],                                                        []],
  ['36x24 + centre zone',    R(36,24), [{x0:14,y0:8,x1:22,y1:16}],                               []],
  ['36x24 + wall zone',      R(36,24), [{x0:0,y0:0,x1:5,y1:24}],                                 []],
  ['36x24 + 2 zones + fan',  R(36,24), [{x0:4,y0:4,x1:10,y1:9},{x0:26,y0:14,x1:33,y1:21}],       [{type:'fan',x:18,y:12,r:2.5}]],
  ['36x24 + 3 fans',         R(36,24), [],                                                        [{type:'fan',x:9,y:12,r:2},{type:'fan',x:18,y:12,r:2},{type:'fan',x:27,y:12,r:2}]],
  ['L-shape',                L,        [],                                                        []],
  ['L-shape + notch zone',   L,        [{x0:8,y0:8,x1:16,y1:14}],                                []],
  ['L-shape + fan each leg', L,        [],                                                        [{type:'fan',x:6,y:20,r:2},{type:'fan',x:22,y:6,r:2}]],
  ['U-shape',                U,        [],                                                        []],
  ['T-shape',                T,        [],                                                        []],
  ['T-shape + zone + fan',   T,        [{x0:14,y0:2,x1:22,y1:8}],                                [{type:'fan',x:18,y:20,r:2.5}]],
  ['30x22 bedroom',          R(30,22), [{x0:6,y0:0,x1:15,y1:10},{x0:26,y0:8,x1:30,y1:18}],       []],
  ['0.8ft sliver',           R(36,24), [{x0:0.8,y0:0,x1:9,y1:10}],                               []],
  ['4x30 corridor + zone',   R(30,4),  [{x0:12,y0:0,x1:16,y1:4}],                                []],
  ['36x24 + 4 zones',        R(36,24), [{x0:4,y0:4,x1:9,y1:9},{x0:27,y0:4,x1:32,y1:9},
                                        {x0:4,y0:15,x1:9,y1:20},{x0:27,y0:15,x1:32,y1:20}],      []],
];

const overlap = (a, b) =>
  Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1e-9 &&
  Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 1e-9;
const inZone = (p, z) => p.x > z.x0 + 1e-9 && p.x < z.x1 - 1e-9 && p.y > z.y0 + 1e-9 && p.y < z.y1 - 1e-9;

console.log('=== every option is an exact cover of the free space ===\n');
for (const [name, poly, zones, fans] of CASES) {
  const opt = { targetCell: 6, minChunk: DEFAULTS.minChunk, fanClearance: 2 };
  const e = enumerateChunkings(poly, zones, opt, fans);
  const grid = elementaryGrid(poly, zones);
  const labels = e.options.map((o) => `${o.id}(${o.metrics.pieces})`).join(' ');
  console.log(`${name}  ->  ${e.options.length} option(s): ${labels}`);

  ok(e.options.length >= 1, `${name}: at least one option`);
  ok(e.needsChoice === (e.options.length > 1), `${name}: needsChoice matches the option count`);
  ok(!!findChunking(e.options, e.recommendedId), `${name}: the recommendation exists`);

  const sigs = new Set();
  for (const o of e.options) {
    const all = [...o.chunks, ...o.omitted];
    // 1. exact area
    const area = all.reduce((s, c) => s + c.area, 0);
    ok(Math.abs(area - grid.freeArea) < 1e-6,
       `${name}/${o.id}: covers ${area.toFixed(3)} of ${grid.freeArea.toFixed(3)} sq ft`);
    // 2. no piece overlaps another
    let dup = false;
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (overlap(all[i], all[j])) dup = true;
    ok(!dup, `${name}/${o.id}: no two pieces overlap`);
    // 3. every piece is inside the room and outside every zone
    for (const c of all) {
      const mid = { x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2 };
      const corners = [
        { x: c.x0 + 1e-4, y: c.y0 + 1e-4 }, { x: c.x1 - 1e-4, y: c.y0 + 1e-4 },
        { x: c.x1 - 1e-4, y: c.y1 - 1e-4 }, { x: c.x0 + 1e-4, y: c.y1 - 1e-4 }, mid,
      ];
      ok(corners.every((p) => pointInPolygon(p, poly)), `${name}/${o.id}: piece inside the room`);
      ok(!zones.some((z) => corners.some((p) => inZone(p, z))), `${name}/${o.id}: piece clear of every zone`);
    }
    // 4. the sliver rule, both ways
    ok(o.chunks.every((c) => Math.min(c.w, c.h) > opt.minChunk), `${name}/${o.id}: no kept chunk is a sliver`);
    ok(o.omitted.every((c) => Math.min(c.w, c.h) <= opt.minChunk), `${name}/${o.id}: no omitted piece is thick`);
    // 5. options are genuinely different
    ok(!sigs.has(o.signature), `${name}/${o.id}: not a duplicate of another option`);
    sigs.add(o.signature);
    ok(o.signature === signatureOf(o.chunks), `${name}/${o.id}: signature matches its chunks`);
  }

  // 6. deterministic — the same inputs must give the same cards every render
  const again = enumerateChunkings(poly, zones, opt, fans);
  ok(again.options.map((o) => o.id).join() === e.options.map((o) => o.id).join()
     && again.recommendedId === e.recommendedId, `${name}: enumeration is deterministic`);

  // 7. the planner lights exactly the configuration it was handed
  for (const o of e.options) {
    const r = planLights(poly, fans, { chunkStrategy: o.id }, zones);
    ok(r.ok, `${name}/${o.id}: planner produced a layout`);
    if (!r.ok) continue;
    ok(r.chunking.id === o.id && r.chunking.chosenBy === 'requested',
       `${name}/${o.id}: planner used the requested configuration`);
    ok(signatureOf(r.chunks) === o.signature, `${name}/${o.id}: planner chunks match the option`);
    ok(r.stats.served + r.stats.ceded === r.stats.cells, `${name}/${o.id}: every cell served or ceded`);
    ok(!r.cells.some((c) => zones.some((z) => overlap(c, z))), `${name}/${o.id}: no cell overlaps a zone`);
    ok(!r.lights.some((l) => zones.some((z) => inZone(l, z))), `${name}/${o.id}: no light inside a zone`);
  }
}

console.log('\n=== a plain rectangle is not a choice ===\n');
{
  const e = enumerateChunkings(R(36, 24), [], { targetCell: 6, minChunk: 1 }, []);
  console.log(`  36x24, no zones: ${e.options.length} option, needsChoice=${e.needsChoice}`);
  ok(e.options.length === 1 && !e.needsChoice, 'a plain rectangle offers exactly one option');
  ok(e.options[0].metrics.pieces === 1, 'and that option is one chunk');
  ok(e.options[0].aliases.length >= 4, 'every strategy agreed (recorded as aliases)');
}

console.log('\n=== an unknown strategy falls back rather than failing ===\n');
{
  const r = planLights(L, [], { chunkStrategy: 'no-such-strategy' }, []);
  console.log(`  asked for "no-such-strategy" -> used "${r.chunking.id}", unavailable="${r.chunking.unavailable}"`);
  ok(r.ok && r.chunking.chosenBy === 'auto' && r.chunking.unavailable === 'no-such-strategy',
     'unknown strategy falls back to the recommendation and says so');
}

console.log('\n=== an explicit chunkPlan is used verbatim ===\n');
{
  const e = enumerateChunkings(L, [], { targetCell: 6, minChunk: 1 }, []);
  const pick = e.options[e.options.length - 1];
  const r = planLights(L, [], { chunkPlan: { id: 'handed-in', chunks: pick.chunks, omitted: pick.omitted } }, []);
  console.log(`  handed in ${pick.chunks.length} rectangles -> ${r.stats.chunks} chunks, id "${r.chunking.id}"`);
  ok(r.ok && r.chunking.chosenBy === 'given' && signatureOf(r.chunks) === pick.signature,
     'an explicit chunkPlan is honoured exactly');
}

console.log('\n=== selection goes through one interface ===\n');
{
  const e = enumerateChunkings(L, [], { targetCell: 6, minChunk: 1 }, []);
  const ctx = { polygon: L, zones: [], fans: [], opt: DEFAULTS };

  const auto = await selectChunking(e.options, { mode: 'auto' });
  console.log(`  auto      -> ${auto.id}  (${auto.reason})`);
  ok(auto.id === e.recommendedId && !auto.fellBack, 'auto picks the recommendation');

  const missing = await selectChunking(e.options, { mode: 'not-registered' });
  console.log(`  missing   -> ${missing.id}  fellBack=${missing.fellBack}`);
  ok(missing.id === e.recommendedId && missing.fellBack, 'an unregistered mode falls back');

  const target = e.options[e.options.length - 1].id;
  registerChunkSelector('stub', () => ({ id: target, reason: 'because', confidence: 'high' }));
  const stub = await selectChunking(e.options, { mode: 'stub' });
  console.log(`  stub      -> ${stub.id}  by=${stub.by}`);
  ok(stub.id === target && !stub.fellBack && stub.by === 'stub', 'a registered selector is honoured');

  registerChunkSelector('liar', () => ({ id: 'nonsense' }));
  const liar = await selectChunking(e.options, { mode: 'liar' });
  ok(liar.id === e.recommendedId && liar.fellBack, 'a selector returning a bad id falls back');

  registerChunkSelector('thrower', () => { throw new Error('boom'); });
  const thrown = await selectChunking(e.options, { mode: 'thrower' });
  ok(thrown.id === e.recommendedId && thrown.fellBack, 'a selector that throws falls back');
  console.log(`  registered selectors: ${listChunkSelectors().join(', ')}`);

  // the payload a model would read: serialisable, complete, no cycles
  const payload = chunkingPayload(e.options, ctx);
  const round = JSON.parse(JSON.stringify(payload));
  ok(round.options.length === e.options.length, 'payload carries every option');
  ok(round.options.every((o) => findChunking(e.options, o.id)), 'every payload id resolves');
  ok(round.heuristicRecommendation === e.recommendedId, 'payload names the recommendation');
  ok(round.options.every((o) => o.chunks.length > 0 && typeof o.metrics.coverage === 'number'),
     'payload carries geometry and metrics');
  const prompt = buildChunkingPrompt(payload);
  ok(prompt.includes(e.options[0].id) && prompt.includes('JSON'), 'prompt embeds the payload');
  console.log(`  payload ${JSON.stringify(payload).length} bytes, prompt ${prompt.length} chars`);

  // the model-backed selector obeys the same contract, without a network
  const fake = async () => ({ ok: true, json: async () => ({ content: [{ text: `{"id":"${target}","reason":"r","confidence":"high"}` }] }) });
  const sel = createClaudeChunkSelector({ apiKey: 'k', fetchImpl: fake });
  registerChunkSelector('claude-test', sel);
  const viaModel = await selectChunking(e.options, { mode: 'claude-test', ctx });
  console.log(`  model     -> ${viaModel.id}  by=${viaModel.by}`);
  ok(viaModel.id === target && viaModel.by === 'claude' && !viaModel.fellBack,
     'the model-backed selector plugs into the same interface');
}

console.log('\n=== zones covering everything still fails loudly ===\n');
{
  const e = enumerateChunkings(R(12, 12), [{ x0: -1, y0: -1, x1: 13, y1: 13 }], { minChunk: 1 }, []);
  const r = planLights(R(12, 12), [], {}, [{ x0: -1, y0: -1, x1: 13, y1: 13 }]);
  console.log(`  options=${e.options.length}, planner ok=${r.ok} — "${r.reason}"`);
  ok(e.options.length === 0 && !e.needsChoice, 'no free space means no options');
  ok(r.ok === false && !!r.reason, 'and the planner says so rather than returning an empty layout');
}

console.log(`\nCHUNKING OVERALL: ${fails ? `FAIL (${fails} of ${checks})` : `PASS (${checks} checks)`}`);
process.exit(fails ? 1 : 0);
