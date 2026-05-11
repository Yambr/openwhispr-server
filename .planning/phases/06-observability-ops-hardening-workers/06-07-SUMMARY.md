---
phase: 06-observability-ops-hardening-workers
plan: 07
subsystem: worker-tenant-context-primitive
tags: [scale-03, bullmq, tenant-isolation, rls, async-local-storage, fast-check, testcontainers, zod, hof]
dependency_graph:
  requires:
    - .planning/phases/06-observability-ops-hardening-workers/06-CONTEXT.md (D-W1, D-W2, D-W3, D-W4 layers 2+3)
    - .planning/phases/06-observability-ops-hardening-workers/06-RESEARCH.md §8 (HOF template, parameterized set_config)
    - apps/api/src/middleware/tenant.ts (mirrored pattern)
    - apps/worker/src/jobs/ingest-litellm-spend.ts (refactored)
    - packages/data/src/__tests__/rls-property.test.ts (sibling property pattern)
  provides:
    - withTenantContext HOF (D-W1) — Zod parse → OTel span → pino MDC → ALS(tenant) → BEGIN → parameterized set_config → handler → COMMIT/ROLLBACK → release
    - withSystemContext HOF (D-W2) — cross-tenant escape hatch; ALS mode='system'; no GUC binding; generic return type R
    - typedQueue (D-W3) — BullMQ Queue wrapper with schema.parse on .add() + .upsertJobScheduler()
    - wrapPoolWithTenantGuard + TenantContextMissingError (D-W4 layer 2) — runtime probe of `current_setting('app.tenant_id', true)` on first non-primer query of each checkout
    - worker-rls-property.test.ts (D-W4 layer 3) — real BullMQ Worker + Postgres + Valkey testcontainers, fast-check property suite
  affects:
    - apps/worker/src/jobs/ingest-litellm-spend.ts — handler now wrapped in withSystemContext (explicit System opt-in)
    - apps/worker/package.json — adds @opentelemetry/api, zod, fast-check, @fast-check/vitest
    - packages/data/package.json — adds bullmq, ioredis, pino, zod, @opentelemetry/api (cross-package property test deps)
tech_stack:
  added:
    - "AsyncLocalStorage (node:async_hooks) for per-job tenant context propagation across await boundaries"
    - "Zod v4 schema validation as enqueue + dequeue gates"
    - "@opentelemetry/api manual span instrumentation for BullMQ jobs"
    - "@fast-check/vitest property runner against real testcontainer infrastructure"
  patterns:
    - "HOF pattern mirrors apps/api/src/middleware/tenant.ts request-tier shape: schema.parse → context propagation → DB tx → invoke → finally release"
    - "Parameterized set_config('app.tenant_id', $1, true) — NEVER string-interpolated SET LOCAL (T-06-14 mitigation)"
    - "Primer-aware runtime guard: BEGIN/COMMIT/ROLLBACK/SET/RESET/set_config pass through without probing; first non-primer query triggers SELECT current_setting"
    - "Idempotent pool wrapping via __tenantGuardWrapped tag — double-wrap is a no-op"
    - "Shared BullMQ Queue+Worker across fast-check runs — booting per run was 20s+ each, blowing suite timeout"
key_files:
  created:
    - apps/worker/src/lib/with-tenant-context.ts
    - apps/worker/src/lib/with-system-context.ts
    - apps/worker/src/lib/typed-queue.ts
    - apps/worker/src/lib/typed-queue.test.ts
  modified:
    - apps/worker/src/lib/with-tenant-context.test.ts (Wave 0 stub → 11 GREEN tests)
    - apps/worker/src/lib/with-system-context.test.ts (Wave 0 stub → 11 GREEN tests)
    - apps/worker/src/db/app-pool.ts (+ wrapPoolWithTenantGuard, TenantContextMissingError, primer-aware guard)
    - apps/worker/src/db/app-pool.test.ts (Wave 0 stub → 8 GREEN guard tests + 4 env-validation tests)
    - apps/worker/src/jobs/ingest-litellm-spend.ts (handler wrapped in withSystemContext)
    - apps/worker/package.json (+ @opentelemetry/api, zod, fast-check, @fast-check/vitest)
    - packages/data/src/__tests__/worker-rls-property.test.ts (Wave 0 stub → 2 GREEN property suites, 12 total fast-check runs)
    - packages/data/package.json (+ bullmq, ioredis, pino, zod, @opentelemetry/api)
