"""Generate the facade textures from the colours measured off the photographs.

A tower lit window by window is the single strongest night-time cue there is,
and modelling the windows as geometry would cost tens of thousands of triangles
per tower for something the map never shows closer than a few hundred metres.
A texture costs one 512x512 image.

The colours are not invented: ``refs/analysis.json`` holds the clusters found in
the reference photographs, and ``mbs_night.emissive`` is the colour of its
brightest 2% of pixels — the lit windows themselves. The sky entry fixes how
dark the unlit facade should be relative to them.

Each texture is written twice, as a base-colour map and an emission map, because
glTF wants the two separately: the base colour is what the facade looks like
when the map's own lighting hits it, the emission is what it looks like when it
does not. Lit windows are bright in both; the wall between them is only in the
first.

    python scripts/landmarks/textures.py
"""

from __future__ import annotations

import argparse
import json
import pathlib
import random

from PIL import Image, ImageDraw, ImageFilter

SIZE = 512


def rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(int(round(x + (y - x) * t)) for x, y in zip(a, b))  # type: ignore[return-value]


def facade(
    wall: tuple[int, int, int],
    lights: list[tuple[int, int, int]],
    cols: int,
    rows: int,
    lit_share: float,
    seed: int,
) -> tuple[Image.Image, Image.Image]:
    """A grid of windows: some lit, some not, never in a tidy pattern.

    ``lit_share`` is the fraction of windows showing a light. Photographs of the
    Sands after dark sit near 0.45 — far from "every window on", which is what
    makes a rendered tower look like a Christmas tree.
    """
    rnd = random.Random(seed)
    base = Image.new("RGB", (SIZE, SIZE), wall)
    emit = Image.new("RGB", (SIZE, SIZE), (0, 0, 0))
    db, de = ImageDraw.Draw(base), ImageDraw.Draw(emit)

    cw, rh = SIZE / cols, SIZE / rows
    # Window inside its cell: a margin on all four sides reads as the mullion
    # and the spandrel between floors. The vertical margin is the larger one,
    # because a curtain wall's glass is wider than it is tall.
    mx, my = cw * 0.12, rh * 0.30

    for r in range(rows):
        for c in range(cols):
            x0, y0 = c * cw + mx, r * rh + my
            x1, y1 = (c + 1) * cw - mx, (r + 1) * rh - my
            if rnd.random() < lit_share:
                col = rnd.choice(lights)
                # Vary the brightness window to window: a floor of identical
                # lights is the giveaway of a procedural facade.
                k = rnd.uniform(0.45, 1.0)
                lit = tuple(int(v * k) for v in col)
                db.rectangle([x0, y0, x1, y1], fill=lit)
                de.rectangle([x0, y0, x1, y1], fill=lit)
            else:
                db.rectangle([x0, y0, x1, y1], fill=mix(wall, (0, 0, 0), 0.45))

    # No whole-floor light bands. They look right in a single image and wrong
    # on a tower: the tile repeats seven or eight times up a 194 m facade, so
    # one band here becomes a ladder of stripes. Variety has to come from the
    # windows themselves, which is why the lit ones vary in brightness.

    # A slight blur on the emission map only: lit windows bloom, walls do not.
    return base, emit.filter(ImageFilter.GaussianBlur(0.6))


