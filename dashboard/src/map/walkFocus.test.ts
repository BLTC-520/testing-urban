import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { boundedDijkstra, csrFromEdges } from "./dijkstra.ts";
import { CURATED, LANDMARKS } from "./landmarks.ts";
import { reachedPois, type Pois } from "./pois.ts";
import { MAX_SNAP_M, StreetGraph, type Isochrone } from "./streetGraph.ts";
import {
  MIN_BEARING_DIST_M,
  bandOf,
  bearingToBuilding,
  isochroneLayer,
  metresBetweenPoints,
  nearestPoiMarkers,
  pullbackCamera,
  visibleSegments,
} from "./walkFocus.ts";

/** Build a minimal valid SGJG binary tile in memory for deterministic unit tests. */
function makeSyntheticTile(
  olon: number,
  olat: number,
  nodes: { id: number; dlonMicro: number; dlatMicro: number }[],
  edges: { u: number; v: number; len: number; dx: number; dy: number }[],
): ArrayBuffer {
  const n = nodes.length;
  const m = edges.length;
  const P = m; // 1 polyline vertex (v) per edge
  const byteLength = 32 + n * 4 + n * 2 + n * 2 + m * 4 + m * 4 + m * 4 + m * 2 + P * 2 + P * 2;
  const buf = new ArrayBuffer(byteLength);
  const dv = new DataView(buf);
  dv.setUint8(0, "S".charCodeAt(0));
  dv.setUint8(1, "G".charCodeAt(0));
  dv.setUint8(2, "J".charCodeAt(0));
  dv.setUint8(3, "G".charCodeAt(0));
  dv.setUint32(4, n, true);
  dv.setUint32(8, m, true);
  dv.setUint32(12, P, true);
  dv.setFloat64(16, olon, true);
  dv.setFloat64(24, olat, true);
  let o = 32;
  for (const nd of nodes) { dv.setUint32(o, nd.id, true); o += 4; }
  for (const nd of nodes) { dv.setUint16(o, nd.dlonMicro, true); o += 2; }
  for (const nd of nodes) { dv.setUint16(o, nd.dlatMicro, true); o += 2; }
  for (const ed of edges) { dv.setUint32(o, ed.u, true); o += 4; }
  for (const ed of edges) { dv.setUint32(o, ed.v, true); o += 4; }
  for (const ed of edges) { dv.setFloat32(o, ed.len, true); o += 4; }
  for (let i = 0; i < m; i++) { dv.setUint16(o, 1, true); o += 2; }
  for (const ed of edges) { dv.setInt16(o, ed.dx, true); o += 2; }
  for (const ed of edges) { dv.setInt16(o, ed.dy, true); o += 2; }
  return buf;
}

describe("bearing calculation from start node to building", () => {
  const origin: [number, number] = [103.85, 1.29];

  it("faces due north (0°), east (90°), south (180°) and west (-90°) when >= 15 m apart", () => {
    const north: [number, number] = [103.85, 1.29 + 40 / 110_574];
    const east: [number, number] = [103.85 + 40 / 111_300, 1.29];
    const south: [number, number] = [103.85, 1.29 - 40 / 110_574];
    const west: [number, number] = [103.85 - 40 / 111_300, 1.29];

    expect(bearingToBuilding(origin, north, -12)).toBeCloseTo(0, 1);
    expect(bearingToBuilding(origin, east, -12)).toBeCloseTo(90, 1);
    expect(Math.abs(bearingToBuilding(origin, south, -12))).toBeCloseTo(180, 1);
    expect(bearingToBuilding(origin, west, -12)).toBeCloseTo(-90, 1);
  });

  it("keeps the current fallback bearing when the node and building are under 15 m apart", () => {
    const closePoint: [number, number] = [103.85 + 8 / 111_300, 1.29 + 6 / 110_574]; // ~10 m
    expect(metresBetweenPoints(origin, closePoint)).toBeLessThan(MIN_BEARING_DIST_M);
    expect(bearingToBuilding(origin, closePoint, -12)).toBe(-12);
    expect(bearingToBuilding(origin, origin, 37)).toBe(37);
  });

  it("switches to the street-to-building bearing once distance reaches 15 m", () => {
    const farEnough: [number, number] = [103.85 + 20 / 111_300, 1.29]; // ~20 m east
    expect(metresBetweenPoints(origin, farEnough)).toBeGreaterThanOrEqual(MIN_BEARING_DIST_M);
    expect(bearingToBuilding(origin, farEnough, -12)).toBeCloseTo(90, 1);
  });
});

