---
phase: 08-load-test-tuning-slo-publication
plan: 07
type: execute
wave: 3
depends_on:
  - 06
files_modified:
  - .planning/phases/08-load-test-tuning-slo-publication/runs/.gitkeep
  - .planning/phases/08-load-test-tuning-slo-publication/runs/RUN-LOG.md
autonomous: true
requirements:
  - SCALE-02
  - SCALE-06
  - SCALE-07
  - TEST-LOAD-01
must_haves:
  truths:
    - "`make load-test PROFILE=mock` ran to completion on the developer Mac (48GB RAM) and produced a non-empty k6 JSON output + summary at .planning/phases/08-load-test-tuning-slo-publication/runs/."
    - "`make load-test PROFILE=realistic` ran to completion and produced a non-empty k6 JSON output + summary."
    - "Both runs satisfied the exit gates: error rate < 1%, no api/pgbouncer/postgres/traefik container restarts during the 30-min run, all 4 endpoints reported a p95 value (no zero-count endpoint)."
    - "PgBouncer pool-exhaustion ratio stayed < 5% of cl_active during the 20-min sustained block (verified via mid-run `SHOW POOLS` snapshot recorded in RUN-LOG.md)."
    - "No `prepared statement does not exist` errors in api or pgbouncer logs (zero tolerance per RESEARCH.md §Pitfall 3)."
    - "No 5xx errors from rate-limit (zero 429s — confirms plan-01 env switch active under load-test profiles)."
    - "Raw k6 JSON outputs committed under `.planning/phases/08-load-test-tuning-slo-publication/runs/<timestamp>-{mock,realistic}.json` and `<timestamp>-{mock,realistic}-summary.json`."
    - "RUN-LOG.md captures: host specs, Docker Desktop allocation, run start/end times, both profiles, exit-gate outcomes, mid-run SHOW POOLS snapshots, container restart count, raw p95 per endpoint per profile."
  artifacts:
    - path: ".planning/phases/08-load-test-tuning-slo-publication/runs/RUN-LOG.md"
      provides: "Human-readable run journal with all exit-gate evidence"
      min_lines: 60
    - path: ".planning/phases/08-load-test-tuning-slo-publication/runs/"
      provides: "Directory containing all raw k6 JSON outputs + summaries from this and future runs"
  key_links:
    - from: "runs/RUN-LOG.md"
      to: "runs/<timestamp>-mock-summary.json"
      via: "embedded p95 table cites JSON path"
      pattern: "summary\\.json"
    - from: "runs/RUN-LOG.md"
      to: "runs/<timestamp>-realistic-summary.json"
      via: "embedded p95 table cites JSON path"
      pattern: "summary\\.json"
---

<objective>
Execute the live `make load-test` runs on the developer Mac (48GB RAM) for BOTH profiles. This is the D-EXEC-2 mandate: "The first `make load-test` run actually executes on the Mac and produces real baseline numbers. Raw k6 output + summary table embedded in `08-SUMMARY.md`. No estimates, no extrapolated numbers in operations.md."

This is the goal-backward critical path: every prior plan exists to make THIS run possible. Plan 08 (Wave 4) cannot produce SLO budgets in `docs/operations.md` without the JSON outputs from THIS plan.

Wall clock: ~75 minutes total
- Mock profile run: 30 min (k6) + ~5 min compose up/down + 10 min buffer for diagnostics if something flakes
- Realistic profile run: 30 min + 10 min speaches preload/pre-warm + buffer

The operator (Claude or human) executes the runs interactively, observes Grafana live, captures snapshots, and records everything in RUN-LOG.md. If exit gates fail, debug-and-rerun is mandatory (no "publish anyway"); see the gap-handling section below.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/08-load-test-tuning-slo-publication/08-CONTEXT.md
@.planning/phases/08-load-test-tuning-slo-publication/08-RESEARCH.md
@Makefile
@tools/load-test/scripts/run.sh

