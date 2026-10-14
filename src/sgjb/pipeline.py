"""End-to-end pipeline. Each stage reads the previous stage's files, so stages
can be re-run independently:

    python -m sgjb.pipeline all          # everything after `python -m sgjb.acquire`
    python -m sgjb.pipeline networks     # one stage

Stages: prefilter → networks → features → population → access → form → scenarios → summary → export → basemap
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

from . import config

def OSM() -> Path:  # noqa: N802
    """Regional OSM extract (override with SGJB_OSM, e.g. for a development extract)."""
    import os

    return Path(os.environ.get("SGJB_OSM", config.raw("osm", "sgjb-261005.osm.pbf")))


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# --------------------------------------------------------------------------- stages
def stage_prefilter() -> None:
    from .features import Taxonomy
    from .osm import tags_filter

    src = OSM()
    tags_filter(src, config.interim("highways.osm.pbf"), ["w/highway"])
    tags_filter(src, config.interim("features.osm.pbf"), Taxonomy().osmium_expressions())
    tags_filter(src, config.interim("basemap.osm.pbf"),
                ["w/building", "r/building", "w/railway=rail,subway,light_rail,monorail,construction,narrow_gauge",
                 "n/place=city,town,suburb,neighbourhood,quarter,village", "r/boundary=administrative",
                  "w/boundary=administrative"])
    log("prefilter done")


def stage_networks() -> None:
    from .osm import build_drive_network, build_walk_network, read_highway_ways

    wt = read_highway_ways(config.interim("highways.osm.pbf"))
    log(f"read {len(wt.way_id):,} highway way runs")
    walk = build_walk_network(wt)
    walk.save(config.interim("walk.npz"))
    log(f"walk network: {walk.n_nodes:,} nodes, {walk.n_edges:,} edges, {walk.edge_len.sum() / 1000:,.0f} km")
    strict = walk.subset_edges(walk.edge_attrs["strict_ok"]).drop_small_components(
        config.load("network")["walk"]["min_component_nodes"])
    strict.save(config.interim("walk_strict.npz"))
    log(f"strict walk network: {strict.n_edges:,} edges")
    factor = config.load("scenarios")["crossborder"]["av_feeder"]["peak_speed_factor"]
    drive = build_drive_network(wt, peak_speed_factor=factor)
    drive.save(config.interim("drive.npz"))
    log(f"drive network: {drive.n_nodes:,} nodes, {drive.n_edges:,} edges")


def stage_features() -> None:
    from .features import Taxonomy, read_features

    gdf = read_features(config.interim("features.osm.pbf"), Taxonomy())
    gdf.to_parquet(config.interim("features.parquet"))
    counts = {c[4:]: int((gdf[c] >= 0).sum()) for c in gdf.columns if c.startswith("lvl_")}
    log(f"features: {len(gdf):,} rows; by category (any variant): {counts}")


def stage_population() -> None:
    from .population import main as pop_main

    pop_main()


def _load_core():
    from .graph import Network

    walk = Network.load(config.interim("walk.npz"))
    cells = pd.read_parquet(config.interim("cells.parquet"))
    feats = gpd.read_parquet(config.interim("features.parquet"))
    return walk, cells, feats


def stage_access() -> None:
    from .accessibility import run
    from .graph import Network

    walk, cells, feats = _load_core()
    strict = Network.load(config.interim("walk_strict.npz"))
    acc = run(walk, cells, feats, strict_net=strict)
    acc.to_parquet(config.interim("access.parquet"), index=False)
    log(f"access table: {len(acc):,} cells × {acc.shape[1]} columns")


def stage_access_overture() -> None:
    """POI-source sensitivity: groceries/healthcare/education/dining from Overture Places."""
    from .accessibility import AccessibilityModel
    from .overture import load_classified

    walk, cells, feats = _load_core()
    model = AccessibilityModel(walk, cells, feats)
    ov = load_classified()
    out = pd.DataFrame({"h3": cells["h3"]})
    empty = feats.iloc[0:0]
    for cat in ov["category"].unique():
        pts = ov.loc[ov["category"] == cat, ["lon", "lat"]]
        model.features = empty.assign(**{f"lvl_{cat}": pd.Series(dtype="int8")})
        d, _ = model.nearest(cat, "core", extra_points=pts)
        out[f"d_{cat}__overture"] = d.astype(np.float32)
    model.features = feats
    out.to_parquet(config.interim("access_overture.parquet"), index=False)
    log("overture access done")


def stage_form() -> None:
    from .form import network_form, parking_form, shed_and_circuity
    from .graph import EdgeSnapper

    walk, cells, feats = _load_core()
    nf = network_form(walk, cells)
    pf = parking_form(feats, cells)
    snaps = EdgeSnapper(walk).snap(cells["lon"].to_numpy(), cells["lat"].to_numpy())
    on = (snaps["snap_m"] <= config.load("network")["snapping"]["max_snap_m"]).to_numpy()
    sc = shed_and_circuity(walk, cells, snaps, on)
    form = nf.merge(pf, on="city").merge(sc, on="city")
    form.to_csv(config.derived("urban_form.csv"), index=False)
    log("urban form:\n" + form.T.to_string())


def stage_scenarios() -> None:
    from .crossborder import AccessModel, cell_times, feeder_times
    from .form import assign_city
    from .graph import EdgeSnapper, Network
    from .parking import ParkingScenario, candidate_sites, scenario_distances
    from .transit import patterns_in_window, read_gtfs

    walk, cells, feats = _load_core()
    acc = pd.read_parquet(config.interim("access.parquet"))
    tax_basket = config.load("taxonomy")["basket"]
    snapper = EdgeSnapper(walk)
    cell_snaps = snapper.snap(cells["lon"].to_numpy(), cells["lat"].to_numpy())
    on = acc["on_network"].to_numpy()
    p2p = config.load("scenarios")["parking_to_proximity"]
    n_max = max(p2p["sites_per_city"])

    # ---- Scenario 2: parking to proximity (per city)
    city_of = lambda lon, lat: assign_city(lon, lat, cells)  # noqa: E731
    sites = candidate_sites(feats, cells, city_of)
    log(f"parking candidates: {sites.groupby('city').size().to_dict()}")
    results = {}
    for city in ("sg", "jb"):
        m = (cells["city"] == city).to_numpy()
        sub_cells = cells[m].reset_index(drop=True)
        d_basket = {k: acc.loc[m, f"d_{k}"].to_numpy(np.float64) for k in tax_basket}
        sc = ParkingScenario(walk, snapper, sub_cells, cell_snaps[m].reset_index(drop=True), on[m], d_basket)
        res = sc.run(sites[sites["city"] == city], n_max)
        out = {"sites": res["sites"]}
        for n in p2p["sites_per_city"]:
            out[n] = scenario_distances(res["covers"], d_basket, tax_basket, n)
        results[city] = out
        log(f"parking scenario {city}: {len(res['sites'])} sites chosen; "
            f"newly complete with {n_max}: {res['sites']['newly_complete'].sum():,.0f}")
    sites_all = pd.concat([results[c]["sites"] for c in ("sg", "jb")], ignore_index=True)
    sites_all.to_csv(config.derived("parking_sites.csv"), index=False)
    cols = {"h3": cells["h3"].to_numpy()}
    for n in p2p["sites_per_city"]:
        for k in tax_basket:
            v = np.full(len(cells), np.nan)
            for city in ("sg", "jb"):
                m = (cells["city"] == city).to_numpy()
                v[m] = results[city][n][k]
            cols[f"d_{k}__p2p{n}"] = v.astype(np.float32)
    pd.DataFrame(cols).to_parquet(config.interim("scenario_parking.parquet"), index=False)

    # ---- Scenario 1: RTS Link access times (Johor Bahru cells)
    cb = config.load("scenarios")["crossborder"]
    hubs = locate_hubs(cb["hubs"])
    json.dumps(hubs)
    config.derived("hubs.json").write_text(json.dumps(hubs, indent=2))
    g = read_gtfs(config.raw("gtfs", "gtfs_mybas.zip"))
    pats = patterns_in_window(g, cb["gtfs_service_date"], tuple(cb["departure_window"]))
    am = AccessModel(walk, snapper, pats, g["stops"])
    log(f"transit layer: {len(pats)} patterns, {am.n_route_stops} route-stops")
    speed = config.load("scenarios")["accessibility"]["walk_speed_mps"]["base"]
    detour = config.load("network")["snapping"]["snap_detour"]
    jb = (cells["city"] == "jb").to_numpy()
    cbt = {"h3": cells.loc[jb, "h3"].to_numpy()}
    for hub, h in hubs.items():
        for with_bus in (False, True):
            t = am.time_to_hub(h["lon"], h["lat"], with_bus)
            cbt[f"t_{'pt' if with_bus else 'walk'}_{hub}"] = cell_times(t, cell_snaps[jb], speed, detour)
    drive = Network.load(config.interim("drive.npz"))
    ft = feeder_times(drive, hubs["rts"]["lon"], hubs["rts"]["lat"], cells[jb])
    for c in ft.columns:
        cbt[f"av_{c}"] = ft[c].to_numpy()
    pd.DataFrame(cbt).to_parquet(config.interim("crossborder.parquet"), index=False)
    log("cross-border access times done")


def locate_hubs(spec: dict) -> dict:
    """Find each border hub in OSM by name near its reference point."""
    import osmium
    from .geo import haversine_m

    found: dict[str, dict] = {}
    want = {k: [n.lower() for n in v["osm_names"]] for k, v in spec.items()}
    best: dict[str, tuple[float, dict]] = {}
    fp = osmium.FileProcessor(str(OSM()), osmium.osm.NODE | osmium.osm.WAY).with_locations().with_filter(
        osmium.filter.KeyFilter("name"))
    for obj in fp:
        name = obj.tags.get("name", "")
        low = name.lower()
        # roads, shops and car parks share these place names but are not the hub
        if any(k in obj.tags for k in ("highway", "shop", "parking")) or obj.tags.get("amenity") in ("parking", "restaurant", "cafe"):
            continue
        for hub, names in want.items():
            if not any(n in low for n in names):
                continue
            if obj.is_node():
                lon, lat = obj.location.lon, obj.location.lat
            else:
                locs = [n.location for n in obj.nodes if n.location.valid()]
                if not locs:
                    continue
                lon = float(np.mean([l.lon for l in locs]))
                lat = float(np.mean([l.lat for l in locs]))
            ref = spec[hub]["ref"]
            d = float(haversine_m(ref[0], ref[1], lon, lat))
            if d > spec[hub]["search_m"]:
                continue
            # prefer the station itself, then transport facilities, then buildings named after them
            tg = obj.tags
            if tg.get("railway") in ("station", "halt", "construction") or tg.get("public_transport") == "station":
                bonus = 3000
            elif tg.get("amenity") in ("bus_station", "border_control") or tg.get("public_transport") == "stop_area":
                bonus = 2000
            elif tg.get("building") in ("train_station", "transportation", "government"):
                bonus = 1000
            else:
                bonus = 0
            score = d - bonus
            if hub not in best or score < best[hub][0]:
                best[hub] = (score, {"lon": lon, "lat": lat, "osm": f"{'n' if obj.is_node() else 'w'}{obj.id}",
                                     "name": name, "tags": {k: v for k, v in obj.tags if k in ("railway", "public_transport", "building", "amenity", "construction", "station")},
                                     "distance_from_ref_m": round(d)})
    for hub in spec:
        if hub in best:
            found[hub] = best[hub][1]
        else:
            ref = spec[hub]["ref"]
            found[hub] = {"lon": ref[0], "lat": ref[1], "osm": None, "name": spec[hub]["osm_names"][0],
                          "note": "not found in OSM; reference coordinate used"}
    return found


def stage_summary() -> None:
    from .summary import build_summary

    build_summary()


def stage_export() -> None:
    from .web_export import export_all

    export_all()


def stage_basemap() -> None:
    from .basemap import build_all

    build_all()


STAGES = {
    "prefilter": stage_prefilter, "networks": stage_networks, "features": stage_features,
    "population": stage_population, "access": stage_access, "access_overture": stage_access_overture,
    "form": stage_form, "scenarios": stage_scenarios, "summary": stage_summary, "export": stage_export,
    "basemap": stage_basemap,
}


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stages", nargs="+", choices=[*STAGES, "all"])
    args = ap.parse_args(argv)
    config.ensure_dirs()
    todo = list(STAGES) if "all" in args.stages else args.stages
    for s in todo:
        t = time.time()
        log(f"▶ {s}")
        STAGES[s]()
        log(f"✓ {s} ({time.time() - t:.0f}s)")


if __name__ == "__main__":
    main()
