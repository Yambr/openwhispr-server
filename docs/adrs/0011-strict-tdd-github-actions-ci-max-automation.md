# ADR-0011: Strict TDD + GitHub Actions CI + maximum automated coverage (no human QA)

**Status:** accepted

**Date:** 2026-05-13

**Phase:** 10 — i18n, Docs & OSS Housekeeping (records a constitutional decision in force since Phase 0)

## Context

OpenWhispr Server is built by a small team without a dedicated QA function.
The constitutional discipline in CLAUDE.md is explicit:

- **Strict TDD** — RED → GREEN → REFACTOR; tests precede production code on
  every phase (including X.Y sub-plans); each fix lands with its tests in the
  same atomic commit.
- **Per-phase coverage floor ≥ 90%** on lines / branches / functions / statements
  for all new or modified code.
- **No mocks of internal logic** — mocks allowed only at process or network
  boundaries (third-party SaaS HTTP, OS time, filesystem). DB-touching code
  uses real Postgres + PgBouncer + Valkey via testcontainers.
- **Maximum test automation** — coverage spans unit, integration, e2e,
  contract (vs. `BACKEND_SPEC.md`), load (1000 concurrent), security (SAST +
  deps + container + secrets + license), migration safety, i18n completeness,
  and RLS-isolation property tests.
- **GitHub Actions** is the only sanctioned CI.

This ADR records the decision so the discipline survives contributor turnover.

## Decision

The project's engineering discipline is constitutional and non-negotiable:

- **TDD on every phase.** A test commit (RED) precedes the implementation
  commit (GREEN) for every feature, with a refactor commit if helpful. The
  RED phase must produce a *failing* test; if a test passes unexpectedly
  during RED, the planner halts and investigates rather than proceeding.
- **Coverage gate.** Vitest + c8 emit per-package lcov reports on every PR;
  the diff-coverage tool fails the build if any of lines / branches /
  functions / statements drops below 90% on the diff.
- **Mutation testing.** Stryker runs on a nightly schedule against the
  highest-risk packages (auth, RLS, error-handler, i18n init, audit).
- **CI runs everything per PR.** `.github/workflows/ci.yml` runs unit +
  integration + contract + e2e + i18n completeness + lint-english + lint-deps
  + lint-migrations + biome + spdx-check. Load and security run on a separate
  scheduled workflow due to wall-clock cost.
- **E2E uses real services.** `docker compose up` boots Postgres + PgBouncer
  + Valkey + LiteLLM (or hermetic mock-LiteLLM) for the test run; the e2e
  suite targets the live wire surface.
- **No human QA gate.** The verification gate is automated: a phase passes
  iff every must-have truth in the plan verifies against the live codebase
  AND coverage stays ≥ 90/90/90/90 on the diff AND e2e is green.

## Consequences

- **Easier:** regressions surface in CI, not in production; contributors get
  immediate feedback; the test suite is the executable specification (no
  separate test plan document drifts).
- **Easier (refactoring):** the 90% coverage floor + mutation testing means
  refactors can proceed with confidence; the test suite catches behavior drift.
- **Harder:** initial test scaffolding cost is real — testcontainers, fixture
  databases, mock-LiteLLM, BullMQ test harness all need to exist before the
  first feature lands. Phase 0 absorbed that cost up front.
- **Harder:** CI minutes are non-trivial; the load and security suites are
  scheduled (nightly) rather than per-PR to keep PR feedback under 10 minutes.
- **Risk:** flaky tests erode the discipline. Mitigated by zero-tolerance on
  flake — a flaky test is quarantined the same day it is observed, and the
  underlying race condition is treated as a Sev-2 bug.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| **Pragmatic TDD** (tests-after-fact) | Tests-after rarely cover the failure modes the implementer did not think of; tests-first forces the failure modes into the design phase. |
| **GitLab CI** | Comparable feature set, but the OSS contributor pool is on GitHub; switching CIs raises the barrier to contribution. |
| **Buildkite / CircleCI / Jenkins** | All workable, none preferred — GitHub Actions is co-located with the source repo (less surface to authenticate, less surface to leak). |
| **Manual QA pass** | The team does not have a QA function; the only sustainable path is automation. |
| **Lower coverage floor** (e.g. 70%) | Coverage drops are sticky — once 70% is acceptable, 60% becomes acceptable. The 90% floor is enforced on the diff (not on the cumulative codebase) so new code is held to the bar without forcing legacy rewrites. |

## References

- CLAUDE.md (root) — Engineering discipline section
- `.github/workflows/ci.yml` — per-PR gates
- `.github/workflows/spdx.yml` — SPDX header gate
- ADR-0002 (Vitest + Stryker for coverage and mutation)
- ADR-0003 (English-only source artifacts — also constitutional)
- `feedback_tdd_and_ci.md` — original user directive
- `feedback_no_workarounds_enterprise.md` — no shortcuts
