---
phase: 08-load-test-tuning-slo-publication
plan: 07.1
type: gap-closure
gap_closure: true
autonomous: true
parent: 07
wave: 3.5
depends_on: [07]
unblocks: [08]
requirements:
  - SCALE-02
  - SCALE-06
  - SCALE-07
  - TEST-LOAD-01
deferrals_closed:
  - 08-07#anomaly-1 — 99.93% HTTP error rate
  - 08-07#anomaly-2 — realtime-ws p95 = 0 (tag-mapping bug)
  - 08-07#anomaly-3 — pgbouncer_admin SCRAM hash missing from userlist.txt
---

# Plan 08-07.1: Deferral Fixes + Mock Re-run

**Why this plan exists.** Plan 07 produced a live 1000-VU mock run, but three integration-layer bugs invalidated the baseline:

1. 99.93% HTTP error rate (request-layer mismatch between k6 flows and api routes / mock-litellm envelopes)
2. `realtime-ws` p95 reported as `0` (k6/websockets `addEventListener` does not block the iteration timer)
3. `pgbouncer_admin` SCRAM hash absent from `compose/pgbouncer/userlist.txt` (forced fallback to log-scraping)

The stack itself proved sound under 1000 VU (0 container restarts, `wait_time=0us` per pgbouncer instance, 0 prepared-statement errors, 0 rate-limit hits). What failed is the harness↔api contract. This plan fixes those three bugs strictly TDD, then re-runs `make load-test PROFILE=mock` to produce a **valid** baseline. Plan 08 (docs + SLO publication) is blocked until this plan's exit gates pass.

Realistic profile remains DEFERRED per RESEARCH.md §Pitfall 2 (Apple Silicon CPU inference saturates Speaches under 1000 VU — gives hardware-bound numbers, not architecture-bound). Plan 08 will document the realistic limitation explicitly rather than chase an invalid run.

## Goal

Mock baseline run satisfies all exit gates (error rate < 1%, all 4 endpoints report non-zero p95, no container restarts, no prepared-statement errors, no 429s, pool-exhaustion < 5%) — producing artifact set consumable by plan 08 for SLO table publication.

## Tasks

### Task 1 — Forensic capture: pin down the 99.93% error path (RED-only / investigation)

**Why first.** Without knowing _which_ status code dominates (4xx vs 5xx, which endpoint, which mock-litellm response shape), the fix in Task 2 is guesswork.

**Steps:**

1. Add `OPENWHISPR_LOADTEST_KEEP_STACK=1` env-guarded branch to `tools/load-test/scripts/run.sh`: when set, the `trap` does NOT tear the stack down on k6 non-zero exit. Stack must survive long enough for `docker compose logs api > runs/forensics/api-logs.txt` and `... mock-litellm > runs/forensics/mock-litellm-logs.txt` to capture artifacts.
   - **Test:** `tools/load-test/scripts/run.test.sh` adds `T-keepstack-1` that stubs k6 with `exit 99`, sets the env var, asserts the teardown function is NOT invoked (verified via a sentinel file the stubbed teardown would have written).
2. Bring the stack up under `load-test-mock` profile manually (no full 30-min run). Provision one user via `provisionUsers(1)` from `tools/load-test/src/setup.ts` (invoke via a one-shot `pnpm --filter @openwhispr/load-test exec tsx scripts/forensic-probe.ts`).
3. New script `tools/load-test/scripts/forensic-probe.ts` makes ONE real request per endpoint (transcribe with the 5s WAV fixture, reason with a canned prompt, agent-stream with a canned conversation, realtime-ws single round-trip), logging the FULL request/response pair (status, headers, body — body truncated to 4 KB) into `runs/forensics/forensic-probe-output.json`.
   - **Test:** `forensic-probe.test.ts` mocks `http` adapter, asserts every endpoint is hit with the expected schema, asserts the output JSON is well-formed.
