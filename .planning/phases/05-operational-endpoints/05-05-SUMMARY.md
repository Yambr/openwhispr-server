---
phase: 05-operational-endpoints
plan: 05
subsystem: api + notes-crud + canonical-pattern
tags: [wire, crud, notes, rls, keyset-pagination, tsvector, tdd]
requires:
  - "05-01-SUMMARY.md — notes/folders tables, RLS, tsvector GIN, partial UNIQUE on client_note_id, keyset partial idx"
  - "05-02-SUMMARY.md — route conventions, withTenant pattern, integration-test boot helper"
  - "05-04-SUMMARY.md — settings-resolver pattern (parallel SELECTs under one withTenant tx)"
provides:
  - "apps/api/src/lib/keyset-pagination.ts — parseListQuery + buildKeysetWhere + buildKeysetOrderLimit (D-25)"
  - "apps/api/src/lib/soft-delete.ts — withSoftDelete + softDeletePredicate (D-23 / T-05-06)"
  - "apps/api/src/lib/client-id-upsert.ts — createOrReturnExisting Pattern 1 (D-24 / Pitfall #2)"
  - "POST /api/notes/create (WIRE-22)"
  - "POST /api/notes/batch-create (WIRE-22)"
  - "PATCH /api/notes/update (WIRE-22)"
  - "DELETE /api/notes/delete (WIRE-22)"
  - "DELETE /api/notes/delete-all (WIRE-22)"
  - "GET /api/notes/list (WIRE-22)"
  - "POST /api/notes/search (WIRE-22 — websearch_to_tsquery + ts_rank)"
  - "Migration 0011 — 11 CloudNote columns added to notes table"
  - "Canonical CRUD pattern reusable by Plans 06-09 without modification"
affects:
  - "apps/api/src/routes/index.ts — registers 7 new routes UNCONDITIONALLY"
  - "packages/data/src/schema/notes.ts — extends Drizzle schema with 11 new columns"
  - "Plans 06 (folders), 07 (conversations), 08 (transcriptions), 09 (api-keys) — can drop in the shared helpers without changes"
tech-stack:
  added: []
  patterns:
    - "Pattern 1 — INSERT ... ON CONFLICT (tenant_id, user_id, client_<resource>_id) WHERE <client_id> IS NOT NULL DO NOTHING RETURNING * + SELECT fallback"
    - "Pattern 2 — keyset pagination via parseListQuery + (created_at, id) tuple comparison + buildKeysetOrderLimit"
    - "Pattern 3 — websearch_to_tsquery('simple', $1) + ts_rank scoring (RESEARCH upgrade of D-26's plainto_tsquery)"
    - "Soft-delete uniform via withSoftDelete() helper across every read path"
    - "Static allowlist of mutable columns in update route (defense-in-depth against untrusted column injection)"
key-files:
  created:
    - apps/api/src/lib/keyset-pagination.ts
    - apps/api/src/lib/soft-delete.ts
    - apps/api/src/lib/client-id-upsert.ts
    - apps/api/src/lib/__tests__/keyset-pagination.test.ts
    - apps/api/src/lib/__tests__/soft-delete.test.ts
    - apps/api/src/lib/__tests__/client-id-upsert.test.ts
    - apps/api/src/routes/notes/create.ts
    - apps/api/src/routes/notes/batch-create.ts
    - apps/api/src/routes/notes/update.ts
    - apps/api/src/routes/notes/delete.ts
    - apps/api/src/routes/notes/delete-all.ts
    - apps/api/src/routes/notes/list.ts
    - apps/api/src/routes/notes/search.ts
    - apps/api/src/routes/notes/shape.ts
    - apps/api/src/routes/notes/__tests__/setup.ts
    - apps/api/src/routes/notes/__tests__/crud.integration.test.ts
    - apps/api/src/routes/notes/__tests__/batch-create.integration.test.ts
    - apps/api/src/routes/notes/__tests__/list.integration.test.ts
    - apps/api/src/routes/notes/__tests__/delete-all.integration.test.ts
    - apps/api/src/routes/notes/__tests__/search.integration.test.ts
    - packages/contract-tests/src/notes.test.ts
    - tests/e2e/phase-05-notes.spec.ts
    - packages/data/migrations/0011_notes_cloud_columns.sql
  modified:
    - apps/api/src/routes/index.ts (registers 7 notes routes UNCONDITIONALLY + barrel exports)
    - packages/data/src/schema/notes.ts (11 CloudNote columns)
    - packages/data/migrations/meta/_journal.json (entry 0011)
