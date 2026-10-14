"""Scenario 3 — One footpath.

The parking scenario asks where services could go; this one asks about the
streets themselves. Johor Bahru's estates (taman) were laid out as separate
networks of cul-de-sacs and back lanes, so a home can be a few dozen metres
from a shop, clinic or bus stop in a straight line and a kilometre away on foot.

Question: which single short public footpath would bring the most Johor Bahru
residents at least one more everyday essential within a 15-minute walk, and
what exactly would change for them?

Method
  1. Candidates. Every dead end of the walk network is paired with each node
     within ``max_link_m`` in a straight line that is at least ``min_saving_m``
     further away on foot than the straight link (bounded search from the dead
     end).
  2. Desk filters. The straight link may not touch a building (with clearance),
     open water, a river, canal or stream, a railway, a road of class primary or
     above, any other walkable way, a mapped wall or fence, or a school,
     hospital, cemetery, military or prison site; both ends must be on a public
     street or path (not a service road, track or corridor, which mostly end
     inside compounds) and neither on a bridge or in a tunnel. Links across a
     mapped drain or ditch are kept and flagged: they need a small footbridge.
  3. Exact evaluation. A shortest path uses a new edge at most once, so with the
     link (a, b) of length l the walking distance from a home to the nearest
     destination of essential k becomes

         min( d_k ,  d(home, a) + l + D_k(b) ,  d(home, b) + l + D_k(a) )

     where D_k is the baseline distance from every network node to the nearest
     destination of k and d(home, ·) comes from a bounded search from each end.
     This equals a full recomputation on the extended network (tested), so every
     candidate is scored exactly. Homes and destinations keep their current
     access points; nothing else changes.
  4. Choice. The candidate that gives the most residents at least one more
     essential within 15 minutes; ties go to residents newly reaching all six.
"""

from __future__ import annotations

import heapq
import json
import math
from dataclasses import dataclass

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from scipy.spatial import cKDTree
from shapely.ops import substring

from . import config
from .accessibility import select_destinations
from .dijkstra import BoundedSearch, multi_source_dijkstra
from .features import Taxonomy, access_points
from .geo import to_lonlat, to_metric
from .graph import EdgeSnapper, Network, evaluate_at_snaps, snaps_to_sources

BARRIERS_PBF = "barriers.osm.pbf"
BARRIERS_GEOJSONL = "barriers.geojsonl"
BARRIER_EXPRESSIONS = [
    "w/waterway",
    "w/barrier=wall,fence,retaining_wall,city_wall,hedge,guard_rail",
    "w/landuse=military,cemetery", "r/landuse=military,cemetery",
    "w/amenity=prison,grave_yard",
    "w/highway=motorway,motorway_link,trunk,trunk_link,primary,primary_link",
]


# --------------------------------------------------------------------------- pure kernels
def distances_with_link(d_before: np.ndarray, d_home_a: np.ndarray, d_home_b: np.ndarray,
                        link_m: float, field_a: float, field_b: float) -> np.ndarray:
    """Nearest-destination distance after adding one edge (a, b) of length ``link_m``.

    ``field_a``/``field_b`` are the baseline nearest-destination distances of
    nodes a and b; ``d_home_*`` the baseline distances from each home to a / b.
    """
    via_a = d_home_a + link_m + field_b
    via_b = d_home_b + link_m + field_a
    return np.fmin(d_before, np.fmin(via_a, via_b))


def find_candidates(net: Network, in_area: np.ndarray, max_link_m: float, min_saving_m: float,
                    min_link_m: float = 5.0) -> pd.DataFrame:
    """Dead ends paired with nearby nodes that are much further away on foot.

    ``net_m`` is the current walking distance between the two ends, NaN when it
    exceeds the search cut-off (``min_saving_m + max_link_m``) or they are not
    connected at all.
    """
    deg = np.diff(net.indptr)
    dead = np.flatnonzero((deg == 1) & in_area)
    xy = np.column_stack([net.x, net.y])
    tree = cKDTree(xy)
    near = tree.query_ball_point(xy[dead], r=max_link_m)
    search = BoundedSearch(net.indptr, net.indices, net.weights)
    cut = min_saving_m + max_link_m
    scratch = np.full(net.n_nodes, np.inf)
    ra, rb, rl, rn = [], [], [], []
    for a, nb in zip(dead, near):
        nb = np.asarray(nb, dtype=np.int64)
        nb = nb[(nb != a) & in_area[nb]]
        if not len(nb):
            continue
        nodes, costs = search.run(np.array([a], np.int64), np.array([0.0]), cut)
        scratch[nodes] = costs
        ell = np.hypot(net.x[nb] - net.x[a], net.y[nb] - net.y[a])
        dn = scratch[nb]
        scratch[nodes] = np.inf
        ok = (dn - ell >= min_saving_m) & (ell >= min_link_m)
        ra.append(np.full(int(ok.sum()), a))
        rb.append(nb[ok])
        rl.append(ell[ok])
        rn.append(np.where(np.isfinite(dn[ok]), dn[ok], np.nan))
    if not ra:
        return pd.DataFrame(columns=["a", "b", "link_m", "net_m"])
    df = pd.DataFrame({"a": np.concatenate(ra), "b": np.concatenate(rb),
                       "link_m": np.concatenate(rl), "net_m": np.concatenate(rn)})
    # the same pair can be found from both ends when both are dead ends
    lo, hi = np.minimum(df["a"], df["b"]), np.maximum(df["a"], df["b"])
    return df.assign(lo=lo, hi=hi).drop_duplicates(["lo", "hi"]).drop(columns=["lo", "hi"]).reset_index(drop=True)


