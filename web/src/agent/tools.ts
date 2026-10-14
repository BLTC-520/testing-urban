/**
 * Tools for AI agents working in the page.
 *
 * The same functions are offered two ways:
 *  - WebMCP: registered with `navigator.modelContext` when the browser provides
 *    it, so an agent in the browser can discover and call them as tools;
 *  - `window.sgjb`: a plain object for agents and scripts that evaluate
 *    JavaScript in the page (`await sgjb.call("walk_from", { lon, lat })`).
 *
 * Every tool reads the published data or runs the same in-browser street
 * network search as the Explorer, so answers match what the page shows.
 */
import { latLngToCell, cellToParent } from "h3-js";
import { reachedPois, streetGraph } from "../explore/useIsochrone";
import { EXPLORER_PARAMS, METRICS, THRESHOLDS, layoutFromParams, paramsFromView, viewFromParams, withLayout } from "../lib/explorerUrl";
import { loadCells, loadMeta, loadNeighbourhoods, loadPois, loadSummary } from "../lib/data";
import { unitAt } from "../lib/geo";
import { loadFootpath, type FootpathSite } from "../lib/footpath";
import { href, navigate } from "../lib/router";
import type { CityId, NeighbourhoodStats } from "../lib/types";

type Json = Record<string, unknown>;

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Json;
  annotations?: { readOnlyHint?: boolean };
  run: (input: Json) => Promise<unknown>;
}

