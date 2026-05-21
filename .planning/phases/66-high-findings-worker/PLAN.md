---
phase: 66-high-findings-worker
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/worker/src/jobs/email-delivery.ts
  - apps/worker/src/config/worker-config.ts
  - apps/worker/src/index.ts
  - apps/worker/src/lib/with-tenant-context.ts
  - apps/worker/src/jobs/partman-maintenance.ts
  - apps/worker/src/jobs/reconciliation-daily-check.ts
  - apps/worker/src/jobs/reconciliation-discrepancy.ts
  - apps/worker/src/db/assert-direct-postgres.ts
  - apps/worker/src/db/app-pool.ts
  - apps/worker/src/db/litellm-pool.ts
  - tools/lint-no-env-branches.allowlist.txt
  - apps/worker/tests/unit/jobs/email-delivery.test.ts
  - apps/worker/tests/unit/lib/with-tenant-context.test.ts
  - apps/worker/tests/unit/jobs/partman-maintenance.test.ts
  - apps/worker/tests/unit/jobs/reconciliation-daily-check.test.ts
  - apps/worker/tests/unit/index-drain-stale-vkr.test.ts
  - apps/worker/tests/unit/index-shutdown.test.ts
  - apps/worker/tests/unit/db/assert-direct-postgres.test.ts
  - .planning/phases/66-high-findings-worker/verify-first.log
  - .planning/review/worker.md
  - .planning/review/REVIEW-INDEX.md
autonomous: true
requirements: ["CR-03", "CR-04", "CR-05", "CR-06", "CR-07", "CR-08", "CR-09"]

must_haves:
  truths:
    - "CR-03: email-delivery no longer reads process.env.NODE_ENV — the env read is moved to a boundary file (apps/worker/src/config/worker-config.ts); a real config flag (EMAIL_FALLBACK_NONFATAL) is threaded through index.ts and injected via deps.allowSmtpFallback; the smtp-not-configured path fails the job (throws) UNLESS the explicit opt-in flag is set — staging no longer gets a false-green; the two LOCKER-01 allowlist entries for email-delivery.ts (lines :80, :95) are REMOVED and pnpm lint:lockers is green with them gone."
    - "CR-04: withTenantContext wraps the ROLLBACK in its own try/catch so a throwing ROLLBACK can never replace handlerErr — handlerErr always propagates; the ROLLBACK error is logged/attached, never thrown over the original."
    - "CR-05: partman-maintenance audit-archive enqueue loop guards each iteration — a mid-loop enqueue failure collects the failure and re-throws after the loop so the WHOLE detached list is retried atomically by BullMQ."
    - "CR-06: reconciliationDiscrepancySchema (worker-local, NOT shared) gains an additive optional window_id field; reconciliation-daily-check passes a deterministic window_id as the BullMQ jobId on discrepancyQueue.add so a mid-loop throw + retry collapses re-enqueues instead of duplicating per-tenant jobs."
    - "CR-07: drainStaleVkrKeys has a MAX_ITERATIONS cap on the SCAN loop (a misbehaving Valkey cursor can no longer lock boot) and emits an OTel counter on cleanup failure."
    - "CR-08: worker shutdown tracks a shutdownErrored flag (from the Promise.allSettled results + the subsequent awaits) and calls process.exit(shutdownErrored ? 1 : 0) so a drain failure is no longer masked as a graceful exit."
    - "CR-09: a shared assertDirectPostgres(url) helper is extracted and used by makeAppOwnerPool, makeLitellmPool, AND the inline maintenancePool construction in index.ts — no pool can silently point at PgBouncer transaction-mode."
    - "All 8 constitutional lockers green (pnpm lint:lockers) after every finding; pnpm typecheck shows no new errors vs the 5-error baseline; pnpm --filter @openwhispr/worker test green."
  artifacts:
    - path: ".planning/phases/66-high-findings-worker/verify-first.log"
      provides: "per-finding still-live / already-closed disposition with file:line evidence for CR-03..CR-09; the CR-03 boundary-file decision and the CR-05 mitigation-shape decision"
      contains: "CR-03"
    - path: "apps/worker/src/config/worker-config.ts"
      provides: "boundary file (NODE_ENV + EMAIL_FALLBACK_NONFATAL reads) — the only place email-delivery's env contract is resolved"
      contains: "EMAIL_FALLBACK_NONFATAL"
    - path: "apps/worker/src/db/assert-direct-postgres.ts"
      provides: "shared PgBouncer-hostname guard used by all three pool constructors"
      contains: "assertDirectPostgres"
    - path: ".planning/review/worker.md"
      provides: "per-finding closure markers appended to CR-03..CR-09"
      contains: "CLOSED"
  key_links:
    - from: "apps/worker/src/jobs/email-delivery.ts"
      to: "deps.allowSmtpFallback (injected, no process.env read)"
      via: "config flag threaded from worker-config.ts through index.ts"
      pattern: "allowSmtpFallback"
    - from: "apps/worker/src/jobs/reconciliation-daily-check.ts"
      to: "discrepancyQueue.add(... { jobId })"
      via: "deterministic window_id passed as BullMQ jobId"
      pattern: "jobId"
    - from: "apps/worker/src/db/assert-direct-postgres.ts"
      to: "makeAppOwnerPool + makeLitellmPool + maintenancePool"
      via: "shared guard import"
      pattern: "assertDirectPostgres"
---

<objective>
Clear the 7 HIGH/BLOCKER findings (CR-03..CR-09) in `apps/worker`
(`.planning/review/worker.md`). CR-01/CR-02 (CRITICAL) were closed in Phase 58
and are out of scope.

