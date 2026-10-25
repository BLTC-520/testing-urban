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

---

## Phase 8 — packaging it to deploy

### Files

| File | What it does |
|---|---|
| `Dockerfile` | Three stages: install, build + ingest + verify, runtime. |
| `.dockerignore` | Keeps the build context to what the Dockerfile copies. |
| `railway.json` | Builder, start command and health check path. |
| `server/tsconfig.build.json` | Emits JavaScript so the runtime needs no TypeScript loader. |
| `server/test/proxy.test.ts` | Pins the reverse-proxy behaviour. |

### Decisions

**The database is baked into the image, not kept on a volume.** This is the
decision the whole deployment rests on. `sgjb.db` is a rebuildable cache of
committed analysis outputs and nothing writes to it at runtime, so it is not
state — which means the ephemeral filesystem that normally makes SQLite awkward
on a PaaS is irrelevant here. An immutable copy per image has no backup story,
no migration story, and a rollback automatically gets matching data. Rejected: a
mounted volume, which would add all three of those problems in exchange for
persistence nothing needs.

**`npm run verify` runs as a build gate.** An image whose numbers disagree with
the published study fails to build rather than being deployed and discovered
later.

**Compiled to JavaScript rather than shipping `tsx`.** TypeScript 6's
`rewriteRelativeImportExtensions` turns the `.ts` import specifiers into `.js`
on emit, so `node dist/server.js` runs with no loader and no dev dependencies in
the runtime image. The alternative — moving `tsx` into `dependencies` — works
and is one line, but it puts a build tool in the production dependency tree to
save a compile step that takes two seconds.

**The API serves the dashboard.** One service, one origin, so CORS stops
applying to the deployment entirely and the allowlist only governs local
development. An unknown path under `/api/` stays a JSON 404; anything else is
handed the app shell.

**Three stages, not one.** The 36 MB of pipeline outputs the ingest reads are an
input, not a runtime dependency, so they stay in the build stage. The basemap
archive and glyphs are copied straight into the runtime stage because they are
served rather than consumed.

### What went wrong

**I wrote a `trustProxy` fix that did not work, then nearly shipped it.**

Behind a platform edge every request arrives from the proxy, so `req.ip` is the
proxy's address and the rate limiter buckets every visitor together — one user
spending 300 requests/minute would throttle the whole dashboard. Real problem,
worth fixing.

I set `trustProxy: 1`, on the strength of Fastify's own documentation
describing the number as a hop count, and wrote a confident comment explaining
why a hop count was safer than `true`. Then I tested it: still one shared
bucket. The first test used `app.inject()`, which has no socket for proxy-addr
to inspect, so I assumed the test was the problem and retried over real
listening sockets. Still one shared bucket.

Probing each form directly showed why: with `trustProxy: 1` the forwarded
address is never consulted at all — `req.ips` comes back as just
`["127.0.0.1"]`. Only `true` and address forms (`"loopback"`, `"127.0.0.1"`, a
CIDR) work. So the config was inert *and* the comment justifying it asserted
something false, which is worse than no comment.

The real answer is an address allowlist: `"loopback, uniquelocal"` believes the
header only when the immediate peer is on a private network — the platform edge
— and refuses it from a public client, which is the spoofing hole `true` leaves
open. `test/proxy.test.ts` now pins all three cases, including a regression
guard asserting that the numeric form does *not* work, so if a future Fastify
makes it work the test fails and the comment gets corrected.

Two things to carry forward. A plausible configuration value that is silently
ignored looks exactly like a working one, so security settings need a test that
demonstrates the behaviour rather than a comment asserting it. And when a test
disagrees with the documentation, the test is more likely to be right.

**Docker was not available in this environment,** so the Dockerfile itself is
unverified as a Docker build. Every command inside it was run directly in the
same layout — compile, dashboard build, ingest, verify, then `node dist/server.js`
with the container's environment variables — and the dashboard was driven in a
browser against that production server. The layering, the `COPY` paths and the
`HEALTHCHECK` are the parts no one has executed.

### Interview questions

**SQLite on a platform with an ephemeral filesystem — isn't that a problem?**
Only if the database is state. Here it is a derived cache of committed analysis
outputs that nothing writes to at runtime, so it is built into the image during
the Docker build. No volume, no backups, no migrations, and a rollback gets the
data that matches the code. If the app took writes the answer would be
different — a volume, or a hosted Postgres.

**What breaks first when you put this behind a load balancer?**
Per-IP rate limiting. Every request arrives from the proxy, so unless the app
is told which peers may be believed when they send `X-Forwarded-For`, all
traffic shares one bucket and a single user can throttle everyone. The fix is
an address allowlist rather than trusting the header unconditionally, because
trusting it from anyone lets a direct client fabricate their own bucket.
