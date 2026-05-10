# Engineering Discipline (Constitutional, NON-NEGOTIABLE)

> **Source of truth:** `.planning/PROJECT.md` § "Engineering Discipline (Constitutional, NON-NEGOTIABLE)" — this file mirrors that section so phase agents and reviewers can find it under the active milestone path.
>
> **Mirrored to:** `CLAUDE.md` § "Engineering discipline (constitutional, NON-NEGOTIABLE)".
>
> **Effective:** all phases — past (retroactive verification re-runs), present, and future. The gsd-verifier agent enforces these rules. A phase MAY NOT close while any rule is violated.

## Rules

1. **Strict TDD** — RED → GREEN → REFACTOR. Tests precede production code on every phase, including decimal/insertion phases (X.Y). Each fix lands with its tests in the SAME atomic commit. No "yolo mode", no "small fix" carve-outs.

2. **Per-phase coverage floor ≥ 90/90/90/90** (lines / branches / functions / statements) on all new/modified code. Applies to every package and every phase. A phase MAY NOT close — verifier MUST report `gaps_found` — when any new/modified file is < 90 % on any axis.

3. **E2E is mandatory.** Every phase that touches a user-visible route, wire surface, or operator-facing artifact MUST ship at least one e2e test that boots the real `docker compose` stack (or hermetic mock-LiteLLM profile when the upstream is a paid SaaS) and round-trips the route. E2E tests live in `tests/e2e/` and run via `make e2e-test` (gated on `E2E=1` env). Phase verification MUST execute the e2e suite, not just unit tests, before reporting `passed`.

4. **No mocks of internal logic.** Mocks are allowed ONLY at process / network boundaries (HTTP clients to third-party SaaS, OS time, filesystem). Mocking a function the route under test calls is forbidden. If an integration is hard to test, write a real testcontainer / integration test, not a mock. `vi.mock` of project-internal modules in route tests is a TDD anti-pattern and will be flagged by code review.

5. **Real services in tests.** `packages/data` and any DB-touching code MUST run testcontainer integration tests against real Postgres + PgBouncer + Valkey. Local Docker MUST be running before phase verification claims a phase passes. CI MUST run testcontainers in matrix; a phase that ships testcontainer-skipped tests because Docker is unavailable does NOT pass verification.

6. **GitHub Actions** is the only sanctioned CI; workflows in `.github/workflows/`. CI MUST run unit + integration + contract + e2e on every PR. E2E secrets gate only the live-provider matrix; the wire-shape matrix (against hermetic mock-LiteLLM) MUST always run.

7. **Verification gate.** The gsd-verifier agent MUST execute `make e2e-test` (or hermetic equivalent) and parse `pnpm -r test --coverage` JSON output. A phase passes only when ALL of:
   1. every must_have observable truth is verified against the live codebase;
   2. coverage ≥ 90/90/90/90 on the diff;
   3. e2e suite is green;
   4. no testcontainer-skipped tests due to missing Docker.
   Anything else is `gaps_found`.

8. **Maximum test automation, no human QA.** Coverage spans unit, integration (real services via testcontainers), e2e (live compose stack), contract (against `BACKEND_SPEC.md`), load (1000 concurrent), security (SAST + deps + container + secrets + license), migration safety, i18n completeness, RLS-isolation property tests.

9. **No environment short-cuts.** `--no-verify` is permitted only when (a) the orchestrator runs in parallel-worktree mode AND (b) the post-wave hook validation will run hooks once the wave merges back. NEVER for individual developer commits, NEVER for skipping a failing test or coverage check.

10. **Audit trail.** Every phase MUST ship: PLAN.md, SUMMARY.md, REVIEW.md (code-review agent), VERIFICATION.md (verifier agent), and a coverage delta report (`<phase>-COVERAGE.md`) showing per-file before / after on the four axes. Missing any of these → `gaps_found`.

## Retroactive enforcement

Phases completed before this document existed (all phases up to and including 03 at the time of writing) are subject to a **discipline back-fill pass**:

- The verifier MAY re-open a phase as `gaps_found` if the diff coverage is < 90 % or if no e2e test exists.
- A back-fill is a regular gap-closure plan inside the parent phase directory (e.g. `03-11-PLAN.md` if needed), not a new phase, so the audit trail stays attached to the originating phase.
- Back-fill plans land with the same TDD + 90/90/90/90 + e2e rules as forward work.

## How phase agents pick this up

- `gsd-planner` MUST cite `.planning/DISCIPLINE.md` and PROJECT.md § Engineering Discipline in every PLAN.md preamble.
- `gsd-executor` MUST run RED → GREEN per task, not pile up code and tests at the end. Each task → one atomic commit with both code and its tests.
- `gsd-verifier` MUST refuse to mark a phase `passed` unless rule 7 is satisfied with concrete evidence (commands run, exit codes, coverage numbers, e2e test names).
- `gsd-code-reviewer` MUST flag rule 4 violations (vi.mock of internal logic) at HIGH severity.

## Why this matters

Without these rules:
- a phase claims "passed" because unit tests are green while the wire surface is broken in production (CR-01 in phase 03 — diarization route never registered, only caught because the user demanded a re-check);
- `--no-verify` becomes a habit and bypasses real safety gates;
- coverage numbers drift below the constitutional floor without anyone noticing;
- "real services in tests" gets quietly replaced by `vi.mock`;
- e2e never runs because there is no test fixture that demands the stack be up.

Each rule above is the result of an actual incident; loosening any of them re-creates the incident.
