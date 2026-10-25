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

### Decision: the server aggregates, it does not just serve

The analysis outputs are static files. The React site reads them straight out of `/data` with no
backend at all, and for that site it was the right call. So before writing any of this I had to
answer whether a server earns its place here, or whether I was adding one because the job ad
mentions Node.

It earns it, for two reasons.

**Payload.** There are 91,357 hexagons across the two cities. Served raw at resolution 10 that is
5.5 MB of JSON for Singapore and 7.8 MB for Johor Bahru. Rolled up to H3 resolution 8 in SQL it is
746 and 1,117 hexagons — 35 KB and 51 KB. That is 150× less data over the wire for a surface that
reads identically on a wall-mounted screen, and it is work a database is better at than a browser.

**Order of operations, which matters more.** Completeness is "all six essentials within 15 minutes".
You have to test that for each small hexagon and *then* average over population. Do it the other
way round — average the distances into a big hexagon, then test the average — and the answer is
wrong, not approximate. A district where half the residents are 200 m from a clinic and half are
3 km away averages to 1.6 km, which passes; the truth is that half those people cannot walk it. On
this data that mistake overstates Singapore's completeness by 4.6 points and understates Johor
Bahru's by 0.5. Putting the aggregation in SQL means there is one place where the order is fixed and
correct, instead of every client getting it right by hoping.

So: each cell's resolution-8 and resolution-7 parent hexagons are precomputed at ingest, and
`/api/cells` is one `GROUP BY` that thresholds first and aggregates second. 23–36 ms per query. It
is the one choice in the schema that would be expensive to undo, which is why I made it before
writing the rest.

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

Individual stages: `python -m sgjb.pipeline networks features population access access_overture form scenarios footpath summary export basemap`.
After the data or the Story's scenes change, regenerate the fallback stills with `cd web && npm run build && node scripts/stills.mjs`.

## Repository

```
config/            study area, network rules, essentials taxonomy, scenario parameters, data sources
src/sgjb/          the pipeline (acquire → networks → access → form → scenarios → summary → export)
tests/             pytest: graph kernels, OSM parsing, metrics, export format, output integrity
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
