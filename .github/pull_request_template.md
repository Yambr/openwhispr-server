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
