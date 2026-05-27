---
quick_id: 260527-pj6
slug: pre-push-test-evidence-gate
title: "Pre-push test evidence gate — hard linter, no bypass (v1.0.12)"
date: 2026-05-27
status: planned
mode: quick-full
revision: 2
findings_closed: [discipline-test-gate]
upstream:
  - .planning/quick/260527-pj6-pre-push-test-evidence-gate/CONTEXT.md
  - .planning/quick/260527-pj6-pre-push-test-evidence-gate/RESEARCH.md
  - .planning/quick/260527-pj6-pre-push-test-evidence-gate/PLAN-CHECK.md
constitutional_anchors:
  - CLAUDE.md hard-rule 4 (no --no-verify) — extended symmetrically to test-evidence gate
  - DISCIPLINE "test coverage ≥ 90/90/90/90" — gate REFUSES push on any non-PASS evidence
  - feedback_cjm_steps_need_unit_tests — same anti-pattern this gate eliminates
locked_decisions:
  - D1: Custom Vitest Reporter class (path-string default-export form, ROOT-level registration + per-workspace explicit append)
  - D2: Per-workspace fragments `.test-evidence/<sha>-<project>.json` + read-time aggregator validator
  - D3: `// SKIP-REASON: <≥10 chars>` annotation allowlist (BLOCKING after codemod normalises 54 sites)
  - D4: lefthook command-level `use_stdin: true` + `node:readline` stdin parser
release_artifacts:
  chart_version: 1.0.14 → 1.0.15
  appVersion: 1.0.11 → 1.0.12
---

# PLAN — Pre-push test-evidence gate (no `--no-verify` bypass)

## 1 — Goal (one sentence)

After this lands, `git push` to origin is REFUSED for any pushed commit SHA without `.test-evidence/<sha>-<project>.json` fragments covering all **22** canonical vitest projects, OR with any fragment whose `exit_code !== 0` or `state !== "passed"`, OR with any un-annotated `.skip` / `.todo` site (each must carry `// SKIP-REASON: <≥10 chars>` within 5 lines above the call); CI environments (`GITHUB_ACTIONS=true` or `CI=true`) bypass with a stderr log line because CI re-runs the same validator against the GitHub event-SHA range as the redundant L3 layer.

## 2 — Scope

### 2.1 In scope

