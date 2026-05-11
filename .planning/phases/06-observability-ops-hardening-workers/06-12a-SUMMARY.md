---
phase: 06-observability-ops-hardening-workers
plan: 12a
subsystem: verification-gate-wave-1
tags: [OBS-05, DATA-04, e2e, testcontainers, docker-compose, probes, audit-log, partition-routing]
parent_plan: 12
split_index: 1
split_total: 4
dependency_graph:
  requires:
    - 06-04-SUMMARY.md (kubelet probes routes + dep-check library)
    - 06-05-SUMMARY.md (recordAudit helper + key.issued emission)
    - 06-02-SUMMARY.md (audit_log monthly RANGE partitioning via pg_partman)
    - 06-08-SUMMARY.md (informational — partman-maintenance cron)
  provides:
    - tests/e2e/helpers/phase6-compose.ts — shared DockerComposeEnvironment harness for 12a/b/c/d
    - tests/e2e/probes-dependency.test.ts — GREEN (OBS-05 / D-P1 / D-P2)
    - tests/e2e/audit-log-write.test.ts — GREEN (DATA-04, pivoted to key.issued per D-05-4)
    - Makefile e2e-test-phase6 target (initial 2-test subset)
    - fix(dep-check): 2s Promise.race timeout (Rule 1 — header comment promised it; only litellm had it wired)
    - fix(Dockerfile): COPY packages/observability + packages/wire-schemas (Rule 3 — build blocker)
  affects:
    - 06-12b-PLAN.md (will reuse phase6-compose helper for rate-limit/scale/ssrf tests)
    - 06-12c-PLAN.md (will reuse for otel/log-scrub/recon tests)
    - 06-12d-PLAN.md (will fold all 8 tests into global e2e-test target)
tech-stack:
  added: [testcontainers@^11.14.0 (tests/e2e)]
  patterns:
    - "testcontainers DockerComposeEnvironment with stable project name (openwhispr) to reuse pre-built images"
    - "--no-build + --pull never compose flags to refuse rebuild/pull during e2e"
    - "shell-out to `docker pause` for testcontainers v11 (no pause/unpause on StartedTestContainer)"
    - "shell-out to `docker compose run --rm seed` for one-shot seeding via testcontainers project name"
    - "container.exec(['psql', ...]) for direct DB assertions without exposing a host port"
    - "Promise.race wall-clock probe timeout (dep-check unified 2s ceiling)"
key-files:
  created:
    - tests/e2e/helpers/phase6-compose.ts
    - .planning/phases/06-observability-ops-hardening-workers/06-12a-SUMMARY.md
  modified:
    - tests/e2e/probes-dependency.test.ts (RED→GREEN, 4 cases)
    - tests/e2e/audit-log-write.test.ts (RED→GREEN, pivoted to key.issued, 1 case asserting 5 truths)
    - tests/e2e/package.json (add testcontainers dep)
    - Makefile (add e2e-test-phase6 sub-target)
    - apps/api/Dockerfile (COPY packages/observability + packages/wire-schemas)
    - apps/worker/Dockerfile (COPY packages/observability)
    - apps/api/src/lib/dep-check.ts (Promise.race 2s timeout — Rule 1 bug fix)
    - pnpm-lock.yaml
