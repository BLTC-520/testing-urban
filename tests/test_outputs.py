"""Integrity checks on the published results (run after `make pipeline`).

They guard against silent failures that unit tests cannot see: a census total
that no longer matches, an audit that collapsed to one record, a share outside
[0, 1], a scenario that made things worse.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SUMMARY = ROOT / "data" / "derived" / "summary.json"
WEB = ROOT / "web" / "public" / "data"

pytestmark = pytest.mark.data


@pytest.fixture(scope="module")
def summary() -> dict:
    if not SUMMARY.exists():
        pytest.skip("pipeline outputs not present")
    return json.loads(SUMMARY.read_text())


def test_population_matches_census(summary):
    # Census 2020: Singapore residents in the study area, Johor Bahru DUN N.40–N.49 totals
    assert summary["cities"]["sg"]["all"]["population"] == pytest.approx(4_044_340, rel=1e-3)
    assert summary["cities"]["jb"]["all"]["population"] == pytest.approx(1_753_284, rel=1e-3)


def test_shares_are_proportions(summary):
    for city in ("sg", "jb"):
        for group in ("all", "elderly", "elderly_slow_walk"):
            b = summary["cities"][city][group]
            assert 0 <= b["share_complete"] <= 1
            assert 0 <= b["share_low_access"] <= 1
            assert sum(b.get("categories_histogram", [1])) == pytest.approx(1, abs=1e-3) or group != "all"
        thr = summary["cities"][city]["all"]["share_complete_by_threshold"]
        values = [thr[k] for k in sorted(thr, key=float)]
        assert values == sorted(values), "completeness must not fall as the time budget grows"
        spd = summary["cities"][city]["all"]["share_complete_by_speed"]
        assert spd["slow"] <= spd["base"] <= spd["brisk"]


def test_audits_are_populated(summary):
    a = summary["audit"]
    rail = a["rail_stations"][0]
    assert rail["official_stations"] > 150, "LTA station layer should hold the whole MRT/LRT network"
    for r in a["bus_stops"]:
        assert r["official_stops"] > 500
        assert 0 <= r["recall_30m"] <= r["recall_60m"] <= 1
    assert len(a["poi_cross_source"]) == 8


def test_sensitivity_grid_complete(summary):
    s = summary["sensitivity"]
    assert s["runs"] == 72
    assert len(s.get("grid", [])) == 72
    for f in s["findings"]:
        assert f["label"] in {"ROBUST", "CONDITIONAL", "FRAGILE"}


def test_scenarios_never_make_access_worse(summary):
    pk = summary["scenarios"]["parking"]
    for city in ("sg", "jb"):
        before = pk[city]["before"]["share_complete"]
        prev = before
        for n in ("10", "25", "50"):
            after = pk[city]["after"][n]["share_complete"]
            assert after >= prev - 1e-9
            prev = after
    rts = summary["scenarios"]["rts"]
    for regime in rts.values():
        assert regime["rts_av"]["median_min"] <= regime["rts"]["median_min"] + 1e-9


def test_web_artifacts_exist():
    if not WEB.exists():
        pytest.skip("web artifacts not exported")
    for name in ("meta.json", "summary.json", "cells_sg.bin", "cells_jb.bin", "crossborder_jb.bin", "graph/index.json"):
        assert (WEB / name).exists(), name