Each finding is re-verified against current `main` BEFORE any fix (CLAUDE.md
hard rule 3). Planner pre-determination, which the executor MUST re-confirm
via the verify-first protocol:

- **CR-03 — STILL LIVE + CONSTITUTIONAL.** `email-delivery.ts:95` reads
  `process.env.NODE_ENV`; `:111` does `nodeEnv !== "production"` short-circuit.
  Two LOCKER-01 allowlist entries exist —
  `apps/worker/src/jobs/email-delivery.ts:80` and `:95` (lines 30-31 of
  `tools/lint-no-env-branches.allowlist.txt`). Phase 61 R19 touched the SMTP
  wiring in `@openwhispr/email`; the worker-side `email-delivery.ts` carve-out
  was NOT swept. This phase resolves the constitutional violation genuinely.
- **CR-04 — STILL LIVE.** `with-tenant-context.ts:149-152` — bare
  `await client.query("ROLLBACK")` inside `catch (handlerErr)`.
- **CR-05 — STILL LIVE.** `partman-maintenance.ts:76-78` — unguarded
  `for (const partition of detached) await auditArchiveQueue.add(...)`.
- **CR-06 — STILL LIVE.** `reconciliation-daily-check.ts:231-237` — per-tenant
  `discrepancyQueue.add` with no `jobId`; `reconciliationDiscrepancySchema`
  (defined at `reconciliation-discrepancy.ts:28`) is **worker-local, NOT a
  shared wire package** — adding `window_id` is a worker-internal change,
  not a wire change. No `@openwhispr/wire-schemas` suite to run.
- **CR-07 — STILL LIVE.** `index.ts:131-145` — `do { } while (cursor !== "0")`
  with no iteration cap; `:152-154` logs `warn` with no metric.
- **CR-08 — STILL LIVE.** `index.ts:266-277` — `process.exit(0)` unconditional.
- **CR-09 — STILL LIVE.** `index.ts:174-177` — inline `maintenancePool` with
  no PgBouncer guard; `makeAppOwnerPool` (`app-pool.ts:154-164`) and
  `makeLitellmPool` (`litellm-pool.ts:18-28`) BOTH have the same inline guard
  duplicated — CR-09 extracts one shared `assertDirectPostgres(url)` helper.

Each live finding is closed via strict RED→GREEN TDD; the RED asserts the
regression-shape; test + production code may land in the same atomic commit.
CR-07/CR-08/CR-09 all touch `index.ts` and are sequenced adjacent (Tasks 5-7)
but each keeps a distinct, ID-referenced RED test.

Purpose: remove the pre-publication constitutional violation (CR-03) and the
partial-failure / silent-loss robustness gaps an enterprise self-host operator
hits under Valkey / pg / SMTP failure, before 1000-concurrent load-test claims.

Output: per-finding RED+GREEN atomic commits, a `verify-first.log` evidence
record, and `.planning/review/worker.md` + `REVIEW-INDEX.md` annotated with
per-finding closure markers.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/66-high-findings-worker/CONTEXT.md
@.planning/review/worker.md
@CLAUDE.md

Already-read source (facts captured below — do NOT re-read whole files to
"check one more thing"; use Grep for anything more specific):

- **CR-03 — `email-delivery.ts`.** `:65-84` `EmailDeliveryDeps` carries
  `nodeEnv?: string | undefined` with a jsdoc block (`:69-83`). `:95` `const
  nodeEnv = deps.nodeEnv ?? process.env.NODE_ENV;` — the LOCKER-01 hit.
  `:111` `if (result.reason === "smtp-not-configured" && nodeEnv !==
  "production") return;` — the silent-green carve-out. `index.ts:195-203`
  wires `buildEmailDeliveryHandler({ pool, sender, renderer })` — `nodeEnv` is
  NOT passed, so production relies on the `?? process.env.NODE_ENV` fallback.
  The two LOCKER-01 allowlist lines to REMOVE are
  `tools/lint-no-env-branches.allowlist.txt` lines 30 (`:80` jsdoc) and 31
  (`:95` code). `@openwhispr/email`'s `createEmailSender`
  (`packages/email/src/EmailSender.ts:87`) reads `env.NODE_ENV` itself — that
  is a separate package, already correctly a boundary read, OUT OF SCOPE.
- **CR-04 — `with-tenant-context.ts:146-152`** — the inner try/catch:
  `try { await handler(...); await client.query("COMMIT"); } catch
  (handlerErr) { await client.query("ROLLBACK"); throw handlerErr; }`.
  `childLog` is in scope (`:130`). The fix wraps ROLLBACK in its own try.
- **CR-05 — `partman-maintenance.ts:75-79`** — `const detached = await
  discoverDetached(...); for (const partition of detached) { await
  deps.auditArchiveQueue.add("audit-archive", { partition_name: partition });
  } return { detached };`. No per-iteration guard.
- **CR-06 — `reconciliation-daily-check.ts`** — `:231-237` the breach
  `await deps.discrepancyQueue.add("reconciliation-discrepancy", { tenant_id,
  since, until, drift_pct, drift_usd_cents })`. `TypedQueue.add`'s signature
  is `Pick<TypedQueue<...>, "add">`. `reconciliationDiscrepancySchema` is at
  `reconciliation-discrepancy.ts:28-36` — `.object({...}).strict()`,
  WORKER-LOCAL. `.strict()` means a NEW field must be ADDED to the schema or
  parse rejects it.