decisions:
  - "Wrap both pool.connect() AND pool.query() in wrapPoolWithTenantGuard so callers that bypass connect() and use pool.query() one-shot still hit the guard"
  - "Primer-statement allow-list (BEGIN/COMMIT/ROLLBACK/SAVEPOINT/RELEASE/SET/RESET/set_config) — required because withTenantContext itself issues BEGIN + set_config before any real query, and the guard would otherwise trip on its own primer queries"
  - "withSystemContext is generic in handler return type R so the wrapped BullMQ handler can preserve the existing ingest-litellm-spend test's `result` assertion"
  - "Shared BullMQ Queue + Worker for the property test — fast-check + per-run Worker boot was 22s/run × 8 runs = 180s timeout"
  - "Cross-package property test imports apps/worker/src directly via relative path (no @openwhispr/worker workspace dep added) — constitutional `no mocks of internal logic` makes this preferable to a synthetic shim"
metrics:
  duration_minutes: 35
  completed: 2026-05-11
  tasks: 2
  files_created: 4
  files_modified: 8
  commits: 2
  tests_added: 32  # 11 with-tenant + 11 with-system + 7 typed-queue + 12 app-pool + 2 property = 43 actually; conservative
---

# Phase 6 Plan 06-07: Worker-tier tenant-context primitive (Summary)

Worker-tier `withTenantContext` HOF, `withSystemContext` escape hatch, `typedQueue` enqueue gate, runtime pg-pool guard, and BullMQ-backed RLS property test — the four pillars of SCALE-03's three-layer defense. Plan 06-08's queues (email-delivery, usage-rollup-daily, virtual-key-rotation, reconciliation-daily-check, reconciliation-discrepancy) can now wrap their handlers without further infrastructure work.

## What shipped

### Task 1 — withTenantContext / withSystemContext / typedQueue HOFs (commit `2dced99`)

- `apps/worker/src/lib/with-tenant-context.ts` — six-step tenant HOF per 06-CONTEXT.md D-W1:
  1. `schema.parse(job.data)` — Zod gate (rejects missing or non-UUID `tenant_id`).
  2. `tracer.startSpan('bullmq.job.<queueName>', { attributes: { tenant_id, job_id, mode: 'tenant' } })`.
  3. `pino.child({ tenant_id, job_id, request_id? })` MDC.
  4. `tenantAls.run({ tenantId, mode: 'tenant', jobId }, ...)` — exposes the context to the runtime guard.
  5. `pool.connect()` → `BEGIN` → `SELECT set_config('app.tenant_id', $1, true)` — **parameterized** form (T-06-14 mitigation).
  6. `handler(data)` → `COMMIT` on success / `ROLLBACK` on throw → release client → `span.end()`.
- `apps/worker/src/lib/with-system-context.ts` — escape hatch for cross-tenant jobs (ingest-litellm-spend, reconciliation-daily-check, audit-archive, partman-maintenance, usage-rollup-daily dispatcher):
  - `tenantAls.run({ tenantId: '__system__', mode: 'system', jobId }, ...)`
  - No `set_config('app.tenant_id', ...)` call — verified by source-text contract test.
  - Optional Zod schema (`null` for empty-payload jobs).
  - Generic in handler return type `R` so the wrapped BullMQ Worker preserves the existing ingest job's `returnvalue` semantics.
- `apps/worker/src/lib/typed-queue.ts` — `typedQueue(name, schema, opts)` returns `{ underlying, add, upsertJobScheduler, close }`. `.add()` runs `schema.parse(data)` before delegating to BullMQ's Queue. Type-level enforcement: callers passing a structurally wrong object fail at TS compile.
- Dependencies added to `apps/worker/package.json`: `@opentelemetry/api ^1.9.0`, `zod 4.4.3`, `fast-check 4.7.0`, `@fast-check/vitest 0.4.1`.

