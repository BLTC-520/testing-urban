"""The landmark tooling: footprint geometry, palette clustering, and the manifest.

The models themselves are not testable here — "does this look like the Merlion"
is a question for scripts/landmarks and the dashboard's own check page. What is
testable is everything the models are built *from*: the footprint maths that
decides where a model stands and which way it points, the clustering that picks
its colours, and the manifest the dashboard imports.
"""

import importlib.util
import json
import math
import pathlib

import numpy as np
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
TOOLS = ROOT / "scripts" / "landmarks"


def load(name: str):
    """Import one of the landmark scripts by path.

    They live in scripts/ rather than in the sgjb package because they are a
    build step, not part of the pipeline, and they are run by Blender's own
    interpreter. That puts them outside the import path, hence this.
    """
    spec = importlib.util.spec_from_file_location(name, TOOLS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# --------------------------------------------------------------------------
# footprints.py — where a model stands and which way it points
# --------------------------------------------------------------------------


@pytest.fixture(scope="module")
def footprints():
    pytest.importorskip("pmtiles")
    pytest.importorskip("mapbox_vector_tile")
    return load("footprints")


def ring_at(lat: float, lon: float, length_m: float, width_m: float, bearing_deg: float):
    """A rectangle of a given size and bearing, as lon/lat corners."""
    b = math.radians(bearing_deg)
    # Along-axis and across-axis unit vectors, in metres.
    along = (math.sin(b), math.cos(b))
    across = (math.cos(b), -math.sin(b))
    mlon = 111_320.0 * math.cos(math.radians(lat))
    out = []
    for sa, sc in ((+1, +1), (+1, -1), (-1, -1), (-1, +1)):
        ex = sa * along[0] * length_m / 2 + sc * across[0] * width_m / 2
        ny = sa * along[1] * length_m / 2 + sc * across[1] * width_m / 2
        out.append((lon + ex / mlon, lat + ny / 110_540.0))
    return out


@pytest.mark.parametrize("bearing", [0.0, 23.4, 67.0, 110.0, 179.0])
def test_describe_recovers_the_bearing_it_was_given(footprints, bearing):
    ring = ring_at(1.2834, 103.8608, 340.0, 60.0, bearing)
    d = footprints.describe(ring)
    assert d["bearing_deg"] == pytest.approx(bearing, abs=0.6)
    assert d["length_m"] == pytest.approx(340.0, rel=0.02)
    assert d["width_m"] == pytest.approx(60.0, rel=0.02)
    assert d["area_m2"] == pytest.approx(340.0 * 60.0, rel=0.02)
    assert d["elongation"] == pytest.approx(340 / 60, rel=0.03)


def test_bearing_is_an_axis_not_a_direction(footprints):
    """A slab pointing north-east and one pointing south-west are the same slab."""
    a = footprints.describe(ring_at(1.28, 103.86, 200.0, 40.0, 30.0))
    b = footprints.describe(ring_at(1.28, 103.86, 200.0, 40.0, 210.0))
    assert a["bearing_deg"] == pytest.approx(b["bearing_deg"], abs=0.6)
    assert 0.0 <= a["bearing_deg"] < 180.0


def test_centroid_is_the_polygon_centroid_not_the_vertex_mean(footprints):
    """Extra vertices along one wall must not drag the centre towards it."""
    plain = ring_at(1.28, 103.86, 200.0, 40.0, 0.0)
    # Same rectangle, but with the first edge subdivided five times.
    dense = [plain[0]]
    for t in range(1, 6):
        k = t / 6
        dense.append((plain[0][0] + (plain[1][0] - plain[0][0]) * k,
                      plain[0][1] + (plain[1][1] - plain[0][1]) * k))
    dense += plain[1:]
    a = footprints.describe(plain)["centroid"]
    b = footprints.describe(dense)["centroid"]
    assert b[0] == pytest.approx(a[0], abs=1e-5)
    assert b[1] == pytest.approx(a[1], abs=1e-5)


def test_point_in_ring(footprints):
    ring = ring_at(1.28, 103.86, 200.0, 60.0, 0.0)
    assert footprints.point_in_ring(103.86, 1.28, ring)
    assert not footprints.point_in_ring(103.87, 1.28, ring)


def test_tile_and_unproject_round_trip(footprints):
    lat, lon, z = 1.2834, 103.8608, 15
    x, y = footprints.tile_of(lat, lon, z)
    # The tile's own corner must come back as a point inside the tile.
    blon, blat = footprints.unproject(x, y, z, 0, 4096, 4096)
    assert blon <= lon and blat >= lat
    span = footprints.unproject(x + 1, y, z, 0, 4096, 4096)[0] - blon
    assert lon - blon < span


# --------------------------------------------------------------------------
# analyse_refs.py — the colours the models are painted with
# --------------------------------------------------------------------------


@pytest.fixture(scope="module")
def refs():
    pytest.importorskip("PIL")
    return load("analyse_refs")


def test_kmeans_separates_planted_clusters(refs):
    rng = np.random.default_rng(3)
    a = rng.normal((20, 20, 20), 3, size=(400, 3))
    b = rng.normal((230, 200, 120), 3, size=(200, 3))
    centres, share = refs.kmeans(np.vstack([a, b]), 2)
    order = np.argsort(centres[:, 0])
    assert centres[order[0]][0] == pytest.approx(20, abs=3)
    assert centres[order[1]][1] == pytest.approx(200, abs=4)
    # Two thirds of the points were planted in the dark cluster.
    assert share[order[0]] == pytest.approx(2 / 3, abs=0.02)


def test_profile_reads_the_lit_width_band_by_band(refs):
    """A bright triangle must widen down the profile and normalise to 1.

    The triangle is kept narrow on purpose: the threshold is the image's own
    mean plus a standard deviation, which a mostly-lit image pushes above the
    brightest pixel in it. That is correct for a night photograph, where the
    lit structure is a small part of the frame, and it is worth knowing.
    """
    a = np.zeros((240, 240, 3))
    for row in range(240):
        half = int(row / 6) + 1
        a[row, 120 - half : 120 + half] = 255
    p = refs.profile(a, rows=8)
    assert p == sorted(p)
    assert max(p) == 1.0


def test_hexcolor_clamps(refs):
    assert refs.hexcolor(np.array([300.0, -5.0, 128.0])) == "#ff0080"


# --------------------------------------------------------------------------
# the manifest the dashboard imports
# --------------------------------------------------------------------------

MANIFEST = ROOT / "dashboard" / "src" / "map" / "landmarks.json"
MODELS = ROOT / "dashboard" / "public" / "models"
# The study area, generously bounded: anything outside it is a typo, not a
# landmark. Matches the basemap archive's own bounds.
BBOX = (103.3, 1.1, 104.3, 1.85)


def test_every_landmark_has_a_model_where_the_manifest_says():
    marks = json.loads(MANIFEST.read_text())["landmarks"]
    specs = {m["id"]: m for m in json.loads((TOOLS / "landmarks.json").read_text())["landmarks"]}
    assert marks, "the manifest is empty — run scripts/landmarks/build_models.py"
    assert {m["id"] for m in marks} == set(specs)

    for m in marks:
        assert (MODELS / m["model"]).is_file(), f"{m['id']}: no {m['model']}"
        assert BBOX[0] < m["lon"] < BBOX[2], f"{m['id']}: longitude outside the study area"
        assert BBOX[1] < m["lat"] < BBOX[3], f"{m['id']}: latitude outside the study area"
        assert 0.0 <= m["bearing"] < 360.0
        # The measured extent is what the dashboard scales from; a missing or
        # zero one would silently enlarge the landmark by a factor of infinity.
        assert m["extent_m"] > 1.0
        assert m["city"] in ("sg", "jb")
        assert m["confidence"] in ("published", "derived", "estimated")
        # Every placement says where its position and bearing came from. That
        # is the whole provenance contract of this layer.
        assert m["position_from"] and m["bearing_from"]


def test_only_the_smallest_landmark_is_drawn_out_of_scale():
    """The scale policy is "nothing under 80 m across"; check what that catches.

    The point is not the number but that it catches almost nothing: if a change
    to the models or the threshold starts enlarging half the map, the map has
    stopped being to scale and nobody has said so.
    """
    marks = json.loads(MANIFEST.read_text())["landmarks"]
    enlarged = [m["id"] for m in marks if m["extent_m"] < 80.0]
    assert enlarged == ["merlion"], enlarged


def test_no_landmark_stands_in_the_sea():
    """An invariant, not a bug report — nothing has tripped this yet.

    Published coordinates for waterfront buildings are routinely a few hundred
    metres out, and an anchor in the water is the one case the footprint search
    cannot rescue: it finds nothing to snap to and falls back to the point it
    was given. footprints.py tests the resolved position against the basemap's
    own water polygons, and the two landmarks that genuinely stand in water —
    the Merlion in the bay, the Causeway across the strait — say so in
    landmarks.json.
    """
    feet = json.loads((TOOLS / "refs" / "footprints.json").read_text())
    specs = json.loads((TOOLS / "landmarks.json").read_text())["landmarks"]
    allowed = {m["id"] for m in specs if m.get("expect_water")}
    wet = {k for k, v in feet.items() if v.get("on_water")}
    assert wet <= allowed, f"standing in water without saying so: {sorted(wet - allowed)}"


def test_models_stay_small_enough_to_ship():
    """Twelve landmarks are a map decoration, not a download."""
    total = sum(p.stat().st_size for p in MODELS.glob("*.glb"))
    assert total < 2_000_000, f"{total / 1e6:.1f} MB of models"


def test_a_landmark_sits_close_to_its_published_anchor():
    """Snapping to a footprint may nudge a landmark, but never move it."""
    marks = {m["id"]: m for m in json.loads(MANIFEST.read_text())["landmarks"]}
    for spec in json.loads((TOOLS / "landmarks.json").read_text())["landmarks"]:
        m = marks[spec["id"]]
        dx = (m["lon"] - spec["lon"]) * 111_320.0 * math.cos(math.radians(spec["lat"]))
        dy = (m["lat"] - spec["lat"]) * 110_540.0
        assert math.hypot(dx, dy) < 220.0, f"{spec['id']} moved {math.hypot(dx, dy):.0f} m"
