"""Download every raw input listed in config/sources.yml into data/raw/.

Each file is recorded in data/provenance.json with its URL, retrieval time,
size and SHA-256 so that a later run can prove it used identical inputs.

    python -m sgjb.acquire            # everything except the OSM extract
    python -m sgjb.acquire --osm      # also build the OSM extract (slow, ~95 GB streamed)
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

from . import config

PROVENANCE = config.DATA_DIR / "provenance.json"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def record(source_id: str, path: Path, url: str, extra: dict | None = None) -> None:
    prov = json.loads(PROVENANCE.read_text()) if PROVENANCE.exists() else {}
    prov.setdefault(source_id, {})[path.name] = {
        "path": str(path.relative_to(config.ROOT)),
        "url": url,
        "retrieved_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
        **(extra or {}),
    }
    PROVENANCE.write_text(json.dumps(prov, indent=2, sort_keys=True) + "\n")


def http_get(url: str, dest: Path, force: bool = False) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and not force:
        return dest
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url, timeout=300) as r, tmp.open("wb") as fh:
        shutil.copyfileobj(r, fh)
    tmp.rename(dest)
    return dest


def git_files(repo: str, commit: str | None, paths: list[str], dest_dir: Path) -> list[Path]:
    """Sparse, blob-less checkout of selected files at a pinned commit."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    out = [dest_dir / Path(p).name for p in paths]
    if all(p.exists() for p in out):
        return out
    with tempfile.TemporaryDirectory() as td:
        subprocess.run(["git", "clone", "-q", "--filter=blob:none", "--no-checkout", repo, td], check=True)
        if commit:
            subprocess.run(["git", "-C", td, "checkout", "-q", commit, "--", *paths], check=True)
        else:
            subprocess.run(["git", "-C", td, "checkout", "-q", "HEAD", "--", *paths], check=True)
        for p, o in zip(paths, out):
            shutil.copy(Path(td) / p, o)
    return out


def cog_window(url: str, dest: Path, bbox: list[float], categorical: bool = False) -> Path:
    """Read only the study bbox from a cloud-optimised GeoTIFF (HTTP range requests).

    Continuous rasters are stored as float32 with NaN → 0; categorical rasters
    keep their original integer codes.
    """
    import numpy as np
    import rasterio
    from rasterio.windows import from_bounds

    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    with rasterio.open("/vsicurl/" + url) as src:
        w = from_bounds(*bbox, transform=src.transform).round_offsets().round_lengths()
        a = src.read(1, window=w)
        prof = src.profile.copy()
        prof.update(width=a.shape[1], height=a.shape[0], transform=src.window_transform(w),
                    compress="deflate", tiled=True, blockxsize=256, blockysize=256)
    if not categorical:
        a = np.nan_to_num(a.astype("float32"), nan=0.0)
        prof.update(dtype="float32", predictor=2)
    with rasterio.open(dest, "w", **prof) as dst:
        dst.write(a, 1)
    return dest


def fetch_osm(src: dict, bbox: list[float], dest: Path) -> Path:
    """Stream the dated planet through ``osmium extract`` (no planet on disk)."""
    if dest.exists():
        return dest
    url = src["fetch"]["https"]
    streamer = config.ROOT / "scripts" / "stream_ranges.py"
    b = ",".join(str(x) for x in bbox)
    cmd = (f"{sys.executable} {streamer} {url} | "
           f"osmium extract -b {b} -s simple -F pbf - -o {dest} --overwrite")
    subprocess.run(cmd, shell=True, check=True)
    return dest


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--osm", action="store_true", help="also build the OSM extract (streams the planet)")
    args = ap.parse_args(argv)
    config.ensure_dirs()
    bbox = config.load("study_area")["acquisition_bbox"]
    sources = {s["id"]: s for s in config.load("sources")["sources"]}

    # --- population rasters (windowed reads)
    for sid, name in [("hrsl_general", "hrsl_general_sgjb.tif"), ("hrsl_elderly", "hrsl_elderly60_sgjb.tif")]:
        url = sources[sid]["fetch"]["https"]
        p = cog_window(url, config.raw("population", name), bbox)
        record(sid, p, url, {"window_bbox": bbox})
    wc = sources["worldcover"]["fetch"]["https"]
    p = cog_window(wc, config.raw("worldcover", "worldcover_2021_sgjb.tif"), bbox, categorical=True)
    record("worldcover", p, wc, {"window_bbox": bbox})
    for url in sources["kontur"]["fetch"]["https"]:
        p = http_get(url, config.raw("population", Path(url).name))
        record("kontur", p, url)

    # --- git-hosted official data
    for sid in ("my_census_dun", "my_boundaries", "sg_planning_areas", "sg_census_subzone", "sg_age_subzone",
                "sg_rail_stations_lta", "sg_rail_stations_mp19"):
        f = sources[sid]["fetch"]
        for p in git_files(f["git"], f.get("commit"), f["paths"], config.raw(sid)):
            record(sid, p, f["git"], {"commit": f.get("commit")})
    f = sources["sg_bus"]["fetch"]
    for p in git_files(f["git"], None, f["paths"], config.raw("sg_bus")):
        record("sg_bus", p, f["git"])

    # --- Overture places (bbox-filtered GeoParquet scan on S3)
    from . import overture
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    p = overture.fetch(proxy=proxy)
    record("overture_places", p, sources["overture_places"]["fetch"]["s3"], {"bbox": bbox})

    # --- GTFS
    for sid in ("gtfs_mybas_johor", "gtfs_ktmb"):
        url = sources[sid]["fetch"]["https"]
        p = http_get(url, config.raw("gtfs", Path(url).name))
        record(sid, p, url)

    # --- OpenStreetMap
    osm_dest = config.raw("osm", "sgjb-261005.osm.pbf")
    if args.osm or osm_dest.exists():
        p = fetch_osm(sources["osm"], bbox, osm_dest)
        record("osm", p, sources["osm"]["fetch"]["https"], {"planet_md5": sources["osm"]["fetch"]["md5"], "bbox": bbox})
    else:
        print("OSM extract missing: run `python -m sgjb.acquire --osm` (streams ~95 GB) "
              "or place a regional .osm.pbf at", osm_dest)
    print("provenance written to", PROVENANCE)


if __name__ == "__main__":
    main()
