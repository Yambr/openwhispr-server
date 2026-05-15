## What

<one-liner>

## Why

<motivation>

## Tests First Checklist (TDD-01)

- [ ] I wrote failing tests for the new behavior BEFORE writing the implementation
- [ ] All new logic has unit tests
- [ ] All HTTP/wire-surface changes have contract tests (CONTRACT-01)
- [ ] Coverage gate passes (>= 85% lines / >= 80% branches) — see CI summary
- [ ] Mutation score did not regress on touched modules — see Stryker job

## Source Artifacts (DOCS-09)

- [ ] No Cyrillic in any committed file outside `packages/i18n/locales/ru/**`
- [ ] No Cyrillic in commit messages
- [ ] All identifiers, comments, log keys are English

## Risk

- [ ] Considered backwards compatibility
- [ ] Considered security impact (auth, RLS, secrets, deps)
- [ ] Considered i18n impact (en + ru bundles in sync)

## QA Discipline (Phase 21 lockers)

If this PR touches any `.feature` file, `playwright.config.ts`, or
`tests/e2e-cjm/steps/*.steps.ts`, ALL of the following must be true:

- [ ] RED commit precedes GREEN commit (`git log --oneline -3` shows it)
- [ ] No `.skip` / `.only` / `@skip` / `@focus` tags in any `.feature` file
- [ ] Every new `@cjm-N.M` tag has a matching `### @cjm-N.M` anchor in `docs/customer-journeys.md`
- [ ] Every new `*.steps.ts` ships with a sibling `__tests__/<name>.steps.test.ts` that mocks the HTTP boundary
- [ ] `playwright.config.ts` `retries: 0` preserved (D-12)
- [ ] Every happy-path scenario has at least one negative twin in the same `.feature` file
- [ ] Every `@expected-red` is paired with `@after-phase-N[.M]` or `@after-docker-up`

If this PR is labelled `[test-fix]` (a CJM/test stabilization-only change):

- [ ] No production source files modified (no `apps/*/src/`, `packages/*/src/`, `compose/**`, `Makefile`)
- [ ] OR the PR also carries the `[scope-expansion]` label with rationale in the body

If a strict-coverage package (apps/api, apps/web, apps/worker, packages/data,
packages/byok-guard, packages/email, packages/litellm-client) was touched:

- [ ] Per-file coverage on every modified file is ≥ 90/90/90/90 (lines/branches/functions/statements)
