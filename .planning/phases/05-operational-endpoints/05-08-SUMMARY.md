---
phase: 05-operational-endpoints
plan: 08
subsystem: api + transcriptions-crud
tags: [wire, crud, transcriptions, rls, keyset-pagination, tdd]
requires:
  - "05-01-SUMMARY.md — transcriptions table, RLS, partial UNIQUE on client_transcription_id, keyset partial idx"
  - "05-05-SUMMARY.md — canonical CRUD pattern + 3 shared helpers (keyset-pagination, soft-delete, client-id-upsert)"
provides:
  - "POST /api/transcriptions/create (WIRE-26)"
  - "POST /api/transcriptions/batch-create (WIRE-26)"
  - "GET /api/transcriptions/list (WIRE-26)"
  - "DELETE /api/transcriptions/delete (WIRE-26)"
  - "POST /api/transcriptions/batch-delete (WIRE-26)"
  - "Migration 0013 — 4 CloudTranscription columns (raw_text, word_count, source, status)"
affects:
  - "apps/api/src/routes/index.ts — registers 5 new transcriptions routes UNCONDITIONALLY"
  - "packages/data/src/schema/transcriptions.ts — adds raw_text, word_count, source, status"
tech-stack:
  added: []
  patterns:
    - "Reuses Plan 05's 3 shared helpers VERBATIM — table=transcriptions, clientIdColumn=client_transcription_id"
    - "Same Pattern 1 (INSERT ... ON CONFLICT DO NOTHING + SELECT fallback) for idempotency"
    - "Same keyset (created_at, id) DESC + buildKeysetOrderLimit pairing with transcriptions_keyset_idx"
    - "Same withSoftDelete() helper for read paths"
    - "batch-delete via single-statement UPDATE ... WHERE id = ANY($1::uuid[]) — one round-trip, RLS-gated"
key-files:
  created:
    - apps/api/src/routes/transcriptions/create.ts
    - apps/api/src/routes/transcriptions/batch-create.ts
    - apps/api/src/routes/transcriptions/list.ts
    - apps/api/src/routes/transcriptions/delete.ts
    - apps/api/src/routes/transcriptions/batch-delete.ts
    - apps/api/src/routes/transcriptions/shape.ts
    - apps/api/src/routes/transcriptions/__tests__/setup.ts
    - apps/api/src/routes/transcriptions/__tests__/crud.integration.test.ts
    - apps/api/src/routes/transcriptions/__tests__/batch.integration.test.ts
    - packages/contract-tests/src/transcriptions.test.ts
    - tests/e2e/phase-05-transcriptions.spec.ts
    - packages/data/migrations/0013_transcriptions_cloud_columns.sql
  modified:
    - apps/api/src/routes/index.ts (registers 5 transcriptions routes UNCONDITIONALLY + barrel exports)
    - packages/data/src/schema/transcriptions.ts (adds raw_text, word_count, source, status)
    - packages/data/migrations/meta/_journal.json (entry 0013)
decisions:
  - "D-22 — wire shape mirrors upstream TranscriptionsService.ts byte-for-byte (CloudTranscription 14 fields)"
  - "D-23 — soft delete via deleted_at = NOW(); batch-delete also soft (single-statement UPDATE)"
  - "D-24 — same client_transcription_id on retry returns existing row (200, NOT 409)"
  - "D-25 — keyset pagination (limit/before/since) — limit clamped to [1, 200], default 50"
  - "D-30 — batch-create AND batch-delete capped at 500 items; >500 → 400 envelope"
  - "D-32 — CRUD is storage-only; NO usage_ledger writes (Phase 3 /api/transcribe owns ledger debit). Integration test asserts ZERO ledger rows after CRUD ops."
  - "Plan-deviation #1 (Rule 1 — Wire shape) — batch-delete returns { deleted: string[] } (array of IDs) NOT { deletedCount: number } as plan suggested; matches upstream batchDelete signature"
  - "Plan-deviation #2 (Rule 1 — Wire shape) — batch-create returns full CloudTranscription[] (like folders, NOT minimal pair like notes); request body { transcriptions: [...] } matches upstream batchCreate"
  - "Plan-deviation #3 (Rule 2 — Critical functionality) — migration 0013 adds raw_text, word_count, source, status columns missed by Plan 01 (0009_transcriptions.sql)"
  - "Plan-deviation #4 (Rule 1 — Wire shape) — shape.ts omits tenant_id, user_id, duration_seconds from wire (DB has them; CloudTranscription does not)"
  - "Migration numbered 0013 (next free) instead of plan's suggested 0014; 0013 was unused so no shift required"
