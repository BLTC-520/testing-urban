import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { ScatterplotLayer } from "@deck.gl/layers";
import type { Aggregate } from "../lib/access";
import { GAIN, RAMP, rampAt, type RGB } from "../lib/colors";

/** The 15-minute "as the crow flies" circle most 15-minute-city maps draw. */
export function circleLayer(id: string, center: [number, number], radiusM: number) {
  return new ScatterplotLayer<[number, number]>({
    id,
    data: [center],
    getPosition: (d) => d,
    getRadius: radiusM,
    radiusUnits: "meters",
    filled: true,
    getFillColor: [243, 239, 230, 10],
    stroked: true,
    getLineColor: [243, 239, 230, 150],
    lineWidthUnits: "pixels",
    getLineWidth: 1.5,
    parameters: { depthCompare: "always" },
  });
}

/** Regional travel time: short = luminous, long = dim (lo…hi minutes). */
export function regionalColor(min: number, lo = 40, hi = 160): RGB {
  if (!Number.isFinite(min)) return RAMP[0];
  return rampAt(1 - (Math.min(Math.max(min, lo), hi) - lo) / (hi - lo));
}

export function regionalHexLayer(id: string, data: Aggregate[], trigger: unknown, lo = 40, hi = 160) {
  return new H3HexagonLayer<Aggregate>({
    id,
    data,
    getHexagon: (d) => d.hex,
    getFillColor: (d) => {
      const c = regionalColor(d.value, lo, hi);
      return [c[0], c[1], c[2], 235];
    },
    extruded: false,
    coverage: 1,
    opacity: 0.85,
    stroked: false,
    highPrecision: false,
    updateTriggers: { getFillColor: [trigger, lo, hi] },
    transitions: { getFillColor: { duration: 700 } },
  });
}

/** Cells that become complete in a scenario light up; the rest keep a dim version of the ramp. */
export function gainHexLayer(id: string, data: (Aggregate & { gain: number })[], trigger: unknown) {
  return new H3HexagonLayer<Aggregate & { gain: number }>({
    id,
    data,
    getHexagon: (d) => d.hex,
    getFillColor: (d) => {
      if (d.gain > 0.05) return [GAIN[0], GAIN[1], GAIN[2], Math.round(120 + 135 * Math.min(1, d.gain * 1.6))];
      const c = RAMP[Math.max(0, Math.min(6, Math.round(d.value)))];
      return [c[0], c[1], c[2], 42];
    },
    coverage: 1,
    stroked: false,
    highPrecision: false,
    updateTriggers: { getFillColor: [trigger] },
    transitions: { getFillColor: { duration: 600 } },
  });
}

export interface SitePoint {
  lon: number;
  lat: number;
  rank: number;
  areaHa: number;
  newlyComplete: number;
}

export function sitesLayer(id: string, sites: SitePoint[], visibleRank: number) {
  return new ScatterplotLayer<SitePoint>({
    id,
    data: sites,
    getPosition: (d) => [d.lon, d.lat],
    getRadius: (d) => (d.rank <= visibleRank ? 5 + Math.min(7, Math.sqrt(d.areaHa) * 3) : 0),
    radiusUnits: "pixels",
    filled: true,
    getFillColor: [11, 14, 18, 230],
    stroked: true,
    getLineColor: [GAIN[0], GAIN[1], GAIN[2], 255],
    lineWidthUnits: "pixels",
    getLineWidth: 2,
    updateTriggers: { getRadius: [visibleRank] },
    transitions: { getRadius: { duration: 500 } },
    parameters: { depthCompare: "always" },
  });
}

export function hubsLayer(id: string, hubs: { lon: number; lat: number; kind: "rts" | "other" }[]) {
  return new ScatterplotLayer<{ lon: number; lat: number; kind: "rts" | "other" }>({
    id,
    data: hubs,
    getPosition: (d) => [d.lon, d.lat],
    getRadius: (d) => (d.kind === "rts" ? 8 : 6),
    radiusUnits: "pixels",
    filled: true,
    getFillColor: (d) => (d.kind === "rts" ? [GAIN[0], GAIN[1], GAIN[2], 255] : [243, 239, 230, 255]),
    stroked: true,
    getLineColor: [11, 14, 18, 255],
    lineWidthUnits: "pixels",
    getLineWidth: 2,
    parameters: { depthCompare: "always" },
  });
}
