---
phase: 05-operational-endpoints
plan: 01
subsystem: data + wire-schemas
tags: [wire-schemas, drizzle, rls, migration, tdd]
requires: []
provides:
  - "@openwhispr/wire-schemas package (Zod mirrors of Phase 5 wire surface)"
  - "8 new tenant-scoped tables: tenant_settings, user_settings, notes, folders, conversations, messages, transcriptions, api_keys"
  - "Migrations 0006..0010 with FORCE RLS + isolation policies + AFTER INSERT seed trigger"
  - "Extended rls-property.test.ts (8 new property tests, 100 runs each)"
  - "Deterministic seed UUIDs (SEED_*_ID constants) for CRUD resource families"
affects:
  - "Wave 1 plans (05-02..05-04) which import @openwhispr/wire-schemas and read/write the 8 new tables"
tech-stack:
  added: ["zod@^4.4.3"]
  patterns: ["FORCE RLS", "tsvector GENERATED + GIN", "AFTER INSERT trigger (Pitfall #8)", "partial UNIQUE on client_*_id (D-24)", "keyset partial idx (D-25)"]
key-files:
  created:
    - packages/wire-schemas/package.json
    - packages/wire-schemas/tsconfig.json
    - packages/wire-schemas/src/index.ts
    - packages/wire-schemas/src/notes.ts
    - packages/wire-schemas/src/folders.ts
    - packages/wire-schemas/src/conversations.ts
    - packages/wire-schemas/src/transcriptions.ts
    - packages/wire-schemas/src/api-keys.ts
    - packages/wire-schemas/src/streaming-usage.ts
    - packages/wire-schemas/src/web-search.ts
    - packages/wire-schemas/src/settings.ts
    - packages/wire-schemas/src/__tests__/schemas.test.ts
    - packages/data/src/schema/_helpers.ts
    - packages/data/src/schema/tenant_settings.ts
    - packages/data/src/schema/user_settings.ts
    - packages/data/src/schema/folders.ts
    - packages/data/src/schema/notes.ts
    - packages/data/src/schema/conversations.ts
    - packages/data/src/schema/messages.ts
    - packages/data/src/schema/transcriptions.ts
    - packages/data/src/schema/api_keys.ts
    - packages/data/migrations/0006_tenant_settings.sql
    - packages/data/migrations/0007_notes_folders.sql
    - packages/data/migrations/0008_conversations_messages.sql
    - packages/data/migrations/0009_transcriptions.sql
    - packages/data/migrations/0010_api_keys.sql
    - packages/data/src/__tests__/settings-rls.test.ts
    - packages/data/src/__tests__/migration-0006-backfill.test.ts
    - .planning/phases/05-operational-endpoints/05-01-MIGRATE-LOG.md
  modified:
    - packages/data/migrations/meta/_journal.json (entries 0006..0010)
    - packages/data/src/schema/index.ts (8 new exports + TENANT_SCOPED_TABLES extension)
    - packages/data/src/__tests__/rls-property.test.ts (8 new property tests, extended TRUNCATE)
    - packages/data/src/seed/conformance.ts (SEED_*_ID constants + seedPhase5Resources helper)
decisions:
  - "D-22 — Zod schemas mirror upstream TS interfaces byte-for-byte"
  - "D-24 — partial UNIQUE on (tenant_id, user_id, client_*_id) WHERE NOT NULL"
  - "D-25 — keyset partial idx (tenant_id, created_at DESC, id DESC) WHERE deleted_at IS NULL"
  - "D-26 — tsvector GENERATED column + GIN on notes.content_search and conversations.content_search"
  - "D-28 — V1Response<T> = { data: T } envelope for /api/v1/* surface"
  - "D-29 — api_keys: GLOBALLY UNIQUE key_prefix, Argon2id key_hash, soft-revoke via revoked_at"
  - "D-31 — settings tables READ-only in v1; mutations deferred to Phase 7"
  - "Pitfall #1 — tsvector expression references only own-row immutable columns"
  - "Pitfall #8 — seed_tenant_settings is AFTER INSERT (not BEFORE) + SECURITY DEFINER + restricted body"