const CITY_NAME: Record<CityId, string> = { sg: "Singapore", jb: "Johor Bahru" };
const round = (x: number, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const pct = (x: number) => round(x * 100, 1);
const abs = (path: string) => new URL(path, window.location.origin).href;

async function categoryLabels(): Promise<Record<string, string>> {
  const meta = await loadMeta();
  return Object.fromEntries(meta.categories.map((c) => [c.id, c.label]));
}

function cityArg(v: unknown): CityId | undefined {
  return v === "sg" || v === "jb" ? v : undefined;
}

async function citySummary(input: Json) {
  const [summary, meta, labels] = await Promise.all([loadSummary(), loadMeta(), categoryLabels()]);
  const overture = summary.poi_source_overture;
  const cities = (cityArg(input.city) ? [cityArg(input.city)!] : (["sg", "jb"] as CityId[])).map((c) => {
    const a = summary.cities[c].all as unknown as Record<string, number> & { share_complete_by_threshold: Record<string, number>; share_complete_by_speed: Record<string, number> };
    return {
      city: c,
      name: CITY_NAME[c],
      residents: Math.round(a.population),
      residents_on_walking_network: Math.round(a.population_on_network),
      percent_on_walking_network: pct(a.population_on_network / a.population),
      population_definition: meta.cities[c].population_definition,
      percent_with_all_six_essentials_within_15_min: pct(a.share_complete),
      percent_with_all_six_using_overture_places: pct(overture?.[c]?.share_complete ?? NaN),
      percent_low_access: pct(a.share_low_access),
      low_access_residents: Math.round(a.low_access_population),
      mean_essentials_reached: round(a.mean_categories, 2),
      percent_all_six_by_minutes: Object.fromEntries(Object.entries(a.share_complete_by_threshold).map(([k, v]) => [k, pct(v)])),
      percent_all_six_by_walking_speed_mps: Object.fromEntries(Object.entries(a.share_complete_by_speed).map(([k, v]) => [k, pct(v)])),
      essentials: meta.basket.map((k) => ({
        id: k,
        label: labels[k],
        percent_within_15_min: pct(a[`share_within_${k}`]),
        median_minutes: round(a[`median_min_${k}`]),
        p90_minutes: round(a[`p90_min_${k}`]),
      })),
    };
  });
  const nonResidents = meta.cities.sg.non_residents;
  const sgAll = summary.cities.sg.all;
  const sgBound = nonResidents ? (sgAll.share_complete * sgAll.population_on_network) / (sgAll.population + nonResidents) : NaN;
  const denominator = [
    "Shares count residents whose homes are within 250 m of a walkable street (see residents_on_walking_network). Residents further out are left out of the share.",
    "Singapore counts residents (citizens and permanent residents, Census of Population 2020). Johor Bahru counts all persons (Population and Housing Census of Malaysia 2020).",
    nonResidents
      ? `About ${(nonResidents / 1e6).toFixed(2)} million non-residents in Singapore are not counted. Even if none of them had all six essentials within reach, Singapore's share of all persons would still be at least ${pct(sgBound)}%.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    question: "Share of residents who can walk to all six everyday essentials within 15 minutes on the street network",
    denominator,
    essentials: meta.basket.map((k) => labels[k]),
    walking_speed_mps: meta.accessibility.walk_speed_mps.base,
    low_access_definition: `fewer than ${Math.round(meta.accessibility.low_access_completeness * meta.basket.length)} of ${meta.basket.length} essentials`,
    osm_snapshot: meta.osm_snapshot,
    cities,
    sources: abs(href("/methods", undefined, "data")),
  };
}

function nbRow(n: NeighbourhoodStats, labels: Record<string, string>) {
  const r = n as unknown as Record<string, number | string>;
  return {
    id: n.unit_id,
    name: n.unit_name,
    city: n.city,
    residents: Math.round(n.population),
    percent_with_all_six_within_15_min: pct(n.share_complete),
    percent_low_access: pct(n.share_low_access),
    weakest_essential: labels[n.weakest_category] ?? n.weakest_category,
    median_minutes: Object.fromEntries(
      Object.keys(labels)
        .filter((k) => typeof r[`median_min_${k}`] === "number")
        .map((k) => [k, round(r[`median_min_${k}`] as number)]),
    ),
    explorer_url: abs(href("/explore", { unit: n.unit_id })),
  };
}

async function findNeighbourhoods(input: Json) {
  const [summary, labels] = await Promise.all([loadSummary(), categoryLabels()]);
  const q = typeof input.query === "string" ? input.query.trim().toLowerCase() : "";
  const city = cityArg(input.city);
  const sort = input.sort === "least_complete" || input.sort === "most_complete" || input.sort === "population" ? input.sort : "population";
  const limit = Math.max(1, Math.min(50, Number(input.limit) || 10));
  const rows = summary.neighbourhoods
    .filter((n) => (!city || n.city === city) && (!q || n.unit_name.toLowerCase().includes(q) || n.unit_id.toLowerCase() === q))
    .sort((a, b) =>
      sort === "least_complete" ? a.share_complete - b.share_complete : sort === "most_complete" ? b.share_complete - a.share_complete : b.population - a.population,
    );
  return {
    unit: "Singapore: URA planning areas; Johor Bahru: state constituencies",
    total_matches: rows.length,
    neighbourhoods: rows.slice(0, limit).map((n) => nbRow(n, labels)),
  };
}

let parents: Promise<Record<CityId, Set<string>>> | null = null;
function cityParents() {
  parents ??= Promise.all((["sg", "jb"] as CityId[]).map((c) => loadCells(c))).then(([sg, jb]) => ({
    sg: new Set(sg.h3.map((h) => cellToParent(h, 8))),
    jb: new Set(jb.h3.map((h) => cellToParent(h, 8))),
  }));
  return parents;
}

async function walkFrom(input: Json) {
  const lon = Number(input.lon);
  const lat = Number(input.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error("lon and lat are required numbers (WGS84 degrees)");
  const minutes = THRESHOLDS.includes(Number(input.minutes)) ? Number(input.minutes) : 15;
  const meta = await loadMeta();
  const speedKey = input.speed === "slow" || input.speed === "brisk" ? input.speed : "base";
  const speed = meta.accessibility.walk_speed_mps[speedKey];
  const [units, labels] = await Promise.all([loadNeighbourhoods(), categoryLabels()]);
  const unit = unitAt(units, lon, lat);
  let city = (unit?.properties?.city as CityId | undefined) ?? null;
  if (!city) {
    const p = await cityParents();
    const cell = cellToParent(latLngToCell(lat, lon, 10), 8);
    city = p.sg.has(cell) ? "sg" : p.jb.has(cell) ? "jb" : null;
  }
  if (!city) return { error: "outside the study area (Singapore and the Johor Bahru district)", lon, lat };
  const cutoff = Math.max(minutes, 20) * 60 * speed;
  const [iso, pois] = await Promise.all([streetGraph().isochrone(lon, lat, cutoff), loadPois(city)]);
  if (!iso) return { error: "no walkable street within reach of this point", lon, lat, city };
  const reached = reachedPois(iso, pois, speed, minutes);
  const essentials = meta.basket.map((k) => {
    const n = reached.nearest[k];
    return {
      id: k,
      label: labels[k],
      within_time: !!n && n.minutes <= minutes,
      nearest_minutes: n ? round(n.minutes) : null,
      nearest_name: n?.name || null,
      destinations_within_time: reached.counts[k] ?? 0,
    };
  });
  return {
    from: { lon, lat, city: CITY_NAME[city], neighbourhood: (unit?.properties?.unit_name as string | undefined) ?? null },
    minutes,
    walking_speed_mps: speed,
    essentials_reached: essentials.filter((e) => e.within_time).length,
    essentials_total: meta.basket.length,
    essentials,
    note: "Walking on the mapped OpenStreetMap street network (calculated). Destinations further than 20 minutes are reported as null.",
    explorer_url: abs(href("/explore", paramsFromView({ ...viewFromParams(new URLSearchParams()), threshold: minutes, speed: speedKey, selection: { lon, lat, city } }))),
  };
}

async function openExplorer(input: Json) {
  const p = new URLSearchParams();
  for (const key of Object.keys(EXPLORER_PARAMS)) {
    const v = input[key];
    if (v !== undefined && v !== null && v !== "") p.set(key, String(v));
  }
  // normalise through the same parser the page uses, so invalid values fall back to the baseline
  const view = viewFromParams(p);
  const out = paramsFromView(view);
  if (p.get("unit") && !view.selection) out.set("unit", p.get("unit")!);
  withLayout(out, layoutFromParams(p));
  navigate("/explore", out);
  return { url: window.location.href, applied: Object.fromEntries(out) };
}

async function footpathScenario() {
  const [fp, labels] = await Promise.all([loadFootpath(), categoryLabels()]);
  const site = (s: FootpathSite) => ({
    place: s.place,
    neighbourhood: s.unit_name,
    between: [s.a.street, s.b.street],
    ends: [
      { lon: s.a.lon, lat: s.a.lat },
      { lon: s.b.lon, lat: s.b.lat },
    ],
    link_m: s.link_m,
    walk_today_m: s.walk_today_m,
    needs_footbridge: s.footbridge,
    residents_gaining_an_essential_within_15_min: Math.round(s.metrics["15min"].residents_gaining),
    residents_newly_reaching_all_six: Math.round(s.metrics["15min"].newly_complete),
  });
  const c = fp.chosen;
  return {
    question: fp.question,
    status: "scenario (desk study): every link must be checked on site before anyone builds it",
    chosen: {
      ...site(c),
      sensitivity: Object.fromEntries(Object.entries(c.metrics).map(([k, m]) => [k, Math.round(m.residents_gaining)])),
      by_essential: c.changes.by_essential
        .filter((r) => r.residents_newly_within_15min > 0)
        .map((r) => ({ essential: labels[r.essential] ?? r.essential, residents_newly_within_15_min: Math.round(r.residents_newly_within_15min), median_minutes_before: round(r.median_minutes_before ?? NaN), median_minutes_after: round(r.median_minutes_after ?? NaN) })),
      sample_routes: fp.routes.map((r) => ({ essential: labels[r.essential] ?? r.essential, destination: r.after.destination.name, minutes_today: r.before.minutes, minutes_with_path: r.after.minutes })),
    },
    alternatives: fp.alternatives.map(site),
    assumptions: fp.assumptions,
    site_checks: fp.site_checks,
    screening: fp.screening,
    method: abs(href("/methods", undefined, "footpath")),
  };
}

export const TOOLS: AgentTool[] = [
  {
    name: "get_city_summary",
    description:
      "Headline results for Singapore and/or Johor Bahru: share of residents who can walk to all six everyday essentials (a grocery or provision shop, a clinic, hospital or pharmacy, a school or childcare centre, a park of at least 0.5 ha, a bus stop or station, an eatery) within 15 minutes, the share on the walking network, the Overture Places check, low-access residents, and per-essential walking times.",
    inputSchema: { type: "object", properties: { city: { type: "string", enum: ["sg", "jb"], description: "Omit for both cities" } } },
    annotations: { readOnlyHint: true },
    run: citySummary,
  },
  {
    name: "find_neighbourhoods",
    description:
      "Search or rank neighbourhoods (Singapore planning areas, Johor Bahru state constituencies) by name, completeness or population. Returns walking-access statistics and a link that opens the neighbourhood in the Explorer.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Part of a name (e.g. 'Bedok') or an exact id" },
        city: { type: "string", enum: ["sg", "jb"] },
        sort: { type: "string", enum: ["population", "least_complete", "most_complete"], default: "population" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
      },
    },
    annotations: { readOnlyHint: true },
    run: findNeighbourhoods,
  },
  {
    name: "walk_from",
    description:
      "Walk the street network from a point in Singapore or Johor Bahru and report which of the six essentials are reachable within the time budget, with the nearest destination for each.",
    inputSchema: {
      type: "object",
      properties: {
        lon: { type: "number", description: "Longitude (WGS84), e.g. 103.8198" },
        lat: { type: "number", description: "Latitude (WGS84), e.g. 1.3521" },
        minutes: { type: "integer", enum: THRESHOLDS, default: 15 },
        speed: { type: "string", enum: ["slow", "base", "brisk"], default: "base", description: "0.9 / 1.2 / 1.4 m/s" },
      },
      required: ["lon", "lat"],
    },
    annotations: { readOnlyHint: true },
    run: walkFrom,
  },
  {
    name: "get_footpath_scenario",
    description:
      "The one-footpath scenario: the single short public footpath in Johor Bahru that would bring the most residents an extra everyday essential within a 15-minute walk, with its effect, sample routes, sensitivity, ranked alternatives, assumptions and the checks to make on site.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    run: footpathScenario,
  },
  {
    name: "open_explorer",
    description:
      "Show a view in the interactive Explorer map: choose the essential, time budget, walking speed, population group, an alternative assumption, a car-park-to-hub scenario, a point to walk from, or a neighbourhood, shown as the map or as a table of neighbourhoods. Navigates this page and returns the shareable URL.",
    inputSchema: {
      type: "object",
      properties: {
        metric: { type: "string", enum: METRICS },
        minutes: { type: "integer", enum: THRESHOLDS },
        speed: { type: "string", enum: ["slow", "base", "brisk"] },
        people: { type: "string", enum: ["all", "elderly"] },
        taxonomy: { type: "string", enum: ["strict", "broad"] },
        network: { type: "string", enum: ["strict"] },
        poi: { type: "string", enum: ["overture"] },
        scenario: { type: "string", enum: ["p2p10", "p2p25", "p2p50"] },
        lon: { type: "number" },
        lat: { type: "number" },
        unit: { type: "string", description: "Neighbourhood id from find_neighbourhoods" },
        view: { type: "string", enum: ["map", "table"], description: "table: a sortable table of all neighbourhoods instead of the map" },
      },
    },
    run: openExplorer,
  },
];

export async function call(name: string, input: Json = {}): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`unknown tool ${name}; available: ${TOOLS.map((t) => t.name).join(", ")}`);
  return tool.run(input ?? {});
}

interface ModelContext {
  registerTool?: (tool: Json) => unknown;
  provideContext?: (ctx: { tools: Json[] }) => unknown;
}

/** Register with WebMCP (if the browser has it) and expose window.sgjb. */
export function registerAgentTools(): void {
  const asWebMcp = (t: AgentTool) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: t.annotations,
    execute: async (input: Json) => {
      try {
        return { content: [{ type: "text", text: JSON.stringify(await t.run(input ?? {}), null, 1) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  });
  const mc = (navigator as Navigator & { modelContext?: ModelContext }).modelContext;
  try {
    if (mc?.registerTool) TOOLS.forEach((t) => mc.registerTool!(asWebMcp(t)));
    else if (mc?.provideContext) mc.provideContext({ tools: TOOLS.map(asWebMcp) });
  } catch (e) {
    console.warn("WebMCP registration failed", e);
  }
  (window as unknown as { sgjb: unknown }).sgjb = {
    about: "Singapore / Johor Bahru 15-Minute City Explorer — tools for agents. See /llms.txt.",
    tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    explorerParams: EXPLORER_PARAMS,
    call,
  };
}
