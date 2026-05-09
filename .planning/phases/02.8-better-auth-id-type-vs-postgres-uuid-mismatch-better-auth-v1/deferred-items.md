# Phase 02.8 — Deferred Items (out of scope per executor scope rules)

## Pre-existing typecheck errors

**File:** `packages/data/src/__tests__/0003_better_auth_tenant_defaults.test.ts:72,85`
**Errors:** TS2532 — Object is possibly 'undefined'.

Verified pre-existing on `main` (HEAD f66ebda) prior to Phase 02.8 changes via
`git stash && pnpm typecheck` reproduction. NOT introduced by the
`advanced.database.generateId: "uuid"` line in apps/api/src/auth.ts.

Triage candidates:
- Phase 02.9 cleanup
- Roll into a future plan that touches packages/data tests

## Pre-existing typecheck error in apps/api

**File:** `apps/api/src/__tests__/auth-trusted-origins.test.ts:43`
**Error:** TS2493 — Tuple type '[]' of length '0' has no element at index '0'.

Verified pre-existing on `main` (HEAD f66ebda) prior to Phase 02.8 changes.
NOT introduced by Phase 02.8.
