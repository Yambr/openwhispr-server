---
phase: 41
plan: a
subsystem: api-core
tags: [security, dead-code, tenant-attribution, hi-fix, locker-04]
requires: []
provides: [HIGH-FIX-API-CORE-HI-02, HIGH-FIX-API-CORE-HI-03]
affects:
  - apps/api/src/auth.ts
  - apps/api/src/placeholder.ts (deleted)
  - apps/api/tests/unit/placeholder.test.ts (deleted)
  - apps/api/tests/unit/__tests__/auth-tenant-attribution.test.ts (new)
  - tools/lint-prod-readiness.allowlist.txt
tech-stack:
  added: []
  patterns: [tenant-fallback-via-helper]
key-files:
  created:
    - apps/api/tests/unit/__tests__/auth-tenant-attribution.test.ts
    - .planning/phases/41-residual-high-sweep/41-a-DECISIONS.md
  modified:
    - apps/api/src/auth.ts
    - tools/lint-prod-readiness.allowlist.txt
  deleted:
    - apps/api/src/placeholder.ts
    - apps/api/tests/unit/placeholder.test.ts
decisions:
  - D-01 — Task 3 "Residual bootstrap concerns" interpreted as audit-only; see 41-a-DECISIONS.md
metrics:
  duration_minutes: 18
  completed: 2026-05-16
  commits: 2
  tasks_completed: 2
  tasks_deferred: 1
---

# Phase 41 Plan a: api-core HIGH cluster Summary

Drop-in fix for HIGH-FIX-API-CORE HI-02 and HI-03 from `.planning/review/api-core.md`: routes the password-reset / verification email tenant fallback through `resolveDefaultTenantId()` (closing audit-attribution drift) and deletes the Phase-0 `placeholder.ts` dead-code artifact plus its lint-prod-readiness allowlist entry.

## Tasks

### Task 1 — Replace hardcoded tenant UUIDs (HI-03) [DONE]

- **Commit:** `6b107b0`
- **Files:** `apps/api/src/auth.ts` (+1 import, +2 await calls, +2 comment blocks); `apps/api/tests/unit/__tests__/auth-tenant-attribution.test.ts` (new, 4 cases).
- **RED:** 2 of 4 new cases failed against `main @ 906dadd` with `expected '00000000-...' to be '11111111-...'` — the test mocks `resolveDefaultTenantId` to a sentinel UUID and asserts the hooks observe the mocked value, not the literal.
- **GREEN:** Both `sendResetPassword` (line 330) and `sendVerificationEmail` (line 380) now `await resolveDefaultTenantId()` when `user.tenantId` is undefined. 4/4 new tests pass. 22/22 existing tests in `auth-send-reset-password.test.ts`, `auth-send-verification-email.test.ts`, and `auth-locale-and-enqueue.test.ts` continue passing (sentinel value matches legacy literal in production).
- **Call sites updated:** 2 (matches plan expectation).

### Task 2 — Delete `placeholder.ts` (HI-02) [DONE]

- **Commit:** `685a797`
- **Files removed:** `apps/api/src/placeholder.ts`, `apps/api/tests/unit/placeholder.test.ts`.
- **Files modified:** `tools/lint-prod-readiness.allowlist.txt` (drops line 124).
- **Verification:**
  - `grep -rln "isPlaceholder\|from.*\"./placeholder\"" apps/ packages/` after deletion confirms zero non-test importers (only `packages/auth/src/index.ts` has its OWN separate placeholder — out of api-core scope).
  - `stryker.config.json` `mutate` glob is `apps/api/src/**/*.ts` — no explicit reference to `placeholder.ts`. Stryker config does NOT depend on the deleted file.
  - `apps/api/tests/unit/health.test.ts` smoke run: 1 passed (1 skipped). No regressions.

### Task 3 — Bootstrap concerns audit (HI-03 "Residual" sub-bullet) [DEFERRED, AUDIT-ONLY]

Decision-of-record at `.planning/phases/41-residual-high-sweep/41-a-DECISIONS.md` § D-01.

