/**
 * Bind the API to a port. `src/app.ts` holds everything interesting; this file
 * only handles configuration from the environment and an orderly shutdown.
 *
 *   npm run dev      reloads on change
 *   npm start        plain run
 *
 * Environment:
 *   PORT              default 8787
 *   HOST              default 127.0.0.1 — loopback, not 0.0.0.0, so a dev run
 *                     is not exposed on the local network by accident
 *   SGJB_ORIGINS      comma-separated CORS allowlist
 *   SGJB_RATE_LIMIT   requests per minute per IP
 *   SGJB_DB           database path
 *   SGJB_DASHBOARD_DIR  built dashboard to serve at / (production; see Dockerfile)
 *   SGJB_TRUST_PROXY  "true" when behind Caddy/nginx/a load balancer, so the
 *                     rate limit sees each client's IP rather than the proxy's
 */
import { resolve } from "node:path";
import { buildApp } from "./app.ts";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const allowedOrigins = process.env.SGJB_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean);
const rateLimitMax = process.env.SGJB_RATE_LIMIT ? Number(process.env.SGJB_RATE_LIMIT) : undefined;
const dashboardDir = process.env.SGJB_DASHBOARD_DIR ? resolve(process.env.SGJB_DASHBOARD_DIR) : undefined;
const trustProxy = process.env.SGJB_TRUST_PROXY === "true";

const { app, close } = await buildApp({ allowedOrigins, rateLimitMax, dashboardDir, trustProxy, logger: true });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.log.info(`${signal} — shutting down`);
    close().then(() => process.exit(0), () => process.exit(1));
  });
}

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error({ err }, "failed to listen");
  process.exit(1);
}
