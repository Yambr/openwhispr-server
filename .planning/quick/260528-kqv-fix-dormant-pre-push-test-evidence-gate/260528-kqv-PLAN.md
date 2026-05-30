<!-- SPDX-License-Identifier: FSL-1.1-ALv2 -->
---
phase: 260528-kqv
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .lefthook/pre-push/test-evidence.sh
  - lefthook.yml
  - tools/__tests__/lint-lefthook-stdin-config.test.ts
  - docs/test-evidence-gate.md
autonomous: true
requirements: [KQV-1, KQV-2, KQV-3]

must_haves:
  truths:
    - "The test-evidence gate runs on EVERY `git push`, including a push with an empty file-diff (the dormant condition where local branch is in sync with its upstream)."
    - "A `pnpm exec lefthook run pre-push` against an in-sync HEAD prints the gate's actual output (PASS or REFUSE), NOT `(skip) no matching push files`."
    - "`use_stdin: true` is preserved on the gate and the gate remains the SOLE pre-push entry (command OR script) that consumes stdin."
    - "The validator `tools/lint-pre-push-test-evidence.ts` is unchanged — only HOW lefthook invokes it changes."
    - "The regression test asserts the gate now lives at `pre-push.scripts['test-evidence.sh']` with `use_stdin: true`, `runner: bash`, and a `fail_text` mentioning the --no-verify ban."
  artifacts:
    - path: ".lefthook/pre-push/test-evidence.sh"
      provides: "Executable bash script that execs the validator unconditionally on pre-push"
      contains: "lint-pre-push-test-evidence.ts"
      mode: "100755"
    - path: "lefthook.yml"
      provides: "pre-push.scripts['test-evidence.sh'] entry; pre-push.commands.test-evidence DELETED"
      contains: "scripts"
    - path: "tools/__tests__/lint-lefthook-stdin-config.test.ts"
      provides: "Regression test pinning the script-based config + single-stdin-consumer invariant across commands AND scripts"
      contains: "scripts"
    - path: "docs/test-evidence-gate.md"
      provides: "L2 row + LOCKER-06 note updated to the script path with a one-line WHY"
      contains: "test-evidence.sh"
  key_links:
    - from: "lefthook.yml pre-push.scripts['test-evidence.sh']"
      to: ".lefthook/pre-push/test-evidence.sh"
      via: "lefthook default source_dir (.lefthook) resolves the script by name; runner: bash"
      pattern: "test-evidence\\.sh"
    - from: ".lefthook/pre-push/test-evidence.sh"
      to: "tools/lint-pre-push-test-evidence.ts"
      via: "exec pnpm exec tsx (argv form, no credential interpolation)"
      pattern: "lint-pre-push-test-evidence\\.ts"
    - from: "lefthook pre-push stdin (Git protocol)"
      to: ".lefthook/pre-push/test-evidence.sh"
      via: "use_stdin: true forwards <local_ref> <local_sha> <remote_ref> <remote_sha>"
      pattern: "use_stdin"
---

<objective>
The constitutional v1.0.12 pre-push test-evidence gate is DORMANT: lefthook 2.1.8 skips any pre-push COMMAND with no file template when the push file-diff is empty (`build_command.go:72-80` → `SkipError "no matching push files"`). `HookUsesPushFiles` is hardcoded `true` for pre-push and there is NO config key to disable it (`skip_empty` is not a real lefthook 2.x key). 2.1.8 is already latest, so a version bump fixes nothing.

This plan moves the gate from `pre-push.commands.test-evidence` to a `pre-push.scripts['test-evidence.sh']` entry. lefthook SCRIPTS (`build_script.go`) never apply the push-files skip, so they run on EVERY push. `use_stdin: true` composes with scripts and forwards the exact pre-push stdin protocol unchanged.

Purpose: Close the dormant-gate bypass (KQV-1) so the test-evidence contract fires on every push, while preserving the `use_stdin: true` sole-consumer invariant (KQV-2) with a minimal, config-only fix (KQV-3).

Output: A new executable `.lefthook/pre-push/test-evidence.sh` script, the rewired `lefthook.yml`, an updated RED-first regression test, and corrected docs — landed as a single atomic commit.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/quick/260528-kqv-fix-dormant-pre-push-test-evidence-gate/260528-kqv-RESEARCH.md
@./CLAUDE.md
@lefthook.yml
@tools/lint-pre-push-test-evidence.ts
@tools/__tests__/lint-lefthook-stdin-config.test.ts
@docs/test-evidence-gate.md

