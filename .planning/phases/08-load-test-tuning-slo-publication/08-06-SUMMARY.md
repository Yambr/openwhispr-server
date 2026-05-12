---
phase: 08-load-test-tuning-slo-publication
plan: 06
subsystem: load-test
tags: [k6, load-test, observability, grafana, mimir, tdd]
requires:
  - phase 08/plan 02 (load-test workspace, scenario-picker, setup)
  - phase 08/plan 03 (mock-litellm)
  - phase 08/plan 04 (fd-probe)
  - phase 08/plan 05 (docker-compose.load-test.yml + preflight.sh)
provides:
  - tools/load-test/src/main.ts — k6 entrypoint with locked options + setup + teardown
  - tools/load-test/src/flows/{transcribe,reason,agent-stream,realtime-ws}.ts — 4 endpoint flows
  - tools/load-test/src/utils/http-client.ts — HttpClient interface + k6 adapter + mock adapter
  - tools/load-test/src/k6.config.ts — locked load-run constants (STAGES / THRESHOLDS / N_USERS)
  - tools/load-test/src/fixtures/sample-5s-16k.wav — reproducible WAV fixture (160044 bytes, PCM 16 kHz mono 5 s)
  - tools/load-test/src/fixtures/prompt-strings.json — 52 English reasoning prompts
  - tools/load-test/src/fixtures/conversation-history.json — 4-message canned chat history
  - tools/load-test/scripts/run.sh — end-to-end orchestrator (preflight → up → warm → k6 → capture → down)
  - tools/load-test/scripts/pre-warm-speaches.sh — Whisper-large-v3 warm-up
  - tools/load-test/scripts/run.test.sh — smoke test for run.sh
  - tools/load-test/scripts/generate-wav-fixture.mjs — deterministic WAV generator (reproducibility)
  - compose/grafana/dashboards/k6-prometheus.json — Grafana dashboard 19665 (k6 Prometheus)
  - compose/grafana/provisioning/dashboards/k6.yaml — provisioner pointing at /etc/grafana/dashboards/k6
  - docker-compose.load-test.yml grafana mount — read-only bind of compose/grafana/dashboards
  - Makefile target `load-test` with PROFILE=mock|realistic
