/**
 * Door-to-platform model for the RTS Link scenario — mirrors
 * src/sgjb/crossborder.py::compose and the summary in src/sgjb/summary.py.
 *
 *   T = T_access(home → hub) + 2 × clearance + crossing + connection to the MRT
 *
 * T_access comes from the pipeline (real networks + myBAS GTFS headways, or the
 * shared autonomous feeder on the road graph). Everything after the hub is a
 * parameter the reader can vary; none of it is a measured value.
 */
import type { CrossBorder } from "./data";
import type { BorderRegime, Meta } from "./types";

export type Mode = "baseline" | "rts" | "rts_av";
type Params = Meta["crossborder"];

export interface Assumptions {
  regime: BorderRegime;
  avWaitMin: number;
}

export function compose(access: number, hub: "bus" | "ktm" | "rts", regime: BorderRegime, p: Params): number {
  const clear = 2 * regime.clearance_min_per_country;
  if (hub === "bus") return access + clear + p.baseline_bus.headway_min / 2 + regime.causeway_ride_min + p.baseline_bus.checkpoint_to_mrt_min;
  if (hub === "ktm") return access + clear + p.baseline_rail.planned_wait_min + p.baseline_rail.ride_min + p.baseline_rail.woodlands_ciq_to_mrt_min;
  return access + clear + p.rts.peak_headway_min / 2 + p.rts.ride_min + p.rts.transfer_to_mrt_min;
}

/** Minutes from each Johor Bahru cell to the first Singapore MRT platform. */
export function doorToPlatform(cb: CrossBorder, mode: Mode, a: Assumptions, p: Params): Float32Array {
  const out = new Float32Array(cb.n);
  const bus = cb.t.t_pt_bus;
  const ktm = cb.t.t_pt_ktm;
  const rts = cb.t.t_pt_rts;
  const walkPick = cb.t.av_walk_to_pickup_min;
  const ride = cb.t.av_ride_min;
  const drop = p.av_feeder.dropoff_walk_min;
  for (let i = 0; i < cb.n; i++) {
    if (mode === "baseline") {
      out[i] = Math.min(compose(bus[i], "bus", a.regime, p), compose(ktm[i], "ktm", a.regime, p));
    } else {
      let access = rts[i];
      if (mode === "rts_av" && cb.avServed[i]) access = Math.min(access, walkPick[i] + a.avWaitMin + ride[i] + drop);
      out[i] = compose(access, "rts", a.regime, p);
    }
  }
  return out;
}

/** Population-weighted sorted minutes (for cumulative curves). Unreachable cells keep their weight at +∞. */
export function sortedByMinutes(t: Float32Array, w: ArrayLike<number>): { minutes: Float64Array; weights: Float64Array } {
  const idx = Array.from({ length: t.length }, (_, i) => i).filter((i) => w[i] > 0);
  idx.sort((x, y) => t[x] - t[y]);
  return { minutes: Float64Array.from(idx, (i) => t[i]), weights: Float64Array.from(idx, (i) => w[i]) };
}

export function weightedMedian(t: Float32Array, w: ArrayLike<number>): number {
  const s = sortedByMinutes(t, w);
  let tot = 0;
  for (const x of s.weights) tot += x;
  let acc = 0;
  for (let i = 0; i < s.minutes.length; i++) {
    acc += s.weights[i];
    if (acc >= tot / 2) return s.minutes[i];
  }
  return NaN;
}

export function shareWithin(t: Float32Array, w: ArrayLike<number>, minutes: number): number {
  let a = 0;
  let tot = 0;
  for (let i = 0; i < t.length; i++) {
    tot += w[i];
    if (t[i] <= minutes) a += w[i];
  }
  return tot > 0 ? a / tot : NaN;
}
