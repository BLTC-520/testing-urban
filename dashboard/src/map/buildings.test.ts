import { describe, expect, it } from "vitest";
import {
  OSM_BUILDINGS_ASSET, buildingsFocus, buildingsLayer, emptyModelSafe, geodeticToEcef, hexStyle, ionToken,
  regionToSphere, spheresForLargeRegions,
} from "./buildings.ts";

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
  const out = spheresForLargeRegions(tileset);

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

describe("the buildings layer", () => {
  const layer = buildingsLayer("tok");

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
