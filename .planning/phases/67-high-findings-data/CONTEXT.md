# Phase 67 — HIGH findings: data (6 / HI-01..06)

## Background

Pre-publication HIGH-backlog clearance, phase-by-phase by package
(user decision 2026-05-20). Phases 62–66 cleared api-core (5),
api-routes-rest (3), api-routes-conversations (4),
api-routes-transcriptions (11), worker (7) — 30 HIGH closed. This phase
clears the **`packages/data`** HIGH cluster — 6 findings
(`.planning/review/data.md`, HI-01..HI-06). data CR-01..05 were the 5
CRITICALs already closed (Phases 57–58).

**Important — this cluster is a mix of code fixes and
docs/runbook items.** HI-01, HI-03, HI-05 are "surface in operator
runbook" findings (CLAUDE.md hard rule 1 forbids editing the already-
applied migration SQL); HI-02, HI-04, HI-06 are code/schema fixes.
Do not invent a code change where the finding's own remediation is a
runbook/comment entry.

## The 6 HIGH findings (from `.planning/review/data.md`)

**Re-verify each against current code before fixing** (CLAUDE.md hard
rule 3).

### HI-01 — migration 0005 `TRUNCATE TABLE "sessions"` is destructive on replay
`packages/data/migrations/0005_session_token_plain.sql:33` — an
unconditional `TRUNCATE sessions` in an applied-in-order migration.
**CLAUDE.md hard rule 1: the 0005 file MUST NOT be edited** (never
touch applied migration SQL). Migration 0021 already introduced
`_safe_table_reset(...)` to prevent recurrence. The remediation is a
**runbook entry** — document 0005 as a "destructive forward migration"
in the operator runbook (`docs/` — find the migration/operations doc)
with an explicit pre-flight check ("if upgrading an install with live
sessions, expect all sessions cleared at 0005"). NO code/SQL change.

### HI-02 — FK columns have no dedicated index → cascade-delete seq scans
`api_keys.user_id` (`migrations/0010_api_keys.sql`) is a NOT NULL FK
`ON DELETE CASCADE` with no index starting on `user_id` → `DELETE FROM users`
seq-scans `api_keys`. Same for `transcriptions.user_id`,
`conversations.user_id`, `messages.user_id`, `notes.user_id`,
`folders.user_id` — only the keyset partial index exists, insufficient
for the FK cascade scan. Fix: a NEW forward migration adding a
dedicated index on each FK `user_id` column (`CREATE INDEX ... ON <tbl> (user_id)`).
Verify per table whether an existing index already covers `user_id` as
its leading column (the keyset partial indexes lead with `tenant_id` —
they do NOT). This is the next migration number after the highest
currently in `packages/data/migrations/` — determine it; Phase 59
added `0028`, so likely `0029` (confirm).

### HI-03 — migration 0014 audit_log legacy rows land in `audit_log_default`, never promoted
`migrations/0014_audit_log_partition.sql:118-138` — legacy rows
predating the 4 premade monthly partitions land in the
`audit_log_default` catch-all; promotion is deferred to the daily
partman-maintenance BullMQ job. **Migration 0014 is applied — do not
edit it.** The remediation is a **runbook entry**: document that after
upgrading through 0014, the operator must ensure the
partman-maintenance worker job runs (or run `run_maintenance_proc()`
manually once) to promote legacy audit rows off the default partition;
until then, month-scoped audit queries miss legacy rows. NO migration
edit.

### HI-04 — `backfill.ts` idempotency predicate is broken post-0020/0025 — data-corrupting
`packages/data/src/encryption/backfill.ts:108-148` — the backfill SQL
`WHERE "${column}" IS NOT NULL AND "${column}_value_ciphertext" IS NULL`.
Post-0025 (which re-added the plaintext columns as nullable text),
running the backfill CLI on a `account.*`/`verification.value`/
`sessions.{token,previous_token}` column encrypts the plaintext into
sidecars but LEAVES the plaintext populated → plaintext + ciphertext
coexist; a later correct lens read silently overwrites the plaintext
Better Auth is actively using. Fix: add an explicit GUARD to the
backfill module — refuse to run if the target column is one of the
Better-Auth-owned credential columns. NOTE: Phase 57 Track A populated
`ENCRYPTED_COLUMNS_MAP` for those columns — the review's "while
`ENCRYPTED_COLUMNS_MAP` is empty" framing is now STALE; the real guard
condition is "refuse to backfill a column that the encryption lens
already manages at write-time" (the lens encrypts on write post-Phase-57,
so a bulk backfill is both unnecessary and corrupting for those
columns). Verify the current state and design the guard against the
post-Phase-57 reality, not the review's stale premise.

### HI-05 — `audit_log` (+ usage_ledger/account/verification/sessions) tenant_id FK is `ON DELETE NO ACTION`, undocumented
`migrations/0000_initial.sql:78-80`, `0014:76-78` — `audit_log.tenant_id → tenants.id`
is `ON DELETE NO ACTION` while sibling tenant_id FKs cascade. This is
CORRECT for the append-only audit posture (a tenant cannot be deleted
while audit rows exist) but is undocumented. **Migrations are applied —
do not edit them.** Remediation is a **doc/comment**: document the
`NO ACTION` tenant-delete semantics for `audit_log`, `usage_ledger`,
`account`, `verification`, `sessions` — either as a comment in the
drizzle schema files (`packages/data/src/schema/*.ts`) AND/OR in the
operator tenant-delete runbook. NO migration edit.

