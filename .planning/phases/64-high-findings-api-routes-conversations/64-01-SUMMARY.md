---
phase: 64-high-findings-api-routes-conversations
plan: 01
subsystem: api
tags: [fastify, zod, wire-schemas, locker-04, error-envelope, contract-drift]

requires:
  - phase: 63-high-findings-api-routes-rest
    provides: HIGH-backlog phase-by-phase clearance pattern + review annotation convention
provides:
  - "All 12 folders/** + notes/** route declarations carry a declarative schema: block (LOCKER-04 inv-14 compliant)"
  - "Server conversations/messages.ts role enum aligned to the canonical ConversationRoleSchema (no \"tool\")"
  - "MetadataSchema exported from @openwhispr/wire-schemas; server metadata field adopts it"
  - "notes/delete-all over-limit 400 routed through the centralized setErrorHandler"
affects: [api-routes-transcriptions HIGH cluster, Phase 41 LOCKER-04 WARN->BLOCKING flip]

tech-stack:
  added: []
  patterns:
    - "Declarative Fastify schema: block wiring the same inline-parsed Zod schema (conversations/** reference pattern extended to folders/notes)"
    - "Body-less DELETE routes satisfy LOCKER-04 with schema: { body: z.object({}).strict().nullish() }"

key-files:
  created:
    - apps/api/tests/unit/routes/folders/locker-04-schema.test.ts
    - apps/api/tests/unit/routes/notes/locker-04-schema.test.ts
    - apps/api/tests/unit/routes/conversations/messages-role-contract.test.ts
    - apps/api/tests/unit/routes/conversations/messages-metadata-contract.test.ts
    - apps/api/tests/unit/routes/notes/delete-all-error-envelope.test.ts
    - packages/wire-schemas/tests/unit/__tests__/conversations.test.ts
    - .planning/phases/64-high-findings-api-routes-conversations/verify-first.log
  modified:
    - apps/api/src/routes/folders/{create,batch-create,delete,update,list}.ts
    - apps/api/src/routes/notes/{create,batch-create,delete,update,search,list,delete-all}.ts
    - apps/api/src/routes/conversations/messages.ts
    - packages/wire-schemas/src/conversations.ts
    - apps/api/tests/unit/routes/conversations/__tests__/messages.integration.test.ts
    - .planning/review/api-routes-conversations.md
    - .planning/review/REVIEW-INDEX.md

key-decisions:
  - "H-2 resolved option-a (drop \"tool\" server-side) per the advisor — upstream client ConversationsService.ts persistence interface uses {user,assistant,system} at all 4 sites; the server's \"tool\" was unilateral drift"
  - "H-4: the review's string-vs-object envelope framing is incorrect — the repo's canonical envelope IS { error: <string> } (error-handler.ts:4); the fix routes the 400 through the centralized handler, NOT an envelope shape change"
  - "H-1: inline .parse() preserved on every route — the declarative schema: is added for LOCKER-04 + dispatcher-time rejection, never replacing the validating call"

patterns-established:
  - "Body-less DELETE LOCKER-04 compliance: schema: { body: z.object({}).strict().nullish() } accepts an absent body while satisfying the structural invariant"
  - "Conversations-family route tests live under apps/api/tests/unit/ (NOT colocated under src/) — the colocated-tests linter forbids *.test.ts in src/"

requirements-completed: ["H-1", "H-2", "H-3", "H-4"]

duration: ~95min
completed: 2026-05-21
---

# Phase 64 Plan 01: HIGH findings — api-routes-conversations Summary

**Cleared all 4 HIGH wire-contract / structural-discipline defects in the apps/api conversations/folders/notes route surface — 12 routes made LOCKER-04 compliant, server role enum + metadata schema aligned to the canonical wire-schemas contract, and the delete-all 400 routed through the centralized error handler.**

## Performance

