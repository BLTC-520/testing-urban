# Singapore / Johor Bahru 15-Minute City Explorer

**How far is daily life from home — and what could change it?** An open, reproducible
street-network study of walkable access to everyday essentials for 5.8 million residents of
Singapore and Johor Bahru, with scenario models for the RTS Link, shared autonomous feeders and
the conversion of car-park land into neighbourhood hubs.

<!-- FINDINGS -->

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
make web                   # static site in web/dist (deploy anywhere)
make test                  # pytest + vitest
```

Individual stages: `python -m sgjb.pipeline networks features population access access_overture form scenarios summary export basemap`.

## Repository

```
config/            study area, network rules, essentials taxonomy, scenario parameters, data sources
src/sgjb/          the pipeline (acquire → networks → access → form → scenarios → summary → export)
tests/             pytest: graph kernels, OSM parsing, metrics, export format, output integrity
data/derived/      versioned results (summary.json, neighbourhoods, sensitivity grid, sites)
web/               Vite + React + TypeScript site: Story, Explorer, Methods
docs/              case study and architecture
```

## Documentation

* [Case study](docs/case-study.md) — problem, research, data, method, design, findings, limitations, next steps
* [Architecture](docs/architecture.md) — pipeline, static artifacts, rendering, testing
* Methods page in the site (`#/methods`) — formulas, data register, audits, sensitivity
* [Data licences](DATA_LICENSES.md) — sources and required attributions

## Licence

Code: MIT. Data and derived files: the licences of their sources (OpenStreetMap data under ODbL;
see [DATA_LICENSES.md](DATA_LICENSES.md)).
