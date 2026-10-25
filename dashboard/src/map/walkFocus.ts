/**
 * Ported in part from web/src/map/layers.ts (isochroneLayer, markerLayer) and
 * web/src/lib/colors.ts (RAMP, CATEGORY_COLOR).
 *
 * Pure camera geometry and deck.gl layer builders for landmark walk-focus mode:
 *   1. Street-to-building bearing with the < 15 m fallback
 *   2. Pullback camera framing the reachable street network at the same bearing
 *   3. Progressive 5-minute-banded LineLayer without adding @deck.gl/extensions
 *   4. Start-node and nearest-essential POI markers
 */
import { ColumnLayer, LineLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { RGBA } from "./colors.ts";
import type { NearestPoi, Reached } from "./pois.ts";
import type { Segment } from "./streetGraph.ts";
import type { Bounds } from "./studyArea.ts";

const M_PER_DEG_LAT = 110_574;
const mPerDegLon = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** Minimum distance (m) from the start node to the building to compute a new bearing. */
export const MIN_BEARING_DIST_M = 15;

/** Initial close-up camera facing the landmark from the street. */
export const FOCUS_SHOT = { zoom: 16.5, pitch: 62, duration: 1600 } as const;

/** Duration (ms) over which the walking routes spread outward and the camera pulls back. */
export const REVEAL_DURATION_MS = 3500;

export const PULLBACK_PITCH = 50;

/** 5-minute walk bands (0–5, 5–10, 10–15, 15+ min) from tokens.css (--ramp-6 .. --ramp-3). */
export const BAND_COLORS: readonly [number, number, number][] = [
  [182, 244, 202], // 0–5 min   (--ramp-6)
  [106, 213, 182], // 5–10 min  (--ramp-5)
  [28, 180, 182],  // 10–15 min (--ramp-4)
  [11, 142, 175],  // 15+ min   (--ramp-3)
];

/** Essential category RGBs matching tokens.css (--cat-*). */
export const CATEGORY_RGB: Readonly<Record<string, [number, number, number]>> = {
  groceries: [190, 134, 9],
  healthcare: [220, 75, 110],
  education: [95, 138, 223],
  green_space: [45, 169, 98],
  transit: [156, 112, 208],
  dining: [211, 119, 46],
};

/** Planar ground distance in metres between two [lon, lat] points. */
export function metresBetweenPoints(
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const kx = mPerDegLon((a[1] + b[1]) / 2);
  return Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * M_PER_DEG_LAT);
}

/**
 * Compass bearing (degrees clockwise from north, in (-180, 180]) from the
 * nearest street-graph node to the building's point. When the two are under
 * `minDistM` (15 m) apart, returns `fallbackBearing` so a near-zero vector
 * never spins the camera arbitrarily.
 */
