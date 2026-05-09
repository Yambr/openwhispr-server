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
# `--chown=node:node` because vitest writes a transient
# `vitest.config.ts.timestamp-*.mjs` next to the config file at startup
# (vite's bundleAndLoadConfigFile path); the unprivileged `node` user
# below MUST own this directory or vitest aborts EACCES.
COPY --chown=node:node packages/contract-tests packages/contract-tests

# `/app/packages/contract-tests` itself was created by the earlier
# `COPY packages/contract-tests/package.json` step (owned by root);
# `COPY --chown` only sets ownership of the copied contents, not the
# pre-existing parent dir. Vitest writes the timestamp shim AS A
# SIBLING of vitest.config.ts so the directory itself must be writable.
RUN chown node:node /app/packages/contract-tests

WORKDIR /app/packages/contract-tests

# Vitest runs as the unprivileged `node` user that ships with node:*-alpine.
USER node

# `--run` mode — single pass, no watch, exits with non-zero on any
# failed/errored test. Invoke vitest's mjs entry directly via node:
#   - `pnpm exec vitest` would re-validate the corepack-pinned pnpm
#     against npmjs.org at runtime, requiring external internet from
#     inside openwhispr_internal AND being wholly unnecessary because
#     all deps are already installed.
#   - `node ./node_modules/.bin/vitest` fails because the bin shim is
#     a posix-sh script (pnpm install creates `#!/bin/sh` wrappers in
#     .bin/, not standalone Node scripts).
# Resolve the symlink target at install time and invoke vitest.mjs
# directly. The `node_modules/vitest/vitest.mjs` path is stable across
# vitest 1.x-4.x releases.
ENTRYPOINT ["node", "./node_modules/vitest/vitest.mjs", "run"]
