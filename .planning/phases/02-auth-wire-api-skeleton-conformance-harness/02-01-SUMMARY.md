---
phase: 02-auth-wire-api-skeleton-conformance-harness
plan: 01
subsystem: auth
tags: [auth, better-auth, drizzle, rls, migration, scheme-allowlist, cookie-domain, token-rotation]
dependency_graph:
  requires:
    - "Phase 1: makeAppDb / makeOwnerDb / withTenant / 0000_initial.sql / tenants seed"
  provides:
    - "apps/api/src/auth.ts — buildAuth({db, log}) factory"
    - "apps/api/src/lib/scheme-allowlist.ts — validateScheme + buildProtocolRedirect"
    - "apps/api/src/lib/cookie-domain.ts — findSharedParentDomain + cookieDomainConfig"
    - "apps/api/src/lib/token-rotation.ts — hashToken (SHA-256)"
    - "apps/api/src/lib/default-tenant.ts — resolveDefaultTenantId (memoised)"
    - "packages/data/migrations/0001_better_auth.sql — account/verification + users/sessions extensions + lookup_session_by_previous_token SECURITY DEFINER"
    - "packages/data/migrations/0002_oauth_state.sql — oauth_state table"
    - "Drizzle schema files: accounts.ts, verifications.ts, oauth_state.ts; extended users.ts and sessions.ts"
  affects:
    - "TENANT_SCOPED_TABLES expanded — every consumer (rls-property test, RLS lint scope) auto-discovers"
tech-stack:
  added:
    - "better-auth@1.6.9 (drizzleAdapter, bearer, genericOAuth)"
    - "@fastify/cookie@11.0.2"
  patterns:
    - "Hand-authored SQL migrations with FORCE RLS + tenant_isolation policy referencing current_setting('app.tenant_id', true)"
    - "SECURITY DEFINER function with REVOKE PUBLIC + GRANT openwhispr_app for cross-tenant lookup"
    - "Drizzle adapter bound to appDb (RLS-subject), not ownerDb"
key-files:
  created:
    - apps/api/src/auth.ts
    - apps/api/src/auth.test.ts
    - apps/api/src/lib/scheme-allowlist.ts
    - apps/api/src/lib/scheme-allowlist.test.ts
    - apps/api/src/lib/cookie-domain.ts
    - apps/api/src/lib/cookie-domain.test.ts
    - apps/api/src/lib/token-rotation.ts
    - apps/api/src/lib/token-rotation.test.ts
    - apps/api/src/lib/default-tenant.ts
    - packages/data/migrations/0001_better_auth.sql
    - packages/data/migrations/0002_oauth_state.sql
    - packages/data/src/schema/accounts.ts
    - packages/data/src/schema/verifications.ts
    - packages/data/src/schema/oauth_state.ts
    - packages/data/src/__tests__/0001_better_auth.test.ts
    - packages/data/src/__tests__/0002_oauth_state.test.ts
  modified:
    - packages/data/src/schema/users.ts (Better Auth required fields)
    - packages/data/src/schema/sessions.ts (overlap window + ip_address/user_agent)
    - packages/data/src/schema/index.ts (TENANT_SCOPED_TABLES expanded)
    - packages/data/migrations/meta/_journal.json (entries 1+2)
    - packages/data/src/__tests__/rls-property.test.ts (auto-discovery list update)
    - apps/api/package.json (better-auth + @fastify/cookie deps)
    - pnpm-lock.yaml
decisions:
  - "AuthInstance structural type: Better Auth's full inferred type generic-leaks zod \\$strip across package boundaries; TS6 cannot serialise it without a non-portable import. We expose only {options.plugins} — the surface Plan 03+ actually consumes — and let direct imports of Better Auth helpers cover everything else."
  - "@better-auth/cli pin omitted: latest CLI release is 1.4.22; no 1.6.x publish exists. We hand-author migrations (Phase 1 pattern continues), so the CLI is unnecessary. ADR-worthy if Phase 3+ wants schema scaffolding from the CLI."
  - "Wave-2/3 deferred: recordPreviousToken / tryPreviousToken (DB-touching helpers) live with Plan 02 or later — they need a withTenant integration point and the Better Auth session.afterRotate hook wiring. The pure hashToken landed here; the SECURITY DEFINER function it uses is also in place."
