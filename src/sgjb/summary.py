"""Assemble every statistic used by the web app and the written report.

Writes data/derived/summary.json (also copied into web/public/data/) and a set
of CSV tables in data/derived/ for the report.
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd

from . import audit, boundaries, config
from .metrics import completeness, summarise, weighted_gini, weighted_quantile
from .sensitivity import classify, run_grid


def _basket() -> list[str]:
    return list(config.load("taxonomy")["basket"])


def city_block(df: pd.DataFrame, basket: list[str], weight: str) -> dict:
    acc = config.load("scenarios")["accessibility"]
    speeds = acc["walk_speed_mps"]
    cols = [f"d_{k}" for k in basket]
    base = summarise(df, cols, speeds["base"], acc["headline_threshold_min"], weight, acc["low_access_completeness"])
    by_threshold = {t: summarise(df, cols, speeds["base"], t, weight, acc["low_access_completeness"])["share_complete"]
                    for t in acc["thresholds_min"]}
    by_speed = {name: summarise(df, cols, v, acc["headline_threshold_min"], weight, acc["low_access_completeness"])["share_complete"]
                for name, v in speeds.items()}
    c = completeness(df[cols].to_numpy(np.float64), speeds["base"], acc["headline_threshold_min"])
    w = df[weight].to_numpy(np.float64)
    ok = np.isfinite(c)
    n = np.rint(c[ok] * len(basket)).astype(int)
    hist = np.bincount(n, weights=w[ok], minlength=len(basket) + 1)
    # composite gravity index: mean of per-category gravity normalised by the all-cells median
    g = np.column_stack([df[f"g_{k}"].to_numpy(np.float64) for k in basket])
    return {
        **base,
        "share_complete_by_threshold": by_threshold,
        "share_complete_by_speed": by_speed,
        "categories_histogram": (hist / hist.sum()).tolist(),
        "gini_categories": weighted_gini(n.astype(float), w[ok]),
        "_g": g,  # removed before serialisation (used for cross-city normalisation)
    }


def neighbourhood_table(acc: pd.DataFrame, basket: list[str]) -> pd.DataFrame:
    a = config.load("scenarios")["accessibility"]
    cols = [f"d_{k}" for k in basket]
    nb = boundaries.neighbourhoods().drop(columns="geometry")
    rows = []
    for uid, df in acc.groupby("unit_id"):
        if df["pop"].sum() < 500:
            continue
        s = summarise(df, cols, a["walk_speed_mps"]["base"], a["headline_threshold_min"], "pop", a["low_access_completeness"])
        e = summarise(df, cols, a["walk_speed_mps"]["base"], a["headline_threshold_min"], "elderly", a["low_access_completeness"]) \
            if df["elderly"].sum() > 0 else {}
        slow = summarise(df, cols, a["walk_speed_mps"]["slow"], a["headline_threshold_min"], "elderly", a["low_access_completeness"]) \
            if df["elderly"].sum() > 0 else {}
        miss = {k: s[f"share_within_{k}"] for k in basket}
        rows.append({
            "unit_id": uid, "city": df["city"].iloc[0], "population": s["population"], "elderly": float(df["elderly"].sum()),
            "share_complete": s["share_complete"], "share_low_access": s["share_low_access"],
            "low_access_population": s["low_access_population"], "mean_categories": s["mean_categories"],
            "elderly_share_complete": e.get("share_complete"), "elderly_share_complete_slow": slow.get("share_complete"),
            "weakest_category": min(miss, key=miss.get), "weakest_share": min(miss.values()),
            **{f"within_{k}": v for k, v in miss.items()},
            **{f"median_min_{k}": s[f"median_min_{k}"] for k in basket},
        })
    t = pd.DataFrame(rows).merge(nb[["unit_id", "unit_name", "area_km2"]], on="unit_id", how="left")
    return t.sort_values(["city", "share_complete"], ascending=[True, False]).reset_index(drop=True)


def build_summary() -> dict:
    basket = _basket()
    acc = pd.read_parquet(config.interim("access.parquet"))
    cells = pd.read_parquet(config.interim("cells.parquet"))
    out: dict = {"basket": basket}

    # --- cities, all residents and 65+
    cities = {}
    gmed = None
    for city in ("sg", "jb"):
        df = acc[acc["city"] == city]
        blk = city_block(df, basket, "pop")
        eld = city_block(df, basket, "elderly")
        a = config.load("scenarios")["accessibility"]
        eld_slow = summarise(df, [f"d_{k}" for k in basket], a["walk_speed_mps"]["slow"], a["headline_threshold_min"],
                             "elderly", a["low_access_completeness"])
        g = blk.pop("_g")
        eld.pop("_g")
        cities[city] = {"all": blk, "elderly": eld, "elderly_slow_walk": eld_slow, "_g": g, "_w": df["pop"].to_numpy()}
    gall = np.vstack([cities[c]["_g"] for c in ("sg", "jb")])
    gmed = np.nanmedian(np.where(gall > 0, gall, np.nan), axis=0)
    for city in ("sg", "jb"):
        g = cities[city].pop("_g")
        w = cities[city].pop("_w")
        gi = np.nanmean(g / gmed, axis=1)
        cities[city]["all"]["gravity_index_median"] = float(weighted_quantile(gi, w, 0.5))
        cities[city]["all"]["gravity_index_p10"] = float(weighted_quantile(gi, w, 0.1))
        cities[city]["all"]["gravity_index_p90"] = float(weighted_quantile(gi, w, 0.9))
        cities[city]["all"]["gravity_gini"] = weighted_gini(gi, w)
    out["cities"] = cities

    # --- supplementary: rapid transit within 10 min, civic within 15
    v = config.load("scenarios")["accessibility"]["walk_speed_mps"]["base"]
    for city in ("sg", "jb"):
        df = acc[acc["city"] == city]
        w = df["pop"].to_numpy()
        rt = df["d_rapid_transit"].to_numpy() / v / 60
        cv = df["d_civic"].to_numpy() / v / 60
        out["cities"][city]["supplementary"] = {
            "rapid_transit_within_10": float(np.nansum(w * (rt <= 10)) / w.sum()),
            "rapid_transit_median_min": float(weighted_quantile(rt, w, 0.5)),
            "civic_within_15": float(np.nansum(w * (cv <= 15)) / w.sum()),
        }

    # --- neighbourhoods
    nb = neighbourhood_table(acc, basket)
    nb.to_csv(config.derived("neighbourhoods.csv"), index=False)
    out["neighbourhoods"] = nb.to_dict(orient="records")

    # --- sensitivity
    grid = run_grid(acc, basket)
    grid.to_csv(config.derived("sensitivity_grid.csv"), index=False)
    findings = classify(grid)
    findings.to_csv(config.derived("robustness.csv"), index=False)
    out["sensitivity"] = {"runs": len(grid), "findings": findings.to_dict(orient="records"),
                          "range": {f"{c}_share_complete": [float(grid[f"{c}_share_complete"].min()),
                                                            float(grid[f"{c}_share_complete"].max())] for c in ("sg", "jb")},
                          # every run, so readers can see the spread rather than only its ends
                          "grid": grid[["speed", "threshold", "taxonomy", "network", "population",
                                        "sg_share_complete", "jb_share_complete", "sg_share_low", "jb_share_low"]
                                       ].round(4).to_dict(orient="records")}

    # --- POI source sensitivity (Overture)
    ovp = config.interim("access_overture.parquet")
    if ovp.exists():
        ov = pd.read_parquet(ovp)
        a = config.load("scenarios")["accessibility"]
        merged = acc.merge(ov, on="h3", how="left")
        res = {}
        for city in ("sg", "jb"):
            df = merged[merged["city"] == city]
            cols = [f"d_{k}__overture" if f"d_{k}__overture" in df else f"d_{k}" for k in basket]
            res[city] = summarise(df, cols, a["walk_speed_mps"]["base"], a["headline_threshold_min"], "pop",
                                  a["low_access_completeness"])
        out["poi_source_overture"] = res

    # --- urban form
    uf = config.derived("urban_form.csv")
    if uf.exists():
        out["form"] = pd.read_csv(uf).set_index("city").to_dict(orient="index")

    # --- audit
    import geopandas as gpd
    from .form import assign_city
    from .overture import load_classified

    feats = gpd.read_parquet(config.interim("features.parquet"))
    city_of = lambda lon, lat: assign_city(lon, lat, cells)  # noqa: E731
    rep = pd.read_csv(config.derived("population_calibration.csv"))
    out["audit"] = {
        "bus_stops": audit.bus_stop_audit(feats, city_of).to_dict(orient="records"),
        "rail_stations": audit.rail_station_audit(feats, city_of).to_dict(orient="records"),
        "poi_cross_source": audit.poi_cross_source(feats, load_classified(), cells, city_of).to_dict(orient="records"),
        "population": audit.population_audit(rep).to_dict(orient="records"),
    }

    # --- scenarios
    out["scenarios"] = scenario_summary(acc, basket)

    from .export import write_json
    write_json(config.derived("summary.json"), out)
    print(json.dumps({c: {k: out["cities"][c]["all"][k] for k in ("share_complete", "share_low_access", "median_categories")}
                      for c in ("sg", "jb")}, indent=1))
    return out


def scenario_summary(acc: pd.DataFrame, basket: list[str]) -> dict:
    a = config.load("scenarios")["accessibility"]
    p2p = config.load("scenarios")["parking_to_proximity"]
    res: dict = {}
    sp = config.interim("scenario_parking.parquet")
    if sp.exists():
        s = pd.read_parquet(sp)
        m = acc.merge(s, on="h3", how="left")
        sites = pd.read_csv(config.derived("parking_sites.csv"))
        pk = {}
        for city in ("sg", "jb"):
            df = m[m["city"] == city]
            before = summarise(df, [f"d_{k}" for k in basket], a["walk_speed_mps"]["base"], 15, "pop", a["low_access_completeness"])
            per_n = {}
            for n in p2p["sites_per_city"]:
                after = summarise(df, [f"d_{k}__p2p{n}" for k in basket], a["walk_speed_mps"]["base"], 15, "pop",
                                  a["low_access_completeness"])
                cs = sites[(sites["city"] == city) & (sites["rank"] <= n)]
                per_n[n] = {"share_complete": after["share_complete"], "share_low_access": after["share_low_access"],
                            "newly_complete": after["share_complete"] * after["population_on_network"]
                            - before["share_complete"] * before["population_on_network"],
                            "low_access_population": after["low_access_population"],
                            "sites": int(len(cs)), "site_area_ha": float(cs["area_m2"].sum() / 1e4)}
            pk[city] = {"before": {k: before[k] for k in ("share_complete", "share_low_access", "low_access_population",
                                                          "population_on_network")}, "after": per_n}
        res["parking"] = pk
    cbp = config.interim("crossborder.parquet")
    if cbp.exists():
        from .crossborder import compose

        cb = pd.read_parquet(cbp).merge(acc[["h3", "pop", "unit_id"]], on="h3", how="left")
        params = config.load("scenarios")["crossborder"]
        out = {}
        w = cb["pop"].to_numpy()
        for regime_name, regime in params["border_regimes"].items():
            av_wait = params["av_feeder"]["wait_min"]["central"]
            av = np.where(cb["av_served"], cb["av_walk_to_pickup_min"] + av_wait + cb["av_ride_min"] + cb["av_dropoff_walk_min"], np.inf)
            t_base = np.minimum(compose(cb["t_pt_bus"].to_numpy(), "bus", regime, params),
                                compose(cb["t_pt_ktm"].to_numpy(), "ktm", regime, params))
            t_rts = compose(cb["t_pt_rts"].to_numpy(), "rts", regime, params)
            t_rts_av = compose(np.minimum(cb["t_pt_rts"].to_numpy(), av), "rts", regime, params)
            rec = {}
            for label, t in (("baseline", t_base), ("rts", t_rts), ("rts_av", t_rts_av)):
                rec[label] = {
                    "median_min": float(weighted_quantile(t, w, 0.5)),
                    **{f"within_{x}": float(np.nansum(w * (t <= x)) / w.sum()) for x in (30, 45, 60, 75, 90)},
                }
            with np.errstate(invalid="ignore"):
                saving = np.where(np.isfinite(t_base) & np.isfinite(t_rts), t_base - t_rts, np.nan)
            rec["median_saving_min"] = float(weighted_quantile(saving, w, 0.5))
            rec["border_share_of_rts_trip"] = float(weighted_quantile((2 * regime["clearance_min_per_country"]) / t_rts, w, 0.5))
            out[regime_name] = rec
        res["rts"] = out
    return res
