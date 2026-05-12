---
phase: 07-frontend-ui-spec
plan: 07
type: execute
wave: 3
depends_on: [06]
files_modified:
  - .planning/STATE.md
  - .planning/ROADMAP.md
  - .planning/phases/07-frontend-ui-spec/07-SUMMARY.md
autonomous: true
requirements: [UI-SPEC-01, UI-SPEC-02, UI-SPEC-03]
must_haves:
  truths:
    - "`pnpm lint:ui-spec` exits 0 against the final tree"
    - "`pnpm test tools/lint-ui-spec.test.ts --coverage` reports ≥90/90/90/90 on tools/lint-ui-spec.ts"
    - "WIP_ENDPOINTS in tools/lint-ui-spec.config.ts is empty (drained before phase close)"
    - "STATE.md records Phase 7 completion with date + summary line"
    - "ROADMAP.md Phase 7 checkbox is ticked (or status emoji updated per repo convention)"
    - "07-SUMMARY.md exists and answers the goal-backward verifier checklist (07-PLAN.md § 'Goal-Backward Verification')"
    - "git working tree clean after final commit"
  artifacts:
    - path: ".planning/STATE.md"
      provides: "Updated position section + phase 7 completion entry"
    - path: ".planning/ROADMAP.md"
      provides: "Phase 7 row marked complete"
    - path: ".planning/phases/07-frontend-ui-spec/07-SUMMARY.md"
      provides: "Phase 7 close summary: what shipped, must-have proof table, follow-ups (Phase 7.x backlog)"
  key_links:
    - from: "07-SUMMARY.md"
      to: "07-PLAN.md § Goal-Backward Verification"
      via: "verifier checklist items 1..15"
      pattern: "checklist|verifier"
---

<role>
You are a GSD executor closing Phase 7. You confirm every goal-backward
must-have, update planning bookkeeping, and write the phase summary that
gsd-verifier will read.
</role>

<context>
@/Users/dev/openwhispr-server/CLAUDE.md
@/Users/dev/openwhispr-server/.planning/STATE.md
@/Users/dev/openwhispr-server/.planning/ROADMAP.md
@/Users/dev/openwhispr-server/.planning/phases/07-frontend-ui-spec/07-PLAN.md
@/Users/dev/openwhispr-server/.planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md
@/Users/dev/openwhispr-server/.planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md
@/Users/dev/openwhispr-server/tools/lint-ui-spec.ts
@/Users/dev/openwhispr-server/tools/lint-ui-spec.config.ts
@/Users/dev/openwhispr-server/.github/workflows/ui-spec.yml
</context>

<files_to_read>
- /Users/dev/openwhispr-server/.planning/STATE.md
- /Users/dev/openwhispr-server/.planning/ROADMAP.md
- /Users/dev/openwhispr-server/tools/lint-ui-spec.config.ts (confirm WIP_ENDPOINTS empty)
- /Users/dev/openwhispr-server/.planning/phases/07-frontend-ui-spec/07-PLAN.md (verifier checklist)
</files_to_read>

<files_to_modify>
- /Users/dev/openwhispr-server/.planning/STATE.md
- /Users/dev/openwhispr-server/.planning/ROADMAP.md
- /Users/dev/openwhispr-server/.planning/phases/07-frontend-ui-spec/07-SUMMARY.md (CREATE)
</files_to_modify>

<task>
## Objective

Close the phase. Three deliverables:

1. **Full lint pass + coverage check.** Run the linter and coverage and paste
   raw output into 07-SUMMARY.md as proof.
2. **STATE.md + ROADMAP.md updates.** Phase 7 checkbox / status moves to
   complete; STATE.md `## Position` section advances.
3. **07-SUMMARY.md.** A verifier-friendly summary mapping every must-have in
   07-PLAN.md § Goal-Backward Verification to a passing check, plus a
   Phase 7.x follow-up backlog.

## Step-by-step

### 1. Pre-flight checks

