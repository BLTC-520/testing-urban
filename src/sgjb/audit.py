"""Data-quality audit: how far can each input be trusted, and is it equally good on both sides?

* Transit stops   — OSM bus stops vs official stop lists (LTA for Singapore,
                    myBAS GTFS for Johor Bahru): recall within 30 m.
* Rail stations   — OSM stations vs LTA's station layer (Singapore).
* POIs            — OSM vs Overture Places per category: density and
                    two-way spatial agreement within 100 m.
* Population      — gridded models vs census counts per census unit.

An accessibility gap between the cities only counts as a finding if it
survives these checks (see sensitivity.py and the POI-source run).
"""

from __future__ import annotations

import geopandas as gpd
import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

from . import config
from .geo import to_metric
from .transit import read_gtfs


def _match_rate(ax, ay, bx, by, radius: float) -> float:
    if not len(ax) or not len(bx):
        return float("nan")
    d, _ = cKDTree(np.column_stack([bx, by])).query(np.column_stack([ax, ay]))
    return float((d <= radius).mean())


def bus_stop_audit(features: gpd.GeoDataFrame, city_of) -> pd.DataFrame:
    osm = features[(features["highway"] == "bus_stop") | (features["amenity"] == "bus_station")]
    ox, oy = to_metric(osm["lon"].to_numpy(), osm["lat"].to_numpy())
    ocity = city_of(osm["lon"].to_numpy(), osm["lat"].to_numpy())
    import json
    stops = json.loads(config.raw("sg_bus", "stops.json").read_text())
    sg = pd.DataFrame([(k, v[0], v[1]) for k, v in stops.items()], columns=["id", "lon", "lat"])
    g = read_gtfs(config.raw("gtfs", "gtfs_mybas.zip"))["stops"]
    jb = pd.DataFrame({"id": g["stop_id"], "lon": g["stop_lon"].astype(float), "lat": g["stop_lat"].astype(float)})
    rows = []
    for city, off, label in (("sg", sg, "LTA DataMall bus stops"), ("jb", jb, "myBAS Johor GTFS stops")):
        oc = city_of(off["lon"].to_numpy(), off["lat"].to_numpy()) == city
        off = off[oc]
        fx, fy = to_metric(off["lon"].to_numpy(), off["lat"].to_numpy())
        m = ocity == city
        rows.append({
            "city": city, "official_source": label, "official_stops": int(len(off)), "osm_stops": int(m.sum()),
            "recall_30m": _match_rate(fx, fy, ox[m], oy[m], 30.0),
            "recall_60m": _match_rate(fx, fy, ox[m], oy[m], 60.0),
            "osm_confirmed_30m": _match_rate(ox[m], oy[m], fx, fy, 30.0),
        })
    return pd.DataFrame(rows)


def rail_station_audit(features: gpd.GeoDataFrame, city_of) -> pd.DataFrame:
    """OSM station objects vs LTA station footprints. The LTA layer also holds
    depots and substations, and interchanges are split into one polygon per
    line, so passenger stations are kept by name and dissolved; a station is
    matched when an OSM station lies within the radius of its footprint."""
    from .boundaries import sg_rail_stations_lta
    from .geo import metric_crs

    lta = sg_rail_stations_lta()
    lta = lta[lta.geometry.notna() & ~lta.geometry.is_empty].copy()
    lta["name"] = lta["STN_NAM_DE"].fillna("").str.upper().str.strip()
    lta = lta[lta["name"].str.contains(r"\b(?:MRT|LRT) STATION$", regex=True)]
    stations = lta.dissolve(by="name").to_crs(metric_crs())
    osm = features[(features["lvl_rapid_transit"] >= 0) & (features["railway"].isin(["station", "halt"]))]
    osm = osm[city_of(osm["lon"].to_numpy(), osm["lat"].to_numpy()) == "sg"]
    ox, oy = to_metric(osm["lon"].to_numpy(), osm["lat"].to_numpy())
    pts = gpd.GeoSeries(gpd.points_from_xy(ox, oy), crs=metric_crs())
    if len(pts):
        tree = pts.sindex
        _, dist = tree.nearest(stations.geometry, return_distance=True, return_all=False)
    else:
        dist = np.full(len(stations), np.inf)
    return pd.DataFrame([{
        "city": "sg", "official_source": "LTA Rapid Transit System Station layer (Apr 2025)",
        "official_stations": int(len(stations)), "osm_stations": int(len(osm)),
        "recall_200m": float((dist <= 200.0).mean()), "recall_400m": float((dist <= 400.0).mean()),
    }])


def poi_cross_source(features: gpd.GeoDataFrame, ov: pd.DataFrame, cells: pd.DataFrame, city_of) -> pd.DataFrame:
    from .accessibility import select_destinations
    from .features import Taxonomy

    tax = Taxonomy()
    ov = ov.copy()
    ov["city"] = city_of(ov["lon"].to_numpy(), ov["lat"].to_numpy())
    rows = []
    for cat in config.load("taxonomy")["overture"]["categories"]:
        osm = select_destinations(features, tax, cat, "core")
        ocity = city_of(osm["lon"].to_numpy(), osm["lat"].to_numpy())
        for city in ("sg", "jb"):
            residents = cells.loc[cells["city"] == city, "pop"].sum()
            o = osm[ocity == city]
            v = ov[(ov["city"] == city) & (ov["category"] == cat)]
            ox, oy = to_metric(o["lon"].to_numpy(), o["lat"].to_numpy())
            vx, vy = to_metric(v["lon"].to_numpy(), v["lat"].to_numpy())
            rows.append({
                "city": city, "category": cat, "osm_count": int(len(o)), "overture_count": int(len(v)),
                "osm_per_10k": len(o) / residents * 1e4, "overture_per_10k": len(v) / residents * 1e4,
                "osm_found_in_overture_100m": _match_rate(ox, oy, vx, vy, 100.0),
                "overture_found_in_osm_100m": _match_rate(vx, vy, ox, oy, 100.0),
            })
    return pd.DataFrame(rows)


def population_audit(rep: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for city in ("sg", "jb"):
        r = rep[(rep["city"] == city) & (rep["census_pop"] > 500)]
        for model, col in (("HRSL (Meta/CIESIN)", "hrsl_pop"), ("Kontur", "kontur_pop")):
            m = r[col].fillna(0)
            ratio = (m / r["census_pop"]).replace([np.inf, -np.inf], np.nan)
            rows.append({
                "city": city, "model": model, "units": int(len(r)),
                "unit": "subzone" if city == "sg" else "state constituency",
                "model_total": float(m.sum()), "census_total": float(r["census_pop"].sum()),
                "log_correlation": float(np.corrcoef(np.log1p(m), np.log1p(r["census_pop"]))[0, 1]),
                "median_ratio": float(ratio.median()),
                "share_units_within_25pct": float(((ratio > 0.75) & (ratio < 1.25)).mean()),
            })
    return pd.DataFrame(rows)
