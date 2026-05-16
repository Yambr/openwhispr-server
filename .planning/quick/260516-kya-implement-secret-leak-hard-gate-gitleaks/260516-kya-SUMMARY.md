---
quick_id: 260516-kya
slug: implement-secret-leak-hard-gate-gitleaks
description: "Secret-leak hard gate: gitleaks pre-commit + pre-push hooks via Lefthook"
status: complete
date: 2026-05-16
commits:
  - 2941cca # test(260516-kya): RED gitleaks config contract
  - 072cc8c # feat(260516-kya): add .gitleaks.toml + installer + allowlist (GREEN)
  - 4fe6435 # test(260516-kya): RED gitleaks lefthook integration
  - 753f542 # feat(260516-kya): wire gitleaks into lefthook pre-commit + pre-push + CI
  - 783b885 # docs(260516-kya): add secret-leak runbook + CLAUDE.md Hard Rule #4
  - f4090ee # chore: merge quick task worktree (worktree-agent-aacab15de0114eb84)
---

# Quick Task 260516-kya — Summary

## What landed

Defense-in-depth secret-leak hard gate, three layers wired to a single `.gitleaks.toml` config:

| Layer | Trigger | Mechanism |
|---|---|---|
| **L1** — pre-commit | `git commit` | Lefthook calls `gitleaks protect --staged --config=.gitleaks.toml` on every commit |
| **L2** — pre-push | `git push` | Lefthook calls `gitleaks detect --log-opts=@{u}..HEAD --config=.gitleaks.toml` catching commits that escaped L1 via `--no-verify`, amend, or rebase |
| **L3** — CI | PR/main push + weekly | `.github/workflows/security.yml` gitleaks-action with `config-path: .gitleaks.toml` (single source of truth) |

## Files

**Created (7):**

- `.gitleaks.toml` — single-source-of-truth ruleset (extends gitleaks default, layers allowlist for tests/docs/planning/known-fixtures)
- `.gitleaksignore` — placeholder (history was confirmed clean via `git log -S`; pro-forma for future allowlisted commits)
- `.gitattributes` — `.env* -diff` (prevent secret raw values from leaking into `git diff` / PR-review UI)
- `tools/install-gitleaks.sh` — idempotent bootstrap (brew on macOS, curl-tarball on linux); called from `tools/install-hooks.cjs`
- `tools/lint-gitleaks-config.test.ts` — vitest gates the config: realistic shapes ARE caught, known test-fixture shapes are allowlisted
- `tools/lint-gitleaks-hook.test.ts` — integration test that exercises the Lefthook config in a throwaway repo
- `docs/security/secret-leak-runbook.md` — what to do when a hook fires (unstage, move to `.env*`, rotate if `--no-verify` happened, audit history)

**Modified (6):**

- `lefthook.yml` — added `gitleaks` command to `pre-commit` and `pre-push` sections with `fail_text` pointing at the runbook
- `.github/workflows/security.yml` — added `config-path: .gitleaks.toml` to gitleaks-action so CI uses the same ruleset as local hooks
- `tools/install-hooks.cjs` — extended `prepare` bootstrap to call `tools/install-gitleaks.sh` after `lefthook install`
- `package.json` — added `lint:gitleaks` (working-tree scan) and `lint:gitleaks:staged` (CI/manual staged-diff scan)
- `Makefile` — added `install-gitleaks` + `lint:gitleaks` targets; wired `lint:gitleaks` into aggregate `lint`
- `CLAUDE.md` — added Hard Rule #4 codifying allowlist-with-regression-test contract

## Verification (Hard Rule #3 — independent orchestrator verification, not sub-agent claim)

| Must-have | Status | Evidence |
|---|---|---|
| 5 atomic commits with TDD RED→GREEN per task | ✅ | `git log --oneline 2941cca^..783b885` shows 5 sequential commits in expected order |
| `.gitleaks.toml` exists and is referenced by both Lefthook AND CI | ✅ | `grep -l .gitleaks.toml lefthook.yml .github/workflows/security.yml` returns both files |
| `pnpm exec vitest run tools/lint-gitleaks-config.test.ts tools/lint-gitleaks-hook.test.ts` | ✅ | 12/12 passing in 749 ms |
| `pnpm lint:gitleaks` against HEAD returns 0 findings | ✅ | `1213 commits scanned. no leaks found` in 980 ms (git-mode scan, not `--no-git`) |
| Pre-commit blocks synthetic OpenAI-shape key | ✅ | `git commit` with realistic-shape `sk-proj-…T3BlbkFJ…` in staged file exits `1`, commit does NOT land. `🥊 gitleaks: Secret leak detected in staged diff. See docs/security/secret-leak-runbook.md.` printed. HEAD unchanged after attempt. |
| Pre-push catches range scan (synthetic leak via `--no-verify`) | ✅ | `lefthook run pre-push` after `git commit --no-verify` with synthetic key reports `leaks found: 1` against `@{u}..HEAD` range |
| Live keys in `.env`/`.env.bak` never leaked to git history | ✅ (pre-existing, confirmed during planning) | `git log -S "<key-content>"` returned empty across all 5 live keys (OpenAI, OpenRouter, Groq, Tavily, pyannote); files are gitignored |
| gitleaks binary version ≥ 8.x present locally | ✅ | `gitleaks version` → `8.30.1` (installed via brew) |

## Deviations from approved plan

One executor-level adjustment caught during orchestrator verification:

**`lint:gitleaks` script used `--no-git` flag** — this caused gitleaks to scan node_modules, .next/ build artefacts, `.claude/worktrees/*`, and `.env*` files, returning 69199 false-positive findings. The planner intended a git-tracked scan (default gitleaks `detect` behavior, ignoring gitignored content). Orchestrator removed `--no-git` from the script; gitleaks now scans 1213 commits worth of tracked history in 980 ms with 0 findings. This is documented in the package.json edit and verified above.

No other deviations. Worktree merge was clean (zero deletions, STATE/ROADMAP untouched, scope matched the plan exactly).

## Action items for the user (recommendations, not blockers)

- **Rotate the 5 live keys in `.env`/`.env.bak`** as a precaution: OpenAI `sk-proj-…`, OpenRouter `sk-or-v1-…`, Groq `gsk_…`, Tavily `tvly-dev-…`, pyannote `sk_…`. The keys never reached git, but snapshot tools (Time Machine, iCloud, IDE indexes, shell history) may have captured them. Cost ≈ 5 minutes per provider; risk ≈ zero.
- Decide whether to delete `.env.bak` — it is gitignored but lives on disk and duplicates `.env`.
- Optional: try `git commit` with a `sk-or-v1-…` shape in a throwaway file to confirm the hook also blocks non-OpenAI shapes (uses gitleaks `generic-api-key` + `openrouter` rules from the default ruleset).

## Pointers

- Approved plan: `/Users/nick/.claude/plans/jolly-questing-narwhal.md`
- Quick task plan: `.planning/quick/260516-kya-implement-secret-leak-hard-gate-gitleaks/260516-kya-PLAN.md`
- Operator runbook: `docs/security/secret-leak-runbook.md`
- Hard Rule reference: `CLAUDE.md` (Hard Rule #4 added)
