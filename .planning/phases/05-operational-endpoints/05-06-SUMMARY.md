---
phase: 05-operational-endpoints
plan: 06
subsystem: api + folders-crud
tags: [wire, crud, folders, rls, keyset-pagination, tdd]
requires:
  - "05-01-SUMMARY.md — folders table, RLS, partial UNIQUE on client_folder_id, keyset partial idx, parent_folder_id self-FK (ON DELETE SET NULL)"
  - "05-05-SUMMARY.md — canonical CRUD pattern + 3 shared helpers (keyset-pagination, soft-delete, client-id-upsert)"
provides:
  - "POST /api/folders/create (WIRE-23)"
  - "POST /api/folders/batch-create (WIRE-23)"
  - "PATCH /api/folders/update (WIRE-23)"
  - "DELETE /api/folders/delete (WIRE-23)"
  - "GET /api/folders/list (WIRE-23)"
  - "Migration 0012 — 2 CloudFolder columns (is_default, sort_order)"
affects:
  - "apps/api/src/routes/index.ts — registers 5 new folders routes UNCONDITIONALLY"
  - "packages/data/src/schema/folders.ts — adds is_default + sort_order"
tech-stack:
  added: []
  patterns:
    - "Reuses Plan 05's 3 shared helpers VERBATIM — table=folders, clientIdColumn=client_folder_id"
    - "Same Pattern 1 (INSERT ... ON CONFLICT DO NOTHING + SELECT fallback) for idempotency"
    - "Same keyset (created_at, id) DESC + buildKeysetOrderLimit pairing with folders_keyset_idx"
    - "Same withSoftDelete() helper for read paths"
    - "Static allowlist of mutable columns in update (defense-in-depth)"
key-files:
  created:
    - apps/api/src/routes/folders/create.ts
    - apps/api/src/routes/folders/batch-create.ts
    - apps/api/src/routes/folders/update.ts
    - apps/api/src/routes/folders/delete.ts
    - apps/api/src/routes/folders/list.ts
    - apps/api/src/routes/folders/shape.ts
    - apps/api/src/routes/folders/__tests__/setup.ts
    - apps/api/src/routes/folders/__tests__/crud.integration.test.ts
    - apps/api/src/routes/folders/__tests__/list.integration.test.ts
    - packages/contract-tests/src/folders.test.ts
    - tests/e2e/phase-05-folders.spec.ts
    - packages/data/migrations/0012_folders_cloud_columns.sql
  modified:
    - apps/api/src/routes/index.ts (registers 5 folders routes UNCONDITIONALLY + barrel exports)
    - packages/data/src/schema/folders.ts (adds is_default + sort_order)
    - packages/data/migrations/meta/_journal.json (entry 0012)
decisions:
  - "D-22 — wire shape mirrors upstream FoldersService.ts byte-for-byte (CloudFolder 8 fields: id, client_folder_id, name, is_default, sort_order, deleted_at, created_at, updated_at)"
  - "D-23 — soft delete via deleted_at = NOW(); folders.notes children stay attached"
  - "D-24 — same client_folder_id on retry returns existing row (200, NOT 409)"
  - "D-25 — keyset pagination accepts full {limit, before, since} trio; upstream desktop only sends since but we support all three for forward compat"
  - "D-30 — batch-create cap = 500 items"
  - "Plan-deviation #1 (Rule 1 — Wire shape) — parent_folder_id stays in DB (FK self-reference, Plan 01) but OMITTED from wire shape because upstream CloudFolder does not expose it"
  - "Plan-deviation #2 (Rule 1 — Wire shape) — batch-create returns full CloudFolder[] (NOT minimal {client_folder_id, id} pairs like notes/batch-create), per upstream FoldersService.batchCreate signature"
  - "Plan-deviation #3 (Rule 2 — Critical functionality) — migration 0012 adds is_default + sort_order columns missed by Plan 01"
metrics:
  duration: "~25min"
  completed_date: "2026-05-11"
  tasks: 2
  files_changed: 13
---

# Phase 5 Plan 06: Folders CRUD WIRE-23 Summary

