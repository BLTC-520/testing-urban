# LEARNING.md

Notes I'm keeping while building the command centre dashboard, because I know React well and
Vue/ECharts not at all. Three things go in here: what every Vue file does and the React equivalent
of each pattern in it, every decision that wasn't obvious (with what I turned down), and interview
questions with answers.

Written as I go, phase by phase. No Vue files yet — Phase 2 is the data layer.

---

## Phase 2 — SQLite ingest

### Files

| File | What it does |
|---|---|
| `server/src/paths.ts` | Resolves the repo root, the read-only pipeline output directory, and the database path. One place so nothing hardcodes `../..`. |
| `server/src/binary.ts` | Reads the pipeline's columnar `SGJB` binary tables in Node. |
| `server/src/schema.sql` | The schema, with the reasoning in comments. |
| `server/src/ingest.ts` | Drops and rebuilds `server/data/sgjb.db` from `web/public/data`. |
| `server/src/verify.ts` | Recomputes the study's headline numbers out of SQLite and compares them against the pipeline's published values. |

### The schema

Nine tables. Dimensions first, then facts.

**`meta`** — key/value, values are JSON strings. Holds `h3_resolution`, `generated_utc`,
`osm_snapshot`, the three walking-speed presets, the four threshold presets, the low-access cutoff.
JSON values so a scalar, an array and an object can share one table instead of a column per
setting. The API reads its own limits from here, so the allowed values for `minutes` and `speed`
come from the pipeline rather than being retyped in the validation layer.

**`cities`** — 2 rows. Name, map centre, default zoom, census population and its definition. Drives
the city toggle and the initial camera.

**`essentials`** — 8 rows: the 6 basket categories plus `rapid_transit` and `civic`, which are
measured but deliberately excluded from the completeness score. Carries `label`, `short` (for KPI
tiles), the plain-English `question`, `in_basket`, a `sort_order` so the charts don't reorder
themselves, and the OSM tag definitions as JSON. This is a *dimension* table — the 6 categories and
what they mean — not a fact table of distances. See the decision below.

**`neighbourhoods`** — 65 rows: 55 Singapore subzones and 10 Johor Bahru state constituencies. The
primary key is `idx`, not `unit_id`, because `idx` is the integer the binary `unit` column points
at. Getting this backwards would have meant a string join on every hex. `weakest_category` is a
foreign key into `essentials` and makes a good ranked-table column.

**`cells`** — the main fact table, 91,357 rows. One row per H3 resolution-10 hexagon:
`pop`, `elderly`, `unit_idx`, and eight distance columns in metres. Plus `h3_r8` and `h3_r7`, the
precomputed parent hexagons.

**`scenarios`** — 6 rows (3 site counts × 2 cities). The before/after headline figures for the
"Parking to Proximity" what-if, taken from the pipeline's own summary so the dashboard's deltas
agree with the published study instead of being independently derived.

**`scenario_cells`** — 274,071 rows. The same hexagons under each scenario. Long by scenario, wide
by category, so the before/after switch is `WHERE scenario_id = ?` against an identical column set
and one query shape serves both sides of the comparison.

**`city_metrics`** — 180 rows, long `(city, cohort, metric, value)`. The pipeline's own aggregates
for three cohorts: everyone, over-65s, over-65s walking slowly.

**`city_series`** — 56 rows. The three pre-computed series the ECharts panels plot directly:
completeness by threshold, completeness by walking speed, and the 0–6 categories histogram. Has an
explicit `position` column so x-axis order survives the round trip through SQL, which does not
promise row order.

**`footpath_links`** / **`footpath_metrics`** — the one-footpath case study. Rank 0 is the chosen
link, 1–9 the runners-up.

### Decisions

**Server aggregates rather than serves.** The full reasoning is in the README, since it's a
decision I want an interviewer to see. Short version: 150× smaller payload, and completeness has to
be thresholded per small hexagon *before* it's averaged over population, so there should be exactly
one place that does it in the right order. Rejected: a thin server shipping resolution-10 typed
arrays with the browser doing everything, which mirrors the React site and keeps the sliders
instant but pushes 5.5–7.8 MB per client and re-implements `access.ts` in Vue.

**Distances in metres, not minutes.** Minutes depend on the walking speed the viewer picks, so
storing minutes would bake one speed into the database. `reachable ⟺ metres ≤ minutes × 60 × speed`
is one multiplication. The pipeline made the same choice; I'm not inventing it, I'm preserving it.

**`cells` is wide, not tall.** One row per hexagon with six distance columns, rather than
`(hexagon, essential, metres)`. Tall would be 548,000 rows and every query would have to pivot it
back, because counting completeness needs all six categories in the same row at the same time.
Tall is the right shape when you query one attribute at a time; this dashboard never does. That
also settled what `essentials` is: a dimension table of what the six categories *mean*.

**Parent hexagons precomputed at ingest, not at query time.** `h3_r8` and `h3_r7` are stored
columns. Computing them per request would mean pulling 54,095 rows into Node, calling
`cellToParent` on each, and grouping in JavaScript — which is the thing the whole decision was
meant to avoid. This is why it's the one schema choice that's expensive to undo: it touches the
table, the ingest and the query together.

