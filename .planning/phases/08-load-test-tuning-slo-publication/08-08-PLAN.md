---
phase: 08-load-test-tuning-slo-publication
plan: 08
type: execute
wave: 4
depends_on:
  - 07
files_modified:
  - docs/operations.md
  - .planning/phases/08-load-test-tuning-slo-publication/08-SUMMARY.md
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
autonomous: true
requirements:
  - SCALE-02
  - SCALE-06
  - SCALE-07
  - TEST-LOAD-01
must_haves:
  truths:
    - "`docs/operations.md` exists and contains a 'How to run the load test' section with the exact `make load-test PROFILE=mock|realistic` invocation."
    - "`docs/operations.md` contains TWO published SLO budget tables: one for `load-test-mock` (gateway p95 — LLM excluded), one for `load-test-realistic` (end-to-end p95, Mac CPU inference)."
    - "Each SLO row is `baseline × 1.20` per D-SLO-1; numbers are SOURCED from runs/<timestamp>-{mock,realistic}-summary.json — NOT extrapolated."
    - "`docs/operations.md` contains a sizing matrix: rows = {compose single-host, Helm small, Helm large}, columns = {CPU, RAM, max concurrent, pgbouncer pool, observed p95}. The compose row is filled from Phase 8 measurements; Helm rows are marked TBD/Phase-9."
    - "`docs/operations.md` includes the PgBouncer tuning rationale (4 × 100 pool = 400 backend, max_connections 500 headroom)."
    - "`docs/operations.md` includes the file-descriptor probe contract (65535 + refuse-to-start gate)."
    - "`docs/operations.md` explicitly states the Limitations: Apple Silicon Docker = CPU inference, no GPU; realistic profile baseline is bounded by developer hardware not production; v1 assumed mix ratios; v1 deferred items (nightly CI, regression budget, Phase 9 cloud GPU tuning)."
    - "`08-SUMMARY.md` exists with embedded raw p95 tables from runs/ AND verifier-style observable-truth checklist (every must_have truth from every plan 01-07 verified with evidence)."
    - "`REQUIREMENTS.md` TEST-LOAD-01 has an appended note clarifying the Phase 8 deviation (manual on-demand, not nightly CI) and pointing forward to a v2 amendment."
    - "`ROADMAP.md` Phase 8 entry is updated: status box checked, success criteria 1-7 each annotated DONE with evidence pointers."
  artifacts:
    - path: "docs/operations.md"
      provides: "Operator-facing runbook (D-DOCS-1)"
      min_lines: 200
      contains: "Load Test"
    - path: ".planning/phases/08-load-test-tuning-slo-publication/08-SUMMARY.md"
      provides: "Phase-completion SUMMARY with embedded numbers + observable-truth verification table"
      min_lines: 80
    - path: ".planning/REQUIREMENTS.md"
      provides: "TEST-LOAD-01 amendment note"
      contains: "TEST-LOAD-01"
  key_links:
    - from: "docs/operations.md"
      to: ".planning/phases/08-load-test-tuning-slo-publication/runs/"
      via: "evidence pointer for each SLO row"
      pattern: "runs/"
    - from: "08-SUMMARY.md"
      to: ".planning/phases/08-load-test-tuning-slo-publication/runs/RUN-LOG.md"
      via: "embeds + links the run log"
      pattern: "RUN-LOG"
    - from: "ROADMAP.md Phase 8"
      to: ".planning/phases/08-load-test-tuning-slo-publication/08-SUMMARY.md"
      via: "closure pointer"
      pattern: "08-SUMMARY"
---

<objective>
Translate the measured baselines from plan 07 into operator-facing documentation per D-DOCS-1: `docs/operations.md` gains a "Load Test" section with how-to-run, SLO budget tables (baseline × 1.20), sizing matrix, PgBouncer/FD tuning rationale, and explicit limitations. Phase SUMMARY embeds the numbers and the observable-truth verifier table. REQUIREMENTS.md and ROADMAP.md are updated to reflect the Phase 8 deviation from the original nightly-CI wording.

