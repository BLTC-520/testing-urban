/**
 * Bounded multi-source Dijkstra on a CSR graph (binary heap, lazy deletion).
 * Mirrors sgjb.dijkstra in the pipeline; used in the browser for live isochrones.
 */

export interface CSRGraph {
  /** indptr[n + 1] */
  indptr: Int32Array;
  indices: Int32Array;
  /** metres */
  weights: Float32Array;
}

export class MinHeap {
  private cost: Float64Array;
  private node: Int32Array;
  size = 0;

  constructor(capacity = 1024) {
    this.cost = new Float64Array(capacity);
    this.node = new Int32Array(capacity);
  }

  push(c: number, n: number): void {
    if (this.size === this.cost.length) this.grow();
    let i = this.size++;
    const hc = this.cost;
    const hn = this.node;
    hc[i] = c;
    hn[i] = n;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hc[p] <= hc[i]) break;
      const tc = hc[p];
      hc[p] = hc[i];
      hc[i] = tc;
      const tn = hn[p];
      hn[p] = hn[i];
      hn[i] = tn;
      i = p;
    }
  }

  /** Pops the minimum; returns its node and writes its cost to out[0]. */
  pop(out: Float64Array): number {
    const hc = this.cost;
    const hn = this.node;
    const c = hc[0];
    const n = hn[0];
    const size = --this.size;
    if (size > 0) {
      hc[0] = hc[size];
      hn[0] = hn[size];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= size) break;
        const r = l + 1;
        const m = r < size && hc[r] < hc[l] ? r : l;
        if (hc[m] >= hc[i]) break;
        const tc = hc[m];
        hc[m] = hc[i];
        hc[i] = tc;
        const tn = hn[m];
        hn[m] = hn[i];
        hn[i] = tn;
        i = m;
      }
    }
    out[0] = c;
    return n;
  }

  private grow(): void {
    const c = new Float64Array(this.cost.length * 2);
    c.set(this.cost);
    const n = new Int32Array(this.node.length * 2);
    n.set(this.node);
    this.cost = c;
    this.node = n;
  }
}

/**
 * Distances (metres) from the nearest source to every node within `cutoff`.
 * Unreached nodes are +Infinity.
 */
export function boundedDijkstra(
  g: CSRGraph,
  sources: ArrayLike<number>,
  sourceCost: ArrayLike<number>,
  cutoff: number,
): Float64Array {
  const n = g.indptr.length - 1;
  const dist = new Float64Array(n).fill(Infinity);
  const heap = new MinHeap(Math.min(1 << 16, Math.max(64, g.indices.length)));
  for (let k = 0; k < sources.length; k++) {
    const s = sources[k];
    const c = sourceCost[k];
    if (c < dist[s] && c <= cutoff) {
      dist[s] = c;
      heap.push(c, s);
    }
  }
  const out = new Float64Array(1);
  const { indptr, indices, weights } = g;
  while (heap.size > 0) {
    const u = heap.pop(out);
    const c = out[0];
    if (c > dist[u]) continue;
    for (let e = indptr[u]; e < indptr[u + 1]; e++) {
      const v = indices[e];
      const nc = c + weights[e];
      if (nc < dist[v] && nc <= cutoff) {
        dist[v] = nc;
        heap.push(nc, v);
      }
    }
  }
  return dist;
}

/** Build CSR (both directions) from an undirected edge list. */
export function csrFromEdges(nNodes: number, u: ArrayLike<number>, v: ArrayLike<number>, w: ArrayLike<number>): CSRGraph & { arcEdge: Int32Array } {
  const m = u.length;
  const deg = new Int32Array(nNodes + 1);
  for (let e = 0; e < m; e++) {
    deg[u[e] + 1]++;
    deg[v[e] + 1]++;
  }
  for (let i = 0; i < nNodes; i++) deg[i + 1] += deg[i];
  const indptr = deg.slice();
  const fill = deg.slice(0, nNodes);
  const indices = new Int32Array(2 * m);
  const weights = new Float32Array(2 * m);
  const arcEdge = new Int32Array(2 * m);
  for (let e = 0; e < m; e++) {
    let k = fill[u[e]]++;
    indices[k] = v[e];
    weights[k] = w[e];
    arcEdge[k] = e;
    k = fill[v[e]]++;
    indices[k] = u[e];
    weights[k] = w[e];
    arcEdge[k] = e;
  }
  return { indptr, indices, weights, arcEdge };
}
