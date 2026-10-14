"""Origin cells (H3 resolution 10) with modelled population.

Method (dasymetric, census-constrained):
  1. Sum the 30 m HRSL population raster (Meta / CIESIN) into H3 res-10 cells.
  2. Assign each cell to its official census unit by centroid:
     Singapore subzones (URA MP2019) and Johor Bahru state constituencies (DOSM).
  3. Rescale cells so each unit's total equals its official Census 2020 count:
         P_cell = P_unit * w_cell / sum(w_cell in unit),   w = HRSL population.
     Where HRSL sees no settlement in a unit that has residents (estates built
     after its imagery, e.g. parts of Punggol), Kontur 2023 is the weight.
  4. Residents aged 65+ are allocated the same way: official 65+ counts per unit
     (SingStat subzone table; DOSM constituency shares), spread within the unit
     by the HRSL elderly (60+) raster.

An alternative allocation (sensitivity) spreads Kontur's H3 res-8 population
uniformly over res-10 children and applies the same census constraint, which
isolates the effect of the *within-unit* allocation choice.

Definitions differ by country and are reported, not hidden: Singapore subzone
counts cover residents (citizens + PRs); Malaysia's count all persons.
"""

from __future__ import annotations

import gzip
import shutil

import geopandas as gpd
import h3
import numpy as np
import pandas as pd
import rasterio

from . import boundaries, config


def raster_to_cells(path, res: int) -> pd.DataFrame:
    with rasterio.open(path) as src:
        a = src.read(1)
        tr = src.transform
    a = np.nan_to_num(a, nan=0.0)
    rows, cols = np.nonzero(a > 0)
    vals = a[rows, cols].astype(np.float64)
    lon = tr.c + (cols + 0.5) * tr.a
    lat = tr.f + (rows + 0.5) * tr.e
    cells = np.fromiter((h3.str_to_int(h3.latlng_to_cell(la, lo, res)) for la, lo in zip(lat, lon)),
                        dtype=np.int64, count=len(lat))
    df = pd.DataFrame({"h3": cells, "value": vals})
    return df.groupby("h3", as_index=False)["value"].sum()


def kontur_cells(res: int) -> pd.DataFrame:
    """Kontur res-8 population split uniformly across res-10 children."""
    frames = []
    for cc in ("SG", "MY"):
        gz = config.raw("population", f"kontur_population_{cc}_20231101.gpkg.gz")
        gpkg = config.interim(f"kontur_{cc}.gpkg")
        if not gpkg.exists():
            with gzip.open(gz, "rb") as fi, gpkg.open("wb") as fo:
                shutil.copyfileobj(fi, fo)
        k = gpd.read_file(gpkg, ignore_geometry=True)
        bbox = config.load("study_area")["acquisition_bbox"]
        ll = np.array([h3.cell_to_latlng(c) for c in k["h3"]])
        inside = (ll[:, 1] >= bbox[0]) & (ll[:, 1] <= bbox[2]) & (ll[:, 0] >= bbox[1]) & (ll[:, 0] <= bbox[3])
        frames.append(k.loc[inside, ["h3", "population"]])
    k = pd.concat(frames)
    out_h3, out_v = [], []
    for c, p in zip(k["h3"], k["population"]):
        kids = h3.cell_to_children(c, res)
        out_h3.extend(h3.str_to_int(x) for x in kids)
        out_v.extend([p / len(kids)] * len(kids))
    df = pd.DataFrame({"h3": np.array(out_h3, dtype=np.int64), "value": out_v})
    return df.groupby("h3", as_index=False)["value"].sum()


def _assign_units(cells: pd.DataFrame) -> pd.DataFrame:
    """Attach SG subzone / planning area or JB constituency to each cell centroid."""
    ll = np.array([h3.cell_to_latlng(h3.int_to_str(int(c))) for c in cells["h3"]])
    pts = gpd.GeoDataFrame(cells.copy(), geometry=gpd.points_from_xy(ll[:, 1], ll[:, 0]), crs="EPSG:4326")
    pts["lon"], pts["lat"] = ll[:, 1], ll[:, 0]
    sz = boundaries.sg_subzones()[["sz_code", "sz_name", "pa_code", "pa_name", "geometry"]]
    sa = config.load("study_area")
    dun = boundaries.my_duns(sa["cities"]["jb"]["dun_codes"])[["dun_code", "dun_name", "geometry"]]
    a = gpd.sjoin(pts, sz, how="left", predicate="within").drop(columns="index_right")
    a = a[~a.index.duplicated()]
    b = gpd.sjoin(a, dun, how="left", predicate="within").drop(columns="index_right")
    b = b[~b.index.duplicated()]
    b["city"] = np.where(b["sz_code"].notna(), "sg", np.where(b["dun_code"].notna(), "jb", None))
    b["unit_id"] = np.where(b["city"] == "sg", b["pa_code"], "JB-" + b["dun_code"].astype(str))
    b["census_unit"] = np.where(b["city"] == "sg", b["sz_code"], b["dun_code"])
    return pd.DataFrame(b.drop(columns="geometry"))