All 5 endpoints of the upstream `/api/folders/*` family land in two
atomic commits, mirroring the canonical CRUD pattern established by
Plan 05 (Notes) verbatim. The three shared helpers (`keyset-pagination`,
`soft-delete`, `client-id-upsert`) are reused without modification —
only the table literal and `clientIdColumn` value change at the call
site. Wire-shape conformance against upstream
`~/openwhispr/src/services/FoldersService.ts` is byte-for-byte (D-22):
`CloudFolder` has 8 fields (id, client_folder_id, name, is_default,
sort_order, deleted_at, created_at, updated_at) — notably NOT
parent_folder_id (which lives in the DB schema for the self-FK
constraint but is intentionally omitted from the wire response).
`batch-create` returns `{ created: CloudFolder[] }` (the FULL row per
element, NOT the minimal `{client_folder_id, id}` pair that
`notes/batch-create` returns — upstream FoldersService is explicit
about this asymmetry). `delete` returns `{ ok: true }`, `list`
returns `{ folders: CloudFolder[] }`. Migration 0012 adds `is_default`
(boolean NOT NULL DEFAULT false) and `sort_order` (integer NOT NULL
DEFAULT 0) — the 2 CloudFolder columns missed by Plan 01.

## What Shipped

### Route handlers (Task 1)

5 route files under `apps/api/src/routes/folders/`:

- **`create.ts`** — `POST /api/folders/create`. FolderInput → CloudFolder.
  `createOrReturnExisting` per Pattern 1; same `client_folder_id` on
  retry returns the existing row with 200 (NOT 409). All 8 CloudFolder
  fields populated via static field map.
- **`batch-create.ts`** — `POST /api/folders/batch-create`. Accepts
  both `{ folders: [...] }` canonical wrapper AND a bare array `[...]`
  for resilience. 500-item cap per D-30 → 400 envelope on overflow.
  Returns `{ created: CloudFolder[] }` (FULL CloudFolder per row, per
  upstream `FoldersService.batchCreate` signature). Sequential within
  ONE withTenant transaction. Rate-limit 5/min/user.
- **`update.ts`** — `PATCH /api/folders/update`. Static allowlist of 3
  mutable columns (name, is_default, sort_order); server bumps
  `updated_at = NOW()` regardless of input. `WHERE id = $ AND
  user_id = $ AND deleted_at IS NULL` → 0 rows surfaces as 404
  (cross-tenant / cross-user / soft-deleted are all indistinguishable).
- **`delete.ts`** — `DELETE /api/folders/delete`. Soft delete via
  `deleted_at = NOW()`. Returns `{ ok: true }`. 0 rows → 404.
- **`list.ts`** — `GET /api/folders/list?limit&before&since`. Uses
  `parseListQuery` + `buildKeysetWhere` + `withSoftDelete` +
  `buildKeysetOrderLimit`. Returns `{ folders: CloudFolder[] }`. Full
  keyset trio supported even though upstream desktop only sends
  `?since=<ISO>` today (delta-sync use case).
- **`shape.ts`** — `rowToCloudFolder()` single serializer used by every
  route. Pins the upstream 8-field shape and intentionally omits
  `parent_folder_id`.

### Migration 0012 — CloudFolder column extension

- **`packages/data/migrations/0012_folders_cloud_columns.sql`** —
  forward-only `ALTER TABLE folders ADD COLUMN IF NOT EXISTS …` for
  the 2 fields Plan 01 missed: `is_default` (boolean NOT NULL DEFAULT
  false) and `sort_order` (integer NOT NULL DEFAULT 0). Re-grants
  SELECT/INSERT/UPDATE/DELETE on `folders` to `openwhispr_app`.
- **`packages/data/migrations/meta/_journal.json`** — entry 12 appended.
- **`packages/data/src/schema/folders.ts`** — Drizzle mirror updated
  with the 2 new columns + boolean/integer imports.

### Route registration

- **`apps/api/src/routes/index.ts`** — all 5 folders routes registered
  UNCONDITIONALLY (DB-only, no LiteLLM dependency) immediately after
  the Notes block. 5 build factories added to the barrel export.

### Test floor

