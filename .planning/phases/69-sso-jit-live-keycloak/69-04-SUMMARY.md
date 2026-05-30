<!-- SPDX-License-Identifier: FSL-1.1-ALv2 -->
---
phase: 69-sso-jit-live-keycloak
plan: 04
subsystem: auth
tags: [oidc, jit, sso, desktop, bearer-mint, mint-bearer, rls, audit-log, multi-tenancy, keycloak]

# Dependency graph
requires:
  - phase: 69-01
    provides: resolveJitDecision pure resolver (existing? arg → mode 5/6) + readJitConfig loader
  - phase: 69-02
    provides: 3 sso.jit.* audit actions + zod payload schemas + migration 0032
  - phase: 69-03
    provides: JitRejectionError type + buildJitDatabaseHooks (create.before/after fire via createWithHooks on the desktop new-user path)
provides:
  - "Desktop bearer-mint JIT seam (D-69-1 Option C, second call-site) — resolveJitDecision on BOTH the new-user and the if(existing) returning-user branches in mint-bearer.ts"
  - "OidcUserinfo widened (groups + tenant-claim index signature) so the desktop userinfo fetch carries the JIT claims"
  - "Returning-desktop-user role re-sync (mode 5 → sso.jit.role.updated) + tenant-mismatch reject (mode 6 → 403 forbidden_tenant_mismatch + sso.jit.rejected) — full web/desktop parity, no deferred gap"
  - "desktop-signin authorize scope appends the configured group claim when JIT is enabled (A1: Keycloak emits groups in userinfo)"
