import { decodeTable, type Table } from "./binary";
import type { CityId, Meta, Summary } from "./types";

const BASE = import.meta.env.BASE_URL;
const url = (p: string) => `${BASE}data/${p}`;

const cache = new Map<string, Promise<unknown>>();
const resolved = new Map<string, unknown>();

function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) {
    const p = load();
    p.then((v) => resolved.set(key, v)).catch(() => cache.delete(key)); // let a failed request be retried later
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

export const loadMeta = () => once("meta", () => json<Meta>("meta.json"));
export const loadSummary = () => once("summary", () => json<Summary>("summary.json"));
export const loadNeighbourhoods = () => once("nb", () => json<GeoJSON.FeatureCollection>("neighbourhoods.geojson"));
export const loadParkingSites = () => once("parking", () => json<GeoJSON.FeatureCollection>("parking_sites.geojson"));

/** Already-loaded data, for a first render that matches the prerendered page (null until loaded). */
export const peekMeta = () => (resolved.get("meta") as Meta | undefined) ?? null;
export const peekSummary = () => (resolved.get("summary") as Summary | undefined) ?? null;
export const peekNeighbourhoods = () => (resolved.get("nb") as GeoJSON.FeatureCollection | undefined) ?? null;

/** Per-cell data for one city, decoded into convenient typed arrays. */
export interface Cells {
  city: CityId;
  n: number;
  h3: string[];
  pop: Float32Array;
  elderly: Float32Array;
  unit: Uint16Array;
  /** network distance (m) per category; NaN = unreachable / off-network */
  d: Record<string, Float32Array>;
}

function distColumns(t: Table, prefix = "d_"): Record<string, Float32Array> {
  const out: Record<string, Float32Array> = {};
  for (const [name, spec] of Object.entries(t.specs)) {
    if (!name.startsWith(prefix) || spec.dtype !== "uint16") continue;
    const src = t.raw[name] as Uint16Array;
    const nd = spec.nodata ?? 65535;
    const a = new Float32Array(t.rows);
    for (let i = 0; i < t.rows; i++) a[i] = src[i] === nd ? NaN : src[i] * (spec.scale ?? 1);
    out[name.slice(prefix.length)] = a;
  }
  return out;
}

export function loadCells(city: CityId): Promise<Cells> {
  return once(`cells_${city}`, async () => {
    const t = await table(`cells_${city}.bin`);
    const h3raw = t.raw.h3 as BigUint64Array;
    const h3 = new Array<string>(t.rows);
    for (let i = 0; i < t.rows; i++) h3[i] = h3raw[i].toString(16);
    return {
      city,
      n: t.rows,
      h3,
      pop: t.raw.pop as Float32Array,
      elderly: t.raw.elderly as Float32Array,
      unit: t.raw.unit as Uint16Array,
      d: distColumns(t),
    };
  });
}

/** Alternative distances for the assumptions panel (strict/broad taxonomy, strict network, Overture POIs). */
export function loadVariants(city: CityId) {
  return once(`variants_${city}`, async () => {
    const t = await table(`cells_${city}_variants.bin`);
    return { d: distColumns(t), popKontur: t.raw.pop_kontur as Float32Array };
  });
}

/** Parking-to-Proximity scenario distances, keyed like "groceries__p2p25". */
export function loadScenario(city: CityId) {
  return once(`scenario_${city}`, async () => distColumns(await table(`cells_${city}_scenario.bin`)));
}

export interface CrossBorder {
  n: number;
  h3: string[];
  index: Map<string, number>;
  t: Record<string, Float32Array>;
  avServed: Uint8Array;
}

export function loadCrossBorder(): Promise<CrossBorder> {
  return once("crossborder", async () => {
    const tb = await table("crossborder_jb.bin");
    const h3raw = tb.raw.h3 as BigUint64Array;
    const h3 = Array.from(h3raw, (x) => x.toString(16));
    const t: Record<string, Float32Array> = {};
    for (const [name, spec] of Object.entries(tb.specs)) {
      if (spec.dtype !== "uint16") continue;
      const src = tb.raw[name] as Uint16Array;
      const a = new Float32Array(tb.rows);
      for (let i = 0; i < tb.rows; i++) a[i] = src[i] === spec.nodata ? Infinity : src[i] * (spec.scale ?? 1);
      t[name] = a;
    }
    return { n: tb.rows, h3, index: new Map(h3.map((h, i) => [h, i])), t, avServed: tb.raw.av_served as Uint8Array };
  });
}

export interface Pois {
  lon: Float32Array;
  lat: Float32Array;
  mask: Uint16Array;
  areaHa: Float32Array;
  categories: string[];
  names?: string[];
  kinds?: string[];
  access?: { poi: Uint32Array; u: Uint32Array; v: Uint32Array; offU: Float32Array; offV: Float32Array; snap: Float32Array };
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
