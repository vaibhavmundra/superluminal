import assert from 'node:assert/strict';
import { mergeRoomProposals } from '../src/features/recognition/roomProposals.js';
import { collectBedRows, rejectionSummary } from '../src/features/recognition/bedResults.js';
import { mapLimit } from '../src/lib/mapLimit.js';

const box = (x, y, w = 100, h = 100) => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];
const source = {
  fromDu: ({ x, y }) => ({ x: x * 2, y: y * 2 }),
  toDu: ({ x, y }) => ({ x: x / 2, y: y / 2 }),
};
const traced = { id: 'traced', name: 'Kitchen', pointsDu: box(0, 0, 50, 50) };
const reviewed = { id: 'reviewed', detected: true, reviewed: true,
  name: 'Space 1', pointsDu: box(100, 0, 50, 50) };
const untouched = { id: 'old', detected: true, reviewed: false, pointsDu: box(200, 0) };
const proposals = [
  { pointsPx: box(0, 0), label: 'Duplicate traced' },
  { pointsPx: box(200, 0), label: 'Duplicate reviewed' },
  { pointsPx: box(400, 0), label: 'Kitchen', confidence: 0.9,
    why: 'walls', note: 'check', enclosingPx: [box(420, 20, 10, 10)] },
  { pointsPx: box(400, 0), label: 'Duplicate new' },
  { pointsPx: box(600, 0), label: 'Bedroom' },
  { pointsPx: box(800, 0), label: 'Bedroom' },
];
const originals = structuredClone({ traced, reviewed, untouched, proposals });
const meta = { rejected: [{ reason: 'tiny' }] };
let serial = 0;
const merge = (os, ps = proposals) => mergeRoomProposals(os, {
  proposals: ps, source, meta, ms: 123, makeId: () => `new-${++serial}`,
});
const result = merge([traced, reviewed, untouched]);
assert.equal(result.outlines[0], traced, 'hand work survives by identity');
assert.equal(result.outlines[1], reviewed, 'reviewed proposals survive by identity');
assert.deepEqual(result.outlines.map((o) => o.name), ['Kitchen', 'Space 1', 'Space 2', 'Bedroom', 'Space 3']);
assert.deepEqual(result.roomState, { status: 'done', ms: 123, proposed: 3, returned: 6, dropped: 1, meta });
assert.deepEqual(result.outlines[2], {
  id: 'new-1', name: 'Space 2', rectify: false, detected: true, reviewed: false,
  confidence: 0.9, why: 'walls', note: 'check',
  pointsDu: proposals[2].pointsPx.map(source.toDu),
  enclosingDu: [proposals[2].enclosingPx[0].map(source.toDu)],
});
assert.equal(result.outlines[3].confidence, null);
assert.equal(result.outlines[3].enclosingDu, null);
assert.deepEqual({ traced, reviewed, untouched, proposals }, originals, 'the merge does not mutate document or response');
assert.deepEqual(merge([traced, untouched], []).outlines, [traced], 'empty success drops only untouched proposals');
// Exactly 0.5 IoU is accepted; the original rule is strictly greater than 0.5.
assert.equal(merge([traced], [{ pointsPx: box(0, 0, 50, 100) }]).roomState.proposed, 1);
assert.equal(merge([traced], [{ pointsPx: box(0, 0, 51, 100) }]).roomState.proposed, 0);

assert.equal(rejectionSummary([]), null);
assert.deepEqual(rejectionSummary([
  { reason: '10.6ft across' }, { reason: '8.8ft across' },
  { reason: '4.1:1 ratio' }, { reason: '5.1:1 ratio' }, { reason: 'confidence' },
]), { n: 5, top: '… across', topCount: 2 }, 'measurement grouping and first-seen tie order survive');
assert.deepEqual(rejectionSummary([{ reason: '200 sqft area', cls: 'mattress' }]),
  { n: 1, top: '… area', topCount: 1 }, 'the live bed-filter summary includes all classes');

const bed = (id, x, y) => ({ id, cls: 'bed', rect: { x0: x, y0: y, x1: x + 10, y1: y + 10 } });
const oldBed = bed('old', 10, 10), duplicate = bed('duplicate', 11, 10);
const fresh = bed('fresh', 40, 40), neighbour = bed('neighbour', 140, 40);
const rows = [null, { error: new Error('failed') }, {
  id: 'room', poly: box(0, 0), a: [1, 2, 3], b: [],
  rec: { kind: 'gpt', pick: 'openai', asked: false, winner: [duplicate, fresh, neighbour] },
}];
const before = structuredClone(rows[2]);
const collected = collectBedRows(rows, [oldBed]);
assert.deepEqual(collected.found, [{ ...fresh, roomId: 'room', contest: 'gpt' }]);
assert.deepEqual(collected.verdicts.room, {
  kind: 'gpt', pick: 'openai', asked: false, confidence: 0, why: '',
  fellBack: false, failed: false, refound: true,
  // Preserve the legacy row.a/row.b mapping, even for the OpenAI-only fallback.
  counts: { roboflow: 3, openai: 0 }, kept: 2, fresh: 1,
});
assert.deepEqual(rows[2], before);
assert.deepEqual(collectBedRows([], [oldBed]), { found: [], verdicts: {} });
assert.equal(collectBedRows([{ ...rows[2], poly: null }], [oldBed]).found.length, 3,
  'without a polygon the existing-bed containment filter is intentionally empty');
assert.equal(collectBedRows([{ ...rows[2], rec: { kind: 'none' } }], []).verdicts.room.kept, 0);

// The shared worker pool keeps result order, bounds concurrency and captures errors.
let active = 0, peak = 0;
const failure = new Error('one item failed');
const pooled = await mapLimit([0, 1, 2, 3], 2, async (n, i) => {
  assert.equal(n, i);
  active++; peak = Math.max(peak, active);
  await new Promise((resolve) => setTimeout(resolve, n === 0 ? 10 : 0));
  active--;
  if (n === 2) throw failure;
  return n * 2;
});
assert.equal(peak, 2);
assert.deepEqual(pooled, [0, 2, { error: failure }, 6]);
assert.deepEqual(await mapLimit([], 2, () => assert.fail('empty pool invoked callback')), []);
console.log('recognition — room merges, bed results and bounded concurrency passed');
