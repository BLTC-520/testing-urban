import { describe, expect, it } from "vitest";
import { boundedDijkstra, csrFromEdges, MinHeap } from "./dijkstra";

/** Reference: O(n²) Dijkstra without a heap. */
function naive(n: number, edges: [number, number, number][], src: number[], cost: number[]): number[] {
  const adj: [number, number][][] = Array.from({ length: n }, () => []);
  for (const [a, b, w] of edges) {
    adj[a].push([b, w]);
    adj[b].push([a, w]);
  }
  const dist = new Array(n).fill(Infinity);
  const done = new Array(n).fill(false);
  src.forEach((s, i) => (dist[s] = Math.min(dist[s], cost[i])));
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0) break;
    done[u] = true;
    for (const [v, w] of adj[u]) dist[v] = Math.min(dist[v], dist[u] + w);
  }
  return dist;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe("MinHeap", () => {
  it("pops in ascending order", () => {
    const h = new MinHeap(2);
    const vals = [5, 3, 9, 1, 7, 1, 0, 12];
    vals.forEach((v, i) => h.push(v, i));
    const out = new Float64Array(1);
    const got: number[] = [];
    while (h.size) {
      h.pop(out);
      got.push(out[0]);
    }
    expect(got).toEqual([...vals].sort((a, b) => a - b));
  });
});

describe("boundedDijkstra", () => {
  it("matches a naive reference on random graphs", () => {
    for (let seed = 1; seed <= 5; seed++) {
      const r = rng(seed);
      const n = 120;
      const edges: [number, number, number][] = [];
      for (let k = 0; k < 400; k++) {
        const a = Math.floor(r() * n);
        const b = Math.floor(r() * n);
        if (a !== b) edges.push([a, b, 1 + r() * 99]);
      }
      const g = csrFromEdges(n, edges.map((e) => e[0]), edges.map((e) => e[1]), edges.map((e) => e[2]));
      const src = [0, 7];
      const cost = [0, 12.5];
      const got = boundedDijkstra(g, src, cost, Infinity);
      const ref = naive(n, edges, src, cost);
      for (let i = 0; i < n; i++) {
        if (ref[i] === Infinity) expect(got[i]).toBe(Infinity);
        else expect(got[i]).toBeCloseTo(ref[i], 3);
      }
    }
  });

  it("respects the cutoff", () => {
    const g = csrFromEdges(4, [0, 1, 2], [1, 2, 3], [10, 10, 10]);
    const d = boundedDijkstra(g, [0], [0], 25);
    expect(Array.from(d)).toEqual([0, 10, 20, Infinity]);
  });
});
