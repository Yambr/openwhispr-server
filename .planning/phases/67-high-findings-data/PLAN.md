---
phase: 67-high-findings-data
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/data/migrations/0029_fk_user_id_indexes.sql
  - packages/data/migrations/0029_fk_user_id_indexes.down.sql
  - packages/data/migrations/meta/_journal.json
  - packages/data/migrations/__tests__/0029-fk-user-id-indexes.test.ts
  - packages/data/src/encryption/backfill.ts
  - packages/data/tests/unit/__tests__/backfill.test.ts
  - packages/data/src/encryption/index.ts
  - packages/data/src/schema/sessions.ts
  - packages/data/src/schema/accounts.ts
  - packages/data/src/schema/verifications.ts
  - packages/data/src/schema/audit_log.ts
  - packages/data/src/schema/usage_ledger.ts
  - packages/data/tests/unit/__tests__/encryption-barrel-surface.test.ts
  - docs/operations.md
  - docs/security.md
  - .planning/phases/67-high-findings-data/verify-first.log
  - .planning/review/data.md
  - .planning/review/REVIEW-INDEX.md
autonomous: true
requirements: ["HI-01", "HI-02", "HI-03", "HI-04", "HI-05", "HI-06"]

must_haves:
  truths:
    - "HI-01: docs/operations.md carries a 'Destructive forward migrations' runbook section naming migration 0005 — an operator upgrading a pre-0005 install with live sessions is warned all sessions are TRUNCATEd at 0005, with an explicit pre-flight check; migration 0005 SQL itself is UNCHANGED (CLAUDE.md hard rule 1)."
    - "HI-02: a NEW forward migration 0029 adds a dedicated leading-column index on user_id for transcriptions, conversations, messages, notes, folders — api_keys is EXCLUDED (its active-name index was rescoped to lead with user_id by migration 0028); the migration applies cleanly against a fresh testcontainer Postgres, has a 0029.down.sql, and a __tests__ migration test confirms the 5 indexes exist post-apply and lead with user_id."
    - "HI-03: docs/operations.md documents that after upgrading through migration 0014 the operator must let the partman-maintenance BullMQ job run (or run run_maintenance_proc() once manually) to promote legacy audit_log rows off audit_log_default; until then month-scoped audit queries miss legacy rows; migration 0014 SQL is UNCHANGED."
    - "HI-04: backfill.ts gains an explicit guard — runBackfill REFUSES to process any (table,column) the encryption lens already manages at write-time (account.{password,access_token,refresh_token,id_token}, session/sessions.token, session/sessions.previous_token, verification.value); the guard fires for those columns and is a no-op for any other column; the review's 'while ENCRYPTED_COLUMNS_MAP is empty' premise is STALE — Phase 57 Track A populated the map (auth.ts:172) so the lens encrypts those columns on write, making a bulk backfill both unnecessary and data-corrupting."
    - "HI-06: VaultKeyProvider and KmsKeyProvider are NO LONGER re-exported from packages/data/src/encryption/index.ts (the public barrel) — only selectProvider() reaches them internally, and the boot gate validateKeyProviderSelection() still refuses vault|kms; docs/security.md §12 corrected to state v1 supports OPENWHISPR_KEY_PROVIDER=env only, with KMS/Vault as a documented v2 roadmap item — code and docs agree."
    - "All 8 constitutional lockers green (pnpm lint:lockers); pnpm typecheck shows no new errors vs the documented 5-error baseline; pnpm --filter @openwhispr/data test green."
  artifacts:
    - path: ".planning/phases/67-high-findings-data/verify-first.log"
      provides: "per-finding still-live / already-closed disposition with file:line evidence for HI-01..HI-06; the HI-04 stale-premise correction; the HI-06 approach decision"
      contains: "HI-04"
    - path: "packages/data/migrations/0029_fk_user_id_indexes.sql"
      provides: "forward-only additive migration — leading-column user_id index on the 5 FK-cascade tables"
      contains: "CREATE INDEX"
    - path: "packages/data/migrations/0029_fk_user_id_indexes.down.sql"
      provides: "rollback companion dropping the 5 indexes"
      contains: "DROP INDEX"
    - path: "packages/data/src/encryption/backfill.ts"
      provides: "the lens-managed-column guard in runBackfill"
      contains: "LENS_MANAGED"
    - path: "docs/operations.md"
      provides: "HI-01 destructive-migration runbook + HI-03 partman-promotion runbook entries"
      contains: "0005"
    - path: ".planning/review/data.md"
      provides: "per-finding closure markers appended to HI-01..HI-06"
      contains: "CLOSED"
  key_links:
    - from: "packages/data/migrations/0029_fk_user_id_indexes.sql"
      to: "transcriptions/conversations/messages/notes/folders user_id"
      via: "CREATE INDEX <tbl>_user_id_idx ON <tbl> (user_id)"
      pattern: "CREATE INDEX"
    - from: "packages/data/src/encryption/backfill.ts"
      to: "ENCRYPTED_COLUMNS_MAP-equivalent lens-managed column set"
      via: "guard that throws before SELECT for lens-managed (table,column) pairs"
      pattern: "LENS_MANAGED"
    - from: "packages/data/src/encryption/index.ts"
      to: "selectProvider() only — Vault/Kms no longer on the public barrel"
      via: "removed re-export lines"
      pattern: "selectProvider"
---

<objective>
Clear the 6 HIGH findings (HI-01..HI-06) in `packages/data`
(`.planning/review/data.md`). data CR-01..CR-05 (CRITICAL) were closed in
Phases 57–58 and are out of scope; data MEDIUM/LOW (ME-01..07, LO-01..05) are
out of scope.

This cluster is a deliberate MIX:

- **HI-01, HI-03, HI-05 — doc/runbook items.** The remediation is an operator
  runbook entry or a schema-file comment. The referenced migrations
  (`0005`, `0014`, `0000`, `0001`) are ALREADY APPLIED — CLAUDE.md hard rule 1
  forbids editing them. NO migration SQL changes. Doc commits; each doc must
  be accurate against the migration it describes.
- **HI-02 — a NEW forward migration** (`0029`) + `.down.sql` + a migration
  test (real testcontainer Postgres). Strict TDD: the migration test is the
  RED, the migration file the GREEN.
- **HI-04, HI-06 — code fixes** via strict RED→GREEN TDD.

Each finding is re-verified against current `main` BEFORE any fix (CLAUDE.md
hard rule 3). Planner pre-determination, which the executor MUST re-confirm
via the verify-first protocol:

