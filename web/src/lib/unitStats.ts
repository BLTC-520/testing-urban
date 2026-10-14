/**
 * Shares by neighbourhood for the Explorer's table view. These are the headline
 * shares of access.ts, grouped by neighbourhood instead of by city, so a row
 * reads the same way as the map and the Story.
 */
import { NO_DATA } from "./access";

/** One city's cells, as the Explorer holds them (see useSurface.ts and data.ts). */
export interface CitySlice {
  /** neighbourhood index of each cell (Cells.unit); cells outside every neighbourhood carry 65535 */
  unit: ArrayLike<number>;
  /** residents of each cell in the chosen group (Surface.weights) */
  weights: ArrayLike<number>;
  /** per cell: essentials reached (count surfaces) or minutes to the nearest (minutes surfaces) */
  value: ArrayLike<number>;
  /** 1 where the cell joins the walking network (see networkMask) */
  network: ArrayLike<number>;
}

export interface UnitStat {
  /** residents of the neighbourhood in the chosen group, wherever their cell is */
  residents: number;
  /** residents whose cell joins the walking network: the base of the share */
  onNetwork: number;
  /** on-network residents who reach the metric */
  reached: number;
  /** reached / onNetwork; NaN when none of the neighbourhood's residents is on the network */
  share: number;
}

/**
 * 1 for each cell that joins the walking network: at least one basket essential
 * is reachable on foot. Same rule as categoriesReached(), where a cell is "no
 * data" only when every essential is missing.
 */
export function networkMask(d: Record<string, ArrayLike<number>>, basket: readonly string[], n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    for (const c of basket) {
      if (!Number.isNaN(d[c][i])) {
        out[i] = 1;
        break;
      }
    }
  }
  return out;
}

/** "All six essentials": every one of the k basket essentials is reachable in time. */
export const reachesAll = (k: number) => (value: number) => value >= k;

/** One essential: its nearest destination is within `minutes` (NaN, unreachable, never counts). */
export const reachesWithin = (minutes: number) => (value: number) => value <= minutes;

/**
 * Share of each neighbourhood's residents who reach the metric. Off-network
 * cells are left out of both the share and its base, as in the headline, but
 * their residents still count towards `residents`.
 */
export function unitStats(slices: readonly CitySlice[], reaches: (value: number) => boolean): Map<number, UnitStat> {
  const acc = new Map<number, { residents: number; onNetwork: number; reached: number }>();
  for (const s of slices) {
    for (let i = 0; i < s.unit.length; i++) {
      const u = s.unit[i];
      let a = acc.get(u);
      if (!a) {
        a = { residents: 0, onNetwork: 0, reached: 0 };
        acc.set(u, a);
      }
      const w = s.weights[i];
      a.residents += w;
      if (s.network[i] && s.value[i] !== NO_DATA) {
        a.onNetwork += w;
        if (reaches(s.value[i])) a.reached += w;
      }
    }
  }
  const out = new Map<number, UnitStat>();
  for (const [u, a] of acc) out.set(u, { ...a, share: a.onNetwork > 0 ? a.reached / a.onNetwork : NaN });
  return out;
}
