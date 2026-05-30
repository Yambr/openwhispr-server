---
quick_id: 260530-sqw
slug: squawk-prewarm-flake
date: 2026-05-30
status: in-progress
---

# Quick Task: Fix lint-migrations squawk cold-fetch CI flake

## Problem

The `lint-migrations` workflow's "Vitest — squawk driver coverage gate" step
runs `tools/lint-migrations.test.ts`, whose `main()` integration tests shell
`npx --yes squawk-cli@2.55.0` against the bad-* fixtures and expect exit 1
(blocking diagnostics emitted). On a COLD CI runner the first `npx` spawn
must download the squawk binary; if that download hasn't resolved when the
spawn returns, stdout is empty → no diagnostics parsed → exit 0 where the
test expects 1 → false-red. GREEN locally (squawk warm) / RED on CI.

Confirmed pre-existing: the version pin (2 → 2.55.0, PR #39) was correct;
the residual red is the cold-fetch race, NOT a wrong version. Non-required
check (required = lint + typecheck only), so it never blocked merges — but
it's a persistent red squawk on PRs that touch migrations/tools.

## Fix (enterprise-grade — pre-warm, not retry/skip)

Add a dedicated "Pre-warm squawk-cli binary" step to
`.github/workflows/lint-migrations.yml` BEFORE the vitest step. It runs
`npx --yes squawk-cli@<ver> --version` once, serially, so the binary is in
the npx cache before the parallel `main()` spawns. The version is parsed
from the tool's single source of truth (`SQUAWK_VERSION` in
`tools/lint-migrations.ts`) via grep, so the warming step and the tool can
never drift to different versions.

NOT done: no `--no-verify`, no test skip, no retry-loop hack, no version
downgrade. The download cost is paid once up front instead of inside a
test timeout.

## Surface

- `.github/workflows/lint-migrations.yml` — new pre-warm step.
- `tools/lint-migrations.test.ts` — 4 new regression tests locking the
  single-source-of-truth invariant: the warming step exists, runs before
  the coverage gate, uses `npx --yes squawk-cli@${SQUAWK_VERSION}`, and the
  version the workflow grep extracts equals the tool's `SQUAWK_VERSION`.

## Verification

- New tests GREEN (4 pass); full `lint-migrations.test.ts` 40 pass.
- `actionlint .github/workflows/lint-migrations.yml` exit 0.
- YAML parses.
- `pnpm test:all` green for the pre-push evidence gate (never --no-verify).
- CI: the `lint-migrations` check goes green on the PR (the actual proof
  the cold-fetch is gone — verified on the PR, not just locally).