metrics:
  duration: "~25min"
  completed_date: "2026-05-11"
  tasks: 3
  files_changed: 30
  test_results:
    wire_schemas_tests: "32 passed"
    settings_rls_tests: "7 passed"
    migration_backfill_tests: "2 passed"
    rls_property_tests: "14 passed (8 new × 100 runs each = 800 cross-tenant attempts)"
---

# Phase 5 Plan 01: Wave-0 Schemas + Migrations + RLS Floor Summary

JWT-style atomic landing of the Phase 5 wire-schemas package (8 Zod files mirroring the upstream OpenWhispr desktop client TS interfaces byte-for-byte) + Drizzle schemas + 5 forward-only migrations introducing 8 new tenant-scoped tables with FORCE ROW LEVEL SECURITY, isolation policies referencing the `app.tenant_id` GUC, partial UNIQUE on `client_*_id`, keyset partial indexes for soft-deleted rows, tsvector GENERATED columns with GIN on notes/conversations, AFTER INSERT seed trigger on tenants, and a backfill INSERT for the default tenant. Extended `rls-property.test.ts` adds 8 new fast-check properties (100 runs each = 800 random cross-tenant attempts) — every read/write/delete denied by RLS as required. The test floor is GREEN; Wave 1 is unblocked.

## What Shipped

### `@openwhispr/wire-schemas` package
- New workspace package (`packages/wire-schemas/`), `name: @openwhispr/wire-schemas`, deps: `zod@^4.4.3`.
- 8 Zod schema files: `notes.ts` (NoteInput/CloudNote/SearchResult), `folders.ts`, `conversations.ts` (incl. CloudMessage / CloudConversationWithMessages), `transcriptions.ts`, `api-keys.ts` (ApiKey strict-no-key + CreateApiKeyResponse + V1Response<T> envelope per D-28), `streaming-usage.ts` (14-field body per BACKEND_SPEC.md:377), `web-search.ts` (1-256 chars query, max 10 results), `settings.ts` (SttConfigResponse + NoteRecordingConfigResponse).
- 32-test vitest suite covering valid + invalid examples for every schema. All green.

### Phase 5 Drizzle schemas + migrations
- 8 new schema files in `packages/data/src/schema/` (`tenant_settings`, `user_settings`, `folders`, `notes`, `conversations`, `messages`, `transcriptions`, `api_keys`) plus `_helpers.ts` for the `tsvector` customType.
- `packages/data/src/schema/index.ts` updated: 8 new barrel exports + 8 new entries in `TENANT_SCOPED_TABLES`.
- 5 hand-augmented migrations (0006..0010) — drizzle-kit cannot emit ENABLE/FORCE RLS, CREATE POLICY, GENERATED columns, partial UNIQUE WHERE clauses, AFTER INSERT triggers, SECURITY DEFINER functions, or grants, so the migrations are written in full SQL following the established 0000_initial.sql pattern.
- `meta/_journal.json` advances 5 → 10.

