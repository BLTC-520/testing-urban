"""Export static artifacts for the web app into web/public/data/.

Files
  meta.json                     parameters, categories, cities, sources, provenance digest
  summary.json                  all statistics (see summary.py)
  cells_{city}.bin              per-cell population + core distances (loaded up front)
  cells_{city}_variants.bin     strict/broad taxonomy, strict network, Overture POIs (lazy)
  cells_{city}_scenario.bin     Parking-to-Proximity distances for 10/25/50 sites (lazy)
  crossborder_jb.bin            Johor Bahru access times to the border hubs (lazy)
  pois_{city}.bin + .json       destinations with their network snap (identical routing in browser)
  neighbourhoods.geojson        simplified unit polygons + key statistics
  parking_sites.geojson         sites chosen by the scenario, in selection order
  graph/index.json + t_*.bin    street-graph tiles for in-browser isochrones
"""

from __future__ import annotations

import json
import shutil
import struct
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely

from . import boundaries, config
from .export import Col, quantize, write_json, write_table
from .features import LEVELS, Taxonomy, access_points
from .geo import to_metric
from .graph import EdgeSnapper, Network

OUT = config.WEB_DATA_DIR
U16_NA = 65535


def _dist_col(v: np.ndarray) -> Col:
    return Col(quantize(v, "uint16", 1.0, U16_NA), "uint16", scale=1.0, nodata=U16_NA)


def export_meta() -> None:
    tax = config.load("taxonomy")
    sc = config.load("scenarios")
    sa = config.load("study_area")
    prov = json.loads((config.DATA_DIR / "provenance.json").read_text())
    cats = []
    for k, c in tax["categories"].items():
        # tag values per nested variant (strict ⊂ core ⊂ broad), for the "what counts" lists
        includes = {v: [f"{key}={val}" for key, vals in (c.get(v) or {}).items() for val in vals]
                    for v in ("strict", "core", "broad")}
        cats.append({"id": k, "label": c.get("label"), "short": c.get("short"), "question": c.get("question"),
                     "basket": k in tax["basket"], "includes": includes,
                     "min_area_m2": c.get("min_area_m2")})
    hubs = json.loads(config.derived("hubs.json").read_text()) if config.derived("hubs.json").exists() else {}
    meta = {
        "title": "Singapore / Johor Bahru 15-Minute City Explorer",
        "version": "1.0.0",
        "generated_utc": pd.Timestamp.utcnow().isoformat(timespec="seconds"),
        "osm_snapshot": "2026-10-05",
        "basket": tax["basket"],
        "categories": cats,
        "taxonomy_version": tax["version"],
        "accessibility": sc["accessibility"],
        "crossborder": sc["crossborder"],
        "parking_to_proximity": sc["parking_to_proximity"],
        "sensitivity": sc["sensitivity"],
        "h3_resolution": sa["h3_resolution"],
        "cities": {
            "sg": {"name": "Singapore", "center": [103.82, 1.355], "zoom": 10.6,
                   "population_definition": "Residents (citizens and PRs), Census of Population 2020, by subzone"},
            "jb": {"name": "Johor Bahru", "center": [103.72, 1.52], "zoom": 10.2,
                   "population_definition": "All persons, Population and Housing Census of Malaysia 2020, by state constituency"},
        },
        "hubs": hubs,
        "sources": config.load("sources")["sources"],
        "provenance": {sid: [{"file": k, "sha256": v["sha256"][:16], "retrieved_utc": v["retrieved_utc"]}
                             for k, v in files.items()] for sid, files in prov.items()},
    }
    write_json(OUT / "meta.json", meta)


