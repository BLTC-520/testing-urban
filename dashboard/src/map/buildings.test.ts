import { describe, expect, it } from "vitest";
import { MaskExtension } from "@deck.gl/extensions";
import {
  BUILDING_TINTS,
  BUILDINGS_MASK_ID, OSM_BUILDINGS_ASSET, buildingsFocus, buildingsLayer, cityMaskLayer, emptyModelSafe, geodeticToEcef, hexStyle, ionToken,
  prepareTileset, regionToSphere,
} from "./buildings.ts";
import { STUDY_AREA } from "./studyArea.ts";

const RAD = Math.PI / 180;
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("geodetic to Earth-centred coordinates", () => {
  it("puts the equator at the prime meridian on the x axis, one Earth radius out", () => {
    const [x, y, z] = geodeticToEcef(0, 0, 0);
    expect(x).toBeCloseTo(6_378_137, 0);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it("puts the north pole on the z axis, at the shorter polar radius", () => {
    const [x, , z] = geodeticToEcef(0, Math.PI / 2, 0);
    expect(Math.abs(x)).toBeLessThan(1e-6);
    expect(z).toBeCloseTo(6_356_752.3, 0);
  });
});

describe("a region's bounding sphere", () => {
  // Singapore's downtown, 30 m up: the point every sphere below must contain.
  const raffles = geodeticToEcef(103.85 * RAD, 1.29 * RAD, 30);
  const contains = (region: number[], p: number[]) => {
    const [cx, cy, cz, r] = regionToSphere(region);
    return dist([cx, cy, cz], p) <= r;
  };

  it("encloses every point of a quarter-globe tile, corners and middle alike", () => {
    const quarter = [90 * RAD, 0, 180 * RAD, 90 * RAD, -100, 1000];
    expect(contains(quarter, raffles)).toBe(true);
    for (const [lon, lat] of [[90, 0], [180, 0], [90, 89.9], [135, 45], [179.9, 0.1]]) {
      expect(contains(quarter, geodeticToEcef(lon * RAD, lat * RAD, 1000))).toBe(true);
      expect(contains(quarter, geodeticToEcef(lon * RAD, lat * RAD, -100))).toBe(true);
    }
  });

  it("does not reach the far side of the planet", () => {
    const quarter = [90 * RAD, 0, 180 * RAD, 90 * RAD, -100, 1000];
    expect(contains(quarter, geodeticToEcef(-80 * RAD, -40 * RAD, 0))).toBe(false);
  });

  it("encloses the whole planet for the whole-globe root", () => {
    const globe = [-Math.PI, -1.47, Math.PI, 1.45, -394, 5967];
    expect(contains(globe, raffles)).toBe(true);
    expect(contains(globe, geodeticToEcef(-80 * RAD, -40 * RAD, 0))).toBe(true);
  });
});

describe("keeping only the study area", () => {
  const deg = (d: number) => d * RAD;
  const region = (w: number, s: number, e: number, n: number) => ({ region: [deg(w), deg(s), deg(e), deg(n), 0, 100] });
  const tileset = {
    root: {
      boundingVolume: region(90, -10, 120, 20),
      children: [
        { boundingVolume: region(103.8, 1.25, 103.9, 1.32), content: { uri: "sg.b3dm" } },   // Singapore
        { boundingVolume: region(103.7, 1.45, 103.8, 1.55), content: { uri: "jb.b3dm" } },   // Johor Bahru
        { boundingVolume: region(104.0, 1.0, 104.2, 1.15), content: { uri: "batam.b3dm" } }, // overlaps the box's corner
        { boundingVolume: region(100.4, 13.6, 100.7, 13.9), content: { uri: "bangkok.b3dm" } },
        { boundingVolume: { sphere: [0, 0, 0, 1] }, content: { uri: "no-region.b3dm" } },
      ],
    },
  };
  const uris = (t: typeof tileset) =>
    (t.root.children ?? []).map((c) => (c as { content?: { uri: string } }).content?.uri);

  it("drops tiles that lie wholly outside it, so they are never requested", () => {
    expect(uris(prepareTileset(tileset, STUDY_AREA))).not.toContain("bangkok.b3dm");
  });

  it("keeps tiles inside or overlapping it, and any it cannot place", () => {
    expect(uris(prepareTileset(tileset, STUDY_AREA))).toEqual(
      ["sg.b3dm", "jb.b3dm", "batam.b3dm", "no-region.b3dm"],
    );
  });

  it("is the pipeline's acquisition box, which holds both cities", () => {
    const [w, s, e, n] = STUDY_AREA;
    for (const [lon, lat] of [[103.85, 1.29], [103.76, 1.46]]) {
      expect(lon > w && lon < e && lat > s && lat < n).toBe(true);
    }
  });
});

describe("large bounding regions in a tileset", () => {
  // The shape of Cesium OSM Buildings' top: a root spanning the whole globe,
  // split into hemispheres, with ordinary city-sized tiles further down.
  const singapore = { region: [1.8115, 0.0217, 1.8150, 0.0245, -10, 300] };
  const tileset = {
    asset: { version: "1.0" },
    root: {
      boundingVolume: { region: [-Math.PI, -1.47, Math.PI, 1.45, -394, 5967] },
      children: [
        { boundingVolume: { region: [-Math.PI, -1.47, 0, 1.45, -165, 5915] }, children: [] },
        {
          boundingVolume: { region: [0, -1.40, Math.PI, 1.43, -394, 5967] },
          children: [{ boundingVolume: singapore, content: { uri: "sg.glb" } }],
        },
      ],
    },
  };
  const out = prepareTileset(tileset, [-180, -90, 180, 90]);

  it("become bounding spheres", () => {
    expect(out.root.boundingVolume).toHaveProperty("sphere");
    expect(out.root.children?.[0].boundingVolume).toHaveProperty("sphere");
    expect(out.root.children?.[1].boundingVolume).toHaveProperty("sphere");
  });

  it("leave city-sized tiles, their content and the rest of the tileset untouched", () => {
    const sg = out.root.children?.[1].children?.[0];
    expect(sg?.boundingVolume).toEqual(singapore);
    expect(sg?.content).toEqual({ uri: "sg.glb" });
    expect(out.asset).toEqual(tileset.asset);
  });

  it("return a new tree rather than editing the parsed one", () => {
    expect(out).not.toBe(tileset);
    expect(tileset.root.boundingVolume).toHaveProperty("region");
  });
});

describe("Cesium ion token", () => {
  it("is read from the build environment, trimmed", () => {
    expect(ionToken({ VITE_CESIUM_ION_TOKEN: "  abc.def  " })).toBe("abc.def");
  });

  it("is null when unset or blank, which hides the buildings feature", () => {
    expect(ionToken({})).toBeNull();
    expect(ionToken({ VITE_CESIUM_ION_TOKEN: "   " })).toBeNull();
  });
});

describe("empty placeholder tiles", () => {
  it("get explicit empty mesh, node and scene lists, which luma.gl requires", () => {
    const out = emptyModelSafe({ type: "b3dm", gltf: { asset: { version: "2.0" } } });
    expect(out).toMatchObject({ type: "b3dm", gltf: { asset: { version: "2.0" }, meshes: [], nodes: [], scenes: [{ nodes: [] }] } });
  });

  it("leave tiles with real geometry, and anything that is not a model, alone", () => {
    const real = { type: "b3dm", gltf: { meshes: [{ primitives: [] }], nodes: [{ mesh: 0 }] } };
    expect(emptyModelSafe(real)).toBe(real);
    const tileset = { root: {} };
    expect(emptyModelSafe(tileset)).toBe(tileset);
  });
});

describe("one city's buildings at a time", () => {
  const sg = buildingsLayer("tok", "sg");
  const jb = buildingsLayer("tok", "jb");

  it("are separate layers, so switching city loads a tileset pruned to the new city", () => {
    expect(sg.id).not.toBe(jb.id);
    expect(sg.props.loaders?.[0]).not.toBe(jb.props.loaders?.[0]);
  });

  it("keep the same loader for the same city, so a re-render does not reload", () => {
    expect(buildingsLayer("tok", "sg").props.loaders?.[0]).toBe(sg.props.loaders?.[0]);
  });

  it("are clipped on the GPU to the current city's hexagons", () => {
    const props = sg.props as unknown as { maskId?: string };
    expect(sg.props.extensions?.some((e) => e instanceof MaskExtension)).toBe(true);
    expect(props.maskId).toBe(BUILDINGS_MASK_ID);
  });

  it("take their mask from a layer that only masks and never draws", () => {
    const mask = cityMaskLayer([]);
    expect(mask.id).toBe(BUILDINGS_MASK_ID);
    expect(mask.props.operation).toBe("mask");
  });
});

describe("the buildings layer", () => {
  const layer = buildingsLayer("tok", "sg");

  it("loads Cesium OSM Buildings through the ion loader", () => {
    expect(layer.props.data).toBe(`https://assets.ion.cesium.com/${OSM_BUILDINGS_ASSET}/tileset.json`);
    expect(layer.props.loaders?.[0]?.id).toBe("cesium-ion");
  });

  it("passes the token to the loader, never in the URL", () => {
    expect(String(layer.props.data)).not.toContain("tok");
    const opts = layer.props.loadOptions as Record<string, { accessToken?: string }>;
    expect(opts["cesium-ion"]?.accessToken).toBe("tok");
  });

  it("is not pickable, so hovering still reaches the hexagons beneath", () => {
    expect(layer.props.pickable).toBe(false);
  });

  it("applies role tint by default and respects access color mode", () => {
    expect(BUILDING_TINTS.role).toEqual([72, 92, 118, 235]);
    expect(BUILDING_TINTS.access).toEqual([44, 148, 162, 230]);

    const defaultLayer = buildingsLayer("tok", "sg");
    expect(defaultLayer.props._subLayerProps?.scenegraph?.getColor).toEqual(BUILDING_TINTS.role);

    const accessLayer = buildingsLayer("tok", "sg", "access");
    expect(accessLayer.props._subLayerProps?.scenegraph?.getColor).toEqual(BUILDING_TINTS.access);
  });
});

describe("where the camera lands with buildings on", () => {
  it("goes to a selected hexagon first", () => {
    expect(buildingsFocus("sg", [1.30, 103.80])).toEqual([103.80, 1.30]);
  });

  it("otherwise goes to each city's own centre, never the other city's", () => {
    const [sgLon, sgLat] = buildingsFocus("sg", null);
    const [jbLon, jbLat] = buildingsFocus("jb", null);
    // Singapore's Downtown Core, south of the Causeway; JB's centre, north of it.
    expect(sgLat).toBeLessThan(1.32);
    expect(jbLat).toBeGreaterThan(1.45);
    expect(Math.abs(sgLon - 103.85)).toBeLessThan(0.02);
    expect(Math.abs(jbLon - 103.76)).toBeLessThan(0.02);
  });
});

describe("hexagons under the buildings", () => {
  it("stand as population columns on their own", () => {
    expect(hexStyle(false)).toEqual({ extruded: true, opacity: 1 });
  });

  it("lie flat and translucent under buildings, so the city is not hidden twice over", () => {
    const s = hexStyle(true);
    expect(s.extruded).toBe(false);
    expect(s.opacity).toBeGreaterThan(0);
    expect(s.opacity).toBeLessThan(1);
  });
});
