# Phase 56 — Client Contract Conformance — CONTEXT

**Opened:** 2026-05-19
**Closed:** 2026-05-19 (same-day)
**Branches:** `phase/56-*` (8 sub-branches) merged to local `main` (GitHub `origin/main` remains at "Initial commit" — push deferred per user direction)

## Why this phase exists

The Yambr Electron client repo (`/Users/dev/openwhispr/`) closed Phase 8
(cross-repo audit) + Phase 9 (e2e suite) on 2026-05-19 and produced a
hard-list of 12 server-side requirements (R1..R12) at:

- `/Users/dev/openwhispr/.planning/phases/08-client-server-audit/SERVER-REQUIREMENTS.md`
- `/Users/dev/openwhispr/.planning/phases/09-client-e2e-tests/CONTEXT.md`

The contract is one-directional: server adapts, client does not
migrate. The client is upstream-parity and refuses any patches that
bridge a server gap. Our server is < 2 weeks old, not in production,
zero deprecation cost — no back-compat aliases.

22 of 28 client e2e scenarios were gated on R1 (seed-tenant) alone.

## Locked decisions (from user 2026-05-19)

**D-1 (env gate for R1 seed-tenant):** Reuse existing
`OPENWHISPR_TEST_ROUTES === "true"` gate (NOT spec's
`OPENWHISPR_ALLOW_TEST_ROUTES === "1"`). Client team owns updating R1
in their SERVER-REQUIREMENTS.md to match our existing convention.
Semantics identical (absent = deny, `"true"` = allow). Explicit
`=== "true"` string compare retained.

**D-2 (R3 language plumb-through):** Accept `language` at request
top-level. Map to `session.input_audio_transcription.language` on the
upstream OpenAI session.create call. Language absent → omit nested
field (OpenAI auto-detects). `streams=2` → both clientSecrets[] minted
with same `input_audio_transcription` block.

**D-3 (V1Response envelope flip):** Atomic flip in this phase.
- success: `{ success: true, data: T }`
- failure: `{ success: false, error: string, code?: string }`
HTTP status code stays truthful — envelope duplicates info, does NOT
mask status.

**D-4 (worktree + merge):** 8 worktrees under `.claude/worktrees/phase-56-*`
on branches `phase/56-*`. Merge locally to `main` after CI green.
GitHub push is a separate later step.

**D-5 (wave order for executor subagents):**
- **Wave 1 (solo):** 56-00 setup → 56-01 R1 seed-tenant BLOCKER →
  squash-merge into local `main`
- **Wave 2 (parallel ×7, take updated main as baseline):** 56-02 R8,
  56-03 R9, 56-04 R10, 56-05 R11, 56-07 R3, 56-08 R4, 56-09 R5
- **Wave 3 (solo, HALT-at-tip discipline):** 56-06 R12
- **Wave 4 (orchestrator-driven):** 56-10 R2/R6/R7 docker verify
- **Wave 5 (orchestrator):** 56-11 close-out

Wave 2 only kicked off AFTER 56-01 landed in local `main` so its
integration tests (which need seed-tenant) had a stable baseline.

## Outcome summary (2026-05-19, ~3h total wall-clock)

All 12 R-rows landed on local `main`:

| R | Status | Landing commit | Notes |
|---|---|---|---|
| R1 | ✅ | `d4b06a6` | clean squash |
| R2 | ✅ | (verify-only) | negative-matrix asserts 404 on all 7 paths |
| R3 | ✅ | content in `c897393`, marker `c6c13b4` | attribution swap |
| R4 | ✅ | `3e99215` | clean squash |
| R5 | ✅ | `57b4c48` | clean squash (executor auto-merged) |
| R6 | ✅ | (verify-only) | `docker compose up -d` shows 7/7 healthy slim profile |
| R7 | ✅ | (verify-only) | `docker compose build api` exit 0 from cache |
| R8 | ✅ | `eb0f363` | clean squash |
| R9 | ✅ | `e0d14b4` | orchestrator-driven recovery after stash drama |
| R10 | ✅ | content in `d1725ea`, marker `c36d627` | attribution swap |
| R11 | ✅ | `dc9e875` | content-recovery (after empty `55b7854`) |
| R12 | ✅ | `b30c21e` | clean squash (HALT-at-tip discipline) |

## Verification protocol

End-to-end protocol is the 12-row table at
`/Users/dev/openwhispr/.planning/phases/08-client-server-audit/SERVER-REQUIREMENTS.md`
§"Verification protocol after server fixes land". See `VERIFICATION.md`
for row-by-row evidence + test counts.

## Constitutional gates (per CLAUDE.md)

- Strict TDD per plan (RED → GREEN → REFACTOR, atomic commits)
- Coverage ≥ 90/90/90/90 on new/modified files
- LOCKER-01..08 exit 0 on every commit
- CONTRACT-01 harness extended in the same commit as each route change
- English-only artifacts
- CLAUDE.md hard rule #1 (never edit production to satisfy tests) —
  honored in every plan (route shape flips ARE the legitimate
  production change)
- CLAUDE.md hard rule #3 (orchestrator independently verifies sub-agent
  claims) — practiced for every wave-1 + wave-2 + wave-3 PLAN COMPLETE
  via `git log --oneline`, `git show --stat`, and re-running the cited
  test commands

## Lessons learned

1. **Parallel squash-merges to a shared branch race** — even with
   per-agent worktrees, two executors running `git checkout main +
   git merge --squash` on the same `main` ref can absorb each other's
   working-tree state. Three attribution swaps in wave 2 (d1725ea,
   55b7854 empty, c897393) plus one stash dance forced manual recovery.

2. **Wave 3 HALT-at-tip pattern works** — when 56-06 executor was told
   to RGRG on branch only and HALT (no squash), orchestrator used
   `git format-patch + git apply --3way` from main and landed a clean
   commit `b30c21e` with zero race. **Use this pattern for all future
   parallel-executor work.**

3. **`stash@{0..N}` accumulated** during the wave-2 chaos. Worth
   purging in a separate hygiene pass.

## Cross-reference to client repo

This phase is read-only against `/Users/dev/openwhispr/`. Findings
about client-side behavior live in the spec referenced above; we do
not edit anything in that repo.