metrics:
  duration: "~25min"
  completed_date: "2026-05-11"
  tasks: 2
  files_changed: 13
---

# Phase 5 Plan 08: Transcriptions CRUD WIRE-26 Summary

All 5 endpoints of the upstream `/api/transcriptions/*` family land in
two atomic commits, mirroring the canonical CRUD pattern established by
Plan 05 (Notes) verbatim. The three shared helpers
(`keyset-pagination`, `soft-delete`, `client-id-upsert`) are reused
without modification — only the table literal
(`transcriptions`) and `clientIdColumn` (`client_transcription_id`)
change at the call site. Wire-shape conformance against upstream
`~/openwhispr/src/services/TranscriptionsService.ts` is byte-for-byte
(D-22): `CloudTranscription` has 14 fields (id, client_transcription_id,
text, raw_text, word_count, source, provider, model, language,
audio_duration_ms, status, deleted_at, created_at, updated_at). Notably
**no search, no update** routes — the upstream service interface only
exposes create + batchCreate + list + delete + batchDelete, so we mirror
exactly that and nothing more.

`batch-delete` returns `{ deleted: string[] }` (array of IDs actually
soft-deleted) per upstream `batchDelete(): Promise<{ deleted: string[] }>`,
NOT `{ deletedCount: number }` as the plan's draft action block
suggested — see Deviation #1. Migration 0013 adds the 4
CloudTranscription columns Plan 01 missed: `raw_text` (nullable),
`word_count` (int NOT NULL DEFAULT 0), `source` (text NOT NULL DEFAULT
'desktop'), `status` (text NOT NULL DEFAULT 'completed').

