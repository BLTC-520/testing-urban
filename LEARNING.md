# LEARNING.md

Notes I'm keeping while building the command centre dashboard, because I know React well and
Vue/ECharts not at all. Three things go in here: what every Vue file does and the React equivalent
of each pattern in it, every decision that wasn't obvious (with what I turned down), and interview
questions with answers.

Written as I go, phase by phase.

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

---

## Phase 3 — the API

### Files

| File | What it does |
|---|---|
| `server/src/db.ts` | Opens SQLite **read-only** and loads the settings the API validates against. |
| `server/src/schemas.ts` | One zod schema per route. |
| `server/src/queries.ts` | Every SQL statement, with the threshold-before-aggregate rule in one place. |
| `server/src/app.ts` | Fastify app: plugins, routes, error handling. Exported as a builder so tests can drive it without a port. |
| `server/src/server.ts` | Binds a port, handles shutdown. Nothing else. |
| `server/test/validation.test.ts` | 40 tests, all about input the API should refuse. |
| `server/test/api.test.ts` | 27 tests on behaviour, including the invariant the schema exists for. |

### Endpoints

`/api/summary` (boot data: cities, essentials, presets, the pipeline's published metrics and
series) · `/api/cells` (the map surface) · `/api/panels` (histogram, per-essential shares, district
ranking) · `/api/scenarios` · `/api/footpath` · `/api/neighbourhoods` · `/api/cell/:h3` (the
inspector) · `/api/health`.

### Decisions

**Fastify over Express.** First-party `@fastify/helmet`, `cors`, `rate-limit` and `static`, and
`app.inject()` drives the whole app in tests without binding a port — which is why the test files
need no supertest and no port juggling. Express would have been equally defensible; this was the
smaller dependency list.

**`speed` is an enum, not a number.** `?speed=base|slow|brisk`, not `?speed=1.2`. Three validated
values mean the response space is tiny and caches perfectly, and nobody can request a 40 m/s walk.
The study only validated those three speeds, so offering a continuous control would imply a
precision the analysis does not have. Rejected: accepting any number in [0.5, 2.0], which is
friendlier but multiplies the cache space by a hundred for no analytical gain.

**The validator reads its allowed values from the database.** `schemas.ts` builds its enums from
the `meta` table, which the ingest filled from the pipeline's config. Adding a speed preset upstream
does not mean editing a hardcoded list in the API. The API cannot drift from the study it serves.

**`.strict()` on every query schema.** `?minute=15` is a 400, not a silent fall back to the default.
On a wall display a typo'd parameter that quietly shows the wrong number is worse than an error.

**SQL varies by shape, never by value.** Some queries genuinely differ — which table, which column
to `GROUP BY`. That variation comes from closed maps in `queries.ts` (`PARENT = {7,8,10}`, two
sources) selected by a value zod already validated against the same set. No request string is ever
concatenated into SQL; every value is bound. The injection tests assert that the refusal happens at
*validation*, not at escaping.

**`readonly: true` on the connection.** The API process physically cannot write to the database, so
no route — however badly written later — can mutate the analysis. The ingest is the only writer.

**Statements prepared once at startup.** All twelve are built when the app is constructed, not per
request. That is most of why a 54,000-row aggregation answers in ~35 ms.

**`res=10` is gated.** It returns the raw grid, which is the thing the aggregation exists to avoid,
so it 400s unless `unit` scopes it to one neighbourhood. The capability is there for drill-down; it
just can't be requested for a whole city by accident.

**Errors carry a code and a field, never a stack.** A 400 says which parameter was wrong; a 500 logs
the detail and returns `{error: "INTERNAL"}`. One test greps every error body for stack frames, SQL
fragments and filesystem paths.

**The basemap is served by the API.** `web/public/tiles/basemap.pmtiles` is 47 MB. Copying it into
`dashboard/public` would put it in the repository twice, so `@fastify/static` serves it (and the
glyph PBFs) from where it already lives, with range requests enabled because that is how pmtiles
reads an archive.