# --------------------------------------------------------------------------- desk filters
@dataclass
class Layers:
    """Barrier geometries in the metric CRS, each with an STRtree."""

    buildings: np.ndarray
    water: np.ndarray            # open water areas
    blocking_lines: np.ndarray   # rivers, canals, streams, railways, major roads, walls, fences
    footbridge_lines: np.ndarray  # drains, ditches
    sites: np.ndarray            # schools, hospitals, cemeteries, military, prisons
    walk_edges: np.ndarray       # walkable ways (index = edge id)
    waterways: np.ndarray        # every waterway line (for drawing)

    def __post_init__(self) -> None:
        self.trees = {k: shapely.STRtree(getattr(self, k)) for k in
                      ("buildings", "water", "blocking_lines", "footbridge_lines", "sites", "walk_edges", "waterways")}


def _read(path, bbox) -> gpd.GeoDataFrame:
    if not path.exists():
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")
    return gpd.read_file(path, bbox=bbox, engine="pyogrio")


def load_layers(net: Network, features: gpd.GeoDataFrame, bbox: tuple[float, float, float, float]) -> Layers:
    from .osm import tags_filter, run_osmium

    crs = config.load("study_area")["crs_metric"]
    cfg = config.load("scenarios")["footpath"]
    pbf = tags_filter(_osm(), config.interim(BARRIERS_PBF), BARRIER_EXPRESSIONS)
    gj = config.interim(BARRIERS_GEOJSONL)
    if not gj.exists() or gj.stat().st_mtime < pbf.stat().st_mtime:
        run_osmium(["export", str(pbf), "-f", "geojsonseq", "--format-option", "print_record_separator=false",
                    "-o", str(gj), "--overwrite"])
    base = config.interim("basemap")
    bld = _read(base / "buildings.geojsonl", bbox).to_crs(crs)
    water = _read(base / "lc_water.geojsonl", bbox).to_crs(crs)
    rail = _read(base / "rail.geojsonl", bbox).to_crs(crs)
    bar = _read(gj, bbox).to_crs(crs)
    col = lambda name: bar[name].fillna("") if name in bar else pd.Series("", index=bar.index)  # noqa: E731
    lines = bar.geom_type.isin(["LineString", "MultiLineString"])
    polys = bar.geom_type.isin(["Polygon", "MultiPolygon"])
    ww = col("waterway")
    block_lines = lines & (ww.isin(cfg["blocking_waterways"]) | col("barrier").isin(cfg["blocking_barriers"])
                           | col("highway").isin(cfg["blocking_highways"]))
    foot_lines = lines & ww.isin(cfg["footbridge_waterways"])
    site_polys = polys & (col("landuse").isin(["military", "cemetery"]) | col("amenity").isin(["prison", "grave_yard"]))
    # schools and hospitals mapped as areas
    fm = features.to_crs(crs)
    is_area = fm.geom_type.isin(["Polygon", "MultiPolygon"])
    school = (fm["amenity"].isin(["school", "kindergarten", "college", "university"])) & is_area
    hosp = (fm["amenity"].eq("hospital") | fm["healthcare"].eq("hospital")) & is_area
    gx, gy = to_metric(net.geom_lon, net.geom_lat)
    edges = shapely.linestrings(np.column_stack([gx, gy]),
                                indices=np.repeat(np.arange(net.n_edges), np.diff(net.geom_ptr)))
    return Layers(
        buildings=bld.geometry.values.to_numpy() if len(bld) else np.array([], object),
        water=water.geometry.values.to_numpy() if len(water) else np.array([], object),
        blocking_lines=np.concatenate([bar.geometry[block_lines].to_numpy(), rail.geometry.to_numpy()]),
        footbridge_lines=bar.geometry[foot_lines].to_numpy(),
        sites=np.concatenate([bar.geometry[site_polys].to_numpy(), fm.geometry[school | hosp].to_numpy()]),
        walk_edges=np.asarray(edges),
        waterways=bar.geometry[lines & (ww != "")].to_numpy(),
    )


def _osm():
    from .pipeline import OSM

    return OSM()


NOT_PUBLIC = {"service", "track", "corridor", "bridleway", "construction", "proposed", "raceway"}


