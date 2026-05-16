---
phase: 41
plan: c
subsystem: web
tags: [security, defense-in-depth, test-hygiene, hi-fix]
requires: []
provides: [HIGH-FIX-WEB-HI-1, HIGH-FIX-WEB-HI-2]
affects:
  - apps/web/src/app/(admin)/layout.tsx
  - apps/web/src/lib/admin-guard.ts (new)
  - apps/web/tests/unit/lib/__tests__/admin-guard.test.ts (new)
  - apps/web/tests/unit/lint/no-playwright-env-leak.test.ts (new)
  - apps/web/src/app/(auth)/app/page.tsx
  - apps/web/src/app/(auth)/app/notes/page.tsx
  - apps/web/src/app/(auth)/app/transcriptions/page.tsx
  - apps/web/src/app/(auth)/app/conversations/page.tsx
  - apps/web/src/app/(auth)/app/conversations/[id]/page.tsx
  - docker-compose.yml
  - compose/docker-compose.embedded-litellm.yml
  - .env.full.example
  - tools/lint-prod-readiness.allowlist.txt
tech-stack:
  added: []
  patterns: [defense-in-depth-role-guard, env-branch-removal]
key-files:
  created:
    - apps/web/src/lib/admin-guard.ts
    - apps/web/tests/unit/lib/__tests__/admin-guard.test.ts
    - apps/web/tests/unit/lint/no-playwright-env-leak.test.ts
    - .planning/phases/41-residual-high-sweep/41-c-DECISIONS.md
    - .planning/phases/41-residual-high-sweep/41-c-DEFERRED.md
  modified:
    - apps/web/src/app/(admin)/layout.tsx
    - apps/web/src/app/(auth)/app/page.tsx
    - apps/web/src/app/(auth)/app/notes/page.tsx
    - apps/web/src/app/(auth)/app/transcriptions/page.tsx
    - apps/web/src/app/(auth)/app/conversations/page.tsx
    - apps/web/src/app/(auth)/app/conversations/[id]/page.tsx
    - docker-compose.yml
    - compose/docker-compose.embedded-litellm.yml
    - .env.full.example
    - tools/lint-prod-readiness.allowlist.txt
decisions:
  - D-1 inline 403 Forbidden for signed-in non-admin (anonymous passthrough preserves Traefik basic-auth runbook)
  - D-2 delete PLAYWRIGHT_DISABLE_SSR_PREFETCH branch entirely; test-side migration deferred
metrics:
  duration_minutes: ~15
  completed: 2026-05-16
---

# Phase 41 Plan c: web HIGH cluster (HIGH-FIX-WEB) Summary

App-level role-check RSC guard on `/admin/*` plus removal of the
`PLAYWRIGHT_DISABLE_SSR_PREFETCH` test-only env branch from five
production RSC pages — both findings from `.planning/review/web.md`
HI-1 and HI-2.

## Commits

| SHA       | Subject                                                       |
| --------- | ------------------------------------------------------------- |
| `aff9393` | feat(41c): app-level role guard for admin layout              |
| `9e6afeb` | feat(41c): remove playwright_disable_ssr_prefetch from prod rsc |

## HI-1 — `/admin/*` defense-in-depth role guard

