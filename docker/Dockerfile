# syntax=docker/dockerfile:1.7
#
# Wicker Money: the API, the built web app and the bundled plugins in one image.
#
#   docker build -f docker/Dockerfile -t wickermoney .        (from the repo root)
#
# One process serves everything on one port. The API serves the web app and the
# plugin remotes itself (WEB_DIST_DIR), so the refresh cookie, the Origin check
# and same-origin plugin loading all work without a reverse proxy in front.
#
# The image does not migrate on start. Run the migrations first, as the database
# owner, from the same image:
#
#   docker run --rm --env-file .env wickermoney node dist/db/cli.js up
#
# docker/docker-compose.sample.yml automates this as a one-shot `migrate`
# service (depends_on: service_completed_successfully) rather than a manual
# step, but the image itself still never migrates on its own.
#
# Debian rather than Alpine on purpose: argon2 hashing is a native module, and
# the glibc build is the one exercised everywhere else this code runs.

ARG NODE_VERSION=22

# ── base ──────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS base
# pnpm comes from the `packageManager` field in package.json, so the version is
# defined in one place. Corepack would otherwise stop and ask before downloading.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    npm_config_store_dir=/pnpm/store \
    TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# ── build ─────────────────────────────────────────────────────────────────────
# Everything is built here, dev dependencies included. Nothing from this stage
# reaches the final image except what the later stages copy out of it.
FROM base AS build
# The release version: the pushed tag without its leading v (release.yml passes
# it as a build-arg). Defaults to 0.0.0, the same placeholder every
# package.json already carries, so a plain `docker build` with no --build-arg
# is unaffected.
ARG VERSION=0.0.0
COPY . .
RUN --mount=type=cache,id=wickermoney-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
# apps/api and apps/web stay `private` (see release.yml) so the release
# workflow's own version-stamping step never touches them -- they are not
# published, they are built into this image. Stamping them here, once, means
# the API can read its own version back from package.json at boot
# (src/version.ts) and the web build can bake it into the bundle
# (vite.config.ts), with no other place the number has to be kept in sync.
RUN node docker/stamp-version.mjs "$VERSION" apps/api/package.json apps/web/package.json
RUN pnpm build

# ── api ───────────────────────────────────────────────────────────────────────
# Production dependencies only. `--legacy` because pnpm 10 otherwise refuses to
# deploy a workspace that does not set `inject-workspace-packages`; the legacy
# mode copies each workspace dependency (plugin-sdk and the two server-side
# plugins) with its built `dist`, which is what the API imports at runtime.
FROM build AS api
RUN --mount=type=cache,id=wickermoney-pnpm-store,target=/pnpm/store \
    pnpm --filter @wickermoney/api deploy --prod --legacy /out

# ── web ───────────────────────────────────────────────────────────────────────
# The host build, with every plugin remote laid over it. The plugin builds write
# into apps/web/public/plugins and the web build copies that directory into its
# output, but nothing orders the two in the task graph (budgets and import-csv
# are not dependencies of the web package). Copying the plugins across again
# makes the result independent of that ordering, and the loop fails the build if
# a remote is missing rather than shipping a dashboard that silently lacks it.
FROM build AS web
RUN mkdir /web \
 && cp -r apps/web/dist/. /web/ \
 && mkdir -p /web/plugins \
 && cp -r apps/web/public/plugins/. /web/plugins/ \
 && test -f /web/index.html \
 && for dir in apps/web/public/plugins/*/; do \
      name="$(basename "$dir")"; \
      test -f "/web/plugins/$name/remoteEntry.js" || { echo "missing plugin remote: $name" >&2; exit 1; }; \
    done

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
# The commit this image was built from (release.yml passes github.sha).
# Optional and informational only -- recorded in core.app_deployments
# (apps/api/src/db/recordDeployment.ts) alongside the version, which already
# reached this stage through the package.json copied below rather than an
# env var.
ARG GIT_SHA=
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    WEB_DIST_DIR=/app/web \
    GIT_SHA=${GIT_SHA}
WORKDIR /app/api

# package.json carries `"type": "module"`; without it the compiled output is
# treated as CommonJS and fails on its first import.
#
# --chown so the unprivileged user can read everything regardless of the file
# modes in the build context: a checkout on Windows can produce 0700 files.
COPY --from=api --chown=node:node /out/package.json ./package.json
COPY --from=api --chown=node:node /out/node_modules ./node_modules
COPY --from=api --chown=node:node /out/dist ./dist
COPY --from=web --chown=node:node /web /app/web

USER node
EXPOSE 8080

# Liveness only (`/healthz` does not touch the database). `/readyz` also checks
# the database, which is a better signal for a load balancer than for a restart.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD ["node", "dist/index.js"]
