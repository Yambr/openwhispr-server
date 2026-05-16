# Re-Review: worker (apps/worker) — v2.2 milestone close audit

**Branch:** `main` @ `b830cc44b65f56ebdc2ebacd789e93df481788d8`
**Scope:** `apps/worker/src/**`
**Previous review:** `.planning/review/worker.md` @ 1832f28
**Reviewed:** 2026-05-16

## Summary

- Files: 14 TS + 1 i18n renderer + 18 template files
- Findings: **BLOCKER=0 WARNING=4**
- Closure rate vs predecessor: **9 of 13 closed**

## Closure delta

| Prev ID | Prev sev | Status | Evidence |
|---|---|---|---|
| CR-1 audit-archive shell-injects | CRITICAL | CLOSED | argv-array spawn, PG* env, redactSecret on stderr |
| CR-2 reconciliation-discrepancy lie/no-op | CRITICAL | CLOSED | RunIngestOptions windowed, watermark gated, real rowsProcessed/Scanned |
| HI-1 bare-pino bypassing redact | HIGH | CLOSED | makePino everywhere except pre-OTel boot logger (justified) |
| HI-2 N-per-end_user serialized lookups | HIGH | CLOSED | Single `WHERE id = ANY($1::uuid[])` round-trip |
| HI-3 driftStore stale/double-registration | HIGH | CLOSED | _gaugesRegistered flag, local nextDriftStore, sync swap |
| HI-4 extractDuration silent zero-bill | HIGH | CLOSED | validateDuration null → skip + warn + counter |
| HI-5 shutdown exits 0 on partial failure | HIGH | OPEN | WR-1 |
| HI-6 IORedis no TLS / port validation | HIGH | OPEN | WR-2 |
| MED-1 worker own pino | MED | CLOSED | folded into HI-1 |
| MED-2 partman re-enqueues archived | MED | OPEN | WR-3 |
| MED-3 daily-check gauge race | MED | CLOSED | folded into HI-3 |
| MED-4 extractDuration unexported / whisper hardcode | MED | PARTIAL | WR-4 |
| LOW-1..3 | LOW | OPEN | operationally tolerable, not raised |

## Findings

### WR-1 — graceful shutdown exits 0 on Worker.close() failure
- File: `apps/worker/src/index.ts:262-278`
- Fix: inspect `Promise.allSettled` results, log rejections, add 30s watchdog `setTimeout(... 1)`, exit 1 on any failure.

### WR-2 — IORedis no TLS / port validation / connectTimeout
- File: `apps/worker/src/index.ts:158-163`
- Fix: hoist to shared `makeQueueRedis(env)` with port zod-validated, `VALKEY_TLS=1`, `connectTimeout: 10_000`.

### WR-3 — partman-maintenance re-enqueues archived partitions in DRY_RUN mode
- File: `apps/worker/src/jobs/partman-maintenance.ts:42-78`
- Fix: stamp `COMMENT ON TABLE archived=<iso>` after successful archive (even dry-run); skip on rediscovery.

### WR-4 — inferKind dead branch + silent reason_tokens fallback
- File: `apps/worker/src/lib/infer-kind.ts:17-23`
- Fix: drive `kind` from `r.metadata?.kind` first; counter `worker_kind_inference_fallback_total` when substring heuristic fires; delete dead `model === "whisper-large-v3"` equality.

## Re-audit by category — abbreviated
- Security / LOCKER-06: CR-1 closed; no `bash -c` remains; PGPASSWORD via env not argv.
- LOCKER-01: 1 carved-out NODE_ENV (email-delivery.ts:95 — documented).
- LOCKER-02: only single `as <T>` casts (constitutional-compliant).
- LOCKER-03: only `"valkey"` host default (docker-compose internal).
- Tenant context: every job wrapped in `with{System,Tenant}Context`.
- Idempotency: ingest ON CONFLICT, rollup ON CONFLICT, partman internal idempotency.

## Verdict

No BLOCKERs. Two prior HIGHs (HI-5/HI-6) carried into WARNING tier; recommended for v2.3.