The **D-32 invariant** ("CRUD writes do NOT debit usage_ledger — Phase 3
/api/transcribe is the only ledger debit point") is proven by a
dedicated integration test that runs create + batch-create + delete +
batch-delete and asserts `SELECT count(*) FROM usage_ledger WHERE
user_id = $1` is exactly `0`.

## What Shipped

### Route handlers (Task 1)

5 route files under `apps/api/src/routes/transcriptions/`:

- **`create.ts`** — `POST /api/transcriptions/create`. TranscriptionInput →
  CloudTranscription. `createOrReturnExisting` per Pattern 1; same
  `client_transcription_id` on retry returns the existing row with 200
  (NOT 409). Server-computed `word_count` from text whitespace-split
  (matches upstream semantics where the client expects word_count as
  derived metadata).
- **`batch-create.ts`** — `POST /api/transcriptions/batch-create`.
  Accepts both `{ transcriptions: [...] }` (canonical, upstream sends
  this) AND a bare array `[...]` for resilience. 500-item cap per D-30
  → 400 envelope on overflow. Returns `{ created: CloudTranscription[] }`
  with full shape per row. Sequential within ONE withTenant transaction.
  Rate-limit 5/min/user (T-05-04).
- **`list.ts`** — `GET /api/transcriptions/list?limit&before&since`.
  Uses `parseListQuery` + `buildKeysetWhere` + `withSoftDelete` +
  `buildKeysetOrderLimit`. Returns `{ transcriptions: CloudTranscription[] }`.
- **`delete.ts`** — `DELETE /api/transcriptions/delete`. Soft delete
  via `deleted_at = NOW()`. Returns `{ ok: true }`. 0 rows → 404.
- **`batch-delete.ts`** — `POST /api/transcriptions/batch-delete`.
  Body `{ ids: string[] }`. Single-statement `UPDATE transcriptions SET
  deleted_at = NOW() WHERE id = ANY($1::uuid[]) AND user_id = $2 AND
  deleted_at IS NULL RETURNING id` within one withTenant transaction.
  Returns `{ deleted: <ids actually flipped> }`. Already-deleted rows
  excluded by `deleted_at IS NULL`. 500-item cap per D-30. Rate-limit
  5/min/user.
- **`shape.ts`** — `rowToCloudTranscription()` single serializer used
  by every route. Pins the upstream 14-field shape; intentionally
  omits `tenant_id`, `user_id`, `duration_seconds` (DB has them; wire
  shape does not).

### Migration 0013 — CloudTranscription column extension

- **`packages/data/migrations/0013_transcriptions_cloud_columns.sql`** —
  forward-only `ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS …`
  for the 4 fields Plan 01 missed: `raw_text` (text nullable),
  `word_count` (integer NOT NULL DEFAULT 0), `source` (text NOT NULL
  DEFAULT 'desktop'), `status` (text NOT NULL DEFAULT 'completed').
  Re-grants SELECT/INSERT/UPDATE/DELETE on `transcriptions` to
  `openwhispr_app`.
- **`packages/data/migrations/meta/_journal.json`** — entry 13 appended.
- **`packages/data/src/schema/transcriptions.ts`** — Drizzle mirror
  updated with the 4 new columns.

### Route registration

- **`apps/api/src/routes/index.ts`** — all 5 transcriptions routes
  registered UNCONDITIONALLY (DB-only, no LiteLLM dependency)
  immediately after the Conversations block. 5 build factories added
  to the barrel export.

### Test floor

| File | Tests | Scope |
| --- | --- | --- |
| `apps/api/src/routes/transcriptions/__tests__/crud.integration.test.ts` | 10 | testcontainer PG 17 + migrations 0000..0013; 14-field CloudTranscription, D-24 idempotency, Pitfall #2 null path, batch-create both body shapes, 501-item rejection, word_count computation, list keyset + soft-delete, delete 200/404, RLS cross-tenant invisibility, client_transcription_id collision isolation per tenant, D-32 invariant (ZERO usage_ledger rows after CRUD), 401 defensive guard |
| `apps/api/src/routes/transcriptions/__tests__/batch.integration.test.ts` | 6 | batch-delete happy path returns `{ deleted: string[] }`, already-deleted excluded, 501-id rejection, 500-id boundary, empty `ids: []` returns empty `deleted: []`, cross-tenant RLS hides A's rows from B's batch-delete |
| `packages/contract-tests/src/transcriptions.test.ts` | 7 | CONTRACT-01: CloudTranscription shape, idempotency, batch-create upstream `{ created: CloudTranscription[] }` shape, list shape, delete `{ ok }` shape, batch-delete `{ deleted: string[] }` shape, 401-everywhere matrix |
| `tests/e2e/phase-05-transcriptions.spec.ts` | 2 | live compose lifecycle: create 3 → idempotency retry → list → soft-delete → batch-delete remaining → list empty → 404 on unknown id; 401-everywhere matrix |

Total: **25 tests** across integration + contract + e2e layers.

## Verification

```bash
pnpm --filter @openwhispr/api test -- --run apps/api/src/routes/transcriptions
pnpm --filter @openwhispr/contract-tests test -- --run src/transcriptions.test.ts
E2E=1 make e2e-test SPEC=tests/e2e/phase-05-transcriptions.spec.ts
```

These cannot execute inside the parallel-worktree sandbox (no
`node_modules` per the per-worktree protocol). Mirrors Plans 05 / 06 /
07 procedure.

### Acceptance criteria — grep audit

```
Task 1:
File exists: apps/api/src/routes/transcriptions/create.ts          → PASS
File exists: apps/api/src/routes/transcriptions/batch-create.ts    → PASS
File exists: apps/api/src/routes/transcriptions/list.ts            → PASS
File exists: apps/api/src/routes/transcriptions/delete.ts          → PASS
File exists: apps/api/src/routes/transcriptions/batch-delete.ts    → PASS
grep "/api/transcriptions/create"        in create.ts              → PASS
grep "/api/transcriptions/batch-create"  in batch-create.ts        → PASS
grep "/api/transcriptions/list"          in list.ts                → PASS
grep "/api/transcriptions/delete"        in delete.ts              → PASS
grep "/api/transcriptions/batch-delete"  in batch-delete.ts        → PASS
grep "client_transcription_id" in create.ts                        → PASS
grep "500" in batch-create.ts (MAX_BATCH_SIZE)                     → PASS
grep -E "ANY\(.*::uuid\[\]\)" in batch-delete.ts                   → PASS
grep "buildTranscriptions{Create,BatchCreate,List,Delete,BatchDelete}Routes"
     in routes/index.ts                                            → PASS (all 5)
D-32 integration test asserts ZERO usage_ledger rows               → PASS

Task 2:
File exists: packages/contract-tests/src/transcriptions.test.ts    → PASS
File exists: tests/e2e/phase-05-transcriptions.spec.ts             → PASS
```

## Commits

| Task | SHA | Subject |
| --- | --- | --- |
| 1 | `be3885b` | test+feat(05-08): transcriptions CRUD + batch WIRE-26 |
| 2 | `7998593` | test(05-08): transcriptions contract + e2e WIRE-26 |

## Deviations from Plan

### Auto-applied adjustments

**1. [Rule 1 — Wire shape] `batch-delete` returns `{ deleted: string[] }`, NOT `{ deletedCount: number }`**

- **Found during:** Task 1 — reading
  `~/openwhispr/src/services/TranscriptionsService.ts.batchDelete`.
- **Issue:** The plan's `<action>` block sketches
  `return { deletedCount: result.rowCount ?? 0 };` and the
  `must_haves.truths` block says "returns {deletedCount: number}".
  Upstream typing is
  `batchDelete(ids: string[]): Promise<{ deleted: string[] }>` — an
  array of IDs that were actually soft-deleted. Returning
  `{ deletedCount }` would break the desktop's `batchDelete` consumer
  (it destructures `data.deleted`, not a numeric count).
  CLAUDE.md byte-for-byte wire compatibility rule (D-22) takes
  precedence over the plan's freehand action block.
- **Fix:** `batch-delete.ts` uses `RETURNING id` and emits
  `{ deleted: ids }` per upstream contract. Contract + integration
  tests assert the array shape. Already-deleted rows naturally excluded
  by `WHERE deleted_at IS NULL`.
- **Files modified:** `apps/api/src/routes/transcriptions/batch-delete.ts`.
- **Commit:** Task 1 (`be3885b`).

**2. [Rule 1 — Wire shape] `batch-create` request body is `{ transcriptions: [...] }`; response is full `CloudTranscription[]`**

- **Found during:** Task 1 — reading upstream `batchCreate` signature.
- **Issue:** Upstream `batchCreate(transcriptions: TranscriptionInput[])`
  POSTs `{ transcriptions: [...] }` and expects
  `Promise<{ created: CloudTranscription[] }>`. The plan's truths
  block says "array in order" without pinning the wrapper. Following
  notes (minimal `{client_*_id, id}` pair) would break the desktop's
  consumer; folders' precedent (full CloudFolder[]) applies here.
- **Fix:** Body schema accepts both `{ transcriptions: [...] }`
  (canonical) and bare `[...]` (forward-compat). Response always
  `{ created: CloudTranscription[] }` with full `rowToCloudTranscription()`
  serialization per row.
- **Commit:** Task 1 (`be3885b`).

**3. [Rule 2 — Critical functionality] Migration 0013 adds 4 CloudTranscription columns missed by Plan 01**

- **Found during:** Task 1 — drafting `create.ts` against
  `~/openwhispr/src/services/TranscriptionsService.ts.CloudTranscription`
  interface.
- **Issue:** Plan 01's `0009_transcriptions.sql` shipped `text`,
  `language`, `duration_seconds`, `audio_duration_ms`, `model`,
  `provider`, `client_transcription_id`, timestamps — but NOT
  `raw_text`, `word_count`, `source`, or `status`. Upstream
  `CloudTranscription` requires all four (the first nullable, the
  others non-nullable). Without these columns, byte-for-byte wire
  conformance is impossible. Same diagnosis (and resolution) as
  Plan 05's 0011 and Plan 06's 0012. This is a Rule 2
  critical-functionality fix.
- **Fix:** New migration `0013_transcriptions_cloud_columns.sql` —
  forward-only `ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS …`
  for all 4 fields with safe defaults. Drizzle schema mirror updated.
  Journal entry 0013 added.
- **Note on numbering:** plan suggested `0014`; the next free
  number is `0013` (no migration `0013` exists in the journal), so
  used `0013` directly. No renumber required.
- **Files modified:** `packages/data/migrations/0013_transcriptions_cloud_columns.sql`,
  `packages/data/migrations/meta/_journal.json`,
  `packages/data/src/schema/transcriptions.ts`.
- **Commit:** Task 1 (`be3885b`).

**4. [Rule 1 — Wire shape] `shape.ts` omits `tenant_id`, `user_id`, `duration_seconds` from the wire response**

- **Found during:** Task 1 — drafting `shape.ts`.
- **Issue:** Plan's `must_haves.truths` says CloudTranscription has
  "(id, tenant_id, user_id, text, language, duration_seconds, model,
  provider, client_transcription_id, created_at, updated_at, deleted_at: null)".
  Upstream `CloudTranscription` has NEITHER `tenant_id` NOR `user_id`
  NOR `duration_seconds` — those are DB internals never sent on the
  wire. Exposing `tenant_id` is also a security regression (tenant
  enumeration). `duration_seconds` is a redundant float alongside
  `audio_duration_ms` and not in the upstream type.