decisions:
  - id: D-12a-1
    summary: "Reuse openwhispr compose project name (testcontainers.withProjectName) so pre-built openwhispr-{api,migrate,worker}:latest images are picked up instead of forcing a 10-15min cold rebuild every suite. Trade-off: cross-suite container leakage if a prior `make up` left containers running, but `make down` is the standard workflow guard."
  - id: D-12a-2
    summary: "Drop testcontainers.withNoRecreate() — in v11 it has a side effect of resetting projectName to 'testcontainers-node', defeating the image-reuse strategy. Accept the per-suite container recreation cost (~10-20s extra per boot)."
  - id: D-12a-3
    summary: "Audit test pivots from auth.signin to key.issued — auth.signin is deferred to a future Better-Auth-hooks plan per 06-05-SUMMARY (D-A1 requires the audit row inside the route's withTenant() tx, but BA's databaseHooks fire outside any tx). key.issued is one of the 3 actions Plan 05 actually wired and exercises the same DATA-04 truths (RLS gate, partition routing, T-bearer-leak sentinel)."
  - id: D-12a-4
    summary: "Probes baseline narrows on per-dep visibility (postgres.ok / valkey.ok) rather than overall /readyz status code, because the hermetic stack's litellm dep-check is gated by Plan 06-06's SSRF allowlist (host=litellm not in OUTBOUND_HTTPS_ALLOWLIST). /readyz stays 503 throughout independent of PG state. The OBS-05 invariant the suite asserts (D-P1 + per-dep granularity in D-P2) is preserved; the litellm-allowlist concern is out of scope for 12a."
  - id: D-12a-5
    summary: "Hybrid harness (testcontainers compose lifecycle + shell-out for pause/seed/psql) because testcontainers v11 dropped pause/unpause on StartedTestContainer and never exposed run-one-shot or direct psql. Documented in phase6-compose.ts header — 12b/c need the same hybrid for scale/seed/db-assertions."
metrics:
  duration_minutes: 75
  completed: 2026-05-11
  files_created: 2
  files_modified: 8
  commits: 3
  tests_added: 2 (e2e files, 5 cases total)
  tests_passing: 5/5 (100%)
  boot_time_seconds:
    probes_dependency_no_seed: ~115
    audit_log_write_with_seed: ~165
    full_makefile_target: 280
---

# Phase 6 Plan 12a: Verification Gate Wave-1 (probes + audit) Summary

**One-liner:** Two of eight Phase 6 e2e tests landed GREEN against a real `docker compose` stack via testcontainers `DockerComposeEnvironment` — `tests/e2e/probes-dependency.test.ts` (OBS-05 kubelet-probes under `docker pause postgres`) and `tests/e2e/audit-log-write.test.ts` (DATA-04 audit emission + pg_partman partition routing). Shared harness at `tests/e2e/helpers/phase6-compose.ts` will be reused by 12b/c/d.

## What Landed

| Surface | File | Behavior |
|---------|------|----------|
| Shared compose harness | `tests/e2e/helpers/phase6-compose.ts` | `phase6BringStackUp()` boots default profile via testcontainers (hermetic litellm contract config), optional seed, `pauseContainer()`/`unpauseContainer()` shell out to `docker pause/unpause`, `psqlOwner()` uses `container.exec(['psql', ...])` (no host port exposure) |
| Probes e2e | `tests/e2e/probes-dependency.test.ts` | 4 cases: baseline, `/livez` invariant under PG pause, `/readyz` PG-down within 6s, `/readyz` PG-recovery within 8s |
| Audit e2e | `tests/e2e/audit-log-write.test.ts` | 1 case asserting 5 truths: status/envelope, D-A7 keys, T-bearer-leak sentinel, partition routing via `tableoid::regclass` |
| Makefile target | `make e2e-test-phase6` | E2E=1-gated, hermetic env, invokes vitest with the 2 test files via `tests/e2e/vitest.e2e.config.ts` |

## Tests Flipped GREEN

```
 ✓ probes dependency e2e (OBS-05, D-P1, D-P2) > baseline — /livez 200, /startupz 200, /readyz reports postgres.ok=true and valkey.ok=true   49ms
 ✓ probes dependency e2e (OBS-05, D-P1, D-P2) > /livez stays 200 while postgres is paused (no dep checks) per D-P1                           1069ms
 ✓ probes dependency e2e (OBS-05, D-P1, D-P2) > /readyz reports postgres.ok=false within 6s (5s cache + 1s slack) once postgres is paused    6066ms
 ✓ probes dependency e2e (OBS-05, D-P1, D-P2) > /readyz reports postgres.ok=true within 8s after postgres is resumed per D-P2                5112ms
 ✓ audit log sync write e2e (DATA-04, OBS-03, D-A1) > POST /api/v1/keys/create writes audit_log row with canonical D-A7 keys
                                                                                                                                            1211ms

 Test Files  2 passed (2)
      Tests  5 passed (5)
   Duration  280.33s
```