export function bearingToBuilding(
  startNode: readonly [number, number],
  building: readonly [number, number],
  fallbackBearing: number,
  minDistM = MIN_BEARING_DIST_M,
): number {
  const kx = mPerDegLon((startNode[1] + building[1]) / 2);
  const dx = (building[0] - startNode[0]) * kx;
  const dy = (building[1] - startNode[1]) * M_PER_DEG_LAT;
  const dist = Math.hypot(dx, dy);
  if (!Number.isFinite(dist) || dist < minDistM) return fallbackBearing;
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

/** Bounding box [west, south, east, north] of a set of street segments. */
export function segmentBounds(segments: readonly Segment[]): Bounds | null {
  if (segments.length === 0) return null;
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const seg of segments) {
    for (const [lon, lat] of [seg.from, seg.to]) {
      if (lon < w) w = lon;
      if (lon > e) e = lon;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
  }
  return [w, s, e, n];
}

/**
 * Camera target that frames the whole reachable walk-shed while keeping the
 * focus shot's bearing.
 */
export function pullbackCamera(
  segments: readonly Segment[],
  fallbackCenter: readonly [number, number],
  bearing: number,
): { center: [number, number]; zoom: number; pitch: number; bearing: number } {
  const b = segmentBounds(segments);
  if (!b) {
    return {
      center: [fallbackCenter[0], fallbackCenter[1]],
      zoom: 14.8,
      pitch: PULLBACK_PITCH,
      bearing,
    };
  }
  const [w, s, e, n] = b;
  const center: [number, number] = [(w + e) / 2, (s + n) / 2];
  const spanM = Math.max(300, metresBetweenPoints([w, s], [e, n]));
  const zoom = Math.max(13.2, Math.min(15.6, 14.65 - Math.log2(spanM / 1800)));
  return { center, zoom, pitch: PULLBACK_PITCH, bearing };
}

/** Which 5-minute band (0..3) a network distance in metres falls into. */
export function bandOf(dMetres: number, speedMps: number): 0 | 1 | 2 | 3 {
  const step = Math.max(1, 5 * 60 * speedMps);
  return Math.min(3, Math.max(0, Math.floor(dMetres / step))) as 0 | 1 | 2 | 3;
}

/** Segments reached up to `revealM` metres without mutating the input array. */
export function visibleSegments(segments: readonly Segment[], revealM: number): Segment[] {
  if (revealM <= 0) return [];
  return segments.filter((s) => s.d <= revealM);
}

/**
 * Progressive walk-shed LineLayer banded by 5 minutes.
 * Slices `segments` by `revealM` instead of requiring @deck.gl/extensions.
 */
export function isochroneLayer(
  id: string,
  segments: readonly Segment[],
  revealM: number,
  speedMps: number,
): LineLayer<Segment> {
  const shown = visibleSegments(segments, revealM);
  return new LineLayer<Segment>({
    id,
    data: shown,
    getSourcePosition: (d) => d.from,
    getTargetPosition: (d) => d.to,
    getColor: (d): RGBA => {
      const c = BAND_COLORS[bandOf(d.d, speedMps)];
      return [c[0], c[1], c[2], 235];
    },
    getWidth: (d) => (bandOf(d.d, speedMps) === 0 ? 3.2 : 2.2),
    widthUnits: "pixels",
    widthMinPixels: 1.3,
    pickable: false,
    updateTriggers: {
      getColor: [speedMps],
      getWidth: [speedMps],
    },
    parameters: { depthCompare: "always" },
  });
}

export interface NearestMarker extends NearestPoi {
  category: string;
  color: [number, number, number];
}

/** Extract markers for the nearest place in each essential category within budget. */
export function nearestPoiMarkers(
  reached: Reached | null,
  basket: readonly string[],
  thresholdMin: number,
  revealM = Infinity,
): NearestMarker[] {
  if (!reached) return [];
  const out: NearestMarker[] = [];
  for (const cat of basket) {
    const p = reached.nearest[cat];
    if (!p || p.minutes > thresholdMin || p.distanceM > revealM) continue;
    out.push({
      ...p,
      category: cat,
      color: CATEGORY_RGB[cat] ?? [236, 233, 226],
    });
  }
  return out;
}

export interface WalkMarkerOptions {
  activeCategory?: string | null;
  onHoverMarker?: (m: NearestMarker | null, x: number, y: number) => void;
  onClickMarker?: (m: NearestMarker) => void;
}

/** Start-node marker and per-category nearest-place markers on the map. */
export function walkMarkerLayers(
  startNode: readonly [number, number] | null,
  markers: readonly NearestMarker[],
  options?: WalkMarkerOptions,
) {
  return [
    new ScatterplotLayer<readonly [number, number]>({
      id: "walk-start-node",
      data: startNode ? [startNode] : [],
      getPosition: (d) => [d[0], d[1]],
      getRadius: 6,
      radiusUnits: "pixels",
      filled: true,
      getFillColor: [243, 239, 230, 245],
      stroked: true,
      getLineColor: [7, 9, 12, 235],
      lineWidthMinPixels: 2,
      pickable: false,
      parameters: { depthCompare: "always" },
    }),
    new ColumnLayer<NearestMarker>({
      id: "walk-nearest-poi-columns",
      data: [...markers],
      diskResolution: 16,
      radius: 14,
      extruded: true,
      wireframe: true,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 240, 150, 220],
      getPosition: (d) => [d.lon, d.lat],
      getElevation: (d) => (options?.activeCategory === d.category ? 68 : 42),
      getFillColor: (d) => [
        d.color[0],
        d.color[1],
        d.color[2],
        options?.activeCategory === d.category ? 245 : 205,
      ],
      getLineColor: [243, 239, 230, 245],
      onHover: (info) => options?.onHoverMarker?.(info.object ?? null, info.x, info.y),
      onClick: (info) => {
        if (info.object) options?.onClickMarker?.(info.object);
      },
      updateTriggers: {
        getElevation: [options?.activeCategory],
        getFillColor: [options?.activeCategory],
      },
    }),
    new ScatterplotLayer<NearestMarker>({
      id: "walk-nearest-pois",
      data: [...markers],
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 6.5,
      radiusUnits: "pixels",
      filled: true,
      getFillColor: (d) => [d.color[0], d.color[1], d.color[2], 245],
      stroked: true,
      getLineColor: [243, 239, 230, 240],
      lineWidthMinPixels: 1.8,
      pickable: true,
      onHover: (info) => options?.onHoverMarker?.(info.object ?? null, info.x, info.y),
      onClick: (info) => {
        if (info.object) options?.onClickMarker?.(info.object);
      },
      parameters: { depthCompare: "always" },
    }),
  ];
}

export interface RouteSegment {
  from: [number, number];
  to: [number, number];
}

/** Walking shortest-path polyline layer from landmark street origin to destination. */
export function activeRouteLayer(
  id: string,
  route: readonly [number, number][] | null,
  color: readonly [number, number, number] = [255, 209, 102],
): LineLayer<RouteSegment> {
  const segments: RouteSegment[] = [];
  if (route && route.length >= 2) {
    for (let i = 0; i < route.length - 1; i++) {
      segments.push({
        from: [route[i][0], route[i][1]],
        to: [route[i + 1][0], route[i + 1][1]],
      });
    }
  }
  return new LineLayer<RouteSegment>({
    id,
    data: segments,
    getSourcePosition: (d) => d.from,
    getTargetPosition: (d) => d.to,
    getColor: [color[0], color[1], color[2], 255],
    getWidth: 5.5,
    widthUnits: "pixels",
    widthMinPixels: 3,
    pickable: false,
    updateTriggers: {
      getColor: [color],
    },
    parameters: { depthCompare: "always" },
  });
}