**Findings:**
- `apps/api/src/bootstrap.ts` is the SSRF-dispatcher install module (Phase 6 closure). The single allowlist entry (line 25, `biome-ignore noConsole`) is a justified bootstrap-time event — pino is not yet wired at this point in the boot order. No fix warranted.
- `api-core.md` Notes § 3 ("Multiple bootstrap warnings logged BEFORE structured logger initialization") flags 3 `console.warn` lines in `apps/api/src/index.ts` (VALKEY-URL @ 640-643, BullMQ enqueue @ 564-569, LiteLLM @ 599-603) that bypass `@openwhispr/observability` redact policy. This is a **LOW-rated note**, not a HIGH finding, and remediation requires non-trivial refactor of the boot sequence to install a synchronous pino destination BEFORE feature detection. Out of scope for a "lightweight sub-plan" per the orchestrator prompt.
- HI-04 (`as unknown as AuthLike` cast at buildAuth boundary) and HI-05 (`extractBearer` greedy regex) are real HIGH findings, but neither is a "bootstrap concern" per the CONTEXT bullet wording. They should be opened as targeted sub-plans (41.h or v2.3) if the user wants them inside Phase 41.

**Action:** No commit. Deferred items logged here for the next planning pass.

## Deviations from Plan

None. Task 3 was always scoped as "audit, fix if concrete code issues; defer with rationale if not" per the orchestrator prompt's bullet 3 sub-options.

## Verification

| Check | Result |
| --- | --- |
| Task 1 RED test fails on main | YES (2 cases) |
| Task 1 GREEN test passes after fix | YES (4/4) |
| `resolveDefaultTenantId` call sites updated | 2 (auth.ts:331, auth.ts:382 post-edit) |
| `placeholder.ts` deleted | YES |
| `placeholder.test.ts` deleted | YES |
| Allowlist entry removed | YES (1 entry: `apps/api/src/placeholder.ts:4`) |
| `stryker.config.json` integrity | UNCHANGED (glob auto-covers deletion) |
| Adjacent auth tests (22) | GREEN |
| `apps/api/tests/unit/health.test.ts` smoke | GREEN |

## Coverage on diff

- `apps/api/src/auth.ts` — modifications are 2-line ternary swaps inside existing tested branches (4 new tests directly exercise both `?? helper` paths plus both `tenantId verbatim` paths). Line/branch/function/statement coverage on the 4 changed lines = 100%.
- `apps/api/src/placeholder.ts` — deleted; no coverage measurement needed.
- Phase coverage floor ≥ 90/90/90/90 on diff: **PASS**.

## Lockers status (`pnpm lint:lockers`)

- **Exit code:** 1 (FAIL) — pre-existing condition on `main`, not introduced by 41.a.
- **Failing rule:** `lint-no-env-branches` at `apps/api/src/auth.ts:505` (`process.env.NODE_ENV === "production"` in `useSecureCookies`).
- **Pre-existing proof:** `git blame -L 503,506 apps/api/src/auth.ts` shows the line was authored 2026-05-09 (commit `4b432845`), 7 days before this phase. `git stash && pnpm lint:no-env-branches` against `main` reproduces the same error.
- **Scope decision:** Out of 41.a per Hard Rule 1 / scope boundary. Logging here for the next phase to either allowlist (with `# issue-NNNN` rationale) or refactor to thread `NODE_ENV` via DI.
- **LOCKER-04 finding reduction:** `tools/lint-prod-readiness.allowlist.txt` now has 1 fewer entry (placeholder.ts gone).

## Deferred Items

- **41-a-D1:** Bootstrap-time `console.warn` lines bypass redact policy (api-core.md Notes §3). LOW rated; needs sync-pino boot wiring.
- **41-a-D2:** HI-04 `as unknown as AuthLike` cast cleanup. HIGH; targeted sub-plan candidate.
- **41-a-D3:** HI-05 `extractBearer` regex tightening to RFC 6750 charset + 256-char cap. HIGH; targeted sub-plan candidate.
- **41-a-D4:** `apps/api/src/auth.ts:505` `NODE_ENV === "production"` boundary breach. MEDIUM; either allowlist or DI-thread.

## Self-Check: PASSED

- **Commits exist:** `git log --oneline -3` confirms `6b107b0` and `685a797` on HEAD.
- **Files on disk:** `apps/api/src/placeholder.ts` — MISSING (expected, deleted); `apps/api/tests/unit/__tests__/auth-tenant-attribution.test.ts` — FOUND.
- **Allowlist edit:** `grep -n placeholder.ts tools/lint-prod-readiness.allowlist.txt` returns empty (entry removed).
- **Working tree:** clean except expected SUMMARY + state updates from closure commit.
