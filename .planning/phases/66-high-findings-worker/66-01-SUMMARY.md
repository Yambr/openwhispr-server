---
phase: 66-high-findings-worker
plan: 01
subsystem: apps/worker
tags: [worker, security, robustness, constitutional, tdd]
requires: []
provides:
  - "apps/worker/src/config/worker-config.ts boundary file (EMAIL_FALLBACK_NONFATAL)"
  - "apps/worker/src/db/assert-direct-postgres.ts shared PgBouncer guard"
  - "apps/worker/src/lib/vkr-drain.ts (capped SCAN drain + failure counter)"
  - "apps/worker/src/lib/shutdown.ts (runShutdown with honest exit code)"
affects:
  - apps/worker/src/jobs/email-delivery.ts
  - apps/worker/src/lib/with-tenant-context.ts
  - apps/worker/src/jobs/partman-maintenance.ts
  - apps/worker/src/jobs/reconciliation-daily-check.ts
  - apps/worker/src/jobs/reconciliation-discrepancy.ts
  - apps/worker/src/index.ts
tech-stack:
  added: []
  patterns:
    - "boundary-file env reads (LOCKER-01): config/worker-config.ts"
    - "test-seam extraction: lib/vkr-drain.ts, lib/shutdown.ts pulled out of index.ts"
    - "collect-and-rethrow for idempotent retry under partial failure"
    - "deterministic BullMQ jobId for fan-out de-dup"
key-files:
  created:
    - apps/worker/src/config/worker-config.ts
    - apps/worker/src/db/assert-direct-postgres.ts
    - apps/worker/src/lib/vkr-drain.ts
    - apps/worker/src/lib/shutdown.ts
    - apps/worker/tests/unit/index-drain-stale-vkr.test.ts
    - apps/worker/tests/unit/index-shutdown.test.ts
    - apps/worker/tests/unit/db/assert-direct-postgres.test.ts
    - .planning/phases/66-high-findings-worker/verify-first.log
  modified:
    - apps/worker/src/jobs/email-delivery.ts
    - apps/worker/src/lib/with-tenant-context.ts
    - apps/worker/src/jobs/partman-maintenance.ts
    - apps/worker/src/jobs/reconciliation-daily-check.ts
    - apps/worker/src/jobs/reconciliation-discrepancy.ts
    - apps/worker/src/db/app-pool.ts
    - apps/worker/src/db/litellm-pool.ts
    - apps/worker/src/index.ts
    - tools/lint-no-env-branches.allowlist.txt
    - tools/lint-no-suppressions.allowlist.txt
decisions:
  - "CR-03 boundary file: apps/worker/src/config/worker-config.ts (EMAIL_FALLBACK_NONFATAL flag, never NODE_ENV)"
  - "CR-05 mitigation shape: collect-failures-and-re-throw-after-loop (BullMQ retries the whole list; discoverDetached is idempotent)"
  - "CR-07/CR-08 test seams: drainStaleVkrKeys + runShutdown extracted into lib/ modules — importing index.ts runs main() as a top-level side effect, so a separate module is the correct testable seam"
metrics:
  duration: "~75 min"
  completed: 2026-05-21
  tasks: 8
  files: 24
---

# Phase 66 Plan 01: HIGH findings — worker (CR-03..CR-09) Summary

Closed all 7 HIGH/BLOCKER findings in `apps/worker` via strict RED→GREEN TDD —
one constitutional LOCKER-01 fix plus six partial-failure / silent-loss
robustness gaps an enterprise self-host operator hits under Valkey / pg / SMTP
failure.

## Verify-first determination

All 7 findings re-confirmed STILL LIVE against `main` HEAD `25bda651` before any
fix — recorded with `file:line` evidence in
`.planning/phases/66-high-findings-worker/verify-first.log`. No divergence from
the planner's pre-determination. Cross-checked CR-03 against Phase 61 R19:
`packages/email/src/EmailSender.ts` emits `smtp-not-configured` (a separate,
correctly-bounded package surface) — the worker-side carve-out was NOT swept.
Confirmed `TypedQueue.add` already forwards a `JobsOptions` arg (planner flagged
as a maybe) — CR-06 needed no widening.

## Per-finding disposition

