"""Urban-form indicators that explain *why* accessibility differs.

All indicators are computed identically for both cities from the same OSM
snapshot, so differences reflect street pattern and mapping — the latter is
assessed separately in :mod:`sgjb.audit`.

* intersection density   3+-way junctions per km² of populated land
* dead-end share         share of network nodes with a single connection
* pedestrian share       share of walkable length on dedicated pedestrian ways
* arterial exposure      share of walkable length on trunk/primary carriageways
                         with no sidewalk tagged (walking next to fast traffic)
* circuity               network ÷ straight-line distance for local trips
* pedestrian shed ratio  residents reachable within 15 min on the network ÷
                         residents inside the equivalent 15-min circle
* parking land           mapped surface / multi-storey car-park area
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

from . import config
from .dijkstra import BoundedSearch
from .geo import to_metric
from .graph import Network, evaluate_at_snaps

CELL_AREA_KM2 = 0.0150475  # mean H3 res-10 hexagon area


def node_degree(net: Network) -> np.ndarray:
    return np.diff(net.indptr)


def assign_city(lon: np.ndarray, lat: np.ndarray, cells: pd.DataFrame, max_m: float = 300.0) -> np.ndarray:
    """City label of the nearest populated cell (None beyond max_m)."""
    cx, cy = to_metric(cells["lon"].to_numpy(), cells["lat"].to_numpy())
    tree = cKDTree(np.column_stack([cx, cy]))
    x, y = to_metric(lon, lat)
    d, i = tree.query(np.column_stack([x, y]))
    lab = cells["city"].to_numpy()[i].astype(object)
    lab[d > max_m] = None
    return lab


def network_form(net: Network, cells: pd.DataFrame) -> pd.DataFrame:
    deg = node_degree(net)
    node_city = assign_city(net.lon, net.lat, cells)
    mid = net.geom_ptr[:-1] + (net.geom_ptr[1:] - net.geom_ptr[:-1]) // 2
    edge_city = assign_city(net.geom_lon[mid], net.geom_lat[mid], cells)
    hw = net.edge_attrs["highway"]
    length = net.edge_len.astype(np.float64)
    ped = net.edge_attrs["pedestrian"]
    arterial = np.isin(hw, ["trunk", "trunk_link", "primary", "primary_link"])
    exposed = arterial & ~net.edge_attrs["sidewalk_tagged"]
    rows = []
    for city in ("sg", "jb"):
        cm = cells["city"] == city
        populated_km2 = cm.sum() * CELL_AREA_KM2
        nm = node_city == city
        em = edge_city == city
        L = length[em].sum()
        rows.append({
            "city": city,
            "populated_km2": populated_km2,
            "walk_network_km": L / 1000,
            "network_km_per_km2": L / 1000 / populated_km2,
            "intersections_per_km2": (deg[nm] >= 3).sum() / populated_km2,
            "dead_end_share": float((deg[nm] == 1).mean()),
            "mean_edge_m": float(length[em].mean()),
            "pedestrian_way_share": float(length[em & ped].sum() / L),
            "arterial_share": float(length[em & arterial].sum() / L),
            "arterial_no_sidewalk_share": float(length[em & exposed].sum() / L),
            "sidewalk_tagged_share_of_roads": float(length[em & ~ped & net.edge_attrs["sidewalk_tagged"]].sum()
                                                    / max(length[em & ~ped].sum(), 1.0)),
        })
    return pd.DataFrame(rows)


def shed_and_circuity(net: Network, cells: pd.DataFrame, cell_snaps: pd.DataFrame, on_network: np.ndarray,
                      n_samples: int = 1500, seed: int = 7) -> pd.DataFrame:
    """Pedestrian shed ratio and circuity from a population-weighted sample of origins."""
    speed = config.load("scenarios")["accessibility"]["walk_speed_mps"]["base"]
    radius = 15 * 60 * speed
    detour = config.load("network")["snapping"]["snap_detour"]
    bs = BoundedSearch(net.indptr, net.indices, net.weights)
    x, y = to_metric(cells["lon"].to_numpy(), cells["lat"].to_numpy())
    tree = cKDTree(np.column_stack([x, y]))
    pop = cells["pop"].to_numpy()
    rng = np.random.default_rng(seed)
    out = []
    for city in ("sg", "jb"):
        idx = np.flatnonzero((cells["city"].to_numpy() == city) & on_network & (pop > 0))
        p = pop[idx] / pop[idx].sum()
        sample = rng.choice(idx, size=min(n_samples, len(idx)), replace=False, p=p)
        ratios, circ = [], []
        for i in sample:
            s = cell_snaps.iloc[i]
            src = np.array([int(s.u), int(s.v)])
            cost = np.array([s.off_u, s.off_v]) + detour * s.snap_m
            nodes, costs = bs.run(src, cost, radius * 1.6)
            dist = np.full(net.n_nodes, np.inf)
            dist[nodes] = costs
            near = np.array(tree.query_ball_point([x[i], y[i]], radius * 1.6), dtype=np.int64)
            near = near[on_network[near]]
            d_net = evaluate_at_snaps(dist, cell_snaps.iloc[near], detour)
            d_euc = np.hypot(x[near] - x[i], y[near] - y[i])
            circle = d_euc <= radius
            reached = d_net <= radius
            denom = pop[near][circle].sum()
            if denom > 0:
                ratios.append(pop[near][reached].sum() / denom)
            # circuity between network nodes (no snap legs): network ÷ straight-line distance
            nx_, ny_ = net.x[nodes], net.y[nodes]
            o_node = int(s.u) if s.off_u <= s.off_v else int(s.v)
            e_node = np.hypot(nx_ - net.x[o_node], ny_ - net.y[o_node])
            d_node = costs - (s.off_u if o_node == int(s.u) else s.off_v) - detour * s.snap_m
            local = (e_node > 300) & (e_node <= 1200) & (d_node > 0)
            if local.any():
                circ.append(np.median(d_node[local] / e_node[local]))
        out.append({
            "city": city,
            "pedestrian_shed_ratio_median": float(np.median(ratios)),
            "pedestrian_shed_ratio_p25": float(np.percentile(ratios, 25)),
            "pedestrian_shed_ratio_p75": float(np.percentile(ratios, 75)),
            "circuity_median": float(np.median(circ)),
            "circuity_p75": float(np.percentile(circ, 75)),
            "samples": len(sample),
        })
    return pd.DataFrame(out)


def parking_form(features, cells: pd.DataFrame) -> pd.DataFrame:
    park = features[features["lvl_parking"] >= 0].copy()
    park = park[park.geom_type.isin(["Polygon", "MultiPolygon"])]
    park["city"] = assign_city(park["lon"].to_numpy(), park["lat"].to_numpy(), cells)
    rows = []
    for city in ("sg", "jb"):
        p = park[park["city"] == city]
        residents = cells.loc[cells["city"] == city, "pop"].sum()
        surface = p[p["parking"].isin(["surface", None]) | p["parking"].isna()]
        ms = p[p["parking"].isin(["multi-storey", "rooftop"])]
        rows.append({
            "city": city,
            "parking_lots_mapped": int(len(p)),
            "parking_area_ha": float(p["area_m2"].sum() / 1e4),
            "surface_parking_area_ha": float(surface["area_m2"].sum() / 1e4),
            "multistorey_parking_footprint_ha": float(ms["area_m2"].sum() / 1e4),
            "parking_m2_per_resident": float(p["area_m2"].sum() / residents),
            "surface_parking_m2_per_resident": float(surface["area_m2"].sum() / residents),
        })
    return pd.DataFrame(rows)
