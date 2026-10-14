import type { StyleSpecification } from "maplibre-gl";

const BASE = import.meta.env.BASE_URL;

export const ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · ' +
  '© <a href="https://esa-worldcover.org">ESA WorldCover</a> 2021 · ' +
  "Population: Meta/CIESIN HRSL, Kontur · Census: SingStat, DOSM · Boundaries: URA, DOSM";

/**
 * Absolute URL for a file in /public (works under any deployment base path).
 * Template tokens such as {fontstack} are preserved (URL() would percent-encode them).
 */
export function asset(path: string): string {
  const base = new URL(BASE, window.location.href).href;
  return base + path;
}

/**
 * "Night survey" basemap: almost-black land, deep blue water, faint built
 * fabric and streets — quiet enough that the analysis layers carry the colour.
 */
export function basemapStyle(): StyleSpecification {
  const road = (minzoom: number, classes: string[], width: [number, number][], color: string, id: string) => ({
    id,
    type: "line" as const,
    source: "basemap",
    "source-layer": "roads",
    minzoom,
    filter: ["in", ["get", "class"], ["literal", classes]] as never,
    layout: { "line-cap": "round" as const, "line-join": "round" as const },
    paint: {
      "line-color": color,
      "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], ...width.flat()] as never,
    },
  });

  return {
    version: 8,
    name: "SG/JB night survey",
    glyphs: asset("fonts/{fontstack}/{range}.pbf"),
    sources: {
      basemap: {
        type: "vector",
        url: "pmtiles://" + asset("tiles/basemap.pmtiles"),
        attribution: ATTRIBUTION,
      },
    },
    layers: [
      { id: "land", type: "background", paint: { "background-color": "#0e1115" } },
      {
        id: "built",
        type: "fill",
        source: "basemap",
        "source-layer": "built",
        paint: { "fill-color": "#15191f", "fill-opacity": 0.9 },
      },
      {
        id: "vegetation",
        type: "fill",
        source: "basemap",
        "source-layer": "landcover",
        paint: { "fill-color": "#0f1a16", "fill-opacity": 0.85 },
      },
      {
        id: "water",
        type: "fill",
        source: "basemap",
        "source-layer": "water",
        paint: { "fill-color": "#071420" },
      },
      {
        id: "water-edge",
        type: "line",
        source: "basemap",
        "source-layer": "water",
        minzoom: 10,
        paint: { "line-color": "#0f2638", "line-width": 0.6 },
      },
      {
        id: "buildings",
        type: "fill",
        source: "basemap",
        "source-layer": "buildings",
        minzoom: 13,
        paint: {
          "fill-color": "#1b2028",
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 14, 0.75],
        },
      },
      road(14, ["path", "footway", "pedestrian", "steps", "cycleway"], [[14, 0.4], [18, 2]], "#232a33", "roads-paths"),
      road(12, ["service", "residential", "living_street", "unclassified"], [[12, 0.3], [18, 4]], "#20262e", "roads-minor"),
      road(10, ["tertiary", "secondary"], [[10, 0.4], [18, 7]], "#28303a", "roads-mid"),
      road(8, ["primary", "trunk", "motorway"], [[8, 0.5], [18, 10]], "#313a46", "roads-major"),
      {
        id: "rail",
        type: "line",
        source: "basemap",
        "source-layer": "rail",
        filter: ["!=", ["get", "status"], "construction"],
        paint: {
          "line-color": "#3d4757",
          "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.6, 16, 2.2],
          "line-dasharray": [3, 2],
        },
      },
      {
        id: "border",
        type: "line",
        source: "basemap",
        "source-layer": "border",
        paint: {
          "line-color": "#c9c3b8",
          "line-opacity": 0.45,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.8, 14, 1.6],
          "line-dasharray": [6, 4],
        },
      },
      {
        id: "places",
        type: "symbol",
        source: "basemap",
        "source-layer": "places",
        minzoom: 11,
        filter: ["in", ["get", "kind"], ["literal", ["suburb", "neighbourhood", "quarter", "town"]]],
        layout: {
          "text-field": ["upcase", ["get", "name"]],
          "text-font": ["Noto Sans Medium"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 11, 9, 15, 12],
          "text-letter-spacing": 0.14,
          "text-max-width": 8,
          "text-padding": 6,
        },
        paint: {
          "text-color": "#8c9099",
          "text-halo-color": "#0b0e12",
          "text-halo-width": 1.4,
        },
      },
      {
        id: "places-major",
        type: "symbol",
        source: "basemap",
        "source-layer": "places",
        maxzoom: 13,
        filter: ["in", ["get", "kind"], ["literal", ["city"]]],
        layout: {
          "text-field": ["upcase", ["get", "name"]],
          "text-font": ["Noto Sans Medium"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 8, 11, 12, 15],
          "text-letter-spacing": 0.3,
        },
        paint: {
          "text-color": "#c9c3b8",
          "text-halo-color": "#0b0e12",
          "text-halo-width": 1.6,
        },
      },
    ],
  };
}
