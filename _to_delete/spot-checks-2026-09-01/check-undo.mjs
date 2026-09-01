import { newHistory, record, stepBack, stepForward, sameDoc, historyDepth,
         HISTORY_LIMIT } from '../../src/lib/undo.js';

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}` + (ok ? '' : `\n        got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};

// A document shaped like serialiseEditor's, minus everything irrelevant.
const doc = (n, view = {}) => ({
  v: 1, savedAt: new Date(1700000000000 + n).toISOString(),
  litIds: ['a'], manualSurfaces: Array.from({ length: n }, (_, i) => ({ id: `s${i}` })),
  focusId: view.focusId ?? null,
  ui: { layers: { spots: view.spots ?? true }, zoom: view.zoom ?? 1, view: 'design' },
});

// --- the viewport is invisible to the history
is('a pan is not a change', sameDoc(doc(1), doc(1, { zoom: 3 })), true);
is('a layer toggle is not a change', sameDoc(doc(1), doc(1, { spots: false })), true);
is('selecting a space is not a change', sameDoc(doc(1), doc(1, { focusId: 'r2' })), true);
is('savedAt alone is not a change', sameDoc(doc(1), { ...doc(1), savedAt: 'later' }), true);
is('a surface added IS a change', sameDoc(doc(1), doc(2)), false);

// --- recording
const h = newHistory();
is('the first document is a baseline, not a step', record(h, doc(1)), false);
is('  depth', historyDepth(h), { past: 0, future: 0 });
is('a change records', record(h, doc(2)), true);
is('  depth', historyDepth(h), { past: 1, future: 0 });
is('a pan does not record', record(h, doc(2, { zoom: 4 })), false);
is('  depth', historyDepth(h), { past: 1, future: 0 });

// --- undo / redo
record(h, doc(3));
is('two changes, two steps', historyDepth(h), { past: 2, future: 0 });
const back1 = stepBack(h, doc(3));
is('undo returns the state before the last change', back1.manualSurfaces.length, 2);
is('  depth', historyDepth(h), { past: 1, future: 1 });
const back2 = stepBack(h, back1);
is('undo again', back2.manualSurfaces.length, 1);
is('  depth', historyDepth(h), { past: 0, future: 2 });
is('nothing left to undo', stepBack(h, back2), null);
const fwd = stepForward(h, back2);
is('redo goes forward', fwd.manualSurfaces.length, 2);
is('  depth', historyDepth(h), { past: 1, future: 1 });

// --- a new change after an undo discards the redo branch
record(h, doc(9));
is('a change after undo clears redo', historyDepth(h), { past: 2, future: 0 });
is('nothing left to redo', stepForward(h, doc(9)), null);

// --- the cap
const h2 = newHistory();
record(h2, doc(0));
for (let i = 1; i <= HISTORY_LIMIT + 12; i++) record(h2, doc(i));
is(`capped at ${HISTORY_LIMIT}`, historyDepth(h2).past, HISTORY_LIMIT);
let d = doc(HISTORY_LIMIT + 12), steps = 0;
while (true) { const b = stepBack(h2, d); if (!b) break; d = b; steps++; }
is('  and every one of them walks back', steps, HISTORY_LIMIT);
is('  landing on the oldest kept state', d.manualSurfaces.length, 12);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