def desk_filter(net: Network, cand: pd.DataFrame, layers: Layers, clearance_m: float) -> pd.DataFrame:
    """Flag each candidate link with what it would cross; keep the reasons."""
    a, b = cand["a"].to_numpy(), cand["b"].to_numpy()
    ax, ay, bx, by = net.x[a], net.y[a], net.x[b], net.y[b]
    ell = np.hypot(bx - ax, by - ay)
    # shorten by 1 m at each end so touching the streets it joins is not a crossing
    t = np.clip(1.0 / np.maximum(ell, 1e-9), 0, 0.45)
    inner = shapely.linestrings(np.stack([np.column_stack([ax + t * (bx - ax), ay + t * (by - ay)]),
                                          np.column_stack([bx - t * (bx - ax), by - t * (by - ay)])], axis=1))
    full = shapely.linestrings(np.stack([np.column_stack([ax, ay]), np.column_stack([bx, by])], axis=1))
    out = cand.copy()

    def hits(tree_key: str, geoms) -> np.ndarray:
        tree = layers.trees[tree_key]
        if not len(getattr(layers, tree_key)):
            return np.zeros(len(cand), bool)
        idx = tree.query(geoms, predicate="intersects")
        m = np.zeros(len(cand), bool)
        m[np.unique(idx[0])] = True
        return m

    out["x_building"] = hits("buildings", shapely.buffer(inner, clearance_m, cap_style="flat"))
    out["x_water"] = hits("water", inner)
    out["x_barrier"] = hits("blocking_lines", inner)
    out["x_site"] = hits("sites", full)
    out["footbridge"] = hits("footbridge_lines", inner)
    # crossing any other walkable way means the link is really a different, shorter one
    idx = layers.trees["walk_edges"].query(inner, predicate="intersects")
    m = np.zeros(len(cand), bool)
    m[np.unique(idx[0])] = True
    out["x_street"] = m
    # no ends on bridges or in tunnels
    elevated = net.edge_attrs["bridge"] | net.edge_attrs["tunnel"]
    on_elev = np.zeros(net.n_nodes, bool)
    on_elev[net.edge_u[elevated]] = True
    on_elev[net.edge_v[elevated]] = True
    out["x_elevated"] = on_elev[a] | on_elev[b]
    # both ends on a public street or path: service roads, tracks and corridors mostly
    # end inside compounds (hospitals, malls, factories) or plantations
    public = ~np.isin(net.edge_attrs["highway"], list(NOT_PUBLIC))
    on_public = np.zeros(net.n_nodes, bool)
    on_public[net.edge_u[public]] = True
    on_public[net.edge_v[public]] = True
    out["x_not_public"] = ~(on_public[a] & on_public[b])
    out["passes"] = ~(out["x_building"] | out["x_water"] | out["x_barrier"] | out["x_site"]
                      | out["x_street"] | out["x_elevated"] | out["x_not_public"])
    return out


# --------------------------------------------------------------------------- evaluation
@dataclass
class Field:
    """Baseline nearest-destination distance of every node for one essential."""

    dist: np.ndarray
    label: np.ndarray
    ap: pd.DataFrame        # access points: lon, lat, feature label
    snaps: pd.DataFrame


def destination_fields(net: Network, snapper: EdgeSnapper, features: gpd.GeoDataFrame, basket: list[str],
                       detour: float, max_snap: float, cap_m: float) -> dict[str, Field]:
    tax = Taxonomy()
    out = {}
    for k in basket:
        sel = select_destinations(features, tax, k, "core")
        ap = access_points(sel)
        labels = sel.index.to_numpy()[ap["feature"].to_numpy()]
        snaps = snapper.snap(ap["lon"].to_numpy(), ap["lat"].to_numpy())
        nodes, cost, lab = snaps_to_sources(snaps, detour, max_snap, labels=labels.astype(np.int64))
        dist, label = multi_source_dijkstra(net.indptr, net.indices, net.weights, nodes, cost, lab, cap_m)
        out[k] = Field(dist=dist, label=label, ap=ap.assign(label=labels), snaps=snaps)
    return out