- **HI-01 — STILL LIVE (doc gap).** `0005_session_token_plain.sql:33` —
  `TRUNCATE TABLE "sessions";` unconditional, inside the migrator's
  per-migration transaction. Migration 0021 added `_safe_table_reset(...)`
  to prevent recurrence but cannot retroactively fix 0005. `0005` has NO
  `.down.sql`. Remediation: a `docs/operations.md` runbook entry. NO SQL edit.
- **HI-02 — STILL LIVE (5 of 6 tables).** Confirmed: `transcriptions`,
  `conversations`, `messages`, `notes`, `folders` each declare
  `user_id uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE` and the
  ONLY indexes touching `user_id` are composite indexes LED BY `tenant_id`
  (`<tbl>_client_id_idx` = `(tenant_id, user_id, client_*_id)`) — none has
  `user_id` as the leading column, so `DELETE FROM users` seq-scans all five.
  **CORRECTION to the review/CONTEXT:** `api_keys` is NO LONGER affected —
  migration 0028 (Phase 59) rescoped `api_keys_active_name_idx` from
  `(tenant_id, name)` to `(user_id, name)`, which IS a leading-`user_id`
  index sufficient for the FK cascade scan. HI-02's migration therefore
  covers the **5 remaining tables only**, not 6. Next free migration number
  is **`0029`** (journal max idx = 29, tag `0028_api_keys_name_scope`).
- **HI-03 — STILL LIVE (doc gap).** `0014_audit_log_partition.sql:118-138` —
  legacy rows `INSERT`ed into the partitioned parent; rows predating the
  premade monthly partitions land in `audit_log_default`; the migration's
  own comment defers promotion to the daily partman-maintenance BullMQ job.
  Remediation: a `docs/operations.md` runbook entry. NO SQL edit.
