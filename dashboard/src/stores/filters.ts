/**
 * The filter state every panel reads. One source of truth for what the screen
 * is currently showing, including landmark walk-focus mode and camera restore.
 *
 * React equivalent: a Zustand store (the React site uses one in
 * web/src/lib/store.ts). `state` here is Zustand's initial state, `getters` are
 * selectors, and `actions` are the setters — except that Pinia's state is a
 * reactive proxy, so an action mutates it in place instead of calling `set()`
 * with a new object.
 */
import { defineStore } from "pinia";
import type { CityId, SpeedId } from "../api/types.ts";
import type { Landmark } from "../map/landmarkTypes.ts";

/** What the map's hex click selected, if anything. */
export interface Selection {
  hex: string;
  /** Neighbourhood index, when the clicked hexagon falls inside one. */
  unit: number | null;
  unitName: string | null;
}

/** Camera posture saved on entering landmark focus, restored on exit. */
export interface CameraSnapshot {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

export type RightTab = "districts" | "landmarks";

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
    /** Callouts naming the landmarks the camera passes (map/landmarks.ts). */
    landmarks: true,
    selection: null as Selection | null,
    /** Active landmark in walk-focus mode, or null in whole-city mode. */
    focusedLandmark: null as Landmark | null,
    /** Camera posture before focus mode began, preserved across direct landmark switches. */
    savedCamera: null as CameraSnapshot | null,
    /** Layer flags before focus mode began. */
    savedBuildings: null as boolean | null,
    savedLandmarks: null as boolean | null,
    /** Active tab in the bottom-right table panel. */
    rightTab: "districts" as RightTab,
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
    isFocused: (s) => s.focusedLandmark !== null,
  },

  actions: {
    setCity(city: CityId) {
      if (city === this.city) return;
      if (this.focusedLandmark && this.focusedLandmark.city !== city) {
        this.exitFocus();
      }
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
    toggleLandmarks() { this.landmarks = !this.landmarks; },
    setRightTab(tab: RightTab) { this.rightTab = tab; },
    select(sel: Selection | null) {
      if (sel && this.focusedLandmark) this.exitFocus();
      // Clicking the selected hexagon again clears it.
      this.selection = sel && sel.hex === this.selection?.hex ? null : sel;
    },
    clearSelection() { this.selection = null; },

    /**
     * Enter landmark walk-focus mode, or switch directly to another landmark
     * while preserving the pre-focus camera and layer state.
     */
    focusLandmark(landmark: Landmark, camera?: CameraSnapshot | null, hasIonToken = false) {
      if (!this.focusedLandmark) {
        this.savedCamera = camera ? { ...camera, center: [camera.center[0], camera.center[1]] } : null;
        this.savedBuildings = this.buildings;
        this.savedLandmarks = this.landmarks;
      }
      if (landmark.city !== this.city) this.city = landmark.city;
      this.selection = null;
      this.focusedLandmark = landmark;
      this.landmarks = true;
      this.rightTab = "landmarks";
      if (hasIonToken && !this.buildings) this.buildings = true;
    },

    /** Leave focus mode and restore the previous camera and layer state. */
    exitFocus(): CameraSnapshot | null {
      if (!this.focusedLandmark) return null;
      const restored = this.savedCamera;
      if (this.savedBuildings !== null) this.buildings = this.savedBuildings;
      if (this.savedLandmarks !== null) this.landmarks = this.savedLandmarks;
      this.focusedLandmark = null;
      this.savedCamera = null;
      this.savedBuildings = null;
      this.savedLandmarks = null;
      return restored;
    },
  },
});
