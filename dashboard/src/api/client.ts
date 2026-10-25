/**
 * Typed fetch wrapper.
 *
 * Two jobs beyond calling fetch:
 *
 *   · Cancellation. The filters change faster than the network answers, so each
 *     call is tagged with a key and a newer call for the same key aborts the one
 *     in flight. Without this a slow response for 10 minutes can land after a
 *     fast one for 15 and quietly repaint the screen with stale numbers.
 *
 *   · Caching. /api/cells is a pure function of (city, minutes, speed, res,
 *     scenario, unit), all drawn from small closed sets, so the response for a
 *     given query never changes while the page is open. Dragging the minutes
 *     slider back and forth therefore costs one request per distinct value, not
 *     one per move.
 */
import type {
  CellResponse, CellsResponse, FootpathResponse, PanelsResponse,
  ScenariosResponse, SummaryResponse, ApiErrorBody,
} from "./types.ts";

/** Same-origin in dev (Vite proxies /api) and in a single-origin deployment. */
const BASE = import.meta.env.VITE_API_BASE ?? "";

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: ApiErrorBody | string) {
    super(typeof body === "string" ? body : `${body.error}: ${body.message}`);
    this.name = "ApiError";
  }
  /** Field-level detail from a validation failure, for showing beside a control. */
  get fields(): { field: string; message: string }[] {
    return typeof this.body === "string" ? [] : (this.body.details ?? []);
  }
}

const cache = new Map<string, unknown>();
const inflight = new Map<string, AbortController>();

function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined) u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

async function get<T>(path: string, opts: { key?: string; cache?: boolean } = {}): Promise<T> {
  const url = `${BASE}${path}`;
  const useCache = opts.cache ?? true;
  if (useCache && cache.has(url)) return cache.get(url) as T;

  // Supersede any request still in flight under the same key.
  const key = opts.key ?? path.split("?")[0];
  inflight.get(key)?.abort();
  const ctrl = new AbortController();
  inflight.set(key, ctrl);

  let res: Response;
  try {
    res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
  } finally {
    if (inflight.get(key) === ctrl) inflight.delete(key);
  }

  if (!res.ok) {
    let body: ApiErrorBody | string;
    try { body = (await res.json()) as ApiErrorBody; } catch { body = await res.text(); }
    throw new ApiError(res.status, body);
  }
  const data = (await res.json()) as T;
  if (useCache) cache.set(url, data);
  return data;
}

/** Shared filter shape for the three filter-driven endpoints. */
export interface CellFilters {
  city: string;
  minutes: number;
  speed: string;
  res?: number;
  scenario?: string | null;
  unit?: number | null;
}

export const api = {
  summary: (cohort?: string) =>
    get<SummaryResponse>(`/api/summary${qs({ cohort })}`, { key: "summary" }),

  cells: (f: CellFilters) =>
    get<CellsResponse>(`/api/cells${qs({ ...f })}`, { key: "cells" }),

  panels: (f: Omit<CellFilters, "res">) =>
    get<PanelsResponse>(`/api/panels${qs({ ...f })}`, { key: "panels" }),

  scenarios: (city?: string) =>
    get<ScenariosResponse>(`/api/scenarios${qs({ city })}`, { key: "scenarios" }),

  footpath: (alternatives = false) =>
    get<FootpathResponse>(`/api/footpath${qs({ alternatives })}`, { key: "footpath" }),

  cell: (h3: string, f: Omit<CellFilters, "res" | "unit">) =>
    get<CellResponse>(`/api/cell/${encodeURIComponent(h3)}${qs({ ...f })}`, { key: "cell" }),
};
