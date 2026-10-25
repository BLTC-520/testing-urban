/**
 * Ported from web/src/lib/streetGraph.ts.
 *
 * Street-graph tiles (written by sgjb.web_export.export_graph_tiles) and
 * in-browser isochrones.
 *
 * Edge (u, v) lives in the tile of u. Every node within network distance R of
 * a point is within straight-line distance R, so loading the tiles that
 * intersect the radius-R disc makes a search to R exact.
 */
import { boundedDijkstraWithParents, csrFromEdges, type CSRGraph } from "./dijkstra.ts";

export const MAX_SNAP_M = 400;

export interface TileIndex {
  tile_deg: number;
  origin: [number, number];
  tiles: Record<string, { nodes: number; edges: number; bytes: number }>;
}

export type Fetcher = (path: string) => Promise<ArrayBuffer>;

export interface DecodedTile {
  ids: Uint32Array;
  lon: Float64Array;
  lat: Float64Array;
  eu: Uint32Array;
  ev: Uint32Array;
  len: Float32Array;
  ptr: Uint32Array;
  plon: Float64Array;
  plat: Float64Array;
}

export function decodeTile(buf: ArrayBuffer): DecodedTile {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== "SGJG") throw new Error("not a graph tile");
  const n = dv.getUint32(4, true);
  const m = dv.getUint32(8, true);
  const P = dv.getUint32(12, true);
  const olon = dv.getFloat64(16, true);
  const olat = dv.getFloat64(24, true);
  let o = 32;
  const ids = new Uint32Array(n);
  for (let i = 0; i < n; i++, o += 4) ids[i] = dv.getUint32(o, true);
  const lon = new Float64Array(n);
  const lat = new Float64Array(n);
  for (let i = 0; i < n; i++, o += 2) lon[i] = olon + dv.getUint16(o, true) / 1e6;
  for (let i = 0; i < n; i++, o += 2) lat[i] = olat + dv.getUint16(o, true) / 1e6;
  const eu = new Uint32Array(m);
  const ev = new Uint32Array(m);
  const len = new Float32Array(m);
  const np = new Uint16Array(m);
  for (let e = 0; e < m; e++, o += 4) eu[e] = dv.getUint32(o, true);
  for (let e = 0; e < m; e++, o += 4) ev[e] = dv.getUint32(o, true);
  for (let e = 0; e < m; e++, o += 4) len[e] = dv.getFloat32(o, true);
  for (let e = 0; e < m; e++, o += 2) np[e] = dv.getUint16(o, true);
  const dx = new Int16Array(P);
  const dy = new Int16Array(P);
  for (let i = 0; i < P; i++, o += 2) dx[i] = dv.getInt16(o, true);
  for (let i = 0; i < P; i++, o += 2) dy[i] = dv.getInt16(o, true);
  const local = new Map<number, number>();
  for (let i = 0; i < n; i++) local.set(ids[i], i);
  const ptr = new Uint32Array(m + 1);
  for (let e = 0; e < m; e++) ptr[e + 1] = ptr[e] + np[e];
  const plon = new Float64Array(P);
  const plat = new Float64Array(P);
  for (let e = 0; e < m; e++) {
    const ui = local.get(eu[e]);
    let qx = ui !== undefined ? Math.round(lon[ui] * 1e6) : 0;
    let qy = ui !== undefined ? Math.round(lat[ui] * 1e6) : 0;
    for (let k = ptr[e]; k < ptr[e + 1]; k++) {
      qx += dx[k];
      qy += dy[k];
      plon[k] = qx / 1e6;
      plat[k] = qy / 1e6;
    }
  }
  return { ids, lon, lat, eu, ev, len, ptr, plon, plat };
}

const M_PER_DEG_LAT = 110_574;
const mPerDegLon = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

export interface Segment {
  from: [number, number];
  to: [number, number];
  /** network metres at the far end of the segment */
  d: number;
}

export interface SnapResult {
  edge: number;
  offU: number;
  offV: number;
  distM: number;
  /** Snapped point on the street edge [lon, lat]. */
  point: [number, number];
  /** Nearest street-graph node [lon, lat] (the walk's start node). */
  node: [number, number];
}

