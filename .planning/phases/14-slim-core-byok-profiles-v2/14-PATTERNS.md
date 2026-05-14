---
phase: 14
phase_name: Slim Core + BYOK Profiles v2
artifact: PATTERNS
generated: 2026-05-14
---

# Phase 14 — New-File → Existing-Analog Map

Every new file Phase 14 introduces has a closest existing analog in the
codebase. Executors MUST read the analog first and mirror its structure,
imports, header comment style, test style, and error handling. Deviations
require explicit justification in the plan task.

## 1. New runtime modules

| New file (Phase 14) | Closest analog | Why this analog |
|---|---|---|
| `apps/api/src/lib/byok-guard.ts` | `apps/api/src/lib/dep-check.ts` | Both are boot-time guard libraries under `apps/api/src/lib/`; same file header convention (SPDX + Phase / Plan / Task tag + Source-of-truth pointer + Surface paragraph + behavior block). |
| `apps/api/src/lib/byok-guard.test.ts` | `apps/api/src/lib/dep-check.test.ts` | Vitest, real-PG-where-needed (here NOT needed — pure env-string assertions), no internal-logic mocks; only process-boundary mocks for `process.exit` via spy. |
| Pino fatal record shape `{event, code, overlay, missing, hint}` | `packages/email/src/EmailSender.ts:74-91` (`event: "email.smtp_required_in_production"`) | The dot-namespaced `event:` token convention is constitutional. Phase 14 extends with `byok.required`, `byok.storage_required`, etc. |
| `process.exit(1)` after `pino.final()` | `apps/api/src/index.ts:675` and `apps/worker/src/index.ts:238` | Exit-1 is the only existing api/worker exit code. `sysexits.h` 78 is rejected per CONTEXT.md decision 2. |
| `OTEL_EXPORTER_OTLP_ENDPOINT === "disabled"` sentinel short-circuit in `apps/api/src/otel-bootstrap.ts` AND `apps/worker/src/otel-bootstrap.ts` | Same file, current NodeSDK construction at api `:77-80`, worker `:18` | Add `const OTEL_DISABLED = ... === "disabled"`; export `sdk: NodeSDK | null`; `startSdk`/`shutdownSdk` no-op when `null`. Identical edit in both apps. |

## 2. New compose overlay files

| New overlay file | Closest analog | Why this analog |
|---|---|---|
| `compose/docker-compose.observability.yml` | `compose/e2e/docker-compose.e2e.yml` (88 lines, Phase 04) | Phase-04 e2e overlay is the only existing additive overlay in `compose/`. Pattern: declare ONLY the services this overlay introduces + service-level `depends_on` overrides to wire existing services to the new ones. No `version:`. No re-declaration of unrelated services. |
| `compose/docker-compose.storage.yml` | same | Adds `minio` + named volume + `api.depends_on: minio` + `api.environment: S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET`. |
| `compose/docker-compose.ingress.yml` | same | Adds `traefik` + Traefik labels deltas on web/api + ACME volume. Strips slim-core base host ports `4000:3000` (api) and `3000:3000` (web) via compose 2.20+ `ports: !reset []` override under each service block — with the ingress overlay layered, only Traefik (`:80`/`:443`/`:8443`/`:8080`) is reachable on the host (production posture). Without the overlay, slim-core base keeps `localhost:3000`/`:4000` for the OSS quickstart. Phase 13 e2e harness already addresses services via Traefik front URL (`compose-harness.ts:71`), so harness-side scenarios are unaffected. |
| `compose/docker-compose.pgbouncer.yml` | same | Adds `pgbouncer` + `api.depends_on: pgbouncer`, `migrate.depends_on: pgbouncer`. Overlay-side re-injection of `DATABASE_URL` to point at `pgbouncer:6432`. |
| `compose/docker-compose.dev-tools.yml` | same | Adds `mailpit` ONLY (CONTEXT.md decision 1, TD-14.a). NOT fixture-idp/seed/contract-test-runner — those move to `.contract-test.yml`. |
| `compose/docker-compose.contract-test.yml` | same | 3 services: `fixture-idp`, `seed`, `contract-test-runner` — extracted from base, currently `profiles: [contract-test]`. |

