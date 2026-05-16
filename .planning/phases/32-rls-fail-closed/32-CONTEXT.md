# Phase 32: RLS fail-closed (CR-7 closure) — Context

**Gathered:** 2026-05-16
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss; user offline; advisor-agent handles grey-area)
**Source:** ROADMAP Phase 32 entry + `.planning/review/data.md` CR-01 + `.planning/review/REVIEW-INDEX.md` CR-7

<domain>
## Phase Boundary

Reverse migration `0003_better_auth_tenant_defaults.sql`'s role-default `app.tenant_id` GUC binding. Any query that escapes `withTenant()` on a tenant-scoped table MUST raise a Postgres permission error (RLS deny) instead of silently binding to default tenant.

Source finding: `.planning/review/data.md` CR-01 + HI-04. Migration `0003_better_auth_tenant_defaults.sql:46-57` does `ALTER ROLE openwhispr_app SET app.tenant_id TO '00000000-...'`. Every connection from the app role pre-binds the default tenant. Any query escaping `withTenant()` reads/writes default-tenant rows instead of being DENIED.

## Scope (in)

- New migration `packages/data/migrations/0018_rls_fail_closed.sql` (sequence 0017 already used by `0017_setup_state.sql`) reverses 0003:
  - `ALTER ROLE openwhispr_app RESET app.tenant_id;` (removes role-level default binding)
  - `ALTER TABLE <table> ALTER COLUMN tenant_id DROP DEFAULT;` for the 4 tables where DEFAULT was `current_setting('app.tenant_id')::uuid` per migration 0003: `users`, `sessions`, `account`, `verification` (research-verified; the other 12 tenant-scoped tables never had GUC-bound DEFAULTs)
  - RLS policy bodies updated to **silent-deny-read + raise-write** semantics: `current_setting('app.tenant_id', true) IS NOT NULL AND tenant_id = current_setting('app.tenant_id', true)::uuid`. SELECT without context returns empty result; INSERT/UPDATE/DELETE without context raises `new row violates row-level security policy`. Variant (a) chosen over raise-everywhere `missing_ok=false` because the latter would surface dozens of pre-existing routes that legitimately read empty result sets — those route fixes belong to Phase 41, not Phase 32.
- Update `packages/data/src/tenant-context.ts`:
  - Research confirms NO fallback-to-default-tenant path exists today — `withTenant()` is already clean. Phase 32's behaviour change is **migration-only**.
  - Document the new contract in JSDoc + add a defensive runtime assertion (callers that forget `withTenant()` now get either empty results on read or a typed PG error on write).
- Property test on real Postgres testcontainer (DISCIPLINE Rule 5): **16 tenant-scoped tables** × 4 ops × 2 contexts = **128 cases** (research-corrected from initial 11/88 estimate; the literal enumeration in `packages/data/src/schema/index.ts:25-44` has 16 entries). With-context → allow same-tenant rows. Without-context: SELECT → empty result (assert `rowCount === 0`); INSERT/UPDATE/DELETE → RAISES `42501` permission denied or `policy violation`. Reuse the existing testcontainer fixture `bootMigratedPostgres` from `packages/data/src/__tests__/helpers.ts` (has both `openwhispr_owner` BYPASSRLS and `openwhispr_app` no-BYPASSRLS roles ready).
- E2E test (DISCIPLINE Rule 3) in `tests/e2e/rls-fail-closed.spec.ts`: a synthetic test-only route that intentionally calls a WRITE op (INSERT) without `withTenant`. Assert: 500 + redacted error envelope. (A SELECT-bypass test would return 200 + empty array under variant (a) — that case is covered by the property test, not the E2E.)
- Update unit tests in `packages/data/src/__tests__/` documenting the new contract.

## Scope (out)

- Encryption-at-rest of Better Auth credential columns — that's Phase 33 (CR-8 closure). Phase 33 depends on Phase 32; this phase MUST land first.
- Tenant-plugin retirement (Phase 34) — does not depend on Phase 32 but is best done after RLS posture is fail-closed.
- Any production-code modifications outside `packages/data/src/{tenant-context.ts, schema/**, migrations/**, encryption/**}` + the E2E test.
- Bulk-fixing existing routes that may now break because they rely on the default-tenant fallback (these become explicit test failures the team must fix; any required route-level fix moves to a tracked follow-up).

