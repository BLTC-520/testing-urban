# SG / JB 15-Minute City Explorer — common tasks.
#   make setup     Python env (.venv) + web dependencies
#   make data      download every source except OpenStreetMap (checksums → data/provenance.json)
#   make osm       OpenStreetMap extract: streams the dated planet (≈95 GB read, nothing stored)
#                  or: make osm OSM_FROM=path/to/malaysia-singapore-brunei-latest.osm.pbf
#   make pipeline  all analysis stages → data/derived + web/public/data + web/public/tiles
#   make landmarks rebuild the dashboard's 3D landmarks with Blender
#   make web       static site → web/dist (prerendered)
#   make check     end-to-end checks of the built site
#   make test      Python and TypeScript tests
#   make dev       local development server on http://localhost:5173

PY ?= .venv/bin/python
NPM ?= npm

.PHONY: setup data osm pipeline landmarks web check test dev serve clean

setup:
	python3 -m venv .venv
	$(PY) -m pip install --upgrade pip
	$(PY) -m pip install -e ".[dev]"
	cd web && $(NPM) ci

data:
	$(PY) -m sgjb.acquire

osm:
ifdef OSM_FROM
	$(PY) -m sgjb.acquire --osm-from $(OSM_FROM)
else
	$(PY) -m sgjb.acquire --osm
endif

pipeline:
	$(PY) -m sgjb.pipeline all

# The 3D landmarks on the command-centre map. Needs the extra dependencies:
#   .venv/bin/pip install -e ".[landmarks]"
#
# Deterministic: every random draw is seeded, so re-running this on an unchanged
# checkout leaves no diff, and the committed .glb files can be verified by
# rebuilding them. The reference photographs the colours come from are not
# committed; fetch_refs re-downloads them if you want to redo the analysis step
# as well, which is the one part of the chain this target does not run.
landmarks:
	$(PY) scripts/landmarks/textures.py
	$(PY) scripts/landmarks/footprints.py -o scripts/landmarks/refs/footprints.json
	$(PY) scripts/landmarks/build_models.py --out dashboard/public/models

web:
	cd web && $(NPM) run build:site

check:
	cd web && $(NPM) run check:site

test:
	$(PY) -m pytest
	cd web && $(NPM) test

dev:
	cd web && $(NPM) run dev

serve: web
	cd web && $(NPM) run preview

clean:
	rm -rf data/interim web/dist
