# Phase 32 — Summary

**Status:** CLOSED 2026-05-16
**Source review:** `.planning/review/data.md` CR-01 + HI-04 → CRIT-FIX-01.
**Variant chosen:** silent-deny-read + raise-write (variant a) — per CONTEXT decisions D-Variant.

## What landed

Migration `packages/data/migrations/0018_rls_fail_closed.sql`:

1. `ALTER ROLE openwhispr_app RESET app.tenant_id` — reverses 0003:43-48 role-default GUC binding.
2. `ALTER TABLE … ALTER COLUMN tenant_id DROP DEFAULT` on `users`, `sessions`, `account`, `verification` — reverses 0003:51-57 column DEFAULTs.
3. `DROP POLICY … ; CREATE POLICY` for each of the 16 tenant-scoped tables, with new body `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`. The NULLIF cast pattern was chosen over the original CONTEXT proposal of an explicit `IS NOT NULL AND <> ''` AND-chain — empirical test failures showed PostgreSQL's RLS planner does NOT guarantee short-circuit evaluation of the AND chain, so the chain reached the `''::uuid` cast and raised on every read. NULLIF returns `NULL` for the empty-string case; `NULL::uuid` is `NULL`; `tenant_id = NULL` evaluates to `NULL` (treated as `FALSE` for both USING and WITH CHECK), giving silent-deny-read + raise-write cleanly.

Companion `0018_rls_fail_closed.down.sql` — documented rescue script, NOT in the journal.

`packages/data/src/tenant-context.ts` — JSDoc on `withTenant()` documents the Phase 32 contract: callers outside the helper get 0-rows on SELECT/UPDATE/DELETE and `42501` on INSERT. No runtime logic change.

`docs/security.md` §11 — operator-facing RLS posture section.

`.planning/ROADMAP.md` + `.planning/REQUIREMENTS.md` — prose corrections from the pre-flight stale numbers (11 tables / 88 cases → **16 tables / 128 cases**); Phase 32 line flipped to `[x]`; CRIT-FIX-01 closed.

## Atomic commit log

| SHA       | Plan  | Title                                                                                          |
| --------- | ----- | ---------------------------------------------------------------------------------------------- |
| `efbe50e` | 32-R  | docs(32): research synthesis                                                                   |
| `042507e` | 32-P  | docs(32): 4 sub-plans                                                                          |
| `04cc49d` | 32-01 | test(32-01): red — 0018 migration test                                                         |
| `988915e` | 32-01 | feat(32-01): green — 0018 migration applies fail-closed rls                                    |
| `897aeeb` | 32-01 | refactor(32-01): nullif-cast — short-circuit-safe rls policy body                              |
| `8ed2ff6` | 32-02 | test(32-02): 128-case property test confirms fail-closed posture (16x4x2)                      |
| `ae71f55` | 32-03 | docs(32-03): jsdoc on withtenant documents phase 32 fail-closed contract                       |
| `<this>`  | 32-04 | feat(32-04): e2e rls-fail-closed.test.ts + docs/security §11 + roadmap/req 16x128 fix          |

8 commits — within the orchestrator estimate of ~10-12.

## Verification

```
pnpm --filter @openwhispr/data exec vitest run \
  migrations/__tests__/0018-rls-fail-closed.test.ts \
  tests/unit/__tests__/rls-fail-closed.property.test.ts \
  tests/unit/__tests__/tenant-context.test.ts
→ 3 file passed (3) / 156 tests passed (156)

E2E=1 pnpm exec vitest run --config tests/e2e/vitest.e2e.config.ts \
  tests/e2e/rls-fail-closed.test.ts
→ 1 file passed (1) / 3 tests passed (3)
```

All passes. Lefthook pre-commit gates (biome, english, colocated-tests, lockers, phase-tag-comments, dockerfile-tls, ui-spec, tenant-context, web-typecheck) passed on every commit.

## Decisions worth flagging for downstream phases

- **D-1 (NULLIF over AND-chain):** Recorded in migration header + this SUMMARY. Phase 33 (envelope encryption) will inherit the policy bodies via `DROP POLICY` + `CREATE POLICY` on the encrypted-column tables — keep the NULLIF pattern.
- **D-2 (Variant a — silent-deny-read + raise-write):** Selected over variant (b) raise-everywhere because route-level audit (Phase 41) hasn't run yet; surfacing dozens of legitimate empty-read paths as 500s would block Phase 32 on unrelated route work. Phase 41 may later upgrade specific routes to use explicit `withTenant()` wrappers, at which point the deny-read paths become functionally identical to a raise.
- **D-3 (E2E uses real testcontainer + production migration pipeline, NOT a synthetic test route):** Per LOCKER-04 + CLAUDE.md Hard Rule 1, we did not add a synthetic `/api/_test/leak` route to production app code. The E2E connects directly to PG as `openwhispr_app` and exercises the RLS surface — same role topology + same migrations as the production stack.

## Open items moved out of Phase 32

See `32-DEFERRED.md` — empirical inventory of `apps/api`/`apps/worker` test failures under fail-closed RLS belongs to Phase 41 entry triage.

## Ready for next phase

Phase 33 (envelope encryption, CR-8 closure) depends on Phase 32 and is now unblocked. Recommended next milestone-step.
