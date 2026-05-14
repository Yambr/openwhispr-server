---
status: resolved
trigger: "Replace DB-fakes in Plan 12-02 tests with real Postgres testcontainer (D-12.02-EX1)"
created: 2026-05-14
updated: 2026-05-14
---

## Current Focus

reasoning_checkpoint:
  hypothesis: "audit.test.ts's inline harness (PARTMAN_IMAGE + CREATE SCHEMA partman + CREATE EXTENSION pg_partman + role/grants chain) is the proven working pattern for migration 0014. Mirroring this exact chain in a new apps/api/src/routes/__tests__/setup.ts will boot a fully-migrated PG including setup_state singleton row (created by migration 0017) sufficient to back capabilities.ts and setup-state.ts handlers with real SQL."
  confirming_evidence:
    - "docker image ls confirms openwhispr/postgres:17.5-pgpartman:88e79d6ba7de exists locally — no network pull needed"
    - "apps/api/src/lib/audit.test.ts:48-145 already runs successfully through migration 0014 with this exact provisioning chain"
    - "Migration 0017 creates setup_state row via INSERT ... SELECT 1, CASE WHEN EXISTS(SELECT FROM users) THEN 'skipped_legacy' ELSE 'pending' END; on a fresh DB the row will be {id:1, status:'pending'}"
    - "Both handlers query SELECT status FROM setup_state WHERE id = 1 via db.transaction(tx => tx.execute(sql\`...\`)); the real drizzle NodePgDatabase satisfies this contract exactly"
    - "capabilities.test.ts buildApp pattern (onRequest hook stamps req.user/req.tenant) is directly portable since the handler does not actually need a Better Auth session — it just reads req.user + req.tenant"
  falsification_test: "Run the rewritten suite via pnpm vitest run capabilities.test.ts setup-state.test.ts. If any test fails with SQLSTATE 3F000 (partman schema missing) → the executor's diagnosis was actually correct and we need a deeper image fix. If all 17 tests pass → hypothesis confirmed."
  fix_rationale: "Replaces process-boundary-fake-of-internal-DB-logic (which violates CLAUDE.md's no-mocks-of-internal-logic rule because drizzle's transaction/execute IS internal logic, not a process boundary — the DB driver IS the process boundary one level below) with the real Postgres testcontainer that audit.test.ts already proves works. Addresses the root-cause discipline violation, not a symptom."
  blind_spots: "1) capabilities.test.ts's ETag tests assert opaque hashes that depend only on (tenantId, envHash, setupStatus) — should still work with real PG since values are unchanged. 2) The setup-state info-leak gate's `/email/i` regex would match the literal string 'completed' or 'pending'? No — only 'email' substring; safe. 3) Rate-limit timing under real-PG latency: 31 sequential injects within 60s window — testcontainer queries are ~1-5ms so well within budget."

hypothesis: replace fakes with real PG inline harness mirroring audit.test.ts pattern
test: write setup.ts harness, rewrite both test files, run vitest
expecting: all 17 tests pass against real PG (8 capabilities + 9 setup-state)
next_action: write apps/api/src/routes/__tests__/setup.ts then rewrite both test files

## Symptoms

expected: apps/api integration tests use real Postgres testcontainer (CLAUDE.md rule: no mocks of internal logic; DB code uses real PG via testcontainers)
actual: capabilities.test.ts and setup-state.test.ts both use makeFakeDb() — violates constitutional rule
errors: none at runtime; this is a discipline/policy violation
reproduction: read either test file; grep for makeFakeDb
started: commits fc27e79 and 60e7ab4 (Plan 12-02 Tasks 3 and 5)

## Eliminated

## Evidence

- timestamp: 2026-05-14T0
  checked: docker image ls openwhispr/postgres:17.5-pgpartman
  found: 88e79d6ba7de exists locally (279MB, 16h old)
  implication: No Docker Hub pull required; executor's TLS-handshake-timeout justification for the fake is invalid

- timestamp: 2026-05-14T0
  checked: docker ps -a --filter label=org.testcontainers
  found: empty
  implication: clean baseline before this work

## Resolution

root_cause: Executor of Plan 12-02 Tasks 3 + 5 misdiagnosed apps/api integration harness as lacking pg_partman support and locally-built openwhispr/postgres:17.5-pgpartman image as unavailable; chose makeFakeDb fake of drizzle transaction.execute. Both premises were false (audit.test.ts proves the harness pattern works; docker image ls confirms 88e79d6ba7de exists).
fix: Added apps/api/src/routes/__tests__/setup.ts (inline real-PG harness mirroring audit.test.ts and notes/__tests__/setup.ts); rewrote both test files to drop makeFakeDb in favor of bootMigratedPostgres + resetSetupState; preserved every assertion; replaced 1 fake-internals test (chunk-walker SQL inspector) with a real-PG equivalent that proves the handler projects only `status` and not `completed_at`.
verification: pnpm vitest run apps/api/src/routes/__tests__/capabilities.test.ts apps/api/src/routes/__tests__/setup-state.test.ts → 17/17 passing in 8.29s; docker ps -a --filter label=org.testcontainers empty post-run (clean Ryuk cleanup).
files_changed:
  - apps/api/src/routes/__tests__/setup.ts (new, 220 LOC)
  - apps/api/src/routes/__tests__/capabilities.test.ts (rewritten, 9 tests)
  - apps/api/src/routes/__tests__/setup-state.test.ts (rewritten, 8 tests)
  - .planning/phases/12-admin-onboarding-wizard-ui-spec-conformance-audit-v2/12-02-SUMMARY.md (appended "Deviation D-12.02-EX1 — CLOSED" section)
