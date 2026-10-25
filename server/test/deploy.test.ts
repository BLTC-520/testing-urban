/**
 * The single-origin deployment: one process serves the built dashboard next to
 * the API, behind a reverse proxy. Without those options the app must behave
 * exactly as it did, so the dev setup (Vite on :5174 proxying to here) and
 * every other test are unaffected.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp, type App } from "../src/app.ts";

let dist: string;
beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), "sgjb-dist-"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>SG / JB Command Centre</title>");
  writeFileSync(join(dist, "assets", "index-abc123.js"), "console.log(1)");
});
afterAll(() => rmSync(dist, { recursive: true, force: true }));

describe("serving the built dashboard", () => {
  let api: App;
  beforeAll(async () => { api = await buildApp({ dashboardDir: dist }); });
  afterAll(() => api.close());

  it("serves index.html at / and never lets it be cached stale", async () => {
    const r = await api.app.inject({ method: "GET", url: "/" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/html/);
    expect(r.body).toContain("SG / JB Command Centre");
    expect(r.headers["cache-control"]).toBe("no-cache");
  });

  it("serves hashed assets as immutable", async () => {
    const r = await api.app.inject({ method: "GET", url: "/assets/index-abc123.js" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toMatch(/immutable/);
  });

  it("sends a content security policy now that it serves HTML", async () => {
    const r = await api.app.inject({ method: "GET", url: "/" });
    const csp = String(r.headers["content-security-policy"]);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it("allows WebAssembly for the mesh decoders, but never JavaScript eval", async () => {
    const r = await api.app.inject({ method: "GET", url: "/" });
    const script = String(r.headers["content-security-policy"]).match(/script-src ([^;]*)/)?.[1] ?? "";
    expect(script).toContain("'wasm-unsafe-eval'");
    expect(script).not.toMatch(/'unsafe-eval'/);
  });

  it("lets the map fetch 3D buildings from Cesium ion, and nothing broader", async () => {
    const r = await api.app.inject({ method: "GET", url: "/" });
    const connect = String(r.headers["content-security-policy"]).match(/connect-src ([^;]*)/)?.[1] ?? "";
    expect(connect).toContain("https://api.cesium.com");
    expect(connect).toContain("https://assets.ion.cesium.com");
    expect(connect).not.toMatch(/(^|\s)(https:|\*)(\s|$)/);
  });

  it("keeps the API, and its JSON 404s, working alongside", async () => {
    const health = await api.app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    const missing = await api.app.inject({ method: "GET", url: "/api/nope" });
    expect(missing.statusCode).toBe(404);
    expect(JSON.parse(missing.body).error).toBe("NOT_FOUND");
  });

  it("does not serve files from outside the dashboard directory", async () => {
    const r = await api.app.inject({ method: "GET", url: "/../package.json" });
    expect(r.statusCode).toBe(404);
  });
});

describe("the shipped database", () => {
  it("is not in WAL mode, so it opens read-only from a directory the app cannot write to", async () => {
    // A WAL database makes even a read-only reader create a -shm file beside
    // it. In the image the app runs as a non-root user next to a root-owned
    // file, and that open fails with SQLITE_READONLY_DIRECTORY.
    const api = await buildApp();
    try {
      expect(api.store.db.pragma("journal_mode", { simple: true })).toBe("delete");
    } finally {
      await api.close();
    }
  });
});

describe("without a dashboard directory", () => {
  it("serves the API only, with no CSP, as before", async () => {
    const api = await buildApp();
    try {
      const root = await api.app.inject({ method: "GET", url: "/" });
      expect(root.statusCode).toBe(404);
      const health = await api.app.inject({ method: "GET", url: "/api/health" });
      expect(health.headers["content-security-policy"]).toBeUndefined();
    } finally {
      await api.close();
    }
  });

  it("refuses a dashboard directory with no index.html, at startup", async () => {
    await expect(buildApp({ dashboardDir: join(dist, "assets") })).rejects.toThrow(/index\.html/);
  });
});

describe("behind a reverse proxy", () => {
  const hit = (api: App, ip: string) =>
    api.app.inject({ method: "GET", url: "/api/health", headers: { "x-forwarded-for": ip } });

  it("rate-limits each client, not the proxy, when the proxy is trusted", async () => {
    const api = await buildApp({ rateLimitMax: 2, trustProxy: true });
    try {
      await hit(api, "203.0.113.1");
      await hit(api, "203.0.113.1");
      expect((await hit(api, "203.0.113.1")).statusCode).toBe(429);
      expect((await hit(api, "203.0.113.2")).statusCode).toBe(200);
    } finally {
      await api.close();
    }
  });

  it("ignores X-Forwarded-For when not behind a proxy, so it cannot be spoofed", async () => {
    const api = await buildApp({ rateLimitMax: 2 });
    try {
      await hit(api, "203.0.113.1");
      await hit(api, "203.0.113.2");
      expect((await hit(api, "203.0.113.3")).statusCode).toBe(429);
    } finally {
      await api.close();
    }
  });
});
