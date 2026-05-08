# ADR-0003: English-only source artifacts (DOCS-09 enforcement)

**Status:** accepted

**Date:** 2026-05-08

**Phase:** 0 — Repo Bootstrap & Constitutional CI

## Context

The project's constitutional rule DOCS-09 requires all source artifacts (code, comments, identifiers, log keys, commit messages, documentation) to be in English. The runtime is bilingual (en + ru minimum from day one — I18N-01) but that is a separate concern: locale resource files are explicitly allowlisted.

The user instruction layer (`~/.claude/CLAUDE.md`) is in Russian. That layer is OUTSIDE the source-artifact scope and the lint scope is the repo working tree only.

We need a mechanism that:

- Catches Cyrillic in any committed file outside the locale allowlist
- Catches Cyrillic in commit messages
- Provides `file:line:col` diagnostics
- Runs in pre-commit hook AND in CI

## Decision

A **standalone Node TypeScript script** `tools/lint-english.ts` scans for Cyrillic codepoints (Unicode blocks U+0400-U+04FF basic + U+0500-U+052F supplement) in all source artifacts. It scans patterns `**/*.{ts,tsx,js,jsx,json,md,mdx,yaml,yml,cjs,mjs}` excluding `node_modules/**`, `dist/**`, `coverage/**`, `.stryker-tmp/**`, `reports/**`, `.git/**`, `pnpm-lock.yaml`, `packages/i18n/locales/**`, `tests/fixtures/i18n/**`, and `speaches-audio.md` (corp LiteLLM reference doc).

Commit-message scope is enforced inline in `commitlint.config.cjs` via custom rules `subject-no-cyrillic` + `body-no-cyrillic` (no `commitlint-plugin-no-cyrillic` published package exists as of 2026-05-08).

The script's correctness is verified by `tools/lint-english.test.ts` and the `cyrillic-injection` self-test in `tests/self-tests/`.

## Consequences

- **Easier:** mechanical enforcement on every commit (Lefthook) and every PR (`lint-english` CI job); the rule is ASCII-stable and self-tested; Phase 10 docs work cannot accidentally introduce Cyrillic.
- **Harder:** contributors who paste Cyrillic-containing examples (e.g. for i18n discussions) into the wrong file will have their commit rejected — they must use `tests/fixtures/i18n/` or `packages/i18n/locales/<locale>/` for legitimate cases.
- **Risk:** false positives on third-party package names appearing in `pnpm-lock.yaml` — addressed by including the lockfile in the IGNORE list.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| **Biome 2 GritQL plugin** with a Cyrillic-codepoint regex | Biome does not lint `.md`/`.yaml` by default; the Biome 2.3.9+ regression (#8522) where `linter.enabled: false` in overrides is ignored by GritQL plugins makes the i18n allowlist fragile; weaker `file:line:col` UX. |
| **Manual code review** | Discipline degrades on schedule; not constitutional. |
| **CI-only check (no pre-commit)** | Wastes a CI cycle and forces a force-push workflow for every miss; pre-commit is fast (< 1s). |

## References

- `.planning/phases/00-repo-bootstrap-constitutional-ci/00-CONTEXT.md` Decisions D-18, D-19
- `.planning/phases/00-repo-bootstrap-constitutional-ci/00-RESEARCH.md` Pattern 3 (English-only enforcement); Pitfall 5 (English-only files outside Biome); Open Questions Q1
- `.planning/REQUIREMENTS.md` DOCS-09
- `tools/lint-english.ts`, `tools/lint-english.test.ts`, `tests/self-tests/cyrillic-injection.test.ts`
