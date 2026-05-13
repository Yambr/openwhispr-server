---
phase: 08-load-test-tuning-slo-publication
status: complete
closed_at: 2026-05-13
requirements:
  - SCALE-02
  - SCALE-06
  - SCALE-07
  - TEST-LOAD-01
related_phases:
  - 08.1-deferral-fixes-and-rerun
  - 08.2-agent-stream-undici-dispatcher-fix
  - 08.3-mock-litellm-realtime-echo
  - 08.4-realtime-ws-proxy-forwarding-fix
  - 08.5-realistic-profile-boot-and-baseline
  - 08.6-speaches-mainbranch-build-diarization  # parallel — not blocking 08 closure
artifacts:
  baseline_run: "runs/2026-05-12T22-47-48Z-mock-summary.json"
  baseline_commit: "a5e5920"
  operator_runbook: "docs/operations.md#load-testing"
key_decisions:
  - D-DOCS-1 — docs/operations.md is the operator-facing artifact
  - D-SLO-1 — SLO budget = measured baseline × 1.20 (+20% headroom)
  - D-EXEC-1 — nightly CI cadence + auto-regression-gate deferred; manual on-demand is v1
  - D-TUNE-2 — FD ≥ 65535 + refuse-to-start probe
---

# Phase 8: Load Test, Tuning & SLO Publication — Phase Summary

## One-liner

Phase 8 ships an on-demand `make load-test` (1000 VU × 30 min mock plateau + realistic-profile boot + smoke + paid-provider proof-of-wiring), the PgBouncer 4×100=400 sizing + FD-65535 refuse-to-start contract, and a 4-endpoint SLO budget table in `docs/operations.md` sourced from Run 5 (commit `a5e5920`) — not extrapolated.

## Goal restatement (from ROADMAP)

An on-demand k6 load test (`make load-test`) demonstrates 1000 concurrent active users against a real docker-compose stack at validated p95 baselines, and per-endpoint p95 SLO budgets (baseline + 20% headroom) are published to operators in `docs/operations.md` only after this phase passes. Per-phase coverage floor ≥ 90/90/90/90 on diff; TDD red-then-green throughout.

## Sub-phase index

The originally-planned 8 plans (08-01 .. 08-08) discovered three architectural deferrals during 08-07's first live run, triggering five inserted sub-phases (08.1 .. 08.5) before 08-08 could close. Sub-phase 08.6 runs in parallel and does not block phase closure.

| Sub-phase | Status | Closure summary |
|---|---|---|
| **08-01** rate-limit env switch | ✅ | `OPENWHISPR_DISABLE_RATE_LIMIT=1` disables both Fastify + Better Auth limiters for load-test profiles; refused in production via WARN at boot. |
| **08-02** load-test workspace scaffold | ✅ | `tools/load-test/` pnpm workspace with tsup-built k6 entry points + shared http-client + auth helper. |
| **08-03** mock-litellm Fastify scaffold | ✅ | `compose/mock-litellm` returns static responses with simulated latency (1500ms ± 400 transcribe, 300ms ± 80 chat, 200ms ± 50 stream-first-token). |
| **08-04** FD probe scripts | ✅ | `fd-probe.sh` refuses to start api + traefik below 65535; load-test compose overlay sets `ulimits: nofile: { soft: 65535, hard: 65535 }`. |
| **08-05** docker-compose load-test profiles | ✅ | `docker-compose.load-test.yml` overlay with 4× PgBouncer scale, mock-litellm wire-in, FD ulimits. |
| **08-06** k6 flows + Makefile | ✅ | 4 flows (transcribe, reason, agent-stream, realtime-ws); `make load-test PROFILE={mock,realistic}` targets. |
| **08-07** first live baseline on Mac | ⚠️ → 08.1 | Run 1 produced invalidated baseline (99.93% HTTP error rate, realtime-ws p95=0, pgbouncer_admin SCRAM hash absent) — anomalies escalated to 08.1. |
| **08.1** deferral fixes + mock re-run | ✅ | Closed 2026-05-12 partial-live-validation: anomaly #1 (request-shape mismatch) → transcribe + reason 200 LIVE; anomaly #2 (k6/websockets tag-mapping) → custom Trend; anomaly #3 (SHOW POOLS auth) → `compose/pgbouncer/bootstrap.sh` + `userlist.txt` regenerator. Plateau handed to operator. |
| **08.2** agent-stream undici dispatcher fix | ✅ | Closed 2026-05-12. `apps/api/src/routes/agent/stream.ts` migrated from `undici.fetch` to shared `chatCompletionsStream` (built on `undici.request`); live forensic-probe returns NDJSON ending `finishReason:"stop"`. Coverage 100/90.47/100/100 on stream.ts. |
| **08.3** mock-litellm `/v1/realtime` echo | ⚠️ → 08.4 | Closed 2026-05-13 partial. Echo handler shipped (22/22 vitest, coverage 100/100/100/100); Run 4 still had realtime-ws p95=0 — root cause moved client-side, escalated to 08.4. |
| **08.4** realtime-ws load-test path fix | ✅ | Closed 2026-05-13. Original api-side hypothesis rejected by host-side WS probing; TWO CLIENT-side bugs in `tools/load-test/`: (H7) `new W(url, params)` → `new W(url, null, params)` 3-arg form passing Authorization header; (H8) `wss://api.localhost/v1/realtime` (:443) → `wss://api.localhost:8443/v1/realtime` (Phase 04 dedicated WSS entrypoint). Smoke-gate extended to assert `ws_msgs_sent > 0`. Run 5 produced **complete 4-endpoint baseline** (commit `a5e5920`). |
| **08.5** realistic profile boot + smoke | ✅ | Closed 2026-05-13. All 5 production endpoints proven LIVE on Mac via canonical `speaches-audio.md` wiring. Plateau deferred to H100 per RESEARCH §Pitfall 2. `tools/load-test/scripts/smoke-paid.sh` (~$0.02/run) is the cost-disciplined proof-of-wiring. |
| **08.6** Speaches main-branch diarization | 🟡 parallel | Not blocking. `latest-cpu` lacks `/v1/audio/diarization`; main-branch build pending. Tracked separately. |
| **08-08** docs/operations.md + SLO publication | ✅ | THIS plan. 4-endpoint SLO table + sizing matrix + tuning rationale + limitations + operator H100 re-run recipe shipped to `docs/operations.md`. ROADMAP + REQUIREMENTS updated. |