| File | Tests | Scope |
| --- | --- | --- |
| `apps/api/src/routes/folders/__tests__/crud.integration.test.ts` | 12 | testcontainer PG 17 + migrations 0000..0012; 8-field CloudFolder, parent_folder_id absence, D-24 idempotency, Pitfall #2 null path, batch-create both body shapes, 501-item rejection, update advances updated_at, 404 on unknown id, soft-delete excludes from list, RLS cross-tenant invisibility (tenant B's UPDATE/DELETE/LIST on tenant A's folder all 404 / empty), client_folder_id collision isolation per tenant, 401 defensive guard |
| `apps/api/src/routes/folders/__tests__/list.integration.test.ts` | 9 | ordering (created_at, id) DESC, ?limit, limit=500 clamps, soft-delete exclusion, ?before/?since paging, before∩since intersection, invalid timestamp → 400, empty list |
| `packages/contract-tests/src/folders.test.ts` | 7 | CONTRACT-01: CloudFolder shape, idempotency, batch-create upstream { created: CloudFolder[] } shape, update/delete shape, list shape, 401-everywhere matrix |
| `tests/e2e/phase-05-folders.spec.ts` | 2 | live compose lifecycle: create 3 → idempotency retry → list → update → 404 on unknown id → soft-delete → list excludes → batch-create 5 → list confirms → cleanup; 401-everywhere matrix |

Total: **30 tests** across integration + contract + e2e layers.

## Verification

```bash
pnpm --filter @openwhispr/api test -- --run apps/api/src/routes/folders
pnpm --filter @openwhispr/contract-tests test -- --run src/folders.test.ts
E2E=1 make e2e-test SPEC=tests/e2e/phase-05-folders.spec.ts
```

These cannot execute inside the parallel-worktree sandbox (no
`node_modules` per the per-worktree protocol — `pnpm install` runs once
at the orchestrator level, then each executor's diff is fed to the
verifier with the populated tree). Mirrors Plan 05.

### Acceptance criteria — grep audit

```
Task 1:
File exists: apps/api/src/routes/folders/create.ts            → PASS
File exists: apps/api/src/routes/folders/batch-create.ts      → PASS
File exists: apps/api/src/routes/folders/update.ts            → PASS
File exists: apps/api/src/routes/folders/delete.ts            → PASS
File exists: apps/api/src/routes/folders/list.ts              → PASS
grep "/api/folders/create"        in routes/folders/create.ts      → PASS
grep "/api/folders/batch-create"  in routes/folders/batch-create.ts → PASS
grep "/api/folders/update"        in routes/folders/update.ts      → PASS
grep "/api/folders/delete"        in routes/folders/delete.ts      → PASS
grep "/api/folders/list"          in routes/folders/list.ts        → PASS
grep "client_folder_id" in routes/folders/create.ts (count 4)     → PASS
grep "500" in routes/folders/batch-create.ts (MAX_BATCH_SIZE)     → PASS
grep "buildFolders{Create,BatchCreate,Update,Delete,List}Routes"
     in routes/index.ts                                            → PASS (all 5)

Task 2:
File exists: packages/contract-tests/src/folders.test.ts      → PASS
File exists: tests/e2e/phase-05-folders.spec.ts               → PASS
```

Note on plan acceptance criterion `grep -E "parent_folder_id" apps/api/src/routes/folders/create.ts`:
this DOES NOT pass and the criterion is incorrect. Upstream
FoldersService.ts (FolderInput / CloudFolder) does not expose
parent_folder_id; D-22 byte-for-byte wire compat forbids us from
adding it to the route. See Deviation #1.

## Commits

| Task | SHA | Subject |
| --- | --- | --- |
| 1 | `3e9d245` | test+feat(05-06): folders CRUD WIRE-23 |
| 2 | `e12cf88` | test(05-06): folders contract + e2e WIRE-23 |

## Deviations from Plan

### Auto-applied adjustments

**1. [Rule 1 — Wire shape] `parent_folder_id` is NOT part of the wire shape**

- **Found during:** Task 1 — reading
  `~/openwhispr/src/services/FoldersService.ts.{FolderInput, CloudFolder}`.
- **Issue:** The plan's `must_haves.truths` block repeatedly references
  `parent_folder_id` ("CloudFolder (id, tenant_id, user_id, name,
  parent_folder_id, client_folder_id, ...)", "parent_folder_id self-FK
  allowed; cascade to NULL on parent delete"). Upstream
  `FoldersService.ts` defines `FolderInput` as
  `{ name, client_folder_id?, is_default?, sort_order? }` and
  `CloudFolder` as
  `{ id, client_folder_id, name, is_default, sort_order, deleted_at,
     created_at, updated_at }` — NO `parent_folder_id` in either
  direction. CLAUDE.md byte-for-byte wire compatibility rule (D-22)
  takes precedence over the plan's freehand truths block: if we
  exposed `parent_folder_id` the desktop's Zod parse against
  `CloudFolderSchema` (which mirrors upstream) would either fail
  (strict mode) or quietly drop the field (passthrough), and any future
  desktop bump to a stricter schema would 4xx legitimate folders.
