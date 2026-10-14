"""How robust are the headline findings to the modelling assumptions?

Every combination of the varied assumptions is evaluated:
    walking speed × time threshold × taxonomy variant × network variant × population model
and each *finding* (a yes/no statement) is checked in every run. Findings are
classified as in the project brief:

    ROBUST       holds in ≥ 90 % of runs
    CONDITIONAL  holds in 50–90 %
    FRAGILE      holds in < 50 %
"""

from __future__ import annotations

import itertools

import numpy as np
import pandas as pd

from . import config
from .metrics import completeness, weighted_quantile


def _dcols(basket: list[str], taxonomy: str, network: str) -> list[str]:
    if network == "strict":
        return [f"d_{k}__netstrict" for k in basket]
    sfx = "" if taxonomy == "core" else f"__{taxonomy}"
    return [f"d_{k}{sfx}" for k in basket]


def run_grid(acc: pd.DataFrame, basket: list[str]) -> pd.DataFrame:
    s = config.load("scenarios")["sensitivity"]
    low = config.load("scenarios")["accessibility"]["low_access_completeness"]
    rows = []
    for speed, thr, tax, net, popm in itertools.product(s["walk_speed_mps"], s["threshold_min"], s["taxonomy"],
                                                        s["network"], s["population"]):
        if net == "strict" and tax != "core":
            continue  # the strict-network variant is evaluated with the core taxonomy only
        cols = _dcols(basket, tax, net)
        wcol = "pop" if popm == "hrsl" else "pop_kontur"
        rec = {"speed": speed, "threshold": thr, "taxonomy": tax, "network": net, "population": popm}
        for city in ("sg", "jb"):
            c = acc[acc["city"] == city]
            d = c[cols].to_numpy(dtype=np.float64)
            w = c[wcol].to_numpy(dtype=np.float64)
            comp = completeness(d, speed, thr)
            ok = np.isfinite(comp)
            w = np.where(ok, w, 0.0)
            rec[f"{city}_share_complete"] = float((w * (comp >= 1 - 1e-9)).sum() / w.sum())
            rec[f"{city}_share_low"] = float((w * (comp < low)).sum() / w.sum())
            rec[f"{city}_median_categories"] = float(weighted_quantile(np.rint(comp * len(basket)), w, 0.5))
            # which category is most often the missing one
            reach = (d / speed / 60.0) <= thr
            miss = {k: float((w * ~reach[:, j]).sum() / w.sum()) for j, k in enumerate(basket)}
            rec[f"{city}_most_missing"] = max(miss, key=miss.get)
            for k, v in miss.items():
                rec[f"{city}_missing_{k}"] = v
        rows.append(rec)
    return pd.DataFrame(rows)


FINDINGS = [
    ("sg_more_complete", "Singapore has a higher share of residents with complete 15-minute access than Johor Bahru",
     lambda r: r["sg_share_complete"] > r["jb_share_complete"]),
    ("gap_over_20pts", "The completeness gap between the cities exceeds 20 percentage points",
     lambda r: r["sg_share_complete"] - r["jb_share_complete"] > 0.20),
    ("jb_majority_incomplete", "Most Johor Bahru residents lack at least one essential within the threshold",
     lambda r: r["jb_share_complete"] < 0.5),
    ("sg_majority_complete", "Most Singapore residents have every essential within the threshold",
     lambda r: r["sg_share_complete"] > 0.5),
    ("jb_low_access_higher", "Johor Bahru has a larger share of residents in low-access areas",
     lambda r: r["jb_share_low"] > r["sg_share_low"]),
]


def classify(grid: pd.DataFrame) -> pd.DataFrame:
    s = config.load("scenarios")["sensitivity"]
    rows = []
    for key, text, fn in FINDINGS:
        holds = grid.apply(fn, axis=1)
        share = float(holds.mean())
        label = "ROBUST" if share >= s["robust_share"] else "CONDITIONAL" if share >= s["conditional_share"] else "FRAGILE"
        rows.append({"finding": key, "statement": text, "share_of_runs": share, "runs": len(grid), "label": label})
    # most-missing category stability per city
    for city in ("sg", "jb"):
        top = grid[f"{city}_most_missing"].value_counts(normalize=True)
        cat, share = top.index[0], float(top.iloc[0])
        label = "ROBUST" if share >= s["robust_share"] else "CONDITIONAL" if share >= s["conditional_share"] else "FRAGILE"
        rows.append({"finding": f"{city}_most_missing", "statement":
                     f"In {'Singapore' if city == 'sg' else 'Johor Bahru'}, the essential most often out of reach is {cat.replace('_', ' ')}",
                     "share_of_runs": share, "runs": len(grid), "label": label, "category": cat})
    return pd.DataFrame(rows)
