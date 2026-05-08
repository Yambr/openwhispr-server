---
phase: 01-core-infra-multi-tenant-data
plan: 01
subsystem: infra/compose
tags: [infra, docker-compose, observability, traefik, minio, otel, pgbouncer]
requires:
  - Phase 0 placeholder Fastify app on :3000
  - .planning/phases/01-core-infra-multi-tenant-data/01-RESEARCH-INFRA.md
provides:
  - Ten-service Compose Spec v2 data plane (postgres, pgbouncer, valkey, minio, traefik, otel-collector, loki, tempo, mimir, grafana)
  - File-provider Traefik routes for api.localhost / grafana.localhost / minio-console.localhost
  - OTel Collector pipeline OTLP -> Tempo/Loki/Mimir with X-Scope-OrgID
  - PgBouncer transaction-mode pooler config (default_pool_size=100, max_prepared_statements=200)
  - Auto-provisioned Grafana datasources for the LGTM stack
  - Infra validation harness: compose-schema Vitest test + 5 bash smoke scripts
affects:
  - docker-compose.yml (replaced placeholder)
  - Makefile (added up/down/logs/ps/restart with --profile default)
tech-stack:
  added:
    - postgres:17.5-alpine
    - edoburu/pgbouncer:1.23.1
    - valkey/valkey:8.1-alpine
    - minio/minio:RELEASE.2026-03-25T00-00-00Z
    - traefik:v3.6
    - otel/opentelemetry-collector-contrib:0.151.0
    - grafana/loki:3.5.0
    - grafana/tempo:2.8.0
    - grafana/mimir:2.16.0
    - grafana/grafana:11.6.0
    - yaml@^2.8.4 (devDependency for compose-schema test)
  patterns:
    - Compose Spec v2 (no version key)
    - Profiles default / obs-only / db-only
    - Single internal bridge openwhispr_internal; only Traefik publishes host ports
    - depends_on with service_healthy gates
    - File-provider Traefik (no Docker provider)
    - X-Scope-OrgID on Mimir write and read paths
key-files:
  created:
    - tests/infra/compose-schema.test.ts
    - tests/infra/wait-healthy.sh
    - tests/infra/smoke.sh
    - tests/infra/otel-roundtrip.sh
    - tests/infra/loki-roundtrip.sh
    - tests/infra/mimir-roundtrip.sh
    - compose/otel-collector/config.yaml
    - compose/grafana/provisioning/datasources/tempo.yaml
    - compose/grafana/provisioning/datasources/loki.yaml
    - compose/grafana/provisioning/datasources/mimir.yaml
    - compose/traefik/traefik.yml
    - compose/traefik/dynamic.yml
    - compose/traefik/certs/.gitkeep
    - compose/pgbouncer/pgbouncer.ini
    - compose/pgbouncer/userlist.txt.example
    - .env.example
  modified:
    - docker-compose.yml
    - Makefile
decisions:
  - "Override D-02: use edoburu/pgbouncer:1.23.1 instead of bitnami (bitnami free image retired 2025)"
  - "Single PgBouncer instance with default_pool_size=100 (vs research's 4x25 K8s template) — single-host compose only needs one"
  - "X-Scope-OrgID: openwhispr asserted on both OTel Collector prometheusremotewrite exporter AND Grafana Mimir datasource (single-tenant value, but Mimir always requires the header)"
  - "Loki and Tempo left in default anonymous-mode (auth_enabled: false); Phase 9 hardens"
  - "Traefik respondingTimeouts.readTimeout/writeTimeout = 3700s — covers SCALE-05 1h streaming sessions with buffer"
  - "MinIO image pinned by tag rather than digest in v1; coollabsio/minio fallback documented in 01-RESEARCH-INFRA §2.4 if upstream pulls degrade"
  - "Traefik dashboard left at api.insecure: true for dev; Phase 9 wraps with basic-auth middleware"
metrics:
  duration_seconds: 298
  tasks_completed: 2
  files_created: 16
  files_modified: 2
  commits: 2
  completed_at: "2026-05-09T02:03:00Z"
