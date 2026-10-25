/**
 * "Night survey" basemap — the same style the React site uses, pointed at the
 * API's /basemap and /fonts prefixes instead of its own /public.
 *
 * The one copy of basemap.pmtiles lives in web/public/tiles and is served by
 * /server (see the @fastify/static registration in server/src/app.ts), so
 * neither the 47 MB archive nor the glyph PBFs are duplicated here.
 *
 * Darker and quieter than a general-purpose dark style on purpose: on a wall
 * display the analysis layer has to carry all the colour, so the basemap is
 * almost monochrome and the study area outside the two cities is dimmed.
 */
import { Protocol } from "pmtiles";
import maplibregl, { type StyleSpecification } from "maplibre-gl";

export const ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · ' +
  '© <a href="https://esa-worldcover.org">ESA WorldCover</a> 2021 · ' +
  "Population: Meta/CIESIN HRSL, Kontur · Census: SingStat, DOSM";

const API = import.meta.env.VITE_API_BASE ?? "";

/**
 * Absolute URL for a path served by the API.
 *
 * Built by concatenation, NOT with `new URL()`: the glyphs URL carries
 * {fontstack} and {range} template tokens that MapLibre substitutes itself,
 * and URL() percent-encodes the braces, after which MapLibre rejects the style
 * with `"glyphs" url must include a "{fontstack}" token`.
 */
const origin = () => `${window.location.origin}`;
const asset = (path: string) => (API ? `${API}${path}` : `${origin()}${path}`);

let registered = false;
/**
 * pmtiles serves a whole tile archive out of one file over HTTP range requests.
 * The protocol handler must be registered on the maplibre singleton once, before
 * any map is constructed; doing it twice throws.
 */
export function registerPmtiles(): void {
  if (registered) return;
  maplibregl.addProtocol("pmtiles", new Protocol().tile);
  registered = true;
}

export function basemapStyle(): StyleSpecification {
  const road = (
    id: string, minzoom: number, classes: string[],
    width: [number, number][], color: string,
  ) => ({
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
    glyphs: asset("/fonts/{fontstack}/{range}.pbf"),
    sources: {
      basemap: {
        type: "vector",
        url: `pmtiles://${asset("/basemap/basemap.pmtiles")}`,
        attribution: ATTRIBUTION,
      },
    },
    layers: [
      { id: "land", type: "background", paint: { "background-color": "#0a0d11" } },
      { id: "built", type: "fill", source: "basemap", "source-layer": "built",
        paint: { "fill-color": "#13171d", "fill-opacity": 0.9 } },
      { id: "vegetation", type: "fill", source: "basemap", "source-layer": "landcover",
        paint: { "fill-color": "#0d1714", "fill-opacity": 0.8 } },
      { id: "water", type: "fill", source: "basemap", "source-layer": "water",
        paint: { "fill-color": "#06111b" } },
      /*
       * Building massing. The archive carries OSM footprints but no heights —
       * the extract the pipeline cuts does not keep building:levels — so every
       * block is extruded to the same 9 m. That is a drawing convention, not a
       * measurement: it gives the landmarks a city to stand in and the low sun
       * something to cast across, and it is stated in the map's legend so
       * nobody reads a skyline into it.
       *
       * It starts at zoom 13 because below that the footprints are generalised
       * to the point of being smears, and because a whole city of extrusions is
       * expensive for something the overview does not need.
       */
      { id: "buildings", type: "fill-extrusion", source: "basemap", "source-layer": "buildings",
        minzoom: 13,
        paint: {
          "fill-extrusion-color": "#161b22",
          "fill-extrusion-height": 9,
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 14.2, 0.9] as never,
        } },
      { id: "water-edge", type: "line", source: "basemap", "source-layer": "water", minzoom: 10,
        paint: { "line-color": "#0d2030", "line-width": 0.6 } },
      road("roads-minor", 12, ["service", "residential", "living_street", "unclassified"], [[12, 0.25], [18, 3]], "#1b2129"),
      road("roads-mid", 10, ["tertiary", "secondary"], [[10, 0.35], [18, 6]], "#222a34"),
      road("roads-major", 8, ["primary", "trunk", "motorway"], [[8, 0.45], [18, 9]], "#2b3440"),
      { id: "rail", type: "line", source: "basemap", "source-layer": "rail",
        filter: ["!=", ["get", "status"], "construction"],
        paint: {
          "line-color": "#36404e",
          "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.5, 16, 1.8],
          "line-dasharray": [3, 2],
        } },
      // The Singapore–Malaysia border: the whole point of studying the pair.
      { id: "border", type: "line", source: "basemap", "source-layer": "border",
        paint: {
          "line-color": "#c9c3b8",
          "line-opacity": 0.4,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.8, 14, 1.6],
          "line-dasharray": [6, 4],
        } },
      { id: "places", type: "symbol", source: "basemap", "source-layer": "places", minzoom: 10.5,
        filter: ["in", ["get", "kind"], ["literal", ["suburb", "neighbourhood", "town"]]],
        layout: {
          "text-field": ["upcase", ["get", "name"]],
          "text-font": ["Noto Sans Medium"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 11, 9, 15, 11],
          "text-letter-spacing": 0.14,
          "text-max-width": 8,
          "text-padding": 8,
        },
        paint: { "text-color": "#8d939d", "text-halo-color": "#07090c", "text-halo-width": 1.8 } },
      { id: "places-major", type: "symbol", source: "basemap", "source-layer": "places", maxzoom: 12.5,
        filter: ["in", ["get", "kind"], ["literal", ["city"]]],
        layout: {
          "text-field": ["upcase", ["get", "name"]],
          "text-font": ["Noto Sans Medium"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 8, 11, 12, 14],
          "text-letter-spacing": 0.3,
        },
        paint: { "text-color": "#d9d4c9", "text-halo-color": "#07090c", "text-halo-width": 2 } },
    ],
  };
}
