import { describe, expect, it } from "vitest";
import { categoriesReached, NO_DATA, shares } from "./access";

describe("categoriesReached / shares (mirror of metrics.py)", () => {
  // 1.2 m/s × 15 min = 1080 m
  const d = {
    a: new Float32Array([100, 2000, NaN]),
    b: new Float32Array([1079, 1081, NaN]),
  };

  it("counts categories within the threshold and flags off-network cells", () => {
    const r = categoriesReached(3, d, ["a", "b"], 1.2, 15);
    expect(Array.from(r)).toEqual([2, 0, NO_DATA]);
  });

  it("speed scales distances into minutes exactly", () => {
    const r = categoriesReached(3, d, ["b"], 0.9, 15); // 810 m limit
    expect(Array.from(r)).toEqual([0, 0, NO_DATA]);
  });

  it("population-weights shares and ignores off-network cells", () => {
    const r = categoriesReached(3, d, ["a", "b"], 1.2, 15);
    const s = shares(r, [900, 100, 5000], 2);
    expect(s.complete).toBeCloseTo(0.9);
    expect(s.low).toBeCloseTo(0.1);
    expect(s.population).toBe(1000);
  });
});
