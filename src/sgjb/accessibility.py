"""Network accessibility from every origin cell to every essential-service category.

Distances are computed in metres on the pedestrian network, so one search
serves every walking speed (time = distance / speed).

Per category k and origin cell i we derive:
  d_k(i)      network distance to the nearest destination (multi-source Dijkstra);
  n_k(i, τ)   destinations reachable within τ minutes (cumulative opportunities);
  g_k(i)      gravity accessibility  Σ_j exp(-β d_ij), β from a 10-minute half-life.
"""

from __future__ import annotations

import math
import time

import geopandas as gpd
import numpy as np
import pandas as pd

from . import config
from .dijkstra import accumulate_reach, multi_source_dijkstra
from .features import LEVELS, Taxonomy, access_points
from .graph import EdgeSnapper, Network, evaluate_at_snaps, snaps_to_sources


def select_destinations(features: gpd.GeoDataFrame, tax: Taxonomy, category: str, variant: str) -> gpd.GeoDataFrame:
    """Features that count as `category` under taxonomy `variant` (incl. area rules)."""
    lvl = LEVELS.index(variant)
    col = f"lvl_{category}"
    sel = features[(features[col] >= 0) & (features[col] <= lvl)]
    rule = tax.categories[category]
    if rule.geometry == "area" and rule.min_area:
        min_a = float(rule.min_area[variant])
        is_poly = sel.geom_type.isin(["Polygon", "MultiPolygon"])
        sel = sel[(is_poly & (sel["area_m2"] >= min_a)) | ((~is_poly) & (min_a <= 0))]
    return sel


def dedupe_for_counting(sel: gpd.GeoDataFrame, radius_m: float = 50.0) -> np.ndarray:
    """Group ids so that one place mapped twice (node + building) counts once.

    Features sharing a non-empty normalised name within ``radius_m`` merge.
    """
    from scipy.spatial import cKDTree

    from .geo import to_metric

    n = len(sel)
    gid = np.arange(n)
    names = sel["name"].fillna("").str.lower().str.replace(r"[^a-z0-9]", "", regex=True).to_numpy()
    x, y = to_metric(sel["lon"].to_numpy(), sel["lat"].to_numpy())
    tree = cKDTree(np.column_stack([x, y]))
    for i, j in tree.query_pairs(radius_m):
        if names[i] and names[i] == names[j]:
            a, b = gid[i], gid[j]
            gid[gid == max(a, b)] = min(a, b)
    _, inv = np.unique(gid, return_inverse=True)
    return inv


