---
phase: 14
phase_name: Slim Core + BYOK Profiles v2
researched: 2026-05-14
researcher: gsd-researcher
confidence: HIGH (codebase-grounded)
inputs:
  - 14-CONTEXT.md (locked decisions — do NOT re-litigate)
  - 14-RESEARCH-loud-fail.md (advisor — option E confirmed)
  - 14-RESEARCH-noopx.md (advisor — option 4 confirmed)
  - 14-RESEARCH-env-slim.md (advisor — option B confirmed)
  - 14-RESEARCH-slim-core-map.md (advisor — 19-service routing confirmed)
---

# Phase 14 — Implementation Research

This document captures the mechanical facts the planner needs in order to slice
Phase 14 into ≤ 6 plans without re-deciding anything that CONTEXT.md already
locked. **Every decision in §A-G of this file is derivative of CONTEXT.md.**

---

## A. Current compose ground truth

### A.1 `docker-compose.yml` — 19-service inventory

Source: `/Users/nick/openwhispr-server/docker-compose.yml` (871 lines).

The `version:` key is absent (Compose Spec v2). One bridge network
`openwhispr_internal`. Seven named volumes at top-level.

| # | Service | Image / build | profiles | depends_on (condition) | healthcheck | env_file | host ports | line |
|---|---------|---------------|----------|------------------------|-------------|----------|------------|------|
| 1 | `postgres` | build `compose/postgres` → `openwhispr/postgres:17.5-pgpartman` | `[default, db-only]` | — | pg_isready | (env block) | none | 29-80 |
| 2 | `pgbouncer` | `edoburu/pgbouncer:v1.25.1-p0` | `[default, db-only]` | `postgres: service_healthy` | pg_isready local 5432 | (env block) | none | 86-113 |
| 3 | `valkey` | `valkey/valkey:8.1-alpine` | `[default]` | — | valkey-cli ping | (env block) | none | 115-128 |
| 4 | `minio` | `minio/minio:RELEASE.2025-09-07T16-13-09Z` | `[default]` | — | curl /minio/health/live | (env block) | none | 130-145 |
| 5 | `traefik` | `traefik:v3.6` | `[default]` | — | `traefik healthcheck --ping` | — | **80, 443, 8443, 8080** | 147-193 |
| 6 | `otel-collector` | `otel/opentelemetry-collector-contrib:0.151.0` | `[default, obs-only, load-test-mock, load-test-realistic]` | `loki: service_healthy`, `tempo: service_healthy`, `mimir: service_started` | **none** (distroless) | — | none | 195-216 |
| 7 | `loki` | `grafana/loki:3.5.0` | `[default, obs-only, load-test-mock, load-test-realistic]` | — | wget /ready | — | none | 218-229 |
| 8 | `tempo` | `grafana/tempo:2.8.0` | `[default, obs-only, load-test-mock, load-test-realistic]` | — | `/busybox/wget --spider /ready` | — | none | 231-251 |
| 9 | `mimir` | `grafana/mimir:2.16.0` | `[default, obs-only]` | — | **none** (distroless) | — | none | 253-270 |
| 10 | `grafana` | `grafana/grafana:11.6.0` | `[default, obs-only]` | `loki: service_healthy`, `tempo: service_healthy`, `mimir: service_started` | wget /api/health | — | none | 272-307 |
| 11 | `migrate` | build `apps/api/Dockerfile` | `[default, db-only, load-test-mock, load-test-realistic]` | `postgres: service_healthy`, `pgbouncer: service_healthy` | — (`restart: "no"`) | `.env` | none | 319-335 |
| 12 | `litellm` | `ghcr.io/berriai/litellm:main-v1.83.14-stable` | `[default]` | `postgres: service_healthy`, `migrate: service_completed_successfully` | python urllib `/health/liveliness` | — (env block) | none | 353-402 |
| 13 | `api` | build `apps/api/Dockerfile` | `[default]` | `migrate: service_completed_successfully`, `litellm: service_healthy`, `pgbouncer: service_healthy`, `valkey: service_healthy`, `otel-collector: service_started`, **`mailpit: service_healthy`** | wget /api/health | `.env` | none | 412-537 |
| 14 | `worker` | build `apps/worker/Dockerfile` | `[default]` | `litellm: service_healthy`, `valkey: service_healthy`, `migrate: service_completed_successfully`, `otel-collector: service_started` | — | `.env` | none | 554-600 |
| 15 | `web` | build `apps/web/Dockerfile` | `[default]` | `api: service_healthy` | wget /api/health | `.env` | none (Traefik labels) | 625-699 |
| 16 | `mailpit` | `axllent/mailpit:v1.29` | `[default, dev, load-test-mock, load-test-realistic]` | — | wget /livez ‖ /api/v1/info | — | `127.0.0.1:8025:8025` | 714-735 |
| 17 | `fixture-idp` | build `tests/fixtures/idp` | `[contract-test]` | — | wget /livez | — | none | 742-755 |
| 18 | `seed` | `image: openwhispr-api` | `[contract-test]` | `api: service_healthy` | — (`restart: "no"`) | `.env` | none | 765-787 |
| 19 | `contract-test-runner` | build `packages/contract-tests/Dockerfile` → `openwhispr-contract-test-runner` | `[contract-test]` | `api: service_healthy`, `fixture-idp: service_healthy` | — (`restart: "no"`) | `.env` | none | 808-871 |

**Volumes (7):** `postgres_data`, `valkey_data`, `minio_data`, `loki_data`,
`tempo_data`, `mimir_data`, `grafana_data`. Each follows its service into the
overlay automatically — overlay declares the service, base-level volumes block
moves with it.

**Critical cross-service couplings** discovered while reading:

- `api.depends_on` includes `mailpit: service_healthy` (line 529-530, promoted
  Phase 07.1 / Plan 13.3). When the `dev-tools` overlay is OFF this dependency
  must be conditional (or removed from base, see §C).
- `api.depends_on` includes `otel-collector: service_started`, `pgbouncer:
  service_healthy`. Both must be conditional (overlays OFF).
- `worker.depends_on` includes `otel-collector: service_started`. Conditional.
- `migrate.depends_on` includes `pgbouncer: service_healthy` (line 329-330).
  Conditional. **Note:** the comment at line 309-314 says migrate goes DIRECT
  to `postgres:5432` (NOT pgbouncer), so the `pgbouncer: service_healthy`
  gate is purely a sequencing barrier that should be lifted when pgbouncer is
  in an overlay.
- `litellm.depends_on` includes `postgres: service_healthy` (line 388-389) —
  litellm shares the PG cluster, separate DB. No change needed.

### A.2 Sibling compose files

Source: lines + service count summary.

| File | Lines | Services declared / overridden | Purpose |
|------|-------|-------------------------------|---------|
| `docker-compose.embedded-litellm.yml` | 754 | 16 (postgres, pgbouncer, valkey, minio, traefik, otel-collector, loki, tempo, mimir, grafana, migrate, litellm, api, worker, web, mailpit) — full Variant A reimplementation, NOT a delta overlay | Phase 11 canonical Variant A. **Independently bootable.** Has its own `OTEL_EXPORTER_OTLP_ENDPOINT` defaults (lines 518, 599). |
| `docker-compose.load-test.yml` | 435 | 9 (postgres, pgbouncer, valkey, api, traefik, mimir, grafana, litellm, speaches) | k6 load harness |
| `docker-compose.load-test.realistic.yml` | 93 | 2 (litellm, api) | Realistic profile delta |
| `compose/e2e/docker-compose.e2e.yml` | 88 | 2 (litellm, mock-realtime) | Phase 04 e2e overlay |
| `compose/live-soak/docker-compose.live.yml` | 53 | 1 (litellm) | Phase 12 long-soak |

