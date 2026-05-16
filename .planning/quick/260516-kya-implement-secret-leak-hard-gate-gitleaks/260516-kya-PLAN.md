---
phase: 260516-kya
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .gitleaks.toml
  - .gitleaksignore
  - .gitattributes
  - tools/install-gitleaks.sh
  - tools/lint-gitleaks-config.test.ts
  - tools/lint-gitleaks-hook.test.ts
  - lefthook.yml
  - package.json
  - Makefile
  - .github/workflows/security.yml
  - tools/install-hooks.cjs
  - CLAUDE.md
  - docs/security/secret-leak-runbook.md
autonomous: true
requirements:
  - QUICK-260516-kya
must_haves:
  truths:
    - ".gitleaks.toml is single source of truth — referenced by both lefthook (L1+L2) and CI security.yml (L3)"
    - "Pre-commit hook fails-closed (exit != 0) when a synthetic sk-proj-... shape is in staged diff"
    - "Pre-push hook fails-closed when a synthetic sk-proj-... shape exists in a committed range (catches --no-verify bypass)"
    - "install-gitleaks.sh is idempotent (re-runnable) and invoked from tools/install-hooks.cjs after lefthook install"
    - "Allowlist exempts known test-fixture shapes: sk-or-v1-1234567890abcdef, sk-master-x, AKIATEST, AKIAIOSFODNN7EXAMPLE, sk-proj-1234567890abcdef"
    - "pnpm lint:gitleaks against current HEAD returns 0 findings (no false positives in existing repo)"
    - "vitest TDD test for .gitleaks.toml went through RED (no config -> test fails) before GREEN"
    - "CI gitleaks-action in .github/workflows/security.yml passes config-path: .gitleaks.toml explicitly"
  artifacts:
    - path: ".gitleaks.toml"
      provides: "Single-source-of-truth gitleaks config with allowlist for test fixtures and .env*.example"
      contains: "extends"
    - path: ".gitleaksignore"
      provides: "Pro-forma empty ignore file (history clean — verified via git log -S)"
    - path: ".gitattributes"
      provides: ".env* -diff to prevent accidental key reveal in git diff / PR UI"
      contains: ".env"
    - path: "tools/install-gitleaks.sh"
      provides: "Idempotent gitleaks installer (brew on macOS, curl-tarball on linux)"
    - path: "tools/lint-gitleaks-config.test.ts"
      provides: "vitest TDD: live shape MUST detect; test placeholders MUST allow"
    - path: "tools/lint-gitleaks-hook.test.ts"
      provides: "Integration test: synthetic-leak file fails lefthook pre-commit"
    - path: "docs/security/secret-leak-runbook.md"
      provides: "Operator runbook: what to do when hook fires"
  key_links:
    - from: "lefthook.yml#pre-commit.gitleaks"
      to: ".gitleaks.toml"
      via: "--config=.gitleaks.toml CLI arg"
      pattern: "config=\\.gitleaks\\.toml"
    - from: "lefthook.yml#pre-push.gitleaks"
      to: ".gitleaks.toml"
      via: "--config=.gitleaks.toml CLI arg"
      pattern: "config=\\.gitleaks\\.toml"
    - from: ".github/workflows/security.yml#gitleaks"
      to: ".gitleaks.toml"
      via: "config-path action input"
      pattern: "config-path:\\s*\\.gitleaks\\.toml"
    - from: "tools/install-hooks.cjs"
      to: "tools/install-gitleaks.sh"
      via: "spawnSync invocation after lefthook install"
      pattern: "install-gitleaks\\.sh"
    - from: "package.json#scripts"
      to: ".gitleaks.toml"
      via: "lint:gitleaks and lint:gitleaks:staged scripts"
      pattern: "lint:gitleaks"
---

<objective>
Implement defense-in-depth secret-leak prevention: turn gitleaks from CI-only post-mortem into a fail-closed pre-commit + pre-push hard gate, with CI as the final safety net. All three layers consume the same `.gitleaks.toml` (single source of truth).

Purpose: Eliminate the gap where `git add .env` or `git commit --no-verify` can push a secret to GitHub before CI fires. Approved plan: `/Users/nick/.claude/plans/jolly-questing-narwhal.md`.

