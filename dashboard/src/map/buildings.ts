/**
 * 3D buildings from Cesium ion, drawn by deck.gl under the access hexagons.
 *
 * What 3D Tiles are
 * -----------------
 * A 3D city model is far too big to download at once, so 3D Tiles (the OGC
 * standard Cesium created) cut it into a tree: a coarse tile for the whole
 * area, splitting into finer and finer tiles below. tileset.json describes the
 * tree; each tile is a small glTF mesh. The viewer walks the tree every frame
 * and fetches only the tiles whose detail would actually be visible from the
 * current camera — the "screen-space error" test. That is how a planet's worth
 * of buildings streams into a browser.
 *
 * Where these come from
 * ---------------------
 * Cesium OSM Buildings (ion asset 96188): every building in OpenStreetMap,
 * extruded to its tagged height or estimated from its floor count. Loading it
 * needs a Cesium ion access token, read at build time from
 * VITE_CESIUM_ION_TOKEN. With no token the feature is simply absent.
 *
 * React equivalent: none needed — this is plain deck.gl, framework-agnostic.
 */
import { Tile3DLayer } from "@deck.gl/geo-layers";
import { CesiumIonLoader } from "@loaders.gl/3d-tiles";
import type { CityId } from "../api/types.ts";
import { STUDY_AREA, type Bounds } from "./studyArea.ts";

/** Cesium OSM Buildings, available to every Cesium ion account. */
export const OSM_BUILDINGS_ASSET = 96188;

/** Where the camera goes when buildings are switched on: close and steep enough to read them. */
export const BUILDINGS_VIEW = { zoom: 15.4, pitch: 60 } as const;

/*
 * Each city's own place to land at street level. The study's city centres are
 * the middle of each study area, which for Singapore is the Central Catchment
 * nature reserve: right for the overview, empty of buildings up close.
 */
const CITY_CORE: Record<CityId, [number, number]> = {
  sg: [103.851, 1.284], // Downtown Core
  jb: [103.761, 1.462], // Johor Bahru city centre, by the Causeway
};

/** [lon, lat] to frame: the selected hexagon's centre ([lat, lng], as h3-js gives it) if any, else the city's core. */
export function buildingsFocus(city: CityId, selected: [number, number] | null): [number, number] {
  return selected ? [selected[1], selected[0]] : CITY_CORE[city];
}

export interface IonEnv {
  VITE_CESIUM_ION_TOKEN?: string;
}

export function ionToken(env: IonEnv): string | null {
  return env.VITE_CESIUM_ION_TOKEN?.trim() || null;
}

export interface HexStyle {
  extruded: boolean;
  opacity: number;
}

/**
 * With buildings on, the hexagons give up their height. Population columns
 * standing among real buildings would be two kinds of 3D fighting for the same
 * space; flattened, the hexagons become a coloured ground plane and the
 * buildings read as the city standing on its access score.
 */
export function hexStyle(buildingsOn: boolean): HexStyle {
  return buildingsOn ? { extruded: false, opacity: 0.6 } : { extruded: true, opacity: 1 };
}

/*
 * Large bounding regions
 * ----------------------
 * Cesium OSM Buildings covers the whole Earth, so the top of its tile tree is
 * regions spanning the globe, hemispheres and continents. loaders.gl turns
 * each region into an oriented box for its visibility test, and for large
 * regions that box comes out wrong: for the whole-globe root it is a thin slice
 * that misses the planet. Tiles over Singapore are then culled as off-screen
 * and no building near the camera is ever requested, with no error anywhere.
 * (visgl/loaders.gl#3144; the math.gl fix is not in a stable release yet.)
 *
 * So before the tileset reaches the traversal, every region wider or taller
 * than LARGE_REGION_RAD becomes a bounding sphere computed here. A sphere is a
 * little looser than a box, so a few extra coarse tiles may load, but the
 * visibility test for a sphere is simple and always right. City-sized tiles,
 * where the boxes are fine, keep their regions.
 */

/** About 1°: 110 km at the equator. Smaller regions keep loaders.gl's box. */
const LARGE_REGION_RAD = Math.PI / 180;
/** Points sampled per side of a region when fitting its sphere. */
const SAMPLES = 9;

/** WGS84, the ellipsoid 3D Tiles regions are defined on. */
const WGS84_A = 6_378_137;
const WGS84_E2 = 6.69437999014e-3;

/** Longitude and latitude in radians, height in metres → Earth-centred x, y, z in metres. */
export function geodeticToEcef(lon: number, lat: number, height: number): [number, number, number] {
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(lat) ** 2);
  return [
    (n + height) * Math.cos(lat) * Math.cos(lon),
    (n + height) * Math.cos(lat) * Math.sin(lon),
    (n * (1 - WGS84_E2) + height) * Math.sin(lat),
  ];
}

/**
 * A sphere [x, y, z, radius] enclosing a 3D Tiles region
 * [west, south, east, north, minHeight, maxHeight].
 *
 * Fitted to a grid of points over the region's top and bottom surfaces, then
 * padded by how far the curved surface can bulge out between two grid points
 * (the sagitta of one grid step), so no part of the region can fall outside.
 */
