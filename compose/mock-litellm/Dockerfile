# Phase 08 / Plan 03 / Task 3 — mock-litellm image.
#
# Stands in for the real LiteLLM upstream under the `load-test-mock`
# docker-compose profile (Wave 1, plan 08-05). Production compose-up
# never starts this service because the profile gate keeps it off the
# default profile.
#
# Multi-stage:
#   * deps    — install dev + prod deps for the TypeScript build.
#   * build   — bundle src/server-bootstrap.ts → dist/server.js via tsup.
#   * runner  — minimal runtime: prod-only node_modules + dist/.
#
# Build context: compose/mock-litellm (NOT the repo root). The package
# is self-contained: it has its own package.json + lockfile-free
# `npm install` so the image builds identically on macOS, GitHub Actions
# Linux, and arm64 hosts. We deliberately avoid pnpm inside the image —
# the workspace lockfile would otherwise need to be in scope just to
# install three dependencies.
#
# Build with:
#   docker build -t openwhispr-mock-litellm:dev compose/mock-litellm/
#
# Smoke test:
#   docker run --rm -p 4000:4000 openwhispr-mock-litellm:dev &
#   curl -fsS http://localhost:4000/health/liveliness

# Build uses tsc directly (not tsup) — tsup pulls in rollup, whose native
# binary resolution under Alpine + npm hits a long-standing optional-deps
# bug (https://github.com/npm/cli/issues/4828). Plain tsc emits ESM JS
# from src/ → dist/ with no transitive build tooling needed.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json tsconfig.docker.json ./
# Install dev + prod deps so we have `tsc` available.
RUN npm install --no-audit --no-fund --omit=optional
COPY src ./src
# Compile TypeScript using a self-contained Docker-only tsconfig (the
# workspace root tsconfig.base.json isn't in this build context).
RUN npx --no-install tsc -p tsconfig.docker.json

# Fresh production-only install in a clean layer so we drop dev deps
# (typescript, vitest, @types/*) from the runtime image.
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund --omit=dev --omit=optional

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Runtime needs: prod deps + compiled JS + package.json (for ESM type).
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Drop to the prebuilt `node` user (uid 1000) for defense-in-depth.
USER node

EXPOSE 4000

# BusyBox wget ships in alpine. The mock has no TLS — Traefik (when
# wired in by the load-test profile) terminates upstream.
HEALTHCHECK --interval=10s --timeout=3s --retries=3 --start-period=5s \
  CMD wget --quiet --tries=1 --spider http://localhost:4000/health/liveliness || exit 1

CMD ["node", "dist/server-bootstrap.js"]
