"""Model the landmarks in Blender and export one glTF binary each.

Run with Blender's Python, either the ``bpy`` module in a virtualenv or a
Blender install:

    pip install -e ".[landmarks]"
    python scripts/landmarks/build_models.py --out dashboard/public/models
    # or
    blender -b -P scripts/landmarks/build_models.py -- --out dashboard/public/models

Why Blender, and why procedurally
---------------------------------
The map needs the Merlion, the Sands and the Supertrees to be recognisable at
a 42-degree pitch from four hundred metres up, in a dark scene, on a machine
that is also running a WebGL hex layer. That rules out photogrammetry (nothing
in the study's licensing allows it), and it rules out hand-sculpting (nobody
can review a .blend in a pull request).

So every model here is built from numbers: the dimensions in ``landmarks.json``,
the colours measured off reference photographs in ``refs/analysis.json``, and
the real footprint bearings in ``refs/footprints.json``. The script is the
model. Change the Sands' height in the JSON and the tower changes.

Conventions
-----------
* One Blender unit is one metre, Z up. The glTF exporter converts to the Y-up
  that glTF requires; deck.gl then reads metres directly.
* A model is built with its long axis along +X and its base on z = 0. The
  dashboard rotates it by the bearing when it places it, so none of the
  builders below know anything about north.
* Triangle budget: a few thousand per landmark. The map draws all twelve at
  once over a hex layer, and a pretty model that drops the frame rate on a wall
  display is the wrong trade.
"""

from __future__ import annotations

import argparse
import json
import math
import pathlib
import sys

import bpy  # noqa: I001 - bpy must be imported before its submodules resolve
import bmesh
from mathutils import Vector

TAU = math.tau

# --------------------------------------------------------------------------
# scene plumbing
# --------------------------------------------------------------------------


def reset_scene() -> None:
    """Empty .blend, then strip the datablocks the factory file leaves behind.

    ``read_factory_settings(use_empty=True)`` clears the objects but keeps
    orphaned meshes and materials from the previous landmark, and the glTF
    exporter will happily write those into the next file.
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.objects):
        for item in list(coll):
            coll.remove(item)


def add_mesh(name: str, verts: list, faces: list, mat: bpy.types.Material | None = None):
    """Create an object from explicit vertices and faces.

    Built this way rather than with ``bpy.ops.mesh.primitive_*`` because the ops
    depend on the interface context (an active object, an edit mode), which
    makes them awkward to call in a loop from a background process — and
    because the vertices are the interesting part of each model.
    """
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    mesh.validate()
    mesh.polygons.foreach_set("use_smooth", [False] * len(mesh.polygons))
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    if mat:
        mesh.materials.append(mat)
    return obj


def ring(cx: float, cy: float, rx: float, ry: float, n: int, rot: float = 0.0) -> list:
    """n points on an ellipse. The unit of every rounded thing here."""
    return [
        (
            cx + rx * math.cos(TAU * i / n) * math.cos(rot) - ry * math.sin(TAU * i / n) * math.sin(rot),
            cy + rx * math.cos(TAU * i / n) * math.sin(rot) + ry * math.sin(TAU * i / n) * math.cos(rot),
        )
        for i in range(n)
    ]


def rect(w: float, d: float, cx: float = 0.0, cy: float = 0.0, chamfer: float = 0.0) -> list:
    """Plan rectangle, optionally with its corners cut off.

    A chamfer is cheap (four extra vertices) and stops every building reading as
    a shoebox under the map's low sun.
    """
    hw, hd = w / 2, d / 2
    if chamfer <= 0:
        return [(cx - hw, cy - hd), (cx + hw, cy - hd), (cx + hw, cy + hd), (cx - hw, cy + hd)]
    c = min(chamfer, hw * 0.8, hd * 0.8)
    return [
        (cx - hw + c, cy - hd), (cx + hw - c, cy - hd), (cx + hw, cy - hd + c),
        (cx + hw, cy + hd - c), (cx + hw - c, cy + hd), (cx - hw + c, cy + hd),
        (cx - hw, cy + hd - c), (cx - hw, cy - hd + c),
    ]


def solid(name: str, sections: list[tuple[float, list]], mat=None, cap_bottom=True, cap_top=True):
    """Loft a solid through plan sections given as (z, polygon).

    Every section must have the same number of points, in the same order: the
    loft joins point i of one section to point i of the next. That one rule
    covers almost every shape in this file — a box is two identical rectangles,
    a tapered tower is two different ones, a leaning leg is two offset ones, a
    dome is a stack of shrinking circles.
    """
    verts: list = []
    faces: list = []
    n = len(sections[0][1])
    for z, poly in sections:
        assert len(poly) == n, f"{name}: section at z={z} has {len(poly)} points, expected {n}"
        verts.extend((x, y, z) for x, y in poly)
    for s in range(len(sections) - 1):
        a, b = s * n, (s + 1) * n
        for i in range(n):
            j = (i + 1) % n
            faces.append([a + i, a + j, b + j, b + i])
    if cap_bottom:
        faces.append(list(range(n))[::-1])
    if cap_top:
        off = (len(sections) - 1) * n
        faces.append([off + i for i in range(n)])
    return add_mesh(name, verts, faces, mat)


def prism(name: str, w: float, d: float, h: float, z0: float = 0.0, at=(0.0, 0.0),
          taper: float = 1.0, chamfer: float = 0.0, mat=None, shift=(0.0, 0.0)):
    """A box, optionally tapered towards the top and leaning as it rises."""
    return solid(
        name,
        [
            (z0, rect(w, d, at[0], at[1], chamfer)),
            (z0 + h, rect(w * taper, d * taper, at[0] + shift[0], at[1] + shift[1], chamfer * taper)),
        ],
        mat,
    )


def tube(name: str, r0: float, r1: float, h: float, z0: float = 0.0, at=(0.0, 0.0),
         n: int = 12, mat=None, shift=(0.0, 0.0)):
    """A cylinder or cone, leaning if ``shift`` is given."""
    return solid(
        name,
        [(z0, ring(at[0], at[1], r0, r0, n)), (z0 + h, ring(at[0] + shift[0], at[1] + shift[1], r1, r1, n))],
        mat,
    )


def plate(name: str, origin, direction, length: float, width: float, thick: float,
          mat=None, taper: float = 0.6):
    """A flat plate starting at a point and pointing in a direction.

    Everything built with ``solid`` rises along z, which is right for buildings
    and wrong for anything that sticks out sideways. The Merlion's mane is a
    collar of plates sweeping down and outwards from the neck; built as lofts
    they came out as a crown of vertical fins, which is not the same animal.
    """
    d = Vector(direction).normalized()
    # A stable pair of axes across the plate: "across" is horizontal wherever
    # the plate is not pointing straight up.
    ref = Vector((0, 0, 1)) if abs(d.z) < 0.95 else Vector((1, 0, 0))
    across = d.cross(ref).normalized()
    up = across.cross(d).normalized()
    o = Vector(origin)
    verts, faces = [], []
    for step, (hw, ht) in enumerate(((width / 2, thick / 2),
                                     (width / 2 * taper, thick / 2 * taper))):
        c = o + d * (length * step)
        for sx, sy in ((1, 1), (1, -1), (-1, -1), (-1, 1)):
            verts.append(tuple(c + across * (hw * sx) + up * (ht * sy)))
    for i in range(4):
        j = (i + 1) % 4
        faces.append([i, j, 4 + j, 4 + i])
    faces.append([3, 2, 1, 0])
    faces.append([4, 5, 6, 7])
    return add_mesh(name, verts, faces, mat)


def dome(name: str, r: float, h: float, z0: float = 0.0, at=(0.0, 0.0), n: int = 16,
         rings: int = 5, mat=None):
    """Half an ellipsoid, as a stack of rings. Used for domes and petal tips."""
    sections = []
    for k in range(rings + 1):
        t = k / rings
        sections.append((z0 + h * math.sin(t * math.pi / 2), ring(at[0], at[1], r * math.cos(t * math.pi / 2) or 1e-3, r * math.cos(t * math.pi / 2) or 1e-3, n)))
    return solid(name, sections, mat, cap_top=False)


def ellipsoid(name: str, rx: float, ry: float, rz: float, at=(0.0, 0.0, 0.0), n: int = 12,
              rings: int = 6, mat=None):
    """A whole ellipsoid, as a stack of rings from pole to pole."""
    sections = []
    for k in range(rings + 1):
        t = -math.pi / 2 + math.pi * k / rings
        rr = max(math.cos(t), 1e-3)
        sections.append((at[2] + rz * math.sin(t), ring(at[0], at[1], rx * rr, ry * rr, n)))
    return solid(name, sections, mat, cap_bottom=False, cap_top=False)


def edge_lights(name: str, w: float, d: float, z: float, thick: float, mat, height: float = 1.2):
    """A lit strip around the rim of a roof, not a lit roof.

    The distinction matters: the Sands podium and the Komtar mall both wear a
    line of LEDs along their edge, and filling the whole roof with the same
    material turns a 90 m building into a glowing plate that outshines the
    towers above it.
    """
    bars = []
    for i, (bw, bd, cx, cy) in enumerate((
        (w, thick, 0.0, (d - thick) / 2),
        (w, thick, 0.0, -(d - thick) / 2),
        (thick, d - 2 * thick, (w - thick) / 2, 0.0),
        (thick, d - 2 * thick, -(w - thick) / 2, 0.0),
    )):
        bars.append(prism(f"{name}-{i}", bw, bd, height, z0=z, at=(cx, cy), mat=mat))
    return merge(bars, name, mat)


def spiky_dome(name: str, r: float, h: float, z0: float, at, mat, subdiv: int = 3,
               spike: float = 0.06):
    """A faceted dome whose every facet is pushed out into a shallow spike.

    This is the Esplanade. Its shells are clad in more than seven thousand
    triangular sunshades, and the spikes are the entire reason anyone calls it
    the durian; a smooth dome reads as a planetarium instead. bmesh does the
    work: subdivide an icosphere, inset each face, push the inset out along the
    face normal.
    """
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    # Keep the top half only, then flatten it to the requested height.
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -1e-6], context="VERTS")
    for v in bm.verts:
        v.co.z *= h / r
    # Inset first, then push the inset face out along its normal: a wide inset
    # and a short push give facets, a narrow inset and a long push give spikes.
    # The sunshades are shallow pyramids, so this sits nearer the first.
    bmesh.ops.inset_individual(bm, faces=bm.faces[:], thickness=r * 0.035, depth=0.0)
    for f in bm.faces:
        if f.calc_center_median().z > 0.04 * h:
            n = f.normal.copy()
            for v in f.verts:
                v.co += n * (r * spike)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = (at[0], at[1], z0)
    if mat:
        mesh.materials.append(mat)
    return obj


def torus(name: str, radius: float, thickness: float, major: int = 48, minor: int = 6,
          at=(0.0, 0.0, 0.0), mat=None, plane: str = "XZ"):
    """A ring standing in a vertical plane — the Flyer's rim."""
    verts, faces = [], []
    for i in range(major):
        a = TAU * i / major
        cx, cy = radius * math.cos(a), radius * math.sin(a)
        for j in range(minor):
            b = TAU * j / minor
            rr = thickness * math.cos(b)
            dz = thickness * math.sin(b)
            if plane == "XZ":
                verts.append((at[0] + cx + rr * math.cos(a), at[1] + dz, at[2] + cy + rr * math.sin(a)))
            else:
                verts.append((at[0] + cx + rr * math.cos(a), at[1] + cy + rr * math.sin(a), at[2] + dz))
    for i in range(major):
        for j in range(minor):
            a0 = i * minor + j
            a1 = i * minor + (j + 1) % minor
            b0 = ((i + 1) % major) * minor + j
            b1 = ((i + 1) % major) * minor + (j + 1) % minor
            faces.append([a0, a1, b1, b0])
    return add_mesh(name, verts, faces, mat)