**These 5 sibling files are NOT touched by Phase 14** (CONTEXT.md §1
"Untouched"). They will be reorganised by Phase 15.

### A.3 Hard-coded service-name references in repo (overlay-impact map)

The planner must verify these still work when a service moves to an opt-in overlay.

**`pgbouncer:6432` hard-codes:**

| File:Line | Context | Action on overlay-OFF |
|-----------|---------|----------------------|
| `compose/grafana/provisioning/datasources/postgres.yaml:32` | Grafana Postgres datasource URL `pgbouncer:6432` | Grafana lives in observability overlay; this file is read only when grafana is up. If pgbouncer overlay is OFF but observability is ON, datasource will fail to resolve → either (a) flip datasource URL to `postgres:5432` direct, or (b) document that observability + pooler must be enabled together for the Postgres datasource. **Recommend (a):** Grafana datasource pointing at direct postgres works regardless of pgbouncer overlay. |

**`traefik` hard-codes (production paths that fail without ingress overlay):**

| File:Line | Context | Action on overlay-OFF |
|-----------|---------|----------------------|
| `tests/integration/traefik-network-alias.test.ts:67-79` | Integration test asserts `traefik.networks.openwhispr_internal.aliases` contains `api.localhost`, `auth.localhost` | This test reads the **merged** compose tree. When ingress overlay is OFF, the test should be re-targeted at the merged base+ingress.yml or skipped via env gate. |
| `tools/lint-compose-chart-parity.test.ts:152, 165, 167, 170, 210, 212, 214, 272` | Parity linter allowlist includes `traefik` as a `cluster-prereq` | The lint tool needs to know about overlay services. Phase 14 must update the allowlist to recognize overlay-resident services (no longer in base). |
| `apps/web` Traefik router labels (`docker-compose.yml:676-699`) | `traefik.enable=true`, `traefik.http.routers.web.rule=Host(api.localhost)`, basicauth middleware refs | Labels are passive metadata. When traefik is absent (ingress overlay OFF), labels are no-ops. **No code change needed**, but the web app must expose port 3000 directly to host. The current compose has NO `ports:` block on web (line 625-699 — only Traefik publishes). The ingress overlay needs to keep that pattern; the **base** needs to ADD `ports: [3000:3000]` to web AND `ports: [4000:3000]` to api so slim-core works without Traefik. **This is a base-compose edit Phase 14 must include.** |

**`mailpit` hard-codes:**

| File:Line | Context | Action on overlay-OFF |
|-----------|---------|----------------------|
| `tests/e2e-cjm/support/mailpit-helper.ts:28` | `process.env.MAILPIT_API_URL ?? "https://mailpit.localhost/api/v1"` | env-overridable. e2e-cjm boots its own stack with embedded-litellm overlay (which includes mailpit). Phase 14 must ensure e2e-cjm pulls `dev-tools` overlay OR keep mailpit in the embedded-litellm sibling. |
| `packages/email/src/EmailSender.test.ts:72, 180, 191, 409` | Tests use literal `SMTP_HOST: "mailpit"` | Unit tests; do not boot mailpit. **No change.** |
| `apps/api` env block reference: `docker-compose.yml:529` `mailpit: service_healthy` in `api.depends_on` | Hard-couples api boot to mailpit | **Must be removed from base** when mailpit moves to dev-tools overlay. Either (a) drop the `depends_on`, OR (b) make it conditional via overlay-merge (overlay re-declares api.depends_on adding mailpit). **Recommend (a):** drop from base; the SMTP_HOST loud-fail (existing in `EmailSender.ts:74-91`) handles the missing-SMTP case; api does not need mailpit healthy at boot. |

**`otel-collector` hard-codes:**

| File:Line | Context | Action on overlay-OFF |
|-----------|---------|----------------------|
| `docker-compose.yml:497, 578` | `OTEL_EXPORTER_OTLP_ENDPOINT: ${OTEL_EXPORTER_OTLP_ENDPOINT:-http://otel-collector:4317}` (api + worker) | When overlay OFF the default `http://otel-collector:4317` resolves to nothing. Two fixes needed in BASE compose: (1) drop the `:-http://otel-collector:4317` fallback (no magic default — operator must set it); (2) keep `OTEL_EXPORTER_OTLP_ENDPOINT: ${OTEL_EXPORTER_OTLP_ENDPOINT}` (no fallback) so an unset env produces the loud-fail. The overlay re-declares with `:-http://otel-collector:4317` default. |
| `docker-compose.yml:521-522` `api.depends_on: otel-collector: service_started` | Hard-couples api boot to otel-collector | **Must be removed from base** when overlay is OFF. Same fix as mailpit above (recommend: drop from base; overlay adds it back). |
| `docker-compose.yml:598-599` `worker.depends_on: otel-collector: service_started` | Same as api | Same fix. |
| `apps/api/src/otel-bootstrap.ts` (entire file) | Reads `OTEL_EXPORTER_OTLP_ENDPOINT` via NodeSDK default | Needs `=disabled` sentinel handling — see §F. |
| `apps/worker/src/otel-bootstrap.ts:18` | Comment "defaults to http://otel-collector:4317 in compose" | Same. |
| `tests/integration/observability-stack-up.test.ts:25` | `SERVICES = ["tempo", "mimir", "loki", "otel-collector"]` integration test boots them | Test pulls observability overlay explicitly. Update to use `-f compose/docker-compose.observability.yml`. |

**`minio` hard-codes:**

| File:Line | Context | Action on overlay-OFF |
|-----------|---------|----------------------|
| `charts/openwhispr/templates/api-deployment.yaml:123`, `worker-deployment.yaml:88` | `MINIO_ENDPOINT` env var | Helm chart already declares it as opt-in. **No compose change.** |

### A.4 `OTEL_EXPORTER_OTLP_ENDPOINT` consumers

Authoritative list (every place this env is read or interpolated):

| File:Line | Type | Behavior |
|-----------|------|----------|
| `apps/api/src/otel-bootstrap.ts:77-80` | **Runtime read** | `new NodeSDK({ serviceName: …, instrumentations: […] })` — NodeSDK auto-reads `OTEL_EXPORTER_OTLP_ENDPOINT` from `process.env`. **No explicit code-side read** in the file as-is. Add `=disabled` short-circuit BEFORE constructing NodeSDK. |
| `apps/api/src/otel-bootstrap.ts:78` | Read | `process.env.OTEL_SERVICE_NAME` (related, not the endpoint) |
| `apps/worker/src/otel-bootstrap.ts` | Runtime read | Same — NodeSDK auto-read |
| `docker-compose.yml:497` | Compose env injection | `api` service `OTEL_EXPORTER_OTLP_ENDPOINT: ${OTEL_EXPORTER_OTLP_ENDPOINT:-http://otel-collector:4317}` — **drop the `:-` fallback** in Phase 14 base; let unset propagate. |
| `docker-compose.yml:578` | Compose env injection | `worker` service — same |
| `docker-compose.embedded-litellm.yml:518, 599` | Compose env injection | Sibling file — Phase 14 does NOT touch. |
| `.env.example` (no line — absent) | — | `.env.example` does NOT declare `OTEL_EXPORTER_OTLP_ENDPOINT`. Phase 14 `.env.slim.example` must include `OTEL_EXPORTER_OTLP_ENDPOINT=disabled` as a default. |

### A.5 Virtual-key-rotation consumers (full removal map)

The constitutional rule "no internal mocks in production code" requires
removing every reference below. Total removal scope: **8 files, ~30 LOC + 1
whole file**.

