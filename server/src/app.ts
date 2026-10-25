/**
 * The read-only dashboard API.
 *
 * Exported as a builder rather than a running server so the tests can drive it
 * through `app.inject()` without binding a port.
 *
 * Security posture, in one place:
 *   · the SQLite handle is opened read-only, so no route can mutate the study
 *   · every query string is parsed by zod before it reaches SQL (src/schemas.ts)
 *   · all SQL is parameterised; see the rules at the top of src/queries.ts
 *   · helmet sets the usual headers; CSP is on only when this also serves the
 *     dashboard's HTML (dashboardDir) — for JSON alone it buys nothing
 *   · CORS is an explicit allowlist, not a reflection of Origin
 *   · rate limiting is per-IP
 *   · there are no secrets to leak: the API reads one local file and holds no
 *     credentials, so nothing needs to be kept out of the client
 *   · error responses carry a code and a message, never a stack or a SQL string
 */
import Fastify, { type FastifyInstance, type FastifyError } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { ZodError, type ZodType } from "zod";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { openStore, type Store, BASKET } from "./db.ts";
import { REPO } from "./paths.ts";
import { schemas } from "./schemas.ts";
import {
  hexQuery, totalsQuery, histogramQuery, byEssentialQuery, byUnitQuery,
  cellQuery, cellScenarioQuery,
  type Filters, type Resolution, type Source,
} from "./queries.ts";

export interface AppOptions {
  store?: Store;
  /** Browser origins allowed to call the API. Dev defaults cover both Vite ports. */
  allowedOrigins?: string[];
  /** Requests per minute per IP. */
  rateLimitMax?: number;
  logger?: boolean;
  /**
   * A built dashboard (dashboard/dist) to serve at /, for a single-origin
   * deployment. Unset in dev, where Vite serves the dashboard and proxies here.
   */
  dashboardDir?: string;
  /**
   * Behind a reverse proxy (Caddy, nginx, a load balancer), take the client IP
   * from X-Forwarded-For. Without it every request looks like the proxy, and
   * the per-IP rate limit becomes one limit shared by all visitors. Never set it
   * when exposed directly: the header would let any client pick its own IP.
   */
  trustProxy?: boolean;
}

/*
 * Only sent when serving the dashboard. Each source is here for a reason:
 *   · Google Fonts: index.html's stylesheet and the font files it points at
 *   · style 'unsafe-inline': Vue :style bindings and ECharts tooltips set
 *     inline styles; scripts stay strictly 'self'
 *   · blob: workers: MapLibre starts its tile workers from a blob URL
 *   · data:/blob: images: deck.gl and MapLibre upload textures that way
 *   · 'wasm-unsafe-eval': loaders.gl decodes compressed building meshes in
 *     WebAssembly. It permits compiling WASM only; JavaScript eval stays blocked
 *   · Cesium ion: api.cesium.com swaps the token for the tileset's address,
 *     assets.ion.cesium.com serves the 3D building tiles (dashboard/src/map/buildings.ts)
 */
const DASHBOARD_CSP = {
  useDefaults: false,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com"],
    imgSrc: ["'self'", "data:", "blob:"],
    connectSrc: ["'self'", "data:", "blob:", "https://api.cesium.com", "https://assets.ion.cesium.com"],
    workerSrc: ["'self'", "blob:"],
    childSrc: ["blob:"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  },
};

const DEV_ORIGINS = [
  "http://localhost:5174", "http://127.0.0.1:5174", // dashboard
  "http://localhost:5173", "http://127.0.0.1:5173", // existing React site
];