affects: [69-05 (live-Keycloak e2e — the realm userinfo group mapper must satisfy the A1 residual this seam reads)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared pure resolveJitDecision invoked at the SECOND call-site (desktop mint-bearer) — same resolver as the web mapProfileToUser seam (D-69-1)"
    - "New-user branch projects {tenantId, role} into createOAuthUser's user arg (Plan-03 databaseHooks then fire via createWithHooks); returning-user reuse branch persists the role re-sync + emits the audit DIRECTLY (the reuse path never calls createOAuthUser)"
    - "Returning-user mode-6 detection: resolve tenant first, read the persisted identity UNDER the resolved tenant (RLS GUC), then re-run the resolver with the existing identity — a not-found-there is the unambiguous tenant-mismatch signal (mirrors oidc-jit-hooks.ts loadExistingUnderTenant)"

key-files:
  created:
    - apps/api/tests/unit/__tests__/mint-bearer-jit.test.ts
    - apps/api/tests/integration/__tests__/desktop-jit.test.ts
  modified:
    - apps/api/src/lib/mint-bearer.ts
    - apps/api/src/routes/desktop-signin.ts
    - apps/api/tests/unit/routes/desktop-signin.test.ts

key-decisions:
  - "Desktop returning-user re-sync/reject persists + audits DIRECTLY in mint-bearer (the reuse-userId branch never routes through createOAuthUser, so create/update.after never fire there) — mirrors the update-path semantics of oidc-jit-hooks.ts rather than re-invoking the hooks"
  - "Mode-6 detection reuses the RLS-scoped read: resolve tenant → loadExistingUnderTenant under that tenant → undefined means the bound tenant changed; identical mechanism to the web update.before hook"
  - "Rejected-sign-in audit rows use DEFAULT_TENANT_ID (D-69-2, auth.signin_failed precedent) since a rejection may have no valid tenant; actor_user_id=null"
  - "account.scope + the authorize scope append jitConfig.groupClaim (default 'groups') ONLY when JIT is enabled — JIT-disabled keeps the byte-for-byte legacy 'openid email profile' (backward-compat)"

patterns-established:
  - "Pattern: a bypass-genericOAuth path (desktop) re-uses the shared resolver at its own seam rather than being re-routed through genericOAuth (D-69-1 rejected Option B)"
  - "Pattern: a reuse-userId branch that skips the create lifecycle does its re-sync persist + audit inline, mirroring (not re-invoking) the databaseHooks update path"

requirements-completed: [SSO-IMPL-01, SSO-IMPL-03]

# Metrics
duration: 38min
completed: 2026-05-29
---

# Phase 69 Plan 04: Desktop Bearer-Mint JIT Seam Summary

Wires the SAME pure `resolveJitDecision` into the desktop bearer-mint path (which bypasses `genericOAuth`, so `mapProfileToUser` never fires there) on BOTH the new-user and the returning-user branches — closing the default-tenant footgun (Pitfall 2) AND the returning-desktop re-sync/reject parity gap, with token exchange, SSRF discovery guards, `set-auth-token` rotation, and channel-scheme deep-link echo left byte-for-byte unchanged.

## What shipped

- **`mint-bearer.ts`**
  - `OidcUserinfo` widened: `groups?: string[]` + an index signature so the userinfo JSON carries the configured tenant claim (no key hardcoding).
  - `readJitConfig()` read once. When `null` (JIT disabled) the resolver is never called and both branches behave exactly as before (backward-compat verified).
  - **NEW-user branch**: `resolveJitDecision(claims, jitConfig)` → on `ok` the resolved `{tenantId, role}` is projected into the `createOAuthUser` user arg (the Plan-03 `databaseHooks` fire via `createWithHooks`, landing the tenant/role + a `sso.jit.user.created` audit row); on rejection a `sso.jit.rejected` row is emitted and `JitRejectionError` is thrown (no bearer).
  - **RETURNING-user branch** (the `if (existing)` reuse-userId path): resolve the tenant, read the persisted identity under that tenant, then re-run `resolveJitDecision(claims, jitConfig, {tenantId, role})`. Mode 6 (tenant changed) → refuse reuse + mint, emit `sso.jit.rejected (forbidden_tenant_mismatch)`, throw → 403. Mode 5 (role changed) → persist the new role on the existing row + emit `sso.jit.role.updated` (reason `group_change` / `revocation_downgrade`), then mint the bearer for the reused id. Unchanged → no write, no audit.
  - `account.scope` appends the group scope when JIT is enabled.
- **`desktop-signin.ts`**: the authorize redirect `scope` appends `jitConfig.groupClaim` (default `groups`, or the configured `OIDC_GROUP_CLAIM`) when `OIDC_TENANT_CLAIM` is set (A1).
- **Tests**: a boundary-mocked unit suite (`mint-bearer-jit.test.ts`, 10 tests — only the userinfo/token HTTP is mocked; the real resolver + real `recordAudit` run) and a real-Postgres integration suite (`desktop-jit.test.ts`, 6 tests, testcontainers, no internal mocks). Three scope-widening cases added to the existing `desktop-signin.test.ts`.

## Verification

- `pnpm test mint-bearer-jit desktop-jit mint-bearer desktop-signin` → 53 tests GREEN (6 files, incl. the real-PG integration).
- Existing JIT suites unchanged: `oidc-jit auth-jit jit-rejections` → 71 tests GREEN (no regression).
- Coverage on the diff: `mint-bearer.ts` 97.67/91.25/95.65/97.58, `desktop-signin.ts` 96.22/93.93/100/96.07 — all axes ≥ 90.
- `pnpm lint:lockers` exits 0; `tsc --noEmit` clean.
- UNCHANGED-invariants regression-asserted: SSRF `assertEndpointAffiliated`/`discoverOidc` still present (grep), token-schema guard covered, opaque-bearer shape asserted, channel-scheme echo covered by the unchanged `oauth-channel-scheme-mint-bearer.test.ts`.

## Threat mitigations applied (from plan threat_model)

- **T-69-11** (desktop default-tenant footgun): resolver projects tenant/role before `createOAuthUser`; no silent default-tenant provisioning.
- **T-69-12** (poisoned discovery): `assertEndpointAffiliated` + `OidcDiscoveryDocSchema` untouched.
- **T-69-14** (stale admin on returning desktop user): the `if(existing)` branch re-runs the resolver with the existing role; revocation downgrades + emits `sso.jit.role.updated`.
- **T-69-15** (returning desktop user crossing tenants): resolver returns `forbidden_tenant_mismatch`; the branch refuses reuse + mint and emits `sso.jit.rejected`.

## Deviations from Plan

**1. [Rule 3 - Blocking] Worktree cwd drift (#3097/#3099) corrected mid-run.**
- **Found during:** Task 1 — early test runs reported "No test files found" because a `cd /Users/dev/openwhispr-server` Bash call resolved to the MAIN repo, not the worktree; the Written test file lived in the worktree.
- **Fix:** Ran all subsequent tooling from the worktree root (no `cd` to the main repo). No production change.
- **Files modified:** none (process correction only).

**2. [Rule 1 - Bug] Unit-test env-isolation bug (would have produced a false RED→GREEN).**
- **Found during:** Task 1 — `readJitConfig` returned `null` under stubbed env because the test `beforeEach` reassigned `process.env = {...ORIGINAL}`, orphaning the module-load `DEFAULT_ENV` reference that the loader closes over; `vi.stubEnv` mutates in place.
- **Fix:** Test no longer reassigns `process.env`; relies solely on `vi.stubEnv`/`vi.unstubAllEnvs`. Documented inline.
- **Files modified:** `apps/api/tests/unit/__tests__/mint-bearer-jit.test.ts`.

**3. [Rule 3 - Blocking] LOCKER-02 false-positive on a comment.**
- **Found during:** Task 1 lockers run — a code comment in `mint-bearer.ts` contained the literal `as any`, which `lint-no-suppressions` flags even in comments.
- **Fix:** Reworded the comment (no behavioural change).
- **Files modified:** `apps/api/src/lib/mint-bearer.ts`.

No architectural (Rule 4) changes. No authentication gates.

## Known Stubs

None — the seam is fully wired; both branches persist + audit against real Postgres in the integration test.

## Self-Check: PASSED

- All 6 declared files exist on disk (3 created, 3 modified — incl. this SUMMARY).
- Both task commits exist on HEAD: `e6980b39` (feat), `c08a0055` (test).
- Plan suite `mint-bearer-jit desktop-jit mint-bearer desktop-signin` re-run GREEN (53 tests).
- No tracked-file deletions in either commit.