<interfaces>
<!-- The validator stays UNCHANGED. It already reads the pre-push protocol from stdin
     and validates the TIP commit of each pushed ref. The plan only changes how
     lefthook invokes it (command → script). -->

From tools/lint-pre-push-test-evidence.ts (DO NOT MODIFY):
- Reads stdin lines of shape `<local_ref> <local_sha> <remote_ref> <remote_sha>`.
- exit 0 = push allowed (also `GITHUB_ACTIONS=true`/`CI=true` bypass); exit 1 = refused; exit 2 = internal error.
- On PASS prints to stderr: `lint-pre-push-test-evidence: ✅ PASS across <N> projects on <M> commit(s). Push allowed.`
- On REFUSE prints to stderr: `lint-pre-push-test-evidence FAILED: <N> violation(s) on push:` + per-violation lines.

From lefthook.yml CURRENT shape (pre-push.commands.test-evidence — to be DELETED, lines 125-142):
```yaml
    test-evidence:
      use_stdin: true
      run: pnpm exec tsx tools/lint-pre-push-test-evidence.ts
      fail_text: |
        Pre-push test-evidence gate REFUSED.
        See docs/test-evidence-gate.md for recovery steps.
        --no-verify is constitutionally banned (CLAUDE.md hard-rule 4 — same
        posture as gitleaks).
```
The `pre-push.commands.gitleaks` and `pre-push.commands.web-test` entries STAY untouched.
`.lefthook/` does not exist yet — it is lefthook's default `source_dir`; creating it requires no `source_dir:` config key.