- **CR-07/08/09 — `index.ts`.** `drainStaleVkrKeys` `:127-155`. `shutdown`
  `:262-278` (the `Promise.allSettled` + 6 awaits + `process.exit(0)`).
  `maintenancePool` `:174-177` inline `new Pool({ connectionString:
  process.env["DATABASE_URL_OWNER"], max: 1 })`. `makeAppOwnerPool`
  (`app-pool.ts:149-167`) and `makeLitellmPool` (`litellm-pool.ts:13-30`)
  each duplicate the `new URL(url).hostname` + `/pgbouncer/i` check.

<interfaces>
apps/worker/src/jobs/email-delivery.ts:
  EmailDeliveryDeps { pool: Pool; sender: EmailSender; renderer: TemplateRenderer;
                      nodeEnv?: string | undefined }   // CR-03 renames nodeEnv -> allowSmtpFallback: boolean
  buildEmailDeliveryHandler(deps): (job: Job) => Promise<void>

apps/worker/src/lib/typed-queue.ts — TypedQueue.add signature accepts an
  optional BullMQ JobsOptions arg (jobId lives there). Confirm the exact arity
  by `grep -n "add" apps/worker/src/lib/typed-queue.ts` in the verify step;
  if `add` does NOT forward an options arg, CR-06's GREEN must widen it
  additively (an optional 3rd param forwarded to BullMQ `queue.add`).

apps/worker/src/db/app-pool.ts — makeAppOwnerPool(env): pg.Pool
apps/worker/src/db/litellm-pool.ts — makeLitellmPool(env): pg.Pool
  Both currently inline: new URL(url).hostname + /pgbouncer/i.test(host) throw.
  CR-09 extracts assertDirectPostgres(url: string, envVarName: string): void.
</interfaces>

apps/worker unit tests run under vitest; DB-touching tests use real Postgres +
Valkey via testcontainers (already wired — see existing
`tests/unit/jobs/*.test.ts`, `tests/unit/db/app-pool.test.ts`). NO mocks of
internal logic — only the process/network boundary (BullMQ queue `.add`, the
EmailSender, the Valkey SCAN/DEL client, pg pools where a pure-unit shape test
suffices) may be stubbed. `with-tenant-context.test.ts` already exercises the
HOF against a testcontainer pool — CR-04's RED reuses that harness with a
client whose `ROLLBACK` query is forced to throw.
</context>

## Phase Goal

Close CR-03..CR-09 — each fixed via strict RED→GREEN TDD with the test
asserting the regression-shape. CR-03 is a constitutional fix: the LOCKER-01
NODE_ENV violation MUST be genuinely resolved (env read moved to a boundary
file, both allowlist entries removed) — NOT re-allowlisted.

---

## Verify-first protocol (MANDATORY, all findings)

Before any fix the executor writes
`.planning/phases/66-high-findings-worker/verify-first.log` and, per finding,
records **still-live / partially-mitigated / already-closed** with the
`file:line` evidence checked:

```
grep -n "process.env.NODE_ENV\|smtp-not-configured" apps/worker/src/jobs/email-delivery.ts        # CR-03
grep -n "email-delivery.ts" tools/lint-no-env-branches.allowlist.txt                              # CR-03 — expect 2 lines
grep -n 'query("ROLLBACK")' apps/worker/src/lib/with-tenant-context.ts                            # CR-04
grep -n "for (const partition of detached)" apps/worker/src/jobs/partman-maintenance.ts           # CR-05
grep -n "discrepancyQueue.add" apps/worker/src/jobs/reconciliation-daily-check.ts                 # CR-06
grep -n "window_id\|request_id" apps/worker/src/jobs/reconciliation-discrepancy.ts                # CR-06 — expect absent
grep -n 'while (cursor' apps/worker/src/index.ts                                                  # CR-07
grep -n "process.exit(0)" apps/worker/src/index.ts                                                # CR-08
grep -n "maintenancePool = new Pool\|pgbouncer" apps/worker/src/index.ts apps/worker/src/db/*.ts  # CR-09
```

Also re-cross-check CR-03 against Phase 61 (`grep -rn "smtp-not-configured"
packages/email/src`) — confirm the worker-side carve-out was not already
removed by R19. Each finding is expected STILL LIVE. If any grep contradicts
the pre-determination, STOP, treat per the evidence, record it in
`verify-first.log`, adjust the affected task, and report the divergence in the
SUMMARY.

Commit the log: `docs(66-01): verify-first — CR-03..CR-09 disposition log`.

---

## Task 1 — CR-03: email-delivery NODE_ENV constitutional fix

**Finding:** CR-03 (HIGH, CONSTITUTIONAL) — `email-delivery.ts:95` reads
`process.env.NODE_ENV` (LOCKER-01 violation, currently allowlisted); `:111`
silently `return`s a green job for `smtp-not-configured` in non-production —
`NODE_ENV=staging`/unset gets a false-green undelivered email.

### RED step
- New tests in `apps/worker/tests/unit/jobs/email-delivery.test.ts`. Test
  names MUST contain `CR-03`.
- **RED 1 — silent-green regression.** Build the handler with a stub
  `EmailSender` returning `{ delivered: false, reason: "smtp-not-configured" }`
  and `deps.allowSmtpFallback: false` (the new flag — does not exist yet, so
  this is a compile-RED until GREEN). Drive a job. Assert the handler
  **throws** (the job fails → BullMQ retries / DLQ — no false green). Then a
  second case with `allowSmtpFallback: true` asserts the handler resolves
  (the explicit dev opt-in). Pre-fix the only knob is `nodeEnv` and staging
  silently returns → RED fails.