class LinkEvaluator:
    """Scores candidate links exactly for the cells of one city."""

    def __init__(self, net: Network, cells: pd.DataFrame, cell_snaps: pd.DataFrame, on_network: np.ndarray,
                 fields: dict[str, Field], detour: float):
        self.net = net
        self.cells = cells
        self.fields = fields
        self.basket = list(fields)
        self.pop = cells["pop"].to_numpy(np.float64)
        self.on = on_network
        self.cu = cell_snaps["u"].to_numpy()
        self.cv = cell_snaps["v"].to_numpy()
        self.ou = cell_snaps["off_u"].to_numpy()
        self.ov = cell_snaps["off_v"].to_numpy()
        self.cs = detour * cell_snaps["snap_m"].to_numpy()
        # baseline distances per cell (identical to the access stage)
        self.d0 = np.column_stack([np.where(on_network, evaluate_at_snaps(fields[k].dist, cell_snaps, detour), np.nan)
                                   for k in self.basket])
        n = net.n_nodes
        nodes = np.concatenate([self.cu, self.cv])
        cidx = np.concatenate([np.arange(len(cells)), np.arange(len(cells))])
        order = np.argsort(nodes, kind="stable")
        self.node_cells = cidx[order]
        self.node_ptr = np.concatenate([[0], np.cumsum(np.bincount(nodes, minlength=n))])
        self.search = BoundedSearch(net.indptr, net.indices, net.weights)
        self._da = np.full(n, np.inf)
        self._db = np.full(n, np.inf)

    def _cells_of(self, nodes: np.ndarray) -> np.ndarray:
        if not len(nodes):
            return np.array([], np.int64)
        starts, ends = self.node_ptr[nodes], self.node_ptr[nodes + 1]
        lens = ends - starts
        idx = np.repeat(starts, lens) + (np.arange(int(lens.sum())) - np.repeat(np.cumsum(lens) - lens, lens))
        return np.unique(self.node_cells[idx])

    def distances(self, a: int, b: int, link_m: float, radius_m: float) -> tuple[np.ndarray, np.ndarray]:
        """(cells within ``radius_m`` of either end, their per-essential distances after the link)."""
        na, ca = self.search.run(np.array([a], np.int64), np.array([0.0]), radius_m)
        nb, cb = self.search.run(np.array([b], np.int64), np.array([0.0]), radius_m)
        self._da[na] = ca
        self._db[nb] = cb
        cells = self._cells_of(np.union1d(na, nb))
        cells = cells[self.on[cells]]
        dha = np.minimum(self._da[self.cu[cells]] + self.ou[cells], self._da[self.cv[cells]] + self.ov[cells]) + self.cs[cells]
        dhb = np.minimum(self._db[self.cu[cells]] + self.ou[cells], self._db[self.cv[cells]] + self.ov[cells]) + self.cs[cells]
        self._da[na] = np.inf
        self._db[nb] = np.inf
        after = np.column_stack([
            distances_with_link(self.d0[cells, j], dha, dhb, link_m, self.fields[k].dist[a], self.fields[k].dist[b])
            for j, k in enumerate(self.basket)])
        return cells, after

    def score(self, a: int, b: int, link_m: float, tau_m: float, radius_m: float | None = None) -> dict:
        cells, after = self.distances(a, b, link_m, radius_m if radius_m is not None else tau_m)
        before = self.d0[cells]
        rb = before <= tau_m
        ra = after <= tau_m
        nb, na = rb.sum(axis=1), ra.sum(axis=1)
        w = self.pop[cells]
        k = len(self.basket)
        out = {
            "residents_gaining": float(w[na > nb].sum()),
            "newly_complete": float(w[(na == k) & (nb < k)].sum()),
            "essentials_gained": float((w * (na - nb)).sum()),
        }
        for j, cat in enumerate(self.basket):
            out[f"gain_{cat}"] = float(w[ra[:, j] & ~rb[:, j]].sum())
        return out


# --------------------------------------------------------------------------- routes
def shortest_path(net: Network, sources: list[tuple[int, float]], extra: tuple[int, int, float] | None,
                  cutoff: float) -> tuple[dict[int, float], dict[int, int]]:
    """Plain Dijkstra with predecessors (for drawing a handful of routes).

    ``extra`` adds one undirected edge (a, b, length) on top of the network.
    """
    dist: dict[int, float] = {}
    pred: dict[int, int] = {}
    heap = []
    for n, c in sources:
        if c < dist.get(n, math.inf):
            dist[n] = c
            pred[n] = -1
            heapq.heappush(heap, (c, n))
    ip, ix, wt = net.indptr, net.indices, net.weights
    while heap:
        c, u = heapq.heappop(heap)
        if c > dist.get(u, math.inf) or c > cutoff:
            continue
        nbrs = [(int(ix[e]), float(wt[e])) for e in range(ip[u], ip[u + 1])]
        if extra is not None:
            if u == extra[0]:
                nbrs.append((extra[1], extra[2]))
            elif u == extra[1]:
                nbrs.append((extra[0], extra[2]))
        for v, w in nbrs:
            nc = c + w
            if nc < dist.get(v, math.inf):
                dist[v] = nc
                pred[v] = u
                heapq.heappush(heap, (nc, v))
    return dist, pred


def _edge_between(net: Network, u: int, v: int) -> int:
    best, best_w = -1, math.inf
    for e in range(net.indptr[u], net.indptr[u + 1]):
        if net.indices[e] == v and net.weights[e] < best_w:
            best, best_w = int(net.csr_edge[e]), float(net.weights[e])
    return best


def _edge_xy(net: Network, e: int, from_node: int) -> np.ndarray:
    lon, lat = net.edge_coords(e)
    x, y = to_metric(lon, lat)
    xy = np.column_stack([x, y])
    return xy if net.edge_u[e] == from_node else xy[::-1]


def _partial_edge(net: Network, e: int, offset_from_u: float, to_node: int) -> np.ndarray:
    """Polyline from the point at ``offset_from_u`` along edge e to one of its ends."""
    xy = _edge_xy(net, e, int(net.edge_u[e]))
    line = shapely.linestrings(xy)
    frac = 0.0 if net.edge_len[e] <= 0 else float(np.clip(offset_from_u / net.edge_len[e], 0, 1))
    if to_node == net.edge_u[e]:
        part = substring(line, 0, frac, normalized=True)
        coords = np.asarray(part.coords)[::-1] if part.geom_type == "LineString" else np.empty((0, 2))
    else:
        part = substring(line, frac, 1, normalized=True)
        coords = np.asarray(part.coords) if part.geom_type == "LineString" else np.empty((0, 2))
    return coords


