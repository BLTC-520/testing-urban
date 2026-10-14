"""Official boundaries and census tables for both cities."""

from __future__ import annotations

import re

import geopandas as gpd
import pandas as pd
from shapely.ops import unary_union

from . import config
from .geo import metric_crs

_ATTR = re.compile(r"<th>([^<]+)</th>\s*<td>([^<]*)</td>")


def _kml_attrs(desc: str) -> dict[str, str]:
    """URA files are KML conversions; attributes live in an HTML table."""
    return {k.strip(): v.strip() for k, v in _ATTR.findall(desc or "")}


def _from_ura(path) -> gpd.GeoDataFrame:
    gdf = gpd.read_file(path)
    attrs = pd.DataFrame([_kml_attrs(d) for d in gdf["Description"]])
    out = gpd.GeoDataFrame(attrs, geometry=gdf.geometry.values, crs="EPSG:4326")
    out["geometry"] = out.geometry.force_2d().make_valid()
    return out


def sg_planning_areas() -> gpd.GeoDataFrame:
    gdf = _from_ura(config.raw("sg_planning_areas", "MasterPlan2019PlanningAreaBoundaryNoSea.geojson"))
    gdf = gdf.rename(columns={"PLN_AREA_N": "pa_name", "PLN_AREA_C": "pa_code", "REGION_N": "region"})
    return gdf[["pa_code", "pa_name", "region", "geometry"]]


def sg_subzones() -> gpd.GeoDataFrame:
    gdf = _from_ura(config.raw("sg_planning_areas", "SGsubzone.geojson"))
    gdf = gdf.rename(columns={"SUBZONE_N": "sz_name", "SUBZONE_C": "sz_code", "PLN_AREA_N": "pa_name",
                              "PLN_AREA_C": "pa_code", "REGION_N": "region"})
    return gdf[["sz_code", "sz_name", "pa_code", "pa_name", "region", "geometry"]]


def sg_census_subzone() -> pd.DataFrame:
    """Census 2020 resident population by subzone (planning-area total rows dropped)."""
    df = pd.read_csv(config.raw("sg_census_subzone",
                                "ResidentPopulationbyPlanningAreaSubzoneofResidenceEthnicGroupandSexCensusofPopulation2020.csv"))
    df = df.rename(columns={"Number": "name", "Total_Total": "residents"})
    df["residents"] = pd.to_numeric(df["residents"].astype(str).str.replace(",", ""), errors="coerce").fillna(0)
    # planning-area total rows look like "Ang Mo Kio - Total" (spacing varies: "Changi- Total")
    total_rx = r"\s*-\s*Total$"
    is_pa_total = df["name"].str.contains(total_rx, regex=True)
    df["is_total"] = is_pa_total | (df["name"] == "Total")
    # attach planning area to each subzone row (rows follow their PA total)
    pa = df["name"].where(is_pa_total).str.replace(total_rx, "", regex=True)
    df["pa_name"] = pa.ffill().str.upper()
    sz = df[~df["is_total"]].copy()
    sz["sz_name"] = sz["name"].str.upper().str.strip()
    return sz[["pa_name", "sz_name", "residents"]].reset_index(drop=True)


def sg_age65_subzone() -> pd.DataFrame:
    """Residents aged 65+ and total residents by subzone, June 2020 (SingStat)."""
    import zipfile

    zpath = config.raw("sg_age_subzone", "respopagesexfa2011to2020e.zip")
    cache = config.interim("sg_age65_subzone_2020.csv")
    if cache.exists():
        return pd.read_csv(cache)
    with zipfile.ZipFile(zpath) as z:
        name = next(n for n in z.namelist() if n.endswith("June 2020.xlsx"))
        with z.open(name) as fh:
            df = pd.read_excel(fh, sheet_name="Total", header=2)
    df.columns = ["pa_name", "sz_name", "age", "floor", "pop"]
    df = df[(df["floor"].astype(str).str.startswith("Total")) & (df["pa_name"] != "Total") & (df["sz_name"] != "Total")]
    df["pop"] = pd.to_numeric(df["pop"], errors="coerce").fillna(0)
    ages = df["age"].astype(str)
    lower = pd.to_numeric(ages.str.extract(r"^(\d+)")[0], errors="coerce")
    tot = df[ages == "Total"].groupby(["pa_name", "sz_name"])["pop"].sum().rename("residents")
    old = df[lower >= 65].groupby(["pa_name", "sz_name"])["pop"].sum().rename("residents_65plus")
    out = pd.concat([tot, old], axis=1).fillna(0).reset_index()
    out["pa_name"] = out["pa_name"].str.upper().str.strip()
    out["sz_name"] = out["sz_name"].str.upper().str.strip()
    out.to_csv(cache, index=False)
    return out


def sg_census_national_total() -> int:
    df = pd.read_csv(config.raw("sg_census_subzone",
                                "ResidentPopulationbyPlanningAreaSubzoneofResidenceEthnicGroupandSexCensusofPopulation2020.csv"))
    return int(str(df.loc[df["Number"] == "Total", "Total_Total"].iloc[0]).replace(",", ""))


def my_census_dun() -> pd.DataFrame:
    df = pd.read_csv(config.raw("my_census_dun", "census_dun.csv"), encoding="utf-8-sig")
    df = df[(df["state"] == "Johor") & (df["year"] == 2020)]
    return df.rename(columns={"code_dun": "dun_code", "dun": "dun_name"})


def my_duns(codes: list[str] | None = None) -> gpd.GeoDataFrame:
    gdf = gpd.read_file(config.raw("my_boundaries", "electoral_1_dun.geojson"))
    gdf = gdf[gdf["state"] == "Johor"].rename(columns={"code_dun": "dun_code", "dun": "dun_name"})
    if codes:
        gdf = gdf[gdf["dun_code"].isin(codes)]
    gdf["geometry"] = gdf.geometry.make_valid()
    return gdf[["dun_code", "dun_name", "parlimen", "geometry"]].reset_index(drop=True)


def neighbourhoods() -> gpd.GeoDataFrame:
    """Comparable neighbourhood units: SG planning areas + JB state constituencies."""
    sa = config.load("study_area")
    pa = sg_planning_areas().rename(columns={"pa_code": "unit_id", "pa_name": "unit_name"})
    pa["city"] = "sg"
    pa["unit_name"] = pa["unit_name"].str.title()
    dun = my_duns(sa["cities"]["jb"]["dun_codes"]).rename(columns={"dun_code": "unit_id", "dun_name": "unit_name"})
    dun["unit_name"] = dun["unit_name"].str.replace(r"^N\.\d+\s+", "", regex=True)
    dun["unit_id"] = "JB-" + dun["unit_id"]
    dun["city"] = "jb"
    cols = ["city", "unit_id", "unit_name", "geometry"]
    gdf = pd.concat([pa[cols], dun[cols]], ignore_index=True)
    gdf = gpd.GeoDataFrame(gdf, geometry="geometry", crs="EPSG:4326")
    gdf["area_km2"] = gdf.to_crs(metric_crs()).area / 1e6
    return gdf


def city_polygons() -> dict[str, object]:
    nb = neighbourhoods()
    return {c: unary_union(nb.loc[nb["city"] == c, "geometry"].values) for c in ("sg", "jb")}