Output: 3 hook layers (L1 pre-commit, L2 pre-push, L3 CI) sharing one config + bootstrap + allowlist + TDD-backed config tests + operator runbook + CLAUDE.md Hard Rule entry.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@/Users/nick/.claude/plans/jolly-questing-narwhal.md
@CLAUDE.md
@lefthook.yml
@.github/workflows/security.yml
@tools/install-hooks.cjs

<interfaces>
<!-- Lefthook 2.1.6 command schema (already in use):
  pre-commit:
    commands:
      <name>:
        glob: <pattern>     # optional; absence = scan diff not files
        run: <shell>
        fail_text: <msg>    # optional; printed on non-zero exit
  pre-push:
    commands:
      <name>:
        run: <shell>
        fail_text: <msg>
-->

<!-- gitleaks v8.x CLI surface:
  gitleaks protect --staged --redact --config=<path>          # L1 pre-commit (staged diff only)
  gitleaks detect  --redact --config=<path> --log-opts="<r>"  # L2 pre-push (commit range)
  gitleaks detect  --redact --config=<path> --no-git          # L3 manual / lint:gitleaks (working tree)
  Exit code: 0 = clean, 1 = leaks found, other = error.
-->

<!-- gitleaks .toml schema (extends default ruleset):
  title = "..."
  [extend]
  useDefault = true
  [allowlist]
  description = "..."
  paths = [ "regex1", "regex2" ]
  regexes = [ "shape1", "shape2" ]
-->

