# Phase 8 Load Test — Run Log

**First run:** 2026-05-12 (UTC times below per run)
**Operator:** Claude (autonomous executor, plan 08-07)
**Host:** MacBook Pro Mac15,9 — Apple M3 Max — 48 GB unified memory
**OS:** macOS 26.3.1 (build 25D2128)
**Docker Desktop:** Engine 24.0.6 — allocated 35.18 GiB RAM / 10 CPUs
**k6 version:** v2.0.0 (commit/devel, go1.26.3, darwin/arm64)
**Stack:** `docker-compose.yml` + `docker-compose.load-test.yml`
**Git commit at run-start:** `d26d1500c10768c18de138b342f6fe1b156f64f6`

> Constitutional D-EXEC-2 mandate: REAL numbers only. No estimates. Any
> deviation from exit gates triggers re-run; if a profile is structurally
> unrunnable on this hardware (e.g., Speaches CPU inference timeout under
> 1000 VU on Apple Silicon), it is documented as DEFERRED here with root
> cause — never fabricated.

## Run 1: load-test-mock profile

**Started:** _filled by Task 2_
**Ended:** _filled by Task 2_
**k6 summary JSON:** `runs/mock/<timestamp>-mock-summary.json`
**k6 raw JSON:** `runs/mock/<timestamp>-mock.json` (gzipped if > 50 MB)

### Exit Gates

- [ ] Error rate < 1%: _observed_
- [ ] No container restarts (api / pgbouncer-1..4 / postgres / traefik): _yes/no_
- [ ] All 4 endpoints reported p95: _yes/no_
- [ ] No `prepared statement does not exist` in api/pgbouncer logs: _yes/no_
- [ ] No 429 responses (rate-limit disabled under load-test profiles): _yes/no_
- [ ] PgBouncer pool-exhaustion ratio (`cl_waiting / cl_active`) < 5%: _observed_

### Per-endpoint p95 (raw, ms)

| Endpoint            | p50 | p95 | p99 | iters | error % |
| ------------------- | --: | --: | --: | ----: | ------: |
| transcribe          |     |     |     |       |         |
| reason              |     |     |     |       |         |
| agent-stream TTFB   |     |     |     |       |         |
| agent-stream total  |     |     |     |       |         |
| realtime-ws (iter)  |     |     |     |       |         |

### Mid-run SHOW POOLS snapshot (T+15min, sustained block)

See `runs/mock/diagnostics/snapshot-mid-mock.txt`.

### Diagnostics captured

- `runs/mock/diagnostics/snapshot-mid-mock.txt` — pgbouncer SHOW POOLS
- `runs/mock/diagnostics/containers-mid-mock.json` — container state mid-run
- `runs/mock/diagnostics/pgerrors-mid-mock.txt` — `prepared statement` grep
- `runs/mock/diagnostics/rate-limit-mid-mock.txt` — `429` grep

### Anomalies / notes

_filled by Task 2_

---

## Run 2: load-test-realistic profile

**Started:** _filled by Task 3_
**Ended:** _filled by Task 3_
**k6 summary JSON:** `runs/realistic/<timestamp>-realistic-summary.json`
**k6 raw JSON:** `runs/realistic/<timestamp>-realistic.json` (gzipped if > 50 MB)
**Whisper model:** _filled by Task 3 (resolved from `WHISPER_MODEL` env)_

### Exit Gates

- [ ] Error rate < 1%: _observed_
- [ ] No container restarts (api / pgbouncer-1..4 / postgres / traefik / speaches): _yes/no_
- [ ] All 4 endpoints reported p95: _yes/no_
- [ ] No `prepared statement does not exist` in api/pgbouncer logs: _yes/no_
- [ ] No 429 responses: _yes/no_
- [ ] PgBouncer pool-exhaustion ratio < 5%: _observed_

### Per-endpoint p95 (raw, ms)

| Endpoint            | p50 | p95 | p99 | iters | error % |
| ------------------- | --: | --: | --: | ----: | ------: |
| transcribe          |     |     |     |       |         |
| reason              |     |     |     |       |         |
| agent-stream TTFB   |     |     |     |       |         |
| agent-stream total  |     |     |     |       |         |
| realtime-ws (iter)  |     |     |     |       |         |

### Mid-run SHOW POOLS snapshot (T+15min, sustained block)

See `runs/realistic/diagnostics/snapshot-mid-realistic.txt`.

### Diagnostics captured

- `runs/realistic/diagnostics/snapshot-mid-realistic.txt`
- `runs/realistic/diagnostics/containers-mid-realistic.json`
- `runs/realistic/diagnostics/pgerrors-mid-realistic.txt`
- `runs/realistic/diagnostics/rate-limit-mid-realistic.txt`

### Anomalies / notes

_filled by Task 3_

---

## Cross-profile observations

_filled after both runs complete_

- Gateway overhead (mock p95 transcribe): _ms_
- End-to-end overhead (realistic p95 transcribe): _ms_
- Speaches-attributable delta: _difference_