This is the goal-backward terminal: every Phase 8 success criterion in ROADMAP lines 502-509 maps to a paragraph in operations.md. The phase cannot close until this plan ships.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/08-load-test-tuning-slo-publication/08-CONTEXT.md
@.planning/phases/08-load-test-tuning-slo-publication/08-RESEARCH.md
@.planning/phases/08-load-test-tuning-slo-publication/runs/RUN-LOG.md
@.planning/phases/08-load-test-tuning-slo-publication/runs/SANITY.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md

<interfaces>
<!-- No code interfaces. Document templates: -->

operations.md outline:

```markdown
# Operations

## ... (existing sections from prior phases — Phase 1 backup/restore, Phase 5 etc. — preserved unchanged)

## Load Testing

### How to run

```sh
# Mock-LiteLLM baseline (gateway p95, LLM excluded)
make load-test PROFILE=mock

# Realistic baseline (end-to-end p95, Mac CPU inference)
make load-test PROFILE=realistic
```

### Cadence

Manual, on-demand. Re-run after any architectural change to the request path, the data layer, or the bundled LiteLLM target. Nightly CI cadence is explicitly deferred (operator discretion).

### Mix ratios (v1 assumed; revisit after operator feedback)

| Endpoint           | Weight |
|--------------------|-------:|
| POST /api/transcribe        | 50% |
| POST /api/reason            | 25% |
| POST /api/agent/stream      | 15% |
| WSS  /v1/realtime           | 10% |

### Profile: load-test-mock

LiteLLM upstream replaced by a Fastify mock with simulated latency (1500ms ± 400 transcribe, 300ms ± 80 chat, ~200ms ± 50 first token stream). Use this to size your gateway + auth + DB + ingress without LLM noise. Operators with a corporate LiteLLM should use these numbers as the gateway p95 budget.

**Published SLO budgets (baseline × 1.20):**

| Endpoint | Observed p95 (ms) | SLO p95 (ms) | Notes |
|----------|------------------:|-------------:|-------|
| transcribe       | <obs> | <obs × 1.20> | mock injects 1500ms ± jitter |
| reason           | <obs> | <obs × 1.20> | |
| agent-stream TTFB| <obs> | <obs × 1.20> | RESEARCH.md §Pitfall 6 — first-byte not total |
| agent-stream total | <obs> | <obs × 1.20> | |
| realtime-ws (open+ping+close) | <obs> | <obs × 1.20> | |

Source: runs/<timestamp>-mock-summary.json

### Profile: load-test-realistic

Speaches (Whisper-large-v3 + pyannote) inside compose. Apple Silicon → CPU inference, NO GPU passthrough.

**Published SLO budgets (baseline × 1.20):**

| Endpoint | Observed p95 (ms) | SLO p95 (ms) | Notes |
|----------|------------------:|-------------:|-------|
| transcribe       | <obs> | <obs × 1.20> | bounded by developer hardware |
| reason           | <obs> | <obs × 1.20> | matches mock (chat path unchanged) |
| agent-stream TTFB| <obs> | <obs × 1.20> | |
| agent-stream total | <obs> | <obs × 1.20> | |
| realtime-ws      | <obs> | <obs × 1.20> | |

Source: runs/<timestamp>-realistic-summary.json

⚠️ The realistic p95 is bounded by the developer Mac (M-series CPU inference). It is NOT a production prediction. Cloud GPU tuning ships in Phase 9 (Helm). See Limitations below.

### Sizing matrix

| Topology | CPU | RAM | Max concurrent | PgBouncer pool | Observed transcribe p95 |
|----------|----:|----:|---------------:|---------------:|------------------------:|
| compose single-host (Mac M-series, 32 GB allocated) | <obs> | <obs> | 1000 | 4 × 100 = 400 backend | <obs ms> |
| Helm small (Phase 9)  | TBD | TBD | TBD | TBD | TBD |
| Helm large (Phase 9 + GPU pool) | TBD | TBD | TBD | TBD | TBD |

### PgBouncer tuning rationale

- 4 instances × 100 server pool = 400 backend connections.
- Postgres `max_connections = 500` (≥ pool + small admin headroom).
- Transaction mode + `MAX_PREPARED_STATEMENTS=200` (preserves Drizzle compatibility per RESEARCH.md §Pitfall 3).
- Verification: `cl_waiting / cl_active < 5%` during the 20-minute sustained block (recorded in runs/RUN-LOG.md).

### File-descriptor probe contract (D-TUNE-2)

- `apps/api` and `traefik` containers require `ulimit -n ≥ 65535`.
- ENTRYPOINT probe at `/app/scripts/fd-probe.sh` (api) and `/usr/local/bin/fd-probe.sh` (traefik) refuses to start if `ulimit -n < 65535`.
- Default 1024 must NOT silently regress. Compose sets `ulimits: nofile: { soft: 65535, hard: 65535 }` under load-test profiles.

### Limitations

- **Hardware bound (realistic):** Apple Silicon Docker has no GPU passthrough. Speaches CPU inference is roughly 1× realtime for Whisper-large-v3 on M-series. The realistic baseline reflects developer hardware, NOT production.
- **v1 mix ratios:** 50/25/15/10 is an assumption. Revisit after operator feedback.
- **No regression CI gate (yet):** Phase 8 publishes baselines; future automation (post-v1) wires regression checks.
- **Authentication overhead:** The harness uses Better Auth bearer rotation; corporate OIDC operators may see different auth-step latencies (RESEARCH.md §Pitfall 4).
- **Cloud GPU tuning:** Out of scope for Phase 8; ships with Phase 9 (Helm).
- **OPENWHISPR_DISABLE_RATE_LIMIT:** Load-test profiles ONLY. MUST NOT be set in production (api logs WARN at boot if it is).

### Re-running after a regression

1. Make the architectural change on a branch.
2. `make load-test PROFILE=mock` and inspect against the table above.
3. If new p95 > SLO (baseline × 1.20), reject the change OR justify + republish baselines (commit fresh runs/<timestamp>-* and update this table).
4. Realistic profile re-run is optional but recommended for changes touching the audio/STT path.
```