### HI-06 — `VaultKeyProvider` / `KmsKeyProvider` exported from the public barrel as production-grade, but are stubs
`packages/data/src/encryption/index.ts:30,39` re-exports
`VaultKeyProvider` + `KmsKeyProvider`; both throw `NOT_IMPLEMENTED` on
every method. `validateKeyProviderSelection()` refuses
`OPENWHISPR_KEY_PROVIDER=vault|kms` at boot (the intended guard), but a
downstream importer can construct the broken object directly. And
`docs/security.md §12` describes AWS KMS / GCP KMS / Azure Key Vault /
HashiCorp Vault as available — docs-vs-code drift. Fix: resolve the
drift. Options: (a) stop exporting the stubs from the public barrel
(keep them internal, so only `selectProvider()` can reach them) and
correct `docs/security.md §12` to state v1 supports `env` only with
KMS/Vault as a documented v2 roadmap item; (b) make the stubs
constructor-throw (fail at instantiation, not per-method) so a direct
importer fails loudly. The planner should pick — lean (a): the
boot-gate already enforces `env`-only; the public-barrel export +
the docs claim are the actual drift. Whatever is chosen, code and
`docs/security.md` must agree.

## Goal

After this phase:
1. HI-01..HI-06 each resolved — code fix (HI-02, HI-04, HI-06) OR
   runbook/doc entry (HI-01, HI-03, HI-05) — and verified.
2. Code fixes land via strict TDD (RED→GREEN→REFACTOR), atomic commits.
   Doc/runbook items land as doc commits (no test, but the doc must be
   accurate against the code/migration it describes).
3. `pnpm --filter @openwhispr/data test` green; `pnpm lint:lockers`
   green (8 lockers); `pnpm typecheck` no new errors vs the 5-error
   baseline.
4. `.planning/review/data.md` + `REVIEW-INDEX.md` annotated with
   per-finding closure markers.

## Constraints

- **CLAUDE.md hard rule 1 — NEVER edit applied migration SQL.** HI-01,
  HI-03, HI-05 reference already-applied migrations; their remediation
  is forward-only (a NEW migration for HI-02) or docs. Do not touch
  `0000`/`0005`/`0010`/`0014` etc.
- **Strict TDD for code fixes** — HI-02 (new migration — test it
  applies + the index exists), HI-04 (the backfill guard — RED: the
  guard does not fire on a BA-credential column; GREEN: it refuses),
  HI-06 (RED: the stub is publicly importable / docs claim support;
  GREEN: closed).
- **Verify-first** — every finding re-confirmed; HI-04's "empty
  ENCRYPTED_COLUMNS_MAP" premise is STALE post-Phase-57 — design the
  guard against current reality.
- **No mocks of internal logic** — data tests use real Postgres via
  testcontainers (already wired in `packages/data`).
- **HI-02 migration** — additive, forward-only, with a `.down.sql`;
  `CREATE INDEX` (consider `CONCURRENTLY` implications — migrations run
  in a transaction, `CONCURRENTLY` cannot; a plain `CREATE INDEX` is
  fine for the index-creation-at-migration-time case — confirm the
  migration runner's transaction posture).
- **No bypassing gitleaks hooks** — CLAUDE.md hard rule 4.
- **Constitutional lockers green** — `pnpm lint:lockers` (8); LOCKER-08
  (no plaintext credential columns) — HI-04's guard is defence-in-depth
  for that invariant.
- **commitlint** — conventional-commit, lowercase subject, ≤ ~72 chars.
- **Out of scope** — the data MEDIUM/LOW findings. Do not scope-creep.
- **EN-only** source artifacts.

## Verification gate

Phase passes when:
1. HI-01..HI-06 each resolved (code fix on main with RED+GREEN, or an
   accurate doc/runbook entry committed).
2. `pnpm --filter @openwhispr/data test` green.
3. `pnpm lint:lockers` green (8 lockers).
4. `pnpm typecheck` — no new errors vs the 5-error baseline.
5. HI-02: the new migration applies cleanly against a fresh testcontainer
   Postgres AND has a `.down.sql`; the indexes exist post-apply.
6. `git log --oneline` shows the expected commits.
7. `.planning/review/data.md` + `REVIEW-INDEX.md` annotated.

## Reference

- `.planning/review/data.md` — HI-01..HI-06 + MEDIUM/LOW
- `packages/data/migrations/` — `0005`, `0010`, `0014`, `0000` (READ-ONLY
  applied); the new HI-02 migration is the next free number
- `packages/data/src/encryption/backfill.ts` — HI-04
- `packages/data/src/encryption/index.ts`, `vault-key-provider.ts`,
  `kms-key-provider.ts`, `boot.ts` — HI-06
- `packages/data/src/schema/*.ts` — HI-05 doc comments
- `docs/security.md` §12 — HI-06 docs-vs-code drift
- `docs/` operator/migration runbook — HI-01, HI-03 entries
- Phase 57 (encryption lens / ENCRYPTED_COLUMNS_MAP — HI-04 premise): `.planning/phases/57-pre-publication-critical-fixes/`
- Phase 59 (migration 0028 — HI-02 next-number): `.planning/phases/59-client-e2e-server-followups/`
- CLAUDE.md hard rules: 1, 3, 4; LOCKER-08
