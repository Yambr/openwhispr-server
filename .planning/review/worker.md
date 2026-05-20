# Worker Service — Adversarial Code Review

**Scope:** `apps/worker/src/**` (jobs, db, lib, i18n)
**Branch:** main @ 6e43588
**Reviewed:** 2026-05-20
**Reviewer stance:** FORCE — assume defects present, find evidence.
**Files reviewed:** 15 TypeScript sources (excluding `.txt`/`.html` locale assets).

---

## Summary

Worker code is unusually disciplined: tenant context is enforced by a HOF + ALS + per-pool runtime guard pattern (`db/app-pool.ts` + `lib/with-tenant-context.ts` + `lib/with-system-context.ts`), every job is Zod-validated at both enqueue (typed-queue) and dequeue (HOF), retry semantics are centralised in `queues.DEFAULT_JOB_OPTS` with exponential backoff + 0.5 jitter + `removeOnFail: false` (DLQ-style retention), and the audit-archive credential-leak (CRIT-FIX-07) is closed.

That said, the review surfaced one **CRITICAL** silent-loss path on the spend-ingest hot path, one **CRITICAL** rollup-vs-spend timestamp skew on a billing-adjacent surface, and a cluster of **HIGH**/**MEDIUM** robustness gaps around shutdown semantics, throwing from job handlers, and a per-tenant N+1 in the dispatcher loop. There are no obvious BYOK / credential leaks, no swallowed-without-throw catch blocks in job handlers, and no TODOs in production paths.

Findings classified per `<adversarial_stance>`: **BLOCKER** maps to CRITICAL/HIGH, **WARNING** to MEDIUM/LOW.

---

## Findings

### CR-01 — CRITICAL / BLOCKER — Spend-ingest watermark advanced past silently-skipped rows `jobs/ingest-litellm-spend.ts:329-344`

`runIngestOnce` only counts a row as `processed` when `INSERT … ON CONFLICT DO NOTHING` returns `rowCount > 0`, but it advances the watermark unconditionally based on **`rows.length > 0`** at line 337. Any row that hits the `if (!userId)` skip (line 285), the `if (!tenantId)` skip (line 295), or the `validateDuration` null branch (line 310-316) is still in `rows[]`, so the watermark moves past those rows on the next tick — they will **never** be re-attempted even after the missing user/tenant materializes (race: api creates user, ingest scans LiteLLM, user lookup fails, watermark moves forward, the spend log is permanently orphaned).

This is the silent-loss pattern called out in the worker-specific guidance: "Job consumers that swallow errors look 'green' but lose work silently." Here the loss is via watermark advancement, not via exception swallowing, but the outcome is identical: a revenue-bearing spend row is dropped with only a `log.warn` and no alert/metric. (Note `recordBillingAnomaly` is only fired for the duration-skip branch, NOT for missing-end_user / missing-tenant skips — those are the most likely race conditions.)

**Fix direction:** either (a) emit `recordBillingAnomaly("missing_end_user")` / `"missing_tenant"` and alert on the counter, or (b) hold the watermark at `min(skipped.startTime)` so retries happen on the next tick.

---

### CR-02 — CRITICAL / BLOCKER — Daily rollup buckets by ingest `created_at`, not by LiteLLM `startTime` `jobs/usage-rollup-daily.ts:75-87, 118-137` + `jobs/reconciliation-daily-check.ts:191-196`

`buildUsageRollupDispatcher` selects `DISTINCT tenant_id FROM usage_ledger WHERE created_at >= $1::date AND created_at < $1::date + INTERVAL '1 day'`. The per-tenant child aggregates the same `created_at` window. The ingest job (`jobs/ingest-litellm-spend.ts:321-327`) inserts with implicit `created_at = now()` — there is no column linking back to LiteLLM's `startTime`. Therefore the daily rollup buckets rows **by the moment the worker ingested them, not by the moment the spend happened**: a 30-second-late tick after UTC midnight will allocate yesterday's spend to today's rollup. The reconciliation-daily-check uses the same `created_at` filter (line 191-196), so its drift gauge reads 0 even while the rollup is wrong.

**Fix direction:** add a column to `usage_ledger` carrying LiteLLM `startTime` (call it `event_at`) and switch both rollup + reconciliation queries to filter on it; or gate the dispatcher behind a settle window (only roll up days where `now() - ingest_watermark >= 1h`).

---

### CR-03 — HIGH / BLOCKER — Email-delivery silent-success on `smtp-not-configured` in non-production `jobs/email-delivery.ts:111-117`

The dev-fallback carve-out short-circuits with `return;` when the sender reports `smtp-not-configured` and `NODE_ENV !== "production"`. The intent (per HI-01 comment) is to avoid burning retries during dev compose-up. Two problems:

1. **Silent acknowledgement of unsent email** — the textbook "swallowed error in job handler" anti-pattern flagged in the worker-specific guidance. Anyone running `NODE_ENV=staging` (or unset, defaulting to undefined which `!== "production"`) gets a green job that never delivered. The Phase 13 SR-loop "re-verifies the email arrived" coverage breaks for those operators.
2. **Constitutional NODE_ENV violation (LOCKER-01 / CLAUDE.md rule 11)** — `process.env.NODE_ENV` and string comparison against `"production"` MAY appear ONLY in `bootstrap.ts`/`config/*.ts`/`otel-bootstrap.ts`/`*.config.ts`. `apps/worker/src/jobs/email-delivery.ts:95,111` is none of those. The lint tool `tools/lint-no-env-branches.ts` REFUSES this pattern.

**Fix direction:** thread a real config flag (e.g. `EMAIL_FALLBACK_NONFATAL=1`) through `bootstrap` and inject via `deps.nodeEnv` / rename to `deps.allowSmtpFallback`. Constitutional violation MUST be resolved before public publication.

---

### CR-04 — HIGH / BLOCKER — `withTenantContext` ROLLBACK can replace the original handler error `lib/with-tenant-context.ts:147-154`

```ts
try {
  await handler(data, client);
  await client.query("COMMIT");
} catch (handlerErr) {
  await client.query("ROLLBACK");   // <-- if this throws, handlerErr is lost
  throw handlerErr;
}
```

If `ROLLBACK` itself throws (transient pg failure, client mid-disconnect, broken pipe), the outer `catch` is replaced by the ROLLBACK error and `handlerErr` is silently dropped. Result: BullMQ logs and retries the wrong cause; the real failure mode is invisible. Defence-in-depth requires wrapping ROLLBACK in `try { await … } catch (rbErr) { /* attach to handlerErr or log */ }` so the original always wins.

**Fix direction:** wrap ROLLBACK in its own try; re-throw `handlerErr` regardless.

---

### CR-05 — HIGH / BLOCKER — `partman-maintenance` audit-archive enqueue loop is not idempotent under partial failure `jobs/partman-maintenance.ts:68-80`

After `partman.run_maintenance_proc()` returns (which internally COMMITs detaches), the handler calls `discoverDetached(...)` and then `for (const partition of detached) await auditArchiveQueue.add(...)`. There is no per-iteration error guard. If the typed-queue throws on enqueue (Redis blip, BullMQ Zod parse, Valkey OOM) midway through the list, the loop aborts, the partitions not yet enqueued remain detached-but-not-archived, AND on subsequent runs `discoverDetached` re-returns them — but only for as long as the table is still present on disk. If a future `audit-archive` job (from a successful enqueue earlier in the same iteration) drops one of the OTHER detached partitions before this job retries, that partition's archive is permanently lost.

**Fix direction:** (a) collect failures and re-throw after the loop, or (b) `Promise.allSettled` + log each, or (c) persist the discovered list in a checkpoint table so retries resume.

---

### CR-06 — HIGH / BLOCKER — Reconciliation-daily-check throws mid-loop ⇒ duplicate discrepancy enqueues on retry `jobs/reconciliation-daily-check.ts:213-242`

The handler builds `nextDriftStore` and awaits `discrepancyQueue.add(...)` for each breached tenant. If `.add()` throws on tenant N, the for-loop aborts before reaching the `driftStore.clear() + bulk-copy` at lines 241-242, and on BullMQ retry the entire breach fan-out re-runs for tenants 1..N. The `reconciliationDiscrepancySchema` payload has no `request_id`/`window_id` field, so `typedQueue.add()` cannot de-dup via BullMQ `jobId`. Result: duplicate per-tenant discrepancy jobs pile up after every retry.

**Fix direction:** add `request_id: z.string().uuid()` (or `window_id: <start>-<tenant>`) to the discrepancy schema; pass it as the BullMQ `jobId` on `.add()` so re-enqueues collapse. Optionally `Promise.allSettled` the fan-out so a single failure doesn't abort the rest.

---

### CR-07 — HIGH / BLOCKER — Boot-time `drainStaleVkrKeys` silent failure with no metric `apps/worker/src/index.ts:127-155`

```ts
} catch (err) {
  logger.warn({ err }, "transient vkr-key cleanup failed; non-fatal");
}
```

Two problems:
1. The `do { … } while (cursor !== "0")` loop has no upper-bound iteration cap. A misbehaving Valkey that returns a non-zero cursor forever locks the boot path with no timeout.
2. Permission errors (Valkey ACL change) log at `warn` and never surface to operators without log-tailing at boot. No counter, no alert.

**Fix direction:** (a) add `MAX_ITERATIONS = 1000` cap, (b) emit an OTel counter on cleanup failure so dashboards can surface stuck workers.

---

### CR-08 — HIGH / BLOCKER — Worker shutdown always `process.exit(0)` even on drain failure `apps/worker/src/index.ts:262-278`

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

`Promise.allSettled` never rejects, so per-worker drain failures are silently swallowed; subsequent `await`s may throw and land in the catch, but the process still exits 0. Kubernetes/docker-compose record this as a graceful shutdown, masking real drain failures during rolling deploys (BullMQ jobs in-flight may be abandoned).

**Fix direction:** track a `shutdownErrored` flag (also from the `Promise.allSettled` results array) and `process.exit(shutdownErrored ? 1 : 0)`.

---

### CR-09 — HIGH / BLOCKER — `maintenancePool` lacks the PgBouncer guard that `appOwnerPool` enforces `apps/worker/src/index.ts:174-177`

`maintenancePool` is constructed inline:

```ts
const maintenancePool = new Pool({
  connectionString: process.env["DATABASE_URL_OWNER"],
  max: 1,
});
```

It uses the same `DATABASE_URL_OWNER` env var as `makeAppOwnerPool` (`db/app-pool.ts:160-164`), which DOES guard against PgBouncer hostnames. If an operator misconfigures the URL to point at PgBouncer (transaction mode), `appOwnerPool` throws fast; `maintenancePool` does NOT — and `partman.run_maintenance_proc()` over PgBouncer transaction-mode will silently corrupt partman state because of its internal COMMITs (Pitfall #9, documented in `db/litellm-pool.ts` header).

**Fix direction:** extract a shared `assertDirectPostgres(url)` helper used by both pool factories AND inline in `index.ts`.

---

### WR-01 — MEDIUM / WARNING — Hardcoded `"valkey"` Redis host fallback `apps/worker/src/index.ts:159`

```ts
host: process.env["VALKEY_HOST"] ?? "valkey",
```

Not strictly a LOCKER-03 hit (the rule prohibits `localhost`/`127.0.0.1`/numeric ports, not arbitrary service names), but on Kubernetes the service is typically `valkey-master` or `valkey-headless`. Acceptable as a self-hosted compose default; document the env-override expectation in `docs/`.

---

### WR-02 — MEDIUM / WARNING — `db/app-pool.ts` has 9 `as any` / `as unknown as` suppressions `db/app-pool.ts:61,70,74,78,110,121,128,136,142`

LOCKER-02 prohibits `as any` and `as unknown as` in production code. Each suppression has a one-line Biome justification ("pg has 6 overloads on query", "pg.Pool.connect is callback-or-promise"), but the constitutional rule is binary. If `tools/lint-no-suppressions.ts` allowlists this file, the debt should be tracked in `.planning/deferred-items.md` with a remediation phase; if not allowlisted, this is BLOCKER.

---

### WR-03 — MEDIUM / WARNING — Usage-rollup dispatcher does sequential N+1 enqueue without de-dup jobId `jobs/usage-rollup-daily.ts:82-87`

```ts
for (const row of rows) {
  await deps.childQueue.add("usage-rollup-daily-tenant", { tenant_id: row.tenant_id, date });
}
```

Strictly a robustness concern (perf is out of v1 scope): if BullMQ's stalled-job timer (30s default) fires mid-loop, the retry re-enqueues all 1000 tenants — `usageRollupTenant` has no idempotency key in the BullMQ `jobId`, so duplicates accumulate. The handler itself is idempotent SQL-side via UPSERT, but Valkey stores N+M completed jobs per day.

**Fix direction:** set `jobId: \`${tenant_id}:${date}\`` on `.add()`.

