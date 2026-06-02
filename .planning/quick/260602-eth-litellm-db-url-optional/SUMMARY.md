---
quick_id: 260602-eth
slug: litellm-db-url-optional
date: 2026-06-02
status: complete
---

# Summary: make LITELLM_DATABASE_URL optional (worker boots without it)

Blocker #3 of 3 upstream managed-Postgres / external-LiteLLM deploy fixes
(peer gr0flvsr, verified on v1.0.19).

## Problem

`apps/worker/src/index.ts` called `makeLitellmPool()` unconditionally at boot;
`makeLitellmPool` throws when neither `LITELLM_READ_DATABASE_URL` nor
`LITELLM_DATABASE_URL` is set. On a corporate self-host pointed at an EXTERNAL
LiteLLM gateway, the worker therefore could not boot — and reaching into the
gateway's own database (the only use of `litellmPool`, by the spend-
reconciliation jobs) is a cross-service deploy-policy violation. Spend is
metered gateway-side per virtual-key, so reconciliation is genuinely optional.

## Change

- **worker-config.ts** — `WorkerConfig.spendReconciliationEnabled`. TRUE iff
  `SPEND_RECONCILIATION_ENABLED` is truthy AND a LiteLLM DB URL is present
  (`LITELLM_READ_DATABASE_URL` ?? `LITELLM_DATABASE_URL`; empty-string →
  absent). Auto-FALSE with no DB URL even if the flag is on. Default OFF.
- **index.ts** `main()` — `litellmPool` is `Pool | null`, constructed only when
  enabled. The ingest queue + scheduler and the ingest / reconciliation-check /
  reconciliation-discrepancy workers are built only inside the `if (litellmPool)`
  branch. `workers` + shutdown `pools` arrays and the (now-nullable) ingest
  queue only carry LiteLLM-dependent entries when enabled. Startup log records
  the mode. Email / usage-rollup×2 / partman / audit-archive stay always-on.
- **scheduler.ts** — `SchedulerConfig.reconciliationEnabled` (default true,
  defaulted in `installSchedulers` rather than in the test-locked cron-only
  `DEFAULT_SCHEDULER_CONFIG`) gates the reconciliation-daily-check cron;
  usage-rollup + partman always install.
- **shutdown.ts** — `ingestQueue: AsyncCloseable | null`; the ingest-queue
  drain step is skipped when null.
- **.env.full.example** — documents `SPEND_RECONCILIATION_ENABLED`.

## Verification (own eyes)

- worker `typecheck` exit 0; worker `build` success.
- Full worker unit suite: **342 files / 4018 passed, 0 failed**, 200 pre-existing
  testcontainer skips.
- Diff coverage on the 3 changed src files: **100 / 100 / 100 / 100**.
- LOCKER no-env-branches / no-hardcode / no-suppressions / prod-readiness:
  clean on changed files.

## Acceptance

- `LITELLM_DATABASE_URL` unset + flag unset → worker boots, all other jobs run,
  `makeLitellmPool` never called, no LiteLLM-DB connect under any settings. ✓
- Both set → ingest + reconciliation run as before (gating defaults preserve it). ✓

## Out of scope / next

Blockers #1 (audit/partman fallback) and #2 (claim-driven `app.bypass` RLS) are
separate tasks. No push / no release here — release handled after all three.