### What went wrong

**The rate limiter silently did nothing.** `buildApp` registered the plugins without awaiting them
and then declared routes synchronously; the test asking for a 4th request to be refused got a 200
and no `x-ratelimit-*` headers at all. Making `buildApp` async and awaiting each `register` fixed
it. Worth knowing: a Fastify plugin that is registered but not awaited before routes are added can
fail to attach its global hook, and nothing warns you — only a test that asserts the 429 catches it.

### Interview questions

**How do you stop SQL injection here?**
The values never reach SQL as text. Every parameter is parsed by zod first — `city` and `speed` are
enums built from the database's own rows, `minutes` is a bounded integer — and everything that does
reach a statement is a bound parameter. Where the *shape* varies, it is selected from a closed map
in the query module by an already-validated key. So the injection tests assert a 400 from
validation, not that escaping worked.

**Why is the walking speed an enum rather than a number?**
Three validated presets keep the response space small enough to cache perfectly and match what the
study actually tested. A continuous speed control would imply the analysis is calibrated at any
speed, which it is not.

---

## Phase 4–6 — the dashboard

### Vue files, and the React equivalent of each pattern

| File | What it does | React equivalent |
|---|---|---|
| `src/main.ts` | Mounts the app with Pinia. | `createRoot().render(<Provider><App/></Provider>)` |
| `src/App.vue` | The 1920×1080 grid, and the two watchers that refetch. | A layout component plus two `useEffect`s |
| `src/components/Stage.vue` | Scales the fixed stage to the viewport. | Same markup, hook's scale in a style object |
| `src/components/TopBar.vue` | City, walk budget, walking speed. | Component reading a Zustand store |
| `src/components/KpiTile.vue` | One hero number with an optional delta. | Props via `defineProps<T>()` instead of a parameter; `<slot/>` is `children` |
| `src/components/KpiColumn.vue` | The six tiles, with scenario deltas. | A component composing six children |
| `src/components/CompletenessGauge.vue` | A 10-segment meter. | Identical; no framework-specific concern |
| `src/components/ChartPanel.vue` | Title + a correctly-sized box for a canvas. | A layout component with `children` |
| `src/components/ThresholdCurve.vue` | Completeness vs walk budget, both cities. | `echarts-for-react` with the same option object |
| `src/components/EssentialBars.vue` | Share reaching each essential. | Same |
| `src/components/DistributionChart.vue` | The 0–6 histogram. | Same |
| `src/components/DistrictTable.vue` | 55 districts ranked, click to scope. | Same |
| `src/components/HexMap.vue` | deck.gl + MapLibre. | `useRef` + `useEffect([])` + a second effect on the data |
| `src/components/Inspector.vue` | One clicked cell in detail. | Same, with `watch` ≈ `useEffect` |
| `src/components/ScenarioBar.vue` | The scenario switches. | Same |
| `src/stores/filters.ts` | What the screen is showing. | A Zustand store |
| `src/stores/data.ts` | Everything fetched, and when to refetch. | TanStack Query, by hand |
| `src/api/client.ts` | Typed fetch with abort + cache. | Same; this is framework-agnostic |
| `src/charts/echarts.ts` | Tree-shaken registration and the shared theme. | Identical — it belongs to ECharts, not the binding |
| `src/composables/useStageScale.ts` | ResizeObserver → a scale factor. | A custom hook |
| `src/map/basemapStyle.ts` | The MapLibre style. | Identical |
| `src/map/colors.ts` | Ramps read from CSS tokens. | Identical |

### The patterns, concretely

**`<script setup>` ≈ a function component body, run once.** This is the single biggest difference.
A React component body re-runs on every render, which is why you need `useMemo`, `useCallback` and
dependency arrays. A `<script setup>` block runs **once**, at setup; reactivity afterwards comes
from `ref`/`computed` tracking what reads them. So there is nothing to memoise for identity, and
`computed` is a cache keyed on "did anything I read change", not on a list you maintain by hand.

