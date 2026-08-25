// ---------------------------------------------------------------------------
// matching.js — maximum-weight maximum-cardinality matching on a bipartite
// graph, by successive maximum-gain augmenting paths (Bellman-Ford on the
// alternating graph). The cell graph is a grid graph, so checkerboard parity
// gives us the bipartition for free and we never need Blossom.
// ---------------------------------------------------------------------------

/**
 * @param {number} nL           number of left vertices
 * @param {number} nR           number of right vertices
 * @param {{l:number,r:number,w:number,id:any}[]} edges
 * @param {{maximizeCardinality?:boolean}} opts
 *        maximizeCardinality (default true) biases the weights so that adding
 *        one more pair always beats rearranging — cardinality first, weight
 *        second. Set it false when the weights already price what each pair is
 *        worth and you want an honest trade-off between "more pairs" and
 *        "better pairs". Augmenting along maximum-gain paths gives the optimal
 *        matching at every cardinality, so stopping once the best gain turns
 *        non-positive lands on the global optimum either way.
 * @returns {{l:number,r:number,w:number,id:any}[]} the chosen edges
 */
export function maxWeightMatching(nL, nR, edges, opts = {}) {
  if (!edges.length) return [];
  const { maximizeCardinality = true } = opts;

  const maxW = Math.max(...edges.map((e) => Math.abs(e.w)));
  const BIAS = maximizeCardinality ? maxW * 4 * (nL + nR) + 1 : 0;

  const adjL = Array.from({ length: nL }, () => []);
  edges.forEach((e, i) => adjL[e.l].push(i));

  const matchL = new Int32Array(nL).fill(-1); // left  -> edge index
  const matchR = new Int32Array(nR).fill(-1); // right -> edge index

  const gain = (i) => edges[i].w + BIAS;

  for (;;) {
    // Bellman-Ford over: source -> free L -> (unmatched edge, +gain)
    //   -> R -> (matched edge, -gain) -> L ... ending at a free R.
    const distL = new Float64Array(nL).fill(-Infinity);
    const distR = new Float64Array(nR).fill(-Infinity);
    const fromEdgeR = new Int32Array(nR).fill(-1);
    for (let l = 0; l < nL; l++) if (matchL[l] === -1) distL[l] = 0;

    let changed = true;
    let rounds = 0;
    while (changed && rounds++ <= nL + nR + 2) {
      changed = false;
      for (let ei = 0; ei < edges.length; ei++) {
        const e = edges[ei];
        if (matchL[e.l] === ei) continue; // matched edges are traversed R->L
        if (distL[e.l] === -Infinity) continue;
        const cand = distL[e.l] + gain(ei);
        if (cand > distR[e.r] + 1e-12) {
          distR[e.r] = cand;
          fromEdgeR[e.r] = ei;
          changed = true;
        }
      }
      for (let r = 0; r < nR; r++) {
        const mi = matchR[r];
        if (mi === -1 || distR[r] === -Infinity) continue;
        const l = edges[mi].l;
        const cand = distR[r] - gain(mi);
        if (cand > distL[l] + 1e-12) { distL[l] = cand; changed = true; }
      }
    }

    // best free right vertex reachable
    let best = -1, bestD = 0;
    for (let r = 0; r < nR; r++) {
      if (matchR[r] !== -1 || distR[r] === -Infinity) continue;
      if (best === -1 || distR[r] > bestD) { best = r; bestD = distR[r]; }
    }
    if (best === -1 || bestD <= 0) break;

    // walk the path back, flipping
    let r = best, guard = 0;
    while (r !== -1 && guard++ < nL + nR + 2) {
      const ei = fromEdgeR[r];
      if (ei === -1) break;
      const l = edges[ei].l;
      const prevEdge = matchL[l];
      matchL[l] = ei;
      matchR[r] = ei;
      if (prevEdge === -1) break;
      r = edges[prevEdge].r;
    }
  }

  const out = [];
  for (let l = 0; l < nL; l++) if (matchL[l] !== -1) out.push(edges[matchL[l]]);
  return out;
}
