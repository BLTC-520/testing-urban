"""Shortest-path kernels must agree with scipy's reference Dijkstra."""

import math

import numpy as np
import pytest
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra as sp_dijkstra

from sgjb.dijkstra import BoundedSearch, accumulate_reach, multi_source_dijkstra


def random_graph(n=300, m=1200, seed=0):
    rng = np.random.default_rng(seed)
    u = rng.integers(0, n, m)
    v = rng.integers(0, n, m)
    keep = u != v
    u, v = u[keep], v[keep]
    w = rng.uniform(1, 100, len(u))
    # undirected: both directions
    src = np.concatenate([u, v])
    dst = np.concatenate([v, u])
    ww = np.concatenate([w, w])
    order = np.lexsort((dst, src))
    src, dst, ww = src[order], dst[order], ww[order]
    indptr = np.concatenate([[0], np.cumsum(np.bincount(src, minlength=n))]).astype(np.int64)
    return n, indptr, dst.astype(np.int64), ww.astype(np.float64)


@pytest.mark.parametrize("seed", [0, 1, 2])
def test_multi_source_matches_scipy(seed):
    """Multi-source search with initial costs == min over per-source scipy runs."""
    n, indptr, indices, weights = random_graph(seed=seed)
    rng = np.random.default_rng(seed + 10)
    sources = rng.integers(0, n, 7)
    costs = rng.uniform(0, 30, 7)
    labels = np.arange(7)
    dist, lab = multi_source_dijkstra(indptr, indices, weights, sources.astype(np.int64), costs, labels, np.inf)
    # scipy sums parallel edges in a csr, so build the reference with the minimum weight
    per = sp_dijkstra(_min_csr(n, indptr, indices, weights), directed=True, indices=sources)
    ref = np.min(per + costs[:, None], axis=0)
    np.testing.assert_allclose(dist, ref, rtol=1e-9, atol=1e-9)
    # label is the argmin source (ties are acceptable if equal cost)
    reached = np.isfinite(ref)
    chosen_cost = (per + costs[:, None])[lab[reached], np.flatnonzero(reached)]
    np.testing.assert_allclose(chosen_cost, ref[reached], rtol=1e-9)


def _min_csr(n, indptr, indices, weights):
    """Build a csr keeping the minimum weight among parallel edges."""
    best = {}
    for u in range(n):
        for e in range(indptr[u], indptr[u + 1]):
            k = (u, int(indices[e]))
            w = weights[e]
            if k not in best or w < best[k]:
                best[k] = w
    rows = [k[0] for k in best]
    cols = [k[1] for k in best]
    vals = list(best.values())
    return csr_matrix((vals, (rows, cols)), shape=(n, n))


def test_cutoff_and_unreached():
    n, indptr, indices, weights = random_graph(seed=5)
    dist, lab = multi_source_dijkstra(indptr, indices, weights, np.array([0], np.int64), np.array([0.0]),
                                      np.array([0], np.int64), 50.0)
    assert np.all(dist[np.isfinite(dist)] <= 50.0)
    assert np.all(lab[~np.isfinite(dist)] == -1)
    full, _ = multi_source_dijkstra(indptr, indices, weights, np.array([0], np.int64), np.array([0.0]),
                                    np.array([0], np.int64), np.inf)
    inside = full <= 50.0
    np.testing.assert_allclose(dist[inside], full[inside])


def test_accumulate_reach_counts_and_gravity():
    n, indptr, indices, weights = random_graph(n=200, m=700, seed=3)
    g = _min_csr(n, indptr, indices, weights)
    rng = np.random.default_rng(4)
    groups = [rng.integers(0, n, rng.integers(1, 4)) for _ in range(25)]
    gcost = [rng.uniform(0, 10, len(gr)) for gr in groups]
    group_ptr = np.concatenate([[0], np.cumsum([len(gr) for gr in groups])]).astype(np.int64)
    group_nodes = np.concatenate(groups).astype(np.int64)
    group_cost = np.concatenate(gcost)
    thresholds = np.array([40.0, 80.0, 150.0])
    beta = math.log(2) / 60.0
    counts, grav = accumulate_reach(indptr, indices, weights, group_ptr, group_nodes, group_cost,
                                    thresholds, beta, 120.0)
    ref_counts = np.zeros((3, n), int)
    ref_grav = np.zeros(n)
    for gr, gc in zip(groups, gcost):
        d = np.min(sp_dijkstra(g, directed=True, indices=gr) + gc[:, None], axis=0)
        for t, thr in enumerate(thresholds):
            ref_counts[t] += d <= thr
        ref_grav += np.where(d <= 120.0, np.exp(-beta * np.where(np.isfinite(d), d, 0)), 0.0)
    np.testing.assert_array_equal(counts, ref_counts)
    np.testing.assert_allclose(grav, ref_grav, rtol=1e-9, atol=1e-12)


def test_bounded_search_reuse_is_clean():
    n, indptr, indices, weights = random_graph(seed=9)
    g = _min_csr(n, indptr, indices, weights)
    bs = BoundedSearch(indptr, indices, weights)
    for src in [0, 5, 17, 0]:
        nodes, costs = bs.run(np.array([src]), np.array([0.0]), 120.0)
        ref = sp_dijkstra(g, directed=True, indices=src)
        mask = ref <= 120.0
        assert set(nodes.tolist()) == set(np.flatnonzero(mask).tolist())
        np.testing.assert_allclose(costs[np.argsort(nodes)], ref[np.sort(nodes)], rtol=1e-9)
    # buffers fully reset between runs
    assert np.all(np.isinf(bs.dist))