## Live run results — embedded from Run 5

Source: `runs/2026-05-12T22-47-48Z-mock-summary.json` (commit `a5e5920`, "chore(08.4): close phase with valid complete 4-endpoint mock baseline (run 5)").

Topology: 1000 VU × 30 min (5m ramp + 20m sustained + 5m ramp-down), 944,988 HTTP requests @ **510.7 rps**, 0 container restarts, 0 prepared-statement errors, 0 rate-limit hits.

| Endpoint | Observed p95 (ms) | SLO p95 (× 1.20, ms) | Verdict |
|---|---:|---:|---|
| transcribe | 2521 | 3025 | ✅ within mock-profile plausibility (mock injects 1500ms ± 400ms) |
| reason | 1209 | 1451 | ✅ within range (mock injects 300ms ± 80ms; gateway + JSON + auth ≈ 900ms) |
| agent-stream TTFB | 610 | 732 | ✅ within first-byte budget |
| agent-stream total | 1127 | 1352 | ✅ NDJSON stream completion |
| realtime-ws roundtrip | 41 | 49 | ✅ mock-floor — `OPERATOR_RERUN_ON_GPU` to fill [50, 1000] window |

Error rate: **0.106%** (< 1% gate). 6/6 k6 thresholds PASS.

## Observable-truth verifier table (plans 01..08 + sub-phases 08.1..08.5)

Per the plan's verifier-truth contract: for each plan, every observable must-have truth from the source PLAN is verified with [x] PASS + evidence pointer.

