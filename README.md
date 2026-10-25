# Singapore / Johor Bahru 15-Minute City Explorer

**How far is daily life from home — and what could change it?** An open, reproducible
street-network study of walkable access to everyday essentials for 5.8 million people in
Singapore and Johor Bahru, with scenario models for the RTS Link, shared autonomous feeders and
the conversion of car-park land into neighbourhood hubs.

![Fifteen minutes from home — Singapore and Johor Bahru as hexagon columns: height shows residents, colour shows how many of six essentials are within a 15-minute walk](docs/img/story-hero.jpg)

**Three views of one dataset:** a scrollytelling **Story**, an interactive **Explorer** (change any
assumption, click anywhere to walk the network) and a **Methods** page generated from the data.
**Live:** <https://sgjburbansideprojects.brianhar.site/> · run it locally with `make dev` (see below). `.github/workflows/pages.yml` publishes
`main` with GitHub Pages to that custom domain (a Cloudflare CNAME to `bltc-520.github.io`).

## What it found

| | Singapore | Johor Bahru |
|---|---:|---:|
| Census 2020 count (Singapore residents; Johor Bahru all persons) | 4,044,340 | 1,753,284 |
| **All six essentials within a 15-minute walk** | **80.4 %** | **12.0 %** |
| Fewer than three essentials | 2.0 % | 37.9 % (657,200 people) |
| All six at a slower 0.9 m/s | 59.9 % | 5.1 % |
| Essential most often missing | healthcare | healthcare |
| Street junctions per km² · footpath share | 287 · 47 % | 98 · 11 % |

*Essentials: a grocery or provision shop; a clinic, hospital or pharmacy; a school or childcare centre;
a park of at least 0.5 ha; a bus stop or station; an eatery. Walking on the mapped street network at 1.2 m/s.*

