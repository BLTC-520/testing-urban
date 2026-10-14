import { useEffect, useState } from "react";

/** Scenario 3 — one footpath (written by `python -m sgjb.pipeline footpath`). */
export type XY = [number, number];

export interface FootpathScores {
  residents_gaining: number;
  newly_complete: number;
  essentials_gained: number;
  [gain: `gain_${string}`]: number;
}

export interface FootpathSite {
  a: { lon: number; lat: number; street: string };
  b: { lon: number; lat: number; street: string };
  mid: { lon: number; lat: number };
  link_m: number;
  walk_today_m: number | null;
  footbridge: boolean;
  unit_id: string;
  unit_name: string;
  place: string | null;
  metrics: Record<"10min" | "15min" | "20min" | "15min_slow" | "15min_brisk", FootpathScores>;
}

export interface FootpathRouteLeg {
  xy: XY[];
  length_m: number;
  minutes: number;
  uses_link: boolean;
  destination: { name: string; kind: string };
}

export interface FootpathRoute {
  essential: string;
  home: { lon: number; lat: number };
  residents: number;
  unit_id: string;
  before: FootpathRouteLeg;
  after: FootpathRouteLeg;
}

export interface Footpath {
  question: string;
  city: string;
  parameters: { max_link_m: number; min_saving_m: number; building_clearance_m: number; report_radius_m: number; walk_speed_mps: number; threshold_min: number };
  assumptions: string[];
  site_checks: string[];
  screening: { dead_ends_paired: number; rejected_by: Record<string, number>; passed_desk_filters: number; with_any_gain: number };
  validation: { baseline_cells: number; baseline_max_abs_diff_m: number; baseline_same_reach_15min: number; routes_match_engine: boolean };
  chosen: FootpathSite & {
    changes: {
      residents_considered: number;
      residents_walk_5min_shorter: number;
      by_essential: { essential: string; residents_newly_within_15min: number; median_minutes_before: number | null; median_minutes_after: number | null }[];
      essentials_reached: { before: Record<string, number>; after: Record<string, number> };
    };
  };
  alternatives: FootpathSite[];
  routes: FootpathRoute[];
  figure: {
    width_m: number;
    height_m: number;
    box: [number, number, number, number];
    streets: { major: XY[][]; minor: XY[][]; path: XY[][] };
    buildings: XY[][];
    water: XY[][];
    waterways: XY[][];
    hexes: { ring: XY[]; pop: number; before: number; after: number }[];
    pois: { xy: XY; essential: string; name: string }[];
    link: XY[];
  };
}

let cached: Promise<Footpath> | null = null;
let loaded: Footpath | null = null;

export function loadFootpath(): Promise<Footpath> {
  if (!cached) {
    cached = fetch(`${import.meta.env.BASE_URL}data/footpath.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`footpath.json: HTTP ${r.status}`);
        return r.json() as Promise<Footpath>;
      })
      .then((d) => (loaded = d));
    cached.catch(() => (cached = null));
  }
  return cached;
}

/** The scenario once `enabled` turns true (e.g. when the reader gets close). */
export function useFootpath(enabled = true): Footpath | null {
  const [fp, setFp] = useState<Footpath | null>(loaded);
  useEffect(() => {
    if (!enabled || fp) return;
    let alive = true;
    loadFootpath()
      .then((d) => alive && setFp(d))
      .catch((e) => console.warn(e));
    return () => {
      alive = false;
    };
  }, [enabled, fp]);
  return fp;
}

/** Modelled head counts: two significant figures ("about 2,200"), never false precision. */
export function about(x: number): string {
  if (!Number.isFinite(x)) return "–";
  if (x < 100) return String(Math.round(x / 10) * 10);
  const mag = 10 ** (Math.floor(Math.log10(x)) - 1);
  return (Math.round(x / mag) * mag).toLocaleString("en-GB");
}
