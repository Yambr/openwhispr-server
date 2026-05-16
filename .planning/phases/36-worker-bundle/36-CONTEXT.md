# Phase 36: worker bundle (CR-5 + CR-6) — Context

**Source:** ROADMAP Phase 36 + `.planning/review/worker.md` CR-01, CR-02

Two independent sub-plans (36.a + 36.b). Each its own RED→GREEN atomic commit pair. ≥ 90/90/90/90 coverage per diff.

## 36.a — DATABASE_URL out of bash (CR-5 / CRIT-FIX-07)

File: `apps/worker/src/jobs/audit-archive.ts:96-128`.

**Current bug:** `spawn('bash', ['-c', script])` where `script` is template literal interpolating `dbUrl` and `bucket`. Password lands in `ps aux` + BullMQ `failedReason` + Grafana/Loki on failure.

**Fix:** Node-side `spawn` pipeline. Replace `bash -c "<script>"` with separate spawns:
1. `spawn('pg_dump', ['--table=public.' + partition, '--data-only'])` with env `{ PGPASSWORD, PGHOST, PGUSER, PGDATABASE }` parsed from URL ONCE
2. Pipe its stdout to a Node `zlib.createGzip()` Transform stream
3. Pipe gzip output to `spawn('mc', ['pipe', `minio/${bucket}/audit-archive/${partition}.sql.gz`])` stdin (or `aws s3 cp - s3://...`)
4. Wait for all three exits. If any non-zero, throw redacted error.

Partition name regex validation preserved (defence-in-depth).

**RED test:** inject pg_dump failure (mock spawn to exit 1 with stderr containing fake DB URL); assert thrown error's `.message`, `.stack`, `.cause.stderr` do NOT contain the URL/password substring. Assert worker `failedReason` (if surfaced via BullMQ test fixture) is similarly clean.

**LOCKER-06 flip:** Plan 31 shipped `lint-shell-credential-interpolation` in WARN-only mode with audit-archive.ts:106,115,127 in the allowlist. After 36.a lands, REMOVE those 3 lines from the allowlist + drop `--warn-only` from `package.json lint:shell-credential-interpolation` → BLOCKING. Document in atomic commit per Phase 31 LOCKER-06 contract.

## 36.b — reconciliation-discrepancy truth-telling (CR-6 / CRIT-FIX-08)

File: `apps/worker/src/jobs/reconciliation-discrepancy.ts:45-61`.

**Current bug:** Handler ignores `since/until/tenant_id` payload (admitted in comment). `as unknown as` cast claims Promise<{rowsProcessed, rowsScanned}> but inner `runIngestOnce` returns Promise<void>. Caller destructure → TypeError.

**Decision:** Option A (implement properly) OR Option B (delete).

Recommend **Option A** because:
- The job's name suggests it should DO discrepancy reconciliation, not be a watermark passthrough
- Caller exists somewhere (otherwise it would be deleted by Phase 38 dead-export sweep)

**Option A approach:**
1. Read `payload.since`, `payload.until`, `payload.tenant_id`
2. Extend `runIngestOnce(deps.ingestDeps)` signature: `runIngestOnce(deps, { since?, until?, tenantId? })` — when window args present, query a different SQL path (explicit-window backfill instead of watermark-based)
3. Return real `{ rowsProcessed, rowsScanned }` counts from the ingest path
4. Remove the `as unknown as` cast — handler return type matches signature

**Decision branch:** If `runIngestOnce` cannot be extended without massive refactor, fall back to Option B (delete the handler + its BullMQ registration) and document why in 36-DECISIONS.md.

**RED test:** seed a discrepancy fixture; enqueue job with `{since, until, tenant_id}`; assert awaited result destructures cleanly into `{rowsProcessed, rowsScanned}` with non-zero counts matching fixture.

## Scope (out)

- BullMQ infrastructure refactor.
- Phase 41 worker-side HIGH-FIX-WORKER (bare pino, daily-check loops, OTel gauge stale closures).
- Audit-archive's other lines that aren't credential-interpolation.
