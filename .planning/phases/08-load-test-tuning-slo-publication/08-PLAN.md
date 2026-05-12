---
phase: 08-load-test-tuning-slo-publication
type: orchestration-index
plans: 8
waves: 5
autonomous: true
requirements:
  - SCALE-02
  - SCALE-06
  - SCALE-07
  - TEST-LOAD-01
---

# Phase 8: Load Test, Tuning & SLO Publication — Plan Index

**Source decisions:** `08-CONTEXT.md` (D-EXEC-1..2, D-LOAD-1..3, D-PROF-1..2, D-SLO-1..3, D-TUNE-1..3, D-DOCS-1, D-TDD-1..2)
**Research:** `08-RESEARCH.md` (k6 v2.0.0, mock-LiteLLM Fastify, Speaches v0.9.0-rc.3 CPU, PgBouncer 4×100, FD probe)
**Goal:** On-demand k6 1000-VU load test + measured baselines + operator-facing SLO budgets in `docs/operations.md`.

## Wave Structure

| Wave | Plans | Parallelizable? | Depends on |
|-----:|-------|-----------------|-----------|
| 0 | 01, 02, 03, 04 | yes — disjoint files_modified | none |
| 1 | 05 | sequential | 01 + 02 + 03 + 04 |
| 2 | 06 | sequential | 02 + 05 |
| 3 | 07 | sequential (live run, ~75 min wall clock) | 06 |
| 4 | 08 | sequential | 07 |

## Plans

### Wave 0 — TDD groundwork (parallel)

- [ ] **01 — rate-limit env switch** (`08-load-test-tuning-slo-publication-01-rate-limit-bypass.md`)
  - Closes Wave-0 gap identified by researcher: `OPENWHISPR_DISABLE_RATE_LIMIT` does NOT exist in current code (verified via grep, RESEARCH.md A5).
  - Adds the switch to BOTH `apps/api/src/plugins/rate-limit.ts` AND `apps/api/src/auth.ts` (Better Auth limiter) with unit tests RED→GREEN.
  - Files: `apps/api/src/plugins/rate-limit.ts`, `apps/api/src/auth.ts`, `.env.example` + tests
  - Requirements: SCALE-06, TEST-LOAD-01

- [ ] **02 — load-test workspace scaffold** (`08-load-test-tuning-slo-publication-02-load-test-scaffold.md`)
  - New pnpm workspace `@openwhispr/load-test` with scenario-picker (50/25/15/10), setup() user provisioner, auth/http utils, verify-compose.sh, fd-probe.test.sh harness — all TDD'd with ≥90/90/90/90.
  - Files: `tools/load-test/` (everything except flows, which are Wave 2)
  - Requirements: SCALE-06, SCALE-07, TEST-LOAD-01

- [ ] **03 — mock-litellm Fastify scaffold** (`08-load-test-tuning-slo-publication-03-mock-litellm-scaffold.md`)
  - Net-new `@openwhispr/mock-litellm` workspace + Dockerfile. Fastify 5 app with `/v1/audio/transcriptions` (1500ms ± jitter), `/v1/chat/completions` (300ms sync / 200ms streaming first-token), `/health/liveliness`. Unit tests via Fastify .inject().
  - Files: `compose/mock-litellm/`
  - Requirements: SCALE-06

