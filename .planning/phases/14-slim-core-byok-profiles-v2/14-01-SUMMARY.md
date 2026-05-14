---
phase: 14-slim-core-byok-profiles-v2
plan: 01
subsystem: infra
tags: [docker-compose, slim-core, profiles-inversion, otel, host-ports]

requires:
  - phase: 01-foundation
    provides: 19-service profile-gated docker-compose baseline
  - phase: 14-slim-core-byok-profiles-v2
    provides: 14-CONTEXT.md, 14-RESEARCH.md (§A.1 service inventory, §G.3 profiles inversion), 14-PATTERNS.md, 14-PLAN-CHECK.md
provides:
  - "Slim-core base docker-compose.yml: 6 long-running services (api, web, worker, postgres, valkey, litellm) + migrate init"
  - "Zero `profiles:` keys on any surviving service — bare `docker compose up` is the canonical OSS-quickstart command"
  - "Host ports published on api (4000:3000) and web (3000:3000) so the slim path works without Traefik"
  - "OTEL_EXPORTER_OTLP_ENDPOINT with no `:-http://otel-collector:4317` fallback — feeds loud-fail wiring in plan 14-04"
  - "Static YAML conformance test (tests/integration/slim-core-base.test.ts) codifying the slim-core shape contract"
affects: [14-03, 14-04, 14-05, 14-06, 14-07]

tech-stack:
  added: []
  patterns:
    - "Slim-core base + overlay layering (Wave 1 = base; Wave 2 = compose/overlays/*.yml additive)"
    - "OTel loud-fail via no-default — unset endpoint surfaces operator-actionable error instead of silent drop"

key-files:
  created:
    - "tests/integration/slim-core-base.test.ts (10-assertion static YAML conformance test)"
  modified:
    - "docker-compose.yml (19-service megafile → 7-service slim-core, -485 lines / +89 lines net)"
    - ".planning/deferred-items.md (catalogs 7 compose-shape tests blocked on Wave-2 overlays)"

key-decisions:
  - "Documented but did NOT rewire 7 pre-existing compose-shape tests (compose-schema, traefik-network-alias, traefik-realtime-entrypoint, traefik-forwarded-headers, traefik-no-buffering, contract-test-runner-compose, oidc-env-wiring); deferred to Wave-2 overlay plans per the plan's explicit `files_modified=[docker-compose.yml]` allowlist."
  - "Kept Traefik routing `labels:` on the web service even though Traefik itself moves to an overlay — labels are inert without a Traefik container reading them and avoid a duplicate-spec divergence between base and overlay."
  - "Smoke-test verified bare `docker compose up -d --wait` brings up all 7 containers (6 healthy + migrate exited 0) on a fresh `docker compose down -v`."

patterns-established:
  - "Slim-core test pattern: pure static-YAML reader, no docker daemon dependency, no testcontainers, sub-200ms vitest runtime"
  - "Deviation-deferral pattern: when a plan's `files_modified` allowlist is explicitly bounded, cascading test failures caused by the bounded edit are logged to deferred-items.md instead of fixed inline"

requirements-completed: [SLIM-01]

duration: ~12min
completed: 2026-05-14
---

# Phase 14 Plan 01: Slim-core base Summary

**Inverted docker-compose.yml from a 19-service profile-gated megafile into a 7-service slim-core base (6 long-running + migrate init) — bare `docker compose up` now works as the OSS quickstart with zero flags.**

## Performance

- **Duration:** ~12 min (excluding boot smoke)
- **Started:** 2026-05-14T19:21:00Z (approx, RED test commit)
- **Completed:** 2026-05-14T19:27:00Z (approx, after smoke teardown)
- **Tasks:** 3 (RED test, GREEN edit, smoke verification)
- **Files modified:** 3 (docker-compose.yml, .planning/deferred-items.md, tests/integration/slim-core-base.test.ts)

## Accomplishments

- **12 services deleted from base** (move to Wave-2 overlays): pgbouncer, minio, traefik, otel-collector, loki, tempo, mimir, grafana, mailpit, fixture-idp, seed, contract-test-runner.
- **5 named volumes deleted**: minio_data, loki_data, tempo_data, mimir_data, grafana_data.
- **Every `profiles:` key removed** from the 7 surviving services.
- **Host ports added**: `api` publishes 4000:3000, `web` publishes 3000:3000.
- **`depends_on` pruned**: api lost pgbouncer/otel-collector/mailpit; worker lost otel-collector; migrate lost pgbouncer.
- **OTel fallback stripped**: `OTEL_EXPORTER_OTLP_ENDPOINT: ${OTEL_EXPORTER_OTLP_ENDPOINT}` (no `:-http://otel-collector:4317`) on api + worker.
- **`api.depends_on.migrate.condition = service_completed_successfully` preserved** (rolling-deploy gate).
- **Smoke verified live**: `docker compose up -d --wait --wait-timeout 240` brings up 7 containers (6 healthy + migrate exited 0); `docker compose down -v` cleans up.

