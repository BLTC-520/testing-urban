/**
 * Build server/data/sgjb.db from the committed pipeline outputs in
 * web/public/data. Destructive and idempotent: the file is deleted and
 * rebuilt, so the database is never a source of truth that can drift.
 *
 *   npm run ingest            # default location
 *   SGJB_DB=/tmp/x.db npm run ingest
 */
import Database from "better-sqlite3";
import { cellToParent } from "h3-js";
import { readFileSync, rmSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { distanceColumn, h3Column, readTable } from "./binary.ts";
import { DATA, DB_PATH } from "./paths.ts";

const CITIES = ["sg", "jb"] as const;
type City = (typeof CITIES)[number];

/** Categories that count toward the 15-minute completeness score. */
const BASKET = ["groceries", "healthcare", "education", "green_space", "transit", "dining"] as const;
/** Measured and mapped, but excluded from completeness. */
const SUPPLEMENTARY = ["rapid_transit", "civic"] as const;
const ALL_CATEGORIES = [...BASKET, ...SUPPLEMENTARY];

const readJson = <T>(name: string): T => JSON.parse(readFileSync(resolve(DATA, name), "utf8")) as T;

// --- shapes we actually read out of the pipeline's JSON ---------------------
interface Meta {
  version: string;
  generated_utc: string;
  osm_snapshot: string;
  taxonomy_version: string;
  h3_resolution: number;
  basket: string[];
  categories: {
    id: string; label: string; short: string; question: string; basket: boolean;
    includes?: Record<string, string[]>;
  }[];
  accessibility: {
    walk_speed_mps: Record<string, number>;
    thresholds_min: number[];
    headline_threshold_min: number;
    low_access_completeness: number;
    search_cap_min: number;
  };
  cities: Record<City, {
    name: string; center: [number, number]; zoom: number;
    population_definition: string; non_residents?: number;
  }>;
  parking_to_proximity: { label: string; sites_per_city: number[] };
}

type MetricBlock = Record<string, unknown>;
interface Summary {
  cities: Record<City, Record<string, MetricBlock>>;
  neighbourhoods: Record<string, unknown>[];
  scenarios: {
    parking: Record<City, {
      before: Record<string, number>;
      after: Record<string, Record<string, number>>;
    }>;
  };
}

interface Footpath {
  city: City;
  chosen: FootpathLink;
  alternatives: FootpathLink[];
}
interface FootpathLink {
  a: { lon: number; lat: number; street?: string };
  b: { lon: number; lat: number; street?: string };
  mid: { lon: number; lat: number };
  link_m: number;
  walk_today_m: number;
  footbridge: boolean;
  unit_id?: string;
  unit_name?: string;
  place?: string;
  metrics?: Record<string, Record<string, number>>;
}

// ---------------------------------------------------------------------------

function open(): Database.Database {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${DB_PATH}${suffix}`, { force: true });
  const db = new Database(DB_PATH);
  db.exec(readFileSync(resolve(dirname(new URL(import.meta.url).pathname), "schema.sql"), "utf8"));
  return db;
}

/** Insert many rows inside one transaction — the difference between 90k inserts
 *  taking a minute and taking a second. */
function insertAll<T>(db: Database.Database, sql: string, rows: Iterable<T>): number {
  const stmt = db.prepare(sql);
  let n = 0;
  db.transaction(() => {
    for (const r of rows) {
      stmt.run(r as Record<string, unknown>);
      n++;
    }
  })();
  return n;
}

function ingestMeta(db: Database.Database, meta: Meta): void {
  const rows = {
    version: meta.version,
    generated_utc: meta.generated_utc,
    osm_snapshot: meta.osm_snapshot,
    taxonomy_version: meta.taxonomy_version,
    h3_resolution: meta.h3_resolution,
    basket: meta.basket,
    supplementary: SUPPLEMENTARY,
    walk_speed_mps: meta.accessibility.walk_speed_mps,
    thresholds_min: meta.accessibility.thresholds_min,
    headline_threshold_min: meta.accessibility.headline_threshold_min,
    low_access_completeness: meta.accessibility.low_access_completeness,
    search_cap_min: meta.accessibility.search_cap_min,
    // The parent resolutions /api/cells is allowed to aggregate to.
    aggregate_resolutions: [7, 8, 10],
  };
  insertAll(
    db,
    "INSERT INTO meta (key, value_json) VALUES (@key, @value_json)",
    Object.entries(rows).map(([key, value]) => ({ key, value_json: JSON.stringify(value) })),
  );
}

function ingestCities(db: Database.Database, meta: Meta, summary: Summary): void {
  insertAll(
    db,
    `INSERT INTO cities (id, name, center_lon, center_lat, zoom, population,
                         population_definition, non_residents)
     VALUES (@id, @name, @center_lon, @center_lat, @zoom, @population,
             @population_definition, @non_residents)`,
    CITIES.map((id) => {
      const c = meta.cities[id];
      return {
        id,
        name: c.name,
        center_lon: c.center[0],
        center_lat: c.center[1],
        zoom: c.zoom,
        population: (summary.cities[id].all.population as number) ?? null,
        population_definition: c.population_definition,
        non_residents: c.non_residents ?? null,
      };
    }),
  );
}

function ingestEssentials(db: Database.Database, meta: Meta): void {
  const byId = new Map(meta.categories.map((c) => [c.id, c]));
  insertAll(
    db,
    `INSERT INTO essentials (id, label, short, question, in_basket, sort_order, osm_tags)
     VALUES (@id, @label, @short, @question, @in_basket, @sort_order, @osm_tags)`,
    ALL_CATEGORIES.map((id, i) => {
      const c = byId.get(id);
      if (!c) throw new Error(`meta.json has no category "${id}"`);
      return {
        id,
        label: c.label,
        short: c.short,
        question: c.question,
        in_basket: c.basket ? 1 : 0,
        sort_order: i,
        osm_tags: c.includes ? JSON.stringify(c.includes) : null,
      };
    }),
  );
}

/**
 * Neighbourhoods come from two files that have to be joined: the GeoJSON
 * carries `idx` (the integer the binary `unit` column points at), the summary
 * carries the same stats keyed by unit_id. We key on the GeoJSON because idx
 * is what the cells table needs.
 */
function ingestNeighbourhoods(db: Database.Database): number {
  const fc = readJson<{ features: { properties: Record<string, unknown> }[] }>("neighbourhoods.geojson");
  return insertAll(
    db,
    `INSERT INTO neighbourhoods (idx, city_id, unit_id, unit_name, area_km2, population, elderly,
        share_complete, share_low_access, low_access_population, mean_categories,
        elderly_share_complete, elderly_share_complete_slow, weakest_category, weakest_share)
     VALUES (@idx, @city_id, @unit_id, @unit_name, @area_km2, @population, @elderly,
        @share_complete, @share_low_access, @low_access_population, @mean_categories,
        @elderly_share_complete, @elderly_share_complete_slow, @weakest_category, @weakest_share)`,
    fc.features.map(({ properties: p }) => ({
      idx: p.idx as number,
      city_id: p.city as string,
      unit_id: p.unit_id as string,
      unit_name: p.unit_name as string,
      area_km2: (p.area_km2 as number) ?? null,
      population: (p.population as number) ?? null,
      elderly: (p.elderly as number) ?? null,
      share_complete: (p.share_complete as number) ?? null,
      share_low_access: (p.share_low_access as number) ?? null,
      low_access_population: (p.low_access_population as number) ?? null,
      mean_categories: (p.mean_categories as number) ?? null,
      elderly_share_complete: (p.elderly_share_complete as number) ?? null,
      elderly_share_complete_slow: (p.elderly_share_complete_slow as number) ?? null,
      weakest_category: (p.weakest_category as string) ?? null,
      weakest_share: (p.weakest_share as number) ?? null,
    })),
  );
}

/**
 * The main grid. For each city: read cells_<city>.bin, resolve the two parent
 * hexes per cell, and store distances in metres with 65535 → NULL.
 */
function ingestCells(db: Database.Database): Record<City, number> {
  const counts = {} as Record<City, number>;
  const known = new Set<number>(
    db.prepare("SELECT idx FROM neighbourhoods").all().map((r) => (r as { idx: number }).idx),
  );
  for (const city of CITIES) {
    const t = readTable(resolve(DATA, `cells_${city}.bin`));
    const h3 = h3Column(t);
    const pop = t.raw.pop as Float32Array;
    const elderly = t.raw.elderly as Float32Array;
    const unit = t.raw.unit as Uint16Array;
    const d = Object.fromEntries(
      ALL_CATEGORIES.map((c) => [c, distanceColumn(t, `d_${c}`)]),
    ) as Record<string, (number | null)[]>;

    counts[city] = insertAll(
      db,
      `INSERT INTO cells (city_id, h3, h3_r8, h3_r7, pop, elderly, unit_idx,
          d_groceries, d_healthcare, d_education, d_green_space, d_transit, d_dining,
          d_rapid_transit, d_civic)
       VALUES (@city_id, @h3, @h3_r8, @h3_r7, @pop, @elderly, @unit_idx,
          @d_groceries, @d_healthcare, @d_education, @d_green_space, @d_transit, @d_dining,
          @d_rapid_transit, @d_civic)`,
      (function* () {
        for (let i = 0; i < t.rows; i++) {
          // 65535 is the binary's "no unit"; anything not in the GeoJSON is NULL too.
          const u = unit[i];
          yield {
            city_id: city,
            h3: h3[i],
            h3_r8: cellToParent(h3[i], 8),
            h3_r7: cellToParent(h3[i], 7),
            pop: pop[i],
            elderly: elderly[i],
            unit_idx: u !== 65535 && known.has(u) ? u : null,
            ...Object.fromEntries(ALL_CATEGORIES.map((c) => [`d_${c}`, d[c][i]])),
          };
        }
      })(),
    );
  }
  return counts;
}

function ingestScenarios(db: Database.Database, meta: Meta, summary: Summary): { rows: number; cells: number } {
  const label = meta.parking_to_proximity.label;
  const sitesList = meta.parking_to_proximity.sites_per_city;

  const rows = insertAll(
    db,
    `INSERT INTO scenarios (id, city_id, family, label, sites, site_area_ha,
        share_complete_before, share_complete_after, share_low_before, share_low_after,
        low_access_pop_before, low_access_pop_after, newly_complete)
     VALUES (@id, @city_id, 'parking', @label, @sites, @site_area_ha,
        @share_complete_before, @share_complete_after, @share_low_before, @share_low_after,
        @low_access_pop_before, @low_access_pop_after, @newly_complete)`,
    CITIES.flatMap((city) => {
      const p = summary.scenarios.parking[city];
      return sitesList.map((n) => {
        const after = p.after[String(n)];
        if (!after) throw new Error(`summary.json has no parking scenario ${n} for ${city}`);
        return {
          id: `p2p${n}`,
          city_id: city,
          label: `${label} — ${n} sites`,
          sites: n,
          site_area_ha: after.site_area_ha ?? null,
          share_complete_before: p.before.share_complete,
          share_complete_after: after.share_complete,
          share_low_before: p.before.share_low_access ?? null,
          share_low_after: after.share_low_access ?? null,
          low_access_pop_before: p.before.low_access_population ?? null,
          low_access_pop_after: after.low_access_population ?? null,
          newly_complete: after.newly_complete ?? null,
        };
      });
    }),
  );

  let cells = 0;
  for (const city of CITIES) {
    const t = readTable(resolve(DATA, `cells_${city}_scenario.bin`));
    const h3 = h3Column(t);
    const parents = h3.map((h) => [cellToParent(h, 8), cellToParent(h, 7)] as const);
    for (const n of sitesList) {
      const d = Object.fromEntries(
        BASKET.map((c) => [c, distanceColumn(t, `d_${c}__p2p${n}`)]),
      ) as Record<string, (number | null)[]>;
      cells += insertAll(
        db,
        `INSERT INTO scenario_cells (scenario_id, city_id, h3, h3_r8, h3_r7,
            d_groceries, d_healthcare, d_education, d_green_space, d_transit, d_dining)
         VALUES (@scenario_id, @city_id, @h3, @h3_r8, @h3_r7,
            @d_groceries, @d_healthcare, @d_education, @d_green_space, @d_transit, @d_dining)`,
        (function* () {
          for (let i = 0; i < t.rows; i++) {
            yield {
              scenario_id: `p2p${n}`,
              city_id: city,
              h3: h3[i],
              h3_r8: parents[i][0],
              h3_r7: parents[i][1],
              ...Object.fromEntries(BASKET.map((c) => [`d_${c}`, d[c][i]])),
            };
          }
        })(),
      );
    }
  }
  return { rows, cells };
}

/**
 * The pipeline's aggregate metrics. Scalars go to city_metrics; the three
 * pre-computed series the charts plot go to city_series with an explicit
 * position so the x-axis order survives the round trip through SQL.
 */
function ingestCityMetrics(db: Database.Database, summary: Summary): { metrics: number; series: number } {
  const SERIES = {
    share_complete_by_threshold: "by_threshold",
    share_complete_by_speed: "by_speed",
  } as const;

  const metrics: Record<string, unknown>[] = [];
  const series: Record<string, unknown>[] = [];

  for (const city of CITIES) {
    for (const [cohort, block] of Object.entries(summary.cities[city])) {
      for (const [key, value] of Object.entries(block)) {
        if (key in SERIES) {
          const name = SERIES[key as keyof typeof SERIES];
          Object.entries(value as Record<string, number>).forEach(([bucket, v], i) =>
            series.push({ city_id: city, cohort, series: name, bucket, position: i, value: v }),
          );
        } else if (key === "categories_histogram") {
          (value as number[]).forEach((v, i) =>
            series.push({ city_id: city, cohort, series: "histogram", bucket: String(i), position: i, value: v }),
          );
        } else if (typeof value === "number") {
          metrics.push({ city_id: city, cohort, metric: key, value });
        } else if (cohort === "supplementary") {
          // supplementary is a flat block of numbers; anything else non-numeric
          // (strings, nested objects) is provenance, not a dashboard metric.
          continue;
        }
      }
    }
  }

  return {
    metrics: insertAll(
      db,
      "INSERT INTO city_metrics (city_id, cohort, metric, value) VALUES (@city_id, @cohort, @metric, @value)",
      metrics,
    ),
    series: insertAll(
      db,
      `INSERT INTO city_series (city_id, cohort, series, bucket, position, value)
       VALUES (@city_id, @cohort, @series, @bucket, @position, @value)`,
      series,
    ),
  };
}

function ingestFootpath(db: Database.Database): { links: number; metrics: number } {
  const fp = readJson<Footpath>("footpath.json");
  const links = [fp.chosen, ...fp.alternatives];
  const nLinks = insertAll(
    db,
    `INSERT INTO footpath_links (rank, is_chosen, city_id, a_lon, a_lat, a_street,
        b_lon, b_lat, b_street, mid_lon, mid_lat, link_m, walk_today_m, footbridge,
        unit_id, unit_name, place)
     VALUES (@rank, @is_chosen, @city_id, @a_lon, @a_lat, @a_street,
        @b_lon, @b_lat, @b_street, @mid_lon, @mid_lat, @link_m, @walk_today_m, @footbridge,
        @unit_id, @unit_name, @place)`,
    links.map((l, rank) => ({
      rank,
      is_chosen: rank === 0 ? 1 : 0,
      city_id: fp.city,
      a_lon: l.a.lon, a_lat: l.a.lat, a_street: l.a.street ?? null,
      b_lon: l.b.lon, b_lat: l.b.lat, b_street: l.b.street ?? null,
      mid_lon: l.mid.lon, mid_lat: l.mid.lat,
      link_m: l.link_m,
      walk_today_m: l.walk_today_m,
      footbridge: l.footbridge ? 1 : 0,
      unit_id: l.unit_id ?? null,
      unit_name: l.unit_name ?? null,
      place: l.place ?? null,
    })),
  );

  const metrics = links.flatMap((l, rank) =>
    Object.entries(l.metrics ?? {}).flatMap(([threshold, block]) =>
      Object.entries(block)
        .filter(([, v]) => typeof v === "number")
        .map(([metric, value]) => ({ rank, threshold, metric, value })),
    ),
  );
  return {
    links: nLinks,
    metrics: insertAll(
      db,
      `INSERT INTO footpath_metrics (rank, threshold, metric, value)
       VALUES (@rank, @threshold, @metric, @value)`,
      metrics,
    ),
  };
}

function main(): void {
  const started = Date.now();
  const meta = readJson<Meta>("meta.json");
  const summary = readJson<Summary>("summary.json");

  // Fail loudly if the pipeline's basket ever changes shape under us.
  if (meta.basket.join() !== BASKET.join()) {
    throw new Error(`meta.json basket is [${meta.basket}]; ingest expects [${BASKET}]`);
  }
  if (meta.h3_resolution !== 10) {
    throw new Error(`ingest assumes H3 resolution 10, meta.json says ${meta.h3_resolution}`);
  }

  const db = open();
  ingestMeta(db, meta);
  ingestCities(db, meta, summary);
  ingestEssentials(db, meta);
  const nb = ingestNeighbourhoods(db);
  const cells = ingestCells(db);
  const scn = ingestScenarios(db, meta, summary);
  const cm = ingestCityMetrics(db, summary);
  const fp = ingestFootpath(db);

  db.exec("ANALYZE");
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.pragma("optimize");
  const integrity = db.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") throw new Error(`integrity_check: ${integrity}`);
  // WAL speeds up the writes above, but the finished file is only ever read.
  // Left in WAL, every reader must create a -shm file beside it, so a read-only
  // open fails wherever the directory is not writable (the Docker image).
  db.pragma("journal_mode = DELETE");
  db.close();

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`built ${DB_PATH} in ${seconds}s`);
  console.table({
    cities: { rows: CITIES.length },
    essentials: { rows: ALL_CATEGORIES.length },
    neighbourhoods: { rows: nb },
    "cells (sg)": { rows: cells.sg },
    "cells (jb)": { rows: cells.jb },
    scenarios: { rows: scn.rows },
    scenario_cells: { rows: scn.cells },
    city_metrics: { rows: cm.metrics },
    city_series: { rows: cm.series },
    footpath_links: { rows: fp.links },
    footpath_metrics: { rows: fp.metrics },
  });
}

main();
