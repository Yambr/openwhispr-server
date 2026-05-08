# ADR-0002: Vitest 4 for tests + coverage; Stryker 9 for mutation testing

**Status:** accepted

**Date:** 2026-05-08

**Phase:** 0 — Repo Bootstrap & Constitutional CI

## Context

We need a test framework that:

- Runs TypeScript natively without a build step
- Provides built-in v8 coverage with threshold enforcement
- Integrates with mutation testing (Stryker) for the constitutional TEST-MUTATION-01 rule
- Aligns with the future frontend stack (Next.js + Vite-friendly tools)

We also need mutation testing wired from PR #1 against placeholder targets so the harness is provably-working before real auth/multi-tenancy code arrives in Phase 2+.

## Decision

- **Vitest 4.1.5** as the unit + integration test runner. Coverage via `@vitest/coverage-v8`.
- **Stryker 9.6.1** as the mutation testing tool, using `@stryker-mutator/vitest-runner` to share the Vitest config.
- Coverage thresholds enforced in `vitest.config.ts` under `coverage.thresholds.{lines,branches,functions,statements}` (Vitest 4 nested schema — NOT the deprecated flat schema from v2).
- Stryker break threshold set to `50` in Phase 0 (placeholder modules trivially exceed it); raised to `80` in Phase 2 once real auth/multi-tenancy code lands.
- Mutation testing runs incrementally on every PR (`--since origin/<base>`), and full nightly via `nightly.yml`.

## Consequences

- **Easier:** one runner config across unit, integration, and mutation testing; coverage gate is a CI-default failure mode; placeholder workspace modules give Stryker real targets from PR #1 (so the harness's first real test is "does it run?", not "do we have a mutation tool?").
- **Harder:** Vitest 4 nested threshold keys are a known silent-breakage trap (RESEARCH Pitfall 1) — addressed by the `coverage-floor` self-test that asserts threshold violations actually fail CI.
- **Risk:** Stryker incremental cache can become stale across config bumps (RESEARCH Pitfall 4); cache key in `ci.yml` includes `pnpm-lock.yaml`, `vitest.config.ts`, `stryker.config.json` hashes; nightly full run catches drift.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| **Jest + ts-jest + @stryker-mutator/jest-runner** | Heavier startup; weaker native ESM/TS story; ts-jest has been a maintenance burden in 2024-2026. |
| **node:test + c8 + Stryker** | Native Node test runner is improving but lacks the watch-mode UX, coverage-summary reporter, and Stryker integration polish that Vitest has today. |
| **uvu + Stryker** | Smaller and faster but lacks coverage tooling integration. |

## References

- `.planning/phases/00-repo-bootstrap-constitutional-ci/00-CONTEXT.md` Decisions D-07, D-11, D-12
- `.planning/phases/00-repo-bootstrap-constitutional-ci/00-RESEARCH.md` Standard Stack §Vitest, §Stryker; Pitfall 1 (Vitest 4 threshold migration); Pitfall 4 (Stryker incremental cache)
- https://vitest.dev/config/coverage
- https://stryker-mutator.io/docs/stryker-js/vitest-runner/
- ADR-0001 (workspace structure that Stryker mutates)
