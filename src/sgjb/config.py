"""Project paths and YAML configuration loading."""

from __future__ import annotations

import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml


class _Yaml12Loader(yaml.SafeLoader):
    """SafeLoader with YAML 1.2 booleans.

    PyYAML implements YAML 1.1, where bare ``yes/no/on/off`` become booleans.
    OSM tag values such as ``foot: [no]`` must stay strings, so only
    ``true``/``false`` are treated as booleans here.
    """


_Yaml12Loader.yaml_implicit_resolvers = {
    ch: [(tag, rx) for tag, rx in resolvers if tag != "tag:yaml.org,2002:bool"]
    for ch, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
}
_Yaml12Loader.add_implicit_resolver(
    "tag:yaml.org,2002:bool", re.compile(r"^(?:true|True|TRUE|false|False|FALSE)$"), list("tTfF")
)

ROOT = Path(os.environ.get("SGJB_ROOT", Path(__file__).resolve().parents[2]))
CONFIG_DIR = ROOT / "config"
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
INTERIM_DIR = DATA_DIR / "interim"
DERIVED_DIR = DATA_DIR / "derived"
WEB_DATA_DIR = ROOT / "web" / "public" / "data"
REPORTS_DIR = ROOT / "reports"


@lru_cache(maxsize=None)
def load(name: str) -> dict[str, Any]:
    """Load ``config/<name>.yml`` (cached)."""
    path = CONFIG_DIR / f"{name}.yml"
    with path.open(encoding="utf-8") as fh:
        return yaml.load(fh, Loader=_Yaml12Loader)  # noqa: S506 - safe loader subclass


def ensure_dirs() -> None:
    for d in (RAW_DIR, INTERIM_DIR, DERIVED_DIR, WEB_DATA_DIR, REPORTS_DIR):
        d.mkdir(parents=True, exist_ok=True)


def raw(*parts: str) -> Path:
    return RAW_DIR.joinpath(*parts)


def interim(*parts: str) -> Path:
    return INTERIM_DIR.joinpath(*parts)


def derived(*parts: str) -> Path:
    return DERIVED_DIR.joinpath(*parts)
