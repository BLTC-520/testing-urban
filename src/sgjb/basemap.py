"""Self-hosted vector basemap (PMTiles) built from the same open inputs as the analysis.

Layers
  water      ESA WorldCover permanent water (class 80), sieved + simplified
  landcover  WorldCover tree cover / mangrove (vegetation) and built-up area
  roads      OSM highways by class (minzoom per class)
  rail       OSM rail / subway / light rail (incl. the RTS Link under construction)
  buildings  OSM building footprints (z13+)
  places     OSM place labels
  border     OSM international boundary (Singapore–Malaysia)

Self-hosting keeps the product free of third-party tile keys and quotas and
gives full control over cartography.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import numpy as np
import rasterio
import shapely
from rasterio.features import shapes, sieve
from shapely.geometry import mapping, shape

from . import config

TIPPECANOE = Path("/home/user/tools/tippecanoe/tippecanoe")
WATER, TREE, MANGROVE, BUILT = 80, 10, 95, 50


def _write_geojsonl(path: Path, feats) -> int:
    n = 0
    with path.open("w") as fh:
        for geom, props, minzoom in feats:
            f = {"type": "Feature", "properties": props, "geometry": mapping(geom)}
            if minzoom is not None:
                f["tippecanoe"] = {"minzoom": minzoom}
            fh.write(json.dumps(f, separators=(",", ":")) + "\n")
            n += 1
    return n


def landcover_layers(out_dir: Path, sieve_px: int = 30, simplify_deg: float = 0.00008) -> dict[str, int]:
    """Polygonise WorldCover classes into water / vegetation / built-up layers."""
    src_path = config.raw("worldcover", "worldcover_2021_sgjb.tif")
    with rasterio.open(src_path) as src:
        a = src.read(1)
        tr = src.transform
    counts = {}
    specs = {
        "water": (a == WATER, None),
        "vegetation": ((a == TREE) | (a == MANGROVE), 9),
        "built": (a == BUILT, 9),
    }
    for name, (mask, minzoom) in specs.items():
        m = sieve(mask.astype(np.uint8), size=sieve_px, connectivity=8)
        feats = []
        for geom, val in shapes(m, mask=m.astype(bool), transform=tr, connectivity=8):
            if val != 1:
                continue
            g = shape(geom).simplify(simplify_deg, preserve_topology=True)
            if g.is_empty or g.area < (simplify_deg * 3) ** 2:
                continue
            feats.append((g, {"class": name}, minzoom))
        counts[name] = _write_geojsonl(out_dir / f"lc_{name}.geojsonl", feats)
    return counts


def build_pmtiles(layer_files: dict[str, Path], out: Path, minzoom: int = 8, maxzoom: int = 15) -> None:
    args = [str(TIPPECANOE), "-o", str(out), "--force", f"-Z{minzoom}", f"-z{maxzoom}",
            "--no-tile-size-limit", "--simplification=4", "--detect-shared-borders",
            "--coalesce-densest-as-needed", "--extend-zooms-if-still-dropping", "-q"]
    for layer, path in layer_files.items():
        args += ["-L", f"{layer}:{path}"]
    subprocess.run(args, check=True)


ROAD_CLASS = {
    "motorway": ("motorway", 8), "motorway_link": ("motorway", 11), "trunk": ("trunk", 8), "trunk_link": ("trunk", 11),
    "primary": ("primary", 9), "primary_link": ("primary", 11), "secondary": ("secondary", 10),
    "secondary_link": ("secondary", 12), "tertiary": ("tertiary", 11), "tertiary_link": ("tertiary", 12),
    "unclassified": ("unclassified", 12), "residential": ("residential", 12), "living_street": ("living_street", 13),
    "service": ("service", 13), "pedestrian": ("pedestrian", 13), "footway": ("footway", 14), "path": ("path", 14),
    "steps": ("steps", 14), "cycleway": ("cycleway", 14), "corridor": ("footway", 15), "track": ("path", 13),
}


def osm_layers(out_dir: Path) -> dict[str, int]:
    """Roads, rail, buildings, places and the international border from the OSM extract."""
    import osmium

    wkb = osmium.geom.WKBFactory()
    roads, rail, buildings, places, border = [], [], [], [], []
    hw_pbf = config.interim("highways.osm.pbf")
    for w in osmium.FileProcessor(str(hw_pbf), osmium.osm.NODE | osmium.osm.WAY).with_locations():
        if not w.is_way():
            continue
        hw = w.tags.get("highway")
        if hw not in ROAD_CLASS or w.tags.get("area") == "yes":
            continue
        try:
            g = shapely.from_wkb(wkb.create_linestring(w))
        except RuntimeError:
            continue
        cls, mz = ROAD_CLASS[hw]
        roads.append((g, {"class": cls, "name": w.tags.get("name", "")}, mz))
    bm = config.interim("basemap.osm.pbf")
    for o in osmium.FileProcessor(str(bm)).with_locations().with_areas():
        t = o.tags
        if o.is_node():
            if t.get("place") and t.get("name") and o.location.valid():
                from shapely.geometry import Point

                kind = t.get("place")
                places.append((Point(o.location.lon, o.location.lat), {"name": t.get("name:en") or t.get("name"), "kind": kind},
                               {"city": 8, "town": 10, "suburb": 11, "quarter": 12, "neighbourhood": 13, "village": 12}.get(kind, 12)))
        elif o.is_way() and not o.is_area() and t.get("railway"):
            if o.is_closed() and t.get("railway") not in ("rail", "subway", "light_rail", "monorail", "construction"):
                continue
            try:
                g = shapely.from_wkb(wkb.create_linestring(o))
            except RuntimeError:
                continue
            status = "construction" if t.get("railway") == "construction" else "active"
            rail.append((g, {"kind": t.get("construction") or t.get("railway"), "status": status, "name": t.get("name", "")}, 9))
        elif o.is_area() and (t.get("building") and t.get("building") != "no"):
            try:
                g = shapely.from_wkb(wkb.create_multipolygon(o))
            except RuntimeError:
                continue
            buildings.append((g, {}, 13))
    # International boundary: ways belonging to the admin_level=2 relations of
    # Singapore *and* Malaysia form the shared border (down the Johor Strait).
    members: dict[str, set[int]] = {}
    for r in osmium.FileProcessor(str(bm), osmium.osm.RELATION):
        t = r.tags
        if t.get("boundary") == "administrative" and t.get("admin_level") == "2":
            iso = t.get("ISO3166-1") or t.get("ISO3166-1:alpha2") or t.get("name:en", "")
            members[iso] = {m.ref for m in r.members if m.type == "w"}
    shared = members.get("SG", set()) & members.get("MY", set())
    for w in osmium.FileProcessor(str(bm), osmium.osm.NODE | osmium.osm.WAY).with_locations():
        if w.is_way() and w.id in shared:
            try:
                border.append((shapely.from_wkb(wkb.create_linestring(w)), {"kind": "sg-my"}, None))
            except RuntimeError:
                continue
    counts = {
        "roads": _write_geojsonl(out_dir / "roads.geojsonl", roads),
        "rail": _write_geojsonl(out_dir / "rail.geojsonl", rail),
        "buildings": _write_geojsonl(out_dir / "buildings.geojsonl", buildings),
        "places": _write_geojsonl(out_dir / "places.geojsonl", places),
        "border": _write_geojsonl(out_dir / "border.geojsonl", border),
    }
    return counts


def build_all() -> None:
    d = config.interim("basemap")
    d.mkdir(parents=True, exist_ok=True)
    if not (d / "lc_water.geojsonl").exists():
        print("landcover", landcover_layers(d))
    print("osm", osm_layers(d))
    out = config.WEB_DATA_DIR.parent / "tiles" / "basemap.pmtiles"
    out.parent.mkdir(parents=True, exist_ok=True)
    build_pmtiles({
        "water": d / "lc_water.geojsonl", "landcover": d / "lc_vegetation.geojsonl", "built": d / "lc_built.geojsonl",
        "roads": d / "roads.geojsonl", "rail": d / "rail.geojsonl", "buildings": d / "buildings.geojsonl",
        "places": d / "places.geojsonl", "border": d / "border.geojsonl",
    }, out, 8, 15)
    print("basemap", out, f"{out.stat().st_size / 1e6:.1f} MB")