**Root cause:** `(admin)/layout.tsx` shipped with the explicit
no-app-level-check comment ("Adding an application-level role check
would double-gate and confuse operators"). For OSS quickstart
deployments where the operator forgets to set
`ADMIN_BASIC_AUTH_USERS`, or where a misconfigured Traefik label
loses the basic-auth middleware, any signed-in user would reach
`/admin/config` and `/admin/observability` with operator config
visibility.

**Fix:**

- New `apps/web/src/lib/admin-guard.ts` — pure helper
  `checkAdminAccess(session)` returning `"allow" | "forbidden"`.
- Three-branch decision matrix (D-1):
  - `session === null` → `"allow"` (Traefik basic-auth gate covers
    anonymous; do NOT redirect-to-sign-in or break the ops-engineer
    runbook).
  - `session.user.role === "admin"` → `"allow"` (authorised).
  - Otherwise → `"forbidden"` (the actual hole this guard closes).
- Layout becomes `async`, calls `getServerSession()`, and renders
  inline `<AdminForbidden />` (heading + short message) on
  `"forbidden"`.

**Tests:** `tests/unit/lib/__tests__/admin-guard.test.ts` — 4 cases,
100% line/branch/function/statement coverage on the new helper.

## HI-2 — Remove `PLAYWRIGHT_DISABLE_SSR_PREFETCH` from production RSC

**Root cause:** 5 RSC pages contained a runtime env-var check
`if (process.env.PLAYWRIGHT_DISABLE_SSR_PREFETCH === "1")` that
disabled SSR prefetch when set. CLAUDE.md hard-rule #1 forbids
modifying production code to accommodate test infrastructure; this
was the inverse anti-pattern.

**Fix (D-2):** Deleted the branch entirely from all 5 pages. SSR
prefetch now runs unconditionally. Cleaned up the compose env wiring
(`docker-compose.yml`, `compose/docker-compose.embedded-litellm.yml`)
and the `.env.full.example` reference. The runtime env var is no
longer read by any production source.

**Tests:** `tests/unit/lint/no-playwright-env-leak.test.ts` — single
regression-guard test walks `apps/web/src/**/*.{ts,tsx}` and asserts
zero `process.env.PLAYWRIGHT_*` references (comment-stripped). RED
confirmed before the GREEN deletion.

**Allowlist housekeeping:** `tools/lint-prod-readiness.allowlist.txt`
line-number shifts:

| File                                                       | Old | New |
| ---------------------------------------------------------- | --- | --- |
| `apps/web/src/app/(admin)/layout.tsx`                      | 12  | 38  |
| `apps/web/src/app/(auth)/app/conversations/[id]/page.tsx`  | 29  | 26  |
| `apps/web/src/app/(auth)/app/conversations/page.tsx`       | 26  | 23  |
| `apps/web/src/app/(auth)/app/notes/page.tsx`               | 26  | 23  |
| `apps/web/src/app/(auth)/app/page.tsx`                     | 39  | 28  |
| `apps/web/src/app/(auth)/app/transcriptions/page.tsx`      | 26  | 23  |

No new allowlist additions; line-number drift only.

## Deviations from Plan

**1. Task statement referenced `pnpm lint:no-env-branches` catching
`PLAYWRIGHT_*` after removal.** The actual LOCKER-01 lint scans only
`NODE_ENV` patterns — it would not catch `PLAYWRIGHT_*` either before
or after. Mitigation: shipped a dedicated `no-playwright-env-leak`
regression test (Rule 2 — add the missing critical guard rather than
silently accept the gap).

**2. Loading-state e2e specs (u4/u6/u8/u11/u12) lose their bypass.**
The 5 specs previously relied on the deleted env branch to keep SSR
prefetch off so `page.route()` could intercept loading-state. They
are now expected to fail in any environment where the apps/api
endpoint is reachable from the RSC. Deferred per
`41-c-DEFERRED.md` D-c-1 with two possible resolution paths
(Suspense refactor OR apps/api boundary mock); estimated 1–3d in a
future targeted test-infra phase.

## Verification

- `pnpm --filter @openwhispr/web test` → 895 / 895 passed (54 + 2
  new files: `admin-guard.test.ts` 4 tests, `no-playwright-env-leak.test.ts` 1 test).
- `pnpm lint:lockers` → exit 0 (clean — no LOCKER-01..09 regressions;
  LOCKER-04 allowlist still WARN-only as expected per ledger).
- `pnpm --filter @openwhispr/web typecheck` → clean.
- Coverage on new files: `admin-guard.ts` 100/100/100/100 (LF=4 LH=4,
  BRF=4 BRH=4, FNF=1 FNH=1).

## Known Stubs

None.

## Self-Check: PASSED

- Files created — all 5 verified to exist.
- Commits exist — `aff9393` and `9e6afeb` on HEAD~1..HEAD.
- Test counts verified by direct vitest invocation.
- Lockers exit 0 verified by capturing `$?` after
  `pnpm lint:lockers`.