metrics:
  duration: ~30 min
  tasks: 3
  files_created: 16
  files_modified: 6
  tests_added: 70 (46 lib + 24 migration)
  tests_passing_total: 122 (54 api/src + 68 data)
  completed_date: 2026-05-09
---

# Phase 2 Plan 01: Better Auth Substrate + Migrations Summary

JWT-shaped opaque-bearer auth substrate landed via Better Auth 1.6.9 + Drizzle adapter bound to Phase 1 appDb, two hand-authored RLS-compliant migrations (Better Auth tables + oauth_state), three pure-function libraries with RFC 3986 + eTLD+1 + SHA-256 helpers, and a SECURITY DEFINER function for the AUTH-04 token-rotation overlap window.

## Objective Status

✅ Wired Better Auth 1.6.9 into apps/api (buildAuth factory, OIDC env-gated per D-02)
✅ Migrations 0001 + 0002 hand-authored, FORCE RLS + tenant_isolation policies, lookup_session_by_previous_token SECURITY DEFINER function with REVOKE PUBLIC + GRANT openwhispr_app
✅ Three pure libraries (scheme-allowlist, cookie-domain, token-rotation hashToken) — 46 tests, ≥95% line coverage
✅ Drizzle schema files (accounts.ts, verifications.ts, oauth_state.ts) consumable by drizzleAdapter
✅ users + sessions extended with Better Auth required fields + AUTH-04 overlap columns

## Tasks Completed

| Task | Name | Commits |
|------|------|---------|
| 1 | Pure-function libraries (scheme-allowlist, cookie-domain, token-rotation hashToken) | 6ca8555 (RED), 4a93d96 (GREEN, hash chain pre-amend) |
| 2 | Migrations 0001 + 0002 + Drizzle schema | RED + GREEN |
| 3 | Better Auth instance + factory + smoke tests | feat commit |

## Verification Results

