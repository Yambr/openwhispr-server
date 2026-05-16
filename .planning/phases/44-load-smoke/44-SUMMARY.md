# Phase 44 — SUMMARY (closed 2026-05-16)

ROADMAP "Phase 44: L3 PR-time k6 mock load smoke (≤ 2 min)" met.

- `Makefile` — `load-smoke` target with hard-refuse on `OPENWHISPR_LOADTEST_ALLOW_PAID=1`; PROFILE=mock pinned; BASELINE_VUS=5 + BASELINE_DURATION_SUSTAIN=60s defaults
- `.github/workflows/ci.yml` — new PR-only `load-smoke` job (5 min timeout); installs k6 from official deb repo; dumps compose logs on failure
- `tests/load/baselines/README.md` — operator-update procedure for `mock-pr-smoke.json` baseline
- `tests/self-tests/load-smoke-cost-discipline.test.ts` — 4/4 vitest GREEN; grep-based contract on Makefile + ci.yml + baselines dir
- `vitest.config.ts` — new `tests-self-tests` project entry (was silently undiscovered post-v3 migration, same drift Phase 23 fixed for tests-integration)

Per memory feedback_loadtest_cost_discipline: PROFILE=mock ONLY on PR; paid-provider gated behind `OPENWHISPR_LOADTEST_ALLOW_PAID=1` which the Makefile rejects.