- **RED 2 — constitutional guard.** A source-level assertion: read
  `email-delivery.ts` and assert `/process\.env\.NODE_ENV/` does NOT match.
  Pre-fix it matches → RED fails.
- Commit: `test(66-01): red — CR-03 email-delivery silent-green + NODE_ENV locker`.

### GREEN step
- New boundary file `apps/worker/src/config/worker-config.ts` — a `*config*.ts`
  file, inside the LOCKER-01 allowed boundary set. It reads
  `process.env.EMAIL_FALLBACK_NONFATAL` (a real opt-in flag — `"1"`/`"true"`
  → `true`) and exposes a typed config object (e.g.
  `export function loadWorkerConfig(env = process.env): WorkerConfig` with an
  `allowSmtpFallback: boolean` field). Do NOT key the flag off NODE_ENV at
  all — the dev-compose-up convenience is now an explicit opt-in, per CONTEXT.
- `email-delivery.ts` — `EmailDeliveryDeps`: REMOVE `nodeEnv?: string`, ADD
  `allowSmtpFallback: boolean`. Delete the `const nodeEnv = deps.nodeEnv ??
  process.env.NODE_ENV;` line entirely. Rewrite the carve-out: `if
  (result.reason === "smtp-not-configured" && deps.allowSmtpFallback) return;`
  — every other case (incl. `smtp-not-configured` WITHOUT the flag) throws.
  Update the `:69-83` jsdoc to describe the explicit opt-in flag, not NODE_ENV.
- `index.ts` — call `loadWorkerConfig()` near the other boot reads; pass
  `allowSmtpFallback: workerConfig.allowSmtpFallback` into
  `buildEmailDeliveryHandler({ ... })` at `:197-201`.
- `tools/lint-no-env-branches.allowlist.txt` — DELETE lines 30 and 31
  (`apps/worker/src/jobs/email-delivery.ts:80` and `:95`). Do NOT re-add.
- Commit: `fix(66-01): green — CR-03 thread EMAIL_FALLBACK_NONFATAL, drop NODE_ENV`.

### Verify
```
grep -n "NODE_ENV" apps/worker/src/jobs/email-delivery.ts                  # absent
grep -c "email-delivery.ts" tools/lint-no-env-branches.allowlist.txt       # 0
pnpm lint:lockers                                                          # 8 green, LOCKER-01 with the entries GONE
pnpm --filter @openwhispr/worker test -- email-delivery
```

### Done
CR-03 RED+GREEN pair on `main`; `email-delivery.ts` has no `process.env`
read; the env contract lives in `config/worker-config.ts`; the
`smtp-not-configured` path fails the job unless `EMAIL_FALLBACK_NONFATAL` is
explicitly set; both LOCKER-01 allowlist entries removed; `pnpm lint:lockers`
green with them gone.

---

## Task 2 — CR-04: withTenantContext ROLLBACK error masking

**Finding:** CR-04 (HIGH) — `with-tenant-context.ts:149-152` — a throwing
`client.query("ROLLBACK")` replaces `handlerErr`, so BullMQ retries the wrong
cause.

### RED step
- New test in `apps/worker/tests/unit/lib/with-tenant-context.test.ts`. Test
  name MUST contain `CR-04`.
- Build the HOF with a pool whose checked-out client throws on the `ROLLBACK`
  query specifically (a thin pool/client stub at the pg boundary — acceptable,
  the client is the process boundary — or the testcontainer harness with a
  client wrapper that intercepts `ROLLBACK`). The handler itself throws a
  recognizable `HandlerSentinelError`. Assert: the error that propagates out
  of the wrapped job is the `HandlerSentinelError` — NOT the ROLLBACK error.
  Pre-fix the ROLLBACK throw wins → RED fails.
- Commit: `test(66-01): red — CR-04 ROLLBACK throw masks handler error`.

### GREEN step
- `with-tenant-context.ts:149-152` — wrap the ROLLBACK:
  `catch (handlerErr) { try { await client.query("ROLLBACK"); } catch (rbErr)
  { childLog.error({ err: rbErr }, "ROLLBACK failed after handler error"); }
  throw handlerErr; }`. `handlerErr` ALWAYS re-throws; `rbErr` is logged, never
  thrown over the original.
- Commit: `fix(66-01): green — CR-04 wrap ROLLBACK so handler error always wins`.

### Verify
```
grep -n "ROLLBACK\|rbErr" apps/worker/src/lib/with-tenant-context.ts
pnpm --filter @openwhispr/worker test -- with-tenant-context
pnpm lint:lockers
```

### Done
CR-04 RED+GREEN pair on `main`; a throwing ROLLBACK can no longer replace the
original handler error.

---

## Task 3 — CR-05: partman-maintenance enqueue loop idempotency

**Finding:** CR-05 (HIGH) — `partman-maintenance.ts:76-78` — an unguarded
enqueue loop; a mid-loop throw leaves partitions detached-but-not-archived.

The CONTEXT and review name the re-throw-after-loop shape as simplest and
retry-safe (BullMQ retries the WHOLE list; `discoverDetached` is idempotent so
re-enqueuing already-archived partitions is harmless — they no longer match).
The executor MAY pick `Promise.allSettled` + collect instead; record the
choice + rationale in `verify-first.log`. Prefer re-throw-after-loop.

### RED step
- New test in `apps/worker/tests/unit/jobs/partman-maintenance.test.ts`. Test
  name MUST contain `CR-05`.