def scales(pale: tuple[int, int, int], line: tuple[int, int, int], rows: int = 11) -> tuple[Image.Image, Image.Image]:
    """Overlapping fish scales, for the Merlion's body.

    The scales are the thing the statue is recognised by after its head: the
    close reference photograph is almost entirely scale. Drawn as rows of
    offset arcs rather than modelled, because a scale is two triangles of
    silhouette and a hundred of them would be the most expensive thing on the
    map.

    The emission map is a dimmed copy rather than black: the statue is floodlit
    from below, so the whole body glows a little, and the scale outlines read as
    shadow in that glow.
    """
    base = Image.new("RGB", (SIZE, SIZE), pale)
    db = ImageDraw.Draw(base)
    step = SIZE / rows
    r = step * 0.92
    for row in range(rows + 1):
        y = row * step
        offset = (row % 2) * step * 0.5
        for col in range(-1, rows + 2):
            x = col * step + offset
            # Each scale is the lower arc of a circle: draw the outline only,
            # so the rows read as overlapping rather than as a grid of discs.
            db.arc([x - r / 2, y - r / 2, x + r / 2, y + r / 2], start=20, end=160,
                   fill=line, width=max(1, int(step * 0.09)))
    emit = base.point(lambda v: int(v * 0.55))
    return base, emit.filter(ImageFilter.GaussianBlur(0.4))


def strip(colour: tuple[int, int, int], seed: int) -> tuple[Image.Image, Image.Image]:
    """Horizontal LED banding, for podium roofs and the checkpoint canopies."""
    rnd = random.Random(seed)
    base = Image.new("RGB", (SIZE, SIZE), (14, 16, 20))
    emit = Image.new("RGB", (SIZE, SIZE), (0, 0, 0))
    db, de = ImageDraw.Draw(base), ImageDraw.Draw(emit)
    y = 0
    while y < SIZE:
        h = rnd.randint(3, 7)
        c = mix(colour, (255, 255, 255), rnd.uniform(0.0, 0.3))
        db.rectangle([0, y, SIZE, y + h], fill=c)
        de.rectangle([0, y, SIZE, y + h], fill=c)
        y += h + rnd.randint(16, 34)
    return base, emit.filter(ImageFilter.GaussianBlur(1.0))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "-o", "--out", type=pathlib.Path,
        default=pathlib.Path(__file__).parent / "refs" / "tex",
        help="where to write the images (default: scripts/landmarks/refs/tex)",
    )
    ap.add_argument(
        "--analysis",
        type=pathlib.Path,
        default=pathlib.Path(__file__).parent / "refs" / "analysis.json",
    )
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    an = json.loads(args.analysis.read_text())

    # The warm window colours of the Sands, measured. The first emissive cluster
    # is always near-white (an overexposed highlight in any night photograph);
    # the ones after it carry the actual colour of the light.
    warm = [rgb(e["hex"]) for e in an["mbs_night"]["emissive"][1:]]
    warm += [mix(warm[0], (255, 170, 60), 0.35)]  # the sodium end of the range
    # The unlit facade: the photograph's second-largest cluster, the dark side
    # of the towers, darkened a little further because the map is darker again.
    wall = mix(rgb(an["mbs_night"]["palette"][1]["hex"]), (0, 0, 0), 0.35)

    specs = {
        # cols/rows are chosen so one tile covers roughly 8 floors by 10 bays,
        # and the model repeats the tile up its height.
        "facade_sands": facade(wall, warm, 14, 10, 0.45, seed=3),
        "facade_tower": facade(mix(wall, (26, 32, 40), 0.5), warm, 10, 12, 0.38, seed=11),
        "facade_block": facade(mix(wall, (30, 28, 24), 0.6), warm, 8, 5, 0.3, seed=17),
        "led_blue": strip((70, 150, 255), seed=5),
        "led_warm": strip(warm[-1], seed=9),
        # The Merlion's body, from the close reference rather than the Sands:
        # the statue's cement-and-porcelain skin reads cool, not warm.
        "scales": scales(
            rgb(an["merlion_night"]["palette"][3]["hex"]),
            mix(rgb(an["merlion_night"]["palette"][1]["hex"]), (0, 0, 0), 0.45),
        ),
    }

    for name, (base, emit) in specs.items():
        base.save(args.out / f"{name}_base.png", optimize=True)
        emit.save(args.out / f"{name}_emit.png", optimize=True)
        print(f"  {name}")
    print(f"wrote {len(specs) * 2} textures to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