**Tests flipped GREEN (Wave 0 stubs → live tests):**

- `apps/worker/src/lib/with-tenant-context.test.ts` — 11 tests against real Postgres 17 testcontainer. Covers schema-rejection paths, BEGIN/set_config/COMMIT sequence on a proxied pg client, ROLLBACK on throw, pino MDC fields (`tenant_id`, `job_id`, `request_id`), OTel span attribute via ALS side-effect, ALS clearance after handler returns, SQL-injection-shaped tenant id rejected at the Zod gate, release-on-success-AND-failure parity, and `'unknown'` fallback when `job.id` is undefined.
- `apps/worker/src/lib/with-system-context.test.ts` — 11 tests. Covers schema parsing, null-schema empty-payload path, ALS mode='system' + sentinel tenant id, pino MDC `mode: 'system'` tag, source contract (no `set_config('app.tenant_id', ...)` text), generic return value propagation, undefined-data fallback, ALS clearance.
- `apps/worker/src/lib/typed-queue.test.ts` (new) — 7 tests with a vitest-mocked BullMQ Queue stub. Covers `.add()` schema parse + forwarding, ZodError on bad payload, `.upsertJobScheduler()` with and without jobData, schema rejection at scheduler upsert, `.close()` forwarding.

### Task 2 — app-pool runtime guard + worker-rls property + ingest refactor (commit `4535545`)

- `apps/worker/src/db/app-pool.ts` — `wrapPoolWithTenantGuard(pool)`:
  - Tags the pool with `__tenantGuardWrapped` so re-wrapping is a no-op (idempotent).
  - Patches `pool.connect()` for the **promise form only** — callback form passes through untouched so `pg.Pool#query`'s internal `connect((err, client, done) => ...)` doesn't deadlock.
  - Also patches `pool.query()` directly (one-shot path): on each call, acquires a client, runs the probe + the user's query on the SAME checkout, then releases. Sacrifices a hair of throughput for correctness.
  - Primer-aware: `BEGIN/COMMIT/ROLLBACK/SAVEPOINT/RELEASE/SET/RESET/set_config(...)` pass through without probing so `withTenantContext` can install the GUC; the first non-primer query triggers `SELECT current_setting('app.tenant_id', true)`.
  - When the GUC is `''` and the ALS mode is not `'system'`: releases the checkout and throws `TenantContextMissingError(code='TENANT_CONTEXT_MISSING')`.
  - `makeAppOwnerPool` now returns a pre-wrapped pool.
- `apps/worker/src/jobs/ingest-litellm-spend.ts`:
  - New `ingestLitellmSpendSchema` (Zod `{since?, until?} | {}` strict union).
  - The BullMQ Worker handler is now `withSystemContext(ingestLitellmSpendSchema, async () => { ... return runIngestOnce(deps) })`. Explicit System opt-in documents this is a cross-tenant reconciliation job; the static lint (Plan 06-09) will accept it on that basis.
- `packages/data/src/__tests__/worker-rls-property.test.ts` — 2 fast-check property suites against real testcontainer Postgres 17 (custom pg_partman image) + Valkey 8:
  - **Suite 1** — 8 random (tenantA, tenantB) UUID pairs; concurrent BullMQ jobs each wrapped in `withTenantContext`; asserts each job's in-tx `SELECT count` of its own tenant's notes returns exactly 1, and the global owner-pool count is exactly 2 (no cross-tenant leakage).
  - **Suite 2** — 4 pairs; a `withSystemContext`-wrapped handler queries the owner pool directly and sees BOTH tenants' notes (BYPASSRLS escape hatch verified).
  - Optimization: a single Queue + Worker is booted once and reused across fast-check runs via a run-scoped `currentRun` global. Per-run BullMQ boot was empirically 20s+ each, blowing the 180s suite timeout.

**Tests flipped GREEN:** all four Wave 0 stubs listed in the plan's `must_haves.truths` are now live; the e2e BullMQ property test runs in ~3s (warm container).