decisions:
  - "D-22 — wire shape mirrors upstream NotesService.ts byte-for-byte (CloudNote 19 fields, batch-create { created: [{client_note_id, id}] }, deleteAll { deleted: n })"
  - "D-23 — soft delete on single-row delete; HARD delete on delete-all (mirrors desktop semantics)"
  - "D-24 — same client_note_id retry returns existing row (200, NOT 409); null client_note_id ALWAYS inserts"
  - "D-25 — keyset pagination with limit [1..200] default 50; ORDER BY (created_at, id) DESC matches notes_keyset_idx partial index"
  - "D-26 (upgraded) — search uses websearch_to_tsquery('simple', $1) (NOT plainto_tsquery); ts_rank for score; query 1..256 chars"
  - "D-30 — batch-create cap = 500 items; delete-all inline cap = 1000 rows"
  - "Pattern 1 — explicit SELECT fallback on conflict path (not DO UPDATE SET id=id RETURNING * trick)"
  - "Pitfall #2 — null clientId path skips ON CONFLICT entirely (partial UNIQUE never considers NULL a conflict)"
  - "Pitfall #3 — whitespace-only search query returns 400 envelope even though length >= 1"
  - "T-05-04 — batch-create rate-limit tightened to 5 req/min/user (flood mitigation)"
  - "T-DEL-ALL-DOS — delete-all rate-limit tightened to 3 req/min/user"
metrics:
  duration: "~50min"
  completed_date: "2026-05-11"
  tasks: 3
  files_changed: 23
---

# Phase 5 Plan 05: Notes CRUD WIRE-22 Summary

