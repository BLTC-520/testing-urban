"""Scenario 2 — Parking to Proximity.

Premise (labelled as a scenario, not a forecast): if shared autonomous
vehicles reduce the need for parking (ITF 2015 modelled the removal of all
on-street parking in Lisbon), some car parks near under-served homes could
become small neighbourhood service hubs.

Question: which *existing, mapped* car parks would close the most 15-minute
gaps, and how far would that move each city?

Method (maximal covering location, greedy):
  * candidates   = mapped car parks ≥ min_site_area_m2 (surface / multi-storey / untagged);
  * a converted site provides the hub programme (groceries, healthcare,
    education, dining, a transit/mobility stop) and, if ≥ 1 ha, green space;
  * for each candidate a bounded network search gives walking distance to
    every cell within the threshold;
  * sites are added one at a time, each time choosing the candidate that makes
    the most additional residents "complete" (all six basket categories within
    15 min); ties break on category gains. Greedy selection is the standard
    heuristic for coverage problems (within 1 − 1/e of optimal for submodular
    objectives).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from . import config
from .dijkstra import BoundedSearch
from .features import access_points
from .graph import EdgeSnapper, Network


def candidate_sites(features, cells: pd.DataFrame, city_of) -> pd.DataFrame:
    p2p = config.load("scenarios")["parking_to_proximity"]
    allowed = [t for t in p2p["candidate_parking_types"] if t is not None]
    park = features[(features["lvl_parking"] >= 0) & features.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
    ok_type = park["parking"].isin(allowed) | park["parking"].isna()
    park = park[ok_type & (park["area_m2"] >= p2p["min_site_area_m2"])]
    park["city"] = city_of(park["lon"].to_numpy(), park["lat"].to_numpy())
    return park[park["city"].notna()]


SITE_COLUMNS = ["rank", "feature_id", "city", "lon", "lat", "area_m2", "parking", "name", "newly_complete",
                "category_gain", "cum_newly_complete", "provides_green"]


class ParkingScenario:
    def __init__(self, net: Network, snapper: EdgeSnapper, cells: pd.DataFrame, cell_snaps: pd.DataFrame,
                 on_network: np.ndarray, d_basket: dict[str, np.ndarray]):
        cfg = config.load("scenarios")
        self.p2p = cfg["parking_to_proximity"]
        acc = cfg["accessibility"]
        self.speed = acc["walk_speed_mps"]["base"]
        self.tau_m = self.p2p["threshold_min"] * 60 * self.speed
        self.basket = list(d_basket)
        self.net = net
        self.snapper = snapper
        self.cells = cells
        self.detour = config.load("network")["snapping"]["snap_detour"]
        self.max_snap = config.load("network")["snapping"]["max_snap_m"]
        self.on_network = on_network
        self.cu = cell_snaps["u"].to_numpy()
        self.cv = cell_snaps["v"].to_numpy()
        self.ou = cell_snaps["off_u"].to_numpy()
        self.ov = cell_snaps["off_v"].to_numpy()
        self.cs = cell_snaps["snap_m"].to_numpy() * self.detour
        # node -> cells whose edge touches it
        n = net.n_nodes
        nodes = np.concatenate([self.cu, self.cv])
        cidx = np.concatenate([np.arange(len(cells)), np.arange(len(cells))])
        order = np.argsort(nodes, kind="stable")
        self.node_cells = cidx[order]
        self.node_ptr = np.concatenate([[0], np.cumsum(np.bincount(nodes, minlength=n))])
        self.reach = np.column_stack([np.nan_to_num(d_basket[k], nan=np.inf) <= self.tau_m for k in self.basket])
        self.reach &= on_network[:, None]
        self.search = BoundedSearch(net.indptr, net.indices, net.weights)
        self._dist = np.full(n, np.inf)

    def coverage(self, lon: np.ndarray, lat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Cells within the threshold of a site's access points and their distances (m)."""
        snaps = self.snapper.snap(lon, lat)
        ok = (snaps["snap_m"] <= self.max_snap).to_numpy()
        if not ok.any():
            return np.array([], np.int64), np.array([])
        sn = snaps[ok]
        base = self.detour * sn["snap_m"].to_numpy()
        src = np.concatenate([sn["u"].to_numpy(), sn["v"].to_numpy()])
        cost = np.concatenate([base + sn["off_u"].to_numpy(), base + sn["off_v"].to_numpy()])
        nodes, costs = self.search.run(src, cost, self.tau_m)
        self._dist[nodes] = costs
        cand = np.unique(np.concatenate([self.node_cells[self.node_ptr[n]:self.node_ptr[n + 1]] for n in nodes])) \
            if len(nodes) else np.array([], np.int64)
        d = np.minimum(self._dist[self.cu[cand]] + self.ou[cand], self._dist[self.cv[cand]] + self.ov[cand]) + self.cs[cand]
        self._dist[nodes] = np.inf
        keep = (d <= self.tau_m) & self.on_network[cand]
        return cand[keep], d[keep]

    def run(self, sites: pd.DataFrame, n_max: int) -> dict:
        prog = self.p2p["hub_program"]
        k_idx = {k: i for i, k in enumerate(self.basket)}
        pop = self.cells["pop"].to_numpy()
        state = self.reach.copy()
        complete0 = state.all(axis=1)
        covers = []
        for _, s in sites.iterrows():
            ap = access_points(sites.loc[[s.name]])
            cells_i, d_i = self.coverage(ap["lon"].to_numpy(), ap["lat"].to_numpy())
            cats = list(prog) + (["green_space"] if s["area_m2"] >= self.p2p["green_space_min_site_m2"] else [])
            covers.append((s.name, cells_i, d_i, [k_idx[c] for c in cats if c in k_idx]))
        chosen, gains, rows = [], [], []
        available = list(range(len(covers)))
        cum_complete = 0.0
        for step in range(min(n_max, len(covers))):
            best, best_gain, best_tie = None, -1.0, -1.0
            for j in available:
                _, ci, _, kk = covers[j]
                if not len(ci):
                    continue
                before = state[ci]
                after = before.copy()
                after[:, kk] = True
                newly = after.all(axis=1) & ~before.all(axis=1)
                g = float(pop[ci][newly].sum())
                tie = float((pop[ci][:, None] * (after & ~before)).sum())
                if g > best_gain or (g == best_gain and tie > best_tie):
                    best, best_gain, best_tie = j, g, tie
            if best is None or (best_gain <= 0 and best_tie <= 0):
                break
            fid, ci, di, kk = covers[best]
            state[np.ix_(ci, kk)] = True
            available.remove(best)
            cum_complete += best_gain
            chosen.append(best)
            gains.append(best_gain)
            s = sites.loc[fid]
            rows.append({"rank": step + 1, "feature_id": s["feature_id"], "city": s["city"], "lon": s["lon"],
                         "lat": s["lat"], "area_m2": s["area_m2"], "parking": s["parking"], "name": s["name"],
                         "newly_complete": best_gain, "category_gain": best_tie,
                         "cum_newly_complete": cum_complete, "provides_green": "green_space" in [self.basket[k] for k in kk]})
        return {"sites": pd.DataFrame(rows, columns=SITE_COLUMNS), "covers": [covers[j] for j in chosen],
                "state": state, "complete_before": complete0}


def scenario_distances(covers: list, d_basket: dict[str, np.ndarray], basket: list[str], n: int) -> dict[str, np.ndarray]:
    """Per-cell basket distances after converting the first n chosen sites."""
    out = {k: d_basket[k].astype(np.float64).copy() for k in basket}
    for _, ci, di, kk in covers[:n]:
        for k in kk:
            cat = basket[k]
            cur = out[cat][ci]
            out[cat][ci] = np.where(np.isnan(cur), di, np.minimum(cur, di))
    return out
