# Slim-core service routing research (Phase 14)

## Pre-flight correction

The discuss-phase prompt cites **27 services** in `docker-compose.yml`. That figure double-counted **8 named volumes** declared at top level (`openwhispr_internal`, `postgres_data`, `valkey_data`, `minio_data`, `loki_data`, `tempo_data`, `mimir_data`, `grafana_data`). The actual `services:` block contains **19 services**. This report routes the 19 actual services. Volumes are out of scope for service routing (each volume follows its service into its overlay automatically).

Separately, three sibling compose files already exist at repo root or under `compose/`:
- `docker-compose.embedded-litellm.yml` — Phase 11-01 Variant A canonical (sibling, not overlay)
- `docker-compose.load-test.yml` + `docker-compose.load-test.realistic.yml` — k6 + mock-litellm + speaches load targets (sibling)
- `compose/e2e/docker-compose.e2e.yml` — Phase 04 e2e overlay (mock-realtime)
- `compose/live-soak/docker-compose.live.yml` — long-soak overlay

Phase 14 must ADD 5 named overlays (`observability`, `storage`, `ingress`, `pgbouncer`, `dev-tools`) without disturbing the existing 4 sibling files. The 5 new overlays go **under `compose/`** per success criterion #2.

## Existing compose inventory (19 services in `docker-compose.yml`)