def route(net: Network, home: pd.Series, field: Field, detour: float, max_snap: float,
          extra: tuple[int, int, float] | None, cutoff: float) -> dict | None:
    """Walking route from a home cell to the nearest destination of one essential."""
    src = [(int(home["u"]), float(home["off_u"])), (int(home["v"]), float(home["off_v"]))]
    dist, pred = shortest_path(net, src, extra, cutoff)
    sn = field.snaps
    ok = (sn["snap_m"] <= max_snap).to_numpy()
    best, best_cost, best_end = None, math.inf, None
    for i in np.flatnonzero(ok):
        r = sn.iloc[i]
        for end, off in ((int(r["u"]), float(r["off_u"])), (int(r["v"]), float(r["off_v"]))):
            if end in dist:
                c = dist[end] + off + detour * float(r["snap_m"])
                if c < best_cost:
                    best, best_cost, best_end = i, c, end
    if best is None:
        return None
    total = best_cost + detour * float(home["snap_m"])
    # node sequence back to the source
    seq = [best_end]
    while pred.get(seq[-1], -1) != -1:
        seq.append(pred[seq[-1]])
    seq = seq[::-1]
    pieces = [_partial_edge(net, int(home["edge"]), float(home["off_u"]), seq[0])]
    used_link = False
    for u, v in zip(seq[:-1], seq[1:]):
        if extra is not None and {u, v} == {extra[0], extra[1]}:
            pieces.append(np.array([[net.x[u], net.y[u]], [net.x[v], net.y[v]]]))
            used_link = True
        else:
            pieces.append(_edge_xy(net, _edge_between(net, u, v), u))
    r = sn.iloc[best]
    dest_edge_from = int(r["u"]) if best_end == int(r["u"]) else int(r["v"])
    off_from_u = float(r["off_u"])
    tail = _partial_edge(net, int(r["edge"]), off_from_u, dest_edge_from)[::-1]
    pieces.append(tail)
    hx, hy = to_metric(np.array([home["lon"]]), np.array([home["lat"]]))
    dx, dy = to_metric(np.array([field.ap["lon"].iloc[best]]), np.array([field.ap["lat"].iloc[best]]))
    xy = np.vstack([[[hx[0], hy[0]]], *[p for p in pieces if len(p)], [[dx[0], dy[0]]]])
    keep = np.concatenate([[True], np.hypot(np.diff(xy[:, 0]), np.diff(xy[:, 1])) > 0.05])
    return {"xy": xy[keep], "length_m": total, "dest_label": int(field.ap["label"].iloc[best]), "uses_link": used_link}


# --------------------------------------------------------------------------- naming
def way_names(way_ids: set[int]) -> dict[int, str]:
    import osmium

    names: dict[int, str] = {}

    class H(osmium.SimpleHandler):
        def way(self, w):
            if w.id in way_ids:
                names[w.id] = w.tags.get("name", "") or w.tags.get("highway", "")

    H().apply_file(str(config.interim("highways.osm.pbf")))
    return names


def nearest_place(lon: float, lat: float, kinds=("neighbourhood", "suburb", "quarter", "village", "town"),
                  max_m: float = 1500.0) -> str | None:
    p = config.interim("basemap", "places.geojsonl")
    if not p.exists():
        return None
    best, best_d = None, max_m
    x0, y0 = to_metric(np.array([lon]), np.array([lat]))
    for line in p.read_text().splitlines():
        f = json.loads(line)
        if f["properties"].get("kind") not in kinds or not f["properties"].get("name"):
            continue
        x, y = to_metric(np.array([f["geometry"]["coordinates"][0]]), np.array([f["geometry"]["coordinates"][1]]))
        d = float(np.hypot(x[0] - x0[0], y[0] - y0[0]))
        if d < best_d:
            best, best_d = f["properties"]["name"], d
    return best


# --------------------------------------------------------------------------- figure
PATH_CLASSES = {"footway", "path", "pedestrian", "steps", "cycleway", "corridor", "bridleway", "track"}
MAJOR_CLASSES = {"trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link"}


def _rel(xy: np.ndarray, origin: tuple[float, float]) -> list:
    return np.round(np.asarray(xy) - np.asarray(origin), 1).tolist()


def _rings(geom) -> list[np.ndarray]:
    out = []
    for g in getattr(geom, "geoms", [geom]):
        if g.is_empty:
            continue
        if g.geom_type == "Polygon":
            out.append(np.asarray(g.exterior.coords))
        elif g.geom_type in ("LineString", "LinearRing"):
            out.append(np.asarray(g.coords))
        elif hasattr(g, "geoms"):
            out.extend(_rings(g))
    return out


