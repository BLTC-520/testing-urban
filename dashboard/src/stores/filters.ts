/**
 * The filter state every panel reads. One source of truth for what the screen
 * is currently showing.
 *
 * React equivalent: a Zustand store (the React site uses one in
 * web/src/lib/store.ts). `state` here is Zustand's initial state, `getters` are
 * selectors, and `actions` are the setters — except that Pinia's state is a
 * reactive proxy, so an action mutates it in place instead of calling `set()`
 * with a new object.
 */
import { defineStore } from "pinia";
import type { CityId, SpeedId } from "../api/types.ts";

/** What the map's hex click selected, if anything. */
export interface Selection {
  hex: string;
  /** Neighbourhood index, when the clicked hexagon falls inside one. */
  unit: number | null;
  unitName: string | null;
}

export const useFilters = defineStore("filters", {
  state: () => ({
    city: "sg" as CityId,
    minutes: 15,
    speed: "base" as SpeedId,
    /** null = observed baseline; otherwise a Parking-to-Proximity run id. */
    scenario: null as string | null,
    /** Show the scenario's change rather than its absolute level. */
    showDelta: false,
    /** H3 resolution the map aggregates to. */
    res: 8,
    /** Cesium OSM Buildings under flattened hexagons (needs an ion token). */
    buildings: false,
    selection: null as Selection | null,
  }),

  getters: {
    /** The query object the three filter-driven endpoints take. */
    query: (s) => ({
      city: s.city,
      minutes: s.minutes,
      speed: s.speed,
      scenario: s.scenario,
    }),
    cellsQuery(): { city: CityId; minutes: number; speed: SpeedId; res: number; scenario: string | null } {
      return { ...this.query, res: this.res };
    },
    /** Panels follow the map selection: clicking a hexagon scopes them to its district. */
    panelsQuery(): { city: CityId; minutes: number; speed: SpeedId; scenario: string | null; unit: number | null } {
      return { ...this.query, unit: this.selection?.unit ?? null };
    },
    isScenario: (s) => s.scenario !== null,
  },

  actions: {
    setCity(city: CityId) {
      if (city === this.city) return;
      this.city = city;
      // A hexagon belongs to one city, so the selection cannot survive the switch.
      this.selection = null;
    },
    setMinutes(minutes: number) {
      this.minutes = Math.min(60, Math.max(1, Math.round(minutes)));
    },
    setSpeed(speed: SpeedId) { this.speed = speed; },
    setScenario(scenario: string | null) {
      this.scenario = scenario;
      if (scenario === null) this.showDelta = false;
    },
    toggleDelta() { this.showDelta = !this.showDelta; },
    toggleBuildings() { this.buildings = !this.buildings; },
    select(sel: Selection | null) {
      // Clicking the selected hexagon again clears it.
      this.selection = sel && sel.hex === this.selection?.hex ? null : sel;
    },
    clearSelection() { this.selection = null; },
  },
});
