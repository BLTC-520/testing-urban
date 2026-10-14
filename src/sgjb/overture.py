"""Overture Maps Places — an independent POI source used to audit OpenStreetMap."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pyarrow.dataset as ds
import pyarrow.fs as pafs
import pyarrow.parquet as pq
import pyarrow.compute as pc
import shapely

from . import config

COLUMNS = ["id", "names", "taxonomy", "basic_category", "confidence", "operating_status", "geometry", "bbox"]


def fetch(proxy: str | None = None):
    """Download places inside the acquisition bbox (bbox-filtered GeoParquet scan)."""
    tax = config.load("taxonomy")["overture"]
    bbox = config.load("study_area")["acquisition_bbox"]
    dest = config.raw("overture", f"places_sgjb_{tax['release']}.parquet")
    if dest.exists():
        return dest
    fs = pafs.S3FileSystem(anonymous=True, region="us-west-2", proxy_options=proxy, request_timeout=300)
    d = ds.dataset(f"overturemaps-us-west-2/release/{tax['release']}/theme=places/type=place", filesystem=fs, format="parquet")
    x0, y0, x1, y1 = bbox
    f = ((pc.field("bbox", "xmin") >= x0) & (pc.field("bbox", "xmax") <= x1)
         & (pc.field("bbox", "ymin") >= y0) & (pc.field("bbox", "ymax") <= y1))
    dest.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(d.to_table(filter=f, columns=COLUMNS), dest, compression="zstd")
    return dest


def load_classified() -> pd.DataFrame:
    tax = config.load("taxonomy")["overture"]
    path = config.raw("overture", f"places_sgjb_{tax['release']}.parquet")
    t = pq.read_table(path, columns=["id", "names", "taxonomy", "basic_category", "confidence", "operating_status", "geometry"])
    df = t.to_pandas()
    df = df[(df["confidence"] >= tax["min_confidence"]) & (df["operating_status"].fillna("open") == "open")]
    df["primary"] = df["taxonomy"].apply(lambda x: x["primary"] if x is not None else None)
    df["name"] = df["names"].apply(lambda x: (x or {}).get("primary") or "")
    pts = shapely.from_wkb(df["geometry"].to_numpy())
    df["lon"] = shapely.get_x(pts)
    df["lat"] = shapely.get_y(pts)
    df["category"] = None
    for cat, rule in tax["categories"].items():
        m = df["primary"].isin(rule.get("primary", [])) | df["basic_category"].isin(rule.get("basic", []))
        df.loc[m & df["category"].isna(), "category"] = cat
    return df[df["category"].notna()][["id", "name", "primary", "basic_category", "confidence", "category", "lon", "lat"]].reset_index(drop=True)