def arc_tube(name: str, pts: list[tuple[float, float, float]], r: float, n: int = 6, mat=None,
             radii: list[float] | None = None):
    """A tube swept along a polyline — walkways, the Skyway, the water jet.

    ``radii`` gives a radius per point instead of one for the whole sweep, which
    is what turns a tube into a tail: thick where it leaves the body, thin at
    the tip.
    """
    verts, faces = [], []
    for k, p in enumerate(pts):
        rk = radii[k] if radii else r
        nxt = pts[min(k + 1, len(pts) - 1)]
        prv = pts[max(k - 1, 0)]
        d = Vector(nxt) - Vector(prv)
        if d.length < 1e-9:
            d = Vector((1, 0, 0))
        d.normalize()
        up = Vector((0, 0, 1)) if abs(d.z) < 0.95 else Vector((1, 0, 0))
        u = d.cross(up).normalized()
        v = d.cross(u).normalized()
        for i in range(n):
            a = TAU * i / n
            verts.append(tuple(Vector(p) + u * (rk * math.cos(a)) + v * (rk * math.sin(a))))
    for k in range(len(pts) - 1):
        for i in range(n):
            j = (i + 1) % n
            faces.append([k * n + i, k * n + j, (k + 1) * n + j, (k + 1) * n + i])
    return add_mesh(name, verts, faces, mat)


# --------------------------------------------------------------------------
# materials
# --------------------------------------------------------------------------


def _principled(mat):
    return mat.node_tree.nodes["Principled BSDF"]


def material(name: str, base: tuple, rough: float = 0.6, metallic: float = 0.0,
             emit: tuple | None = None, strength: float = 0.0, alpha: float = 1.0):
    """A plain Principled material.

    Emission matters more here than anywhere else: the dashboard's basemap is
    almost black, so a landmark lit only by the scene's sun disappears into it.
    The emission colours come from the photographs (see ``textures.py``), and
    the strengths are tuned so the Sands' windows read as the brightest thing
    on the map and the concrete does not.
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    p = _principled(mat)
    p.inputs["Base Color"].default_value = (*base, 1.0)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metallic
    if emit:
        p.inputs["Emission Color"].default_value = (*emit, 1.0)
        p.inputs["Emission Strength"].default_value = strength
    if alpha < 1.0:
        p.inputs["Alpha"].default_value = alpha
        mat.blend_method = "BLEND"
    return mat


def textured(name: str, tex_dir: pathlib.Path, key: str, tile_m: float = 24.0):
    """A material driven by one of the generated facade textures.

    The base-colour and emission maps are the same image pair written by
    ``textures.py``: lit windows appear in both, the wall only in the first.
    ``tile_m`` is how many metres one tile covers, which is what turns a 512px
    image into "about ten bays by eight floors".
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    p = _principled(mat)
    p.inputs["Roughness"].default_value = 0.45

    for slot, suffix, target in (("base", "_base", "Base Color"), ("emit", "_emit", "Emission Color")):
        path = tex_dir / f"{key}{suffix}.png"
        img = bpy.data.images.load(str(path), check_existing=True)
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        tex.interpolation = "Closest"  # keep the window grid crisp, not mushy
        tex.extension = "REPEAT"
        tex.label = f"{key}{suffix}"
        nt.links.new(tex.outputs["Color"], p.inputs[target])
        tex.location = (-520, 200 if slot == "base" else -160)

        mapping = nt.nodes.new("ShaderNodeMapping")
        mapping.inputs["Scale"].default_value = (1.0, 1.0, 1.0)
        coord = nt.nodes.new("ShaderNodeTexCoord")
        nt.links.new(coord.outputs["UV"], mapping.inputs["Vector"])
        nt.links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
        mapping.location = (-720, 200 if slot == "base" else -160)
        coord.location = (-900, 200 if slot == "base" else -160)

    p.inputs["Emission Strength"].default_value = 1.6
    mat["tile_m"] = tile_m
    return mat


def project_uvs(obj, tile_m: float = 24.0) -> None:
    """Box-project UVs from the object's own coordinates.

    Every wall in this file is axis-aligned in its own object space, so the
    projection is just "drop the axis the face points along". Doing it by hand
    avoids ``bpy.ops.uv.cube_project``, which needs edit mode and an active
    object; and it guarantees the texture is scaled in metres, so a 194 m tower
    and a 40 m shed show windows the same size.
    """
    mesh = obj.data
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    uv = mesh.uv_layers[0]
    for poly in mesh.polygons:
        n = poly.normal
        axis = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            co = mesh.vertices[mesh.loops[li].vertex_index].co
            if axis == 2:  # a floor or a roof: project straight down
                u, v = co.x, co.y
            elif axis == 0:  # a wall facing along x: height against depth
                u, v = co.y, co.z
            else:  # a wall facing along y: height against width
                u, v = co.x, co.z
            uv.data[li].uv = (u / tile_m, v / tile_m)