- **HI-04 — STILL LIVE, but the review's PREMISE IS STALE.** `backfill.ts`
  has NO guard; `runBackfill` will process any column in the supplied
  column-map. The review framed the guard as "refuse while
  `ENCRYPTED_COLUMNS_MAP` is empty" — that is **out of date**: Phase 57
  Track A populated `ENCRYPTED_COLUMNS_MAP` (`apps/api/src/auth.ts:172` —
  `account.{password,access_token,refresh_token,id_token}`, `session.token`,
  `session.previous_token`, `verification.value`). The lens NOW encrypts
  those columns on write. So the real, correct guard condition is: refuse to
  bulk-backfill any column the lens already manages at write-time — running
  the backfill on those columns is unnecessary (the lens already did it) and
  data-corrupting (plaintext + ciphertext coexist; a later lens read
  silently overwrites Better Auth's live plaintext). The guard is a static
  refuse-list of the lens-managed (table,column) pairs — independent of the
  runtime emptiness of any map. Defence-in-depth for LOCKER-08.
- **HI-05 — STILL LIVE (doc gap).** `0000_initial.sql:78-80` — `audit_log`,
  `usage_ledger`, `sessions` `tenant_id → tenants.id` are `ON DELETE NO ACTION`;
  `0001_better_auth.sql:43,67` — `account` / `verification` `REFERENCES
  "tenants"("id")` with NO `ON DELETE` clause → PG defaults to `NO ACTION`.
  Correct for the append-only / identity posture but undocumented.
  Remediation: schema-file comments on the 5 affected `pgTable` declarations
  + a `docs/operations.md` tenant-delete note. NO migration edit.
- **HI-06 — STILL LIVE.** `encryption/index.ts:39` re-exports
  `VaultKeyProvider`, `:32` re-exports `KmsKeyProvider`; both stubs throw
  `NOT_IMPLEMENTED`. `selectProvider()` (`key-provider.ts:49-57`)
  instantiates them internally; `validateKeyProviderSelection()`
  (`boot.ts:104-109`) refuses `OPENWHISPR_KEY_PROVIDER=vault|kms` at boot.
  `docs/security.md §12.5` describes AWS/GCP/Azure/Vault KMS recipes —
  docs-vs-code drift on what v1 supports. **Approach chosen — lean (a):**
  stop re-exporting the two stubs from the public barrel (`selectProvider()`
  still reaches them — they stay in their own files), and correct
  `docs/security.md §12` to state v1 supports `OPENWHISPR_KEY_PROVIDER=env`
  only, with KMS/Vault sourcing of `MASTER_KEK` (already a v1-supported env
  path) kept and the `vault`/`kms` *providers* marked v2-roadmap. The
  boot-gate already enforces `env`-only; the misleading public-barrel export
  and the docs claim are the actual drift. Constructor-throw (option b) is
  rejected — it does not remove the misleading public surface.

Each live code finding (HI-02, HI-04, HI-06) is closed via strict RED→GREEN
TDD; the RED asserts the regression-shape; test + production code may land in
the same atomic commit. Doc findings (HI-01, HI-03, HI-05) land as doc
commits — no test, but the doc/comment is verified accurate against the
migration it describes.

Purpose: clear the pre-publication data-layer HIGH backlog — a destructive
upgrade surprise (HI-01), an FK-cascade seq-scan that hurts at 1000-user
load-test scale (HI-02), an invisible-legacy-audit-rows operator trap (HI-03),
a data-corrupting backfill recovery path (HI-04), an undocumented
tenant-delete failure mode (HI-05), and a misleading "production-grade KMS"
public surface (HI-06).

Output: per-finding doc/RED+GREEN atomic commits, a `verify-first.log`
evidence record, and `.planning/review/data.md` + `REVIEW-INDEX.md` annotated
with per-finding closure markers.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/67-high-findings-data/CONTEXT.md
@.planning/review/data.md
@CLAUDE.md

Already-read source (facts captured below — do NOT re-read whole files to
"check one more thing"; use Grep for anything more specific):

- **Migration runner tx posture (decides HI-02 `CONCURRENTLY` vs plain).**
  `packages/data/src/migrate.ts:218` runs Drizzle `migrate()`. Drizzle's
  `migrate()` wraps EACH migration file in a transaction — confirmed
  independently by `0014_audit_log_partition.sql:124-126`'s own comment
  ("the migration runner wraps each migration in a transaction"). Therefore
  `CREATE INDEX CONCURRENTLY` is ILLEGAL inside a migration file — HI-02
  MUST use plain `CREATE INDEX`. The migrate runner connects DIRECT to
  Postgres (refuses a `pgbouncer` host, `migrate.ts:181-186`), so a
  migration-time plain index build is fine.
- **HI-02 — the 5 affected tables (all confirmed):**
  `0009_transcriptions.sql:7` `transcriptions.user_id`;
  `0008_conversations_messages.sql:8` `conversations.user_id`, `:49`
  `messages.user_id`; `0007_notes_folders.sql:9` `folders.user_id`, `:49`
  `notes.user_id`. Each is `uuid NOT NULL REFERENCES "users"("id") ON DELETE
  CASCADE`. Existing indexes per table: a `<tbl>_client_id_idx` UNIQUE
  partial on `(tenant_id, user_id, client_*_id)` and a `<tbl>_keyset_idx` on
  `(tenant_id, created_at DESC, id DESC)` — neither leads with `user_id`.
  `messages` additionally has `messages_conversation_idx` on
  `(conversation_id, ...)` — also not `user_id`-leading. `api_keys` EXCLUDED:
  `0028_api_keys_name_scope.sql` rescoped `api_keys_active_name_idx` to
  `(user_id, name) WHERE revoked_at IS NULL` — a leading-`user_id` index.
- **HI-02 — naming + format.** Follow `0028_api_keys_name_scope.sql`:
  `-- SPDX-License-Identifier: FSL-1.1-ALv2` header, a rationale comment
  block, `--> statement-breakpoint` between statements,
  `CREATE INDEX IF NOT EXISTS` for idempotency. Index name convention:
  `<tbl>_user_id_idx`. The `.down.sql` companion does `DROP INDEX IF EXISTS`
  for each. `_journal.json` MUST gain an `idx: 30` entry tagged
  `0029_fk_user_id_indexes` — run `pnpm --filter @openwhispr/data drizzle-kit
  generate` ONLY if the project uses generation; otherwise hand-add the
  journal entry mirroring the `idx: 29` block (`version: "7"`,
  `breakpoints: true`, a `when` epoch-ms after 1781366400000). Confirm in the
  verify step which path the repo uses (`grep -rn "drizzle-kit" package.json
  packages/data/package.json`).
- **HI-04 — `backfill.ts`.** `runBackfill(opts)` loops
  `Object.entries(opts.columnMap)` → `Object.entries(cols)`; for each
  `(table, column)` it builds `idempotencyWhere = '"<col>" IS NOT NULL AND
  "<col>_value_ciphertext" IS NULL'` and either counts (dryRun) or
  SELECT/encrypt/UPDATEs in batches. NO guard exists. The CLI default map
  `DEFAULT_COLUMN_MAP` (`cli/backfill-encrypt-credentials.ts:36`) STILL lists
  `account.{access_token,refresh_token,id_token,password}`,
  `verification.value`, `sessions.{token,previous_token}`,
  `oauth_state.code_verifier` — i.e. the CLI would feed the lens-managed
  columns straight into `runBackfill`. The guard belongs in `runBackfill`
  (the chokepoint) so BOTH the CLI and any programmatic caller hit it.
  Lens-managed pairs (from `ENCRYPTED_COLUMNS_MAP`, `apps/api/src/auth.ts:172`):
  `account` × {`password`,`access_token`,`refresh_token`,`id_token`},
  `session` × {`token`,`previous_token`}, `verification` × {`value`}.
  NOTE the table-name skew: `ENCRYPTED_COLUMNS_MAP` keys the sessions model
  as `session` (singular, Better Auth model name) while the SQL table and the
  backfill `DEFAULT_COLUMN_MAP` use `sessions` (plural). The guard MUST match
  BOTH `session` and `sessions` for the token columns. `oauth_state.code_verifier`
  is NOT lens-managed (it uses the manual codec) and is NOT in the refuse-list.
- **HI-06 — `encryption/index.ts`.** Line ~32 `export { KmsKeyProvider }
  from "./kms-key-provider.js";` and line ~39 `export { VaultKeyProvider }
  from "./vault-key-provider.js";` — these two lines are DELETED.
  `selectProvider()` (`key-provider.ts:17-18,49-57`) imports the two classes
  DIRECTLY from their own files — unaffected by the barrel change.
  `boot.ts` exports (`validateKeyProviderSelection` etc.) stay. The provider
  stub FILES (`vault-key-provider.ts`, `kms-key-provider.ts`) are NOT
  deleted — only their barrel re-export. `docs/security.md §12.5` ("KMS
  provisioning recipes", lines ~474-518) describes AWS/GCP/Azure/Vault — that
  prose stays as a way to SOURCE `MASTER_KEK` via the `env` path (it already
  reads "fetches the raw bytes once at deploy time and exports them via the
  env path"), but §12 must explicitly state the `OPENWHISPR_KEY_PROVIDER`
  *provider* dispatch supports `env` only in v1 and `vault`/`kms` are
  v2-roadmap stubs refused at boot.
- **HI-01.** `0005_session_token_plain.sql:33` `TRUNCATE TABLE "sessions";`.
  No `.down.sql` for 0005.
- **HI-03.** `0014_audit_log_partition.sql:118-138` `INSERT INTO "audit_log"
  SELECT ... FROM "audit_log_legacy"` then `DROP TABLE "audit_log_legacy"`.
- **HI-05.** `0000_initial.sql:78-84` audit_log + usage_ledger + sessions
  (`:70-72`) `ON DELETE no action`; `0001_better_auth.sql:43,67` account +
  verification `REFERENCES "tenants"("id")` with no clause → `NO ACTION`.
  Schema files: `audit_log.ts:52-54` `.references(() => tenants.id)` (no
  `onDelete`), same shape in `usage_ledger.ts`, `sessions.ts`, `accounts.ts`,
  `verifications.ts`.

<interfaces>
packages/data/src/encryption/backfill.ts:
  export async function runBackfill(opts: RunBackfillOpts): Promise<BackfillReport>
  RunBackfillOpts { ownerPool: Pool; keyProvider: KeyProvider;
                    columnMap: BackfillColumnMap; dryRun?: boolean;
                    batchSize?: number; logger?: {...} }
  // HI-04 GREEN: add a module-const LENS_MANAGED refuse-set and throw at the
  // top of the (table,column) loop body BEFORE the dryRun branch / any SQL.

packages/data/src/__tests__/helpers.ts:
  bootMigratedPostgres({ withPgPartman?: boolean }): Promise<BootResult>
  BootResult { ownerUri: string; appUri?: string; stop(): Promise<void> }
  // HI-02 migration test uses this — same harness as 0016-users-locale.test.ts.

packages/data/src/encryption/index.ts — public barrel.
  // HI-06 GREEN: remove the `export { KmsKeyProvider }` and
  // `export { VaultKeyProvider }` lines. Everything else stays.
</interfaces>

`packages/data` unit + migration tests run under vitest; DB-touching tests use
a REAL Postgres 17 (+ pg_partman) testcontainer via `bootMigratedPostgres`
(`src/__tests__/helpers.ts`) — see `migrations/__tests__/0016-users-locale.test.ts`,
`0018-rls-fail-closed.test.ts` as templates. NO mocks of internal logic — the
backfill guard test (HI-04) and the migration test (HI-02) both run against
real Postgres. The HI-06 barrel test is a pure module-surface assertion (no DB).
</context>

## Phase Goal

Close HI-01..HI-06 — HI-02/HI-04/HI-06 each fixed via strict RED→GREEN TDD with
the test asserting the regression-shape; HI-01/HI-03/HI-05 closed via accurate
doc/comment commits. No applied migration SQL is edited (CLAUDE.md hard rule 1).

---

## Verify-first protocol (MANDATORY, all findings)

Before any fix the executor writes
`.planning/phases/67-high-findings-data/verify-first.log` and, per finding,
records **still-live / partially-mitigated / already-closed** with the
`file:line` evidence checked:

```
grep -n 'TRUNCATE TABLE "sessions"' packages/data/migrations/0005_session_token_plain.sql   # HI-01
ls packages/data/migrations/0005*.down.sql                                                 # HI-01 — expect absent
grep -nE 'user_id|CREATE.*INDEX' packages/data/migrations/0007_notes_folders.sql \
  packages/data/migrations/0008_conversations_messages.sql \
  packages/data/migrations/0009_transcriptions.sql                                         # HI-02 — 5 tables, no user_id-leading idx
grep -n 'api_keys_active_name_idx' packages/data/migrations/0028_api_keys_name_scope.sql    # HI-02 — confirm api_keys EXCLUDED
tail -8 packages/data/migrations/meta/_journal.json                                        # HI-02 — confirm next idx = 30, next tag 0029
grep -n 'audit_log_legacy\|audit_log_default' packages/data/migrations/0014_audit_log_partition.sql  # HI-03
grep -n 'idempotencyWhere\|LENS_MANAGED' packages/data/src/encryption/backfill.ts          # HI-04 — guard expected ABSENT
grep -n 'ENCRYPTED_COLUMNS_MAP' apps/api/src/auth.ts                                       # HI-04 — confirm map is POPULATED (stale-premise check)
grep -nE 'ON DELETE no action|REFERENCES "tenants"' packages/data/migrations/0000_initial.sql packages/data/migrations/0001_better_auth.sql  # HI-05
grep -n 'KmsKeyProvider\|VaultKeyProvider' packages/data/src/encryption/index.ts           # HI-06 — expect 2 re-export lines
grep -n 'vault\|kms\|VaultKeyProvider' packages/data/src/encryption/key-provider.ts        # HI-06 — selectProvider reaches them directly
```

**HI-04 STALE-PREMISE CHECK (mandatory, explicit):** `grep -n
'ENCRYPTED_COLUMNS_MAP' apps/api/src/auth.ts` MUST show the map is POPULATED
(an `account:`/`session:`/`verification:` object literal at `:172`, NOT `{}`).
If it is populated → the review's "while `ENCRYPTED_COLUMNS_MAP` is empty"
framing is confirmed STALE; design the HI-04 guard as a static refuse-list of
lens-managed (table,column) pairs (independent of any runtime map emptiness),
and RECORD this correction in `verify-first.log`. If — unexpectedly — the map
is `{}`, STOP and report the divergence; the guard semantics change.

Each finding is expected STILL LIVE. If any other grep contradicts the
pre-determination, STOP, treat per the evidence, record it in
`verify-first.log`, adjust the affected task, and report the divergence in the
SUMMARY.

Commit the log: `docs(67-01): verify-first — HI-01..HI-06 disposition log`.

---

## Task 1 — HI-02: forward migration 0029 — leading user_id FK indexes

**Finding:** HI-02 (HIGH) — `transcriptions/conversations/messages/notes/folders`
`.user_id` is a `NOT NULL ON DELETE CASCADE` FK with no leading-`user_id`
index → `DELETE FROM users` seq-scans each. New forward migration. `api_keys`
is EXCLUDED (0028 already gave it a leading-`user_id` index).

**Type:** code fix (new migration) — strict TDD. The migration test is RED;
the migration file is GREEN.

### RED step
- New test `packages/data/migrations/__tests__/0029-fk-user-id-indexes.test.ts`.
  Test names MUST contain `HI-02`. Use the `bootMigratedPostgres({
  withPgPartman: false })` harness (mirror `0016-users-locale.test.ts`).
- **RED 1 — indexes exist.** For each of the 5 tables, query `pg_indexes`
  (`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = $1`) and
  assert there is an index whose `indexdef` has `user_id` as the FIRST
  indexed column (e.g. matches `/\(user_id\b/`). Pre-migration this fails for
  all 5.
- **RED 2 — cascade-delete coverage.** Optional but recommended: insert a
  tenant + user + a child row in one table, `DELETE FROM users WHERE id = $1`
  via the owner pool, assert it succeeds (the cascade still works) — a
  behavioural smoke that the new index does not break the FK. Keep it light.
- The RED initially fails because migration 0029 does not exist yet. Commit:
  `test(67-01): red — HI-02 FK user_id indexes missing on 5 cascade tables`.

### GREEN step
- New `packages/data/migrations/0029_fk_user_id_indexes.sql`. Header
  `-- SPDX-License-Identifier: FSL-1.1-ALv2` + a rationale comment block
  (HIGH HI-02; FK cascade seq-scan; api_keys excluded — 0028). One statement
  per table, separated by `--> statement-breakpoint`:
  `CREATE INDEX IF NOT EXISTS "transcriptions_user_id_idx" ON "transcriptions" ("user_id");`
  and the same for `conversations`, `messages`, `notes`, `folders`. Plain
  `CREATE INDEX` — NOT `CONCURRENTLY` (the runner wraps each migration in a
  transaction; `CONCURRENTLY` would error 25001).
- New `packages/data/migrations/0029_fk_user_id_indexes.down.sql`:
  `DROP INDEX IF EXISTS "<tbl>_user_id_idx";` for each of the 5, separated by
  `--> statement-breakpoint`.
- Register the migration in `packages/data/migrations/meta/_journal.json`:
  add an `idx: 30` entry, `version: "7"`, `tag: "0029_fk_user_id_indexes"`,
  `breakpoints: true`, `when` an epoch-ms value strictly greater than the
  `idx: 29` entry's `1781366400000`. In the verify step confirm whether the
  repo regenerates the journal via `drizzle-kit generate` (`grep -rn
  "drizzle-kit" packages/data/package.json`) — if generation is the project
  convention, run it and hand-author only the SQL body; otherwise hand-add
  the journal block. Either way the final SQL body is the hand-authored
  index DDL above (drizzle-kit's auto-diff would not produce these exact
  partial-free indexes reliably — author them).
- Optionally add the 5 indexes to the corresponding `pgTable` definitions in
  `packages/data/src/schema/{transcriptions,conversations,messages,notes,folders}.ts`
  via `index("<tbl>_user_id_idx").on(t.userId)` so the Drizzle schema stays
  in sync — do this ONLY if those schema files already declare their other
  indexes inline (mirror the existing pattern); if they do not, skip and note
  it. This is schema-definition parity, not a migration edit.
- Commit: `feat(67-01): green — HI-02 add leading user_id FK indexes (0029)`.

### Verify
```
ls packages/data/migrations/0029_fk_user_id_indexes.sql packages/data/migrations/0029_fk_user_id_indexes.down.sql
grep -c "CREATE INDEX" packages/data/migrations/0029_fk_user_id_indexes.sql        # 5
grep -c "DROP INDEX"   packages/data/migrations/0029_fk_user_id_indexes.down.sql   # 5
grep -c "CONCURRENTLY" packages/data/migrations/0029_fk_user_id_indexes.sql        # 0
grep -n "0029_fk_user_id_indexes" packages/data/migrations/meta/_journal.json
pnpm --filter @openwhispr/data test -- 0029-fk-user-id-indexes
```

### Done
HI-02: migration `0029` applies cleanly against a fresh testcontainer Postgres;
all 5 tables gain a leading-`user_id` index; `0029.down.sql` exists; the
migration test (`HI-02`-named) is green; `api_keys` confirmed already covered
by 0028 and excluded.

---

## Task 2 — HI-04: backfill lens-managed-column guard

**Finding:** HI-04 (HIGH) — `backfill.ts` has no guard; running `runBackfill`
on a lens-managed credential column encrypts into sidecars while LEAVING the
plaintext populated → plaintext + ciphertext coexist; a later lens read
silently overwrites Better Auth's live plaintext. The review's "while
`ENCRYPTED_COLUMNS_MAP` is empty" premise is STALE (Phase 57 Track A populated
the map) — the correct guard is a static refuse-list of lens-managed columns.

**Type:** code fix — strict RED→GREEN TDD.

### RED step
- New test(s) in `packages/data/tests/unit/__tests__/backfill.test.ts` (extend
  the existing file). Test names MUST contain `HI-04`.
- **RED 1 — guard refuses a lens-managed column.** Call `runBackfill` with a
  `columnMap` of `{ account: { access_token: {} } }` (and separately
  `{ sessions: { token: {...} } }`, `{ verification: { value: {} } }` —
  cover the table-name skew: `session` AND `sessions`). Use a real
  testcontainer owner pool from `bootMigratedPostgres` and a real
  `EnvKeyProvider`. Assert `runBackfill` **rejects/throws** with a recognizable
  guard error (message names the offending `table.column` and explains the
  lens manages it at write-time). Pre-fix it runs the SELECT/encrypt loop → RED
  fails (no throw).
- **RED 2 — guard is a no-op for a non-lens column.** Call `runBackfill` with
  a `columnMap` for a column NOT in the refuse-list (e.g. a throwaway test
  table/column, or `oauth_state.code_verifier` which is codec-managed not
  lens-managed) and assert it does NOT throw the guard error (it may legitimately
  fail later on a missing column — assert specifically the guard error is
  absent). Pre-fix trivially passes; post-fix it must STILL pass — this pins
  the guard's scope so it does not over-block.
- Commit: `test(67-01): red — HI-04 backfill lacks lens-managed-column guard`.

### GREEN step
- `backfill.ts` — add a module-level const, e.g.
  `const LENS_MANAGED_COLUMNS: ReadonlyArray<readonly [string, string]>` (or a
  `ReadonlySet` of `\`${table}.${column}\`` keys) enumerating the lens-managed
  pairs: `account.password`, `account.access_token`, `account.refresh_token`,
  `account.id_token`, `session.token`, `sessions.token`,
  `session.previous_token`, `sessions.previous_token`, `verification.value`.
  A short doc comment MUST state this list mirrors `ENCRYPTED_COLUMNS_MAP`
  (`apps/api/src/auth.ts`) — the lens encrypts these on write post-Phase-57,
  so a bulk backfill is unnecessary and corrupting — and reference HI-04.
- In `runBackfill`, at the TOP of the `for (const [column, cfg] of
  Object.entries(cols))` body — BEFORE the `dryRun` branch and any SQL —
  throw an `Error` if `(table, column)` is in `LENS_MANAGED_COLUMNS`. The
  message: refuse to backfill a lens-managed credential column; the
  encryption lens encrypts it at write-time; bulk backfill would corrupt the
  row (plaintext + ciphertext coexisting).
- Do NOT change `DEFAULT_COLUMN_MAP` in the CLI — leaving it as-is means the
  default CLI invocation now fails LOUDLY at the guard instead of silently
  corrupting. (If the executor judges the CLI default map should be narrowed
  to only non-lens columns, that is acceptable and additive — record the
  choice in `verify-first.log`. The guard in `runBackfill` is the
  non-negotiable chokepoint.)
- Commit: `fix(67-01): green — HI-04 guard backfill against lens-managed columns`.

### Verify
```
grep -n "LENS_MANAGED" packages/data/src/encryption/backfill.ts
pnpm --filter @openwhispr/data test -- backfill
pnpm lint:lockers
```

### Done
HI-04: `runBackfill` refuses any lens-managed credential column (both `session`
and `sessions` table-name forms) with a clear error; it remains a no-op guard
for non-lens columns; the stale-premise correction is recorded in
`verify-first.log`. Defence-in-depth for LOCKER-08.

---

## Task 3 — HI-06: stop public-barrel export of KMS/Vault stubs + correct docs

**Finding:** HI-06 (HIGH) — `encryption/index.ts` re-exports the
`VaultKeyProvider` / `KmsKeyProvider` stubs as if production-grade;
`docs/security.md §12` describes KMS/Vault as available. Approach (a): remove
the barrel re-exports (keep them internal to `selectProvider()`); correct the
docs.

**Type:** code fix + doc correction — strict RED→GREEN TDD for the code part.

### RED step
- New test `packages/data/tests/unit/__tests__/encryption-barrel-surface.test.ts`.
  Test names MUST contain `HI-06`. Pure module-surface assertion — no DB.
- **RED 1 — barrel surface.** `import * as barrel from
  "../../../src/encryption/index.js";` Assert `barrel.VaultKeyProvider` is
  `undefined` AND `barrel.KmsKeyProvider` is `undefined`. Pre-fix both are
  defined → RED fails.
- **RED 2 — internal reachability preserved.** Assert `selectProvider` is
  still exported from the barrel and is a function (the dispatcher that
  internally reaches the stubs stays). This pins that the fix removes only
  the misleading direct export, not the dispatch path.
- Commit: `test(67-01): red — HI-06 KMS/Vault stubs exported from public barrel`.

### GREEN step
- `packages/data/src/encryption/index.ts` — DELETE the
  `export { KmsKeyProvider } from "./kms-key-provider.js";` and
  `export { VaultKeyProvider } from "./vault-key-provider.js";` lines. Leave
  every other export (incl. `selectProvider`, `EnvKeyProvider`, the `boot.ts`
  re-exports) intact. The stub FILES are NOT deleted —
  `key-provider.ts::selectProvider()` imports them directly from their own
  modules.
- Run `grep -rn "VaultKeyProvider\|KmsKeyProvider" --include=*.ts apps packages`
  to find any importer that pulled the stubs FROM the barrel
  (`@openwhispr/data` / `@openwhispr/data/encryption`). The only legitimate
  importer is `key-provider.ts` (direct file import — unaffected). If a test
  or other module imports them via the barrel, repoint it to the direct file
  path or delete the dead import. Record findings in the SUMMARY.
- `docs/security.md §12` — correct the docs-vs-code drift. In §12 (and §12.5
  "KMS provisioning recipes"): state explicitly that v1 supports
  `OPENWHISPR_KEY_PROVIDER=env` ONLY; `vault` and `kms` are stub providers
  refused at boot by `validateKeyProviderSelection()` and are a documented v2
  roadmap item. Keep the AWS/GCP/Azure/Vault recipes BUT frame them
  unambiguously as ways to SOURCE the `MASTER_KEK` bytes and export them via
  the `env` provider path (the existing §12.5 lead sentence already says
  this — make the v1-`env`-only constraint explicit, not implied). Verify the
  edited prose matches `boot.ts::validateKeyProviderSelection` behaviour.
- Commit: `fix(67-01): green — HI-06 unexport KMS/Vault stubs, correct security.md §12`.

### Verify
```
grep -c "KmsKeyProvider\|VaultKeyProvider" packages/data/src/encryption/index.ts   # 0
grep -rn "VaultKeyProvider\|KmsKeyProvider" --include=*.ts packages/data/src        # only kms/vault/key-provider files
grep -n "OPENWHISPR_KEY_PROVIDER" docs/security.md
pnpm --filter @openwhispr/data test -- encryption-barrel-surface
pnpm lint:lockers
pnpm typecheck
```

### Done
HI-06: `VaultKeyProvider` / `KmsKeyProvider` no longer on the public barrel;
`selectProvider()` still reaches them; the boot gate still refuses
`vault|kms`; `docs/security.md §12` states v1 supports `env` only with
KMS/Vault as v2-roadmap — code and docs agree.

---

## Task 4 — HI-01 + HI-03 + HI-05: operator runbook + schema-comment doc fixes

**Findings:** HI-01, HI-03, HI-05 — all doc/runbook items. The referenced
migrations are applied; per CLAUDE.md hard rule 1 they are NOT edited. No
tests — but each doc/comment is verified accurate against the migration it
describes.

**Type:** doc commits (no RED/GREEN).

### HI-01 — destructive forward migration runbook
- `docs/operations.md` — add a section, e.g. `## Destructive forward
  migrations`. Document migration `0005_session_token_plain.sql`: it runs an
  unconditional `TRUNCATE TABLE "sessions"` inside the migrator transaction.
  Pre-flight check for an operator upgrading an install that predates 0005:
  expect ALL active sessions to be cleared at 0005 (every user is logged out;
  desktop clients must re-authenticate). State `0005` has no `.down.sql` —
  truncated rows are unrecoverable; recommend the operator schedule the
  upgrade in a maintenance window. Note migration 0021's `_safe_table_reset()`
  prevents recurrence but cannot retroactively fix 0005. Reference HI-01.
- Accuracy check: `grep -n 'TRUNCATE' packages/data/migrations/0005_*.sql`
  before writing — the doc must name the exact migration + behaviour.

### HI-03 — partman legacy-row promotion runbook
- `docs/operations.md` — add a section, e.g. `## Audit-log partition
  maintenance after upgrade`. Document that migration `0014` copies legacy
  `audit_log` rows into the partitioned parent; rows predating the premade
  monthly partitions land in the `audit_log_default` catch-all. After
  upgrading through 0014 the operator MUST ensure the daily
  `partman-maintenance` BullMQ job runs (or run `SELECT run_maintenance_proc()`
  / `partman.partition_data_proc(...)` once manually, OUTSIDE a transaction)
  to promote those legacy rows into bounded monthly children. Until then,
  month-scoped audit queries silently miss legacy rows. Reference HI-03.
- Accuracy check: `grep -n 'audit_log_default\|run_maintenance' packages/data/migrations/0014_*.sql`.

### HI-05 — `ON DELETE NO ACTION` tenant-FK semantics
- Schema-file comments: add a doc comment to the `pgTable` declaration (near
  the `tenantId` column / `references(() => tenants.id)` call) in EACH of:
  `packages/data/src/schema/audit_log.ts`, `usage_ledger.ts`, `sessions.ts`,
  `accounts.ts`, `verifications.ts`. The comment states: the `tenant_id → tenants.id`
  FK is `ON DELETE NO ACTION` (audit_log/usage_ledger: append-only audit
  posture — a tenant cannot be deleted while audit/usage rows exist;
  sessions/account/verification: identity-table posture) — this is
  DELIBERATE, unlike the sibling `CASCADE` tenant FKs on
  notes/folders/conversations/messages/transcriptions/api_keys. Reference HI-05.
  These are comment-only edits to schema TS files — NOT migration edits, NOT
  `.references()` behaviour changes (the runtime FK is unchanged; the SQL
  already declares `NO ACTION`).
- `docs/operations.md` — add a short `## Tenant deletion` note: deleting a
  tenant fails with an FK violation if any `audit_log` / `usage_ledger` /
  `sessions` / `account` / `verification` row references it; the operator
  must purge or archive those rows first (append-only audit data should be
  exported, not silently dropped). Reference HI-05.
- Accuracy check: `grep -nE 'ON DELETE no action' packages/data/migrations/0000_initial.sql`
  and confirm `0001_better_auth.sql:43,67` `account`/`verification` reference
  `tenants` with no `ON DELETE` clause (PG default `NO ACTION`).

### Commit
- Single doc commit (the three findings are all docs, cohesive):
  `docs(67-01): runbook + schema comments for HI-01/HI-03/HI-05`.

### Done
`docs/operations.md` carries the destructive-migration, partman-promotion, and
tenant-deletion sections; the 5 schema files carry the `NO ACTION` rationale
comment; every doc/comment verified accurate against its migration; NO
migration SQL edited.

---

## Task 5 — annotate the review artifacts (FINAL TASK)

After Tasks 1–4 are green/verified:

- `.planning/review/data.md` — append a closure marker line under each of
  HI-01..HI-06: `**Status:** CLOSED 2026-05-21 — Phase 67, commit <sha> —
  <one-line fix summary>.` HI-02 notes `api_keys` was already covered by 0028
  and excluded; HI-04 notes the stale-premise correction (the guard is a
  static lens-managed refuse-list, not an `ENCRYPTED_COLUMNS_MAP`-emptiness
  check); HI-06 notes approach (a) — barrel unexport + docs correction.
  data ME-01..07 / LO-01..05 remain open — out of scope.
- `.planning/review/REVIEW-INDEX.md` — update the `packages/data` per-package
  roll-up row: `HIGH 6 → 0 (✅ Phase 67)` (mirror how Phase 62/64/65/66
  closures are marked); note CR-01..05 already closed by Phases 57–58.
- Commit: `docs(67-01): annotate data review with HI-01..HI-06 closure`.

### Done
Both review artifacts carry per-finding closure markers; `git log` shows the
annotation commit.

---

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| operator upgrade path → applied migration 0005 | An operator upgrading a pre-0005 install crosses an unconditional `TRUNCATE sessions` with no warning (HI-01). |
| `DELETE FROM users` → FK-cascade child tables | A user-delete crosses into a full seq-scan of 5 child tables at 1000-user scale (HI-02). |
| operator upgrade path → partman default partition | Legacy audit rows cross into an invisible `audit_log_default` partition until a maintenance job runs (HI-03). |
| backfill CLI / programmatic caller → Better-Auth credential columns | A recovery-step backfill crosses into plaintext+ciphertext coexistence that a later lens read silently overwrites — Better Auth's live credential is destroyed (HI-04). |
| operator tenant-delete → `NO ACTION` tenant FKs | A tenant deletion crosses an undocumented FK violation, surprising the operator (HI-05). |
| downstream importer → `@openwhispr/data/encryption` public barrel | A downstream package crosses into a constructible-but-broken KMS/Vault stub presented as production-grade (HI-06). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-67-01 | Denial of Service (data loss) | migration 0005 TRUNCATE on upgrade | mitigate | Task 4 documents 0005 as a destructive forward migration with an explicit pre-flight check so an operator schedules a maintenance window — no silent session wipe. |
| T-67-02 | Denial of Service | `DELETE FROM users` FK cascade seq-scan | mitigate | Task 1 adds leading-`user_id` indexes on the 5 cascade tables so the cascade enforcement is index-backed at 1000-user scale. |
| T-67-03 | Information disclosure (data invisibility) | partman `audit_log_default` legacy rows | mitigate | Task 4 documents the mandatory post-0014 partman-maintenance run so month-scoped audit queries are complete. |
| T-67-04 | Tampering (credential corruption) | backfill on lens-managed columns | mitigate | Task 2 adds a `runBackfill` guard that refuses lens-managed credential columns — a recovery backfill can no longer corrupt Better Auth's live credentials. Defence-in-depth for LOCKER-08. |
| T-67-05 | Repudiation | undocumented `NO ACTION` tenant FKs | mitigate | Task 4 documents the deliberate `NO ACTION` tenant-delete semantics in 5 schema files + the operations runbook. |
| T-67-06 | Spoofing (false capability) | KMS/Vault stubs on the public barrel | mitigate | Task 3 removes the misleading public-barrel export and corrects `docs/security.md §12` to state v1 = `env`-only — code and docs agree; the boot gate still refuses `vault|kms`. |
</threat_model>

<verification>
Phase-level gate (run after all tasks):

```
pnpm --filter @openwhispr/data test
pnpm lint:lockers          # 8 lockers green (LOCKER-08 unchanged — HI-04 is
                           # defence-in-depth, no allowlist change)
pnpm typecheck             # no NEW errors vs the documented 5-error baseline
git log --oneline -15      # verify-first log + HI-02/04/06 RED/GREEN pairs +
                           # the HI-01/03/05 doc commit + the annotation commit
```

Spot-check (CLAUDE.md hard rule 3 — verify, do not relay):
- `grep -rn "HI-02\|HI-04\|HI-06" packages/data --include="*.test.ts"` — each
  code-fixed finding has a test referencing its ID.
- `git diff --name-only <phase-base>..HEAD -- packages/data/migrations/0000_initial.sql packages/data/migrations/0005_session_token_plain.sql packages/data/migrations/0010_api_keys.sql packages/data/migrations/0014_audit_log_partition.sql packages/data/migrations/0001_better_auth.sql`
  — MUST be EMPTY (no applied migration edited — CLAUDE.md hard rule 1).
- `ls packages/data/migrations/0029_fk_user_id_indexes.sql packages/data/migrations/0029_fk_user_id_indexes.down.sql` — both exist.
- `grep -c "CREATE INDEX" packages/data/migrations/0029_fk_user_id_indexes.sql` — `5`.
- `grep -c "CONCURRENTLY" packages/data/migrations/0029_fk_user_id_indexes.sql` — `0`.
- `grep -n "0029_fk_user_id_indexes" packages/data/migrations/meta/_journal.json` — registered.
- `grep -n "LENS_MANAGED" packages/data/src/encryption/backfill.ts` — guard present.
- `grep -c "KmsKeyProvider\|VaultKeyProvider" packages/data/src/encryption/index.ts` — `0`.
- `grep -n "OPENWHISPR_KEY_PROVIDER" docs/security.md` — §12 states `env`-only.
- `grep -n "0005\|partman\|Tenant deletion" docs/operations.md` — HI-01/03/05 sections present.
- `grep -rn "NO ACTION\|no action" packages/data/src/schema/audit_log.ts packages/data/src/schema/usage_ledger.ts packages/data/src/schema/sessions.ts packages/data/src/schema/accounts.ts packages/data/src/schema/verifications.ts` — rationale comments present.
- Each cited commit SHA is on HEAD; `git status --short` clean.
- `verify-first.log` exists, committed, records a disposition for HI-01..HI-06
  and the explicit HI-04 stale-premise correction.
- `.planning/review/data.md` + `REVIEW-INDEX.md` carry the closure markers.
</verification>

<success_criteria>
- HI-01, HI-03, HI-05: accurate doc/comment commits — `docs/operations.md`
  runbook sections + 5 schema-file rationale comments; NO migration SQL edited.
- HI-02: a RED+GREEN pair on `main` — migration `0029` + `.down.sql` +
  journal entry + a `HI-02`-named migration test; applies against a fresh
  testcontainer Postgres; 5 leading-`user_id` indexes exist; `api_keys`
  excluded (covered by 0028); plain `CREATE INDEX`, no `CONCURRENTLY`.
- HI-04: a RED+GREEN pair on `main` — `runBackfill` guard refuses
  lens-managed credential columns (both `session` and `sessions` forms),
  no-op for non-lens columns; the stale-premise correction documented in
  `verify-first.log`.
- HI-06: a RED+GREEN pair on `main` — KMS/Vault stubs removed from the
  public barrel, `selectProvider()` path intact, `docs/security.md §12`
  corrected to v1-`env`-only.
- `pnpm --filter @openwhispr/data test` green; `pnpm lint:lockers` green (8);
  `pnpm typecheck` no new errors vs the 5-error baseline.
- `.planning/review/data.md` + `REVIEW-INDEX.md` annotated.
- No skipped tests, no `.only`, no `@ts-expect-error` without `issue-NNNN:`.
- No `as any` / `as unknown as` / `@ts-ignore` introduced; no APPLIED
  migration SQL edited (CLAUDE.md hard rule 1).
- No gitleaks hook bypass (CLAUDE.md hard rule 4).
- data ME-01..07 / LO-01..05 untouched (out of scope).
</success_criteria>

<risk_register>
| Risk | Task | Mitigation |
|------|------|------------|
| HI-02: `CREATE INDEX CONCURRENTLY` used by reflex → 25001 inside the migrator transaction. | 1 | The runner wraps each migration in a transaction (confirmed by 0014's own comment). PLAN mandates plain `CREATE INDEX`; the verify step asserts `grep -c CONCURRENTLY` is `0`. |
| HI-02: `_journal.json` not updated → migration silently skipped by `migrate()`. | 1 | GREEN step explicitly adds the `idx: 30` journal entry; verify greps for the tag. Confirm in verify-first whether `drizzle-kit generate` is the repo convention. |
| HI-02: `api_keys` wrongly included (review/CONTEXT said 6 tables). | 1 | Confirmed migration 0028 rescoped `api_keys_active_name_idx` to lead with `user_id`. PLAN scopes 0029 to the 5 remaining tables; verify-first re-confirms 0028. |
| HI-04: guard misses the `session` vs `sessions` table-name skew → a lens-managed column slips through. | 2 | `ENCRYPTED_COLUMNS_MAP` keys `session` (singular); the SQL table + backfill map use `sessions`. The refuse-list MUST include BOTH; RED tests both forms. |
| HI-04: guard over-blocks a legitimate non-lens column. | 2 | RED 2 pins the no-op-for-non-lens behaviour; the refuse-list is a closed static enumeration, not a prefix/pattern match. |
| HI-04: temptation to "fix" by editing applied migration 0025. | 2 | CLAUDE.md hard rule 1: HI-04 is a `backfill.ts` (production source, not migration) guard. No migration SQL touched. |
| HI-06: a downstream importer pulls `VaultKeyProvider`/`KmsKeyProvider` from the barrel → typecheck breaks after the unexport. | 3 | GREEN step greps all of `apps`+`packages` for barrel importers and repoints them to the direct file path; `pnpm typecheck` in the verify step catches any miss. |
| Doc inaccuracy — a runbook entry that misdescribes the migration. | 4 | Each HI-01/03/05 sub-step has an explicit `grep` accuracy check against the source migration before the prose is written. |
| typecheck regression from new test files / the backfill const. | 1,2,3 | New migration test, the backfill refuse-list, the barrel-surface test are ordinary typed surfaces; run `pnpm typecheck` after each code task — must stay at the 5-error baseline. |
| A failing test tempts a production hack. | all | CLAUDE.md hard rule 1: the production change here IS the genuine fix (a new migration / a guard / a barrel edit). If a HALT arises, log in `.planning/deferred-items.md` with WHY evidence and report in the SUMMARY. |
</risk_register>

<output>
After completion, create
`.planning/phases/67-high-findings-data/67-01-SUMMARY.md`.

In the SUMMARY, explicitly record per finding:
- HI-01: the verify-first determination; the `docs/operations.md` section
  added; the doc commit SHA.
- HI-02: the verify-first determination; the migration number assigned
  (`0029`); the 5 tables indexed and confirmation `api_keys` was excluded
  (covered by 0028); plain `CREATE INDEX` (no `CONCURRENTLY`); the journal
  update; the RED/GREEN SHAs.
- HI-03: the verify-first determination; the `docs/operations.md` section
  added; the doc commit SHA.
- HI-04: the verify-first determination AND the explicit STALE-PREMISE
  correction (`ENCRYPTED_COLUMNS_MAP` is populated post-Phase-57 — the guard
  is a static lens-managed refuse-list, not a map-emptiness check); the
  `session`/`sessions` skew handling; the RED/GREEN SHAs.
- HI-05: the verify-first determination; the 5 schema files commented + the
  `docs/operations.md` tenant-delete note; the doc commit SHA.
- HI-06: the verify-first determination; approach (a) confirmed — barrel
  unexport + `docs/security.md §12` correction; any downstream importer
  repointed; the RED/GREEN SHAs.
- LOCKER outcome — all 8 lockers green; LOCKER-08 unchanged (HI-04 is
  defence-in-depth, no allowlist edit).
- `pnpm typecheck` result vs the 5-error baseline.
- Confirmation NO applied migration SQL (`0000`/`0001`/`0005`/`0010`/`0014`)
  was edited.
- The final per-finding closure markers written to `data.md` + `REVIEW-INDEX.md`.
- Any divergence from the planner's pre-determination.
</output>