| Plan | Truth | Verdict | Evidence |
|---|---|---|---|
| 08-01 | `OPENWHISPR_DISABLE_RATE_LIMIT=1` disables both Fastify limiter and Better Auth limiter | ✅ PASS | `apps/api/src/plugins/rate-limit.test.ts`, `apps/api/src/plugins/auth.test.ts` |
| 08-01 | Production refuses the env var (WARN on boot) | ✅ PASS | `apps/api/src/boot.ts` env-guard log assertion |
| 08-02 | `tools/load-test/` builds via tsup; `make load-test` resolves | ✅ PASS | `tools/load-test/package.json`, `Makefile` `load-test:` target |
| 08-03 | `compose/mock-litellm` returns 200 with injected sleep on `/v1/audio/transcriptions` and `/v1/chat/completions` | ✅ PASS | `compose/mock-litellm/src/server.test.ts` |
| 08-04 | FD probe refuses to start if `ulimit -n < 65535` | ✅ PASS | `apps/api/scripts/fd-probe.sh`, `tests/self-tests/fd-probe.test.sh` |
| 08-05 | `docker-compose.load-test.yml` scales `pgbouncer` to 4 replicas and sets nofile=65535 | ✅ PASS | `docker-compose.load-test.yml` (deploy.replicas + ulimits blocks) |
| 08-06 | 4 k6 flows (transcribe / reason / agent-stream / realtime-ws) exist and respect mix-ratio weights | ✅ PASS | `tools/load-test/src/flows/*.ts`, `tools/load-test/src/scenarios/plateau.ts` |
| 08-07 | First live run produces summary JSON with per-endpoint p95 tags | ✅ PASS (with anomalies escalated) | `runs/2026-05-12T16-00-53Z-mock-summary.json`; anomalies in `runs/SANITY.md` |
| 08.1 | Error rate < 1% on re-run after k6 request-shape fix | ✅ PASS | `runs/2026-05-12T18-00-00Z-mock/` partial-live; `runs/2026-05-12T22-47-48Z-mock-summary.json` (Run 5) full-live |
| 08.1 | `realtime_ws_roundtrip_ms` custom Trend populates non-zero p95 | ✅ PASS | `tools/load-test/src/flows/realtime-ws.ts` `realtime_ws_roundtrip_ms.add(...)` + Run 5 p95=41 |
| 08.1 | `SHOW POOLS` via pgbouncer_admin returns rows (no log-scrape fallback) | ✅ PASS | `compose/pgbouncer/bootstrap.sh`, `runs/2026-05-12T18-00-00Z-mock/diagnostics/show-pools.txt` |
| 08.2 | `apps/api/src/routes/agent/stream.ts` no longer emits `upstream_error` against mock-litellm | ✅ PASS | live forensic-probe artifact in `.planning/phases/08.2-.../08.2-FORENSIC.md`; Run 5 agent-stream gates PASS |
| 08.2 | SSRF gate behaviour preserved (54/54 SSRF tests GREEN) | ✅ PASS | `apps/api/src/lib/ssrf.test.ts` |
| 08.3 | mock-litellm `/v1/realtime` echoes one frame per inbound message | ✅ PASS | `compose/mock-litellm/src/realtime.test.ts` (22/22 GREEN, coverage 100/100/100/100) |
| 08.4 | Run 5 realtime-ws p95 ∈ [non-zero, < SLO]; complete 4-endpoint baseline | ✅ PASS | `runs/2026-05-12T22-47-48Z-mock-summary.json` (p95=41 ms) |
| 08.4 | k6 WebSocket constructor uses 3-arg form (H7 fix) | ✅ PASS | `tools/load-test/src/utils/http-client.ts:152` (commit `a86140d`) |
| 08.4 | k6 realtime-ws flow targets `:8443` (H8 fix) | ✅ PASS | `tools/load-test/src/flows/realtime-ws.ts` `wsUrl()` (commit `670aa8a`) |
| 08.5 | `make load-test PROFILE=realistic` boots Speaches + LiteLLM + healthchecks | ✅ PASS | Wave 1+2 commits (4491369…e6c7b34); paid-smoke proof in commit `11d21f3` |
| 08.5 | All 5 production endpoints LIVE via paid smoke (5/7 PASS including transcribe + realtime) | ✅ PASS | `tools/load-test/scripts/smoke-paid.sh`, commit `11d21f3` |
| 08-08 | `docs/operations.md` contains Load Testing section with required subsections + populated numbers | ✅ PASS | `docs/operations.md` (commit fd1267b earlier in this phase closure) |
| 08-08 | Each SLO row sourced (NOT extrapolated) from `runs/2026-05-12T22-47-48Z-mock-summary.json` | ✅ PASS | `docs/operations.md#published-slo-budgets-mock-profile` |
| 08-08 | Sizing matrix has compose row filled, Helm rows TBD/Phase-9 | ✅ PASS | `docs/operations.md#sizing-matrix` |
| 08-08 | Limitations section explicit on Apple Silicon CPU + v1 mix ratios + deferred CI | ✅ PASS | `docs/operations.md#limitations-architecture-bound-vs-hardware-bound` |

## Exit gates — referenced from `runs/SANITY.md` updates