def export_cells(nb_index: dict[str, int]) -> None:
    acc = pd.read_parquet(config.interim("access.parquet"))
    tax = Taxonomy()
    basket = tax.basket
    ov = pd.read_parquet(config.interim("access_overture.parquet")) if config.interim("access_overture.parquet").exists() else None
    sp = pd.read_parquet(config.interim("scenario_parking.parquet")) if config.interim("scenario_parking.parquet").exists() else None
    p2p_ns = config.load("scenarios")["parking_to_proximity"]["sites_per_city"]
    for city in ("sg", "jb"):
        df = acc[acc["city"] == city].reset_index(drop=True)
        h3 = df["h3"].to_numpy().astype(np.uint64)
        cols = {
            "h3": Col(h3, "biguint64"),
            "pop": Col(df["pop"].to_numpy(), "float32"),
            "elderly": Col(df["elderly"].to_numpy(), "float32"),
            "unit": Col(df["unit_id"].map(nb_index).fillna(U16_NA).to_numpy(), "uint16"),
        }
        for k in basket + ["rapid_transit", "civic"]:
            cols[f"d_{k}"] = _dist_col(df[f"d_{k}"].to_numpy())
        write_table(OUT / f"cells_{city}.bin", cols, meta={"city": city, "unit": "metres"})

        var = {"h3": Col(h3, "biguint64"), "pop_kontur": Col(df["pop_kontur"].to_numpy(), "float32")}
        for k in basket:
            var[f"n15_{k}"] = Col(np.minimum(df[f"n15_{k}"].to_numpy(), U16_NA - 1), "uint16")
        for k in basket:
            for v in ("strict", "broad", "netstrict"):
                var[f"d_{k}__{v}"] = _dist_col(df[f"d_{k}__{v}"].to_numpy())
        if ov is not None:
            o = df[["h3"]].merge(ov, on="h3", how="left")
            for c in o.columns:
                if c.endswith("__overture"):
                    var[c] = _dist_col(o[c].to_numpy())
        write_table(OUT / f"cells_{city}_variants.bin", var, meta={"city": city})

        if sp is not None:
            s = df[["h3"]].merge(sp, on="h3", how="left")
            scn = {"h3": Col(h3, "biguint64")}
            for n in p2p_ns:
                for k in basket:
                    scn[f"d_{k}__p2p{n}"] = _dist_col(s[f"d_{k}__p2p{n}"].to_numpy())
            write_table(OUT / f"cells_{city}_scenario.bin", scn, meta={"city": city})


def export_crossborder() -> None:
    p = config.interim("crossborder.parquet")
    if not p.exists():
        return
    cb = pd.read_parquet(p)
    cols = {"h3": Col(cb["h3"].to_numpy().astype(np.uint64), "biguint64")}
    for c in cb.columns:
        if c.startswith("t_") or c in ("av_walk_to_pickup_min", "av_ride_min"):
            cols[c] = Col(quantize(cb[c].to_numpy(), "uint16", 0.1, U16_NA), "uint16", scale=0.1, nodata=U16_NA)
    cols["av_served"] = Col(cb["av_served"].to_numpy().astype(np.uint8), "uint8")
    write_table(OUT / "crossborder_jb.bin", cols, meta={"unit": "minutes"})


def export_pois(walk: Network, cells: pd.DataFrame) -> None:
    """Destinations (core variant) with access-point snaps for in-browser routing."""
    from .accessibility import select_destinations
    from .form import assign_city

    feats = gpd.read_parquet(config.interim("features.parquet"))
    tax = Taxonomy()
    cats = tax.basket + ["rapid_transit", "civic"]
    parts = []
    for i, cat in enumerate(cats):
        sel = select_destinations(feats, tax, cat, "core")
        parts.append(pd.DataFrame({"fidx": sel.index.to_numpy(), "bit": 1 << i}))
    allp = pd.concat(parts).groupby("fidx")["bit"].sum()
    sel = feats.loc[allp.index].copy()
    sel["mask"] = allp.to_numpy()
    sel["city"] = assign_city(sel["lon"].to_numpy(), sel["lat"].to_numpy(), cells)
    snapper = EdgeSnapper(walk)
    for city in ("sg", "jb"):
        f = sel[sel["city"] == city].reset_index(drop=True)
        ap = access_points(f)
        sn = snapper.snap(ap["lon"].to_numpy(), ap["lat"].to_numpy())
        write_table(OUT / f"pois_{city}.bin", {
            "lon": Col(f["lon"].to_numpy(), "float32"),
            "lat": Col(f["lat"].to_numpy(), "float32"),
            "mask": Col(f["mask"].to_numpy(), "uint16"),
            "area_ha": Col(f["area_m2"].to_numpy() / 1e4, "float32"),
        }, meta={"categories": cats})
        write_table(OUT / f"poi_access_{city}.bin", {
            "poi": Col(ap["feature"].to_numpy(), "uint32"),
            # graph node indices — the same ids used in the street-graph tiles
            "u": Col(sn["u"].to_numpy(), "uint32"),
            "v": Col(sn["v"].to_numpy(), "uint32"),
            "off_u": Col(sn["off_u"].to_numpy(), "float32"),
            "off_v": Col(sn["off_v"].to_numpy(), "float32"),
            "snap_m": Col(sn["snap_m"].to_numpy(), "float32"),
        })
        names = [n if isinstance(n, str) else "" for n in f["name"].tolist()]
        kinds = [(f.loc[j, "amenity"] or f.loc[j, "shop"] or f.loc[j, "leisure"] or f.loc[j, "railway"]
                  or f.loc[j, "highway"] or f.loc[j, "healthcare"] or "") for j in range(len(f))]
        write_json(OUT / f"pois_{city}.json", {"names": names, "kinds": [k if isinstance(k, str) else "" for k in kinds]})