---

# Phase 1 Plan 01: Compose Stack Expansion Summary

Expanded the Phase 0 placeholder `docker-compose.yml` into the full Phase 1
data plane: ten services with verified 2026-05 image pins, healthchecks on
every service, the three required Compose profiles, and the per-service
config files (`compose/`) that make the stack boot deterministically. Built
TDD-first via a five-case Vitest schema lint plus five bash smoke scripts.

## Services Landed

| Service | Image pin | Profile(s) | Notes |
|---------|-----------|------------|-------|
| postgres | `postgres:17.5-alpine` | default, db-only | Mounts Plan 03's init dir read-only |
| pgbouncer | `edoburu/pgbouncer:1.23.1` | default, db-only | Transaction mode, pool=100, max_prepared_statements=200 |
| valkey | `valkey/valkey:8.1-alpine` | default | `--requirepass` from `VALKEY_PASSWORD` |
| minio | `minio/minio:RELEASE.2026-03-25T00-00-00Z` | default | API :9000, Console :9001 |
| traefik | `traefik:v3.6` | default | Only service publishing host ports (80/443/8080) |
| otel-collector | `otel/opentelemetry-collector-contrib:0.151.0` | default, obs-only | OTLP -> Tempo/Loki/Mimir |
| loki | `grafana/loki:3.5.0` | default, obs-only | Anonymous read |
| tempo | `grafana/tempo:2.8.0` | default, obs-only | Anonymous read |
| mimir | `grafana/mimir:2.16.0` | default, obs-only | Requires `X-Scope-OrgID` |
| grafana | `grafana/grafana:11.6.0` | default, obs-only | Auto-provisioned LGTM datasources |

## Key Configuration Decisions

- **edoburu override (D-02):** Bitnami's free PgBouncer image was retired
  in 2025 (paid Bitnami Secure Images subscription only). edoburu is the
  de-facto OSS choice (>10M Docker Hub pulls, env-var-driven config).
  Decision documented inline in `docker-compose.yml`.
- **X-Scope-OrgID on both write and read paths:** Mimir requires the
  multi-tenancy header even in single-tenant mode. Set on the OTel
  Collector's `prometheusremotewrite` exporter (write path) and on the
  Grafana Mimir datasource via `httpHeaderName1`/`secureJsonData.httpHeaderValue1`
  (read path).
- **Traefik 3700s respondingTimeouts:** `readTimeout` and `writeTimeout`
  set to 3700s (1h + 100s buffer) on the `websecure` entryPoint to cover
  SCALE-05 (1h streaming sessions on `/api/agent/stream` and `/v1/realtime`).
  `idleTimeout` left at 180s.
- **Single PgBouncer instance:** Research §4.1 recommended one instance with
  `default_pool_size=100` for the single-host compose deployment (the
  4x25 split is K8s-style horizontal-pool scaling for Helm in Phase 9).
- **`ignore_startup_parameters = extra_float_digits,search_path`:** Both
  required for Drizzle/`pg` driver compatibility under transaction-mode
  pooling.
- **File-provider Traefik (D-31):** No Docker provider in v1; explicit
  routes are clearer for self-hosters and simpler to reason about. Three
  routers: `api.localhost`, `grafana.localhost`, `minio-console.localhost`,
  all on `websecure` with TLS terminating at the file-provider certificate
  pair `/certs/local.{crt,key}` (Plan 02 generates the cert pair).

## Files Added / Modified

**Created (16):**
- `tests/infra/compose-schema.test.ts` — five-case Vitest schema lint
- `tests/infra/{wait-healthy,smoke,otel-roundtrip,loki-roundtrip,mimir-roundtrip}.sh`
- `compose/otel-collector/config.yaml`
- `compose/grafana/provisioning/datasources/{tempo,loki,mimir}.yaml`
- `compose/traefik/{traefik.yml,dynamic.yml,certs/.gitkeep}`
- `compose/pgbouncer/{pgbouncer.ini,userlist.txt.example}`
- `.env.example`