4. Run the probe LIVE against the running stack. Capture `runs/forensics/api-logs.txt`, `runs/forensics/mock-litellm-logs.txt`, `runs/forensics/forensic-probe-output.json`. Tear stack down manually after capture.
5. Write `runs/forensics/ROOT-CAUSE.md` documenting:
   - Per endpoint: observed status, response body shape, the api code path that rejected (file + line), the mock-litellm response that was returned
   - The exact schema delta(s) between k6 flow request and api route expectation
   - The exact response envelope delta(s) between mock-litellm output and api forwarder expectation
6. Commit: `chore(08-07.1): forensic probe + root-cause for mock error rate`.

**Exit criterion:** ROOT-CAUSE.md names a concrete fix list (file + line + delta) for each of {transcribe, reason, agent-stream}.

**Coverage gate:** ≥90/90/90/90 for any TS/JS added under `tools/load-test/`.

### Task 2 — Align k6 flows ↔ api routes ↔ mock-litellm envelopes (TDD RED→GREEN)

**Driven by Task 1's ROOT-CAUSE.md.** For each delta:

1. Write a **failing** vitest in `tools/load-test/src/flows/{transcribe,reason,agent-stream}.test.ts` (or amend existing) that asserts the flow produces the request body shape the api actually accepts. **Oracle = the api route handler signatures (TypeBox/Zod schemas in `apps/api/src/routes/`), NOT the captured broken response.** Mock-litellm envelopes are validated against OpenAI's published shapes (Whisper transcription, ChatCompletion, ChatCompletionChunk for streaming), not against k6's current (broken) expectation. `forensic-probe-output.json` and `api-logs.txt` are diagnostic evidence pointing at the delta — the canonical sources of truth are the api schemas and OpenAI's API reference.
2. Update the flow to match. Confirm test goes GREEN.
3. If a mock-litellm response delta is involved, write a **failing** vitest in `compose/mock-litellm/src/server.test.ts` asserting the envelope shape api expects (use captured api-logs.txt to extract the forwarder's parse path). Update `compose/mock-litellm/src/server.ts` to match. Confirm GREEN.
4. Per-endpoint atomic commit: `fix(08-07.1): align <endpoint> flow with api route schema`.

**Files likely touched (subject to root-cause findings):**

- `tools/load-test/src/flows/transcribe.ts` — multipart field name (`file` vs `audio`), file mime, `model` param
- `tools/load-test/src/flows/reason.ts` — JSON body shape, `model` field, `messages` envelope
- `tools/load-test/src/flows/agent-stream.ts` — SSE Accept header, `stream: true`, `messages` envelope
- `compose/mock-litellm/src/server.ts` — `/v1/audio/transcriptions` response (must echo OpenAI Whisper envelope: `{text: string, ...}`), `/v1/chat/completions` (must echo `{id, object, created, model, choices: [{message, finish_reason}], usage}`), streaming variant (SSE `data: {...}\n\n` frames with `[DONE]` terminator)

**Exit criterion:** all four flow unit tests GREEN. Manual single-shot via `forensic-probe.ts` (rerun after fix) returns 200 + valid envelope for every endpoint.

**Coverage gate:** ≥90/90/90/90 on diff.

### Task 3 — Fix realtime-ws p95 tag mapping (TDD RED→GREEN)

**Root cause** (already known from plan 07 SUMMARY): k6/websockets browser-style `addEventListener('message', cb)` is async — `client.ws()` callback returns BEFORE the round-trip completes, so the iteration timer captures the pre-roundtrip duration only.

**Fix approach.** Drop reliance on the auto-emitted `iteration_duration` tag for WS. Instead:

1. Add explicit `Trend` metric `realtime_ws_roundtrip_ms` to `tools/load-test/src/flows/realtime-ws.ts`.
2. Inside the flow: record `start = Date.now()` BEFORE `socket.send(...)`. Inside the `message` listener: `realtime_ws_roundtrip_ms.add(Date.now() - start, { endpoint: 'realtime-ws' })`. Use a barrier (e.g. `done` signaling channel or `socket.setTimeout()`-based explicit close) so the iteration does not return until the response arrives or a max-wait elapses.
3. **Test (RED first):** `flows/realtime-ws.test.ts` stubs a fake k6/websockets socket that fires `message` after a controlled delay; asserts the metric receives a value in (`delay - epsilon`, `delay + epsilon`).
4. **Verify summary export:** add a vitest asserting the summary JSON path `metrics.realtime_ws_roundtrip_ms` is reported as a non-zero Trend with at least p50/p95.
5. Commit: `fix(08-07.1): realtime-ws emits custom roundtrip Trend`.

**Exit criterion:** Unit tests GREEN. Live re-run (Task 5) reports realtime-ws p95 > 0.

**Coverage gate:** ≥90/90/90/90 on diff.

### Task 4 — Add `pgbouncer_admin` to userlist.txt + bootstrap.sh regeneration (TDD RED→GREEN)

**Root cause.** `compose/pgbouncer/userlist.txt` ships only `openwhispr_app`. The `pgbouncer_admin` postgres role exists (granted in `compose/postgres/init.sql` or migrations) but its SCRAM hash is never written, so `psql -U pgbouncer_admin -c 'SHOW POOLS'` fails SCRAM-SHA-256 auth.

**Steps:**

1. Locate the bootstrap path. Either:
   - `compose/pgbouncer/bootstrap.sh` (preferred — already runs at container start)
   - `compose/pgbouncer/Dockerfile` ENTRYPOINT wrapper
   - or new `compose/pgbouncer/scripts/regen-userlist.sh` invoked before pgbouncer's own entrypoint.
2. The script reads `PGBOUNCER_ADMIN_PASSWORD` (already in `.env.example` / docker-compose env) and the existing `POSTGRES_OWNER_PASSWORD`. It emits SCRAM-SHA-256 hashes for both `openwhispr_app` and `pgbouncer_admin` into `userlist.txt`. Hash computation via `psql -c "SELECT scram_sha_256_pass(...)"` against the postgres container OR via a portable shell implementation (RFC 7677). Prefer postgres-delegated (the container already depends_on postgres healthy).
3. **Test:** `compose/pgbouncer/bootstrap.test.sh` (or `regen-userlist.test.sh`) starts a minimal postgres + pgbouncer pair via testcontainers / docker compose, asserts `docker exec pgbouncer-1 psql -h 127.0.0.1 -p 6432 -U pgbouncer_admin pgbouncer -c 'SHOW POOLS'` returns rows. RED before the script change; GREEN after.
4. Commit: `fix(08-07.1): pgbouncer userlist.txt regenerates admin SCRAM hash on boot`.

**Exit criterion:** Live `docker exec openwhispr-pgbouncer-1 psql -h 127.0.0.1 -p 6432 -U pgbouncer_admin pgbouncer -c 'SHOW POOLS'` returns the pool table (no SASL auth failure). Plan 07's mid-run diagnostic snapshot will then work without log-scrape fallback.

**Coverage gate:** ≥90/90/90/90 on diff (shell script — assess via behaviour tests).

### Task 5 — Re-run mock profile until all exit gates PASS

**Pre-flight.**

- Tree clean
- `tools/load-test/scripts/preflight.sh --yes` exits 0
- `OPENWHISPR_LOADTEST_KEEP_STACK=1` set so the stack survives any future failure for log capture

**Run.**

1. `make load-test PROFILE=mock`. On threshold failure: capture forensics, iterate root cause back through Tasks 1–4, re-run. **Hard cap: 3 live-run attempts.** If gates still fail after attempt 3, escalate to the user with a structured report — do not silently consume another hour on a 4th run.
2. Mid-run diagnostic capture (T+15min): re-runs the snapshot suite from plan 07, plus the now-working `SHOW POOLS` via admin auth — output into `runs/<timestamp>-mock/diagnostics/` (NEW timestamped subdir; do not overwrite plan 07's run-1 evidence)
3. After successful completion: `tools/load-test/scripts/sanity.sh runs/<timestamp>-mock-summary.json` — same programmatic gate-check from plan 07, now expected to PASS all checks

**Exit gates (all must PASS — these are the gates that FAILED in plan 07 run 1):**

- Error rate < 1%
- All 4 endpoints reported non-zero p95 (transcribe, reason, agent-stream, **realtime-ws**)
- transcribe p95 within plausibility window `[1500, 8000]` ms (mock latency floor 1500ms ± api/pooler overhead)
- reason p95 within `[300, 3000]` ms
- agent-stream TTFB p95 within `[200, 2000]` ms
- realtime-ws p95 within `[50, 1000]` ms
- No `prepared statement does not exist` errors
- No 429 responses
- No container restarts
- pgbouncer wait_time per instance ≈ 0 (absolute microseconds, mirroring plan 07's PASS bar of `wait_time=0us`; allow up to ~50ms total cumulative wait per 30-min run as headroom — anything beyond indicates pool exhaustion)
- `SHOW POOLS` returns rows (not auth failure)

**Artifacts to commit:**

- `runs/<timestamp>-mock-summary.json`
- `runs/<timestamp>-mock/diagnostics/{snapshot,pgbouncer-stats,containers,pgerrors,rate-limit,show-pools}.txt|ndjson`
- `runs/SANITY.md` (updated — strike-through old FAILs, add new PASS row referring to the new timestamp)
- `runs/RUN-LOG.md` (append "## Run 2: load-test-mock — VALID baseline" section, mirror Run 1 schema, mark old Run 1 explicitly invalidated)

**Commit:** `chore(08-07.1): valid mock baseline (all exit gates PASS)`

### Task 6 — Plan SUMMARY + STATE + ROADMAP closure

1. Write `.planning/phases/08-load-test-tuning-slo-publication/08-07_1-SUMMARY.md` (frontmatter shape per project convention; include per-deferral close-out table, new baseline numbers, deviations encountered during execution).
2. Update `.planning/state/CURRENT.md` to point at plan 08-07.1 completion.
3. ROADMAP Phase 8 entry: tick the "valid mock baseline" SC; leave realistic SC at "DEFERRED — see SUMMARY".
4. Commit: `docs(08-07.1): close deferral plan — valid mock baseline + Wave 3 ready`.

## Out of scope (defer to plan 08 or beyond)

- Running the realistic profile — Apple Silicon CPU saturation makes this hardware-bound, documented in plan 08's `docs/operations.md` as a known limitation
- Per-tenant load isolation
- CI-gated regression checks against the published SLOs
- Auto-extracting OpenAPI / TypeBox schemas for the api routes (would prevent _future_ k6↔api drift but is a separate refactor)

## Coverage floor

≥ 90/90/90/90 on lines/branches/functions/statements for every TS/JS file touched. Shell scripts: behaviour-tested via `*.test.sh` harnesses (plan 07 precedent — `run.test.sh`, `preflight.test.sh`).

## Estimated wall clock

- Task 1 (forensic capture): ~20 min (manual probe + log capture)
- Task 2 (schema alignment): 30–60 min depending on number of deltas found
- Task 3 (realtime-ws): ~20 min
- Task 4 (pgbouncer userlist): ~30 min (mostly testcontainers boot time)
- Task 5 (live re-run): 35 min (30-min k6 + bring-up + teardown)
- Task 6 (docs): ~10 min

**Total: 2–3 hours wall clock, assuming root cause is one of the obvious schema deltas (file field name / envelope shape). If Task 2 surfaces a deeper authentication or tenant-scoping issue, budget +1–2 hours.**

## Threat model

No new attack surface — all changes are local to load-test tooling + dev-only env switches + bootstrap.sh that runs only in load-test profile. `OPENWHISPR_LOADTEST_KEEP_STACK` documented in `.env.example` as LOAD-TEST-ONLY, mirroring plan 08-01's pattern for `OPENWHISPR_DISABLE_RATE_LIMIT`.
