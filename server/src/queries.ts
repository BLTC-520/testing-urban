/**
 * Every SQL statement the API runs.
 *
 * Two rules hold here without exception:
 *
 *   1. No user value is ever interpolated into SQL. Parameters are bound
 *      (`@city`, `@limit`, `@scenario`). Where a query shape genuinely varies —
 *      which table to read, which column to GROUP BY — the variation comes from
 *      a closed set defined in this file and selected by a value zod has
 *      already validated against that same set. The fragments below are built
 *      from BASKET and from literal table and column names, never from a
 *      request.
 *
 *   2. Completeness is thresholded per resolution-10 cell and only then
 *      aggregated over population. Doing it the other way round overstates
 *      Singapore's completeness by 4.6 points. `npm run verify` measures it.
 */
import type Database from "better-sqlite3";
import { BASKET, WEIGHT_EPSILON } from "./db.ts";

/** Which grid the distances come from. These two keys are the only accepted values. */
export type Source = "baseline" | "scenario";

/** GROUP BY targets by H3 resolution. A closed map, not a template. */
export const PARENT = { 7: "h3_r7", 8: "h3_r8", 10: "h3" } as const;
export type Resolution = keyof typeof PARENT;

/** Bound parameters shared by every filtered query. */
export interface Filters {
  city: string;
  /** minutes × 60 × speed_mps, computed in the route from validated inputs. */
  limit: number;
  /** Required by the statement even for the baseline; ignored there. */
  scenario: string | null;
  /** Restrict to one neighbourhood index, or null for the whole city. */
  unit: number | null;
}

/**
 * SQL fragments for one source.
 *
 * `scenario_cells` holds only the six basket categories — all completeness
 * needs — and no population, so it joins `cells` for weights: a scenario moves
 * destinations, not residents. Distance columns are therefore prefixed `s.`
 * for scenarios and `c.` for the baseline, and everything else reads from `c`.
 */
function parts(source: Source) {
  const d = source === "baseline" ? "c" : "s";
  return {
    from:
      source === "baseline"
        ? "cells c"
        : "scenario_cells s JOIN cells c ON c.city_id = s.city_id AND c.h3 = s.h3",
    /** How many basket categories this cell reaches within @limit metres. */
    reached: BASKET.map((k) => `(${d}.d_${k} IS NOT NULL AND ${d}.d_${k} <= @limit)`).join(" + "),
    /** A cell with no measurement at all is off the walk network. Matches the React site. */
    onNetwork: BASKET.map((k) => `${d}.d_${k} IS NOT NULL`).join(" OR "),
    /** Scenario rows must be narrowed to one run; the baseline has only one. */
    scope: source === "baseline" ? "" : "AND s.scenario_id = @scenario",
    distance: (k: string) => `${d}.d_${k}`,
  };
}

/** Population weight, floored so unpopulated land still gets a colour rather than
 *  a hole — and so a parent hexagon with no residents does not divide by zero. */
const W = `(c.pop + ${WEIGHT_EPSILON})`;
const COMPLETE = BASKET.length;
const LOW = BASKET.length / 2;

export interface HexRow {
  hex: string;
  pop: number;
  cells: number;
  share_complete: number;
  share_low: number;
  mean_categories: number;
}

/** Aggregated hexagons for the map. One query shape serves every source and resolution. */
export function hexQuery(db: Database.Database, source: Source, res: Resolution) {
  const p = parts(source);
  const hex = `c.${PARENT[res]}`;
  return db.prepare<Filters, HexRow>(`
    SELECT ${hex}                                                      AS hex,
           SUM(c.pop)                                                  AS pop,
           COUNT(*)                                                    AS cells,
           SUM(${W} * ((${p.reached}) = ${COMPLETE})) / SUM(${W})      AS share_complete,
           SUM(${W} * ((${p.reached}) <  ${LOW}))     / SUM(${W})      AS share_low,
           SUM(${W} *  (${p.reached}))                / SUM(${W})      AS mean_categories
    FROM ${p.from}
    WHERE c.city_id = @city ${p.scope}
      AND (${p.onNetwork})
      AND (@unit IS NULL OR c.unit_idx = @unit)
    GROUP BY hex
    ORDER BY hex
  `);
}

export interface Totals {
  population: number;
  population_on_network: number;
  share_complete: number;
  share_low_access: number;
  low_access_population: number;
  mean_categories: number;
}