def palette(analysis: dict) -> dict:
    """The colours every builder shares, read out of the photograph analysis."""

    def srgb(hexstr: str, scale: float = 1.0) -> tuple:
        h = hexstr.lstrip("#")
        return tuple(min(1.0, (int(h[i : i + 2], 16) / 255.0) * scale) for i in (0, 2, 4))

    def hue_pick(clusters: list[dict], lo: float, hi: float, scale: float = 1.0) -> tuple:
        """The most saturated cluster whose hue falls in a window.

        Picking a cluster by index is brittle — the Supertrees' uplighting is
        the fourth cluster in one frame and the eighth in another — and picking
        the most saturated cluster outright returns the night sky, which in a
        blue-hour photograph is both saturated and most of the frame. Naming
        the hue says what is being looked for: "the magenta in this picture",
        which is a claim about the lighting rather than about the picture.
        """
        def hsv(hexstr: str) -> tuple[float, float, float]:
            r, g, b = srgb(hexstr)
            hi_, lo_ = max(r, g, b), min(r, g, b)
            d = hi_ - lo_
            if d == 0:
                h = 0.0
            elif hi_ == r:
                h = (60 * ((g - b) / d)) % 360
            elif hi_ == g:
                h = 60 * ((b - r) / d) + 120
            else:
                h = 60 * ((r - g) / d) + 240
            return h, (0.0 if hi_ == 0 else d / hi_), hi_

        def inside(h: float) -> bool:
            return lo <= h <= hi if lo <= hi else (h >= lo or h <= hi)

        window = [c for c in clusters if inside(hsv(c["hex"])[0])]
        if not window:
            return srgb("#b05ec0", scale)  # stated fallback, not a silent one
        best = max(window, key=lambda c: hsv(c["hex"])[1] * (0.3 + c["share"]))
        return srgb(best["hex"], scale)

    def warmth(hexstr: str) -> float:
        r, g, b = srgb(hexstr)
        return r - b

    def warmest(clusters: list[dict], scale: float = 1.0) -> tuple:
        """The most orange of a set of clusters — a sodium or tungsten light."""
        return srgb(max(clusters, key=lambda c: warmth(c["hex"]))["hex"], scale)

    def coolest(clusters: list[dict], scale: float = 1.0) -> tuple:
        """The most blue of a set — a fluorescent tube or an LED strip."""
        return srgb(min(clusters, key=lambda c: warmth(c["hex"]))["hex"], scale)

    mbs = analysis["mbs_night"]
    trees = analysis.get("supertrees_dusk", analysis["supertrees_night"])
    jb = analysis.get("jb_causeway_dusk")
    return {
        # The warm window light, straight off the photograph.
        "warm": srgb(mbs["emissive"][2]["hex"]),
        # The blue LED strips along the Sands podium roof, from the same frame's
        # palette rather than its highlights (the strips are not blown out).
        "blue": (0.18, 0.46, 0.95),
        # Supertree uplighting: the magenta in the grove photograph, lifted
        # because a photograph of a lit thing is darker than the thing looks.
        "magenta": hue_pick(trees["palette"], 270.0, 340.0, 1.5),
        # Unlit surfaces. Dark, because the basemap behind them is darker still.
        "concrete": srgb(mbs["palette"][1]["hex"], 1.25),
        "steel": (0.32, 0.34, 0.38),
        "glass": (0.05, 0.07, 0.10),
        "foliage": (0.07, 0.16, 0.09),
        "stone": (0.42, 0.40, 0.36),
        "roof": (0.22, 0.14, 0.12),
        # Two lights off the Johor Bahru dusk photograph, where the Causeway
        # reads as one cool white band beside one warm one: the lit duct over
        # the water pipeline, and the sodium of the carriageway and its lamps.
        "duct": coolest(jb["emissive"], 1.15) if jb else (0.52, 0.76, 0.84),
        "street": warmest(jb["emissive"], 1.0) if jb else (0.94, 0.74, 0.41),
    }


def merge(objs: list, name: str, mat=None, uv_tile: float | None = None):
    """Combine several objects into one mesh, honouring their locations.

    Done by hand instead of with ``bpy.ops.object.join`` for the same reason as
    everything else here: the operator needs an active object and a selection,
    which a background script has to fake. It matters because the Flyer's 28
    capsules and the grove's canopy spokes are the same material and the same
    object as far as the map is concerned — one node, one draw call.
    """
    verts: list = []
    faces: list = []
    for obj in objs:
        off = Vector(obj.location)
        base = len(verts)
        verts.extend(tuple(Vector(v.co) + off) for v in obj.data.vertices)
        faces.extend([[base + i for i in p.vertices] for p in obj.data.polygons])
    for obj in objs:
        mesh = obj.data
        bpy.data.objects.remove(obj)
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    merged = add_mesh(name, verts, faces, mat)
    # The merge builds a new mesh, so any UVs the parts carried are gone.
    # Re-projecting here rather than on the parts is both simpler and correct:
    # the parts' coordinates are unchanged by the merge.
    if uv_tile:
        project_uvs(merged, uv_tile)
    return merged


# --------------------------------------------------------------------------
# the landmarks
# --------------------------------------------------------------------------


def build_marina_bay_sands(spec, pal, tex):
    """Three leaning slabs under a 340 m deck.

    The form is the one thing everybody knows: each tower splits into two legs
    that splay apart at the base, and the SkyPark lands across all three and
    keeps going 67 m past the far one. The leg splay and that overhang are the
    silhouette; the window texture does the rest.
    """
    h = spec["height_m"]
    deck_len = spec["skypark_length_m"]
    over = spec["cantilever_m"]
    tw, td = 65.0, 23.0          # one tower: wide face across, slab depth
    joint = h * 0.36             # where the two legs become one slab

    facade = textured("sands-facade", tex, "facade_sands", tile_m=26.0)
    concrete = material("sands-concrete", (0.30, 0.26, 0.20), rough=0.75,
                        emit=pal["warm"], strength=0.55)
    # The SkyPark reads pale in every photograph of it — the soffit is lit from
    # the deck above and from the towers below. The first version had it dark,
    # which made the most recognisable roof in the city disappear.
    deck_mat = material("sands-deck", (0.42, 0.43, 0.43), rough=0.5, metallic=0.2,
                        emit=pal["warm"], strength=0.14)
    pool = material("sands-pool", (0.05, 0.22, 0.32), rough=0.08, metallic=0.1,
                    emit=(0.25, 0.70, 1.0), strength=0.6)
    led = material("sands-led", pal["blue"], rough=0.3, emit=pal["blue"], strength=1.1)

    # Towers spaced so the deck's north end overhangs the north tower by `over`.
    north_centre = deck_len / 2 - over - tw / 2
    south_centre = -deck_len / 2 + 18.0 + tw / 2
    step = (north_centre - south_centre) / 2
    parts = []
    for i in range(spec["towers"]):
        x = south_centre + step * i
        # Two legs, one leaning out over the bay, one near vertical.
        parts.append(solid(
            f"leg-bay-{i}",
            [(0.0, rect(tw, 10.0, x, 14.0)), (joint, rect(tw, 11.0, x, 4.5))],
            facade,
        ))
        parts.append(solid(
            f"leg-land-{i}",
            [(0.0, rect(tw, 10.0, x, -9.0)), (joint, rect(tw, 11.0, x, -4.5))],
            facade,
        ))
        # The slab above the joint, very slightly tapered.
        parts.append(solid(
            f"tower-{i}",
            [(joint - 6.0, rect(tw, td, x, 0.0, 4.0)), (h, rect(tw * 0.97, td * 0.95, x, 0.0, 4.0))],
            facade,
        ))
    merge(parts, "towers", facade, uv_tile=26.0)

    # The SkyPark: a long lens in plan, pointed at both ends, thickest in the
    # middle. Twelve points is enough for its outline at map range.
    def deck_plan(scale: float) -> list:
        half, w = deck_len / 2 * scale, 19.0 * scale
        pts = []
        for t in [-1.0, -0.86, -0.5, 0.0, 0.5, 0.86, 1.0]:
            pts.append((half * t, w * math.cos(t * math.pi / 2) ** 0.55))
        for t in [1.0, 0.86, 0.5, 0.0, -0.5, -0.86, -1.0]:
            pts.append((half * t, -w * math.cos(t * math.pi / 2) ** 0.55))
        return pts

    solid("skypark", [(h - 2.0, deck_plan(1.0)), (h + 9.0, deck_plan(0.98))], deck_mat)
    # The infinity pool sits on the deck over the middle tower.
    prism("pool", 150.0, 18.0, 1.2, z0=h + 9.0, at=(step * 0.1, -2.0), mat=pool)

    # Podium: the convention centre and mall below, with the blue roof strips
    # the reference photograph shows running along its edge.
    prism("podium", 250.0, 86.0, 19.0, at=(-20.0, 52.0), chamfer=18.0, mat=concrete)
    podium_led = edge_lights("podium-led", 252.0, 88.0, 18.4, 4.0, led, height=1.4)
    podium_led.location = (-20.0, 52.0, 0.0)