affects:
  - tools/load-test/tsup.config.ts — adds k6/* externals (3 bare imports preserved in dist/main.js)
  - tools/load-test/vitest.config.ts — flows included in coverage, k6.config.ts excluded
  - docker-compose.load-test.yml — grafana service override (volume mount, profiles)
  - Makefile — load-test target now active (replaces phase-8 placeholder stub)
tech-stack:
  added: []
  patterns:
    - HttpClient interface + mock adapter pattern keeps flows unit-testable outside k6
    - tsup `external` + esbuildOptions `external` (belt-and-braces) for k6/* runtime modules
    - Trend metrics for streaming TTFB separation (RESEARCH.md §Pitfall 6)
    - Speaches pre-warm before realistic-profile k6 run (RESEARCH.md §Pitfall 10)
    - trap-based teardown in run.sh guarantees stack cleanup on failure
key-files:
  created:
    - tools/load-test/src/utils/http-client.ts
    - tools/load-test/src/utils/http-client.test.ts
    - tools/load-test/src/flows/transcribe.ts
    - tools/load-test/src/flows/transcribe.test.ts
    - tools/load-test/src/flows/reason.ts
    - tools/load-test/src/flows/reason.test.ts
    - tools/load-test/src/flows/agent-stream.ts
    - tools/load-test/src/flows/agent-stream.test.ts
    - tools/load-test/src/flows/realtime-ws.ts
    - tools/load-test/src/flows/realtime-ws.test.ts
    - tools/load-test/src/k6.config.ts
    - tools/load-test/src/fixtures/sample-5s-16k.wav
    - tools/load-test/src/fixtures/prompt-strings.json
    - tools/load-test/src/fixtures/conversation-history.json
    - tools/load-test/scripts/run.sh
    - tools/load-test/scripts/run.test.sh
    - tools/load-test/scripts/pre-warm-speaches.sh
    - tools/load-test/scripts/generate-wav-fixture.mjs
    - compose/grafana/dashboards/k6-prometheus.json
    - compose/grafana/dashboards/README.md
    - compose/grafana/provisioning/dashboards/k6.yaml
  modified:
    - tools/load-test/src/main.ts (was a placeholder; now the real k6 entrypoint)
    - tools/load-test/tsup.config.ts (k6/* externals)
    - tools/load-test/vitest.config.ts (coverage scope updated)
    - docker-compose.load-test.yml (grafana volume mount)
    - Makefile (load-test target activated)
decisions:
  - "Used tsup `external` + esbuild `external` both — tsup v8 sometimes forwards only one to esbuild."
  - "Dropped `${DS_PROMETHEUS}` placeholders in the dashboard JSON and pinned datasource UID to `mimir` so provisioning loads it without prompts."
  - "Flow tests inject mock adapters via dependency injection — no k6 runtime in vitest. The k6 adapter inside main.ts is excluded from coverage (c8 ignore + vitest exclude)."
  - "agent-stream records TWO Trends (ttfb + total) per RESEARCH.md §Pitfall 6 — collapsing them would hide TTFB regressions."
  - "Pre-warm script is fault-tolerant: a failed warm-up logs WARN and proceeds. Plan-07 verification catches actual outages."
metrics:
  duration: ~45 min
  completed: 2026-05-12
  tasks: 5
  commits: 7
  coverage:
    statements: 96.42
    branches: 94.73
    functions: 100
    lines: 96.34
---

# Phase 8 Plan 6: k6 Flows + Makefile Summary

**One-liner:** Implements the four k6 endpoint flows (transcribe / reason / agent-stream / realtime-ws), the locked-options entrypoint, the WAV + JSON fixtures, the Grafana dashboard 19665 provisioning, and the `make load-test PROFILE=mock|realistic` orchestrator — wave-2 harness ready for plan 07 to execute.

## What Shipped

### Flows (`tools/load-test/src/flows/`)
- `transcribe.ts` — POST `/api/transcribe` multipart with the 5-second WAV fixture, model + language fields, bearer rotation via `set-auth-token`.
- `reason.ts` — POST `/api/reason` with a JSON `{model, messages}` body; prompt selected deterministically by iteration index.
- `agent-stream.ts` — POST `/api/agent/stream` with `stream:true`; records two Trends (`agent_stream_ttfb` from `timings.waiting`, `agent_stream_total` from `timings.duration`) so the SLO review in plan 07 attributes them independently.
- `realtime-ws.ts` — `wss://api.localhost/v1/realtime` open + ping + close(1000) under a 2-second iteration ceiling; tagged `endpoint:realtime-ws`.

### Entrypoint (`tools/load-test/src/main.ts`)
- `options`: ramping-vus executor (5 m → 1000, 20 m sustained, 5 m → 0), per-endpoint thresholds tag-filtered on `endpoint:<name>`, `insecureSkipTLSVerify: true`.
- `setup()`: pre-provisions `N_USERS` (1000) via the plan-02 `provisionUsers()`.
- `teardown()`: best-effort DELETE `/api/auth/delete-account` per user (T-08-03).
- Default function: picks an endpoint per iteration via the plan-02 scenario picker and dispatches to the correct flow.

### Bundle
- `tsup` build produces `dist/main.js` (≈8 KB) with `k6`, `k6/http`, `k6/websockets`, `k6/metrics`, `k6/encoding` preserved as bare imports — verified by `grep -c "from \"k6"` returning 3 (the three modules main.ts actually imports).

### Fixtures (reproducible)
- `sample-5s-16k.wav` — 160 044 bytes, PCM 16 kHz mono 5 s, deterministic 220 Hz sine. Regenerable via `node tools/load-test/scripts/generate-wav-fixture.mjs`.
- `prompt-strings.json` — 52 English reasoning prompts.
- `conversation-history.json` — 4-message canned chat.

### Grafana
- Dashboard 19665 (k6 Prometheus) downloaded from grafana.com, `${DS_PROMETHEUS}` rewritten to `mimir`, UID pinned to `k6-prometheus-rw` for stable lookup, `__inputs`/`__elements`/`__requires` stripped.
- Mounted into the Grafana container only under load-test profiles via `docker-compose.load-test.yml`. Provider YAML places it under a dedicated "Load Test" folder.

### Orchestrator (`tools/load-test/scripts/run.sh`)
- Validates `PROFILE` argument (mock | realistic).
- Calls `preflight.sh --yes` (plan 05) BEFORE compose build/up — refuses to run with insufficient RAM or busy ports.
- Builds compose images, brings the stack up `--wait`.
- For realistic profile only: runs `pre-warm-speaches.sh` to load Whisper-large-v3 weights so the first k6 iteration sees warm latency.
- Builds the k6 bundle, then `k6 run` with `experimental-prometheus-rw` output to Mimir at `127.0.0.1:9009/api/v1/push`, JSON dump to `.planning/phases/08-load-test-tuning-slo-publication/runs/<stamp>-<profile>.json`, and `--summary-export` for the per-endpoint p95 table.
- `trap EXIT INT TERM` guarantees teardown even on k6 failure.

### Makefile
- `make load-test PROFILE=mock` (default) or `make load-test PROFILE=realistic` — single-command entrypoint plan 07 will invoke.

## Coverage

Final V8 coverage on `tools/load-test/`:

| Axis        | Pct    | Floor | Status |
| ----------- | ------ | ----- | ------ |
| Statements  | 96.42% | 90%   | PASS   |
| Branches    | 94.73% | 90%   | PASS   |
| Functions   | 100%   | 90%   | PASS   |
| Lines       | 96.34% | 90%   | PASS   |

45 vitest tests pass (16 flow tests + 8 http-client/fixture tests + plan-02's 21 existing tests). `tools/load-test/src/main.ts` and `tools/load-test/src/k6.config.ts` are excluded because they execute only inside the k6 VM; their constituent functions (flows, scenario-picker, setup, http-client, auth) are individually unit-tested.

## Verification (executed)

- `pnpm --filter @openwhispr/load-test test:coverage` — 45 tests pass, thresholds 90/90/90/90 met (96/94/100/96 actual).
- `pnpm --filter @openwhispr/load-test typecheck` — clean.
- `pnpm --filter @openwhispr/load-test build` — `dist/main.js` 7.96 KB, 3 k6 externals preserved (`grep -c "from \"k6"` = 3).
- `file tools/load-test/src/fixtures/sample-5s-16k.wav` — `RIFF (little-endian) data, WAVE audio, Microsoft PCM, 16 bit, mono 16000 Hz`.
- `bash tools/load-test/scripts/run.test.sh` — 7/7 smoke checks pass (script executable, rejects unknown profile, env wiring present, runs/ path captured, preflight before up, trap teardown, pre-warm references speaches).
- `docker compose -f docker-compose.yml -f docker-compose.load-test.yml --profile load-test-mock config` — grafana service merge produces the expected volume mount for `compose/grafana/dashboards → /etc/grafana/dashboards/k6:ro`.

Live `k6 run` (full 30-min execution) is intentionally **not** invoked here — that is plan 07's job.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] tsup `external` alone did not propagate to esbuild**

- **Found during:** Task 3 build verification.
- **Issue:** Setting `external: [...]` at the tsup level allowed esbuild to fail to resolve `k6/http`, `k6/websockets`, `k6/metrics`.
- **Fix:** Added `esbuildOptions(options) { options.external = [...]; }` block so the externals are forwarded directly to esbuild as well.
- **Commit:** `eba0596`

**2. [Rule 1 — Bug] `${DS_PROMETHEUS}` placeholders broke provisioning**

- **Found during:** Task 4 dashboard JSON inspection.
- **Issue:** Grafana dashboard 19665 ships with `${DS_PROMETHEUS}` as the datasource UID, which Grafana's provisioning path does not interpolate (only the import wizard does).
- **Fix:** Rewrote every `${DS_PROMETHEUS}` to the literal `mimir` (the existing datasource UID in `compose/grafana/provisioning/datasources/mimir.yaml`); stripped `__inputs` / `__elements` / `__requires`; pinned a stable top-level `uid` of `k6-prometheus-rw`.
- **Commit:** `516a4de`

**3. [Rule 2 — Missing] Dashboard mount was production-scoped**

- **Found during:** Task 4 docker-compose review.
- **Issue:** Production `grafana` service only mounts `/etc/grafana/provisioning`. The plan-specified `compose/grafana/dashboards/` path is not visible to the container.
- **Fix:** Added a `grafana` service override in `docker-compose.load-test.yml` mounting `compose/grafana/dashboards → /etc/grafana/dashboards/k6:ro` under the load-test profiles only — production grafana never carries the dashboard.
- **Commit:** `516a4de`

**4. [Rule 2 — Missing] Plan did not include a `trap`-based teardown for `run.sh`**

- **Found during:** Task 5 script implementation.
- **Issue:** A k6 failure mid-run would have left the 1000-VU compose stack running on the developer Mac. The plan only described teardown after the `k6` command on the happy path.
- **Fix:** Added `trap '$COMPOSE_BASE down ...' EXIT INT TERM` so the stack is torn down regardless of how `run.sh` exits, with the k6 exit code preserved via the trailing `exit "$K6_EXIT"`.
- **Commit:** `c064523`

No architectural changes were required.

## Authentication Gates

None. All work was code + docker provisioning; no third-party SaaS or live auth involved.

## Known Stubs

None. All flows wire real (mock-adapter-injected) HTTP calls; the WAV fixture and prompt fixtures contain real content; the Grafana dashboard has a resolved datasource UID; the Makefile target is live.

## Threat Flags

None new beyond the plan's existing `<threat_model>` register. The Grafana dashboard mount is read-only and load-test-profile-scoped; the run-output directory under `.planning/phases/...` is local-only and not exposed.

## Commits

| Hash    | Subject                                                                   |
| ------- | ------------------------------------------------------------------------- |
| d219975 | test(08-06): red — k6 http adapter + fixtures                             |
| 0eafd03 | feat(08-06): green — k6 http adapter + 5s wav + prompt fixtures           |
| 432df84 | test(08-06): red — 4 endpoint flows                                       |
| 2f96805 | feat(08-06): green — 4 endpoint flows + ttfb metric for streaming         |
| eba0596 | feat(08-06): main.ts + tsup bundle (k6 entrypoint, externals preserved)   |
| 516a4de | feat(08-06): provision grafana k6 prometheus dashboard (19665)            |
| c064523 | feat(08-06): run.sh orchestrator + pre-warm-speaches + makefile load-test |

## Self-Check: PASSED

All 15 promised files exist on disk. All 7 commits are present in `git log`. Makefile `load-test` target is active (no longer a phase-8 stub).