**Long `(metric, value)` for city metrics, wide for cells.** Inconsistent on purpose. The metric
list is the pipeline's business and will grow, and the dashboard asks for the handful it displays by
name — so long. The cell columns are a fixed, closed set that is always read together — so wide.
Shape follows the access pattern, not a rule.

**`binary.ts` is copied from the web app, not imported.** `server/` must not depend on `web/`, so
either can be built or moved without the other. It's ~60 lines against a frozen format whose magic
number and version are both asserted, so it won't drift silently. Rejected: a shared workspace
package, which is the textbook answer and would have meant restructuring the existing site's build
for one file.

**The ingest is destructive and idempotent.** It deletes the database and rebuilds it. The database
is a cache of `web/public/data`, never a source of truth, so there is no migration story and
nothing to drift. Rebuild takes 6.5 seconds.

**Didn't ingest:** the variant tables (alternative POI definitions, a second population model), the
cross-border table, the street graph tiles, and the 200 KB of pre-projected geometry inside
`footpath.json`. About 7 MB of genuinely interesting data with no dashboard payoff, and it would
have doubled the schema. The graph tiles exist so the React site can run Dijkstra in the browser;
a dashboard doesn't need that.

**Wrote `verify.ts` instead of trusting the ingest.** 20 checks: every threshold and every walking
speed, both cities, recomputed from `cells` and compared against the pipeline's published values.
It caught two real discrepancies I would otherwise have shipped (below), and it's the script I'd
open if someone asked whether the dashboard's numbers can be trusted.

### Two things in the data that nearly bit me

`verify.ts` failed on its first run — all 19 comparisons, every one in the same direction. One-sided
error means a cause, not noise.

**The export conflates two different kinds of nothing.** The pipeline carries `NaN` for "this cell
isn't on the walk network" and `inf` for "on the network, but nothing of this kind within the
60-minute search cap". `export.py`'s `quantize()` maps both to 65535, so after the round trip
they're indistinguishable. The pipeline counts the second kind in its denominator with zero
categories reached; a binary consumer drops it. That's 1,060 Johor Bahru residents and about 1 in
Singapore, and it nudges JB's completeness up by 0.02 points.

**Rounding at the boundary.** Distances are stored as whole metres via `np.rint`. At 15 minutes and
1.2 m/s the limit is exactly 1080 m, so a true distance of 1080.4 m stores as 1080 and passes a test
it should fail. About 260–290 residents per city.

Neither is recoverable from the committed files, both are under 0.1 percentage point, and the React
site has carried both since it was built. So I matched the React site's behaviour rather than
inventing a third answer, set the tolerance to 0.1 points, and made `verify.ts` print both gaps as
measurements instead of hiding them inside a pass.

**Zero-population parent hexagons.** Found while benchmarking: a parent hexagon covering only
parkland or industrial land has `SUM(pop) = 0`, so a population-weighted share divides by zero and
SQLite returns `NULL` — holes in the map exactly where a command centre looks worst. The React site
solves it by giving every cell a tiny `1e-3` weight on top of its population, so unpopulated land
still contributes a colour. I'll use the same epsilon in `/api/cells` in Phase 3.

### Interview questions

**Why keep distances in metres when the dashboard shows minutes?**
Minutes depend on the walking speed the viewer picks. Storing minutes bakes one speed into the
database and makes the speed control a re-ingest instead of a multiplication. Metres are what the
network measurement actually produced; minutes are a presentation choice.

**You're averaging accessibility into bigger hexagons for the map. What breaks?**
Nothing, as long as you threshold before you aggregate. Completeness isn't linear, so the mean of
the distances is not the distance of the mean: a district split between 200 m and 3 km from a clinic
averages to 1.6 km and passes a 15-minute test that half its residents fail. On this data that
overstates Singapore by 4.6 points. So the per-cell test happens at resolution 10 and only the
population-weighted result rolls up.

**Why a server at all, when the data is static files?**
Strictly, it isn't required — the existing React site reads the same files with no backend and that
was correct for it. The server earns its place on payload and on correctness: 91,357 hexagons is
5.5–7.8 MB raw versus 35–51 KB rolled up, and the threshold-before-aggregate rule should live in one
place rather than in every client. If the answer had only been "it's a job requirement" I'd have
said so.

**A null and a zero in the same column — how do you tell them apart and why does it matter?**
`65535` in the binary means "nothing within reach"; read as a number it claims zero metres. It
becomes SQL `NULL`, which makes `AVG` and `COUNT` correct for free and forces every comparison to
be explicit about it. The failure mode is the nasty kind: it doesn't crash, it makes the worst-served
neighbourhoods look perfectly served, which is precisely the finding the project exists to report.

**Your numbers don't exactly match the pipeline's. Is that a bug?**
It's two known quantisation effects in the binary export — whole-metre rounding at the threshold
boundary, and `NaN` versus `inf` both encoding as 65535 — worth under 0.1 percentage point and
inherited by the existing site too. `npm run verify` asserts that bound across every threshold and
speed and prints both gaps. I'd rather state a measured tolerance than claim an exactness the file
format can't support.
