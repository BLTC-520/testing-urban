# SG / JB 15-Minute City Explorer — common tasks.
#   make setup     Python env (.venv) + web dependencies
#   make data      download every source except OpenStreetMap (checksums → data/provenance.json)
#   make osm       OpenStreetMap extract: streams the dated planet (≈95 GB read, nothing stored)
#                  or: make osm OSM_FROM=path/to/malaysia-singapore-brunei-latest.osm.pbf
#   make pipeline  all analysis stages → data/derived + web/public/data + web/public/tiles
#   make web       static site → web/dist (prerendered)
#   make check     end-to-end checks of the built site
#   make test      Python and TypeScript tests
#   make dev       local development server on http://localhost:5173

PY ?= .venv/bin/python
NPM ?= npm

.PHONY: setup data osm pipeline web check test dev serve clean

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