**`computed` ≈ `useMemo`, without the dependency array.** `computed(() => rows.value.filter(…))`
re-evaluates when `rows` changes because Vue recorded that the getter read `rows`. Nothing can be
omitted from a dependency list by accident — the whole class of stale-closure bugs does not exist.

**`watch(getter, cb)` ≈ `useEffect(cb, [deps])`.** The difference is the same one: the dependencies
are whatever the getter touched. `App.vue` watches `f.cellsQuery` — a getter that assembles an
object out of four store fields — instead of listing four variables.

**Pinia ≈ Zustand with named actions.** `state`/`getters`/`actions` map onto Zustand's initial
state, selectors and setters. The real difference: Pinia's state is a reactive proxy, so an action
writes `this.city = city` in place rather than calling `set({city})` with a new object. There is no
selector function and no shallow-equality check because the tracking is per-property already.

**`ref` vs `shallowRef` for a library instance — the one real trap.** `ref(map)` wraps the MapLibre
instance in a deep reactive Proxy. That is expensive on a large object graph and it breaks identity
checks the library makes internally (`this.x === x` fails through a proxy). `shallowRef` keeps the
reference reactive and leaves the object alone. React refs never deep-proxy, so this has no
equivalent — it is the thing to know when wrapping any imperative library in Vue.

**Scoped styles ≈ CSS modules.** `<style scoped>` adds a data attribute to the component's elements.
`:deep(...)` is the escape hatch for styling a child component's internals.

### Decisions

**A fixed 1920×1080 stage with `transform: scale()`, not a fluid layout.** This targets one wall
display at a known size. Everything is laid out once at that size and scaled as a unit, so the
design on screen is exactly the design. `scale()` is composited, so a resize costs no reflow and no
chart re-render. Rejected: fluid grid with `clamp()` type, which is right for a website and wrong
for a display whose dimensions are a fact. Measured: `scale(0.666)` at 1280×800, `scale(2)` at 4K,
16:9 preserved at both.

**Two separate watchers, not one.** `res` only affects the map; a district selection only affects
the panels. One combined watcher would refetch both for either change.

**ECharts registered à la carte.** Importing `echarts` whole adds about a megabyte for four panels.
`use([BarChart, LineChart, …])` ships what is used.

**The charts read CSS tokens rather than hold hex values.** `token("--ramp-4")` means the map, the
charts, the KPI rails and the legend cannot drift apart, and the palette lives in one file that was
validated as a unit.

**The reference curve does not move with the slider.** `ThresholdCurve` plots the pipeline's
published `by_threshold` series and marks the current budget with a dashed line. It is a fixed frame
of reference; redrawing it from the live query every time the slider moves would destroy that.

**Deltas come from the pipeline, not from subtraction where it matters.** The scenario switches show
the published before/after. The live "at *n* min" figure is computed, labelled as such, and
highlighted when it is not the published 15-minute case — so a viewer can see which number is the
study's and which is the dashboard's.

**Height and colour encode different measures.** Colour is accessibility, height is population
(cube-rooted — linear makes one dense estate a spike that hides its neighbours). Encoding the same
measure twice would just be a thicker bar.

**Hexagon click costs one request.** A parent hexagon spans ~49 resolution-10 cells and the district
is a property of those, so the click resolves the parent's centre to a res-10 cell and asks
`/api/cell/:h3`. Rejected: shipping `unit_idx` with every hexagon, which would have meant a
majority-vote per parent on the server and a bigger payload for something only used on click.

**Charts follow the dataviz rules deliberately.** One axis everywhere (no dual-axis). Sequential
ramp for magnitude, diverging ramp with a *neutral* midpoint for the scenario delta, categorical
hues only for identity. Direct labels on the last point of each line instead of a number on every
point. Districts are a table with inline bars rather than a 55-category bar chart — and that table
doubles as the "a table view exists" requirement for the charts beside it.