<!-- Existing install-hooks.cjs pattern: spawnSync with stdio:"inherit", exits 0 on
     expected-missing-bin paths so pnpm install never wedges. The gitleaks bootstrap
     call MUST follow the same defensive shape. -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Gitleaks config + installer + TDD config tests (RED -> GREEN)</name>
  <files>.gitleaks.toml, .gitleaksignore, .gitattributes, tools/install-gitleaks.sh, tools/lint-gitleaks-config.test.ts, package.json, Makefile</files>
  <behavior>
    - RED: tools/lint-gitleaks-config.test.ts runs BEFORE .gitleaks.toml exists; vitest exits non-zero with clear "config file not found" message.
    - GREEN test cases (all must pass once .gitleaks.toml lands):
      - Synthetic live shape `sk-proj-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKKKLLLLMMMMNNNN` in a /tmp tracked file => gitleaks detects (exit 1, finding emitted).
      - Test placeholder `sk-or-v1-1234567890abcdef` in tests/fixtures/foo.ts => gitleaks allows (exit 0).
      - Test placeholder `sk-master-x` in apps/api/vitest.setup.ts => allowed.
      - `AKIAIOSFODNN7EXAMPLE` and `AKIATEST` => allowed.
      - `sk-proj-1234567890abcdef` (test placeholder shape) => allowed.
      - `.env.example` lines containing `OPENAI_API_KEY=sk-...` => allowed (path-based allowlist).
    - Test invokes the real gitleaks binary via child_process.spawnSync with argv-array (NEVER template-literal interpolation per LOCKER-06); skips with clear message if gitleaks not on PATH (CI mode handles install separately).
  </behavior>
  <action>
    Per approved plan §"Файлы для изменения":

    1. Write `tools/lint-gitleaks-config.test.ts` FIRST (RED). vitest suite that:
       - Resolves repo root.
       - Locates gitleaks binary (PATH lookup); if absent, `test.skip` with operator hint pointing at `make install-gitleaks`.
       - For each fixture case, writes a temp file under a tmpdir, runs `gitleaks detect --no-git --source <tmpdir> --config <repo>/.gitleaks.toml --redact`, asserts exit code.
       - Uses argv-array spawnSync (LOCKER-06 compliant).
       - First commit of the task is the RED test alone; commit message: `test(260516-kya): RED gitleaks config contract`.

    2. Write `.gitleaks.toml` extending default ruleset (`[extend] useDefault = true`) with allowlist:
       - `paths`: `^tests/`, `^tools/lint-no-hardcode/fixtures/`, `^packages/litellm-client/tests/`, `^apps/api/vitest\.setup\.ts$`, `\.example$`, `^docs/`, `^\.planning/`, `^CHANGELOG`.
       - `regexes`: literal placeholders `sk-or-v1-1234567890abcdef`, `sk-master-x`, `AKIATEST`, `AKIAIOSFODNN7EXAMPLE`, `sk-proj-1234567890abcdef`.
       - Header comment cites approved plan + this PLAN.md path so future maintainers know the contract.

    3. Write `.gitleaksignore` — pro-forma empty file with comment `# History clean (verified 2026-05-16 via git log -S on .env contents). Add fingerprints here only if a future audit surfaces a legitimate historical match that is NOT a live secret.`

    4. Write `.gitattributes` line: `.env* -diff` (and `.env.bak -diff`) to suppress diff content in PR UI / `git diff`. If `.gitattributes` already exists, append; do not overwrite.

    5. Write `tools/install-gitleaks.sh`:
       - `#!/usr/bin/env bash` + `set -euo pipefail`.
       - Idempotent: if `command -v gitleaks` returns ≥ 8.x, exit 0 with "[install-gitleaks] already installed: <ver>".
       - macOS branch: `brew install gitleaks` (skip if not on macOS).
       - Linux branch: detect arch (amd64/arm64), curl-tarball from `github.com/gitleaks/gitleaks/releases/download/v8.x.x/...`, verify sha256 (pin a version + sha in the script), extract to `/usr/local/bin/gitleaks` if writable else `${HOME}/.local/bin/gitleaks`.
       - Argv-array invocations only (no shell-interpolated URL/token vars — LOCKER-06).
       - Exit 0 in CI (skip; CI uses the gitleaks-action binary).
       - `chmod +x tools/install-gitleaks.sh` after writing.

    6. `package.json` scripts section — ADD (do not remove existing):
       - `"lint:gitleaks": "gitleaks detect --redact --config=.gitleaks.toml --no-git"` (scans working tree).
       - `"lint:gitleaks:staged": "gitleaks protect --staged --redact --config=.gitleaks.toml"`.

    7. `Makefile` — ADD targets:
       - `install-gitleaks:` → invokes `bash tools/install-gitleaks.sh`.
       - `lint:gitleaks:` → invokes `pnpm lint:gitleaks`.
       - Append `lint:gitleaks` to the aggregate `lint:` target's dependency list (find the existing aggregate; if it doesn't exist, do not invent — leave a TODO comment per CLAUDE.md "no scope creep").

    8. Run the test (GREEN). Commit: `feat(260516-kya): add .gitleaks.toml + installer + allowlist (GREEN)`.

    Do NOT edit any production server code (apps/api/src/**, packages/**/src/**) to satisfy tests — CLAUDE.md Hard Rule #1. If a fixture path collides with real source, adjust the allowlist, not the source.

    Honor LOCKER-03: no hardcoded localhost/UUID/secret literals outside allowlisted dirs. Test fixtures in tools/ are allowlisted by gitleaks; the test itself goes in tools/ which is the project convention.
  </action>
  <verify>
    <automated>
      cd /Users/nick/openwhispr-server && \
      bash tools/install-gitleaks.sh && \
      pnpm exec vitest run tools/lint-gitleaks-config.test.ts && \
      pnpm lint:gitleaks
    </automated>
  </verify>
  <done>
    - `.gitleaks.toml`, `.gitleaksignore`, `.gitattributes`, `tools/install-gitleaks.sh`, `tools/lint-gitleaks-config.test.ts` all exist and committed.
    - `gitleaks version` returns ≥ v8.x after `bash tools/install-gitleaks.sh`.
    - vitest config-test suite passes (all 6+ assertions green).
    - `pnpm lint:gitleaks` against HEAD returns 0 findings.
    - Two atomic commits exist: RED test commit, then GREEN config+installer commit.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wire L1 pre-commit + L2 pre-push hooks + L3 CI config-path + integration test</name>
  <files>lefthook.yml, .github/workflows/security.yml, tools/install-hooks.cjs, tools/lint-gitleaks-hook.test.ts</files>
  <behavior>
    - Integration test creates a throwaway git repo in tmpdir, copies in repo's `lefthook.yml` + `.gitleaks.toml`, stages a file containing `sk-proj-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKKKLLLLMMMMNNNN`, runs `lefthook run pre-commit` via argv-array spawnSync, asserts exit ≠ 0 and stderr/stdout mentions gitleaks finding.
    - Second test path: same setup, but commits the leak via `--no-verify`, then runs `lefthook run pre-push` (with a fake upstream pointer or fallback `HEAD~1..HEAD`), asserts exit ≠ 0.
    - install-hooks.cjs after invocation has installed both lefthook hooks AND gitleaks binary (or warned cleanly if gitleaks bin absent on first pass, matching the existing lefthook-missing-bin defensive pattern lines 76-83).
  </behavior>
  <action>
    1. Extend `lefthook.yml`:
       - Under `pre-commit.commands`, add:
         ```
         gitleaks:
           run: gitleaks protect --staged --redact --config=.gitleaks.toml
           fail_text: "Secret leak detected. See docs/security/secret-leak-runbook.md."
         ```
         No `glob:` — gitleaks scans the staged diff, not a file list.
       - Under `pre-push.commands`, add:
         ```
         gitleaks:
           run: bash -c 'UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo ""); if [ -n "$UPSTREAM" ]; then RANGE="@{u}..HEAD"; else RANGE="HEAD~20..HEAD"; fi; gitleaks detect --redact --config=.gitleaks.toml --log-opts="$RANGE"'
           fail_text: "Secret leak detected in commit range. See docs/security/secret-leak-runbook.md."
         ```
         NOTE: the `bash -c` shell here is INTERNAL to lefthook (no env-var credential interpolation; LOCKER-06 applies to source files, not config). UPSTREAM is the symbolic ref, not a credential.

    2. Edit `.github/workflows/security.yml` gitleaks job: pass `config-path: .gitleaks.toml` to the action `with:` block so CI and local hooks share the exact same config (key_link contract).

    3. Extend `tools/install-hooks.cjs`:
       - After the existing `pnpm exec lefthook install --force` block (after the `result.status === 0` path), invoke `bash tools/install-gitleaks.sh` via `spawnSync("bash", ["tools/install-gitleaks.sh"], { stdio: "inherit", env: process.env })`.
       - Mirror existing defensive shape: tolerate missing bash / missing script with a warning (not failure) so `pnpm install` never wedges.
       - Skip when `process.env.CI === "true"` OR `process.env.SKIP_LEFTHOOK_INSTALL === "1"` (CI uses gitleaks-action, not local bin).

    4. Write `tools/lint-gitleaks-hook.test.ts` (RED first — commit `test(260516-kya): RED gitleaks lefthook integration`):
       - Per `<behavior>` above. Uses `node:child_process.spawnSync` with argv-array.
       - Skips gracefully if `lefthook` or `gitleaks` not on PATH.

    5. Make the test GREEN by ensuring lefthook entries are syntactically correct and `--config=.gitleaks.toml` resolves. Commit: `feat(260516-kya): wire gitleaks into lefthook pre-commit + pre-push + CI`.

    6. Manual negative-test verification per approved plan §Verification step 4 + 5: documented in commit message but not automated here (next task's runbook covers operator-facing flow).

    Honor CLAUDE.md Hard Rule #1: do NOT edit any apps/**, packages/**, or migration source to make tests pass. Only this PLAN's listed files change.
  </action>
  <verify>
    <automated>
      cd /Users/nick/openwhispr-server && \
      pnpm exec vitest run tools/lint-gitleaks-hook.test.ts && \
      grep -q "config=\.gitleaks\.toml" lefthook.yml && \
      grep -q "config-path:.*\.gitleaks\.toml" .github/workflows/security.yml && \
      grep -q "install-gitleaks\.sh" tools/install-hooks.cjs && \
      pnpm exec lefthook run pre-commit --files lefthook.yml
    </automated>
  </verify>
  <done>
    - lefthook.yml has gitleaks entries in BOTH pre-commit and pre-push.
    - security.yml passes `config-path: .gitleaks.toml` to gitleaks-action.
    - install-hooks.cjs invokes install-gitleaks.sh idempotently after lefthook install.
    - Integration test passes — synthetic leak fails the pre-commit hook (exit ≠ 0) AND fails pre-push hook even when `--no-verify` was used.
    - Two atomic commits: RED integration test, then GREEN hook + CI + bootstrap wiring.
  </done>
</task>

<task type="auto">
  <name>Task 3: Operator runbook + CLAUDE.md Hard Rule entry</name>
  <files>docs/security/secret-leak-runbook.md, CLAUDE.md</files>
  <action>
    1. Create `docs/security/secret-leak-runbook.md` covering:
       - **What the hook detected** — interpreting gitleaks output (rule ID, redacted match, file path, line).
       - **L1 fired (pre-commit blocked):**
         a. `git status` → identify the offending staged file.
         b. If the file is `.env*` → `git restore --staged .env*` and verify the path is in `.gitignore`.
         c. If the file is source code → unstage, move the secret to `.env` (gitignored), reference via `process.env.X`.
         d. Re-run `git commit`.
       - **L2 fired (pre-push blocked):**
         a. `git log <range>` to locate the offending commit.
         b. If the leak was just committed with `--no-verify` → `git reset --soft HEAD~1` and follow L1 flow.
         c. If the leak is older → **ROTATE THE SECRET FIRST**, then offer `git filter-repo` / `bfg-repo-cleaner` instructions with explicit warnings (force-push required, coordinate with collaborators).
       - **False positive triage:**
         a. Confirm the match is a known test placeholder.
         b. Add to `.gitleaks.toml` `allowlist.regexes` OR `allowlist.paths` (NEVER to `.gitleaksignore` for non-historical matches).
         c. Add a vitest assertion in `tools/lint-gitleaks-config.test.ts` so the allowlist entry is regression-protected.
       - **L3 fired (CI failed after push):**
         a. The secret IS on GitHub remote. ROTATE THE SECRET FIRST. Then history-clean if required.
       - **NEVER bypass with `--no-verify` + `--no-verify` push.** State this explicitly with the CLAUDE.md cross-reference.

    2. Append to `CLAUDE.md` `### Hard Rules (user-mandated, NON-NEGOTIABLE)` section:
       ```
       4. **NEVER bypass the gitleaks pre-commit / pre-push hooks.** `git commit --no-verify` and `git push --no-verify` are prohibited for any commit that adds or modifies files containing potential credential shapes. The hooks (lefthook pre-commit + pre-push using `.gitleaks.toml`) are defense-in-depth Layer 1 + 2; CI gitleaks-action (`.github/workflows/security.yml`) is Layer 3 — by the time CI fires, the secret is already on GitHub remote and ROTATION is mandatory. If a hook fires on a legitimate test placeholder, the fix is to extend `.gitleaks.toml` allowlist + add a regression assertion in `tools/lint-gitleaks-config.test.ts` — NEVER to bypass. Runbook: `docs/security/secret-leak-runbook.md`.
       ```

    3. Single atomic commit: `docs(260516-kya): add secret-leak runbook + CLAUDE.md Hard Rule #4`.

    NOTE: Per source-artifact language rule (English only for docs/comments/identifiers), the runbook and CLAUDE.md entry are English. The approved plan content in Russian is internal planning prose and does not propagate to runtime artefacts.
  </action>
  <verify>
    <automated>
      cd /Users/nick/openwhispr-server && \
      test -f docs/security/secret-leak-runbook.md && \
      grep -q "L1 fired" docs/security/secret-leak-runbook.md && \
      grep -q "L2 fired" docs/security/secret-leak-runbook.md && \
      grep -q "L3 fired" docs/security/secret-leak-runbook.md && \
      grep -q "NEVER bypass the gitleaks" CLAUDE.md && \
      grep -q "secret-leak-runbook.md" CLAUDE.md
    </automated>
  </verify>
  <done>
    - `docs/security/secret-leak-runbook.md` exists with all 4 firing scenarios (L1, L2, L3, false-positive triage).
    - CLAUDE.md Hard Rule #4 added with cross-reference to runbook.
    - One atomic commit lands both.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| developer workstation → git index | Staged diff crosses here on `git commit`; first chance to catch a secret pre-history. |
| local git history → GitHub remote | Push crosses here; last chance to catch a `--no-verify`-bypassed commit. |
| GitHub remote → CI runner | CI receives committed history; gitleaks-action is final safety net but secret is already on remote (rotation required if it fires). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-260516-kya-01 | I (Information Disclosure) | Staged diff at `git commit` | mitigate | L1 lefthook pre-commit `gitleaks protect --staged --redact --config=.gitleaks.toml`. Fails-closed on any sk-*/AKIA*/Bearer ey* shape. |
| T-260516-kya-02 | I (Information Disclosure) | Local history → remote push (covers `--no-verify` bypass) | mitigate | L2 lefthook pre-push `gitleaks detect --log-opts="@{u}..HEAD"`. Catches commits that escaped L1. |
| T-260516-kya-03 | I (Information Disclosure) | Pushed commit on GitHub | mitigate (residual) | L3 CI gitleaks-action with same `.gitleaks.toml`. Triggers rotation runbook on hit. |
| T-260516-kya-04 | T (Tampering) | `.gitleaks.toml` allowlist (could be weakened by a bad-faith PR to silently allow secrets) | mitigate | Allowlist is regression-tested via `tools/lint-gitleaks-config.test.ts` — adding a permissive entry without a matching test assertion drops coverage. Single source of truth referenced by all 3 layers prevents config-drift attack. |
| T-260516-kya-05 | E (Elevation of Privilege) | `tools/install-gitleaks.sh` downloading binary from internet | mitigate | Pin gitleaks release version + sha256 in the script; verify-then-extract. Argv-array invocations only (LOCKER-06). |
| T-260516-kya-06 | I | `.env` content surfacing in `git diff` / PR UI even without commit | mitigate | `.gitattributes` declares `.env* -diff` to suppress content rendering. |
| T-260516-kya-07 | R (Repudiation) | Operator bypasses with `--no-verify` and denies awareness | accept (low-cost residual) | CLAUDE.md Hard Rule #4 + runbook document the prohibition; L2 catches the bypass at push time anyway. |
</threat_model>

<verification>
End-to-end manual verification (operator runs once after merge):

1. `pnpm install` → `lefthook install` runs → `tools/install-gitleaks.sh` runs → `gitleaks version` returns ≥ v8.x.
2. `pnpm lint:gitleaks` against HEAD → 0 findings (no false positives on existing repo).
3. **Negative L1 test:**
   ```bash
   git checkout -b tmp-leak-test
   echo 'OPENAI_API_KEY="sk-proj-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKKKLLLLMMMMNNNN"' > tmp.txt
   git add tmp.txt && git commit -m "test"   # MUST be rejected by pre-commit
   ```
4. **Negative L2 test:** same file, `git commit --no-verify -m "test"` (passes L1), then `git push origin tmp-leak-test` → MUST be rejected by pre-push hook. Cleanup: `git checkout main && git branch -D tmp-leak-test`.
5. CI on a real PR: gitleaks-action log shows `--config-path .gitleaks.toml` resolved; 0 findings.
6. `pnpm test` remains green (no regressions on existing test fixtures).
</verification>

<success_criteria>
- All 3 tasks produce green automated verification.
- 5 atomic commits land on HEAD: (1) RED config test, (2) GREEN config+installer, (3) RED hook integration test, (4) GREEN hook+CI+bootstrap, (5) runbook+CLAUDE.md.
- Defense-in-depth confirmed: L1 catches staged leak, L2 catches `--no-verify` bypass before push, L3 (CI) uses same config.
- Zero false positives on current HEAD (`pnpm lint:gitleaks` exit 0).
- Single source of truth verified: `.gitleaks.toml` referenced by lefthook.yml AND security.yml AND package.json scripts.
- CLAUDE.md Hard Rule #4 added; runbook covers all 4 firing scenarios.
- No production code (apps/**/src/**, packages/**/src/**) modified.
</success_criteria>

<output>
After completion, no SUMMARY.md required (quick-mode task). The 5 atomic commits + this PLAN.md serve as the audit trail. Operator follow-up (recommended, NOT blocking):
- Rotate the 4 live keys in `.env` / `.env.bak` (OpenAI, OpenRouter, Groq, Tavily, pyannote) as a defense-in-depth precaution against snapshot tools (Time Machine, iCloud, IDE indexes) that may have captured them.
- Decide whether to delete `.env.bak` or keep it (it is gitignored either way).
</output>