## 3. Env templates and bootstrap

| New / changed file | Closest analog | Why this analog |
|---|---|---|
| `.env.slim.example` | `.env.embedded.example` (23 keys, Variant A) | Single-file `.env.<variant>.example` siblings already coexist (`.env.example`, `.env.embedded.example`, `.env.e2e.example`). Slim adds a fourth. Convention: comment block at top explaining variant, `KEY=PLACEHOLDER_BOOTSTRAP_WILL_REPLACE` for secrets, `KEY=` (empty) for operator-supplied. |
| `.env.full.example` (rename of `.env.example`) | n/a (rename) | Git-rename, content untouched. `tools/bootstrap.sh:39` becomes env-overridable. |
| `tools/bootstrap.sh:39` env-overridable `BOOTSTRAP_ENV_TEMPLATE` | `tools/bootstrap.sh` itself (`gen_secret`, `gen_age_identity` patterns) | Existing bootstrap.sh already reads env into `local`/`readonly` shell-vars with `${X:-default}` defaults. Same pattern for the new `BOOTSTRAP_ENV_TEMPLATE`. |

## 4. Helm chart edits

| New / changed values key | Closest analog | Why this analog |
|---|---|---|
| `observability.enabled` (NEW umbrella) | `observability.collector.enabled` + `observability.serviceMonitor.enabled` (existing) | Pattern: top-level umbrella that AND-gates existing sub-toggles. Templates use `{{- if and .Values.observability.enabled .Values.observability.collector.enabled -}}` per RESEARCH §C.1. |
| `storage.enabled` (NEW, gates Bitnami minio) | `valkey.enabled` / `minio.enabled` as sub-chart conditions in `Chart.yaml` `dependencies:` | Helm 3 standard `condition: storage.enabled` field on the minio dependency block. |
| `pooler.enabled: false` (flip default) | `pooler.enabled: true` (existing `values.yaml:172`) | Single-line default flip. Test `pooler_test.yaml` must explicitly `set: pooler.enabled: true` to keep current assertions valid. |
| `tls.enabled` (NEW master gate) | existing `ingress.preflightCheck`, `certManager.enabled` | New top-level boolean. Wraps `ingressroute-*.yaml`, `certificate-*.yaml` with `{{- if .Values.tls.enabled -}}`. Non-toggle sub-keys (`ingress.realtimeEntrypointName`, `ingress.trustedIPs`) stay under `ingress.*`. |
| `mailpit.enabled` (informational) | `bundledAi.enabled` (existing, also informational — no template) | Documented in values.yaml header comment as informational-only for compose-chart-parity linter. NO templates added. |
| New tests under `charts/openwhispr/tests/` | `charts/openwhispr/tests/ingress_test.yaml`, `pooler_test.yaml`, `otel_test.yaml` | helm-unittest assertion style (`asserts:` `equal`/`matchRegex`/`contains`). NO snapshot fixtures (none exist today). |

## 5. Gherkin e2e features + step defs

| New file | Closest analog | Why this analog |
|---|---|---|
| `tests/e2e-cjm/features/byok-storage.feature` | `tests/e2e-cjm/features/transcribe.feature` (Phase 13 reference) | Same `@cjm-X.Y` tag convention (Phase 14 uses `@cjm-byok-storage`); Feature/Scenario/Given/When/Then structure; Background block if needed. |
| `tests/e2e-cjm/features/byok-observability.feature` | same | Same. |
| `tests/e2e-cjm/features/loud-fail-misconfig.feature` | same | Same. |
| Step defs (env-override + boot-and-capture-stderr) | `tests/e2e-cjm/support/compose-harness.ts` `bootStack(opts)` | `bootStack` already accepts `composeFiles` override. Plan 14-07 extends it with `envOverrides: Record<string, string \| undefined>` to allow per-scenario env injection. Misconfig scenarios capture stderr via `docker compose logs api` after expected exit. |
| Compose-harness `COMPOSE_FILES` update | `tests/e2e-cjm/support/compose-harness.ts:60-63` | Append new overlays to the constant. Existing convention preserved. |