08-SUMMARY.md template extends `$HOME/.claude/get-shit-done/templates/summary.md` and adds the per-plan must_have verification table (per plan 01..07: list every truth, mark with [x] PASS + evidence path).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Author docs/operations.md (or extend existing)</name>
  <files>docs/operations.md</files>
  <action>
    1. Check if `docs/operations.md` already exists (Phase 1 created backup/restore section; Phase 5 may have added more).
    2. If exists: APPEND the "Load Testing" section at the end (or insert before a "Troubleshooting" section if one exists).
    3. If not: create with the full template above. Include a top-level outline noting other sections are populated by prior phases.
    4. Populate every `<obs>` placeholder from the run summaries:
       - `mock_summary=$(ls -1t .planning/phases/08-load-test-tuning-slo-publication/runs/*-mock-summary.json | head -1)`
       - `realistic_summary=$(ls -1t .planning/phases/08-load-test-tuning-slo-publication/runs/*-realistic-summary.json | head -1)`
       - Use `jq` to extract:
         - `.metrics["http_req_duration{endpoint:transcribe}"].values["p(95)"]` for transcribe
         - same with `endpoint:reason`, `endpoint:agent-stream`, `endpoint:realtime-ws`
         - `.metrics["agent_stream_ttfb"].values["p(95)"]` for TTFB metric (defined in plan 06)
       - Round to 1 decimal place.
       - Compute SLO = `round(observed × 1.20, 1)`.
    5. If the realistic profile was deferred (per plan 07 graceful degradation), mark its table cells as "DEFERRED — see RUN-LOG.md Anomalies" and add a paragraph explaining the deferral.
    6. Cross-link the run log: every SLO row cites the source JSON path.
    7. Make sure the document is ASCII-art-clean and renders in standard Markdown (test with `pnpm markdownlint docs/operations.md` if a markdownlint config exists in the repo).
    8. English-only per CLAUDE.md (run `tools/lint-english.sh docs/operations.md` if available).

    Commit: `docs(08-08): publish load-test SLO budgets + sizing matrix + tuning rationale in operations.md`.
  </action>
  <verify>
    <automated>test -f docs/operations.md && grep -F "Load Testing" docs/operations.md && grep -F "Published SLO budgets" docs/operations.md && grep -F "Limitations" docs/operations.md && grep -F "PgBouncer tuning" docs/operations.md && grep -F "File-descriptor probe" docs/operations.md</automated>
  </verify>
  <done>operations.md has the full Load Testing section with populated numbers from runs/; all 7 required subsections present; all `<obs>` placeholders replaced with real values from JSON.</done>
