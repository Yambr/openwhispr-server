# Phase 33: Envelope encryption wired to Better Auth credential columns (CR-8 closure) — Context

**Gathered:** 2026-05-16
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss; user offline; advisor-agent handles grey-area)
**Source:** ROADMAP Phase 33 entry + `.planning/review/data.md` CR-02 + `.planning/review/REVIEW-INDEX.md` CR-8
**Phase 32 lesson:** Pre-flight verify migration sequence and any ROADMAP factual drift before spawning research.

## Pre-flight resolved blockers (lessons from Phase 32 HALT)

- **Migration filename:** ROADMAP says `0018_envelope_encrypt_secret_columns.sql`, but Phase 32 took 0018. **Use `0019_envelope_encrypt_secret_columns.sql`** (verified via `ls packages/data/migrations/*.sql | tail -5`).
- **RLS pattern inheritance:** Any new tenant-scoped columns or policy edits MUST use the `NULLIF(current_setting('app.tenant_id', true), '')::uuid` pattern (Phase 32 SUMMARY §D-1) — NOT the `IS NOT NULL AND <> ''` chain (PostgreSQL planner does not short-circuit before `::uuid` cast).
- **Encryption module is dead code today:** `packages/data/src/encryption/envelope.ts` (AES-256-GCM, per-row DEK, 12-byte IV, GCM auth tag) is fully implemented but has ZERO production consumers. Phase 33 wires it up.
- **Better Auth integration surface:** sign-in / sign-out / password-reset / OAuth round-trip — Phase 33's integration tests must round-trip all four flows.

<domain>
## Phase Boundary

Every Better Auth credential column stored as envelope-encrypted `bytea` (AES-256-GCM, per-row DEK, 12-byte IV, GCM auth tag, KEK from `MASTER_KEK` env). Targets:

- `account.{access_token, refresh_token, id_token, password}` (4 columns)
- `verification.value` (1 column — password-reset token)
- `sessions.{token, previous_token}` (2 columns)
- `oauth_state.code_verifier` (1 column)

**Total: 8 credential columns across 4 tables.**

Encryption/decryption happens at Drizzle lens layer — Better Auth ↔ DB plaintext boundary is never crossed. A DB dump no longer leaks third-party IdP OAuth tokens, session bearers, or password-reset tokens.

## Scope (in)

### Migration sequence (3 sub-migrations + 1 lens commit)

**Migration `0019_envelope_encrypt_secret_columns_add.sql`** (additive):
- For each of the 8 credential columns, ADD `<col>_ciphertext bytea`, `<col>_dek_wrapped bytea`, `<col>_iv bytea`, `<col>_tag bytea` (4 new bytea columns per credential column → 32 new columns total).
- Plaintext columns remain in place during this migration; new columns are nullable.
- Verify forward + rollback on real PG testcontainer.

**Backfill step** (Node-side migrator, idempotent):
- Read each row's plaintext column → encrypt via envelope lens → write to the 4 new bytea columns → leave plaintext column intact for now.
- Skip rows where ciphertext already populated (idempotent).
- Per-column dry-run mode + row-count gate.

**Migration `0020_envelope_encrypt_secret_columns_drop_plaintext.sql`** (lands AFTER lens is wired and integration tests pass):
- DROP the 8 plaintext columns.
- This migration lands in a separate atomic commit, gated on the lens commit being merged + integration tests green.

**Drizzle lens** (`packages/data/src/encryption/lens.ts` — NEW):
- Read path: row hydration runs `decrypt(ciphertext, dek_wrapped, iv, tag, MASTER_KEK)` → original plaintext bound to the original column name (Better Auth sees plaintext).
- Write path: column write runs `encrypt(plaintext, MASTER_KEK)` → produces `{ciphertext, dek_wrapped, iv, tag}` → writes to the 4 bytea columns, leaves the plaintext column NULL (post-0020) or empty (pre-0020).
- KEK from `MASTER_KEK` env (32 bytes base64-decoded). App refuses to start if missing/wrong-length (loud-fail per Phase 14 BYOK convention).

