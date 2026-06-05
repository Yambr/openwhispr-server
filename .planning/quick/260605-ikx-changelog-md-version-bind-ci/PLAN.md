---
slug: changelog-md-version-bind-ci
quick_id: 260605-ikx
date: 2026-06-05
type: quick
strict_tdd: true
files_modified:
  - CHANGELOG.md
  - tools/changelog-extract.ts
  - tools/changelog-extract.test.ts
  - tools/lint-changelog.ts
  - tools/lint-changelog.test.ts
  - package.json
  - .github/workflows/release.yml
---

<objective>
Create a repo-root CHANGELOG.md (Keep-a-Changelog 1.1.0 + SemVer) covering app
tags v1.2.3 → v1.0.14 (newest first), and bind release versions to it in CI so a
tag without a matching changelog section FAILS the release. Ship two tsx tools
(extractor + lint), each with RED-first vitest coverage ≥ 90%, and wire the lint
into the repo lint surface.

Purpose: every shipped release now carries human-authored "What's changed" notes
derived from real commits, and the bind makes a missing entry a hard release error.
Output: CHANGELOG.md, tools/changelog-extract.ts, tools/lint-changelog.ts (+ tests),
release.yml injection, package.json scripts.
</objective>

<context>
Quick task — docs + CI bind. No version bump, no release. Land on main; owner
triggers "релизь" separately.

Source-of-truth for changelog entries (DERIVE, do not invent):
- `/tmp/changelog-source.txt` — release-commit subject+body per tag (already extracted)
- `git log -1 <tag>` for any gap; tag date = `git log -1 --format=%ci <tag>` (date part only)
- `.planning/STATE.md` §"Quick Tasks Completed" (line 101) for cross-reference

Tag set (confirmed via `git tag`): v1.0.14 … v1.2.3 (24 tags total; changelog
covers v1.0.14 → v1.2.3 per spec — 14 released sections + Unreleased).
Dates confirmed: v1.0.14 = 2026-05-28, v1.2.3 = 2026-06-05.

GENERIC-NAMING owner constraint: NO concrete corp model names/namespaces in
changelog text. The release commit messages are already generic — mirror their
wording (e.g. "operator gateway embedding model", "managed-Postgres deploy compat").

Chart appVersion source for the lint parity check:
`charts/openwhispr-server/Chart.yaml` → `appVersion: "1.2.3"` (currently 1.2.3).

@.github/workflows/release.yml   (Build Release body step — lines 303-349; inject before "## Container images")

<interfaces>
<!-- Established tools-CLI convention (from tools/lint-no-hardcode.ts + tools/lint-no-dockerhub-pg-image.ts).
     Match it exactly — no codebase exploration needed. -->

Each tool TS file:
- Shebang line 1: `#!/usr/bin/env -S pnpm exec tsx`
- Line 2: `// SPDX-License-Identifier: FSL-1.1-ALv2`
- JSDoc block describing purpose, args, exit codes.
- Exports pure helper fn(s) + `export async function main(argv: string[]): Promise<number>`
  (returns the exit code; NEVER calls process.exit inside main — testable).
- Entrypoint guard at bottom only:
    const arg1 = process.argv[1] ?? "";
    if (arg1.endsWith("changelog-extract.ts")) {
      main(process.argv.slice(2)).then((code) => process.exit(code), (err) => { console.error(err); process.exit(2); });
    }
- LOCKER-01: reads file-path/version args ONLY. No process.env reads/branches anywhere.
- LOCKER-02: no `as any` / `as unknown as` / `@ts-ignore` / `@ts-nocheck`.

Test convention (from tools/lint-no-hardcode.test.ts):
- SPDX header line 1, JSDoc, `import { main, <helpers> } from "./<tool>.js"` (".js" extension).
- Use mkdtempSync(tmpdir()) for fixtures; rmSync in afterEach.
- Assert on the numeric return of `await main([...])` (0 pass / 1 fail / 2 internal error).
- vitest run with --coverage.include=<tool>.ts, thresholds 90/90/90/90.

package.json per-tool test script pattern (line 35 etc):
  "test:<name>": "vitest run tools/<name>.test.ts --coverage --coverage.include=tools/<name>.ts --coverage.exclude= --coverage.all=false --coverage.thresholds.lines=90 --coverage.thresholds.branches=90 --coverage.thresholds.functions=90 --coverage.thresholds.statements=90"

