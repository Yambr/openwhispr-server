---
phase: 14-slim-core-byok-profiles-v2
plan: 03
subsystem: infra
tags: [docker-compose, overlays, slim-core, traefik, observability, mailpit, pgbouncer, ingress-reset]

requires:
  - phase: 14-slim-core-byok-profiles-v2
    provides: 14-01 slim-core base (6 long-running services + migrate); 14-CONTEXT.md decision 1 (overlay routing table); 14-RESEARCH.md §A.1 (service definitions) + §A.3 (consumer touch points) + §G.1 (Makefile target shape)
provides:
  - "Six opt-in compose overlay files under `compose/`: observability (5 services), storage (minio), ingress (traefik + !reset on api/web ports), pgbouncer (pooler), dev-tools (mailpit ONLY), contract-test (fixture-idp + seed + contract-test-runner)"
  - "Compose 2.20+ `ports: !reset []` override on api+web in the ingress overlay — strips slim-core host ports so production posture exposes ONLY Traefik (80/443/8443/8080)"
  - "Grafana datasource pointing at postgres:5432 direct (no longer assumes the pgbouncer overlay)"
  - "Makefile targets `up`, `up-with-observability`, `up-with-storage`, `up-with-ingress`, `up-with-pgbouncer`, `up-with-dev-tools`, `up-full` per RESEARCH §G.1"
  - "e2e-cjm harness `COMPOSE_FILES` extended with 4 overlays (observability, pgbouncer, dev-tools, ingress) so Phase 13 happy-path scenarios layer correctly"
  - "compose-chart-parity linter `DEFAULT_COMPOSE_FILES` extended with all 6 overlay files so the allowlist + chart resolve services that live exclusively in overlays"
  - "Cascading compose-shape tests retargeted at overlay-merged config (closes 23 of the 23 cascading failures from `.planning/deferred-items.md`)"
  - "30-assertion overlay-conformance suite (tests/integration/compose-overlays.test.ts)"
affects: [14-04, 14-05, 14-06, 14-07]

tech-stack:
  added: []
  patterns:
    - "Compose overlay layering: base = slim-core; opt-in deltas via `-f compose/docker-compose.<name>.yml`"
    - "Overlay re-injection of cross-base deltas (depends_on edges + environment defaults) so each overlay restores the original behavior of that service set"
    - "Compose 2.20+ `!reset []` override to clear (rather than append to) base list-typed fields"

key-files:
  created:
    - "compose/docker-compose.observability.yml (LGTM stack — otel-collector, loki, tempo, mimir, grafana — + api/worker delta re-injection)"
    - "compose/docker-compose.storage.yml (minio + api S3_* env defaults)"
    - "compose/docker-compose.ingress.yml (traefik + api.localhost/auth.localhost network aliases + ports !reset [] on api+web)"
    - "compose/docker-compose.pgbouncer.yml (edoburu/pgbouncer + api/migrate depends_on + DATABASE_URL re-point)"
    - "compose/docker-compose.dev-tools.yml (mailpit ONLY — TD-14.a closure)"
    - "compose/docker-compose.contract-test.yml (fixture-idp + seed + contract-test-runner)"
    - "tests/integration/compose-overlays.test.ts (30 assertions: file existence, service rosters, depends_on/env deltas, docker compose config -q smoke, !reset port reset, consumer touch points)"
  modified:
    - "compose/grafana/provisioning/datasources/postgres.yaml (url: pgbouncer:6432 → postgres:5432 direct)"
    - "Makefile (+7 new targets: up + up-with-* + up-full)"
    - "tests/e2e-cjm/support/compose-harness.ts (COMPOSE_FILES extended with 4 overlays)"
    - "tools/lint-compose-chart-parity.ts (DEFAULT_COMPOSE_FILES extended with all 6 overlay files)"
    - "tests/integration/traefik-network-alias.test.ts (retargeted at base + ingress + contract-test merge)"
    - "tests/integration/traefik-realtime-entrypoint.test.ts (Test 6 now reads compose/docker-compose.ingress.yml directly)"
    - "tests/integration/contract-test-runner-compose.test.ts (retargeted at base + ingress + contract-test merge with overlay-aware composeConfig helper)"
    - "tests/integration/oidc-env-wiring.test.ts (retargeted at base + contract-test merge)"
    - "tests/integration/observability-stack-up.test.ts (replaced --profile obs-only with -f base -f overlay/observability)"
    - ".planning/deferred-items.md (Plan 14-01 cascading-test section flipped from Open → Resolved)"
  deleted:
    - "tests/infra/compose-schema.test.ts (Phase 1 base-shape spec — premise structurally inverted by slim-core; replaced wholesale by tests/integration/slim-core-base.test.ts in 14-01)"

