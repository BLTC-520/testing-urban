"""The one-footpath scenario: exact link formula, candidate search and desk filters."""

from __future__ import annotations

import numpy as np
import shapely

from sgjb.dijkstra import multi_source_dijkstra
from sgjb.footpath import Layers, desk_filter, distances_with_link, find_candidates
from sgjb.graph import build_network


def _csr(n: int, u: np.ndarray, v: np.ndarray, w: np.ndarray):
    src = np.concatenate([u, v])
    dst = np.concatenate([v, u])
    ww = np.concatenate([w, w])
    order = np.lexsort((dst, src))
    src, dst, ww = src[order], dst[order], ww[order]
    indptr = np.concatenate([[0], np.cumsum(np.bincount(src, minlength=n))]).astype(np.int64)
    return indptr, dst.astype(np.int64), ww.astype(np.float64)


def _dists(n, u, v, w, sources):
    ip, ix, ww = _csr(n, u, v, w)
    s = np.asarray(sources, np.int64)
    d, _ = multi_source_dijkstra(ip, ix, ww, s, np.zeros(len(s)), np.arange(len(s), dtype=np.int64), np.inf)
    return d


def test_link_formula_equals_full_recompute():
    rng = np.random.default_rng(7)
    for _ in range(20):
        n = 120
        # a sparse random graph, possibly disconnected
        m = 160
        u = rng.integers(0, n, m)
        v = rng.integers(0, n, m)
        keep = u != v
        u, v = u[keep], v[keep]
        w = rng.uniform(5, 200, len(u))
        dest = rng.choice(n, 4, replace=False)
        a, b = rng.choice(n, 2, replace=False)
        link = float(rng.uniform(1, 80))
        field = _dists(n, u, v, w, dest)                 # D_k at every node
        d_a = _dists(n, u, v, w, [a])                    # node → a (undirected)
        d_b = _dists(n, u, v, w, [b])
        expected = _dists(n, np.append(u, a), np.append(v, b), np.append(w, link), dest)
        got = distances_with_link(field, d_a, d_b, link, field[a], field[b])
        both = np.isfinite(expected)
        assert np.array_equal(both, np.isfinite(got))
        np.testing.assert_allclose(got[both], expected[both], rtol=0, atol=1e-9)


def _two_cul_de_sacs(gap_deg: float = 0.0002):
    """Two dead-end streets 22 m apart, joined only by a ~1.3 km loop to the north."""
    x0, x1, y0, y1 = 103.70, 103.702, 1.50, 1.505
    a_end, b_start = 103.701, 103.701 + gap_deg
    lines = [
        [(x0, y0), (a_end, y0)],                 # street A, dead end at its east end
        [(b_start, y0), (x1, y0)],               # street B, dead end at its west end
        [(x0, y0), (x0, y1), (x1, y1), (x1, y0)],  # the long way round
    ]
    ids = {}
    u_osm, v_osm, ptr, lon, lat = [], [], [0], [], []
    for line in lines:
        for p in (line[0], line[-1]):
            ids.setdefault(p, len(ids) + 1)
        u_osm.append(ids[line[0]])
        v_osm.append(ids[line[-1]])
        lon.extend(p[0] for p in line)
        lat.extend(p[1] for p in line)
        ptr.append(len(lon))
    n = len(lines)
    attrs = {"highway": np.array(["residential"] * n), "bridge": np.zeros(n, bool), "tunnel": np.zeros(n, bool)}
    return build_network(np.array(u_osm), np.array(v_osm), np.array(ptr), np.array(lon), np.array(lat), attrs=attrs)


def test_finds_the_missing_link():
    net = _two_cul_de_sacs()
    cand = find_candidates(net, np.ones(net.n_nodes, bool), max_link_m=80, min_saving_m=400)
    assert len(cand) == 1
    a, b = int(cand["a"].iloc[0]), int(cand["b"].iloc[0])
    assert 20 < cand["link_m"].iloc[0] < 25
    ends = {(round(net.lon[a], 4), round(net.lat[a], 4)), (round(net.lon[b], 4), round(net.lat[b], 4))}
    assert ends == {(103.701, 1.5), (103.7012, 1.5)}
    # a shorter detour than min_saving is not a missing link
    assert find_candidates(net, np.ones(net.n_nodes, bool), max_link_m=80, min_saving_m=5000).empty


def _layers(net, buildings=()):
    from sgjb.geo import to_metric

    empty = np.array([], dtype=object)
    edges = []
    for e in range(net.n_edges):
        lon, lat = net.edge_coords(e)
        x, y = to_metric(lon, lat)
        edges.append(shapely.linestrings(np.column_stack([x, y])))
    return Layers(buildings=np.array(list(buildings), dtype=object), water=empty, blocking_lines=empty,
                  footbridge_lines=empty, sites=empty, walk_edges=np.array(edges, dtype=object), waterways=empty)


def test_desk_filter_blocks_buildings():
    from sgjb.geo import to_metric

    net = _two_cul_de_sacs()
    cand = find_candidates(net, np.ones(net.n_nodes, bool), max_link_m=80, min_saving_m=400)
    clear = desk_filter(net, cand, _layers(net), clearance_m=2.0)
    assert bool(clear["passes"].iloc[0])
    # a house standing in the gap
    x, y = to_metric(np.array([103.7011]), np.array([1.50]))
    house = shapely.box(x[0] - 4, y[0] - 6, x[0] + 4, y[0] + 6)
    blocked = desk_filter(net, cand, _layers(net, [house]), clearance_m=2.0)
    assert bool(blocked["x_building"].iloc[0]) and not bool(blocked["passes"].iloc[0])
