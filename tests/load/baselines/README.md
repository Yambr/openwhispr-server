<!-- SPDX-License-Identifier: FSL-1.1-ALv2 -->
# tests/load/baselines/ — perf-regression baselines for `make load-smoke`

Phase 44 / Plan 44-01 / L3.

PR-time k6 load smoke uses `tools/load-test/scripts/run.sh mock` with
`BASELINE_VUS=5` + `BASELINE_DURATION_SUSTAIN=60s` (≤ 2 min wall-clock
target). Run-output JSON lands under `tools/load-test/runs/`; the
canonical baseline lives here.

## Files

- `mock-pr-smoke.json` — last-known-good summary for the mock profile
  PR-time smoke. Operator commits a new copy when intentionally
  changing the baseline (after investigating why p95 moved).
- `README.md` — this file.

## Update procedure

1. Run `make load-smoke` locally with a clean stack.
2. Inspect `tools/load-test/runs/<timestamp>-mock-summary.json`.
3. If the numbers are intentional, copy to `mock-pr-smoke.json` with
   a commit explaining the cause (new dependency, route change, etc).
4. CI `load-smoke` job compares the new run against this baseline and
   fails if p95 latency regresses beyond the tolerance.
