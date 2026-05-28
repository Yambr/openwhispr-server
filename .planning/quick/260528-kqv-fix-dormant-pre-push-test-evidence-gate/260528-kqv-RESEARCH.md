<!-- SPDX-License-Identifier: FSL-1.1-ALv2 -->

# Research — Fix dormant pre-push test-evidence gate (lefthook 2.1.8 file-detection skip)

**Researched:** 2026-05-28
**Domain:** lefthook 2.1.8 pre-push hook file-detection / skip semantics
**Confidence:** HIGH (root cause read from lefthook v2.1.8 Go source + empirically reproduced and fixed against the pinned binary)

## Summary

The `pre-push.commands.test-evidence` gate is **dormant**: lefthook 2.1.8 unconditionally skips ANY pre-push **command** whose `run` does not reference a file template (`{push_files}`/`{files}`/`{staged_files}`) whenever the push file-diff is empty — emitting `(skip) no matching push files`. This is hardcoded in lefthook's command builder for every `pre-push` hook; there is **no config key to disable it** (the orchestrator's `skip_empty: false` was a no-op because `skip_empty` is not a recognized key in lefthook 2.x — zero references in the v2.1.8 source). The only command-level escape is the `--force` CLI flag, which is unusable on a real `git push`. `2.1.8` is the latest release, so a version bump fixes nothing.

The fix is to **move the gate from `pre-push.commands.test-evidence` to a `pre-push` *script*** under `.lefthook/pre-push/`. Lefthook's script-build path (`buildScript`) never calls the push-files check, so scripts run on **every** push regardless of file diff. `use_stdin: true` composes with scripts exactly as it did with the command, and the script receives the Git pre-push stdin protocol unchanged — so the gate remains the sole stdin consumer and keeps reading commits (not files).

**Primary recommendation:** Replace the `test-evidence` *command* with a `test-evidence.sh` *script* (`.lefthook/pre-push/test-evidence.sh`) that `exec`s the existing validator, registered under `pre-push.scripts` with `runner: bash` + `use_stdin: true`. Verified empirically: runs on an empty-diff push AND correctly REFUSES a missing-evidence commit.

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| KQV-1 | Make the test-evidence gate run on EVERY push, immune to file-change detection | §Root Cause + §Recommended Fix — scripts bypass the `HookUsesPushFiles` skip entirely; proven empirically (§Empirical Verification, runs 1+4) |
| KQV-2 | Preserve `use_stdin: true` (sole stdin consumer reading the pre-push protocol) | §Recommended Fix — `use_stdin: true` is valid on `scripts`; the script received the exact `<local_ref> <local_sha> <remote_ref> <remote_sha>` line (§Empirical Verification, run 3) |
| KQV-3 | Minimal, robust fix; prefer config over version bump | §Options Ranked — version bump impossible (2.1.8 is latest); scripts is the only working mechanism and is a localized, self-documenting change |

---

## Root Cause (HIGH — read from lefthook v2.1.8 source)

`internal/run/controller/command/build_command.go` (tag `v2.1.8`), `buildCommand()`:

```go
// lines 47-49: command runs ONLY if forced or it produced non-empty file substitutions
if b.opts.Force || len(replacedFiles) != 0 {
    return commands, replacedFiles, nil
}
// ...
// lines 71-81: otherwise, for pre-push, skip when the push-file set is empty
if config.HookUsesPushFiles(b.opts.HookName) {        // true ONLY for "pre-push"
    files, err := replacer.Files(config.SubPushFiles, filter)
    if err != nil { return nil, nil, err }
    if len(files) == 0 {
        return nil, nil, SkipError{"no matching push files"}   // ← the skip
    }
}
```

- `config.HookUsesPushFiles` (`internal/config/available_hooks.go:46-47`) returns `true` **only** for `"pre-push"`. So this branch applies to every pre-push command.
- A command's `run` of `pnpm exec tsx tools/lint-pre-push-test-evidence.ts` references **no** file template → `replacedFiles` is empty → control falls through to line 72 → when the push diff is empty, the command is skipped. There is **no `glob`/`skip_empty`/`files` guard** on this branch.
- `[CITED: github.com/evilmartians/lefthook/blob/v2.1.8/internal/run/controller/command/build_command.go]`