</domain>

<decisions>
## Implementation Decisions

### Migration approach
- Forward-only migration `0018_rls_fail_closed.sql`. Drizzle migration runner already supports `ALTER ROLE ... RESET ...` + `DROP DEFAULT` + `ALTER POLICY`.
- Single migration file; one transaction is fine because the changes are metadata-only.
- The migration MUST be idempotent (re-runs are safe per DISCIPLINE Rule 5 implicit invariant).
- Fail-closed semantics: **silent-deny-read + raise-write** (variant (a) from research). SELECT without context returns 0 rows; INSERT/UPDATE/DELETE without context raises PG 42501. Variant (b) `missing_ok=false` was considered but rejected because it would surface dozens of pre-existing routes that legitimately read empty result sets — those route fixes belong to Phase 41.

### Rollback plan
- `down.sql` companion that restores 0003's behaviour (re-applies `ALTER ROLE ... SET app.tenant_id ...`). Documented but discouraged — explicit warning at top of `down.sql` that rollback re-introduces the fail-open posture.

### Testcontainer property test
- Use `@testcontainers/postgresql` (already in dev-deps per CLAUDE.md tech stack).
- Spin up a PG 17 container, apply ALL migrations (including 0017), seed 2 tenants with 1 row per tenant-scoped table per tenant.
- For each of 11 tables × 4 ops × 2 contexts = 88 cases: assert allow / raise as specified.
- Co-located: `packages/data/src/__tests__/rls-fail-closed.property.test.ts`.

### E2E approach
- Add a synthetic route to the test fixture (NOT to production routes) that intentionally calls `db` without `withTenant`. Assert it returns 500 + redacted error envelope.
- File: `tests/e2e/rls-fail-closed.spec.ts`.

### Discipline compliance
- Strict TDD: RED (property test asserts current main returns default-tenant rows for un-wrapped queries) → GREEN (migration 0017 + tenant-context.ts edits make the test pass) → REFACTOR.
- Coverage ≥ 90/90/90/90 on diff: the linter targets `packages/data/src/tenant-context.ts` + new property test file.
- E2E mandatory: `tests/e2e/rls-fail-closed.spec.ts`.
- No mocks of internal logic: real Postgres testcontainer, real Better Auth handler in E2E.
- Audit trail: PLAN.md + SUMMARY.md + REVIEW.md + VERIFICATION.md + `32-COVERAGE.md`.
- Passes Phase 31 lockers: every edit goes through lefthook + ci.yml lockers job.

</decisions>

<code_context>
## Existing Code Insights

- `packages/data/migrations/0003_better_auth_tenant_defaults.sql:46-57` is the regression source. Read it in full before writing 0017.
- `packages/data/src/tenant-context.ts` — single source of `withTenant()` semantics. Check for any fallback paths to `DEFAULT_TENANT_ID`.
- 11 tenant-scoped tables per `packages/data/src/schema/index.ts` `TENANT_SCOPED_TABLES` literal (from `.planning/review/data.md` LO-02). Verify the count matches in the property test fixture.
- Existing migration tests live at `packages/data/migrations/__tests__/`. Pattern reference for the migration test suite.
- Existing tenant-context tests at `packages/data/src/__tests__/tenant-context.test.ts` (if exists).

</code_context>

<specifics>
## Specific Ideas

- Migration filename: `0017_rls_fail_closed.sql` (sequential after the latest migration in `packages/data/migrations/`).
- Down migration: `0017_rls_fail_closed.down.sql` if the project follows up/down convention; otherwise document rollback in SUMMARY only.
- Property test file: `packages/data/src/__tests__/rls-fail-closed.property.test.ts`.
- E2E test file: `tests/e2e/rls-fail-closed.spec.ts` (vitest under `tests/e2e/vitest.e2e.config.ts` per 31-07 precedent).
- Documentation: `docs/security.md` section "RLS posture" updated with the fail-closed contract.

</specifics>

<deferred>
## Deferred Ideas

- Encryption-at-rest of credential columns (Phase 33).
- Route-level audit — Phase 32 may surface routes that rely on the default-tenant fallback; these become Phase 41 work.
- DISCIPLINE Rule 15 ("no plaintext secret columns in schema") — lands in Phase 33.

</deferred>