def _census_targets() -> pd.DataFrame:
    sz = boundaries.sg_subzones()[["sz_code", "sz_name", "pa_name"]]
    cs = boundaries.sg_census_subzone().merge(sz, on=["pa_name", "sz_name"], how="inner")
    age = boundaries.sg_age65_subzone()
    cs = cs.merge(age[["pa_name", "sz_name", "residents_65plus"]], on=["pa_name", "sz_name"], how="left")
    sg = pd.DataFrame({"census_unit": cs["sz_code"], "census_pop": cs["residents"],
                       "census_65": cs["residents_65plus"].fillna(0.0), "city": "sg"})
    my = boundaries.my_census_dun()
    codes = config.load("study_area")["cities"]["jb"]["dun_codes"]
    my = my[my["dun_code"].isin(codes)]
    pop = my["population_total"].astype(float)
    jb = pd.DataFrame({"census_unit": my["dun_code"], "census_pop": pop,
                       "census_65": (pop * my["age_proportion_65_above"].astype(float) / 100.0).round(), "city": "jb"})
    return pd.concat([sg, jb], ignore_index=True)


def calibrate(cells: pd.DataFrame, weight: np.ndarray, targets: pd.Series) -> tuple[np.ndarray, pd.DataFrame]:
    """Census-constrained allocation of ``targets`` (indexed by census unit) using ``weight``.

    Returns the calibrated per-cell values and a per-unit report with the
    model total before calibration and any population that could not be placed.
    """
    w = pd.Series(weight, index=cells.index).groupby(cells["census_unit"]).sum().rename("model_pop")
    rep = pd.DataFrame({"target": targets}).join(w, how="left").fillna({"model_pop": 0.0})
    rep["factor"] = rep["target"] / rep["model_pop"].where(rep["model_pop"] > 0)
    f = cells["census_unit"].map(rep["factor"]).fillna(0.0).to_numpy()
    rep["unallocated"] = np.where(rep["model_pop"] > 0, 0.0, rep["target"])
    return weight * f, rep


def build_cells() -> tuple[pd.DataFrame, pd.DataFrame]:
    res = config.load("study_area")["h3_resolution"]
    pop = raster_to_cells(config.raw("population", "hrsl_general_sgjb.tif"), res).rename(columns={"value": "pop_hrsl_raw"})
    eld = raster_to_cells(config.raw("population", "hrsl_elderly60_sgjb.tif"), res).rename(columns={"value": "eld_hrsl_raw"})
    kon = kontur_cells(res).rename(columns={"value": "pop_kontur_raw"})
    cells = pop.merge(eld, on="h3", how="outer").merge(kon, on="h3", how="outer").fillna(0.0)
    cells = _assign_units(cells)
    cells = cells[cells["city"].notna()].reset_index(drop=True)
    targets = _census_targets().set_index("census_unit")
    # hierarchical weight: HRSL, or Kontur inside units where HRSL sees nobody
    hrsl_unit = cells.groupby("census_unit")["pop_hrsl_raw"].transform("sum")
    use_kontur = hrsl_unit.to_numpy() <= 0
    weight = np.where(use_kontur, cells["pop_kontur_raw"], cells["pop_hrsl_raw"])
    cells["weight_source"] = np.where(use_kontur, "kontur", "hrsl")
    cells["pop"], rep_h = calibrate(cells, weight, targets["census_pop"])
    cells["pop_kontur"], rep_k = calibrate(cells, cells["pop_kontur_raw"].to_numpy(), targets["census_pop"])
    # residents 65+: official totals, spread by the HRSL elderly raster (or by population)
    eld_unit = cells.groupby("census_unit")["eld_hrsl_raw"].transform("sum").to_numpy()
    eld_w = np.where(eld_unit > 0, cells["eld_hrsl_raw"], cells["pop"])
    cells["elderly"], rep_e = calibrate(cells, eld_w, targets["census_65"])
    cells["elderly"] = np.minimum(cells["elderly"], cells["pop"])
    hr = cells.groupby("census_unit")["pop_hrsl_raw"].sum().rename("hrsl_pop")
    rep = (targets.join(rep_h[["model_pop", "unallocated"]]).join(hr)
           .join(rep_k["model_pop"].rename("kontur_pop")).reset_index())
    rep["weight_source"] = np.where(rep["hrsl_pop"].fillna(0) > 0, "hrsl", "kontur")
    cells = cells[(cells["pop"] > 0) | (cells["pop_kontur"] > 0)].reset_index(drop=True)
    return cells, rep


def main() -> None:
    config.ensure_dirs()
    cells, rep = build_cells()
    cells.to_parquet(config.interim("cells.parquet"), index=False)
    rep.to_csv(config.derived("population_calibration.csv"), index=False)
    for city in ("sg", "jb"):
        c = cells[cells.city == city]
        r = rep[rep.city == city]
        print(f"{city}: cells={len(c):,} pop={c['pop'].sum():,.0f} (census {r['census_pop'].sum():,.0f}; "
              f"HRSL raw in units {r['hrsl_pop'].sum():,.0f}; Kontur raw {r['kontur_pop'].sum():,.0f}) "
              f"65+={c['elderly'].sum():,.0f} ({c['elderly'].sum() / c['pop'].sum():.1%}; census {r['census_65'].sum():,.0f}) "
              f"unallocated={r['unallocated'].sum():,.0f}; kontur-weighted units={int((r['weight_source'] == 'kontur').sum())}")


if __name__ == "__main__":
    main()
