"""Small geodesy helpers shared by the pipeline."""

from __future__ import annotations

from functools import lru_cache

import numpy as np
from pyproj import Transformer

from . import config

EARTH_RADIUS_M = 6_371_008.8


def haversine_m(lon1, lat1, lon2, lat2) -> np.ndarray:
    """Great-circle distance in metres (vectorised over numpy arrays)."""
    lon1, lat1, lon2, lat2 = (np.radians(np.asarray(a, dtype=np.float64)) for a in (lon1, lat1, lon2, lat2))
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = np.sin(dlat / 2.0) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2.0) ** 2
    return 2.0 * EARTH_RADIUS_M * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))


@lru_cache(maxsize=4)
def _transformer(src: str, dst: str) -> Transformer:
    return Transformer.from_crs(src, dst, always_xy=True)


def metric_crs() -> str:
    return config.load("study_area")["crs_metric"]


def to_metric(lon, lat) -> tuple[np.ndarray, np.ndarray]:
    """Project WGS84 lon/lat to the project's metric CRS (UTM 48N)."""
    t = _transformer("EPSG:4326", metric_crs())
    x, y = t.transform(np.asarray(lon, dtype=np.float64), np.asarray(lat, dtype=np.float64))
    return np.asarray(x), np.asarray(y)


def to_lonlat(x, y) -> tuple[np.ndarray, np.ndarray]:
    t = _transformer(metric_crs(), "EPSG:4326")
    lon, lat = t.transform(np.asarray(x, dtype=np.float64), np.asarray(y, dtype=np.float64))
    return np.asarray(lon), np.asarray(lat)


def polyline_length_m(lons: np.ndarray, lats: np.ndarray) -> float:
    if len(lons) < 2:
        return 0.0
    return float(haversine_m(lons[:-1], lats[:-1], lons[1:], lats[1:]).sum())