def build_artscience_museum(spec, pal, tex):
    """Safdie's lotus: ten petals of very different lengths around a round bowl.

    The skyline reference settles the shape, which the first attempt had wrong
    in the way that matters most. The building is not a burst of ten equal
    spikes: it is a low cupped bowl with one finger reaching 60 m and the rest
    short, broad and nearly flat. Making them equal turns a lotus into a
    sea anemone, which is what it looked like.
    """
    h = spec["height_m"]
    n = spec["petals"]
    skin = material("as-skin", (0.62, 0.63, 0.61), rough=0.35,
                    emit=(1.0, 0.95, 0.85), strength=0.22)
    glass = material("as-glass", pal["glass"], rough=0.1, metallic=0.2,
                     emit=pal["warm"], strength=0.8)
    water = material("as-pond", (0.02, 0.09, 0.14), rough=0.05, metallic=0.3)

    tube("pond", 62.0, 62.0, 1.0, z0=-0.6, n=24, mat=water)
    # The bowl the petals rise out of, and the glazed drum inside it.
    solid("bowl", [
        (0.0, ring(0, 0, 34.0, 34.0, 20)),
        (6.0, ring(0, 0, 38.0, 38.0, 20)),
        (9.0, ring(0, 0, 36.0, 36.0, 20)),
    ], skin)
    tube("core", 20.0, 18.0, 14.0, n=16, mat=glass)

    # Petal lengths, as fractions of the tallest. *One* dominant finger — two
    # of them and the building grows horns — two middling, the rest short.
    # That is the pattern the photograph shows.
    reaches = [1.0, 0.40, 0.27, 0.23, 0.29, 0.44, 0.50, 0.33, 0.25, 0.28]
    petals = []
    for i in range(n):
        a = TAU * i / n + 0.35
        reach = h * reaches[i % len(reaches)]
        # A tall finger is narrow; a short one is broad. That contrast is most
        # of what makes the building read as cupped rather than spiked.
        width = 15.5 - 7.0 * reaches[i % len(reaches)]
        sections = []
        steps = 5
        for k in range(steps + 1):
            t = k / steps
            out = 12.0 + reach * 0.52 * t**1.15
            z = 5.0 + (reach - 5.0) * math.sin(t * math.pi / 2 * 0.96)
            # rx runs across the petal, ry is its thickness: a blade, not a tube.
            rx = width * (1.0 - 0.52 * t)
            ry = 2.2 + 3.0 * (1.0 - t)
            sections.append((z, ring(out * math.cos(a), out * math.sin(a), rx, ry, 8, a)))
        petals.append(solid(f"petal-{i}", sections, skin, cap_bottom=False))
    merge(petals, "petals", skin)


