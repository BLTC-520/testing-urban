/**
 * Ported from web/src/lib/data.ts (loadPois, Pois) and
 * web/src/explore/useIsochrone.ts (reachedPois, Reached, streetGraph).
 *
 * Loads binary POI tables and evaluates reachable places per essential
 * category against a computed street-network Isochrone.
 */
import type { CityId } from "../api/types.ts";
import { decodeTable, type Table } from "./binary.ts";
import { StreetGraph, type Isochrone } from "./streetGraph.ts";

const BASE = import.meta.env.BASE_URL ?? "/";
const url = (p: string) => `${BASE}data/${p}`;

const cache = new Map<string, Promise<unknown>>();

function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) {
    const p = load().catch((err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, p);
  }
  return cache.get(key) as Promise<T>;
}

async function json<T>(p: string): Promise<T> {
  const r = await fetch(url(p));
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

async function table(p: string): Promise<Table> {
  const r = await fetch(url(p));
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
  return decodeTable(await r.arrayBuffer());
}

let sharedGraph: StreetGraph | null = null;

/** Shared browser StreetGraph instance fetching from /data/graph/. */
export function streetGraph(): StreetGraph {
  if (!sharedGraph) {
    sharedGraph = new StreetGraph(async (p) => {
      const r = await fetch(url(p));
      if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
      return r.arrayBuffer();
    });
  }
  return sharedGraph;
}

export interface Pois {
  lon: Float32Array;
  lat: Float32Array;
  mask: Uint16Array;
  areaHa: Float32Array;
  categories: string[];
  names?: string[];
  kinds?: string[];
  access?: {
    poi: Uint32Array;
    u: Uint32Array;
    v: Uint32Array;
    offU: Float32Array;
    offV: Float32Array;
    snap: Float32Array;
  };
}

export function loadPois(city: CityId): Promise<Pois> {
  return once(`pois_${city}`, async () => {
    const [t, names, acc] = await Promise.all([
      table(`pois_${city}.bin`),
      json<{ names: string[]; kinds: string[] }>(`pois_${city}.json`),
      table(`poi_access_${city}.bin`),
    ]);
    return {
      lon: t.raw.lon as Float32Array,
      lat: t.raw.lat as Float32Array,
      mask: t.raw.mask as Uint16Array,
      areaHa: t.raw.area_ha as Float32Array,
      categories: (t.meta.categories as string[]) ?? [],
      names: names.names,
      kinds: names.kinds,
      access: {
        poi: acc.raw.poi as Uint32Array,
        u: acc.raw.u as Uint32Array,
        v: acc.raw.v as Uint32Array,
        offU: acc.raw.off_u as Float32Array,
        offV: acc.raw.off_v as Float32Array,
        snap: acc.raw.snap_m as Float32Array,
      },
    };
  });
}

export interface NearestPoi {
  minutes: number;
  distanceM: number;
  name: string;
  lon: number;
  lat: number;
}

export interface Reached {
  /** category → nearest destination (minutes, distanceM, name, lon, lat) */
  nearest: Record<string, NearestPoi | null>;
  /** category → destinations within the threshold */
  counts: Record<string, number>;
  /** indices of POIs within the outer cutoff, with minutes */
  pois: { i: number; minutes: number }[];
}

export function reachedPois(
  iso: Isochrone,
  pois: Pois,
  speed: number,
  thresholdMin: number,
  detour = 1.3,
): Reached {
  const acc = pois.access!;
  const best = new Float64Array(pois.lon.length).fill(Infinity);
  for (let k = 0; k < acc.poi.length; k++) {
    const du = iso.distanceTo(acc.u[k]) + acc.offU[k];
    const dv = iso.distanceTo(acc.v[k]) + acc.offV[k];
    const d = Math.min(du, dv) + detour * acc.snap[k];
    if (d < best[acc.poi[k]]) best[acc.poi[k]] = d;
  }
  const nearest: Reached["nearest"] = {};
  const counts: Record<string, number> = {};
  const list: Reached["pois"] = [];
  pois.categories.forEach((c) => {
    nearest[c] = null;
    counts[c] = 0;
  });
  const limit = thresholdMin * 60 * speed;
  for (let i = 0; i < best.length; i++) {
    const d = best[i];
    if (!(d <= iso.cutoffM)) continue;
    const m = d / speed / 60;
    list.push({ i, minutes: m });
    pois.categories.forEach((c, bit) => {
      if (!(pois.mask[i] & (1 << bit))) return;
      if (d <= limit) counts[c]++;
      const cur = nearest[c];
      if (!cur || m < cur.minutes) {
        nearest[c] = {
          minutes: m,
          distanceM: d,
          name: pois.names?.[i] || "",
          lon: pois.lon[i],
          lat: pois.lat[i],
        };
      }
    });
  }
  return { nearest, counts, pois: list };
}