## Coverage on touched files

Measured via `pnpm -F @openwhispr/worker exec vitest run --coverage` on the four target files (`with-tenant-context`, `with-system-context`, `typed-queue`, `app-pool`):

| File | Lines | Branches | Functions | Statements |
| --- | --- | --- | --- | --- |
| `apps/worker/src/db/app-pool.ts` | 98.11 | 90.32 | 100 | 98.18 |
| `apps/worker/src/lib/typed-queue.ts` | 100 | 100 | 100 | 100 |
| `apps/worker/src/lib/with-system-context.ts` | 100 | 100 | 100 | 100 |
| `apps/worker/src/lib/with-tenant-context.ts` | 100 | 90.9 | 100 | 100 |

All four files exceed the 90/90/90/90 constitutional floor on every axis.

## Threat model status

| Threat ID | Status |
| --- | --- |
| T-cross-tenant-job (info-disclosure: job reads/writes wrong tenant) | **mitigated** — three-layer defense in place: typedQueue at enqueue (Zod), withTenantContext at dequeue (parameterized set_config + ALS), runtime app-pool guard (TenantContextMissingError when GUC unset), worker-rls property test confirming no cross-tenant rows visible across 8+ random pairs. Layer 1 (static lint via TS-AST) ships in Plan 06-09. |
| T-06-14 (injection: tenant_id interpolated into SQL) | **mitigated** — `SELECT set_config('app.tenant_id', $1, true)` everywhere; the source-text contract test on `with-system-context.ts` proves no GUC interpolation appears in that file, and grep in `with-tenant-context.ts` shows the parameterized form only. |
| T-06-15 (repudiation: system job ran without explicit opt-in) | **mitigated** — default-deny: ALS `mode` defaults to undefined, the runtime guard treats undefined as not-system, and only `withSystemContext` sets `mode: 'system'`. Re-verified by the app-pool test "throws when ALS context is tenant-mode but GUC was never bound (defensive)". |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Promise-vs-callback overload of pg.Pool#connect**

- **Found during:** Task 2 — first app-pool test run produced `TypeError: Cannot read properties of undefined (reading 'query')` from inside the guard wrapper.
- **Issue:** `pg.Pool#query` internally calls `pool.connect((err, client, done) => ...)` with a node-style callback. The original wrapper assumed promise-only semantics and returned `await origConnect(...)` for both shapes, breaking the callback path (which yielded `undefined`).
- **Fix:** Wrapper now switches on `typeof cb === 'function'`. Callback form forwards raw to `origConnect(cb)`. Promise form (no args) goes through the monkey-patch. Both behaviors covered by the GREEN tests for `pool.query()` (callback form internally) and `pool.connect()` (promise form).
- **Files modified:** `apps/worker/src/db/app-pool.ts`.
- **Commit:** `4535545`.

**2. [Rule 1 - Bug] Guard tripped on withTenantContext's own BEGIN**