def figure_data(net: Network, layers: Layers, box: tuple[float, float, float, float], origin: tuple[float, float],
                cells: pd.DataFrame, n_before: np.ndarray, n_after: np.ndarray, pois: pd.DataFrame) -> dict:
    """Everything a static map of the intervention needs, in metres relative to ``origin``."""
    import h3

    x0, y0, x1, y1 = box
    rect = shapely.box(x0, y0, x1, y1)

    def clipped(key: str, simplify: float = 0.0) -> list:
        geoms = getattr(layers, key)
        if not len(geoms):
            return []
        idx = layers.trees[key].query(rect, predicate="intersects")
        out = []
        for g in shapely.clip_by_rect(geoms[idx], x0, y0, x1, y1):
            if simplify:
                g = shapely.simplify(g, simplify)
            out.extend(_rel(r, origin) for r in _rings(g) if len(r) >= 2)
        return out

    idx = layers.trees["walk_edges"].query(rect, predicate="intersects")
    hw = net.edge_attrs["highway"]
    streets = {"major": [], "minor": [], "path": []}
    for e, g in zip(idx, shapely.clip_by_rect(layers.walk_edges[idx], x0, y0, x1, y1)):
        cls = "path" if hw[e] in PATH_CLASSES else "major" if hw[e] in MAJOR_CLASSES else "minor"
        streets[cls].extend(_rel(r, origin) for r in _rings(g) if len(r) >= 2)
    cx, cy = to_metric(cells["lon"].to_numpy(), cells["lat"].to_numpy())
    inside = (cx >= x0) & (cx <= x1) & (cy >= y0) & (cy <= y1) & (cells["pop"].to_numpy() > 0)
    hexes = []
    for i in np.flatnonzero(inside):
        lat, lon = np.asarray(h3.cell_to_boundary(format(int(cells["h3"].iloc[i]), "x"))).T
        hx, hy = to_metric(lon, lat)
        hexes.append({"ring": _rel(np.column_stack([hx, hy]), origin), "pop": round(float(cells["pop"].iloc[i]), 1),
                      "before": int(n_before[i]), "after": int(n_after[i])})
    px, py = to_metric(pois["lon"].to_numpy(), pois["lat"].to_numpy())
    pin = (px >= x0) & (px <= x1) & (py >= y0) & (py <= y1)
    return {
        "width_m": round(x1 - x0, 1), "height_m": round(y1 - y0, 1),
        "box": [round(x0 - origin[0], 1), round(y0 - origin[1], 1), round(x1 - origin[0], 1), round(y1 - origin[1], 1)],
        "streets": streets,
        "buildings": clipped("buildings", 0.4),
        "water": clipped("water", 1.0),
        "waterways": clipped("waterways", 0.5),
        "hexes": hexes,
        "pois": [{"xy": _rel([x, y], origin), "essential": c, "name": n} for x, y, c, n in
                 zip(px[pin], py[pin], pois["essential"].to_numpy()[pin], pois["name"].to_numpy()[pin])],
    }


# --------------------------------------------------------------------------- stage
def _metric_block(ev: LinkEvaluator, a: int, b: int, ell: float, speeds: dict, thresholds: list[int]) -> dict:
    base = speeds["base"]
    out = {f"{t}min": ev.score(a, b, ell, t * 60 * base) for t in thresholds}
    out["15min_slow"] = ev.score(a, b, ell, 15 * 60 * speeds["slow"])
    out["15min_brisk"] = ev.score(a, b, ell, 15 * 60 * speeds["brisk"])
    return out


