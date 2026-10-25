/**
 * Prove the ingest did not change the study's findings.
 *
 * The dashboard recomputes completeness from per-cell metres rather than
 * reading the pipeline's published shares, so it has to agree with them.
 * This recomputes share_complete / share_low_access from the `cells` table
 * for every published threshold and walking speed and compares against the
 * pipeline's own numbers in city_metrics / city_series.
 *
 * Agreement is to within TOL_SHARE (0.1 percentage point), not exact, for two
 * reasons that are properties of the committed binary files rather than of
 * this ingest. Both are measured at the end of this script, and the existing
 * React site inherits both identically:
 *
 *   1. Rounding. cells_*.bin stores distances as uint16 METRES (np.rint), so a
 *      cell whose true distance is 1080.4 m is stored as 1080. At the 15-min
 *      1.2 m/s threshold the limit is exactly 1080 m, so cells sitting within
 *      half a metre of the boundary land on the other side of it. Worth about
 *      260-290 residents per city.
 *
 *   2. Conflation. The pipeline distinguishes NaN ("this cell is not on the
 *      walk network") from inf ("on the network, but no destination of this
 *      kind within the search cap"). export.py's quantize() maps both to
 *      65535. A cell that is on the network but reaches nothing counts in the
 *      pipeline's denominator with zero categories; after the round trip
 *      through the binary it is indistinguishable from an off-network cell and
 *      is dropped. Worth 1,060 residents in Johor Bahru and 1 in Singapore,
 *      so it nudges JB's completeness up by 0.02 points.
 *
 * It also demonstrates the query shape the API uses: threshold FIRST, per
 * resolution-10 cell, then aggregate. The final section measures what
 * averaging metres into a parent hex and thresholding that instead would do,
 * because it is the single easiest mistake to make with this data.
 *
 *   npm run verify
 */
import Database from "better-sqlite3";
import { DB_PATH } from "./paths.ts";

const BASKET = ["groceries", "healthcare", "education", "green_space", "transit", "dining"] as const;
/** A cell is "low access" when fewer than half the basket is reachable. */
const LOW_ACCESS_BELOW = BASKET.length * 0.5;
/** Shares must agree to 0.1 percentage point — see the two causes above. */
const TOL_SHARE = 1e-3;
/** Populations are totals, so the same relative slack in absolute people. */
const TOL_POP = 2000;

const db = new Database(DB_PATH, { readonly: true });

/** `d_x IS NOT NULL AND d_x <= @limit` summed over the basket = categories reached. */
const reached = BASKET.map((c) => `(d_${c} IS NOT NULL AND d_${c} <= @limit)`).join(" + ");
/** Cells with no measurement at all are treated as off-network, as the React site does. */
const onNetwork = BASKET.map((c) => `d_${c} IS NOT NULL`).join(" OR ");

const cityShare = db.prepare<{ city: string; limit: number }, {
  share_complete: number; share_low: number; pop_on_network: number;
}>(`
  SELECT SUM(CASE WHEN (${reached}) = ${BASKET.length} THEN pop ELSE 0 END) / SUM(pop) AS share_complete,
         SUM(CASE WHEN (${reached}) < ${LOW_ACCESS_BELOW}  THEN pop ELSE 0 END) / SUM(pop) AS share_low,
         SUM(pop) AS pop_on_network
  FROM cells
  WHERE city_id = @city AND (${onNetwork})
`);

const metric = db.prepare<[string, string], { value: number }>(
  "SELECT value FROM city_metrics WHERE city_id = ? AND cohort = 'all' AND metric = ?",
);
const series = db.prepare<[string, string], { bucket: string; value: number }>(
  "SELECT bucket, value FROM city_series WHERE city_id = ? AND cohort = 'all' AND series = ?",
);
const setting = (key: string) =>
  JSON.parse(db.prepare<[string], { value_json: string }>(
    "SELECT value_json FROM meta WHERE key = ?",
  ).get(key)!.value_json);

const CITIES = ["sg", "jb"] as const;
const SPEEDS = setting("walk_speed_mps") as Record<string, number>;
const THRESHOLDS = setting("thresholds_min") as number[];
const HEADLINE = setting("headline_threshold_min") as number;

let failures = 0;
function check(label: string, mine: number, published: number, tol = TOL_SHARE): void {
  const delta = Math.abs(mine - published);
  const ok = delta <= tol;
  if (!ok) failures++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"} ${label.padEnd(30)} ${mine.toFixed(6).padStart(13)} vs ${published.toFixed(6).padStart(13)}   Δ ${delta.toExponential(1)}`,
  );
}

