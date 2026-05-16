# Phase 41.d — Worker HIGH cluster closure

**Status:** CLOSED (5 atomic commits)
**Subsystem:** apps/worker
**Closes:** HIGH-FIX-WORKER (review/worker.md HI-1, HI-2, HI-3, HI-4)
**Mode:** AUTONOMOUS — user offline; advisor-self for D-1, D-2, D-3 (see `41-d-DECISIONS.md`)

## Commits

| # | SHA | Subject |
|---|-----|---------|
| 1 | `0d63478` | feat(41d): worker uses shared redact pino factory (HI-1) |
| 2 | `44c9155` | feat(41d): reconciliation-daily-check batches user-to-tenant lookup (HI-2) |
| 3 | `b759232` | feat(41d): otel gauge observers read fresh drift store (HI-3) |
| 4 | `c45ad85` | feat(41d): validate minutes-priced model duration explicitly (HI-4) |
| 5 | (this commit) | docs(41d): summary worker HIGH cluster closed |

## Per-task evidence

### Task 1 — HI-1: bare pino() → shared redact factory

- **Files:** `apps/worker/src/index.ts`, `apps/worker/src/jobs/ingest-litellm-spend.ts`
- **Test:** RED-then-GREEN unit test "module logger redacts D-T4 secret-shaped keys via the shared makePino factory"
- **Wiring:** `index.ts` uses `makePino({ base: { service: "worker" } })`; `ingest-litellm-spend.ts` exports `_buildIngestLog` test seam + module-level `log = _buildIngestLog()` with base `{ service: "worker", component: "ingest-litellm-spend" }`.
- **Boot-pino kept bare:** `pinoBoot` above the BYOK guard intentionally remains a direct `pino` import because it runs BEFORE the observability package is safe to import (sync-stderr in BYOK-rejection path).
- **Verified:** OPENAI_API_KEY, password, authorization, token payload fields censored to `[REDACTED]` in emitted log line; non-secret `rid` field preserved.

### Task 2 — HI-2: reconciliation-daily-check batched user→tenant lookup

- **File:** `apps/worker/src/jobs/reconciliation-daily-check.ts`
- **Test:** RED-then-GREEN unit test "resolves user_id->tenant_id in a single batched query (not per-row)"
- **Mechanism:** Build `distinctEndUsers` array; issue ONE `SELECT id, tenant_id FROM users WHERE id = ANY($1::uuid[])`; populate in-memory `userToTenant: Map`. Outer aggregation iterates `litellmByTenant.keys()` (distinct tenants), not per-end_user.
- **Verified:** Test seeds 2 tenants × 3 users (6 rows); spy on `appOwnerPool.query` confirms exactly 1 user→tenant resolution query; `driftStore.size === 2` (tenant-level, not user-level).

### Task 3 — HI-3: OTel gauge atomic snapshot swap

- **File:** `apps/worker/src/jobs/reconciliation-daily-check.ts`
- **Test:** RED-then-GREEN unit test "gauge callbacks observe a consistent snapshot mid-handler (no clear-then-set race)"
- **Mechanism:** Build `nextDriftStore` as a LOCAL Map inside the handler; mutate module-level `driftStore` ONLY at the end via synchronous `clear()` + bulk-copy pair (no awaits between). Exporter callbacks firing during the for-loop observe the PREVIOUS tick's complete snapshot until the swap. Module-level `addCallback` guarded with `_gaugesRegistered` boolean to prevent re-import double-registration.
- **Fresh-read mechanism:** atomic snapshot swap (D-2 advisor decision — option (b) from review).
- **Verified:** RED — buggy code exposed tick-2 tenant B mid-mutation. GREEN — fixed code retains tick-1 tenant A complete state until swap.

### Task 4 — HI-4: minutes-priced model duration validation

- **File:** `apps/worker/src/jobs/ingest-litellm-spend.ts`
- **Tests (3 added):**
  1. "HI-4: skips minutes-priced rows with non-numeric duration and increments anomaly counter"
  2. "HI-4: accepts numeric durations on minutes-priced models (positive control)"
  3. "HI-4: token-priced models are unaffected by missing duration"
- **Mechanism:** New `validateDuration(metadata)` returns `number | null` (number if finite/positive, null otherwise). On null for minutes-priced kinds: warn-log + counter increment + `continue` (skip insert). Legacy silent-coerce-to-0 `extractDuration` deleted.
- **Counter name:** `worker_billing_anomalies_total{reason="non_numeric_duration"}`
- **Decision D-1 (skip vs NULL):** SKIP. `usage_ledger.units` is `integer NOT NULL`; matches existing `missing end_user` / `missing tenant` skip pattern at the same call-site. Counter + reconciliation drift surfaces the anomaly to operators.
- **Test seam:** `_readBillingAnomalies` + `_resetBillingAnomalies` exported (OTel Counter has no public read API).

## Metrics

- **Test count delta:** ingest-litellm-spend +4 (3 HI-4 + 1 HI-1); reconciliation-daily-check +2 (1 HI-2 + 1 HI-3). Total **+6 tests**, all GREEN.
- **Pre-existing pass count:** worker project 174 → **180 passed | 7 skipped (testcontainer-gated)**.
- **Coverage on diff** (apps/worker/src/jobs/ingest-litellm-spend.ts + reconciliation-daily-check.ts):
  - Statements 97.33% ✓ ≥ 90
  - Branches 92.59% ✓ ≥ 90
  - Functions 100% ✓ ≥ 90
  - Lines 100% ✓ ≥ 90
- **`pnpm lint:lockers` exit code:** 0 (no new violations across the 7 lockers).
- **Allowlist entries removed:** 0 (none of the 4 fixed sites had `lint-no-suppressions` entries; the 14 entries for these files in `lint-prod-readiness.allowlist.txt` are Phase-38 dead-export debt unrelated to this phase's surface).

## Self-check

- [x] Each cited commit SHA exists on HEAD: confirmed via `git log --oneline -5`.
- [x] Worker test suite GREEN post-final-commit (180 passed, 7 testcontainer-skipped).
- [x] Diff coverage ≥ 90/90/90/90 on all 4 axes.
- [x] `pnpm lint:lockers` exits 0.
- [x] No production-code edits made solely to make tests pass (Rule 1 honored).
- [x] No new suppressions, no `as any`, no env-branches, no hardcodes added (LOCKER-01..06 clean).

## Self-Check: PASSED

## Stub scan

No new stubs introduced. The `_readBillingAnomalies` and `_resetBillingAnomalies` exports are test seams (underscore-prefixed) mirroring the existing `_resetDriftStoreForTest` pattern — not stubs.

## Threat surface scan

No new auth paths, network endpoints, file access patterns, or trust boundaries introduced. All changes are internal worker-job semantics with strict subset of pre-existing behaviour (skip-with-counter replaces silent-zero-bill).