lint:* script pattern (line 34): "lint:<name>": "tsx tools/<name>.ts <args>"
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: changelog-extract tool (RED → GREEN, atomic)</name>
  <files>tools/changelog-extract.ts, tools/changelog-extract.test.ts, package.json</files>
  <behavior>
    main([changelogPath, version]) prints to stdout the lines BETWEEN the
    `## [VERSION]` header (exclusive) and the next `## [` header (exclusive),
    trimmed of leading/trailing blank lines; returns 0.
    - Test RED: given a fixture CHANGELOG with `## [1.2.3] - 2026-06-05` followed
      by an Added block then `## [1.2.2]`, extracting "1.2.3" prints ONLY the
      1.2.3 body (Added/Changed/Fixed lines), not the 1.2.2 body, not the header.
    - Test: extracting a middle version stops at the next `## [`.
    - Test: extracting the OLDEST version stops at the link-reference footer
      (first `[x.y.z]:` line — treat a line starting with `[` + version + `]:`
      OR a line not part of body; simplest: stop at next `## [` OR EOF).
    - Test (missing section): version "9.9.9" not present → main returns NON-ZERO
      (use 1) and writes to stderr exactly:
      "CHANGELOG.md has no section for 9.9.9 — add it before tagging".
    - Test (bad args): fewer than 2 argv → returns 2.
  </behavior>
  <action>
    Write tools/changelog-extract.test.ts FIRST (RED) using the established tmpdir
    fixture pattern, importing { main } from "./changelog-extract.js". Then write
    tools/changelog-extract.ts: read file via node:fs readFileSync(changelogPath),
    split lines, locate `## [${version}]` (match header line that starts with
    "## [" + version + "]"), collect until the next line starting with "## [",
    trim blank edges, console.log the joined body. On missing header, console.error
    the exact required message (interpolating the version arg, NOT the literal
    "VERSION") and return 1. Args validated: need argv.length >= 2 else return 2.
    No process.env. Add package.json scripts: "test:changelog-extract" (coverage
    90/90/90/90 pattern) and a convenience "changelog:extract":
    "tsx tools/changelog-extract.ts". Commit RED test + GREEN impl in ONE commit.
  </action>
  <verify>
    <automated>pnpm test:changelog-extract</automated>
  </verify>
  <done>Coverage ≥90% all axes on changelog-extract.ts; missing-section case returns 1 with the exact stderr message; tests + impl in one atomic commit.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: lint-changelog tool (RED → GREEN, atomic)</name>
  <files>tools/lint-changelog.ts, tools/lint-changelog.test.ts, package.json</files>
  <behavior>
    main([changelogPath, chartYamlPath]) returns 0 when CHANGELOG is well-formed
    AND its TOP released section version == Chart.yaml appVersion; returns 1 otherwise.
    Validations (each its own RED test):
    - PASS: valid file (has `## [Unreleased]`, ≥1 `## [X.Y.Z] - YYYY-MM-DD`
      released section with SemVer + ISO date, a `[x.y.z]:` footer link line for
      every released version, top section == appVersion) → 0.
    - FAIL missing-Unreleased: no `## [Unreleased]` → 1.
    - FAIL no-released-section: only Unreleased → 1.
    - FAIL bad-header: a released header not matching `## [SemVer] - YYYY-MM-DD` → 1.
    - FAIL footer-gap: a released version with no matching `[ver]:` footer link → 1.
    - FAIL parity: top released version (e.g. 1.2.2) != appVersion (1.2.3) → 1,
      stderr names both versions.
    Parse appVersion from Chart.yaml by line-regex `^appVersion:\s*"?([0-9.]+)"?`
    (no yaml dep needed; file-path arg only).
  </behavior>
  <action>
    Write tools/lint-changelog.test.ts FIRST (RED): tmpdir fixtures for each PASS/FAIL
    case, plus a minimal Chart.yaml stub holding `appVersion: "X.Y.Z"`. Import
    { main } from "./lint-changelog.js". Then write tools/lint-changelog.ts following
    the lint-no-hardcode CLI shape: export helper(s) (e.g. parseReleasedVersions,
    parseAppVersion) + main(argv). Read both files via node:fs; run validations,
    collect failures, print a per-failure summary to stderr, return 1 if any.
    No process.env, no type-suppression. Add package.json scripts:
    "test:lint-changelog" (90/90/90/90 coverage pattern) and
    "lint:changelog": "tsx tools/lint-changelog.ts CHANGELOG.md charts/openwhispr-server/Chart.yaml".
    NOTE: lint-changelog.ts is committed in THIS task but CHANGELOG.md does not yet
    exist — the test exercises tmpdir fixtures only, so the suite is green
    independently of the real CHANGELOG. Commit RED + GREEN in ONE commit.
  </action>
  <verify>
    <automated>pnpm test:lint-changelog</automated>
  </verify>
  <done>Coverage ≥90% all axes on lint-changelog.ts; all six PASS/FAIL cases assert correct exit code; parity-mismatch stderr names both versions; one atomic commit.</done>