<interfaces>
<!-- This plan EXECUTES code; no new interfaces are defined. -->
<!-- The orchestration surface is `make load-test PROFILE=mock` and `make load-test PROFILE=realistic` (plan 06). -->
<!-- The result surface is the runs/ directory + RUN-LOG.md. -->
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create runs/ directory + RUN-LOG.md skeleton</name>
  <files>.planning/phases/08-load-test-tuning-slo-publication/runs/.gitkeep, .planning/phases/08-load-test-tuning-slo-publication/runs/RUN-LOG.md</files>
  <action>
    Create the directory + a skeleton RUN-LOG.md with sections to be filled in by Tasks 2 and 3:

    ```markdown
    # Phase 8 Load Test — Run Log

    **First run:** <timestamp UTC>
    **Operator:** <name>
    **Host:** Mac model + chip + RAM
    **Docker Desktop:** version + allocated RAM/CPU
    **k6 version:** `k6 version`
    **Stack:** docker-compose.yml + docker-compose.load-test.yml; commit <git rev-parse HEAD>

    ## Run 1: load-test-mock profile

    **Started:** <ts>
    **Ended:** <ts>
    **k6 summary JSON:** runs/<timestamp>-mock-summary.json
    **k6 raw JSON:** runs/<timestamp>-mock.json (sampled lines if too large)

    ### Exit Gates

    - [ ] Error rate < 1%: <observed>%
    - [ ] No container restarts: `docker compose ps --filter status=restarting` empty? <yes/no>
    - [ ] All 4 endpoints reported p95: <yes/no>
    - [ ] No `prepared statement does not exist` in api/pgbouncer logs: <yes/no>
    - [ ] No 429 responses (rate-limit not triggered): <yes/no>
    - [ ] PgBouncer pool-exhaustion ratio < 5%: <observed>%

    ### Per-endpoint p95 (raw, ms)

    | Endpoint | p50 | p95 | p99 | RPS | Error % |
    |----------|----:|----:|----:|----:|--------:|
    | transcribe   |  |  |  |  |  |
    | reason       |  |  |  |  |  |
    | agent-stream TTFB |  |  |  |  |  |
    | agent-stream total |  |  |  |  |  |
    | realtime-ws  |  |  |  |  |  |

    ### Mid-run SHOW POOLS snapshot (T+15min)

    ```
    <paste output of: docker exec <pgbouncer-1> psql ... -c 'SHOW POOLS'>
    ```

    ### Anomalies / notes

    <free-text>

    ---

    ## Run 2: load-test-realistic profile

    [same structure as Run 1]

    ---

    ## Cross-profile observations

    - Gateway overhead (mock p95): <transcribe ms>
    - End-to-end overhead (realistic p95): <transcribe ms>
    - Speaches-attributable delta: <difference>
    ```

    Commit: `chore(08-07): scaffold runs/ directory + RUN-LOG.md skeleton for live run`.
  </action>
  <verify>
    <automated>test -d .planning/phases/08-load-test-tuning-slo-publication/runs && test -f .planning/phases/08-load-test-tuning-slo-publication/runs/RUN-LOG.md</automated>
  </verify>
  <done>Directory + skeleton committed.</done>
</task>

