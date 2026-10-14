"""The site's labels, questions and non-resident count must match their config sources.

web/public/data/meta.json is exported from config/taxonomy.yml and config/study_area.yml,
and the site reads it at runtime. This test reads both sides directly (no sgjb import),
so a copy that has drifted from its source fails the suite.
"""

import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def _yaml(rel: str) -> dict:
    return yaml.safe_load((ROOT / rel).read_text(encoding="utf-8"))


def _meta() -> dict:
    return json.loads((ROOT / "web" / "public" / "data" / "meta.json").read_text(encoding="utf-8"))


def test_category_questions_and_labels_match_taxonomy():
    tax = _yaml("config/taxonomy.yml")["categories"]
    cats = {c["id"]: c for c in _meta()["categories"]}
    assert set(cats) == set(tax)
    for cid, cfg in tax.items():
        assert cats[cid]["question"] == cfg["question"], cid
        assert cats[cid]["label"] == cfg["label"], cid


def test_basket_matches_taxonomy():
    assert _meta()["basket"] == _yaml("config/taxonomy.yml")["basket"]


def test_singapore_non_resident_count_matches_study_area():
    sg = _yaml("config/study_area.yml")["cities"]["sg"]
    meta_sg = _meta()["cities"]["sg"]
    assert isinstance(sg["non_residents"], int) and sg["non_residents"] > 0
    assert meta_sg["non_residents"] == sg["non_residents"]
    assert meta_sg["non_residents_source"] == sg["non_residents_source"]