```bash
# Linter green
pnpm lint:ui-spec

# Coverage gate (must report ≥90 lines/branches/functions/statements on tools/lint-ui-spec.ts)
pnpm test tools/lint-ui-spec.test.ts --coverage

# Typecheck + biome lint
pnpm typecheck
pnpm lint

# Sanity: WIP_ENDPOINTS must be empty
grep -A3 "WIP_ENDPOINTS" tools/lint-ui-spec.config.ts | head -10
# Expect: `export const WIP_ENDPOINTS: ReadonlyArray<string> = [];`

# Verifier-checklist greps (mirror 07-PLAN.md items 1..15)
test -f .planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md && echo OK1
test -f .planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md && echo OK2
grep -c "^## A[23] " .planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md
grep -cE "^## U([1-9]|1[0-3]) " .planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md
grep -c "Design gap (tracked):" .planning/phases/07-frontend-ui-spec/UI-SPEC-*.md
grep -c "lint:ui-spec" package.json
test -f .github/workflows/ui-spec.yml && echo OK_GHA
```

If any check fails, STOP and route back to the failing plan (do not paper
over with a workaround — per `~/.claude/CLAUDE.md` user rule).

### 2. Write `07-SUMMARY.md`

Template:

```markdown
---
phase: 07-frontend-ui-spec
type: summary
completed: <YYYY-MM-DD>
requirements: [UI-SPEC-01, UI-SPEC-02, UI-SPEC-03]
---

# Phase 7 — Frontend UI-SPEC: Summary

**Completed:** <date>
**Status:** ✅ Done
**Verifier:** gsd-verifier (run `/gsd-verify-phase 07`)

## What Shipped

- `.planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md` — 2 screens
  (A2 Observability hub, A3 Config view) per D-API4/D-API5 revision.
- `.planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md` — 13 screens
  (U1–U13) per D-UX/D-API decisions.
- `tools/lint-ui-spec.ts` + `.config.ts` + `.test.ts` + fixtures —
  5-rule spec linter (unified+remark), coverage ≥90/90/90/90.
- `.github/workflows/ui-spec.yml` — GHA gate.
- `lefthook.yml` — pre-commit hook.
- `package.json` — `lint:ui-spec` script + unified/remark devDeps.

## Must-Have Proof Table

| # | Must-have | Evidence | Result |
|---|-----------|----------|--------|
| 1 | UI-SPEC-admin.md exists | `test -f` | PASS |
| 2 | UI-SPEC-end-user.md exists | `test -f` | PASS |
| 3 | `pnpm lint:ui-spec` exits 0 | command output below | PASS |
| 4 | A2 + A3 sections present | `grep -c "^## A[23] "` returned 2 | PASS |
| 5 | U1–U13 sections present | `grep -cE "^## U([1-9]|1[0-3]) "` returned 13 | PASS |
| 6 | Required subsections per screen | linter rule 1 | PASS |
| 7 | Endpoint existence | linter rule 2 | PASS |
| 8 | Copy-key uniqueness + schema | linter rule 3 | PASS |
| 9 | See-visual references resolve | linter rule 4 | PASS |
| 10 | Wireframe monospace | linter rule 5 | PASS |
| 11 | GHA workflow exists | `.github/workflows/ui-spec.yml` | PASS |
| 12 | package.json script wired | `grep lint:ui-spec package.json` | PASS |
| 13 | Linter coverage ≥90/90/90/90 | vitest coverage report below | PASS |
| 14 | Three design-gap markers | `grep -c "Design gap (tracked):"` returned ≥3 across files | PASS |
| 15 | STATE/ROADMAP updated | this commit | PASS |

## Command Output (proof)

### `pnpm lint:ui-spec`

```
<paste exit-0 output here>
```

### `pnpm test tools/lint-ui-spec.test.ts --coverage`

```
<paste coverage table showing tools/lint-ui-spec.ts at ≥90 on every axis>
```

## Decisions honored

| Decision | Where enforced |
|----------|----------------|
| D-S1 (no new APIs) | Linter rule 2 + Plan 01 verified API table + Appendix D |
| D-API1 (flat transcript) | U7 Data subsection text |
| D-API2 (BA sessions) | U5 endpoints |
| D-API4 (no Effective env) | A3 Purpose + Wireframe + design-gap marker |
| D-API5 (drop A1) | Admin file has only A2 + A3 |
| D-API6 (no activity feed) | U4 design-gap marker + KPI-only chart set |
| D-UX1 (email+password) | U1/U2 forms |
| D-UX2 (forgot pw deferred) | U1 disabled state + design-gap marker |
| D-UX3 (no PAK web UI) | Absence verified by grep |
| D-UX4 (Continue with SSO) | U1/U2 OIDC button copy keys |
| D-UX5 (folders read-only) | U8 sidebar |
| D-ART1..D-ART7 | Two files + appendix + linter + fixtures |

## Phase 7.x backlog (deferred)

- U14 Forgot password (`/forgot-password`) — wired to Better Auth `/api/auth/forget-password`.
- U15 Reset password (`/reset-password?token=`) — wired to Better Auth `/api/auth/reset-password`.
- U16 PAK manager web UI — `/api/v1/keys/list` + `/api/v1/keys/:id/revoke`.
- A1 Audit log viewer — requires new `GET /api/admin/audit/list` endpoint (Phase 6 D-A5 still open).
- Re-engagement with Claude Design for the three encoded design gaps.

## Phase 8 prerequisite

- `apps/web/` scaffold (Next.js 15 + Tailwind 4 + shadcn/ui v2 init via
  `pnpm dlx shadcn@latest init`). Phase 7 explicitly deferred this per
  RESEARCH § Open Q 1 to keep the verifier surface small.

## Constitutional compliance

- TDD: Plan 02 (RED tests + fixtures) → Plan 03 (GREEN implementation) —
  RED commit precedes GREEN commit in git log.
- Coverage: tools/lint-ui-spec.ts ≥90/90/90/90 confirmed above.
- E2E: not applicable (no user-visible route in Phase 7 deliverable).
- No mocks of internal logic: linter tests use real markdown fixtures and
  real apps/api/src/routes/ files.
- GHA only: `.github/workflows/ui-spec.yml` is the sole CI surface.
- English only: UI-SPEC body, code comments, copy-key names, commit messages.
```