class AccessibilityModel:
    def __init__(self, net: Network, cells: pd.DataFrame, features: gpd.GeoDataFrame, tax: Taxonomy | None = None):
        self.net = net
        self.cells = cells
        self.features = features
        self.tax = tax or Taxonomy()
        cfg_net = config.load("network")["snapping"]
        self.detour = float(cfg_net["snap_detour"])
        self.max_snap = float(cfg_net["max_snap_m"])
        self.snapper = EdgeSnapper(net)
        self.cell_snaps = self.snapper.snap(cells["lon"].to_numpy(), cells["lat"].to_numpy())
        self.on_network = (self.cell_snaps["snap_m"] <= self.max_snap).to_numpy()
        acc = config.load("scenarios")["accessibility"]
        self.cap_m = acc["search_cap_min"] * 60 * max(acc["walk_speed_mps"].values())

    def nearest(self, category: str, variant: str = "core", net: Network | None = None,
                snapper: EdgeSnapper | None = None, cell_snaps: pd.DataFrame | None = None,
                extra_points: pd.DataFrame | None = None) -> tuple[np.ndarray, np.ndarray]:
        """Network distance (m) from each cell to the nearest destination, and its feature index.

        ``extra_points`` (lon, lat) adds hypothetical destinations (scenarios);
        they are labelled -2.
        """
        net = net or self.net
        snapper = snapper or self.snapper
        cell_snaps = self.cell_snaps if cell_snaps is None else cell_snaps
        sel = select_destinations(self.features, self.tax, category, variant)
        ap = access_points(sel) if len(sel) else pd.DataFrame(columns=["feature", "lon", "lat"])
        labels = sel.index.to_numpy()[ap["feature"].to_numpy()] if len(ap) else np.array([], np.int64)
        if extra_points is not None and len(extra_points):
            ap = pd.concat([ap[["lon", "lat"]], extra_points[["lon", "lat"]]], ignore_index=True)
            labels = np.concatenate([labels, np.full(len(extra_points), -2)])
        if not len(ap):
            return np.full(len(cell_snaps), np.inf), np.full(len(cell_snaps), -1)
        snaps = snapper.snap(ap["lon"].to_numpy(), ap["lat"].to_numpy())
        nodes, cost, lab = snaps_to_sources(snaps, self.detour, self.max_snap, labels=labels.astype(np.int64))
        dist, label = multi_source_dijkstra(net.indptr, net.indices, net.weights, nodes, cost, lab, self.cap_m)
        d = evaluate_at_snaps(dist, cell_snaps, self.detour)
        du = dist[cell_snaps["u"].to_numpy()] + cell_snaps["off_u"].to_numpy()
        dv = dist[cell_snaps["v"].to_numpy()] + cell_snaps["off_v"].to_numpy()
        lab_cell = np.where(du <= dv, label[cell_snaps["u"].to_numpy()], label[cell_snaps["v"].to_numpy()])
        d = np.where(self.on_network, d, np.nan)
        return d, lab_cell

    def reach(self, category: str, variant: str, thresholds_m: np.ndarray, half_life_m: float) -> tuple[np.ndarray, np.ndarray]:
        """Cumulative counts (per threshold) and gravity sum at each cell."""
        sel = select_destinations(self.features, self.tax, category, variant)
        n_cells = len(self.cells)
        if not len(sel):
            return np.zeros((len(thresholds_m), n_cells), np.int32), np.zeros(n_cells)
        group = dedupe_for_counting(sel)
        ap = access_points(sel)
        snaps = self.snapper.snap(ap["lon"].to_numpy(), ap["lat"].to_numpy())
        ok = (snaps["snap_m"] <= self.max_snap).to_numpy()
        g = group[ap["feature"].to_numpy()][ok]
        sn = snaps[ok]
        base = self.detour * sn["snap_m"].to_numpy()
        # each access point contributes both edge endpoints
        nodes = np.concatenate([sn["u"].to_numpy(), sn["v"].to_numpy()])
        cost = np.concatenate([base + sn["off_u"].to_numpy(), base + sn["off_v"].to_numpy()])
        gg = np.concatenate([g, g])
        order = np.argsort(gg, kind="stable")
        nodes, cost, gg = nodes[order], cost[order], gg[order]
        ptr = np.concatenate([[0], np.cumsum(np.bincount(gg, minlength=int(group.max()) + 1))]).astype(np.int64)
        beta = math.log(2) / half_life_m
        counts, grav = accumulate_reach(self.net.indptr, self.net.indices, self.net.weights, ptr,
                                        nodes.astype(np.int64), cost.astype(np.float64),
                                        np.sort(thresholds_m).astype(np.float64), beta, 4 * half_life_m)
        # value at the cell's nearer edge endpoint (offset ≤ half an edge; documented approximation)
        cs = self.cell_snaps
        near_u = (cs["off_u"] <= cs["off_v"]).to_numpy()
        node = np.where(near_u, cs["u"].to_numpy(), cs["v"].to_numpy())
        c = counts[:, node]
        gv = grav[node]
        c[:, ~self.on_network] = 0
        gv[~self.on_network] = 0.0
        return c, gv


def run(net: Network, cells: pd.DataFrame, features: gpd.GeoDataFrame, strict_net: Network | None = None) -> pd.DataFrame:
    """Full accessibility table for all cells (base + sensitivity variants)."""
    tax = Taxonomy()
    model = AccessibilityModel(net, cells, features, tax)
    acc = config.load("scenarios")["accessibility"]
    v_base = acc["walk_speed_mps"]["base"]
    out = cells[["h3", "city", "unit_id", "census_unit", "lon", "lat", "pop", "pop_kontur", "elderly"]].copy()
    out["snap_m"] = model.cell_snaps["snap_m"].to_numpy()
    out["on_network"] = model.on_network
    cats = tax.basket + [c for c in tax.supplementary if c != "parking"]
    t0 = time.time()
    for cat in cats:
        for variant in LEVELS:
            d, lab = model.nearest(cat, variant)
            sfx = "" if variant == "core" else f"__{variant}"
            out[f"d_{cat}{sfx}"] = d.astype(np.float32)
            if variant == "core":
                out[f"near_{cat}"] = lab
        print(f"  nearest {cat}: {time.time() - t0:.0f}s", flush=True)
    if strict_net is not None:
        s_snapper = EdgeSnapper(strict_net)
        s_snaps = s_snapper.snap(cells["lon"].to_numpy(), cells["lat"].to_numpy())
        for cat in tax.basket:
            d, _ = model.nearest(cat, "core", net=strict_net, snapper=s_snapper, cell_snaps=s_snaps)
            d = np.where((s_snaps["snap_m"] <= model.max_snap).to_numpy(), d, np.nan)
            out[f"d_{cat}__netstrict"] = d.astype(np.float32)
        print(f"  strict network: {time.time() - t0:.0f}s", flush=True)
    thresholds_m = np.array([15 * 60 * v_base])
    half_life_m = acc["gravity_half_life_min"] * 60 * v_base
    for cat in tax.basket:
        c, g = model.reach(cat, "core", thresholds_m, half_life_m)
        out[f"n15_{cat}"] = c[0].astype(np.int32)
        out[f"g_{cat}"] = g.astype(np.float32)
    print(f"  counts & gravity: {time.time() - t0:.0f}s", flush=True)
    return out