/** Parse a query string, turning a zod failure into a 400 with field detail. */
function parse<T>(schema: ZodType<T>, input: unknown): T {
  try {
    return schema.parse(input);
  } catch (err) {
    if (err instanceof ZodError) {
      const e = new Error("invalid query parameters") as Error & {
        statusCode: number; code: string; details: unknown;
      };
      e.statusCode = 400;
      e.code = "INVALID_QUERY";
      e.details = err.issues.flatMap((i) =>
        i.code === "unrecognized_keys"
          // zod reports these against the object, not the offending key, but a
          // typo like ?minute=15 is only actionable if the key is named.
          ? (i as unknown as { keys: string[] }).keys.map((k) => ({
              field: k,
              message: "unknown query parameter",
            }))
          : [{ field: i.path.join(".") || "(root)", message: i.message }],
      );
      throw e;
    }
    throw err;
  }
}

export interface App {
  app: FastifyInstance;
  store: Store;
  /** Close the HTTP server and the database handle. */
  close(): Promise<void>;
}

export async function buildApp(opts: AppOptions = {}): Promise<App> {
  const store = opts.store ?? openStore();
  const { db, settings } = store;
  const s = schemas(settings);

  // Fail at startup, not on the first visitor, if the dashboard was not built.
  if (opts.dashboardDir && !existsSync(join(opts.dashboardDir, "index.html"))) {
    throw new Error(`dashboardDir has no index.html: ${opts.dashboardDir} (run npm run build in dashboard/)`);
  }

  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: opts.trustProxy ?? false,
    routerOptions: {
      // Collapse duplicated params to the last value rather than handing zod an
      // array it would reject with a confusing message.
      querystringParser: (str: string) => Object.fromEntries(new URLSearchParams(str)),
    },
  });

  await app.register(helmet, {
    contentSecurityPolicy: opts.dashboardDir ? DASHBOARD_CSP : false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  const allowed = new Set(opts.allowedOrigins ?? DEV_ORIGINS);
  await app.register(cors, {
    // An allowlist, not `origin: true` — which would echo any Origin back and
    // make the allowlist decorative.
    origin: (origin, cb) => cb(null, !origin || allowed.has(origin)),
    methods: ["GET"],
    maxAge: 600,
  });

  await app.register(rateLimit, {
    max: opts.rateLimitMax ?? 300,
    timeWindow: "1 minute",
    // The dashboard polls one host; a shared limit is the point.
    keyGenerator: (req) => req.ip,
  });

  /*
   * The basemap and its glyphs.
   *
   * These are the same 47 MB basemap.pmtiles and font PBFs the React site
   * uses. Serving them from here rather than copying them into dashboard/
   * keeps one copy in the repository and works identically in dev (through
   * Vite's proxy) and in a single-origin deployment. `serve: false` on the
   * second registration is required because @fastify/static can only own one
   * decorator; both still serve their prefix.
   */
  await app.register(fastifyStatic, {
    root: resolve(REPO, "web", "public", "tiles"),
    prefix: "/basemap/",
    // pmtiles issues HTTP range requests for the parts of the archive it needs.
    acceptRanges: true,
    immutable: true,
    maxAge: "1d",
  });
  await app.register(fastifyStatic, {
    root: resolve(REPO, "web", "public", "fonts"),
    prefix: "/fonts/",
    decorateReply: false,
    immutable: true,
    maxAge: "7d",
  });
  /*
   * Walk-shed street-graph tiles and POI tables for landmark focus mode.
   * Only the files the walk engine reads are exposed under /data/.
   */
  const DATA_ALLOW = /^\/(?:graph\/(?:index\.json|t_\d+_\d+\.bin)|pois_(?:sg|jb)\.(?:bin|json)|poi_access_(?:sg|jb)\.bin)$/;
  await app.register(fastifyStatic, {
    root: resolve(REPO, "web", "public", "data"),
    prefix: "/data/",
    decorateReply: false,
    allowedPath: (pathName) => DATA_ALLOW.test(pathName),
    immutable: true,
    maxAge: "7d",
  });

  if (opts.dashboardDir) {
    await app.register(fastifyStatic, {
      root: opts.dashboardDir,
      prefix: "/",
      decorateReply: false,
      cacheControl: false,
      setHeaders(reply, path) {
        // Vite hashes every asset's filename, so a changed file is a new URL and
        // these can be cached forever. index.html is the one file that must be
        // re-checked, or a deploy would keep serving the old asset names.
        reply.header(
          "cache-control",
          path.endsWith(".html") ? "no-cache" : "public, max-age=31536000, immutable",
        );
      },
    });
  }

  // --- prepared statements, built once at startup ---------------------------
  const SOURCES: Source[] = ["baseline", "scenario"];
  const RESOLUTIONS: Resolution[] = [7, 8, 10];
  const hex = new Map<string, ReturnType<typeof hexQuery>>();
  for (const src of SOURCES) for (const r of RESOLUTIONS) hex.set(`${src}:${r}`, hexQuery(db, src, r));
  const totals = new Map(SOURCES.map((src) => [src, totalsQuery(db, src)]));
  const histogram = new Map(SOURCES.map((src) => [src, histogramQuery(db, src)]));
  const byEssential = new Map(SOURCES.map((src) => [src, byEssentialQuery(db, src)]));
  const byUnit = new Map(SOURCES.map((src) => [src, byUnitQuery(db, src)]));
  const oneCell = cellQuery(db);
  const oneCellScenario = cellScenarioQuery(db);

  const metricRows = db.prepare<[string, string], { metric: string; value: number }>(
    "SELECT metric, value FROM city_metrics WHERE city_id = ? AND cohort = ?",
  );
  const seriesRows = db.prepare<[string, string], { series: string; bucket: string; position: number; value: number }>(
    "SELECT series, bucket, position, value FROM city_series WHERE city_id = ? AND cohort = ? ORDER BY series, position",
  );
  const cityRows = db.prepare<[], Record<string, unknown>>("SELECT * FROM cities ORDER BY id");
  const essentialRows = db.prepare<[], Record<string, unknown>>(
    "SELECT id, label, short, question, in_basket, sort_order FROM essentials ORDER BY sort_order",
  );
  const scenarioRows = db.prepare<[string | null], Record<string, unknown>>(
    "SELECT * FROM scenarios WHERE (@city IS NULL OR city_id = @city) ORDER BY city_id, sites",
  );
  const footpathRows = db.prepare<[], Record<string, unknown>>(
    "SELECT * FROM footpath_links ORDER BY rank",
  );
  const footpathMetricRows = db.prepare<[], { rank: number; threshold: string; metric: string; value: number }>(
    "SELECT rank, threshold, metric, value FROM footpath_metrics ORDER BY rank, threshold, metric",
  );
  const neighbourhoodRows = db.prepare<[string | null], Record<string, unknown>>(
    "SELECT * FROM neighbourhoods WHERE (@city IS NULL OR city_id = @city) ORDER BY city_id, unit_name",
  );

  /** Turn validated inputs into the bound parameters every filtered query takes. */
  const filters = (q: { city: string; minutes: number; speed: string; scenario?: string; unit?: number }): Filters & { source: Source } => ({
    city: q.city,
    limit: q.minutes * 60 * settings.speeds[q.speed],
    scenario: q.scenario ?? null,
    unit: q.unit ?? null,
    source: q.scenario ? "scenario" : "baseline",
  });

  // --- routes ---------------------------------------------------------------

  app.get("/api/health", async () => ({
    ok: true,
    generated_utc: settings.generatedUtc,
    osm_snapshot: settings.osmSnapshot,
  }));

  /**
   * Everything the dashboard needs to boot: the cities, the essentials, the
   * control presets, and the pipeline's published metrics and series. Static
   * for a given database, so it is fetched once.
   */
  app.get("/api/summary", async (req) => {
    const q = parse(s.summary, req.query);
    const cities = q.city ? [q.city] : settings.cities;
    return {
      meta: {
        generated_utc: settings.generatedUtc,
        osm_snapshot: settings.osmSnapshot,
        h3_resolution: settings.h3Resolution,
        basket: BASKET,
        speeds: settings.speeds,
        thresholds: settings.thresholds,
        headline_threshold_min: settings.headlineThreshold,
        low_access_completeness: settings.lowAccessCompleteness,
        resolutions: settings.resolutions,
      },
      cohort: q.cohort,
      cities: cityRows.all().filter((c) => cities.includes(c.id as typeof cities[number])),
      essentials: essentialRows.all(),
      metrics: Object.fromEntries(
        cities.map((city) => [
          city,
          Object.fromEntries(metricRows.all(city, q.cohort).map((r) => [r.metric, r.value])),
        ]),
      ),
      series: Object.fromEntries(
        cities.map((city) => {
          const out: Record<string, { bucket: string; value: number }[]> = {};
          for (const r of seriesRows.all(city, q.cohort)) {
            (out[r.series] ??= []).push({ bucket: r.bucket, value: r.value });
          }
          return [city, out];
        }),
      ),
    };
  });

  /**
   * The map surface, plus the panels that have to agree with it.
   *
   * Thresholds per resolution-10 cell, then aggregates to the requested parent
   * resolution. res=10 is allowed but returns the raw grid (tens of thousands
   * of rows) and is there for a single-neighbourhood drill-down, not the
   * city view.
   */
  app.get("/api/cells", async (req, reply) => {
    const q = parse(s.cells, req.query);
    const f = filters(q);
    if (q.res === 10 && q.unit === undefined) {
      reply.code(400);
      return {
        error: "INVALID_QUERY",
        message: "res=10 returns the raw grid; pass `unit` to scope it to one neighbourhood",
        details: [{ field: "res", message: "resolution 10 requires a unit filter" }],
      };
    }
    const rows = hex.get(`${f.source}:${q.res}`)!.all(f);
    const t = totals.get(f.source)!.get(f);
    return {
      query: { city: q.city, minutes: q.minutes, speed: q.speed, speed_mps: settings.speeds[q.speed], res: q.res, scenario: q.scenario ?? null, unit: q.unit ?? null },
      limit_m: f.limit,
      totals: t,
      hexes: rows.map((r) => ({
        hex: r.hex,
        pop: r.pop,
        cells: r.cells,
        // Round at the edge: four decimals is well past what a colour ramp can
        // show, and it roughly halves the payload.
        share_complete: round(r.share_complete, 4),
        share_low: round(r.share_low, 4),
        mean_categories: round(r.mean_categories, 3),
      })),
    };
  });

  /** The chart panels under the current filters: distribution, categories, districts. */
  app.get("/api/panels", async (req) => {
    const q = parse(s.cells, req.query);
    const f = filters(q);
    const hist = histogram.get(f.source)!.all(f);
    const total = hist.reduce((a, r) => a + r.pop, 0);
    const essentials = byEssential.get(f.source)!.get(f) ?? {};
    return {
      query: { city: q.city, minutes: q.minutes, speed: q.speed, scenario: q.scenario ?? null, unit: q.unit ?? null },
      totals: totals.get(f.source)!.get(f),
      histogram: Array.from({ length: BASKET.length + 1 }, (_, reached) => {
        const row = hist.find((r) => r.reached === reached);
        return { reached, pop: row?.pop ?? 0, share: total > 0 ? round((row?.pop ?? 0) / total, 6) : 0 };
      }),
      by_essential: BASKET.map((id) => ({ id, share_within: round(essentials[id] ?? 0, 6) })),
      by_unit: byUnit.get(f.source)!.all(f).map((r) => ({
        unit_idx: r.unit_idx,
        unit_id: r.unit_id,
        unit_name: r.unit_name,
        pop: r.pop,
        share_complete: round(r.share_complete, 6),
        mean_categories: round(r.mean_categories, 3),
      })),
    };
  });

  /**
   * The Parking-to-Proximity runs with the pipeline's own before/after figures,
   * so the dashboard's deltas match the published study rather than being
   * independently derived.
   */
  app.get("/api/scenarios", async (req) => {
    const q = parse(s.scenarios, req.query);
    const rows = scenarioRows.all({ city: q.city ?? null } as never);
    return {
      scenarios: rows.map((r) => ({
        ...r,
        delta_share_complete: round((r.share_complete_after as number) - (r.share_complete_before as number), 6),
        delta_share_low: r.share_low_after !== null && r.share_low_before !== null
          ? round((r.share_low_after as number) - (r.share_low_before as number), 6)
          : null,
      })),
    };
  });

  /** The one-footpath case study. */
  app.get("/api/footpath", async (req) => {
    const q = parse(s.footpath, req.query);
    const links = footpathRows.all().filter((l) => q.alternatives || l.is_chosen === 1);
    const ranks = new Set(links.map((l) => l.rank as number));
    const metrics: Record<number, Record<string, Record<string, number>>> = {};
    for (const m of footpathMetricRows.all()) {
      if (!ranks.has(m.rank)) continue;
      ((metrics[m.rank] ??= {})[m.threshold] ??= {})[m.metric] = m.value;
    }
    return {
      links: links.map((l) => ({ ...l, footbridge: l.footbridge === 1, is_chosen: l.is_chosen === 1, metrics: metrics[l.rank as number] ?? {} })),
    };
  });

  /** The neighbourhood polygons' attributes, for the district table and labels. */
  app.get("/api/neighbourhoods", async (req) => {
    const q = parse(s.scenarios, req.query);
    return { neighbourhoods: neighbourhoodRows.all({ city: q.city ?? null } as never) };
  });

  /** One hexagon, for the inspector panel the map's click handler drives. */
  app.get("/api/cell/:h3", async (req, reply) => {
    const p = parse(s.cellParams, req.params);
    const q = parse(s.cellQuery, req.query);
    const row = oneCell.get({ city: q.city, h3: p.h3 });
    if (!row) {
      reply.code(404);
      return { error: "NOT_FOUND", message: `no cell ${p.h3} in ${q.city}` };
    }
    const limit = q.minutes * 60 * settings.speeds[q.speed];
    const after = q.scenario
      ? oneCellScenario.get({ city: q.city, h3: p.h3, scenario: q.scenario })
      : undefined;
    const reached = (d: Record<string, unknown>) =>
      BASKET.filter((k) => {
        const v = d[`d_${k}`];
        return typeof v === "number" && v <= limit;
      });
    return {
      query: { city: q.city, minutes: q.minutes, speed: q.speed, speed_mps: settings.speeds[q.speed], scenario: q.scenario ?? null },
      limit_m: limit,
      cell: row,
      reached: reached(row),
      scenario: after ? { distances: after, reached: reached(after) } : null,
    };
  });

  // --- errors ---------------------------------------------------------------
  app.setNotFoundHandler(async (req, reply) => {
    reply.code(404);
    return { error: "NOT_FOUND", message: `no route ${req.method} ${req.url}` };
  });

  app.setErrorHandler(async (err: FastifyError, req, reply) => {
    const status = err.statusCode ?? 500;
    const code = err.code;
    if (status === 400 && code === "INVALID_QUERY") {
      reply.code(400);
      return { error: code, message: err.message, details: (err as { details?: unknown }).details };
    }
    if (status === 429) {
      reply.code(429);
      return { error: "RATE_LIMITED", message: "too many requests" };
    }
    if (status < 500) {
      reply.code(status);
      return { error: code ?? "BAD_REQUEST", message: err.message };
    }
    // Log the detail, return none: a stack or a SQL fragment is a gift to an attacker.
    req.log.error({ err }, "unhandled error");
    reply.code(500);
    return { error: "INTERNAL", message: "internal error" };
  });

  return {
    app,
    store,
    async close() {
      await app.close();
      store.close();
    },
  };
}

/** Trim float noise at the response edge; `n` decimals, nulls preserved. */
function round(v: number | null | undefined, n: number): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const f = 10 ** n;
  return Math.round(v * f) / f;
}