</task>

<task type="auto">
  <name>Task 3: Author CHANGELOG.md from real commits (v1.2.3 → v1.0.14)</name>
  <files>CHANGELOG.md</files>
  <action>
    Write repo-root CHANGELOG.md in Keep-a-Changelog 1.1.0 format, English-only:
    - Header: title + the standard "format is based on Keep a Changelog / adheres
      to Semantic Versioning" preamble lines with links.
    - `## [Unreleased]` section first (empty subsections or a brief "_Nothing yet._").
    - One `## [X.Y.Z] - YYYY-MM-DD` per tag, NEWEST FIRST, from 1.2.3 down to 1.0.14
      (14 released sections). Dates from `git log -1 --format=%ci <tag>` (date part).
    - DERIVE entries from /tmp/changelog-source.txt + `git log -1 <tag>` ONLY — do
      not invent. Group under Added / Changed / Fixed / Security as the commit
      content dictates (e.g. 1.2.3: Added /api/embeddings + /api/rerank passthrough
      + features.embeddings/rerank flags, web download links; 1.2.0: Added
      server-configurable disable-local-login + GET /api/auth/providers
      localLogin.enabled, Changed/Fixed the #5/#7/#10 batch; 1.0.19: Fixed
      diarization Speaches Authorization passthrough; etc.).
    - GENERIC-NAMING: no concrete corp model names/namespaces — mirror the generic
      wording already in the commit messages.
    - Link-reference footer at the very bottom:
        [Unreleased]: https://github.com/Yambr/openwhispr-server/compare/v1.2.3...HEAD
        [1.2.3]: https://github.com/Yambr/openwhispr-server/compare/v1.2.2...v1.2.3
        … one compare line per adjacent pair down to …
        [1.0.15]: https://github.com/Yambr/openwhispr-server/compare/v1.0.14...v1.0.15
        [1.0.14]: https://github.com/Yambr/openwhispr-server/releases/tag/v1.0.14
    Each released section MUST have a matching footer link (lint-changelog enforces).
    Top released section MUST be 1.2.3 to match Chart.yaml appVersion 1.2.3.
    Commit CHANGELOG.md alone (atomic).
  </action>
  <verify>
    <automated>pnpm lint:changelog && tsx tools/changelog-extract.ts CHANGELOG.md 1.2.3</automated>
  </verify>
  <done>lint:changelog returns 0 (well-formed + top==appVersion 1.2.3); extractor prints the 1.2.3 body; 14 released sections present newest-first with footer links; English-only; no corp model names.</done>
</task>

