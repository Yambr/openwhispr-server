# Phase 04 / Plan 07 / Task 2 — hermetic mock-realtime container.
#
# Builds a tiny ~50MB Node 24-alpine image that runs the
# tests/e2e/mock-realtime/server.ts OpenAI Realtime protocol mock under
# the docker-compose `e2e` profile. Production compose-up never starts
# this service (the `profiles: [e2e]` gate in the overlay enforces that).
#
# Multi-stage:
#   * build   — installs dev deps, compiles TS via tsc, prunes to runtime.
#   * runtime — minimal node + compiled JS + production deps only.
#
# The build context is `tests/e2e/mock-realtime` (NOT the repo root) so
# the image is self-contained and does not pull in the rest of the
# pnpm workspace. We deliberately use `npm install` (not pnpm) inside the
# image to avoid coupling the container's bootstrap to the host's pnpm
# version — this image must build the same on a developer Mac, GitHub
# Actions Linux, and an arm64 server with no extra tooling.

FROM node:24-alpine AS build
WORKDIR /app
# Copy manifests first for better layer caching on dep-only changes.
COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund --omit=optional
# Copy sources after deps so source-only edits skip the install layer.
COPY server.ts cli.ts ./
RUN npx --no-install tsc -p tsconfig.json

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Bring runtime deps + compiled JS only — no source, no dev deps.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
ENV PORT=8765
EXPOSE 8765
# Run as non-root for defense-in-depth (the node:alpine `node` user is
# uid 1000 / gid 1000 and pre-created in the base image).
USER node
CMD ["node", "dist/cli.js"]
