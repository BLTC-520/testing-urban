/**
 * The read-only connection and the settings the API validates against.
 *
 * `readonly: true` is a guarantee, not a hint: this process physically cannot
 * write to the database, so no route — however badly written — can mutate the
 * analysis. The ingest is the only writer.
 */
import Database from "better-sqlite3";
import { DB_PATH } from "./paths.ts";

export type City = "sg" | "jb";

/** Categories that count toward the 15-minute completeness score. */
export const BASKET = ["groceries", "healthcare", "education", "green_space", "transit", "dining"] as const;
export type Basket = (typeof BASKET)[number];

/**
 * Unpopulated cells still carry a sliver of weight so that parkland and
 * industrial estates get a colour instead of a hole — and so a parent hexagon
 * with no residents at all does not divide by zero. The React site does the
 * same in web/src/lib/access.ts.
 */
export const WEIGHT_EPSILON = 1e-3;

export interface Settings {
  cities: City[];
  /** Named walking-speed presets from the study, in metres per second. */
  speeds: Record<string, number>;
  /** Threshold presets in minutes, for the UI; `minutes` is validated as a range. */
  thresholds: number[];
  headlineThreshold: number;
  /** H3 resolutions /api/cells is allowed to aggregate to. */
  resolutions: number[];
  lowAccessCompleteness: number;
  generatedUtc: string;
  osmSnapshot: string;
  h3Resolution: number;
  scenarioIds: string[];
}

export interface Store {
  db: Database.Database;
  settings: Settings;
  close(): void;
}

export function openStore(path: string = DB_PATH): Store {
  let db: Database.Database;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
  } catch (cause) {
    throw new Error(
      `cannot open ${path} — run \`npm run ingest\` first (${(cause as Error).message})`,
      { cause },
    );
  }
  const setting = (key: string) => {
    const row = db.prepare<[string], { value_json: string }>(
      "SELECT value_json FROM meta WHERE key = ?",
    ).get(key);
    if (!row) throw new Error(`meta table has no "${key}" — stale database, re-run the ingest`);
    return JSON.parse(row.value_json);
  };

  const settings: Settings = {
    cities: db.prepare<[], { id: City }>("SELECT id FROM cities ORDER BY id").all().map((r) => r.id),
    speeds: setting("walk_speed_mps"),
    thresholds: setting("thresholds_min"),
    headlineThreshold: setting("headline_threshold_min"),
    resolutions: setting("aggregate_resolutions"),
    lowAccessCompleteness: setting("low_access_completeness"),
    generatedUtc: setting("generated_utc"),
    osmSnapshot: setting("osm_snapshot"),
    h3Resolution: setting("h3_resolution"),
    scenarioIds: db.prepare<[], { id: string }>("SELECT DISTINCT id FROM scenarios ORDER BY sites").all().map((r) => r.id),
  };

  return { db, settings, close: () => db.close() };
}
