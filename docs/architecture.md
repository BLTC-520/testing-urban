# Architecture

The project is **static-first**: a Python pipeline turns public data into compact files, and a
React application reads those files in the browser. There is no application server, database or
API key at runtime, so the site can be hosted on any static host or CDN and keeps working for as
long as its files exist.

```
                     config/*.yml  (study area, network rules, taxonomy, scenarios, sources)
                            │
 public sources ──► sgjb.acquire ──► data/raw/ + data/provenance.json (sha256, URL, time)
                            │
                            ▼
                     sgjb.pipeline
   prefilter ─► networks ─► features ─► population ─► access ─► access_overture
        ─► form ─► scenarios ─► summary ─► export ─► basemap
                            │
             data/interim/ (parquet, npz)      data/derived/ (CSV + summary.json, versioned)
                            │
                            ▼
              web/public/data/  web/public/tiles/   (static artifacts)
                            │
                            ▼
      web/ (Vite + React + TypeScript): Story · Explorer · Methods
      MapLibre GL (basemap, PMTiles) + deck.gl (analysis layers, interleaved)
```

## Pipeline (Python, `src/sgjb/`)

| Stage | Module | Output |
|---|---|---|
| `prefilter` | `osm.py` | tag-filtered OSM subsets (highways, features, basemap) via osmium |
| `networks` | `osm.py`, `graph.py` | walk network (permissive and strict variants) and drive network as CSR arrays (`.npz`) |
| `features` | `features.py` | destinations with taxonomy levels (strict/core/broad), parks with boundary access points, car parks |
| `population` | `population.py`, `boundaries.py` | H3 r10 cells with census-calibrated residents (HRSL dasymetric, Kontur fallback) and residents 65+ |
| `access` | `accessibility.py`, `dijkstra.py` | per cell × category: nearest distance, cumulative opportunities, gravity index; all variants |
| `access_overture` | `overture.py` | the same distances with Overture Places destinations |
| `form` | `form.py` | intersection density, dead ends, pedestrian share, arterial exposure, shed ratio, circuity, parking land |
| `scenarios` | `parking.py`, `crossborder.py`, `transit.py` | Parking-to-Proximity greedy site selection; JB→border-hub access times (walk, walk+bus from GTFS, AV feeder) |
| `footpath` | `footpath.py` | one-footpath scenario: missing-link candidates in Johor Bahru, desk filters (buildings, water, rail, major roads, walls, compounds), exact before/after scoring, sample routes, still-map geometry (`footpath.json`) |
| `summary` | `summary.py`, `metrics.py`, `sensitivity.py`, `audit.py` | `summary.json`: headline metrics, neighbourhoods, 72-run sensitivity grid, audits, scenario results |
| `export` | `web_export.py`, `export.py` | browser artifacts (below) |
| `basemap` | `basemap.py` | PMTiles basemap from WorldCover + OSM via tippecanoe |

**Routing.** Graphs are compressed sparse row arrays. Multi-source Dijkstra (one search per
category from all its destinations) and bounded single-source searches are compiled with numba.
Origins and destinations are snapped to the nearest *edge* (not node) with along-edge offsets, so
a home in the middle of a long block is not credited with the distance to the wrong end.

**Determinism.** Every random choice (the shed-ratio sample) is seeded; configuration is the single
source of parameters; derived CSVs and `summary.json` are versioned in git so that changes in
results show up in diffs.

## Static artifacts (`web/public/data`)

| File | Content |
|---|---|
| `meta.json` | parameters, categories (with OSM tag lists), hubs, sources, provenance digest |
| `summary.json` | everything the story and methods pages quote |
| `cells_{sg,jb}.bin` | per cell: H3 index, residents, residents 65+, neighbourhood, distance to each essential |
| `cells_{city}_variants.bin` | the same distances under strict/broad taxonomy, strict network, Overture POIs; Kontur population |
| `cells_{city}_scenario.bin` | distances after converting 10/25/50 car parks |
| `crossborder_jb.bin` | per JB cell: minutes to each border hub (walk, walk+bus), AV-feeder components |
| `pois_{city}.bin/.json` | destinations (category bitmask) and their network snaps |
| `graph/index.json`, `graph/t_*.bin` | the walk network in 0.02° tiles for in-browser isochrones |
| `neighbourhoods.geojson`, `parking_sites.geojson` | units and scenario sites |

