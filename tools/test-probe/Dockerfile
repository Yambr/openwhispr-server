# openwhispr-test-probe — Helm test hook image for DEPLOY-05 first-launch SLO.
#
# Multi-stage, multi-arch (amd64+arm64) via
#   docker buildx build --platform linux/amd64,linux/arm64 -f tools/test-probe/Dockerfile .
#
# Stages:
#   - builder: full pnpm install + tsc → dist/probe.js
#   - runtime: node:24-alpine + production node_modules only + dist + fixture.
#
# Image target size: < 200 MB. node:24-alpine is ~50 MB base; runtime deps (undici)
# add ~3 MB; the WAV fixture is ~160 KB; dist is ~10 KB.

FROM node:24-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.0.8 --activate

# Workspace-aware install: copy the lockfile + manifests so layer cache survives source-only changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tools/test-probe/package.json tools/test-probe/

RUN pnpm install --frozen-lockfile --filter @openwhispr/test-probe --ignore-scripts

COPY tools/test-probe/tsconfig.json tools/test-probe/
COPY tools/test-probe/src tools/test-probe/src

RUN pnpm --filter @openwhispr/test-probe build

# Production-only dependencies for the runtime image.
FROM node:24-alpine AS prod-deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.0.8 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tools/test-probe/package.json tools/test-probe/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts \
      --node-linker=hoisted \
      --filter "@openwhispr/test-probe..."

FROM node:24-alpine AS runtime
LABEL org.opencontainers.image.source="https://github.com/Yambr/openwhispr-server" \
      org.opencontainers.image.licenses="FSL-1.1-ALv2"
WORKDIR /app
ENV NODE_ENV=production

# Hoisted prod node_modules (undici + transitive runtime deps only).
COPY --from=prod-deps --chown=node:node /app/node_modules /app/node_modules

# Compiled probe + audio fixture.
COPY --from=builder --chown=node:node /app/tools/test-probe/dist /app/dist
COPY --chown=node:node tools/test-probe/fixtures /app/fixtures

USER node

# Helm test hook invokes: docker run --rm -e TARGET=... -e SLO_DEADLINE_MS=... <image>
ENTRYPOINT ["node", "/app/dist/probe.js"]
