# Phase 02.14 — Contract-test runner image.
#
# Closes Group E surfaced by Phase 02.13: the host-side runner cannot
# resolve docker-internal DNS (e.g. `fixture-idp`) when the api 302s an
# OAuth flow to `http://fixture-idp:9000/authorize?...`. This image runs
# vitest *inside* the openwhispr_internal network so the same DNS that
# the api sees is available to the test process.
#
# NEVER built/run in production — the docker-compose service is gated
# by `profiles: [contract-test]`. Image is rebuilt cheaply because
# only the contract-tests package + workspace manifests are copied.
#
# Why not bind-mount the host node_modules? Host is darwin-arm64 with
# pnpm symlink layout; container is linux-{amd64,arm64}. Native deps
# (rollup, esbuild, vitest's bundler) ship platform-specific binaries
# that would mismatch — guaranteed runtime failure. Per CLAUDE.md
# "no workarounds" rule, the architecturally correct fix is a thin
# linux install. The pnpm install runs --filter @openwhispr/contract-tests
# so only the test package's dep graph (vitest + zod + tough-cookie +
# transitives) is fetched.
FROM node:24-alpine

WORKDIR /app

# pnpm via corepack (ships with Node 24). Pin matches apps/api/Dockerfile
# so lockfile compatibility holds.
RUN corepack enable && corepack prepare pnpm@11.0.8 --activate

# Workspace skeleton: lockfile + workspace manifest + every package's
# package.json so pnpm can resolve the graph. Without sibling manifests
# the lockfile fails to validate.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/data/package.json packages/data/
COPY packages/contract-tests/package.json packages/contract-tests/

# Install only the contract-tests subgraph (`...` walks transitive deps).
# --ignore-scripts skips lefthook prepare (no purpose in this image).
# Keep dev deps (vitest is a devDependency, NOT a runtime dep).
RUN pnpm install --frozen-lockfile --ignore-scripts \
      --filter "@openwhispr/contract-tests..."

# tsconfig.base.json is referenced by packages/contract-tests/tsconfig.json
# via "extends": "../../tsconfig.base.json". Vitest reads tsconfig at
# runtime to resolve paths; copy it explicitly so the relative `..` walk
# resolves inside the image.
COPY tsconfig.base.json ./

# Test source. Bind-mount in compose for fast iteration during local
# dev would defeat the linux-arch isolation we set up above, so we COPY
# instead — the image rebuilds on test changes (cheap; one layer).
COPY packages/contract-tests packages/contract-tests

WORKDIR /app/packages/contract-tests

# Vitest runs as the unprivileged `node` user that ships with node:*-alpine.
USER node

# `--run` mode — single pass, no watch, exits with non-zero on any
# failed/errored test. Matches the host-side `pnpm test --run` invocation
# already used by `make contract-test-deployed`.
ENTRYPOINT ["pnpm", "exec", "vitest", "run"]