## Task Commits

1. **Task 1: RED — slim-core conformance test** — `dd44c3f` (test)
2. **Task 2: GREEN — slim-core base edit** — `3316021` (feat) — includes deferred-items.md update
3. **Task 3: docker-compose lint + boot smoke** — no commit (invocation-only per plan spec)

## Files Created/Modified

- `tests/integration/slim-core-base.test.ts` (new, 147 LOC) — 10 static-YAML assertions: exact service-name set equality, no `profiles:` keys, ports 4000:3000 and 3000:3000, `depends_on` subset constraints, OTel-endpoint no-fallback, migrate-gate condition.
- `docker-compose.yml` (-485 / +89 lines net) — slim-core base.
- `.planning/deferred-items.md` (+1 section, ~22 lines) — catalogs 7 cascading compose-shape test failures with rationale + Wave-2 rewiring guidance.

## Decisions Made

- **No rewire of pre-existing compose-shape tests in this plan.** The plan's `files_modified` allowlist is explicitly `[docker-compose.yml]`; rewiring each test to load the correct Wave-2 overlay belongs in the plan that authors that overlay (14-03 onward). Documented in deferred-items.md.
- **Kept Traefik `labels:` block on `web` service.** Labels are inert without a Traefik container reading them; keeping them avoids divergence between base and the future edge overlay (Wave 2 plan 14-03 will just add the traefik service that consumes them).
- **Boot smoke teardown via `docker compose down -v`.** Verified clean removal: 7 containers stopped, 2 volumes removed (postgres_data, valkey_data), 1 network removed.

## Deviations from Plan

### Out-of-scope cascade logged to deferred-items.md (not auto-fixed)

The slim-core inversion causes 7 pre-existing compose-shape tests to fail because they assert services that moved to overlays:

- `tests/infra/compose-schema.test.ts` (Phase-1 base-shape spec — structurally superseded by the new `slim-core-base.test.ts`).
- `tests/integration/traefik-network-alias.test.ts`
- `tests/integration/traefik-realtime-entrypoint.test.ts`
- `tests/integration/traefik-forwarded-headers.test.ts`
- `tests/integration/traefik-no-buffering.test.ts`
- `tests/integration/contract-test-runner-compose.test.ts`
- `tests/integration/oidc-env-wiring.test.ts`

**Why deferred (not auto-fixed):** Phase plan explicitly anticipates this in success-criterion-#1 commentary ("13 non-slim services... will be re-declared by overlays in Wave 2 plan 14-03"). The plan's `files_modified` allowlist is bounded to `docker-compose.yml`. Fixing each test would either (a) require touching files outside the allowlist, or (b) merge overlay infrastructure that doesn't exist yet. Documented for Wave-2 pickup.

### Auto-fixed Issues

None.

---

**Total deviations:** 0 auto-fixed; 1 documented deferral (cascading compose-shape tests → Wave-2 plans).
**Impact on plan:** No scope creep. Plan executed exactly as written.

## Issues Encountered

- **Initial commit rejected by commitlint** — `RED` (upper-case in subject) violated `subject-case` rule. Re-committed with lowercase `red`. No code change required.
- **`docker compose ps` default omits exited containers** — count appeared as 6 instead of 7 until `-a` flag was added. The migrate container correctly exited 0; smoke-test verify clause requires `ps -a` to enumerate all 7 (6 running + 1 exited).

## User Setup Required

None — `.env` is already present; no external service configuration required for slim-core boot.

## Next Phase Readiness

Slim-core base is now the canonical shape. Wave-2 plans (14-03 overlay authoring, 14-04 loud-fail wiring, etc.) can proceed:

- **14-03 (overlay authoring):** must re-declare the 12 deleted services as additive overlays under `compose/overlays/*.yml`, and rewire the 7 deferred compose-shape tests to load the relevant overlay.
- **14-04 (loud-fail wiring):** the `OTEL_EXPORTER_OTLP_ENDPOINT` no-fallback shape is already in place; plan 14-04 wires the runtime guard that surfaces the empty value as an operator-actionable error.

No blockers. No threat flags. Slim-core conformance test gates regressions: any future plan that re-adds a `profiles:` key or a non-slim service to base will trip the 10-assertion test immediately.

## Self-Check: PASSED

- `tests/integration/slim-core-base.test.ts` exists — FOUND.
- `docker-compose.yml` matches slim-core shape (7 services, no `profiles:` keys, host ports on api/web) — FOUND.
- `.planning/deferred-items.md` has Phase-14 plan-01 section — FOUND.
- Commit `dd44c3f` (RED test) exists — FOUND.
- Commit `3316021` (GREEN base edit) exists — FOUND.
- `docker compose config --services | sort` reports exactly `api litellm migrate postgres valkey web worker` — FOUND.
- Bare `docker compose up -d --wait --wait-timeout 240` returned EXIT=0 with 6 healthy + 1 exited — FOUND.

---
*Phase: 14-slim-core-byok-profiles-v2*
*Completed: 2026-05-14*
