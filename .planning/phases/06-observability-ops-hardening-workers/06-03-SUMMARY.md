---
phase: 06-observability-ops-hardening-workers
plan: 03
subsystem: telemetry-bootstrap
tags: [otel, pino, log-correlation, log-scrubbing, loki-tempo, e2e-stubs, wave-0]
requirements: [OBS-01, OBS-02, OBS-03]
dependency-graph:
  requires:
    - "06-CONTEXT.md D-T1/D-T3/D-T4/D-T6 (telemetry decisions)"
    - "06.1 OTel Collector pipeline (traces->Tempo, logs->Loki via otlphttp, metrics->Mimir via prometheusremotewrite)"
    - "Phase 2 Plan 03 request-log plugin (extends with redact)"
  provides:
    - "OTel SDK started before any pino import — all subsequent Wave 1+ handlers get trace_id/span_id auto-injected in pino log records"
    - "buildLogger() factory with D-T4 redact policy (Wave 1+ plugins reuse via opts.logger override or by Fastify-logger swap)"
    - "Loki <-> Tempo correlation in Grafana (operators see clickable trace_id buttons in log lines)"
    - "31-file Wave 0 RED floor complete (8 e2e stubs in tests/e2e/)"
  affects:
    - "Every apps/api request — trace_id will appear in pino JSON output when called from inside an OTel-tracked span"
tech-stack:
  added:
    - "@opentelemetry/api ^1.9.0"
    - "@opentelemetry/sdk-node ^0.55.0"
    - "@opentelemetry/auto-instrumentations-node ^0.75.0"
    - "@opentelemetry/instrumentation-pino ^0.63.0"
    - "pino ^9.5.0"
  patterns:
    - "Side-effect-only import for SDK init (FIRST line of entrypoint)"
    - "Exported startSdk/shutdownSdk for unit-testability of failure branches"
    - "describe.skipIf(process.env.E2E !== '1') gating on every e2e stub"
key-files:
  created:
    - apps/api/src/otel-bootstrap.ts
    - apps/api/src/otel-bootstrap.test.ts
    - apps/api/src/plugins/request-log.test.ts
  modified:
    - apps/api/src/index.ts (otel-bootstrap import as first executable line)
    - apps/api/src/plugins/request-log.ts (buildLogger + redactPaths)
    - apps/api/package.json (4 OTel deps + pino)
    - compose/grafana/provisioning/datasources/loki.yaml (derivedFields TraceID -> tempo)
decisions:
  - "Side-effect-only module for otel-bootstrap.ts (no default export) — load-bearing for the require-time pino patch."
  - "Top-level redactPaths additions beyond D-T4 verbatim — pino wildcard *.foo matches one-level-deep keys only, so a stray `log.info({ token })` would leak; explicit top-level entries close the gap."
  - "Extracted startSdk/shutdownSdk exports — necessary for testing the catch branches (start-failure must not crash API; SIGTERM handler must stay infallible)."
metrics:
  duration: ~15min
  completed: "2026-05-11"
---

# Phase 6 Plan 03: Wave 0 Telemetry Bootstrap + Final E2E RED Stubs

OTel SDK loads before pino so PinoInstrumentation can inject trace_id/span_id at require-time; pino redact scrubs D-T4 secrets at source; Grafana Loki<->Tempo derivedFields wire log-line trace_id to a clickable Tempo span; and the final 8 Wave 0 e2e RED stubs land so Plan 12 can flip the whole 31-file inventory GREEN.

## Tasks Completed

### Task 1 — OTel SDK bootstrap + pino redact + Loki<->Tempo derivedFields

Created `apps/api/src/otel-bootstrap.ts` as a side-effect-only module. `NodeSDK` is constructed with `getNodeAutoInstrumentations` (fs + dns disabled per D-T1) plus `PinoInstrumentation` whose `logKeys` map `traceId -> trace_id`, `spanId -> span_id`, `traceFlags -> trace_flags` (D-T3). The SDK is started at module load via the exported `startSdk()` helper; an `onSignal` closure registered on SIGTERM + SIGINT invokes `shutdownSdk()` for best-effort flush. Both helpers are exported so tests can pass a fake SDK to exercise the catch branches.