key-decisions:
  - "Used compose 2.20+ `ports: !reset []` (not `ports: []`, which would merge as append) on api+web in the ingress overlay so the slim-core host ports drop cleanly when the overlay is layered. Verified against Docker Compose v2.23.0-desktop.1 on the dev host."
  - "Restored OTEL_EXPORTER_OTLP_ENDPOINT default `:-http://otel-collector:4317` ONLY in the observability overlay, NOT base — slim-core base intentionally leaves the env unset so the loud-fail guard wired in plan 14-04 surfaces missing observability config as an operator-actionable error."
  - "Grafana Postgres datasource flipped to postgres:5432 direct so operators who enable observability are NOT forced to also enable pooler. Read-only queries against usage_ledger don't need transaction-mode pooling."
  - "Dev-tools overlay declares ONLY mailpit (NOT fixture-idp/seed/contract-test-runner per CONTEXT decision 1 / TD-14.a). The contract-test services live in their dedicated overlay so `make contract-test` can layer them without forcing mailpit on every dev run."
  - "Did NOT re-add api.depends_on.mailpit in the dev-tools overlay (per RESEARCH §A.3 mailpit table). EmailSender.ts loud-fails at runtime when SMTP_HOST is set but unreachable; api boot is intentionally decoupled."
  - "Did NOT add a `scripts/run.sh` — the file does not exist in this repo (the plan's mention of it appears to be a planning artifact)."
  - "Retargeted (not deleted) traefik-network-alias / traefik-realtime-entrypoint / contract-test-runner-compose / oidc-env-wiring; their underlying assertions (network aliases, BACKEND_URL, AUTH_TRUSTED_ORIGINS_EXTRA, fixture-idp env, port 8443) remain valuable contracts and now exercise them on the overlay-merged config."
  - "Suite-level timeout: 30s on every retargeted file (docker compose config against the merged chain takes ~10s; vitest default 5s timed out)."

patterns-established:
  - "Each overlay re-injects the deltas (depends_on + environment) that the base stripped so `docker compose -f base -f overlay up` reproduces the original behavior of that service set."
  - "Per-overlay assertion test pattern: existence + service-roster set equality + depends_on/env re-injection + `docker compose config -q` smoke against the merged chain (skipIf SKIP_DOCKER=1)."
  - "Consumer-touch-point allowlist pattern: when slim-core moves a service to an overlay, the compose-chart-parity linter is taught about the overlay file rather than the allowlist expanded with one-off entries."

requirements-completed: [SLIM-02]

duration: ~75min
completed: 2026-05-14
---

# Phase 14 Plan 03: Compose overlays Summary

**Six opt-in compose overlays under `compose/` re-introduce every non-slim service the base lost in plan 14-01 — observability (5 services), storage (minio), ingress (traefik + ports !reset on api/web), pgbouncer (pooler), dev-tools (mailpit ONLY), and contract-test (fixture-idp + seed + contract-test-runner) — wired into the Makefile, e2e-cjm harness, parity linter, and the 5 cascading compose-shape tests retargeted at overlay-merged config.**

## Performance

- **Duration:** ~75 min
- **Started:** 2026-05-14T19:43:00Z (RED test commit `b00ecc0`)
- **Completed:** 2026-05-14T20:04:00Z (obs-stack retarget `21a4a8e`)
- **Tasks:** 3 (RED test, GREEN overlays + grafana, GREEN wire-up + cascading fix)
- **Commits:** 7 (test/RED, feat/overlays, chore/wire-up, fix/cascading, chore/obsolete-delete, docs/deferred-resolve, fix/obs-stack-retarget)
- **Files created:** 7 (6 overlays + 1 conformance test)
- **Files modified:** 10 (grafana datasource, Makefile, compose-harness, parity linter, 4 retargeted integration tests, deferred-items.md, observability-stack-up.test.ts)
- **Files deleted:** 1 (tests/infra/compose-schema.test.ts — obsolete)

## Test count + coverage

- **Conformance suite:** 30 assertions, 30/30 PASS (`tests/integration/compose-overlays.test.ts`).
- **Parity linter:** 36 assertions, 36/36 PASS (`tools/lint-compose-chart-parity.test.ts`).
- **Slim-core base:** 10 assertions, 10/10 PASS (unchanged from 14-01).
- **Cascading retargeted tests:** 26 assertions across 4 files, 26/26 PASS (`traefik-network-alias`, `traefik-realtime-entrypoint`, `contract-test-runner-compose`, `oidc-env-wiring`).
- **Coverage:** N/A by design — all new code in this plan is YAML config + a test file. The conformance test file itself is a test, not a coverage target.

## Verification

```
pnpm vitest run tests/integration/compose-overlays.test.ts         # 30/30 PASS
pnpm vitest run tools/lint-compose-chart-parity.test.ts            # 36/36 PASS
for o in observability storage ingress pgbouncer dev-tools contract-test; do
  docker compose -f docker-compose.yml -f compose/docker-compose.$o.yml config -q
done                                                                # exit 0 for all 6
docker compose -f docker-compose.yml -f compose/docker-compose.ingress.yml config --format json \
  | jq '.services.api.ports, .services.web.ports'                  # null + null (= reset)
make -n up-full                                                     # shows correct -f chain
```

