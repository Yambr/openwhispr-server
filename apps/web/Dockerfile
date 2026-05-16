# OpenWhispr Web container — Phase 07.1 Plan 03 (WEB-IMPL-03 / D-DEPLOY-2).
#
# Multi-stage, multi-arch (amd64+arm64) via
# `docker buildx build --platform linux/amd64,linux/arm64 -f apps/web/Dockerfile .`.
#
# Strategy:
#   - deps    : `pnpm install --filter @openwhispr/web...` brings down the
#               full transitive workspace deps the web app needs to BUILD.
#   - build   : `pnpm --filter @openwhispr/web build` produces the Next.js
#               standalone server (next.config.ts → output: 'standalone').
#               outputFileTracingRoot is set to the monorepo root in
#               apps/web/next.config.ts, so @vercel/nft follows pnpm symlinks
#               into packages/* correctly.
#   - runner  : minimal node:24-alpine image. The standalone tree already
#               contains a self-contained node_modules pruned by nft; we
#               copy that + .next/static + apps/web/public and run
#               `node apps/web/server.js` as non-root nextjs:nodejs (uid 1001).
#
# Healthcheck targets the in-container plaintext port (Traefik terminates TLS
# upstream). `/api/health` is provided by apps/web/src/app/api/health/route.ts.
#
# Standalone server honors PORT + HOSTNAME env vars (Next.js docs). HOSTNAME
# is set to 0.0.0.0 so docker port-publish would work if ever enabled — but
# this service intentionally does NOT publish any host port (D-05): Traefik
# is the sole ingress.

# ----- deps: install full workspace deps needed to build the web app -----
FROM node:24-alpine AS deps
WORKDIR /app

# pnpm via corepack (ships with Node 24). Match the api Dockerfile's
# pinned version so lockfile invariants hold across both images.
RUN corepack enable && corepack prepare pnpm@11.0.8 --activate

# Copy lockfile + workspace manifest + per-package manifests first to
# maximise layer caching on dependency-only changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
# Workspace packages web may transitively reference. Manifests only — the
# install resolves a flat node_modules without pulling source.
COPY packages/auth/package.json packages/auth/
COPY packages/data/package.json packages/data/
COPY packages/contract-tests/package.json packages/contract-tests/
COPY packages/litellm-client/package.json packages/litellm-client/
COPY packages/observability/package.json packages/observability/
COPY packages/wire-schemas/package.json packages/wire-schemas/
COPY packages/i18n/package.json packages/i18n/

# Full install (dev included — needed for next build + typescript).
# --ignore-scripts skips lefthook prepare which has no purpose in the image.
# `--filter @openwhispr/web...` (trailing dots) walks transitive deps so
# packages/* manifests resolve without bringing api/worker dev tooling.
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@openwhispr/web..."

# ----- build: produce Next.js standalone server -----
FROM node:24-alpine AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.0.8 --activate

# Bring forward the resolved node_modules tree from deps.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules

# Copy sources web needs to build. The Next.js standalone tracer
# (outputFileTracingRoot = monorepo root) walks packages/* during build,
# so the source trees must be present.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./
COPY apps/web apps/web
COPY packages/auth packages/auth
COPY packages/wire-schemas packages/wire-schemas
COPY packages/i18n packages/i18n

ENV NEXT_TELEMETRY_DISABLED=1
# pnpm 11 auto-verifies workspace dep status before running scripts and
# re-invokes `pnpm install` if it considers the tree stale, which in turn
# fires the root `prepare` script (`node tools/install-hooks.cjs`). The
# tools/ tree isn't part of the web build context, so the re-install fails
# with MODULE_NOT_FOUND. Disable the auto-verification — we already ran
# a `--frozen-lockfile` install in the `deps` stage and copy that tree
# forward; running `next build` does not require another install pass.
ENV PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false
# Phase 07.1 / Plan 13.3 — Next.js inlines NEXT_PUBLIC_* envs at BUILD time
# (statically replaced in the client bundle). Runtime-only env vars on the
# `web` service do NOT reach the browser. Accept these as build args so
# `docker compose build` (with build.args sourced from .env) bakes the
# operator's external observability deep-links into the image. Empty
# defaults preserve the graceful error-state path (ObservabilityClient
# renders a destructive Alert when grafana is unset).
ARG NEXT_PUBLIC_GRAFANA_BASE_URL=""
ARG NEXT_PUBLIC_TEMPO_BASE_URL=""
ARG NEXT_PUBLIC_MIMIR_BASE_URL=""
ARG NEXT_PUBLIC_LOKI_BASE_URL=""
ARG NEXT_PUBLIC_OIDC_PROVIDERS=""
ENV NEXT_PUBLIC_GRAFANA_BASE_URL=${NEXT_PUBLIC_GRAFANA_BASE_URL}
ENV NEXT_PUBLIC_TEMPO_BASE_URL=${NEXT_PUBLIC_TEMPO_BASE_URL}
ENV NEXT_PUBLIC_MIMIR_BASE_URL=${NEXT_PUBLIC_MIMIR_BASE_URL}
ENV NEXT_PUBLIC_LOKI_BASE_URL=${NEXT_PUBLIC_LOKI_BASE_URL}
ENV NEXT_PUBLIC_OIDC_PROVIDERS=${NEXT_PUBLIC_OIDC_PROVIDERS}
RUN pnpm --filter @openwhispr/web build

# ----- runner: minimal image, non-root, healthcheck -----
FROM node:24-alpine AS runner
LABEL org.opencontainers.image.source="https://github.com/openwhispr/openwhispr-server" \
      org.opencontainers.image.licenses="FSL-1.1-ALv2"
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

# SR-20.5 (Phase 20-02b) — uid 1000 to match K8s securityContext.runAsUser
# and api/worker images. node:24-alpine already ships a `node` user at uid
# 1000 / gid 1000, so we REUSE it rather than creating a parallel nextjs
# user (a fresh addgroup -g 1000 would collide with "gid '1000' in use").
# The .next/cache directory is pre-created BEFORE the chown sweep so the
# Next.js standalone ISR cache writer (which Next.js 15 expects to be
# writable even though we run on a read-only K8s rootfs — see SR-20.5
# emptyDir mount) inherits uid 1000 ownership.
RUN mkdir -p /app/apps/web/.next/cache

# Next.js standalone output layout (monorepo root mode):
#   apps/web/.next/standalone/  — self-contained server + pruned node_modules
#     ├── apps/web/server.js
#     ├── apps/web/.next/...
#     ├── node_modules/...
#     └── package.json
# We copy the entire standalone tree to /app, then drop .next/static and
# public/ at the conventional paths the standalone server reads from.
COPY --from=build --chown=1000:1000 /app/apps/web/.next/standalone ./
COPY --from=build --chown=1000:1000 /app/apps/web/.next/static     ./apps/web/.next/static
COPY --from=build --chown=1000:1000 /app/apps/web/public           ./apps/web/public

# Final ownership sweep so the pre-created .next/cache directory + everything
# under /app is owned by uid 1000. Numeric form survives multi-stage builds
# where the named user may not exist in intermediate layers.
RUN chown -R 1000:1000 /app

USER 1000
EXPOSE 3000

# BusyBox wget ships in alpine — no apk add needed. Healthcheck targets
# the in-container plaintext port; Traefik terminates TLS upstream.
HEALTHCHECK --interval=10s --timeout=3s --retries=3 --start-period=30s \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "apps/web/server.js"]
