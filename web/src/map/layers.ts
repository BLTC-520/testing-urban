import { DataFilterExtension } from "@deck.gl/extensions";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { GeoJsonLayer, LineLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Aggregate } from "../lib/access";
import { CATEGORY_COLOR, NEUTRAL, RAMP, minutesColor, type RGB } from "../lib/colors";

const NEUTRAL_MARK: RGB = [236, 233, 226];
import type { Pois } from "../lib/data";
import type { Segment } from "../lib/streetGraph";

export function hexLayer(
  id: string,
  data: Aggregate[],
  kind: "count" | "minutes",
  k: number,
  opts: { opacity?: number; coverage?: number; maxMinutes?: number; extruded?: boolean; elevationScale?: number; trigger?: unknown } = {},
) {
  const color = (d: Aggregate): RGB =>
    kind === "count" ? RAMP[Math.max(0, Math.min(k, Math.round(d.value)))] : minutesColor(d.value, opts.maxMinutes ?? 30);
  return new H3HexagonLayer<Aggregate>({
    id,
    data,
    getHexagon: (d) => d.hex,
    getFillColor: (d) => {
      const c = color(d);
      return [c[0], c[1], c[2], 255];
    },
    extruded: opts.extruded ?? false,
    getElevation: (d) => Math.sqrt(Math.max(0, d.pop)) * 18,
    elevationScale: opts.elevationScale ?? 1,
    coverage: opts.coverage ?? 1,
    opacity: opts.opacity ?? 0.82,
    stroked: false,
    pickable: false,
    highPrecision: false,
    material: { ambient: 0.55, diffuse: 0.55, shininess: 24, specularColor: [60, 60, 60] },
    updateTriggers: { getFillColor: [kind, k, opts.maxMinutes, opts.trigger], getElevation: [opts.trigger] },
    transitions: { getFillColor: { duration: 450 }, getElevation: { duration: 900 } },
  });
}

const BAND: RGB[] = [RAMP[6], RAMP[5], RAMP[4], RAMP[3]];

/** Animated walk-shed: segments appear as the network distance reaches them. */
export function isochroneLayer(id: string, segments: Segment[], revealM: number, speed: number) {
  const bandOf = (d: number) => Math.min(3, Math.floor(d / (5 * 60 * speed)));
  return new LineLayer<Segment, { getFilterValue: (d: Segment) => number; filterRange: [number, number] }>({
    id,
    data: segments,
    getSourcePosition: (d) => d.from,
    getTargetPosition: (d) => d.to,
    getColor: (d) => {
      const c = BAND[bandOf(d.d)];
      return [c[0], c[1], c[2], 235];
    },
    getWidth: (d) => (bandOf(d.d) === 0 ? 3 : 2.2),
    widthUnits: "pixels",
    widthMinPixels: 1.2,
    getFilterValue: (d) => d.d,
    filterRange: [0, revealM],
    extensions: [new DataFilterExtension({ filterSize: 1 })],
    updateTriggers: { getColor: [speed], getWidth: [speed] },
    parameters: { depthCompare: "always" },
  });
}

export function poiLayer(id: string, pois: Pois, opts: { categories: string[]; highlight?: Set<number>; minZoomScale?: number }) {
  const idx: number[] = [];
  const bits = opts.categories.map((c) => pois.categories.indexOf(c)).filter((b) => b >= 0);
  for (let i = 0; i < pois.lon.length; i++) {
    if (bits.some((b) => pois.mask[i] & (1 << b))) idx.push(i);
  }
  const firstCat = (i: number) => {
    for (const b of bits) if (pois.mask[i] & (1 << b)) return pois.categories[b];
    return pois.categories[0];
  };
  // On a map any two marks can sit side by side, so more than ~3 hues cannot be told
  // apart reliably: with several categories shown, draw one neutral mark and let the
  // hover card / inspector carry identity.
  const single = opts.categories.length === 1;
  return new ScatterplotLayer<number>({
    id,
    data: idx,
    getPosition: (i) => [pois.lon[i], pois.lat[i]],
    getFillColor: (i) => {
      const c = single ? CATEGORY_COLOR[firstCat(i)] ?? NEUTRAL : NEUTRAL_MARK;
      const on = !opts.highlight || opts.highlight.has(i);
      return [c[0], c[1], c[2], on ? 240 : 70];
    },
    getRadius: (i) => (opts.highlight?.has(i) ? 4 : 2.6),
    radiusUnits: "pixels",
    stroked: true,
    getLineColor: [10, 12, 16, 200],
    lineWidthMinPixels: 0.6,
    pickable: true,
    updateTriggers: { getFillColor: [opts.highlight, opts.categories.join()], getRadius: [opts.highlight] },
  });
}

export function unitsLayer(id: string, data: GeoJSON.FeatureCollection, hovered: string | null, city: string | null = null) {
  return new GeoJsonLayer({
    id,
    data,
    filled: true,
    stroked: true,
    getFillColor: (f) => (f.properties?.unit_id === hovered ? [244, 241, 184, 22] : [0, 0, 0, 0]),
    getLineColor: (f) =>
      city && f.properties?.city !== city ? [236, 233, 226, 25] : f.properties?.unit_id === hovered ? [244, 241, 184, 200] : [236, 233, 226, 60],
    getLineWidth: (f) => (f.properties?.unit_id === hovered ? 2 : 0.8),
    lineWidthUnits: "pixels",
    pickable: true,
    updateTriggers: { getFillColor: [hovered], getLineColor: [hovered, city], getLineWidth: [hovered] },
  });
}

export function markerLayer(id: string, pos: [number, number] | null, pulse = 0) {
  return new ScatterplotLayer<[number, number]>({
    id,
    data: pos ? [pos] : [],
    getPosition: (d) => d,
    getRadius: 7 + pulse * 10,
    radiusUnits: "pixels",
    filled: true,
    getFillColor: [255, 106, 77, Math.round(255 * (1 - pulse * 0.8))],
    stroked: true,
    getLineColor: [255, 255, 255, 230],
    lineWidthMinPixels: 1.5,
    updateTriggers: { getRadius: [pulse], getFillColor: [pulse] },
  });
}
