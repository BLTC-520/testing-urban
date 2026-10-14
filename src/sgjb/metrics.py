"""Accessibility indicators and population-weighted statistics.

All functions are pure and vectorised so they can be reused for the baseline,
every sensitivity run and every scenario.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def minutes(d_m: np.ndarray, speed_mps: float) -> np.ndarray:
    return np.asarray(d_m, dtype=np.float64) / speed_mps / 60.0


def completeness(d_m: np.ndarray, speed_mps: float, threshold_min: float) -> np.ndarray:
    """Share of basket categories reachable within the threshold (C_i in [0, 1]).

    ``d_m`` is (cells × K) network distance in metres; NaN (off-network) stays NaN.
    """
    d = np.asarray(d_m, dtype=np.float64)
    reach = minutes(d, speed_mps) <= threshold_min
    c = reach.mean(axis=1)
    c[np.isnan(d).all(axis=1)] = np.nan
    return c


def weighted_quantile(values: np.ndarray, weights: np.ndarray, q) -> np.ndarray:
    """Weighted quantile (inverse of the weighted empirical CDF, midpoint rule)."""
    v = np.asarray(values, dtype=np.float64)
    w = np.asarray(weights, dtype=np.float64)
    ok = np.isfinite(v) & (w > 0)
    v, w = v[ok], w[ok]
    if not len(v):
        return np.full(np.shape(q), np.nan)
    order = np.argsort(v)
    v, w = v[order], w[order]
    cw = np.cumsum(w) - 0.5 * w
    cw /= w.sum()
    return np.interp(q, cw, v)


def weighted_share(mask: np.ndarray, weights: np.ndarray) -> float:
    w = np.asarray(weights, dtype=np.float64)
    m = np.asarray(mask)
    tot = w.sum()
    return float((w * m).sum() / tot) if tot > 0 else float("nan")


def weighted_gini(values: np.ndarray, weights: np.ndarray) -> float:
    """Gini coefficient of a non-negative quantity across people (population-weighted)."""
    v = np.asarray(values, dtype=np.float64)
    w = np.asarray(weights, dtype=np.float64)
    ok = np.isfinite(v) & (w > 0)
    v, w = v[ok], w[ok]
    if not len(v) or v.sum() == 0:
        return float("nan")
    order = np.argsort(v)
    v, w = v[order], w[order]
    cw = np.cumsum(w)
    cv = np.cumsum(v * w)
    W, V = cw[-1], cv[-1]
    # area under the Lorenz curve (trapezoids)
    lorenz_prev = np.concatenate([[0.0], cv[:-1] / V])
    lorenz = cv / V
    area = np.sum((lorenz_prev + lorenz) * (w / W)) / 2.0
    return float(1.0 - 2.0 * area)


def summarise(df: pd.DataFrame, d_cols: list[str], speed: float, threshold: float, weight: str,
              low_access: float = 0.5) -> dict:
    """Headline indicators for one population (a city, a neighbourhood, a scenario...)."""
    d = df[d_cols].to_numpy(dtype=np.float64)
    w = df[weight].to_numpy(dtype=np.float64)
    c = completeness(d, speed, threshold)
    ok = np.isfinite(c)
    w_ok = np.where(ok, w, 0.0)
    k = len(d_cols)
    n_reach = np.where(ok, np.rint(c * k), np.nan)
    out = {
        "population": float(w.sum()),
        "population_on_network": float(w_ok.sum()),
        "share_complete": weighted_share(np.where(ok, c >= 1 - 1e-9, False), w_ok),
        "share_low_access": weighted_share(np.where(ok, c < low_access, False), w_ok),
        "low_access_population": float((w_ok * np.where(ok, c < low_access, False)).sum()),
        "mean_categories": float(np.nansum(n_reach * w_ok) / w_ok.sum()) if w_ok.sum() > 0 else float("nan"),
        "median_categories": float(weighted_quantile(n_reach, w_ok, 0.5)),
        "categories_p10": float(weighted_quantile(n_reach, w_ok, 0.1)),
        "categories_p90": float(weighted_quantile(n_reach, w_ok, 0.9)),
    }
    for j, col in enumerate(d_cols):
        t = minutes(d[:, j], speed)
        out[f"median_min_{col[2:]}"] = float(weighted_quantile(t, w_ok, 0.5))
        out[f"p90_min_{col[2:]}"] = float(weighted_quantile(t, w_ok, 0.9))
        out[f"share_within_{col[2:]}"] = weighted_share(np.where(ok, t <= threshold, False), w_ok)
    return out
