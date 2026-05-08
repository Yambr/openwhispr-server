---
phase: 00-repo-bootstrap-constitutional-ci
plan: 01
subsystem: workspace-foundation
tags: [pnpm, monorepo, typescript, biome, lefthook, commitlint, constitutional]
requirements: [DEVEX-01]
requirements_addressed: [DEVEX-01]
dependency_graph:
  requires: []
  provides:
    - pnpm-workspace
    - tsconfig-base
    - biome-config
    - git-hooks
    - commit-msg-enforcement
  affects:
    - all-future-plans
tech_stack:
  added:
    - pnpm@11.0.8
    - typescript@6.0.3
    - "@types/node@25.6.2"
    - "@biomejs/biome@2.4.14"
    - vitest@4.1.5
    - "@vitest/coverage-v8@4.1.5"
    - "@playwright/test@1.59.1"
    - "@stryker-mutator/core@9.6.1"
    - "@stryker-mutator/vitest-runner@9.6.1"
    - tsup@8.5.1
    - lefthook@2.1.6
    - "@commitlint/cli@21.0.0"
    - "@commitlint/config-conventional@21.0.0"
    - tsx@4.21.0
  patterns:
    - "Conventional Commits + Cyrillic-ban (DOCS-09) enforced via commitlint plugin rules"
    - "ASCII-only source: regex character classes built via new RegExp(string-with-\\u-escapes) instead of inline literal"
    - "Lefthook hooks installed transparently via pnpm prepare script"
    - "Biome 2.4.14 includes-with-negation pattern (post-2.2.0 schema): no trailing /** for folder excludes"
key_files:
  created:
    - package.json
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
    - .nvmrc
    - .tool-versions
    - tsconfig.base.json
    - biome.json
    - lefthook.yml
    - commitlint.config.cjs
  modified:
    - .gitignore
decisions:
  - "Use new RegExp() to build Cyrillic regex instead of inline literal so the source file stays ASCII-only (DOCS-09 self-consistency)."
  - "Biome 2.4.14 schema migration: files.ignore -> files.includes (negation), suspicious.noConsoleLog -> noConsole, organizeImports -> assist.actions.source.organizeImports."
  - "Set pnpm allowBuilds: { esbuild: true, lefthook: true } in pnpm-workspace.yaml so tsup/vitest and lefthook can run their postinstall binaries."
metrics:
  duration_minutes: 12
  tasks_completed: 2
  tasks_total: 2
  files_created: 9
  files_modified: 1
  commits: 3
  completed: 2026-05-08
---

# Phase 00 Plan 01: Workspace Foundation Summary

Bootstrapped the pnpm 11 monorepo with Node 24 pin, TypeScript 6 strict base config, Biome 2.4.14 lint+format, Lefthook 2.1.6 git hooks, and commitlint 21 with custom Cyrillic-ban rules (DOCS-09) sourced as ASCII-only.

## What was built

- **Workspace root** (`package.json`, `pnpm-workspace.yaml`) with `packageManager: pnpm@11.0.8`, `engines.node = "24.x"`, the full constitutional script set (`prepare`, `lint`, `lint:fix`, `format`, `lint:english`, `lint:tdd`, `typecheck`, `test`, `test:watch`, `test:e2e`, `test:contract`, `test:mutation`, `test:mutation:incremental`, `build`), and 13 devDependencies pinned to RESEARCH.md §Standard Stack versions plus `tsx` for CLI scripts.
- **Node version pinning** via `.nvmrc` (`24`) and `.tool-versions` (`nodejs 24`).
- **TypeScript base** (`tsconfig.base.json`): ES2024 target, NodeNext module resolution, `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`, `isolatedModules`, `verbatimModuleSyntax`. Every workspace `tsconfig.json` extends this.
- **Biome 2.4.14 config** (`biome.json`): pinned `$schema`, ignore list for `node_modules`, `dist`, `coverage`, `.stryker-tmp`, `reports`, `**/*.gen.ts`, `packages/i18n/locales`. Linter `recommended: true` plus `style.useImportType=error`, `style.useNodejsImportProtocol=error`, `suspicious.noConsole=warn`. `assist.actions.source.organizeImports=on` (Biome 2 replacement for `organizeImports.enabled`).
- **Lefthook config** (`lefthook.yml`): pre-commit runs `biome check --apply` on staged JS/TS/JSON + `tsx tools/lint-english.ts`; commit-msg runs `commitlint --edit {1}`. Hooks install automatically via `pnpm install` -> `prepare: lefthook install`.
- **commitlint config** (`commitlint.config.cjs`): extends `@commitlint/config-conventional`; adds two custom rules `subject-no-cyrillic` and `body-no-cyrillic` at severity 2 (error). The Cyrillic regex (`[Ѐ-ӿԀ-ԯ]`) is built via `new RegExp(string)` so the source file contains zero non-ASCII bytes (verified via `grep -P '[\x{0400}-\x{052F}]'` returning empty).
- **`.gitignore` extension**: appended `.stryker-tmp/`, `reports/`, `.turbo/` while preserving all existing entries.
- **`pnpm-lock.yaml`**: deterministic lockfile committed; `pnpm install --frozen-lockfile` succeeds on a clean tree.

## Verification

