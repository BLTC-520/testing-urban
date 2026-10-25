# Deploying to AWS

The project ships **three independent things**, and they have nothing in common at runtime: a
static site with no server at all, a dashboard with a read-only API behind it, and a batch
pipeline that runs for hours a few times a year. Giving each the cheapest shape that fits is
simpler and an order of magnitude less expensive than one cluster that hosts all three.

Today `main` publishes `web/dist` with GitHub Pages behind a Cloudflare CNAME, and the command
centre runs only on a developer's machine. The target below keeps the static site's properties —
no application server in the request path for any page a reader loads — and gives the API
somewhere to live.

| What | Where it goes | Why |
|---|---|---|
| `web/dist` (prerendered Story, Explorer, Methods) | S3 + CloudFront | Pure objects; no server, no database, no key |
| `web/public/tiles`, `web/public/fonts` | S3 + CloudFront | 47 MB PMTiles archive served by byte range |
| `dashboard/dist` (Vue command centre) | S3 + CloudFront, under `/dashboard/` | Static bundle like any other SPA |
| `server/` (Fastify + SQLite) | Lambda container image, CloudFront origin for `/api/*` | Stateless, read-only, pure function of the query string |
| `src/sgjb/` (the Python pipeline) | Nothing, or AWS Batch | Hours of CPU, weeks apart; its outputs are committed |

## Runtime architecture

```
  readers ─┐
    wall  ─┼──► CloudFront (one distribution, four behaviours)
   agents ─┘        │
                    ├─ /*                     ──► S3  web/dist/              (1 h)
                    ├─ /dashboard/*           ──► S3  dashboard/dist/        (1 h)
                    ├─ /basemap/* /fonts/*    ──► S3  tiles/ fonts/          (1 y, byte ranges)
                    └─ /api/*                 ──► Lambda (container image)
                         cache key: city, minutes, speed, res, scenario, unit
                         origin is reached only on a cache miss
                                                   │
                                  Fastify + sgjb.db baked into the image
                                  (AWS Lambda Web Adapter — the app is unchanged)

  S3 is private: no public access, every read signed by CloudFront with Origin Access Control.
  The Function URL uses AWS_IAM auth and is likewise reached only through CloudFront's OAC,
  so neither origin has a publicly resolvable address of its own.
  TLS from an ACM certificate, which for CloudFront must be issued in us-east-1.
```

A single distribution rather than two, for three reasons.

**CORS disappears.** `dashboard/src/api/client.ts` already reads
`import.meta.env.VITE_API_BASE ?? ""`, so with the API on the same hostname every fetch is
same-origin — which is exactly what the Vite dev proxy stands in for locally. `SGJB_ORIGINS`
still gets set to the production origin, but nothing depends on it.

**The API stops carrying the basemap.** The two `@fastify/static` registrations in
`server/src/app.ts` exist so the 47 MB `basemap.pmtiles` lives in one place in the repository.
In production S3 serves those prefixes instead, which keeps the image small and hands the range
requests PMTiles depends on to a CDN that is good at them. The registrations stay for dev.

**One hostname, one certificate, one cache to invalidate.**

### Why the API caches so well

`/api/cells` is a pure function of city, minutes, speed, resolution, scenario and unit — six
values from small fixed sets. The database is immutable between deploys. So a long shared TTL
is not a guess: after the first visitor exercises a control, moving that control costs an edge
hit and no compute. The cost accepted in the README — that the minutes slider is an HTTP request
rather than a local recompute — is paid once per deploy per combination, not once per drag.

This is also the one assumption that would have to be revisited if a route ever wrote: the cache
policy and the read-only SQLite handle are two halves of the same decision.

### Lambda, and when not to

The Lambda Web Adapter speaks the Lambda runtime API on one side and plain HTTP to
`127.0.0.1:8787` on the other, so the Fastify app, its plugins and its 67 tests stay as they are.
No ALB, nothing always-on, effectively no bill.

The cost is a one-to-two-second cold start on the first request after an idle period. An
EventBridge rule hitting `/api/health` every few minutes removes most of it for nothing. If the
wall display is demonstrated live and even that is unacceptable, swap the Function URL origin for
`ALB → ECS Fargate` running the same container with `node:22-slim` as the base and no adapter:
about **$27/month more**, nearly all of it the load balancer.

## The database is a build artifact

`server/src/ingest.ts` reads `web/public/data` and writes `server/data/sgjb.db`; the API opens it
`readonly: true, fileMustExist: true`. So run the ingest during `docker build` and let the
database travel inside the image: versioned with the code that queries it, well under the 10 GB
image limit, nothing to mount, nowhere to write. EFS would add a mount target, a VPC and a second
thing to keep in sync in exchange for nothing.

```dockerfile
# Sketch. The ingest runs at build time, never at boot.
FROM public.ecr.aws/lambda/nodejs:22 AS build
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm ci                   # devDependencies included: tsx runs the ingest
COPY server ./server
COPY web/public/data ./web/public/data    # 36 MB, build-time only
RUN cd server && npm run ingest && npm run verify

FROM public.ecr.aws/lambda/nodejs:22
WORKDIR /app
COPY --from=build /app /app
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 \
     /lambda-adapter /opt/extensions/lambda-adapter
ENV AWS_LWA_PORT=8787 HOST=0.0.0.0 PORT=8787 \
    SGJB_DB=/app/server/data/sgjb.db \
    SGJB_ORIGINS=https://sgjburbansideprojects.brianhar.site
CMD ["npm", "--prefix", "server", "start"]
```

