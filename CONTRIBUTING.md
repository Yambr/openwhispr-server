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

Two canonical aggregate targets. Prefer these over chaining the
sub-targets manually — they enforce the same ordering CI uses.

```bash
make verify        # fast PR loop (~3–5 min): lockers + lint + typecheck + tests
make release-gate  # full pre-tag sweep (~30–45 min): verify + contracts +
                   # compose up + smoke + e2e-cjm + load-smoke
```

Sub-targets (for fix-until-green loops on a single failing stage):

```bash
make lint                 # biome + lint-english
make typecheck            # tsc -p (every workspace)
make test                 # vitest run --coverage (>= 85% lines / >= 80% branches)
make contract-test        # wire-surface contracts (mock-LiteLLM)
make smoke                # vitest probes against live https://*.localhost
make e2e-cjm              # Playwright + Cucumber on a hermetic compose project
make load-smoke           # k6 plateau (Speaches + mock-LiteLLM, ≤5 VU × ≤60 s)
pnpm test:mutation:incremental   # Stryker against changed files
```

Per-package filtered runs use `--project=<name>` so workspace-wide
projects (tests/integration, tests/self-tests, …) don't get pulled
into a package run:

```bash
pnpm --filter @openwhispr/api    test   # 147 files / 1299 tests, ~98s
pnpm --filter @openwhispr/worker test   # ~20s
pnpm --filter @openwhispr/web    test   # 65 files / 963 tests, ~15s
pnpm --filter @openwhispr/data   test   # testcontainers, ~minutes
```

If the dev compose stack is up (`make up-with-dev-tools`), three
docker-touching self-tests in `tests/self-tests/` auto-skip with a
clear "Test Files 3 skipped" report — they need exclusive host ports
that the dev stack already owns. Stop the dev stack first if you need
the self-tests to actually run.

## PR checklist

- [ ] Tests written first
- [ ] `make verify` passes locally
- [ ] `make release-gate` passes locally for PRs touching compose/,
      charts/, wire-schemas, or any auth-related route
- [ ] PR template "Tests First Checklist" filled
- [ ] No Cyrillic outside `packages/i18n/locales/ru/**`
- [ ] Conventional Commit messages

## License of contributions

By contributing, you agree your work is licensed under FSL-1.1-ALv2
(matches the repo as of [ADR-0013](./docs/adrs/0013-fsl-relicense.md),
effective 2026-05-15). Pre-relicense contributions remain under
Apache-2.0 via the `pre-fsl-relicense-2026-05-15` annotated tag — see
the [Recovery section of ADR-0013](./docs/adrs/0013-fsl-relicense.md#recovery-for-downstream-consumers-who-need-to-stay-on-apache-20)
for the rebase-off-the-tag one-liner.

## Developer Certificate of Origin (DCO)

Every commit must carry a `Signed-off-by:` trailer attesting to the
[Developer Certificate of Origin v1.1](https://developercertificate.org/).
This is a lightweight per-commit affirmation — no CLA, no per-contributor
signing ceremony — that the contributor has the right to submit the work
under the project's outbound license (FSL-1.1-ALv2 with delayed
Apache-2.0 future grant).

Add the trailer to every commit with `git commit --signoff` (or
`git commit -s`). Configure git globally to add it automatically:

```bash
git config --global format.signoff true
# or per-repository:
git config --local format.signoff true
```

The resulting commit message ends with:

```
Signed-off-by: Your Name <your.email@example.com>
```

The CI DCO bot enforces this on every PR after the cutoff SHA (filled
in once the Phase 15-04 history-scrub force-push lands; see
[`.github/dco.yml`](.github/dco.yml) and
[ADR-0013 § Retroactive consent](./docs/adrs/0013-fsl-relicense.md#retroactive-consent)).
Commits at or before the cutoff are grandfathered into the FSL grant by
the contributor consent tracking issue referenced in ADR-0013.

If you forgot to sign off and need to add it retroactively to your
branch:

```bash
# Re-sign the last commit:
git commit --amend --signoff

# Re-sign every commit on a feature branch off main:
git rebase --signoff main
```