Binary tables use a small columnar format (`SGJB`): a JSON header followed by 8-byte-aligned
little-endian columns, so each column is a zero-copy typed-array view. Distances are stored as
`uint16` metres. Graph tiles store tile-relative `uint16` node coordinates and `int16`
delta-encoded edge geometry simplified with Douglas–Peucker at 2.5 m. Cross-language tests
(`tests/test_export.py` → `web/src/lib/*.test.ts`) check that Python writes what TypeScript reads.

## Web application (`web/`)

* **Story** (`src/story/`): one fixed, non-interactive map whose *scene* (camera + layers) follows
  the scroll position; essays with SVG charts scroll over it. Charts measure their container and
  draw at real pixel size, each with a hover layer and a data table.
* **Explorer** (`src/explore/`): the full map. Completeness is recomputed in the browser from the
  per-cell distances for any threshold, speed, definition, network, population group or scenario
  (`src/lib/access.ts`, mirroring `metrics.py`). Clicking anywhere runs Dijkstra on the street-graph
  tiles (`src/lib/streetGraph.ts`) and animates the walk-shed with a GPU filter.
* **Methods** (`src/methods/`): documentation generated from `meta.json` and `summary.json`.

The RTS Link scenario is recombined in the browser (`src/lib/crossborder.ts`, mirroring
`crossborder.compose`) so readers can set their own border assumptions.

**URLs.** Pages live at real paths — `/`, `/explore/`, `/methods/` — handled by a small history
router (`src/lib/router.ts`); old `#/…` links are rewritten on load. Every Explorer setting is
mirrored in the query string (`src/lib/explorerUrl.ts`), e.g.
`/explore/?metric=healthcare&minutes=10&speed=slow&lon=103.7646&lat=1.4630`, so any view can be
linked, bookmarked or opened by an agent.

**Prerendering.** `npm run build:site` builds the app and then runs `scripts/prerender.mjs`, which
loads each page in headless Chromium, waits for the data-driven text, and writes that DOM (without
the map canvases) into `dist/<page>/index.html` with the page's own title, description, canonical
URL and schema.org JSON-LD. Readers without JavaScript — search crawlers, link previews, AI
assistants that fetch a URL — get the full text, tables and formulas (KaTeX HTML + MathML with the
TeX source). In a browser, `main.tsx` fetches the summary data first, then React replaces the
prerendered DOM with an identical first render and adds the maps.

**For agents.** From the same rendered DOM the prerender step writes Markdown copies of the pages
(`/index.md`, `/methods.md`, `/explore.md`, linked from each page with `rel="alternate"`),
`/llms.txt` and `/llms-full.txt`, `/robots.txt`, `/sitemap.xml` and a data catalogue
(`/data/index.json`). In the page, `src/agent/tools.ts` offers five tools — `get_city_summary`,
`find_neighbourhoods`, `walk_from` (runs the same street-network search as the Explorer),
`get_footpath_scenario` and `open_explorer` — registered with WebMCP (`navigator.modelContext`)
when the browser supports it and always available as `window.sgjb.call(name, input)`.

**When the map cannot run.** The interactive maps need WebGL. `MapCanvas` checks for it, creates
the map inside a try/catch and treats a lost context as a failure; an error boundary keeps any
failure inside the map, and a page-level boundary replaces a blank page with links. Without a
map, the Story shows a still of the current scene behind its text (one per scene, rendered from
the live map with the text hidden by `scripts/stills.mjs`) and a notice saying what the still
shows; the Explorer switches to its table view, which also works as an accessible alternative to
the map (`view=table`). The footpath chapter's map is plain SVG and needs no WebGL at all.

**Landmarks.** The Explorer draws the same twenty-six generated landmark models as the command
centre, from `web/public/models` and the manifest beside the module that reads it. They appear
from zoom 12.3, fade in over three-quarters of a level, and are a switch in the controls next to
the destination and outline toggles. They are not pickable: a landmark that swallowed a click
would stop the map answering its own question.