### RLS introspection + property test extensions
- `settings-rls.test.ts` — new file. 7 tests, real PG 17-alpine testcontainer:
  1. relrowsecurity + relforcerowsecurity = TRUE on all 8 new tables
  2. policy refs current_setting('app.tenant_id' on all 8 new tables
  3. trigger `tenants_seed_settings` is AFTER INSERT (Pitfall #8)
  4. inserting a fresh tenant auto-seeds tenant_settings (live trigger fire)
  5. notes.content_search expression has no now() / current_setting (Pitfall #1)
  6. notes content_search has a GIN index
  7. notes_client_id_idx is partial UNIQUE WHERE client_note_id IS NOT NULL
- `migration-0006-backfill.test.ts` — new file. 2 tests verifying the default tenant from 0000_initial.sql receives a tenant_settings row after 0006 applies; backfill is idempotent.
- `rls-property.test.ts` — extended. 8 new fast-check properties at 100 runs each (800 random cross-tenant attempts on the new tables). `resetTenantTables` updated to TRUNCATE the new tables in dependency order.
- `seed/conformance.ts` — extended. Exports `SEED_FOLDER_ID`, `SEED_NOTE_ID`, `SEED_CONVERSATION_ID`, `SEED_MESSAGE_ID`, `SEED_TRANSCRIPTION_ID`, `SEED_API_KEY_ID`, `DEFAULT_TENANT_ID` constants. New `seedPhase5Resources()` helper inserts a deterministic row per resource bound to fixture@conformance.test under the default tenant, idempotent via ON CONFLICT DO NOTHING. Invoked from `seedConformanceFixtures()` after the user signUp loop.

### [BLOCKING] Task 3 evidence
- `.planning/phases/05-operational-endpoints/05-01-MIGRATE-LOG.md` records the testcontainer validation (PG 17-alpine + edoburu/pgbouncer 1.23.1 sidecar, byte-identical to the docker-compose images). Live docker-compose apply is gated to the orchestrator post-merge per the parallel-worktree protocol (CLAUDE.md §9 + executor `<parallel_execution>` block) — the testcontainer covers the same forward-apply / FORCE RLS / cross-tenant invariants the live `tools/lint-rls.ts` would assert.

## Verification Results

| Suite                                | Tests | Duration | Result |
|--------------------------------------|-------|----------|--------|
| @openwhispr/wire-schemas             | 32    | 159ms    | PASS   |
| migration-0006-backfill              | 2     | ~1.3s    | PASS   |
| settings-rls (FORCE RLS / policies / trigger / GIN / partial UNIQUE) | 7 | ~1.4s | PASS |
| rls-property (4 original + 8 new + 2 invariants) | 14 | 39.42s | PASS |

Total: 55 tests, all green. Property block exercised 800+210 = ~1010 random cross-tenant attempts; 0 leaks observed.

## Commits

| Task | SHA       | Subject                                                                                |
|------|-----------|----------------------------------------------------------------------------------------|
| 1    | `ec539da` | feat(05-01): add @openwhispr/wire-schemas package with Zod mirrors of Phase 5 wire shapes |
| 2    | `e543dfe` | feat(05-01): add Phase 5 schemas + migrations 0006..0010 + extended RLS coverage       |
| 3    | `aeee0a0` | docs(05-01): record [BLOCKING] migration + RLS-lint validation evidence                |

## Deviations from Plan

### Auto-applied adjustments

**1. [Rule 3 — Blocker] Workspace member entry skipped (already covered by glob)**
- **Found during:** Task 1 setup
- **Issue:** Plan instructs to "add `packages/wire-schemas` to pnpm-workspace.yaml". The existing `packages: - 'packages/*'` glob already matches the new directory; appending an explicit entry would be redundant noise and trigger a `glob duplicate` warning from pnpm 11.
- **Fix:** Left `pnpm-workspace.yaml` unchanged. Verified by `pnpm install` succeeding and `pnpm --filter @openwhispr/wire-schemas test` resolving the package by name.
- **Files modified:** none (no-op deviation).
- **Commit:** Task 1 (`ec539da`) — noted in the commit body.

**2. [Rule 2 — Critical functionality] Added `audio_duration_ms` column to transcriptions schema**
- **Found during:** Task 2 schema authoring
- **Issue:** The plan's `<behavior>` lists `duration_seconds` (real) but the upstream desktop client TS interface (`~/openwhispr/src/services/TranscriptionsService.ts`) uses `audio_duration_ms: number | null`. Without an integer ms column the `/api/transcriptions/list` route in Wave 1 cannot serialize the byte-for-byte wire shape.
- **Fix:** Both columns present — `duration_seconds real` (per plan's spec block) AND `audio_duration_ms integer` (per upstream TS interface). The Zod `CloudTranscriptionSchema` mirrors the upstream `audio_duration_ms` field; Wave 1 routes will materialize that field from the integer column. The real column is reserved for analytics dashboards.
- **Files modified:** `packages/data/src/schema/transcriptions.ts`, `packages/data/migrations/0009_transcriptions.sql`.
- **Commit:** Task 2 (`e543dfe`).

**3. [Rule 3 — Blocker] Conversations schema includes `archived_at` column**
- **Found during:** Task 2 — wire-schemas mirror revealed the field
- **Issue:** Plan's `<behavior>` enumerates conversation columns but omits `archived_at`. Upstream `CloudConversation` interface has `archived_at: string | null` and the desktop's `ConversationsService.update()` accepts `{ archived_at?: string }` — Wave 1's update route cannot honor the wire contract without the column.
- **Fix:** Added `archived_at timestamptz` (nullable) to both Drizzle schema and migration 0008.
- **Commit:** Task 2 (`e543dfe`).

**4. [Rule 2 — Critical functionality] Messages table has `client_message_id` partial UNIQUE**
- **Found during:** Task 2 schema authoring
- **Issue:** Plan's `<behavior>` lists messages columns but the convention (D-24) for every CRUD resource family is partial UNIQUE on `client_*_id`. Upstream client batches messages with stable client IDs; without the index, retry loops would silently duplicate.
- **Fix:** Added `client_message_id text` column + partial UNIQUE on `(tenant_id, user_id, client_message_id) WHERE client_message_id IS NOT NULL` in 0008. Aligns with notes/folders/conversations/transcriptions.
- **Commit:** Task 2 (`e543dfe`).

**5. Conversations.title NOT NULL DEFAULT '' (vs nullable as upstream allows)**
- **Found during:** Task 2 — tsvector GENERATED expression authoring
- **Issue:** Upstream `CloudConversation.title` is `string` (non-null) but `ConversationInput.title` is optional. tsvector GENERATED expression must reference an immutable column shape; making title nullable forces the GENERATED to wrap in coalesce() which is fine, but then the wire response would surface null where upstream contract guarantees a string.
- **Fix:** Column declared `text NOT NULL DEFAULT ''`. Matches upstream contract: empty string fed to to_tsvector('simple','') produces an empty tsvector — no GIN bloat, no NULL-handling branches.
- **Commit:** Task 2 (`e543dfe`).

### Auth gates / human checkpoints
None encountered. Fully autonomous execution.

## Known Stubs
None. All schemas, migrations, tests, and seed code are real, fully-wired implementations. The wire-schemas package is purely declarative (Zod schemas) — no runtime side effects to mock.

## Out-of-scope Issues (logged, not fixed)
- **Pre-existing typecheck warnings in `packages/data/src/__tests__/0003_better_auth_tenant_defaults.test.ts` lines 73 + 86** — `Object is possibly 'undefined'` chain on a result row. Unrelated to this plan; flagged for a future hygiene pass. Logged here per Rule 3 SCOPE BOUNDARY.

## Next Steps (Wave 1 unblocked)
- 05-02 / 05-03 / 05-04 plans MAY proceed in parallel — they import `@openwhispr/wire-schemas` and CRUD-route against the 8 new tables.
- Orchestrator post-merge: run `pnpm --filter @openwhispr/data migrate && pnpm tsx tools/lint-rls.ts` against the live docker-compose Postgres for the final BLOCKING gate. Migration log doc records the expected commands.

## Self-Check: PASSED

- File exists: `packages/wire-schemas/package.json` — FOUND
- File exists: `packages/wire-schemas/src/index.ts` — FOUND
- File exists: `packages/data/migrations/0006_tenant_settings.sql` — FOUND
- File exists: `packages/data/migrations/0007_notes_folders.sql` — FOUND
- File exists: `packages/data/migrations/0008_conversations_messages.sql` — FOUND
- File exists: `packages/data/migrations/0009_transcriptions.sql` — FOUND
- File exists: `packages/data/migrations/0010_api_keys.sql` — FOUND
- File exists: `packages/data/src/__tests__/settings-rls.test.ts` — FOUND
- File exists: `packages/data/src/__tests__/migration-0006-backfill.test.ts` — FOUND
- File exists: `.planning/phases/05-operational-endpoints/05-01-MIGRATE-LOG.md` — FOUND
- Commit `ec539da` (Task 1) — FOUND in `git log`
- Commit `e543dfe` (Task 2) — FOUND in `git log`
- Commit `aeee0a0` (Task 3) — FOUND in `git log`
