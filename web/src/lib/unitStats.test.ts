import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { categoriesReached, NO_DATA } from "./access";
import { decodeTable } from "./binary";
import { networkMask, reachesAll, reachesWithin, unitStats, type CitySlice } from "./unitStats";

describe("networkMask", () => {
  it("counts a cell as on the network when any essential is reachable on foot", () => {
    const d = {
      groceries: new Float32Array([120, NaN, NaN]),
      healthcare: new Float32Array([NaN, NaN, NaN]),
      education: new Float32Array([900, NaN, NaN]),
    };
    expect(Array.from(networkMask(d, ["groceries", "healthcare", "education"], 3))).toEqual([1, 0, 0]);
    expect(Array.from(networkMask(d, ["healthcare"], 3))).toEqual([0, 0, 0]);
  });
});

describe("unitStats", () => {
  // neighbourhood 0 has three cells, neighbourhood 1 has two; the last cell belongs to no
  // neighbourhood (65535) and the fourth is off the walking network
  const slice: CitySlice = {
    unit: new Uint16Array([0, 0, 0, 1, 1, 65535]),
    weights: new Float32Array([100, 300, 50, 200, 50, 999]),
    value: new Float32Array([6, 2, 6, 6, NO_DATA, 6]),
    network: new Uint8Array([1, 1, 1, 1, 0, 1]),
  };

  it("shares all-six residents among residents on the network", () => {
    const s = unitStats([slice], reachesAll(6));
    expect(s.get(0)).toEqual({ residents: 450, onNetwork: 450, reached: 150, share: 150 / 450 });
    expect(s.get(1)).toEqual({ residents: 250, onNetwork: 200, reached: 200, share: 1 });
  });

  it("keeps off-network residents in the total but out of the share", () => {
    const s = unitStats([slice], reachesAll(6));
    expect(s.get(1)?.residents).toBe(250);
    expect(s.get(1)?.onNetwork).toBe(200);
  });

  it("reads minutes surfaces: NaN (unreachable) counts in the base but never in the numerator", () => {
    const minutes: CitySlice = {
      unit: new Uint16Array([0, 0, 0]),
      weights: new Float32Array([100, 100, 100]),
      value: new Float32Array([8, NaN, 14]),
      network: new Uint8Array([1, 1, 1]),
    };
    const s = unitStats([minutes], reachesWithin(10));
    expect(s.get(0)).toEqual({ residents: 300, onNetwork: 300, reached: 100, share: 1 / 3 });
  });

  it("adds up across cities and gives NaN when nobody is on the network", () => {
    const sg: CitySlice = { unit: new Uint16Array([7]), weights: new Float32Array([40]), value: new Float32Array([6]), network: new Uint8Array([1]) };
    const jb: CitySlice = { unit: new Uint16Array([7]), weights: new Float32Array([60]), value: new Float32Array([0]), network: new Uint8Array([1]) };
    const off: CitySlice = { unit: new Uint16Array([8]), weights: new Float32Array([25]), value: new Float32Array([NO_DATA]), network: new Uint8Array([0]) };
    const s = unitStats([sg, jb, off], reachesAll(6));
    expect(s.get(7)).toEqual({ residents: 100, onNetwork: 100, reached: 40, share: 0.4 });
    expect(s.get(8)?.residents).toBe(25);
    expect(s.get(8)?.onNetwork).toBe(0);
    expect(s.get(8)?.share).toBeNaN();
  });
});

describe("the table reproduces the published summary", () => {
  const file = (name: string) => readFileSync(new URL(`../../public/data/${name}`, import.meta.url));
  const json = (name: string) => JSON.parse(file(name).toString("utf8"));
  const summary = json("summary.json");
  const meta = json("meta.json");
  const basket: string[] = meta.basket;
  const speed: number = meta.accessibility.walk_speed_mps.base;
  const idOfIndex: string[] = [];
  for (const f of json("neighbourhoods.geojson").features) idOfIndex[f.properties.idx] = f.properties.unit_id;

  const cities = ["sg", "jb"].map((city) => {
    const b = file(`cells_${city}.bin`);
    const t = decodeTable(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    const d: Record<string, Float32Array> = {};
    for (const [name, spec] of Object.entries(t.specs)) {
      if (!name.startsWith("d_") || spec.dtype !== "uint16") continue;
      const nodata = spec.nodata ?? 65535;
      d[name.slice(2)] = Float32Array.from(t.raw[name] as Uint16Array, (v) => (v === nodata ? NaN : v * (spec.scale ?? 1)));
    }
    return { n: t.rows, d, pop: t.raw.pop as Float32Array, unit: t.raw.unit as Uint16Array, network: networkMask(d, basket, t.rows) };
  });

  it("all six within 15 minutes: shares and residents match summary.json", () => {
    const stats = unitStats(
      cities.map((c) => ({ unit: c.unit, weights: c.pop, network: c.network, value: categoriesReached(c.n, c.d, basket, speed, 15) })),
      reachesAll(basket.length),
    );
    for (const nb of summary.neighbourhoods) {
      const st = stats.get(idOfIndex.indexOf(nb.unit_id))!;
      expect(Math.abs(st.share - nb.share_complete)).toBeLessThan(0.004);
      expect(Math.abs(st.residents - nb.population)).toBeLessThan(1);
    }
  });

  // distances are stored to the nearest metre, so a neighbourhood can land a fraction of a point away
  it("one essential within 15 minutes: shares match summary.json's within_<essential>", () => {
    for (const cat of basket) {
      const stats = unitStats(
        cities.map((c) => ({
          unit: c.unit,
          weights: c.pop,
          network: c.network,
          value: Float32Array.from(c.d[cat], (m) => m / speed / 60),
        })),
        reachesWithin(15),
      );
      for (const nb of summary.neighbourhoods) {
        expect(Math.abs(stats.get(idOfIndex.indexOf(nb.unit_id))!.share - nb[`within_${cat}`])).toBeLessThan(0.004);
      }
    }
  });
});
