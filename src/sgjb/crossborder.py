"""Scenario 1 — the RTS Link (regional mobility, kept separate from 15-minute access).

Door-to-platform time from a Johor Bahru home to the first Singapore MRT
platform is decomposed as

    T = T_access(home → border hub) + T_border + T_crossing + T_connection

* T_access is computed on real networks for every cell: walking only, walking
  + myBAS buses (frequency-based, official GTFS), or a shared autonomous feeder
  on the road network (scenario parameters).
* T_border, T_crossing, T_connection are *parameters* (official where
  published, otherwise assumptions) and are recombined in the browser so that a
  reader can vary them. They are never presented as measured values.

Hubs: Bangunan Sultan Iskandar CIQ (cross-border buses), JB Sentral (KTM Shuttle
Tebrau) and Bukit Chagar (RTS Link).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from . import config
from .dijkstra import multi_source_dijkstra
from .graph import EdgeSnapper, Network
from .transit import Pattern

MIN = 60.0


def _reverse_csr(n: int, src: np.ndarray, dst: np.ndarray, w: np.ndarray):
    """CSR of the *reversed* arcs, so one search from a hub yields time-to-hub for all nodes."""
    order = np.lexsort((src, dst))
    s, d, ww = dst[order], src[order], w[order]
    indptr = np.concatenate([[0], np.cumsum(np.bincount(s, minlength=n))]).astype(np.int64)
    return indptr, d.astype(np.int64), ww.astype(np.float64)


class AccessModel:
    """Walk + bus (frequency-based) time from every walk node to a hub."""

    def __init__(self, walk: Network, snapper: EdgeSnapper, patterns: list[Pattern], stops: pd.DataFrame):
        cfg = config.load("scenarios")
        acc = cfg["accessibility"]
        self.speed = acc["walk_speed_mps"]["base"]
        cb = cfg["crossborder"]["jb_access"]
        self.max_wait = cb["bus_max_wait_min"] * MIN
        self.board_pen = cb["bus_board_penalty_min"] * MIN
        self.walk = walk
        self.snapper = snapper
        n = walk.n_nodes
        # walking arcs (both directions), seconds
        wsrc = np.concatenate([walk.edge_u, walk.edge_v])
        wdst = np.concatenate([walk.edge_v, walk.edge_u])
        ww = np.concatenate([walk.edge_len, walk.edge_len]).astype(np.float64) / self.speed
        st = stops.set_index("stop_id")
        snaps = snapper.snap(st["stop_lon"].astype(float).to_numpy(), st["stop_lat"].astype(float).to_numpy())
        snaps.index = st.index
        src, dst, w = [wsrc], [wdst], [ww]
        next_id = n
        self.n_route_stops = 0
        for p in patterns:
            ids = np.arange(next_id, next_id + len(p.stops))
            next_id += len(p.stops)
            wait = min(p.headway_s / 2.0, self.max_wait) + self.board_pen
            for k, sid in enumerate(p.stops):
                if sid not in snaps.index:
                    continue
                s = snaps.loc[sid]
                if s.snap_m > 250:
                    continue
                walk_u = (s.off_u + s.snap_m) / self.speed
                walk_v = (s.off_v + s.snap_m) / self.speed
                if k < len(p.stops) - 1:   # board
                    src += [np.array([s.u, s.v])]
                    dst += [np.array([ids[k], ids[k]])]
                    w += [np.array([walk_u + wait, walk_v + wait])]
                if k > 0:                  # alight
                    src += [np.array([ids[k], ids[k]])]
                    dst += [np.array([s.u, s.v])]
                    w += [np.array([walk_u, walk_v])]
            if len(p.stops) > 1:            # ride
                src += [ids[:-1]]
                dst += [ids[1:]]
                w += [p.ride_s]
            self.n_route_stops += len(p.stops)
        self.n = next_id
        self.src = np.concatenate(src).astype(np.int64)
        self.dst = np.concatenate(dst).astype(np.int64)
        self.w = np.concatenate(w).astype(np.float64)
        self.rev_pt = _reverse_csr(self.n, self.src, self.dst, self.w)
        self.rev_walk = _reverse_csr(n, wsrc, wdst, ww)

    def time_to_hub(self, hub_lon: float, hub_lat: float, with_bus: bool) -> np.ndarray:
        """Seconds from every walk node to the hub (walk-only or walk + bus)."""
        hs = self.snapper.snap(np.array([hub_lon]), np.array([hub_lat])).iloc[0]
        src = np.array([int(hs.u), int(hs.v)])
        cost = np.array([hs.off_u + hs.snap_m, hs.off_v + hs.snap_m]) / self.speed
        indptr, indices, weights = self.rev_pt if with_bus else self.rev_walk
        dist, _ = multi_source_dijkstra(indptr, indices, weights, src, cost, np.zeros(2, np.int64), 4 * 3600.0)
        return dist[: self.walk.n_nodes]


def cell_times(node_seconds: np.ndarray, cell_snaps: pd.DataFrame, speed: float, detour: float) -> np.ndarray:
    """Minutes from each cell to the hub given per-node seconds."""
    du = node_seconds[cell_snaps["u"].to_numpy()] + cell_snaps["off_u"].to_numpy() / speed
    dv = node_seconds[cell_snaps["v"].to_numpy()] + cell_snaps["off_v"].to_numpy() / speed
    return (np.minimum(du, dv) + detour * cell_snaps["snap_m"].to_numpy() / speed) / MIN


def feeder_times(drive: Network, hub_lon: float, hub_lat: float, cells: pd.DataFrame) -> pd.DataFrame:
    """Shared autonomous feeder: walk to curb, wait, ride (pooled, peak speeds), walk to platform.

    Returns per-cell components in minutes; the wait is added later per regime.
    """
    av = config.load("scenarios")["crossborder"]["av_feeder"]
    speed = config.load("scenarios")["accessibility"]["walk_speed_mps"]["base"]
    snapper = EdgeSnapper(drive)
    hs = snapper.snap(np.array([hub_lon]), np.array([hub_lat])).iloc[0]
    # arc weights already reflect peak speeds (sgjb.osm.build_drive_network)
    src = np.concatenate([drive.edge_u, drive.edge_v[drive.arc_reverse_ok]])
    dst = np.concatenate([drive.edge_v, drive.edge_u[drive.arc_reverse_ok]])
    w = np.concatenate([drive.arc_weight, drive.arc_weight[drive.arc_reverse_ok]])
    rev = _reverse_csr(drive.n_nodes, src, dst, w)
    hub_nodes = np.array([int(hs.u), int(hs.v)])
    dist, _ = multi_source_dijkstra(*rev, hub_nodes, np.zeros(2), np.zeros(2, np.int64), 3 * 3600.0)
    cs = snapper.snap(cells["lon"].to_numpy(), cells["lat"].to_numpy())
    e = cs["edge"].to_numpy()
    edge_speed = drive.edge_len[e] / drive.arc_weight[e]           # m/s on that edge
    du = dist[cs["u"].to_numpy()] + cs["off_u"].to_numpy() / edge_speed
    dv = dist[cs["v"].to_numpy()] + cs["off_v"].to_numpy() / edge_speed
    ride = np.minimum(du, dv) * av["pooling_detour"] / MIN
    walk_pick = cs["snap_m"].to_numpy() * config.load("network")["snapping"]["snap_detour"] / speed / MIN
    served = walk_pick <= av["walk_to_pickup_max_min"]
    return pd.DataFrame({"walk_to_pickup_min": walk_pick, "ride_min": ride, "served": served,
                         "dropoff_walk_min": av["dropoff_walk_min"]})


def compose(access_min: np.ndarray, hub: str, regime: dict, params: dict) -> np.ndarray:
    """Door-to-platform minutes for one hub/mode under one border regime (mirrors web/src/lib/crossborder.ts)."""
    clear = 2 * regime["clearance_min_per_country"]
    if hub == "bus":
        b = params["baseline_bus"]
        return access_min + clear + b["headway_min"] / 2 + regime["causeway_ride_min"] + b["checkpoint_to_mrt_min"]
    if hub == "ktm":
        k = params["baseline_rail"]
        return access_min + clear + k["planned_wait_min"] + k["ride_min"] + k["woodlands_ciq_to_mrt_min"]
    if hub == "rts":
        r = params["rts"]
        return access_min + clear + r["peak_headway_min"] / 2 + r["ride_min"] + r["transfer_to_mrt_min"]
    raise ValueError(hub)
