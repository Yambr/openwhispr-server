# Review: worker
Branch: main @ 13f0864
Files reviewed: 19 source files (`apps/worker/src/**/*.ts`)

## Summary
- CRITICAL: 3 / HIGH: 5 / MEDIUM: 4 / LOW: 3
- Top 3 production risks:
  1. **`usage-rollup-daily-tenant` will throw `TenantContextMissingError` on every invocation.** The handler runs inside `withTenantContext()` (which BEGINs a tx on client A and binds `app.tenant_id` LOCAL) but then issues the actual `UPSERT` via `deps.pool.query(...)` — that path acquires a *different* client B from the same pool. Client B has no GUC; the app-pool runtime guard (D-W4 layer 2) detects `mode === 'tenant'` via ALS, probes `app.tenant_id`, finds it empty, and raises. The rollup ledger is silently never written. Either every `usage_rollup_daily` row is missing in prod, or the guard is being bypassed by an integration-test seam I haven't found — both options are CRITICAL.
  2. **Scheduler bakes `date` / `window_start` / `window_end` at install time** and freezes them forever. `installSchedulers()` computes `utcDateString(now)` once and passes it as the verbatim `jobData` to `upsertJobScheduler`. BullMQ schedulers re-fire the same payload — there is no per-fire callback to recompute "today". Every daily rollup and every daily reconciliation tick runs against the install-boot day. This is a silent data-correctness regression that grows by 24h per day the worker stays up.
  3. **No DLQ. No fixed-delay-with-jitter on retry.** `DEFAULT_JOB_OPTS = { attempts:5, backoff:{ type:"exponential", delay:1_000 }, removeOnFail:{ age: 7d } }`. Failed jobs are silently deleted after 7d with no audited record and no alert hook — violates the checklist's "DLQ or audited table" rule for side-effecting jobs (`email-delivery`, `audit-archive`, `reconciliation-discrepancy`). BullMQ exponential backoff is deterministic (`delay * 2^attempt`) with no jitter — thundering herd on transient LiteLLM/SMTP outage.

## Findings

### [CRITICAL] usage-rollup-daily-tenant runs UPSERT on a separate connection from the GUC-bound transaction
**File:** `apps/worker/src/jobs/usage-rollup-daily.ts:97-118`

`buildUsageRollupTenantHandler` wraps with `withTenantContext(schema, deps.pool, async (data) => { await deps.pool.query(...) })`. The HOF acquires client A, runs `BEGIN; SELECT set_config('app.tenant_id', $1, true)`, then invokes the inner handler. The inner handler calls `deps.pool.query(...)` — which, via `wrapPoolWithTenantGuard`'s `pool.query` patch (`app-pool.ts:121`), acquires a brand-new client B, probes `SELECT current_setting('app.tenant_id', true)` on B (returns empty — `set_config(..., true)` is LOCAL to A's tx), checks ALS `mode === 'tenant'`, and throws `TenantContextMissingError`.

Result: the rollup job has been dead-on-arrival since the runtime guard landed. The intended call shape is to acquire the **same client** the HOF bound the GUC on — the HOF would need to expose the client into the handler, or the handler should run a single statement via `client.query` provided by the HOF.

**Fix sketch:** either (a) refactor `withTenantContext` to pass the bound `client` into the handler, or (b) run the UPSERT with explicit `set_config` inside the handler using a single transaction owned here (drop the HOF wrapping), or (c) widen the guard so a same-pool ALS-tenant probe inherits the binding.

---

### [CRITICAL] Cron schedulers bake a stale `date` / `window_start` / `window_end` at install time
**File:** `apps/worker/src/scheduler.ts:53-77`

`installSchedulers` calls `utcDateString(now)` *once* and ships it as the `jobData.data.date`. Subsequent cron fires reuse the same data verbatim — BullMQ scheduler does not re-evaluate the payload per fire. Same for `windowStart` / `windowEnd` (lines 65-66) on the reconciliation cron.

Symptom: every daily rollup tick runs against the install-boot day; reconciliation runs against the install-boot 24h window. After N days uptime, both jobs are N days behind.

**Fix:** drop the static `data` field from `upsertJobScheduler` and recompute the date inside each handler (read `Date.now()` at `buildUsageRollupDispatcher` entry). The dispatcher schema then becomes `z.object({ date: isoDate.optional() })` with a `date ?? utcDateString(new Date())` fallback.

---

### [CRITICAL] No DLQ + side-effecting jobs silently drop on attempt exhaustion
**File:** `apps/worker/src/queues.ts:44-49`

