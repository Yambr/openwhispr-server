# Review: worker (apps/worker)

Branch: main @ 1832f28
Scope: apps/worker/src/**

## Summary
- Files reviewed: 14 TS files (index, queues, scheduler, otel-bootstrap, 4 lib/, 2 db/, 7 jobs/, 1 i18n/)
- Findings: CRITICAL=2 HIGH=4 MEDIUM=4 LOW=3
- Top 3 production risks:
  1. **`audit-archive` shell-injects DATABASE_URL (with password) into `bash -c "...$dbUrl..."`** — credentials leak into ps/audit/error stderr; if the URL ever contains an unescaped `"` or `$`, it's also an RCE. Hardening claim in the comment is false.
  2. **`reconciliation-discrepancy` handler lies about its return type and silently discards `runIngestOnce` results** — `as unknown as` cast to a richer shape over a `Promise<void>` HOF; observability of how many rows the backfill actually moved is gone. Also passes the daily `since/until` window in, but the comment admits `runIngestOnce` ignores them and just advances the global watermark — so the "backfill" is in name only.
  3. **`reconciliation-daily-check` issues an N-per-end_user query against the app DB inside the LiteLLM aggregation loop without tenant context** — every probe trips the runtime tenant guard's `pool.query` path which opens a fresh checkout + probe per call (D-W4 layer 2), but the guard is system-mode so it short-circuits. Behavior is correct but the comment "bounded by tenant count, not row count" is wrong — `litellmRows` is grouped by `end_user` (per-user), not per-tenant, so this is O(distinct users) per tick, and each is a serialized round-trip.

## Findings

### [CRITICAL] audit-archive composes DATABASE_URL (with password) into a `bash -c` script
- File: `apps/worker/src/jobs/audit-archive.ts:96-128`
- Category: Security / secret leak / shell injection
- Evidence:
```ts
const dbUrl = env("AUDIT_ARCHIVE_DATABASE_URL") ?? env("DATABASE_URL_OWNER") ?? "";
// ...
const script = [
  `pg_dump --table=public.${partition} --data-only "${dbUrl}"`,
  `gzip -c`,
  `mc pipe minio/${bucket}/audit-archive/${partition}.sql.gz`,
].join(" | ");
return { cmd, args: ["-c", script] };
// ...
case "aws_s3": {
  return {
    cmd: "bash",
    args: ["-c",
      `psql "${dbUrl}" -c "SELECT aws_s3.query_export_to_s3('SELECT * FROM public.${partition}', '${bucket}', 'audit-archive/${partition}.csv', 'us-east-1')"`,
    ],
  };
}
```
- Why it matters:
  1. `DATABASE_URL_OWNER` is `postgres://openwhispr_owner:<password>@postgres:5432/openwhispr` — full BYPASSRLS creds. They are now embedded in `process.argv` of `bash -c "...pg_dump --data-only \"$URL\" | gzip | mc pipe ..."`. Visible in `ps auxww`, container `/proc/.../cmdline`, any OOM/coredump, and any non-zero exit path because the failure handler does `result.stderr.slice(0, 512)` (line 161) and includes that in the thrown `Error`. The error reaches BullMQ's `failedReason` Redis key in cleartext.
  2. Injection: `partition_name` is regex-guarded (`/^audit_log_p?\d{4}_\d{2}$/`), good. But `dbUrl`, `bucket`, and (for `aws_s3`) the inlined SELECT string are NOT validated. A password containing `"`, `$(...)`, or `` ` `` breaks out. The header comment line 18 ("argv array — NEVER `exec` on a concatenated string") is contradicted by the implementation: every non-`custom` branch IS a concatenated string passed to `bash -c`.
  3. The `aws_s3` branch double-quotes inside double-quotes (`-c "SELECT ... '...' "`) — a partition name surviving the regex but containing nothing dangerous is fine, but a `bucket` env containing `"` or `'` breaks the SELECT.
- Fix: drop `bash -c` entirely. Use the `pg` Pool already injected (`deps.pool`) to run `pg_dump` via `pg_dump` shelled with **argv only** and `PGPASSWORD`/`PGSERVICE` env passed via `spawn`'s `env` option (or just COPY ... TO PROGRAM with explicit creds-free libpq env). Pipe via Node streams between `pg_dump`, `gzip` (`zlib.createGzip()`), and the storage uploader. Pass the connection via `PG*` env vars or `--dbname=service:foo`, NEVER as an argv-positional string. For `aws_s3`, run the SQL through `deps.pool.query` — there is no reason to shell out to `psql` here; the worker already has a libpq pool. Also: never include `result.stderr` raw in thrown errors — redact via `packages/observability/redact` first (the redact dup'd in 14a is the right place).

### [CRITICAL] `reconciliation-discrepancy` handler return type is a lie; backfill window is a no-op
- File: `apps/worker/src/jobs/reconciliation-discrepancy.ts:43-61`
- Category: Stub disguised as a fix / silent data loss of observability
- Evidence:
```ts
return withTenantContext(reconciliationDiscrepancySchema, deps.pool, async () => {
  const result = await runIngestOnce(deps.ingestDeps);
  // Cast: handler body's awaited result. The HOF's outer Promise<void>
  // contract drops the return value; for the test/observation seam we
  // expose the count via the resolved value on the inner closure scope
  // — kept here only as a side-effect log target for the future.
  void result;
}) as unknown as (
  job: import("bullmq").Job,
) => Promise<{ rowsProcessed: number; rowsScanned: number }>;
```
And the comment block lines 33-42 admits:
> "`runIngestOnce` in Phase 3 ... does NOT yet accept since/until args ... since/until on the payload is recorded for audit/log correlation but doesn't reshape the watermark-driven loop."
- Why it matters:
  - The function's TS signature promises callers `{ rowsProcessed, rowsScanned }`. The body resolves to `undefined`. Any caller that destructures (`const { rowsProcessed } = await handler(job)`) gets `undefined.rowsProcessed` → runtime TypeError. The `as unknown as` double-cast bypasses the type system telling the truth.
  - More importantly, the entire job is a no-op when invoked for a per-tenant discrepancy: a discrepancy fires for tenant T over window [since, until], but `runIngestOnce` ignores the window AND ignores the tenant — it advances the global watermark and ingests whatever the watermark says next. So when reconciliation-daily-check detects drift for tenant T at 01:05 UTC for window [yesterday 00:00 .. today 00:00], the "backfill" reads from `watermark` (which is already at "now-ish" because the 30s ingest tick has been running all day) and ingests zero rows for that tenant. Drift persists; no operator gets a real backfill.
  - This is a Phase-6 stub that survived into 14a HEAD. The comment calls it out as a `Deferred` but it ships as a registered worker, not a TODO.
- Fix: either (a) refactor `runIngestOnce(deps, { since, until, tenantId? })` so the SQL filters on `startTime BETWEEN ... AND ...` AND `end_user IN (users for tenant)`, drop the cast, return real counts; or (b) until that refactor lands, do NOT register `reconciliation-discrepancy` as a queue worker — leave the daily check to alert via OTel gauges only. Half-implementation that throws on type-correct destructure is worse than absent.

### [HIGH] `reconciliation-daily-check` issues serialized per-end_user app DB lookups (1000+ round-trips per tick)
- File: `apps/worker/src/jobs/reconciliation-daily-check.ts:137-149`
- Category: Reliability / correctness-of-comment
- Evidence:
```ts
for (const row of litellmRows) {            // grouped by end_user, not tenant
  if (!row.end_user) continue;
  const tenantRes = await deps.appOwnerPool.query<{ tenant_id: string }>(
    `SELECT tenant_id::text AS tenant_id FROM users WHERE id = $1::uuid LIMIT 1`,
    [row.end_user],
  );
  ...
}
```
Comment on line 134: "bounded by tenant count, not row count; production workloads have ≤ 1000 distinct tenants" — but the SQL groups by `"end_user"` (the user UUID), so this is bounded by **distinct active users in the 24h window**, easily 10–100× tenant count at the 1000-user target.
- Why it matters: each iteration is an `await` against the wrapped app pool, which (system-mode skips probe, fine) still serializes round-trips. At 10k DAU this is 10k sequential queries — a multi-minute job on a healthy cluster, increasing the chance of overlap with the next-day partman maintenance at 02:00 UTC. Performance issues are nominally out of v1 scope but the falsified loop-bound comment makes this a correctness/comprehension defect, not just a perf concern.
- Fix: do this as ONE JOIN-style query — `SELECT id::text, tenant_id::text FROM users WHERE id = ANY($1::uuid[])` with the distinct `end_user` list passed as an array. Then drive the JS aggregation from the in-memory map. Update the comment to reflect "bounded by distinct users per window."

### [HIGH] `extractDuration` silently returns 0 for any non-`number` duration, mis-billing minutes
- File: `apps/worker/src/jobs/ingest-litellm-spend.ts:142-146, 211-216`
- Category: Bug / data correctness
- Evidence:
```ts
const units =
  kind === "reason_tokens"
    ? (r.total_tokens ?? 0)
    : Math.ceil(extractDuration(r.metadata) / 60);
// ...
function extractDuration(metadata: Record<string, unknown> | null | undefined): number {
  if (!metadata) return 0;
  const d = metadata["duration"];
  if (typeof d === "number" && Number.isFinite(d) && d > 0) return d;
  return 0;
}
```
- Why it matters: For `transcribe_minutes` / `realtime_minutes`, the only signal of how many minutes to bill is `metadata.duration`. If the upstream API route writes that field as a string (`"42.0"`), a `Date`, or a number wrapped in an object, the function silently returns 0 → `Math.ceil(0/60) = 0` units inserted into `usage_ledger`. The tenant is billed for zero usage with no log line, no metric, no retry — pure silent data loss on the revenue path. There is no warning log for the "duration missing" branch unlike the `end_user`/`tenant_id` branches above.
- Fix: at minimum, `log.warn({ rid: ourRid, metadata }, "missing/non-numeric duration on minutes-kind spend row")` and emit an OTel counter `ingest_litellm_spend_dropped_minutes_total{reason="missing_duration"}`. Better: accept `string | number` and coerce explicitly. Best: have apps/api route handlers stamp `metadata.duration_seconds` (typed) at request time and only fall back to `duration` if absent — already the contract this code is trying to fulfill.

### [HIGH] `index.ts` `process.exit(0)` on graceful shutdown even if pool/queue close threw
- File: `apps/worker/src/index.ts:251-267`
- Category: Reliability
- Evidence:
```ts
try {
  await Promise.allSettled(workers.map((w) => w.close()));
  await ingestQueue.close();
  await closeQueueRegistry(registry);
  await litellmPool.end();
  await appOwnerPool.end();
  await maintenancePool.end();
  await redis.quit();
} catch (err) {
  log.error({ err }, "error during shutdown");
}
process.exit(0);
```
- Why it matters: any uncaught error during shutdown — most likely from `redis.quit()` if BullMQ still holds a blocking BRPOPLPUSH — is logged then swallowed, and the process exits 0. Kubernetes / docker-compose then treat the pod as having drained cleanly when in fact in-flight job clients may have leaked or jobs were not stalled-back correctly. Also: `Promise.allSettled` over worker.close() hides per-worker failures (e.g., a worker stuck mid-job). The shutdown path should `exit(1)` if any settled value is `rejected`, so the orchestrator restarts the pod with a clean state instead of moving traffic away thinking it drained.
- Fix: inspect the `allSettled` results array, exit(1) on any rejection AND on caught errors, and log per-worker rejection separately so operators can tie failures to a specific queue. Also add a watchdog `setTimeout(() => process.exit(1), 30_000).unref()` so a wedged `worker.close()` (BullMQ deadlock case) does not hang past the grace period.

### [HIGH] `index.ts` connects to Valkey with no TLS option and no auth retry policy
- File: `apps/worker/src/index.ts:147-152`
- Category: Security / reliability hardcode
- Evidence:
```ts
const redis = new IORedis({
  host: process.env["VALKEY_HOST"] ?? "valkey",
  port: Number(process.env["VALKEY_PORT"] ?? "6379"),
  ...(process.env["VALKEY_PASSWORD"] ? { password: process.env["VALKEY_PASSWORD"] } : {}),
  maxRetriesPerRequest: null,
});
```
- Why it matters:
  - No `tls: {}` option, no env knob for it. The CLAUDE.md constraint says "HTTPS only: never plaintext HTTP on any externally reachable port" — that's HTTP-specific, but for K8s deployments where Valkey traffic crosses pods, mTLS is the operator's expected lever. Enterprise variant of the stack (K8s + CloudNativePG) per CLAUDE.md expects this. No env hook = no operator override.
  - `Number(process.env["VALKEY_PORT"] ?? "6379")` — if operator sets `VALKEY_PORT=""` (empty string, valid env), `Number("") === 0`, the worker silently connects to port 0 and crashes with a confusing message. Apps/api side likely uses `pino-hosted` already proven, worker drifted.
  - No `enableReadyCheck`, no `connectTimeout`, no `lazyConnect` decision documented. The default ioredis behavior may infinitely retry on a typo'd host.
- Fix: add `tls: process.env["VALKEY_TLS"] === "1" ? {} : undefined`, validate port via Zod (`z.coerce.number().int().positive()`), set explicit `connectTimeout: 10_000`. Also factor this construction into a shared `packages/queue` so apps/api's redis client and apps/worker's stay in lock-step on TLS posture.

### [MEDIUM] Worker creates its OWN `pino()` in index.ts and ingest-litellm-spend.ts, bypassing the shared redact factory
- File: `apps/worker/src/index.ts:89`, `apps/worker/src/jobs/ingest-litellm-spend.ts:39`
- Category: Architecture / redact divergence
- Evidence:
```ts
// index.ts
const log = pino({ name: "worker" });
// ingest-litellm-spend.ts
const log = pino({ name: "ingest-litellm-spend" });
```
But `lib/with-tenant-context.ts` and `lib/with-system-context.ts` correctly use `makePino()` from `@openwhispr/observability` so the shared D-T4 redact paths apply. The two bare `pino()` instances in index.ts and ingest-litellm-spend.ts do NOT inherit those redact rules. The ingest job logs `{ rid: ourRid, userId }` on the "no tenant" branch — user_id (UUID) is the canonical PII handle that the observability redactor scrubs. With the bare pino() it ships to Loki uncensored.
- Why it matters: violates the project's "duplicated redact logic vs `packages/byok-guard` / `packages/observability/redact`" rule called out explicitly in this review's hunt list. Boot logs in index.ts before the SDK starts are arguably fine (BYOK guard pinoBoot is sync-stderr), but the ingest-litellm-spend per-tick log lines absolutely flow through the live OTel pipeline.
- Fix: replace both with `makePino({ base: { service: "worker", component: "..." } })`. Delete the bare-`pino` import. Add a biome/eslint rule (or grep CI gate) that bans `import pino from "pino"` outside `index.ts`'s BYOK pre-bootstrap and the observability package itself.

### [MEDIUM] `reconciliation-daily-check` registers OTel gauge callbacks at module load — gauges keep observing across job invocations and even after handler completes
- File: `apps/worker/src/jobs/reconciliation-daily-check.ts:48-79`
- Category: Bug / observability correctness
- Evidence:
```ts
const driftStore = new Map<string, { drift_pct: number; drift_usd_cents: number }>();
// ...
driftPctGauge.addCallback(_driftPctGaugeCallback);
driftUsdGauge.addCallback(_driftUsdGaugeCallback);
// ...
// inside handler:
driftStore.clear();
let breached = 0;
for (...) { driftStore.set(tenantId, ...); }
return { tenants: driftStore.size, breached };
```
- Why it matters:
  - The gauge callbacks observe `driftStore` on the 15s OTel export tick. The handler runs once per day at 01:00 UTC. For the 23h between job runs, the callbacks keep emitting the previous day's values stamped with yesterday's `tenant_id` labels — that's not a real drift signal anymore, it's a frozen snapshot. Alerts based on "drift > threshold for 1h" will refire all day on yesterday's breach.
  - Worse: `driftStore.clear()` happens AT THE START of each handler run, so for a few seconds during a tick mid-clear-mid-set, the gauge sees a partially populated map (race between OTel exporter callback and the handler's `for` loop). No lock.
  - The module-level callback registration also means: if `buildReconciliationDailyCheckHandler` is called twice (tests + production wiring share the module), the callbacks register twice and emit duplicate gauge points — cardinality / double-counting.
- Fix: (a) clear `driftStore` BEFORE returning success, so between-job state is empty (no stale labels); (b) take a snapshot Map inside the handler, swap atomically into `driftStore` at the end; (c) gate `addCallback` behind a "registered" flag so re-import doesn't double-register.

### [MEDIUM] `extractDuration` is unexported and unreachable from tests; `inferKind` "whisper-large-v3" hardcode
- File: `apps/worker/src/jobs/ingest-litellm-spend.ts:211-216`, `apps/worker/src/lib/infer-kind.ts:17`
- Category: Dead code / testability / hardcode
- Evidence:
```ts
// infer-kind.ts
if (model === "whisper-large-v3" || model.includes("whisper")) {
  return "transcribe_minutes";
}
```
`model === "whisper-large-v3"` is redundant — `"whisper-large-v3".includes("whisper")` is already true. Dead branch. Also the operator-facing model-alias matching is a magic string with no link back to the LiteLLM model_list config — any operator running `gpt-4o-mini-realtime-preview` aliased as `gpt4o-mini-realtime` (no `realtime` substring) will be billed as `reason_tokens`. The comment says "Unknown aliases fall back to 'reason_tokens'" but the failure mode is silent.
- Fix: drop the redundant string equality. Add a warn-log when the substring match falls through to the default. Better: drive the kind inference off LiteLLM's `metadata.kind` field which the api routes (Plan 04/05/07) already stamp — comment on line 9 of infer-kind.ts says "LiteLLM does not propagate the per-route kind downstream — only the model alias survives" — but the api-side STAMPS metadata, and `runIngestOnce` reads metadata for `openwhispr_request_id`. Reading `metadata.kind` is a one-line addition.

### [MEDIUM] `partman-maintenance` discovers detached partitions by regex over pg_class, fires audit-archive for partitions that may already be archived
- File: `apps/worker/src/jobs/partman-maintenance.ts:42-78`
- Category: Idempotency / duplicate-work bug
- Evidence: `discoverDetached` returns every `audit_log_pYYYY_MM` table that is no longer inheriting from `audit_log` — regardless of whether a previous partman tick already enqueued (and possibly already executed) an audit-archive job for it. The audit-archive handler `DROP TABLE IF EXISTS` is idempotent in DDL terms, but if the previous run completed AND dropped, the table is gone and we don't re-enqueue (fine). If the previous run completed exporter-OK but `AUDIT_ARCHIVE_DRY_RUN=1` was set, the table is still detached-on-disk; the next partman tick re-enqueues an archive job that re-runs `pg_dump` against the same partition and re-uploads to MinIO/S3 (overwriting). That's wasted I/O and (depending on bucket retention policy) a versioning churn.
- Why it matters: not data loss, but reliability/cost noise. Also coupled to the audit-archive bash-injection bug above — every extra invocation is another chance to leak DATABASE_URL into a process listing.
- Fix: stamp a marker once an archive succeeds — e.g., `COMMENT ON TABLE public.audit_log_pYYYY_MM IS 'archived=YYYY-MM-DDTHH:MM:SSZ'` after the DROP fails to apply (in dry-run mode) or before DROP, and skip re-enqueue when the comment exists. Or: maintain a `audit_archive_log` table in the worker schema tracking (partition, archived_at, exporter) — also gives operators a queryable history.

### [LOW] `drainStaleVkrKeys` is a permanent transient — no removal mechanism documented
- File: `apps/worker/src/index.ts:104-144`
- Category: Dead-code-pending / tech debt
- Evidence: Comment says "Safe to remove in a future phase once stragglers stop appearing" but there is no telemetry on the `deleted` counter beyond a single info-log. Operators upgrading from a clean install (no Phase-14-old keys) still pay one `SCAN` round-trip per boot forever. No issue/Jira reference embedded in the comment.
- Fix: gate behind `process.env["WORKER_DRAIN_VKR_KEYS"] === "1"`, default off after the Phase 15 release, and link the removal SHA in the comment.

### [LOW] `audit-archive` accepts `audit_log_p?\d{4}_\d{2}` — legacy `_2026_05` and modern `_p2026_05` both ok, but no test for old format reaching production now
- File: `apps/worker/src/jobs/audit-archive.ts:33`
- Category: Stylistic / dead schema
- Evidence: `const PARTITION_NAME_RE = /^audit_log_p?\d{4}_\d{2}$/;` — accepts both. If migrations have committed exclusively to pg_partman's `_p` prefix (Phase 6 / Plan 06-04), the legacy branch is dead.
- Fix: trim to `/^audit_log_p\d{4}_\d{2}$/` if migration history confirms, OR add a comment naming the migration phase that retired the legacy form.

### [LOW] OTel diag logger fallback expression has stale operator semantics
- File: `apps/worker/src/otel-bootstrap.ts:46-51`
- Category: Stylistic / subtle bug
- Evidence:
```ts
diag.setLogger(
  new DiagConsoleLogger(),
  DiagLogLevel[
    (process.env.OTEL_LOG_LEVEL?.toUpperCase() as keyof typeof DiagLogLevel) ?? "ERROR"
  ] ?? DiagLogLevel.ERROR,
);
```
- Why it matters: If `OTEL_LOG_LEVEL=BOGUS` is set, the inner expression yields `DiagLogLevel["BOGUS"] === undefined`, then the `?? DiagLogLevel.ERROR` fallback kicks in — fine. But the `as keyof typeof DiagLogLevel` cast hides the lookup failure from TS. A typo never surfaces.
- Fix: explicit guard — `const lvl = process.env.OTEL_LOG_LEVEL?.toUpperCase(); const resolved = lvl && lvl in DiagLogLevel ? DiagLogLevel[lvl as keyof typeof DiagLogLevel] : DiagLogLevel.ERROR;`

## Dead code

- `apps/worker/src/lib/infer-kind.ts:17` — `model === "whisper-large-v3"` is dominated by the next clause `model.includes("whisper")`.
- `apps/worker/src/jobs/reconciliation-discrepancy.ts:51-57` — `result` is computed then discarded with `void result;`. The HOF promises `Promise<void>`, the cast lies that it returns `{rowsProcessed, rowsScanned}`. Either wire the count through or drop the lie.
- `apps/worker/src/index.ts:276-280` — `ingestIngestSchedulerSafe` is a single-call indirection that adds nothing over `await ensureIngestScheduler(ingestQueue)` inline. The name has a typo (`ingestIngest...`). Dead-style.
- `apps/worker/src/jobs/audit-archive.ts:33 PARTITION_NAME_RE` — legacy `_2026_05` branch likely unreachable post-Phase-6 migration.
- `apps/worker/src/jobs/ingest-litellm-spend.ts:181-187 ingestLitellmSpendSchema` — the `.or(z.object({}).strict())` branch coexists with `{ since: ..., until: ... }` optional fields — the two are equivalent (an empty object satisfies the first schema too). Schema collapses to the first variant.

## Suppressed warnings

- `apps/worker/src/db/app-pool.ts` — 8× `biome-ignore lint/suspicious/noExplicitAny` + 5× `as any` / `as unknown as` to monkey-patch `pg.Pool.connect` and `pg.Pool.query`. The pattern is justified (pg's overload signatures genuinely defy clean typing) but the implementation re-wraps `pool.query` to manually probe + forward; every cast is a place where a future pg upgrade could silently break. Worth a single typed adapter module in `packages/data` rather than inline patching.
- `apps/worker/src/jobs/reconciliation-discrepancy.ts:58 as unknown as (...)` — explicitly LIES about the return type. Documented as a stub in the comment; should be removed (see CRITICAL #2).
- `apps/worker/src/lib/with-tenant-context.ts:67-68 biome-ignore` — `Record<string, any>` for the ZodObject shape is the canonical Zod generic pattern; acceptable.

## Disabled tests near scope

Not surveyed in this review (scope is `apps/worker/src/**`). Recommend a follow-up grep:
```
grep -rn "it.skip\|describe.skip\|test.skip\|it.todo\|describe.skipIf" apps/worker/tests/
```
`canRunDocker` (lib/can-run-docker.ts) is the deliberate skip-gate for testcontainer suites and is correct.

## Notes

- **Tenant scoping audit (passed):** every job that touches `usage_ledger`, `users`, `usage_rollup_daily`, or `audit_log` flows through either `withTenantContext` (binds `app.tenant_id` GUC in a transaction, parameterized — no SQL injection on tenant id) or `withSystemContext` (BYPASSRLS, explicit opt-in, runtime-guard short-circuit). The `app-pool.ts` runtime guard correctly distinguishes the two modes. **NOT VIOLATED** but the `partman-maintenance` pool is constructed with `connectionString: process.env["DATABASE_URL_OWNER"]` directly bypassing `wrapPoolWithTenantGuard` (index.ts:163-166) — fine because the handler is system-mode, but worth noting in a comment so a future maintainer doesn't add a tenant-scoped query against `maintenancePool` and silently bypass the guard.

- **Retry posture:** `DEFAULT_JOB_OPTS = { attempts: 5, backoff: { type: 'exponential', delay: 1_000 } }` — fine. The audit-archive job's throw-on-non-zero-exit will burn all 5 retries against a broken SMTP/MinIO endpoint with stderr-included errors landing in Redis cleartext (see CRITICAL #1).

- **Idempotency posture:** ingest-litellm-spend correctly uses `ON CONFLICT (request_id) DO NOTHING`; usage-rollup-daily-tenant correctly uses `ON CONFLICT (tenant_id, date) DO UPDATE`; audit-archive uses `DROP TABLE IF EXISTS`; partman-maintenance is CALL-based and partman's own internal logic is idempotent. email-delivery defers idempotency to the api enqueuer (jobId derived from request_id) — confirmed wired at `apps/api/src/index.ts:549`. **PASS** on idempotency.

- **`if (process.env.NODE_ENV ...)` in prod paths:** one instance — `email-delivery.ts:111` `nodeEnv !== "production"` carve-out for the SMTP-not-configured no-op sender. Documented (HI-01 carry-over), justified, gated on a specific reason string. Acceptable but the worker should also emit a metric here (`email_delivery_skipped_total{reason="smtp-not-configured-dev"}`) so operators in non-prod can see how many verification emails their stack would have sent.

- **No fire-and-forget promises detected** in job handlers. All `await`s are present on `queue.add`, `pool.query`, `client.release` (release is sync, fine), `withTenantContext` returns.

- **No empty catch blocks** swallowing job errors. `audit-archive.ts:101-103` `try { client.release() } catch {}` is bounded to a release cleanup path with explicit "swallow — checkout may already be released" comment; acceptable.