- **Duration:** ~95 min
- **Tasks:** 6 completed (verify-first + 4 finding RED/GREEN pairs + advisor checkpoint + review annotation)
- **Files modified:** 22 (12 route files + messages.ts + conversations.ts + 6 new tests + 1 amended test + 2 review docs)

## Verify-first determination

All four findings re-confirmed STILL LIVE against `main` HEAD before any fix
(`verify-first.log`, committed `4c77ae7c`). No divergence from the planner's
pre-determination on the live/closed status.

## Accomplishments

### H-1 — declarative `schema:` on 12 folders/notes routes
- **Verify-first:** STILL LIVE — all 12 route files lacked `schema:`.
- Per-route-class fix applied: **8 body routes** gained `schema: { body: <existing schema> }`; **2 querystring routes** (folders/notes `list`) gained an inline `ListQuerySchema` + `schema: { querystring }`, keeping `parseListQuery` as the semantic parse; **1 body-less route** (`notes/delete-all`) gained `schema: { body: z.object({}).strict().nullish() }`.
- The inline `.parse()` is preserved on every route — no validation regression.
- **Implementation note (deviation, Rule 3):** the `@fastify/type-provider-zod` validator IS attached via `zodTypeProvider` in `buildApp` + route-test setups, so the declarative schema is actively compiled. The body-less route's schema therefore had to accept an absent body (`.nullish()`), not a bare `z.object({}).strict()` which rejected the real payload-less DELETE. The standalone guard tests also had to register `zodTypeProvider`.
- Validation-coverage guards (malformed body/querystring → 400) pass pre- and post-fix.
- **RED `f1a16914`, GREEN `32f75b3e`.**

### H-2 — role enum drift (advisor checkpoint)
- **Verify-first:** STILL LIVE — server `MessageRoleSchema` had `"tool"`, canonical `ConversationRoleSchema` did not.
- **Advisor checkpoint:** investigated the read-only upstream client repo. `ConversationsService.ts` (the cloud-persistence interface) declares `role: "user" | "assistant" | "system"` at **all 4 sites** — no `"tool"`. The `"tool"` literal in the client exists only in the in-memory chat/reasoning UI layer, never on the persistence path. **Advisor recommendation: option-a.**
- **Chosen: option-a** (drop `"tool"` server-side, align DOWN to the canonical contract). Single server-only edit; `/Users/nick/openwhispr` untouched; **no upstream client follow-up required.**
- **RED+GREEN atomic `df69cfe6`** (the `colocated-tests` pre-commit linter forbids an isolated failing-RED test file under `src/`, and forbids `*.test.ts` under `src/` entirely — see Deviations).

### H-3 — server metadata adopts canonical MetadataSchema
- **Verify-first:** STILL LIVE — server `metadata` was `z.record(z.string(), z.unknown())`; `MetadataSchema` was `const`, not exported.
- GREEN added the `export` keyword to `MetadataSchema` in `packages/wire-schemas/src/conversations.ts`; the server `MessageInputSchema.metadata` field now uses it. The runtime 4 KiB check is kept as defence-in-depth.
- An existing `messages` test (`metadata > 4 KiB`) asserted the old runtime-check message shape — updated to the canonical 400 string envelope (genuine fix, CLAUDE.md hard rule 1; the cap is now enforced at the parse boundary too).
- **RED+GREEN atomic `4e976fcb`.**

### H-4 — delete-all 400 routed through ValidationError
- **Verify-first:** STILL LIVE — `delete-all.ts` emitted its over-limit 400 inline via `reply.code(400).send({error: string})`.
- GREEN: the over-limit branch now `throw new ValidationError("DELETE_ALL_TOO_LARGE", ...)` so the centralized `setErrorHandler` is the single emission point (i18n localization + uniform logging).
- **Divergence from the planner's pre-determination (CLAUDE.md hard rule 3):** the review + PLAN framed H-4 as a string-vs-object envelope defect ("canonical `{error:{code,message}}`"). This is **factually wrong** — the repo's canonical error envelope IS `{ error: <string> }` (`error-handler.ts:4`, and the existing `delete-all.integration.test.ts` asserts `{ error: string }`). `ValidationError` does NOT change the envelope to an object. The genuine, fixed defect is the inline emission bypassing the centralized handler. Editing `error-handler.ts` to make the envelope an object would violate CLAUDE.md hard rule 1, so the H-4 RED asserts the real defect (centralized routing) via source-contract, not an impossible envelope-shape assertion. The 4 M-1 keyset-parse sites share the same anti-pattern — left out of scope as instructed.
- **RED+GREEN atomic `ad403d59`.**