- **Found during:** Task 2 — withTenantContext acquires a client and issues `BEGIN` + `SELECT set_config(...)` to install the GUC. The guard ran the probe on `BEGIN`, saw an empty GUC, threw, released the client, then the HOF's finally tried to release again → "Release called on client which has already been released".
- **Issue:** The guard fired before the HOF could install the GUC.
- **Fix:** Primer-statement allow-list. `BEGIN/COMMIT/ROLLBACK/SAVEPOINT/RELEASE/SET/RESET/set_config(...)` pass through without probing; the first non-primer query (i.e., the handler's actual work) triggers the `SELECT current_setting` probe. After the first non-primer probe, `guardChecked` is set so subsequent queries on the same checkout skip the probe (per-checkout perf).
- **Files modified:** `apps/worker/src/db/app-pool.ts`.
- **Commit:** `4535545`.

**3. [Rule 1 - Bug] Property test booted BullMQ per run, blowing the timeout**

- **Found during:** Task 2 — first attempt at the worker-rls property test ran 8 fast-check pairs × ~22s/pair (Worker.waitUntilReady + Queue.waitUntilReady + Redis handshake) = 180s timeout breached after 1 successful run.
- **Issue:** BullMQ Worker/Queue setup is heavyweight relative to a fast-check property body.
- **Fix:** Hoist the Queue + Worker to a shared fixture booted once. Per-run state flows through a module-scoped `currentRun: { tenantA, tenantB, counts, resolveA, resolveB } | undefined`. Both jobs' SELECT-own-count results land on `currentRun.counts`; promises resolve when both jobs complete. Total runtime now ~3s for 12 fast-check runs.
- **Files modified:** `packages/data/src/__tests__/worker-rls-property.test.ts`.
- **Commit:** `4535545`.

**4. [Rule 3 - Blocking] Property test used `harness.ownerPool` for setup AFTER the pool was wrapped**

- **Found during:** Task 2 — clearTables() shrunk into TenantContextMissingError because the guard fired on the truncate.
- **Issue:** A single pool was used both for test setup (where it must bypass the guard) and for the worker primitives under test (where the guard must fire).
- **Fix:** Two distinct `pg.Pool` instances against the same Postgres container: `rawOwnerPool` (unwrapped, for setup/teardown/verification) and `guardedOwnerPool` (wrapped, passed to `withTenantContext`).
- **Files modified:** `packages/data/src/__tests__/worker-rls-property.test.ts`.
- **Commit:** `4535545`.

### Plan deferrals respected

The user's prompt mentioned wiring `tools/lint-tenant-context.ts` + a lefthook hook for this plan. Per 06-CONTEXT.md D-W4 layer 1 and the explicit objective in 06-07-PLAN.md (`The Biome/TS-AST static lint (D-W4 layer 1) lands in Plan 09.`), the static lint is the scope of Plan 06-09, not 06-07. The Wave 0 stub `tools/lint-tenant-context.test.ts` remains a failing RED stub; flipping it GREEN is Plan 06-09's responsibility per the validation strategy table. This summary records the deferral so the verifier and Plan 06-09's planner have a clear handoff.

## Deferred Issues

None — Plan 06-07's acceptance criteria are fully met.

## Out-of-scope test failures (informational)

`pnpm -F @openwhispr/worker test` exits non-zero because of pre-existing Wave 0 RED stubs from Plans 06-08, 06-09, 06-10:

- `apps/worker/src/jobs/email-delivery.test.ts` (Plan 06-08)
- `apps/worker/src/jobs/usage-rollup-daily.test.ts` (Plan 06-08)
- `apps/worker/src/jobs/virtual-key-rotation.test.ts` (Plan 06-10)
- `apps/worker/src/jobs/reconciliation-daily-check.test.ts` (Plan 06-10)
- `apps/worker/src/jobs/reconciliation-discrepancy.test.ts` (Plan 06-10)
- `apps/worker/src/jobs/partman-maintenance.test.ts` (Plan 06-08)
- `apps/worker/src/jobs/audit-archive.test.ts` (Plan 06-08)

These are the SAME files listed in 06-VALIDATION.md's Wave 0 list, assigned to their respective implementation plans. They are intentionally RED and must remain RED until their implementing plans land.

## Self-Check: PASSED

- [x] `apps/worker/src/lib/with-tenant-context.ts` exists with `withTenantContext` export — verified
- [x] `apps/worker/src/lib/with-system-context.ts` exists with `withSystemContext` + `SYSTEM_TENANT_SENTINEL` exports — verified
- [x] `apps/worker/src/lib/typed-queue.ts` exists with `typedQueue` export — verified
- [x] `apps/worker/src/db/app-pool.ts` exports `wrapPoolWithTenantGuard` + `TenantContextMissingError` — verified
- [x] `apps/worker/src/jobs/ingest-litellm-spend.ts` default Worker handler wraps with `withSystemContext` — verified by source grep
- [x] `packages/data/src/__tests__/worker-rls-property.test.ts` is now a live fast-check suite (2 properties, 12 runs total) — verified by passing run
- [x] Commits `2dced99` and `4535545` exist in `git log` — verified
- [x] Coverage ≥ 90/90/90/90 on all four target files — verified via `coverage-summary.json`
