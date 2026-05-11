---
phase: 06-observability-ops-hardening-workers
plan: 12d
type: execute
wave: 3
depends_on: [12a, 12b, 12c]
files_modified:
  - Makefile
  - .github/workflows/ci.yml
  - .github/workflows/nightly.yml
autonomous: true
requirements: [OBS-01, OBS-02, OBS-03, OBS-04, OBS-05, DATA-04, SCALE-01, SCALE-03, SCALE-04]
threat_model_refs: []
must_haves:
  truths:
    - "make e2e-test-phase6 runs all 8 Phase 6 e2e tests and exits 0"
    - "make e2e-test (global gate) includes phase6 subset"
    - "CI gha workflow (.github/workflows/ci.yml) runs the 3 fastest Phase 6 e2e tests on every PR (probes-dependency + audit-log-write + rate-limit-layered)"
    - "Nightly gha workflow (.github/workflows/nightly.yml) runs the full 8-test phase6 suite"
    - "Per-file Phase 6 coverage audit: every file listed in any 06-01..06-11 plan's files_modified reports ≥90/90/90/90 OR is documented in 06-12-COVERAGE.md with concrete rationale"
  artifacts:
    - path: "Makefile"
      provides: "e2e-test-phase6 target covering all 8 tests; e2e-test global gate updated"
    - path: ".github/workflows/ci.yml"
      provides: "e2e-phase6-quick PR-gate job"
    - path: ".github/workflows/nightly.yml"
      provides: "e2e-phase6 nightly job"
    - path: ".planning/phases/06-observability-ops-hardening-workers/06-12-COVERAGE.md"
      provides: "Per-file Phase 6 coverage audit + any documented gaps"
  key_links:
    - from: "every Phase 6 must_have truth"
      to: "an e2e assertion in 12a/12b/12c"
      via: "Plan 12d global gate verification"
      pattern: "Makefile|\\.github/workflows/.*\\.yml"
parent_plan: 12
split_rationale: "12d is the close-out: CI wiring + coverage audit + global gate. Depends on 12a+12b+12c so all 8 e2e tests exist before Makefile/CI references them."
---

<objective>
Close out Wave 3 by wiring all 8 Phase 6 e2e tests into the Makefile + CI, then performing the Phase-6-wide constitutional coverage audit.

Purpose: the final constitutional gate per CLAUDE.md — phase passes only when (a) e2e suite is green via `make e2e-test`, (b) coverage ≥90/90/90/90 on every new/modified file across all 11 prior plans.