console.log(`headline ${HEADLINE} min at ${SPEEDS.base} m/s · tolerance ${TOL_SHARE} on shares\n`);

console.log("recomputed from cells vs the pipeline's published metrics");
for (const city of CITIES) {
  const mine = cityShare.get({ city, limit: HEADLINE * 60 * SPEEDS.base })!;
  check(`${city} share_complete`, mine.share_complete, metric.get(city, "share_complete")!.value);
  check(`${city} share_low_access`, mine.share_low, metric.get(city, "share_low_access")!.value);
  check(`${city} population_on_network`, mine.pop_on_network, metric.get(city, "population_on_network")!.value, TOL_POP);
}

console.log("\nevery walking-speed preset vs share_complete_by_speed");
for (const city of CITIES) {
  const pub = Object.fromEntries(series.all(city, "by_speed").map((r) => [r.bucket, r.value]));
  for (const [name, mps] of Object.entries(SPEEDS)) {
    check(`${city} ${name} (${mps} m/s)`, cityShare.get({ city, limit: HEADLINE * 60 * mps })!.share_complete, pub[name]);
  }
}

console.log("\nevery threshold preset vs share_complete_by_threshold");
for (const city of CITIES) {
  const pub = Object.fromEntries(series.all(city, "by_threshold").map((r) => [r.bucket, r.value]));
  for (const min of THRESHOLDS) {
    check(`${city} ${min} min`, cityShare.get({ city, limit: min * 60 * SPEEDS.base })!.share_complete, pub[String(min)]);
  }
}

// ---------------------------------------------------------------------------
// Where the residual difference comes from. Measurements, not assertions.
// ---------------------------------------------------------------------------
const allNull = db.prepare<[string], { pop: number; cells: number }>(
  `SELECT SUM(pop) AS pop, COUNT(*) AS cells FROM cells
   WHERE city_id = ? AND ${BASKET.map((c) => `d_${c} IS NULL`).join(" AND ")}`,
);

console.log("\nresidual 1 — off-network vs beyond-the-cap, conflated by the binary export");
for (const city of CITIES) {
  const mine = cityShare.get({ city, limit: HEADLINE * 60 * SPEEDS.base })!;
  const gap = metric.get(city, "population_on_network")!.value - mine.pop_on_network;
  const dropped = allNull.get(city)!;
  console.log(
    `  ${city}  dropped ${dropped.cells.toLocaleString()} all-NULL cells holding ${dropped.pop.toFixed(0).padStart(7)} residents; ` +
      `${gap.toFixed(0)} of them are in the pipeline's denominator`,
  );
}

console.log("\nresidual 2 — uint16 metre rounding at the threshold boundary");
for (const city of CITIES) {
  const mine = cityShare.get({ city, limit: HEADLINE * 60 * SPEEDS.base })!;
  const pub = metric.get(city, "share_complete")!.value;
  const pubDen = metric.get(city, "population_on_network")!.value;
  console.log(
    `  ${city}  numerator mine ${(mine.share_complete * mine.pop_on_network).toFixed(0).padStart(9)} vs published ` +
      `${(pub * pubDen).toFixed(0).padStart(9)}  (${((mine.share_complete * mine.pop_on_network) - pub * pubDen).toFixed(0)} residents)`,
  );
}

const wrongWay = db.prepare<{ city: string; limit: number }, { share: number }>(`
  WITH parent AS (
    SELECT h3_r8, SUM(pop) AS pop, ${BASKET.map((c) => `AVG(d_${c}) AS d_${c}`).join(", ")}
    FROM cells WHERE city_id = @city AND (${onNetwork}) GROUP BY h3_r8
  )
  SELECT SUM(CASE WHEN (${reached}) = ${BASKET.length} THEN pop ELSE 0 END) / SUM(pop) AS share FROM parent
`);

console.log("\nwhy the API thresholds before it aggregates (resolution 8)");
for (const city of CITIES) {
  const limit = HEADLINE * 60 * SPEEDS.base;
  const right = cityShare.get({ city, limit })!.share_complete;
  const wrong = wrongWay.get({ city, limit })!.share;
  const pts = (wrong - right) * 100;
  console.log(
    `  ${city}  threshold-then-aggregate ${right.toFixed(6)}   mean-of-metres ${wrong.toFixed(6)}   ` +
      `${pts > 0 ? "overstates" : "understates"} by ${Math.abs(pts).toFixed(1)} points`,
  );
}

db.close();
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
