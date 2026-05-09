# OpenWhispr API container — Phase 2 Plan 02.
#
# Multi-stage, multi-arch (amd64+arm64) via
# `docker buildx build --platform linux/amd64,linux/arm64 -f apps/api/Dockerfile .`.
#
# Layers:
#   - builder: install pnpm workspace deps (with dev), build the api +
#     data packages with tsup, then prune to a deploy tree via
#     `pnpm --filter @openwhispr/api --prod deploy`.
#   - runtime: minimal node:24-alpine image, USER node, BusyBox wget
#     healthcheck on plain http://localhost:3000/api/health (Traefik
#     terminates TLS upstream).
#
# The ENTRYPOINT chains a defense-in-depth secrets check
# (apps/api/dist/scripts/check-default-secrets.cjs) before `exec`-ing
# into the Node main process — this closes Phase 1 D-08 / SC#1 partial.
# `exec "$@"` ensures the Node process becomes PID 1 and receives
# SIGTERM directly from `docker stop` (Pitfall #1).

# ----- builder -----
FROM node:24-alpine AS builder
WORKDIR /app

# pnpm via corepack (ships with Node 24).
RUN corepack enable && corepack prepare pnpm@11.0.8 --activate

# Copy lockfile + workspace manifest first to maximise layer caching.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/data/package.json packages/data/

# Install full workspace deps (dev included — needed for tsup/typescript).
# --ignore-scripts skips lefthook prepare which has no purpose in the image.
RUN pnpm install --frozen-lockfile --ignore-scripts

# Now copy sources and build both workspace packages.
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/data packages/data
COPY tools tools

RUN pnpm --filter @openwhispr/data build \
 && pnpm --filter @openwhispr/api build

# Prune to a self-contained production deploy tree under /out.
# `pnpm deploy` flattens workspace symlinks into a real node_modules tree.
RUN pnpm --filter @openwhispr/api --prod deploy /out
RUN pnpm --filter @openwhispr/data --prod deploy /out-data

# ----- runtime -----
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# `node` user (uid 1000) ships in node:*-alpine — no useradd needed.
# Copy the api deploy tree as /app, then graft the data deploy under
# /app/packages/data so the migrate command path works.
COPY --from=builder --chown=node:node /out /app
COPY --from=builder --chown=node:node /out-data /app/packages/data

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
# we never need --no-check-certificate semantics here (Pitfall 3).
HEALTHCHECK --interval=10s --timeout=3s --retries=3 --start-period=30s \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "/app/dist/index.js"]