<task type="auto">
  <name>Task 2: Execute load-test-mock profile (LIVE RUN — 30 min wall clock)</name>
  <files>.planning/phases/08-load-test-tuning-slo-publication/runs/RUN-LOG.md, .planning/phases/08-load-test-tuning-slo-publication/runs/&lt;timestamp&gt;-mock.json, .planning/phases/08-load-test-tuning-slo-publication/runs/&lt;timestamp&gt;-mock-summary.json</files>
  <action>
    PRECONDITIONS (the executor verifies before kicking off):
    - Docker Desktop allocates ≥ 32 GB RAM and ≥ 6 CPU. Confirm via `docker info | grep -E '(Total Memory|CPUs)'`. If below, abort and instruct operator to raise it.
    - `k6 version` succeeds (k6 v2.0+ on Mac host via `brew install k6`).
    - Working tree clean: `git status --porcelain` empty (per preflight.sh).
    - `pnpm install` completed; `pnpm --filter @openwhispr/load-test build` produces dist/main.js.
    - `pnpm --filter @openwhispr/api typecheck && pnpm --filter @openwhispr/api test` green (catch local regressions BEFORE consuming 30 min).

    EXECUTION (interactive — do NOT run in background):
    1. Open RUN-LOG.md, record host specs, Docker Desktop allocation, k6 version, git commit.
    2. Open Grafana at http://localhost:3000 (after compose up) with the k6 Prometheus dashboard pre-selected so live observation is possible.
    3. Run `make load-test PROFILE=mock` from a clean tree. This invokes run.sh which:
       a. Preflights.
       b. Builds images.
       c. Composes up under load-test-mock profile.
       d. Builds k6 bundle.
       e. Executes k6 with prometheus-rw output + JSON capture (~30 minutes).
       f. Tears down.
    4. While the run is in progress (specifically at minute 15 — mid-sustained block), capture mid-run diagnostics in a second terminal:
       ```sh
       # pgbouncer pool snapshot (do this for at least one of pgbouncer-1..4)
       docker exec -it $(docker ps --filter name=pgbouncer-1 -q) \
         psql -h 127.0.0.1 -p 5432 -U pgbouncer_admin pgbouncer \
         -c 'SHOW POOLS' >> snapshot-mid-mock.txt

       # container restart count
       docker compose -f docker-compose.yml -f docker-compose.load-test.yml \
         --profile load-test-mock ps --format json > containers-mid-mock.json

       # grep for prepared-statement errors
       docker compose -f docker-compose.yml -f docker-compose.load-test.yml \
         --profile load-test-mock logs api 2>&1 | grep -i "prepared statement" > pgerrors-mid-mock.txt

       # grep for 429s
       docker compose -f docker-compose.yml -f docker-compose.load-test.yml \
         --profile load-test-mock logs api 2>&1 | grep -E " 429 " > rate-limit-mid-mock.txt
       ```
    5. After run completes, run.sh prints the path to runs/<timestamp>-mock-summary.json. Open it and:
       - Verify it parses as JSON (`jq . runs/<timestamp>-mock-summary.json > /dev/null`).
       - Extract per-endpoint p95 via `jq` queries against the summary structure (k6 summary has `metrics.http_req_duration{endpoint:transcribe}.values.p(95)` style structure).
       - Fill the RUN-LOG.md per-endpoint p95 table.
    6. Verify each exit gate; check the box if passed, note observed value:
       - Error rate < 1% → from summary `http_req_failed.values.rate`
       - No container restarts → `docker compose ps` showed all "running", none "restarting" at any sample
       - All 4 endpoints reported p95 → all 4 tags have non-null p95 values
       - No prepared-statement errors → `pgerrors-mid-mock.txt` empty
       - No 429s → `rate-limit-mid-mock.txt` empty
       - PgBouncer pool exhaustion < 5% → from snapshot-mid-mock.txt, `cl_waiting / cl_active < 0.05`
    7. If ANY gate fails, do NOT publish. Investigate (most likely culprits documented in §Pitfalls 3, 4, 5 of RESEARCH.md), fix, and RE-RUN. Document the failure + fix in RUN-LOG.md "Anomalies" section.
    8. Commit raw artifacts: `git add .planning/phases/08-load-test-tuning-slo-publication/runs/*-mock*.json snapshot-mid-mock.txt`. Commit message: `chore(08-07): live run baseline — load-test-mock @ <timestamp>`.

    OPERATOR NOTES:
    - If Docker Desktop OOMs (RESEARCH.md §Pitfall 1), raise allocation and re-run from scratch.
    - If 429s appear, plan-01's env switch is not propagating — check `docker exec <api> env | grep OPENWHISPR_DISABLE_RATE_LIMIT`.
    - If prepared-statement errors appear, raise pgbouncer `MAX_PREPARED_STATEMENTS` (currently 200) and re-run.
    - The raw JSON output can be large (50-200 MB). It's still committed (per D-EXEC-2 "Raw k6 output ... in 08-SUMMARY.md") — if it exceeds 100 MB, git LFS or compression (`gzip` the json) is acceptable; document in RUN-LOG.md.
  </action>
  <verify>
    <automated>jq -e '.metrics["http_req_duration"] != null' .planning/phases/08-load-test-tuning-slo-publication/runs/*-mock-summary.json && grep -F '[x]' .planning/phases/08-load-test-tuning-slo-publication/runs/RUN-LOG.md | wc -l | awk '$1>=6{exit 0} {exit 1}'</automated>
  </verify>
  <done>Mock-profile JSON + summary committed; RUN-LOG.md Run 1 section fully filled with green exit gates; mid-run diagnostics captured.</done>
</task>

<task type="auto">
  <name>Task 3: Execute load-test-realistic profile (LIVE RUN — 30 min wall clock + speaches preload)</name>
  <files>.planning/phases/08-load-test-tuning-slo-publication/runs/RUN-LOG.md, .planning/phases/08-load-test-tuning-slo-publication/runs/&lt;timestamp&gt;-realistic.json, .planning/phases/08-load-test-tuning-slo-publication/runs/&lt;timestamp&gt;-realistic-summary.json</files>
  <action>
    Same structure as Task 2, but:
    1. Account for speaches first-time model download from Hugging Face. Confirm `WHISPER_MODEL` env resolves; document the model bytes pulled.
    2. The pre-warm-speaches.sh step inside run.sh handles the cold-start latency (RESEARCH.md §Pitfall 10).
    3. Expect realistic transcribe p95 to be 10-60× the mock baseline (Apple-Silicon CPU inference, RESEARCH.md §Pitfall 2). This is BY DESIGN per D-PROF-1; operations.md will label it accordingly.
    4. Mid-run snapshots: same set of pgbouncer/container/error captures, suffixed `-realistic`.
    5. Exit-gate threshold for transcribe latency is LOOSER for realistic (no p95 < 10× of mock — the realistic profile is bounded by Mac hardware). The actual gate is "all 4 endpoints reported a p95 value" + "no >10× outliers vs steady-state OF ITSELF" (i.e., within-profile consistency, not cross-profile).
    6. Fill RUN-LOG.md Run 2 section.
    7. Commit raw artifacts. Commit message: `chore(08-07): live run baseline — load-test-realistic @ <timestamp>`.

    Total wall clock for this task: ~50 minutes (10 min compose+preload + 5 min pre-warm + 30 min k6 + 5 min teardown + diagnostics).

    GRACEFUL DEGRADATION: If speaches image is unavailable from `ghcr.io/speaches-ai/speaches:latest-cpu` at run time, abort the realistic run, document in RUN-LOG.md, and let Wave 4 (plan 08) publish the mock baseline + flag the realistic baseline as DEFERRED with a clear root cause and re-run instructions. Do NOT publish fabricated numbers. (D-EXEC-2: "No estimates.")
  </action>
  <verify>
    <automated>jq -e '.metrics["http_req_duration"] != null' .planning/phases/08-load-test-tuning-slo-publication/runs/*-realistic-summary.json && grep -A 30 'Run 2' .planning/phases/08-load-test-tuning-slo-publication/runs/RUN-LOG.md | grep -F '[x]' | wc -l | awk '$1>=6{exit 0} {exit 1}'</automated>
  </verify>
  <done>Realistic-profile JSON + summary committed (OR documented deferral if speaches unavailable); RUN-LOG.md Run 2 section filled.</done>
</task>

<task type="auto">
  <name>Task 4: Automated sanity-check of both run outputs</name>
  <files>.planning/phases/08-load-test-tuning-slo-publication/runs/SANITY.md</files>
  <action>
    Programmatically validate both run summaries and write SANITY.md:

    For each profile (mock + realistic, if not deferred):
    1. `jq -e .metrics .planning/phases/08-load-test-tuning-slo-publication/runs/*-{mock,realistic}-summary.json` succeeds.
    2. Error rate < 1%: `jq -e '.metrics["http_req_failed"].values.rate < 0.01'` returns true.
    3. All 4 endpoints have non-null p95: extract `.metrics["http_req_duration{endpoint:<ep>}"].values["p(95)"]` for each of transcribe / reason / agent-stream / realtime-ws.
    4. Plausibility ranges (mock profile):
       - transcribe p95 in [1500, 8000] ms (mock 1500ms ± jitter + api/Traefik overhead under load)
       - reason p95 in [300, 3000] ms
       - agent-stream TTFB p95 in [200, 2000] ms
       - realtime-ws p95 in [50, 1000] ms
    5. Plausibility ranges (realistic profile): transcribe p95 >> mock transcribe (≥3×). Non-transcribe endpoints within ±50% of mock.
    6. Mid-run captures (snapshot-mid-*.txt, pgerrors-mid-*.txt, rate-limit-mid-*.txt) exist AND pgerrors + rate-limit captures are empty.

    Write SANITY.md summarizing all checks with PASS/FAIL flags. Each FAIL must include the offending value and a recommended remediation pointer.

    If ANY mock-profile check FAILs, the plan FAILS and the operator must re-run Task 2. The realistic profile may be deferred with documented root cause (RUN-LOG.md "Anomalies"); SANITY.md notes the deferral.

    Commit: `chore(08-07): SANITY.md — automated validation of live run outputs`.
  </action>
  <verify>
    <automated>test -f .planning/phases/08-load-test-tuning-slo-publication/runs/SANITY.md && grep -F "PASS" .planning/phases/08-load-test-tuning-slo-publication/runs/SANITY.md</automated>
  </verify>
  <done>SANITY.md exists with all mock-profile checks PASS; realistic profile either PASS or documented deferral.</done>
</task>

</tasks>

<verification>
- Both run JSON outputs exist in `runs/` and parse as valid k6 summary structures (`jq` succeeds)
- All 6 exit-gate boxes checked in RUN-LOG.md (for at least the mock profile; realistic may be deferred ONLY with documented root cause)
- Mid-run SHOW POOLS snapshot present and `cl_waiting / cl_active < 0.05`
- No `prepared statement does not exist` errors in captured logs
- No 429 responses in captured logs
- Per-endpoint p95 baselines populate the RUN-LOG.md table
- Operator approval recorded in checkpoint task
</verification>

<success_criteria>
- D-EXEC-2 satisfied: the first `make load-test` ACTUALLY EXECUTED on the Mac and produced real numbers
- Both profile baselines captured (or realistic profile documented-deferred with re-run instructions)
- All exit gates measurable and recorded
- Plan 08 (Wave 4) has concrete numbers to publish — NO estimates, NO extrapolation
</success_criteria>

<output>
After completion, create `.planning/phases/08-load-test-tuning-slo-publication/08-07-SUMMARY.md` with embedded p95 tables from both runs (this is the primary D-EXEC-2 deliverable — the SUMMARY is the operator-facing record of the live run).
</output>
