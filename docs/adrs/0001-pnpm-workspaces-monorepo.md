# ADR-0001: pnpm workspaces monorepo with Node 24 LTS

**Status:** accepted

**Date:** 2026-05-08

**Phase:** 0 — Repo Bootstrap & Constitutional CI

## Context

The OpenWhispr Server consists of multiple deployable units (Fastify API server, contract test harness, i18n resources, future frontend) that share TypeScript types, lint config, test config, and CI definitions. The team wants:

- A single git repo (no submodules, no polyrepos)
- Deterministic dependency installs that respect strict version pinning
- Fast monorepo install + workspace-scoped scripts
- Multi-arch Linux container builds (amd64 + arm64)

## Decision

We adopt **pnpm 11.x workspaces** as the monorepo tool with **Node 24 LTS** as the runtime engine.

Layout: `apps/*` for deployable services (`apps/api`), `packages/*` for shared libraries and harnesses (`packages/auth`, `packages/data`, `packages/litellm-client`, `packages/contract-tests`, `packages/i18n`).

Node version pinned via `.nvmrc` and `.tool-versions` to `24`. pnpm version pinned via `packageManager: "pnpm@11.0.8"` in root `package.json`.

## Consequences

- **Easier:** workspace-scoped scripts (`pnpm --filter ./packages/contract-tests test`); deterministic lockfile shared across all workspaces; single `pnpm install` updates every workspace; Trivy and Dependabot both natively understand pnpm.
- **Harder:** contributors must use `corepack enable` to activate the pinned pnpm version (vs. relying on a globally-installed npm). One additional step in CONTRIBUTING.md.
- **Risk:** pnpm 11 lockfile format may bump on a future major; mitigated by the `packageManager` pin which surfaces drift immediately on `pnpm install`.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| **npm workspaces** | Slower, less deterministic at our scale. |
| **yarn workspaces (v4 berry)** | Adds PnP complexity; Trivy/Dependabot integration weaker than pnpm. |
| **Nx / Turborepo monorepo orchestrators** | Adds a layer of caching/build-graph machinery we do not yet need; pnpm's `--filter` covers our v1 use cases. Reconsider in Phase 7+ when frontend lands. |
| **Polyrepo (separate API + contract-tests + i18n repos)** | Cross-repo type sharing is painful; PR coordination across repos slows iteration. |

## References

- `.planning/phases/00-repo-bootstrap-constitutional-ci/00-CONTEXT.md` Decisions D-01, D-02, D-03
- `.planning/phases/00-repo-bootstrap-constitutional-ci/00-RESEARCH.md` Standard Stack §pnpm, Node, TypeScript
- https://pnpm.io/workspaces
- https://nodejs.org/en/about/previous-releases (Node 24 LTS)