describe("start-node snapping rule and unreachable branch", () => {
  const index = {
    tile_deg: 0.02,
    origin: [103.84, 1.28] as [number, number],
    tiles: { "0_0": { nodes: 2, edges: 1, bytes: 64 } },
  };
  // Two nodes 100 m apart along latitude at (103.850000, 1.290000) -> (103.850000, 1.290900)
  const tile = makeSyntheticTile(
    103.84,
    1.28,
    [
      { id: 10, dlonMicro: 10_000, dlatMicro: 10_000 },
      { id: 11, dlonMicro: 10_000, dlatMicro: 10_900 },
    ],
    [{ u: 10, v: 11, len: 100, dx: 0, dy: 900 }],
  );

  const makeGraph = () =>
    new StreetGraph(async (p) => {
      if (p === "graph/index.json") {
        return new TextEncoder().encode(JSON.stringify(index)).buffer;
      }
      if (p === "graph/t_0_0.bin") return tile;
      throw new Error(`unexpected path ${p}`);
    });

  it("snaps a nearby landmark onto the street edge and records its nearest start node", async () => {
    const g = makeGraph();
    // 30 m east of node 10
    const lon = 103.85 + 30 / 111_300;
    const lat = 1.29;
    const iso = await g.isochrone(lon, lat, 500);
    expect(iso).not.toBeNull();
    expect(iso!.snapM).toBeCloseTo(30, 0);
    expect(iso!.startNode[0]).toBeCloseTo(103.85, 5);
    expect(iso!.startNode[1]).toBeCloseTo(1.29, 5);
    expect(iso!.segments.length).toBeGreaterThan(0);
    expect(iso!.maxDistanceM).toBeGreaterThan(100);
  });

  it("returns null when the landmark is farther than MAX_SNAP_M (400 m) from any street", async () => {
    const g = makeGraph();
    // ~650 m east of the only street
    const farLon = 103.85 + 650 / 111_300;
    const iso = await g.isochrone(farLon, 1.29, 500);
    expect(MAX_SNAP_M).toBe(400);
    expect(iso).toBeNull();
  });

  it("loads real tiles for MBS, NAFA and JB CIQ, and treats Changi runway as off-network", async () => {
    const dataRoot = resolve(__dirname, "../../../web/public/data");
    const g = new StreetGraph(async (p) => {
      const buf = await readFile(resolve(dataRoot, p));
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    });

    for (const id of ["mbs", "nafa", "ciq"]) {
      const lm = CURATED.find((l) => l.id === id)!;
      const iso = await g.isochrone(lm.position[0], lm.position[1], 15 * 60 * 1.2);
      expect(iso, `${id} should be reachable`).not.toBeNull();
      expect(iso!.segments.length).toBeGreaterThan(50);
      expect(iso!.maxDistanceM).toBeGreaterThan(500);
    }

    const changiRunway = LANDMARKS.find((l) => l.id === "osm-way-174037464")!;
    const off = await g.isochrone(changiRunway.position[0], changiRunway.position[1], 1080);
    expect(off).toBeNull();
  });
});

