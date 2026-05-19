# Phase 56 — Client Contract Conformance

**Status:** CLOSED 2026-05-19
**Branch:** merged to local `main` (no GitHub push — see CONTEXT)
**Source spec:** `/Users/dev/openwhispr/.planning/phases/08-client-server-audit/SERVER-REQUIREMENTS.md` (R1..R12)
**Decisions:** see `CONTEXT.md` (locked D-1..D-5)

## Goal

Conform the openwhispr-server wire contract to the spec produced by
the upstream Electron client's Phase 8 (cross-repo audit) + Phase 9
(e2e) so that 22 of 28 blocked client e2e scenarios can run.
One-directional rule: server adapts, client doesn't migrate.

## Sub-plans

11 atomic sub-plans, each a single RGRG TDD cycle (RED→GREEN→REFACTOR)
with atomic commits. Wave order:

- **Wave 1 (solo):** 56-01 R1 seed-tenant (BLOCKER, unblocks wave 2)
- **Wave 2 (parallel ×7):** 56-02..05 + 56-07..09 — independent shape
  flips on disjoint route trees
- **Wave 3 (solo):** 56-06 R12 v1 envelope flip (touches apps/web
  surface; HALT-at-tip orchestrator-driven merge to avoid race)
- **Wave 4 (orchestrator):** 56-10 R2/R6/R7 verification bundle
- **Wave 5 (orchestrator):** 56-11 close-out (this file + ROADMAP +
  STATE + VERIFICATION.md)

## Plans → main-branch landing commits

| Plan | R | Title | Landed on main as |
|------|---|-------|-------------------|
| 56-01 | R1 | `POST /api/_test/seed-tenant` | `d4b06a6` |
| 56-02 | R8 | Notes CRUD 201/201/204 | `eb0f363` |
| 56-03 | R9 | Folders CRUD 201/201/204 + cascade | `e0d14b4` (recovery) |
| 56-04 | R10 | Conversations + Messages 201/201/204 | content in `d1725ea`, marker `c36d627` |
| 56-05 | R11 | Transcriptions 201/201/204 + atomic batch-delete | `dc9e875` (recovery) |
| 56-06 | R12 | V1Response discriminated envelope | `b30c21e` |
| 56-07 | R3 | `/api/openai-realtime-token` `language` plumb-through | content in `c897393`, marker `c6c13b4` |
| 56-08 | R4 | `/api/health` no Deprecation/Link headers | `3e99215` |
| 56-09 | R5 | `verification-status` tolerates `?email=` mismatch | `57b4c48` |
| 56-10 | R2/R6/R7 | docker compose up/build + stripe/referrals grep | no-code |
| 56-11 | — | Close-out (this commit) | TBD |

## Attribution-fix markers

Two squash-merge races during wave 2 produced commits with content
that belongs to a different plan than their title implies. Both have
explicit marker commits documenting the swap:

- `d1725ea feat(56-03): r9 folders crud shape conformance` actually
  contains 56-04 R10 conversations work → marker `c36d627 chore(56-04):
  attribution-fix`.
- `c897393 test(55-13-02): green — usage refresh + limit-reached badge`
  actually contains 56-07 R3 realtime-language work (plus 1 phase-55
  spec) → marker `c6c13b4 chore(56-07): attribution-fix`.

Both are functional NO-OPs (all R-code lands correctly on main); only
ROADMAP/audit attribution is affected. A future history-rewrite can
optionally clean these up.

## TDD evidence per plan

Each sub-plan commit-by-commit log lives on its squashed branch
(`phase/56-NN-*`). The squash commits on `main` carry the full
PLAN COMPLETE summary in their body. See `VERIFICATION.md` for
test counts + coverage per plan.

## Worktree leftover

8 worktrees + branches exist under `.claude/worktrees/phase-56-*` +
`phase/56-*`. They can be removed post-merge with:

```bash
for w in phase-56-02-r8-notes phase-56-03-r9-folders \
         phase-56-04-r10-conversations phase-56-05-r11-transcriptions \
         phase-56-06-r12-v1-envelope phase-56-07-r3-realtime-language \
         phase-56-08-r4-health-deprecation phase-56-09-r5-verification-status \
         phase-56-client-contract-conformance; do
  git worktree remove --force .claude/worktrees/$w
  git branch -D phase/${w#phase-}
done
```

(left in place during close-out for post-hoc auditability)

## Out-of-phase observations (deferred-items candidates)

1. **`tests/e2e/phase-05-transcriptions.spec.ts`** still asserts old
   200 status codes on transcriptions create/delete (gated by `E2E=1`,
   so CI doesn't trip on it). Sweep candidate for a Phase 56.1 or
   bundle into the next e2e refresh.

2. **API container restart loop on `LITELLM_MASTER_KEY` missing** is
   a pre-existing slim-profile env gap. The boot-time gate at
   `litellm-boot` fires when NODE_ENV=production and the env-var is
   absent. The Phase 56 rebuild surfaced this because the previously-
   running container had the var baked into its memory; the rebuild
   reset that. Operator action: set `LITELLM_MASTER_KEY` in `.env` (or
   in compose env). Not a Phase 56 regression — file in
   `.planning/deferred-items.md` if not already there.

3. **Parallel squash-merge races** during wave 2 produced two
   attribution swaps. Mitigation pattern proven in wave 3: executors
   HALT at branch tip, orchestrator drives squash via
   `git format-patch + git apply --3way` from main. Use this pattern
   in all future parallel-executor waves.
