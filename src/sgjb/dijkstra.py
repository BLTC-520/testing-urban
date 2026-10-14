"""Shortest-path kernels on CSR graphs, compiled with numba.

All kernels are weight-agnostic: the walk network uses metres (so one search
serves every walking speed, since time = distance / speed), the transit and
drive models use seconds.

Kernels
-------
multi_source_dijkstra
    Distance from every node to the *nearest* of many sources (e.g. "walking
    distance to the nearest clinic" for the whole city in one pass).
accumulate_reach
    For many source groups (each POI may have several access points), count how
    many groups reach every node within several cutoffs, plus a gravity sum.
    This yields cumulative-opportunity and gravity accessibility for all nodes.
BoundedSearch
    Repeated bounded searches that reuse buffers (catchments, isochrones,
    site-selection coverage) without O(n) re-initialisation per call.

The heap is a hand-rolled binary heap with lazy deletion on preallocated
arrays; correctness is tested against ``scipy.sparse.csgraph.dijkstra``.
"""

from __future__ import annotations

import math

import numpy as np
from numba import njit

INF = np.inf


@njit(cache=True, inline="always")
def _push(hc, hn, size, c, n):
    i = size
    hc[i] = c
    hn[i] = n
    while i > 0:
        p = (i - 1) >> 1
        if hc[p] <= hc[i]:
            break
        tc = hc[p]
        hc[p] = hc[i]
        hc[i] = tc
        tn = hn[p]
        hn[p] = hn[i]
        hn[i] = tn
        i = p
    return size + 1


@njit(cache=True, inline="always")
def _pop(hc, hn, size):
    c = hc[0]
    n = hn[0]
    size -= 1
    if size > 0:
        hc[0] = hc[size]
        hn[0] = hn[size]
        i = 0
        while True:
            left = 2 * i + 1
            if left >= size:
                break
            m = left
            right = left + 1
            if right < size and hc[right] < hc[left]:
                m = right
            if hc[m] >= hc[i]:
                break
            tc = hc[m]
            hc[m] = hc[i]
            hc[i] = tc
            tn = hn[m]
            hn[m] = hn[i]
            hn[i] = tn
            i = m
    return c, n, size


@njit(cache=True)
def multi_source_dijkstra(indptr, indices, weights, sources, source_cost, source_label, cutoff):
    """Nearest-source distances for all nodes.

    Parameters
    ----------
    indptr, indices, weights : CSR adjacency (directed; store both directions for undirected graphs).
    sources : int64[k] node indices; a node may appear several times.
    source_cost : float64[k] initial cost at each source (e.g. snap distance of a POI).
    source_label : int64[k] identifier propagated to reached nodes (e.g. POI id).
    cutoff : searches stop beyond this cost; unreached nodes keep +inf / label -1.
    """
    n = indptr.shape[0] - 1
    dist = np.full(n, np.inf)
    label = np.full(n, -1, dtype=np.int64)
    cap = indices.shape[0] + sources.shape[0] + 1
    hc = np.empty(cap, dtype=np.float64)
    hn = np.empty(cap, dtype=np.int64)
    size = 0
    for k in range(sources.shape[0]):
        s = sources[k]
        c = source_cost[k]
        if c < dist[s] and c <= cutoff:
            dist[s] = c
            label[s] = source_label[k]
            size = _push(hc, hn, size, c, s)
    while size > 0:
        c, u, size = _pop(hc, hn, size)
        if c > dist[u]:
            continue
        lu = label[u]
        for e in range(indptr[u], indptr[u + 1]):
            v = indices[e]
            nc = c + weights[e]
            if nc < dist[v] and nc <= cutoff:
                dist[v] = nc
                label[v] = lu
                size = _push(hc, hn, size, nc, v)
    return dist, label


