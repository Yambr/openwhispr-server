---
status: partial
phase: 02-auth-wire-api-skeleton-conformance-harness
source: [02-VERIFICATION.md]
started: 2026-05-09T11:55:48Z
updated: 2026-05-09T11:55:48Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Run `make contract-test` against a live docker-compose stack
expected: All 8 conformance test files pass (conventions, check-user, verification-status, delete-account, health, oauth-redirect, token-rotation, cookie-host). The `/api/_test/force-rotate` and `/api/_test/health-authed` routes now exist, so `token-rotation.test.ts` is satisfiable end-to-end. `oauth-redirect.test.ts` should pass as `mintBearer` is now wired.
result: [pending]

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
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
