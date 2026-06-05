---
slug: changelog-md-version-bind-ci
quick_id: 260605-ikx
date: 2026-06-05
type: quick
status: complete
released: false
---

# Quick 260605-ikx: CHANGELOG.md + version→changelog release bind — Summary

Authored a repo-root `CHANGELOG.md` (Keep a Changelog 1.1.0 + SemVer) and shipped
two RED-first tsx tools (`changelog-extract` + `lint-changelog`, each 100% coverage)
that bind release versions to it: a tag without a matching CHANGELOG section now
FAILS the release, and CI lints the CHANGELOG shape + appVersion parity on every PR.
Docs + CI only — no version bump, no tag, no release.

## Commits (atomic, all on main, all hooks green)

| Task | SHA | Type | What it did |
|------|-----|------|-------------|
| 1 | `427f6b71` | feat(tools) | `changelog-extract.ts` + RED-first test (9 tests, 100/100/100/100) + package.json scripts. Prints the `## [version]` body; exit 1 + exact gate message on a missing section; exit 2 on bad args. |
| 2 | `6b537951` | feat(tools) | `lint-changelog.ts` + RED-first test (12 tests, 100/100/100/100) + package.json scripts. Validates Unreleased + >=1 well-formed released section + footer link per version + top==appVersion parity. |
| 3 | `74105a6c` | docs(changelog) | Authored `CHANGELOG.md`: Unreleased + 12 released sections (one per real app tag v1.0.14->v1.2.3), newest-first, footer compare links, generic wording, English-only. |
| 4 | `910e6fd7` | ci(release) | `release.yml`: node/pnpm setup + extract section via `changelog-extract.ts` (no `|| true` -> missing entry fails the release) + inject `## What's changed` before `## Container images`. |
| 5 | `07c84cd0` | ci(lint) | `ci.yml`: wired `lint:changelog` + `test:changelog-extract` + `test:lint-changelog` into the lint fan-out. |

## Verification evidence (observed first-hand)

- `pnpm test:changelog-extract` -> 9 passed; coverage 100% stmts / 100% branches / 100% funcs / 100% lines.
- `pnpm test:lint-changelog` -> 12 passed; coverage 100/100/100/100.
- `pnpm lint:changelog` -> exit 0 against the real `CHANGELOG.md` (well-formed + top section 1.2.3 == Chart.yaml appVersion 1.2.3).
- `tsx tools/changelog-extract.ts CHANGELOG.md 1.2.3` -> prints the 1.2.3 Added body, exit 0.
- `tsx tools/changelog-extract.ts CHANGELOG.md 1.0.14` (oldest) -> prints the body, correctly STOPS at the footer link lines.
- `tsx tools/changelog-extract.ts CHANGELOG.md 9.9.9` -> stderr `CHANGELOG.md has no section for 9.9.9 — add it before tagging`, exit 1.
- `tsx tools/changelog-extract.ts CHANGELOG.md` (1 arg) -> usage on stderr, exit 2.
- `release.yml` + `ci.yml` -> `python3 yaml.safe_load` parse OK; `## What's changed` (line 336) precedes `## Container images` (line 340) in release.yml.
- LOCKER-01: `grep process.env` in the two tools -> matches only in JSDoc comments, no runtime reads. LOCKER-02: no `as any` / `as unknown as` / `@ts-ignore` / `@ts-nocheck`. SPDX header present on all four source/test files. biome + lefthook (gitleaks/english/commitlint) green on every commit.

## Deviations from Plan

**1. [Rule 1 — corrected spec count] 12 released sections, not 14.**
- Found during: Task 3.
- Issue: The PLAN context said "14 released sections (1.2.3 -> 1.0.14)". `git tag` confirms exactly 12 app tags in that range: v1.0.14, .15, .16, .17, .18, .19, .20, v1.1.0, v1.2.0, .1, .2, .3. The "+2" were chart-only versions (chart 1.0.21/1.0.22/1.0.23) mentioned inside release commit bodies but never created as app release tags.
- Fix: Authored one section per REAL app tag (the source of truth), 12 released sections. A 14-section file would have had 2 orphan sections with no tag and would fail the bind.
- Files: `CHANGELOG.md`. Commit: `74105a6c`.

**2. [Rule 3 — wiring location] Task 5 wired into `ci.yml`, not `package.json`.**
- Found during: Task 5.
- Issue: Task 5 said "commit package.json (if changed)". No package.json change was needed — the `lint:changelog` / `test:*` scripts were already added with the tools in Tasks 1-2. There is no `lint:all` umbrella (`"lint"` is just `biome check .`); CI fans out discrete `pnpm lint:*` steps.
- Fix: Added `lint:changelog` + the two test suites to the discrete lint fan-out in `.github/workflows/ci.yml` (the proper CI reachability surface, exactly as the PLAN fallback clause anticipated). No package.json change in Task 5.
- Files: `.github/workflows/ci.yml`. Commit: `07c84cd0`.

**3. [Rule 3 — runner toolchain] Added node/pnpm setup to the release job.**
- Found during: Task 4.
- Issue: The `create-image-release` job had only `actions/checkout` — no JS toolchain, so `tsx` would not resolve.
- Fix: Added the canonical `pnpm/action-setup@v4` + `actions/setup-node@v4` (node 24.x, pnpm cache) + `pnpm install --frozen-lockfile` preamble, mirroring the established CI pattern.
- Files: `.github/workflows/release.yml`. Commit: `910e6fd7`.

## Constraints honored

Strict RED->GREEN TDD with test+impl in the same atomic commit; English-only; no
type-suppression (LOCKER-02); no `process.env` in tools (LOCKER-01); SPDX header on
every new file; commitlint <=100-char headers/body; hooks never bypassed (no
`--no-verify`); generic naming in CHANGELOG (no concrete model names); no version
bump, no tag, no release.

## Self-Check: PASSED

- Files exist: `CHANGELOG.md`, `tools/changelog-extract.ts`, `tools/changelog-extract.test.ts`, `tools/lint-changelog.ts`, `tools/lint-changelog.test.ts` — all present.
- Commits on HEAD: `427f6b71`, `6b537951`, `74105a6c`, `910e6fd7`, `07c84cd0` — all confirmed via `git log`.
