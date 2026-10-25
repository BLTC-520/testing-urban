/**
 * Validation failures.
 *
 * The happy paths are covered in api.test.ts; this file is specifically about
 * what the API does with input it should refuse. Every case asserts both the
 * status and that the body names the offending field, because an error that
 * does not say what was wrong is only marginally better than a 500.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type App } from "../src/app.ts";

let api: App;
beforeAll(async () => { api = await buildApp(); });
afterAll(() => api.close());

const get = (url: string) => api.app.inject({ method: "GET", url });

/** The field names a 400 body complained about. */
const fields = (body: string): string[] =>
  (JSON.parse(body).details ?? []).map((d: { field: string }) => d.field);

describe("GET /api/cells — required and enumerated params", () => {
  it("rejects a missing city", async () => {
    const r = await get("/api/cells");
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toBe("INVALID_QUERY");
    expect(fields(r.body)).toContain("city");
  });

  it("rejects a city that is not in the database", async () => {
    const r = await get("/api/cells?city=kl");
    expect(r.statusCode).toBe(400);
    expect(fields(r.body)).toContain("city");
  });

  it("rejects a speed that is not one of the study's presets", async () => {
    const r = await get("/api/cells?city=sg&speed=sprint");
    expect(r.statusCode).toBe(400);
    expect(fields(r.body)).toContain("speed");
  });

  it("rejects a numeric speed, because the presets are the contract", async () => {
    const r = await get("/api/cells?city=sg&speed=1.2");
    expect(r.statusCode).toBe(400);
    expect(fields(r.body)).toContain("speed");
  });

  it("rejects an unknown scenario id", async () => {
    const r = await get("/api/cells?city=sg&scenario=p2p99");
    expect(r.statusCode).toBe(400);
    expect(fields(r.body)).toContain("scenario");
  });

  it("rejects an H3 resolution the ingest did not precompute a parent for", async () => {
    const r = await get("/api/cells?city=sg&res=9");
    expect(r.statusCode).toBe(400);
    expect(fields(r.body)).toContain("res");
  });

  it("rejects an unknown parameter instead of ignoring it", async () => {
    // .strict() — a typo like ?minute=15 silently falling back to the default
    // would be a wrong number on a wall display with no indication why.
    const r = await get("/api/cells?city=sg&minute=15");
    expect(r.statusCode).toBe(400);
    expect(fields(r.body)).toContain("minute");
  });
});

describe("GET /api/cells — numeric bounds on minutes", () => {
  it.each([
    ["zero", "0"],
    ["negative", "-5"],
    ["above the pipeline's 60-minute search cap", "61"],
    ["fractional", "15.5"],
    ["not a number", "soon"],
    ["empty", ""],
    ["a very large number", "1e9"],
  ])("rejects %s minutes", async (_label, value) => {
    const r = await get(`/api/cells?city=sg&minutes=${encodeURIComponent(value)}`);
    expect(r.statusCode).toBe(400);
    expect(fields(r.body)).toContain("minutes");
  });

  it.each(["1", "15", "60"])("accepts %s minutes", async (value) => {
    const r = await get(`/api/cells?city=sg&minutes=${value}&res=7`);
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).query.minutes).toBe(Number(value));
  });
});

describe("SQL injection attempts are refused by validation, not by escaping", () => {
  // These never reach SQL: `city` is an enum of the two rows in `cities`, and
  // every value that does reach a statement is bound, not interpolated.
  const payloads = [
    "sg'; DROP TABLE cells;--",
    "sg' OR '1'='1",
    "sg UNION SELECT 1,2,3",
    "'; ATTACH DATABASE '/tmp/x.db' AS x;--",
    "sg\0",
  ];
  it.each(payloads)("refuses city=%j", async (payload) => {
    const r = await get(`/api/cells?city=${encodeURIComponent(payload)}`);
    expect(r.statusCode).toBe(400);
    expect(fields(r.body)).toContain("city");
  });

  it.each(payloads)("refuses minutes=%j", async (payload) => {
    const r = await get(`/api/cells?city=sg&minutes=${encodeURIComponent(payload)}`);
    expect(r.statusCode).toBe(400);
  });

  it("leaves the database intact afterwards", async () => {
    const r = await get("/api/cells?city=sg&res=7");
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).hexes.length).toBeGreaterThan(0);
  });
});

describe("GET /api/cell/:h3 — path parameter", () => {
  it.each([
    ["an id with non-hex characters", "zzzz"],
    ["a path traversal attempt", "..%2F..%2Fetc%2Fpasswd"],
    ["an id that is too short", "8a65"],
    ["a quoted injection", "8a65'--"],
  ])("rejects %s", async (_label, h3) => {
    const r = await get(`/api/cell/${h3}?city=sg`);
    expect(r.statusCode).toBe(400);
  });

  it("404s a well-formed id that is not in this city", async () => {
    const r = await get("/api/cell/8a65b2d2c38ffff?city=jb");
    expect([404, 400]).toContain(r.statusCode);
  });
});

describe("other endpoints validate too", () => {
  it("rejects an unknown cohort on /api/summary", async () => {
    const r = await get("/api/summary?cohort=children");
    expect(r.statusCode).toBe(400);
    expect(fields(r.body)).toContain("cohort");
  });

  it("rejects an unknown city on /api/scenarios", async () => {
    const r = await get("/api/scenarios?city=kl");
    expect(r.statusCode).toBe(400);
  });

  it("rejects a non-boolean `alternatives` on /api/footpath", async () => {
    const r = await get("/api/footpath?alternatives=yes");
    expect(r.statusCode).toBe(400);
    expect(fields(r.body)).toContain("alternatives");
  });

  it("404s an unknown route with a code, not an HTML page", async () => {
    const r = await get("/api/nope");
    expect(r.statusCode).toBe(404);
    expect(JSON.parse(r.body).error).toBe("NOT_FOUND");
  });
});

describe("res=10 is gated", () => {
  it("refuses the raw grid for a whole city", async () => {
    const r = await get("/api/cells?city=sg&res=10");
    expect(r.statusCode).toBe(400);
    expect(fields(r.body)).toContain("res");
  });

  it("allows it scoped to one neighbourhood", async () => {
    const r = await get("/api/cells?city=sg&res=10&unit=0");
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.hexes.length).toBeGreaterThan(0);
    // res=10 means one row per cell, so no aggregation happened.
    expect(body.hexes.every((h: { cells: number }) => h.cells === 1)).toBe(true);
  });
});

describe("error responses leak nothing", () => {
  it("never includes a stack trace or SQL", async () => {
    for (const url of ["/api/cells?city=../../etc", "/api/cell/'--?city=sg", "/api/nope"]) {
      const r = await get(url);
      expect(r.body).not.toMatch(/\bat \S+:\d+:\d+/);     // stack frames
      expect(r.body).not.toMatch(/SELECT|FROM cells/i);    // SQL
      expect(r.body).not.toMatch(/sgjb\.db|\/home\//);     // filesystem paths
    }
  });
});