def export_neighbourhoods(nb_stats: pd.DataFrame) -> dict[str, int]:
    nb = boundaries.neighbourhoods()
    nb["geometry"] = nb.to_crs(config.load("study_area")["crs_metric"]).geometry.simplify(25).to_crs("EPSG:4326")
    stats = nb_stats.drop(columns=[c for c in ("unit_name", "area_km2", "city") if c in nb_stats.columns])
    nb = nb.merge(stats, on="unit_id", how="left")
    nb["idx"] = np.arange(len(nb))
    for c in nb.columns:
        if nb[c].dtype.kind == "f":
            nb[c] = nb[c].round(4)
    (OUT / "neighbourhoods.geojson").write_text(nb.to_json(drop_id=True))
    export_study_mask(nb)
    return dict(zip(nb["unit_id"], nb["idx"]))


def export_study_mask(nb: gpd.GeoDataFrame) -> None:
    """Everything outside the two study areas, so the map can dim the context
    (and the edges of the data extract) without hiding it."""
    metric = config.load("study_area")["crs_metric"]
    area = nb.to_crs(metric).geometry.buffer(400).union_all().buffer(-200).simplify(80)
    area = gpd.GeoSeries([area], crs=metric).to_crs("EPSG:4326").iloc[0]
    world = shapely.box(100.0, -1.0, 108.0, 4.0)
    mask = gpd.GeoDataFrame({"kind": ["outside"]}, geometry=[world.difference(area)], crs="EPSG:4326")
    (OUT / "study_mask.geojson").write_text(mask.to_json(drop_id=True))


def export_parking_sites() -> None:
    p = config.derived("parking_sites.csv")
    if not p.exists():
        return
    s = pd.read_csv(p)
    feats = gpd.read_parquet(config.interim("features.parquet"))
    geo = feats.set_index("feature_id").loc[s["feature_id"], "geometry"].to_numpy()
    g = gpd.GeoDataFrame(s, geometry=geo, crs="EPSG:4326")
    g["geometry"] = g.to_crs(config.load("study_area")["crs_metric"]).geometry.simplify(2).to_crs("EPSG:4326")
    (OUT / "parking_sites.geojson").write_text(g.to_json(drop_id=True))


