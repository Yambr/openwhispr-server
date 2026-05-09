
## From Plan 02.7-02 execution (2026-05-09)

- **`apps/api/scripts/check-default-secrets.test.ts` (4 failures)** — pre-existing path-resolution defect: when invoked from `apps/api`, the tsx loader resolves the script as `apps/api/apps/api/scripts/check-default-secrets.ts` (ERR_MODULE_NOT_FOUND). Confirmed pre-existing via `git stash` + re-run before any Plan 02.7-02 changes. Out of scope for D-01; track for a follow-up infra plan (likely needs `path.resolve(__dirname, ...)` instead of relative path in the spawn).
- **Pre-existing typecheck noise** in `auth-schema-mapping.test.ts:21` (exactOptionalPropertyTypes) and `auth-trusted-origins.test.ts:43` (tuple index). Out of scope for Plan 02.7-02; not introduced by this plan.

## From Plan 02.7-03 execution (2026-05-09)

- **`apps/api/src/__tests__/seed-signup-non-2xx-loud.test.ts` (7 failures, "Body has already been read")** — uncommitted test file in working tree belongs to D-03 Layer A (signUp loud-fail), not D-02. Confirmed pre-existing via `git stash` (still fails — test file lives in working tree but signUp() implementation in `packages/data/src/seed/conformance.ts` reads `await res.text()` after `res.json()` was already consumed somewhere in the call chain). Belongs to a future Plan 02.7-04 (D-03A); explicitly out of scope for D-02.
- **error-handler.ts branch coverage 79.16%** (target 90%) — the missing branches are pre-existing lines 61-62 (Fastify schema-validation `fv.validation` path), NOT introduced by D-02. The new D-02 APIError branch (lines 81-101) is fully covered. Per CLAUDE.md scope boundary rule, pre-existing untested branches are out of scope.
