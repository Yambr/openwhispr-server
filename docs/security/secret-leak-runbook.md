# Secret-Leak Runbook

> **Operator-facing.** When the gitleaks gate fires, follow this runbook. Do NOT bypass with `--no-verify`.

This document covers the three layers of the defense-in-depth secret-leak
gate landed in `260516-kya-PLAN.md` and what to do when each fires.

| Layer  | Where                                       | When it fires                                | What it stops                                                              |
| ------ | ------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| **L1** | `lefthook pre-commit` → `gitleaks protect`  | `git commit`                                 | A secret reaching local git history                                        |
| **L2** | `lefthook pre-push` → `gitleaks detect`     | `git push`                                   | A secret reaching the remote, even when `git commit --no-verify` bypassed L1 |
| **L3** | `.github/workflows/security.yml` (CI)       | Every PR + every push to `main` + weekly cron | Last safety net — by the time this fires the secret IS on GitHub remote     |

All three layers consume the SAME `.gitleaks.toml` (single source of truth).

---

## Reading gitleaks output

When the gate fires you will see something like:

```
gitleaks ❯ Finding:     OPENAI_API_KEY="REDACTED"
            Secret:      REDACTED
            RuleID:      generic-api-key
            File:        apps/api/src/foo.ts
            Line:        42
            Fingerprint: apps/api/src/foo.ts:generic-api-key:42

exit status 1
🥊 gitleaks: Secret leak detected in staged diff. See docs/security/secret-leak-runbook.md.
```

Three fields drive the response:

- **RuleID** — `openai-api-key`, `aws-access-token`, `generic-api-key`, etc. Tells you what kind of secret was matched.
- **File / Line** — exact location.
- **Fingerprint** — stable identifier you would add to `.gitleaksignore` IF (and only if) the finding is a confirmed false positive on historical content (see *False-positive triage* below).

---

## L1 fired — pre-commit blocked

**Diagnose first.**

```bash
git status
git diff --staged
```

Identify the offending file from the gitleaks output.

**If the file is `.env` / `.env.bak` / `.env.*` (not `.env.*.example`):**

```bash
git restore --staged .env       # unstage
# Confirm the path is in .gitignore so it cannot be staged again:
git check-ignore -v .env
```

If `git check-ignore` returns nothing, add the file's pattern to `.gitignore` and commit *that* first.

**If the file is source code (intentionally referencing a secret):**

1. Unstage it: `git restore --staged path/to/file`.
2. Move the literal secret out of source. Put it in `.env` (gitignored) and reference it via `process.env.X`.
3. Re-stage and re-run `git commit`.

**Never** edit the file just to delete the secret and then bypass with `--no-verify` — if the line was in your earlier staging, it may already be in your last commit. Run L2 (`pnpm lint:gitleaks` against the working tree) to verify nothing escaped.

---

## L2 fired — pre-push blocked

The secret is already in local history (you used `--no-verify` somewhere, or pulled a branch containing one).

**Diagnose:**

```bash
# Find the offending commit. The range gitleaks scanned is
# @{u}..HEAD (or root..HEAD on a fresh branch).
git log --oneline @{u}..HEAD
gitleaks detect --redact --config=.gitleaks.toml --log-opts="@{u}..HEAD" -v
```

**If the leak was just committed (last commit only):**

```bash
git reset --soft HEAD~1     # keep changes staged, drop the commit
# Then follow the L1 flow above to clean the staged content.
```

**If the leak is older (any commit other than HEAD):**

🚨 **STOP. ROTATE THE SECRET FIRST.** The key already lives on your local filesystem under
`.git/objects/`, in your IDE's indexes, and in any backup (Time Machine, iCloud, Dropbox).
Assume it is compromised the moment it touched a commit. Rotate it in the upstream provider
console (OpenAI, AWS, etc.) before doing anything else.

Then rewrite history. Two acceptable tools:

```bash
# Option A: git-filter-repo (recommended; faster, modern).
pip install git-filter-repo
git filter-repo --invert-paths --path path/to/leaky-file

# Option B: BFG.
brew install bfg
bfg --delete-files leaky-file
git reflog expire --expire=now --all && git gc --prune=now --aggressive
```

⚠️ **Force-push is required after either tool.** Coordinate with collaborators — anyone who
pulled the contaminated history will need to re-clone (or run `git rebase --onto`). Force-push
to `main` is prohibited; the cleanest path is usually to revert the bad commit, push the
revert, then schedule a coordinated force-push window.

