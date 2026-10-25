/**
 * Behaviour behind a reverse proxy.
 *
 * The deployment puts a platform edge in front of this process, so every
 * request arrives from the proxy's address. If `trustProxy` is not configured
 * correctly the rate limiter buckets every visitor together under that one
 * address — a single user then throttles the whole dashboard. These tests use
 * real listening sockets, because `app.inject()` has no socket for proxy-addr
 * to inspect and cannot distinguish the cases.
 */
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type App } from "../src/app.ts";

let api: App | null = null;
let port = 8940;

afterEach(async () => {
  await api?.close();
  api = null;
});

/** Start on a real socket and return a fetch bound to it. */
async function serve(trustProxy: string | boolean) {
  api = await buildApp({ rateLimitMax: 2, trustProxy, serveDashboard: false });
  const p = port++;
  await api.app.listen({ port: p, host: "127.0.0.1" });
  return (forwardedFor: string) =>
    fetch(`http://127.0.0.1:${p}/api/health`, { headers: { "x-forwarded-for": forwardedFor } });
}

describe("rate-limit bucketing behind a proxy", () => {
  it("shares one bucket across visitors when the proxy is not trusted", async () => {
    const hit = await serve(false);
    expect((await hit("1.1.1.1")).status).toBe(200);
    expect((await hit("1.1.1.1")).status).toBe(200);
    // A different visitor is refused because the budget belongs to the proxy.
    expect((await hit("9.9.9.9")).status).toBe(429);
  });

  it("gives each visitor its own bucket with the production setting", async () => {
    const hit = await serve("loopback, uniquelocal");
    expect((await hit("1.1.1.1")).status).toBe(200);
    expect((await hit("1.1.1.1")).status).toBe(200);
    // The first visitor is now out of budget...
    expect((await hit("1.1.1.1")).status).toBe(429);
    // ...but a different one is unaffected.
    expect((await hit("9.9.9.9")).status).toBe(200);
  });

  it("does NOT honour a numeric trustProxy, despite Fastify's types and docs", async () => {
    // Regression guard. Fastify's TS types accept a number and its docs call it
    // a hop count, but the forwarded address is never consulted — so a config
    // of `1` silently leaves every visitor sharing one bucket. If a future
    // Fastify makes the number work, this test fails and the comment in
    // AppOptions.trustProxy should be corrected.
    const hit = await serve(1 as unknown as string);
    expect((await hit("1.1.1.1")).status).toBe(200);
    expect((await hit("1.1.1.1")).status).toBe(200);
    expect((await hit("9.9.9.9")).status).toBe(429);
  });
});

describe("serving the dashboard from the API", () => {
  it("falls back to the app shell for an unknown non-API path", async () => {
    api = await buildApp({ serveDashboard: undefined });
    const r = await api.app.inject({ method: "GET", url: "/some/client/route" });
    // The built dashboard is present in CI only after `npm run build` there;
    // either outcome is correct, but an unknown /api path must never be HTML.
    if (r.statusCode === 200) {
      expect(r.headers["content-type"]).toMatch(/text\/html/);
    } else {
      expect(r.statusCode).toBe(404);
    }
  });

  it("keeps unknown /api paths as JSON even when a dashboard is served", async () => {
    api = await buildApp({ serveDashboard: undefined });
    const r = await api.app.inject({ method: "GET", url: "/api/definitely-not-a-route" });
    expect(r.statusCode).toBe(404);
    expect(r.headers["content-type"]).toMatch(/application\/json/);
    expect(JSON.parse(r.body).error).toBe("NOT_FOUND");
  });
});
