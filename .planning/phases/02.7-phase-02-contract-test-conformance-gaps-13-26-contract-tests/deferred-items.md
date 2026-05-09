
## From Plan 02.7-02 execution (2026-05-09)

- **`apps/api/scripts/check-default-secrets.test.ts` (4 failures)** — pre-existing path-resolution defect: when invoked from `apps/api`, the tsx loader resolves the script as `apps/api/apps/api/scripts/check-default-secrets.ts` (ERR_MODULE_NOT_FOUND). Confirmed pre-existing via `git stash` + re-run before any Plan 02.7-02 changes. Out of scope for D-01; track for a follow-up infra plan (likely needs `path.resolve(__dirname, ...)` instead of relative path in the spawn).
- **Pre-existing typecheck noise** in `auth-schema-mapping.test.ts:21` (exactOptionalPropertyTypes) and `auth-trusted-origins.test.ts:43` (tuple index). Out of scope for Plan 02.7-02; not introduced by this plan.
