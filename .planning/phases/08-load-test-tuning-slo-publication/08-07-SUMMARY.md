---
phase: 08-load-test-tuning-slo-publication
plan: 07
subsystem: load-test
tags: [k6, load-test, live-baseline, deviations, deferred-realistic]
requires:
  - phase 08/plan 01 (OPENWHISPR_DISABLE_RATE_LIMIT)
  - phase 08/plan 02 (load-test workspace + provisionUsers)
  - phase 08/plan 03 (mock-litellm)
  - phase 08/plan 04 (fd-probe)
  - phase 08/plan 05 (docker-compose.load-test.yml + preflight.sh)
  - phase 08/plan 06 (k6 flows + run.sh + makefile)
provides:
  - runs/2026-05-12T16-00-53Z-mock-summary.json — k6 summary (164 KB)
  - runs/RUN-LOG.md — operator-facing journal with full anomaly inventory
  - runs/SANITY.md — programmatic gate-check (mock FAIL on error rate; realistic DEFERRED)
  - runs/mock/diagnostics/* — mid-run pgbouncer/container/grep evidence
affects:
  - docker-compose.yml (extended profiles for migrate, loki, tempo, otel-collector, mailpit; grafana healthcheck whitespace fix)
  - docker-compose.load-test.yml (litellm overrides the base service; pgbouncer renamed from pgbouncer-1; api gets OPENWHISPR_DISABLE_EMAIL_VERIFICATION env)
  - compose/postgres/load-test.conf (listen_addresses = '*')
  - apps/api/src/auth.ts (requireEmailVerification env-gate)
  - tools/load-test/package.json (build script copies fixtures synchronously)
  - tools/load-test/tsup.config.ts (drops async onSuccess in favor of && cp in package.json)
  - tools/load-test/scripts/run.sh (build invocation switched to local cd + pnpm run)
  - tools/load-test/src/main.ts (per-call fresh cookie jar in setup http client)
  - tools/load-test/src/flows/realtime-ws.ts (addEventListener instead of .on())
  - tools/load-test/src/utils/http-client.ts (WsSocket type aligned with k6/websockets)
tech-stack:
  added: []
  patterns:
    - Live D-EXEC-2 execution with real numbers — no estimates
    - Trap-based teardown so partial runs do not leak the 1000-VU stack
    - Indirect pool stats from pgbouncer container `LOG stats:` lines when SCRAM admin auth is unavailable
key-files:
  created:
    - .planning/phases/08-load-test-tuning-slo-publication/runs/.gitignore
    - .planning/phases/08-load-test-tuning-slo-publication/runs/RUN-LOG.md
    - .planning/phases/08-load-test-tuning-slo-publication/runs/SANITY.md
    - .planning/phases/08-load-test-tuning-slo-publication/runs/2026-05-12T16-00-53Z-mock-summary.json
    - .planning/phases/08-load-test-tuning-slo-publication/runs/mock/diagnostics/snapshot-mid-mock.txt
    - .planning/phases/08-load-test-tuning-slo-publication/runs/mock/diagnostics/pgbouncer-stats-mid-mock.txt
    - .planning/phases/08-load-test-tuning-slo-publication/runs/mock/diagnostics/containers-mid-mock.ndjson
    - .planning/phases/08-load-test-tuning-slo-publication/runs/mock/diagnostics/pgerrors-mid-mock.txt
    - .planning/phases/08-load-test-tuning-slo-publication/runs/mock/diagnostics/rate-limit-mid-mock.txt
    - .planning/phases/08-load-test-tuning-slo-publication/runs/mock/diagnostics/migrate-failure.log
  modified:
    - docker-compose.yml
    - docker-compose.load-test.yml
    - compose/postgres/load-test.conf
    - apps/api/src/auth.ts
    - tools/load-test/package.json
    - tools/load-test/tsup.config.ts
    - tools/load-test/scripts/run.sh
    - tools/load-test/src/main.ts
    - tools/load-test/src/flows/realtime-ws.ts
    - tools/load-test/src/utils/http-client.ts
decisions:
  - "D-LOAD-EV: requireEmailVerification gated by OPENWHISPR_DISABLE_EMAIL_VERIFICATION env, ONLY set under load-test profiles (matches plan 08-01's rate-limit-bypass pattern)"
  - "Mock-litellm replaces the base litellm service via compose merge under load-test profiles (instead of running both services with a network alias collision)"
  - "Pgbouncer service in load-test overlay overrides the BASE service (renamed from pgbouncer-1) so api.depends_on.pgbouncer resolves; the three remaining replicas (pgbouncer-2..4) share the network alias for round-robin DNS"
  - "Realistic profile DEFERRED with documented Apple-Silicon-CPU-saturation root cause per plan's graceful-degradation clause; mock baseline FAILS exit gates (error rate, realtime-ws tag) so realistic comparison is blocked anyway"
metrics:
  duration: "32m03s wall clock (Run 1, including build + compose + setup + k6 + teardown)"
  completed: "2026-05-12T16:32:14Z"
---

# Phase 8 Plan 07: Live Baseline Run Summary

D-EXEC-2 mandate executed: the first `make load-test PROFILE=mock` actually ran on the developer Mac (Apple M3 Max / 48 GB unified memory / Docker Desktop 24.0.6 with 35.18 GiB / 10 CPUs). 30-minute scenario ramped 1000 VUs and sustained them per D-LOAD-2 — 1,697,912 iterations completed, 0 interrupted. Per-endpoint p95 captured for 3 of 4 HTTP endpoints. The mock baseline FAILS its exit gates (99.93% HTTP error rate + zero-valued realtime-ws tag), and the realistic profile is DEFERRED per the plan's graceful-degradation clause. Detailed numbers + full re-run instructions live in `runs/RUN-LOG.md`.

## What was built

**Live run artifacts (mock profile):**

| Artifact | Size | Status |
|----------|------|--------|
| `runs/2026-05-12T16-00-53Z-mock-summary.json` | 164 KB | committed |
| `runs/2026-05-12T16-00-53Z-mock.json.gz` | 172 MB (from 6.4 GB raw) | gitignored (exceeds GitHub 100 MB limit), kept locally |
| `runs/mock/diagnostics/snapshot-mid-mock.txt` | 730 B | committed |
| `runs/mock/diagnostics/pgbouncer-stats-mid-mock.txt` | 200 B | committed |
| `runs/mock/diagnostics/containers-mid-mock.ndjson` | 23 KB | committed |
| `runs/mock/diagnostics/pgerrors-mid-mock.txt` | 0 B (no hits = PASS) | committed |
| `runs/mock/diagnostics/rate-limit-mid-mock.txt` | 0 B (no hits = PASS) | committed |
| `runs/mock/diagnostics/migrate-failure.log` | 441 B (early-iteration evidence) | committed |
| `runs/RUN-LOG.md` | 5 KB | committed |
| `runs/SANITY.md` | 3 KB | committed |

**Realistic profile artifacts:** none — DEFERRED.

## Per-endpoint p95 (mock, RAW — not a published SLO due to error-rate gate failure)

| Endpoint            |  p50 (ms) |  p95 (ms) | Source |
| ------------------- | --------: | --------: | ------ |
| transcribe          |    849.46 |   1280.09 | summary metric `http_req_duration{endpoint:transcribe}` |
| reason              |    849.28 |   1278.57 | summary metric `http_req_duration{endpoint:reason}` |
| agent-stream (TTFB) |       n/a |   1280.05 | summary metric `agent_stream_ttfb` |
| agent-stream total  |    849.88 |   1280.18 | summary metric `http_req_duration{endpoint:agent-stream}` |
| realtime-ws (iter)  |      0.00 |      0.00 | summary metric `iteration_duration{endpoint:realtime-ws}` — tag-mapping bug |

Aggregate: 1,531,076 HTTP requests at 823.6 req/s; 1,697,912 iterations at 913.4 iter/s; 168,836 WebSocket sessions at 90.8/s. Vus_max=1000, sustained.

## Exit-gate verdicts

| Gate | Observed | Verdict |
|------|----------|---------|
| Error rate < 1% | 99.93% | **FAIL** |
| No container restarts | 0 | PASS |
| All 4 endpoints reported p95 | 3 of 4 (realtime-ws=0) | **FAIL** |
| No `prepared statement does not exist` errors | 0 hits | PASS |
| No 429 responses | 0 hits | PASS |
| PgBouncer pool-exhaustion < 5% | wait_time=0us per instance | PASS |

## Deviations from Plan

Eight in-flight Rule-1/2/3 deviations applied during plan 08-07 (in commit-chronological order). None required user intervention — all surfaced when the live run progressed past prior breakpoints, and the user explicitly authorized autonomous progression through the commit ("No more user checkpoints — proceed autonomously through commit").

### Auto-fixed Issues

**1. [Rule 3 — Missing-config] Extend load-test profiles to all api transitive deps** — `docker compose --profile load-test-mock up` aborted with "service otel-collector is required by api but is disabled" because the profile arrays of `otel-collector`, `loki`, `tempo`, `migrate`, `mailpit` and `litellm` did not include the load-test variants. Fixed by extending the profile arrays in `docker-compose.yml` and replacing the `litellm` service definition under the load-test overlay to BE the mock-litellm Fastify app (eliminating the standalone `mock-litellm` service). The pgbouncer scale-out service `pgbouncer-1` was promoted to the canonical `pgbouncer` service name so api.depends_on.pgbouncer resolves under load-test profiles too. **Commit:** `f506a31`.

**2. [Rule 1 — Bug] Postgres listen_addresses defaults to localhost under custom config** — when launched with `postgres -c config_file=/etc/postgresql/postgresql.conf`, the daemon ignores the Alpine image's default `listen_addresses = '*'` and falls back to postgres's built-in default of `'localhost'`. Migrate (and every other sibling container) hit `ECONNREFUSED postgres:5432` despite the pg_isready healthcheck passing locally. Fixed by adding `listen_addresses = '*'` to `compose/postgres/load-test.conf`. **Commit:** `c1d6d8f`.

**3. [Rule 1 — Bug] Grafana healthcheck grep was whitespace-strict** — Grafana 11.6's `/api/health` JSON is pretty-printed with a space after every colon (`"database": "ok"`), but the healthcheck `grep -q '"database":"ok"'` had no space and never matched. `docker compose up --wait` stalled until the 12 retries × 5s window expired. Fixed by switching to `grep -Eq '"database":[[:space:]]*"ok"'`. **Commit:** `b891694`.

**4. [Rule 1 — Bug] k6 fixtures missing from bundle output** — k6's `open()` resolves paths relative to the BUNDLE file at runtime, not the source. tsup's default `clean: true` removed `dist/`, the bundle wrote `dist/main.js`, but `src/fixtures/` was never copied next to it. First fix attempted via tsup's `onSuccess` hook (commit `2283abd`); turned out tsup 8.x's onSuccess runs asynchronously and can race the bundle consumer. Final fix moves the copy into the package.json build script (commit `d79bc18`) and adds `rm -rf dist/fixtures &&` to keep the destination flat on idempotent rebuilds (commit `10e14b6`). Run.sh's build invocation switched from `pnpm --filter ... build` to a subshell with `cd tools/load-test && pnpm run build` to make completion synchronous under stdin-redirected child shells (commit `4ff5566`).

**5. [Rule 2 — Missing critical functionality] Email verification blocked load-test sign-up** — Better Auth's `requireEmailVerification: true` returns a synthetic 200 with no session token, blocking `provisionUsers()` on user 0. Added `OPENWHISPR_DISABLE_EMAIL_VERIFICATION` env-gate (parallel to plan 08-01's rate-limit bypass), wired in the load-test overlay only. **Commit:** `04d66ae`.

**6. [Rule 1 — Bug] BA rejects second sign-up because cookie jar persists session** — k6's default VU cookie jar carried `__Secure-openwhispr.session_token` from user 0 into user 1's sign-up; BA returned 403 "User already authenticated". Fixed by constructing a fresh `http.CookieJar()` per setup() call. **Commit:** `22313ac`.

**7. [Rule 1 — Bug] realtime-ws used deprecated k6/ws API** — `socket.on()` is the deprecated k6/ws event-emitter API. k6/websockets requires `socket.addEventListener()`. Every realtime-ws iteration aborted with `TypeError: Object has no member 'on'`, spamming the JSON output (380 MB in 2 min before mitigation). Fixed by switching to addEventListener; the WsSocket interface in utils/http-client.ts updated to match. **Commit:** `183f4ae`.

### Deferred (not fixed in this plan)

**8. [Rule 1 — Bug] Mock profile 99.93% HTTP error rate** — the 30-min run completed without interruptions but every transcribe / reason / agent-stream HTTP request returned non-2xx/3xx. p95 latencies ≈ 1.28s for all three endpoints suggest the request reached the mock-litellm and got a response, but the body shape or status code did not satisfy the api's forwarder or k6's `expected_response` heuristic. Containers were torn down by run.sh's trap when k6 hit the threshold-failure, so the api logs were lost. **Re-run plan published in `runs/RUN-LOG.md` "Anomalies/notes #1".**

**9. [Rule 1 — Bug] realtime-ws p95 reported as 0** — 168,836 WS sessions completed (ws_connecting p95 = 5.5ms) but `iteration_duration{endpoint:realtime-ws}` reported all zeros. The k6/websockets browser-style addEventListener does not block the surrounding `client.ws()` callback, so the iteration timer captures the moment the callback returned, not the round-trip. **Re-run plan in `runs/RUN-LOG.md` "Anomalies/notes #2".**

**10. [Rule 1 — Bug] `compose/pgbouncer/userlist.txt` missing pgbouncer_admin SCRAM hash** — only `openwhispr_app` is listed, so `psql -U pgbouncer_admin` fails SCRAM authentication. Mid-run `SHOW POOLS` had to fall back to parsing pgbouncer's container `LOG stats:` line. Bootstrap.sh should regenerate userlist.txt to include the admin role. **Re-run plan in `runs/RUN-LOG.md` "Anomalies/notes #3".**

## Authentication gates / auth events

None encountered. The only authentication-relevant surface — Better Auth's `/api/auth/sign-up/email` — was unblocked by the in-plan `OPENWHISPR_DISABLE_EMAIL_VERIFICATION` env-gate (Deviation #5). Once that was in place, all 1000 setup() sign-ups returned 200 + session token successfully on the third valid run.

## Known Stubs

None. The deferred bugs (#8 / #9 / #10) are integration / runtime issues, not stub data hiding in the UI.

## Self-Check: PASSED

- All claimed artifact paths exist on disk and are tracked in git (verified via `git ls-files` and `ls -la`)
- All claimed commit SHAs resolve in `git log --all`
- Run-completion artifacts (`runs/RUN-LOG.md`, `runs/SANITY.md`, summary JSON) are present and self-consistent
- Realistic-profile deferral is documented in both RUN-LOG.md and SANITY.md with concrete re-run instructions

## What plan 08-08 should pick up

1. **Investigate and fix the 99.93% error rate** — keep the stack alive after k6 exits non-zero so api logs survive for forensic capture. Align the k6 flow request bodies with the actual api route schemas and the mock-litellm response envelopes. Most likely a schema-level mismatch.
2. **Fix `realtime-ws` p95=0 tag mapping** — either capture the iteration_duration inside a synchronous WS roundtrip, or emit a custom Trend metric per WS iteration.
3. **Regenerate `compose/pgbouncer/userlist.txt`** to include `pgbouncer_admin`'s SCRAM hash so direct `SHOW POOLS` queries work in future runs.
4. **Re-run mock profile until exit gates PASS.** Then run realistic.
5. **Publish operations.md SLO budgets** from the green mock baseline (Wave 4 of phase 08 was always going to consume this plan's output).

## Threat Flags

None new. The load-test profile is local-only by design (docker-compose `127.0.0.1`-bound ports for k6-prometheus-rw and Grafana; no network-exposed test endpoints).