---

## L3 fired — CI failed after push

The secret IS on GitHub remote. Treat it as compromised the moment CI surfaced the finding:

1. **ROTATE THE SECRET FIRST.** Do not wait for history-cleanup — even if you force-push within
   60 seconds, the secret has been visible to anyone watching `git push` events on the repo
   (including GitHub's secret-scanning consumers).
2. After rotation, run the L2 history-cleanup flow (`git filter-repo` or `bfg`) to remove the
   secret from history.
3. Force-push, coordinate with collaborators.
4. File a security incident note in `.planning/deferred-items.md` so the post-mortem has
   a paper trail (rotation timestamp, exposure window estimate, downstream notifications).

---

## False-positive triage

A finding is a false positive when the matched value is **provably not a real secret** — a
test placeholder, an `.env.example` template, a doc snippet, a synthetic helm-chart fixture
value, etc.

**Forward-looking false positives** (the value will appear in future commits too):

1. Confirm the match is a known placeholder. Cross-check against:
   - The list in `.gitleaks.toml` `[allowlist] regexes`.
   - The path patterns in `.gitleaks.toml` `[allowlist] paths`.
2. Extend `.gitleaks.toml` `[allowlist]`:
   - Path-scoped allowlist (`paths = [...]`) — when an entire directory of fixtures
     legitimately contains placeholder shapes (e.g., `tests/fixtures/`).
   - Regex-scoped allowlist (`regexes = [...]`) — when a specific literal placeholder
     value appears across many files (e.g., `sk-or-v1-1234567890abcdef`).
3. **Add a matching assertion in `tools/lint-gitleaks-config.test.ts`** so the new
   allowlist entry is regression-protected. The maintainer contract in the
   `.gitleaks.toml` header makes this mandatory — adding a permissive entry without
   a regression assertion is a coverage drop and will be blocked by the verifier.

**Historical false positives** (a one-off match on a committed file that is provably not a
live secret, and the cleanup cost outweighs the suppression cost):

1. Copy the Fingerprint from gitleaks output (`<commit>:<file>:<rule>:<line>`).
2. Append it to `.gitleaksignore` with a comment explaining the audit conclusion.

⚠️ `.gitleaksignore` is for HISTORICAL matches only. Forward-looking suppressions go in
`.gitleaks.toml` so they are regression-tested.

---

## NEVER bypass with `--no-verify`

`git commit --no-verify` and `git push --no-verify` are **prohibited** for any commit that
adds or modifies files containing potential credential shapes. This is enforced via
**CLAUDE.md Hard Rule #4**.

The gates exist precisely to catch operator slip-ups. Bypassing them defeats the whole
defense-in-depth design — and L3 will still catch it, but by then **the secret is on the
remote and rotation is mandatory**.

If a hook fires on a legitimate test placeholder, the fix is to extend `.gitleaks.toml`
allowlist + add a regression assertion in `tools/lint-gitleaks-config.test.ts`. Never bypass.

---

## Verification & maintenance

```bash
# Full working-tree scan (use this for periodic audits).
pnpm lint:gitleaks

# Staged-only scan (what pre-commit runs).
pnpm lint:gitleaks:staged

# Reinstall the gitleaks binary (idempotent; no-op when >= v8.x present).
bash tools/install-gitleaks.sh
# or:
make install-gitleaks

# Re-run the config + hook contract suites.
pnpm exec vitest run tools/lint-gitleaks-config.test.ts tools/lint-gitleaks-hook.test.ts
```

---

## Related files

- `.gitleaks.toml` — single-source-of-truth ruleset + allowlist
- `.gitleaksignore` — historical-fingerprint suppressions (empty in v1)
- `.gitattributes` — `.env* -diff` suppresses content rendering in `git diff` / PR UI
- `lefthook.yml` — pre-commit (L1) + pre-push (L2) hooks
- `.github/workflows/security.yml` — CI (L3) `gitleaks-action`
- `tools/install-gitleaks.sh` — idempotent installer (brew on macOS, curl-tarball on Linux)
- `tools/install-hooks.cjs` — bootstrap chain (`lefthook install` → `install-gitleaks.sh`)
- `tools/lint-gitleaks-config.test.ts` — TDD contract for the allowlist
- `tools/lint-gitleaks-hook.test.ts` — integration test for the hook gates
- `.planning/quick/260516-kya-implement-secret-leak-hard-gate-gitleaks/260516-kya-PLAN.md` — plan of record
