---
phase: 67-high-findings-data
plan: 01
subsystem: packages/data
tags: [review-closure, migrations, encryption, rls, docs]
requires: []
provides:
  - migration 0029 leading user_id FK indexes
  - runBackfill lens-managed-column guard
  - encryption barrel without KMS/Vault stubs
  - operator runbook: destructive migrations / partman / tenant-delete
affects:
  - packages/data/migrations
  - packages/data/src/encryption
  - packages/data/src/schema
  - docs/operations.md
  - docs/security.md
tech-stack:
  added: []
  patterns:
    - static refuse-list guard at a chokepoint function
    - forward-only additive migration (no applied-SQL edit)
key-files:
  created:
    - packages/data/migrations/0029_fk_user_id_indexes.sql
    - packages/data/migrations/0029_fk_user_id_indexes.down.sql
    - packages/data/migrations/__tests__/0029-fk-user-id-indexes.test.ts
    - packages/data/tests/unit/__tests__/encryption-barrel-surface.test.ts
    - .planning/phases/67-high-findings-data/verify-first.log
  modified:
    - packages/data/migrations/meta/_journal.json
    - packages/data/src/encryption/backfill.ts
    - packages/data/src/encryption/cli/backfill-encrypt-credentials.ts
    - packages/data/src/encryption/index.ts
    - packages/data/tests/unit/__tests__/backfill.test.ts
    - packages/data/tests/unit/__tests__/backfill-cli.test.ts
    - packages/data/src/schema/{audit_log,usage_ledger,sessions,accounts,verifications}.ts
    - docs/operations.md
    - docs/security.md
    - .planning/review/data.md
    - .planning/review/REVIEW-INDEX.md
decisions:
  - "HI-02 excludes api_keys — migration 0028 already gave it a leading-user_id index"
  - "HI-04 guard is a static lens-managed refuse-list (review's empty-map premise was stale post-Phase-57)"
  - "HI-04 CLI DEFAULT_COLUMN_MAP narrowed to oauth_state.code_verifier only"
  - "HI-06 resolved via approach (a) — barrel unexport + docs correction"
metrics:
  duration: ~30m
  completed: 2026-05-21
---

# Phase 67 Plan 01: HIGH findings — data (HI-01..HI-06) Summary

Cleared the 6 `packages/data` HIGH review findings — a mix of code fixes
(HI-02/04/06, strict RED→GREEN TDD) and operator-runbook/schema-comment doc
items (HI-01/03/05). No applied migration SQL was edited (CLAUDE.md hard rule
1). All 6 findings re-verified STILL LIVE before any fix; no divergence from
the planner's pre-determination.

## Per-finding disposition

### HI-01 — destructive migration 0005 (doc) — CLOSED
- **Verify-first:** STILL LIVE — `0005_session_token_plain.sql:33`
  unconditional `TRUNCATE TABLE "sessions"`; no `0005*.down.sql`.
- **Fix:** `docs/operations.md` "Destructive forward migrations" section —
  names migration 0005, pre-flight check (all sessions cleared, schedule a
  maintenance window, truncated rows unrecoverable). Migration SQL unchanged.
- **Commit:** `a2397a62`.

### HI-02 — FK user_id indexes (code, migration 0029) — CLOSED
- **Verify-first:** STILL LIVE for 5 tables — `transcriptions`,
  `conversations`, `messages`, `notes`, `folders` each have a
  `NOT NULL ON DELETE CASCADE` `user_id` FK with only `tenant_id`-leading
  composite indexes. `api_keys` EXCLUDED — migration 0028 already rescoped
  `api_keys_active_name_idx` to lead with `user_id`.
- **Migration number:** `0029_fk_user_id_indexes` (journal max idx was 29 →
  added idx:30). Plain `CREATE INDEX IF NOT EXISTS` (NOT `CONCURRENTLY` — the
  migration runner wraps each file in a transaction). `0029.down.sql`
  companion drops the 5 indexes. `_journal.json` hand-added the idx:30 block.
- **5 tables indexed:** transcriptions, conversations, messages, notes,
  folders — each `<tbl>_user_id_idx ON <tbl> (user_id)`.
- **Test:** `0029-fk-user-id-indexes.test.ts` (HI-02-named) boots a fresh
  testcontainer Postgres, asserts each table has a leading-`user_id` index,
  and that `DELETE FROM users` still cascades.
- **Commits:** RED `4d15757f`, GREEN `4747b4c8`.

### HI-03 — partman legacy-row promotion (doc) — CLOSED
- **Verify-first:** STILL LIVE — `0014_audit_log_partition.sql:121-137`
  copies legacy rows into the partitioned parent; rows predating premade
  partitions land in `audit_log_default`; the migration's own comment defers
  promotion.
- **Fix:** `docs/operations.md` "Audit-log partition maintenance after
  upgrade" — operator must let the `partman-maintenance` BullMQ job run, or
  `CALL partman.run_maintenance_proc();` once manually outside a transaction.
  Migration SQL unchanged.
- **Commit:** `a2397a62`.