- Stub `auditArchiveQueue.add` to succeed for the first N-1 partitions and
  throw on the Nth. Stub `maintenancePool` so `discoverDetached` returns a
  fixed multi-partition list. Drive the handler. Assert: the handler **throws**
  (so BullMQ retries) AND `add` was attempted for ALL partitions after the
  failing one (the loop did not abort early) — i.e. the failure is collected,
  not fatal-on-first. Pre-fix the loop aborts on the Nth and the handler
  throws but partitions N+1.. were never attempted → RED fails on the
  "all-attempted" assertion.
- Commit: `test(66-01): red — CR-05 partman enqueue loop aborts on partial failure`.

### GREEN step
- `partman-maintenance.ts:76-78` — replace the bare loop: iterate all
  partitions inside a per-iteration `try/catch`, push failures into a
  `failures: Array<{ partition: string; err: unknown }>`; after the loop, if
  `failures.length > 0` throw an `Error` summarizing the failed partitions
  (so BullMQ retries the whole job). Successful enqueues for already-archived
  partitions on retry are harmless — `discoverDetached` no longer returns them.
- Commit: `fix(66-01): green — CR-05 collect enqueue failures, re-throw after loop`.

### Verify
```
grep -n "failures\|for (const partition" apps/worker/src/jobs/partman-maintenance.ts
pnpm --filter @openwhispr/worker test -- partman-maintenance
pnpm lint:lockers
```

### Done
CR-05 RED+GREEN pair on `main`; a partial enqueue failure fails the whole job
and retries the complete detached list.

---

## Task 4 — CR-06: reconciliation discrepancy de-dup via jobId

**Finding:** CR-06 (HIGH) — `reconciliation-daily-check.ts:231-237` — per-tenant
`discrepancyQueue.add` with no `jobId`; a mid-loop throw + BullMQ retry
re-runs the whole fan-out → duplicate per-tenant discrepancy jobs.
`reconciliationDiscrepancySchema` is **worker-local** (not a wire package) —
this is a worker-internal change; no external suite to run.

### RED step
- New test in `apps/worker/tests/unit/jobs/reconciliation-daily-check.test.ts`.
  Test name MUST contain `CR-06`.
- Drive the handler against a fixture (testcontainer Postgres) producing ≥2
  breached tenants. Capture every `discrepancyQueue.add` call's args. Assert:
  each `add` call passes a stable `jobId` (the BullMQ options arg) AND the
  `jobId` is deterministic for a given (window, tenant) — re-running the
  handler over the same window yields the SAME jobId per tenant (so a retry
  collapses). Pre-fix no `jobId` is passed → RED fails.
- Commit: `test(66-01): red — CR-06 discrepancy enqueue lacks de-dup jobId`.

### GREEN step
- `reconciliation-discrepancy.ts:28-36` — add an additive optional field to
  the schema: `window_id: z.string().optional()` (the schema is `.strict()`
  so the field MUST be declared or `.parse()` rejects it). Optional → existing
  enqueue sites and backfill jobs without it still parse.
- `reconciliation-daily-check.ts` — compute a deterministic
  `window_id = \`${windowStart}:${windowEnd}\`` once per tick; in the breach
  loop pass it on the payload AND pass `{ jobId: \`recon-disc:${window_id}:${tenantId}\` }`
  as the BullMQ options arg to `discrepancyQueue.add`.
- `apps/worker/src/lib/typed-queue.ts` — IF `TypedQueue.add` does not already
  forward a 3rd `JobsOptions` arg to BullMQ `queue.add`, widen it additively:
  add an optional `opts?: JobsOptions` param forwarded through. Confirm via
  grep in the verify-first step; if it already forwards opts, no change.
- Update `ReconciliationDiscrepancyDeps`'s `Pick<TypedQueue<...>, "add">` type
  remains valid (the widened `add` is a superset).
- Commit: `fix(66-01): green — CR-06 deterministic window_id jobId de-dup`.

### Verify
```
grep -n "window_id\|jobId" apps/worker/src/jobs/reconciliation-daily-check.ts apps/worker/src/jobs/reconciliation-discrepancy.ts
pnpm --filter @openwhispr/worker test -- reconciliation
pnpm lint:lockers
```

### Done
CR-06 RED+GREEN pair on `main`; `reconciliationDiscrepancySchema` carries an
additive optional `window_id`; the breach fan-out passes a deterministic
`jobId` so a retried fan-out collapses re-enqueues. (Worker-local schema — no
wire-package suite run; recorded in the SUMMARY.)

---

## Task 5 — CR-07: drainStaleVkrKeys iteration cap + failure metric

**Finding:** CR-07 (HIGH) — `index.ts:131-145` — the SCAN `do/while` loop has
no upper-bound cap; `:152-154` logs `warn` with no counter.

### RED step
- New test `apps/worker/tests/unit/index-drain-stale-vkr.test.ts`. Test name
  MUST contain `CR-07`. `drainStaleVkrKeys` is currently a module-internal
  function — the GREEN step must export it (a test seam) so the test can drive
  it directly with a stub Valkey client.
- **RED 1 — cap.** Stub the Valkey `scan` to ALWAYS return a non-zero cursor
  (a misbehaving Valkey). Assert `drainStaleVkrKeys` returns (does not hang)
  and that `scan` was called at most `MAX_ITERATIONS` times. Pre-fix the loop
  is unbounded → RED hangs / fails.
- **RED 2 — metric.** Stub `scan` to throw. Assert an OTel counter is
  incremented on the failure path (capture via an in-process OTel meter
  reader, the established worker pattern — see
  `reconciliation-daily-check.test.ts` gauge callbacks). Pre-fix no counter
  exists → RED fails.