- packages/data: **12 test files, 68/68 tests green** (5.16s migration tests; full suite 13.1s)
- apps/api/src: **7 test files, 54/54 tests green**
- Workspace `tsc --noEmit`: clean
- Migration roundtrip (Phase 1's existing test): green
- RLS property test: green (TENANT_SCOPED_TABLES auto-discovery list updated)
- lint-rls equivalent (tools/lint-rls.test.ts): 4/4 green against live container

## Key Decisions

1. **AuthInstance structural return type** — Better Auth's full inferred type generic-leaks zod `$strip` (`zod@4.4.3/v4/core`); TS6 declined to serialise it across the apps/api package boundary. The factory returns a structural minimum (`{options.plugins}`) — exactly the surface the smoke test inspects. Direct imports of Better Auth helpers cover everything else; if Plan 03+ needs more, prefer importing the helper over widening this interface.
2. **@better-auth/cli skipped** — npm registry shows the latest CLI as 1.4.22 with no 1.6.x publish. Hand-authoring migrations is the established Phase 1 pattern (drizzle-kit doesn't emit FORCE RLS / CREATE POLICY / SECURITY DEFINER anyway). ADR if a future plan wants CLI-driven schema scaffolding.
3. **AUTH-A3 status** — Plan called for verifying whether Better Auth 1.6.9 supports overlap rotation natively. We did NOT delete the previous_token machinery: the bearer plugin's source emits a single `set-auth-token` rotation header and there is no built-in concept of overlap. The columns + SECURITY DEFINER function stay; Wave 2 plans land recordPreviousToken / tryPreviousToken on top.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `pnpm install` lefthook hook chain blocked by core.hooksPath**
- **Found during:** Task 1 RED test run (first `pnpm` invocation triggered the prepare script)
- **Issue:** worktree's git config inherits `core.hooksPath` from main checkout, blocking lefthook install
- **Fix:** ran `pnpm install --ignore-scripts` (the prepare hook is dev-tooling only; not production-impacting)
- **Files modified:** none

**2. [Rule 3 - Blocking] rls-property.test.ts hard-coded the Phase 1 tenant table list**
- **Found during:** Task 2 GREEN verification — the auto-discovery assertion failed once TENANT_SCOPED_TABLES included the new Phase 2 tables
- **Issue:** `expect([...TENANT_SCOPED_TABLES].sort()).toEqual(["audit_log","sessions","usage_ledger","users"].sort())` — Phase 1 hand-baked the list
- **Fix:** updated the assertion to include account / verification / oauth_state
- **Files modified:** packages/data/src/__tests__/rls-property.test.ts

**3. [Rule 1 - Bug] auth.ts return type leaked zod $strip across package boundary**
- **Found during:** workspace typecheck after first auth.ts draft
- **Issue:** TS6 declined to serialise the full inferred Better Auth instance type without a non-portable `$strip` import (zod v4 internals)
- **Fix:** declared a structural `AuthInstance` minimum (`{ options: { plugins?: ReadonlyArray<{ id: string }> } }`) and cast at the boundary
- **Files modified:** apps/api/src/auth.ts

## Authentication Gates

None — no human-action checkpoints reached.

## Deferred Items

- `apps/api/scripts/check-default-secrets.test.ts` (4 failures) — pre-existing failure independent of Plan 02-01: the test resolves `SCRIPT` via `process.cwd()` and assumes the workspace root, but vitest runs it from the package cwd. Reproducible with the original tree before any Plan 02-01 changes. Logged in `deferred-items.md` for orchestrator follow-up.
- `recordPreviousToken` and `tryPreviousToken` DB-touching helpers — deferred to a Wave 2/3 plan that wires Better Auth's `session.afterRotate` hook. The columns, SECURITY DEFINER function, and pure `hashToken` are all in place.

## Threat Model — Mitigations Applied

| Threat ID | Status |
|-----------|--------|
| T-02-01-01 (cross-tenant leak via Better Auth queries) | Mitigated: account/verification/oauth_state all FORCE RLS + tenant_isolation; Drizzle adapter bound to appDb |
| T-02-01-02 (SECURITY DEFINER privilege escalation) | Mitigated: REVOKE ALL FROM PUBLIC; GRANT EXECUTE openwhispr_app only; function returns (user_id, tenant_id) tuples only |
| T-02-01-03 (DDL via PgBouncer) | Mitigated: Phase 1 migrate runner uses DATABASE_URL_OWNER (direct 5432); no change here |
| T-02-01-04 (scheme-regex case-bypass) | Mitigated: validateScheme rejects uppercase explicitly; deny-list checks lowercase form; 14 unit tests cover bypass attempts |

## Self-Check: PASSED

Verified files exist:
- FOUND: apps/api/src/auth.ts
- FOUND: apps/api/src/lib/scheme-allowlist.ts
- FOUND: apps/api/src/lib/cookie-domain.ts
- FOUND: apps/api/src/lib/token-rotation.ts
- FOUND: apps/api/src/lib/default-tenant.ts
- FOUND: packages/data/migrations/0001_better_auth.sql
- FOUND: packages/data/migrations/0002_oauth_state.sql
- FOUND: packages/data/src/schema/accounts.ts
- FOUND: packages/data/src/schema/verifications.ts
- FOUND: packages/data/src/schema/oauth_state.ts

Verified commits exist (git log --oneline since fc2b3be):
- ba84a83 feat(02-01): GREEN — Better Auth + oauth_state migrations + RLS policies
- (RED + GREEN test commits, plus Task 3 commit at HEAD)
