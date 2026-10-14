"""Points of interest, parks and car parks from OpenStreetMap via the taxonomy."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import geopandas as gpd
import numpy as np
import osmium
import pandas as pd
import shapely
from shapely.geometry import Point

from . import config
from .geo import metric_crs

LEVELS = ("strict", "core", "broad")
KEEP_TAGS = ("amenity", "shop", "healthcare", "leisure", "landuse", "railway", "station", "public_transport",
             "highway", "parking", "access", "operator", "brand", "building", "bus", "train", "subway",
             "light_rail", "cuisine", "network")


@dataclass
class CategoryRule:
    name: str
    rules: list[tuple[int, str, frozenset]]
    exclude: dict[str, frozenset]
    require_any: dict[str, frozenset] | None
    geometry: str
    min_area: dict[str, float] | None


class Taxonomy:
    """Classify OSM tags into categories, recording the narrowest matching variant.

    ``classify`` returns ``{category: level}`` where level 0/1/2 means the
    feature first qualifies under the strict/core/broad variant.
    """

    def __init__(self, cfg: dict | None = None):
        cfg = cfg or config.load("taxonomy")
        self.basket: list[str] = list(cfg["basket"])
        self.supplementary: list[str] = list(cfg.get("supplementary", []))
        self.categories: dict[str, CategoryRule] = {}
        self.meta: dict[str, dict] = {}
        for name, c in cfg["categories"].items():
            rules = []
            for lvl, var in enumerate(LEVELS):
                for k, vals in (c.get(var) or {}).items():
                    rules.append((lvl, k, frozenset(str(v) for v in vals)))
            self.categories[name] = CategoryRule(
                name=name,
                rules=rules,
                exclude={k: frozenset(map(str, v)) for k, v in (c.get("exclude_tag_values") or {}).items()},
                require_any={k: frozenset(map(str, v)) for k, v in c["require_any"].items()} if c.get("require_any") else None,
                geometry=c.get("geometry", "point"),
                min_area=c.get("min_area_m2"),
            )
            self.meta[name] = {k: c.get(k) for k in ("label", "short", "question")}
        self.global_exclude = {k: frozenset(map(str, v)) for k, v in cfg.get("global_exclude", {}).items()}
        self.lifecycle_prefixes = tuple(cfg.get("lifecycle_prefixes", []))
        self.keys = sorted({k for c in self.categories.values() for _, k, _ in c.rules})

    def classify(self, tags) -> dict[str, int]:
        for k, bad in self.global_exclude.items():
            if tags.get(k) in bad:
                return {}
        out: dict[str, int] = {}
        for name, c in self.categories.items():
            lvl = min((lv for lv, k, vals in c.rules if tags.get(k) in vals), default=None)
            if lvl is None:
                continue
            if any(tags.get(k) in bad for k, bad in c.exclude.items()):
                continue
            if c.require_any is not None and not any(tags.get(k) in ok for k, ok in c.require_any.items()):
                continue
            out[name] = lvl
        return out

    def osmium_expressions(self) -> list[str]:
        """``osmium tags-filter`` expressions that keep every candidate feature."""
        exprs = set()
        for c in self.categories.values():
            for _, k, vals in c.rules:
                exprs.add(f"nwr/{k}=" + ",".join(sorted(vals)))
        return sorted(exprs)


def read_features(pbf: Path, taxonomy: Taxonomy) -> gpd.GeoDataFrame:
    """All tagged features matching any category, as points or (multi)polygons."""
    wkb = osmium.geom.WKBFactory()
    rows: list[dict] = []
    fp = osmium.FileProcessor(str(pbf)).with_locations().with_areas()
    for obj in fp:
        tags = obj.tags
        cats = taxonomy.classify(tags)
        if not cats:
            continue
        geom = None
        if obj.is_node():
            if not obj.location.valid():
                continue
            geom = Point(obj.location.lon, obj.location.lat)
            otype, oid = "n", obj.id
        elif obj.is_area():
            try:
                geom = shapely.from_wkb(wkb.create_multipolygon(obj))  # hex WKB is auto-detected
            except RuntimeError:  # osmium raises for invalid/incomplete multipolygons
                continue
            otype = "w" if obj.from_way() else "r"
            oid = obj.orig_id()
        elif obj.is_way():
            if obj.is_closed():
                continue  # handled as an area
            try:
                geom = shapely.from_wkb(wkb.create_linestring(obj))
            except RuntimeError:  # e.g. ways with fewer than two valid locations
                continue
            otype, oid = "w", obj.id
        else:
            continue
        if geom is None or geom.is_empty:
            continue
        row = {"osm_type": otype, "osm_id": int(oid), "name": tags.get("name", ""), "geometry": geom}
        for k in KEEP_TAGS:
            row[k] = tags.get(k)
        for name, lvl in cats.items():
            row[f"lvl_{name}"] = lvl
        rows.append(row)
    gdf = gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")
    for name in taxonomy.categories:
        col = f"lvl_{name}"
        if col not in gdf:
            gdf[col] = np.nan
        gdf[col] = gdf[col].fillna(-1).astype(np.int8)
    metric = gdf.to_crs(metric_crs())
    is_poly = metric.geom_type.isin(["Polygon", "MultiPolygon"])
    gdf["area_m2"] = np.where(is_poly, metric.area, 0.0)
    rep = metric.geometry.representative_point().to_crs("EPSG:4326")
    gdf["lon"] = rep.x
    gdf["lat"] = rep.y
    gdf["feature_id"] = gdf["osm_type"] + gdf["osm_id"].astype(str)
    return gdf.drop_duplicates("feature_id").reset_index(drop=True)


def access_points(gdf: gpd.GeoDataFrame, boundary_step_m: float = 40.0, min_poly_area_m2: float = 2000.0,
                  max_points: int = 300) -> pd.DataFrame:
    """Points through which a destination is reached.

    Small features use their representative point. Large polygons (parks,
    campuses, hospitals) are reached via points spaced along their boundary,
    because entrances are rarely mapped and a centroid can sit hundreds of
    metres inside a park.
    """
    from .geo import to_lonlat

    metric = gdf.to_crs(metric_crs())
    out_idx, out_xy = [], []
    for i, (geom, area) in enumerate(zip(metric.geometry.values, gdf["area_m2"].to_numpy())):
        if geom.geom_type in ("Polygon", "MultiPolygon") and area >= min_poly_area_m2:
            xy = boundary_points(geom, boundary_step_m, max_points)
        else:
            p = geom if geom.geom_type == "Point" else geom.representative_point()
            xy = np.array([[p.x, p.y]])
        out_idx.append(np.full(len(xy), i, dtype=np.int64))
        out_xy.append(xy)
    idx = np.concatenate(out_idx)
    xy = np.vstack(out_xy)
    lon, lat = to_lonlat(xy[:, 0], xy[:, 1])
    return pd.DataFrame({"feature": idx, "lon": lon, "lat": lat})


def boundary_points(geom, step_m: float, max_points: int) -> np.ndarray:
    """Evenly spaced points along the exterior ring(s) of a projected (multi)polygon."""
    rings = [g.exterior for g in getattr(geom, "geoms", [geom])]
    total = sum(r.length for r in rings)
    budget = int(min(max(total // step_m, 4), max_points))
    pts = []
    for r in rings:
        n = max(1, int(round(budget * r.length / total))) if total > 0 else 1
        d = np.linspace(0.0, r.length, n, endpoint=False)
        pts.append(shapely.get_coordinates(shapely.line_interpolate_point(r, d)))
    return np.vstack(pts)
