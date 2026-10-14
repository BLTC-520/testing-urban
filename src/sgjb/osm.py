"""OpenStreetMap ingestion: routable walk/drive networks and tagged features.

The PBF is first narrowed with ``osmium tags-filter`` (C++, fast), then read
with pyosmium. Topology comes from shared OSM node ids — never from geometric
intersection — so bridges, tunnels and flyovers do not create false junctions.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import osmium

from . import config
from .graph import Network, build_network

WAY_TAG_KEYS = (
    "highway", "foot", "access", "sidewalk", "sidewalk:both", "sidewalk:left", "sidewalk:right",
    "footway", "area", "service", "indoor", "bridge", "tunnel", "oneway", "junction", "maxspeed",
    "motor_vehicle", "motorcar", "bicycle", "name", "lanes", "covered",
)


def run_osmium(args: list[str]) -> None:
    subprocess.run(["osmium", *args], check=True, capture_output=True)


def tags_filter(src: Path, dst: Path, expressions: list[str]) -> Path:
    """Keep only objects matching the osmium tag expressions (+ referenced objects).

    The output is reused while it is newer than the source and was made with the
    same expressions (recorded next to it)."""
    stamp = dst.with_name(dst.name + ".filter")
    key = "\n".join(expressions)
    fresh = dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime and stamp.exists() and stamp.read_text() == key
    if not fresh:
        run_osmium(["tags-filter", str(src), *expressions, "-o", str(dst), "--overwrite"])
        stamp.write_text(key)
    return dst


# ---------------------------------------------------------------------------
# Ways
# ---------------------------------------------------------------------------

@dataclass
class WayTable:
    """All highway ways as flat arrays (one run of valid locations per row)."""

    way_id: np.ndarray        # int64[w]
    ptr: np.ndarray           # int64[w+1] into node arrays
    node_id: np.ndarray       # int64[N]
    lon: np.ndarray           # float64[N]
    lat: np.ndarray
    tags: list[dict[str, str]]


def read_highway_ways(highways_pbf: Path) -> WayTable:
    way_ids: list[int] = []
    lens: list[int] = []
    nids: list[int] = []
    lons: list[float] = []
    lats: list[float] = []
    tags: list[dict[str, str]] = []
    fp = osmium.FileProcessor(str(highways_pbf), osmium.osm.NODE | osmium.osm.WAY).with_locations()
    for obj in fp:
        if not obj.is_way():
            continue
        t = obj.tags
        if "highway" not in t:
            continue
        tg = {k: t[k] for k in WAY_TAG_KEYS if k in t}
        run_ids: list[int] = []
        run_lon: list[float] = []
        run_lat: list[float] = []

        def flush():
            if len(run_ids) >= 2:
                way_ids.append(obj.id)
                lens.append(len(run_ids))
                nids.extend(run_ids)
                lons.extend(run_lon)
                lats.extend(run_lat)
                tags.append(tg)

        for n in obj.nodes:
            loc = n.location
            if loc.valid():
                run_ids.append(n.ref)
                run_lon.append(loc.lon)
                run_lat.append(loc.lat)
            else:  # node outside the extract: split the way here
                flush()
                run_ids, run_lon, run_lat = [], [], []
        flush()
    ptr = np.concatenate([[0], np.cumsum(lens)]).astype(np.int64)
    return WayTable(np.array(way_ids, dtype=np.int64), ptr, np.array(nids, dtype=np.int64),
                    np.array(lons), np.array(lats), tags)


def _truthy(v: str | None) -> bool:
    return v in ("yes", "true", "1")


def walk_rules(tags: dict[str, str], rules: dict) -> tuple[bool, bool]:
    """Return (walkable, walkable_under_strict_variant) for a way's tags."""
    hw = tags.get("highway")
    if hw not in rules["include_highway"]:
        return False, False
    for k, bad in rules["exclude_tag_values"].items():
        if tags.get(k) in bad:
            return False, False
    foot = tags.get("foot")
    if tags.get("access") in rules["access_blocking"] and foot not in rules["foot_overrides"]:
        return False, False
    strict_ok = True
    if hw in rules["strict_arterials"]:
        side_vals = {tags.get("sidewalk"), tags.get("sidewalk:both"), tags.get("sidewalk:left"), tags.get("sidewalk:right")}
        has_sidewalk = bool(side_vals & set(rules["strict_sidewalk_ok"]))
        if not has_sidewalk and foot not in ("yes", "designated"):
            strict_ok = False
    return True, strict_ok


PEDESTRIAN_WAYS = {"footway", "path", "pedestrian", "steps", "corridor", "elevator", "cycleway", "track", "bridleway", "living_street"}


def drive_rules(tags: dict[str, str], rules: dict) -> bool:
    hw = tags.get("highway")
    if hw not in rules["speed_kmh"]:
        return False
    for k, bad in rules["exclude_tag_values"].items():
        if tags.get(k) in bad:
            return False
    return True


def _parse_maxspeed(v: str | None) -> float | None:
    if not v:
        return None
    m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*(mph)?", v)
    if not m:
        return None
    s = float(m.group(1))
    return s * 1.609344 if m.group(2) else s


