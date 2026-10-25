/**
 * Query validation. Every route parses its query string through one of these
 * before touching the database; nothing reaches SQL that has not been through
 * zod first.
 *
 * The allowed values come from the `meta` table, which the ingest filled from
 * the pipeline's own config. That matters: the API cannot drift from the study
 * it is serving, and adding a walking-speed preset upstream does not mean
 * editing a hardcoded list down here.
 */
import { z } from "zod";
import type { Settings } from "./db.ts";

/** `?city=sg` — exactly the cities present in the database. */
const cityOf = (s: Settings) =>
  z.enum(s.cities as [string, ...string[]]);

/** `?speed=base` — a named preset from the study, not a free-floating number.
 *  Three validated values keep responses perfectly cacheable, and stop anyone
 *  asking for a 40 m/s walk. */
const speedOf = (s: Settings) =>
  z.enum(Object.keys(s.speeds) as [string, ...string[]]);

/** `?minutes=15` — an integer walk budget. Capped at the pipeline's own search
 *  cap, beyond which the underlying distances were never measured. */
const minutes = z.coerce.number().int().min(1).max(60);

export function schemas(s: Settings) {
  const city = cityOf(s);
  const speed = speedOf(s);
  const resolution = z.coerce.number().int().refine((v) => s.resolutions.includes(v), {
    message: `resolution must be one of ${s.resolutions.join(", ")}`,
  });
  const scenario = z.enum(s.scenarioIds as [string, ...string[]]);

  return {
    /** GET /api/summary */
    summary: z.object({
      city: city.optional(),
      cohort: z.enum(["all", "elderly", "elderly_slow_walk"]).default("all"),
    }).strict(),

    /** GET /api/cells */
    cells: z.object({
      city,
      minutes: minutes.default(s.headlineThreshold),
      speed: speed.default("base"),
      /** Aggregation level. 10 returns raw cells and is deliberately gated. */
      res: resolution.default(8),
      /** Absent = observed baseline; present = that Parking-to-Proximity run. */
      scenario: scenario.optional(),
      /** Restrict to one neighbourhood, for the click-through in the map. */
      unit: z.coerce.number().int().min(0).max(65534).optional(),
    }).strict(),

    /** GET /api/scenarios */
    scenarios: z.object({
      city: city.optional(),
    }).strict(),

    /** GET /api/footpath */
    footpath: z.object({
      /** Include the nine runners-up alongside the chosen link. */
      alternatives: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
    }).strict(),

    /** GET /api/cell/:h3 — one hexagon, for the inspector panel. */
    cellParams: z.object({
      h3: z.string().regex(/^[0-9a-f]{15,16}$/, "not an H3 cell id"),
    }).strict(),
    cellQuery: z.object({
      city,
      minutes: minutes.default(s.headlineThreshold),
      speed: speed.default("base"),
      scenario: scenario.optional(),
    }).strict(),
  };
}

export type Schemas = ReturnType<typeof schemas>;
export type CellsQuery = z.infer<Schemas["cells"]>;
export type SummaryQuery = z.infer<Schemas["summary"]>;
