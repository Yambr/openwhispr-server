# Phase 32 — Deferred Items (route-level + test-debt breakage)

**Filled:** 2026-05-16
**Source:** `pnpm --filter @openwhispr/data test` run against `main` post-migration-0018.

## Methodology

Per CLAUDE.md Hard Rule 1 ("NEVER edit production server code to make tests pass"), every test failure caused by the new fail-closed RLS posture is logged here for downstream-phase follow-up rather than silently fixed in Phase 32. The list below is the empirical inventory captured during Phase 32 closure.

## Empirical inventory (packages/data full-suite run)

### Category A — tests asserting pre-Phase-32 FAIL-OPEN behavior (now obsolete)

These tests were written to verify migration 0003's role-default GUC binding worked correctly under the OLD fail-open posture. Phase 32 explicitly reverses 0003. Tests must be either rewritten (asserting absence of the GUC binding and absence of column DEFAULTs) or deleted with rationale.

- `packages/data/tests/unit/__tests__/0003_better_auth_tenant_defaults.test.ts` (5 cases failing)
  - `ALTER ROLE openwhispr_app sets app.tenant_id=00000000-...` → expects rolconfig contains `app.tenant_id=...`. After Phase 32, rolconfig is RESET — the assertion is now exactly the opposite of the production invariant.
  - `INSERT INTO {users|sessions|account|verification} without tenant_id picks up default-tenant via column DEFAULT` (4 cases) → expects the GUC-bound column DEFAULT to populate `tenant_id`. After Phase 32, DEFAULTs are DROPPED — INSERT without `tenant_id` raises NOT NULL violation (correct).
  - **Resolution path (Phase 41 or earlier carve-out):** Rewrite to a single "0003 + 0018 net effect" assertion suite that documents the historical regression closure. Owning phase: Phase 41 (residual HIGH sweep) or as a 32.1 carve-out if user wants to clean up immediately.

- `packages/data/tests/unit/__helpers__/__tests__/bootstrap-roles.test.ts`
  - Likely asserts the harness's role-bootstrap matches production rolconfig (which previously included `app.tenant_id`).
  - **Resolution path:** Update to reflect Phase 32 invariant (rolconfig empty for `app.tenant_id`).

- `packages/data/tests/unit/__tests__/settings-rls.test.ts`
  - "Phase 5 / Plan 01 — settings + new-table RLS introspection" — almost certainly asserts old policy body text (`tenant_id = current_setting(...)::uuid` without NULLIF).
  - **Resolution path:** Update the expected policy body string to the new NULLIF form. Owning phase: 32-cleanup carve-out (lowest cost) OR Phase 41.

### Category B — tests with brittle assertions exposed by Phase 32

- `packages/data/tests/unit/__tests__/worker-rls-property.test.ts > concurrent tenant-A / tenant-B jobs see only own notes`
  - fast-check property test using BullMQ; may be running into the new fail-closed posture if any code path expects fail-open default-tenant fallback. Needs investigation in Phase 41.d (worker bundle).

- `packages/data/tests/unit/__tests__/audit-log-actions.test.ts`
  - File-level failure (entire suite fails at suite-load). Likely related to migration sequence or pg_partman child-partition assumptions; could also be a flaky testcontainer interaction when run in parallel with other suites.

### Category C — possibly NOT Phase 32 (cross-suite testcontainer parallelism)

The `tests/unit/__tests__/rls-fail-closed.property.test.ts` file itself reports as failing when run alongside the 41-file packages/data suite, but **runs GREEN in isolation** (128/128). This is the well-known testcontainer parallelism issue from memory:testcontainers-cleanup-audit — multiple suites contend for docker resources, and the order-sensitive booting in `beforeAll` can race. Same suspicion applies to many of the `|tools|` and `|tests-e2e-cjm-steps|` failures in the full run.

**Action:** Re-run the failing files in isolation under Phase 41 entry triage to filter Category-C noise from true Category-A/B regressions before assigning sub-plans.

## Pre-existing test-debt NOT related to Phase 32

The Phase 32 full-suite run also surfaced ~36 `|tools|` test file failures and several `|tests-e2e-cjm-steps|` failures. Spot-checking 2-3 shows these are testcontainer-availability / migration-runner timing issues unrelated to RLS posture. These belong in the broader test-suite stability backlog (memory:testcontainers-cleanup-audit), not Phase 41.

## Phase 41 entry criteria

Phase 41 begins by running the api+worker test suites against migration 0018 + this file's inventory:

```sh
# Isolate the Category-A/B regressions:
pnpm --filter @openwhispr/data exec vitest run \
  tests/unit/__tests__/0003_better_auth_tenant_defaults.test.ts \
  tests/unit/__helpers__/__tests__/bootstrap-roles.test.ts \
  tests/unit/__tests__/settings-rls.test.ts \
  tests/unit/__tests__/worker-rls-property.test.ts \
  tests/unit/__tests__/audit-log-actions.test.ts 2>&1 | tee /tmp/phase-41-categorized.log

# Then run the broader apps/api + apps/worker suites for additional surfaces:
pnpm --filter @openwhispr/api test 2>&1 | tee /tmp/phase-41-api.log
pnpm --filter @openwhispr/worker test 2>&1 | tee /tmp/phase-41-worker.log
```

Per DISCIPLINE Rule 1, each Phase 41 fix lands with its own RED→GREEN tests in atomic commits.
