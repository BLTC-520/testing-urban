"""Turn reference photographs of the landmarks into numbers the modeller can use.

Why this step exists
--------------------
A 3D landmark on a dark map only reads as *that* landmark if two things are
right: its proportions and the colour it glows at night. Both are measurable
from a photograph, and measuring beats guessing — "the Sands towers are about
three times as tall as they are wide" is a claim a reader can check, whereas a
hand-picked hex code is not.

So this script reads a few night photographs, and writes out:

* ``palette``    the dominant colours, k-means over a subsample of pixels
* ``emissive``   the colours of the brightest 2% of pixels — the lit windows,
                 the LED strips, the uplit canopies. These become the emission
                 colours of the Blender materials.
* ``sky``        the median colour of the top rows, i.e. the night sky the
                 photograph was exposed for. Used to sanity-check that the
                 model's glow sits above the dashboard's own background.
* ``profile``    a width-vs-height silhouette profile of the lit structure,
                 normalised to 0..1. Used to check a model's proportions
                 against the photograph it was modelled from.

The photographs themselves are NOT committed: they come from third-party
repositories with unclear licences. Only these derived numbers are, together
with the URL each came from, so the step is reproducible by anyone who
re-downloads the sources listed in ``sources.json``.

Usage
-----
    python scripts/landmarks/analyse_refs.py <image-dir> -o <out.json>

``<image-dir>`` holds the downloaded photographs named ``<key>.jpg``, where
``<key>`` matches an entry in ``sources.json``.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

import numpy as np
from PIL import Image

# Pixels are subsampled before clustering: a 1 MP photograph has far more
# pixels than k-means needs, and the full array makes the step minutes long.
SAMPLE = 40_000
K = 6
# "Brightest 2%" is deliberately strict. A night photograph of a lit building
# is mostly dark; the top decile would drag in the sky glow and the water.
EMISSIVE_Q = 0.98


def kmeans(x: np.ndarray, k: int, iters: int = 40, seed: int = 7) -> tuple[np.ndarray, np.ndarray]:
    """Plain Lloyd's algorithm with k-means++ seeding.

    Written out rather than pulled from scikit-learn because the dependency is
    not otherwise needed here, and because the loop is four lines: assign every
    point to its nearest centre, move every centre to the mean of its points,
    repeat. Returns the centres and the share of points attached to each.
    """
    rng = np.random.default_rng(seed)
    # k-means++: first centre at random, then each next centre chosen with
    # probability proportional to its squared distance from the nearest centre
    # already chosen. Plain random seeding puts two centres in the same cluster
    # often enough to matter on photographs, which are very unevenly coloured.
    centres = [x[rng.integers(len(x))]]
    for _ in range(k - 1):
        d = np.min(((x[:, None, :] - np.array(centres)[None, :, :]) ** 2).sum(-1), axis=1)
        total = d.sum()
        probs = d / total if total > 0 else np.full(len(x), 1 / len(x))
        centres.append(x[rng.choice(len(x), p=probs)])
    c = np.array(centres, dtype=np.float64)

    for _ in range(iters):
        d = ((x[:, None, :] - c[None, :, :]) ** 2).sum(-1)
        lab = d.argmin(1)
        moved = 0.0
        for j in range(k):
            m = lab == j
            if m.any():
                new = x[m].mean(0)
                moved = max(moved, float(np.abs(new - c[j]).max()))
                c[j] = new
        if moved < 0.5:  # centres settled to within half an 8-bit level
            break
    share = np.bincount(lab, minlength=k) / len(lab)
    return c, share


def hexcolor(rgb: np.ndarray) -> str:
    r, g, b = (int(round(float(v))) for v in np.clip(rgb, 0, 255))
    return f"#{r:02x}{g:02x}{b:02x}"


def luminance(a: np.ndarray) -> np.ndarray:
    """Rec. 709 relative luminance, the usual perceptual weighting."""
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def profile(a: np.ndarray, rows: int = 24) -> list[float]:
    """Lit width per horizontal band, normalised against the widest band.

    A night photograph thresholded at its own mean-plus-a-sigma is a decent
    silhouette of the lit structure. Reading the lit width band by band gives a
    shape fingerprint: the Sands profile is narrow at the top (the SkyPark
    cantilever), wide across the towers, wider still at the podium.
    """
    lum = luminance(a)
    thr = lum.mean() + lum.std()
    lit = lum > thr
    h = lit.shape[0]
    out = []
    for i in range(rows):
        band = lit[i * h // rows : (i + 1) * h // rows]
        out.append(float(band.any(axis=0).mean()))
    top = max(out) or 1.0
    return [round(v / top, 3) for v in out]


def analyse(path: pathlib.Path) -> dict:
    img = Image.open(path).convert("RGB")
    a = np.asarray(img, dtype=np.float64)
    h, w, _ = a.shape
    flat = a.reshape(-1, 3)

    rng = np.random.default_rng(11)
    idx = rng.choice(len(flat), size=min(SAMPLE, len(flat)), replace=False)
    centres, share = kmeans(flat[idx], K)
    order = np.argsort(-share)

    lum = luminance(flat)
    bright = flat[lum >= np.quantile(lum, EMISSIVE_Q)]
    ec, es = kmeans(bright[rng.choice(len(bright), size=min(SAMPLE, len(bright)), replace=False)], 3)
    eorder = np.argsort(-es)

    return {
        "size": [w, h],
        "palette": [
            {"hex": hexcolor(centres[i]), "share": round(float(share[i]), 3)} for i in order
        ],
        "emissive": [
            {"hex": hexcolor(ec[i]), "share": round(float(es[i]), 3)} for i in eorder
        ],
        "sky": hexcolor(np.median(a[: max(1, h // 12)].reshape(-1, 3), axis=0)),
        "mean_luminance": round(float(lum.mean()) / 255, 4),
        "profile": profile(a),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("image_dir", type=pathlib.Path)
    ap.add_argument("-o", "--out", type=pathlib.Path, required=True)
    args = ap.parse_args()

    here = pathlib.Path(__file__).parent
    sources = json.loads((here / "sources.json").read_text())

    out: dict[str, dict] = {}
    for key, meta in sources["references"].items():
        found = sorted(args.image_dir.glob(f"{key}.*"))
        if not found:
            print(f"  skip {key}: no image in {args.image_dir}", file=sys.stderr)
            continue
        print(f"  {key} <- {found[0].name}", file=sys.stderr)
        out[key] = {"source": meta, **analyse(found[0])}

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote {args.out} ({len(out)} references)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