| File:Line | What to remove | Reason |
|-----------|----------------|--------|
| `apps/worker/src/index.ts:61` | `import { …, type LiteLlmKeyClient, type UserKeyLookup } from "./jobs/virtual-key-rotation.js";` | Type imports for noop adapters |
| `apps/worker/src/index.ts:60-62` | `buildVirtualKeyRotationHandler` import | Handler |
| `apps/worker/src/index.ts:79-86` | `const noopLitellmKeyClient: LiteLlmKeyClient = {…}` | Adapter 1 |
| `apps/worker/src/index.ts:87-94` | `const noopUserKeyLookup: UserKeyLookup = {…}` | Adapter 2 |
| `apps/worker/src/index.ts:137-145` | `const vkrWorker = new Worker(QUEUE_NAMES.virtualKeyRotation, buildVirtualKeyRotationHandler({…noopLitellmKeyClient, noopUserKeyLookup}), { connection })` | Worker registration |
| `apps/worker/src/index.ts:190-200` | `workers` array entry `vkrWorker` | Drain list |
| `apps/worker/src/index.ts:32` | Header comment block referencing virtual-key-rotation | Tidy |
| `apps/worker/src/queues.ts:17` | `import { virtualKeyRotationSchema } from "./jobs/virtual-key-rotation.js";` | Schema import |
| `apps/worker/src/queues.ts:22` | `virtualKeyRotation: "virtual-key-rotation",` | QUEUE_NAMES entry |
| `apps/worker/src/queues.ts:33` | `virtualKeyRotation: TypedQueue<typeof virtualKeyRotationSchema>;` | Type entry |
| `apps/worker/src/queues.ts:58` | `virtualKeyRotation: typedQueue(…)` | Registry construction |
| `apps/worker/src/queues.ts:83` | `reg.virtualKeyRotation.close()` | Close list |
| `apps/worker/src/scheduler.ts:15` | Comment row for virtual-key-rotation cron schedule | Tidy |
| `apps/worker/src/scheduler.ts:20` | Header comment | Tidy |
| `apps/worker/src/scheduler.ts:43` | `virtualKeyRotationCron?: string;` (config type) | Config |
| `apps/worker/src/scheduler.ts:50` | `virtualKeyRotationCron: "0 3 * * 0"` default | Config default |
| `apps/worker/src/scheduler.ts:89-98` | `await registry.virtualKeyRotation.upsertJobScheduler(…)` | Enqueuer |
| **`apps/worker/src/jobs/virtual-key-rotation.ts`** | **DELETE entire file** | Handler module |
| **`apps/worker/src/jobs/virtual-key-rotation.test.ts`** | **DELETE entire file** | Handler tests |
| `apps/worker/src/queues.test.ts:41` | `virtualKeyRotation: "virtual-key-rotation",` expectation | Update queue inventory test |
| `apps/worker/src/scheduler.test.ts:41` | `virtualKeyRotation: makeQueueStub()` registry stub | Update |
| `apps/worker/src/scheduler.test.ts:90-130` | "upserts virtual-key-rotation at 0 3 * * 0" test + tunables test | **DELETE** |
| `docs/architecture.md:263` | `Q2[virtual-key-rotation]` diagram label | Tidy |
| `tests/e2e/log-scrub-sentinel.test.ts:109-123` | E2E test that enqueues a virtual-key-rotation job to exercise log scrubbing | **REWRITE** to use a different queue (e.g., `email-delivery` with a fixture payload), OR drop the scenario and pick a survivor queue. Plan must decide. |

**Confirmation that `noopLitellmKeyClient` and `noopUserKeyLookup` are
exclusively consumed by virtual-key-rotation:** verified by `rg` —
both names appear ONLY in `apps/worker/src/index.ts:79-94, 141-142`, never
elsewhere. Cron tick (scheduler.ts:91-98) is the ONLY enqueuer.

**Side effect of removal:** BullMQ key-prefix `bull:virtual-key-rotation:*`
will accumulate stale repeatable-job metadata in Valkey on operator
upgrade-in-place. Phase 14 must include a one-shot cleanup step OR document
in operations.md that operators run `valkey-cli DEL bull:virtual-key-rotation:*`
after upgrade. **Recommend: include cleanup in `apps/worker/src/index.ts`
boot (transient, idempotent, easy to remove later) OR a migration note.**
Planner decides.

---

## B. Compose overlay mechanics

### B.1 `docker compose -f base.yml -f overlay.yml` merge semantics