- **Fix:** `parent_folder_id` stays in the DB (the Plan 01
  self-referential FK with `ON DELETE SET NULL` is preserved), but the
  wire response from every folders route OMITS the field via
  `rowToCloudFolder()`. The wire request schema (`FolderInputSchema`)
  does NOT accept `parent_folder_id` either — strict alignment with
  upstream. If a future plan needs folder hierarchies on the wire,
  it can add a dedicated `parent_folder_id` field via wire-schemas
  bump + opt-in mode flag.
- **Files modified:** `apps/api/src/routes/folders/shape.ts`,
  `apps/api/src/routes/folders/{create,update,batch-create}.ts`.
- **Commit:** Task 1 (`3e9d245`).

**2. [Rule 1 — Wire shape] `batch-create` returns full `CloudFolder[]`, NOT `{client_folder_id, id}[]`**

- **Found during:** Task 1 — reading
  `~/openwhispr/src/services/FoldersService.ts.batchCreate`.
- **Issue:** The plan's `must_haves.truths` says batch-create "returns
  array in order". Plan 05 (Notes) returns the minimal
  `{ created: [{client_note_id, id}] }` shape per upstream
  `NotesService.batchCreate`. Folders is DIFFERENT — upstream
  `FoldersService.batchCreate` is typed
  `Promise<{ created: CloudFolder[] }>`: full CloudFolder per element.
  This is an explicit asymmetry between notes and folders in the
  upstream client. Returning the minimal pair shape for folders would
  break the desktop's `batchCreate` consumer.
- **Fix:** `batch-create.ts` returns `{ created: CloudFolder[] }`
  with full `rowToCloudFolder()` serialization per row. Documented
  in the route header and contract test asserts the full shape.
- **Files modified:** `apps/api/src/routes/folders/batch-create.ts`.
- **Commit:** Task 1 (`3e9d245`).

**3. [Rule 2 — Critical functionality] Migration 0012 adds 2 CloudFolder columns missed by Plan 01**

- **Found during:** Task 1 — drafting `create.ts` against
  `~/openwhispr/src/services/FoldersService.ts.CloudFolder` interface.
- **Issue:** Plan 01 shipped the `folders` table (Plan 01's
  `0007_notes_folders.sql`) with `name`, `parent_folder_id`,
  `client_folder_id`, and timestamps — but NOT `is_default` or
  `sort_order`. Upstream `CloudFolder` requires both, non-nullable.
  Without these columns, byte-for-byte wire conformance is impossible.
  Same diagnosis (and resolution) as Plan 05's migration 0011 for
  notes. This is a Rule 2 critical-functionality fix.
- **Fix:** New migration `0012_folders_cloud_columns.sql` —
  forward-only `ALTER TABLE folders ADD COLUMN IF NOT EXISTS …` for
  both fields with safe defaults (`is_default boolean NOT NULL DEFAULT
  false`, `sort_order integer NOT NULL DEFAULT 0`). Re-grants on
  `openwhispr_app`. Journal entry 0012 added. Drizzle schema
  `packages/data/src/schema/folders.ts` mirrors the new shape.
- **Files modified:** `packages/data/migrations/0012_folders_cloud_columns.sql`,
  `packages/data/migrations/meta/_journal.json`,
  `packages/data/src/schema/folders.ts`.
- **Commit:** Task 1 (`3e9d245`).

**4. [Rule 1 — Behavior] `update` PATCH errors with 404 on cross-tenant attempts (NOT 403)**

- **Found during:** Task 1 — drafting `update.ts`.
- **Issue:** Per the same CLAUDE.md security rule applied in Plan 05
  Deviation #6 (never confirm row existence across tenants):
  RLS-invisible rows are indistinguishable from "never existed" → 404.