- Commit: `test(66-01): red — CR-07 unbounded SCAN loop + no failure metric`.

### GREEN step
- `index.ts` — `export` `drainStaleVkrKeys` (test seam). Add a
  `const MAX_ITERATIONS = 1000;` cap: count iterations, break with a `warn`
  log if the cap is hit before `cursor === "0"`. Create an OTel counter (e.g.
  `worker_vkr_cleanup_failures_total` via `metrics.getMeter("worker")`) at
  module scope; increment it in the `catch` block alongside the existing
  `logger.warn`.
- Commit: `fix(66-01): green — CR-07 cap SCAN loop, emit cleanup-failure counter`.

### Verify
```
grep -n "MAX_ITERATIONS\|getMeter\|createCounter" apps/worker/src/index.ts
pnpm --filter @openwhispr/worker test -- index-drain-stale-vkr
pnpm lint:lockers
```

### Done
CR-07 RED+GREEN pair on `main`; the SCAN loop cannot lock boot; a cleanup
failure increments an OTel counter operators can alert on.

---

## Task 6 — CR-08: worker shutdown exit code on drain failure

**Finding:** CR-08 (HIGH) — `index.ts:266-277` — `process.exit(0)`
unconditional; `Promise.allSettled` never rejects so per-worker drain failures
are masked.

### RED step
- New test `apps/worker/tests/unit/index-shutdown.test.ts`. Test name MUST
  contain `CR-08`. The `shutdown` closure is currently internal to `main()` —
  the GREEN step extracts it into an exported, testable
  `buildShutdown(deps)` / `runShutdown(deps)` function taking the workers +
  pools + redis as injected deps, with `process.exit` injected (or a returned
  exit code) so the test asserts the code without killing the test process.
- Assert: with all drains succeeding, the resolved exit code is `0`; with one
  worker `.close()` rejecting (a `Promise.allSettled` result of status
  `"rejected"`), OR a subsequent `pool.end()` throwing, the resolved exit code
  is `1`. Pre-fix the code is always `0` → RED fails on the failure case.
- Commit: `test(66-01): red — CR-08 shutdown exits 0 on drain failure`.

### GREEN step
- `index.ts` — extract the shutdown body into a function that: inspects the
  `Promise.allSettled(workers.map(w => w.close()))` results array for any
  `status === "rejected"`; wraps each subsequent `await` (`ingestQueue.close`,
  `closeQueueRegistry`, the 3 `pool.end()`s, `redis.quit`) so a throw sets a
  `shutdownErrored` flag instead of being swallowed by one outer catch; then
  `process.exit(shutdownErrored ? 1 : 0)`. Keep the existing `log.error` on
  each failure. Preserve the `shuttingDown` re-entrancy guard.
- Commit: `fix(66-01): green — CR-08 exit(1) when shutdown drain fails`.

### Verify
```
grep -n "shutdownErrored\|process.exit" apps/worker/src/index.ts
pnpm --filter @openwhispr/worker test -- index-shutdown
pnpm lint:lockers
```

### Done
CR-08 RED+GREEN pair on `main`; a drain failure exits non-zero so k8s/compose
no longer records a masked graceful shutdown.

---

## Task 7 — CR-09: shared assertDirectPostgres helper

**Finding:** CR-09 (HIGH) — `index.ts:174-177` — the inline `maintenancePool`
has no PgBouncer guard; `makeAppOwnerPool` and `makeLitellmPool` each duplicate
the guard inline. One coherent task: extract a shared helper and wire all
three.

### RED step
- New test `apps/worker/tests/unit/db/assert-direct-postgres.test.ts`. Test
  name MUST contain `CR-09`.
- Pure-unit: import `assertDirectPostgres` (does not exist yet — compile-RED
  until GREEN). Assert it THROWS for a PgBouncer-hostname URL
  (`postgres://u@pgbouncer:6432/db`) and is a no-op for a direct URL
  (`postgres://u@postgres:5432/db`). Also assert (source-level) that
  `index.ts`'s `maintenancePool` construction now routes through the helper:
  `grep`-style assertion that `index.ts` calls `assertDirectPostgres` before
  `new Pool` for the maintenance pool.
- Commit: `test(66-01): red — CR-09 maintenancePool missing PgBouncer guard`.

### GREEN step
- New file `apps/worker/src/db/assert-direct-postgres.ts` — `export function
  assertDirectPostgres(url: string, envVarName: string): void` containing the
  `new URL(url).hostname` + `/pgbouncer/i.test(host)` logic currently
  duplicated in `app-pool.ts` and `litellm-pool.ts`; the thrown message uses
  `envVarName` for a clear operator error.
- `app-pool.ts:154-164` — replace the inline guard with
  `assertDirectPostgres(url, "DATABASE_URL_OWNER")`.