`DEFAULT_JOB_OPTS` sets `removeOnFail: { age: 7 * 24 * 3600 }`. After 5 attempts the job lands in BullMQ's `failed` set and disappears after 7 days. Affected side-effecting jobs:

- `email-delivery` — verification / password-reset email never sent; user is locked out; no audit record.
- `audit-archive` — partition export failed; partition is left detached on disk forever; no operator notification.
- `reconciliation-discrepancy` — drift backfill silently abandoned.

**Fix:** wire a `failed` event listener per Worker that INSERTs into a `worker_dead_letter` table (tenant_id, queue, jobId, name, data_redacted, failedReason, finishedOn) before `removeOnFail` collects it. Re-classify each handler's exhaustion as a paging event.

---

### [HIGH] BullMQ retry backoff has no jitter
**File:** `apps/worker/src/queues.ts:46`

`backoff: { type: "exponential", delay: 1_000 }`. BullMQ's `exponential` strategy is `delay * 2^(attempt-1)`, deterministic. When LiteLLM / SMTP / S3 returns 5xx, all jobs queued at the same moment retry at the same instant — thundering herd against the recovering upstream. Per checklist 7.retry: outbound HTTP retries MUST use exponential **with jitter**.

**Fix:** define a custom backoff strategy via `Worker` constructor option `settings.backoffStrategy` that returns `(2^attempts) * 1000 + Math.floor(Math.random() * 1000)`, and reference it via `backoff: { type: "custom-jittered", delay: 1000 }`.

---

### [HIGH] Pino redact misses nested HTTP error fields commonly carrying Authorization / API keys
**Files:**
- `apps/worker/src/lib/with-tenant-context.ts:145` — `childLog.error({ err }, "tenant job failed")`
- `apps/worker/src/lib/with-system-context.ts:87` — `childLog.error({ err }, "system job failed")`
- `apps/worker/src/index.ts:275,294`

`makePino`'s redact paths are top-level (`authorization`, `token`, …) and one-level wildcards (`*.token`). Nothing covers `err.response.config.headers.Authorization`, `err.request.headers.authorization`, `err.config.headers["x-api-key"]`, or BullMQ's `err.cause.response.headers.cookie`. Upstream LiteLLM / SMTP 401s commonly throw axios/undici errors with the full request echoed back — including the `Authorization: Bearer sk-...` header.

**Fix:** add deep paths to `packages/observability/src/redact.ts`:
```
err.config.headers.authorization
err.config.headers["x-api-key"]
err.response.config.headers.authorization
err.response.config.headers["x-api-key"]
err.request.headers.authorization
err.request.headers.cookie
*.config.headers.authorization
*.request.headers.authorization
```
Or, preferably, install a pino `serializers.err` that walks the error graph and scrubs anything matching the credential-shape regex before serialization. Add a `tests/integration/log-scrub-sentinel.test.ts` row that throws a synthetic axios-shaped error.

---

### [HIGH] `reconciliation-discrepancy` runs cross-pool work inside `withTenantContext`'s transaction — partial-write risk on retry
**File:** `apps/worker/src/jobs/reconciliation-discrepancy.ts:62-83`

`withTenantContext` opens BEGIN on client A of `deps.pool` (owner pool) and binds GUC. The inner handler calls `runIngestOnce(deps.ingestDeps, {...})`. `runIngestOnce` writes to `deps.ingestDeps.appOwnerPool` — which is the *same* pool, but `pool.query` checks out a **different** client B. Writes on B autocommit; rollback on A only rolls back the (empty) outer transaction. On a mid-batch crash the inserted-so-far `usage_ledger` rows survive; retry repeats them but `ON CONFLICT (request_id) DO NOTHING` makes it idempotent. Idempotency saves this from being CRITICAL but the structural model is wrong — and any future write path on the inner handler (audit, notification) that lacks idempotency keys will leak duplicates.

Also: same `TenantContextMissingError` risk as F-1 (usage-rollup-tenant) for any future query made via `deps.pool.query` here — the guard will raise.

