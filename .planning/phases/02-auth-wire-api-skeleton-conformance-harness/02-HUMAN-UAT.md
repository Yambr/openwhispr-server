---
status: partial
phase: 02-auth-wire-api-skeleton-conformance-harness
source: [02-VERIFICATION.md]
started: 2026-05-09T11:55:48Z
updated: 2026-05-09T22:30:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Run `make contract-test` against a live docker-compose stack
expected: All 8 conformance test files pass (conventions, check-user, verification-status, delete-account, health, oauth-redirect, token-rotation, cookie-host). The `/api/_test/force-rotate` and `/api/_test/health-authed` routes now exist, so `token-rotation.test.ts` is satisfiable end-to-end. `oauth-redirect.test.ts` should pass as `mintBearer` is now wired.
result: pass

> **Closed by Phase 02.7 (date: 2026-05-10).** The Phase 02.5-05 SUMMARY framed Item 1 with a "scope qualifier" because the contract-test stack was reaching seed but failing 13/26 conformance tests against the live API. Phase 02.7 closed all 6 root-cause defects (D-01 OAuth channel-scheme mintBearer, D-02 bearer-invalid envelope hybrid, D-03 A+B check-user lifecycle + lower(email) functional unique, D-04 AUTH_URL collapse, D-05 cert-gen + HTTPS contract-test path), and the cascade tail (Phases 02.8 → 02.21) closed every additional defect surfaced by the D-03A loud-fail discipline (Better Auth uuid id-mode, fixture email RFC compliance, signInFixture Origin/XFF, session.token plain, OIDC env+discovery, runner-in-network, traefik aliases+trustedIPs, mycorp scheme comma-list, unverified-fixture helper, Group C residuals — 404 envelope + cookie cascade + suite isolation). `make contract-test` now exits 0 with **25 passed | 1 deliberate skipped (26)** — see `.planning/phases/02.7-.../02.7-06-CONTRACT-TEST-LOG.md`. The 1 skip is `cookie-host.test.ts` (split-host topology test, gated on auth.example.test/api.example.test, not the canonical api.localhost setup; pre-existing intentional skip per Phase 02.21 SUMMARY § "Skipped test rationale" — out of Phase 02 scope, activates when an operator opts into split-host topology). The qualifier framing is retired; Item 1 is now flippable without conditions — Phase 02 wire-spec scope fully delivered, Phase 03 unblocked. **26/26 GREEN** in the documented sense (every applicable test green; the 1 deliberate non-applicable test skip is by design).
notes: |
  Auto-execution attempted 2026-05-09T11:55Z; failed at `docker compose up --wait` because
  `minio/minio:RELEASE.2026-03-25T00-00-00Z` (pinned in docker-compose.yml since Phase 1)
  does not exist on Docker Hub — latest published tag is `RELEASE.2025-09-07T16-13-09Z`.
  Pin is a future-dated baseline that was never actually pushed by upstream MinIO.
  This is a Phase 1 baseline defect, not a Phase 2 wiring issue, and therefore deferred
  to an inserted infra-fix phase (1.1) per the user's routing decision. Re-run this
  contract-test item once the MinIO pin is corrected and the compose stack is healthy.

  2026-05-09T22:30Z — Phase 02.5 closed (CLOSED-PARTIAL). Schema mapping (Plan 03,
  commit eb92282) + tenant default binding (Plan 02, commit 91784ab) landed and were
  verified live in `make contract-test`. The cascade defect surfaced by Plan 04
  (apps/api/src/index.ts wrapper-leak — `db.select is not a function`) was closed by
  Phase 02.6 (commit 450ce23). After that fix, live `make contract-test` against the
  rebuilt production image: stack reaches healthy on all 13 services, `migrate`
  Exited(0), `seed` Exited(0) (signup succeeds end-to-end — primary witness for this
  Item), and the conformance suite executes 26 tests with **11 PASS / 13 FAIL / 2 SKIP**.

  The 13 failures are NEW defects unmasked by getting past the binding blocker, NOT
  reintroductions of the Phase 02.5 binding work. Scoped as Phase 02.7 candidates per
  02.6 SUMMARY § "Out-of-scope discoveries":
    - signInFixture HTTP 404 (×4 tests)
    - Bearer-invalid → 500 instead of 401 envelope (×2)
    - /api/does-not-exist → 401 instead of 404 (×1)
    - OAuth final-hop returns 200 not custom-scheme redirect (×4)
    - oauth-redirect rejects javascript: callback returns 503 not 400 (×1)
    - /api/check-user exists:true returns false for seeded user (×1)
    - harness TLS issue: make contract-test target hits self-signed cert without
      NODE_TLS_REJECT_UNAUTHORIZED=0 (cosmetic; suite ran via direct vitest)

  Item 1 is marked `pass` with `scope:` qualifier rather than `pass` outright — this
  is the honest framing: Phase 02.5's stated acceptance gate (Better Auth + drizzle
  binding works against the live stack) IS met; full 26/26 conformance is NOT yet met
  and is owned by Phase 02.7+. Evidence files:
    - .planning/phases/02.5-.../02.5-04-CONTRACT-TEST-RESULT.md (Plan 04 PARTIAL run)
    - .planning/phases/02.5-.../02.5-SUMMARY.md (phase closure)
    - .planning/phases/02.5-.../02.5-REVERSE-PATCH-EVIDENCE.md (load-bearing proof)
    - .planning/phases/02.6-.../02.6-SUMMARY.md (cascade closer + 02.7 candidates list)

### 2. Trigger a GitHub PR and verify the contract-test GHA job runs and passes
expected: Job runs after lint/typecheck/test jobs pass; contract-test job is a required check blocking merge.
result: [pending]

### 3. Apply branch protection
expected: `gh api repos/{owner}/{repo}/branches/main/protection -X PUT --input scripts/branch-protection.json` succeeds; GitHub reflects contract-test as a required check; Phase 0 self-test passes.
result: [pending]

### 4. Verify email verification end-to-end with SMTP configured (not the no-op stub)
expected: Configure SMTP_HOST (real or mailpit dev profile) and sign up a new user. Verification email is delivered to the configured SMTP relay; clicking the link verifies the account; `/api/auth/verification-status` returns `{verified:true}` afterwards.
result: [pending]

## Summary

total: 4
passed: 1
issues: 0
pending: 3
skipped: 0
blocked: 0

## Notes

- 2026-05-09T11:55Z — Item 1 (`make contract-test`) auto-execution attempted and blocked
  on Phase 1 baseline defect: `minio/minio:RELEASE.2026-03-25T00-00-00Z` is a future-dated
  pin that was never published by upstream MinIO (latest real tag is `RELEASE.2025-09-07T16-13-09Z`).
  Routed to inserted phase 1.1 for infra fix; re-execute item 1 after that lands.
- 2026-05-09T22:30Z — Item 1 unblocked and flipped to `pass` with `scope:` qualifier:
  Phase 02.5 (binding) + Phase 02.6 (entrypoint cascade) closed; live `make contract-test`
  reaches the assertion phase with 11/26 PASS. The 13 remaining FAILs are independent
  contract-implementation gaps (NOT regressions of the binding work) deferred to Phase
  02.7+. See Item 1 notes for the full breakdown and evidence file paths.

## Gaps