def split_ways(wt: WayTable, selected: np.ndarray):
    """Split selected ways into edges at shared nodes and way ends.

    Returns (u_osm, v_osm, geom_ptr, geom_lon, geom_lat, edge_way_row).
    """
    sel = np.flatnonzero(selected)
    lens = (wt.ptr[1:] - wt.ptr[:-1])[sel]
    starts = wt.ptr[:-1][sel]
    sub_ptr = np.concatenate([[0], np.cumsum(lens)])
    idx = np.arange(int(lens.sum())) + np.repeat(starts - sub_ptr[:-1], lens)
    nid = wt.node_id[idx]
    lon = wt.lon[idx]
    lat = wt.lat[idx]
    row = np.repeat(sel, lens)
    # a node is a graph node if it is used more than once among selected ways
    uniq, inv, cnt = np.unique(nid, return_inverse=True, return_counts=True)
    split = cnt[inv] >= 2
    split[sub_ptr[:-1]] = True
    split[sub_ptr[1:] - 1] = True
    pos = np.flatnonzero(split)
    # edges connect consecutive split positions inside the same way
    same_way = row[pos[:-1]] == row[pos[1:]]
    a = pos[:-1][same_way]
    b = pos[1:][same_way]
    elen = b - a + 1
    geom_ptr = np.concatenate([[0], np.cumsum(elen)]).astype(np.int64)
    gidx = np.arange(int(elen.sum())) + np.repeat(a - geom_ptr[:-1], elen)
    return nid[a], nid[b], geom_ptr, lon[gidx], lat[gidx], row[a]


def build_walk_network(wt: WayTable, min_component_nodes: int | None = None) -> Network:
    rules = config.load("network")["walk"]
    flags = [walk_rules(t, rules) for t in wt.tags]
    walkable = np.array([f[0] for f in flags])
    strict_ok_way = np.array([f[1] for f in flags])
    u, v, gp, glon, glat, wrow = split_ways(wt, walkable)
    hw = np.array([wt.tags[r].get("highway", "") for r in wrow])
    attrs = {
        "highway": hw.astype("U16"),
        "pedestrian": np.isin(hw, list(PEDESTRIAN_WAYS)),
        "strict_ok": strict_ok_way[wrow],
        "way_id": wt.way_id[wrow],
        "sidewalk_tagged": np.array([
            any(k.startswith("sidewalk") for k in wt.tags[r]) or wt.tags[r].get("footway") == "sidewalk"
            for r in wrow
        ]),
        "bridge": np.array([_truthy(wt.tags[r].get("bridge")) or wt.tags[r].get("bridge") == "viaduct" for r in wrow]),
        "tunnel": np.array([wt.tags[r].get("tunnel") in ("yes", "building_passage", "culvert") for r in wrow]),
        "covered": np.array([_truthy(wt.tags[r].get("covered")) for r in wrow]),
    }
    net = build_network(u, v, gp, glon, glat, attrs=attrs, directed=False)
    mcn = rules["min_component_nodes"] if min_component_nodes is None else min_component_nodes
    return net.drop_small_components(mcn)


def build_drive_network(wt: WayTable, peak_speed_factor: float = 1.0,
                        min_component_nodes: int | None = None) -> Network:
    rules = config.load("network")["drive"]
    drivable = np.array([drive_rules(t, rules) for t in wt.tags])
    u, v, gp, glon, glat, wrow = split_ways(wt, drivable)
    tags = [wt.tags[r] for r in wrow]
    hw = np.array([t.get("highway", "") for t in tags])
    speed = np.array([
        (_parse_maxspeed(t.get("maxspeed")) or rules["speed_kmh"][t["highway"]]) for t in tags
    ], dtype=np.float64)
    oneway = np.array([
        t.get("oneway") in ("yes", "true", "1") or t.get("junction") in ("roundabout", "circular")
        or (t.get("highway") in ("motorway",) and t.get("oneway") != "no")
        for t in tags
    ])
    reverse_only = np.array([t.get("oneway") == "-1" for t in tags])
    # ways tagged oneway=-1 run against their drawing direction: swap ends
    u2 = np.where(reverse_only, v, u)
    v2 = np.where(reverse_only, u, v)
    if reverse_only.any():
        # reverse the geometry of swapped edges
        glon = glon.copy()
        glat = glat.copy()
        for e in np.flatnonzero(reverse_only):
            s, t_ = gp[e], gp[e + 1]
            glon[s:t_] = glon[s:t_][::-1]
            glat[s:t_] = glat[s:t_][::-1]
    attrs = {"highway": hw.astype("U16"), "speed_kmh": speed.astype(np.float32), "way_id": wt.way_id[wrow]}
    tmp = build_network(u2, v2, gp, glon, glat, attrs=attrs, directed=True,
                        arc_reverse_ok=~(oneway | reverse_only))
    # travel time in seconds as arc weight
    tmp.arc_weight = tmp.edge_len / (tmp.edge_attrs["speed_kmh"] * peak_speed_factor / 3.6)
    tmp.build_csr()
    mcn = config.load("network")["walk"]["min_component_nodes"] if min_component_nodes is None else min_component_nodes
    return tmp.drop_small_components(mcn)
