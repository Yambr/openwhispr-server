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
# Phase 06 / Plan 06-12a fix — @openwhispr/observability is a workspace
# dep of @openwhispr/worker (Phase 6 OTel wiring) but was never wired
# into this Dockerfile. tsup's noExternal pattern fails to resolve it
# at build time without the package present in the build context.
COPY packages/observability/package.json packages/observability/
# Phase 13 / Plan 01 — @openwhispr/email is a workspace dep of @openwhispr/worker
# (replaces noopSender with the shared SMTP-sender library). Source tree
# required because tsup inlines workspace deps via noExternal.
COPY packages/email/package.json packages/email/
# Phase 14 / Plan 14-04 — packages/byok-guard is the assertBYOKConfig
# library imported at apps/worker/src/index.ts:7-9 BEFORE worker startup.
# Workspace dep declared in apps/worker/package.json:19; manifest was
# missing from the Dockerfile COPY chain (SERVER-ERRORS Entry 7, Phase 19a).
COPY packages/byok-guard/package.json packages/byok-guard/
# Phase 33 / CR-02 — @openwhispr/data is a workspace dep of @openwhispr/worker
# (validateEncryptionBoot import at apps/worker/src/index.ts:12). Manifest
# was missing from the Dockerfile COPY chain; tsup's noExternal walk fails
# to resolve `@openwhispr/data` without the package present.
COPY packages/data/package.json packages/data/

RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.base.json ./
COPY apps/worker apps/worker
COPY packages/observability packages/observability
COPY packages/email packages/email
COPY packages/byok-guard packages/byok-guard
COPY packages/data packages/data

RUN pnpm --filter @openwhispr/worker build

# ----- prod-deps -----
FROM node:24-alpine AS prod-deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.0.8 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/observability/package.json packages/observability/
COPY packages/email/package.json packages/email/
# Phase 19a / SERVER-ERRORS Entry 7 — byok-guard manifest needed for the
# prod-deps `--filter @openwhispr/worker...` walk.
COPY packages/byok-guard/package.json packages/byok-guard/
# Phase 33 / CR-02 — packages/data manifest needed for the prod-deps
# `--filter @openwhispr/worker...` walk (mirror of builder stage).
COPY packages/data/package.json packages/data/

RUN pnpm install --frozen-lockfile --prod --ignore-scripts \
      --node-linker=hoisted \
      --filter "@openwhispr/worker..."

# ----- runtime -----
FROM node:24-alpine AS runtime
LABEL org.opencontainers.image.source="https://github.com/Yambr/openwhispr-server" \
      org.opencontainers.image.licenses="FSL-1.1-ALv2"
WORKDIR /app

ENV NODE_ENV=production

COPY --from=prod-deps --chown=node:node /app/node_modules /app/node_modules
COPY --from=builder --chown=node:node /app/apps/worker/dist /app/apps/worker/dist
COPY --from=builder --chown=node:node /app/apps/worker/package.json /app/apps/worker/package.json

# SR-20.5 (Phase 20-02b) — explicit numeric uid; see api Dockerfile note.
USER 1000

# No EXPOSE / no HEALTHCHECK — worker has no HTTP listener. BullMQ's
# job-processing loop is the liveness signal; Docker `restart: unless-stopped`
# (declared in docker-compose.yml) recovers from process death. K8s
# deployment in Phase 9 will switch to a `livenessProbe` exec on the
# BullMQ queue.isPaused() boolean.

CMD ["node", "/app/apps/worker/dist/index.cjs"]
