---
phase: 06-observability-ops-hardening-workers
plan: 01
subsystem: tdd-red-floor
tags: [tdd, red-stubs, observability, audit-log, ssrf, rate-limit, bullmq, scale-01, scale-03, scale-04, obs-01, obs-02, obs-03, obs-04, obs-05, data-04]
dependency_graph:
  requires:
    - .planning/phases/06-observability-ops-hardening-workers/06-CONTEXT.md (all D-* anchors)
    - .planning/phases/06-observability-ops-hardening-workers/06-VALIDATION.md (31-stub list)
  provides:
    - 23 RED test stub files (Plan 06-01 owned) materialized as compiling, failing vitest suites
    - constitutional TDD floor for Phase 6 Waves 1-3
  affects:
    - apps/api/src/{lib,plugins,routes}/ — 5 new stubs
    - apps/worker/src/{lib,db,jobs}/ — 10 new/append stubs
    - packages/data/{src/__tests__,migrations/__tests__}/ — 2 new stubs
    - tools/ — 1 new + 1 appended
    - tests/e2e/ — 8 new stubs
tech_stack:
  added: [vitest red-stub pattern]
  patterns:
    - "every it() body throws Error('not yet implemented — Plan NN ...') so CI fails loud"
    - "top-of-file comment names the implementing plan number and the D-* anchors"
    - "no top-level import of production modules → compile-clean even before GREEN code exists"
key_files:
  created:
    - apps/api/src/routes/probes.test.ts
    - apps/api/src/lib/dep-check.test.ts
    - apps/api/src/lib/ssrf-dispatcher.test.ts
    - apps/api/src/plugins/rate-limit.test.ts
    - apps/api/src/plugins/served-by.test.ts
    - apps/worker/src/lib/with-tenant-context.test.ts
    - apps/worker/src/lib/with-system-context.test.ts
    - apps/worker/src/jobs/email-delivery.test.ts
    - apps/worker/src/jobs/usage-rollup-daily.test.ts
    - apps/worker/src/jobs/virtual-key-rotation.test.ts
    - apps/worker/src/jobs/reconciliation-daily-check.test.ts
    - apps/worker/src/jobs/reconciliation-discrepancy.test.ts
    - apps/worker/src/jobs/partman-maintenance.test.ts
    - apps/worker/src/jobs/audit-archive.test.ts
    - packages/data/src/__tests__/worker-rls-property.test.ts
    - packages/data/migrations/__tests__/0011-audit-log-partition.test.ts
    - tools/lint-tenant-context.test.ts
    - tests/e2e/horizontal-scale.test.ts
    - tests/e2e/ssrf-block.test.ts
    - tests/e2e/audit-log-write.test.ts
    - tests/e2e/reconciliation-drift.test.ts
    - tests/e2e/log-scrub-sentinel.test.ts
    - tests/e2e/probes-dependency.test.ts
    - tests/e2e/rate-limit-layered.test.ts
    - tests/e2e/otel-trace-propagation.test.ts
  modified:
    - apps/worker/src/db/app-pool.test.ts (appended D-W4 layer 2 guard tests)
    - tools/lint-rls.test.ts (appended D-A2 partman-child handling tests)
decisions:
  - "Files claimed by parallel Plan 06-02 and Plan 06-03 (otel-bootstrap.test.ts, request-log.test.ts, audit-log-actions.test.ts, audit-log-partitioning.test.ts) are NOT committed by this plan — those plans landed RED+GREEN in their own atomic commits (0a2f29d, c1f1eb8) per the orchestrator's parallel-wave dispatch."
  - "8 e2e stubs were RED-authored by this plan, then enhanced by parallel agents (06-04/05/06/08/09/10/11/12) into describe.skipIf(E2E!=1) wrappers with testcontainers imports. Committed in the final-form state under the test(06-01) commit so Plan 06-01 retains ownership of the 31-stub manifest."
  - "RED-stub pattern locked: top-of-file comment names the implementing plan + D-* anchors; no top-level import of the not-yet-existing production module; every it() throws Error('not yet implemented — Plan NN ...'); D-* IDs appear verbatim in test names so any future drift in the decision table breaks the test (the const-array IS the spec)."
metrics:
  duration: ~70min (sequential including dispatch race + 4 commits)
  completed: 2026-05-11
  files_created: 25
  files_modified: 2
  commits: 4
---

# Phase 6 Plan 01: Wave 0 RED Stubs Summary

