export type CityId = "sg" | "jb";
export type CategoryId = "groceries" | "healthcare" | "education" | "green_space" | "transit" | "dining";
export type SupplementaryId = "rapid_transit" | "civic";

export interface CategoryMeta {
  id: string;
  label: string;
  short: string;
  question: string;
  basket: boolean;
  /** OSM tag=value lists per nested taxonomy variant (strict ⊂ core ⊂ broad) */
  includes?: { strict: string[]; core: string[]; broad: string[] };
  min_area_m2?: { strict: number; core: number; broad: number } | null;
}

export interface SourceMeta {
  id: string;
  name: string;
  provider: string;
  url: string;
  licence: string;
  attribution: string;
  class: "observed" | "modelled" | "assumed";
  used_for: string[];
  snapshot?: string;
}

export interface BorderRegime {
  clearance_min_per_country: number;
  causeway_ride_min: number;
}

export interface Meta {
  title: string;
  version: string;
  generated_utc: string;
  osm_snapshot: string;
  basket: CategoryId[];
  categories: CategoryMeta[];
  accessibility: {
    walk_speed_mps: { base: number; slow: number; brisk: number };
    thresholds_min: number[];
    headline_threshold_min: number;
    gravity_half_life_min: number;
    low_access_completeness: number;
  };
  crossborder: {
    border_regimes: Record<"low" | "central" | "high", BorderRegime>;
    baseline_bus: { headway_min: number; checkpoint_to_mrt_min: number; label: string };
    baseline_rail: { ride_min: number; planned_wait_min: number; woodlands_ciq_to_mrt_min: number; label: string };
    rts: { ride_min: number; peak_headway_min: number; transfer_to_mrt_min: number; capacity_pphpd: number; label: string };
    av_feeder: {
      wait_min: { low: number; central: number; high: number };
      label: string;
      precedent: string;
      walk_to_pickup_max_min: number;
      peak_speed_factor: number;
      pooling_detour: number;
      dropoff_walk_min: number;
    };
  };
  parking_to_proximity: { sites_per_city: number[]; hub_program: string[]; min_site_area_m2: number; label: string };
  cities: Record<CityId, { name: string; center: [number, number]; zoom: number; population_definition: string }>;
  hubs: Record<string, { lon: number; lat: number; name: string; osm: string | null }>;
  sources: SourceMeta[];
}

export interface CitySummaryBlock {
  population: number;
  population_on_network: number;
  share_complete: number;
  share_low_access: number;
  low_access_population: number;
  mean_categories: number;
  median_categories: number;
  categories_p10: number;
  categories_p90: number;
  share_complete_by_threshold: Record<string, number>;
  share_complete_by_speed: Record<string, number>;
  categories_histogram: number[];
  gini_categories: number;
  gravity_index_median?: number;
  gravity_index_p10?: number;
  gravity_index_p90?: number;
  gravity_gini?: number;
  [key: string]: unknown;
}

export interface Summary {
  basket: CategoryId[];
  cities: Record<
    CityId,
    {
      all: CitySummaryBlock;
      elderly: CitySummaryBlock;
      elderly_slow_walk: CitySummaryBlock;
      supplementary: { rapid_transit_within_10: number; rapid_transit_median_min: number; civic_within_15: number };
    }
  >;
  neighbourhoods: NeighbourhoodStats[];
  sensitivity: {
    runs: number;
    findings: { finding: string; statement: string; share_of_runs: number; runs: number; label: string; category?: string }[];
    range: Record<string, [number, number]>;
    grid?: {
      speed: number;
      threshold: number;
      taxonomy: string;
      network: string;
      population: string;
      sg_share_complete: number;
      jb_share_complete: number;
      sg_share_low: number;
      jb_share_low: number;
    }[];
  };
  poi_source_overture?: Record<CityId, CitySummaryBlock>;
  form?: Record<CityId, Record<string, number>>;
  audit: {
    bus_stops: Record<string, number | string>[];
    rail_stations: Record<string, number | string>[];
    poi_cross_source: Record<string, number | string>[];
    population: Record<string, number | string>[];
  };
  scenarios: {
    parking?: Record<
      CityId,
      {
        before: { share_complete: number; share_low_access: number; low_access_population: number; population_on_network: number };
        after: Record<string, { share_complete: number; share_low_access: number; newly_complete: number; low_access_population: number; sites: number; site_area_ha: number }>;
      }
    >;
    rts?: Record<string, Record<string, unknown>>;
  };
}

export interface NeighbourhoodStats {
  unit_id: string;
  unit_name: string;
  city: CityId;
  population: number;
  elderly: number;
  share_complete: number;
  share_low_access: number;
  low_access_population: number;
  mean_categories: number;
  elderly_share_complete: number | null;
  elderly_share_complete_slow: number | null;
  weakest_category: CategoryId;
  weakest_share: number;
  area_km2: number;
  [key: string]: unknown;
}