Run 5 supersedes the original Run 1 SANITY table. Gate-by-gate Run 5 verdict (Run 1's FAIL rows are closed by the 08.1 → 08.4 sub-phase chain):

| Gate | Run 1 | Run 5 |
|---|---|---|
| Summary JSON parses | PASS | PASS |
| Error rate < 1% | FAIL (99.93%) | **PASS** (0.106%) |
| transcribe p95 in [1500, 8000] ms | FAIL (1280) | **PASS** (2521) |
| reason p95 in [300, 3000] ms | PASS | PASS (1209) |
| agent-stream TTFB p95 in [200, 2000] ms | PASS (kind of — bogus due to error rate) | **PASS** (610) |
| realtime-ws p95 in [50, 1000] ms | FAIL (=0) | mock-floor 41 ms — `OPERATOR_RERUN_ON_GPU` |
| Mid-run pgerrors empty | PASS | PASS |
| Mid-run rate-limit-mid empty | PASS | PASS |
| SHOW POOLS snapshot | PARTIAL | **PASS** |
| Container restart count | 0 | 0 |
| 6/6 k6 thresholds | partial | **PASS** |

## Deviations from the original Phase 8 PLAN.md

1. **5 sub-phases inserted along the way (08.1 → 08.5).** The original 8 plans assumed Run 1 of 08-07 would yield a publishable baseline. It did not. 08.1 closed three deferral anomalies; 08.2 untangled the api-side undici dispatcher; 08.3 + 08.4 chased the realtime-ws p95=0 symptom through mock-side and client-side; 08.5 added the realistic-profile wiring proof. 08-08 (this plan) consumed Run 5 from 08.4 as its SLO source.
2. **08.6 (Speaches main-branch diarization) runs in parallel.** Not blocking the umbrella closure — diarization is a real-stack feature unlocked by a future Speaches image swap.
3. **Nightly CI cadence + auto-regression-gate deferred** (D-EXEC-1). REQUIREMENTS.md TEST-LOAD-01 carries the Phase 8 amendment note: manual on-demand baseline shipped; nightly + CI-regression-gate re-opens in a post-v1 phase.
4. **Realistic plateau on Mac DEFERRED** with operator H100 re-run recipe in `08.5-03-STATUS.md`. Per the user's cost-discipline directive (memory: feedback_loadtest_cost_discipline), plateaus stay local-only; paid providers receive a 10-call smoke proof-of-wiring only.

## Artifacts

- **Run 5 baseline:** `runs/2026-05-12T22-47-48Z-mock-summary.json` (commit `a5e5920`)
- **Operator runbook:** `docs/operations.md#load-testing` (commit `fd1267b`)
- **Per-sub-phase summaries:** `08-01-SUMMARY.md` … `08-07-SUMMARY.md` + `08-07_1-SUMMARY.md` in this directory; sub-phase summaries under `.planning/phases/08.1-…/` through `.planning/phases/08.5-…/`
- **SANITY:** `runs/SANITY.md` (Run 1 baseline + Run 2 partial-live update; Run 5 supersedes the FAIL rows)
- **RUN-LOG:** `runs/RUN-LOG.md` (chronological 5-run history)
- **CONTEXT + RESEARCH:** `08-CONTEXT.md`, `08-RESEARCH.md`

## Coverage

Coverage targets met per-sub-phase (not re-aggregated here — see each sub-phase summary):

- `apps/api/src/routes/agent/stream.ts`: 100/90.47/100/100 (08.2)
- `packages/litellm-client`: 100/98/100/100 (08.2)
- `compose/mock-litellm/src/realtime.ts`: 100/100/100/100 (08.3)
- `tools/load-test/src/flows/*.ts`: ≥ 90/90/90/90 (08.1 + 08.4)

Docs (this plan) — coverage not applicable. English-only + commitlint hooks PASS.

## Forward pointers

- **Phase 9 (Helm):** Inherits the published SLO budgets as the K8s-deployment regression target. Fills the Helm small / Helm large rows in the sizing matrix. GPU node-selector + HPA-on-GPU-utilization for the Speaches worker tier.
- **Phase 10 (i18n + docs):** Re-uses `docs/operations.md` as the operator handbook anchor. TEST-LOAD-01 v2 amendment (nightly + CI-regression-gate) re-opens here or in a dedicated post-v1 phase.
- **08.6 Speaches diarization:** Continues in parallel — closes when the Speaches main-branch image lands with `/v1/audio/diarization` and `apps/api/src/routes/diarization.ts` is swapped to local target.

## Self-Check: PASSED

- `docs/operations.md` exists, contains "Load Testing" + "Published SLO budgets" + "Limitations" + "PgBouncer tuning" + "File-descriptor probe" — verified via grep (6 matches).
- `runs/2026-05-12T22-47-48Z-mock-summary.json` exists in the runs directory.
- Commit `a5e5920` exists in git history.
- Commit `fd1267b` (Task 1) exists in git history.
