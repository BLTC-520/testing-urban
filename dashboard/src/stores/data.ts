/**
 * Everything fetched from the API, and the rules for when to refetch.
 *
 * React equivalent: this is what TanStack Query would do — keyed caches, an
 * in-flight flag, a retained previous value so the screen does not blank while
 * a new query resolves. Written by hand here because the dependency graph is
 * small and explicit, and because `watch` on a Pinia getter gives the same
 * "refetch when the key changes" behaviour in six lines.
 */
import { defineStore } from "pinia";
import { latLngToCell } from "h3-js";
import { api, ApiError } from "../api/client.ts";
import type {
  CellsResponse, FootpathResponse, PanelsResponse, Scenario, SummaryResponse,
} from "../api/types.ts";
import { useFilters } from "./filters.ts";

export const useData = defineStore("data", {
  state: () => ({
    summary: null as SummaryResponse | null,
    cells: null as CellsResponse | null,
    panels: null as PanelsResponse | null,
    scenarios: [] as Scenario[],
    footpath: null as FootpathResponse | null,
    /** Baseline panels and hexes, kept alongside the scenario so deltas need no
     *  second store and no second component. */
    baselinePanels: null as PanelsResponse | null,
    baselineCells: null as CellsResponse | null,
    loading: 0,
    error: null as string | null,
  }),

  getters: {
    ready: (s) => s.summary !== null && s.cells !== null && s.panels !== null,
    busy: (s) => s.loading > 0,
    /** Scenario runs for the city on screen, cheapest first. */
    cityScenarios(): Scenario[] {
      const f = useFilters();
      return this.scenarios.filter((x) => x.city_id === f.city).sort((a, b) => a.sites - b.sites);
    },
    activeScenario(): Scenario | null {
      const f = useFilters();
      return this.cityScenarios.find((x) => x.id === f.scenario) ?? null;
    },
  },

  actions: {
    /** Run a fetch with the busy counter and a shared error slot. Aborts are not errors. */
    async track<T>(load: () => Promise<T>): Promise<T | null> {
      this.loading++;
      try {
        const v = await load();
        this.error = null;
        return v;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return null;
        this.error = err instanceof ApiError ? err.message : (err as Error).message;
        return null;
      } finally {
        this.loading--;
      }
    },

    async loadStatic() {
      const [summary, scenarios, footpath] = await Promise.all([
        this.track(() => api.summary()),
        this.track(() => api.scenarios()),
        this.track(() => api.footpath(true)),
      ]);
      if (summary) this.summary = summary;
      if (scenarios) this.scenarios = scenarios.scenarios;
      if (footpath) this.footpath = footpath;
    },

    /**
     * Is this response still the one the screen is asking for?
     *
     * Aborting a superseded request is not enough on its own, because a cached
     * response resolves immediately without going through the abort path. So a
     * slow sequence started for Singapore can finish *after* a fast cached one
     * for Johor Bahru and overwrite it — which showed up as a scenario delta of
     * −39.5 points, Johor Bahru's scenario against Singapore's baseline.
     *
     * Every response echoes the query it answered, so the fix is to compare it
     * against the live filters and drop anything stale. This is the same
     * invariant a query library enforces with its query key.
     */
    isCurrent(q: { city: string; minutes: number; speed: string }, scenario?: string | null): boolean {
      const f = useFilters();
      return (
        q.city === f.city &&
        q.minutes === f.minutes &&
        q.speed === f.speed &&
        (scenario === undefined || scenario === f.scenario)
      );
    },

    async loadCells() {
      const f = useFilters();
      const v = await this.track(() => api.cells(f.cellsQuery));
      if (v && this.isCurrent(v.query, v.query.scenario)) this.cells = v;
      // The map's delta mode needs the same hexes without the scenario. Cached
      // client-side, so toggling a scenario costs one request the first time.
      if (f.scenario) {
        const b = await this.track(() => api.cells({ ...f.cellsQuery, scenario: null }));
        // The baseline's own `scenario` is null by construction, so only the
        // city and the controls are compared.
        if (b && this.isCurrent(b.query)) this.baselineCells = b;
      } else {
        this.baselineCells = null;
      }
    },

    /**
     * Which neighbourhood a clicked parent hexagon sits in.
     *
     * A parent hexagon spans many resolution-10 cells and the district is a
     * property of those, so this asks the API for the one cell nearest the
     * parent's centre and reads its unit off that. One request per click.
     */
    async lookupUnit(lat: number, lng: number): Promise<{ unit: number; unitName: string } | null> {
      const f = useFilters();
      const h3 = latLngToCell(lat, lng, 10);
      const v = await this.track(() =>
        api.cell(h3, { city: f.city, minutes: f.minutes, speed: f.speed, scenario: f.scenario }),
      );
      const idx = v?.cell.unit_idx;
      const name = v?.cell.unit_name;
      return typeof idx === "number" && typeof name === "string" ? { unit: idx, unitName: name } : null;
    },

    async loadPanels() {
      const f = useFilters();
      const v = await this.track(() => api.panels(f.panelsQuery));
      if (v && this.isCurrent(v.query, v.query.scenario)) this.panels = v;
      // A scenario is only meaningful against its baseline, so fetch both. The
      // client caches, so flipping a scenario on and off costs nothing after
      // the first time.
      if (f.scenario) {
        const b = await this.track(() => api.panels({ ...f.panelsQuery, scenario: null }));
        if (b && this.isCurrent(b.query)) this.baselinePanels = b;
      } else {
        this.baselinePanels = null;
      }
    },

    async loadAll() {
      await Promise.all([this.loadCells(), this.loadPanels()]);
    },
  },
});
