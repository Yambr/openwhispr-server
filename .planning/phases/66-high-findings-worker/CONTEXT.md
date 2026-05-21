# Phase 66 — HIGH findings: worker (7 / CR-03..09)

## Background

Pre-publication HIGH-backlog clearance, phase-by-phase by package
(user decision 2026-05-20). Phases 62–65 cleared api-core (5),
api-routes-rest (3), api-routes-conversations (4),
api-routes-transcriptions (11). This phase clears the **`apps/worker`**
HIGH cluster — 7 findings (`.planning/review/worker.md`, CR-03..CR-09).
The worker review numbers all findings `CR-NN`; CR-01/CR-02 were the
two CRITICALs already closed in Phase 58 (`worker:CR-01/CR-02`).
CR-03..CR-09 are the 7 HIGH/BLOCKER findings.

## The 7 HIGH findings (from `.planning/review/worker.md`)

**Re-verify each against current code before fixing** (CLAUDE.md hard
rule 3). Phase 58 closed worker CR-01/CR-02 and Phase 61 touched the
email-delivery path (R19 SMTP wiring) — CR-03 may interact with that;
confirm.

### CR-03 — email-delivery silent-success on `smtp-not-configured` + LOCKER-01 violation
`jobs/email-delivery.ts:~111-117,95` — when the sender reports
`smtp-not-configured` and `NODE_ENV !== "production"`, the handler
`return`s early → a green job that never delivered. Two problems:
(1) **silent acknowledgement of unsent email** — the swallowed-error
anti-pattern; `NODE_ENV=staging`/unset gets a false-green job.
(2) **CONSTITUTIONAL LOCKER-01 violation** — `process.env.NODE_ENV`
comparison in `jobs/email-delivery.ts` is outside the allowed boundary
files (`bootstrap.ts`/`config/*.ts`/`otel-bootstrap.ts`/`*.config.ts`);
`tools/lint-no-env-branches.ts` refuses it (it is currently allowlisted
as debt — this phase removes the debt).
Fix: thread a real config flag (e.g. `EMAIL_FALLBACK_NONFATAL`) through
`bootstrap`, inject via `deps` (rename `deps.nodeEnv` →
`deps.allowSmtpFallback` or similar). The NODE_ENV read moves to a
boundary file. And the fallback must NOT silently green an unsent
email in staging — decide the correct behavior (fail the job unless
the explicit opt-in flag is set; the dev-compose-up convenience is
gated behind the flag, not behind `NODE_ENV`). Remove the LOCKER-01
allowlist entry for this file once the env read is gone.

### CR-04 — `withTenantContext` ROLLBACK can replace the original handler error
`lib/with-tenant-context.ts:~147-154` — `catch (handlerErr) { await client.query("ROLLBACK"); throw handlerErr; }`
— if `ROLLBACK` itself throws, the outer catch is replaced by the
ROLLBACK error and `handlerErr` is lost → BullMQ retries the wrong
cause. Fix: wrap `ROLLBACK` in its own `try { } catch (rbErr) { /* log/attach */ }`
so `handlerErr` always wins.

### CR-05 — `partman-maintenance` audit-archive enqueue loop not idempotent under partial failure
`jobs/partman-maintenance.ts:~68-80` — `for (const partition of detached) await auditArchiveQueue.add(...)`
has no per-iteration error guard. A mid-loop enqueue throw leaves the
remaining partitions detached-but-not-archived; a later successful
`audit-archive` job can drop one before this job retries → permanent
archive loss. Fix: collect failures + re-throw after the loop (so the
job fails and retries the WHOLE list), or `Promise.allSettled` + log,
or a checkpoint table. Weigh during planning — the re-throw-after-loop
shape is simplest and makes the retry safe.

### CR-06 — reconciliation-daily-check throws mid-loop → duplicate discrepancy enqueues on retry
`jobs/reconciliation-daily-check.ts:~213-242` — the breach fan-out
`await discrepancyQueue.add(...)` per tenant; a mid-loop throw aborts
before the `driftStore.clear()` so a BullMQ retry re-runs the whole
fan-out for tenants 1..N. `reconciliationDiscrepancySchema` has no
`request_id`/`window_id` → `typedQueue.add()` cannot de-dup via
`jobId`. Fix: add a stable id field (`request_id: z.string().uuid()`
or `window_id`) to the discrepancy schema, pass it as the BullMQ
`jobId` so re-enqueues collapse; optionally `Promise.allSettled` the
fan-out.

### CR-07 — boot-time `drainStaleVkrKeys` silent failure, no iteration cap, no metric
`apps/worker/src/index.ts:~127-155` — the `do { } while (cursor !== "0")`
SCAN loop has no upper-bound cap (a misbehaving Valkey returning a
non-zero cursor forever locks boot); the catch logs at `warn` with no
counter/alert. Fix: (a) add a `MAX_ITERATIONS` cap, (b) emit an OTel
counter on cleanup failure.

