/**
 * Behaviour of the API on valid input, including the invariant the whole
 * schema was designed around: a hexagon's share is computed per
 * resolution-10 cell and then averaged, never the other way round.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type App } from "../src/app.ts";

let api: App;
beforeAll(async () => { api = await buildApp(); });
afterAll(() => api.close());

const json = async (url: string) => {
  const r = await api.app.inject({ method: "GET", url });
  expect(r.statusCode, `${url} → ${r.body.slice(0, 300)}`).toBe(200);
  return JSON.parse(r.body);
};

describe("GET /api/summary", () => {
  it("returns the control presets the dashboard builds its top bar from", async () => {
    const b = await json("/api/summary");
    expect(b.meta.basket).toHaveLength(6);
    expect(Object.keys(b.meta.speeds).sort()).toEqual(["base", "brisk", "slow"]);
    expect(b.meta.thresholds).toEqual([5, 10, 15, 20]);
    expect(b.meta.headline_threshold_min).toBe(15);
    expect(b.cities.map((c: { id: string }) => c.id).sort()).toEqual(["jb", "sg"]);
    expect(b.essentials).toHaveLength(8);
    expect(b.essentials.filter((e: { in_basket: number }) => e.in_basket === 1)).toHaveLength(6);
  });

  it("reproduces the study's headline finding", async () => {
    const b = await json("/api/summary");
    expect(b.metrics.sg.share_complete).toBeCloseTo(0.8036, 3);
    expect(b.metrics.jb.share_complete).toBeCloseTo(0.1198, 3);
  });

  it("serves the three pre-computed series the charts plot", async () => {
    const b = await json("/api/summary?city=sg");
    expect(Object.keys(b.series.sg).sort()).toEqual(["by_speed", "by_threshold", "histogram"]);
    expect(b.series.sg.histogram).toHaveLength(7);              // 0…6 essentials
    expect(b.series.sg.by_threshold.map((p: { bucket: string }) => p.bucket)).toEqual(["5", "10", "15", "20"]);
  });

  it("switches cohort", async () => {
    const all = await json("/api/summary?city=sg&cohort=all");
    const slow = await json("/api/summary?city=sg&cohort=elderly_slow_walk");
    expect(slow.metrics.sg.share_complete).toBeLessThan(all.metrics.sg.share_complete);
  });
});

describe("GET /api/cells", () => {
  it("aggregates to the requested resolution", async () => {
    const r7 = await json("/api/cells?city=sg&res=7");
    const r8 = await json("/api/cells?city=sg&res=8");
    expect(r7.hexes.length).toBeGreaterThan(50);
    expect(r8.hexes.length).toBeGreaterThan(r7.hexes.length);
    // Same population, differently grouped.
    const sum = (b: { hexes: { pop: number }[] }) => b.hexes.reduce((a, h) => a + h.pop, 0);
    expect(sum(r8)).toBeCloseTo(sum(r7), 0);
  });

  it("agrees with /api/summary on the city-wide share", async () => {
    const cells = await json("/api/cells?city=sg&minutes=15&speed=base&res=8");
    const summary = await json("/api/summary?city=sg");
    // Within the 0.1-point tolerance verify.ts documents (uint16 rounding and
    // the off-network/beyond-cap conflation in the binary export).
    expect(cells.totals.share_complete).toBeCloseTo(summary.metrics.sg.share_complete, 2);
  });

  it("thresholds before it aggregates", async () => {
    // The invariant. If the server averaged distances into the parent hexagon
    // and thresholded that, share_complete would be visibly higher — 4.6
    // points on Singapore. Checking against the pipeline's published figure
    // pins the order of operations, not just the arithmetic.
    const b = await json("/api/cells?city=sg&res=8");
    expect(b.totals.share_complete).toBeGreaterThan(0.79);
    expect(b.totals.share_complete).toBeLessThan(0.81);
  });

  it("is monotonic in minutes", async () => {
    const shares = [];
    for (const m of [5, 10, 15, 20]) {
      shares.push((await json(`/api/cells?city=jb&minutes=${m}&res=7`)).totals.share_complete);
    }
    expect(shares).toEqual([...shares].sort((a, b) => a - b));
  });

  it("is monotonic in walking speed", async () => {
    const slow = await json("/api/cells?city=sg&speed=slow&res=7");
    const base = await json("/api/cells?city=sg&speed=base&res=7");
    const brisk = await json("/api/cells?city=sg&speed=brisk&res=7");
    expect(slow.totals.share_complete).toBeLessThan(base.totals.share_complete);
    expect(base.totals.share_complete).toBeLessThan(brisk.totals.share_complete);
  });

  it("never returns a null share, even over unpopulated land", async () => {
    // The WEIGHT_EPSILON case: a parent hexagon of pure parkland has zero
    // residents, and a population-weighted mean over it would divide by zero.
    for (const city of ["sg", "jb"]) {
      const b = await json(`/api/cells?city=${city}&res=8`);
      expect(b.hexes.some((h: { pop: number }) => h.pop === 0)).toBe(true);
      expect(b.hexes.every((h: { share_complete: number | null }) => h.share_complete !== null)).toBe(true);
    }
  });

  it("scopes to one neighbourhood", async () => {
    const whole = await json("/api/cells?city=sg&res=8");
    const one = await json("/api/cells?city=sg&res=8&unit=0");
    expect(one.hexes.length).toBeLessThan(whole.hexes.length);
    expect(one.totals.population_on_network).toBeLessThan(whole.totals.population_on_network);
  });

  it("echoes the resolved walking speed so the client need not duplicate the table", async () => {
    const b = await json("/api/cells?city=sg&minutes=15&speed=slow&res=7");
    expect(b.query.speed_mps).toBe(0.9);
    expect(b.limit_m).toBe(15 * 60 * 0.9);
  });
});

describe("GET /api/panels", () => {
  it("returns a histogram that sums to one", async () => {
    const b = await json("/api/panels?city=jb");
    expect(b.histogram).toHaveLength(7);
    expect(b.histogram.reduce((a: number, h: { share: number }) => a + h.share, 0)).toBeCloseTo(1, 4);
  });

  it("names healthcare as Johor Bahru's scarcest essential, as the study found", async () => {
    const b = await json("/api/panels?city=jb");
    const weakest = [...b.by_essential].sort((a, b2) => a.share_within - b2.share_within)[0];
    expect(weakest.id).toBe("healthcare");
  });

  it("ranks neighbourhoods", async () => {
    const b = await json("/api/panels?city=sg");
    expect(b.by_unit.length).toBeGreaterThan(40);
    const shares = b.by_unit.map((u: { share_complete: number }) => u.share_complete);
    expect(shares).toEqual([...shares].sort((a: number, b2: number) => b2 - a));
  });
});

describe("GET /api/scenarios", () => {
  it("returns three runs per city with the pipeline's own before/after", async () => {
    const b = await json("/api/scenarios");
    expect(b.scenarios).toHaveLength(6);
    for (const s of b.scenarios) {
      expect(s.share_complete_after).toBeGreaterThan(s.share_complete_before);
      expect(s.delta_share_complete).toBeCloseTo(s.share_complete_after - s.share_complete_before, 6);
    }
  });

  it("shows more converted sites helping more", async () => {
    const b = await json("/api/scenarios?city=jb");
    const bySites = [...b.scenarios].sort((a, c) => a.sites - c.sites);
    expect(bySites.map((s) => s.sites)).toEqual([10, 25, 50]);
    const deltas = bySites.map((s) => s.delta_share_complete);
    expect(deltas).toEqual([...deltas].sort((a, b2) => a - b2));
  });
});

describe("scenario cells", () => {
  it("improve on the baseline and keep the same grid", async () => {
    const before = await json("/api/cells?city=jb&res=8");
    const after = await json("/api/cells?city=jb&res=8&scenario=p2p50");
    expect(after.hexes.length).toBe(before.hexes.length);
    expect(after.totals.share_complete).toBeGreaterThan(before.totals.share_complete);
    // A scenario moves destinations, not residents.
    expect(after.totals.population_on_network).toBeCloseTo(before.totals.population_on_network, 0);
  });

  it("matches the scenario endpoint's published delta", async () => {
    const after = await json("/api/cells?city=sg&res=7&scenario=p2p25");
    const published = (await json("/api/scenarios?city=sg")).scenarios.find(
      (s: { id: string }) => s.id === "p2p25",
    );
    expect(after.totals.share_complete).toBeCloseTo(published.share_complete_after, 2);
  });
});

describe("GET /api/footpath", () => {
  it("returns the chosen link by default", async () => {
    const b = await json("/api/footpath");
    expect(b.links).toHaveLength(1);
    expect(b.links[0].is_chosen).toBe(true);
    expect(b.links[0].place).toBe("Bukit Indah");
    expect(b.links[0].link_m).toBeLessThan(b.links[0].walk_today_m);
    expect(b.links[0].metrics["15min"].residents_gaining).toBeGreaterThan(2000);
  });

  it("returns the runners-up on request", async () => {
    const b = await json("/api/footpath?alternatives=true");
    expect(b.links).toHaveLength(10);
    expect(b.links.filter((l: { is_chosen: boolean }) => l.is_chosen)).toHaveLength(1);
  });
});

describe("GET /api/cell/:h3", () => {
  it("returns one hexagon with the essentials it reaches", async () => {
    const h3 = (await json("/api/cells?city=sg&res=10&unit=0")).hexes[0].hex;
    const b = await json(`/api/cell/${h3}?city=sg`);
    expect(b.cell.h3).toBe(h3);
    expect(Array.isArray(b.reached)).toBe(true);
    expect(b.reached.length).toBeLessThanOrEqual(6);
  });

  it("includes the scenario comparison when asked", async () => {
    const h3 = (await json("/api/cells?city=jb&res=10&unit=55")).hexes[0].hex;
    const b = await json(`/api/cell/${h3}?city=jb&scenario=p2p50`);
    expect(b.scenario).not.toBeNull();
    expect(b.scenario.reached.length).toBeGreaterThanOrEqual(b.reached.length);
  });
});

describe("security headers and CORS", () => {
  it("sets helmet's headers", async () => {
    const r = await api.app.inject({ method: "GET", url: "/api/health" });
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["strict-transport-security"]).toBeDefined();
  });

  it("allows the dashboard's dev origin", async () => {
    const r = await api.app.inject({
      method: "GET", url: "/api/health",
      headers: { origin: "http://localhost:5174" },
    });
    expect(r.headers["access-control-allow-origin"]).toBe("http://localhost:5174");
  });

  it("does not reflect an arbitrary origin back", async () => {
    const r = await api.app.inject({
      method: "GET", url: "/api/health",
      headers: { origin: "https://evil.example" },
    });
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("rate limiting", () => {
  it("returns 429 past the window's budget", async () => {
    const small = await buildApp({ rateLimitMax: 3 });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) {
        codes.push((await small.app.inject({ method: "GET", url: "/api/health" })).statusCode);
      }
      expect(codes.slice(0, 3)).toEqual([200, 200, 200]);
      expect(codes[3]).toBe(429);
      expect(codes[4]).toBe(429);
    } finally {
      await small.close();
    }
  });
});