`apps/api/src/index.ts` line 50 (the first executable statement after the file's header docstring) is `import "./otel-bootstrap.js";` — the load-order test in `otel-bootstrap.test.ts` parses the source, strips comments + blanks, and asserts the first remaining line matches that pattern.

`apps/api/src/plugins/request-log.ts` gained two new exports: `redactPaths` (D-T4 verbatim plus top-level mirrors) and `buildLogger(opts?)` (returns a pino logger with `redact: { paths, censor: '[REDACTED]' }`). The existing Phase 2 Fastify `requestLog` plugin is preserved unchanged so the `x-openwhispr-source` log-tag behavior survives.

`compose/grafana/provisioning/datasources/loki.yaml` gained `derivedFields: TraceID` regex `"trace_id":"([a-f0-9]+)"` -> `datasourceUid: tempo` so Grafana renders the trace_id JSON field of each pino log line as a click-through link to the matching Tempo span.

Commit: 0a2f29d.
Refactor commit: 0e0c686 (coverage uplift to 100/92/100/100).

### Task 2 — 8 e2e RED stubs (Wave 0 final)

Per the plan's "some may already be created by 06-01; check first and only add what's missing": investigation found that all 8 stubs already existed on disk (committed by a parallel agent under `test(06-01): red stubs for 8 Phase 6 e2e scenarios`, hash 931dbb4). Each contains:

- `describe.skipIf(process.env.E2E !== "1")` gating.
- >= 3 `it()` blocks each referencing a specific D-* anchor in 06-CONTEXT.md.
- `beforeAll` that throws `not yet implemented` so the suite fails loudly when E2E=1 lands without an implementing GREEN plan.

Files (with their wire to a D-* anchor):

- `tests/e2e/horizontal-scale.test.ts` -> SCALE-01, D-P3 (withScale("api", 2), Traefik round-robin, session continuity).
- `tests/e2e/ssrf-block.test.ts` -> SCALE-04, D-S3, D-S5 (169.254.169.254 -> 502 + audit row).
- `tests/e2e/audit-log-write.test.ts` -> OBS-03, D-A1, D-A6 #1, D-A7 (sync audit row on auth.signin).
- `tests/e2e/reconciliation-drift.test.ts` -> OBS-04, D-R2, D-R3 (drift gauges + backfill).
- `tests/e2e/log-scrub-sentinel.test.ts` -> OBS-02, D-T4 (sentinel never leaks).
- `tests/e2e/probes-dependency.test.ts` -> OBS-05, D-P1, D-P2 (pause Postgres -> /readyz 503; /livez stays 200).
- `tests/e2e/rate-limit-layered.test.ts` -> SCALE-04, D-RL2, D-RL3 (user-tier + IP-tier + carve-out).
- `tests/e2e/otel-trace-propagation.test.ts` -> OBS-01, D-T3 (Tempo + Loki correlation).

No additional commit needed for Task 2 — the parallel-agent commit 931dbb4 satisfies all acceptance criteria verbatim.

## Verification

### Automated

- `pnpm -F @openwhispr/api exec vitest run src/otel-bootstrap.test.ts src/plugins/request-log.test.ts src/__tests__/openwhispr-source-log.test.ts` -> 24 / 24 tests pass.
- Coverage on touched files (`--coverage.include='src/otel-bootstrap.ts'` + `--coverage.include='src/plugins/request-log.ts'`): L=100% / B=91.66% / F=100% / S=100%. All four axes >= 90.
- `head -1` of executable code in `apps/api/src/index.ts` is `import "./otel-bootstrap.js";` (asserted by `otel-bootstrap.test.ts` load-order check).
- `grep -r "'/metrics'" apps/api/src/routes apps/api/src/index.ts` -> zero hits (D-T6 single-metrics-path).
- 8 e2e stub files exist with `describe.skipIf(process.env.E2E !== "1")` gating + >= 3 it() blocks each + D-* anchors in test names + `169.254.169.254` literal in ssrf-block + `withScale` literal in horizontal-scale.

### Pre-existing scope-boundary issues (NOT fixed in this plan)

- `pnpm -F @openwhispr/api typecheck` reports 8 pre-existing TS errors in routes/realtime.ts (wsReconnect type), test-only.test.ts, openai-realtime.test.ts, tokens/_call-provider.ts, transcriptions/{batch-create,create}.ts. Verified pre-existing by stash-test; unrelated to Plan 06-03 changes. Logged for separate ticket.
- `pnpm exec tsc --noEmit` in `tests/e2e/` reports pre-existing errors in `phase-05-*.spec.ts` (`await` outside async) + `mock-realtime/vitest.config.ts` (Vitest 4 `all` key). Unrelated.

## LGTM Compose Services

The plan deliverable list included "compose.yml additions for OTel Collector + Tempo + Mimir/Prometheus + Loki + Grafana". Phase 06.1 already wired the full LGTM stack into `compose.yml` + `compose/otel-collector/config.yaml` (traces -> Tempo, logs -> Loki via `otlphttp`, metrics -> Mimir via `prometheusremotewrite` with `X-Scope-OrgID: openwhispr`). Plan 06-03 enriched only the **datasource provisioning** for log-trace correlation:

- `compose/grafana/provisioning/datasources/loki.yaml` -> derivedFields TraceID -> `datasourceUid: tempo`.

No new container services were added; the existing 06.1 services (otel-collector :4317/:4318, tempo :3200, mimir :9009, loki :3100, grafana :3000) cover the requirement. Port mappings unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Added top-level redact paths beyond D-T4 verbatim**
- **Found during:** Task 1 (pino redact unit test)
- **Issue:** D-T4 lists `*.token`, `*.secret`, `*.password`, `*.apiKey` as wildcard paths. Pino's wildcard `*.foo` matches one-level-deep keys (`obj.foo`), NOT root-level keys. A stray `log.info({ token: bearer })` would have leaked the bearer unredacted.
- **Fix:** Added explicit top-level entries (`token`, `secret`, `password`, `apiKey`, `api_key`, `virtualKey`, `client_secret`, `access_token`, `refresh_token`) alongside the wildcard forms. Sentinel-sweep test now passes against all 12 leak vectors.
- **Files modified:** `apps/api/src/plugins/request-log.ts`
- **Commit:** 0a2f29d

**2. [Rule 3 - Blocking issue] Extracted startSdk/shutdownSdk to satisfy 90% branch+function coverage**
- **Found during:** Coverage pass after Task 1
- **Issue:** Inline `try { sdk.start() } catch { diag.error(...) }` at module top-level + closure-based SIGTERM handler left the catch branch and the handler body uncovered (L=82, B=83, F=33 — three axes below 90).
- **Fix:** Lifted the start + shutdown bodies into exported `startSdk(target = sdk)` and `shutdownSdk(target = sdk)` functions. Tests pass a fake SDK to exercise the failure branches without crashing the real one. Behavior unchanged (still called once at module load; SIGTERM still registered).
- **Files modified:** `apps/api/src/otel-bootstrap.ts`, `apps/api/src/otel-bootstrap.test.ts`, `apps/api/src/plugins/request-log.test.ts`
- **Commit:** 0e0c686

### Task 2 — pre-existing parallel work

The 8 e2e stubs Plan 06-03 Task 2 specifies were ALL created by a parallel-agent run of Plan 06-01 (commit 931dbb4) before this Plan 06-03 execution. The plan anticipated this ("some may already be created by 06-01") and instructs "only add what's missing"; none were missing.

## Known Stubs

The 8 e2e files in `tests/e2e/` are intentional RED stubs — they throw `not yet implemented` in `beforeAll` and reference the Plan number that will flip them GREEN. These are not "stubs preventing the plan's goal" but the explicit Wave 0 RED floor the entire phase TDD discipline depends on. Plans 06-04 through 06-12 will materialize implementations and flip each one GREEN.

## Atomic Commits

| Hash | Message |
|------|---------|
| 0a2f29d | feat(06-03): bootstrap OTel SDK before pino + D-T4 redact + Loki<->Tempo link |
| 0e0c686 | refactor(06-03): extract startSdk/shutdownSdk + add coverage to 100/92/100/100 |

(931dbb4 et al. attributed to 06-01 in commit subject; covers Task 2 deliverables by parallel agent.)

## Self-Check: PASSED

- [x] `apps/api/src/otel-bootstrap.ts` exists.
- [x] `apps/api/src/otel-bootstrap.test.ts` exists.
- [x] `apps/api/src/plugins/request-log.test.ts` exists.
- [x] `compose/grafana/provisioning/datasources/loki.yaml` updated with derivedFields.
- [x] 8 e2e stubs present under tests/e2e/.
- [x] Commit 0a2f29d in git log.
- [x] Commit 0e0c686 in git log.
- [x] Commit 931dbb4 (parallel 06-01 satisfying Task 2) in git log.
- [x] Coverage on touched files >= 90/90/90/90.
- [x] No `/metrics` endpoint introduced.

## Threat Flags

None — no new trust-boundary surface beyond what 06-CONTEXT.md `threat_model` already enumerated for this plan (T-06-06 / T-06-07 / T-06-08 all mitigated as planned).