| Acceptance | Status |
|------------|--------|
| `package.json` contains `"packageManager": "pnpm@11.0.8"` | PASS |
| `package.json` engines `node: "24.x"`, `pnpm: "11.x"` | PASS |
| All 13 required script keys present | PASS |
| All 14 devDependencies pinned to RESEARCH.md versions | PASS (tsx pinned to 4.21.0 by pnpm resolver since `latest` was requested) |
| `tsconfig.base.json` has `strict`, `noUncheckedIndexedAccess`, `module: NodeNext` | PASS |
| `pnpm install --frozen-lockfile` exits 0 | PASS |
| `biome.json $schema` contains `2.4.14` | PASS |
| `biome.json` ignore list contains `packages/i18n/locales`, `**/*.gen.ts`, `.stryker-tmp` | PASS |
| `lefthook.yml` defines pre-commit (biome+lint:english) and commit-msg (commitlint) | PASS |
| `commitlint.config.cjs` extends `config-conventional` and defines both Cyrillic rules at severity 2 | PASS |
| Cyrillic regex uses ASCII-only `\u` escapes (no real Cyrillic codepoints) | PASS |
| Commitlint rejects messages with Cyrillic, accepts conventional English | PASS (verified live) |
| No Cyrillic codepoints in any of the 9 plan-touched files | PASS (verified via `grep -P '[\x{0400}-\x{052F}]'`) |
| `pnpm exec lefthook install` succeeds, hooks `commit-msg, pre-commit` registered | PASS |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Biome 2.4.14 schema migration**
- **Found during:** Task 2 verification (`biome check .`)
- **Issue:** RESEARCH.md `biome.json` uses `files.ignore`, `suspicious.noConsoleLog`, and `organizeImports.enabled`. Biome 2.2.0+ deprecated all three keys. Without migration, biome refused to load the config (exit 1) and the verify block could not run.
- **Fix:** Migrated to the 2.4.14 schema:
  - `files.ignore: [...]` -> `files.includes: ["**", "!node_modules", "!dist", ...]` (negation pattern; folder names without trailing `/**`)
  - `suspicious.noConsoleLog` -> `suspicious.noConsole`
  - `organizeImports.enabled: true` -> `assist.actions.source.organizeImports: "on"`
- **Files modified:** `biome.json`
- **Commit:** `52d9475`

**2. [Rule 1 - Bug] Source file contained literal Cyrillic codepoints**
- **Found during:** post-Task-2 self-check (Cyrillic-codepoint grep on plan-touched files)
- **Issue:** Inline regex literal `/[Ѐ-ӿԀ-ԯ]/u` written into `commitlint.config.cjs` got evaluated at the file-write layer, leaving real Cyrillic characters in the source — directly violating DOCS-09 ("English-only source artifacts") which the rule itself enforces.
- **Fix:** Build the regex via `new RegExp("[\\u0400-\\u04FF\\u0500-\\u052F]", "u")` so the source string contains only ASCII bytes (`\\`, `u`, hex digits). The constructed runtime regex matches identical codepoints; behaviour is unchanged. Verified via `grep -P '[\x{0400}-\x{052F}]'` returning zero matches and via live commitlint test rejecting a Cyrillic subject.
- **Files modified:** `commitlint.config.cjs`
- **Commit:** `aca2a32`

**3. [Rule 3 - Blocking] pnpm 11 build approval gate**
- **Found during:** first `pnpm install` (Task 1)
- **Issue:** pnpm 11 ships `dangerouslyAllowedBuildScripts` disabled by default; `esbuild` (required by `tsup`/`vitest`) and `lefthook` (postinstall installs the platform binary and registers git hooks) were ignored, leaving the workspace half-installed.
- **Fix:** Added `allowBuilds: { esbuild: true, lefthook: true }` to `pnpm-workspace.yaml`. Re-ran `pnpm install` — both postinstalls executed, hooks installed.
- **Files modified:** `pnpm-workspace.yaml`
- **Commit:** `3a46d27`

## Authentication gates

None.

## Known Stubs

None — config-only plan, no production code stubs.

## Threat Flags

None — config layer adds no new network, auth, file-access, or schema surface.

## Deferred Items (out-of-scope discoveries)

Logged to `.planning/phases/00-repo-bootstrap-constitutional-ci/deferred-items.md`:

- `speaches-audio.md` (root-level reference document committed in `9f2de60 Initial commit`) contains Russian prose. Will trip `tools/lint-english.ts` once Plan 03 wires the pre-commit hook into developer workflow. Resolution options: move under `tests/fixtures/i18n/`, translate, or extend the lint-english IGNORE list. Not modified here per plan-scope rule ("Do NOT modify files outside `files_modified`").

- Other Wave 1 plans (00-02 placeholder modules, 00-03 lint-english script, 00-04+ CI) are being executed in parallel by sibling executors and have produced files in `apps/`, `packages/`, `tools/`, `tests/`. `pnpm biome check .` reports formatting/lint issues in those files; they belong to those plans' verifiers, not 00-01.

## Commits

| Commit | Type | Subject |
|--------|------|---------|
| `3a46d27` | feat | scaffold pnpm workspace root with TS strict base |
| `52d9475` | feat | add Biome 2.4.14, Lefthook, commitlint with Cyrillic ban |
| `aca2a32` | fix  | build Cyrillic regex from ASCII-only `\u` escapes |

## Self-Check: PASSED

All 9 plan-touched files exist on disk and their additive content is reachable from HEAD. All three commit hashes resolve via `git log`. Cyrillic-codepoint grep returns zero matches across the plan-modified file set. `pnpm install --frozen-lockfile`, `pnpm exec lefthook install`, `pnpm exec commitlint --version`, and `pnpm exec tsc --version` all exit 0. The Cyrillic-ban rule was verified live: a UTF-8-encoded Russian "feat: ..." subject was rejected by commitlint with the expected `subject-no-cyrillic` diagnostic; an English Conventional Commits subject passed.