### CR-03 — email-delivery NODE_ENV constitutional fix (CONSTITUTIONAL)
- **RED+GREEN:** `52d7cbd8` (atomic).
- New boundary file `apps/worker/src/config/worker-config.ts` reads
  `EMAIL_FALLBACK_NONFATAL` (`"1"`/`"true"` → `true`); a `*config*.ts` file
  inside the LOCKER-01 allowed boundary set.
- `EmailDeliveryDeps.nodeEnv` removed; `allowSmtpFallback: boolean` added; the
  `process.env.NODE_ENV` read deleted entirely — `email-delivery.ts` now has
  **zero** `process.env` reads.
- `smtp-not-configured` now FAILS the job (throws → BullMQ retry/DLQ) unless
  `EMAIL_FALLBACK_NONFATAL` is explicitly set — staging / unset NODE_ENV no
  longer false-greens an unsent email.
- **Both LOCKER-01 allowlist entries REMOVED** from
  `tools/lint-no-env-branches.allowlist.txt` (lines for `email-delivery.ts:80`
  and `:95`); `grep -c "email-delivery.ts"` → `0`; `lint-no-env-branches: clean`.

### CR-04 — withTenantContext ROLLBACK error masking
- **RED+GREEN:** `f03895ec`.
- The `ROLLBACK` in the catch is now in its own try/catch; a throwing ROLLBACK
  is logged via `childLog.error` and `handlerErr` ALWAYS propagates — confirmed
  by a RED test whose ROLLBACK query is forced to throw and asserts the
  `HandlerSentinelError` (not the ROLLBACK error) reaches the caller.

### CR-05 — partman-maintenance enqueue-loop idempotency
- **RED+GREEN:** `12fe1ce1`.
- **Mitigation shape chosen: collect-failures-and-re-throw-after-loop.**
  Rationale: simplest + retry-safe — BullMQ retries the WHOLE detached list and
  `discoverDetached` is idempotent (already-archived partitions no longer match
  the predicate). The loop attempts EVERY partition, collects failures, and
  re-throws a summary error after the loop.

### CR-06 — reconciliation discrepancy de-dup via jobId
- **RED+GREEN:** `45b11961`.
- `reconciliationDiscrepancySchema` confirmed **worker-local**
  (`apps/worker/src/jobs/reconciliation-discrepancy.ts`, NOT a wire package) —
  no wire-package suite run.
- `window_id: z.string().optional()` added additively (schema is `.strict()` so
  the field must be declared; optional so existing/backfill enqueues still
  parse).
- `reconciliation-daily-check` derives `window_id = \`${start}:${end}\`` per
  tick and passes `{ jobId: \`recon-disc:${window_id}:${tenant}\` }` as the
  BullMQ options arg — a retried fan-out collapses re-enqueues.
- `TypedQueue.add` already forwarded `JobsOptions` — **no widening needed.**

### CR-07 — drainStaleVkrKeys iteration cap + failure metric
- **RED+GREEN:** `67e477f7`.
- `drainStaleVkrKeys` extracted into `apps/worker/src/lib/vkr-drain.ts` (a
  testable seam — importing `index.ts` runs `main()` as a top-level side
  effect, so a separate module is the correct fix, not a workaround).
- SCAN loop capped at `VKR_DRAIN_MAX_ITERATIONS = 1000` — a misbehaving Valkey
  cursor can no longer lock boot.
- Cleanup failure increments the `worker_vkr_cleanup_failures_total` OTel
  counter (`metrics.getMeter("worker")`), with an underscore-prefixed
  test-mirror seam.

### CR-08 — worker shutdown exit code on drain failure
- **RED+GREEN:** `8955c7da`.
- Shutdown body extracted into `runShutdown(deps)`
  (`apps/worker/src/lib/shutdown.ts`, testable seam).
- Inspects the `Promise.allSettled` results for `rejected` AND guards every
  subsequent teardown await; tracks `shutdownErrored` and returns exit code
  `1` on ANY drain failure / `0` only on a fully-clean drain. `index.ts` calls
  `process.exit(code)` — a masked exit(0) no longer reports a false graceful
  shutdown to k8s/compose.

### CR-09 — shared assertDirectPostgres helper
- **RED+GREEN:** `49a8f90f`.
- New shared helper `apps/worker/src/db/assert-direct-postgres.ts`
  (`assertDirectPostgres(url, envVarName)`).
