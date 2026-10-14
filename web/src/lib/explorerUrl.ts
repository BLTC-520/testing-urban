import type { ExplorerState, MetricId, ScenarioId, SpeedKey } from "./store";
import type { CityId } from "./types";

/**
 * Explorer state ⇄ query string, so every view has a shareable URL that
 * people and agents can write by hand:
 *
 *   /explore/?metric=healthcare&minutes=10&speed=slow&lon=103.7414&lat=1.4927
 *
 * Only values that differ from the baseline are written. The three
 * assumption switches are mutually exclusive in the UI (one varied at a time),
 * so at most one of taxonomy / network / poi is honoured, in that order.
 */
export type ExplorerView = Pick<ExplorerState, "metric" | "threshold" | "speed" | "people" | "taxonomy" | "network" | "poiSource" | "scenario" | "selection">;

export const DEFAULT_VIEW: ExplorerView = {
  metric: "complete",
  threshold: 15,
  speed: "base",
  people: "all",
  taxonomy: "core",
  network: "permissive",
  poiSource: "osm",
  scenario: "none",
  selection: null,
};

export const METRICS: MetricId[] = ["complete", "groceries", "healthcare", "education", "green_space", "transit", "dining", "rapid_transit", "civic"];
export const THRESHOLDS = [5, 10, 15, 20];
const SPEEDS: SpeedKey[] = ["slow", "base", "brisk"];
const SCENARIOS: ScenarioId[] = ["none", "p2p10", "p2p25", "p2p50"];

/** The parameters this page understands, for documentation (llms.txt) and agent tools. */
export const EXPLORER_PARAMS: Record<string, string> = {
  metric: `${METRICS.join(" | ")} (default complete = all six essentials)`,
  minutes: `${THRESHOLDS.join(" | ")} (default 15)`,
  speed: "slow (0.9 m/s) | base (1.2 m/s, default) | brisk (1.4 m/s)",
  people: "all (default) | elderly (residents aged 65+)",
  taxonomy: "strict | broad (alternative definitions of the essentials)",
  network: "strict (exclude paths with uncertain pedestrian access)",
  poi: "overture (Overture Places instead of OpenStreetMap destinations)",
  scenario: "p2p10 | p2p25 | p2p50 (convert 10/25/50 car parks per city into neighbourhood hubs)",
  lon: "longitude of a point to walk from (with lat)",
  lat: "latitude of a point to walk from (with lon)",
  city: "sg | jb (optional; inferred from lon/lat)",
  unit: "neighbourhood id to zoom to, e.g. BD (Bedok) or JB-N.46 (Perling); ids and names are in /data/summary.json",
  view: "table (a sortable table of all 50 neighbourhoods for the current settings, instead of the map; works without WebGL)",
};

const pick = <T extends string | number>(v: string | null, allowed: readonly T[]): T | undefined =>
  allowed.find((a) => String(a) === v);

export function viewFromParams(p: URLSearchParams): ExplorerView {
  const v: ExplorerView = { ...DEFAULT_VIEW };
  v.metric = pick(p.get("metric"), METRICS) ?? v.metric;
  v.threshold = pick(p.get("minutes"), THRESHOLDS) ?? v.threshold;
  v.speed = pick(p.get("speed"), SPEEDS) ?? v.speed;
  v.people = pick(p.get("people"), ["all", "elderly"] as const) ?? v.people;
  v.scenario = pick(p.get("scenario"), SCENARIOS) ?? v.scenario;
  const taxonomy = pick(p.get("taxonomy"), ["strict", "broad"] as const);
  const network = pick(p.get("network"), ["strict"] as const);
  const poi = pick(p.get("poi"), ["overture"] as const);
  if (taxonomy) v.taxonomy = taxonomy;
  else if (network) v.network = network;
  else if (poi) v.poiSource = poi;
  const lon = Number(p.get("lon"));
  const lat = Number(p.get("lat"));
  if (p.get("lon") && p.get("lat") && Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    v.selection = { lon, lat, city: pick(p.get("city"), ["sg", "jb"] as CityId[]) ?? null };
  }
  return v;
}

/** The map (the default) or the neighbourhood table, which the URL writes as view=table. */
export type ExplorerLayout = "map" | "table";

export function layoutFromParams(p: URLSearchParams): ExplorerLayout {
  return p.get("view") === "table" ? "table" : "map";
}

/** Adds view=table to a query string; the map is the default and is not written. */
export function withLayout(p: URLSearchParams, layout: ExplorerLayout): URLSearchParams {
  if (layout === "table") p.set("view", "table");
  return p;
}

export function paramsFromView(v: ExplorerView): URLSearchParams {
  const p = new URLSearchParams();
  if (v.metric !== DEFAULT_VIEW.metric) p.set("metric", v.metric);
  if (v.threshold !== DEFAULT_VIEW.threshold) p.set("minutes", String(v.threshold));
  if (v.speed !== DEFAULT_VIEW.speed) p.set("speed", v.speed);
  if (v.people !== DEFAULT_VIEW.people) p.set("people", v.people);
  if (v.taxonomy !== DEFAULT_VIEW.taxonomy) p.set("taxonomy", v.taxonomy);
  else if (v.network !== DEFAULT_VIEW.network) p.set("network", v.network);
  else if (v.poiSource !== DEFAULT_VIEW.poiSource) p.set("poi", v.poiSource);
  if (v.scenario !== DEFAULT_VIEW.scenario) p.set("scenario", v.scenario);
  if (v.selection) {
    p.set("lon", v.selection.lon.toFixed(5));
    p.set("lat", v.selection.lat.toFixed(5));
    if (v.selection.city) p.set("city", v.selection.city);
  }
  return p;
}
