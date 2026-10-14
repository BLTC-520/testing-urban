import { describe, expect, it } from "vitest";
import { compose, doorToPlatform, shareWithin, weightedMedian } from "./crossborder";
import type { CrossBorder } from "./data";
import type { Meta } from "./types";

// Parameters as in config/scenarios.yml (the Python implementation is src/sgjb/crossborder.py::compose).
const P = {
  border_regimes: { low: { clearance_min_per_country: 5, causeway_ride_min: 8 }, central: { clearance_min_per_country: 15, causeway_ride_min: 20 }, high: { clearance_min_per_country: 30, causeway_ride_min: 45 } },
  baseline_bus: { headway_min: 6, checkpoint_to_mrt_min: 12, label: "" },
  baseline_rail: { ride_min: 5, planned_wait_min: 10, woodlands_ciq_to_mrt_min: 15, label: "" },
  rts: { ride_min: 5, peak_headway_min: 3.6, transfer_to_mrt_min: 4, capacity_pphpd: 10000, label: "" },
  av_feeder: { wait_min: { low: 3, central: 6, high: 10 }, label: "", precedent: "", walk_to_pickup_max_min: 3, peak_speed_factor: 0.6, pooling_detour: 1.25, dropoff_walk_min: 2 },
} as unknown as Meta["crossborder"];
const central = P.border_regimes.central;

describe("compose (mirrors sgjb.crossborder.compose)", () => {
  it("adds both clearances, the wait, the crossing and the connection", () => {
    expect(compose(30, "bus", central, P)).toBeCloseTo(30 + 30 + 3 + 20 + 12);
    expect(compose(30, "ktm", central, P)).toBeCloseTo(30 + 30 + 10 + 5 + 15);
    expect(compose(30, "rts", central, P)).toBeCloseTo(30 + 30 + 1.8 + 5 + 4);
  });
});

describe("doorToPlatform", () => {
  const cb: CrossBorder = {
    n: 3,
    h3: ["a", "b", "c"],
    index: new Map(),
    t: {
      t_pt_bus: Float32Array.from([20, 40, Infinity]),
      t_pt_ktm: Float32Array.from([25, 30, Infinity]),
      t_pt_rts: Float32Array.from([28, 45, Infinity]),
      av_walk_to_pickup_min: Float32Array.from([1, 2, 1]),
      av_ride_min: Float32Array.from([10, 12, 20]),
    },
    avServed: Uint8Array.from([1, 0, 1]),
  };
  const a = { regime: central, avWaitMin: 6 };
  it("takes the faster of bus and KTM today", () => {
    const t = doorToPlatform(cb, "baseline", a, P);
    expect(t[0]).toBeCloseTo(Math.min(20 + 65, 25 + 60));
    expect(t[1]).toBeCloseTo(30 + 60);
    expect(t[2]).toBe(Infinity);
  });
  it("uses the feeder only where it is served and faster", () => {
    const t = doorToPlatform(cb, "rts_av", a, P);
    expect(t[0]).toBeCloseTo(Math.min(28, 1 + 6 + 10 + 2) + 40.8);
    expect(t[1]).toBeCloseTo(45 + 40.8); // not served: walk + bus
    expect(t[2]).toBeCloseTo(1 + 6 + 20 + 2 + 40.8); // unreachable by bus, served by the feeder
  });
  it("weights statistics by residents", () => {
    const t = Float32Array.from([10, 20, 30]);
    expect(weightedMedian(t, [1, 1, 10])).toBe(30);
    expect(shareWithin(t, [1, 1, 2], 20)).toBeCloseTo(0.5);
  });
});
