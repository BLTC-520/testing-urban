"""Indicator definitions on small hand-checkable inputs."""

import numpy as np
import pandas as pd
import pytest

from sgjb.metrics import completeness, summarise, weighted_gini, weighted_quantile, weighted_share


def test_completeness_counts_categories_within_threshold():
    # 1.2 m/s * 15 min = 1080 m
    d = np.array([[100, 500, 1079, 1081],
                  [2000, 2000, 2000, 2000],
                  [np.nan, np.nan, np.nan, np.nan]])
    c = completeness(d, 1.2, 15)
    assert c[0] == pytest.approx(0.75)
    assert c[1] == 0.0
    assert np.isnan(c[2])


def test_speed_scales_exactly():
    d = np.array([[900.0]])
    assert completeness(d, 1.0, 15)[0] == 1.0     # 15 min
    assert completeness(d, 0.9, 15)[0] == 0.0     # 16.7 min


def test_weighted_quantile_matches_repetition():
    v = np.array([1.0, 2.0, 3.0])
    w = np.array([1.0, 1.0, 2.0])
    rep = np.array([1.0, 2.0, 3.0, 3.0])
    assert weighted_quantile(v, w, 0.5) == pytest.approx(np.median(rep), abs=0.5)
    assert weighted_quantile(v, w, 0.0) == 1.0


def test_gini_extremes():
    assert weighted_gini(np.ones(10), np.ones(10)) == pytest.approx(0.0, abs=1e-12)
    v = np.zeros(1000)
    v[-1] = 1.0
    assert weighted_gini(v, np.ones(1000)) == pytest.approx(1.0, abs=2e-3)
    # weights behave like repetition
    g1 = weighted_gini(np.array([1, 2, 3.0]), np.array([2, 1, 1.0]))
    g2 = weighted_gini(np.array([1, 1, 2, 3.0]), np.ones(4))
    assert g1 == pytest.approx(g2, rel=1e-9)


def test_summary_population_weighting():
    df = pd.DataFrame({
        "d_a": [100.0, 5000.0],
        "d_b": [100.0, 5000.0],
        "pop": [900.0, 100.0],
    })
    s = summarise(df, ["d_a", "d_b"], speed=1.2, threshold=15, weight="pop")
    assert s["share_complete"] == pytest.approx(0.9)
    assert s["low_access_population"] == pytest.approx(100.0)
    assert weighted_share(np.array([True, False]), np.array([3.0, 1.0])) == pytest.approx(0.75)