- `makeAppOwnerPool`, `makeLitellmPool`, AND the inline `maintenancePool`
  construction in `index.ts` all route through it — no worker pg pool can
  silently point at PgBouncer transaction-mode.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] CR-07/CR-08 test seams extracted to lib/ modules**
- **Found during:** Task 5 (CR-07).
- **Issue:** The plan said to `export drainStaleVkrKeys` / extract `runShutdown`
  *from* `index.ts`. But `index.ts` runs `assertBYOKConfig()` and `main()` as
  top-level side effects on import — any test importing a named export from
  `index.ts` would attempt Redis/Postgres connections and hang/fail.
- **Fix:** Created `apps/worker/src/lib/vkr-drain.ts` and
  `apps/worker/src/lib/shutdown.ts`; `index.ts` imports both. This is the
  legitimate testable seam the plan intended (the plan's risk register already
  framed the extraction as "also improves the code"), just in a dedicated
  module rather than an `index.ts` export. No behaviour change.
- **Files:** `apps/worker/src/lib/vkr-drain.ts`,
  `apps/worker/src/lib/shutdown.ts`, `apps/worker/src/index.ts`.
- **Commits:** `67e477f7`, `8955c7da`.

**2. [Rule 3 - Blocking] LOCKER-02 allowlist line realignment**
- **Found during:** Task 7 (CR-09).
- **Issue:** Adding the `assertDirectPostgres` import to `app-pool.ts` shifted
  the 9 pre-existing `as any` suppression lines (WR-02 debt, out of scope) down
  by one — LOCKER-02's allowlist `file:line` entries no longer matched and
  `pnpm lint:lockers` refused the commit.
- **Fix:** Updated the 9 `app-pool.ts` entries in
  `tools/lint-no-suppressions.allowlist.txt` (61→62, 70→71, … 142→143) — a
  pure line-number realignment of EXISTING debt, no new suppressions added.
  The plan explicitly anticipated this ("Update LOCKER allowlist `file:line`
  entries for OTHER files if edits shift lines").
- **Files:** `tools/lint-no-suppressions.allowlist.txt`.
- **Commit:** `49a8f90f`.

## LOCKER outcome

- All 8 constitutional lockers green (`pnpm lint:lockers` exit 0).
- LOCKER-01 allowlist shrank by 2 lines — both `email-delivery.ts` entries
  removed; `lint-no-env-branches: clean`.
- LOCKER-02 allowlist: 9 `app-pool.ts` entries realigned (no net additions).

## Typecheck

`pnpm typecheck` — exactly the documented **5-error baseline**, all in
`apps/api` (`routes/index.ts` ×3, `tokens/assemblyai.ts`, `tokens/deepgram.ts`).
**Zero new errors; zero in `apps/worker`.**

## Test result

`pnpm --filter @openwhispr/worker test` — **25 test files, 220 tests, 0
failing.** Baseline was 202; net +18 (CR-03 +4 / −3 removed HI-01 nodeEnv
tests, CR-04 +1, CR-05 +1, CR-06 +1, CR-07 +3, CR-08 +4, CR-09 +7). One
transient testcontainer-contention file-failure was observed on a parallel run
and did not reproduce in isolation or on re-run (known `apps/worker` Ryuk-leak
flakiness — `feedback_testcontainers_cleanup_audit`).

## Review artifacts

- `.planning/review/worker.md` — per-finding `**Status:** CLOSED 2026-05-21 —
  Phase 66, commit <sha>` markers appended under CR-03..CR-09; a Closure log
  section added; WR-01..WR-08 noted OPEN/out-of-scope.
- `.planning/review/REVIEW-INDEX.md` — `apps/worker` roll-up row updated:
  `HIGH 7 → 0 (✅ Phase 66)`; CR-01/02 noted closed by Phase 58.

## Self-Check: PASSED

- Created files verified present: `config/worker-config.ts`,
  `db/assert-direct-postgres.ts`, `lib/vkr-drain.ts`, `lib/shutdown.ts`, 3 new
  test files, `verify-first.log`.
- Commits verified on HEAD: `9ba2e063`, `52d7cbd8`, `f03895ec`, `12fe1ce1`,
  `45b11961`, `67e477f7`, `8955c7da`, `49a8f90f`, `1d239fdf`.
- `grep -c "process.env" email-delivery.ts` → 0; `grep -c "email-delivery.ts"`
  allowlist → 0; `pnpm lint:lockers` exit 0.