describe("boundedDijkstra & reachedPois evaluation", () => {
  it("computes shortest paths up to the cutoff on an undirected graph", () => {
    const csr = csrFromEdges(3, [0, 1], [1, 2], [100, 200]);
    const dist = boundedDijkstra(csr, [0], [0], 250);
    expect(dist[0]).toBe(0);
    expect(dist[1]).toBe(100);
    expect(dist[2]).toBe(Infinity);
  });

  it("finds the nearest POI and counts within the walk budget for each essential category", () => {
    const nodeDist = new Map<number, number>([
      [1, 120],  // ~1.67 min at 1.2 m/s
      [2, 480],  // ~6.67 min at 1.2 m/s
      [3, 1000], // ~13.89 min at 1.2 m/s
    ]);
    const iso: Isochrone = {
      origin: [103.85, 1.29],
      startNode: [103.85, 1.29],
      startPoint: [103.85, 1.29],
      snapM: 10,
      cutoffM: 1200,
      maxDistanceM: 1050,
      segments: [],
      distanceTo: (gid) => nodeDist.get(gid) ?? Infinity,
    };
    const pois: Pois = {
      lon: new Float32Array([103.851, 103.852, 103.855]),
      lat: new Float32Array([1.291, 1.292, 1.295]),
      // bit 0 = groceries, bit 1 = healthcare
      mask: new Uint16Array([0b01, 0b01, 0b10]),
      areaHa: new Float32Array([0, 0, 0]),
      categories: ["groceries", "healthcare", "education"],
      names: ["FairPrice Express", "Cold Storage", "Outram Clinic"],
      access: {
        poi: new Uint32Array([0, 1, 2]),
        u: new Uint32Array([1, 2, 3]),
        v: new Uint32Array([1, 2, 3]),
        offU: new Float32Array([0, 0, 0]),
        offV: new Float32Array([0, 0, 0]),
        snap: new Float32Array([0, 0, 0]),
      },
    };

    // At a 10-minute budget (720 m at 1.2 m/s): both groceries are within 10 min; clinic is at ~13.9 min
    const r10 = reachedPois(iso, pois, 1.2, 10, 1.3);
    expect(r10.counts.groceries).toBe(2);
    expect(r10.nearest.groceries?.name).toBe("FairPrice Express");
    expect(r10.nearest.groceries?.minutes).toBeCloseTo(120 / 1.2 / 60, 2);
    expect(r10.counts.healthcare).toBe(0);
    expect(r10.counts.education).toBe(0);
    expect(r10.nearest.education).toBeNull();

    // Markers filtered to the 10-minute budget include groceries but exclude the 13.9-min clinic
    const markers10 = nearestPoiMarkers(r10, ["groceries", "healthcare", "education"], 10);
    expect(markers10.map((m) => m.category)).toEqual(["groceries"]);

    // At a 15-minute budget (1080 m): the clinic is now within reach too
    const r15 = reachedPois(iso, pois, 1.2, 15, 1.3);
    expect(r15.counts.healthcare).toBe(1);
    const markers15 = nearestPoiMarkers(r15, ["groceries", "healthcare", "education"], 15);
    expect(markers15.map((m) => m.category)).toEqual(["groceries", "healthcare"]);
  });
});

describe("walk-shed reveal slicing and pullback framing", () => {
  const segs = [
    { from: [103.85, 1.28] as [number, number], to: [103.855, 1.285] as [number, number], d: 200 },
    { from: [103.855, 1.285] as [number, number], to: [103.86, 1.29] as [number, number], d: 600 },
    { from: [103.86, 1.29] as [number, number], to: [103.865, 1.295] as [number, number], d: 950 },
  ];

  it("slices segments progressively by reveal distance without mutating the source", () => {
    const frozen = Object.freeze([...segs]);
    expect(visibleSegments(frozen, 0)).toHaveLength(0);
    expect(visibleSegments(frozen, 400)).toHaveLength(1);
    expect(visibleSegments(frozen, 700)).toHaveLength(2);
    expect(visibleSegments(frozen, 1000)).toHaveLength(3);

    const layer = isochroneLayer("walk", frozen, 650, 1.2);
    expect((layer.props.data as unknown[]).length).toBe(2);
  });

  it("assigns 5-minute bands based on walking speed", () => {
    expect(bandOf(100, 1.2)).toBe(0);  // < 360 m (0–5 min)
    expect(bandOf(500, 1.2)).toBe(1);  // 360–720 m (5–10 min)
    expect(bandOf(900, 1.2)).toBe(2);  // 720–1080 m (10–15 min)
    expect(bandOf(1300, 1.2)).toBe(3); // 15+ min
  });

  it("frames the reachable segments on pullback while preserving the focus bearing", () => {
    const cam = pullbackCamera(segs, [103.85, 1.28], 142);
    expect(cam.bearing).toBe(142);
    expect(cam.center[0]).toBeCloseTo(103.8575, 4);
    expect(cam.center[1]).toBeCloseTo(1.2875, 4);
    expect(cam.zoom).toBeGreaterThanOrEqual(13.2);
    expect(cam.zoom).toBeLessThanOrEqual(15.6);
  });
});
