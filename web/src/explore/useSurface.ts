import { useEffect, useMemo, useState } from "react";
import { aggregate, categoriesReached, NO_DATA, shares, type Aggregate, type Shares } from "../lib/access";
import { loadCells, loadScenario, loadVariants, type Cells } from "../lib/data";
import type { ExplorerState } from "../lib/store";

/** The subset of explorer state that changes the analysis (not the view). */
export type SurfaceParams = Pick<ExplorerState, "metric" | "threshold" | "speed" | "people" | "taxonomy" | "network" | "poiSource" | "scenario">;
import type { CityId, Meta } from "../lib/types";

export interface Surface {
  city: CityId;
  cells: Cells;
  /** per cell: categories reached (0…K, 255 = no data) or minutes to nearest */
  value: Float32Array;
  kind: "count" | "minutes";
  weights: Float32Array;
  shares: Shares | null;
  /** distance arrays actually used, by category (for the inspector) */
  d: Record<string, Float32Array>;
}

type Extra = { variants?: Awaited<ReturnType<typeof loadVariants>>; scenario?: Record<string, Float32Array> };

/** Load every table the current assumptions need, per city. */
function useTables(meta: Meta | null, s: SurfaceParams) {
  const [state, setState] = useState<Partial<Record<CityId, { cells: Cells } & Extra>>>({});
  const needVariants = s.taxonomy !== "core" || s.network !== "permissive" || s.poiSource !== "osm";
  const needScenario = s.scenario !== "none";
  useEffect(() => {
    if (!meta) return;
    let alive = true;
    (["sg", "jb"] as CityId[]).forEach(async (city) => {
      const cells = await loadCells(city);
      const [variants, scenario] = await Promise.all([
        needVariants ? loadVariants(city) : Promise.resolve(undefined),
        needScenario ? loadScenario(city) : Promise.resolve(undefined),
      ]);
      if (alive) setState((prev) => ({ ...prev, [city]: { cells, variants, scenario } }));
    });
    return () => {
      alive = false;
    };
  }, [meta, needVariants, needScenario]);
  return state;
}

export function pickDistances(t: { cells: Cells } & Extra, s: SurfaceParams, basket: string[]): Record<string, Float32Array> {
  const out: Record<string, Float32Array> = { ...t.cells.d };
  for (const k of basket) {
    let key: string | null = null;
    if (s.network === "strict") key = `${k}__netstrict`;
    else if (s.poiSource === "overture") key = `${k}__overture`;
    else if (s.taxonomy !== "core") key = `${k}__${s.taxonomy}`;
    if (key && t.variants?.d[key]) out[k] = t.variants.d[key];
    if (s.scenario !== "none" && t.scenario) {
      const n = s.scenario.replace("p2p", "");
      const sc = t.scenario[`${k}__p2p${n}`];
      if (sc) out[k] = sc;
    }
  }
  return out;
}

export function useSurfaces(meta: Meta | null, s: SurfaceParams): Partial<Record<CityId, Surface>> {
  const tables = useTables(meta, s);
  return useMemo(() => {
    if (!meta) return {};
    const speed = meta.accessibility.walk_speed_mps[s.speed];
    const out: Partial<Record<CityId, Surface>> = {};
    for (const city of ["sg", "jb"] as CityId[]) {
      const t = tables[city];
      if (!t) continue;
      const d = pickDistances(t, s, meta.basket);
      const weights = s.people === "elderly" ? t.cells.elderly : t.cells.pop;
      if (s.metric === "complete") {
        const r = categoriesReached(t.cells.n, d, meta.basket, speed, s.threshold);
        out[city] = { city, cells: t.cells, value: Float32Array.from(r), kind: "count", weights, shares: shares(r, weights, meta.basket.length), d };
      } else {
        const src = d[s.metric];
        const v = new Float32Array(t.cells.n);
        for (let i = 0; i < t.cells.n; i++) v[i] = Number.isNaN(src[i]) ? NaN : src[i] / speed / 60;
        out[city] = { city, cells: t.cells, value: v, kind: "minutes", weights, shares: null, d };
      }
    }
    return out;
  }, [meta, tables, s]);
}

export function resolutionForZoom(z: number): number {
  return z < 11 ? 8 : z < 12.8 ? 9 : 10;
}

/** Hexagon features for the current zoom (aggregated below resolution 10). */
export function useHexData(surfaces: Partial<Record<CityId, Surface>>, res: number): Aggregate[] {
  return useMemo(() => {
    const out: Aggregate[] = [];
    for (const sfc of Object.values(surfaces)) {
      if (!sfc) continue;
      if (res >= 10) {
        for (let i = 0; i < sfc.cells.n; i++) {
          const v = sfc.value[i];
          if (v === NO_DATA || Number.isNaN(v)) continue;
          out.push({ hex: sfc.cells.h3[i], value: v, pop: sfc.weights[i] });
        }
      } else {
        out.push(...aggregate(sfc.cells.h3, sfc.value, sfc.weights, res));
      }
    }
    return out;
  }, [surfaces, res]);
}