<task type="auto">
  <name>Task 4: Bind release.yml body to CHANGELOG (inject "What's changed")</name>
  <files>.github/workflows/release.yml</files>
  <action>
    In the "Build Release body" step (lines 303-349), BEFORE the `cat > body.md`
    heredoc, add a shell line that extracts the matching section:
      changelog_section=$(tsx tools/changelog-extract.ts CHANGELOG.md "${VERSION}")
    Because changelog-extract exits NON-ZERO when the section is missing, run it
    WITHOUT `|| true` and with the step's default fail-fast so a tag lacking a
    CHANGELOG entry FAILS the release (enforces the bind). Then inject a
    "## What's changed" block holding ${changelog_section} into body.md positioned
    immediately BEFORE the "## Container images" heading. Use a heredoc-safe
    approach (capture to a var, reference inside the existing `cat <<EOF`). Keep
    the existing pull-commands + links untouched. tsx is available via the repo
    toolchain on the runner; if the step lacks node/pnpm setup, add the existing
    actions/setup-node + `corepack enable` + `pnpm install --frozen-lockfile`
    preamble used elsewhere in this workflow (check earlier jobs) OR call
    `pnpm exec tsx` if pnpm is already provisioned in this job — prefer the
    minimal addition that makes `tsx tools/changelog-extract.ts` resolvable.
    Do NOT change the tag-strip logic or VERSION output. Commit release.yml alone.
  </action>
  <verify>
    <automated>tsx tools/changelog-extract.ts CHANGELOG.md 1.2.3 >/dev/null && grep -q "What's changed" .github/workflows/release.yml && grep -q "changelog-extract.ts CHANGELOG.md" .github/workflows/release.yml</automated>
  </verify>
  <done>release.yml calls changelog-extract before body.md build, injects a "## What's changed" block before "## Container images", and fails the step on a missing section (no `|| true`); extractor resolves on the runner toolchain.</done>
</task>

<task type="auto">
  <name>Task 5: Wire lint:changelog into the lint surface + verify full bind</name>
  <files>package.json</files>
  <action>
    Register lint:changelog into the repo lint aggregate the cheap way: the
    lockers aggregate (line 44 "lint:lockers") chains discipline lockers and is
    not the right home for a docs lint. Instead append lint:changelog to whatever
    general lint umbrella CI runs — CHECK package.json for an existing umbrella
    (e.g. a "lint:all" or a CI step that fans out lint:*). If a clean umbrella
    exists and adding one `&& pnpm lint:changelog` is trivial, do it. If NOT
    (no single umbrella, or wiring would reorder/complicate the chain), leave
    lint:changelog as the standalone script added in Task 2 and add a one-line
    note to the release runbook / this PLAN's done-criteria that CI should call
    `pnpm lint:changelog`. Do NOT force a non-trivial wiring. Then run the full
    bind sanity: both tool suites green, lint:changelog green against the real
    CHANGELOG.md, extractor prints 1.2.3, and a deliberately-wrong version exits
    non-zero. Commit package.json (if changed) alone.
  </action>
  <verify>
    <automated>pnpm test:changelog-extract && pnpm test:lint-changelog && pnpm lint:changelog && tsx tools/changelog-extract.ts CHANGELOG.md 1.2.3 >/dev/null && ! tsx tools/changelog-extract.ts CHANGELOG.md 9.9.9 2>/dev/null</automated>
  </verify>
  <done>Both tool suites pass ≥90% coverage; lint:changelog passes on the real CHANGELOG; missing-version extraction exits non-zero; lint:changelog reachable from CI (umbrella or documented standalone).</done>
</task>

</tasks>

<verification>
- `pnpm test:changelog-extract` and `pnpm test:lint-changelog` both green, ≥90/90/90/90.
- `pnpm lint:changelog` exits 0 against repo-root CHANGELOG.md (well-formed + top section == Chart.yaml appVersion 1.2.3).
- `tsx tools/changelog-extract.ts CHANGELOG.md 1.2.3` prints the 1.2.3 body; `… 9.9.9` exits non-zero with the exact gate message.
- release.yml "Build Release body" injects "## What's changed" before "## Container images" and fails on a missing section.
- New tools/ TS: no process.env reads (LOCKER-01), no type-suppression (LOCKER-02), SPDX header present.
- CHANGELOG.md English-only, no corp model names, entries derived from real commits.
</verification>

<success_criteria>
- CHANGELOG.md at repo root: KaC 1.1.0, Unreleased + 14 released sections (1.2.3→1.0.14) newest-first, footer compare links, top==appVersion.
- tools/changelog-extract.ts + tools/lint-changelog.ts shipped with RED-first vitest tests ≥90% coverage, each tool+tests in one atomic commit.
- release.yml binds version→changelog (missing section = release failure).
- lint:changelog wired (umbrella or documented standalone).
- No version bump, no release. Constraints honored: strict TDD atomic commits, English-only, no type-suppression, LOCKER-01 clean, commitlint ≤100 char header/body, hooks pass (no --no-verify).
</success_criteria>

<output>
After completion, create `.planning/quick/260605-ikx-changelog-md-version-bind-ci/SUMMARY.md`.
</output>