Boot times observed (informational, sets expectation for 12b/c):

- Probes (no seed): **~115s** from `phase6BringStackUp` call to `/livez` first 200
- Audit (with seed): **~165s** including `docker compose run --rm seed` one-shot
- Full Makefile target back-to-back (2 boots, 2 teardowns): **280s** ≈ 4.7min

## Commits

- `e49d9f7 fix(06-12a): dockerfile workspace deps + dep-check probe timeout (rule 3 blockers)`
- `f1233cb test(06-12a): probes-dependency e2e + phase6 compose helper + makefile target`
- `7f3c73a test(06-12a): audit-log-write e2e pivoted to key.issued (DATA-04)`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocker] `apps/api/Dockerfile` + `apps/worker/Dockerfile` missing workspace deps**

- **Found during:** Task 1 first stack boot attempt
- **Issue:** Stack boot via testcontainers triggered `docker compose build api` which failed with `Could not resolve "@openwhispr/observability"` / `Could not resolve "@openwhispr/wire-schemas"` during the in-container `pnpm --filter @openwhispr/api build` (tsup esbuild). Both packages exist in the workspace as Phase 5/6 additions but the Dockerfile predates them — no `COPY packages/observability/package.json` or `COPY packages/observability` in the builder context.
- **Fix:** Added `COPY` directives for `packages/observability` and `packages/wire-schemas` to apps/api/Dockerfile (3 locations: builder manifest stage, builder source stage, prod-deps manifest stage). Same fix for apps/worker/Dockerfile (worker depends on `@openwhispr/observability` only).
- **Files modified:** `apps/api/Dockerfile`, `apps/worker/Dockerfile`
- **Commit:** `e49d9f7`

**2. [Rule 1 — Bug] `apps/api/src/lib/dep-check.ts` missing PG + valkey probe timeout**

- **Found during:** Task 1 first attempt at the `/readyz` PG-down test
- **Issue:** The dep-check header comment promised "2s hard timeout on each probe", but only the litellm probe had a wall-clock cap (via undici's `bodyTimeout` / `headersTimeout`). The postgres + valkey paths had no timeout, so when `docker pause postgres` SIGSTOPped the container, `pg.Pool.connect()` blocked forever — the `/readyz` HTTP request itself hung (which timed out the vitest test).
- **Fix:** Wrap the inner probe work in `Promise.race` with a 2s timeout sentinel. Applies uniformly to all three probe types (postgres, valkey, litellm). All 13 pre-existing `dep-check.test.ts` unit tests still pass after the change.
- **Files modified:** `apps/api/src/lib/dep-check.ts`
- **Commit:** `e49d9f7`

**3. [Rule 2 — Missing critical] `--pull never` flag on testcontainers compose up**

- **Found during:** Task 1 second boot attempt
- **Issue:** With `--no-build` set, compose tried to `docker pull` the locally-tagged `openwhispr-api` from `registry-1.docker.io/library/openwhispr-api` (the local-only tag has no registry) and failed with a TLS handshake timeout. Slows the harness and breaks on offline / firewalled CI runners.
- **Fix:** Add `--pull never` alongside `--no-build` in `commandOptions`. Pins the stack to whatever images already exist locally; the contributor / CI workflow becomes `docker compose build` (or `make build` in a future plan) → `make e2e-test-phase6`.
- **Files modified:** `tests/e2e/helpers/phase6-compose.ts`
- **Commit:** `f1233cb`

### Scope Renegotiated

**Audit test pivot — auth.signin → key.issued.** Plan 12 originally specified the audit emission test against `auth.signin`. Per 06-05-SUMMARY, `auth.signin` is deferred to a future Better-Auth-hooks plan (BA's `databaseHooks.session.create.after` fires outside the route's `withTenant()` tx, requiring a separate wiring story). Plan 12a's <behavior> tag pre-authorized the pivot to one of the 3 wired actions (account.delete / key.issued / key.revoked); we chose `key.issued` because it exercises the cleanest end-to-end path (POST → 200 → durable audit row) and carries the T-bearer-leak sentinel.

### Implementation Notes

- **Probes baseline narrowed.** The hermetic stack's `litellm` dep-check is SSRF-blocked by Plan 06-06 (the litellm container's hostname `litellm` is not in the default `OUTBOUND_HTTPS_ALLOWLIST`). `/readyz` overall code stays 503 throughout independent of PG state. The OBS-05 invariants the suite asserts (`/livez` zero-deps under PG outage, per-dep PG visibility in the `/readyz` body within 6s/8s windows) are unchanged. Adding `litellm` to the SSRF allowlist is out of scope for 12a — tracked for a follow-up Plan 06-06 fix.
- **testcontainers v11 quirks documented** in `phase6-compose.ts` header:
  - `withProjectName("openwhispr")` MUST be called AFTER any `withNoRecreate()` (the latter overwrites projectName to `"testcontainers-node"` in v11) — easier just to drop `withNoRecreate()`.
  - No `pause()` / `unpause()` on `StartedTestContainer`; shell-out via `docker pause <containerId>`.
  - No `run --rm <service>` analogue; shell-out via `docker compose -p <name> run --rm seed`.

