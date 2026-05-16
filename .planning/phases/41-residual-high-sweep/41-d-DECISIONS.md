# Phase 41.d — Decisions log (advisor-self / user offline)

## D-1 — Task 4: SKIP vs NULL on non-numeric duration

**Context:** `ingest-litellm-spend.ts` minutes-priced model row arrives with `metadata.duration` non-numeric (string, missing, wrong type). Current behavior: silently insert `usage_ledger` row with `units=0`. Question: replace with SKIP (no insert) or INSERT-with-NULL units?

**Decision:** **SKIP + warn-log + counter increment.**

**Why:**
- Mirrors the two established skip paths at the same call-site:
  - `:204-206` — missing `end_user` → `log.warn(... skipping)`, `continue`.
  - `:214-216` — missing tenant → `log.warn(... skipping)`, `continue`.
- `usage_ledger.units` is declared `integer NOT NULL` in the schema (Phase 03 Plan 08 test fixtures + production migrations consistent on this point). INSERT-with-NULL is a schema violation; the only NULL-tolerant option would be a schema migration — out of scope for a HIGH sweep.
- "Silent zero-bill is worse than an explicit skip + alert" is the review's own framing (HI-4 fix paragraph).
- The discrepancy is now observable via `worker_billing_anomalies_total{reason="non_numeric_duration"}` — operators can alert; a daily reconciliation tick will surface the missing row as drift; the existing reconciliation-discrepancy backfill pathway can resolve it once upstream metadata is corrected.

## D-2 — Task 3: Getter vs thunk vs snapshot-swap for OTel gauge fresh-read

**Context:** Module-level `driftStore: Map` is captured by gauge callbacks at module-load. Handler mutates it in-place (clear + populate). Between `driftStore.clear()` at handler start and the per-tenant `set()` calls, OTel exporter callbacks observing on the 15s tick see partial / stale state. Review options: (a) clear at end-of-handler not start; (b) build snapshot map locally and atomically swap into `driftStore` at end; (c) registered-flag to prevent double-add.

**Decision:** **Option (b) — atomic snapshot swap.**

**Why:**
- The project's existing pattern is dependency-injection-via-closure (see `with-system-context.ts`, `withSystemContext`, `buildReconciliationDailyCheckHandler`). The handler builds local state and the surrounding shell holds the persistent reference. A snapshot-swap inside the handler is the minimum-invasive variant of that pattern.
- Per-tick atomicity: build `nextDriftStore = new Map(...)` populated entirely inside the handler, then `driftStore.clear(); for (const [k, v] of nextDriftStore) driftStore.set(k, v);` at the very end. Exporter observers either see the previous tick's complete snapshot (callback fires before swap) or the new tick's complete snapshot (after swap) — never a partial state.
- A getter-thunk (`() => driftStore`) does NOT solve the problem — callbacks would still observe a mid-mutation Map. The atomicity is what matters.
- Double-register-on-reimport is closed by guarding the module-level `addCallback` calls with a boolean flag (`_gaugesRegistered`).

## D-3 — Task 2: Loop bound — single distinct-tenant pass

**Context:** `reconciliation-daily-check.ts:137-149` iterates per litellm row (grouped by `end_user`), issuing an awaited `SELECT tenant_id FROM users WHERE id=$1` per iteration. Comment claims "bounded by tenant count" — wrong. Fix: one batched `ANY($1::uuid[])` query to build an in-memory `user_id → tenant_id` map, then iterate.

**Decision:** **Batched single-query user→tenant map, then aggregate.**

The OUTER loop after the batched fetch iterates over the resulting in-memory `litellmByTenant` Map keys (i.e., the distinct tenants). The user's spec — "2 tenant-level iterations, not 6 user-level" — is the natural shape of the post-aggregation loop already, once the per-row tenant lookup is replaced with a batched fetch.
