"""Network construction, cleaning and edge snapping."""

import numpy as np
import pytest

from sgjb.dijkstra import multi_source_dijkstra
from sgjb.geo import haversine_m
from sgjb.graph import EdgeSnapper, build_network, evaluate_at_snaps, snaps_to_sources


def toy_network():
    """A 3-edge path A-B-C-D along the equator plus an isolated 1-edge island.

    0.001° of longitude at the equator ≈ 111.3 m.
    """
    polylines = [
        (1, 2, [(103.800, 1.300), (103.8005, 1.300), (103.801, 1.300)]),   # A-B with a mid vertex
        (2, 3, [(103.801, 1.300), (103.802, 1.300)]),                     # B-C
        (3, 4, [(103.802, 1.300), (103.802, 1.301)]),                     # C-D (north)
        (8, 9, [(103.900, 1.400), (103.9001, 1.400)]),                    # island
    ]
    u = np.array([p[0] for p in polylines])
    v = np.array([p[1] for p in polylines])
    lens = [len(p[2]) for p in polylines]
    ptr = np.concatenate([[0], np.cumsum(lens)])
    lon = np.array([c[0] for p in polylines for c in p[2]])
    lat = np.array([c[1] for p in polylines for c in p[2]])
    attrs = {"highway": np.array(["footway", "residential", "residential", "service"])}
    return build_network(u, v, ptr, lon, lat, attrs=attrs)


def test_lengths_are_geodesic():
    net = toy_network()
    assert net.n_nodes == 6 and net.n_edges == 4
    ab = haversine_m(103.800, 1.300, 103.801, 1.300)
    e = int(np.flatnonzero((net.node_id[net.edge_u] == 1) & (net.node_id[net.edge_v] == 2))[0])
    assert net.edge_len[e] == pytest.approx(ab, rel=1e-6)


def test_csr_is_symmetric_for_undirected():
    net = toy_network()
    assert len(net.indices) == 2 * net.n_edges
    arcs = set()
    for u in range(net.n_nodes):
        for k in range(net.indptr[u], net.indptr[u + 1]):
            arcs.add((u, int(net.indices[k])))
    assert all((v, u) in arcs for (u, v) in arcs)


def test_drop_small_components_removes_island():
    net = toy_network().drop_small_components(min_nodes=3)
    assert net.n_edges == 3
    assert set(net.node_id.tolist()) == {1, 2, 3, 4}
    assert net.edge_attrs["highway"].tolist().count("service") == 0


def test_edge_snapping_mid_edge():
    net = toy_network().drop_small_components(3)
    snapper = EdgeSnapper(net, step=10.0)
    # a point 20 m north of the middle of B-C
    snaps = snapper.snap(np.array([103.8015]), np.array([1.300 + 20 / 111_320]))
    row = snaps.iloc[0]
    ends = {int(net.node_id[int(row.u)]), int(net.node_id[int(row.v)])}
    assert ends == {2, 3}
    assert row.snap_m == pytest.approx(20.0, abs=6.0)
    assert row.off_u + row.off_v == pytest.approx(net.edge_len[int(row.edge)], rel=1e-6)
    assert row.off_u == pytest.approx(net.edge_len[int(row.edge)] / 2, abs=6.0)


def test_source_and_evaluation_roundtrip():
    """A destination at D and an origin at A: time equals path length (+ snaps)."""
    net = toy_network().drop_small_components(3)
    snapper = EdgeSnapper(net, step=10.0)
    dest = snapper.snap(np.array([103.802]), np.array([1.301]))
    nodes, cost, lab = snaps_to_sources(dest, detour=1.0, max_snap_m=250)
    dist, _ = multi_source_dijkstra(net.indptr, net.indices, net.weights, nodes, cost, lab, np.inf)
    origin = snapper.snap(np.array([103.800]), np.array([1.300]))
    t = evaluate_at_snaps(dist, origin, detour=1.0)[0]
    expected = haversine_m(103.800, 1.3, 103.802, 1.3) + haversine_m(103.802, 1.3, 103.802, 1.301)
    assert t == pytest.approx(expected, abs=2.0)


def test_far_destinations_are_dropped():
    net = toy_network().drop_small_components(3)
    snapper = EdgeSnapper(net)
    far = snapper.snap(np.array([103.81]), np.array([1.31]))
    nodes, cost, lab = snaps_to_sources(far, detour=1.3, max_snap_m=250)
    assert len(nodes) == 0