### CR-08 — worker shutdown always `process.exit(0)` even on drain failure
`apps/worker/src/index.ts:~262-278` — `Promise.allSettled` never
rejects so per-worker drain failures are swallowed; the process exits
0 regardless → k8s/compose records a graceful shutdown, masking
abandoned in-flight jobs during rolling deploys. Fix: track a
`shutdownErrored` flag (inspect the `allSettled` results + the
subsequent awaits) and `process.exit(shutdownErrored ? 1 : 0)`.

### CR-09 — `maintenancePool` lacks the PgBouncer guard `appOwnerPool` enforces
`apps/worker/src/index.ts:~174-177` — `maintenancePool` is `new Pool({ connectionString: DATABASE_URL_OWNER, max: 1 })`
inline, with no PgBouncer-hostname guard. `makeAppOwnerPool` DOES guard
(`db/app-pool.ts`). If the URL points at PgBouncer transaction-mode,
`partman.run_maintenance_proc()`'s internal COMMITs silently corrupt
partman state. Fix: extract a shared `assertDirectPostgres(url)` helper
used by both `makeAppOwnerPool` AND the inline `maintenancePool`
construction (and `litellmPool` if it has the same gap — check).

## Goal

After this phase:
1. CR-03..CR-09 each fixed-and-verified OR confirmed already-resolved.
2. Each fix lands via strict TDD (RED→GREEN→REFACTOR), atomic commits.
3. Tests cover the regression-shape.
4. `pnpm --filter @openwhispr/worker test` green (+ `@openwhispr/data`
   if the CR-06 schema change touches a shared schema package);
   `pnpm lint:lockers` green (8 lockers — CR-03 REMOVES a LOCKER-01
   allowlist entry); `pnpm typecheck` no new errors vs the 5-error
   baseline.
5. `.planning/review/worker.md` + `REVIEW-INDEX.md` annotated with
   per-finding closure markers.

## Constraints

- **Strict TDD** — RED→GREEN→REFACTOR; test + production code atomic.
- **Verify-first** — every finding re-confirmed against current code;
  CR-03 cross-checked against Phase 61 (R19 SMTP wiring).
- **CR-03 is a constitutional fix** — the LOCKER-01 NODE_ENV violation
  MUST be genuinely resolved (env read moved to a boundary file, the
  allowlist entry removed) — not re-allowlisted. `pnpm lint:lockers`
  must pass with the entry GONE.
- **CR-06 schema change** — if `reconciliationDiscrepancySchema` lives
  in a shared package (`@openwhispr/wire-schemas` or similar), adding
  `request_id` is a wire change — keep it additive/optional-safe and
  run that package's test suite.
- **No mocks of internal logic** — DB/worker tests use real Postgres +
  Valkey via testcontainers (already wired in `apps/worker`).
- **No bypassing gitleaks hooks** — CLAUDE.md hard rule 4.
- **Constitutional lockers green** — `pnpm lint:lockers` (8) after every
  finding.
- **No production code edited "to make tests pass"** — CLAUDE.md hard
  rule 1. HALT + `.planning/deferred-items.md` if blocked.
- **commitlint** — conventional-commit, lowercase subject, ≤ ~72 chars.
- **Out of scope** — WR-01..05 (MEDIUM/WARNING) and any LOW. Do not
  scope-creep.
- **EN-only** source artifacts.

## Verification gate

Phase passes when:
1. CR-03..CR-09 each have a RED test + GREEN fix on main, OR a
   documented already-closed disposition.
2. `pnpm --filter @openwhispr/worker test` green (+ data/wire-schemas
   if touched by CR-06).
3. `pnpm lint:lockers` green (8 lockers) — and the CR-03 LOCKER-01
   allowlist entry for `email-delivery.ts` is REMOVED, not re-added.
4. `pnpm typecheck` — no new errors vs the 5-error baseline.
5. Spot-check: each fixed finding's regression test references its ID
   (CR-03..09).
6. `git log --oneline` shows the expected RED/GREEN commits.
7. `.planning/review/worker.md` + `REVIEW-INDEX.md` annotated.

## Reference

- `.planning/review/worker.md` — CR-03..CR-09 + WR-01..05 (MEDIUM, OOS)
- `apps/worker/src/jobs/email-delivery.ts` — CR-03
- `apps/worker/src/lib/with-tenant-context.ts` — CR-04
- `apps/worker/src/jobs/partman-maintenance.ts` — CR-05
- `apps/worker/src/jobs/reconciliation-daily-check.ts` — CR-06
- `apps/worker/src/index.ts` — CR-07, CR-08, CR-09
- `apps/worker/src/db/app-pool.ts` — `makeAppOwnerPool` PgBouncer guard (CR-09)
- `tools/lint-no-env-branches.ts` + its allowlist — CR-03 (LOCKER-01)
- Phase 58 (worker CR-01/CR-02 — already closed): `.planning/phases/58-remaining-critical-fixes/`
- Phase 61 (R19 SMTP wiring — CR-03 interaction): `.planning/phases/61-slim-core-email-delivery/`
- CLAUDE.md hard rules: 1, 3, 4; LOCKER-01 (rule 11)