| # | Service | Image | Routing decision | Reasoning |
|---|---------|-------|------------------|-----------|
| 1 | api | BUILD (apps/api) | **slim-core** | One of the 6 named in success criterion #1. |
| 2 | web | BUILD (apps/web) | **slim-core** | One of the 6 named. |
| 3 | worker | BUILD (apps/worker) | **slim-core** | One of the 6 named. BullMQ consumer; depends on valkey + postgres. |
| 4 | postgres | BUILD (compose/postgres) | **slim-core** | One of the 6 named. PG 17 with custom init. |
| 5 | valkey | valkey/valkey:8.1-alpine | **slim-core** | One of the 6 named. BullMQ + rate-limit + WS fan-out. |
| 6 | litellm | ghcr.io/berriai/litellm:main-v1.83.14-stable | **slim-core** | One of the 6 named. Bundled OSS default; corp overrides via `LITELLM_BASE_URL`. |
| 7 | migrate | BUILD (apps/api migrations) | **slim-core** (init-only) | Run-once dependency of api; cannot move to overlay (api won't boot without it). Treat as side-car init container in Helm. Stays in base. |
| 8 | pgbouncer | edoburu/pgbouncer:v1.25.1-p0 | **`compose/docker-compose.pgbouncer.yml`** | Success criterion #2 names `pooler.enabled`. See "Tricky cases" — wire api/worker `DATABASE_URL` via env: direct-PG when overlay off, pgbouncer:6432 when on. |
| 9 | minio | minio/minio:... | **`compose/docker-compose.storage.yml`** | Success criterion #2 → `storage.enabled`. BYOK `S3_ENDPOINT` when overlay off. |
| 10 | traefik | traefik:v3.6 | **`compose/docker-compose.ingress.yml`** | Success criterion #2 → `tls.enabled`. See "Tricky cases" — apps must expose host ports directly when overlay off. |
| 11 | otel-collector | otel/opentelemetry-collector-contrib:0.151.0 | **`compose/docker-compose.observability.yml`** | Success criterion #2 → `observability.enabled`. App SDK degrades silently when `OTEL_EXPORTER_OTLP_ENDPOINT` unset; loud-fails when set-but-unreachable (BYOK-02). |
| 12 | loki | grafana/loki:3.5.0 | **`compose/docker-compose.observability.yml`** | Logs sink; belongs with observability. |
| 13 | tempo | grafana/tempo:2.8.0 | **`compose/docker-compose.observability.yml`** | Traces sink. |
| 14 | mimir | grafana/mimir:2.16.0 | **`compose/docker-compose.observability.yml`** | Metrics sink. |
| 15 | grafana | grafana/grafana:11.6.0 | **`compose/docker-compose.observability.yml`** | UI on top of Loki/Tempo/Mimir. |
| 16 | mailpit | axllent/mailpit:v1.29 | **`compose/docker-compose.dev-tools.yml`** | TD-14.a — dev SMTP capture. Production operators BYOK `SMTP_HOST`. |
| 17 | fixture-idp | BUILD | **`compose/docker-compose.dev-tools.yml`** (or load-test) | Phase 02 OAuth IdP fixture. Currently gated `profiles: [contract-test]` in main file. Recommendation: move under `compose/e2e/` or new `dev-tools.yml` — it has NO place in a slim-core base. Operator running prod never invokes it. |
| 18 | seed | image: openwhispr-api | **`compose/docker-compose.dev-tools.yml`** | Test fixture seeder; profile-gated `contract-test`. Same logic as fixture-idp. |
| 19 | contract-test-runner | BUILD | **`compose/docker-compose.dev-tools.yml`** (or **DELETED** from main, kept only as contract-tests compose) | Runs `packages/contract-tests` against api. Belongs in CI / dev-tools, not base. Currently profile-gated `contract-test`. |

### Net result: slim-core = 7 services (6 user-facing + migrate as init dependency)

The success criterion #1 says "exactly 6 services". `migrate` is a **run-once init container** (`restart: "no"`), not a long-running service. Two valid interpretations:
- **(A)** Count `migrate` as part of api (initContainer pattern in Helm). `docker compose ps` shows 6 long-running, plus 1 exited. This matches success criterion #1 strictly.
- **(B)** Fold migration into api entrypoint script (api waits for migrations to finish before serving). Removes the service entirely.

**Recommendation: (A).** Phase 09 Helm already models migrate as a Job (one-shot), so the 1:1 mapping holds. Keeping migrate as its own compose service preserves operator visibility (`docker compose logs migrate`) without violating the 6-service spirit (it exits cleanly).

## Tricky cases (resolved)

### Speaches
**Not present in main `docker-compose.yml`.** Already lives in:
- `compose/speaches/` (config dir, empty currently)
- `docker-compose.load-test.realistic.yml` (as a load target)
- `docker-compose.embedded-litellm.yml` (Variant A)
- `examples/docker-compose.local-speaches.yml` (Variant C — Phase 11 output)

**Routing decision: NO CHANGE.** Speaches stays where Phase 11 put it (Variant C example overlay). Phase 14 does NOT touch Speaches. Default LiteLLM routes ASR to OpenAI/OpenRouter via BYOK keys per `feedback_no_bundled_local_models`.

### mock-litellm
**Already separate.** Lives in `compose/mock-litellm/` (TS source) and is wired in `docker-compose.load-test.yml`. **Routing decision: NO CHANGE.** Stays out of base. Phase 14 only confirms it must NOT be pulled into `docker-compose.yml`.

### e2e service(s)
`compose/e2e/docker-compose.e2e.yml` declares `litellm` (overrides) and `mock-realtime` for Phase 04. **Routing decision: NO CHANGE.** Phase 14 does not touch e2e overlay. Slim-core base must not pull from it.

### pgbouncer in base or overlay?
**Routing: overlay (`compose/docker-compose.pgbouncer.yml`).** Risk: Phase 06 integration tests connect via pgbouncer:6432.

**Resolution mechanism:**
1. api/worker read `DATABASE_URL` (one env var). Default in `.env.slim.example` = `postgres://app:...@postgres:5432/openwhispr` (direct).
2. When operator opts in: `docker compose -f docker-compose.yml -f compose/docker-compose.pgbouncer.yml up` AND sets `DATABASE_URL=postgres://app:...@pgbouncer:6432/openwhispr` (commented-out alt line in `.env.slim.example`).
3. Integration tests (Phase 06) explicitly compose-up with the overlay — they set the pgbouncer URL in test env. They do NOT assume base wiring.

**No test regression expected** as long as Phase 14 plan updates the test compose invocation to `-f docker-compose.yml -f compose/docker-compose.pgbouncer.yml`. Auditor must verify Phase 06 testcontainer harness reads compose path from env, not a hard-coded constant.

### traefik in base or overlay?
**Routing: overlay (`compose/docker-compose.ingress.yml`).** Risk: Better Auth `trustedOrigins` + Phase 13 Playwright `baseURL`.

**Current state:** Phase 02.18/02.19 hard-wired traefik for X-Forwarded-* propagation and Better Auth rate-limit IP visibility (per Phase 02 summaries). The app DOES depend on traefik for the production HTTPS path.

**Resolution:** When ingress overlay is OFF:
- api binds `0.0.0.0:4000` directly; web binds `0.0.0.0:3000` directly.
- Better Auth `trustedOrigins` reads from env `INGRESS_BASE_URL` (BYOK-03) which defaults to `http://localhost:3000` in `.env.slim.example`.
- Rate-limit IP comes from `request.ip` (Fastify trust-proxy = false) rather than X-Forwarded-For. Operator running behind their own LB sets `TRUST_PROXY=1`.
- Phase 13 e2e fixture must spin up `-f compose/docker-compose.ingress.yml` because its scenarios assert HTTPS + traefik header propagation.

Slim-core OSS user gets **plain HTTP localhost:3000 by default**. This is acceptable per success criterion #1 ("brings up exactly 6 services on a clean clone"). HTTPS is opt-in via ingress overlay.

### OTel collector
**Routing: overlay (`compose/docker-compose.observability.yml`).**

Re-reading success criterion #3 verbatim: "the api refuses to start (loud-fail) when an overlay is OFF AND the corresponding BYOK env is unset".

The BYOK env for observability is `OTEL_EXPORTER_OTLP_ENDPOINT`. Logic:

| Overlay state | `OTEL_EXPORTER_OTLP_ENDPOINT` | api behavior |
|---|---|---|
| OFF | unset | **loud-fail at boot** with typed error (per criterion #3) |
| OFF | set, unreachable | loud-fail per BYOK-02 (existing rule) |
| OFF | set, reachable (corp OTel) | OK — exports to corp endpoint |
| ON | set to `http://otel-collector:4317` (default) | OK — exports to overlay collector |
| ON | overridden | OK |

This means **slim-core `.env.slim.example` MUST include `OTEL_EXPORTER_OTLP_ENDPOINT`** pointing at *something*. Two options for the default:
- **(a)** `OTEL_EXPORTER_OTLP_ENDPOINT=none` (sentinel that disables exporter; SDK becomes no-op). Requires app code change to interpret `none`.
- **(b)** Slim default ships with observability overlay ON and `.env.slim.example` points at `otel-collector:4317`, contradicting success criterion #1.

**Recommendation: (a)** — introduce a sentinel `OTEL_EXPORTER_OTLP_ENDPOINT=disabled` (or treat unset-with-explicit-flag `OBSERVABILITY_DISABLED=1` as the disabling switch). This needs ratification — see Open questions.

## Mapping to Helm `*.enabled` toggles

| Overlay (Phase 14) | Helm toggle | Status | Source |
|---|---|---|---|
| `compose/docker-compose.observability.yml` | `observability.enabled` | **new** (Phase 14 must add) | Roadmap line 740 |
| `compose/docker-compose.storage.yml` | `storage.enabled` | **new** | Roadmap line 740 |
| `compose/docker-compose.ingress.yml` | `tls.enabled` (also gates cert-manager sub-chart per Phase 16) | partial — `ingress.*` exists in `values.yaml`; rename to `tls.enabled` | Roadmap line 740 |
| `compose/docker-compose.pgbouncer.yml` | `pooler.enabled` | **new** | Roadmap line 740 |
| `compose/docker-compose.dev-tools.yml` | `mailpit.enabled` (covers mailpit; fixture-idp/seed/contract-test-runner stay OUT of Helm — dev-only) | **new** | Roadmap line 740, TD-14.a |

BYOK-01 (1:1 overlay ↔ Helm toggle) is achievable: each of the 5 overlays maps to exactly one top-level boolean in `charts/openwhispr/values.yaml`. The `dev-tools` overlay maps narrowly to `mailpit.enabled` because fixture-idp/seed/contract-test-runner are dev/test-only and should never render in a Helm chart at all (Phase 09 chart already excludes them — verified by reading `09-01-SUMMARY.md` which enumerates `api/web/worker/litellm` Deployments and no test fixtures).

## Open questions for the user

1. **`migrate` service status (success criterion #1 strict-6 interpretation).** Treat `migrate` as init-container counted within api (option A above), or fold into api entrypoint script (option B)? Recommendation: A.
2. **OTel disable sentinel.** When observability overlay is OFF, what disables the api's OTel SDK without violating loud-fail? Options: `OTEL_EXPORTER_OTLP_ENDPOINT=disabled` sentinel, or new `OBSERVABILITY_DISABLED=1` flag. App-side change required either way.
3. **`fixture-idp` / `seed` / `contract-test-runner` final home.** Three options: (a) `compose/docker-compose.dev-tools.yml` alongside mailpit, (b) new `compose/docker-compose.contract-test.yml` dedicated to contract harness, (c) delete from compose entirely and run via testcontainers from `packages/contract-tests`. Recommendation: (b) — keeps `dev-tools` semantically clean (mailpit only, matches `mailpit.enabled` Helm toggle 1:1) and contract-test harness becomes its own opt-in overlay parallel to load-test/e2e.
4. **`.env.slim.example` exact key list.** TD-14.g says "~5 keys" but does not enumerate. Proposed 5: `POSTGRES_APP_PASSWORD`, `VALKEY_PASSWORD`, `LITELLM_MASTER_KEY`, `BETTER_AUTH_SECRET`, `OPENROUTER_API_KEY` (or `OPENAI_API_KEY`). Needs ratification — currently `.env.embedded.example` lists 12.
5. **Phase 14 ↔ 15 order.** Roadmap line 746 flags this open. ARCHITECTURE recommends 15 first (compose dir reorg), user-confirmed order is 14 first. If 15 lands first, Phase 14's overlay file paths shift from `compose/docker-compose.*.yml` to a yet-unspecified `compose/<reorg>/*.yml` — re-affirm before plan authoring.