All 7 endpoints of the upstream `/api/notes/*` family land in three atomic
commits, building the canonical CRUD pattern that Plans 06–09 will mirror
verbatim. The three shared helpers (`keyset-pagination`, `soft-delete`,
`client-id-upsert`) live in `apps/api/src/lib/` and are intentionally
schema-agnostic: each plan downstream picks them up by changing nothing
more than table/column literals. The integration test floor (5 files, all
testcontainer-backed against real Postgres 17-alpine + production
migrations 0000..0011) proves the CRUD invariants: idempotency under
retry (D-24), keyset paging stability under created_at collisions
(D-25), tsquery sanitization against operator-laden user input (D-26
upgrade), 1000-row delete-all cap (T-DEL-ALL-DOS), 500-item batch cap
(D-30), and FORCE-RLS cross-tenant invisibility (T-05-07). Wire-shape
conformance against upstream `~/openwhispr/src/services/NotesService.ts`
is byte-for-byte (D-22): `batch-create` returns
`{ created: [{client_note_id, id}] }` (NOT `Array<CloudNote>` as the
plan's `<behavior>` block suggested — see Deviation #1), `delete` returns
`{ ok: true }`, `delete-all` returns `{ deleted: <count> }`, `list` and
`search` return `{ notes: [...] }`. Migration 0011 adds the 11 columns
needed to materialize the full CloudNote shape — without it the
wire-schemas Zod definitions from Plan 01 would have nowhere to persist.

## What Shipped

### Shared CRUD helpers (Task 1)

- **`apps/api/src/lib/keyset-pagination.ts`** — three exports:
  - `parseListQuery({limit, before, since})` → `{limit, before, since}`.
    Clamps `limit` to `[1, 200]`, default `50` (D-25). Out-of-range,
    non-numeric, or `null` values fall back to default (NOT 400 — the
    desktop's deleteAll legacy fallback ships `limit=9999`). Invalid
    timestamps throw `TypeError` (caller maps to 400 via centralized
    error handler).
  - `buildKeysetWhere(parsed)` → leading-`AND` SQL fragment for
    `created_at < before` / `created_at > since`. Empty fragment when
    neither set.
  - `buildKeysetOrderLimit(parsed)` → `ORDER BY created_at DESC, id DESC
    LIMIT N` — pairs with `notes_keyset_idx (tenant_id, created_at DESC,
    id DESC) WHERE deleted_at IS NULL` partial index from Plan 01.
- **`apps/api/src/lib/soft-delete.ts`** — `withSoftDelete()` returns
  `' AND deleted_at IS NULL'` as a composable SQL fragment;
  `softDeletePredicate()` returns the bare predicate. Single source of
  truth for soft-delete filtering across every read path (T-05-06
  mitigation surface).
- **`apps/api/src/lib/client-id-upsert.ts`** — `createOrReturnExisting<T>()`
  implements Pattern 1: `INSERT ... ON CONFLICT (tenant_id, user_id,
  <client_id_col>) WHERE <client_id_col> IS NOT NULL DO NOTHING
  RETURNING *` with explicit SELECT fallback. Null clientId path skips
  the conflict clause entirely (Pitfall #2). `SAFE_IDENT_RE` defends
  table/column literals against injection (belt-and-braces).

### Migration 0011 — CloudNote column extension

- **`packages/data/migrations/0011_notes_cloud_columns.sql`** — forward-only
  `ALTER TABLE notes ADD COLUMN IF NOT EXISTS …` for the 11 fields that
  Plan 01 shipped in wire-schemas Zod but never persisted: `note_type`,
  `enhanced_content`, `enhancement_prompt`, `source_file`,
  `audio_duration_seconds`, `participants`, `calendar_event_id`,
  `diarization_enabled`, `expected_speaker_count`, `transcript`,
  `enhanced_at_content_hash`. Safe defaults on every column (`note_type
  NOT NULL DEFAULT 'personal'`, others nullable). Re-grants
  SELECT/INSERT/UPDATE/DELETE on `notes` to `openwhispr_app`. The
  tsvector `content_search` GENERATED column is unchanged — Pitfall #1
  / D-26 keeps the index size bounded by title+content.
- **`packages/data/migrations/meta/_journal.json`** — entry 11 appended.
- **`packages/data/src/schema/notes.ts`** — Drizzle mirror updated.

### Route handlers (Task 2 + Task 3)

7 route files under `apps/api/src/routes/notes/`:

- **`create.ts`** — `POST /api/notes/create`. NoteInput → CloudNote.
  `createOrReturnExisting` per Pattern 1; same `client_note_id` on retry
  returns existing row with 200 (NOT 409). All 19 CloudNote fields
  populated from request body via static field map.
- **`batch-create.ts`** — `POST /api/notes/batch-create`. Accepts both
  `{ notes: [...] }` canonical wrapper AND a bare array `[...]`
  (forward-compat with plan's `<behavior>` block). 500-item cap
  per D-30 → 400 envelope on overflow. Returns
  `{ created: [{client_note_id, id}] }` byte-for-byte upstream shape.
  Sequential within ONE withTenant transaction (parallel would deadlock
  on the partial UNIQUE index). Rate-limit 5/min/user (T-05-04).
- **`update.ts`** — `PATCH /api/notes/update`. Static allowlist of
  14 mutable columns; server bumps `updated_at = NOW()` regardless of
  client input. `WHERE id = $ AND user_id = $ AND deleted_at IS NULL`
  → 0 rows surfaces as 404 (cross-tenant / cross-user / soft-deleted
  all indistinguishable from "never existed", per upstream contract).
- **`delete.ts`** — `DELETE /api/notes/delete`. Soft delete via
  `deleted_at = NOW()`. Returns `{ ok: true }`. 0 rows → 404.
- **`delete-all.ts`** — `DELETE /api/notes/delete-all`. HARD purge
  (per D-23 / upstream semantics: "delete-all" means "purge from
  cloud", not soft-delete tombstones). 1000-row inline cap per
  Open Q#6 / T-DEL-ALL-DOS — count-first gate; >1000 → 400 envelope
  before any DELETE runs. Rate-limit 3/min/user.
- **`list.ts`** — `GET /api/notes/list?limit&before&since`. Uses
  `parseListQuery` + `buildKeysetWhere` + `withSoftDelete` +
  `buildKeysetOrderLimit`. Returns `{ notes: CloudNote[] }`.
- **`search.ts`** — `POST /api/notes/search`. Uses
  `websearch_to_tsquery('simple', $1)` + `ts_rank(content_search, q)`
  per RESEARCH § Pattern 3 (upgrade of D-26's `plainto_tsquery` —
  websearch never raises on operator-laden user input). Trimmed
  whitespace-only queries → 400 (Pitfall #3). Query capped at 256
  chars; limit clamped to `[1, 200]`. Returns
  `{ notes: SearchResult[] }` where SearchResult = CloudNote + score.
- **`shape.ts`** — `rowToCloudNote()` single serializer used by every
  route. Pins the upstream 19-field shape; nullable-everywhere policy
  matches `~/openwhispr/src/services/NotesService.ts`.

### Route registration

- **`apps/api/src/routes/index.ts`** — all 7 notes routes registered
  UNCONDITIONALLY (DB-only, no LiteLLM dependency) in `buildAllRoutes`'s
  unconditional plugins array. 7 new build factories added to the
  barrel export.

### Test floor

| File | Tests | Scope |
| --- | --- | --- |
| `apps/api/src/lib/__tests__/keyset-pagination.test.ts` | 16 | parse clamping (limit 0/-5/'all'/9999/500), invalid timestamps, fragment shape, `(created_at, id)` grep marker |
| `apps/api/src/lib/__tests__/soft-delete.test.ts` | 3 | leading-AND fragment, bare predicate |
| `apps/api/src/lib/__tests__/client-id-upsert.test.ts` | 7 | ON CONFLICT clause shape, RETURNING *, SELECT fallback on conflict, null/undefined clientId path skips ON CONFLICT, unsafe-identifier rejection, race detection |
| `apps/api/src/routes/notes/__tests__/crud.integration.test.ts` | 8 | testcontainer PG 17 + migrations 0000..0011; 19-field CloudNote, D-24 idempotency, Pitfall #2 null path, update advances updated_at, 404 on unknown id, soft-delete excludes from list, RLS cross-tenant invisibility (tenant B's UPDATE/DELETE/LIST on tenant A's note all 404 / empty), client_note_id collision isolation per tenant, 401 defensive guard |
| `apps/api/src/routes/notes/__tests__/batch-create.integration.test.ts` | 5 | wrapper + bare-array body, idempotency (first-writer-wins per row), 501-item rejection, 500-item boundary success |
| `apps/api/src/routes/notes/__tests__/list.integration.test.ts` | 8 | ordering (created_at, id) DESC, ?limit, limit=500 clamps, soft-delete exclusion, ?before/?since paging, invalid timestamp → 400, empty list |
| `apps/api/src/routes/notes/__tests__/delete-all.integration.test.ts` | 5 | hard purge, empty user, soft-deleted included in purge, 1001-row → 400, 1000-row boundary success |
| `apps/api/src/routes/notes/__tests__/search.integration.test.ts` | 8 | happy path with ts_rank score, multi-word phrase, operator-laden input survives, empty query 400, whitespace-only 400, 257-char rejection, soft-delete exclusion, cross-tenant RLS, limit clamp |
| `packages/contract-tests/src/notes.test.ts` | 10 | CONTRACT-01: CloudNote shape, idempotency, batch-create upstream shape, update/delete shape, list shape, search shape + empty-query 400, delete-all { deleted } or { error } envelope, 401-everywhere matrix |
| `tests/e2e/phase-05-notes.spec.ts` | 2 | live compose lifecycle: purge → create 3 → idempotency retry → list → search → soft-delete → list excludes → delete-all → list empty; 401-everywhere matrix |

Total: **72 tests** across unit + integration + contract + e2e layers.

## Verification

```bash
pnpm --filter @openwhispr/api test -- --run apps/api/src/lib/__tests__/keyset-pagination.test.ts apps/api/src/lib/__tests__/soft-delete.test.ts apps/api/src/lib/__tests__/client-id-upsert.test.ts
pnpm --filter @openwhispr/api test -- --run apps/api/src/routes/notes
pnpm --filter @openwhispr/contract-tests test -- --run src/notes.test.ts
E2E=1 make e2e-test SPEC=tests/e2e/phase-05-notes.spec.ts
```

These cannot execute inside the parallel-worktree sandbox (no
`node_modules` per the per-worktree protocol — `pnpm install` runs once
at the orchestrator level, then each executor's diff is fed to the
verifier with the populated tree). Mirrors the procedure documented in
05-02-SUMMARY and 05-04-SUMMARY.

### Acceptance criteria — grep audit

```
Task 1:
grep -E "Math\.min.*200"               apps/api/src/lib/keyset-pagination.ts   → PASS (limit clamp)
grep -E "\(created_at, id\)"           apps/api/src/lib/keyset-pagination.ts   → PASS (tuple compare doc + behavior)
grep -E "ON CONFLICT.*DO NOTHING"      apps/api/src/lib/client-id-upsert.ts    → PASS

Task 2:
grep -E "buildNotesCreateRoutes"       apps/api/src/routes/index.ts            → PASS
grep -E "buildNotesBatchCreateRoutes"  apps/api/src/routes/index.ts            → PASS
grep -E "buildNotesUpdateRoutes"       apps/api/src/routes/index.ts            → PASS
grep -E "buildNotesDeleteRoutes"       apps/api/src/routes/index.ts            → PASS
grep -E "buildNotesDeleteAllRoutes"    apps/api/src/routes/index.ts            → PASS
grep -E "buildNotesListRoutes"         apps/api/src/routes/index.ts            → PASS
grep -E "ON CONFLICT.*client_note_id"  apps/api/src/lib/client-id-upsert.ts +
                                       create.ts via the helper                 → PASS (helper emits clause)
grep -E "deleted_at..= NOW"            apps/api/src/routes/notes/delete.ts     → PASS
grep -E "1000|exceeds.*rows"           apps/api/src/routes/notes/delete-all.ts → PASS (MAX_INLINE_PURGE = 1000)
grep -E "parseListQuery|created_at.*DESC" apps/api/src/routes/notes/list.ts    → PASS
grep -E "500"                          apps/api/src/routes/notes/batch-create.ts → PASS (MAX_BATCH_SIZE = 500)

Task 3:
grep -E "websearch_to_tsquery\('simple'" apps/api/src/routes/notes/search.ts   → PASS
grep -E "ts_rank"                      apps/api/src/routes/notes/search.ts     → PASS
grep -E "buildNotesSearchRoutes"       apps/api/src/routes/index.ts            → PASS
File exists: packages/contract-tests/src/notes.test.ts                          → PASS
File exists: tests/e2e/phase-05-notes.spec.ts                                   → PASS
```

## Commits

| Task | SHA | Subject |
| --- | --- | --- |
| 1 | `0407f7d` | test+feat(05-05): shared CRUD helpers (keyset-pagination, soft-delete, client-id-upsert) WIRE-22 |
| 2 | `fc3c21d` | test+feat(05-05): notes CRUD routes (create, batch-create, update, delete, delete-all, list) WIRE-22 |
| 3 | `771f931` | test+feat(05-05): notes search route + contract + e2e WIRE-22 |

## Deviations from Plan

### Auto-applied adjustments

**1. [Rule 1 — Wire shape] `batch-create` returns `{ created: [{client_note_id, id}] }` (NOT `Array<CloudNote>`)**

- **Found during:** Task 2 — reading
  `~/openwhispr/src/services/NotesService.ts.batchCreate` for the
  upstream contract.
- **Issue:** The plan's `<behavior>` block says "POST /api/notes/batch-create
  body Array<NoteInput> (≤500) → Array<CloudNote> in input order". The
  upstream desktop client expects `{ created: [{client_note_id, id}] }`
  and POSTs `{ notes: NoteInput[] }` as the body wrapper. Returning
  Array<CloudNote> would break the desktop's `batchCreate` consumer
  (it destructures `data.created`, not the response root array). CLAUDE.md's
  byte-for-byte wire compatibility rule takes precedence over the plan's
  freehand `<behavior>` description.
- **Fix:** Body schema accepts BOTH `{ notes: [...] }` (canonical) AND
  bare `[...]` (forward-compat with the plan). Response always wraps
  `{ created: [...] }` with minimal `{client_note_id, id}` per row. Rows
  without `client_note_id` are silently dropped from the response (the
  desktop ignores those entries anyway). Documented in route header.
- **Files modified:** `apps/api/src/routes/notes/batch-create.ts`.
- **Commit:** Task 2 (`fc3c21d`).

**2. [Rule 2 — Critical functionality] Migration 0011 adds 11 CloudNote columns missed by Plan 01**

- **Found during:** Task 2 — drafting `create.ts` against
  `~/openwhispr/src/services/NotesService.ts.CloudNote` interface.
- **Issue:** Plan 01 shipped the wire-schemas Zod definitions for the
  full 19-field CloudNote (including `note_type`, `enhanced_content`,
  `enhancement_prompt`, `source_file`, `audio_duration_seconds`,
  `participants`, `calendar_event_id`, `diarization_enabled`,
  `expected_speaker_count`, `transcript`, `enhanced_at_content_hash`)
  but the `notes` table from 0007_notes_folders.sql only carries 12
  columns. With no place to persist the upstream fields, byte-for-byte
  wire conformance is impossible — Plan 5 can't ship WIRE-22 without
  these columns. This is a Rule 2 (critical missing functionality)
  fix: the plan implies a fully-shaped CloudNote round-trip but the
  underlying schema doesn't support it.
- **Fix:** New migration `0011_notes_cloud_columns.sql` — forward-only
  `ALTER TABLE notes ADD COLUMN IF NOT EXISTS …` for all 11 fields with
  safe defaults (`note_type NOT NULL DEFAULT 'personal'`; others
  nullable). Re-grants on `openwhispr_app`. Journal entry added.
  Drizzle schema `packages/data/src/schema/notes.ts` mirrors the new
  shape. tsvector `content_search` GENERATED column is unchanged per
  D-26 / Pitfall #1 (transcript text would explode the index).
- **Files modified:** `packages/data/migrations/0011_notes_cloud_columns.sql`,
  `packages/data/migrations/meta/_journal.json`,
  `packages/data/src/schema/notes.ts`.
- **Commit:** Task 2 (`fc3c21d`).

**3. [Rule 1 — Wire shape] `delete` returns `{ ok: true }`, NOT a CloudNote**

- **Found during:** Task 2 — reading upstream `NotesService.deleteNote`.
- **Issue:** Plan's `<behavior>` lists "200 {ok: true} (or CloudNote
  shape per client TS)". Upstream `cloudDelete<void>` discards the
  response body entirely; `{ ok: true }` is the convention used by the
  rest of our `/api/auth/*` routes and matches the desktop's
  `void`-return expectation. Returning a CloudNote on delete would
  re-introduce the just-deleted row's full shape into a context where
  the client is about to remove its local copy — confusing and wasteful.
- **Fix:** `delete.ts` returns `{ ok: true }`. Documented in route
  header. Contract test asserts the shape.
- **Commit:** Task 2 (`fc3c21d`).

**4. [Rule 1 — Wire shape] `delete-all` returns `{ deleted: number }`, NOT `{ deletedCount: number }`**

- **Found during:** Task 2 — reading upstream `NotesService.deleteAll`.
- **Issue:** Plan's `<behavior>` says "Return `{deletedCount: <count>}`".
  Upstream desktop destructures `data?.deleted ?? 0`, not `deletedCount`.
  Same byte-for-byte rule as Deviation #1.
- **Fix:** `delete-all.ts` returns `{ deleted: <count> }`.
- **Commit:** Task 2 (`fc3c21d`).

**5. [Rule 2 — Critical functionality] `notes/__tests__/setup.ts` shared boot helper instead of inlining the testcontainer boot 5 times**

- **Found during:** Task 2 — drafting `crud.integration.test.ts`.
- **Issue:** Plan 02's pattern is to inline the ~30-line testcontainer
  boot (CREATE ROLE openwhispr_owner + openwhispr_app, GRANT chain,
  ALTER OWNER, run migrate()) in every integration test file. Plan 05
  ships 5 integration files; inlining 5× would be 150 lines of
  duplicated boot logic that drifts independently per file.
- **Fix:** Centralized in `apps/api/src/routes/notes/__tests__/setup.ts`
  (single module, ~120 lines, exports `bootMigratedPostgres()` +
  `seedUser()` + `buildTestApp()`). Each test file is a thin shell that
  composes these. Mirrors Plan 02's intent without violating the
  per-worktree protocol (the helper lives under `apps/api/`, no
  cross-package import).
- **Files modified:** `apps/api/src/routes/notes/__tests__/setup.ts`.
- **Commit:** Task 2 (`fc3c21d`).

**6. [Rule 1 — Behavior] `update` PATCH errors with 404 on cross-tenant attempts (NOT 403)**

- **Found during:** Task 2 — drafting `update.ts`.
- **Issue:** Plan's `<behavior>` doesn't pin the cross-tenant response
  code. The intuitive answer is 403 (forbidden), but that confirms the
  row exists. Per CLAUDE.md security rule (never confirm row existence
  across tenants), the contract is that RLS-invisible rows are
  indistinguishable from "never existed" → 404.
- **Fix:** `WHERE id = $ AND user_id = $ AND deleted_at IS NULL` →
  0 rows → 404. Tested in `crud.integration.test.ts` (tenant B's UPDATE
  on tenant A's row → 404).
- **Commit:** Task 2 (`fc3c21d`).

**7. [Rule 1 — Search] `search` route's body schema is `.strict()` (NOT passthrough)**

- **Found during:** Task 3 — drafting `search.ts`.
- **Issue:** Per packages/contract-tests/src/schemas.ts convention,
  request schemas use `.strict()` to catch typos and reject
  mass-assignment surfaces. Search has only `query` + `limit` — a
  strict schema is appropriate.
- **Fix:** `SearchRequestSchema = z.object({...}).strict()`. Plus a
  pre-check on `query.trim().length < 1` BEFORE the zod parse, because
  `z.string().min(1)` accepts `"   "` (whitespace-only) which is
  semantically empty per Pitfall #3.
- **Commit:** Task 3 (`771f931`).

### Auth gates / human checkpoints

None encountered. Fully autonomous execution.

## Known Stubs

None. All 7 route handlers are real, fully-wired implementations against
real Postgres + Drizzle + production schemas. The shape.ts helper is a
pure data transformer. Migration 0011 is real, forward-only SQL.

## Out-of-scope Issues (logged, not fixed)

- **`update.ts` does NOT support `folder_id` reassignment with FK
  validation** — the current code accepts a `folder_id` change but the
  Postgres FK constraint will 500 on invalid folder IDs. A future
  hygiene pass should validate folder ownership (folder must belong to
  the same user) BEFORE the UPDATE. Logged for Plan 06 (folders) to
  potentially address as part of the folders CRUD shared validation.
- **`batch-create` per-row error handling** — if row N of a 500-item
  batch fails inside the transaction (e.g. invalid `folder_id`), the
  entire transaction rolls back. Upstream desktop may prefer per-row
  failure isolation; that requires a multi-tx approach or savepoints.
  Out-of-scope for v1; Phase 6 BullMQ async path is the natural place.
- **No `notes_history` audit table** — operator audit (who changed
  what when) is not required by WIRE-22 but will be needed for
  enterprise compliance. Deferred to a future plan.

## Threat Flags

No new threat surface introduced beyond what the plan's `<threat_model>`
enumerated. All `mitigate` dispositions addressed:

- **T-05-03** — `websearch_to_tsquery` never raises on user input; Zod
  caps query at 256 chars; search.integration.test.ts proves
  operator-laden input does not 500.
- **T-05-04** — batch-create capped at 500 items + 5 req/min/user
  rate-limit; delete-all capped at 1000 inline + 3 req/min/user.
- **T-05-06** — every read path uses `withSoftDelete()`;
  list/search/delete-all integration tests prove soft-deleted rows are
  invisible.
- **T-05-07** — partial UNIQUE on (tenant_id, user_id, client_note_id)
  from Plan 01 prevents cross-tenant client_note_id collision;
  crud.integration.test.ts proves tenant A and tenant B can both use
  `client_note_id='a-private'` independently.
- **T-DEL-ALL-DOS** — count-first gate before any DELETE; 1000-row
  cap; 400 envelope with operator-actionable message; rate-limit.

## Next Steps (Plans 06-09 unblocked)

- **Plan 06 (folders CRUD)** — drop in `keyset-pagination`,
  `soft-delete`, `client-id-upsert` helpers with `clientIdColumn:
  "client_folder_id"`, `table: "folders"`. No helper changes needed.
- **Plan 07 (conversations + messages CRUD)** — same pattern; messages
  needs the `client_message_id` partial UNIQUE that Plan 01 added
  (Deviation #4 from 05-01-SUMMARY).
- **Plan 08 (transcriptions CRUD)** — same pattern; transcriptions has
  both `client_transcription_id` (for client-side staging) and the
  Plan 01 `audio_duration_ms` extension.
- **Plan 09 (api-keys CRUD)** — slightly different — no
  `client_*_id` since keys are server-minted, but soft-delete via
  `revoked_at` + keyset list pattern transfers directly.

## Self-Check: PASSED

- File exists: `apps/api/src/lib/keyset-pagination.ts` — FOUND
- File exists: `apps/api/src/lib/soft-delete.ts` — FOUND
- File exists: `apps/api/src/lib/client-id-upsert.ts` — FOUND
- File exists: `apps/api/src/lib/__tests__/keyset-pagination.test.ts` — FOUND
- File exists: `apps/api/src/lib/__tests__/soft-delete.test.ts` — FOUND
- File exists: `apps/api/src/lib/__tests__/client-id-upsert.test.ts` — FOUND
- File exists: `apps/api/src/routes/notes/create.ts` — FOUND
- File exists: `apps/api/src/routes/notes/batch-create.ts` — FOUND
- File exists: `apps/api/src/routes/notes/update.ts` — FOUND
- File exists: `apps/api/src/routes/notes/delete.ts` — FOUND
- File exists: `apps/api/src/routes/notes/delete-all.ts` — FOUND
- File exists: `apps/api/src/routes/notes/list.ts` — FOUND
- File exists: `apps/api/src/routes/notes/search.ts` — FOUND
- File exists: `apps/api/src/routes/notes/shape.ts` — FOUND
- File exists: `apps/api/src/routes/notes/__tests__/setup.ts` — FOUND
- File exists: `apps/api/src/routes/notes/__tests__/crud.integration.test.ts` — FOUND
- File exists: `apps/api/src/routes/notes/__tests__/batch-create.integration.test.ts` — FOUND
- File exists: `apps/api/src/routes/notes/__tests__/list.integration.test.ts` — FOUND
- File exists: `apps/api/src/routes/notes/__tests__/delete-all.integration.test.ts` — FOUND
- File exists: `apps/api/src/routes/notes/__tests__/search.integration.test.ts` — FOUND
- File exists: `packages/contract-tests/src/notes.test.ts` — FOUND
- File exists: `tests/e2e/phase-05-notes.spec.ts` — FOUND
- File exists: `packages/data/migrations/0011_notes_cloud_columns.sql` — FOUND
- Commit `0407f7d` (Task 1) — FOUND in `git log`
- Commit `fc3c21d` (Task 2) — FOUND in `git log`
- Commit `771f931` (Task 3) — FOUND in `git log`
- `routes/index.ts` registers all 7 notes route factories — FOUND
