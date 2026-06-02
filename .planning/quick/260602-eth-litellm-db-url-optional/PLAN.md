---
quick_id: 260602-eth
slug: litellm-db-url-optional
date: 2026-06-02
status: in-progress
---

# Quick Task: make LITELLM_DATABASE_URL optional (worker boots without it)

Blocker #3 of 3 upstream managed-Postgres / external-LiteLLM deploy fixes
(see memory `project_managed_pg_upstream_blockers`). On a corporate self-host
with an EXTERNAL LiteLLM gateway, the worker must NOT connect to LiteLLM's own
DB — cross-service DB access is a deploy-policy violation, and spend is already
metered gateway-side per virtual-key. Today `makeLitellmPool()` throws when
`LITELLM_(READ_)DATABASE_URL` is unset, so the worker can't boot at all.

## Design (decided with user)

1. **worker-config.ts** — add `spendReconciliationEnabled: boolean` to
   `WorkerConfig`. TRUE iff `SPEND_RECONCILIATION_ENABLED` is truthy
   (`envFlag`) AND a LiteLLM DB URL is present
   (`LITELLM_READ_DATABASE_URL` ?? `LITELLM_DATABASE_URL`). Auto-FALSE when no
   DB URL even if the flag is on. Default false. JSDoc mirrors the
   `allowSmtpFallback` precedent.

2. **scheduler.ts** — add `reconciliationEnabled?: boolean` to
   `SchedulerConfig` (default true → preserves existing behaviour/tests). Gate
   the `reconciliation-daily-check` `upsertJobScheduler` on it. usage-rollup +
   partman schedulers ALWAYS install.

3. **index.ts** `main()` — only `makeLitellmPool()` when
   `spendReconciliationEnabled`. When disabled: no litellmPool, no
   ingestQueue/ensureIngestScheduler, no ingest/reconciliation-check/
   reconciliation-discrepancy workers. email/rollup*/partman/auditArchive stay
   always-on. `workers` + shutdown `pools` arrays include litellm-dependent
   entries only when enabled. Pass `reconciliationEnabled` to installSchedulers.
   Log the resolved mode at startup.

## Tests (TDD, RED first)

- `worker-config` unit: 4-case precedence (both→true; flag w/o DB→false;
  DB w/o flag→false; neither→false). Plus `envFlag` "1"/"true" parity already
  covered.
- `scheduler` unit: `reconciliationEnabled:false` → reconciliation scheduler
  NOT upserted, usage-rollup + partman ARE. Default (omitted) → all three.
- `index.ts` wiring unit (extend existing worker wiring test, boundary-mocked):
  disabled → `makeLitellmPool` NOT called, ingest/reconciliation Workers NOT
  constructed, reconciliation scheduler NOT upserted, worker still boots;
  enabled → current behaviour preserved.

## Acceptance

LITELLM_DATABASE_URL unset + flag unset → worker boots, all other jobs work,
`makeLitellmPool` never called, no LiteLLM-DB connect under any settings. Both
set → ingest + reconciliation run as before.

## Out of scope

Blockers #1 (audit/partman) and #2 (claim-driven RLS) — separate tasks.
No push / no release.
