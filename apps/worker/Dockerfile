# OpenWhispr Worker container — Phase 03 Plan 08.
#
# Long-running BullMQ worker that ingests LiteLLM_SpendLogs into our
# usage_ledger every 30s (LITELLM-07 / DATA-03). Built off the same
# multi-stage scaffolding as apps/api/Dockerfile (Phase 02.1 / 02.4 G3
# hardened pattern). Multi-arch (amd64+arm64).
#
# Stages:
#   - builder   : full workspace install + tsup build of the worker bundle
#   - prod-deps : flat node_modules with --node-linker=hoisted (so pg
#                 native addons load at runtime — same pattern as api)
#   - runtime   : minimal node:24-alpine, USER node, BusyBox wget
#                 healthcheck not used (worker has no HTTP listener; the
#                 BullMQ worker.process loop IS the liveness signal —
#                 docker-compose `restart: unless-stopped` covers crashes)

# ----- builder -----
FROM node:24-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.0.8 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/worker/package.json apps/worker/

RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.base.json ./
COPY apps/worker apps/worker

RUN pnpm --filter @openwhispr/worker build

# ----- prod-deps -----
FROM node:24-alpine AS prod-deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.0.8 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/worker/package.json apps/worker/

RUN pnpm install --frozen-lockfile --prod --ignore-scripts \
      --node-linker=hoisted \
      --filter "@openwhispr/worker..."

# ----- runtime -----
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY --from=prod-deps --chown=node:node /app/node_modules /app/node_modules
COPY --from=builder --chown=node:node /app/apps/worker/dist /app/apps/worker/dist
COPY --from=builder --chown=node:node /app/apps/worker/package.json /app/apps/worker/package.json

USER node

# No EXPOSE / no HEALTHCHECK — worker has no HTTP listener. BullMQ's
# job-processing loop is the liveness signal; Docker `restart: unless-stopped`
# (declared in docker-compose.yml) recovers from process death. K8s
# deployment in Phase 9 will switch to a `livenessProbe` exec on the
# BullMQ queue.isPaused() boolean.

CMD ["node", "/app/apps/worker/dist/index.cjs"]
