---
slug: lint-locker01-config-glob
created: 2026-05-23
completed: 2026-05-23
status: complete
---

# Summary — extend LOCKER-01 boundary glob to `**/config.ts`

## What

The LOCKER-01 NODE_ENV-branch lint was failing on CI (`lint-english` step, composite of `make lint:lockers`) because `packages/litellm-client/src/config.ts:205` carries a legitimate boundary read (`env.NODE_ENV === "production"` for the HI-3 https veto), but the boundary glob set covered only `**/config/*.ts` (files INSIDE a `config/` directory), missing files literally NAMED `config.ts` at the package root.

## How (TDD)

1. **RED** — Added case `F3e` to `tools/lint-no-env-branches.test.ts` synthesising a temp `packages/litellm-client/src/config.ts` containing `env.NODE_ENV === 'production'` and asserting `findViolations()` returns `[]`. Confirmed failing on current glob.
2. **GREEN** — Added one entry `"**/config.ts"` to `BOUNDARY_GLOBS` in `tools/lint-no-env-branches.ts`. All 19 tests pass; `pnpm lint:no-env-branches` exits 0; `make lint:lockers` chain exits 0.

## Files changed

- `tools/lint-no-env-branches.ts` — +1 entry in `BOUNDARY_GLOBS`
- `tools/lint-no-env-branches.test.ts` — +1 new test case `F3e`

## Verification

- `pnpm vitest run tools/lint-no-env-branches.test.ts` → 19/19 pass
- `pnpm lint:no-env-branches` → clean (exit 0)
- `make lint:lockers` → exit 0 (all 7 lockers)

## Commit

To be set after `git commit`.

## Follow-up

Push and confirm CI `lint-english` step turns green on the resulting `main` run.
