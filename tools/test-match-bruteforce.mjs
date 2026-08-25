import { maxWeightMatching } from '../src/lib/matching.js';

function brute(nL, nR, edges) {
  let best = null, bestKey = [-1, -Infinity];
  const rec = (i, usedL, usedR, chosen, wsum) => {
    if (i === edges.length) {
      const key = [chosen.length, wsum];
      if (key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1] + 1e-9)) { bestKey = key; best = [...chosen]; }
      return;
    }
    rec(i + 1, usedL, usedR, chosen, wsum);
    const e = edges[i];
    if (!usedL.has(e.l) && !usedR.has(e.r)) {
      usedL.add(e.l); usedR.add(e.r); chosen.push(e);
      rec(i + 1, usedL, usedR, chosen, wsum + e.w);
      chosen.pop(); usedL.delete(e.l); usedR.delete(e.r);
    }
  };
  rec(0, new Set(), new Set(), [], 0);
  return bestKey;
}

let fails = 0;
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

for (let trial = 0; trial < 400; trial++) {
  const nL = 1 + Math.floor(rnd() * 5), nR = 1 + Math.floor(rnd() * 5);
  const edges = [];
  for (let l = 0; l < nL; l++) for (let r = 0; r < nR; r++)
    if (rnd() < 0.55) edges.push({ l, r, w: Math.round(rnd() * 100) / 10, id: `${l}-${r}` });
  if (!edges.length) continue;
  const got = maxWeightMatching(nL, nR, edges);
  const gotKey = [got.length, got.reduce((s, e) => s + e.w, 0)];
  const want = brute(nL, nR, edges);
  // validity
  const ls = new Set(got.map(e => e.l)), rs = new Set(got.map(e => e.r));
  const valid = ls.size === got.length && rs.size === got.length;
  if (!valid || gotKey[0] !== want[0] || gotKey[1] < want[1] - 1e-6) {
    fails++;
    if (fails <= 3) console.log('MISMATCH', { nL, nR, edges: edges.map(e=>`${e.l}-${e.r}:${e.w}`).join(','), got: gotKey, want, valid });
  }
}
console.log(fails === 0 ? 'matching: 400/400 random cases match brute force ✓' : `matching: ${fails} FAILURES`);