1. **`tools/vitest-evidence-reporter.ts`** — new Vitest 4.1.5 Reporter class:
   - `export default class VitestEvidenceReporter implements Reporter` (path-string registration requires default export per R8.1).
   - Implements `onInit(vitest)` (capture `vitest.config.watch` for watch-mode bail) and `onTestRunEnd(testModules, unhandledErrors, reason)` (CONTEXT D1, RESEARCH R1.2).
   - Iterates `testModules` via per-module `mod.children.allTests()` generator (RESEARCH R1.3); per `TestCase` reads `testCase.result()`, branching on `state ∈ {"passed", "failed", "skipped", "pending"}` + `testCase.options.mode ∈ {"skip", "todo"}`.
   - For each skipped / todo test, opens `mod.moduleId` (file path) once per module (memoised), and scans the file for `// SKIP-REASON: <text>` comments within 5 lines above the `.skip(` / `.todo(` source position. Records `unannotated_skip` count + the file:line list. Source-position derivation: read `testCase.location?.line` (RESEARCH R1.3 ReportedTaskImplementation); fall back to `testCase.task?.location?.line` if absent (RESEARCH gotcha #7).
   - Resolves project name via `firstCase.project.name` per-module (RESEARCH R1.4 pattern). Groups modules by project name into a `Map<string, TestModule[]>` and writes ONE fragment per project name.
   - Fragment shape (atomically written):
     ```json
     {
       "schema": 1,
       "generated_at": "<ISO8601 UTC>",
       "project": "<project name>",
       "commit_sha": "<40-hex SHA from git rev-parse HEAD or OPENWHISPR_TEST_EVIDENCE_SHA env>",
       "branch": "<git symbolic-ref --short HEAD, optional>",
       "reason": "passed | failed | interrupted",
       "exit_code": 0,
       "total": <N>, "pass": <N>, "fail": <N>, "skip": <N>, "todo": <N>,
       "unannotated_skip": <N>,
       "failures": [{ "file": "<rel path>", "name": "<fullName>", "error_message_truncated": "<≤1000 chars per LOCKER-05>" }],
       "skips": [{ "file": "<rel path>", "line": <N>, "name": "<fullName>", "mode": "skip|todo", "annotated": <bool>, "skip_reason": "<text or null>" }]
     }
     ```
   - Atomic write: `mkdirSync('<evidence-dir>', { recursive: true, mode: 0o700 })` → canonicalise via `fs.realpathSync` → `fs.lstatSync(finalPath)` REFUSE if symlink (RESEARCH R5.2) → `fs.writeFileSync('<final>.tmp.<pid>', JSON.stringify(...), { mode: 0o600, flag: 'wx' })` → `fs.renameSync('<final>.tmp.<pid>', '<final>')` (POSIX rename atomicity).
   - Reads `OPENWHISPR_TEST_EVIDENCE_DIR` (default `<repoRoot>/.test-evidence` resolved via `git rev-parse --show-toplevel`) and `OPENWHISPR_TEST_EVIDENCE_SHA` (default `git rev-parse HEAD`) — both env overrides honoured per CONTEXT D1 for hermetic tests.
   - **Bail-out branches** (each unit-tested):
     - `vitest.config.watch === true` → log `[evidence] skipping write (watch mode)` and return (RESEARCH R8.4).
     - `git rev-parse HEAD` fails (fresh repo, no commits) → log warning + return.
     - `reason === "interrupted"` → return (no write — matches `tools/global-vitest-teardown.ts` SIGINT posture).
     - `testModules.length === 0` → return (nothing to record).
   - All stderr / log output English-only (constitutional rule).

2. **`tools/lint-pre-push-test-evidence.ts`** — pre-push hook validator script:
   - Header per RESEARCH R7.1 template; CLI entrypoint per R7.2 (`process.argv[1].endsWith("lint-pre-push-test-evidence.ts")` guard).
   - **CI bypass FIRST**: if `process.env.GITHUB_ACTIONS === "true"` OR `process.env.CI === "true"` → log `[ci] skipping evidence gate (CI runs validator directly)` to stderr + exit 0. Stderr log emitted regardless to surface the bypass (RESEARCH R6 anti-abuse).
   - Reads stdin via `readline.createInterface({ input: process.stdin })` (RESEARCH R2.4); for each line splits on single space into `[localRef, localSha, remoteRef, remoteSha]` per Git pre-push format (RESEARCH R3.1).
   - Per-line edge handling (RESEARCH R3.2 / R3.3):
     - `localRef === "(delete)" || localSha === "0000000000000000000000000000000000000000"` → DELETION → skip line (no commits to validate).
     - `remoteSha === "0000000000000000000000000000000000000000"` → NEW REF → range `git rev-list ${localSha} --not --remotes`.
     - else → range `git rev-list ${remoteSha}..${localSha}`. **Force-push (reverse-range / `--force-with-lease`) where `localSha` does NOT contain `remoteSha` as ancestor**: still enumerate via `git rev-list ${remoteSha}..${localSha}` (Git's standard behaviour returns the commits unique to `localSha`); evidence required for every enumerated SHA. **Force-push deletion semantics** (`localSha === "0".repeat(40)`) handled by the deletion branch above.
   - SHA shape validation: every SHA from stdin OR `rev-list` must match `/^[0-9a-f]{40}$/` (RESEARCH R5.3; the repo is SHA1 per `git rev-parse --show-object-format` = sha1). Reject + exit 1 on malformed.
   - For each commit SHA in the enumerated range:
     1. Glob `.test-evidence/<sha>-*.json` (resolve evidence dir via `git rev-parse --show-toplevel` + `/.test-evidence`; canonicalise with `fs.realpathSync` to defeat symlink redirection per R5.2).
     2. Load `tools/test-evidence-projects-manifest.json` (the 22-project canonical list — see scope item 3).
     3. Per-fragment safety: `fs.lstatSync(path).isSymbolicLink()` → REFUSE; `fs.readFileSync(...)` → `JSON.parse` in `try/catch` → REFUSE on malformed JSON with `❌ Malformed evidence at <path>`.
     4. Assert fragment-set covers manifest: `Set(found) ⊇ Set(manifest)`. Missing → exit 1 with `❌ No test evidence for commit <sha>. Missing projects: [<comma list>]. Run pnpm test:all (or pnpm test:evidence) to regenerate.`
     5. For each loaded fragment: REFUSE if `exit_code !== 0`, `fail > 0`, `reason !== "passed"`, OR `unannotated_skip > 0`. Group all per-project violations into a single readable summary block before exit 1.
   - All-clean per ref: continue to next stdin line.
   - All refs clean: stderr line `✅ <total_passed>/<total_total> PASS, <total_skip> annotated SKIP across 22 projects on <N> commit(s). Push allowed.` + exit 0.
   - **Path safety** (RESEARCH R5.2 + gotcha #9): every resolved fragment path MUST start with `<canonical-evidence-dir>/` (no `..` traversal); `lstatSync` precedes every read.

3. **`tools/test-evidence-projects-manifest.json`** — generated canonical 22-project list (RESEARCH R1.5):
   - Shape: `{ "schema": 1, "projects": ["api", "web", "worker", "@openwhispr/byok-guard", "@openwhispr/contract-tests", "data", "@openwhispr/email", "@openwhispr/litellm-client", "load-test", "test-probe", "mock-litellm", "<e2e name>", "<mock-realtime name>", "@openwhispr/auth-stub", "@openwhispr/i18n-stub", "@openwhispr/observability", "@openwhispr/wire-schemas", "tools", "tests-e2e-cjm-steps", "tests-e2e-cjm-support", "tests-integration", "tests-self-tests"] }`.
   - **Wave 0 first sub-task** of Task 2 (Wave 0 below) materialises the 12 `[ASSUMED]` rows in RESEARCH R1.5 by running the verified grep:
     ```sh
     grep -rE '^\s+name:\s+["\x27]' \
       apps/*/vitest.config.ts packages/*/vitest.config.ts \
       tools/load-test/vitest.config.ts tools/test-probe/vitest.config.ts \
       compose/mock-litellm/vitest.config.ts \
       tests/e2e/vitest.config.ts tests/e2e/mock-realtime/vitest.config.ts
     ```
     and baking the live result into the manifest file. The 10 inline-root-config names are already `[VERIFIED]` in RESEARCH R1.5.

4. **`tools/test-evidence-projects-manifest.test.ts`** — parity self-test (CONTEXT D2 implication; RESEARCH R7.6):
   - Mirror style of `tools/chart-api-env-parity.test.ts`.
   - At test time: walk `vitest.config.ts:projects[]` via `ts-morph` (cheap, no vitest programmatic API needed) PLUS read each per-workspace `vitest.config.ts` from the union of paths listed in scope item 3's grep. Extract the live `test.name` string from each `defineConfig` / `defineProject` call.
   - Assert `new Set(manifest.projects)` === `new Set(liveProjectNames)`. Test fails on either addition or removal of a project without manifest update.

5. **`tools/lint-skip-annotations.ts`** — `// SKIP-REASON:` enforcement lint (CONTEXT D3):
   - Header / CLI entrypoint per RESEARCH R7.1 + R7.2 templates.
   - Comment-aware scan (RESEARCH gotcha #8 + R4.3 false-positive on `apps/api/tests/support/shared-pg.ts:21`): tokenise via `ts-morph` SourceFile AST. For each `CallExpression` whose callee text matches `/^(it|test|describe|xit|xdescribe)\.(skip|todo)$/`:
     - Compute the line number (`call.getStartLineNumber()`).
     - Look at the 5 lines IMMEDIATELY ABOVE in the same SourceFile.
     - If any of those 5 lines (after trimming leading whitespace) matches `/^\/\/\s*SKIP-REASON:\s+(.{10,})$/` → ALLOWED.
     - Else → record violation `{ file, line, callee }`.
   - Scope globs:
     ```
     apps/**/*.{ts,tsx}
     packages/**/*.{ts,tsx}
     tests/e2e-cjm/**/*.{ts,tsx}
     tests/integration/**/*.ts
     ```
     Exclusions: `node_modules`, `dist`, `.next`, `.stryker-tmp`, `.claude/worktrees`, `tools/lint-skip-annotations.ts` and its `.test.ts` (self-exempt to avoid recursion on fixtures).
   - Exit 0 on zero violations, exit 1 with one-line-per-violation `<file>:<line> — <callee> missing // SKIP-REASON: <≥10 chars> within 5 lines above`.

6. **Root + per-workspace `vitest.config.ts` reporter registration (Wave 1 MANDATORY — addresses B1 BLOCKER):**

   `mergeConfig` REPLACES (not merges) the `reporters[]` array across workspaces. Two workspaces TODAY override `reporters:` and will silently drop the evidence reporter unless explicitly amended. The plan promotes this to a Wave 1 mandatory step — fixing the gap at config-time, not discovery-time.

   - **`vitest.config.ts`** (root): `reporters: ["default", "./tools/vitest-evidence-reporter.ts"]` (RESEARCH R1.6, path-string default-export form).
   - **`packages/contract-tests/vitest.config.ts:25`** (today: `reporters: ["dot"]`): replace with explicit array containing the evidence reporter. Use module-import pattern from root config (`dirname(fileURLToPath(import.meta.url))` to resolve `<repo-root>/tools/vitest-evidence-reporter.ts` absolutely) so the relative path does not re-anchor under the child workspace dir. Final form: `reporters: ["dot", resolve(ROOT_DIR, "tools/vitest-evidence-reporter.ts")]`.
   - **`tests/e2e/vitest.config.ts:25`** (today: `reporters: ["verbose"]`): same pattern. Final form: `reporters: ["verbose", resolve(ROOT_DIR, "tools/vitest-evidence-reporter.ts")]`.

7. **`tools/lint-vitest-reporter-inheritance.ts`** — NEW linter (B1 BLOCKER fix, defence-in-depth):
   - Walks ALL `vitest.config.ts` files across workspaces via `fast-glob`. Globs: `vitest.config.ts` (root), `apps/*/vitest.config.ts`, `packages/*/vitest.config.ts`, `tools/*/vitest.config.ts`, `compose/*/vitest.config.ts`, `tests/*/vitest.config.ts`, `tests/e2e/*/vitest.config.ts`.
   - Parses each file via `ts-morph`. For each `defineConfig` / `defineProject` / `mergeConfig` call expression, locate `test.reporters` property assignment.
   - Three accepted shapes:
     - **Absent** (`reporters` not specified) → workspace inherits root config → PASS (root config carries the reporter).
     - **Array form** (`reporters: ["dot", "<path>"]`) → assert array contains at least one element whose string value matches `/tools\/vitest-evidence-reporter\.ts$/` (allows both relative `./tools/...` from root and absolute resolved-path forms from child workspaces).
     - **Spread form** (`reporters: [...someVar, "<path>"]`) or computed-variable form → REFUSE with `<file>:<line> — cannot statically verify reporters[] contains evidence reporter, refactor to explicit string array`.
   - String-only form (`reporters: "default"`) is REFUSED with `<file>:<line> — string-form reporters cannot include evidence reporter, refactor to explicit array`.
   - Exit 0 on all-pass; exit 1 with one-line-per-violation `<file>:<line> — <reason>`.
   - Wired to **lefthook pre-commit** `commands.vitest-reporter-inheritance` (catches future drift at commit-time, not push-time).

8. **`tools/lint-vitest-reporter-inheritance.test.ts`** — TDD pair for scope item 7 (~10 F-cases):
   - F1: All configs have evidence reporter in `reporters:` → exit 0.
   - F2: One workspace missing reporter in `reporters:` array → exit 1 with `<file>:<line>` referencing the workspace.
   - F3: Workspace omits `reporters:` entirely (inherits from root) → exit 0 (inheritance accepted).
   - F4: Root config missing reporter → exit 1 (root cannot inherit; must register explicitly).
   - F5: String-form `reporters: "default"` → exit 1 with `string-form reporters cannot include evidence reporter, refactor to explicit array`.
   - F6: Spread form `reporters: [...someVar, "<path>"]` → exit 1 with `cannot statically verify, refactor to explicit array`.
   - F7: Computed-variable form `reporters: reportersList` → exit 1 with same message.
   - F8: Relative path `./tools/vitest-evidence-reporter.ts` from root config → accepted.
   - F9: Absolute resolved-path form `resolve(ROOT_DIR, "tools/vitest-evidence-reporter.ts")` from child workspace → accepted (regex matches the literal string post-resolve OR matches the call-expression body containing the literal segment).
   - F10: Multiple `defineProject` blocks within one root config (inline projects) → each independently validated; partial coverage → exit 1 naming the failing inline project.

9. **`lefthook.yml` — `pre-commit.commands.vitest-reporter-inheritance`** + **`pre-push.commands.test-evidence`** (CONTEXT D4, RESEARCH R7.5):
   ```yaml
   pre-commit:
     parallel: true
     commands:
       # ... existing lockers + gitleaks ...
       # Quick 260527-pj6 / B1 — catch reporter inheritance drift at commit time.
       vitest-reporter-inheritance:
         glob: "vitest.config.ts"
         run: pnpm exec tsx tools/lint-vitest-reporter-inheritance.ts
         fail_text: |
           Vitest evidence reporter missing from one or more workspace vitest.config.ts.
           Each workspace's `reporters:` array MUST include the evidence reporter,
           OR the workspace MUST omit `reporters:` entirely (to inherit from root).
           See docs/test-evidence-gate.md §11.6 for the inheritance contract.

   pre-push:
     parallel: true
     commands:
       # ... existing gitleaks + web-test ...
       # Quick 260527-pj6 / D-4 — L2 test-evidence gate.
       # use_stdin: true is REQUIRED — lefthook 2.1.8 uses a pseudo-TTY by
       # default and never closes the child's stdin (lefthook docs
       # `configuration/use_stdin/`); missing the flag deadlocks every `git push`.
       # Only ONE pre-push command can consume stdin (lefthook hard-limit);
       # gitleaks + web-test do not read stdin, so test-evidence is the sole
       # consumer. Regression-locked in tools/lint-lefthook-stdin-config.test.ts.
       test-evidence:
         use_stdin: true
         run: pnpm exec tsx tools/lint-pre-push-test-evidence.ts
         fail_text: |
           Pre-push test-evidence gate REFUSED.
           See docs/test-evidence-gate.md for recovery steps.
           --no-verify is constitutionally banned (CLAUDE.md hard-rule 4 — same posture as gitleaks).
   ```

10. **`tools/lint-lefthook-stdin-config.test.ts`** — YAML-shape regression test (CONTEXT D4, RESEARCH R7.5):
    - Reads `lefthook.yml` via `yaml` package (already a transitive dep of lefthook tooling; verify and add explicit `yaml` devDep if missing).
    - Asserts:
      - `parsed['pre-push'].commands['test-evidence'].use_stdin === true`.
      - `parsed['pre-push'].commands['test-evidence'].run` matches `/lint-pre-push-test-evidence\.ts/`.
      - There is at most ONE command anywhere under `pre-push.commands` with `use_stdin: true` (enforces RESEARCH R2.3 #2 single-consumer invariant).
      - `parsed['pre-commit'].commands['vitest-reporter-inheritance'].run` matches `/lint-vitest-reporter-inheritance\.ts/` (B1 BLOCKER fix lock).
    - Style mirrors `tools/lockers-allowlist-diff.test.ts`.

11. **`package.json` root scripts** (RESEARCH R7.4 pattern):
    ```jsonc
    "test:all": "pnpm -r test",
    "test:evidence": "pnpm -r test",
    "test:evidence:check": "git rev-parse HEAD | xargs -I{} bash -c 'printf \"refs/heads/HEAD %s refs/heads/HEAD 0000000000000000000000000000000000000000\\n\" {}' | tsx tools/lint-pre-push-test-evidence.ts",
    "test:evidence:projects-self-test": "tsx tools/test-evidence-projects-self-test.ts",
    "lint:skip-annotations": "tsx tools/lint-skip-annotations.ts",
    "lint:pre-push-test-evidence": "tsx tools/lint-pre-push-test-evidence.ts",
    "lint:vitest-reporter-inheritance": "tsx tools/lint-vitest-reporter-inheritance.ts",
    "test:lint-skip-annotations": "vitest run tools/lint-skip-annotations.test.ts --coverage --coverage.include=tools/lint-skip-annotations.ts --coverage.exclude= --coverage.all=false --coverage.thresholds.lines=90 --coverage.thresholds.branches=90 --coverage.thresholds.functions=90 --coverage.thresholds.statements=90",
    "test:lint-pre-push-test-evidence": "vitest run tools/lint-pre-push-test-evidence.test.ts --coverage --coverage.include=tools/lint-pre-push-test-evidence.ts --coverage.exclude= --coverage.all=false --coverage.thresholds.lines=90 --coverage.thresholds.branches=90 --coverage.thresholds.functions=90 --coverage.thresholds.statements=90",
    "test:lint-vitest-reporter-inheritance": "vitest run tools/lint-vitest-reporter-inheritance.test.ts --coverage --coverage.include=tools/lint-vitest-reporter-inheritance.ts --coverage.exclude= --coverage.all=false --coverage.thresholds.lines=90 --coverage.thresholds.branches=90 --coverage.thresholds.functions=90 --coverage.thresholds.statements=90",
    "test:codemod-skip-annotations": "vitest run tools/codemod-skip-annotations.test.ts --coverage --coverage.include=tools/codemod-skip-annotations.ts --coverage.exclude= --coverage.all=false --coverage.thresholds.lines=90 --coverage.thresholds.branches=90 --coverage.thresholds.functions=90 --coverage.thresholds.statements=90",
    "test:vitest-evidence-reporter": "vitest run tools/vitest-evidence-reporter.test.ts --coverage --coverage.include=tools/vitest-evidence-reporter.ts --coverage.exclude= --coverage.all=false --coverage.thresholds.lines=90 --coverage.thresholds.branches=90 --coverage.thresholds.functions=90 --coverage.thresholds.statements=90"
    ```
    `test:evidence:check` synthesises a synthetic pre-push stdin line for HEAD (treating it as a new-ref push with all-zero remote — forces validator to enumerate the full local-only range) so developers can manually re-validate without an actual `git push`. `test:evidence:projects-self-test` runs the scripted self-test (scope item 14) before atomic commit.

12. **`.gitignore`** — append under a new `# Test evidence (local-only ephemeral, Quick 260527-pj6)` block:
    ```
    # Test evidence (local-only ephemeral, Quick 260527-pj6)
    .test-evidence/
    ```
    Confirmed missing today (RESEARCH R4.4 + R5.1).

13. **Codemod one-shot — `tools/codemod-skip-annotations.ts`** (CONTEXT D3 migration):
    - Author this tool as the migration helper. Scans the same glob as the lint (scope item 5). For each unannotated `.skip` / `.todo` call site identified by the same `ts-morph` walker, inserts the line `// SKIP-REASON: pre-260527-pj6 — original reason unknown, audit required` immediately above the call expression (preserving indentation, no trailing whitespace).
    - Single-shot tool — invoked exactly once during execution. NOT registered in `package.json` scripts as a direct invocation to discourage accidental re-runs (the `test:codemod-skip-annotations` script runs the TEST, not the codemod itself).
    - Output: list of touched files printed to stdout; an audit manifest written to `.planning/quick/260527-pj6-pre-push-test-evidence-gate/SKIP-AUDIT-BACKLOG.md` with one row per insertion. **Required audit-manifest format** (one row per insertion):
      ```
      | file path | line number | current placeholder | suggested investigation steps |
      |---|---|---|---|
      | apps/api/tests/foo.test.ts | 42 | pre-260527-pj6 — original reason unknown, audit required | (a) `git blame` the `.skip(` line to find original PR; (b) read PR description for skip rationale; (c) classify per SKIP-REASON taxonomy (requires-docker / topology-gated / setup-complete / deferred-fix); (d) replace placeholder with real reason |
      ```
    - **Test coverage**: `tools/codemod-skip-annotations.test.ts` against fixture trees. Coverage ≥ 90/90/90/90 (constitutional floor; enforced by `test:codemod-skip-annotations` script in scope item 11).

14. **`tools/test-evidence-projects-self-test.ts`** — NEW scripted self-test (W5 mitigation, R10 strengthening):
    - Replaces the previously-prose "Wave 3 self-test" with an actively scripted artefact. Wave 4 atomic commit can only proceed after this exits 0.
    - Logic:
      1. Spawn `pnpm test:all` via `spawnSync('pnpm', ['test:all'], { stdio: 'inherit', shell: false })`. Capture exit code.
      2. After completion, resolve `EVIDENCE_DIR = OPENWHISPR_TEST_EVIDENCE_DIR || <repoRoot>/.test-evidence`, `HEAD_SHA = git rev-parse HEAD`.
      3. Glob `${EVIDENCE_DIR}/${HEAD_SHA}-*.json` and extract the project-name suffix from each filename.
      4. Load `tools/test-evidence-projects-manifest.json` (the 22-project canonical list).
      5. Compute `delta = Set(manifest.projects) − Set(foundProjects)`.
      6. If `delta.size > 0` → exit 1 with structured stderr listing:
         - Each missing project name
         - The expected per-workspace `vitest.config.ts` path
         - The diagnostic: "this workspace's `reporters:` array does not include the evidence reporter; run `pnpm lint:vitest-reporter-inheritance` to identify the file:line"
      7. If `pnpm test:all` exited non-zero AND `delta.size === 0` → exit 1 with "tests failed but evidence written; inspect individual fragments via `cat .test-evidence/${HEAD_SHA}-*.json`".
      8. If both pass → exit 0 with `✅ 22/22 projects emitted evidence for ${HEAD_SHA}`.
    - **Mandatory pre-commit step for Wave 4** (executor MUST run `pnpm test:evidence:projects-self-test` and confirm exit 0 BEFORE `git commit`). NOT wired into pre-push lefthook (would deadlock the gate it's validating).

15. **Unit tests** (TDD discipline — test FIRST, then impl):
    - `tools/vitest-evidence-reporter.test.ts`:
      - F1: `onTestRunEnd` with 3 passing modules, 1 failing module, 1 skipped (annotated) test → fragment shape matches spec; `pass=3, fail=1, skip=1, unannotated_skip=0`.
      - F2: Skipped test WITHOUT `// SKIP-REASON: ...` in the test fixture file → `unannotated_skip > 0` + `skips[i].annotated === false`.
      - F3: Watch mode (`onInit` with `vitest.config.watch === true`) → `onTestRunEnd` writes NOTHING (assert evidence dir empty).
      - F4: Fresh repo (mock `git rev-parse HEAD` to throw `ENOENT`) → warns + no fragment.
      - F5: `reason === "interrupted"` → no fragment written.
      - F6: Atomic write via tmp+rename — assert `<final>.tmp.*` does NOT exist after success (renamed).
      - F7: Symlink TOCTOU defence — pre-create `.test-evidence/<sha>-api.json` as symlink to `/tmp/attacker-target` → reporter REFUSES + exits non-zero.
      - F8: Fragment file mode `0o600` confirmed via `fs.statSync(path).mode & 0o777`.
      - F9: `OPENWHISPR_TEST_EVIDENCE_DIR` + `OPENWHISPR_TEST_EVIDENCE_SHA` env overrides honoured (tmpdir target).
      - F10: Project grouping — 2 modules under project `api`, 1 module under project `data` → exactly 2 fragments written (`<sha>-api.json` + `<sha>-data.json`).
    - `tools/lint-pre-push-test-evidence.test.ts`:
      - F1: Missing evidence (no fragments at all for SHA) → exit 1 with `Missing projects: [<all 22>]`.
      - F2: Partial evidence (21 of 22 projects covered) → exit 1 with `Missing projects: [<the missing 1>]`.
      - F3: All 22 projects clean (`exit_code=0, fail=0, unannotated_skip=0`) → exit 0 with `✅ ...Push allowed.`
      - F4: One fragment has `exit_code !== 0` → exit 1 with grouped failure summary.
      - F5: One fragment has `fail > 0` → exit 1.
      - F6: One fragment has `unannotated_skip > 0` → exit 1 referencing project name.
      - F7: Malformed JSON in fragment → exit 1 with `❌ Malformed evidence at <path>`.
      - F8: Symlink fragment → exit 1 with path-safety error.
      - F9: `process.env.GITHUB_ACTIONS = "true"` → exit 0 + stderr `[ci] skipping evidence gate`.
      - F10: `process.env.CI = "true"` (other CI providers) → exit 0 + stderr.
      - F11: Multi-ref push (4 stdin lines, mixed branches + tag) → validates each.
      - F12: Deletion push (`localSha = "0".repeat(40)`) → skipped per-line; exit 0 if no other refs.
      - F13: Tag push pointing at commit already on a previously-validated branch → `git rev-list --not --remotes` returns empty → exit 0.
      - F14: New-branch push (`remoteSha = "0".repeat(40)`) → enumerates `git rev-list <localSha> --not --remotes` and validates each commit.
      - F15: Malformed SHA from stdin (e.g., `"GGGGGG..."`) → exit 1 with `malformed SHA from pre-push stdin`.
      - F16: Path-traversal attempt (`.test-evidence/../etc/passwd`) — canonicalise + reject; covered by F8 in practice but add explicit fixture.
      - F17: **Force-push reverse-range (`--force-with-lease`)** where `localSha` does NOT contain `remoteSha` as ancestor → `git rev-list ${remoteSha}..${localSha}` enumerates the unique-to-localSha commits → validator requires evidence for each enumerated SHA → exit 1 if any missing, exit 0 if all clean. Fixture creates a divergent-history tmp repo with `git reset --hard` rewrite.
      - F18: **Force-push deletion semantics** (`localSha === "0".repeat(40)`) → identical to F12 (deletion no-op rule).
    - `tools/lint-skip-annotations.test.ts`:
      - F1: Annotated `.skip` (marker on the line immediately above) → no violation.
      - F2: Annotated `.skip` (marker 5 lines above — boundary) → no violation.
      - F3: Annotated `.skip` (marker 6 lines above — outside window) → violation.
      - F4: Un-annotated `.skip` → violation `<file>:<line> — describe.skip missing ...`.
      - F5: `// SKIP-REASON: tooshort` (< 10 chars after the colon-space) → violation.
      - F6: `.todo` site annotated → no violation.
      - F7: `.todo` site un-annotated → violation (parity with `.skip` per CONTEXT D3 open-question #1).
      - F8: Comment containing `describe.skip` (e.g., `apps/api/tests/support/shared-pg.ts:21` shape — `// describe.skip from beforeAll`) → AST walker does NOT match (RESEARCH gotcha #8).
      - F9: `xit(` / `xdescribe(` → treated identically to `.skip`.
    - `tools/lint-vitest-reporter-inheritance.test.ts`: per scope item 8 above (F1–F10).
    - `tools/test-evidence-projects-manifest.test.ts`: per RESEARCH R7.6 — assert manifest === live names.
    - `tools/lint-lefthook-stdin-config.test.ts`: scope item 10 above.
    - `tools/codemod-skip-annotations.test.ts`: fixture-tree codemod F1 (un-annotated input → annotated output) + F2 (already-annotated input → no-op) + F3 (audit-manifest written to expected path with the 4-column row format).

16. **Documentation — `docs/test-evidence-gate.md`** (new operator runbook):
    - **Sections**:
      1. **What the gate does** — 3-layer parity table mirroring gitleaks: L1 reporter on `pnpm test`, L2 pre-push validator, L3 deferred CI redundant check.
      2. **Normal developer flow** — `pnpm test:all` → fragments written → `git push` → gate validates → push allowed.
      3. **Why `--no-verify` is banned** — quote CLAUDE.md hard-rule 4 + cite gitleaks parity precedent.
      4. **Recovery scenarios**: (a) "Missing project X" → run `pnpm test:all` (not filtered); (b) "Stale evidence" — re-run after rebase; (c) "Unannotated skip in <project>" → add `// SKIP-REASON: <reason>` line above; (d) malformed JSON → delete `.test-evidence/` and re-run.
      5. **CI bypass mechanism** — `CI=1` / `GITHUB_ACTIONS=true`; document audit log emitted on bypass.
      6. **SKIP-REASON taxonomy** — copy verbatim from RESEARCH R4.4 (requires-docker / topology-gated / setup-complete / deferred-fix).
      7. **Codemod placeholder cleanup** — point at `SKIP-AUDIT-BACKLOG.md` and explain "each placeholder must be audited and replaced with the real reason in a follow-up".
      8. **Workspace reporter inheritance contract** — explain the three accepted shapes (absent → inherit; explicit array containing evidence reporter; spread/computed → refused). Cross-link to `tools/lint-vitest-reporter-inheritance.ts`.
    - **NEVER** suggest `--no-verify` as a recovery path.

17. **`CLAUDE.md` hard-rule 4 extension** (CONTEXT code-level §1.5 + RESEARCH planner sequencing hint #12):
    - Amend existing hard-rule 4 paragraph to explicitly include the new pre-push test-evidence gate alongside gitleaks. Add one sentence: "Likewise for the test-evidence pre-push gate (Quick 260527-pj6): `git push --no-verify` on any commit whose `.test-evidence/<sha>-*.json` fragments are missing, failed, or contain unannotated skips is constitutionally prohibited; the fix is to run `pnpm test:all` and address the underlying failure, never to bypass the hook."
    - Add a new entry under the LOCKER/WARN-→BLOCKING ledger section noting the gate's BLOCKING-from-day-one posture (no warn-only flag, no allowlist).

18. **`.planning/deferred-items.md`** — append cross-reference entry (W1 fix):
    - Add ~10-line entry after the existing deferred-items list:
      ```markdown
      ### SKIP-REASON audit backlog (54 sites) — quick-260527-pj6 codemod

      The Quick 260527-pj6 codemod inserts 54 placeholder annotations of shape
      `// SKIP-REASON: pre-260527-pj6 — original reason unknown, audit required`
      to satisfy the SKIP-REASON lint at gate landing. Each placeholder is a
      tracked TODO with `<file>:<line>` precise location, enumerated in
      `.planning/quick/260527-pj6-pre-push-test-evidence-gate/SKIP-AUDIT-BACKLOG.md`.

      Follow-up Quick: audit each site (git blame the .skip call, read original PR
      rationale, classify per RESEARCH R4.4 taxonomy: requires-docker /
      topology-gated / setup-complete / deferred-fix), replace placeholder with
      real reason, drop the row from SKIP-AUDIT-BACKLOG.md.

      WHY: codemod normalised the lint gate at landing time without losing the
      audit trail. Real reasons require domain context the codemod can't infer.
      ```

19. **Chart bump** — `charts/openwhispr-server/Chart.yaml`:
    - `version: 1.0.14` → `1.0.15`.
    - `appVersion: "1.0.11"` → `"1.0.12"`.
    - Pure workflow/tooling release — no runtime templates change; the bump expresses the chart's pin to the new gate-enforced commit baseline.
    - Update `charts/openwhispr-server/values.yaml` lineage comment block (the `# Chart version can diverge from image version (chart shipping ...)` block at line 19) with a `1.0.15 — pre-push test-evidence gate + SKIP-REASON allowlist (quick 260527-pj6)` entry.

### 2.2 NOT in scope

- Modifying existing test scripts beyond appending the reporter (additive only — reporter wraps `default` at root, appended to explicit arrays at child workspaces).
- Fixing flaky tests — gate enforces, flakies remain a separate concern (any flaky surfaced by the Wave 4 self-test verification commit MUST be either annotated as `// SKIP-REASON: flaky issue-<TODO>` with a tracked follow-up OR genuinely fixed in this commit; no third option).
- Runtime code changes (Better Auth, security, schema, route handlers).
- Backfilling SKIP-REASON to real reasons — codemod inserts a placeholder string, `SKIP-AUDIT-BACKLOG.md` tracks each for follow-up.
- CI L3 redundant validator job in `.github/workflows/ci.yml` — out-of-scope per CONTEXT "Out-of-scope (deferred)"; see Task 14 of RESEARCH planner sequencing hints.
- Playwright e2e fragment integration — out-of-scope per CONTEXT.
- Cross-machine evidence sharing / retention TTL — out-of-scope per CONTEXT.
- Removing the existing `pre-push.commands.web-test` — keep one release cycle for defence-in-depth, deprecate in a follow-up (RESEARCH gotcha #18).

## 3 — Files modified

| Path | Nature | LOC est | Wave |
|---|---|---|---|
| `tools/vitest-evidence-reporter.ts` | NEW | ~280 | 1 |
| `tools/vitest-evidence-reporter.test.ts` | NEW | ~360 (10 F-cases) | 1 |
| `tools/lint-pre-push-test-evidence.ts` | NEW | ~330 (force-push F17/F18 added) | 2 |
| `tools/lint-pre-push-test-evidence.test.ts` | NEW | ~580 (18 F-cases incl. force-push reverse-range) | 2 |
| `tools/lint-skip-annotations.ts` | NEW | ~170 (ts-morph AST walker) | 0 |
| `tools/lint-skip-annotations.test.ts` | NEW | ~260 (9 F-cases) | 0 |
| `tools/lint-vitest-reporter-inheritance.ts` | NEW (B1 BLOCKER fix) | ~180 (ts-morph workspace walker) | 1 |
| `tools/lint-vitest-reporter-inheritance.test.ts` | NEW (B1 BLOCKER fix) | ~280 (10 F-cases) | 1 |
| `tools/test-evidence-projects-self-test.ts` | NEW (W5 mitigation) | ~120 (scripted self-test) | 3 |
| `tools/test-evidence-projects-manifest.json` | NEW | ~30 | 0 |
| `tools/test-evidence-projects-manifest.test.ts` | NEW | ~120 (parity vs ts-morph walk) | 0 |
| `tools/codemod-skip-annotations.ts` | NEW (one-shot) | ~200 | 1 |
| `tools/codemod-skip-annotations.test.ts` | NEW | ~140 (3 F-cases) | 1 |
| `tools/lint-lefthook-stdin-config.test.ts` | NEW | ~110 (added pre-commit assertion) | 3 |
| `vitest.config.ts` (root) | EDIT | +1 line in `reporters:` array | 1 |
| `packages/contract-tests/vitest.config.ts` | EDIT (B1 BLOCKER fix) | +1 line in `reporters:` array (append evidence reporter) | 1 |
| `tests/e2e/vitest.config.ts` | EDIT (B1 BLOCKER fix) | +1 line in `reporters:` array (append evidence reporter) | 1 |
| `lefthook.yml` | EDIT | +18 lines (pre-commit vitest-reporter-inheritance + pre-push test-evidence) | 3 |
| `.gitignore` | EDIT | +2 lines | 0 |
| `package.json` | EDIT | +10 scripts (incl. codemod test + reporter-inheritance lint + projects-self-test) | 0 |
| `charts/openwhispr-server/Chart.yaml` | EDIT | 2 lines (version, appVersion) | 4 |
| `charts/openwhispr-server/values.yaml` | EDIT | +1 lineage comment line | 4 |
| `docs/test-evidence-gate.md` | NEW | ~170 (+1 workspace-inheritance section) | 4 |
| `CLAUDE.md` | EDIT | +1 paragraph in hard-rule 4 + 1 ledger entry | 4 |
| `.planning/deferred-items.md` | EDIT (W1 fix) | +10 lines (SKIP-REASON audit backlog cross-reference) | 4 |
| `.planning/quick/260527-pj6-pre-push-test-evidence-gate/SKIP-AUDIT-BACKLOG.md` | NEW (codemod-generated) | ~80 (54 rows in 4-column format + header) | 1 |
| Codemod-touched call sites across `apps/**`, `packages/**`, `tests/**` | EDIT (1 line above each `.skip`/`.todo`) | 54 placeholder comments | 1 |

**Total**: 13 new TS/JSON files + 1 new MD + 1 new audit-backlog MD + 9 edits + 54 in-place codemod insertions.

## 4 — Implementation order (Wave 0 → Wave 4)

Strict TDD discipline (RED → GREEN → REFACTOR). Each task's `.test.ts` is committed in the SAME atomic commit as the implementation (constitutional rule).

### Wave 0 — Manifest + skip lint (independent foundation)

> No dependency on reporter; safe to land first. Codemod also lives here because it depends only on the lint.

- **W0.T1**: Materialise `tools/test-evidence-projects-manifest.json`.
  - Run the live `name:` grep (scope item 3) to resolve the 12 `[ASSUMED]` rows.
  - Write `tools/test-evidence-projects-manifest.test.ts` (parity self-test via `ts-morph` walking root + per-workspace configs).
  - `pnpm exec vitest run tools/test-evidence-projects-manifest.test.ts` MUST pass before commit.
- **W0.T2**: TDD pair `tools/lint-skip-annotations.{ts,test.ts}` (9 F-cases per scope item 15).
  - Fixture tree at `tools/lint-skip-annotations/fixtures/{clean,unannotated,too-short,comment-only,todo,xit-xdescribe,boundary-5-lines,outside-window-6-lines,nested-suites}/`.
  - GREEN means `pnpm test:lint-skip-annotations` passes with coverage ≥ 90/90/90/90.
- **W0.T3**: TDD pair `tools/codemod-skip-annotations.{ts,test.ts}` (3 F-cases per scope item 15).
  - GREEN means `pnpm test:codemod-skip-annotations` passes with coverage ≥ 90/90/90/90 (W2 fix wires the explicit per-tool script).
- **W0.T4**: `.gitignore` + `package.json` scripts (10 entries) — additive only, no test gate needed beyond `pnpm typecheck` passing.

### Wave 1 — Reporter + workspace reporter wiring + codemod execution

- **W1.T1**: TDD pair `tools/vitest-evidence-reporter.{ts,test.ts}` (10 F-cases per scope item 15).
  - Fixture `TestModule` helpers mock the Vitest 4.1.5 reporter contract (signatures verbatim from RESEARCH R1.2/R1.3); DO NOT spawn real vitest in unit tests.
  - F7 (symlink defence) uses `fs.symlinkSync('/tmp/attacker-target', '<evidence-dir>/<sha>-api.json')` in `tmpdir()` to verify REFUSE.
  - GREEN means `pnpm test:vitest-evidence-reporter` passes with coverage ≥ 90/90/90/90.
- **W1.T2 — MANDATORY (B1 BLOCKER fix)**: Edit ALL three workspace `vitest.config.ts` files (scope item 6) to register the evidence reporter:
  - Root `vitest.config.ts` — append `"./tools/vitest-evidence-reporter.ts"` to `reporters:`.
  - `packages/contract-tests/vitest.config.ts:25` — change `reporters: ["dot"]` → `reporters: ["dot", resolve(ROOT_DIR, "tools/vitest-evidence-reporter.ts")]`.
  - `tests/e2e/vitest.config.ts:25` — change `reporters: ["verbose"]` → `reporters: ["verbose", resolve(ROOT_DIR, "tools/vitest-evidence-reporter.ts")]`.
  - This fixes the inheritance gap STRUCTURALLY at config-time. Wave 3 self-test now VERIFIES rather than DISCOVERS.
- **W1.T3 — MANDATORY (B1 BLOCKER fix)**: TDD pair `tools/lint-vitest-reporter-inheritance.{ts,test.ts}` (10 F-cases per scope item 8).
  - GREEN means `pnpm test:lint-vitest-reporter-inheritance` passes with coverage ≥ 90/90/90/90.
  - Lint exit 0 against the live workspace tree (post-W1.T2 edits).
- **W1.T4**: Run the codemod ONCE locally:
  ```
  pnpm exec tsx tools/codemod-skip-annotations.ts --apply
  ```
  Commit body documents the 54 placeholder insertions loudly. Audit-backlog manifest at `.planning/quick/260527-pj6-pre-push-test-evidence-gate/SKIP-AUDIT-BACKLOG.md` lists each insertion in the 4-column format (file path | line number | current placeholder | suggested investigation steps). Run `pnpm lint:skip-annotations` post-codemod — MUST exit 0.

### Wave 2 — Pre-push validator

- **W2.T1**: TDD pair `tools/lint-pre-push-test-evidence.{ts,test.ts}` (18 F-cases per scope item 15, incl. F17 force-push reverse-range + F18 force-push deletion).
  - Tests use `simple-git` or `child_process.execFileSync('git', [...])` against a `mkdtempSync` tmp Git repo — no testcontainers (RESEARCH planner sequencing hint #6).
  - F11 multi-ref fixture uses three stdin lines covering branch + tag + new-branch shapes from RESEARCH R3.2.
  - F17 fixture creates divergent-history tmp repo with `git reset --hard` rewrite to simulate `--force-with-lease`.
  - GREEN means `pnpm test:lint-pre-push-test-evidence` passes with coverage ≥ 90/90/90/90.

### Wave 3 — Wiring + scripted self-test (depends on W1 + W2 GREEN)

- **W3.T1**: Edit `lefthook.yml` to add BOTH the `pre-commit.commands.vitest-reporter-inheritance` AND `pre-push.commands.test-evidence` blocks (scope item 9).
- **W3.T2**: Write `tools/lint-lefthook-stdin-config.test.ts` (scope item 10) — assertion-only test; pin `use_stdin: true` + single-consumer invariant + pre-commit reporter-inheritance entry.
- **W3.T3**: Write `tools/test-evidence-projects-self-test.ts` (scope item 14) — scripted self-test replacing prose Wave 3 validation. Wave 4 commit gated on `pnpm test:evidence:projects-self-test` exit 0.
- **W3.T4 — SCRIPTED INTEGRATION SELF-TEST (BLOCKING)**:
  ```
  rm -rf .test-evidence/
  pnpm test:evidence:projects-self-test   # MUST exit 0; this spawns pnpm test:all internally + checks 22/22 coverage
  pnpm test:evidence:check                # synthetic stdin against HEAD — MUST exit 0
  pnpm lint:vitest-reporter-inheritance   # MUST exit 0 (all 3 workspaces have reporter)
  ```
  - If `test:evidence:projects-self-test` reports missing projects → fix the named workspace's `reporters:` (the script names it in stderr). Should NOT happen post-W1.T2 if executed correctly; the script is the structural safety net.
  - If any fragment has `unannotated_skip > 0` → the codemod missed a site → re-run scope item 13; investigate the AST walker regex against the missed call.
  - If any fragment has `fail > 0` → REAL TEST FAILURE on `main` — fix in this commit (constitutional: "Each fix lands with its tests in the SAME atomic commit") OR document why it is pre-existing flaky AND add a `// SKIP-REASON: flaky issue-<TODO>` annotation (creating a new audit-backlog entry).

### Wave 4 — Docs + Chart bump + deferred-items + final commit

- **W4.T1**: Write `docs/test-evidence-gate.md` (scope item 16, incl. §8 workspace reporter inheritance contract).
- **W4.T2**: Amend `CLAUDE.md` hard-rule 4 (scope item 17).
- **W4.T3**: Chart + values bump to `1.0.15` / appVersion `1.0.12` (scope item 19).
- **W4.T4**: Append SKIP-AUDIT-BACKLOG cross-reference to `.planning/deferred-items.md` (scope item 18 / W1 fix).
- **W4.T5**: Final pre-push self-test (the chicken-and-egg case — see Risk R5): the very commit shipping this gate MUST itself pass the gate.
  - Run `pnpm test:evidence:projects-self-test` one more time AFTER all Wave 4 edits — MUST exit 0.
  - Local push to a throwaway branch (`git push origin HEAD:refs/heads/test-260527-pj6-selftest`) — gate MUST exit 0 (or stderr report exactly which gap to fix; loop until clean).
  - DELETE the test branch (`git push origin :test-260527-pj6-selftest`) after success.

## 5 — Test matrix (per-F-case assertions)

| Test file | F-case | Assertion |
|---|---|---|
| `vitest-evidence-reporter.test.ts` | F1 | Fragment JSON keys match spec; counts correct; `unannotated_skip=0` for annotated fixture |
| `vitest-evidence-reporter.test.ts` | F2 | Unannotated skip detected; `skips[i].annotated === false`; `unannotated_skip > 0` |
| `vitest-evidence-reporter.test.ts` | F3 | Watch mode → no files written to `<evidence-dir>` |
| `vitest-evidence-reporter.test.ts` | F4 | Mocked `rev-parse HEAD` throws → reporter logs + early-return; no file written |
| `vitest-evidence-reporter.test.ts` | F5 | `reason="interrupted"` → no file written |
| `vitest-evidence-reporter.test.ts` | F6 | Post-write: `<final>.tmp.<pid>` does NOT exist; `<final>` does |
| `vitest-evidence-reporter.test.ts` | F7 | Pre-existing symlink at target → REFUSE + non-zero exit |
| `vitest-evidence-reporter.test.ts` | F8 | `fs.statSync(path).mode & 0o777 === 0o600` |
| `vitest-evidence-reporter.test.ts` | F9 | Env override `OPENWHISPR_TEST_EVIDENCE_DIR=<tmp>` + `OPENWHISPR_TEST_EVIDENCE_SHA=<fake>` → fragment written to tmp with `commit_sha` from env |
| `vitest-evidence-reporter.test.ts` | F10 | 2-project module set → exactly 2 fragments (`<sha>-api.json` + `<sha>-data.json`) |
| `lint-pre-push-test-evidence.test.ts` | F1 | No fragments → exit 1; stderr contains all 22 project names |
| `lint-pre-push-test-evidence.test.ts` | F2 | 21/22 fragments → exit 1; stderr names the 1 missing |
| `lint-pre-push-test-evidence.test.ts` | F3 | 22/22 clean → exit 0; stdout `✅ ... Push allowed.` |
| `lint-pre-push-test-evidence.test.ts` | F4 | `exit_code: 1` fragment → exit 1 with failure summary |
| `lint-pre-push-test-evidence.test.ts` | F5 | `fail: 1` fragment → exit 1 |
| `lint-pre-push-test-evidence.test.ts` | F6 | `unannotated_skip: 1` fragment → exit 1 |
| `lint-pre-push-test-evidence.test.ts` | F7 | Malformed JSON → exit 1 with `Malformed evidence at <path>` |
| `lint-pre-push-test-evidence.test.ts` | F8 | Symlink fragment → exit 1 with path-safety error |
| `lint-pre-push-test-evidence.test.ts` | F9 | `GITHUB_ACTIONS=true` → exit 0 + stderr bypass log |
| `lint-pre-push-test-evidence.test.ts` | F10 | `CI=true` → exit 0 + stderr bypass log |
| `lint-pre-push-test-evidence.test.ts` | F11 | Multi-ref stdin (4 lines) → each validated; one missing → exit 1 |
| `lint-pre-push-test-evidence.test.ts` | F12 | `localSha = "0".repeat(40)` (deletion) → line skipped; exit 0 if no other refs |
| `lint-pre-push-test-evidence.test.ts` | F13 | Tag push of already-validated commit → `rev-list --not --remotes` empty → exit 0 |
| `lint-pre-push-test-evidence.test.ts` | F14 | New-branch push (`remoteSha = "0".repeat(40)`) → validates each commit from `rev-list <localSha> --not --remotes` |
| `lint-pre-push-test-evidence.test.ts` | F15 | Malformed SHA `"GG...GG"` → exit 1 with `malformed SHA` |
| `lint-pre-push-test-evidence.test.ts` | F16 | Path-traversal fragment name → exit 1 |
| `lint-pre-push-test-evidence.test.ts` | F17 | Force-push reverse-range (`--force-with-lease`) where `localSha` does NOT contain `remoteSha` as ancestor → `rev-list remoteSha..localSha` enumerates unique commits → evidence required for each; missing → exit 1, all clean → exit 0 |
| `lint-pre-push-test-evidence.test.ts` | F18 | Force-push deletion semantics (`localSha === "0".repeat(40)` with non-zero `remoteSha`) → skipped (deletion no-op rule); exit 0 if no other refs |
| `lint-skip-annotations.test.ts` | F1–F9 | Per scope item 15 — clean / unannotated / too-short / .todo / comment-shape-only / xit / xdescribe / boundary / outside-window |
| `lint-vitest-reporter-inheritance.test.ts` | F1 | All workspace configs include evidence reporter in `reporters:` → exit 0 |
| `lint-vitest-reporter-inheritance.test.ts` | F2 | One workspace's `reporters:` array missing evidence reporter → exit 1 with `<file>:<line>` |
| `lint-vitest-reporter-inheritance.test.ts` | F3 | Workspace omits `reporters:` entirely (inherits root) → exit 0 |
| `lint-vitest-reporter-inheritance.test.ts` | F4 | Root config missing reporter → exit 1 |
| `lint-vitest-reporter-inheritance.test.ts` | F5 | String-form `reporters: "default"` → exit 1 with refactor message |
| `lint-vitest-reporter-inheritance.test.ts` | F6 | Spread form `reporters: [...someVar, "<path>"]` → exit 1 with `cannot statically verify` |
| `lint-vitest-reporter-inheritance.test.ts` | F7 | Computed-variable form `reporters: reportersList` → exit 1 with same |
| `lint-vitest-reporter-inheritance.test.ts` | F8 | Relative `./tools/vitest-evidence-reporter.ts` from root → accepted |
| `lint-vitest-reporter-inheritance.test.ts` | F9 | Absolute resolved form `resolve(ROOT_DIR, ...)` from child workspace → accepted |
| `lint-vitest-reporter-inheritance.test.ts` | F10 | Multiple inline `defineProject` blocks in root config — partial coverage → exit 1 naming the failing inline project |
| `test-evidence-projects-manifest.test.ts` | (single) | Manifest set === live `name:` strings extracted via ts-morph |
| `lint-lefthook-stdin-config.test.ts` | (single) | YAML asserts: `pre-push.commands.test-evidence.use_stdin === true`; `run` matches `/lint-pre-push-test-evidence\.ts/`; exactly one `use_stdin: true` under `pre-push.commands`; `pre-commit.commands.vitest-reporter-inheritance.run` matches `/lint-vitest-reporter-inheritance\.ts/` |
| `codemod-skip-annotations.test.ts` | F1 | Un-annotated fixture → post-codemod has `// SKIP-REASON: pre-260527-pj6 ...` line above the call |
| `codemod-skip-annotations.test.ts` | F2 | Already-annotated fixture → idempotent (no-op) |
| `codemod-skip-annotations.test.ts` | F3 | Audit manifest `SKIP-AUDIT-BACKLOG.md` written to expected path with correct row count + 4-column format (file path \| line number \| current placeholder \| suggested investigation steps) |

## 6 — Coverage targets

Constitutional floor **≥ 90/90/90/90** on lines / branches / functions / statements for ALL new tools. Per-tool `test:lint-*`, `test:vitest-evidence-reporter`, `test:codemod-skip-annotations`, and `test:lint-vitest-reporter-inheritance` scripts enforce thresholds via `--coverage.thresholds.*=90` (RESEARCH R7.4 verbatim shape). Wave 0/1/2 each MUST fail their own commit-level CI gate if any axis dips below 90; the failure mode is the existing `lint-coverage-floor-per-phase.ts` behaviour.

## 7 — Verification checklist (executor runs in order)

```
# Wave 0
pnpm exec vitest run tools/test-evidence-projects-manifest.test.ts
pnpm exec vitest run tools/lint-skip-annotations.test.ts --coverage  # ≥ 90/90/90/90
pnpm test:codemod-skip-annotations   # ≥ 90/90/90/90 (W2 fix: explicit per-tool script)
pnpm typecheck

# Wave 1
pnpm exec vitest run tools/vitest-evidence-reporter.test.ts --coverage  # ≥ 90/90/90/90
# B1 BLOCKER FIX: edit all 3 workspace configs FIRST, then verify with new linter
pnpm test:lint-vitest-reporter-inheritance   # ≥ 90/90/90/90 (B1 fix coverage gate)
pnpm lint:vitest-reporter-inheritance        # MUST exit 0 against live tree
pnpm exec tsx tools/codemod-skip-annotations.ts --apply
pnpm lint:skip-annotations   # MUST exit 0 after codemod
git diff --stat   # confirm 54 in-place insertions + audit manifest in 4-column format

# Wave 2
pnpm exec vitest run tools/lint-pre-push-test-evidence.test.ts --coverage  # ≥ 90/90/90/90 (incl. F17/F18 force-push)

# Wave 3 — SCRIPTED integration self-test (BLOCKING; W5 fix)
rm -rf .test-evidence/
pnpm test:evidence:projects-self-test   # spawns pnpm test:all + checks 22/22 + exits 1 with structured delta on miss
pnpm exec vitest run tools/lint-lefthook-stdin-config.test.ts
pnpm test:evidence:check   # synthetic stdin against HEAD — MUST exit 0
make lint:lockers          # confirm new tools satisfy LOCKER-01..06
helm lint charts/openwhispr-server
helm template test charts/openwhispr-server | head -20   # confirm chart still renders

# Wave 4 — self-test the gate on its own commit
# W4.T4: append SKIP-AUDIT-BACKLOG cross-reference to .planning/deferred-items.md
pnpm test:evidence:projects-self-test   # final re-run before commit; MUST exit 0
git add <all-files>
git commit -m "<conventional message>"
git push origin HEAD:refs/heads/test-260527-pj6-selftest   # gate MUST pass
git push origin :test-260527-pj6-selftest                  # cleanup
```

**Codemod placeholder review (Wave 4 final)**: open `.planning/quick/260527-pj6-pre-push-test-evidence-gate/SKIP-AUDIT-BACKLOG.md` and confirm each of the 54 rows is present in the 4-column format with file path, line number, current placeholder string, and suggested investigation steps. Append-cross-reference entry to `.planning/deferred-items.md` (W4.T4) — discrete commit-level task; not optional.

## 8 — Release artifacts

Atomic two-version bump in the same commit train as the gate landing:
- App / image: `v1.0.11` → `v1.0.12` (appVersion).
- Chart: `1.0.14` → `1.0.15`.
- No runtime template changes — pure workflow + tooling release.
- Tag the release commit `v1.0.12` AND publish chart `openwhispr-server-1.0.15` via the existing chart release workflow.
- **Push protocol**: tag + chart push MUST themselves pass the gate (Risk R5 / R9). Run Wave 4 final self-test BEFORE tagging.

## 9 — Risk register

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Reporter overhead on every `pnpm test` (per-test file-read for SKIP-REASON scan) | LOW | minor latency | Memoise file reads per-module (one read per source file, not per test case); cap line-lookback at 5 lines per call site. |
| R2 | Multi-workspace fragment race (two workers writing same `.test-evidence/<sha>-<project>.json`) | LOW | corrupted JSON | Vitest 4 forks per-project workers (RESEARCH R8.5) — exactly one writer per filename. Defence-in-depth: atomic `tmp+rename` + `lstatSync` symlink refuse. |
| R3 | Codemod placeholder `pre-260527-pj6 — original reason unknown, audit required` is fake annotation; lint accepts it; real reason is lost | MEDIUM | tech debt | Loud commit body + `SKIP-AUDIT-BACKLOG.md` (4-column format with investigation steps) + `.planning/deferred-items.md` entry (W4.T4 — discrete task); each placeholder is a tracked TODO with `<file>:<line>` precise location for follow-up. |
| R4 | lefthook `use_stdin` is one-command-per-hook (RESEARCH R2.3 #2); future stdin-consuming command would conflict | LOW | future work blocked | Regression test `tools/lint-lefthook-stdin-config.test.ts` asserts exactly one `use_stdin: true` consumer under `pre-push`; surfaces the conflict at PR time. |
| R5 | The v1.0.12 commit itself must PASS the gate (chicken-and-egg) | MEDIUM | release blocked | Wave 4.T5 self-test loop: run `pnpm test:evidence:projects-self-test` BEFORE commit; run gate against own commit on throwaway branch BEFORE tagging; fix any uncovered failure in the same commit. |
| R6 | Manifest drift — `vitest.config.ts:projects[]` grows from 22 to 23 without manifest update | LOW | gate false-passes a missing-evidence push | Parity self-test (`tools/test-evidence-projects-manifest.test.ts`) walks live config via `ts-morph` and fails on any difference. |
| R7 | Symlink TOCTOU on `.test-evidence/` | LOW | data exfiltration | `fs.realpathSync` canonicalise + `fs.lstatSync` refuse-on-symlink + `mkdirSync({ mode: 0o700 })` + `writeFileSync({ flag: 'wx', mode: 0o600 })` + `renameSync` atomic (RESEARCH R5.2). |
| R8 | CI bypass abuse (developer exports `CI=1` locally) | LOW | push succeeds without tests | Bypass stderr-log is unconditional; CI L3 (deferred) re-runs validator against the GitHub event-SHA range, catching the bypass on the remote side. |
| R9 | Tag pushes (`v1.0.12`) — gate must apply | CERTAIN | release blocked if untreated | RESEARCH R3.4: tag SHA resolves via `^{commit}`, then standard `rev-list --not --remotes` enumerates the same already-validated commits → empty range → ACCEPT. Covered by F13. |
| R10 | `mergeConfig` per-workspace `reporters:` override silently drops the reporter for that workspace (RESEARCH R8.2) | **WAS MEDIUM → now LOW** | partial evidence | **B1 BLOCKER fix promotes the fix to Wave 1 mandatory (scope item 6 + scope item 7).** Both known-bad workspaces (`packages/contract-tests/`, `tests/e2e/`) get explicit reporter append. New linter (scope item 7) catches future drift at pre-commit time. W3.T4 scripted self-test (`tools/test-evidence-projects-self-test.ts`) verifies 22/22 fragments BEFORE Wave 4 commit. **No longer "let self-test discover the gap" — fix it structurally.** |
| R11 | `ts-morph` performance on 600+ test files during `lint-skip-annotations` | LOW | slow pre-commit if ever wired | Limit scope to `(it|test|describe|xit|xdescribe)\.(skip|todo)` call expressions only; never traverse full ASTs. Benchmark in `lint-skip-annotations.test.ts` (assert runtime < 10s on 600 files). |
| R12 | **Workspace `vitest.config.ts` drift — future workspace addition or refactor drops the evidence reporter from its `reporters[]` array** (e.g., new `apps/admin/vitest.config.ts` with `reporters: ["dot"]` overriding root) | MEDIUM | partial evidence — same failure shape as R10 but on FUTURE additions | **Defence-in-depth fix:** `tools/lint-vitest-reporter-inheritance.ts` (scope item 7) walks ALL vitest configs and refuses any non-inheriting workspace whose `reporters:` array does not include the evidence reporter. Wired to **lefthook pre-commit** (catches drift at commit-time, not push-time) AND the W3.T4 scripted self-test (`test-evidence-projects-self-test.ts`) verifies 22/22 coverage at the run-time end. Two-layer defence: static (lint) + dynamic (run + count). |

## 10 — Out-of-scope deferrals

Tracked in `.planning/deferred-items.md` post-merge:

1. **CI L3 redundant validator job** — `.github/workflows/ci.yml` step that runs `tsx tools/lint-pre-push-test-evidence.ts` against `${{ github.event.before }}..${{ github.event.after }}`. Catches `--no-verify` bypassers. Deferred per CONTEXT.
2. **Cross-machine evidence sharing** — devs pushing the same SHA from different laptops. Per-machine-per-checkout in v1.
3. **Evidence retention / GC policy** — `.test-evidence/` is `.gitignore`d but grows unbounded locally. Add a `pnpm test:evidence:gc` script in a follow-up.
4. **Playwright e2e fragment integration** — e2e tests run via `pnpm test:e2e-cjm`, not vitest. Separate phase.
5. **Coverage-floor data inside evidence fragment** — covered by separate `lint-coverage-floor-per-phase.ts`.
6. **Mutation-testing evidence (`stryker run`)** — different cadence (weekly/nightly), not pre-push.
7. **54 codemod-placeholder cleanups** — `SKIP-AUDIT-BACKLOG.md` enumerates each (4-column format with investigation steps); follow-up Quick replaces placeholder reasons with real ones. **Cross-referenced in `.planning/deferred-items.md` (W4.T4 — W1 fix).**
8. **`pre-push.commands.web-test` deprecation** — keep one release cycle, then remove (RESEARCH gotcha #18).

**W3 — scope width acknowledgment:** 13 new source files (11 TS + 1 JSON + 1 MD audit-backlog) + 54 codemod placeholder insertions is wider than typical Quick-task envelope. **Approved by operator at scoping time** because (a) all files are co-located tooling under `tools/` + `.planning/quick/.../`, (b) the goal is a single constitutional gate landing — not feature creep, (c) coupling between reporter + validator + linter + workspace edits is tight enough that splitting would create a stale-evidence inter-PR window (Wave 0-1 lands but Wave 2 validator REFUSES every subsequent push until Wave 3 lands, deadlocking all developer activity). Wave 4 (docs + chart + deferred-items) is a natural split point if context budget runs short during execution — but the *technical* coupling spans Wave 0 → Wave 3 and CANNOT be split.

## 11 — Operator runbook post-merge ("tests pass locally but evidence rejected")

Document this section verbatim in `docs/test-evidence-gate.md` (scope item 16.4 Recovery scenarios).

### 11.1 "Missing project X" REFUSE

Cause: `pnpm --filter <Y>` was used instead of `pnpm test:all`, OR the workspace registers a `reporters:` override that drops the evidence reporter.

Resolution:
```
rm -rf .test-evidence/$(git rev-parse HEAD)-*.json
pnpm test:all
git push   # gate should now accept
```

If the same project keeps missing after `pnpm test:all`, audit:
```
pnpm lint:vitest-reporter-inheritance   # names <file>:<line> precisely (B1 fix)
```
Any workspace whose `reporters:` array does NOT include the evidence reporter is the culprit (RESEARCH R8.2 `mergeConfig` replacement gotcha). Add the reporter to that workspace's array and re-run. The lint is wired to pre-commit, so this scenario should ONLY occur on a stale checkout that pre-dates the gate landing.

### 11.2 "Stale evidence" (SHA mismatch after rebase)

Cause: tests were run pre-rebase; the rebase changed HEAD SHA; fragments are for the old SHA.

Resolution:
```
pnpm test:all   # writes fragments for the new HEAD SHA
git push
```

### 11.3 "Unannotated skip in <project>" REFUSE

Cause: a `.skip` / `.todo` call landed without `// SKIP-REASON: <≥10 chars>` within 5 lines above.

Resolution: open the file:line reported in stderr; add the annotation:
```ts
// SKIP-REASON: requires-docker — testcontainers-postgresql needs Docker socket
it.skip("verifies behaviour under real Postgres", () => { /* ... */ });
```

Re-run `pnpm test:all` (so the fragment regenerates) and `git push`.

### 11.4 "Malformed evidence" REFUSE

Cause: an interrupted test run left a `.test-evidence/<sha>-<project>.json.tmp.<pid>` orphan, or a manual edit corrupted the JSON.

Resolution:
```
rm -rf .test-evidence/
pnpm test:all
git push
```

### 11.5 NEVER `--no-verify`

CLAUDE.md hard-rule 4 prohibits `--no-verify` on the test-evidence gate. Use the remediation steps above. Bypassing is a constitutional violation; CI L3 (deferred) catches it on the remote side regardless.

### 11.6 Workspace reporter inheritance contract (B1 fix)

Three accepted shapes for `reporters:` in any `vitest.config.ts`:

1. **Absent** — workspace omits `reporters:` entirely → inherits from root config → ACCEPTED.
2. **Explicit array containing evidence reporter** — `reporters: [..., "./tools/vitest-evidence-reporter.ts"]` or `reporters: [..., resolve(ROOT_DIR, "tools/vitest-evidence-reporter.ts")]` → ACCEPTED.
3. **Anything else** — string-form, spread form, computed-variable form → REFUSED by `pnpm lint:vitest-reporter-inheritance` at pre-commit time.

Future workspace additions MUST conform to (1) or (2). The pre-commit lint catches drift; the W3 scripted self-test catches it at runtime as defence-in-depth.

---

## Appendix A — Manifest of canonical 22 project names (RESEARCH R1.5)

```
api                              (apps/api/vitest.config.ts:30)               [VERIFIED]
worker                           (apps/worker/vitest.config.ts)               [VERIFIED via grep]
data                             (packages/data/vitest.config.ts)             [VERIFIED via grep]
web                              (apps/web/vitest.config.ts)                  [Wave 0 verify]
@openwhispr/byok-guard           (packages/byok-guard/vitest.config.ts)       [Wave 0 verify]
@openwhispr/contract-tests       (packages/contract-tests/vitest.config.ts)   [Wave 0 verify]
@openwhispr/email                (packages/email/vitest.config.ts)            [Wave 0 verify]
@openwhispr/litellm-client       (packages/litellm-client/vitest.config.ts)   [Wave 0 verify]
load-test                        (tools/load-test/vitest.config.ts)           [Wave 0 verify]
test-probe                       (tools/test-probe/vitest.config.ts)          [Wave 0 verify]
mock-litellm                     (compose/mock-litellm/vitest.config.ts)      [Wave 0 verify]
<e2e name>                       (tests/e2e/vitest.config.ts)                 [Wave 0 verify]
<mock-realtime name>             (tests/e2e/mock-realtime/vitest.config.ts)   [Wave 0 verify]
@openwhispr/auth-stub            (vitest.config.ts:63 inline)                 [VERIFIED]
@openwhispr/i18n-stub            (vitest.config.ts:71 inline)                 [VERIFIED]
@openwhispr/observability        (vitest.config.ts:79 inline)                 [VERIFIED]
@openwhispr/wire-schemas         (vitest.config.ts:87 inline)                 [VERIFIED]
tools                            (vitest.config.ts:101 inline)                [VERIFIED]
tests-e2e-cjm-steps              (vitest.config.ts:119 inline)                [VERIFIED]
tests-e2e-cjm-support            (vitest.config.ts:133 inline)                [VERIFIED]
tests-integration                (vitest.config.ts:150 inline)                [VERIFIED]
tests-self-tests                 (vitest.config.ts:161 inline)                [VERIFIED]
```

Wave 0 Task 1 replaces every `[Wave 0 verify]` row with `[VERIFIED]` and the live string before writing the manifest JSON.

---

## Appendix B — Constitutional alignment

| Rule | How this plan honours it |
|---|---|
| Strict TDD (RED→GREEN→REFACTOR) | Every new `.ts` ships with its `.test.ts` in the same commit; fixtures precede impl. |
| Per-phase coverage ≥ 90/90/90/90 | Every new tool has a `test:lint-*` / `test:*` script with `--coverage.thresholds.*=90`, INCLUDING `test:codemod-skip-annotations` (W2 fix) and `test:lint-vitest-reporter-inheritance` (B1 fix). |
| No mocks of internal logic | Reporter is tested against synthetic `TestModule` fixtures (boundary mock — vitest's `Reporter` IS the external contract); validator uses real `tmpdir` Git repos; codemod runs on real fixture trees. |
| No `--no-verify` | Plan extends CLAUDE.md hard-rule 4; gate makes circumvention louder, not easier. |
| LOCKER-01 (no NODE_ENV branches) | Reporter env reads (`OPENWHISPR_TEST_EVIDENCE_*`) are operator-facing config, NOT `NODE_ENV` branches. |
| LOCKER-02 (no type suppression) | New tools use `ts-morph` + `Reporter` interface types directly; no `as any`. |
| LOCKER-03 (no hardcoded localhost / UUID / secret shape) | New tools use `/^[0-9a-f]{40}$/` SHA validation (not a credential shape); evidence paths are `tmpdir`-derived in tests. |
| LOCKER-04 (route schema + rateLimit) | N/A — no new routes. |
| LOCKER-05 (error truncation 1000 chars) | Reporter truncates `error_message_truncated` to 1000 chars per fragment record. |
| LOCKER-06 (no shell credential interpolation) | `lefthook.yml` runs `pnpm exec tsx tools/lint-pre-push-test-evidence.ts` directly; no `bash -c` with template interpolation. Codemod / validator / projects-self-test spawn Git via argv-array `spawnSync('git', ['rev-list', ...], { shell: false })`. |
| English-only source artefacts | All stderr / log / doc strings in English. |

End of PLAN.
