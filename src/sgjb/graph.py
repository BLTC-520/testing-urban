"""Network data structure (CSR), connectivity cleaning and point-to-edge snapping."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

from .geo import haversine_m, to_metric


@dataclass
class Network:
    """A street network.

    Nodes are OSM nodes where ways meet or end; edges are the way pieces
    between them, with their full polyline geometry kept for snapping and
    drawing. ``indptr/indices/weights`` is the CSR adjacency used by the
    kernels in :mod:`sgjb.dijkstra`; ``csr_edge`` maps each CSR arc back to its
    edge row.
    """

    node_id: np.ndarray
    lon: np.ndarray
    lat: np.ndarray
    edge_u: np.ndarray
    edge_v: np.ndarray
    edge_len: np.ndarray
    geom_ptr: np.ndarray
    geom_lon: np.ndarray
    geom_lat: np.ndarray
    edge_attrs: dict[str, np.ndarray] = field(default_factory=dict)
    directed: bool = False
    arc_weight: np.ndarray | None = None   # per-edge weight for CSR (defaults to edge_len)
    arc_reverse_ok: np.ndarray | None = None  # directed graphs: whether v->u is allowed
    # derived
    x: np.ndarray | None = None
    y: np.ndarray | None = None
    indptr: np.ndarray | None = None
    indices: np.ndarray | None = None
    weights: np.ndarray | None = None
    csr_edge: np.ndarray | None = None

    def __post_init__(self) -> None:
        self.x, self.y = to_metric(self.lon, self.lat)
        self.build_csr()

    @property
    def n_nodes(self) -> int:
        return int(self.node_id.shape[0])

    @property
    def n_edges(self) -> int:
        return int(self.edge_u.shape[0])

    def build_csr(self) -> None:
        w = self.edge_len.astype(np.float64) if self.arc_weight is None else self.arc_weight.astype(np.float64)
        eidx = np.arange(self.n_edges, dtype=np.int64)
        if self.directed:
            fwd_u, fwd_v, fwd_w, fwd_e = self.edge_u, self.edge_v, w, eidx
            rev_mask = self.arc_reverse_ok if self.arc_reverse_ok is not None else np.zeros(self.n_edges, bool)
            src = np.concatenate([fwd_u, self.edge_v[rev_mask]])
            dst = np.concatenate([fwd_v, self.edge_u[rev_mask]])
            ww = np.concatenate([fwd_w, w[rev_mask]])
            ee = np.concatenate([fwd_e, eidx[rev_mask]])
        else:
            src = np.concatenate([self.edge_u, self.edge_v])
            dst = np.concatenate([self.edge_v, self.edge_u])
            ww = np.concatenate([w, w])
            ee = np.concatenate([eidx, eidx])
        order = np.lexsort((dst, src))
        src, dst, ww, ee = src[order], dst[order], ww[order], ee[order]
        counts = np.bincount(src, minlength=self.n_nodes)
        self.indptr = np.concatenate([[0], np.cumsum(counts)]).astype(np.int64)
        self.indices = dst.astype(np.int64)
        self.weights = ww.astype(np.float64)
        self.csr_edge = ee.astype(np.int64)

    # ------------------------------------------------------------------ io
    def save(self, path: Path) -> None:
        arrays = dict(
            node_id=self.node_id, lon=self.lon, lat=self.lat, edge_u=self.edge_u, edge_v=self.edge_v,
            edge_len=self.edge_len, geom_ptr=self.geom_ptr, geom_lon=self.geom_lon, geom_lat=self.geom_lat,
            directed=np.array([self.directed]),
        )
        if self.arc_weight is not None:
            arrays["arc_weight"] = self.arc_weight
        if self.arc_reverse_ok is not None:
            arrays["arc_reverse_ok"] = self.arc_reverse_ok
        for k, v in self.edge_attrs.items():
            arrays[f"attr__{k}"] = v
        np.savez_compressed(path, **arrays)

    @classmethod
    def load(cls, path: Path) -> "Network":
        z = np.load(path, allow_pickle=False)
        attrs = {k[6:]: z[k] for k in z.files if k.startswith("attr__")}
        return cls(
            node_id=z["node_id"], lon=z["lon"], lat=z["lat"], edge_u=z["edge_u"], edge_v=z["edge_v"],
            edge_len=z["edge_len"], geom_ptr=z["geom_ptr"], geom_lon=z["geom_lon"], geom_lat=z["geom_lat"],
            edge_attrs=attrs, directed=bool(z["directed"][0]),
            arc_weight=z["arc_weight"] if "arc_weight" in z.files else None,
            arc_reverse_ok=z["arc_reverse_ok"] if "arc_reverse_ok" in z.files else None,
        )

    # ------------------------------------------------------------ cleaning
    def component_labels(self) -> np.ndarray:
        n = self.n_nodes
        m = coo_matrix((np.ones(self.n_edges), (self.edge_u, self.edge_v)), shape=(n, n))
        _, labels = connected_components(m, directed=False)
        return labels

    def subset_edges(self, keep_edge: np.ndarray) -> "Network":
        """Keep a subset of edges and drop nodes that become isolated."""
        keep_edge = np.asarray(keep_edge, dtype=bool)
        used = np.zeros(self.n_nodes, dtype=bool)
        used[self.edge_u[keep_edge]] = True
        used[self.edge_v[keep_edge]] = True
        new_index = -np.ones(self.n_nodes, dtype=np.int64)
        new_index[used] = np.arange(int(used.sum()))
        starts, ends = self.geom_ptr[:-1][keep_edge], self.geom_ptr[1:][keep_edge]
        lens = ends - starts
        geom_ptr = np.concatenate([[0], np.cumsum(lens)]).astype(np.int64)
        idx = np.arange(int(lens.sum()), dtype=np.int64) + np.repeat(starts - geom_ptr[:-1], lens)
        return Network(
            node_id=self.node_id[used], lon=self.lon[used], lat=self.lat[used],
            edge_u=new_index[self.edge_u[keep_edge]], edge_v=new_index[self.edge_v[keep_edge]],
            edge_len=self.edge_len[keep_edge], geom_ptr=geom_ptr,
            geom_lon=self.geom_lon[idx], geom_lat=self.geom_lat[idx],
            edge_attrs={k: v[keep_edge] for k, v in self.edge_attrs.items()},
            directed=self.directed,
            arc_weight=None if self.arc_weight is None else self.arc_weight[keep_edge],
            arc_reverse_ok=None if self.arc_reverse_ok is None else self.arc_reverse_ok[keep_edge],
        )

    def drop_small_components(self, min_nodes: int) -> "Network":
        labels = self.component_labels()
        sizes = np.bincount(labels)
        good = sizes[labels] >= min_nodes
        return self.subset_edges(good[self.edge_u] & good[self.edge_v])

    # ------------------------------------------------------------ geometry
    def edge_coords(self, e: int) -> tuple[np.ndarray, np.ndarray]:
        s, t = self.geom_ptr[e], self.geom_ptr[e + 1]
        return self.geom_lon[s:t], self.geom_lat[s:t]


def build_network(
    u_osm: np.ndarray,
    v_osm: np.ndarray,
    geom_ptr: np.ndarray,
    geom_lon: np.ndarray,
    geom_lat: np.ndarray,
    attrs: dict[str, np.ndarray] | None = None,
    directed: bool = False,
    arc_weight: np.ndarray | None = None,
    arc_reverse_ok: np.ndarray | None = None,
) -> Network:
    """Create a :class:`Network` from edge records keyed by OSM node ids.

    Edge lengths are geodesic lengths of the full polyline. Self-loops of zero
    length are removed.
    """
    attrs = attrs or {}
    all_ids = np.concatenate([u_osm, v_osm])
    node_id, inverse = np.unique(all_ids, return_inverse=True)
    m = len(u_osm)
    eu, ev = inverse[:m], inverse[m:]
    # lengths
    seg = haversine_m(geom_lon[:-1], geom_lat[:-1], geom_lon[1:], geom_lat[1:])
    # zero-out segments that span two edges
    boundary = np.zeros(len(geom_lon) - 1 if len(geom_lon) else 0, dtype=bool)
    if len(boundary):
        ends = geom_ptr[1:-1] - 1
        boundary[ends[(ends >= 0) & (ends < len(boundary))]] = True
        seg = np.where(boundary, 0.0, seg)
    csum = np.concatenate([[0.0], np.cumsum(seg)])
    edge_len = (csum[geom_ptr[1:] - 1] - csum[geom_ptr[:-1]]).astype(np.float32)
    # node coordinates from first/last vertex of edges
    lon = np.empty(len(node_id))
    lat = np.empty(len(node_id))
    lon[eu] = geom_lon[geom_ptr[:-1]]
    lat[eu] = geom_lat[geom_ptr[:-1]]
    lon[ev] = geom_lon[geom_ptr[1:] - 1]
    lat[ev] = geom_lat[geom_ptr[1:] - 1]
    keep = ~((eu == ev) & (edge_len < 1e-6))
    net = Network(
        node_id=node_id, lon=lon, lat=lat, edge_u=eu.astype(np.int64), edge_v=ev.astype(np.int64),
        edge_len=edge_len, geom_ptr=geom_ptr.astype(np.int64), geom_lon=geom_lon, geom_lat=geom_lat,
        edge_attrs=attrs, directed=directed, arc_weight=arc_weight, arc_reverse_ok=arc_reverse_ok,
    )
    if not keep.all():
        net = net.subset_edges(keep)
    return net


# ---------------------------------------------------------------------------
# Snapping points onto edges
# ---------------------------------------------------------------------------

@dataclass
class EdgeSnapper:
    """Snap points to the nearest position along any edge.

    Edges are densified into sample points every ``step`` metres; the nearest
    sample gives the edge and the offset along it (error ≤ step / 2). This is
    more faithful than snapping to the nearest node when long edges pass close
    to a point.
    """

    net: Network
    step: float = 15.0

    def __post_init__(self) -> None:
        net = self.net
        gx, gy = to_metric(net.geom_lon, net.geom_lat)
        ptr = net.geom_ptr
        nv = len(gx)
        vert_edge = np.repeat(np.arange(net.n_edges, dtype=np.int64), np.diff(ptr))
        # planar length of each segment that stays inside one edge
        seg_len = np.hypot(np.diff(gx), np.diff(gy))
        same_edge = vert_edge[:-1] == vert_edge[1:]
        seg_len = np.where(same_edge, seg_len, 0.0)
        cum = np.concatenate([[0.0], np.cumsum(seg_len)])
        vert_off = cum - cum[ptr[:-1]][vert_edge]           # planar offset of each vertex along its edge
        planar_total = vert_off[ptr[1:] - 1]
        scale = np.where(planar_total > 0, net.edge_len / np.maximum(planar_total, 1e-9), 1.0)
        # 1) every vertex is a sample
        xs, ys, es, offs = [gx], [gy], [vert_edge], [vert_off]
        # 2) intermediate samples on segments longer than `step`
        seg_idx = np.flatnonzero(same_edge & (seg_len > self.step))
        if len(seg_idx):
            n_extra = (np.ceil(seg_len[seg_idx] / self.step) - 1).astype(np.int64)
            rep = np.repeat(seg_idx, n_extra)
            j = np.arange(int(n_extra.sum())) - np.repeat(np.cumsum(n_extra) - n_extra, n_extra) + 1
            frac = j / np.repeat(n_extra + 1, n_extra)
            xs.append(gx[rep] + frac * (gx[rep + 1] - gx[rep]))
            ys.append(gy[rep] + frac * (gy[rep + 1] - gy[rep]))
            es.append(vert_edge[rep])
            offs.append(vert_off[rep] + frac * seg_len[rep])
        self.sx = np.concatenate(xs)
        self.sy = np.concatenate(ys)
        self.se = np.concatenate(es)
        self.soff = np.concatenate(offs) * scale[self.se]
        assert len(self.sx) >= nv
        self.tree = cKDTree(np.column_stack([self.sx, self.sy]))

    def snap(self, lon: np.ndarray, lat: np.ndarray) -> pd.DataFrame:
        x, y = to_metric(lon, lat)
        dist, idx = self.tree.query(np.column_stack([x, y]), k=1)
        e = self.se[idx]
        off = self.soff[idx]
        length = self.net.edge_len[e].astype(np.float64)
        off = np.clip(off, 0.0, length)
        return pd.DataFrame({
            "edge": e,
            "u": self.net.edge_u[e],
            "v": self.net.edge_v[e],
            "off_u": off,
            "off_v": length - off,
            "snap_m": dist,
        })


def snaps_to_sources(snaps: pd.DataFrame, detour: float, max_snap_m: float, labels: np.ndarray | None = None):
    """Turn snapped destinations into (node, initial cost, label) source triples.

    A destination snapped onto edge (u, v) at offset s contributes two sources:
    node u with cost detour*snap + s and node v with cost detour*snap + (L - s).
    Points farther than ``max_snap_m`` from the network are dropped.
    """
    ok = snaps["snap_m"].to_numpy() <= max_snap_m
    sn = snaps[ok]
    base = detour * sn["snap_m"].to_numpy()
    nodes = np.concatenate([sn["u"].to_numpy(), sn["v"].to_numpy()])
    cost = np.concatenate([base + sn["off_u"].to_numpy(), base + sn["off_v"].to_numpy()])
    if labels is None:
        lab = np.concatenate([np.flatnonzero(ok), np.flatnonzero(ok)])
    else:
        lab = np.concatenate([labels[ok], labels[ok]])
    return nodes.astype(np.int64), cost.astype(np.float64), lab.astype(np.int64)


def evaluate_at_snaps(dist: np.ndarray, snaps: pd.DataFrame, detour: float) -> np.ndarray:
    """Network cost from the nearest source to each snapped point."""
    du = dist[snaps["u"].to_numpy()] + snaps["off_u"].to_numpy()
    dv = dist[snaps["v"].to_numpy()] + snaps["off_v"].to_numpy()
    return np.minimum(du, dv) + detour * snaps["snap_m"].to_numpy()