---

### WR-04 — MEDIUM / WARNING — `validateDuration` collapses 4 distinct failure modes into one anomaly label `jobs/ingest-litellm-spend.ts:111-120`

All four branches (missing metadata, non-number, NaN/Infinity, ≤0) route to `recordBillingAnomaly("non_numeric_duration")` at the single call site (line 315). A negative duration is a clock-skew / DB-bug signal distinct from missing metadata. Separate counter labels would let operators triage faster.

---

### WR-05 — MEDIUM / WARNING — `audit-archive` `aws_s3` exporter hardcodes `us-east-1` `jobs/audit-archive.ts:226`

```ts
`SELECT aws_s3.query_export_to_s3('SELECT * FROM public.${partition}', '${bucket}', 'audit-archive/${partition}.csv', 'us-east-1')`
```

`assertSafeBucket` / `assertSafePartition` close SQL injection in practice. But the AWS region literal locks operators out of every other region. Read from `AUDIT_ARCHIVE_REGION` env.

---

### WR-06 — MEDIUM / WARNING — `inferKind` falls back to `reason_tokens` on unknown model strings `lib/infer-kind.ts:16-24`

If LiteLLM begins logging a new minutes-priced ASR model (e.g. `voxtral-large-v2`) that doesn't include "whisper" or "realtime", the worker bills it as `reason_tokens` using `total_tokens` (which for ASR is `null`/`0`). Users get free transcription until the matcher is updated. The header comment acknowledges this is the "safe default" but it's a billing-correctness landmine.