- [ ] **04 — FD probe scripts** (`08-load-test-tuning-slo-publication-04-fd-probe.md`)
  - Adds `apps/api/scripts/fd-probe.sh` + `compose/traefik/fd-probe.sh` (byte-identical). Probe refuses to start if `ulimit -n < 65535`. Wires into `apps/api/Dockerfile` ENTRYPOINT. Plan 05 wires the Traefik probe via compose override.
  - Files: `apps/api/scripts/`, `compose/traefik/`, `apps/api/Dockerfile`
  - Depends on: 02 (uses plan-02's fd-probe.test.sh harness)
  - Requirements: SCALE-07

### Wave 1 — Compose integration

- [ ] **05 — docker-compose load-test profiles** (`08-load-test-tuning-slo-publication-05-compose-load-test-profiles.md`)
  - Creates `docker-compose.load-test.yml` (override file) adding: mock-litellm service (profile load-test-mock), speaches service (profile load-test-realistic), pgbouncer-1..4 sharing `pgbouncer` network alias (DEFAULT_POOL_SIZE=100), postgres `max_connections=500`, api+traefik `ulimits: nofile=65535`, mimir host port 9009, api env `OPENWHISPR_DISABLE_RATE_LIMIT=1`. Plus `preflight.sh` operator-safety + `profile-lint.test.sh` integration test that asserts every truth.
  - Files: `docker-compose.load-test.yml`, `compose/postgres/load-test.conf`, `compose/traefik/Dockerfile`, `tools/load-test/scripts/preflight.sh` + `profile-lint.test.sh`
  - Depends on: 01 + 02 + 03 + 04 (all Wave 0)
  - Requirements: SCALE-02, SCALE-06, SCALE-07

### Wave 2 — k6 harness completion

- [ ] **06 — k6 flows + Makefile** (`08-load-test-tuning-slo-publication-06-k6-flows-and-makefile.md`)
  - 4 flow files (transcribe, reason, agent-stream, realtime-ws) all unit-tested with mocked http adapter. main.ts entrypoint with ramping-vus options + setup + scenario picker dispatch. WAV fixture (~80 KB, 5s, 16kHz mono). Grafana dashboard 19665 provisioning. Makefile `load-test` target wraps run.sh (preflight → up → pre-warm-speaches → k6 prometheus-rw → capture → down).
  - Files: `tools/load-test/src/main.ts`, `tools/load-test/src/flows/*`, `tools/load-test/src/fixtures/*`, `tools/load-test/scripts/{run.sh, pre-warm-speaches.sh, run.test.sh}`, `compose/grafana/dashboards/k6-prometheus.json`, `Makefile`
  - Depends on: 02 (workspace + scenario picker + setup) + 05 (compose profiles exist)
  - Requirements: SCALE-06, TEST-LOAD-01

### Wave 3 — Live baseline run

- [ ] **07 — live run on Mac** (`08-load-test-tuning-slo-publication-07-live-baseline-run.md`)
  - Operator-executed (or Claude-executed) live `make load-test` runs for BOTH profiles. ~75 minutes wall clock total. Mid-run diagnostic captures (SHOW POOLS, container restart status, rate-limit log grep, prepared-statement grep). RUN-LOG.md filled with all exit gates. SANITY.md automated validation of summary JSON plausibility + exit gates.
  - **D-EXEC-2 mandate:** This plan MUST produce real baseline numbers on the Mac. No estimates. No extrapolation.
  - Files: `.planning/phases/08-load-test-tuning-slo-publication/runs/{RUN-LOG.md, SANITY.md, <timestamp>-{mock,realistic}*.json}`
  - Depends on: 06
  - Requirements: SCALE-02, SCALE-06, SCALE-07, TEST-LOAD-01

### Wave 4 — Documentation closure

- [ ] **08 — operations.md + SUMMARY + REQUIREMENTS amendment + ROADMAP closure** (`08-load-test-tuning-slo-publication-08-docs-and-slo-publication.md`)
  - `docs/operations.md` gets the full Load Testing section: how-to-run, two SLO budget tables (baseline × 1.20), sizing matrix, PgBouncer/FD tuning rationale, limitations. Numbers SOURCED from `runs/*-summary.json` via jq — not extrapolated. `08-SUMMARY.md` embeds tables + verifier truth table per plan 01-07. `REQUIREMENTS.md` TEST-LOAD-01 amendment notes the manual-not-nightly deviation. `ROADMAP.md` Phase 8 marked closed with evidence pointers.
  - Files: `docs/operations.md`, `08-SUMMARY.md`, `REQUIREMENTS.md`, `ROADMAP.md`
  - Depends on: 07
  - Requirements: SCALE-02, SCALE-06, SCALE-07, TEST-LOAD-01

## Requirement Coverage

Every Phase 8 requirement is covered by ≥1 plan:

| Req | Plans | Notes |
|-----|-------|-------|
| SCALE-02 | 05 (pgbouncer 4× scale-out) + 07 (live SHOW POOLS verification) + 08 (publish in operations.md) | full |
| SCALE-06 | 01 (rate-limit bypass) + 02 (scenario picker + setup) + 03 (mock-litellm) + 05 (compose profiles) + 06 (k6 flows + Makefile) + 07 (live run) + 08 (publish) | full |
| SCALE-07 | 02 (fd-probe.test.sh harness) + 04 (probe scripts) + 05 (ulimits in compose) + 08 (sizing matrix in operations.md) | full |
| TEST-LOAD-01 | 01-08 all contribute; 08 explicitly amends to "manual on-demand" per D-EXEC-1 | partial-by-design (nightly + CI-regression deferred) |

## Goal-Backward Success-Criterion Map

Phase 8 ROADMAP success criteria (lines 502-509) → plans:

| SC | Plans that deliver it |
|----|----------------------|
| SC1: `make load-test` runs 1000 VU 5/20/5 with v1 mix | 02 (scenario picker), 06 (Makefile + main.ts), 07 (executes it) |
| SC2: Two compose profiles, both baselines published | 03 + 05 (profiles) + 07 (both baselines) + 08 (published) |
| SC3: PgBouncer 4×100 + FD 65535 verified under load | 04 + 05 (configuration) + 07 (verification at runtime) |
| SC4: Sizing matrix in operations.md | 08 |
| SC5: Per-endpoint SLO budgets baseline+20% published | 07 (baselines) + 08 (×1.20 publication) |
| SC6: First live run actually executes on Mac, raw output in SUMMARY | **07 specifically** + 08 (embeds) |
| SC7: TDD + CI green | All plans (each ships RED→GREEN); CI runs on every commit |

## Constitutional Compliance Checklist

- [x] Strict TDD per plan (RED before GREEN, same commit pair) — enforced by each plan's tdd="true" tasks
- [x] ≥90/90/90/90 coverage on diff for all new TS/JS — assertion in each plan's verify block
- [x] E2E mandatory — plan 07 IS the e2e (live compose stack, real k6 run)
- [x] No mocks of internal logic — mock-litellm is a PROCESS boundary; real Postgres+PgBouncer+Valkey under load; only k6's http boundary is mocked in unit tests
- [x] English-only source — verified by `tools/lint-english.sh` in CI; every plan's files lint-clean
- [x] GitHub Actions only sanctioned CI — Phase 8 does NOT add nightly cron (D-EXEC-1) but new unit tests auto-join the existing CI matrix
- [x] autonomous: true on every plan — enforced (no checkpoints; SANITY.md replaces the human checkpoint in plan 07)

## Execution Notes for Orchestrator

1. **Wave 0 parallelism:** plans 01, 02, 03 have zero file overlap. Plan 04 depends on plan 02's harness output but creates separate files (`apps/api/scripts/`, `compose/traefik/`), so it can also run in Wave 0 if 02 has at minimum committed `tools/load-test/scripts/fd-probe.test.sh`.
2. **Plan 07 wall clock:** 75 minutes minimum. If running in a CI/CD-like context, allow that budget; do not preempt mid-run.
3. **Speaches image availability:** verify `docker pull ghcr.io/speaches-ai/speaches:latest-cpu` succeeds before Wave 3. If unavailable, plan 07 documents the deferral and plan 08 publishes only the mock baseline.
4. **Plan 07 SANITY.md:** automated gate. If SANITY says FAIL on mock-profile checks, halt; do NOT proceed to plan 08.
5. **Decision coverage:** every D-XX from CONTEXT.md is implemented at full fidelity. No scope reduction; no "v1 static" placeholders. See `Decision coverage matrix` below.

## Decision Coverage Matrix

| D-XX | Plan | Task | Fidelity |
|------|------|------|----------|
| D-EXEC-1 (on-demand, manual, local) | 06, 08 | Makefile target + operations.md cadence section | Full |
| D-EXEC-2 (live run mandatory) | 07 | The plan IS the live run | Full |
| D-LOAD-1 (1000 concurrent) | 06 | main.ts options stages target=1000 | Full |
| D-LOAD-2 (5m/20m/5m) | 06 | options.scenarios.main.stages | Full |
| D-LOAD-3 (50/25/15/10 mix) | 02 | scenario-picker.ts WEIGHTS | Full |
| D-PROF-1 (two profiles, both published) | 03, 05, 07, 08 | mock-litellm + speaches + both runs + both budget tables | Full |
| D-PROF-2 (net-new, default unaffected) | 05 | docker-compose.load-test.yml override + profile-lint test | Full |
| D-SLO-1 (baseline + 20%) | 08 | operations.md SLO tables compute × 1.20 | Full |
| D-SLO-2 (two budget tables) | 08 | mock table + realistic table | Full |
| D-SLO-3 (no CI enforcement) | 06, 08 | k6 thresholds are descriptive only; SUMMARY documents | Full |
| D-TUNE-1 (PgBouncer 100×4) | 05 | 4 services share alias + DEFAULT_POOL_SIZE=100 | Full |
| D-TUNE-2 (FD 65535 + probe) | 04, 05 | probe scripts + ulimits + ENTRYPOINT wiring | Full |
| D-TUNE-3 (no GPU tuning) | 08 | operations.md Limitations notes Phase 9 | Full (by exclusion) |
| D-DOCS-1 (operations.md) | 08 | all 5 required sub-sections | Full |
| D-TDD-1 (strict TDD) | 01, 02, 03, 04, 06 | every code task tdd="true" + RED commit | Full |
| D-TDD-2 (≥90/90/90/90) | 01, 02, 03, 06 | each plan's verify asserts coverage threshold | Full |

**Result:** Every D-XX is Full coverage. No PHASE SPLIT needed.