Output: Makefile + CI/nightly workflows extended + 06-12-COVERAGE.md + 06-12d-SUMMARY.md.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/06-observability-ops-hardening-workers/06-12a-SUMMARY.md
@.planning/phases/06-observability-ops-hardening-workers/06-12b-SUMMARY.md
@.planning/phases/06-observability-ops-hardening-workers/06-12c-SUMMARY.md
@.planning/phases/06-observability-ops-hardening-workers/06-CONTEXT.md
@CLAUDE.md
@Makefile
@.github/workflows/ci.yml
@.github/workflows/nightly.yml
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Makefile + CI/nightly workflow wiring</name>
  <files>
    Makefile,
    .github/workflows/ci.yml,
    .github/workflows/nightly.yml
  </files>
  <read_first>
    Existing Phase 3/4/5 e2e Makefile patterns,
    Existing nightly workflow from Phase 3 Plan 10 (nightly-realtime-soak)
  </read_first>
  <behavior>
    Makefile:
    - Extend `e2e-test-phase6` (initial subset added by 12a) to invoke all 8 tests:
      ```
      e2e-test-phase6: ## Phase 6 e2e suite (8 tests)
      \tE2E=1 pnpm vitest run \\
      \t  tests/e2e/probes-dependency.test.ts \\
      \t  tests/e2e/audit-log-write.test.ts \\
      \t  tests/e2e/horizontal-scale.test.ts \\
      \t  tests/e2e/ssrf-block.test.ts \\
      \t  tests/e2e/rate-limit-layered.test.ts \\
      \t  tests/e2e/reconciliation-drift.test.ts \\
      \t  tests/e2e/log-scrub-sentinel.test.ts \\
      \t  tests/e2e/otel-trace-propagation.test.ts
      ```
    - Update global `e2e-test` target to depend on (or invoke) `e2e-test-phase6` so the project-wide gate exercises Phase 6.

    .github/workflows/ci.yml:
    - Add a new job `e2e-phase6-quick` running on ubuntu-latest with docker-buildx setup, that runs ONLY the 3 fastest Phase 6 e2e tests (probes-dependency + audit-log-write + rate-limit-layered) — these are PR-gate.
    - Must run AFTER unit + integration jobs (job-level `needs:`).
    - Timeout 20 min.

    .github/workflows/nightly.yml:
    - Add job `e2e-phase6` running the full `make e2e-test-phase6` (all 8 tests).
    - Timeout 45 min.
    - Mirror the existing nightly-realtime-soak structure from Phase 3 Plan 10.
    - Upload vitest junit output as artifact on failure.

    Pin all GHA action versions to commit SHAs per project security posture (Phase 0/2 patterns).
  </behavior>
  <action>
    Read Phase 3 Plan 10's nightly workflow as template. Reuse the docker-compose setup steps verbatim where possible to keep the contributor mental model consistent.
  </action>
  <verify>
    <automated>actionlint .github/workflows/ci.yml .github/workflows/nightly.yml &amp;&amp; grep -q 'e2e-test-phase6' Makefile</automated>
  </verify>
  <acceptance_criteria>
    - Makefile contains `e2e-test-phase6` target invoking all 8 tests
    - Global `e2e-test` target includes Phase 6 (depends_on or recursive call)
    - ci.yml contains `e2e-phase6-quick` job with 3-test subset
    - nightly.yml contains `e2e-phase6` job with full 8-test subset
    - actionlint passes
    - On a runner with Docker available, `make e2e-test-phase6` exits 0 (or document a flake retry per RESEARCH.md)
  </acceptance_criteria>
  <done>
    CI + Makefile wiring complete.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Phase 6 coverage audit + 06-12-COVERAGE.md</name>
  <files>
    .planning/phases/06-observability-ops-hardening-workers/06-12-COVERAGE.md
  </files>
  <read_first>
    Every prior Phase 6 plan's `files_modified` frontmatter list,
    All 06-01-SUMMARY.md..06-11-SUMMARY.md "Coverage" sections,
    tools/coverage-diff.cjs (if exists from Phase 0/2 — confirm)
  </read_first>
  <behavior>
    1. Enumerate every distinct file path appearing in `files_modified` across plans 06-01 through 06-11 (a..z sub-plans included). Exclude test files (test-only diffs are vacuously above 90 when their corresponding production code is exercised) UNLESS the test file IS the production artifact (tools/lint-tenant-context.ts, tools/lint-rls.ts, tools/validate-dashboards.ts — these are scripts, not tests, so they count).
    2. Run `pnpm -r test --coverage --run` (or the project's equivalent — read Phase 0 Plan 02 for canonical invocation).
    3. Parse vitest V8 coverage JSON output (`coverage/coverage-final.json` per package, or whatever the project's reporter produces).
    4. For each enumerated file, report L/B/F/S percentages.
    5. For files ≥ 90/90/90/90: green-check.
    6. For files below threshold on ANY axis: mark RED, attribute the gap to a specific cause (e.g., "defensive 401 branch shadowed by Better Auth's earlier 401 — pre-existing per 06-04-SUMMARY"; or "new gap, needs test"), and either close it inline OR document a follow-up sub-plan (06-12e?).

    Write the table + analysis to `.planning/phases/06-observability-ops-hardening-workers/06-12-COVERAGE.md`. Phase 6 CANNOT close (gsd-verifier MUST report gaps_found) if any file is below threshold AND lacks a concrete rationale that the verifier can adjudicate.

    Acceptable rationale categories: pre-existing-shadowed-defensive-branch (with concrete evidence), declarative-config-or-schema (Drizzle schema files are excluded from coverage by project vitest.config), executable-script-non-coverable (e.g., bootstrap entrypoints whose effect is asserted via integration tests). Anything else needs an actual closure plan.
  </behavior>
  <action>
    The aggregate coverage output from `pnpm -r test --coverage` will be voluminous. Consider scripting the per-file slicing via a small Node helper that reads `coverage/coverage-final.json` from each workspace package and filters by the enumerated file path set.

    Cross-reference: every SUMMARY.md already reports per-file coverage for that plan's diff — those numbers should agree with what the aggregate run produces, modulo merge effects (one file touched by 2 plans gets combined coverage from both test sets).
  </action>
  <verify>
    <automated>test -f .planning/phases/06-observability-ops-hardening-workers/06-12-COVERAGE.md &amp;&amp; grep -E 'L=[0-9]' .planning/phases/06-observability-ops-hardening-workers/06-12-COVERAGE.md</automated>
  </verify>
  <acceptance_criteria>
    - 06-12-COVERAGE.md exists with one row per enumerated file
    - Each row reports L/B/F/S
    - Every row either green-checks (≥90 on all four) or has a rationale category + evidence
    - If any "needs-test" gap exists, the doc lists a concrete closure plan (file path + missing branch + test idea)
  </acceptance_criteria>
  <done>
    Phase 6 coverage state fully documented; gsd-verifier has the data it needs to adjudicate phase closure.
  </done>
</task>

</tasks>

<verification>
- `make e2e-test-phase6` exits 0 with all 8 tests green
- `make e2e-test` exits 0 (global gate includes phase6)
- `actionlint` clean on both modified workflows
- 06-12-COVERAGE.md exists + every file rationalized
- All 12 Phase 6 plans have SUMMARY.md present (count: 06-01..11 + 12a/b/c/d)
</verification>

<success_criteria>
Phase 6 ready for gsd-verifier: all 12 plans landed, 8 e2e tests GREEN, CI wired (PR-gate + nightly), coverage state documented per-file. Constitutional CLAUDE.md gate cleared.
</success_criteria>

<output>
Create `.planning/phases/06-observability-ops-hardening-workers/06-12d-SUMMARY.md` with: aggregate test count, CI workflow evidence, coverage audit summary (X green, Y rationalized, Z needing follow-up), and a final gsd-verifier readiness checklist.
</output>
