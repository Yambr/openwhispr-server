---
phase: 31-constitutional-lockers
plan: 02
subsystem: lockers
tags: [locker-02, tdd, tooling, lint, type-suppressions]
requires: []
provides:
  - tools/lint-no-suppressions.ts
  - tools/lint-no-suppressions.allowlist.txt
  - pnpm-script:lint:no-suppressions
  - pnpm-script:test:lint-no-suppressions
affects:
  - package.json
tech-stack:
  added: []
  patterns:
    - regex-line-scan-locker (mirrors tools/lint-dockerfile-tls.ts)
    - line-granular-allowlist (`<posixFile>:<lineNumber>` keys)
key-files:
  created:
    - tools/lint-no-suppressions.ts
    - tools/lint-no-suppressions.test.ts
    - tools/lint-no-suppressions.allowlist.txt
    - tools/lint-no-suppressions/fixtures/violates.ts.fixture
    - tools/lint-no-suppressions/fixtures/clean.ts.fixture
    - tools/lint-no-suppressions/fixtures/expect-error-valid.ts.fixture
    - tools/lint-no-suppressions/fixtures/expect-error-malformed.ts.fixture
  modified:
    - package.json
decisions:
  - "fixtures committed as `.ts.fixture` so biome's `noTsIgnore` autofix does not rewrite their literal suppression tokens; tests stage them as `.ts` into a tmp scan root"
  - "line-granular allowlist (`<posixFile>:<lineNumber>`) chosen over file-level to keep seed 1:1 with regex hits and prevent silent re-introduction in the same file"
  - "test paths excluded from scan scope (`*.test.ts`, `__tests__/**`) — tests legitimately use suppressions for negative-typing assertions"
  - "9 hits in `apps/worker/src/db/app-pool.ts` tagged `issue-31-debt-suppression-pg-typing` (Phase 32 RLS owns the fix); `apps/api/src/index.ts:288` tagged `issue-31-debt-suppression-tx-bridge`"
metrics:
  duration_seconds: 671
  tasks_completed: 2
  files_created: 7
  files_modified: 1
  commits: 3
  completed: 2026-05-16
---

# Phase 31 Plan 02: LOCKER-02 `lint-no-suppressions.ts` Summary

**One-liner:** Regex-based blocking linter refusing `as any`, `as unknown as`, `@ts-ignore`, `@ts-nocheck`, and malformed `@ts-expect-error` (without `issue-NNNN: <reason>` suffix) across `apps/*/src/**` + `packages/*/src/**`; line-granular allowlist seeded with exactly the 36 current-main hits (10 `as any` + 26 `as unknown as`; zero `@ts-ignore`/`@ts-nocheck`/`@ts-expect-error`).

## Closes

- **LOCKER-02** (DISCIPLINE Rule 12).

## What Was Built

### `tools/lint-no-suppressions.ts`

Mirrors `tools/lint-dockerfile-tls.ts` shape: `[rootDir]` positional argv, exit codes 0/1/2, allowlist-aware. Exports `findViolations`, `readAllowlist`, `seedAllowlist`, `main`, `ALLOWLIST_FILE`, `Violation`.

**Forbidden patterns** (first-match-wins per line):

| Label | Regex | Remediation |
|-------|-------|-------------|
| `as-any` | `\bas\s+any\b` | Narrow the type or add a typed-fallback. |
| `as-unknown-as` | `\bas\s+unknown\s+as\b` | Reserve for verified boundaries; allowlist with issue-NNNN. |
| `ts-ignore` | `\/\/\s*@ts-ignore\b` | Convert to `@ts-expect-error issue-NNNN: <reason>`. |
| `ts-nocheck` | `\/\/\s*@ts-nocheck\b` | Convert to per-line `@ts-expect-error`. |
| `expect-error-malformed` | `\/\/\s*@ts-expect-error(?!\s+issue-\d+:\s+\S)` | Format: `// @ts-expect-error issue-NNNN: short reason`. |

**Scope:** `apps/*/src/**/*.{ts,tsx}` + `packages/*/src/**/*.{ts,tsx}`. Excludes `node_modules`, `dist`, `coverage`, `.next`, `.stryker-tmp`, `reports`, `build`, `__generated__`, and `*.test.ts` / `*.spec.ts` / `__tests__/**` (tests need suppressions for negative-typing assertions).

**Allowlist:** Line-granular keys `<posixFile>:<lineNumber>`. Lines beginning with `#` or blank are skipped; inline `# rationale` after the key is stripped. The `--seed-allowlist` flag writes current findings to the file with a `# issue-31-debt-suppression` tag for one-shot bootstrapping.

### `tools/lint-no-suppressions.allowlist.txt`

Seeded with **36 entries** (matches 31-RESEARCH §Q9 inventory exactly):

| Tag | Count | Files |
|-----|-------|-------|
| `issue-31-debt-suppression` | 26 | `apps/api/*`, `apps/web/*`, `packages/data/*`, `apps/worker/src/jobs/reconciliation-discrepancy.ts` |
| `issue-31-debt-suppression-pg-typing` | 9 | `apps/worker/src/db/app-pool.ts` (lines 61, 70, 74, 78, 110, 121, 128, 136, 142) |
| `issue-31-debt-suppression-tx-bridge` | 1 | `apps/api/src/index.ts:288` |