def build_supertree_grove(spec, pal, tex):
    """Twelve steel trees and the walkway slung between two of them.

    The reference photograph settles the proportions: the canopy is a wide,
    nearly flat lattice, not a dome, and the trunk flares out into it like a
    wine glass. A solid cone canopy — the first attempt — turns the grove into
    a field of mushrooms, which is exactly what it looked like.
    """
    tall, short, count = spec["height_m"], spec["min_height_m"], spec["count"]
    trunk_mat = material("st-trunk", (0.09, 0.17, 0.11), rough=0.85,
                         emit=pal["magenta"], strength=0.5)
    canopy = material("st-canopy", (0.18, 0.12, 0.22), rough=0.45, metallic=0.5,
                      emit=pal["magenta"], strength=1.0)
    rim = material("st-rim", (0.5, 0.35, 0.5), rough=0.3,
                   emit=pal["magenta"], strength=2.0)
    walk = material("st-skyway", (0.38, 0.36, 0.31), rough=0.5,
                    emit=(1.0, 0.85, 0.55), strength=0.9)

    # A deterministic scatter: an ellipse of trees, the tall ones in the middle,
    # which is how the grove reads from across the bay.
    placed = []
    trunks, lattice, rims = [], [], []
    for i in range(count):
        a = TAU * i / count + 0.4
        rad = 34.0 + 20.0 * ((i * 7) % 5) / 4.0
        x, y = rad * math.cos(a) * 1.35, rad * math.sin(a) * 0.8
        hgt = short + (tall - short) * (0.35 + 0.65 * ((i * 5) % 4) / 3.0)
        placed.append((x, y, hgt))
        crown = 10.0 + 6.0 * (hgt - short) / max(tall - short, 1e-6)
        flare = hgt * 0.70  # where the trunk stops being a trunk

        # Trunk: narrow at the base, flaring out towards the canopy.
        trunks.append(solid(f"trunk-{i}", [
            (0.0, ring(x, y, 2.6, 2.6, 8)),
            (flare * 0.55, ring(x, y, 2.1, 2.1, 8)),
            (flare, ring(x, y, 4.2, 4.2, 8)),
        ], trunk_mat))

        # Canopy: a thin dish, and the spokes that hold it out. Both are mostly
        # air in reality; here the dish is 1.6 m thick and the spokes are the
        # only other geometry, which is as close as a few hundred triangles get.
        lattice.append(solid(f"canopy-{i}", [
            (hgt - 1.6, ring(x, y, crown * 0.35, crown * 0.35, 12)),
            (hgt - 0.6, ring(x, y, crown, crown, 12)),
            (hgt, ring(x, y, crown * 0.96, crown * 0.96, 12)),
        ], canopy))
        for b in range(8):
            ba = TAU * b / 8 + i * 0.4
            lattice.append(tube(
                f"spoke-{i}-{b}", 0.9, 0.3, hgt - flare + 0.4,
                z0=flare - 0.4, at=(x, y), n=4,
                shift=(crown * 0.9 * math.cos(ba), crown * 0.9 * math.sin(ba)),
                mat=canopy,
            ))
        # The lit rim is what the eye actually catches at a distance.
        rims.append(solid(f"rim-{i}", [
            (hgt - 0.9, ring(x, y, crown * 0.99, crown * 0.99, 12)),
            (hgt - 0.2, ring(x, y, crown * 1.02, crown * 1.02, 12)),
        ], rim, cap_bottom=False, cap_top=False))

    merge(trunks, "trunks", trunk_mat)
    merge(lattice, "canopies", canopy)
    merge(rims, "rims", rim)

    # The OCBC Skyway: a curved walkway between the two tallest trees, at the
    # published 22 m. Drawn as an arc because it is one — it bows out from the
    # straight line between them.
    a, b = sorted(placed, key=lambda p: -p[2])[:2]
    z = spec["skyway_height_m"]
    mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    bow = (mid[0] * 1.9, mid[1] * 1.9)
    pts = []
    for k in range(13):
        t = k / 12
        # Quadratic Bezier through the bowed control point.
        px = (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * bow[0] + t**2 * b[0]
        py = (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * bow[1] + t**2 * b[1]
        pts.append((px, py, z))
    arc_tube("skyway", pts, 2.1, n=5, mat=walk)


def build_singapore_flyer(spec, pal, tex):
    """A 150 m wheel on an A-frame over a round terminal."""
    r = spec["wheel_diameter_m"] / 2
    hub = spec["hub_height_m"]
    rim_mat = material("fl-rim", pal["steel"], rough=0.35, metallic=0.75,
                       emit=(0.65, 0.8, 1.0), strength=0.7)
    cable = material("fl-cable", (0.55, 0.57, 0.6), rough=0.5, metallic=0.4)
    pod = material("fl-capsule", (0.62, 0.68, 0.74), rough=0.15,
                   emit=(1.0, 0.95, 0.8), strength=0.9)
    shell = textured("fl-terminal", tex, "facade_block", tile_m=16.0)

    terminal = solid(
        "terminal",
        [(0.0, ring(0, 0, 62, 46, 16)), (15.0, ring(0, 0, 60, 44, 16)), (19.0, ring(0, 0, 54, 39, 16))],
        shell,
    )
    project_uvs(terminal, 16.0)

    # The A-frame: four legs rising from outside the terminal to the hub.
    legs = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            legs.append(tube(f"leg-{sx}-{sy}", 3.2, 1.6, hub - 4.0, z0=4.0,
                             at=(sx * 46.0, sy * 17.0), n=6,
                             shift=(-sx * 46.0, -sy * 17.0), mat=cable))
    merge(legs, "a-frame", cable)

    torus("rim", r, 2.0, major=40, minor=5, at=(0, 0, hub), mat=rim_mat, plane="XZ")
    torus("rim-inner", r - 7.0, 0.9, major=32, minor=4, at=(0, 0, hub), mat=cable, plane="XZ")
    tube("hub", 5.0, 5.0, 9.0, z0=hub - 4.5, at=(0, -4.5), n=10, mat=cable).rotation_euler = (
        math.pi / 2, 0, 0
    )

    # Spokes, as straight cables from hub to rim.
    spokes = []
    for i in range(16):
        a = TAU * i / 16
        p0 = (0.0, 0.0, hub)
        p1 = (r * math.cos(a), 0.0, hub + r * math.sin(a))
        spokes.append(arc_tube(f"spoke-{i}", [p0, p1], 0.45, n=4, mat=cable))
    merge(spokes, "spokes", cable)

    # Capsules ride outside the rim, which is what makes the Flyer's outline
    # beaded rather than smooth.
    pods = []
    for i in range(spec["capsules"]):
        a = TAU * i / spec["capsules"]
        px, pz = (r + 4.6) * math.cos(a), hub + (r + 4.6) * math.sin(a)
        pods.append(prism(f"pod-{i}", 5.0, 7.0, 4.4, z0=pz - 2.2, at=(px, 0.0), chamfer=1.4, mat=pod))
    merge(pods, "capsules", pod)


def build_esplanade(spec, pal, tex):
    """Two glass shells under seven thousand aluminium spikes.

    The two shells are not the same size and do not sit square to each other,
    which is most of what stops the pair reading as a pair of domes.
    """
    h = spec["height_m"]
    spikes = material("es-shell", (0.46, 0.48, 0.50), rough=0.22, metallic=0.95,
                      emit=(0.80, 0.82, 0.86), strength=0.06)
    base = material("es-base", pal["concrete"], rough=0.7,
                    emit=pal["warm"], strength=0.3)
    led = material("es-led", pal["warm"], rough=0.3, emit=pal["warm"], strength=1.0)
    prism("base", 168.0, 92.0, h * 0.30, chamfer=26.0, mat=base)
    edge_lights("base-led", 170.0, 94.0, h * 0.30, 3.0, led, height=1.0)
    # Coarser facets than the building has, deliberately. Seven thousand
    # sunshades at this range average to a smooth grey dome; a couple of
    # hundred large ones keep the texture that earned it its nickname.
    spiky_dome("shell-0", 41.0, h * 0.86, h * 0.24, (-46.0, -7.0), spikes,
               subdiv=2, spike=0.10)
    spiky_dome("shell-1", 34.0, h * 0.74, h * 0.24, (48.0, 11.0), spikes,
               subdiv=2, spike=0.10)


def build_merlion(spec, pal, tex):
    """The 8.6 m statue: fish below, lion above, water out of the mouth.

    Built against the two close reference photographs, which settle three
    things that were wrong when this was modelled from memory:

    * the body is near vertical and broad — a fish standing on its tail, not a
      fish lying down with a head stuck on the front;
    * the mane is a *collar* of flat plates sweeping down and out from the neck,
      not a crown of spikes rising from the skull;
    * the body is scaled, and the scales are a texture. They are most of what
      the statue looks like, and a hundred modelled scales would cost more
      triangles than every other landmark on this map put together.

    Written in the statue's own metres and scaled by its published height, so
    the proportions survive a correction to that figure.
    """
    h = spec["height_m"]
    S = h / 8.6  # the model below is drawn at the statue's real size

    body_mat = textured("me-body", tex, "scales", tile_m=0.65 * S)
    body_mat.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.8
    plain = material("me-plain", (0.86, 0.88, 0.86), rough=0.3,
                     emit=(0.90, 0.94, 0.95), strength=0.6)
    stone = material("me-plinth", (0.24, 0.32, 0.40), rough=0.7,
                     emit=(0.22, 0.62, 0.95), strength=0.8)
    dark = material("me-mouth", (0.04, 0.05, 0.06), rough=0.9)
    jet = material("me-jet", (0.80, 0.93, 1.0), rough=0.05,
                   emit=(0.62, 0.90, 1.0), strength=1.3, alpha=0.6)

    # The plinth: the statue stands in the water on a wave, uplit blue, which
    # in every photograph is the second brightest thing in frame.
    solid("plinth", [
        (0.0, ring(0, 0, 5.4 * S, 4.6 * S, 14)),
        (1.0 * S, ring(0, 0, 4.8 * S, 4.1 * S, 14)),
        (1.8 * S, ring(0.2 * S, 0, 3.6 * S, 3.1 * S, 14)),
    ], stone)

    # The body: broad at the plinth, narrowing to the neck, leaning back a
    # little. (forward offset, height, half-width across, half-depth)
    spine = [
        (-0.70, 1.60, 1.95, 1.70),
        (-0.45, 2.50, 2.05, 1.80),
        (-0.15, 3.60, 1.95, 1.75),
        (0.15, 4.70, 1.70, 1.55),
        (0.40, 5.70, 1.35, 1.30),
        (0.55, 6.40, 1.10, 1.10),
    ]
    body = solid("body", [
        (z * S, ring(fx * S, 0.0, rx * S, ry * S, 14)) for fx, z, rx, ry in spine
    ], body_mat)
    project_uvs(body, 0.65 * S)

    # The tail: a tapering sweep that leaves the body low at the back, curls up
    # behind it, and ends in a fluke turned across. Half the silhouette.
    curl = [
        (-1.6, 2.1, 1.05), (-2.5, 2.8, 0.95), (-3.2, 3.9, 0.80),
        (-3.5, 5.1, 0.62), (-3.4, 6.1, 0.46), (-3.1, 6.8, 0.34),
    ]
    tail = arc_tube(
        "tail",
        [(x * S, 0.0, z * S) for x, z, _ in curl],
        0.0, n=8, mat=body_mat,
        radii=[r * S for _, _, r in curl],
    )
    project_uvs(tail, 0.65 * S)
    # The fluke, a flat fan across the tip of that curl.
    for sy in (-1, 1):
        plate(f"fluke-{sy}", (-3.1 * S, 0.0, 6.8 * S), (0.35, sy * 0.55, 0.76),
              1.7 * S, 0.45 * S, 0.16 * S, plain, taper=1.5)

    # Pectoral fins, one each side, swept back and down.
    fins = []
    for sy in (-1, 1):
        fins.append(plate(f"fin-{sy}", (-0.1 * S, sy * 1.6 * S, 3.6 * S),
                          (-0.55, sy * 0.7, -0.45), 2.0 * S, 1.1 * S, 0.22 * S,
                          plain, taper=0.45))
    merge(fins, "fins", plain)

    # --- the lion half ----------------------------------------------------
    head_x, head_z = 0.85 * S, 7.45 * S
    ellipsoid("head", 1.45 * S, 1.30 * S, 1.45 * S, at=(head_x, 0.0, head_z), n=12, mat=plain)
    ellipsoid("muzzle", 0.95 * S, 0.85 * S, 0.72 * S,
              at=(head_x + 1.15 * S, 0.0, head_z - 0.40 * S), n=10, mat=plain)
    # The open mouth, set into the front of the muzzle: the one dark thing on a
    # floodlit white statue, and where the jet starts.
    ellipsoid("mouth", 0.34 * S, 0.38 * S, 0.30 * S,
              at=(head_x + 1.85 * S, 0.0, head_z - 0.45 * S), n=8, mat=dark)

    # The mane: two rows of flat plates forming a collar round the neck,
    # sweeping outwards and down. The lion half's whole signature.
    mane = []
    for row, (count, length, drop, wide, rise) in enumerate((
        (13, 2.15, -0.50, 1.00, 0.20),
        (11, 1.60, -0.90, 0.85, -0.45),
    )):
        for i in range(count):
            # A fan over 280 degrees: open at the front, where the face is.
            a = math.radians(40.0 + 280.0 * i / (count - 1))
            dy, dz = math.sin(a), math.cos(a)
            base = (head_x - 0.45 * S, dy * 0.95 * S, head_z + dz * 0.85 * S + rise * S)
            direction = (-0.40, dy * 1.1, dz * 0.85 + drop)
            # taper 0.85, not 0.5: the locks are broad plates that round off,
            # not spikes. Tapering them to points turns the mane into a crown.
            mane.append(plate(f"mane-{row}-{i}", base, direction,
                              length * S, wide * S, 0.22 * S, plain, taper=0.85))
    merge(mane, "mane", plain)

    ears = []
    for sy in (-1, 1):
        ears.append(plate(f"ear-{sy}", (head_x - 0.1 * S, sy * 0.75 * S, head_z + 1.05 * S),
                          (-0.2, sy * 0.45, 0.87), 1.0 * S, 0.6 * S, 0.16 * S, plain, taper=0.3))
    merge(ears, "ears", plain)

    # Forepaws on the plinth, which is where the body's weight visibly lands.
    paws = []
    for sy in (-1, 1):
        paws.append(solid(f"foreleg-{sy}", [
            (1.8 * S, ring(1.95 * S, sy * 1.05 * S, 0.70 * S, 0.60 * S, 8)),
            (3.4 * S, ring(1.50 * S, sy * 1.10 * S, 0.62 * S, 0.58 * S, 8)),
            (5.0 * S, ring(0.95 * S, sy * 1.15 * S, 0.70 * S, 0.65 * S, 8)),
        ], plain))
        paws.append(solid(f"paw-{sy}", [
            (1.75 * S, ring(2.15 * S, sy * 1.05 * S, 0.85 * S, 0.65 * S, 8)),
            (2.35 * S, ring(2.05 * S, sy * 1.05 * S, 0.72 * S, 0.58 * S, 8)),
        ], plain))
    merge(paws, "forepaws", plain)

    # The jet: out of the mouth on a ballistic curve, into the bay, thinning as
    # it goes the way a real jet does.
    mx, mz = head_x + 1.80 * S, head_z - 0.35 * S
    ts = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.25]
    arc_tube(
        "jet",
        [(mx + 8.0 * S * t, 0.0, mz - 7.5 * S * t * t) for t in ts],
        0.0, n=6, mat=jet,
        radii=[(0.32 - 0.12 * t) * S for t in ts],
    )


def build_johor_causeway(spec, pal, tex):
    """The 1,056 m embankment that is the only land crossing in the study area.

    Road, rail and a water pipeline on one bank of fill. Everything the two
    cities' accessibility numbers have to cross is here, which is reason enough
    to draw it even though nobody calls it a landmark.
    """
    length = spec["length_m"]
    width = spec["width_m"]
    fill = material("cw-fill", (0.19, 0.19, 0.20), rough=0.9)
    deck = material("cw-deck", (0.13, 0.14, 0.16), rough=0.8)
    lane = material("cw-lane", (0.22, 0.21, 0.19), rough=0.6,
                    emit=pal["street"], strength=0.45)
    rail = material("cw-rail", (0.30, 0.31, 0.34), rough=0.5, metallic=0.6)
    lamp = material("cw-lamp", (0.9, 0.85, 0.7), rough=0.3,
                    emit=pal["street"], strength=1.8)
    # The pipeline's housing is the brightest thing on the crossing in every
    # photograph of it: a continuous cool white band down one side, which is
    # what makes the Causeway legible from the Singapore shore at night.
    pipe = material("cw-duct", (0.72, 0.80, 0.84), rough=0.4,
                    emit=pal["duct"], strength=1.45)

    # The embankment: wider under water than above it, like any bank of fill.
    solid("embankment", [
        (-7.0, rect(length, width + 26.0)),
        (0.0, rect(length, width + 8.0)),
        (4.5, rect(length, width)),
    ], fill)
    prism("deck", length, width - 3.0, 1.2, z0=4.5, mat=deck)

    # Two carriageways and, between them, the lit centre of the crossing.
    for sy in (-1, 1):
        prism(f"carriageway-{sy}", length, 10.0, 0.5, z0=5.7, at=(0.0, sy * 7.0), mat=lane)
    # The KTM track down one side — the alignment this landmark was placed from.
    prism("track", length, 4.4, 0.7, z0=5.7, at=(0.0, -17.0), mat=rail)
    # The water pipeline along the other, which is the other thing the Causeway
    # carries and the reason it is an embankment rather than a bridge. Drawn as
    # its housing — a low lit box — rather than as a bare tube, because that is
    # what is visible.
    prism("duct", length, 5.2, 2.6, z0=5.9, at=(0.0, 17.2), chamfer=0.8, mat=pipe)

    lamps = []
    count = int(length // 55)
    for i in range(count):
        x = -length / 2 + length * (i + 0.5) / count
        for sy in (-1, 1):
            lamps.append(tube(f"post-{i}-{sy}", 0.4, 0.3, 11.0, z0=5.7,
                              at=(x, sy * 13.0), n=4, mat=rail))
            lamps.append(prism(f"lamp-{i}-{sy}", 1.0, 2.4, 0.5, z0=16.4,
                               at=(x, sy * 12.0), mat=lamp))
    merge(lamps, "lamps", lamp)


def build_fullerton(spec, pal, tex):
    """The old General Post Office: a colonnaded block at the river mouth."""
    h = spec["height_m"]
    stone = material("fu-stone", (0.54, 0.50, 0.43), rough=0.75,
                     emit=(1.0, 0.80, 0.45), strength=0.45)
    glass = textured("fu-glass", tex, "facade_block", tile_m=12.0)
    roof = material("fu-roof", (0.22, 0.21, 0.20), rough=0.85)

    body = prism("block", 96.0, 60.0, h * 0.82, chamfer=5.0, mat=glass)
    project_uvs(body, 12.0)
    prism("cornice", 100.0, 64.0, h * 0.08, z0=h * 0.82, chamfer=6.0, mat=stone)
    prism("attic", 72.0, 44.0, h * 0.14, z0=h * 0.90, chamfer=4.0, mat=roof)

    # The colonnade: Doric columns down both long faces, as the building has.
    # Running it on one face only would make the model depend on getting the
    # yaw exactly right, and the footprint this landmark is oriented from is
    # the whole complex rather than the 1928 block.
    cols = []
    for sy in (-1, 1):
        for i in range(14):
            x = -42.0 + 84.0 * i / 13
            cols.append(tube(f"column-{sy}-{i}", 1.9, 1.7, h * 0.62, z0=h * 0.10,
                             at=(x, sy * 30.5), n=8, mat=stone))
        prism(f"portico-{sy}", 90.0, 4.0, h * 0.09, z0=h * 0.72, at=(0.0, sy * 30.5), mat=stone)
    merge(cols, "colonnade", stone)
    prism("steps", 92.0, 10.0, h * 0.10, at=(0.0, 34.0), chamfer=2.0, mat=stone)


def hip_roof(name: str, w: float, d: float, h: float, z0: float, at=(0.0, 0.0), mat=None):
    """A pitched roof: a rectangle lofted up to a short ridge.

    Both Johor Bahru heritage buildings wear one, and it is the single feature
    that separates them from the anonymous blocks around them on the map.
    """
    return solid(
        name,
        [(z0, rect(w, d, at[0], at[1])), (z0 + h, rect(w * 0.55, d * 0.12, at[0], at[1]))],
        mat,
    )


def build_cbd_tower(spec, pal, tex):
    """One builder for the four towers of the Singapore skyline.

    They are not four bespoke models, and pretending otherwise would be
    dishonest about what is known. What the sources give is a height, a floor
    count, a plan roughly square, and a top: a mast, an octagon, a pyramid or
    a flat slab. At the range this map draws them that is the whole difference
    between them, and the setbacks are what stops four towers of the same
    height reading as four copies of one.

    Three of them are exactly 280 m because that was the height limit in
    Singapore's central area for twenty years. That is not a coincidence worth
    smoothing over.
    """
    h = spec["height_m"]
    w = spec["plan_m"]
    steps = spec["setbacks"]
    facade = textured(f"{spec['id']}-facade", tex, "facade_tower", tile_m=24.0)
    podium = textured(f"{spec['id']}-podium", tex, "facade_block", tile_m=16.0)
    # The crowns are lit, not luminous. At full strength four of them read as
    # white balls floating over the skyline, which is what the first render of
    # Raffles Place looked like.
    crown = material(f"{spec['id']}-crown", (0.46, 0.52, 0.62), rough=0.35, metallic=0.4,
                     emit=(0.60, 0.78, 1.0), strength=0.4)

    base = prism("podium", w * 1.9, w * 1.7, h * 0.07, chamfer=w * 0.18, mat=podium)
    project_uvs(base, 16.0)

    # The shaft, stepping in once per setback. A tower that tapers smoothly
    # reads as a cooling tower; one that steps reads as an office building.
    shaft_top = h * 0.93
    sections = []
    for i in range(steps + 1):
        t = i / steps
        z = h * 0.05 + (shaft_top - h * 0.05) * t
        side = w * (1.0 - 0.22 * t)
        sections.append((z, rect(side, side, 0.0, 0.0, side * 0.12)))
    shaft = solid("shaft", sections, facade)
    project_uvs(shaft, 24.0)

    top = w * 0.78
    kind = spec["crown"]
    if kind == "pyramid":
        solid("crown", [
            (shaft_top, ring(0, 0, top * 0.55, top * 0.55, 8)),
            (h, ring(0, 0, top * 0.08, top * 0.08, 8)),
        ], crown)
    elif kind == "octagon":
        solid("crown", [
            (shaft_top, ring(0, 0, top * 0.52, top * 0.52, 8)),
            (h * 0.985, ring(0, 0, top * 0.44, top * 0.44, 8)),
            (h, ring(0, 0, top * 0.24, top * 0.24, 8)),
        ], crown)
    elif kind == "mast":
        prism("crown", top, top, h * 0.045, z0=shaft_top, chamfer=top * 0.2, mat=crown)
        tube("mast", 1.4, 0.4, h * 0.06, z0=h * 0.975, n=5, mat=crown)
    else:  # flat
        prism("crown", top * 1.06, top * 1.06, h * 0.07, z0=shaft_top,
              chamfer=top * 0.12, mat=crown)


def build_sultan_ibrahim_building(spec, pal, tex):
    """Bukit Timbalan: a colonial range with a Saracenic tower over its middle."""
    h = spec["height_m"]
    wall = material("si-wall", (0.46, 0.42, 0.36), rough=0.8,
                    emit=(1.0, 0.82, 0.5), strength=0.2)
    roof = material("si-roof", pal["roof"], rough=0.85)
    crown = material("si-crown", (0.58, 0.53, 0.43), rough=0.6,
                     emit=(1.0, 0.85, 0.55), strength=0.45)
    glass = textured("si-glass", tex, "facade_block", tile_m=14.0)

    block_h = h * 0.30
    front = prism("range", 100.0, 26.0, block_h, chamfer=3.0, mat=glass)
    project_uvs(front, 14.0)
    hip_roof("range-roof", 102.0, 28.0, 7.0, block_h, mat=roof)
    for sx in (-1, 1):
        wing = prism(f"wing-{sx}", 26.0, 42.0, block_h * 0.92,
                     at=(sx * 37.0, -22.0), chamfer=3.0, mat=glass)
        project_uvs(wing, 14.0)
        hip_roof(f"wing-roof-{sx}", 28.0, 44.0, 6.0, block_h * 0.92, at=(sx * 37.0, -22.0), mat=roof)

    # The tower: three stages, each narrower, then the cupola.
    tower = [
        prism("tower-1", 22.0, 22.0, h * 0.62, chamfer=2.5, mat=wall),
        prism("tower-2", 17.0, 17.0, h * 0.14, z0=h * 0.62, chamfer=2.0, mat=wall),
        prism("tower-3", 13.0, 13.0, h * 0.09, z0=h * 0.76, chamfer=1.5, mat=crown),
    ]
    merge(tower, "tower", wall)
    dome("cupola", 6.5, 9.0, z0=h * 0.85, n=12, rings=4, mat=crown)
    tube("finial", 0.8, 0.1, h * 0.06, z0=h * 0.94, n=5, mat=crown)
    # Corner turrets, the detail that makes the tower read as Saracenic rather
    # than as an office block with a hat.
    turrets = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            turrets.append(tube(f"turret-{sx}-{sy}", 2.0, 1.6, h * 0.70,
                                at=(sx * 11.0, sy * 11.0), n=6, mat=wall))
            turrets.append(dome(f"turret-cap-{sx}-{sy}", 2.0, 3.0, z0=h * 0.70,
                                at=(sx * 11.0, sy * 11.0), n=6, rings=3, mat=crown))
    merge(turrets, "turrets", wall)


def build_sultan_abu_bakar_mosque(spec, pal, tex):
    """The state mosque: a long hall above the strait, four clock minarets."""
    h = spec["height_m"]
    wall = material("sab-wall", (0.62, 0.60, 0.54), rough=0.7,
                    emit=(1.0, 0.88, 0.62), strength=0.3)
    roof = material("sab-roof", (0.34, 0.27, 0.22), rough=0.8,
                    emit=(1.0, 0.72, 0.4), strength=0.18)
    terrace = material("sab-terrace", pal["stone"], rough=0.85)

    prism("terrace", 96.0, 64.0, 5.0, z0=-2.0, chamfer=6.0, mat=terrace)
    prism("hall", 62.0, 34.0, h * 0.42, z0=3.0, chamfer=2.0, mat=wall)
    hip_roof("hall-roof", 64.0, 36.0, h * 0.22, 3.0 + h * 0.42, mat=roof)
    # Arcaded wings either side, lower and longer.
    for sx in (-1, 1):
        prism(f"arcade-{sx}", 20.0, 30.0, h * 0.30, z0=3.0, at=(sx * 40.0, 0.0), chamfer=2.0, mat=wall)
        hip_roof(f"arcade-roof-{sx}", 22.0, 32.0, h * 0.14, 3.0 + h * 0.30, at=(sx * 40.0, 0.0), mat=roof)

    mins = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            at = (sx * 33.0, sy * 20.0)
            mins.append(prism(f"min-{sx}-{sy}", 5.4, 5.4, h * 0.88, z0=3.0, at=at,
                              chamfer=1.0, taper=0.9, mat=wall))
            # A gallery ring below the cap: the detail that reads as a minaret
            # rather than as a pillar, even at a few pixels across.
            mins.append(prism(f"min-ring-{sx}-{sy}", 7.2, 7.2, h * 0.05,
                              z0=3.0 + h * 0.82, at=at, chamfer=1.4, mat=roof))
            mins.append(prism(f"min-cap-{sx}-{sy}", 5.0, 5.0, h * 0.14,
                              z0=3.0 + h * 0.88, at=at, chamfer=1.2, taper=0.25, mat=roof))
    merge(mins, "minarets", wall)


def build_komtar_jbcc(spec, pal, tex):
    """Podium and tower at the head of Jalan Wong Ah Fook."""
    h = spec["height_m"]
    facade = textured("km-facade", tex, "facade_tower", tile_m=22.0)
    podium = textured("km-podium", tex, "facade_block", tile_m=18.0)
    led = material("km-led", pal["blue"], rough=0.3, emit=pal["blue"], strength=0.9)

    p = prism("podium", 92.0, 74.0, 28.0, chamfer=9.0, mat=podium)
    project_uvs(p, 18.0)
    edge_lights("podium-led", 94.0, 76.0, 27.4, 3.5, led, height=1.3)
    t = prism("tower", 36.0, 36.0, h - 28.0, z0=28.0, chamfer=5.0, taper=0.92, mat=facade)
    project_uvs(t, 22.0)
    prism("crown", 30.0, 30.0, 6.0, z0=h, chamfer=4.0, taper=0.7, mat=led)


def build_astaka_towers(spec, pal, tex):
    """The twin towers at Bukit Senyum — the tallest things in Johor."""
    facade = textured("as-facade", tex, "facade_tower", tile_m=24.0)
    podium = textured("as-podium", tex, "facade_block", tile_m=18.0)
    crown = material("as-crown", (0.8, 0.85, 1.0), rough=0.3,
                     emit=(0.55, 0.75, 1.0), strength=1.4)

    p = prism("podium", 110.0, 70.0, 24.0, chamfer=12.0, mat=podium)
    project_uvs(p, 18.0)
    for i, (x, hgt) in enumerate(((-34.0, spec["height_m"]), (34.0, spec["second_height_m"]))):
        t = solid(
            f"tower-{i}",
            [
                (18.0, rect(38.0, 38.0, x, 0.0, 6.0)),
                (hgt * 0.55, rect(34.0, 34.0, x, 0.0, 6.0)),
                (hgt, rect(26.0, 26.0, x, 0.0, 5.0)),
            ],
            facade,
        )
        project_uvs(t, 24.0)
        tube(f"mast-{i}", 1.2, 0.3, hgt * 0.09, z0=hgt, at=(x, 0.0), n=5, mat=crown)


def _checkpoint(spec, pal, tex, canopy_w: float, canopy_d: float, lanes: int, name: str):
    """A customs hall: a wide flat canopy on columns, with blocks beside it.

    Both ends of the Causeway look like this from the air, and the canopy is the
    recognisable part — a long lit roof with the lanes glowing underneath.
    """
    h = spec["height_m"]
    roof = material(f"{name}-roof", (0.15, 0.16, 0.18), rough=0.5, metallic=0.35,
                    emit=(1.0, 0.86, 0.6), strength=0.07)
    rim = material(f"{name}-rim", (0.9, 0.78, 0.55), rough=0.3,
                   emit=(1.0, 0.86, 0.6), strength=1.2)
    lanes_mat = material(f"{name}-lanes", (0.16, 0.14, 0.11), rough=0.85,
                         emit=(1.0, 0.8, 0.45), strength=0.55)
    block = textured(f"{name}-block", tex, "facade_block", tile_m=16.0)
    col = material(f"{name}-col", pal["concrete"], rough=0.8)

    deck_z = h * 0.55
    # The lit apron under the canopy: what a checkpoint actually looks like
    # from the air at night is a rectangle of light with a dark lid over it.
    prism("apron", canopy_w * 0.96, canopy_d * 0.9, 0.4, z0=0.2, chamfer=8.0, mat=lanes_mat)
    prism("canopy", canopy_w, canopy_d, 3.2, z0=deck_z, chamfer=10.0, mat=roof)
    edge_lights("canopy-rim", canopy_w, canopy_d, deck_z - 0.6, 2.4, rim, height=1.0)
    cols = []
    for i in range(lanes):
        x = -canopy_w / 2 + canopy_w * (i + 0.5) / lanes
        for sy in (-1, 1):
            cols.append(tube(f"col-{i}-{sy}", 1.5, 1.2, deck_z, at=(x, sy * canopy_d * 0.33), n=6, mat=col))
    merge(cols, "columns", col)
    b = prism("hall", canopy_w * 0.44, canopy_d * 0.5, h, at=(-canopy_w * 0.22, canopy_d * 0.62),
              chamfer=6.0, mat=block)
    project_uvs(b, 16.0)


def build_sultan_iskandar_ciq(spec, pal, tex):
    _checkpoint(spec, pal, tex, 190.0, 110.0, 7, "ciq")


def build_woodlands_checkpoint(spec, pal, tex):
    _checkpoint(spec, pal, tex, 160.0, 130.0, 6, "wdl")


BUILDERS = {
    "marina-bay-sands": build_marina_bay_sands,
    "artscience-museum": build_artscience_museum,
    "supertree-grove": build_supertree_grove,
    "singapore-flyer": build_singapore_flyer,
    "esplanade": build_esplanade,
    "merlion": build_merlion,
    "sultan-ibrahim-building": build_sultan_ibrahim_building,
    "sultan-abu-bakar-mosque": build_sultan_abu_bakar_mosque,
    "komtar-jbcc": build_komtar_jbcc,
    "astaka-towers": build_astaka_towers,
    "sultan-iskandar-ciq": build_sultan_iskandar_ciq,
    "woodlands-checkpoint": build_woodlands_checkpoint,
    "johor-causeway": build_johor_causeway,
    "fullerton": build_fullerton,
    # The four tallest towers of the central area, all one builder.
    "guoco-tower": build_cbd_tower,
    "one-raffles-place": build_cbd_tower,
    "republic-plaza": build_cbd_tower,
    "uob-plaza": build_cbd_tower,
}


# --------------------------------------------------------------------------
# export
# --------------------------------------------------------------------------


def triangle_count() -> int:
    total = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
    return total


def export_glb(path: pathlib.Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_apply=True,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
        # Draco would halve these files, but it needs the compression library
        # present in the browser too, and deck.gl's loader only has it behind an
        # extra dependency. The models are small enough without it.
        export_draco_mesh_compression_enable=False,
    )


def scene_extent() -> float:
    """The model's largest dimension in metres.

    Written into the manifest because the dashboard needs it to decide whether
    a landmark is too small to see. Height alone is the wrong measure: the
    Causeway is 17 m tall and 1,056 m long, and a rule that reads only its
    height decides it needs enlarging three-fold.
    """
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            pnt = obj.matrix_world @ Vector(corner)
            lo = Vector((min(lo[i], pnt[i]) for i in range(3)))
            hi = Vector((max(hi[i], pnt[i]) for i in range(3)))
    return max(hi[i] - lo[i] for i in range(3))


def scene_bounds() -> tuple[Vector, float]:
    """Centre and radius of everything built, for framing the preview camera."""
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            p = obj.matrix_world @ Vector(corner)
            lo = Vector((min(lo[i], p[i]) for i in range(3)))
            hi = Vector((max(hi[i], p[i]) for i in range(3)))
    return (lo + hi) / 2, max((hi - lo).length / 2, 1.0)


def render_preview(path: pathlib.Path, size: float) -> None:
    """A single Cycles still of the landmark, for the docs and for review.

    Rendered at the angle the dashboard shows: a low sun, a 42-degree pitch,
    and nothing else in frame. It is the only way to check a procedural model
    without opening Blender.
    """
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 640, 440
    scene.render.film_transparent = True
    scene.render.filepath = str(path)

    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    # A night sky, not a studio: the point of the preview is to show what the
    # model looks like on the dashboard, where almost all the light the viewer
    # sees comes out of the building rather than off it.
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.012, 0.022, 0.045, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scene.world = world

    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", type="SUN"))
    sun.data.energy = 0.45
    sun.data.angle = 0.2
    sun.rotation_euler = (math.radians(58), 0.0, math.radians(135))
    bpy.context.collection.objects.link(sun)

    centre, radius = scene_bounds()
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 55
    # Blender's default far clip is 100 m, which is fine for a teapot and not
    # for a kilometre of causeway seen from thirteen hundred metres away. The
    # first render of it came back empty, not wrong.
    cam_data.clip_start = 0.5
    cam_data.clip_end = max(10_000.0, radius * 20)
    cam = bpy.data.objects.new("cam", cam_data)
    # Frame whatever was built, not whatever the landmark's height says: the
    # Sands' deck is 340 m long and its height is 194 m.
    d = radius * 2.9
    cam.location = (centre.x + d * 0.62, centre.y - d * 0.78, centre.z + d * 0.42)
    direction = centre - Vector(cam.location)
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(cam)
    scene.camera = cam

    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.render.render(write_still=True)


def resolve_placement(spec: dict, foot: dict, extent_m: float) -> dict:
    """Where the model goes, and which number decided it.

    Position comes from the footprint when one contains the anchor — the OSM
    outline is better centred than any published point-of-interest coordinate —
    and from the published anchor otherwise. Bearing follows the rule in
    footprints.py: a footprint only sets the yaw if it is both the right
    building and long enough for "long axis" to mean something.
    """
    if foot.get("matched") and foot.get("match") == "contains-anchor":
        lon, lat = foot["centroid"]
        pos_from = "footprint centroid"
    else:
        lon, lat = spec["lon"], spec["lat"]
        pos_from = "published anchor"

    if foot.get("bearing_trusted"):
        bearing, bear_from = foot["bearing_deg"], "footprint long axis"
    else:
        bearing = spec.get("bearing_deg", 0.0)
        bear_from = spec.get("bearing_note", "not oriented")

    return {
        "id": spec["id"],
        "name": spec["name"],
        "city": spec["city"],
        "lon": round(lon, 6),
        "lat": round(lat, 6),
        "bearing": round(float(bearing), 1),
        "height_m": spec["height_m"],
        # The model's own largest dimension, measured rather than declared.
        "extent_m": round(extent_m, 1),
        "model": f"{spec['id']}.glb",
        "facts": spec["facts"],
        "confidence": spec["confidence"],
        "position_from": pos_from,
        "bearing_from": bear_from,
    }


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=pathlib.Path, default=pathlib.Path("dashboard/public/models"))
    ap.add_argument("--textures", type=pathlib.Path, default=None,
                    help="where textures.py wrote its images "
                         "(default: scripts/landmarks/refs/tex)")
    ap.add_argument("--manifest", type=pathlib.Path,
                    default=pathlib.Path("dashboard/src/map/landmarks.json"))
    ap.add_argument("--preview", type=pathlib.Path, default=None,
                    help="also render a still of each landmark into this directory")
    ap.add_argument("--only", nargs="*", default=None, help="build just these ids")
    args = ap.parse_args(argv)

    here = pathlib.Path(__file__).parent
    specs = json.loads((here / "landmarks.json").read_text())["landmarks"]
    analysis = json.loads((here / "refs" / "analysis.json").read_text())
    feet = json.loads((here / "refs" / "footprints.json").read_text())
    pal = palette(analysis)
    tex = args.textures or (here / "refs" / "tex")
    if not tex.is_dir():
        sys.exit(f"no textures in {tex} — run scripts/landmarks/textures.py first")

    placements = []
    for spec in specs:
        if args.only and spec["id"] not in args.only:
            continue
        builder = BUILDERS.get(spec["id"])
        if builder is None:
            print(f"  {spec['id']:24s} no builder, skipped")
            continue
        reset_scene()
        builder(spec, pal, tex)
        tris = triangle_count()
        extent = scene_extent()
        out = args.out / f"{spec['id']}.glb"
        export_glb(out)
        if args.preview:
            render_preview(args.preview / f"{spec['id']}.png", spec["height_m"])
        placements.append(resolve_placement(spec, feet.get(spec["id"], {}), extent))
        print(
            f"  {spec['id']:24s} {tris:6d} tris  {out.stat().st_size / 1024:7.1f} kB"
            f"  {extent:6.0f} m across"
        )

    if not args.only:
        args.manifest.parent.mkdir(parents=True, exist_ok=True)
        args.manifest.write_text(json.dumps({"landmarks": placements}, indent=2) + "\n")
        print(f"wrote {args.manifest} ({len(placements)} placements)")
    return 0


if __name__ == "__main__":
    # Blender passes its own arguments first; everything after "--" is ours.
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    raise SystemExit(main(argv))