**Authoritative source:** [Docker Compose: Merge multiple Compose files](https://docs.docker.com/compose/multiple-compose-files/merge/).

Merge rules (paraphrased, then verified against `compose/e2e/docker-compose.e2e.yml`):

1. **Order: last-wins for scalars.** Later `-f` files override base values for
   primitive fields (image, build, environment values).
2. **Lists merge by APPEND, deduplicated, EXCEPT:**
   - `depends_on`: merged (entries with same key are deduplicated; conditions
     from later file override). **Verified mechanism for our case:** base
     `api.depends_on: [postgres, …]` + overlay `api.depends_on: [pgbouncer]`
     ⇒ merged `[postgres, …, pgbouncer]`. Cited: official docs "When the
     order of declarations differs across files, Compose adopts a merge
     strategy."
   - `volumes` (under a service): merged.
   - `ports`: merged but duplicates flagged at runtime (host-port clash).
3. **Maps deep-merge** (`environment`, `labels`).
4. **`profiles`** at service level: later overrides — but Phase 14 will be
   **removing `profiles:` from base entirely** (see G.3), so this is moot.

**Local precedent — `compose/e2e/docker-compose.e2e.yml`:** declares `litellm`
and `mock-realtime` services. The `litellm` block PARTIALLY overrides base
(adds env, replaces image to mock variant). This pattern is the closest local
analog and confirms: **overlay files in this repo declare service-level
overrides without re-declaring unrelated services.**

### B.2 Helm chart current structure (relevant subset)

**File:** `charts/openwhispr/values.yaml`.

**Existing toggles found via `grep "\\.enabled"`:**

| Path | Default | Templates using it |
|------|---------|-------------------|
| `serviceAccount.create` | true | `serviceaccount.yaml:1` |
| `secrets.mode` (`helm-values` / `eso`) | helm-values | `externalsecret.yaml`, `secrets.yaml` |
| `bundledAi.enabled` | false | (Wave 2, no template renders today) |
| `observability.embedded` | false | (informational) |
| `observability.serviceMonitor.enabled` | false | `api-servicemonitor.yaml:7`, `worker-servicemonitor.yaml:5` |
| `observability.collector.enabled` | false | `otel-collector-{configmap,clusterrole,clusterrolebinding,daemonset,serviceaccount}.yaml` |
| `litellm.embedded` | true | `litellm-deployment.yaml:18`, `litellm-service.yaml:6`, `configmap-litellm.yaml:9` |
| `postgres.backup.enabled` | false | `postgres-cluster.yaml:131` |
| `minio.enabled` (Bitnami sub-chart) | true | (sub-chart conditional via Chart.yaml dependencies) |
| `valkey.enabled` (Bitnami sub-chart) | true | (sub-chart conditional) |
| `pooler.enabled` | **true** | `pooler.yaml:11` — **already exists!** |
| `helperProbe.enabled` | false | `probe-helpers.yaml:18` |
| `certManager.enabled` | true | `certificate-api.yaml:13`, `certificate-web.yaml:12` |
| `api.autoscaling.enabled` | true | `api-hpa.yaml:7` |
| `worker.autoscaling.enabled` | true | `worker-hpa.yaml:7` |
| `worker.autoscaling.queueDepthMetric` | false | `worker-hpa.yaml:31` |
| `networkPolicy.enabled` | false | (no template renders today) |
| `api.env.disableEmailVerification` | false | `api-deployment.yaml:144` |
| `ingress.preflightCheck` | true | `api-deployment.yaml:72-90` |
| `ingress.*` (no top-level `enabled`) | — | many templates |

**Critical findings vs CONTEXT.md decision 6:**

- `pooler.enabled` ALREADY exists and is wired (`pooler.yaml:11`,
  defaults `true`). Phase 14 work: **flip default to `false`** (per slim-core
  philosophy — operator opts in) AND audit that all api/worker deployments
  read `DATABASE_URL` without assuming pooler. **Decision needed by planner:**
  is the Helm slim-core default ALSO `pooler.enabled=false`, or does Helm
  default `true` (cloud-HA mode) while compose defaults overlay-OFF? CONTEXT
  decision 6 says 1:1 with overlay. Recommend Helm default `false` to match.
- `observability.serviceMonitor.enabled` AND `observability.collector.enabled`
  ALREADY exist as two separate toggles. CONTEXT.md decision 6 says ONE
  `observability.enabled`. **Planner must choose:** (a) replace the two with
  a single `observability.enabled` (gates both); (b) introduce `observability.enabled`
  as an umbrella that defaults the two sub-toggles. **Recommend (b)** — avoids
  breaking Phase 09 operators on upgrade; new top-level toggle is additive
  and the two sub-toggles continue to honor their explicit values when set.
- `storage.enabled` is **NEW** — no current Helm key. Compose `minio` lives
  in base today; Bitnami `minio` sub-chart is enabled by default. Phase 14
  must add `storage.enabled` AND wire it to gate the MinIO sub-chart's
  `minio.enabled` value via a `condition:` in Chart.yaml dependencies (or
  via a values transform in `_helpers.tpl`).
- `tls.enabled` is **NEW** — rename from `ingress.*` block (CONTEXT.md).
  **However:** the existing `ingress.*` keys carry NON-tls semantics too
  (`ingress.realtimeEntrypointName`, `ingress.preflightCheck`,
  `ingress.preflightTraefikAdminUrl`, `ingress.trustedIPs`, `ingress.className`).
  These are routing concerns, NOT TLS. **Planner decision:** when Phase 14
  renames `ingress.*` → `tls.*`, do these routing keys move to `tls.*` too,
  or stay under `ingress.*` while `tls.enabled` becomes the master toggle?
  **Recommend:** introduce top-level `tls.enabled` boolean; KEEP
  `ingress.realtimeEntrypointName` / `ingress.preflightCheck` /
  `ingress.preflightTraefikAdminUrl` / `ingress.trustedIPs` / `ingress.className`
  under `ingress.*` (these are non-toggle config knobs and renaming them is
  pure churn). The conditional `{{- if .Values.tls.enabled }}` gates which
  templates render.
- `mailpit.enabled` is **NEW** — no current Helm key. There is NO mailpit
  template today (mailpit is dev-only — Phase 09 already excluded it). Phase 14
  must ADD a `templates/mailpit-deployment.yaml` gated by `mailpit.enabled`.
  Confirm with planner whether Phase 14 actually wants a mailpit Helm template,
  or if `mailpit.enabled` is informational-only in Helm (compose-only feature).
  **Recommend: informational-only** — mailpit-on-K8s is not a real production
  pattern; the Helm key exists for 1:1 parity but renders nothing.

### B.3 Integration test harness — compose-file independence audit

**Verdict: integration tests are independent of the base compose file.**

Sources confirming:

- `packages/data/src/__tests__/helpers.ts:14` — `import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";`
- `packages/data/src/__tests__/helpers.ts:81` — `new PostgreSqlContainer(image)` — boots its own ephemeral Postgres, no compose file involved.
- `apps/api/src/routes/notes/__tests__/setup.ts:20, 63` — same pattern.
- All grep hits for `PostgreSqlContainer\|new GenericContainer\|DockerComposeEnvironment` in `apps/*` and `packages/*` use `@testcontainers/postgresql` direct (NO `DockerComposeEnvironment` invocations).

The e2e-cjm harness (`tests/e2e-cjm/support/compose-harness.ts`) DOES shell out
to `docker compose -f docker-compose.yml -f docker-compose.embedded-litellm.yml`
(lines 56-63). This is the ONLY suite that boots from the repo's compose files.
**Phase 14 must update `COMPOSE_FILES` in this file** if the slim-core base
removes services the e2e-cjm scenarios need (mailpit for verification emails,
pgbouncer for production-parity pooler tests, otel-collector if any scenario
asserts trace propagation, etc.). The simplest fix: add the matching overlays
to `COMPOSE_FILES`, e.g.

```ts
export const COMPOSE_FILES: readonly string[] = [
  "docker-compose.yml",
  "docker-compose.embedded-litellm.yml",
  "compose/docker-compose.observability.yml",  // if any cjm assertion uses traces
  "compose/docker-compose.pgbouncer.yml",      // for pooler-backed flows
  "compose/docker-compose.dev-tools.yml",      // for mailpit verification
  "compose/docker-compose.ingress.yml",        // for https://api.localhost
] as const;
```

The e2e-cjm world.ts `mailpitApiUrl` default (`https://mailpit.localhost/api/v1`)
also depends on the ingress overlay being up. **Plan must list this exact
edit.**

**Phase 06 integration tests do NOT need any compose-file change** —
testcontainers boot their own Postgres. Confirmed by direct file read.

---

## C. Helm chart impact

### C.1 Templates touched by each new toggle

For each of the 5 toggles in CONTEXT.md decision 6:

#### `observability.enabled` (NEW umbrella toggle)

**Recommend:** introduce `observability.enabled` top-level. When `false`,
short-circuit `observability.serviceMonitor.enabled` and
`observability.collector.enabled` regardless of their values. When `true`,
both sub-toggles honor their own values.

Templates already gated:
- `api-servicemonitor.yaml:7` — `{{- if .Values.observability.serviceMonitor.enabled -}}`
- `worker-servicemonitor.yaml:5` — same
- `otel-collector-configmap.yaml:24` — `{{- if .Values.observability.collector.enabled -}}`
- `otel-collector-clusterrole.yaml:10` — same
- `otel-collector-clusterrolebinding.yaml:6` — same
- `otel-collector-daemonset.yaml:20` — same
- `otel-collector-serviceaccount.yaml:11` — same

Phase 14 edit: gate each with the umbrella, e.g.
```yaml
{{- if and .Values.observability.enabled .Values.observability.collector.enabled -}}
```

#### `storage.enabled` (NEW)

Recommend wire as: `condition: storage.enabled` in `Chart.yaml` dependencies
block for the Bitnami minio sub-chart. Currently `minio.enabled` is the
sub-chart toggle; rename to use a `condition` field per Helm 3 standard.

```yaml
# Chart.yaml dependencies:
- name: minio
  version: 17.0.21
  repository: oci://registry-1.docker.io/bitnamicharts
  condition: storage.enabled
```

No templates in `charts/openwhispr/templates/` reference MinIO directly
(MinIO is a sub-chart). The api/worker deployments reference `MINIO_ENDPOINT`
env var (`api-deployment.yaml:123`, `worker-deployment.yaml:88`) but the
endpoint URL is supplied by `secrets.yaml` / `externalsecret.yaml` — not gated.
**Phase 14 must wire the `MINIO_ENDPOINT` env injection in
api/worker-deployment.yaml under `{{- if .Values.storage.enabled }}`** so
that with `storage.enabled=false` and no operator-supplied `S3_ENDPOINT`, the
api loud-fails per BYOK-02 (boot-time guard in `apps/api/src/lib/byok-guard.ts`).

#### `tls.enabled` (rename from `ingress.*` block)

**Templates currently gated by `certManager.enabled` (closely related):**
- `certificate-api.yaml:13`
- `certificate-web.yaml:12`

**Templates that reference `ingress.*` (move to `tls.*` master gate):**
- `ingressroute-api.yaml`
- `ingressroute-api-realtime.yaml:29` — `{{ .Values.ingress.realtimeEntrypointName }}`
- `ingressroute-web.yaml`
- `serverstransport-realtime.yaml`
- `middleware-forwarded-headers.yaml:22` — `{{- range .Values.ingress.trustedIPs }}`
- `api-deployment.yaml:72-90` — `{{- if .Values.ingress.preflightCheck }}` — preflight init container

Phase 14 edit: wrap each ingressroute template with
`{{- if .Values.tls.enabled -}}`. Keep all sub-keys (`realtimeEntrypointName`,
`trustedIPs`, `preflightCheck`, etc.) under `ingress.*`; they remain
non-toggle config. Add top-level boolean `tls.enabled` (default to whatever
matches OSS quickstart — recommend **`false`** for slim-core parity,
**`true`** for cloud-HA overlay values).

#### `pooler.enabled` (already exists)

Templates gated:
- `pooler.yaml:11` — `{{- if .Values.pooler.enabled -}}`
- `pooler-userlist-secret.yaml` — (verify; ungated today, may need gate)

Phase 14 edit: flip default from `true` to `false` in `values.yaml:172` to
match compose slim-core default. The api/worker deployments use
`DATABASE_URL` env (already operator-supplied via secret) so no other
template change needed.

#### `mailpit.enabled` (NEW)

No templates render today (Phase 09 excluded mailpit). Phase 14: ADD
`templates/mailpit-deployment.yaml` + `mailpit-service.yaml` gated by
`{{- if .Values.mailpit.enabled -}}` — OR (recommended) leave Helm side
template-less; document `mailpit.enabled` as **informational parity** for
documentation/compose-chart-parity linter only. The linter
`tools/lint-compose-chart-parity.test.ts` will flag this — Phase 14 must
update the linter's allowlist to recognize `mailpit` as a `dev-tools-only`
service that has no Helm template.

### C.2 helm-unittest snapshots

**No snapshot files exist.** Verified by `ls
charts/openwhispr/tests/__snapshot__/` returning empty.

All Phase 09 unit tests in `charts/openwhispr/tests/*_test.yaml` use
assertion-based helm-unittest (`asserts:` with `equal`, `matchRegex`,
`contains`, etc.) — NOT snapshot fixtures. **Conclusion: Phase 14 does NOT
need to update snapshot files.** It only needs to add new
`tests/<toggle>_test.yaml` cases for the 5 new/changed toggles
(observability, storage, tls, pooler-flip-default, mailpit).

Existing tests that will need to be updated:
- `ingress_test.yaml` — references `ingress.*` (currently rendered
  unconditionally). Phase 14 must add a `with .Values.tls.enabled=false`
  asserts-empty case (no IngressRoute manifests rendered).
- `pooler_test.yaml` — currently asserts pooler renders by default. Phase 14
  must update the default-render expectation OR explicitly set
  `pooler.enabled=true` in the test's `set:` block.
- `otel_test.yaml` — observability templates. Same pattern.

---

## D. `.env.slim.example` content + tools/bootstrap.sh

### D.1 `tools/bootstrap.sh` compatibility

Source: `/Users/nick/openwhispr-server/tools/bootstrap.sh:39, 191, 199-202`.

**Mechanism:**
- `ENV_EXAMPLE="${REPO_ROOT}/.env.example"` is hard-coded at line 39.
- Iterates EVERY `KEY=VALUE` line in `.env.example` (lines 92, 94 walks).
- For each key, if the value is `PLACEHOLDER_BOOTSTRAP_WILL_REPLACE` AND
  current `.env` value is empty/placeholder, regenerates via `gen_secret`
  (32 bytes base64url) — line 191-202.
- Special-cases `BACKUP_AGE_IDENTITY` via `gen_age_identity` (age-keygen).

**Required Phase 14 change:**

```bash
# tools/bootstrap.sh — Phase 14 edit
readonly ENV_EXAMPLE="${REPO_ROOT}/.env.example"
```

becomes

```bash
readonly ENV_EXAMPLE="${BOOTSTRAP_ENV_TEMPLATE:-${REPO_ROOT}/.env.slim.example}"
```

(or similar — planner decides exact env var name). Alternative: rename
`.env.example` to `.env.full.example` (per CONTEXT.md decision 4) AND ship
`.env.slim.example` as the new bootstrap default; bootstrap.sh hard-codes
the slim path. **Recommend: env-overridable** so the existing 90-key full
template can still be used for power-user operators who set
`BOOTSTRAP_ENV_TEMPLATE=.env.full.example`.

Bootstrap will fill our 5 new slim keys without further changes — they all
use the `PLACEHOLDER_BOOTSTRAP_WILL_REPLACE` literal (per CONTEXT.md decision
4's spec) and `gen_secret` produces 32-byte base64url which matches what
`BETTER_AUTH_SECRET` / `LITELLM_MASTER_KEY` need.

`POSTGRES_APP_PASSWORD` is the only key that's a Postgres password specifically
— base64url with `-` and `_` is valid for SCRAM-SHA-256 password. No special
handling.

`OPENROUTER_API_KEY` is operator-supplied (empty in template). Bootstrap will
NOT touch it because `.env.slim.example` ships it as empty string, NOT as
`PLACEHOLDER_BOOTSTRAP_WILL_REPLACE`.

`BETTER_AUTH_URL` defaults to `http://localhost:3000` (sane default). Bootstrap
will NOT regenerate (not a placeholder).

### D.2 90-key delta — dropped key triage

Source: full `grep -E "^[A-Z_]+=" .env.example | sort -u` = **88 distinct keys**
(prompt said "90", actual = 88 ignoring duplicates; close enough).

The 5 mandatory slim keys (CONTEXT.md): `POSTGRES_APP_PASSWORD`,
`BETTER_AUTH_SECRET`, `LITELLM_MASTER_KEY`, `BETTER_AUTH_URL`,
`OPENROUTER_API_KEY`.

Of the 83 keys NOT in slim, every key must fit one of three buckets:

#### Bucket A — derived (composed via `${VAR}` interpolation from a slim key)

| Key | Derived from |
|-----|--------------|
| `DATABASE_URL` | `${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}` |
| `DATABASE_URL_OWNER` | `${POSTGRES_OWNER_USER}:${POSTGRES_OWNER_PASSWORD}@…` |
| `VALKEY_URL` | `redis://:${VALKEY_PASSWORD}@valkey:6379/0` |
| `LITELLM_BASE_URL` | constant `http://litellm:4000` (default) |
| `LITELLM_DATABASE_URL` | derived from POSTGRES_OWNER_* + literal `/litellm` db name |
| `POSTGRES_OWNER_USER` | constant `openwhispr_owner` |
| `POSTGRES_APP_USER` | constant `openwhispr_app` |
| `POSTGRES_DB` | constant `openwhispr` |
| `POSTGRES_ADMIN_URL` | derived |
| `OPENWHISPR_API_URL` | `${BETTER_AUTH_URL}` (or `https://api.localhost`) |
| `AUTH_URL` | `${BETTER_AUTH_URL}` |

#### Bucket B — overlay-specific (move to commented appendix in same file)

| Key | Overlay |
|-----|---------|
| `POSTGRES_OWNER_PASSWORD` | (slim-core needs this too — actually belongs in slim, but `POSTGRES_APP_PASSWORD` is the operator-visible single key per CONTEXT.md decision 4. Owner password can be auto-generated by bootstrap and live in `.env.full.example`.) |
| `PGBOUNCER_ADMIN_PASSWORD` | pgbouncer overlay |
| `VALKEY_PASSWORD` | slim — needed by valkey base service (CONTEXT.md decision 4 lists only 5 input keys, so VALKEY_PASSWORD must also be in slim OR auto-generated by bootstrap and not user-visible). **Open question for planner:** is VALKEY_PASSWORD #6 (bumping CONTEXT to 6 keys) or bootstrap-generated invisible? Recommend bootstrap-generated invisible: it's never operator-facing if compose interpolates `${VALKEY_PASSWORD}` from `.env`. |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | storage overlay |
| `TRAEFIK_ADMIN_PASSWORD` | ingress overlay |
| `GRAFANA_ADMIN_PASSWORD` | observability overlay |
| `MASTER_KEK` | slim — security-critical, must be in slim or bootstrap-generated. **Open question:** is it a 6th input key, or bootstrap-generated 32-byte base64url? Recommend bootstrap-generated (matches existing bootstrap behavior). |
| `BACKUP_AGE_IDENTITY` | slim (always present, but bootstrap-generated invisible) |
| `OPENAI_API_KEY`, `GROQ_API_KEY`, `PYANNOTE_API_KEY` | overlay-style provider keys; commented in `.env.full.example`. Optional. |
| `TAVILY_API_KEY`, `YANDEX_SEARCH_API_KEY`, `YANDEX_SEARCH_API_KEY_ID`, `YANDEX_SEARCH_FOLDER_ID` | web-search overlay (Phase 5 — `WEB_SEARCH_PROVIDER`); optional |
| `ASSEMBLYAI_API_KEY`, `ASSEMBLYAI_TOKEN_TTL`, `DEEPGRAM_API_KEY`, `DEEPGRAM_TOKEN_TTL` | realtime overlay (Phase 04 ephemeral providers); optional |
| `HF_TOKEN` | speaches/diarization overlay |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | dev-tools (mailpit) overlay OR prod SMTP |
| `SPEACHES_DIARIZATION_URL` | speaches sibling (Phase 11) |
| `NEXT_PUBLIC_GRAFANA_BASE_URL`, `NEXT_PUBLIC_TEMPO_BASE_URL`, `NEXT_PUBLIC_MIMIR_BASE_URL`, `NEXT_PUBLIC_LOKI_BASE_URL` | observability overlay (UI deep-links) |
| `ADMIN_BASIC_AUTH_USERS` | dev-tools / ingress overlay (Traefik label-driven) |

#### Bucket C — dead / always-defaulted (drop from `.env.slim.example` entirely; document in operations.md if needed)

| Key | Status |
|-----|--------|
| `PLAYWRIGHT_DISABLE_SSR_PREFETCH` | test-only; dead in slim |
| `OPENWHISPR_DISABLE_EMAIL_ENUMERATION_PROTECTION` | test-only |
| `OPENWHISPR_KEY_PROVIDER` | always-defaulted `env` |
| `OPENWHISPR_PROTOCOL` | always-defaulted `mycorp-whispr` (operator-overrides in prod) |
| `NEXT_PUBLIC_OIDC_PROVIDERS` | always-defaulted `google,github,oidc` |
| `STT_DEFAULT_LANGUAGE`, `STT_DEFAULT_MODEL` | sane defaults in code |
| `NOTE_RECORDING_ALLOWED_FORMATS`, `NOTE_RECORDING_DIARIZATION_ENABLED`, `NOTE_RECORDING_MAX_DURATION_SECONDS`, `NOTE_RECORDING_SAMPLE_RATE_HZ` | sane defaults; tuning knobs (drop from slim, move to `.env.full.example`) |
| All 27 `RATE_LIMIT_*` keys | sane defaults baked into rate-limit plugin; drop from slim |
| `OUTBOUND_*` (4 keys) | sane defaults; SSRF allow-list |
| `WEB_SEARCH_PROVIDER` | overlay-style |

**Cross-check:** 88 - 5 (slim) - 11 (bucket A derived) - ~25 (bucket B overlay) - ~50 (bucket C dead/defaulted) ≈ 0. Math balances within bucket-boundary fuzz.

**Planner action:** the slim 5 from CONTEXT.md is correct AS USER-VISIBLE INPUT, but bootstrap.sh will need to fill ~6 additional invisible bootstrap-secrets behind the scenes (`POSTGRES_OWNER_PASSWORD`, `VALKEY_PASSWORD`, `MASTER_KEK`, `BACKUP_AGE_IDENTITY`, `PGBOUNCER_ADMIN_PASSWORD` — only if overlay on, `GRAFANA_ADMIN_PASSWORD` — only if overlay on, etc.). **CONTEXT.md decision 4 stays correct** (5 input keys, the rest derived or bootstrap-generated), but `.env.slim.example` itself must DECLARE the bootstrap-generated keys as `PLACEHOLDER_BOOTSTRAP_WILL_REPLACE` so bootstrap.sh fills them. Planner finalizes the slim template content.

---

## E. Phase 13 Gherkin e2e gates — **CRITICAL CORRECTION**

### CONTEXT.md states (line 38, line 200):
> Phase 13 Gherkin `@cjm-byok-storage`, `@cjm-byok-observability`,
> `@cjm-loud-fail-misconfig` already authored (must go GREEN)

### Reality (verified by `grep -rln @cjm- tests/e2e-cjm/features`):

The Phase 13 cjm feature suite ships these 8 feature files with tags
`@cjm-1.1` … `@cjm-8.2`. **No `@cjm-byok-*` or `@cjm-loud-fail-misconfig`
tag exists in any feature file.** Verified by full-tree grep:

```
$ grep -rln "cjm-byok-storage\|cjm-byok-observability\|cjm-loud-fail-misconfig" .
.planning/ROADMAP.md
.planning/phases/14-slim-core-byok-profiles-v2/14-CONTEXT.md
(no files under tests/)
```

The Phase 13 `13-01-SUMMARY.md` line 20 references **only the SMTP loud-fail**
scenario (`packages/email/src/EmailSender.test.ts`'s "throws when SMTP_HOST
unset in production"). The BYOK / observability / loud-fail-misconfig CJM
scenarios were **planned in ROADMAP but never authored in Phase 13**.

### Implication for Phase 14 planner

**Phase 14 MUST author these three Gherkin scenario families itself**, in
addition to making them green. This is implementation scope, not test-stabilization
scope.

Recommended scenario shapes (planner finalizes Given/When/Then):

#### `@cjm-byok-storage` (proposed)

```gherkin
Feature: BYOK storage overlay refusal
  Scenario: api refuses to start when storage overlay is OFF and S3_ENDPOINT is unset
    Given the slim-core compose stack with no `-f compose/docker-compose.storage.yml`
    And no `S3_ENDPOINT` is exported
    When the api container boots
    Then the api process exits with code 1
    And stderr contains a Pino fatal record `{event: "byok.required", code: "BYOK_STORAGE_REQUIRED", overlay: "storage"}`
    And no further log lines are emitted

  Scenario: api boots when storage overlay is OFF but S3_ENDPOINT is set to corporate BYOK
    Given the slim-core compose stack with no storage overlay
    And `S3_ENDPOINT=https://s3.corp.example.com` is set
    And `S3_ACCESS_KEY` and `S3_SECRET_KEY` are set
    When the api container boots
    Then the api becomes healthy within 60s
    And no `byok.required` fatal record is emitted

  Scenario: api boots when storage overlay is ON
    Given the slim-core compose stack with `-f compose/docker-compose.storage.yml`
    When the api container boots
    Then the api becomes healthy within 60s
    And minio is reachable at http://minio:9000
```

#### `@cjm-byok-observability` (proposed)

```gherkin
Feature: BYOK observability overlay refusal + disable sentinel
  Scenario: api refuses to start when observability overlay OFF and OTEL_EXPORTER_OTLP_ENDPOINT unset
    Given the slim-core compose stack with no `-f compose/docker-compose.observability.yml`
    And `OTEL_EXPORTER_OTLP_ENDPOINT` is unset
    When the api container boots
    Then the api exits with code 1
    And stderr contains a Pino fatal record `{event: "byok.required", code: "BYOK_OBSERVABILITY_REQUIRED", overlay: "observability"}`

  Scenario: api boots in no-op telemetry mode when OTEL_EXPORTER_OTLP_ENDPOINT=disabled
    Given the slim-core compose stack with no observability overlay
    And `OTEL_EXPORTER_OTLP_ENDPOINT=disabled`
    When the api container boots
    Then the api becomes healthy within 60s
    And the NodeSDK is NOT initialized (introspected via the otel-bootstrap export)
    And no OTLP exporter is wired

  Scenario: api boots and exports to corp OTLP when overlay OFF but BYOK endpoint set
    Given the slim-core compose stack with no observability overlay
    And `OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.corp.example.com:4317`
    When the api container boots
    Then the api becomes healthy within 60s
    And the NodeSDK is initialized with the corp endpoint
```

#### `@cjm-loud-fail-misconfig` (proposed)

```gherkin
Feature: loud-fail boot guard fires BEFORE side-effect imports
  Scenario: misconfig fatal precedes installGlobalSSRF and otel-bootstrap
    Given the slim-core compose stack with `S3_ENDPOINT` unset and storage overlay OFF
    When the api container boots
    Then the very first log line on stderr is the Pino fatal `event: byok.required` record
    And no SSRF dispatcher initialization log appears
    And no OTel SDK initialization log appears
    And the process exits with code 1

  Scenario: credential-bearing strings in the fatal record are redacted
    Given the api is misconfigured with `S3_ENDPOINT=https://access:secret@s3.corp/`
    When the api boots and emits the BYOK_STORAGE_REQUIRED fatal
    Then the `hint` field contains the redacted form `https://*****@s3.corp/`
    And the raw password substring `secret` does not appear anywhere on stderr
```

These scenarios exercise the `apps/api/src/lib/byok-guard.ts` module (new in
Phase 14) and the `apps/api/src/lib/redact-url.ts` helper (existing,
Phase 13 HI-02).

**Plan must include:**

1. Authoring three new `.feature` files under `tests/e2e-cjm/features/`
   (`byok-storage.feature`, `byok-observability.feature`,
   `loud-fail-misconfig.feature`).
2. Writing the step definitions in `tests/e2e-cjm/support/` (the harness
   currently boots ONE happy-path compose stack via `compose-harness.ts`; the
   misconfig scenarios need a way to boot variants — extend
   `bootStack(BootStackOptions)` to accept an env-overrides map and a
   different overlay list).
3. Updating `tests/e2e-cjm/support/compose-harness.ts:60-63` to add the new
   overlays to `COMPOSE_FILES` for the BYOK scenarios that need them.

---

## F. `apps/api/src/otel-bootstrap.ts` changes for `=disabled` sentinel

**Current state** (file head + line 77-80):

```ts
export const sdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME ?? "openwhispr-api",
  instrumentations: [autoInstrumentations, pinoInstrumentation],
});
// ...
startSdk(); // line 116
```

NodeSDK reads `OTEL_EXPORTER_OTLP_ENDPOINT` from `process.env` directly
(via its internal default OTLP exporter wire-up). There is **no explicit read
of the env var in this file today** — the env propagates through OTel SDK
internals.

**Required Phase 14 change:**

```ts
// New top-of-module check (after imports, before NodeSDK construction):
const OTEL_DISABLED = process.env.OTEL_EXPORTER_OTLP_ENDPOINT === "disabled";

export const sdk: NodeSDK | null = OTEL_DISABLED
  ? null
  : new NodeSDK({
      serviceName: process.env.OTEL_SERVICE_NAME ?? "openwhispr-api",
      instrumentations: [autoInstrumentations, pinoInstrumentation],
    });

export const startSdk = (target = sdk): void => {
  if (target === null) {
    // No-op when OTel is explicitly disabled (BYOK observability OFF, no
    // overlay, no BYOK endpoint). Operator opted in via sentinel.
    return;
  }
  try {
    target.start();
  } catch (err) {
    diag.error("OTel SDK failed to start", err as Error);
  }
};

export const shutdownSdk = (target = sdk): Promise<void> => {
  if (target === null) return Promise.resolve();
  return target.shutdown().catch((err) => {
    diag.error("OTel SDK shutdown failed", err as Error);
  });
};
```

**Test impact:**
- `apps/api/src/otel-bootstrap.test.ts` (existing, Phase 06) — currently
  asserts `sdk` is a `NodeSDK` instance. Phase 14 must add cases:
  (a) `OTEL_EXPORTER_OTLP_ENDPOINT=disabled` → `sdk === null`,
      `startSdk()` is no-op, `shutdownSdk()` resolves immediately.
  (b) unset endpoint → `sdk` is a `NodeSDK` instance (default).
- The new export type `NodeSDK | null` propagates to callers; verify
  `apps/api/src/index.ts` `import "./otel-bootstrap.js"` is side-effect-only
  (no `sdk` consumer in production code other than this file's own
  SIGTERM handler).

`apps/worker/src/otel-bootstrap.ts` (separate file at
`/Users/nick/openwhispr-server/apps/worker/src/otel-bootstrap.ts`) — same
change required. Worker comment at line 18 confirms it reads the same env.

---

## G. Pitfalls / landmines

### G.1 `docker compose -f` ordering matters

**Rule:** later `-f` files override earlier files. Base FIRST, overlay LAST.

**Make-target convention for Phase 14:**

```make
.PHONY: up
up:
	docker compose up

.PHONY: up-with-observability
up-with-observability:
	docker compose \
	  -f docker-compose.yml \
	  -f compose/docker-compose.observability.yml \
	  up

.PHONY: up-full
up-full:
	docker compose \
	  -f docker-compose.yml \
	  -f compose/docker-compose.observability.yml \
	  -f compose/docker-compose.storage.yml \
	  -f compose/docker-compose.ingress.yml \
	  -f compose/docker-compose.pgbouncer.yml \
	  -f compose/docker-compose.dev-tools.yml \
	  up
```

The `docker-compose.yml` MUST come first; overlay order among the 5 is
commutative (overlays touch disjoint service sets — observability adds
`otel-collector + loki + tempo + mimir + grafana`, storage adds `minio`,
ingress adds `traefik`, pgbouncer adds `pgbouncer`, dev-tools adds
`mailpit`). The only interaction is via `depends_on` merges into `api` /
`worker` / `migrate` — see G.2.

### G.2 `depends_on:` merge semantics

**Authoritative source:** [Docker Compose merge docs](https://docs.docker.com/compose/multiple-compose-files/merge/) — "When the same property is defined in multiple Compose files, the way it gets merged depends on the property type." `depends_on` is documented as **merged additively** at the service level, with condition-on-key uniqueness.

**Worked example for Phase 14:**

Base `docker-compose.yml:512-530`:
```yaml
api:
  depends_on:
    migrate:
      condition: service_completed_successfully
    litellm:
      condition: service_healthy
    valkey:
      condition: service_healthy
    # (after Phase 14 base edit: pgbouncer, otel-collector, mailpit REMOVED)
```

Overlay `compose/docker-compose.pgbouncer.yml`:
```yaml
api:
  depends_on:
    pgbouncer:
      condition: service_healthy
```

Merged result (with both `-f`):
```yaml
api:
  depends_on:
    migrate:
      condition: service_completed_successfully
    litellm:
      condition: service_healthy
    valkey:
      condition: service_healthy
    pgbouncer:
      condition: service_healthy
```

**Verified mechanism:** the merge is by-key additive on the map. Same applies to `migrate.depends_on`, `worker.depends_on`. Phase 14 plan must encode the overlay-side `depends_on` re-declarations explicitly.

### G.3 `profiles:` inversion (TD-14.f / deferred-items #3a)

**Current state — `docker-compose.yml` lines (per A.1 table):**

Every base service declares `profiles: [default, …]`. This means: without the
operator setting `--profile default` (or `COMPOSE_PROFILES=default` in env),
**bare `docker compose up` brings up ZERO services** (the [Compose profiles
docs](https://docs.docker.com/compose/profiles/) state: "Services without a
`profiles` attribute will always be enabled. … A service must be enabled
or it won't run. Services with `profiles` are disabled unless their profile
is explicitly activated.").

**Verification:** the repo's `Makefile` (presumed) and CI workflows must
currently set `COMPOSE_PROFILES=default` somewhere, or run with `--profile
default`. This is the inverted-profiles trap deferred-items #3a flagged.

**The trap:** a fresh-clone OSS operator running plain `docker compose up`
sees nothing happen and concludes the project is broken. Phase 14 must
**REMOVE every `profiles: […]` line from base** (`docker-compose.yml`),
so bare `docker compose up` brings up all 6 long-running services + migrate.

**Lines to remove** (one per service):
- Line 41: `profiles: [default, db-only]` (postgres) — DELETE
- Line 88: `profiles: [default, db-only]` (pgbouncer) — service MOVES to overlay
- Line 117: `profiles: [default]` (valkey) — DELETE
- Line 132: `profiles: [default]` (minio) — service MOVES to overlay
- Line 149: `profiles: [default]` (traefik) — service MOVES to overlay
- Line 197: `profiles: [default, obs-only, load-test-mock, load-test-realistic]` (otel-collector) — service MOVES
- Lines 220, 233, 255, 274: observability services — MOVE to overlay
- Line 323: `profiles: [default, db-only, load-test-mock, load-test-realistic]` (migrate) — DELETE
- Line 355: `profiles: [default]` (litellm) — DELETE
- Line 416: `profiles: [default]` (api) — DELETE
- Line 558: `profiles: [default]` (worker) — DELETE
- Line 641: `profiles: [default]` (web) — DELETE
- Line 716: `profiles: [default, dev, load-test-mock, load-test-realistic]` (mailpit) — service MOVES
- Lines 745, 767, 813: contract-test services — MOVE to `compose/docker-compose.contract-test.yml` (the 6th NEW overlay per CONTEXT.md decision 3)

**`db-only`, `obs-only`, `dev`, `load-test-mock`, `load-test-realistic`,
`contract-test` profile uses elsewhere:**

| Profile | Uses |
|---------|------|
| `db-only` | CI migration testing (Makefile-driven) |
| `obs-only` | observability-stack-up integration test (`tests/integration/observability-stack-up.test.ts:25`) |
| `dev` | mailpit standalone |
| `load-test-mock` / `load-test-realistic` | k6 load harness |
| `contract-test` | fixture-idp + seed + contract-test-runner |

After Phase 14, these profile-based invocations replace with explicit
`-f compose/docker-compose.<overlay>.yml` selectors. Plan must update
the relevant Makefile targets (the planner reads `Makefile` separately —
this researcher did not enumerate Make targets).

---

## Summary for the planner

1. **Base compose** (slim-core): delete `profiles:` everywhere; remove 13 services to overlays; remove `pgbouncer/otel-collector/mailpit` from `api/worker/migrate.depends_on`; add `ports: 4000:3000` to api and `ports: 3000:3000` to web (so slim works without Traefik); drop `:-http://otel-collector:4317` fallback on OTel env (let unset trigger loud-fail).

2. **5 new overlays under `compose/`** (`observability.yml`, `storage.yml`, `ingress.yml`, `pgbouncer.yml`, `dev-tools.yml`) — each declares its services + overlay-side `depends_on` re-declarations + env-default re-injection (e.g. observability overlay re-adds `OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317` to api/worker).

3. **6th NEW overlay** `compose/docker-compose.contract-test.yml` for fixture-idp + seed + contract-test-runner.

4. **`apps/api/src/lib/byok-guard.ts` (new file)** — Pino `fatal({event, code, overlay, missing, hint})` + `pino.final()` + `process.exit(1)`. Called from `apps/api/src/index.ts:58` BEFORE `installGlobalSSRF()` and BEFORE the otel-bootstrap import line 51 (insert the import + call AT THE VERY TOP of index.ts, before the otel-bootstrap import).

5. **`apps/api/src/otel-bootstrap.ts` + `apps/worker/src/otel-bootstrap.ts`** — add `=disabled` sentinel short-circuit; `sdk: NodeSDK | null`; update tests.

6. **Worker virtual-key-rotation removal** — 8 files touched, 1 file + 1 test deleted, ~30 LOC removed; cleanup BullMQ keys.

7. **`.env.slim.example` (new)** — 5 user-visible keys + ~6 bootstrap-generated invisible keys + commented overlay appendix. `.env.example` → renamed `.env.full.example`. `tools/bootstrap.sh:39` env-overridable template path.

8. **Helm chart toggles** — `observability.enabled` (umbrella), `storage.enabled` (NEW, gates Bitnami minio sub-chart + MINIO_ENDPOINT injection), `tls.enabled` (NEW, rename behavior from `ingress.*`), `pooler.enabled` (default flip true→false), `mailpit.enabled` (informational-only, no template). Update `helm-unittest` tests under `charts/openwhispr/tests/`.

9. **e2e-cjm harness** — `tests/e2e-cjm/support/compose-harness.ts:60-63` `COMPOSE_FILES` add new overlays; **AUTHOR `@cjm-byok-storage`, `@cjm-byok-observability`, `@cjm-loud-fail-misconfig` feature files + step defs** (Phase 13 did NOT ship these — see §E correction).

10. **Linter update** — `tools/lint-compose-chart-parity.test.ts` allowlist now needs to recognize overlay-resident services that exist in compose but not in Helm (dev-tools fixture services, etc.).

11. **`docs/operations.md`** — author BYOK matrix section (success criterion #3).

Open question for planner finalization: VALKEY_PASSWORD + MASTER_KEK +
BACKUP_AGE_IDENTITY + POSTGRES_OWNER_PASSWORD — keep CONTEXT.md's "5 user-visible
keys" promise by having bootstrap.sh generate these invisibly (they appear in
`.env` as `PLACEHOLDER_BOOTSTRAP_WILL_REPLACE` in `.env.slim.example` → filled
on first bootstrap run, never shown to operator).

---

## Sources

- CONTEXT.md (locked decisions): `.planning/phases/14-slim-core-byok-profiles-v2/14-CONTEXT.md`
- Prior advisor research: 4 files in same dir (loud-fail, noopx, env-slim, slim-core-map)
- [Docker Compose merge multiple files](https://docs.docker.com/compose/multiple-compose-files/merge/)
- [Docker Compose profiles](https://docs.docker.com/compose/profiles/)
- [Pino fatal + pino.final docs](https://github.com/pinojs/pino/blob/main/docs/api.md#pinofinal)
- Repo: `/Users/nick/openwhispr-server/docker-compose.yml` (871 lines)
- Repo: `/Users/nick/openwhispr-server/apps/worker/src/index.ts`, `queues.ts`, `scheduler.ts`, `jobs/virtual-key-rotation.ts`
- Repo: `/Users/nick/openwhispr-server/apps/api/src/{otel-bootstrap,index,lib/dep-check,lib/redact-url}.ts`
- Repo: `/Users/nick/openwhispr-server/charts/openwhispr/{values.yaml,templates/,tests/}`
- Repo: `/Users/nick/openwhispr-server/tools/bootstrap.sh`
- Repo: `/Users/nick/openwhispr-server/tests/e2e-cjm/{features/,support/compose-harness.ts,support/mailpit-helper.ts}`
- Repo: `/Users/nick/openwhispr-server/.env.example` (88 keys)
- Repo: `/Users/nick/openwhispr-server/.env.embedded.example` (23 keys)
