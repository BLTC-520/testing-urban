/**
 * Candidate landmarks from OpenStreetMap, via the Overpass API.
 *
 * OSM, not the model, is the source of every name and coordinate. A Wikidata
 * tag is the notability filter: a place someone bothered to link to Wikidata is
 * one a viewer might know. One query per country, so each candidate's city is
 * known for certain rather than guessed from a latitude.
 */
import type { CityId } from "../../src/api/types.ts";
import type { Bounds } from "../../src/map/studyArea.ts";

export interface Candidate {
  /** "node/123" or "way/456": OSM's own id, which the model must echo back. */
  osmId: string;
  name: string;
  city: CityId;
  lat: number;
  lon: number;
  heightM: number | null;
  /** The tags that say what the place is, for the model to judge it by. */
  tags: Record<string, string>;
}

/** Public Overpass servers, tried in turn; the main one is often at capacity. */
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const ATTEMPTS = 6;
const FIRST_BACKOFF_MS = 5_000;
const TIMEOUT_MS = 180_000;
const METRES_PER_STOREY = 3.5;

const DESCRIPTIVE_TAGS = [
  "tourism", "historic", "amenity", "leisure", "aeroway", "barrier", "shop", "building", "religion", "railway",
] as const;

/** Each line selects one family of places worth naming. */
const FILTERS = [
  '["tourism"~"^(attraction|museum|gallery|theme_park|zoo|viewpoint)$"]',
  '["historic"]',
  '["amenity"~"^(hospital|university|college|place_of_worship|theatre|arts_centre|townhall|library)$"]',
  '["leisure"~"^(park|stadium|garden|nature_reserve)$"]',
  '["aeroway"~"^(aerodrome|terminal)$"]',
  '["building"]',
  '["barrier"="border_control"]',
  '["shop"="mall"]',
];

export function overpassQuery(iso: "SG" | "MY", [west, south, east, north]: Bounds): string {
  const box = `(${south},${west},${north},${east})`;
  const lines = FILTERS.map((f) => `  nwr(area.c)["name"]["wikidata"]${f}${box};`);
  return [
    "[out:json][timeout:120];",
    `area["ISO3166-1"="${iso}"][admin_level=2]->.c;`,
    "(",
    ...lines,
    ");",
    "out center tags;",
  ].join("\n");
}

/** Metres from OSM's height tag, or estimated from storeys; null rather than a guess. */
export function heightOf(tags: Readonly<Record<string, string>>): number | null {
  const h = Number.parseFloat(tags.height ?? "");
  if (Number.isFinite(h) && h > 0) return Math.round(h);
  const levels = Number.parseFloat(tags["building:levels"] ?? "");
  return Number.isFinite(levels) && levels > 0 ? Math.round(levels * METRES_PER_STOREY) : null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function toCandidate(el: unknown, city: CityId): Candidate | null {
  if (!isRecord(el) || !isRecord(el.tags)) return null;
  const tags = el.tags as Record<string, string>;
  const name = tags["name:en"] ?? tags.name;
  const point = isRecord(el.center) ? el.center : el;
  if (!name || !isNum(point.lat) || !isNum(point.lon)) return null;
  const kept = Object.fromEntries(DESCRIPTIVE_TAGS.filter((k) => tags[k]).map((k) => [k, tags[k]]));
  return {
    osmId: `${String(el.type)}/${String(el.id)}`,
    name, city, lat: point.lat, lon: point.lon, heightM: heightOf(tags), tags: kept,
  };
}

/** Candidates from a raw Overpass response; malformed elements are skipped, a malformed response throws. */
export function parseCandidates(raw: unknown, city: CityId): Candidate[] {
  if (!isRecord(raw) || !Array.isArray(raw.elements)) {
    throw new Error(`Not an Overpass result: ${String(raw).slice(0, 120)}`);
  }
  return raw.elements.flatMap((el) => toCandidate(el, city) ?? []);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** POST a query, rotating mirrors with exponential backoff while servers are busy. */
async function runQuery(query: string): Promise<unknown> {
  let lastError = "";
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const url = MIRRORS[attempt % MIRRORS.length];
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "User-Agent": "sgjb-dashboard-landmarks/0.1" },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      if (res.ok && text.startsWith("{")) return JSON.parse(text);
      lastError = `${url} answered ${res.status}: ${text.slice(0, 100).replace(/\s+/g, " ")}`;
    } catch (err: unknown) {
      lastError = `${url} failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    process.stderr.write(`  overpass: ${lastError}; retrying\n`);
    await wait(FIRST_BACKOFF_MS * 2 ** Math.floor(attempt / MIRRORS.length));
  }
  throw new Error(`Overpass unavailable after ${ATTEMPTS} attempts. Last: ${lastError}`);
}

export async function fetchCandidates(iso: "SG" | "MY", city: CityId, bounds: Bounds): Promise<Candidate[]> {
  return parseCandidates(await runQuery(overpassQuery(iso, bounds)), city);
}