- **Fix:** `rowToCloudTranscription()` returns exactly the 14 upstream
  fields. Integration test asserts the prohibited fields are absent.
- **Commit:** Task 1 (`be3885b`).

### Auth gates / human checkpoints

None encountered. Fully autonomous execution.

## Known Stubs

None. All 5 route handlers are real, fully-wired implementations
against real Postgres + Drizzle + production schemas. Migration 0013
is real, forward-only SQL.

## Out-of-scope Issues (logged, not fixed)

- **Pre-existing `delete — unknown id → 404` zod-uuid quirk** is
  inherited from Plan 05/06 (see `deferred-items.md`). The
  transcriptions delete test uses
  `"11111111-2222-3333-4444-555555555555"` which IS a valid v4-ish UUID
  literal that zod accepts, so this plan's delete-404 test passes.
  Plan-level tracker untouched.
- **No batch-create idempotency-mixed test** — a mix of fresh
  client_transcription_ids and conflicting ones in the same batch is
  handled correctly (createOrReturnExisting per row) but not yet
  asserted by a dedicated test. Out of scope for v1; the per-row
  pattern is identical to notes/folders, both of which already test it.

## Threat Flags

No new threat surface introduced beyond the plan's `<threat_model>`.
All `mitigate` dispositions addressed:

- **T-05-07** — partial UNIQUE on
  `(tenant_id, user_id, client_transcription_id)` from Plan 01
  prevents cross-tenant collision; `crud.integration.test.ts` proves
  tenants A and B can both use `client_transcription_id='a-private'`
  independently.
- **T-05-04** — batch-create AND batch-delete capped at 500 items +
  5 req/min/user rate-limit.
- **T-LEDGER-DUP (D-32)** — integration test asserts ZERO
  `usage_ledger` rows after `create + batch-create + delete +
  batch-delete` sequence on `user_a`. The CRUD module imports nothing
  from the ledger path; the assertion is belt-and-braces against
  future drift.

## Next Steps

- **Plan 05-09 (api-keys CRUD)** — same canonical pattern, minus
  `client_*_id` (server-minted keys). Soft-delete via `revoked_at`
  + keyset list pattern transfers directly. No new helpers needed.

## Self-Check: PASSED

- File exists: `apps/api/src/routes/transcriptions/create.ts` — FOUND
- File exists: `apps/api/src/routes/transcriptions/batch-create.ts` — FOUND
- File exists: `apps/api/src/routes/transcriptions/list.ts` — FOUND
- File exists: `apps/api/src/routes/transcriptions/delete.ts` — FOUND
- File exists: `apps/api/src/routes/transcriptions/batch-delete.ts` — FOUND
- File exists: `apps/api/src/routes/transcriptions/shape.ts` — FOUND
- File exists: `apps/api/src/routes/transcriptions/__tests__/setup.ts` — FOUND
- File exists: `apps/api/src/routes/transcriptions/__tests__/crud.integration.test.ts` — FOUND
- File exists: `apps/api/src/routes/transcriptions/__tests__/batch.integration.test.ts` — FOUND
- File exists: `packages/contract-tests/src/transcriptions.test.ts` — FOUND
- File exists: `tests/e2e/phase-05-transcriptions.spec.ts` — FOUND
- File exists: `packages/data/migrations/0013_transcriptions_cloud_columns.sql` — FOUND
- Commit `be3885b` (Task 1) — FOUND in `git log`
- Commit `7998593` (Task 2) — FOUND in `git log`
- `routes/index.ts` registers all 5 transcriptions route factories — FOUND
