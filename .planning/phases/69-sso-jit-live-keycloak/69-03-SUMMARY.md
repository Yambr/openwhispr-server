<!-- SPDX-License-Identifier: FSL-1.1-ALv2 -->
---
phase: 69-sso-jit-live-keycloak
plan: 03
subsystem: auth
tags: [better-auth, oidc, jit, sso, databaseHooks, mapProfileToUser, rls, audit-log, multi-tenancy]

# Dependency graph
requires:
  - phase: 69-01
    provides: resolveJitDecision pure resolver + readJitConfig loader (oidc-jit-resolver.ts / oidc-jit-config.ts)
  - phase: 69-02
    provides: 3 sso.jit.* audit actions + zod payload schemas + migration 0032 (audit.ts / audit_log enum)
provides:
  - "makeMapProfileToUser — the web genericOAuth claim-projection seam (only raw-claim seam; projects {tenantId,role})"
  - "buildJitDatabaseHooks — the 4 user.{create,update}.{before,after} hooks (fire on web + desktop create paths)"
  - "JitRejectionError — typed rejection carrying the RejectionCode; error-handler maps it to 403/400"
  - "tenantId user.additionalField (input:false, NO defaultValue) so the adapter forwards a JIT-projected tenant"
  - "sso.jit.rejected made writable through recordAudit (per-action forbidden-key carve-out for the `code` enum)"
