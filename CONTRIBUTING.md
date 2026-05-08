# Contributing to OpenWhispr Server

Thank you for considering a contribution. This repo enforces several constitutional rules mechanically; this guide tells you how to land your PR cleanly.

## Prerequisites

- Node 24.x (managed via `.nvmrc` / `.tool-versions` — use `nvm`, `fnm`, or Volta)
- pnpm 11.x (auto-installed via `corepack enable`)
- Docker / docker compose v2 (for `make dev`)
- `gh` CLI (for branch-protection setup, optional)

## Local setup

```bash
corepack enable
pnpm install
pnpm exec lefthook install   # Run automatically by `pnpm install` via the prepare script
```

## TDD discipline (TDD-01)

Tests First. Tests precede production code on every feature and every bugfix.

1. Write a failing test (commit: `test(<scope>): add failing test for X`).
2. Implement the minimum to pass (commit: `feat(<scope>): implement X`).
3. Refactor if needed (commit: `refactor(<scope>): clean up X`).

The PR template includes the **Tests First Checklist** — every box must be ticked. The `pr-checklist` CI job enforces this.

The advisory `lint-tdd` CI job flags PRs where production-code commits land before any test commit. It is annotation-only in v1; expect it to become blocking in Phase 2+.

## Conventional Commits + English only (DOCS-09)

All commit messages follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/) and contain ASCII English only — no Cyrillic.

Local enforcement:

- Lefthook `commit-msg` hook runs `commitlint --edit {1}` on every commit.
- Lefthook `pre-commit` hook runs `pnpm lint:english` and `biome check --write` on staged files.

CI enforcement:

- `commitlint` job runs against the full PR series.
- `lint-english` job scans the entire working tree.

The English-only rule applies to all committed source artifacts (code, docs, comments, identifiers, log keys, commit messages). The single allowlist exception is `packages/i18n/locales/<locale>/**` and `tests/fixtures/i18n/**`.

## Running the suite

```bash
make lint         # biome + lint-english
make typecheck    # tsc -p (every workspace)
make test         # vitest run --coverage (>= 85% lines / >= 80% branches)
pnpm test:mutation:incremental   # Stryker against changed files
```

## PR checklist

- [ ] Tests written first
- [ ] All `make test` checks pass locally
- [ ] PR template "Tests First Checklist" filled
- [ ] No Cyrillic outside `packages/i18n/locales/ru/**`
- [ ] Conventional Commit messages

## License of contributions

By contributing, you agree your work is licensed under Apache-2.0 (matches the repo).