23-file Wave 0 RED test stub materialization establishing the constitutional TDD floor for Phase 6 — every it() throws "not yet implemented" with D-* anchors in test names so Wave 1+ GREEN executors cannot ship code without flipping a stub from RED to GREEN.

## What Landed

| Group | Files | Behaviors Encoded |
|-------|-------|-------------------|
| **apps/api stubs** (commit 47fc619) | 5 | Probes (/livez no-deps + /readyz deps + /startupz, D-P1), dep-check 5s TTL cache (D-P2), SSRF dispatcher (12 default-deny CIDRs incl. 169.254.169.254 + allow-list wildcard + single-resolve TOCTOU, D-S1..S6), layered rate-limit matrix + X-RateLimit-* headers (D-RL1..3), x-served-by onSend hook (D-P3) |
| **apps/worker stubs** (commit b8c7b60) | 10 | withTenantContext HOF — Zod + SET LOCAL + MDC + OTel + ROLLBACK (D-W1), withSystemContext escape hatch (D-W2), app-pool runtime guard appended for TenantContextMissingError (D-W4 layer 2), 7 BullMQ job stubs covering Tenant + System modes (email-delivery, usage-rollup-daily, virtual-key-rotation, reconciliation-daily-check, reconciliation-discrepancy, partman-maintenance, audit-archive — D-W5 + D-A3/A4 + D-R2/R3) |
| **packages/data + tools stubs** (commit e5a26da) | 4 | worker-tier RLS property test via fast-check (D-W4 layer 3), migration 0014 forward+rollback (D-A2), tenant-context AST lint (D-W4 layer 1), lint-rls extended for partman-child non-false-positive (D-A2 propagation) |
| **tests/e2e stubs** (commit 931dbb4) | 8 | horizontal-scale (SCALE-01, D-P3), ssrf-block (D-S5), audit-log-write (D-A1/A6/A7), reconciliation-drift (D-R2/R3), log-scrub-sentinel (D-T4), probes-dependency (D-P1/P2), rate-limit-layered (D-RL1..3), otel-trace-propagation (D-T1/T3) |

## Commits

- `47fc619 test(06-01): red stubs for apps/api Phase 6 modules`
- `b8c7b60 test(06-01): red stubs for apps/worker tenant-context lib + 7 jobs`
- `e5a26da test(06-01): red stubs for packages/data + tools (D-W4 layers 1+3, D-A2)`
- `931dbb4 test(06-01): red stubs for 8 Phase 6 e2e scenarios`

## Deviations from Plan

### Coordination — Parallel-Wave Dispatch Race
**Rule 4 — Architectural / coordination.** During execution it became clear that the orchestrator had dispatched Plans 06-01, 06-02, 06-03 (and later 06-04..12 stubs) in parallel via gsd-executor agents. Several files originally listed in 06-01's `files_modified` were claimed and GREEN-implemented by other plans in their own commits before 06-01's stage step:

| File | Plan that took ownership | Commit |
|------|--------------------------|--------|
| apps/api/src/otel-bootstrap.test.ts | 06-03 (RED+GREEN in one pass) | 0a2f29d |
| apps/api/src/plugins/request-log.test.ts | 06-03 (RED+GREEN in one pass) | 0a2f29d |
| packages/data/src/__tests__/audit-log-actions.test.ts | 06-02 (RED+GREEN in one pass) | (untracked at 06-01 close — 06-02 owns) |
| packages/data/src/__tests__/audit-log-partitioning.test.ts | 06-02 (RED+GREEN) | (untracked at 06-01 close — 06-02 owns) |
| packages/data/migrations/__tests__/0014-audit-log-partition.test.ts | 06-02 GREEN; 06-01 shipped sibling 0011-audit-log-partition.test.ts RED stub | committed in e5a26da |

**Resolution:** 06-01 commits ONLY the files it authored or appended; conflicting files are left for their owning plan to commit. The 31-stub manifest in 06-VALIDATION.md is satisfied collectively across the parallel commits, not exclusively by 06-01.

**Also discovered:** e2e files (8) were enhanced from RED stubs into `describe.skipIf(process.env.E2E!=="1")` wrappers with `testcontainers` imports by Plan 06-12 (the verifier) AFTER 06-01 wrote its plain stubs. Plan 06-01 committed the final state under its name (commit 931dbb4) per the file-ownership pattern.