**Fix:** treat the discrepancy handler as system-mode (it's coordinating a cross-pool backfill on the owner pool); drop the `withTenantContext` wrapping and rely on `runIngestOnce`'s windowed-tenantId filter for tenant scoping.

---

### [HIGH] Email HTML templates interpolate variables with NO escaping
**File:** `apps/worker/src/i18n/template-renderer.ts:128-133, 156-160`

`interpolate(template, variables)` substitutes `{varname}` with `String(value)` raw, then assigns the result to `rendered.html`. Today the variables are `expires_minutes`, reset-link tokens, OTP codes — all controlled. But the call site `email-delivery.ts:97` accepts `data.variables: z.record(z.string(), z.unknown())` — any future enqueue site can pass a user-controlled `name` or `org_name` and it ships into an HTML `<body>` unescaped. Email clients render HTML; this is a stored-XSS-in-email primitive waiting for a careless caller.

**Fix:** HTML-escape every variable value before substitution into `.html` (not `.text` / `.subject`). A 4-character replacer (`&<>"`) is sufficient. Add a unit test asserting `<script>` becomes `&lt;script&gt;` in the rendered HTML.

---

### [HIGH] Audit-archive `psql -c` SQL builds `aws_s3` query string with non-validated `bucket`
**File:** `apps/worker/src/jobs/audit-archive.ts:182-191`

```
`SELECT aws_s3.query_export_to_s3('SELECT * FROM public.${partition}', '${bucket}', 'audit-archive/${partition}.csv', 'us-east-1')`
```

`partition` is regex-validated. `bucket` comes from `env("AUDIT_ARCHIVE_BUCKET") ?? "openwhispr"` and is interpolated **without escaping** into the single-quoted SQL string. An operator that sets `AUDIT_ARCHIVE_BUCKET="evil', 'us-east-1') ; DROP TABLE ..."` gets remote SQL execution as the connecting Postgres user. Trust boundary is the operator's env, but a misread example in `docker-compose.override.yml` is enough.

**Fix:** validate `AUDIT_ARCHIVE_BUCKET` against `^[a-z0-9][a-z0-9.-]{1,62}$` (S3 bucket naming) at boot or at job entry; reject anything else. Alternatively, single-quote-escape via `replace(/'/g, "''")` on the interpolation.

---

### [MEDIUM] `can-run-docker.ts` is test-only but exported from production `src/`
**File:** `apps/worker/src/lib/can-run-docker.ts`

Sole importers (grep across `apps/`, `packages/`, `tests/`) are all under `apps/worker/tests/unit/**`. No production-side caller. Lives inside the tsup bundle output → ships in the worker image. Violates LOCKER-04 "every exported symbol has at least one non-test importer" (per `CLAUDE.md` #14).

**Fix:** move to `apps/worker/tests/_helpers/can-run-docker.ts` and update the 11 test imports.

---

### [MEDIUM] Module-level `_gaugesRegistered` flag with `if (!_gaugesRegistered)` is unreachable-dead
**File:** `apps/worker/src/jobs/reconciliation-daily-check.ts:84-89`

```
let _gaugesRegistered = false;
if (!_gaugesRegistered) {
  driftPctGauge.addCallback(...);
  ...
  _gaugesRegistered = true;
}
```

This pattern runs ONCE at module load (top-level). The boolean is initialised `false` immediately above the `if` so the branch always enters. The flag protects against… nothing — JS modules are evaluated once per realm. The comment claims it guards "double-registration if `buildReconciliationDailyCheckHandler` is called twice", but the registration block is module-top-level, not inside the builder function. Dead protection.

**Fix:** drop the flag; just call `addCallback(...)` at module top. If real double-registration is a concern (test re-import via Vitest's `vi.resetModules()`), move the registration into the builder with an actual guard scoped to that closure.

---

### [MEDIUM] `withTenantContext` swallows the original error in the catch path before rethrowing
**File:** `apps/worker/src/lib/with-tenant-context.ts:143-149`

The `try { ... } catch (err) { span.recordException(err); childLog.error({ err }, "tenant job failed"); throw err; }` block logs the error before rethrowing — fine — but the redact paths (see F-5) don't cover nested HTTP-error shapes, so this is THE worker log path that leaks tokens on every job failure. Tied to F-5 — fixing the redact policy closes both.

---

### [MEDIUM] `ingestIngestSchedulerSafe` typo — function is named `ingestIngestSchedulerSafe`
**File:** `apps/worker/src/index.ts:287-291`

```
async function ingestIngestSchedulerSafe(queue: ...): Promise<void> {
  await ensureIngestScheduler(queue);
}
```

Name is doubled ("ingest ingest scheduler"). The function is also a 1-line wrapper that just delegates to `ensureIngestScheduler` — no error handling, no "safe" behavior. Dead wrapper.

**Fix:** delete the wrapper, inline `await ensureIngestScheduler(ingestQueue)` at the call site (line 181).

---

### [LOW] `lib/with-tenant-context.ts:67` keeps an `any` in the Zod schema generic
The `noExplicitAny` biome-ignore is genuine — Zod's `ZodObject` shape generic can't be expressed without `any` — but adding an `issue-NNNN:` justification (per LOCKER-02 format) is required by `CLAUDE.md` #12. Same for the 9 `db/app-pool.ts` `noExplicitAny` ignores.

**Fix:** prefix each ignore comment with `issue-0000: pg overloads / zod shape generic — refactor blocked by upstream typings`.

---

### [LOW] `inferKind` fallback to `reason_tokens` for unknown models silently mislabels novel transcribe/realtime models
**File:** `apps/worker/src/lib/infer-kind.ts:22-23`

Adding a new model whose alias doesn't match `/whisper/` or `/realtime/` (e.g. `parakeet-tdt-v2`) bills it as token-priced even when it's minutes-priced. The validateDuration anomaly counter catches the SECOND-order symptom (non-numeric duration) but the FIRST-order misclassification ships zero anomalies.

**Fix:** require explicit allow-list of model→kind in env or DB; fall back to `unknown_kind` and emit a `worker_billing_anomalies_total{reason="unknown_model_kind"}` increment.

---

### [LOW] `audit-archive.ts:285` parses `dbUrl` twice on the error path
The `parseDbUrl(dbUrl)` at line 285 is called even when no error occurred, just to capture the password for potential redaction. Harmless cost but the password sits in memory longer than necessary.

**Fix:** capture the password inside `buildExportSteps` and pass it back as a return tuple, or skip redaction prep when steps[].cmd === "custom" (no dbUrl).

---

## Dead code
- `apps/worker/src/lib/can-run-docker.ts` — test-only helper exported from production `src/`. 11 test importers, 0 production importers. Move to `tests/_helpers/`. (also F-9)
- `apps/worker/src/index.ts:287-291` `ingestIngestSchedulerSafe` — 1-line typo-named wrapper, no error handling. Delete. (also F-12)
- `apps/worker/src/jobs/reconciliation-daily-check.ts:84-89` `_gaugesRegistered` flag — always false at module-eval, no protection. (also F-10)
- `apps/worker/src/jobs/ingest-litellm-spend.ts:387-390` trailing comment block referencing removed `extractDuration` — leave as historical doc or drop entirely (consistency with rest of project's commenting style).

## Suppressed warnings
All suppressions found are `biome-ignore lint/suspicious/noExplicitAny` (10 occurrences in `db/app-pool.ts`, 1 in `lib/with-tenant-context.ts`). None use the `issue-NNNN:` justification format required by LOCKER-02 (CLAUDE.md #12). Either retro-fit the format or land an allowlist entry in `tools/lint-no-suppressions.ts`.

No `@ts-ignore`, no `@ts-expect-error`, no `@ts-nocheck`, no `eslint-disable`, no `as any` outside biome-ignore-justified surfaces.

## Notes
- **Tenant context discipline is enforced strictly at the HOF layer** — every job handler is wrapped by either `withTenantContext` or `withSystemContext`, and the app-pool runtime guard (D-W4 layer 2) refuses queries from tenant-mode handlers that lack the GUC. That's solid defense in depth. The architectural gap (F-1, F-6) is that the HOF binds the GUC on a client that the handler doesn't have a handle to — handlers issuing further `pool.query` calls take a different connection and the guard correctly rejects them. The CORE design needs to thread the bound client through.
- **Crypto discipline is clean** — no `createCipheriv` outside `packages/data/src/encryption/envelope.ts`; no plaintext credential columns referenced from worker.
- **Zod validation discipline is clean** — every job has a schema, every enqueue site goes through `typedQueue` which re-parses on `.add()`. No `JSON.parse(job.data)` anywhere.
- **No NODE_ENV branches outside the bootstrap-permitted surface** — the two hits in `email-delivery.ts:80,95` are wired through an injectable `nodeEnv` dep (with `process.env.NODE_ENV` as the default), which is a legitimate bootstrap-style configuration read. Marginal LOCKER-01 question but defensible.
- **NDJSON / wire-shape risks:** out of scope for worker (no HTTP surface).
- **At-most-once vs at-least-once is implicit** across the codebase: every job either targets an idempotent UPSERT (`usage_ledger` ON CONFLICT, `usage_rollup_daily` ON CONFLICT) or a side-effecting SMTP send that BullMQ jobId-dedupes at enqueue time. The DLQ-absence (F-3) is the bigger hole than the semantics-declaration gap.

---
_Reviewed: 2026-05-17_
_Reviewer: gsd-code-reviewer (worker scope)_
_Depth: deep_