/** City-wide totals under the same filters, so the KPI tiles and the map agree. */
export function totalsQuery(db: Database.Database, source: Source) {
  const p = parts(source);
  return db.prepare<Filters, Totals>(`
    SELECT (SELECT SUM(pop) FROM cells WHERE city_id = @city)             AS population,
           SUM(c.pop)                                                     AS population_on_network,
           SUM(c.pop * ((${p.reached}) = ${COMPLETE})) / SUM(c.pop)        AS share_complete,
           SUM(c.pop * ((${p.reached}) <  ${LOW}))     / SUM(c.pop)        AS share_low_access,
           SUM(c.pop * ((${p.reached}) <  ${LOW}))                         AS low_access_population,
           SUM(c.pop *  (${p.reached}))                / SUM(c.pop)        AS mean_categories
    FROM ${p.from}
    WHERE c.city_id = @city ${p.scope}
      AND (${p.onNetwork})
      AND (@unit IS NULL OR c.unit_idx = @unit)
  `);
}

/** The 0…6 distribution under the current filters. */
export function histogramQuery(db: Database.Database, source: Source) {
  const p = parts(source);
  return db.prepare<Filters, { reached: number; pop: number }>(`
    SELECT (${p.reached}) AS reached, SUM(c.pop) AS pop
    FROM ${p.from}
    WHERE c.city_id = @city ${p.scope}
      AND (${p.onNetwork})
      AND (@unit IS NULL OR c.unit_idx = @unit)
    GROUP BY reached
    ORDER BY reached
  `);
}

/** Population-weighted share reaching each essential, for the category panel. */
export function byEssentialQuery(db: Database.Database, source: Source) {
  const p = parts(source);
  const cols = BASKET.map(
    (k) => `SUM(c.pop * (${p.distance(k)} IS NOT NULL AND ${p.distance(k)} <= @limit)) / SUM(c.pop) AS ${k}`,
  ).join(",\n           ");
  return db.prepare<Filters, Record<string, number>>(`
    SELECT ${cols}
    FROM ${p.from}
    WHERE c.city_id = @city ${p.scope}
      AND (${p.onNetwork})
      AND (@unit IS NULL OR c.unit_idx = @unit)
  `);
}

/** Per-neighbourhood ranking under the current filters, for the table panel. */
export function byUnitQuery(db: Database.Database, source: Source) {
  const p = parts(source);
  return db.prepare<Filters, {
    unit_idx: number; unit_id: string; unit_name: string; pop: number;
    share_complete: number; mean_categories: number;
  }>(`
    SELECT c.unit_idx, n.unit_id, n.unit_name,
           SUM(c.pop)                                               AS pop,
           SUM(c.pop * ((${p.reached}) = ${COMPLETE})) / SUM(c.pop)  AS share_complete,
           SUM(c.pop *  (${p.reached}))                / SUM(c.pop)  AS mean_categories
    FROM ${p.from}
    JOIN neighbourhoods n ON n.idx = c.unit_idx
    WHERE c.city_id = @city ${p.scope}
      AND (${p.onNetwork})
      AND c.unit_idx IS NOT NULL
      AND (@unit IS NULL OR c.unit_idx = @unit)
    GROUP BY c.unit_idx
    HAVING SUM(c.pop) > 0
    ORDER BY share_complete DESC
  `);
}

/** One hexagon in full, for the inspector panel. */
export function cellQuery(db: Database.Database) {
  return db.prepare<{ city: string; h3: string }, Record<string, unknown>>(`
    SELECT c.h3, c.pop, c.elderly, c.unit_idx,
           ${BASKET.map((k) => `c.d_${k}`).join(", ")},
           c.d_rapid_transit, c.d_civic,
           n.unit_id, n.unit_name, n.weakest_category
    FROM cells c
    LEFT JOIN neighbourhoods n ON n.idx = c.unit_idx
    WHERE c.city_id = @city AND c.h3 = @h3
  `);
}

/** The same hexagon under a scenario, for the before/after inspector. */
export function cellScenarioQuery(db: Database.Database) {
  return db.prepare<{ city: string; h3: string; scenario: string }, Record<string, number | null>>(`
    SELECT ${BASKET.map((k) => `d_${k}`).join(", ")}
    FROM scenario_cells
    WHERE city_id = @city AND h3 = @h3 AND scenario_id = @scenario
  `);
}