@njit(cache=True)
def accumulate_reach(indptr, indices, weights, group_ptr, group_nodes, group_cost, thresholds, beta, gravity_cutoff):
    """Cumulative opportunities and gravity accessibility for every node.

    Each group g (a destination with access points group_nodes[group_ptr[g]:group_ptr[g+1]])
    is searched once with a bounded Dijkstra. Every node settled within
    thresholds[t] gets counts[t, node] += 1 (a destination is counted once even if
    several access points reach the node); within ``gravity_cutoff`` it gets
    gravity[node] += exp(-beta * d).

    thresholds must be sorted ascending.
    """
    n = indptr.shape[0] - 1
    nt = thresholds.shape[0]
    counts = np.zeros((nt, n), dtype=np.int32)
    gravity = np.zeros(n, dtype=np.float64)
    max_cut = thresholds[nt - 1]
    if gravity_cutoff > max_cut:
        max_cut = gravity_cutoff
    dist = np.full(n, np.inf)
    touched = np.empty(n, dtype=np.int64)
    cap = indices.shape[0] + group_nodes.shape[0] + 1
    hc = np.empty(cap, dtype=np.float64)
    hn = np.empty(cap, dtype=np.int64)
    ngroups = group_ptr.shape[0] - 1
    for g in range(ngroups):
        ntouched = 0
        size = 0
        for k in range(group_ptr[g], group_ptr[g + 1]):
            s = group_nodes[k]
            c = group_cost[k]
            if c < dist[s] and c <= max_cut:
                if dist[s] == np.inf:
                    touched[ntouched] = s
                    ntouched += 1
                dist[s] = c
                size = _push(hc, hn, size, c, s)
        while size > 0:
            c, u, size = _pop(hc, hn, size)
            if c > dist[u]:
                continue
            for t in range(nt):
                if c <= thresholds[t]:
                    counts[t, u] += 1
            if c <= gravity_cutoff:
                gravity[u] += math.exp(-beta * c)
            for e in range(indptr[u], indptr[u + 1]):
                v = indices[e]
                nc = c + weights[e]
                if nc < dist[v] and nc <= max_cut:
                    if dist[v] == np.inf:
                        touched[ntouched] = v
                        ntouched += 1
                    dist[v] = nc
                    size = _push(hc, hn, size, nc, v)
        for i in range(ntouched):
            dist[touched[i]] = np.inf
    return counts, gravity


@njit(cache=True)
def _bounded(indptr, indices, weights, sources, source_cost, cutoff, dist, touched, hc, hn):
    """Bounded multi-source search writing into caller-owned buffers.

    Returns the number of touched nodes; dist[touched[:k]] holds final costs
    (entries may exceed cutoff only if never relaxed below it — they are inf).
    The caller must reset dist for touched nodes before the next call.
    """
    ntouched = 0
    size = 0
    for k in range(sources.shape[0]):
        s = sources[k]
        c = source_cost[k]
        if c < dist[s] and c <= cutoff:
            if dist[s] == np.inf:
                touched[ntouched] = s
                ntouched += 1
            dist[s] = c
            size = _push(hc, hn, size, c, s)
    while size > 0:
        c, u, size = _pop(hc, hn, size)
        if c > dist[u]:
            continue
        for e in range(indptr[u], indptr[u + 1]):
            v = indices[e]
            nc = c + weights[e]
            if nc < dist[v] and nc <= cutoff:
                if dist[v] == np.inf:
                    touched[ntouched] = v
                    ntouched += 1
                dist[v] = nc
                size = _push(hc, hn, size, nc, v)
    return ntouched


@njit(cache=True)
def _reset(dist, touched, k):
    for i in range(k):
        dist[touched[i]] = np.inf


class BoundedSearch:
    """Reusable bounded multi-source Dijkstra for many small searches."""

    def __init__(self, indptr: np.ndarray, indices: np.ndarray, weights: np.ndarray):
        self.indptr = indptr
        self.indices = indices
        self.weights = weights
        n = indptr.shape[0] - 1
        self.dist = np.full(n, np.inf)
        self.touched = np.empty(n, dtype=np.int64)
        cap = indices.shape[0] + 1024
        self.hc = np.empty(cap, dtype=np.float64)
        self.hn = np.empty(cap, dtype=np.int64)

    def run(self, sources, source_cost, cutoff: float) -> tuple[np.ndarray, np.ndarray]:
        """Return (nodes, costs) of all nodes reached within ``cutoff``."""
        sources = np.ascontiguousarray(sources, dtype=np.int64)
        source_cost = np.ascontiguousarray(source_cost, dtype=np.float64)
        if sources.shape[0] + self.indices.shape[0] + 1 > self.hc.shape[0]:
            cap = sources.shape[0] + self.indices.shape[0] + 1024
            self.hc = np.empty(cap, dtype=np.float64)
            self.hn = np.empty(cap, dtype=np.int64)
        k = _bounded(self.indptr, self.indices, self.weights, sources, source_cost, float(cutoff),
                     self.dist, self.touched, self.hc, self.hn)
        nodes = self.touched[:k].copy()
        costs = self.dist[nodes].copy()
        _reset(self.dist, self.touched, k)
        keep = np.isfinite(costs)
        return nodes[keep], costs[keep]
