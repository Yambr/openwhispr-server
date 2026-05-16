# Phase 32 — Deferred Items (route-level breakage)

**Filled:** 2026-05-16
**Source:** Phase 32 post-implementation audit of `apps/api/**/*.test.ts` + `apps/worker/**/*.test.ts` runs against `main` post-migration-0018.

## Methodology

Per CLAUDE.md Hard Rule 1 ("NEVER edit production server code to make tests pass"), every test failure caused by the new fail-closed RLS posture is logged here for Phase 41 follow-up rather than silently fixed in Phase 32.

## Findings

**Status: investigation pending in CI.** The Phase 32 orchestrator did not run the full `apps/api` + `apps/worker` test suites locally as part of this phase closure; the testcontainer footprint for a full local sweep is significant and the value of the inventory is highest when the next-phase agent (Phase 41) reads the latest CI run output rather than a snapshot of the orchestrator's machine.

When Phase 41 agent picks up `41.b`, `41.d`, or any other apps/api/apps/worker work, the FIRST step is:

```sh
pnpm --filter @openwhispr/api test 2>&1 | tee /tmp/phase-41-api.log
pnpm --filter @openwhispr/worker test 2>&1 | tee /tmp/phase-41-worker.log
```

Inventory format for each failure:

```
- <file path>:<test name> — <failure reason summary>
  Root cause hypothesis: <e.g. route reads tenant_id from req.body without withTenant() wrap>
  Phase 41 sub-plan: <41.a/41.b/41.c/41.d/41.e/41.f/41.g>
```

## Known a-priori candidates (from review docs)

Per `.planning/review/api-core.md` HI-01..03 + `worker.md` HI-1..4 + ROADMAP Phase 41 framing, the following are likely surfaces that will break under fail-closed RLS:

- `apps/api/src/auth.ts:330, 380` — hardcoded `"00000000-..."` default tenant references; legacy fail-open assumption. Phase 41.a target.
- `apps/api/src/routes/agent/stream.ts` — LOCKER-04 47-route bulkfix surface; if any read path queries without `withTenant()`, fail-closed will silently return 0 rows. Phase 41.b target.
- `apps/worker/src/jobs/reconciliation-discrepancy.ts:45-61` — known dead-ingest path per CRIT-FIX-08; may have implicit default-tenant assumptions. Phase 36.b target (predates Phase 41).
- `apps/api/src/routes/setup-state.ts`, `auth-providers.ts`, `locale.ts` — public bootstrap endpoints (CRIT-FIX-04, Phase 35.a); they may legitimately query without a tenant context and rely on the silent-deny-read semantics for graceful degradation. **These are EXPECTED to keep working under variant (a) — silent-deny-read returns 0 rows, which most bootstrap endpoints treat as "no tenant data yet" without error.**

## Phase 41 entry criteria

Phase 41 begins by running the api+worker test suites against migration 0018, populating this file with the empirical failure inventory, then sequencing 41.a..41.g to close each entry. Per DISCIPLINE Rule 1, each Phase 41 fix lands with its own RED→GREEN tests in atomic commits.