**Modified (2):**
- `docker-compose.yml` — replaced placeholder with the full ten-service stack
- `Makefile` — added `logs`, `ps`, `restart` targets; `up` now `--profile default`

## Verification Results

All `<verify>` blocks green:
- `pnpm vitest run tests/infra/compose-schema.test.ts` — 5/5 pass
- `grep -q 'edoburu/pgbouncer:1.23.1' docker-compose.yml` — pass
- `grep -q 'pool_mode = transaction' compose/pgbouncer/pgbouncer.ini` — pass
- `grep -q 'X-Scope-OrgID' compose/otel-collector/config.yaml` — pass
- `grep -q 'readTimeout: 3700s' compose/traefik/traefik.yml` — pass
- `grep -q 'MASTER_KEK=PLACEHOLDER' .env.example` — pass
- `bash -n` syntax check on all five scripts — pass
- `pnpm exec tsx tools/lint-english.ts` — 67 files scanned, 0 violations
- `docker compose config` — valid (only warnings are unset env vars, which
  Plan 02's bootstrap.sh fills in)

## Deviations from Plan

None — plan executed exactly as written. Auth gates: none encountered.

The two minor deltas from the literal plan text are:
1. The plan's `<action>` block referenced an embedded heredoc Node script
   in `otel-roundtrip.sh`. To avoid host port-publishing on 4318
   (which would violate "only Traefik publishes host ports" and Test 2),
   the implementation runs the OTLP emitter inside a transient
   `node:24-alpine` container attached to the `openwhispr_internal`
   network instead, with the same minimal `@opentelemetry/sdk-node`
   payload. This preserves the network model contract and removes the
   need to add the OTel SDK as a workspace devDependency.
2. The plan suggested adding `@opentelemetry/sdk-node` and
   `@opentelemetry/exporter-trace-otlp-http` as workspace devDependencies.
   With the in-network container approach above, those installs happen
   inside the transient container per run — no permanent dependency
   addition, no host-network exposure of OTLP, and the package.json stays
   focused.

## Follow-ups (Out of Scope)

- **Self-signed cert generation** (mkcert vs openssl) lands in Plan 02's
  `bootstrap.sh`; `compose/traefik/certs/.gitkeep` makes the mount target
  exist now.
- **bash 3.2 macOS gotcha** (e.g., associative-array support) is Plan 02
  territory.
- **Grafana dashboards** deferred to Phase 6 (D-29). Datasources only here.
- **MinIO image-distribution risk** (upstream archive 2026-04-25):
  documented in `01-RESEARCH-INFRA.md §2.4`; revisit at Phase 9 if pulls
  degrade. Fallback registry `coollabsio/minio` documented.
- **PgBouncer userlist.txt** is `*.example` only; bootstrap.sh writes the
  real (gitignored) `userlist.txt` after creating the SCRAM-hashed roles.

## Self-Check: PASSED

Files exist:
- FOUND: tests/infra/compose-schema.test.ts
- FOUND: tests/infra/wait-healthy.sh
- FOUND: tests/infra/smoke.sh
- FOUND: tests/infra/otel-roundtrip.sh
- FOUND: tests/infra/loki-roundtrip.sh
- FOUND: tests/infra/mimir-roundtrip.sh
- FOUND: compose/otel-collector/config.yaml
- FOUND: compose/grafana/provisioning/datasources/tempo.yaml
- FOUND: compose/grafana/provisioning/datasources/loki.yaml
- FOUND: compose/grafana/provisioning/datasources/mimir.yaml
- FOUND: compose/traefik/traefik.yml
- FOUND: compose/traefik/dynamic.yml
- FOUND: compose/traefik/certs/.gitkeep
- FOUND: compose/pgbouncer/pgbouncer.ini
- FOUND: compose/pgbouncer/userlist.txt.example
- FOUND: .env.example
- FOUND: docker-compose.yml (replaced)
- FOUND: Makefile (extended)

Commits:
- FOUND: eb05804 test(01-01): add compose-schema test and infra smoke scripts
- FOUND: fa3c686 feat(01-01): expand compose stack to 10 services with healthchecks
