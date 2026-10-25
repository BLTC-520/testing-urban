/** Response shapes from /server. Hand-written to mirror src/app.ts. */

export type CityId = "sg" | "jb";
export type SpeedId = "slow" | "base" | "brisk";
export type Cohort = "all" | "elderly" | "elderly_slow_walk";

export interface Essential {
  id: string;
  label: string;
  short: string;
  question: string;
  in_basket: number;
  sort_order: number;
}

export interface City {
  id: CityId;
  name: string;
  center_lon: number;
  center_lat: number;
  zoom: number;
  population: number | null;
  population_definition: string;
  non_residents: number | null;
}

export interface SummaryResponse {
  meta: {
    generated_utc: string;
    osm_snapshot: string;
    h3_resolution: number;
    basket: string[];
    speeds: Record<SpeedId, number>;
    thresholds: number[];
    headline_threshold_min: number;
    low_access_completeness: number;
    resolutions: number[];
  };
  cohort: Cohort;
  cities: City[];
  essentials: Essential[];
  metrics: Record<CityId, Record<string, number>>;
  series: Record<CityId, Record<string, { bucket: string; value: number }[]>>;
}

export interface Totals {
  population: number;
  population_on_network: number;
  share_complete: number;
  share_low_access: number;
  low_access_population: number;
  mean_categories: number;
}

export interface Hex {
  hex: string;
  pop: number;
  cells: number;
  share_complete: number;
  share_low: number;
  mean_categories: number;
}

export interface CellsResponse {
  query: { city: CityId; minutes: number; speed: SpeedId; speed_mps: number; res: number; scenario: string | null; unit: number | null };
  limit_m: number;
  totals: Totals;
  hexes: Hex[];
}

export interface PanelsResponse {
  query: { city: CityId; minutes: number; speed: SpeedId; scenario: string | null; unit: number | null };
  totals: Totals;
  histogram: { reached: number; pop: number; share: number }[];
  by_essential: { id: string; share_within: number }[];
  by_unit: { unit_idx: number; unit_id: string; unit_name: string; pop: number; share_complete: number; mean_categories: number }[];
}

export interface Scenario {
  id: string;
  city_id: CityId;
  family: string;
  label: string;
  sites: number;
  site_area_ha: number | null;
  share_complete_before: number;
  share_complete_after: number;
  share_low_before: number | null;
  share_low_after: number | null;
  low_access_pop_before: number | null;
  low_access_pop_after: number | null;
  newly_complete: number | null;
  delta_share_complete: number;
  delta_share_low: number | null;
}

export interface ScenariosResponse { scenarios: Scenario[] }

export interface FootpathLink {
  rank: number;
  is_chosen: boolean;
  city_id: CityId;
  a_lon: number; a_lat: number; a_street: string | null;
  b_lon: number; b_lat: number; b_street: string | null;
  mid_lon: number; mid_lat: number;
  link_m: number;
  walk_today_m: number;
  footbridge: boolean;
  unit_id: string | null;
  unit_name: string | null;
  place: string | null;
  metrics: Record<string, Record<string, number>>;
}

export interface FootpathResponse { links: FootpathLink[] }

export interface CellResponse {
  query: { city: CityId; minutes: number; speed: SpeedId; speed_mps: number; scenario: string | null };
  limit_m: number;
  cell: Record<string, number | string | null>;
  reached: string[];
  scenario: { distances: Record<string, number | null>; reached: string[] } | null;
}

/** The API's 400 body. */
export interface ApiErrorBody {
  error: string;
  message: string;
  details?: { field: string; message: string }[];
}