**Population basis.** Singapore's census counts residents; Johor Bahru's counts all persons. Shares cover
residents whose homes are within 250 m of a walkable street (99.9 % of Singapore's census count, 98.9 % of
Johor Bahru's). Singapore's 1.64 million non-residents are not counted. Even if none of them had all six
essentials, Singapore's all-persons share would be at least 57.1 %, still far above Johor Bahru's 12.0 %,
so the direction of the finding cannot flip.

* **Robust.** Singapore leads in all 72 combinations of walking speed, time budget, definitions,
  network rules and population model; the gap exceeds 20 points in 70 of them.
* **Mostly not a mapping artefact.** Re-run with Overture Places instead of OpenStreetMap for food
  shops, clinics, schools and eateries: 89.5 % vs 23.0 %, so the gap narrows by about two points.
  OSM under-maps Johor Bahru's clinics, hospitals and pharmacies by about two-thirds relative to
  Overture, and the story says so.
* **Different gaps.** Singapore's residents are typically one essential short (usually healthcare);
  Johor Bahru's are spread from none to all six.
* **The border is not a street.** With the RTS Link the median door-to-platform trip from a Johor
  Bahru home to a Singapore MRT platform falls from 132 to 124 minutes (central assumptions); with a
  shared autonomous feeder to the station, to 85 — the first kilometres are the slow part.
* **Parking to Proximity.** Turning 25 well-chosen car parks per city into neighbourhood hubs would
  give 393,500 more Singapore residents and 152,800 more Johor Bahru residents all six essentials within
  15 minutes (a scenario, with its caveats).
* **One footpath.** A search of every dead end in Johor Bahru for streets that are close in a
  straight line but far on foot finds a 75 m gap in Bukit Indah (Perling): Jalan Bestari 10/1 and
  Jalan Penglin are 1,402 m apart on foot today. A public path there would give about 2,200
  residents all six essentials within 15 minutes; most were one essential short, usually healthcare. A desk study:
  ownership, walls and drains must be checked on site.

| Walk-shed vs. the 15-minute circle | RTS Link + autonomous feeder | Parking to Proximity |
|---|---|---|
| ![A walk-shed from Taman Johor Jaya on the street network inside its 1.08 km circle](docs/img/walk-jb.jpg) | ![Minutes from Johor Bahru homes to the first Singapore MRT platform with the RTS Link and an autonomous feeder](docs/img/border-av.jpg) | ![Cells newly reaching all six essentials when 25 car parks become neighbourhood hubs in Singapore](docs/img/parking-sg.jpg) |

## Readable by people, search engines and AI agents

Every page is prerendered to static HTML at build time, so the text, tables and formulas are there
without JavaScript; the maps load on top. For agents the site also publishes
[`/llms.txt`](https://sgjburbansideprojects.brianhar.site/llms.txt) (a guide with the key numbers),
Markdown copies of each page, a [data catalogue](https://sgjburbansideprojects.brianhar.site/data/index.json),
and five in-page tools — `get_city_summary`, `find_neighbourhoods`, `walk_from`,
`get_footpath_scenario`, `open_explorer` — exposed through WebMCP where the browser supports it and
as `window.sgjb`. Without WebGL the pages keep working: the Story shows a still of each scene and
the Explorer a table of neighbourhoods. Every Explorer view has
its own URL, e.g. [healthcare within 10 minutes for slower walkers](https://sgjburbansideprojects.brianhar.site/explore/?metric=healthcare&minutes=10&speed=slow).

## Command centre dashboard

A 1920×1080 large-screen dashboard on the same data, built in the stack a 3D digital-twin team
actually runs: Vue 3, ECharts, deck.gl and MapLibre on the front, Node and SQLite behind it. It
lives in [`dashboard/`](dashboard/) and [`server/`](server/). The React site is untouched — same
build, same tests, same deploy.

**Run it:** `npm run setup` once, then `npm run dev` — API on :8787, dashboard on :5174.

The screen is one fixed 1920×1080 stage scaled to whatever display it lands on, so it keeps 16:9
from a laptop to a 4K wall. Top bar switches city, walk budget and walking speed; a left column of
KPI tiles; a 3D H3 hex map in the middle with colour for access and height for population; four
ECharts panels down the right; scenario switches along the bottom. Clicking a hexagon or a district
row scopes every panel to that place. Every number on screen comes from the same API query as the
map, so nothing on the wall can disagree with anything else on the wall.

### Decision: the server aggregates, it does not just serve

The analysis outputs are static files. The React site reads them straight out of `/data` with no
backend at all, and for that site it was the right call. So before writing any of this I had to
answer whether a server earns its place here, or whether I was adding one because the job ad
mentions Node.

It earns it, for two reasons.

**Payload.** There are 91,357 hexagons across the two cities. Served raw at resolution 10 that is
5.5 MB of JSON for Singapore and 7.8 MB for Johor Bahru. Rolled up to H3 resolution 8 in SQL it is
746 and 1,117 hexagons — about 100 KB and 130 KB over HTTP. That is roughly 60× less data on the
wire for a surface that reads identically on a wall-mounted screen, and it is work a database is
better at than a browser.

**Order of operations, which matters more.** Completeness is "all six essentials within 15 minutes".
You have to test that for each small hexagon and *then* average over population. Do it the other
way round — average the distances into a big hexagon, then test the average — and the answer is
wrong, not approximate. A district where half the residents are 200 m from a clinic and half are
3 km away averages to 1.6 km, which passes; the truth is that half those people cannot walk it. On
this data that mistake overstates Singapore's completeness by 4.6 points and understates Johor
Bahru's by 0.5. Putting the aggregation in SQL means there is one place where the order is fixed and
correct, instead of every client getting it right by hoping.

So: each cell's resolution-8 and resolution-7 parent hexagons are precomputed at ingest, and
`/api/cells` is one `GROUP BY` that thresholds first and aggregates second — 23–36 ms per query,
about 130 ms end to end including JSON serialisation. It is the one choice in the schema that would
be expensive to undo, which is why I made it before writing the rest.

The cost I accepted: moving the minutes slider is now an HTTP request rather than a local
recompute. That is fine. The response is a pure function of city, minutes and speed — three values
from a small fixed set — so it debounces and caches cleanly, and the SQL takes one bound integer,
which leaves no injection surface.

### Two things in the data that are easy to get wrong

I had Claude Code check the ingest against the pipeline's own published numbers rather than trust
it (`cd server && npm run verify` — 20 checks, every threshold and walking speed). They agree to
within 0.1 percentage point, not exactly, and the two reasons are worth stating because any
consumer of these files inherits them, the React site included.

**`65535` is not zero.** The binary tables store walking distance as a 16-bit integer with 65535
meaning "nothing of this kind within reach". Read as a number it says a shop is on the doorstep, in
exactly the under-served places this whole study is about. It has to become SQL `NULL`.

**The export conflates two different kinds of nothing.** The pipeline distinguishes "this cell is
not on the walk network" from "on the network, but nothing within the search cap". Quantising to
`uint16` maps both to 65535, so after the round trip they are indistinguishable. That drops 1,060
Johor Bahru residents from the denominator and nudges its completeness up by 0.02 points. The other
gap is rounding: distances are stored as whole metres, so cells sitting within half a metre of the
threshold land on the wrong side of it — about 260–290 residents per city. Neither is fixable
downstream, both are small, and I would rather have them written down than discover them in an
interview.

### Decision: 3D landmarks, built from numbers

The hex map answers the dashboard's question. It does not answer "where am I?", and on a wall
display that is the question a passer-by asks first. So the map carries twenty-six landmarks,
spread across the study area rather than piled into the two centres.

Around Marina Bay: the Merlion, Marina Bay Sands, the ArtScience Museum, the Supertree Grove, the
Singapore Flyer, the Esplanade, the Fullerton, the National Gallery and the four tallest towers of
the central area. Out from it: Masjid Sultan in Kampong Glam, the Pinnacle@Duxton, Henderson Waves
on the Southern Ridges, the Chinese Garden pagoda at Jurong Lake and Jewel Changi in the east — so
that zooming into any part of Singapore lands on something recognisable rather than on nothing.

In Johor Bahru: Bangunan Sultan Ibrahim, the state mosque, Komtar JBCC, City Square, The Astaka,
and the state assembly twenty kilometres west at Kota Iskandar. Across the strait between them,
both checkpoints and the Causeway itself — the only land crossing in the study area, and the thing
every cross-border walking time in this dashboard has to pass through.

![Marina Bay on the command-centre map: the Sands under its SkyPark, the ArtScience Museum behind it, the Esplanade's two shells, the Merlion and the Fullerton at the river mouth, the Singapore Flyer across the water and the Supertree Grove below — all at their real size and bearing, standing in OSM building massing with the hexagon layer flattened to a carpet beneath them](docs/img/landmarks-bay.jpg)

They are modelled in Blender, headless, from a Python script
([`scripts/landmarks/build_models.py`](scripts/landmarks/build_models.py)). Not sculpted and not
scanned: **the script is the model**. That matters for three reasons.

**It is reviewable.** A `.blend` file in a pull request is a binary nobody can read. A script that
says the Sands are three 194 m slabs under a 340 m deck with a 67 m overhang is a diff. When a
reference photograph says the Merlion's mane is a collar of flat plates rather than a crown of
spikes, the fix is eight lines.

**Its inputs are sourced.** Every dimension lives in
[`landmarks.json`](scripts/landmarks/landmarks.json) with a confidence field saying whether it is
published, derived from published figures, or estimated off a photograph. Position and bearing are
not typed in at all: [`footprints.py`](scripts/landmarks/footprints.py) reads the OSM building
outline out of the basemap archive this repository already ships, and takes the centroid and the
long axis of the footprint. The Sands' footprint comes back as 339 m long — against a published
SkyPark of 340 m — which is the check that the right building was found. The Causeway has no
footprint, being an embankment; it is placed instead from the KTM alignment in the same archive's
rail layer, which measures 1,070 m against a published 1,056 m.

**Its colours are measured.** The night palette is not picked by eye.
[`analyse_refs.py`](scripts/landmarks/analyse_refs.py) k-means clusters nine reference
photographs and writes out the colour of their brightest 2% of pixels — the lit windows
themselves — and [`textures.py`](scripts/landmarks/textures.py) builds the facade textures from
those numbers, along with the Merlion's scales, which are a texture for the same reason the
windows are: a hundred modelled scales would cost more triangles than every other landmark put
together. Colours are selected from the clusters by *rule* — the darkest well-represented one for
an unlit wall, the magenta one for the Supertrees' uplighting — never by index, because raising
the cluster count from six to ten silently turned the Merlion's skin from white to slate the one
time they were. The photographs are not committed (unclear licences); the URLs and the derived
numbers are.

Three things fell out of putting real buildings on the map that were worth fixing anyway:

* **The columns had to come down.** Height encodes population, and a res-8 hexagon holding 7,000
  people extrudes to 2.7 km. At the zoom where a 200 m tower is finally visible, the data was a
  wall standing in front of the city. The columns now collapse over the one zoom level in which
  the landmarks fade in, and the fill thins at the same time, so the streets show through.
* **Buildings, not just land.** The basemap archive had an unused `buildings` layer. It is now
  extruded as massing from zoom 13 — at a uniform 9 m, because the extract carries no heights, and
  the legend says so rather than letting anyone read a skyline into it.
* **One lighting rig.** deck.gl's default lighting is a studio with nothing in shadow. The map now
  runs a night rig ([`lighting.ts`](dashboard/src/map/lighting.ts)) — low cool ambient, a weak key
  from the north-east, a warm fill standing in for the city's own glow — which the hexagons need
  more than the landmarks do.

Everything is drawn at its real size, with one exception the hover card admits to: nothing is drawn
smaller than 65 m across its largest dimension, which catches two of the twenty-six: the Merlion at
18 m including its plinth and its jet, and the Chinese Garden pagoda at 42 m. The measure is the model's *extent*, not
its height, and measured in Blender rather than declared: a height-based rule decided the Causeway
needed enlarging three-fold, which would have put a 3.4 km embankment across a 1 km strait. A map
symbol that is not to scale is normal. One that is not to scale and does not say so is not.

**The same models on the public site.** The Explorer carries them too — same geometry, same
manifest, same policy, switchable in its controls and gated at the same zoom. There is one copy of
each `.glb`, in `web/public/models`, served directly by the site and over HTTP to the dashboard by
the API; the drawing policy (the zoom they fade in at, the floor under which a model is enlarged)
is computed by the builder and travels in the manifest, so two front ends cannot disagree about it.
The Story does not draw them: its camera never leaves city zoom, where a 200 m tower is four pixels.

**Checking it.** None of this is assertable. "Is the Sands pointing along the bay or across it" is a
question about pixels, so the dashboard ships a page that puts one landmark at a time on the real
basemap — `npm --prefix dashboard run shots:landmarks` leaves twenty-six screenshots to look at. That
page is what caught the one real bug in the layer: deck.gl composes its orientation as
Rz(yaw)·Ry(pitch)·Rx(roll), so after the fixed roll that turns glTF's Y-up into Z-up, a model's own
axis points *east*, not north. Every landmark was quietly rotated by the same wrong amount and
still looked like a building. Pointing the camera north and looking at the Merlion's water jet
found it in one frame.

Where the sources give less, the model says less. The four central-area towers — Guoco Tower at
290 m and the three 280 m towers of Raffles Place, all three at exactly the height limit of their
day — share one builder, because what is published about them is a height, a floor count, a
roughly square plan and a kind of top. Four bespoke models would be four inventions. Where a
figure could not be found at all — the dome of Masjid Sultan, the height of the Chinese Garden
pagoda — the landmark says `estimated` and a note says what the number was read off.

`make landmarks` rebuilds all of it from the committed numbers, byte for byte: every random draw
in the texture generator and the grove's scatter is seeded, so a reviewer can check the committed
binaries by regenerating them and finding no diff. The photographs are only needed to redo the
colour analysis itself.

Total cost: 1.26 MB of glTF, about 20,000 triangles across all twenty-six, and no measurable
frame time.

### How this was built

The concept is mine: a command centre for the 15-minute-city data, in the stack a 3D digital-twin
team actually runs, because reading about Vue is not the same as shipping something in it.

**My decisions.** What the screen is for and who reads it. The layout — KPI rail left, map centre,
charts right, scenarios along the bottom. Which six metrics earn a tile, and that the scarcest
essential is one of them, because "healthcare is the binding constraint in both cities" is the
study's most useful finding and a number nobody would compute for themselves. That the scenario
switches show the pipeline's published before/after rather than figures the dashboard derives.
That clicking a hexagon scopes everything rather than opening a separate view. That the screen is a
fixed 1920×1080 scaled to fit, because it targets a wall and not a browser window. And the standing
rule for the whole thing: the dashboard may never state a number the study does not support.

**What Claude Code implemented under my direction.** The SQLite schema and ingest, the Fastify API
and its tests, the Vue components, the ECharts panels, the deck.gl map, and the documentation. I
reviewed the decisions, pushed back where the easy path was the wrong one, and asked it to prove
things rather than assert them.

That last part is most of the value. Three examples of what it caught by checking rather than
trusting:

* The ingest reproduced the study's headline share to five decimal places — but **not exactly**, and
  every discrepancy leaned the same way. One-sided error means a cause. It turned out the binary
  export maps both "off the walk network" and "on the network but nothing within reach" to the same
  sentinel, which quietly drops 1,060 Johor Bahru residents out of the denominator. The existing
  React site has carried that since it was built. It is under a tenth of a percentage point and now
  it is written down.
* Averaging walking distances into a bigger hexagon and *then* testing the 15-minute threshold —
  the obvious way to make the map fast — overstates Singapore's completeness by 4.6 points. The
  threshold has to be applied per small cell first. `npm run verify` measures the wrong answer
  alongside the right one so the point is not rhetorical.
* Switching city with a scenario active briefly showed a −39.5 point delta: one city's scenario
  against the other's baseline, because a cached response can land after a newer one and win. Found
  by driving the real UI, not by reading the code.

None of those are visible without looking. That is the part of "AI native" that I think matters:
not how fast the first version appears, but whether anyone checks it against the thing it claims to
describe.

## My contribution

**[Brian Har](https://brianhar.site)**. Role: concept and brief, research questions, choice of cities and scenarios, design direction, and review of the results. Built with
Claude Code, an AI coding assistant, which wrote the pipeline and the site under my direction.

Dates: October 2026 (OpenStreetMap snapshot 5 October 2026; first public release 14 October 2026). The
[About page](https://sgjburbansideprojects.brianhar.site/about/) explains how it was made, the three decisions behind the method and how the results were checked.

## Portfolio summary

1. **Problem.** Most 15-minute-city maps draw circles and count shops. This project measures real
   walks for every resident, separates observation from modelling, and tests whether the answer
   survives other definitions.
2. **Why Singapore and Johor Bahru.** One functional region (about 327,000 crossings a day at
   Woodlands), two urban models: planned transit towns and a car-oriented metropolis of private
   estates — and a new cross-border rail link due by the end of 2026.
3. **What the data revealed.** An 80.4 % vs 12.0 % gap in complete walkable access. Singapore leads
   in all 72 sensitivity runs, with healthcare as the scarcest essential in both cities.
4. **Biggest differences.** Street connectivity (3× the junctions), dedicated footpaths (4×), and
   the spread of gaps (one missing essential vs several).
5. **Interventions tested.** The RTS Link with and without a shared autonomous feeder, and
   converting car parks into neighbourhood hubs.
6. **What changed.** The RTS saves minutes; a kerbside autonomous feeder saves far more because
   access, not the crossing, dominates. Hubs help most where homes are one essential short.
7. **Implications.** Design for the slowest walker; make networks continuous before making them
   smart; treat the kerb as the interface; spend any parking dividend on proximity. See the
   [case study](docs/case-study.md).


## Run it

Requirements: Python ≥ 3.11, Node ≥ 20, [osmium-tool](https://osmcode.org/osmium-tool/) and
[tippecanoe](https://github.com/felt/tippecanoe) (basemap only).

```bash
make setup                 # .venv + web dependencies
make data                  # every source except OpenStreetMap (checksums → data/provenance.json)
make osm                   # OSM extract by streaming the dated planet, or:
make osm OSM_FROM=malaysia-singapore-brunei-latest.osm.pbf   # cut from a Geofabrik download
make pipeline              # analysis → data/derived, web/public/data, web/public/tiles
make dev                   # http://localhost:5173
make web                   # static site in web/dist, every page prerendered (needs Playwright's Chromium)
make check                 # end-to-end checks of web/dist: no-JS HTML, URLs, agent tools
make test                  # pytest + vitest
```

Command centre dashboard (independent of the static site — it needs only the committed
`web/public/data`, not a pipeline run):

```bash
npm run setup              # server + dashboard dependencies, then builds server/data/sgjb.db
npm run dev                # API on :8787 and the dashboard on :5174, together
npm run verify             # recompute the study's headline numbers out of SQLite (20 checks)
npm test                   # 67 API tests, most of them about input that should be refused
npm run ingest             # rebuild the database from web/public/data
```

Individual stages: `python -m sgjb.pipeline networks features population access access_overture form scenarios footpath summary export basemap`.
After the data or the Story's scenes change, regenerate the fallback stills with `cd web && npm run build && node scripts/stills.mjs`.

## Repository

```
config/            study area, network rules, essentials taxonomy, scenario parameters, data sources
src/sgjb/          the pipeline (acquire → networks → access → form → scenarios → summary → export)
tests/             pytest: graph kernels, OSM parsing, metrics, export format, output integrity
scripts/landmarks/ Blender build for the dashboard's 3D landmarks (models, textures, footprints)
data/derived/      versioned results (summary.json, neighbourhoods, sensitivity grid, sites)
web/               Vite + React + TypeScript site: Story, Explorer, Methods
server/            Node + SQLite: ingest of the pipeline outputs, read-only dashboard API
dashboard/         Vue 3 + ECharts + deck.gl large-screen command centre
docs/              case study and architecture
```

## Documentation

* [Case study](docs/case-study.md) — problem, research, data, method, design, findings, limitations, next steps
* [Architecture](docs/architecture.md) — pipeline, static artifacts, rendering, testing
* [Methods](https://sgjburbansideprojects.brianhar.site/methods/) page in the site — formulas, data register, audits, sensitivity
* [Data licences](DATA_LICENSES.md) — sources and required attributions

## Licence

Code: MIT. Data and derived files: the licences of their sources (OpenStreetMap data under ODbL;
see [DATA_LICENSES.md](DATA_LICENSES.md)).