### What went wrong

**`new URL()` ate the glyph tokens.** The style's `glyphs` URL carries `{fontstack}` and `{range}`
for MapLibre to substitute. `new URL()` percent-encodes the braces, and MapLibre then rejects the
whole style — so the map rendered as an empty black box with everything else working. The React
site's `basemapStyle.ts` has a comment warning about exactly this, which I had read. Fixed by
concatenating.

**Then the tiles 404'd into the app shell.** With the glyphs fixed, pmtiles reported "Wrong magic
number for PMTiles archive": the dev server proxied `/api` but not `/basemap`, so range requests
were answered by Vite with `index.html`. A content-type check would have said this immediately.

**The cache defeated the abort logic.** Switching city with a scenario active showed a delta of
−39.5 points — Johor Bahru's scenario against Singapore's baseline. Aborting superseded requests is
not enough, because a *cached* response resolves immediately without going through the abort path,
so a slow sequence can finish after a fast one and overwrite it. Fixed by having every response echo
the query it answered and dropping anything that no longer matches the live filters. This is exactly
the invariant a query library enforces with its query key, and I had to rediscover it by hand
because I chose to write the caching myself.

**`vue-tsc --noEmit` passes things `vue-tsc -b` rejects.** Build mode uses the project references and
caught two genuine type errors plus a missing compiler option. Worth running the real build, not
just the typecheck.

### Interview questions

**You know React. What actually changed, moving to Vue?**
Less than I expected, and the difference is concentrated in one place: a `<script setup>` block runs
once rather than on every render, so reactivity is tracked per-property instead of declared in
dependency arrays. That removes `useMemo`, `useCallback` and the stale-closure class of bug, and it
means a `watch` on a getter can depend on whatever the getter happens to read. The one Vue-specific
trap I hit was `ref` vs `shallowRef` when storing a MapLibre instance — a deep reactive proxy breaks
identity checks inside the library.

**How do deck.gl and MapLibre share a canvas, and why not two?**
MapLibre owns the canvas and the camera; deck.gl draws into the same WebGL context through
`MapboxOverlay` with `interleaved: true`. Two separately-camera'd canvases drift against each other
during inertial pans, which on a wall display reads as a bug.

**Why is the layout a fixed 1920×1080 that you scale, rather than responsive?**
It targets one known display. Laying out once at the target size and scaling as a unit means what is
on screen is exactly what was designed, and `transform: scale()` is composited so a resize costs no
reflow and no chart re-layout. A fluid layout is the right answer for a website and the wrong one
for a wall.

**What stops a slow response from overwriting a fresh one?**
Every response echoes the query it answered, and the store drops any response whose query no longer
matches the live filters. Aborting superseded requests is not sufficient on its own, because a cached
response resolves without ever touching the abort path — which is how I found the bug.

**How do you know the dashboard's numbers are the study's numbers?**
Three ways. `npm run verify` recomputes the published shares out of SQLite for every threshold and
speed. The API tests assert the headline findings — 80.4% versus 12.0%, healthcare scarcest in both
cities — so a regression fails a test rather than quietly changing a number on a wall. And the
scenario deltas are the pipeline's own published figures, not ones the dashboard derived.

## Phase 8 — 3D landmarks on the map

The map had the data and none of the place. Twelve landmarks now stand on it, modelled in Blender
from a script, and putting them there forced three changes to the map that were overdue anyway.

### Files