export interface Isochrone {
  origin: [number, number];
  /** Nearest street-graph node [lon, lat]. */
  startNode: [number, number];
  /** Exact snapped point on the edge [lon, lat]. */
  startPoint: [number, number];
  snapM: number;
  cutoffM: number;
  /** Farthest walking distance reached within the budget (metres). */
  maxDistanceM: number;
  segments: Segment[];
  /** distance (m) per loaded global node id, for POI evaluation */
  distanceTo: (globalNode: number) => number;
  /** Reconstruct the shortest walking polyline [[lon, lat], ...] from the origin to a target [lon, lat]. */
  routeTo?: (targetLon: number, targetLat: number) => [number, number][];
}

export class StreetGraph {
  private index: TileIndex | null = null;
  private loaded = new Map<string, DecodedTile>();
  private pending = new Map<string, Promise<void>>();
  private csr: (CSRGraph & { arcEdge: Int32Array }) | null = null;
  private localOf = new Map<number, number>();
  private nodeLon: number[] = [];
  private nodeLat: number[] = [];
  private edges: { u: number; v: number; len: number; tile: DecodedTile; e: number }[] = [];

  private fetcher: Fetcher;
  private detour: number;

  constructor(fetcher: Fetcher, detour = 1.3) {
    this.fetcher = fetcher;
    this.detour = detour;
  }

  async init(): Promise<TileIndex> {
    if (!this.index) {
      const buf = await this.fetcher("graph/index.json");
      this.index = JSON.parse(new TextDecoder().decode(buf)) as TileIndex;
    }
    return this.index;
  }

