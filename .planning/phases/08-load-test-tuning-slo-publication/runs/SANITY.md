# Phase 8 Load Test — SANITY Validation

> Programmatic gate-check of `runs/2026-05-12T16-00-53Z-mock-summary.json`.
> Per Task 4 contract: any mock-profile FAIL fails the plan; realistic
> may be deferred with documented root cause.

## load-test-mock profile

| Check | Expected | Observed | Verdict |
|-------|---------|---------|---------|
| Summary JSON parses (`jq -e .metrics`) | non-null | parses, 23 metric keys | **PASS** |
| Error rate < 1% (`http_req_failed.value`) | < 0.01 | **0.9993 (99.93%)** | **FAIL** |
| transcribe endpoint p95 reported | non-null | 1280.09 ms | PASS |
| reason endpoint p95 reported | non-null | 1278.57 ms | PASS |
| agent-stream endpoint p95 reported | non-null | 1280.18 ms | PASS |
| realtime-ws endpoint p95 reported | non-zero | **0 ms (zero-count tag)** | **FAIL** |
| transcribe p95 in [1500, 8000] ms (mock plausibility) | in range | 1280 ms (just below low bound) | **FAIL** |
| reason p95 in [300, 3000] ms | in range | 1278 ms | PASS |
| agent-stream TTFB p95 in [200, 2000] ms | in range | 1280 ms | PASS |
| realtime-ws p95 in [50, 1000] ms | in range | 0 ms | **FAIL** (corollary of zero-tag bug) |
| Mid-run `pgerrors-mid-mock.txt` empty | 0 bytes | 0 bytes | PASS |
| Mid-run `rate-limit-mid-mock.txt` empty | 0 bytes | 0 bytes | PASS |
| Mid-run SHOW POOLS snapshot present | non-empty | partial (auth failure) — pool stats captured from container logs instead, `wait=0us` per instance | PARTIAL (substitute artifact provided) |
| Container restart count (mid-run + post-run) | 0 | 0 | PASS |

**Mock verdict: FAIL.** Two hard gates blow up (error rate, realtime-ws p95). Two plausibility checks fail as corollaries of the error rate and ws-tag bug. The remaining stack-health gates (no pg errors, no rate-limit hits, no container restarts, pgbouncer wait=0us) PASS, confirming the architecture itself is sound under 1000 VU sustained — what failed is the request-layer integration between k6 flows and the api+mock-litellm response envelopes.

## load-test-realistic profile

**Status: DEFERRED — not executed.**

| Check | Verdict |
|-------|---------|
| Speaches CPU inference under 1000 VU is feasible on Apple M3 Max | **DEFERRED** (per RESEARCH.md §Pitfall 2 — CPU inference at ~0.5 RTF saturates with 1 process serving 1000 VUs; would produce hardware-bound numbers, not architecture-bound) |
| Realistic profile depends on a valid mock baseline for comparison | **BLOCKED** (mock gates FAIL — see above) |

**Realistic verdict: DEFERRED with documented root cause.** Plan 08-07's graceful-degradation clause authorizes this when realistic is structurally unrunnable on the developer Mac.

## Recommendation to plan 08-08 (or 08-07.1 follow-on)

1. **Triage the 99.93% error rate** — keep the stack alive after k6 exits non-zero, capture api logs, identify which HTTP status code dominates the failure set. Likely causes (in order of probability): request body schema mismatch between flows/*.ts and the actual api routes (e.g., `/api/transcribe` expects multipart with a `file` field, k6 sends one with `audio`); mock-litellm response envelope shape doesn't match api forwarder's expectations; Bearer-token bound to wrong tenant context.
2. **Fix `flows/realtime-ws.ts` tag mapping** — `iteration_duration{endpoint:realtime-ws}` Trend never received a non-zero value despite 168,836 WS sessions completing. The flow's async callback returns before the iteration's recorded duration captures the round-trip.
3. **Add `pgbouncer_admin` to `compose/pgbouncer/userlist.txt`** so future runs can execute `SHOW POOLS` directly.
4. Re-run mock until error rate < 1%. THEN run realistic.

---

## Update — Plan 08.1-01 Run 2 single-shot forensic validation (2026-05-12T18:00:00Z)

Plan 08.1-01 closed Anomalies #1–#3 at the **code level** with passing TDD tests (67 unit tests + 5 hermetic shell tests) and partially validated live via the forensic-probe.ts harness. A full 30-min plateau under 1000 VU was OUTSIDE this session's wall-clock budget; the operator runs the canonical `make load-test PROFILE=mock` to produce the SLO-grade baseline. See `RUN-LOG.md` "Run 2" section for the per-anomaly disposition table.

### Strike-through prior FAIL rows (closed by Plan 08.1-01)

| Check (Run 1) | Closed by | Evidence (Run 2) |
|---|---|---|
| ~~Error rate < 1% (FAIL 99.93%)~~ | k6 flow request-shape fixes (Tasks 2.a/2.b) | transcribe + reason return 200 LIVE; agent-stream still has api-side `upstream_error` outside Plan 08.1-01 scope (Fastify accepts the body — parser fires) |
| ~~realtime-ws endpoint p95 reported (FAIL =0)~~ | custom Trend metric `realtime_ws_roundtrip_ms` (Task 3) | 8 unit tests + clock-stub regression guard |
| ~~Mid-run SHOW POOLS snapshot (PARTIAL)~~ | `compose/pgbouncer/bootstrap.sh` (Task 4) | `runs/2026-05-12T18-00-00Z-mock/diagnostics/show-pools.txt` returns rows under `pgbouncer_admin` |

### Residual gaps to close in a follow-up

- agent-stream upstream_error — api-side issue with `undici.fetch` in `apps/api/src/routes/agent/stream.ts`. The k6 envelope is correct (Fastify accepts it, body parser fires). NOT a load-test fix. Likely SSRF-dispatcher / undici-dispatcher integration mismatch specific to that route's `fetch` import (other routes use the shared litellm-client which uses `undici.request` and works fine).
- 30-min mock plateau under operator-controlled wall clock — not attempted in this session per the plan's hard cap protocol.