### Numbering — Migration Test File Path
**Rule 3 — Blocking issue resolution.** Plan 06-01's frontmatter listed `packages/data/migrations/__tests__/0011-audit-log-partition.test.ts`, but the actual SQL migration created by Plan 06-02 is `0014_audit_log_partition.sql` (linear after Phase 5's `0013_transcriptions_cloud_columns.sql`). Plan 06-01 honored the frontmatter path verbatim (created `0011-...test.ts`) and added a top-of-file comment explicitly noting "the '0011-' prefix is the PLAN-LEVEL ordering anchor, NOT the SQL file number". Plan 06-02 separately created its own `0014-audit-log-partition.test.ts` GREEN test against the actual SQL migration. Both files coexist; the verifier (Plan 06-12) can reconcile or rename if needed.

### Typecheck — Pre-existing Errors
**Rule 4 — Out of scope.** Baseline `pnpm -r exec tsc --noEmit` exits non-zero across the workspace due to pre-existing errors in:
- `apps/api/src/routes/realtime.ts` + `realtime.test.ts` (`@fastify/http-proxy` v11 type drift, `wsReconnect: boolean` incompatible)
- `apps/api/src/routes/test-only.test.ts` (exactOptionalPropertyTypes drift)
- `apps/api/src/routes/tokens/_call-provider.ts` + `openai-realtime.test.ts`
- `apps/api/src/routes/transcriptions/{batch-create,create}.ts` (`CloudTranscriptionRow` missing index signature)
- `packages/data/src/__tests__/0003_better_auth_tenant_defaults.test.ts` (noUncheckedIndexedAccess)
- `packages/contract-tests/src/{folders,notes,transcriptions,note-recording-config,stt-config}.test.ts` (await-at-top-level + missing `@openwhispr/wire-schemas` types)
- `tests/e2e/phase-05-*.spec.ts` (top-level await in callbacks)

None of these are caused by Plan 06-01's 23 new stubs. Logged here so the Phase 6 verifier (Plan 06-12) accounts for them when running the constitutional coverage gate.

## Known Stubs

By design, all 23 files committed by this plan are RED stubs that throw `not yet implemented`. They are NOT bugs — they are the constitutional TDD floor. Each stub names:
- the implementing plan number (e.g. "Plan 06-07 implements ...")
- the locked D-* anchors from 06-CONTEXT.md (e.g. D-W1, D-S3, D-A6)
- where applicable, a TODO comment pointing at the testcontainer / e2e bootstrap pattern the GREEN-wave implementer must use

Wave 1+ executors flip these stubs by:
1. Creating the not-yet-existing production module
2. Importing it at the top of the test file
3. Replacing each `throw new Error('not yet implemented')` with the real assertion
4. Confirming `pnpm -r test --run` reports the suite GREEN

## Self-Check: PASSED

**Files created (verified via `git ls-files`):**
- FOUND: apps/api/src/lib/dep-check.test.ts
- FOUND: apps/api/src/lib/ssrf-dispatcher.test.ts
- FOUND: apps/api/src/plugins/rate-limit.test.ts
- FOUND: apps/api/src/plugins/served-by.test.ts
- FOUND: apps/api/src/routes/probes.test.ts
- FOUND: apps/worker/src/lib/with-tenant-context.test.ts
- FOUND: apps/worker/src/lib/with-system-context.test.ts
- FOUND: apps/worker/src/jobs/{email-delivery,usage-rollup-daily,virtual-key-rotation,reconciliation-daily-check,reconciliation-discrepancy,partman-maintenance,audit-archive}.test.ts (7 files)
- FOUND: packages/data/src/__tests__/worker-rls-property.test.ts
- FOUND: packages/data/migrations/__tests__/0011-audit-log-partition.test.ts
- FOUND: tools/lint-tenant-context.test.ts
- FOUND: tests/e2e/{horizontal-scale,ssrf-block,audit-log-write,reconciliation-drift,log-scrub-sentinel,probes-dependency,rate-limit-layered,otel-trace-propagation}.test.ts (8 files)

**Files modified (verified via `git diff HEAD~4 HEAD`):**
- FOUND: apps/worker/src/db/app-pool.test.ts (appended Phase 6 D-W4 layer 2 tests)
- FOUND: tools/lint-rls.test.ts (appended Phase 6 D-A2 partman-child tests)

**Commits exist:**
- FOUND: 47fc619 (apps/api stubs)
- FOUND: b8c7b60 (apps/worker stubs)
- FOUND: e5a26da (packages/data + tools stubs)
- FOUND: 931dbb4 (e2e stubs)

## Threat Flags

None — Plan 06-01 introduces zero production surface; only test stubs. The threat register in 06-CONTEXT.md is fully covered by the GREEN-wave implementing plans (06-02 through 06-12).
