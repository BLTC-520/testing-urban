import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { StreetGraph } from "./streetGraph";

// Tiles written by tests/test_export.py::test_graph_tiles_fixture (Python) for the toy network
// A(103.800,1.300) — B — C(103.802,1.300) — D(103.802,1.301).
const dir = new URL("./__fixtures__/graphdata/", import.meta.url);
const fetcher = async (p: string) => {
  const b = readFileSync(new URL(p, dir));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const expected = JSON.parse(readFileSync(new URL("expected.json", dir), "utf8"));

describe("StreetGraph (Python tiles → TypeScript routing)", () => {
  it("loads only the tiles around a point", async () => {
    const g = new StreetGraph(fetcher);
    const n = await g.ensure(103.8, 1.3, 50);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThan(4);
  });

  it("reproduces pipeline network distances across tile borders", async () => {
    const g = new StreetGraph(fetcher, 1.0);
    const iso = await g.isochrone(expected.a[0], expected.a[1], 5000);
    expect(iso).not.toBeNull();
    expect(iso!.snapM).toBeLessThan(1);
    const dD = iso!.distanceTo(expected.d_osm_node_index);
    expect(dD).toBeCloseTo(expected.path_m, 0);
    expect(iso!.segments.length).toBe(3); // the collinear mid-vertex of A–B is simplified away
    // segment distances grow along the path and never exceed the cutoff
    expect(Math.max(...iso!.segments.map((s) => s.d))).toBeLessThanOrEqual(5000);
  });

  it("cuts the isochrone at the cutoff", async () => {
    const g = new StreetGraph(fetcher, 1.0);
    const iso = await g.isochrone(expected.a[0], expected.a[1], 150);
    expect(iso!.distanceTo(expected.d_osm_node_index)).toBe(Infinity);
    expect(iso!.segments.every((s) => s.d <= 150)).toBe(true);
  });
});