</task>

<task type="auto">
  <name>Task 2: Author 08-SUMMARY.md with verifier-style truth table</name>
  <files>.planning/phases/08-load-test-tuning-slo-publication/08-SUMMARY.md</files>
  <action>
    Start from `$HOME/.claude/get-shit-done/templates/summary.md` and extend with phase-specific content:

    Required sections:
    1. **Phase overview** — copy goal + decisions hash from CONTEXT.md.
    2. **Plans completed** — list 01..08 with status + commit refs (use `git log --oneline --grep "(08-"`).
    3. **Live run results** — embed the per-endpoint p95 tables for BOTH profiles from runs/RUN-LOG.md (do NOT extrapolate — copy verbatim).
    4. **Observable-truth verifier table** — for EACH plan 01..07, list every must_have truth with [x] PASS + evidence (file path, test name, or run-log section). Example row:
       ```
       | Plan 01 | "OPENWHISPR_DISABLE_RATE_LIMIT=1 disables both limiters" | [x] PASS | apps/api/src/plugins/rate-limit.test.ts + auth.test.ts |
       ```
    5. **Coverage table** — per workspace, lines/branches/functions/statements diff coverage. Must show ≥90/90/90/90 for the modified files in `apps/api/`, `tools/load-test/`, `compose/mock-litellm/`. Source via `pnpm test:coverage` per workspace.
    6. **Exit-gate evidence** — copy SANITY.md table.
    7. **Deviations / deferrals** — document realistic-profile deferral if any; document TEST-LOAD-01 amendment (manual not nightly).
    8. **Forward pointers** — Phase 9 (Helm) inherits the SLO budgets; Phase 10 (i18n + docs) re-uses operations.md.

    Length target: ≥80 lines, ≤400 lines.

    Commit: `docs(08-08): 08-SUMMARY.md — phase closure with live numbers + verifier truth table`.
  </action>
  <verify>
    <automated>test -f .planning/phases/08-load-test-tuning-slo-publication/08-SUMMARY.md && wc -l .planning/phases/08-load-test-tuning-slo-publication/08-SUMMARY.md | awk '$1>=80 {exit 0} {exit 1}' && grep -F "Observable-truth verifier" .planning/phases/08-load-test-tuning-slo-publication/08-SUMMARY.md</automated>
  </verify>
  <done>SUMMARY exists ≥80 lines; verifier truth table covers every plan 01-07; coverage table shows ≥90/90/90/90; exit-gate evidence embedded.</done>
</task>

