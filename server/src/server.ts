/**
 * Bind the API to a port. `src/app.ts` holds everything interesting; this file
 * only handles configuration from the environment and an orderly shutdown.
 *
 *   npm run dev       reloads on change (TypeScript, via tsx)
 *   npm start         compiled JavaScript from dist/ (what the container runs)
 *
 * Environment:
 *   PORT              default 8787
 *   HOST              default 127.0.0.1 — loopback, so a dev run is not
 *                     exposed on the local network by accident. A container
 *                     MUST set 0.0.0.0 or its platform's health check cannot
 *                     connect; the Dockerfile does.
 *   SGJB_ORIGINS      comma-separated CORS allowlist. Unnecessary when this
 *                     process also serves the dashboard (same origin).
 *   SGJB_RATE_LIMIT   requests per minute per client

 *   SGJB_TRUST_PROXY  which peers may be believed when they send
 *                     X-Forwarded-For: an address, a CIDR, or a proxy-addr
 *                     name such as "loopback, uniquelocal" (the production
 *                     default). Without it the rate limiter sees only the
 *                     proxy's address and every visitor shares one bucket.
 *                     Never a number — see AppOptions.trustProxy.
 *   SGJB_DASHBOARD    path to the built dashboard, or "off" to serve API only
 *   SGJB_DB           database path
 */
import { existsSync } from "node:fs";
import { buildApp } from "./app.ts";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const allowedOrigins = process.env.SGJB_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean);
const rateLimitMax = process.env.SGJB_RATE_LIMIT ? Number(process.env.SGJB_RATE_LIMIT) : undefined;
const trustProxy = process.env.SGJB_TRUST_PROXY || undefined;
const serveDashboard =
  process.env.SGJB_DASHBOARD === "off" ? false : process.env.SGJB_DASHBOARD;

const { app, close } = await buildApp({
  allowedOrigins,
  rateLimitMax,
  trustProxy,
  serveDashboard,
  logger: true,
});

/*
 * The mistake this catches: a container that binds loopback accepts no traffic
 * from outside itself, so the platform's health check times out and the deploy
 * is rolled back with nothing in the logs to explain it. Warn loudly rather
 * than silently overriding, because binding every interface is a decision the
 * operator should be making on purpose.
 */
if (existsSync("/.dockerenv") && (host === "127.0.0.1" || host === "localhost")) {
  app.log.warn(
    `bound to ${host} inside a container — nothing outside this container can reach it. Set HOST=0.0.0.0.`,
  );
}

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