### HI-04 — backfill lens-managed-column guard (code) — CLOSED
- **Verify-first:** STILL LIVE — `backfill.ts` has no guard.
- **STALE-PREMISE CORRECTION (explicit):** the review framed the guard as
  "refuse while `ENCRYPTED_COLUMNS_MAP` is empty". `apps/api/src/auth.ts:172`
  was checked — `ENCRYPTED_COLUMNS_MAP` is POPULATED (Phase 57 Track A;
  `account`/`session`/`verification` object literals). The premise is STALE.
  The guard is therefore a STATIC refuse-list of lens-managed (table,column)
  pairs, independent of any runtime map emptiness.
- **Fix:** `runBackfill` gained a module-const `LENS_MANAGED_COLUMNS`
  `ReadonlySet`; it throws (naming the offending `table.column`) at the top
  of the per-column loop, before any SQL. The set covers `account.{password,
  access_token,refresh_token,id_token}`, `verification.value`, and BOTH the
  `session` and `sessions` table-name forms of `token`/`previous_token`
  (table-name skew handled). The CLI `DEFAULT_COLUMN_MAP` was narrowed to only
  `oauth_state.code_verifier` (the sole non-lens-managed column); two stale
  `backfill-cli.test.ts` assertions encoding the pre-HI-04 8-column shape were
  updated. Defence-in-depth for LOCKER-08; no allowlist change.
- **Commits:** RED `c0837847`, GREEN `15a0095d`.

### HI-05 — `NO ACTION` tenant-FK semantics (doc) — CLOSED
- **Verify-first:** STILL LIVE — `0000_initial.sql` sessions/audit_log/
  usage_ledger tenant_id FK `ON DELETE no action`; `0001_better_auth.sql:43,67`
  account/verification `REFERENCES "tenants"("id")` with no `ON DELETE` clause
  → PG default `NO ACTION`.
- **Fix:** rationale comments on the `pgTable` declarations in `audit_log.ts`,
  `usage_ledger.ts`, `sessions.ts`, `accounts.ts`, `verifications.ts` +
  `docs/operations.md` "Tenant deletion" section. Comment-only edits to schema
  TS files — no migration SQL changed, no `.references()` behaviour change.
- **Commit:** `a2397a62`.

### HI-06 — KMS/Vault stubs on the public barrel (code + doc) — CLOSED
- **Verify-first:** STILL LIVE — `encryption/index.ts:32,41` re-export
  `KmsKeyProvider`/`VaultKeyProvider`; `key-provider.ts` imports them directly
  from their own files (`selectProvider()` reach unaffected by a barrel edit).
- **Approach (a) confirmed:** the two `export {...}` barrel lines removed;
  stubs stay reachable internally via `selectProvider()`. A grep of all of
  `apps`+`packages` found NO downstream barrel importer — `key-provider.test.ts`
  imports the stubs via the direct file path, unaffected. `docs/security.md
  §12` gained §12.1.1 stating v1 supports `OPENWHISPR_KEY_PROVIDER=env` only;
  `vault`/`kms` are v2-roadmap stubs refused at boot; §12.5 reframed as
  `MASTER_KEK` byte-sourcing via the `env` provider.
- **Commits:** RED `3835c0b2`, GREEN `20a75949`.

## Verification (run by the executor)

- `pnpm --filter @openwhispr/data test` — **47 files, 534 passed, 6 skipped,
  0 failing** (+21 tests vs the 513 baseline).
- `pnpm lint:lockers` — **all 8 lockers exit 0** (green). LOCKER-08 unchanged
  — HI-04 is defence-in-depth, no allowlist edit. All findings reported are
  pre-existing allowlisted WARNs (no new violations).
- `pnpm typecheck` — **exactly the documented 5-error baseline** (3×
  `apps/api/src/routes/index.ts`, `tokens/assemblyai.ts:107`,
  `tokens/deepgram.ts:74`) — **0 new errors**.
- Applied-migration diff check: `git diff` over `0000`/`0001`/`0005`/`0010`/
  `0014` is EMPTY — no applied migration SQL edited.
- Migration `0029` body: exactly 5 `CREATE INDEX IF NOT EXISTS` statements,
  0 `CONCURRENTLY` in any statement (the comment block mentions the word in
  prose only), `0029.down.sql` has 5 `DROP INDEX IF EXISTS`.

## Divergence from the planner's pre-determination

None. All 6 findings confirmed exactly as pre-determined, including the HI-02
`api_keys`-excluded correction and the HI-04 stale-premise correction. The
only judgement-call addition (explicitly permitted by the plan) was narrowing
the CLI `DEFAULT_COLUMN_MAP` and updating two stale `backfill-cli.test.ts`
assertions — recorded in `verify-first.log`.

## Out of scope (untouched)

data MEDIUM (ME-01..07) and LOW (LO-01..05) findings remain open — not in this
phase's scope.

## Self-Check: PASSED

- Created files exist: `0029_fk_user_id_indexes.sql`, `.down.sql`,
  `0029-fk-user-id-indexes.test.ts`, `encryption-barrel-surface.test.ts`,
  `verify-first.log` — all confirmed on disk.
- Commits on HEAD: `4b41f131`, `4d15757f`, `4747b4c8`, `c0837847`, `15a0095d`,
  `3835c0b2`, `20a75949`, `a2397a62`, `0739cf26` — all confirmed via git log.