def _rdp(x: np.ndarray, y: np.ndarray, tol: float) -> np.ndarray:
    """Douglas–Peucker keep-mask (endpoints always kept)."""
    keep = np.zeros(len(x), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(x) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        dx, dy = x[b] - x[a], y[b] - y[a]
        L = np.hypot(dx, dy)
        seg_x, seg_y = x[a + 1:b] - x[a], y[a + 1:b] - y[a]
        d = np.abs(seg_x * dy - seg_y * dx) / L if L > 0 else np.hypot(seg_x, seg_y)
        k = int(np.argmax(d))
        if d[k] > tol:
            m = a + 1 + k
            keep[m] = True
            stack += [(a, m), (m, b)]
    return keep


def export_graph_tiles(walk: Network, tile_deg: float = 0.02, simplify_m: float = 2.5) -> dict:
    """Spatially tiled street graph for in-browser routing.

    Edge (u, v) is stored in the tile containing u. Any node within network
    distance R of a point lies within straight-line distance R, so loading all
    tiles that intersect the radius-R disc yields an exact search to R.

    Tile binary ("SGJG"): u32 nNodes, u32 nEdges, f64 lon0, f64 lat0, then
      nodes:  u32 id | u16 x | u16 y          (micro-degrees from the tile origin)
      edges:  u32 u | u32 v | f32 length_m | u16 nPts   (struct of arrays)
      points: i16 dx, i16 dy per point, delta-encoded from u (last point = v)
    """
    gdir = OUT / "graph"
    if gdir.exists():
        shutil.rmtree(gdir)
    gdir.mkdir(parents=True)
    bbox = config.load("study_area")["acquisition_bbox"]
    lon0, lat0 = bbox[0], bbox[1]
    tx = np.floor((walk.lon - lon0) / tile_deg).astype(np.int64)
    ty = np.floor((walk.lat - lat0) / tile_deg).astype(np.int64)
    gx, gy = to_metric(walk.geom_lon, walk.geom_lat)
    index = {"tile_deg": tile_deg, "origin": [lon0, lat0], "tiles": {}}
    etile = tx[walk.edge_u] * 100000 + ty[walk.edge_u]
    ntile = tx * 100000 + ty
    order_e = np.argsort(etile, kind="stable")
    order_n = np.argsort(ntile, kind="stable")
    e_keys, e_start = np.unique(etile[order_e], return_index=True)
    n_keys, n_start = np.unique(ntile[order_n], return_index=True)
    e_ranges = dict(zip(e_keys, zip(e_start, np.append(e_start[1:], len(order_e)))))
    n_ranges = dict(zip(n_keys, zip(n_start, np.append(n_start[1:], len(order_n)))))
    total = 0
    for key in sorted(set(n_keys) | set(e_keys)):
        kx, ky = divmod(int(key), 100000)
        olon, olat = lon0 + kx * tile_deg, lat0 + ky * tile_deg
        ns = order_n[slice(*n_ranges[key])] if key in n_ranges else np.array([], np.int64)
        es = order_e[slice(*e_ranges[key])] if key in e_ranges else np.array([], np.int64)
        nx = np.clip(np.rint((walk.lon[ns] - olon) * 1e6), 0, 65535).astype("<u2")
        ny = np.clip(np.rint((walk.lat[ns] - olat) * 1e6), 0, 65535).astype("<u2")
        pts_dx, pts_dy, npts = [], [], []
        for e in es:
            s, t = walk.geom_ptr[e], walk.geom_ptr[e + 1]
            keep = _rdp(gx[s:t], gy[s:t], simplify_m)
            lo = walk.geom_lon[s:t][keep]
            la = walk.geom_lat[s:t][keep]
            q_lo = np.rint(lo * 1e6).astype(np.int64)
            q_la = np.rint(la * 1e6).astype(np.int64)
            dx = np.diff(q_lo)
            dy = np.diff(q_la)
            # split very long jumps so deltas fit in int16
            if len(dx) and (np.abs(dx).max() > 32767 or np.abs(dy).max() > 32767):
                n_sub = int(np.ceil(max(np.abs(dx).max(), np.abs(dy).max()) / 32767))
                dx = np.repeat(dx / n_sub, n_sub).round().astype(np.int64)
                dy = np.repeat(dy / n_sub, n_sub).round().astype(np.int64)
            pts_dx.append(dx)
            pts_dy.append(dy)
            npts.append(len(dx))
        pdx = np.concatenate(pts_dx).astype("<i2") if pts_dx else np.array([], "<i2")
        pdy = np.concatenate(pts_dy).astype("<i2") if pts_dy else np.array([], "<i2")
        head = b"SGJG" + struct.pack("<IIIdd", len(ns), len(es), int(len(pdx)), olon, olat)
        body = (ns.astype("<u4").tobytes() + nx.tobytes() + ny.tobytes()
                + walk.edge_u[es].astype("<u4").tobytes() + walk.edge_v[es].astype("<u4").tobytes()
                + walk.edge_len[es].astype("<f4").tobytes() + np.array(npts, "<u2").tobytes()
                + pdx.tobytes() + pdy.tobytes())
        name = f"t_{kx}_{ky}.bin"
        (gdir / name).write_bytes(head + body)
        total += len(head) + len(body)
        index["tiles"][f"{kx}_{ky}"] = {"nodes": int(len(ns)), "edges": int(len(es)), "bytes": len(head) + len(body)}
    index["total_bytes"] = total
    index["nodes"] = walk.n_nodes
    write_json(gdir / "index.json", index)
    return index


def export_all() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    walk = Network.load(config.interim("walk.npz"))
    cells = pd.read_parquet(config.interim("cells.parquet"))
    nb_stats = pd.read_csv(config.derived("neighbourhoods.csv"))
    idx = export_neighbourhoods(nb_stats)
    export_meta()
    export_cells(idx)
    export_crossborder()
    export_pois(walk, cells)
    export_parking_sites()
    shutil.copy(config.derived("summary.json"), OUT / "summary.json")
    gi = export_graph_tiles(walk)
    sizes = {p.name: p.stat().st_size for p in OUT.glob("*") if p.is_file()}
    print({k: f"{v / 1e6:.2f} MB" for k, v in sorted(sizes.items())}, f"graph tiles: {gi['total_bytes'] / 1e6:.1f} MB "
          f"in {len(gi['tiles'])} tiles")