From tools/__tests__/lint-lefthook-stdin-config.test.ts CURRENT shape:
- `LefthookHook` interface has `commands?: Record<string, LefthookCommand>` only — needs `scripts?` + `LefthookCommand` needs `runner?`.
- The `describe("pre-push.commands.test-evidence")` block reads `cfg["pre-push"]?.commands?.["test-evidence"]`.
- The `describe("single-stdin-consumer constraint")` block scans only `pre-push.commands`.
- The `describe("pre-commit.commands.vitest-reporter-inheritance")` block is UNRELATED — leave it intact.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED — rewrite the lefthook config regression test for the scripts path</name>
  <files>tools/__tests__/lint-lefthook-stdin-config.test.ts</files>
  <behavior>
    After this rewrite the test FAILS against the current command-based lefthook.yml (RED), and will pass once Task 2 lands the script-based config (GREEN). New/updated assertions:
    - The `LefthookCommand` interface gains `runner?: string`; the `LefthookHook` interface gains `scripts?: Record<string, LefthookCommand>`.
    - `pre-push.scripts['test-evidence.sh']` is defined (replaces the `pre-push.commands.test-evidence` lookup).
    - That script entry has `use_stdin === true` (deadlock guard — unchanged intent).
    - That script entry has `runner === "bash"` (replaces the old `.run` validator-path assertion; scripts use `runner` + the script file, not inline `run`).
    - That script entry has a `fail_text` matching `/no-verify/`.
    - Single-stdin-consumer invariant broadened: count entries with `use_stdin === true` across BOTH `pre-push.commands` AND `pre-push.scripts`; assert the total is exactly one and the sole consumer is `test-evidence.sh`.
    - The unrelated `pre-commit.commands.vitest-reporter-inheritance` block is preserved verbatim.
  </behavior>
  <action>
    Update the file docblock to describe the scripts-based assertions (Quick 260528-kqv; cite #57: lefthook commands get file-skipped on empty push diff). Add `runner?: string` to `LefthookCommand` and `scripts?: Record<string, LefthookCommand>` to `LefthookHook`. Replace the `describe("pre-push.commands.test-evidence")` block with a `describe("pre-push.scripts test-evidence.sh")` block that reads `cfg["pre-push"]?.scripts?.["test-evidence.sh"]` and asserts: defined, `use_stdin === true`, `runner === "bash"`, `fail_text` matches `/no-verify/`. Rewrite the `describe("single-stdin-consumer constraint")` block so it merges entries from `pre-push.commands` and `pre-push.scripts`, filters for `use_stdin === true`, asserts `length === 1`, and asserts the sole consumer key is `test-evidence.sh`. Keep the `pre-commit.commands.vitest-reporter-inheritance` describe block unchanged. English-only; no type-suppression (no `as any` / `@ts-ignore`).
    Do NOT use a fenced verification command that mutates anything — this is a test-only edit.
  </action>
  <verify>
    <automated>pnpm exec vitest run tools/__tests__/lint-lefthook-stdin-config.test.ts 2>&1 | tail -25</automated>
  </verify>
  <done>The rewritten test reads `pre-push.scripts['test-evidence.sh']` and the single-consumer check scans commands+scripts. Run against the still-command-based lefthook.yml it FAILS (RED) — the `pre-push.scripts` lookup is undefined. The `vitest-reporter-inheritance` block still passes. (Task 2 turns this GREEN within the same atomic commit.)</done>
</task>

<task type="auto">
  <name>Task 2: GREEN — add the pre-push script, rewire lefthook.yml, update docs</name>
  <files>.lefthook/pre-push/test-evidence.sh, lefthook.yml, docs/test-evidence-gate.md</files>
  <action>
    1. Create `.lefthook/pre-push/test-evidence.sh` (the `.lefthook/` dir does not exist yet — create it; it is lefthook's default `source_dir`, no `source_dir:` key needed). Shebang `#!/usr/bin/env bash`, the FSL-1.1-ALv2 SPDX header short-form comment, then a comment block explaining WHY a script not a command: lefthook 2.1.8 skips every pre-push COMMAND whose `run` has no file template when the push file-diff is empty (`build_command.go:72-80` "no matching push files", #57); the gate validates COMMITS via the pre-push stdin protocol not files, so it MUST run on every push; lefthook's SCRIPT build path never applies the push-files skip; `use_stdin: true` (set in lefthook.yml) forwards the Git pre-push stdin protocol unchanged; this script is the sole pre-push stdin consumer. Then `set -euo pipefail` and `exec pnpm exec tsx tools/lint-pre-push-test-evidence.ts`. Use argv form (LOCKER-06: no `*_URL/*_KEY/*_TOKEN` interpolation). After writing, `chmod +x .lefthook/pre-push/test-evidence.sh` so it commits as file mode 100755 (lefthook `SkipError "not a regular file"` if non-executable).

    2. Edit `lefthook.yml`: DELETE the entire `pre-push.commands.test-evidence` entry (its leading comment block lines 125-134 AND the `test-evidence:` entry lines 135-142). Leave `pre-push.commands.gitleaks` and `pre-push.commands.web-test` untouched. ADD a `pre-push.scripts` section (sibling of `pre-push.commands`, same indentation under `pre-push:`) with a leading comment block (adapt the deleted comment: the `use_stdin` deadlock/sole-consumer rationale still applies; ADD a note that it is a SCRIPT not a command BECAUSE lefthook commands get file-skipped on an empty push diff — cite #57). The script entry key is `"test-evidence.sh":` with `runner: bash`, `use_stdin: true`, and the existing multi-line `fail_text` block (the "Pre-push test-evidence gate REFUSED…" text verbatim). Per #57 KQV-1, the gate must run MORE (every push), never less — do not weaken it.

    3. Edit `docs/test-evidence-gate.md`: update the L2 row (line 17) reference `lefthook \`pre-push.commands.test-evidence\`` → `lefthook \`pre-push.scripts['test-evidence.sh']\` (script .lefthook/pre-push/test-evidence.sh)` and append a one-line WHY note: it is a script because lefthook commands get file-skipped on an empty push diff (#57). Update the LOCKER-06 note (line 306) reference `\`lefthook.yml\` runs \`pnpm exec tsx tools/lint-pre-push-test-evidence.ts\` directly` to reflect the script path (`.lefthook/pre-push/test-evidence.sh` execs `pnpm exec tsx tools/lint-pre-push-test-evidence.ts` via argv form). English-only.

    Do NOT modify `tools/lint-pre-push-test-evidence.ts`. Do NOT bump the chart, appVersion, or any runtime artifact — this is a tooling/config fix only.
  </action>
  <verify>
    <automated>chmod +x .lefthook/pre-push/test-evidence.sh; test -x .lefthook/pre-push/test-evidence.sh && echo "EXECUTABLE-OK" && pnpm exec vitest run tools/__tests__/lint-lefthook-stdin-config.test.ts 2>&1 | tail -15 && echo "---EMPIRICAL-EMPTY-DIFF-PUSH---" && H=$(git rev-parse HEAD); echo "refs/heads/main $H refs/heads/main $H" | pnpm exec lefthook run pre-push 2>&1 | grep -i "test-evidence"</automated>
  </verify>
  <done>The regression test from Task 1 is now GREEN (`pre-push.scripts['test-evidence.sh']` resolves; single-consumer check passes). The script is executable (mode 100755). The empirical empty-diff run prints the gate's ACTUAL output (a `lint-pre-push-test-evidence: ✅ PASS …` line if HEAD has evidence fragments, OR a `lint-pre-push-test-evidence FAILED …`/REFUSED line if not — EITHER non-skip output proves the gate RAN) and does NOT print `(skip) no matching push files`. The executor MUST paste this empirical output verbatim into the SUMMARY (KQV-1 acceptance proof). No throwaway commits left behind (HEAD == origin/main, no commit needed; if any throwaway commit was used, `git reset --hard origin/main` after).</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| developer git push → lefthook pre-push hook | A developer pushing commits crosses into the evidence-gate enforcement point. The dormant skip is a bypass of this boundary. |
| Git pre-push stdin → validator | Untrusted ref/SHA tuples enter the validator via stdin; the validator already validates 40-hex SHA shape (V5, unchanged). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-kqv-01 | Repudiation/Tampering | pre-push test-evidence gate (dormant skip) | mitigate | THIS FIX: move gate command→script so it runs on every push regardless of file-diff. Empirically verified (Task 2 verify) the gate no longer emits `(skip) no matching push files`. |
| T-kqv-02 | Tampering | a second pre-push stdin consumer | mitigate | Broadened single-stdin-consumer regression test (Task 1) scans BOTH `pre-push.commands` and `pre-push.scripts`; asserts exactly one `use_stdin: true` entry (`test-evidence.sh`). Two consumers would deadlock/starve the gate. |
| T-kqv-03 | Information disclosure | shell credential interpolation in the hook (LOCKER-06) | mitigate | Script `exec`s `pnpm exec tsx …` in argv form with `set -euo pipefail`; no `*_URL/*_KEY/*_PASSWORD/*_SECRET/*_TOKEN` interpolation. Compliant. |
| T-kqv-04 | Elevation/Bypass | `git push --no-verify` to skip the now-live gate | accept | Constitutionally banned (CLAUDE.md hard-rule 4); out of scope for this fix. Deferred L3 CI validator catches remote-side bypass. |
| T-kqv-05 | Tampering | non-executable script silently skipped (`SkipError "not a regular file"`) | mitigate | Task 2 `chmod +x` + commit as mode 100755; Task 2 verify asserts `test -x`. Regression test optionally asserts the script file exists. |
</threat_model>

<verification>
- `pnpm exec vitest run tools/__tests__/lint-lefthook-stdin-config.test.ts` — GREEN after Task 2 (RED after Task 1 against the old config).
- Empirical empty-diff acceptance (KQV-1): `H=$(git rev-parse HEAD); echo "refs/heads/main $H refs/heads/main $H" | pnpm exec lefthook run pre-push 2>&1 | grep -i "test-evidence"` prints a NON-skip line (PASS or REFUSED). BEFORE the fix this prints `test-evidence (skip) no matching push files`.
- `test -x .lefthook/pre-push/test-evidence.sh` — script is executable (committed mode 100755).
- `git diff --stat` confirms only the four declared files changed; `tools/lint-pre-push-test-evidence.ts` is NOT in the diff; no chart/appVersion change.
- Recommended (Open Q1, post-land): one real `git push` of an in-sync branch confirms the `.git/hooks/pre-push` shim runs the gate (not just `lefthook run`).
</verification>

<success_criteria>
- The gate runs on EVERY push including an empty-file-diff push — proven by the empirical `lefthook run pre-push` producing non-skip gate output (KQV-1).
- `use_stdin: true` preserved; the gate is the sole pre-push stdin consumer across commands AND scripts, regression-locked (KQV-2).
- Minimal config-only fix: 1 new script + lefthook.yml edit + test + docs; validator code unchanged; no version bump; no runtime/chart change (KQV-3).
- Single atomic commit: `fix(tools): pre-push test-evidence gate runs as script so it fires on every push (#57)` covering lefthook.yml + `.lefthook/pre-push/test-evidence.sh` + test + docs together.
- Constitutional: English-only, no type-suppression, no `--no-verify`; TDD RED (Task 1) → GREEN (Task 2) in the same atomic commit; pre-push test-evidence gate must itself pass on the commit (run `pnpm test:all` to regenerate HEAD evidence fragments before pushing this fix).
</success_criteria>

<output>
After completion, create `.planning/quick/260528-kqv-fix-dormant-pre-push-test-evidence-gate/260528-kqv-SUMMARY.md`.
The SUMMARY MUST paste the verbatim output of the empirical empty-diff `lefthook run pre-push | grep test-evidence` command (KQV-1 acceptance proof) and confirm no throwaway commits remain (working tree clean, HEAD == origin/main).
</output>