### 3. STATE.md update

Find the `## Position` (or equivalent) block in `.planning/STATE.md` and
append a Phase 7 completion entry. Example pattern (follow repo's existing
style — check the previous phase entries first):

```markdown
- **Phase 07 — Frontend UI-SPEC:** ✅ Complete <date>. Two UI-SPEC files +
  tools/lint-ui-spec.ts + GHA gate. No new API surface. apps/web scaffold
  deferred to Phase 8.
```

### 4. ROADMAP.md update

Find the Phase 7 row and tick it. Follow the repo's checkbox style (probably
`- [x]` or status emoji). If a phase summary line exists, update its text.

### 5. Commit

Single atomic commit covering STATE.md + ROADMAP.md + 07-SUMMARY.md.

## Acceptance criteria

- All commands in step 1 exit 0 (or grep returns ≥ expected counts).
- 07-SUMMARY.md exists with filled-in proof tables (no `<paste here>`
  placeholders left in final output).
- STATE.md + ROADMAP.md reflect Phase 7 done.
- Final commit is atomic and follows the `docs(07):` prefix convention.
- `git status` clean after commit.

## Out of scope

- Modifying any other file (UI-SPEC, linter, workflows already final).
- Starting Phase 8 work (`apps/web/` scaffold) — that's a separate phase.
</task>

<tests>
- All pre-flight commands in step 1 exit 0.
- `test -f .planning/phases/07-frontend-ui-spec/07-SUMMARY.md`
- `grep -c "PASS" 07-SUMMARY.md` ≥ 15 (one per must-have row)
- `grep -E "Phase 0?7" .planning/STATE.md` returns the new completion entry.
- `grep -E "Phase 0?7" .planning/ROADMAP.md` shows complete state.
- `git status --porcelain` empty after commit.
</tests>

<commit_message>
docs(07): close phase — UI-SPEC complete + STATE/ROADMAP updates

Closes Phase 7 (Frontend UI-SPEC). Lands 07-SUMMARY.md with the must-have
proof table (15 verifier checks all PASS), command output for
`pnpm lint:ui-spec` (exit 0) and vitest coverage (≥90/90/90/90 on
tools/lint-ui-spec.ts), the decisions-honored matrix (D-S1, D-API1..6,
D-UX1..5, D-ART1..7), and the Phase 7.x backlog (U14/U15 password reset,
U16 PAK web UI, A1 audit log, three Claude Design re-engagements).

Updates STATE.md position + ROADMAP.md Phase 7 status to complete.
apps/web/ scaffold remains deferred to Phase 8.

Refs: UI-SPEC-01, UI-SPEC-02, UI-SPEC-03
</commit_message>