export function regionToSphere(region: number[]): [number, number, number, number] {
  const [west, south, east, north, minH, maxH] = region;
  const points: [number, number, number][] = [];
  for (let i = 0; i < SAMPLES; i++) {
    for (let j = 0; j < SAMPLES; j++) {
      const lon = west + ((east - west) * i) / (SAMPLES - 1);
      const lat = south + ((north - south) * j) / (SAMPLES - 1);
      points.push(geodeticToEcef(lon, lat, minH), geodeticToEcef(lon, lat, maxH));
    }
  }
  const axis = (k: 0 | 1 | 2) => {
    const v = points.map((p) => p[k]);
    return (Math.min(...v) + Math.max(...v)) / 2;
  };
  const centre: [number, number, number] = [axis(0), axis(1), axis(2)];
  const reach = Math.max(...points.map((p) => Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2])));
  const step = Math.max(east - west, north - south) / (SAMPLES - 1);
  const bulge = (WGS84_A + maxH) * (1 - Math.cos(step / 2));
  return [...centre, reach + 2 * bulge];
}

interface TileJson {
  boundingVolume?: { region?: number[]; box?: number[]; sphere?: number[] };
  children?: TileJson[];
  [key: string]: unknown;
}

interface TilesetJson {
  root: TileJson;
  [key: string]: unknown;
}

const RAD = Math.PI / 180;

/**
 * Whether a tile can hold anything inside the area. 3D Tiles nest — a child's
 * region lies within its parent's — so a tile outside takes its whole subtree
 * with it. A tile with no region (a box or sphere) is kept: it cannot be placed
 * cheaply, and Cesium OSM Buildings uses regions throughout.
 */
function overlaps(tile: TileJson, [west, south, east, north]: Bounds): boolean {
  const r = tile.boundingVolume?.region;
  if (!r) return true;
  return r[0] <= east * RAD && r[2] >= west * RAD && r[1] <= north * RAD && r[3] >= south * RAD;
}

function prepareTile(tile: TileJson, area: Bounds): TileJson {
  const region = tile.boundingVolume?.region;
  const large = region !== undefined
    && Math.max(region[2] - region[0], region[3] - region[1]) > LARGE_REGION_RAD;
  return {
    ...tile,
    ...(large ? { boundingVolume: { sphere: regionToSphere(region) } } : {}),
    ...(tile.children
      ? { children: tile.children.filter((c) => overlaps(c, area)).map((c) => prepareTile(c, area)) }
      : {}),
  };
}

/**
 * Every tileset the loader parses passes through here: tiles wholly outside
 * the study area are dropped, so the traversal never asks for them however far
 * the camera looks, and large regions become bounding spheres (see above).
 */
export function prepareTileset<T extends TilesetJson>(tileset: T, area: Bounds): T {
  return { ...tileset, root: prepareTile(tileset.root, area) };
}

const isTileset = (x: unknown): x is TilesetJson =>
  typeof x === "object" && x !== null && "root" in x;

interface ModelContent {
  gltf: { meshes?: unknown[]; [key: string]: unknown };
  [key: string]: unknown;
}

const isModel = (x: unknown): x is ModelContent =>
  typeof x === "object" && x !== null && "gltf" in x && typeof x.gltf === "object" && x.gltf !== null;

/*
 * The tileset's top tile (root.b3dm) is a placeholder: a glTF with no meshes at
 * all. luma.gl, which turns glTF into GPU objects for deck.gl, assumes the
 * mesh list exists and crashes on it, taking the whole tile layer down. Giving
 * it explicit empty lists makes it an empty scene that draws nothing.
 */
export function emptyModelSafe<T>(content: T): T {
  if (!isModel(content) || content.gltf.meshes?.length) return content;
  return { ...content, gltf: { ...content.gltf, meshes: [], nodes: [], scenes: [{ nodes: [] }] } };
}

/**
 * The ion loader with both fixes above applied to everything it parses. The
 * parsed tileset names this loader as its own, so tiles and any nested
 * tileset.json it links to come through here too.
 */
const BuildingsLoader: typeof CesiumIonLoader = {
  ...CesiumIonLoader,
  parse: async (data, options, context) => {
    const parsed = await CesiumIonLoader.parse(data, options, context);
    return isTileset(parsed)
      ? { ...prepareTileset(parsed, STUDY_AREA), loader: BuildingsLoader }
      : emptyModelSafe(parsed);
  },
};

/**
 * Tint for the building meshes. OSM Buildings arrive white, which on a dark
 * wall display out-shouts the data; a cool grey lets the access colours lead.
 */
const BUILDING_TINT: [number, number, number, number] = [150, 162, 178, 255];

export function buildingsLayer(token: string): Tile3DLayer {
  return new Tile3DLayer({
    id: "osm-buildings",
    data: `https://assets.ion.cesium.com/${OSM_BUILDINGS_ASSET}/tileset.json`,
    loaders: [BuildingsLoader],
    loadOptions: {
      // The loader trades this for the tileset's real URL and a short-lived
      // bearer token, then sends that as a header — the key never sits in a URL.
      "cesium-ion": { accessToken: token },
      tileset: {
        // Higher = coarser tiles, fewer requests. 16 is Cesium's default; a
        // 1920×1080 wall gains nothing from finer meshes than that.
        maximumScreenSpaceError: 16,
      },
    },
    // Hover and click stay with the hexagons; a building has nothing to report.
    pickable: false,
    _subLayerProps: {
      scenegraph: { getColor: BUILDING_TINT },
    },
  });
}
