"""Read each landmark's real footprint out of the basemap we already ship.

Why not type the numbers in by hand
-----------------------------------
A 3D model dropped on a map needs three things the photograph cannot give:
where it stands, how big it is, and which way it points. All three are already
in ``web/public/tiles/basemap.pmtiles`` — the ``buildings`` layer is the OSM
footprints the pipeline extracted — so this reads them from there instead of
asking anyone to eyeball a bearing off a satellite image.

For each anchor point in ``landmarks.json`` it finds the footprint that contains
the point (or the largest one nearby, for anchors like the Merlion that sit on a
promenade rather than inside a building) and reports:

* ``centroid``        lon/lat of the footprint, used as the model's position
* ``area_m2``         plan area, used as a scale sanity check
* ``bearing_deg``     the long axis of the footprint, degrees clockwise from
                      north, from the principal component of its outline. This
                      is the model's yaw: get it wrong and the Sands towers run
                      across the bay instead of along it.
* ``length_m`` /
  ``width_m``         extent along and across that axis
* ``on_water``        whether the resolved position falls inside a water polygon
                      of the same archive. Two landmarks are meant to (the
                      Merlion stands in the bay, the Causeway crosses the
                      strait); for every other one it means the anchor is
                      wrong

Why PCA for the bearing
-----------------------
The outline is a ring of points, not an oriented box. The first principal
component of those points is the direction they vary most in — for a long thin
slab, that is the slab's length. It costs one 2x2 eigen-decomposition and
behaves sensibly on the awkward shapes (the ArtScience lotus is nearly round,
and its bearing is correspondingly meaningless — which the low elongation in
the output makes visible).

Usage
-----
    python scripts/landmarks/footprints.py \
        --tiles web/public/tiles/basemap.pmtiles \
        -o scripts/landmarks/refs/footprints.json
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import pathlib

import mapbox_vector_tile
import numpy as np
from pmtiles.reader import MmapSource, Reader

Z = 15  # the archive's deepest zoom: least generalised footprints
SEARCH_M = 220.0  # how far from the anchor a footprint may sit and still count
# A footprint that does not contain the anchor has to be close to be believable.
# Without this the Merlion snapped to One Fullerton, 173 m away across the river.
NEAREST_M = 120.0
# A near-circular footprint has no long axis worth reporting: the principal
# component of a disc is whichever direction the vertices happen to favour.
MIN_ELONGATION = 1.5


def tile_of(lat: float, lon: float, z: int) -> tuple[int, int]:
    n = 2**z
    x = int((lon + 180.0) / 360.0 * n)
    la = math.radians(lat)
    y = int((1 - math.log(math.tan(la) + 1 / math.cos(la)) / math.pi) / 2 * n)
    return x, y


def unproject(x: int, y: int, z: int, px: float, py: float, extent: int) -> tuple[float, float]:
    """Tile-local MVT coordinates to lon/lat.

    MVT's y axis points down from the tile's top-left; the ``1 -`` flips it.
    """
    n = 2**z
    X = (x + px / extent) / n
    Y = (y + (1 - py / extent)) / n
    lon = X * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * Y))))
    return lon, lat


def rings_of(geom: dict) -> list[list[tuple[float, float]]]:
    """Outer rings only — a courtyard does not change where a building points."""
    if geom["type"] == "Polygon":
        return [geom["coordinates"][0]]
    if geom["type"] == "MultiPolygon":
        return [poly[0] for poly in geom["coordinates"]]
    return []


def metres(lon: np.ndarray, lat: np.ndarray, lat0: float) -> tuple[np.ndarray, np.ndarray]:
    """Local equirectangular metres. Fine over a few hundred metres."""
    return lon * 111_320.0 * math.cos(math.radians(lat0)), lat * 110_540.0


def shoelace(x: np.ndarray, y: np.ndarray) -> float:
    return abs(float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))) / 2.0


def describe(ring_ll: list[tuple[float, float]]) -> dict:
    lon = np.array([p[0] for p in ring_ll])
    lat = np.array([p[1] for p in ring_ll])
    lat0 = float(lat.mean())
    # Centroid of the polygon, not of its vertices: a ring with many points
    # along one wall would otherwise pull the centre towards that wall.
    x, y = metres(lon - lon.mean(), lat - lat.mean(), lat0)
    a = np.roll(x, -1) * y - x * np.roll(y, -1)
    area2 = float(a.sum())
    if abs(area2) < 1e-9:
        cx, cy = float(x.mean()), float(y.mean())
    else:
        cx = float(((x + np.roll(x, -1)) * a).sum() / (3 * area2))
        cy = float(((y + np.roll(y, -1)) * a).sum() / (3 * area2))

    pts = np.column_stack([x - cx, y - cy])
    # Principal axis. np.linalg.eigh returns ascending eigenvalues, so the last
    # eigenvector is the direction of greatest spread.
    cov = np.cov(pts.T)
    vals, vecs = np.linalg.eigh(cov)
    axis = vecs[:, -1]
    # Bearing: clockwise from north, i.e. atan2(east, north), folded to 0..180
    # because a slab's long axis has no front or back.
    bearing = math.degrees(math.atan2(axis[0], axis[1])) % 180.0

    along = pts @ axis
    across = pts @ vecs[:, 0]
    return {
        "centroid": [
            round(float(lon.mean() + cx / (111_320.0 * math.cos(math.radians(lat0)))), 6),
            round(float(lat.mean() + cy / 110_540.0), 6),
        ],
        "area_m2": round(shoelace(x, y), 1),
        "bearing_deg": round(bearing, 1),
        "length_m": round(float(along.max() - along.min()), 1),
        "width_m": round(float(across.max() - across.min()), 1),
        "elongation": round(
            float((along.max() - along.min()) / max(across.max() - across.min(), 1e-6)), 2
        ),
        "vertices": len(ring_ll),
    }


def point_in_ring(lon: float, lat: float, ring: list[tuple[float, float]]) -> bool:
    """Ray casting. Short enough to inline rather than pull in shapely."""
    inside = False
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % len(ring)]
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def on_water(reader: Reader, lat: float, lon: float) -> bool:
    """Is this point inside a water polygon of the basemap archive?

    Only the containing tile is read: MVT clips every geometry to its own tile,
    so whatever covers this point is present in the tile this point falls in.

    This is a cheap, automatable answer to "is the model standing in the sea".
    Published points for waterfront buildings are routinely a few hundred
    metres out, and an anchor that lands in water is the one case the footprint
    search cannot rescue: it finds nothing to snap to and falls back to the
    point it was given. Nothing has tripped this yet; it costs one tile read.
    """
    tx, ty = tile_of(lat, lon, Z)
    raw = reader.get(Z, tx, ty)
    if not raw:
        return False
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    layer = mapbox_vector_tile.decode(raw).get("water")
    if not layer:
        return False
    ext = layer["extent"]
    for feat in layer["features"]:
        for ring in rings_of(feat["geometry"]):
            ll = [unproject(tx, ty, Z, px, py, ext) for px, py in ring]
            if point_in_ring(lon, lat, ll):
                return True
    return False


def footprints_near(reader: Reader, lat: float, lon: float) -> list[tuple[float, list, bool]]:
    """Every buildings-layer ring within SEARCH_M, with its distance and hit flag.

    The anchor can fall near a tile edge, so the 3x3 block of tiles around it is
    read rather than just the one it lands in.
    """
    tx, ty = tile_of(lat, lon, Z)
    out: list[tuple[float, list, bool]] = []
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            raw = reader.get(Z, tx + dx, ty + dy)
            if not raw:
                continue
            if raw[:2] == b"\x1f\x8b":
                raw = gzip.decompress(raw)
            tile = mapbox_vector_tile.decode(raw)
            layer = tile.get("buildings")
            if not layer:
                continue
            ext = layer["extent"]
            for feat in layer["features"]:
                for ring in rings_of(feat["geometry"]):
                    ll = [unproject(tx + dx, ty + dy, Z, px, py, ext) for px, py in ring]
                    clon = sum(p[0] for p in ll) / len(ll)
                    clat = sum(p[1] for p in ll) / len(ll)
                    d = math.hypot(
                        (clon - lon) * 111_320.0 * math.cos(math.radians(lat)),
                        (clat - lat) * 110_540.0,
                    )
                    if d <= SEARCH_M:
                        out.append((d, ll, point_in_ring(lon, lat, ll)))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--tiles", type=pathlib.Path, default=pathlib.Path("web/public/tiles/basemap.pmtiles"))
    ap.add_argument("-o", "--out", type=pathlib.Path, required=True)
    args = ap.parse_args()

    here = pathlib.Path(__file__).parent
    marks = json.loads((here / "landmarks.json").read_text())["landmarks"]

    with open(args.tiles, "rb") as fh:
        reader = Reader(MmapSource(fh))
        out = {}
        for m in marks:
            cands = footprints_near(reader, m["lat"], m["lon"])
            hits = [c for c in cands if c[2]]
            if hits:
                # The anchor is inside a footprint: that is the building.
                pick, how = max(hits, key=lambda c: len(c[1])), "contains-anchor"
            elif [c for c in cands if c[0] <= NEAREST_M]:
                # Otherwise the biggest thing close by, by vertex count as a crude
                # proxy for "the complicated large one rather than a shophouse".
                near = [c for c in cands if c[0] <= NEAREST_M]
                pick, how = max(near, key=lambda c: len(c[1])), "nearest-large"
            else:
                out[m["id"]] = {"matched": False, "on_water": on_water(reader, m["lat"], m["lon"])}
                print(f"  {m['id']:23s} no usable footprint nearby")
                continue
            d = describe(pick[1])
            d["matched"] = True
            d["match"] = how
            d["anchor_offset_m"] = round(pick[0], 1)
            # Only a long, anchor-containing footprint is allowed to set the
            # model's yaw. Everything else falls back to the bearing recorded in
            # landmarks.json, which says in prose where it came from.
            d["bearing_trusted"] = how == "contains-anchor" and d["elongation"] >= MIN_ELONGATION
            # Checked at the position the model will actually stand at.
            lon_, lat_ = d["centroid"] if how == "contains-anchor" else (m["lon"], m["lat"])
            d["on_water"] = on_water(reader, lat_, lon_)
            out[m["id"]] = d
            print(
                f"  {m['id']:23s} {how:15s} {d['area_m2']:>8.0f} m2  "
                f"{d['length_m']:5.0f} x {d['width_m']:5.0f} m  "
                f"bearing {d['bearing_deg']:5.1f} {'(used)' if d['bearing_trusted'] else '(ignored)'}"
                f"{'  ON WATER' if d['on_water'] else ''}"
            )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