<task type="auto">
  <name>Task 3: Update REQUIREMENTS.md TEST-LOAD-01 amendment</name>
  <files>.planning/REQUIREMENTS.md</files>
  <action>
    Read REQUIREMENTS.md. Find the TEST-LOAD-01 line. Append (do NOT delete the original requirement — it stays as the v2 ambition):

    ```markdown
    - [ ] **TEST-LOAD-01**: k6 nightly load test asserts 1000 concurrent at p95 SLO; CI fails on regression
      - **Phase 8 deviation (2026-05-12):** Nightly cadence + CI regression-gate deferred per D-EXEC-1. Phase 8 delivers manual on-demand `make load-test` + published baseline budgets + operator runbook. Nightly automation re-opens in a future phase (post-v1). See `.planning/phases/08-load-test-tuning-slo-publication/08-SUMMARY.md` and `docs/operations.md`.
    ```

    Also update the requirements table at the bottom of REQUIREMENTS.md:
    - SCALE-02 → status: **Done** (Phase 8 measured pool sizing live)
    - SCALE-06 → status: **Done with deviation** (manual not nightly; see TEST-LOAD-01 amendment)
    - SCALE-07 → status: **Done**
    - TEST-LOAD-01 → status: **Partial — manual baseline shipped; nightly + CI-regression deferred**

    Commit: `docs(08-08): REQUIREMENTS.md — TEST-LOAD-01 amendment, mark SCALE-02/06/07 Done`.
  </action>
  <verify>
    <automated>grep -F "Phase 8 deviation" .planning/REQUIREMENTS.md && grep -E "SCALE-02.*Done" .planning/REQUIREMENTS.md && grep -E "SCALE-07.*Done" .planning/REQUIREMENTS.md</automated>
  </verify>
  <done>TEST-LOAD-01 has the deviation note; SCALE-02/06/07 statuses updated; original wording preserved for v2 reference.</done>
</task>

<task type="auto">
  <name>Task 4: Update ROADMAP.md Phase 8 closure</name>
  <files>.planning/ROADMAP.md</files>
  <action>
    1. Find Phase 8 in the top status list (line 32 currently `- [ ] **Phase 8:...`). Change to `- [x] **Phase 8:...` and update the inline description to:
       `Phase 8: Load Test, Tuning & SLO Publication — manual on-demand make load-test; PgBouncer 4×100 + FD 65535; published SLO budgets in docs/operations.md; baselines from on-Mac live run. CLOSED <date>`.
    2. Find the Phase 8 details block (line 498). For each of the 7 success criteria, annotate with `✅ DONE — <evidence pointer>`. Example for SC1:
       `1. ✅ DONE — `make load-test PROFILE=mock|realistic` exists (Makefile); on-Mac live run executed <timestamp UTC>; raw outputs in runs/`.
    3. Update **Plans** line from `TBD` to a list of all 8 plans with `[x]` checkboxes and commit pointers (similar to Phase 7 / Phase 07.1 in ROADMAP).
    4. Update Progress Table row for Phase 8: `0/0 Not started` → `8/8 Complete | <date>`.

    Commit: `docs(08-08): ROADMAP.md — Phase 8 closure with evidence pointers`.
  </action>
  <verify>
    <automated>grep -E "^\\- \\[x\\] \\*\\*Phase 8:" .planning/ROADMAP.md && grep -F "8/8 Complete" .planning/ROADMAP.md</automated>
  </verify>
  <done>ROADMAP Phase 8 marked closed; each of 7 SCs annotated with evidence; Plans line populated; Progress Table updated.</done>
</task>

</tasks>

<verification>
- docs/operations.md contains the Load Testing section with all required subsections + populated numbers
- 08-SUMMARY.md exists with the verifier truth table covering plans 01-07
- REQUIREMENTS.md TEST-LOAD-01 amendment landed; SCALE-02/06/07 marked Done
- ROADMAP.md Phase 8 marked closed with evidence pointers
- All numbers in operations.md and 08-SUMMARY.md trace back to runs/*-summary.json — NO extrapolation
- English-only lint passes on operations.md (CLAUDE.md hard rule)
</verification>

<success_criteria>
- D-DOCS-1 satisfied: docs/operations.md is the operator-facing artifact with SLO budgets + sizing matrix + tuning + limitations
- D-SLO-1 + D-SLO-2 satisfied: two budget tables (mock + realistic), baseline × 1.20
- Goal-backward check: every Phase 8 success criterion in ROADMAP has a documented evidence pointer
- Phase 8 closure: ROADMAP marked, REQUIREMENTS updated, SUMMARY published
</success_criteria>

<output>
This plan IS the phase closure. After completion, the orchestrator can transition to Phase 9.
</output>
