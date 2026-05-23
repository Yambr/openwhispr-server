---
slug: commitlint-dependabot-relax
created: 2026-05-23
completed: 2026-05-23
status: complete
---

# Summary — relax commitlint body-max-line-length + subject-case for Dependabot

## What

Dependabot-generated PRs failed the `commitlint` CI step because
`@commitlint/config-conventional` enforces:

- `body-max-line-length: 100` — Dependabot bodies embed advisory URLs,
  release-note paragraphs, and dependency-tree dumps that legitimately
  exceed 100 chars per line.
- `subject-case: lower-case-only` — group-update subjects like
  "Bump the actions-minor-and-patch group with 4 updates" trip the
  rule because "Bump" is capitalized at the start of the description.

Both rules block every Dependabot PR (14 open today) without adding
project safety. The actual project contract (DOCS-09, NO Cyrillic in
commit messages) is enforced by our custom rules and remains strict.

## Fix

Set `body-max-line-length` and `subject-case` to `0` (disabled) in
`commitlint.config.cjs`. Verified:

- Dependabot-style subject + 400-char body: exit 0
- Cyrillic body: still rejected (DOCS-09 intact)

## Files

- `commitlint.config.cjs` — +10 lines

## Commit

`<set after commit>`