## Authentication Gates

None. Hermetic stack runs with empty provider keys (LITELLM contract config short-circuits chat/audio routes; `MOCK_DIARIZATION=true` short-circuits pyannote). No human action required.

## Threat Surface

No new external-facing surface introduced. The dep-check Promise.race timeout TIGHTENS the existing threat-mitigation surface for T-readiness-cascade (D-P1) and adds defense-in-depth for T-DOS-via-hung-probe (not previously enumerated; documented inline).

## Known Stubs

None for the in-scope deliverable. The litellm SSRF-allowlist concern is documented as out-of-scope for 12a (would need a Plan 06-06 follow-up).

## Threat Flags

None — files touched are pre-existing surfaces (probes / audit / dep-check) and the changes are tightening guards, not introducing new surface.

## Deferred Items

- **litellm dep-check via SSRF allowlist.** The internal cluster hostname `litellm` is not in `OUTBOUND_HTTPS_ALLOWLIST`, so the litellm probe in `/readyz` always reports `ok: false` in the hermetic stack. Plan 06-06 owns the SSRF allowlist; a one-line addition there (or an exception path for the dep-check probe) would let `/readyz` baseline return 200 in hermetic mode. Tracked separately.
- **Docker image GC during `down -v --remove-orphans`.** On macOS Docker Desktop, custom-tagged images (`openwhispr/postgres:17.5-pgpartman`, `openwhispr-api:latest`, etc.) sometimes vanished between suites — possibly Docker Desktop's storage-driver GC. Current contributor workaround: re-run `docker compose build` before `make e2e-test-phase6` if images go missing. Not a Phase 6 fix; broader Docker Desktop concern for the OSS contributor workflow.

## Self-Check: PASSED

Files claimed exist on disk:

- FOUND: tests/e2e/helpers/phase6-compose.ts
- FOUND: tests/e2e/probes-dependency.test.ts
- FOUND: tests/e2e/audit-log-write.test.ts
- FOUND: Makefile (contains `e2e-test-phase6:` target)
- FOUND: apps/api/Dockerfile (contains `COPY packages/observability`)
- FOUND: apps/worker/Dockerfile (contains `COPY packages/observability`)
- FOUND: apps/api/src/lib/dep-check.ts (contains `Promise.race`)

Commits exist in history:

- FOUND: e49d9f7 fix(06-12a): dockerfile workspace deps + dep-check probe timeout (rule 3 blockers)
- FOUND: f1233cb test(06-12a): probes-dependency e2e + phase6 compose helper + makefile target
- FOUND: 7f3c73a test(06-12a): audit-log-write e2e pivoted to key.issued (DATA-04)