| File | What it does |
|---|---|
| `scripts/landmarks/landmarks.json` | the twelve landmarks: anchor, dimensions, provenance, confidence |
| `scripts/landmarks/analyse_refs.py` | k-means over reference photographs → night palettes and silhouette profiles |
| `scripts/landmarks/textures.py` | facade textures generated from those measured colours |
| `scripts/landmarks/footprints.py` | reads each landmark's OSM footprint out of `basemap.pmtiles`: centroid, area, long axis |
| `scripts/landmarks/build_models.py` | Blender, headless: builds every model and exports one `.glb` each |
| `dashboard/src/map/landmarks.ts` | placement, scale policy, zoom fade, one `ScenegraphLayer` per model |
| `dashboard/src/map/lighting.ts` | the night lighting rig, shared by the hexagons and the landmarks |
| `dashboard/landmarks.html` + `src/landmarksCheck.ts` | the check page: one landmark at a time on the real basemap |
| `dashboard/scripts/shot_landmarks.mjs` | drives that page headless and leaves twelve screenshots |
| `tests/test_landmarks.py` | the footprint maths, the clustering, and the manifest |

Fourteen landmarks: six in Singapore, four in Johor Bahru, and the Causeway with a checkpoint at
each end — the crossing being the one piece of infrastructure this whole study's cross-border
numbers depend on.

### Decisions

**Procedural, not sculpted.** Nobody can review a `.blend`. A script that says "three 194 m slabs,
340 m deck, 67 m overhang" is a diff, and when a published figure turns out to be wrong the model
changes by editing a number. The cost is that the models are stylised — a hand-modelled Merlion
would be better — and the benefit is that every line of every model is traceable to a source.

**Position and bearing come from data the repository already has.** The basemap archive carries an
OSM `buildings` layer that nothing was drawing. `footprints.py` pulls the footprint under each
landmark's anchor and takes its centroid and principal axis. Two guards stop that being worse than
typing the numbers in: a footprint that does not *contain* the anchor has to be within 120 m to
count, and a footprint only sets the yaw if it is both anchor-containing and at least 1.5× longer
than it is wide — the principal axis of a near-circular building is whichever way its vertices
happened to fall. The Flyer's terminal and the Esplanade's base are both rejected by that rule and
fall back to a bearing recorded in prose in `landmarks.json`.

**Colours are measured, not chosen.** The emissive colour of the Sands' windows is the mean of the
brightest 2% of pixels in a night photograph of it. Writing that down is more useful than a hex code
because it says what the number *is*.

**Everything is at true scale except what says it isn't.** `MIN_DRAWN_M = 55` lifts the 8.6 m
Merlion to 6.4× so it does not vanish, and the hover card prints "drawn 6.4×". Exaggerating a map
symbol is normal; hiding that you did is not.

### What went wrong

**The orientation was wrong on every landmark, invisibly.** deck.gl composes `getOrientation` as
Rz(yaw)·Ry(pitch)·Rx(roll). The roll of 90 that every `ScenegraphLayer` needs — glTF is Y-up,
deck.gl is Z-up — leaves the model's own +X axis pointing at deck's +X, which is *east*. So the yaw
that lands a model on a compass bearing is `90 - bearing`, not `-bearing`. With `-bearing` every
landmark was rotated by the same wrong amount and every one of them still looked like a building
standing in the right place. Pointing the check page's camera due north and looking at which way
the Merlion's water jet went found it immediately; no amount of staring at the pitched view would
have.

**The hexagons were a wall.** Height encodes population as `cbrt(pop) * 140`, which is right at the
overview and absurd close in: a hexagon with 7,000 residents is 2.7 km tall. At the zoom where a
200 m tower finally resolves, the data was standing in front of the city. The fix is that the
columns collapse to a thirtieth of their height over the same zoom level in which the landmarks
fade in, squared rather than linear because a column at half height is still 1.3 km of wall. The
fill thins at the same time so the street network shows through. Nothing is lost — colour carries
completeness at every zoom.

**The models looked like daylight dropped on a night map.** First pass had emission strengths
around 1–3 on large flat surfaces, which in glTF multiplies into `emissiveFactor` and turns a
dark SkyPark into a tan plate. Halving them and letting the window textures carry the light fixed
it. The reference photographs are the arbiter: a night photograph of a tower is mostly dark.

