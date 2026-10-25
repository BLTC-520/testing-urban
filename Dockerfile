# The command centre as one image: the built Vue dashboard, the Fastify API and
# the SQLite database, served from a single origin.
#
#   docker build -t sgjb-command-centre .
#   docker run --rm -p 8787:8787 sgjb-command-centre      → http://localhost:8787
#
# Three stages, so the final image carries no compilers, no dev dependencies
# and none of the 35 MB of pipeline outputs the database is built from.
# The build context is the repository root because the server reads the
# basemap and fonts from web/public (see server/src/paths.ts).

ARG NODE_IMAGE=node:24-bookworm-slim

# --- 1. dashboard: vue-tsc + vite build → dashboard/dist --------------------
FROM ${NODE_IMAGE} AS dashboard
WORKDIR /app/dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY dashboard/ ./
# The Cesium ion token for 3D buildings is compiled into the page (Vite reads
# VITE_* at build time), so it arrives as a build argument. It is a browser
# token: every visitor can read it in the JavaScript anyway, so restrict it in
# Cesium ion to asset 96188 and to the dashboard's URL. Unset = no buildings.
ARG VITE_CESIUM_ION_TOKEN=""
RUN VITE_CESIUM_ION_TOKEN="$VITE_CESIUM_ION_TOKEN" npm run build

# --- 2. server: dependencies + the database ----------------------------------
FROM ${NODE_IMAGE} AS server
# better-sqlite3 is a native module. A prebuilt binary is used when one exists
# for this Node version and CPU; these are the fallback for compiling it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY server/ ./
COPY web/public/data /app/web/public/data
# Build sgjb.db from the committed pipeline outputs, check it reproduces the
# study's numbers, then drop dev dependencies (tsx, vitest, typescript).
RUN npm run ingest && npm run verify && npm prune --omit=dev

# --- 3. runtime -------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    SGJB_DASHBOARD_DIR=/app/dashboard/dist
WORKDIR /app
COPY --from=server /app/server/node_modules server/node_modules
COPY --from=server /app/server/package.json server/package.json
COPY --from=server /app/server/src server/src
COPY --from=server /app/server/data/sgjb.db server/data/sgjb.db
COPY --from=dashboard /app/dashboard/dist dashboard/dist
COPY web/public/tiles web/public/tiles
COPY web/public/fonts web/public/fonts

# The database is opened read-only, so the app needs to write nothing; run it
# as the image's unprivileged user rather than root.
USER node
WORKDIR /app/server
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Node runs the TypeScript directly (type stripping); no tsx at runtime.
CMD ["node", "src/server.ts"]
