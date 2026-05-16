# Phase 32 — Coverage Delta

**Generated:** 2026-05-16
**Diff scope:** every file changed under Phase 32 commits.

## Files added

| File | Lines | Tests | Coverage (lines / branches / functions / statements) |
| --- | --- | --- | --- |
| `packages/data/migrations/0018_rls_fail_closed.sql` | 213 | 22 (migration test) | N/A (SQL DDL — coverage measured via assertion-of-effect) |
| `packages/data/migrations/0018_rls_fail_closed.down.sql` | 22 | 0 (rescue-only script) | N/A — operator-run rollback, not exercised in normal flow |
| `packages/data/migrations/__tests__/0018-rls-fail-closed.test.ts` | 112 | 22 | self-covering test file (vitest excludes test files from coverage by default) |
| `packages/data/tests/unit/__tests__/rls-fail-closed.property.test.ts` | 437 | 128 | self-covering test file |
| `tests/e2e/rls-fail-closed.test.ts` | 178 | 3 | self-covering test file |

## Files modified

| File | Change | Tests covering | Coverage post-change |
| --- | --- | --- | --- |
| `packages/data/src/tenant-context.ts` | +28 lines of JSDoc; 0 runtime logic changes | `tenant-context.test.ts` (6 tests, including new Phase 32 doc-presence test) | 100/100/100/100 (no executable code added) |
| `packages/data/tests/unit/__tests__/tenant-context.test.ts` | +21 lines (1 new doc-presence test) | self-covering | self-covering |
| `packages/data/migrations/meta/_journal.json` | +7 lines (idx 18 entry) | exercised by `bootMigratedPostgres()` migrate() run | N/A — JSON manifest |
| `docs/security.md` | +44 lines (§11 RLS posture) | N/A — documentation | N/A |
| `.planning/ROADMAP.md` | Phase 32 prose + success criteria 1+2 updated to 16-tables × 128 cases + closed flag | N/A | N/A |
| `.planning/REQUIREMENTS.md` | CRIT-FIX-01 row + detail line updated | N/A | N/A |

## Per-package floor compliance (Phase 32 diff)

- `packages/data` — diff coverage floor: `tenant-context.ts` is documentation-only (no new executable code). The migration test (`0018-rls-fail-closed.test.ts`) and property test (`rls-fail-closed.property.test.ts`) are themselves the new artifacts; both pass with all assertions green. **Floor ≥ 90/90/90/90 met by virtue of zero new executable lines outside test files.**
- `tests/e2e` — diff coverage: new `rls-fail-closed.test.ts` is self-covering; 3/3 GREEN under `E2E=1`.

## Test counts

| Tier | Tests added | Tests passing |
| --- | --- | --- |
| Migration test (`packages/data/migrations/__tests__/0018-rls-fail-closed.test.ts`) | 22 | 22 / 22 |
| Property test (`packages/data/tests/unit/__tests__/rls-fail-closed.property.test.ts`) | 128 | 128 / 128 |
| Unit (`tenant-context.test.ts`) | 1 (doc-presence) | 6 / 6 (full file) |
| E2E (`tests/e2e/rls-fail-closed.test.ts`) | 3 | 3 / 3 |
| **Total** | **154** | **154 / 154** |

## Notes

- Per DISCIPLINE Rule 7, the verification gate requires `make e2e-test` (or hermetic equivalent) GREEN. Local run via `E2E=1 pnpm exec vitest run --config tests/e2e/vitest.e2e.config.ts tests/e2e/rls-fail-closed.test.ts` returned 3/3 PASS in 1.89s.
- The migration is forward-only; the companion `.down.sql` is a documented rescue script (NOT in the journal) per the Phase 32 plan.
- Phase 32 introduces zero new executable code in production paths — every test failure that surfaces against `apps/api` or `apps/worker` post-migration belongs to Phase 41 per CLAUDE.md Hard Rule 1 and is tracked in `32-DEFERRED.md`.