**Rendering.** MapLibre GL 5 draws the basemap from a self-hosted PMTiles archive; deck.gl 9
(`MapboxOverlay`, interleaved) draws hexagons, walk-sheds and markers in the same WebGL context, so
labels and analysis layers depth-sort together: area fills are inserted beneath the place labels
(`beforeId`), lines and markers above them. H3 cells are aggregated to resolutions 8–9 at low
zoom to keep the number of drawn polygons bounded.

## Command centre (`dashboard/`, `server/`)

A second front end on the same analysis, for a 1920x1080 wall display: Vue 3 + ECharts +
deck.gl/MapLibre against a Node + SQLite API that aggregates the pipeline's outputs
(`server/src/ingest.ts` → `sgjb.db`, `/api/cells` thresholds first and aggregates second).

**3D landmarks.** The map carries twenty-six generated landmark models.
`scripts/landmarks/build_models.py` runs Blender headless (`bpy`) and writes one glTF binary per
landmark into `web/public/models/` — one copy, which the published site serves directly and the
API serves to the dashboard, as it already does for `basemap.pmtiles` — plus a manifest emitted
into both front ends. Nothing about them is hand-placed:

| Input | Source |
|---|---|
| dimensions | `scripts/landmarks/landmarks.json`, each with a `confidence` field |
| position, bearing | the OSM `buildings` layer of `web/public/tiles/basemap.pmtiles` (`footprints.py`) |
| night colours | k-means over reference photographs (`analyse_refs.py`), chosen by rule, never by index |
| facade and scale textures | generated from those colours (`textures.py`) |
| drawn scale | the model's own measured extent; nothing under 65 m across is drawn to scale |

The same models appear on the site's Explorer map (`web/src/map/landmarks.ts`), zoom-gated the same
way and switchable in its controls; the Story does not draw them, because its camera never leaves
city zoom. The drawing policy — the zoom it fades in at, the floor under which a model is enlarged
— lives in the manifest rather than in either front end, so the two cannot disagree.

The same archive's `buildings` layer is also extruded as uniform 9 m massing from zoom 13 on the
dashboard, and its hexagon columns collapse and their fill thins over the zoom level in which the
landmarks fade in, so the data does not stand in front of the city. A model that fails to load takes only itself out:
one `ScenegraphLayer` logs and draws nothing, the other twenty-five and the rest of the map are
unaffected (checked by deleting one and loading the page). `make landmarks` rebuilds the lot, deterministically: every random draw is seeded, so re-running it on an unchanged checkout leaves no diff and the committed binaries can be verified by regenerating them.

## Testing

* `pytest`: graph kernels against brute force, OSM parsing fixtures, metrics, export format.
* `vitest`: binary decoding, Dijkstra, client-side metrics, street-graph tiles (against fixtures
  written by the Python tests), cross-border composition.
* `scripts/check_site.mjs` (`npm run check:site`, after `build:site`): end-to-end checks of the
  built site — the raw HTML, Markdown, llms.txt, robots and sitemap a crawler would fetch; the app
  taking over without errors; real and legacy URLs; Explorer state in the URL; and every agent tool,
  including registration through a WebMCP-style `navigator.modelContext`.
  The same script runs the site in a browser with WebGL disabled (text, stills, the table, the
  agent tools) and checks for horizontal overflow at a 390 px phone width.
* `pytest tests/test_footpath.py`: the exact link update against full recomputation on random
  graphs, the candidate search and the building filter.
* Playwright scripts (`web/scripts/shot*.mjs`) render the pages headlessly for visual review;
  `web/scripts/stills.mjs` renders the Story's fallback stills.
* `pytest tests/test_landmarks.py`: the footprint geometry the 3D landmarks are placed from, the
  colour clustering they are painted from, and the manifest the dashboard imports. Their
  *appearance* is not assertable — `dashboard/landmarks.html` with
  `npm --prefix dashboard run shots:landmarks` puts each one on the real basemap and leaves
  twenty-six screenshots for a person to look at.