- `litellm-pool.ts:18-28` — replace the inline guard with
  `assertDirectPostgres(url, "LITELLM_READ_DATABASE_URL")`. Keep the existing
  thrown-message intent (Pitfall #9) — fold the Pitfall note into the helper
  or keep a comment at the call site.
- `index.ts:174-177` — before `new Pool(...)` for `maintenancePool`, read
  `DATABASE_URL_OWNER` into a local, call `assertDirectPostgres(url,
  "DATABASE_URL_OWNER")`, then construct the pool with that url.
- Commit: `fix(66-01): green — CR-09 extract assertDirectPostgres, guard all pools`.

### Verify
```
grep -rn "assertDirectPostgres\|pgbouncer" apps/worker/src/db apps/worker/src/index.ts
pnpm --filter @openwhispr/worker test -- assert-direct-postgres app-pool litellm-pool
pnpm lint:lockers
```

### Done
CR-09 RED+GREEN pair on `main`; one shared `assertDirectPostgres` helper
guards `makeAppOwnerPool`, `makeLitellmPool`, AND the inline `maintenancePool`
— no worker pg pool can silently point at PgBouncer transaction-mode.

---

## Task 8 — annotate the review artifacts (FINAL TASK)

After Tasks 1–7 are green/verified:

- `.planning/review/worker.md` — append a closure marker line under each of
  CR-03..CR-09: `**Status:** CLOSED 2026-05-21 — Phase 66, commit <green-sha>
  — <one-line fix summary>.` CR-03 also notes the boundary file +
  `EMAIL_FALLBACK_NONFATAL` flag + both allowlist entries removed. CR-06 notes
  the schema is worker-local (no wire change). CR-05 notes the chosen
  mitigation shape. WR-01..WR-08 (MEDIUM/LOW) remain open — out of scope.
- `.planning/review/REVIEW-INDEX.md` — update the `apps/worker` per-package
  roll-up row: `HIGH 7 → 0 (✅ Phase 66)` (mirror how Phase 62/64/65 closures
  are marked); note CR-01/02 already closed by Phase 58.
- Commit: `docs(66-01): annotate worker review with CR-03..CR-09 closure`.

### Done
Both review artifacts carry per-finding closure markers; `git log` shows the
annotation commit.

---

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| operator env (`NODE_ENV`/`EMAIL_FALLBACK_NONFATAL`) → email-delivery job | A misconfigured env silently turns an undelivered email into a green job (CR-03). |
| BullMQ job handler → Postgres transaction (`withTenantContext`) | A throwing ROLLBACK masks the real failure cause crossing back to BullMQ retry (CR-04). |
| partman-maintenance → BullMQ audit-archive queue | A partial enqueue failure crosses into permanent archive loss (CR-05). |
| reconciliation-daily-check → BullMQ discrepancy queue | A mid-loop throw + retry duplicates revenue-adjacent per-tenant jobs (CR-06). |
| boot path → Valkey SCAN | A misbehaving Valkey cursor crosses into an unbounded boot-lock loop (CR-07). |
| worker process → k8s/compose orchestrator (exit code) | A masked exit 0 crosses a false "graceful shutdown" signal during rolling deploys (CR-08). |
| operator-supplied `DATABASE_URL_OWNER` → maintenancePool | A PgBouncer-pointed URL crosses into partman state corruption via transaction-mode COMMITs (CR-09). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-66-01 | Repudiation / Tampering | email-delivery silent-green | mitigate | Task 1 fails the job unless `EMAIL_FALLBACK_NONFATAL` is explicitly set — staging no longer false-greens an unsent email; constitutional NODE_ENV read moved to a boundary file. |
| T-66-02 | Repudiation | withTenantContext ROLLBACK masking | mitigate | Task 2 wraps ROLLBACK so the true handler error always reaches BullMQ retry / DLQ — failure cause is no longer misattributed. |
| T-66-03 | Denial of Service (data loss) | partman audit-archive enqueue loop | mitigate | Task 3 collects enqueue failures and re-throws so the whole detached list retries atomically — no partition is left detached-but-unarchived. |
| T-66-04 | Tampering (duplicate jobs) | reconciliation discrepancy fan-out | mitigate | Task 4 passes a deterministic `window_id` jobId so a retried fan-out collapses re-enqueues instead of piling duplicate per-tenant jobs. |
| T-66-05 | Denial of Service | boot-time drainStaleVkrKeys SCAN loop | mitigate | Task 5 caps the loop at `MAX_ITERATIONS` so a misbehaving Valkey cursor cannot lock worker boot; emits a failure counter. |
| T-66-06 | Repudiation | worker shutdown exit code | mitigate | Task 6 exits non-zero on drain failure so the orchestrator sees the real shutdown state during rolling deploys. |
| T-66-07 | Tampering (state corruption) | maintenancePool PgBouncer guard | mitigate | Task 7 routes all three pools through `assertDirectPostgres` — a PgBouncer-pointed maintenance URL fails fast instead of corrupting partman state. |
</threat_model>

<verification>
Phase-level gate (run after all tasks):

```
pnpm --filter @openwhispr/worker test
pnpm lint:lockers          # 8 lockers green — LOCKER-01 with the email-delivery.ts
                           # allowlist entries (lines 30-31) REMOVED, not re-added
pnpm typecheck             # no NEW errors vs the documented 5-error baseline
git log --oneline -20      # verify-first log + RED/GREEN pairs CR-03..CR-09
                           # + the doc annotation commit
```

Spot-check (CLAUDE.md hard rule 3 — verify, do not relay):
- `grep -rn "CR-03\|CR-04\|CR-05\|CR-06\|CR-07\|CR-08\|CR-09" apps/worker --include="*.test.ts"`
  — every fixed finding has a test referencing its ID.
- `grep -n "NODE_ENV" apps/worker/src/jobs/email-delivery.ts` — absent.
- `grep -c "email-delivery.ts" tools/lint-no-env-branches.allowlist.txt` — `0`.
- `grep -n "EMAIL_FALLBACK_NONFATAL" apps/worker/src/config/worker-config.ts` — present.
- `grep -n "rbErr" apps/worker/src/lib/with-tenant-context.ts` — ROLLBACK wrapped.
- `grep -n "failures" apps/worker/src/jobs/partman-maintenance.ts` — collect-and-rethrow.
- `grep -n "window_id\|jobId" apps/worker/src/jobs/reconciliation-daily-check.ts` — present.
- `grep -n "MAX_ITERATIONS" apps/worker/src/index.ts` — present.
- `grep -n "shutdownErrored" apps/worker/src/index.ts` — present.
- `grep -rn "assertDirectPostgres" apps/worker/src` — helper used by all 3 pools.
- Each cited commit SHA is on HEAD; `git status --short` clean.
- `verify-first.log` exists, committed, records a disposition for CR-03..CR-09.
- `.planning/review/worker.md` + `REVIEW-INDEX.md` carry the closure markers.
</verification>

<success_criteria>
- CR-03..CR-09: each a RED+GREEN pair on `main` with the test referencing its
  ID, OR a documented already-closed disposition in `verify-first.log`.
- CR-03: `email-delivery.ts` has zero `process.env` reads; the env contract
  lives in `config/worker-config.ts`; the `smtp-not-configured` path throws
  unless `EMAIL_FALLBACK_NONFATAL` is set; both LOCKER-01 allowlist entries
  removed; `pnpm lint:lockers` green (8) with them gone.
- CR-06: `reconciliationDiscrepancySchema` confirmed worker-local; the
  `window_id` field added additively/optionally; no wire-package suite run.
- `pnpm --filter @openwhispr/worker test` green; `pnpm lint:lockers` green (8);
  `pnpm typecheck` no new errors vs the 5-error baseline.
- `.planning/review/worker.md` + `REVIEW-INDEX.md` annotated.
- No skipped tests, no `.only`, no `@ts-expect-error` without `issue-NNNN:`.
- No `as any` / `as unknown as` / `@ts-ignore` introduced; no production code
  edited solely to green a test (CLAUDE.md hard rule 1).
- No gitleaks hook bypass (CLAUDE.md hard rule 4).
- WR-01..WR-08 untouched (out of scope).
</success_criteria>

<risk_register>
| Risk | Task | Mitigation |
|------|------|------------|
| CR-03: removing the LOCKER-01 entries before the env read is gone fails `lint:lockers`. | 1 | Delete the allowlist lines in the SAME commit as the `email-delivery.ts` env-read removal; run `pnpm lint:lockers` in the verify step before committing. |
| CR-03: a boot path or test still passes `nodeEnv` to `EmailDeliveryDeps`. | 1 | `grep -rn "nodeEnv" apps/worker` after the rename; update every call site (only `index.ts` wires it in production; tests are updated in the RED). |
| CR-06: `TypedQueue.add` does not forward a `JobsOptions` arg. | 4 | The verify-first step greps `typed-queue.ts`; if `add` drops opts, the GREEN widens it additively (optional 3rd param forwarded to BullMQ `queue.add`) — a superset, no caller breaks. |
| CR-06 mistaken as a wire change. | 4 | Confirmed worker-local: `reconciliationDiscrepancySchema` is defined in `apps/worker/src/jobs/reconciliation-discrepancy.ts`, not `@openwhispr/wire-schemas`. No external suite. |
| CR-07/CR-08: `drainStaleVkrKeys` / `shutdown` are module-internal — untestable. | 5,6 | The GREEN steps export `drainStaleVkrKeys` and extract an exported `runShutdown(deps)` with injected `process.exit` — a legitimate test seam, not a test-only hack (the extraction also improves the code). |
| CR-08: a real `process.exit` in a unit test kills the runner. | 6 | `process.exit` is injected (or `runShutdown` returns the exit code); the test asserts the code without invoking the real exit. |
| typecheck regression from new files / renamed deps field. | 1,4,7 | `worker-config.ts`, `assert-direct-postgres.ts`, the `allowSmtpFallback` rename, the `window_id` field are ordinary typed surfaces; run `pnpm typecheck` after each task — must stay at the 5-error baseline. |
| A failing test tempts a production hack. | all | CLAUDE.md hard rule 1: the production change here IS the genuine fix. If a HALT arises, log in `.planning/deferred-items.md` with WHY evidence and report in the SUMMARY. |
</risk_register>

<output>
After completion, create
`.planning/phases/66-high-findings-worker/66-01-SUMMARY.md`.

In the SUMMARY, explicitly record per finding:
- CR-03: the verify-first determination; the boundary file created
  (`config/worker-config.ts`), the `EMAIL_FALLBACK_NONFATAL` flag wired, the
  two LOCKER-01 allowlist lines removed; the RED/GREEN SHAs.
- CR-04: the RED/GREEN SHAs; confirmation `handlerErr` always wins.
- CR-05: the chosen mitigation shape (re-throw-after-loop vs allSettled) +
  rationale; the RED/GREEN SHAs.
- CR-06: confirmation the schema is worker-local; the `window_id` field shape;
  whether `TypedQueue.add` needed widening; the RED/GREEN SHAs.
- CR-07: confirmation of the `MAX_ITERATIONS` cap + the counter name; the SHAs.
- CR-08: the exit-code behavior + the `runShutdown` extraction; the SHAs.
- CR-09: confirmation `assertDirectPostgres` guards all three pools; the SHAs.
- LOCKER outcome — all 8 lockers green; LOCKER-01 allowlist shrank by 2 lines.
- `pnpm typecheck` result vs the 5-error baseline.
- The final per-finding closure markers written to `worker.md` + `REVIEW-INDEX.md`.
- Any divergence from the planner's pre-determination.
</output>