The 9 `pg-typing` entries are deliberately tagged distinctly because Phase 32 RLS work owns the fix; they remain in the allowlist post-31. The `tx-bridge` entry intersects Phase 32 as well and stays out of the 31-08 bulk-fix scope per the plan's explicit OUT-OF-SCOPE clause.

### `package.json`

Added two scripts:

- `lint:no-suppressions` — `tsx tools/lint-no-suppressions.ts`
- `test:lint-no-suppressions` — vitest run with `--coverage` thresholds at 90/90/90/90.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | RED — fixtures + failing test import | `ba4cf1c` | `tools/lint-no-suppressions.test.ts`, 4 `*.ts.fixture` files |
| 2 | GREEN — implement linter, seed allowlist, scripts | `651965f` | `tools/lint-no-suppressions.ts`, `tools/lint-no-suppressions.allowlist.txt`, `package.json` |
| 3 (REFACTOR, deviation) | rephrase header doc to survive biome autofix | `3623ec9` | `tools/lint-no-suppressions.ts` |

## Verification

- `pnpm test:lint-no-suppressions` → **18 tests pass; coverage 98.63 stmts / 96.15 branches / 100 funcs / 98.5 lines** (all four axes ≥ 90).
- `pnpm lint:no-suppressions` → exit 0 against current main (36 hits absorbed by seeded allowlist).
- Synthetic violation `const x = "y" as any;` outside allowlist → exit 1 (verified via tmp-dir).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixture files rewritten by biome `noTsIgnore` autofix on commit**

- **Found during:** Task 1 (RED commit attempt)
- **Issue:** Lefthook pre-commit ran biome which auto-replaced literal `@ts-ignore` tokens inside `tools/lint-no-suppressions/fixtures/violates.ts` with `@ts-expect-error`, breaking the RED test's expected label order.
- **Fix:** Rename all four fixtures from `*.ts` to `*.ts.fixture`. Biome only matches by extension (`*.{ts,tsx,...}`), so the fixtures pass through unchanged. The test stages them with the canonical `.ts` extension into a `mkdtempSync` scan root, where biome never runs.
- **Files modified:** `tools/lint-no-suppressions/fixtures/{violates,clean,expect-error-valid,expect-error-malformed}.ts.fixture`, `tools/lint-no-suppressions.test.ts` (`stageFixture` renames on copy).
- **Commit:** `ba4cf1c`

**2. [Rule 3 - Blocking] Biome rewrote a literal `@ts-ignore` token inside the linter's own header docstring**

- **Found during:** Task 2 (GREEN commit)
- **Issue:** After committing `lint-no-suppressions.ts` with literal `@ts-ignore` in the header doc-comment bullet list, biome's `noTsIgnore` autofix silently rewrote it to `@ts-expect-error` and broke the bullet's logical flow.
- **Fix:** Rephrase header bullets to describe the patterns by name without containing the literal directive token (e.g., "ts-ignore comment" instead of `// @ts-ignore`). The actual `FORBIDDEN` regex array uses string literals via `/\/\/\s*@ts-ignore\b/`, which biome leaves untouched.
- **Files modified:** `tools/lint-no-suppressions.ts` (header doc only; behavior unchanged).
- **Commit:** `3623ec9` (3rd commit; the plan's optional REFACTOR slot, repurposed as a doc-rot fix).

### Architectural deviations (Rule 4)

None.

## Authentication Gates

None — no external services touched.

## Known Stubs

None. Linter is fully functional, tests fully wired, allowlist seeded with real findings.

## Out of Scope (deferred per plan)

- Bulk-fix of the 36 seeded debt entries (Plan 31-08, except `apps/api/src/index.ts` and `apps/worker/src/db/app-pool.ts` which are reserved for Phase 32 RLS).
- DISCIPLINE Rule 12 prose codification (Plan 31-07).
- Lefthook + CI wiring (Plan 31-07).
- E2E case for synthetic violation (Plan 31-07, `tests/e2e/lockers.spec.ts`).
- Net-addition guard (LOCKER-09 in Plan 31-07).

## Threat Flags

None — this plan adds a regex linter and an allowlist file; no new network surface, auth path, file-access pattern, or schema change.

## Self-Check: PASSED

- `tools/lint-no-suppressions.ts` exists: FOUND
- `tools/lint-no-suppressions.test.ts` exists: FOUND
- `tools/lint-no-suppressions.allowlist.txt` exists with 36 path entries: FOUND
- All 4 fixture files exist: FOUND
- `package.json` contains `lint:no-suppressions` + `test:lint-no-suppressions`: FOUND
- Commits `ba4cf1c`, `651965f`, `3623ec9` on HEAD: FOUND
- `pnpm test:lint-no-suppressions` → 18/18 pass, 90/90/90/90 met: PASS
- `pnpm lint:no-suppressions` → exit 0: PASS
- Synthetic violation → exit 1: PASS
- Working tree clean: PASS