**The first Merlion was modelled from memory and it showed.** Three things were wrong and all
three are visible in any close photograph of the statue: the body is near vertical (a fish
standing on its tail, not lying down with a head on the front), the mane is a collar of flat
plates sweeping down and out from the neck rather than a crown of spikes, and the body is
*scaled*. The fix for the first two was eight lines; the third needed a new primitive, because
everything in the file until then was built by lofting plan sections upwards, which is right for
buildings and gives vertical fins for anything that sticks out sideways. `plate()` builds an
oriented box from a point and a direction, and the mane, the fins, the fluke and the ears are all
one call to it. The scales are a generated texture, not geometry.

**A kilometre of causeway rendered as an empty frame.** Blender's default camera far clip is
100 m. Every landmark up to that point was a building a few hundred metres across and framed from
inside the clip range by luck; the Causeway is 1,056 m long and framed from 1,300 m away, so the
preview came back blank rather than wrong. Worth remembering that an empty render is a camera
problem far more often than a geometry one — the glTF had all 992 triangles in it.

**Picking a colour by its index in a cluster list is a latent bug.** The facade and scale textures
originally read `palette[1]` and `palette[3]` out of the analysis. Raising the cluster count from
six to ten — needed because the Supertrees' magenta uplighting is a thirtieth of its photograph and
does not separate out below about eight clusters — reshuffled the ordering, and the Merlion's skin
went from white to slate grey without a single line of the texture code changing. Colours are now
chosen by rule: the darkest well-represented cluster for an unlit wall, the lightest for a floodlit
statue, the one whose hue falls between 270 and 340 degrees for the Supertrees. A rule survives a
change to k; an index does not. Picking the *most saturated* cluster outright does not work either
— in a blue-hour photograph that is the sky, and the sky is half the frame.

**The scale rule read the wrong dimension.** "Nothing is drawn shorter than 80 m" is a sensible
policy for buildings and nonsense for a causeway: 17 m tall, 1,056 m long, and duly enlarged 3.2×
into a 3.4 km embankment across a 1 km strait. The models now report their own largest dimension,
measured from the Blender scene rather than declared in the JSON, and the policy reads that. It
catches exactly one landmark, which a test now asserts — if a change starts enlarging half the map,
the map has stopped being to scale and nobody has said so.

**Blender's `bpy` module needs an exact CPython.** `pip install bpy` only resolves against the
interpreter version a given Blender embeds — 5.2 is built for 3.13. It is a separate optional
extra for that reason, and because it is a few hundred megabytes that no part of the analysis needs.

### Interview questions

**Why Blender rather than downloading models?**
Licensing and reviewability. A model from an asset library comes with terms this repository cannot
satisfy and a mesh nobody can diff. Generating from published dimensions means the provenance of
every model is a row in a JSON file with a confidence field, and the whole set rebuilds in 20
seconds.

**How do you know a landmark is in the right place and pointing the right way?**
Position and bearing come from the OSM footprint in our own basemap, and the manifest records which
of the two sources each one used. The cross-check is that the Sands' footprint measures 339 m long
against a published SkyPark of 340 m. Orientation is checked visually, because it has to be: the
check page puts one landmark at a time on the real basemap and the screenshot script leaves twelve
images to look at.

**What did adding decoration cost the data?**
Nothing, and it improved it. The landmarks made it obvious that the population columns were
unreadable at close zoom, which was already true and nobody had noticed because nobody zoomed in.
The columns now flatten and the fill thins as the camera comes down, so the map reads as a
choropleth over a real city instead of a forest of kilometre-high prisms.

**Why one layer per model rather than one instanced layer?**
A `ScenegraphLayer` holds one scenegraph. Twelve landmarks are twelve different buildings, so
sharing a geometry is not available; the alternative is twelve layers of one instance each, which
is about 10,500 triangles in total and costs no measurable frame time. Instancing is the right
answer when you have a thousand copies of one tree, not twelve copies of nothing.
