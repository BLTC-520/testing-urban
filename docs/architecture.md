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

**Rendering.** MapLibre GL 5 draws the basemap from a self-hosted PMTiles archive; deck.gl 9
(`MapboxOverlay`, interleaved) draws hexagons, walk-sheds and markers in the same WebGL context, so
labels and analysis layers depth-sort together. H3 cells are aggregated to resolutions 8–9 at low
zoom to keep the number of drawn polygons bounded.

## Testing

* `pytest`: graph kernels against brute force, OSM parsing fixtures, metrics, export format.
* `vitest`: binary decoding, Dijkstra, client-side metrics, street-graph tiles (against fixtures
  written by the Python tests), cross-border composition.
* Playwright scripts (`web/scripts/shot*.mjs`) render the pages headlessly for visual review.
