# OpenWhispr API container — Phase 2 Plan 02 (Phase 02.1 rewrite for pnpm v10+).
#
# Multi-stage, multi-arch (amd64+arm64) via
# `docker buildx build --platform linux/amd64,linux/arm64 -f apps/api/Dockerfile .`.
#
# History: the earlier version used `pnpm deploy` to flatten workspace deps
# into a self-contained /out tree. pnpm v10+ defaulted to refusing
# `pnpm deploy` from non-injected workspaces (ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE).
# Phase 02.1 verified that the `inject-workspace-packages` config flag is not
# honored in pnpm 11.0.8, and `--legacy` is an explicit workaround we refuse.
#
# This rewrite uses the industry-standard multi-stage pattern WITHOUT `pnpm deploy`:
#   - builder: full workspace install (with dev), build the api bundle via tsup
#     with `noExternal: [/^@openwhispr\//]` (api/tsup.config.ts) so workspace
#     packages (@openwhispr/data, @openwhispr/contract-tests) are inlined into
#     dist/index.js — the runtime image never needs the workspace source tree.
#   - prod-deps: separate `pnpm install --prod --node-linker=hoisted` produces
#     a flat node_modules with NO pnpm symlinks, safe to COPY across stages.
#   - runtime: minimal node:24-alpine image, USER node, BusyBox wget healthcheck
#     on plain http://localhost:3000/api/health (Traefik terminates TLS upstream).
#
# The ENTRYPOINT chains the defense-in-depth secrets check
# (apps/api/dist/scripts/check-default-secrets.cjs) before `exec`-ing into the
# Node main process — closes Phase 1 D-08 / SC#1 partial. `exec "$@"` ensures
# the Node process becomes PID 1 and receives SIGTERM directly from `docker stop`.

# ----- builder: install full workspace deps + build self-contained api bundle -----
FROM node:24-alpine AS builder
WORKDIR /app

# pnpm via corepack (ships with Node 24).
RUN corepack enable && corepack prepare pnpm@11.0.8 --activate

# Copy lockfile + workspace manifest + per-package manifests first to
# maximise layer caching on dependency-only changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/data/package.json packages/data/
COPY packages/contract-tests/package.json packages/contract-tests/

# Full install (dev included — needed for tsup/typescript).
# --ignore-scripts skips lefthook prepare which has no purpose in the image.
RUN pnpm install --frozen-lockfile --ignore-scripts

# Now copy sources for the packages api needs to bundle.
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/data packages/data
COPY packages/contract-tests packages/contract-tests
COPY tools tools

# Build api (which now inlines @openwhispr/* via noExternal in tsup config).
# Build data separately for the standalone migrate service — it ships its own
# CJS bundle at packages/data/dist/migrate.cjs that the migrate compose service
# invokes directly via `node /app/packages/data/dist/migrate.cjs`.
RUN pnpm --filter @openwhispr/api build \
 && pnpm --filter @openwhispr/data build

# ----- prod-deps: flat runtime node_modules -----
# Separate stage so the heavy dev install in `builder` doesn't bleed into
# the runtime image. `--node-linker=hoisted` produces a flat node_modules
# without pnpm symlinks, which can be COPY-ed across stages cleanly.
FROM node:24-alpine AS prod-deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.0.8 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/data/package.json packages/data/
COPY packages/contract-tests/package.json packages/contract-tests/

# Production-only install with hoisted linker. --filter @openwhispr/api...
# walks api's transitive prod deps but excludes its devDeps (e.g. tsup, tsx).
# Workspace deps themselves are skipped at runtime because they're inlined
# into the api bundle (noExternal in api/tsup.config.ts).
RUN pnpm install --frozen-lockfile --prod --ignore-scripts \
      --node-linker=hoisted \
      --filter "@openwhispr/api..."

# ----- runtime: minimal image, non-root, healthcheck -----
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# `node` user (uid 1000) ships in node:*-alpine — no useradd needed.

# Hoisted prod node_modules from prod-deps stage — contains all non-workspace
# transitive deps of @openwhispr/api (fastify, better-auth, drizzle-orm, pg, zod,
# nodemailer, etc.). Workspace packages themselves are stub directories here
# (because they were filter-installed as workspace deps); api never imports
# from them at runtime since noExternal inlined everything.
COPY --from=prod-deps --chown=node:node /app/node_modules /app/node_modules

# Built api artifacts (self-contained bundle + secrets-check script).
COPY --from=builder --chown=node:node /app/apps/api/dist /app/dist
COPY --from=builder --chown=node:node /app/apps/api/package.json /app/package.json

# Built data artifact for the migrate compose service:
# `command: ["node", "/app/packages/data/dist/migrate.cjs"]`. The data tsup
# config bundles drizzle-orm + pg + schema into one CJS file (external: pg-native).
COPY --from=builder --chown=node:node /app/packages/data/dist /app/packages/data/dist
# drizzle migration files (sql + meta/_journal.json) — migrate.cjs resolves
# them via `resolve(__dirname, "..", "migrations")` so they MUST sit next to dist/.
COPY --from=builder --chown=node:node /app/packages/data/migrations /app/packages/data/migrations

# Ship the deny-list at a known absolute path (entrypoint reads it).
COPY --from=builder --chown=node:node /app/tools/bootstrap/default-secrets.txt \
                                       /app/tools/bootstrap/default-secrets.txt

# Entrypoint shim — chmod 0755 in the COPY directive so we don't need
# an explicit RUN chmod that would create another layer.
COPY --chown=node:node --chmod=0755 apps/api/entrypoint.sh /app/entrypoint.sh

USER node
EXPOSE 3000

# BusyBox wget ships in alpine — no apk add needed. Healthcheck targets
# the in-container plaintext port; Traefik terminates TLS upstream so
# we never need --no-check-certificate semantics here.
HEALTHCHECK --interval=10s --timeout=3s --retries=3 --start-period=30s \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "/app/dist/index.js"]