### Tests

**Unit on `envelope.ts` (already exists — verify coverage):**
- Round-trip (encrypt → decrypt = original)
- Tampered ciphertext rejected (GCM auth tag mismatch)
- Wrong KEK → decryption fails
- KEK rotation: old DEK wrapped under old KEK still decrypts; new rows use new KEK

**Integration on Better Auth + lens (real Postgres testcontainer):**
- Sign-in flow: `account.password` ciphertext on disk; lens decrypts; Better Auth succeeds
- Sign-out flow: `sessions.token` round-trip via lens
- Password-reset flow: `verification.value` ciphertext on disk; reset link consumption decrypts correctly
- OAuth round-trip: `oauth_state.code_verifier` + `account.{access_token, refresh_token, id_token}` ciphertext on disk; all four decrypt on callback
- Each flow asserts: (a) plaintext path returns correct value, (b) raw DB read of the bytea column returns ciphertext that differs from plaintext, (c) tampered ciphertext rejected

**KEK rotation property test:**
- Generate KEK_v1, encrypt rows, rotate to KEK_v2 (with KEK_v1 still in overlap window), assert old rows still decrypt
- Retire KEK_v1, assert old rows no longer decrypt (raise)

**Boot-time refusal test:**
- App boot with `MASTER_KEK` unset → exit non-zero + typed error code
- App boot with `MASTER_KEK` wrong length → exit non-zero + typed error code

### New locker: LOCKER-PLAINTEXT-COLS (becomes DISCIPLINE Rule 15)

**`tools/lint-no-plaintext-secret-columns.ts`** (NEW):
- AST scan of `packages/data/src/schema/**`
- Refuses `text(<colname>)` where `<colname>` matches `/^(access_token|refresh_token|password|id_token|value|token|previous_token|code_verifier)$/`
- ≥ 90/90/90/90 coverage on the linter
- Wired into `pnpm lint:lockers` aggregate + lefthook + ci.yml + nightly.yml
- DISCIPLINE Rule 15 amended in same commit as the linter source (LOCKER-07 precedent)
- CLAUDE.md mirror updated same commit

### Documentation

**`docs/security.md` "Encryption at rest" section:**
- What is encrypted (the 8 columns above)
- `MASTER_KEK` env requirements (32-byte AES-256 key, base64 encoded, never logged)
- KMS provisioning recipes:
  - AWS KMS (`aws kms generate-data-key` → env injection at boot)
  - GCP KMS
  - Azure Key Vault
  - HashiCorp Vault
- KEK rotation runbook (generate new KEK, deploy with both KEK_old + KEK_new env, run re-wrap migrator, retire KEK_old)

## Scope (out)

- Encryption of non-credential columns (notes content, transcriptions, etc.) — separate future phase.
- KEK escrow / split-trust schemes — operator-side decision.
- Hardware Security Module (HSM) integration — out of scope; documented as KMS-derivable but not bundled.
- Phase 34 (tenantPlugin retirement) — separate phase.

</domain>

<decisions>
## Implementation Decisions

### Migration split
- 3 separate SQL migrations (additive 0019 → backfill via Node script → drop-plaintext 0020) provides safe rollback windows.
- 0019 (additive) lands first; can be rolled back independently.
- Backfill is non-DDL; runs on the live DB.
- 0020 (drop plaintext) lands LAST, atomic with the lens commit going live (so traffic moving from "read both columns, prefer ciphertext" to "read ciphertext only" happens in one transaction).

### Lens implementation
- `packages/data/src/encryption/lens.ts` — new file; uses existing `envelope.ts` primitives.
- Drizzle has no native column-level lens API. Implementation: custom `getValue()` / `setValue()` on a per-column basis, or a wrapper helper `withEncryptionLens(table)` that the schema declarations opt into.
- Alternative: implement via DB-level VIEW + INSTEAD OF triggers (encryption in PG). Rejected because key material must stay in Node process; DB-level encryption requires PG extensions (pgcrypto) and the KEK would leak via `pg_stat_activity`.