affects: [69-04 (desktop bearer-mint JIT seam — shares the resolver + the same databaseHooks, no auth.ts overlap), 69-05 (live-Keycloak e2e asserts sso.jit.user.created verbatim)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Better Auth mapProfileToUser as the single web raw-claim seam delegating to the shared pure resolver (D-69-1)"
    - "databaseHooks create/update before/after with POST-commit own-tx audit emission (D-69-2 deviation)"
    - "Per-action forbidden-key allowlist in recordAudit (action,key) so closed non-secret enums may reuse otherwise-forbidden key names"

key-files:
  created:
    - apps/api/src/lib/oidc-jit-hooks.ts
    - apps/api/tests/integration/auth-jit-hooks.test.ts
    - apps/api/tests/integration/jit-rejections.test.ts
  modified:
    - apps/api/src/auth.ts
    - apps/api/src/error-handler.ts
    - apps/api/src/lib/audit.ts

key-decisions:
  - "tenantId additionalField has NO defaultValue (defaultValue:null would null the GUC-backed tenant_id DEFAULT and break non-JIT email/password signups)"
  - "JitRejectionError code is the canonical {error:<code>} wire message (closed non-PII enum, safe to surface, doubles as i18n key)"
  - "update.before detects mode-6 by looking the id up UNDER the incoming (freshly-resolved) tenant — RLS makes a not-found-there an unambiguous tenant-mismatch signal"
  - "recordAudit gains an (action,key) forbidden-key carve-out so sso.jit.rejected can carry its `code` enum"

patterns-established:
  - "Pattern: shared pure resolver invoked at exactly one web seam (mapProfileToUser), projected fields read by databaseHooks"
  - "Pattern: after-hooks open a fresh withTenant tx for audit (post-commit, documented D-69-2 deviation from audit-iff-commit)"

requirements-completed: [SSO-IMPL-03, SSO-IMPL-04]

# Metrics
duration: 28min
completed: 2026-05-29
---

# Phase 69 Plan 03: SSO JIT auth.ts wiring Summary

**Better Auth `mapProfileToUser` + 4 `databaseHooks` wired in auth.ts to JIT-provision OIDC users with a resolved tenant+role, re-sync returning-user roles, reject mode-6 tenant mismatch, and emit the 3 no-PII `sso.jit.*` audit events — with the 5 rejection codes mapped to 403/400.**

## Performance

- **Duration:** ~28 min
- **Started:** 2026-05-29T02:21Z
- **Completed:** 2026-05-29T02:49Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 9 (3 created, 6 modified)

## Accomplishments
- `oidc-jit-hooks.ts`: `makeMapProfileToUser` (web claim-projection seam calling the already-built `resolveJitDecision`, projecting `{tenantId, role}`) + `buildJitDatabaseHooks` (the 4 create/update before/after hooks) + typed `JitRejectionError`.
- `auth.ts`: `readJitConfig()` guard; per-provider `mapProfileToUser` via `oidcProviders.map(...)`; guarded top-level `databaseHooks` spread; `tenantId` `user.additionalField` (input:false, **no** defaultValue, closing A3).
- First-time JIT create lands the resolved tenant+role on a real `users` row; returning admin with a revoked group is re-synced to default; a returning user presenting a changed tenant claim is rejected `forbidden_tenant_mismatch`.
- The 3 `sso.jit.*` events each write a no-PII `audit_log` row (create.after / update.after POST-commit own-tx; rejection path under DEFAULT_TENANT_ID, actor null).
- The 5 rejection codes map to HTTP (`forbidden_*` → 403, `invalid_oidc_profile` → 400) via the centralized error-handler with the canonical `{error:<code>}` envelope.
- Integration tests on real Postgres+PgBouncer+Valkey (testcontainers, **no internal mocks**) assert the persisted `tenant_id`/`role` via BYPASSRLS owner SELECT + the 3 audit events + 5 rejection codes + mode-5 downgrade.

## Task Commits

Each task was committed atomically (TDD RED+GREEN landed together per CLAUDE.md "fix lands with its tests in the same commit"):

1. **Task 1: oidc-jit-hooks.ts + auth.ts wiring (mapProfileToUser + 4 databaseHooks + tenantId additionalField)** — `ab84e946` (feat)
2. **Task 2: 5 rejection codes → HTTP 403/400 + writable sso.jit.rejected audit** — `0ccc0edc` (feat)
3. **Branch-coverage strengthening for oidc-jit-hooks.ts (≥90 on the diff)** — `3306f919` (test)

## Files Created/Modified
- `apps/api/src/lib/oidc-jit-hooks.ts` (created) — web seam + 4 databaseHooks + JitRejectionError + RLS-scoped existing-identity lookup.
- `apps/api/src/auth.ts` (modified) — readJitConfig guard, per-provider mapProfileToUser, guarded databaseHooks spread, tenantId additionalField.
- `apps/api/src/error-handler.ts` (modified) — JitRejectionError → 403/400 branch with {error:<code>} envelope.
- `apps/api/src/lib/audit.ts` (modified) — per-action forbidden-key carve-out so sso.jit.rejected can carry `code`.
- `apps/api/tests/integration/auth-jit-hooks.test.ts` (created) — real-PG hook lifecycle assertions + branch coverage.
- `apps/api/tests/integration/jit-rejections.test.ts` (created) — HTTP mapping (via app.inject) + sso.jit.rejected audit emission.
- `apps/api/tests/unit/plan-52-05-auth-typecheck.test.ts` (modified) — characterization assertion updated to the `.map()` config form.
- `tools/lint-no-hardcode.allowlist.txt` / `tools/lint-no-suppressions.allowlist.txt` (modified) — auth.ts allowlist line-drift bumps.

## Decisions Made
- **tenantId additionalField carries NO defaultValue.** Better Auth's `parseInputData` injects an additionalField's `defaultValue` on every create; a `defaultValue:null` therefore wrote `tenant_id = NULL` and overrode the rolconfig-bound DB DEFAULT, breaking non-JIT email/password signups (NOT-NULL violation). Omitting the default leaves the field absent from non-JIT inserts → the GUC-backed DEFAULT applies; the OAuth-projected value flows through `createUser` (which bypasses `parseInputData`).
- **JitRejectionError `code` is the wire message.** The canonical envelope is strictly `{error:<string>}`; the rejection code is a closed non-PII enum, so it is the message verbatim (and the i18n lookup key).
- **mode-6 detection via RLS-scoped lookup.** `update.before` reads the existing row under the incoming (freshly-resolved) tenant; the users RLS policy (`tenant_id = current_setting('app.tenant_id')`) makes a not-found-under-incoming-tenant an unambiguous tenant-mismatch signal.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `sso.jit.rejected` was structurally unwritable through recordAudit**
- **Found during:** Task 2 (rejection audit emission)
- **Issue:** Plan 69-02 defined the `sso.jit.rejected` payload with a `code` key, but `recordAudit`'s `FORBIDDEN_AUDIT_KEYS` sweep unconditionally rejects `code` (the OAuth authorization-code secret). Every `recordAudit(..., "sso.jit.rejected", {code})` therefore threw "audit payload contains forbidden key: code" — the SPEC-mandated action could never write a row (latent bug from 69-02, not caught by its isolated schema tests).
- **Fix:** Added a per-action `(action,key)` forbidden-key allowlist in `audit.ts` permitting `code` ONLY for `sso.jit.rejected` (where it is a `.strict()`-validated closed non-secret enum). `code` stays forbidden for every other action; OAuth-secret protection is unchanged.
- **Files modified:** apps/api/src/lib/audit.ts
- **Verification:** jit-rejections integration test asserts one row per code; the 48 existing audit unit tests + 31 69-02 sso-payload tests stay green.
- **Committed in:** `0ccc0edc`

**2. [Rule 1 - Bug] tenantId additionalField defaultValue:null broke non-JIT signups**
- **Found during:** Task 1 (envelope-at-rest regression)
- **Issue:** Declaring `tenantId` with `defaultValue:null` (mirroring `role`) made Better Auth inject `tenant_id = NULL` on the email/password sign-up INSERT, overriding the GUC-backed column DEFAULT → NOT-NULL violation (`better-auth-envelope-at-rest.test.ts` went red).
- **Fix:** Removed `defaultValue` from the tenantId additionalField; left `input:false`. Non-JIT inserts omit the column → DB DEFAULT applies; the OAuth-projected value still flows via `createUser`.
- **Files modified:** apps/api/src/auth.ts
- **Verification:** better-auth-envelope-at-rest.test.ts green again; auth-jit-hooks first-time-create asserts the projected tenant lands.
- **Committed in:** `ab84e946`

**3. [Rule 3 - Blocking] Characterization + allowlist drift from the auth.ts edit**
- **Found during:** Task 1
- **Issue:** Changing `config: [...oidcProviders]` → `config: oidcProviders.map(...)` tripped a source-text assertion in `plan-52-05-auth-typecheck.test.ts`; the auth.ts edits + biome import-reorder drifted the LOCKER-02/03 allowlist line numbers.
- **Fix:** Updated the characterization assertion to the `.map()` form (preserves the readonly→mutable fix intent); bumped the auth.ts allowlist line numbers with rationale.
- **Files modified:** apps/api/tests/unit/plan-52-05-auth-typecheck.test.ts, tools/lint-no-hardcode.allowlist.txt, tools/lint-no-suppressions.allowlist.txt
- **Verification:** `pnpm lint:lockers` exits 0; plan-52-05 test green.
- **Committed in:** `ab84e946`

---

**Total deviations:** 3 auto-fixed (2 bugs, 1 blocking)
**Impact on plan:** All three were correctness-required (two latent bugs that would have shipped a non-functional JIT surface; one mechanical drift). No scope creep — the JIT surface delivered matches the plan exactly.

## D-69-2 Deviation (as designed, documented)
`create.after` / `update.after` fire POST-commit (Better Auth queues them after the user-create transaction), so the `sso.jit.user.created` / `sso.jit.role.updated` audit rows live in a SEPARATE `withTenant` transaction from the user row — an intentional, documented deviation from D-A1's "audit row exists iff action commits", forced by Better Auth's hook lifecycle. `sso.jit.rejected` has no committed user row, so it is emitted from the rejection path under DEFAULT_TENANT_ID with `actor_user_id=null` (auth.signin_failed precedent).

## Issues Encountered
- Worktree had no `node_modules`; ran `pnpm install --prefer-offline` (5.4s from the shared store) so tests run against the worktree's own source + config.
- Initial `update.before` design read the existing identity under the default tenant; RLS hid the acme-scoped seeded rows. Reworked to read under the incoming projected tenant (the correct mode-6 mechanism).

## Threat Flags
None — no new network endpoints, auth paths, or schema surface beyond the plan's threat_model (T-69-07..10 mitigations are implemented: role server-side input:false; mode-6 enforcement; no-PII payloads + logs; create/update/rejection audit rows).

## Known Stubs
None.

## User Setup Required
None — JIT activates only when the operator sets `OIDC_TENANT_CLAIM` + the mapping env vars (config surface owned by 69-01). When unset, `readJitConfig()` returns null and auth.ts omits both `mapProfileToUser` and `databaseHooks` (legacy backward-compat).

## Next Phase Readiness
- The 4 `databaseHooks` fire on BOTH the web genericOAuth path and the desktop `createOAuthUser` path, so Plan 69-04 (desktop bearer-mint) only needs to call the shared `resolveJitDecision` + pass `{tenantId,role}` into `createOAuthUser` — NO auth.ts overlap.
- `sso.jit.user.created` is asserted verbatim by the 69-05 live-Keycloak e2e; the row + payload shape are now proven at the storage layer.
- Coverage: oidc-jit-hooks.ts 100/95.34/100/100 (stmts/branch/funcs/lines); typecheck clean; all lockers exit 0; 314 auth/audit/error-handler/jit tests green.

## Self-Check: PASSED
- Files: oidc-jit-hooks.ts, auth-jit-hooks.test.ts, jit-rejections.test.ts, 69-03-SUMMARY.md all present.
- Commits ab84e946 / 0ccc0edc / 3306f919 all on HEAD.

---
*Phase: 69-sso-jit-live-keycloak*
*Completed: 2026-05-29*
