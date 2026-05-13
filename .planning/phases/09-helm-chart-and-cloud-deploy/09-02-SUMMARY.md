---
phase: 09
plan: 02
subsystem: ci-gates
tags: [squawk, migrations, pr-gate, ci]
status: complete
completed: 2026-05-13
duration_minutes: 20
tasks_completed: 2
commits:
  - 1363bd2: squawk migration lint driver + fixtures (DEPLOY-04)
  - 1bbd1ed: lint-migrations.yml GHA workflow + coverage gate
---

# Phase 9 Plan 2: Squawk Migration Lint PR Gate Summary

`tools/lint-migrations.ts` — TypeScript squawk-cli driver — blocks PRs that introduce blocking-pattern migrations (`CREATE INDEX` without `CONCURRENTLY`, `ADD COLUMN NOT NULL` without default, `DROP COLUMN`, etc.). Wired into `.github/workflows/lint-migrations.yml`. 35 vitest tests, coverage 100/97.82/100/100 — above the 90/90/90/90 gate.

## What landed

- `tools/lint-migrations.ts` with explicit `BLOCKING_RULES` allowlist (16 canonical online-migration rules from squawkhq.com — `ban-drop-column`, `require-concurrent-index-creation`, `adding-required-field`, etc.). Driver enumerates new SQL via `git diff --diff-filter=A <since>...HEAD -- 'drizzle/**/*.sql'`, runs squawk per file with `json` reporter, post-filters JSON output to BLOCKING_RULES (everything else is informational and ignored).
- 5 fixtures (2 good, 3 bad) under `tools/fixtures/migrations/` covering concurrent-index, NOT VALID + VALIDATE, blocking-index, NOT NULL without default, DROP COLUMN.
- DROP COLUMN / DROP TABLE warning emitter on stderr (non-blocking) per pitfall #9.
- `.github/workflows/lint-migrations.yml` triggers on PR touching `drizzle/**/*.sql` or the driver itself; `fetch-depth: 0` so `--since origin/<base_ref>` resolves; runs vitest coverage gate on every event.
- pnpm scripts: `lint:migrations` + `test:lint-migrations` + analogous placeholders for `compose-chart-parity` (Plan 09-03).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan referenced `--rules` flag that squawk-cli v2.52 removed.**
- **Found during:** Task 1 first invocation of `npx squawk-cli@2 --rules ...`.
- **Issue:** Plan's `<interfaces>` block listed `--rules` (allowlist). Squawk migrated to `--exclude` (denylist) + `--include` (opt-in) in v2.x; there is no allowlist flag.
- **Fix:** Driver now runs squawk with default rule set + JSON reporter, post-filters the JSON to `BLOCKING_RULES` (explicit allowlist in TS). This is strictly stronger — newly-added blocking rules in future squawk versions remain ignored until explicitly added to BLOCKING_RULES.
- **Files modified:** `tools/lint-migrations.ts`
- **Commit:** `1363bd2`

**2. [Rule 1 - Bug] "Good" fixtures triggered squawk warnings (`require-timeout-settings`, `prefer-robust-stmts`).**
- **Found during:** Task 1 verification of `good-concurrent-index.sql`.
- **Issue:** Squawk's default rule set is much broader than the plan's pinned 12. The "good" fixture would still emit Warning-level diagnostics for missing `set lock_timeout` / `prefer-robust-stmts`.
- **Fix:** Post-filter to BLOCKING_RULES allowlist; ignore all other rules. The fixtures are unchanged — they remain canonical "good" examples of the blocking-rule subset.
- **Test coverage:** added explicit assertion that BLOCKING_RULES contains the canonical entries AND that noisy rules (`require-timeout-settings`, `prefer-robust-stmts`) are absent.

### Auth gates

None.

## Verification

- `pnpm exec tsx tools/lint-migrations.ts -- tools/fixtures/migrations/good-concurrent-index.sql` → exit 0, `✓` prefix.
- `pnpm exec tsx tools/lint-migrations.ts -- tools/fixtures/migrations/bad-blocking-index.sql` → exit 1, `[require-concurrent-index-creation]` diagnostic.
- `pnpm exec tsx tools/lint-migrations.ts -- tools/fixtures/migrations/bad-drop-column.sql` → exit 1, `[ban-drop-column]`.
- `pnpm exec tsx tools/lint-migrations.ts -- tools/fixtures/migrations/bad-add-not-null-without-default.sql` → exit 1, `[adding-required-field]`.
- `pnpm test:lint-migrations` → 35/35 pass, coverage 100/97.82/100/100.
- `actionlint .github/workflows/lint-migrations.yml` → exit 0.

## Self-Check: PASSED

Files created:
- FOUND: tools/lint-migrations.ts
- FOUND: tools/lint-migrations.test.ts
- FOUND: tools/fixtures/migrations/good-concurrent-index.sql
- FOUND: tools/fixtures/migrations/good-not-valid-then-validate.sql
- FOUND: tools/fixtures/migrations/bad-blocking-index.sql
- FOUND: tools/fixtures/migrations/bad-add-not-null-without-default.sql
- FOUND: tools/fixtures/migrations/bad-drop-column.sql
- FOUND: .github/workflows/lint-migrations.yml

Commits: FOUND 1363bd2, 1bbd1ed.