### Key derivation
- `MASTER_KEK` env is the AES-256 key directly (not a passphrase that needs KDF). 32 raw bytes, base64-encoded for transport.
- Per-row DEK is generated via `crypto.randomBytes(32)` and wrapped under `MASTER_KEK` (AES-256-GCM with separate IV).
- No PBKDF2/Argon2 for KEK derivation — that's KMS-layer concern (KMS-provided KEK already cryptographically random).

### Boot-time refusal
- `validateMasterKek()` runs in `packages/data/src/encryption/env.ts` (likely already exists per `envelope.ts` design); called from app entry-points (api + worker) at boot.
- Exit code: 78 (EX_CONFIG per BSD sysexits) — operator-visible.

### LOCKER-PLAINTEXT-COLS allowlist
- After 0020 drops plaintext columns, the locker should find zero violations. Allowlist seeded empty.
- Pre-0020 (during the transition commit window), the 8 plaintext column declarations remain — locker would fire. Resolution: lock the locker introduction to AFTER 0020 lands, in the same atomic commit as the schema cleanup. (Alternative: ship locker with allowlist containing the 8 declarations, then clear allowlist in 0020 commit. First option preferred — no allowlist churn.)

### Phase 33 atomic-commit cadence
- 33-01: `0019` migration + migration test (RED → GREEN, atomic).
- 33-02: Lens (`lens.ts`) + envelope.ts coverage gap fill (if any) + unit tests for round-trip / tampered / wrong-KEK / rotation.
- 33-03: Backfill Node migrator + idempotent re-run test.
- 33-04: Schema declarations switch to bytea-only columns + Better Auth integration test (sign-in/out/password-reset/OAuth) on real PG testcontainer + boot-time refusal test.
- 33-05: `0020` plaintext drop migration + lens-only schema declarations + LOCKER-PLAINTEXT-COLS + DISCIPLINE Rule 15 + CLAUDE.md mirror + lefthook/CI wiring + docs/security.md section. Single atomic commit per LOCKER-07 precedent.

</decisions>

<code_context>
## Existing Code Insights

- `packages/data/src/encryption/envelope.ts` — fully implemented AES-256-GCM envelope (per `.planning/review/data.md` review). Read in full before designing the lens.
- `packages/data/src/encryption/index.ts` — likely the barrel export.
- `packages/data/src/schema/users.ts` — Better Auth `users` + `accounts` + `verifications` + `sessions` schemas; modified file from earlier work (per gitStatus).
- `packages/data/src/schema/oauth_state.ts` (if exists) — `code_verifier` column source.
- Existing migration test pattern at `packages/data/migrations/__tests__/0018-rls-fail-closed.test.ts` (Phase 32 precedent).
- `bootMigratedPostgres` fixture at `packages/data/src/__tests__/helpers.ts` (Phase 32 used).
- Better Auth integration entry point at `apps/api/src/auth.ts`.

</code_context>

<specifics>
## Specific Ideas

- Use `crypto.subtle` (Web Crypto API, Node 24 native) for AES-256-GCM where possible — falls back to `node:crypto` if envelope.ts already uses node:crypto. Match existing style.
- Backfill migrator filename: `packages/data/src/encryption/backfill.ts` (or `migrations/scripts/backfill-encrypt-credentials.ts`).
- Boot-time refusal: in `apps/api/src/bootstrap.ts` + `apps/worker/src/index.ts`. Both must call `validateMasterKek()` before any DB operation.
- `docs/security.md` section number: §12 (Phase 32 added §11).
- Integration test file: `packages/data/src/__tests__/encryption-lens.integration.test.ts` + `apps/api/src/__tests__/better-auth-encryption.integration.test.ts`.

</specifics>

<deferred>
## Deferred Ideas

- Encryption of `users.password_hash` if it's not already covered (some Better Auth setups split `account.password` and `users.password_hash` — research must clarify).
- Encryption of audit-log payloads.
- KMS provisioner sidecar container.
- Phase 34 tenantPlugin retirement — separate phase; landing order: 33 → 34.

</deferred>
