import { create } from "zustand";
import type { CategoryId, CityId } from "./types";

export type MetricId = "complete" | CategoryId | "rapid_transit" | "civic";
export type SpeedKey = "slow" | "base" | "brisk";
export type Variant = "core" | "strict" | "broad";
export type ScenarioId = "none" | "p2p10" | "p2p25" | "p2p50";

export interface Selection {
  lon: number;
  lat: number;
  city: CityId | null;
}

export interface ExplorerState {
  metric: MetricId;
  threshold: number;
  speed: SpeedKey;
  people: "all" | "elderly";
  taxonomy: Variant;
  network: "permissive" | "strict";
  poiSource: "osm" | "overture";
  scenario: ScenarioId;
  showPois: boolean;
  showUnits: boolean;
  zoom: number;
  selection: Selection | null;
  set: (p: Partial<ExplorerState>) => void;
}

export const useExplorer = create<ExplorerState>((set) => ({
  metric: "complete",
  threshold: 15,
  speed: "base",
  people: "all",
  taxonomy: "core",
  network: "permissive",
  poiSource: "osm",
  scenario: "none",
  showPois: true,
  showUnits: true,
  zoom: 10,
  selection: null,
  set: (p) => set(p),
}));

/** Assumptions differ from the published baseline? (shown as a warning chip) */
export function isNonBaseline(s: ExplorerState): boolean {
  return s.taxonomy !== "core" || s.network !== "permissive" || s.poiSource !== "osm" || s.speed !== "base" || s.threshold !== 15;
}

// exposed for end-to-end tests
if (typeof window !== "undefined") (window as unknown as { __explorer?: typeof useExplorer }).__explorer = useExplorer;