  /** Load every tile intersecting the disc (lon, lat, radiusM). */
  async ensure(lon: number, lat: number, radiusM: number): Promise<number> {
    const idx = await this.init();
    const dLon = radiusM / mPerDegLon(lat);
    const dLat = radiusM / M_PER_DEG_LAT;
    const [x0, y0] = idx.origin;
    const tx0 = Math.floor((lon - dLon - x0) / idx.tile_deg);
    const tx1 = Math.floor((lon + dLon - x0) / idx.tile_deg);
    const ty0 = Math.floor((lat - dLat - y0) / idx.tile_deg);
    const ty1 = Math.floor((lat + dLat - y0) / idx.tile_deg);
    const jobs: Promise<void>[] = [];
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        const key = `${tx}_${ty}`;
        if (!idx.tiles[key] || this.loaded.has(key)) continue;
        if (!this.pending.has(key)) {
          const job = this.fetcher(`graph/t_${key}.bin`)
            .then((buf) => {
              this.loaded.set(key, decodeTile(buf));
              this.csr = null;
            })
            .catch((err) => {
              this.pending.delete(key);
              throw err;
            });
          this.pending.set(key, job);
        }
        jobs.push(this.pending.get(key)!);
      }
    }
    await Promise.all(jobs);
    return this.loaded.size;
  }

  private build(): void {
    if (this.csr) return;
    this.localOf.clear();
    this.nodeLon = [];
    this.nodeLat = [];
    this.edges = [];
    const add = (id: number, lon: number, lat: number) => {
      let i = this.localOf.get(id);
      if (i === undefined) {
        i = this.nodeLon.length;
        this.localOf.set(id, i);
        this.nodeLon.push(lon);
        this.nodeLat.push(lat);
      }
      return i;
    };
    for (const t of this.loaded.values()) {
      for (let i = 0; i < t.ids.length; i++) add(t.ids[i], t.lon[i], t.lat[i]);
    }
    for (const t of this.loaded.values()) {
      for (let e = 0; e < t.eu.length; e++) {
        const u = this.localOf.get(t.eu[e]);
        if (u === undefined) continue;
        const last = t.ptr[e + 1] - 1;
        const v = add(t.ev[e], last >= t.ptr[e] ? t.plon[last] : NaN, last >= t.ptr[e] ? t.plat[last] : NaN);
        this.edges.push({ u, v, len: t.len[e], tile: t, e });
      }
    }
    const n = this.nodeLon.length;
    this.csr = csrFromEdges(
      n,
      this.edges.map((x) => x.u),
      this.edges.map((x) => x.v),
      this.edges.map((x) => x.len),
    );
  }

  /** Polyline of a loaded edge, from u to v. */
  private geometry(k: number): { lon: number[]; lat: number[]; cum: number[] } {
    const { u, tile, e } = this.edges[k];
    const lon = [this.nodeLon[u]];
    const lat = [this.nodeLat[u]];
    for (let p = tile.ptr[e]; p < tile.ptr[e + 1]; p++) {
      lon.push(tile.plon[p]);
      lat.push(tile.plat[p]);
    }
    const cum = [0];
    for (let i = 1; i < lon.length; i++) {
      const dx = (lon[i] - lon[i - 1]) * mPerDegLon(lat[i]);
      const dy = (lat[i] - lat[i - 1]) * M_PER_DEG_LAT;
      cum.push(cum[i - 1] + Math.hypot(dx, dy));
    }
    const total = cum[cum.length - 1];
    const s = total > 0 ? this.edges[k].len / total : 1;
    return { lon, lat, cum: cum.map((c) => c * s) };
  }

  /** Nearest loaded street-graph node to (lon, lat). */
  private closestNode(lon: number, lat: number, fallbackIdx: number): [number, number] {
    const kx = mPerDegLon(lat);
    let bestIdx = fallbackIdx;
    let bestDist = Infinity;
    for (let i = 0; i < this.nodeLon.length; i++) {
      const nx = this.nodeLon[i];
      const ny = this.nodeLat[i];
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;
      const d = Math.hypot((nx - lon) * kx, (ny - lat) * M_PER_DEG_LAT);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return [this.nodeLon[bestIdx], this.nodeLat[bestIdx]];
  }

  /** Nearest position on any loaded edge. */
  snap(lon: number, lat: number): SnapResult | null {
    this.build();
    const kx = mPerDegLon(lat);
    let best = { edge: -1, along: 0, dist: Infinity, point: [lon, lat] as [number, number] };
    const near = (i: number) => Math.hypot((this.nodeLon[i] - lon) * kx, (this.nodeLat[i] - lat) * M_PER_DEG_LAT);
    for (let k = 0; k < this.edges.length; k++) {
      const ed = this.edges[k];
      const reach = ed.len / 2 + Math.min(best.dist, 600);
      if (near(ed.u) > reach && (!Number.isFinite(this.nodeLon[ed.v]) || near(ed.v) > reach)) continue;
      const g = this.geometry(k);
      for (let i = 0; i < g.lon.length - 1; i++) {
        const ax = (g.lon[i] - lon) * kx;
        const ay = (g.lat[i] - lat) * M_PER_DEG_LAT;
        const bx = (g.lon[i + 1] - lon) * kx;
        const by = (g.lat[i + 1] - lat) * M_PER_DEG_LAT;
        const vx = bx - ax;
        const vy = by - ay;
        const L2 = vx * vx + vy * vy;
        const t = L2 > 0 ? Math.min(1, Math.max(0, -(ax * vx + ay * vy) / L2)) : 0;
        const d = Math.hypot(ax + t * vx, ay + t * vy);
        if (d < best.dist) {
          best = {
            edge: k,
            along: g.cum[i] + t * (g.cum[i + 1] - g.cum[i]),
            dist: d,
            point: [g.lon[i] + t * (g.lon[i + 1] - g.lon[i]), g.lat[i] + t * (g.lat[i + 1] - g.lat[i])],
          };
        }
      }
    }
    if (best.edge < 0) return null;
    const ed = this.edges[best.edge];
    const node = this.closestNode(lon, lat, ed.u);
    return {
      edge: best.edge,
      offU: best.along,
      offV: Math.max(0, ed.len - best.along),
      distM: best.dist,
      point: best.point,
      node,
    };
  }

  /** Walking isochrone from a point, out to `cutoffM` network metres. */
  async isochrone(lon: number, lat: number, cutoffM: number): Promise<Isochrone | null> {
    await this.ensure(lon, lat, cutoffM + MAX_SNAP_M);
    this.build();
    const s = this.snap(lon, lat);
    if (!s || s.distM > MAX_SNAP_M) return null;
    const csr = this.csr!;
    const { u, v } = this.edges[s.edge];
    const base = s.distM * this.detour;
    const { dist, prevNode, prevEdge } = boundedDijkstraWithParents(
      csr,
      [u, v],
      [base + s.offU, base + s.offV],
      cutoffM,
    );
    const segments: Segment[] = [];
    let maxDistanceM = 0;
    for (let k = 0; k < this.edges.length; k++) {
      const ed = this.edges[k];
      const du = dist[ed.u];
      const dv = dist[ed.v];
      if (!(du <= cutoffM) && !(dv <= cutoffM) && k !== s.edge) continue;
      const g = this.geometry(k);
      const L = ed.len;
      for (let i = 0; i < g.lon.length - 1; i++) {
        let d0 = Math.min(du + g.cum[i], dv + (L - g.cum[i]));
        let d1 = Math.min(du + g.cum[i + 1], dv + (L - g.cum[i + 1]));
        if (k === s.edge) {
          d0 = Math.min(d0, base + Math.abs(g.cum[i] - s.offU));
          d1 = Math.min(d1, base + Math.abs(g.cum[i + 1] - s.offU));
        }
        const far = Math.max(d0, d1);
        if (far > cutoffM) continue;
        if (far > maxDistanceM) maxDistanceM = far;
        segments.push({ from: [g.lon[i], g.lat[i]], to: [g.lon[i + 1], g.lat[i + 1]], d: far });
      }
    }
    segments.sort((a, b) => a.d - b.d);
    const localOf = this.localOf;

    const routeTo = (targetLon: number, targetLat: number): [number, number][] => {
      const ts = this.snap(targetLon, targetLat);
      let targetNode = -1;
      if (ts) {
        if (ts.edge === s.edge) {
          return [s.point, [targetLon, targetLat]];
        }
        const tEdge = this.edges[ts.edge];
        const uNear = ts.offU <= ts.offV;
        const first = uNear ? tEdge.u : tEdge.v;
        const second = uNear ? tEdge.v : tEdge.u;
        if (dist[first] < Infinity) {
          targetNode = first;
        } else if (dist[second] < Infinity) {
          targetNode = second;
        }
      }

      if (targetNode === -1) {
        const kx = mPerDegLon(targetLat);
        let bestD = Infinity;
        for (let i = 0; i < this.nodeLon.length; i++) {
          if (dist[i] === Infinity) continue;
          const d = Math.hypot((this.nodeLon[i] - targetLon) * kx, (this.nodeLat[i] - targetLat) * M_PER_DEG_LAT);
          if (d < bestD) {
            bestD = d;
            targetNode = i;
          }
        }
      }

      if (targetNode === -1 || targetNode === u || targetNode === v) {
        return [s.point, [targetLon, targetLat]];
      }

      const steps: { from: number; to: number; edgeIdx: number }[] = [];
      let curr = targetNode;
      const visited = new Set<number>();
      while (curr !== -1 && prevNode[curr] !== -1 && !visited.has(curr)) {
        visited.add(curr);
        const p = prevNode[curr];
        const e = prevEdge[curr];
        steps.push({ from: p, to: curr, edgeIdx: e });
        if (p === u || p === v) {
          curr = p;
          break;
        }
        curr = p;
      }

      if (steps.length === 0 || (curr !== u && curr !== v)) {
        return [s.point, [targetLon, targetLat]];
      }

      steps.reverse();
      const coords: [number, number][] = [s.point];
      for (const step of steps) {
        const geom = this.geometry(step.edgeIdx);
        const nPts = geom.lon.length;
        const isForward = this.edges[step.edgeIdx].u === step.from;
        const startIdx = isForward ? 0 : nPts - 1;
        const endIdx = isForward ? nPts : -1;
        const stride = isForward ? 1 : -1;

        for (let i = startIdx; i !== endIdx; i += stride) {
          const pt: [number, number] = [geom.lon[i], geom.lat[i]];
          const last = coords[coords.length - 1];
          if (!last || last[0] !== pt[0] || last[1] !== pt[1]) {
            coords.push(pt);
          }
        }
      }

      const last = coords[coords.length - 1];
      if (!last || last[0] !== targetLon || last[1] !== targetLat) {
        coords.push([targetLon, targetLat]);
      }
      return coords;
    };

    return {
      origin: [lon, lat],
      startNode: s.node,
      startPoint: s.point,
      snapM: s.distM,
      cutoffM,
      maxDistanceM,
      segments,
      distanceTo: (gid: number) => {
        const i = localOf.get(gid);
        return i === undefined ? Infinity : dist[i];
      },
      routeTo,
    };
  }
}