**Why the push-file set is empty for this repo:** `internal/git/repo.go:197-213` `PushFiles()` runs `git diff --name-only HEAD @{push}`. When the local branch is in sync with its upstream (the current `main` ⟷ `origin/main` state), that diff is **empty** with exit 0 → `[]` files → skip. (When `@{push}` is unset on a brand-new branch, lefthook falls back to `git ls-tree`/`git diff HEAD <head-branch>`, which is the separate "new branch" failure mode documented in lefthook discussions #603/#909.) `[CITED: github.com/evilmartians/lefthook/blob/v2.1.8/internal/git/repo.go]`

**`skip_empty` is not a real key in lefthook 2.x.** A GitHub code search for `SkipEmpty` across the repo at v2.1.8 returns **zero** hits; the docs page `docs/configuration/skip_empty.md` is a **0-byte stub**. The orchestrator's `skip_empty: false` was silently ignored — confirmed empirically (run 2 below still skipped). `[VERIFIED: GitHub code search + raw docs fetch + local run]`

**Scripts use a different build path that has no push-files check.** `internal/run/controller/command/build_script.go` `buildScript()` only emits `SkipError` for `"no files for inspection"` (reached only when the script's *args* reference an empty file template) and `"not a regular file"` / script-not-found. It **never** calls `HookUsesPushFiles`. So a script always runs on pre-push regardless of the diff. `[CITED: github.com/evilmartians/lefthook/blob/v2.1.8/internal/run/controller/command/build_script.go]`

---

## Recommended Fix (HIGH — empirically verified end-to-end)

Convert the gate to a lefthook **script**.

### 1 — Create `.lefthook/pre-push/test-evidence.sh`

```bash
#!/usr/bin/env bash
# SPDX-License-Identifier: FSL-1.1-ALv2
# Quick 260528-kqv — pre-push test-evidence gate, SCRIPT form.
#
# Why a script, not a `pre-push.commands` entry: lefthook 2.1.8 skips
# every pre-push COMMAND whose `run` has no file template when the push
# file-diff is empty ("(skip) no matching push files",
# build_command.go:72-80). The gate validates COMMITS via the pre-push
# stdin protocol, not files, so it MUST run on every push. lefthook's
# SCRIPT build path (build_script.go) never applies the push-files
# skip, so this runs unconditionally. `use_stdin: true` (set in
# lefthook.yml) forwards the Git pre-push stdin protocol
# (<local_ref> <local_sha> <remote_ref> <remote_sha>) to the validator
# unchanged. This script is the sole pre-push stdin consumer.
set -euo pipefail
exec pnpm exec tsx tools/lint-pre-push-test-evidence.ts
```

Make it executable: `chmod +x .lefthook/pre-push/test-evidence.sh` (lefthook also auto-chmods it on first run, but commit it executable to be safe).

> `.lefthook/` is lefthook's default `source_dir`. The repo does not currently set `source_dir` and has no `.lefthook/` dir, so the default applies — no extra config needed. `[VERIFIED: grep source_dir lefthook.yml → none; ls .lefthook → absent]`

### 2 — Edit `lefthook.yml`: remove the `test-evidence` command, add a `scripts` block

Replace the existing `pre-push.commands.test-evidence:` entry (lines 125-142) with a `pre-push.scripts` entry. The `parallel: true` and the other two commands (`gitleaks`, `web-test`) stay unchanged.

```yaml
pre-push:
  parallel: true
  commands:
    gitleaks:
      run: bash -c '...'        # unchanged
    web-test:
      glob: "apps/web/**"        # unchanged
      run: pnpm --filter @openwhispr/web test:unit
  # Quick 260528-kqv — test-evidence gate moved from commands → scripts.
  # lefthook 2.1.8 skips pre-push COMMANDS with no file template when the
  # push diff is empty (build_command.go:72 "no matching push files");
  # scripts have no such skip (build_script.go), so this runs on EVERY
  # push. use_stdin: true forwards the pre-push stdin protocol unchanged;
  # this remains the SOLE pre-push stdin consumer (lefthook hard-limit).
  scripts:
    "test-evidence.sh":
      runner: bash
      use_stdin: true
      fail_text: |
        Pre-push test-evidence gate REFUSED.
        See docs/test-evidence-gate.md for recovery steps.
        --no-verify is constitutionally banned (CLAUDE.md hard-rule 4 — same
        posture as gitleaks).
```

> Run hooks re-sync (`lefthook install`, or any `git` hook invocation) so the `.git/hooks/pre-push` shim picks up the new script. The test in run 3 below already exercised this via `lefthook run pre-push` with `sync hooks: ✔️`.

### 3 — Update the regression test `tools/__tests__/lint-lefthook-stdin-config.test.ts`

The current test asserts `pre-push.commands.test-evidence.use_stdin === true` and `.run` matches the validator. After the move, the assertions must read from `pre-push.scripts["test-evidence.sh"]` instead. Concretely:

- `cmd = cfg["pre-push"]?.scripts?.["test-evidence.sh"]` (add a `scripts?: Record<string, LefthookCommand>` field to the `LefthookHook` interface — `runner?: string` too).
- Assert `cmd?.use_stdin === true` (deadlock guard — unchanged intent).
- Assert `cmd?.runner === "bash"` (replaces the `.run` validator-path assertion, since scripts use `runner` + the script file, not inline `run`). Optionally also assert the script file `.lefthook/pre-push/test-evidence.sh` exists and contains `lint-pre-push-test-evidence.ts`.
- The **single-stdin-consumer** test must broaden to count `use_stdin: true` across BOTH `pre-push.commands` AND `pre-push.scripts`, and assert the sole consumer is the `test-evidence.sh` script. This preserves the lefthook hard-limit invariant the original test pinned.
- Keep the `fail_text` → `/no-verify/` assertion (now on the script entry).

This is the only code change beyond `lefthook.yml` + the new script. Per CLAUDE.md TDD: update the test FIRST (RED — it will fail against the old command-based config), then make the `lefthook.yml` + script change (GREEN).

### 4 — Doc touch (optional, low-risk)

`docs/test-evidence-gate.md` §1 L2 row and §11 LOCKER-06 note reference `lefthook pre-push.commands.test-evidence`. Update the wording to `pre-push.scripts["test-evidence.sh"]` for accuracy. Not load-bearing for behavior.

---

## Empirical Verification (HIGH — run against the pinned 2.1.8 binary on this repo)

All runs used a synthetic pre-push stdin line piped to `pnpm exec lefthook run pre-push`. HEAD was `8a0c9e53…` (== `origin/main`, so `git diff HEAD @{push}` is empty — the exact dormant condition). Throwaway commit was `git reset --hard` back to HEAD; **final working tree confirmed clean, HEAD restored.**

| # | Setup | Command | Result |
|---|-------|---------|--------|
| 1 | **Current config (reproduce)** | `echo "refs/heads/main $H refs/heads/main $H" \| lefthook run pre-push` | `web-test`, `gitleaks`, `test-evidence` ALL → `(skip) no matching push files`. **Gate dormant — reproduced.** |
| 2 | **`skip_empty: false` added to the command** | same | `test-evidence (skip) no matching push files`. **No-op confirmed — `skip_empty` is not a real key.** |
| 3 | **Probe script** `.lefthook-probe/pre-push/probe.sh` (`use_stdin: true`) | same | `SCRIPT-RAN=yes` + `STDIN-RECEIVED<< refs/heads/main 8a0c9e… refs/heads/main 8a0c9e… >>END-STDIN`. **Scripts run on empty diff AND receive the stdin protocol.** |
| 4a | **Real validator via script**, push of already-on-remote SHA | same | `lint-pre-push-test-evidence: ✅ PASS across 22 projects on 0 commit(s). Push allowed.` (0 commits = F13 already-validated optimization — correct). **Gate ran, did not skip.** |
| 4b | **Real validator via script**, new-ref push of a throwaway empty commit with NO evidence (`remoteSha = 0…0`) | `echo "refs/heads/throwaway $NEW refs/heads/throwaway 0…0" \| …` | `lint-pre-push-test-evidence FAILED: 1 violation(s)` → `[missing-projects] sha=71ec28f… Missing projects: [api, web, …all 22…]` → **`exit status 1`**. **Gate is LIVE — refuses missing evidence.** |

Run 4b is the decisive proof: the script path both **runs** on an empty-file-diff push AND **enforces** the commit-level evidence contract.

---

## Options Ranked (robustness × minimalism)

| Rank | Option | Works? | Why / Why not |
|------|--------|--------|---------------|
| **1 (RECOMMENDED)** | Move gate to `pre-push.scripts["test-evidence.sh"]` + `use_stdin: true` | ✅ **Verified** | Only mechanism that bypasses the `HookUsesPushFiles` skip by design (`build_script.go` has no push-files check). Localized change (1 new script + 1 yaml edit + test update). Self-documenting. Preserves `use_stdin` and sole-consumer invariant. |
| 2 | `--force` CLI flag | ⚠️ N/A on real push | `lefthook run pre-push --force` works, but a real `git push` invokes the installed `.git/hooks/pre-push` shim with no `--force`. Not viable for the constitutional always-on gate. |
| 3 | `skip_empty: false` (command level) | ❌ **No-op** | Not a recognized key in lefthook 2.x (0 source refs; 0-byte docs stub). Empirically still skipped (run 2). |
| 4 | `files:`/`glob` trick on the command | ❌ **Still skips** | The push-files skip at `build_command.go:72` is unreachable to bypass unless `run` produces non-empty `replacedFiles`, which requires a file template — defeating the "validate commits not files" design. Empirically: `files: 'echo lefthook.yml'` still → `(skip) no matching push files` (run C2). |
| 5 | Bump lefthook to a patched version | ❌ **Nothing to bump to** | `2.1.8` (2026-05-19) is the **latest** release. CHANGELOG 2.1.5→2.1.8 contains no change to the pre-push empty-diff skip. PR #1368 (in 2.1.5) made lefthook itself parse pre-push stdin for `{push_files}` to fix a *separate* sha256-empty-tree bug — it does not remove the empty-diff skip and is irrelevant here. |

---

## Interaction Risk: lefthook itself reads pre-push stdin (MEDIUM)

PR #1368 ("use pre-push stdin for push file detection", shipped 2.1.5) made lefthook parse the pre-push stdin (`<local ref> <local oid> <remote ref> <remote oid>`) to compute `{push_files}` for new refs. This means lefthook and our validator both want the pre-push stdin. lefthook's `use_stdin: true` contract handles this: lefthook reads/buffers stdin and forwards it to the single `use_stdin` consumer. **Empirically (run 3), with `use_stdin: true` on the script, the script received the full, intact stdin protocol** — so there is no observed contention in 2.1.8. The single-consumer invariant (only ONE pre-push entry may set `use_stdin: true`) remains MANDATORY and is preserved by the recommended fix. `[VERIFIED: run 3 stdin echo]` `[CITED: github.com/evilmartians/lefthook/pull/1368]`

---

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---------|-------------|-------------|-----|
| Force a pre-push step to always run | A custom `.git/hooks/pre-push` shim or a `commands.run` that fakes a file list | lefthook `pre-push.scripts` | lefthook owns the hook shim + stdin forwarding + sync; a hand-rolled shim would be clobbered by `lefthook install` and would break the single-stdin-consumer guarantee. |
| Read the pre-push protocol | Re-parse `git diff`/`git rev-list` in the hook | The existing `tools/lint-pre-push-test-evidence.ts` stdin parser | It already implements the full protocol (tip-only, null-SHA deletion, new-ref, F13 already-validated) with tests. The fix only changes HOW lefthook invokes it, not the validator. |

---

## Common Pitfalls

### Pitfall 1: Treating `skip_empty` as a real key
**What goes wrong:** Adding `skip_empty: false` and assuming it disabled the skip. **Why:** It is not a lefthook 2.x key — silently ignored. **Avoid:** Use the scripts mechanism. **Warning sign:** `(skip) no matching push files` still appears.

### Pitfall 2: Forgetting to re-sync hooks after the edit
**What goes wrong:** The `.git/hooks/pre-push` shim is generated; moving command→script needs a hook re-sync. **Avoid:** Run `pnpm exec lefthook install` (or let any git hook fire — lefthook auto-syncs, shown as `sync hooks: ✔️`). **Warning sign:** old behavior persists on a real push.

### Pitfall 3: Leaving the script non-executable / wrong `runner`
**What goes wrong:** Script not a regular executable file → `SkipError{"not a regular file"}` (`build_script.go:65`), silently skipping. **Avoid:** `chmod +x` + commit executable; set `runner: bash`. **Warning sign:** `(skip) script is not a regular file` or `script does not exist`.

### Pitfall 4: Two pre-push stdin consumers
**What goes wrong:** If a second pre-push command/script ever sets `use_stdin: true`, lefthook's single-consumer limit breaks the gate. **Avoid:** The broadened regression test (step 3) asserts exactly one `use_stdin: true` across commands+scripts. **Warning sign:** deadlock or empty stdin in the validator.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `.lefthook/` default `source_dir` works without an explicit `source_dir:` key in this repo | Recommended Fix §1 | LOW — verified the probe script ran from an in-repo source dir (run 3); default source_dir is `.lefthook` per lefthook docs. If a real push fails to find the script, add `source_dir: ".lefthook"` explicitly. |

*(All other claims are VERIFIED against the v2.1.8 source/binary or CITED to lefthook docs/PRs.)*

## Open Questions

1. **Does a real `git push` (vs `lefthook run pre-push`) forward stdin identically to the script?**
   - What we know: `lefthook run pre-push` with piped stdin + `use_stdin: true` forwarded the protocol intact to both a probe script (run 3) and the real validator (run 4). The `.git/hooks/pre-push` shim is the same lefthook binary.
   - What's unclear: a 100% real `git push origin <branch>` to a remote was not exercised (would create a real remote ref).
   - Recommendation: After landing, the executor should do one real push of a branch that is in sync with its upstream (the dormant condition) and confirm the gate runs — e.g., push a no-op branch, or push the fix branch itself and watch for the `lint-pre-push-test-evidence: ✅ PASS` / refusal line. This is the final acceptance check.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x (root `vitest.config.ts`, `tools` project) |
| Config file | `vitest.config.ts` (inline `tools` project) |
| Quick run command | `pnpm exec vitest run tools/__tests__/lint-lefthook-stdin-config.test.ts` |
| Full suite command | `pnpm test:all` (writes 22 evidence fragments per HEAD) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| KQV-1 | Gate runs on every push (no file-diff dependency) | manual/integration | real `git push` of an in-sync branch → expect gate output, not `(skip)` | ❌ (manual acceptance — see Open Q1) |
| KQV-2 | `use_stdin: true` preserved; sole consumer | unit (yaml-shape) | `pnpm exec vitest run tools/__tests__/lint-lefthook-stdin-config.test.ts` | ✅ (update for scripts path — step 3) |
| KQV-3 | Validator behavior unchanged | unit | existing `tools/__tests__/lint-pre-push-test-evidence*.test.ts` | ✅ (no validator code change) |

### Sampling Rate
- **Per task commit:** `pnpm exec vitest run tools/__tests__/lint-lefthook-stdin-config.test.ts`
- **Per wave merge / phase gate:** `pnpm test:all` green (also regenerates evidence for the gate itself).

### Wave 0 Gaps
- [ ] Update `tools/__tests__/lint-lefthook-stdin-config.test.ts` to read `pre-push.scripts["test-evidence.sh"]` (interface needs `scripts` + `runner` fields), assert `use_stdin`, `runner: bash`, `fail_text` /no-verify/, and broaden the single-consumer check across commands+scripts. (RED-first per TDD.)

---

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | Validator already validates pushed SHAs as 40-hex from stdin; unchanged by this fix. |
| V6 Cryptography | no | — |

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Bypass of evidence gate via dormant skip | Repudiation / Tampering | The fix itself closes the bypass: scripts run unconditionally. `--no-verify` remains constitutionally banned (CLAUDE.md hard-rule 4). |
| Shell credential interpolation in hook | Information disclosure | LOCKER-06 — the script `exec`s `pnpm exec tsx …` directly with no `*_URL/*_KEY/*_TOKEN` interpolation; argv form, `set -euo pipefail`. Compliant. |

---

## Sources

### Primary (HIGH confidence)
- `github.com/evilmartians/lefthook/blob/v2.1.8/internal/run/controller/command/build_command.go` — the `HookUsesPushFiles` skip (lines 47-81); `SkipError{"no matching push files"}`.
- `github.com/evilmartians/lefthook/blob/v2.1.8/internal/run/controller/command/build_script.go` — `buildScript` has no push-files check (the fix's basis).
- `github.com/evilmartians/lefthook/blob/v2.1.8/internal/config/available_hooks.go` — `HookUsesPushFiles` true only for `pre-push` (lines 46-47).
- `github.com/evilmartians/lefthook/blob/v2.1.8/internal/git/repo.go` — `PushFiles()` uses `git diff --name-only HEAD @{push}` (lines 196-213).
- Local empirical runs against `lefthook 2.1.8` (pinned in `package.json`) — reproduction + verified scripts fix (§Empirical Verification).
- lefthook docs (master): `docs/configuration/run.md`, `glob.md`, `files.md`, `files-global.md`, `skip.md` — file templates, glob filtering, skip semantics. (`skip_empty.md` is a 0-byte stub.)

### Secondary (MEDIUM confidence)
- `github.com/evilmartians/lefthook/pull/1368` — pre-push stdin used for `{push_files}` (sha256 empty-tree fix; informs the stdin-contention risk note).
- lefthook CHANGELOG (master) — confirms 2.1.8 is latest; no relevant empty-diff-skip change.
- GitHub Discussions [#603](https://github.com/evilmartians/lefthook/discussions/603) and [#909](https://github.com/evilmartians/lefthook/discussions/909) — maintainer-confirmed "no matching push files" root cause + lack of a config toggle.

## Metadata

**Confidence breakdown:**
- Root cause: HIGH — read from v2.1.8 source and reproduced locally.
- Recommended fix: HIGH — verified end-to-end (runs on empty diff AND refuses missing evidence).
- stdin-contention risk: MEDIUM — no contention observed in 2.1.8 with `use_stdin: true`; real-push acceptance check recommended.

**Research date:** 2026-05-28
**Valid until:** 2026-06-28 (lefthook is at the pinned 2.1.8; revisit only on a deliberate lefthook bump)
