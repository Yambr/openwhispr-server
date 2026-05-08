# Phase 0: Repo Bootstrap & Constitutional CI - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-08
**Phase:** 00-repo-bootstrap-constitutional-ci
**Mode:** `--auto --chain` (auto-selected recommended defaults; chain into plan + execute)
**Areas discussed:** Repo layout, Tooling, CI workflows, English-only enforcement, TDD enforcement, Branch protection, Local dev, Licensing

---

## Repo layout

| Option | Description | Selected |
|--------|-------------|----------|
| pnpm workspaces monorepo | Single repo, multiple packages, deterministic lockfile, fast install | ✓ |
| npm workspaces | Built-in to Node, slower install, less feature-rich | |
| yarn berry | More features, more setup overhead | |
| Polyrepo | One repo per service | |

**Auto-selection:** pnpm workspaces. Reason: monorepo natively supports `apps/api` + `packages/contract-tests` + `packages/i18n` layout the project needs; pnpm is the fastest mainstream option in 2026 with deterministic lockfiles.

## Tooling — Linter

| Option | Description | Selected |
|--------|-------------|----------|
| Biome 2.x | Combined lint + format, single config, fast Rust core | ✓ |
| ESLint + Prettier | Mainstream, plugin ecosystem, slower, two configs | |

**Auto-selection:** Biome. Reason: simpler, faster, single-config; ESLint plugin ecosystem isn't load-bearing for this project.

## Tooling — Test runner

| Option | Description | Selected |
|--------|-------------|----------|
| Vitest 2.x | Native TS/ESM, fast watch, built-in coverage | ✓ |
| Jest | More mature, slower, heavier transform layer | |
| Node native test runner | Zero deps, less ergonomic | |

**Auto-selection:** Vitest. Reason: best DX for TS-native server, aligns with future Vite-based frontend.

## Tooling — Mutation testing

| Option | Description | Selected |
|--------|-------------|----------|
| Stryker Mutator (StrykerJS) | The mainstream JS mutation tool | ✓ |
| (none) | Skip mutation testing | |

**Auto-selection:** Stryker. Reason: required by REQUIREMENTS.md TEST-MUTATION-01.

## CI workflows

| Option | Description | Selected |
|--------|-------------|----------|
| Single big workflow | Everything in `ci.yml` | |
| Split: ci / security / nightly / release | Separation of concerns | ✓ |
| Reusable workflows | Most modular, more setup | |

**Auto-selection:** Split into ci / security / nightly / release. Reason: clear separation of concerns and matches the constitutional CI rule wording.

## English-only enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Review-only (no CI gate) | Cheap, error-prone | |
| CI-gated lint (Biome plugin or standalone script) | Mechanical, can't slip | ✓ |

**Auto-selection:** CI-gated lint. Reason: constitutional rule must be mechanical, not relying on review attention.

## TDD enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| PR template checklist | Visible reminder, not mechanical | ✓ (v1) |
| Commit-order heuristic | Detect production-code-before-test patterns | (advisory in v1, blocking later) |

**Auto-selection:** PR template checklist + advisory commit-order heuristic. Reason: both required by REQUIREMENTS.md TDD-01; checklist ships first, heuristic added as advisory in v1 and promoted later.

## Branch protection

| Option | Description | Selected |
|--------|-------------|----------|
| Documented in operations doc | Operator manually configures | |
| Reproducible via script | One-shot setup script | ✓ |

**Auto-selection:** Reproducible via script. Reason: operator UX — minimizes drift and config-as-code.

## Local dev entrypoint

| Option | Description | Selected |
|--------|-------------|----------|
| Just `pnpm` scripts | Simpler, less abstraction | |
| Top-level `Makefile` | Cross-tool entrypoint, doc-friendly | ✓ |

**Auto-selection:** Makefile. Reason: REQUIREMENTS.md DEVEX-01 specifies `make dev` / `make test`.

## Licensing

| Option | Description | Selected |
|--------|-------------|----------|
| Apache-2.0 | Permissive, contributor-friendly, patent grant | ✓ |
| MIT | Permissive, no patent grant | |
| AGPL-3.0 | Strong copyleft, may scare enterprise users | |

**Auto-selection:** Apache-2.0. Reason: project decision recorded in PROJECT.md / DOCS-07.

## Claude's Discretion

- Exact minor versions of pnpm/Node/Vitest/Biome/Stryker
- Husky vs Lefthook for git hooks
- English-only checker as Biome plugin vs standalone script
- Skeleton workspace creation for future-phase modules

## Deferred Ideas

- Self-hosted GPU runners → Phase 8
- Renovate over Dependabot → defer evaluation
- Codecov / Coveralls → v1.5
- Release-please / semantic-release → Phase 9
- Documentation site (Docusaurus / Starlight) → Phase 10
- `.devcontainer/` for Codespaces → v1.5