## Deviations from Plan

### Test-location correction (Rule 3 — blocking issue)
The PLAN's `files_modified` placed the conversations/wire-schemas tests under
`src/routes/conversations/__tests__/` and `packages/wire-schemas/src/__tests__/`.
The repo's `colocated-tests` pre-commit linter (`lint-colocated-tests.ts`)
**rejects `*.test.ts` files under `src/`** — they must live under
`tests/unit/`. The H-2/H-3 conversations tests were therefore placed at
`apps/api/tests/unit/routes/conversations/`, and the wire-schemas test at
`packages/wire-schemas/tests/unit/__tests__/`. Import depths adjusted
accordingly. This also forced H-2/H-3/H-4 to land as **atomic RED+GREEN
commits** (the PLAN explicitly permits this) — an isolated failing-RED test
file cannot pass the pre-commit pipeline.

### H-1 body-less schema shape (Rule 1 — bug-avoidance)
`z.object({}).strict()` for `notes/delete-all` rejected the real body-less
DELETE request once the validator compiled it. Corrected to
`z.object({}).strict().nullish()` so an absent body is accepted while LOCKER-04
is still satisfied.

### verify-first.log gitignore (Rule 3)
`.planning/.../verify-first.log` matches the generic `*.log` gitignore rule.
The PLAN explicitly requires it as a committed artifact, so it was
force-added (`git add -f`).

## Verification (run by the executor)

- `pnpm --filter @openwhispr/api test` — **1454 passed / 0 failed** / 2 skipped (167 files). Pre-phase baseline was 1433 passed; +21 from the 6 new test files.
- `pnpm --filter @openwhispr/wire-schemas test` (`--project=@openwhispr/wire-schemas`) — **126 passed / 0 failed** (5 files). Pre-phase 121; +5 from the new conversations test.
- `pnpm lint:lockers` — **8 lockers green (exit 0)**. LOCKER-04 reports zero NO-SCHEMA findings for folders/notes. All remaining WARN are pre-existing allowlisted debt (dead-export, shell-credential — untouched).
- `pnpm typecheck` — **5 errors**, exactly the documented baseline (`index.ts` 3 + `assemblyai.ts`/`deepgram.ts` 2). 0 new.
- `git log` — verify-first log + H-1 RED/GREEN pair + H-2/H-3/H-4 atomic RED+GREEN + the doc-annotation commit, all on `main`.

## Commit Map

| Finding | RED | GREEN |
|---------|-----|-------|
| verify-first | — | `4c77ae7c` |
| H-1 | `f1a16914` | `32f75b3e` |
| H-2 | (atomic) | `df69cfe6` |
| H-3 | (atomic) | `4e976fcb` |
| H-4 | (atomic) | `ad403d59` |
| review annotation | — | `bd14343d` |

## LOCKER-04 outcome

The 12 previously-schemaless `folders/**` + `notes/**` routes now carry a
declarative `schema:` block. `lint-prod-readiness.ts` (LOCKER-04) reports zero
NO-SCHEMA findings for these files — they are ready for the Phase 41
WARN→BLOCKING flip. All 8 constitutional lockers green.

## Self-Check: PASSED

All 7 cited artifacts (6 new test files + verify-first.log) exist on disk.
All 7 cited commit SHAs (`4c77ae7c`, `f1a16914`, `32f75b3e`, `df69cfe6`,
`4e976fcb`, `ad403d59`, `bd14343d`) are present on `main`.
