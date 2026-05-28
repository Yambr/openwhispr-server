<!-- SPDX-License-Identifier: FSL-1.1-ALv2 -->
---
phase: 260528-kqv
plan: 01
subsystem: tooling / git-hooks
tags: [lefthook, pre-push, test-evidence-gate, tdd, locker-06]
requires: [tools/lint-pre-push-test-evidence.ts]
provides: [.lefthook/pre-push/test-evidence.sh, pre-push.scripts gate]
affects: [lefthook.yml, docs/test-evidence-gate.md]
tech-stack:
  added: []
  patterns: [lefthook scripts (source_dir .lefthook), pre-push stdin protocol via use_stdin]
key-files:
  created: [.lefthook/pre-push/test-evidence.sh]
  modified: [lefthook.yml, tools/__tests__/lint-lefthook-stdin-config.test.ts, docs/test-evidence-gate.md]
decisions:
  - "Gate moved command → script: lefthook 2.1.8 file-skips empty-diff pre-push COMMANDS; scripts have no such skip (#57)."
  - "use_stdin: true preserved on the script; single-consumer invariant broadened to scan commands AND scripts."
metrics:
  duration: ~6 min
  completed: 2026-05-28
requirements: [KQV-1, KQV-2, KQV-3]
---

# Phase 260528-kqv Plan 01: Fix dormant pre-push test-evidence gate Summary