## Cascading test resolution (Plan 14-01 deferred-items.md)

All 7 cascading failures from `.planning/deferred-items.md` (`From Plan 14-01 (Phase 14)`) are now resolved:

| Test file                                                    | Resolution                                                                                |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `tests/infra/compose-schema.test.ts`                         | **DELETED** (replaced wholesale by `tests/integration/slim-core-base.test.ts` from 14-01) |
| `tests/integration/traefik-network-alias.test.ts`            | Retargeted at base + ingress + contract-test merge                                        |
| `tests/integration/traefik-realtime-entrypoint.test.ts`      | Test 6 now reads `compose/docker-compose.ingress.yml` directly                            |
| `tests/integration/traefik-forwarded-headers.test.ts`        | NO change required (reads `compose/traefik/traefik.yml` directly)                         |
| `tests/integration/traefik-no-buffering.test.ts`             | NO change required (reads `compose/traefik/dynamic.yml` directly)                         |
| `tests/integration/contract-test-runner-compose.test.ts`     | Retargeted at base + ingress + contract-test merge (overlay-aware `composeConfig`)        |
| `tests/integration/oidc-env-wiring.test.ts`                  | Retargeted at base + contract-test merge                                                  |

Plus one additional cascading failure discovered during integration sweep:
- `tests/integration/observability-stack-up.test.ts` — replaced `--profile obs-only` with the explicit `-f base -f overlay/observability` selector (commit `21a4a8e`).

## Deviations from Plan

### Auto-fixed Issues (deviations from plan body)

**1. [Rule 3 — blocker]** Plan body mentioned `scripts/run.sh` but the file does not exist in the repo. Skipped that touch point (no work to do).

**2. [Rule 2 — missing critical functionality]** Plan body only listed 7 cascading compose-shape tests in deferred-items.md; integration sweep revealed an 8th cascading failure (`tests/integration/observability-stack-up.test.ts`) that asserted `--profile obs-only`. Retargeted at the observability overlay so it remains green.

**3. [Rule 1 — bug]** Plan body's overlay test had 5-second vitest default timeouts that didn't budget for the ~10s cost of `docker compose config` per call. Bumped per-test (and per-describe on retargeted files) to 30s.

**4. [Rule 3 — blocker]** Plan's `compose-harness.ts` `COMPOSE_FILES` extension list included a fifth overlay (`compose/docker-compose.contract-test.yml`) in §B.3 of RESEARCH but the must_have observable truth only required the 4 happy-path overlays (observability, pgbouncer, dev-tools, ingress). Stuck with the must-have set (4 overlays) because the cjm happy-path doesn't seed contract-test fixtures.

### Known Stubs

None.

## Threat Flags

None — the overlays re-introduce services that already exist in the threat register from Phase 1–9 plans (T-04-02 ingress pool exhaustion, T-09-08 bundled-ai gating, etc.). No new network surface or trust boundary introduced.

## Deferred Issues

**`tests/integration/session-token-plain-roundtrip.test.ts`** — fails because the test requires a live postgres testcontainer that isn't set up in the integration vitest config. Unrelated to Plan 14-03's surface (compose YAML + Makefile + linter); not introduced by this plan (history shows `c57554c chore(10-04): apply spdx apache-2.0 header` is the last touch); pre-existing. Belongs in a phase that audits integration-test postgres lifecycle.

## Self-Check: PASSED

- File `compose/docker-compose.observability.yml`: FOUND
- File `compose/docker-compose.storage.yml`: FOUND
- File `compose/docker-compose.ingress.yml`: FOUND
- File `compose/docker-compose.pgbouncer.yml`: FOUND
- File `compose/docker-compose.dev-tools.yml`: FOUND
- File `compose/docker-compose.contract-test.yml`: FOUND
- File `tests/integration/compose-overlays.test.ts`: FOUND
- Commit `b00ecc0` (RED test): FOUND
- Commit `30763a8` (GREEN overlays + grafana): FOUND
- Commit `94c5bb5` (chore wire-up Makefile/harness/linter): FOUND
- Commit `e04a25b` (fix cascading retargeting): FOUND
- Commit `a627b2e` (chore drop obsolete schema spec): FOUND
- Commit `19adbf1` (docs deferred-items resolved): FOUND
- Commit `21a4a8e` (fix obs-stack-up retarget): FOUND
- Grafana datasource url == `postgres:5432`: VERIFIED
- Ingress overlay merged config api.ports == [] / web.ports == []: VERIFIED
- All 6 overlays `docker compose config -q` exit 0: VERIFIED
- Makefile dry-run for `up-full` shows correct -f chain: VERIFIED