## 6. Docs

| New / changed file | Closest analog | Why this analog |
|---|---|---|
| `docs/operations.md` BYOK matrix section | existing `docs/operations.md` other matrix tables | Markdown table; one row per overlay; columns: Overlay / BYOK env / Loud-fail code / Helm key / Compose overlay file. |
| `docs/operations.md` BullMQ key-prefix cleanup note (post virtual-key-rotation removal) | existing operations.md "Operator runbooks" sections | One-shot `valkey-cli DEL bull:virtual-key-rotation:*` step for upgrade-in-place operators. |
| `docs/architecture.md:263` diagram | existing diagram | Remove `Q2[virtual-key-rotation]` node. |

## 7. Worker virtual-key-rotation removal

| File deleted / edited | Closest analog (for removal pattern) | Why |
|---|---|---|
| DELETE `apps/worker/src/jobs/virtual-key-rotation.ts` | n/a | Whole-file delete. |
| DELETE `apps/worker/src/jobs/virtual-key-rotation.test.ts` | n/a | Whole-file delete. |
| Edit `apps/worker/src/index.ts:60-94,137-145,190-200` | `apps/worker/src/index.ts` itself (other Worker registrations e.g. `emailDeliveryWorker`) | Pattern of multi-worker drain list; remove the `vkrWorker` slot, keep the rest intact. |
| Edit `apps/worker/src/queues.ts:17,22,33,58,83` | same file (other queues) | Remove the `virtualKeyRotation` lines while preserving the queue registry shape. |
| Edit `apps/worker/src/scheduler.ts:15,20,43,50,89-98` | same file (other cron schedulers) | Remove the cron config field + the upsertJobScheduler call. |
| Edit `apps/worker/src/queues.test.ts:41`, `apps/worker/src/scheduler.test.ts:41,90-130` | Test files themselves (other queue/cron expectations) | Remove only the virtual-key-rotation assertions; keep test scaffolding intact. |
| Rewrite `tests/e2e/log-scrub-sentinel.test.ts:109-123` | Same test file (other queue scenarios), `email-delivery` queue | Pick `email-delivery` queue as substitute (already exists, has a deterministic payload schema). Replace the enqueue + assert block. |

## 8. Pitfall reminders (per RESEARCH §G)

| Pitfall | Mitigation in plan |
|---|---|
| `profiles: [default, …]` inversion → bare `docker compose up` brings up nothing | Plan 14-01 deletes `profiles:` from ALL 19 base services. |
| `:-http://otel-collector:4317` fallback hides BYOK misconfig | Plan 14-01 strips the `:-` fallback in base; Plan 14-03 overlay re-adds it. |
| `api.depends_on: mailpit/otel-collector/pgbouncer` hard-couples slim-core to overlays | Plan 14-01 removes them from base; Plan 14-03 overlays re-declare them. |
| `compose/grafana/provisioning/datasources/postgres.yaml:32` hard-codes `pgbouncer:6432` | Plan 14-03 changes datasource URL to `postgres:5432` direct (Grafana datasource doesn't need pooling). |
| `tools/bootstrap.sh:39` hard-codes `.env.example` path | Plan 14-02 makes it env-overridable. |
| BullMQ stale keys in Valkey after vkr removal | Plan 14-05 documents `valkey-cli DEL bull:virtual-key-rotation:*` in operations.md AND adds idempotent transient cleanup at worker boot. |
| `tests/e2e/log-scrub-sentinel.test.ts:109-123` enqueues a vkr job | Plan 14-05 rewrites to use `email-delivery` queue. |
| e2e-cjm `mailpitApiUrl` default depends on ingress overlay up | Plan 14-07 keeps mailpit + ingress overlays in `COMPOSE_FILES` for the BYOK feature suites. |
| `tools/lint-compose-chart-parity.test.ts` allowlist trips on overlay-resident services | Plan 14-06 updates the allowlist. |
| Phase 06 testcontainers booting their own PG → no regression from pgbouncer overlay move | Verified by RESEARCH §B.3; no action needed. |