Build for the architecture the function runs on — `better-sqlite3` is a native module, and arm64
is cheaper on both Lambda and Fargate.

## Four changes to make first

Each of these works locally and fails quietly behind a CDN.

**`HOST=0.0.0.0`.** `server/src/server.ts` defaults to loopback on purpose, so a dev run is not
exposed on the local network. In a container nothing outside the task can reach it and the health
check never connects. Environment variable only; no code change.

**`trustProxy: true`.** `@fastify/rate-limit` is configured with `keyGenerator: (req) => req.ip`.
Behind CloudFront `req.ip` is the edge's address, not the visitor's, so the documented per-IP
limit of 300/minute becomes one shared bucket for everybody and a single busy reader can lock out
the rest. Building the instance with `trustProxy: true` makes `req.ip` read `X-Forwarded-For`.

**`Cache-Control` on the API.** None of the eight routes sets one today, so CloudFront has
nothing to cache on and the architecture above degrades to a proxy. `public, max-age=60,
s-maxage=86400` on the data routes and `no-store` on `/api/health`, paired with a cache policy
that allowlists exactly the six query parameters and ignores the rest. The existing tests drive
the app through `app.inject()`, so asserting a header costs three lines.

**`tsx` in production.** `npm start` runs `tsx src/server.ts`, but `tsx` is a devDependency — an
image built with `npm ci --omit=dev` cannot start. Either move it to `dependencies` or add a
`tsc` build step.

## Release path

```
  Python pipeline ──(weeks apart)──► committed artifacts in the repo
   make pipeline                      web/public/data · web/public/tiles
                                              │  push to main
                                              ▼
                                    GitHub Actions, OIDC role (no stored keys)
                                              │
            ┌─────────────────────────────────┼─────────────────────────────────┐
            ▼                                 ▼                                 ▼
   build:site && check:site          vue-tsc -b && vite build        npm run ingest → sgjb.db
            │                                 │                        npm run verify
     s3 sync → /                  s3 sync → /dashboard/                        │
            │                                 │                       docker build → ECR
    invalidate *.html              invalidate /dashboard/*                     │
                                                                      update function code
```

`.github/workflows/ci.yml` stays as it is. `pages.yml` is replaced by a deploy workflow that
assumes a role by OIDC: a GitHub identity provider in IAM and a role whose trust policy names
this repository and `ref:refs/heads/main`, so there is no access key to store or rotate.

A deploy needs no OSM download, no numba and no tippecanoe: the pipeline's outputs are already in
the repository, which is what makes the release path three ordinary build jobs.

## Order of work

1. **Region and certificate.** `ap-southeast-1` for the data and the audience. The CloudFront
   certificate must be issued in `us-east-1` regardless; request it and validate by DNS first,
   because it is the step with a waiting period.
2. **Bucket.** One bucket, all public access blocked, three prefixes. Set content types
   explicitly: `.pmtiles` and `.bin` as `application/octet-stream`, `.md` as
   `text/markdown; charset=utf-8`, `llms.txt` as `text/plain`.
3. **Image.** ECR repository, build for `linux/arm64`, push, create the function from the image
   with a Function URL under `AWS_IAM` auth. 512 MB and a 10 s timeout are ample.
4. **Distribution.** Two origins, the four behaviours above, both reached by OAC. Compression off
   on the basemap behaviour — a compressed object cannot serve byte ranges.
5. **DNS.** A Route 53 alias, or keep the Cloudflare CNAME set to **DNS-only**; leaving the proxy
   on puts two CDNs in series, each with its own cache and its own opinion about ranges.
6. **The four changes above.**
7. **Workflow.** Replace `pages.yml`.
8. **Observability and a cap.** Function logs plus the distribution's cache-hit-rate metric
   answer most questions. A Budgets alarm at a few dollars is worth having: the only way this
   gets expensive is egress.
9. **The pipeline, if ever.** AWS Batch on Fargate with the sources in S3 is the clean home for
   it. Running it locally and committing the outputs costs nothing and loses nothing.

## The trailing slash

Every page lives at a real directory path (`/`, `/explore/`, `/methods/`, `/about/`) and the
prerender step writes `dist/explore/index.html`. S3 reached through OAC serves objects by exact
key and knows nothing about index documents — that behaviour belongs to the S3 *website*
endpoint, which OAC bypasses. Without a CloudFront Function on viewer-request that appends
`index.html` to any path ending in `/`, every page but the root returns a 403 that the browser
shows as a broken site. It is the most common way a prerendered site arrives broken, and
`npm run check:site` will not catch it because it checks `web/dist`, not the deployment.

## Cost

Singapore region, portfolio traffic, per month.

| Service | Basis | USD |
|---|---|---:|
| S3 Standard | 83 MB of objects, a few thousand GETs | 0.05 |
| CloudFront | inside the always-free 1 TB / 10 M requests | 0.00 |
| Lambda | a few hundred thousand requests after cache hits | 0.00 |
| ECR | one image, roughly 300 MB | 0.10 |
| Route 53 | one hosted zone | 0.50 |
| ACM | public certificate | 0.00 |
| **Total** | as drawn | **≈ 0.65** |

Egress is the only thing that scales: a first Explorer visit pulls `cells_<city>.bin` (1.3–1.8 MB),
a few 0.02° graph tiles out of the 19 MB set, and basemap ranges. Pre-gzipping the `.bin` tables
and serving them with `Content-Encoding: gzip` would cut that further if it ever matters.