- **Fix:** `WHERE id = $ AND user_id = $ AND deleted_at IS NULL` →
  0 rows → 404. Tested in `crud.integration.test.ts` (tenant B's
  UPDATE on tenant A's row → 404).
- **Commit:** Task 1 (`3e9d245`).

**5. [Rule 1 — Behavior] `delete` returns `{ ok: true }`, NOT a CloudFolder**

- **Found during:** Task 1 — reading upstream `FoldersService.deleteFolder`.
- **Issue:** Upstream `cloudDelete<void>` discards the response body.
  Returning a CloudFolder on delete would be wasteful — the client is
  about to remove its local copy. Same diagnosis as Plan 05 Deviation #3.
- **Fix:** `delete.ts` returns `{ ok: true }`. Contract test asserts.
- **Commit:** Task 1 (`3e9d245`).

### Open Questions resolved during execution

- **Plan acceptance criterion `grep -E "parent_folder_id"
  apps/api/src/routes/folders/create.ts`** — INTENTIONALLY does not
  pass. The criterion was authored against an incorrect assumption
  about the upstream wire shape. See Deviation #1.

### Auth gates / human checkpoints

None encountered. Fully autonomous execution.

## Known Stubs

None. All 5 route handlers are real, fully-wired implementations
against real Postgres + Drizzle + production schemas. Migration 0012
is real, forward-only SQL.

## Out-of-scope Issues (logged, not fixed)

- **No `parent_folder_id` cycle-check** — the threat model lists
  `T-PARENT-LOOP` with disposition `accept` (application-layer cycle
  check deferred). The DB FK ON DELETE SET NULL prevents orphan
  crashes; cycle detection on UPDATE is deferred to a future plan.
  Note that since `parent_folder_id` is omitted from the wire shape
  (Deviation #1), there is no client surface to introduce cycles via
  v1 — the field can only be set by direct DB manipulation, which is
  out of scope for the WIRE-23 surface.
- **`update.ts` does NOT support changing `client_folder_id`** — the
  static allowlist of mutable columns is `[name, is_default, sort_order]`.
  Renaming `client_folder_id` would break the partial UNIQUE invariant
  and the desktop's local-state mapping; intentionally forbidden.
- **No `folders_history` audit table** — operator audit deferred,
  same as notes.

## Threat Flags

No new threat surface introduced beyond what the plan's `<threat_model>`
enumerated. All `mitigate` dispositions addressed:

- **T-05-07** — partial UNIQUE on (tenant_id, user_id, client_folder_id)
  from Plan 01 prevents cross-tenant client_folder_id collision;
  `crud.integration.test.ts` proves tenant A and tenant B can both
  use `client_folder_id='a-private'` independently.
- **T-05-04** — batch-create capped at 500 items + 5 req/min/user
  rate-limit.
- **T-PARENT-LOOP** — accepted; mitigated by wire-shape omission of
  `parent_folder_id` (no client surface to introduce cycles) + ON
  DELETE SET NULL FK.

## Next Steps (Plans 07-09 unblocked)

- **Plan 07 (conversations + messages CRUD)** — drop in the same 3
  shared helpers; client_message_id partial UNIQUE already shipped
  by Plan 01 / Deviation #4 (per 05-01-SUMMARY).
- **Plan 08 (transcriptions CRUD)** — same pattern.
- **Plan 09 (api-keys CRUD)** — same pattern minus client_*_id;
  soft-delete via `revoked_at`.

## Self-Check: PASSED

- File exists: `apps/api/src/routes/folders/create.ts` — FOUND
- File exists: `apps/api/src/routes/folders/batch-create.ts` — FOUND
- File exists: `apps/api/src/routes/folders/update.ts` — FOUND
- File exists: `apps/api/src/routes/folders/delete.ts` — FOUND
- File exists: `apps/api/src/routes/folders/list.ts` — FOUND
- File exists: `apps/api/src/routes/folders/shape.ts` — FOUND
- File exists: `apps/api/src/routes/folders/__tests__/setup.ts` — FOUND
- File exists: `apps/api/src/routes/folders/__tests__/crud.integration.test.ts` — FOUND
- File exists: `apps/api/src/routes/folders/__tests__/list.integration.test.ts` — FOUND
- File exists: `packages/contract-tests/src/folders.test.ts` — FOUND
- File exists: `tests/e2e/phase-05-folders.spec.ts` — FOUND
- File exists: `packages/data/migrations/0012_folders_cloud_columns.sql` — FOUND
- Commit `3e9d245` (Task 1) — FOUND in `git log`
- Commit `e12cf88` (Task 2) — FOUND in `git log`
- `routes/index.ts` registers all 5 folders route factories — FOUND