def run() -> dict:
    from .form import assign_city

    cfg = config.load("scenarios")["footpath"]
    acc_cfg = config.load("scenarios")["accessibility"]
    snap_cfg = config.load("network")["snapping"]
    detour, max_snap = float(snap_cfg["snap_detour"]), float(snap_cfg["max_snap_m"])
    speeds = acc_cfg["walk_speed_mps"]
    base = speeds["base"]
    tau = acc_cfg["headline_threshold_min"] * 60 * base
    cap_m = acc_cfg["search_cap_min"] * 60 * max(speeds.values())
    basket = config.load("taxonomy")["basket"]
    city = cfg["city"]

    walk = Network.load(config.interim("walk.npz"))
    cells = pd.read_parquet(config.interim("cells.parquet"))
    feats = gpd.read_parquet(config.interim("features.parquet"))
    acc = pd.read_parquet(config.interim("access.parquet"))
    snapper = EdgeSnapper(walk)
    m = (cells["city"] == city).to_numpy()
    cell_snaps = snapper.snap(cells["lon"].to_numpy(), cells["lat"].to_numpy())
    on = acc["on_network"].to_numpy()
    city_cells = cells[m].reset_index(drop=True)
    city_snaps = cell_snaps[m].reset_index(drop=True)

    fields = destination_fields(walk, snapper, feats, basket, detour, max_snap, cap_m)
    ev = LinkEvaluator(walk, city_cells, city_snaps, on[m], fields, detour)

    # the recomputed baseline must equal the published one
    d_pub = acc.loc[m, [f"d_{k}" for k in basket]].to_numpy(np.float64)
    both = np.isfinite(d_pub) & np.isfinite(ev.d0)
    validation = {
        "baseline_cells": int(m.sum()),
        "baseline_max_abs_diff_m": float(np.abs(ev.d0[both] - d_pub[both]).max()),
        "baseline_same_reach_15min": float(((ev.d0 <= tau) == (np.nan_to_num(d_pub, nan=np.inf) <= tau)).mean()),
    }

    node_city = assign_city(walk.lon, walk.lat, cells)
    in_area = node_city == city
    cand = find_candidates(walk, in_area, cfg["max_link_m"], cfg["min_saving_m"])
    lon_c = np.concatenate([walk.lon[cand["a"]], walk.lon[cand["b"]]])
    lat_c = np.concatenate([walk.lat[cand["a"]], walk.lat[cand["b"]]])
    bbox = (float(lon_c.min()) - 0.01, float(lat_c.min()) - 0.01, float(lon_c.max()) + 0.01, float(lat_c.max()) + 0.01)
    layers = load_layers(walk, feats, bbox)
    cand = desk_filter(walk, cand, layers, cfg["building_clearance_m"])
    reasons = {k: int(cand[k].sum()) for k in cand.columns if k.startswith("x_")}
    passed = cand[cand["passes"]].reset_index(drop=True)

    # pass 1: residents gaining an essential within 15 minutes, for every candidate (exact)
    s1 = pd.DataFrame([ev.score(int(r.a), int(r.b), float(r.link_m), tau) for r in passed.itertuples()])
    passed = pd.concat([passed, s1], axis=1).sort_values(["residents_gaining", "newly_complete"], ascending=False)

    # pass 2: distinct places (one candidate per 400 m), full set of measures
    xy_mid = lambda r: ((walk.x[r.a] + walk.x[r.b]) / 2, (walk.y[r.a] + walk.y[r.b]) / 2)  # noqa: E731
    chosen_rows, mids = [], []
    for r in passed.itertuples():
        if r.residents_gaining <= 0:
            break
        p = xy_mid(r)
        if any(math.hypot(p[0] - q[0], p[1] - q[1]) < cfg["distinct_m"] for q in mids):
            continue
        chosen_rows.append(r)
        mids.append(p)
        if len(chosen_rows) >= cfg["alternatives"]:
            break
    unit_names = pd.read_csv(config.derived("neighbourhoods.csv")).set_index("unit_id")["unit_name"].to_dict()
    ctree = cKDTree(np.column_stack(to_metric(city_cells["lon"].to_numpy(), city_cells["lat"].to_numpy())))
    names = way_names({int(walk.edge_attrs["way_id"][e]) for r in chosen_rows for n in (r.a, r.b)
                       for e in walk.csr_edge[walk.indptr[n]:walk.indptr[n + 1]]})
    search = BoundedSearch(walk.indptr, walk.indices, walk.weights)

    def street_of(n: int) -> str:
        ws = [names.get(int(walk.edge_attrs["way_id"][e]), "") for e in walk.csr_edge[walk.indptr[n]:walk.indptr[n + 1]]]
        named = [w for w in ws if w and not w.islower()]
        return named[0] if named else (ws[0] if ws else "")

    def describe(r) -> dict:
        a, b = int(r.a), int(r.b)
        lon_m, lat_m = to_lonlat(*xy_mid(r))
        _, ci = ctree.query(xy_mid(r))
        unit = city_cells["unit_id"].iloc[ci]
        nodes, costs = search.run(np.array([a], np.int64), np.array([0.0]), cap_m)
        today = costs[nodes == b]
        return {
            "a": {"lon": round(float(walk.lon[a]), 6), "lat": round(float(walk.lat[a]), 6), "street": street_of(a)},
            "b": {"lon": round(float(walk.lon[b]), 6), "lat": round(float(walk.lat[b]), 6), "street": street_of(b)},
            "mid": {"lon": round(float(lon_m), 6), "lat": round(float(lat_m), 6)},
            "link_m": round(float(r.link_m), 1),
            "walk_today_m": round(float(today[0]), 0) if len(today) else None,
            "footbridge": bool(r.footbridge),
            "unit_id": unit,
            "unit_name": unit_names.get(unit, unit),
            "place": nearest_place(float(lon_m), float(lat_m)),
            "metrics": _metric_block(ev, a, b, float(r.link_m), speeds, acc_cfg["thresholds_min"][1:]),
        }

    alternatives = [describe(r) for r in chosen_rows]
    best = alternatives[0]
    r0 = chosen_rows[0]
    a, b, ell = int(r0.a), int(r0.b), float(r0.link_m)

    # what changes for whom (15 min, 1.2 m/s), and minutes saved within the wider radius
    cells_i, after = ev.distances(a, b, ell, cfg["report_radius_m"])
    before = ev.d0[cells_i]
    nb_ = (before <= tau).sum(axis=1)
    na_ = (after <= tau).sum(axis=1)
    w = ev.pop[cells_i]
    t_before = np.minimum(before, cap_m) / base / 60
    t_after = np.minimum(after, cap_m) / base / 60
    saved = np.where(np.isfinite(t_before), t_before - t_after, 0.0)
    shorter5 = (saved >= 5).any(axis=1)
    best["changes"] = {
        "residents_considered": float(w.sum()),
        "residents_walk_5min_shorter": float(w[shorter5].sum()),
        "by_essential": [{"essential": k,
                          "residents_newly_within_15min": float(w[(after[:, j] <= tau) & (before[:, j] > tau)].sum()),
                          "median_minutes_before": float(np.median(t_before[(after[:, j] <= tau) & (before[:, j] > tau), j]))
                          if ((after[:, j] <= tau) & (before[:, j] > tau)).any() else None,
                          "median_minutes_after": float(np.median(t_after[(after[:, j] <= tau) & (before[:, j] > tau), j]))
                          if ((after[:, j] <= tau) & (before[:, j] > tau)).any() else None}
                         for j, k in enumerate(basket)],
        "essentials_reached": {"before": {str(i): float(w[nb_ == i].sum()) for i in range(len(basket) + 1)},
                               "after": {str(i): float(w[na_ == i].sum()) for i in range(len(basket) + 1)}},
    }

    # sample homes: largest gains, spread out; route to the essential with the most minutes saved
    gain_cells = np.flatnonzero(na_ > nb_)
    order = gain_cells[np.argsort(-(w[gain_cells] * (na_ - nb_)[gain_cells]))]
    hx, hy = to_metric(city_cells["lon"].to_numpy()[cells_i], city_cells["lat"].to_numpy()[cells_i])
    picks: list[int] = []
    for i in order:
        if all(math.hypot(hx[i] - hx[j], hy[i] - hy[j]) >= cfg["sample_spacing_m"] for j in picks):
            picks.append(int(i))
        if len(picks) >= cfg["sample_routes"]:
            break
    homes = city_snaps.assign(lon=city_cells["lon"], lat=city_cells["lat"])
    routes, route_ok = [], True
    for i in picks:
        gained = np.flatnonzero((after[i] <= tau) & (before[i] > tau))
        j = int(gained[np.argmax(saved[i, gained])])
        k = basket[j]
        home = homes.iloc[int(cells_i[i])]
        rb = route(walk, home, fields[k], detour, max_snap, None, max(cap_m, before[i, j] + 100))
        ra = route(walk, home, fields[k], detour, max_snap, (a, b, ell), after[i, j] + 100)
        route_ok &= rb is not None and ra is not None and abs(rb["length_m"] - before[i, j]) < 1.0 \
            and abs(ra["length_m"] - after[i, j]) < 1.0 and ra["uses_link"]
        routes.append({"essential": k, "home": {"lon": float(home["lon"]), "lat": float(home["lat"])},
                       "residents": round(float(w[i]), 1), "unit_id": city_cells["unit_id"].iloc[int(cells_i[i])],
                       "before": rb, "after": ra})
    validation["routes_match_engine"] = bool(route_ok)

    # figure: the link, both routes of every sample home, and some margin
    xs = [walk.x[a], walk.x[b]] + [p for rt in routes for leg in ("before", "after") for p in rt[leg]["xy"][:, 0]]
    ys = [walk.y[a], walk.y[b]] + [p for rt in routes for leg in ("before", "after") for p in rt[leg]["xy"][:, 1]]
    pad = cfg["figure_margin_m"]
    x0, x1, y0, y1 = min(xs) - pad, max(xs) + pad, min(ys) - pad, max(ys) + pad
    aspect = cfg["figure_aspect"]
    if (x1 - x0) / (y1 - y0) < aspect:
        grow = ((y1 - y0) * aspect - (x1 - x0)) / 2
        x0, x1 = x0 - grow, x1 + grow
    else:
        grow = ((x1 - x0) / aspect - (y1 - y0)) / 2
        y0, y1 = y0 - grow, y1 + grow
    origin = ((walk.x[a] + walk.x[b]) / 2, (walk.y[a] + walk.y[b]) / 2)
    nb_all = (ev.d0 <= tau).sum(axis=1)
    na_all = nb_all.copy()
    na_all[cells_i] = na_
    pois = pd.concat([pd.DataFrame({"lon": feats.loc[sel, "lon"], "lat": feats.loc[sel, "lat"], "essential": k,
                                    "name": feats.loc[sel, "name"].fillna("")})
                      for k in basket for sel in [select_destinations(feats, Taxonomy(), k, "core").index]])
    fig = figure_data(walk, layers, (x0, y0, x1, y1), origin, city_cells, nb_all, na_all, pois)
    fig["link"] = _rel(np.array([[walk.x[a], walk.y[a]], [walk.x[b], walk.y[b]]]), origin)
    for rt in routes:
        for leg in ("before", "after"):
            r = rt[leg]
            label = r.pop("dest_label")
            r["xy"] = _rel(r["xy"], origin)
            r["minutes"] = round(r["length_m"] / base / 60, 1)
            r["length_m"] = round(r["length_m"], 0)
            r["destination"] = {"name": str(feats.loc[label, "name"] or ""),
                                "kind": str(feats.loc[label, "amenity"] or feats.loc[label, "shop"] or feats.loc[label, "healthcare"] or "")}

    return {
        "question": cfg["question"],
        "city": city,
        "parameters": {k: cfg[k] for k in ("max_link_m", "min_saving_m", "building_clearance_m", "report_radius_m")}
        | {"walk_speed_mps": base, "threshold_min": acc_cfg["headline_threshold_min"]},
        "assumptions": cfg["assumptions"],
        "site_checks": cfg["site_checks"],
        "screening": {"dead_ends_paired": int(len(cand)), "rejected_by": reasons, "passed_desk_filters": int(len(passed)),
                      "with_any_gain": int((passed["residents_gaining"] > 0).sum())},
        "validation": validation,
        "chosen": best,
        "alternatives": alternatives[1:],
        "routes": routes,
        "figure": fig,
    }


def write(result: dict) -> None:
    text = json.dumps(result, ensure_ascii=False, separators=(",", ":"), default=float)
    config.derived("footpath.json").write_text(json.dumps({k: v for k, v in result.items() if k != "figure"}, indent=1,
                                                          ensure_ascii=False, default=float))
    out = config.ROOT / "web" / "public" / "data" / "footpath.json"
    out.write_text(text)
