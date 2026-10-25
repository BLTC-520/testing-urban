# syntax=docker/dockerfile:1
#
# SG / JB Command Centre — one image serving the API and the dashboard.
#
# Three stages so the runtime image carries only what it needs to answer
# requests. In particular the 36 MB of pipeline outputs in web/public/data are
# an INPUT to the ingest, not a runtime dependency: they build the database in
# stage 2 and are then left behind.
#
# The database is deliberately baked into the image rather than kept on a
# volume. It is a rebuildable cache of committed analysis outputs, not state —
# nothing writes to it at runtime — so an immutable copy per image is simpler
# than a volume, and a rollback automatically gets the matching data.
#
#   docker build -t sgjb .
#   docker run --rm -p 8787:8787 sgjb
#   open http://localhost:8787

ARG NODE_VERSION=22-bookworm-slim

# ---------------------------------------------------------------------------
# 1. Dependencies. Separated from the source copy so a code-only change does
#    not reinstall node_modules.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci

COPY dashboard/package.json dashboard/package-lock.json ./dashboard/
RUN cd dashboard && npm ci

# ---------------------------------------------------------------------------
# 2. Build: compile the server, build the dashboard, ingest the database.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app

COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=deps /app/dashboard/node_modules ./dashboard/node_modules

COPY server ./server
COPY dashboard ./dashboard
# Only the directory the ingest reads; tiles and fonts are copied into the
# runtime stage directly because they are served, not consumed.
COPY web/public/data ./web/public/data

# TypeScript 6 rewrites the .ts import specifiers to .js on emit, so the
# runtime needs no loader — plain `node dist/server.js`.
RUN cd server && npm run build

RUN cd dashboard && npm run build

# Builds server/data/sgjb.db from web/public/data. Runs under tsx, which is
# present here because this stage has the dev dependencies.
RUN cd server && npm run ingest

# Fail the build rather than ship a container whose numbers disagree with the
# published study. 20 checks across every threshold and walking speed.
RUN cd server && npm run verify

# ---------------------------------------------------------------------------
# 3. Runtime.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ENV NODE_ENV=production
# A container that binds loopback accepts nothing from outside itself and the
# platform's health check will never connect.
ENV HOST=0.0.0.0
ENV PORT=8787
# Believe X-Forwarded-For only from a peer on a private network — i.e. the
# platform's edge proxy. Without this every visitor shares a single rate-limit
# bucket, because req.ip would be the proxy's address. Not `true`, which would
# let a direct public client spoof the header.
ENV SGJB_TRUST_PROXY="loopback, uniquelocal"

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/server/dist            ./server/dist
COPY --from=build /app/server/data/sgjb.db    ./server/data/sgjb.db
COPY --from=build /app/dashboard/dist         ./dashboard/dist
# Served at runtime: the basemap archive (range requests) and the map glyphs.
COPY web/public/tiles                         ./web/public/tiles
COPY web/public/fonts                         ./web/public/fonts

# Drop root before serving.
USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/server
CMD ["node", "dist/server.js"]
