"""OSM ingestion on a hand-built fixture with known edge cases (tests/fixtures/mini.osm)."""

from pathlib import Path

import numpy as np
import pytest

from sgjb.dijkstra import multi_source_dijkstra
from sgjb.features import Taxonomy, access_points, read_features
from sgjb.geo import haversine_m
from sgjb.osm import build_drive_network, build_walk_network, read_highway_ways, walk_rules
from sgjb import config

FIX = Path(__file__).parent / "fixtures" / "mini.osm.pbf"


@pytest.fixture(scope="module")
def ways():
    return read_highway_ways(FIX)


@pytest.fixture(scope="module")
def walk(ways):
    return build_walk_network(ways, min_component_nodes=1)


def node_index(net, osm_id):
    return int(np.flatnonzero(net.node_id == osm_id)[0])


def test_yaml_keeps_osm_no_as_string():
    rules = config.load("network")["walk"]
    assert "no" in rules["exclude_tag_values"]["foot"]
    assert "yes" in rules["foot_overrides"]


def test_walk_filter_rules():
    rules = config.load("network")["walk"]
    assert walk_rules({"highway": "footway", "foot": "no"}, rules) == (False, False)
    assert walk_rules({"highway": "motorway"}, rules) == (False, False)
    assert walk_rules({"highway": "primary"}, rules) == (True, False)
    assert walk_rules({"highway": "primary", "sidewalk": "both"}, rules) == (True, True)
    assert walk_rules({"highway": "service", "access": "private"}, rules) == (False, False)
    assert walk_rules({"highway": "service", "access": "private", "foot": "yes"}, rules) == (True, True)
    assert walk_rules({"highway": "trunk", "foot": "use_sidepath"}, rules) == (False, False)


def test_excluded_ways_absent(walk):
    ids = set(walk.node_id.tolist())
    assert 7 not in ids          # only reachable via foot=no
    assert 8 not in ids and 9 not in ids   # motorway
    assert 13 not in ids         # private service road without foot=yes
    assert {1, 2, 3, 4, 5, 6, 10, 11, 12, 14} <= ids


def test_bridge_does_not_create_junction(walk):
    """The footbridge 5-6 crosses road 2-3 without sharing a node: no shortcut."""
    s = node_index(walk, 5)
    dist, _ = multi_source_dijkstra(walk.indptr, walk.indices, walk.weights,
                                    np.array([s], np.int64), np.array([0.0]), np.array([0], np.int64), np.inf)
    d3 = dist[node_index(walk, 3)]
    via_bridge_path = (haversine_m(103.803, 1.299, 103.803, 1.301) + haversine_m(103.803, 1.301, 103.802, 1.302)
                       + haversine_m(103.802, 1.302, 103.802, 1.300) + haversine_m(103.802, 1.300, 103.804, 1.300))
    assert d3 == pytest.approx(via_bridge_path, rel=1e-6)


def test_strict_flag_on_arterials(walk):
    hw = walk.edge_attrs["highway"]
    strict = walk.edge_attrs["strict_ok"]
    prim = hw == "primary"
    assert prim.sum() == 2
    assert strict[prim].sum() == 1   # only the primary with sidewalk=both


def test_drive_network_oneway(ways):
    drive = build_drive_network(ways, min_component_nodes=1)
    a, b = node_index(drive, 4), node_index(drive, 14)
    fwd = set(drive.indices[drive.indptr[a]:drive.indptr[a + 1]].tolist())
    back = set(drive.indices[drive.indptr[b]:drive.indptr[b + 1]].tolist())
    assert b in fwd and a not in back
    assert 8 in set(drive.node_id.tolist())   # motorway is drivable
    # weights are seconds: 30 km/h residential
    e = int(np.flatnonzero((drive.edge_u == a) & (drive.edge_v == b))[0])
    assert drive.arc_weight[e] == pytest.approx(drive.edge_len[e] / (30 / 3.6), rel=1e-6)


def test_features_classification():
    tax = Taxonomy()
    gdf = read_features(FIX, tax)
    by_name = {n: r for n, r in zip(gdf["name"], gdf.itertuples())}
    assert by_name["FreshMart"].lvl_groceries == 0
    assert "Closed Mart" not in by_name                       # disused
    assert by_name["Klinik Sihat"].lvl_healthcare == 0        # polygon POI
    assert by_name["Taman Hijau"].lvl_green_space == 0
    assert by_name["Taman Hijau"].area_m2 == pytest.approx(111.3 * 111.3, rel=0.02)   # ~1.24 ha
    assert by_name["Test MRT"].lvl_transit == 0 and by_name["Test MRT"].lvl_rapid_transit == 0
    assert by_name["Opp Blk 1"].lvl_transit == 0 and by_name["Opp Blk 1"].lvl_rapid_transit == -1
    parking = gdf[gdf["lvl_parking"] >= 0]
    assert len(parking) == 1 and parking.iloc[0]["parking"] == "surface"  # underground lot excluded


def test_park_access_points_on_boundary():
    tax = Taxonomy()
    gdf = read_features(FIX, tax)
    park = gdf[gdf["name"] == "Taman Hijau"].reset_index(drop=True)
    ap = access_points(park, boundary_step_m=40)
    assert len(ap) >= 8
    # all points lie on the park outline (within 1 m)
    on_edge = (np.isclose(ap.lon, 103.8045, atol=1e-5) | np.isclose(ap.lon, 103.8055, atol=1e-5)
               | np.isclose(ap.lat, 1.3015, atol=1e-5) | np.isclose(ap.lat, 1.3025, atol=1e-5))
    assert on_edge.all()