Moved the constitutional v1.0.12 pre-push test-evidence gate from a lefthook `pre-push.commands` entry (which lefthook 2.1.8 silently file-skips on an empty push diff, leaving the gate DORMANT) to an executable `pre-push.scripts['test-evidence.sh']` script that runs on EVERY push regardless of file diff — closing the bypass (#57) with a minimal config-only change, validator code untouched.

## What changed

- **Created `.lefthook/pre-push/test-evidence.sh`** (mode 100755) — bash, `set -euo pipefail`, `exec pnpm exec tsx tools/lint-pre-push-test-evidence.ts` in argv form (LOCKER-06 compliant: no `*_URL/*_KEY/*_TOKEN` interpolation). Header comment documents WHY a script (lefthook 2.1.8 `build_command.go:72-80` empty-diff skip; `build_script.go` has no such skip; #57) and that it is the sole pre-push stdin consumer.
- **Rewired `lefthook.yml`** — deleted `pre-push.commands.test-evidence` (+ its comment block); added `pre-push.scripts['test-evidence.sh']` with `runner: bash`, `use_stdin: true`, and the verbatim `fail_text` REFUSED block. `pre-push.commands.gitleaks` and `pre-push.commands.web-test` left untouched. Comment block adapted to cite #57.
- **Rewrote `tools/__tests__/lint-lefthook-stdin-config.test.ts`** (TDD RED-first) — `LefthookCommand` gains `runner?`, `LefthookHook` gains `scripts?`; reads `pre-push.scripts['test-evidence.sh']` and asserts `use_stdin===true`, `runner==="bash"`, `fail_text` matches `/no-verify/`; broadened single-stdin-consumer check to scan BOTH `pre-push.commands` AND `pre-push.scripts` (exactly ONE `use_stdin:true` entry, sole consumer `test-evidence.sh`). The unrelated `vitest-reporter-inheritance` block preserved verbatim.
- **Updated `docs/test-evidence-gate.md`** — L2 row + LOCKER-06 note now reference the script path `.lefthook/pre-push/test-evidence.sh` with the one-line WHY (lefthook commands skip on empty push diff, #57).

The validator `tools/lint-pre-push-test-evidence.ts` is unchanged — only HOW lefthook invokes it changed. No chart/appVersion/runtime change.

## TDD cycle (RED → GREEN, same atomic commit)

- **RED** — rewritten test against the still-command-based `lefthook.yml`: `5 failed | 3 passed` (the 3 passing are the unrelated `vitest-reporter-inheritance` block). The `pre-push.scripts['test-evidence.sh']` lookup was `undefined`; single-consumer key was `test-evidence` not `test-evidence.sh`.
- **GREEN** — after creating the script + rewiring `lefthook.yml`: `8 passed (8)`.

## Empirical verification (KQV-1 acceptance proof — verbatim)

Synthetic empty-file-diff push (`<local_ref> <local_sha> <remote_ref> <remote_sha>` with the same sha twice, built from the worktree's own HEAD — the exact dormant condition: local ⟷ "remote" in sync, `git diff HEAD @{push}` empty).

**RUN A — HEAD~1 (base `e2d57af1`, HAS evidence fragments) → PASS:**

```
lint-pre-push-test-evidence: ✅ PASS across 22 projects on 1 commit(s). Push allowed.
✔️ test-evidence.sh (0.62 seconds)
```

**RUN B — HEAD (`00f342dc`, the fix commit, NO evidence fragments) → REFUSE:**

```
lint-pre-push-test-evidence FAILED: 1 violation(s) on push:
  [missing-projects] sha=00f342dc814d82b71f888ca175041c7c74424e28 No test evidence for commit 00f342dc814d82b71f888ca175041c7c74424e28. Missing projects: [api, web, worker, @openwhispr/byok-guard, @openwhispr/contract-tests, data, @openwhispr/email, @openwhispr/litellm-client, load-test, test-probe, mock-litellm, e2e, mock-realtime, @openwhispr/auth-stub, @openwhispr/i18n-stub, @openwhispr/observability, @openwhispr/wire-schemas, tools, tests-e2e-cjm-steps, tests-e2e-cjm-support, tests-integration, tests-self-tests]. Run pnpm test:all (or pnpm test:evidence) to regenerate.
remediation: see docs/test-evidence-gate.md. `git push --no-verify` is BANNED (CLAUDE.md hard-rule 4).
🥊 test-evidence.sh: Pre-push test-evidence gate REFUSED.
```

**For comparison, the file-globbed `web-test` COMMAND still correctly skips on the same empty diff** (`web-test (skip) no matching push files`), proving the script path bypasses the very skip that dormant-ed the gate.

**Both runs print the gate's ACTUAL output (PASS or REFUSED), NOT `(skip) no matching push files`.** EITHER non-skip output proves the gate RAN. Run B (REFUSE on missing evidence) is the decisive proof that the gate is LIVE on an empty-file-diff push. KQV-1 satisfied.

> Note: pushing the fix commit `00f342dc` itself requires regenerating its 22 evidence fragments via `pnpm test:all` first (Run B shows the gate correctly refusing until then) — `--no-verify` is constitutionally banned (CLAUDE.md hard-rule 4). That is the operator's pre-push step, out of scope for this config fix.

## Requirements

- **KQV-1** (gate runs on every push, file-diff-immune) — DONE, empirically proven above.
- **KQV-2** (`use_stdin: true` preserved, sole consumer) — DONE; regression test broadened across commands+scripts, asserts exactly one `use_stdin:true` entry = `test-evidence.sh`.
- **KQV-3** (minimal config-only fix, no version bump) — DONE; 1 new script + lefthook.yml edit + test + docs; validator unchanged; no chart/appVersion/runtime change.

## Deviations from Plan

None — plan executed exactly as written. RED→GREEN landed in a single atomic commit. No deferred items, no throwaway commits.

## Commit

- `00f342dc` — `fix(tools): pre-push test-evidence gate runs as script so it fires on every push (#57)` (4 files, 85 insertions, 34 deletions; `.lefthook/pre-push/test-evidence.sh` created as mode 100755). Pre-commit hooks (gitleaks, english, biome) + commit-msg commitlint all GREEN; no `--no-verify`.

## Verification state

- `git diff HEAD~1 HEAD --diff-filter=D` (deletions): none.
- `git ls-files -s .lefthook/pre-push/test-evidence.sh`: `100755 …` (executable — lefthook will not skip it as "not a regular file").
- `tools/lint-pre-push-test-evidence.ts` NOT in the diff (validator unchanged).
- No chart/appVersion/values.yaml in the diff.
- Working tree CLEAN; HEAD == `00f342dc` (the fix commit). No throwaway commits remain.

## Self-Check: PASSED

- FOUND: `.lefthook/pre-push/test-evidence.sh` (committed mode 100755)
- FOUND: `lefthook.yml` `pre-push.scripts['test-evidence.sh']`
- FOUND: `tools/__tests__/lint-lefthook-stdin-config.test.ts` (scripts-path assertions, GREEN 8/8)
- FOUND: `docs/test-evidence-gate.md` (L2 row + LOCKER-06 note updated)
- FOUND: commit `00f342dc` on HEAD