**Fix direction:** add a known-model allowlist + log every fallback hit so operators see new aliases promptly.

---

### WR-07 — LOW / WARNING — `db/app-pool.ts:101-104` swallows `release()` error silently

Acceptable because release-after-release is a known pg-pool idempotency gap; `if (!client.released) client.release()` would be cleaner than try/catch.

---

### WR-08 — LOW / WARNING — `template-renderer.ts:75-81` uses `readFileSync` as existence probe and swallows non-ENOENT errors

```ts
try {
  const distLayout = resolve(here, "i18n", "locales");
  readFileSync(resolve(distLayout, "en", "email", "email_verification", "subject.txt"));
  return distLayout;
} catch {
  return resolve(here, "locales");
}
```

Use `existsSync`. The bare `catch` will silently fall back to the source-tree path on permission-denied / EIO — could hide real i18n bundle corruption in prod.

---

## Dead code

None found. Every exported job processor (`buildEmailDeliveryHandler`, `buildUsageRollupDispatcher`, `buildUsageRollupTenantHandler`, `buildReconciliationDailyCheckHandler`, `buildReconciliationDiscrepancyHandler`, `buildPartmanMaintenanceHandler`, `buildAuditArchiveHandler`, and `createWorker` for ingest) is registered in `index.ts:188-246`. Every exported queue handle in `queues.ts` is consumed by `index.ts` or by a job's `deps`. The `_resetDriftStoreForTest` / `_readDriftStoreForTest` / `_readBillingAnomalies` / `_resetBillingAnomalies` / `_buildIngestLog` exports are underscore-prefixed test seams explicitly justified in comments — out of scope for "dead" classification.

