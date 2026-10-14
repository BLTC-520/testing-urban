/**
 * Client-side accessibility maths — mirrors src/sgjb/metrics.py so that the
 * explorer can recompute any speed / threshold / category combination instantly.
 */
import { cellToParent } from "h3-js";

export const NO_DATA = 255;

/** Number of selected categories reachable within `thresholdMin` (255 = off-network). */
export function categoriesReached(
  n: number,
  d: Record<string, Float32Array>,
  categories: string[],
  speed: number,
  thresholdMin: number,
): Uint8Array {
  const out = new Uint8Array(n);
  const limit = thresholdMin * 60 * speed;
  const cols = categories.map((c) => d[c]);
  for (let i = 0; i < n; i++) {
    let k = 0;
    let missing = 0;
    for (const col of cols) {
      const v = col[i];
      if (Number.isNaN(v)) missing++;
      else if (v <= limit) k++;
    }
    out[i] = missing === cols.length ? NO_DATA : k;
  }
  return out;
}

export interface Shares {
  population: number;
  complete: number;
  low: number;
  histogram: number[];
  mean: number;
}

/** Population-weighted shares (complete / low access) and the 0…K histogram. */
export function shares(reached: Uint8Array, weights: ArrayLike<number>, k: number, lowShare = 0.5): Shares {
  const hist = new Array(k + 1).fill(0);
  let tot = 0;
  let mean = 0;
  for (let i = 0; i < reached.length; i++) {
    const r = reached[i];
    if (r === NO_DATA) continue;
    const w = weights[i];
    hist[r] += w;
    tot += w;
    mean += w * r;
  }
  const histogram = hist.map((h) => (tot > 0 ? h / tot : 0));
  let low = 0;
  for (let r = 0; r <= k; r++) if (r < lowShare * k) low += histogram[r];
  return { population: tot, complete: histogram[k], low, histogram, mean: tot > 0 ? mean / tot : NaN };
}

/** Weighted median of minutes to the nearest destination. */
export function weightedMedianMinutes(d: Float32Array, weights: ArrayLike<number>, speed: number): number {
  const idx: number[] = [];
  for (let i = 0; i < d.length; i++) if (Number.isFinite(d[i]) && weights[i] > 0) idx.push(i);
  idx.sort((a, b) => d[a] - d[b]);
  let tot = 0;
  for (const i of idx) tot += weights[i];
  let acc = 0;
  for (const i of idx) {
    acc += weights[i];
    if (acc >= tot / 2) return d[i] / speed / 60;
  }
  return NaN;
}

export interface Aggregate {
  hex: string;
  /** population-weighted mean of the value */
  value: number;
  pop: number;
}

/**
 * Aggregate per-cell values to a coarser H3 resolution (population-weighted),
 * so low zoom levels show a legible surface rather than sub-pixel hexagons.
 */
export function aggregate(h3: string[], values: ArrayLike<number>, weights: ArrayLike<number>, res: number, skip = NO_DATA): Aggregate[] {
  const acc = new Map<string, { w: number; wv: number; pop: number }>();
  for (let i = 0; i < h3.length; i++) {
    const v = values[i];
    if (v === skip || Number.isNaN(v)) continue;
    const p = cellToParent(h3[i], res);
    const w = weights[i];
    let a = acc.get(p);
    if (!a) {
      a = { w: 0, wv: 0, pop: 0 };
      acc.set(p, a);
    }
    // unpopulated cells still count a little so the surface has no holes in parks / industry
    const ww = w + 1e-3;
    a.w += ww;
    a.wv += ww * v;
    a.pop += w;
  }
  const out: Aggregate[] = [];
  for (const [hex, a] of acc) out.push({ hex, value: a.wv / a.w, pop: a.pop });
  return out;
}
