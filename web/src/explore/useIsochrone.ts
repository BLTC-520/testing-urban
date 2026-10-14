import { useEffect, useRef, useState } from "react";
import { loadPois, type Pois } from "../lib/data";
import { StreetGraph, type Isochrone } from "../lib/streetGraph";
import type { CityId } from "../lib/types";

const BASE = import.meta.env.BASE_URL;
let graph: StreetGraph | null = null;
export function streetGraph(): StreetGraph {
  if (!graph) {
    graph = new StreetGraph(async (p) => {
      const r = await fetch(`${BASE}data/${p}`);
      if (!r.ok) throw new Error(`${p}: ${r.status}`);
      return r.arrayBuffer();
    });
  }
  return graph;
}

export interface Reached {
  /** category → nearest destination (minutes, name) */
  nearest: Record<string, { minutes: number; name: string; lon: number; lat: number } | null>;
  /** category → destinations within the threshold */
  counts: Record<string, number>;
  /** indices of POIs within the outer cutoff, with minutes */
  pois: { i: number; minutes: number }[];
}

export function reachedPois(iso: Isochrone, pois: Pois, speed: number, thresholdMin: number, detour = 1.3): Reached {
  const acc = pois.access!;
  const best = new Float64Array(pois.lon.length).fill(Infinity);
  for (let k = 0; k < acc.poi.length; k++) {
    const du = iso.distanceTo(acc.u[k]) + acc.offU[k];
    const dv = iso.distanceTo(acc.v[k]) + acc.offV[k];
    const d = Math.min(du, dv) + detour * acc.snap[k];
    if (d < best[acc.poi[k]]) best[acc.poi[k]] = d;
  }
  const nearest: Reached["nearest"] = {};
  const counts: Record<string, number> = {};
  const list: Reached["pois"] = [];
  pois.categories.forEach((c) => {
    nearest[c] = null;
    counts[c] = 0;
  });
  const limit = thresholdMin * 60 * speed;
  for (let i = 0; i < best.length; i++) {
    const d = best[i];
    if (!(d <= iso.cutoffM)) continue;
    const m = d / speed / 60;
    list.push({ i, minutes: m });
    pois.categories.forEach((c, bit) => {
      if (!(pois.mask[i] & (1 << bit))) return;
      if (d <= limit) counts[c]++;
      const cur = nearest[c];
      if (!cur || m < cur.minutes) nearest[c] = { minutes: m, name: pois.names?.[i] || "", lon: pois.lon[i], lat: pois.lat[i] };
    });
  }
  return { nearest, counts, pois: list };
}

export interface IsoState {
  status: "idle" | "loading" | "ready" | "offnetwork" | "error";
  iso: Isochrone | null;
  reached: Reached | null;
  /** animated reveal distance in metres */
  reveal: number;
}

/** Compute the walk-shed for a clicked point and animate its growth. */
export function useIsochrone(sel: { lon: number; lat: number; city: CityId | null } | null, speed: number, thresholdMin: number, maxMin = 20): IsoState {
  const [state, setState] = useState<IsoState>({ status: "idle", iso: null, reached: null, reveal: 0 });
  const raf = useRef(0);
  useEffect(() => {
    cancelAnimationFrame(raf.current);
    if (!sel || !sel.city) {
      setState({ status: "idle", iso: null, reached: null, reveal: 0 });
      return;
    }
    let alive = true;
    const cutoff = maxMin * 60 * speed;
    setState((s) => ({ ...s, status: "loading" }));
    (async () => {
      try {
        const [iso, pois] = await Promise.all([streetGraph().isochrone(sel.lon, sel.lat, cutoff), loadPois(sel.city!)]);
        if (!alive) return;
        if (!iso) {
          setState({ status: "offnetwork", iso: null, reached: null, reveal: 0 });
          return;
        }
        const reached = reachedPois(iso, pois, speed, thresholdMin);
        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        const t0 = performance.now();
        const dur = reduced ? 0 : 1800;
        const tick = (now: number) => {
          const p = dur ? Math.min(1, (now - t0) / dur) : 1;
          const eased = 1 - Math.pow(1 - p, 3);
          setState({ status: "ready", iso, reached, reveal: eased * cutoff });
          if (p < 1 && alive) raf.current = requestAnimationFrame(tick);
        };
        raf.current = requestAnimationFrame(tick);
      } catch (e) {
        console.error(e);
        if (alive) setState({ status: "error", iso: null, reached: null, reveal: 0 });
      }
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf.current);
    };
  }, [sel, speed, thresholdMin, maxMin]);
  return state;
}