The transient `drainStaleVkrKeys` helper (`apps/worker/src/index.ts:127`) is one-shot dead-code-on-disk — the comment says "Safe to remove in a future phase once stragglers stop appearing." Track in `deferred-items.md` for cleanup.

## Suppressed warnings / type-suppressions

9 type-suppressions, all in `db/app-pool.ts` (lines 61, 70, 74, 78, 110, 121, 128, 136, 142) — see WR-02. Each carries a `// biome-ignore lint/suspicious/noExplicitAny:` directive with a one-line justification. No `@ts-ignore`, `@ts-nocheck`, or `@ts-expect-error` in scope.

No `eslint-disable` comments in scope.

## CLAUDE.md hard-rule-1 indicators

No signs of production code edited "to make tests pass." Comments throughout cite REVIEW IDs from prior phases (CR-7, CR-8, CR-9, CRIT-FIX-07, CRIT-FIX-08, HI-1..HI-4) documenting deliberate fixes responding to upstream review findings, not test-driven shortcuts. The `_buildIngestLog(destination)` seam is well-justified ("OTel API doesn't expose a public read on a Counter; tests verify via this mirror") and matches the project's `_for-test` underscore convention.

One exception worth noting: CR-03 (NODE_ENV branch in `email-delivery.ts`) is the kind of compromise that *looks* like a test-friendliness shortcut even though the in-file comment frames it as production-ergonomics. Worth verifying whether the LOCKER-01 lint allowlist exists for this file or whether the lint was bypassed.

## Severity tally

- **CRITICAL (BLOCKER):** 2 — CR-01, CR-02
- **HIGH (BLOCKER):** 7 — CR-03, CR-04, CR-05, CR-06, CR-07, CR-08, CR-09
- **MEDIUM (WARNING):** 6 — WR-01, WR-02, WR-03, WR-04, WR-05, WR-06
- **LOW (WARNING):** 2 — WR-07, WR-08

**Total:** 17 findings.

**Status: issues_found.** Publication-blocked on CR-01 / CR-02 (silent loss + rollup skew on a billing surface) and CR-03 (constitutional NODE_ENV violation in `apps/worker/src/jobs/email-delivery.ts`). The remaining HIGH items (CR-04..CR-09) are robustness gaps that an enterprise-grade self-host operator will hit under partial Valkey / pg / SMTP failure and should be fixed before 1000-concurrent-user load testing claims hold.
